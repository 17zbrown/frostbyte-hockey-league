/* v3.38 — the community department can suspend, and the member is told.
 *
 * Commissioner, 2026-09-26: "Allow the community staff to suspend members due to discord chat
 * violations via the community desk in the staff desk on the website."
 */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
function A(name, cond, got) {
  n++;
  if (cond) console.log("ok   " + name);
  else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  — got: " + String(got).slice(0, 240))); }
}
const rec = R("sql/2026-09-26-community-can-suspend.sql");
const flat = rec.replace(/\n--\s?/g, " ").replace(/\s+/g, " ");
const desks = R("src/live/part9_staffdesks.js"), live = R("src/live/part_live.js");

console.log("\n— the desk can act");
{
  A("the community capability list carries discipline.suspend",
    /community:\s*\["community\.desk", "discipline\.warn", "discipline\.suspend", "discipline\.lift\.own"\]/.test(desks));
  A("the Moderation card has a Suspend button", /id="commSuspend">Suspend a member<\/button>/.test(desks));
  A("the registry no longer binds an empty after", (function(){
    var line = desks.split("\n").find(function(l){ return /\{ key:"community"/.test(l); });
    return !!line && /after:function\(\)\{ CG\.AFTER\._deskCommunity\(\); \}/.test(line);
  })(), (desks.split("\n").find(function(l){ return /\{ key:"community"/.test(l); }) || "").slice(-80));
  A("...and the handler exists", /CG\.AFTER\._deskCommunity = function\(\)/.test(desks));
  A("the button opens the member-pick prompt", /id === "commSuspend"|getElementById\("commSuspend"\)/.test(desks));
}

console.log("\n— it reuses the one suspension modal rather than growing a second");
{
  A("the prompt hands off to CG.suspendUser", /CG\.suspendUser\(who\.id, who\.name\)/.test(desks));
  A("CG.suspendUser is still the single definition", (live.match(/CG\.suspendUser = function/g) || []).length === 1);
  A("...and it still calls suspend_player", /rpc\("suspend_player"/.test(live));
  A("the picker covers the whole league, not just rostered players",
    /CG\.memberPickerField\("commSusWho"/.test(desks) && /rostered or not/.test(desks));
  A("...and it is wired, as the picker contract requires", /CG\.wireMemberPicker\("commSusWho"\)/.test(desks));
  A("a member must be PICKED, not typed, so the suspension attaches to a real profile",
    /if \(!who\.id\)\{ CG\.toast\("Pick a member from the list/.test(desks));
}

console.log("\n— lifting is scoped to what this desk issued");
{
  A("only the viewer's own rulings offer Lift", /var mine = me && s\.created_by === me;/.test(desks));
  A("...and the rest say so instead of offering a button the DB would refuse",
    /not yours to lift/.test(desks));
  A("Lift reuses the existing confirm flow", /CG\.liftUserSuspension\(this\.getAttribute\("data-comm-lift"\)/.test(desks));
  A("the record explains the scoping", /Letting it suspend without letting it lift/.test(flat));
}

console.log("\n— the copy tells a moderator the actual rules");
{
  A("the ceiling is stated", /10 games or 30 days/.test(desks));
  A("the reason requirement is stated, with why", /has 48 hours to appeal it \(Rule 7\.6\)/.test(desks));
  A("...and that the member is told both ways", /on the site and by direct message/.test(desks));
  A("escalation is still named", /leave the case open and hand it up/.test(desks));
  A("the old 'suspensions belong to officiating' note is gone",
    !/Suspensions belong to the officiating department/.test(desks));
}

console.log("\n— the record");
{
  A("it quotes the instruction", /Allow the community staff to suspend members due to discord chat violations/.test(flat));
  A("it names the contradiction the book already held",
    /Rule 7\.1[\s\S]{0,200}escalate anything heavier/.test(flat) && /League staff may impose suspensions of up to ten/.test(flat));
  A("it quotes the carve-out that was removed",
    /has_department\('community'\) and p_mode = 'warning'/.test(flat));
  A("the bigger find is recorded as bigger",
    /THE MEMBER IS TOLD/.test(flat) && /worse than the thing I was asked to fix/.test(flat));
  A("...with the precise asymmetry", /a ruling made FROM A CASE reached the member and an identical ruling made DIRECTLY did not/.test(flat));
  A("...and why it lives in the trigger", /so every path is covered, including any added later/.test(flat));
  A("the blind update is recorded", /reported success and changed nothing/.test(flat));
  A("the rehearsal names a real community-only staffer", /Altieri/.test(flat) && /holds the community department and nothing else/.test(flat));
  A("...and lists all eight assertions", /8\. a blank reason was refused/.test(flat));
  A("...and proves nothing leaked", /0 suspensions, 0 audit rows, 0 DMs, 0 member notices/.test(flat));
  A("the unenforced part is stated plainly", /WHAT IS NOT ENFORCED/.test(flat) && /a community moderator could in principle suspend for something on the ice/.test(flat));
  A("no em dash or spaced hyphen", !/—/.test(rec) && !/ - /.test(rec));
}

console.log("\n— the rulebook");
{
  const content = R("src/live/part3_content.js");
  const rb = JSON.parse(content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1)).rulebook;
  const s7 = {};
  rb.chapters.find((c) => c.num === 7).sections.forEach((x) => (s7[x.id] = x.paragraphs));
  A("7.1 no longer limits community to warnings",
    !/may issue warnings and escalate anything heavier/.test(s7["7.1"][1]));
  A("...it may now suspend to the staff ceiling",
    /may issue warnings and suspensions up to the staff ceiling of Rule 7\.2/.test(s7["7.1"][1]));
  A("...and the principle is stated: a department rules on the conduct it sees",
    /A department rules on the conduct it sees/.test(s7["7.1"][1]) &&
    /the community department is not asked to decide a hit it never watched/.test(s7["7.1"][1]));
  A("7.2 still sets the staff ceiling at 10 games or 30 days",
    /League staff may impose suspensions of up to ten \(10\) games or thirty \(30\) days/.test(s7["7.2"][0]));
  A("...and the heavier sanctions are still the commissioner's",
    /are imposed only by a commissioner/.test(s7["7.2"][0]));
  A("7.2 now says the member is told when it is imposed",
    /A member is told of a sanction at the moment it is imposed, on the site and, where he has linked his Discord account, by direct message/.test(s7["7.2"][1]));
  A("...and that the appeal clock runs from that notice",
    /The appeal window of Rule 7\.6 runs from that notice/.test(s7["7.2"][1]));
  A("7.6 still gives 48 hours", /forty-eight \(48\) hours/.test(s7["7.6"][0]));
  A("the changelog records it", rb.changelog.some((e) => e.version === "3.38"));
}

console.log(`\n${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
