import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getSocialAccountsStatus,
  publishNowToAllPlatforms,
  scheduleToAllPlatforms,
} from "./social-publisher.server";

describe("social-publisher.server", () => {
  const workspaceId = "11111111-1111-1111-1111-111111111111";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getSocialAccountsStatus — reports connection statuses across direct and buffer sources", async () => {
    const mockAdmin: any = {
      from: vi.fn((table: string) => {
        if (table === "x_connection") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    workspace_id: workspaceId,
                    username: "pipzodev",
                    name: "Pipzo Official",
                    status: "connected",
                  },
                }),
              }),
            }),
          };
        }
        if (table === "service_credentials") {
          return {
            select: () => ({
              eq: async () => ({
                data: [
                  { service: "linkedin", label: "My LinkedIn", api_key: "token123" },
                  { service: "discord", label: "Discord Channel", api_key: "https://discord.com/api/webhooks/test" },
                ],
              }),
            }),
          };
        }
        if (table === "buffer_connection") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    access_token: "buf-token",
                    channels: [
                      { id: "ch-fb-1", service: "facebook", name: "Pipzo Page" },
                      { id: "ch-ig-1", service: "instagram", name: "pipzo_app" },
                    ],
                  },
                }),
              }),
            }),
          };
        }
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) };
      }),
    };

    const status = await getSocialAccountsStatus(mockAdmin, workspaceId);

    // Direct X
    expect(status.x.connected).toBe(true);
    expect(status.x.source).toBe("direct");
    expect(status.x.username).toBe("pipzodev");

    // Direct LinkedIn
    expect(status.linkedin.connected).toBe(true);
    expect(status.linkedin.source).toBe("direct");

    // Custom Discord Provider
    expect(status.discord).toBeDefined();
    expect(status.discord.connected).toBe(true);
    expect(status.discord.source).toBe("custom");

    // Facebook via Buffer
    expect(status.facebook.connected).toBe(true);
    expect(status.facebook.source).toBe("buffer");
    expect(status.facebook.channelId).toBe("ch-fb-1");

    // Instagram via Buffer
    expect(status.instagram.connected).toBe(true);
    expect(status.instagram.source).toBe("buffer");
    expect(status.instagram.channelId).toBe("ch-ig-1");
  });

  it("publishNowToAllPlatforms — runs simultaneous execution across all selected platforms", async () => {
    const insertMock = vi.fn().mockResolvedValue({ error: null });
    const mockAdmin: any = {
      from: vi.fn((table: string) => {
        if (table === "x_connection") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    workspace_id: workspaceId,
                    username: "pipzodev",
                    name: "Pipzo Official",
                    status: "connected",
                    auth_mode: "oauth2",
                    access_token: "x-token",
                  },
                }),
              }),
            }),
          };
        }
        if (table === "scheduled_posts" || table === "activity_log") {
          return { insert: insertMock };
        }
        return {
          select: () => ({
            eq: () => ({
              in: async () => ({ data: [] }),
              maybeSingle: async () => ({ data: null }),
            }),
          }),
        };
      }),
    };

    const res = await publishNowToAllPlatforms(mockAdmin, workspaceId, {
      platforms: ["x", "linkedin"],
      text: "Simultaneous test post across social media networks!",
    });

    expect(res.results).toHaveLength(2);
    // At least the insert calls to scheduled_posts are made for every platform attempted
    expect(insertMock).toHaveBeenCalled();
  });

  it("scheduleToAllPlatforms — saves scheduled post for each selected platform with ISO timestamp", async () => {
    const insertMock = vi.fn().mockResolvedValue({ error: null });
    const mockAdmin: any = {
      from: vi.fn((table: string) => {
        if (table === "scheduled_posts" || table === "activity_log") {
          return { insert: insertMock };
        }
        return {
          select: () => ({
            eq: () => ({
              in: async () => ({ data: [] }),
              maybeSingle: async () => ({ data: null }),
            }),
          }),
        };
      }),
    };

    const whenISO = "2026-10-15T15:00:00.000Z";
    const res = await scheduleToAllPlatforms(mockAdmin, workspaceId, {
      platforms: ["x", "linkedin", "facebook", "instagram"],
      text: "Global scheduled product launch!",
      scheduledAtISO: whenISO,
    });

    expect(res.ok).toBe(true);
    expect(res.scheduledCount).toBe(4);
    expect(insertMock).toHaveBeenCalled();
  });
});
