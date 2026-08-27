/* The sign-in/out shake: Supabase fires auth events in bursts (INITIAL_SESSION on subscribe,
   SIGNED_IN + TOKEN_REFRESHED around a login, SIGNED_IN again on every tab refocus), and each
   one used to run the full applySession pipeline plus a whole-page re-render, concurrently —
   the page visibly re-rendered several times in a row on every login/logout.
   Run: node tools/auth-thrash.test.cjs

   This DRIVES the real CG.initAuth (extracted from part_live.js) against a fake auth client:
   same-identity bursts must be free, identity changes must serialize latest-wins. */
const fs = require("fs"), path = require("path");
const live = fs.readFileSync(path.join(__dirname, "..", "src/live/part_live.js"), "utf8");

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };
const tick = () => new Promise((r) => setTimeout(r, 0));

const src = live.match(/CG\.initAuth = async function\(\)\{[\s\S]*?\n\};/);
A("extracted CG.initAuth from the bundle", !!src);

function makeWorld({ bootUser = null, patch = null } = {}) {
  const w = {
    applied: [],           // sessions handed to applySession
    inFlight: 0, maxInFlight: 0,
    routerCalls: 0, chromeCalls: 0, quietArgs: [],
    resolvers: [],         // manual applySession completion
    fire: null,            // the registered onAuthStateChange callback
  };
  const CG = {
    auth: { user: bootUser, profile: bootUser ? { id: bootUser.id } : null },
    discordIdentityPatch: () => patch,
    applySession: (sess, quiet) => {
      w.applied.push(sess ? sess.user.id : null);
      w.quietArgs.push(!!quiet);
      w.inFlight++; w.maxInFlight = Math.max(w.maxInFlight, w.inFlight);
      return new Promise((res) => w.resolvers.push(() => { w.inFlight--; res(); }));
    },
    renderChrome: () => w.chromeCalls++,
    router: () => w.routerCalls++,
    sb: { auth: {
      getSession: async () => ({ data: { session: bootUser ? { user: bootUser } : null } }),
      onAuthStateChange: (cb) => { w.fire = cb; },
    } },
  };
  eval(src[0]);            // defines CG.initAuth against this sandbox CG
  w.CG = CG;
  return w;
}
const flushBoot = async (w) => { const p = w.CG.initAuth(); await tick(); w.resolvers.shift()(); await p; w.applied.length = 0; w.routerCalls = 0; };

(async () => {
  console.log("— a same-identity burst repaints nothing");
  {
    const u = { id: "u1" };
    const w = makeWorld({ bootUser: u });
    await flushBoot(w);
    for (const e of ["INITIAL_SESSION", "SIGNED_IN", "TOKEN_REFRESHED", "SIGNED_IN", "SIGNED_IN"])
      w.fire(e, { user: { id: "u1", meta: e } });
    await tick();
    A("only the token refresh runs, quietly", w.applied.length === 1, `ran ${w.applied.length}`);
    w.resolvers.shift()(); await tick();
    A("zero repaints", w.routerCalls === 0 && w.chromeCalls === 0, `${w.routerCalls} router calls`);
    A("the in-memory user still refreshes", w.CG.auth.user.meta === "SIGNED_IN");
  }

  console.log("\n— an identity change runs exactly once and repaints once");
  {
    const w = makeWorld({ bootUser: null });
    await flushBoot(w);
    w.fire("SIGNED_IN", { user: { id: "u1" } });
    await tick(); A("one pipeline run", w.applied.length === 1 && w.applied[0] === "u1");
    w.resolvers.shift()(); await tick();
    A("one repaint after it lands", w.routerCalls === 1 && w.chromeCalls >= 1);
  }

  console.log("\n— rapid changes serialize, latest wins, never concurrent");
  {
    const u = { id: "u1" };
    const w = makeWorld({ bootUser: u });
    await flushBoot(w);
    w.fire("SIGNED_OUT", null);                       // u1 -> guest: starts run 1
    w.fire("SIGNED_IN", { user: { id: "u2" } });      // arrives mid-flight: queued
    w.fire("SIGNED_IN", { user: { id: "u3" } });      // newer still: replaces the queue
    await tick();
    A("only the first is in flight", w.applied.length === 1 && w.applied[0] === null);
    w.resolvers.shift()(); await tick();
    A("then exactly the newest runs", w.applied.length === 2 && w.applied[1] === "u3", w.applied.join(","));
    w.resolvers.shift()(); await tick();
    A("never more than one run at a time", w.maxInFlight === 1);
    A("one repaint per completed run", w.routerCalls === 2, `${w.routerCalls} router calls`);
  }

  console.log("\n— the one same-user event that matters still runs: a newly linked Discord");
  {
    const u = { id: "u1" };
    const w = makeWorld({ bootUser: u, patch: { discord_id: "new" } });
    await flushBoot(w);
    w.fire("USER_UPDATED", { user: { id: "u1" } });
    await tick();
    A("identity patch falls through to a full run", w.applied.length === 1);
  }

  console.log("\n— the hourly token refresh keeps data fresh but repaints nothing");
  {
    const u = { id: "u1" };
    const w = makeWorld({ bootUser: u });
    await flushBoot(w);
    w.fire("TOKEN_REFRESHED", { user: { id: "u1" } });
    await tick();
    A("one QUIET pipeline run", w.applied.length === 1 && w.applied[0] === "u1");
    w.resolvers.shift()(); await tick();
    A("zero repaints from it", w.routerCalls === 0 && w.chromeCalls === 0, `${w.routerCalls} router, ${w.chromeCalls} chrome`);
    // a loud identity change queued behind a quiet refresh must stay loud
    w.fire("TOKEN_REFRESHED", { user: { id: "u1" } });
    w.fire("SIGNED_OUT", null);
    await tick();
    w.resolvers.shift()(); await tick();   // quiet refresh completes -> queued sign-out runs
    w.resolvers.shift()(); await tick();
    A("a sign-out queued behind it still repaints", w.applied.length === 3 && w.applied[2] === null && w.routerCalls === 1,
      `applied=${w.applied.join(",")} router=${w.routerCalls}`);
  }

  console.log("\n— a signed-out echo while already a guest is free");
  {
    const w = makeWorld({ bootUser: null });
    await flushBoot(w);
    w.fire("SIGNED_OUT", null); w.fire("INITIAL_SESSION", null);
    await tick();
    A("no runs, no repaints", w.applied.length === 0 && w.routerCalls === 0);
  }

  console.log("\n— review fixes: an incomplete apply keeps self-healing");
  {
    const u = { id: "u1" };
    const w = makeWorld({ bootUser: u });
    await flushBoot(w);
    w.CG.auth.profile = null;                 // the profile fetch failed -> apply never landed
    w.fire("SIGNED_IN", { user: { id: "u1" } });
    await tick();
    A("same-uid refocus re-runs LOUD until the profile lands",
      w.applied.length === 1 && w.quietArgs[w.quietArgs.length-1] === false);
    w.CG.auth.profile = { id: "u1" };         // this apply landed
    w.resolvers.shift()(); await tick();
    w.fire("SIGNED_IN", { user: { id: "u1" } });
    await tick();
    A("...and dedupes again once it has", w.applied.length === 1);
  }

  console.log("\n— review fixes: a refused identity patch stops forcing loud runs");
  {
    const u = { id: "u1" };
    const pt = { discord_id: "new" };
    const w = makeWorld({ bootUser: u, patch: pt });
    await flushBoot(w);
    w.CG._idPatchFailedFp = JSON.stringify(pt);   // applySession recorded the refused write
    w.fire("SIGNED_IN", { user: { id: "u1" } });
    w.fire("SIGNED_IN", { user: { id: "u1" } });
    await tick();
    A("the recomputed identical patch no longer runs the pipeline", w.applied.length === 0);
  }

  console.log("\n— review fixes: no duplicate quiet pipeline while one is in flight");
  {
    const u = { id: "u1" };
    const w = makeWorld({ bootUser: u });
    await flushBoot(w);
    w.fire("SIGNED_OUT", null);                          // loud change in flight
    w.fire("TOKEN_REFRESHED", { user: { id: "u1" } });   // stale echo for the OLD uid: identity change! runs loud
    await tick();
    A("a token echo for a different uid is an identity change, queued loud", w.CG._authNext && w.CG._authNext.quiet === false);
    w.resolvers.shift()(); await tick(); w.resolvers.shift()(); await tick();
    const before = w.applied.length;
    w.fire("SIGNED_IN", { user: { id: "u2" } });         // loud change in flight
    w.fire("TOKEN_REFRESHED", { user: { id: "u2" } });   // same-uid quiet while applying: dropped
    await tick();
    A("a same-uid quiet refresh mid-flight is dropped, not queued", w.CG._authNext == null);
    w.resolvers.shift()(); await tick();
    A("...so only the loud run happened", w.applied.length === before + 1);
  }

  console.log("\n— review fixes: a throwing repaint never strands the queue");
  {
    const u = { id: "u1" };
    const w = makeWorld({ bootUser: u });
    await flushBoot(w);
    let threw = false;
    w.CG.router = () => { if (!threw){ threw = true; throw new Error("render boom"); } w.routerCalls++; };
    w.fire("SIGNED_OUT", null);                       // loud run 1 (repaint will throw)
    w.fire("SIGNED_IN", { user: { id: "u2" } });      // queued behind it
    await tick();
    w.resolvers.shift()(); await tick();
    A("the queued session still runs after the repaint threw",
      w.applied.length === 2 && w.applied[1] === "u2");
    w.resolvers.shift()(); await tick();
    A("...and the follow-up repaint recovers", w.routerCalls === 1);
  }

  console.log("\n— review fixes: a landing session resolves the OAuth pending state");
  {
    const w = makeWorld({ bootUser: null });
    await flushBoot(w);
    w.CG._oauthPending = true;                        // the OAuth fragment was being consumed
    w.fire("SIGNED_IN", { user: { id: "u1" } });
    A("pending clears the moment the session lands", w.CG._oauthPending === false);
    w.resolvers.shift()(); await tick();
  }

  console.log("\n— the quiet flag reaches applySession itself");
  {
    A("quiet runs were handed quiet=true, loud runs quiet=false",
      /CG\.applySession = async function\(session, quiet\)/.test(live));
    A("a quiet run leaves the messages page alone", /if\(!quiet&&location\.hash\.indexOf\("\/messages"\)/.test(live));
    A("...and the case surfaces", /if\(!quiet\) CG\.rerenderIfShowingCases\(\)/.test(live));
    A("...and an admin's View-as preview", /if \(!quiet\)\{\n    CG\._va = null;/.test(live));
    A("a refused patch write records its fingerprint",
      (live.match(/CG\._idPatchFailedFp = JSON\.stringify\(idPatch\)/g) || []).length === 2);
    A("an abandoned OAuth round-trip falls back to the sign-in button",
      /CG\._oauthPending = false;\n        if \(location\.hash\.indexOf\("#\/signin"\)===0/.test(live));
  }

  console.log(`\n${ok ? "PASS" : "FAIL"}`);
  process.exit(ok ? 0 : 1);
})();
