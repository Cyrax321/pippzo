// Engagement core: ingest comments / mentions / DMs, classify them, draft
// replies in brand voice, and send them according to the workspace policy.
// Server-only.

import { generateText, Output, NoObjectGeneratedError } from "ai";
import { z } from "zod";
import { resolveChatModel } from "../llm-resolver.server";
import { playbookBlock } from "../playbooks.server";
import { loadBrandBrain } from "../agent-memory.server";
import { logAiUsage } from "../ai-usage.server";
import { notify } from "../notifications.server";
import { logActivity } from "../activity-log";
import {
  requireUnipileCreds,
  listAccounts,
  getOwnProfile,
  listOwnPosts,
  listPostComments,
  ownRepliedToComment,
  listChats,
  listChatAttendees,
  listChatMessages,
  replyToComment,
  sendChatMessage,
  reactToPost,
  type UnipileCreds,
} from "./unipile.server";
import {
  ALWAYS_ESCALATE,
  type EngagementIntent,
  type EngagementKind,
  type EngagementSentiment,
  type ReplyMode,
} from "./types";

type Client = { from: (t: string) => any };

// String.slice can cut an emoji or styled-unicode character in half, leaving a
// lone high surrogate that Postgres rejects as invalid JSON — which would sink
// the entire batch insert. Always truncate with this instead of .slice.
const cut = (s: string, n: number) => s.slice(0, n).replace(/[\uD800-\uDBFF]$/, "");

// ------------------------------------------------- bounding the work (find 10)

/**
 * A wall-clock budget for a whole operation, as opposed to the per-request
 * deadline in fetch-timeout.ts.
 *
 * The two are not interchangeable, which is the point of this one existing. A
 * 30s ceiling on each HTTP call does nothing about a sweep that makes 353 of
 * them: that is still nearly three hours in the worst case, every second of it
 * inside a tick whose caller gives up after 300s. The per-call deadline bounds
 * one request; this bounds the operation.
 *
 * `now` is injectable so the budget can be tested without real time passing.
 */
export type Deadline = {
  /** Milliseconds left, never negative. */
  remainingMs: () => number;
  /** True once the budget is spent. Check before starting the next unit of work. */
  expired: () => boolean;
};

export function createDeadline(budgetMs: number, now: () => number = Date.now): Deadline {
  const startedAt = now();
  return {
    remainingMs: () => Math.max(0, budgetMs - (now() - startedAt)),
    expired: () => now() - startedAt >= budgetMs,
  };
}

/** A deadline that expires as soon as EITHER input does. */
export function tighterOf(a: Deadline, b: Deadline): Deadline {
  return {
    remainingMs: () => Math.min(a.remainingMs(), b.remainingMs()),
    expired: () => a.expired() || b.expired(),
  };
}

/**
 * Budgets, in milliseconds.
 *
 * `sweep` is the ceiling for one workspace's full sweep — ingest, classify,
 * draft/route. It is deliberately well under the 300s the automation caller
 * waits, because a tick does more than one workspace and more than engagement.
 *
 * `ingest` is a sub-budget so the network fan-out cannot starve the two model
 * loops that follow it: a healthy ingest with the concurrency below finishes
 * in a few seconds, so 45s is roughly ten times the expected cost and still
 * leaves the majority of the sweep for classification and drafting.
 *
 * These bound the work STARTED, not the work in flight: a call that has
 * already begun still gets its own FETCH_TIMEOUT.api (30s) to finish, so the
 * true ceiling is the budget plus one call's deadline. Nothing here cancels an
 * in-flight request.
 */
export const ENGAGEMENT_BUDGET = {
  sweep: 120_000,
  ingest: 45_000,
} as const;

/**
 * How many Unipile reads may be in flight at once.
 *
 * Modest on purpose. The per-post comment fetches and the per-chat message
 * fetches are independent GETs, so widening this is what turns a worst case of
 * minutes into one of seconds — but Unipile rate-limits, and a burst of 30
 * parallel requests trades one failure mode for another. Four is enough to
 * collapse the fan-out by most of an order of magnitude while staying polite.
 *
 * Reads only. Nothing that writes to a social network — a reply, a message, a
 * reaction — is ever run through the limiter: those are ordered, side-effecting
 * and rate-sensitive, and running two at once is how you double-post.
 */
export const READ_CONCURRENCY = 4;

/**
 * Runs `worker` over `items` with at most `limit` in flight, returning results
 * in INPUT order (not completion order).
 *
 * Written by hand rather than pulled in as a dependency — it is a dozen lines.
 *
 * Failure behaviour is deliberate: a worker that throws stops new work from
 * starting, but the already-running workers are awaited to completion before
 * the first error is re-thrown. That avoids leaving orphaned promises behind to
 * surface later as unhandled rejections, which is what a naive
 * `Promise.all(...)`-with-early-reject does. In practice every caller here
 * catches inside its own worker so a single bad post or chat costs only itself,
 * exactly as the old sequential try/catch per iteration did.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const total = items.length;
  const out = new Array<R>(total);
  if (total === 0) return out;

  const lanes = Math.max(1, Math.min(Math.floor(limit) || 1, total));
  let next = 0;
  let failed = false;
  let failure: unknown = null;

  async function drain(): Promise<void> {
    for (;;) {
      if (failed) return;
      const i = next++;
      if (i >= total) return;
      try {
        out[i] = await worker(items[i], i);
      } catch (e) {
        if (!failed) {
          failed = true;
          failure = e;
        }
        return;
      }
    }
  }

  // drain() never rejects, so this never rejects with work still running.
  await Promise.all(Array.from({ length: lanes }, () => drain()));
  if (failed) throw failure;
  return out;
}

export type ItemRow = {
  id: string;
  workspace_id: string;
  kind: EngagementKind;
  network: string;
  external_account_id: string;
  external_id: string;
  thread_id: string | null;
  post_id: string | null;
  post_excerpt: string | null;
  permalink: string | null;
  author_name: string;
  author_handle: string | null;
  author_url: string | null;
  author_avatar_url: string | null;
  text: string;
  occurred_at: string | null;
  sentiment: EngagementSentiment | null;
  intent: EngagementIntent | null;
  urgency: string | null;
  should_reply: boolean | null;
  classification: Record<string, unknown>;
  status: string;
};

type Policy = {
  mode: ReplyMode;
  safeCategories: EngagementIntent[];
  dailyLimit: number;
};

export async function loadPolicy(client: Client, workspaceId: string): Promise<Policy> {
  const { data } = await client
    .from("workspaces")
    .select("engagement_reply_mode,engagement_safe_categories,engagement_daily_limit")
    .eq("id", workspaceId)
    .maybeSingle();
  const row = (data ?? {}) as Record<string, unknown>;
  return {
    mode: ((row.engagement_reply_mode as ReplyMode) ?? "draft") || "draft",
    safeCategories: ((row.engagement_safe_categories as EngagementIntent[]) ?? ["praise"]) || [
      "praise",
    ],
    dailyLimit: Number(row.engagement_daily_limit ?? 10) || 0,
  };
}

// --------------------------------------------------------------- ingestion

async function syncedAccounts(client: Client, workspaceId: string, creds: UnipileCreds) {
  const remote = await listAccounts(creds);
  for (const a of remote) {
    await client.from("engagement_accounts").upsert(
      {
        workspace_id: workspaceId,
        provider: "unipile",
        external_account_id: a.id,
        network: a.type,
        name: a.name,
        status: a.status,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,provider,external_account_id" },
    );
  }
  return remote;
}

/**
 * Per-account ceilings on the fan-out, enforced here as well as in the Unipile
 * adapter. Belt and braces on purpose: the adapter stops the upstream handing
 * back more than was asked for, and these are what the app asks for.
 */
export const INGEST_CAPS = {
  /** Accounts swept per run. Extras are reported, not silently dropped. */
  accounts: 10,
  posts: 10,
  commentsPerPost: 30,
  chats: 20,
  messagesPerChat: 10,
} as const;

/**
 * Pulls new comments on our recent posts plus unread DMs into
 * `engagement_items`. Idempotent: existing external ids are skipped.
 *
 * Bounded three ways (docs/bugs.md finding 10):
 *  - every Unipile call carries a 30s deadline (see unipile.server.ts);
 *  - the whole sweep carries a wall-clock budget and stops cleanly when it is
 *    spent, reporting what it did and what it left for the next run;
 *  - the independent reads — comments per post, the reply check per comment,
 *    messages and attendees per chat — run with a small concurrency limit.
 *
 * Stopping early is always safe here: this function only ever inserts items it
 * fully resolved, and anything it did not reach is simply picked up next time.
 * Whatever it did gather is still written before it returns — partial progress
 * that is honestly reported beats a sweep that never comes back.
 */
export async function ingestEngagement(
  client: Client,
  workspaceId: string,
  opts: {
    postLimit?: number;
    chatLimit?: number;
    /** Wall-clock ceiling for the whole ingest. Ignored if `deadline` is given. */
    budgetMs?: number;
    /** An existing budget to run inside (the sweep's, normally). */
    deadline?: Deadline;
    concurrency?: number;
  } = {},
): Promise<{
  accounts: number;
  inserted: number;
  skipped: number;
  reconciled: number;
  errors: string[];
  /** True when the budget ran out before every account had been swept. */
  budgetExhausted: boolean;
  /** Accounts left untouched because the budget ran out or the cap was hit. */
  accountsDeferred: number;
}> {
  const deadline = opts.deadline ?? createDeadline(opts.budgetMs ?? ENGAGEMENT_BUDGET.ingest);
  const concurrency = opts.concurrency ?? READ_CONCURRENCY;
  const postCap = Math.max(1, Math.min(opts.postLimit ?? INGEST_CAPS.posts, INGEST_CAPS.posts));
  const chatCap = Math.max(1, Math.min(opts.chatLimit ?? INGEST_CAPS.chats, INGEST_CAPS.chats));

  const creds = await requireUnipileCreds(client, workspaceId);
  const allAccounts = await syncedAccounts(client, workspaceId, creds);
  // Every account is recorded above (so Settings shows the truth); only the
  // first few are swept, so one workspace with a pathological number of linked
  // accounts cannot multiply the fan-out without limit.
  const accounts = allAccounts.slice(0, INGEST_CAPS.accounts);
  let accountsDeferred = allAccounts.length - accounts.length;
  let budgetExhausted = false;
  const errors: string[] = [];
  let inserted = 0;
  let skipped = 0;

  // Bounded dedup lookup (docs/bugs.md finding 19). This used to ask for 5000
  // rows with no `.order()` at all — PostgREST's own `max_rows = 1000`
  // (supabase/config.toml) capped it at 1000 anyway, and with no ordering
  // which 1000 came back was unspecified, so a workspace with more than 1000
  // engagement_items could non-deterministically "forget" it had already seen
  // an item and re-ingest or re-answer it. It does not need to remember every
  // item ever: only the Unipile calls above ever run (INGEST_CAPS bounds them
  // to a handful of recent posts/comments/chats per sweep), so nothing older
  // than the most recent activity can ever come back to be deduped against.
  // Ordering by `created_at` descending and asking for exactly the 1000 the
  // server will actually hand back makes that the real, deterministic bound
  // instead of an accidental one.
  const { data: existingRows } = await client
    .from("engagement_items")
    .select("external_id,status")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(1000);
  const existingStatus = new Map(
    ((existingRows ?? []) as { external_id: string; status: string }[]).map((r) => [
      r.external_id,
      r.status,
    ]),
  );
  const seen = new Set(existingStatus.keys());

  // Statuses that still surface in the inbox / auto-draft path. If we detect an
  // owner reply for one of these (sent here OR on LinkedIn directly), it gets
  // flipped to "replied" so the agent never drafts a second answer.
  const OPEN_STATUSES = new Set(["new", "needs_reply", "drafted", "awaiting_approval", "approved"]);
  const answeredExternalIds: string[] = [];

  const queue: Record<string, unknown>[] = [];

  for (const [accountIndex, account] of accounts.entries()) {
    // The budget is checked between units of work, never mid-request: an
    // already-issued call keeps its own 30s deadline.
    if (deadline.expired()) {
      budgetExhausted = true;
      accountsDeferred += accounts.length - accountIndex;
      break;
    }

    if (account.status && account.status !== "OK" && account.status !== "CONNECTED") {
      errors.push(`${account.name}: account status ${account.status}`);
      continue;
    }

    // 1. Comments on our own recent posts.
    try {
      const me = await getOwnProfile(creds, account.id);
      // The posts endpoint 422s ("invalid_recipient") when given the public
      // identifier; it wants the provider id. Verified against the live API.
      const identifier = me.id || me.publicIdentifier;
      if (identifier && !deadline.expired()) {
        const posts = (await listOwnPosts(creds, account.id, identifier, postCap))
          .filter((p) => p.id)
          .slice(0, postCap);

        // Parallel read #1: comments per post. Up to `postCap` independent GETs
        // that were previously issued one after another — the single biggest
        // chunk of the old serial chain. Each one keeps its own try/catch so a
        // failing post costs only itself, exactly as before.
        const commentsByPost = await mapWithConcurrency(posts, concurrency, async (post) => {
          if (deadline.expired()) {
            budgetExhausted = true;
            return null;
          }
          try {
            return await listPostComments(
              creds,
              account.id,
              post.id,
              INGEST_CAPS.commentsPerPost,
              me.id,
            );
          } catch (e) {
            errors.push(`comments on ${post.id}: ${e instanceof Error ? e.message : e}`);
            return null;
          }
        });

        // Parallel read #2: "did we already answer this?" per comment that has
        // replies. Worst case this was 300 sequential calls on its own.
        //
        // Gathered up front into a map, then consumed by the unchanged
        // sequential loop below, so the order rows are queued in — and every
        // decision about what to insert — stays exactly what it was.
        const needsCheck: Array<{ postId: string; commentId: string }> = [];
        // One check per comment id, however many posts it turns up under: the
        // answer depends only on the comment, and an account that echoed the
        // same comment across every post would otherwise multiply the calls.
        const queuedCheck = new Set<string>();
        for (const [i, post] of posts.entries()) {
          for (const c of commentsByPost[i] ?? []) {
            if (!c.id || c.isOwn || !c.text.trim()) continue;
            const existing = existingStatus.get(`comment:${c.id}`);
            // Only worth a call for an unseen comment or one still open in the
            // inbox; terminal items are left alone.
            if (c.replyCounter > 0 && (existing === undefined || OPEN_STATUSES.has(existing))) {
              if (queuedCheck.has(c.id)) continue;
              queuedCheck.add(c.id);
              needsCheck.push({ postId: post.id, commentId: c.id });
            }
          }
        }
        // Comments whose check actually ran — succeeding OR failing. A check
        // that was skipped because the budget ran out is NOT in here, and the
        // loop below refuses to queue such a comment: treating "not checked" as
        // "not answered" would resurface a comment we have already replied to
        // and let the agent answer it twice. Leaving it for the next sweep is
        // the safe direction.
        const checked = new Set<string>();
        const ownAnswered = new Set<string>();
        await mapWithConcurrency(needsCheck, concurrency, async (check) => {
          if (deadline.expired()) {
            budgetExhausted = true;
            return;
          }
          checked.add(check.commentId);
          try {
            if (
              await ownRepliedToComment(
                creds,
                account.id,
                check.postId,
                check.commentId,
                me.id ?? "",
              )
            ) {
              ownAnswered.add(check.commentId);
            }
          } catch (e) {
            // Same as before: a failed check means "assume not answered", so
            // the comment still surfaces rather than being silently dropped.
            errors.push(`replies on ${check.commentId}: ${e instanceof Error ? e.message : e}`);
          }
        });

        for (const [i, post] of posts.entries()) {
          const comments = commentsByPost[i];
          if (!comments) continue;
          for (const c of comments) {
            if (!c.id || c.isOwn || !c.text.trim()) continue;
            const externalId = `comment:${c.id}`;
            const existing = existingStatus.get(externalId);

            if (c.replyCounter > 0 && (existing === undefined || OPEN_STATUSES.has(existing))) {
              if (!checked.has(c.id)) {
                // Budget ran out before we could tell whether we had already
                // replied. Skip it entirely — next sweep will check.
                budgetExhausted = true;
                continue;
              }
              const mine = ownAnswered.has(c.id);
              if (mine) {
                if (existing === undefined) {
                  // Never surfaced it and it's already answered — record it as
                  // handled so it stays out of the inbox and out of drafting.
                  seen.add(externalId);
                  queue.push({
                    workspace_id: workspaceId,
                    provider: "unipile",
                    external_account_id: account.id,
                    network: account.type,
                    kind: "comment",
                    external_id: externalId,
                    thread_id: post.id,
                    post_id: post.id,
                    post_excerpt: cut(post.text, 240),
                    permalink: post.url,
                    author_name: c.authorName || "Someone",
                    author_handle: c.authorId,
                    author_url: c.authorUrl,
                    author_avatar_url: c.authorAvatarUrl,
                    text: cut(c.text, 4000),
                    occurred_at: c.createdAt,
                    status: "replied",
                  });
                } else {
                  // Already in the inbox and open — reconcile it to replied.
                  answeredExternalIds.push(externalId);
                }
                continue;
              }
            }

            if (seen.has(externalId)) {
              skipped++;
              continue;
            }
            seen.add(externalId);
            queue.push({
              workspace_id: workspaceId,
              provider: "unipile",
              external_account_id: account.id,
              network: account.type,
              kind: "comment",
              external_id: externalId,
              thread_id: post.id,
              post_id: post.id,
              post_excerpt: cut(post.text, 240),
              permalink: post.url,
              author_name: c.authorName || "Someone",
              author_handle: c.authorId,
              author_url: c.authorUrl,
              author_avatar_url: c.authorAvatarUrl,
              text: cut(c.text, 4000),
              occurred_at: c.createdAt,
              status: "new",
            });
          }
        }
      }
    } catch (e) {
      errors.push(`${account.name} posts: ${e instanceof Error ? e.message : e}`);
    }

    // 2. Direct messages.
    if (deadline.expired()) {
      budgetExhausted = true;
      accountsDeferred += accounts.length - accountIndex - 1;
      break;
    }
    try {
      const chats = (await listChats(creds, account.id, chatCap))
        .filter((c) => c.id)
        .slice(0, chatCap);

      // Parallel read #3: the message list per chat. Independent GETs.
      const messagesByChat = await mapWithConcurrency(chats, concurrency, async (chat) => {
        if (deadline.expired()) {
          budgetExhausted = true;
          return null;
        }
        try {
          return await listChatMessages(creds, chat.id, INGEST_CAPS.messagesPerChat);
        } catch (e) {
          errors.push(`chat ${chat.id}: ${e instanceof Error ? e.message : e}`);
          return null;
        }
      });

      // Deciding which chats yield a new item mutates `seen` and `skipped`, so
      // it stays sequential and in chat order — identical to the old loop.
      type PendingChat = {
        chat: (typeof chats)[number];
        messages: NonNullable<(typeof messagesByChat)[number]>;
        latest: NonNullable<(typeof messagesByChat)[number]>[number];
        externalId: string;
      };
      const pending: PendingChat[] = [];
      for (const [i, chat] of chats.entries()) {
        const messages = messagesByChat[i];
        if (!messages) continue;
        const incoming = messages.filter((m) => !m.isSender && m.text.trim());
        const latest = incoming[0] ?? null;
        if (!latest) continue;
        const externalId = `dm:${latest.id}`;
        if (seen.has(externalId)) {
          skipped++;
          continue;
        }
        seen.add(externalId);
        pending.push({ chat, messages, latest, externalId });
      }

      // Parallel read #4: attendees, but only for the chats that actually
      // produced a new item — the old code paid this call for every such chat
      // one at a time. Messages only carry a sender_id; the human-readable
      // identity comes from here. Best effort: a miss (or a budget stop) keeps
      // the fallback name, it never drops the message.
      const authors = await mapWithConcurrency(pending, concurrency, async (p) => {
        if (deadline.expired()) {
          budgetExhausted = true;
          return null;
        }
        try {
          const attendees = await listChatAttendees(creds, p.chat.id);
          return (
            attendees.find((a) => !a.isSelf && a.providerId === p.latest.senderId) ??
            attendees.find((a) => !a.isSelf) ??
            null
          );
        } catch {
          return null;
        }
      });

      for (const [i, { chat, messages, latest, externalId }] of pending.entries()) {
        const author = authors[i] ?? null;
        queue.push({
          workspace_id: workspaceId,
          provider: "unipile",
          external_account_id: account.id,
          network: account.type,
          kind: "dm",
          external_id: externalId,
          thread_id: chat.id,
          post_id: null,
          post_excerpt: messages
            .slice(0, 4)
            .reverse()
            .map((m) => `${m.isSender ? "us" : "them"}: ${cut(m.text, 120)}`)
            .join("\n"),
          permalink: null,
          author_name: author?.name || latest.senderName || chat.name || "Someone",
          author_handle: latest.senderId,
          author_url: author?.profileUrl ?? null,
          author_avatar_url: author?.pictureUrl ?? null,
          text: cut(latest.text, 4000),
          occurred_at: latest.createdAt ?? chat.lastAt,
          status: "new",
        });
      }
    } catch (e) {
      errors.push(`${account.name} chats: ${e instanceof Error ? e.message : e}`);
    }
  }

  if (queue.length) {
    const { data, error } = await client
      .from("engagement_items")
      .upsert(queue, { onConflict: "workspace_id,provider,external_id", ignoreDuplicates: true })
      .select("id");
    if (error) {
      // A batch insert is all-or-nothing: one malformed row rejects every row.
      // Retry one by one so a single bad item costs itself, not the whole sync.
      for (const row of queue) {
        const one = await client
          .from("engagement_items")
          .upsert([row], {
            onConflict: "workspace_id,provider,external_id",
            ignoreDuplicates: true,
          })
          .select("id");
        if (one.error) errors.push(`${row.external_id}: ${one.error.message}`);
        else inserted += ((one.data ?? []) as unknown[]).length;
      }
    } else {
      inserted = ((data ?? []) as unknown[]).length;
    }
  }

  // Reconcile inbox items we already answered on LinkedIn directly: flip any
  // still-open item to "replied" so it stops surfacing and can't be answered
  // twice. Only touches open statuses — sent/escalated/ignored are left as-is.
  let reconciled = 0;
  if (answeredExternalIds.length) {
    const { data: recData, error: recErr } = await client
      .from("engagement_items")
      .update({ status: "replied", updated_at: new Date().toISOString() })
      .eq("workspace_id", workspaceId)
      .in("external_id", answeredExternalIds)
      .in("status", ["new", "needs_reply", "drafted", "awaiting_approval", "approved"])
      .select("id");
    if (recErr) errors.push(`reconcile answered: ${recErr.message}`);
    else reconciled = ((recData ?? []) as unknown[]).length;
  }

  await client
    .from("engagement_accounts")
    .update({ last_synced_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId);

  if (budgetExhausted) {
    // Surfaced through `errors` because that is the channel the inbox already
    // shows the user. Saying "some of it" out loud is the whole point: a sweep
    // that quietly returned half an inbox would look like a quiet inbox.
    errors.unshift(
      `Inbox sync ran out of its ${Math.round(ENGAGEMENT_BUDGET.ingest / 1000)}s time budget and stopped early` +
        (accountsDeferred > 0 ? ` (${accountsDeferred} account(s) not reached)` : "") +
        ". What it did read has been saved; the rest is picked up on the next sync.",
    );
  }

  return {
    accounts: accounts.length,
    inserted,
    skipped,
    reconciled,
    errors: errors.slice(0, 10),
    budgetExhausted,
    accountsDeferred,
  };
}

// ------------------------------------------------------------ brand context

async function brandBlock(client: Client, workspaceId: string): Promise<string> {
  const [{ data: profile }, { data: guide }] = await Promise.all([
    client.from("brand_profile").select("*").eq("workspace_id", workspaceId).maybeSingle(),
    client.from("brand_guideline").select("*").eq("workspace_id", workspaceId).maybeSingle(),
  ]);
  const p = (profile ?? {}) as Record<string, unknown>;
  const g = (guide ?? {}) as Record<string, unknown>;
  return [
    p.name ? `Brand: ${p.name} — ${p.industry ?? ""}` : "",
    p.audience ? `Audience: ${p.audience}` : "",
    p.products_services ? `Offer: ${String(p.products_services).slice(0, 400)}` : "",
    g.tone_of_voice ? `Tone: ${g.tone_of_voice}` : "",
    g.writing_style ? `Style: ${String(g.writing_style).slice(0, 300)}` : "",
    g.custom_instructions ? `Rules: ${String(g.custom_instructions).slice(0, 400)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

// ------------------------------------------------------------ classification

const ClassifySchema = z.object({
  sentiment: z.enum(["positive", "neutral", "negative"]),
  intent: z.enum(["praise", "question", "support", "opportunity", "spam", "other"]),
  urgency: z.enum(["low", "normal", "high"]),
  shouldReply: z.boolean(),
  reason: z.string(),
});

export async function classifyItems(
  client: Client,
  workspaceId: string,
  items: ItemRow[],
  deadline?: Deadline,
): Promise<number> {
  if (!items.length) return 0;
  const brand = await brandBlock(client, workspaceId);
  const { model, modelId } = await resolveChatModel(client as never, workspaceId);
  let done = 0;

  for (const item of items) {
    // Model calls, one per item, and a slow provider makes this loop as
    // unbounded as the network fan-out was. An item left unclassified keeps
    // intent = null, which is exactly what the next sweep selects on, so
    // stopping here loses nothing but time.
    if (deadline?.expired()) break;
    // Null means "classification failed" — the item still surfaces for a human,
    // but is stamped so it can never slip into the autonomous send path.
    let c: z.infer<typeof ClassifySchema> | null = null;
    try {
      const started = Date.now();
      const result = await generateText({
        model,
        maxOutputTokens: 300,
        system:
          "You triage inbound social media engagement for a brand, like an experienced community manager. " +
          "Classify one message. Be strict: complaints, refunds, bugs and anything a customer is unhappy about are 'support'. " +
          "Sales interest, partnership, press, podcast or speaking requests are 'opportunity'. " +
          "Promotional spam, crypto, or generic bot comments are 'spam' and never deserve a reply.\n\n" +
          (brand ? `BRAND CONTEXT:\n${brand}` : ""),
        prompt:
          `Channel: ${item.network} (${item.kind})\n` +
          (item.post_excerpt ? `Context:\n${item.post_excerpt}\n` : "") +
          `From: ${item.author_name}\nMessage: ${item.text}`,
        output: Output.object({ schema: ClassifySchema }),
      });
      void logAiUsage(client as never, {
        workspaceId,
        model: modelId,
        operation: "engagement.classify",
        usage: result.usage,
        actorType: "agent",
        durationMs: Date.now() - started,
      });

      // In ai@6 `result.output` is a throwing getter whenever the model did not
      // finish cleanly, so a truncated answer must be caught here — never
      // destructured — or one bad item would abort the whole batch.
      if (result.finishReason === "length") {
        console.warn("[engagement] classification truncated at maxOutputTokens for item", item.id);
      } else {
        c = result.output;
      }
    } catch (e) {
      if (NoObjectGeneratedError.isInstance(e)) {
        console.warn(
          "[engagement] classification returned malformed output",
          e.text?.slice(0, 200),
        );
      } else {
        console.warn("[engagement] classify failed", e instanceof Error ? e.message : e);
      }
    }

    if (!c) {
      // A failed classification must not look like a clean "other" (small talk
      // is auto-send safe under some policies): stamp classification.failed so
      // isSafeToAutoSend refuses it, and set intent so the sweep won't loop on
      // re-classifying the same item forever.
      await client
        .from("engagement_items")
        .update({ intent: "other", classification: { failed: true }, status: "needs_reply" })
        .eq("id", item.id);
      continue;
    }

    await client
      .from("engagement_items")
      .update({
        sentiment: c.sentiment,
        intent: c.intent,
        urgency: c.urgency,
        should_reply: c.shouldReply,
        classification: { reason: c.reason.slice(0, 400) },
        status: c.intent === "spam" || !c.shouldReply ? "ignored" : "needs_reply",
      })
      .eq("id", item.id);
    done++;
    await alertForItem(client, workspaceId, { ...item, ...toRowPatch(c) });
  }
  return done;
}

function toRowPatch(c: z.infer<typeof ClassifySchema>): Partial<ItemRow> {
  return {
    sentiment: c.sentiment,
    intent: c.intent,
    urgency: c.urgency,
    should_reply: c.shouldReply,
  };
}

async function alertForItem(client: Client, workspaceId: string, item: Partial<ItemRow>) {
  const who = item.author_name || "Someone";
  const excerpt = cut(item.text ?? "", 220);
  if (item.kind === "dm") {
    await notify(client, workspaceId, "dm", {
      title: `New DM from ${who}`,
      body: excerpt,
      url: "/inbox",
    });
    return;
  }
  if (item.sentiment === "negative") {
    await notify(client, workspaceId, "negative", {
      title: `Negative ${item.kind} from ${who}`,
      body: excerpt,
      url: "/inbox",
    });
  }
  if (item.intent === "opportunity") {
    await notify(client, workspaceId, "opportunity", {
      title: `Opportunity spotted — ${who}`,
      body: excerpt,
      url: "/inbox",
    });
  }
  if (item.intent === "support") {
    await notify(client, workspaceId, "support", {
      title: `Support issue from ${who}`,
      body: excerpt,
      url: "/inbox",
    });
  }
}

// ------------------------------------------------------------------ drafting

export async function draftReplyText(
  client: Client,
  workspaceId: string,
  item: ItemRow,
  angle?: string,
): Promise<string> {
  const [brand, brain, rules] = await Promise.all([
    brandBlock(client, workspaceId),
    loadBrandBrain(client as never, workspaceId).catch(() => ""),
    playbookBlock(client as never, workspaceId, ["engagement"]),
  ]);
  const { model, modelId } = await resolveChatModel(client as never, workspaceId);
  const started = Date.now();
  const { text, usage } = await generateText({
    model,
    maxOutputTokens: 400,
    system: [
      "You write replies to inbound social media engagement on behalf of a brand, in the brand's own voice.",
      "Reply as a thoughtful human would: acknowledge the person by first name when natural, add one specific thought, keep it short.",
      "Never invent facts, prices, dates or commitments. Never apologise for something you cannot verify.",
      "Output ONLY the reply text — no quotes, no preamble, no signature.",
      brand ? `BRAND CONTEXT:\n${brand}` : "",
      brain ? `WHAT WE HAVE LEARNED:\n${brain}` : "",
      rules,
    ]
      .filter(Boolean)
      .join("\n\n"),
    prompt:
      `Channel: ${item.network} (${item.kind}). Sentiment: ${item.sentiment ?? "unknown"}. Intent: ${item.intent ?? "unknown"}.\n` +
      (item.post_excerpt ? `Context:\n${item.post_excerpt}\n` : "") +
      `From ${item.author_name}: ${item.text}\n` +
      (angle ? `\nExtra instruction from the user: ${angle}` : "") +
      `\n\nWrite the reply (${item.kind === "dm" ? "up to 4 sentences" : "1-3 sentences"}).`,
  });
  void logAiUsage(client as never, {
    workspaceId,
    model: modelId,
    operation: "engagement.draft",
    usage,
    actorType: "agent",
    durationMs: Date.now() - started,
  });
  return text
    .trim()
    .replace(/^["“]|["”]$/g, "")
    .slice(0, 1200);
}

async function autonomousSentToday(client: Client, workspaceId: string): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data } = await client
    .from("engagement_replies")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("mode", "autonomous")
    // "sending" is a send that has been reserved but not yet confirmed. It
    // counts against the budget: the alternative is letting a concurrent sweep
    // spend the same slot. A send that ultimately fails is rewritten to
    // "failed" with sent_at cleared, so it drops back out of this count.
    .in("status", ["sent", "sending"])
    .gte("sent_at", since)
    .limit(200);
  return ((data ?? []) as unknown[]).length;
}

export function isSafeToAutoSend(item: ItemRow, policy: Policy): boolean {
  if (policy.mode !== "autonomous") return false;
  if (item.sentiment === "negative") return false;
  // Items whose classification failed carry intent "other" only as a
  // placeholder — a human must look at them, never the autonomous path.
  if (item.classification && (item.classification as Record<string, unknown>).failed) return false;
  const intent = (item.intent ?? "other") as EngagementIntent;
  // Spam is refused here explicitly rather than via ALWAYS_ESCALATE: that list
  // (defined in ./types, shared with the UI) means "a human must always
  // review this", which is not true of spam — spam gets no human review, it
  // is discarded. Today the only caller (handleItem) already short-circuits
  // spam to "ignored" before this gate runs, but this function must be safe
  // to call directly, so it cannot rely on that. If a workspace ever listed
  // "spam" in engagement_safe_categories, this still refuses it.
  if (intent === "spam") return false;
  if (ALWAYS_ESCALATE.includes(intent)) return false;
  return policy.safeCategories.includes(intent);
}

/**
 * Drafts a reply for an item and routes it according to the workspace policy:
 * draft only, approval queue, or autonomous send for safe categories.
 */
export async function handleItem(
  client: Client,
  workspaceId: string,
  item: ItemRow,
  policy: Policy,
): Promise<{ status: string; replyId: string | null }> {
  if (item.should_reply === false || item.intent === "spam") {
    await client.from("engagement_items").update({ status: "ignored" }).eq("id", item.id);
    return { status: "ignored", replyId: null };
  }

  const text = await draftReplyText(client, workspaceId, item);

  const auto = isSafeToAutoSend(item, policy);
  let mode: string = policy.mode;
  let status: string = "draft";

  if (auto) {
    const used = await autonomousSentToday(client, workspaceId);
    if (policy.dailyLimit > 0 && used >= policy.dailyLimit) {
      mode = "approval";
      status = "awaiting_approval";
    } else {
      mode = "autonomous";
      status = "approved";
    }
  } else if (policy.mode === "approval") {
    status = "awaiting_approval";
  }

  const { data: reply, error } = await client
    .from("engagement_replies")
    .insert({ workspace_id: workspaceId, item_id: item.id, text, mode, status })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  const replyId = (reply as { id: string }).id;

  if (status === "approved") {
    const sent = await sendReply(client, workspaceId, item.id, text, replyId, "autonomous");
    return { status: sent.ok ? "replied" : "escalated", replyId };
  }

  const itemStatus = status === "awaiting_approval" ? "awaiting_approval" : "drafted";
  await client.from("engagement_items").update({ status: itemStatus }).eq("id", item.id);

  if (status === "awaiting_approval") {
    await notify(client, workspaceId, "approval", {
      title: `Reply awaiting approval — ${item.author_name}`,
      body: `They said: "${cut(item.text, 160)}"\nDraft: "${cut(text, 200)}"`,
      url: "/inbox",
    });
  }
  return { status: itemStatus, replyId };
}

// ------------------------------------------------------------------- sending

export type SendReplyResult = { ok: boolean; error?: string; queued?: boolean; note?: string };

/**
 * Sends a reply through Unipile. This is the single choke point: it re-reads
 * the item, never trusts a client-supplied target, and enforces the workspace
 * reply policy itself — callers that did not get an explicit human go-ahead
 * (`opts.userConfirmed`) are queued for approval instead of sent when the
 * mode demands it, or when the autonomous daily budget is spent.
 */
export async function sendReply(
  client: Client,
  workspaceId: string,
  itemId: string,
  text: string,
  replyId?: string,
  mode: string = "manual",
  opts: { userConfirmed?: boolean } = {},
): Promise<SendReplyResult> {
  const { data } = await client
    .from("engagement_items")
    .select("*")
    .eq("id", itemId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const item = data as ItemRow | null;
  if (!item) return { ok: false, error: "Item not found." };

  const clean = text.trim();
  if (!clean) return { ok: false, error: "Reply is empty." };

  // A human pressing "send" overrides the policy gate — the gate exists to
  // stop unattended sends, not people.
  if (!opts.userConfirmed) {
    const policy = await loadPolicy(client, workspaceId);
    let queueNote: string | null = null;
    if (policy.mode === "draft" || policy.mode === "approval") {
      queueNote = `Reply mode is ${policy.mode} — queued for human approval, not sent.`;
    } else {
      const used = await autonomousSentToday(client, workspaceId);
      if (policy.dailyLimit > 0 && used >= policy.dailyLimit) {
        queueNote = `Daily autonomous reply limit (${policy.dailyLimit}) reached — queued for human approval, not sent.`;
      } else if (replyId) {
        // Reserve the budget slot now, before requireUnipileCreds and the
        // network round trip to Unipile below, instead of only counting this
        // send once it has already gone out. autonomousSentToday counts rows
        // with status='sent', so until this write lands a concurrent sweep
        // processing a *different* item for the same workspace would not see
        // this send in flight and could pass the same check. This does not
        // make the count atomic — two reservation writes can still both land
        // before either one's autonomousSentToday query reads the other back
        // — but it shrinks that window from "the whole send" (creds fetch +
        // the Unipile HTTP call) down to the gap between two DB round trips.
        // Reserved as "sending", never as "sent". Writing "sent" before the
        // reply has actually gone out would leave a permanent false "sent" (with
        // a timestamp) behind any hard crash in the next few lines — the exact
        // class of "reported something that did not happen" this audit exists to
        // remove, traded for a marginally smaller window on a soft budget
        // counter. A crash now leaves "sending", which is true and is visibly
        // not a completed send.
        //
        // If the send below fails, the final status write further down flips
        // this to "failed" (sent_at cleared), so a failed send never permanently
        // eats a budget slot.
        const { data: reservedRow } = await client
          .from("engagement_replies")
          .update({ status: "sending", sent_at: new Date().toISOString(), mode })
          .eq("id", replyId)
          .eq("status", "approved")
          .select("id")
          .maybeSingle();
        void reservedRow;
      }
    }
    if (queueNote) {
      if (replyId) {
        await client
          .from("engagement_replies")
          .update({ text: clean, status: "queued", mode })
          .eq("id", replyId);
      } else {
        await client.from("engagement_replies").insert({
          workspace_id: workspaceId,
          item_id: itemId,
          text: clean,
          mode,
          status: "queued",
        });
      }
      await client
        .from("engagement_items")
        .update({ status: "awaiting_approval" })
        .eq("id", itemId);
      await notify(client, workspaceId, "approval", {
        title: `Reply awaiting approval — ${item.author_name}`,
        body: `They said: "${cut(item.text, 160)}"\nDraft: "${cut(clean, 200)}"`,
        url: "/inbox",
      });
      return { ok: true, queued: true, note: queueNote };
    }
  }

  let error: string | null = null;
  let externalId: string | null = null;
  try {
    const creds = await requireUnipileCreds(client, workspaceId);
    if (item.kind === "dm") {
      if (!item.thread_id) throw new Error("This conversation has no chat id.");
      const res = await sendChatMessage(creds, item.thread_id, clean);
      externalId = res.id;
    } else {
      if (!item.post_id) throw new Error("This comment has no parent post id.");
      const commentId = item.external_id.startsWith("comment:")
        ? item.external_id.slice("comment:".length)
        : undefined;
      const res = await replyToComment(
        creds,
        item.external_account_id,
        item.post_id,
        clean,
        commentId,
      );
      externalId = res.id;
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const now = new Date().toISOString();
  if (replyId) {
    await client
      .from("engagement_replies")
      .update({
        text: clean,
        status: error ? "failed" : "sent",
        sent_at: error ? null : now,
        external_id: externalId,
        error,
        mode,
      })
      .eq("id", replyId);
  } else {
    await client.from("engagement_replies").insert({
      workspace_id: workspaceId,
      item_id: itemId,
      text: clean,
      mode,
      status: error ? "failed" : "sent",
      sent_at: error ? null : now,
      external_id: externalId,
      error,
    });
  }

  await client
    .from("engagement_items")
    .update({ status: error ? "escalated" : "replied" })
    .eq("id", itemId);

  await logActivity(
    {
      workspaceId,
      actorType: mode === "manual" ? "user" : "agent",
      action: error ? "engagement.reply_failed" : "engagement.replied",
      summary: error
        ? `Reply to ${item.author_name} failed: ${error.slice(0, 120)}`
        : `Replied to ${item.author_name} on ${item.network}`,
      status: error ? "error" : "ok",
      error,
      details: { kind: item.kind, mode },
      relatedType: "engagement_item",
      relatedId: itemId,
    },
    client as never,
  );

  if (error) {
    await notify(client, workspaceId, "failure", {
      title: "Could not send a reply",
      body: error.slice(0, 300),
      url: "/inbox",
    });
  }
  return error ? { ok: false, error } : { ok: true };
}

export async function likeItem(
  client: Client,
  workspaceId: string,
  itemId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { data } = await client
    .from("engagement_items")
    .select("*")
    .eq("id", itemId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const item = data as ItemRow | null;
  if (!item) return { ok: false, error: "Item not found." };
  if (item.kind === "dm" || !item.post_id)
    return { ok: false, error: "Only comments can be liked." };
  try {
    const creds = await requireUnipileCreds(client, workspaceId);
    const commentId = item.external_id.startsWith("comment:")
      ? item.external_id.slice("comment:".length)
      : undefined;
    await reactToPost(creds, item.external_account_id, item.post_id, commentId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not like." };
  }
}

// -------------------------------------------------------------- orchestration

/**
 * Atomically claims up to `limit` items still waiting on a reply, so two
 * overlapping sweeps (a webhook burst, the heartbeat, and a manual "Sync now"
 * all reach this workspace) can never both draft or send for the same item.
 *
 * Claimed items move to "approved" rather than staying in "needs_reply".
 * That value is not a schema addition and is not new to this file: the
 * reconciliation pass above (`OPEN_STATUSES`) already treats it as an open,
 * in-progress item, so a comment answered directly on LinkedIn while an item
 * is claimed still reconciles to "replied" correctly. Nothing else in the app
 * writes "approved" onto an engagement_items row today, so repurposing it as
 * the in-flight marker cannot collide with another meaning.
 *
 * This is still a select then an update — two round trips — but the claim
 * itself is the UPDATE's own `.eq("status", "needs_reply")`. Postgres checks
 * that predicate per row at write time under the row's lock, so once one
 * sweep's UPDATE has committed for a row, a second sweep's UPDATE for the
 * same id matches zero rows, however much the two SELECTs overlapped. Only
 * rows this call's UPDATE actually flipped are returned and processed.
 *
 * Known gap: if the process crashes (not throws — a thrown error inside the
 * caller's loop is caught and the item is handed back to "needs_reply", see
 * runEngagementSweep) after claiming an item but before finishing it, that
 * item stays "approved" forever with nothing to reclaim it. Doing that safely
 * would need either a claim timestamp column (a schema change, out of scope
 * here) or an OR-filter over the existing `updated_at`, which was left out
 * rather than shipped untested against a real Postgres instance.
 */
export async function claimNeedsReplyItems(
  client: Client,
  workspaceId: string,
  limit = 15,
): Promise<ItemRow[]> {
  const { data: candidates } = await client
    .from("engagement_items")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("status", "needs_reply")
    .order("occurred_at", { ascending: false })
    .limit(limit);
  const ids = ((candidates ?? []) as { id: string }[]).map((r) => r.id);
  if (!ids.length) return [];

  const { data: claimed } = await client
    .from("engagement_items")
    .update({ status: "approved" })
    .eq("workspace_id", workspaceId)
    .eq("status", "needs_reply")
    .in("id", ids)
    .select("*");
  return (claimed ?? []) as ItemRow[];
}

/**
 * Hands a set of claimed items back to "needs_reply" in one round trip.
 *
 * Conditioned on the row still being "approved" so a status some other step
 * already moved on to is never clobbered — the same guard the per-item error
 * path uses.
 */
export async function releaseClaims(
  client: Client,
  workspaceId: string,
  ids: string[],
): Promise<number> {
  if (!ids.length) return 0;
  const { data } = await client
    .from("engagement_items")
    .update({ status: "needs_reply" })
    .eq("workspace_id", workspaceId)
    .eq("status", "approved")
    .in("id", ids)
    .select("id");
  return ((data ?? []) as unknown[]).length;
}

/**
 * Full sweep: ingest, classify, then draft/route according to policy.
 *
 * The whole thing runs inside one wall-clock budget (docs/bugs.md finding 10).
 * Each of the three stages checks it before starting its next unit of work, so
 * a slow Unipile or a slow model provider costs the sweep time but cannot make
 * it run indefinitely — which is what let a tick outlive the 300s its caller
 * waits and made the duplicate-run bug (finding 4) reachable.
 *
 * Nothing is left stranded when the budget runs out. Items claimed by
 * `claimNeedsReplyItems` but not reached are released back to "needs_reply"
 * before returning, exactly as if `handleItem` had thrown on them; without
 * that they would sit at "approved" with nothing to reclaim them, which is the
 * one way an atomic claim can lose an item. Un-ingested comments and DMs were
 * never written, and unclassified items still have intent = null — both are
 * precisely what the next sweep selects on.
 */
export async function runEngagementSweep(
  client: Client,
  workspaceId: string,
  opts: { autoDraft?: boolean; autoSend?: boolean; budgetMs?: number } = {},
): Promise<{
  inserted: number;
  reconciled: number;
  classified: number;
  handled: number;
  errors: string[];
  /** True when a stage stopped early because the budget was spent. */
  budgetExhausted: boolean;
  /** Claimed items handed back to "needs_reply" instead of being processed. */
  released: number;
}> {
  const budgetMs = opts.budgetMs ?? ENGAGEMENT_BUDGET.sweep;
  const sweepDeadline = createDeadline(budgetMs);

  // Ingest gets its own, smaller budget so the network fan-out cannot eat the
  // whole sweep and starve classification and drafting — but never more than
  // the sweep has left.
  const ingest = await ingestEngagement(client, workspaceId, {
    deadline: tighterOf(
      sweepDeadline,
      createDeadline(Math.min(ENGAGEMENT_BUDGET.ingest, budgetMs)),
    ),
  });
  let budgetExhausted = ingest.budgetExhausted;

  const { data: fresh } = await client
    .from("engagement_items")
    .select("*")
    .eq("workspace_id", workspaceId)
    .is("intent", null)
    .order("occurred_at", { ascending: false })
    .limit(25);
  const freshItems = (fresh ?? []) as ItemRow[];
  const classified = await classifyItems(client, workspaceId, freshItems, sweepDeadline);
  if (classified < freshItems.length && sweepDeadline.expired()) budgetExhausted = true;

  let handled = 0;
  let released = 0;
  if (opts.autoDraft !== false) {
    const loaded = await loadPolicy(client, workspaceId);
    // autoSend:false lets unattended callers (the heartbeat) triage and draft
    // without ever taking the autonomous send branch, whatever the workspace
    // policy says — downgrade autonomous to draft for this sweep only.
    const policy: Policy =
      opts.autoSend === false && loaded.mode === "autonomous"
        ? { ...loaded, mode: "draft" }
        : loaded;
    const claimed = await claimNeedsReplyItems(client, workspaceId, 15);
    for (const [i, item] of claimed.entries()) {
      // Checked before drafting, never mid-send: a reply already handed to
      // Unipile is allowed to finish under its own 30s deadline. Stopping
      // between items is the only point at which nothing is half-done.
      if (sweepDeadline.expired()) {
        budgetExhausted = true;
        released = await releaseClaims(
          client,
          workspaceId,
          claimed.slice(i).map((r) => r.id),
        );
        break;
      }
      try {
        await handleItem(client, workspaceId, item, policy);
        handled++;
      } catch (e) {
        ingest.errors.push(e instanceof Error ? e.message : String(e));
        // handleItem threw before it could route the item anywhere durable —
        // hand the claim back so the next sweep retries it, matching the
        // pre-claim behaviour where a thrown error simply left the row at
        // "needs_reply". Conditioned on "approved" so we never clobber a
        // status some other step already moved on to.
        await client
          .from("engagement_items")
          .update({ status: "needs_reply" })
          .eq("id", item.id)
          .eq("status", "approved");
      }
    }
  }

  const errors = ingest.errors;
  if (budgetExhausted && !ingest.budgetExhausted) {
    errors.unshift(
      `Inbox sweep ran out of its ${Math.round(budgetMs / 1000)}s time budget and stopped early` +
        (released > 0 ? ` (${released} item(s) returned to the queue)` : "") +
        ". Everything it finished has been saved; the rest is picked up on the next run.",
    );
  }

  return {
    inserted: ingest.inserted,
    reconciled: ingest.reconciled,
    classified,
    handled,
    errors,
    budgetExhausted,
    released,
  };
}

/** Compact inbox state for the heartbeat / chat prompt. */
export async function loadInboxDigest(client: Client, workspaceId: string): Promise<string> {
  try {
    const { data } = await client
      .from("engagement_items")
      .select("kind,network,author_name,text,sentiment,intent,status")
      .eq("workspace_id", workspaceId)
      .in("status", ["needs_reply", "drafted", "awaiting_approval", "escalated"])
      .order("occurred_at", { ascending: false })
      .limit(12);
    const rows = (data ?? []) as Array<Record<string, string>>;
    if (!rows.length) return "";
    const lines = rows.map(
      (r) =>
        `- [${r.network}/${r.kind}] ${r.author_name} (${r.sentiment ?? "?"}, ${r.intent ?? "?"}, ${r.status}): "${(r.text ?? "").slice(0, 120)}"`,
    );
    return `${rows.length} item(s) waiting in the engagement inbox:\n${lines.join("\n")}`;
  } catch {
    return "";
  }
}
