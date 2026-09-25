// Shared, client-safe types for the Engagement Inbox (comments, mentions, DMs).

// "mention" is reserved for the future: no ingestion path produces it today
// (ingestEngagement only emits "comment" and "dm"), so the UI does not offer
// a Mentions filter yet.
export type EngagementKind = "comment" | "mention" | "dm";

export type EngagementSentiment = "positive" | "neutral" | "negative";

export type EngagementIntent = "praise" | "question" | "support" | "opportunity" | "spam" | "other";

export type EngagementUrgency = "low" | "normal" | "high";

export type EngagementStatus =
  | "new"
  | "needs_reply"
  | "drafted"
  | "awaiting_approval"
  | "replied"
  | "escalated"
  | "done"
  | "ignored";

export type ReplyMode = "draft" | "approval" | "autonomous";

export const REPLY_MODES: { value: ReplyMode; label: string; hint: string }[] = [
  {
    value: "draft",
    label: "Draft only",
    hint: "The agent writes a reply. Nothing is sent until you click send.",
  },
  {
    value: "approval",
    label: "Auto-reply with approval",
    hint: "Drafts wait in the inbox for your approval, then send automatically.",
  },
  {
    value: "autonomous",
    label: "Autonomous for safe categories",
    hint: "The agent sends replies by itself, but only for the categories you allow.",
  },
];

/** Categories the agent may ever answer without a human. */
export const SAFE_CATEGORIES: { value: EngagementIntent; label: string; hint: string }[] = [
  { value: "praise", label: "Praise and thanks", hint: "Someone says something nice." },
  {
    value: "question",
    label: "Simple questions",
    hint: "Factual questions answerable from the brand context.",
  },
  { value: "other", label: "Small talk", hint: "Neutral chit-chat that just needs acknowledging." },
];

/**
 * Intents that always need a human to look at them, whatever the settings say.
 *
 * Spam is deliberately NOT listed here, because this list means "escalate to a
 * person" and spam is discarded rather than escalated. It is refused on its own
 * line in isSafeToAutoSend, and separately short-circuited to "ignored" by
 * handleItem before any policy routing happens — two independent guards, so
 * neither depends on the other still being there.
 */
export const ALWAYS_ESCALATE: EngagementIntent[] = ["support", "opportunity"];

export type EngagementItemPublic = {
  id: string;
  kind: EngagementKind;
  network: string;
  accountId: string;
  externalId: string;
  threadId: string | null;
  postId: string | null;
  postExcerpt: string | null;
  permalink: string | null;
  authorName: string;
  authorHandle: string | null;
  authorUrl: string | null;
  authorAvatarUrl: string | null;
  text: string;
  occurredAt: string | null;
  sentiment: EngagementSentiment | null;
  intent: EngagementIntent | null;
  urgency: EngagementUrgency | null;
  shouldReply: boolean | null;
  reason: string | null;
  status: EngagementStatus;
  draft: { id: string; text: string; status: string; error: string | null } | null;
  createdAt: string;
};

export type EngagementAccountPublic = {
  id: string;
  externalAccountId: string;
  network: string;
  name: string;
  status: string;
  lastSyncedAt: string | null;
};

export const NETWORK_LABEL: Record<string, string> = {
  LINKEDIN: "LinkedIn",
  INSTAGRAM: "Instagram",
  TWITTER: "X",
  X: "X",
  FACEBOOK: "Facebook",
  WHATSAPP: "WhatsApp",
  MESSENGER: "Messenger",
  TELEGRAM: "Telegram",
};

export function networkLabel(n: string): string {
  return NETWORK_LABEL[n?.toUpperCase?.() ?? ""] ?? (n || "Unknown");
}
