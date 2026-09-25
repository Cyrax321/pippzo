#!/usr/bin/env node
/**
 * One-time (idempotent) migration: encrypt any stored secret still sitting in a
 * plaintext column, and blank that plaintext column. After this runs, provider
 * API keys and the Buffer token exist only as AES-GCM ciphertext at rest — a
 * direct row read (backup, leaked service key, PostgREST) yields nothing usable
 * without PROVIDER_KEY_SECRET, which never leaves the server.
 *
 * Safe to run repeatedly. Uses the exact scheme from src/lib/crypto.server.ts
 * (v1.<base64(iv)>.<base64(ciphertext)>, key = SHA-256(PROVIDER_KEY_SECRET)).
 *
 *   npm run secrets:encrypt
 */

import { createClient } from "@supabase/supabase-js";

process.loadEnvFile();

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PROVIDER_KEY_SECRET } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}
if (!PROVIDER_KEY_SECRET) {
  console.error("Missing PROVIDER_KEY_SECRET in .env — nothing can be encrypted without it.");
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const PREFIX = "v1";
const isEncrypted = (v) => typeof v === "string" && v.startsWith(`${PREFIX}.`);

let keyPromise;
async function getKey() {
  if (!keyPromise) {
    const material = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(PROVIDER_KEY_SECRET),
    );
    keyPromise = crypto.subtle.importKey("raw", material, { name: "AES-GCM" }, false, ["encrypt"]);
  }
  return keyPromise;
}

async function encryptSecret(plain) {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const buf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plain),
  );
  return `${PREFIX}.${Buffer.from(iv).toString("base64")}.${Buffer.from(new Uint8Array(buf)).toString("base64")}`;
}

// table, plaintext column, encrypted column, id column to update by
const TABLES = [
  { table: "llm_providers", plain: "api_key", enc: "api_key_enc", idCol: "id" },
  { table: "image_providers", plain: "api_key", enc: "api_key_enc", idCol: "id" },
  { table: "video_providers", plain: "api_key", enc: "api_key_enc", idCol: "id" },
  { table: "service_credentials", plain: "api_key", enc: "api_key_enc", idCol: "id" },
  {
    table: "buffer_connection",
    plain: "access_token",
    enc: "access_token_enc",
    idCol: "workspace_id",
  },
];

async function migrateTable({ table, plain, enc, idCol }) {
  const { data, error } = await db.from(table).select(`${idCol},${plain},${enc}`);
  if (error) {
    // Table may not exist in every deployment — skip cleanly.
    console.log(`  ${table}: skipped (${error.message})`);
    return;
  }
  let encrypted = 0;
  let blanked = 0;
  for (const row of data ?? []) {
    const plaintext = (row[plain] ?? "").toString().trim();
    if (!plaintext) continue; // already blank — nothing to do
    const patch = {};
    if (isEncrypted(row[enc])) {
      // Already have ciphertext; just drop the redundant plaintext.
      patch[plain] = "";
      blanked++;
    } else {
      patch[enc] = await encryptSecret(plaintext);
      patch[plain] = "";
      encrypted++;
    }
    const { error: upErr } = await db.from(table).update(patch).eq(idCol, row[idCol]);
    if (upErr) throw new Error(`${table} update failed for ${row[idCol]}: ${upErr.message}`);
  }
  const total = encrypted + blanked;
  console.log(
    total === 0
      ? `  ${table}: clean — no plaintext secrets`
      : `  ${table}: ${encrypted} encrypted, ${blanked} redundant-plaintext blanked`,
  );
}

async function main() {
  console.log("Encrypting any plaintext secrets at rest…\n");
  for (const cfg of TABLES) await migrateTable(cfg);
  console.log("\nDone. All stored secrets are now ciphertext (or empty).");
}

main().catch((e) => {
  console.error(`\nFailed: ${e.message}`);
  process.exit(1);
});
