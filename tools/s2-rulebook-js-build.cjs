/* v5.00 swap (e6, one book): writes src/s2/js/rulebook.js, the live rulebook as the live site renders it, so the Season 2
   site shows the ONE published book and never a second copy (briefs/one-book.md; main session, 2026-11-24: "follow the
   cg-engine pattern", a committed generated file and a drift test, in place of a build-time step).
     node tools/s2-rulebook-js-build.cjs      rebuild the file
   tools/s2-rulebook-js-drift.test.cjs (npm test) fails when the committed file differs from a fresh build, so a rulebook
   change on main (src/live/part3_content.js) fails loudly until this command is run and its result committed.
   One source, one renderer: CG.CONTENT.rulebook from part3_content.js, rendered by the live site's own
   CG.rulebookForFormat (src/live/part5b_public2.js, found with the regex the rulebook tests use, exactly once or the build
   throws). The render is copied as it comes (chapters 0 to 10, S2, then Appendix A, the shelved full-format text) except
   each in-force section's `full` and `fullTitle`, the other format's text, which Appendix A already carries filtered
   (CG.rulebookForFormat v3.26), and which no visitor should download twice. The changelog keeps every release's version,
   date and summary, save the summaries of the releases in NO_SUMMARY, which name members (a data correction, an
   appointment): no member is named in a committed Season 2 file (COMMON.md, privacy), and the current site keeps them.
   The list is written here, not read from the private denylist, so npm test builds the same file on any machine; a new
   summary that names a member is caught by tools/ui/privacy-names.cjs, which scans this file's output like any added
   line, and its release joins the list. The releases in WAITLIST_SUMMARY also keep only their version and date: their
   summary describes the application waitlist, which Season 2 removes entirely (COMMON.md rulings; the commissioner:
   "remove the waitlist entirely from the website and rulebook"), so the Season 2 site prints the word nowhere, its
   version history included (review 2026-11-24). A new summary naming the waitlist stops the build until its release
   joins that list.
   shortcut: format fixed at build (basic, standing order); read seasons.format when a full season is designated.
   CG.rulebookShapeSync (Rule 3.1's first sentence from the season's shape) is not applied: the stored sentence is right
   while every season is 6 weeks of 3 nights; revisit when a season's shape changes. */
const fs = require("fs"), path = require("path"), vm = require("vm");
const REPO = path.resolve(__dirname, ".."), OUT = path.join(REPO, "src/s2/js/rulebook.js");
const FORMAT = "basic";
/* the releases whose summary matches the private denylist (2026-11-24); each keeps its version and date. v3.84 and v3.45
   name a member. v2.8 names no member: its only match is a common word in rule text that is also one of the denylist's
   entries (QA nits 2026-11-25), and it stays withheld because the privacy scans read the published copy word for word */
const NO_SUMMARY = ["3.84", "3.45", "2.8"];
/* the releases whose summary describes the application waitlist, removed entirely in Season 2; each keeps its version and date */
const WAITLIST_SUMMARY = ["4.22", "2.20"];
const HELD = NO_SUMMARY.concat(WAITLIST_SUMMARY);
const WAITLIST = /wait\s*-?\s*list/i;
const RENDER = /CG\.rulebookForFormat = function\(rb, fmt\)\{[\s\S]*?\n\};/g;

/* the renderer's source, found exactly once (a renamed, doubled or deleted definition is an error, never a silent skip) */
function renderer(src) {
  const found = src.match(RENDER) || [];
  if (found.length !== 1) throw new Error("src/live/part5b_public2.js: `CG.rulebookForFormat = function(rb, fmt){ ... };` is found " + found.length + " times; it must be found exactly once");
  return found[0];
}

/* the book the live site shows for FORMAT, from the two source texts */
function render(content, pub2) {
  const ctx = vm.createContext({ CG: {} });
  vm.runInContext(content, ctx, { filename: "part3_content.js" });
  vm.runInContext(renderer(pub2), ctx, { filename: "part5b_public2.js" });
  const rb = ctx.CG.CONTENT && ctx.CG.CONTENT.rulebook;
  if (!rb || !Array.isArray(rb.chapters) || !rb.chapters.length || !Array.isArray(rb.changelog) || !rb.changelog.length) throw new Error("part3_content.js holds no CG.CONTENT.rulebook with chapters and a changelog");
  const book = ctx.CG.rulebookForFormat(rb, FORMAT);
  if (book.format !== FORMAT) throw new Error("CG.rulebookForFormat rendered " + book.format + ", not " + FORMAT);
  return { rb, book };
}

function build() {
  const R = (f) => fs.readFileSync(path.join(REPO, f), "utf8");
  const { rb, book } = render(R("src/live/part3_content.js"), R("src/live/part5b_public2.js"));
  const strip = (s) => { const o = {}; Object.keys(s).forEach((k) => { if (k !== "full" && k !== "fullTitle") o[k] = s[k]; }); return o; };
  const RB = {
    version: rb.changelog[0].version, dateIso: rb.changelog[0].dateIso, format: book.format,
    chapters: book.chapters.map((c) => Object.assign({}, c, { sections: c.sections.map(strip) })),
    changelog: rb.changelog.map((c) => HELD.indexOf(c.version) < 0 ? { version: c.version, dateIso: c.dateIso, summary: c.summary } : { version: c.version, dateIso: c.dateIso })
  };
  /* a listed release that is gone, or has no summary to withhold, means the list went stale: say so, never skip */
  NO_SUMMARY.forEach((v) => { const c = rb.changelog.find((x) => x.version === v); if (!c || !c.summary) throw new Error("NO_SUMMARY names v" + v + ", which is not a release with a summary"); });
  WAITLIST_SUMMARY.forEach((v) => { const c = rb.changelog.find((x) => x.version === v); if (!c || !WAITLIST.test(c.summary || "")) throw new Error("WAITLIST_SUMMARY names v" + v + ", which is not a release whose summary names the waitlist"); });
  if (rb.changelog.some((c) => HELD.indexOf(c.version) < 0 && typeof c.summary !== "string")) throw new Error("a release has no summary");
  const told = rb.changelog.filter((c) => HELD.indexOf(c.version) < 0 && WAITLIST.test(c.summary)).map((c) => "v" + c.version);
  if (told.length) throw new Error(told.join(", ") + ": the summary names the application waitlist, which Season 2 removes; add the release to WAITLIST_SUMMARY");
  const text = "/* GENERATED by tools/s2-rulebook-js-build.cjs from src/live: do not edit. Change the rulebook in src/live/part3_content.js,\n" +
    "   then run `node tools/s2-rulebook-js-build.cjs`; tools/s2-rulebook-js-drift.test.cjs fails until the two agree.\n" +
    "   S2.RB is the live rulebook, version " + RB.version + ", rendered by the live site's CG.rulebookForFormat in the " + RB.format + " format:\n" +
    "   { version, dateIso, format, chapters: [{ num, title, intro?, shelved?, upcomingSeason?, sections: [{ id, title,\n" +
    "   paragraphs, of? }] }], changelog: [{ version, dateIso, summary? }] }, newest release first; a summary that names\n" +
    "   a member, or a feature Season 2 removes, is left out (the build's two hold lists). */\n" +
    "(function () {\n\"use strict\";\nvar S2 = window.S2 = window.S2 || {};\nS2.RB = " + JSON.stringify(RB) + ";\n})();\n";
  /* the copy must run, and hold the book it names */
  const ctx = { }; ctx.window = ctx; vm.createContext(ctx); vm.runInContext(text, ctx, { filename: "rulebook.js" });
  if (!ctx.S2 || !ctx.S2.RB || ctx.S2.RB.chapters.length !== book.chapters.length) throw new Error("rulebook.js does not define S2.RB with every chapter");
  return text;
}

module.exports = { build, render, renderer, OUT, FORMAT, NO_SUMMARY, WAITLIST_SUMMARY, WAITLIST };
if (require.main === module) {
  const text = build();
  fs.writeFileSync(OUT, text);
  const RB = (() => { const c = { }; c.window = c; vm.createContext(c); vm.runInContext(text, c); return c.S2.RB; })();
  console.log("wrote " + path.relative(REPO, OUT) + " (v" + RB.version + ", " + RB.chapters.length + " chapters, " +
    RB.chapters.reduce((a, c) => a + c.sections.length, 0) + " sections, " + Math.round(text.length / 1024) + " KB)");
}
