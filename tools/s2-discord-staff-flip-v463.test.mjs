// v463 (FLIP): the Discord half of the Season 2 staffing model. Run: node tools/s2-discord-staff-flip-v463.test.mjs
//
// Commissioner, 2026-10-19 and 2026-11-23 (memory s2-staffing-model.md): no departments; "every staffer wears the plain
// Staff role (Media and the department roles go); only committee managers also wear their committee manager role"; "There
// should be a staff notifications channel in the discord which is where all the automated notifications should go that
// the bot sends out for staff." The switch is ONE app_config key, staff_model (shared/roles.mjs committeesLive), set by
// sql/2026-11-24-s2-discord-staff-model-v463.sql after the staff powers record. Absent = today's department model, byte
// for byte; that is what lets this ship ahead of the flip. The daily vote nudge needs no key: it asks the database
// (is_app_reviewer). Supabase and Discord are stubbed throughout; nothing is sent.
process.env.SUPABASE_URL ||= "https://sb.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "k";
process.env.DISCORD_BOT_TOKEN ||= "t";
process.env.DISCORD_GUILD_ID ||= "guild1";

import fs from "node:fs";
import { desiredRolesFor, managedRoleIds, committeesLive, committeeRoleName, STAFF_MODEL_KEY, STAFF_DEPARTMENTS } from "../shared/roles.mjs";
import { createRoleSyncer } from "../bot/role-sync.mjs";
import { route, createStaffAlerter } from "../bot/staff-alerts.mjs";

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };
const J = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
const set = (s) => [...s].sort().join(",");
const R = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");

/* the six committees as public.committees holds them (2026-11-24) */
const COMMITTEES = [["officiating", "Officiating"], ["statistics", "Statistics and imports"], ["applications", "Applications"],
  ["community", "Community"], ["transactions", "Transactions"], ["draft", "Draft and Bidding"]]
  .map(([key, name], i) => ({ key, name, sort: i + 1, manager_profile_id: null }));

console.log("— the switch");
A("absent and 'departments' are Season 1's model", committeesLive(undefined) === false && committeesLive("") === false && committeesLive("departments") === false);
A("'committees' is Season 2's", committeesLive("committees") === true && committeesLive(" committees ") === true);
let threw = false; try { committeesLive("committee"); } catch (e) { threw = /staff_model/.test(e.message); }
A("anything else throws, naming the key, so no lane acts on a typo", threw);
A("the key is staff_model", STAFF_MODEL_KEY === "staff_model");
A("committee roles are named for the committee rows",
  COMMITTEES.map((c) => committeeRoleName(c.name)).join("|") ===
  "Officiating Manager|Statistics and imports Manager|Applications Manager|Community Manager|Transactions Manager|Draft and Bidding Manager");

/* ---------------- the rule ---------------- */
const roleId = { staff: "R_STAFF", commissioner: "R_COMM", player: "R_PLAYER",
  "review board": "R_DEPT_APPS", officials: "R_DEPT_OFF", media: "R_DEPT_MEDIA",
  "officiating manager": "R_CM_OFF", "draft and bidding manager": "R_CM_DRAFT" };
const base = { roleId, teamRoleId: {}, registered: new Set(), regOpen: false, mgmtRoleByProfile: {}, posOf: {} };
const want = (m, over) => desiredRolesFor(m, { ...base, ...over });
const staff = (pid = "p1") => ({ profile_id: pid, role: "staff", team_id: null });

console.log("\n— before the flip (no key): exactly today's roles");
A("a staffer wears Staff and their department roles",
  set(want(staff(), { deptByProfile: { p1: ["officiating", "applications"] } })) === "R_DEPT_APPS,R_DEPT_OFF,R_STAFF");
A("a Media-only staffer wears Media and not Staff", set(want(staff(), { deptByProfile: { p1: ["media"] } })) === "R_DEPT_MEDIA");
A("a seat in a committee grants nothing yet",
  set(want(staff(), { deptByProfile: { p1: ["officiating"] }, committeeSeats: { p1: ["Officiating"] } })) === "R_DEPT_OFF,R_STAFF");

console.log("\n— after the flip (staff_model = committees)");
const flip = { committees: true };
A("a staffer wears Staff and no department role",
  set(want(staff(), { ...flip, deptByProfile: { p1: ["officiating", "applications"] } })) === "R_STAFF");
A("a Season 1 Media-only staffer now wears Staff (the exception read departments)",
  set(want(staff(), { ...flip, deptByProfile: { p1: ["media"] } })) === "R_STAFF");
A("a commissioner wears Commissioner and Staff", set(want({ profile_id: "k1", role: "commissioner", team_id: null }, { ...flip, deptByProfile: { k1: ["applications"] } })) === "R_COMM,R_STAFF");
A("a seated committee manager also wears that committee's role",
  set(want(staff(), { ...flip, deptByProfile: {}, committeeSeats: { p1: ["Officiating", "Draft and Bidding"] } })) === "R_CM_DRAFT,R_CM_OFF,R_STAFF");
A("a seat held by someone off the staff grants nothing (the seat's power needs the staff role)",
  want({ profile_id: "p1", role: "member", team_id: null }, { ...flip, deptByProfile: {}, committeeSeats: { p1: ["Officiating"] } }).size === 0);
const managed = managedRoleIds(roleId, [], COMMITTEES);
A("department roles stay managed, so the flip takes them off everyone (unassigned, never deleted)",
  ["R_DEPT_APPS", "R_DEPT_OFF", "R_DEPT_MEDIA"].every((r) => managed.has(r)));
A("committee roles are managed in both models, so a rollback takes them off too", managed.has("R_CM_OFF") && managed.has("R_CM_DRAFT"));
A("without the committee list nothing new is managed (callers that pass none are unchanged)", !managedRoleIds(roleId, []).has("R_CM_OFF"));

/* ---------------- the bot's instant role sync ---------------- */
const GUILD_ROLES = [["Staff", "R_STAFF"], ["Officials", "R_DEPT_OFF"], ["Media", "R_DEPT_MEDIA"], ["Officiating Manager", "R_CM_OFF"]]
  .map(([name, id]) => ({ id, name }));
let W, patches;
function resetBot() {
  W = { model: [], profile: { id: "p1", role: "staff", departments: ["officiating"], banned: false },
        committees: COMMITTEES.map((c) => ({ ...c })), roles: ["R_BOOSTER", "R_STAFF", "R_DEPT_OFF"] };
  patches = [];
}
globalThis.fetch = async (url, opts = {}) => {
  const u = decodeURIComponent(String(url)), m = opts.method || "GET";
  if (u.includes("/guilds/") && u.endsWith("/roles")) return J(GUILD_ROLES);
  if (u.includes("/guilds/") && u.includes("/members/")) {
    if (m === "GET") return J({ user: { id: "d1" }, roles: W.roles });
    if (m === "PATCH") { const b = JSON.parse(opts.body); patches.push(b.roles); W.roles = b.roles; return J({}); }
  }
  if (u.includes("app_config?key=eq.staff_model")) return J(W.model);
  if (u.includes("/rest/v1/committees")) return J(W.committees);
  if (u.includes("/rest/v1/discord_links")) return J([{ profile_id: "p1", role: W.profile.role, discord_id: "d1", team_id: null }]);
  if (u.includes("/rest/v1/profiles")) return J([W.profile]);
  if (u.includes("/rest/v1/seasons")) return J([{ id: "S2", number: 2, status: "upcoming", registration_open: false }]);
  return J([]);
};
const ENV = { SB_URL: "https://sb.invalid", SB_KEY: "k", BOT: "t", GUILD: "g1" };
console.log("\n— the bot follows the same switch");
{
  resetBot();
  const S = createRoleSyncer(ENV, { debounceMs: 1, retryDelaysMs: [] });
  A("no key: a converged staffer costs nothing", (await S.syncProfile("p1", "t")) === "no-op" && patches.length === 0);

  resetBot(); W.model = [{ value: "committees" }]; W.committees[0].manager_profile_id = "p1";
  const S2 = createRoleSyncer(ENV, { debounceMs: 1, retryDelaysMs: [] });
  const r = await S2.syncProfile("p1", "t");
  A("committees: the department role comes off and the seat's role goes on, in one write",
    r === "patched" && patches.length === 1 && set(new Set(patches[0])) === "R_BOOSTER,R_CM_OFF,R_STAFF", JSON.stringify(patches));

  resetBot(); W.model = [{ value: "committees" }]; W.profile.departments = ["media"]; W.roles = ["R_DEPT_MEDIA"];
  const S3 = createRoleSyncer(ENV, { debounceMs: 1, retryDelaysMs: [] });
  await S3.syncProfile("p1", "t");
  A("committees: a Media-only staffer swaps Media for Staff", patches.length === 1 && set(new Set(patches[0])) === "R_STAFF", JSON.stringify(patches));

  resetBot(); W.model = [{ value: "commitees" }];
  const S4 = createRoleSyncer(ENV, { debounceMs: 1, retryDelaysMs: [] });
  A("a mistyped key fails the sync and writes nothing", (await S4.syncProfile("p1", "t")) === "error" && patches.length === 0 && /staff_model/.test(S4.sum.lastError || ""), S4.sum.lastError);
}

/* ---------------- the sweep ---------------- */
const sweepSrc = R("jobs/discord-sync.js");
console.log("\n— the sweep follows the same switch");
A("it reads the key and the committee rows with the role inputs, and a failed read leaves roles untouched",
  /const sm = await sbGet\(`app_config\?key=eq\.\$\{STAFF_MODEL_KEY\}&select=value`\);\n\s+const on = committeesLive\(sm\[0\] && sm\[0\]\.value\);\n\s+committees = await sbGet\("committees\?select=key,name,manager_profile_id&order=sort\.asc"\);/.test(sweepSrc)
  && /\} catch \(e\) \{ committees = \[\]; inputsOk = false; inputsErr\.push\("staff model: "/.test(sweepSrc));
A("department roles and rooms are built only under the department model (an unknown model builds nothing)",
  /if \(committeesOn === false\) try \{ await ensureStaffDepartments\(/.test(sweepSrc) && !/\n  try \{ await ensureStaffDepartments\(/.test(sweepSrc));
A("committee roles are built only under the committee model, through the one role-creation loop (ENSURE_ROLES: mentionable, born with rolePermissionsAtBirth)",
  /if \(committeesOn === true\) for \(const c of committees\) ENSURE_ROLES\.push\(\[committeeRoleName\(c\.name\), true\]\);\n  for \(const \[name, mentionable\] of ENSURE_ROLES\) \{/.test(sweepSrc)
  && /const created = await dApi\("POST", `\/guilds\/\$\{GUILD\}\/roles`, \{ name, mentionable, permissions: rolePermissionsAtBirth\(name, guildRoles\) \}\);/.test(sweepSrc));
A("the member pass manages the committee roles", /const managedIds = managedRoleIds\(roleId, teams, committees\);/.test(sweepSrc));
A("the member pass hands the model and the seats to the shared rule", /committees: committeesOn === true, committeeSeats \}\);/.test(sweepSrc));
A("the bot reads the same key and the same committee rows", /sbGet\(`app_config\?key=eq\.\$\{STAFF_MODEL_KEY\}&select=value`\)/.test(R("bot/role-sync.mjs"))
  && /sbGet\("committees\?select=key,name,manager_profile_id&order=sort\.asc"\)/.test(R("bot/role-sync.mjs")));
/* ---------------- the bot's staff alerts ---------------- */
console.log("\n— staff alerts: one channel after the flip");
A("before the flip: an owner application still goes to the applications room", route("owner_applications", { id: "o1" }).dept === "applications" && !route("owner_applications", { id: "o1" }).one);
A("after it: the one staff channel, claimed under the same key", route("owner_applications", { id: "o1" }, {}, true).one === true && route("owner_applications", { id: "o1" }, {}, true).dept === "applications");
A("...a staff application names no department", route("staff_applications", { id: "s1", departments: ["media"] }, { gamertag: "Frosty" }, true).line === "**Frosty** applied to join the league staff.");
A("...a front-office nomination too", route("management_applications", { id: "m1", role: "gm" }, {}, true).one === true);
A("...a complaint is left to the database's own post in that channel", /notify_action_request/.test(route("action_requests", { id: "c1", type: "complaint" }, {}, true).suppressed || ""));
A("...so is an appeal", /notify_action_request/.test(route("action_requests", { id: "c1", type: "appeal", subject: "x" }, {}, true).suppressed || ""));
A("...and a staff vote, whatever its departments", /staff_vote_create/.test(route("staff_votes", { id: "v1", departments: ["officiating", "media"] }, {}, true).suppressed || ""));
A("...a trade request still never leaves the club", route("action_requests", { id: "c2", type: "trade_request" }, {}, true) === null);

let AL;
function resetAlerts(model) { AL = { model, claimed: [], claimStatus: 201, released: [], rpc: [], rpcStatus: 204, chanPosts: [] }; }
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url), m = opts.method || "GET";
  if (u.includes("app_config?key=in.")) {
    const rows = [{ key: "discord_dept_channel_ids", value: JSON.stringify({ applications: "ch-apps", officiating: "ch-off" }) },
      { key: "discord_dept_role_ids", value: JSON.stringify({ applications: "r-apps", officiating: "r-off" }) }];
    if (AL.model) rows.push({ key: "staff_model", value: AL.model });
    return J(rows);
  }
  if (u.includes("/rest/v1/profiles")) return J([{ gamertag: "Frosty" }]);
  if (u.includes("/rest/v1/rpc/notify_staff_ch")) { AL.rpc.push(JSON.parse(opts.body)); return new Response(AL.rpcStatus === 204 ? null : "{}", { status: AL.rpcStatus }); }
  if (u.includes("/rest/v1/discord_post_log")) {
    if (m === "POST") { if (AL.claimStatus === 201) AL.claimed.push(JSON.parse(opts.body).ref); return new Response("", { status: AL.claimStatus }); }
    if (m === "DELETE") { AL.released.push(decodeURIComponent(u.split("ref=eq.")[1] || "")); return new Response(null, { status: 204 }); }
  }
  if (/channels\/[\w-]+\/messages/.test(u)) { AL.chanPosts.push(u); return J({ id: "msg1" }); }
  return J([]);
};
const AENV = { SB_URL: "https://sb.invalid", SB_KEY: "k", BOT: "tok" };
{
  resetAlerts("committees");
  const D = createStaffAlerter(AENV);
  const r = await D.announce("owner_applications", { id: "o1", profile_id: "p9" });
  A("an owner application is announced once, through notify_staff_ch, tagging the Staff role",
    r === "announced" && AL.rpc.length === 1 && JSON.stringify(AL.rpc[0]) === JSON.stringify({ p_channel: "casework",
      p_content: "\u{1F4E5} **Owner application** · **Frosty** applied to own a club. Every staff member and commissioner votes on it. Open the Staff Desk: https://chelgamingleague.com/#/hub/staffdesk",
      p_ping: true }), JSON.stringify(AL.rpc));
  A("...never into a department room", AL.chanPosts.length === 0);
  A("...under the claim the department model used", AL.claimed.join() === "owner_applications:o1:applications");

  resetAlerts("committees"); AL.claimStatus = 409;
  A("an application announced in #review-board just before the flip is not announced again", (await createStaffAlerter(AENV).announce("owner_applications", { id: "o1" })) === "no-op" && AL.rpc.length === 0);

  resetAlerts("committees");
  const c = await createStaffAlerter(AENV).announce("action_requests", { id: "c1", type: "complaint", subject: "Lag" });
  A("a complaint posts nothing from the bot (the database already did)", /^suppressed:/.test(c) && AL.rpc.length === 0 && AL.chanPosts.length === 0 && AL.claimed.length === 0);
  const v = await createStaffAlerter(AENV).announce("staff_votes", { id: "v1", title: "x", departments: ["officiating"] });
  A("a staff vote posts nothing from the bot", /^suppressed:/.test(v) && AL.rpc.length === 0 && AL.chanPosts.length === 0);

  resetAlerts("committees"); AL.rpcStatus = 400;
  await createStaffAlerter(AENV).announce("staff_applications", { id: "s1" });
  A("a refused call (4xx: nothing queued) hands the claim back for the catch-up", AL.released.join() === "staff_applications:s1:applications");
  resetAlerts("committees"); AL.rpcStatus = 503;
  const D5 = createStaffAlerter(AENV);
  await D5.announce("staff_applications", { id: "s1" });
  A("an unknown outcome (5xx) keeps the claim, so it is never sent twice", AL.released.length === 0 && D5.sum.unconfirmed === 1);

  resetAlerts(null);
  const d = await createStaffAlerter(AENV).announce("owner_applications", { id: "o1" });
  A("no key: the department room exactly as before, and no database post", d === "announced" && AL.chanPosts.length === 1 && /ch-apps/.test(AL.chanPosts[0]) && AL.rpc.length === 0);
  resetAlerts("bogus");
  const b = await createStaffAlerter(AENV).announce("owner_applications", { id: "o1" });
  A("a mistyped key announces nothing anywhere", b === "error" && AL.rpc.length === 0 && AL.chanPosts.length === 0 && AL.claimed.length === 0);
}

/* ---------------- the daily vote nudge asks the database ---------------- */
console.log("\n— the vote nudge's electorate is the database's (no key needed)");
{
  const prev = globalThis.fetch;
  const asked = [];
  let reviewerSet = new Set(["p-rb", "p-k"]), rpcFails = false;
  const past = new Date(Date.now() - 864e5).toISOString();
  globalThis.fetch = async (url, opts = {}) => {
    const u = decodeURIComponent(String(url)), m = opts.method || "GET";
    if (u.includes("/rest/v1/rpc/is_app_reviewer")) { const b = JSON.parse(opts.body); asked.push(b.p_uid); return rpcFails ? J({ message: "boom" }, 500) : J(reviewerSet.has(b.p_uid)); }
    if (u.includes("/rest/v1/seasons?select=id,number&status=eq.active")) return J([]);
    if (u.includes("/rest/v1/seasons?select=id,number&status=neq.complete")) return J([{ id: "S2", number: 2 }]);
    if (u.includes("/rest/v1/seasons?select=id,owner_app_deadline")) return J([{ id: "S2", owner_app_deadline: past }]);
    if (u.includes("/rest/v1/app_config?select=key,value")) return J([{ key: "discord_staff_casework_webhook", value: "https://hook.invalid/x" }, { key: "lineup_reminder_enabled", value: "off" }, { key: "availability_reminder_enabled", value: "off" }]);
    if (u.includes("/rest/v1/profiles?select=id,role,gamertag")) return J([
      { id: "p-rb", role: "staff", gamertag: "Reviewer" }, { id: "p-off", role: "staff", gamertag: "Official" },
      { id: "p-k", role: "commissioner", gamertag: "Comm" }, { id: "p-m", role: "member", gamertag: "Applicant" }]);
    if (u.includes("/rest/v1/discord_links")) return J([]);
    if (u.includes("/rest/v1/owner_applications")) return J([{ id: "o1", profile_id: "p-m", season_id: "S2", filed_at: past }]);
    if (u.includes("/rest/v1/application_ballots")) return J([]);
    if (u.includes("discord.com") || u.includes("hook.invalid")) throw new Error("the dry run must not post: " + u);
    return J([]);
  };
  const sched = await import(new URL("../jobs/discord-scheduler.js", import.meta.url).pathname);
  const res = await (await sched.default(new Request("https://x/.netlify/functions/discord-scheduler?run=casework&dry=1"))).json();
  const post = (res.casework && res.casework.would_post) || "";
  A("only staff and commissioners are asked, one call each", asked.slice().sort().join() === "p-k,p-off,p-rb", asked.join());
  A("the nudge chases exactly whom the database names", /still needs: \*\*Reviewer\*\* \*\*Comm\*\*/.test(post) && !/Official/.test(post), post);
  rpcFails = true; asked.length = 0;
  const bad = await (await sched.default(new Request("https://x/.netlify/functions/discord-scheduler?run=casework&dry=1"))).json();
  A("a failed answer fails the run loudly instead of chasing a guess", /is_app_reviewer -> 500/.test(bad.error || ""), JSON.stringify(bad).slice(0, 200));
  A("no department list is read for it any more", !/p\.departments\.includes\("applications"\)/.test(R("jobs/discord-scheduler.js")));
  globalThis.fetch = prev;
}

/* ---------------- the record ---------------- */
console.log("\n— the switch's record");
{
  const fwd = R("sql/2026-11-24-s2-discord-staff-model-v463.sql"), rev = R("sql/2026-11-24-s2-discord-staff-model-v463.reverse.sql");
  const reh = R("sql/2026-11-24-s2-discord-staff-model-v463.rehearsal.sql");
  A("forward sets staff_model to committees, and checks it", /values \('staff_model', 'committees', now\(\)\)/.test(fwd) && /is distinct from 'committees'/.test(fwd));
  A("...refusing to run before the staff powers record", /to_regprocedure\('public\.profile_has_department\(uuid,text\)'\) is null/.test(fwd) && /discord_staff_casework_webhook/.test(fwd));
  A("reverse removes it, and checks it", /delete from public\.app_config where key = 'staff_model';/.test(rev) && /still set/.test(rev));
  const body = fwd.slice(fwd.indexOf("do $pre$"));
  A("the rehearsal carries the record byte for byte and ends in an uncaught raise", reh.includes(body.trimEnd()) && /raise exception 'REHEARSAL OK/.test(reh) && !/exception when/.test(reh));
  A("the reverse in the rehearsal is byte for byte too", reh.includes(rev.slice(rev.indexOf("delete from")).trimEnd()));
  A("nothing in either record can post", !/net\.http|discord_http_post\(|perform public\.notify_|select public\.notify_/.test(fwd.replace(/^--.*$/gm, "") + rev.replace(/^--.*$/gm, "")));
}

console.log(ok ? "\nPASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
