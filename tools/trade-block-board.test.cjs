/* v3.36 — the league-wide trade block, in the Trade Hub.
 *
 * Commissioner, 2026-09-26: "add a place in the Trade Hub of the team HQ where teams can see a list of
 * players on the trade blocks across the league."
 *
 * This runs the SHIPPED CG.tradeBlockCard out of index.html against a made-up league, because the
 * value of the card is entirely in who it includes and who it leaves out.
 */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
function A(name, cond, got) {
  n++;
  if (cond) console.log("ok   " + name);
  else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  — got: " + String(got).slice(0, 260))); }
}
const html = R("index.html");

function slice(start) {
  const i = html.indexOf(start);
  if (i < 0) throw new Error("not in the build: " + start);
  const j = html.indexOf("\n};", i);
  return html.slice(i, j + 3);
}

/* the two shipped functions, with the one free variable the build gives them */
const src = slice("CG.blockListings = function()") + "\n" + slice("CG.tradeBlockCard = function(club)");
const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function mk(players, draft, minServiceGp) {
  const CG = {
    TEAM: { NYI: { code: "NYI", name: "Islanders" }, UTA: { code: "UTA", name: "Mammoth" },
            SEA: { code: "SEA", name: "Kraken" } },
    POS_NAME: { C: "center", LW: "left wing", LD: "left defense", G: "goaltender", RW: "right wing" },
    lg: { players: players, pstats: {} },
    liveTrade: () => draft,
    tPlayer: (pid) => players.find((p) => p.id === pid),
    fmtMoney: (v) => "$" + (v / 1000000).toFixed(2) + "M",
    crest: (code) => '<i data-crest="' + code + '"></i>',
    playerRoute: (p) => "#/player/" + p.id,
    isCamp: (p) => p.squad === "tc",
    campChip: () => '<span class="chip chip-warn chip-xs">Camp</span>',
    tradeStats: (pid) => ({ line: "3G 2A 5P · 6 GP · 0.83 P/GP" }),
    canMovePlayer: (p) => {
      if (!minServiceGp) return null;
      const gp = (CG.lg.pstats[p.id] || {}).gp || 0;
      return gp >= minServiceGp ? null
        : { gp: gp, need: minServiceGp, text: "Rule 2.4: " + p.tag + " has played " + gp + " of " + minServiceGp };
    },
  };
  new Function("CG", "esc", src)(CG, esc);
  return CG;
}
const P = (o) => Object.assign({ id: o.tag, pos: "C", overall: 80, salary: 1000000, squad: "pro", origin: "draft", onBlock: false, mgmt: null }, o);
const draft0 = () => ({ partner: null, offP: [], reqP: [], offK: [], reqK: [], ret: {} });

console.log("\n— who reaches the league table");
{
  const players = [
    P({ tag: "Listed_UTA", team: "UTA", onBlock: true, pos: "LD", overall: 84, salary: 2250000 }),
    P({ tag: "Listed_SEA", team: "SEA", onBlock: true, pos: "G", overall: 77 }),
    P({ tag: "Mine_NYI", team: "NYI", onBlock: true, pos: "LW" }),
    P({ tag: "NotListed_UTA", team: "UTA" }),
    P({ tag: "TheirGM", team: "UTA", onBlock: true, mgmt: "gm" }),
    P({ tag: "OnLoan", team: "SEA", onBlock: true, origin: "preseason_random" }),
  ];
  const CG = mk(players, draft0(), 0);
  const h = CG.tradeBlockCard("NYI");

  A("another club's listed player is in the table", /Listed_UTA/.test(h));
  A("...with his club, position, OVR and cap hit",
    /data-crest="UTA"/.test(h) && />LD</.test(h) && />84</.test(h) && /\$2\.25M/.test(h), h.match(/Listed_UTA[\s\S]{0,420}/));
  A("a second club's listing is there too", /Listed_SEA/.test(h));
  A("the count chip reports players AND clubs", /2 listed by 2 clubs/.test(h), h.match(/chip[^>]*>[^<]*listed[^<]*/));

  const table = h.slice(h.indexOf("<tbody>"));
  A("MY club's listing is not in the league table", !/Mine_NYI/.test(table));
  A("...but it is shown as my own listing", /Your listings, as the rest of the league sees them/.test(h) && /Mine_NYI/.test(h));
  A("a player nobody listed is absent", !/NotListed_UTA/.test(h));
  A("their management is excluded: a seat cannot be traded", !/TheirGM/.test(h));
  A("a pre-season loan is excluded: it is not the club's asset", !/OnLoan/.test(h));
}

console.log("\n— a camp player is tradeable, and says so");
{
  /* he must be IN the table (camp players can be traded) and must be marked, because his weekly
     cap is 3 and he fills any position: that changes what the deal is worth. */
  const CG = mk([P({ tag: "CampGuy", team: "UTA", onBlock: true, squad: "tc" }),
                 P({ tag: "ProGuy", team: "UTA", onBlock: true })], draft0(), 0);
  const h = CG.tradeBlockCard("NYI");
  A("a listed CAMP player is in the table", /CampGuy/.test(h));
  A("...and carries the camp chip", /CampGuy<\/span> <span class="chip chip-warn chip-xs">Camp<\/span>/.test(h),
    h.match(/CampGuy[\s\S]{0,120}/));
  A("...while a pro-squad listing carries no chip", /ProGuy<\/span><\/span>/.test(h), h.match(/ProGuy[\s\S]{0,80}/));
  A("both are addable", /data-block-get="CampGuy"/.test(h) && /data-block-get="ProGuy"/.test(h));
}

console.log("\n— the action, and when it is refused");
{
  const players = [P({ tag: "Ready", team: "UTA", onBlock: true }), P({ tag: "Short", team: "SEA", onBlock: true })];
  let CG = mk(players, draft0(), 0);
  let h = CG.tradeBlockCard("NYI");
  A("a movable player gets a live Add to trade button",
    /data-block-get="Ready"[^>]*data-block-club="UTA"[^>]*>Add to trade</.test(h), h.match(/<button[^>]*data-block-get[\s\S]{0,80}/));

  CG = mk(players, draft0(), 3);
  h = CG.tradeBlockCard("NYI");
  A("Rule 2.4 short of minimum service disables the button", /disabled title="Rule 2\.4: Ready has played 0 of 3">0 of 3 GP</.test(h));
  A("...and it is not clickable", !/data-block-get="Ready"/.test(h));

  CG = mk(players, { partner: "UTA", offP: [], reqP: ["Ready"], offK: [], reqK: [], ret: {} }, 0);
  h = CG.tradeBlockCard("NYI");
  A("a player already in the draft reads 'In your draft'", /In your draft/.test(h) && !/data-block-get="Ready"/.test(h));
  A("...while the OTHER club's listing is still addable", /data-block-get="Short"/.test(h));

  CG = mk(players, { partner: "SEA", offP: [], reqP: ["Ready"], offK: [], reqK: [], ret: {} }, 0);
  h = CG.tradeBlockCard("NYI");
  A("a stale reqP under a different partner does not read as added", /data-block-get="Ready"/.test(h));
}

console.log("\n— the empty state says what will happen");
{
  const CG = mk([P({ tag: "Mine_NYI", team: "NYI", onBlock: true })], draft0(), 0);
  const h = CG.tradeBlockCard("NYI");
  A("no other club listing anybody gives a sentence, not a blank table",
    /No other club is listing anybody right now/.test(h) && !/<tbody>/.test(h));
  A("...and it still shows my own listings", /Mine_NYI/.test(h));
  A("the chip reads zero without naming clubs", /0 listed</.test(h), h.match(/chip[^>]*>0 listed[^<]*/));
}
{
  const CG = mk([], draft0(), 0);
  const h = CG.tradeBlockCard("NYI");
  A("an empty league does not throw, and says nobody is listed", /You have nobody listed/.test(h));
}

console.log("\n— it is a real table, so sorting and the phone layer apply");
{
  const CG = mk([P({ tag: "Listed_UTA", team: "UTA", onBlock: true })], draft0(), 0);
  const h = CG.tradeBlockCard("NYI");
  A("wrapped in .tblwrap", /<div class="tblwrap">/.test(h));
  A("...and it is a .tbl keepcols, which v3.12 makes sortable per heading", /<table class="tbl keepcols">/.test(h));
  A("the caption is for screen readers only", /<caption class="sr">/.test(h));
  A("the copy says a listing is public and an offer is not", /A listing is public/.test(h) && /An offer is not/.test(h));
  A("...and points at the one place to change it", /#\/hub\/roster/.test(h));
}

console.log("\n— wired into the live hub, above the builder");
{
  const live = R("src/live/part_live.js");
  A("the live Trade Hub renders it, with Build a trade FIRST (v3.37)",
    /return h\+build\+inc\+outCard\+CG\.tradeBlockCard\(club\);/.test(live),
    (live.match(/return h\+[^;]*;/) || [])[0]);
  A("...and the board is last, after the offers", /outCard\+CG\.tradeBlockCard\(club\);/.test(live));
  A("adding from the board scrolls back up to the builder",
    /card\.scrollIntoView\(\{ behavior: reduce\?"auto":"smooth", block:"start" \}\)/.test(live));
  A("...honouring prefers-reduced-motion", /prefers-reduced-motion: reduce/.test(live));
  A("...and the prototype hub is untouched", /CG\.hubTradeHub = function\(qs\)\{ return CG\.LIVE_MODE \? CG\.hubTradeHubLive\(qs\) : CG\._protoTradeHub\(qs\); \}/.test(live));
  A("the Add to trade handler is bound in the live AFTER hook",
    /CG\.AFTER\._tradehubLive[\s\S]*data-block-get/.test(live));
  A("...it switches partner and clears the other club's side", /if\(d\.partner!==code\)\{ d\.reqP=\[\]; d\.reqK=\[\]; CG\._counteringId=null; d\.partner=code; \}/.test(live));
  A("...refuses a player who cannot be moved", /var mv=CG\.canMovePlayer\(p\); if\(mv\)\{ CG\.toast\(mv\.text,"err"\); return; \}/.test(live));
  A("...and refuses one who is no longer on a roster", /no longer on a roster/.test(live));
  A("blockListings documents the three exclusions", /the same three exclusions as CG\.tRoster/.test(live));
}

console.log("\n— the record, and the rule");
{
  const rec = R("sql/2026-09-26-trade-block-board.sql");
  const flat = rec.replace(/\n--\s?/g, " ").replace(/\s+/g, " ");
  A("it quotes the instruction", /add a place in the Trade Hub of the team HQ where teams can see a list of players on the trade blocks across the league/.test(flat));
  A("it says no database change was needed, and why",
    /roster_spots carries the policy "rosters readable by all"/.test(flat) && /a VIEW over data the browser was holding and throwing away/.test(flat));
  A("it says why the channel was not enough", /a channel is a running log, not a list/.test(flat));
  A("the three exclusions are justified", /a row you cannot act on is worse than no row/.test(flat));
  A("the partner-switch decision is explained", /a draft holding two clubs' players cannot be sent/.test(flat));
  A("the backwards assertion is on the record", /asserted the chip was ABSENT, and passed because the fixture had no camp player/.test(flat));
  A("the browser verification is recorded", /at 375px: no horizontal page scroll/.test(flat));
  A("no em dash or spaced hyphen", !/\u2014/.test(rec) && !/ - /.test(rec));

  const content = R("src/live/part3_content.js");
  const rb = JSON.parse(content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1)).rulebook;
  const r23 = rb.chapters.find((c) => c.num === 2).sections.find((s) => s.id === "2.3").paragraphs;
  A("Rule 2.3 now describes the trade block", /A club may list any of its players on the league's trade block/.test(r23[4]));
  A("...as the one public part of a trade before it is made",
    /the one thing about a trade that is public before it is made/.test(r23[4]));
  A("...naming both places it appears",
    /posted to the league's trade-block channel and appears to every club's front office on the trade block in the Trade Hub/.test(r23[4]));
  A("...and that it obliges nobody", /It obliges nobody/.test(r23[4]) && /may take a player off the block at any time/.test(r23[4]));
  A("the v3.35 privacy sentence is still there, unharmed", /Only a completed trade is published/.test(r23[0]));
  A("the changelog records it", rb.changelog.some((e) => e.version === "3.36"));
}

console.log(`\n${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
