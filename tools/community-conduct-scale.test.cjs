/* v3.39 — community rulings: four headings, several at a time, and a 3/6/9 scale. */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
function A(name, cond, got) {
  n++;
  if (cond) console.log("ok   " + name);
  else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  — got: " + String(got).slice(0, 220))); }
}
const live = R("src/live/part_live.js"), desks = R("src/live/part9_staffdesks.js");
const rec = R("sql/2026-09-26-community-conduct-scale.sql");
const flat = rec.replace(/\n--\s?/g, " ").replace(/\s+/g, " ");

console.log("\n— the four headings, in one list with a named twin");
{
  const m = live.match(/CG\.CONDUCT_REASONS = \[([\s\S]*?)\];/);
  A("CG.CONDUCT_REASONS exists", !!m);
  ["vulgar", "slurs", "inappropriate", "other"].forEach((c) =>
    A("...carries " + c, !!m && new RegExp('code:"' + c + '"').test(m[1])));
  ["Vulgar language", "Slurs", "Posting inappropriate content", "Other"].forEach((l) =>
    A('...labelled "' + l + '"', !!m && m[1].indexOf(l) >= 0));
  A("it names its SQL twin", /The SQL twin is\s*\n?\s*public\.conduct_reasons\(\)/.test(live) || /public\.conduct_reasons\(\)/.test(live));
  A("the record names the twin too", /There is a JS twin/.test(flat) && /if one changes, change the other/.test(flat));
}

console.log("\n— several headings at once, which is the point");
{
  A("they render as checkboxes, not a select", /type="checkbox" class="susCode"/.test(live));
  A("...and every ticked one is collected",
    /querySelectorAll\("\.susCode:checked"\)/.test(live));
  A("no heading is refused in the form", /Tick at least one heading/.test(live));
  A("bare Other is refused in the form", /says nothing on its own/.test(live));
  A("the desk copy tells a moderator to tick several",
    /one outburst is often more than one thing/.test(desks));
}

console.log("\n— the 3/6/9 scale");
{
  A("the ladder is one constant", /CG\.CONDUCT_LADDER = \[3, 6, 9\]/.test(live));
  A("the length is a select built from it", /CG\.CONDUCT_LADDER\.map\(function\(g\)\{ return '<option value="'\+g\+'">'\+g\+' games<\/option>'/.test(live));
  A("...and re-checked before sending", /CG\.CONDUCT_LADDER\.indexOf\(games\)<0/.test(live));
  A("conduct mode never offers a date", (function(){
    const i = live.indexOf("if (conduct){"), j = live.indexOf("} else {", i);
    return live.slice(i, j).indexOf("susDate") < 0;
  })());
  A("the desk copy states the scale and what needs a commissioner",
    /3, 6 or 9 games<\/b> \(Rule 7\.7\)/.test(desks) && /an outright ban/.test(desks));
}

console.log("\n— one modal, two forms");
{
  A("CG.suspendUser is still the only one", (live.match(/CG\.suspendUser = function/g) || []).length === 1);
  A("...and takes opts", /CG\.suspendUser = function\(profileId, name, opts\)/.test(live));
  A("the community desk asks for the conduct form", /CG\.suspendUser\(who\.id, who\.name, \{ conduct:true \}\)/.test(desks));
  A("Users and roles still gets the old form", /data-suspend[\s\S]{0,200}CG\.suspendUser\(this\.getAttribute\("data-suspend"\), this\.getAttribute\("data-name"\)\)/.test(live));
  A("the codes ride along on the RPC", /p_codes:codes/.test(live));
}

console.log("\n— the record reasons about which 'staff' the scale binds");
{
  A("it quotes the instruction", /Staff can do 3 games, 6 games, or 9 games before requiring a commissioner/.test(flat));
  A("it says the reading was decided, not guessed", /Read alone, the last sentence could mean every staff desk\. It cannot/.test(flat));
  A("...and gives the rulebook evidence",
    /Rule 7\.4 makes a TWO-game suspension the mandatory baseline/.test(flat));
  A("...and proves officiating still works", /the 2-game baseline, a 10-game ruling and a 20-day ruling all still issue/.test(flat));
  A("the both-departments precedence is settled", /binds a moderator who holds ONLY community/.test(flat));
  A("the overload trap is recorded again", /A new defaulted parameter makes an OVERLOAD/.test(flat));
  A("the eleven checks are listed", /ELEVEN CHECKS/.test(flat));
  A("no em dash or spaced hyphen", !/—/.test(rec) && !/ - /.test(rec));
}

console.log("\n— Rule 7.7");
{
  const content = R("src/live/part3_content.js");
  const rb = JSON.parse(content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1)).rulebook;
  const ch7 = rb.chapters.find((c) => c.num === 7);
  const s77 = (ch7.sections.find((x) => x.id === "7.7") || {}).paragraphs;
  A("7.7 exists", !!s77, ch7.sections.map((x) => x.id).join(","));
  A("...and is titled for league spaces", /Conduct in league spaces/.test((ch7.sections.find((x) => x.id === "7.7") || {}).title || ""));
  ["vulgar language", "slurs", "posting inappropriate content"].forEach((h) =>
    A("...lists " + h, !!s77 && s77[0].indexOf(h) >= 0));
  A("...requires words when Other is used", !!s77 && /other, which requires the ruling to say in words what happened/.test(s77[0]));
  A("...allows more than one heading, with a reason", !!s77 && /should not be narrowed to fit a single label/.test(s77[0]));
  A("...sets the scale at 3, 6 or 9", !!s77 && /runs three \(3\), six \(6\) or nine \(9\) games/.test(s77[1]));
  A("...and reserves longer, expulsion and staff to a commissioner",
    !!s77 && /longer than nine \(9\) games, an expulsion from the league, and any sanction against a commissioner or a member of league staff are imposed only by a commissioner/.test(s77[1]));
  A("...tells the member the headings", !!s77 && /told the headings recorded against him/.test(s77[2]));
  A("...and settles the two-department case", !!s77 && /whichever rule fits the conduct he is ruling on/.test(s77[2]));
  A("7.1 points at 7.7 now", /on the scale of Rule 7\.7/.test(ch7.sections.find((x) => x.id === "7.1").paragraphs[1]));
  A("7.2 still carries the general staff ceiling for officiating",
    /up to ten \(10\) games or thirty \(30\) days/.test(ch7.sections.find((x) => x.id === "7.2").paragraphs[0]));
  A("7.4's mandatory 2-game baseline is untouched",
    /baseline sanction for a verified act of dangerous contact is a two \(2\) game suspension/.test(ch7.sections.find((x) => x.id === "7.4").paragraphs[1]));
  A("the changelog records it", rb.changelog.some((e) => e.version === "3.39"));
}

console.log(`\n${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
