#!/usr/bin/env bash
# Pull origin/main; if anything under bot/ changed, reinstall deps and restart the bot.
# Push to main -> the VM picks it up within 5 minutes, mirroring the site's auto-deploy.
#
# systemd runs this as root, but the checkout belongs to the service account. Git refuses to
# touch a repo owned by another user ("detected dubious ownership" — CVE-2022-24765 hardening),
# so every git/npm call drops to the owner instead of marking the repo safe for root. HOME is
# set explicitly too: without it npm would try to write root's cache as the wrong user.
# Only the restart actually needs root.
set -euo pipefail

REPO=/opt/chel-gaming
OWNER=$(stat -c '%U' "$REPO")
OWNER_HOME=$(getent passwd "$OWNER" | cut -d: -f6)
as_owner() { runuser -u "$OWNER" -- env HOME="$OWNER_HOME" "$@"; }

# A crash-looping build (or an exit(1) on a fatal gateway close) trips StartLimitBurst and leaves
# the unit in `failed`, where Restart=always no longer applies — it would stay dead until someone
# noticed. Clear that state every tick: if the cause is permanent it simply trips again, and the
# heartbeat stays stale so the watchdog keeps paging.
if systemctl is-failed --quiet chel-bot; then
  echo "chel-bot was in a failed state — resetting and restarting"
  systemctl reset-failed chel-bot
  systemctl start chel-bot || true
fi

before=$(as_owner git -C "$REPO" rev-parse HEAD)
as_owner git -C "$REPO" fetch --quiet origin main
as_owner git -C "$REPO" reset --hard --quiet origin/main
after=$(as_owner git -C "$REPO" rev-parse HEAD)

[ "$before" = "$after" ] && exit 0

if as_owner git -C "$REPO" diff --quiet "$before" "$after" -- bot/; then
  echo "chel-bot: repo updated $before -> $after (nothing under bot/ changed)"
  exit 0
fi

cd "$REPO/bot"
as_owner npm install --omit=dev --silent
systemctl restart chel-bot
echo "chel-bot updated $before -> $after and restarted"
