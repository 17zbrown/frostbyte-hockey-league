/* v3.24 — one dashboard at a time.
 *
 * Commissioner, 2026-09-25: "Can you separate the different dashboards to make each one feel less
 * messy? If I click on 'My Hub' I shouldn't see the staff desk or team HQ. I should only see the
 * dashboard I choose from the 'dashboards' dropdown."
 */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
function A(name, cond, got) {
  n++;
  if (cond) console.log("ok   " + name);
  else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  — got: " + String(got).slice(0, 240))); }
}

/* run the REAL functions out of the built page, with a minimal CG around them. A reimplementation
   here would pass while the shipped sidebar is broken. */
const html = R("index.html");
const CG = {
  ic: (k, s) => "<i>" + k + "</i>", esc: (x) => String(x),
  role: () => "commish", LIVE_MODE: true,
  can: () => true, hasDept: () => true, managesClub: () => true,
  me: () => ({ id: "p1", team: "BOS" }),
  mediaOnlyStaff: () => false, hubStaffDesk: () => "", hubGameStats: () => "", hubDraftLive: () => "",
  hubClubRequests: () => "",
  STAFF_DESKS: [{ key: "newsroom", label: "Newsroom", dept: "media", icon: "doc" },
                { key: "statsmgr", label: "Stats manager", dept: "statistics", icon: "chart" }],
  WEEK8: { open: false }, availGet: () => true,
  incomingCount: () => 0, mgmtPendingCount: () => 0, unreadCount: () => 0,
  visibleComplaints: () => [],
};
global.location = { hash: "#/hub" };
for (const sym of ["CG.hubGroups = function(){", "CG.HUB_DASH_META = {", "CG._hubDashPick = null;",
                   "CG.hubDash = function(section){", "CG.HUB_DASH_LANDING = {",
                   "CG.hubDashHref = function(key){", "CG.hubNav = function(section){"]) {
  const i = html.indexOf(sym);
  if (i < 0) { console.log("FAIL missing " + sym); process.exit(1); }
}
const start = html.indexOf("CG.hubGroups = function(){");
const end = html.indexOf("CG.hubShell = function(section, inner){");
new Function("CG", "location", html.slice(start, end))(CG, global.location);
const tabStart = html.indexOf("CG.hubTabs = function(){");
new Function("CG", html.slice(tabStart, html.indexOf("CG.hubLabel = function()")))(CG);

const links = (h) => (h.match(/<a href="#\/hub[^"]*"/g) || []);
const labels = (h) => (h.match(/<\/i>([^<]+)/g) || []).map((x) => x.slice(4).trim());

console.log("\n— the sidebar shows ONE dashboard, and says which");
{
  const me = CG.hubNav(""), club = CG.hubNav("roster"), staff = CG.hubNav("staffdesk");
  A("My Hub is headed My Hub", /hs-group">My Hub</.test(me));
  A("Team HQ is headed Team HQ", /hs-group">Team HQ</.test(club));
  A("the staff sidebar is headed Staff", /hs-group">Staff</.test(staff));
  A("exactly one group heading per sidebar",
    [me, club, staff].every((h) => (h.match(/hs-group/g) || []).length === 1));

  A("My Hub carries no Team HQ tool", !labels(me).includes("Roster") && !labels(me).includes("Trade Hub"), labels(me).join(","));
  A("My Hub carries no staff tool", !labels(me).includes("Staff desk") && !labels(me).includes("Newsroom"), labels(me).join(","));
  A("Team HQ carries no personal tool", !labels(club).includes("Settings") && !labels(club).includes("Notifications"), labels(club).join(","));
  A("Team HQ carries no staff tool", !labels(club).includes("Staff desk"), labels(club).join(","));
  A("the staff sidebar carries neither", !labels(staff).includes("Settings") && !labels(staff).includes("Roster"), labels(staff).join(","));
  A("...and it does carry the desks", labels(staff).includes("Staff desk") && labels(staff).includes("Newsroom"));
}

console.log("\n— every link keeps you in the dashboard you are in");
{
  for (const [sec, dash] of [["", "me"], ["roster", "club"], ["staffdesk", "staff"]]) {
    const ls = links(CG.hubNav(sec)).filter((l) => !/hs-switch/.test(l));
    const nav = CG.hubNav(sec);
    const body = nav.slice(nav.indexOf("hs-group"));
    A(`every ${dash} entry carries ?dash=${dash}`,
      (body.match(/<a href="#\/hub[^"]*"/g) || []).every((l) => l.includes("?dash=" + dash)),
      (body.match(/<a href="#\/hub[^"]*"/g) || []).find((l) => !l.includes("?dash=" + dash)));
  }
}

console.log("\n— the switcher is the way out, and it is always there when there is somewhere to go");
{
  const me = CG.hubNav("");
  A("the switcher renders", /hs-switch/.test(me));
  A("...offering every dashboard the member has",
    /dash=me/.test(me) && /dash=club/.test(me) && /dash=staff/.test(me));
  A("...marking the current one", /class="on"[^>]*>|aria-current="page"/.test(me));
  /* a member with ONE hat has nowhere to switch to, and a switcher would be noise */
  const solo = Object.assign({}, CG, { role: () => "player", managesClub: () => false,
    can: (k) => k === "availability.submit" || k === "complaints.file", hasDept: () => false });
  new Function("CG", "location", html.slice(start, end))(solo, global.location);
  A("a member with one hat gets no switcher", !/hs-switch/.test(solo.hubNav("")), solo.hubNav("").slice(0, 120));
}

console.log("\n— which dashboard is showing");
{
  A("an explicit ?dash= wins", (global.location.hash = "#/hub/roster?dash=staff", CG.hubDash("roster")) === "staff");
  global.location.hash = "#/hub";
  A("a section that belongs to one dashboard picks it", CG.hubDash("roster") === "club");
  A("...and a staff section picks staff", CG.hubDash("staffdesk") === "staff");
  /* Availability is ONE page worn by two hats, so the remembered choice breaks the tie */
  CG._hubDashPick = "club";
  A("an ambiguous section follows the remembered choice", CG.hubDash("availability") === "club");
  CG._hubDashPick = "me";
  A("...either way", CG.hubDash("availability") === "me");
  CG._hubDashPick = null;
  A("a section in no group at all still resolves", ["me","club","staff"].includes(CG.hubDash("zzz")));
}

console.log("\n— each dashboard opens where it should, and never on a page the seat lacks");
{
  A("Team HQ opens on the roster", CG.hubDashHref("club") === "#/hub/roster?dash=club");
  A("the Staff Desk opens on the desk", CG.hubDashHref("staff") === "#/hub/staffdesk?dash=staff");
  A("My Hub opens on the dashboard", CG.hubDashHref("me") === "#/hub?dash=me");
  const withheld = Object.assign({}, CG, { can: (k) => k !== "roster.manage" });
  new Function("CG", "location", html.slice(start, end))(withheld, global.location);
  A("a club whose seat cannot manage the roster opens somewhere it CAN reach",
    withheld.hubDashHref("club") && withheld.hubDashHref("club") !== "#/hub/roster?dash=club",
    withheld.hubDashHref("club"));
  A("...and that page is really in its group",
    withheld.hubGroups().club.some((it) => withheld.hubDashHref("club").indexOf("/"+it[0]+"?") > -1));
}

console.log("\n— the Dashboards menu drives it");
{
  const tabs = CG.hubTabs();
  A("every hub tab carries a dash", tabs.filter((t) => t[1].indexOf("#/hub") === 0).every((t) => /\?dash=(me|club|staff)$/.test(t[1])),
    JSON.stringify(tabs));
  A("Control Center is its own route, not a hub dashboard",
    tabs.some((t) => t[0] === "Control Center" && t[1] === "#/admin"));
  A("Team HQ points at the roster again", tabs.some((t) => t[0] === "Team HQ" && t[1] === "#/hub/roster?dash=club"));
}

console.log("\n— the club side of Rule 2.3 now has a page");
{
  const live = R("src/live/part_live.js"), hub = R("src/live/part6_hub.js");
  A("Team HQ lists Player requests", /club\.push\(\["clubrequests","Player requests","flag"\]\)/.test(hub));
  A("...gated on a front-office permission", /CG\.can\("roster\.manage"\) && CG\.hubClubRequests/.test(hub));
  A("the page exists", /CG\.hubClubRequests = function\(\)\{/.test(live));
  A("...reading only this club's cases", /CG\.clubCases\(teamId\)/.test(live));
  A("...and the route refuses anyone else", /Player requests are a front-office tool/.test(live));
  A("it says the league office is not involved", /the league office does not receive them and does not rule on them \(Rule 2\.3\)/.test(live));
  A("...and that a club need not act", /You are under no obligation to act on one/.test(live));
}

console.log("\n— the record");
{
  const rec = R("sql/2026-09-25-hub-dashboards.sql");
  const flat = rec.replace(/\n--\s?/g, " ").replace(/\s+/g, " ");
  A("it quotes the instruction", /I should only see the dashboard I choose/.test(flat));
  A("it names what the sidebar used to do", /rendered ALL of them, always/.test(flat));
  A("it explains the ambiguous section", /Availability is ONE page worn by two hats/.test(flat));
  A("it explains why the landing page is a preference and not the first entry",
    /opening a front office on the availability grid/.test(flat));
  A("the club-side gap is recorded", /there was NO page that listed one/.test(flat));
  A("the hash-only reload trap is recorded", /does NOT reload the document/.test(flat));
  A("no em dash or spaced hyphen", !/—/.test(rec) && !/ - /.test(rec));
}

console.log(`\n${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
