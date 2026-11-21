import { describe, it, expect, vi } from "vitest";
import {
  publishMockViaSdk,
  publishToBlueskyViaSdk,
  resolveBlueskySession,
} from "./social-sdk-bridge.server";

describe("social-sdk-bridge.server", () => {
  it("publishMockViaSdk — runs deterministic execution via Social SDK mock backend", async () => {
    const res = await publishMockViaSdk("x", {
      text: "Hello from Pipzo bridged to Social SDK!",
      idempotencyKey: "test-mock-bridge-1",
    });

    expect(res.ok).toBe(true);
    expect(res.platform).toBe("x");
    expect(res.postId).toBeDefined();
    expect(res.url).toContain("social.example.invalid");
  });

  it("resolveBlueskySession — returns immediately if did and accessJwt are already provided", async () => {
    const creds = {
      handle: "pipzo.bsky.social",
      did: "did:plc:abcdef123456",
      accessJwt: "jwt.token.mock",
    };

    const session = await resolveBlueskySession(creds);
    expect(session.did).toBe(creds.did);
    expect(session.accessJwt).toBe(creds.accessJwt);
    expect(session.service).toBe("https://bsky.social");
  });

  it("resolveBlueskySession — rejects when no password and no JWT are provided", async () => {
    await expect(
      resolveBlueskySession({ handle: "pipzo.bsky.social" }),
    ).rejects.toThrow("Bluesky credentials missing App Password or Access JWT");
  });

  it("publishToBlueskyViaSdk — catches and reports auth errors gracefully without throwing", async () => {
    const res = await publishToBlueskyViaSdk(
      { handle: "invalid-user.bsky.social" },
      { text: "Test post" },
    );

    expect(res.ok).toBe(false);
    expect(res.platform).toBe("bluesky");
    expect(res.error).toBeDefined();
  });
});
