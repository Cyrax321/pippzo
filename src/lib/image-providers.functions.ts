import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { ImageProvider, ImageProviderKind } from "./types";

const wsInput = z.object({ workspaceId: z.string().uuid() });

// Minimal shape for the helpers below -- avoids re-introducing `any` at
// every call site while matching context.supabase's actual (untyped) usage
// elsewhere in this file.
type Client = { from: (t: string) => any };

type Row = {
  id: string;
  workspace_id: string;
  provider: string;
  label: string;
  api_key: string;
  api_key_enc: string | null;
  base_url: string | null;
  default_model: string | null;
  is_default: boolean;
  created_at: string;
};

const rowToProvider = (r: Row): ImageProvider => ({
  id: r.id,
  provider: r.provider as ImageProviderKind,
  label: r.label,
  // Rows written since encryption landed keep api_key blank and store the
  // secret in api_key_enc — either column counts as "has a key".
  hasKey: !!(r.api_key || r.api_key_enc),
  baseUrl: r.base_url ?? undefined,
  defaultModel: r.default_model ?? undefined,
  isDefault: r.is_default,
  createdAt: new Date(r.created_at).getTime(),
});

export const listImageProviders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { workspaceId: string }) => wsInput.parse(d))
  .handler(async ({ data, context }): Promise<{ providers: ImageProvider[] }> => {
    const { data: rows, error } = await (context.supabase as any)
      .from("image_providers")
      .select("*")
      .eq("workspace_id", data.workspaceId)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { providers: (rows as Row[]).map(rowToProvider) };
  });

// Postgres reports a unique-index violation as SQLSTATE 23505; the Supabase
// client surfaces it as `error.code`. Used to tell "someone else just won
// the default race" apart from a genuine failure.
const isUniqueViolation = (error: unknown): boolean =>
  !!error && typeof error === "object" && (error as { code?: string }).code === "23505";

// Clears is_default only on the row(s) that are currently true, and returns
// their ids in the same round trip (the update's WHERE clause reads the
// pre-update state, and .select() returns the rows it matched). That lets
// callers restore whoever was default if the write that follows fails.
async function clearDefaultImageProviders(
  supabase: Client,
  workspaceId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("image_providers")
    .update({ is_default: false })
    .eq("workspace_id", workspaceId)
    .eq("is_default", true)
    .select("id");
  if (error) throw new Error(error.message);
  return ((data ?? []) as { id: string }[]).map((r) => r.id);
}

// Best-effort: puts a previous default back. If this itself fails, it's
// because a racing write already holds the default -- the workspace still
// has exactly one, so there's nothing left to fix.
async function restoreDefaultImageProvider(supabase: Client, id: string): Promise<void> {
  await supabase.from("image_providers").update({ is_default: true }).eq("id", id);
}

export const saveImageProvider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        workspaceId: z.string().uuid(),
        provider: z.enum(["openai", "gemini", "azure"]),
        label: z.string().min(1).max(100),
        apiKey: z.string().min(8).max(500),
        baseUrl: z.string().url().optional().or(z.literal("")),
        defaultModel: z.string().max(120).optional().or(z.literal("")),
        makeDefault: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<ImageProvider> => {
    const supabase = context.supabase as any;

    const { count } = await supabase
      .from("image_providers")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", data.workspaceId);
    // This count is read before the clear/insert below, so under a
    // concurrent first save it can be stale (two requests both see count
    // 0). That's fine: it only decides *intent*. The unique index plus the
    // clear+insert+retry sequence below is what actually enforces "at most
    // one default", regardless of what this heuristic guessed.
    const shouldDefault = data.makeDefault || !count;

    // Encrypt at rest: writeProviderKey stores the secret in api_key_enc and
    // blanks the legacy plaintext column (unless no secret is configured).
    const { writeProviderKey } = await import("./crypto.server");
    const keyCols = await writeProviderKey(data.apiKey);

    const insertRow = (isDefault: boolean) =>
      supabase
        .from("image_providers")
        .insert({
          workspace_id: data.workspaceId,
          provider: data.provider,
          label: data.label,
          ...keyCols,
          base_url: data.baseUrl || null,
          default_model: data.defaultModel || null,
          is_default: isDefault,
        })
        .select("*")
        .single();

    // Clear before insert, never insert-then-clear: clearing first can only
    // pass through a "zero defaults" state, which the partial unique index
    // allows. Setting the new row default before clearing the old one would
    // briefly hold two rows with is_default = true, which the index rejects
    // outright -- that ordering fails even for a single caller with no race
    // at all, since the previous default is still true when the insert
    // lands.
    let previousDefaultIds: string[] = [];
    if (shouldDefault) {
      previousDefaultIds = await clearDefaultImageProviders(supabase, data.workspaceId);
    }

    let { data: row, error } = await insertRow(shouldDefault);

    if (error && shouldDefault && isUniqueViolation(error)) {
      // Another save or "make default" landed in the gap between our clear
      // and our insert. The failed insert created no row (a failed INSERT
      // writes nothing), so retrying from the clear is safe -- it's a fresh
      // attempt, not a duplicate.
      await clearDefaultImageProviders(supabase, data.workspaceId);
      ({ data: row, error } = await insertRow(true));
    }

    if (error && shouldDefault && isUniqueViolation(error)) {
      // Contended twice in a row. Save the provider without the default
      // flag rather than losing the key the user just entered -- the
      // workspace already has a default (whoever won the race), so this
      // does not create a zero-default gap.
      ({ data: row, error } = await insertRow(false));
    } else if (error && shouldDefault) {
      // Insert failed for a reason unrelated to the default race. We
      // already cleared the previous default and never replaced it -- put
      // it back so the workspace isn't left with none.
      for (const id of previousDefaultIds) {
        await restoreDefaultImageProvider(supabase, id);
      }
    }

    if (error) throw new Error(error.message);
    return rowToProvider(row as Row);
  });

export const setDefaultImageProvider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ workspaceId: z.string().uuid(), id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const supabase = context.supabase as any;

    const setTarget = () =>
      supabase.from("image_providers").update({ is_default: true }).eq("id", data.id);

    // Same ordering as saveImageProvider: clear (a legal "zero defaults"
    // state) before set. Set-then-clear would try to hold two defaults at
    // once and fail the unique index immediately, race or not.
    const previousDefaultIds = await clearDefaultImageProviders(supabase, data.workspaceId);
    let { error } = await setTarget();

    if (error && isUniqueViolation(error)) {
      // Someone else claimed the default in the gap between our clear and
      // our set. Clear it and try once more -- that window is a couple of
      // milliseconds wide, so a second attempt almost always lands clean.
      await clearDefaultImageProviders(supabase, data.workspaceId);
      ({ error } = await setTarget());
    }

    if (error) {
      // Whatever went wrong, don't leave the workspace with zero defaults:
      // put back whoever was default before we touched anything. If that
      // itself fails, it's because a racing write already holds the
      // default, so there's nothing left to fix.
      for (const id of previousDefaultIds) {
        await restoreDefaultImageProvider(supabase, id);
      }
      if (isUniqueViolation(error)) {
        throw new Error(
          "Couldn't set this as the default provider because someone else changed the default at the same time. Please try again.",
        );
      }
      throw new Error(error.message);
    }
    return { ok: true };
  });

export const deleteImageProvider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await (context.supabase as any)
      .from("image_providers")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const testImageProvider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: boolean; error?: string }> => {
    const { data: row, error } = await (context.supabase as any)
      .from("image_providers")
      .select("*")
      .eq("id", data.id)
      .single();
    if (error || !row) return { ok: false, error: "Provider not found." };
    // The stored key may live encrypted in api_key_enc — resolve it before
    // handing the row to the generator, which reads api_key verbatim.
    const { readProviderKey } = await import("./crypto.server");
    const apiKey = await readProviderKey(row as Row);
    if (!apiKey) return { ok: false, error: "Provider has no usable API key. Re-save it." };
    const { generateWithProvider } = await import("./image-gen.server");
    const res = await generateWithProvider(
      { ...(row as Row), api_key: apiKey },
      "A simple flat-colour circle on a plain background.",
      [],
    );
    return res.b64 ? { ok: true } : { ok: false, error: res.error ?? "Unknown error" };
  });
