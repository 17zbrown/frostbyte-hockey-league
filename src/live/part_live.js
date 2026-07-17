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

/* PostgREST caps a single response at 1,000 rows and truncates silently. Any table that
   grows past that (game_stats ~12 rows/final crosses it around week 3) must be paged, or box
   scores, season totals, leaders, and the career/eligibility counts quietly undercount.
   Returns a Supabase-shaped {data,error} so callers are unchanged. */
CG.sbAll = async function(table, sel, orderCol, ascending, filterFn){
  var page=1000, from=0, out=[], asc = ascending!==false;
  try {
    while (true){
      var qb = CG.sb.from(table).select(sel||"*");
      if (filterFn) qb = filterFn(qb);
      if (orderCol) qb = qb.order(orderCol,{ ascending:asc });
      var r = await qb.range(from, from+page-1);
      if (r.error) return { data: out.length?out:null, error: r.error };
      var rows = r.data||[];
      out = out.concat(rows);
      if (rows.length < page) break;
      from += page;
      if (from > 500000) break;   /* hard safety valve */
    }
  } catch(e){ return { data:null, error:e }; }
  return { data: out, error: null };
};

CG.buildLiveLeague = async function(){
  var sb = CG.sb;
  if (!sb) throw new Error("Supabase client unavailable");
  var q = await Promise.all([
    sb.from("teams").select("*"),
    sb.from("divisions").select("*").order("sort_order"),
    sb.from("seasons").select("*").order("number", { ascending:false }),
    sb.from("profiles").select("*"),
    CG.sbAll("roster_spots","*","id"),
    CG.sbAll("contracts","*","id"),
    CG.sbAll("games","*","scheduled_at"),
    CG.sbAll("transactions","*","occurred_at",false),
    sb.from("news").select("*").order("published_at", { ascending:false }),
    sb.from("draft_picks").select("id,season_number,round,original_team_id,current_team_id,player_id,used,overall_pick,skipped").order("season_number").order("round"),
    sb.from("season_registrations").select("id,profile_id,season_id,status,position,scout_ovr,created_at, profiles(gamertag,ea_id)"),
    sb.from("leagues").select("*").order("sort_order"),
    CG.sbAll("game_stats","*","id"),
    sb.from("feature_flags").select("key,enabled"),
    sb.from("site_config").select("key,value"),
    sb.from("suspensions").select("*").order("created_at",{ ascending:false })
  ]);
  /* first 9 are public-readable and required; draft_picks + season_registrations
     (9,10) are manager-gated by RLS and fail for guests — optional here, reloaded
     after auth for managers. leagues (11) + game_stats (12) are public but non-fatal. */
  var bad = q.slice(0,9).find(function(r){ return r.error; });
  if (bad) throw new Error(bad.error.message || "query failed");
  CG._seasonsRaw = (q[2].data||[]);
  var teamsRaw=q[0].data||[], divisions=q[1].data||[], season=(q[2].data||[])[0]||null,
      profiles=q[3].data||[], roster=q[4].data||[], contracts=q[5].data||[],
      games=q[6].data||[], transactions=q[7].data||[], news=q[8].data||[],
      draftPicks=(q[9]&&!q[9].error&&q[9].data)||[], registrations=(q[10]&&!q[10].error&&q[10].data)||[],
      leaguesRaw=(q[11]&&!q[11].error&&q[11].data)||[],
      gameStatsRows=(q[12]&&!q[12].error&&q[12].data)||[],
      flagsRaw=(q[13]&&!q[13].error&&q[13].data)||[],
      siteCfgRaw=(q[14]&&!q[14].error&&q[14].data)||[],
      suspRaw=(q[15]&&!q[15].error&&q[15].data)||[];

  /* public config: feature flags (homepage modules etc.) + site_config (rankings override) */
  CG._flags = {}; flagsRaw.forEach(function(f){ CG._flags[f.key] = !!f.enabled; });
  CG._siteCfg = {}; siteCfgRaw.forEach(function(r){ CG._siteCfg[r.key] = r.value; });
  CG.modOn = function(key){
    var f = CG._flags["home_"+key];
    return f===undefined ? true : f;
  };

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
  CG._divisionsRaw = divisions;

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
        onBlock: !!rs.on_block, status: rs.status || "active", origin: rs.origin || "assigned"
      };
    })
    .filter(Boolean);

  var byTeam={}; CG.TEAMS.forEach(function(t){ byTeam[t.code]=[]; });
  players.forEach(function(p){ (byTeam[p.team]=byTeam[p.team]||[]).push(p); });

  /* ---- schedule + results ----
     Scoped to the CURRENT season: standings, stats, eligibility floors, and the
     playoff bracket must never blend a past season's games into this one.
     (career games still span every season via game_stats below.) */
  var schedule = games.filter(function(g){ return !seasonId || g.season_id===seasonId; }).map(function(g){
    return { id:g.id, week:g.week||1, stage:g.stage||"regular",
      home:id2code[g.home_team_id], away:id2code[g.away_team_id],
      at:Date.parse(g.scheduled_at), feature:false,
      code:g.game_code||null, server:g.server||null, status:g.status,
      homeScore:g.home_score, awayScore:g.away_score, ot:!!g.went_ot,
      forfeit:g.forfeit_team_id?id2code[g.forfeit_team_id]:null, voided:!!g.voided,
      eaMatchId:g.ea_match_id||null };
  }).filter(function(g){ return g.home && g.away && g.at; });

  /* weeks-played counts, per stage. The engine uses CG.SEASON.completedWeeks two
     ways: to regress ratings under small samples (should see every stage) and to
     mint weekly honors (must only ever see regular-season weeks) — so each
     aggregate pass below gets the count that matches the results it consumes. */
  var preWkSet={}, allWkSet={}, regMaxWk=0;
  schedule.forEach(function(g){
    if (g.status!=="final") return;
    var st=g.stage||"regular", w=g.week||1;
    allWkSet[st+":"+w]=1;
    if (st==="preseason") preWkSet[w]=1;
    else if (st!=="playoff") regMaxWk=Math.max(regMaxWk,w);
  });
  var preWeeksDone=Object.keys(preWkSet).length, allWeeksDone=Object.keys(allWkSet).length;
  CG.SEASON.completedWeeks = regMaxWk;

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
    .filter(function(g){ return g.status==="final" && !g.voided && g.homeScore!=null && g.awayScore!=null; })
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
      return { id:g.id, week:g.week, stage:g.stage, home:g.home, away:g.away, at:g.at,
        ot:g.ot, score:score, box:box, stars:stars, entered:true };
    });

  /* stage split: pre-season keeps its own standings and player lines, the regular
     season owns the league standings, and overalls/parts see every game played */
  var preResults = results.filter(function(r){ return r.stage==="preseason"; });
  var regResults = results.filter(function(r){ return r.stage!=="preseason" && r.stage!=="playoff"; });
  /* discipline record straight from the suspensions table (newest first) */
  var suspMapped = suspRaw.map(function(sx){
    var by = profById[sx.created_by];
    return { id:sx.id, playerId:sx.profile_id,
      status: sx.status==="active" ? "active" : "served",
      games: sx.games_total||0, mode: sx.mode, endsAt: sx.ends_at,
      reason: sx.reason||"", issued: sx.created_at,
      decidedBy: (by && (by.gamertag||by.display_name)) || "Commissioner" };
  });
  /* playoff series (the schedule above is already this season only), plus the
     public clinch list so the projected bracket can lock in confirmed clubs */
  var playoffGames = schedule.filter(function(g){ return g.stage==="playoff"; });
  var clinched = (CG._siteCfg && CG._siteCfg["clinched_"+((season&&season.number)||1)]) || [];
  var lg = { players:players, byTeam:byTeam, schedule:schedule, results:regResults,
             allResults:results, playoffGames:playoffGames, clinched:clinched,
             suspensions:suspMapped, demoNow:CG.now(), season:season, live:true };
  if (preResults.length){
    CG.SEASON.completedWeeks = preWeeksDone;
    lg.results = preResults; CG.aggregate(lg, {});
    lg.pre = { teams: lg.teams, pstats: lg.pstats, glog: lg.glog, results: preResults };
    CG.SEASON.completedWeeks = allWeeksDone;
    lg.results = results; CG.aggregate(lg, {});      /* every stage -> ratings */
    var ratingsAll = lg.ratings, teamRatingsAll = lg.teamRatings;
    CG.SEASON.completedWeeks = regMaxWk;             /* honors only ever see regular weeks */
    lg.results = regResults; CG.aggregate(lg, {});   /* regular season -> standings + stats */
    lg.ratings = ratingsAll;
    if (teamRatingsAll) lg.teamRatings = teamRatingsAll;
  } else {
    CG.aggregate(lg, {});
  }

  /* draft-eligibility bookkeeping: pre-season games played this cycle, career
     games across every season, and who has already been through a draft */
  var preFinalIds={};
  schedule.forEach(function(g){ if(g.stage==="preseason" && g.status==="final") preFinalIds[g.id]=1; });
  var preGp={}, careerGp={};
  gameStatsRows.forEach(function(r){
    if (!r.profile_id) return;
    careerGp[r.profile_id]=(careerGp[r.profile_id]||0)+1;
    if (preFinalIds[r.game_id]){
      var pgo=preGp[r.profile_id]=preGp[r.profile_id]||{gp:0,g:0,a:0};
      pgo.gp++; pgo.g+=(+r.goals||0); pgo.a+=(+r.assists||0);
    }
  });
  var draftedEver={};
  draftPicks.forEach(function(p){ if(p.player_id) draftedEver[p.player_id]=true; });
  var priorSeason={};
  roster.forEach(function(rs){ if(seasonId && rs.season_id!==seasonId) priorSeason[rs.profile_id]=true; });
  lg.preGp=preGp; lg.careerGp=careerGp;
  /* veteran = been drafted, rostered in a prior season, or 5+ career games */
  lg.isVeteran = function(pid){ return !!(draftedEver[pid] || priorSeason[pid] || (careerGp[pid]||0)>=5); };

  /* extend season stat lines with EA-only advanced metrics (base G/A/P/etc. came
     from the box above via CG.aggregate; these power the advanced leaders + profiles) */
  if (gameStatsRows.length){
    var finalIds = {}; regResults.forEach(function(r){ finalIds[r.id]=true; });
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
  if (regResults.length){
    var prOrder = function(exclFromWeek){
      var s = {};
      CG.TEAMS.forEach(function(t){
        var pts=0, gp=0, diff=0, seq=[];
        regResults.forEach(function(r){
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
    var prMaxWk = regResults.reduce(function(m,r){ return Math.max(m, r.week||1); }, 1);
    var prNow = prOrder(null), prPrev = prOrder(prMaxWk);
    lg.powerRankings = prNow.map(function(code,i){
      var was = prPrev.indexOf(code)+1;
      return { rank:i+1, prev:was, team:code, move:was-(i+1) };
    });
  }
  /* commissioner's manual ranking override (site_config) — applies only while it
     covers the current club list exactly; otherwise the computed order stands */
  var prOv = CG._siteCfg && CG._siteCfg.power_rankings_override;
  if (prOv && Array.isArray(prOv.order)){
    var codesNow = CG.TEAMS.map(function(t){ return t.code; }).sort().join(",");
    var codesOv = prOv.order.slice().sort().join(",");
    if (codesNow===codesOv){
      var autoRank = {}; (lg.powerRankings||[]).forEach(function(p){ autoRank[p.team]=p.rank; });
      lg.powerRankings = prOv.order.map(function(code,i){
        return { rank:i+1, prev:autoRank[code]||i+1, team:code, move:(autoRank[code]||i+1)-(i+1) };
      });
      lg.prManual = true;
    }
  }

  /* ---- availability window from the REAL schedule (replaces the prototype's
     hardcoded "Week 8") — the next week with games; deadline Sunday 8 PM ET ---- */
  var futureG = schedule.filter(function(g){ return g.status!=="final" && g.at > CG.now()-6*3600000; })
    .sort(function(a,b){ return a.at-b.at; });
  if (futureG.length){
    var avWk = futureG[0].week || 1, avStage = futureG[0].stage || "regular";
    var byNight = {};
    futureG.filter(function(g){ return (g.week||1)===avWk && (g.stage||"regular")===avStage; }).forEach(function(g){
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
    CG.WEEK8 = { key:(avStage==="preseason"?"pre":avStage==="playoff"?"po":"w")+avWk,
      label:(avStage==="preseason"?"Pre-season week ":avStage==="playoff"?"Playoff week ":"Week ")+avWk,
      deadline: Date.parse(dlDay+"T20:00:00-04:00"),
      nights: [ { key:"n1", at:nights[0] }, { key:"n2", at:nights[1] } ] };
  }
  /* real data: no fabricated availability — unanswered means unanswered */
  CG.avFor = function(playerId){
    var saved = CG.availGet(playerId);
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
  /* current season only — a spot in a past season must not block this season's pool */
  lg._rosteredIds = {}; roster.forEach(function(rs){ if(!seasonId || rs.season_id===seasonId) lg._rosteredIds[rs.profile_id] = true; });
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
    try { var sa = await CG.sb.from("staff_applications").select("*").eq("profile_id", CG.auth.user.id).maybeSingle(); CG.auth.staffApp = sa.data || null; }
    catch(e){ CG.auth.staffApp = null; }
    try { var oa = await CG.sb.from("owner_applications").select("*").eq("profile_id", CG.auth.user.id).maybeSingle(); CG.auth.ownerApp = oa.data || null; }
    catch(e){ CG.auth.ownerApp = null; }
  } else { CG.auth.profile = null; CG.auth.registration = null; CG.auth.ownerApp = null; }
  CG.auth.role = CG.computeRole(CG.auth.profile);
  await CG.loadManagerData();
  await Promise.all([CG.loadAvailability(), CG.loadTrades()]);
  /* direct messages: load + subscribe on sign-in, tear down on sign-out */
  if (CG.auth.user){ CG.loadDMs().then(function(){ CG.subscribeDMs(); if(CG.renderChrome)CG.renderChrome(); if(location.hash.indexOf("/messages")>=0&&CG.router)CG.router(); }); }
  else { CG.teardownDMs && CG.teardownDMs(); }
  /* complaints & requests (league office) — RLS returns what this user may see */
  if (CG.auth.user){ CG.loadActionRequests().then(function(){ if(/complaint/.test(location.hash)&&CG.router)CG.router(); }); }
  else if (CG.lg){ CG.lg._actionReqs=[]; CG.lg._actionMsgs={}; }
  CG.enforceBan();
  CG._va = null;                        /* any fresh session ends a stale preview */
  if (CG.renderViewAsBar) CG.renderViewAsBar();
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
  var poolSeason = (CG.SEASON && CG.SEASON.id) || null;
  lg.draftPool = (registrations||[]).filter(function(r){ return !rostered[r.profile_id] && (!r.season_id || r.season_id===poolSeason); })
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
      CG.sb.from("season_registrations").select("id,profile_id,season_id,status,position,scout_ovr,note,created_at, profiles(gamertag,ea_id,platform,jersey_number)"),
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
    if (role==="commish" || role==="staff"){
      var oa = await CG.sb.from("owner_applications").select("*, profiles(gamertag)").order("created_at",{ascending:false});
      CG.lg._ownerApps = (oa && !oa.error && oa.data) || [];
      var sa2 = await CG.sb.from("staff_applications").select("*, profiles(gamertag)").order("created_at",{ascending:false});
      CG.lg._staffApps = (sa2 && !sa2.error && sa2.data) || [];
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

/* ------------------------------------------------------------------ *
 * Admin "View as…" — render any page as any role for a preview.
 * Client-only: never writes, never changes the real role. Gated on the
 * profiles.is_admin capability. All real actions still run under the real
 * account via RLS, so a preview can look but not act as someone else.
 * ------------------------------------------------------------------ */
CG.VIEW_ROLES = [
  ["guest","Signed out"], ["member","Member"], ["mgmt","Team management"], ["staff","Staff"], ["commish","Commissioner"]
];
CG.isAdmin = function(){ return !!(CG.auth && CG.auth.profile && CG.auth.profile.is_admin); };
CG.viewAs = function(role){
  if (!CG.isAdmin() && !CG._va) return;              /* admin, or already mid-preview (profile is nulled for guest) */
  if (role==null){                                   /* exit preview → restore reality */
    if (CG._va){ CG.auth.role = CG._va.role; CG.auth.profile = CG._va.profile; CG._va = null; }
  } else {
    if (!CG._va) CG._va = { role:CG.auth.role, profile:CG.auth.profile };  /* stash reality once */
    CG.auth.role = (role==="guest") ? "guest" : role;
    CG.auth.profile = (role==="guest") ? null : CG._va.profile;            /* guest = no profile */
  }
  CG.renderViewAsBar();
  if (CG.renderChrome) CG.renderChrome();
  if (CG.router) CG.router();
  window.scrollTo(0,0);
};
CG.renderViewAsBar = function(){
  var el = document.getElementById("cgViewAs");
  if (!CG.isAdmin() && !(CG._va)){ if (el) el.remove(); return; }
  if (!el){ el = document.createElement("div"); el.id = "cgViewAs"; document.body.appendChild(el); }
  var active = CG._va ? CG.auth.role : null;                 /* the role currently being previewed */
  var chips = CG.VIEW_ROLES.map(function(r){
    var on = active===r[0];
    return '<button type="button" data-va="'+r[0]+'" aria-pressed="'+on+'" class="cgva-chip'+(on?" on":"")+'">'+r[1]+'</button>';
  }).join("");
  el.className = CG._va ? "previewing" : "";
  el.innerHTML =
    '<div class="cgva-inner">'+
      '<span class="cgva-tag">'+(CG._va?CG.ic("eye",13)+' Previewing':CG.ic("eye",13)+' View as')+'</span>'+
      '<span class="cgva-chips">'+chips+'</span>'+
      (CG._va?'<button type="button" class="cgva-exit" data-va-exit>Exit preview</button>':'')+
      (CG._va?'<span class="cgva-note">Actions still use your real account.</span>':'')+
    '</div>';
  el.querySelectorAll("[data-va]").forEach(function(b){ b.addEventListener("click", function(){
    var r=this.getAttribute("data-va"); CG.viewAs(active===r?null:r);
  }); });
  var ex=el.querySelector("[data-va-exit]"); if(ex) ex.addEventListener("click", function(){ CG.viewAs(null); });
};
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
  statusCard = CG.roadAheadCard(s) + statusCard;
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
/* every active NHL franchise (2026 / NHL 27 names) — the owner-application pool */
CG.NHL_FRANCHISES = [
  "Anaheim Ducks","Boston Bruins","Buffalo Sabres","Calgary Flames","Carolina Hurricanes",
  "Chicago Blackhawks","Colorado Avalanche","Columbus Blue Jackets","Dallas Stars","Detroit Red Wings",
  "Edmonton Oilers","Florida Panthers","Los Angeles Kings","Minnesota Wild","Montreal Canadiens",
  "Nashville Predators","New Jersey Devils","New York Islanders","New York Rangers","Ottawa Senators",
  "Philadelphia Flyers","Pittsburgh Penguins","San Jose Sharks","Seattle Kraken","St. Louis Blues",
  "Tampa Bay Lightning","Toronto Maple Leafs","Utah Mammoth","Vancouver Canucks","Vegas Golden Knights",
  "Washington Capitals","Winnipeg Jets"
];
/* franchises already fielded as active league clubs (matched by name) */
CG.activeFranchiseSet = function(){
  var set = {};
  (CG.TEAMS||[]).forEach(function(t){ if(t.name) set[t.name] = t.code; });
  return set;
};
CG.franchiseOptions = function(selected){
  var active = CG.activeFranchiseSet();
  return '<option value="">Choose a franchise…</option>'+CG.NHL_FRANCHISES.map(function(name){
    var taken = active[name];
    return '<option value="'+esc(name)+'"'+(selected===name?" selected":"")+'>'+esc(name)+(taken?" · already an active club":"")+'</option>';
  }).join("");
};
/* review-card line: the ranked franchise choices, flagging any already taken */
CG.franchisePicksLine = function(a){
  var active = CG.activeFranchiseSet();
  var picks = [a.preferred_club, a.franchise_2, a.franchise_3].filter(Boolean);
  if (!picks.length) return '<span>No franchise selected</span>';
  return '<span>Franchise: '+picks.map(function(name,i){
    return '<b>'+["1st","2nd","3rd"][i]+' '+esc(name)+'</b>'+(active[name]?' <span class="chip chip-warn" style="font-size:8px;padding:1px 5px">taken</span>':"");
  }).join(" · ")+'</span>';
};
CG.ROUTES.owner = function(){
  var head = CG.pageHead("Run a club","Apply to own a team",
    "Owners set their club’s identity, hire a GM, and build the roster. Applications are tied to your Discord so the commissioners know who applied. Rather officiate than own? Apply to join the staff instead.");
  if (!CG.auth.profile){
    return head + '<div class="shell" style="max-width:640px;padding-bottom:48px"><div class="card"><div class="empty" style="padding:60px 20px">'+
      '<div class="e-art">'+CG.ic("shield",22)+'</div><b>Sign in to apply</b>'+
      '<p>Owner applications are tied to your Discord account so the commissioners know who applied.</p>'+
      '<button class="btn btn-lg" id="dcSignIn" style="margin-top:18px;background:#5865F2;color:#fff">'+CG.DISCORD_GLYPH+'Sign in with Discord</button></div></div></div>';
  }
  var p = CG.auth.profile, a = CG.auth.ownerApp||{};
  var r = CG.role(), lockedFromOwning = (r==="staff" || r==="commish");
  var conflictNote = lockedFromOwning
    ? '<div class="note" style="margin-bottom:18px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">'+CG.ic("shield",15)+
      '<span style="flex:1">'+(r==="commish"?"Commissioners":"Staff")+' can’t own or manage a club — it keeps roster and management decisions impartial. You’re welcome to play as a rostered member; ownership applications are disabled for your role.</span></div>'
    : "";
  var statusCard = CG.auth.ownerApp ? '<div class="note '+(a.status==="approved"?"grn":a.status==="denied"?"red":"chr")+'" style="margin-bottom:18px"><b style="font-family:var(--f-disp)">Your application is '+esc((a.status||"pending").toUpperCase())+'.</b> Resubmit below to update it — the commissioners review every application.</div>' : "";
  statusCard = conflictNote + statusCard;
  var body = '<div class="card"><div class="card-h"><h3>'+(CG.auth.ownerApp?"Update application":"Owner application")+'</h3><span class="chip chip-chrome">Season</span></div><div class="card-b">'+
    '<label class="fld"><span>EA ID *</span><input id="ow-ea" placeholder="Your EA account name" value="'+esc(a.ea_id||p.ea_id||"")+'"></label>'+
    '<label class="fld"><span>Typical availability</span><input id="ow-avail" placeholder="e.g. Weeknights after 9 PM ET" value="'+esc(a.availability||"")+'"></label>'+
    '<label class="fld"><span>League / management experience</span><textarea id="ow-exp" rows="2" placeholder="Leagues you’ve played or managed in…">'+esc(a.experience||"")+'</textarea></label>'+
    '<div class="fld"><span>Franchise choices *</span><p class="caption" style="margin:2px 0 8px">Pick the NHL franchises you’d most like to run, in order. Your second and third choices cover you if an earlier pick is already an active club.</p>'+
      '<div class="grid g3" style="gap:10px">'+
        '<label class="fld"><span style="font-size:11px">1st choice *</span><select id="ow-fr1">'+CG.franchiseOptions(a.preferred_club)+'</select></label>'+
        '<label class="fld"><span style="font-size:11px">2nd choice</span><select id="ow-fr2">'+CG.franchiseOptions(a.franchise_2)+'</select></label>'+
        '<label class="fld"><span style="font-size:11px">3rd choice</span><select id="ow-fr3">'+CG.franchiseOptions(a.franchise_3)+'</select></label>'+
      '</div></div>'+
    '<label class="fld"><span>Why you? (pitch) *</span><textarea id="ow-pitch" rows="4" placeholder="Tell the commissioners why you’d make a great owner…">'+esc(a.pitch||"")+'</textarea></label>'+
    '<button class="btn btn-chrome" id="ow-submit"'+(lockedFromOwning?" disabled":"")+'>'+(CG.auth.ownerApp?"Update application":"Submit application")+'</button>'+
  '</div></div>';
  return head + '<div class="shell" style="max-width:720px;padding-bottom:48px">'+statusCard+body+'</div>';
};
CG.AFTER.owner = function(){
  var dc=document.getElementById("dcSignIn"); if(dc) dc.addEventListener("click", function(){ CG.signIn(); });
  var sub=document.getElementById("ow-submit"); if(sub) sub.addEventListener("click", CG.submitOwnerApp);
};
CG.submitOwnerApp = async function(){
  if(!CG.sb||!CG.auth.user){ CG.toast("Sign in first","err"); return; }
  var r0=CG.role();
  if(r0==="commish"||r0==="staff"){ CG.toast((r0==="commish"?"Commissioners":"Staff")+" can’t own or manage a club — you can still play as a member","err"); return; }
  function v(id){ var el=document.getElementById(id); return el?(el.value||"").trim():""; }
  function sv(id){ var el=document.getElementById(id); return el?(el.value||"").trim()||null:null; }
  var ea=v("ow-ea"), pitch=v("ow-pitch");
  var fr1=sv("ow-fr1"), fr2=sv("ow-fr2"), fr3=sv("ow-fr3");
  if(!ea){ CG.toast("EA ID is required","err"); return; }
  if(!fr1){ CG.toast("Pick at least a first-choice franchise","err"); return; }
  if(!pitch){ CG.toast("Add a short pitch","err"); return; }
  var picks=[fr1,fr2,fr3].filter(Boolean);
  if(new Set(picks).size!==picks.length){ CG.toast("Your franchise choices must be different","err"); return; }
  var payload={ season_id: CG.SEASON?CG.SEASON.id:null, profile_id: CG.auth.user.id, ea_id:ea,
    availability:v("ow-avail")||null, experience:v("ow-exp")||null,
    preferred_club:fr1, franchise_2:fr2, franchise_3:fr3,
    pitch:pitch, status:"pending", updated_at:new Date().toISOString() };
  var r=await CG.sb.from("owner_applications").upsert(payload,{onConflict:"profile_id"});
  if(r.error){ CG.toast("Couldn’t submit: "+r.error.message,"err"); return; }
  CG.auth.ownerApp=payload; CG.toast("Application submitted — the commissioners will review it","ok"); CG.router();
};

/* ================================================================
   STAFF APPLICATIONS — members apply; staff + commissioners decide
   from the Staff Desk. Approval promotes to role='staff' (the
   Discord Staff role follows on the next sync).
   ================================================================ */
/* the league office's departments — what a staff applicant can sign up to work */
CG.STAFF_DEPARTMENTS = [
  ["officiating","Officiating","Game-night disputes, forfeits, and rule calls"],
  ["statistics","Statistics","Spot-check the EA imports and keep the record clean"],
  ["player-relations","Player relations","Work the complaint and appeal case queue"],
  ["media","Media & broadcast","News, recaps, and stream nights"]
];
CG.ROUTES.staffapply = function(){
  var head = CG.pageHead("Join the league office","Apply to join the staff",
    "Staff work the case queue, verify imported stats, and keep game nights honest. Applications are tied to your Discord account.");
  if (!CG.auth.profile){
    return head + '<div class="shell" style="max-width:640px;padding-bottom:48px"><div class="card"><div class="empty" style="padding:60px 20px">'+
      '<div class="e-art">'+CG.ic("flag",22)+'</div><b>Sign in to apply</b>'+
      '<p>Staff applications are tied to your Discord account so the league knows who applied.</p>'+
      '<button class="btn btn-lg" id="dcSignIn" style="margin-top:18px;background:#5865F2;color:#fff">'+CG.DISCORD_GLYPH+'Sign in with Discord</button></div></div></div>';
  }
  var r = CG.role();
  /* Role separation: commissioners can't be staff, and staff are already staff — so neither
     submits here. They still see the exact form members see (Control Center → View as… is the
     cleaner preview). The Staff Desk stays one click away. */
  var lockedFromStaff = (r==="staff" || r==="commish");
  var staffNote = lockedFromStaff
    ? '<div class="note" style="margin-bottom:18px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">'+CG.ic("shield",15)+
      '<span style="flex:1">'+(r==="commish"
        ? 'Commissioners can’t join the staff — it keeps rulings impartial. This is the form exactly as members see it; submitting is disabled for you.'
        : 'You’re already on the league staff. This is the form exactly as members see it; there’s nothing to submit.')+'</span>'+
      '<a class="btn btn-ghost btn-sm" href="#/hub/staffdesk">Staff Desk</a></div>'
    : "";
  var app = CG.auth.staffApp;
  var statusNote = app
    ? (app.status==="pending" ? '<div class="note" style="margin-bottom:18px"><b style="font-family:var(--f-disp)">Application received.</b> The league office reviews staff applications — you’ll get a notification either way. You can update yours below.</div>'
      : app.status==="denied" ? '<div class="note red" style="margin-bottom:18px"><b style="font-family:var(--f-disp)">Your last application wasn’t approved.</b> You’re welcome to update it and reapply.</div>' : "")
    : "";
  var v = function(k){ return app ? esc(app[k]||"") : ""; };
  var pickedDepts = (app && app.departments) || [];
  return head + '<div class="shell" style="max-width:640px;padding-bottom:48px">'+staffNote+statusNote+
    '<div class="card"><div class="card-h"><h3>'+(app?"Update application":"Application")+'</h3>'+
      (app?'<span class="chip '+(app.status==="pending"?"chip-warn":"chip-loss")+'" style="text-transform:capitalize">'+esc(app.status)+'</span>':'<span class="chip chip-chrome">Open</span>')+'</div><div class="card-b">'+
    '<div class="fld"><span>Departments *</span><p class="caption" style="margin:2px 0 8px">Pick every department you’d work — the league office assigns duties from here.</p>'+
      '<div class="stack" style="gap:8px">'+CG.STAFF_DEPARTMENTS.map(function(d){
        var on = pickedDepts.indexOf(d[0])>=0;
        return '<button type="button" class="gamecard" data-sa-dept="'+d[0]+'" aria-pressed="'+on+'" style="grid-template-columns:auto 1fr;text-align:left;cursor:pointer;width:100%;'+(on?"border-color:var(--chrome)":"")+'">'+
          '<span class="chip '+(on?"chip-chrome":"")+'" style="font-size:9px;align-self:center">'+(on?"IN":"—")+'</span>'+
          '<span style="min-width:0"><b style="font-family:var(--f-disp)">'+d[1]+'</b><span class="caption" style="display:block">'+d[2]+'</span></span></button>';
      }).join("")+'</div></div>'+
    '<div class="grid g2" style="gap:12px;margin-top:14px">'+
    '<label class="fld"><span>Timezone</span><input id="sa-tz" placeholder="e.g. Eastern" value="'+v("timezone")+'"></label>'+
    '<label class="fld"><span>Availability</span><input id="sa-avail" placeholder="e.g. most weeknights after 8" value="'+v("availability")+'"></label></div>'+
    '<label class="fld"><span>Relevant experience</span><input id="sa-exp" placeholder="e.g. reffed in two leagues, ran stats for…" value="'+v("experience")+'"></label>'+
    '<label class="fld"><span>Why you? <span class="caption">(required)</span></span><textarea id="sa-pitch" rows="4" placeholder="What would you bring to the league office?">'+v("pitch")+'</textarea></label>'+
    '<div style="display:flex;gap:10px;align-items:center;margin-top:14px;flex-wrap:wrap">'+
      '<button class="btn btn-chrome" id="sa-submit"'+(lockedFromStaff?" disabled":"")+'>'+(app?"Update application":"Submit application")+'</button>'+
      '<span class="caption">Staff review the queue on the <b>Staff Desk</b>; approval adds the Discord Staff role automatically.</span></div>'+
    '</div></div>'+
    '<p class="caption" style="margin-top:14px">Looking to run a club instead? <a href="#/owner" style="font-weight:700;border-bottom:2px solid var(--chrome)">Apply to own a team →</a></p>'+
  '</div>';
};
CG.AFTER.staffapply = function(){
  var dc=document.getElementById("dcSignIn"); if(dc) dc.addEventListener("click", function(){ CG.signIn(); });
  var sub=document.getElementById("sa-submit"); if(sub) sub.addEventListener("click", CG.submitStaffApp);
  document.querySelectorAll("[data-sa-dept]").forEach(function(b){ b.addEventListener("click", function(){
    var on = this.getAttribute("aria-pressed")!=="true";
    this.setAttribute("aria-pressed", on?"true":"false");
    this.style.borderColor = on ? "var(--chrome)" : "";
    var chip = this.querySelector(".chip");
    if (chip){ chip.classList.toggle("chip-chrome", on); chip.textContent = on ? "IN" : "—"; }
  }); });
};
CG.staffDeptLabel = function(key){
  var d = (CG.STAFF_DEPARTMENTS||[]).find(function(x){ return x[0]===key; });
  return d ? d[1] : key;
};
CG.submitStaffApp = async function(){
  if(!CG.sb||!CG.auth.user){ CG.toast("Sign in first","err"); return; }
  var r0=CG.role();
  if(r0==="commish"){ CG.toast("Commissioners can’t join the staff — it keeps rulings impartial","err"); return; }
  if(r0==="staff"){ CG.toast("You’re already on the league staff","err"); return; }
  function v(id){ var el=document.getElementById(id); return el?(el.value||"").trim():""; }
  var pitch=v("sa-pitch");
  var depts=[].slice.call(document.querySelectorAll('[data-sa-dept][aria-pressed="true"]')).map(function(b){ return b.getAttribute("data-sa-dept"); });
  if(!depts.length){ CG.toast("Pick at least one department","err"); return; }
  if(!pitch){ CG.toast("Tell the league office why you — the pitch is the application","err"); return; }
  var payload={ profile_id: CG.auth.user.id, departments:depts, timezone:v("sa-tz")||null, availability:v("sa-avail")||null,
    experience:v("sa-exp")||null, pitch:pitch, status:"pending", updated_at:new Date().toISOString() };
  var r=await CG.sb.from("staff_applications").upsert(payload,{onConflict:"profile_id"});
  if(r.error){ CG.toast("Couldn’t submit: "+r.error.message,"err"); return; }
  CG.auth.staffApp=payload; CG.toast("Application submitted — the league office will review it","ok"); CG.router();
};
CG.decideStaffApp = function(id, approve, name){
  CG.confirm((approve?"Approve":"Deny")+" "+esc(name)+"’s staff application?",
    approve ? "They become league staff immediately: the Staff Desk appears in their hub and the Discord Staff role lands within a few minutes."
            : "They’ll be notified and can reapply any time.",
    approve?"Approve":"Deny", function(){
    CG.sb.rpc("decide_staff_application",{ p_id:id, p_approve:approve }).then(function(r){
      if(r.error){ CG.toast("Couldn’t decide: "+r.error.message,"err"); return; }
      CG.toast(String(r.data||name)+(approve?" is now league staff":" — application denied"),"ok");
      CG.reloadLeague();
    });
  });
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
    (pool.length ? '<div class="card-b" style="padding-top:8px"><p class="caption" style="margin-bottom:10px">Registered players not yet on a roster, ranked by the commissioner’s scouted overall. Pre-season lines come from the EA box scores.</p>'+
      pool.slice(0,40).map(function(pr,i){
        var ps=(CG.lg.preGp||{})[pr.profileId], vet=CG.lg.isVeteran&&CG.lg.isVeteran(pr.profileId);
        var preLine = ps&&ps.gp ? ps.gp+" GP · "+ps.g+"G "+ps.a+"A pre-season" : "no pre-season games";
        var eligChip = vet ? "" : (ps&&ps.gp>=5 ? ' <span class="chip chip-win" style="font-size:9px">ELIGIBLE</span>'
                                                : ' <span class="chip chip-warn" style="font-size:9px">'+((ps&&ps.gp)||0)+' OF 5</span>');
        return '<div class="leaderrow" style="cursor:default"><span class="rk num">'+(i+1)+'</span>'+
          '<span style="min-width:0"><b style="font-size:13.5px">'+esc(pr.tag)+'</b>'+eligChip+'<small style="display:block" class="caption">'+(CG.POS_NAME[pr.pos]||pr.pos)+(pr.eaId?" · EA: "+esc(pr.eaId):"")+' · '+preLine+'</small></span>'+
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
/* Messages lives in the player hub; the old top-level route redirects there. */
/* ================================================================
   LIVE: AVAILABILITY (availability table) + TRADES (trades table + accept_trade)
   The prototype accessors in part6 are overridden here — one source of truth.
   ================================================================ */
CG._avail = {};
CG.loadAvailability = async function(){
  if (!CG.sb || !CG.auth.user || !CG.SEASON || !CG.SEASON.id) return;
  var sid = CG.SEASON.id;
  var r = await CG.sbAll("availability","profile_id,week_key,nights,submitted_at","week_key",true,
    function(qb){ return qb.eq("season_id", sid); });
  CG._avail = {};
  ((r && r.data) || []).forEach(function(row){
    CG._avail[row.week_key+":"+row.profile_id] = { at: Date.parse(row.submitted_at), nights: row.nights||{} };
  });
};
CG.availGet = function(pid){ return CG._avail[CG.WEEK8.key+":"+pid] || null; };
CG.availSave = function(entry, cb){
  var uid = CG.auth.user && CG.auth.user.id;
  if (!uid || !CG.SEASON || !CG.SEASON.id){ CG.toast("Sign in to submit availability","err"); if(cb)cb(false); return; }
  CG.sb.from("availability").upsert({
    season_id: CG.SEASON.id, profile_id: uid, week_key: CG.WEEK8.key,
    nights: entry.nights, submitted_at: new Date().toISOString()
  }, { onConflict: "season_id,profile_id,week_key" }).then(function(r){
    if (r.error){ CG.toast("Couldn’t save availability: "+r.error.message,"err"); if(cb)cb(false); return; }
    CG._avail[CG.WEEK8.key+":"+uid] = { at: Date.now(), nights: entry.nights };
    if (cb) cb(true);
  });
};

CG._trades = [];
CG.loadTrades = async function(){
  if (!CG.sb || !CG.auth.user || !CG.SEASON || !CG.SEASON.id) return;
  var r = await CG.sb.from("trades").select("*").eq("season_id", CG.SEASON.id).order("created_at",{ ascending:false });
  CG._trades = (r && r.data) || [];
};
CG.myManagedTeam = function(){
  var uid = (CG.auth.user && CG.auth.user.id) || ((CG.me()||{}).id);
  if (!uid) return null;
  return (CG.TEAMS||[]).find(function(t){ return t.owner===uid || t.gm===uid || t.agm===uid; }) || null;
};
/* live override: a manager with no roster spot (e.g. before the pre-season fills
   rosters) still runs THEIR club — never the alphabetical fallback */
CG.myClub = function(){
  var me = CG.me();
  if (me && me.team) return me.team;
  var t = CG.myManagedTeam();
  if (t) return t.code;
  return (CG.TEAMS[0]||{}).code || null;
};
CG.incomingOffers = function(){
  var t = CG.myManagedTeam(); if (!t) return [];
  return CG._trades.filter(function(x){ return x.to_team_id===t.id && x.status==="proposed"; })
    .map(function(x){ return { id:x.id, from:(CG.lg._idToCode||{})[x.from_team_id],
      at: Date.parse(x.created_at), give: x.offered_profile_ids||[], get: x.requested_profile_ids||[], note: x.note||"" }; })
    .filter(function(o){ return o.from; });
};
CG.outgoingOffers = function(){
  var t = CG.myManagedTeam(); if (!t) return [];
  var label = { proposed:"Sent — awaiting response", declined:"Declined", accepted:"Accepted", cancelled:"Withdrawn" };
  return CG._trades.filter(function(x){ return x.from_team_id===t.id && x.status!=="cancelled"; })
    .map(function(x){ return { id:x.id, to:(CG.lg._idToCode||{})[x.to_team_id],
      send: x.offered_profile_ids||[], recv: x.requested_profile_ids||[],
      status: label[x.status]||x.status, open: x.status==="proposed" }; })
    .filter(function(o){ return o.to; });
};
CG.sendTradeOffer = function(d, club){
  var t = CG.myManagedTeam();
  var partnerId = (CG.lg._codeToId||{})[d.partner];
  if (!t || !partnerId){ CG.toast("Couldn’t resolve the clubs for this offer","err"); return; }
  CG.sb.from("trades").insert({
    season_id: CG.SEASON.id, from_team_id: t.id, to_team_id: partnerId,
    from_profile_id: CG.auth.user.id,
    offered_profile_ids: d.send.slice(), requested_profile_ids: d.recv.slice(),
    offered_pick_ids: [], requested_pick_ids: [], retention: {},
    note: d.note || null, status: "proposed"
  }).then(function(r){
    if (r.error){ CG.toast("Couldn’t send: "+r.error.message,"err"); return; }
    CG._tradeDraft = { partner:null, send:[], recv:[] };
    CG.toast("Offer sent to "+CG.TEAM[d.partner].name+" — their management gets a notification","ok");
    CG.loadTrades().then(function(){ if(CG.renderChrome)CG.renderChrome(); CG.router(); });
  });
};
CG.acceptTradeOffer = function(id, o){
  CG.sb.rpc("accept_trade",{ p_trade:id }).then(function(r){
    if (r.error){ CG.toast("Couldn’t accept: "+r.error.message,"err"); return; }
    CG.toast("Trade completed — rosters updated for both clubs","ok");
    CG.loadTrades().then(function(){ CG.reloadLeague(); });
  });
};
CG.declineTradeOffer = function(id, o){
  CG.sb.from("trades").update({ status:"declined", updated_at:new Date().toISOString() }).eq("id",id).then(function(r){
    if (r.error){ CG.toast("Couldn’t decline: "+r.error.message,"err"); return; }
    CG.toast("Offer declined","ok");
    CG.loadTrades().then(function(){ if(CG.renderChrome)CG.renderChrome(); CG.router(); });
  });
};
CG.withdrawTradeOffer = function(id){
  CG.sb.from("trades").update({ status:"cancelled", updated_at:new Date().toISOString() }).eq("id",id).then(function(r){
    if (r.error){ CG.toast("Couldn’t withdraw: "+r.error.message,"err"); return; }
    CG.toast("Offer withdrawn","ok");
    CG.loadTrades().then(function(){ CG.router(); });
  });
};
/* trade block — a real flag on the roster spot; listings announce in #trade-block */
CG.isOnBlock = function(pid){ var p = CG.playerById(CG.lg, pid); return !!(p && p.onBlock); };
CG.setOnBlock = function(pid, on){
  var p = CG.playerById(CG.lg, pid); if (!p) return;
  p.onBlock = !!on; /* optimistic — the row below is the truth */
  CG.sb.from("roster_spots").update({ on_block: !!on })
    .eq("season_id", CG.SEASON.id).eq("profile_id", pid).then(function(r){
      if (r.error){ p.onBlock = !on; CG.toast("Couldn’t update the block: "+r.error.message,"err"); CG.router(); }
    });
};

CG.ROUTES.messages = function(){ location.hash = "#/hub/messages"; return ""; };
CG.messagesBody = function(){
  var head = '<div style="margin-bottom:20px"><span class="eyebrow chr">Direct messages</span>'+
    '<h1 class="h-sec" style="margin-top:8px">Messages</h1>'+
    '<p class="lede" style="margin-top:8px">Private messages with other league members — managers, staff, and the commissioner.</p></div>';
  if (!CG.auth.profile){
    return head + '<div class="card"><div class="empty" style="padding:60px 20px">'+
      '<div class="e-art">'+CG.ic("msg",22)+'</div><b>Sign in to message</b><p>Direct messages are tied to your Discord account.</p>'+
      '<button class="btn btn-lg" id="dcSignIn" style="margin-top:18px;background:#5865F2;color:#fff">'+CG.DISCORD_GLYPH+'Sign in with Discord</button></div></div>';
  }
  if (!CG._dm.loaded){
    return head + '<div class="card"><div class="card-b" id="dmLoading"><p class="caption">Loading conversations…</p></div></div>';
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
  return head + '<div class="card" style="padding:0;overflow:hidden">'+
    '<div class="grid" style="grid-template-columns:280px 1fr;gap:0;min-height:520px">'+
    '<div style="border-right:1px solid var(--line);overflow-y:auto;max-height:600px">'+listHtml+'</div>'+
    '<div style="display:flex;flex-direction:column">'+thread+'</div>'+
    '</div></div>';
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
  var regs=(lg._registrationsRaw||[]).filter(function(r){ return !r.season_id || r.season_id===s.id; }), apps=lg._ownerApps||[], sapps=lg._staffApps||[];
  var rosterMax=s.roster_max||15, rosteredIds=lg._rosteredIds||{};
  var assigned=regs.filter(function(r){ return rosteredIds[r.profile_id]; }).length;
  var pendingApps=apps.filter(function(a){ return a.status==="pending"; }).length;
  var h='<div style="margin-bottom:18px"><h2 class="h-sec">Pre-season central</h2>'+
    '<p class="lede" style="margin-top:6px">Registrations, owner applications, and roster building for '+esc(s.name||"the season")+'. Everything here writes to the live database.</p></div>';
  var kpis=[[regs.length,"Registered players",""],[assigned+" / "+regs.length,"Assigned to a club",""],[pendingApps,"Owner apps pending",pendingApps>0?"alert":""],[s.registration_open?"Open":"Closed","Registration",""]];
  h+='<div class="grid g4" style="grid-template-columns:repeat(auto-fill,minmax(180px,1fr));margin-bottom:20px">'+
    kpis.map(function(k){ return '<div class="kpi'+(k[2]==="alert"?" alert":"")+'" style="cursor:default"><b class="num">'+k[0]+'</b><span>'+k[1]+'</span></div>'; }).join("")+'</div>';

  /* season timeline — the phases the whole lifecycle runs on */
  var phases=[["Off-season begins",s.offseason_starts_at],["Owner apps close",s.owner_app_deadline],
    ["Sign-up deadline",s.registration_deadline],
    ["Pre-season starts",s.preseason_starts_at],["Draft night",s.draft_at],
    ["Free agency opens",s.free_agency_opens_at],["Free agency closes",s.free_agency_closes_at],
    ["Puck drop",s.starts_at],["Playoffs",s.playoffs_start_at]];
  var anyPhase = phases.some(function(p){ return p[1]; });
  h+='<div class="card" style="margin-bottom:18px"><div class="card-h"><h3>Season timeline</h3>'+
    '<a class="sec-link" href="#/admin/seasons">Edit in Seasons</a></div>'+
    (anyPhase?'<div class="card-b"><div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px">'+
      phases.map(function(p){ return '<div class="kpi" style="cursor:default"><b class="num" style="font-size:14px">'+(p[1]?CG.fmtFull(Date.parse(p[1])):"—")+'</b><span>'+p[0]+'</span></div>'; }).join("")+'</div>'+
      '<p class="caption" style="margin-top:12px">The sign-up deadline is a draft-eligibility cutoff, not a hard close — registration stays open all season and late sign-ups are randomly assigned after the draft. When the final pre-season game goes final, randomly assigned players are released back to the draft pool automatically. Ten minutes after the draft’s final pick, rookies who missed the 5-game minimum are placed on random clubs — so rosters are settled before free agency. Free agency runs a full week; puck drop waits for it to close.</p></div>'
    :'<div class="card-b"><p class="caption">No dates yet. Open <a href="#/admin/seasons" style="font-weight:700;border-bottom:2px solid var(--chrome)">Seasons</a>, set “Off-season begins”, and hit Auto-space — the dark weeks, sign-up deadline, pre-season, draft, free agency, puck drop, and playoffs all space themselves from that one date.</p></div>')+'</div>';

  /* lifecycle actions */
  var pool = regs.filter(function(r){ return !rosteredIds[r.profile_id] && r.status!=="declined"; });
  var randomN = (lg.players||[]).filter(function(p){ return p.origin==="preseason_random"; }).length;
  var rookies = pool.filter(function(r){ return !lg.isVeteran(r.profile_id) && ((lg.preGp[r.profile_id]||{}).gp||0) < 5; });
  var dl = s.signup_deadline_at || s.registration_deadline;
  var lateN = pool.filter(function(r){ return dl && r.created_at && Date.parse(r.created_at) > Date.parse(dl); }).length;
  h+='<div class="card" style="margin-bottom:18px"><div class="card-h"><h3>Pre-season lifecycle</h3></div><div class="card-b">'+
    '<div style="display:flex;gap:10px;flex-wrap:wrap">'+
    '<button class="btn btn-chrome" id="preAssignAll"'+(pool.length?"":" disabled")+'>Randomly assign unrostered ('+pool.length+')</button>'+
    '<button class="btn btn-ghost" id="preReleaseNow"'+(randomN?"":" disabled")+'>Release random assignments ('+randomN+')</button>'+
    '<button class="btn btn-ghost" id="preRookies"'+(rookies.length?"":" disabled")+'>Distribute unproven rookies ('+rookies.length+')</button>'+
    '<button class="btn btn-ghost" id="preLatecomers"'+(lateN?"":" disabled")+'>Assign late sign-ups ('+lateN+')</button></div>'+
    '<p class="caption" style="margin-top:12px">Randomly assign spreads every unrostered registration evenly across the clubs (management counts toward the split). '+
    'Release runs automatically after the final pre-season game; rookie placement runs automatically ten minutes after the draft’s final pick. '+
    'The sign-up deadline is a draft-eligibility cutoff, not a hard close — anyone registering after it (and anyone joining mid-season) is placed on a club with an open spot automatically. These buttons are manual overrides.</p></div></div>';

  var sortedRegs=regs.sort(function(a,b){ return (b.scout_ovr==null?-1:b.scout_ovr)-(a.scout_ovr==null?-1:a.scout_ovr); });
  h+='<div class="card"><div class="card-h"><h3>Registered players</h3><span class="chip">'+regs.length+'</span></div>'+
    (regs.length?'<div class="tblwrap"><table class="tbl keepcols"><caption>Season registrations</caption><thead><tr>'+
      '<th class="tleft">Player</th><th>POS</th><th class="tleft">EA ID</th><th>Scout OVR</th><th>Pre-season</th><th>Draft eligibility</th><th>Status</th><th class="tright">Assign to club</th></tr></thead><tbody>'+
      sortedRegs.map(function(r){ var prof=r.profiles||{}, on=rosteredIds[r.profile_id];
        var pre=lg.preGp[r.profile_id]||{gp:0,g:0,a:0}, vet=lg.isVeteran(r.profile_id);
        var declined=r.status==="declined";
        var late = dl && r.created_at && Date.parse(r.created_at) > Date.parse(dl);
        var elig = declined ? '<span class="chip chip-loss">Declined</span>'
                 : late ? '<span class="chip chip-warn">Late — random-assigned</span>'
                 : vet ? '<span class="chip">Veteran — exempt</span>'
                 : pre.gp>=5 ? '<span class="chip chip-win">Draft-eligible</span>'
                 : '<span class="chip chip-warn">'+pre.gp+' of 5 games</span>';
        var clubOpts = '<option value="">Choose club…</option>'+CG.TEAMS.map(function(t){ return '<option value="'+t.code+'">'+esc(t.code)+' · '+esc(t.name)+'</option>'; }).join("");
        var actions = declined
          ? '<button class="btn btn-ghost btn-sm" data-reg-reinstate="'+r.id+'" data-name="'+esc(prof.gamertag||"a player")+'">Reinstate</button>'
          : on ? '<button class="btn btn-ghost btn-sm" data-reg-decline="'+r.id+'" data-name="'+esc(prof.gamertag||"a player")+'">Decline</button>'
          : '<span style="display:inline-flex;gap:6px;align-items:center;flex-wrap:wrap"><select data-assign-team="'+r.id+'" style="padding:5px;max-width:150px">'+clubOpts+'</select>'+
            '<button class="btn btn-chrome btn-sm" data-assign="'+r.id+'" data-prof="'+r.profile_id+'" data-pos="'+esc(r.position||"C")+'" data-name="'+esc(prof.gamertag||"a player")+'">Sign</button>'+
            '<button class="btn btn-ghost btn-sm" data-reg-decline="'+r.id+'" data-name="'+esc(prof.gamertag||"a player")+'">Decline</button></span>';
        return '<tr'+(declined?' style="opacity:.55"':"")+'><td class="tleft"><span class="playercell"><span class="nm">'+esc(prof.gamertag||"—")+'</span></span></td>'+
          '<td class="tnum">'+esc(r.position||"—")+'</td><td class="tleft small" style="color:var(--steel)">'+esc(prof.ea_id||"—")+'</td>'+
          '<td class="tnum"><input type="number" min="40" max="99" value="'+(r.scout_ovr==null?"":r.scout_ovr)+'" data-scout="'+r.id+'" style="width:64px;text-align:center;padding:5px" placeholder="—"'+(declined?" disabled":"")+'></td>'+
          '<td class="tnum">'+(pre.gp?pre.gp+' GP · '+pre.g+'G '+pre.a+'A':'<span class="caption">—</span>')+'</td>'+
          '<td>'+elig+'</td>'+
          '<td>'+(declined?'<span class="chip chip-loss">Declined</span>':on?'<span class="chip chip-win">Rostered</span>':'<span class="chip chip-warn">Free agent</span>')+'</td>'+
          '<td class="tright">'+actions+'</td></tr>';
      }).join("")+'</tbody></table></div><div class="card-b" style="border-top:1px solid var(--line)"><span class="caption">Set a scouted overall to rank the draft pool. Pre-season games played come straight from the EA box scores; the 5-game minimum only applies to players without a draft cycle or 5 career games. Late sign-ups (registered after the deadline) are flagged and get random-assigned after the draft. Decline keeps a banned or duplicate account out of assignment and the draft pool; Reinstate undoes it.</span></div>'
      :'<div class="card-b"><p class="caption">No registrations yet — they appear here as members register for the season.</p></div>')+'</div>';
  h+='<div class="card" style="margin-top:18px"><div class="card-h"><h3>Owner applications</h3><span class="chip '+(pendingApps?"chip-warn":"chip-win")+'">'+(pendingApps?pendingApps+" pending":"none pending")+'</span></div>';
  if (apps.length){
    h+=apps.map(function(a){ var prof=a.profiles||{}, sc=a.status==="approved"?"chip-win":a.status==="denied"?"chip-loss":"chip-warn";
      return '<div class="card-b" style="border-top:1px solid var(--line-soft)"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:8px">'+
        '<b style="font-family:var(--f-disp)">'+esc(prof.gamertag||"Applicant")+'</b><span class="chip '+sc+'">'+esc((a.status||"pending").toUpperCase())+'</span></div>'+
        '<div class="caption" style="display:flex;gap:14px;flex-wrap:wrap">'+CG.franchisePicksLine(a)+(a.ea_id?'<span>EA '+esc(a.ea_id)+'</span>':"")+'</div>'+
        (a.pitch?'<p class="small" style="color:var(--steel);margin-top:8px;font-style:italic">“'+esc(a.pitch)+'”</p>':"")+
        '<div style="display:flex;gap:8px;margin-top:10px"><button class="btn btn-chrome btn-sm" data-app-approve="'+a.id+'"'+(a.status==="approved"?" disabled":"")+'>Approve</button>'+
        '<button class="btn btn-ghost btn-sm" data-app-deny="'+a.id+'"'+(a.status==="denied"?" disabled":"")+'>Deny</button></div></div>';
    }).join("");
  } else { h+='<div class="card-b"><p class="caption">No owner applications yet. They appear here when members apply from the “Apply to own a team” page.</p></div>'; }
  h+='</div>';
  /* staff applications — reviewed here or on the Staff Desk; approval promotes to staff */
  var pendSApps=sapps.filter(function(a){ return a.status==="pending"; }).length;
  h+='<div class="card" style="margin-top:18px"><div class="card-h"><h3>Staff applications</h3><span class="chip '+(pendSApps?"chip-warn":"chip-win")+'">'+(pendSApps?pendSApps+" pending":"none pending")+'</span></div>';
  if (sapps.length){
    h+=sapps.map(function(a){ var prof=a.profiles||{}, sc=a.status==="approved"?"chip-win":a.status==="denied"?"chip-loss":"chip-warn";
      return '<div class="card-b" style="border-top:1px solid var(--line-soft)"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:8px">'+
        '<b style="font-family:var(--f-disp)">'+esc(prof.gamertag||"Applicant")+'</b><span class="chip '+sc+'">'+esc((a.status||"pending").toUpperCase())+'</span></div>'+
        ((a.departments&&a.departments.length)?'<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">'+a.departments.map(function(k){ return '<span class="chip chip-chrome" style="font-size:9px">'+esc(CG.staffDeptLabel(k))+'</span>'; }).join("")+'</div>':"")+
        '<div class="caption" style="display:flex;gap:14px;flex-wrap:wrap">'+(a.timezone?'<span>TZ '+esc(a.timezone)+'</span>':"")+(a.availability?'<span>'+esc(a.availability)+'</span>':"")+(a.experience?'<span>'+esc(a.experience)+'</span>':"")+'</div>'+
        (a.pitch?'<p class="small" style="color:var(--steel);margin-top:8px;font-style:italic">“'+esc(a.pitch)+'”</p>':"")+
        '<div style="display:flex;gap:8px;margin-top:10px"><button class="btn btn-chrome btn-sm" data-sapp-approve="'+a.id+'" data-name="'+esc(prof.gamertag||"the applicant")+'"'+(a.status==="approved"?" disabled":"")+'>Approve</button>'+
        '<button class="btn btn-ghost btn-sm" data-sapp-deny="'+a.id+'" data-name="'+esc(prof.gamertag||"the applicant")+'"'+(a.status==="denied"?" disabled":"")+'>Deny</button></div></div>';
    }).join("");
  } else { h+='<div class="card-b"><p class="caption">No staff applications yet. They appear here when members apply from the “Apply to join the staff” page. Approving one promotes the member to staff (the Discord Staff role follows on the next sync).</p></div>'; }
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
  document.querySelectorAll("[data-sapp-approve]").forEach(function(b){ b.addEventListener("click", function(){ CG.decideStaffApp(this.getAttribute("data-sapp-approve"), true, this.getAttribute("data-name")); }); });
  document.querySelectorAll("[data-sapp-deny]").forEach(function(b){ b.addEventListener("click", function(){ CG.decideStaffApp(this.getAttribute("data-sapp-deny"), false, this.getAttribute("data-name")); }); });
  var paa=document.getElementById("preAssignAll"); if (paa) paa.addEventListener("click", CG.preseasonRandomAssign);
  var prn=document.getElementById("preReleaseNow"); if (prn) prn.addEventListener("click", CG.preseasonRelease);
  var prk=document.getElementById("preRookies"); if (prk) prk.addEventListener("click", CG.distributeRookies);
  var plc=document.getElementById("preLatecomers"); if (plc) plc.addEventListener("click", CG.assignLatecomers);
  document.querySelectorAll("[data-reg-decline]").forEach(function(b){ b.addEventListener("click", function(){
    var id=this.getAttribute("data-reg-decline"), name=this.getAttribute("data-name");
    CG.confirm("Decline "+name+"’s registration?","They’re kept out of random assignment and the draft pool until reinstated. If they’re already rostered, waive them from the club first.","Decline", function(){ CG.setRegStatus(id,"declined",name); });
  }); });
  document.querySelectorAll("[data-reg-reinstate]").forEach(function(b){ b.addEventListener("click", function(){
    CG.setRegStatus(this.getAttribute("data-reg-reinstate"),"pending",this.getAttribute("data-name"));
  }); });
  document.querySelectorAll("[data-assign]").forEach(function(b){ b.addEventListener("click", function(){
    var el=this, regId=el.getAttribute("data-assign"), sel=document.querySelector('[data-assign-team="'+regId+'"]'), code=sel?sel.value:"";
    if(!code){ CG.toast("Pick a club first","err"); return; }
    var name=el.getAttribute("data-name");
    CG.confirm("Sign "+name+" to "+CG.TEAM[code].name+"?","This adds the player to the club's active roster with the next open jersey number and logs a transaction. Reversible with a waive.","Sign player", function(){
      CG.assignRegistration(regId, el.getAttribute("data-prof"), el.getAttribute("data-pos"), name, code);
    });
  }); });
};
/* ---- pre-season lifecycle actions ---- */
CG.shuffleArr = function(a){ a=a.slice(); for (var i=a.length-1;i>0;i--){ var j=Math.floor(Math.random()*(i+1)), t=a[i]; a[i]=a[j]; a[j]=t; } return a; };
CG.nextJersey = function(used){ for (var n=1;n<=99;n++){ if(!used[n]){ used[n]=1; return n; } } return 0; };

CG.preseasonRandomAssign = function(){
  var lg=CG.lg, s=CG.SEASON;
  if (!s || !s.id){ CG.toast("Create a season first","err"); return; }
  var rosteredIds=lg._rosteredIds||{};
  var pool=(lg._registrationsRaw||[]).filter(function(r){ return (!r.season_id || r.season_id===s.id) && !rosteredIds[r.profile_id] && r.status!=="declined"; });
  if (!pool.length){ CG.toast("Everyone registered is already on a club","err"); return; }
  var rosterMax=s.roster_max||15;
  CG.confirm("Randomly assign "+pool.length+" players for the pre-season?",
    "Every unrostered registration is spread evenly across the "+CG.TEAMS.length+" clubs (management counts toward the split, clubs cap at "+rosterMax+"). "+
    "They are released back to the draft pool automatically when the final pre-season game ends.",
    "Assign randomly", function(){
    var counts={}, used={};
    CG.TEAMS.forEach(function(t){
      counts[t.code]=(lg.byTeam[t.code]||[]).length;
      used[t.code]={}; (lg.byTeam[t.code]||[]).forEach(function(p){ if(p.jersey) used[t.code][p.jersey]=1; });
    });
    var rows=[], regIds=[], skipped=0;
    CG.shuffleArr(pool).forEach(function(r){
      var open=CG.TEAMS.filter(function(t){ return counts[t.code]<rosterMax; });
      if (!open.length){ skipped++; return; }
      var min=Math.min.apply(null, open.map(function(t){ return counts[t.code]; }));
      var lows=open.filter(function(t){ return counts[t.code]===min; });
      var pick=lows[Math.floor(Math.random()*lows.length)];
      counts[pick.code]++;
      rows.push({ season_id:s.id, team_id:pick.id, profile_id:r.profile_id,
        jersey_number:CG.nextJersey(used[pick.code]), position:r.position||"C", salary:0, origin:"preseason_random" });
      regIds.push(r.id);
    });
    if (!rows.length){ CG.toast("No club has an open roster spot","err"); return; }
    var chunks=[]; for (var c=0;c<rows.length;c+=100) chunks.push(rows.slice(c,c+100));
    (function insertNext(idx){
      if (idx>=chunks.length){
        CG.sb.from("season_registrations").update({ status:"assigned" }).in("id", regIds).then(function(){
          CG.sb.from("transactions").insert({ season_id:s.id, type:"sign",
            description:"Pre-season: "+rows.length+" registered players randomly assigned across the league" }).then(function(){
            CG.toast(rows.length+" players randomly assigned"+(skipped?" · "+skipped+" left out (rosters full)":""),"ok");
            CG.reloadLeague();
          });
        });
        return;
      }
      CG.sb.from("roster_spots").insert(chunks[idx]).then(function(rz){
        if (rz.error){ CG.toast("Assignment stopped: "+rz.error.message,"err"); CG.reloadLeague(); return; }
        insertNext(idx+1);
      });
    })(0);
  });
};

CG.preseasonRelease = function(){
  var s=CG.SEASON; if (!s || !s.id) return;
  var n=(CG.lg.players||[]).filter(function(p){ return p.origin==="preseason_random"; }).length;
  CG.confirm("Release all "+n+" random pre-season assignments?",
    "This is what happens automatically when the final pre-season game ends — use it early only if you mean to. "+
    "Players return to the draft pool; their pre-season stats and eligibility are kept. Management and manually signed players stay put.",
    "Release to draft pool", function(){
    CG.sb.from("roster_spots").delete().eq("season_id",s.id).eq("origin","preseason_random").select("profile_id").then(function(r){
      if (r.error){ CG.toast("Couldn’t release: "+r.error.message,"err"); return; }
      var ids=(r.data||[]).map(function(x){ return x.profile_id; });
      var after=function(){
        CG.sb.from("transactions").insert({ season_id:s.id, type:"release",
          description:"Pre-season complete — "+ids.length+" randomly assigned players returned to the draft pool" }).then(function(){
          CG.toast(ids.length+" players released to the draft pool","ok"); CG.reloadLeague();
        });
      };
      if (ids.length) CG.sb.from("season_registrations").update({ status:"pending" }).eq("season_id",s.id).in("profile_id",ids).then(after);
      else { CG.toast("Nothing to release","ok"); CG.reloadLeague(); }
    });
  });
};

CG.distributeRookies = function(){
  var lg=CG.lg, s=CG.SEASON; if (!s || !s.id) return;
  var rosteredIds=lg._rosteredIds||{};
  var rookies=(lg._registrationsRaw||[]).filter(function(r){
    return (!r.season_id || r.season_id===s.id) && !rosteredIds[r.profile_id] && r.status!=="declined" &&
      !lg.isVeteran(r.profile_id) && ((lg.preGp[r.profile_id]||{}).gp||0) < 5;
  });
  if (!rookies.length){ CG.toast("No unproven rookies to place","err"); return; }
  CG.confirm("Distribute "+rookies.length+" unproven rookies now?",
    "This runs on its own ten minutes after the draft’s final pick — the button forces it early or re-runs it by hand. "+
    "Each player who missed the 5-game pre-season minimum goes to a completely random club with an open roster spot, "+
    "so rosters are settled before free agency and nobody can park a prospect to poach them later.",
    "Distribute rookies", function(){
    CG.sb.rpc("distribute_unproven_rookies",{ p_force:true }).then(function(r){
      if (r.error){ CG.toast("Couldn’t place: "+r.error.message,"err"); return; }
      CG.toast((r.data||0)+" rookie"+((r.data||0)===1?"":"s")+" placed on random clubs","ok"); CG.reloadLeague();
    });
  });
};
/* Late sign-ups (registered after the draft-eligibility cutoff) + anyone who joins mid-season are
   randomly assigned to a club with an open spot. Runs on its own every 5 min; this forces it. */
CG.assignLatecomers = function(){
  CG.confirm("Assign late sign-ups now?",
    "Everyone who registered after the sign-up deadline (or joined mid-season) and isn’t on a club yet "+
    "goes to the emptiest club with an open roster spot. This also runs automatically every few minutes — "+
    "the button just forces it. Puck-drop rosters are never blocked by a late arrival.",
    "Assign late sign-ups", function(){
    CG.sb.rpc("auto_assign_latecomers",{ p_force:true }).then(function(r){
      if (r.error){ CG.toast("Couldn’t assign: "+r.error.message,"err"); return; }
      CG.toast((r.data||0)+" late sign-up"+((r.data||0)===1?"":"s")+" placed on clubs","ok"); CG.reloadLeague();
    });
  });
};
/* Decline / reinstate a registration (keeps banned or duplicate accounts out of assignment + the draft). */
CG.setRegStatus = function(regId, status, name){
  CG.sb.from("season_registrations").update({status:status}).eq("id",regId).then(function(r){
    if (r.error){ CG.toast("Couldn’t update: "+r.error.message,"err"); return; }
    CG.toast((name||"Registration")+(status==="declined"?" declined":" reinstated"),"ok");
    var reg=(CG.lg._registrationsRaw||[]).find(function(x){return x.id===regId;}); if(reg)reg.status=status;
    CG.reloadLeague();
  });
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
  /* management from the team registry, not roster spots — a manager without a
     roster spot still holds the seat */
  var mgmtBy={}; (CG.TEAMS||[]).forEach(function(t){
    if(t.owner) mgmtBy[t.owner]={club:t.code, role:"owner"};
    if(t.gm)    mgmtBy[t.gm]   ={club:t.code, role:"gm"};
    if(t.agm)   mgmtBy[t.agm]  ={club:t.code, role:"agm"};
  });
  var banned=profs.filter(function(p){ return p.banned; }).length;
  var staffN=profs.filter(function(p){ return p.role==="staff"; }).length;
  function roleOpts(cur){ return ["member","staff","commissioner"].map(function(r){ return '<option value="'+r+'"'+(cur===r?" selected":"")+'>'+r.charAt(0).toUpperCase()+r.slice(1)+'</option>'; }).join(""); }
  var h='<div style="margin-bottom:16px"><h2 class="h-sec">Users & roles</h2><p class="lede" style="margin-top:6px">Everyone with a Chel Gaming account. Assign league roles and club management, or ban a member — all live.</p></div>';
  /* Role separation: commissioners/staff can't hold a club seat. Surface anyone who currently does
     (the grandfathered set) so the office knows the rule is in force and who's exempt for Season 1. */
  var conflicts = profs.filter(function(pr){ return (pr.role==="staff"||pr.role==="commissioner") && mgmtBy[pr.id]; });
  h+='<div class="note '+(conflicts.length?"":"grn")+'" style="margin-bottom:16px"><b style="font-family:var(--f-disp)">Role separation is on.</b> '+
    'Commissioners and staff can’t own or manage a club — it keeps votes on team management and staff impartial. They can still play as rostered members. New assignments that break the rule are blocked automatically.'+
    (conflicts.length?' <span style="display:block;margin-top:8px">Grandfathered for Season 1 (keep both hats until the Season 2 rollover): '+
      conflicts.map(function(pr){ var mg=mgmtBy[pr.id]; return '<b>'+esc(pr.gamertag||pr.display_name||"—")+'</b> ('+esc(pr.role)+' · '+esc(mg.club)+' '+esc((mg.role||"").toUpperCase())+')'; }).join(", ")+'.</span>':'')+'</div>';
  h+='<div class="grid g3" style="margin-bottom:18px">'+
    '<div class="kpi" style="cursor:default"><b class="num">'+profs.length+'</b><span>accounts</span></div>'+
    '<div class="kpi" style="cursor:default"><b class="num">'+profs.filter(function(p){return p.role==="commissioner";}).length+'</b><span>commissioners</span></div>'+
    '<div class="kpi" style="cursor:default"><b class="num">'+staffN+'</b><span>staff</span></div></div>';
  h+='<div style="display:flex;gap:10px;align-items:center;margin-bottom:16px;flex-wrap:wrap">'+
    '<input type="search" id="userSearch" placeholder="Search players…" style="flex:1;min-width:200px" aria-label="Search users">'+
    '<button class="btn btn-ghost btn-sm" id="bannedToggle" aria-pressed="false" style="white-space:nowrap">Banned only ('+banned+')</button></div>';
  h+='<div class="card"><div class="card-h"><h3>Members</h3><span class="chip">'+profs.length+'</span></div>'+
    '<div class="tblwrap"><table class="tbl keepcols"><caption>All users</caption><thead><tr><th class="tleft">Player</th><th class="tleft">League role</th><th class="tleft">Club</th><th>Status</th><th class="tright">Actions</th></tr></thead><tbody id="usersBody">'+
    profs.map(function(pr){
      var pl=playerById[pr.id], mg=mgmtBy[pr.id]||null, club=pl?pl.team:(mg?mg.club:null), mgmt=mg?mg.role:null;
      var sus=(lg.suspensions||[]).find(function(s){ return s.playerId===pr.id && s.status==="active"; });
      var gr=["member","staff","commissioner"].indexOf(pr.role)>=0?pr.role:"member";
      return '<tr data-user-name="'+esc((pr.gamertag||pr.display_name||"").toLowerCase())+'" data-user-banned="'+(pr.banned?1:0)+'">'+
        '<td class="tleft"><span class="playercell">'+(pr.avatar_url?'<img src="'+esc(pr.avatar_url)+'" alt="" style="width:22px;height:22px;border-radius:50%;object-fit:cover">':"")+'<span class="nm">'+esc(pr.gamertag||pr.display_name||"—")+'</span></span></td>'+
        '<td class="tleft"><select data-role-for="'+pr.id+'" style="padding:5px;max-width:150px">'+roleOpts(gr)+'</select></td>'+
        '<td class="tleft">'+(club?'<span class="teamcell">'+CG.crest(club,18)+'<span class="mono" style="font-size:11px">'+esc(club)+'</span></span>'+(mgmt?' <span class="chip chip-chrome" style="font-size:9px">'+esc(mgmt.toUpperCase())+'</span>':""):'<span class="caption">—</span>')+'</td>'+
        '<td>'+(pr.banned?'<span class="chip chip-loss">Banned</span>':sus?'<span class="chip chip-loss">Suspended</span>':'<span class="chip chip-win">Active</span>')+'</td>'+
        '<td class="tright"><span style="display:inline-flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">'+
          '<button class="btn btn-ghost btn-sm" data-manage="'+pr.id+'" data-name="'+esc(pr.gamertag||pr.display_name||"member")+'">Club role</button>'+
          (mg?'<button class="btn btn-ghost btn-sm" data-unmanage="'+pr.id+'" data-club="'+esc(mg.club)+'" data-mrole="'+esc(mg.role)+'" data-name="'+esc(pr.gamertag||pr.display_name||"member")+'">Remove club role</button>':"")+
          (sus?'<button class="btn btn-ghost btn-sm" data-lift="'+sus.id+'" data-name="'+esc(pr.gamertag||pr.display_name||"member")+'">Lift suspension</button>'
              :'<button class="btn btn-ghost btn-sm" data-suspend="'+pr.id+'" data-name="'+esc(pr.gamertag||pr.display_name||"member")+'">Suspend</button>')+
          (pr.banned?'<button class="btn btn-ghost btn-sm" data-unban="'+pr.id+'">Unban</button>':'<button class="btn btn-ghost btn-sm" data-ban="'+pr.id+'" data-name="'+esc(pr.gamertag||pr.display_name||"member")+'">Ban</button>')+
        '</span></td></tr>';
    }).join("")+'</tbody></table></div>'+
    '<div class="card-b" style="border-top:1px solid var(--line)"><span class="caption">League role saves the moment you change it. “Club role” assigns a member as a club’s Owner, GM, or AGM; “Remove club role” clears the seat. Suspensions block roster moves and lineups for a set number of games or until a date (Rule 7.4) and show on the profile. Banning removes site access and Discord membership; it’s reversible.</span></div></div>';
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
CG.removeClubRole = function(profileId, club, role, name){
  var roleName = role==="owner"?"Owner":role==="gm"?"General Manager":"Assistant GM";
  CG.modal("Remove "+esc(name)+" from "+esc(club)+" management?",
    '<p>'+esc(name)+' is currently <b>'+roleName+'</b> of <b>'+esc(club)+'</b>. Removing the role ends their Team HQ access for the club; their roster spot and contract are untouched.</p>'+
    '<p class="caption" style="margin-top:8px">Discord club-management roles update on the next sync. Reassign anytime with “Club role”.</p>',
    '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-ink" id="unmgGo">Remove role</button>');
  document.getElementById("unmgGo").addEventListener("click", function(){
    CG.sb.rpc("set_team_manager",{ p_team_code:club, p_role:role, p_profile:null }).then(function(r){
      if(r.error){ CG.toast("Couldn’t remove: "+r.error.message,"err"); return; }
      if(CG.closeOverlay) CG.closeOverlay();
      CG.toast(name+" removed as "+roleName+" of "+club,"ok");
      CG.reloadLeague();
    });
  });
};
CG.suspendUser = function(profileId, name){
  CG.modal("Suspend "+esc(name),
    '<label class="fld"><span>Reason (shown on the profile’s discipline record)</span><textarea id="susReason" rows="2" placeholder="e.g. Rule 7.2 — abusive conduct in lobby"></textarea></label>'+
    '<div class="grid g2" style="gap:12px;margin-top:4px">'+
    '<label class="fld"><span>Length</span><select id="susMode"><option value="games">Number of games</option><option value="date">Until a date</option></select></label>'+
    '<label class="fld" id="susGamesWrap"><span>Games</span><input id="susGames" type="number" min="1" max="82" value="1"></label>'+
    '<label class="fld" id="susDateWrap" style="display:none"><span>Ends (ET)</span><input id="susDate" type="datetime-local"></label></div>'+
    '<p class="caption">A suspended member can’t be added to rosters or lineups and their management moves are blocked. The record shows on their profile (Rule 7.4). Reversible with Lift.</p>',
    '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-ink" id="susGo">Suspend</button>');
  var modeSel=document.getElementById("susMode");
  modeSel.addEventListener("change", function(){
    var byDate=this.value==="date";
    document.getElementById("susGamesWrap").style.display=byDate?"none":"";
    document.getElementById("susDateWrap").style.display=byDate?"":"none";
  });
  document.getElementById("susGo").addEventListener("click", function(){
    var reason=(document.getElementById("susReason").value||"").trim();
    if(!reason){ CG.toast("Give the suspension a reason — it’s the league record","err"); return; }
    var mode=modeSel.value, games=null, ends=null;
    if (mode==="games"){
      games=parseInt(document.getElementById("susGames").value,10);
      if(!(games>=1)){ CG.toast("Games must be 1 or more","err"); return; }
    } else {
      var v=document.getElementById("susDate").value;
      if(!v){ CG.toast("Pick the end date","err"); return; }
      ends=CG.etISO(v.slice(0,10), v.slice(11,16));
    }
    var btn=this; btn.disabled=true;
    CG.sb.rpc("suspend_player",{ p_profile:profileId, p_mode:mode, p_ends_at:ends, p_games:games, p_reason:reason }).then(function(r){
      btn.disabled=false;
      if(r.error){ CG.toast("Couldn’t suspend: "+r.error.message,"err"); return; }
      if(CG.closeOverlay) CG.closeOverlay();
      CG.toast(name+" suspended "+(mode==="games"?"for "+games+" game"+(games===1?"":"s"):"until "+CG.fmtFull(Date.parse(ends))),"ok");
      CG.reloadLeague();
    });
  });
};
CG.liftUserSuspension = function(susId, name){
  CG.confirm("Lift "+esc(name)+"’s suspension?","They can be rostered and make moves again immediately. The record stays on their profile as served.","Lift suspension", function(){
    CG.sb.rpc("lift_suspension",{ p_id:susId }).then(function(r){
      if(r.error){ CG.toast("Couldn’t lift: "+r.error.message,"err"); return; }
      CG.toast(name+"’s suspension lifted","ok"); CG.reloadLeague();
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
  var search=document.getElementById("userSearch"), bannedBtn=document.getElementById("bannedToggle");
  function applyFilter(){
    var qy=(search&&search.value||"").toLowerCase();
    var bannedOnly = bannedBtn && bannedBtn.getAttribute("aria-pressed")==="true";
    var shown=0;
    document.querySelectorAll("#usersBody tr").forEach(function(tr){
      var hit = tr.getAttribute("data-user-name").indexOf(qy)>=0 &&
                (!bannedOnly || tr.getAttribute("data-user-banned")==="1");
      tr.style.display = hit ? "" : "none";
      if (hit) shown++;
    });
    var empty=document.getElementById("usersEmpty");
    if (!shown && !empty){
      empty=document.createElement("div");
      empty.id="usersEmpty"; empty.className="card-b";
      empty.innerHTML='<span class="caption">'+(bannedOnly?"No banned members — the room is clean.":"No players match that search.")+'</span>';
      var tbl=document.querySelector("#usersBody").closest(".tblwrap");
      tbl.parentNode.insertBefore(empty, tbl.nextSibling);
    } else if (shown && empty){ empty.remove(); }
    else if (empty){ empty.innerHTML='<span class="caption">'+(bannedOnly?"No banned members — the room is clean.":"No players match that search.")+'</span>'; }
  }
  if(search) search.addEventListener("input", applyFilter);
  if(bannedBtn) bannedBtn.addEventListener("click", function(){
    var on = this.getAttribute("aria-pressed")==="true";
    this.setAttribute("aria-pressed", on?"false":"true");
    this.classList.toggle("btn-ink", !on);
    this.classList.toggle("btn-ghost", on);
    applyFilter();
  });
  document.querySelectorAll("[data-role-for]").forEach(function(sel){ sel.addEventListener("change", function(){ CG.setUserRole(this.getAttribute("data-role-for"), this.value); }); });
  document.querySelectorAll("[data-manage]").forEach(function(b){ b.addEventListener("click", function(){ CG.assignClubRole(this.getAttribute("data-manage"), this.getAttribute("data-name")); }); });
  document.querySelectorAll("[data-unmanage]").forEach(function(b){ b.addEventListener("click", function(){ CG.removeClubRole(this.getAttribute("data-unmanage"), this.getAttribute("data-club"), this.getAttribute("data-mrole"), this.getAttribute("data-name")); }); });
  document.querySelectorAll("[data-suspend]").forEach(function(b){ b.addEventListener("click", function(){ CG.suspendUser(this.getAttribute("data-suspend"), this.getAttribute("data-name")); }); });
  document.querySelectorAll("[data-lift]").forEach(function(b){ b.addEventListener("click", function(){ CG.liftUserSuspension(this.getAttribute("data-lift"), this.getAttribute("data-name")); }); });
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
   LIVE ADMIN: TEAMS — add / edit / remove clubs (real teams table)
   ================================================================ */
CG.reloadLeague = async function(){
  try {
    CG.lg = await CG.buildLiveLeague();
    await CG.loadManagerData();
    await Promise.all([CG.loadAvailability(), CG.loadTrades()]);
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
    '<div class="tblwrap"><table class="tbl keepcols"><caption>All clubs</caption><thead><tr><th class="tleft">Club</th><th class="tleft">Code</th><th class="tleft">Division</th><th>Roster</th><th class="tright">Actions</th></tr></thead><tbody>'+
    teams.map(function(t){
      var n=(CG.lg.byTeam[t.code]||[]).length;
      return '<tr><td class="tleft"><span class="teamcell">'+CG.crest(t.code,24)+'<span><span class="nm">'+esc(t.name)+'</span><small>'+esc(t.city||"—")+'</small></span></span></td>'+
        '<td class="tleft mono" style="font-size:12px">'+esc(t.code)+'</td>'+
        '<td class="tleft">'+esc(t.div)+'</td>'+
        '<td data-v="'+n+'">'+n+'</td>'+
        '<td class="tright"><span style="display:inline-flex;gap:6px"><button class="btn btn-ghost btn-sm" data-team-edit="'+t.id+'">Edit</button>'+
        '<button class="btn btn-ghost btn-sm" data-team-del="'+t.id+'" data-name="'+esc(t.name)+'">Remove</button></span></td></tr>';
    }).join("")+'</tbody></table></div>'+
    '<div class="card-b" style="border-top:1px solid var(--line)"><span class="caption">Renames propagate everywhere instantly (rosters, schedule, and history follow the club, not the name). Removing a club is blocked while it still has rostered players or scheduled games.</span></div></div>';
  /* custom divisions — the league's groupings are data, not hardcoded */
  var divs = (CG._divisionsRaw||[]).slice().sort(function(a,b){ return (a.sort_order||0)-(b.sort_order||0); });
  h += '<div class="card" style="margin-top:18px"><div class="card-h"><h3>Divisions</h3><span class="chip">'+divs.length+'</span></div>'+
    divs.map(function(d,i){
      var n = teams.filter(function(t){ return t.div===d.name; }).length;
      return '<div class="card-b" style="display:flex;align-items:center;gap:14px;'+(i?"border-top:1px solid var(--line-soft)":"")+'">'+
        '<b style="font-family:var(--f-disp);font-size:15px;flex:1">'+esc(d.name)+'</b>'+
        '<span class="caption">'+n+' club'+(n===1?"":"s")+'</span>'+
        '<span style="display:inline-flex;gap:6px"><button class="btn btn-ghost btn-sm" data-div-rename="'+d.id+'" data-name="'+esc(d.name)+'">Rename</button>'+
        '<button class="btn btn-ghost btn-sm" data-div-del="'+d.id+'" data-name="'+esc(d.name)+'" data-count="'+n+'">Delete</button></span></div>';
    }).join("")+
    '<div class="card-b" style="border-top:1px solid var(--line);display:flex;gap:10px;align-items:center">'+
      '<input id="divNew" placeholder="New division name…" style="flex:1" maxlength="24">'+
      '<button class="btn btn-chrome btn-sm" id="divAdd">Add division</button></div>'+
    '<div class="card-b" style="border-top:1px solid var(--line)"><span class="caption">Standings, team pages, and the standings race group by these automatically. Renames carry every club along; deleting needs the division empty first.</span></div></div>';
  return h;
};
CG.addDivision = function(){
  var name=(document.getElementById("divNew").value||"").trim();
  if(!name){ CG.toast("Give the division a name","err"); return; }
  if((CG.DIVISIONS||[]).some(function(d){ return d.toLowerCase()===name.toLowerCase(); })){ CG.toast(name+" already exists","err"); return; }
  var maxSort=(CG._divisionsRaw||[]).reduce(function(m,d){ return Math.max(m,d.sort_order||0); },0);
  CG.sb.from("divisions").insert({ name:name, sort_order:maxSort+1 }).then(function(r){
    if(r.error){ CG.toast("Couldn’t add: "+r.error.message,"err"); return; }
    CG.toast(name+" division added","ok"); CG.reloadLeague();
  });
};
CG.renameDivision = function(id, oldName){
  CG.modal("Rename — "+esc(oldName),
    '<label class="fld"><span>Division name</span><input id="divName" value="'+esc(oldName)+'" maxlength="24"></label>'+
    '<p class="caption">Every club in '+esc(oldName)+' moves with the new name — standings and team pages update instantly.</p>',
    '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-chrome" id="divGo">Rename</button>');
  document.getElementById("divGo").addEventListener("click", function(){
    var name=(document.getElementById("divName").value||"").trim();
    if(!name){ CG.toast("Give the division a name","err"); return; }
    if(name===oldName){ if(CG.closeOverlay)CG.closeOverlay(); return; }
    if((CG.DIVISIONS||[]).some(function(d){ return d.toLowerCase()===name.toLowerCase(); })){ CG.toast(name+" already exists","err"); return; }
    CG.sb.from("divisions").update({ name:name }).eq("id",id).then(function(r){
      if(r.error){ CG.toast("Couldn’t rename: "+r.error.message,"err"); return; }
      /* clubs reference the division by name — carry them along */
      CG.sb.from("teams").update({ division:name }).eq("division",oldName).then(function(r2){
        if(r2.error){ CG.toast("Division renamed, but clubs didn’t follow: "+r2.error.message,"err"); return; }
        if(CG.closeOverlay)CG.closeOverlay();
        CG.toast(oldName+" is now "+name,"ok"); CG.reloadLeague();
      });
    });
  });
};
CG.deleteDivision = function(id, name, count){
  if (count>0){ CG.toast("Can’t delete "+name+" — move its "+count+" club"+(count===1?"":"s")+" to another division first","err"); return; }
  if ((CG._divisionsRaw||[]).length<=1){ CG.toast("The league needs at least one division","err"); return; }
  CG.confirm("Delete the "+esc(name)+" division?","It’s empty, so nothing moves. This can’t be undone.","Delete division", function(){
    CG.sb.from("divisions").delete().eq("id",id).then(function(r){
      if(r.error){ CG.toast("Couldn’t delete: "+r.error.message,"err"); return; }
      CG.toast(name+" deleted","ok"); CG.reloadLeague();
    });
  });
};
/* upload a club logo to the public team-logos bucket (commissioner-only RLS).
   Token-explicit: a tab whose session lapsed (multi-tab refresh-token rotation)
   silently falls back to the anon key in the storage client, which reads as
   "violates row-level security". So we fetch the session ourselves, prove it
   server-side, send it explicitly, and retry once through a refresh. */
CG.uploadTeamLogo = async function(file, code){
  var s = await CG.sb.auth.getSession();
  var session = s && s.data && s.data.session;
  if (!session){
    var rf = await CG.sb.auth.refreshSession();
    session = rf && rf.data && rf.data.session;
  }
  if (!session) throw new Error("your sign-in expired — sign out and back in, then retry");
  var isComm = await CG.sb.rpc("is_commissioner");
  if (isComm && isComm.error) throw new Error(isComm.error.message);
  if (!isComm.data){
    /* the token the server sees isn't a commissioner — one refresh, one recheck */
    var rf2 = await CG.sb.auth.refreshSession();
    session = (rf2 && rf2.data && rf2.data.session) || session;
    isComm = await CG.sb.rpc("is_commissioner");
    if (!isComm.data) throw new Error("this session isn’t being recognized as commissioner — sign out and back in, then retry");
  }
  var ext = ((file.name.split(".").pop()||"png").toLowerCase().replace(/[^a-z0-9]/g,"")) || "png";
  var path = (code||"logo").toLowerCase()+"-"+Date.now()+"."+ext;
  async function put(tok){
    return fetch(CG.SB_URL+"/storage/v1/object/team-logos/"+encodeURIComponent(path), {
      method:"POST",
      headers:{ "Authorization":"Bearer "+tok, "apikey":CG.SB_KEY, "Content-Type":file.type||"image/png", "x-upsert":"true", "cache-control":"3600" },
      body:file
    });
  }
  var res = await put(session.access_token);
  if (!res.ok){
    var body = await res.json().catch(function(){ return {}; });
    if (res.status===400 || res.status===403){
      /* stale token race — refresh once and retry with the new one */
      var rf3 = await CG.sb.auth.refreshSession();
      var fresh = rf3 && rf3.data && rf3.data.session;
      if (fresh){ res = await put(fresh.access_token); }
      if (!res.ok){ body = await res.json().catch(function(){ return body; }); throw new Error(body.message||body.error||("upload rejected (HTTP "+res.status+")")); }
    } else {
      throw new Error(body.message||body.error||("upload rejected (HTTP "+res.status+")"));
    }
  }
  return CG.sb.storage.from("team-logos").getPublicUrl(path).data.publicUrl;
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
    '<label class="fld" style="grid-column:1/-1"><span>Club color</span><input id="tfColor" type="color" value="'+esc(t.color||"#8899A6")+'" style="height:44px;padding:4px;width:100%"></label>'+
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
      division:document.getElementById("tfDiv").value,
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
  var dAdd=document.getElementById("divAdd");
  if(dAdd) dAdd.addEventListener("click", CG.addDivision);
  var dNew=document.getElementById("divNew");
  if(dNew) dNew.addEventListener("keydown", function(e){ if(e.key==="Enter") CG.addDivision(); });
  document.querySelectorAll("[data-div-rename]").forEach(function(b){ b.addEventListener("click", function(){
    CG.renameDivision(this.getAttribute("data-div-rename"), this.getAttribute("data-name"));
  }); });
  document.querySelectorAll("[data-div-del]").forEach(function(b){ b.addEventListener("click", function(){
    CG.deleteDivision(this.getAttribute("data-div-del"), this.getAttribute("data-name"), +this.getAttribute("data-count"));
  }); });
};

/* ================================================================
   LIVE LEAGUE OFFICE — complaints & requests on the real
   action_requests / action_messages tables (replaces the demo cases)
   ================================================================ */
CG.ACTION_META = {
  complaint:       { label:"Complaint",               icon:"flag",  route:"commissioner", blurb:"Conduct, cheating, no-shows, harassment — anything that needs the league office." },
  appeal:          { label:"Suspension / ban appeal", icon:"doc",   route:"commissioner", blurb:"Appeal a ruling within 48 hours (Rule 7.6)." },
  trade_request:   { label:"Trade request",           icon:"swap",  route:"manager",      blurb:"Ask your club’s management for a move — private to your club." },
  position_change: { label:"Position change",         icon:"users", route:"commissioner", blurb:"Request a switch to a new position." }
};
CG.COMPLAINT_SUBJECTS = ["Player conduct / toxicity","Harassment or abuse","Cheating or exploiting","Trolling / griefing in-game","No-show or forfeit","Lag / connection manipulation","Manager or GM conduct","Commissioner or staff conduct","Rulebook violation","Discord behavior","Something else"];
CG.APPEAL_SUBJECTS = ["Single-game suspension","Multi-game suspension","Season ban","Permanent ban","Forfeit ruling","Roster or cap penalty","Warning or strike","Trade reversal","Something else"];
CG.loadActionRequests = async function(){
  if (!CG.sb || !CG.lg || !CG.auth.user) return;
  try {
    var q = await Promise.all([
      CG.sb.from("action_requests").select("*, profiles(gamertag)").order("created_at",{ascending:false}),
      CG.sb.from("action_messages").select("*, profiles(gamertag,role)").order("created_at",{ascending:true})
    ]);
    CG.lg._actionReqs = (q[0]&&!q[0].error&&q[0].data)||[];
    var msgs = {};
    ((q[1]&&!q[1].error&&q[1].data)||[]).forEach(function(m){ (msgs[m.request_id]=msgs[m.request_id]||[]).push(m); });
    CG.lg._actionMsgs = msgs;
  } catch(e){}
};
CG.refreshActions = function(){
  CG.loadActionRequests().then(function(){
    if (/complaint|admin\/complaints/.test(location.hash) && CG.router) CG.router();
  });
};
/* dashboard tiles + counts read this — map real rows to the prototype shape */
CG.visibleComplaints = function(){
  return (CG.lg._actionReqs||[]).map(function(a){
    var closed = a.status==="resolved"||a.status==="denied";
    return { caseId:(a.id||"").slice(0,8), category:(CG.ACTION_META[a.type]||{}).label||a.type,
      status: closed?"Resolved":"Under review", assignedTo:"", confidential:false,
      summary:(a.subject||a.details||"").slice(0,90), filedBy:(a.profiles&&a.profiles.gamertag)||"member", against:a.target||"—" };
  });
};
CG.actionStatusChip = function(st){
  var map={ open:["chip","Open"], reviewing:["chip-warn","Reviewing"], acknowledged:["chip-chrome","Acknowledged"], resolved:["chip-win","Resolved"], denied:["chip-loss","Denied"] };
  var m=map[st]||["chip",st||"Open"];
  return '<span class="chip '+m[0]+'">'+esc(m[1])+'</span>';
};
CG.actionCard = function(a, review){
  var meta = CG.ACTION_META[a.type]||{label:a.type,icon:"flag"};
  var msgs = (CG.lg._actionMsgs||{})[a.id]||[];
  var metaBits = [];
  if (a.type==="position_change" && a.requested_position) metaBits.push(esc(a.current_position||"?")+" → "+esc(a.requested_position));
  if (a.target) metaBits.push("About: "+esc(a.target));
  metaBits.push(CG.fmtFull(Date.parse(a.created_at)));
  var h = '<div class="card"><div class="card-b" style="display:flex;flex-direction:column;gap:10px">'+
    '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">'+CG.ic(meta.icon||"flag",15)+
      '<b style="font-family:var(--f-disp)">'+esc(meta.label)+'</b>'+CG.actionStatusChip(a.status)+
      (review?'<span class="caption">filed by <b>'+esc((a.profiles&&a.profiles.gamertag)||"member")+'</b></span>':"")+
      '<span class="caption" style="margin-left:auto">'+metaBits.join(" · ")+'</span></div>'+
    (a.subject?'<b style="font-size:14px">'+esc(a.subject)+'</b>':"")+
    '<p class="small" style="color:var(--steel);white-space:pre-wrap">'+esc(a.details||"")+'</p>'+
    (a.response?'<div class="note grn" style="margin:0"><b style="font-family:var(--f-disp);display:block;margin-bottom:3px">Official response</b>'+esc(a.response)+'</div>':"");
  if (msgs.length){
    h += '<div class="stack" style="gap:8px;border-top:1px solid var(--line-soft);padding-top:10px">'+msgs.map(function(m){
      var isStaff = m.profiles && m.profiles.role==="commissioner";
      return '<div style="display:flex;gap:9px"><b class="mono" style="font-size:11px;color:'+(isStaff?"var(--chrome-deep)":"var(--steel)")+';flex-shrink:0">'+esc((m.profiles&&m.profiles.gamertag)||"member")+(isStaff?" · league office":"")+'</b>'+
        '<span class="small" style="color:var(--steel);white-space:pre-wrap">'+esc(m.body||"")+'</span></div>';
    }).join("")+'</div>';
  }
  var closed = a.status==="resolved"||a.status==="denied";
  if (!closed){
    h += '<div style="display:flex;gap:8px"><input data-reply-for="'+a.id+'" placeholder="Add a reply or more detail…" style="flex:1">'+
      '<button class="btn btn-ghost btn-sm" data-reply-send="'+a.id+'">Reply</button></div>';
  }
  if (review){
    h += '<div style="display:flex;gap:7px;flex-wrap:wrap;border-top:1px solid var(--line-soft);padding-top:10px">'+
      (a.status!=="reviewing"?'<button class="btn btn-ghost btn-sm" data-act-status="reviewing" data-act-id="'+a.id+'">Mark reviewing</button>':"")+
      '<button class="btn btn-ghost btn-sm" data-act-respond="'+a.id+'">Respond</button>'+
      '<button class="btn btn-ghost btn-sm" data-act-status="resolved" data-act-id="'+a.id+'">Resolve</button>'+
      '<button class="btn btn-ghost btn-sm" data-act-status="denied" data-act-id="'+a.id+'">Deny</button>'+
      '<button class="btn btn-ghost btn-sm" data-act-del="'+a.id+'" style="margin-left:auto">Delete</button></div>';
  }
  return h+'</div></div>';
};
CG.hubComplaintsLive = function(opts){
  opts = opts||{};
  var isCommish = CG.role()==="commish";
  var review = isCommish || CG.role()==="staff";
  var all = (CG.lg._actionReqs||[]);
  var mine = CG.auth.user ? all.filter(function(a){ return a.profile_id===CG.auth.user.id; }) : [];
  var queue = review && !opts.mineOnly ? all : mine;
  var h = '<div style="margin-bottom:20px"><span class="eyebrow chr">'+(review?"All cases · league office":"Your cases")+'</span>'+
    '<h1 class="h-sec" style="margin-top:8px">'+(opts.admin?"Complaints & requests":"League office")+'</h1>'+
    '<p class="lede" style="margin-top:8px">File a complaint, appeal a ruling, or send a request — everything lands with '+(review?"you":"the league office")+' and carries its status here.</p></div>';
  h += '<div class="grid g2" style="margin-bottom:22px">'+Object.keys(CG.ACTION_META).map(function(k){
    var m = CG.ACTION_META[k];
    return '<div class="card raise" data-file-action="'+k+'" role="button" tabindex="0" style="cursor:pointer"><div class="card-b" style="display:flex;gap:12px;align-items:flex-start">'+
      '<span class="nf-ic">'+CG.ic(m.icon,16)+'</span><div><b style="font-family:var(--f-disp)">'+esc(m.label)+'</b>'+
      '<p class="caption" style="margin-top:3px">'+esc(m.blurb)+'</p></div></div></div>';
  }).join("")+'</div>';
  h += '<div class="card-h" style="padding:0 0 12px;border:0"><h3>'+(review?"Case queue ("+queue.length+")":"Your filed cases ("+queue.length+")")+'</h3></div>';
  h += queue.length
    ? '<div class="stack" style="gap:12px">'+queue.map(function(a){ return CG.actionCard(a, review); }).join("")+'</div>'
    : '<div class="card"><div class="empty"><div class="e-art">'+CG.ic("flag",22)+'</div><b>Nothing on file'+(review?"":" yet")+'</b><p>'+(review?"Member complaints and requests queue here the moment they’re filed.":"File one above — you’ll see its status and any league-office response right here.")+'</p></div></div>';
  h += '<div class="note" style="margin-top:18px">Complaints follow Rule 7: submission → review → written decision, with appeals within 48 hours (Rule 7.6). The league office is notified the moment you file.</div>';
  return h;
};
CG.fileActionRequest = function(type){
  if (!CG.auth.user){ CG.toast("Sign in with Discord first","err"); return; }
  var meta = CG.ACTION_META[type]; if(!meta) return;
  var me = CG.me();
  var fields = "";
  if (type==="complaint" || type==="appeal"){
    var subs = type==="complaint" ? CG.COMPLAINT_SUBJECTS : CG.APPEAL_SUBJECTS;
    fields += '<label class="fld"><span>'+(type==="complaint"?"What’s the complaint about?":"What are you appealing?")+'</span><select id="acSubject"><option value="">Select one…</option>'+subs.map(function(s){ return '<option>'+esc(s)+'</option>'; }).join("")+'</select></label>';
    if (type==="complaint"){
      fields += '<label class="fld"><span>Who is this about? (optional)</span><select id="acTarget"><option value="">—</option>'+CG.lg.players.map(function(p){ return '<option>'+esc(p.tag)+'</option>'; }).join("")+'</select></label>';
    }
  }
  if (type==="position_change"){
    var posOpts = ["C","LW","RW","LD","RD","G"].map(function(p){ return '<option value="'+p+'">'+esc(CG.POS_NAME[p]||p)+'</option>'; }).join("");
    fields += '<div class="grid g2" style="gap:12px">'+
      '<label class="fld"><span>Current position</span><select id="acCur">'+posOpts+'</select></label>'+
      '<label class="fld"><span>Requested position</span><select id="acReq">'+posOpts+'</select></label></div>';
  }
  if (type==="trade_request" && (!me || !me.team)){ CG.toast("You need to be on a club roster to request a trade","err"); return; }
  fields += '<label class="fld"><span>'+(type==="trade_request"?"Why are you requesting a trade?":"Details")+'</span><textarea id="acDetails" rows="5" placeholder="'+(type==="complaint"?"What happened, when, and in which game or channel. Link any evidence.":"Explain your request.")+'"></textarea></label>'+
    '<p class="caption">'+(meta.route==="manager"?"Private to your club’s management.":"Goes to the league office — commissioners are notified instantly.")+'</p>';
  CG.modal("File — "+esc(meta.label), fields,
    '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-chrome" id="acGo">Submit</button>');
  document.getElementById("acGo").addEventListener("click", function(){
    var subEl=document.getElementById("acSubject");
    var subject = subEl ? subEl.value : null;
    if (subEl && !subject){ CG.toast("Pick what this is about","err"); return; }
    var details = (document.getElementById("acDetails").value||"").trim();
    if (!details){ CG.toast("Add details — describe what happened","err"); return; }
    var payload = { profile_id: CG.auth.user.id, type:type, route:meta.route, details:details,
      season_id: (CG.SEASON&&CG.SEASON.id)||null, subject: subject||null,
      target: (document.getElementById("acTarget")||{}).value||null };
    if (type==="trade_request") payload.team_id = (CG.lg._codeToId||{})[me.team]||null;
    if (type==="position_change"){
      payload.current_position = document.getElementById("acCur").value;
      payload.requested_position = document.getElementById("acReq").value;
      if (payload.current_position===payload.requested_position){ CG.toast("Pick a different requested position","err"); return; }
    }
    var btn=this; btn.disabled=true;
    CG.sb.from("action_requests").insert(payload).then(function(r){
      btn.disabled=false;
      if (r.error){ CG.toast("Couldn’t submit: "+r.error.message,"err"); return; }
      if (CG.closeOverlay) CG.closeOverlay();
      CG.toast(meta.route==="manager"?"Sent to your club’s management":"Filed — the league office has it","ok");
      CG.refreshActions();
    });
  });
};
CG.AFTER._complaintsLive = function(){
  document.querySelectorAll("[data-file-action]").forEach(function(c){
    var go = function(){ CG.fileActionRequest(c.getAttribute("data-file-action")); };
    c.addEventListener("click", go);
    c.addEventListener("keydown", function(e){ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); go(); } });
  });
  document.querySelectorAll("[data-reply-send]").forEach(function(b){ b.addEventListener("click", function(){
    var id=this.getAttribute("data-reply-send");
    var inp=document.querySelector('[data-reply-for="'+id+'"]');
    var body=(inp&&inp.value||"").trim();
    if(!body){ CG.toast("Write the reply first","err"); return; }
    CG.sb.from("action_messages").insert({ request_id:id, author_id:CG.auth.user.id, body:body }).then(function(r){
      if(r.error){ CG.toast("Couldn’t send: "+r.error.message,"err"); return; }
      CG.toast("Reply added","ok"); CG.refreshActions();
    });
  }); });
  document.querySelectorAll("[data-act-status]").forEach(function(b){ b.addEventListener("click", function(){
    var id=this.getAttribute("data-act-id"), st=this.getAttribute("data-act-status");
    CG.sb.from("action_requests").update({ status:st, updated_at:new Date().toISOString() }).eq("id",id).then(function(r){
      if(r.error){ CG.toast("Couldn’t update: "+r.error.message,"err"); return; }
      CG.toast("Case "+st,"ok"); CG.refreshActions();
    });
  }); });
  document.querySelectorAll("[data-act-respond]").forEach(function(b){ b.addEventListener("click", function(){
    var id=this.getAttribute("data-act-respond");
    CG.modal("Official response",
      '<label class="fld"><span>Response to the member</span><textarea id="arResp" rows="5"></textarea></label>'+
      '<p class="caption">Shown on their case as the league’s written decision — pair it with Resolve or Deny.</p>',
      '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-chrome" id="arGo">Save response</button>');
    document.getElementById("arGo").addEventListener("click", function(){
      var txt=(document.getElementById("arResp").value||"").trim();
      CG.sb.from("action_requests").update({ response:txt||null, updated_at:new Date().toISOString() }).eq("id",id).then(function(r){
        if(r.error){ CG.toast("Couldn’t save: "+r.error.message,"err"); return; }
        if (CG.closeOverlay) CG.closeOverlay(); CG.toast("Response saved","ok"); CG.refreshActions();
      });
    });
  }); });
  document.querySelectorAll("[data-act-del]").forEach(function(b){ b.addEventListener("click", function(){
    var id=this.getAttribute("data-act-del");
    CG.confirm("Delete this case?","It’s removed permanently for everyone. This can’t be undone.","Delete case", function(){
      CG.sb.from("action_requests").delete().eq("id",id).then(function(r){
        if(r.error){ CG.toast("Couldn’t delete: "+r.error.message,"err"); return; }
        CG.toast("Case deleted","ok"); CG.refreshActions();
      });
    });
  }); });
};
/* route the hub + admin complaint views to the live system */
CG.hubComplaints = function(){ return CG.hubComplaintsLive({}); };
CG.hubComplaintDetail = function(){ return CG.hubComplaintsLive({}); };

/* ================================================================
   STAFF DESK — one page for the officials: cases, discipline,
   import spot-checks, and tonight's slate. Staff + commissioner.
   ================================================================ */
CG.hubStaffDesk = function(){
  var lg = CG.lg;
  var reqs = (lg._actionReqs||[]);
  var open = reqs.filter(function(a){ return a.status!=="resolved" && a.status!=="closed"; });
  var sus = (lg.suspensions||[]).filter(function(s){ return s.status==="active"; });
  var now = Date.now();
  var finals = (lg.allResults||[]).slice().sort(function(a,b){ return b.at-a.at; });
  var weekFinals = finals.filter(function(r){ return now - r.at < 7*86400000; });
  var tonight = lg.tonight||[];

  var h = '<div style="margin-bottom:20px"><span class="eyebrow chr">League staff · officials’ tools</span>'+
    '<h1 class="h-sec" style="margin-top:8px">Staff Desk</h1>'+
    '<p class="lede" style="margin-top:8px">The case queue, active discipline, and the imports worth a second look — everything an official touches, in one place.</p></div>';

  h += '<div class="grid g4" style="grid-template-columns:repeat(auto-fill,minmax(170px,1fr));margin-bottom:20px">'+
    '<div class="kpi'+(open.length?" alert":"")+'" style="cursor:pointer" data-go="#/hub/complaints"><b class="num">'+open.length+'</b><span>open cases</span></div>'+
    '<div class="kpi" style="cursor:default"><b class="num">'+sus.length+'</b><span>active suspensions</span></div>'+
    '<div class="kpi" style="cursor:default"><b class="num">'+weekFinals.length+'</b><span>finals · last 7 days</span></div>'+
    '<div class="kpi" style="cursor:pointer" data-go="#/schedule"><b class="num">'+tonight.length+'</b><span>games tonight</span></div></div>';

  /* applications — owner + staff, decided right here */
  var ownerApps = (lg._ownerApps||[]).filter(function(a){ return a.status==="pending"; });
  var staffApps = (lg._staffApps||[]).filter(function(a){ return a.status==="pending"; });
  h += '<div class="card" style="margin-bottom:18px"><div class="card-h"><h3>Applications</h3>'+
    '<span class="chip '+((ownerApps.length+staffApps.length)?"chip-warn":"chip-win")+'">'+
    ((ownerApps.length+staffApps.length)?(ownerApps.length+staffApps.length)+" awaiting a decision":"none pending")+'</span></div>';
  if (staffApps.length){
    h += staffApps.map(function(a){ var prof=a.profiles||{};
      return '<div class="card-b" style="border-top:1px solid var(--line-soft)">'+
        '<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:6px">'+
        '<span><span class="chip chip-chrome" style="font-size:9px">STAFF</span> <b style="font-family:var(--f-disp)">'+esc(prof.gamertag||"Applicant")+'</b></span>'+
        '<span class="caption">'+(a.created_at?CG.fmtDay(Date.parse(a.created_at)):"")+'</span></div>'+
        ((a.departments&&a.departments.length)?'<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">'+a.departments.map(function(k){ return '<span class="chip chip-chrome" style="font-size:9px">'+esc(CG.staffDeptLabel(k))+'</span>'; }).join("")+'</div>':"")+
        '<div class="caption" style="display:flex;gap:14px;flex-wrap:wrap">'+(a.timezone?'<span>TZ '+esc(a.timezone)+'</span>':"")+(a.availability?'<span>'+esc(a.availability)+'</span>':"")+(a.experience?'<span>'+esc(a.experience)+'</span>':"")+'</div>'+
        (a.pitch?'<p class="small" style="color:var(--steel);margin-top:8px;font-style:italic">“'+esc(a.pitch)+'”</p>':"")+
        '<div style="display:flex;gap:8px;margin-top:10px">'+
        '<button class="btn btn-chrome btn-sm" data-sapp-approve="'+a.id+'" data-name="'+esc(prof.gamertag||"the applicant")+'">Approve</button>'+
        '<button class="btn btn-ghost btn-sm" data-sapp-deny="'+a.id+'" data-name="'+esc(prof.gamertag||"the applicant")+'">Deny</button></div></div>';
    }).join("");
  }
  if (ownerApps.length){
    h += ownerApps.map(function(a){ var prof=a.profiles||{};
      return '<div class="card-b" style="border-top:1px solid var(--line-soft)">'+
        '<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:6px">'+
        '<span><span class="chip" style="font-size:9px">OWNER</span> <b style="font-family:var(--f-disp)">'+esc(prof.gamertag||"Applicant")+'</b></span>'+
        '<span class="caption">'+(a.created_at?CG.fmtDay(Date.parse(a.created_at)):"")+'</span></div>'+
        '<div class="caption">'+CG.franchisePicksLine(a)+'</div>'+
        (a.pitch?'<p class="small" style="color:var(--steel);margin-top:8px;font-style:italic">“'+esc(a.pitch)+'”</p>':"")+
        '<div style="display:flex;gap:8px;margin-top:10px">'+
        '<button class="btn btn-chrome btn-sm" data-oapp-approve="'+a.id+'">Approve</button>'+
        '<button class="btn btn-ghost btn-sm" data-oapp-deny="'+a.id+'">Deny</button></div></div>';
    }).join("");
  }
  if (!staffApps.length && !ownerApps.length){
    h += '<div class="card-b"><p class="caption">No applications waiting. Members apply at <b>Apply to own a team</b> (#/owner) and <b>Apply to join the staff</b> (#/staffapply) — both linked in the site footer.</p></div>';
  } else {
    h += '<div class="card-b" style="border-top:1px solid var(--line)"><span class="caption">Approving a staff application promotes the member immediately (Discord role follows on the next sync). Approving an owner application green-lights them — the commissioner then hands them their club in Users &amp; roles → Club role.</span></div>';
  }
  h += '</div>';

  /* case queue preview */
  h += '<div class="card" style="margin-bottom:18px"><div class="card-h"><h3>Case queue</h3>'+
    '<a class="sec-link" href="#/hub/complaints">Open the queue</a></div>';
  h += open.length ? open.slice(0,5).map(function(a){
      return '<div class="card-b" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;border-top:1px solid var(--line-soft)">'+
        '<span class="chip chip-warn" style="text-transform:capitalize">'+esc(a.status||"open")+'</span>'+
        '<b style="font-family:var(--f-disp);flex:1;min-width:160px">'+esc(a.subject||a.kind||"Request")+'</b>'+
        '<span class="caption">'+(a.created_at?CG.fmtDay(Date.parse(a.created_at)):"")+'</span></div>';
    }).join("")
    : '<div class="card-b"><p class="caption">Nothing open — the room is clean.</p></div>';
  h += '</div>';

  /* active discipline */
  h += '<div class="card" style="margin-bottom:18px"><div class="card-h"><h3>Active discipline</h3><span class="chip">'+sus.length+'</span></div>';
  h += sus.length ? sus.map(function(s){
      var p = CG.playerById(lg, s.playerId);
      return '<div class="card-b" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;border-top:1px solid var(--line-soft)">'+
        '<b style="font-family:var(--f-disp)">'+esc(p?p.tag:"A player")+'</b>'+
        '<span class="caption" style="flex:1">'+esc(s.reason||"")+'</span>'+
        '<span class="chip chip-loss">'+(s.mode==="date"?("until "+(s.endsAt?CG.fmtDay(Date.parse(s.endsAt)):"further notice")):(s.games+" game"+(s.games===1?"":"s")))+'</span>'+
        (p?'<a class="btn btn-ghost btn-sm" href="'+CG.playerRoute(p)+'">Profile</a>':"")+'</div>';
    }).join("")
    : '<div class="card-b"><p class="caption">No one is suspended. '+(CG.role()==="commish"?'Suspensions are issued from <a href="#/admin/users" style="font-weight:700;border-bottom:2px solid var(--chrome)">Users &amp; roles</a>.':'The commissioner issues suspensions; the record shows here and on profiles.')+'</p></div>';
  h += '</div>';

  /* recent finals — spot-check the EA imports */
  h += '<div class="card"><div class="card-h"><h3>Recent finals — spot-check the imports</h3><span class="chip">auto-imported from EA</span></div>';
  h += finals.length ? finals.slice(0,6).map(function(r){
      return '<div class="card-b" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;border-top:1px solid var(--line-soft)">'+
        '<span class="mono" style="font-size:11.5px;color:var(--steel);min-width:120px">'+CG.fmtDay(r.at)+'</span>'+
        '<span class="teamcell">'+CG.crest(r.away,20)+'<b class="mono" style="font-size:12px">'+esc(r.away)+' '+r.score[r.away]+'</b></span><span class="caption">@</span>'+
        '<span class="teamcell">'+CG.crest(r.home,20)+'<b class="mono" style="font-size:12px">'+esc(r.home)+' '+r.score[r.home]+'</b></span>'+
        (r.ot?'<span class="chip" style="font-size:9px">OT</span>':"")+
        '<a class="btn btn-ghost btn-sm" style="margin-left:auto" href="#/matchup/'+r.id+'">Box score</a></div>';
    }).join("")
    : '<div class="card-b"><p class="caption">No finals yet — box scores land here automatically as games are played.</p></div>';
  h += '</div>';
  return h;
};
CG.AFTER._staffdesk = function(){
  document.querySelectorAll("[data-sapp-approve]").forEach(function(b){ b.addEventListener("click", function(){
    CG.decideStaffApp(this.getAttribute("data-sapp-approve"), true, this.getAttribute("data-name")); }); });
  document.querySelectorAll("[data-sapp-deny]").forEach(function(b){ b.addEventListener("click", function(){
    CG.decideStaffApp(this.getAttribute("data-sapp-deny"), false, this.getAttribute("data-name")); }); });
  document.querySelectorAll("[data-oapp-approve]").forEach(function(b){ b.addEventListener("click", function(){
    CG.setOwnerAppStatus(this.getAttribute("data-oapp-approve"), "approved"); }); });
  document.querySelectorAll("[data-oapp-deny]").forEach(function(b){ b.addEventListener("click", function(){
    CG.setOwnerAppStatus(this.getAttribute("data-oapp-deny"), "denied"); }); });
};
CG.AFTER._complaints = function(){ CG.AFTER._complaintsLive(); };

/* ================================================================
   LIVE ADMIN: OVERVIEW — real league state, real action items
   ================================================================ */
CG.admOverviewLive = function(){
  var lg = CG.lg;
  var unlinked = (CG.TEAMS||[]).filter(function(t){ return !t.eaClubId; });
  var pendingApps = (lg._ownerApps||[]).filter(function(a){ return a.status==="pending"; });
  var openCases = CG.visibleComplaints().filter(function(c){ return c.status!=="Resolved"; });
  var unsigned = (lg._registrationsRaw||[]).filter(function(r){ return (!r.season_id || r.season_id===((CG.SEASON&&CG.SEASON.id)||null)) && !(lg._rosteredIds||{})[r.profile_id]; });
  var nextG = (lg.schedule||[]).filter(function(g){ return g.status!=="final" && g.at>CG.now(); }).sort(function(a,b){ return a.at-b.at; })[0];
  var days = CG.daysToStart ? CG.daysToStart() : null;
  var draftSt = lg.draftState ? lg.draftState.status : null;
  var h = '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:20px">'+
    '<div class="kpi" style="cursor:pointer" data-go="#/schedule"><b class="num">'+(days!=null?days:"—")+'</b><span>days to puck drop</span></div>'+
    '<div class="kpi'+(unsigned.length?" alert":"")+'" style="cursor:pointer" data-go="#/admin/preseason"><b class="num">'+unsigned.length+'</b><span>free agents unsigned</span></div>'+
    '<div class="kpi'+(pendingApps.length?" alert":"")+'" style="cursor:pointer" data-go="#/admin/preseason"><b class="num">'+pendingApps.length+'</b><span>owner apps pending</span></div>'+
    '<div class="kpi'+(openCases.length?" alert":"")+'" style="cursor:pointer" data-go="#/admin/complaints"><b class="num">'+openCases.length+'</b><span>open cases</span></div>'+
    '<div class="kpi'+(unlinked.length?" alert":"")+'" style="cursor:pointer" data-go="#/admin/eastats"><b class="num">'+((CG.TEAMS||[]).length-unlinked.length)+'/'+(CG.TEAMS||[]).length+'</b><span>clubs EA-linked</span></div>'+
    '<div class="kpi" style="cursor:pointer" data-go="#/admin/automations"><b class="num">5</b><span>automations</span></div></div>';
  var actions = [];
  if (unlinked.length) actions.push(['Link '+unlinked.length+' club'+(unlinked.length===1?"":"s")+' to EA ('+unlinked.map(function(t){return t.code;}).join(", ")+') so their stats auto-import',"#/admin/eastats","EA stats"]);
  if (pendingApps.length) actions.push([pendingApps.length+' owner application'+(pendingApps.length===1?"":"s")+' waiting on a decision',"#/admin/preseason","Review"]);
  if (unsigned.length) actions.push([unsigned.length+' registered player'+(unsigned.length===1?"":"s")+' not yet on a club — sign or draft them',"#/admin/preseason","Pre-season"]);
  if (openCases.length) actions.push([openCases.length+' complaint'+(openCases.length===1?"":"s / requests")+' open in the league office',"#/admin/complaints","Case queue"]);
  if (draftSt && draftSt!=="complete") actions.push(["The draft is "+draftSt,"#/draft","Draft room"]);
  h += '<div class="grid g2" style="align-items:start"><div class="card"><div class="card-h"><h3>Needs your attention</h3>'+(actions.length?'<span class="chip chip-warn">'+actions.length+'</span>':'<span class="chip chip-win">All clear</span>')+'</div>'+
    (actions.length ? actions.map(function(a){
      return '<div class="titem" style="padding:12px 18px;border-top:1px solid var(--line-soft)"><span class="t-dot red"></span><span style="flex:1">'+a[0]+'</span><a class="btn btn-ghost btn-sm" href="'+a[1]+'">'+a[2]+'</a></div>';
    }).join("") : '<div class="card-b"><span class="caption">Nothing pending — registrations, cases, and club links are all handled.</span></div>')+'</div>';
  h += '<div class="stack"><div class="card"><div class="card-h"><h3>Next game night</h3><a class="sec-link" href="#/admin/schedule">Schedule</a></div><div class="card-b">'+
    (nextG ? '<b style="font-family:var(--f-disp);font-size:16px">'+CG.fmtDay(nextG.at)+'</b><p class="caption" style="margin-top:6px">First puck drop '+CG.fmtTime(nextG.at)+' · codes at T-30 · servers set 30 min before the first game.</p>'
           : '<span class="caption">No games scheduled yet.</span>')+'</div></div>'+
    '<div class="card"><div class="card-h"><h3>How results work</h3><a class="sec-link" href="#/admin/eastats">EA stats</a></div><div class="card-b"><p class="small" style="color:var(--steel)">Scores and full box scores import automatically from the EA NHL match record after every final — standings, stats, overalls, news recaps, and Discord posts all follow with no manual entry.</p></div></div></div></div>';
  return h;
};

/* ================================================================
   LIVE ADMIN: AUTOMATIONS — real heartbeats + run-now buttons
   ================================================================ */
CG.AUTOMATIONS = [
  { key:"ea-poll",          name:"EA stats poller",           every:"Every 5 min on game nights (Wed 6pm–Sat 2am ET)", desc:"Pulls finished EA matches and writes scores + box scores." },
  { key:"twitch-live-sync", name:"Twitch live flags",         every:"Every 2 min",  desc:"Flags streaming players LIVE across the site automatically." },
  { key:"discord-sync",     name:"Discord roles & names",     every:"Every 5 min",  desc:"Keeps Discord roles and display names matched to the league database." },
  { key:"discord-welcome",  name:"Discord welcome bot",       every:"Every 5 min",  desc:"Greets new members in #welcome." },
  { key:"discord-scheduler",name:"Discord scheduler",         every:"Every 5 min",  desc:"Posts scheduled league updates to Discord." },
  { key:"rookie-distribution", name:"Rookie placement",       every:"Every 2 min inside the database", desc:"Ten minutes after the draft’s final pick, assigns rookies under the 5-game pre-season minimum to random clubs.", rpc:"distribute_unproven_rookies" },
  { key:"lifecycle-announcements", name:"Lifecycle announcements", every:"Every 5 min inside the database", desc:"Posts registration, pre-season, draft-night, free-agency, and puck-drop reminders to Discord — each exactly once.", rpc:"announce_lifecycle_guarded" }
];
CG.admAutomationsLive = function(){
  var h = '<div style="margin-bottom:16px"><h2 class="h-sec">Automations</h2><p class="lede" style="margin-top:6px">Everything the league runs on its own. Each job also has a <b>Run now</b> for when you don’t want to wait for the next cycle.</p></div>';
  h += '<div class="card">'+CG.AUTOMATIONS.map(function(a,i){
    return '<div class="card-b" style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;'+(i?"border-top:1px solid var(--line-soft)":"")+'">'+
      '<div style="flex:1;min-width:220px"><b style="font-family:var(--f-disp)">'+esc(a.name)+'</b>'+
        '<p class="caption" style="margin-top:2px">'+esc(a.desc)+' '+esc(a.every)+'.</p></div>'+
      '<span class="chip" id="auto-st-'+a.key+'">checking…</span>'+
      '<span class="caption mono" id="auto-ts-'+a.key+'" style="min-width:110px;text-align:right">—</span>'+
      '<button class="btn btn-ghost btn-sm" data-auto-run="'+a.key+'">Run now</button></div>';
  }).join("")+
  '<div class="card-b" style="border-top:1px solid var(--line)"><span class="caption">Also fully automatic, inside the database: standings on every final, auto news (recaps, spotlights, Three Stars), server resolution at lock, and every notification. Those have no off switch — they’re triggers.</span></div></div>';
  return h;
};
CG.AFTER._admAutomations = function(){
  /* heartbeats: each function stamps rl_<key> in app_config on every run */
  CG.sb.from("app_config").select("key,value").like("key","rl_%").then(function(r){
    var map = {}; ((r&&r.data)||[]).forEach(function(row){ map[row.key.replace(/^rl_/,"")]=row.value; });
    CG.AUTOMATIONS.forEach(function(a){
      var ts = map[a.key] ? Date.parse(map[a.key]) : null;
      var stEl = document.getElementById("auto-st-"+a.key), tsEl = document.getElementById("auto-ts-"+a.key);
      if (!stEl) return;
      if (!ts){ stEl.textContent="never ran"; stEl.className="chip chip-warn"; return; }
      var mins = Math.round((Date.now()-ts)/60000);
      tsEl.textContent = mins<1 ? "just now" : mins<60 ? mins+" min ago" : Math.round(mins/60)+" h ago";
      var fresh = mins < 30 || (a.key==="ea-poll" && mins < 24*60);  /* ea-poll only runs in the game window */
      stEl.textContent = fresh ? "Running" : "Check";
      stEl.className = "chip "+(fresh?"chip-win":"chip-warn");
    });
  });
  document.querySelectorAll("[data-auto-run]").forEach(function(b){ b.addEventListener("click", function(){
    var key = this.getAttribute("data-auto-run"), btn=this;
    var job = CG.AUTOMATIONS.find(function(a){ return a.key===key; });
    btn.disabled = true; btn.textContent = "Running…";
    if (job && job.rpc){
      /* database-side job — run it the way the scheduler does */
      CG.sb.rpc(job.rpc).then(function(r){
        btn.disabled=false; btn.textContent="Run now";
        if (r.error){ CG.toast(key+" failed: "+r.error.message,"err"); return; }
        CG.toast(job.name+": "+JSON.stringify(r.data).slice(0,140),"ok");
        if (CG.router) CG.router();
      });
      return;
    }
    fetch("/.netlify/functions/"+key, { method:"GET" }).then(function(r){ return r.json().catch(function(){ return {status:r.status}; }); })
      .then(function(out){
        btn.disabled=false; btn.textContent="Run now";
        CG.toast(key+": "+JSON.stringify(out).slice(0,140),"ok");
        if (CG.router) CG.router();
      })
      .catch(function(e){ btn.disabled=false; btn.textContent="Run now"; CG.toast(key+" failed: "+e.message,"err"); });
  }); });
};

/* ================================================================
   LIVE ADMIN: NEWSROOM — publish / edit / delete on the news table
   (INSERTs auto-post to #news via the notify_discord_news trigger)
   ================================================================ */
CG.NEWS_CATS = ["League News","Game Recap","Transactions","Awards","Commissioner Update","Team Feature"];
CG.admNewsLive = function(){
  var arts = (CG.CONTENT.articles||[]).slice();
  var h = '<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:16px">'+
    '<div><h2 class="h-sec">Newsroom</h2><p class="lede" style="margin-top:6px">Stories publish straight to the site and auto-post to Discord’s #news. Recaps and player spotlights write themselves after finals — everything is editable here.</p></div>'+
    '<button class="btn btn-chrome" id="newArt" style="align-self:flex-start">'+CG.ic("plus",15)+'New story</button></div>';
  h += arts.length ? '<div class="card"><div class="card-h"><h3>Published</h3><span class="chip">'+arts.length+'</span></div>'+
    arts.map(function(a){
      var auto = /CGHL Wire/i.test(a.author||"");
      return '<div class="card-b" style="display:flex;align-items:center;gap:12px;border-top:1px solid var(--line-soft)">'+
        '<span class="nf-ic">'+CG.ic("doc",14)+'</span>'+
        '<div style="flex:1;min-width:0;cursor:pointer" data-go="#/article/'+esc(a.slug)+'"><b>'+esc(a.title)+'</b>'+
          '<p class="caption" style="margin-top:2px">'+esc(a.category)+' · '+esc(a.author)+' · '+CG.fmtDate(a.dateIso)+(auto?' · <span class="chip chip-chrome" style="font-size:9px;padding:1px 7px">AUTO</span>':"")+'</p></div>'+
        '<span style="display:inline-flex;gap:6px"><button class="btn btn-ghost btn-sm" data-news-edit="'+esc(a.slug)+'">Edit</button>'+
        '<button class="btn btn-ghost btn-sm" data-news-del="'+esc(a.slug)+'" data-title="'+esc(a.title)+'">Delete</button></span></div>';
    }).join("")+'</div>'
  : '<div class="card"><div class="empty"><div class="e-art">'+CG.ic("doc",22)+'</div><b>No stories yet</b><p>Publish the first one — or wait for opening night, when recaps start writing themselves.</p></div></div>';
  return h;
};
CG.newsForm = function(slug){
  var a = slug ? (CG.CONTENT.articles||[]).find(function(x){ return x.slug===slug; }) : null;
  var isNew = !a;
  CG.modal(isNew?"New story":"Edit — "+esc(a.title),
    '<label class="fld"><span>Headline</span><input id="nwT" value="'+esc(a?a.title:"")+'" placeholder="Sentence case, specific, no clickbait"></label>'+
    '<label class="fld"><span>Category</span><select id="nwC">'+CG.NEWS_CATS.map(function(c){ return '<option'+(a&&a.category===c?" selected":"")+'>'+c+'</option>'; }).join("")+'</select></label>'+
    '<label class="fld"><span>Body</span><textarea id="nwB" rows="8" placeholder="Write like a beat reporter. Blank lines become paragraphs.">'+esc(a?a.body.join("\n\n"):"")+'</textarea></label>'+
    '<p class="caption">'+(isNew?"Publishing posts to the site immediately and announces in #news on Discord.":"Edits update the site — Discord isn’t re-posted.")+'</p>',
    '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-chrome" id="nwGo">'+(isNew?"Publish":"Save changes")+'</button>');
  document.getElementById("nwGo").addEventListener("click", function(){
    var t=(document.getElementById("nwT").value||"").trim();
    if (t.length<8){ CG.toast("Give it a real headline first","err"); return; }
    var body=(document.getElementById("nwB").value||"").trim();
    if (!body){ CG.toast("Write the story body","err"); return; }
    var rec={ title:t, category:document.getElementById("nwC").value, body:body };
    var btn=this; btn.disabled=true;
    var q = isNew
      ? CG.sb.from("news").insert(Object.assign({}, rec, { author:((CG.auth.profile&&CG.auth.profile.gamertag)||"Commissioner")+" — Commissioner", published_at:new Date().toISOString(), season_id:(CG.SEASON&&CG.SEASON.id)||null }))
      : CG.sb.from("news").update(rec).eq("id", slug);
    q.then(function(r){
      btn.disabled=false;
      if (r.error){ CG.toast("Couldn’t save: "+r.error.message,"err"); return; }
      if (CG.closeOverlay) CG.closeOverlay();
      CG.toast(isNew?"Published — it’s live and posted to #news":"Story updated","ok");
      CG.reloadLeague();
    });
  });
};
CG.AFTER._admNewsLive = function(){
  var na=document.getElementById("newArt");
  if (na) na.addEventListener("click", function(){ CG.newsForm(null); });
  document.querySelectorAll("[data-news-edit]").forEach(function(b){ b.addEventListener("click", function(){ CG.newsForm(this.getAttribute("data-news-edit")); }); });
  document.querySelectorAll("[data-news-del]").forEach(function(b){ b.addEventListener("click", function(){
    var id=this.getAttribute("data-news-del"), title=this.getAttribute("data-title");
    CG.confirm("Delete “"+esc(title)+"”?","It comes off the site immediately. The Discord post (if any) stays.","Delete story", function(){
      CG.sb.from("news").delete().eq("id",id).then(function(r){
        if(r.error){ CG.toast("Couldn’t delete: "+r.error.message,"err"); return; }
        CG.toast("Story deleted","ok"); CG.reloadLeague();
      });
    });
  }); });
};

/* ================================================================
   LIVE ADMIN: POWER RANKINGS — automatic formula + manual override
   ================================================================ */
CG.admRankingsLive = function(){
  var lg = CG.lg;
  var order = CG._prDraft || (lg.powerRankings||[]).map(function(p){ return p.team; });
  var dirty = !!CG._prDraft;
  var manual = !!lg.prManual;
  var h = '<div style="margin-bottom:16px"><h2 class="h-sec">Power rankings</h2><p class="lede" style="margin-top:6px">'+
    (manual ? "Running on your <b>manual order</b>. The formula keeps computing underneath — return to automatic any time."
            : "Running on the <b>automatic formula</b>: points percentage, goal differential per game, and last-five form. Reorder below to take manual control.")+'</p></div>';
  h += '<div class="note '+(manual?"chr":"grn")+'" style="margin-bottom:16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap"><b style="font-family:var(--f-disp)">'+(manual?"Manual override active":"Automatic")+'</b>'+
    '<span style="margin-left:auto;display:inline-flex;gap:8px">'+
    (dirty?'<button class="btn btn-chrome btn-sm" id="prSave">Save this order</button><button class="btn btn-ghost btn-sm" id="prDiscard">Discard changes</button>':"")+
    (manual&&!dirty?'<button class="btn btn-ghost btn-sm" id="prAuto">Return to automatic</button>':"")+'</span></div>';
  h += '<div class="card">'+order.map(function(code,i){
    var t = CG.TEAM[code]; if (!t) return "";
    return '<div class="card-b" style="display:flex;align-items:center;gap:14px;'+(i?"border-top:1px solid var(--line-soft)":"")+'">'+
      '<b class="num" style="font-family:var(--f-disp);font-size:20px;width:28px">'+(i+1)+'</b>'+CG.crest(code,28)+
      '<b style="font-family:var(--f-disp);flex:1">'+esc(t.name)+'</b>'+
      '<span class="caption">'+CG.lg.teams[code].w+"-"+CG.lg.teams[code].l+"-"+CG.lg.teams[code].otl+'</span>'+
      '<span style="display:inline-flex;gap:4px">'+
        '<button class="btn btn-ghost btn-sm" data-pr-up="'+i+'" '+(i===0?"disabled":"")+' aria-label="Move '+esc(t.name)+' up">'+CG.ic("up",13)+'</button>'+
        '<button class="btn btn-ghost btn-sm" data-pr-down="'+i+'" '+(i===order.length-1?"disabled":"")+' aria-label="Move '+esc(t.name)+' down">'+CG.ic("down",13)+'</button></span></div>';
  }).join("")+
  '<div class="card-b" style="border-top:1px solid var(--line)"><span class="caption">The public rankings page and the homepage widget follow whatever is live here. Manual orders persist until you return to automatic.</span></div></div>';
  return h;
};
CG.AFTER._admRankings = function(){
  function draft(){ return CG._prDraft || (CG.lg.powerRankings||[]).map(function(p){ return p.team; }); }
  document.querySelectorAll("[data-pr-up]").forEach(function(b){ b.addEventListener("click", function(){
    var i=+this.getAttribute("data-pr-up"); var d=draft().slice();
    var x=d[i-1]; d[i-1]=d[i]; d[i]=x; CG._prDraft=d; CG.router();
  }); });
  document.querySelectorAll("[data-pr-down]").forEach(function(b){ b.addEventListener("click", function(){
    var i=+this.getAttribute("data-pr-down"); var d=draft().slice();
    var x=d[i+1]; d[i+1]=d[i]; d[i]=x; CG._prDraft=d; CG.router();
  }); });
  var sv=document.getElementById("prSave");
  if (sv) sv.addEventListener("click", function(){
    CG.sb.from("site_config").upsert({ key:"power_rankings_override", value:{ order: CG._prDraft }, updated_at:new Date().toISOString() },{ onConflict:"key" }).then(function(r){
      if (r.error){ CG.toast("Couldn’t save: "+r.error.message,"err"); return; }
      CG._prDraft=null; CG.toast("Manual ranking saved — live everywhere","ok"); CG.reloadLeague();
    });
  });
  var dc=document.getElementById("prDiscard");
  if (dc) dc.addEventListener("click", function(){ CG._prDraft=null; CG.router(); });
  var au=document.getElementById("prAuto");
  if (au) au.addEventListener("click", function(){
    CG.sb.from("site_config").delete().eq("key","power_rankings_override").then(function(r){
      if (r.error){ CG.toast("Couldn’t switch: "+r.error.message,"err"); return; }
      CG.toast("Back to the automatic formula","ok"); CG.reloadLeague();
    });
  });
};

/* ================================================================
   LIVE ADMIN: HOMEPAGE MODULES — persisted league-wide via feature_flags
   ================================================================ */
CG.admHomepageLive = function(){
  return '<div style="margin-bottom:16px"><h2 class="h-sec">Homepage</h2><p class="lede" style="margin-top:6px">Toggle front-page modules for everyone — saved to the league database, applied on the next load.</p></div>'+
    '<div class="card"><div class="card-h"><h3>Homepage modules</h3><a class="sec-link" href="#/home">View front page</a></div>'+
    CG.HOMEMODS.map(function(m){
      var on = CG.modOn(m.key);
      return '<div style="display:flex;align-items:center;gap:12px;padding:12px 18px;border-top:1px solid var(--line-soft)">'+
        '<span style="flex:1;font-weight:600;font-size:14px">'+m.label+'</span>'+
        '<button class="toggle'+(on?" on":"")+'" data-mod-live="'+m.key+'" role="switch" aria-checked="'+on+'" aria-label="'+m.label+'"></button></div>';
    }).join("")+
    '<div class="card-b" style="border-top:1px solid var(--line)"><span class="caption">Sections hidden here disappear for every visitor. The hero, and anything a section needs to explain the season, stays.</span></div></div>';
};
CG.AFTER._admHomepage = function(){
  document.querySelectorAll("[data-mod-live]").forEach(function(t){
    t.addEventListener("click", function(){
      var k = t.getAttribute("data-mod-live");
      var next = !CG.modOn(k);
      CG.sb.from("feature_flags").upsert({ key:"home_"+k, enabled:next, label:"Homepage: "+k },{ onConflict:"key" }).then(function(r){
        if (r.error){ CG.toast("Couldn’t save: "+r.error.message,"err"); return; }
        CG._flags["home_"+k]=next;
        t.classList.toggle("on", next); t.setAttribute("aria-checked", next);
        CG.toast("Front page updated for everyone","ok");
      });
    });
  });
};

/* ================================================================
   LIVE ADMIN: SCHEDULE — real reschedules (games.scheduled_at, ET)
   ================================================================ */
/* round-robin schedule generator (ported from the classic site, verified in prod
   there): 3 ET slots a night, Wed + Fri, every club plays once per slot —
   3 a night, 6 a week. Regular season = GAMES_PER_CLUB slots; pre-season = 2 weeks.
   Game weeks that touch Christmas, Canada Day, or US Independence Day are skipped. */
CG.GAMES_PER_CLUB = 54;
CG.PRESEASON_WEEKS = 2;
CG.OFFSEASON_DARK_DAYS = 14;   /* 2 weeks of no on-ice activity — staff seat owners + management */
CG.FA_WINDOW_DAYS = 7;         /* free agency runs a full week; puck drop waits for it to close */
CG.NIGHT_SLOTS = ["21:00","21:35","22:10"];
CG.HOLIDAYS = ["12-25","07-01","07-04"];

/* One timeline card, shared by the Register page and My Hub, so a member sees the same road
   ahead in both places. Steps auto-hide until their date is set. */
CG.roadAheadCard = function(s, opts){
  s = s || CG.SEASON || {}; opts = opts || {};
  var steps = [
    [s.offseason_starts_at, "Off-season begins", "Two weeks of no games while the league seats team owners and their management staff."],
    [s.registration_deadline, "Sign-up deadline", "Register by now to be eligible for the draft. Miss it and you can still join — you’ll be randomly placed on a club after the draft instead."],
    [s.preseason_starts_at, "Pre-season opens", "You’re randomly assigned to a club for two weeks of real games. First-year players need five appearances to be draft-eligible."],
    [s.draft_at, "Draft night", "Clubs pick from the eligible pool. Ten minutes after the final pick, first-year players under the five-game minimum are placed on random clubs."],
    [s.free_agency_opens_at, "Free agency opens", "A one-week window where clubs sign the remaining free agents at negotiated salaries."],
    [s.starts_at, "Puck drop", "The regular season starts once free agency closes — 54 games, every stat imported automatically from EA."]
  ].filter(function(st){ return st[0]; });
  if (!steps.length) return "";
  var nowT = CG.now(), nextIdx = steps.findIndex(function(st){ return Date.parse(st[0]) > nowT; });
  return '<div class="card" style="margin-bottom:18px"><div class="card-h"><h3>The road ahead</h3><span class="chip">'+(opts.chip||"what registering starts")+'</span></div>'+
    steps.map(function(st,i){
      var t = Date.parse(st[0]), past = t <= nowT, isNext = i===nextIdx;
      return '<div class="card-b" style="display:flex;gap:14px;align-items:flex-start;'+(i?"border-top:1px solid var(--line-soft)":"")+(past?"opacity:.5":"")+'">'+
        '<span class="mono" style="flex:0 0 150px;font-size:11.5px;color:var(--steel);padding-top:2px">'+CG.fmtFull(t)+(isNext?' <span class="chip chip-chrome" style="font-size:9px;vertical-align:middle">NEXT UP</span>':past?' <span style="font-size:9px;color:var(--steel)">✓</span>':"")+'</span>'+
        '<span style="min-width:0"><b style="font-family:var(--f-disp)">'+st[1]+'</b><p class="caption" style="margin-top:2px">'+st[2]+'</p></span></div>';
    }).join("")+'</div>';
};

/* ---- shared ET-safe date helpers ---- */
CG.dayAdd = function(ymd, n){
  var p=ymd.split("-").map(Number);
  var d=new Date(Date.UTC(p[0],p[1]-1,p[2],12));
  d.setUTCDate(d.getUTCDate()+n);
  return d.getUTCFullYear()+"-"+String(d.getUTCMonth()+1).padStart(2,"0")+"-"+String(d.getUTCDate()).padStart(2,"0");
};
CG.dayOfWeek = function(ymd){ var p=ymd.split("-").map(Number); return new Date(Date.UTC(p[0],p[1]-1,p[2],12)).getUTCDay(); };
CG.etISO = function(ymd, hm){ /* correct across EDT/EST */
  var guess = new Date(ymd+"T"+hm+":00-04:00");
  var et = new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",hour:"2-digit",minute:"2-digit",hour12:false}).format(guess);
  if (et !== hm) guess = new Date(ymd+"T"+hm+":00-05:00");
  return guess.toISOString();
};
CG.etYMD = function(iso){ return new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York"}).format(new Date(iso)); };
CG.holidayWeek = function(wedYmd){ /* the Mon..Sun week around a game Wednesday */
  var mon = CG.dayAdd(wedYmd,-2);
  for (var i=0;i<7;i++){ if (CG.HOLIDAYS.indexOf(CG.dayAdd(mon,i).slice(5))>=0) return true; }
  return false;
};
CG.gameNights = function(anchorYmd, weeks){ /* snap to Wednesday, skip holiday weeks */
  var wed = anchorYmd;
  while (CG.dayOfWeek(wed)!==3) wed = CG.dayAdd(wed,1);
  var out=[], skipped=[], guard=0;
  while (out.length < weeks && guard++ < 60){
    if (CG.holidayWeek(wed)){ skipped.push(wed); wed = CG.dayAdd(wed,7); continue; }
    out.push({ week: out.length+1, wed: wed, fri: CG.dayAdd(wed,2) });
    wed = CG.dayAdd(wed,7);
  }
  return { nights: out, skipped: skipped };
};

CG.generateSchedule = function(stage){
  stage = stage==="preseason" ? "preseason" : "regular";
  var s = CG.SEASON;
  if (!s || !s.id){ CG.toast("Create a season first — the schedule hangs off it","err"); return; }
  var anchorIso = stage==="preseason" ? s.preseason_starts_at : s.starts_at;
  if (!anchorIso){ CG.toast("Set the "+(stage==="preseason"?"pre-season":"season")+" start date in Seasons first (Auto-space fills it)","err"); return; }
  var codes = (CG.TEAMS||[]).map(function(t){ return t.code; });
  if (codes.length<2){ CG.toast("You need at least two clubs to build a schedule","err"); return; }
  if ((CG.lg.schedule||[]).some(function(g){ return g.stage===stage; })){
    CG.toast("A "+(stage==="preseason"?"pre-season":"regular-season")+" schedule already exists — clear it first","err"); return; }
  var perNight=CG.NIGHT_SLOTS.length;
  var slots = stage==="preseason" ? CG.PRESEASON_WEEKS*2*perNight : CG.GAMES_PER_CLUB;
  var weeks = Math.ceil(slots/perNight/2);
  var plan = CG.gameNights(CG.etYMD(anchorIso), weeks);
  var skipNote = plan.skipped.length ? " Holiday week"+(plan.skipped.length===1?"":"s")+" skipped: "+plan.skipped.join(", ")+"." : "";
  CG.confirm("Generate the "+(stage==="preseason"?"pre-season":esc(s.name||"season")+" schedule")+"?",
    codes.length+" clubs · "+slots+" games each · 3 a night, 6 a week (Wed + Fri, 9:00 / 9:35 / 10:10 PM ET) · "+weeks+" weeks from "+plan.nights[0].wed+"."+skipNote,
    "Generate "+(stage==="preseason"?"pre-season":"schedule"), function(){
    function rrRotate(a,r){ var n=a.length,out=[]; for(var i=0;i<n;i++) out.push(a[(i+r)%n]); return out; }
    var dates=[];
    plan.nights.forEach(function(n){ dates.push({week:n.week,date:n.wed}); dates.push({week:n.week,date:n.fri}); });
    var arr=codes.slice(); if (arr.length%2) arr.push(null);
    var m=arr.length, fixed=arr[0], others=arr.slice(1), rows=[];
    for (var r=0; r<slots; r++){
      var day=dates[Math.floor(r/perNight)]; if(!day) continue;
      var iso=CG.etISO(day.date, CG.NIGHT_SLOTS[r%perNight]);
      var order=[fixed].concat(rrRotate(others,r));
      for (var i=0;i<m/2;i++){
        var a=order[i], b=order[m-1-i]; if(!a||!b) continue;
        if (r%2===1){ var t=a; a=b; b=t; }
        rows.push({ season_id:s.id, week:day.week, stage:stage, home_team_id:(CG.lg._codeToId||{})[a], away_team_id:(CG.lg._codeToId||{})[b], scheduled_at:iso, status:"scheduled" });
      }
    }
    var chunks=[]; for (var c=0;c<rows.length;c+=100) chunks.push(rows.slice(c,c+100));
    (function insertNext(idx){
      if (idx>=chunks.length){ CG.toast(rows.length+" "+(stage==="preseason"?"pre-season ":"")+"games generated — "+slots+"/club over "+weeks+" weeks","ok"); CG.reloadLeague(); return; }
      CG.sb.from("games").insert(chunks[idx]).then(function(rz){
        if (rz.error){ CG.toast("Generation stopped: "+rz.error.message,"err"); CG.reloadLeague(); return; }
        insertNext(idx+1);
      });
    })(0);
  });
};
CG.clearSchedule = function(stage){
  stage = stage==="preseason" ? "preseason" : "regular";
  var s = CG.SEASON; if (!s || !s.id) return;
  var mine = (CG.lg.schedule||[]).filter(function(g){ return g.stage===stage; });
  if (!mine.length) return;
  var played = mine.filter(function(g){ return g.status==="final"; }).length;
  CG.confirm("Clear the "+(stage==="preseason"?"pre-season":"regular-season")+" schedule?",
    mine.length+" games go, including their codes and server picks"+(played?" — and "+played+" finals WITH their box scores":"")+". This can’t be undone.",
    "Clear "+(stage==="preseason"?"pre-season":"schedule"), function(){
    CG.sb.from("games").delete().eq("season_id", s.id).eq("stage", stage).then(function(r){
      if (r.error){ CG.toast("Couldn’t clear: "+r.error.message,"err"); return; }
      CG.toast((stage==="preseason"?"Pre-season":"Regular season")+" cleared","ok"); CG.reloadLeague();
    });
  });
};
CG.admScheduleLive = function(){
  var lg = CG.lg;
  var pre = lg.schedule.filter(function(g){ return g.stage==="preseason"; });
  var reg = lg.schedule.filter(function(g){ return g.stage!=="preseason"; });
  var future = lg.schedule.filter(function(g){ return g.status!=="final"; }).sort(function(a,b){ return a.at-b.at; });
  var h = '<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:16px"><div><h2 class="h-sec">Schedule</h2><p class="lede" style="margin-top:6px">'+
    (lg.schedule.length ? future.length+' games to play. Move any game — the EA auto-import matches by clubs + date, so stats follow a rescheduled game automatically.'
                        : 'No games yet. Generate the pre-season and the regular season from the dates in Seasons, then fine-tune any game time by hand. Weeks touching Christmas, Canada Day, or July 4 are skipped automatically.')+'</p></div>'+
    '<span style="display:inline-flex;gap:8px;align-self:flex-start;flex-wrap:wrap">'+
    (pre.length ? '<button class="btn btn-ghost" id="preClear">Clear pre-season ('+pre.length+')</button>'
                : '<button class="btn btn-ghost" id="preGen">'+CG.ic("plus",15)+'Generate pre-season</button>')+
    (reg.length ? '<button class="btn btn-ghost" id="schedClear">Clear season ('+reg.length+')</button>'
                : '<button class="btn btn-chrome" id="schedGen">'+CG.ic("plus",15)+'Generate season</button>')+'</span></div>';
  h += '<div class="card"><div class="card-h"><h3>Upcoming slate</h3><span class="chip">next '+Math.min(future.length,16)+' shown</span></div>'+
    future.slice(0,16).map(function(g){
      return '<div class="card-b" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;border-top:1px solid var(--line-soft)">'+
        '<span class="mono" style="font-size:11.5px;color:var(--steel);min-width:170px">'+CG.fmtFull(g.at)+'</span>'+
        (g.stage==="preseason"?'<span class="chip" style="font-size:9px">PRE</span>':g.stage==="playoff"?'<span class="chip chip-chrome" style="font-size:9px">PO</span>':"")+
        '<span class="teamcell">'+CG.crest(g.away,20)+'<span class="mono" style="font-size:12px">'+esc(g.away)+'</span></span><span class="caption">@</span>'+
        '<span class="teamcell">'+CG.crest(g.home,20)+'<span class="mono" style="font-size:12px">'+esc(g.home)+'</span></span>'+
        '<span style="margin-left:auto;display:inline-flex;gap:6px"><a class="btn btn-ghost btn-sm" href="#/matchup/'+g.id+'">Open</a>'+
        '<button class="btn btn-ghost btn-sm" data-resched-live="'+g.id+'">Reschedule</button>'+
        '<button class="btn btn-ghost btn-sm" data-forfeit-live="'+g.id+'">Forfeit</button></span></div>';
    }).join("")+
    '<div class="card-b" style="border-top:1px solid var(--line)"><span class="caption">All times Eastern. Moving a game keeps its lobby code and server picks; both clubs see the change instantly. <b>Forfeit</b> records a game a club didn’t show for — a 1-0 win for the opponent with no player stats (Rule 5.3), which also clears the game from release and playoff gates.</span></div></div>';
  return h;
};
CG.AFTER._admScheduleLive = function(){
  var gen=document.getElementById("schedGen");
  if (gen) gen.addEventListener("click", function(){ CG.generateSchedule("regular"); });
  var pgen=document.getElementById("preGen");
  if (pgen) pgen.addEventListener("click", function(){ CG.generateSchedule("preseason"); });
  var clr=document.getElementById("schedClear");
  if (clr) clr.addEventListener("click", function(){ CG.clearSchedule("regular"); });
  var pclr=document.getElementById("preClear");
  if (pclr) pclr.addEventListener("click", function(){ CG.clearSchedule("preseason"); });
  document.querySelectorAll("[data-resched-live]").forEach(function(b){ b.addEventListener("click", function(){
    var id=this.getAttribute("data-resched-live");
    var g=CG.lg.schedule.find(function(x){ return x.id===id; }); if(!g) return;
    var cur=new Date(g.at);
    var et = new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}).formatToParts(cur);
    var part = function(t){ return (et.find(function(x){return x.type===t;})||{}).value; };
    var val = part("year")+"-"+part("month")+"-"+part("day")+"T"+part("hour")+":"+part("minute");
    CG.modal("Reschedule — "+esc(g.away)+" @ "+esc(g.home),
      '<label class="fld"><span>New date &amp; time (Eastern)</span><input type="datetime-local" id="rsWhen" value="'+val+'"></label>'+
      '<p class="caption">Both clubs see the new time immediately; codes and server picks carry over.</p>',
      '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-chrome" id="rsGo">Reschedule</button>');
    document.getElementById("rsGo").addEventListener("click", function(){
      var v=document.getElementById("rsWhen").value;
      if(!v){ CG.toast("Pick the new date and time","err"); return; }
      var iso=CG.etISO(v.slice(0,10), v.slice(11,16));
      CG.sb.from("games").update({ scheduled_at: iso }).eq("id",id).then(function(r){
        if(r.error){ CG.toast("Couldn’t reschedule: "+r.error.message,"err"); return; }
        if (CG.closeOverlay) CG.closeOverlay();
        CG.toast("Game moved to "+CG.fmtFull(Date.parse(iso)),"ok"); CG.reloadLeague();
      });
    });
  }); });
  document.querySelectorAll("[data-forfeit-live]").forEach(function(b){ b.addEventListener("click", function(){
    CG.declareForfeitPrompt(this.getAttribute("data-forfeit-live"));
  }); });
};
/* Commissioner: record a forfeit (LG §5.3) — 1-0 to the club that showed, no player stats.
   The "neither played" option voids the game (LG has no double-forfeit rule) and keeps it out
   of the standings while still clearing the release / playoff gates. */
CG.declareForfeitPrompt = function(id){
  var g=CG.lg.schedule.find(function(x){ return x.id===id; }); if(!g) return;
  var homeName=(CG.TEAM[g.home]||{}).name||g.home, awayName=(CG.TEAM[g.away]||{}).name||g.away;
  CG.modal("Declare a forfeit — "+esc(g.away)+" @ "+esc(g.home),
    '<label class="fld"><span>What happened?</span><select id="ffWho">'+
      '<option value="away">'+esc(awayName)+' (away) forfeited → '+esc(homeName)+' wins 1-0</option>'+
      '<option value="home">'+esc(homeName)+' (home) forfeited → '+esc(awayName)+' wins 1-0</option>'+
      '<option value="void">Neither club played → void (no result, kept out of the standings)</option>'+
    '</select></label>'+
    '<p class="caption">A forfeit is recorded as a 1-0 win with no individual stats (Rule 5.3). The losing club still burns the game toward its weekly count. The league has no double-forfeit rule, so a game neither club played is voided rather than scored. Reversible from the game once declared.</p>',
    '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-chrome" id="ffGo">Record it</button>');
  document.getElementById("ffGo").addEventListener("click", function(){
    var who=document.getElementById("ffWho").value;
    var forfeiterCode = who==="away"?g.away : who==="home"?g.home : null;
    var forfeiterId = forfeiterCode ? (CG.lg._codeToId||{})[forfeiterCode] : null;
    CG.sb.rpc("declare_forfeit",{ p_game:id, p_forfeit_team:forfeiterId, p_void: who==="void" }).then(function(r){
      if(r.error){ CG.toast("Couldn’t record: "+r.error.message,"err"); return; }
      if (CG.closeOverlay) CG.closeOverlay();
      CG.toast(who==="void"?"Game voided":"Forfeit recorded — 1-0","ok"); CG.reloadLeague();
    });
  });
};

/* ================================================================
   LIVE ADMIN: RATINGS — the automated overall pipeline, in the open
   ================================================================ */
CG.admRatingsLive = function(){
  var lg = CG.lg;
  var list = lg.players.slice().sort(function(a,b){ return (lg.ratings[b.id].ovr||0)-(lg.ratings[a.id].ovr||0); });
  return '<div style="margin-bottom:16px"><h2 class="h-sec">Overall ratings</h2><p class="lede" style="margin-top:6px">Overalls are <b>fully automated</b>: recomputed from EA box scores after every final, position-weighted, regressed while samples are small. Pre-season scouting values are set per player in <a href="#/admin/preseason" style="font-weight:700;border-bottom:2px solid var(--chrome)">Pre-season Central</a>.</p></div>'+
    '<div class="card"><div class="card-h"><h3>Current overalls</h3><span class="chip">'+list.length+' rostered</span></div>'+
    '<div class="tblwrap"><table class="tbl keepcols"><caption>Rostered players by overall</caption><thead><tr><th class="tleft">Player</th><th>POS</th><th class="tleft">Club</th><th>GP</th><th>OVR</th></tr></thead><tbody>'+
    list.map(function(p){ var s=lg.pstats[p.id];
      return '<tr class="rowlink" style="--tc:'+CG.TEAM[p.team].color+'" data-go="'+CG.playerRoute(p)+'">'+
        '<td class="tleft"><span class="playercell"><span class="nm">'+esc(p.tag)+'</span></span></td>'+
        '<td class="tnum">'+p.pos+'</td><td class="tleft">'+esc(CG.TEAM[p.team].code)+'</td><td>'+(s?s.gp:0)+'</td>'+
        '<td><span class="ovrbox '+CG.ovrClass(lg.ratings[p.id].ovr)+'" style="min-width:34px;height:24px;font-size:13px">'+lg.ratings[p.id].ovr+'</span></td></tr>';
    }).join("")+'</tbody></table></div>'+
    '<div class="card-b" style="border-top:1px solid var(--line)"><span class="caption">New players open at 70 (provisional until 5 games). The formula lives in the database (compute_overall) — the site never hand-edits a rating, so every number stays defensible.</span></div></div>';
};

/* ================================================================
   LIVE ADMIN: SEASONS — create, edit every setting, delete (guarded)
   ================================================================ */
CG._seasonsRaw = CG._seasonsRaw || [];
CG.admSeasonsLive = function(){
  var list = (CG._seasonsRaw||[]).slice().sort(function(a,b){ return (b.number||0)-(a.number||0); });
  var h = '<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:16px">'+
    '<div><h2 class="h-sec">Seasons</h2><p class="lede" style="margin-top:6px">The league’s campaigns — every setting is yours: dates, cap, roster size, registration windows, deadlines. The newest season is the one the whole site runs on.</p></div>'+
    '<button class="btn btn-chrome" id="seasonAdd" style="align-self:flex-start">'+CG.ic("plus",15)+'New season</button></div>';
  h += list.length ? list.map(function(s){
    var live = CG.SEASON && CG.SEASON.id===s.id;
    var st = s.status==="active"?"chip-win":s.status==="complete"?"chip":"chip-chrome";
    return '<div class="card" style="margin-bottom:14px"><div class="card-h"><h3>'+esc(s.name||("Season "+s.number))+'</h3>'+
      '<span style="display:inline-flex;gap:8px;align-items:center">'+(live?'<span class="chip chip-chrome">Site runs on this</span>':"")+
      '<span class="chip '+st+'">'+esc(s.status)+'</span>'+(s.registration_open?'<span class="chip chip-win">Registration open</span>':"")+'</span></div>'+
      '<div class="card-b"><div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px">'+
        [["Number", s.number],
         ["Pre-season", s.preseason_starts_at?CG.fmtDay(Date.parse(s.preseason_starts_at)):"—"],
         ["Draft", s.draft_at?CG.fmtDay(Date.parse(s.draft_at)):"—"],
         ["Free agency", s.free_agency_opens_at?(CG.fmtDay(Date.parse(s.free_agency_opens_at))+" – "+(s.free_agency_closes_at?CG.fmtDay(Date.parse(s.free_agency_closes_at)):"?")):"—"],
         ["Season starts", s.starts_at?CG.fmtDay(Date.parse(s.starts_at)):"—"],
         ["Season ends", s.ends_at?CG.fmtDay(Date.parse(s.ends_at)):"—"],
         ["Playoffs", s.playoffs_start_at?CG.fmtDay(Date.parse(s.playoffs_start_at)):"—"],
         ["Salary cap", s.salary_cap?("$"+(s.salary_cap/1e6)+"M"):"—"],
         ["Roster max", s.roster_max||"—"],
         ["Trade deadline", s.trade_deadline_week?("Week "+s.trade_deadline_week):"—"],
         ["Registration closes", s.registration_deadline?CG.fmtDay(Date.parse(s.registration_deadline)):"—"],
         ["Owner apps close", s.owner_app_deadline?CG.fmtDay(Date.parse(s.owner_app_deadline)):"—"],
         ["Roster moves", s.moves_lock_override||"auto"]
        ].map(function(kv){ return '<div class="kpi" style="cursor:default"><b class="num" style="font-size:16px">'+kv[1]+'</b><span>'+kv[0]+'</span></div>'; }).join("")+'</div>'+
      '<div style="display:flex;gap:8px;margin-top:14px"><button class="btn btn-ghost btn-sm" data-season-edit="'+s.id+'">Edit settings</button>'+
      '<button class="btn btn-ghost btn-sm" data-season-del="'+s.id+'" data-name="'+esc(s.name||("Season "+s.number))+'" style="margin-left:auto">Delete season</button></div></div></div>';
  }).join("")
  : '<div class="card"><div class="empty"><div class="e-art">'+CG.ic("db",22)+'</div><b>No seasons yet</b><p>Create one to open registration and start scheduling — the site shows clean off-season states until then.</p></div></div>';
  return h;
};
CG.seasonForm = function(id){
  var s = id ? (CG._seasonsRaw||[]).find(function(x){ return x.id===id; }) : null;
  var isNew = !s;
  var maxN = (CG._seasonsRaw||[]).reduce(function(m,x){ return Math.max(m, x.number||0); }, 0);
  s = s || { name:"Season "+(maxN+1), number:maxN+1, status:"upcoming", registration_open:true,
             salary_cap:60000000, roster_max:12, trade_deadline_week:6, moves_lock_override:"auto" };
  function dt(v){ /* ISO -> datetime-local in ET */
    if (!v) return "";
    var p = new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}).formatToParts(new Date(v));
    var g = function(t){ return (p.find(function(x){return x.type===t;})||{}).value; };
    return g("year")+"-"+g("month")+"-"+g("day")+"T"+g("hour")+":"+g("minute");
  }
  CG.modal(isNew?"New season":"Season settings — "+esc(s.name||""),
    '<div class="grid g2" style="gap:12px">'+
    '<label class="fld"><span>Name</span><input id="ssName" value="'+esc(s.name||"")+'" placeholder="e.g. Season 2"></label>'+
    '<label class="fld"><span>Number</span><input id="ssNum" type="number" min="1" value="'+(s.number||1)+'"></label>'+
    '<label class="fld"><span>Status</span><select id="ssStatus">'+["upcoming","active","complete"].map(function(x){ return '<option'+(s.status===x?" selected":"")+'>'+x+'</option>'; }).join("")+'</select></label>'+
    '<label class="fld"><span>Registration</span><select id="ssRegOpen"><option value="1"'+(s.registration_open?" selected":"")+'>Open</option><option value="0"'+(!s.registration_open?" selected":"")+'>Closed</option></select></label>'+
    '<label class="fld"><span>Off-season begins (ET)</span><input type="datetime-local" id="ssOff" value="'+dt(s.offseason_starts_at)+'"></label>'+
    '<label class="fld" style="align-self:end"><span>&nbsp;</span><button class="btn btn-ghost" id="ssSpace" type="button" style="width:100%">Auto-space the whole timeline</button></label>'+
    '<label class="fld"><span>Sign-up / draft-eligibility deadline (ET)</span><input type="datetime-local" id="ssRegDl" value="'+dt(s.registration_deadline)+'"></label>'+
    '<label class="fld"><span>Owner apps close (ET)</span><input type="datetime-local" id="ssOwnDl" value="'+dt(s.owner_app_deadline)+'"></label>'+
    '<label class="fld"><span>Pre-season starts (ET)</span><input type="datetime-local" id="ssPre" value="'+dt(s.preseason_starts_at)+'"></label>'+
    '<label class="fld"><span>Draft night (ET)</span><input type="datetime-local" id="ssDraft" value="'+dt(s.draft_at)+'"></label>'+
    '<label class="fld"><span>Free agency opens (ET)</span><input type="datetime-local" id="ssFaOpen" value="'+dt(s.free_agency_opens_at)+'"></label>'+
    '<label class="fld"><span>Free agency closes (ET)</span><input type="datetime-local" id="ssFaClose" value="'+dt(s.free_agency_closes_at)+'"></label>'+
    '<label class="fld"><span>Season starts (ET)</span><input type="datetime-local" id="ssStarts" value="'+dt(s.starts_at)+'"></label>'+
    '<label class="fld"><span>Season ends (ET)</span><input type="datetime-local" id="ssEnds" value="'+dt(s.ends_at)+'"></label>'+
    '<label class="fld"><span>Playoffs start (ET)</span><input type="datetime-local" id="ssPlayoffs" value="'+dt(s.playoffs_start_at)+'"></label>'+
    '<label class="fld"><span>Salary cap ($M)</span><input id="ssCap" type="number" min="1" step="0.5" value="'+((s.salary_cap||60000000)/1e6)+'"></label>'+
    '<label class="fld"><span>Roster max</span><input id="ssRoster" type="number" min="6" max="30" value="'+(s.roster_max||12)+'"></label>'+
    '<label class="fld"><span>Trade deadline (week)</span><input id="ssTdw" type="number" min="1" max="20" value="'+(s.trade_deadline_week||6)+'"></label>'+
    '<label class="fld"><span>Roster moves</span><select id="ssMoves">'+["auto","locked","open"].map(function(x){ return '<option'+(s.moves_lock_override===x?" selected":"")+'>'+x+'</option>'; }).join("")+'</select></label>'+
    '</div><p class="caption">Give “Off-season begins” one date — the first midnight after last season’s final playoff game — and Auto-space fills the rest: two dark weeks to seat owners and management, sign-ups closing as those weeks end, then 2 pre-season weeks (Wed + Fri), the draft the Saturday after the final Friday, a full week of free agency opening 24 hours after the draft, puck drop the Wednesday after free agency closes, 9 regular-season weeks, and playoffs the Wednesday after. (Only have a pre-season date? Fill that instead — it spaces forward from there.) Weeks touching Christmas, Canada Day, or July 4 are skipped. The sign-up deadline is a draft-eligibility cutoff, not a hard close — registration stays open, and anyone who signs up late is randomly assigned after the draft. Every field stays editable; nothing saves until you hit Save.</p>',
    '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-chrome" id="ssGo">'+(isNew?"Create season":"Save settings")+'</button>');
  document.getElementById("ssSpace").addEventListener("click", function(){
    /* Two ways in. Give the off-season start (the first midnight after last season's final
       playoff game) and the two dark weeks + sign-up deadline space themselves too; give only
       a pre-season date and we start there. */
    var offV = document.getElementById("ssOff").value;
    var preV = document.getElementById("ssPre").value;
    if (!offV && !preV){ CG.toast("Give “Off-season begins” or “Pre-season starts” a date — everything spaces from it","err"); return; }
    var offDay = offV ? offV.slice(0,10) : null, darkEnd = null, ownDl, regDl;
    var pre;
    if (offDay){
      darkEnd = CG.dayAdd(offDay, CG.OFFSEASON_DARK_DAYS-1);    /* 2 weeks, no on-ice activity */
      pre = CG.gameNights(CG.dayAdd(darkEnd,1), CG.PRESEASON_WEEKS); /* pre-season the next week */
      regDl = CG.etISO(darkEnd,"20:00");                        /* sign-ups close ending the 2 weeks */
      ownDl = CG.etISO(CG.dayAdd(offDay,6),"20:00");            /* week 1 takes apps, week 2 seats them */
    } else {
      pre = CG.gameNights(preV.slice(0,10), CG.PRESEASON_WEEKS);
    }
    var preStart = pre.nights[0].wed, preFinal = pre.nights[CG.PRESEASON_WEEKS-1].fri;
    if (!offDay){
      regDl = CG.etISO(CG.dayAdd(preStart,-2),"20:00");         /* the Monday before */
      ownDl = CG.etISO(CG.dayAdd(preStart,-7),"20:00");
    }
    var draftDay = CG.dayAdd(preFinal,1);                       /* Saturday draft night */
    var faOpenDay  = CG.dayAdd(draftDay,1);                     /* 24h after draft night */
    var faCloseDay = CG.dayAdd(faOpenDay,CG.FA_WINDOW_DAYS);    /* a full week of free agency */
    /* Puck drop waits for free agency to close, so every club starts game 1 settled. */
    var reg = CG.gameNights(CG.dayAdd(faCloseDay,1), Math.ceil(CG.GAMES_PER_CLUB/CG.NIGHT_SLOTS.length/2));
    var regStart = reg.nights[0].wed, regEnd = reg.nights[reg.nights.length-1].fri;
    var po = CG.gameNights(CG.dayAdd(regEnd,1), 1);
    function put(id, iso){ document.getElementById(id).value = dt(iso); }
    if (offDay) put("ssOff", CG.etISO(offDay,"00:00"));
    put("ssPre",      CG.etISO(preStart,"21:00"));
    put("ssDraft",    CG.etISO(draftDay,"19:00"));
    put("ssFaOpen",   CG.etISO(faOpenDay,"19:00"));
    put("ssFaClose",  CG.etISO(faCloseDay,"19:00"));
    put("ssStarts",   CG.etISO(regStart,"21:00"));
    put("ssEnds",     CG.etISO(regEnd,"23:59"));
    put("ssPlayoffs", CG.etISO(po.nights[0].wed,"21:00"));
    put("ssRegDl",    regDl);
    put("ssOwnDl",    ownDl);
    var skipped = pre.skipped.concat(reg.skipped, po.skipped);
    CG.toast("Timeline spaced: "+(offDay?"off-season "+offDay+" → ":"")+"pre-season "+preStart+
      " → draft "+draftDay+" → free agency closes "+faCloseDay+" → puck drop "+regStart+
      (skipped.length?" · holiday week"+(skipped.length===1?"":"s")+" skipped: "+skipped.join(", "):""),"ok");
  });
  document.getElementById("ssGo").addEventListener("click", function(){
    var name=(document.getElementById("ssName").value||"").trim();
    if(!name){ CG.toast("Name the season","err"); return; }
    var num=parseInt(document.getElementById("ssNum").value,10);
    if(!(num>=1)){ CG.toast("Season number must be 1 or more","err"); return; }
    var clash=(CG._seasonsRaw||[]).find(function(x){ return x.number===num && (!id || x.id!==id); });
    if(clash){ CG.toast("Number "+num+" is already "+(clash.name||"another season"),"err"); return; }
    function iso(elId){ var v=document.getElementById(elId).value; return v ? CG.etISO(v.slice(0,10), v.slice(11,16)) : null; }
    var cap=Math.round(parseFloat(document.getElementById("ssCap").value||"60")*1e6);
    var rec={ name:name, number:num, status:document.getElementById("ssStatus").value,
      registration_open: document.getElementById("ssRegOpen").value==="1",
      starts_at:iso("ssStarts"), ends_at:iso("ssEnds"), registration_deadline:iso("ssRegDl"),
      signup_deadline_at:iso("ssRegDl"), offseason_starts_at:iso("ssOff"),
      owner_app_deadline:iso("ssOwnDl"), draft_at:iso("ssDraft"),
      preseason_starts_at:iso("ssPre"), free_agency_opens_at:iso("ssFaOpen"),
      free_agency_closes_at:iso("ssFaClose"), playoffs_start_at:iso("ssPlayoffs"),
      salary_cap:cap, roster_max:parseInt(document.getElementById("ssRoster").value,10)||12,
      trade_deadline_week:parseInt(document.getElementById("ssTdw").value,10)||6,
      moves_lock_override:document.getElementById("ssMoves").value };
    var btn=this; btn.disabled=true;
    var q = isNew ? CG.sb.from("seasons").insert(rec) : CG.sb.from("seasons").update(rec).eq("id",id);
    q.then(function(r){
      btn.disabled=false;
      if(r.error){ CG.toast("Couldn’t save: "+r.error.message,"err"); return; }
      if (CG.closeOverlay) CG.closeOverlay();
      CG.toast(isNew?name+" created":"Season settings saved","ok");
      CG.reloadLeague();
    });
  });
};
CG.deleteSeason = function(id, name){
  /* show exactly what goes with it, then require the name typed back */
  Promise.all([
    CG.sb.from("games").select("id",{count:"exact",head:true}).eq("season_id",id),
    CG.sb.from("roster_spots").select("id",{count:"exact",head:true}).eq("season_id",id),
    CG.sb.from("season_registrations").select("id",{count:"exact",head:true}).eq("season_id",id)
  ]).then(function(rs){
    var games=(rs[0]&&rs[0].count)||0, spots=(rs[1]&&rs[1].count)||0, regs=(rs[2]&&rs[2].count)||0;
    CG.modal("Delete "+esc(name)+"?",
      '<div class="note red" style="margin:0 0 14px"><b style="font-family:var(--f-disp);display:block;margin-bottom:4px">This deletes the season and everything scheduled inside it:</b>'+
      games+' game'+(games===1?"":"s")+' (and their box scores) · '+spots+' roster spot'+(spots===1?"":"s")+' · '+regs+' registration'+(regs===1?"":"s")+'. Player accounts, clubs, and news are kept. This cannot be undone.</div>'+
      '<label class="fld"><span>Type the season name to confirm</span><input id="sdConfirm" placeholder="'+esc(name)+'" autocomplete="off"></label>',
      '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-ink" id="sdGo">Delete permanently</button>');
    document.getElementById("sdGo").addEventListener("click", function(){
      if ((document.getElementById("sdConfirm").value||"").trim()!==name){ CG.toast("Type the season name exactly to confirm","err"); return; }
      var btn=this; btn.disabled=true;
      CG.sb.from("seasons").delete().eq("id",id).then(function(r){
        btn.disabled=false;
        if(r.error){ CG.toast("Couldn’t delete: "+r.error.message,"err"); return; }
        if (CG.closeOverlay) CG.closeOverlay();
        CG.toast(name+" deleted","ok");
        CG.reloadLeague();
      });
    });
  });
};
CG.AFTER._admSeasons = function(){
  var add=document.getElementById("seasonAdd");
  if(add) add.addEventListener("click", function(){ CG.seasonForm(null); });
  document.querySelectorAll("[data-season-edit]").forEach(function(b){ b.addEventListener("click", function(){ CG.seasonForm(this.getAttribute("data-season-edit")); }); });
  document.querySelectorAll("[data-season-del]").forEach(function(b){ b.addEventListener("click", function(){ CG.deleteSeason(this.getAttribute("data-season-del"), this.getAttribute("data-name")); }); });
};

/* ================================================================
   LIVE ADMIN: PLAYOFFS — seed round 1 from the final table, advance rounds,
   pick the series length. Clinches + series conclusion are DB triggers; this
   panel is where a human sets each round's matchups.
   ================================================================ */
CG.playoffSeeds = function(){
  var DIVS = CG.DIVISIONS && CG.DIVISIONS.length ? CG.DIVISIONS : ["East","West"];
  var winners = DIVS.map(function(dv){ return CG.standings(CG.lg,dv)[0]; }).filter(Boolean);
  winners.sort(function(a,b){ return b.pts-a.pts||b.w-a.w||b.diff-a.diff||b.gf-a.gf; });
  var rest = [];
  DIVS.forEach(function(dv){ CG.standings(CG.lg,dv).slice(1,3).forEach(function(r){ rest.push(r); }); });
  rest.sort(function(a,b){ return b.pts-a.pts||b.w-a.w||b.diff-a.diff||b.gf-a.gf; });
  return winners.concat(rest).slice(0,6);
};
CG.playoffBestOf = function(){ return (CG._siteCfg && CG._siteCfg.playoff_format && CG._siteCfg.playoff_format.bestOf) || 3; };
/* seeds are FROZEN when the quarter-finals are generated — later rounds must
   never re-derive them from a table that can still move (a late-ingested
   regular-season final would otherwise rewrite the bracket mid-playoffs) */
CG.frozenSeeds = function(){
  var v = CG._siteCfg && CG._siteCfg["playoff_seeds_"+((CG.SEASON&&CG.SEASON.number)||1)];
  return (Array.isArray(v) && v.length===6) ? v : null;
};
CG.admPlayoffsLive = function(){
  var lg = CG.lg, s = CG.SEASON||{};
  var pog = (lg.playoffGames||[]);
  var bestOf = CG.playoffBestOf();
  var rounds = { 1:[], 2:[], 3:[] };
  pog.forEach(function(g){ (rounds[g.week||1]=rounds[g.week||1]||[]).push(g); });
  var frozen = CG.frozenSeeds();
  var seeds = frozen
    ? frozen.map(function(code){ return { code:code, pts:(lg.teams[code]||{}).pts||0 }; })
    : CG.playoffSeeds();
  var regDone = (lg.schedule||[]).filter(function(g){ return g.stage==="regular"; });
  var regLeft = regDone.filter(function(g){ return g.status!=="final"; }).length;

  var h = '<div style="margin-bottom:16px"><h2 class="h-sec">Playoffs</h2>'+
    '<p class="lede" style="margin-top:6px">Seed the bracket from the final table, then set each round. Clinches, series wins, and the champion are detected automatically — decided series drop their extra games on their own.</p></div>';

  /* series length control — locked once any playoff game exists so a live
     series can't be stranded by a mid-round change */
  var poLive = pog.length>0;
  h += '<div class="card" style="margin-bottom:18px"><div class="card-h"><h3>Series length</h3><span class="chip">Best of '+bestOf+'</span></div><div class="card-b">'+
    '<div style="display:flex;gap:8px;flex-wrap:wrap">'+[3,5,7].map(function(n){
      return '<button class="btn '+(n===bestOf?"btn-chrome":"btn-ghost")+' btn-sm" data-bestof="'+n+'"'+(poLive?" disabled":"")+'>Best of '+n+'</button>'; }).join("")+'</div>'+
    '<p class="caption" style="margin-top:10px">Every round uses this length. First to '+(Math.floor(bestOf/2)+1)+' wins the series. '+
    (poLive?'Locked — the postseason is under way. Clear all playoff rounds to change it.':'Set it before generating the first round.')+'</p></div></div>';

  /* seeds */
  h += '<div class="card" style="margin-bottom:18px"><div class="card-h"><h3>'+(frozen?"Seeding — locked at the quarter-finals":"Seeding — from the final table")+'</h3><span class="chip">'+(frozen?"locked in":regLeft?regLeft+" regular games left":"regular season complete")+'</span></div><div class="card-b">';
  if (seeds.length===6){
    h += '<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px">'+
      seeds.map(function(r,i){ return '<div style="display:flex;align-items:center;gap:9px;border:1px solid var(--line);border-radius:var(--r-s);padding:8px 11px">'+
        '<b class="num" style="width:16px">'+(i+1)+'</b>'+CG.crest(r.code,20)+'<b class="mono" style="font-size:12px">'+esc(r.code)+'</b><span class="caption num" style="margin-left:auto">'+r.pts+'</span></div>'; }).join("")+'</div>'+
      '<p class="caption" style="margin-top:10px">Seeds 1–2 (division winners) get a quarter-final bye. 3v6 and 4v5 open the bracket.</p>';
  } else { h += '<p class="caption">Need at least six clubs across the divisions to seed a bracket.</p>'; }
  h += '</div></div>';

  /* rounds */
  var roundMeta = [[1,"Quarter-finals","3v6 · 4v5"],[2,"Semi-finals","seed 1 vs lowest survivor · seed 2 vs highest"],[3,"Final","the two semi-final winners"]];
  roundMeta.forEach(function(rm){
    var rd=rm[0], list=rounds[rd]||[];
    var pairs = {};
    list.forEach(function(g){ var k=[g.home,g.away].sort().join("~"); (pairs[k]=pairs[k]||[]).push(g); });
    var pairKeys = Object.keys(pairs);
    h += '<div class="card" style="margin-bottom:14px"><div class="card-h"><h3>'+rm[1]+'</h3>'+
      (pairKeys.length?'<span class="chip chip-win">'+pairKeys.length+' series</span>':'<span class="chip">not set</span>')+'</div><div class="card-b">';
    if (pairKeys.length){
      h += pairKeys.map(function(k){ var gs=pairs[k], a=gs[0], finals=gs.filter(function(x){return x.status==="final";}).length;
        return '<div style="display:flex;align-items:center;gap:10px;padding:6px 0;flex-wrap:wrap"><span class="teamcell">'+CG.crest(a.home,20)+'<b class="mono" style="font-size:12px">'+esc(a.home)+'</b></span><span class="caption">vs</span><span class="teamcell">'+CG.crest(a.away,20)+'<b class="mono" style="font-size:12px">'+esc(a.away)+'</b></span>'+
          '<span class="caption" style="margin-left:auto">'+gs.length+' games · '+finals+' played</span></div>'; }).join("")+
        '<div style="margin-top:12px"><button class="btn btn-ghost btn-sm" data-po-clear="'+rd+'">Clear this round</button></div>';
    } else {
      h += '<p class="caption" style="margin-bottom:12px">'+rm[2]+'. '+
        (rd===1?'Generates 3v6 and 4v5 from the seeds above.':rd===2?'Generates once both quarter-finals are decided (seeds 1 and 2 enter here).':'Generates once both semi-finals are decided.')+'</p>'+
        '<button class="btn btn-chrome btn-sm" data-po-gen="'+rd+'">'+CG.ic("plus",14)+'Generate '+rm[1].toLowerCase()+'</button>';
    }
    h += '</div></div>';
  });
  return h;
};
CG.AFTER._admPlayoffs = function(){
  document.querySelectorAll("[data-bestof]").forEach(function(b){ b.addEventListener("click", function(){
    var n=parseInt(this.getAttribute("data-bestof"),10);
    CG.sb.from("site_config").upsert({ key:"playoff_format", value:{ bestOf:n } },{ onConflict:"key" }).then(function(r){
      if(r.error){ CG.toast("Couldn’t save: "+r.error.message,"err"); return; }
      CG._siteCfg.playoff_format={ bestOf:n }; CG.toast("Series length set to best of "+n,"ok"); CG.router();
    });
  }); });
  document.querySelectorAll("[data-po-gen]").forEach(function(b){ b.addEventListener("click", function(){ CG.generatePlayoffRound(parseInt(this.getAttribute("data-po-gen"),10)); }); });
  document.querySelectorAll("[data-po-clear]").forEach(function(b){ b.addEventListener("click", function(){ CG.clearPlayoffRound(parseInt(this.getAttribute("data-po-clear"),10)); }); });
};
/* winner of a decided series in a round, by club code (null if none/undecided) */
CG.seriesWinners = function(round){
  var need = Math.floor(CG.playoffBestOf()/2)+1;
  var pairs = {};
  (CG.lg.playoffGames||[]).filter(function(g){ return (g.week||1)===round; }).forEach(function(g){
    var k=[g.home,g.away].sort().join("~"); var p=pairs[k]||(pairs[k]={a:[g.home,g.away].sort()[0],b:[g.home,g.away].sort()[1],aw:0,bw:0});
    var res=(CG.lg.allResults||[]).find(function(r){ return r.id===g.id; });
    if(res){ var w=res.score[g.home]>res.score[g.away]?g.home:g.away; if(w===p.a)p.aw++; else p.bw++; }
  });
  return Object.keys(pairs).map(function(k){ var p=pairs[k];
    return p.aw>=need ? {code:p.a,opp:p.b} : p.bw>=need ? {code:p.b,opp:p.a} : null; }).filter(Boolean);
};
CG.generatePlayoffRound = function(round){
  var s=CG.SEASON; if(!s||!s.id){ CG.toast("No active season","err"); return; }
  if ((CG.lg.playoffGames||[]).some(function(g){ return (g.week||1)===round; })){
    CG.toast("That round already exists — clear it first to regenerate","err"); return; }
  var bestOf=CG.playoffBestOf();
  var seedCodes, freezeAfter=false;
  if (round===1){
    /* the table must be FINAL before the bracket exists — a straggler game
       auto-ingested later would silently re-seed a bracket already in play */
    var regLeft=(CG.lg.schedule||[]).filter(function(g){ return g.stage==="regular" && g.status!=="final"; }).length;
    if (regLeft){ CG.toast(regLeft+" regular-season game"+(regLeft===1?"":"s")+" still unplayed — finish or clear them before seeding the bracket","err"); return; }
    var live=CG.playoffSeeds();
    if (live.length<6){ CG.toast("Need six seeds to build a bracket","err"); return; }
    seedCodes=live.map(function(r){ return r.code; });
    freezeAfter=true;
  } else {
    /* rounds 2-3 read the seeds locked at quarter-final time, never the live table */
    seedCodes=CG.frozenSeeds();
    if (!seedCodes){ CG.toast("Seeds aren’t locked — generate the quarter-finals first","err"); return; }
  }
  var seedRank={}; seedCodes.forEach(function(c,i){ seedRank[c]=i+1; });
  var matchups=[]; /* [[homeCode, awayCode], ...] higher seed = home */
  if (round===1){
    matchups=[[seedCodes[2],seedCodes[5]],[seedCodes[3],seedCodes[4]]];
  } else if (round===2){
    var qf=CG.seriesWinners(1);
    if (qf.length<2){ CG.toast("Both quarter-finals must finish first","err"); return; }
    qf.sort(function(a,b){ return (seedRank[a.code]||9)-(seedRank[b.code]||9); });
    /* seed 1 draws the lowest surviving seed, seed 2 the highest */
    matchups=[[seedCodes[0], qf[qf.length-1].code],[seedCodes[1], qf[0].code]];
  } else {
    var sf=CG.seriesWinners(2);
    if (sf.length<2){ CG.toast("Both semi-finals must finish first","err"); return; }
    sf.sort(function(a,b){ return (seedRank[a.code]||9)-(seedRank[b.code]||9); });
    matchups=[[sf[0].code, sf[1].code]];
  }
  /* schedule the series: best-of-N nights, higher seed hosts odd games, on the
     Wed/Fri cadence from playoffs_start_at (or the day after the last game) */
  var anchor = s.playoffs_start_at ? CG.etYMD(s.playoffs_start_at) : CG.etYMD(new Date(CG.now()+2*86400000).toISOString());
  var priorPlayoff = (CG.lg.playoffGames||[]);
  if (priorPlayoff.length){ var last=priorPlayoff.reduce(function(m,g){ return Math.max(m,g.at); },0); anchor=CG.dayAdd(CG.etYMD(new Date(last).toISOString()),2); }
  var plan=CG.gameNights(anchor, Math.ceil(bestOf/2)+1);
  var nights=[]; plan.nights.forEach(function(n){ nights.push(n.wed); nights.push(n.fri); });
  var rows=[];
  matchups.forEach(function(m){
    for (var gi=0; gi<bestOf; gi++){
      var day=nights[gi]||CG.dayAdd(nights[nights.length-1]||anchor, (gi+1)*2);
      var host = gi%2===0 ? m[0] : m[1];   /* 2-2-1-1-1 is fine at this scale: alternate */
      var away = host===m[0] ? m[1] : m[0];
      rows.push({ season_id:s.id, week:round, stage:"playoff",
        home_team_id:(CG.lg._codeToId||{})[host], away_team_id:(CG.lg._codeToId||{})[away],
        scheduled_at:CG.etISO(day, CG.NIGHT_SLOTS[gi%CG.NIGHT_SLOTS.length]||"21:00"), status:"scheduled" });
    }
  });
  var rn = round===1?"quarter-finals":round===2?"semi-finals":"final";
  CG.confirm("Generate the "+rn+"?",
    matchups.map(function(m){ return m[0]+" vs "+m[1]; }).join(" · ")+" — best of "+bestOf+", "+rows.length+" games."+
    (freezeAfter?" Seeding locks in with this bracket.":"")+" Unneeded games disappear once a series is decided.",
    "Generate "+rn, function(){
    CG.sb.from("games").insert(rows).then(function(r){
      if(r.error){ CG.toast("Couldn’t generate: "+r.error.message,"err"); return; }
      var done=function(){ CG.toast(rn.charAt(0).toUpperCase()+rn.slice(1)+" set — "+rows.length+" games","ok"); CG.reloadLeague(); };
      if (freezeAfter){
        var key="playoff_seeds_"+((s&&s.number)||1);
        CG.sb.from("site_config").upsert({ key:key, value:seedCodes },{ onConflict:"key" }).then(function(r2){
          if (r2.error) CG.toast("Bracket set, but seed lock failed: "+r2.error.message,"err");
          else { CG._siteCfg = CG._siteCfg||{}; CG._siteCfg[key]=seedCodes; }
          done();
        });
      } else done();
    });
  });
};
CG.clearPlayoffRound = function(round){
  var s=CG.SEASON; if(!s||!s.id) return;
  var mine=(CG.lg.playoffGames||[]).filter(function(g){ return (g.week||1)===round; });
  var played=mine.filter(function(g){ return g.status==="final"; }).length;
  CG.confirm("Clear this playoff round?",
    mine.length+" games go"+(played?", including "+played+" finals with their box scores":"")+". This can’t be undone.",
    "Clear round", function(){
    CG.sb.from("games").delete().eq("season_id",s.id).eq("stage","playoff").eq("week",round).then(function(r){
      if(r.error){ CG.toast("Couldn’t clear: "+r.error.message,"err"); return; }
      if (round===1){
        /* clearing the quarter-finals unlocks the seeding again */
        var key="playoff_seeds_"+((s&&s.number)||1);
        CG.sb.from("site_config").delete().eq("key",key).then(function(){
          if (CG._siteCfg) delete CG._siteCfg[key];
          CG.toast("Round cleared — seeding unlocked","ok"); CG.reloadLeague();
        });
        return;
      }
      CG.toast("Round cleared","ok"); CG.reloadLeague();
    });
  });
};

/* register live Control Center sections */
CG._origAdminRoute = CG.ROUTES.admin;
CG.ROUTES.admin = function(param, qs){
  if (CG.role()!=="commish") return CG.unauthorized("The Control Center is commissioner-only.");
  if (param==="" || param==null) return CG.adminShell("", CG.admOverviewLive());
  if (param==="preseason") return CG.adminShell("preseason", CG.admPreseason(qs||{}));
  if (param==="users") return CG.adminShell("users", CG.admUsersLive(qs||{}));
  if (param==="leagues") return CG.adminShell("leagues", CG.admLeagues(qs||{}));
  if (param==="clubs") return CG.adminShell("clubs", CG.admTeamsLive(qs||{}));
  if (param==="presets") return CG.ROUTES._404();  /* retired: fixed league-standard lobby settings + club server picks (Rule 4) */
  if (param==="eastats") return CG.adminShell("eastats", CG.admEAStats(qs||{}));
  if (param==="complaints") return CG.adminShell("complaints", CG.hubComplaintsLive({admin:true}));
  if (param==="automations") return CG.adminShell("automations", CG.admAutomationsLive());
  if (param==="news") return CG.adminShell("news", CG.admNewsLive());
  if (param==="rankings") return CG.adminShell("rankings", CG.admRankingsLive());
  if (param==="homepage") return CG.adminShell("homepage", CG.admHomepageLive());
  if (param==="schedule") return CG.adminShell("schedule", CG.admScheduleLive());
  if (param==="ratings") return CG.adminShell("ratings", CG.admRatingsLive());
  if (param==="seasons") return CG.adminShell("seasons", CG.admSeasonsLive());
  if (param==="playoffs") return CG.adminShell("playoffs", CG.admPlayoffsLive());
  if (param==="results") return CG.ROUTES._404();  /* retired: EA stats auto-import replaced manual entry */
  return CG._origAdminRoute(param, qs);
};
CG._origAdminAfter = CG.AFTER.admin;
CG.AFTER.admin = function(param, qs){
  if (param==="preseason"){ CG.AFTER._preseason(); return; }
  if (param==="users"){ CG.AFTER._admUsers(); return; }
  if (param==="leagues"){ CG.AFTER._admLeagues(); return; }
  if (param==="clubs"){ CG.AFTER._admTeams(); return; }
  if (param==="eastats"){ CG.AFTER._admEAStats(); return; }
  if (param==="complaints"){ CG.AFTER._complaintsLive(); return; }
  if (param==="automations"){ CG.AFTER._admAutomations(); return; }
  if (param==="news"){ CG.AFTER._admNewsLive(); return; }
  if (param==="rankings"){ CG.AFTER._admRankings(); return; }
  if (param==="homepage"){ CG.AFTER._admHomepage(); return; }
  if (param==="schedule"){ CG.AFTER._admScheduleLive(); return; }
  if (param==="seasons"){ CG.AFTER._admSeasons(); return; }
  if (param==="playoffs"){ CG.AFTER._admPlayoffs(); return; }
  if (param==="ratings"){ return; }
  if (param==="" || param==null){ return; }
  if (CG._origAdminAfter) CG._origAdminAfter(param, qs);
};

/* ================================================================
   TEAM HQ: SCHEDULE DESK — the club's game nights with server picks
   (game_vetoes), lobby codes, and the resolved server. Servers stay
   unset until 30 minutes before the night's FIRST puck drop.
   ================================================================ */
CG.hubScheduleLive = function(){
  var me = CG.me(), lg = CG.lg;
  var club = CG.myClub(), t = CG.TEAM[club];
  if (!me || !t) return '<div class="note">This account doesn’t run a club — the schedule desk belongs to team management.</div>';
  var upcoming = lg.schedule.filter(function(g){ return (g.home===club||g.away===club) && g.status!=="final"; })
    .sort(function(a,b){ return a.at-b.at; });
  var h = '<div style="margin-bottom:20px"><span class="eyebrow chr">'+esc(t.name)+' · game operations</span>'+
    '<h1 class="h-sec" style="margin-top:8px">Schedule desk</h1>'+
    '<p class="lede" style="margin-top:8px">Your next game nights: set server picks for every game, grab lobby codes, and watch the server lock in. Picks freeze 30 minutes before the night’s first puck drop — that’s also when the server is set.</p></div>';
  if (!upcoming.length){
    return h + '<div class="card"><div class="empty"><div class="e-art">'+CG.ic("cal",22)+'</div><b>No games on the slate</b><p>Game nights appear here the moment the league posts your schedule.</p></div></div>';
  }
  /* group by ET night */
  var nights = {}, order = [];
  upcoming.forEach(function(g){
    var day = new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York"}).format(new Date(g.at));
    if (!nights[day]){ nights[day]=[]; order.push(day); }
    nights[day].push(g);
  });
  h += order.slice(0,2).map(function(day){
    var games = nights[day];
    var firstAt = games[0].at;
    var lockAt = firstAt - (CG.VETO_LOCK_MS||1800000);
    var locked = CG.now() >= lockAt;
    var rows = games.map(function(g){
      var homeSide = g.home===club, opp = homeSide?g.away:g.home;
      var codeReleased = CG.now() >= g.at - 30*60000;
      return '<div class="card-b" style="border-top:1px solid var(--line-soft);display:flex;flex-direction:column;gap:12px">'+
        '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">'+
          '<span class="mono" style="font-size:12px;color:var(--steel);min-width:76px">'+CG.fmtTime(g.at)+'</span>'+
          '<span class="teamcell">'+CG.crest(opp,24)+'<span><span class="nm">'+(homeSide?"vs":"@")+' '+esc(CG.TEAM[opp].name)+'</span></span></span>'+
          '<span class="chip" style="font-size:9.5px">'+(homeSide?"HOME":"AWAY")+'</span>'+
          '<span style="margin-left:auto;display:flex;gap:8px;align-items:center">'+
            (codeReleased
              ? '<span class="chip chip-chrome mono" style="letter-spacing:.12em">'+CG.gameCode(g.id)+'</span>'
              : '<span class="chip">'+CG.ic("lock",11)+' Code at '+CG.fmtTime(g.at-30*60000)+'</span>')+
            '<a class="btn btn-ghost btn-sm" href="#/matchup/'+g.id+'">Match card</a></span></div>'+
        CG.serverVetoControls(g, me, lockAt)+
      '</div>';
    }).join("");
    return '<div class="card" style="margin-bottom:18px"><div class="card-h"><h3>'+CG.fmtDay(firstAt)+'</h3>'+
      (locked
        ? '<span class="chip chip-warn">'+CG.ic("lock",11)+' Picks locked · servers set</span>'
        : '<span class="chip">Picks lock '+CG.fmtTime(lockAt)+' — 30 min before first puck drop</span>')+'</div>'+
      rows+
      '<div class="card-b" style="border-top:1px solid var(--line)"><span class="caption">Home picks a 1st and 2nd server; away sets a veto and a preferred. Picks are private to each club — the server resolves from both sides when the night locks (Rule 4). Codes go only to rostered players and management (Rule 4.2).</span></div></div>';
  }).join("");
  if (order.length>2) h += '<p class="caption" style="margin-top:4px">'+(order.length-2)+' more game night'+(order.length-2===1?"":"s")+' scheduled — they surface here as they approach. <a href="#/schedule" style="font-weight:700;border-bottom:2px solid var(--chrome)">Full league schedule</a></p>';
  return h;
};
CG.AFTER._hubSchedule = function(){
  document.querySelectorAll(".srv-sel").forEach(function(el){
    el.addEventListener("change", function(){ CG.saveVeto(el.getAttribute("data-veto-game"), el); });
  });
};

/* Messages as a hub section (#/hub/messages) — the DM UI renders inside the
   player hub shell instead of holding its own top-level nav slot. */
CG._origHubRoute = CG.ROUTES.hub;
CG.ROUTES.hub = function(param, qs){
  if (param==="messages"){
    if (CG.role()==="guest") return CG.unauthorized("Sign in to reach your messages.");
    return CG.hubShell("messages", CG.messagesBody());
  }
  if (param==="freeagents"){
    return CG.can("roster.manage") ? CG.hubShell("freeagents", CG.hubFreeAgents())
      : CG.unauthorized("The free-agent board is a team-management tool.");
  }
  return CG._origHubRoute(param, qs);
};
CG._origHubAfter = CG.AFTER.hub;
CG.AFTER.hub = function(param, qs){
  if (param==="messages"){ CG.AFTER.messages(); return; }
  if (param==="freeagents"){ CG.AFTER._hubFreeAgents(); return; }
  if (CG._origHubAfter) CG._origHubAfter(param, qs);
};

/* ================================================================
   TEAM HQ: FREE AGENTS — view and approach the signable pool
   (signing itself goes through the sign_free_agent RPC, which
   enforces the window, eligibility, and roster space server-side)
   ================================================================ */
CG.hubFreeAgents = function(){
  var lg=CG.lg, s=CG.SEASON||{};
  var uid=(CG.auth.user&&CG.auth.user.id)||((CG.me()||{}).id);
  var t=(CG.TEAMS||[]).find(function(x){ return uid && (x.owner===uid||x.gm===uid||x.agm===uid); });
  if (!t) return '<div class="note">This account doesn’t run a club — the free-agent board belongs to team management.</div>';
  var faO = s.free_agency_opens_at ? Date.parse(s.free_agency_opens_at) : null;
  var faC = s.free_agency_closes_at ? Date.parse(s.free_agency_closes_at) : null;
  var nowMs = Date.now();
  var canSign = !!(faO && nowMs >= faO);   /* signable during the window and after it, never before */
  var winChip = !faO ? '<span class="chip chip-warn">No free-agency dates set yet</span>'
    : nowMs < faO ? '<span class="chip chip-warn">Opens '+CG.fmtFull(faO)+'</span>'
    : (faC && nowMs < faC) ? '<span class="chip chip-live"><span class="live-dot"></span>Window open — closes '+CG.fmtFull(faC)+'</span>'
    : '<span class="chip chip-win">Window closed — free agents stay signable</span>';
  var rosterN=(lg.byTeam[t.code]||[]).length, rosterMax=s.roster_max||15;
  var rosteredIds=lg._rosteredIds||{};
  var pool=(lg._registrationsRaw||[]).filter(function(r){
    return (!r.season_id || r.season_id===s.id) && r.status!=="declined" && !rosteredIds[r.profile_id] &&
      (lg.isVeteran(r.profile_id) || ((lg.preGp[r.profile_id]||{}).gp||0) >= 5);
  }).sort(function(a,b){ return (b.scout_ovr==null?-1:b.scout_ovr)-(a.scout_ovr==null?-1:a.scout_ovr); });
  var h='<div style="margin-bottom:20px"><span class="eyebrow chr">'+esc(t.name)+' · player acquisition</span>'+
    '<h1 class="h-sec" style="margin-top:8px">Free agents</h1>'+
    '<p class="lede" style="margin-top:8px">Every signable player without a club. Approach opens a direct message to talk terms; signing adds them to your roster at the salary you negotiated — first come, first served, under the cap.</p></div>';
  h+='<div class="grid g3" style="margin-bottom:18px">'+
    '<div class="kpi" style="cursor:default"><b class="num">'+pool.length+'</b><span>free agents</span></div>'+
    '<div class="kpi" style="cursor:default"><b class="num">'+rosterN+' / '+rosterMax+'</b><span>your roster</span></div>'+
    '<div class="kpi" style="cursor:default;justify-content:center;display:flex;align-items:center">'+winChip+'</div></div>';
  h+='<div class="card"><div class="card-h"><h3>The board</h3><span class="chip">'+pool.length+'</span></div>'+
    (pool.length?'<div class="tblwrap"><table class="tbl keepcols"><caption class="sr">Signable free agents</caption><thead><tr>'+
      '<th class="tleft">Player</th><th>POS</th><th>Scout OVR</th><th>Pre-season</th><th class="tleft">Background</th><th class="tright">Actions</th></tr></thead><tbody>'+
      pool.map(function(r){
        var prof=r.profiles||{}, pre=lg.preGp[r.profile_id]||{gp:0,g:0,a:0};
        var bg = lg.isVeteran(r.profile_id) ? '<span class="chip">Veteran</span>' : '<span class="chip chip-win">'+pre.gp+' pre-season games</span>';
        var full = rosterN>=rosterMax;
        return '<tr><td class="tleft"><span class="playercell"><span class="nm">'+esc(prof.gamertag||"—")+'</span></span></td>'+
          '<td class="tnum">'+esc(r.position||"—")+'</td>'+
          '<td class="tnum">'+(r.scout_ovr==null?'<span class="caption">—</span>':r.scout_ovr)+'</td>'+
          '<td class="tnum">'+(pre.gp?pre.gp+' GP · '+pre.g+'G '+pre.a+'A':'<span class="caption">—</span>')+'</td>'+
          '<td class="tleft">'+bg+'</td>'+
          '<td class="tright"><span style="display:inline-flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">'+
            '<button class="btn btn-ghost btn-sm" data-fa-dm="'+r.profile_id+'">Approach</button>'+
            '<button class="btn btn-chrome btn-sm" data-fa-sign="'+r.id+'" data-name="'+esc(prof.gamertag||"this player")+'"'+((canSign&&!full)?"":" disabled")+
              ((!canSign)?' title="Signing opens with free agency"':full?' title="Your roster is full"':'')+'>Sign</button>'+
          '</span></td></tr>';
      }).join("")+'</tbody></table></div>'+
      '<div class="card-b" style="border-top:1px solid var(--line)"><span class="caption">Rookies who missed the 5-game pre-season minimum never appear here — the league places them on random clubs ten minutes after the draft’s final pick. Signing is enforced server-side: the window, eligibility, and your roster space are all checked again on the click.</span></div>'
    :'<div class="card-b"><div class="empty" style="padding:50px 20px"><div class="e-art">'+CG.ic("search",22)+'</div><b>No free agents right now</b><p>Unsigned, draft-eligible players land here after the draft. Check back once free agency opens.</p></div></div>')+'</div>';
  return h;
};
CG.AFTER._hubFreeAgents = function(){
  document.querySelectorAll("[data-fa-dm]").forEach(function(b){ b.addEventListener("click", function(){
    var pid=this.getAttribute("data-fa-dm");
    CG._dm = CG._dm || { msgs:[], profiles:{}, active:null, loaded:false };
    /* seed the profile so a brand-new conversation shows their name, not "Member" */
    if (!CG._dm.profiles[pid]){
      var pr=(CG.lg._profilesRaw||[]).find(function(x){ return x.id===pid; });
      if (pr) CG._dm.profiles[pid]=pr;
    }
    CG._dm.active=pid;
    location.hash="#/hub/messages";
  }); });
  document.querySelectorAll("[data-fa-sign]").forEach(function(b){ b.addEventListener("click", function(){
    var regId=this.getAttribute("data-fa-sign"), name=this.getAttribute("data-name");
    var uid=(CG.auth.user&&CG.auth.user.id)||((CG.me()||{}).id);
    var t=(CG.TEAMS||[]).find(function(x){ return uid&&(x.owner===uid||x.gm===uid||x.agm===uid); });
    var used=((t&&CG.lg.byTeam[t.code])||[]).reduce(function(s,p){ return s+(p.salary||0); },0);
    var space=Math.max(0,(CG.CAP||60000000)-used);
    CG.modal("Sign "+esc(name),
      '<label class="fld"><span>Negotiated salary ($M per season)</span><input id="faSal" type="number" min="0.75" step="0.05" value="0.75"></label>'+
      '<p class="caption">Your cap space: <b>'+CG.fmtMoney(space)+'</b> · league minimum $0.75M. Agree on the number with the player first — Approach opens that conversation. The cap, the window, and eligibility are all checked again on the click.</p>',
      '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-chrome" id="faSignGo">Sign player</button>');
    document.getElementById("faSignGo").addEventListener("click", function(){
      var v=parseFloat(document.getElementById("faSal").value);
      if(!(v>=0.75)){ CG.toast("Salary must be at least $0.75M","err"); return; }
      var sal=Math.round(v*1e6);
      var btn=this; btn.disabled=true;
      CG.sb.rpc("sign_free_agent",{ p_registration:regId, p_salary:sal }).then(function(r){
        btn.disabled=false;
        if (r.error){ CG.toast("Couldn’t sign: "+r.error.message,"err"); return; }
        if (CG.closeOverlay) CG.closeOverlay();
        CG.toast(String(r.data||name)+" · "+CG.fmtMoney(sal)+" — welcome aboard","ok");
        CG.reloadLeague();
      });
    });
  }); });
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
    /* Messages lives in the player hub (hub sidebar + #/hub/messages) — no top-nav slot */
    /* Control Center nav, grouped by job: run game nights → manage people &
       clubs → shape the league → publish → keep the machine running */
    CG.ADMIN_NAV = [
      ["Operations", [
        ["","Overview","home"],
        ["schedule","Schedule","cal"],
        ["eastats","EA stats","chart"],
        ["codes","Game codes","code"]
      ]],
      ["Clubs & members", [
        ["preseason","Pre-season","users"],
        ["users","Users & roles","users"],
        ["clubs","Teams","grid"],
        ["complaints","Complaints","flag"]
      ]],
      ["League", [
        ["seasons","Seasons","db"],
        ["playoffs","Playoffs","trophy"],
        ["leagues","Leagues & tiers","trophy"],
        ["rankings","Power rankings","up"],
        ["ratings","Overall ratings","chart"],
        ["awards","Awards","trophy"]
      ]],
      ["Content", [
        ["news","Newsroom","doc"],
        ["homepage","Homepage","grid"],
        ["carousel","Hero carousel","film"],
        ["media","Media library","ul"],
        ["rulebook","Rulebook","doc"]
      ]],
      ["System", [
        ["automations","Automations","clock"],
        ["data","Import / export","db"],
        ["audit","Audit log","eye"],
        ["settings","Site settings","gear"]
      ]]
    ];
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
