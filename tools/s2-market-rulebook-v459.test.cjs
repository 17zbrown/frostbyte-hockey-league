/* v4.59 (commissioner decision D2, 2026-11-23: until the switch to the new site, the current site's rulebook carries the
   Season 2 rules the database enforces). The v4.59 records make the database enforce four things, so the book says them:
   1. training camp pool requests are PER GAME (commissioner, 2026-11-24: "Can you do the requests per game instead of per
      night?"; 2026-11-23: "A team is allowed to play with up to 3 training camp players per night. The requirement is that
      at least half the game lineup should consist of players on the club."; 2026-11-24: management may ask informally in
      the training camp channel "but must request them via the site"): Rules S2.5, S2.7, 4.2 and 5.3;
   2. the lineup deadline (2026-11-24: "If a team does not set their initial lineup for that game before the deadline to set
      the lineups, that team forfeits the game."): Rules 3.2, 5.3 and S2.5;
   3. the Saturday bidding details (2026-11-02: "bids always start at 750k and can only be raised by 250k at a time. a team
      cannot place two bids in a row on the same player"; six games to be bid on; the cap and roster room counting the bids
      a club leads; 2026-11-23: the pause belongs to the Draft and Bidding manager or a commissioner): Rule S2.6;
   4. the six staff committees and their manager seats (2026-10-19 and 2026-11-23): Rule S2.8 (new).
   Held, so NOT written: the playoff series rule, the registered-group eligibility rule, the new suspension limits, the
   all-staff vote on owner, staff and front-office applications, and pool-request visibility.
   Pins each new phrase in the rendered book, the absence of the per-night wording it replaces, and the one UI sentence
   that said "for a night". Run: node tools/s2-market-rulebook-v459.test.cjs */
const fs = require("fs"), path = require("path"), vm = require("vm");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + String(got).slice(0, 240))); } };
const ROOT = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const ctx = { console }; ctx.CG = {}; vm.createContext(ctx);
vm.runInContext(R("src/live/part3_content.js"), ctx);
vm.runInContext(R("src/live/part5b_public2.js").match(/CG\.rulebookForFormat = function\(rb, fmt\)\{[\s\S]*?\n\};/)[0], ctx);
const CG = ctx.CG, rb = CG.CONTENT.rulebook;
const books = { basic: CG.rulebookForFormat(rb, "basic"), full: CG.rulebookForFormat(rb, "full") };
const bound = (book, id) => (book.chapters.filter((c) => !c.shelved).flatMap((c) => c.sections).find((s) => s.id === id) || { paragraphs: [] }).paragraphs.join(" ");
const raw = (id) => rb.chapters.flatMap((c) => c.sections || []).find((s) => s.id === id) || { paragraphs: [] };

const NEW = {
  "S2.5": [
    "A club's management may request a pool player to play one specific game for the club.",
    "The request is made on the site, for that one game, and the player accepts or declines it on the site.",
    "Management may ask pool players informally in the training camp channel of the league Discord, which is open only to league staff, club management and the training camp pool, whether they can play, but only a request made on the site counts.",
    "An accepted request covers that game alone and ends with it: the player takes no roster spot, signs no contract, and counts against neither the salary cap nor the roster limit.",
    "Several clubs may request the same player, and the player's first acceptance wins: a pool player plays for only one club a night, so once the player accepts a club's game, the other clubs' requests for that night close and no other club may request the player that night, while the same club may request the player for more of its games that night.",
    "A club may use at most three (3) different training camp pool players across a night, and no game lineup may include more than three (3), because at least half of every game lineup, three (3) of its six (6) players, must be the club's own rostered players; a lineup with four (4) or more pool players is refused.",
    "Requests and answers close at the night's lineup lock, thirty (30) minutes before the night's first scheduled puck drop, when the server picks of Rule 4.2 freeze, and a request not answered by then lapses.",
    "Until that lock, the club may withdraw a request or release a player who has accepted, and the player may withdraw their acceptance;",
    "A pool player who has accepted plays only in the game accepted, may play any position in it, and receives that game's lobby code by direct message, with no access to the club's room.",
    "A pool player's statistics count in full, including toward the six (6) games of Rule S2.6, and a pool player in a game they accepted is never treated as an unrostered player (Rules 4.2 and 5.3).",
    "No pool player plays in the playoffs (Rule S2.7).",
    "A club that has not set a full lineup of six (6) for a game by that game's lineup lock forfeits the game (Rule 3.2).",
  ],
  "S2.6": [
    "Only a pool player who has played at least six (6) games may be bid on.",
    "Any club may open the bidding on an eligible player at $750,000, and every bid after it raises the last by exactly $250,000.",
    "A club may not bid twice in a row on the same player: once it holds the top bid on a player, it may bid on that player again only after another club has raised it.",
    "Every bid starts a five-minute countdown, and a raise before it ends starts it again.",
    "The bidding is open, but the clubs bidding are not shown until the bidding on that player is over.",
    "No bidding opens on a new player after 10:00 PM; a countdown already running then runs to its end",
    "A club may bid only while it has an open roster spot and room under the salary cap for the bid, counting every player on whom it then holds the top bid, so that no bid may take a club over its roster limit or the salary cap;",
    "The manager of the Draft and Bidding committee (Rule S2.8), or a commissioner, may pause a bidding event and resume it: a pause freezes every countdown, each resumes with the time it had left, and the 10:00 PM close moves later by the length of the pause.",
    "Until a manager of Draft and Bidding is seated, only a commissioner may pause or resume a bidding event.",
    "after it, clubs use requests for single games only (Rule S2.5).",
  ],
  "S2.7": ["a game played from the training camp pool included"],
  "S2.8": [
    "Season 2 has six (6) staff committees: Officiating; Statistics and imports; Applications; Community; Transactions; and Draft and Bidding.",
    "Each committee has one committee manager, who prioritizes the committee's work and is the first point of contact for it.",
    "A committee manager holds no power beyond that of any other member of league staff, save the manager of Draft and Bidding, who, like a commissioner, may pause and resume a Saturday bidding event (Rule S2.6)",
    "A member of league staff may apply for a committee manager seat that is vacant.",
    "it is approved once more than half of all league staff and commissioners approve it",
  ],
  "3.2": ["For Season 2, a club that has not set a full lineup of six (6) for a game by that game's lineup lock, thirty (30) minutes before its scheduled puck drop (Rule 5.3), forfeits the game; if neither club has set one, the game is voided. The forfeit, or the void, is ruled once, at the lock, and a lineup filed after the lock does not undo it. This applies in every stage of the season, the playoffs included (Rule S2.5)."],
  "4.2": ["For Season 2, a training camp pool player who has accepted a club's request for a game also receives that game's code, at the same moment, by direct message (Rule S2.5)."],
  "5.3": [
    "For Season 2 the lineup lock is also the lineup deadline: a club that has not set a full lineup of six (6) for a game by its lock forfeits the game (Rule 3.2).",
    "A training camp pool player who has accepted the club's request for a game may be dressed in that game, provided no more than three (3) pool players are in the lineup (Rule S2.5).",
  ],
};
/* the per-night and pre-v4.59 wording these rules replace */
const STALE = [
  "one pool player per game night", "first request wins", "one request per night", "for a night",
  "A request covers all of that club's games that night", "goes to the first club that requests them",
  "refused at once", "marked themselves available for the night", "nightly request", "a night played from the training camp pool",
  "only in steps of $250,000", "A club bids only within its roster limit",
];
/* held rulings: never in the current site's book until the commissioner releases them */
const HELD = [
  "series' first four", "at the position group they signed up for", "may issue a suspension within the limits",
  "with no departments", "an owner, staff, General Manager or Assistant General Manager application", "public from then",
];
const DASHES = new RegExp("[" + String.fromCharCode(0x2014, 0x2013) + "]| - ");

for (const f of Object.keys(books)) {
  console.log("\n# the rendered " + f + " book");
  Object.keys(NEW).forEach((id) => NEW[id].forEach((p) => A(f + ": Rule " + id + ": " + p.slice(0, 70), bound(books[f], id).indexOf(p) >= 0)));
  const inForce = books[f].chapters.filter((c) => !c.shelved).map((c) => JSON.stringify(c)).join(" ");
  const s2 = books[f].chapters.filter((c) => c.num === "S2").map((c) => JSON.stringify(c)).join(" ");
  STALE.forEach((t) => A(f + ": Chapter S2 no longer says \"" + t + "\"", s2.indexOf(t) < 0));
  A(f + ": no stale request wording anywhere in force", !/first request wins|one pool player per game night|one request per night/i.test(inForce));
  HELD.forEach((t) => A(f + ": held, not written: \"" + t + "\"", inForce.indexOf(t) < 0));
  /* the full book shelves the basic text of sections that have a full one (0.3 already says "For Season 2" there), so the
     test is that none of the new v4.59 sentences is shelved in either format */
  const shelved = JSON.stringify(books[f].chapters.filter((c) => c.shelved));
  A(f + ": Appendix A reprints none of the new text", Object.keys(NEW).every((id) => NEW[id].every((p) => shelved.indexOf(JSON.stringify(p).slice(1, -1)) < 0)) && (f !== "basic" || !/For Season 2|Rule S2\./.test(shelved)));
}

console.log("\n# the shape and the register");
const S2 = rb.chapters.find((c) => c.num === "S2");
A("Chapter S2 has eight sections, S2.8 last, titled Staff committees", S2.sections.length === 8 && S2.sections[7].id === "S2.8" && S2.sections[7].title === "Staff committees");
A("no section of Chapter S2 has a full text", S2.sections.every((s) => !s.full));
A("S2.6 keeps two paragraphs (the v4.33 pin)", raw("S2.6").paragraphs.length === 2);
A("S2.5 has three paragraphs: requests, waivers, then the game rules", raw("S2.5").paragraphs.length === 3 && /^A waived player|^A player on a club's roster joins the pool only by being placed on waivers/.test(raw("S2.5").paragraphs[1]));
A("3.2, 4.2 and 5.3 have no full text, so Appendix A is untouched", ["3.2", "4.2", "5.3"].every((id) => !raw(id).full));
A("the paragraphs other tests read by index stay where they were (3.2[5], 4.2[2], 4.2[5])",
  /ten \(10\) forfeits in a season/.test(raw("3.2").paragraphs[5]) && /Where the position lock is in force/.test(raw("4.2").paragraphs[2]) && /Away club's preferred server/.test(raw("4.2").paragraphs[5]));
["S2.5", "S2.6", "S2.7", "S2.8", "3.2", "4.2", "5.3"].forEach((id) => {
  const t = raw(id).paragraphs.join(" ");
  A("Rule " + id + ": no dash as punctuation, no gendered pronoun, American spelling",
    !DASHES.test(t) && !/\b(he|his|him|she|her|hers)\b/i.test(t) && !/defence|centre|cancelled|colour|honour|prioritis|organis/i.test(t));
});
A("the version is the changelog's job: no rule text names v4.59", !/4\.59/.test(JSON.stringify(rb.chapters)));

console.log("\n# the website's own copy");
const live = R("src/live/part_live.js");
A("the late sign-up card says a request is for one game, answered on the site",
  live.indexOf("where a club may request you for one of its games, which you accept or decline on the site, and clubs may bid on you once you have played six games (Chapter S2).") >= 0);
const site = fs.readdirSync(path.join(ROOT, "src/live")).filter((f) => /\.(js|html)$/.test(f) && f !== "part3_content.js").map((f) => R("src/live/" + f)).join("\n");
A("no page says a club requests a pool player for a night, or that the first request wins",
  !/request you for a night|requests? (?:a|the) (?:pool )?player for a night|first request wins|one request per night|one pool player per game night/i.test(site));

/* main session, v4.59: request visibility is enforced (market_pool_requests RLS: the club, the player and staff until the
   night's lock, everyone after), so S2.5 states it, in both formats */
for (const f of ["basic", "full"]) {
  A("S2.5 states who sees a pool request before and after the lock (" + f + ")",
    JSON.stringify(books[f].chapters).includes("Until the night's lineup lock, a request is visible only to the requesting club's management, the player requested and league staff; from the lock it is visible to everyone."));
}
console.log(fail ? "\n" + fail + " of " + n + " FAILED" : "\nall " + n + " passed");
process.exit(fail ? 1 : 0);
