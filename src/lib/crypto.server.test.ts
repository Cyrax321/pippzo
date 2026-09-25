// Characterisation tests for the provider-key encryption layer.
// These lock in TODAY's behaviour so later waves can refactor safely.
//
// getKey() caches the derived CryptoKey in module scope, so every test that
// needs a different PROVIDER_KEY_SECRET must load a FRESH copy of the module
// via vi.resetModules() + dynamic import. loadCrypto() below does that.

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

const SECRET_A = "3f9c1e7b5a2d4680bc13ee57af09d24c8b6f3e1a09d7c4b25e8f6a3d1c079b42";
const SECRET_B = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";

const ORIGINAL_SECRET = process.env.PROVIDER_KEY_SECRET;

type CryptoModule = typeof import("./crypto.server");

/** Loads a pristine copy of crypto.server.ts under the given secret. */
async function loadCrypto(secret: string | undefined): Promise<CryptoModule> {
  vi.resetModules();
  if (secret === undefined) delete process.env.PROVIDER_KEY_SECRET;
  else process.env.PROVIDER_KEY_SECRET = secret;
  return (await import("./crypto.server")) as CryptoModule;
}

afterAll(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.PROVIDER_KEY_SECRET;
  else process.env.PROVIDER_KEY_SECRET = ORIGINAL_SECRET;
});

describe("crypto.server", () => {
  let crypto_: CryptoModule;

  beforeEach(async () => {
    crypto_ = await loadCrypto(SECRET_A);
  });

  describe("isEncrypted", () => {
    it("recognises the v1 envelope", () => {
      expect(crypto_.isEncrypted("v1.YWJjZGVmZ2hpams=.ZGVmZ2hpamtsbW5vcA==")).toBe(true);
    });

    it("rejects plaintext provider keys", () => {
      expect(crypto_.isEncrypted("sk-ant-api03-abcdef0123456789")).toBe(false);
      expect(crypto_.isEncrypted("sk-proj-0123456789abcdef")).toBe(false);
    });

    it("rejects null, undefined and empty string", () => {
      expect(crypto_.isEncrypted(null)).toBe(false);
      expect(crypto_.isEncrypted(undefined)).toBe(false);
      expect(crypto_.isEncrypted("")).toBe(false);
    });

    it("rejects a different envelope version", () => {
      expect(crypto_.isEncrypted("v2.YWJj.ZGVm")).toBe(false);
    });

    it("only checks the prefix, so a truncated envelope still reads as encrypted", () => {
      // KNOWN GAP (audit finding): isEncrypted is a prefix test, not a shape
      // test. "v1." with no iv/ciphertext is reported as encrypted and only
      // fails later, inside decryptSecret. A later wave could validate the
      // three-part shape here instead.
      expect(crypto_.isEncrypted("v1.")).toBe(true);
    });
  });

  describe("encryptSecret / decryptSecret round-trip", () => {
    it("round-trips an Anthropic-shaped key", async () => {
      const plain = "sk-ant-api03-7hQm2Xv9LpR4tYbN0cZaF1jK8sWdEgH5uIoP3rT6yUxVbC";
      const enc = await crypto_.encryptSecret(plain);
      expect(enc).not.toBeNull();
      expect(await crypto_.decryptSecret(enc as string)).toBe(plain);
    });

    it("round-trips a Buffer access token and unicode content", async () => {
      const plain = "1/abc123def456 — ñáé 🎉";
      const enc = await crypto_.encryptSecret(plain);
      expect(await crypto_.decryptSecret(enc as string)).toBe(plain);
    });

    it("round-trips the empty string", async () => {
      const enc = await crypto_.encryptSecret("");
      expect(enc).not.toBeNull();
      expect(await crypto_.decryptSecret(enc as string)).toBe("");
    });

    it("produces a v1.<iv>.<ciphertext> envelope with a 12-byte iv", async () => {
      const enc = (await crypto_.encryptSecret("sk-proj-abcdef")) as string;
      const parts = enc.split(".");
      expect(parts).toHaveLength(3);
      expect(parts[0]).toBe("v1");
      // 12 random bytes -> 16 base64 chars
      expect(parts[1]).toHaveLength(16);
      expect(atob(parts[1]).length).toBe(12);
      expect(parts[2].length).toBeGreaterThan(0);
      expect(crypto_.isEncrypted(enc)).toBe(true);
    });

    it("uses a fresh iv, so the same plaintext encrypts to different envelopes", async () => {
      const plain = "sk-proj-0123456789abcdef";
      const a = await crypto_.encryptSecret(plain);
      const b = await crypto_.encryptSecret(plain);
      expect(a).not.toBe(b);
      expect(await crypto_.decryptSecret(a as string)).toBe(plain);
      expect(await crypto_.decryptSecret(b as string)).toBe(plain);
    });
  });

  describe("decryptSecret failure modes", () => {
    beforeEach(() => {
      // decryptSecret logs every failure; keep the suite output readable.
      vi.spyOn(console, "error").mockImplementation(() => {});
    });

    it("returns null for a value that is not in the v1 envelope at all", async () => {
      expect(await crypto_.decryptSecret("sk-ant-api03-plaintext-legacy-key")).toBeNull();
      expect(await crypto_.decryptSecret("")).toBeNull();
      expect(await crypto_.decryptSecret("v2.YWJj.ZGVm")).toBeNull();
    });

    it("returns null when the envelope is missing its ciphertext part", async () => {
      expect(await crypto_.decryptSecret("v1.YWJjZGVmZ2hpams=")).toBeNull();
      expect(await crypto_.decryptSecret("v1.")).toBeNull();
      expect(await crypto_.decryptSecret("v1..")).toBeNull();
    });

    it("returns null for malformed base64 in the envelope", async () => {
      expect(await crypto_.decryptSecret("v1.!!!not-base64!!!.@@@also-not@@@")).toBeNull();
    });

    it("returns null when the ciphertext has been tampered with", async () => {
      const enc = (await crypto_.encryptSecret("sk-proj-tamper-me")) as string;
      const [v, iv, data] = enc.split(".");
      const flipped = data[0] === "A" ? `B${data.slice(1)}` : `A${data.slice(1)}`;
      expect(await crypto_.decryptSecret(`${v}.${iv}.${flipped}`)).toBeNull();
    });

    it("returns null when the value was encrypted under a different secret", async () => {
      const underA = (await crypto_.encryptSecret("sk-ant-api03-secret-a-key")) as string;
      // Fresh module instance => fresh (uncached) key derived from SECRET_B.
      const cryptoB = await loadCrypto(SECRET_B);
      vi.spyOn(console, "error").mockImplementation(() => {});
      expect(await cryptoB.decryptSecret(underA)).toBeNull();
      // ...and the same module still round-trips its own values.
      const underB = (await cryptoB.encryptSecret("sk-ant-api03-secret-b-key")) as string;
      expect(await cryptoB.decryptSecret(underB)).toBe("sk-ant-api03-secret-b-key");
    });
  });

  describe("missing PROVIDER_KEY_SECRET", () => {
    it("makes encryptSecret THROW rather than return null", async () => {
      // KNOWN GAP (audit finding): the doc comment says "Returns null when no
      // encryption secret is configured", but getKey() throws before
      // encryptSecret can return null. The `enc ? ... : ...` fallback branches
      // in writeProviderKey / writeBufferToken are therefore dead code — the
      // plaintext-passthrough path they describe can never be reached.
      const noSecret = await loadCrypto(undefined);
      await expect(noSecret.encryptSecret("sk-proj-abc")).rejects.toThrow(
        /PROVIDER_KEY_SECRET is not set/,
      );
    });

    it("makes decryptSecret THROW for an encrypted-looking value", async () => {
      // KNOWN GAP (audit finding): documented as "Returns null on any failure",
      // but the getKey() throw happens outside the try/catch.
      const noSecret = await loadCrypto(undefined);
      await expect(noSecret.decryptSecret("v1.YWJjZGVmZ2hpams=.ZGVmZ2hpamts")).rejects.toThrow(
        /PROVIDER_KEY_SECRET is not set/,
      );
    });

    it("still returns null (no throw) for a non-envelope value, because isEncrypted runs first", async () => {
      const noSecret = await loadCrypto(undefined);
      expect(await noSecret.decryptSecret("sk-ant-api03-legacy-plaintext")).toBeNull();
    });
  });

  describe("readProviderKey", () => {
    it("prefers api_key_enc over the legacy api_key column", async () => {
      const enc = (await crypto_.encryptSecret("sk-proj-encrypted-wins")) as string;
      const key = await crypto_.readProviderKey({
        api_key: "sk-proj-legacy-loses",
        api_key_enc: enc,
      });
      expect(key).toBe("sk-proj-encrypted-wins");
    });

    it("falls back to the legacy plaintext column when api_key_enc is null", async () => {
      expect(await crypto_.readProviderKey({ api_key: "sk-proj-legacy", api_key_enc: null })).toBe(
        "sk-proj-legacy",
      );
      expect(await crypto_.readProviderKey({ api_key: "sk-proj-legacy" })).toBe("sk-proj-legacy");
    });

    it("falls back to the legacy plaintext column when api_key_enc is empty string", async () => {
      expect(await crypto_.readProviderKey({ api_key: "sk-proj-legacy", api_key_enc: "" })).toBe(
        "sk-proj-legacy",
      );
    });

    it("falls back to the legacy column when api_key_enc cannot be decrypted", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const underA = (await crypto_.encryptSecret("sk-proj-unreachable")) as string;
      const cryptoB = await loadCrypto(SECRET_B);
      vi.spyOn(console, "error").mockImplementation(() => {});
      expect(
        await cryptoB.readProviderKey({ api_key: "sk-proj-legacy", api_key_enc: underA }),
      ).toBe("sk-proj-legacy");
    });

    it("falls back when api_key_enc holds a non-envelope value", async () => {
      // Neither reader gates on isEncrypted any more: decryptSecret checks the
      // envelope itself and returns null, so the legacy column wins.
      expect(
        await crypto_.readProviderKey({
          api_key: "sk-proj-legacy",
          api_key_enc: "sk-proj-accidentally-plaintext",
        }),
      ).toBe("sk-proj-legacy");
    });

    it("trims the legacy plaintext value", async () => {
      expect(await crypto_.readProviderKey({ api_key: "  sk-proj-padded  \n" })).toBe(
        "sk-proj-padded",
      );
    });

    it("returns null (not '') when the row carries no usable key", async () => {
      // CHANGED (finding 49): this used to return "". Both readers now report
      // "nothing usable" the same way, as null. Every caller tests the result
      // for truthiness, so the behaviour at the call sites is unchanged.
      expect(await crypto_.readProviderKey({})).toBeNull();
      expect(await crypto_.readProviderKey({ api_key: null, api_key_enc: null })).toBeNull();
      expect(await crypto_.readProviderKey({ api_key: "" })).toBeNull();
      expect(await crypto_.readProviderKey({ api_key: "   " })).toBeNull();
    });

    it("returns null for a null row", async () => {
      // CHANGED (finding 49): readProviderKey now tolerates a null row, the way
      // readBufferToken always has. maybeSingle() hands back null constantly.
      expect(await crypto_.readProviderKey(null)).toBeNull();
    });
  });

  describe("writeProviderKey", () => {
    it("blanks the plaintext column and stores the envelope", async () => {
      const cols = await crypto_.writeProviderKey("sk-ant-api03-brand-new-key");
      expect(cols.api_key).toBe("");
      expect(cols.api_key_enc).not.toBeNull();
      expect(crypto_.isEncrypted(cols.api_key_enc as string)).toBe(true);
      expect(await crypto_.decryptSecret(cols.api_key_enc as string)).toBe(
        "sk-ant-api03-brand-new-key",
      );
    });

    it("round-trips through readProviderKey", async () => {
      const cols = await crypto_.writeProviderKey("sk-proj-round-trip");
      expect(await crypto_.readProviderKey(cols)).toBe("sk-proj-round-trip");
    });
  });

  describe("readBufferToken", () => {
    it("returns null for a null row", async () => {
      expect(await crypto_.readBufferToken(null)).toBeNull();
    });

    it("prefers access_token_enc over the legacy access_token column", async () => {
      const enc = (await crypto_.encryptSecret("1/buffer-encrypted-token")) as string;
      expect(
        await crypto_.readBufferToken({ access_token: "1/legacy-loses", access_token_enc: enc }),
      ).toBe("1/buffer-encrypted-token");
    });

    it("falls back to the legacy column when access_token_enc is absent", async () => {
      expect(await crypto_.readBufferToken({ access_token: "1/legacy-token" })).toBe(
        "1/legacy-token",
      );
      expect(
        await crypto_.readBufferToken({ access_token: "1/legacy-token", access_token_enc: null }),
      ).toBe("1/legacy-token");
    });

    it("falls back when access_token_enc holds a non-envelope value", async () => {
      // CHANGED (finding 49): the explicit isEncrypted gate is gone. The result
      // is identical because decryptSecret refuses a non-envelope value itself,
      // before it ever derives the key — the gate was a duplicate check.
      expect(
        await crypto_.readBufferToken({
          access_token: "1/legacy-token",
          access_token_enc: "1/accidentally-plaintext",
        }),
      ).toBe("1/legacy-token");
    });

    it("falls back to the legacy column when the envelope cannot be decrypted", async () => {
      const underA = (await crypto_.encryptSecret("1/unreachable")) as string;
      const cryptoB = await loadCrypto(SECRET_B);
      vi.spyOn(console, "error").mockImplementation(() => {});
      expect(
        await cryptoB.readBufferToken({ access_token: "1/legacy-token", access_token_enc: underA }),
      ).toBe("1/legacy-token");
    });

    it("trims the legacy value and returns null (not '') when it is blank", async () => {
      expect(await crypto_.readBufferToken({ access_token: "  1/padded  " })).toBe("1/padded");
      expect(await crypto_.readBufferToken({ access_token: "   " })).toBeNull();
      expect(await crypto_.readBufferToken({ access_token: "" })).toBeNull();
      expect(await crypto_.readBufferToken({})).toBeNull();
    });
  });

  describe("writeBufferToken", () => {
    it("blanks the plaintext column and stores the envelope", async () => {
      const cols = await crypto_.writeBufferToken("1/buffer-access-token-abc123");
      expect(cols.access_token).toBe("");
      expect(cols.access_token_enc).not.toBeNull();
      expect(crypto_.isEncrypted(cols.access_token_enc as string)).toBe(true);
      expect(await crypto_.decryptSecret(cols.access_token_enc as string)).toBe(
        "1/buffer-access-token-abc123",
      );
    });

    it("round-trips through readBufferToken", async () => {
      const cols = await crypto_.writeBufferToken("1/round-trip-token");
      expect(await crypto_.readBufferToken(cols)).toBe("1/round-trip-token");
    });
  });

  // Finding 49: the two readers used to disagree on the same shaped input —
  // one gated on isEncrypted, the other did not; one reported "missing" as ""
  // and the other as null. They now share one implementation, and this suite
  // is what stops them drifting apart again the next time one is edited.
  describe("readProviderKey / readBufferToken agree on every shape", () => {
    const shapes: Array<{ name: string; enc: string | null; legacy: string | null }> = [
      { name: "both columns empty", enc: null, legacy: null },
      { name: "legacy only", enc: null, legacy: "secret-value" },
      { name: "legacy blank", enc: null, legacy: "   " },
      { name: "legacy padded", enc: null, legacy: "  secret-value  " },
      { name: "enc empty string", enc: "", legacy: "secret-value" },
      { name: "enc is accidental plaintext", enc: "secret-value-plain", legacy: "secret-value" },
      { name: "enc is a truncated envelope", enc: "v1.", legacy: "secret-value" },
      { name: "enc undecryptable, no legacy", enc: "v1.YWJjZGVmZ2hpams=.ZGVmZ2g=", legacy: null },
    ];

    for (const { name, enc, legacy } of shapes) {
      it(name, async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const fromProvider = await crypto_.readProviderKey({
          api_key: legacy,
          api_key_enc: enc,
        });
        const fromBuffer = await crypto_.readBufferToken({
          access_token: legacy,
          access_token_enc: enc,
        });
        expect(fromProvider).toEqual(fromBuffer);
      });
    }

    it("both return null for a null row", async () => {
      expect(await crypto_.readProviderKey(null)).toBeNull();
      expect(await crypto_.readBufferToken(null)).toBeNull();
    });

    it("both prefer a decryptable envelope over the legacy column", async () => {
      const enc = (await crypto_.encryptSecret("the-real-secret")) as string;
      expect(await crypto_.readProviderKey({ api_key: "legacy", api_key_enc: enc })).toBe(
        "the-real-secret",
      );
      expect(await crypto_.readBufferToken({ access_token: "legacy", access_token_enc: enc })).toBe(
        "the-real-secret",
      );
    });
  });
});
