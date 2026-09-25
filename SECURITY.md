# Security

## How this app handles secrets

Social Studio is bring-your-own-key by design. Provider API keys (text models, image
and video models, Buffer, Unipile, Firecrawl, ScrapeCreators, Slack) are
entered per workspace in the app and stored in your own Postgres, encrypted at
rest with AES-GCM using `PROVIDER_KEY_SECRET` from your `.env`. The app
refuses to store keys if that secret is not set.

All credential families — text/image/video providers, service credentials, and
the Buffer access token — are written encrypted with the plaintext column left
blank; every read decrypts first. If you upgraded from an early build, run
`npm run secrets:encrypt` once to encrypt any secret still stored in plaintext
(idempotent, safe to re-run).

`.env` holds infrastructure secrets only and is gitignored. Never commit it.

Public endpoints (`/api/public/hooks/*`) fail closed: an unset webhook secret
disables the endpoint rather than leaving it unauthenticated, and secrets are
compared in constant time.

## Untrusted content and the agent

The agent ingests third-party text (engagement inbox comments/DMs, web-search
and scraped results, pasted reference posts). This content is labeled as
untrusted data in the system prompt, and the agent is instructed never to treat
instructions inside it as commands. As defense in depth, if you connect a live
inbox and enable autonomous replies, review the auto-reply policy: autonomous
mode is opt-in and gated in code to non-negative, safe-category items only.
Actions with real-world effects (publishing, sending replies, changing settings)
should be driven by your explicit request in chat, not by fetched content.

## Reporting a vulnerability

Open a GitHub security advisory on this repository (Security → Advisories →
Report a vulnerability), or open an issue asking for a private contact if the
details are sensitive. Please do not disclose publicly before a fix ships.
