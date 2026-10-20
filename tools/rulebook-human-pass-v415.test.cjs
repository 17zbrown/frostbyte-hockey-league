/* v4.15 (2026-10-16): the rulebook reads as a professional wrote it. The commissioner, 2026-10-16: "Keep the rulebook
   version, but get rid of all the AI looking hash marks and make it look written by a professional human." Every em
   dash is gone from the rule text, Appendix A, the rulebook page's own copy and the version history; members and staff
   are "they" and "them"; machine-made phrasing was rewritten in the formal register. No rule changed: each of the 397
   rewritten passages was checked by an independent verifier and by a script that compared every number, numeral word,
   rule citation and modal (shall, may, must, not, only) with the 4.14 text before it was applied.
   The same release corrects Detroit's arena (sql/2026-10-16-detroit-arena-v415.sql). Run: node tools/rulebook-human-pass-v415.test.cjs */
const fs = require("fs"), path = require("path");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + got)); } };
const ROOT = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
global.window = global; global.CG = {}; eval(R("src/live/part3_content.js"));
const rb = CG.CONTENT.rulebook;
const strings = (o, out) => { if (typeof o === "string") out.push(o); else if (Array.isArray(o)) o.forEach((v) => strings(v, out)); else if (o && typeof o === "object") Object.values(o).forEach((v) => strings(v, out)); return out; };
const chap = strings(rb.chapters, []), hist = strings(rb.changelog, []);
const dashed = (arr) => arr.filter((t) => /[—–]/.test(t));
const gendered = (arr) => arr.filter((t) => /\b(he|his|him|himself|she|her|hers|herself)\b/i.test(t));

console.log("\n1. No em dash anywhere in the rulebook");
A("no em or en dash in any chapter, section title, paragraph or shelved full-format text", dashed(chap).length === 0, dashed(chap).slice(0, 2).join(" / ").slice(0, 160));
A("...nor in the version history the rulebook page shows", dashed(hist).length === 0, dashed(hist).slice(0, 2).join(" / ").slice(0, 160));
const page = R("src/live/part5b_public2.js");
const route = page.slice(page.indexOf("CG.rulebookForFormat = function"), page.indexOf("var toc = '<div class=\"card\"><div class=\"card-h\"><h3>Contents</h3>"));
const visible = (route.match(/"[^"\n]*"|'[^'\n]*'/g) || []).filter((q) => /[—–]/.test(q));
A("the rulebook page's own strings (intro, appendix title and intro) carry no dash", visible.length === 0, visible.join(" | ").slice(0, 200));
A("chapter and appendix headings join the number and title with a colon", page.indexOf("(ch.shelved?'Appendix '+ch.num:'Chapter '+ch.num)+': '+esc(ch.title))") > -1);
A("the shelved-section tooltip carries no dash", page.indexOf("text for Rule '+esc(s.of||s.id)+', preserved and not in force\">Shelved</span>") > -1);
A("the page introduction reads in full sentences", page.indexOf("Start with Chapter 0, which explains how the season works step by step. ") > -1 && page.indexOf("The rulebook is searchable, versioned and linkable: cite any rule by its number anywhere in the league.") > -1);

const job = R("jobs/discord-scheduler.js"), card = job.slice(job.indexOf("export function buildRulesLink"), job.indexOf("async function rulesUpkeep"));
A("the rulebook's Discord card in #rules carries no dash either", !/[\u2014\u2013]/.test(card) && /always current, searchable and linkable: " \+\s+"cite any rule by its number/.test(card));

console.log("\n2. Members and staff are they and them");
A("no he, his, him or himself (nor she or her) in the rule text", gendered(chap).length === 0, gendered(chap).slice(0, 1).join("").slice(0, 160));
A("...nor in the version history", gendered(hist).length === 0, gendered(hist).slice(0, 1).join("").slice(0, 160));
A("singular they takes a plural verb where the rewrite introduced it (no 'they is' or 'they has')", !chap.some((t) => /\bthey (is|has|was|does|holds|stands|remains)\b/.test(t)));

console.log("\n3. Headings in the professional style, rules unchanged");
const titles = rb.chapters.map((c) => c.title);
A("Chapter 0 is titled How the season works", rb.chapters[0].title === "How the season works", rb.chapters[0].title);
A("chapter titles use 'and', not '&'", !titles.some((t) => /&/.test(t)), titles.filter((t) => /&/.test(t)).join(" | "));
A("Chapter 0 step headings use a colon", rb.chapters[0].sections.some((s) => s.title === "Step one: the off-season"));
const all = chap.join("\n");
A("binding figures survive: the regular-season shape", /six \(6\) game-weeks, three nights a week, three games a night, fifty-four \(54\) games per club/.test(all));
/* v4.24 (commissioner, 2026-10-20): "Yes say 'the day before the draft.'" The cutoff's day changed on purpose. */
A("...the draft-eligibility cutoff", /11:59 PM Eastern on the day before the draft/.test(all));
A("...the training-camp limit", /up to ten \(10\) training-camp players/.test(all));
A("...the playoff floor", /thirty percent \(30%\) of the season's regular-season schedule/.test(all));
A("...the forfeit window", /ten \(10\) minutes/.test(all));
A("Rule 4.5's Red-tier exceptions keep both abilities", /banned at the Red tier only: Stick .Em Up and Big Tipper, both of which may be equipped below that tier\./.test(all));

console.log("\n4. The changelog and Detroit's arena");
const e = rb.changelog.find((c) => c.version === "4.15") || {};   /* by version: a later release takes changelog[0] */
A("the changelog has its 4.15 entry, right after 4.14", e.version === "4.15" && (rb.changelog[rb.changelog.indexOf(e) + 1] || {}).version === "4.14");
A("...dated 2026-10-16, saying no rule changed", e.dateIso === "2026-10-16" && /No rule changed/.test(e.summary || ""));
A("...and naming Detroit's arena", (e.items || []).some((i) => /Little Caesars Arena/.test(i)));
const sql = R("sql/2026-10-16-detroit-arena-v415.sql"), body = sql.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
A("the SQL record sets DET's arena only where it still reads Toronto's", /update public\.teams set arena = 'Little Caesars Arena' where code = 'DET' and arena = 'Scotiabank Arena';/.test(body));
A("...ends with a self-check that raises", /raise exception 'v4\.15 self-check/.test(body));
A("...and records its rolled-back rehearsal", /REHEARSAL \(rolled back\): 1 row changed/.test(sql));

console.log("\n" + (n - fail) + "/" + n + " passed");
if (fail) process.exit(1);
