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
  /* publish = "." serves the whole root, so this is blocked at the edge instead */
  A("the abandoned WNBA mockup is gone from the repo",
    !fs.existsSync(path.join(__dirname, "..", "mockup-wnba.html")));
  A("preview.html — a full second copy of the live app — is blocked",
    /from = "\/preview\.html"[\s\S]{0,80}status = 404/.test(toml));
  A("root .txt is blocked, so the owners' briefing is not downloadable",
    /from = "\/\*\.txt"[\s\S]{0,80}status = 404/.test(toml));
  A("...and root .md too", /from = "\/\*\.md"[\s\S]{0,80}status = 404/.test(toml));
  A("robots.txt survives, carved out ABOVE the wildcard (Netlify takes the first match)",
    toml.indexOf('from = "/robots.txt"') < toml.indexOf('from = "/*.txt"') &&
    /from = "\/robots\.txt"[\s\S]{0,90}status = 200/.test(toml));
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

console.log("\n— the league is described accurately");
{
  A("the meta description says twelve clubs", /twelve clubs/.test(head));
  A("...and nowhere still says eight", !/eight clubs/.test(head));
  const n = (head.match(/twelve clubs/g) || []).length;
  A("every link-preview surface was updated together", n >= 4, n + " places");
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
