/* v3.34 — forfeit news lives in #game-scores, and no forfeit path is silent.
 *
 * Commissioner, 2026-09-25: "you do not need to send a message about a team forfeiting a game in the
 * transactions chat. That can go in game scores instead."
 *
 * The behaviour is in Postgres, so this pins the record and the two client-side facts the change
 * depends on: that 'other' is not a displayed transaction type (so deleting the row loses nothing on
 * the site), and that the forfeit RPCs are still the ones the client calls.
 */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
function A(name, cond, got) {
  n++;
  if (cond) console.log("ok   " + name);
  else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  — got: " + String(got).slice(0, 200))); }
}
const rec = R("sql/2026-09-25-forfeit-news-in-game-scores.sql");
const flat = rec.replace(/\n--\s?/g, " ").replace(/\s+/g, " ");

console.log("\n— the record says why the message was wrong, not just that it moved");
{
  A("it quotes the instruction", /you do not need to send a message about a team forfeiting a game in the transactions chat/.test(flat));
  A("it names the single line that caused it", /insert into public\.transactions/.test(rec) && /notify_discord_transaction/.test(flat));
  A("...and that the post was a DUPLICATE, not the only one", /announced twice, once in the right channel and once in the wrong one/.test(flat));
  A("the row is deleted rather than re-routed, with a reason", /a forfeit is a game result, not a transaction/.test(flat));
  A("...and the ruling still has a home", /log_admin_action\('forfeit_declared'\)/.test(flat));
}

console.log("\n— all four paths were asked the same question");
{
  ["declare_forfeit", "undo_forfeit", "forfeit_game", "unforfeit_game", "forfeit_abandoned_game"].forEach(function (f) {
    A("the routing table covers " + f, new RegExp(f).test(flat));
  });
  A("it states the real finding: two reversals were announced nowhere",
    /TWO REVERSALS WERE ANNOUNCED NOWHERE/.test(flat));
  A("...and why the trigger could never have caught them",
    /Both reversals return the game to 'scheduled', so neither branch runs/.test(flat));
  A("...and why the Rule 4.3 lane was silent for a DIFFERENT reason",
    /never touches the status or the score/.test(flat));
  A("a Discord outage cannot fail a ruling", /begin\/exception block and pings nobody/.test(flat));
}

console.log("\n— the rehearsals asserted on the queue, not on the code");
{
  A("it names the queue table", /net\.http_request_queue is a plain table/.test(flat));
  A("it counted posts per webhook url", /counted rows in it per webhook url rather than trusting the function text/.test(flat));
  A("the real game was re-checked OUTSIDE the transaction",
    /re-checked outside the transaction/.test(flat) && /still final 3-4 with no forfeit stamped/.test(flat));
  /* The quoted Discord samples are verbatim, and the #game-scores channel's own format has used an
     em dash separator since notify_discord_game_final was written. Those lines are excluded; the
     prose around them is held to the standing rule. */
  const prose = rec.split("\n").filter((l) => !/\u{1F3D2}/u.test(l)).join("\n");
  A("no em dash or spaced hyphen in the prose", !/—/.test(prose) && !/ - /.test(prose),
    (prose.match(/.{0,40}(—| - ).{0,40}/) || [])[0]);
  A("...and the samples are quoted verbatim, dash and all", /\u{1F3D2} \*\*Reversed\*\* —/u.test(rec));
}

console.log("\n— the two client facts the change leans on");
{
  const pub = R("src/live/part5a_public.js");
  const m = pub.match(/CG\.TX_MOVE_TYPES = \[([^\]]*)\]/);
  A("CG.TX_MOVE_TYPES still exists", !!m);
  A("...and is still a whitelist that excludes 'other', so the deleted row showed nothing on the site",
    !!m && !/["']other["']/.test(m[1]), m && m[1]);
  A("the record cites that whitelist as the reason", /CG\.TX_MOVE_TYPES/.test(flat) && /WHITELIST/.test(flat));

  const live = R("src/live/part_live.js"), desks = R("src/live/part9_staffdesks.js"), ing = R("netlify/functions/ingest-stats.js");
  A("the officiating desk still declares through declare_forfeit", /rpc\("declare_forfeit"/.test(live));
  A("...and reverses through undo_forfeit", /rpc\("undo_forfeit"/.test(desks));
  A("the club stats desk still uses forfeit_game / unforfeit_game",
    /rpc\("forfeit_game"/.test(live) && /rpc\("unforfeit_game"/.test(live));
  A("the importer still uses forfeit_abandoned_game", /"forfeit_abandoned_game"/.test(ing));
}

console.log("\n— the rulebook was checked, and says nothing that had to change");
{
  const content = R("src/live/part3_content.js");
  const rb = JSON.parse(content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1)).rulebook;
  const secs = {};
  rb.chapters.forEach((c) => c.sections.forEach((s) => (secs[s.id] = s.paragraphs.join(" "))));
  A("Rule 6.1 still makes the transaction log part of the official record",
    /transaction log constitute the official record/.test(secs["6.1"]));
  A("...and no rule claims a forfeit is posted to it",
    !/forfeit[^.]{0,80}transaction log/i.test(Object.values(secs).join(" ")));
  A("Rule 3.2 still says nothing about where a forfeit is announced",
    !/transaction/i.test(secs["3.2"] || ""));
  A("the record says it checked", /Nothing in the rulebook had to change/.test(flat));
  A("the changelog records it", rb.changelog.some((e) => e.version === "3.34"));
}

console.log("\n— the same day's box score rulings are on the record");
{
  const box = R("sql/2026-09-25-easy-pickins-exception-and-box-links.sql");
  const bf = box.replace(/\n--\s?/g, " ").replace(/\s+/g, " ");
  A("the out-of-position exception quotes the instruction",
    /you can forget that as we made a 1 time exception for that/.test(bf));
  A("...and records that it was a TRUE positive matched on the persona id",
    /persona id 1005173977114 is recorded on his profile and that is what matched/.test(bf));
  A("...and the durability rehearsal deleted the finding row to make the test mean something",
    /the out_of_position row was DELETED so the clear was the only thing left standing/.test(bf));
  A("...and explains why no rulebook clause had to be invented",
    /AS THE CASE REQUIRES/.test(bf) && /already in the book/.test(bf));
  A("all three links name the key each matched on",
    /ea_id \(byte identical\)/.test(bf) && /platform_gamertag \(PS5\)/.test(bf));
  A("...and the four-way check is stated", /EXACTLY ONE candidate/.test(bf));
  A("the one remaining unknown is still named", /vDarkiee___/.test(bf));
  A("the stale EA IDs are flagged for the commissioner",
    /Greenegg3 on file and plays as N0Tsurprised/.test(bf) && /2tonechevy96 on file and plays as foodude56/.test(bf));
  A("no em dash or spaced hyphen", !/—/.test(box) && !/ - /.test(box));
}

console.log(`\n${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
