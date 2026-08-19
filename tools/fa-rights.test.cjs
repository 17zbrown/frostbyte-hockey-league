/* Rule 2.2 — the two classes of free-agent rights, on the NHL's model.
   Run: node tools/fa-rights.test.cjs

   Service earns freedom: never completed a season for a club and you are UNRESTRICTED; serve one
   and your old club holds your rights when the contract ends, until you accrue four off-seasons.
   Because the league has no history in Season 1, every player starts unrestricted — verified
   against production at build time: 0 of 178 profiles had prior service, so 0 restricted.

   The accrual rule is written TWICE by necessity — once client-side for labels, once in the sweep
   for Discord roles — so both are pinned here against the same boundary cases. If they ever
   disagree, a player's role and his profile will say different things about who owns his rights. */
const fs = require("fs"), vm = require("vm"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const live = R("src/live/part_live.js");
const roles = R("shared/roles.mjs");
const sync = R("netlify/functions/discord-sync.js");
const content = R("src/live/part3_content.js");

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

console.log("— the rulebook defines the classes, because this is a rule before it is a role");
{
  const rb = JSON.parse(content.match(/CG\.CONTENT = (\{[\s\S]*?\});\n/)[1]).rulebook;
  const sec = (id) => { for (const c of rb.chapters) for (const s of c.sections) if (s.id === id) return s.paragraphs.join(" "); throw new Error("no " + id); };
  const r22 = sec("2.2");
  A("Rule 2.2 names the unrestricted class", /never completed a season on a club's roster is an UNRESTRICTED free agent/.test(r22));
  A("...and the restricted one", /RESTRICTED free agent until he has accrued four \(4\) off-seasons of service/.test(r22));
  A("...with the former club's matching right spelled out", /may match any offer made to him/.test(r22));
  A("...and says why Season 1 has none", /every registered player begins unrestricted/.test(r22));
  A("...and that the count is a setting, published before signings", /is a league-office setting/.test(r22));
  A("the changelog records v2.25", rb.changelog.some((c) => c.version === "2.25" && /restricted free agent/i.test(c.summary)));
}

console.log("\n— the accrual boundary, driven");
{
  const ctx = { console, Math, Object, Array, String, Number, JSON, parseInt };
  ctx.window = ctx; ctx.globalThis = ctx;
  ctx.CG = { _siteCfg: {}, TEAMS: [], contractHeldIds: () => ({}), isDraftEligible: () => true };
  vm.createContext(ctx);
  /* the default is a plain assignment, not a function — rfaOffseasons falls back to it, so without
     loading it the fallback cases measure an `undefined` and pass for the wrong reason (the same
     trap playoff-shape.test.cjs documents for PLAYOFF_PER_DIV_DEFAULT) */
  {
    const d = live.match(/CG\.RFA_OFFSEASONS_DEFAULT = \d+;/);
    if (!d) { A("located CG.RFA_OFFSEASONS_DEFAULT", false); process.exit(1); }
    vm.runInContext(d[0], ctx);
  }
  for (const fn of ["rfaOffseasons", "poolState"]) {
    const m = live.match(new RegExp("CG\\." + fn + " = function[\\s\\S]*?\\n *\\};"));
    if (!m) { A("located CG." + fn, false); process.exit(1); }
    vm.runInContext(m[0], ctx);
  }
  A("the default is four off-seasons", ctx.CG.rfaOffseasons() === 4);
  ctx.CG._siteCfg.rfa_offseasons = "6"; A("a setting moves the line", ctx.CG.rfaOffseasons() === 6);
  ctx.CG._siteCfg.rfa_offseasons = "0"; A("nonsense falls back", ctx.CG.rfaOffseasons() === 4);
  ctx.CG._siteCfg.rfa_offseasons = "99"; A("out of range falls back", ctx.CG.rfaOffseasons() === 4);
  ctx.CG._siteCfg = {};

  /* an unrostered, registered, uncontracted player at each service level */
  const state = (served, returning) => {
    ctx.CG.lg = {
      _rosteredIds: {}, _registrationsRaw: [{ profile_id: "p", status: "pending" }],
      draftState: { status: "complete" },
      serviceSeasons: () => served, isReturning: () => returning,
    };
    return ctx.CG.poolState("p").key;
  };
  A("never served -> unrestricted (an undrafted first-year)", state(0, false) === "undrafted_fa");
  A("never served but returning -> unrestricted free agent", state(0, true) === "free_agent");
  A("one season served -> RESTRICTED", state(1, true) === "rfa");
  A("three seasons served -> still restricted", state(3, true) === "rfa");
  A("the fourth off-season sets him free", state(4, true) === "free_agent");
  A("...and so does anything beyond it", state(9, true) === "free_agent");
  A("a rostered player is not a free agent of any kind", (() => {
    ctx.CG.lg = { _rosteredIds: { p: 1 }, _registrationsRaw: [{ profile_id: "p" }], serviceSeasons: () => 2, isReturning: () => true };
    return ctx.CG.poolState("p").key === "rostered";
  })());
  A("nor is one still under contract", (() => {
    ctx.CG.contractHeldIds = () => ({ p: 1 });
    ctx.CG.lg = { _rosteredIds: {}, _registrationsRaw: [{ profile_id: "p", status: "pending" }], serviceSeasons: () => 2, isReturning: () => true };
    const k = ctx.CG.poolState("p").key; ctx.CG.contractHeldIds = () => ({}); return k === "under_contract";
  })());
}

console.log("\n— the Discord side grants from the same rule");
{
  A("Rookie and Restricted Free Agent are managed roles, so losing the status removes the role",
    /"Restricted Free Agent", "Rookie"/.test(roles));
  A("the sweep creates them", /\["Restricted Free Agent", true\], \["Rookie", true\]/.test(sync));
  A("...and reconciles their properties", /\["Restricted Free Agent", true, false\], \["Rookie", true, false\]/.test(roles) ||
    /\["Restricted Free Agent", true, false\], \["Rookie", true, false\]/.test(sync));
  A("a restricted player gets RFA instead of Free Agent, never both",
    /rfa\.has\(m\.profile_id\) && roleId\["restricted free agent"\]\) desired\.add\(roleId\["restricted free agent"\]\);\s*\n\s*else if \(isRegistered && roleId\["free agent"\]\)/.test(roles));
  A("Rookie rides alongside, since it is service length and not a rights class",
    /rookies\.has\(m\.profile_id\) && roleId\["rookie"\]/.test(roles));
  A("the sweep computes service from DISTINCT PRIOR seasons, excluding the current one",
    /if \(!r\.profile_id \|\| !r\.season_id \|\| r\.season_id === curId\) continue;/.test(sync));
  A("...counts a player restricted only below the threshold",
    /if \(priorSeasons\[pid\]\.size < RFA_YEARS\) rfa\.add\(pid\);/.test(sync));
  A("...and never calls a rostered or contracted player a free agent",
    /if \(onRosterNow\.has\(pid\) \|\| underContract\.has\(pid\)\) continue;/.test(sync));
  A("the threshold is the same setting the site reads", /rfa_offseasons/.test(sync) && /rfa_offseasons/.test(live));
  A("a rookie is someone with no prior season AND no earlier draft",
    /if \(!priorSeasons\[p\.id\] && !draftedBefore\.has\(p\.id\)\) rookies\.add\(p\.id\);/.test(sync));
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
