// Server functions for the Engagement Inbox. Thin wrappers only — all logic
// lives in engagement.server.ts / unipile.server.ts.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type {
  EngagementAccountPublic,
  EngagementItemPublic,
  EngagementIntent,
  ReplyMode,
} from "./types";

const wsInput = z.object({ workspaceId: z.string().uuid() });

export type EngagementConfig = {
  connected: boolean;
  dsn: string | null;
  accounts: EngagementAccountPublic[];
  policy: { mode: ReplyMode; safeCategories: EngagementIntent[]; dailyLimit: number };
};

type AccountRow = {
  id: string;
  external_account_id: string;
  network: string;
  name: string;
  status: string;
  last_synced_at: string | null;
};

const toAccount = (r: AccountRow): EngagementAccountPublic => ({
  id: r.id,
  externalAccountId: r.external_account_id,
  network: r.network,
  name: r.name,
  status: r.status,
  lastSyncedAt: r.last_synced_at,
});

export const getEngagementConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => wsInput.parse(d))
  .handler(async ({ data, context }): Promise<EngagementConfig> => {
    const supabase = context.supabase as any;
    const { loadPolicy } = await import("./engagement.server");
    const [{ data: cred }, { data: accounts }, policy] = await Promise.all([
      supabase
        .from("service_credentials")
        .select("label")
        .eq("workspace_id", data.workspaceId)
        .eq("service", "unipile")
        .maybeSingle(),
      supabase
        .from("engagement_accounts")
        .select("id,external_account_id,network,name,status,last_synced_at")
        .eq("workspace_id", data.workspaceId)
        .order("created_at", { ascending: true }),
      loadPolicy(supabase, data.workspaceId),
    ]);
    return {
      connected: !!cred,
      dsn: (cred as { label?: string } | null)?.label ?? null,
      accounts: ((accounts ?? []) as AccountRow[]).map(toAccount),
      policy,
    };
  });

export const saveUnipileCredentials = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        workspaceId: z.string().uuid(),
        apiKey: z.string().min(8).max(500),
        dsn: z.string().min(4).max(200),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ ok: boolean; error?: string }> => {
    const supabase = context.supabase as any;
    const { writeProviderKey } = await import("../crypto.server");
    const { normalizeDsn, listAccounts } = await import("./unipile.server");
    const dsn = normalizeDsn(data.dsn);

    try {
      await listAccounts({ dsn, apiKey: data.apiKey });
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message.slice(0, 200) : "Could not reach Unipile.",
      };
    }

    const keyCols = await writeProviderKey(data.apiKey);
    await supabase
      .from("service_credentials")
      .delete()
      .eq("workspace_id", data.workspaceId)
      .eq("service", "unipile");
    const { error } = await supabase.from("service_credentials").insert({
      workspace_id: data.workspaceId,
      service: "unipile",
      label: dsn,
      ...keyCols,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const disconnectUnipile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => wsInput.parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const supabase = context.supabase as any;
    await supabase
      .from("service_credentials")
      .delete()
      .eq("workspace_id", data.workspaceId)
      .eq("service", "unipile");
    await supabase.from("engagement_accounts").delete().eq("workspace_id", data.workspaceId);
    return { ok: true };
  });

export const createUnipileLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ workspaceId: z.string().uuid(), origin: z.string().url() }).parse(d),
  )
  .handler(async ({ data, context }): Promise<{ url: string }> => {
    const supabase = context.supabase as any;
    const { requireUnipileCreds, createHostedAuthLink } = await import("./unipile.server");
    const creds = await requireUnipileCreds(supabase, data.workspaceId);
    const url = await createHostedAuthLink(creds, {
      name: data.workspaceId,
      successRedirectUrl: `${data.origin}/inbox?linked=1`,
      failureRedirectUrl: `${data.origin}/inbox?linked=0`,
    });
    return { url };
  });

export const refreshEngagementAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => wsInput.parse(d))
  .handler(async ({ data, context }): Promise<{ accounts: EngagementAccountPublic[] }> => {
    const supabase = context.supabase as any;
    const { requireUnipileCreds, listAccounts } = await import("./unipile.server");
    const creds = await requireUnipileCreds(supabase, data.workspaceId);
    const remote = await listAccounts(creds);
    const keep = new Set(remote.map((a) => a.id));
    for (const a of remote) {
      await supabase.from("engagement_accounts").upsert(
        {
          workspace_id: data.workspaceId,
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
    const { data: rows } = await supabase
      .from("engagement_accounts")
      .select("id,external_account_id,network,name,status,last_synced_at")
      .eq("workspace_id", data.workspaceId);
    const all = (rows ?? []) as AccountRow[];
    const stale = all.filter((r) => !keep.has(r.external_account_id));
    if (stale.length) {
      await supabase
        .from("engagement_accounts")
        .delete()
        .in(
          "id",
          stale.map((r) => r.id),
        );
    }
    return { accounts: all.filter((r) => keep.has(r.external_account_id)).map(toAccount) };
  });

export const removeEngagementAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ workspaceId: z.string().uuid(), accountId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }): Promise<{ ok: boolean; error?: string }> => {
    const supabase = context.supabase as any;
    const { data: row } = await supabase
      .from("engagement_accounts")
      .select("external_account_id")
      .eq("id", data.accountId)
      .eq("workspace_id", data.workspaceId)
      .maybeSingle();
    if (!row) return { ok: false, error: "Account not found." };
    try {
      const { requireUnipileCreds, deleteAccount } = await import("./unipile.server");
      const creds = await requireUnipileCreds(supabase, data.workspaceId);
      await deleteAccount(creds, (row as { external_account_id: string }).external_account_id);
    } catch (e) {
      console.warn("[engagement] remote account delete failed", e instanceof Error ? e.message : e);
    }
    await supabase.from("engagement_accounts").delete().eq("id", data.accountId);
    return { ok: true };
  });

export const saveEngagementPolicy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        workspaceId: z.string().uuid(),
        mode: z.enum(["draft", "approval", "autonomous"]),
        safeCategories: z.array(
          z.enum(["praise", "question", "support", "opportunity", "spam", "other"]),
        ),
        dailyLimit: z.number().int().min(0).max(200),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await (context.supabase as any)
      .from("workspaces")
      .update({
        engagement_reply_mode: data.mode,
        // Never allow the always-escalate categories through, whatever the client sends.
        engagement_safe_categories: data.safeCategories.filter(
          (c) => c === "praise" || c === "question" || c === "other",
        ),
        engagement_daily_limit: data.dailyLimit,
      })
      .eq("id", data.workspaceId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// -------------------------------------------------------------------- inbox

type ItemRowDb = Record<string, any>;

function toItem(r: ItemRowDb, draft: ItemRowDb | null): EngagementItemPublic {
  return {
    id: r.id,
    kind: r.kind,
    network: r.network,
    accountId: r.external_account_id,
    externalId: r.external_id,
    threadId: r.thread_id,
    postId: r.post_id,
    postExcerpt: r.post_excerpt,
    permalink: r.permalink,
    authorName: r.author_name,
    authorHandle: r.author_handle,
    authorUrl: r.author_url,
    authorAvatarUrl: r.author_avatar_url,
    text: r.text,
    occurredAt: r.occurred_at,
    sentiment: r.sentiment,
    intent: r.intent,
    urgency: r.urgency,
    shouldReply: r.should_reply,
    reason: (r.classification?.reason as string) ?? null,
    status: r.status,
    draft: draft
      ? { id: draft.id, text: draft.text, status: draft.status, error: draft.error ?? null }
      : null,
    createdAt: r.created_at,
  };
}

export const listEngagementItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        workspaceId: z.string().uuid(),
        filter: z.enum(["all", "needs_reply", "escalated", "done"]).default("all"),
        kind: z.enum(["all", "comment", "mention", "dm"]).default("all"),
        limit: z.number().int().min(1).max(200).default(60),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ items: EngagementItemPublic[] }> => {
    const supabase = context.supabase as any;
    let q = supabase
      .from("engagement_items")
      .select("*")
      .eq("workspace_id", data.workspaceId)
      .order("occurred_at", { ascending: false, nullsFirst: false })
      .limit(data.limit);
    if (data.filter === "needs_reply")
      q = q.in("status", ["new", "needs_reply", "drafted", "awaiting_approval"]);
    if (data.filter === "escalated") q = q.eq("status", "escalated");
    if (data.filter === "done") q = q.in("status", ["replied", "done", "ignored"]);
    if (data.kind !== "all") q = q.eq("kind", data.kind);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    const items = (rows ?? []) as ItemRowDb[];
    if (!items.length) return { items: [] };

    const { data: replies } = await supabase
      .from("engagement_replies")
      .select("id,item_id,text,status,error,created_at")
      .eq("workspace_id", data.workspaceId)
      .in(
        "item_id",
        items.map((r) => r.id),
      )
      .order("created_at", { ascending: false });
    const latest = new Map<string, ItemRowDb>();
    for (const rep of (replies ?? []) as ItemRowDb[]) {
      if (!latest.has(rep.item_id)) latest.set(rep.item_id, rep);
    }
    return { items: items.map((r) => toItem(r, latest.get(r.id) ?? null)) };
  });

export const syncEngagement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ workspaceId: z.string().uuid(), autoDraft: z.boolean().default(true) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { runEngagementSweep } = await import("./engagement.server");
    try {
      return {
        ok: true as const,
        ...(await runEngagementSweep(context.supabase as any, data.workspaceId, {
          autoDraft: data.autoDraft,
        })),
      };
    } catch (e) {
      return {
        ok: false as const,
        error: e instanceof Error ? e.message.slice(0, 300) : "Sync failed.",
      };
    }
  });

export const draftEngagementReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        workspaceId: z.string().uuid(),
        itemId: z.string().uuid(),
        angle: z.string().max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ ok: boolean; text?: string; error?: string }> => {
    const supabase = context.supabase as any;
    const { draftReplyText } = await import("./engagement.server");
    const { data: item } = await supabase
      .from("engagement_items")
      .select("*")
      .eq("id", data.itemId)
      .eq("workspace_id", data.workspaceId)
      .maybeSingle();
    if (!item) return { ok: false, error: "Item not found." };
    try {
      const text = await draftReplyText(supabase, data.workspaceId, item, data.angle);
      const { data: reply } = await supabase
        .from("engagement_replies")
        .insert({
          workspace_id: data.workspaceId,
          item_id: data.itemId,
          text,
          mode: "manual",
          status: "draft",
        })
        .select("id")
        .single();
      void reply;
      await supabase.from("engagement_items").update({ status: "drafted" }).eq("id", data.itemId);
      return { ok: true, text };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message.slice(0, 300) : "Could not draft a reply.",
      };
    }
  });

export const sendEngagementReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        workspaceId: z.string().uuid(),
        itemId: z.string().uuid(),
        text: z.string().min(1).max(4000),
        replyId: z.string().uuid().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { sendReply } = await import("./engagement.server");
    // A click on the inbox's Send button is explicit human confirmation, so
    // this bypasses the queue-for-approval gate that agent-initiated sends hit.
    return await sendReply(
      context.supabase as any,
      data.workspaceId,
      data.itemId,
      data.text,
      data.replyId,
      "manual",
      { userConfirmed: true },
    );
  });

export const likeEngagementItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ workspaceId: z.string().uuid(), itemId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { likeItem } = await import("./engagement.server");
    return await likeItem(context.supabase as any, data.workspaceId, data.itemId);
  });

export const setEngagementStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        workspaceId: z.string().uuid(),
        itemId: z.string().uuid(),
        status: z.enum(["needs_reply", "escalated", "done", "ignored"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await (context.supabase as any)
      .from("engagement_items")
      .update({ status: data.status })
      .eq("id", data.itemId)
      .eq("workspace_id", data.workspaceId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
