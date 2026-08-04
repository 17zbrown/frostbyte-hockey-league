# Chel Gaming gateway bot

The always-on half of the Chel Gaming Discord bot. It is the **same bot** members already
see — same token, same name, same permissions — but running as a persistent process with a
live gateway connection, so it hears events the instant they happen instead of on the next
Netlify sweep.

**What it does today (phase 1):**
- Welcomes new members in `#welcome` the moment they join (respects membership screening).
- Logs departures to `#member-departures` and the database the moment someone leaves.
- Heartbeats every minute into the same Automations panel + watchdog as every other job.

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
sudo systemctl start chel-bot
journalctl -u chel-bot -f    # watch it connect
```

### 4. Verify
- The journal shows `gateway-bot: connected as <bot tag>`.
- Within a minute, **Control Center → Automations** shows the *Gateway bot* row green
  ("Running", "just now"). The database watchdog arms itself on that first heartbeat — from
  then on, a silent VM pages the commissioners within ~25 minutes.
- Leave/rejoin the server with a test account: the departure post and the welcome should
  both land in about a second.

---

## Operations

- **Deploys are automatic.** A systemd timer pulls `origin/main` every 5 minutes and
  restarts the bot only when something under `bot/` changed — push to main to ship, same as
  the site.
- **Logs:** `journalctl -u chel-bot -f`
- **Restart:** `sudo systemctl restart chel-bot`
- **If Discord says the bot is offline:** the sweeps are still covering everything; check
  `systemctl status chel-bot`, then the journal. The watchdog will already have posted to
  the ops channel if the heartbeat went stale.
- **Token rotation:** update `/etc/chel-bot.env` AND Netlify's env (same token), then
  `sudo systemctl restart chel-bot`.

## Architecture notes

- `handlers.mjs` holds all logic, dependency-free, tested by `tools/gateway-bot.test.mjs`.
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
  `automation_watchdog` with a 10-minute max age.

## Phase 2 candidates (not built yet)

- Second-resolution pickup lobby timers (currently the 2-min `lfg-timers` sweep).
- Faster EA polling on game nights (EA has no push API — polling is the floor; the VM could
  poll every 60–90 s vs. the current 5 min without touching Netlify's free tier).
- Instant role sync on site changes (currently within ~2 min via `discord-sync`).
