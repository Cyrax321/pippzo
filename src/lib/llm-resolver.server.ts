// Resolves the chat/text model for a workspace from its own connected
// provider keys. This app is bring-your-own-key only: there is no shared
// platform account to fall back to, so a workspace with no connected provider
// gets a NoProviderError telling it exactly where to fix that.
//
// Server-only.

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
// Sourced from `ai` rather than `@ai-sdk/provider` directly: the provider
// package is a transitive dependency whose major version is not ours to pin,
// and `ai` re-exports the model type it actually accepts.
import type { LanguageModel } from "ai";
import { readProviderKey } from "./crypto.server";

export type LlmProviderKind = "openai" | "anthropic" | "google" | "azure" | "openai_compatible";

export type LlmProviderRow = {
  id: string;
  workspace_id: string;
  provider: string;
  label: string;
  api_key: string | null;
  api_key_enc: string | null;
  base_url: string | null;
  default_model: string | null;
  is_default: boolean;
};

type Client = { from: (t: string) => any };

export class NoProviderError extends Error {
  constructor(
    message = "No text model connected. Add your own API key in Settings → Connections.",
  ) {
    super(message);
    this.name = "NoProviderError";
  }
}

export const DEFAULT_MODEL_BY_PROVIDER: Record<LlmProviderKind, string> = {
  openai: "gpt-5.6-terra",
  anthropic: "claude-sonnet-5",
  google: "gemini-2.5-flash",
  azure: "gpt-4.1-mini",
  openai_compatible: "gpt-4.1-mini",
};

/**
 * `LanguageModel` from `ai` is a union: a model id string (for a provider
 * registry) plus both the v2 and v3 model interfaces. This resolver always
 * builds a concrete current-spec model, so narrowing to v3 here is what lets
 * call sites pass the result straight into wrapLanguageModel().
 */
type CurrentLanguageModel = Extract<LanguageModel, { specificationVersion: "v3" }>;

export type ResolvedModel = {
  model: CurrentLanguageModel;
  /** Model id actually used, for usage logging. */
  modelId: string;
  /** Human label for the UI / logs. */
  providerLabel: string;
};

function buildModel(row: LlmProviderRow, apiKey: string, override?: string): ResolvedModel {
  const kind = (row.provider as LlmProviderKind) ?? "openai";
  const modelId = (
    override ||
    row.default_model ||
    DEFAULT_MODEL_BY_PROVIDER[kind] ||
    "gpt-5.6-terra"
  ).trim();
  const label = `${row.label} (${row.provider})`;

  if (kind === "anthropic") {
    const anthropic = createAnthropic({
      apiKey,
      ...(row.base_url ? { baseURL: row.base_url } : {}),
    });
    return { model: anthropic(modelId), modelId, providerLabel: label };
  }

  if (kind === "google") {
    const google = createGoogleGenerativeAI({
      apiKey,
      ...(row.base_url ? { baseURL: row.base_url } : {}),
    });
    return { model: google(modelId), modelId, providerLabel: label };
  }

  if (kind === "openai") {
    // Native OpenAI provider: sends max_completion_tokens for GPT-5.x models,
    // which the generic OpenAI-compatible provider does not.
    const openai = createOpenAI({
      apiKey,
      ...(row.base_url ? { baseURL: row.base_url } : {}),
    });
    return { model: openai(modelId), modelId, providerLabel: label };
  }

  // openai / azure / any OpenAI-compatible endpoint
  const baseURL = row.base_url?.trim() || undefined;
  if (!baseURL) {
    throw new NoProviderError(`"${row.label}" needs a base URL before it can be used.`);
  }
  const provider = createOpenAICompatible({
    name: row.provider,
    baseURL,
    apiKey,
    supportsStructuredOutputs: true,
    ...(kind === "azure"
      ? { queryParams: { "api-version": "2024-12-01-preview" }, headers: { "api-key": apiKey } }
      : {}),
  });
  return { model: provider(modelId), modelId, providerLabel: label };
}

async function loadRow(client: Client, workspaceId: string): Promise<LlmProviderRow | null> {
  const { data, error } = await client
    .from("llm_providers")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) {
    console.warn("[llm-resolver] provider lookup failed:", (error as { message?: string }).message);
    return null;
  }
  return (data?.[0] as LlmProviderRow) ?? null;
}

/**
 * Returns the model to use for a workspace.
 * Throws NoProviderError when nothing is connected — callers should surface
 * that message to the user rather than a generic 500.
 */
export async function resolveChatModel(
  client: Client | null,
  workspaceId: string | null,
  opts?: { modelOverride?: string },
): Promise<ResolvedModel> {
  if (!client || !workspaceId) throw new NoProviderError();

  const row = await loadRow(client, workspaceId);
  if (!row) throw new NoProviderError();

  const apiKey = await readProviderKey(row);
  if (!apiKey) {
    console.warn("[llm-resolver] provider row has no usable key:", row.id);
    throw new NoProviderError(
      `"${row.label}" has no usable API key saved. Re-enter it in Settings → Connections.`,
    );
  }
  return buildModel(row, apiKey, opts?.modelOverride);
}

/**
 * Resolves the caller's workspace id from their memberships.
 * Server functions authenticated with requireSupabaseAuth don't carry an
 * explicit workspaceId, so we derive it from the RLS-scoped client.
 */
export async function currentWorkspaceId(client: Client | null): Promise<string | null> {
  if (!client) return null;
  try {
    const { data } = await client
      .from("workspace_members")
      .select("workspace_id")
      .order("created_at", { ascending: true })
      .limit(1);
    return (data?.[0] as { workspace_id?: string } | undefined)?.workspace_id ?? null;
  } catch {
    return null;
  }
}

/** Convenience for server functions: resolve workspace + model in one call. */
export async function resolveChatModelForCaller(
  client: Client | null,
  opts?: { modelOverride?: string },
): Promise<ResolvedModel> {
  const workspaceId = await currentWorkspaceId(client);
  return resolveChatModel(client, workspaceId, opts);
}
