/* The overall is provisional until five games — and now says so.
   Run: node tools/ovr-provisional.test.cjs

   The database blends it:  70 * (1 - gp/5) + computed * (gp/5), flagging provisional while gp < 5
   (public.overall_breakdown). Season 1 opens with every player at a literal 70 and zero games, so
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
  A("the threshold matches the database's five", ctx.CG.OVR_SETTLE_GP === 5);
  const at = (gp) => { ctx.CG.lg = { careerGp: { p: gp } }; return ctx.CG.ovrProgress("p"); };
  A("zero games: provisional, five to go", at(0).provisional && at(0).need === 5);
  A("three games: provisional, two to go", at(3).provisional && at(3).need === 2);
  A("five games: settled", at(5).provisional === false && at(5).need === 0);
  A("more than five stays settled", at(40).provisional === false);
  A("an unknown player is treated as zero, not as settled", (() => {
    ctx.CG.lg = { careerGp: {} }; return ctx.CG.ovrProgress("nobody").provisional === true;
  })());
  A("no league object never throws", (() => { ctx.CG.lg = null; return ctx.CG.ovrProgress("p").need === 5; })());

  ctx.CG.lg = { careerGp: { p: 2 } };
  A("the note counts up, not down — '2 of 5 games'", /2 of 5 games/.test(ctx.CG.ovrNote("p")));
  A("...and says the word provisional", /Provisional/.test(ctx.CG.ovrNote("p")));
  A("...the chip form is compact", /chip-warn/.test(ctx.CG.ovrNote("p", "chip")));
  A("...the title form explains WHY it is 70", /open at 70 and settle/.test(ctx.CG.ovrNote("p", "title")));
  ctx.CG.lg = { careerGp: { p: 9 } };
  A("a settled player gets no note at all", ctx.CG.ovrNote("p") === "" && ctx.CG.ovrNote("p", "chip") === "");
}

console.log("\n— it is shown where the number is shown");
{
  A("the profile hero carries the note", /CG\.ovrNote\(p\.id\)\+'<\/div><\/div>'/.test(pub));
  A("...and explains itself on hover", /title="'\+esc\(CG\.ovrNote\(p\.id,"title"\)\)\+'"/.test(pub));
  A("the member's own dashboard carries it", /CG\.ovrNote\?CG\.ovrNote\(me\.id\):""/.test(hub));
  A("table columns mark it rather than shouting", /provisional\?'<span style="opacity:\.75">\*<\/span>'/.test(pub));
  A("...with a legend so the asterisk means something", /still settling — fewer than '\+CG\.OVR_SETTLE_GP\+' games/.test(pub));
}

console.log("\n— the copy no longer claims it is a scouting number");
{
  A("the false 'scouting number from registration' line is gone", !/staff scouting number from registration/.test(pub));
  A("...and the other one too", !/The overall itself is the staff scouting number/.test(pub));
  A("the directory explains the real rule", /Overalls open at 70 and settle onto a player's real rating over his first five games/.test(pub));
  A("the profile says it is recomputed after every final", /recomputed after every final/.test(pub));
  A("the Control Center no longer claims nothing hand-edits a rating",
    !/the site never hand-edits a rating/.test(live) && /A commissioner CAN override a single rating/.test(live));
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
