/* ================================================================
   LIVE DATA ADAPTER
   Replaces the simulated engine with real Supabase data. Builds the
   same CG.lg shape that CG.aggregate + the whole UI already consume,
   from real teams / rosters / contracts / games / transactions.
   Season 1 is pre-season, so results/stats are empty and the derived
   fields come out as clean zeros — the UI renders "not started yet".
   ================================================================ */
CG.LIVE_MODE = true;
CG.SB_URL = "https://bzbuyclwdhmhdzujxeqd.supabase.co";
CG.SB_KEY = "sb_publishable_9OVgiNJSCSKKp0NfnCwbBQ_W1rcrK3Z";
CG.sb = (window.supabase && window.supabase.createClient)
  ? window.supabase.createClient(CG.SB_URL, CG.SB_KEY, { auth:{ persistSession:true, autoRefreshToken:true } })
  : null;

/* real wall clock (the prototype used a frozen demo clock) */
CG._loadEpoch = Date.now();
CG.now = function(){ return Date.now(); };

/* format a time-on-ice value (seconds) as m:ss for box scores / stat lines */
CG.fmtToi = function(sec){ sec = Math.max(0, Math.round(+sec||0)); var m=Math.floor(sec/60), s=sec%60; return m+":"+(s<10?"0":"")+s; };
/* seconds -> whole minutes, for per-game averages */
CG.toiMin = function(sec){ return Math.round((+sec||0)/60); };

/* real site identity (the static head still says "Platform Prototype") */
try {
  document.title = "Chel Gaming Hockey League";
  var _md = document.querySelector('meta[name="description"]');
  if (_md) _md.setAttribute("content", "The competitive home of 6v6 EA Sports NHL — schedules, standings, rosters, salary cap, trades, and the league rulebook.");
} catch(e){}

CG.LIVE = { loaded:false, error:null };

CG.buildLiveLeague = async function(){
  var sb = CG.sb;
  if (!sb) throw new Error("Supabase client unavailable");
  var q = await Promise.all([
    sb.from("teams").select("*"),
    sb.from("divisions").select("*").order("sort_order"),
    sb.from("seasons").select("*").order("number", { ascending:false }).limit(1),
    sb.from("profiles").select("*"),
    sb.from("roster_spots").select("*"),
    sb.from("contracts").select("*"),
    sb.from("games").select("*").order("scheduled_at"),
    sb.from("transactions").select("*").order("occurred_at", { ascending:false }),
    sb.from("news").select("*").order("published_at", { ascending:false }),
    sb.from("draft_picks").select("id,season_number,round,original_team_id,current_team_id,player_id,used,overall_pick,skipped").order("season_number").order("round"),
    sb.from("season_registrations").select("id,profile_id,position,scout_ovr, profiles(gamertag,ea_id)"),
    sb.from("leagues").select("*").order("sort_order"),
    sb.from("game_stats").select("*")
  ]);
  /* first 9 are public-readable and required; draft_picks + season_registrations
     (9,10) are manager-gated by RLS and fail for guests — optional here, reloaded
     after auth for managers. leagues (11) + game_stats (12) are public but non-fatal. */
  var bad = q.slice(0,9).find(function(r){ return r.error; });
  if (bad) throw new Error(bad.error.message || "query failed");
  var teamsRaw=q[0].data||[], divisions=q[1].data||[], season=(q[2].data||[])[0]||null,
      profiles=q[3].data||[], roster=q[4].data||[], contracts=q[5].data||[],
      games=q[6].data||[], transactions=q[7].data||[], news=q[8].data||[],
      draftPicks=(q[9]&&!q[9].error&&q[9].data)||[], registrations=(q[10]&&!q[10].error&&q[10].data)||[],
      leaguesRaw=(q[11]&&!q[11].error&&q[11].data)||[],
      gameStatsRows=(q[12]&&!q[12].error&&q[12].data)||[];

  /* ---- leagues / tiers (CG umbrella; CGHL = top tier, inspired by NHL) ---- */
  var leagueById={};
  CG.LEAGUES = leaguesRaw.map(function(l){
    var obj = { id:l.id, code:l.code, name:l.name, tier:l.tier, inspiration:l.inspiration||null,
      sort:(l.sort_order==null?0:l.sort_order), teamCount:0 };
    leagueById[l.id]=obj; return obj;
  });
  /* fallback so the UI always has the top tier even before the table is seeded */
  if (!CG.LEAGUES.length) CG.LEAGUES = [{ id:null, code:"CGHL", name:"Chel Gaming Hockey League", tier:1, inspiration:"NHL", sort:0, teamCount:0 }];
  CG.LEAGUE_BY_CODE={}; CG.LEAGUES.forEach(function(l){ CG.LEAGUE_BY_CODE[l.code]=l; });
  var topLeague = CG.LEAGUES.slice().sort(function(a,b){ return a.tier-b.tier || a.sort-b.sort; })[0];
  CG.TOP_LEAGUE = topLeague;

  /* ---- team registry (rebuilt from the DB: real logos, ids, management) ---- */
  var teamById={}, id2code={};
  CG.TEAMS = teamsRaw.map(function(t){
    var lg2 = t.league_id ? leagueById[t.league_id] : topLeague;
    if (lg2) lg2.teamCount++;
    var obj = { code:t.code, name:t.name, city:t.city||"", arena:t.arena||"",
      div:t.division||"East", color:(t.color||"#8899A6").toUpperCase(), est:t.founded_season||1,
      logo:t.logo_url||null, id:t.id,
      leagueId:(lg2&&lg2.id)||null, leagueCode:(lg2&&lg2.code)||"CGHL",
      owner:t.owner_profile_id, gm:t.gm_profile_id, agm:t.agm_profile_id,
      eaClub:t.ea_club_name||null, eaClubId:(t.ea_club_id!=null?String(t.ea_club_id):null) };
    teamById[t.id]=obj; id2code[t.id]=t.code; return obj;
  }).sort(function(a,b){ return (a.div===b.div?0:(a.div<b.div?-1:1)) || (a.code<b.code?-1:1); });
  CG.TEAM={}; CG.TEAMS.forEach(function(t){ CG.TEAM[t.code]=t; });
  CG.DIVISIONS = divisions.map(function(d){ return d.name; });

  /* ---- season + cap ---- */
  CG.SEASON = season || {};
  CG.CAP = (season && season.salary_cap) ? season.salary_cap : 60000000;
  CG.ROSTER_MAX = (season && season.roster_max) || 15;
  var seasonId = season ? season.id : null;

  /* ---- players from roster_spots (+ profile + contract) ---- */
  var profById={}; profiles.forEach(function(p){ profById[p.id]=p; });
  var contractByProf={}; contracts.forEach(function(c){
    /* prefer the active/current-season contract */
    if (!contractByProf[c.profile_id] || c.status==="active") contractByProf[c.profile_id]=c;
  });
  var depth={};
  var players = roster
    .filter(function(rs){ return !seasonId || rs.season_id===seasonId; })
    .map(function(rs){
      var p = profById[rs.profile_id] || {};
      var team = teamById[rs.team_id];
      if (!team) return null;
      var pos = rs.position || "C";
      var dk = team.code+":"+pos; depth[dk]=(depth[dk]||0)+1;
      var c = contractByProf[rs.profile_id];
      var mgmt = null;
      if (p.id===team.owner) mgmt="owner";
      else if (p.id===team.gm) mgmt="gm";
      else if (p.id===team.agm) mgmt="agm";
      else if (c && c.is_manager) mgmt="agm";
      return {
        id: rs.profile_id,
        tag: p.gamertag || p.display_name || "Player",
        team: team.code, pos: pos, depth: depth[dk],
        jersey: rs.jersey_number || p.jersey_number || 0,
        platform: p.platform || "—",
        arch: "Two-Way", shoots: "L", rookie: false, joined: "Season 1",
        twitch: p.twitch || null, twitchLive: !!p.live,
        overall: p.overall || 70,
        eaId: p.ea_id || "", avatar: p.avatar_url || null,
        banned: !!p.banned, discordId: p.discord_id,
        salary: (c && c.salary!=null) ? c.salary : (rs.salary||0),
        term: c ? Math.max(1, (c.end_season||1) - (c.start_season||1) + 1) : 1,
        mgmt: mgmt, mgmtSalary: (mgmt==="owner"||mgmt==="gm"),
        onBlock: false, status: rs.status || "active"
      };
    })
    .filter(Boolean);

  var byTeam={}; CG.TEAMS.forEach(function(t){ byTeam[t.code]=[]; });
  players.forEach(function(p){ (byTeam[p.team]=byTeam[p.team]||[]).push(p); });

  /* ---- schedule + results ---- */
  var schedule = games.map(function(g){
    return { id:g.id, week:g.week||1,
      home:id2code[g.home_team_id], away:id2code[g.away_team_id],
      at:Date.parse(g.scheduled_at), feature:false,
      code:g.game_code||null, server:g.server||null, status:g.status,
      homeScore:g.home_score, awayScore:g.away_score, ot:!!g.went_ot,
      eaMatchId:g.ea_match_id||null };
  }).filter(function(g){ return g.home && g.away && g.at; });

  /* per-player box scores from game_stats (written by the EA auto-stats pipeline).
     Each box line carries the prototype's base keys (so CG.aggregate builds season
     totals) plus every EA advanced metric, keyed by profile id (unlinked EA players
     keep a synthetic key so they still render but don't corrupt a profile's totals). */
  var statsByGame = {};
  gameStatsRows.forEach(function(r){ (statsByGame[r.game_id]=statsByGame[r.game_id]||[]).push(r); });
  function eaSkaterLine(r){
    return { goalie:false,
      g:+r.goals||0, a:+r.assists||0, pm:+r.plus_minus||0, shots:+r.shots||0, hits:+r.hits||0,
      blk:+r.blocked_shots||0, gv:+r.giveaways||0, tk:+r.takeaways||0, pim:+r.pim||0,
      fow:+r.faceoffs_won||0, fot:+r.faceoffs_lost||0, gwg:+r.gwg||0,
      ppg:+r.pp_goals||0, shg:+r.sh_goals||0, toi:+r.time_on_ice_seconds||0,
      pass:+r.passes_completed||0, passAtt:+r.passes_attempted||0, sat:+r.shot_attempts||0,
      poss:+r.possession_seconds||0, intc:+r.interceptions||0, pdrawn:+r.penalties_drawn||0,
      defl:+r.deflections||0, saucer:+r.saucer_passes||0,
      ratOff:+r.offense_rating||0, ratDef:+r.defense_rating||0, ratTeam:+r.team_play_rating||0,
      name:r.skater_name||null, pos:r.position||null, eaId:r.ea_player_id||null, pid:r.profile_id||null };
  }
  function eaGoalieLine(r, won, ot){
    var sa=+r.shots_against||0, sv=+r.saves||0;
    return { goalie:true, sa:sa, sv:sv, ga:+r.goals_against||0,
      w:won?1:0, l:(!won&&!ot)?1:0, otl:(!won&&ot)?1:0,
      so:r.shutout?1:0, qs:((sa>0?(sv/sa):1)>=.885)?1:0,
      brkShots:+r.breakaway_shots||0, brkSv:+r.breakaway_saves||0, pokes:+r.poke_checks||0,
      toi:+r.time_on_ice_seconds||0,
      name:r.skater_name||null, pos:"G", eaId:r.ea_player_id||null, pid:r.profile_id||null };
  }
  var results = schedule
    .filter(function(g){ return g.status==="final" && g.homeScore!=null && g.awayScore!=null; })
    .map(function(g){
      var score={}; score[g.home]=g.homeScore; score[g.away]=g.awayScore;
      var box={}; box[g.home]={}; box[g.away]={};
      (statsByGame[g.id]||[]).forEach(function(r){
        var code = id2code[r.team_id]; if(!code || !box[code]) return;
        var opp = code===g.home ? g.away : g.home;
        var key = r.profile_id || ("ea:"+r.id);
        box[code][key] = r.is_goalie ? eaGoalieLine(r, score[code]>score[opp], g.ot) : eaSkaterLine(r);
      });
      /* three stars — top performers across both clubs (linked players only) */
      var cand = [];
      [g.home, g.away].forEach(function(code){
        Object.keys(box[code]).forEach(function(pid){
          if (String(pid).indexOf("ea:")===0) return; /* unlinked EA player — can't link a star */
          var b = box[code][pid];
          var val = b.goalie ? (b.sv*0.1 + (b.so?3:0) + (b.w?2:0) + (b.sa?(b.sv/b.sa):0)*2)
                             : (b.g*3 + b.a*2 + b.shots*0.15 + Math.max(0,b.pm)*0.3);
          cand.push({ pid:pid, team:code, val:val, g:b.g||0 });
        });
      });
      var stars = cand.sort(function(a,b){ return b.val-a.val || b.g-a.g; }).slice(0,3).map(function(x){ return { pid:x.pid, team:x.team }; });
      return { id:g.id, week:g.week, home:g.home, away:g.away, at:g.at,
        ot:g.ot, score:score, box:box, stars:stars, entered:true };
    });

  var lg = { players:players, byTeam:byTeam, schedule:schedule, results:results,
             suspensions:[], demoNow:CG.now(), season:season, live:true };
  CG.aggregate(lg, {});

  /* extend season stat lines with EA-only advanced metrics (base G/A/P/etc. came
     from the box above via CG.aggregate; these power the advanced leaders + profiles) */
  if (gameStatsRows.length){
    var finalIds = {}; results.forEach(function(r){ finalIds[r.id]=true; });
    gameStatsRows.forEach(function(r){
      if (!finalIds[r.game_id] || !r.profile_id) return;
      var s = lg.pstats[r.profile_id]; if (!s) return;
      s.toi = (s.toi||0) + (+r.time_on_ice_seconds||0);
      if (r.is_goalie){
        s.brkShots=(s.brkShots||0)+(+r.breakaway_shots||0);
        s.brkSv=(s.brkSv||0)+(+r.breakaway_saves||0);
        s.pokes=(s.pokes||0)+(+r.poke_checks||0);
      } else {
        s.ppg=(s.ppg||0)+(+r.pp_goals||0); s.shg=(s.shg||0)+(+r.sh_goals||0);
        s.pass=(s.pass||0)+(+r.passes_completed||0); s.passAtt=(s.passAtt||0)+(+r.passes_attempted||0);
        s.sat=(s.sat||0)+(+r.shot_attempts||0); s.poss=(s.poss||0)+(+r.possession_seconds||0);
        s.intc=(s.intc||0)+(+r.interceptions||0); s.pdrawn=(s.pdrawn||0)+(+r.penalties_drawn||0);
        s.defl=(s.defl||0)+(+r.deflections||0); s.saucer=(s.saucer||0)+(+r.saucer_passes||0);
        s._ratOff=(s._ratOff||0)+(+r.offense_rating||0); s._ratDef=(s._ratDef||0)+(+r.defense_rating||0);
        s._ratTeam=(s._ratTeam||0)+(+r.team_play_rating||0); s._ratN=(s._ratN||0)+1;
      }
    });
    lg.players.forEach(function(p){
      var s=lg.pstats[p.id]; if(!s) return;
      if (s._ratN){ s.ratOff=s._ratOff/s._ratN; s.ratDef=s._ratDef/s._ratN; s.ratTeam=s._ratTeam/s._ratN; }
    });
  }

  /* ---- power rankings from real results ----
     points% (60) + capped goal-diff/game (25) + last-5 form (15). Until games are
     played the engine's roster-strength order stands as the pre-season ranking. */
  if (results.length){
    var prOrder = function(exclFromWeek){
      var s = {};
      CG.TEAMS.forEach(function(t){
        var pts=0, gp=0, diff=0, seq=[];
        results.forEach(function(r){
          if (exclFromWeek && (r.week||1) >= exclFromWeek) return;
          if (r.home!==t.code && r.away!==t.code) return;
          var opp = r.home===t.code ? r.away : r.home; gp++;
          var d = r.score[t.code]-r.score[opp]; diff += d;
          if (d>0){ pts+=2; seq.push(1); } else if (r.ot){ pts+=1; seq.push(.5); } else seq.push(0);
        });
        var ptsPct = gp? pts/(gp*2) : 0, dpg = gp? diff/gp : 0;
        var l5 = seq.slice(-5), form = l5.length? l5.reduce(function(a,b){return a+b;},0)/l5.length : 0;
        s[t.code] = ptsPct*60 + (Math.max(-3,Math.min(3,dpg))/3)*25 + form*15;
      });
      return CG.TEAMS.map(function(t){ return t.code; }).sort(function(a,b){
        return s[b]-s[a] || lg.teams[b].pts-lg.teams[a].pts || lg.teams[b].diff-lg.teams[a].diff;
      });
    };
    var prMaxWk = results.reduce(function(m,r){ return Math.max(m, r.week||1); }, 1);
    var prNow = prOrder(null), prPrev = prOrder(prMaxWk);
    lg.powerRankings = prNow.map(function(code,i){
      var was = prPrev.indexOf(code)+1;
      return { rank:i+1, prev:was, team:code, move:was-(i+1) };
    });
  }

  /* ---- availability window from the REAL schedule (replaces the prototype's
     hardcoded "Week 8") — the next week with games; deadline Sunday 8 PM ET ---- */
  var futureG = schedule.filter(function(g){ return g.status!=="final" && g.at > CG.now()-6*3600000; })
    .sort(function(a,b){ return a.at-b.at; });
  if (futureG.length){
    var avWk = futureG[0].week || 1;
    var byNight = {};
    futureG.filter(function(g){ return (g.week||1)===avWk; }).forEach(function(g){
      var day = new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York"}).format(new Date(g.at));
      if (!byNight[day] || g.at < byNight[day]) byNight[day] = g.at;
    });
    var nights = Object.keys(byNight).sort().map(function(k){ return byNight[k]; }).slice(0,2);
    if (nights.length===1) nights.push(nights[0]+2*86400000);
    var dl = new Date(nights[0]);
    for (var di=0; di<8; di++){
      if (new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",weekday:"short"}).format(dl)==="Sun") break;
      dl = new Date(dl.getTime()-86400000);
    }
    var dlDay = new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York"}).format(dl);
    CG.WEEK8 = { key:"w"+avWk, label:"Week "+avWk,
      deadline: Date.parse(dlDay+"T20:00:00-04:00"),
      nights: [ { key:"n1", at:nights[0] }, { key:"n2", at:nights[1] } ] };
  }
  /* real data: no fabricated availability — unanswered means unanswered */
  CG.avFor = function(playerId){
    var saved = (CG.store.get("availability")||{})[CG.WEEK8.key+":"+playerId];
    if (saved) return saved;
    return { nights:{ n1:{ st:"nr" }, n2:{ st:"nr" } }, at:null };
  };

  /* stats-derived ratings are all-zero pre-season — use the real overalls */
  players.forEach(function(p){
    lg.ratings[p.id] = lg.ratings[p.id] || { parts:{} };
    lg.ratings[p.id].ovr = p.overall;
    lg.ratings[p.id].parts = lg.ratings[p.id].parts || {};
  });
  lg.teamRatings = lg.teamRatings || {};
  CG.TEAMS.forEach(function(t){
    var r = byTeam[t.code];
    var ovr = r.length ? Math.round(r.reduce(function(s,p){ return s+p.overall; },0)/r.length) : 70;
    lg.teamRatings[t.code] = lg.teamRatings[t.code] || {};
    lg.teamRatings[t.code].ovr = ovr;
  });

  /* tonight (none until the season starts), trades/archive come in later phases */
  lg.tonight = schedule.filter(function(g){ return g.status!=="final" && Math.abs(g.at-CG.now()) < 10*3600000; });
  lg.tonight.forEach(function(g){ g.feature=false; });
  lg.blockSeed = lg.blockSeed || [];
  lg.incoming = lg.incoming || [];
  lg.archive = {};
  lg.potw = lg.potw || [];
  lg.lastNight = lg.lastNight || [];

  /* real transaction log */
  lg.liveTransactions = transactions.map(function(tx){
    return { type:tx.type, text:tx.description||"", dateIso:(tx.occurred_at||"").slice(0,10) };
  });

  /* real newsroom — replace the prototype's simulated articles */
  if (CG.CONTENT){
    CG.CONTENT.articles = news.map(function(n){
      var paras = String(n.body||"").split(/\n\s*\n+/).map(function(s){ return s.trim(); }).filter(Boolean);
      if (!paras.length && n.body) paras = [String(n.body)];
      return {
        slug: n.id, title: n.title||"Untitled", category: n.category||"League News",
        excerpt: (paras[0]||"").slice(0,180), author: n.author||"CGHL Newsroom",
        dateIso: (n.published_at||n.created_at||"").slice(0,10) || "2026-01-01",
        featured: false, body: paras.length?paras:["—"], relatedTeams: [], tags: []
      };
    });
  }

  /* draft board + pool (parity with the live site). Maps stored on lg so the
     manager-only data can be re-mapped after auth via CG.mapDraftData. */
  lg._idToCode = {}; lg._codeToId = {}; teamsRaw.forEach(function(t){ lg._idToCode[t.id] = t.code; lg._codeToId[t.code] = t.id; });
  lg._profName = {}; profiles.forEach(function(pr){ lg._profName[pr.id] = pr.gamertag || pr.display_name || "player"; });
  lg._profilesRaw = profiles;
  lg._rosteredIds = {}; roster.forEach(function(rs){ lg._rosteredIds[rs.profile_id] = true; });
  CG.mapDraftData(lg, draftPicks, registrations);

  CG.LIVE.loaded = true;
  return lg;
};

/* ================================================================
   REAL AUTH — Discord OAuth via Supabase, replacing the demo-seat
   system. Role is derived from profiles.role + team management pointers.
   ================================================================ */
CG.auth = { user:null, profile:null, role:"guest" };
CG._guildTok = null;

/* user_role enum: {member, gm, commissioner, owner, agm, staff} -> prototype role keys */
CG.computeRole = function(profile){
  if (!profile) return "guest";
  if (profile.role === "commissioner") return "commish";
  /* manager if: their resolved roster entry has a mgmt role (teams pointers OR
     contracts.is_manager), their global role is a management role, or they're
     named on a team's owner/gm/agm pointer. */
  var player = CG.lg && CG.lg.players.find(function(p){ return p.id===profile.id; });
  var isMgr = (player && player.mgmt) ||
    ["owner","gm","agm"].indexOf(profile.role) >= 0 ||
    (CG.TEAMS||[]).some(function(t){ return profile.id===t.owner || profile.id===t.gm || profile.id===t.agm; });
  if (isMgr) return "mgmt";
  if (profile.role === "staff") return "staff";
  return "member";
};
CG.applySession = async function(session){
  CG.auth.user = session ? session.user : null;
  if (session && session.provider_token) CG.ensureInGuild(session.provider_token);
  if (CG.auth.user){
    try { var r = await CG.sb.from("profiles").select("*").eq("id", CG.auth.user.id).maybeSingle(); CG.auth.profile = r.data || null; }
    catch(e){ CG.auth.profile = null; }
    /* the user's registration for the open season (for the Register flow) */
    CG.auth.registration = null; CG.auth.ownerApp = null;
    if (CG.auth.user && CG.SEASON && CG.SEASON.id){
      try { var rg = await CG.sb.from("season_registrations").select("*").eq("season_id", CG.SEASON.id).eq("profile_id", CG.auth.user.id).maybeSingle(); CG.auth.registration = rg.data || null; }
      catch(e){ CG.auth.registration = null; }
    }
    try { var oa = await CG.sb.from("owner_applications").select("*").eq("profile_id", CG.auth.user.id).maybeSingle(); CG.auth.ownerApp = oa.data || null; }
    catch(e){ CG.auth.ownerApp = null; }
  } else { CG.auth.profile = null; CG.auth.registration = null; CG.auth.ownerApp = null; }
  CG.auth.role = CG.computeRole(CG.auth.profile);
  await CG.loadManagerData();
  /* direct messages: load + subscribe on sign-in, tear down on sign-out */
  if (CG.auth.user){ CG.loadDMs().then(function(){ CG.subscribeDMs(); if(CG.renderChrome)CG.renderChrome(); if(location.hash.indexOf("/messages")>=0&&CG.router)CG.router(); }); }
  else { CG.teardownDMs && CG.teardownDMs(); }
  CG.enforceBan();
};
CG.teardownDMs = function(){
  CG._dm.msgs=[]; CG._dm.profiles={}; CG._dm.active=null; CG._dm.loaded=false;
  if(CG._dm.channel){ try{ CG.sb.removeChannel(CG._dm.channel); }catch(e){} CG._dm.channel=null; }
};
/* re-map the draft board/pool with the same maps the adapter built */
CG.mapDraftData = function(lg, draftPicks, registrations){
  var idToCode = lg._idToCode||{}, profName = lg._profName||{}, rostered = lg._rosteredIds||{};
  lg.draftPicks = (draftPicks||[]).map(function(p){
    return { id:p.id, season:p.season_number, round:p.round, overall:p.overall_pick, skipped:!!p.skipped,
      ownerCode: idToCode[p.current_team_id]||null, origCode: idToCode[p.original_team_id]||null,
      playerId:p.player_id, playerName: p.player_id?(profName[p.player_id]||"a player"):null, used:!!p.used };
  });
  lg.draftPool = (registrations||[]).filter(function(r){ return !rostered[r.profile_id]; })
    .map(function(r){ return { profileId:r.profile_id, tag:(r.profiles&&r.profiles.gamertag)||"?", pos:r.position, ovr:(r.scout_ovr==null?null:r.scout_ovr), eaId:(r.profiles&&r.profiles.ea_id)||null }; })
    .sort(function(a,b){ return (b.ovr==null?-1:b.ovr)-(a.ovr==null?-1:a.ovr); });
  lg.registrationsCount = (registrations||[]).length;
};
/* manager-gated data (draft board + registrations) — loaded after auth for management */
CG.loadManagerData = async function(){
  if (!CG.sb || !CG.lg) return;
  var role = CG.auth.role;
  if (role!=="mgmt" && role!=="commish" && role!=="staff") return;
  try {
    var q = await Promise.all([
      CG.sb.from("draft_picks").select("id,season_number,round,original_team_id,current_team_id,player_id,used,overall_pick,skipped").order("season_number").order("round"),
      CG.sb.from("season_registrations").select("id,profile_id,position,scout_ovr,note, profiles(gamertag,ea_id,platform,jersey_number)"),
      CG.sb.from("draft_state").select("*")
    ]);
    var regs = (q[1]&&!q[1].error&&q[1].data)||[];
    CG.lg._registrationsRaw = regs;
    if ((q[0]&&!q[0].error) || (q[1]&&!q[1].error)){
      CG.mapDraftData(CG.lg, (q[0]&&!q[0].error&&q[0].data)||[], regs);
    }
    var states = (q[2]&&!q[2].error&&q[2].data)||[];
    /* current draft = the highest season_number that has picks */
    var maxSn = (CG.lg.draftPicks||[]).reduce(function(m,p){ return Math.max(m, p.season||0); }, 0);
    CG.lg.draftState = states.find(function(s){ return s.season_number===maxSn; }) || null;
    if (role==="commish"){
      var oa = await CG.sb.from("owner_applications").select("*, profiles(gamertag)").order("created_at",{ascending:false});
      CG.lg._ownerApps = (oa && !oa.error && oa.data) || [];
      /* server presets (app_config, commissioner-only read) */
      try {
        var pc = await CG.sb.from("app_config").select("value").eq("key","server_presets").maybeSingle();
        if (pc && !pc.error && pc.data && pc.data.value) CG.lg._presets = JSON.parse(pc.data.value);
      } catch(e){}
    }
    /* my club's live trades (incoming + outgoing, still open) */
    CG.lg._myTrades = [];
    var myCode = CG.myClub && CG.myClub(), myTid = (CG.lg._codeToId||{})[myCode];
    if (myTid){
      try {
        var tr = await CG.sb.from("trades").select("*").or("from_team_id.eq."+myTid+",to_team_id.eq."+myTid).eq("status","proposed").order("created_at",{ascending:false});
        CG.lg._myTrades = (tr && !tr.error && tr.data) || [];
      } catch(e){ CG.lg._myTrades = []; }
      /* server vetoes + resolved servers for my club's upcoming games, and my saved lineups */
      CG.lg._vetoes = {}; CG.lg._servers = {}; CG.lg._lineups = {};
      try {
        var upcoming = (CG.lg.schedule||[]).filter(function(g){ return (g.home===myCode||g.away===myCode) && g.status!=="final"; });
        var upIds = upcoming.map(function(g){ return g.id; });
        if (upIds.length){
          var vv = await CG.sb.from("game_vetoes").select("game_id,team_id,veto,preferred,pref1,pref2").in("game_id", upIds);
          (vv && !vv.error && vv.data || []).forEach(function(v){ if(v.team_id===myTid) CG.lg._vetoes[v.game_id]=v; });
          var lockedIds = upcoming.filter(function(g){ return CG.now() >= g.at - (CG.VETO_LOCK_MS||1800000); }).map(function(g){ return g.id; });
          await Promise.all(lockedIds.map(function(id){ return CG.sb.rpc("resolve_game_server",{p_game:id}).then(function(r){ if(r && !r.error && r.data) CG.lg._servers[id]=r.data; }).catch(function(){}); }));
        }
        if (CG.SEASON && CG.SEASON.id){
          var lu = await CG.sb.from("lineups").select("*").eq("season_id", CG.SEASON.id).eq("team_id", myTid);
          (lu && !lu.error && lu.data || []).forEach(function(row){ CG.lg._lineups[myCode+":"+row.night]=row; });
        }
      } catch(e){}
    }
  } catch(e){}
};
/* re-read the leagues/tiers table (after creating a tier) and recompute counts */
CG.loadLeagues = async function(){
  if (!CG.sb) return;
  try {
    var r = await CG.sb.from("leagues").select("*").order("sort_order");
    if (r.error || !r.data) return;
    CG.LEAGUES = r.data.map(function(l){ return { id:l.id, code:l.code, name:l.name, tier:l.tier,
      inspiration:l.inspiration||null, sort:(l.sort_order==null?0:l.sort_order), teamCount:0 }; });
    if (!CG.LEAGUES.length) return;
    CG.LEAGUE_BY_CODE={}; CG.LEAGUES.forEach(function(l){ CG.LEAGUE_BY_CODE[l.code]=l; });
    (CG.TEAMS||[]).forEach(function(t){ var l=CG.LEAGUE_BY_CODE[t.leagueCode]; if(l) l.teamCount++; });
    CG.TOP_LEAGUE = CG.LEAGUES.slice().sort(function(a,b){ return a.tier-b.tier||a.sort-b.sort; })[0];
  } catch(e){}
};

CG.initAuth = async function(){
  if (!CG.sb || !CG.sb.auth) return;
  try {
    var s = await CG.sb.auth.getSession();
    await CG.applySession(s && s.data ? s.data.session : null);
    CG.sb.auth.onAuthStateChange(function(_e, sess){
      CG.applySession(sess).then(function(){ if (CG.renderChrome) CG.renderChrome(); if (CG.router) CG.router(); });
    });
  } catch(e){ console.warn("auth init failed", e); }
};

/* --- live overrides of the demo persona system (defined in part4) --- */
CG.role = function(){ return (CG.auth && CG.auth.role) || "guest"; };
CG.persona = function(){
  var role = CG.role(), p = CG.auth.profile;
  var label = (CG.PERSONAS[role]||{}).label || (role.charAt(0).toUpperCase()+role.slice(1));
  var o = { key:role, label:label };
  if (p){
    o.tag = p.gamertag || p.display_name || "Member";
    o.avatar = p.avatar_url || null;
    o.who = o.tag + (role==="commish"?" · Commissioner":role==="mgmt"?" · Team management":role==="staff"?" · League staff":role==="member"?" · Member":"");
  } else { o.who = "Signed out"; }
  return o;
};
CG.me = function(){
  var p = CG.auth.profile; if (!p || !CG.lg) return null;
  return CG.lg.players.find(function(x){ return x.id===p.id; }) || null;
};
CG.avatarHtml = function(){
  var p = CG.auth.profile;
  if (p && p.avatar_url) return '<img src="'+p.avatar_url+'" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block">';
  var tag = (p && (p.gamertag||p.display_name)) || "G";
  return esc(String(tag).slice(0,2).toUpperCase());
};
CG.setRole = function(){ /* no-op in live — role comes from the real session */ };

CG.signIn = function(){
  if (!CG.sb || !CG.sb.auth) return;
  /* match the current site's redirect exactly (origin only) so it stays within
     Supabase's existing Discord redirect allowlist */
  CG.sb.auth.signInWithOAuth({ provider:"discord", options:{ redirectTo: window.location.origin, scopes:"identify email guilds.join" } });
};
CG.signOut = async function(){ if (CG.sb && CG.sb.auth){ try { await CG.sb.auth.signOut(); } catch(e){} } location.hash = "#/home"; };
/* login doubles as a Discord server invite (provider_token present only on fresh OAuth) */
CG.ensureInGuild = function(token){
  if (!token || CG._guildTok===token) return; CG._guildTok = token;
  try {
    fetch("/api/discord-join", { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ access_token: token }) })
      .then(function(r){ return r.json().catch(function(){ return {}; }); })
      .then(function(j){ if (j && j.inGuild && CG.auth.profile) CG.auth.profile.in_guild = true; })
      .catch(function(){});
  } catch(e){}
};
CG.enforceBan = function(){
  var banned = CG.auth.profile && CG.auth.profile.banned;
  var ov = document.getElementById("banScreen");
  if (banned){
    if (!ov){ ov = document.createElement("div"); ov.id = "banScreen";
      ov.style.cssText = "position:fixed;inset:0;z-index:9999;background:rgba(10,12,14,.97);display:flex;align-items:center;justify-content:center;padding:24px"; document.body.appendChild(ov); }
    ov.innerHTML = '<div style="max-width:440px;text-align:center;color:#fff">'+
      '<div style="font-size:40px">⛔</div><h2 style="font-family:var(--f-disp);margin:10px 0">Your access has been revoked</h2>'+
      '<p style="color:var(--on-ink-dim)">'+(CG.auth.profile.ban_reason?esc(CG.auth.profile.ban_reason):"Contact the league office.")+'</p>'+
      '<button class="btn btn-ghost" style="margin-top:16px" onclick="CG.signOut()">Sign out</button></div>';
    ov.style.display = "flex"; document.body.style.overflow = "hidden";
  } else if (ov){ ov.style.display = "none"; document.body.style.overflow = ""; }
};

/* --- real sign-in page (replaces the demo seat picker) --- */
CG.ROUTES.signin = function(){
  if (CG.auth && CG.auth.profile){
    var p = CG.auth.profile;
    return '<section class="sec"><div class="shell" style="max-width:620px;text-align:center">'+
      '<span class="eyebrow chr">Account</span><h1 class="h-page" style="margin-top:10px">You’re signed in</h1>'+
      '<p class="lede" style="margin:12px auto 22px">Signed in as <b>'+esc(p.gamertag||p.display_name||"member")+'</b>'+(p.role?' · '+esc(p.role):'')+'.</p>'+
      '<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">'+
        '<a class="btn btn-chrome" href="#/hub">'+(CG.role()==="commish"?"Control Center":"My dashboard")+'</a>'+
        '<button class="btn btn-ghost" onclick="CG.signOut()">Sign out</button></div></div></section>';
  }
  return '<section class="sec"><div class="shell" style="max-width:640px;text-align:center">'+
    '<span class="eyebrow chr">One account for everything</span>'+
    '<h1 class="h-page" style="margin-top:10px">Sign in with Discord</h1>'+
    '<p class="lede" style="margin:12px auto 22px">Your Discord account is your league account. Not in the Chel Gaming server yet? Signing in adds you automatically and signs you into the site in one step.</p>'+
    '<button class="btn btn-lg" id="dcSignIn" style="background:#5865F2;color:#fff">'+CG.DISCORD_GLYPH+'Sign in with Discord</button>'+
    '<p class="caption" style="margin-top:12px">Scopes requested: identify · email · guilds.join.</p></div></section>';
};
CG.AFTER.signin = function(){ var b = document.getElementById("dcSignIn"); if (b) b.addEventListener("click", function(){ CG.signIn(); }); };

/* ================================================================
   PARITY: SEASON REGISTRATION (season_registrations)
   ================================================================ */
CG.ROUTES.register = function(){
  var s = CG.SEASON || {}, open = !!s.registration_open;
  var head = CG.pageHead(open ? "Season "+(s.number||1)+" · registration open" : "Registration",
    "Register for the season", "One form puts you in the player pool. The commissioner assigns roster spots from there.");
  if (!CG.auth.profile){
    return head + '<div class="shell" style="max-width:620px;padding-bottom:48px"><div class="card"><div class="empty" style="padding:60px 20px">'+
      '<div class="e-art">'+CG.ic("user",22)+'</div><b>Sign in to register</b>'+
      '<p>Your Discord account is your league account — signing in also adds you to the Chel Gaming Discord.</p>'+
      '<button class="btn btn-lg" id="dcSignIn" style="margin-top:18px;background:#5865F2;color:#fff">'+CG.DISCORD_GLYPH+'Sign in with Discord</button></div></div></div>';
  }
  if (!open){
    return head + '<div class="shell" style="max-width:620px;padding-bottom:48px"><div class="card"><div class="empty" style="padding:60px 20px">'+
      '<div class="e-art">'+CG.ic("clock",22)+'</div><b>Registration isn’t open right now</b>'+
      '<p>'+(s.status==="active"?"Season "+s.number+" is already underway.":"Registration for the next season hasn’t opened yet — watch the announcements channel.")+'</p>'+
      '<a class="btn btn-ghost" style="margin-top:16px" href="#/schedule">View the schedule</a></div></div></div>';
  }
  var p = CG.auth.profile, reg = CG.auth.registration, eaMissing = !p.ea_id;
  var statusCard = reg ? '<div class="note grn" style="margin-bottom:18px"><b style="font-family:var(--f-disp)">You’re registered for Season '+(s.number||1)+'.</b> Position on file: <b>'+esc(CG.POS_NAME[reg.position]||reg.position||"—")+'</b>. The commissioner assigns roster spots — you’ll be notified. Update your details below any time before the deadline.</div>' : "";
  var body = '<div class="card"><div class="card-h"><h3>'+(reg?"Update registration":"Register")+'</h3><span class="chip '+(reg?"chip-win":"chip-chrome")+'">'+(reg?"Registered":"Open")+'</span></div><div class="card-b">'+
    (eaMissing ? '<div class="note red" style="margin-bottom:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">'+CG.ic("flag",15)+'<span style="flex:1">You need your <b>EA ID</b> on file to register.</span><button class="btn btn-ghost btn-sm" id="regEaBtn">Add EA ID</button></div>'
                : '<label class="fld"><span>EA ID (on file)</span><input value="'+esc(p.ea_id)+'" disabled style="opacity:.7"></label>')+
    '<label class="fld"><span>Primary position</span></label><div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">'+
      ["C","LW","RW","LD","RD","G"].map(function(pos){ var on=(reg?reg.position:"C")===pos; return '<button type="button" class="chip '+(on?"chip-chrome":"")+'" data-regpos="'+pos+'" style="cursor:pointer;padding:8px 14px">'+CG.POS_NAME[pos]+'</button>'; }).join("")+'</div>'+
    '<label class="fld"><span>Note to the league office (optional)</span><textarea id="regNote" rows="3" placeholder="Availability, preferred club, anything the commissioner should know…">'+esc((reg&&reg.note)||"")+'</textarea></label>'+
    '<button class="btn btn-chrome" id="regSubmit"'+(eaMissing?" disabled":"")+'>'+(reg?"Update registration":"Submit registration")+'</button>'+
    '<p class="caption" style="margin-top:10px">You must be in the Chel Gaming Discord to register — signing in adds you automatically.</p>'+
  '</div></div>';
  return head + '<div class="shell" style="max-width:640px;padding-bottom:48px">'+statusCard+body+'</div>';
};
CG.AFTER.register = function(){
  var dc=document.getElementById("dcSignIn"); if(dc) dc.addEventListener("click", function(){ CG.signIn(); });
  var sel = (CG.auth.registration && CG.auth.registration.position) || "C";
  document.querySelectorAll("[data-regpos]").forEach(function(el){ el.addEventListener("click", function(){ sel=this.getAttribute("data-regpos"); document.querySelectorAll("[data-regpos]").forEach(function(x){ x.classList.toggle("chip-chrome", x===el); }); }); });
  var ea=document.getElementById("regEaBtn"); if(ea) ea.addEventListener("click", CG.promptEaId);
  var sub=document.getElementById("regSubmit"); if(sub) sub.addEventListener("click", function(){ CG.registerForSeason(sel, (document.getElementById("regNote")||{}).value||""); });
};
CG.promptEaId = function(){
  CG.modal("Add your EA ID",
    '<label class="fld"><span>EA ID / gamertag used in-game</span><input id="eaInput" placeholder="e.g. YourEAName" value="'+esc((CG.auth.profile||{}).ea_id||"")+'"></label><p class="caption">Shown to league staff for lobby verification; hidden from the public directory unless you opt in.</p>',
    '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-ink" id="eaSave">Save EA ID</button>');
  document.getElementById("eaSave").addEventListener("click", function(){
    var v=(document.getElementById("eaInput").value||"").trim();
    if(v.length<2){ CG.toast("Enter your EA ID","err"); return; }
    CG.saveEaId(v);
  });
};
CG.saveEaId = async function(v){
  if(!CG.sb||!CG.auth.user) return;
  var r = await CG.sb.from("profiles").update({ ea_id:v }).eq("id", CG.auth.user.id);
  if(r.error){ CG.toast("Couldn’t save EA ID: "+r.error.message,"err"); return; }
  CG.auth.profile.ea_id=v; if(CG.closeOverlay) CG.closeOverlay(); CG.toast("EA ID saved","ok"); CG.router();
};
CG.registerForSeason = async function(position, note){
  if(!CG.sb||!CG.auth.user){ CG.toast("Sign in first","err"); return; }
  var s=CG.SEASON; if(!s||!s.registration_open){ CG.toast("Registration isn’t open","err"); return; }
  if(!CG.auth.profile.ea_id){ CG.toast("Add your EA ID first","err"); CG.promptEaId(); return; }
  if(!CG.auth.profile.in_guild){
    try { var fr=await CG.sb.from("profiles").select("in_guild").eq("id",CG.auth.user.id).maybeSingle(); if(fr.data&&fr.data.in_guild) CG.auth.profile.in_guild=true; } catch(e){}
    if(!CG.auth.profile.in_guild){ CG.toast("Join the Chel Gaming Discord to register","err"); return; }
  }
  var payload={ season_id:s.id, profile_id:CG.auth.user.id, position:position||"C", note:(note||"").trim()||null };
  var r=await CG.sb.from("season_registrations").upsert(payload,{onConflict:"season_id,profile_id"});
  if(r.error){ CG.toast("Couldn’t register: "+r.error.message,"err"); return; }
  CG.auth.registration=payload;
  CG.toast("You’re registered for Season "+(s.number||1)+"!","ok"); CG.router();
};

/* ================================================================
   PARITY: OWNER APPLICATIONS (owner_applications)
   ================================================================ */
CG.ROUTES.owner = function(){
  var head = CG.pageHead("Run a club","Apply to own a team",
    "Owners set their club’s identity, hire a GM, and build the roster. Applications are tied to your Discord so the commissioners know who applied.");
  if (!CG.auth.profile){
    return head + '<div class="shell" style="max-width:640px;padding-bottom:48px"><div class="card"><div class="empty" style="padding:60px 20px">'+
      '<div class="e-art">'+CG.ic("shield",22)+'</div><b>Sign in to apply</b>'+
      '<p>Owner applications are tied to your Discord account so the commissioners know who applied.</p>'+
      '<button class="btn btn-lg" id="dcSignIn" style="margin-top:18px;background:#5865F2;color:#fff">'+CG.DISCORD_GLYPH+'Sign in with Discord</button></div></div></div>';
  }
  var p = CG.auth.profile, a = CG.auth.ownerApp||{};
  var statusCard = CG.auth.ownerApp ? '<div class="note '+(a.status==="approved"?"grn":a.status==="denied"?"red":"chr")+'" style="margin-bottom:18px"><b style="font-family:var(--f-disp)">Your application is '+esc((a.status||"pending").toUpperCase())+'.</b> Resubmit below to update it — the commissioners review every application.</div>' : "";
  var clubOpts = '<option value="">No preference</option>'+CG.TEAMS.map(function(t){ return '<option value="'+t.code+'"'+(a.preferred_club===t.code?" selected":"")+'>'+esc(t.name)+'</option>'; }).join("");
  var build = a.team_choice==="build";
  var body = '<div class="card"><div class="card-h"><h3>'+(CG.auth.ownerApp?"Update application":"Owner application")+'</h3><span class="chip chip-chrome">Season</span></div><div class="card-b">'+
    '<div class="grid g2"><label class="fld"><span>EA ID *</span><input id="ow-ea" placeholder="Your EA account name" value="'+esc(a.ea_id||p.ea_id||"")+'"></label>'+
      '<label class="fld"><span>Time zone</span><input id="ow-tz" placeholder="e.g. Eastern" value="'+esc(a.timezone||"")+'"></label></div>'+
    '<label class="fld"><span>Typical availability</span><input id="ow-avail" placeholder="e.g. Weeknights after 9 PM ET" value="'+esc(a.availability||"")+'"></label>'+
    '<label class="fld"><span>League / management experience</span><textarea id="ow-exp" rows="2" placeholder="Leagues you’ve played or managed in…">'+esc(a.experience||"")+'</textarea></label>'+
    '<label class="fld"><span>Club preference</span><select id="ow-choice"><option value="assigned"'+(!build?" selected":"")+'>Take an existing / assigned club</option><option value="build"'+(build?" selected":"")+'>Propose a brand-new club</option></select></label>'+
    '<div id="ow-assignedwrap" style="'+(build?"display:none":"")+'"><label class="fld"><span>Preferred club</span><select id="ow-club">'+clubOpts+'</select></label></div>'+
    '<div id="ow-buildwrap" class="grid g2" style="'+(build?"":"display:none")+'"><label class="fld"><span>Proposed team name</span><input id="ow-name" placeholder="e.g. Harbor Kraken" value="'+esc(a.proposed_name||"")+'"></label>'+
      '<label class="fld"><span>Proposed city / location</span><input id="ow-loc" placeholder="e.g. Nord Harbor" value="'+esc(a.proposed_location||"")+'"></label></div>'+
    '<label class="fld"><span>Why you? (pitch) *</span><textarea id="ow-pitch" rows="4" placeholder="Tell the commissioners why you’d make a great owner…">'+esc(a.pitch||"")+'</textarea></label>'+
    '<button class="btn btn-chrome" id="ow-submit">'+(CG.auth.ownerApp?"Update application":"Submit application")+'</button>'+
  '</div></div>';
  return head + '<div class="shell" style="max-width:720px;padding-bottom:48px">'+statusCard+body+'</div>';
};
CG.AFTER.owner = function(){
  var dc=document.getElementById("dcSignIn"); if(dc) dc.addEventListener("click", function(){ CG.signIn(); });
  var ch=document.getElementById("ow-choice");
  if(ch) ch.addEventListener("change", function(){
    var build=this.value==="build";
    var aw=document.getElementById("ow-assignedwrap"), bw=document.getElementById("ow-buildwrap");
    if(aw) aw.style.display=build?"none":""; if(bw) bw.style.display=build?"":"none";
  });
  var sub=document.getElementById("ow-submit"); if(sub) sub.addEventListener("click", CG.submitOwnerApp);
};
CG.submitOwnerApp = async function(){
  if(!CG.sb||!CG.auth.user){ CG.toast("Sign in first","err"); return; }
  function v(id){ var el=document.getElementById(id); return el?(el.value||"").trim():""; }
  var ea=v("ow-ea"), pitch=v("ow-pitch"), choice=(document.getElementById("ow-choice")||{}).value||"assigned";
  if(!ea){ CG.toast("EA ID is required","err"); return; }
  if(!pitch){ CG.toast("Add a short pitch","err"); return; }
  var propName = choice==="build" ? (v("ow-name")||null) : null;
  if(choice==="build" && !propName){ CG.toast("Name your proposed team (or pick an assigned club)","err"); return; }
  var payload={ season_id: CG.SEASON?CG.SEASON.id:null, profile_id: CG.auth.user.id, ea_id:ea,
    timezone:v("ow-tz")||null, availability:v("ow-avail")||null, experience:v("ow-exp")||null,
    team_choice:choice, preferred_club: choice==="build"?null:((document.getElementById("ow-club")||{}).value||null),
    proposed_name:propName, proposed_location: choice==="build"?(v("ow-loc")||null):null,
    pitch:pitch, status:"pending", updated_at:new Date().toISOString() };
  var r=await CG.sb.from("owner_applications").upsert(payload,{onConflict:"profile_id"});
  if(r.error){ CG.toast("Couldn’t submit: "+r.error.message,"err"); return; }
  CG.auth.ownerApp=payload; CG.toast("Application submitted — the commissioners will review it","ok"); CG.router();
};

/* ================================================================
   PARITY: DRAFT ROOM (draft_picks + season_registrations pool)
   Management/commish watch view; the commissioner runs picks from
   the Control Center via the use_draft_pick RPC.
   ================================================================ */
CG.ROUTES.draft = function(){
  var lg = CG.lg, role = CG.role();
  var head = CG.pageHead("The draft room","Draft board","Clubs draft their own picks on the clock; the commissioner runs the room — pause, skip, or reverse. The board updates live for everyone.");
  if (role!=="mgmt" && role!=="commish" && role!=="staff"){
    return head + '<div class="shell" style="max-width:640px;padding-bottom:48px"><div class="card"><div class="empty" style="padding:60px 20px">'+
      '<div class="e-art">'+CG.ic("lock",22)+'</div><b>Managers only</b><p>The draft board and prospect pool are visible to club management and the league office.</p></div></div></div>';
  }
  var picks = lg.draftPicks||[];
  if (!picks.length){
    return head + '<div class="shell" style="max-width:640px;padding-bottom:48px"><div class="card"><div class="empty" style="padding:60px 20px">'+
      '<div class="e-art">'+CG.ic("users",22)+'</div><b>No draft has been set up yet</b><p>When the commissioner builds the board, the picks, prospect pool, and live results appear here.</p></div></div></div>';
  }
  var maxSn = Math.max.apply(null, picks.map(function(p){ return p.season; }));
  var cur = picks.filter(function(p){ return p.season===maxSn; }).sort(function(a,b){ return (a.overall||9999)-(b.overall||9999); });
  var total = cur.length, made = cur.filter(function(p){ return p.used; }).length, skips = cur.filter(function(p){ return p.skipped; }).length;
  var st = lg.draftState, dstatus = st ? st.status : "setup";
  var myClub = CG.myClub && CG.myClub();
  var isMgr = role==="mgmt", isComm = role==="commish";
  var mine = cur.filter(function(p){ return p.ownerCode===myClub; });
  var myOpen = mine.filter(function(p){ return !p.used && !p.skipped; });
  var pool = lg.draftPool||[];
  var onClock = (st && (dstatus==="live"||dstatus==="paused")) ? cur.find(function(p){ return p.overall===st.current_overall; }) : null;
  var onClockCode = onClock ? onClock.ownerCode : null;
  var myTurn = isMgr && onClock && onClockCode===myClub && !onClock.used && !onClock.skipped && dstatus==="live";

  var clockBox = "";
  if (dstatus==="live" || dstatus==="paused"){
    var statusChip = dstatus==="live" ? '<span class="chip chip-live"><span class="live-dot"></span>LIVE</span>' : '<span class="chip chip-warn">PAUSED</span>';
    clockBox = '<div class="card" style="margin-bottom:18px"><div class="card-b" style="display:flex;gap:18px;align-items:center;flex-wrap:wrap">'+
      statusChip+
      '<div style="display:flex;gap:9px;align-items:center;flex-wrap:wrap"><span class="caption">On the clock</span>'+
        (onClock?CG.crest(onClockCode,24)+'<b style="font-family:var(--f-disp);font-size:16px">'+esc((CG.TEAM[onClockCode]||{}).name||onClockCode)+'</b>':'<span>—</span>')+
        '<span class="chip">Pick '+st.current_overall+' / '+total+(onClock?' · R'+onClock.round:'')+'</span></div>'+
      '<div id="draftClock" data-status="'+dstatus+'" data-ends="'+esc(st.clock_ends_at||"")+'" data-remaining="'+(st.paused_remaining==null?"":st.paused_remaining)+'" data-season="'+maxSn+'" style="margin-left:auto;font-family:var(--f-mono);font-size:26px;font-weight:800">--:--</div>'+
      (isComm?'<div style="display:flex;gap:8px;flex-wrap:wrap">'+
        (dstatus==="live"?'<button class="btn btn-ghost btn-sm" data-draft-pause>Pause</button>':'<button class="btn btn-chrome btn-sm" data-draft-resume>Resume</button>')+
        '<button class="btn btn-ghost btn-sm" data-draft-skip>Skip pick</button></div>':"")+
      '</div>'+
      (myTurn?'<div class="card-b" style="border-top:1px solid var(--line);background:var(--chrome-tint)"><div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap"><b style="font-family:var(--f-disp);font-size:15px">Your club is on the clock — make your pick.</b><button class="btn btn-chrome" data-makepick="'+onClock.id+'">'+CG.ic("plus",14)+'Draft a player</button></div></div>':"")+
      '</div>';
  } else if (dstatus==="complete"){
    clockBox = '<div class="note grn" style="margin-bottom:18px"><b style="font-family:var(--f-disp)">The Season '+maxSn+' draft is complete.</b> Every pick is in — the results are below.</div>';
  } else if (isComm){
    clockBox = '<div class="card" style="margin-bottom:18px"><div class="card-h"><h3>Start the draft</h3><span class="chip">Season '+maxSn+' · '+total+' picks</span></div><div class="card-b" style="display:flex;gap:14px;align-items:flex-end;flex-wrap:wrap">'+
      '<label class="fld" style="max-width:170px;margin-bottom:0"><span>Seconds per pick</span><input type="number" id="draftSecs" value="120" min="15" max="600"></label>'+
      '<button class="btn btn-chrome" data-draft-start>'+CG.ic("play",14)+'Start live draft</button>'+
      '<span class="caption" style="flex:1;min-width:200px">Assigns the snake order and puts the first club on the clock. Clubs draft their own picks; you run the clock and can pause, skip, or reverse.</span></div></div>';
  } else {
    clockBox = '<div class="note chr" style="margin-bottom:18px">The draft hasn’t started yet. When the commissioner opens it, your club’s picks go on the clock right here.</div>';
  }

  var summary = '<div class="grid g3" style="margin-bottom:20px">'+
    '<div class="kpi" style="cursor:default"><b class="num" style="font-size:22px">'+made+' / '+total+'</b><span>picks made'+(skips?' · '+skips+' skipped':'')+'</span></div>'+
    '<div class="kpi" style="cursor:default"><b class="num" style="font-size:22px">'+pool.length+'</b><span>prospects available</span></div>'+
    '<div class="kpi" style="cursor:default"><b class="num" style="font-size:22px'+(isMgr&&myOpen.length?';color:var(--chrome-deep)':'')+'">'+(isMgr?myOpen.length:(total-made-skips))+'</b><span>'+(isMgr?"your picks left":"picks remaining")+'</span></div></div>';

  var showAdmin = isComm && dstatus!=="setup";
  var board = '<div class="card"><div class="card-h"><h3>Season '+maxSn+' board</h3><span class="chip">'+made+' / '+total+'</span></div>'+
    '<div class="tblwrap"><table class="tbl keepcols"><caption>Draft board</caption><thead><tr><th>Pick</th><th>Rd</th><th class="tleft">Club</th><th class="tleft">Result</th>'+(showAdmin?'<th class="tright">Admin</th>':'')+'</tr></thead><tbody>'+
    cur.map(function(p){
      var isCurrent = st && p.overall===st.current_overall && (dstatus==="live"||dstatus==="paused") && !p.used && !p.skipped;
      var isMine = p.ownerCode===myClub;
      var result = p.used ? '<span class="chip chip-win">'+esc(p.playerName||"Drafted")+'</span>'
        : p.skipped ? '<span class="chip chip-loss">Skipped</span>'
        : isCurrent ? '<span class="chip chip-live"><span class="live-dot"></span>On the clock</span>'
        : '<span class="caption">On the board</span>';
      return '<tr'+(isCurrent?' style="background:var(--chrome-tint)"':(isMine?' style="background:var(--ice)"':""))+'>'+
        '<td class="tnum">'+(p.overall||"—")+'</td><td class="tnum">R'+p.round+'</td>'+
        '<td class="tleft"><span class="teamcell">'+(p.ownerCode?CG.crest(p.ownerCode,18):"")+'<span class="mono" style="font-size:11px">'+esc(p.ownerCode||"—")+'</span></span></td>'+
        '<td class="tleft">'+result+'</td>'+
        (showAdmin?'<td class="tright">'+(p.used?'<button class="btn btn-ghost btn-sm" data-reversepick="'+p.id+'">Reverse</button>':'<span class="caption">—</span>')+'</td>':'')+'</tr>';
    }).join("")+'</tbody></table></div></div>';

  var poolCard = '<div class="card"><div class="card-h"><h3>Prospect pool</h3><span class="chip">'+pool.length+' available</span></div>'+
    (pool.length ? '<div class="card-b" style="padding-top:8px"><p class="caption" style="margin-bottom:10px">Registered players not yet on a roster, ranked by the commissioner’s scouted overall.</p>'+
      pool.slice(0,40).map(function(pr,i){
        return '<div class="leaderrow" style="cursor:default"><span class="rk num">'+(i+1)+'</span>'+
          '<span style="min-width:0"><b style="font-size:13.5px">'+esc(pr.tag)+'</b><small style="display:block" class="caption">'+(CG.POS_NAME[pr.pos]||pr.pos)+(pr.eaId?" · EA: "+esc(pr.eaId):"")+'</small></span>'+
          '<span class="val"><b class="num">'+(pr.ovr!=null?pr.ovr:"—")+'</b><span>'+(pr.ovr!=null?"OVR":"unrated")+'</span></span></div>';
      }).join("")+'</div>'
      : '<div class="card-b"><p class="caption">No prospects available yet — the pool fills from season registrations that haven’t been assigned to a club.</p></div>')+'</div>';

  return head + '<div class="shell" style="padding-bottom:48px">'+clockBox+summary+
    '<div class="grid g23" style="align-items:start">'+board+poolCard+'</div></div>';
};
CG._draftSeason = function(){ return (CG.lg.draftPicks||[]).reduce(function(m,p){ return Math.max(m, p.season||0); }, 0); };
CG.refreshDraft = function(){ if(!CG.sb) return; CG.loadManagerData().then(function(){ if(location.hash.indexOf("/draft")>=0 && CG.router) CG.router(); }); };
CG.draftStart = function(){
  var el=document.getElementById("draftSecs"), secs=el?(parseInt(el.value,10)||120):120, sn=CG._draftSeason();
  CG.confirm("Start the live draft?","This assigns the snake order and puts the first club on the clock. Clubs draft their own picks; you run the clock.","Start draft", function(){
    CG.sb.rpc("start_draft",{ p_season_number:sn, p_pick_seconds:secs }).then(function(r){
      if(r.error) CG.toast("Couldn’t start: "+r.error.message,"err"); else { CG.toast("The draft is live","ok"); CG.refreshDraft(); }
    });
  });
};
CG.draftMakePick = function(pickId){
  var pool=CG.lg.draftPool||[];
  if(!pool.length){ CG.toast("No prospects available to draft","err"); return; }
  var opts=pool.map(function(pr){ return '<option value="'+pr.profileId+'">'+esc(pr.tag)+' · '+(CG.POS_NAME[pr.pos]||pr.pos)+(pr.ovr!=null?" · "+pr.ovr+" OVR":"")+'</option>'; }).join("");
  CG.modal("Make your pick",'<label class="fld"><span>Draft a prospect — best available first</span><select id="dpPlayer" size="8" style="height:auto">'+opts+'</select></label>',
    '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-chrome" id="dpGo">Draft player</button>');
  document.getElementById("dpGo").addEventListener("click", function(){
    var pid=(document.getElementById("dpPlayer")||{}).value; if(!pid){ CG.toast("Pick a player first","err"); return; }
    CG.sb.rpc("draft_make_pick",{ p_pick:pickId, p_player:pid }).then(function(r){
      if(r.error){ CG.toast("Couldn’t pick: "+r.error.message,"err"); return; }
      if(CG.closeOverlay) CG.closeOverlay(); CG.toast("Your pick is in!","ok"); CG.refreshDraft();
    });
  });
};
CG.draftReverse = function(pickId){
  CG.confirm("Reverse this pick?","The player returns to the pool and the club goes back on the clock.","Reverse pick", function(){
    CG.sb.rpc("draft_reverse_pick",{ p_pick:pickId }).then(function(r){ if(r.error) CG.toast("Couldn’t reverse: "+r.error.message,"err"); else { CG.toast("Pick reversed","ok"); CG.refreshDraft(); } });
  });
};
CG.draftSkip = function(){
  var sn=CG._draftSeason();
  CG.confirm("Skip the pick on the clock?","The club is passed and the draft advances to the next pick.","Skip pick", function(){
    CG.sb.rpc("draft_skip_pick",{ p_season_number:sn }).then(function(r){ if(r.error) CG.toast("Couldn’t skip: "+r.error.message,"err"); else { CG.toast("Pick skipped","ok"); CG.refreshDraft(); } });
  });
};
CG.draftPauseResume = function(pause){
  var sn=CG._draftSeason();
  CG.sb.rpc(pause?"draft_pause":"draft_resume",{ p_season_number:sn }).then(function(r){ if(r.error) CG.toast("Couldn’t "+(pause?"pause":"resume")+": "+r.error.message,"err"); else { CG.toast(pause?"Draft paused":"Draft resumed","ok"); CG.refreshDraft(); } });
};
CG._draftClockTimer=null; CG._draftAdvancing=false;
CG.startDraftClock = function(){
  if(CG._draftClockTimer){ clearInterval(CG._draftClockTimer); CG._draftClockTimer=null; }
  var el0=document.getElementById("draftClock"); if(!el0) return;
  var status=el0.getAttribute("data-status"), ends=el0.getAttribute("data-ends"), remaining=el0.getAttribute("data-remaining"), sn=parseInt(el0.getAttribute("data-season"),10);
  function fmt(s){ s=Math.max(0,Math.floor(s)); return Math.floor(s/60)+":"+("0"+(s%60)).slice(-2); }
  function tick(){
    var el=document.getElementById("draftClock"); if(!el){ clearInterval(CG._draftClockTimer); CG._draftClockTimer=null; return; }
    if(status==="paused"){ el.textContent = remaining!==""? fmt(parseInt(remaining,10)) : "--:--"; el.style.color="var(--steel)"; return; }
    var left=(Date.parse(ends)-Date.now())/1000;
    if(left<=0){ el.textContent="0:00"; el.style.color="var(--red)";
      if(!CG._draftAdvancing){ CG._draftAdvancing=true; CG.sb.rpc("draft_auto_advance",{ p_season_number:sn }).then(function(){ setTimeout(function(){ CG._draftAdvancing=false; },1500); }).catch(function(){ CG._draftAdvancing=false; }); }
    } else { el.textContent=fmt(left); el.style.color = left<15?"var(--red)":""; }
  }
  tick(); CG._draftClockTimer=setInterval(tick,1000);
};
CG._draftChannel=null;
CG.subscribeDraft = function(){
  if(CG._draftChannel || !CG.sb) return;
  CG._draftChannel = CG.sb.channel("draft-live")
    .on("postgres_changes",{ event:"*", schema:"public", table:"draft_state" }, function(){ CG.refreshDraft(); })
    .on("postgres_changes",{ event:"*", schema:"public", table:"draft_picks" }, function(){ CG.refreshDraft(); })
    .subscribe();
};
CG.AFTER.draft = function(){
  document.querySelectorAll("[data-makepick]").forEach(function(b){ b.addEventListener("click", function(){ CG.draftMakePick(this.getAttribute("data-makepick")); }); });
  document.querySelectorAll("[data-reversepick]").forEach(function(b){ b.addEventListener("click", function(){ CG.draftReverse(this.getAttribute("data-reversepick")); }); });
  var s=document.querySelector("[data-draft-start]"); if(s) s.addEventListener("click", CG.draftStart);
  var p=document.querySelector("[data-draft-pause]"); if(p) p.addEventListener("click", function(){ CG.draftPauseResume(true); });
  var r=document.querySelector("[data-draft-resume]"); if(r) r.addEventListener("click", function(){ CG.draftPauseResume(false); });
  var k=document.querySelector("[data-draft-skip]"); if(k) k.addEventListener("click", CG.draftSkip);
  CG.startDraftClock();
  CG.subscribeDraft();
};

/* ================================================================
   PARITY: DIRECT MESSAGES (direct_messages + realtime + mark_dm_read)
   ================================================================ */
CG._dm = { msgs:[], profiles:{}, active:null, loaded:false, channel:null, filter:"" };
CG._DM_SEL = "id,gamertag,display_name,avatar_url,discord_username";
CG.dmUid = function(){ return CG.auth.user ? CG.auth.user.id : null; };
CG.dmOtherId = function(m){ var me=CG.dmUid(); return m.sender_id===me ? m.recipient_id : m.sender_id; };
CG.dmName = function(id){ var p=CG._dm.profiles[id]; return p ? (p.gamertag||p.display_name||"Member") : "Member"; };
CG.dmAva = function(id){ var p=CG._dm.profiles[id];
  if (p&&p.avatar_url) return '<img src="'+p.avatar_url+'" alt="" style="width:38px;height:38px;border-radius:50%;object-fit:cover;flex-shrink:0">';
  return '<span class="avatar" style="width:38px;height:38px;flex-shrink:0">'+esc(String(CG.dmName(id)).slice(0,2).toUpperCase())+'</span>';
};
CG.dmUnreadTotal = function(){ var me=CG.dmUid(); return CG._dm.msgs.filter(function(m){ return m.recipient_id===me && !m.read_at; }).length; };
CG.loadDMs = async function(){
  if (!CG.sb || !CG.dmUid()) return;
  var me=CG.dmUid();
  try {
    var r = await CG.sb.from("direct_messages").select("*").or("sender_id.eq."+me+",recipient_id.eq."+me).order("created_at",{ascending:true});
    CG._dm.msgs = r.data||[];
    var need = {}; CG._dm.msgs.forEach(function(m){ var o=CG.dmOtherId(m); if(o&&!CG._dm.profiles[o]) need[o]=1; });
    var ids = Object.keys(need);
    if (ids.length){ var ps = await CG.sb.from("profiles").select(CG._DM_SEL).in("id",ids); (ps.data||[]).forEach(function(p){ CG._dm.profiles[p.id]=p; }); }
  } catch(e){}
  CG._dm.loaded = true;
};
CG.dmConvos = function(){
  var me=CG.dmUid(), map={};
  CG._dm.msgs.forEach(function(m){ var o=CG.dmOtherId(m); (map[o]=map[o]||{other:o,msgs:[]}).msgs.push(m); });
  return Object.keys(map).map(function(k){ var c=map[k]; c.last=c.msgs[c.msgs.length-1]; c.unread=c.msgs.filter(function(m){return m.recipient_id===me&&!m.read_at;}).length; return c; })
    .sort(function(a,b){ return new Date(b.last.created_at)-new Date(a.last.created_at); });
};
CG.dmMarkRead = async function(other){
  var me=CG.dmUid();
  var unread = CG._dm.msgs.filter(function(m){ return m.sender_id===other&&m.recipient_id===me&&!m.read_at; });
  if (!unread.length) return;
  var iso=new Date().toISOString(); unread.forEach(function(m){ m.read_at=iso; });
  CG.renderChrome();
  try { await CG.sb.rpc("mark_dm_read",{p_other:other}); } catch(e){}
};
CG.dmSend = async function(){
  var inp=document.getElementById("dmInput"); if(!inp||!CG._dm.active) return;
  var body=inp.value.trim(); if(!body) return;
  inp.value="";
  var r = await CG.sb.from("direct_messages").insert({ sender_id:CG.dmUid(), recipient_id:CG._dm.active, body:body }).select().single();
  if(r.error){ CG.toast(/banned/i.test(r.error.message)?"That player can’t receive messages":"Couldn’t send: "+r.error.message,"err"); inp.value=body; return; }
  CG._dm.msgs.push(r.data); CG.router();
};
CG.subscribeDMs = function(){
  if(!CG.sb||!CG.dmUid()||CG._dm.channel) return;
  var me=CG.dmUid();
  try {
    CG._dm.channel = CG.sb.channel("dm-"+me)
      .on("postgres_changes",{event:"INSERT",schema:"public",table:"direct_messages",filter:"recipient_id=eq."+me},function(payload){
        var m=payload.new; if(!m||CG._dm.msgs.find(function(x){return x.id===m.id;})) return;
        CG._dm.msgs.push(m);
        var onView = location.hash.indexOf("/messages")>=0;
        var finish=function(){ CG.renderChrome(); if(onView) CG.router(); else CG.toast("New message from "+CG.dmName(m.sender_id),"ok"); };
        if(!CG._dm.profiles[m.sender_id]){ CG.sb.from("profiles").select(CG._DM_SEL).eq("id",m.sender_id).maybeSingle().then(function(res){ if(res.data)CG._dm.profiles[res.data.id]=res.data; finish(); }); }
        else finish();
      }).subscribe();
  } catch(e){}
};
CG.ROUTES.messages = function(param){
  var head = CG.pageHead("Direct messages","Messages","Private messages with other league members — managers, staff, and the commissioner.");
  if (!CG.auth.profile){
    return head + '<div class="shell" style="max-width:620px;padding-bottom:48px"><div class="card"><div class="empty" style="padding:60px 20px">'+
      '<div class="e-art">'+CG.ic("msg",22)+'</div><b>Sign in to message</b><p>Direct messages are tied to your Discord account.</p>'+
      '<button class="btn btn-lg" id="dcSignIn" style="margin-top:18px;background:#5865F2;color:#fff">'+CG.DISCORD_GLYPH+'Sign in with Discord</button></div></div></div>';
  }
  if (!CG._dm.loaded){
    return head + '<div class="shell" style="padding-bottom:48px"><div class="card"><div class="card-b" id="dmLoading"><p class="caption">Loading conversations…</p></div></div></div>';
  }
  var me=CG.dmUid(), convos=CG.dmConvos(), active=CG._dm.active;
  var list = convos.slice();
  if (active && !list.find(function(c){return c.other===active;})) list.unshift({other:active,msgs:[],last:null,unread:0});
  var listHtml = list.length ? list.map(function(c){
    var prev = c.last ? ((c.last.sender_id===me?"You: ":"")+c.last.body) : "New conversation";
    return '<div class="notif'+(c.other===active?" unread":"")+'" data-dm-open="'+c.other+'" style="cursor:pointer'+(c.other===active?';background:var(--chrome-tint)':"")+'">'+CG.dmAva(c.other)+
      '<span style="min-width:0;flex:1"><b style="font-family:var(--f-disp);font-size:13.5px">'+esc(CG.dmName(c.other))+'</b>'+
      '<p style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(prev)+'</p></span>'+
      (c.unread?'<span class="hs-n">'+(c.unread>9?"9+":c.unread)+'</span>':"")+'</div>';
  }).join("") : '<div class="empty" style="padding:40px 16px"><b>No conversations yet</b><p>Open a member’s profile to start one.</p></div>';
  var thread;
  if (!active){ thread = '<div class="empty" style="padding:70px 20px"><div class="e-art">'+CG.ic("msg",20)+'</div><b>Pick a conversation</b><p>Your messages appear here.</p></div>'; }
  else {
    var msgs = CG._dm.msgs.filter(function(m){ return CG.dmOtherId(m)===active; });
    var body = msgs.length ? msgs.map(function(m){
      var mine = m.sender_id===me;
      return '<div style="max-width:78%;align-self:'+(mine?"flex-end":"flex-start")+';background:'+(mine?"var(--chrome)":"var(--ice)")+';color:'+(mine?"#101519":"var(--ink)")+';padding:9px 13px;border-radius:14px;font-size:14px;line-height:1.45">'+esc(m.body)+
        '<span style="display:block;font-size:10px;opacity:.6;margin-top:3px">'+CG.fmtTime(Date.parse(m.created_at))+'</span></div>';
    }).join("") : '<div class="empty" style="padding:40px"><p>No messages yet — say hi.</p></div>';
    thread = '<div style="padding:14px 16px;border-bottom:1px solid var(--line);display:flex;gap:10px;align-items:center">'+CG.dmAva(active)+'<b style="font-family:var(--f-disp)">'+esc(CG.dmName(active))+'</b></div>'+
      '<div id="dmMsgs" style="flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:8px;min-height:300px">'+body+'</div>'+
      '<div style="padding:12px 14px;border-top:1px solid var(--line);display:flex;gap:8px"><textarea id="dmInput" rows="1" placeholder="Message '+esc(CG.dmName(active))+'…" maxlength="2000" style="flex:1;resize:none"></textarea><button class="btn btn-chrome btn-sm" id="dmSend">Send</button></div>';
  }
  return head + '<div class="shell" style="padding-bottom:48px"><div class="card" style="padding:0;overflow:hidden">'+
    '<div class="grid" style="grid-template-columns:300px 1fr;gap:0;min-height:520px">'+
    '<div style="border-right:1px solid var(--line);overflow-y:auto;max-height:600px">'+listHtml+'</div>'+
    '<div style="display:flex;flex-direction:column">'+thread+'</div>'+
    '</div></div></div>';
};
CG.AFTER.messages = function(param){
  var dc=document.getElementById("dcSignIn"); if(dc) dc.addEventListener("click", function(){ CG.signIn(); });
  if (CG.auth.profile && !CG._dm.loaded){ CG.loadDMs().then(function(){ CG.router(); }); return; }
  document.querySelectorAll("[data-dm-open]").forEach(function(el){ el.addEventListener("click", function(){ CG._dm.active=this.getAttribute("data-dm-open"); CG.router(); CG.dmMarkRead(CG._dm.active); }); });
  var send=document.getElementById("dmSend"); if(send) send.addEventListener("click", CG.dmSend);
  var inp=document.getElementById("dmInput"); if(inp) inp.addEventListener("keydown", function(e){ if(e.key==="Enter"&&!e.shiftKey){ e.preventDefault(); CG.dmSend(); } });
  var mv=document.getElementById("dmMsgs"); if(mv) mv.scrollTop=mv.scrollHeight;
  if (CG._dm.active) CG.dmMarkRead(CG._dm.active);
};

/* ================================================================
   LIVE ADMIN: PRE-SEASON CENTRAL (registrations + owner apps + roster fill)
   Real data; reversible writes (scout_ovr, owner-app status).
   ================================================================ */
CG.admPreseason = function(){
  var lg=CG.lg, s=CG.SEASON||{};
  var regs=(lg._registrationsRaw||[]).slice(), apps=lg._ownerApps||[];
  var rosterMax=s.roster_max||15, rosteredIds=lg._rosteredIds||{};
  var assigned=regs.filter(function(r){ return rosteredIds[r.profile_id]; }).length;
  var pendingApps=apps.filter(function(a){ return a.status==="pending"; }).length;
  var h='<div style="margin-bottom:18px"><h2 class="h-sec">Pre-season central</h2>'+
    '<p class="lede" style="margin-top:6px">Registrations, owner applications, and roster building for '+esc(s.name||"the season")+'. Everything here writes to the live database.</p></div>';
  var kpis=[[regs.length,"Registered players",""],[assigned+" / "+regs.length,"Assigned to a club",""],[pendingApps,"Owner apps pending",pendingApps>0?"alert":""],[s.registration_open?"Open":"Closed","Registration",""]];
  h+='<div class="grid g4" style="grid-template-columns:repeat(auto-fill,minmax(180px,1fr));margin-bottom:20px">'+
    kpis.map(function(k){ return '<div class="kpi'+(k[2]==="alert"?" alert":"")+'" style="cursor:default"><b class="num">'+k[0]+'</b><span>'+k[1]+'</span></div>'; }).join("")+'</div>';
  var sortedRegs=regs.sort(function(a,b){ return (b.scout_ovr==null?-1:b.scout_ovr)-(a.scout_ovr==null?-1:a.scout_ovr); });
  h+='<div class="card"><div class="card-h"><h3>Registered players</h3><span class="chip">'+regs.length+'</span></div>'+
    (regs.length?'<div class="tblwrap"><table class="tbl keepcols"><caption>Season registrations</caption><thead><tr>'+
      '<th class="tleft">Player</th><th>POS</th><th class="tleft">EA ID</th><th>Scout OVR</th><th>Status</th><th class="tright">Assign to club</th></tr></thead><tbody>'+
      sortedRegs.map(function(r){ var prof=r.profiles||{}, on=rosteredIds[r.profile_id];
        var clubOpts = '<option value="">Choose club…</option>'+CG.TEAMS.map(function(t){ return '<option value="'+t.code+'">'+esc(t.code)+' · '+esc(t.name)+'</option>'; }).join("");
        return '<tr><td class="tleft"><span class="playercell"><span class="nm">'+esc(prof.gamertag||"—")+'</span></span></td>'+
          '<td class="tnum">'+esc(r.position||"—")+'</td><td class="tleft small" style="color:var(--steel)">'+esc(prof.ea_id||"—")+'</td>'+
          '<td class="tnum"><input type="number" min="40" max="99" value="'+(r.scout_ovr==null?"":r.scout_ovr)+'" data-scout="'+r.id+'" style="width:64px;text-align:center;padding:5px" placeholder="—"></td>'+
          '<td>'+(on?'<span class="chip chip-win">Rostered</span>':'<span class="chip chip-warn">Free agent</span>')+'</td>'+
          '<td class="tright">'+(on?'<span class="caption">—</span>':'<span style="display:inline-flex;gap:6px;align-items:center"><select data-assign-team="'+r.id+'" style="padding:5px;max-width:150px">'+clubOpts+'</select>'+
            '<button class="btn btn-chrome btn-sm" data-assign="'+r.id+'" data-prof="'+r.profile_id+'" data-pos="'+esc(r.position||"C")+'" data-name="'+esc(prof.gamertag||"a player")+'">Sign</button></span>')+'</td></tr>';
      }).join("")+'</tbody></table></div><div class="card-b" style="border-top:1px solid var(--line)"><span class="caption">Set a scouted overall to rank the draft pool. Pick a club and Sign to add a free agent to a roster (auto-assigns the next open jersey number, logs a transaction).</span></div>'
      :'<div class="card-b"><p class="caption">No registrations yet — they appear here as members register for the season.</p></div>')+'</div>';
  h+='<div class="card" style="margin-top:18px"><div class="card-h"><h3>Owner applications</h3><span class="chip '+(pendingApps?"chip-warn":"chip-win")+'">'+(pendingApps?pendingApps+" pending":"none pending")+'</span></div>';
  if (apps.length){
    h+=apps.map(function(a){ var prof=a.profiles||{}, sc=a.status==="approved"?"chip-win":a.status==="denied"?"chip-loss":"chip-warn";
      return '<div class="card-b" style="border-top:1px solid var(--line-soft)"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:8px">'+
        '<b style="font-family:var(--f-disp)">'+esc(prof.gamertag||"Applicant")+'</b><span class="chip '+sc+'">'+esc((a.status||"pending").toUpperCase())+'</span></div>'+
        '<div class="caption" style="display:flex;gap:14px;flex-wrap:wrap">'+(a.team_choice==="build"?'<span>Wants to build <b>'+esc(a.proposed_name||"a new club")+'</b>'+(a.proposed_location?" ("+esc(a.proposed_location)+")":""):'<span>Preferred club: <b>'+esc(a.preferred_club||"no preference")+'</b>')+'</span>'+(a.timezone?'<span>TZ '+esc(a.timezone)+'</span>':"")+'</div>'+
        (a.pitch?'<p class="small" style="color:var(--steel);margin-top:8px;font-style:italic">“'+esc(a.pitch)+'”</p>':"")+
        '<div style="display:flex;gap:8px;margin-top:10px"><button class="btn btn-chrome btn-sm" data-app-approve="'+a.id+'"'+(a.status==="approved"?" disabled":"")+'>Approve</button>'+
        '<button class="btn btn-ghost btn-sm" data-app-deny="'+a.id+'"'+(a.status==="denied"?" disabled":"")+'>Deny</button></div></div>';
    }).join("");
  } else { h+='<div class="card-b"><p class="caption">No owner applications yet. They appear here when members apply from the “Apply to own a team” page.</p></div>'; }
  h+='</div>';
  h+='<div class="card" style="margin-top:18px"><div class="card-h"><h3>Roster fill</h3><span class="chip">max '+rosterMax+' per club</span></div><div class="card-b">'+
    CG.TEAMS.map(function(t){ var n=(lg.byTeam[t.code]||[]).length, pct=Math.round(100*n/rosterMax);
      return '<div style="display:flex;align-items:center;gap:12px;padding:7px 0">'+CG.crest(t.code,20)+'<span style="width:140px;font-size:13px">'+esc(t.name)+'</span>'+
        '<span class="rb-track" style="flex:1"><span class="rb-fill" style="width:'+Math.min(100,pct)+'%"></span></span>'+
        '<b class="num" style="width:56px;text-align:right;font-size:13px">'+n+'/'+rosterMax+'</b></div>';
    }).join("")+'</div></div>';
  return h;
};
CG.AFTER._preseason = function(){
  document.querySelectorAll("[data-scout]").forEach(function(el){
    el.addEventListener("change", function(){
      var id=this.getAttribute("data-scout"), v=(this.value||"").trim();
      var nv = v===""?null:Math.max(40,Math.min(99,parseInt(v,10)||0));
      CG.sb.from("season_registrations").update({scout_ovr:nv}).eq("id",id).then(function(r){
        if(r.error){ CG.toast("Couldn’t save: "+r.error.message,"err"); }
        else { CG.toast("Scout OVR saved","ok"); var reg=(CG.lg._registrationsRaw||[]).find(function(x){return x.id===id;}); if(reg)reg.scout_ovr=nv; }
      });
    });
  });
  document.querySelectorAll("[data-app-approve]").forEach(function(b){ b.addEventListener("click", function(){ CG.setOwnerAppStatus(this.getAttribute("data-app-approve"),"approved"); }); });
  document.querySelectorAll("[data-app-deny]").forEach(function(b){ b.addEventListener("click", function(){ CG.setOwnerAppStatus(this.getAttribute("data-app-deny"),"denied"); }); });
  document.querySelectorAll("[data-assign]").forEach(function(b){ b.addEventListener("click", function(){
    var el=this, regId=el.getAttribute("data-assign"), sel=document.querySelector('[data-assign-team="'+regId+'"]'), code=sel?sel.value:"";
    if(!code){ CG.toast("Pick a club first","err"); return; }
    var name=el.getAttribute("data-name");
    CG.confirm("Sign "+name+" to "+CG.TEAM[code].name+"?","This adds the player to the club's active roster with the next open jersey number and logs a transaction. Reversible with a waive.","Sign player", function(){
      CG.assignRegistration(regId, el.getAttribute("data-prof"), el.getAttribute("data-pos"), name, code);
    });
  }); });
};
CG.assignRegistration = async function(regId, profileId, position, playerName, code){
  var s=CG.SEASON, teamId=(CG.lg._codeToId||{})[code];
  if(!s||!teamId){ CG.toast("Missing season/club","err"); return; }
  var used={}; (CG.lg.byTeam[code]||[]).forEach(function(p){ if(p.jersey) used[p.jersey]=1; });
  var num=0; for(var n=1;n<=99;n++){ if(!used[n]){ num=n; break; } }
  var r1 = await CG.sb.from("roster_spots").insert({ season_id:s.id, team_id:teamId, profile_id:profileId, jersey_number:num, position:position, salary:0 });
  if(r1.error){ CG.toast("Couldn’t sign: "+r1.error.message,"err"); return; }
  await CG.sb.from("season_registrations").update({ status:"assigned" }).eq("id", regId);
  await CG.sb.from("transactions").insert({ season_id:s.id, type:"sign", description: CG.TEAM[code].name+" signed <b>"+String(playerName||"a player").replace(/[<>]/g,"")+"</b> ("+position+" #"+num+")" });
  /* optimistic local update so the view reflects it immediately */
  CG.lg._rosteredIds[profileId]=true;
  if(CG.lg.byTeam[code]) CG.lg.byTeam[code].push({ id:profileId, tag:playerName, team:code, pos:position, jersey:num, mgmt:null, salary:0, depth:9 });
  CG.toast(playerName+" signed to "+CG.TEAM[code].name+" · #"+num,"ok");
  CG.router();
};
CG.setOwnerAppStatus = async function(id, status){
  var r = await CG.sb.from("owner_applications").update({ status:status, updated_at:new Date().toISOString() }).eq("id", id);
  if(r.error){ CG.toast("Couldn’t update: "+r.error.message,"err"); return; }
  var app=(CG.lg._ownerApps||[]).find(function(x){ return x.id===id; }); if(app) app.status=status;
  CG.toast("Application "+status,"ok"); CG.router();
};
/* ================================================================
   LIVE ADMIN: USERS & ROLES (set_member_role / set_team_manager / ban)
   ================================================================ */
CG.admUsersLive = function(){
  var lg=CG.lg;
  var profs=(lg._profilesRaw||[]).slice().sort(function(a,b){ return (a.gamertag||a.display_name||"").localeCompare(b.gamertag||b.display_name||""); });
  var playerById={}; (lg.players||[]).forEach(function(p){ playerById[p.id]=p; });
  var banned=profs.filter(function(p){ return p.banned; }).length;
  function roleOpts(cur){ return ["member","staff","commissioner"].map(function(r){ return '<option value="'+r+'"'+(cur===r?" selected":"")+'>'+r.charAt(0).toUpperCase()+r.slice(1)+'</option>'; }).join(""); }
  var h='<div style="margin-bottom:16px"><h2 class="h-sec">Users & roles</h2><p class="lede" style="margin-top:6px">Everyone with a Chel Gaming account. Assign league roles and club management, or ban a member — all live.</p></div>';
  h+='<div class="grid g3" style="margin-bottom:18px">'+
    '<div class="kpi" style="cursor:default"><b class="num">'+profs.length+'</b><span>accounts</span></div>'+
    '<div class="kpi" style="cursor:default"><b class="num">'+profs.filter(function(p){return p.role==="commissioner";}).length+'</b><span>commissioners</span></div>'+
    '<div class="kpi'+(banned?" alert":"")+'" style="cursor:default"><b class="num">'+banned+'</b><span>banned</span></div></div>';
  h+='<input type="search" id="userSearch" placeholder="Search players…" style="margin-bottom:16px" aria-label="Search users">';
  h+='<div class="card"><div class="card-h"><h3>Members</h3><span class="chip">'+profs.length+'</span></div>'+
    '<div class="tblwrap"><table class="tbl keepcols"><caption>All users</caption><thead><tr><th class="tleft">Player</th><th class="tleft">League role</th><th class="tleft">Club</th><th>Status</th><th class="tright">Actions</th></tr></thead><tbody id="usersBody">'+
    profs.map(function(pr){
      var pl=playerById[pr.id], club=pl?pl.team:null, mgmt=pl&&pl.mgmt?pl.mgmt:null;
      var gr=["member","staff","commissioner"].indexOf(pr.role)>=0?pr.role:"member";
      return '<tr data-user-name="'+esc((pr.gamertag||pr.display_name||"").toLowerCase())+'">'+
        '<td class="tleft"><span class="playercell">'+(pr.avatar_url?'<img src="'+esc(pr.avatar_url)+'" alt="" style="width:22px;height:22px;border-radius:50%;object-fit:cover">':"")+'<span class="nm">'+esc(pr.gamertag||pr.display_name||"—")+'</span></span></td>'+
        '<td class="tleft"><select data-role-for="'+pr.id+'" style="padding:5px;max-width:150px">'+roleOpts(gr)+'</select></td>'+
        '<td class="tleft">'+(club?'<span class="teamcell">'+CG.crest(club,18)+'<span class="mono" style="font-size:11px">'+esc(club)+'</span></span>'+(mgmt?' <span class="chip chip-chrome" style="font-size:9px">'+esc(mgmt.toUpperCase())+'</span>':""):'<span class="caption">—</span>')+'</td>'+
        '<td>'+(pr.banned?'<span class="chip chip-loss">Banned</span>':'<span class="chip chip-win">Active</span>')+'</td>'+
        '<td class="tright"><span style="display:inline-flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">'+
          '<button class="btn btn-ghost btn-sm" data-manage="'+pr.id+'" data-name="'+esc(pr.gamertag||pr.display_name||"member")+'">Club role</button>'+
          (pr.banned?'<button class="btn btn-ghost btn-sm" data-unban="'+pr.id+'">Unban</button>':'<button class="btn btn-ghost btn-sm" data-ban="'+pr.id+'" data-name="'+esc(pr.gamertag||pr.display_name||"member")+'">Ban</button>')+
        '</span></td></tr>';
    }).join("")+'</tbody></table></div>'+
    '<div class="card-b" style="border-top:1px solid var(--line)"><span class="caption">League role saves the moment you change it. “Club role” assigns a member as a club’s Owner, GM, or AGM. Banning removes site access and Discord membership; it’s reversible.</span></div></div>';
  return h;
};
CG.setUserRole = function(profileId, role){
  CG.sb.rpc("set_member_role",{ p_target:profileId, p_role:role, p_team_code:null }).then(function(r){
    if(r.error){ CG.toast("Couldn’t set role: "+r.error.message,"err"); return; }
    var pr=(CG.lg._profilesRaw||[]).find(function(x){ return x.id===profileId; }); if(pr) pr.role=role;
    CG.toast("Role updated to "+role,"ok");
  });
};
CG.assignClubRole = function(profileId, name){
  var teamOpts='<option value="">Choose club…</option>'+CG.TEAMS.map(function(t){ return '<option value="'+t.code+'">'+esc(t.code)+' · '+esc(t.name)+'</option>'; }).join("");
  CG.modal("Assign "+esc(name)+" to club management",
    '<label class="fld"><span>Club</span><select id="mgTeam">'+teamOpts+'</select></label>'+
    '<label class="fld"><span>Role</span><select id="mgRole"><option value="owner">Owner</option><option value="gm">General Manager</option><option value="agm">Assistant GM</option></select></label>'+
    '<p class="caption">Sets the club’s Owner / GM / AGM. Management runs their club’s Team HQ (roster, trades, lineups) and drafts their own picks.</p>',
    '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-chrome" id="mgGo">Assign</button>');
  document.getElementById("mgGo").addEventListener("click", function(){
    var code=document.getElementById("mgTeam").value, role=document.getElementById("mgRole").value;
    if(!code){ CG.toast("Pick a club first","err"); return; }
    CG.sb.rpc("set_team_manager",{ p_team_code:code, p_role:role, p_profile:profileId }).then(function(r){
      if(r.error){ CG.toast("Couldn’t assign: "+r.error.message,"err"); return; }
      if(CG.closeOverlay) CG.closeOverlay(); CG.toast(name+" is now "+role.toUpperCase()+" of "+code+" — refresh to see the badge","ok");
    });
  });
};
CG.banUser = function(profileId, name){
  CG.modal("Ban "+esc(name)+"?",
    '<label class="fld"><span>Reason (shown to the member)</span><textarea id="banReason" rows="2" placeholder="e.g. repeated conduct violations"></textarea></label>'+
    '<p class="caption">Bans remove site access and remove the member from the Chel Gaming Discord. Reversible with Unban.</p>',
    '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-ink" id="banGo">Ban member</button>');
  document.getElementById("banGo").addEventListener("click", function(){
    var reason=(document.getElementById("banReason").value||"").trim();
    CG.sb.rpc("ban_player",{ p_profile:profileId, p_reason:reason }).then(function(r){
      if(r.error){ CG.toast("Couldn’t ban: "+r.error.message,"err"); return; }
      var pr=(CG.lg._profilesRaw||[]).find(function(x){ return x.id===profileId; }); if(pr){ pr.banned=true; pr.ban_reason=reason; }
      if(CG.closeOverlay) CG.closeOverlay(); CG.toast(name+" banned","ok"); CG.router();
    });
  });
};
CG.unbanUser = function(profileId){
  CG.sb.rpc("unban_player",{ p_profile:profileId }).then(function(r){
    if(r.error){ CG.toast("Couldn’t unban: "+r.error.message,"err"); return; }
    var pr=(CG.lg._profilesRaw||[]).find(function(x){ return x.id===profileId; }); if(pr) pr.banned=false;
    CG.toast("Member unbanned","ok"); CG.router();
  });
};
CG.AFTER._admUsers = function(){
  var search=document.getElementById("userSearch");
  if(search) search.addEventListener("input", function(){
    var qy=this.value.toLowerCase();
    document.querySelectorAll("#usersBody tr").forEach(function(tr){ tr.style.display = tr.getAttribute("data-user-name").indexOf(qy)>=0?"":"none"; });
  });
  document.querySelectorAll("[data-role-for]").forEach(function(sel){ sel.addEventListener("change", function(){ CG.setUserRole(this.getAttribute("data-role-for"), this.value); }); });
  document.querySelectorAll("[data-manage]").forEach(function(b){ b.addEventListener("click", function(){ CG.assignClubRole(this.getAttribute("data-manage"), this.getAttribute("data-name")); }); });
  document.querySelectorAll("[data-ban]").forEach(function(b){ b.addEventListener("click", function(){ CG.banUser(this.getAttribute("data-ban"), this.getAttribute("data-name")); }); });
  document.querySelectorAll("[data-unban]").forEach(function(b){ b.addEventListener("click", function(){ CG.unbanUser(this.getAttribute("data-unban")); }); });
};

/* ================================================================
   LIVE ADMIN: LEAGUES & TIERS (CG umbrella — create_league RPC)
   ================================================================ */
CG.admLeagues = function(){
  var leagues=(CG.LEAGUES||[]).slice().sort(function(a,b){ return a.tier-b.tier || a.sort-b.sort; });
  var totalClubs=(CG.TEAMS||[]).length;
  var top=(CG.TOP_LEAGUE&&CG.TOP_LEAGUE.code)||"CGHL";
  var h='<div style="margin-bottom:16px"><h2 class="h-sec">Leagues &amp; tiers</h2><p class="lede" style="margin-top:6px">Chel Gaming is the umbrella. Each tier is its own league modeled on a real-world circuit — the <b>'+esc(top)+'</b> sits on top, built on the NHL. Add tiers beneath it (a CGAHL on the AHL, and so on) to grow the pyramid.</p></div>';
  h+='<div class="grid g3" style="margin-bottom:18px">'+
    '<div class="kpi" style="cursor:default"><b class="num">'+leagues.length+'</b><span>tier'+(leagues.length===1?"":"s")+'</span></div>'+
    '<div class="kpi" style="cursor:default"><b class="num">'+totalClubs+'</b><span>clubs</span></div>'+
    '<div class="kpi" style="cursor:default"><b class="num" style="font-size:20px">'+esc(top)+'</b><span>top tier</span></div></div>';
  h+='<div class="card" style="margin-bottom:18px"><div class="card-h"><h3>The Chel Gaming pyramid</h3><span class="chip">'+leagues.length+' tier'+(leagues.length===1?"":"s")+'</span></div>';
  h+=leagues.map(function(l,i){
    return '<div class="card-b" style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;'+(i?"border-top:1px solid var(--line)":"")+'">'+
      '<div style="flex:0 0 auto;display:flex;flex-direction:column;align-items:center;justify-content:center;width:56px;height:56px;border-radius:var(--r-s);background:var(--bc);color:var(--on-ink)"><span style="font-family:var(--f-mono);font-size:8.5px;letter-spacing:.14em;opacity:.7">TIER</span><b style="font-family:var(--f-disp);font-size:24px;line-height:1">'+l.tier+'</b></div>'+
      '<div style="flex:1 1 160px;min-width:0"><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><b class="mono" style="font-size:16px">'+esc(l.code)+'</b>'+(i===0?' <span class="chip chip-chrome" style="font-size:9px">TOP TIER</span>':'')+'</div><div style="color:var(--steel);font-size:13px;margin-top:2px">'+esc(l.name)+'</div></div>'+
      '<div style="flex:0 0 auto;text-align:right"><div style="font-family:var(--f-mono);font-size:9.5px;letter-spacing:.1em;color:var(--steel)">MODELED ON</div><b style="font-family:var(--f-disp);font-size:16px">'+esc(l.inspiration||"—")+'</b></div>'+
      '<div style="flex:0 0 auto;text-align:right;min-width:56px"><div style="font-family:var(--f-mono);font-size:9.5px;letter-spacing:.1em;color:var(--steel)">CLUBS</div><b class="num" style="font-family:var(--f-disp);font-size:16px">'+(l.teamCount||0)+'</b></div>'+
    '</div>';
  }).join("")+'</div>';
  var insp=["NHL","AHL","ECHL","KHL","SHL","Liiga","NCAA","CHL","OHL","WHL","QMJHL"];
  h+='<div class="card"><div class="card-h"><h3>Add a tier</h3></div><div class="card-b">'+
    '<div class="grid g2" style="gap:14px">'+
    '<label class="fld"><span>League code</span><input id="lgCode" placeholder="e.g. CGAHL" maxlength="8" style="text-transform:uppercase"></label>'+
    '<label class="fld"><span>Tier number</span><input id="lgTier" type="number" min="1" max="20" value="'+(leagues.length+1)+'"></label>'+
    '<label class="fld" style="grid-column:1/-1"><span>Full name</span><input id="lgName" placeholder="e.g. Chel Gaming American Hockey League"></label>'+
    '<label class="fld" style="grid-column:1/-1"><span>Real-world inspiration</span><input id="lgInsp" list="inspList" placeholder="e.g. AHL"><datalist id="inspList">'+insp.map(function(x){ return '<option value="'+x+'">'; }).join("")+'</datalist></label>'+
    '</div>'+
    '<div style="display:flex;justify-content:flex-end;gap:10px;margin-top:16px"><button class="btn btn-chrome" id="lgCreate">Create tier</button></div>'+
    '<p class="caption" style="margin-top:12px">A new tier is created empty. Clubs stay in their current league — assigning clubs to a tier (and promotion / relegation between them) is coming next.</p>'+
  '</div></div>';
  return h;
};
CG.createLeague = function(){
  var code=(document.getElementById("lgCode").value||"").trim().toUpperCase();
  var name=(document.getElementById("lgName").value||"").trim();
  var tier=parseInt(document.getElementById("lgTier").value,10);
  var insp=(document.getElementById("lgInsp").value||"").trim();
  if(!code){ CG.toast("Give the tier a code","err"); return; }
  if(!name){ CG.toast("Give the tier a full name","err"); return; }
  if(!(tier>=1)){ CG.toast("Tier number must be 1 or more","err"); return; }
  if((CG.LEAGUE_BY_CODE||{})[code]){ CG.toast(code+" already exists","err"); return; }
  var btn=document.getElementById("lgCreate"); if(btn){ btn.disabled=true; btn.textContent="Creating…"; }
  CG.sb.rpc("create_league",{ p_code:code, p_name:name, p_tier:tier, p_inspiration:insp||null }).then(function(r){
    if(r.error){ CG.toast("Couldn’t create: "+r.error.message,"err"); if(btn){ btn.disabled=false; btn.textContent="Create tier"; } return; }
    CG.toast(code+" created","ok");
    CG.loadLeagues().then(function(){ if(location.hash.indexOf("/leagues")>=0 && CG.router) CG.router(); });
  });
};
CG.AFTER._admLeagues = function(){
  var b=document.getElementById("lgCreate"); if(b) b.addEventListener("click", CG.createLeague);
  var code=document.getElementById("lgCode"); if(code) code.addEventListener("input", function(){ var s=this.selectionStart; this.value=this.value.toUpperCase(); try{ this.setSelectionRange(s,s); }catch(e){} });
};

/* ================================================================
   LIVE ADMIN: EA STATS — automatic stats pipeline (replaces manual
   results entry). Link each club to its EA club id; the scheduled
   poller + ingest-stats function do the rest.
   ================================================================ */
CG.admEAStats = function(){
  var lg = CG.lg;
  var teams = (CG.TEAMS||[]).slice();
  var linked = teams.filter(function(t){ return t.eaClubId; }).length;
  var finals = (lg.schedule||[]).filter(function(g){ return g.status==="final"; });
  var imported = finals.filter(function(g){ return g.eaMatchId; });
  var pending = (lg.schedule||[]).filter(function(g){ return g.status!=="final" && g.at < CG.now()-30*60000; });
  var h='<div style="margin-bottom:16px"><h2 class="h-sec">EA stats — automatic</h2><p class="lede" style="margin-top:6px">Final scores and full box scores import straight from the EA NHL match record — there is no manual results entry. Link each club to its EA club below; the poller pulls finished games automatically on game nights and writes every stat.</p></div>';
  h+='<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:18px">'+
    '<div class="kpi'+(linked<teams.length?" alert":"")+'" style="cursor:default"><b class="num">'+linked+'/'+teams.length+'</b><span>clubs linked</span></div>'+
    '<div class="kpi" style="cursor:default"><b class="num">'+imported.length+'</b><span>auto-imported finals</span></div>'+
    '<div class="kpi'+(pending.length?" alert":"")+'" style="cursor:default"><b class="num">'+pending.length+'</b><span>awaiting stats</span></div>'+
    '<div class="kpi" style="cursor:default"><b class="num" style="font-size:18px">'+(linked?(linked<teams.length?"Partial":"Active"):"Setup")+'</b><span>pipeline</span></div></div>';
  h+='<div class="card" style="margin-bottom:18px"><div class="card-h"><h3>Club → EA club link</h3><span class="chip">'+linked+'/'+teams.length+' linked</span></div>'+
    '<div class="tblwrap"><table class="tbl keepcols"><caption>Each club needs its numeric EA club id</caption><thead><tr><th class="tleft">Club</th><th class="tleft">EA club id</th><th class="tleft">EA club name (optional)</th><th class="tright">Save</th></tr></thead><tbody>'+
    teams.map(function(t){
      return '<tr><td class="tleft"><span class="teamcell">'+CG.crest(t.code,22)+'<span class="nm">'+esc(t.name)+'</span></span></td>'+
        '<td class="tleft"><input data-ea-id="'+t.id+'" value="'+esc(t.eaClubId||"")+'" placeholder="e.g. 45210" inputmode="numeric" style="max-width:130px"></td>'+
        '<td class="tleft"><input data-ea-name="'+t.id+'" value="'+esc(t.eaClub||"")+'" placeholder="EA club name" style="max-width:200px"></td>'+
        '<td class="tright"><button class="btn btn-ghost btn-sm" data-ea-save="'+t.id+'" data-code="'+esc(t.code)+'">Save</button></td></tr>';
    }).join("")+'</tbody></table></div>'+
    '<div class="card-b" style="border-top:1px solid var(--line)"><span class="caption">Find a club’s id in the EA NHL app or its Pro Clubs page. Once linked, the scheduled poller matches EA games to your schedule by club-pair + date and writes the final score and every box-score stat — no manual entry.</span></div></div>';
  h+='<div class="card"><div class="card-h"><h3>Recent activity</h3>'+(imported.length?'<span class="chip chip-win">'+imported.length+' imported</span>':"")+'</div>';
  if (imported.length){
    h+= imported.slice().sort(function(a,b){ return b.at-a.at; }).slice(0,8).map(function(g){
      return '<div class="card-b" style="border-top:1px solid var(--line);display:flex;align-items:center;gap:10px;flex-wrap:wrap"><span class="teamcell">'+CG.crest(g.away,20)+'<span class="mono" style="font-size:12px">'+esc(g.away)+' '+g.awayScore+'</span></span><span class="caption">@</span><span class="teamcell"><span class="mono" style="font-size:12px">'+esc(g.home)+' '+g.homeScore+'</span>'+CG.crest(g.home,20)+'</span><a class="btn btn-ghost btn-sm" style="margin-left:auto" href="#/matchup/'+g.id+'">Box score</a></div>';
    }).join("");
  } else if (pending.length){
    h+='<div class="card-b"><span class="caption"><b>'+pending.length+'</b> scheduled game'+(pending.length>1?"s have":" has")+' passed and '+(pending.length>1?"are":"is")+' still waiting for EA stats. If a game never imports, confirm both clubs are linked above and were in the same EA match.</span></div>';
  } else {
    h+='<div class="card-b"><div class="empty" style="padding:30px 20px"><div class="e-art">'+CG.ic("chart",20)+'</div><b>No finals yet</b><p>Once the season starts, finished games appear here automatically as the poller imports them.</p></div></div>';
  }
  h+='</div>';
  return h;
};
CG.saveEAClub = function(teamId, code){
  var idEl=document.querySelector('[data-ea-id="'+teamId+'"]'), nameEl=document.querySelector('[data-ea-name="'+teamId+'"]');
  if(!idEl) return;
  var eaId=(idEl.value||"").trim(), eaName=(nameEl.value||"").trim();
  if (eaId && !/^\d+$/.test(eaId)){ CG.toast("EA club id should be numbers only","err"); return; }
  var btn=document.querySelector('[data-ea-save="'+teamId+'"]'); if(btn){ btn.disabled=true; btn.textContent="Saving…"; }
  CG.sb.from("teams").update({ ea_club_id: eaId||null, ea_club_name: eaName||null }).eq("id",teamId).then(function(r){
    if(btn){ btn.disabled=false; btn.textContent="Save"; }
    if(r.error){ CG.toast("Couldn’t save: "+r.error.message,"err"); return; }
    var t=CG.TEAM[code]; if(t){ t.eaClubId=eaId||null; t.eaClub=eaName||null; }
    CG.toast(code+" EA link saved","ok"); CG.router();
  });
};
CG.AFTER._admEAStats = function(){
  document.querySelectorAll("[data-ea-save]").forEach(function(b){ b.addEventListener("click", function(){ CG.saveEAClub(this.getAttribute("data-ea-save"), this.getAttribute("data-code")); }); });
};

/* ================================================================
   LIVE ADMIN: SERVER PRESETS — real, editable, persisted in app_config
   (key server_presets, JSON array; commissioner-only RLS)
   ================================================================ */
CG.DEFAULT_PRESETS = [
  { name:"League Night", assigned:"All regular-season games", active:true,
    set:[["Region","NA East"],["Mode","EASHL 6v6 Private"],["Periods","3 × 5:00"],["OT","3v3 5:00 → SO"],["Host","Home club"],["Pauses","2 per club"],["Streaming","Both goalie POVs"]] },
  { name:"Playoff Standard", assigned:"Playoff rounds", active:false,
    set:[["Region","NA East"],["Mode","EASHL 6v6 Private"],["Periods","3 × 6:00"],["OT","5v5 continuous"],["Host","Higher seed"],["Pauses","1 per club"],["Streaming","League broadcast + POVs"]] }
];
CG.presets = function(){ return (CG.lg && CG.lg._presets) || CG.DEFAULT_PRESETS; };
CG.savePresets = function(list, done){
  CG.sb.from("app_config").upsert({ key:"server_presets", value: JSON.stringify(list), updated_at: new Date().toISOString() }, { onConflict:"key" })
    .then(function(r){
      if (r.error){ CG.toast("Couldn’t save presets: "+r.error.message,"err"); return; }
      CG.lg._presets = list;
      if (done) done();
      CG.toast("Presets saved","ok");
      if (CG.router) CG.router();
    });
};
CG.admPresetsLive = function(){
  var presets = CG.presets();
  return '<div style="margin-bottom:16px"><h2 class="h-sec">Server presets</h2><p class="lede" style="margin-top:6px">The lobby settings clubs are expected to run. Edit a preset and it saves to the league database — the active one is what the rulebook’s settings sheet points to.</p></div>'+
    '<div class="grid g2">'+presets.map(function(p,i){
    return '<div class="card"><div class="card-h"><h3>'+esc(p.name)+'</h3><span class="chip'+(p.active?" chip-chrome":"")+'">'+(p.active?"Active default":"Scheduled")+'</span></div>'+
    '<div class="card-b" style="padding-top:8px">'+(p.set||[]).map(function(kv){
      return '<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--line-soft);font-size:13px"><span style="color:var(--steel)">'+esc(kv[0])+'</span><b>'+esc(kv[1])+'</b></div>';
    }).join("")+
    '<p class="caption" style="margin:10px 0 12px">Assigned to: '+esc(p.assigned||"—")+'</p>'+
    '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-ghost btn-sm" data-preset-edit="'+i+'">Edit preset</button>'+
    (!p.active?'<button class="btn btn-ghost btn-sm" data-preset-activate="'+i+'">Make active</button>':"")+
    (presets.length>1?'<button class="btn btn-ghost btn-sm" data-preset-del="'+i+'">Delete</button>':"")+
    '</div></div></div>';
  }).join("")+'</div>'+
  '<button class="btn btn-ink" style="margin-top:16px" id="presetNew">'+CG.ic("plus",15)+'New preset</button>';
};
CG.editPreset = function(idx){
  var presets = CG.presets().map(function(p){ return JSON.parse(JSON.stringify(p)); });
  var isNew = idx==null;
  var p = isNew ? { name:"", assigned:"", active:false, set: JSON.parse(JSON.stringify((presets[0]||CG.DEFAULT_PRESETS[0]).set)) } : presets[idx];
  var lines = (p.set||[]).map(function(kv){ return kv[0]+": "+kv[1]; }).join("\n");
  CG.modal(isNew?"New preset":"Edit — "+esc(p.name),
    '<label class="fld"><span>Preset name</span><input id="psName" value="'+esc(p.name)+'" placeholder="e.g. League Night"></label>'+
    '<label class="fld"><span>Assigned to</span><input id="psAssigned" value="'+esc(p.assigned||"")+'" placeholder="e.g. All regular-season games"></label>'+
    '<label class="fld"><span>Settings — one per line, <span class="mono">Setting: Value</span></span><textarea id="psSet" rows="8" style="font-family:var(--f-mono);font-size:12px">'+esc(lines)+'</textarea></label>',
    '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-chrome" id="psSave">'+(isNew?"Create preset":"Save preset")+'</button>');
  document.getElementById("psSave").addEventListener("click", function(){
    var name=(document.getElementById("psName").value||"").trim();
    if(!name){ CG.toast("Give the preset a name","err"); return; }
    var set=[], bad=null;
    (document.getElementById("psSet").value||"").split("\n").forEach(function(ln){
      ln=ln.trim(); if(!ln) return;
      var ci=ln.indexOf(":");
      if(ci<1){ bad=ln; return; }
      set.push([ln.slice(0,ci).trim(), ln.slice(ci+1).trim()]);
    });
    if(bad){ CG.toast('“'+bad+'” isn’t “Setting: Value” — add a colon',"err"); return; }
    if(!set.length){ CG.toast("Add at least one setting line","err"); return; }
    var next = { name:name, assigned:(document.getElementById("psAssigned").value||"").trim(), active:p.active, set:set };
    if (isNew){ presets.push(next); } else { presets[idx]=next; }
    if (CG.closeOverlay) CG.closeOverlay();
    CG.savePresets(presets);
  });
};
CG.AFTER._admPresets = function(){
  document.querySelectorAll("[data-preset-edit]").forEach(function(b){ b.addEventListener("click", function(){ CG.editPreset(+this.getAttribute("data-preset-edit")); }); });
  document.querySelectorAll("[data-preset-activate]").forEach(function(b){ b.addEventListener("click", function(){
    var i=+this.getAttribute("data-preset-activate");
    var presets=CG.presets().map(function(p,j){ p=JSON.parse(JSON.stringify(p)); p.active=(j===i); return p; });
    CG.savePresets(presets);
  }); });
  document.querySelectorAll("[data-preset-del]").forEach(function(b){ b.addEventListener("click", function(){
    var i=+this.getAttribute("data-preset-del");
    var presets=CG.presets().map(function(p){ return JSON.parse(JSON.stringify(p)); });
    var name=presets[i].name, wasActive=presets[i].active;
    CG.confirm("Delete “"+esc(name)+"”?","Clubs keep playing on the remaining presets. This can’t be undone.","Delete preset", function(){
      presets.splice(i,1);
      if (wasActive && presets.length) presets[0].active=true;
      CG.savePresets(presets);
    });
  }); });
  var nw=document.getElementById("presetNew");
  if (nw) nw.addEventListener("click", function(){ CG.editPreset(null); });
};

/* ================================================================
   LIVE ADMIN: TEAMS — add / edit / remove clubs (real teams table)
   ================================================================ */
CG.reloadLeague = async function(){
  try {
    CG.lg = await CG.buildLiveLeague();
    await CG.loadManagerData();
    CG.renderChrome(); CG.router();
  } catch(e){ CG.toast("Reload failed — refresh the page","err"); }
};
CG.admTeamsLive = function(){
  var teams = (CG.TEAMS||[]).slice();
  var h='<div style="margin-bottom:16px"><h2 class="h-sec">Teams</h2><p class="lede" style="margin-top:6px">Every club in the league — identity, division, and home arena. Edits go straight to the database and the whole site updates with them.</p></div>';
  h+='<div class="grid g3" style="margin-bottom:18px">'+
    '<div class="kpi" style="cursor:default"><b class="num">'+teams.length+'</b><span>clubs</span></div>'+
    '<div class="kpi" style="cursor:default"><b class="num">'+(CG.DIVISIONS?CG.DIVISIONS.length:2)+'</b><span>divisions</span></div>'+
    '<div class="kpi" style="cursor:default"><b class="num" style="font-size:20px">'+esc((CG.TOP_LEAGUE&&CG.TOP_LEAGUE.code)||"CGHL")+'</b><span>league</span></div></div>';
  h+='<div class="card"><div class="card-h"><h3>Clubs</h3><button class="btn btn-chrome btn-sm" id="teamAdd">'+CG.ic("plus",14)+'Add a club</button></div>'+
    '<div class="tblwrap"><table class="tbl keepcols"><caption>All clubs</caption><thead><tr><th class="tleft">Club</th><th class="tleft">Code</th><th class="tleft">Division</th><th class="tleft">Arena</th><th>Roster</th><th class="tright">Actions</th></tr></thead><tbody>'+
    teams.map(function(t){
      var n=(CG.lg.byTeam[t.code]||[]).length;
      return '<tr><td class="tleft"><span class="teamcell">'+CG.crest(t.code,24)+'<span><span class="nm">'+esc(t.name)+'</span><small>'+esc(t.city||"—")+'</small></span></span></td>'+
        '<td class="tleft mono" style="font-size:12px">'+esc(t.code)+'</td>'+
        '<td class="tleft">'+esc(t.div)+'</td><td class="tleft small" style="color:var(--steel)">'+esc(t.arena||"—")+'</td>'+
        '<td data-v="'+n+'">'+n+'</td>'+
        '<td class="tright"><span style="display:inline-flex;gap:6px"><button class="btn btn-ghost btn-sm" data-team-edit="'+t.id+'">Edit</button>'+
        '<button class="btn btn-ghost btn-sm" data-team-del="'+t.id+'" data-name="'+esc(t.name)+'">Remove</button></span></td></tr>';
    }).join("")+'</tbody></table></div>'+
    '<div class="card-b" style="border-top:1px solid var(--line)"><span class="caption">Renames propagate everywhere instantly (rosters, schedule, and history follow the club, not the name). Removing a club is blocked while it still has rostered players or scheduled games.</span></div></div>';
  return h;
};
/* upload a club logo to the public team-logos bucket (commissioner-only RLS);
   timestamped path so a re-upload never fights the CDN cache on the old file */
CG.uploadTeamLogo = function(file, code){
  var ext = ((file.name.split(".").pop()||"png").toLowerCase().replace(/[^a-z0-9]/g,"")) || "png";
  var path = (code||"logo").toLowerCase()+"-"+Date.now()+"."+ext;
  return CG.sb.storage.from("team-logos").upload(path, file, { upsert:true, contentType:file.type })
    .then(function(r){
      if (r.error) throw r.error;
      return CG.sb.storage.from("team-logos").getPublicUrl(path).data.publicUrl;
    });
};
CG.teamForm = function(t){
  var isNew = !t;
  t = t || { name:"", city:"", code:"", color:"#8899A6", arena:"", div:(CG.DIVISIONS&&CG.DIVISIONS[0])||"East", logo:null };
  var divOpts = (CG.DIVISIONS&&CG.DIVISIONS.length?CG.DIVISIONS:["East","West"]).map(function(d){ return '<option'+(t.div===d?" selected":"")+'>'+esc(d)+'</option>'; }).join("");
  CG.modal(isNew?"Add a club":"Edit — "+esc(t.name),
    '<div class="grid g2" style="gap:12px">'+
    '<label class="fld"><span>Club name</span><input id="tfName" value="'+esc(t.name)+'" placeholder="e.g. Boston Bruins"></label>'+
    '<label class="fld"><span>City</span><input id="tfCity" value="'+esc(t.city||"")+'" placeholder="e.g. Boston"></label>'+
    '<label class="fld"><span>Code (2–4 letters)</span><input id="tfCode" value="'+esc(t.code)+'" maxlength="4" style="text-transform:uppercase" placeholder="e.g. BOS"></label>'+
    '<label class="fld"><span>Division</span><select id="tfDiv">'+divOpts+'</select></label>'+
    '<label class="fld"><span>Arena</span><input id="tfArena" value="'+esc(t.arena||"")+'" placeholder="e.g. TD Garden"></label>'+
    '<label class="fld"><span>Club color</span><input id="tfColor" type="color" value="'+esc(t.color||"#8899A6")+'" style="height:44px;padding:4px"></label>'+
    '</div>'+
    '<label class="fld" style="margin-top:2px"><span>Club logo</span></label>'+
    '<div class="logo-drop" id="tfLogoDrop" role="button" tabindex="0" aria-label="Upload a club logo" data-url="'+esc(t.logo||"")+'">'+
      (t.logo?'<img src="'+esc(t.logo)+'" alt="Current logo">':'<span class="lp-hint">Drag a logo here, or click to upload — PNG/JPG, under 2 MB. Without one, the site draws the club crest.</span>')+
    '</div>'+
    '<input type="file" id="tfLogoFile" accept="image/*" hidden>'+
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px">'+
      '<span class="caption">Uploads apply when you save the club.</span>'+
      '<button type="button" class="btn btn-ghost btn-sm" id="tfLogoClear"'+(t.logo?'':' style="display:none"')+'>Use generated crest</button>'+
    '</div>',
    '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-chrome" id="tfSave">'+(isNew?"Add club":"Save changes")+'</button>');
  /* --- drag & drop logo wiring --- */
  var zone = document.getElementById("tfLogoDrop"), fileIn = document.getElementById("tfLogoFile"),
      clearBtn = document.getElementById("tfLogoClear");
  function setPreview(url){
    zone.setAttribute("data-url", url||"");
    zone.innerHTML = url ? '<img src="'+esc(url)+'" alt="Club logo">' :
      '<span class="lp-hint">Drag a logo here, or click to upload — PNG/JPG, under 2 MB. Without one, the site draws the club crest.</span>';
    clearBtn.style.display = url ? "" : "none";
  }
  function doUpload(f){
    if (!f) return;
    if (!/^image\//.test(f.type)){ CG.toast("That isn’t an image — use a PNG or JPG","err"); return; }
    if (f.size > 2*1024*1024){ CG.toast("Keep the logo under 2 MB","err"); return; }
    var prev = zone.getAttribute("data-url");
    zone.classList.add("busy");
    zone.innerHTML = '<span class="lp-hint">Uploading…</span>';
    var code = (document.getElementById("tfCode").value||t.code||"logo").trim();
    CG.uploadTeamLogo(f, code).then(function(url){
      zone.classList.remove("busy"); setPreview(url);
      CG.toast("Logo uploaded — save the club to apply it","ok");
    }).catch(function(e){
      zone.classList.remove("busy"); setPreview(prev);
      CG.toast("Upload failed: "+((e&&e.message)||"try again"),"err");
    });
  }
  zone.addEventListener("click", function(){ fileIn.click(); });
  zone.addEventListener("keydown", function(e){ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); fileIn.click(); } });
  fileIn.addEventListener("change", function(){ if(fileIn.files[0]) doUpload(fileIn.files[0]); });
  zone.addEventListener("dragover", function(e){ e.preventDefault(); zone.classList.add("drag"); });
  zone.addEventListener("dragleave", function(){ zone.classList.remove("drag"); });
  zone.addEventListener("drop", function(e){ e.preventDefault(); zone.classList.remove("drag"); if(e.dataTransfer.files[0]) doUpload(e.dataTransfer.files[0]); });
  clearBtn.addEventListener("click", function(){ setPreview(""); CG.toast("Back to the generated crest — save to apply","ok"); });
  document.getElementById("tfSave").addEventListener("click", function(){
    var name=(document.getElementById("tfName").value||"").trim(),
        code=(document.getElementById("tfCode").value||"").trim().toUpperCase();
    if(!name){ CG.toast("Give the club a name","err"); return; }
    if(!/^[A-Z]{2,4}$/.test(code)){ CG.toast("Code should be 2–4 letters","err"); return; }
    var clash=(CG.TEAMS||[]).find(function(x){ return x.code===code && (!t.id || x.id!==t.id); });
    if(clash){ CG.toast(code+" is already "+clash.name+"’s code","err"); return; }
    var rec={ name:name, city:(document.getElementById("tfCity").value||"").trim()||null, code:code,
      division:document.getElementById("tfDiv").value, arena:(document.getElementById("tfArena").value||"").trim()||null,
      color:document.getElementById("tfColor").value,
      logo_url: document.getElementById("tfLogoDrop").getAttribute("data-url") || null };
    var btn=this; btn.disabled=true;
    var q = isNew
      ? CG.sb.from("teams").insert(Object.assign({}, rec, { league_id:(CG.TOP_LEAGUE&&CG.TOP_LEAGUE.id)||null }))
      : CG.sb.from("teams").update(rec).eq("id", t.id);
    q.then(function(r){
      btn.disabled=false;
      if(r.error){ CG.toast("Couldn’t save: "+r.error.message,"err"); return; }
      if (CG.closeOverlay) CG.closeOverlay();
      CG.toast(isNew?name+" added to the league":"Club saved","ok");
      CG.reloadLeague();
    });
  });
};
CG.removeTeam = function(teamId, name){
  /* guarded: block removal while the club has rostered players or games */
  Promise.all([
    CG.sb.from("roster_spots").select("id",{count:"exact",head:true}).eq("team_id",teamId),
    CG.sb.from("games").select("id",{count:"exact",head:true}).or("home_team_id.eq."+teamId+",away_team_id.eq."+teamId)
  ]).then(function(rs){
    var spots=(rs[0]&&rs[0].count)||0, games=(rs[1]&&rs[1].count)||0;
    if (spots||games){
      CG.toast("Can’t remove "+name+" — it has "+(spots?spots+" rostered player"+(spots===1?"":"s"):"")+(spots&&games?" and ":"")+(games?games+" scheduled game"+(games===1?"":"s"):"")+". Reassign those first.","err");
      return;
    }
    CG.confirm("Remove "+esc(name)+"?","The club comes off the site everywhere. This can’t be undone.","Remove club", function(){
      CG.sb.from("teams").delete().eq("id",teamId).then(function(r){
        if(r.error){ CG.toast("Couldn’t remove: "+r.error.message,"err"); return; }
        CG.toast(name+" removed","ok");
        CG.reloadLeague();
      });
    });
  });
};
CG.AFTER._admTeams = function(){
  var add=document.getElementById("teamAdd");
  if(add) add.addEventListener("click", function(){ CG.teamForm(null); });
  document.querySelectorAll("[data-team-edit]").forEach(function(b){ b.addEventListener("click", function(){
    var id=this.getAttribute("data-team-edit");
    CG.teamForm((CG.TEAMS||[]).find(function(t){ return t.id===id; }));
  }); });
  document.querySelectorAll("[data-team-del]").forEach(function(b){ b.addEventListener("click", function(){
    CG.removeTeam(this.getAttribute("data-team-del"), this.getAttribute("data-name"));
  }); });
};

/* register live Control Center sections */
CG._origAdminRoute = CG.ROUTES.admin;
CG.ROUTES.admin = function(param, qs){
  if (CG.role()!=="commish") return CG.unauthorized("The Control Center is commissioner-only.");
  if (param==="preseason") return CG.adminShell("preseason", CG.admPreseason(qs||{}));
  if (param==="users") return CG.adminShell("users", CG.admUsersLive(qs||{}));
  if (param==="leagues") return CG.adminShell("leagues", CG.admLeagues(qs||{}));
  if (param==="clubs") return CG.adminShell("clubs", CG.admTeamsLive(qs||{}));
  if (param==="presets") return CG.adminShell("presets", CG.admPresetsLive(qs||{}));
  if (param==="eastats") return CG.adminShell("eastats", CG.admEAStats(qs||{}));
  return CG._origAdminRoute(param, qs);
};
CG._origAdminAfter = CG.AFTER.admin;
CG.AFTER.admin = function(param, qs){
  if (param==="preseason"){ CG.AFTER._preseason(); return; }
  if (param==="users"){ CG.AFTER._admUsers(); return; }
  if (param==="leagues"){ CG.AFTER._admLeagues(); return; }
  if (param==="clubs"){ CG.AFTER._admTeams(); return; }
  if (param==="presets"){ CG.AFTER._admPresets(); return; }
  if (param==="eastats"){ CG.AFTER._admEAStats(); return; }
  if (CG._origAdminAfter) CG._origAdminAfter(param, qs);
};

/* ================================================================
   LIVE TRADES — Team HQ Trade Hub on the real trades model
   (players + draft picks + salary retention; accept_trade RPC)
   ================================================================ */
CG._liveTrade = null;
CG.liveTrade = function(){ if(!CG._liveTrade) CG._liveTrade={partner:null,offP:[],reqP:[],offK:[],reqK:[],ret:{}}; return CG._liveTrade; };
CG.tPlayer = function(pid){ return (CG.lg.players||[]).find(function(p){ return p.id===pid; }); };
CG.tPick = function(kid){ return (CG.lg.draftPicks||[]).find(function(p){ return p.id===kid; }); };
CG.tRoster = function(code){ return (CG.lg.byTeam[code]||[]).filter(function(p){ return !p.mgmt; }); };
CG.tPicks = function(code){ return (CG.lg.draftPicks||[]).filter(function(p){ return p.ownerCode===code && !p.used && !p.skipped; }); };
CG.pickLabel = function(k){ return k?("’"+String(k.season).slice(-2)+" R"+k.round+(k.origCode&&k.origCode!==k.ownerCode?" (via "+k.origCode+")":"")):"pick"; };
CG.refreshTrades = function(){ if(!CG.sb) return; CG.loadManagerData().then(function(){ if(location.hash.indexOf("/tradehub")>=0 && CG.router) CG.router(); }); };
CG.hubTradeHubLive = function(qs){
  var lg=CG.lg, club=CG.myClub(), t=CG.TEAM[club], d=CG.liveTrade();
  var myTid=(lg._codeToId||{})[club], trades=lg._myTrades||[];
  var incoming=trades.filter(function(tr){ return tr.to_team_id===myTid; });
  var outgoing=trades.filter(function(tr){ return tr.from_team_id===myTid; });
  var others=Object.keys(CG.TEAM).filter(function(c){ return c!==club; }).sort();
  function items(pids,kids){
    var out=(pids||[]).map(function(pid){ var p=CG.tPlayer(pid); return '<div style="margin-top:6px"><span class="playercell">'+(p?CG.crest(p.team,18):"")+'<span class="nm">'+esc(p?p.tag:"a player")+'</span>'+(p?'<small style="color:var(--steel)">'+p.pos+' · '+CG.fmtMoney(p.salary)+'</small>':"")+'</span></div>'; });
    (kids||[]).forEach(function(kid){ out.push('<div class="caption" style="margin-top:6px">'+esc(CG.pickLabel(CG.tPick(kid)))+' pick</div>'); });
    return out.length?out.join(""):'<span class="caption">—</span>';
  }
  var h='<div style="margin-bottom:18px"><span class="eyebrow chr">'+esc(t.name)+' · team management</span>'+
    '<h1 class="h-sec" style="margin-top:8px">Trade Hub</h1>'+
    '<p class="lede" style="margin-top:8px">Offer players and draft picks, review incoming offers, and propose deals — all live. Nothing changes hands until the other club accepts.</p></div>';
  h+='<div class="note red" style="margin-bottom:18px;display:flex;gap:10px;align-items:flex-start">'+CG.ic("lock",16)+'<span><b style="font-family:var(--f-disp)">Confidential to management.</b> Offers and notes are visible to your Owner, GM, and AGM (Rule 2.3).</span></div>';
  var inc='<div class="card"><div class="card-h"><h3>Incoming offers</h3><span class="chip '+(incoming.length?"chip-warn":"chip-win")+'">'+(incoming.length?incoming.length+" awaiting you":"None pending")+'</span></div>';
  if(incoming.length){
    inc+=incoming.map(function(tr){ var fromCode=lg._idToCode[tr.from_team_id];
      return '<div class="card-b" style="border-top:1px solid var(--line-soft)"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:8px">'+
        '<span class="teamcell">'+CG.crest(fromCode,22)+'<span class="nm">'+esc((CG.TEAM[fromCode]||{}).name||fromCode)+'</span></span><span class="nf-t">'+CG.fmtDate((tr.created_at||"").slice(0,10)||"2026-01-01")+'</span></div>'+
        '<div class="grid g2" style="gap:14px"><div><span class="caption">You receive</span>'+items(tr.offered_profile_ids,tr.offered_pick_ids)+'</div>'+
        '<div><span class="caption">You send</span>'+items(tr.requested_profile_ids,tr.requested_pick_ids)+'</div></div>'+
        (tr.note?'<p class="small" style="color:var(--steel);margin-top:10px;font-style:italic">“'+esc(tr.note)+'”</p>':"")+
        '<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;justify-content:flex-end">'+
          '<button class="btn btn-ghost btn-sm" data-trade-counter="'+tr.id+'">Counter</button>'+
          '<button class="btn btn-ghost btn-sm" data-trade-decline="'+tr.id+'">Decline</button>'+
          '<button class="btn btn-chrome btn-sm" data-trade-accept="'+tr.id+'">Accept</button></div></div>';
    }).join("");
  } else { inc+='<div class="card-b"><p class="small" style="color:var(--steel)">No open offers right now. When another club sends you one, it lands here.</p></div>'; }
  inc+='</div>';
  var outCard='';
  if(outgoing.length){
    outCard='<div class="card" style="margin-top:18px"><div class="card-h"><h3>Offers you’ve sent</h3><span class="chip">'+outgoing.length+'</span></div>'+
      outgoing.map(function(tr){ var toCode=lg._idToCode[tr.to_team_id];
        return '<div class="card-b" style="border-top:1px solid var(--line-soft)"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:8px">'+
          '<span class="teamcell">'+CG.crest(toCode,22)+'<span class="nm">to '+esc((CG.TEAM[toCode]||{}).name||toCode)+'</span></span><span class="chip chip-warn">Proposed</span></div>'+
          '<div class="grid g2" style="gap:14px"><div><span class="caption">You send</span>'+items(tr.offered_profile_ids,tr.offered_pick_ids)+'</div>'+
          '<div><span class="caption">You receive</span>'+items(tr.requested_profile_ids,tr.requested_pick_ids)+'</div></div>'+
          '<button class="btn btn-ghost btn-sm" data-trade-cancel="'+tr.id+'" style="margin-top:10px">Withdraw offer</button></div>';
      }).join("")+'</div>';
  }
  function sideList(pids,kids,sk){
    var body=(pids||[]).map(function(pid){ var p=CG.tPlayer(pid); return '<div style="display:flex;align-items:center;gap:8px;margin-top:8px"><span class="playercell">'+(p?CG.crest(p.team,18):"")+'<span class="nm">'+esc(p?p.tag:"?")+'</span><small style="color:var(--steel)">'+(p?p.pos+" · "+CG.fmtMoney(p.salary):"")+'</small></span><button class="chip" data-trade-rm="'+sk+'p:'+pid+'" style="cursor:pointer;margin-left:auto">✕</button></div>'; }).join("");
    body+=(kids||[]).map(function(kid){ return '<div style="display:flex;align-items:center;gap:8px;margin-top:8px"><span class="caption">'+esc(CG.pickLabel(CG.tPick(kid)))+' pick</span><button class="chip" data-trade-rm="'+sk+'k:'+kid+'" style="cursor:pointer;margin-left:auto">✕</button></div>'; }).join("");
    return body||'<p class="caption" style="margin-top:8px">Nothing added yet.</p>';
  }
  var partnerName=d.partner?(CG.TEAM[d.partner]||{}).name:"Partner";
  var build='<div class="card" style="margin-top:18px"><div class="card-h"><h3>Build a trade</h3>'+((d.offP.length||d.reqP.length||d.offK.length||d.reqK.length)?'<button class="btn btn-ghost btn-sm" id="tradeClear">Clear</button>':'<span class="chip chip-chrome">Draft</span>')+'</div><div class="card-b">'+
    '<label class="fld" style="max-width:340px"><span>Trade partner</span><select id="tradePartner"><option value="">Choose a club…</option>'+others.map(function(c){ return '<option value="'+c+'"'+(d.partner===c?" selected":"")+'>'+esc(CG.TEAM[c].name)+'</option>'; }).join("")+'</select></label>'+
    '<div class="grid g2" style="gap:16px;margin-top:14px;align-items:start">'+
      '<div style="border:1px solid var(--line);border-radius:12px;padding:14px"><b style="font-family:var(--f-disp)">'+esc(t.name)+' send</b>'+sideList(d.offP,d.offK,"off")+'<button class="btn btn-ghost btn-sm" id="tradeAddOff" style="margin-top:12px">'+CG.ic("plus",13)+'Add player / pick</button></div>'+
      '<div style="border:1px solid var(--line);border-radius:12px;padding:14px"><b style="font-family:var(--f-disp)">'+esc(partnerName)+' send</b>'+sideList(d.reqP,d.reqK,"req")+'<button class="btn btn-ghost btn-sm" id="tradeAddReq"'+(d.partner?"":" disabled")+' style="margin-top:12px">'+CG.ic("plus",13)+'Add player / pick</button></div>'+
    '</div>'+
    '<label class="fld" style="margin-top:14px"><span>Note to the other club (optional)</span><input id="tradeNote" placeholder="Why this works for both sides…"></label>'+
    '<button class="btn btn-chrome" id="tradePropose">Propose to '+(d.partner?esc(CG.TEAM[d.partner].code):"club")+'</button>'+
    '<p class="caption" style="margin-top:10px">The offer goes to the other club’s management and only executes when they accept. Owner/GM/AGM can’t be traded.</p>'+
  '</div></div>';
  return h+inc+outCard+build;
};
CG.tradePicker = function(side){
  var d=CG.liveTrade(), code = side==="off" ? CG.myClub() : d.partner;
  if(!code){ CG.toast("Choose a partner first","err"); return; }
  var alreadyP = side==="off"? d.offP : d.reqP, alreadyK = side==="off"? d.offK : d.reqK;
  var players=CG.tRoster(code).filter(function(p){ return alreadyP.indexOf(p.id)<0; });
  var picks=CG.tPicks(code).filter(function(k){ return alreadyK.indexOf(k.id)<0; });
  var pHtml=players.map(function(p){ return '<button class="gamecard" data-tpick-p="'+p.id+'" style="grid-template-columns:auto 1fr auto;text-align:left;cursor:pointer;width:100%"><span class="nf-ic">'+CG.crest(p.team,20)+'</span><span style="min-width:0"><b>'+esc(p.tag)+'</b><span class="caption" style="display:block">'+p.pos+'</span></span><span><b>'+CG.fmtMoney(p.salary)+'</b></span></button>'; }).join("");
  var kHtml=picks.map(function(k){ return '<button class="gamecard" data-tpick-k="'+k.id+'" style="grid-template-columns:auto 1fr;text-align:left;cursor:pointer;width:100%"><span class="nf-ic">'+CG.ic("db",16)+'</span><span><b>'+esc(CG.pickLabel(k))+' pick</b><span class="caption" style="display:block">round '+k.round+'</span></span></button>'; }).join("");
  CG.modal("Add from "+esc(CG.TEAM[code].name),'<div class="stack" style="gap:6px;max-height:360px;overflow:auto"><span class="caption">Players</span>'+(pHtml||'<span class="caption">none available</span>')+'<span class="caption" style="margin-top:8px">Draft picks</span>'+(kHtml||'<span class="caption">no tradeable picks</span>')+'</div>','<button class="btn btn-ghost" data-close>Done</button>');
  document.querySelectorAll("[data-tpick-p]").forEach(function(b){ b.addEventListener("click", function(){ (side==="off"?d.offP:d.reqP).push(this.getAttribute("data-tpick-p")); if(CG.closeOverlay)CG.closeOverlay(); CG.router(); }); });
  document.querySelectorAll("[data-tpick-k]").forEach(function(b){ b.addEventListener("click", function(){ (side==="off"?d.offK:d.reqK).push(this.getAttribute("data-tpick-k")); if(CG.closeOverlay)CG.closeOverlay(); CG.router(); }); });
};
CG.proposeTrade = function(){
  var d=CG.liveTrade(), club=CG.myClub();
  if(!d.partner){ CG.toast("Choose a partner club","err"); return; }
  if((!d.offP.length&&!d.offK.length)||(!d.reqP.length&&!d.reqK.length)){ CG.toast("Add at least one player or pick on each side","err"); return; }
  var payload={ season_id:CG.SEASON.id, from_team_id:CG.lg._codeToId[club], to_team_id:CG.lg._codeToId[d.partner], from_profile_id:CG.auth.user.id,
    offered_profile_ids:d.offP, requested_profile_ids:d.reqP, offered_pick_ids:d.offK, requested_pick_ids:d.reqK, retention:d.ret||{}, note:((document.getElementById("tradeNote")||{}).value||"").trim()||null };
  CG.sb.from("trades").insert(payload).then(function(r){
    if(r.error){ CG.toast("Couldn’t propose: "+r.error.message,"err"); return; }
    CG._liveTrade={partner:null,offP:[],reqP:[],offK:[],reqK:[],ret:{}};
    CG.toast("Trade proposed to "+CG.TEAM[d.partner].name,"ok"); CG.refreshTrades();
  });
};
CG.acceptTrade = function(id){ CG.confirm("Accept this trade?","The players and picks change hands immediately and it’s logged. Make sure the deal clears your cap.","Accept trade", function(){ CG.sb.rpc("accept_trade",{ p_trade:id }).then(function(r){ if(r.error) CG.toast("Couldn’t accept: "+r.error.message,"err"); else { CG.toast("Trade accepted!","ok"); CG.refreshTrades(); } }); }); };
CG.declineTrade = function(id){ CG.sb.from("trades").update({ status:"declined", updated_at:new Date().toISOString() }).eq("id",id).then(function(r){ if(r.error) CG.toast("Couldn’t decline: "+r.error.message,"err"); else { CG.toast("Offer declined","ok"); CG.refreshTrades(); } }); };
CG.cancelTrade = function(id){ CG.sb.from("trades").update({ status:"cancelled", updated_at:new Date().toISOString() }).eq("id",id).then(function(r){ if(r.error) CG.toast("Couldn’t withdraw: "+r.error.message,"err"); else { CG.toast("Offer withdrawn","ok"); CG.refreshTrades(); } }); };
CG.counterTrade = function(id){
  var tr=(CG.lg._myTrades||[]).find(function(x){ return x.id===id; }); if(!tr) return;
  CG._liveTrade={ partner:CG.lg._idToCode[tr.from_team_id], offP:(tr.requested_profile_ids||[]).slice(), reqP:(tr.offered_profile_ids||[]).slice(), offK:(tr.requested_pick_ids||[]).slice(), reqK:(tr.offered_pick_ids||[]).slice(), ret:{} };
  CG.toast("Loaded their offer to counter — adjust and propose","ok"); CG.router();
};
CG.AFTER._tradehubLive = function(qs){
  if(qs && qs.add){ var dd=CG.liveTrade(); if(dd.offP.indexOf(qs.add)<0) dd.offP.push(qs.add); location.hash="#/hub/tradehub"; return; }
  var ps=document.getElementById("tradePartner"); if(ps) ps.addEventListener("change", function(){ var d=CG.liveTrade(); if(d.partner!==this.value){ d.reqP=[]; d.reqK=[]; } d.partner=this.value||null; CG.router(); });
  var ao=document.getElementById("tradeAddOff"); if(ao) ao.addEventListener("click", function(){ CG.tradePicker("off"); });
  var ar=document.getElementById("tradeAddReq"); if(ar) ar.addEventListener("click", function(){ CG.tradePicker("recv"); });
  document.querySelectorAll("[data-trade-rm]").forEach(function(b){ b.addEventListener("click", function(){ var parts=this.getAttribute("data-trade-rm").split(":"), d=CG.liveTrade(), map={offp:"offP",offk:"offK",reqp:"reqP",reqk:"reqK"}, arr=d[map[parts[0]]]; if(arr){ var i=arr.indexOf(parts[1]); if(i>=0) arr.splice(i,1); } CG.router(); }); });
  var clr=document.getElementById("tradeClear"); if(clr) clr.addEventListener("click", function(){ CG._liveTrade={partner:null,offP:[],reqP:[],offK:[],reqK:[],ret:{}}; CG.router(); });
  var pr=document.getElementById("tradePropose"); if(pr) pr.addEventListener("click", CG.proposeTrade);
  document.querySelectorAll("[data-trade-accept]").forEach(function(b){ b.addEventListener("click", function(){ CG.acceptTrade(this.getAttribute("data-trade-accept")); }); });
  document.querySelectorAll("[data-trade-decline]").forEach(function(b){ b.addEventListener("click", function(){ CG.declineTrade(this.getAttribute("data-trade-decline")); }); });
  document.querySelectorAll("[data-trade-cancel]").forEach(function(b){ b.addEventListener("click", function(){ CG.cancelTrade(this.getAttribute("data-trade-cancel")); }); });
  document.querySelectorAll("[data-trade-counter]").forEach(function(b){ b.addEventListener("click", function(){ CG.counterTrade(this.getAttribute("data-trade-counter")); }); });
};
/* route the Team HQ Trade Hub to the live version */
CG._protoTradeHub = CG.hubTradeHub;
CG.hubTradeHub = function(qs){ return CG.LIVE_MODE ? CG.hubTradeHubLive(qs) : CG._protoTradeHub(qs); };
CG._protoTradeAfter = CG.AFTER._tradehub;
CG.AFTER._tradehub = function(qs){ if(CG.LIVE_MODE) return CG.AFTER._tradehubLive(qs); return CG._protoTradeAfter?CG._protoTradeAfter(qs):undefined; };

/* ---------- async boot (replaces the sync CG.boot for the live build) ---------- */
CG.bootLive = async function(){
  var app = document.getElementById("app");
  if (app) app.innerHTML =
    '<section class="sec"><div class="shell"><div class="empty" style="padding:90px 20px">'+
    '<div class="e-art">'+(CG.ic?CG.ic("db",22):"")+'</div><b>Loading the league…</b>'+
    '<p>Pulling live teams, rosters, and the schedule from the league database.</p></div></div></section>';
  try {
    CG.lg = await CG.buildLiveLeague();
    /* surface Register in the nav while the open season is taking sign-ups */
    if (CG.SEASON && CG.SEASON.registration_open && CG.NAV && !CG.NAV.some(function(n){ return n[1]==="#/register"; })){
      CG.NAV.push(["Register","#/register"]);
    }
    await CG.initAuth();
    /* signed-in extras: Messages in the account drawer's reach (nav link) */
    if (CG.auth.user && CG.NAV && !CG.NAV.some(function(n){ return n[1]==="#/messages"; })){
      CG.NAV.push(["Messages","#/messages"]);
    }
    /* Pre-season central in the Control Center (commissioner) */
    if (CG.ADMIN_NAV && CG.ADMIN_NAV[0] && !CG.ADMIN_NAV[0][1].some(function(it){ return it[0]==="preseason"; })){
      CG.ADMIN_NAV[0][1].splice(1, 0, ["preseason","Pre-season","users"]);
    }
    /* Leagues & tiers at the top of the League group (commissioner) */
    if (CG.ADMIN_NAV && CG.ADMIN_NAV[1] && !CG.ADMIN_NAV[1][1].some(function(it){ return it[0]==="leagues"; })){
      CG.ADMIN_NAV[1][1].splice(0, 0, ["leagues","Leagues & tiers","trophy"]);
    }
    /* Teams (add/edit/remove clubs) right after Leagues & tiers */
    if (CG.ADMIN_NAV && CG.ADMIN_NAV[1] && !CG.ADMIN_NAV[1][1].some(function(it){ return it[0]==="clubs"; })){
      CG.ADMIN_NAV[1][1].splice(1, 0, ["clubs","Teams","grid"]);
    }
    /* EA stats replaces manual Results entry in the Operations group (stats auto-import) */
    if (CG.ADMIN_NAV && CG.ADMIN_NAV[0] && !CG.ADMIN_NAV[0][1].some(function(it){ return it[0]==="eastats"; })){
      var ops = CG.ADMIN_NAV[0][1], replaced = false;
      for (var oi=0; oi<ops.length; oi++){ if (ops[oi][0]==="results"){ ops[oi] = ["eastats","EA stats","chart"]; replaced = true; break; } }
      if (!replaced) ops.splice(2, 0, ["eastats","EA stats","chart"]);
    }
  } catch(e){
    CG.LIVE.error = String(e && e.message || e);
    if (app) app.innerHTML =
      '<section class="sec"><div class="shell"><div class="empty" style="padding:80px 20px">'+
      '<div class="e-art">'+(CG.ic?CG.ic("flag",22):"")+'</div><b>Couldn’t load live data</b>'+
      '<p>'+(CG.esc?CG.esc(CG.LIVE.error):CG.LIVE.error)+'</p></div></div></section>';
    return;
  }
  CG.renderChrome();
  if (!location.hash) location.hash = "#/home";
  CG.router();
};

if (document.readyState === "loading")
  document.addEventListener("DOMContentLoaded", function(){ CG.bootLive(); });
else
  CG.bootLive();
