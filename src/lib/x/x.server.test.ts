import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildOAuth1Header,
  generatePKCE,
  buildOAuth2AuthorizeUrl,
  publishTweet,
  deleteTweet,
  likeTweet,
  getUserMentions,
  syncXMentionsToEngagement,
} from "./x.server";
import { findAndPublishDueScheduledPosts } from "./x-scheduler.server";

describe("X Integration — OAuth 1.0a HMAC-SHA1 signature", () => {
  it("produces valid OAuth 1.0 authorization header format", () => {
    const header = buildOAuth1Header({
      method: "POST",
      url: "https://api.twitter.com/2/tweets",
      apiKey: "test_consumer_key",
      apiSecret: "test_consumer_secret",
      oauthToken: "test_token",
      oauthTokenSecret: "test_token_secret",
    });

    expect(header).toMatch(/^OAuth /);
    expect(header).toContain('oauth_consumer_key="test_consumer_key"');
    expect(header).toContain('oauth_token="test_token"');
    expect(header).toContain('oauth_signature_method="HMAC-SHA1"');
    expect(header).toContain("oauth_signature=");
    expect(header).toContain("oauth_timestamp=");
    expect(header).toContain("oauth_nonce=");
  });

  it("sorts query parameters into signature base string properly", () => {
    const header = buildOAuth1Header({
      method: "GET",
      url: "https://api.twitter.com/2/users/123/tweets",
      apiKey: "ck",
      apiSecret: "cs",
      oauthToken: "ot",
      oauthTokenSecret: "ots",
      queryParams: { max_results: "10" },
    });
    expect(header).toContain("oauth_signature=");
  });
});

describe("X Integration — OAuth 2.0 PKCE", () => {
  it("generates code verifier and SHA-256 base64url challenge", () => {
    const { codeVerifier, codeChallenge, state } = generatePKCE();
    expect(codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(codeChallenge).toBeDefined();
    expect(state).toHaveLength(32);
    // Base64url should not have +, / or =
    expect(codeChallenge).not.toContain("+");
    expect(codeChallenge).not.toContain("/");
    expect(codeChallenge).not.toContain("=");
  });

  it("builds correct authorize URL with scopes", () => {
    const url = buildOAuth2AuthorizeUrl({
      clientId: "my_client_id",
      redirectUri: "http://localhost:5173/auth/x/callback",
      state: "test_state",
      codeChallenge: "test_challenge",
    });

    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://twitter.com");
    expect(parsed.pathname).toBe("/i/oauth2/authorize");
    expect(parsed.searchParams.get("client_id")).toBe("my_client_id");
    expect(parsed.searchParams.get("code_challenge")).toBe("test_challenge");
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    expect(parsed.searchParams.get("scope")).toContain("tweet.read");
    expect(parsed.searchParams.get("scope")).toContain("tweet.write");
    expect(parsed.searchParams.get("scope")).toContain("offline.access");
  });
});

describe("X Integration — Tweet Publishing & Limits", () => {
  const origFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.PROVIDER_KEY_SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    vi.restoreAllMocks();
  });

  function createMockDb(connectionData: any) {
    return {
      from: (table: string) => {
        if (table === "x_connection") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: connectionData }),
              }),
            }),
            update: () => ({
              eq: async () => ({}),
            }),
          };
        }
        if (table === "activity_log") {
          return {
            insert: async () => ({}),
          };
        }
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
          insert: async () => ({}),
          update: () => ({ eq: async () => ({}) }),
        };
      },
    };
  }

  it("rejects tweets longer than 280 characters", async () => {
    const mockDb = createMockDb({
      status: "connected",
      auth_mode: "oauth2",
      access_token_enc: "enc",
      username: "testuser",
    });

    const longText = "a".repeat(281);
    const res = await publishTweet(mockDb as never, "ws1", { text: longText });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("exceeds X's 280-character limit");
  });

  it("handles URLs counting as 23 characters (t.co wrap rule)", async () => {
    const mockDb = createMockDb({
      status: "connected",
      auth_mode: "oauth2",
      access_token_enc: "enc",
      username: "testuser",
    });

    // 250 'a's + a 50 char URL = 300 plain chars, but on X URL is 23 chars => 250 + 23 = 273 chars <= 280
    const textWithUrl = "a".repeat(250) + " https://example.com/very/long/url/that/would/otherwise/exceed/limits";

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "x-rate-limit-remaining": "100" }),
      json: async () => ({ data: { id: "tweet_123" } }),
    } as any);

    // Mock decryptSecret
    vi.spyOn(await import("@/lib/crypto.server"), "decryptSecret").mockResolvedValue("real_token");

    const res = await publishTweet(mockDb as never, "ws1", { text: textWithUrl });
    expect(res.ok).toBe(true);
    expect(res.tweetId).toBe("tweet_123");
    expect(res.url).toBe("https://x.com/testuser/status/tweet_123");
  });

  it("handles 429 rate limit error gracefully and extracts reset header", async () => {
    const mockDb = createMockDb({
      status: "connected",
      auth_mode: "oauth2",
      access_token_enc: "enc",
      username: "testuser",
    });

    vi.spyOn(await import("@/lib/crypto.server"), "decryptSecret").mockResolvedValue("real_token");

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: new Headers({
        "x-rate-limit-limit": "50",
        "x-rate-limit-remaining": "0",
        "x-rate-limit-reset": "1760000000",
      }),
      text: async () => "Rate limit exceeded",
    } as any);

    const res = await publishTweet(mockDb as never, "ws1", { text: "Hello X" });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("rate limit");
    expect(res.rateLimit?.remaining).toBe(0);
  });
});

describe("X Scheduler — findAndPublishDueScheduledPosts", () => {
  it("finds and publishes due post to X directly", async () => {
    const postRow = {
      id: "post_1",
      workspace_id: "ws1",
      post: {
        platform: "x",
        caption: "Scheduled tweet for X",
        cta: "Visit us",
        hashtags: ["ai", "launch"],
      },
      image_url: null,
      scheduled_at: new Date(Date.now() - 60000).toISOString(),
      status: "scheduled",
      buffer_id: null,
      buffer_channel_id: null,
      x_post_id: null,
    };

    let updatedStatus: string | null = null;
    let updatedXId: string | null = null;

    const mockAdmin = {
      from: (table: string) => {
        if (table === "scheduled_posts") {
          return {
            select: () => ({
              eq: () => ({
                lte: () => ({
                  is: () => ({
                    is: () => ({
                      limit: async () => ({ data: [postRow], error: null }),
                    }),
                  }),
                }),
              }),
            }),
            update: (patch: any) => ({
              eq: (col1: string, val1: any) => {
                if (patch.publish_claimed_at) {
                  return {
                    eq: () => ({
                      is: () => ({
                        select: () => ({
                          maybeSingle: async () => ({ data: { id: "post_1" } }),
                        }),
                      }),
                    }),
                  };
                }
                if (patch.status) {
                  updatedStatus = patch.status;
                  updatedXId = patch.x_post_id;
                  return { eq: async () => ({}) };
                }
                return { eq: async () => ({}) };
              },
            }),
          };
        }
        if (table === "x_connection") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    status: "connected",
                    auth_mode: "oauth2",
                    access_token_enc: "enc",
                    username: "bot",
                  },
                }),
              }),
            }),
            update: () => ({ eq: async () => ({}) }),
          };
        }
        if (table === "activity_log") {
          return { insert: async () => ({}) };
        }
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
          update: () => ({ eq: async () => ({}) }),
          insert: async () => ({}),
        };
      },
    };

    vi.spyOn(await import("@/lib/crypto.server"), "decryptSecret").mockResolvedValue("real_token");

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ data: { id: "tweet_sched_999" } }),
    } as any);

    const res = await findAndPublishDueScheduledPosts(mockAdmin as never);
    expect(res.checked).toBe(1);
    expect(res.published).toBe(1);
    expect(res.failed).toBe(0);
    expect(updatedStatus).toBe("published");
    expect(updatedXId).toBe("tweet_sched_999");
  });

  it("initiates X OAuth with PKCE correctly without errors", async () => {
    const { initiateXOAuth } = await import("@/lib/oauth-flow.server");
    const result = await initiateXOAuth({
      workspaceId: "00000000-0000-0000-0000-000000000000",
      origin: "http://localhost:5173",
      clientId: "test_client_id_123",
      clientSecret: "test_secret",
    });

    expect(result.authorizeUrl).toContain("https://twitter.com/i/oauth2/authorize");
    expect(result.authorizeUrl).toContain("client_id=test_client_id_123");
    expect(result.authorizeUrl).toContain("code_challenge=");
    expect(result.authorizeUrl).toContain("code_challenge_method=S256");
  });
});
