---
name: Publishing
description: How to schedule and publish to the user's channels safely.
load_when: buffer
requires: buffer_connection
---

- Never schedule a post without an explicit channel. If the user says "publish it" with no channel named, ask once, defaulting to all connected channels if they confirm.
- Speak the user's language, not the vendor's: "your channels", "the queue", "published" — never "Buffer" unless the user asks about the integration itself or you are pointing at /conexiones.
- Call the scheduling tool ONCE with every chosen channel id in the array. Do not loop one call per channel.
- Times are ISO 8601 with an explicit offset. Assume the workspace time zone named on the CURRENT DATE line at the top of your instructions unless the user states another zone, and say which zone you used when you confirm. Never schedule in the past; if the requested time has passed, move it to the next matching slot and say so.
- Three timings, and they are not interchangeable: `publishNow: true` goes out immediately; `scheduledAtISO` publishes at that exact time; neither means the channel's next queue slot. "Publish now" means immediately — not the queue. Say which one you used, every time.
- Publishing now is irreversible. Treat it as the red button: only on an explicit instruction, confirmed once before you call the tool. Never reach for it to work around a scheduling error.
- Respect platform limits: X ~280 characters, LinkedIn keep the hook in the first two lines, Instagram requires media.
- Attach media by id. If the user already referenced a library asset, reuse that id verbatim instead of generating a new one.
- Video posts go out as native video. Never downgrade a video to its poster frame.
- Instagram has three formats: `post` (feed image), `reel` (needs a video) and `story` (needs an image or video, disappears in 24h). Default to `post`. Only pick `reel` when there is a video, and say which format you used.
- Stories carry no caption. Send empty `text` for a story unless the user actually wrote one — never invent a caption to fill the field, because that copy publishes for real. A post needs a caption OR media, so a story with an image and no words is valid.
- Reels can also appear in the feed — keep `shouldShareToFeed` on unless the user asks otherwise.
- First comment: supported on Instagram, LinkedIn and Facebook, never on Instagram stories. Use it for links on LinkedIn instead of putting the URL in the post body, and offer it when the post has a link, a source or overflow hashtags.
- Carousels (LinkedIn documents): LinkedIn only — every other network rejects them, and the tool will refuse those channels one by one. 2–10 pages. Portrait pages read best in the feed. The first page is the hook: big type, one idea, no clutter — it decides whether anyone swipes. Pass the generated image ids in reading order via `carouselImageIds`, plus a short `carouselTitle` (it becomes the document's display name on LinkedIn). A carousel cannot ALSO carry an image, a video or a link attachment — the document is the whole payload. The caption is the wrapper, not the content: write it to set up the swipe, not to repeat the slides.
- After scheduling, confirm in one line: channels, local time, format (post/reel/story) and whether media or a first comment was attached.
- On failure, report the reason plainly (token expired, channel disconnected, media rejected) and offer the internal calendar as a fallback.
