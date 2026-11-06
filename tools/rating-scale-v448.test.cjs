/* v4.48 (2026-11-06): "Not match, but be similar to?", "Center on 85", and "favor more offense in the winger overalls,
   more defense in the defense overalls, a mixture of somewhere around 60:40 for centers of offense to defense".
   The overall scale moves to a median of 85 and each position's categories are reweighted. Pins the curve arithmetic, the
   weights, the one definition of the center, the trade reading staying where it was, the rule text and the changelog.
   The SQL ran as a rolled-back rehearsal on production before it was applied (results recorded in the SQL file).
   Run: node tools/rating-scale-v448.test.cjs */
const fs = require("fs"), path = require("path");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + got)); } };
const ROOT = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const sql = R("sql/2026-11-06-rating-scale-and-position-weights-v448.sql");
const body = sql.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
const pub = R("src/live/part5a_public.js"), live = R("src/live/part_live.js"), ui = R("src/live/part4_ui.js");
const DASHES = new RegExp("[" + String.fromCharCode(0x2014, 0x2013) + "]");

console.log("# the curve");
{
  const m = body.match(/75\.345 \+ 23\.655 \/ \(1 \+ exp\(-\(greatest\(-3\.5, least\(4, p_z\)\) - 0\.372\)\)\)/);
  A("the record holds the curve", !!m);
  const oldC = (z) => 50 + 49 / (1 + Math.exp(-(Math.max(-3.5, Math.min(4, z)) - 0.372)));
  const newC = (z) => 75.345 + 23.655 / (1 + Math.exp(-(Math.max(-3.5, Math.min(4, z)) - 0.372)));
  A("the league median is 85", Math.round(newC(0)) === 85, newC(0));
  A("99 stays out of reach", Math.round(newC(4)) === 98, newC(4));
  A("nobody reaches the floor", newC(-3.5) > 75.345);
  A("the top tenth begins at 92, as the bars' caption says", Math.round(newC(1.28)) === 92, newC(1.28));
  A("95 sits two standard deviations clear, as the Control Center says", Math.round(newC(1.93)) === 95 && /and 95 sits two standard deviations clear/.test(live), newC(1.93));
  let same = true;
  for (let z = -3.5; z <= 4; z += 0.25) if (Math.abs(newC(z) - (99 - (99 - oldC(z)) * 14 / 29)) > 0.01) same = false;
  A("the scale is the old one scaled toward 99 by 14/29, so it alone reorders nobody", same);
}

console.log("\n# the weights");
{
  const w = {};
  for (const m of body.matchAll(/\('([WCDG])','([A-Z]+)',(0\.\d+)\)/g)) (w[m[1]] = w[m[1]] || {})[m[2]] = +m[3];
  const sum = (g, cats) => Math.round(cats.reduce((s, c) => s + (w[g][c] || 0), 0) * 100);
  const OFF = ["SHOOTING", "PASSING", "HANDEYE"], DEF = ["DEFENSE", "PHYSICALITY"];
  A("wing is 75:25", sum("W", OFF) === 75 && sum("W", DEF) === 25);
  A("center is the commissioner's 60:40", sum("C", OFF) === 60 && sum("C", DEF) === 40);
  A("defense is 30:70", sum("D", OFF) === 30 && sum("D", DEF) === 70);
  A("goalies are untouched", w.G.CONSISTENCY === 0.46 && w.G.REFLEXES === 0.34 && w.G.CLUTCHNESS === 0.2);
  A("a wing's biggest category is Shooting, a defenseman's is Defense", Math.max(...Object.values(w.W)) === w.W.SHOOTING && Math.max(...Object.values(w.D)) === w.D.DEFENSE);
}

console.log("\n# one definition of the center");
A("the database holds it", /function public\.cghl_center\(\)[\s\S]*?select 85/.test(body));
A("...and members cannot call it", /revoke all on function public\.cghl_center\(\) from public, anon, authenticated/.test(body));
A("both functions that held a literal 70 are patched on an exact anchor, once each",
  (body.match(/<> 1 then raise exception/g) || []).length === 3 && /'overall', public\.cghl_center\(\),/.test(body) && /v_ov int := public\.cghl_center\(\);/.test(body));
A("the record re-rates everyone with a stored row, not only players with games", /select distinct profile_id as pid from public\.player_position_overalls/.test(body));
A("the record ends in self-checks", /do \$chk\$/.test(body));
A("the client holds it", /CG\.OVR_CENTER = 85;/.test(pub) && /CG\.OVR_FLOOR = 75;/.test(pub));
for (const [name, src] of [["part5a_public.js", pub], ["part_live.js", live]]) {
  A(name + " has no literal rating default left", !/overall ?\|\| ?70\b|ovr == null \? 70|toward 70 until|median is 70|50 to 99/.test(src.replace(/\/\*[\s\S]*?\*\//g, "")));
}
A("the top badge moved with the scale: old 88 is new 94", /CG\.ovrClass = function\(v\)\{ return v>=94\?"":"mid"; \};/.test(ui));

console.log("\n# the trade reading stays where it was");
{
  const m = live.match(/var ovr = Math\.round\(Math\.max\(0, 39 - \(99 - \(p\.overall\|\|CG\.OVR_CENTER\)\) \* 29 \/ 14\) \* 10\), prod = 0;/);
  A("the value reads the overall back onto the old scale", !!m);
  const val = (nu) => Math.round(Math.max(0, 39 - (99 - nu) * 29 / 14) * 10);
  A("a typical player is worth what they were: 100, not 250", val(85) === 100, val(85));
  A("the value hits zero where it did: old 60 is new 80", val(80) === 0 && val(81) > 0);
  A("the card's printed formula says so", /Value per player: about 21 for every overall point above 80/.test(live) && !/above 60, plus this season/.test(live));
}

console.log("\n# the rulebook and the changelog");
{
  const CG = {}; new Function("CG", R("src/live/part3_content.js"))(CG);
  const rb = CG.CONTENT.rulebook;
  const r61 = rb.chapters.flatMap((c) => c.sections).find((s) => s.id === "6.1");
  const t = r61.paragraphs.join(" ");
  A("Rule 6.1 states the new scale", /a scale from 75 to 99 on which the league median is 85/.test(t));
  A("...and no longer the old one", !/from 50 to 99|median is 70/.test(t));
  A("...and the weights by position", /seventy-five percent \(75%\) to twenty-five percent \(25%\) at wing, sixty percent \(60%\) to forty percent \(40%\) at center, and thirty percent \(30%\) to seventy percent \(70%\) on defense/.test(t));
  A("...and the six-game hold survives", /held toward the middle until a player's sixth league game at that position/.test(t));
  const e = rb.changelog.find((c) => c.version === "4.48") || {};
  A("the changelog has its 4.48 entry", typeof e.summary === "string" && Array.isArray(e.items) && e.items.length > 0);
  A("...with no dashes and no gendered pronouns", !DASHES.test(JSON.stringify(e)) && !/\b(he|his|him|she|her)\b/i.test(JSON.stringify(e)));
}

console.log(fail ? `\n${fail} of ${n} FAILED` : `\nall ${n} passed`);
process.exit(fail ? 1 : 0);
