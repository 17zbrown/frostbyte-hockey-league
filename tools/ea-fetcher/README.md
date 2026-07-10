# EA stats fetcher

Pulls EASHL private-match box scores from EA and forwards them to the site's
ingest endpoint, which matches each to a scheduled game and writes the stats.

```
[this fetcher on your VPS] --EA--> proclubs.ea.com
        |
        └--POST /api/ingest-stats--> Netlify --> Supabase (game_stats + final score)
                                                      └--> standings + Discord #game-scores auto-update
```

Only this fetcher must run on a **non-datacenter (residential) IP** — EA blocks most
cloud IPs. Everything else is already live on the site.

## One-time setup

### 1. On the site side (Netlify env vars)
In Netlify → Site settings → Environment variables, add:

| Var | Value |
|---|---|
| `SUPABASE_URL` | `https://bzbuyclwdhmhdzujxeqd.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project settings → API → **service_role** key (secret) |
| `INGEST_KEY` | any long random string you invent (the shared secret) |

Redeploy so the function picks them up.

### 2. Register each club's EA id
For every team, set `teams.ea_club_id` to its EASHL club id (find it once via
`clubs/search`). A commissioner UI field for this can be added on request; until
then it's a quick SQL `update teams set ea_club_id='...' where code='GLK';`.

### 3. On your VPS / home box
```bash
# check this machine can even reach EA (200 = good, 403 = need a residential proxy)
PLATFORM=common-gen5 bash check-ip.sh

# set env and run
export INGEST_URL="https://chelgamingleague.com/api/ingest-stats"
export INGEST_KEY="<same secret as Netlify>"
export SUPABASE_URL="https://bzbuyclwdhmhdzujxeqd.supabase.co"
export SUPABASE_ANON_KEY="sb_publishable_9OVgiNJSCSKKp0NfnCwbBQ_W1rcrK3Z"   # publishable, safe
export PLATFORM="common-gen5"
node fetch-and-post.mjs
```

### 4. Schedule it (cron, every 4 min)
```cron
*/4 * * * * cd /path/to/ea-fetcher && /usr/bin/node fetch-and-post.mjs >> fetch.log 2>&1
```

## If `check-ip.sh` returns 403
Your VPS IP is on EA's block list. Options, cheapest first:
1. Run the fetcher on a **home machine / Raspberry Pi** (residential IP) instead.
2. Keep the VPS but route EA calls through a **residential proxy**: `npm i undici`,
   uncomment the `ProxyAgent` lines in `fetch-and-post.mjs`, and set
   `HTTPS_PROXY=http://user:pass@host:port`.

## Notes
- Idempotent: a match already ingested (`games.ea_match_id`) is skipped, so polling
  the same window repeatedly is safe.
- Only games that match a scheduled matchup (both clubs + same ET day) are written;
  scrimmages/pickups are ignored automatically.
- Players auto-link by EA name → site gamertag / signup EA id; unmatched players are
  still recorded by name so team totals stay correct.
- **Field-name caveat:** EA's exact JSON keys aren't officially documented. All the
  parsing lives in `normalizeMatch()` inside `netlify/functions/ingest-stats.js` —
  if a stat looks off on the first real game, that one function is the only place to
  adjust.
