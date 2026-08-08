/* Commissioner writes check the session first, and a blocked delete is never reported as success.
   Run: node tools/privileged-writes.test.cjs   (build index.html first)

   Two real failures motivate this. (1) Generating the regular season died with the raw Postgres
   string `new row violates row-level security policy for table "games"`, which reads like the
   league's permissions are broken. They were not: PostgREST does not reject an expired session, it
   downgrades the request to `anon`, is_commissioner() goes false, and RLS denies the insert. The
   true answer was "sign in again". (2) The same stale session on a DELETE is worse — PostgREST
   returns 0 rows and NO error, so clearSchedule toasted "Regular season cleared" over a schedule
   that was still entirely there, and the next step would have been regenerating on top of it. */
const fs = require("fs"), vm = require("vm"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "src", "live", "part_live.js"), "utf8");

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

console.log("— there is exactly one definition of the check");
{
  const defs = (src.match(/your sign-in expired — sign out and back in/g) || []).length;
  A("one place decides what an expired session means", defs === 1, String(defs));
  A("CG.assertCommissioner is that place", /CG\.assertCommissioner = async function/.test(src));
  const calls = (src.match(/CG\.assertCommissioner\(\)/g) || []).length;
  A("...and every privileged path calls it", calls >= 4, `${calls} call sites`);
}

console.log("\n— no privileged games write can report a false success");
{
  /* A .delete() whose result is not selected back cannot distinguish "removed everything" from
     "RLS refused and removed nothing". Any games delete must select its rows back. */
  const bare = (src.match(/from\("games"\)\.delete\(\)(?![\s\S]{0,160}\.select\()/g) || []).length;
  A("every games delete selects its rows back", bare === 0, `${bare} bare delete(s)`);
  A("the schedule clear counts what actually went", /Nothing was cleared — the database refused the delete/.test(src));
  A("...and reports the number removed", /games removed/.test(src));
}

console.log("\n— the generator preflights, and explains RLS if it still bites");
{
  A("the session is checked before the first chunk",
    /CG\.assertCommissioner\(\)\.then\(function\(\)\{\s*\(function insertNext/.test(src));
  A("a mid-write RLS failure is translated, not passed through",
    /row-level security/i.test(src) && /your sign-in expired mid-write/.test(src));
  A("...and says how many games were already written",
    /Generation stopped after "\+\(idx\*100\)\+" games/.test(src));
  A("a refused preflight generates nothing", /Nothing was generated — /.test(src));
}

console.log("\n— it actually behaves that way when run");
{
  /* Drive the real CG.assertCommissioner against stubbed auth: no session, unrefreshable session,
     signed in but not a commissioner, and the happy path. */
  const ctx = { console, Promise, JSON, Object, Array, String, Number, Boolean, Error, Math, Date, RegExp,
                setTimeout, clearTimeout, Symbol, Intl };
  ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx;
  ctx.CG = {};
  vm.createContext(ctx);
  /* Only the helper is needed; evaluating the whole 400KB file needs a DOM. Take it verbatim. */
  const m = src.match(/CG\.assertCommissioner = async function[\s\S]*?\n\};/);
  A("the helper source was located for execution", !!m);
  vm.runInContext(m[0], ctx);

  const mk = (session, refreshed, isComm, rpcErr) => ({
    auth: {
      getSession: async () => ({ data: { session } }),
      refreshSession: async () => ({ data: { session: refreshed } }),
    },
    rpc: async () => (rpcErr ? { error: { message: rpcErr } } : { data: isComm }),
  });
  const err = async (sb) => { ctx.CG.sb = sb; try { await ctx.CG.assertCommissioner(); return null; }
                              catch (e) { return e.message; } };

  return (async () => {
    A("no session at all is refused", /sign-in expired/.test(await err(mk(null, null, true))));
    A("...and an unrefreshable session too", /sign-in expired/.test(await err(mk(null, null, false))));
    A("a live session that refreshes is accepted",
      (await err(mk(null, { t: 1 }, true))) === null);
    A("signed in but not commissioner is refused, in those words",
      /isn’t being recognized as commissioner/.test(await err(mk({ t: 1 }, { t: 1 }, false))));
    A("a live commissioner session passes", (await err(mk({ t: 1 }, null, true))) === null);
    A("an RPC error is surfaced verbatim, not swallowed",
      (await err(mk({ t: 1 }, null, true, "boom"))) === "boom");
    A("a disconnected client is refused", /not connected/.test(await err(null)));

    console.log(`\n${ok ? "PASS" : "FAIL"}`);
    process.exit(ok ? 0 : 1);
  })();
}
