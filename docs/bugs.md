# Bug inventory

Findings from an evidence-based audit of the codebase (12 September 2026). Ten specialised
agents audited in parallel; every high-severity claim was then re-verified independently against
the running app and the live database. Nine claims did not survive verification and are recorded
at the bottom so they are not re-raised.

**This file is the working tracker across sessions.** Each entry carries the evidence needed to
act on it without re-deriving anything. Keep the evidence when you tick a box.

Status values: `open` · `in progress` · `fixed` · `needs owner verification` · `blocked`

A small number of security-adjacent items are tracked privately in `docs/security-notes.local.md`
(gitignored) rather than here, since this repository is public. They are referenced by number
below with the detail withheld until fixed.

---

## How to work this list

1. **The schema migration gates the publishing and concurrency work.** Do that first.
2. **Two files are contention points:** `src/lib/cron-executors.server.ts` and
   `src/lib/buffer-publish.server.ts` appear in three separate groups. Only one change at a time
   in those files.
3. **Some items cannot be verified without a real Buffer account.** They are marked
   `needs owner verification` and must not be reported as fixed by anyone else.
4. Findings are numbered by severity rank from the audit. The numbers are stable references;
   do not renumber.

### Waves

| Wave               | Contents                           | Parallel-safe         | Model  |
| ------------------ | ---------------------------------- | --------------------- | ------ |
| 1 — Foundation     | Schema migration, first test suite | No, runs alone        | Opus   |
| 2 — Isolated fixes | 18, 32, 43, 45, 46, 47, 51 ✅ done | Yes, one agent each   | Sonnet |
| 3a — Publishing    | 1, 2, 12, 13, 22, 24 ✅ done       | No, sequential        | Opus   |
| 3b — Concurrency   | 4, 5, 14, 15, 17 ✅ done           | No, after 3a          | Opus   |
| 3c — Network       | 9, 10, 29, 30 ✅ done              | No, after 3b          | Mixed  |
| 4 — Media          | 7, 8, 16, 25 ✅ done               | Yes, alongside wave 3 | Mixed  |
| 4 — Orphans        | 6 + 42 ✅ done                     | Yes, alongside wave 3 | Opus   |
| 5 — Remainder      | everything else                    | Mixed                 | Sonnet |

**Finding 42 moved from wave 2 to wave 4.** The delete confirmation and the Buffer-orphan fix both
rewrite the same delete handler in `post-editor.tsx`; done separately, the second change undoes the
first.

---

## P1 — High

### 1. Autonomous posting fails silently and permanently on a dead Buffer token

- **Status:** `fixed` (wave 3a) — row marked `publish_failed` and `runDailyPost` now throws, so the run records as an error and the existing Slack failure notification fires. A real success writes `published`. Approval-on behaviour unchanged. **Still `needs owner verification`** for the end-to-end path against a live Buffer account.
- **Wave:** 3a
- **Where:** `src/lib/cron-executors.server.ts:216-247` → `src/lib/buffer-publish.server.ts:66-172`
- **Call chain:** cron tick → `findAndRunDueJobs` → `runJob` → `runDailyPost` → `publishScheduledPostToBuffer`

**Evidence**

```ts
const pub = await publishScheduledPostToBuffer(admin, job.workspace_id, {…});
publishNote = pub.ok
  ? `published to Buffer (…)`
  : `internal only: ${pub.error ?? "Buffer publish failed"}`;
return { summary: …, result: … };   // a NORMAL return
```

`publishScheduledPostToBuffer` never throws. Every failure path returns `{ok:false}`:
line 92 (no connection), line 100 (no matching channel), lines 145-151 (Buffer rejected),
lines 164-170 (catch). So `runJob` takes its success branch at lines 663-696, writes
`cron_runs.status='ok'` and an `activity_log` row with `action='cron.daily_post.ok'`,
`status:'ok'`. The Slack failure notification exists only in `runJob`'s catch block at
lines 752-757, which this path never reaches.

`runMetricsSync` in the same file (line 560) _does_ `throw` when the token is missing, so that
job alerts correctly. The inconsistency is local to `runDailyPost`.

**Trigger:** autonomous daily post enabled (`require_approval = false`) plus an expired or
revoked Buffer token.

**Impact:** the headline capability stops working with no signal. Every dashboard shows green.
The only trace is the phrase "internal only" inside an otherwise success-sounding summary.

**Fix:** throw from `runDailyPost` when approval is off and the publish failed, routing through
the existing catch and notifier; or call `notify(..., "failure", ...)` directly at the failure
site. Depends on finding 12 so the row can also be marked `publish_failed`.

**Verification:** `needs owner verification` for the end-to-end path. Unit-testable by stubbing
the publish helper to return a 401 failure and asserting the run records as failed.

---

### 2. Turning approval off strands every post already in the queue

- **Status:** `fixed` (wave 3a) — reads pending posts first, confirms before publishing to real channels, offers turning approval off _without_ publishing, then claims and publishes each post individually with an honest per-post outcome.
- **Wave:** 3a
- **Where:** `src/routes/automations.tsx:297-303`, `saveApproval()`

**Evidence**

```ts
await supabase
  .from("scheduled_posts")
  .update({ status: "scheduled" })
  .eq("workspace_id", activeWorkspaceId)
  .eq("status", "pending_approval")
  .select("id");
// no publish call
```

Only three call sites in the repository publish a scheduled post, and this is none of them:
`src/routes/approvals.tsx:75` (`bufferPublishApprovedPost`),
`src/lib/agent-tools/approvals.server.ts:90`, and
`src/lib/cron-executors.server.ts:217`. No worker anywhere scans for `status='scheduled'` and
publishes, so swept rows are never sent.

**Impact:** the toast reads "N pending posts approved automatically". They never go out, and
they now look identical to healthy scheduled posts on the calendar.

**Fix:** iterate the swept ids through the same publish helper the per-item approval uses, and
report per-row outcomes instead of one optimistic message.

---

### 3. Azure image generation is advertised everywhere but rejected by the database

- **Status:** `fixed` — `20260912120000_audit_wave1_foundation.sql`, applied 12 Sep 2026
- **Verified:** constraint now reads `('openai','gemini','azure')`; an Azure INSERT was proven to
  succeed inside a transaction that was rolled back, leaving the table unchanged. No code change
  was needed — the zod validator and the adapter already supported it.
- **Wave:** 1
- **Where:** `image_providers` CHECK constraint vs `src/routes/conexiones.tsx:99`,
  `src/lib/image-providers.functions.ts:54`, `src/lib/types.ts:100`, `src/lib/image-gen.server.ts:139`

**Evidence**

```sql
-- live constraint
CHECK ((provider = ANY (ARRAY['openai'::text, 'gemini'::text])))
```

```ts
provider: z.enum(["openai", "gemini", "azure"]),   // validator accepts three
```

The settings screen offers "Azure OpenAI (image deployment)" with its own hint text and default
endpoint, the type union includes it, and `generateAzure` is fully implemented. `saveImageProvider`
inserts and surfaces the raw constraint violation to the user.

The identical bug was hit and fixed for video providers in
`supabase/migrations/20260818090000_video_provider_kinds.sql`, whose comment says exactly that.
The image equivalent was never written.

**Fix:** one migration widening the constraint, mirroring the video one. Add a parity check so
validator values and constraint values cannot drift again.

---

### 4. Overlapping automation ticks can run the same job twice

- **Status:** `fixed` (wave 3b) — jobs are claimed with a conditional update on the exact `next_run_at` this tick read; a lost claim skips the job and is reported as contention. The claim IS the schedule advance, so a crashed job waits for its next slot rather than hot-looping. Same trade the heartbeat already makes.
- **Wave:** 3b
- **Where:** `src/lib/cron-executors.server.ts:762-792`, `findAndRunDueJobs`

**Evidence**

Due jobs are selected by `enabled = true AND next_run_at <= now` (limit 25), run serially, and
`next_run_at` is advanced only _after_ `runJob` resolves. `cron_jobs` has no claim column, no
lock, and no advisory lock anywhere in the file or in any migration.

`src/lib/heartbeat.server.ts:230-234` solves exactly this, with a comment saying so:

```ts
// Claim the slot so a slow run cannot be double-fired by the next tick.
await admin.from("workspaces").update({ heartbeat_last_run_at: now.toISOString() }).eq("id", w.id);
await runHeartbeat(admin, w.id);
```

**Reachability, precisely.** launchd's `StartInterval` will not overlap a job with itself, but it
supervises the `curl` process, not the server. When curl gives up at `--max-time 300` the next
tick is free to start while the original request handler is still running, because nothing in
`src/routes/api/public/hooks/cron-tick.ts` observes client disconnect. With 25 jobs serial, each
doing a model call, an image generation and a publish, and no fetch timeouts anywhere
(finding 9), exceeding 300s is very reachable. A manual `npm run cron:once` alongside the
scheduler, or the documented pg_cron production topology, triggers it directly.

**Fix:** claim atomically before running —
`update cron_jobs set next_run_at = <computed> where id = $1 and next_run_at = <value just read> returning id`
— and skip the job when no row was affected. No schema change needed.

---

### 5. Approving the same post twice publishes it twice

- **Status:** `fixed` (wave 3b) — the transition is a conditional update returning the affected row; only the caller that actually moved the post publishes, and a loser is told it was already handled. Reject races correctly too. A second line of defence exists in the publish claim (finding 14).
- **Wave:** 3b
- **Where:** `src/lib/agent-tools/approvals.server.ts:57-105`, `resolve()`

**Evidence**

```ts
const { data: row } = await db.from("scheduled_posts").select(…).maybeSingle();
if (row.status !== "pending_approval") return { ok:false, … };
…
await db.from("scheduled_posts").update(patch).eq("id", id);
// the update does NOT repeat .eq("status","pending_approval")
```

Guard and write are separate round trips and the write is unconditional. Two concurrent
approvals (double-click, two tabs, or the user and the agent acting together) both pass the
check and both call `publishScheduledPostToBuffer`, which has no idempotency check of its own
(finding 14).

**Fix:** conditional atomic flip returning the affected row; publish only when a row changed.

---

### 6. Deleting a post leaves the live Buffer post orphaned

- **Status:** `fixed` (wave 4) — removal is Buffer first, row second, storage third; an upstream failure aborts rather than deleting a row while the post stays live. The chat tool chains it, and `listScheduled` now returns `bufferId`. Rescheduling a live post warns that the published copy keeps its original time, since Buffer has no move call here.
- **Wave:** 4
- **Where:** `src/components/post-editor.tsx:398-406`, `src/lib/schedule-store.ts:217-242`,
  `src/routes/chat.tsx:818-829`, `src/routes/calendario.tsx:114-124`

**Evidence**

The delete button calls `scheduleStore.remove(item.id)`, which issues a plain row delete with no
reference to `buffer_id`. The same component renders an Unpublish button at lines 365-384 gated
on `item.bufferId`, so the code demonstrably knows the post is live.

The agent's `deletePost` tool has the same gap, and the tool documentation in
`src/routes/api/chat.ts:156` describes `deletePost` and `bufferDeletePost` as unrelated tools
with no instruction to chain them. `listScheduled` also strips `bufferId` before returning to the
model, so the agent cannot tell a live post from a draft. Calendar drag-and-drop reschedules live
posts the same way.

`approvals.tsx`'s delete is safe in practice: rejected posts never acquire a `buffer_id`.

**Fix:** when `buffer_id` is present, delete remotely first and only then remove the row;
surface a failure rather than proceeding. Include `bufferId` in `listScheduled` output. Add a
confirmation step (finding 42).

---

### 7. The media proxy cannot serve partial content, and claims it can

- **Status:** `fixed` (wave 4) — `content-length` is no longer stripped (it is not hop-by-hop), and `Range`/`If-Range`/`If-None-Match`/`If-Modified-Since` are forwarded with 206, `Content-Range` and 304 passed through. Verified live. The wave 3c connect-only timeout is preserved and pinned by a test.
- **Wave:** 4
- **Where:** `src/routes/api/public/media/$.ts:16-45`

**Evidence, reproduced live**

```
$ curl -H "Range: bytes=0-99" …/api/public/media/… | wc -c
5389424            # full file, not 100 bytes

HTTP/1.1 200       # not 206
accept-ranges: bytes        # forwarded from upstream, misleading
Transfer-Encoding: chunked  # no Content-Length at all
```

`content-length` is listed in the proxy's `HOP_BY_HOP` set and stripped. It is not a hop-by-hop
header (RFC 7230 §6.1 does not list it). The client's `Range` header is never read or forwarded:
the upstream fetch passes only `accept`.

**Impact:** this is the route Buffer fetches every image, video and carousel through
(`toPublicMediaUrl` rewrites all of them here). Media consumers commonly probe size first and
fetch large files in ranges. A downloader that requires either fails, and because the image
attach path fails soft, the post publishes with no media and no error.

**Fix:** remove `content-length` from the stripped set, forward `Range` upstream, pass the
resulting 206 and `Content-Range` through unchanged.

**Verification:** `needs owner verification` for the Buffer end of it.

---

### 8. Library images bypass storage and land in a database text column

- **Status:** `fixed` (wave 4) — uploads go through a server function that sniffs magic bytes, caps at 15MB, checks workspace membership before the service-role write, and stores a pointer. Legacy base64 rows still read correctly; no migration or backfill.
- **Wave:** 4
- **Where:** `src/lib/brand-store.ts:250-273` (`addImage`), `src/routes/library.tsx:143-176`
  (`handleImageFiles`), `src/components/post-editor.tsx:139-152`

**Evidence**

The uploader reads the file into a base64 data URL in the browser and inserts it directly into
`brand_images.url`, a plain `text` column with no length or format constraint. No size check and
no MIME check on either side; the picker's `accept="image/*"` is advisory and bypassed by
drag-and-drop.

`brand_images.storage_path` and `storage_path_video` exist in the schema but are never referenced
anywhere in `src`. Video uploads (`uploadLibraryVideo`) and the cron daily visual
(`cron-executors.server.ts:326-358`) both do it correctly, the latter with a comment explaining
that a base64 row would be wasteful.

`brandStore.hydrate()` then does `select("*")` over the whole workspace on every library load,
every workspace switch and every refresh, pulling every stored blob in one round trip.

**Fix:** route image uploads through a server function mirroring the video path — validate type
and real size, upload to the `media` bucket, store `storage_path` plus a signed URL. Add a length
CHECK as a backstop.

---

### 9. No outbound request anywhere has a timeout

- **Status:** `fixed` (wave 3c) — `src/lib/fetch-timeout.ts` is the single implementation, deliberately without retry. Deadlines chosen per call: inference 120s, downloads 90s, ordinary api 30s, job polling 15s, Slack 8s. The media proxy is bounded on connect only, because an abort signal covers the body stream and would kill large healthy downloads.
- **Wave:** 3c
- **Where:** ~11 call sites

```
buffer.functions.ts:66            buffer-publish.server.ts:20       buffer-analytics.server.ts:13
image-gen.server.ts:90,111,124,149,169,200                          video-adapters.server.ts:51,100
video-gen.functions.ts:69         firecrawl.server.ts:13            websearch.server.ts:77
scrapecreators.server.ts:25       notifications.server.ts:62        engagement/unipile.server.ts:70
engagement/reference-posts.server.ts:51                             api/public/media/$.ts (upstream)
```

A repo-wide search for `AbortSignal` / `AbortController` / `signal:` returns only two hits, both
browser-side helpers unrelated to network calls (`animation/export.ts:162`, `stream-image.ts:11`).

**Impact:** root enabler of finding 4. The calls on the automation path — metrics, publishing,
image generation, competitor scraping, inbox ingest, and every Slack notification — can each
stall a tick past the point where overlap becomes possible.

**Fix:** one shared `fetchWithTimeout` using `AbortSignal.timeout(...)`, applied at every site,
tuned per provider.

---

### 10. Inbox ingest makes hundreds of sequential untimed calls per account

- **Status:** `fixed` (wave 3c) — wall-clock budget (ingest 45s, sweep 120s), four parallel lanes on reads, writes still sequential. Claims the budget could not reach are released back to `needs_reply`. Residual, documented in code: the budget bounds work _started_, so a sweep can overshoot by one call's deadline.
- **Wave:** 3c
- **Where:** `src/lib/engagement/engagement.server.ts:115-363`, `ingestEngagement`

**Evidence**

Per connected account, sequentially: profile, posts, then comments per post (≤10), then a reply
check per comment with replies (≤30), then chats, then messages and attendees per chat (≤20).
Worst case roughly 353 sequential un-timed HTTP calls per account.

Reached from `heartbeat.server.ts:95` (which loops ≤50 workspaces per tick, then a serial
classify loop ≤25 and a serial draft/send loop ≤15), from the public Unipile webhook
(`api/public/hooks/unipile.ts:58`, which re-runs a full sweep on every delivery with no dedup),
and from chat tools.

**Fix:** bound the fan-out, parallelise with a concurrency limit, add timeouts, and give the
webhook a dedup key or debounce so a burst collapses into one sweep.

---

### 11. No test suite exists and no runner is installed

- **Status:** `in progress` — wave 1
- **Wave:** 1
- **Where:** `package.json`, `.github/workflows/ci.yml`

No test or spec files anywhere, no `test` script, no framework in devDependencies. CI runs
`tsc --noEmit` and `eslint` only, neither of which verifies behaviour.

Highest-value targets, all pure logic needing no mocking: the encryption round-trip and its
fallback, `nextFireFromCron`, `monthStart`, `isSafeToAutoSend`, `toPublicMediaUrl` /
`assertPubliclyFetchable`, `safeHttpUrl`, the playbook front-matter parser, the Buffer payload
builders (`serviceMatches`, mode selection, assets array), and `clampDurationForProvider`.

**Fix:** add Vitest (no extra bundler config needed here), cover those first, then add build and
test steps to CI.

---

## P2 — Medium

### 12. A failed publish is unrepresentable — no failure status exists

- **Status:** `fixed` (wave 1 schema + wave 3a code).
  `publish_failed` is now a legal value (`20260912120000`, applied 12 Sep 2026). Nothing writes
  it yet; wave 3a does that.
- **Wave:** 1 (schema, done) then 3a (code)
- **Where:** `scheduled_posts` CHECK constraint; written at `src/lib/cron-executors.server.ts:196`

`CHECK (status IN ('draft','scheduled','published','pending_approval','rejected'))` — no value
means "tried to publish and failed". `runDailyPost` writes `status:'scheduled'` _before_
attempting the publish, so a failed autonomous publish is stored as a healthy-looking scheduled
row. Nothing revisits it: `metrics_sync` explicitly excludes it with
`.not("buffer_id","is",null)` at line 589, and the calendar counts `status==='scheduled'` as a
normal bucket.

**This is the schema root of findings 1, 2, 13 and 22.** Fixing it makes the others diagnosable.

**Fix:** add `publish_failed` to the constraint, write it on failure, and add a reconciliation
query for rows that are `scheduled` with `buffer_id IS NULL` past some age.

---

### 13. Publishing always picks the first channel of a network

- **Status:** `fixed` (wave 3a) — `buffer_channel_id` is now read and preferred on the approval path; a missing pinned channel is a clear error; an ambiguous match names the channel used and the others that matched. Channel-cache refresh before an unattended publish was deliberately NOT added (extra network call on the publish path); still open as a smaller follow-up.
- **Wave:** 3a
- **Where:** `src/lib/buffer-publish.server.ts:50-55, 94-100`

```ts
const channel = channels.find(
  (c) => c?.id && serviceMatches(post.platform, String(c.service ?? "")),
);
```

`publishScheduledPostToBuffer` takes no channel id and always picks the first match.
`scheduled_posts.buffer_channel_id` exists for exactly this and is populated by the manual
schedule-dialog path (`schedule-store.ts:133-134`), but `bufferPublishApprovedPost`
(`buffer.functions.ts:685`) selects `id,post,image_url,scheduled_at,status` and never reads it.
The cron insert never sets it either.

The cached `channels` list is refreshed only when a human visits Settings, never before a cron or
approval publish.

**Impact:** two LinkedIn pages in one Buffer org means one is silently unreachable, and the call
still reports success.

**Fix:** persist an explicit channel id at creation time, prefer it over `serviceMatches`, warn
when ambiguous, and refresh the channel cache before an unattended publish.

---

### 14. An unparseable success response crashes publish and invites a double post

- **Status:** `fixed` (wave 3b) — an unreadable 200 is now its own error saying the outcome is unknown, and publish idempotency is enforced in `publishScheduledPostToBuffer` itself so every publish path is covered by one claim.
- **Wave:** 3b
- **Where:** `src/lib/buffer-publish.server.ts:30-45`; identical pattern at `buffer.functions.ts:76-88`

```ts
let json = null;
try { json = await res.json(); } catch { /* empty */ }
if (!res.ok || json?.errors?.length) { …throw… }
return json!.data as T;          // json is null here → TypeError
```

If Buffer answers 200 with a body that fails to parse (proxy interstitial, truncated response),
the guard passes and `json!.data` throws `Cannot read properties of null (reading 'data')`. The
caller's catch turns that into `{ok:false, error:"Cannot read properties of null…"}` — so a post
Buffer may have **accepted** is reported as failed, with a message that tells the user nothing.
With no `buffer_id` idempotency check before `createPost`, a retry then double-publishes.

**Fix:** treat an unparseable body as an explicit ambiguous-response error; check `buffer_id`
before creating; thread the HTTP status through (see finding 29).

---

### 15. Concurrent inbox sweeps double-process the same item

- **Status:** `fixed` (wave 3b) — items are claimed atomically before drafting, and the webhook debounces a burst into one sweep without dropping the newest delivery. Residual: the daily autonomous budget is still not fully atomic (see the reservation comment in `sendReply`); a hard crash can leave an item claimed.
- **Wave:** 3b
- **Where:** `src/lib/engagement/engagement.server.ts:880-893` and `handleItem` at 605-659

Selects `status='needs_reply'` (limit 15) then loops `handleItem`, which updates the item status
only _after_ drafting. Non-atomic read-then-act, no lock, no dedup key;
`engagement_replies` rows are inserted, not upserted. `api/public/hooks/unipile.ts:58` calls the
sweep with default options on every delivery and never uses the `account_id`/`event` fields it
parses.

**Severity note:** live defaults are `engagement_reply_mode='draft'`,
`engagement_safe_categories={praise}`, `engagement_daily_limit=10`. Autonomous send is opt-in, so
by default the damage is duplicate drafts, duplicate classification spend and duplicate Slack
notifications. **This is P1 for any workspace in autonomous mode**, where it means duplicate
public replies.

**Fix:** atomic claim (`update … where status='needs_reply' returning *`), plus a webhook dedup
key or per-workspace lock.

---

### 16. Storage files are never deleted

- **Status:** `fixed` (wave 4) — both library assets and scheduled-post images now remove their objects, non-fatally. An object referenced by both a post and the library is left alone by the post delete, since an orphaned file is cheaper than a destroyed library image.
- **Wave:** 4
- **Where:** `src/lib/brand-store.ts:299-306` (`removeImage`), `src/lib/schedule-store.ts:222`

A repo-wide search finds only `.upload()` and `.createSignedUrl()` against Supabase Storage —
**zero `.remove(` calls anywhere in `src`**. Deleting a library asset or a scheduled post removes
the row and leaves the object. `storage.objects` has no foreign key to any application table, so
nothing cascades either.

The mirror gap exists on upload: `handleVideoFiles` uploads via the server function and then
separately inserts the row client-side; a failure between the two orphans the file.

**Impact:** unbounded storage growth, and a data-retention gap — "deleting" a brand asset does
not delete user-uploaded imagery.

**Fix:** resolve the path and `storage.remove([path])` before deleting the row, non-fatal on
failure but logged. Add a reconciliation sweep for orphans.

---

### 17. Default-provider flip is non-atomic, two defaults possible

- **Status:** `fixed` (wave 3b) — partial unique indexes now enforce one default per workspace; clear-then-set is the only ordering that cannot trip them, a lost race retries once, and a failure restores the previous default rather than leaving none.
- **Wave:** 3b
- **Where:** `src/lib/image-providers.functions.ts:66-97, 105-117`; same shape in
  `src/lib/llm-providers.functions.ts:79-108`

Clear-then-set across two PostgREST round trips with no transaction, and there is no partial
unique index enforcing one default per workspace on either table. Two concurrent saves can leave
two rows with `is_default = true`. `src/lib/llm-resolver.server.ts:120-133` then orders by
`is_default desc, created_at desc` and takes the first, so the tiebreak silently becomes
creation order rather than the user's choice.

**Fix:** add `create unique index … on image_providers (workspace_id) where is_default` (and the
same for `llm_providers`) **together with** the code change — the index alone would start
rejecting writes from the current save path. Deliberately excluded from the wave 1 migration
for that reason.

---

### 18. Tracked privately

- **Status:** `fixed` (wave 2)

Transport-level weakness in an outbound URL guard. Severity P2. Fixed by requiring https, mirroring
a guard that already existed elsewhere in the codebase. Finding 47 (IPv6 loopback never blocked) and
three unblocked address ranges were closed in the same change, since they live in the same function.
Detail in `docs/security-notes.local.md`.

---

### 19. A row cap silently truncates two 5,000-row reads

- **Status:** `fixed` (wave 5) — the usage sum paginates to completeness; the inbox dedup is explicitly bounded to the most recent 1000 and gained the sort order it was missing. Fixed differently on purpose.
- **Wave:** 5
- **Where:** `src/lib/usage-caps.server.ts:64`, `src/lib/engagement/engagement.server.ts:136`

`supabase/config.toml` sets `max_rows = 1000`. Both sites request `.limit(5000)` and assume a
complete result. The usage-cap fallback under-counts past 1000 qualifying rows, compounding the
fact that `assertWithinCap` already fails open when the meter errors. The engagement dedup fetch
additionally has **no `.order()`**, so which 1000 rows come back is unspecified — worst for the
highest-volume workspaces.

**Fix:** paginate, or aggregate in the database as `ai_usage_month_total` already does.

---

### 20. Hand-rolled base64 blocks the event loop

- **Status:** `fixed` (wave 5) — both encode and decode now use Buffer.
- **Wave:** 5
- **Where:** `src/lib/image-gen.server.ts:124-128` (`generateOpenAI`) and `:168-173` (`generateAzure`)

```ts
let bin = "";
for (const b of buf) bin += String.fromCharCode(b);
return { b64: btoa(bin) };
```

Measured against `Buffer.toString("base64")`: 1 MB 38.8 ms vs 0.1 ms, 8 MB 247 ms vs 0.6 ms,
32 MB 1409 ms. Roughly 300-450× slower, and synchronous, so it blocks Node's single thread —
including any in-flight cron tick. On the `daily_post` path. `crypto.server.ts` uses the same
pattern but only on short secrets, which is immaterial.

**Fix:** `Buffer.from(bytes).toString("base64")`.

---

### 21. Timezone hard-coded to Madrid in seven places, with no setting

- **Status:** `fixed` (wave 5) — a real workspace setting threaded through all seven sites, with per-zone cached formatters (a test pins the cost) and an explicit per-job zone still winning. Full IANA picker.
- **Wave:** 5
- **Where:** `src/lib/metrics-context.server.ts:33` (a module constant),
  `src/routes/api/chat.ts:156`, `src/routes/automations.tsx:14`,
  `src/lib/cron-executors.server.ts:776`, `src/lib/workspace-context.server.ts:126`,
  `src/lib/agent-tools/automations.server.ts:7`, `src/playbooks/buffer.md:11`

There is no `timezone` column on `workspaces`. Two concrete impacts: the chat system prompt tells
the model "assumed time zone: Europe/Madrid", skewing every relative date for a user elsewhere;
and all "best time to post" analytics bucket by Madrid wall clock regardless of audience, so a
US-audience workspace has every hour-of-day insight shifted 5-9 hours.

Manual scheduling via `schedule-dialog.tsx` correctly uses the browser's real offset, so the app
is internally inconsistent as well.

**Fix:** add a workspace timezone setting and thread it through all seven sites.

---

### 22. Live posts never show as published in the calendar

- **Status:** `fixed` (wave 3a, refined in wave 5) — the calendar derives state from whether the post reached Buffer, and wave 5 split that into Sent versus Queued.
- **Wave:** 3a
- **Where:** `src/routes/calendario.tsx:221, 256-260`; `src/components/post-editor.tsx:352-364`

`status='published'` is written by exactly one place: a manual "Mark published" button. No
automated publish path writes it — `publishScheduledPostToBuffer:153-155` stamps only `buffer_id`
and `buffer_channel_id`. So the calendar's "Published" counter and its strikethrough styling
reflect only hand-marked posts, and a genuinely live post is indistinguishable from an
internal-only one.

The codebase already documents this gap for the weekly report at
`cron-executors.server.ts:576-578`, where it was worked around by counting `buffer_id` instead —
but the UI was never updated.

**Fix:** derive "published" from `buffer_id IS NOT NULL` in the UI, or write the status on a
confirmed publish. Pairs with finding 12.

---

### 23. Paid video generation is lost if the tab closes

- **Status:** `wontfix` (owner decision) — warn clearly instead of persisting and resuming. Video generation is started manually, so a warning covers most of the loss without new infrastructure.
- **Wave:** 5
- **Where:** `src/routes/library.tsx:304-361`, `src/routes/chat.tsx:606-661`

Both call sites hold the provider's `operationName` only in component state, poll every 8s, and
give up after 6 minutes. `operationName` appears in no table, queue or cron job, so nothing can
resume it. The chat handler's own error message admits the loss: "The render may still complete
on Google's side, but nothing was saved."

**Fix:** persist `operationName` plus provider and workspace the moment generation starts, and
add a sweep that completes any row still pending past its window.

---

### 24. Automation runs stick at "running" forever after a crash

- **Status:** `fixed` (wave 3a) — stale runs are reaped at the top of each tick after 30 minutes, chosen as longer than any job can legitimately take and pinned by a test.
- **Wave:** 3a
- **Where:** `src/lib/cron-executors.server.ts:649-760`

`cron_runs` rows are inserted with `status='running'` and only updated inside `runJob`'s own
try/catch. A process crash mid-run leaves the row `running` permanently; no reaper exists.

**Fix:** a startup or periodic sweep marking stale `running` rows as errored past a threshold.

---

### 25. Three upload paths accept unbounded payloads server-side

- **Status:** `fixed` (wave 4) — PDF capped at 20MB with a magic-number check, matching the cap the UI already claims; the image route has a real schema instead of a cast; the video reference reuses the shared image validator.
- **Wave:** 4
- **Where:** `src/lib/ai.functions.ts:308-312` (no `.max()` on `dataUrl` despite a 20 MB client
  claim at `guia.tsx:62`), `src/routes/api/generate-image.ts:8-21,189` (body read as
  `(await request.json()) as Body` with no runtime validation at all),
  `src/lib/video-gen.functions.ts:104-113` (`referenceImageDataUrl` has no cap)

`uploadLibraryVideo` is the one path that gets this right, with
`.max(145 * 1024 * 1024)` and a comment explaining it rejects rather than trusting the client.

**Fix:** apply the same zod `.max()` pattern; replace the untyped cast in `generate-image.ts`
with a real schema.

---

### 26. Schedule dialog reports success before the write completes

- **Status:** `fixed` (wave 5) — the dialog awaits the write, stays open on failure and keeps the user's input.
- **Wave:** 5
- **Where:** `src/components/schedule-dialog.tsx:120-169`

`scheduleStore.add(...)` returns `{ok, error}` specifically so callers can report the real
outcome. The dialog does not await it, shows success and closes; a contradicting failure toast
can then appear with no way to retry from the closed dialog.

---

### 27. Five settings panels swallow load errors as "not configured"

- **Status:** `fixed` (wave 5) — all five panels distinguish loading, empty and failed, with retry. The remove button gained a pending guard and error handling.
- **Wave:** 5
- **Where:** `src/components/service-credentials-section.tsx`, `notifications-section.tsx`,
  `unipile-section.tsx`, `playbooks-section.tsx`, `llm-providers-section.tsx`

The same `.catch(() => {})` pattern makes a failed load indistinguishable from an empty state.
`service-credentials-section.tsx:151-157`'s Remove button additionally has no try/catch and no
pending guard, so a failed delete is a silent no-op.

---

### 28. Chat has no persistence, so a publish can be re-triggered

- **Status:** `open` — chat still has no persistence. Lower priority now that `deletePost` chains the Buffer removal itself and the publish claim blocks a duplicate, but re-triggering a publish after navigating away is still possible.
- **Wave:** 5
- **Where:** `src/routes/chat.tsx:368`

`useChat` is configured with no `id` and no persistence, and nothing aborts or saves on unmount.
Nine tools execute in the browser, including `bufferSchedulePost`. A real publish started in
`onToolCall` completes server-side even if the user navigates away, but the transcript recording
it is discarded — so the user can reasonably re-issue the request and publish twice.

---

### 29. An expired token is indistinguishable from a network blip

- **Status:** `fixed` (wave 3c) — failures carry their HTTP status and classify into auth / timeout / unreachable / rejected, with fixed reconnect and transient sentences reused across the Connections page, the automation failure notification and the metrics toast. A definite refusal releases the publish claim; an unknown outcome keeps it.
- **Wave:** 3c
- **Where:** `src/lib/buffer.functions.ts:57-89, 100-138`; `buffer-publish.server.ts:11-46`;
  `buffer-analytics.server.ts:12-26`

All three independent `gql()` copies collapse every failure into one error string with no HTTP
status. `fetchStatus`'s catch returns `{connected:false, error}` regardless of cause, so a 401
and a transient failure look identical. Nothing marks the connection as needing reconnection.
`video-adapters.server.ts:59-61` does check for 401/403, so the pattern exists in the codebase.

**Fix:** thread the status through, persist a "needs reauth" state, surface it distinctly.

---

### 30. No per-network caption length check before publishing

- **Status:** `fixed` (wave 3c) — limits moved to a shared module imported by both the create screen and the server, validated per target channel before the request via the existing per-channel block mechanism. The twitter/x alias is mapped. Instagram stories still publish with no caption.
- **Wave:** 3c
- **Where:** `src/routes/crear.tsx:48-53` (limits defined but only used for a counter) vs
  `src/lib/buffer.functions.ts:387` (`text: z.string().max(10000)` only)

Per-network limits (X 280, LinkedIn 3000, Instagram 2200, Facebook 5000) exist solely to render
an "Over by N" label; nothing blocks sending. One call's `channelIds` can span networks, so a
LinkedIn-length caption sent alongside an X channel publishes to one and fails on the other after
a live round trip.

**Fix:** move the limit table to a shared module and validate per target channel inside
`bufferCreatePost`, reusing the existing per-channel `blocked` mechanism at lines 565-593.

---

### 31. Port 5173 is hard-coded in six places while the app runs on 5174

- **Status:** `fixed` (wave 5) — one `APP_PORT` env var read by the vite config, both cron scripts and the tunnel script. Supabase's config cannot read env vars for `site_url`, so that keeps the default with a documented recovery.
- **Wave:** 5
- **Where:** `vite.config.ts:36`, `package.json` (`tunnel` script), `scripts/cron-tick.sh:14`,
  `scripts/install-cron.sh`, `supabase/config.toml:43-48`, plus README and DOCUMENTATION prose

`strictPort: true` makes a clash fail fast, which is correct — but once a developer works around
it with `--port 5174` (as on this machine, because another app owns 5173), the auth redirect
allow-list, the tunnel script, and the cron tick URL all silently target the wrong port with no
documented recovery.

**Fix:** derive the port from one environment variable consumed by all six.

---

## P3 — Low

| #   | Finding                                                                                                                                                                                                                                                                                                                          | Where                                   | Status  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ------- |
| 32  | **FIXED (wave 2).** Competitor and search result links skip the existing URL sanitiser. React 19 blocks `javascript:` so this is defence-in-depth, not a vulnerability — see rejected claim R1.                                                                                                                                  | `competidores.tsx:192`, `chat.tsx:1573` | `open`  |
| 33  | Tracked privately — see `docs/security-notes.local.md`.                                                                                                                                                                                                                                                                          | —                                       | `open`  |
| 34  | **FIXED (wave 5 migration).** `agent_memory` and `post_metrics` were the only 2 of 23 `workspace_id` columns with no foreign key. Latent: no workspace-deletion feature exists yet.                                                                                                                                              | both tables                             | `open`  |
| 35  | Buffer connection policy is owner-only for SELECT too, so a teammate sees "not connected". Latent: no invite flow exists, live DB has one member. Becomes P1 the day invites ship.                                                                                                                                               | `buffer_connection` policy              | `open`  |
| 36  | **FIXED (wave 5).** Generated database types are stale: missing `social_posts.author`, `social_posts.note`, `buffer_connection.access_token_enc`, and the `ai_usage_month_total` function. Cosmetic only because every caller casts around the typed client.                                                                     | `types.ts:1055, 298`                    | `open`  |
| 37  | Missing indexes on the monthly-usage query and on `llm_providers.workspace_id`. Added as `activity_log_ws_action_created_idx` and `llm_providers_workspace_idx`. Follow-up: `activity_log_action_idx` is now a strict prefix of the new index and is redundant for reads — queue its removal.                                    | `activity_log`, `llm_providers`         | `fixed` |
| 38  | **FIXED (wave 5).** No password reset flow exists anywhere.                                                                                                                                                                                                                                                                      | `auth.tsx`                              | `open`  |
| 39  | **FIXED (wave 5).** Auth redirect allow-list points at port 5173.                                                                                                                                                                                                                                                                | `supabase/config.toml:43`               | `open`  |
| 40  | **FIXED (wave 5), with finding 48.** A malformed cron expression or timezone silently degrades to now+24h with no log. Not reachable via the UI, which validates first, but RLS lets a member write the column directly. **See finding 48 — the fallback is less reachable, and the real behaviour worse, than this described.** | `cron-executors.server.ts:56-64`        | `open`  |
| 41  | Spring-forward shifts an 02:30 job to 03:30 for that day only. Verified empirically against the pinned cron-parser. Fall-back does not double-fire.                                                                                                                                                                              | `cron-executors.server.ts:56`           | `open`  |
| 42  | **FIXED (wave 4).** Destructive delete has no confirmation step.                                                                                                                                                                                                                                                                 | `post-editor.tsx:398`                   | `open`  |
| 43  | **FIXED (wave 2).** Chat auto-scroll forces the view to the bottom on every streamed token regardless of where the reader has scrolled.                                                                                                                                                                                          | `chat.tsx:1298-1300`                    | `open`  |
| 44  | **FIXED (wave 5).** No unsaved-work guard anywhere; `/crear` and the chat composer lose in-progress work on navigation.                                                                                                                                                                                                          | repo-wide                               | `open`  |
| 45  | Meaningful image has `alt=""`; several icon-only buttons have no accessible name.                                                                                                                                                                                                                                                | `crear.tsx`                             | `open`  |
| 46  | `public/demo.mp4` (157 MB) was untracked with no ignore rule, one `git add -A` from entering history permanently. Now ignored. Tracked media still puts a clone at ~80-90 MB — reducing that is a separate, optional cleanup.                                                                                                    | `.gitignore`                            | `fixed` |

---

## Found while writing the wave 1 test suite

These were not in the original audit. They surfaced because writing characterisation tests forces
you to state what a function actually does. Each was verified independently before being recorded.

### 47. The reachability guard never blocks IPv6 loopback

- **Status:** `fixed` (wave 2) — corrected alongside finding 18; the bracketed form is matched and three more ranges were closed.
- **Where:** `src/lib/public-media.server.ts:59-66`, `assertPubliclyFetchable`

The guard tests `host === "::1"`, but `URL` keeps the brackets on an IPv6 hostname:

```
new URL("http://[::1]/x").hostname  =>  "[::1]"
host === "::1"    // false  — the branch is unreachable
host === "[::1]"  // true
```

So an IPv6 loopback URL passes the guard today. **This corrects the original audit**, which listed
`::1` among the blocked hosts. It is low severity for the same reason as finding 18: this function
is a reachability check before handing a URL to Buffer, not an SSRF guard on a fetch the server
makes. `assertSafeDownloadUrl` in `video-adapters.server.ts` handles the bracketed form correctly.

**Fix:** strip brackets before comparing, or normalise through `URL.hostname` handling that
accounts for the IPv6 literal form. Covered by a test asserting today's behaviour, marked as a
known gap — update that test when fixing.

### 48. A blank or mistyped cron schedule is silently reinterpreted, never caught

- **Status:** `fixed` (wave 5) — validation in one module, wired at all four call sites including the read path, which is the one that matters since RLS lets a member write the column directly. Schedules under 15 minutes are refused.
- **Where:** `src/lib/cron-executors.server.ts:56-64`, `nextFireFromCron`

The 24-hour fallback only fires when `cron-parser` throws. It often does not:

```
""            => next fire in 1 minute     (parsed as every-minute)
"0 9 * *"     => 2026-10-09T00:00:00Z      (4-field typo, silently reinterpreted)
"0 9 * * *"   => 2026-09-13T09:00:00Z      (correct)
```

A blank `cron_jobs.schedule` therefore becomes a **once-a-minute job**, not a safe daily fallback.
For a `daily_post` job that is a model call, an image generation and a publish every 60 seconds.
Combined with finding 4 (no claim on the job row) and finding 9 (no request timeouts), this is a
plausible runaway-cost incident rather than a cosmetic issue.

A four-field expression does not throw either — it is reinterpreted as a different schedule
entirely, so a typo produces a wrong time rather than an error.

**Fix:** validate the expression shape before accepting it (field count, non-empty) at every write
path, not only in the UI; log when the fallback is taken; consider rejecting rather than falling
back.

### 49. Two key readers behave differently on the same shaped input

- **Status:** `fixed` (wave 5) — both readers share an implementation, with a table-driven test asserting they agree on every shape.
- **Where:** `src/lib/crypto.server.ts:84-91` vs `:111-119`

`readBufferToken` gates on `isEncrypted(enc)` before attempting a decrypt; `readProviderKey` does
not. `readProviderKey` returns `""` for a missing key while `readBufferToken` returns `null`.
Neither is wrong today, but the asymmetry is the kind that produces a subtle bug when someone
copies one pattern to a new call site.

**Fix:** converge on one shape. Both are covered by tests now, so the change is safe to make.

### 50. Video duration clamping ignores its own documented steps and propagates NaN

- **Status:** `open` · **Severity:** P3 · **Confidence:** High
- **Where:** `src/lib/video-caps.ts`

`clampDurationForProvider` does not snap to Veo's documented 4/6/8 second steps, and a `NaN`
input passes straight through instead of falling back to a default. `bestProviderKind` never
consults `minSec`. All three are asserted as current behaviour in the test suite with known-gap
comments.

### 51. Correction: the auto-send gate does not itself refuse spam

- **Status:** `fixed` (wave 2) — the gate refuses spam itself, with the caller's short-circuit kept as a second guard.
- **Where:** `src/lib/engagement/engagement.server.ts:590-599` and `:611-614`

The original audit recorded `isSafeToAutoSend` as blocking spam. It does not. `ALWAYS_ESCALATE`
contains only `support` and `opportunity`; the spam guarantee lives in `handleItem`'s
short-circuit before the gate is consulted. If a workspace row ever listed `spam` in
`engagement_safe_categories`, the gate would return `true`.

The gate is still a real gate and the practical protection holds, because `handleItem` is the only
caller. But the guarantee is weaker than stated and depends on call order.

**Fix applied (wave 2):** an explicit `if (intent === "spam") return false;` inside
`isSafeToAutoSend`, rather than adding `spam` to `ALWAYS_ESCALATE`. That list means "escalate to a
human", and spam is discarded rather than escalated, so folding it in would have misrepresented
what happens to it. `handleItem`'s short-circuit was left in place, so there are now two
independent guards. The stale comment in `types.ts` that justified the omission by relying on
`handleItem` was corrected.

---

## Found while fixing wave 3a

### 53. "Published" on the automated path means Buffer accepted it, not that it went out

- **Status:** `fixed` (wave 5) — a Queued state derived from the post having reached Buffer with a future time. No migration; the signal was already there.
- **Where:** `src/lib/cron-executors.server.ts` `runDailyPost`, and `src/routes/calendario.tsx`

Surfaced by the agent doing the wave 3a publish work, which flagged it rather than papering over it.

`runDailyPost` schedules the post at `now + hourOffset` (4 hours by default), so
`publishScheduledPostToBuffer` uses Buffer's `customScheduled` mode. Buffer accepts the post and
returns an id, but the post does not go out until its due time. Wave 3a now writes
`status = 'published'` at that moment, and the calendar treats a post as live when it has a
`buffer_id` or that status.

So a post queued at Buffer for four hours' time currently reads as already published.

Note this is not a regression introduced by wave 3a. The calendar keyed on `buffer_id` too, and
`buffer_id` has always meant "Buffer took it", not "it is out". Wave 3a made the status agree with
the existing behaviour rather than inventing the ambiguity.

**Why it is P3:** the post is genuinely scheduled and will go out. The display is optimistic, not
wrong about the outcome.

**Fix needs a product decision, which is why it was not done here:** either introduce a third
display state ("queued at Buffer" vs "published", distinguished by comparing the due time to now),
or stop writing `published` until a metrics sync confirms the post actually sent. The second is
more truthful but depends on the metrics job running.

---

## Found while fixing wave 2

### 52. Parsing a URL during render crashes the page, in two places

- **Status:** `fixed` (wave 2) · **Severity:** P2 · **Confidence:** High (verified)
- **Where:** `src/routes/competidores.tsx:198` and `src/routes/chat.tsx:1617`

Neither the original audit nor the wave 1 tests caught this. It surfaced while applying the URL
sanitiser, because guarding the `href` drew attention to the line underneath it.

Both screens rendered a hostname by calling the URL parser on raw third-party data:

```tsx
{
  new URL(c.website).hostname;
} // competitor website
{
  new URL(r.url).hostname;
} // web-search result
```

`new URL()` throws on anything without a scheme, and nothing validates either value:

```
new URL("example.com")      => THROWS: Invalid URL
new URL("www.example.com")  => THROWS: Invalid URL
```

The competitor website has no validation on either write path — the form does
`form.website.trim() || undefined` (`competidores.tsx:74`) and the agent tool declares it as
`website: z.string().default("").describe("Optional website URL.")` (`api/chat.ts:665`). So typing
`example.com`, which is how most people write a website, would throw during render and take the
Competitors page down. Search-result URLs come from Firecrawl, i.e. third-party data that should
not be assumed well-formed.

**Not triggered in this workspace:** both saved competitors have full `https://` URLs, so the crash
was latent rather than active.

**Fix applied:** the competitor case is resolved because the parse now sits inside the branch where
`safeHttpUrl` has already proven the value parses. The chat case needed a separate fix — the agent
guarded the link but left the hostname parse unguarded, reasoning that Firecrawl returns well-formed
URLs; it now derives the hostname from the validated URL and falls back to the raw string.

**Follow-up, not done:** normalise on the write path so a user typing `example.com` gets
`https://example.com` stored, rather than silently degrading to unlinked plain text. That is a
behaviour change to the competitor form and the agent tool, so it belongs in a later wave.

**Pattern to watch for in wave 4:** `new URL(...)` called during render on data the app did not
create. A repo-wide check found only these two in render paths; the two remaining uses are in the
media proxy, where the input is server-controlled.

---

## Rejected and corrected claims

Recorded so they are not re-raised. Each was produced by an audit agent and did not survive
verification.

**R1 — Stored XSS leading to session takeover. REJECTED.**
Claimed high severity: a `javascript:` payload saved as a competitor website, rendered
unsanitised, executing against session tokens in `localStorage`. Every code fact was correct,
but React 19 blocks it. Tested against the installed renderer:

```
"javascript:alert(document.domain)"
  => <a href="javascript:throw new Error(
     'React has blocked a javascript: URL as a security precaution.')">
```

Case variants and leading whitespace are handled too. A `data:text/html` payload does survive
React, but browsers block top-level navigation to data URLs. Reclassified to finding 32 (P3,
defence-in-depth). **Do not re-file this as a vulnerability.**

**R2 — Playbook parser truncates values containing a colon. REJECTED.**
The expression `^${k}:\s*(.+)$` captures greedily to end of line. Tested:
`description: Non-negotiable rules: voice, style, and tone.` returns the complete value. The
parser has real limits (no multi-line values, not real YAML) but not this one.

**R3 — No browser storage is used anywhere. REJECTED.**
Two agents contradicted each other. False: `client.ts:53` persists access and refresh tokens in
`localStorage`, and `workspace.tsx:20` stores the active workspace there.

**R4 — Five high-severity dependency vulnerabilities. CORRECTED.**
Six issues exist but every one traces to the build toolchain (CSS pipeline, browser-target data,
lint tooling). None are imported by application code or present in the built server output.
Low priority; the raw count is misleading without that caveat.

**R5 — A missing `.env` crashes the production server. CORRECTED.**
Tested with a completely empty environment: the built server boots, serves pages, and degrades to
clean per-request 500s that are logged without killing the process. The real gap is only that the
docs never mention the file is not auto-loaded in production.

**R6 — Missed automation windows cause a catch-up storm. REJECTED.**
`nextFireFromCron` is called with the current time, not the missed slot, so a job overdue by days
fires exactly once and re-bases. Verified by reading the call and by simulation.

**R7 — Provider API keys reach the browser. NOT FOUND.**
All four provider mappers return a `hasKey` boolean and never the secret, including the save path
that selects all columns. No screen or component queries the credential tables through the
browser client.

**R8 — Repo hygiene: tracked OS files and dead modules. REJECTED.**
`.DS_Store` is not tracked and is correctly ignored. `src/lib/api/example.functions.ts` and
`src/lib/legacy-import.ts` are both live, intentional code.

**R9 — Documented calendar-to-Buffer publishing does not exist. REJECTED.**
`calendario.tsx` contains no Buffer code, but it opens `post-editor.tsx`, which carries the
publish dialog. The documented capability is real.

---

## Verified clean

Examined with no credible defect found. Recorded so the same ground is not re-covered.

> Two entries below were narrowed by the wave 1 test suite. The auto-send gate does not itself
> refuse spam (finding 51), and the reachability guard does not block IPv6 loopback (finding 47).
> Both are still substantially correct; the corrections are recorded rather than the entries
> deleted.

- **Row-level security** — all 25 tables enabled with policies, no permissive `USING(true)`, the
  anonymous role holds no data privileges.
- **Credential encryption** — correct round-trip, fails closed without the secret, encrypted
  column preferred on every read.
- **Tenant isolation** — a client-supplied `workspaceId` is inert; every query runs through a
  caller-scoped client, so policy is the real boundary.
- **Service-role paths** — all six checked; three carry explicit membership checks and the rest
  are transitively guarded via an RLS-scoped read.
- **Webhook authentication** — both endpoints fail closed and reject wrong secrets, verified live.
- **Path traversal** — the media proxy held against double-encoding, backslashes, overlong UTF-8
  and null bytes.
- **CSRF** — bearer tokens rather than cookies, and no permissive CORS header on the chat route.
- **Secrets in history** — `.env` was never committed; no keys in any revision.
- **Upsert integrity** — all 15 `onConflict` targets match a real unique index.
- **Migration replay** — no unfixed ordering faults; two historical instances already fixed and
  documented in the files themselves.
- **Timestamp triggers** — all 16 tables with an `updated_at` column have the matching trigger.
- **Monthly usage boundary** — `ai_usage_month_total` is correct on Supabase; session timezone
  verified as UTC.
- **Chat context assembly** — every injected read is bounded and truncated again before the prompt.
- **Auto-send safety gate** — `isSafeToAutoSend` is a real code gate, not prompt text; blocks
  negative sentiment, failed classification and escalation intents.
- **Environment documentation** — documented variables and actual reads match in both directions.

---

## Found while fixing wave 3c

### 54. A publish that times out is recorded as failed, though the outcome is unknown

- **Status:** `fixed` (wave 5) — `publish_unknown`, decided by one pure function all three writers call so they cannot drift again.
- **Where:** `src/lib/buffer-publish.server.ts`, and the three status writers in
  `cron-executors.server.ts`, `buffer.functions.ts` and `agent-tools/approvals.server.ts`

Raised by the agent doing the wave 3c Buffer work, which flagged it rather than diverging the two
callers it did not own.

Wave 3b added `notAttempted` for "nothing was sent", and the status writers skip `publish_failed`
when it is set. A timeout is different: the request _was_ sent and we simply cannot tell what
happened. So it returns `ok:false` with `notAttempted` unset, and the post is stamped
`publish_failed`.

**Why this was left as-is rather than "fixed" quickly.** Of the two available states, the current
one is the safer wrong answer. `publish_failed` surfaces on the calendar as needing attention and
the error text explicitly says to check publish.buffer.com before republishing, whereas leaving it
`scheduled` would make it look healthy — the exact failure finding 12 existed to remove. The
publish claim also blocks a re-publish for ten minutes.

**The honest fix is a third state** (`publish_unknown`), which means a migration, calendar handling,
and wording for the agent tool. That is a wave 5 item, not something to squeeze in beside four other
changes. Until then the state is a slight overstatement with an accurate message attached.

---

## Found while fixing wave 4

### 55. Approved brand images stopped being usable as style references

- **Status:** `fixed` (wave 4, same change) · **Severity:** P2 · **Confidence:** High

Predicted by the agent that moved uploads onto storage, and flagged rather than shipped.

Two server paths picked style references by filtering for a `data:` URL, because inline base64 was
the only shape that had ever existed: `generateDailyPostVisual` used `.like("url", "data:%")` and
`loadApprovedReferences` used a regex. Once uploads moved to Supabase Storage those filters matched
nothing for any newly uploaded image, so the daily post and the auto-attach path would have quietly
stopped using the brand's own approved visuals. No error, just worse images.

Both now resolve either shape via `src/lib/media-reference.server.ts`, which downloads through the
storage client rather than re-fetching the stored URL over HTTP. That is deliberate: the row's URL
is data we wrote, but re-fetching it would still be the server making a request to a URL held in the
database, which is a request-forgery surface for no benefit. Going through the client also keeps
row-level security applying on the caller-scoped path.

A byte budget caps the total reference payload, since four images at the 15MB ceiling would be 60MB
of base64 in one prompt.

### 56. The schedule store silently dropped patches that clear a field

- **Status:** `fixed` (wave 4) · **Severity:** P2 · **Confidence:** High
- **Where:** `src/lib/schedule-store.ts`, `update()`

Found while testing the delete ordering. Each column was gated on `patch.x !== undefined`, so
`{ bufferId: undefined }` was dropped entirely. That is exactly the shape the **Unpublish** button
sends, and the shape the editor sends when removing a post's image: the local cache cleared, the
database kept the old value, and the next hydrate brought it back.

Nullable columns now test for key presence. `post` and `status` keep the old check, because they are
NOT NULL and an undefined there is a caller mistake rather than an intent to clear.
