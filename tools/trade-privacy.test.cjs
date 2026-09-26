/* v3.35 — only a completed trade is public.
 *
 * Commissioner, 2026-09-26: "dont show trade offers edits or declines publicly. Only show accepted
 * trades."
 *
 * The behaviour is in Postgres, so this pins the record, the published rule, and the client facts the
 * change depends on: that every site surface reading a trade is gated to the viewer's own club or to
 * staff, so the club Discord room really was the only public exposure.
 */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
function A(name, cond, got) {
  n++;
  if (cond) console.log("ok   " + name);
  else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  — got: " + String(got).slice(0, 220))); }
}
const rec = R("sql/2026-09-26-only-completed-trades-are-public.sql");
const flat = rec.replace(/\n--\s?/g, " ").replace(/\s+/g, " ");

console.log("\n— the record names the leak precisely");
{
  A("it quotes the instruction", /dont show trade offers edits or declines publicly\. Only show accepted trades/.test(flat));
  A("it says the site half was always private and the Discord half never was",
    /THE SITE HALF WAS ALWAYS PRIVATE\. The Discord half never was/.test(flat));
  A("...and why: one channel and one role, both the whole club",
    /both are the WHOLE CLUB, not its front office/.test(flat));
  A("the named casualty is on the record", /posted where invisty reads it/.test(flat));
  A("the count of what already went out is recorded", /46 posts about trades that never completed/.test(flat));
}

console.log("\n— it proves what was already right instead of assuming");
{
  A("RLS on trades is quoted", /is_gm_of\(from_team_id\) or is_gm_of\(to_team_id\) or is_commissioner\(\)/.test(flat));
  A("...and the transactions department exception", /has_department\('transactions'\)/.test(flat));
  A("no definer reader exposes trades", /No SECURITY DEFINER reader exposes trades/.test(flat));
  A("the unfiltered client read is accounted for",
    /CG\.loadTrades, which has NO status filter but feeds only CG\.incomingOffers and CG\.outgoingOffers/.test(flat));
  A("the public transaction log is accounted for",
    /written for a trade by accept_trade and reverse_trade ONLY/.test(flat));
  A("news is accounted for", /Nothing writes a news item for a trade/.test(flat));
}

console.log("\n— the change, including what stays public");
{
  A("p_room is the mechanism", /club_notify gains p_room boolean default true/.test(flat));
  A("the overload trap is recorded again", /a new defaulted argument makes an OVERLOAD/.test(flat));
  A("...and the assertion that catches it", /signature count is asserted to be exactly 1/.test(flat));
  A("accepted keeps both room posts", /'accepted' keeps both room posts/.test(flat));
  A("reversed keeps them too, with a reason", /a reversal moves real players back onto real rosters/.test(flat));
  A("the DM replaces the room for the RECEIVING club only",
    /The\s+SENDING club gets no DM/.test(flat) && /discord_dms/.test(flat));
  A("a seat with no Discord cannot break an offer", /must never break the offer/.test(flat));
}

console.log("\n— the rehearsal established a baseline first");
{
  A("the leak was reproduced, not inferred",
    /to prove the leak rather than infer it/.test(flat) && /under the OLD code wrote 2 club_notices rows/.test(flat));
  A("every status was asserted", /proposed\s+0 new club_notices/.test(flat) && /accepted\s+2 new club_notices/.test(flat));
  A("the already-posted messages are flagged, not silently deleted",
    /left for the commissioner to ask for/.test(flat));
  A("the trade block is explicitly out of scope", /a trade block exists to be advertised/.test(flat));
  A("no em dash or spaced hyphen", !/—/.test(rec) && !/ - /.test(rec));
}

console.log("\n— the client gates the record relies on are still there");
{
  const live = R("src/live/part_live.js"), desks = R("src/live/part9_staffdesks.js");
  A("Team HQ's incoming offers are gated on the viewer's own managed club",
    /CG\.incomingOffers = function\(\)\{\s*\n?\s*var t = CG\.myManagedTeam\(\); if \(!t\) return \[\];/.test(live));
  A("...and so are the outgoing ones",
    /CG\.outgoingOffers = function\(\)\{\s*\n?\s*var t = CG\.myManagedTeam\(\); if \(!t\) return \[\];/.test(live));
  A("the only other read of every status is the staff desk", /from\("trades"\)\.select\("\*"\)/.test(desks));
  A("CG._trades is rendered nowhere else",
    live.split("CG._trades").length - 1 <= 4, live.split("CG._trades").length - 1);
}

console.log("\n— the published rule says it");
{
  const content = R("src/live/part3_content.js");
  const rb = JSON.parse(content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1)).rulebook;
  const r23 = rb.chapters.find((c) => c.num === 2).sections.find((s) => s.id === "2.3").paragraphs;
  A("Rule 2.3 makes an offer private to the two front offices",
    /An offer is private to the two clubs' front offices/.test(r23[0]));
  A("...and names every stage it covers",
    /A proposal, a counter, a withdrawal and a declined offer are seen only by the Owner, General Manager and Assistant General Manager of the two clubs and by the league office/.test(r23[0]));
  A("...and rules out all three places it used to appear",
    /none of them is posted to the transaction log, announced in a club's room, or shown to the players named in it/.test(r23[0]));
  A("...and states the positive rule", /Only a completed trade is published/.test(r23[0]));
  A("acceptance still publishes to the transaction log",
    /it is posted to the official transaction log automatically/.test(r23[0]));
  A("a reversal is still communicated to both clubs", /is communicated to both clubs with the department's reasons/.test(r23[2]));
  A("the player's own trade request is still front-office only",
    /and to nobody else/.test(r23[3]));
  A("the changelog records it", rb.changelog.some((e) => e.version === "3.35"));
}

console.log(`\n${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
