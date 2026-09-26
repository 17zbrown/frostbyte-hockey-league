/* v3.43 — a traded player comes off the trade block. */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
function A(name, cond, got) {
  n++;
  if (cond) console.log("ok   " + name);
  else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  — got: " + String(got).slice(0, 220))); }
}
const rec = R("sql/2026-09-26-trade-clears-the-block.sql");
const flat = rec.replace(/\n--\s?/g, " ").replace(/\s+/g, " ");
const rb = (function(){ const c = R("src/live/part3_content.js"); return JSON.parse(c.slice(c.indexOf("{"), c.lastIndexOf("}") + 1)).rulebook; })();
const r23 = rb.chapters.find((c) => c.num === 2).sections.find((s) => s.id === "2.3").paragraphs;

console.log("\n— the record states the bug and the reasoning");
{
  A("it quotes the instruction", /if a player gets listed to a team's trade block, and gets traded, make sure you remove them from the trade block/.test(flat));
  A("it quotes the line that carried the flag", /update public\.roster_spots set team_id=p_team, jersey_number=coalesce\(v_num,jersey_number\)/.test(flat));
  A("the live casualty is named, with both timestamps", /EIGHTY-TWO SECONDS later/.test(flat) && /Kaz Kanada/.test(flat));
  A("the principle is written down", /a listing is ONE CLUB'S statement that IT will hear offers on ITS player/.test(flat));
  A("...and why it cannot outlive the move",
    /The club that made it no longer holds him; the club that now holds him never made it/.test(flat));
}

console.log("\n— it goes on the trigger, not in the trade");
{
  A("it names the trigger it joined", /public\.reset_squad_on_team_change\(\), the BEFORE UPDATE OF team_id trigger/.test(flat));
  A("...and why not accept_trade or move_player",
    /Not in accept_trade and not in move_player: on the trigger, so every path that moves a player between clubs is covered/.test(flat));
  A("the existing behaviour it sits beside is explained", /squad to 'pro', squad_moves to 0/.test(flat));
}

console.log("\n— the channel is not told, and why");
{
  A("the post it would have made is quoted", /SEA have taken Kaz Kanada off the trade block/.test(flat));
  A("...and why that would be wrong", /under the name of a club that never listed him/.test(flat));
  A("the mgr_sync escape is recorded", /app\.mgr_sync/.test(flat) && /let the Kaz Kanada cleanup run silently/.test(flat));
  A("the club-room notifier is accounted for", /notify_squad_or_block already had the team-change guard/.test(flat));
}

console.log("\n— the rehearsal covered both directions");
{
  A("it names all five checks", /1\. after move_player he is on the new club and NOT on the block/.test(flat) &&
    /5\. and taking him off again still posts/.test(flat));
  A("...and that an ordinary listing must still announce", /4\. an ordinary listing, no club change, still posts/.test(flat));
  A("it counted the queue rather than reading the code", /Counting rows in net\.http_request_queue per webhook url/.test(flat));
}

console.log("\n— the row left alone");
{
  A("Toine is named as deliberately untouched", /Toine is on Seattle's block/.test(flat));
  A("...with every avenue that was tried", /v2\.72/.test(flat) && /team_mgmt_moves has nothing/.test(flat) && /pg_net clears delivered rows/.test(flat));
  A("...and the reason for leaving it", /Clearing a listing Seattle may have made is a worse error than leaving one it did not/.test(flat));
  A("the stale Discord post is flagged, not deleted", /Deleting a Discord message is an outward-facing act and was not done unasked/.test(flat));
  A("no em dash or spaced hyphen", !/—/.test(rec.replace(/✅/g, "")) && !/ - /.test(rec));
}

console.log("\n— the rule");
{
  A("2.3 says a listing ends when the player leaves",
    /A listing ends the moment the player leaves the club, by trade or by any other means/.test(r23[4]));
  A("...with the reasoning in the book too",
    /it is one club's statement that it will hear offers on its own player/.test(r23[4]));
  A("...and what an acquiring club must do instead",
    /A club that wants a player it has acquired on the block lists him itself/.test(r23[4]));
  A("the rest of the trade-block paragraph survived", /A club may list any of its players on the league's trade block/.test(r23[4]));
  A("the changelog records it", rb.changelog.some((e) => e.version === "3.43"));
}

console.log(`\n${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
