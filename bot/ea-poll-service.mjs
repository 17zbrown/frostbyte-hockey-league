// Chel Gaming EA score poller — the standalone service entry (systemd unit chel-ea-poll).
//
// WHY ITS OWN PROCESS: the poller loop used to run inside chel-bot.mjs, and that process exits on
// purpose when the Discord gateway closes unrecoverably (bad token, disallowed intents) or the
// login fails — the right thing for a deaf bot, the wrong thing for the league's only working
// box-score importer, which died with it (audit 2026-09-17, P2-15). Here the loop has no gateway
// to die with: it needs only SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the same env file,
// runs under its own unit with Restart=always, and keeps its own heartbeat exactly as before
// (rl_ea-poll-vm every cycle, rl_ea-poll after every real poll, rl_ea-poll_result per run — all
// stamped by ea-poll.mjs itself, so nothing the Automations panel or the watchdog reads changes).
//
// The loop itself is unchanged: createEaPoller in ea-poll.mjs, which stays runnable one-shot
// (`node ea-poll.mjs --once`). This file only holds the process open around it — the poller's
// interval is unref'd by design so a one-shot can exit, which in a process of its own means
// something else must keep the event loop alive.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY; INGEST_KEY optional (the bot's DISCORD_* values
// are ignored here).

import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";
import { createEaPoller } from "./ea-poll.mjs";

/* The service around the poller: start it, hold the loop, stop it cleanly. `opts.createPoller`
   lets tools/ea-poll-service.test.mjs stand in a fake poller — the real one is exercised by
   tools/ea-poll-vm.test.mjs. */
export function createEaPollService(env, opts = {}) {
  const make = opts.createPoller || createEaPoller;
  const log = opts.log || console.log;
  const KEEPALIVE_MS = opts.keepaliveMs ?? 60_000;
  const poller = make(env, { log });
  let hold = null;
  function start() {
    if (hold) return;
    /* a ref'd interval is the whole reason this process stays up. Liveness is not judged here:
       the poller stamps rl_ea-poll-vm every cycle and the watchdog grades that, the same as when
       the loop lived in the gateway process. */
    hold = setInterval(() => {}, KEEPALIVE_MS);
    poller.start();
  }
  function stop() {
    if (hold) clearInterval(hold);
    hold = null;
    poller.stop();
  }
  return { start, stop, poller, running: () => hold !== null };
}

/* ---- the service entry: env check, start, die loudly on SIGTERM/SIGINT so systemd knows ---- */
const isMain = (() => {
  try { return !!process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; }
  catch { return false; }
})();
if (isMain) {
  /* INGEST_KEY is optional — the poller falls back to the service key for the ingest hand-off
     (and reads process.env itself); passed through here so the env is explicit in one place */
  const env = { SB_URL: process.env.SUPABASE_URL, SB_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY, INGEST_KEY: process.env.INGEST_KEY || null };
  const REQUIRED = { SB_URL: "SUPABASE_URL", SB_KEY: "SUPABASE_SERVICE_ROLE_KEY" };
  const missing = Object.entries(REQUIRED).filter(([k]) => !env[k]).map(([, name]) => name);
  if (missing.length) {
    console.error(`ea-poll-service: missing env (${missing.join(", ")}) — check /etc/chel-bot.env`);
    process.exit(1);
  }
  const S = createEaPollService(env, { log: console.log });
  S.start();
  console.log("ea-poll-service: EA score poller running (its own unit — independent of the gateway bot)");
  for (const sig of ["SIGTERM", "SIGINT"]) {
    process.on(sig, () => {
      console.log(`ea-poll-service: ${sig} — shutting down`);
      S.stop();
      process.exit(0);
    });
  }
}
