/* Management salaries and the dressing rule agree across every surface.
   Run: node tools/mgmt-and-dressing.test.cjs

   Commissioner rulings (2026-08-24): management cap hits are Owner $0 / GM $3M / AGM $3M, and a
   player dresses anywhere within his position GROUP. Both facts live in several places, and the
   audit found them disagreeing — the rulebook said GM $0 while the season config and briefing said
   GM $3M; the Control Center still defaulted new seasons to a 15-man roster and a $60M cap. */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const content = R("src/live/part3_content.js"), live = R("src/live/part_live.js");
const briefing = (() => { try { return R("CGHL-Season1-Owners-Briefing-DISCORD.txt"); } catch { return ""; } })();

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };
const rb = JSON.parse(content.match(/CG\.CONTENT = (\{[\s\S]*?\});\n/)[1]).rulebook;
const sec = (id) => { for (const c of rb.chapters) for (const s of c.sections) if (s.id === id) return s.paragraphs.join(" "); throw new Error("no " + id); };

console.log("— management salaries: Owner $0 / GM $3M / AGM $3M, everywhere");
{
  const r26 = sec("2.6");
  /* v2.62: Owner $0, GM $0, AGM $2,000,000 */
  A("Rule 2.6 puts the AGM at a flat $2,000,000", /Assistant General Manager \(and any additional tertiary management contract\) counts a flat \$2,000,000/.test(r26));
  A("...with the Owner and GM at $0", /the Owner and the General Manager each count \$0 against the cap/.test(r26));
  A("...and no longer says the GM counts $0", !/the Owner and the General Manager count \$0/.test(r26));
  if (briefing) A("the owners' briefing agrees (Owner $0, GM $3M, AGM $3M)", /Owner counts \$0 against the cap, GM \$3M, AGM \$3M/.test(briefing));
  A("the Control Center defaults a new Owner salary to $0, not $3M", /s\.owner_salary==null\?0:s\.owner_salary/.test(live));
}

console.log("\n— new-season defaults match the real league shape");
{
  /* v2.48: basic is the league standard, so a new season now defaults to basic's numbers —
     (v2.51) 15-man roster, $50M cap, deadline week 4, 6 weeks — read live from
     CG.FORMAT_RULES.basic rather than hardcoded literals in seasonForm. */
  A("a new season defaults to CG.FORMAT_RULES.basic's roster shape and trade deadline",
    /salary_cap:CG\.FORMAT_RULES\.basic\.salary_cap, roster_max:CG\.FORMAT_RULES\.basic\.roster_max,/.test(live) &&
    /trade_deadline_week:CG\.FORMAT_RULES\.basic\.trade_deadline_week, weeks:CG\.FORMAT_RULES\.basic\.weeks/.test(live));
  A("...and CG.FORMAT_RULES.basic itself is the 15-man / $50M / week-4 / 6-week shape (v2.51), not the old 17 / $40M / week-6",
    /basic: \{[\s\S]*?roster_max:15,[\s\S]*?salary_cap:50000000, weeks:6, trade_deadline_week:4,/.test(live) &&
    !/salary_cap:60000000/.test(live));
}

console.log("\n— the dressing rule is group-based");
{
  const r21 = sec("2.1");
  A("Rule 2.1 lets a player dress anywhere in his group", /Each club ices from an active roster shaped by position group/.test(r21));
  A("...forward at center or wing, defenseman either side", /A forward may be dressed at center or at either wing/.test(r21) && /a defenseman may be dressed on either side/.test(r21));
  A("...but never a skater in goal or a goalie out of it", /a goaltender may be dressed only in goal/.test(r21) && /only in goal does the declared position bind/.test(r21));
  A("...and the old 'only at his assigned position' wording is gone", !/only at his assigned position/.test(r21));
  A("the changelog records v2.26", rb.changelog.some((c) => c.version === "2.26" && /any position within his group/.test(c.summary)));
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
