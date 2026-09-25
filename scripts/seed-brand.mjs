#!/usr/bin/env node
/**
 * Seeds Brand, Guide and Competitors for the single local workspace.
 *
 * The payload lives in a JSON file, not in this script:
 *   seed/brand.local.json    — your real brand (gitignored), used when present
 *   seed/brand.example.json  — a neutral demo brand, used otherwise
 *
 * It exists as a script rather than something typed into the UI because
 * `npm run db:reset` wipes the brand tables, and retyping is exactly the
 * chore this app is supposed to remove.
 *
 * Non-destructive by default: a field is written only when it is currently
 * empty, so re-running never clobbers an edit made in /marca or /guia.
 * Pass --force to overwrite everything (use after a db:reset).
 *
 *   npm run seed:brand
 *   npm run seed:brand -- --force
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";

process.loadEnvFile();

const FORCE = process.argv.includes("--force");

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

const PAYLOAD_PATH = existsSync("seed/brand.local.json")
  ? "seed/brand.local.json"
  : "seed/brand.example.json";
let payload;
try {
  payload = JSON.parse(readFileSync(PAYLOAD_PATH, "utf8"));
} catch (e) {
  console.error(`Could not read ${PAYLOAD_PATH}: ${e.message}`);
  process.exit(1);
}
const BRAND = payload.brand ?? {};
const GUIDE = payload.guide ?? {};
const COMPETITORS = Array.isArray(payload.competitors) ? payload.competitors : [];

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ── Seeding ─────────────────────────────────────────────────────────────────

const isEmpty = (v) =>
  v === null ||
  v === undefined ||
  (typeof v === "string" && v.trim() === "") ||
  (Array.isArray(v) && v.length === 0);

/** Upserts only the fields that are currently empty (unless --force). */
async function seedTable(table, workspaceId, values) {
  const { data: existing, error: readErr } = await db
    .from(table)
    .select("*")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (readErr) throw new Error(`${table}: ${readErr.message}`);

  const patch = {};
  const skipped = [];
  for (const [key, value] of Object.entries(values)) {
    if (FORCE || !existing || isEmpty(existing[key])) patch[key] = value;
    else skipped.push(key);
  }

  if (Object.keys(patch).length === 0) {
    console.log(`  ${table}: nothing to do — all ${skipped.length} fields already set`);
    return;
  }

  const { error } = await db
    .from(table)
    .upsert({ workspace_id: workspaceId, ...patch }, { onConflict: "workspace_id" });
  if (error) throw new Error(`${table}: ${error.message}`);

  console.log(
    `  ${table}: wrote ${Object.keys(patch).length} field(s)${skipped.length ? `, skipped ${skipped.length} already set` : ""}`,
  );
}

// Competitors are seeded as name + website only. Deliberately no `snapshot`:
// that column is the scan-result shape and carries a `scannedAt` timestamp, so
// filling it with prose would fake a scan that never ran. Social handles are
// left blank rather than guessed; add them in /competidores, or let the agent
// research them once Firecrawl or ScrapeCreators is connected.
async function seedCompetitors(workspaceId) {
  if (!COMPETITORS.length) {
    console.log("  competitors: none in payload — skipping");
    return;
  }
  const { data: existing, error } = await db
    .from("competitors")
    .select("name")
    .eq("workspace_id", workspaceId);
  if (error) throw new Error(`competitors: ${error.message}`);

  const have = new Set((existing ?? []).map((c) => c.name.toLowerCase()));
  const missing = COMPETITORS.filter((c) => !have.has(c.name.toLowerCase()));

  if (missing.length === 0) {
    console.log(`  competitors: nothing to do — all ${COMPETITORS.length} already present`);
    return;
  }

  const { error: insErr } = await db
    .from("competitors")
    .insert(missing.map((c) => ({ workspace_id: workspaceId, name: c.name, website: c.website })));
  if (insErr) throw new Error(`competitors: ${insErr.message}`);

  console.log(`  competitors: added ${missing.length} (${missing.map((c) => c.name).join(", ")})`);
}

async function main() {
  const { data: workspaces, error } = await db
    .from("workspaces")
    .select("id,name")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`workspaces: ${error.message}`);
  if (!workspaces?.length) {
    console.error("No workspace found. Sign up in the app first, then re-run this.");
    process.exit(1);
  }
  if (workspaces.length > 1) {
    console.log(
      `Note: ${workspaces.length} workspaces found — seeding the oldest ("${workspaces[0].name}").`,
    );
  }

  const ws = workspaces[0];
  console.log(
    `Seeding workspace "${ws.name}" from ${PAYLOAD_PATH}${FORCE ? " (--force: overwriting)" : ""}\n`,
  );

  await seedTable("brand_profile", ws.id, BRAND);
  await seedTable("brand_guideline", ws.id, GUIDE);
  await seedCompetitors(ws.id);

  console.log("\nDone. Check /marca, /guia and /competidores in the app.");
  if (!FORCE)
    console.log("Re-run with `npm run seed:brand -- --force` to overwrite existing values.");
}

main().catch((e) => {
  console.error(`\nFailed: ${e.message}`);
  process.exit(1);
});
