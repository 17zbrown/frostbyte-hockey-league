/* CGHL Season 2: the data model. S2.M is built from ONE body of league facts:
     live mode     S2.buildModel(body) from public.s2_league (js/load.js reads it with the public key, or the member's
                   own token, so RLS decides what it holds): standings and season lines are counted by the live site's
                   own engine (js/cg-engine.js, generated from src/live), never by a copy of its rules;
     fixture mode  S2.fillModel(window.S2DATA) from data/snapshot.js (the private Oct 19 fixture the suites run on).
   v5.00 swap (c2, 2026-11-24): both doors refill the SAME S2.M object in place, because every page keeps `M = S2.M` from
   load. Every lookup is guarded: a missing record returns null or [], never throws; a missing SECTION is an error (the
   body is checked before anything is built) and a section the body does not carry is named in M.partial, so "not
   loaded" never reads as "none". Nothing here is made up (i3a, 2026-11-25: the sample game night, the stand-in Season 2
   rosters, the demo's result writer and the placeholder staff are gone). Definitions are ports of the live site, cited
   inline, so the model never invents a second rule. */
window.S2 = window.S2 || {};
/* S2.fillModel(D): fills S2.M from an S2DATA-shaped body (the fixture's shape; S2.buildModel turns an s2_league body into it) */
window.S2.fillModel = function (D) {
  "use strict";
  const S2 = window.S2, CG = S2.CG;
  if (!D || !Array.isArray(D.teams) || !Array.isArray(D.seasons) || !D.seasons.length) throw new Error("S2.fillModel: the league data has no teams or seasons");
  if (!CG || !CG.h2hPoints || !CG.gameNights) throw new Error("S2.fillModel: js/cg-engine.js must load before js/model.js");
  const M = S2.M = S2.M || {};
  Object.keys(M).forEach((k) => { delete M[k]; });

  /* ---------- guards and small helpers ---------- */
  const arr = (x) => (Array.isArray(x) ? x : []);
  const obj = (x) => (x && typeof x === "object" && !Array.isArray(x) ? x : {});
  const num = (x) => (typeof x === "number" && isFinite(x) ? x : 0);
  const div = (a, b) => (b ? a / b : null);
  const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);
  const esc = (s) => (S2.esc ? S2.esc(s) : String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]));
  const by = (key, dir) => (a, b) => {   /* nulls sink in both directions */
    const x = typeof key === "function" ? key(a) : a[key], y = typeof key === "function" ? key(b) : b[key];
    if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
    return dir === "asc" ? (x > y ? 1 : x < y ? -1 : 0) : (x < y ? 1 : x > y ? -1 : 0);
  };
  const fmtN = (n, d) => (n == null || isNaN(n) ? "–" : Number(n).toLocaleString("en-US", { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }));
  const plural = (n, one, many) => n + " " + (n === 1 ? one : many || one + "s");

  /* ---------- league time (every date reads in Eastern) ---------- */
  const TZ = "America/New_York";
  const F = {
    day: new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }),
    time: new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }),
    date: new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric" }),
    long: new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric" }),
    md: new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric" }),
    hm: new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
    full: new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric", year: "numeric" })
  };
  const toDate = (x) => { if (!x) return null; const d = /^\d{4}-\d\d-\d\d$/.test(x) ? new Date(x + "T16:00:00Z") : new Date(x); return isNaN(d) ? null : d; };
  const fmt = (f) => (x) => { const d = toDate(x); return d ? F[f].format(d) : null; };
  M.etDay = fmt("day");          /* "2026-10-21" (the ET night key) */
  M.etTime = fmt("time");        /* "9:00 PM" */
  M.etDate = fmt("date");        /* "Wed, Oct 21" */
  M.etLong = fmt("long");        /* "Wednesday, October 21" */
  M.etMonthDay = fmt("md");      /* "Oct 21" */
  M.etFull = fmt("full");        /* "Wed, Oct 21, 2026" */
  M.etDateTime = (x) => { const d = toDate(x); return d ? F.date.format(d) + ", " + F.time.format(d) + " ET" : null; };
  M.ago = (minutes) => { const m = Math.round(num(minutes)); return m < 1 ? "just now" : m < 60 ? m + " min ago" : m < 2880 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " days ago"; };
  /* zero reads "$0" and a shortfall carries its sign (a club pushed over the cap reads as a negative room) */
  M.money = (n) => (n == null ? "–" : n === 0 ? "$0" : n < 0 ? "-" + M.money(-n) : "$" + (n >= 1e6 ? fmtN(n / 1e6, n % 1e6 ? 2 : 0) + "M" : fmtN(n / 1e3) + "K"));
  M.toi = (s) => (s == null ? "–" : Math.floor(s / 60) + ":" + String(Math.round(s % 60)).padStart(2, "0"));

  M.generated = D.generated || null;
  M.now = toDate(D.generated) || new Date();   /* the moment the league data was read */
  M.source = D.source || "";
  M.SETTLE_GP = num(obj(D.pct).min_gp) || 6;   /* cghl_settle_gp(): below this a rating is provisional and a stat has no rank (M.rank) */

  /* ---------- the seasons, as their rows say ----------
     Every setting is read from the season's row: the cap (commissioner, 2026-11-09: "For now, set it at 30 Million for
     season 2"), the rounds, the roster limit and the playoff floor (v4.52, v4.58), the calendar (v4.31) and Season 1's
     floor of 14 (v4.43). The overlay that laid those rulings over the Oct 19 rows is gone: the live rows carry every one,
     and the fixture carries them as data (2026-11-24). tools/ui/live-model.test.cjs pins that a changed row changes the model. */
  const SEASONS = arr(D.seasons).map((s) => Object.assign({}, s)).sort(by("number", "asc"));
  const rowOf = (n) => SEASONS.filter((s) => s.number === n)[0] || null;
  /* the season whose games, lines and rosters this body holds (s2_league's season; the fixture is Season 1, then active) */
  const VIEW_N = num(D.season) || ((SEASONS.filter((s) => s.status === "active")[0] || SEASONS[0]).number);
  const VIEW = rowOf(VIEW_N) || {};
  /* ---------- the Season 2 calendar, from its row ----------
     ONE definition of the Season 2 dates (live rulebook S2.1 v4.31, S2.6 v4.33): js/market.js builds its clock, game
     nights and bid nights from M.s2cal. Game nights are the live engine's (CG.gameNights: Wednesday anchor, the season's
     nights a week, every week holding a skipped holiday stepped over), so they follow the row's starts_at, weeks,
     nights_per_week and skip_holidays. Every instant is an ISO string from toISOString, so two of them compare as strings. */
  const S2ROW = rowOf(2);
  if (!S2ROW || !S2ROW.starts_at || !S2ROW.draft_at) throw new Error("S2.fillModel: the Season 2 row, its draft or its puck drop is missing");
  const iso = (x) => (x ? new Date(x).toISOString() : null);
  const addDays = CG.dayAdd;
  const slot1 = String(S2ROW.night_slots || "21:00").split(",")[0];
  const s2Plan = CG.gameNights(CG.etYMD(S2ROW.starts_at), num(S2ROW.weeks) || 6, num(S2ROW.nights_per_week) || 3, CG.seasonHolidayKeys(S2ROW));
  const s2Nights = [];
  s2Plan.nights.forEach((w) => w.days.forEach((key) => { s2Nights.push({ key: key, week: w.week, at: CG.etISO(key, slot1), ends: CG.etISO(key, "23:30") }); }));
  /* the movement deadline (Rule 2.4): the database's fixed instant once it has passed (v3.98); else midnight ET after the
     last regular game of the deadline week (CG.movementDeadlineTs); else, before a schedule exists, the same instant
     after the Friday of that week in the planned nights (deadlineProjected) */
  const s2Deadline = (() => {
    if (S2ROW.movement_deadline_fixed) return { at: iso(S2ROW.movement_deadline_fixed), projected: false };
    const wk = num(S2ROW.trade_deadline_week), mine = VIEW_N === 2 ? arr(D.games).filter((g) => g.stage === "regular" && g.week === wk) : [];
    if (mine.length) { const last = mine.map((g) => g.at).sort().pop(); return { at: CG.etISO(addDays(CG.etYMD(last), 1), "00:00"), projected: false }; }
    const w = s2Plan.nights[wk - 1];
    return w ? { at: CG.etISO(addDays(w.fri, 1), "00:00"), projected: true } : { at: null, projected: true };
  })();
  M.s2cal = {
    ownersClose: iso(S2ROW.owner_app_deadline),
    /* shortcut: owners decided by Dec 5 lives in app_config (owner_decision_by_2), which no API role reads; s2_league needs a key for it before it can change by itself */
    ownersDecided: CG.etISO("2026-12-05", "23:59"),
    signupsClose: iso(S2ROW.registration_deadline), draft: iso(S2ROW.draft_at), puckDrop: s2Nights.length ? s2Nights[0].at : iso(S2ROW.starts_at),
    deadline: s2Deadline.at, deadlineProjected: s2Deadline.projected,
    ends: iso(S2ROW.ends_at), playoffs: iso(S2ROW.playoffs_start_at),
    nights: s2Nights,   /* the season's game nights; every club plays at each of the row's slots; ends is 11:30 PM */
    skipped: s2Plan.skipped,
    bidNights: []
  };
  /* Rule S2.6: every Saturday after the draft and before the movement deadline, 9 to 10 PM ET, except the Saturday of a
     week skipped for a holiday ("no games are played that week"), read from the game nights so the two can never disagree */
  for (let sat = addDays(CG.etYMD(S2ROW.draft_at), 7); M.s2cal.deadline && CG.etISO(sat, "21:00") < M.s2cal.deadline; sat = addDays(sat, 7)) {
    const played = s2Nights.some((n) => n.key === addDays(sat, -1));
    M.s2cal.bidNights.push({ key: sat, opens: CG.etISO(sat, "21:00"), newUntil: CG.etISO(sat, "22:00"), skipped: !played, why: played ? null : "Holiday week: no games, no bidding (Rule S2.6)" });
  }

  /* ---------- positions (mirrors CG.POS_NAME and CG.POS_RANK, part2_engine.js) ---------- */
  M.POS = ["LW", "C", "RW", "LD", "RD", "G"];                       /* rink order */
  M.POS_NAME = { LW: "Left Wing", C: "Center", RW: "Right Wing", LD: "Left Defense", RD: "Right Defense", G: "Goaltender", D: "Defense" };
  M.POS_RANK = { LW: 1, C: 2, RW: 3, LD: 4, D: 4.5, RD: 5, G: 6 };
  M.GROUP = { C: "C", LW: "W", RW: "W", W: "W", LD: "D", RD: "D", D: "D", G: "G" };   /* position -> rating group */
  M.GROUP_NAME = { C: "Centers", W: "Wingers", D: "Defense", G: "Goaltenders" };
  M.GROUP_MANY = { C: "centers", W: "wingers", D: "defense players", G: "goaltenders" };   /* in a sentence: "Rank among 35 defense players" */
  M.UNIT = { C: "F", LW: "F", RW: "F", LD: "D", RD: "D", D: "D", G: "G" };               /* forward / defense / goaltender */
  M.posName = (p) => M.POS_NAME[p] || null;
  M.byRink = (a, b) => (M.POS_RANK[a.pos] || 9) - (M.POS_RANK[b.pos] || 9) || (num(a.num) - num(b.num)) || String(a.tag).localeCompare(String(b.tag));

  /* ---------- clubs ---------- */
  M.league = Object.assign({ code: "CGHL", name: "Chel Gaming Hockey League", divisions: ["East", "West"] }, obj(D.league));
  /* the season on screen and what its body holds, for the pages' empty states: a Season 2 with no games, no rosters and no
     seats before the Dec 12 draft is the real state, said as such, never a blank table (M.view.empty names what is empty) */
  M.partial = Object.assign({}, obj(D.partial));
  /* id: the club's teams.id, which every door names (S2.trade, S2.lobby.teamId); the fixture carries none (i3a, 2026-11-25) */
  M.teams = arr(D.teams).map((t) => ({ id: t.id || null, code: t.code, city: t.city, name: t.name, full: (t.city ? t.city + " " : "") + t.name, division: t.division,
    color: t.color, color2: t.color2, logo: t.logoUrl || (t.logo ? "assets/logos/" + String(t.logo).split("/").pop() : null), arena: t.arena || null, founded: t.founded_season == null ? null : t.founded_season, href: "#/club/" + t.code }));
  const TEAM = {}; M.teams.forEach((t) => { TEAM[t.code] = t; });
  M.team = (code) => TEAM[String(code || "").toUpperCase()] || null;
  const tile = (code, label, cls) => {
    const big = /\bxl\b/.test(cls) ? 26 : /\blg\b/.test(cls) ? 17 : 10;
    return '<span class="crest crest-tile' + (cls ? " " + esc(cls) : "") + '" role="img" aria-label="' + esc(label) + '" style="display:inline-grid;place-items:center;border-radius:28%;' +
      'background:var(--fill);color:var(--ink-2);font:600 ' + big + 'px/1 var(--font-num);letter-spacing:.02em">' + esc(code) + "</span>";
  };
  /* the club logo with alt text; a code tile when there is no logo or the image fails to load */
  M.crest = (code, cls) => {
    const t = M.team(code);
    if (!t) return code ? tile(String(code).toUpperCase(), String(code).toUpperCase(), cls) : "";
    if (!t.logo) return tile(t.code, t.full, cls);
    return '<img class="crest' + (cls ? " " + esc(cls) : "") + '" src="' + esc(t.logo) + '" alt="' + esc(t.full) + '" loading="lazy" decoding="async" data-code="' + esc(t.code) + '" onerror="S2.M._crestFail(this)">';
  };
  M._crestFail = (img) => { try { const t = M.team(img.dataset.code); img.outerHTML = tile(t ? t.code : "?", t ? t.full : "Club", img.className.replace(/^crest\s*/, "")); } catch (e) { img.remove(); } };

  /* ---------- games (03) ---------- */
  M.GAME_LIVE_MS = 30 * 60 * 1000;   /* CG.GAME_LIVE_MS: live from puck drop for 30 minutes (part5a_public.js, v3.03) */
  M.gameState = (g, now) => {
    if (!g) return null;
    if (g.voided) return "voided";
    if (g.status === "final") return "final";
    const t = toDate(g.at), n = (now ? toDate(now) : M.now) || M.now;
    if (!t || n < t) return "upcoming";
    return n - t < M.GAME_LIVE_MS ? "live" : "pending";
  };
  M.STATE_LABEL = { upcoming: "Upcoming", live: "Live", final: "Final", pending: "Result pending", voided: "Voided" };
  M.games = arr(D.games).map((g) => {
    const x = Object.assign({}, g);
    x.night = M.etDay(g.at); x.time = M.etTime(g.at); x.date = M.etDate(g.at); x.href = "#/game/" + g.id;
    x.state = M.gameState(g);
    x.isFinal = x.state === "final";
    x.hasBox = num(g.lines) > 0;
    x.kept = !!g.forfeit && x.hasBox;   /* kept-result forfeit: the box stands, the forfeit decides W/L */
    x.winner = null; x.loser = null;
    if (x.isFinal && g.hs != null && g.as != null) {
      if (g.forfeit) { x.loser = g.forfeit; x.winner = g.forfeit === g.home ? g.away : g.home; }
      else if (g.hs !== g.as) { x.winner = g.hs > g.as ? g.home : g.away; x.loser = x.winner === g.home ? g.away : g.home; }
    }
    x.decision = !x.isFinal ? null : g.forfeit ? "forfeit" : g.ot ? "ot" : "reg";
    x.label = !x.isFinal ? M.STATE_LABEL[x.state] : g.forfeit ? "Forfeit" : g.ot ? "Final/OT" : "Final";
    return x;
  }).sort(by((g) => g.at + g.home, "asc"));
  /* slot from the season's night_slots (1 = 9:00 PM, 2 = 9:35 PM, 3 = 10:10 PM ET); 0 = an extra time, e.g. a make-up game */
  (() => { const slots = String(VIEW.night_slots || "21:00,21:35,22:10").split(",");
    M.games.forEach((g) => { const d = toDate(g.at); g.slot = d ? slots.indexOf(F.hm.format(d)) + 1 : 0; g.makeup = !!g.rescheduled_from; }); })();
  const GAME = {}; M.games.forEach((g) => { GAME[g.id] = g; });
  const scoreOf = (g, code) => (g.home === code ? g.hs : g.as);

  /* ---------- box scores (11): rows keyed by club code, box[g.home], never box.home ---------- */
  const BCOLS = arr(obj(D.box).cols);
  const BOX = obj(obj(D.box).byGame);
  /* EA's own figures for each club in each game (time on attack, passes completed and attempted, shots), every sitting of a
     game added together and a struck sitting left out. They are not the player lines added up: EA's club passes run about 3%
     above the lines and its club shots about 12% above them, and time on attack is EA's own clock, not the players' possession.
     Commissioner, 2026-11-04, on fixing the team shots: "fix them". A club's shots almost always agree with what the opposing
     goaltender faced (this snapshot: 228 of 254 club rows exactly, 251 within one); the skaters' shots equal the club's in 38 and never pass it. */
  const CCOLS = arr(obj(D.box).clubCols), CBOX = obj(obj(D.box).clubByGame);
  const clubRow = (gameId, code) => { const r = obj(CBOX[gameId])[code]; if (!r) return null; const o = {}; CCOLS.forEach((c, i) => { o[c] = r[i]; }); return o; };
  const boxRow = (row, gameId) => { const o = { game: gameId }; BCOLS.forEach((c, i) => { o[c] = row[i]; }); o.role = o.goalie ? "G" : "S"; o.so = !!o.so; o.p = num(o.g) + num(o.a); return o; };
  /* positions each player PLAYED, per role, from the box (by-position splits trust the stat line) */
  const PLAYED = {};
  /* Commissioner, 2026-11-04: "faceoff percentage only calculated from games where the player played at center." A skater's
     line takes fow and fot from these games alone; a club's faceoffs still count every line (M.clubStats). IN_GOAL holds the
     goalie columns the season lines do not carry */
  const AT_CENTER = {}, IN_GOAL = {};
  const regular = (gid) => !!GAME[gid] && GAME[gid].stage === "regular";   /* v4.09: a playoff game never reaches a regular-season line */
  Object.keys(BOX).forEach((gid) => arr(BOX[gid]).forEach((r) => {
    const o = boxRow(r, gid); if (!o.pid || !regular(gid)) return;
    const k = o.pid + "|" + o.role, p = PLAYED[k] = PLAYED[k] || {}; p[o.pos] = p[o.pos] || new Set(); p[o.pos].add(gid);
    if (o.role === "S" && o.pos === "C") { const c = AT_CENTER[o.pid] = AT_CENTER[o.pid] || { fow: 0, fot: 0, fo_games: 0 }; c.fow += num(o.fow); c.fot += num(o.fot); c.fo_games++; }
    if (o.role === "G") { const c = IN_GOAL[o.pid] = IN_GOAL[o.pid] || { dsv: 0, sop: 0, psv: 0, psa: 0 }; ["dsv", "sop", "psv", "psa"].forEach((s) => { c[s] += num(o[s]); }); }
  }));
  const playedCounts = (pid, role) => { const p = PLAYED[pid + "|" + role] || {}, out = {}; Object.keys(p).forEach((k) => { out[k] = p[k].size; }); return out; };
  const topKey = (o) => Object.keys(o).sort((a, b) => o[b] - o[a])[0] || null;

  /* ---------- player lines (04), one per player per role ---------- */
  const RATE_KEYS = { pts_pg: ["p", "gp"], g_pg: ["g", "gp"], a_pg: ["a", "gp"], sog_pg: ["sog", "gp"], hits_pg: ["hits", "gp"], blk_pg: ["blk", "gp"],
    tk_pg: ["tk", "gp"], gv_pg: ["gv", "gp"], int_pg: ["int", "gp"], pm_pg: ["pm", "gp"], pim_pg: ["pim", "gp"], poss_s_pg: ["poss_s", "gp"],
    pass_pct: ["pass", "pass_att"], shot_pct: ["g", "sog"], fo_pct: ["fow", "fot"], toi_pg: ["toi_s", "gp"],
    sv_pct: ["sv", "sa"], sv_pg: ["sv", "gp"], sa_pg: ["sa", "gp"], so_pg: ["so", "gp"], brk_sv_pct: ["brk_sv", "brk_sa"], gaa_calc: ["ga", "gp"],
    onnet_pct: ["sog", "sat"], dsv_pg: ["dsv", "gp"], sop_pg: ["sop", "gp"], psv_pct: ["psv", "psa"] };
  const shapeLine = (raw) => {
    const l = Object.assign({}, raw, raw.role === "G" ? IN_GOAL[raw.pid] || { dsv: 0, sop: 0, psv: 0, psa: 0 } : AT_CENTER[raw.pid] || { fow: 0, fot: 0, fo_games: 0 });
    const x = Object.assign({}, l);
    x.id = l.pid; x.href = "#/player/" + l.pid;
    Object.keys(RATE_KEYS).forEach((k) => { const [a, b] = RATE_KEYS[k]; x[k] = r3(div(num(l[a]), num(l[b]))); });
    x.gaa = l.gaa != null ? l.gaa : x.gaa_calc; delete x.gaa_calc;
    /* EA can credit a shot on goal without an attempt, so the plain ratio can pass 100%. Asked whether to cap it at 100%, the commissioner, 2026-11-04: "Yes" */
    if (x.onnet_pct > 1) x.onnet_pct = 1;
    if (l.role === "G") ["fo_pct", "shot_pct", "pass_pct", "onnet_pct"].forEach((k) => { if (!num(l[RATE_KEYS[k][1]])) x[k] = null; });
    else ["sv_pct", "sv_pg", "sa_pg", "so_pg", "brk_sv_pct", "gaa", "dsv_pg", "sop_pg", "psv_pct"].forEach((k) => { x[k] = null; });
    x.positions = playedCounts(l.pid, l.role);                        /* games per EA position played in this role */
    x.posPlayed = l.role === "G" ? "G" : topKey(x.positions);
    /* rank group = the most-played GROUP, summed over its positions (M.rank): wings and defense split across two EA
       positions, so C 5, LW 4, RW 3 is a winger with 7 games there, not a center with 5 (review 2026-10-20). The top
       position's group goes in first, so it wins a tie (topKey's sort is stable) */
    const gc = {};
    [M.GROUP[x.posPlayed]].concat(Object.keys(x.positions).map((k) => M.GROUP[k])).forEach((g) => { if (g && !(g in gc)) gc[g] = 0; });
    Object.keys(x.positions).forEach((k) => { const g = M.GROUP[k]; if (g) gc[g] += x.positions[k]; });
    x.group = l.role === "G" ? "G" : topKey(gc) || M.GROUP[l.reg_pos] || null;
    x.regPos = l.reg_pos || null;
    x.pos = l.role === "G" ? "G" : (l.reg_pos && l.reg_pos !== "G" ? l.reg_pos : x.posPlayed) || null;   /* the line's position: registered, or played when registered in goal */
    x.groupGp = Object.keys(x.positions).filter((k) => M.GROUP[k] === x.group).reduce((a, k) => a + x.positions[k], 0);
    x.record = l.role === "G" ? num(l.w) + "-" + num(l.l) + "-" + num(l.otl) : null;
    return x;
  };
  const LINES = arr(D.lines).map(shapeLine);

  /* ---------- players: rosters (07) + lines (04) + ratings (07) + tenures + honors ---------- */
  const P = {};
  const ensure = (id, tag) => (P[id] = P[id] || { id: id, tag: tag || "Unknown player", href: "#/player/" + id, club: null, pos: null, posSource: null,
    squad: null, num: null, salary: null, seat: null, origin: null, onBlock: false, rostered: false, former: false, lines: { S: null, G: null }, ratingRows: [] });
  arr(D.rosters).forEach((r) => { const p = ensure(r.pid, r.tag);
    Object.assign(p, { club: r.club, pos: r.pos, posSource: "roster", squad: r.squad, num: r.num, salary: r.salary, seat: r.seat, origin: r.origin, onBlock: !!r.on_block, rostered: true }); });
  LINES.forEach((l) => { const p = ensure(l.pid, l.tag); p.lines[l.role] = l; if (!p.rostered) { p.club = p.club || l.club; p.former = true; } });
  /* v4.48 (commissioner, 2026-11-06: "Center on 85"): ratings run 75 to 99 with a league median of 85. The snapshot was
     taken on the old 50 to 99 scale (median 70), so every rating and rating part moves by the live conversion,
     new = 99 - (99 - old) * 14 / 29, which keeps every player's order (sql/2026-11-06-rating-scale-and-position-weights-v448.sql).
     shortcut: the snapshot keeps the old position weights (70:30 W and C, 56:44 D), so a few players sit a point or two
     off their live number; re-export query 07 after 2026-11-06 and drop this conversion */
  M.OVR_CENTER = 85; M.OVR_FLOOR = 75;
  M.newOvr = (old) => (old == null ? null : Math.round(99 - (99 - old) * 14 / 29));
  /* CG.tradeValue still counts the old scale (v4.48 live, part_live.js), so the trade value reads a rating back */
  M.oldOvr = (ovr) => (ovr == null ? null : 99 - (99 - ovr) * 29 / 14);
  /* a rating as a share of the scale, for rings and radar shapes: the floor is empty, 99 is full */
  M.ovrUnit = (ovr) => (ovr == null ? 0 : Math.max(0, Math.min(1, (ovr - M.OVR_FLOOR) / (99 - M.OVR_FLOOR))));
  arr(D.ratings).forEach((r) => {
    if (!r.v448) { r.ovr = M.newOvr(r.ovr); const c = obj(r.cats); Object.keys(c).forEach((k) => { c[k] = M.newOvr(c[k]); }); r.v448 = true; }
    ensure(r.pid, r.tag).ratingRows.push(r);
  });
  /* the season's sign-ups (registration_pool through s2_league; ea_id is never in it): a member signed up and on no club
     is a player of the season too, at the position they signed up for */
  M.signups = arr(D.signups).map((r) => { const p = ensure(r.pid, r.tag); if (!p.pos) { p.pos = r.pos; p.posSource = "signup"; }
    p.signup = { pos: r.pos, status: r.status, at: r.at, waivedAt: r.waived_at || null }; return Object.assign({ player: p }, r); });
  const POTW_LABEL = { potw_skater: "Skater", potw_goalie: "Goaltender", potw_forward: "Forward", potw_defense: "Defense" };
  const TITLE_LABEL = { points_title: "Scoring Title", goals_title: "Goal-scoring Title", assists_title: "Playmaking Title", goaltending_title: "Goaltending Title" };
  const TEN = obj(D.tenures);
  /* a player's places in the title race (the body's titles, or the board M.readTitles put there) */
  var raceHonors = function (id) {
    return arr(obj(D.honors).titles).filter(function (t) { return t.profile_id === id; }).map(function (t) {
      return { kind: "title_race", category: t.category, label: TITLE_LABEL[t.category] + ": place " + t.place + " (race in progress)", place: t.place, perGame: t.per_game, gp: t.gp };
    });
  };
  Object.keys(P).forEach((id) => {
    const p = P[id];
    if (!p.pos) { const s = p.lines.S, g = p.lines.G; p.pos = (s && num(s.gp) >= num(g && g.gp) ? s.posPlayed : g ? "G" : null); p.posSource = p.pos ? "played" : null; }
    p.posName = M.posName(p.pos); p.group = M.GROUP[p.pos] || null; p.unit = M.UNIT[p.pos] || null;
    p.roles = ["S", "G"].filter((r) => p.lines[r]);
    p.mainRole = p.roles.length === 2 ? (num(p.lines.G.gp) > num(p.lines.S.gp) ? "G" : "S") : p.roles[0] || null;
    p.gp = p.roles.reduce((a, r) => a + num(p.lines[r].gp), 0);   /* sum of role lines; a two-role game counts in both */
    p.team = M.team(p.club);
    const head = p.ratingRows.filter((r) => r.headline)[0] || p.ratingRows.slice().sort(by("ovr"))[0];
    p.ovr = head ? { pos: head.pos, ovr: head.ovr, gp: head.gp, provisional: !!head.provisional } : null;
    p.tenures = arr(TEN[id]).map((t) => Object.assign({}, t, { fromLabel: M.etMonthDay(t.from), toLabel: t.to ? M.etMonthDay(t.to) : "Now", team: M.team(t.club) }));
    p.honors = arr(obj(D.honors).potw).filter((h) => h.pid === id).map((h) => ({ kind: "potw", week: h.week, category: h.category, label: "Player of the Week (" + (POTW_LABEL[h.category] || "") + "), Week " + h.week, club: h.club, line: h.line }))
      .concat(raceHonors(id));
  });
  M.players = Object.keys(P).map((k) => P[k]).sort((a, b) => String(a.tag).toLowerCase().localeCompare(String(b.tag).toLowerCase()));
  const TAG = {}; M.players.forEach((p) => { TAG[String(p.tag).toLowerCase()] = p; });
  M.player = (idOrTag) => (idOrTag == null ? null : P[idOrTag] || TAG[String(idOrTag).toLowerCase()] || null);
  const tagOf = (pid) => (P[pid] ? P[pid].tag : null);
  M.view = { season: VIEW_N, name: VIEW.name || "Season " + VIEW_N, status: VIEW.status || null, live: D.source === "live",
    games: M.games.length, finals: M.games.filter((g) => g.isFinal).length, rostered: arr(D.rosters).length, lines: LINES.length, signups: M.signups.length };
  M.view.empty = { games: !M.view.games, finals: !M.view.finals, rosters: !M.view.rostered, lines: !M.view.lines, signups: !M.view.signups };
  /* the draft (draft_state and draft_picks), the public suspension record, site settings and feature flags, and each
     member's games played in every season (career_games_played), as s2_league returns them */
  M.draft = { state: obj(D.draft).state || null, picks: arr(obj(D.draft).picks) };
  /* ONE definition of "the season's draft is complete" (QA round 2, 2026-11-25: the Staff Desk, the Control Center and
     Team HQ each tested it their own way): draft_state.status "complete" from the league read (M.draft, which the pulse
     and the draft room's Realtime keep current), the test the market itself opens on (public._market_draft_done, v4.58),
     or the market's own draft_done once a page has read it (js/market.js), whichever lands first. A function, so it reads
     the draft as it stands when asked */
  M.draftDone = function () {
    var st = M.draft && M.draft.state, k = S2.market && S2.market.status ? S2.market.status() : null;
    return !!(st && st.status === "complete") || !!(k && k.loaded && k.draftDone);
  };
  M.suspensions = arr(D.suspensions);
  M.config = { site: obj(obj(D.config).site), flags: obj(obj(D.config).flags) };
  M.careerGames = obj(D.career);
  /* games a member played in seasons other than the one on screen (QA functional 2026-11-25: on Season 2 a Season 1
     veteran's profile read "No league games yet" beside a rating earned in 14 games). careerGames is every season's
     total; the season on screen's games are taken off.
     QA round 2 (league, 2026-11-25): "the season on screen's games" are counted the way careerGames is
     (career_games_played: distinct final, unvoided games, every stage): the games in this season's box scores with a
     line of theirs. It took the larger of the two season lines before, which is regular season only and folds a
     two-role player's games in goal into their skater games, so on the Season 1 archive a skater who also played in
     goal read "3 games in other seasons", and every playoff game counted as another season's.
     shortcut: the seasons themselves are not named (careerGames is one total); s2_league carrying per-season career
     lines is the durable fix (QA core report), and then the profile can list each season's games */
  M.careerEarlier = (pid) => {
    const here = gamesOf(pid).filter((gid) => GAME[gid] && GAME[gid].isFinal && !GAME[gid].voided).length;
    return Math.max(0, num(M.careerGames[pid]) - here);
  };
  /* every member the league read lists (body.people), for a form that picks a member by name: M.players holds only the
     members with a roster spot, a line, a rating or a sign-up (QA nits 2026-11-25: six could not be written to) */
  M.members = arr(D.people).map((x) => ({ id: x.id, tag: x.gamertag || x.display_name || null, role: x.role || null })).filter((x) => x.id && x.tag)
    .sort((a, b) => String(a.tag).toLowerCase().localeCompare(String(b.tag).toLowerCase()));

  /* ---------- standings (02) with CG.standings order, race math and power rankings ---------- */
  const PO = obj(VIEW.playoff || (rowOf(1) || {}).playoff);
  M.playoffFormat = { perDiv: PO.per_div || 3, rounds: PO.rounds || 3, bestOf: PO.best_of || 7, minGp: PO.min_gp || 16,
    roundNames: arr(PO.round_names).length ? PO.round_names : ["division semi-final", "division final", "final"] };
  M.cutLine = { after: M.playoffFormat.perDiv, label: "Top " + M.playoffFormat.perDiv + " in each division make the playoffs" };
  const regFinals = M.games.filter((g) => g.isFinal && g.stage === "regular" && g.hs != null);
  /* Rule 8.2's mini-table among the tied clubs only, the live engine's own (CG.h2hPoints: W 2, OT loss 1, a forfeit never
     gives the OT point), on the finals as they stand now; a forfeit by both clubs is two losses, so it adds nothing */
  const h2h = (codes) => CG.h2hPoints({ results: regFinals.filter((g) => g.forfeit !== "both").map((g) => {
    const score = {}; score[g.home] = g.hs; score[g.away] = g.as; return { home: g.home, away: g.away, score: score, ot: !!g.ot, forfeit: g.forfeit || null }; }) }, codes);
  const order = (rows) => {
    const groups = {}; rows.forEach((r) => { (groups[r.pts] = groups[r.pts] || []).push(r); });
    Object.keys(groups).forEach((k) => { const g = groups[k]; if (g.length > 1) { const hp = h2h(g.map((r) => r.code)); g.forEach((r) => { r.h2h = hp[r.code]; }); } });
    return rows.slice().sort((a, b) => b.pts - a.pts || num(b.h2h) - num(a.h2h) || b.rw - a.rw || b.diff - a.diff || b.gf - a.gf);
  };
  const BASE = arr(D.standings).map((r) => Object.assign({}, r, { team: M.team(r.code), href: "#/club/" + r.code, maxPts: r.pts + 2 * num(r.games_left), h2h: null }));
  /* one division ranked: the order, the cut line and the race marks. Run at load */
  const rankDiv = (list) => {
    list.forEach((r) => { r.h2h = null; });   /* a tie broken earlier must not linger once the tie is gone */
    const rows = order(list), per = M.playoffFormat.perDiv;
    rows.forEach((r, i) => {
      r.rank = i + 1; r.inPlayoffs = r.rank <= per;
      const others = rows.filter((o) => o !== r), maxes = others.map((o) => o.maxPts).sort((a, b) => b - a);
      const T = maxes[per - 1] == null ? -1 : maxes[per - 1];          /* the per-th best ceiling among the others */
      r.clinched = others.every((o) => o.maxPts < r.pts) ? "division" : r.pts > T ? "playoff" : null;
      r.eliminated = others.filter((o) => o.pts > r.maxPts).length >= per;
      r.magic = r.clinched || r.eliminated ? 0 : Math.max(0, T + 1 - r.pts);   /* points this club gains or the threat loses */
      r.mark = r.clinched === "division" ? "z" : r.clinched ? "x" : r.eliminated ? "e" : null;
    });
    return rows;
  };
  M.divisions = M.league.divisions.map((d) => ({ division: d, rows: rankDiv(BASE.filter((r) => r.division === d)) }));
  /* power rankings: port of CG team OVR (part2_engine.js:710-760): record 38, goal diff 22, goaltending 14, depth 14, form 12 */
  const power = () => {
    const gs = {}; let lsv = 0, lsa = 0;
    Object.keys(BOX).forEach((gid) => { const g = GAME[gid]; if (!g || !g.isFinal || !regular(gid)) return;
      arr(BOX[gid]).forEach((r) => { const o = boxRow(r, gid); if (o.role !== "G") return; const t = gs[o.club] = gs[o.club] || { sv: 0, sa: 0 }; t.sv += num(o.sv); t.sa += num(o.sa); lsv += num(o.sv); lsa += num(o.sa); }); });
    const lgSvp = lsa ? lsv / lsa : 0.885;
    const rows = BASE.map((t) => {
      const gsx = gs[t.code] || { sv: 0, sa: 0 };
      const gt = gsx.sa ? Math.min(1, Math.max(0, 0.5 + ((gsx.sv + 35 * lgSvp) / (gsx.sa + 35) - lgSvp) / 0.15)) : 0.5;
      const gd = t.gp ? Math.min(1, Math.max(0, (t.diff / t.gp + 0.9) / 1.8)) : 0.5;
      const top9 = M.players.filter((p) => p.club === t.code && p.rostered && p.ovr).map((p) => p.ovr.ovr).sort((a, b) => b - a).slice(0, 9);
      const depth = top9.length ? Math.min(1, Math.max(0, (M.oldOvr(top9.reduce((a, b) => a + b, 0) / 9) - 63) / 34)) : 0.5;   /* the depth band was set on the old scale (v4.48 reads it back) */
      const l5 = arr(t.last5).filter((x) => x === "W").length / Math.max(1, arr(t.last5).length);
      const mix = (t.pts_pct * 38 + gd * 22 + gt * 14 + depth * 14 + l5 * 12) / 100;
      return { code: t.code, team: t.team, ovr: Math.round(60 + Math.min(1, mix) * 36), pts: t.pts,
        parts: { record: Math.round(t.pts_pct * 100), goalDiff: Math.round(gd * 100), goaltending: Math.round(gt * 100), depth: Math.round(depth * 100), form: Math.round(l5 * 100) } };
    }).sort((a, b) => b.ovr - a.ovr || b.pts - a.pts);
    const last = Math.max(0, ...regFinals.map((g) => num(g.week)));   /* movement vs the table before the last completed week */
    const snap = {}; BASE.forEach((t) => { let pts = 0, gp = 0, diff = 0;
      regFinals.forEach((g) => { if (g.week >= last || (g.home !== t.code && g.away !== t.code)) return; gp++;
        const opp = g.home === t.code ? g.away : g.home; diff += num(scoreOf(g, t.code)) - num(scoreOf(g, opp));
        if (g.winner === t.code) pts += 2; else if (g.decision === "ot") pts += 1; });
      snap[t.code] = gp ? (pts / (gp * 2)) * 100 + diff : 0; });
    const prev = BASE.map((t) => t.code).sort((a, b) => snap[b] - snap[a]);
    return rows.map((r, i) => Object.assign(r, { rank: i + 1, prev: prev.indexOf(r.code) + 1, move: prev.indexOf(r.code) + 1 - (i + 1), href: "#/club/" + r.code }));
  };
  let POWER = null;
  M.standings = (view) => {
    const v = view || "division";
    if (v === "league") return order(M.divisions.reduce((a, d) => a.concat(d.rows), []).map((r) => Object.assign({}, r, { h2h: null }))).map((r, i) => Object.assign(r, { leagueRank: i + 1 }));
    if (v === "race") return M.divisions.map((d) => ({ division: d.division, rows: d.rows, leader: d.rows[0] || null,
      note: d.rows.map((r) => r.mark === "z" ? r.code + " clinched the division" : r.mark === "x" ? r.code + " clinched a playoff spot" : r.mark === "e" ? r.code + " eliminated" : null).filter(Boolean) }));
    if (v === "playoffs") {
      const f = M.playoffFormat;
      return { projected: true, format: f, note: "Projected from today's table. The first seed in each division has a bye through the opening round; the second seed meets the third; the winner meets the first seed; the two division champions meet in the final.",
        divisions: M.divisions.map((d) => { const s = d.rows.slice(0, f.perDiv);
          return { division: d.division, seeds: s, rounds: [{ name: f.roundNames[0], series: [{ high: s[1] || null, low: s[2] || null }], bye: s[0] || null },
            { name: f.roundNames[1], series: [{ high: s[0] || null, low: null }] }] }; }),
        final: { name: f.roundNames[f.rounds - 1] || "final", series: [{ high: null, low: null }] } };
    }
    if (v === "power") return POWER || (POWER = power());
    return M.divisions;
  };
  /* ---------- game detail ---------- */
  /* Three Stars: the live formula (part_live.js:1163-1177); a two-role game counts both lines, unlinked lines never star */
  const starVal = (o, won) => (o.role === "G" ? num(o.sv) * 0.1 + (o.so ? 3 : 0) + (won ? 2 : 0) + (o.sa ? num(o.sv) / o.sa : 0) * 2
    : num(o.g) * 3 + num(o.a) * 2 + num(o.sog) * 0.15 + Math.max(0, num(o.pm)) * 0.3);
  M.game = (id) => {
    const g = GAME[id]; if (!g) return null;
    const x = Object.assign({}, g, { homeTeam: M.team(g.home), awayTeam: M.team(g.away), box: {}, totals: {}, stars: [], twoRole: [], unidentified: 0 });
    x.box[g.home] = []; x.box[g.away] = [];
    const rows = arr(BOX[id]).map((r) => boxRow(r, id)), roles = {};
    rows.forEach((o) => { if (o.pid) (roles[o.pid] = roles[o.pid] || new Set()).add(o.role); });
    rows.forEach((o) => {
      const p = P[o.pid];
      o.tag = o.pid ? tagOf(o.pid) || "Unknown player" : "Unidentified player"; o.href = o.pid ? "#/player/" + o.pid : null;
      o.unidentified = !o.pid; o.former = !!(p && !p.rostered); o.twoRole = !!(o.pid && roles[o.pid].size > 1);   /* both roles in THIS game */
      o.seasonTwoRole = !!(p && p.roles.length === 2); o.offRole = !!(p && p.roles.length === 2 && p.mainRole !== o.role);   /* e.g. a skater who played goal tonight */
      o.posName = M.posName(o.pos); o.svpct = o.role === "G" ? r3(div(num(o.sv), num(o.sa))) : null;
      if (o.unidentified) x.unidentified++;
      (x.box[o.club] = x.box[o.club] || []).push(o);
    });
    Object.keys(x.box).forEach((c) => {
      x.box[c].sort((a, b) => (a.role === b.role ? (M.POS_RANK[a.pos] || 9) - (M.POS_RANK[b.pos] || 9) || b.p - a.p : a.role === "S" ? -1 : 1));
      const t = x.totals[c] = { g: 0, a: 0, sog: 0, hits: 0, blk: 0, tk: 0, gv: 0, int: 0, pim: 0, fow: 0, fot: 0, pass: 0, pass_att: 0, poss_s: 0, sv: 0, sa: 0, ppg: 0 };
      x.box[c].forEach((o) => { Object.keys(t).forEach((k) => { t[k] += num(o[k]); }); });
      /* shots, time on attack and passing are EA's club figures (clubRow); a game with a box score always has them (stats.test.cjs) */
      const cr = clubRow(id, c) || {};
      if (cr.shots != null) t.sog = cr.shots;
      t.toa = cr.toa == null ? null : cr.toa; t.passc = cr.passc == null ? null : cr.passc; t.passa = cr.passa == null ? null : cr.passa;
      t.fo_pct = r3(div(t.fow, t.fot)); t.pass_pct = r3(div(num(t.passc), num(t.passa))); t.sv_pct = r3(div(t.sv, t.sa)); t.pp = c === g.home ? g.home_pp : g.away_pp;
    });
    const cand = {};
    rows.forEach((o) => { if (!o.pid) return; const k = o.pid + "|" + o.club, cd = cand[k] = cand[k] || { pid: o.pid, tag: o.tag, club: o.club, val: 0, g: 0, lines: [] };
      cd.val += starVal(o, x.winner === o.club); cd.g += o.role === "S" ? num(o.g) : 0; cd.lines.push(o); });
    x.stars = Object.keys(cand).map((k) => cand[k]).sort((a, b) => b.val - a.val || b.g - a.g).slice(0, 3)
      .map((s, i) => ({ n: i + 1, pid: s.pid, tag: s.tag, club: s.club, href: "#/player/" + s.pid, lines: s.lines, score: Math.round(s.val * 10) / 10 }));
    x.twoRole = Object.keys(roles).filter((pid) => roles[pid].size > 1).map((pid) => ({ pid: pid, tag: tagOf(pid) }));
    x.formerCount = rows.filter((o) => o.former).length;
    x.offRoleCount = rows.filter((o) => o.offRole).length;
    return x;
  };

  /* ---------- nights ---------- */
  M.nights = (opts) => {
    const o = opts || {}, map = {};
    M.games.forEach((g) => { if (o.when === "past" && g.state === "upcoming") return; if (o.when === "upcoming" && g.state !== "upcoming") return;
      (map[g.night] = map[g.night] || []).push(g); });
    return Object.keys(map).sort().reverse().map((d) => {
      const games = map[d].slice().sort(by((g) => g.at + g.home, "asc")), slots = {};
      games.forEach((g) => { (slots[g.slot] = slots[g.slot] || { slot: g.slot, time: g.time, at: g.at, games: [] }).games.push(g); });
      return { date: d, label: M.etLong(d), short: M.etDate(d), week: games[0].week, games: games, slots: Object.keys(slots).map((k) => slots[k]).sort(by("at", "asc")),
        finals: games.filter((g) => g.isFinal).length, upcoming: games.filter((g) => g.state === "upcoming").length, forfeits: games.filter((g) => g.forfeit).length };
    });
  };

  /* a season's close: its final table, its trophies and the Cup roster (commissioner, 2026-11-21, the trophy room).
     S2.buildModel counts it from the season's own games once the season is complete and its champion is filed (closeOf,
     below); the fixture carries it as data, read from production 2026-11-21 to 23. Never read from the standings table
     (review 2026-11-14: one changed Boston result made the "final" Vancouver v Detroit). A season whose close this body
     does not hold has none here, and M.partial.archive says why. */
  const CLOSE = obj(D.close);
  const closedSeasons = Object.keys(CLOSE).map(Number).sort((a, b) => a - b);
  const cupOf = (n) => arr((CLOSE[n] || {}).trophies).filter((t) => t.key === "stanley_cup")[0] || null;
  /* Today's third scene, the off-season (commissioner, 2026-11-14: "Build it out using the same Apple design skills as the
     rest of the site"): the Saturday after the latest closed season's final, with its real champion. Nothing here reads or
     writes the standings. */
  M.offseasonDemo = (() => {
    let memo;
    return () => {
      if (memo !== undefined) return memo;
      const n = closedSeasons[closedSeasons.length - 1], s = n ? rowOf(n) : null, cup = n ? cupOf(n) : null;
      if (!n) return (memo = null);   /* no season has closed in this body */
      if (!s || !s.playoffs_start_at || !cup || !M.team(cup.club) || !M.team(cup.over)) {
        console.error("M.offseasonDemo: Season " + n + " has no playoff start, or its final's clubs are not clubs in this body");
        return (memo = null);
      }
      /* Rule 8.3: one round a game-week, Wednesday to Friday, so the final is the last round's week */
      const finalWed = addDays(M.etDay(s.playoffs_start_at), 7 * (M.playoffFormat.rounds - 1));
      return (memo = { sample: false, season: n, champion: cup.club, runnerUp: cup.over, w: cup.w, l: cup.l,
        now: CG.etISO(addDays(finalWed, 3), "12:00"), note: "The off-season, the Saturday after Season " + n + "'s final, with its real champion." });
    };
  })();

  /* ---------- stats ---------- */
  M.STATS = {
    p: { label: "Points", short: "PTS", role: "S" }, g: { label: "Goals", short: "G", role: "S" }, a: { label: "Assists", short: "A", role: "S" },
    pm: { label: "Plus/minus", short: "+/-", role: "S" }, sog: { label: "Shots", short: "SOG", role: "S" }, hits: { label: "Hits", short: "HIT", role: "S" },
    blk: { label: "Blocked shots", short: "BLK", role: "S" }, tk: { label: "Takeaways", short: "TK", role: "S" }, int: { label: "Interceptions", short: "INT", role: "S" },
    gv: { label: "Giveaways", short: "GV", role: "S", better: "low" }, pim: { label: "Penalty minutes", short: "PIM", role: "S", better: "low" },
    ppg: { label: "Power-play goals", short: "PPG", role: "S" }, shg: { label: "Shorthanded goals", short: "SHG", role: "S" }, gwg: { label: "Game-winning goals", short: "GWG", role: "S" },
    pts_pg: { label: "Points per game", short: "P/GP", role: "S", rate: true, dec: 2 }, g_pg: { label: "Goals per game", short: "G/GP", role: "S", rate: true, dec: 2 },
    a_pg: { label: "Assists per game", short: "A/GP", role: "S", rate: true, dec: 2 }, sog_pg: { label: "Shots per game", short: "SOG/GP", role: "S", rate: true, dec: 2 },
    hits_pg: { label: "Hits per game", short: "HIT/GP", role: "S", rate: true, dec: 2 }, blk_pg: { label: "Blocks per game", short: "BLK/GP", role: "S", rate: true, dec: 2 },
    tk_pg: { label: "Takeaways per game", short: "TK/GP", role: "S", rate: true, dec: 2 }, int_pg: { label: "Interceptions per game", short: "INT/GP", role: "S", rate: true, dec: 2 },
    gv_pg: { label: "Giveaways per game (EA counts every lost puck)", short: "GV/GP", role: "S", rate: true, dec: 2, better: "low" },
    pm_pg: { label: "Plus/minus per game", short: "+/-/GP", role: "S", rate: true, dec: 2 }, pim_pg: { label: "Penalty minutes per game", short: "PIM/GP", role: "S", rate: true, dec: 2, better: "low" },
    poss_s_pg: { label: "Possession per game (seconds)", short: "POSS", role: "S", rate: true, dec: 0 },
    shot_pct: { label: "Shooting percentage", short: "SH%", role: "S", rate: true, pct: true }, pass_pct: { label: "Pass completion", short: "PASS%", role: "S", rate: true, pct: true },
    fo_pct: { label: "Faceoff win rate at center", short: "FO%", role: "S", rate: true, pct: true },
    onnet_pct: { label: "Shots on net", short: "NET%", role: "S", rate: true, pct: true },
    w: { label: "Wins", short: "W", role: "G" }, sv: { label: "Saves", short: "SV", role: "G" }, so: { label: "Shutouts", short: "SO", role: "G" }, qs: { label: "Quality starts", short: "QS", role: "G" },
    sv_pct: { label: "Save percentage", short: "SV%", role: "G", rate: true, dec: 3, svp: true }, gaa: { label: "Goals against average", short: "GAA", role: "G", rate: true, dec: 2, better: "low" },
    sv_pg: { label: "Saves per game", short: "SV/GP", role: "G", rate: true, dec: 2 }, sa_pg: { label: "Shots against per game", short: "SA/GP", role: "G", rate: true, dec: 2 },
    so_pg: { label: "Shutouts per game", short: "SO/GP", role: "G", rate: true, dec: 3 }, brk_sv_pct: { label: "Breakaway save percentage", short: "BRK SV%", role: "G", rate: true, dec: 3, svp: true },
    dsv: { label: "Desperation saves", short: "DS", role: "G" }, sop: { label: "Shutout periods", short: "SOP", role: "G" },
    dsv_pg: { label: "Desperation saves per game", short: "DS/GP", role: "G", rate: true, dec: 2 }, sop_pg: { label: "Shutout periods per game", short: "SOP/GP", role: "G", rate: true, dec: 2 },
    psv_pct: { label: "Penalty shot save percentage", short: "PS%", role: "G", rate: true, dec: 3, svp: true },
    gp: { label: "Games played", short: "GP" }
  };
  M.display = (stat, v) => {
    const s = M.STATS[stat] || {};
    if (v == null || isNaN(v)) return "–";
    if (s.pct) return (v * 100).toFixed(1) + "%";
    if (s.svp) return v.toFixed(3).replace(/^0/, "");
    if (stat === "pm" || stat === "pm_pg") return (v > 0 ? "+" : "") + fmtN(v, s.dec || 0);
    return fmtN(v, s.dec || 0);
  };
  M.lines = (filter) => {
    const f = filter || {};
    let out = LINES.filter((l) => (!f.role || l.role === f.role) && (!f.club || l.club === String(f.club).toUpperCase()) && (!f.group || l.group === f.group) &&
      (!f.pos || l.pos === f.pos || l.posPlayed === f.pos) && (f.former == null || l.former === !!f.former) && (!f.minGp || num(l.gp) >= f.minGp) &&
      (!f.pid || l.pid === f.pid) && (!f.q || String(l.tag).toLowerCase().indexOf(String(f.q).toLowerCase()) >= 0));
    if (f.sort) out = out.slice().sort(by(f.sort, f.dir || ((M.STATS[f.sort] || {}).better === "low" ? "asc" : "desc")));
    return f.limit ? out.slice(0, f.limit) : out;
  };
  M.line = (pid, role) => { const p = P[pid]; if (!p) return null; return p.lines[role || p.mainRole] || null; };
  M.titles = (category) => arr(obj(D.honors).titles).filter((t) => !category || t.category === category).map((t) => ({ category: t.category, label: TITLE_LABEL[t.category],
    rank: t.place, id: t.profile_id, tag: t.gamertag, club: (P[t.profile_id] || {}).club || null, gp: t.gp, total: t.total, value: t.per_game,
    display: t.category === "goaltending_title" ? fmtN(t.per_game, 2) + " GAA" : fmtN(t.per_game, 2) + " per game", href: "#/player/" + t.profile_id }));
  M.leaders = (stat, n, opts) => {
    if (/_title$/.test(stat)) return M.titles(stat).slice(0, n || 5);
    const o = opts || {}, s = M.STATS[stat]; if (!s) return [];
    const minGp = o.minGp != null ? o.minGp : s.rate ? M.SETTLE_GP : 1, dir = s.better === "low" ? "asc" : "desc";
    const rows = M.lines({ role: o.role || s.role, club: o.club, group: o.group, minGp: minGp }).filter((l) => l[stat] != null).sort(by(stat, dir));
    let rank = 0, prev;
    return rows.slice(0, n || 10).map((l, i) => { if (l[stat] !== prev) rank = i + 1; prev = l[stat];
      return { rank: rank, id: l.pid, tag: l.tag, club: l.club, pos: l.pos, group: l.group, gp: l.gp, value: l[stat], display: M.display(stat, l[stat]), href: l.href, line: l }; });
  };

  /* the games each player appears in, indexed once (2026-11-24): M.log scanned all 1,525 box rows on every call, and a
     trade reading values many players at a time, so one pass over three bid nights took 10 seconds and a test run sat at
     full CPU for 38 minutes under load. The rows never change after a build; each game's state is still read live below,
     so a void still shows */
  let BY_PID = null;
  const gamesOf = (pid) => {
    if (!BY_PID) {
      BY_PID = {}; const ix = BCOLS.indexOf("pid");
      Object.keys(BOX).forEach((gid) => arr(BOX[gid]).forEach((r) => { const id = r[ix]; if (!id) return; const l = BY_PID[id] = BY_PID[id] || []; if (l[l.length - 1] !== gid) l.push(gid); }));
    }
    return BY_PID[pid] || [];
  };
  /* per-game log for ANY player, from the box (05 holds the same rows for the top 20 and is the cross-check) */
  M.log = (pid, role) => {
    const p = P[pid]; if (!p) return [];
    const rl = role || p.mainRole, out = [];
    gamesOf(pid).forEach((gid) => {
      const g = GAME[gid]; if (!g || !g.isFinal || g.voided || g.stage !== "regular" || g.hs == null) return;
      const mine = arr(BOX[gid]).map((r) => boxRow(r, gid)).filter((o) => o.pid === pid && o.role === rl); if (!mine.length) return;
      const o = mine.reduce((acc, m) => { if (!acc) return Object.assign({}, m); Object.keys(m).forEach((k) => { if (typeof m[k] === "number" && !/^rat_/.test(k)) acc[k] = num(acc[k]) + m[k]; }); return acc; }, null);
      const club = o.club, opp = g.home === club ? g.away : g.home, gf = scoreOf(g, club), ga = scoreOf(g, opp);
      out.push(Object.assign(o, { at: g.at, night: g.night, date: g.date, week: g.week, opp: opp, home: g.home === club,
        result: g.winner === club ? "W" : g.decision === "ot" && !g.forfeit ? "OTL" : "L", score: gf + "-" + ga, ff: g.forfeit || null, href: g.href }));
    });
    return out.sort(by("at", "asc"));
  };

  /* a player's CAREER (commissioner, 2026-11-20: "build in the stats page that it should always show a player's full history
     on their player stats profile"; the live site's twin is the profile's Career card, v4.54 CG.careerLines): a row per
     season, kind of game and role, on any club, rostered or not, each row the season line itself (one definition of a
     season's numbers), its clubs in the order the player first played for them (from M.log). The snapshot holds the
     season in play's regular season only, so a row is that; playoffs and pre-season join as rows of their own when a
     snapshot carries them. */
  const LINE_SEASON = VIEW_N;
  M.career = (pid) => {
    const p = P[pid]; if (!p) return [];
    return p.roles.map((r) => {
      const L = p.lines[r], clubs = [];
      M.log(pid, r).forEach((g) => { if (g.club && clubs.indexOf(g.club) < 0) clubs.push(g.club); });
      return { season: LINE_SEASON, stage: "reg", role: r, clubs: clubs.length ? clubs : [L.club], line: L };
    }).concat(arr(D.playoffLines).filter((l) => l.pid === pid).map((l) => ({ season: LINE_SEASON, stage: "po", role: l.role, clubs: arr(l.clubs).length ? l.clubs : [l.club],
      line: Object.assign({}, l, { sv_pct: r3(div(num(l.sv), num(l.sa))), gaa: r3(div(num(l.ga), num(l.gp))) }) })));
  };

  /* ---------- ranks: where a line stands in its position group (players with 6+ games there) ----------
     Commissioner, 2026-10-20: "Instead of showing stats in percentile, can you just list it like 1st in this category or
     tied for 24th or something? Then the numbers may not confuse people as much." (the first look had read a 6th
     percentile as sixth of 18). This replaced M.percentile, which interpolated a percentile from query 06's quantile
     summaries; nothing prints a percentile now.
     The pool: every season line of the same role whose position group PLAYED (its most-played group, shapeLine) is this
     line's, with M.SETTLE_GP or more games at that group and a value for the stat. Former players count (every line
     counts). It is the real pool, so its count is not always query 06's n: 06 also counted a player at a group that is
     not their most-played one (Wingers 31 here against 35 there, Defense 35 against 36; Centers 18 and Goaltenders 18
     agree), while a line carries one group. Faceoffs rank only among centers (a line's fow and fot are its center games, AT_CENTER) and only
     with FO_MIN or more taken, so one lucky draw is not 1st. Best first, lower is better where M.STATS says so (GAA,
     giveaways, penalty minutes). Values equal AT THE PRECISION SHOWN (M.display) share a rank and the next rank skips
     (1, 2, 2, 4). score draws the bars: best 100, last 0, (n - rank) / (n - 1) x 100, 100 when n is 1. A tie that runs
     down to last place draws at the middle of the places it shares, not its best one (review 2026-10-20: 11 of 18
     goaltenders with no shutouts read "Tied for 8th of 18" with the bar past the middle tick, above "Median 0.000");
     tied for 1st stays full. Under M.SETTLE_GP games at the group a line is few: no rank, though n and the median
     still describe the pool. */
  M.rankKeys = (role) => (role === "G" ? ["sv_pct", "gaa", "sv_pg", "sa_pg", "so_pg", "brk_sv_pct", "dsv_pg", "sop_pg"]
    : ["pts_pg", "g_pg", "a_pg", "sog_pg", "shot_pct", "onnet_pct", "pass_pct", "fo_pct", "hits_pg", "blk_pg", "tk_pg", "int_pg", "gv_pg", "pm_pg", "pim_pg", "poss_s_pg"]);
  const FO_MIN = 10, FO_GROUP = { C: 1 };
  /* the number a reader sees, as a number: "+0.50" 0.5, "35.1%" 35.1, ".912" 0.912, and "-0.00" -0, which === 0 */
  const shown = (stat, v) => Number(M.display(stat, v).replace(/[^\d.-]/g, ""));
  const ordinal = (n) => (S2.ord ? S2.ord(n) : n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"));
  const middle = (a) => { a = a.slice().sort((x, y) => x - y); const n = a.length; return n ? (n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2) : null; };
  /* a place among keys, best first: equal keys share a place and the next skips (1, 2, 2, 4). score draws the bars */
  const standing = (keys, mine, low) => {
    const n = keys.length, rank = 1 + keys.filter((k) => (low ? k < mine : k > mine)).length, tied = keys.filter((k) => k === mine).length, toLast = tied > 1 && rank + tied - 1 === n;
    return { rank: rank, tied: tied, score: n === 1 ? 100 : (n - (toLast ? rank + (tied - 1) / 2 : rank)) / (n - 1) * 100 };
  };
  M.rank = (playerLine, stat) => {
    const l = typeof playerLine === "string" ? M.line(playerLine) : playerLine; if (!l || !l.group) return null;
    const s = M.STATS[stat]; if (!s || (s.role && s.role !== l.role) || (stat === "fo_pct" && !FO_GROUP[l.group])) return null;
    const ok = (x) => x[stat] != null && (stat !== "fo_pct" || num(x.fot) >= FO_MIN); if (!ok(l)) return null;
    const pool = LINES.filter((x) => x.role === l.role && x.group === l.group && num(x.groupGp) >= M.SETTLE_GP && ok(x));
    const low = s.better === "low", mine = shown(stat, l[stat]), keys = pool.map((x) => shown(stat, x[stat])), n = pool.length;
    const few = num(l.groupGp) < M.SETTLE_GP;
    const place = few ? { rank: null, tied: null, score: null } : standing(keys, mine, low), rank = place.rank, tied = place.tied, score = place.score, med = middle(pool.map((x) => x[stat]));
    return { stat: stat, label: s.label, short: s.short, value: l[stat], display: M.display(stat, l[stat]), group: l.group, groupName: M.GROUP_NAME[l.group], groupMany: M.GROUP_MANY[l.group],
      n: n, rank: rank, tied: tied, few: few, score: score, tone: few ? "" : score >= 75 ? "hi" : score <= 25 ? "lo" : "",   /* top quarter, bottom quarter */
      text: few ? null : (tied > 1 ? "Tied for " : "") + ordinal(rank) + " of " + n, shortText: few ? null : (tied > 1 ? "T-" : "") + ordinal(rank),
      better: low ? "low" : "high", median: med, medianDisplay: M.display(stat, med) };
  };
  /* which of two ranks of one measure is higher: 1 for a, -1 for b, 0 level, null when they cannot be set side by side
     (either has too few games, or they rank in different pools). Ranks from pools of different sizes do not compare:
     9th of 18 centers is not above 13th of 35 defense players (review 2026-10-20: the head to head bolded the center
     while the radar drew the defender outside on every spoke). Within one pool rank, score and value agree. The trade
     head to head and the profile compare sheet both bold by this, never by the bar */
  M.rankBetter = (a, b) => (!a || !b || a.few || b.few || a.group !== b.group || a.n !== b.n ? null : a.rank < b.rank ? 1 : a.rank > b.rank ? -1 : 0);
  M.ranks = (playerLine) => { const l = typeof playerLine === "string" ? M.line(playerLine) : playerLine; return l ? M.rankKeys(l.role).map((k) => M.rank(l, k)).filter(Boolean) : []; };

  /* ---------- clubs as a whole ----------
     Commissioner, 2026-11-04, the team stats for next season and beyond: "Time on Attack, passing percentage, hits, blocks,
     takeaways, giveaways, interceptions, PIM, face off percentage." Shots, time on attack and passing are EA's club figures; the
     rest add up every line of the club's box scores (every line counts, a player who has left included). Faceoffs count
     every line at every position: they are the club's faceoffs, unlike a player's FO% (AT_CENTER). A rate is per game with a
     box score, because a forfeit with no ice time has none. Clubs level at the precision shown share a place, as players do. */
  const CLUB_STATS = {
    toa_pg: { label: "Time on attack", show: (v) => M.toi(Math.round(v)), key: (v) => Math.round(v) },
    pass_pct: { label: "Passing", show: (v) => (v * 100).toFixed(1) + "%", key: (v) => Math.round(v * 1000) },
    fo_pct: { label: "Faceoffs won", show: (v) => (v * 100).toFixed(1) + "%", key: (v) => Math.round(v * 1000) },
    hits_pg: { label: "Hits" }, blk_pg: { label: "Blocks" }, tk_pg: { label: "Takeaways" }, int_pg: { label: "Interceptions" },
    gv_pg: { label: "Giveaways", better: "low" }, pim_pg: { label: "Penalty minutes", better: "low" }
  };
  const CLUB_SUM = ["sog", "hits", "blk", "tk", "gv", "int", "pim", "fow", "fot", "toa", "passc", "passa"];
  let CLUB_ALL = null;
  const clubAll = () => {
    if (CLUB_ALL) return CLUB_ALL;
    const all = {};
    M.teams.forEach((t) => { const a = all[t.code] = { code: t.code, bx: 0, sa: 0, toaGames: 0 }; CLUB_SUM.forEach((k) => { a[k] = 0; }); });
    M.games.forEach((g) => {
      if (!g.isFinal || !g.hasBox || g.stage !== "regular") return;
      const gm = M.game(g.id); if (!gm) return;
      [g.home, g.away].forEach((c) => {
        const a = all[c], t = gm.totals[c], o = gm.totals[c === g.home ? g.away : g.home]; if (!a || !t) return;
        a.bx++; CLUB_SUM.forEach((k) => { a[k] += num(t[k]); }); a.sa += o ? num(o.sog) : 0; if (t.toa != null) a.toaGames++;
      });
    });
    Object.keys(all).forEach((c) => { const a = all[c];
      a.fo_pct = div(a.fow, a.fot); a.pass_pct = div(a.passc, a.passa);
      ["hits", "blk", "tk", "int", "gv", "pim"].forEach((k) => { a[k + "_pg"] = div(a[k], a.bx); });
      /* time on attack and passing are EA's club figures, which the database does not keep yet (s2-stats-list): a club with
         none has no figure, never 0:00 (data_layer: "not recorded", never 0) */
      a.toa_pg = div(a.toa, a.toaGames); });
    return (CLUB_ALL = all);
  };
  M.clubStats = (code) => clubAll()[String(code || "").toUpperCase()] || null;
  M.clubDisplay = (stat, v) => { const s = CLUB_STATS[stat] || {}; return v == null || isNaN(v) ? "–" : s.show ? s.show(v) : fmtN(v, 1); };
  M.clubRank = (code, stat) => {
    const s = CLUB_STATS[stat], a = M.clubStats(code); if (!s || !a || a[stat] == null) return null;
    const key = s.key || ((v) => Math.round(v * 10)), vals = Object.keys(clubAll()).map((c) => clubAll()[c][stat]).filter((v) => v != null), low = s.better === "low";
    const place = standing(vals.map(key), key(a[stat]), low), n = vals.length, med = middle(vals);
    return { stat: stat, label: s.label, value: a[stat], display: M.clubDisplay(stat, a[stat]), group: "club", groupMany: "clubs", n: n, rank: place.rank, tied: place.tied, few: false, score: place.score,
      tone: place.score >= 75 ? "hi" : place.score <= 25 ? "lo" : "", text: (place.tied > 1 ? "Tied for " : "") + ordinal(place.rank) + " of " + n, better: low ? "low" : "high", median: med, medianDisplay: M.clubDisplay(stat, med) };
  };

  /* ---------- ratings (07): one per position group played, 75 to 99 (v4.48) ---------- */
  const CAT_ORDER = { S: ["SHOOTING", "PASSING", "HANDEYE", "PHYSICALITY", "DEFENSE"], G: ["REFLEXES", "CONSISTENCY", "CLUTCHNESS"] };
  const CAT_LABEL = { SHOOTING: "Shooting", PASSING: "Passing", HANDEYE: "Hand-eye", PHYSICALITY: "Physical", DEFENSE: "Defense", REFLEXES: "Reflexes", CONSISTENCY: "Consistency", CLUTCHNESS: "Clutch" };
  const shapeRating = (r) => { const keys = CAT_ORDER[r.pos === "G" ? "G" : "S"], cats = obj(r.cats);
    return { id: r.pid, tag: r.tag, pos: r.pos, posName: { C: "Center", W: "Wing", D: "Defense", G: "Goaltender" }[r.pos], ovr: r.ovr, gp: r.gp, headline: !!r.headline, provisional: !!r.provisional, cats: cats,
      radar: { axes: keys.map((k) => CAT_LABEL[k]), a: keys.map((k) => (cats[k] == null ? 0 : M.ovrUnit(cats[k]))), values: keys.map((k) => (cats[k] == null ? null : cats[k])) } }; };
  M.ratings = (playerId) => (playerId == null ? arr(D.ratings).map(shapeRating)
    : (P[playerId] ? P[playerId].ratingRows.map(shapeRating).sort((a, b) => (b.headline - a.headline) || b.ovr - a.ovr) : []));

  /* ---------- honors ---------- */
  M.honors = {
    rule: "Statistical titles go to the best rate per game (fewest goals against per game for the Goaltending Title) among playoff-eligible players who reached their games-played floor at that position (Rule 9.2, Rule 8.3). They are filed when the regular season's last game is final; until then this is the race.",
    titles: Object.keys(TITLE_LABEL).reduce((a, k) => { a[k] = M.titles(k); return a; }, {}),
    potw: arr(obj(D.honors).potw).map((h) => ({ week: h.week, category: h.category, label: POTW_LABEL[h.category] || h.category, id: h.pid, tag: h.tag, club: h.club, line: h.line, href: "#/player/" + h.pid })),
  };
  M.honors.potwByWeek = Array.from(new Set(M.honors.potw.map((h) => h.week))).sort((a, b) => a - b).map((w) => ({ week: w, picks: M.honors.potw.filter((h) => h.week === w) }));
  /* a season's statistical titles AS FILED (Rule 9.2: filed when the regular season's last game goes final): the awards
     rows (s2_league honors), each with the holder, the club and the line the database wrote, "4.91 per game (172 in 35
     games)" or "2.68 goals against per game over 25 games" (file_statistical_titles). gp and total are read from that
     line; a goaltending line names no total, so it is the holder's goals against when their line in goal is on screen
     with those games, else the rate times the games. M.honors.titles is the race, never the winners.
     shortcut: the numbers come from the filed sentence; an awards column for gp and total would make this a plain read */
  const AWARDS = arr(D.awards);
  const TITLE_LINE = /^([\d.]+) per game \((\d+) in (\d+) games?\)$/, GOALIE_LINE = /^([\d.]+) goals against per game over (\d+) games?$/;
  M.filedTitles = (n) => AWARDS.filter((a) => a.season === n && TITLE_LABEL[a.category]).sort((a, b) => Object.keys(TITLE_LABEL).indexOf(a.category) - Object.keys(TITLE_LABEL).indexOf(b.category)).map((a) => {
    const p = P[a.pid] || null, m = TITLE_LINE.exec(a.line || ""), g = GOALIE_LINE.exec(a.line || "");
    if (!p) console.error("M.filedTitles: the " + TITLE_LABEL[a.category] + " of Season " + n + " names a player this body does not hold");
    if (!m && !g) console.error("M.filedTitles: the " + TITLE_LABEL[a.category] + " of Season " + n + " has a line this model cannot read");
    const gp = m ? +m[3] : g ? +g[2] : null, gl = p && n === VIEW_N ? p.lines.G : null;
    const total = m ? +m[2] : g ? (gl && num(gl.gp) === gp ? num(gl.ga) : Math.round(+g[1] * gp)) : null;
    return { category: a.category, label: TITLE_LABEL[a.category], tag: p ? p.tag : null, club: a.club, gp: gp, total: total,
      value: total != null && gp ? Math.round(total / gp * 1000) / 1000 : null, id: p ? p.id : null, href: p ? p.href : null };
  });

  /* ---------- trophies ----------
     Commissioner, 2026-11-21: "add team awards for winning the Presidents' Trophy, Stanley Cup trophy, and any other stat
     based awards that are handed out in real life ... add awards to players who won the stanley cup and any other stat
     awards". Rulings that day: the NHL's stat trophies sit BESIDE the league's four titles and are counted the NHL's way
     (season totals), while the titles keep Rule 9.2's rate per game; the Stanley Cup goes to every player on the
     champion's roster at the final ("On Boston's roster at the final", all twenty). The NHL hands out three trophies by the
     numbers alone (Art Ross, Rocket Richard, Jennings); the rest are voted. The rulebook names only the league
     championship and the four titles (Rule 9.1), so the trophy names are this concept's proposal.
     Real, read 2026-11-21 from the live Season 1 archive (final standings, the playoff rounds, the awards row 'champion',
     box-score totals per player and Boston's roster_spots), so never marked sample. Ids, not tags: a gamertag can change.
     shortcut: copied by hand from the live database; replace with the snapshot's own rows when a re-snapshot exports them */
  /* how: what the award is, in a few words; every award row says it and then the numbers that won it (commissioner,
     2026-11-23: "do not add runner ups to them, just a quick description of what the award is, and the stats that mattered
     for it") */
  M.TROPHY = {
    stanley_cup: { name: "Stanley Cup", team: true, how: "The playoff champion" },
    presidents_trophy: { name: "Presidents' Trophy", team: true, how: "The best regular-season record" },
    wales_trophy: { name: "Prince of Wales Trophy", short: "Wales Trophy", team: true, how: "The East Division's playoff champion" },
    campbell_bowl: { name: "Clarence S. Campbell Bowl", short: "Campbell Bowl", team: true, how: "The West Division's playoff champion" },
    art_ross: { name: "Art Ross Trophy", how: "The most points in the regular season", pair: "points_title", unit: "points" },
    rocket_richard: { name: "Maurice \"Rocket\" Richard Trophy", short: "Rocket Richard Trophy", how: "The most goals in the regular season", pair: "goals_title", unit: "goals" },
    /* the NHL's floor is 25 of 82 games; 25 / 82 x 54 = 16.46, which Rule 8.3's rounding (above four tenths rounds up) makes 17 */
    jennings: { name: "William M. Jennings Trophy", short: "Jennings Trophy", how: "The goaltender of the club that allowed the fewest goals", pair: "goaltending_title", unit: "goals against" }
  };
  /* the four titles in the same words (Rule 9.2) */
  M.TITLE_HOW = { points_title: "The best points per game in the regular season", goals_title: "The best goals per game in the regular season",
    assists_title: "The best assists per game in the regular season", goaltending_title: "The fewest goals against per game in the regular season" };
  /* D.close[n]: table [{ club, w, l, otl, pts, gf, ga, out }] where out is how the club's season ended (cup won it; final
     lost the final; division lost its division final; first lost the opening round; none missed the playoffs), trophies
     [{ key, club, over, w, l, pid, total, gp }] in M.TROPHY's order, and cup, every player on the champion's roster at
     the final */
  /* a season's final table, each club with its division place; null for a season not yet closed */
  M.seasonClose = (n) => {
    const s = CLOSE[n]; if (!s) return null;
    const rows = s.table.map((r) => Object.assign({ team: M.team(r.club) }, r));
    rows.forEach((r) => { r.divRank = 1 + rows.filter((o) => o.team && r.team && o.team.division === r.team.division && o.pts > r.pts).length; });
    return { season: n, table: rows, cup: s.cup.slice() };
  };
  /* a season's trophies, team ones first, each with its holder resolved; a holder the snapshot does not know is an error */
  M.trophies = (n) => arr((CLOSE[n] || {}).trophies).map((t) => {
    const def = M.TROPHY[t.key] || {}, p = t.pid ? P[t.pid] || null : null;
    if (!M.TROPHY[t.key]) console.error("M.trophies: no trophy " + t.key);
    if (t.pid && !p) console.error("M.trophies: the " + def.name + " of Season " + n + " names a player this body does not hold");
    return Object.assign({ season: n, name: def.name, short: def.short || def.name, how: def.how, team: !!def.team, pair: def.pair || null, unit: def.unit || null,
      club: t.club, holder: p, tag: p ? p.tag : null, id: p ? p.id : null, href: def.team ? "#/club/" + t.club : p ? p.href : null }, t);
  });
  /* a season's Players of the Week, every week, from the awards rows (s2_league honors), each week in the order every
     honors surface shows them (CG.potwPicks: forward, skater, defense, goaltender); the shape of M.honors.potw. Today and
     Team HQ keep M.honors.potw, the weeks the body's season had named by its own clock */
  const POTW_ORDER = ["potw_forward", "potw_skater", "potw_defense", "potw_goalie"];
  M.honors.potwSeason = (n) => AWARDS.filter((a) => a.season === n && POTW_LABEL[a.category]).sort((a, b) => num(a.week) - num(b.week) || POTW_ORDER.indexOf(a.category) - POTW_ORDER.indexOf(b.category))
    .map((h) => ({ week: h.week, category: h.category, label: POTW_LABEL[h.category], id: h.pid, tag: P[h.pid] ? P[h.pid].tag : null, club: h.club, line: h.line, href: "#/player/" + h.pid }));
  M.honors.potwSeasonByWeek = (n) => { const all = M.honors.potwSeason(n);
    return Array.from(new Set(all.map((h) => h.week))).sort((a, b) => a - b).map((w) => ({ week: w, picks: all.filter((h) => h.week === w) })); };
  /* one order for honors wherever they are listed: the Cup, the team trophies, the NHL's stat trophies, the league's titles,
     then Players of the Week (newest first) and the title races of a season still being played */
  const HONOR_ORDER = ["stanley_cup", "presidents_trophy", "wales_trophy", "campbell_bowl", "art_ross", "rocket_richard", "jennings", "points_title", "goals_title", "assists_title", "goaltending_title"];
  M.honorRank = (h) => { const i = HONOR_ORDER.indexOf(h.key || h.category); return h.kind === "potw" ? 100 - num(h.week) / 100 : h.kind === "title_race" ? 200 + num(h.place) : i < 0 ? 99 : i; };
  /* the profile's honors: each trophy and filed title on its holder, the Cup on every name on the champion's roster */
  const seasonsWithAwards = Array.from(new Set(closedSeasons.concat(AWARDS.map((a) => a.season)))).sort((a, b) => a - b);
  seasonsWithAwards.forEach((n) => {
    const cup = M.trophies(n).filter((t) => t.key === "stanley_cup")[0];
    const give = (pid, h) => { if (P[pid]) P[pid].honors.push(Object.assign({ season: n }, h)); else console.error("M.trophies: Season " + n + "'s " + h.name + " names a player this body does not hold"); };
    M.trophies(n).filter((t) => !t.team).forEach((t) => give(t.pid, { kind: "trophy", key: t.key, name: t.name, short: t.short, club: t.club, total: t.total, gp: t.gp }));
    if (cup) arr(CLOSE[n].cup).forEach((pid) => give(pid, { kind: "trophy", key: "stanley_cup", name: cup.name, short: cup.short, club: cup.club, over: cup.over, w: cup.w, l: cup.l }));
    M.filedTitles(n).forEach((t) => { if (t.id) give(t.id, { kind: "title", category: t.category, name: t.label, short: t.label, club: t.club, value: t.value, total: t.total, gp: t.gp }); });
    /* the season on screen's weeks are on the holder already (D.honors.potw, above) */
    M.honors.potwSeason(n).filter((h) => !(n === VIEW_N && arr(obj(D.honors).potw).some((x) => x.pid === h.id && x.week === h.week && x.category === h.category)))
      .forEach((h) => give(h.id, { kind: "potw", week: h.week, category: h.category, label: "Player of the Week (" + h.label + "), Week " + h.week, club: h.club, line: h.line, name: "Player of the Week" }));
  });

  /* ---------- rosters ---------- */
  const S1 = SEASONS.filter((s) => s.number === 1)[0] || {}, S2S = SEASONS.filter((s) => s.number === 2)[0] || {};
  M.RULES = {
    /* floor: 14 by the v4.43 ruling (SEASONS above), prorated per player by M.playoffFloor */
    s1: { composition: { F: 7, D: 5, G: 3, total: 15 }, source: "Rule 2.1 (set September 28, 2026)", cap: S1.salary_cap || null, floor: S1.playoff_min_gp || 16 },
    /* bidding: the one-sentence summary; the full rulings (2026-11-02) are in the concept rulebook's S2.6 and js/market.js.
       Commissioner, 2026-11-02: "bids always start at 750k and can only be raised by 250k at a time. a team cannot place
       two bids in a row on the same player" and "a team cannot place a bid on a player that would take them over their
       salary cap" */
    /* limit: one roster limit for the whole season, the draft included (Rule S2.4, v4.52); it replaced the 12 until the
       draft and 15 after it. The Owner's and GM's seats count in it, so 2 seats + 10 rounds fill it (Rule S2.3,
       commissioner 2026-11-23); the AGM is named from those twelve after the draft (Rule 2.6).
       min: commissioner, 2026-11-23, "do 3 forwards, 2 defensemen, and 1 goalie": one full lineup, minimums only, no
       maximums (it replaced 5 F / 3 D / 1 G). Every reader goes through M.RULES.s2.min or S2.market.clubState().mins. */
    /* poolNight, ownMin: commissioner, 2026-11-23 (late, PROPOSED): "A team is allowed to play with up to 3 training camp
       players per night. The requirement is that at least half the game lineup should consist of players on the club." */
    s2: { limit: S2S.roster_max, min: { F: 3, D: 2, G: 1 }, cap: S2S.salary_cap || null, floor: S2S.playoff_min_gp, draftRounds: S2S.draft_rounds, poolNight: 3, ownMin: 3,
      source: "Rulebook Chapter S2 (commissioner rulings 2026-10-12 and 13, 2026-11-02, 2026-11-17)",
      bidding: "Live every Saturday after the draft and before the movement deadline, 9 to 10 PM ET, except in holiday weeks: every bid starts a five-minute countdown, and no bidding opens on a new player after 10 PM" }
  };
  /* Rule 8.3 playoff floor for one player, the one definition (public.player_playoff_floor: v3.94 prorating, v4.00
     rounding, v4.43 floor). The season floor (Season 1: 14), prorated for a player first placed after opening night by the
     share of their club's regular season still to play then, rounded to the nearest game with four tenths or less
     rounding down (commissioner, 2026-10-13: "Round down at .4"), never above the floor. Season 1 only: Season 2 has not
     started in the snapshot. -> { floor, base, prorated, leftAtPlacement, total, since } | null */
  /* PROPOSED, commissioner, 2026-11-24: "A player can play up to 4 games in a series, but can only play 2 of the first 4 games in each series. Goalies included. Remember, players sign up for a position and are expected to play there, but we allow players to play any position on any given night, but to be playoff eligible, a player must play at least 6 games at their signed up position group, so forward, defense, or goalie."
     Games toward the floor are the regular-season games the box score records at a position in the player's signed-up
     group (C, LW or RW for a forward, D, G); every game still counts for their statistics. Proration is unchanged. */
  const GROUP_POS = { F: ["C", "LW", "RW"], D: ["D"], G: ["G"] };
  M.floorGames = (pid) => {
    const p = P[pid]; if (!p || !GROUP_POS[p.unit]) return 0;
    const at = PLAYED[pid + "|" + (p.unit === "G" ? "G" : "S")] || {}, seen = new Set();
    GROUP_POS[p.unit].forEach((pos) => { (at[pos] || new Set()).forEach((gid) => { if (GAME[gid] && GAME[gid].stage === "regular") seen.add(gid); }); });
    return seen.size;
  };
  M.playoffFloor = (pid) => {
    const p = P[pid]; if (!p) return null;
    const base = M.playoffFormat.minGp, ten = arr(p.tenures).slice().sort(by("from", "asc"))[0], club = (ten && ten.club) || p.club;
    const games = M.games.filter((g) => g.stage === "regular" && (g.home === club || g.away === club)), total = games.length || 1;
    const from = ten && ten.from ? Date.parse(ten.from) : 0, left = games.filter((g) => Date.parse(g.at) >= from).length;
    const share = base * left / total, whole = Math.floor(share), floor = Math.min(base, share - whole > 0.4 ? whole + 1 : whole);
    /* gp: games toward the floor, at the signed-up group (2026-11-24); group: that group (F, D or G) */
    return { floor: floor, base: base, prorated: floor < base, leftAtPlacement: left, total: total, since: ten ? ten.fromLabel : null, gp: M.floorGames(pid), group: p.unit || null };
  };
  M.roster = (code) => {
    const t = M.team(code); if (!t) return null;
    const all = M.players.filter((p) => p.rostered && p.club === t.code).sort(M.byRink);
    const active = all.filter((p) => p.squad !== "tc"), camp = all.filter((p) => p.squad === "tc");
    const count = (list) => list.reduce((a, p) => { if (p.unit) a[p.unit]++; a.total++; return a; }, { F: 0, D: 0, G: 0, total: 0 });
    const sum = (list) => list.reduce((a, p) => a + num(p.salary), 0);
    const seats = { Owner: null, GM: null, AGM: null }; all.forEach((p) => { if (p.seat) seats[p.seat] = p; });
    const cap = M.RULES.s1.cap;
    return { team: t, all: all, active: active, camp: camp, seats: seats, counts: { active: count(active), camp: count(camp) },
      payroll: { active: sum(active), camp: sum(camp), total: sum(all) }, cap: cap, room: cap == null ? null : cap - sum(all),
      limits: M.RULES.s1.composition, s2: M.RULES.s2 };
  };
  /* ---------- Staff Desk (08 + 12 + 13): aggregates only, placeholder staff names ---------- */
  const SD = obj(D.desk), CASES = obj(SD.cases), EA = obj(SD.ea_import), FF = obj(SD.forfeits);
  const CASE_LABEL = { complaint: "Complaint", appeal: "Appeal", trade_request: "Trade request", position_change: "Position change", stats_correction: "Stats correction", forfeit_appeal: "Forfeit appeal" };
  const AGE = [["lt_1d", "Under 1 day"], ["d1_3", "1 to 3 days"], ["d3_7", "3 to 7 days"], ["d7_plus", "Over 7 days"]];
  const BUCKET = {   /* EA import buckets: label and tone for charts (tone maps to a semantic token, never a club color) */
    "clean import": ["Clean import", "ok"], "held: disconnect, waiting for rest of game": ["Held for a disconnect", "warn"], "lag-out merge": ["Lag-out merged", "ok"],
    "later sitting merged": ["Later sitting merged", "ok"], "early restart": ["Early restart", "warn"], "struck: stopped inside first ten minutes": ["Struck (stopped inside 10 minutes)", "loss"],
    "filed by office / reconciled": ["Filed by the office", "muted"], "dedupe": ["Duplicate", "muted"], "club outside the league": ["Club outside the league", "muted"],
    "club not registered": ["Club not registered", "muted"], "not a scheduled matchup": ["Not a scheduled matchup", "muted"] };
  const FINDING = { unidentified_player: "Unidentified player", lineup_not_filed: "Lineup not filed", weekly_cap_violation: "Weekly limit exceeded", post_lock_change: "Change after the lock",
    lineup_discrepancy: "Lineup does not match", unrostered_player: "Unrostered player", unrostered_cleared: "Unrostered player cleared", result_corrected: "Result corrected",
    out_of_position: "Out of position", position_cleared: "Position cleared", overlong_game_flagged: "Overlong game flagged", overlong_game_reviewed: "Overlong game reviewed",
    held_game_stalled: "Held game stalled", box_lines_linked: "Box lines linked", stats_merged: "Stats merged" };
  const RULING = { disconnect_forfeit: "Disconnection forfeit (Rule 4.3)", noshow_forfeit: "No-show forfeit", limit_forfeit: "Over-limit forfeit", limit_forfeit_lifted: "Over-limit forfeit lifted",
    limit_forfeit_both: "Both clubs over the limit", forfeit_declared: "Forfeit declared", forfeit_reversed: "Forfeit reversed" };
  /* groups of one are shown as a shape, never a number (privacy: a count of 1 identifies the person) */
  const small = (n, one, many) => (n === 1 ? { count: n, display: null, shape: true, label: "One " + one } : { count: n, display: String(n), shape: false, label: n + " " + many });
  const weekLabel = (wk) => "Week of " + M.etMonthDay(wk);
  const sittings = obj(SD.sittings);
  M.sittings = (gameId) => arr(sittings[gameId]).map((s, i) => ({ n: i + 1, status: s.status, bucket: s.bucket, label: (BUCKET[s.bucket] || [s.bucket])[0], tone: (BUCKET[s.bucket] || [0, "muted"])[1],
    held: /^held/.test(s.bucket), merged: s.status === "merged" || /merge/.test(s.bucket), struck: s.status === "struck", seen: s.seen, last: s.last, seenLabel: M.etDateTime(s.seen) }));
  const gamesWith = (test) => Object.keys(sittings).filter((id) => GAME[id] && arr(sittings[id]).some(test)).sort(by((id) => GAME[id].at, "desc"));
  const openTA = arr(SD.open_by_type_age), openTypes = Array.from(new Set(openTA.map((x) => x.type)));
  const bt = arr(CASES.by_type_status);
  const openN = bt.filter((x) => x.status !== "resolved" && x.status !== "denied").reduce((a, x) => a + num(x.n), 0);
  const apps = obj(SD.applications), own = obj(apps.owner), stf = obj(apps.staff), mgmt = obj(apps.management);
  const susp = arr(SD.suspensions);
  const lastDay = arr(EA.by_day).length ? arr(EA.by_day)[arr(EA.by_day).length - 1].et : null;
  const flagged7 = arr(EA.by_day).filter((d) => lastDay && (toDate(lastDay) - toDate(d.et)) / 864e5 < 7).reduce((a, d) => a + num(d.other), 0);
  const finalsNoBox = M.games.filter((g) => g.isFinal && !g.forfeit && !g.hasBox).length;
  const heldGames = gamesWith((s) => /^held/.test(s.bucket)), mergeGames = gamesWith((s) => s.status === "merged" || /merge/.test(s.bucket)),
    struckGames = gamesWith((s) => s.status === "struck");
  const bucketDays = Array.from(new Set(arr(SD.ea_by_day_bucket).map((x) => x.et))).sort().filter((d) => d >= "2026-09-23");
  M.desk = {
    kpis: [
      { key: "open_cases", label: "Open cases", value: openN, display: String(openN) },
      { key: "oldest_case", label: "Oldest open case", value: null, display: "Over 7 days", note: num(obj(CASES.open_by_age).d7_plus) + " open cases are older than a week" },
      { key: "imports_flagged", label: "EA imports flagged, last 7 days", value: flagged7, display: String(flagged7), note: "Through " + M.etMonthDay(lastDay) },
      { key: "finals_no_box", label: "Finals without a box score", value: finalsNoBox, display: String(finalsNoBox), note: "Forfeits without a kept result are not counted" },
      { key: "pending_apps", label: "Applications waiting", value: null, display: "Under 10", note: "Owner applications stay confidential until decided" }
    ],
    attention: [
      Object.assign(small((bt.filter((x) => x.type === "trade_request" && x.status === "open")[0] || {}).n || 0, "trade request waiting for an official", "trade requests waiting for an official"),
        { kind: "case", icon: "inbox", ageHours: (bt.filter((x) => x.type === "trade_request" && x.status === "open")[0] || {}).avg_hours || null, note: "None assigned yet; average age shown", href: "#/desk?tab=cases" }),
      Object.assign({ kind: "case", icon: "inbox", ageHours: (bt.filter((x) => x.type === "complaint" && x.status === "reviewing")[0] || {}).avg_hours || null, href: "#/desk?tab=cases" },
        small((bt.filter((x) => x.type === "complaint" && x.status === "reviewing")[0] || {}).n || 0, "complaint in review", "complaints in review")),
      { kind: "application", icon: "doc", label: "Season 2 owner applications", count: null, display: "A handful", shape: true, shapes: num(own["2:pending"]), confidential: true, note: "Close " + M.etMonthDay(M.s2cal.ownersClose) + "; shown as shapes until decided", href: "#/desk?tab=applications" },
      Object.assign({ kind: "application", icon: "doc", href: "#/desk?tab=applications" }, small(num(stf.pending), "staff application waiting", "staff applications waiting")),
      heldGames[0] ? { kind: "import", icon: "pulse", label: "Sitting held for a disconnect: " + GAME[heldGames[0]].away + " at " + GAME[heldGames[0]].home + ", " + GAME[heldGames[0]].date, count: 1, display: null, shape: false, gameId: heldGames[0], href: "#/desk/game/" + heldGames[0] } : null,
      Object.assign(small(susp.filter((s) => s.mode === "seasons" && s.status === "active").reduce((a, s) => a + num(s.n), 0), "season-long suspension in force", "season-long suspensions in force"), { kind: "discipline", icon: "gavel", href: "#/desk?tab=people" })
    ].filter(Boolean).sort(by("ageHours")),
    cases: {
      total: bt.reduce((a, x) => a + num(x.n), 0), open: openN,
      byTypeStatus: bt.map((x) => ({ type: x.type, label: CASE_LABEL[x.type] || x.type, status: x.status, n: x.n, avgHours: x.avg_hours, assigned: x.assigned, small: x.n === 1 })),
      openByAge: { labels: AGE.map((a) => a[1]), values: AGE.map((a) => num(obj(CASES.open_by_age)[a[0]])) },
      openByTypeAge: { labels: AGE.map((a) => a[1]), series: openTypes.map((t) => ({ name: CASE_LABEL[t] || t, type: t, values: AGE.map((a) => num((openTA.filter((x) => x.type === t && x.age === a[0])[0] || {}).n)) })) },
      resolveHours: bt.filter((x) => x.status === "resolved").map((x) => ({ type: x.type, label: CASE_LABEL[x.type] || x.type, hours: x.avg_hours, n: x.n })),
      openedByWeek: { labels: arr(CASES.opened_by_week).map((w) => weekLabel(w.wk)), values: arr(CASES.opened_by_week).map((w) => w.n) }
    },
    ea: {
      byStatus: obj(EA.by_status),
      buckets: Object.keys(obj(EA.by_bucket)).map((k) => ({ key: k, label: (BUCKET[k] || [k])[0], tone: (BUCKET[k] || [0, "muted"])[1], n: EA.by_bucket[k] })).sort(by("n")),
      byDay: { labels: arr(EA.by_day).map((d) => M.etMonthDay(d.et)), dates: arr(EA.by_day).map((d) => d.et), ok: arr(EA.by_day).map((d) => d.ok), other: arr(EA.by_day).map((d) => d.other) },
      byNight: { labels: bucketDays.map((d) => M.etMonthDay(d)), dates: bucketDays, series: Object.keys(BUCKET).map((k) => ({ key: k, name: BUCKET[k][0], tone: BUCKET[k][1],
        values: bucketDays.map((d) => num((arr(SD.ea_by_day_bucket).filter((x) => x.et === d && x.bucket === k)[0] || {}).n)) })).filter((s) => s.values.some(Boolean)) },
      recent: arr(EA.recent_exceptions).map((r) => { const g = M.games.filter((x) => x.night === r.et_day && x.home === r.home && x.away === r.away)[0];
        return { day: r.et_day, dayLabel: M.etDate(r.et_day), status: r.status, bucket: r.bucket, label: (BUCKET[r.bucket] || [r.bucket])[0], tone: (BUCKET[r.bucket] || [0, "muted"])[1], home: r.home, away: r.away, gameId: g ? g.id : null }; })
    },
    findings: {
      byAction: Object.keys(obj(SD.box_score_findings)).map((k) => ({ action: k, label: FINDING[k] || k, n: SD.box_score_findings[k].n, last: SD.box_score_findings[k].last })).sort(by("n")),
      byWeek: (() => { const rows = arr(SD.findings_by_week_action), wks = Array.from(new Set(rows.map((r) => r.wk))).sort(), acts = Array.from(new Set(rows.map((r) => r.action)));
        return { labels: wks.map(weekLabel), weeks: wks, totals: wks.map((w) => rows.filter((r) => r.wk === w).reduce((a, r) => a + r.n, 0)),
          series: acts.map((a) => ({ action: a, name: FINDING[a] || a, values: wks.map((w) => num((rows.filter((r) => r.wk === w && r.action === a)[0] || {}).n)) })) }; })()
    },
    forfeits: {
      total: num(FF.total), kept: num(FF.kept_result), voided: num(FF.voided),
      byClub: Object.keys(obj(FF.by_club)).map((c) => ({ code: c, team: M.team(c), n: FF.by_club[c] })).sort(by("n")),
      byWeek: { labels: Object.keys(obj(FF.by_week)).sort((a, b) => a - b).map((w) => "Week " + w), values: Object.keys(obj(FF.by_week)).sort((a, b) => a - b).map((w) => FF.by_week[w]) },
      byRuling: Object.keys(obj(FF.by_ruling)).map((k) => ({ action: k, label: RULING[k] || k, n: FF.by_ruling[k] })).sort(by("n"))
    },
    discipline: susp.map((s) => Object.assign({ mode: s.mode, status: s.status, scope: s.scope, venue: s.venue }, (s.mode === "seasons" ? small(s.n, "season-long suspension", "season-long suspensions") : small(s.n, "game suspension", "game suspensions")))),
    apps: {
      owner: { s1: { approved: num(own["1:approved"]) },
        s2: { pending: num(own["2:pending"]), confidential: true, display: "A handful", note: "Confidential until decided " + M.etMonthDay(M.s2cal.ownersClose) + " to " + M.etMonthDay(M.s2cal.ownersDecided) + ": show as shapes, never names or exact counts" } },
      staff: { approved: num(stf.approved), denied: num(stf.denied), pending: small(num(stf.pending), "staff application", "staff applications") },
      management: { gm: num(mgmt["gm:approved"]), agm: num(mgmt["agm:approved"]) }
    },
    /* who is on staff and what they did last are s2_desk()'s, a staff read (M.partial.desk), never names made up here.
       shortcut: empty lists keep the pages that still read them drawing; drop the three when the Staff Desk and the
       Control Center read s2_desk and s2_control (i3a, 2026-11-25) */
    staff: [], commissioners: [], activity: [],
    sittings: M.sittings,
    examples: { held: heldGames, merged: mergeGames, struck: struckGames }
  };

  /* ---------- Control Center (09 + 10 + seasons) ---------- */
  const AN = obj(D.control), MP = obj(AN.member_pop_stats), GU = obj(AN.guild);
  const periodKey = { day: (d) => d, week: (d) => { const t = toDate(d); const w = new Date(t.getTime() - ((t.getUTCDay() + 6) % 7) * 864e5); return w.toISOString().slice(0, 10); }, month: (d) => d.slice(0, 7) };
  const series = (rows, key, period, agg) => { const map = {}, keys = []; rows.forEach((r) => { const k = periodKey[period](r.d); if (!(k in map)) { keys.push(k); map[k] = []; } map[k].push(r); });
    return { labels: keys.map((k) => (period === "month" ? new Date(k + "-15T16:00:00Z").toLocaleString("en-US", { month: "short", timeZone: TZ }) : M.etMonthDay(k))), keys: keys,
      values: keys.map((k) => (agg === "sum" ? map[k].reduce((a, r) => a + num(r[key]), 0) : map[k][map[k].length - 1][key])) }; };
  const days = arr(MP.days);
  const wkJ = arr(GU.joins_by_week), wkD = arr(GU.departs_by_week), wks = Array.from(new Set(wkJ.map((w) => w.wk).concat(wkD.map((w) => w.wk)))).sort();
  const pick = (rows, wk, k) => num((rows.filter((r) => r.wk === wk)[0] || {})[k]);
  const TEN_B = ["Under a day", "1 to 6 days", "1 to 2 weeks", "2 to 4 weeks", "1 to 2 months", "2 months or more"];
  const cohorts = arr(AN.retention_cohorts), maxWk = Math.max(0, ...arr(AN.active_players_by_week).map((w) => w.week));
  const fun = obj(AN.funnel_s1);
  /* Season 2's sign-ups so far: the commissioner's read when this body has it; else, with Season 2 on screen, its own
     sign-ups (registration_pool), the returning ones being those with league games before it (career_games_played,
     exact while Season 2 has no games, which is while sign-ups are open) */
  const s2f = AN.funnel_s2_so_far ? obj(AN.funnel_s2_so_far) : VIEW_N === 2 ? { signed_up: M.signups.length, of_whom_played_s1: M.signups.filter((x) => num(M.careerGames[x.pid]) > 0).length } : {};
  const jobsD = obj(D.jobs);
  const cadence = (sched) => { if (!sched) return null; if (/second/.test(sched)) return 1; const p = sched.split(" "); if (p.length !== 5) return null;
    if (/^\*\/(\d+)$/.test(p[0])) return +p[0].slice(2); if (p[0] === "*") return 1; if (p[1] === "*") return 60; if (p[4] !== "*") return 10080; return 1440; };
  const cronBy = {}; arr(jobsD.cron_jobs).forEach((c) => { cronBy[c.job] = c; });
  const edgeBy = {}; arr(jobsD.edge_jobs).forEach((e) => { edgeBy[e.fn] = e; });
  const hbCad = (k) => (edgeBy[k] ? edgeBy[k].every_min : cronBy[k] ? cadence(cronBy[k].schedule) : k === "watchdog" ? 15 : null);
  const seasonRow = (s) => {
    const cal = [["owner_app_deadline", "Owner applications close"], ["registration_deadline", "Sign-ups close"], ["draft_at", "Draft"], ["starts_at", "Puck drop"],
      ["placement_closed_at", "Placement closed"], ["fa_moves_closed_at", "Signings and releases closed"], ["movement_deadline_fixed", "Movement deadline"],
      ["ends_at", "Regular season ends"], ["playoffs_start_at", "Playoffs begin"]]
      .filter((c) => s[c[0]]).map((c) => ({ key: c[0], label: c[1], at: s[c[0]], date: M.etFull(s[c[0]]), time: M.etTime(s[c[0]]), source: "seasons" }));
    if (s.number === 2) cal.push({ key: "owners_decided_by", label: "Owners decided by", at: M.s2cal.ownersDecided, date: M.etFull(M.s2cal.ownersDecided), time: M.etTime(M.s2cal.ownersDecided), source: "ruling v3.95, moved by v4.31 (app_config owner_decision_by_2)" });
    cal.sort(by("at", "asc"));
    return { number: s.number, name: s.name, status: s.status, format: s.format, settings: s, calendar: cal,
      summary: [["Weeks", s.weeks], ["Nights per week", s.nights_per_week], ["Game slots (ET)", String(s.night_slots || "").split(",").map((t) => { const [h, m] = t.split(":"); return (h % 12 || 12) + ":" + m + " PM"; }).join(", ")],
        ["Roster limit", s.roster_max], ["Draft rounds", s.draft_rounds], ["Playoff games-played floor", s.playoff_min_gp], ["Salary cap", M.money(s.salary_cap)],
        ["AGM salary", M.money(s.agm_salary)], ["Trade deadline", s.trade_deadline_week ? "Week " + s.trade_deadline_week : null], ["Holidays skipped", arr(s.skip_holidays).length],
        ["Sign-ups", s.registration_open ? "Open" : "Closed"]].map((x) => ({ label: x[0], value: x[1] == null ? "–" : String(x[1]) })),
      rules: s.number === 1 ? M.RULES.s1 : M.RULES.s2, playoff: s.playoff || null };
  };
  const seasons = SEASONS.map(seasonRow);
  const s2 = seasons.filter((s) => s.number === 2)[0];
  M.control = {
    kpis: [
      { key: "s2_signups", label: "Season 2 sign-ups", value: num(s2f.signed_up), display: String(num(s2f.signed_up)), note: num(s2f.of_whom_played_s1) + " played in Season 1" },
      { key: "open_cases", label: "Open cases", value: openN, display: String(openN) },
      { key: "members", label: "Discord members", value: num(MP.present), display: String(num(MP.present)), note: num(GU.linked_present) + " linked to a site account" },
      { key: "automations", label: "Scheduled jobs healthy", value: null,
        display: arr(jobsD.cron_jobs).filter((c) => c.active && !num(c.fails_7d)).length + arr(jobsD.edge_jobs).filter((e) => e.last_ok && !e.has_error).length + " of " + (arr(jobsD.cron_jobs).length + arr(jobsD.edge_jobs).length),
        note: "Zero failures in 7 days" }
    ],
    members: { present: num(MP.present), anchor: MP.anchor || null, days: days, by: (period) => series(days, "members", period || "day", "last"),
      note: "Corrected: re-anchored on the last day so the line ends at today's " + num(MP.present) + " members (member_pop_stats anchors on the peak)." },
    accounts: { total: num(AN.accounts_total), days: arr(AN.accounts_by_day), by: (period) => series(arr(AN.accounts_by_day), "cum", period || "day", "last") },
    joinsDeparts: { labels: wks.map(weekLabel), weeks: wks, joins: wks.map((w) => pick(wkJ, w, "n")), departs: wks.map((w) => pick(wkD, w, "n")),
      registered: wks.map((w) => pick(wkD, w, "registered")), hadClub: wks.map((w) => pick(wkD, w, "had_club")), note: "Departures are logged from Aug 3; joins count each member's latest join only" },
    funnel: [{ label: "Site accounts", value: num(fun.site_accounts) }, { label: "In the Discord", value: num(fun.in_discord_now) }, { label: "Signed up for Season 1", value: num(fun.signed_up) },
      { label: "Ever rostered", value: num(fun.rostered_ever) }, { label: "Played a game", value: num(fun.played_a_game) }, { label: "Played 3 or more weeks", value: num(fun.played_3_plus_weeks) }],
    funnelGap: { discordMembers: num(GU.present_now), withAccount: num(GU.linked_present), withoutAccount: num(GU.present_now) - num(GU.linked_present), everSeen: num(GU.ever_seen) },
    weeklyActive: { labels: arr(AN.active_players_by_week).map((w) => "Week " + w.week), players: arr(AN.active_players_by_week).map((w) => w.players), firstTimers: arr(AN.active_players_by_week).map((w) => w.first_timers) },
    retention: arr(AN.week_over_week).map((w) => ({ week: w.wk, played: w.played, next: w.played_next_week, rate: r3(div(w.played_next_week, w.played)), label: "Week " + w.wk + " to " + (w.wk + 1) })),
    cohorts: { rowHead: "First week", cols: Array.from({ length: maxWk }, (_, i) => "Wk " + (i + 1)),
      rows: cohorts.map((c) => ({ label: "Week " + c.cohort, size: c.size, cells: Array.from({ length: maxWk }, (_, i) => { const v = obj(c.still_playing)["wk" + (i + 1)]; return v == null ? null : r3(v / c.size); }),
        counts: Array.from({ length: maxWk }, (_, i) => { const v = obj(c.still_playing)["wk" + (i + 1)]; return v == null ? null : v; }) })) },
    tenure: Object.assign({}, obj(GU.departure_tenure_days), { hist: arr(GU.departure_tenure_hist).map((h) => ({ label: TEN_B[h.ord] || "?", n: h.n })) }),
    seasonReturn: { signedUp: num(s2f.signed_up), playedS1: num(s2f.of_whom_played_s1), share: r3(div(num(s2f.of_whom_played_s1), num(s2f.signed_up))),
      byDay: arr(AN.signups_by_day_s2).map((d) => ({ d: d.d, label: M.etMonthDay(d.d), n: d.n })) },
    churnByClub: Object.keys(obj(GU.departs_by_club)).map((c) => ({ code: c, n: GU.departs_by_club[c], inLeague: !!M.team(c), team: M.team(c) })).sort(by("n")),
    signups: arr(AN.signups_by_season),
    jobs: {
      edge: arr(jobsD.edge_jobs).map((e) => Object.assign({}, e, { healthy: !!e.last_ok && !e.has_error && !e.drifting && !num(e.lost_count), ago: M.ago(e.ran_min_ago) })),
      cron: arr(jobsD.cron_jobs).map((c) => Object.assign({}, c, { cadenceMin: cadence(c.schedule), healthy: !!c.active && !num(c.fails_7d), ago: M.ago(c.last_min_ago) })),
      heartbeats: Object.keys(obj(jobsD.heartbeat_age_min)).sort().map((k) => { const age = jobsD.heartbeat_age_min[k], cad = hbCad(k);
        return { key: k, ageMin: age, ago: M.ago(age), cadenceMin: cad, fresh: cad == null ? age <= 60 : age <= Math.max(2 * cad, cad + 5) }; }),
      note: "Freshness is read from each heartbeat's value, never app_config.updated_at"
    },
    seasons: seasons,
    season: (n) => seasons.filter((s) => s.number === n)[0] || null,
    /* Season 2 setup stepper: states derived from the snapshot (derived:true), holidays gate the schedule (standing order) */
    setup: [
      { step: 1, key: "settings", label: "Season settings", state: s2 ? "done" : "next", detail: s2 ? "Season 2 row set: 6 weeks, 3 nights, a " + (s2.settings || {}).roster_max + "-player roster all season, cap " + M.money((s2.settings || {}).salary_cap) : "No Season 2 row yet" },
      { step: 2, key: "holidays", label: "Holidays", state: s2 && arr(s2.settings.skip_holidays).length ? "done" : "next", detail: s2 ? plural(arr(s2.settings.skip_holidays).length, "holiday") + " skipped" : "" },
      { step: 3, key: "owners", label: "Owners", state: "next", detail: "Applications close " + M.etDate(M.s2cal.ownersClose) + ", 11:59 PM ET; owners decided by " + M.etMonthDay(M.s2cal.ownersDecided) + ". Pending applications show as shapes." },
      { step: 4, key: "clubs", label: "Clubs and divisions", state: "todo", detail: "After owners are decided; a new franchise waits for the commissioner's go-ahead (v4.19)" },
      /* QA functional 2026-11-25: Season 2 has no placement (ruling: no depth or automatic placement), and its rollover is
         its own, read from its row (the Season 1 row is complete) */
      { step: 5, key: "signups", label: "Sign-ups", state: "open", detail: num(s2f.signed_up) + " signed up so far; sign-ups close " + ((s2 && s2.calendar.filter((c) => c.key === "registration_deadline")[0]) || {}).date + ", 11:59 PM ET, and later sign-ups join the training camp pool" },
      { step: 6, key: "draft", label: "Draft", state: "todo", detail: M.etDate(M.s2cal.draft) + ", 9 PM ET, " + M.RULES.s2.draftRounds + " rounds" },
      /* the pool and the bid nights run in the database since v4.59 (market_tick, market_pool_requests) */
      { step: 7, key: "pool", label: "Camp pool and bidding", state: "todo",
        detail: (() => { const held = M.s2cal.bidNights.filter((b) => !b.skipped).map((b) => M.etMonthDay(b.opens)), off = M.s2cal.bidNights.filter((b) => b.skipped).map((b) => M.etMonthDay(b.opens));
          /* gaps (2026-11-25): the pool forms at the draft (Rules S2.3 and S2.5: the players not selected, and every later
             sign-up), never at puck drop; a club asks for a pool player one game at a time (market_pool_request opens with
             the market, once the draft is complete), and after the movement deadline, when waivers, bidding, trades and the
             Rule S2.4 draw stop, that request is the one way a club adds a player for a game */
          return "The training camp pool forms at the draft, " + M.etDate(M.s2cal.draft) + ", from every player not drafted and every later sign-up. Clubs request pool players one game at a time (Rule S2.5), " +
            "and after the movement deadline, " + M.etMonthDay(M.s2cal.deadline) + ", that is the only way to add a player. Saturday bidding from " + held[0] + ". Bid nights " + held.join(", ") +
            (off.length ? " (" + off.join(" and ") + " skipped, holiday weeks)" : "") + "; none after the movement deadline."; })() },
      { step: 8, key: "schedule", label: "Schedule", state: s2 && arr(s2.settings.skip_holidays).length ? "todo" : "blocked", gate: "holidays", detail: "Generate after holidays are set (they are); puck drop " + M.etDate(M.s2cal.puckDrop) },
      { step: 9, key: "playoffs", label: "Playoffs", state: "todo", detail: "Three per division, three rounds, best of seven; games-played floor " + M.RULES.s2.floor + ", prorated for a late placement (Rule 8.3)" },
      { step: 10, key: "rollover", label: "Rollover", state: s2 && (s2.settings || {}).status === "complete" ? "done" : "todo", detail: "Runs by itself minutes after the Season 2 final" }
    ].map((s) => Object.assign(s, { derived: true }))
  };

  /* ---------- examples the screens can open (real fixtures) ---------- */
  const withBox = M.games.filter((g) => g.hasBox);
  const findGame = (test) => { for (let i = withBox.length - 1; i >= 0; i--) { const g = M.game(withBox[i].id); if (g && test(g)) return g.id; } return null; };
  M.examples = {
    /* the season's points leader, for a bare #/player (it was a member named by hand; no member is named in this file) */
    pointsLeader: (M.leaders("p", 1, { minGp: 1 })[0] || {}).id || null,
    twoRoleGame: findGame((g) => g.twoRole.length > 0) || findGame((g) => g.offRoleCount > 0),   /* no game has one player in both roles yet, so: a skater in goal */
    formerPlayerGame: findGame((g) => g.formerCount > 0),
    unidentifiedGame: findGame((g) => g.unidentified > 0),
    keptForfeit: (M.games.filter((g) => g.kept).slice(-1)[0] || {}).id || null,
    forfeitNoBox: (M.games.filter((g) => g.forfeit && !g.hasBox).slice(-1)[0] || {}).id || null,
    otGame: (M.games.filter((g) => g.decision === "ot" && g.hasBox).slice(-1)[0] || {}).id || null,
    heldGame: heldGames[0] || null, mergeGame: mergeGames[0] || null, struckGame: struckGames[0] || null
  };

  /* ---------- search (command palette): only the pages the viewer's hats allow ---------- */
  const has = (hat) => (S2.has ? S2.has(hat) : hat !== "staff" && hat !== "office" && hat !== "commish");
  S2.searchIndex = () => {
    const out = [];
    [["Today", "#/today", "today", "home tonight"], ["Games", "#/games", "scores", "schedule scores results nights"], ["Standings", "#/standings", "stats", "table division"],
      ["League table", "#/standings?view=league", "stats", "standings overall"], ["Playoff race", "#/standings?view=race", "stats", "clinched magic number"],
      ["Projected playoffs", "#/standings?view=playoffs", "trophy", "bracket"], ["Power rankings", "#/standings?view=power", "chart", "power"],
      ["Stat leaders", "#/stats?tab=leaders", "stats", "leaders titles"], ["Skater stats", "#/stats?tab=skaters", "stats", "skaters points goals"],
      ["Goaltender stats", "#/stats?tab=goalies", "stats", "goalies save percentage gaa"], ["Club stats", "#/stats?tab=teams", "stats", "teams"],
      ["Players", "#/stats?tab=players", "people", "directory"], ["Awards", "#/stats?tab=awards", "trophy", "player of the week titles trophies trophy stanley cup champions presidents wales campbell bowl art ross rocket richard jennings"],
      ["Clubs", "#/clubs", "clubs", "teams"], ["Season", "#/season", "calendar", "dates draft playoffs season 2"], ["Rulebook", "#/rulebook", "doc", "rules"],
      ["Draft room", "#/draft", "trophy", "mock draft picks board"],
      /* the Season 2 player market (commissioner, 2026-11-02): the Saturday bid room and the league-wide training camp pool */
      ["Bid room", "#/bidding", "bolt", "saturday bidding auction bids lots live room season 2"], ["Training camp", "#/camp", "people", "camp pool requests waivers six games eligible"],
      /* brought back 2026-11-23 (the cutover list's live features) */
      ["News", "#/news", "doc", "stories recaps night recap power rankings articles"], ["Terms of play", "#/terms", "doc", "terms legal rules of play"],
      ["Privacy", "#/privacy", "doc", "privacy data stored delete account"], ["Import a pickup game", "#/pickup-import", "scores", "pickup import ea club box score lobby"],
      /* the pickup games on file and one game's box score (js/pages/pickups.js, g5): public, as on the current site */
      ["Pickup games", "#/pickups", "scores", "pickups pickup games lobby results box scores"],
      ["You", "#/you", "you", "profile account"]].forEach((p) => out.push({ label: p[0], hint: "Page", href: p[1], icon: p[2], kw: p[3] }));
    if (has("member")) [["Your week", "#/you?tab=week", "calendar"], ["Your inbox", "#/you?tab=inbox", "inbox"], ["Your applications", "#/you?tab=applications", "doc"], ["Settings", "#/you?tab=settings", "gear"]]
      .forEach((p) => out.push({ label: p[0], hint: "You", href: p[1], icon: p[2], kw: "me my" }));
    /* header v2: the Action Center, the header's door to the league office, is found by what people file there */
    if (has("member")) out.push({ label: "Action Center", hint: "You", href: "#/you?tab=inbox&show=cases", icon: "flag", kw: "cases file a case complaint appeal trade request position change forfeit" });
    if (has("office")) [["Team HQ", "#/hq", "shield", "front office club"], ["Roster and cap", "#/hq?tab=roster", "people", "salary cap contracts"], ["Trades", "#/hq?tab=trades", "people", "trade offers block requests counter"], ["Lineups", "#/hq?tab=lineups", "clock", "lineup t-30 lock"], ["Game nights", "#/hq?tab=nights", "calendar", "availability"],
      ["Bidding", "#/hq?tab=bidding", "bolt", "bid board saturday bidding ceilings targets waivers claims"]]
      .forEach((p) => out.push({ label: p[0], hint: "Team HQ", href: p[1], icon: p[2], kw: p[3] }));
    if (has("staff")) [["Staff Desk", "#/desk", "wrench", "staff today attention"], ["Cases", "#/desk?tab=cases", "inbox", "complaints trade requests appeals tickets"], ["Games desk", "#/desk?tab=games", "scores", "forfeits sittings box score"],
      ["Applications", "#/desk?tab=applications", "doc", "owner staff management vote"], ["People", "#/desk?tab=people", "people", "discipline suspensions roles"],
      /* the six committees (2026-11-23), found by their names and their charters' words */
      ["Committees", "#/desk?tab=committees", "people", "committee managers " + (S2.COMMITTEE_DEFS ? S2.COMMITTEE_DEFS.map((c) => c.name + " " + c.charter.join(" ")).join(" ").toLowerCase() : "")]]
      .forEach((p) => out.push({ label: p[0], hint: "Staff Desk", href: p[1], icon: p[2], kw: p[3] }));
    if (has("commish")) [["Control Center", "#/control", "gear", "commissioner overview"], ["Tonight", "#/control?tab=tonight", "pulse", "live ops"], ["Season setup", "#/control?tab=setup", "calendar", "stepper holidays schedule draft"],
      ["Growth and retention", "#/control?tab=growth", "chart", "members funnel cohorts"], ["Clubs (Control Center)", "#/control?tab=clubs", "clubs", "owners divisions"], ["System", "#/control?tab=system", "bolt", "automations cron jobs health"]]
      .forEach((p) => out.push({ label: p[0], hint: "Control Center", href: p[1], icon: p[2], kw: p[3] }));
    M.teams.forEach((t) => out.push({ label: t.full, hint: t.division + " Division · " + t.code, href: t.href, icon: "clubs", kw: t.code + " " + t.city + " " + t.name }));
    M.players.forEach((p) => out.push({ label: p.tag, hint: [p.pos, p.club, p.former ? "former" : null].filter(Boolean).join(" · "), href: p.href, icon: "you", kw: (p.team ? p.team.full : "") + " " + (p.posName || "") }));
    M.games.slice().sort(by("at")).forEach((g) => out.push({ label: g.away + " at " + g.home + (g.isFinal && g.hs != null ? ", " + g.as + " to " + g.hs : ""), hint: g.label + " · " + g.date + " · Week " + g.week,
      href: g.href, icon: "scores", kw: (M.team(g.home) || {}).full + " " + (M.team(g.away) || {}).full }));
    return out;
  };

  /* ---------- the title race, read ONCE for every page (QA round 2, 2026-11-25) ----------
     s2_league carries no title race (M.partial.titles); the league's one definition is statistical_title_board(p_season,
     p_top) (sql v4.57). The Stats page read it for its own Leaders tab (QA visual 3) while Today's titles and the profile's
     title races hid it. M.readTitles() reads it for the season on screen, five a title (the Leaders tab's "only N have
     reached the floor" counts a board of five), at most once per league read (a re-read of the league moves M.generated
     to the read's moment, js/live.js S2.reread, and reads it again: the race moves with every final), and puts the rows
     where a body's own titles go, so M.titles, M.leaders, M.honors.titles and each player's title_race honors all read
     them and M.partial.titles goes.
     The board is kept by season across a rebuild (S2.buildModel empties S2.M and fills it again) and put back at once, so
     no page falls back to "loading" while the next read is on its way. A failed read is said in the console and kept:
     M.titlesErr() is that Error for the season on screen, else null, for the page to say with a Try again
     (M.readTitles(true)). It is not read again by itself until the league is (so a page that repaints when the read
     settles never loops on a failure). The promise never rejects: it settles with null, or the Error. The fixture carries
     its own race: no read. M.titlesNeeded() says whether a read would ask anything */
  var TB = S2._titleBoard = S2._titleBoard || { key: null, gen: null, rows: null, err: null, wait: null };
  var titleKey = function () { var s = M.control && M.control.season(VIEW_N); return s && s.settings ? s.settings.id || null : null; };
  var putTitles = function (rows) {
    D.honors = Object.assign({}, obj(D.honors), { titles: rows });
    M.honors.titles = Object.keys(TITLE_LABEL).reduce(function (a, k) { a[k] = M.titles(k); return a; }, {});
    Object.keys(P).forEach(function (id) { P[id].honors = P[id].honors.filter(function (h) { return h.kind !== "title_race"; }).concat(raceHonors(id)); });
    delete M.partial.titles;
  };
  /* the board's rows, as the model reads a body's titles: the four titles only, each in place order, the rate a number */
  var boardRows = function (data) {
    return arr(data).filter(function (t) { return t && TITLE_LABEL[t.category]; }).map(function (t) {
      return { category: t.category, place: t.place, profile_id: t.profile_id, gamertag: t.gamertag || (P[t.profile_id] ? P[t.profile_id].tag : "Unknown player"),
        gp: t.gp, total: t.total, per_game: t.per_game == null ? null : +t.per_game };
    }).sort(function (a, b) { return Object.keys(TITLE_LABEL).indexOf(a.category) - Object.keys(TITLE_LABEL).indexOf(b.category) || num(a.place) - num(b.place); });
  };
  M._titles = { key: titleKey, put: putTitles };   /* the build on screen's own, for a read that lands after a rebuild */
  M.titlesNeeded = function () { return !!M.view.live && (TB.key !== titleKey() || TB.gen !== M.generated || (!!M.partial.titles && !TB.err)); };
  M.titlesErr = function () { return TB.err && TB.key === titleKey() ? TB.err : null; };
  M.readTitles = function (again) {
    if (!M.view.live || (!again && !M.titlesNeeded())) return Promise.resolve(null);
    if (TB.wait) return TB.wait;
    var key = titleKey(), gen = M.generated;
    if (TB.key !== key) TB.rows = null;
    TB.key = key; TB.err = null;
    TB.wait = Promise.resolve().then(function () {
      if (!key) throw new Error("this season has no id in the league read");
      if (!S2.rd) throw new Error("the league's data service is not on this page");
      return S2.rd(function (c) { return c.rpc("statistical_title_board", { p_season: key, p_top: 5 }); }, { list: true });
    }).then(function (data) {
      if (TB.key !== key) return null;   /* the reader moved to another season meanwhile */
      TB.rows = boardRows(data); TB.gen = gen;
      /* S2.M is the same object after a rebuild, so M._titles is the build on screen's (this closure's D and P may be gone) */
      if (S2.M._titles && S2.M._titles.key() === key) S2.M._titles.put(TB.rows);
      return null;
    }).then(null, function (e) {
      /* after the success step, so a throw while putting the rows is a failed read too (QA round 2: with both handlers
         on one then, that throw skipped the clearing step and TB.wait stayed rejected, so Try again could never run) */
      console.error("The title race could not be read:", e);
      if (TB.key === key) { TB.err = e; TB.gen = gen; }
      return e;
    }).then(function (res) { TB.wait = null; return res; });
    return TB.wait;
  };
  if (M.view.live && M.partial.titles && TB.rows && TB.key === titleKey()) putTitles(TB.rows);   /* the last board, until the next read lands */
};

/* ---------- live mode: an s2_league body into the model ----------
   S2.buildModel(body, archive) checks the body against the contract (contracts/s2-league.md), counts the season with the
   live engine and refills S2.M in place. body is s2_league(season) for the season on screen; archive, when given, is
   s2_league(an earlier complete season, ["games", "box", "tenures"]), read by js/load.js when the season on screen has
   no final yet, so its close (the trophy room, the Cup roster, the champion) is still real. What the body does not carry
   is named in M.partial. */
(function () {
  "use strict";
  const S2 = window.S2;
  const arr = (x) => (Array.isArray(x) ? x : []);
  const obj = (x) => (x && typeof x === "object" && !Array.isArray(x) ? x : {});
  const num = (x) => (typeof x === "number" && isFinite(x) ? x : 0);
  /* every section s2_league returns by default (the lazy news and wire are read by the pages that show them) */
  const REQUIRED = ["league", "teams", "seasons", "config", "games", "box", "pct", "rosters", "ratings", "people", "career", "honors", "tenures", "signups", "suspensions", "draft"];
  /* league_tenures' buckets (v4.57) in the words the pages print (js/pages/profile.js HOW_IN and HOW_OUT); an office
     removal stays neutral, as the bucket is */
  const HOW_IN = { placed: "placed", drafted: "drafted", traded: "trade", moved: "moved", signed: "signed", squad: "squad move", account: "other", carried: "other", other: "other" };
  const HOW_OUT = { traded: "trade", moved: "moved", left: "left Discord", waived: "waived", office: "league office", squad: "squad move", account: "moved" };
  /* the fixture's box columns, each read from its game_stats column (fot is faceoffs taken, CG.eaSkaterLine, v4.10) */
  const BOX_COLS = ["pid", "club", "goalie", "pos", "g", "a", "pm", "sog", "hits", "pim", "blk", "tk", "gv", "int", "fow", "fot", "toi_s", "pass", "pass_att", "poss_s",
    "rat_off", "rat_def", "rat_team", "sv", "sa", "ga", "so", "ppg", "shg", "gwg", "pdrawn", "dsv", "sop", "psv", "psa"];
  const boxCompact = (CG, r) => { const sk = CG.eaSkaterLine(r);
    return [r.profile_id || null, r.team, !!r.is_goalie, r.is_goalie ? "G" : r.position, r.goals, r.assists, r.plus_minus, r.shots, r.hits, r.pim, r.blocked_shots, r.takeaways,
      r.giveaways, r.interceptions, sk.fow, sk.fot, r.time_on_ice_seconds, r.passes_completed, r.passes_attempted, r.possession_seconds, r.offense_rating, r.defense_rating,
      r.team_play_rating, r.saves, r.shots_against, r.goals_against, r.shutout, r.pp_goals, r.sh_goals, r.gwg, r.penalties_drawn, r.diving_saves, r.shutout_periods,
      r.pen_shot_saves, r.pen_shots_against]; };
  const EA_POS = { LW: 1, C: 1, RW: 1, LD: 1, RD: 1 };

  /* one season counted the way the live site counts it (CG.buildLiveLeague): its games through CG.liveGame and
     CG.countedFinal, each box score through CG.gameBox, every stage kept apart by CG.aggregateStages, the EA extras by
     CG.addEaMetrics. Rostered players from the season's spots; everyone else with a line is a former player at the club
     and position of their latest line (v4.08: every line counts, on a roster now or not) */
  function count(teams, b, posHint) {
    const CG = S2.CG;
    CG.TEAMS = teams.map((t) => ({ id: t.id, code: t.code, name: t.name, div: t.division, color: t.color }));
    CG.TEAM = {}; CG.TEAMS.forEach((t) => { CG.TEAM[t.code] = t; });
    CG.SEASON = { completedWeeks: 0 };
    const id2code = {}, code2id = {}; teams.forEach((t) => { id2code[t.id] = t.code; code2id[t.code] = t.id; });
    const cols = arr(obj(b.box).cols), byGame = obj(obj(b.box).byGame), rows = [], rowsOf = {};
    Object.keys(byGame).forEach((gid) => { rowsOf[gid] = arr(byGame[gid]).map((a) => {
      const r = { game_id: gid }; cols.forEach((c, i) => { r[c] = a[i]; }); r.team_id = code2id[r.team]; rows.push(r); return r; }); });
    const schedule = arr(b.games).map((g) => CG.liveGame(g, id2code, null)).filter((g) => g.home && g.away && g.at).sort((x, y) => x.at - y.at);
    const preWk = {}, allWk = {}; let regMax = 0;
    schedule.forEach((g) => { if (g.status !== "final") return; const st = g.stage || "regular", w = g.week || 1;
      allWk[st + ":" + w] = 1; if (st === "preseason") preWk[w] = 1; else if (st !== "playoff") regMax = Math.max(regMax, w); });
    const results = schedule.filter(CG.countedFinal).map((g) => {
      const score = {}, shots = {}; score[g.home] = g.homeScore; score[g.away] = g.awayScore; shots[g.home] = g.homeShots; shots[g.away] = g.awayShots;
      return { id: g.id, week: g.week, stage: g.stage, home: g.home, away: g.away, at: g.at, ot: g.ot, score: score, box: CG.gameBox(g, rowsOf[g.id], id2code),
        shots: shots, stars: [], entered: true, forfeit: g.forfeit || null };
    });
    const players = [], byTeam = {}, rostered = {};
    CG.TEAMS.forEach((t) => { byTeam[t.code] = []; });
    arr(obj(b.rosters).spots).forEach((sp) => { if (!byTeam[sp.team] || rostered[sp.profile_id]) return;
      const p = { id: sp.profile_id, team: sp.team, pos: sp.position || "C", spot: sp }; players.push(p); byTeam[sp.team].push(p); rostered[sp.profile_id] = p; });
    const at = {}; schedule.forEach((g) => { at[g.id] = g.at; });
    const formerBy = {};
    rows.forEach((r) => { if (!r.profile_id || rostered[r.profile_id] || at[r.game_id] == null || !r.team_id) return;
      const cur = formerBy[r.profile_id]; if (cur && cur._at >= at[r.game_id]) return;
      /* v4.54: EA files a defenseman as D, which names no side; the season's last stint, else the sign-up, does */
      const hint = posHint[r.profile_id];
      formerBy[r.profile_id] = { id: r.profile_id, team: r.team, former: true, _at: at[r.game_id],
        pos: r.is_goalie ? "G" : EA_POS[r.position] ? r.position : hint && hint !== "G" ? hint : r.position === "D" ? "LD" : "C" }; });
    const lg = { players: players, byTeam: byTeam, schedule: schedule, results: [], allResults: results, formerPlayers: Object.keys(formerBy).map((k) => formerBy[k]) };
    const st = CG.splitStages(results);
    CG.aggregateStages(lg, st, { pre: Object.keys(preWk).length, all: Object.keys(allWk).length, reg: regMax });
    CG.addEaMetrics(lg, lg.pstats, st.reg, rows, null);
    CG.addEaMetrics(lg, lg.playoff.pstats, st.po, rows, null);
    lg.stages = st; lg.rows = rows;
    return lg;
  }

  /* a season line per player per role in the concept's shape; the role's own games (CG.roleLine: sgp skating, gs in goal),
     skating figures on the skating line and goalie figures on the goalie line */
  function linesOf(CG, lg, pstats, tagOf, squadOf) {
    const out = [];
    CG.statPlayers(lg).forEach((p) => {
      const s = pstats[p.id]; if (!s) return;
      [["S", s.sgp], ["G", s.gs]].forEach((x) => {
        const role = x[0], gp = x[1]; if (!gp) return;
        const sk = role === "S", K = (v) => (sk ? num(v) : 0), Gk = (v) => (sk ? 0 : num(v));
        const bc = obj(s.byClub);
        out.push({ pid: p.id, tag: tagOf(p.id), role: role, club: p.team, reg_pos: p.pos, squad: squadOf(p.id), former: !!p.former, gp: gp,
          /* the clubs this role was played for, in the order first played (CG.clubsPlayed, v4.13) */
          clubs: CG.clubsPlayed(s).filter((c) => (sk ? bc[c].sgp : bc[c].gs) > 0),
          g: K(s.g), a: K(s.a), p: K(s.p), pm: K(s.pm), sog: K(s.shots), sat: K(s.sat), hits: K(s.hits), pim: K(s.pim), blk: K(s.blk), tk: K(s.tk), gv: K(s.gv), int: K(s.intc),
          fow: K(s.fow), fot: K(s.fot), gwg: K(s.gwg), ppg: K(s.ppg), shg: K(s.shg), pass: K(s.pass), pass_att: K(s.passAtt), poss_s: K(s.poss),
          toi_s: num(sk ? s.skToi : s.gToi), pdrawn: K(s.pdrawn), defl: K(s.defl), saucer: K(s.saucer),
          rat_off: sk && s.ratOff != null ? s.ratOff : null, rat_def: sk && s.ratDef != null ? s.ratDef : null, rat_team: sk && s.ratTeam != null ? s.ratTeam : null,
          sv: Gk(s.sv), sa: Gk(s.sa), ga: Gk(s.ga), so: Gk(s.so), w: Gk(s.w), l: Gk(s.l), otl: Gk(s.otl), qs: Gk(s.qs),
          brk_sv: Gk(s.brkSv), brk_sa: Gk(s.brkShots), dives: Gk(s.dives), pokes: Gk(s.pokes) });
      });
    });
    return out;
  }

  /* the regular-season table in the fixture's row shape: the engine's record (lg.teams) in Rule 8.1 and 8.2 order
     (CG.standings), plus what the table prints beside it, from the same games */
  function standingsOf(CG, lg, games) {
    const reg = games.filter((g) => g.stage === "regular");
    return CG.TEAMS.map((t) => {
      const r = lg.teams[t.code], fin = reg.filter((g) => g.status === "final" && !g.voided && (g.home_team_id === t.id || g.away_team_id === t.id));
      let pg = 0, po = 0, ag = 0, ao = 0;
      fin.forEach((g) => { const home = g.home_team_id === t.id;
        pg += num(home ? g.home_ppg : g.away_ppg); po += num(home ? g.home_ppo : g.away_ppo); ag += num(home ? g.away_ppg : g.home_ppg); ao += num(home ? g.away_ppo : g.home_ppo); });
      const homeN = lg.results.filter((x) => x.home === t.code).length, awayN = lg.results.filter((x) => x.away === t.code).length;
      const rank = CG.standings(lg, t.div).map((x) => x.code).indexOf(t.code) + 1;
      return { code: t.code, division: t.div, div_rank: rank, gp: r.gp, w: r.w, l: r.l, otl: r.otl, pts: r.pts, rw: r.rw, gf: r.gf, ga: r.ga, diff: r.diff,
        pts_pct: Math.round(r.ptsPct * 1000) / 1000, home: r.hw + "-" + r.hl + "-" + (homeN - r.hw - r.hl), away: r.aw + "-" + r.al + "-" + (awayN - r.aw - r.al),
        forfeits_taken: fin.filter((g) => g.forfeit_team_id === t.id).length,
        games_left: reg.filter((g) => g.status !== "final" && !g.voided && (g.home_team_id === t.id || g.away_team_id === t.id)).length,
        pp_pct: po ? Math.round(1000 * pg / po) / 10 : null, pk_pct: ao ? Math.round(1000 * (1 - ag / ao)) / 10 : null,
        last5: r.last5.slice().reverse() };   /* newest first, as the fixture */
    });
  }

  /* a former player's side when EA filed them as D: their latest stint of the season, else their sign-up */
  const posHints = (tenures, signups) => { const o = {};
    arr(tenures).slice().sort((a, b) => Date.parse(a.joined_at) - Date.parse(b.joined_at)).forEach((t) => { o[t.profile_id] = t.position; });
    arr(signups).forEach((r) => { if (!o[r.profile_id]) o[r.profile_id] = r.position; });
    return o; };
  /* Rule 8.3 rounding: four tenths or less round down (commissioner, 2026-10-13: "Round down at .4") */
  const round83 = (x) => { const w = Math.floor(x); return x - w > 0.4 ? w + 1 : w; };
  /* a complete season's close (the trophy room, commissioner 2026-11-21; rulings in memory s2-concept-trophies): the final
     table, how each club's season ended, the series of the playoff rounds (a game's week is its round, Rule 8.3), the
     NHL's three stat trophies counted the NHL's way (regular-season totals) and the Cup roster at the final. champ is the
     filed champion (awards 'champion'); the final must agree with it, or this is an error, never a guess */
  function closeOf(CG, lg, tenures, champ) {
    const po = lg.stages.po; if (!po.length) throw new Error("closeOf: a complete season with a champion and no playoff final");
    const rounds = Math.max.apply(null, po.map((r) => r.week)), series = {};
    po.forEach((r) => { const clubs = [r.home, r.away].sort(), k = r.week + "|" + clubs.join("|"), s = series[k] = series[k] || { round: r.week, clubs: clubs, wins: {}, last: 0 };
      const win = r.forfeit ? (r.forfeit === r.home ? r.away : r.home) : r.score[r.home] > r.score[r.away] ? r.home : r.away;
      s.wins[win] = (s.wins[win] || 0) + 1; s.last = Math.max(s.last, r.at); });
    const list = Object.keys(series).map((k) => { const s = series[k], a = s.clubs[0], b = s.clubs[1], wa = s.wins[a] || 0, wb = s.wins[b] || 0;
      return Object.assign(s, { winner: wa > wb ? a : b, loser: wa > wb ? b : a, w: Math.max(wa, wb), l: Math.min(wa, wb) }); });
    const fin = list.filter((s) => s.round === rounds && s.clubs.indexOf(champ) >= 0)[0];
    if (!fin || fin.winner !== champ) throw new Error("closeOf: the filed champion " + champ + " did not win the last round's series");
    const lastRound = {}; list.forEach((s) => { s.clubs.forEach((c) => { lastRound[c] = Math.max(lastRound[c] || 0, s.round); }); });
    const table = CG.standings(lg).map((r) => ({ club: r.code, w: r.w, l: r.l, otl: r.otl, pts: r.pts, gf: r.gf, ga: r.ga,
      out: r.code === champ ? "cup" : !lastRound[r.code] ? "none" : lastRound[r.code] === rounds ? "final" : lastRound[r.code] === rounds - 1 ? "division" : "first" }));
    const trophies = [{ key: "stanley_cup", club: champ, over: fin.loser, w: fin.w, l: fin.l }, { key: "presidents_trophy", club: table[0].club }];
    /* the division final of each division (Rule 8.1: the two division champions meet in the final) */
    [["East", "wales_trophy"], ["West", "campbell_bowl"]].forEach((d) => {
      const s = list.filter((x) => x.round === rounds - 1 && x.clubs.every((c) => (CG.TEAM[c] || {}).div === d[0]))[0];
      if (s) trophies.push({ key: d[1], club: s.winner, over: s.loser, w: s.w, l: s.l });
    });
    const sk = CG.statPlayers(lg).map((p) => ({ p: p, s: lg.pstats[p.id] })).filter((x) => x.s && x.s.sgp > 0);
    const firstGoal = (pid) => { const e = arr(lg.glog[pid]).filter((x) => !x.line.goalie && x.line.g > 0)[0]; return e ? (lg.results.filter((r) => r.id === e.game)[0] || {}).at || Infinity : Infinity; };
    /* Art Ross: most points; ties by goals, then fewer games, then the earlier first goal */
    const ross = sk.slice().sort((a, b) => b.s.p - a.s.p || b.s.g - a.s.g || a.s.sgp - b.s.sgp || firstGoal(a.p.id) - firstGoal(b.p.id))[0];
    if (ross) trophies.push({ key: "art_ross", pid: ross.p.id, club: ross.p.team, total: ross.s.p, gp: ross.s.sgp });
    /* Rocket Richard: most goals; a tie is shared */
    const topG = Math.max.apply(null, sk.map((x) => x.s.g).concat([0]));
    if (topG > 0) sk.filter((x) => x.s.g === topG).forEach((x) => { trophies.push({ key: "rocket_richard", pid: x.p.id, club: x.p.team, total: x.s.g, gp: x.s.sgp }); });
    /* Jennings: the goaltenders of the club that allowed the fewest goals, each with the NHL's 25 of 82 games in goal for it,
       scaled to the club's regular season and rounded by Rule 8.3 (17 of 54) */
    const fewest = Math.min.apply(null, table.map((r) => r.ga));
    table.filter((r) => r.ga === fewest).forEach((r) => {
      const n = lg.schedule.filter((g) => g.stage === "regular" && (g.home === r.club || g.away === r.club)).length, floor = round83(25 / 82 * n);
      CG.statPlayers(lg).forEach((p) => { const c = CG.clubLine(lg.pstats[p.id], r.club);
        if (c && c.gs >= floor) trophies.push({ key: "jennings", pid: p.id, club: r.club, total: r.ga, gp: c.gs }); });
    });
    /* the Cup: every player on the champion's roster, active or camp, when the final's last game began */
    const finalAt = fin.last, cup = [];
    arr(tenures).forEach((t) => { if (t.team === champ && Date.parse(t.joined_at) <= finalAt && (!t.left_at || Date.parse(t.left_at) > finalAt) && cup.indexOf(t.profile_id) < 0) cup.push(t.profile_id); });
    return { table: table, trophies: trophies, cup: cup };
  }

  /* the body in the fixture's shape (S2DATA), which S2.fillModel reads */
  function fromLeague(body, archive) {
    const CG = S2.CG, teams = arr(body.teams), seasons = arr(body.seasons).slice().sort((a, b) => a.number - b.number);
    const people = {}; arr(body.people).forEach((p) => { people[p.id] = p; });
    const tagOf = (pid) => { const p = people[pid]; return p ? p.gamertag || p.display_name || "Player" : "Unknown player"; };
    const site = obj(obj(body.config).site), minGp = num(obj(body.pct).min_gp);
    /* each row with the playoff format of its own format (CG.FORMAT_RULES: basic, three a division), its rounds as
       CG.playoffRounds counts them, the series length from site_config.playoff_format, the floor from the row */
    const rows = seasons.map((s) => { const f = CG.FORMAT_RULES[s.format === "full" ? "full" : "basic"], per = f.playoff_per_div;
      return Object.assign({}, s, { playoff: { per_div: per, rounds: 1 + Math.ceil(Math.log(per) / Math.LN2 - 1e-9), best_of: num(obj(site.playoff_format).bestOf) || f.playoff_best_of,
        min_gp: s.playoff_min_gp != null ? s.playoff_min_gp : f.playoff_min_gp, round_names: ["division semi-final", "division final", "final"] } }); });
    const n = num(body.season), row = rows.filter((s) => s.number === n)[0];
    if (!row) throw new Error("s2_league: Season " + n + " is not among the seasons it returned");
    const spots = arr(obj(body.rosters).spots), contracts = arr(obj(body.rosters).contracts), tenures = arr(body.tenures);
    const lg = count(teams, body, posHints(tenures, body.signups));
    const spotOf = {}; spots.forEach((sp) => { spotOf[sp.profile_id] = sp; });
    const squadOf = (pid) => (spotOf[pid] ? spotOf[pid].squad : null);
    const games = arr(body.games), byGame = obj(obj(body.box).byGame), cols = arr(obj(body.box).cols);
    const lineN = {}; Object.keys(byGame).forEach((gid) => { lineN[gid] = arr(byGame[gid]).length; });
    const pp = (a, b) => (a == null || b == null ? null : a + "/" + b);
    const seat = {}; teams.forEach((t) => { if (t.owner_profile_id) seat[t.owner_profile_id] = "Owner"; if (t.gm_profile_id) seat[t.gm_profile_id] = "GM"; if (t.agm_profile_id) seat[t.agm_profile_id] = "AGM"; });
    const contractOf = {}; contracts.forEach((c) => { if (!contractOf[c.profile_id] || c.status === "active") contractOf[c.profile_id] = c; });
    const awards = arr(body.honors).map((h) => ({ season: h.season, week: h.week, category: h.category, pid: h.profile_id, club: h.team, line: h.stat_line }));
    const champOf = (k) => (awards.filter((a) => a.season === k && a.category === "champion")[0] || {}).club || null;
    const complete = (k) => (rows.filter((s) => s.number === k)[0] || {}).status === "complete" && !!champOf(k);
    const close = {}, partial = {
      desk: "Staff Desk figures are not in s2_league: s2_desk() is a staff read",
      control: "Control Center figures are not in s2_league: s2_control() is a commissioner read",
      jobs: "Scheduled job health is not in s2_league: ops_job_health() is a commissioner read",
      titles: "The statistical title race is not in s2_league: statistical_title_board() is read by the pages that show it",
      sittings: "EA import sittings are not in s2_league: they are staff data (s2_desk)" };
    /* a close that cannot be counted (no champion filed, or a final that disagrees with it) is reported, and the rest of the
       league still loads: the trophy room says why it is empty (M.partial.archive) */
    const closeFor = (k, slg, ten) => { try { close[k] = closeOf(CG, slg, ten, champOf(k)); } catch (e) { console.error("S2.buildModel:", e); partial.archive = "Season " + k + "'s close could not be counted: " + e.message; } };
    if (complete(n)) closeFor(n, lg, tenures);
    if (archive) {
      const an = num(archive.season);
      if (complete(an) && an < n) closeFor(an, count(teams, archive, posHints(archive.tenures, null)), arr(archive.tenures));
      else { console.error("S2.buildModel: the archive read is Season " + an + ", not an earlier complete season with a champion"); partial.archive = "Season " + an + " has no champion filed, so its close is not counted"; }
    }
    rows.filter((s) => complete(s.number) && !close[s.number] && !partial.archive).forEach((s) => { partial.archive = "Season " + s.number + "'s close (the trophy room and the Cup roster) needs that season's games: open it with ?season=" + s.number; });
    return {
      generated: body.generated, source: "live", season: n, pulse: body.pulse || null, partial: partial,
      league: { code: (arr(obj(body.league).leagues)[0] || {}).code || "CGHL", name: (arr(obj(body.league).leagues)[0] || {}).name || "Chel Gaming Hockey League",
        divisions: arr(obj(body.league).divisions).slice().sort((a, b) => num(a.sort_order) - num(b.sort_order)).map((d) => d.name) },
      teams: teams.map((t) => ({ code: t.code, city: t.city, name: t.name, arena: t.arena, division: t.division, color: t.color, color2: t.color2, logoUrl: t.logo_url || null,
        founded_season: t.founded_season, id: t.id })),
      seasons: rows, config: obj(body.config), pct: { min_gp: minGp },
      games: games.map((g) => ({ id: g.id, week: g.week, stage: g.stage || "regular", at: g.scheduled_at, status: g.status, home: g.home, away: g.away, hs: g.home_score,
        as: g.away_score, ot: !!g.went_ot, forfeit: g.forfeit || null, voided: !!g.voided, rescheduled_from: g.rescheduled_from || null,
        /* EA's match id (CG.liveGame's eaMatchId): the game desk finds a held game by it at once, not two hours past puck drop (g2) */
        eaMatchId: g.ea_match_id || null,
        home_pp: pp(g.home_ppg, g.home_ppo), away_pp: pp(g.away_ppg, g.away_ppo), lines: lineN[g.id] || 0 })),
      box: { cols: BOX_COLS, byGame: (() => { const o = {}; Object.keys(byGame).forEach((gid) => { o[gid] = arr(byGame[gid]).map((a) => { const r = {}; cols.forEach((c, i) => { r[c] = a[i]; }); return boxCompact(CG, r); }); }); return o; })(),
        /* EA's club figures: the shot count lives on the game (v4.45); time on attack and passing are not stored yet */
        clubCols: ["toa", "passc", "passa", "sittings", "shots"],
        clubByGame: (() => { const o = {}; games.forEach((g) => { if (g.home_shots == null && g.away_shots == null) return; o[g.id] = {}; o[g.id][g.home] = [null, null, null, null, g.home_shots]; o[g.id][g.away] = [null, null, null, null, g.away_shots]; }); return o; })() },
      lines: linesOf(CG, lg, lg.pstats, tagOf, squadOf),
      playoffLines: linesOf(CG, lg, lg.playoff.pstats, tagOf, squadOf),
      standings: standingsOf(CG, lg, games),
      rosters: spots.map((sp) => { const c = contractOf[sp.profile_id];
        return { pid: sp.profile_id, tag: tagOf(sp.profile_id), club: sp.team, pos: sp.position, squad: sp.squad, num: sp.jersey_number, salary: c && c.salary != null ? c.salary : sp.salary,
          origin: sp.origin, on_block: !!sp.on_block, seat: seat[sp.profile_id] || (c && c.is_manager && c.status === "active" ? "AGM" : null) }; }),
      /* already on the v4.48 scale; below the settle games a rating is provisional (player_rating, cghl_settle_gp) */
      ratings: arr(body.ratings).map((r) => ({ pid: r.profile_id, tag: tagOf(r.profile_id), pos: r.pos_cat, ovr: r.overall, gp: r.gp, headline: !!r.headline,
        provisional: num(r.gp) < minGp, cats: obj(r.categories), v448: true })),
      tenures: (() => { const o = {}; tenures.slice().sort((a, b) => Date.parse(a.joined_at) - Date.parse(b.joined_at)).forEach((t) => {
        (o[t.profile_id] = o[t.profile_id] || []).push({ club: t.team, pos: t.position, squad: t.squad, from: t.joined_at, to: t.left_at, how_in: HOW_IN[t.how_in] || "other", how_out: t.how_out == null ? null : HOW_OUT[t.how_out] || "moved" }); }); return o; })(),
      honors: { titles: [], potw: awards.filter((a) => a.season === n && /^potw_/.test(a.category)).map((a) => ({ week: a.week, category: a.category, tag: tagOf(a.pid), pid: a.pid, club: a.club, line: a.line })) },
      awards: awards, close: close,
      signups: arr(body.signups).map((r) => ({ pid: r.profile_id, tag: r.gamertag || tagOf(r.profile_id), pos: r.position, status: r.status, at: r.created_at, waived_at: r.waived_at || null })),
      draft: obj(body.draft), suspensions: arr(body.suspensions), career: obj(body.career),
      /* the league's members as the read lists them (M.members) */
      people: arr(body.people).map((p) => ({ id: p.id, gamertag: p.gamertag || null, display_name: p.display_name || null, role: p.role || null }))
    };
  }

  S2.buildModel = function (body, archive) {
    if (!body || typeof body !== "object") throw new Error("s2_league returned no body");
    const missing = REQUIRED.filter((k) => arr(body.sections).indexOf(k) < 0 || body[k] == null);
    if (missing.length) throw new Error("s2_league did not return " + missing.join(", ") + " (contracts/s2-league.md)");
    if (archive && ["games", "box", "tenures"].some((k) => archive[k] == null)) throw new Error("the archive read did not return its games, box scores and tenures");
    S2.fillModel(fromLeague(body, archive || null));
    return S2.M;
  };

  /* the first build: js/load.js has put the league data in S2.data (live), or data/snapshot.js has set S2DATA (fixture) */
  const d = S2.data;
  if (d && d.source === "live") S2.buildModel(d.body, d.archive);
  else if (window.S2DATA) S2.fillModel(window.S2DATA);
  else throw new Error("js/model.js: no league data (js/load.js reads s2_league; data/snapshot.js holds the fixture)");
})();
