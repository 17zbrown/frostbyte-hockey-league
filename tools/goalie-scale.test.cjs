/* v3.48 — the goaltending scale measures the range goalies actually post. */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
function A(name, cond, got) {
  n++;
  if (cond) console.log("ok   " + name);
  else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  — got: " + String(got).slice(0, 220))); }
}
const rec = R("sql/2026-09-26-goalie-scale-priced-nothing.sql");
const flat = rec.replace(/\n--\s?/g, " ").replace(/\s+/g, " ");

console.log("\n— the scales, checked as arithmetic");
{
  const m = rec.match(/\(savepct - 0\.700\)\/\(0\.950 - 0\.700\)/);
  A("the record states the new save percentage scale", !!m);
  const sv = (p) => Math.max(0, Math.min(100, (p - 0.700) / (0.950 - 0.700) * 100));
  const old = (p) => Math.max(0, Math.min(100, (p - 0.500) / (0.950 - 0.500) * 100));

  A("elite is still 100", Math.round(sv(0.952)) === 100, sv(0.952).toFixed(1));
  A("a .885 falls from the high eighties to the seventies",
    Math.round(old(0.885)) === 86 && Math.round(sv(0.885)) === 74, old(0.885).toFixed(0) + " -> " + sv(0.885).toFixed(0));
  A("...and an average .845 is no longer a good score",
    Math.round(old(0.845)) === 77 && Math.round(sv(0.845)) === 58);
  A("a genuinely bad .688 now scores zero", sv(0.688) === 0, sv(0.688));
  A("the scale still rises with save percentage",
    (function(){ for (let p = 0.70; p < 0.95; p += 0.005) if (sv(p) >= sv(p + 0.005)) return false; return true; })());
  A("...and it spreads the real league further than the old one did",
    (sv(0.952) - sv(0.795)) > (old(0.952) - old(0.795)),
    (sv(0.952) - sv(0.795)).toFixed(0) + " points vs " + (old(0.952) - old(0.795)).toFixed(0));

  const gaa = (g) => Math.max(0, Math.min(100, (6 - g) / (6 - 1.2) * 100));
  A("the GAA scale zeroes at a bad night, not an impossible one", gaa(6) === 0 && gaa(8) === 0);
  A("...and a 1.20 is still perfect", Math.round(gaa(1.2)) === 100);
  A("...with a 2.00 no longer near-perfect", Math.round(gaa(2.0)) === 83, gaa(2.0).toFixed(0));
}

console.log("\n— the record explains the diagnosis, not just the change");
{
  A("it quotes the instruction", /a goalie with a \.885 save percentage should not beat out a forward with 19 points in 4 games/.test(flat));
  A("it names the cause as the scale", /the cause was the SCALE, not the weight/.test(flat));
  A("...and why .500 was meaningless", /It has never happened and it never will/.test(flat));
  A("the real league range is recorded", /best\s+\.952\s+worst \.561/.test(flat));
  A("...and the consequence stated", /the same as not measuring it at all/.test(flat));
  A("the GAA floor is justified too", /8\.00 is a blowout nobody survives/.test(flat));
  A("the before/after table is there", /\.885\s+85 ->\s+74/.test(flat) && /\.688\s+42 ->\s+0/.test(flat));
}

console.log("\n— the comparison he actually made");
{
  A("both players are named with their lines", /Saqoy\s+C, 19 points in 4 games/.test(flat) && /\.885 and a 2\.00 GAA over 3 games/.test(flat));
  A("...and the outcome", /88 -> 84/.test(flat) && /The forward now outranks the goaltender/.test(flat));
  A("no skater moved", /no skater rating moved by a point/.test(flat) && /every skater anchor was left exactly as it was/.test(flat));
  A("the elite goalie is untouched", /best goaltender in the league is untouched at 93/.test(flat));
  A("v3.47's result still holds", /Still one rating of 90 or better in the league and none at 95 or better/.test(flat));
}

console.log("\n— what it deliberately does not fix");
{
  A("the leading scorer's position is stated", /Scorezov has 33 points in 6 games/.test(flat) && /he is an 82/.test(flat));
  A("...with the reason", /pulled down by hits \(20\), blocked shots \(0\)/.test(flat));
  A("...named as a design, not a bug", /That is a deliberate design and it may well be the right one/.test(flat));
  A("...and left to the commissioner", /Changing it is a separate decision and was not made here/.test(flat));
  A("the v3.47 refresh trap is carried forward", /counted rows that actually moved/.test(flat) && /reverts an overall write in silence/.test(flat));
  /* The standing no-dashes rule is about PROSE. A minus sign inside a formula is arithmetic, so
     lines carrying one are excluded rather than the check being dropped. */
  const prose = rec.split("\n").filter((l) => !/[()\/]\s*(savepct|gaa|\d)/.test(l) && !/->/.test(l)).join("\n");
  A("no em dash or spaced hyphen in the prose", !/—/.test(prose) && !/ - /.test(prose),
    (prose.match(/.{0,45}(—| - ).{0,45}/) || [])[0]);
  A("...and the formulas are still quoted exactly", /\(savepct - 0\.700\)\/\(0\.950 - 0\.700\)/.test(rec));
}

console.log("\n— the changelog");
{
  const rb = JSON.parse((function(){ const c = R("src/live/part3_content.js"); return c.slice(c.indexOf("{"), c.lastIndexOf("}") + 1); })()).rulebook;
  A("v3.48 is recorded", rb.changelog.some((e) => e.version === "3.48"));
  A("...and v3.47 still is", rb.changelog.some((e) => e.version === "3.47"));
}

console.log(`\n${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
