/* seed: lineup — the Lineup builder (#/hub/lines), the per-game page (#/hub/lineup), the
   dashboard cards and the matchup "Confirmed lineups" card, populated the way a club sees them
   mid-season (Week 7: Wed Jul 15 @ Kraken, Sat Jul 18 vs Mammoth). Source of the shapes:
   part_live.js loadManagerData (:1135-1143 — game_lineups → _lineups, team_lines → _teamLines,
   team_line_plan → _linePlan), plannedLineup (:1443-1450), WEEK8 (:662-698); part6_hub.js
   hubLines / hubLineup / gmTasksCard / tonightCard.

   The clock: the engine's demo instant (8:45 PM ET) is already PAST the 8:30 PM lock of tonight's
   game, so the default pin is 7:30 PM ET (everything editable); the locked / emergency /
   released states pin 8:45 PM ET.

   ?state=… variants (one seed, many screens):
     (none)     saved lines + night plan, nothing dressed yet, 7:30 PM ET
     fresh      a club that has not built anything — three empty lines, no plan
     dressed    tonight's game already dressed from the plan ("1 / 1 dressed", "Redress")
     preseason  every game ahead is a pre-season game (management may sit anywhere on a line)
     approve    ?as=gm — the Owner set Lineup builder to "Owner approves" (banner + a Waiting row)
     hidden     ?as=agm — the Owner withheld Lineup builder from the AGM seat
     locked     8:45 PM ET, tonight's lineup submitted and locked (Emergency call-up door)
     emergency  locked + the call-up already enabled on tonight's game
     penalized  locked + one post-lock swap on record ("serves 1 penalty")
     released   8:45 PM ET, both clubs' sheets in game_lineups (matchup card "Released") */
(window.GUIDE_SEEDS = window.GUIDE_SEEDS || []).push({ name: "lineup", run: function(CG, t, uid){
  var lg = CG.lg, club = t.code, st = (window.GUIDE.qs.get("state") || "");
  var late = (st === "locked" || st === "emergency" || st === "penalized" || st === "released");
  /* the clock — a ticking pin, so countdowns and "ago" labels keep behaving */
  var base = Date.parse(late ? "2026-07-15T20:45:00-04:00" : "2026-07-15T19:30:00-04:00"), epoch = Date.now();
  CG.now = function(){ return base + (Date.now() - epoch); };
  var now = CG.now();
  function at(iso){ return Date.parse(iso); }
  /* the live schedule carries status 'final' on every played game (the club overview card's
     "Next" line and the upcoming-game filters read it); the engine's rows never set it */
  var played = {}; (lg.results||[]).forEach(function(r){ played[r.id] = true; });
  (lg.schedule||[]).forEach(function(g){ if (played[g.id]) g.status = "final"; });

  /* the current game week, exactly as part_live derives it mid-week (Week 7: Wed + Sat, the
     Sunday-8-PM deadline already behind us) — this is what makes the bench's availability chips
     and the "no Week 7 response" task row real */
  CG.WEEK8 = { key:"w7", label:"Week 7", deadline: at("2026-07-12T20:00:00-04:00"),
    nights:[ { key:"n1", at: at("2026-07-15T21:00:00-04:00") }, { key:"n2", at: at("2026-07-18T21:00:00-04:00") } ], open:true };
  CG._avail = CG._avail || {};
  /* the signed-in member answered last Sunday (a rostered persona only — a seat with no roster
     spot has nothing to answer) */
  CG._avail[CG.WEEK8.key+":"+uid] = { at: at("2026-07-12T14:10:00-04:00"), nights:{ n1:{ st:"yes", note:"" }, n2:{ st:"yes", note:"" } } };

  /* the club's players, by id — the engine builds them in position order (LW LW C C RW RW LD LD RD RD G G) */
  var R = lg.byTeam[club] || [];
  function pid(pos, depth){ var p = R.find(function(x){ return x.pos===pos && x.depth===depth; }); return p ? p.id : null; }
  var LW1=pid("LW",1), LW2=pid("LW",2), C1=pid("C",1), C2=pid("C",2), RW1=pid("RW",1), RW2=pid("RW",2),
      LD1=pid("LD",1), LD2=pid("LD",2), RD1=pid("RD",1), RD2=pid("RD",2), G1=pid("G",1), G2=pid("G",2);
  var tid = lg._codeToId[club];
  var tonight = (lg.tonight||[]).find(function(g){ return g.home===club || g.away===club; }) || {};
  var gid = tonight.id;

  /* saved lines (team_lines rows) + the night plan (team_line_plan) */
  var LINES = {
    1:{ slot:1, name:"Top Six",  lw:LW1, center:C2, rw:RW1, ld:LD1, rd:RD2, goalie:G2 },
    2:{ slot:2, name:"Energy",   lw:LW2, center:C1, rw:RW2, ld:LD2, rd:RD1, goalie:G1 },
    3:{ slot:3, name:"Shutdown", lw:LW1, center:C2, rw:RW2, ld:LD1, rd:RD1, goalie:G2 }
  };
  if (st !== "fresh"){ lg._teamLines = LINES; lg._linePlan = { wed:1, sat:2 }; }
  else { lg._teamLines = {}; lg._linePlan = {}; }
  lg._lineups = {};
  var TOP = { lw:LW1, center:C2, rw:RW1, ld:LD1, rd:RD2, goalie:G2 };
  function row(extra){ return Object.assign({ game_id:gid, team_id:tid, penalties_owed:0, submitted_by:uid, updated_at:new Date(now-3600000).toISOString() }, TOP, extra||{}); }

  /* the per-game page's working draft lives in the browser store — reset it on every boot so one
     capture never leaks into the next, then seed the states that need it */
  var store = {};
  if (st === "dressed") lg._lineups[club+":"+gid] = row();
  if (st === "locked" || st === "emergency"){
    lg._lineups[club+":"+gid] = row();
    store[gid+":"+club] = { status:"submitted", at: at("2026-07-15T18:06:00-04:00"), slots:{ LW:LW1, C:C2, RW:RW1, LD:LD1, RD:RD2, G:G2 },
      rev:[ { at: at("2026-07-15T18:05:00-04:00"), what:"Filled from Top Six" }, { at: at("2026-07-15T18:06:00-04:00"), what:"Lineup submitted to the league office" } ] };
    if (st === "emergency"){ CG._luEmergency = {}; CG._luEmergency[gid] = true; }
  }
  if (st === "penalized"){
    lg._lineups[club+":"+gid] = row({ lw:LW2, penalties_owed:1 });
    store[gid+":"+club] = { status:"submitted", at: at("2026-07-15T20:39:00-04:00"), slots:{ LW:LW2, C:C2, RW:RW1, LD:LD1, RD:RD2, G:G2 },
      rev:[ { at: at("2026-07-15T18:05:00-04:00"), what:"Filled from Top Six" }, { at: at("2026-07-15T18:06:00-04:00"), what:"Lineup submitted to the league office" },
            { at: at("2026-07-15T20:38:00-04:00"), what:"Removed "+((CG.playerById(lg,LW1)||{}).tag||"")+" from LW" }, { at: at("2026-07-15T20:38:30-04:00"), what:"Assigned "+((CG.playerById(lg,LW2)||{}).tag||"")+" to LW" },
            { at: at("2026-07-15T20:39:00-04:00"), what:"Emergency call-up submitted" } ] };
  }
  CG.store.set("lineups", store);

  /* career games played: a club seven weeks into the season is a dozen games in, so no overall is
     still provisional. Without this CG.ovrProgress reads 0 GP and every rating on every card
     carries "Provisional · 0 of 5 games" — true for a brand-new league, false for this one. */
  lg.careerGp = lg.careerGp || {};
  var clubGp = (lg.teams && lg.teams[club]) ? ((lg.teams[club].w||0) + (lg.teams[club].l||0) + (lg.teams[club].otl||0)) : 12;
  (lg.players||[]).forEach(function(p){ lg.careerGp[p.id] = Math.max(5, clubGp - (p.depth===2 ? 2 : 0)); });

  /* the bell — the dashboard's "Latest alerts" card and the sidebar's unread count read CG._notifs
     (part_live loadNotifs maps the notifications table into exactly this shape). Everything here is
     derived from the league that is actually on screen, so no alert can contradict the page. */
  function nightLabel(g){ return (CG.NIGHT_LABEL && CG.NIGHT_LABEL[CG.gameNight(g)]) || ""; }
  function gameLine(g){ var o = g.home===club ? g.away : g.home;
    return nightLabel(g)+" "+(g.home===club ? "vs " : "at ")+CG.TEAM[o].name+" · "+CG.fmtTime(g.at); }
  var nextTwo = (lg.schedule||[]).filter(function(g){ return (g.home===club||g.away===club) && g.at >= now - 3*3600000; })
    .sort(function(a,b){ return a.at-b.at; }).slice(0,2);
  var weekLine = nextTwo.map(gameLine).join(" · ");
  var lastG = (lg.results||[]).filter(function(r){ return (r.home===club||r.away===club) && r.score; })
    .sort(function(a,b){ return (a.at||0)-(b.at||0); }).pop();
  var finalAlert = lastG ? { id:"nf-final", icon:"chart",
      title:"Final — "+CG.TEAM[club].name+" "+lastG.score[club]+", "+CG.TEAM[lastG.home===club?lastG.away:lastG.home].name+" "+lastG.score[lastG.home===club?lastG.away:lastG.home],
      body:"Week "+(lastG.week||"")+" box score is in — club and player stats are updated.", route:"#/team/"+club, t: now - 44*3600000 } : null;
  /* who has answered for this week's first night, read back from the availability seed's own
     answers rather than asserted here */
  var n1k = ((CG.WEEK8.nights||[])[0]||{}).key, answered = 0, outs = [];
  R.forEach(function(p){ var a = (CG.avFor && CG.avFor(p.id)) || { nights:{} }; var stn = ((a.nights||{})[n1k]||{}).st;
    if (stn && stn !== "nr") answered++;
    if (stn === "no") outs.push(p.tag); });
  var isPlayer = (window.GUIDE.as === "player");
  CG._notifs = (isPlayer ? [
    { id:"nf-week", icon:"cal", title:CG.WEEK8.label+" is on the board", body:weekLine+".", route:"#/team/"+club, t: now - 20*3600000 },
    finalAlert,
    { id:"nf-av-open", icon:"users", title:CG.WEEK8.label+" availability is open",
      body:"Answer for both nights before Sunday 8:00 PM ET — your club builds its lines from it.", route:"#/hub/availability", t: now - 80*3600000 }
  ] : [
    { id:"nf-av-w7", icon:"users", title:CG.WEEK8.label+" availability — "+answered+" of "+R.length+" answered",
      body: outs.length ? outs.join(", ")+" marked unavailable for "+(nightLabel(tonight)||"the first night")+"." : "The whole club has answered for both nights.",
      route:"#/hub/availability", t: now - 3*3600000 },
    { id:"nf-sched-w7", icon:"cal", title:CG.WEEK8.label+" schedule posted", body:weekLine+".", route:"#/hub/schedule", t: now - 26*3600000 },
    finalAlert
  ]).filter(Boolean);
  /* the newest alert is the unread one; the rest have been seen (the card reads the "read" store) */
  var readMap = {}; CG._notifs.slice(1).forEach(function(n){ readMap[n.id] = true; });
  CG.store.set("read", readMap);

  /* the public card reads the REAL game_lineups table (loadMatchupLineups) — both clubs' sheets
     exist once the sheets have released */
  if (st === "released"){
    var oppCode = tonight.home===club ? tonight.away : tonight.home;
    var O = lg.byTeam[oppCode] || [];
    function opid(pos, depth){ var p = O.find(function(x){ return x.pos===pos && x.depth===depth; }); return p ? p.id : null; }
    lg._lineups[club+":"+gid] = row();
    tonight.code = "462918";   /* the commissioner's lobby code, live since the T-30 release */
    window.GUIDE_TABLES = window.GUIDE_TABLES || {};
    window.GUIDE_TABLES.game_lineups = [
      row(),
      { game_id:gid, team_id:lg._codeToId[oppCode], lw:opid("LW",1), center:opid("C",1), rw:opid("RW",1), ld:opid("LD",1), rd:opid("RD",1), goalie:opid("G",2), penalties_owed:0 }
    ];
  }

  /* pre-season variant: every game still ahead of the club is an exhibition game (v2.39) */
  if (st === "preseason") (lg.schedule||[]).forEach(function(g){ if (g.at > now - 3*3600000) g.stage = "preseason"; });

  /* Rule 2.6 variants — the Owner's per-seat access to the Lineup builder page */
  lg._mgmtPolicy = lg._mgmtPolicy || {}; lg._mgmtPolicy.gm = lg._mgmtPolicy.gm || {}; lg._mgmtPolicy.agm = lg._mgmtPolicy.agm || {};
  if (st === "approve"){
    lg._mgmtPolicy.gm.lines = "approve";
    lg._mgmtMoves = (lg._mgmtMoves||[]).concat([
      { id:"m-ln1", team_id:tid, page:"lines", action:"set_team_line_night", status:"pending", requested_by:"u-gm", requester:{ gamertag:"Mr. Plow" },
        summary:"dress Energy on Saturdays", created_at:new Date(now - 2*3600000).toISOString() }
    ]);
  }
  if (st === "hidden") lg._mgmtPolicy.agm.lines = "hidden";

  /* the writes answer the way the database does — a row back, so the client can claim success
     (the layer's default data:null reads as a refusal, which is the fail-loud path) */
  window.GUIDE_RPC = window.GUIDE_RPC || {};
  window.GUIDE_RPC.set_team_line = function(a){
    return { data:{ season_id:a.p_season, team_id:a.p_team, slot:a.p_slot, name:a.p_name, lw:a.p_lw, center:a.p_center, rw:a.p_rw, ld:a.p_ld, rd:a.p_rd, goalie:a.p_goalie }, error:null };
  };
  window.GUIDE_RPC.set_team_line_night = function(a){ return { data:{ night:a.p_night, slot:a.p_slot }, error:null }; };
  window.GUIDE_RPC.set_game_lineup = function(a){
    var g = (lg.schedule||[]).find(function(x){ return x.id===a.p_game; }) || {};
    var code = lg._idToCode[a.p_team] || club, prev = (lg._lineups||{})[code+":"+a.p_game];
    var next = { game_id:a.p_game, team_id:a.p_team, lw:a.p_lw, center:a.p_center, rw:a.p_rw, ld:a.p_ld, rd:a.p_rd, goalie:a.p_goalie };
    /* the T-30 lock, as set_game_lineup enforces it — only an emergency call-up passes, and each
       player changed is one in-game penalty (Rule 5.3) */
    var lockAt = (g.at||0) - 30*60000;
    if (g.at && CG.now() >= lockAt && !a.p_emergency) return { data:null, error:{ message:"This game's lineup locked at "+CG.fmtTime(lockAt)+" (Rule 5.3)." } };
    var owed = (prev && prev.penalties_owed) || 0;
    if (a.p_emergency && prev) ["lw","center","rw","ld","rd","goalie"].forEach(function(k){ if ((prev[k]||null) !== (next[k]||null)) owed++; });
    next.penalties_owed = owed; next.submitted_by = uid; next.updated_at = new Date().toISOString();
    return { data:next, error:null };
  };
} });
