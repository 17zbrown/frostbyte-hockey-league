/* Lobby codes and servers (Rule 4.2): one model for the Game Center and Team HQ's Game nights. Commissioner, 2026-11-23,
   on the cutover list's live features the concept had left out: "go ahead on all of these" (lobby codes and servers at
   T-30, server picks and vetoes). The rule, word for word in the live rulebook v4.56: the codes for a night are released
   together thirty minutes before the night's first puck drop, only to the two clubs in each game (their rosters and front
   offices) and the league office; four servers, NA Central the standard; Home names a first and a second choice, Away a
   veto and may name a preferred server; the picks freeze for the whole night at the same moment and the server settles
   in Rule 4.2's order.
   The codes, the servers and the picks are the database's, as on the current site (part6_hub.js CG.saveVeto,
   part_live.js CG.refreshCodes; v5.00 swap e2, 2026-11-24): a code is read from games_public, whose can_view is the
   database's own answer to "may this member see it" (can_see_match: the league office, the two clubs' rosters and front
   offices, and a camp player who accepted that game, from the night's lock); a signed-out reader never asks. A club's
   picks are its game_vetoes row (RLS: its own management and the commissioners), written through S2.write with Owner
   approval (the aa_mgmt_gate_vetoes trigger decides; the move is schedule_pick); the database refuses a pick after the
   night's lock (guard_veto_deadline) except from a commissioner, and resolve_game_server settles the night. Nothing is
   made up: an unread code says it is being read, and the pulse's "codes" domain reads the shown games again. i3a
   (2026-11-25): the sample codes and this-tab picks that stood beside it are gone.
     S2.lobby.SERVERS, STANDARD           the list (CG.SERVERS and default_server() on the live site)
     S2.lobby.releaseAt(g) -> ms          the night's first puck drop less 30 minutes (night-wide, as CG.codeReleaseAt)
     S2.lobby.code(g) -> "482713"         the game's code once read ("being read" until then)
     S2.lobby.picks(g) -> { home: { first, second }, away: { veto, prefer } }   the acting club's picks (empty strings unset)
     S2.lobby.setPick(g, side, key, v) -> Promise   savePick, its refusal said and never thrown at the caller
     S2.lobby.settle(g) -> { server, why }  the server the league settled, or "Still settling"
     S2.lobby.sees(g) -> bool             may this viewer see the code (the database's can_view)
     S2.lobby.section(g) -> html          the Game Center's Lobby section
     S2.lobby.savePick(g, side, key, v) -> Promise   the pick, confirmed by the database, refusals in its words
     S2.lobby.teamId(code) -> uuid                    the club's row id (the seat's own, the model's, else the league body's) */
(function () {
  "use strict";
  var S2 = window.S2, M = S2.M, esc = S2.esc;
  function sess() { return S2.session || {}; }
  var SERVERS = ["NA Northeast", "NA Southeast", "NA Central", "NA West"], STANDARD = "NA Central";

  /* the night's first puck drop less 30 minutes, the client's reading of public.night_lock_at (a voided game is not the
     night's first). shortcut: night_lock_at also keeps a lock already ruled (market_lineup_deadlines) when a game is moved
     after it; the label could then read late, but every live code and pick is the database's answer, never this time */
  function releaseAt(g) {
    var first = M.games.filter(function (x) { return x.night === g.night && !x.voided; }).reduce(function (a, x) { return Math.min(a, Date.parse(x.at)); }, Date.parse(g.at));
    return first - 30 * 60000;
  }
  function picks(g) {
    var row = LB.picks[g.id]; if (row === undefined) readPicks(g);
    row = row || {};
    return { home: { first: row.pref1 || "", second: row.pref2 || "" }, away: { veto: row.veto || "", prefer: row.preferred || "" } };
  }
  /* the database settles the night (resolve_game_server, Rule 4.2's order); the opponent's picks never reach this page */
  function settle(g) {
    var c = LB.codes[g.id]; if (!c && sess().user && Date.now() >= releaseAt(g)) readCodes(g);
    return c && c.server ? { server: c.server, why: "settled by the league from both clubs' picks at the night's lock" } : { server: "Still settling", why: "the league settles the server from both clubs' picks at the night's lock" };
  }
  /* the database's answer decides; a refusal is said and the select put back (savePick), never thrown at the caller */
  function setPick(g, side, key, v) {
    if (SERVERS.indexOf(v) < 0 && v !== "") throw new Error("S2.lobby.setPick: " + v + " is not on the server list");
    var q = savePick(g, side, key, v); q.catch(function () {}); return q;
  }
  function sees(g) { var c = LB.codes[g.id]; return !!(c && c.can); }   /* can_see_match, the database's own answer */
  function code(g) {
    var c = LB.codes[g.id]; if (!c && sess().user) readCodes(g);
    return c && c.code ? c.code : "being read";
  }

  var LB = { codes: {}, picks: {}, reading: {} };
  function rd(q) {
    return Promise.resolve().then(function () {
      var c = S2.ensureSb ? S2.ensureSb() : null;
      if (!c) throw new Error("Not connected to the league. Reload the page and try again.");
      return q(c);
    }).then(function (r) { if (r && r.error) throw new Error(r.error.message || "The league did not answer."); return (r && r.data) || []; });
  }
  function teamId(code) {
    var s = sess(), t = M.team(code), b = S2.data && S2.data.body;
    if (s.teamCode === code && s.teamId) return s.teamId;
    if (t && t.id) return t.id;
    var row = b && (b.teams || []).filter(function (x) { return x.code === code; })[0];
    return row ? row.id : null;
  }
  /* the club picking: the seat's own club, or the club a commissioner is running in Team HQ (its one acting club, hq.js) */
  function actClub() {
    if (S2.has("commish") && S2._hq && S2._hq.club) return S2._hq.club();
    var s = sess(), b = S2.data && S2.data.body; if (s.teamCode) return s.teamCode;
    if (!s.teamId) return null;
    var t = M.teams.filter(function (x) { return x.id === s.teamId; })[0] || (b && (b.teams || []).filter(function (x) { return x.id === s.teamId; })[0]);
    return t ? t.code : null;
  }
  function nightIds(g) { return M.games.filter(function (x) { return x.night === g.night && !x.voided; }).map(function (x) { return x.id; }); }
  /* one read for the whole night's codes, signed-in only (Rule 4.2); the games the viewer may see come back with can_view */
  function readCodes(g) {
    if (!sess().user || LB.reading["c" + g.night]) return;
    var ids = nightIds(g); LB.reading["c" + g.night] = true;
    rd(function (c) { return c.from("games_public").select("id,game_code,server,can_view").in("id", ids); }).then(function (rows) {
      LB.reading["c" + g.night] = false;
      rows.forEach(function (r) { LB.codes[r.id] = { code: r.game_code || null, server: r.server || null, can: !!r.can_view }; });
      /* past the lock, the viewer's own club's games whose server is still unset are settled now, as the current site does
         on load (the database's night_board settles every night by itself too) */
      var mine = actClub(), own = function (id) { var x = M.games.filter(function (y) { return y.id === id; })[0]; return x && (x.home === mine || x.away === mine); };
      var due = rows.filter(function (r) { return r.can_view && !r.server && Date.now() >= releaseAt(g) && own(r.id); });
      return due.reduce(function (p, r) { return p.then(function () { return S2.write("resolve_game_server", { p_game: r.id }).then(function (res) { LB.codes[r.id].server = res.data || null; }); }); }, Promise.resolve());
    }).then(function () { paintNight(ids); }, function (e) {
      LB.reading["c" + g.night] = false;
      console.error("S2 lobby: the codes could not be read", e);
      ids.forEach(function (id) { if (!LB.codes[id]) LB.codes[id] = { code: null, server: null, can: false, err: e.message }; });
      paintNight(ids);
    });
  }
  function readPicks(g) {
    var code = actClub(), tid = code && teamId(code), key = "p" + g.night + code;
    if (!tid || LB.reading[key] || [g.home, g.away].indexOf(code) < 0) return;
    LB.reading[key] = true;
    var ids = M.games.filter(function (x) { return x.night === g.night && (x.home === code || x.away === code); }).map(function (x) { return x.id; });
    rd(function (c) { return c.from("game_vetoes").select("game_id,team_id,veto,preferred,pref1,pref2").eq("team_id", tid).in("game_id", ids); }).then(function (rows) {
      LB.reading[key] = false;
      ids.forEach(function (id) { LB.picks[id] = null; });
      rows.forEach(function (r) { LB.picks[r.game_id] = r; });
      LB.pickErr = null;
      /* the servers block is Team HQ's (hq.js serversInner), which repaints itself in place on "s2:lobby" (QA nits
         2026-11-25: a second, whole-page repaint followed it for the same read) */
      document.dispatchEvent(new CustomEvent("s2:lobby", { detail: { picks: ids } }));
    }, function (e) {
      /* a failed read is said once: the night's picks are marked read (none on hand), so the next draw of the block does
         not read and toast again; S2.lobby.pickErr holds the words and S2.lobby.retryPicks(g) reads again */
      LB.reading[key] = false; console.error("S2 lobby: the server picks could not be read", e);
      ids.forEach(function (id) { if (LB.picks[id] === undefined) LB.picks[id] = null; });
      LB.pickErr = e.message;
      S2.toast("The server picks could not be read: " + e.message, "err");
      document.dispatchEvent(new CustomEvent("s2:lobby", { detail: { picks: ids, err: e.message } }));
    });
  }
  /* a club's pick, live: the whole side goes back (first and second, or veto and preferred), checked as the current site
     checks it, through the Owner-approval door. Resolves after the database confirms; on a refusal the select is put back */
  function savePick(g, side, key, v) {
    var code = actClub(), tid = code && teamId(code), home = g.home === code, row = LB.picks[g.id] || {};
    var back = function (msg) { var el = S2.$('[data-srv="' + g.id + '"][data-key="' + key + '"]'); if (el) el.value = (picks(g)[side] || {})[key] || ""; S2.toast(msg, "err"); return Promise.reject(new Error(msg)); };
    if (!tid || (!home && g.away !== code)) return back("Only the two clubs' front offices pick a game's server (Rule 4.2).");
    var rec = { game_id: g.id, team_id: tid, updated_by: sess().profileId || null, updated_at: new Date().toISOString() };
    if (home) {
      rec.pref1 = (key === "first" ? v : row.pref1) || null; rec.pref2 = (key === "second" ? v : row.pref2) || null;
      if (rec.pref1 && rec.pref1 === rec.pref2) return back("The first and second choices must differ.");
    } else {
      rec.veto = (key === "veto" ? v : row.veto) || null; rec.preferred = (key === "prefer" ? v : row.preferred) || null;
      if (rec.veto && rec.veto === rec.preferred) return back("The preferred server cannot be the one you vetoed.");
    }
    return S2.write("game_vetoes.upsert", { row: rec, onConflict: "game_id,team_id", select: "game_id,team_id,veto,preferred,pref1,pref2" },
      { approval: "owner", action: "schedule_pick", queueArgs: { game_id: g.id, veto: rec.veto || null, preferred: rec.preferred || null, pref1: rec.pref1 || null, pref2: rec.pref2 || null } }).then(function (res) {
      if (res.queued) { var el = S2.$('[data-srv="' + g.id + '"][data-key="' + key + '"]'); if (el) el.value = (picks(g)[side] || {})[key] || ""; S2.toast("Sent to your Owner for approval.", "ok"); return res; }
      LB.picks[g.id] = (res.data && res.data[0]) || Object.assign({}, row, rec);
      /* v3.79: after the lock only the league office can change a pick, and the night is settled again at once */
      if (Date.now() >= releaseAt(g) && sess().isCommissioner) return S2.write("resolve_game_server", { p_game: g.id }).then(function (r) { (LB.codes[g.id] = LB.codes[g.id] || {}).server = r.data || null; return res; });
      return res;
    }, function (e) { return back(e.message); });
  }
  function paintNight(ids) {
    ids.forEach(function (id) {
      var g = M.games.filter(function (x) { return x.id === id; })[0];
      S2.$$('[data-lb="' + id + '"]').forEach(function (el) { if (g) el.outerHTML = section(g); });
    });
  }
  /* the pulse (js/live.js): a code or server changed somewhere; the games already read are read again */
  S2.live.on("codes", function () {
    if (!sess().user) return;
    var nights = {}; Object.keys(LB.codes).forEach(function (id) { var g = M.games.filter(function (x) { return x.id === id; })[0]; if (g) nights[g.night] = g; });
    Object.keys(nights).forEach(function (k) { readCodes(nights[k]); });
  });

  function section(g) {
    var rel = releaseAt(g), open = Date.now() >= rel, at = (M.etTime(new Date(rel).toISOString()) + " ET").replace(/ /g, "\u00a0"), c = LB.codes[g.id], signed = !!sess().user, h, p, body = "", big = "";
    if (open && signed && !c) readCodes(g);
    if (!open) {
      h = "The code arrives at " + at;
      /* the training camp player a club has for the game receives it too (Rule 4.2, can_see_match; QA nits 2026-11-25) */
      p = "Codes for the whole night are released together, 30 minutes before its first puck drop, to the two clubs' players and front offices, any training camp player a club has for that game, and the league office. The clubs pick the server until then (Rule 4.2).";
    } else if (signed && !c) { h = "Reading the lobby code"; p = "One moment."; }
    else if (c && c.err) { h = "The lobby code could not be read"; p = c.err + " Reload the page to try again."; }
    else if (c && c.can && c.code) {
      h = "Lobby code"; big = ' <span class="lb-code">' + esc(c.code) + "</span>";
      p = "On " + (c.server || "a server the league is still settling") + ". Keep it inside the two clubs: posting a code anywhere public is a conduct violation (Rule 4.2).";
      body = '<dl class="spec lb-spec"><div><dt>Server</dt><dd>' + esc(c.server || "Still settling") + "</dd></div><div><dt>Released</dt><dd>" + esc(at) + "</dd></div></dl>";
    } else {
      h = "The code is out to the two clubs";
      p = "It went to both rosters, their front offices and any training camp player each club has for this game at " + at + ". No one else sees it (Rule 4.2).";
    }
    return '<section class="td-sec lb-sec" data-lb="' + esc(g.id) + '" aria-labelledby="lbH">' + S2.secHead({ kicker: "Lobby", id: "lbH", hh: esc(h) + big, p: esc(p) }) + body + "</section>";
  }
  S2.lobby = { SERVERS: SERVERS, STANDARD: STANDARD, releaseAt: releaseAt, code: code, picks: picks, setPick: setPick, settle: settle, sees: sees, section: section,
    savePick: savePick, teamId: teamId,
    /* a failed picks read: its words (null when the last read worked), and a fresh read for a Try again (Team HQ) */
    pickErr: function () { return LB.pickErr || null; },
    retryPicks: function (g) { M.games.filter(function (x) { return x.night === g.night; }).forEach(function (x) { if (LB.picks[x.id] === null) delete LB.picks[x.id]; }); LB.pickErr = null; readPicks(g); } };
})();
