#!/usr/bin/env bash
# Does THIS machine's IP have access to EA's Pro Clubs API?
# EA (Akamai) blocks most datacenter IPs. Run this ON THE VPS/box that will host
# the fetcher BEFORE relying on it. 200 = good. 403 = blocked (need a residential proxy).
set -euo pipefail

PLATFORM="${PLATFORM:-common-gen5}"          # common-gen5 = PS5/Xbox Series ; common-gen4 = last-gen
CLUB="${1:-36218}"                            # any real EA NHL club id works as a probe
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
URL="https://proclubs.ea.com/api/nhl/clubs/matches?matchType=club_private&platform=${PLATFORM}&clubIds=${CLUB}"

echo "Probing EA from this machine's public IP: $(curl -s -m 10 https://api.ipify.org || echo '?')"
code=$(curl -s -o /tmp/ea_probe.json -w "%{http_code}" -m 25 -A "$UA" \
  -H "Accept: application/json" -H "Referer: https://www.ea.com/games/nhl/nhl-26" "$URL" || true)

echo "HTTP $code"
case "$code" in
  200) echo "✅ Reachable. This IP can run the fetcher directly."; head -c 200 /tmp/ea_probe.json; echo ;;
  403) echo "⛔ Blocked by EA's edge. Put a RESIDENTIAL proxy in front (set HTTPS_PROXY) or run from a home IP." ;;
  *)   echo "⚠️  Unexpected ($code). Check network/params; body below:"; head -c 300 /tmp/ea_probe.json; echo ;;
esac
