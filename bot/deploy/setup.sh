#!/usr/bin/env bash
# One-time VM setup. Prereq: the repo is cloned at /opt/chel-gaming (see bot/README.md).
# Run from anywhere:  sudo bash /opt/chel-gaming/bot/deploy/setup.sh
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run with sudo."; exit 1; }
[ -d /opt/chel-gaming/.git ] || { echo "Clone the repo to /opt/chel-gaming first (see bot/README.md)."; exit 1; }

# Node 22 LTS (NodeSource) if the box doesn't already have Node 20+.
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | sed 's/v\([0-9]*\).*/\1/')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
apt-get install -y git >/dev/null 2>&1 || true

chown -R ubuntu:ubuntu /opt/chel-gaming
cd /opt/chel-gaming/bot
sudo -u ubuntu npm install --omit=dev

# Env file: created empty on first run — fill it in, then start the service.
if [ ! -f /etc/chel-bot.env ]; then
  cp .env.example /etc/chel-bot.env
  chmod 600 /etc/chel-bot.env
  NEED_ENV=1
fi

install -m 644 deploy/chel-bot.service /etc/systemd/system/
install -m 644 deploy/chel-bot-update.service /etc/systemd/system/
install -m 644 deploy/chel-bot-update.timer /etc/systemd/system/
chmod +x deploy/update.sh
systemctl daemon-reload
systemctl enable chel-bot chel-bot-update.timer
systemctl start chel-bot-update.timer

if [ "${NEED_ENV:-0}" = "1" ]; then
  echo ""
  echo ">>> Now edit /etc/chel-bot.env with the four values from Netlify's environment"
  echo ">>> variables, then run:  sudo systemctl start chel-bot"
else
  systemctl restart chel-bot
  echo "chel-bot (re)started."
fi
echo "Check it:  systemctl status chel-bot   and   journalctl -u chel-bot -f"
