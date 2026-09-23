/* seed: gamenight — one club's game night on the Bruins (CG.TEAMS[0]): the Schedule desk's server
   picks + T-30 lock + lobby code, the dashboard's "Tonight's slate" / "Management tasks", the
   per-game builder after the lock (emergency call-up), the matchup center before and after
   release, the Lineup builder's night plan, and the Game stats desk's lag-out rebuild.
   Sources of the shapes: part6_hub.js serverVetoControls/saveVeto (:557-600), gmTasksCard (:192),
   tonightCard (:322), hubLineup (:602), hubLines night plan (:1076); part_live.js hubScheduleLive
   (:11224), _gsList/_gsOne (:11309/11364), plannedLineup/_pubLineups (:1441), _smLeagueApi (:2160),
   mgmtQueue/mgmtApprovalBanner (:6267/6283), ovrNote/careerGp (part5a_public.js:2533).

   ?state=  (none)            Wed Jul 15, 7:45 PM ET — picks open, nothing dressed yet
            posted            same clock, the club's lineup for tonight is already submitted
            approve           picks open, but this seat's Schedule access is "Owner approves"
            locked            8:40 PM ET — picks locked, server resolved, code live, lineups out
            pending           8:40 PM ET, but the server has not resolved and no code is minted
            locked-nosheet    8:40 PM ET — our sheet is out, the opponent never posted one
            postgame          11:30 PM ET — tonight's game lagged out and imported one sitting
            postgame-empty    postgame, but EA's archive for the fixture is still empty
            postgame-unlinked postgame, but the club is not yet linked to its EASHL club
            noroster          the manager holds no roster spot (club-management dashboard)
   ?slate=2 keeps only the club's next two games on the calendar, so the per-game switcher in
   #/hub/lineup shows the two chips the guide talks about instead of nine identical ones.
   The management personas (?as=owner|gm|agm) are ROSTERED by default: the seat-holder becomes the
   club's own RW/C/LD starter (the engine's mgmt slots) under their gamertag, so the dashboard is
   the rostered-manager one with "Tonight's slate". */
(window.GUIDE_SEEDS = window.GUIDE_SEEDS || []).push({ name: "gamenight", run: function(CG, t, uid){
  var qs = window.GUIDE.qs, st = qs.get("state") || "", AS = window.GUIDE.as;
  var lg = CG.lg, club = t.code;
  var mine = function(g){ return g.home===club || g.away===club; };

  /* ---- the clock: every state sits on the demo evening (Wed Jul 15 2026), before or after the
     night's 8:30 PM ET lock; it keeps ticking so countdowns move ---- */
  var CLOCK = { "":"2026-07-15T19:45:00-04:00", posted:"2026-07-15T19:45:00-04:00", noroster:"2026-07-15T19:45:00-04:00",
                approve:"2026-07-15T19:45:00-04:00",
                locked:"2026-07-15T20:40:00-04:00", pending:"2026-07-15T20:40:00-04:00", "locked-nosheet":"2026-07-15T20:40:00-04:00",
                postgame:"2026-07-15T23:30:00-04:00", "postgame-empty":"2026-07-15T23:30:00-04:00", "postgame-unlinked":"2026-07-15T23:30:00-04:00" };
  var base = Date.parse(CLOCK[st] || CLOCK[""]), epoch = Date.now();
  CG.now = function(){ return base + (Date.now() - epoch); };
  var now = CG.now();
  var POST = st==="postgame" || st==="postgame-empty" || st==="postgame-unlinked";
  var locked = st==="locked" || st==="pending" || st==="locked-nosheet" || POST;
  var posted = locked || st==="posted";

  /* ---- prototype games carry no status: every game with a result is final, so the desks'
     "upcoming" lists start tonight ---- */
  var done = {}; lg.results.forEach(function(r){ done[r.id] = true; });
  lg.schedule.forEach(function(g){ g.status = done[g.id] ? "final" : "scheduled"; g.stage = g.stage || "regular"; });
  var TONIGHT = lg.tonight.filter(mine).sort(function(a,b){ return a.at-b.at; })[0];
  var upcoming = lg.schedule.filter(function(g){ return mine(g) && g.status!=="final"; }).sort(function(a,b){ return a.at-b.at; });
  var NEXT = upcoming.filter(function(g){ return TONIGHT && g.id!==TONIGHT.id; })[0];       /* Sat Jul 18, home */
  var past = lg.schedule.filter(function(g){ return mine(g) && g.status==="final"; }).sort(function(a,b){ return b.at-a.at; });
  var AWAIT = past[0], FORFEIT = past[1];                                                     /* Sat Jul 11, Wed Jul 8 */
  if (!TONIGHT) return;
  var OPP = TONIGHT.home===club ? TONIGHT.away : TONIGHT.home;
  /* the shot list addresses fixtures by name rather than by a hard-coded id */
  window.GUIDE.games = { tonight:TONIGHT.id, next:NEXT&&NEXT.id, awaiting:AWAIT&&AWAIT.id, forfeit:FORFEIT&&FORFEIT.id };

  /* ---- ?slate=N: only the club's next N games stay on the calendar. The per-game switcher in
     the builder prints one chip per upcoming game with no date on it, so nine of them read as
     duplicated UI — a guide shot of the lock wants the two nights the guide actually names. ---- */
  var slate = parseInt(qs.get("slate")||"0", 10);
  if (slate > 0){
    var keep = {}; upcoming.slice(0, slate).forEach(function(g){ keep[g.id] = true; });
    lg.schedule = lg.schedule.filter(function(g){ return !mine(g) || g.status==="final" || keep[g.id]; });
  }

  /* ---- the seat-holder is a rostered player on the club (the engine already makes the RW/C/LD
     starters the owner/gm/agm) ---- */
  var SEAT_POS = { owner:"RW", gm:"C", agm:"LD" };
  if (st!=="noroster" && SEAT_POS[AS]){
    var pl = (lg.byTeam[club]||[]).find(function(p){ return p.pos===SEAT_POS[AS] && p.depth===1; });
    if (pl){ pl.tag = CG.auth.profile.gamertag; pl.eaId = CG.auth.profile.ea_id; CG.auth.profile.id = pl.id; }
  }

  /* ---- games played: the live build fills lg.careerGp from the season aggregate, and an overall
     with no games behind it is flagged "Provisional · 0 of 5 games". The prototype has played
     seven weeks, so take the count from the same stat lines the profile cards read. ---- */
  lg.careerGp = {};
  Object.keys(lg.pstats||{}).forEach(function(pid){ lg.careerGp[pid] = (lg.pstats[pid]||{}).gp || 0; });

  /* ---- lobby codes for tonight's slate (the league office minted them; the UI hides a code until
     T-30), the resolved server once the night has locked. ?state=pending is the live-night state
     the map names: past T-30 with resolve_game_server still unanswered and no code minted. ---- */
  var CODES = ["482913","715046","903318","264781"];
  lg.tonight.slice().sort(function(a,b){ return a.at-b.at; }).forEach(function(g, i){ g.code = CODES[i] || null; });
  if (st==="pending"){ TONIGHT.code = null; lg._servers = {}; }
  else if (locked){ TONIGHT.server = "NA Northeast"; lg._servers = {}; lg._servers[TONIGHT.id] = "NA Northeast"; }

  /* ---- server picks: Saturday's home game already has its 1st/2nd choice; tonight's away game is
     the one the guide sets (already set once the night has locked) ---- */
  lg._vetoes = {};
  /* under Owner-approves nothing this seat picked exists yet — the moves are still in the queue,
     so every dropdown reads "— pick —" (that IS the pitfall the state teaches) */
  if (NEXT && st!=="approve") lg._vetoes[NEXT.id] = { game_id:NEXT.id, team_id:t.id, pref1:"NA Northeast", pref2:"NA Northeast", veto:null, preferred:null };
  if (locked) lg._vetoes[TONIGHT.id] = { game_id:TONIGHT.id, team_id:t.id, veto:"NA Central", preferred:"NA Northeast", pref1:null, pref2:null };

  /* ---- Rule 2.6: the Owner can put a GM/AGM seat's Schedule page under approval. The pick is
     then queued (mgmt_request_move) instead of saved, and the page carries the Owner's banner. ---- */
  lg._mgmtPolicy = {}; lg._mgmtMoves = [];
  if (st==="approve"){
    lg._mgmtPolicy = { gm:{ schedule:"approve" }, agm:{ schedule:"approve" } };
    if (NEXT) lg._mgmtMoves = [{ id:"mv-101", team_id:t.id, page:"schedule", action:"schedule_pick", status:"pending",
      requested_by:(CG.auth.user||{}).id, created_at:new Date(base - 26*60000).toISOString(),
      summary:"set the server choices vs "+((CG.TEAM[NEXT.home===club?NEXT.away:NEXT.home]||{}).name||"?")+" · "+CG.fmtDay(NEXT.at) }];
  }

  /* ---- saved lines + the night plan (Lineup builder), and the lineup rows once posted ---- */
  function six(code, depth){
    var r = lg.byTeam[code]||[], pick = function(pos){ var p = r.filter(function(x){ return x.pos===pos; }).sort(function(a,b){ return a.depth-b.depth; })[depth-1] || r.find(function(x){ return x.pos===pos; }); return p ? p.id : null; };
    return { lw:pick("LW"), center:pick("C"), rw:pick("RW"), ld:pick("LD"), rd:pick("RD"), goalie:pick("G") };
  }
  lg._teamLines = { 1: Object.assign({ slot:1, team_id:t.id, name:"Top line" }, six(club,1)),
                    2: Object.assign({ slot:2, team_id:t.id, name:"Second line" }, six(club,2)) };
  lg._linePlan = { wed:1, sat:1 };
  lg._lineups = lg._lineups || {};
  CG._pubLineups = CG._pubLineups || {};
  if (posted){
    var row = Object.assign({ game_id:TONIGHT.id, team_id:t.id, penalties_owed:0, emergency:false }, six(club,1));
    lg._lineups[club+":"+TONIGHT.id] = row;
    CG._pubLineups[club+":"+TONIGHT.id] = row;
    /* the opponent's sheet: posted like ours, except in the state that teaches the empty half */
    CG._pubLineups[OPP+":"+TONIGHT.id] = st==="locked-nosheet"
      ? null
      : Object.assign({ game_id:TONIGHT.id, team_id:lg._codeToId[OPP] }, six(OPP,1));
  } else {
    /* both keys present = the matchup page's fetch is short-circuited (the stub would null them) */
    CG._pubLineups[club+":"+TONIGHT.id] = null; CG._pubLineups[OPP+":"+TONIGHT.id] = null;
  }

  /* ---- home rinks: the clubs table pinned in clubs.json carries no arena, and the matchup hero
     prints "<date> · <arena>" ---- */
  var ARENAS = { BOS:"TD Garden", DET:"Little Caesars Arena", NYI:"UBS Arena", PIT:"PPG Paints Arena", DAL:"American Airlines Center", SEA:"Climate Pledge Arena", UTA:"Delta Center", VAN:"Rogers Arena" };
  CG.TEAMS.forEach(function(x){ if (!x.arena && ARENAS[x.code]) x.arena = ARENAS[x.code]; });

  /* ---- the open availability week (seeded by availability.js) is the week after this one ---- */
  if (CG.WEEK8 && CG.WEEK8.open && CG.WEEK8.key!=="w8"){
    var old = CG.WEEK8.key; CG.WEEK8.key = "w8"; CG.WEEK8.label = "Week 8";
    Object.keys(CG._avail||{}).forEach(function(k){ if (k.indexOf(old+":")===0) CG._avail["w8:"+k.slice(old.length+1)] = CG._avail[k]; });
  }

  /* ---- Game stats desk: the club's games as the `games` table returns them (newest first).
     Tonight lagged out — EA imported the first sitting only (6 lines); last Saturday's box score
     never arrived; the game before that was a forfeit the opponent took. ---- */
  var idOf = function(code){ return lg._codeToId[code]; };
  var GAMES = lg.schedule.filter(function(g){ return mine(g) && (!NEXT || g.at <= NEXT.at); }).sort(function(a,b){ return b.at-a.at; }).map(function(g){
    var r = lg.results.find(function(x){ return x.id===g.id; });
    var row = { id:g.id, week:g.week, stage:"regular", scheduled_at:new Date(g.at).toISOString(), status:r?"final":"scheduled",
      home_team_id:idOf(g.home), away_team_id:idOf(g.away), home_score:r?r.score[g.home]:null, away_score:r?r.score[g.away]:null,
      voided:false, forfeit_team_id:null, game_stats:[{ count:r?12:0 }] };
    if (g.id===TONIGHT.id && POST){
      row.status = "final"; row.home_score = TONIGHT.home===club ? 2 : 1; row.away_score = TONIGHT.home===club ? 1 : 2; row.game_stats = [{ count:6 }];
    }
    if (AWAIT && g.id===AWAIT.id){ row.status = "scheduled"; row.home_score = null; row.away_score = null; row.game_stats = [{ count:0 }]; }
    if (FORFEIT && g.id===FORFEIT.id){
      var oppF = g.home===club ? g.away : g.home;
      row.status = "final"; row.forfeit_team_id = idOf(oppF); row.home_score = g.home===club ? 1 : 0; row.away_score = g.home===club ? 0 : 1; row.game_stats = [{ count:0 }];
    }
    return row;
  });
  /* ---- the bell: what a member's alerts look like on a game night ---- */
  var oppName = (CG.TEAM[OPP]||{}).name || OPP, tTime = CG.fmtTime(TONIGHT.at), lockTime = CG.fmtTime(TONIGHT.at - 30*60000);
  var vs = (TONIGHT.home===club ? t.name+" vs "+oppName : t.name+" @ "+oppName);
  CG._notifs = [];
  if (locked) CG._notifs.push({ id:"gn-code", t: TONIGHT.at - 30*60000, icon:"code", title:"Lobby code live — "+vs, body:"Server: NA Northeast. The code is on the matchup page — rostered players and management only (Rule 4.2).", read:false, route:"#/matchup/"+TONIGHT.id });
  if (posted) CG._notifs.push({ id:"gn-lineup", t: base - 55*60000, icon:"check", title:"Lineup submitted — "+vs, body:"Six dressed for "+tTime+". Locks "+lockTime+" (Rule 5.3).", read:locked, route:"#/hub/lineup?game="+TONIGHT.id });
  CG._notifs.push({ id:"gn-night", t: Date.parse("2026-07-15T12:00:00-04:00"), icon:"clock", title:"Game night — "+vs+", "+tTime, body:"Server picks and lineups lock "+lockTime+"; the private lobby code releases then.", read:posted, route:"#/hub/schedule" });
  CG._notifs.push({ id:"gn-avail", t: Date.parse("2026-07-13T20:05:00-04:00"), icon:"cal", title:"Week 8 availability is open", body:"Answer by Sunday 8:00 PM ET so your management can build the lineups.", read:true, route:"#/hub/availability" });
  var lastBox = GAMES.find(function(r){ return r.status==="final" && r.game_stats[0].count===12 && !r.forfeit_team_id && r.id!==TONIGHT.id; });
  if (lastBox){
    var lbHome = lg._idToCode[lastBox.home_team_id], lbAway = lg._idToCode[lastBox.away_team_id];
    var lbMine = lbHome===club ? lastBox.home_score : lastBox.away_score, lbTheirs = lbHome===club ? lastBox.away_score : lastBox.home_score;
    CG._notifs.push({ id:"gn-box", t: Date.parse(lastBox.scheduled_at) + 100*60000, icon:"chart", title:"Box score imported — "+t.name+" "+lbMine+", "+((CG.TEAM[lbHome===club?lbAway:lbHome]||{}).name||"opponent")+" "+lbTheirs, body:"The final landed from EA within minutes of the horn. Standings, ratings and profiles are updated.", read:true, route:"#/matchup/"+lastBox.id });
  }
  try { var rd = CG.store.get("read") || {}; CG._notifs.forEach(function(n){ if (n.read) rd[n.id] = true; }); CG.store.set("read", rd); } catch(e){}

  function gamesChain(){
    var one = null;
    var p = new Proxy(function(){}, {
      get: function(_, k){
        if (k === "then") return function(res, rej){ var data = one ? (GAMES.find(function(r){ return r.id===one; }) || null) : GAMES.slice(); return Promise.resolve({ data:data, error:null }).then(res, rej); };
        if (k === "catch") return function(){ return p; };
        if (k === "eq") return function(f, v){ if (f === "id") one = v; return p; };
        return function(){ return p; };
      },
      apply: function(){ return p; }
    });
    return p;
  }
  var _from = CG.sb.from;
  CG.sb.from = function(table){ if (table === "games") return gamesChain(); return _from.apply(CG.sb, arguments); };

  /* ---- the ingest-stats gateway (the real one POSTs /api/ingest-stats), per fixture:
       tonight   — the imported first half, the second sitting after the lag-out, and one sitting
                   from last night that belongs to a different game
       forfeit   — the single partial sitting of a game that was ruled 1–0 before it finished
     ?state=postgame-empty starts tonight's archive empty, so "Check EA for this game's sessions"
     is the state the desk actually opens in right after the horn. ---- */
  var EA = { linked: st!=="postgame-unlinked" };
  var sec = function(ms){ return Math.floor(ms/1000); };
  var oppEa = (CG.TEAM[OPP]||{}).name ? ("Chel Gaming "+CG.TEAM[OPP].name) : "Opponent (EA)";
  var tAt = TONIGHT.at;
  var TONIGHT_SITTINGS = [
    { matchId:"ea-771204", ts:sec(tAt+5*60000),  minutes:7,  homeScore:1, awayScore:2, status:"imported",  oppEaName:oppEa, attached:true,  usedElsewhere:false },
    { matchId:"ea-771231", ts:sec(tAt+31*60000), minutes:5,  homeScore:1, awayScore:2, status:"unmatched", oppEaName:oppEa, attached:false, usedElsewhere:false },
    { matchId:"ea-770958", ts:sec(tAt-24*3600000+10*60000), minutes:12, homeScore:3, awayScore:1, status:"imported", attached:false, usedElsewhere:true }
  ];
  var ARCH = {};
  ARCH[TONIGHT.id] = st==="postgame-empty" ? [] : TONIGHT_SITTINGS;
  if (FORFEIT){
    var fOpp = FORFEIT.home===club ? FORFEIT.away : FORFEIT.home;
    var fEa = (CG.TEAM[fOpp]||{}).name ? ("Chel Gaming "+CG.TEAM[fOpp].name) : "Opponent (EA)";
    ARCH[FORFEIT.id] = [{ matchId:"ea-768840", ts:sec(FORFEIT.at+6*60000), minutes:9, homeScore:(FORFEIT.home===club?3:1), awayScore:(FORFEIT.home===club?1:3),
      status:"unmatched", oppEaName:fEa, attached:false, usedElsewhere:false }];
  }
  var rowFor = function(gid){ return GAMES.find(function(r){ return r.id===gid; }); };
  CG._smLeagueApi = function(p){
    p = p || {};
    if (p.leagueCandidates){
      var gid = p.leagueCandidates.gameId, g = rowFor(gid);
      if (!g) return Promise.resolve({ error:"That fixture isn’t one of yours." });
      var homeCode = lg._idToCode[g.home_team_id], awayCode = lg._idToCode[g.away_team_id];
      return Promise.resolve({ role:"management",
        game:{ id:gid, week:g.week, status:g.status, home:homeCode, away:awayCode, score:g.home_score+"-"+g.away_score },
        linked:{ home: homeCode===club ? EA.linked : true, away: awayCode===club ? EA.linked : true },
        needsLink: !EA.linked,
        candidates: EA.linked ? (ARCH[gid]||[]).map(function(c){ return Object.assign({}, c); }) : [] });
    }
    if (p.leagueEaSearch){
      var q = String(p.leagueEaSearch.clubName||"").toLowerCase();
      var hit = q.indexOf((t.name||"").toLowerCase()) >= 0 || q.indexOf("chel") >= 0;
      return Promise.resolve({ clubs: hit ? [{ clubId:"3141592", name:"Chel Gaming "+t.name, memberCount:14 }] : [] });
    }
    if (p.leagueEaLink){ EA.linked = true; return Promise.resolve({ teamCode:club }); }
    if (p.leagueEaFetch){
      /* pulling the club's latest sessions is what fills an empty archive */
      ARCH[TONIGHT.id] = TONIGHT_SITTINGS;
      return Promise.resolve({ fetched:3, club:"Chel Gaming "+t.name });
    }
    if (p.leagueMerge){
      var mid = p.leagueMerge.gameId, ids = (p.leagueMerge.matchIds||[]);
      var picked = (ARCH[mid]||[]).filter(function(c){ return ids.indexOf(c.matchId) >= 0; });
      if (!picked.length) return Promise.resolve({ error:"Select at least one sitting" });
      var hs = 0, as = 0; picked.forEach(function(c){ hs += c.homeScore; as += c.awayScore; c.attached = true; c.status = "imported"; });
      var g2 = rowFor(mid); g2.status = "final"; g2.home_score = hs; g2.away_score = as; g2.forfeit_team_id = null; g2.game_stats = [{ count:12 }];
      return Promise.resolve({ sittings:picked.length, score:hs+"-"+as, wentOt:false, players:12, linked:12 });
    }
    return Promise.resolve({ error:"unstubbed call" });
  };
  /* the live reloadLeague re-renders the whole page after a merge; the guide's stub does the same
     synchronously and would wipe the "Done." note before it could be seen — keep the fixture desk
     as it is (the header has already been updated in place) */
  var _reload = CG.reloadLeague;
  CG.reloadLeague = async function(){ if (/#\/hub\/gamestats\?game=/.test(location.hash)) return; return _reload.apply(CG, arguments); };
} });
