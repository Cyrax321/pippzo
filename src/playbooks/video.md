---
name: Video generation
description: How to brief and direct short-form video clips like a film director.
load_when: video
requires: video_capability
---

You can generate video directly from chat with the `generateVideo` tool. It costs real money and takes 1–3 minutes, so confirm the brief with the user before starting, then say the clip is rendering.

## Operating rules

- One shot per generation. Keep clips 5–10 seconds; describe one continuous take. No multi-scene scripts.
- Default to 9:16 for reels and stories; 16:9 only for landscape placements.
- Aspect ratio and duration are TOOL PARAMETERS — never write "9:16", "8 seconds" or resolution inside the prompt text.
- To adapt an approved visual, pass `referenceImageId`. It becomes frame one — describe how the scene moves from that image instead of re-describing the image. (Seedance 2.x rejects reference images containing real human faces — this applies on both the BytePlus provider and Runway's hosted seedance2* models; if the reference has people, use Veo/Omni/Gen-4.5 or generate without the reference.)
- The finished clip lands in the library PENDING approval. To publish, pass its id as `imageId` in `bufferSchedulePost` — native video, never the poster frame.
- Do not promise audio, captions or on-screen text unless the provider supports it.
- Never name real people, brands or IP in a prompt. Translate references into descriptive features.

## Formats & platform fit

Aspect ratio, duration and provider are ONE decision, made from the target platform backwards. The system prompt carries the live matrix (CONNECTED VIDEO PROVIDERS + PLATFORM VIDEO RULES); the rules of thumb:

- Instagram: every video publishes as a Reel — 9:16. A story must be 9:16 and 60s or less.
- Facebook: a 9:16 upload automatically becomes a Reel (3–90s).
- TikTok: video is mandatory, 9:16.
- LinkedIn: 9:16 through 16:9 all accepted; rendered at up to 720p, so any provider is fine.
- X: 16:9 or 1:1 reads best; max 140s.
- Clips longer than 8s cannot come from Veo (max 8s) — use Kling, Seedance or Runway (up to 15s) and pass `providerKind`. Omni Flash tops out at 10s and 720p.
- When the user names a platform, state the chosen format and provider in one clause before rendering.

## Directing the clip — write the prompt like a shot, not a wish

Video models film what IS, not what becomes. The prompt is a sealed description of one shot: who is in frame, where, doing what, lit how, seen through what kind of lens.

**First frame is everything.** On a 5–8s clip there is no time for a reveal. The subject must already be in frame one, in position, mid-action. State it: "the first frame already shows her at the desk, mid-gesture". Never open on an empty establishing frame.

**States, not transitions.** Describe the character already IN the action — mid-throw, mid-stride, mid-laugh — never the process of getting there ("reaches into the bag, pulls out, winds up" collapses; "mid-throw, arm extended" lands). Chain 2–3 states as beats if the clip needs progression.

**Block the space measurably.** "Near the window" is weak; "within one meter of the window, hand resting on the frame" is direction. Body orientation and gaze are separate instructions: "torso faces the camera, eyes locked on the screen to her left". For two people, say who is screen-left, who is screen-right, and who looks at whom.

**Optics by visible outcome, not lens metadata.** Skip millimeters and f-stops. Wide feel: "camera close to the subject, environment visible to the frame edges, deep focus, straight lines stay straight". Telephoto feel: "framed close through lens reach from far away, background compressed and dissolved into soft bokeh, only the subject sharp". Pick ONE lens character per clip and keep it.

**Lighting is a lock, not decoration.** Name the source, its direction, and which side the camera is on: "late sun from camera-right, camera on the shadow side, warm rim light on the shoulders, face in soft shadow — no flat front light". A lighting sentence beats ten mood adjectives.

**Physics sells it.** Weight, contact and follow-through: heels strike, cloth lags a beat behind the turn, coffee ripples when the cup lands, hair moves with the wind and settles. One cause-and-effect detail per clip kills the floaty CG look.

**Acting is behavior, not emotion.** Never write "she looks happy" — give her an objective and something to do: hands busy with a real task, a reaction that starts before the other person finishes, a pause where she decides. Give the eyes life — a glance away in thought, a slow blink, gaze settling back — dead frozen eyes are the #1 AI tell. The strong are still and quiet; fidgeting reads as weakness.

**Positive language only.** No model here has a negative prompt. Describe what you want, not what to avoid: "empty deserted street" not "no people"; "clean dry skin" not "no blemishes". A NOT-stack injects the very thing it bans.

**Palette from the brand.** One line, 60/30/10, real hues from the brand's visual direction — never invented over an attached reference.

**Dialogue, if any:** the quoted line only, lips still otherwise, no subtitles, no narration.

**Density check before sending.** 80–150 tight words beat 400 scattered ones. Every sentence must control something visible: subject, blocking, action state, lens, light, physics. Cut adjectives that don't.

A good brief reads like: first-frame occupancy → subject + blocking → action states with one physics detail → lens character → lighting lock → palette line. If the user's ask is vague, confirm the ONE thing the clip must communicate, then direct the rest yourself.
