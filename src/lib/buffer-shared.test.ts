// The facts the browser and the three Buffer callers have to agree on.
//
// Two findings meet here. Finding 30: the caption limits lived only in a React
// route, so the server happily sent a 3000-character caption to an X channel and
// learned it was too long from Buffer, after publishing it to LinkedIn. Finding
// 29: every Buffer failure collapsed into one anonymous string, so a revoked
// token and a dropped packet were indistinguishable and nobody was ever told to
// reconnect.

import { describe, it, expect } from "vitest";
import {
  BUFFER_TIMEOUT,
  BufferApiError,
  NETWORKS,
  bufferHttpFailure,
  bufferPublishFailureMessage,
  bufferUnreadableResponse,
  captionLimitFor,
  checkCaptionLength,
  classifyBufferFailure,
  isBufferAuthFailure,
  networkLabel,
  normalizeNetwork,
} from "./buffer-shared";
import { FETCH_TIMEOUT, FetchTimeoutError } from "./fetch-timeout";

describe("BUFFER_TIMEOUT", () => {
  it("gives the publish the longest budget of the three", () => {
    // Giving up early on a publish does not make it fail, it makes its outcome
    // unknown — which costs a held claim and a human trip to publish.buffer.com.
    expect(BUFFER_TIMEOUT.publish).toBeGreaterThan(BUFFER_TIMEOUT.metricsPage);
    expect(BUFFER_TIMEOUT.publish).toBeGreaterThan(BUFFER_TIMEOUT.read);
    expect(BUFFER_TIMEOUT.publish).toBe(FETCH_TIMEOUT.api);
  });

  it("keeps every budget short enough to matter on a serial automation tick", () => {
    for (const ms of Object.values(BUFFER_TIMEOUT)) {
      expect(ms).toBeGreaterThan(0);
      expect(ms).toBeLessThanOrEqual(FETCH_TIMEOUT.api);
    }
  });
});

describe("normalizeNetwork", () => {
  it("maps Buffer's vocabulary onto ours", () => {
    // Buffer says "twitter"; our posts say "x". Missing this used to mean no
    // limit was applied to the network with the tightest limit of all.
    expect(normalizeNetwork("twitter")).toBe("x");
    expect(normalizeNetwork("X")).toBe("x");
    expect(normalizeNetwork("LinkedIn")).toBe("linkedin");
    expect(normalizeNetwork(" instagram ")).toBe("instagram");
  });

  it("returns null for anything it does not actually know", () => {
    // "We do not know this network" must not be confused with "no limit" or,
    // worse, with some other network's limit.
    expect(normalizeNetwork("threads")).toBeNull();
    expect(normalizeNetwork("")).toBeNull();
    expect(normalizeNetwork(null)).toBeNull();
    expect(normalizeNetwork(undefined)).toBeNull();
  });
});

describe("captionLimitFor", () => {
  it("knows the limits the composer counts against", () => {
    expect(captionLimitFor("x")).toBe(280);
    expect(captionLimitFor("twitter")).toBe(280);
    expect(captionLimitFor("linkedin")).toBe(3000);
    expect(captionLimitFor("instagram")).toBe(2200);
    expect(captionLimitFor("tiktok")).toBe(2200);
    expect(captionLimitFor("facebook")).toBe(5000);
  });

  it("has no opinion about a network it does not know", () => {
    expect(captionLimitFor("pinterest")).toBeNull();
  });

  it("covers every network the Create page offers", () => {
    // The route builds its picker straight off NETWORKS, so a network added
    // here without a limit would render a counter over `undefined`.
    for (const n of NETWORKS) expect(captionLimitFor(n.key)).toBe(n.captionLimit);
  });
});

describe("checkCaptionLength", () => {
  it("passes a caption that fits", () => {
    expect(checkCaptionLength("x", "a".repeat(280))).toBeNull();
  });

  it("blocks one that does not, and says network, limit and overage", () => {
    const out = checkCaptionLength("twitter", "a".repeat(412));
    expect(out).not.toBeNull();
    expect(out?.limit).toBe(280);
    expect(out?.over).toBe(132);
    expect(out?.message).toContain("X");
    expect(out?.message).toContain("280");
    expect(out?.message).toContain("132");
    // Says what happened to this channel, not just what is wrong.
    expect(out?.message).toContain("Nothing was sent");
  });

  it("lets an Instagram story through with no caption at all", () => {
    // A story legitimately carries none. An empty caption is not over any
    // limit, so the check must be silent rather than clever here.
    expect(checkCaptionLength("instagram", "")).toBeNull();
  });

  it("declines to guess for a network it has no limit for", () => {
    expect(checkCaptionLength("mastodon", "a".repeat(50_000))).toBeNull();
    expect(checkCaptionLength(undefined, "a".repeat(50_000))).toBeNull();
  });

  it("treats the limit itself as allowed, not as over", () => {
    expect(checkCaptionLength("linkedin", "a".repeat(3000))).toBeNull();
    expect(checkCaptionLength("linkedin", "a".repeat(3001))?.over).toBe(1);
  });
});

describe("bufferHttpFailure", () => {
  it("calls a 401 what it is and says where to fix it", () => {
    const e = bufferHttpFailure(401, "Invalid access token");
    expect(e.kind).toBe("auth");
    expect(e.status).toBe(401);
    // Refused at the door: Buffer created nothing, so a retry after
    // reconnecting is safe and the publish claim can be handed back.
    expect(e.outcomeUnknown).toBe(false);
    expect(e.message).toContain("no longer valid");
    expect(e.message).toContain("Settings → Connections");
    expect(e.message).toContain("Invalid access token");
  });

  it("catches an auth failure dressed as a 200", () => {
    expect(bufferHttpFailure(200, "Unauthorized").kind).toBe("auth");
    expect(bufferHttpFailure(200, "Your token has expired").kind).toBe("auth");
  });

  it("does not read an ordinary rejection as a dead token", () => {
    const e = bufferHttpFailure(200, "Text is too long.");
    expect(e.kind).toBe("rejected");
    expect(e.message).toBe("Buffer API: Text is too long.");
  });

  it("treats a 5xx as Buffer's problem, but an ambiguous one", () => {
    const e = bufferHttpFailure(503, "Service Unavailable");
    expect(e.kind).toBe("unreachable");
    // The opposite of the 401 message: it says outright that the connection is
    // fine, so nobody goes hunting for a token that was never the problem.
    expect(e.message).not.toContain("no longer valid");
    expect(e.message).toContain("nothing needs reconnecting");
    // A proxy can answer 5xx after the origin already did the work.
    expect(e.outcomeUnknown).toBe(true);
  });

  it("treats a rate limit as certain — nothing was created", () => {
    const e = bufferHttpFailure(429, "Too many requests");
    expect(e.kind).toBe("unreachable");
    expect(e.outcomeUnknown).toBe(false);
  });
});

describe("classifyBufferFailure", () => {
  it("recognises the deadline by type, not by prose", () => {
    const f = classifyBufferFailure(new FetchTimeoutError("Buffer", 30_000));
    expect(f.kind).toBe("timeout");
    expect(f.outcomeUnknown).toBe(true);
  });

  it("carries a BufferApiError's status and verdict through unchanged", () => {
    const f = classifyBufferFailure(bufferHttpFailure(403, "Forbidden"));
    expect(f).toMatchObject({ kind: "auth", status: 403, outcomeUnknown: false });
  });

  it("assumes an unclassified throw may still have landed", () => {
    // A socket that dies mid-request is the common case, and it is exactly the
    // one where Buffer may already hold the post.
    const f = classifyBufferFailure(new Error("ECONNRESET"));
    expect(f.kind).toBe("unreachable");
    expect(f.outcomeUnknown).toBe(true);
  });

  it("survives a non-Error being thrown", () => {
    expect(classifyBufferFailure("boom").message).toBe("boom");
  });

  it("answers the one question callers branch on", () => {
    expect(isBufferAuthFailure(bufferHttpFailure(401, "nope"))).toBe(true);
    expect(isBufferAuthFailure(bufferHttpFailure(500, "nope"))).toBe(false);
    expect(isBufferAuthFailure(new FetchTimeoutError("Buffer", 1))).toBe(false);
  });
});

describe("bufferPublishFailureMessage", () => {
  const message = (e: unknown) => bufferPublishFailureMessage(classifyBufferFailure(e));

  it("never turns an unknown outcome into 'try again'", () => {
    for (const e of [
      new FetchTimeoutError("Buffer", 30_000),
      new Error("ECONNRESET"),
      bufferHttpFailure(502, "Bad Gateway"),
      bufferUnreadableResponse(200, false),
    ]) {
      const msg = message(e);
      expect(msg).not.toMatch(/try again/i);
      // Every one of them has to send the user somewhere to find out.
      expect(msg).toContain("publish.buffer.com");
    }
  });

  it("says plainly that the post may have gone out after a timeout", () => {
    const msg = message(new FetchTimeoutError("Buffer", 30_000));
    expect(msg).toContain("cannot tell whether this post went out");
  });

  it("leaves a definite refusal exactly as Buffer stated it", () => {
    const e = bufferHttpFailure(400, "Text is too long.");
    expect(message(e)).toBe(e.message);
  });

  it("keeps a BufferApiError's own explanation for an unreadable reply", () => {
    expect(message(bufferUnreadableResponse(200, true))).toContain(
      "cannot tell whether it went through",
    );
  });
});

describe("BufferApiError", () => {
  it("is an Error, so every existing catch still handles it", () => {
    const e = new BufferApiError("x", { kind: "rejected" });
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("BufferApiError");
    expect(e.outcomeUnknown).toBe(false);
  });
});

describe("networkLabel", () => {
  it("names the network the way a person would", () => {
    expect(networkLabel("twitter")).toBe("X");
    expect(networkLabel("linkedin")).toBe("LinkedIn");
  });

  it("falls back to whatever it was given rather than inventing a name", () => {
    expect(networkLabel("threads")).toBe("threads");
    expect(networkLabel(null)).toBe("this channel");
  });
});
