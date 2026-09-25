# Pippzo

An AI agent that runs your social media: writes posts in your brand voice, generates on-brand images and video, publishes through Buffer, and manages your engagement inbox — all behind an approval queue so nothing goes live without you.

## Features

- Writes posts in your brand voice and improves from corrections
- Generates on-brand images and short videos (OpenAI, Gemini, Azure, Runway, Kling, Seedance, Veo)
- Publishes to LinkedIn, Instagram, X, Facebook, TikTok via Buffer
- Reads comments and DMs, drafts replies for your approval
- Monitors competitors and builds analyst reports
- Runs scheduled automations (daily posts, competitor scans, weekly reports)

Bring your own keys — no subscription, no vendor lock-in. Keys are stored encrypted in your local Postgres.

## Requirements

- Node.js ≥ 20.12
- npm
- Docker Desktop (for local Supabase)
- Supabase CLI
- ngrok (for Buffer image publishing)

## Setup

```bash
git clone https://github.com/Cyrax321/pippzo.git
cd pippzo
npm install
npm run db:start
cp .env.example .env
```

Then follow the prompts in the app. Full details: [DOCUMENTATION.md](DOCUMENTATION.md)

## Development

```bash
npm run dev
```

## License

[MIT](LICENSE)