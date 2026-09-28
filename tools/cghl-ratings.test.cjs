/* v3.49: overall ratings on CGHL league play alone.
 *
 * The engine is in Postgres. This pins the record, re-implements the published formulas to check
 * their own arithmetic, and checks the SHIPPED client (index.html), the book and the changelog.
 */
const fs = require("fs"), path = require("path"), vm = require("vm");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
function A(name, cond, got) {
  n++;
  if (cond) console.log("ok   " + name);
  else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + String(got).slice(0, 220))); }
}
const rec = R("sql/2026-09-26-cghl-ratings-engine.sql");
const flat = rec.replace(/\n--\s?/g, " ").replace(/\s+/g, " ");
const html = fs.existsSync(path.join(__dirname, "..", "index.html")) ? R("index.html") : R("src/live/part5a_public.js") + R("src/live/part_live.js");
const pub = R("src/live/part5a_public.js"), live = R("src/live/part_live.js");

console.log("\n— the curve, from the formula as published in the record");
{
  const m = rec.match(/rating = 50 \+ 49 \/ \(1 \+ exp\(-\(z - ([\d.]+)\)\)\),\s+z clamped to \[(-?[\d.]+), (\d+)\]/);
  A("the record states the curve and its clamp", !!m, (rec.match(/THE CURVE.*/) || [])[0]);
  const off = m ? +m[1] : 0, lo = m ? +m[2] : 0, hi = m ? +m[3] : 0;
  const curve = (z) => Math.min(99, Math.max(50, 50 + 49 / (1 + Math.exp(-(Math.max(lo, Math.min(hi, z)) - off)))));
  A("the league median is 70", Math.round(curve(0)) === 70, curve(0).toFixed(2));
  A("the 90th percentile is 85", Math.round(curve(1.2816)) === 85, curve(1.2816).toFixed(2));
  A("90 takes about two standard deviations", Math.round(curve(1.93)) === 90, curve(1.93).toFixed(2));
  A("95 takes nearly three", Math.round(curve(2.9)) === 95, curve(2.9).toFixed(2));
  A("the clamp holds the top at 97.7, so 99 is never reached", curve(10) > 97.5 && curve(10) < 98, curve(10).toFixed(2));
  A("the floor is 50", curve(-10) >= 50 && curve(-10) < 52, curve(-10).toFixed(2));
  A("monotonic: better play never lowers a rating",
    (function () { for (let z = -4; z < 5; z += 0.1) if (curve(z) > curve(z + 0.1)) return false; return true; })());
}

console.log("\n— the confidence rule, as the commissioner set it");
{
  const settle = +(rec.match(/select (\d) \$fn\$;/) || [])[1];
  A("the settle count is five", settle === 5, settle);
  const conf = (gp) => gp <= 0 ? 0 : gp < settle ? 0.12 * gp : gp / (gp + 1.5);
  A("four games or fewer stay under half confidence", [1, 2, 3, 4].every((g) => conf(g) < 0.5), [1, 2, 3, 4].map(conf).join(","));
  A("...rising one step per game", conf(1) < conf(2) && conf(2) < conf(3) && conf(3) < conf(4));
  A("the fifth game is a real step", conf(5) - conf(4) > 0.25, (conf(5) - conf(4)).toFixed(2));
  A("...and it keeps rising after it", conf(6) > conf(5) && conf(18) > conf(10) && conf(18) < 1);
  A("the record says it shrinks the standard score, so a poor start is held up too",
    /pulls a big number down and a poor one up alike/.test(flat));
  A("the record quotes the instruction", /remember to still not give a full rating until 5\+ games played/.test(flat));
}

console.log("\n— coverage is a rescue, not a reweighting");
{
  const cover = (c) => Math.min(1, Math.max(0, c) / 0.15);
  A("a stat 3% of the position records is discounted to a fifth", Math.abs(cover(0.03) - 0.2) < 1e-9);
  A("a stat 19% record (a defenseman's goals) counts in full", cover(0.19) === 1);
  A("the record names the case", /Fewer than 3 percent of defensemen ever record a deflection/.test(flat));
  A("...and the one deliberately left at full weight", /a defenseman's goals \(19 percent\) keep full weight/.test(flat));
}

console.log("\n— the four defects are recorded with their numbers");
{
  A("a. the point-mass spread", /median absolute deviation of exactly zero/.test(flat) && /cghl_spread/.test(flat));
  A("b. the self-limiting p99", /self-limiting/.test(flat) && /scored z = 2\.30/.test(flat));
  A("c. the deflection defenseman", /Kaz Kanada, 0 goals and 2 assists in 3 games, rated 89/.test(flat) && /Kaz Kanada is 69/.test(flat));
  A("d. the flat average", /inside 63 to 80/.test(flat));
  A("the before and after table", /at 85 or better\s+10 -> 1/.test(flat) && /at 90 or better\s+1 -> 0/.test(flat));
  A("...with the leading scorer's line", /Scorezov, 22 G 33 P in 6: 82 -> 79, Shooting 89, Passing 68/.test(flat));
  A("...and v3.48's complaint resolved", /Saqoy, 19 P in 4: 87 -> 79\./.test(flat) && /\.885 in 3: 84 -> 75/.test(flat));
  A("what is theirs and what is ours is stated plainly", /theirs: the variables, the category structure/.test(flat) && /ours:\s+standardizing every stat/.test(flat));
  A("why their weights could not be reused", /multiply RAW values on incompatible units/.test(flat));
  A("the silent-revert trap is carried forward", /COUNT WHAT CHANGED, NEVER WHAT YOU ATTEMPTED/.test(flat) && /guard_profile_role/.test(flat));
  A("the trigger cost is measured", /1\.33 s per final/.test(flat));
}

console.log("\n— the shipped client");
{
  A("the settle constant is five", /CG\.OVR_SETTLE_GP = 5;/.test(html));
  A("the breakdown card fetches the engine's own categories", /rpc\("player_rating", \{ p_profile: pid \}\)/.test(html));
  A("...into a container the page can repaint in place", /id="ratingBreakBody"/.test(html) && /CG\.ratingBars = function/.test(html));
  A("...drawn from 50 to 99, not 0 to 100", /\(c\.score - 50\) \/ 49 \* 100/.test(html));
  A("nothing still says three games",
    !/settle[s]? onto (a player's|the) real rating (over|across) (his first )?three games/.test(html) &&
    !/first three games/.test(pub) && !/first three games/.test(live));
  A("the directory says what the number is", /measures a player against the league at his position from CGHL box scores alone/.test(html));
  A("the hover note explains the hold", /held toward 70 until the fifth game/.test(html));
  A("the Control Center names the engine", /the cghl_\* functions, v3\.49/.test(html));
  A("the ratingBars helper runs", (() => {
    const ctx = { console, Math, Object, String, Number, JSON, CG: {} }; ctx.esc = (v) => String(v == null ? "" : v);
    vm.createContext(ctx);
    vm.runInContext(pub.match(/CG\.OVR_SETTLE_GP = \d+;/)[0], ctx);
    for (const fn of ["ovrProgress", "ratingBars"]) vm.runInContext(pub.match(new RegExp("CG\\." + fn + " = function[\\s\\S]*?\\n\\};"))[0], ctx);
    ctx.CG.lg = { careerGp: { p: 6 } };
    const out = ctx.CG.ratingBars({ components: [{ label: "Shooting", score: 89 }, { label: "Passing", score: 68 }] }, "p");
    const empty = ctx.CG.ratingBars(null, "p");
    return /Shooting/.test(out) && /width:80%/.test(out) && /width:37%/.test(out) && !/Held toward/.test(out) && /appear here/.test(empty);
  })());
  A("...and marks a thin sample", (() => {
    const ctx = { console, Math, Object, String, Number, JSON, CG: {} }; ctx.esc = (v) => String(v == null ? "" : v);
    vm.createContext(ctx);
    vm.runInContext(pub.match(/CG\.OVR_SETTLE_GP = \d+;/)[0], ctx);
    for (const fn of ["ovrProgress", "ratingBars"]) vm.runInContext(pub.match(new RegExp("CG\\." + fn + " = function[\\s\\S]*?\\n\\};"))[0], ctx);
    ctx.CG.lg = { careerGp: { p: 3 } };
    return /Held toward 70 until the fifth game \(3 of 5 played\)/.test(ctx.CG.ratingBars({ components: [{ label: "Defense", score: 72 }] }, "p"));
  })());
}

console.log("\n— the book");
{
  const rb = JSON.parse((function(){ const c = R("src/live/part3_content.js"); return c.slice(c.indexOf("{"), c.lastIndexOf("}") + 1); })()).rulebook;
  const s61 = rb.chapters.flatMap((c) => c.sections).find((s) => s.id === "6.1");
  const all = rb.chapters.flatMap((c) => c.sections.flatMap((s) => s.paragraphs)).join("\n");
  A("Rule 6.1 says what a rating is built from", s61 && s61.paragraphs.some((p) => /from the league's own regular-season and playoff box scores alone/.test(p)));
  A("...names the categories", /Shooting, Passing, Hand-eye, Physicality and Defense for skaters; Reflexes, Consistency and Clutchness for goaltenders/.test(all));
  A("...the scale and the hold", /scale from 50 to 99 on which the league median is 70/.test(all) && /held toward the middle until a player's fifth league game/.test(all));
  A("...and never states the formula", !/0\.12/.test(all) && !/1\.5\)/.test(all) && !/0\.372/.test(all));
  A("Rule 0.4 still says ratings come from regular-season play", /Overall ratings are compiled from regular-season play/.test(all));
  const e349 = rb.changelog.find((e) => e.version === "3.49") || { items: [] };
  A("the changelog records v3.49", !!rb.changelog.find((e) => e.version === "3.49"));
  A("...and says whose is whose", e349.items.some((i) => /The variables and the category structure are chelstats\.app's/.test(i)));
  A("...with the numbers matching the record", e349.items.some((i) => /league average 70\.6, range 58 to 85, three at 80 or better, one at 85 or better, none yet at 90/.test(i)));
  const mine = JSON.stringify(e349) + s61.paragraphs[1];
  A("no em dash or spaced hyphen in the new prose", !/—/.test(mine) && !/ - /.test(mine));
}

console.log("\n— the record's prose carries no dash as punctuation");
{
  /* minus signs inside formulas and the -> arrows of the before/after table are arithmetic, not prose */
  const prose = rec.split("\n").filter((l) => l.startsWith("--") && !/->/.test(l) && !/\(z - |exp\(-|p_med\) - |- n\.center|- 0\.372/.test(l)).join("\n");
  A("clean", !/—/.test(prose) && !/ - /.test(prose), (prose.match(/.{0,50}(—| - ).{0,50}/) || [])[0]);
}

console.log(`\n${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
