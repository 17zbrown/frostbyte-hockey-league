/* v5.00 swap (e6, one book): src/s2/js/rulebook.js is the live rulebook rendered by tools/s2-rulebook-js-build.cjs. This
   fails when the committed copy differs from a fresh build (the rulebook changed in src/live/part3_content.js, or the live
   renderer changed, and the copy was not rebuilt), so the Season 2 site can never show a book the current site does not.
   Fix a failure by running `node tools/s2-rulebook-js-build.cjs` and committing the result, never by editing the copy. */
const fs = require("fs"), path = require("path"), vm = require("vm");
const { build, render, renderer, OUT, NO_SUMMARY, WAITLIST_SUMMARY, WAITLIST } = require("./s2-rulebook-js-build.cjs");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let n = 0, fail = 0;
const A = (name, cond, info) => { n++; if (cond) console.log("PASS " + name); else { fail++; console.log("FAIL " + name + (info !== undefined ? " :: " + JSON.stringify(info).slice(0, 300) : "")); } };

console.log("— the copy is the live book");
const fresh = build(), have = fs.readFileSync(OUT, "utf8");
let at = -1; if (fresh !== have) for (let i = 0; i < Math.max(fresh.length, have.length); i++) if (fresh[i] !== have[i]) { at = i; break; }
A("src/s2/js/rulebook.js equals a fresh build from src/live (run node tools/s2-rulebook-js-build.cjs)", fresh === have,
  at < 0 ? undefined : { line: have.slice(0, at).split("\n").length, committed: have.slice(at, at + 80), fresh: fresh.slice(at, at + 80) });
const ctx = {}; ctx.window = ctx; vm.createContext(ctx); vm.runInContext(have, ctx);
const RB = ctx.S2.RB, { rb, book } = render(R("src/live/part3_content.js"), R("src/live/part5b_public2.js"));
A("it is the current release: version and date are the changelog's newest entry", RB.version === rb.changelog[0].version && RB.dateIso === rb.changelog[0].dateIso, [RB.version, RB.dateIso]);
A("same chapters, same order, same titles and intros as the live render", JSON.stringify(RB.chapters.map((c) => [c.num, c.title, c.intro || null, !!c.shelved])) === JSON.stringify(book.chapters.map((c) => [c.num, c.title, c.intro || null, !!c.shelved])));
A("same sections, same order, same words", JSON.stringify(RB.chapters.map((c) => c.sections.map((s) => [s.id, s.title, s.paragraphs]))) === JSON.stringify(book.chapters.map((c) => c.sections.map((s) => [s.id, s.title, s.paragraphs]))));
A("the basic format, with the full format shelved last as Appendix A (each A.x names the rule it would replace)", RB.format === "basic" && RB.chapters[RB.chapters.length - 1].num === "A" && RB.chapters[RB.chapters.length - 1].shelved === true &&
  RB.chapters[RB.chapters.length - 1].sections.every((s) => s.id === "A." + s.of));
A("Chapter S2 keeps its own title, intro and season", RB.chapters.some((c) => c.num === "S2" && c.title && c.intro && c.upcomingSeason === 2));
A("no in-force section carries the other format's text (Appendix A has it)", RB.chapters.every((c) => c.sections.every((s) => !("full" in s) && !("fullTitle" in s))));
A("every release is listed, newest first, with its date and its summary word for word", RB.changelog.length === rb.changelog.length &&
  RB.changelog.every((c, i) => c.version === rb.changelog[i].version && c.dateIso === rb.changelog[i].dateIso && (NO_SUMMARY.concat(WAITLIST_SUMMARY).indexOf(c.version) >= 0 || c.summary === rb.changelog[i].summary)));
A("only the three releases whose summary matches the privacy denylist (v3.84 and v3.45 name a member; v2.8 names none, its match is a common word) and the two that describe the application waitlist (v4.22, v2.20) go without one",
  JSON.stringify(RB.changelog.filter((c) => !("summary" in c)).map((c) => c.version)) === '["4.22","3.84","3.45","2.20","2.8"]', RB.changelog.filter((c) => !("summary" in c)).map((c) => c.version));
/* Season 2 removes the application waitlist entirely (COMMON.md rulings): the copy names it nowhere, the version history included */
A("the word waitlist is nowhere in the copy, chapters or version history", !WAITLIST.test(JSON.stringify(RB)) && !/waitlist/i.test(have));
A("v2.20 and v4.22 still hold a waitlist summary in src/live, so the hold is not stale", WAITLIST_SUMMARY.every((v) => WAITLIST.test((rb.changelog.find((c) => c.version === v) || {}).summary || "")));

console.log("\n— it is a classic script with one global");
A("one function scope setting S2.RB, strict", /\n\(function \(\) \{\n"use strict";\nvar S2 = window\.S2 = window\.S2 \|\| \{\};\nS2\.RB = \{/.test(have) && /\};\n\}\)\(\);\n$/.test(have));
A("nothing on window but S2", Object.keys(ctx).join() === "window,S2");

console.log("\n— the build refuses a missing or doubled renderer");
const throws = (f) => { try { f(); return false; } catch (e) { return true; } };
const one = "CG.rulebookForFormat = function(rb, fmt){\n  return rb;\n};";
A("found once, it is taken", renderer("x;\n" + one + "\ny;") === one);
A("found twice, the build throws", throws(() => renderer(one + "\n" + one)));
A("not found, the build throws", throws(() => renderer("CG.rulebookFor = function(rb, fmt){\n};")));

console.log(fail ? "\n" + fail + " of " + n + " FAILED" : "\nall " + n + " passed");
process.exit(fail ? 1 : 0);
