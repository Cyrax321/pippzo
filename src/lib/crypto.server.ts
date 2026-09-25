// AES-GCM encryption for provider API keys stored in the database.
// Server-only. Never import from client code.
//
// Format of an encrypted value: "v1.<base64(iv)>.<base64(ciphertext)>"

const PREFIX = "v1";

function b64encode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function b64decode(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

let cachedKey: CryptoKey | null = null;

async function getKey(): Promise<CryptoKey | null> {
  if (cachedKey) return cachedKey;
  const secret = process.env.PROVIDER_KEY_SECRET;
  if (!secret) {
    // Fail closed: without this secret, user-supplied API keys would land in
    // Postgres as plaintext. Generate one with `openssl rand -hex 32`.
    throw new Error(
      "PROVIDER_KEY_SECRET is not set. Add it to .env (openssl rand -hex 32) — refusing to store API keys unencrypted.",
    );
  }
  const material = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  cachedKey = await crypto.subtle.importKey("raw", material, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
  return cachedKey;
}

export function isEncrypted(value: string | null | undefined): boolean {
  return !!value && value.startsWith(`${PREFIX}.`);
}

/** Encrypts a secret. Returns null when no encryption secret is configured. */
export async function encryptSecret(plain: string): Promise<string | null> {
  const key = await getKey();
  if (!key) return null;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const buf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plain),
  );
  return `${PREFIX}.${b64encode(iv)}.${b64encode(new Uint8Array(buf))}`;
}

/** Decrypts a value produced by encryptSecret. Returns null on any failure. */
export async function decryptSecret(value: string): Promise<string | null> {
  if (!isEncrypted(value)) return null;
  const key = await getKey();
  if (!key) return null;
  const [, ivB64, dataB64] = value.split(".");
  if (!ivB64 || !dataB64) return null;
  try {
    const buf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64decode(ivB64) },
      key,
      b64decode(dataB64),
    );
    return new TextDecoder().decode(buf);
  } catch (e) {
    console.error("[crypto] decrypt failed", e instanceof Error ? e.message : e);
    return null;
  }
}

type KeyRow = { api_key?: string | null; api_key_enc?: string | null };

/**
 * The one shape both secret readers share: prefer the encrypted column, fall
 * back to the legacy plaintext column, and report "nothing usable" as null.
 *
 * There is deliberately no `isEncrypted` gate here. `decryptSecret` already
 * refuses a non-envelope value before it touches the key, so gating outside it
 * only duplicated that check — and doing it in one reader but not the other
 * (audit finding 49) was the asymmetry that invited a copy-paste bug.
 *
 * A stored envelope that will not decrypt (wrong PROVIDER_KEY_SECRET, tampered
 * ciphertext) falls through to the legacy column rather than failing hard: for
 * a workspace mid-migration that is the difference between a degraded read and
 * a dead integration.
 */
async function readSecretColumns(
  enc: string | null | undefined,
  legacy: string | null | undefined,
): Promise<string | null> {
  if (enc) {
    const plain = await decryptSecret(enc);
    if (plain) return plain;
  }
  return legacy?.trim() || null;
}

/**
 * Reads the usable API key from a provider row, preferring the encrypted
 * column and falling back to the legacy plaintext column. Returns null when
 * the row carries no usable key.
 */
export async function readProviderKey(row: KeyRow | null): Promise<string | null> {
  if (!row) return null;
  return readSecretColumns(row.api_key_enc, row.api_key);
}

/**
 * Builds the columns to persist for a secret: encrypted when possible, with
 * the plaintext column blanked so the raw key never lands in the table.
 */
export async function writeProviderKey(
  plain: string,
): Promise<{ api_key: string; api_key_enc: string | null }> {
  const enc = await encryptSecret(plain);
  return enc ? { api_key: "", api_key_enc: enc } : { api_key: plain, api_key_enc: null };
}

type BufferTokenRow = { access_token?: string | null; access_token_enc?: string | null };

/**
 * Reads the usable Buffer access token from a connection row, preferring the
 * encrypted column and falling back to the legacy plaintext column. The Buffer
 * table uses access_token / access_token_enc rather than the provider columns.
 * Returns null when the row carries no usable token.
 */
export async function readBufferToken(row: BufferTokenRow | null): Promise<string | null> {
  if (!row) return null;
  return readSecretColumns(row.access_token_enc, row.access_token);
}

/**
 * Builds the columns to persist a Buffer token: encrypted, plaintext blanked.
 */
export async function writeBufferToken(
  plain: string,
): Promise<{ access_token: string; access_token_enc: string | null }> {
  const enc = await encryptSecret(plain);
  return enc
    ? { access_token: "", access_token_enc: enc }
    : { access_token: plain, access_token_enc: null };
}
