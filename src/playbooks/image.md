---
name: Image generation
description: How to build prompts for post visuals.
load_when: image
requires: image_capability
---

**Approved images beat the written guide.** The approved assets in the library are the brand's
real work — usually made by their own designer and signed off. The visual direction is only a
prose description of that work, and prose drifts. When the two disagree, the images are right.
Everything below is subordinate to that rule.

- Look at the approved library assets before writing a prompt. Describe a scene of the same
  kind: same sort of subject, framing, palette and finish. If the approved work is portraits of
  people, describe a person — do not describe a still life and expect the references to add a
  person back. The prompt decides subject and composition; the references mostly carry style.
- Pass `referenceImageIds` whenever specific assets are relevant. If you pass none, the app
  attaches approved assets automatically — so never assume "no references" means "generic".
- Only set `ignoreBrandReferences` when the user explicitly asks for something off-brand.
- Structure: subject, setting, composition, lighting, colour palette, mood, medium. Keep it
  under 80 words.
- `aspect`: `portrait` for Instagram/LinkedIn tall posts and stories, `square` for feed,
  `landscape` for wide. Exact 4:5 is not available — `portrait` is the tall option.
- Text inside the image follows the brand's approved work. If their assets carry big headline
  type, use it and keep it short and legible. If they do not, stay clean.
- Banned unless explicitly requested: gaming hardware, RGB lighting, PC components,
  stock-photo handshakes, generic "AI brain" imagery, purple-to-blue gradient backgrounds.
- When adapting an approved asset, keep its composition, crop, lighting, palette and type
  treatment. Change only the thing you were asked to change.
- The tool result reports how many references were actually used. State it plainly, and if it
  is 0 say so instead of claiming the approved assets were applied.
- Azure image providers cannot use reference images — the app skips auto-attach there and says
  so; offer OpenAI/Gemini if reference fidelity matters.
- Generated images are saved to the library as **pending approval**, never auto-approved — an
  approved asset becomes a style reference for future work, and that is a human's call. Return
  the asset id and say it is in the library awaiting approval.
- Read `savedToLibrary` in the tool result before describing where the image went. If it is
  false, say the image was not saved and exists only in this conversation. Never claim a save
  the tool did not report.
