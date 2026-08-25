/* Batch-5 correctness fixes from the pre-launch audit.
   Run: node tools/launch-correctness.test.cjs */
const fs = require("fs"), vm = require("vm"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const live = R("src/live/part_live.js"), pub = R("src/live/part5a_public.js");
const desk = R("src/live/part9_staffdesks.js"), ingest = R("netlify/functions/ingest-stats.js");
const content = R("src/live/part3_content.js");

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

console.log("— the draft board's eligibility matches the DB (no offer the server refuses)");
{
  const ctx = { console, Math, Object, Array, String, Number, JSON }; ctx.window = ctx; ctx.globalThis = ctx;
  ctx.CG = { PRESEASON_MIN_GP: 5 };
  vm.createContext(ctx);
  vm.runInContext(live.match(/CG\.isDraftEligible = function[\s\S]*?\n\};/)[0], ctx);
  vm.runInContext(live.match(/CG\.eligOf = function[\s\S]*?\n\};/)[0], ctx);
  ctx.CG.lg = { isVeteran: (id) => id === "vet", preGp: { some: { gp: 3 }, most: { gp: 6 } } };
  A("a returning player is eligible", ctx.CG.eligOf("vet").ok === true);
  A("a first-year with 5+ pre-season games is eligible", ctx.CG.eligOf("most").ok === true);
  A("a first-year short of five is NOT eligible (was always-true under v2.7)", ctx.CG.eligOf("some").ok === false);
  A("...and eligOf no longer hardcodes ok:true", !/return \{ vet:vet, gp:gp, ok: true \};/.test(live));
}

console.log("\n— the availability deadline is 8pm ET across the DST change");
{
  A("it builds the deadline through CG.etISO, not a hardcoded -04:00 offset",
    /deadline: Date\.parse\(CG\.etISO\(dlDay, "20:00"\)\)/.test(live) && !/deadline: Date\.parse\(dlDay\+"T20:00:00-04:00"\)/.test(live));
}

console.log("\n— the EA auto-import only attaches to an open fixture");
{
  A("the match query excludes voided, forfeit-ruled, and non-scheduled games",
    /status=eq\.scheduled&voided=not\.is\.true&forfeit_team_id=is\.null/.test(ingest));
}

console.log("\n— stale rules copy is corrected");
{
  A("the profile no longer claims 'no games-played requirement'", !/there is no games-played requirement/.test(pub));
  A("...and states the five-game rule instead", /a first-year needs five pre-season appearances to enter the draft \(Rule 2\.8\)/.test(pub));
  A("the road-ahead draft step cites Rule 2.8, not 'everyone who registered'",
    /returning players and first-years with five pre-season appearances \(Rule 2\.8\)/.test(live) &&
    !/every player who registered by the deadline is draft-eligible/.test(live));
  const rb = JSON.parse(content.match(/CG\.CONTENT = (\{[\s\S]*?\});\n/)[1]).rulebook;
  const sec06 = (() => { for (const c of rb.chapters) for (const s of c.sections) if (s.id === "0.6") return s; })();
  A("rulebook 0.6 no longer carries its duplicated free-agency paragraph", sec06.paragraphs.length === 1);
}

console.log("\n— the hub registration copy branches on WHEN you registered");
{
  A("it compares reg.created_at to the deadline, not now to the deadline",
    /reg\.created_at && Date\.parse\(reg\.created_at\) <= Date\.parse\(s\.registration_deadline\)/.test(live));
  A("...so an on-time registrant keeps the draft message after the deadline",
    /You registered in time/.test(live));
}

console.log("\n— the ops reschedule prefill shows the time in ET");
{
  A("the prefilled time is formatted in America/New_York, not the viewer's local hours",
    /timeZone:"America\/New_York", hour:"2-digit", minute:"2-digit", hour12:false \}\)\.format\(d\)/.test(desk) &&
    !/var hm = \(\("0"\+d\.getHours\(\)\)/.test(desk));
}

console.log("\n— the owner-application deadline is enforced, not just displayed");
{
  A("the route computes a deadline-closed state from the season", /var deadlineClosed = !!\(s\.owner_app_deadline && Date\.parse\(s\.owner_app_deadline\) <= CG\.now\(\)\);/.test(live));
  A("...shows a closed notice", /Owner applications closed on/.test(live));
  A("...disables the submit button when closed", /\(lockedFromOwning\|\|deadlineClosed\)\?" disabled"/.test(live));
  A("...and submitOwnerApp bails before writing after the deadline",
    /_s\.owner_app_deadline && Date\.parse\(_s\.owner_app_deadline\) <= CG\.now\(\)\)\{ CG\.toast\("Owner applications closed/.test(live));
  /* the REAL gate is the DB trigger guard_owner_app_deadline (BEFORE INSERT/UPDATE), verified by a
     rolled-back rehearsal: a member is refused after the deadline, allowed before, may still
     withdraw, and the commissioner decision path bypasses. The client checks above are courtesy. */
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
