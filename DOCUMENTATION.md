# The Autonomous Social Media Operator — How It Works

A complete, plain-English guide to what this platform is, what it can do, how the agent
thinks and acts, and how it was built. Written to be readable by someone who builds with
AI but does not write code for a living, precise enough for a developer, and structured
so a video producer can turn it into a script (see the storyboard appendix at the end).

---

## 1. What this is

This is not a chatbot bolted onto a scheduling calendar. It is an **autonomous operator
for a social media account**: a single AI agent that researches your market, writes posts
in your voice, generates the visuals, schedules and publishes them through your own Buffer
account, answers the comments and DMs that come back, measures what performed, and writes
down what it learned so the next round is better. A human stays in the loop exactly where
it matters — approving anything that goes public or spends money — and nowhere else.

Everything runs inside a **workspace**. A workspace owns its brand, its guide, its
calendar, its library of visuals, its competitors, its automations, its memory, and its
API keys. All data is scoped to that workspace at the database level, so two workspaces
can never see each other's anything.

The platform is **bring-your-own-key**. You connect your own text model, image model,
video model, Buffer account, research providers and Slack. The platform is the brain and
the operating system; the raw capabilities are yours.

---

## 2. The mental model: one loop

Everything in the product is a step in a single loop. If you understand the loop, you
understand the product.

```text
        +--------------------------------------------------+
        |                                                  |
        v                                                  |
   [ OBSERVE ] --> [ DRAFT ] --> [ APPROVE ] --> [ PUBLISH ]
   brand, guide,    write copy,   human says      Buffer to
   competitors,     make the      yes / no        the real
   metrics,         visual,       (optional)      networks
   inbox, log       pick a time                       |
        ^                                             v
        |                                        [ MEASURE ]
        |                                        engagement,
        +----------- [ LEARN ] <-----------------  top posts,
                     memory +                      failures
                     playbooks
```

- **Observe** — the agent reads the workspace before it asserts anything.
- **Draft** — copy in the brand voice, plus an on-brand image or short video.
- **Approve** — if the workspace requires approval, drafts land in a queue.
- **Publish** — through your Buffer account, to the channels you linked.
- **Measure** — engagement is pulled back in and ranked.
- **Learn** — durable lessons are written to memory and, when they are rules rather
  than facts, into the agent's own instruction files.

The loop runs two ways: **on demand** when you talk to the agent in chat, and
**unattended** on a heartbeat and a set of scheduled automations.

---

## 3. The sections of the app

| Section                                    | What you do there                                                                                                          | What it touches                |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| **Dashboard** (`/`)                        | At-a-glance state: what is scheduled, what needs attention                                                                 | Calendar, approvals, activity  |
| **Agent / Chat** (`/chat`)                 | Talk to the operator. Attach images and PDFs. This is where most work happens                                              | Every tool in section 6        |
| **Create** (`/crear`)                      | Hand-write a post, pick a visual from the library, schedule it                                                             | Calendar, library, Buffer      |
| **Calendar** (`/calendario`)               | See and move everything scheduled; push an internal post to Buffer                                                         | Calendar, Buffer               |
| **Approvals** (`/approvals`)               | The gate. Approve or reject anything the agent produced autonomously                                                       | Calendar, notifications        |
| **Inbox** (`/inbox`)                       | Unified comments and DMs across networks, classified by intent                                                             | Unipile, engagement store      |
| **Library** (`/library`)                   | Every image and short video ever generated or uploaded; approve the good ones                                              | Storage, image/video providers |
| **Competitors** (`/competidores`)          | Add a competitor, run a scan, read the full analyst report                                                                 | Firecrawl / ScrapeCreators     |
| **Reports** (`/reports`)                   | Performance over time by channel, plus the agent's own learnings                                                           | Buffer metrics, memory         |
| **Activity log** (`/logs`)                 | The honest record: every action the agent took, and every failure                                                          | `activity_log`                 |
| **Automations** (`/automations`)           | Scheduled autonomous work + the heartbeat interval + the approval switch                                                   | Cron jobs                      |
| **Brand** (`/marca`)                       | Who you are: name, industry, audience, products, tone                                                                      | Brand profile                  |
| **Guide** (`/guia`)                        | How you sound and look: pillars, vocabulary, CTAs, visual direction. Can be extracted from an uploaded PDF brand guideline | Brand guide                    |
| **Settings / Connections** (`/conexiones`) | Your API keys and integrations, grouped in collapsible sections                                                            | Encrypted credentials          |
| **Onboarding** (`/onboarding`)             | First-run setup of workspace and brand                                                                                     | Workspace, brand               |

---

## 4. How the agent works — one chat turn, end to end

When you send a message, the server assembles a fresh briefing for the model. It is worth
understanding what goes into it, because this is the whole trick: **the agent is good
because its context is good, not because the model is magic.**

Assembled on every single turn, in `src/routes/api/chat.ts`:

1. **Persona and base rules** — who it is and the non-negotiables.
2. **Current date and time zone** — so "next Tuesday" means something real.
3. **Brand context** — the saved brand profile and brand guide, injected verbatim and
   marked as the source of truth. The agent is explicitly forbidden from saying it does
   not know the brand when this block is populated.
4. **Calendar snapshot** — a summary of what is already scheduled.
5. **Buffer state** — connected or not, and the exact list of linked channels with their
   ids. If Buffer is connected but has zero channels, the agent is told precisely what to
   say to the user instead of failing silently.
6. **Library snapshot** — the ids, names and approval state of saved visuals, so the agent
   can reference a real asset by id rather than describing it in prose.
7. **Brand brain / memory** — durable learnings saved from past runs.
8. **Performance digest** — what has actually worked on this account.
9. **Inbox digest** — what is waiting to be answered.
10. **Playbooks** — the markdown instruction files described in section 5.

Then the model runs an **agentic tool loop** (AI SDK `streamText` with `stepCountIs`):
it can call a tool, read the result, call another, and keep going for many steps before
it writes its final answer. Tool results are real data from your workspace, not
hallucinations. The response streams back token by token, and tool activity is rendered
in the chat as it happens.

Two guards sit in front of all of this:

- **Auth** — the request must carry a valid session; the database client is created _as
  the caller_, so row-level security applies to every read and write the agent makes.
- **Usage cap** — if the workspace has hit its monthly AI spend cap, the turn is refused
  with a clear message and a notification is sent instead of quietly burning credit.

### When it asks permission

The rule the agent operates under: **reading, drafting and summarising never need
permission — just do them. Spending money or going public does.** Generating an image or
video, sending a reply, publishing to Buffer, or deleting anything requires either an
explicit instruction in the conversation or an autonomous run the workspace already
authorised. Destructive tools (delete a competitor, delete an automation, reject a post)
require an unambiguous instruction, and the agent must ask once if the target is unclear.

---

## 5. The `.md` files — playbooks, and the operator manifest

The agent's behaviour is not buried in code. It lives in markdown files under
`src/playbooks/`, and each one is a small, editable instruction document.

Every playbook starts with front matter:

```text
---
name: Writing voice
description: Non-negotiable voice and style rules for all copy.
load_when: always
requires: none
---
```

- `load_when: always` — injected into every single turn.
- `load_when: <topic>` — injected only when the turn is about that topic, which keeps the
  context lean and cheap.
- `requires:` — a capability gate. The Buffer playbook is only loaded when a Buffer
  connection exists; the image and video playbooks only when those providers are
  configured. There is no point telling the agent how to do something it cannot do.

Bundled playbooks are compiled into the app, but **any workspace can override or disable
any of them from Settings**. Overrides are stored per workspace in the database and merged
over the defaults at load time. The agent can even read and edit them itself with
`listPlaybooks` and `updatePlaybook` — which means you can teach it a rule in conversation
and have that rule persist forever.

### The eight playbooks

| File            | Loads    | Requires          | What it governs                                           |
| --------------- | -------- | ----------------- | --------------------------------------------------------- |
| `operator.md`   | always   | —                 | Identity, access map, rules of operation, standard plays  |
| `writing.md`    | always   | —                 | Voice: plain executive English, short sentences, no fluff |
| `learning.md`   | always   | —                 | What qualifies as a durable learning worth saving         |
| `engagement.md` | always   | —                 | How to reply like a person, not a brand account           |
| `buffer.md`     | buffer   | Buffer connection | Safe scheduling and publishing                            |
| `image.md`      | image    | Image provider    | How to build on-brand visual prompts                      |
| `video.md`      | video    | Video provider    | One shot, 5–10s, 9:16, reference image as frame one       |
| `research.md`   | research | —                 | When to scrape, when to search, how to cite               |

### `operator.md` — the soul document

This is the most important file in the repository. It is the agent's constitution, and it
has five parts:

1. **Identity and mandate** — "You are the autonomous social media operator for this
   workspace. You do not merely answer questions — you run the account." Speak in the
   brand voice; when instinct conflicts with the guide, the guide wins; never invent
   numbers, competitor facts, past posts or performance.

2. **The one access rule** — everything injected into the prompt is a _summary_; the full
   workspace is reachable through tools. Before the agent ever says "I can't see that" or
   "I don't have access", it must call the matching tool. Saying it lacks access to
   something on the map is defined as an error. The map itself is a table of every section
   of the app and the tools that reach it.

3. **Rules of operation** — confirm before you spend or go public; respect the approval
   queue and never approve your own draft to route around a human; every write is visible
   in the activity log, so state what you changed in one line right after changing it;
   destructive actions need explicit instructions; when editing brand or guide, send only
   the fields that change and never blank a field to tidy up.

4. **Standard plays** — step-by-step recipes the agent follows without being asked:
   - _Write a post_: check performance → find a reference in top posts → draft in voice →
     sanity-check length, format and timing → offer a visual → schedule.
   - _Add and understand a competitor_: create the entry → run the scan → read the report
     back → summarise positioning and the two openings we can exploit → save learnings.
   - _Work the inbox_: get the shape of it → list what is waiting → prioritise support and
     negative first, then opportunities, then praise → draft, show, send.
   - _Weekly review_: 30 days of performance → best and worst posts → failures from the
     log → name what changed and why → save two learnings → propose next week.
   - _Set up an automation_: confirm in plain language → translate to cron → create →
     confirm the next run time.
   - _Diagnose "nothing is working"_: connection status first, then error-filtered activity
     log, then name the single root cause and the exact screen to fix it in.

5. **Learned rules** — durable lessons promoted out of memory into the manifest. For
   example: when adapting an approved visual, pass the original library asset as the direct
   reference and instruct the generator to preserve composition, crop, lighting, palette
   and typography, changing only the specified subject.

---

## 6. The tool catalogue

Around forty tools, all workspace-scoped. Most execute on the server through the caller's
authenticated database client; nine (scheduling, Buffer, image generation, the library view
and competitor scans) execute in the browser session — same identity, same row-level
security. "W" marks a write.

### Content and the internal calendar

| Tool             |     | What it does                                                  |
| ---------------- | --- | ------------------------------------------------------------- |
| `schedulePost`   | W   | Creates a post in the internal calendar; accepts an `imageId` |
| `reschedulePost` | W   | Moves a post to a new date/time                               |
| `deletePost`     | W   | Removes a post or draft                                       |
| `listScheduled`  |     | Lists what is scheduled in a date range                       |

### Publishing (Buffer)

| Tool                 |     | What it does                                                                                     |
| -------------------- | --- | ------------------------------------------------------------------------------------------------ |
| `bufferSchedulePost` | W   | Real publication. Fans out to multiple `channelIds` in one call, with an optional attached image |
| `bufferDeletePost`   | W   | Removes a post already scheduled on Buffer                                                       |

### Visuals

| Tool              |     | What it does                                                                                                                                      |
| ----------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `generateImage`   | W   | Generates an on-brand visual; accepts `referenceImageIds` from the library for image-to-image adaptation. Returns an `imageId` to attach to posts |
| `showLibrary`     |     | Renders the visual library inline in chat as thumbnails                                                                                           |
| `getLibraryAsset` |     | Full metadata for one asset, so it can be referenced precisely                                                                                    |

### Performance and learning

| Tool                    |     | What it does                                       |
| ----------------------- | --- | -------------------------------------------------- |
| `getPerformanceSummary` |     | Engagement over a window, by channel               |
| `getTopPosts`           |     | Best and worst performers, as references           |
| `comparePost`           |     | Sanity-checks a draft against what has worked here |
| `rememberLearning`      | W   | Saves a durable lesson to the brand brain          |

### Engagement inbox

| Tool                |     | What it does                                                       |
| ------------------- | --- | ------------------------------------------------------------------ |
| `engagementSummary` |     | The shape of the inbox: volume, sentiment, what is urgent          |
| `listEngagement`    |     | The individual comments and DMs waiting                            |
| `draftReply`        |     | Writes a reply for review — never sends                            |
| `sendReply`         | W   | Sends it. Needs explicit approval or an authorised autonomous rule |
| `likeItem`          | W   | Low-effort acknowledgement for praise                              |

### Competitors

| Tool                    |     | What it does                                         |
| ----------------------- | --- | ---------------------------------------------------- |
| `listCompetitors`       |     | Everyone saved, with whether they have been scanned  |
| `addCompetitor`         | W   | Creates the entry from a name and handles            |
| `analyzeCompetitor`     | W   | Runs the full intelligence scan and saves the report |
| `getCompetitorAnalysis` |     | Reads the saved report back in detail                |
| `deleteCompetitor`      | W   | Removes one. Explicit instruction required           |

### Approvals

| Tool            |     | What it does                                                |
| --------------- | --- | ----------------------------------------------------------- |
| `listApprovals` |     | Pending and rejected posts with captions and proposed times |
| `approvePost`   | W   | Approves. Never used to bypass a human unsolicited          |
| `rejectPost`    | W   | Rejects. Explicit instruction required                      |

### Brand and guide

| Tool                                      |     | What it does                                        |
| ----------------------------------------- | --- | --------------------------------------------------- |
| `getBrandProfile` / `getBrandGuide`       |     | Reads the saved identity and style rules            |
| `updateBrandProfile` / `updateBrandGuide` | W   | Field-level patches only; echoes the new value back |

### Automations

| Tool               |     | What it does                                      |
| ------------------ | --- | ------------------------------------------------- |
| `listAutomations`  |     | Every job, its schedule, next run and last result |
| `createAutomation` | W   | New scheduled job                                 |
| `updateAutomation` | W   | Enable, disable, rename, reschedule               |
| `runAutomationNow` | W   | Fires it immediately, for testing                 |
| `deleteAutomation` | W   | Removes it. Explicit instruction required         |

### Introspection

| Tool                               |     | What it does                                                                  |
| ---------------------------------- | --- | ----------------------------------------------------------------------------- |
| `readActivityLog`                  |     | Recent actions, filterable by type, status and date. The debugging tool       |
| `getConnectionStatus`              |     | Which providers are configured — labels and booleans only, never key material |
| `listPlaybooks` / `updatePlaybook` | W   | The agent reads and edits its own instructions                                |
| `webSearch`                        |     | Live web research for anything time-sensitive                                 |

---

## 7. Autonomy: heartbeat, automations, approvals

### The heartbeat

A cheap periodic "check in on the account" pass, at an interval the owner chooses
(30 minutes, 1, 3, 6, 12, 24 hours, or off). It never publishes. It looks at what is
scheduled in the next day, recent errors, the latest metrics and the state of the jobs,
then writes a short first-person status note to the activity log and flags anything that
needs a human. It is deliberately best-effort: a heartbeat failure can never break the
scheduled tick.

### Scheduled automations

Cron jobs, each with a task type:

- `daily_post` — draft in the brand voice, generate an on-brand visual with your own image
  provider (approved library assets as style references), then schedule: into the approval
  queue when approval is on, or straight to Buffer when approval is off and a matching
  channel is linked. No image provider connected → text-only, and the run summary says so.
- `competitor_scan` — re-scans competitors that have per-network handles via ScrapeCreators
  and refreshes their post data; competitors without handles are counted as skipped in the
  run summary. The full analyst report remains a chat action (`analyzeCompetitor`).
- `metrics_sync` — pull engagement back from Buffer.
- `weekly_report` — the digest.
- `performance_reflection` — the agent reviews its own output against results.

Each run is wrapped: it checks the usage cap, executes, and logs a `cron.<task>.ok` or
`cron.<task>.error` entry with a summary. Post-run reflection is triggered for the runs
where it makes sense, so the loop closes without a human.

### The approval gate

A workspace-level switch that gates **autonomous** output. When **on**, anything an
automation produces lands as a _pending_ post and waits for a human in `/approvals`.
Posts you ask the agent for **in chat are not gated** — your instruction in the
conversation is the approval (the red button is you), so they schedule and publish
directly. When you turn the switch **off**, existing pending posts are automatically
approved, and future `daily_post` runs publish straight to Buffer when a matching channel
is linked. Approving a post in `/approvals` also pushes it to Buffer. Posts you created as
internal-calendar-only are never swept. The agent is told to say plainly whether a post is
live or pending.

### Notifications

Slack (your own incoming webhook, encrypted at rest). Email is not implemented. Events: post awaiting approval, automation
failed, usage cap reached, weekly performance digest, plus inbox events — a new DM, a
negative comment, an engagement opportunity, and a support request.

---

## 8. Memory and learning

Three layers, in increasing durability:

1. **Brand brain / agent memory** — facts and lessons saved with `rememberLearning`,
   weighted so the ones that keep proving useful surface first. Injected into every turn.
2. **Performance reflection** — after posts run, the agent compares what it predicted
   against what happened, and writes conclusions rather than raw numbers.
3. **Playbooks** — when a lesson is a _rule_ rather than a _fact_, ask the agent to add it
   to the relevant playbook (`updatePlaybook`) and it becomes binding on every future turn.
   Promotion is a deliberate act — yours or the agent's in conversation — not an automatic
   background process. The manifest tells the agent to propose it whenever you correct it
   twice on the same thing.

This is what makes the tool compound. Month three is better than month one not because the
model changed, but because the instructions did.

---

## 9. Bring your own keys

Nothing here depends on a shared vendor account. Each workspace connects its own:

| Connection     | Used for                                                                   |
| -------------- | -------------------------------------------------------------------------- |
| Text model     | The agent's brain — OpenAI, Anthropic or Google, from a curated model list |
| Image provider | Post visuals                                                               |
| Video provider | Short-form clips                                                           |
| Buffer         | Real publication to the linked social channels                             |
| Firecrawl      | Web search and page scraping                                               |
| ScrapeCreators | Social-profile competitor intelligence                                     |
| Unipile        | The unified engagement inbox across networks                               |
| Slack          | Notifications                                                              |

Keys are **encrypted at rest per workspace** (AES-GCM) and decrypted only server-side at
the moment of use. The agent's `getConnectionStatus` tool returns provider labels and
configured/not-configured booleans — it is structurally incapable of returning key
material. Settings groups all of this into collapsible sections so the page stays short.

---

## 10. How it is built

For the developer in the room — or the vibe coder who wants to know what to point the AI at.

- **Framework**: TanStack Start (React 19, Vite), running server code in an edge worker
  runtime. Routes live in `src/routes/`; every screen is a file.
- **Two kinds of server code**:
  - `createServerFn` for app-internal calls from the UI (typed RPC, auth middleware
    attached, RLS applies as the caller). These are the `*.functions.ts` files.
  - File routes under `src/routes/api/` for raw HTTP — the chat stream, image generation,
    and public webhooks under `api/public/` (the cron tick and Unipile callbacks), which
    verify their caller inside the handler.
- **The agent loop**: `src/routes/api/chat.ts`. Auth guard → usage cap → context assembly
  → `resolveChatModel` (bring-your-own-key only — no gateway fallback) → `streamText`
  with the full tool set and a multi-step stop condition → streamed response.
- **Agent tools**: `src/lib/agent-tools/*.server.ts`, one module per area (approvals,
  brand, automations, activity, connections, playbooks, competitors, library). Each
  exports plain async functions taking `(db, workspaceId, args)`, which keeps the chat
  route a thin wiring layer and makes each capability independently testable.
- **Read-only lookups**: `src/lib/workspace-context.server.ts` for competitor and
  automation reads.
- **Playbook loader**: `src/lib/playbooks.server.ts`. Markdown is imported with `?raw` so
  it is bundled at build time (the worker runtime has no filesystem), parsed for front
  matter, merged with workspace overrides, filtered by topic and capability, and rendered
  into one prompt block.
- **Data**: Supabase (Postgres) with row-level security on every table and explicit grants.
  Scheduling on `pg_cron`. Files in Supabase Storage.
- **Auditability**: every write emits an `activity_log` row with an actor type, an action
  slug, a one-line summary and structured details. If the agent did it, you can see it.

---

## 11. What is not wired yet

Stated honestly, because the manifest requires the agent to state it honestly too:

- No direct browsing of a live LinkedIn feed; competitor intelligence comes from scans.
- No conversion, revenue or lead data — engagement metrics only.
- Multi-account (several brands under one login) is deliberately out of scope for now.
- **Mentions are not ingested.** The inbox covers comments on your own posts and DMs; a
  mentions feed would need a Unipile endpoint the app does not call yet.
- **Email notifications are not implemented.** Slack (your own webhook) is the only
  notification transport.
- **Video generation runs from the Library page, not from chat.** In chat the agent can
  attach finished video assets to posts by id, but it cannot start a generation.
- **Autonomous Buffer publishing is deliberately narrow**: only a `daily_post` run with
  approval off, or an explicit approval in `/approvals`, ever publishes unattended.
  Internal-calendar posts you created by hand are never swept to Buffer.
- Exact 4:5 images are not offered by the image APIs; "portrait" (2:3) is the tall option.

---

## 12. Running it locally

This app runs entirely on your own machine: your Postgres, your storage, your keys.
The build is a plain Vite config (TanStack Start + Nitro + Tailwind + React plugins),
with no third-party build wrapper.

### One-time setup

```bash
npm install
npm run db:start          # Supabase in Docker: Postgres, Auth, Storage, Studio
```

`db:start` prints a publishable key and a secret key — copy them into `.env`
(see `.env.example` for the exact variable names).

`.env` holds **infrastructure only** — Supabase URLs and keys, the encryption secret, the
two webhook secrets, and the tunnel URL. **No provider API keys live there.** Text models,
image models, Buffer, Firecrawl, ScrapeCreators, Unipile and Slack are all entered per
workspace in the app at Settings → Connections and stored encrypted in your database.

### Every session

Three processes, three terminals:

```bash
npm run dev               # the app, on http://localhost:5173 (pinned; fails fast on a clash)
npm run tunnel            # ngrok → public URL for Buffer media + Unipile webhooks
npm run db:start          # only if Docker was restarted
```

`APP_PORT` in `.env` is the single source of truth for the port — `vite.config.ts`,
`npm run tunnel` and the cron scripts all read it, defaulting to 5173 when unset.
`strictPort` means a clash fails loudly instead of silently moving to another port.
`supabase/config.toml`'s auth redirect allow-list is the one thing that can't read `APP_PORT`
(the Supabase CLI doesn't support env substitution there) — if you change the port, edit the
`5173`s under `[auth]` in that file to match and run `npm run db:stop && npm run db:start`.

After starting the tunnel, put its https URL into `PUBLIC_APP_URL` in `.env` and restart
`npm run dev`. On ngrok's free tier that URL changes on every restart. A reserved domain
makes it stable and is worth it if you use this daily.

Useful extras: `npm run db:studio` (browse the database), `npm run db:reset` (wipe and
replay all migrations), `npm run cron:once` (fire one automation tick by hand).

### Re-seeding the brand

Brand, Guide and Competitors are seeded by `scripts/seed-brand.mjs` from a JSON
payload: `seed/brand.local.json` (your real brand, gitignored) when present,
otherwise `seed/brand.example.json` (a neutral demo brand):

```bash
npm run seed:brand            # fills only empty fields; never overwrites your edits
npm run seed:brand -- --force # overwrite everything (use after db:reset)
```

`db:reset` wipes the brand tables, so run this after one. Competitors are seeded unscanned,
with no fabricated snapshot — run a real `analyzeCompetitor` once Firecrawl or ScrapeCreators
is connected.

### Why the tunnel is not optional

Two things need to reach your machine from the internet:

1. **Buffer** downloads post media from its own servers. Local Supabase storage signs URLs
   against `127.0.0.1`, which Buffer cannot resolve. So signed URLs are rewritten to travel
   through this app's own `/api/public/media` proxy (`src/lib/public-media.server.ts`),
   which the tunnel exposes. The Supabase signature is preserved and is still what grants
   access; the proxy is read-only and rejects every write verb with a 405.
2. **Unipile** POSTs engagement webhooks to `/api/public/hooks/unipile`.

If `PUBLIC_APP_URL` is empty, text-only Buffer posts still work, and a post _with_ media
fails with an explicit message telling you to start the tunnel — not a confusing error
from Buffer's side. Everything else is unaffected.

### Automations and the heartbeat

On a hosted deployment, `pg_cron` can call the tick endpoint. A local Postgres container cannot reach the
app, so the tick is driven from macOS instead:

```bash
npm run cron:install      # launchd agent, one tick per minute
npm run cron:uninstall    # remove it
```

Logs go to `~/Library/Logs/social-studio/`. The agent is self-contained — the URL and
secret are baked into the plist, because launchd agents are not granted access to
`~/Desktop` by macOS and would otherwise fail with "Operation not permitted". **Re-run
`cron:install` after changing `CRON_TICK_SECRET` or the port.**

The honest limitation of local hosting: **automations only advance while your Mac is awake
and `npm run dev` is running.** A missed window is skipped, and the failure is logged to
`cron.err.log`. If the daily post matters, this is the reason to host the app somewhere
rather than on a laptop.

### Production build

```bash
npm run build             # → .output/server/index.mjs (Node target)
node .output/server/index.mjs
```

Set `NITRO_PRESET=cloudflare-module` to build for Workers instead.

### What connects where

| Setting                    | Where it goes                             | Notes                                                                                        |
| -------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------- |
| Text model                 | Settings → Connections → Text model       | OpenAI, Anthropic, Google, or Azure. Azure needs the deployment endpoint and deployment name |
| Image model                | Settings → Connections → Image generation | OpenAI, Gemini, or Azure. Azure ignores reference images                                     |
| Buffer token               | Settings → Connections → Buffer           | Then connect at least one channel at publish.buffer.com                                      |
| Firecrawl / ScrapeCreators | Settings → Connections → Data services    | Web research and competitor scans                                                            |
| Unipile                    | Settings → Connections → Unipile          | Also register the webhook URL in Unipile                                                     |
| Slack webhook              | Settings → Connections → Notifications    | Incoming Webhook URL                                                                         |

For an Azure text deployment the endpoint must stop at the deployment and carry no trailing
slash — the app appends `/chat/completions?api-version=2024-12-01-preview` itself:

```text
https://<resource>.cognitiveservices.azure.com/openai/deployments/<deployment>
```

### Known gaps in the recovered schema

The migration history exported from the original hosting platform was incomplete: `notification_settings` was
GRANTed and ALTERed by later migrations but never created, so a fresh database could not be
built from the files. It is reconstructed in
`supabase/migrations/20260807215638_notification_settings.sql`, and the `media` /
`buffer-media` storage buckets — previously created out of band — are created in
`20260817120000_storage_buckets.sql`. Both are written to be no-ops against a database
where those objects already exist.

---

## 13. Appendix — video storyboard

A shot list for a 4–6 minute walkthrough. Each row is one scene: what is on screen, and
the line to say over it.

| #   | On screen                                                   | Line                                                                                                                                                                                   |
| --- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The loop diagram from section 2, animating step by step     | "Most social tools schedule posts. This one runs the account. Observe, draft, approve, publish, measure, learn — and then it does it again, better."                                   |
| 2   | The Brand and Guide screens                                 | "First you tell it who you are once. Name, audience, voice, visual direction. You can upload your existing brand PDF and it extracts the guide for you."                               |
| 3   | Settings, sections expanding one by one                     | "Then you plug in your own keys. Your model, your image generator, your Buffer, your Slack. Nothing here runs on someone else's account."                                              |
| 4   | Chat: "write me a post about X" — tool calls appearing live | "Watch the middle of the screen. Before it writes a word, it checks what has actually worked on this account, pulls a reference post, and only then drafts."                           |
| 5   | Same turn: an image being generated and attached            | "It builds the visual from your own visual direction — or adapts one you already approved, keeping the composition and changing only the subject."                                     |
| 6   | Approvals screen, approving the post                        | "Nothing goes public without you, unless you switch that off. Approve here and it's queued to your real channels."                                                                     |
| 7   | Calendar, then Buffer                                       | "One call fans it out to every channel you picked."                                                                                                                                    |
| 8   | Inbox, sentiment labels visible                             | "Comments and DMs come back into one inbox, sorted by what actually needs you: support and negatives first, opportunities next, praise last."                                          |
| 9   | `operator.md` open in the editor, scrolling                 | "Here's the interesting part. Its behaviour isn't code — it's a markdown file. Who it is, what it can reach, what it must confirm before doing. You can read it, and you can edit it." |
| 10  | Playbooks list in Settings, one being edited                | "Eight of these. Some load every time, some only when relevant, and the ones for tools you haven't connected never load at all."                                                       |
| 11  | Reports, then the learnings tab                             | "After every run it grades its own work — and when a lesson becomes a rule, one sentence in chat writes it into its own instructions."                                                 |
| 12  | Activity log scrolling                                      | "And every single thing it did is here. No mystery, no black box."                                                                                                                     |
| 13  | Back to the loop diagram                                    | "Set the brand once. Approve what matters. It runs the rest — and it gets better every month, because the instructions get better, not just the model."                                |
