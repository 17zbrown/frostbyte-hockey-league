/* v3.21 — CGHL is a console league, and a sign-up says which console and which name on it.
 *
 * Commissioner, 2026-09-25: "Make it a requirement when signing up to add the EA ID, select the
 * platform type (remove PC option), and fill in their Gamertag/PSN name." And: "Make a separate type
 * box in the player profile settings for their console gamertag/PSN name."
 */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
function A(name, cond, got) {
  n++;
  if (cond) console.log("ok   " + name);
  else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  — got: " + String(got).slice(0, 240))); }
}
const eng = R("src/live/part2_engine.js"), live = R("src/live/part_live.js"),
      hub = R("src/live/part6_hub.js"), pub = R("src/live/part5a_public.js"),
      head = R("src/live/part1_head.html"), rec = R("sql/2026-09-25-console-details.sql");
const flat = rec.replace(/\n--\s?/g, " ").replace(/\s+/g, " ");
/* the built page is what ships; a source-only check would pass on a file the build never includes */
const built = R("index.html");

console.log("\n— ONE console vocabulary, and PC is gone from all of it");
{
  A("CG.PLATFORMS is the object list, in part2_engine so it loads before every picker",
    /CG\.PLATFORMS = \[\s*\{ id:"XSX", label:"Xbox",\s*tag:"Xbox Gamertag" \},\s*\{ id:"PS5", label:"PlayStation", tag:"PSN Name" \}\s*\]/.test(eng));
  A("CG.platLabel, CG.platTag and CG.platOptions all exist",
    /CG\.platLabel = function/.test(eng) && /CG\.platTag = function/.test(eng) && /CG\.platOptions = function/.test(eng));
  A("platTag falls back to BOTH names when no console is chosen",
    /return "Xbox Gamertag or PSN Name";/.test(eng));
  /* strip comments: the record of the old lists lives in comments on purpose */
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const [label, src] of [["part_live", live], ["part6_hub", hub], ["part2_engine", eng]]) {
    A(`${label} has no PC option left`, !/["']PC["']/.test(strip(src)),
      (strip(src).split("\n").find((l) => /["']PC["']/.test(l)) || "").trim());
    A(`${label} has no long console spelling left`,
      !/PlayStation 5|Xbox Series X\|S/.test(strip(src)));
  }
  A("no picker builds its own list any more: every one goes through CG.platOptions",
    (live.match(/CG\.platOptions\(/g) || []).length >= 3 && /CG\.platOptions\(/.test(hub));
  A("the SHIPPED page carries no PC option", !/<option value="PC"/.test(built) && !/>PC<\/option>/.test(built));
}

console.log("\n— the separate console-name box in the member's own settings");
{
  A("there is a Console picker", /<span>Console<\/span><select id="sPlatLive">'\+CG\.platOptions/.test(live));
  A("...and a SEPARATE box for the console name, with its own id", /<input id="sTagLive"/.test(live));
  A("...whose label is an element, so it can be re-rendered", /<span id="sTagLiveLbl">/.test(live));
  A("...and the label follows the console the moment it changes",
    /pl\.addEventListener\("change"[\s\S]{0,320}lbl\.textContent=CG\.platTag\(this\.value\)/.test(live));
  A("the save writes platform_gamertag", /platform_gamertag:ptag\|\|null/.test(live));
  A("...and refuses a console the league does not play on rather than letting the DB CHECK do it",
    /if \(plat && !CG\.PLATFORMS\.some\(function\(x\)\{ return x\.id===plat; \}\)\)/.test(live));
  A("...and keeps the in-memory profile in step, so the page does not re-ask",
    /CG\.auth\.profile\.platform_gamertag=ptag\|\|null/.test(live));
  A("the display name stays read-only: it is the Discord name",
    /<span>Display name \/ gamertag<\/span><input value="'\+esc\(p\.gamertag\|\|p\.display_name\|\|""\)\+'" readonly/.test(live));
}

console.log("\n— the sign-up requirement, and ONE definition of what is missing");
{
  A("CG.regMissing is the single definition", /CG\.regMissing = function\(pr\)\{/.test(live));
  A("...covering all three", /out\.push\("ea"\)/.test(live) && /out\.push\("plat"\)/.test(live) && /out\.push\("tag"\)/.test(live));
  A("registerForSeason consults it before writing", /var miss=CG\.regMissing\(\);\s*\n\s*if\(miss\.length\)\{/.test(live));
  A("the prompt asks for all three at once, not the EA ID alone",
    /CG\.modal\("Your player details"/.test(live) && /id="eaPlat"/.test(live) && /id="eaTag"/.test(live));
  A("...and its console-name label follows the console too", /document\.getElementById\("eaTagLbl"\)\.textContent=CG\.platTag\(this\.value\)/.test(live));
  A("the save is fail-loud: a zero-row UPDATE is reported, not treated as success",
    /CG\.savePlayerDetails = async function[\s\S]{0,700}if\(!\(r\.data\|\|\[\]\)\.length\)/.test(live));
  A("a server-side DETAILS refusal reopens the same form instead of showing a database message",
    /if\(\/\^DETAILS:\/\.test\(m\)\|\|\/DETAILS: \/\.test\(m\)\)/.test(live) && /CG\.promptEaId\(\); return;/.test(live));
  A("...after re-reading the profile, so the form shows what the server actually has",
    /select\("ea_id,platform,platform_gamertag"\)/.test(live));
}

console.log("\n— the Control Center player modal no longer writes its own spelling");
{
  A("it uses CG.platOptions", /<span>Console<\/span><select id="uePlat">'\+CG\.platOptions/.test(live));
  A("...and it can set the console name too", /fld\("Xbox gamertag \/ PSN name","ueTag"/.test(live));
  A("...and saves it", /platform_gamertag:\(document\.getElementById\("ueTag"\)\.value\|\|""\)\.trim\(\)\|\|null/.test(live));
}

console.log("\n— a stored code is never shown to a member as a code");
{
  A("the profile hero shows the console", /CG\.platLabel\(p\.platform\)/.test(pub));
  A("the account-only profile too", /CG\.platLabel\(r\.data\.platform\)/.test(pub));
  A("...and nothing renders the raw value", !/esc\(p\.platform\)/.test(pub) && !/esc\(r\.data\.platform\)/.test(pub));
}

console.log("\n— the published rule");
{
  const content = R("src/live/part3_content.js");
  const obj = JSON.parse(content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1));
  const r11 = obj.rulebook.chapters.find((c) => c.num === 1).sections.find((s) => s.id === "1.1");
  const body = r11.paragraphs.join(" ");
  A("Rule 1.1 says CGHL is played on console", /CGHL is played on console\./.test(body));
  A("...and names the three required things", /three things: his EA ID, the console he plays on \(Xbox or PlayStation\), and the gamertag or PSN name that console shows/.test(body));
  A("...says what each is FOR", /the name the league's box scores are matched on/.test(body) && /how a club adds him and gets him into a party/.test(body));
  A("...draws the privacy line between them",
    /shown on the player's public profile and in the player directory/.test(body)
    && /shown to his club's management and to league staff rather than publicly/.test(body));
  A("...and that a correction does not rewrite history", /a correction after the fact does not undo a game already recorded/.test(body));
  A("the changelog records it", obj.rulebook.changelog.some((e) => e.version === "3.21"));
}

console.log("\n— the decision record, including the two traps that cost a round trip each");
{
  A("it quotes the instruction", /select the platform type \(remove PC option\)/.test(flat));
  A("it names the ROOT CAUSE of the four spellings: three pickers, three lists",
    /There were THREE platform pickers in the client, each with its own list/.test(flat));
  A("...and says the data was recording a bug, not member typing",
    /it was faithfully recording a bug/.test(flat));
  A("it reports that regEaId had never resolved anybody",
    /had NEVER ONCE resolved anybody/.test(flat));
  A("it says why NULL platform stays legal", /forcing one would break every unrelated profile write/.test(flat));
  A("it records that the rehearsal found the existing guard BEFORE a second one was written",
    /The rehearsal found an existing guard before writing a new one/.test(flat));
  A("...and why one gate beats two", /two functions refusing sign-ups for overlapping reasons with different wording/.test(flat));
  A("TRAP 1: the untyped array literal", /resolves to anyarray \|\| anyarray/.test(flat));
  A("TRAP 2: the rehearsal that tested nothing", /THE REHEARSAL LIED TO ME ONCE/.test(flat)
    && /guard_profile_role\(\) silently REVERTS/.test(flat));
  A("...with the lesson stated as a rule", /assert the value actually changed before relying on it/.test(flat));
  A("...and the same function is credited for why no new RLS was needed",
    /it does NOT revert ea_id, platform or platform_gamertag/.test(flat));
  A("TRAP 3: a fabricated member cannot exist", /profiles\.id references auth\.users/.test(flat));
  A("no em dash or spaced hyphen in the record", !/—/.test(rec) && !/ - /.test(rec));
}

console.log(`\n${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
