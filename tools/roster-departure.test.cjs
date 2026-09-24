/* v3.11 — leaving the Discord costs a rostered player his spot, and his club is told first.
 *
 * Commissioner: "send a reminder to their team's channel and @cghl management that they left and
 * they have 24 hours to return or their signup is revoked and they are removed from the team so
 * the management can reach out themselves."
 *
 * The club is told rather than the player because the player CANNOT be told: Discord refuses a bot
 * DM to anyone who shares no server with it. The league's own record settles it — of 38 DMs ever
 * attempted, all 33 to members inside the guild delivered and all 5 to members who had left were
 * refused 403. This file holds what the repo owns: the wiring and the decision record.
 */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
function A(name, cond, got) {
  n++;
  if (cond) console.log("ok   " + name);
  else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  — got: " + String(got).slice(0, 220))); }
}
const sync = R("netlify/functions/discord-sync.js");
const notices = R("bot/club-notices.mjs");
const rec = R("sql/2026-09-24-roster-departure-notice.sql");
const flat = rec.replace(/\n--\s?/g, " ").replace(/\s+/g, " ");

console.log("\n— the sweep runs, and runs where a fresh in_guild is available");
{
  A("the scheduled sync calls it", /rpc\/sweep_roster_departures/.test(sync));
  A("...with the named grace window", /p_grace_hours: ROSTER_DEPARTURE_GRACE_HOURS/.test(sync));
  A("...which is 24 hours", /const ROSTER_DEPARTURE_GRACE_HOURS = 24;/.test(sync));
  /* compare the CALL SITES. An earlier version of this pin compared "removeDepartedSignups(sum)"
     against "sweep_roster_departures" and failed, because the first match for the latter is its
     mention in the comment beside the grace constant near the top of the file, not the rpc call. */
  A("...right after the census, like the sign-up sweep",
    sync.indexOf("await removeDepartedSignups(sum)") < sync.indexOf("rpc/sweep_roster_departures")
      && sync.indexOf("await removeDepartedSignups(sum)") > 0);
  A("a failure is reported, never swallowed", /sum\.errors\.push\(\{ rosterDepartures:/.test(sync));
  A("what it did is reported too", /sum\.rosterDepartures = acted\.map/.test(sync));
  A("the reason the club is told instead of the player is recorded in the code",
    /Discord refuses a bot DM to anyone who shares no server with it/.test(sync.replace(/\s+/g, " ")));
  A("...with the evidence, not just the claim", /proved 5 for 5/.test(sync.replace(/\s+/g, " ")));
  A("the clock is documented as running from the NOTICE",
    /Measured from the notice in his club's room, never from when the census saw him leave/.test(sync.replace(/\s+/g, " ")));
}

console.log("\n— a club notice can ping, and only when it is told to");
{
  A("the bot reads the column", /row\.ping_role_id/.test(notices));
  A("the role is named in the content", /content: `<@&\$\{ping\}>`/.test(notices));
  A("...AND allowed in allowed_mentions", /roles: \[ping\]/.test(notices));
  A("...because one without the other pings nobody",
    /content alone renders the mention but\s+Discord suppresses the notification/.test(notices.replace(/\s+/g, " ").replace(/ +/g, " ")) ||
    /content alone renders the mention but Discord suppresses the notification/.test(notices.replace(/\s+/g, " ")));
  A("a notice with no ping behaves exactly as before",
    /allowed_mentions: ping \? \{ parse: \[\], roles: \[ping\] \} : \{ parse: \[\] \}/.test(notices));
}

console.log("\n— the decision record");
{
  A("it quotes the instruction", /so the management can reach out themselves/.test(flat));
  A("it carries the delivery evidence", /33 to members still in the guild all delivered/.test(flat));
  A("it states the clock rule", /The window runs from notified_at/.test(flat));
  A("...and that the five get a fresh window rather than an instant removal",
    /get a fresh 24 hours from their notice/.test(flat));
  A("it names all three guards the delete had to answer",
    /trg_mgmt_gate_block/.test(flat) && /protect_manager_spot/.test(flat) && /guard_roster_waive/.test(flat));
  A("...and why the waive guard needed a bypass at all",
    /at the trade deadline it would have been refused/.test(flat));
  A("a front office seat is never removed automatically", /never removed automatically/i.test(flat));
  A("the delete fails loud", /THE DELETE FAILS LOUD/.test(flat));
  A("it records the overload trap that cost a transaction",
    /creates an OVERLOAD, not a replacement/.test(flat));
  A("...and what caught it", /count of club_notify = 1/.test(flat));
  A("it carries the end-to-end rehearsal", /5 notified \/ 0 removed \/ roster untouched/.test(flat));
  A("...and that the rollback was verified", /Rollback verified: 0 notices left behind/.test(flat));
}

console.log("\n— the published rulebook carries the new obligation");
{
  const obj = JSON.parse(R("src/live/part3_content.js").match(/\{[\s\S]*\}/)[0]);
  const s11 = obj.rulebook.chapters.flatMap((c) => c.sections || []).find((s) => s.id === "1.1");
  const all = s11.paragraphs.join(" ");
  A("1.1 no longer exempts rostered players", !/never touched by this rule/.test(all));
  A("...it says the club is told first", /A notice goes to the club's room naming the player and the deadline/.test(all));
  A("...and why the league cannot tell him itself",
    /Discord does not deliver a message from the league to a member who has left the server/.test(all));
  A("...names the window", /twenty four \(24\) hours from that notice/.test(all));
  A("...says the clock starts at the notice", /runs from the notice, not from the moment the league saw him go/.test(all));
  A("...says a rejoin cancels it", /If he rejoins, nothing happens/.test(all));
  A("...and protects a front office seat",
    /Owner, General Manager or Assistant General Manager\) is never removed automatically/.test(all));
  A("the changelog records 3.11", obj.rulebook.changelog.some((c) => c.version === "3.11"));
}

console.log("\n" + (fail ? "FAIL " + fail + " of " + n : "PASS " + n));
process.exit(fail ? 1 : 0);
