#!/usr/bin/env bash
# Installs a launchd agent that fires the cron tick every minute.
#
# Why the tick is driven from the machine at all: the hosted deployment had
# pg_cron call this endpoint, but a local Postgres container cannot reach the
# app, so something outside the database has to poke it.
#
# Why the plist is self-contained rather than calling scripts/cron-tick.sh:
# macOS TCC does not extend a Terminal's access to protected folders
# (~/Desktop, ~/Documents) to launchd agents. An agent pointed at a script
# inside this project fails with "Operation not permitted" and never runs. So
# the schedule, the URL and the secret are baked into the plist in
# ~/Library/LaunchAgents, and logs go to ~/Library/Logs — none of which is
# protected. Re-run this script after changing CRON_TICK_SECRET or the port.
#
# The tick only succeeds while the app is running. When it is down the request
# fails and is logged; that is expected, and it is why automations only advance
# while the app is up.

set -euo pipefail

if [[ "$(uname)" != "Darwin" ]]; then
  echo "This installer uses launchd and is macOS-only."
  echo "On Linux, add this line to your crontab instead:"
  echo "  * * * * * cd $(pwd) && ./scripts/cron-tick.sh >> ~/.social-studio-cron.log 2>&1"
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="dev.social-studio.cron"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs/social-studio"

if [[ ! -f "$ROOT/.env" ]]; then
  echo "install-cron: no .env at $ROOT/.env" >&2
  exit 1
fi

# APP_PORT is the same env var vite.config.ts reads, so the plist always
# targets the real dev server port instead of a hard-coded one — set APP_URL
# directly to override entirely.
SECRET="$(grep -E '^CRON_TICK_SECRET=' "$ROOT/.env" | head -1 | cut -d= -f2- | tr -d '"'"'"' \r')"
APP_PORT="$(grep -E '^APP_PORT=' "$ROOT/.env" | head -1 | cut -d= -f2- | tr -d '"'"'"' \r')"
APP_URL="${APP_URL:-http://127.0.0.1:${APP_PORT:-5173}}"
if [[ -z "$SECRET" ]]; then
  echo "install-cron: CRON_TICK_SECRET is not set in $ROOT/.env" >&2
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"

cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/curl</string>
    <string>-fsS</string>
    <string>--max-time</string>
    <string>300</string>
    <string>-X</string>
    <string>POST</string>
    <string>$APP_URL/api/public/hooks/cron-tick</string>
    <string>-H</string>
    <string>x-cron-secret: $SECRET</string>
  </array>
  <key>StartInterval</key>
  <integer>60</integer>
  <key>WorkingDirectory</key>
  <string>/tmp</string>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/cron.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/cron.err.log</string>
  <key>ProcessType</key>
  <string>Background</string>
</dict>
</plist>
PLIST_EOF

# The plist carries the shared secret, so keep it readable only by this user.
chmod 600 "$PLIST"

# bootout first so re-running this script reloads a changed plist.
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

echo "Installed $LABEL — one tick per minute against $APP_URL"
echo "  logs:    $LOG_DIR/cron.log"
echo "  errors:  $LOG_DIR/cron.err.log"
echo "  remove:  npm run cron:uninstall"
echo
echo "Re-run this after changing CRON_TICK_SECRET or the dev server port."
