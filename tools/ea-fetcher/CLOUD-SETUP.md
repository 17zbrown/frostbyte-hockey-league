# Hands-off cloud setup (no home computer)

This runs the stats poller **free on GitHub Actions**; only the EA request goes out
through a **residential proxy** you rent (a few $/month) so EA doesn't block it.

There are **5 steps**, in order. Steps 1–2 are the same regardless of hosting; 3–5
are the cloud/proxy specifics. Do them one at a time.

```
GitHub Actions (free, scheduled)  --EA via residential proxy-->  EA
        |                                                         |
        └------ POST /api/ingest-stats -----> Netlify --> Supabase --> site + Discord
```

---

## Step 1 — Netlify settings  (Part A from chat)
Give the site's endpoint its 3 settings, then redeploy. (Detailed click-by-click is
in the chat walkthrough.)
- `SUPABASE_URL` = `https://bzbuyclwdhmhdzujxeqd.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY` = Supabase → Project Settings → API → **service_role** (secret)
- `INGEST_KEY` = a long random string you invent (save it — you'll reuse it in Step 4)

## Step 2 — Register club IDs  (Part B from chat)
Set `teams.ea_club_id` for each team (found via EA `clubs/search`, written with a
one-line SQL each in Supabase → SQL Editor). Or ask for the commissioner UI field.

## Step 3 — Rent a residential proxy
Sign up with any residential-proxy provider (examples: **IPRoyal**, **Decodo /
Smartproxy**, **Bright Data**). Because we send only a few KB every few minutes,
pick a small **pay-as-you-go** plan — usage is tiny.

They'll give you a proxy in this form (copy it):
```
http://USERNAME:PASSWORD@HOST:PORT
```
Pick a **US** location if offered.

## Step 4 — Add secrets to GitHub
1. Go to the repo on GitHub → **Settings** → **Secrets and variables** → **Actions**.
2. Click **New repository secret** and add these three:

| Secret name | Value |
|---|---|
| `INGEST_KEY` | the **same** random string from Step 1 |
| `SUPABASE_ANON_KEY` | `sb_publishable_9OVgiNJSCSKKp0NfnCwbBQ_W1rcrK3Z` |
| `HTTPS_PROXY` | the proxy URL from Step 3 (`http://user:pass@host:port`) |

(The workflow already knows the non-secret values — site URL, Supabase URL, platform.)

## Step 5 — Turn it on and test
1. Repo → **Actions** tab. If prompted, click **enable workflows**.
2. Pick **EA stats fetcher** on the left → **Run workflow** → **Run workflow** (green button).
3. Open the run and read the log. Success looks like:
   ```
   Routing EA calls through residential proxy.
   Polling 8 club(s) on common-gen5…
   Forwarded 3 match(es) -> ingest HTTP 200
     ingested=1 skipped=2 unmatched=0 errors=0
   ```
4. After that, it runs **automatically** on Wed/Fri game nights (see the schedule in
   `.github/workflows/ea-stats.yml`; widen it if you add nights).

### If the log shows `EA 403`
The proxy IP got blocked too — switch the proxy to a different residential IP/location
in the provider dashboard, or try another provider. Nothing in the code changes.

### If it shows `unmatched`
That club game had no scheduled matchup that day (a scrimmage) — correctly ignored,
or a club's `ea_club_id` isn't set (Step 2).
