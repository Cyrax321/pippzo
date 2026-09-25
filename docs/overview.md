# What is this tool?

This is your **autonomous social media operator** — an app that runs your social media presence the way a (very disciplined) human social media manager would: it researches, writes, designs, schedules, publishes, replies to people, measures what worked, and learns from it.

It runs entirely on your own machine, with your own accounts and your own AI keys. Nothing goes through anyone else's platform.

Think of it as three things working together:

1. **A workspace** — your brand profile, visual library, calendar, inbox, competitors, reports and settings, all visible in the app's pages.
2. **A chat agent** — the conversation on the Chat page. It's not a chatbot answering questions; it's the operator you give instructions to. It can reach every part of the workspace through its tools.
3. **Automations** — scheduled jobs (a heartbeat, daily posts, weekly competitor scans…) that run on their own, even when you're not looking.

---

# What the chat agent can do

In plain terms, you can ask it to:

- **Write posts** in your brand voice — which it learned from your brand guide — and schedule them to the internal calendar or straight to your real channels through Buffer (LinkedIn, Instagram, X…), either queued, at an exact time, or published immediately.
- **Create images** that match your approved visuals. Your approved library images are the strongest signal it has: it uses them as direct references, because they represent what your designer (or you) already signed off on. The written style guide fills the gaps; the images win when they disagree.
- **Create videos** (when a video provider key is connected) — short clips for reels/stories. It will always confirm with you first because video generation costs real money.
- **Build LinkedIn carousels** — it generates the slides, assembles them into a swipeable document, and posts it to LinkedIn via Buffer.
- **Work your inbox** — read comments and DMs pulled from your linked accounts, sort out what needs a reply from spam, draft answers in your voice, and (with your say-so) send them or like them.
- **Watch competitors** — scan their profiles, summarise their strategy, and point out openings you can use.
- **Report on performance** — what's working, your best and worst posts, and comparisons before you publish something new.
- **Set up automations** — "post every weekday at 9am Sydney time", "scan competitors every Monday" — in your timezone, in plain language.
- **Search the web** for fresh material to react to.
- **Remember** — you can tell it "save that as a learning" and it becomes a permanent rule it follows from then on.

---

# How it works

**The brand brain.** Everything it writes and designs flows from your brand profile and brand guide (from /marca and /guia), your approved images, and the learnings you've saved. It's instructed never to invent numbers, clients, or results — if it doesn't have a fact, it fetches it or says so.

**Playbooks.** The agent carries a set of "operating manuals" — how to write a post, work the inbox, set up an automation, diagnose a failure. You can read and even edit these from chat ("show me your playbooks").

**Tools, not guesses.** When you ask about your calendar, inbox, competitors or stats, it doesn't answer from memory — it calls a tool that reads the real data, then answers. Every change it makes is written to the activity log, so there's always a paper trail in /logs.

**Connections.** It publishes through Buffer, reads your inbox through Unipile, generates media with your own AI keys. If something's disconnected, it tells you which screen to fix it in rather than pretending.

---

# How autonomous is it? (the Red Button)

The design principle is simple: **a human sees output before it acts on the world — unless you've explicitly widened the leash.** There are three levels:

**1. You ask in chat → it acts.**
Your instruction _is_ the approval. If you say "publish this now", it publishes — no second sign-off, because you are the human in the loop. It still confirms before spending money (image/video generation) or before anything destructive.

**2. Automations create content → it waits for you.**
Posts created by scheduled automations land in the **Approvals** queue and go nowhere until you approve them (when approval mode is on, which is the default). You are the red button.

**3. The inbox has its own dial.**
Reply mode is yours to set:

- **Draft only** (your current setting) — it drafts replies, sends nothing.
- **Approval** — drafts queue for your one-click approval.
- **Autonomous** — it may send replies by itself, but only for categories you've marked safe (like simple praise), never for anything negative, sensitive or salesy (those always escalate to you), and never more than your daily limit. Anything it wasn't sure how to classify is also forced to a human.

So at maximum autonomy it can: post on schedule, and answer routine friendly comments — within a daily budget. Everything with real stakes still crosses your desk.

---

# Every tool the agent can call

## Content & calendar

| Tool                 | What it does                                                                                                                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schedulePost`       | Creates a post in the app's internal calendar (a plan, not yet published anywhere).                                                                                           |
| `reschedulePost`     | Moves an internal calendar post to a new date/time.                                                                                                                           |
| `deletePost`         | Removes a post from the internal calendar or drafts.                                                                                                                          |
| `listScheduled`      | Shows what's on the internal calendar.                                                                                                                                        |
| `bufferSchedulePost` | The real publish button: sends a post (text, image, video, story or LinkedIn carousel) to your actual channels via Buffer — to the queue, at an exact time, or **right now**. |
| `bufferDeletePost`   | Deletes a post that's sitting in Buffer.                                                                                                                                      |

## Visuals

| Tool              | What it does                                                                                                                                                |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `generateImage`   | Creates an image, automatically using your approved library images as style references so results stay on-brand.                                            |
| `generateVideo`   | Creates a short video clip (only exists when a video provider is connected; always confirms cost first; result lands in the library pending your approval). |
| `showLibrary`     | Shows your image/video library right inside the chat so you can point at things.                                                                            |
| `getLibraryAsset` | Fetches one specific saved image or video by its id.                                                                                                        |

## Inbox (comments & DMs)

| Tool                | What it does                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `engagementSummary` | The shape of your inbox at a glance: how much is waiting, what kind, what mood.                                    |
| `listEngagement`    | Lists the actual comments, mentions and DMs waiting.                                                               |
| `draftReply`        | Writes a reply in your voice and shows it to you — sends nothing.                                                  |
| `sendReply`         | Sends a reply. Respects your reply-mode dial: it queues for approval instead of sending when your settings say so. |
| `likeItem`          | Likes a comment — a low-effort acknowledgement for praise that doesn't need words.                                 |

## Approvals

| Tool            | What it does                                                                 |
| --------------- | ---------------------------------------------------------------------------- |
| `listApprovals` | Shows posts waiting in the approval queue.                                   |
| `approvePost`   | Approves a pending post (only when you tell it to — it never self-approves). |
| `rejectPost`    | Rejects a pending post (explicit instruction required).                      |

## Performance & learning

| Tool                    | What it does                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------ |
| `getPerformanceSummary` | How your account is doing over a period — reach, engagement, patterns.               |
| `getTopPosts`           | Your best (and worst) performing posts.                                              |
| `comparePost`           | Sanity-checks a draft against what has historically worked (length, format, timing). |
| `rememberLearning`      | Saves a permanent lesson ("never invent captions") that shapes all future behaviour. |

## Brand

| Tool                 | What it does                                              |
| -------------------- | --------------------------------------------------------- |
| `getBrandProfile`    | Reads your brand basics: who you are, audience, offer.    |
| `updateBrandProfile` | Edits those basics (only the fields you asked to change). |
| `getBrandGuide`      | Reads the full voice/style/visual guide.                  |
| `updateBrandGuide`   | Edits the guide — tone, style rules, do's and don'ts.     |

## Competitors

| Tool                    | What it does                                                 |
| ----------------------- | ------------------------------------------------------------ |
| `listCompetitors`       | Shows the competitors you track.                             |
| `addCompetitor`         | Adds one (name + social handles).                            |
| `analyzeCompetitor`     | Runs a live scan of their recent content and saves a report. |
| `getCompetitorAnalysis` | Reads back a saved report.                                   |
| `deleteCompetitor`      | Removes one (explicit instruction required).                 |

## Automations

| Tool               | What it does                                                                  |
| ------------------ | ----------------------------------------------------------------------------- |
| `listAutomations`  | Shows your scheduled jobs and when each runs next, in its own timezone.       |
| `createAutomation` | Sets up a new recurring job from plain language ("every Monday 10pm Sydney"). |
| `updateAutomation` | Changes an existing job's schedule, brief or timezone.                        |
| `runAutomationNow` | Fires a job immediately, as a test.                                           |
| `deleteAutomation` | Removes a job (explicit instruction required).                                |

## Housekeeping

| Tool                  | What it does                                                                                                                                                                                                      |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `readActivityLog`     | Reads the paper trail — everything the system did, including failures, so it can diagnose "what went wrong".                                                                                                      |
| `getConnectionStatus` | Checks which services and keys are connected (usually the first thing to check when something "doesn't work").                                                                                                    |
| `webSearch`           | Searches the open web for fresh, real information to build content from.                                                                                                                                          |
| `readSocialPost`      | Reads a LinkedIn post you paste as a link (through your own linked LinkedIn account) and saves it to a swipe file of references — then writes original content inspired by its hook and structure, in your voice. |
| `listReferences`      | Recalls the reference posts you saved before ("that post I sent you last week").                                                                                                                                  |
| `listPlaybooks`       | Shows its own operating manuals.                                                                                                                                                                                  |
| `updatePlaybook`      | Edits its own operating manuals — how you tune _how_ it works, not just what it does.                                                                                                                             |

_(41 tools. `generateVideo` only appears when a video provider key is connected — the agent won't promise video it can't make.)_

---

# The one-paragraph version

You have a social media employee that lives on your Mac. It knows your voice because it studied your brand guide, it knows your look because it studies the images you approved, and it keeps its own diary of everything it does. In chat, your word is the green light. On its own, it drafts and waits at your approval queue. And with the inbox dial turned up, it can handle the friendly routine stuff itself — always within limits you set, with everything sensitive escalated to you.
