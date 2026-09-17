#!/usr/bin/env bash
# Pull origin/main; if anything under bot/ changed, reinstall deps and restart the services.
# Push to main -> the VM picks it up within 5 minutes, mirroring the site's auto-deploy.
#
# Two services ride on this: chel-bot (the Discord gateway) and chel-ea-poll (the EA score
# poller, its own unit since 2026-09-17 so a gateway exit cannot take the import with it). The
# unit files themselves are kept current here too: a unit that only setup.sh installs is a unit
# that a push cannot ship, and the tick that pulls a new unit file is still running the OLD copy
# of this script — so the check runs BEFORE the fetch, on every tick, and installs anything
# under deploy/ that differs from what systemd has. Only the two named services are eligible.
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

SERVICES="chel-bot chel-ea-poll"

# Install (or refresh) each service's unit file from the checkout. Idempotent: a unit that
# already matches is left alone; a changed one is reinstalled and re-enabled, and takes effect on
# the restart below (or, for a unit that was never installed, is started right here — that is how
# chel-ea-poll comes up on a VM set up before it existed, with no hands on the box).
units_changed=""
for svc in $SERVICES; do
  src="$REPO/bot/deploy/$svc.service"; dst="/etc/systemd/system/$svc.service"
  [ -f "$src" ] || continue
  if [ ! -f "$dst" ]; then
    install -m 644 "$src" "$dst"; systemctl daemon-reload
    systemctl enable --now "$svc" && echo "$svc: unit installed and started"
  elif ! cmp -s "$src" "$dst"; then
    install -m 644 "$src" "$dst"; systemctl daemon-reload
    systemctl enable "$svc" >/dev/null 2>&1 || true
    echo "$svc: unit file updated"
    units_changed="$units_changed $svc"
  fi
done

# A crash-looping build (or an exit(1) on a fatal gateway close) trips StartLimitBurst and leaves
# a unit in `failed`, where Restart=always no longer applies — it would stay dead until someone
# noticed. Clear that state every tick: if the cause is permanent it simply trips again, and the
# heartbeat stays stale so the watchdog keeps paging.
for svc in $SERVICES; do
  if systemctl is-failed --quiet "$svc"; then
    echo "$svc was in a failed state — resetting and restarting"
    systemctl reset-failed "$svc"
    systemctl start "$svc" || true
  fi
done

before=$(as_owner git -C "$REPO" rev-parse HEAD)
as_owner git -C "$REPO" fetch --quiet origin main
as_owner git -C "$REPO" reset --hard --quiet origin/main
after=$(as_owner git -C "$REPO" rev-parse HEAD)

if [ "$before" = "$after" ]; then
  # nothing new to pull, but a refreshed unit file still needs its service restarted to apply
  [ -n "$units_changed" ] && systemctl restart $units_changed && echo "restarted$units_changed for the updated unit files"
  exit 0
fi

# shared/ carries the role rules the bot imports (shared/roles.mjs) — an edit there changes the
# bot's behavior without touching bot/, so it must trigger the same restart.
if as_owner git -C "$REPO" diff --quiet "$before" "$after" -- bot/ shared/; then
  echo "chel-bot: repo updated $before -> $after (nothing under bot/ or shared/ changed)"
  exit 0
fi

cd "$REPO/bot"
as_owner npm install --omit=dev --silent
systemctl restart $SERVICES
echo "$SERVICES updated $before -> $after and restarted"
