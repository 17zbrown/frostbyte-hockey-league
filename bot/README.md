# Chel Gaming gateway bot

The always-on half of the Chel Gaming Discord bot. It is the **same bot** members already
see — same token, same name, same permissions — but running as a persistent process with a
live gateway connection, so it hears events the instant they happen instead of on the next
Netlify sweep.

**What it does today (phase 1):**
- Welcomes new members in `#welcome` the moment they join (respects membership screening).
- Logs departures to `#member-departures` (public, in Information) and the database the moment
  someone leaves — the post says who they were to the league (club seat, roster spot, staff
  department or sign-up), from `public.member_league_card`, the same card the sweep reads.
- Heartbeats every minute into the same Automations panel + watchdog as every other job.

**A second unit on the same VM, `chel-ea-poll`,** runs the EA score poller (`ea-poll-service.mjs`)
as its own process. It shares the env file and nothing else: the gateway bot exits on purpose
when Discord closes the connection unrecoverably, and the box-score import must not die with it.

**What it deliberately does NOT do:** replace the Netlify sweeps. They keep running at their
current (free-tier) cadences as the reconciliation backstop. Both lanes write the same
ledgers (`welcomed_members`, `guild_members.present`), so whichever lane acts first, the
other sees it already handled — no double welcomes, no double departure posts. If this VM
dies, the sweeps take over automatically and the watchdog pages the commissioners.

---

## Setting up the Oracle Cloud VM (one time, ~20 minutes)

Oracle's **Always Free** tier includes Ampere ARM compute (up to 4 OCPU / 24 GB total) that
never expires. This bot needs a fraction of the smallest slice.

### 1. Create the account
1. Sign up at https://www.oracle.com/cloud/free/ — it asks for a credit card for identity
   verification; Always Free resources are not billed.
2. **Recommended:** after signup, upgrade the account to **Pay As You Go** (Billing →
   Upgrade). Counterintuitive but important: PAYG accounts keep the same $0 Always Free
   allowances, but Oracle stops reclaiming "idle" free instances and gives you priority when
   ARM capacity is tight. You still pay nothing while inside the free limits.

### 2. Create the instance
1. Console → **Compute → Instances → Create instance**.
2. Image: **Ubuntu 24.04** (aarch64). Shape: **VM.Standard.A1.Flex** — 1 OCPU / 6 GB is
   plenty (that leaves 3 OCPU / 18 GB of your free allowance unused).
3. Add your SSH public key. Everything else default — the bot only makes *outbound*
   connections, so no ingress rules are needed beyond the default SSH.
4. If creation fails with "out of capacity": try another availability domain, or retry
   later — PAYG accounts (step 1.2) rarely hit this.

### 3. Install the bot
SSH in as `ubuntu`, then:

```bash
# The Minimal Ubuntu image may lack git/curl — install them first
sudo apt-get update && sudo apt-get install -y git curl

# Clone the repo (create a fine-grained GitHub token with read-only Contents access:
# GitHub → Settings → Developer settings → Fine-grained tokens, repo: frostbyte-hockey-league)
sudo mkdir -p /opt/chel-gaming
sudo chown ubuntu:ubuntu /opt/chel-gaming
git clone https://<GITHUB_TOKEN>@github.com/17zbrown/frostbyte-hockey-league.git /opt/chel-gaming

# One-time setup: Node 22, npm deps, systemd units, auto-update timer
sudo bash /opt/chel-gaming/bot/deploy/setup.sh
```

Then fill in `/etc/chel-bot.env` — the same four values the Netlify functions use
(Netlify dashboard → Site configuration → Environment variables):
`DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — and:

```bash
sudo systemctl start chel-bot chel-ea-poll
journalctl -u chel-bot -u chel-ea-poll -f    # watch them come up
```

### 4. Verify
- The journal shows `gateway-bot: connected as <bot tag>` and
  `ea-poll-service: EA score poller running`.
- Within a minute, **Control Center → Automations** shows the *Gateway bot* row green
  ("Running", "just now"), and *EA score poller (bot server)* alongside it. The database
  watchdog arms itself on that first heartbeat — from then on, a silent VM pages the
  commissioners within ~25 minutes.
- Leave/rejoin the server with a test account: the departure post and the welcome should
  both land in about a second.

### Upgrading a VM set up before `chel-ea-poll` existed (before 2026-09-17)
Nothing to do by hand: `update.sh` installs and starts any unit under `bot/deploy/` that systemd
does not have yet, on every 5-minute tick, before it pulls. The tick that pulls this change still
runs the old script (which only restarts `chel-bot`), so there is one tick — up to five minutes —
during which no process polls EA; the next tick starts `chel-ea-poll`. To close that gap right
away, or to check it happened:

```bash
sudo bash /opt/chel-gaming/bot/deploy/update.sh      # pulls, installs the unit, starts it
systemctl status chel-bot chel-ea-poll               # both active (running)
journalctl -u chel-ea-poll -n 20                     # "ea-poll-service: EA score poller running"
```

---

## Operations

- **Deploys are automatic.** A systemd timer pulls `origin/main` every 5 minutes and
  restarts both services only when something under `bot/` or `shared/` changed — push to main
  to ship, same as the site. Unit files under `bot/deploy/` are installed/refreshed by the same
  tick, so a new or changed unit ships by push too.
- **Logs:** `journalctl -u chel-bot -f` (gateway) · `journalctl -u chel-ea-poll -f` (EA poller)
- **Restart:** `sudo systemctl restart chel-bot` · `sudo systemctl restart chel-ea-poll`
- **If Discord says the bot is offline:** the sweeps are still covering everything and the EA
  poller is unaffected (its own unit); check `systemctl status chel-bot`, then the journal. The
  watchdog will already have posted to the ops channel if the heartbeat went stale.
- **If box scores stop importing:** `systemctl status chel-ea-poll`, then
  `journalctl -u chel-ea-poll -n 50`; the Automations panel's *EA score poller (bot server)*
  row goes stale after 10 minutes without a cycle.
- **Token rotation:** update `/etc/chel-bot.env` AND Netlify's env (same token), then
  `sudo systemctl restart chel-bot` (the poller does not use the Discord token; no restart needed).

## Architecture notes

- `handlers.mjs` holds all logic (no discord.js — only `shared/departure-card.mjs`, the one
  definition of the #member-departures post it shares with the sweep), tested by `tools/gateway-bot.test.mjs`.
  `chel-bot.mjs` only maps discord.js events onto it.
- Exactly-once interlocks with the sweeps:
  - Welcomes: `welcomed_members` (post first, record after — a failed post is retried by
    the 5-min sweep, never lost). The greeting copy is KEPT IN SYNC with
    `netlify/functions/discord-welcome.js`.
  - Departures: recording marks `guild_members.present=false`, which removes the member
    from the census diff the 2-min sync sweep announces from.
- Burst guards mirror the sweeps: >15 welcomes or departures inside 10 minutes are
  recorded silently instead of mass-pinging (raid / outage protection).
- Heartbeat: `rl_gateway-bot` (+ `rl_gateway-bot_result`) in `app_config`, watched by
  `automation_watchdog` with a 10-minute max age. The result row carries every instant lane's
  counters; a lane failure inside the last hour (a role PATCH that failed, a club-room post that
  did not deliver) flips `ok:false` with the reason in `lastError`, the same grade the sweep
  gives itself — `laneErrors` is the running count, `laneErrorsRecent` the lanes still red.
- **Transport:** every Discord and Supabase call the gateway bot's lanes make carries a deadline
  — 15 s Discord, 10 s Supabase — through one helper (`timedFetch` in `handlers.mjs`); a
  timed-out call fails like any other and never hangs a lane. (`ea-poll.mjs` carries its own EA
  and ingest deadlines.) `POST /channels/…/messages` is sent once (a 429 is
  waited out, since nothing was stored): a timeout or 5xx is an *unknown* outcome, so the lane
  keeps its `discord_post_log` claim and does not re-send — and once Discord has accepted a
  message, the bookkeeping stamp is retried three times and the claim is kept regardless.
  Role-sync gives every member's sync its own deadline and re-queues a failed one on a bounded
  backoff ladder (5 s, 30 s, 2 min), so one hung member never stalls the queue.
- **EA score poller (primary lane):** `ea-poll.mjs`, tested by `tools/ea-poll-vm.test.mjs`;
  run by `ea-poll-service.mjs` under its own unit, `chel-ea-poll` (`tools/ea-poll-service.test.mjs`).
  EA's Pro Clubs API answers this VM but blocks Netlify's address, so the box-score import runs
  here: a 60-second cycle that stamps `rl_ea-poll-vm`, asks EA only while a fixture's game window
  (`shared/game-window.cjs`: puck drop − 10 min to + 3 h, plus a 15-min fetching grace) is open,
  only for the clubs in those fixtures, at most every 90 s, and hands everything it finds to
  `/api/ingest-stats` with the service-role key — the importer alone files (scheduled matchup,
  inside the window) and merges a Rule 4.3 replay into the sitting it continues. `netlify/functions/ea-poll.js` stands down while
  the stamp is under 10 minutes old and takes over (proxy permitting) if this lane dies. One-shot
  from the VM: `sudo -E bash -c 'set -a; . /etc/chel-bot.env; set +a; node /opt/chel-gaming/bot/ea-poll.mjs --once --force'`.

## Phase 2 candidates (not built yet)

- Second-resolution pickup lobby timers (currently the 2-min `lfg-timers` sweep).
