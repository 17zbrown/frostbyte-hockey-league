#!/usr/bin/env bash
# Pull origin/main; if anything under bot/ changed, reinstall deps and restart the bot.
# Push to main -> the VM picks it up within 5 minutes, mirroring the site's auto-deploy.
set -euo pipefail
cd /opt/chel-gaming

before=$(git rev-parse HEAD)
git fetch --quiet origin main
git reset --hard --quiet origin/main
after=$(git rev-parse HEAD)

if [ "$before" != "$after" ] && ! git diff --quiet "$before" "$after" -- bot/; then
  cd bot
  npm install --omit=dev --silent
  systemctl restart chel-bot
  echo "chel-bot updated $before -> $after and restarted"
fi
