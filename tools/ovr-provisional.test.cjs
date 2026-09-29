/* The overall is provisional until six games at a position (five from v3.49 to v3.73), and says so.
   Run: node tools/ovr-provisional.test.cjs

   v3.49: the database holds a rating toward 70 by shrinking its standard score while the sample is
   thin (public.cghl_confidence), and flags provisional while gp < 5 (public.cghl_settle_gp). Season 1
   opened with every player at a literal 70 and zero games, so
   without a heads-up the badge reads as a scouting verdict on someone who has never taken a shift
   — and the surrounding copy actually claimed it WAS one ("the staff scouting number from
   registration"), which was never true: registration collects an EA ID, a position and a note. */
const fs = require("fs"), vm = require("vm"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const pub = R("src/live/part5a_public.js"), hub = R("src/live/part6_hub.js"), live = R("src/live/part_live.js");

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

console.log("— the progress helper, driven");
{
  const ctx = { console, Math, Object, String, Number, JSON };
  ctx.window = ctx; ctx.globalThis = ctx; ctx.CG = {};
  ctx.esc = (v) => String(v == null ? "" : v);
  vm.createContext(ctx);
  vm.runInContext(pub.match(/CG\.OVR_SETTLE_GP = \d+;/)[0], ctx);
  for (const fn of ["ovrProgress", "ovrNote"]) {
    const m = pub.match(new RegExp("CG\\." + fn + " = function[\\s\\S]*?\\n *\\};"));
    if (!m) { A("located CG." + fn, false); process.exit(1); }
    vm.runInContext(m[0], ctx);
  }
  /* v3.74: six, at a position (cghl_settle_gp in sql/2026-09-29-position-ratings-v374.sql) */
  A("the threshold matches the database's six (cghl_settle_gp, v3.74)", ctx.CG.OVR_SETTLE_GP === 6 && /cghl_settle_gp\(\) returns integer language sql immutable as \$fn\$ select 6 \$fn\$;/.test(R("sql/2026-09-29-position-ratings-v374.sql")));
  const at = (gp) => { ctx.CG.lg = { careerGp: { p: gp } }; return ctx.CG.ovrProgress("p"); };
  A("zero games: provisional, six to go", at(0).provisional && at(0).need === 6);
  A("two games: provisional, four to go", at(2).provisional && at(2).need === 4);
  A("five games: still provisional", at(5).provisional && at(5).need === 1);
  A("six games: settled", at(6).provisional === false && at(6).need === 0);
  A("more than six stays settled", at(40).provisional === false);
  /* v3.74: with the per-position load, the games counted are the ones AT the position asked about */
  const atPos = (grp) => { ctx.CG.lg = { careerGp: { p: 40 }, posOvr: { p: { head: "W", W: { ovr: 72, gp: 2 }, C: { ovr: 75, gp: 7 } } } }; return ctx.CG.ovrProgress("p", grp); };
  A("per position: the headline counts its own games, not the career", atPos().gp === 2 && atPos().provisional && atPos().grp === "W");
  A("...another position counts its own", atPos("C").gp === 7 && atPos("C").provisional === false);
  A("...a position never played is provisional at zero", atPos("D").gp === 0 && atPos("D").need === 6);
  A("an unknown player is treated as zero, not as settled", (() => {
    ctx.CG.lg = { careerGp: {} }; return ctx.CG.ovrProgress("nobody").provisional === true;
  })());
  A("no league object never throws", (() => { ctx.CG.lg = null; return ctx.CG.ovrProgress("p").need === 6; })());

  ctx.CG.lg = { careerGp: { p: 2 } };
  A("the note counts up, not down: '2 of 6 games'", /2 of 6 games/.test(ctx.CG.ovrNote("p")));
  A("...and says the word provisional", /Provisional/.test(ctx.CG.ovrNote("p")));
  A("...the chip form is compact", /chip-warn/.test(ctx.CG.ovrNote("p", "chip")));
  A("...the title form explains WHY it is near 70", /held toward 70 until the sixth game at a position/.test(ctx.CG.ovrNote("p", "title")));
  vm.runInContext(pub.match(/CG\.POS_VIEW_NAME = [^\n]+/)[0], ctx);
  ctx.CG.lg = { posOvr: { p: { head: "W", W: { ovr: 72, gp: 2 } } } };
  A("...and names the position when it knows it", /2 of 6 games at wing/.test(ctx.CG.ovrNote("p")));
  A("...without a dash as punctuation", !/—/.test(ctx.CG.ovrNote("p", "title")) && !/ - /.test(ctx.CG.ovrNote("p", "title")));
  ctx.CG.lg = { careerGp: { p: 9 } };
  A("a settled player gets no note at all", ctx.CG.ovrNote("p") === "" && ctx.CG.ovrNote("p", "chip") === "");
}

console.log("\n— it is shown where the number is shown");
{
  /* v3.74: the hero's badge, caption and note come from one helper so the Position picker can swap them */
  A("the profile hero carries the note", /CG\.heroOvrInner\(p\.id, null, r\.ovr\)\+'<\/div><\/div>'/.test(pub) && /CG\.ovrNote\(pid, null, k \|\| null\);/.test(pub));
  A("...and explains itself on hover", /title="'\+esc\(CG\.ovrNote\(p\.id,"title"\)\)\+'"/.test(pub));
  A("the member's own dashboard carries it", /CG\.ovrNote\?CG\.ovrNote\(me\.id\):""/.test(hub));
  A("table columns mark it rather than shouting", /provisional\?'<span style="opacity:\.75">\*<\/span>'/.test(pub));
  A("...with a legend so the asterisk means something", /still settling: fewer than '\+CG\.OVR_SETTLE_GP\+' games at his position/.test(pub));
}

console.log("\n— the copy no longer claims it is a scouting number");
{
  A("the false 'scouting number from registration' line is gone", !/staff scouting number from registration/.test(pub));
  A("...and the other one too", !/The overall itself is the staff scouting number/.test(pub));
  A("the directory explains the real rule", /measures a player against the league at the position he signed up at, from CGHL box scores alone, and stays pulled toward 70 until his sixth game there/.test(pub));
  A("...and nothing still says three games", !/settle[s]? onto (a player's|the) real rating (over|across) (his first )?three games/.test(pub) && !/first three games/.test(live));
  A("the profile says it is recomputed after every final", /recomputed after every final/.test(pub));
  /* v3.67 (Q59): "commissioners should not be able to edit player or team overalls", so the note now says
     nobody hand-edits one, the commissioner included */
  A("the Control Center says nobody hand-edits a rating, the commissioner included (v3.67)",
    !/the site never hand-edits a rating/.test(live) && !/A commissioner CAN override a single rating/.test(live) && /Nobody hand-edits a rating, the commissioner included/.test(live));
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
