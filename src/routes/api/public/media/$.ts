// Public read-only proxy in front of Supabase Storage.
//
// Buffer fetches post media from its own servers, so the URL we hand it must be
// reachable from the public internet. When Supabase runs locally its storage
// endpoint is 127.0.0.1 only, so signed URLs are rewritten to point here (see
// toPublicMediaUrl in src/lib/public-media.server.ts) and this route forwards
// the request to the real storage endpoint.
//
// Auth: none of its own, by design. The forwarded path carries Supabase's own
// signed-URL token, which this route passes through untouched — the signature
// is what grants access, exactly as it would if Buffer hit storage directly.
// Only GET and HEAD are forwarded, so this can never be used to write.

import { createFileRoute } from "@tanstack/react-router";
import { FETCH_TIMEOUT } from "@/lib/fetch-timeout";

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "content-encoding",
]);

// Conditional / range request headers we forward upstream verbatim. This is a
// pass-through proxy in front of Supabase Storage, which already implements
// range and conditional-request semantics correctly (ETag, Last-Modified, 206,
// 304) — the job here is to relay the client's intent and hand back whatever
// storage decides, not to re-implement that logic. `range` and `if-range` are
// a pair (If-Range picks between a partial and a full response depending on
// whether the validator still matches); `if-none-match` / `if-modified-since`
// drive a 304. All four are safe to forward unconditionally: they only ever
// narrow what comes back, never widen access beyond what the signed token in
// the query string already grants.
const CONDITIONAL_REQUEST_HEADERS = ["range", "if-range", "if-none-match", "if-modified-since"];

export async function forward(request: Request, params: Record<string, string | undefined>) {
  const base = process.env.SUPABASE_URL;
  if (!base) {
    console.error("[media-proxy] SUPABASE_URL not configured");
    return new Response("Server misconfigured", { status: 500 });
  }

  // TanStack's splat param holds everything after /api/public/media/.
  const splat = params._splat ?? "";
  if (!splat || splat.includes("..")) return new Response("Not found", { status: 404 });

  const target = new URL(`${base.replace(/\/+$/, "")}/storage/v1/${splat}`);
  target.search = new URL(request.url).search;

  // Deliberately NOT `fetchWithTimeout` here. This route pipes `upstream.body`
  // straight through to the caller uninspected (see the file header) — Buffer
  // fetches full videos and images through it. `fetchWithTimeout`'s deadline
  // covers the whole request including body reads, so applying it naively
  // would abort a large, perfectly healthy download the moment the clock ran
  // out mid-stream, which is worse than having no deadline at all (this is
  // the same asset-serving path implicated in finding 7). What actually needs
  // a bound is upstream *hanging before it starts responding* — a dead
  // socket, not a slow-but-alive transfer. So the timer here only watches the
  // time-to-first-byte: it is cleared the instant `fetch` settles (i.e. once
  // response headers arrive), before any of the body is read, and never
  // touches the streaming transfer that follows.
  const connectController = new AbortController();
  const connectTimer = setTimeout(() => connectController.abort(), FETCH_TIMEOUT.api);
  const outgoing = new Headers({ accept: request.headers.get("accept") ?? "*/*" });
  for (const name of CONDITIONAL_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) outgoing.set(name, value);
  }
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers: outgoing,
      redirect: "follow",
      signal: connectController.signal,
    });
  } catch (e) {
    if (connectController.signal.aborted) {
      console.error(`[media-proxy] storage did not respond within ${FETCH_TIMEOUT.api / 1000}s`);
      return new Response("Bad gateway: storage did not respond in time", { status: 504 });
    }
    console.error("[media-proxy] upstream fetch failed", e instanceof Error ? e.message : e);
    return new Response("Bad gateway", { status: 502 });
  } finally {
    clearTimeout(connectTimer);
  }

  // 304 is a normal, successful outcome of the conditional headers we now
  // forward (see CONDITIONAL_REQUEST_HEADERS) — Response.ok is false for it,
  // but it is not an error and should not be logged as one.
  if (!upstream.ok && upstream.status !== 304) {
    console.warn(`[media-proxy] ${request.method} ${splat} → ${upstream.status}`);
  }

  const headers = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value);
  });
  // Buffer may re-fetch the asset; let it and any CDN in between cache it.
  if (!headers.has("cache-control")) headers.set("cache-control", "public, max-age=3600");

  return new Response(request.method === "HEAD" ? null : upstream.body, {
    status: upstream.status,
    headers,
  });
}

// Without these, a write verb falls through to the SSR renderer and answers
// 200 with the app shell — which reads like the write succeeded.
const methodNotAllowed = async () =>
  new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });

export const Route = createFileRoute("/api/public/media/$")({
  server: {
    handlers: {
      GET: async ({ request, params }) =>
        forward(request, params as Record<string, string | undefined>),
      HEAD: async ({ request, params }) =>
        forward(request, params as Record<string, string | undefined>),
      POST: methodNotAllowed,
      PUT: methodNotAllowed,
      PATCH: methodNotAllowed,
      DELETE: methodNotAllowed,
    },
  },
});
