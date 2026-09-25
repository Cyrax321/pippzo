#!/usr/bin/env bash
# Fires one cron tick against the local app.
#
# The hosted deployment had pg_cron call this endpoint. A local Postgres cannot
# reach the app, so the tick is driven from the machine instead — by
# scripts/install-cron.sh on a schedule, or by hand via `npm run cron:once`.
#
# One tick runs every automation that is due AND every workspace heartbeat that
# is due (see src/routes/api/public/hooks/cron-tick.ts).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ ! -f "$ROOT/.env" ]]; then
  echo "cron-tick: no .env at $ROOT/.env" >&2
  exit 1
fi

# Read the secret and port without sourcing the whole file (values contain
# characters that a naive `source` would mangle). APP_PORT is the same env
# var vite.config.ts reads, so this always targets the real dev server port
# instead of a hard-coded one — set APP_URL directly to override entirely.
SECRET="$(grep -E '^CRON_TICK_SECRET=' "$ROOT/.env" | head -1 | cut -d= -f2- | tr -d '"'"'"' \r')"
APP_PORT="$(grep -E '^APP_PORT=' "$ROOT/.env" | head -1 | cut -d= -f2- | tr -d '"'"'"' \r')"
APP_URL="${APP_URL:-http://127.0.0.1:${APP_PORT:-5173}}"

if [[ -z "$SECRET" ]]; then
  echo "cron-tick: CRON_TICK_SECRET is not set in .env" >&2
  exit 1
fi

RESPONSE="$(curl -fsS -X POST "$APP_URL/api/public/hooks/cron-tick" \
  -H "x-cron-secret: $SECRET" \
  --max-time 300 2>&1)" || {
  echo "$(date '+%Y-%m-%dT%H:%M:%S') cron-tick FAILED: $RESPONSE" >&2
  exit 1
}

echo "$(date '+%Y-%m-%dT%H:%M:%S') cron-tick ok: $RESPONSE"
