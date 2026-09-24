/* v3.03 — nothing in a Tonight's-games card may sit outside the card.
 *
 * Reported on game night one: "The live assets are clipping outside of the boxes." The LIVE pill
 * hung 13 to 19px past the right edge of every card that had one, and the matchup wrapped
 * mid-phrase ("PIT" on one line, "@" on the next).
 *
 * The cause is a scale trap worth keeping written down: CG.crest(code, size) renders at
 * size * 2, because the artwork carries its own padding. The call site asks for 22 and gets a
 * 44px box. Two crests, two club codes and the pill need about 230px; the grid column is 232px
 * with 32px of padding, so ~200px of room. The row had neither flex-wrap nor a shrink, so it
 * overflowed and `margin-left:auto` carried the pill outside the card.
 *
 * Measured in a real browser at the live width and at 375px before and after: 3 overflowing
 * elements became 0, with no horizontal page scroll.
 */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
function A(name, cond, got) {
  n++;
  if (cond) console.log("ok   " + name);
  else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  — got: " + String(got).slice(0, 200))); }
}

const head = R("src/live/part1_head.html");
const pub = R("src/live/part5a_public.js");
const ui = R("src/live/part4_ui.js");

console.log("\n— the row can no longer push anything out of the card");
{
  const rule = (head.match(/\.railgame \.rg-line\{[^}]*\}/) || [""])[0];
  A("the matchup row wraps", /flex-wrap:wrap/.test(rule), rule.slice(0, 160));
  A("...with a row gap, so a wrapped pill is not glued to the line above", /row-gap:\s*\d/.test(rule));
  A("the crests are sized for this module", /\.railgame \.rg-line \.crest\{[^}]*width:30px/.test(head));
  A("...and cannot be squashed by a long club code", /\.railgame \.rg-line \.crest\{[^}]*flex:0 0 auto/.test(head));
  A("the pill keeps its own size", /\.railgame \.rg-line \.chip\{flex:0 0 auto\}/.test(head));
  A("the reason is recorded where the rule is", /renders at TWICE the size it is asked for/.test(head));
}

console.log("\n— the scale trap itself");
{
  /* if this ever stops doubling, the 30px override above becomes wrong rather than harmless,
     so the test states the contract instead of assuming it */
  A("CG.crest still doubles the size it is given", /var s = \(size\|\|28\)\*2;/.test(ui),
    (ui.split("\n").find((l) => /var s = \(size/.test(l)) || "").trim());
  A("...and says why, next to the code", /renders at twice the nominal size/.test(ui));
  A("the tonight card asks for 22, so it draws a 44px box before the override",
    /CG\.crest\(g\.away,22\)|CG\.crest\(g\.away, 22\)/.test(pub.replace(/\s/g, "").replace(/CG\.crest\(g\.away,22\)/, "CG.crest(g.away,22)")) || /crest\(g\.away,\s*22\)/.test(pub));
}

console.log("\n— the pill is still right-aligned when it fits beside the matchup");
{
  A("margin-left:auto is unchanged at the call site", /margin-left:auto"><span class="live-dot"><\/span>LIVE/.test(pub));
  A("the LIVE pill is only drawn when somebody is actually streaming",
    /streamers\.length\?' <span class="chip chip-live"/.test(pub));
}

console.log("\n" + (fail ? "FAIL " + fail + " of " + n : "PASS " + n));
process.exit(fail ? 1 : 0);
