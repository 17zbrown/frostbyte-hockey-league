/* v3.72: a traded player takes the place of the player his new club sent away; trades stay open through the
   weekly roster freeze. The database half was rehearsed in Postgres against the league's live pending trades
   (recorded at the foot of the SQL file). This pins the shipped SQL, the arithmetic of the placement rule,
   the client copy and the rulebook. */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + String(got).slice(0, 220))); } };
const sql = R("sql/2026-09-29-trade-placement-v372.sql"), live = R("src/live/part_live.js"), hub = R("src/live/part6_hub.js");

/* ---- SQL ---- */
A("placement: allowance = departing active places + arrivals beyond the number sent",
  /v_allow := coalesce\(cardinality\(p_vacated_active\), 0\) \+ greatest\(0, cardinality\(p_incoming\) - coalesce\(p_departing, 0\)\);/.test(sql));
A("...same-group arrivals take a departing active player's place first, then the trade's order",
  /for v_pass in 1\.\.2 loop/.test(sql) && /continue when v_pass = 1 and not \(v_grp = any\(v_tokens\)\);/.test(sql));
A("...never past the composition or the roster total",
  /if v_allow > 0 and \(f \+ d \+ g\) < v_max\s+and \(case v_grp when 'F' then f < qf when 'D' then d < qd else g < qg end\) then/.test(sql));
A("...a full camp refuses the whole trade, plainly",
  /if v_camp \+ v_n > v_campmax then/.test(sql) && /Nothing was traded: that club must make room in its camp first\./.test(sql));
A("...placed as the league's own move (passes the freeze), flags restored, not cleared",
  /perform set_config\('app\.role_grant', 'on', true\);/.test(sql) && /perform set_config\('app\.role_grant', v_role, true\);/.test(sql));
A("...and not callable from the API",
  /revoke all on function public\._place_trade_arrivals\(uuid, uuid, uuid\[\], text\[\], int\) from public, anon, authenticated;/.test(sql));
A("accept_trade records the departing ACTIVE places before anyone moves, then places after every move",
  /into v_to_act[\s\S]{0,500}foreach pid in array t\.offered_profile_ids loop perform public\.move_player/.test(sql) &&
  /perform public\._place_trade_arrivals\(t\.season_id, t\.to_team_id, t\.offered_profile_ids, v_to_act,/.test(sql));
A("reverse_trade places by the same rule", /perform public\._place_trade_arrivals\(t\.season_id, t\.from_team_id, t\.offered_profile_ids, v_from_act,/.test(sql));
A("_overflow_to_camp is gone, and only after proving it has no caller",
  /raise exception '_overflow_to_camp still has a caller';/.test(sql) && /drop function if exists public\._overflow_to_camp\(uuid, uuid, uuid\[\]\);/.test(sql));
A("the deferred shape check judges a row as the transaction leaves it",
  /if not exists \(select 1 from public\.roster_spots cur\s+where cur\.id = NEW\.id and cur\.squad = NEW\.squad/.test(sql));
A("a full camp can swap: the camp player comes up first",
  /update roster_spots set squad = ''pro'' where id = b\.id;\s+update roster_spots set squad = ''tc''  where id = a\.id;/.test(sql));
A("the rehearsal is recorded", /REHEARSAL OK: T1 ok; T2 ok; T3 ok; T4 ok; T5 ok; T6 ok; S1 ok; S2 ok; S3 ok; S4 ok\./.test(sql));
A("the grant audit names the placement helper", /'_place_trade_arrivals'\)/.test(R("tools/sql/grant-audit.sql")));

/* ---- the rule's arithmetic, as a JS twin of the SQL, on the cases the rehearsal ran ---- */
function place(club, incoming, vacatedActive, departing, q, max) {
  const c = Object.assign({}, club); let allow = vacatedActive.length + Math.max(0, incoming.length - departing);
  let tokens = vacatedActive.slice(); const active = [];
  for (const pass of [1, 2]) for (const p of incoming) {
    if (active.includes(p.id)) continue;
    if (pass === 1 && !tokens.includes(p.g)) continue;
    if (allow > 0 && c.F + c.D + c.G < max && c[p.g] < q[p.g]) {
      active.push(p.id); allow--; c[p.g]++;
      if (pass === 1) tokens.splice(tokens.indexOf(p.g), 1);
    }
  }
  return incoming.map((p) => (active.includes(p.id) ? "pro" : "tc")).join(",");
}
const Q = { F: 7, D: 5, G: 3 };
A("twin T1: a camp place for a camp place, even with room", place({ F: 7, D: 6, G: 2 }, [{ id: 1, g: "F" }], [], 1, Q, 15) === "tc");
A("twin T1: a goaltender takes a departing active forward's place", place({ F: 7, D: 4, G: 1 }, [{ id: 1, g: "G" }], ["F"], 1, Q, 15) === "pro");
A("twin S1: NYI has defense room, but it sent a camp player, so the D goes to camp", place({ F: 7, D: 3, G: 2 }, [{ id: 1, g: "D" }], [], 1, Q, 15) === "tc");
A("twin T4: an active place with no room in the arrival's group stays open", place({ F: 7, D: 5, G: 2 }, [{ id: 1, g: "F" }], ["D"], 1, Q, 15) === "tc");
A("twin T5: 5 for 1, F takes the F place, D extra fits, three F go to camp",
  place({ F: 6, D: 3, G: 2 }, [{ id: 1, g: "F" }, { id: 2, g: "D" }, { id: 3, g: "F" }, { id: 4, g: "F" }, { id: 5, g: "F" }], ["F"], 1, Q, 15) === "pro,pro,tc,tc,tc");
A("twin T6: 4 for 1, one place and three extras with room, all active",
  place({ F: 6, D: 3, G: 2 }, [{ id: 1, g: "F" }, { id: 2, g: "D" }, { id: 3, g: "D" }, { id: 4, g: "G" }], ["F"], 1, Q, 15) === "pro,pro,pro,pro");
A("twin: a same-group arrival wins the one active place even when listed second",
  place({ F: 6, D: 4, G: 2 }, [{ id: 1, g: "D" }, { id: 2, g: "F" }], ["F"], 2, Q, 15) === "tc,pro");

/* ---- client ---- */
const accept = live.slice(live.indexOf("CG.acceptTrade = function"), live.indexOf("CG.declineTrade = function"));
A("accept dialog says where incoming players land", /Each player you receive takes the place of one you send, an active place for an active place and a camp place for a camp place/.test(accept));
A("...and, after the reload, names anyone the trade placed in camp (read back, not predicted)",
  /* v3.75: the second step now receives whether the reload worked */
  /CG\.loadTrades\(\)\.then\(function\(\)\{ return CG\.reloadLeague\(\); \}\)\.then\(function\(ok\)\{/.test(accept) && /joined your training camp: each player you receive takes the place of one you send \(Rule 2\.1\)\./.test(accept));
/* v3.75: the note no longer claims a trade can never work as a call-up (a series of trades can; Rule 2.1 now says so) */
A("Trade Hub says trades stay open while the freeze is on", /Roster freeze, trades open\.<\/b> Call-ups and send-downs are locked until/.test(live) && !/so a trade never works as a call-up/.test(live));
A("roster page shows the freeze in the page, not only a tooltip", /Roster freeze\.<\/b> Call-ups and send-downs are locked until '\+esc\(fzR\.reopens\)\+' \(Rule 2\.1\)\. '/.test(hub) && /: 'Trades stay open: /.test(hub));
A("over-limits note no longer says trading stops at the freeze", !/waive them or trade them before the roster freezes/.test(hub) && /Waivers and trades stay open through the freeze/.test(hub));
A("no copy says squad changes are unlimited all season", !/unlimited all season/.test(hub + live) && !/freely, as often as you like, all season/.test(hub));
A("the basic squads caption gives the camp limit, not 'unlimited'", !/training camp is unlimited/.test(hub) && /training camp holds up to '\+CG\.CAMP_MAX\+' players/.test(hub));
A("the freeze mirror survives an Intl build that renders midnight as 24", /\(\(parseInt\(parts\.hour,10\)\|\|0\) % 24\)\*60/.test(live));
{
  const m = live.slice(live.indexOf("CG.rosterFreeze = function"), live.indexOf("\n};", live.indexOf("CG.rosterFreeze = function")) + 3);
  const ctx = { CG: { now: () => Date.now() } }; new Function("CG", m)(ctx.CG);
  const at = (iso) => ctx.CG.rosterFreeze(Date.parse(iso)).on;
  A("mirror: Wed 7:29 PM ET open, 7:30 PM frozen, Fri 11:59 PM frozen, Sat 12:00 AM open",
    !at("2026-09-30T19:29:00-04:00") && at("2026-09-30T19:30:00-04:00") && at("2026-10-02T23:59:00-04:00") && !at("2026-10-03T00:00:00-04:00"));
}

/* ---- rulebook ---- */
global.window = {}; global.CG = {}; eval(R("src/live/part3_content.js"));
const rb = CG.CONTENT.rulebook, secs = {};
rb.chapters.forEach((ch) => ch.sections.forEach((s) => { secs[s.id] = s; }));
const e = rb.changelog.find((c) => c.version === "3.72");   /* pinned by version, never by index */
A("changelog records 3.72, dated 2026-09-29", !!e && e.dateIso === "2026-09-29");
A("2.1.4: an active place for an active place, a camp place for a camp place", /takes the place of a player his new club sent away in the same trade: an active-roster place for an active-roster place, and a training-camp place for a training-camp place/.test(secs["2.1"].paragraphs[3]));
A("...extras by room, never past the composition, same rule in the freeze", /each additional player joins the active roster where the roster and his position group have room for him/.test(secs["2.1"].paragraphs[3]) && /The rule is the same whether or not the roster is frozen\./.test(secs["2.1"].paragraphs[3]));
A("...trades stay open in the freeze, and the old 'roster held at first puck' sentence is gone", /Trades and the signing of waived players stay open during the freeze/.test(secs["2.1"].paragraphs[3]) && !/played against the roster a club held when the week's first puck dropped/.test(secs["2.1"].paragraphs[3]));
A("2.3.1 and 2.3.3 agree", /Trades stay open during the weekly roster freeze \(Rule 2\.1\)/.test(secs["2.3"].paragraphs[0]) && /each player acquired takes the place of one the club sent/.test(secs["2.3"].paragraphs[2]));
A("0.7 mentions the weekly freeze", /the roster freezes: no player is called up from training camp or sent down to it, though trades stay open/.test(secs["0.7"].paragraphs[0]));
A("2.5.4 garbled splice repaired", /free agent at once under Rule 2\.2, and any club may sign him/.test(secs["2.5"].paragraphs[3]) && !/club\.2, and/.test(secs["2.5"].paragraphs[3]));
A("Appendix A's trade sentence matches the placement rule", /takes the place of a player his new club sent away, an active place for an active place/.test(secs["2.1"].full[2]));
A("no em dashes or spaced hyphens in the 3.72 entry", !/—| - /.test(JSON.stringify(e)));
console.log("\n" + (fail ? fail + " of " + n + " FAILED" : "all " + n + " passed"));
process.exit(fail ? 1 : 0);
