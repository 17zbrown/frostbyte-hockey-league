/* Launch hygiene — the prototype residue and public leaks found in the pre-season audit.
   Run: node tools/launch-hygiene.test.cjs

   Each of these was live on chelgamingleague.com in August 2026 and would have been seen by
   members during the season's first weeks. They are pinned because every one of them is the kind
   of thing that creeps back: a file dropped in the repo root, a placeholder that outlives its
   prototype, a count that changes when the league grows. */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const head = R("src/live/part1_head.html");
const content = R("src/live/part3_content.js");
const ui = R("src/live/part4_ui.js");
const pub = R("src/live/part5a_public.js");
const toml = R("netlify.toml");

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

console.log("— nothing in the repo root is served that shouldn't be");
{
  /* publish = "." serves the whole root, so these are blocked at the edge.
     THE TRAP: Netlify treats `*` only as a TRAILING splat (/dir/*), never as an extension glob.
     A "/*.txt" rule silently matches nothing. It was written that way first; the config read
     correctly, this test passed, and the owners' briefing stayed downloadable until a live curl
     caught it. So the assertions below check for EXACT paths and actively reject the glob form —
     a test that only proves a rule exists is worthless if the rule cannot fire. */
  const rule = (p) => new RegExp('from = "' + p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '"[\\s\\S]{0,90}status = 404');
  A("the abandoned WNBA mockup is gone from the repo",
    !fs.existsSync(path.join(__dirname, "..", "mockup-wnba.html")));
  A("preview.html — a full second copy of the live app — is blocked by exact path",
    rule("/preview.html").test(toml));
  A("the owners' briefing is blocked by exact path (.txt)",
    rule("/CGHL-Season1-Owners-Briefing-DISCORD.txt").test(toml));
  A("...and the .md alongside it", rule("/CGHL-Season1-Owners-Briefing.md").test(toml));
  A("no extension-glob rules, which Netlify silently ignores",
    !/from = "\/\*\.\w+"/.test(toml));
  A("robots.txt and sitemap.xml are not blocked by anything",
    !/from = "\/robots\.txt"[\s\S]{0,90}status = 404/.test(toml) &&
    !/from = "\/sitemap\.xml"[\s\S]{0,90}status = 404/.test(toml));
}

console.log("\n— no invented people or invented facts");
{
  const c = JSON.parse(content.match(/CG\.CONTENT = (\{[\s\S]*?\});\n/)[1]);
  A("the prototype Player-of-the-Week blurbs are gone",
    (c.awards && c.awards.potw || []).length === 0);
  A("...so no invented player can print under a real winner",
    !/GrittyGrinder|Aurora Blades|Tucson Vipers|CG-0142|FiveHoleFinn/.test(content));
  A("the prototype three-star write-ups are gone too",
    (c.awards && c.awards.threeStars || []).length === 0);
  A("the prototype power-rankings copy is gone", !(c.rankings && (c.rankings.entries || []).length));
  A("the invented complaint cases are gone", !(c.ops && (c.ops.complaints || []).length));
  A("...and the rulebook itself is untouched",
    (c.rulebook.chapters || []).length >= 11 && (c.rulebook.changelog || []).length >= 30);
  A("the profile no longer claims everyone is a Season 1 original roster member",
    !/Season 1 original roster/.test(pub));
  A("...it states the real origin instead", /p\.origin==="draft" \? "Drafted by "/.test(pub));
}

console.log("\n— the league is described without a number that will age");
{
  /* These tags said "eight clubs across two divisions" while the league ran twelve — wrong in
     every link preview and search result. Rather than correct the number, the count and the
     division split came out entirely: a club is added or a division is renamed and the metadata
     has nothing to drift against. */
  A("no club count survives in the head", !/eight clubs|twelve clubs|\d+ clubs/.test(head));
  A("...and no division count either", !/two divisions/.test(head));
  A("the description still says what the league IS",
    /A competitive 6v6 EA Sports NHL league playing a full season/.test(head));
  A("the social cards still carry a description", /og:description[\s\S]{0,140}competitive 6v6/.test(head));
  A("...and the image alts still name the league", /og:image:alt[\s\S]{0,90}Chel Gaming Hockey League/.test(head));
}

console.log("\n— the masthead points at rooms people are actually in");
{
  A("Forums is out of the primary nav (zero posts, ever)", !/\["Forums","#\/forums"\]/.test(ui));
  A("...but the route still resolves, so old links do not 404",
    fs.existsSync(path.join(__dirname, "..", "src/live/part10_forums.js")));
  A("the masthead does not duplicate a dropdown entry", !/\["Stats","#\/stats"\]\n\];/.test(ui));
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
