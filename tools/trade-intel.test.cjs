#!/usr/bin/env node
/* v2.72 — trade intel: player stat rows, the balance reading, the detail view on the desk and in the hub;
   the roster split; the DM day stamps. */
const fs = require("fs"), path = require("path"), vm = require("vm");
const root = path.join(__dirname, "..");
const live = fs.readFileSync(path.join(root, "src/live/part_live.js"), "utf8");
const desk = fs.readFileSync(path.join(root, "src/live/part9_staffdesks.js"), "utf8");
const pub  = fs.readFileSync(path.join(root, "src/live/part5a_public.js"), "utf8");
const pub2 = fs.readFileSync(path.join(root, "src/live/part5b_public2.js"), "utf8");
const hub  = fs.readFileSync(path.join(root, "src/live/part6_hub.js"), "utf8");
const head = fs.readFileSync(path.join(root, "src/live/part1_head.html"), "utf8");
let fails = 0;
function A(name, cond, why){ console.log((cond ? "ok   " : "FAIL ") + name + (cond || !why ? "" : "  — " + why)); if (!cond) fails++; }

console.log("— the value model, run for real");
{
  const start = live.indexOf("CG.isCamp = function(p)"), end = live.indexOf("CG.tradePicker = function(side){");
  A("the trade intel module is one block ahead of the picker", start > 0 && end > start);
  const ctx = { CG: {
    lg: { players: [], pstats: {}, _profName: { ghost: "Ghosted" }, _idToCode: { t1: "BOS", t2: "DET" } },
    TEAM: { BOS: { name: "Bruins" }, DET: { name: "Red Wings" } }, POS_NAME: { C: "Center", G: "Goaltender", LW: "Left wing" },
    crest: () => "", fmtMoney: (v) => "$" + (v/1e6).toFixed(2) + "M", fmtFull: () => "day", playerRoute: (p) => "#/player/" + p.id,
    tPlayer: (pid) => ctx.CG.lg.players.find((p) => p.id === pid), tPick: () => null, pickLabel: () => "", modal: (t, b, f) => { ctx.opened = { t, b, f }; },
  }, esc: (s) => String(s) };
  vm.createContext(ctx); vm.runInContext(live.slice(start, end), ctx);
  const CG = ctx.CG;
  CG.lg.players = [
    { id: "a", tag: "Sniper", team: "BOS", pos: "C", overall: 85, salary: 3500000, squad: "pro" },
    { id: "b", tag: "Wall", team: "DET", pos: "G", overall: 78, salary: 750000, squad: "tc" },
    { id: "c", tag: "Fresh", team: "DET", pos: "LW", overall: 70, salary: 750000, squad: "pro" },
  ];
  CG.lg.pstats = { a: { gp: 10, g: 8, a: 12, p: 20 }, b: { gp: 6, w: 4, l: 2, otl: 0, sa: 200, sv: 184, ga: 16 }, c: { gp: 0 } };
  const va = CG.tradeValue("a"), vb = CG.tradeValue("b"), vc = CG.tradeValue("c"), vg = CG.tradeValue("ghost");
  A("overall carries 10 per point above 60", va.ovr === 250 && vc.ovr === 100);
  A("a skater's production is points per game × 40, weighted in over five games", va.prod === 80);
  A("a goaltender's production reads save percentage above .880 plus wins", vb.prod === Math.round(((184/200 - 0.880) * 2000 + 12) * 1));
  A("the cap hit costs 8 per $1M", va.cap === -28 && vc.cap === -6);
  A("no games, no production, and the value never goes below zero", vc.prod === 0 && vc.value === 94 && vg.missing === true && vg.value === 0);
  const side = CG.tradeSide(["a", "b", "ghost"]);
  A("a side sums value, salary and games, counts camp and unresolvable ids", side.n === 3 && side.missing === 1 && side.camp === 1 && side.salary === 4250000 && side.value === va.value + vb.value);
  const card = CG.tradeBalanceCard("BOS", ["a"], "DET", ["c"]);
  A("a lopsided offer names who it favors", /Favors Red Wings by \d+%/.test(card));
  A("...an even one says so", /chip chip-win">Even</.test(CG.tradeBalanceCard("BOS", ["a"], "DET", ["a"])));
  A("...and an empty side is called out", /One side is empty/.test(CG.tradeBalanceCard("BOS", ["a"], "DET", [])));
  A("the formula is printed on the card, as a reading and not a rule", /A reading, not a rule/.test(card) && /Rule 2\.3/.test(card));
  const row = CG.tradePlayerRow("b", { rm: "reqp:b" });
  A("a player row carries the season line, the OVR, the value, the camp chip and a remove control", /4-2-0 · \.920 SV%/.test(row) && />78</.test(row) && /Camp</.test(row) && /data-trade-rm="reqp:b"/.test(row) && /href="#\/player\/b"/.test(row));
  A("a player no longer on a roster still renders by name", /Ghosted/.test(CG.tradePlayerRow("ghost")) && /not on a roster/.test(CG.tradePlayerRow("ghost")));
  CG.tradeDetailModal({ id: "t", from_team_id: "t1", to_team_id: "t2", offered_profile_ids: ["a"], requested_profile_ids: ["b", "c"], status: "accepted", note: "fair", created_at: "2026-09-20T01:00:00Z" }, { footHtml: "<b id=x>Send back</b>" });
  A("the detail view names both clubs, lists every player, keeps the note and carries the caller's footer", ctx.opened && ctx.opened.t === "Bruins ⇄ Red Wings" && (ctx.opened.b.match(/class="trow"/g)||[]).length === 3 && /fair/.test(ctx.opened.b) && /Trade balance/.test(ctx.opened.b) && /Send back/.test(ctx.opened.f));
}

console.log("— wired into the desk and the hub");
A("desk rows open the trade and the reverse button stops the click", /data-trade-open="'\+t\.id\+'" role="button" tabindex="0"/.test(desk) && /function openTrade\(id\)/.test(desk) && /e\.stopPropagation\(\); openReverse\(/.test(desk) && /txDetailReverse/.test(desk));
A("the hub's offer cards carry stat rows, a Details button and the balance card", /data-trade-open="'\+tr\.id\+'">Details</.test(live) && /CG\.tradeBalanceCard\(fromCode, tr\.offered_profile_ids/.test(live) && /return CG\.tradePlayerRow\(pid\); \}\);/.test(live));
A("the builder shows the balance once a player is added, and its rows can be removed", /\(\(d\.offP\.length\|\|d\.reqP\.length\) \? CG\.tradeBalanceCard\(club, d\.offP, d\.partner, d\.reqP/.test(live) && /CG\.tradePlayerRow\(pid, \{ rm: sk\+'p:'\+pid \}\)/.test(live));
A("the picker lists camp last with a chip and each player's season line", /\(CG\.isCamp\(a\)\?1:0\)-\(CG\.isCamp\(b\)\?1:0\) \|\| \(b\.overall\|\|0\)-\(a\.overall\|\|0\)/.test(live) && /CG\.tradeStats\(p\.id\)\.line/.test(live));

console.log("— the active roster and training camp are two blocks everywhere a roster is listed");
A("public team page", /head\("Active roster", sq\.active\.length, ""\)/.test(pub) && /head\("Training camp", sq\.camp\.length/.test(pub));
A("Team HQ roster", /Active roster — '\+sqSplit\.active\.length\+'/.test(hub) && /Training camp — '\+sqSplit\.camp\.length\+'/.test(hub));
A("per-game bench", /Training camp · any position · 3 a week/.test(hub) && /class="bench-h">Active roster/.test(hub));
A("availability team grid", /<b style="font-family:var\(--f-disp\)">Training camp<\/b> <span class="caption">any position · up to 3 games a week/.test(hub));
A("Control Center rosters ledger counts the active roster only and labels camp", /var campN=players\.filter\(CG\.isCamp\)\.length, n=players\.length-campN/.test(live) && /Training camp — '\+campN\+'/.test(live));
A("clubs table, dashboard card, roster room chip", /\+ '\+nCamp\+' camp/.test(live) && /Active roster'\+\(campN\?' · '\+campN\+' in camp':''\)/.test(live) && /r\.camp\?' · '\+r\.camp\+' in camp'/.test(live));
A("directory, stats, matchup and profile mark camp players", /' · training camp':''/.test(pub) && (pub.match(/\(CG\.isCamp\(p\)\?' · camp':''\)/g)||[]).length === 3 && /CG\.campChip\("xs"\):''\)\+'<\/span>'/.test(pub2) && />Training camp<\/span>/.test(pub));
A("the block header style exists", /tr\.squad-head td\{/.test(head) && /\.bench-h\{/.test(head));

console.log("— direct messages carry the day");
A("each bubble stamps day and time, and a divider opens each new day", /CG\.fmtFull\(ts\)/.test(live) && /class="dm-day" role="separator"/.test(live) && /\.dm-day\{/.test(head));

console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
