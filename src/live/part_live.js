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
    CG.sbAll("profiles","*","id"),
    CG.sbAll("roster_spots","*","id"),
    CG.sbAll("contracts","*","id"),
    CG.sbAll("games","*","scheduled_at"),
    CG.sbAll("transactions","*","occurred_at",false),
    CG.sbAll("news","*","published_at",false),
    /* both orders go through the builder: sbAll applies filterFn before its own orderCol, so
       passing season_number as orderCol would demote it below round and invert the sort */
    CG.sbAll("draft_picks","id,season_number,round,original_team_id,current_team_id,player_id,used,overall_pick,skipped",null,true,
      function(qb){ return qb.order("season_number").order("round"); }),
    CG.sbAll("season_registrations","id,profile_id,season_id,status,position,scout_ovr,created_at, profiles(gamertag,ea_id)","id"),
    sb.from("leagues").select("*").order("sort_order"),
    CG.sbAll("game_stats","*","id"),
    sb.from("feature_flags").select("key,enabled"),
    sb.from("site_config").select("key,value"),
    CG.sbAll("suspensions","*","created_at",false),
    CG.sbAll("awards","*","week")
  ]);
  /* first 9 are public-readable and required; draft_picks + season_registrations
     (9,10) are manager-gated by RLS and fail for guests — optional here, reloaded
     after auth for managers. leagues (11) + game_stats (12) are public but non-fatal. */
  var bad = q.slice(0,9).find(function(r){ return r.error; });
  if (bad) throw new Error(bad.error.message || "query failed");
  CG._seasonsRaw = (q[2].data||[]);
  /* Canonical "current season": the ACTIVE one wins; otherwise the newest season that isn't
     complete; otherwise the newest. Matches the DB's current_season_num() so creating a Season 2
     row (status 'upcoming') can never hijack the live site while Season 1 is still active. */
  CG.pickCurrentSeason = function(rows){        /* rows arrive ordered by number desc */
    rows = rows||[];
    return rows.find(function(s){ return s.status==="active"; })
        || rows.find(function(s){ return s.status!=="complete"; })
        || rows[0] || null;
  };
  var teamsRaw=q[0].data||[], divisions=q[1].data||[], season=CG.pickCurrentSeason(q[2].data||[]),
      profiles=q[3].data||[], roster=q[4].data||[], contracts=q[5].data||[],
      games=q[6].data||[], transactions=q[7].data||[], news=q[8].data||[],
      /* Both public feeds are scoped to the season being displayed. Prototype-era rows carry a
         null season_id, so this is what keeps retired clubs ("Circuit Breakers signed…") and games
         that were never played off the home page — and it keeps Season 1's ledger out of Season 2
         for free. Every writer stamps season_id; see the guard in CG.saveNews. */
      _inSeason = function(r){ return !!(season && r && r.season_id === season.id); },
      draftPicks=(q[9]&&!q[9].error&&q[9].data)||[], registrations=(q[10]&&!q[10].error&&q[10].data)||[],
      leaguesRaw=(q[11]&&!q[11].error&&q[11].data)||[],
      gameStatsRows=(q[12]&&!q[12].error&&q[12].data)||[],
      flagsRaw=(q[13]&&!q[13].error&&q[13].data)||[],
      siteCfgRaw=(q[14]&&!q[14].error&&q[14].data)||[],
      suspRaw=(q[15]&&!q[15].error&&q[15].data)||[],
      awardsRaw=(q[16]&&!q[16].error&&q[16].data)||[];
  transactions = transactions.filter(_inSeason);
  news = news.filter(_inSeason);

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
  var maxDoneSeason = (CG._seasonsRaw||[]).reduce(function(m,s){ return s.status==="complete" ? Math.max(m, s.number||0) : m; }, 0);
  var suspAll = suspRaw.map(function(sx){
    var by = profById[sx.created_by], who = profById[sx.profile_id];
    /* a season-length suspension is served once its final season has completed — mirror the
       DB's is_suspended() so the client never blocks a player the server already cleared,
       even in the window before flip_season_status() flips the row to 'lifted' */
    var served = sx.status!=="active" ||
      (sx.mode==="seasons" && sx.until_season!=null && maxDoneSeason >= sx.until_season);
    return { id:sx.id, playerId:sx.profile_id,
      playerName: (who && (who.gamertag||who.display_name)) || null,
      status: served ? "served" : "active",
      games: sx.games_total||0, mode: sx.mode, endsAt: sx.ends_at, untilSeason: sx.until_season,
      reason: sx.reason||"", issued: sx.created_at,
      decidedBy: (by && (by.gamertag||by.display_name)) || "Commissioner" };
  });
  /* A formal warning is "on record, no games lost" — it must NEVER read as a suspension.
     Split it out HERE, at the source, so every downstream consumer (lineup builder, public
     profile, Users & roles, the desk KPIs) is correct by construction rather than by each
     call site remembering to filter on mode. Warnings are staff-only: the public RLS policy
     excludes them, so they only appear for a commissioner or the player themselves. */
  var suspMapped = suspAll.filter(function(s){ return s.mode!=="warning"; });
  var warnMapped = suspAll.filter(function(s){ return s.mode==="warning"; });
  /* playoff series (the schedule above is already this season only), plus the
     public clinch list so the projected bracket can lock in confirmed clubs */
  var playoffGames = schedule.filter(function(g){ return g.stage==="playoff"; });
  var clinched = (CG._siteCfg && CG._siteCfg["clinched_"+((season&&season.number)||1)]) || [];
  var lg = { players:players, byTeam:byTeam, schedule:schedule, results:regResults,
             allResults:results, playoffGames:playoffGames, clinched:clinched,
             suspensions:suspMapped, warnings:warnMapped, demoNow:CG.now(), season:season, live:true };
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
      nights: [ { key:"n1", at:nights[0] }, { key:"n2", at:nights[1] } ], open:true };
  } else {
    /* No unplayed games — off-season, or before a schedule exists. Without this the prototype
       seed from part6_hub survives and the site publicly advertises a dead 2026 deadline.
       It stays an OBJECT (never null) because consumers across the hub, profiles, the Staff Desk
       and the notification bell read .key/.label/.nights unguarded; `open` is the real signal. */
    /* No scheduled game week. `open:false` is the flag every consumer should branch on, but the
       label stays a real string: it lands inside esc() in a dozen places, and null renders as the
       literal "null". The deadline stays null on purpose — there genuinely isn't one — so anything
       that prints a date MUST check .open first (Intl.format(null) happily returns Dec 31 1969). */
    CG.WEEK8 = { key:null, label:"Game week", deadline:null, nights:[], open:false };
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
  lg.lastNight = lg.lastNight || [];

  /* real awards: pair each week's skater + goalie rows into the shape every honors surface
     expects ({week, skater, goalie, blurbs}); season awards + champion ride alongside */
  var seasonAwardsRaw = awardsRaw.filter(function(a){ return !seasonId || a.season_id===seasonId; });
  var potwByWeek = {};
  seasonAwardsRaw.forEach(function(a){
    if (a.category==="potw_skater" || a.category==="potw_goalie"){
      var e = potwByWeek[a.week] = potwByWeek[a.week] || { week:a.week };
      if (a.category==="potw_skater"){ e.skater = a.profile_id; e.skBlurb = a.stat_line||""; e.blurb = a.stat_line||""; }
      else { e.goalie = a.profile_id; e.glBlurb = a.stat_line||""; }
    }
  });
  lg.potw = Object.values(potwByWeek).filter(function(e){ return e.skater && e.goalie; })
    .sort(function(a,b){ return (a.week||0)-(b.week||0); });
  lg.seasonAwards = seasonAwardsRaw.filter(function(a){ return a.week==null && a.category!=="champion"; });
  lg.champion = seasonAwardsRaw.find(function(a){ return a.category==="champion"; }) || null;
  lg._awardsRaw = awardsRaw;

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
  lg._contractsRaw = contracts;
  /* current season only — a spot in a past season must not block this season's pool */
  lg._rosteredIds = {}; roster.forEach(function(rs){ if(!seasonId || rs.season_id===seasonId) lg._rosteredIds[rs.profile_id] = true; });
  CG.mapDraftData(lg, draftPicks, registrations);

  CG.LIVE.loaded = true;
  return lg;
};

/* ================================================================
   REAL AUTH — Discord OAuth via Supabase, replacing the demo-seat
   system. Role is derived from profiles.role + club management pointers.
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
  if (CG.auth.user){
    var uid = CG.auth.user.id, sidA = (CG.SEASON && CG.SEASON.id) || null;
    /* Four independent single-row lookups that run for EVERY signed-in user before the first
       paint — batched rather than awaited one at a time. Each resolves to null on its own
       failure so one denied policy can't blank the other three. */
    var one = function(qb){ return qb.then(function(r){ return (r && r.data) || null; }, function(){ return null; }); };
    var mine = await Promise.all([
      one(CG.sb.from("profiles").select("*").eq("id", uid).maybeSingle()),
      sidA ? one(CG.sb.from("season_registrations").select("*").eq("season_id", sidA).eq("profile_id", uid).maybeSingle()) : null,
      one(CG.sb.from("staff_applications").select("*").eq("profile_id", uid).maybeSingle()),
      one(CG.sb.from("owner_applications").select("*").eq("profile_id", uid).maybeSingle())
    ]);
    CG.auth.profile = mine[0]; CG.auth.registration = mine[1];
    CG.auth.staffApp = mine[2]; CG.auth.ownerApp = mine[3];
  } else { CG.auth.profile = null; CG.auth.registration = null; CG.auth.ownerApp = null; }
  CG.auth.role = CG.computeRole(CG.auth.profile);
  await CG.loadManagerData();
  await Promise.all([CG.loadAvailability(), CG.loadTrades()]);
  /* real notifications: load + realtime subscribe on sign-in, tear down on sign-out */
  if (CG.auth.user){ CG.loadNotifs().then(function(){ if(CG.renderChrome)CG.renderChrome(); }); }
  else { CG._notifs = null; if (CG._notifChannel){ try{ CG.sb.removeChannel(CG._notifChannel); }catch(e){} CG._notifChannel = null; } }
  /* direct messages: load + subscribe on sign-in, tear down on sign-out */
  if (CG.auth.user){ CG.loadDMs().then(function(){ CG.subscribeDMs(); if(CG.renderChrome)CG.renderChrome(); if(location.hash.indexOf("/messages")>=0&&CG.router)CG.router(); }); }
  else { CG.teardownDMs && CG.teardownDMs(); }
  /* complaints & requests (league office) — RLS returns what this user may see */
  if (CG.auth.user){ CG.loadActionRequests().then(function(){ CG.rerenderIfShowingCases(); }); }
  else if (CG.lg){ CG.lg._actionReqs=[]; CG.lg._actionMsgs={}; }
  /* staff/commish: the "needs attention" backlog + the Staff Desk data cards */
  if (CG.auth.user && (CG.auth.role==="staff" || CG.auth.role==="commish")){ CG.loadStaffAttention(); CG.loadStaffExtras(); }
  else { CG._staffAttention = null; CG._staffExtras = null; }
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
  var held = CG.contractHeldIds();
  lg.draftPool = (registrations||[]).filter(function(r){ return !rostered[r.profile_id] && !held[r.profile_id] && (!r.season_id || r.season_id===poolSeason); })
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
    /* the current draft is the CURRENT SEASON's — never keyed off stray pick rows, so
       leftover or future-season picks can never desync the desk from the controls */
    var curSn = (CG.SEASON && CG.SEASON.number) || 1;
    CG.lg.draftState = states.find(function(s){ return s.season_number===curSn; }) || null;
    /* Everything below is mutually independent, so it goes out as one batch instead of six
       serial round trips. Each job owns its own rejection handler — a single RLS denial must
       not blank the other panels the way one shared try/catch did. */
    var myBoardTeam = CG.myManagedTeam && CG.myManagedTeam();
    var myCode = CG.myClub && CG.myClub(), myTid = (CG.lg._codeToId||{})[myCode];
    var upcoming = myTid ? (CG.lg.schedule||[]).filter(function(g){ return (g.home===myCode||g.away===myCode) && g.status!=="final"; }) : [];
    var upIds = upcoming.map(function(g){ return g.id; });
    CG.lg._myBoard = CG.lg._myBoard || [];
    CG.lg._myTrades = [];
    if (myTid){ CG.lg._vetoes = {}; CG.lg._servers = {}; CG.lg._lineups = {}; }
    var jobs = [];
    /* my club's private draft board (ranked wishlist; RLS keeps it club-only) */
    if (myBoardTeam && myBoardTeam.id && CG.SEASON && CG.SEASON.id){
      jobs.push(CG.sb.from("draft_boards").select("profile_id,rank")
        .eq("season_id", CG.SEASON.id).eq("team_id", myBoardTeam.id).order("rank")
        .then(function(db){ if (db && !db.error) CG.lg._myBoard = (db.data||[]).map(function(r){ return r.profile_id; }); }, function(){}));
    }
    if (role==="commish" || role==="staff"){
      /* both tables now have TWO fkeys to profiles (the applicant + decided_by), so a bare
         profiles(...) embed is ambiguous and PostgREST rejects the whole query. Name the applicant
         constraint; the key stays "profiles" so the render code is unchanged. */
      jobs.push(CG.sb.from("owner_applications").select("*, profiles!owner_applications_profile_id_fkey(gamertag)").order("created_at",{ascending:false})
        .then(function(oa){ CG.lg._ownerApps = (oa && !oa.error && oa.data) || []; }, function(){ CG.lg._ownerApps = []; }));
      jobs.push(CG.sb.from("staff_applications").select("*, profiles!staff_applications_profile_id_fkey(gamertag)").order("created_at",{ascending:false})
        .then(function(sa2){ CG.lg._staffApps = (sa2 && !sa2.error && sa2.data) || []; }, function(){ CG.lg._staffApps = []; }));
      /* staff ballots on applications — RLS on application_ballots keeps these office-only, so the
         applicant can never read them however this loads */
      jobs.push(CG.sb.from("application_ballots").select("app_type,application_id,voter_id,vote,note,updated_at, voter:profiles!application_ballots_voter_id_fkey(gamertag)")
        .then(function(vb){ CG.lg._appBallots = (vb && !vb.error && vb.data) || []; }, function(){ CG.lg._appBallots = []; }));
    }
    if (myTid){
      /* my club's live trades (incoming + outgoing, still open) */
      jobs.push(CG.sb.from("trades").select("*").or("from_team_id.eq."+myTid+",to_team_id.eq."+myTid).eq("status","proposed").order("created_at",{ascending:false})
        .then(function(tr){ CG.lg._myTrades = (tr && !tr.error && tr.data) || []; }, function(){ CG.lg._myTrades = []; }));
      /* server vetoes + resolved servers for my club's upcoming games */
      if (upIds.length){
        jobs.push(CG.sb.from("game_vetoes").select("game_id,team_id,veto,preferred,pref1,pref2").in("game_id", upIds)
          .then(function(vv){ (vv && !vv.error && vv.data || []).forEach(function(v){ if(v.team_id===myTid) CG.lg._vetoes[v.game_id]=v; }); }, function(){}));
        upcoming.filter(function(g){ return CG.now() >= g.at - (CG.VETO_LOCK_MS||1800000); }).forEach(function(g){
          jobs.push(CG.sb.rpc("resolve_game_server",{p_game:g.id}).then(function(r){ if(r && !r.error && r.data) CG.lg._servers[g.id]=r.data; }).catch(function(){}));
        });
      }
      if (CG.SEASON && CG.SEASON.id){
        jobs.push(CG.sb.from("lineups").select("*").eq("season_id", CG.SEASON.id).eq("team_id", myTid)
          .then(function(lu){ (lu && !lu.error && lu.data || []).forEach(function(row){ CG.lg._lineups[myCode+":"+row.night]=row; }); }, function(){}));
      }
    }
    await Promise.all(jobs);
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
 * Notifications — the bell reads the real public.notifications table.
 * DB triggers already write per-user alerts (trades, roster moves, role
 * changes, application decisions, rule violations); this surfaces them.
 * ------------------------------------------------------------------ */
CG._notifs = null;
CG.notifRoute = function(view, param){
  switch (view){
    case "team":         return param ? "#/team/"+param : "#/teams";
    case "draft":        return "#/hub/draft";
    case "manager":      return "#/hub";
    case "transactions": return "#/home";
    case "automations":  return "#/admin/automations";
    case "preseason":    return "#/admin/preseason";
    case "users":        return "#/admin/users";
    case "rulebook":     return "#/rulebook";
    case "staffdesk":    return "#/hub/staffdesk";
    case "stafftasks":   return "#/hub/staffdesk";
    case "complaints":   return "#/hub/complaints";
    /* the invite is an external URL; the notification click handler opens http(s) routes in a
       new tab. Fall back to the register page (which also carries a Join button) if unset. */
    case "discord":      return (CG._siteCfg && CG._siteCfg.discord_invite) || "#/register";
    default:             return "#/hub";
  }
};
CG.notifIcon = function(type){
  return { trade:"swap", flag:"flag", roster:"users", role:"shield", sign:"check", draft:"grid", discord:"msg", app:"users", request:"flag" }[type] || "bell";
};
/* staff/commish backlog summary from the DB (open cases, apps, unmatched EA imports, finals
   missing box scores, active suspensions). Powers the Staff Desk "Needs attention" card and
   mirrors the daily #staff-general briefing. */
CG.loadStaffAttention = async function(){
  if (!CG.sb || !CG.auth.user){ CG._staffAttention = null; return; }
  try { var r = await CG.sb.rpc("staff_needs_attention");
    CG._staffAttention = (r && !r.error) ? r.data : null;
    if (/\/hub\/staffdesk/.test(location.hash) && CG.router) CG.router();
  } catch(e){ CG._staffAttention = null; }
};
/* the Staff Desk's data cards — EA import issues, activity feed, directory, and the shared
   task list. One batch, stored on CG._staffExtras; refreshed after task edits. */
CG.loadStaffExtras = async function(){
  if (!CG.sb || !CG.auth.user){ CG._staffExtras = null; return; }
  try {
    var q = await Promise.all([
      CG.sb.rpc("ea_import_issues"), CG.sb.rpc("staff_activity", { p_limit:12 }),
      CG.sb.rpc("staff_directory"),
      CG.sb.from("staff_tasks").select("*").order("status").order("created_at",{ascending:false})
    ]);
    CG._staffExtras = {
      ea: (q[0]&&!q[0].error)?q[0].data:null,
      activity: (q[1]&&!q[1].error)?q[1].data:[],
      directory: (q[2]&&!q[2].error)?q[2].data:[],
      tasks: (q[3]&&!q[3].error&&q[3].data)||[]
    };
    if (/\/hub\/staffdesk/.test(location.hash) && CG.router) CG.router();
  } catch(e){ CG._staffExtras = null; }
};
CG.refreshStaffExtras = function(){ CG.loadStaffExtras(); };
CG.loadNotifs = async function(){
  if (!CG.sb || !CG.auth.user){ CG._notifs = null; return; }
  try {
    var r = await CG.sb.from("notifications")
      .select("id,type,title,body,link_view,link_param,read,created_at")
      .order("created_at",{ascending:false}).limit(50);
    if (r.error){ CG._notifs = []; return; }
    var readMap = CG.store.get("read");
    CG._notifs = (r.data||[]).map(function(n){
      if (n.read) readMap[n.id] = true;     /* keep the drawer's read-state in sync with the DB */
      return { id:n.id, t:Date.parse(n.created_at), icon:CG.notifIcon(n.type),
               title:n.title||"League update", body:n.body||"", read:!!n.read,
               route:CG.notifRoute(n.link_view, n.link_param) };
    });
    CG.store.set("read", readMap);
    /* realtime: new alerts light the bell without a refresh */
    if (!CG._notifChannel){
      CG._notifChannel = CG.sb.channel("notifs-"+CG.auth.user.id)
        .on("postgres_changes",{ event:"INSERT", schema:"public", table:"notifications",
            filter:"profile_id=eq."+CG.auth.user.id }, function(payload){
          var n = payload["new"]||{};
          (CG._notifs = CG._notifs||[]).unshift({ id:n.id, t:Date.parse(n.created_at||new Date().toISOString()),
            icon:CG.notifIcon(n.type), title:n.title||"League update", body:n.body||"", read:false,
            route:CG.notifRoute(n.link_view, n.link_param) });
          if (CG.renderChrome) CG.renderChrome();
        }).subscribe();
    }
  } catch(e){ CG._notifs = CG._notifs || []; }
};
CG.baseNotifs = function(){
  if (!CG.auth || !CG.auth.user) return [];
  return (CG._notifs || []).slice();
};
/* opening the bell marks everything read in the DB (the drawer still highlights what was new) */
var _openBellProto = CG.openBell;
CG.openBell = function(){
  _openBellProto();
  if (!CG.sb || !CG.auth.user || !CG._notifs) return;
  var unread = CG._notifs.filter(function(n){ return !n.read; });
  if (!unread.length) return;
  CG.sb.from("notifications").update({ read:true }).eq("profile_id", CG.auth.user.id).eq("read", false)
    .then(function(){ unread.forEach(function(n){ n.read = true; }); });
};

/* ------------------------------------------------------------------ *
 * Matchup lineups — the public "Confirmed lineups" card reads the REAL
 * lineups table (anon-readable), never the depth-chart guess. Rows are
 * fetched per matchup and cached; no row = "Lineup not submitted yet".
 * ------------------------------------------------------------------ */
CG._pubLineups = {};   /* "<teamCode>:<night>" -> lineups row (or null once fetched) */
var _plannedLineupProto = CG.plannedLineup;
CG.plannedLineup = function(g, code){
  /* keep the prototype path for the signed-in manager's own saved draft */
  var saved = (CG.store.get("lineups")||{})[g.id+":"+code];
  if (saved && saved.status!=="draft") return saved.slots;
  var night = CG.gameNight ? CG.gameNight(g) : "wed";
  var row = CG._pubLineups[code+":"+night];
  if (row === undefined && CG.lg && CG.lg._lineups) row = CG.lg._lineups[code+":"+night];
  if (row) return { LW:row.lw||null, C:row.center||null, RW:row.rw||null, LD:row.ld||null, RD:row.rd||null, G:row.goalie||null };
  return { LW:null, C:null, RW:null, LD:null, RD:null, G:null };   /* the live site never guesses */
};
/* fetch both clubs' submitted lineups for a matchup, then re-render once they land */
CG.loadMatchupLineups = function(g){
  if (!CG.sb || !CG.SEASON || !CG.SEASON.id || !g) return;
  var night = CG.gameNight(g);
  var kA = g.home+":"+night, kB = g.away+":"+night;
  if (CG._pubLineups[kA] !== undefined && CG._pubLineups[kB] !== undefined) return;   /* cached */
  var ids = [ (CG.lg._codeToId||{})[g.home], (CG.lg._codeToId||{})[g.away] ].filter(Boolean);
  if (ids.length<2) return;
  CG.sb.from("lineups").select("team_id,night,center,lw,rw,ld,rd,goalie")
    .eq("season_id", CG.SEASON.id).eq("night", night).in("team_id", ids)
    .then(function(r){
      CG._pubLineups[kA] = null; CG._pubLineups[kB] = null;
      ((r&&r.data)||[]).forEach(function(row){
        var code = (CG.lg._idToCode||{})[row.team_id];
        if (code) CG._pubLineups[code+":"+night] = row;
      });
      /* re-render only if the user is still looking at this matchup */
      if (location.hash.indexOf("#/matchup/"+g.id)===0 && CG.router) CG.router();
    });
};
var _matchupAfterProto = CG.AFTER.matchup;
CG.AFTER.matchup = function(param, qs){
  if (_matchupAfterProto) _matchupAfterProto(param, qs);
  var g = CG.lg && CG.lg.schedule.find(function(x){ return x.id===param; });
  if (g && g.status!=="final") CG.loadMatchupLineups(g);
};

/* ------------------------------------------------------------------ *
 * My Hub onboarding — a signed-in member with no roster spot used to see
 * "Evening, coach." and one empty card. Show them where they actually
 * stand: registration status, the road ahead, and their applications.
 * ------------------------------------------------------------------ */
var _hubDashboardProto = null;
CG._wrapHubDashboard = function(){
  if (_hubDashboardProto || !CG.hubDashboard) return;
  _hubDashboardProto = CG.hubDashboard;
  CG.hubDashboard = function(){
    var me = CG.me(), r = CG.role();
    if (me || r==="staff" || r==="commish" || !CG.auth.profile) return _hubDashboardProto();
    var p = CG.auth.profile, s = CG.SEASON||{}, reg = CG.auth.registration;
    var h = '<div style="margin-bottom:24px"><span class="eyebrow chr">'+CG.fmtFull(CG.now())+'</span>'+
      '<h1 class="h-page" style="margin-top:8px">Welcome, '+esc(p.gamertag||p.display_name||"skater")+'.</h1>'+
      '<p class="lede" style="margin-top:10px">You’re signed in — here’s where you stand on the way to a roster spot.</p></div>';
    /* 1 · registration status */
    h += '<div class="card" style="margin-bottom:18px"><div class="card-h"><h3>Your registration</h3>'+
      (reg?'<span class="chip chip-win">Registered</span>':(s.registration_open?'<span class="chip chip-warn">Not registered</span>':'<span class="chip">Closed</span>'))+'</div><div class="card-b">'+
      (reg
        ? '<p class="small" style="color:var(--steel)">You’re in the '+esc(CG.seasonTag())+' pool as a <b>'+esc(CG.POS_NAME[reg.position]||reg.position||"skater")+'</b>. '+
          (s.registration_deadline && Date.parse(s.registration_deadline)>CG.now()
            ? 'You made the eligibility window — you’ll be randomly assigned for the pre-season and enter the draft.'
            : 'You’ll be placed on a club automatically — watch your notifications.')+'</p>'+
          (!p.ea_id?'<div class="note red" style="margin-top:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">'+CG.ic("flag",15)+'<span style="flex:1">Your <b>EA ID</b> is missing — stats can’t link to you without it.</span><button class="btn btn-ghost btn-sm" id="hubEaBtn">Add EA ID</button></div>':"")
        : (s.registration_open
            ? '<p class="small" style="color:var(--steel)">Registration is open'+(s.registration_deadline?' — register by <b>'+CG.fmtFull(Date.parse(s.registration_deadline))+'</b> to be draft-eligible. Join later and you still play; you’re placed on a club automatically.':'.')+'</p>'+
              '<a class="btn btn-chrome" style="margin-top:12px" href="#/register">Register to play</a>'
            : '<p class="small" style="color:var(--steel)">Registration isn’t open right now — watch the announcements channel.</p>'))+
      '</div></div>';
    /* 2 · the road ahead */
    h += CG.roadAheadCard(s, { chip:"your season, step by step" });
    /* 3 · applications */
    var oa = CG.auth.ownerApp, sa = CG.auth.staffApp;
    h += '<div class="card" style="margin-bottom:18px"><div class="card-h"><h3>Applications</h3></div><div class="card-b" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">'+
      (oa?'<span class="chip '+(oa.status==="approved"?"chip-win":oa.status==="denied"?"chip-loss":"chip-warn")+'">Own a club — '+esc(oa.status)+'</span>':'<a class="chip" href="#/owner" style="cursor:pointer">Apply — own a club</a>')+
      (sa?'<span class="chip '+(sa.status==="approved"?"chip-win":sa.status==="denied"?"chip-loss":"chip-warn")+'">Join the staff — '+esc(sa.status)+'</span>':'<a class="chip" href="#/staffapply" style="cursor:pointer">Apply — join the staff</a>')+
      '<span class="caption" style="flex-basis:100%">Owner applications are reviewed in the off-season window; staff applications any time.</span></div></div>';
    return h;
  };
};

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
  /* remember where the user was — OAuth bounces through Discord and lands on the origin,
     so without this every sign-in dumps them back on Home instead of the page they left */
  try { if (location.hash && location.hash.indexOf("#/")===0) localStorage.setItem("cg_return", JSON.stringify({ h:location.hash, at:Date.now() })); } catch(e){}
  /* match the current site's redirect exactly (origin only) so it stays within
     Supabase's existing Discord redirect allowlist */
  /* We only need identity to sign in. We do NOT request guilds.join: silently adding people
     to the server proved unreliable (Discord rejects tokens that predate the scope), so on
     first login we instead drop an in-site notification with the server invite (see
     handle_new_user). Discord still forces the email scope on its side — see the register
     page copy — but the site never uses it. */
  CG.sb.auth.signInWithOAuth({ provider:"discord", options:{ redirectTo: window.location.origin, scopes:"identify" } });
};
CG.signOut = async function(){ if (CG.sb && CG.sb.auth){ try { await CG.sb.auth.signOut(); } catch(e){} } location.hash = "#/home"; };
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
    '<p class="lede" style="margin:12px auto 22px">Your Discord account is your league account — sign in once and you’re in. Not in the Chel Gaming server yet? We’ll send you the invite right after you sign in.</p>'+
    '<button class="btn btn-lg" id="dcSignIn" style="background:#5865F2;color:#fff">'+CG.DISCORD_GLYPH+'Sign in with Discord</button>'+
    '<p class="caption" style="margin-top:12px">Signs you in with your Discord identity. Discord also shares your email — the league never uses or displays it.</p></div></section>';
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
    /* site_config is anon-readable, so guests get the real join link at the exact moment they're
       told they need it — the site cannot add them to the server on their behalf */
    var inviteOut = CG._siteCfg && CG._siteCfg.discord_invite;
    return head + '<div class="shell" style="max-width:620px;padding-bottom:48px"><div class="card"><div class="empty" style="padding:60px 20px">'+
      '<div class="e-art">'+CG.ic("user",22)+'</div><b>Sign in to register</b>'+
      '<p>Your Discord account is your league account. You also need to be in the Chel Gaming server to register — join it now, or we’ll send you the invite right after you sign in.</p>'+
      '<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:18px">'+
        '<button class="btn btn-lg" id="dcSignIn" style="background:#5865F2;color:#fff">'+CG.DISCORD_GLYPH+'Sign in with Discord</button>'+
        (inviteOut?'<a class="btn btn-lg btn-ghost" href="'+esc(inviteOut)+'" target="_blank" rel="noopener">Join the Discord server</a>':"")+
      '</div></div></div></div>';
  }
  if (!open){
    return head + '<div class="shell" style="max-width:620px;padding-bottom:48px"><div class="card"><div class="empty" style="padding:60px 20px">'+
      '<div class="e-art">'+CG.ic("clock",22)+'</div><b>Registration isn’t open right now</b>'+
      '<p>'+(s.status==="active"?"Season "+s.number+" is already underway.":"Registration for the next season hasn’t opened yet — watch the announcements channel.")+'</p>'+
      '<a class="btn btn-ghost" style="margin-top:16px" href="#/schedule">View the schedule</a></div></div></div>';
  }
  var p = CG.auth.profile, reg = CG.auth.registration, eaMissing = !p.ea_id;
  /* Rule 2.5: a contract never replaces registration — spell out what an unsigned deal costs */
  var snumR = s.number||1;
  var myCt = ((CG.lg && CG.lg._contractsRaw) || []).find(function(c){
    return p && c.profile_id===p.id && c.status==="active" && !c.is_manager && c.team_id &&
           (c.start_season||1)<=snumR && (c.end_season||1)>=snumR; }) || null;
  var ctCode = myCt ? ((CG.lg && CG.lg._idToCode) || {})[myCt.team_id] : null;
  var ctName = (ctCode && CG.TEAM[ctCode] && CG.TEAM[ctCode].name) || "your club";
  var onRoster = !!(myCt && p && ((CG.lg && CG.lg._rosteredIds) || {})[p.id]);
  var statusCard = reg ? '<div class="note grn" style="margin-bottom:18px"><b style="font-family:var(--f-disp)">You’re registered for Season '+(s.number||1)+'.</b> '+(myCt&&onRoster
      ? 'Your contract with <b>'+esc(ctName)+'</b> is active — you’re on the roster through Season '+(myCt.end_season||snumR)+'.'
      : 'Position on file: <b>'+esc(CG.POS_NAME[reg.position]||reg.position||"—")+'</b>. The commissioner assigns roster spots — you’ll be notified.')+' Update your details below any time before the deadline.</div>' : "";
  if (myCt && !reg){
    statusCard = '<div class="note" style="margin-bottom:18px"><b style="font-family:var(--f-disp)">You’re under contract with '+esc(ctName)+' through Season '+(myCt.end_season||snumR)+' — but a contract doesn’t replace registration.</b> Until you sign up you can’t play, and your '+CG.fmtMoney(myCt.salary||0)+' salary sits on the club’s cap as dead money. If '+esc(ctName)+' takes on a new owner and you still haven’t signed up after the deadline, the deal is voided and you’re suspended through Season '+(myCt.end_season||snumR)+' (Rule 2.5). Registering — any time — puts you straight back on the roster.</div>' + statusCard;
  }
  /* Auto-join is retired — sign-in requests `identify` only, so the member joins the server
     themselves. Registration is hard-gated on in_guild, so the link belongs here, up front,
     rather than as a dead-end toast at submit. */
  var invite = CG._siteCfg && CG._siteCfg.discord_invite;
  var guildCard = (!p.in_guild && invite)
    ? '<div class="note" style="margin-bottom:18px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">'+CG.ic("msg",15)+
      '<span style="flex:1">Registration needs you in the <b>Chel Gaming Discord</b> — that’s where game nights run. It looks like you’re not in yet.</span>'+
      '<span style="display:inline-flex;gap:8px"><a class="btn btn-sm" style="background:#5865F2;color:#fff" href="'+esc(invite)+'" target="_blank" rel="noopener">Join the server</a>'+
      '<button class="btn btn-ghost btn-sm" id="guildRecheck">I’ve joined — re-check</button></span></div>'
    : "";
  statusCard = guildCard + statusCard;
  var body = '<div class="card"><div class="card-h"><h3>'+(reg?"Update registration":"Register")+'</h3><span class="chip '+(reg?"chip-win":"chip-chrome")+'">'+(reg?"Registered":"Open")+'</span></div><div class="card-b">'+
    (eaMissing ? '<div class="note red" style="margin-bottom:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">'+CG.ic("flag",15)+'<span style="flex:1">You need your <b>EA ID</b> on file to register.</span><button class="btn btn-ghost btn-sm" id="regEaBtn">Add EA ID</button></div>'
                : '<label class="fld"><span>EA ID (on file)</span><input value="'+esc(p.ea_id)+'" disabled style="opacity:.7"></label>')+
    '<label class="fld"><span>Primary position</span></label><div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px" role="group" aria-label="Primary position">'+
      ["C","LW","RW","LD","RD","G"].map(function(pos){ var on=(reg?reg.position:"C")===pos; return '<button type="button" class="chip '+(on?"chip-chrome":"")+'" data-regpos="'+pos+'" aria-pressed="'+on+'" style="cursor:pointer;padding:8px 14px">'+CG.POS_NAME[pos]+'</button>'; }).join("")+'</div>'+
    '<label class="fld"><span>Note to the league office (optional)</span><textarea id="regNote" rows="3" placeholder="Availability or anything the commissioner should know…">'+esc((reg&&reg.note)||"")+'</textarea></label>'+
    '<button class="btn btn-chrome" id="regSubmit"'+(eaMissing?" disabled":"")+'>'+(reg?"Update registration":"Submit registration")+'</button>'+
    '<p class="caption" style="margin-top:10px">You must be in the Chel Gaming Discord to register — after you sign in, we’ll send you the invite if you’re not in yet. By registering you agree to the <a href="#/legal" style="font-weight:700;border-bottom:2px solid var(--chrome)">Terms &amp; Privacy</a> and the rulebook.</p>'+
  '</div></div>';
  return head + '<div class="shell" style="max-width:640px;padding-bottom:48px">'+statusCard+body+'</div>';
};
CG.AFTER.register = function(){
  var dc=document.getElementById("dcSignIn"); if(dc) dc.addEventListener("click", function(){ CG.signIn(); });
  var sel = (CG.auth.registration && CG.auth.registration.position) || "C";
  document.querySelectorAll("[data-regpos]").forEach(function(el){ el.addEventListener("click", function(){
    sel=this.getAttribute("data-regpos");
    document.querySelectorAll("[data-regpos]").forEach(function(x){ var on=x===el; x.classList.toggle("chip-chrome", on); x.setAttribute("aria-pressed", on); });
  }); });
  var ea=document.getElementById("regEaBtn"); if(ea) ea.addEventListener("click", CG.promptEaId);
  var sub=document.getElementById("regSubmit"); if(sub) sub.addEventListener("click", function(){ CG.registerForSeason(sel, (document.getElementById("regNote")||{}).value||""); });
  var rc=document.getElementById("guildRecheck"); if(rc) rc.addEventListener("click", function(){
    var btn=this; btn.disabled=true; btn.textContent="Checking…";
    CG.sb.from("profiles").select("in_guild").eq("id",CG.auth.user.id).maybeSingle().then(function(r){
      if (r.data && r.data.in_guild){ CG.auth.profile.in_guild=true; CG.toast("You’re in — welcome to the league","ok"); CG.router(); }
      else { btn.disabled=false; btn.textContent="I’ve joined — re-check"; CG.toast("Not seeing you in the server yet — the sync runs every few minutes, try again shortly","err"); }
    });
  });
};
/* ---- Terms & Privacy — one plain-language page, linked from the footer + register consent ---- */
CG.ROUTES.legal = function(){
  var head = CG.pageHead("The fine print, in plain language","Terms & Privacy",
    "What you agree to by playing, and exactly what the league stores about you.");
  function sec(title, paras){
    return '<div class="card" style="margin-bottom:18px"><div class="card-h"><h3>'+title+'</h3></div><div class="card-b">'+
      paras.map(function(p){ return '<p class="small" style="color:var(--ink-3);line-height:1.7;max-width:74ch;margin-bottom:10px">'+p+'</p>'; }).join("")+'</div></div>';
  }
  return head + '<div class="shell" style="max-width:820px;padding-bottom:48px">'+
    sec("Terms of play", [
      "Chel Gaming Hockey League is a free, community-run competitive EA Sports NHL league. Registering commits you to the rulebook — availability, conduct, and game-night procedures included. The commissioners may suspend or remove accounts that break it.",
      "League decisions (rulings, forfeits, suspensions, roster moves) follow the <a href='#/rulebook' style='font-weight:700;border-bottom:2px solid var(--chrome)'>rulebook</a> and are made by league staff and commissioners. The complaint and appeal process is in Chapter 7.",
      "The league is not affiliated with EA Sports, the NHL, Discord, or Twitch. Club names and marks belong to their owners."
    ])+
    sec("What we store", [
      "<b>From Discord (when you sign in):</b> your Discord id, username, display name, and avatar. Discord also passes your email to our sign-in provider, but the league never uses or displays it. If you're not in the Chel Gaming server yet, you'll get an in-site notification with the invite.",
      "<b>From you:</b> your EA ID and platform, season registrations, weekly availability, applications, and anything you write on the site (messages, complaints, trade notes).",
      "<b>From play:</b> scores and full box-score statistics import automatically from the EA NHL match record after every league game. These form the league's permanent competitive record.",
      "Discord shares your email with our sign-in provider, but the league never uses or displays it. Availability is visible only to your club's management and league staff. Complaint evidence is private to the league office."
    ])+
    sec("Where it lives", [
      "The site runs on Netlify, data lives in Supabase (Postgres), game-night automation posts to the league's Discord server, and stream status is checked against Twitch. Each processor sees only what it needs to run its part.",
      "Backups of the league database are taken nightly and kept encrypted for 30 days."
    ])+
    sec("Deleting your data", [
      "Message any commissioner from <a href='#/hub/messages' style='font-weight:700;border-bottom:2px solid var(--chrome)'>Messages</a> (or on Discord) to delete your account. Deletion removes your profile, registrations, availability, applications, and messages. The permanent game record — box scores and results — is retained with your gamertag, the same way any league's record book works.",
      "Questions about any of this go to the commissioners — they're listed on every club page."
    ])+
    '<p class="caption">Last updated July 16, 2026 · applies to chelgamingleague.com and the league Discord.</p>'+
  '</div>';
};

/* Download any displayed logo as a PNG. The three mark variants map to the shipped 1024px files
   (a plain <a download> — instant, perfect); the wordmark lockups have no file, so they're composed
   to a canvas here using the page's real Archivo/Plex fonts, pixel-accurate and with no round-trip. */
CG.saveBlob = function(blob, name){
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function(){ URL.revokeObjectURL(url); }, 1500);
};
CG.dlWordmark = async function(onDark){
  try {
    if (document.fonts && document.fonts.ready){
      await document.fonts.ready;
      try { await document.fonts.load("900 100px Archivo"); await document.fonts.load('600 100px "IBM Plex Mono"'); } catch(e){}
    }
    var S = 3;  /* supersample for a crisp asset */
    var mark = onDark
      ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path d="M35.5 17.4 A13 13 0 1 0 35.5 30.6" fill="none" stroke="#f4f4f0" stroke-width="3.4" stroke-linecap="round"/><path d="M35 24 H28" fill="none" stroke="#ffe500" stroke-width="3.4" stroke-linecap="round"/></svg>'
      : '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path d="M35.5 17.4 A13 13 0 1 0 35.5 30.6" fill="none" stroke="#101519" stroke-width="3.4" stroke-linecap="round"/><path d="M35 24 H28" fill="none" stroke="#D9A800" stroke-width="3.6" stroke-linecap="round"/></svg>';
    var markPx = 132*S, pad = 30*S, gap = 22*S;
    var titleSize = 56*S, eyeSize = 21*S, lineGap = 12*S, eyeLS = 5*S;
    var titleFont = "900 "+titleSize+"px Archivo, sans-serif";
    var eyeFont = '600 '+eyeSize+'px "IBM Plex Mono", monospace';
    var meas = document.createElement("canvas").getContext("2d"), i;
    meas.font = titleFont; var titleW = meas.measureText("CHEL GAMING").width;
    var eyeText = "HOCKEY LEAGUE"; meas.font = eyeFont;
    var eyeW = 0; for (i=0;i<eyeText.length;i++) eyeW += meas.measureText(eyeText[i]).width + eyeLS;
    var W = Math.ceil(pad + markPx + gap + Math.max(titleW, eyeW) + pad);
    var H = Math.ceil(pad + markPx + pad);
    var cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    var ctx = cv.getContext("2d");
    var img = new Image();
    await new Promise(function(res,rej){ img.onload=res; img.onerror=rej; img.src = "data:image/svg+xml;charset=utf-8,"+encodeURIComponent(mark); });
    ctx.drawImage(img, pad, (H-markPx)/2, markPx, markPx);
    var tx = pad + markPx + gap, ty = (H - (titleSize+lineGap+eyeSize))/2;
    ctx.textBaseline = "top";
    ctx.fillStyle = onDark ? "#FFFFFF" : "#101519"; ctx.font = titleFont;
    ctx.fillText("CHEL GAMING", tx, ty);
    ctx.fillStyle = onDark ? "#9AA8B0" : "#5C6B75"; ctx.font = eyeFont;
    var ex = tx, eyTop = ty + titleSize + lineGap;
    for (i=0;i<eyeText.length;i++){ ctx.fillText(eyeText[i], ex, eyTop); ex += meas.measureText(eyeText[i]).width + eyeLS; }
    cv.toBlob(function(b){ b ? CG.saveBlob(b, "chel-gaming-wordmark"+(onDark?"":"-light")+".png") : CG.toast("Couldn’t render the PNG","err"); }, "image/png");
  } catch(e){ CG.toast("Couldn’t generate the PNG","err"); }
};
CG.AFTER.brand = function(){
  document.querySelectorAll("[data-dl-wordmark]").forEach(function(b){
    b.addEventListener("click", function(){ CG.dlWordmark(this.getAttribute("data-dl-wordmark")==="dark"); });
  });
};

/* The brand bible, as a page. It documents the system AND is built entirely from it — every colour
   is a token, every heading is on the scale, the one accent is used once per section. The canonical
   text lives in BRAND.md; if the two drift, the tokens in part1_head.html are what actually render. */
CG.ROUTES.brand = function(){
  /* the mark, drawn the right way for each surface. leagueMark carries the three shipped variants;
     the reversed form (light C + chrome crossbar, no tile) is what belongs on a dark ground. */
  function mk(kind, s){
    if (kind==="light")     return CG.leagueMark(s, "light");
    if (kind==="lighttile") return CG.leagueMark(s, "light-tile");
    if (kind==="reversed")  return '<svg width="'+s+'" height="'+s+'" viewBox="0 0 48 48" role="img" aria-label="Chel Gaming">'+
      '<path d="M35.5 17.4 A13 13 0 1 0 35.5 30.6" fill="none" stroke="#f4f4f0" stroke-width="3.4" stroke-linecap="round"/>'+
      '<path d="M35 24 H28" fill="none" stroke="#ffe500" stroke-width="3.4" stroke-linecap="round"/></svg>';
    return CG.leagueMark(s); /* default dark badge */
  }
  function wtext(onDark){  /* the CHEL GAMING / HOCKEY LEAGUE text block, no mark */
    return '<span style="line-height:1.05"><b style="font-family:var(--f-disp);font-weight:900;font-size:22px;letter-spacing:-.01em;display:block;color:'+(onDark?"#fff":"var(--ink)")+'">CHEL GAMING</b>'+
      '<span class="eyebrow" style="letter-spacing:.28em;'+(onDark?"color:var(--on-ink-dim)":"")+'">Hockey League</span></span>';
  }
  function wordmark(onDark, s){  /* the full lockup: mark + text, sized to the mark */
    return '<span style="display:inline-flex;align-items:center;gap:13px">'+mk(onDark?"reversed":"light", s||40)+wtext(onDark)+'</span>';
  }
  /* a framed specimen: the mark on the background it's built for. Pass dl to make the panel a
     one-click PNG download — {href} for a shipped file, {wm,dark} for a canvas-composed wordmark. */
  function logoCell(bg, inner, label, note, dl){
    var panel = '<div style="position:relative;background:'+bg+';display:flex;align-items:center;justify-content:center;padding:38px 20px;min-height:120px">'+
      inner + (dl ? '<span class="logo-dl-cue">'+CG.ic("dl",12)+' PNG</span>' : '') + '</div>';
    var open = dl && dl.href
      ? '<a class="logo-dl" download href="'+dl.href+'" aria-label="Download '+esc(label)+' logo as PNG" title="Download PNG">'
      : dl && dl.wm
        ? '<button type="button" class="logo-dl" data-dl-wordmark="'+(dl.dark?"dark":"light")+'" aria-label="Download the '+esc(label)+' as PNG" title="Download PNG">'
        : null;
    return '<div class="card">'+ (open ? open+panel+(dl.href?'</a>':'</button>') : panel) +
      '<div class="card-b"><b class="h-card" style="display:block">'+esc(label)+'</b>'+
        '<p class="caption" style="margin-top:4px;line-height:1.55">'+note+'</p></div></div>';
  }
  /* correct vs incorrect usage, keyed by colour AND the site's real check/x icons — never by colour alone */
  function judged(ok, inner, label){
    return '<div>'+
      '<div style="background:var(--ice);border:1.5px solid '+(ok?"var(--green)":"var(--red)")+';border-radius:var(--r-m);padding:20px;display:flex;align-items:center;justify-content:center;min-height:104px">'+inner+'</div>'+
      '<p class="caption" style="margin-top:8px;display:flex;gap:6px;align-items:flex-start">'+
        '<span style="color:'+(ok?"var(--green-ink)":"var(--red-ink)")+';flex-shrink:0">'+CG.ic(ok?"check":"x",13)+'</span>'+
        '<span><b style="color:'+(ok?"var(--green-ink)":"var(--red-ink)")+';font-family:var(--f-disp);letter-spacing:.04em">'+(ok?"DO":"DON’T")+'</b> · '+esc(label)+'</span></p></div>';
  }
  function swatch(hex, token, role){
    /* the card is --paper, so its text must be --ink (both flip together per theme). Without this the
       name inherits the sec-dark section's light colour and vanishes on the white card in light mode. */
    return '<div style="border:1.5px solid var(--line);border-radius:var(--r-s);overflow:hidden;background:var(--paper);color:var(--ink)">'+
      '<div style="height:62px;background:'+hex+'"></div>'+
      '<div style="padding:9px 11px">'+
        '<b style="font-family:var(--f-disp);font-size:13px;display:block;letter-spacing:-.01em;color:var(--ink)">'+esc(token)+'</b>'+
        '<span class="caption mono" style="display:block;text-transform:uppercase">'+esc(hex)+'</span>'+
        '<span class="caption" style="display:block;margin-top:2px;line-height:1.4">'+esc(role)+'</span></div></div>';
  }
  function specimen(face, sample, note){
    return '<div class="card"><div class="card-b">'+
      '<div style="'+face+';color:var(--ink);overflow:hidden">'+sample+'</div>'+
      '<p class="caption" style="margin-top:12px;border-top:1px solid var(--line-soft);padding-top:10px">'+note+'</p></div></div>';
  }
  var chr = 'border-bottom:2px solid var(--chrome)';

  var h = '';

  /* ---- hero: the thesis is the mark ---- */
  h += '<section class="sec-dark" style="padding:clamp(40px,6vw,80px) 0">'+
    '<div class="shell"><div style="max-width:720px">'+
      '<span class="eyebrow chr">The Chel Gaming brand</span>'+
      '<div style="margin:22px 0 26px;display:flex;align-items:center;gap:18px;flex-wrap:wrap">'+mk("reversed",64)+wtext(true)+'</div>'+
      '<h1 class="h-page" style="color:#fff">One mark. One voice. One accent.</h1>'+
      '<p class="lede" style="color:var(--on-ink-dim);margin-top:14px;max-width:60ch">How the league looks and sounds — the logos, the colour, the type, and the handful of rules that keep every surface, from the site to the Discord to a printed sheet, unmistakably Chel Gaming.</p>'+
    '</div></div></section>';

  /* ---- logo ---- */
  h += '<section class="sec"><div class="shell">'+
    '<div class="sec-head"><div class="lead"><span class="eyebrow chr">The mark</span>'+
      '<h2 class="h-sec">A "C" for Chel, crossed by the "G"</h2>'+
      '<p class="lede">One shape carries both letters — a power mark that reads as a play button. Match the logo to its background: the crossbar is the point of the whole thing, and it disappears on the wrong surface.</p></div></div>'+
    '<div class="grid g3">'+
      logoCell("var(--bc)", mk("badge",64), "Primary badge", "The default. Dark and neutral surfaces — the masthead, the footer, the Discord avatar, the share card.", {href:"/chel-gaming-logo-1024.png"})+
      logoCell("var(--paper)", mk("light",64), "Light mark", "Transparent, ink C + gold crossbar. Any light background — a white page, print, a light email header.", {href:"/chel-gaming-logo-light-1024.png"})+
      logoCell("var(--ice)", mk("lighttile",64), "Light tile", "The badge form for light surfaces — avatars and app tiles that need a contained shape.", {href:"/chel-gaming-logo-light-tile-1024.png"})+
    '</div>'+
    '<div class="grid g2" style="margin-top:18px;align-items:stretch">'+
      logoCell("var(--bc)", wordmark(true,44), "Wordmark lockup", "The mark with the name. Headers, credits, anywhere the two appear together. On dark, the mark reverses to a light C.", {wm:true, dark:true})+
      logoCell("var(--paper)", '<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;justify-content:center">'+mk("light",44)+wtext(false)+'</div>', "On light", "The same lockup on paper — ink wordmark, gold crossbar. Clear space stays equal to the mark's corner radius.", {wm:true, dark:false})+
    '</div>'+
    '<p class="caption" style="margin-top:12px;display:flex;gap:6px;align-items:center">'+CG.ic("dl",13)+'Click any logo above to download its PNG.</p>'+

    '<h3 class="h-card" style="margin:34px 0 4px">Clear space &amp; minimum size</h3>'+
    '<p class="lede" style="margin-bottom:16px">Keep free space around the mark equal to at least the tile’s corner radius. Below 24px the crossbar closes up — that’s the floor for a favicon; 20px in dense UI.</p>'+
    '<div class="card"><div class="card-b" style="display:flex;gap:32px;align-items:flex-end;flex-wrap:wrap;background:var(--ice)">'+
      ["16","20","24","36","48"].map(function(px){ return '<div style="text-align:center"><div style="padding:10px">'+mk("light",+px)+'</div><span class="caption mono">'+px+'px</span></div>'; }).join("")+
    '</div></div>'+

    '<h3 class="h-card" style="margin:34px 0 14px">Correct &amp; incorrect</h3>'+
    '<div class="grid g4">'+
      judged(true, mk("badge",56), "Badge on a dark or neutral surface")+
      judged(true, mk("light",56), "Light mark on a light surface")+
      judged(false, '<svg width="56" height="56" viewBox="0 0 48 48"><rect width="48" height="48" rx="11" fill="#0a0a0a"/><path d="M35.5 17.4 A13 13 0 1 0 35.5 30.6" fill="none" stroke="#8b5cf6" stroke-width="3.4" stroke-linecap="round"/><path d="M35 24 H28" fill="none" stroke="#a855f7" stroke-width="3.4" stroke-linecap="round"/></svg>', "Recolour the mark off-palette")+
      judged(false, '<svg width="86" height="52" viewBox="0 0 48 48" preserveAspectRatio="none"><rect width="48" height="48" rx="11" fill="#0a0a0a"/><path d="M35.5 17.4 A13 13 0 1 0 35.5 30.6" fill="none" stroke="#f4f4f0" stroke-width="3.4" stroke-linecap="round"/><path d="M35 24 H28" fill="none" stroke="#ffe500" stroke-width="3.4" stroke-linecap="round"/></svg>', "Stretch or squash it")+
    '</div>'+
    '<div class="grid g4" style="margin-top:16px">'+
      judged(false, '<svg width="56" height="56" viewBox="0 0 48 48"><path d="M35.5 17.4 A13 13 0 1 0 35.5 30.6" fill="none" stroke="#101519" stroke-width="3.4" stroke-linecap="round"/><path d="M35 24 H28" fill="none" stroke="#ffe500" stroke-width="3.4" stroke-linecap="round"/></svg>', "Chrome crossbar on white — it vanishes")+
      judged(false, '<svg width="56" height="56" viewBox="-4 -4 56 56"><defs><filter id="bg1" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="0" stdDeviation="3" flood-color="#ffe500" flood-opacity="0.9"/></filter></defs><g filter="url(#bg1)"><rect width="48" height="48" rx="11" fill="#0a0a0a"/><path d="M35.5 17.4 A13 13 0 1 0 35.5 30.6" fill="none" stroke="#f4f4f0" stroke-width="3.4" stroke-linecap="round"/><path d="M35 24 H28" fill="none" stroke="#ffe500" stroke-width="3.4" stroke-linecap="round"/></g></svg>', "Add a glow, shadow, or outline")+
      judged(false, '<svg width="56" height="56" viewBox="0 0 48 48" style="transform:rotate(-16deg)"><rect width="48" height="48" rx="11" fill="#0a0a0a"/><path d="M35.5 17.4 A13 13 0 1 0 35.5 30.6" fill="none" stroke="#f4f4f0" stroke-width="3.4" stroke-linecap="round"/><path d="M35 24 H28" fill="none" stroke="#ffe500" stroke-width="3.4" stroke-linecap="round"/></svg>', "Rotate or tilt it")+
      judged(false, mk("badge",56), '')+  /* placeholder replaced below */
    '</div>'+
  '</div></section>';
  /* the 8th judged cell reads "badge on a busy photo" — swap its inner for a photo-ish ground */
  h = h.replace(judged(false, mk("badge",56), ''),
    '<div><div style="background:linear-gradient(135deg,#3a4a58,#6b7b6b 40%,#9aa88f);border:1.5px solid var(--red);border-radius:var(--r-m);padding:20px;display:flex;align-items:center;justify-content:center;min-height:104px">'+mk("badge",56)+'</div>'+
    '<p class="caption" style="margin-top:8px;display:flex;gap:6px;align-items:flex-start"><span style="color:var(--red-ink);flex-shrink:0">'+CG.ic("x",13)+'</span><span><b style="color:var(--red-ink);font-family:var(--f-disp);letter-spacing:.04em">DON’T</b> · Place it on a busy or low-contrast image</span></p></div>');

  /* ---- colour ---- */
  h += '<section class="sec-dark"><div class="shell">'+
    '<div class="sec-head"><div class="lead"><span class="eyebrow chr">Colour</span>'+
      '<h2 class="h-sec">A quiet base, one loud accent</h2>'+
      '<p class="lede" style="color:var(--on-ink-dim)">Confident neutrals do the work; chrome yellow is a spotlight used once per view. Semantic colour means status — never decoration.</p></div></div></div>'+
    '<div class="shell">'+
    /* every swatch sits under the heading it actually belongs to — surfaces and structure are
       Neutrals, the accent trio stands alone, and Semantic holds only status colours. Grouping had
       to be honest here of all places: the section's own lede promises "status — never decoration". */
    '<p class="eyebrow" style="margin-bottom:12px;color:var(--on-ink)">Neutrals &amp; surfaces</p>'+
    '<div class="grid g4">'+
      swatch("#101519","Ink","Primary text & marks")+
      swatch("#5C6B75","Steel","Secondary text, captions")+
      swatch("#E3E6DF","Line","Borders, hairlines")+
      swatch("#F5F6F2","Ice","Page ground")+
      swatch("#FFFFFF","Paper","Cards, raised surfaces")+
      swatch("#101519","Broadcast","The dark bands, ticker, hero — constant in both themes")+
    '</div>'+
    '<p class="eyebrow" style="margin:26px 0 12px;color:var(--on-ink)">Accent — one per view</p>'+
    '<div class="grid g4">'+
      swatch("#FFE500","Chrome","The accent — CTA, eyebrow tick, live pulse")+
      swatch("#E5C900","Chrome deep","Chrome that needs more weight")+
      swatch("#D9A800","Gold","The accent, deepened to hold on white")+
    '</div>'+
    '<p class="eyebrow" style="margin:26px 0 12px;color:var(--on-ink)">Semantic — status only</p>'+
    '<div class="grid g4">'+
      swatch("#1F9D58","Green","Win, live, positive")+
      swatch("#C63A32","Red","Loss, danger, destructive")+
      swatch("#8A6D00","Amber ink","Warning, needs attention")+
    '</div>'+
    '<div class="note chr" style="margin-top:24px;background:var(--bc2);color:var(--on-ink);border-color:var(--chrome)">'+
      '<b style="font-family:var(--f-disp);display:block;margin-bottom:4px;color:#fff">The fill-vs-ink rule</b>'+
      'Red and green are <b>fills</b> — light text sits on them, so they stay dark in both themes. The <span class="mono">--*-ink</span> values are the <b>text</b> colours and flip per theme. Never use a fill as a foreground; it can’t clear 4.5:1 on both a light and dark surface at once. Contrast floor is WCAG AA, enforced.'+
    '</div>'+
    '</div></section>';

  /* ---- typography ---- */
  h += '<section class="sec"><div class="shell">'+
    '<div class="sec-head"><div class="lead"><span class="eyebrow chr">Typography</span>'+
      '<h2 class="h-sec">Three faces, each with a job</h2>'+
      '<p class="lede">A display face for confidence, a body face for reading, a mono face for anything that’s a number. Numbers always use tabular figures so columns line up.</p></div></div>'+
    '<div class="grid g3">'+
      specimen("font-family:var(--f-disp);font-weight:900;font-size:44px;letter-spacing:-.03em;line-height:.98", "Puck drop.", "<b>Archivo</b> · display / headings · 400–900 · tight tracking, balanced wrap")+
      specimen("font-family:var(--f-body);font-size:15.5px;line-height:1.6;color:var(--ink-3)", "Eight clubs across two divisions play a full season — live standings, imported box scores, trades, and a playoff bracket.", "<b>IBM Plex Sans</b> · body · 400 / 500 / 600 · line-height ~1.6")+
      specimen("font-family:var(--f-mono);font-size:15px;font-variant-numeric:tabular-nums;line-height:1.7;color:var(--ink)", "2‑1‑0 · W2<br>.932 SV%<br>21:34 TOI · #97", "<b>IBM Plex Mono</b> · data & labels · tabular figures for every stat")+
    '</div>'+

    '<div class="grid g2" style="margin-top:18px;align-items:start">'+
      '<div class="card"><div class="card-h"><h3>The scale</h3></div><div class="card-b" style="display:grid;gap:14px">'+
        [["h-page","Page title","font-family:var(--f-disp);font-weight:800;font-size:32px;letter-spacing:-.025em"],
         ["h-sec","Section heading","font-family:var(--f-disp);font-weight:800;font-size:23px"],
         ["h-card","Card title","font-family:var(--f-disp);font-weight:700;font-size:16.5px"],
         ["lede","Standfirst","font-size:16px;color:var(--steel)"],
         ["body","Running text","font-size:15px"],
         ["caption","Metadata","font-size:12px;color:var(--steel)"],
         ["eyebrow","Kicker","font-family:var(--f-mono);font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:var(--steel)"]
        ].map(function(r){ return '<div style="display:flex;justify-content:space-between;gap:16px;align-items:baseline;border-bottom:1px solid var(--line-soft);padding-bottom:12px"><span style="'+r[2]+'">'+esc(r[1])+'</span><span class="caption mono" style="flex-shrink:0">.'+r[0]+'</span></div>'; }).join("")+
      '</div></div>'+
      '<div class="card"><div class="card-h"><h3>The eyebrow tick</h3></div><div class="card-b">'+
        '<span class="eyebrow chr">Standings</span>'+
        '<p class="lede" style="margin-top:12px">The signature device — a small chrome bar before a kicker, like a broadcast lower-third. It opens a titled section. Use it to lead; don’t scatter it.</p>'+
        '<div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--line-soft)"><span class="eyebrow chr">The race, division by division</span></div>'+
      '</div></div>'+
    '</div>'+
  '</div></section>';

  /* ---- voice ---- */
  h += '<section class="sec-dark"><div class="shell">'+
    '<div class="sec-head"><div class="lead"><span class="eyebrow chr">Voice</span>'+
      '<h2 class="h-sec">Broadcast-grade, player-run</h2>'+
      '<p class="lede" style="color:var(--on-ink-dim)">Write from the reader’s side of the screen. Plain and specific, active voice, real numbers. A control says exactly what it does; an error says how to fix it.</p></div></div></div>'+
    '<div class="shell"><div class="grid g2">'+
      [["“Unlock your competitive journey today!”","“Register to play — sign-ups close the Monday before the draft.”"],
       ["“An error occurred.”","“Couldn’t save — your sign-in expired. Sign out and back in, then retry.”"],
       ["“96 players and counting 🔥”","“Eight clubs. Rosters fill through the draft.”"],
       ["“Admin backend”","“Control Center” · “the league office”"]
      ].map(function(p){ return '<div class="card" style="background:var(--bc2);border-color:#2A343B"><div class="card-b" style="display:grid;gap:12px">'+
        '<div style="display:flex;gap:9px;align-items:flex-start"><span style="color:var(--red-ink);flex-shrink:0">'+CG.ic("x",14)+'</span><span class="small" style="color:var(--on-ink-dim)">'+esc(p[0])+'</span></div>'+
        '<div style="display:flex;gap:9px;align-items:flex-start;border-top:1px solid #2A343B;padding-top:12px"><span style="color:#4FC486;flex-shrink:0">'+CG.ic("check",14)+'</span><span class="small" style="color:#fff">'+esc(p[1])+'</span></div>'+
      '</div></div>'; }).join("")+
    '</div></div></section>';

  /* ---- UI language ---- */
  h += '<section class="sec"><div class="shell">'+
    '<div class="sec-head"><div class="lead"><span class="eyebrow chr">UI language</span>'+
      '<h2 class="h-sec">Components with fixed meaning</h2>'+
      '<p class="lede">A member learns the system once. A chrome button is the one primary action; a chip states a fact; a card is a thing you can open.</p></div></div>'+
    '<div class="grid g2" style="align-items:start">'+
      '<div class="card"><div class="card-h"><h3>Buttons</h3></div><div class="card-b" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">'+
        '<button class="btn btn-chrome" type="button">Register to play</button>'+
        '<button class="btn btn-ink" type="button">Open the queue</button>'+
        '<button class="btn btn-ghost" type="button">Cancel</button>'+
        '<p class="caption" style="width:100%;margin-top:4px">Chrome = the one primary action, at most once per view. Ink = strong secondary. Ghost = low-stakes.</p>'+
      '</div></div>'+
      '<div class="card"><div class="card-h"><h3>Chips</h3></div><div class="card-b" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">'+
        '<span class="chip chip-chrome">Marquee</span>'+
        '<span class="chip chip-win">Win</span>'+
        '<span class="chip chip-loss">Loss</span>'+
        '<span class="chip chip-warn">Needs attention</span>'+
        '<span class="chip">Open</span>'+
        '<p class="caption" style="width:100%;margin-top:4px">A chip states a fact — outcome, status, a label. It is never a button.</p>'+
      '</div></div>'+
    '</div>'+
  '</div></section>';

  /* ---- downloads ---- */
  h += '<section class="sec-dark"><div class="shell">'+
    '<div class="sec-head"><div class="lead"><span class="eyebrow chr">Assets</span>'+
      '<h2 class="h-sec">Grab the logos</h2>'+
      '<p class="lede" style="color:var(--on-ink-dim)">Everything served straight from the site. Match the file to the background, and don’t alter it.</p></div></div></div>'+
    '<div class="shell"><div class="grid g3">'+
      [["Dark badge","/chel-gaming-logo-1024.png","PNG · 1024 · for dark & neutral"],
       ["Light mark","/logo-light.svg","SVG · transparent · for light"],
       ["Light mark","/chel-gaming-logo-light-1024.png","PNG · 1024 · transparent"],
       ["Light tile","/chel-gaming-logo-light-tile-1024.png","PNG · 1024 · white tile"],
       ["Favicon","/favicon.svg","SVG · the badge at 48px"],
       ["Share card","/og.png","PNG · 1200×630 · social preview"]
      ].map(function(a){ return '<a class="card raise" href="'+a[1]+'" download rel="noopener" style="display:block;text-decoration:none;background:var(--bc2);border-color:#2A343B">'+
        '<div class="card-b" style="display:flex;align-items:center;gap:12px">'+CG.ic("dl",16)+
        '<span><b style="font-family:var(--f-disp);color:#fff;display:block">'+esc(a[0])+'</b><span class="caption mono" style="color:var(--on-ink-dim)">'+esc(a[2])+'</span></span></div></a>'; }).join("")+
    '</div>'+
    '<p class="caption" style="margin-top:22px;color:var(--on-ink-dim)">Not affiliated with EA Sports, the NHL, Discord, or Twitch. Club names and marks belong to their owners.</p>'+
    '</div></section>';

  return h;
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
  var head = CG.pageHead("Run a club","Apply to own a club",
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
    '<p class="caption" style="margin-top:14px">Looking to run a club instead? <a href="#/owner" style="font-weight:700;border-bottom:2px solid var(--chrome)">Apply to own a club →</a></p>'+
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
  /* same season key as the desk + manager, so future-season trade picks can't hijack the room */
  var maxSn = (lg.draftState && lg.draftState.season_number) || (CG.SEASON && CG.SEASON.number) || 1;
  var cur = picks.filter(function(p){ return p.season===maxSn; }).sort(function(a,b){ return (a.overall||9999)-(b.overall||9999); });
  if (!cur.length) return head + '<div class="shell" style="max-width:640px;padding-bottom:48px"><div class="card"><div class="empty" style="padding:60px 20px">'+
    '<div class="e-art">'+CG.ic("users",22)+'</div><b>No draft board for this season yet</b><p>When the commissioner builds the board, the picks, prospect pool, and live results appear here.</p></div></div></div>';
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
CG._draftSeason = function(){ return (CG.lg.draftState && CG.lg.draftState.season_number) || (CG.SEASON && CG.SEASON.number) || 1; };
CG.refreshDraft = function(){ if(!CG.sb) return; CG.loadManagerData().then(function(){
  if(location.hash.indexOf("/draft")>=0){ if(CG.rerenderKeepScroll) CG.rerenderKeepScroll(); else CG.router(); }
}); };
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

/* ================================================================
   DRAFT DESK (Team HQ) + DRAFT MANAGER (Control Center)
   One engine, two rooms: clubs run their board and their picks from
   Team HQ; the commissioner generates the order and runs the night
   from the Control Center. Both update live over the draft channel.
   ================================================================ */
CG.DRAFT_STYLES = [
  ["reverse_standings","Reverse pre-season standings","Worst pre-season record picks first — the classic worst-to-first order, computed from the standings."],
  ["lottery","Weighted lottery","Every club can win pick one, but the worst record holds the most tickets (8·7·6…1). The drawn order is published."],
  ["random","Pure random","A straight shuffle — every club has equal odds at every slot."],
  ["manual","Manual order","You arrange the clubs yourself; the board builds from your order."]
];
CG.fmtClockS = function(s){ s = Math.max(0, s|0); return Math.floor(s/60)+":"+String(s%60).padStart(2,"0"); };
CG.draftPicksCur = function(){
  /* always the CURRENT season's board — same key the commissioner controls use */
  var st = CG.lg.draftState;
  var sn = st ? st.season_number : ((CG.SEASON && CG.SEASON.number) || 1);
  return (CG.lg.draftPicks||[]).filter(function(p){ return p.season===sn; });
};
CG.draftCurPick = function(){
  var st = CG.lg.draftState; if (!st) return null;
  return CG.draftPicksCur().find(function(p){ return p.overall===st.current_overall && !p.used && !p.skipped; }) || null;
};
CG.eligOf = function(pid){
  var vet = CG.lg.isVeteran && CG.lg.isVeteran(pid);
  var gp = ((CG.lg.preGp||{})[pid]||{}).gp||0;
  return { vet:vet, gp:gp, ok: vet || gp>=5 };
};
CG.eligChipD = function(pid){
  var e = CG.eligOf(pid);
  if (e.vet) return '<span class="chip" style="font-size:9px">VETERAN</span>';
  return e.ok ? '<span class="chip chip-win" style="font-size:9px">ELIGIBLE</span>'
              : '<span class="chip chip-warn" style="font-size:9px">'+e.gp+' OF 5</span>';
};
CG.draftPlayerFate = function(pid){
  /* where did this player end up? for striking drafted players off boards live */
  var p = CG.playerById(CG.lg, pid);
  if (p) return { taken:true, code:p.team };
  return { taken: !!(CG.lg._rosteredIds||{})[pid], code:null };
};
CG.draftStatusChip = function(st, hasPicks){
  var s = st ? st.status : null;
  if (!hasPicks) return '<span class="chip">No board yet</span>';
  if (s==="live") return '<span class="chip chip-live"><span class="live-dot"></span>LIVE</span>';
  if (s==="paused") return '<span class="chip chip-warn">Paused</span>';
  if (s==="complete") return '<span class="chip chip-win">Complete</span>';
  return '<span class="chip chip-chrome">Board set — not started</span>';
};
/* one self-stopping clock for whichever draft page is open; fires the server
   auto-advance (guarded, idempotent) if the clock dies while we're watching */
CG._armDraftTick = function(){
  var el = document.getElementById("drTick"); if (!el) return;
  clearInterval(CG._drIv);
  var tick = function(){
    var e = document.getElementById("drTick");
    if (!e){ clearInterval(CG._drIv); return; }
    var st = CG.lg.draftState || {};
    if (st.status==="paused"){ e.textContent = CG.fmtClockS(st.paused_remaining==null?(st.pick_seconds||0):st.paused_remaining); return; }
    if (st.status!=="live" || !st.clock_ends_at){ e.textContent = "–:––"; return; }
    var ms = Date.parse(st.clock_ends_at) - Date.now();
    if (ms <= 0){
      e.textContent = "0:00";
      if (!CG._drFired || Date.now()-CG._drFired > 15000){
        CG._drFired = Date.now();
        CG.sb.rpc("draft_auto_advance",{ p_season_number: st.season_number }).then(function(){});
      }
      return;
    }
    e.textContent = CG.fmtClockS(Math.ceil(ms/1000));
  };
  CG._drIv = setInterval(tick, 500); tick();
};
/* the board write: one atomic save; on failure re-sync from the database */
CG.saveMyBoard = function(ids){
  var t = CG.myManagedTeam(); if (!t || !CG.sb) return;
  CG.lg._myBoard = ids.slice();
  CG.rerenderKeepScroll();  /* optimistic */
  CG.sb.rpc("save_draft_board",{ p_team: t.id, p_players: ids }).then(function(r){
    if (r.error){
      CG.toast("The board didn’t save: "+r.error.message, "err");
      CG.loadManagerData().then(function(){ CG.rerenderKeepScroll(); });
    }
  });
};
/* re-render without the jump-to-top — board edits and realtime pick updates keep your place */
CG.rerenderKeepScroll = function(){
  var y = window.scrollY;
  CG.router();
  window.scrollTo({ top: y, left: 0, behavior: "instant" });
};
/* shared pick modal: search the pool, eligible players first, one click to draft */
CG.draftPickModalLive = function(pickId, forCode){
  var pool = (CG.lg.draftPool||[]).slice().sort(function(a,b){
    var ea = CG.eligOf(a.profileId).ok?1:0, eb = CG.eligOf(b.profileId).ok?1:0;
    if (ea!==eb) return eb-ea;
    return (b.ovr==null?-1:b.ovr)-(a.ovr==null?-1:a.ovr);
  });
  function rows(q){
    q = (q||"").toLowerCase();
    var matches = pool.filter(function(p){ return !q || p.tag.toLowerCase().indexOf(q)>=0; });
    var list = matches.slice(0,30);
    if (!list.length) return '<p class="caption" style="padding:14px 0">No available players match.</p>';
    var more = matches.length>30 ? '<p class="caption" style="padding:8px 0">Showing 30 of '+matches.length+' — refine the search.</p>' : '';
    return more + list.map(function(p){
      var e = CG.eligOf(p.profileId);
      return '<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid var(--line-soft)">'+
        '<b style="font-size:14px;min-width:0;overflow:hidden;text-overflow:ellipsis">'+esc(p.tag)+'</b>'+
        '<span class="mono" style="font-size:10px;color:var(--steel)">'+esc(p.pos||"?")+'</span>'+CG.eligChipD(p.profileId)+
        '<button class="btn '+(e.ok?"btn-chrome":"btn-ghost")+' btn-sm" style="margin-left:auto" data-modpick="'+p.profileId+'" data-name="'+esc(p.tag)+'"'+(e.ok?"":" disabled title=\"Needs five pre-season games\"")+'>Draft</button></div>';
    }).join("");
  }
  CG.modal("Draft a player"+(forCode?" — "+esc(forCode):""),
    '<label class="fld"><span>Search the pool</span><input id="modPickQ" placeholder="Start typing a gamertag…"></label>'+
    '<div id="modPickList" style="max-height:320px;overflow:auto">'+rows("")+'</div>'+
    '<p class="caption" style="margin-top:10px">Greyed players haven’t hit five pre-season games — they’re placed on clubs automatically after the draft.</p>',
    '<button class="btn btn-ghost" data-close>Cancel</button>');
  function wire(){
    document.querySelectorAll("[data-modpick]").forEach(function(b){ b.addEventListener("click", function(){
      var pid=this.getAttribute("data-modpick"), nm=this.getAttribute("data-name"), btn=this;
      btn.disabled=true; btn.textContent="Drafting…";
      CG.sb.rpc("draft_make_pick",{ p_pick:pickId, p_player:pid }).then(function(r){
        if(r.error){ CG.toast(r.error.message,"err"); btn.disabled=false; btn.textContent="Draft"; return; }
        if(CG.closeOverlay) CG.closeOverlay();
        CG.toast(nm+" drafted","ok"); CG.refreshDraft();
      });
    }); });
  }
  wire();
  var q=document.getElementById("modPickQ");
  if(q) q.addEventListener("input", function(){ document.getElementById("modPickList").innerHTML = rows(this.value); wire(); });
};

/* ---------------- Team HQ · Draft desk ---------------- */
CG.hubDraftLive = function(){
  var lg = CG.lg, st = lg.draftState, t = CG.myManagedTeam();
  if (!t) return '<div class="note">The draft desk belongs to club management — owners, GMs, and AGMs.</div>';
  var myCode = t.code;
  var picks = CG.draftPicksCur();
  var hasPicks = picks.length>0;
  var pool = lg.draftPool||[], board = (lg._myBoard||[]).slice();
  var cur = CG.draftCurPick();
  var live = st && (st.status==="live"||st.status==="paused");
  var myTurn = !!(cur && cur.ownerCode===myCode && st.status==="live");
  var myPicks = picks.filter(function(p){ return p.ownerCode===myCode; });
  var nextMine = myPicks.filter(function(p){ return !p.used && !p.skipped; }).sort(function(a,b){ return a.overall-b.overall; })[0];
  var mySkipped = myPicks.filter(function(p){ return p.skipped && !p.used; });
  var picksUntil = (nextMine && cur) ? picks.filter(function(p){ return !p.used && !p.skipped && p.overall>=cur.overall && p.overall<nextMine.overall; }).length : null;
  var unlocked = pool.length>0 || (CG.SEASON && CG.SEASON.preseason_starts_at && Date.parse(CG.SEASON.preseason_starts_at)<=CG.now());
  var draftAt = CG.SEASON && CG.SEASON.draft_at ? Date.parse(CG.SEASON.draft_at) : null;

  var h = '<div style="margin-bottom:20px"><span class="eyebrow chr">'+esc(t.name)+' · the war room</span>'+
    '<h1 class="h-sec" style="margin-top:8px">Draft desk</h1>'+
    '<p class="lede" style="margin-top:8px">Build your board before the night, then let it work for you: if your clock ever runs out, the league drafts the best available player <b>from your board</b> automatically.</p></div>';

  /* status strip */
  h += '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:18px">'+
    '<div class="kpi" style="cursor:default"><b class="num" style="font-size:17px">'+CG.draftStatusChip(st, hasPicks)+'</b><span>draft status</span></div>'+
    '<div class="kpi" style="cursor:default"><b class="num dr-clock" id="drTick">–:––</b><span>pick clock</span></div>'+
    '<div class="kpi'+(myTurn?" alert":"")+'" style="cursor:default"><b class="num" style="font-size:17px">'+(cur?'<span class="teamcell">'+CG.crest(cur.ownerCode,22)+'<span>'+esc(cur.ownerCode)+' · R'+cur.round+' #'+cur.overall+'</span></span>':"—")+'</b><span>on the clock</span></div>'+
    '<div class="kpi" style="cursor:default"><b class="num" style="font-size:17px">'+(nextMine?('#'+nextMine.overall+' · R'+nextMine.round+(picksUntil!=null?(picksUntil===0?' — now':' — in '+picksUntil+' pick'+(picksUntil===1?'':'s')):'')):(hasPicks?'none left':'—'))+'</b><span>your next pick</span></div>'+
    '<div class="kpi" style="cursor:default"><b class="num">'+board.length+'</b><span>players on your board</span></div></div>';

  if (!hasPicks){
    h += '<div class="note chr" style="margin-bottom:18px"><b style="font-family:var(--f-disp)">The board isn’t built yet.</b> '+
      (draftAt?'Draft night is '+CG.fmtFull(draftAt)+'. ':'')+
      'The commissioner generates the pick order before the night — your job until then is the board below.</div>';
  }

  /* ON THE CLOCK — the moment that matters */
  if (myTurn){
    var topAvail = null;
    for (var bi=0; bi<board.length; bi++){
      var fate = CG.draftPlayerFate(board[bi]);
      if (!fate.taken && CG.eligOf(board[bi]).ok){ topAvail = board[bi]; break; }
    }
    var tp = topAvail ? (pool.find(function(p){ return p.profileId===topAvail; })||{tag:"your top target"}) : null;
    h += '<div class="card" style="margin-bottom:18px;border-color:var(--chrome);border-width:2px"><div class="card-b" style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;background:var(--chrome-tint)">'+
      '<b style="font-family:var(--f-disp);font-size:19px">You’re on the clock.</b>'+
      '<span class="caption">Round '+cur.round+' · pick '+cur.overall+' overall</span>'+
      '<span style="margin-left:auto;display:inline-flex;gap:9px;flex-wrap:wrap">'+
      (tp?'<button class="btn btn-chrome" data-quickpick="'+topAvail+'" data-pick="'+cur.id+'" data-name="'+esc(tp.tag)+'">'+CG.ic("check",15)+'Draft '+esc(tp.tag)+' (board #1)</button>':"")+
      '<button class="btn '+(tp?"btn-ghost":"btn-chrome")+'" data-openpick="'+cur.id+'">Choose from the pool</button></span></div></div>';
  }

  /* make-up picks (skipped but recoverable) */
  if (mySkipped.length && live){
    h += '<div class="card" style="margin-bottom:18px"><div class="card-h"><h3>Make-up picks</h3><span class="chip chip-warn">'+mySkipped.length+' waiting</span></div>'+
      mySkipped.map(function(p){
        return '<div class="card-b" style="display:flex;gap:12px;align-items:center;border-top:1px solid var(--line-soft)"><span class="mono" style="font-size:12px">R'+p.round+' · #'+p.overall+' overall</span>'+
          '<span class="caption" style="flex:1">Your clock ran out on this one — it’s still yours. Use it any time before the draft ends.</span>'+
          '<button class="btn btn-chrome btn-sm" data-openpick="'+p.id+'">Use this pick</button></div>';
      }).join("")+'</div>';
  }

  /* MY BOARD */
  if (!unlocked){
    h += '<div class="card" style="margin-bottom:18px"><div class="card-h"><h3>My draft board</h3><span class="chip">locked</span></div>'+
      '<div class="card-b"><div class="empty" style="padding:40px 20px"><div class="e-art">'+CG.ic("lock",22)+'</div><b>Boards unlock with the pre-season</b>'+
      '<p>Once pre-season opens'+(CG.SEASON&&CG.SEASON.preseason_starts_at?' ('+CG.fmtDay(Date.parse(CG.SEASON.preseason_starts_at))+')':'')+' the registered player pool appears here — watch the games, rank your targets, and your board is ready for draft night.</p></div></div></div>';
  } else {
    var boarded = {}; board.forEach(function(pid){ boarded[pid]=true; });
    h += '<div class="card" style="margin-bottom:18px"><div class="card-h"><h3>My draft board</h3><span class="chip chip-chrome">private to your club</span></div>';
    h += board.length ? '<div class="tblwrap"><table class="tbl keepcols"><caption>Your ranked targets</caption>'+
      '<thead><tr><th>#</th><th class="tleft">Player</th><th>Pos</th><th>Pre-season</th><th>Eligibility</th><th class="tleft">Status</th><th class="tright">Order</th></tr></thead><tbody>'+
      board.map(function(pid, i){
        var p = pool.find(function(x){ return x.profileId===pid; });
        var fate = CG.draftPlayerFate(pid);
        var name = p ? p.tag : ((lg._profName||{})[pid]||"a player");
        var pos = p ? p.pos : "—";
        var pre = (lg.preGp||{})[pid]||{gp:0,g:0,a:0};
        var status = fate.taken
          ? (fate.code===myCode ? '<span class="chip chip-win" style="font-size:9px">ON YOUR CLUB</span>'
                                : '<span class="chip chip-loss" style="font-size:9px">GONE · '+esc(fate.code||"signed")+'</span>')
          : '<span class="chip" style="font-size:9px">AVAILABLE</span>';
        return '<tr'+(fate.taken?' style="opacity:.55"':'')+'><td class="num">'+(i+1)+'</td>'+
          '<td class="tleft"><b'+(fate.taken&&fate.code!==myCode?' style="text-decoration:line-through"':'')+'>'+esc(name)+'</b></td>'+
          '<td class="mono" style="font-size:11px">'+esc(pos||"—")+'</td>'+
          '<td class="mono" style="font-size:11px">'+pre.gp+'gp '+pre.g+'g '+pre.a+'a</td>'+
          '<td>'+CG.eligChipD(pid)+'</td><td class="tleft">'+status+'</td>'+
          '<td class="tright"><span style="display:inline-flex;gap:4px">'+
            '<button class="btn btn-ghost btn-sm" data-b-top="'+pid+'" title="Move to #1" aria-label="Move '+esc(name)+' to the top"'+(i===0?" disabled":"")+'>'+CG.ic("up",12)+CG.ic("up",12)+'</button>'+
            '<button class="btn btn-ghost btn-sm" data-b-up="'+pid+'" title="Move up" aria-label="Move '+esc(name)+' up"'+(i===0?" disabled":"")+'>'+CG.ic("up",12)+'</button>'+
            '<button class="btn btn-ghost btn-sm" data-b-dn="'+pid+'" title="Move down" aria-label="Move '+esc(name)+' down"'+(i===board.length-1?" disabled":"")+'>'+CG.ic("down",12)+'</button>'+
            '<button class="btn btn-ghost btn-sm" data-b-rm="'+pid+'" title="Remove" aria-label="Remove '+esc(name)+'">'+CG.ic("x",12)+'</button></span></td></tr>';
      }).join("")+'</tbody></table></div>'
      : '<div class="card-b"><div class="empty" style="padding:34px 20px"><div class="e-art">'+CG.ic("grid",20)+'</div><b>Your board is empty</b><p>Rank the players you want below. On draft night, one click drafts your top available target — and if your clock ever expires, the league auto-drafts from this exact list.</p></div></div>';
    /* add players — search + filter survive re-renders (realtime redraws mid-draft) */
    CG._bdUI = CG._bdUI || { q:"", pos:"ALL" };
    h += '<div class="card-b" style="border-top:1px solid var(--line)">'+
      '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:10px">'+
      '<input id="bdSearch" placeholder="Search the pool…" value="'+esc(CG._bdUI.q)+'" style="flex:1;min-width:180px">'+
      '<span style="display:inline-flex;gap:6px" role="group" aria-label="Position filter">'+["ALL","C","LW","RW","LD","RD","G"].map(function(px){
        var on = px===CG._bdUI.pos;
        return '<button type="button" class="chip'+(on?" chip-chrome":"")+'" data-bd-pos="'+px+'" aria-pressed="'+on+'" style="cursor:pointer">'+px+'</button>';
      }).join("")+'</span></div>'+
      '<div id="bdPoolList">'+CG._bdPoolRows(pool, boarded, CG._bdUI.q, CG._bdUI.pos)+'</div></div>';
    h += '</div>';
  }

  /* LIVE DRAFT TABLE */
  if (hasPicks){
    var rounds = {};
    picks.forEach(function(p){ (rounds[p.round]=rounds[p.round]||[]).push(p); });
    h += '<div class="card" style="margin-bottom:18px"><div class="card-h"><h3>The draft, pick by pick</h3>'+
      (st&&st.order_meta?'<span class="chip">'+esc((CG.DRAFT_STYLES.find(function(s){return s[0]===st.order_meta.style;})||["","order set"])[1])+'</span>':"")+'</div>'+
      '<div class="tblwrap"><table class="tbl keepcols"><caption>Every pick, live</caption>'+
      '<thead><tr><th>Pick</th><th class="tleft">Club</th><th class="tleft">Selection</th><th class="tleft">Status</th></tr></thead><tbody>'+
      Object.keys(rounds).sort(function(a,b){return a-b;}).map(function(rn){
        return '<tr><td colspan="4" style="background:var(--ice);font-family:var(--f-mono);font-size:10px;letter-spacing:.14em;padding:7px 12px">ROUND '+rn+'</td></tr>'+
          rounds[rn].sort(function(a,b){ return a.overall-b.overall; }).map(function(p){
            var isCur = cur && p.id===cur.id;
            var mine = p.ownerCode===myCode;
            return '<tr class="'+(isCur?"dr-now":"")+'"'+(mine&&!isCur?' style="background:var(--chrome-tint)"':'')+'>'+
              '<td class="num">'+p.overall+'</td>'+
              '<td class="tleft"><span class="teamcell">'+CG.crest(p.ownerCode,20)+'<span class="mono" style="font-size:12px">'+esc(p.ownerCode||"?")+(mine?' <b style="font-size:10px;color:var(--steel)">YOU</b>':'')+'</span></span></td>'+
              '<td class="tleft">'+(p.used?'<b>'+esc(p.playerName||"")+'</b>':'<span class="caption">—</span>')+'</td>'+
              '<td class="tleft">'+(isCur?'<span class="chip chip-live" style="font-size:9px"><span class="live-dot"></span>ON THE CLOCK</span>'
                : p.used?'<span class="chip chip-win" style="font-size:9px">PICKED</span>'
                : p.skipped?'<span class="chip chip-warn" style="font-size:9px">'+(mine?'MAKE-UP WAITING':'SKIPPED')+'</span>'
                :'<span class="caption mono" style="font-size:10px">upcoming</span>')+'</td></tr>';
          }).join("");
      }).join("")+'</tbody></table></div></div>';
  }

  /* how it works */
  h += '<div class="card"><div class="card-h"><h3>How draft night runs</h3></div><div class="card-b"><div class="grid g2" style="gap:14px">'+
    [["The clock","Each club gets "+((st&&st.pick_seconds)||120)+" seconds on the clock. Miss it and the league auto-drafts your top available board player — never a player you didn’t rank, unless your board runs dry."],
     ["Your board is private","Only your club’s management sees it. It updates live: drafted players get struck through the moment they’re taken."],
     ["Skipped picks aren’t lost","If a pick gets skipped, it stays yours — use it any time before the draft ends from the Make-up card."],
     ["Eligibility","First-year players need five pre-season games to be draftable. Everyone under that gets placed on a club automatically ten minutes after the final pick."]
    ].map(function(kv){ return '<div><b style="font-family:var(--f-disp);display:block;margin-bottom:4px">'+kv[0]+'</b><p class="small" style="color:var(--steel);line-height:1.6">'+kv[1]+'</p></div>'; }).join("")+
    '</div></div></div>';
  return h;
};
CG._bdPoolRows = function(pool, boarded, q, posF){
  q = (q||"").toLowerCase();
  var matches = pool.filter(function(p){
    if (boarded[p.profileId]) return false;
    if (q && p.tag.toLowerCase().indexOf(q)<0) return false;
    if (posF && posF!=="ALL" && p.pos!==posF) return false;
    return true;
  });
  var list = matches.slice(0, 14);
  if (!list.length) return '<p class="caption" style="padding:8px 0">'+(Object.keys(boarded).length?"Everyone matching is already on your board.":"No available players match.")+'</p>';
  var more = matches.length>14 ? '<p class="caption" style="padding:6px 0">Showing 14 of '+matches.length+' — search or filter to narrow it.</p>' : '';
  return more + list.map(function(p){
    var pre = (CG.lg.preGp||{})[p.profileId]||{gp:0,g:0,a:0};
    return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid var(--line-soft)">'+
      '<b style="font-size:13.5px">'+esc(p.tag)+'</b>'+
      '<span class="mono" style="font-size:10px;color:var(--steel)">'+esc(p.pos||"?")+' · '+pre.gp+'gp '+pre.g+'g '+pre.a+'a</span>'+
      CG.eligChipD(p.profileId)+
      '<button class="btn btn-ghost btn-sm" style="margin-left:auto" data-bd-add="'+p.profileId+'">'+CG.ic("plus",12)+'Add</button></div>';
  }).join("");
};
CG.AFTER._hubDraft = function(){
  CG.subscribeDraft(); CG._armDraftTick();
  var board = function(){ return (CG.lg._myBoard||[]).slice(); };
  function move(pid, delta){
    var b = board(), i = b.indexOf(pid); if (i<0) return;
    var j = delta==="top" ? 0 : i+delta;
    if (j<0 || j>=b.length) return;
    b.splice(i,1); b.splice(j,0,pid); CG.saveMyBoard(b);
  }
  document.querySelectorAll("[data-b-up]").forEach(function(b){ b.addEventListener("click", function(){ move(this.getAttribute("data-b-up"), -1); }); });
  document.querySelectorAll("[data-b-dn]").forEach(function(b){ b.addEventListener("click", function(){ move(this.getAttribute("data-b-dn"), 1); }); });
  document.querySelectorAll("[data-b-top]").forEach(function(b){ b.addEventListener("click", function(){ move(this.getAttribute("data-b-top"), "top"); }); });
  document.querySelectorAll("[data-b-rm]").forEach(function(b){ b.addEventListener("click", function(){
    var b2 = board().filter(function(x){ return x!==this.getAttribute("data-b-rm"); }.bind(this)); CG.saveMyBoard(b2);
  }); });
  var boarded = {}; board().forEach(function(pid){ boarded[pid]=true; });
  CG._bdUI = CG._bdUI || { q:"", pos:"ALL" };
  function rerenderPool(){
    var el = document.getElementById("bdPoolList");
    if (el){ el.innerHTML = CG._bdPoolRows(CG.lg.draftPool||[], boarded, CG._bdUI.q, CG._bdUI.pos); wireAdds(); }
  }
  function wireAdds(){
    document.querySelectorAll("[data-bd-add]").forEach(function(b){ b.addEventListener("click", function(){
      var b2 = board(); b2.push(this.getAttribute("data-bd-add")); CG.saveMyBoard(b2);
    }); });
  }
  var s = document.getElementById("bdSearch");
  if (s) s.addEventListener("input", function(){ CG._bdUI.q = this.value; rerenderPool(); });
  document.querySelectorAll("[data-bd-pos]").forEach(function(b){ b.addEventListener("click", function(){
    CG._bdUI.pos = this.getAttribute("data-bd-pos");
    var self = this;
    document.querySelectorAll("[data-bd-pos]").forEach(function(x){ var on = x===self; x.classList.toggle("chip-chrome", on); x.setAttribute("aria-pressed", on); });
    rerenderPool();
  }); });
  wireAdds();
  document.querySelectorAll("[data-quickpick]").forEach(function(b){ b.addEventListener("click", function(){
    var pid=this.getAttribute("data-quickpick"), pickId=this.getAttribute("data-pick"), nm=this.getAttribute("data-name"), btn=this;
    btn.disabled=true;
    CG.sb.rpc("draft_make_pick",{ p_pick:pickId, p_player:pid }).then(function(r){
      if(r.error){ CG.toast(r.error.message,"err"); btn.disabled=false; return; }
      CG.toast(nm+" drafted — welcome aboard","ok"); CG.refreshDraft();
    });
  }); });
  document.querySelectorAll("[data-openpick]").forEach(function(b){ b.addEventListener("click", function(){
    CG.draftPickModalLive(this.getAttribute("data-openpick"), (CG.myManagedTeam()||{}).code);
  }); });
};

/* ---------------- Control Center · Draft manager ---------------- */
CG.admDraftLive = function(){
  var lg = CG.lg, st = lg.draftState;
  var picks = CG.draftPicksCur();
  var hasPicks = picks.length>0;
  var cur = CG.draftCurPick();
  var pool = lg.draftPool||[];
  var eligible = pool.filter(function(p){ return CG.eligOf(p.profileId).ok; });
  var made = picks.filter(function(p){ return p.used; }).length;
  var running = st && (st.status==="live"||st.status==="paused");
  var sn = st ? st.season_number : ((CG.SEASON&&CG.SEASON.number)||1);

  var h = '<div style="margin-bottom:16px"><h2 class="h-sec">Draft manager</h2><p class="lede" style="margin-top:6px">Build the order, run the clock, fix anything mid-flight. Clubs pick for themselves from Team HQ — this desk is the whistle.</p></div>';

  h += '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:18px">'+
    '<div class="kpi" style="cursor:default"><b class="num" style="font-size:17px">'+CG.draftStatusChip(st, hasPicks)+'</b><span>status</span></div>'+
    '<div class="kpi" style="cursor:default"><b class="num dr-clock" id="drTick">–:––</b><span>pick clock</span></div>'+
    '<div class="kpi" style="cursor:default"><b class="num">'+made+'<span style="font-size:14px;color:var(--steel)">/'+(picks.length||"—")+'</span></b><span>picks made</span></div>'+
    '<div class="kpi" style="cursor:default"><b class="num" style="font-size:17px">'+(cur?'<span class="teamcell">'+CG.crest(cur.ownerCode,22)+'<span>'+esc(cur.ownerCode)+' · #'+cur.overall+'</span></span>':"—")+'</b><span>on the clock</span></div>'+
    '<div class="kpi'+(pool.length-eligible.length>0?" alert":"")+'" style="cursor:default"><b class="num">'+eligible.length+'<span style="font-size:14px;color:var(--steel)">/'+pool.length+'</span></b><span>pool eligible</span></div></div>';

  /* SETUP — order style + generation (blocked while running) */
  if (!running){
    var meta = st && st.order_meta;
    h += '<div class="card" style="margin-bottom:18px"><div class="card-h"><h3>Build the board</h3>'+
      (meta?'<span class="chip chip-win">order set — '+esc((CG.DRAFT_STYLES.find(function(s){return s[0]===meta.style;})||["","custom"])[1])+'</span>':'<span class="chip chip-chrome">step 1</span>')+'</div><div class="card-b">'+
      '<div class="radio-cards" role="radiogroup" aria-label="Draft order style" style="margin-bottom:14px">'+
      CG.DRAFT_STYLES.map(function(s){
        var on = s[0]===(CG._dStyle||"reverse_standings");
        return '<label class="'+(on?"on":"")+'" data-dstyle="'+s[0]+'" style="flex-direction:column;align-items:flex-start;gap:3px">'+
          '<input type="radio" name="dStyle"'+(on?" checked":"")+'><b>'+s[1]+'</b>'+
          '<span class="caption" style="text-transform:none;letter-spacing:0">'+s[2]+'</span></label>';
      }).join("")+'</div>'+
      '<div id="dManualWrap" style="display:none;margin-bottom:14px"><span class="eyebrow" style="display:block;margin-bottom:8px">Arrange the order — first pick at the top</span><div id="dManualList"></div></div>'+
      '<div style="display:flex;gap:12px;align-items:end;flex-wrap:wrap">'+
      '<label class="fld" style="max-width:130px;margin:0"><span>Rounds</span><input id="dRounds" type="number" min="1" max="20" value="'+((meta&&meta.rounds)||10)+'"></label>'+
      '<button class="btn btn-chrome" id="dGenerate">'+CG.ic("grid",15)+(hasPicks?"Regenerate the board":"Generate the board")+'</button>'+
      (meta?'<button class="btn btn-ghost" id="dAnnounce">Announce the order</button>':"")+
      '</div>'+
      (hasPicks?'<p class="caption" style="margin-top:10px">Regenerating replaces every pick — it’s blocked once any pick has been made (reverse them first). '+picks.length+' picks exist now.</p>'
               :'<p class="caption" style="margin-top:10px">Ten rounds, snake order (1→8, then 8→1). The pick order publishes to the clubs the moment you generate.</p>')+
      (meta&&meta.codes?'<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:12px">'+meta.codes.map(function(c,i){ return '<span class="chip'+(i===0?" chip-chrome":"")+'" style="font-size:10px">'+(i+1)+' · '+esc(c)+'</span>'; }).join("")+'</div>':"")+
      '</div></div>';
  }

  /* RUN CONTROLS */
  if (hasPicks){
    h += '<div class="card" style="margin-bottom:18px"><div class="card-h"><h3>Run the night</h3>'+(st?'<span class="caption mono">season '+sn+'</span>':"")+'</div>'+
      '<div class="card-b" style="display:flex;gap:9px;flex-wrap:wrap;align-items:end">'+
      (!running? '<label class="fld" style="max-width:150px;margin:0"><span>Seconds per pick</span><input id="dSecs" type="number" min="15" max="600" value="'+((st&&st.pick_seconds)||120)+'"></label>'+
                 '<button class="btn btn-chrome" id="dStart">'+CG.ic("play",15)+(st&&st.status==="complete"?"Restart the draft":"Start the draft")+'</button>'
       : (st.status==="live" ? '<button class="btn btn-ink" id="dPause">Pause</button>' : '<button class="btn btn-chrome" id="dResume">'+CG.ic("play",15)+'Resume</button>')+
         '<label class="fld" style="max-width:130px;margin:0"><span>New clock (s)</span><input id="dResetSecs" type="number" min="15" max="600" placeholder="'+((st&&st.pick_seconds)||120)+'"></label>'+
         '<button class="btn btn-ghost" id="dResetClock">Reset the clock</button>'+
         '<button class="btn btn-ghost" id="dSkip">Skip this pick</button>'+
         '<button class="btn btn-ghost" id="dConclude" style="margin-left:auto;color:var(--red)">Conclude the draft</button>')+
      '</div>'+
      (running&&cur?'<div class="card-b" style="border-top:1px solid var(--line);display:flex;gap:12px;align-items:center;flex-wrap:wrap;background:var(--chrome-tint)">'+
        '<b style="font-family:var(--f-disp)">'+esc(CG.TEAM[cur.ownerCode]?CG.TEAM[cur.ownerCode].name:cur.ownerCode)+' are on the clock</b><span class="caption">R'+cur.round+' · #'+cur.overall+' overall</span>'+
        '<button class="btn btn-chrome btn-sm" style="margin-left:auto" data-openpick="'+cur.id+'">Pick on their behalf</button></div>':"")+
      '<div class="card-b" style="border-top:1px solid var(--line)"><span class="caption">If a clock expires the league auto-drafts from the club’s own board (best available), then best-rated eligible player. Skipped picks stay recoverable — clubs use them from Team HQ, or you can from the table below. Concluding releases every unused pick and starts the ten-minute countdown to automatic rookie placement.</span></div></div>';
  }

  /* FULL BOARD */
  if (hasPicks){
    var rounds = {};
    picks.forEach(function(p){ (rounds[p.round]=rounds[p.round]||[]).push(p); });
    h += '<div class="card" style="margin-bottom:18px"><div class="card-h"><h3>Every pick</h3><span class="chip">'+made+' of '+picks.length+' made</span></div>'+
      '<div class="tblwrap"><table class="tbl keepcols"><caption>The full board</caption>'+
      '<thead><tr><th>Pick</th><th class="tleft">Club</th><th class="tleft">Selection</th><th class="tleft">Status</th><th class="tright">Actions</th></tr></thead><tbody>'+
      Object.keys(rounds).sort(function(a,b){return a-b;}).map(function(rn){
        return '<tr><td colspan="5" style="background:var(--ice);font-family:var(--f-mono);font-size:10px;letter-spacing:.14em;padding:7px 12px">ROUND '+rn+'</td></tr>'+
          rounds[rn].sort(function(a,b){ return a.overall-b.overall; }).map(function(p){
            var isCur = cur && p.id===cur.id;
            return '<tr class="'+(isCur?"dr-now":"")+'"><td class="num">'+p.overall+'</td>'+
              '<td class="tleft"><span class="teamcell">'+CG.crest(p.ownerCode,20)+'<span class="mono" style="font-size:12px">'+esc(p.ownerCode||"?")+'</span></span></td>'+
              '<td class="tleft">'+(p.used?'<b>'+esc(p.playerName||"")+'</b>':'<span class="caption">—</span>')+'</td>'+
              '<td class="tleft">'+(isCur?'<span class="chip chip-live" style="font-size:9px"><span class="live-dot"></span>ON THE CLOCK</span>'
                : p.used?'<span class="chip chip-win" style="font-size:9px">PICKED</span>'
                : p.skipped?'<span class="chip chip-warn" style="font-size:9px">SKIPPED</span>'
                :'<span class="caption mono" style="font-size:10px">upcoming</span>')+'</td>'+
              '<td class="tright">'+(p.used?'<button class="btn btn-ghost btn-sm" data-adm-reverse="'+p.id+'" data-name="'+esc(p.playerName||"the pick")+'">Reverse</button>'
                : (isCur||p.skipped)&&running?'<button class="btn btn-ghost btn-sm" data-openpick="'+p.id+'">Pick for them</button>':'')+'</td></tr>';
          }).join("");
      }).join("")+'</tbody></table></div></div>';
  }

  /* POOL */
  h += '<div class="card"><div class="card-h"><h3>The player pool</h3><span class="chip'+(pool.length?'':' chip-warn')+'">'+pool.length+' unrostered</span></div>';
  if (pool.length){
    var inelig = pool.length - eligible.length;
    if (inelig>0) h += '<div class="card-b"><span class="caption"><b>'+inelig+'</b> player'+(inelig===1?"":"s")+' below five pre-season games — not draftable; they’re placed on clubs automatically ten minutes after the final pick.</span></div>';
    h += '<div class="tblwrap"><table class="tbl keepcols"><caption>Available players</caption>'+
      '<thead><tr><th class="tleft">Player</th><th>Pos</th><th>Pre-season</th><th class="tleft">Eligibility</th></tr></thead><tbody>'+
      pool.slice(0,60).map(function(p){
        var pre = (lg.preGp||{})[p.profileId]||{gp:0,g:0,a:0};
        return '<tr><td class="tleft"><b>'+esc(p.tag)+'</b></td><td class="mono" style="font-size:11px">'+esc(p.pos||"?")+'</td>'+
          '<td class="mono" style="font-size:11px">'+pre.gp+'gp '+pre.g+'g '+pre.a+'a</td><td class="tleft">'+CG.eligChipD(p.profileId)+'</td></tr>';
      }).join("")+'</tbody></table></div>'+
      (pool.length>60?'<div class="card-b"><span class="caption">Showing 60 of '+pool.length+' — the full pool lives in Pre-season Central.</span></div>':'');
  } else {
    h += '<div class="card-b"><div class="empty" style="padding:34px 20px"><div class="e-art">'+CG.ic("users",20)+'</div><b>No unrostered registrations yet</b><p>The pool fills as players register — every unrostered registrant for the season shows here with their eligibility.</p></div></div>';
  }
  h += '</div>';
  return h;
};
CG.AFTER._admDraft = function(){
  CG.subscribeDraft(); CG._armDraftTick();
  var st = CG.lg.draftState;
  var sn = st ? st.season_number : ((CG.SEASON&&CG.SEASON.number)||1);
  var style = CG._dStyle || "reverse_standings";
  CG._manualOrder = CG._manualOrder && CG._manualOrder.length===(CG.TEAMS||[]).length
    ? CG._manualOrder : (CG.TEAMS||[]).map(function(t){ return t.code; });
  function renderManual(){
    var wrap = document.getElementById("dManualWrap"), list = document.getElementById("dManualList");
    if (!wrap || !list) return;
    wrap.style.display = style==="manual" ? "" : "none";
    if (style!=="manual") return;
    list.innerHTML = CG._manualOrder.map(function(c, i){
      return '<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-top:1px solid var(--line-soft)">'+
        '<b class="num" style="width:22px">'+(i+1)+'</b>'+CG.crest(c,22)+'<b style="font-size:13.5px;flex:1">'+esc(CG.TEAM[c]?CG.TEAM[c].name:c)+'</b>'+
        '<button class="btn btn-ghost btn-sm" data-mo-up="'+c+'" aria-label="Move '+esc(c)+' up"'+(i===0?" disabled":"")+'>'+CG.ic("up",12)+'</button>'+
        '<button class="btn btn-ghost btn-sm" data-mo-dn="'+c+'" aria-label="Move '+esc(c)+' down"'+(i===CG._manualOrder.length-1?" disabled":"")+'>'+CG.ic("down",12)+'</button></div>';
    }).join("");
    list.querySelectorAll("[data-mo-up]").forEach(function(b){ b.addEventListener("click", function(){
      var c=this.getAttribute("data-mo-up"), i=CG._manualOrder.indexOf(c);
      if(i>0){ CG._manualOrder.splice(i,1); CG._manualOrder.splice(i-1,0,c); renderManual(); }
    }); });
    list.querySelectorAll("[data-mo-dn]").forEach(function(b){ b.addEventListener("click", function(){
      var c=this.getAttribute("data-mo-dn"), i=CG._manualOrder.indexOf(c);
      if(i>=0&&i<CG._manualOrder.length-1){ CG._manualOrder.splice(i,1); CG._manualOrder.splice(i+1,0,c); renderManual(); }
    }); });
  }
  document.querySelectorAll("[data-dstyle]").forEach(function(l){
    var radio = l.querySelector('input[type="radio"]');
    var pick = function(){ style = l.getAttribute("data-dstyle"); CG._dStyle = style;
      document.querySelectorAll("[data-dstyle]").forEach(function(x){ x.classList.toggle("on", x===l); });
      renderManual(); };
    if (radio) radio.addEventListener("change", function(){ if (radio.checked) pick(); });
    l.addEventListener("click", pick);
  });
  renderManual();
  var gen = document.getElementById("dGenerate");
  if (gen) gen.addEventListener("click", function(){
    var rounds = parseInt((document.getElementById("dRounds")||{}).value,10)||10;
    var styleName = (CG.DRAFT_STYLES.find(function(s){return s[0]===style;})||["","?"])[1];
    var manualIds = style==="manual" ? CG._manualOrder.map(function(c){ return (CG.lg._codeToId||{})[c]; }) : null;
    CG.confirm("Generate the draft board?",
      rounds+" rounds, snake order, "+styleName.toLowerCase()+". This replaces the existing board — every club sees the new order immediately.",
      "Generate the board", function(){
      CG.sb.rpc("generate_draft_board",{ p_season_number: sn, p_rounds: rounds, p_style: style, p_manual: manualIds }).then(function(r){
        if(r.error){ CG.toast(r.error.message,"err"); return; }
        var codes = (r.data&&r.data.codes)||[];
        CG.toast("Board generated — first pick: "+(codes[0]||"?"),"ok");
        CG.refreshDraft();
      });
    });
  });
  var ann = document.getElementById("dAnnounce");
  if (ann) ann.addEventListener("click", function(){
    var meta = (CG.lg.draftState||{}).order_meta||{};
    var codes = meta.codes||[];
    if (!codes.length){ CG.toast("Generate the board first","err"); return; }
    var styleName = (CG.DRAFT_STYLES.find(function(s){return s[0]===meta.style;})||["","the commissioner's order"])[1];
    CG.confirm("Announce the draft order?","Publishes a newsroom story with the round-one order — it posts to Discord automatically.","Publish it", function(){
      var body = "The Season "+sn+" draft order is set — decided by "+styleName.toLowerCase()+".\n\n"+
        codes.map(function(c,i){ return (i+1)+". "+((CG.TEAM[c]||{}).name||c); }).join("\n")+
        "\n\nRounds snake, so round two runs in reverse. "+(meta.rounds||10)+" rounds on the night.";
      CG.sb.from("news").insert({ season_id: CG.SEASON.id, category:"League News", title:"The draft order is set",
        author:"CGHL Wire", published_at:new Date().toISOString(), body: body }).then(function(r){
        if(r.error){ CG.toast("Couldn’t publish: "+r.error.message,"err"); return; }
        CG.toast("Order announced — it’s in the newsroom and on Discord","ok");
      });
    });
  });
  var startB = document.getElementById("dStart");
  if (startB) startB.addEventListener("click", function(){
    var secs = parseInt((document.getElementById("dSecs")||{}).value,10)||120;
    var restarting = st && st.status==="complete";
    CG.confirm(restarting?"Restart the draft?":"Start the draft?",
      (restarting?"The draft re-opens: every unused pick returns to the queue and the next open pick goes on the clock with "
                 :"The first club goes on the clock with ")+secs+" seconds. Clubs draft from Team HQ; you run the room from here.",
      restarting?"Restart the draft":"Start the draft", function(){
      CG.sb.rpc("start_draft",{ p_season_number: sn, p_pick_seconds: secs }).then(function(r){
        if(r.error){ CG.toast(r.error.message,"err"); return; }
        CG.toast("The draft is live","ok"); CG.refreshDraft();
      });
    });
  });
  function simpleRpc(id, fn, args, confirmTitle, confirmBody, confirmBtn){
    var el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("click", function(){
      var run = function(){
        CG.sb.rpc(fn, args()).then(function(r){
          if(r.error){ CG.toast(r.error.message,"err"); return; }
          CG.refreshDraft();
        });
      };
      if (confirmTitle) CG.confirm(confirmTitle, confirmBody, confirmBtn, run); else run();
    });
  }
  simpleRpc("dPause","draft_pause",function(){ return { p_season_number: sn }; });
  simpleRpc("dResume","draft_resume",function(){ return { p_season_number: sn }; });
  simpleRpc("dSkip","draft_skip_pick",function(){ return { p_season_number: sn }; },
    "Skip this pick?","The club keeps the pick as a make-up — they can use it any time before the draft ends.","Skip it");
  simpleRpc("dResetClock","draft_reset_clock",function(){
    /* pass the typed value through — out-of-range surfaces the server's clear error
       instead of silently resetting to the default */
    var v = parseInt((document.getElementById("dResetSecs")||{}).value,10);
    return { p_season_number: sn, p_seconds: isNaN(v)?null:v };
  });
  simpleRpc("dConclude","draft_conclude",function(){ return { p_season_number: sn }; },
    "Conclude the draft?","Every unused pick is released and the ten-minute countdown to automatic rookie placement begins. This is the end of the night.","Conclude it");
  document.querySelectorAll("[data-adm-reverse]").forEach(function(b){ b.addEventListener("click", function(){
    var id=this.getAttribute("data-adm-reverse"), nm=this.getAttribute("data-name");
    CG.confirm("Reverse this pick?", nm+" comes off the roster and back into the pool; the pick reopens.","Reverse it", function(){
      CG.sb.rpc("draft_reverse_pick",{ p_pick:id }).then(function(r){
        if(r.error){ CG.toast(r.error.message,"err"); return; }
        CG.toast("Pick reversed","ok"); CG.refreshDraft();
      });
    });
  }); });
  document.querySelectorAll("[data-openpick]").forEach(function(b){ b.addEventListener("click", function(){
    CG.draftPickModalLive(this.getAttribute("data-openpick"));
  }); });
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
CG.availGet = function(pid){ return (CG.WEEK8 && CG.WEEK8.open) ? (CG._avail[CG.WEEK8.key+":"+pid] || null) : null; };
CG.availSave = function(entry, cb){
  var uid = CG.auth.user && CG.auth.user.id;
  if (!uid || !CG.SEASON || !CG.SEASON.id){ CG.toast("Sign in to submit availability","err"); if(cb)cb(false); return; }
  /* no scheduled week means there is nothing to be available FOR — a null week_key would
     violate the availability primary key and surface as a raw Postgres error */
  if (!CG.WEEK8 || !CG.WEEK8.open){ CG.toast("No game week is scheduled yet — availability opens when the schedule is posted","err"); if(cb)cb(false); return; }
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
  } else { h+='<div class="card-b"><p class="caption">No owner applications yet. They appear here when members apply from the “Apply to own a club” page.</p></div>'; }
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
    'Commissioners and staff can’t own or manage a club — it keeps votes on club management and staff impartial. They can still play as rostered members. New assignments that break the rule are blocked automatically.'+
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
CG.setUserRole = function(profileId, role, selEl){
  var pr=(CG.lg._profilesRaw||[]).find(function(x){ return x.id===profileId; });
  var prev = pr ? pr.role : null;
  var name = pr ? (pr.gamertag||pr.display_name||"this member") : "this member";
  if (selEl && prev) selEl.value = prev;   /* revert the visible dropdown now; a confirmed change re-renders on reload */
  var roleLabel = role==="commissioner"?"Commissioner":role==="staff"?"Staff":"Member";
  CG.confirm("Make "+esc(name)+" a "+roleLabel+"?",
    role==="commissioner" ? "Commissioners have full league control and can’t hold a club seat. The last commissioner can’t be demoted."
    : role==="staff" ? "Staff work the case queue and reviews, and can’t own or manage a club."
    : "Member is a normal player account.",
    "Set role", function(){
    CG.sb.rpc("set_member_role",{ p_target:profileId, p_role:role, p_team_code:null }).then(function(r){
      if(r.error){ CG.toast("Couldn’t set role: "+r.error.message,"err"); return; }
      if(pr) pr.role=role;
      CG.toast(esc(name)+" is now "+roleLabel,"ok"); CG.reloadLeague();
    });
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
  document.querySelectorAll("[data-role-for]").forEach(function(sel){ sel.addEventListener("change", function(){ CG.setUserRole(this.getAttribute("data-role-for"), this.value, this); }); });
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
  h+='<div class="card" style="margin-bottom:18px"><div class="card-h"><h3>Recent activity</h3>'+(imported.length?'<span class="chip chip-win">'+imported.length+' imported</span>':"")+'</div>';
  if (imported.length){
    h+= imported.slice().sort(function(a,b){ return b.at-a.at; }).slice(0,8).map(function(g){
      return '<div class="card-b" style="border-top:1px solid var(--line);display:flex;align-items:center;gap:10px;flex-wrap:wrap"><span class="teamcell">'+CG.crest(g.away,20)+'<span class="mono" style="font-size:12px">'+esc(g.away)+' '+g.awayScore+'</span></span><span class="caption">@</span><span class="teamcell"><span class="mono" style="font-size:12px">'+esc(g.home)+' '+g.homeScore+'</span>'+CG.crest(g.home,20)+'</span>'+
        '<span style="margin-left:auto;display:inline-flex;gap:6px"><a class="btn btn-ghost btn-sm" href="#/matchup/'+g.id+'">Box score</a>'+
        '<button class="btn btn-ghost btn-sm" data-reopen-final="'+g.id+'" data-label="'+esc(g.away)+' @ '+esc(g.home)+'">Re-open</button></span></div>';
    }).join("");
  } else if (pending.length){
    h+='<div class="card-b"><span class="caption"><b>'+pending.length+'</b> scheduled game'+(pending.length>1?"s have":" has")+' passed and '+(pending.length>1?"are":"is")+' still waiting for EA stats. If a game never imports, confirm both clubs are linked above and were in the same EA match.</span></div>';
  } else {
    h+='<div class="card-b"><div class="empty" style="padding:30px 20px"><div class="e-art">'+CG.ic("chart",20)+'</div><b>No finals yet</b><p>Once the season starts, finished games appear here automatically as the poller imports them.</p></div></div>';
  }
  h+='</div>';
  /* every EA payload the poller has seen is archived — anything that didn't land shows here */
  h+='<div class="card"><div class="card-h"><h3>Unmatched EA matches</h3><span class="chip" id="eaUnCount">checking…</span></div>'+
    '<div id="eaUnmatchedBody"><div class="card-b"><span class="caption">Loading the ingest archive…</span></div></div>'+
    '<div class="card-b" style="border-top:1px solid var(--line)"><span class="caption">Every EA match the poller sees is archived, even when it can’t be matched to a fixture — EA’s own history only keeps a club’s few most recent games, so nothing is lost. Fix the cause (link the club, move the fixture, or Re-open a wrongly-claimed final above) and hit <b>Re-ingest</b> to replay the archived box score.</span></div></div>';
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
  /* re-open a wrongly-matched final: clears the result + box score so the real import can land */
  document.querySelectorAll("[data-reopen-final]").forEach(function(b){ b.addEventListener("click", function(){
    var id=this.getAttribute("data-reopen-final"), label=this.getAttribute("data-label");
    CG.confirm("Re-open "+label+"?",
      "The final score and every box-score stat for this game are cleared and it returns to the schedule. Use this when the EA match that claimed the slot was actually a different game (a scrim between the same clubs). The archived payload stays replayable below.",
      "Re-open the game", function(){
      CG.sb.rpc("reopen_game_final",{ p_game:id }).then(function(r){
        if(r.error){ CG.toast("Couldn’t re-open: "+r.error.message,"err"); return; }
        CG.toast("Game re-opened — the result and box score were cleared","ok"); CG.reloadLeague();
      });
    });
  }); });
  /* unmatched / errored archive rows, with one-click replay */
  var body=document.getElementById("eaUnmatchedBody"), count=document.getElementById("eaUnCount");
  if (body && CG.sb){
    CG.sb.from("ea_ingest_log").select("ea_match_id,et_day,ea_club_ids,status,reason,last_attempt_at")
      .in("status",["unmatched","error"]).order("last_attempt_at",{ascending:false}).limit(20)
      .then(function(r){
        var rows=(r&&r.data)||[];
        if (count) count.textContent = rows.length ? rows.length+" need attention" : "all clear";
        if (count) count.className = "chip "+(rows.length?"chip-warn":"chip-win");
        if (r&&r.error){ body.innerHTML='<div class="card-b"><span class="caption">Couldn’t read the archive: '+esc(r.error.message)+'</span></div>'; return; }
        if (!rows.length){ body.innerHTML='<div class="card-b"><span class="caption">Nothing waiting — every archived EA match either imported or was intentionally skipped.</span></div>'; return; }
        body.innerHTML = rows.map(function(x){
          return '<div class="card-b" style="border-top:1px solid var(--line-soft);display:flex;align-items:center;gap:12px;flex-wrap:wrap">'+
            '<span class="mono" style="font-size:11px;color:var(--steel)">'+esc(x.et_day||"?")+'</span>'+
            '<span class="chip '+(x.status==="error"?"chip-loss":"chip-warn")+'" style="font-size:9px">'+esc(x.status.toUpperCase())+'</span>'+
            '<span class="caption" style="flex:1;min-width:200px">'+esc(x.reason||"—")+'</span>'+
            '<button class="btn btn-ghost btn-sm" data-reingest="'+esc(x.ea_match_id)+'">Re-ingest</button></div>';
        }).join("");
        body.querySelectorAll("[data-reingest]").forEach(function(b){ b.addEventListener("click", function(){
          var mid=this.getAttribute("data-reingest"), btn=this;
          btn.disabled=true; btn.textContent="Replaying…";
          CG.sb.auth.getSession().then(function(s){
            var tok = s && s.data && s.data.session && s.data.session.access_token;
            if (!tok){ CG.toast("Sign in again — no session token","err"); btn.disabled=false; btn.textContent="Re-ingest"; return; }
            fetch("/api/ingest-stats",{ method:"POST", headers:{ "Content-Type":"application/json", "Authorization":"Bearer "+tok },
              body: JSON.stringify({ reingest: mid }) })
              .then(function(r){ return r.json(); })
              .then(function(out){
                btn.disabled=false; btn.textContent="Re-ingest";
                if ((out.ingested||[]).length){ CG.toast("Box score imported — "+out.ingested[0].score,"ok"); CG.reloadLeague(); }
                else if ((out.unmatched||[]).length){ CG.toast("Still unmatched: "+out.unmatched[0].reason,"err"); }
                else if ((out.skipped||[]).length){ CG.toast("Already ingested — nothing to do","ok"); }
                else { CG.toast("Replay failed: "+esc(JSON.stringify(out.errors||out).slice(0,120)),"err"); }
              })
              .catch(function(e){ btn.disabled=false; btn.textContent="Re-ingest"; CG.toast("Replay failed: "+e.message,"err"); });
          });
        }); });
      });
  }
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
/* Club artwork arrives at whatever resolution the club had to hand — one upload was 2357x2357 —
   while the largest crest the site ever paints is 104 CSS px (about 312 device px on a 3x screen).
   Shipping the originals made the eight logos 884 KB, roughly two-thirds of the home page. Resize
   once here, at upload, so the cost isn't paid by every visitor on every load.
   WebP where the browser can encode it (all current ones can, and it holds transparency); the
   original blob is returned untouched if anything about the decode fails, so a club can never be
   blocked from uploading by this optimisation. */
CG.shrinkImage = async function(file, cap){
  var fallback = { blob:file, type:file.type||"image/png", ext:null };
  try {
    if (!/^image\//.test(file.type||"") || /svg/.test(file.type||"")) return fallback;
    var bmp = await createImageBitmap(file);
    var scale = Math.min(1, cap/Math.max(bmp.width, bmp.height));
    var w = Math.max(1, Math.round(bmp.width*scale)), h = Math.max(1, Math.round(bmp.height*scale));
    var cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    var ctx = cv.getContext("2d");
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close && bmp.close();
    var out = await new Promise(function(res){ cv.toBlob(res, "image/webp", 0.92); });
    if (!out) out = await new Promise(function(res){ cv.toBlob(res, "image/png"); });
    if (!out || out.size >= file.size) return fallback;   // never upload a bigger file than we got
    return { blob:out, type:out.type, ext:(out.type==="image/webp"?"webp":"png") };
  } catch (e) { return fallback; }
};
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
  var shrunk = await CG.shrinkImage(file, 384);
  var body = shrunk.blob, type = shrunk.type;
  var ext = shrunk.ext || ((file.name.split(".").pop()||"png").toLowerCase().replace(/[^a-z0-9]/g,"")) || "png";
  var path = (code||"logo").toLowerCase()+"-"+Date.now()+"."+ext;
  async function put(tok){
    return fetch(CG.SB_URL+"/storage/v1/object/team-logos/"+encodeURIComponent(path), {
      method:"POST",
      /* every upload gets a fresh timestamped path, so the bytes at a given URL never change and
         can be cached for a year — the old 3600 made every visitor revalidate eight logos hourly */
      headers:{ "Authorization":"Bearer "+tok, "apikey":CG.SB_KEY, "Content-Type":type, "x-upsert":"true", "cache-control":"public, max-age=31536000, immutable" },
      body:body
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
  CG._actionLoadError = null;
  try {
    var q = await Promise.all([
      /* action_requests has THREE foreign keys to profiles — filer, assignee and the case subject —
         so a bare profiles(...) embed is ambiguous and PostgREST rejects the whole query (PGRST201).
         Name the constraint. `profiles` stays the response key, so consumers are unchanged. */
      CG.sb.from("action_requests")
        .select("*, profiles!action_requests_profile_id_fkey(gamertag), target_profile:profiles!action_requests_target_profile_id_fkey(gamertag)")
        .order("created_at",{ascending:false}),
      CG.sb.from("action_messages").select("*, profiles(gamertag,role)").order("created_at",{ascending:true})
    ]);
    /* This used to fall back to [] on any error, so a failed query was indistinguishable from an
       empty queue — the Staff Desk read "the room is clean" while cases sat unanswered. Keep
       whatever we already had and say so loudly instead of inventing an empty case list. */
    if (q[0] && q[0].error) throw new Error("cases: "+(q[0].error.message||q[0].error.code||"query failed"));
    if (q[1] && q[1].error) throw new Error("case messages: "+(q[1].error.message||q[1].error.code||"query failed"));
    CG.lg._actionReqs = (q[0] && q[0].data) || [];
    var msgs = {};
    ((q[1] && q[1].data)||[]).forEach(function(m){ (msgs[m.request_id]=msgs[m.request_id]||[]).push(m); });
    CG.lg._actionMsgs = msgs;
  } catch(e){
    CG._actionLoadError = String((e && e.message) || e);
    console.error("loadActionRequests:", CG._actionLoadError);
  }
};
/* Case data is read by six surfaces — the hub dashboard tile, hub complaints, the Staff Desk (its
   KPIs, queue and assigned list), the admin overview and admin complaints — but only the complaints
   routes ever asked for a redraw when the rows finally arrived. That is why the Staff Desk could
   show "Nothing open" and "0 open cases" directly under a banner counting two: the banner comes
   from an RPC that does re-render (loadStaffAttention), the cards from an array that didn't.
   One predicate for every view that renders cases, so a new surface can't be forgotten again. */
CG.viewShowsCases = function(){ return /#\/(hub|admin)/.test(location.hash); };
CG.rerenderIfShowingCases = function(){
  /* never redraw out from under an open modal — the user may be mid-way through filing */
  var ov = document.getElementById("overlay-root");
  if (ov && ov.innerHTML.trim()) return;
  if (CG.viewShowsCases() && CG.router) CG.router();
};
CG.refreshActions = function(){
  CG.loadActionRequests().then(CG.rerenderIfShowingCases);
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
  var uid = CG.auth.user && CG.auth.user.id, names = (CG.lg&&CG.lg._profName)||{};
  /* conflict of interest: a staff member who filed this case or is named in it can't rule on it —
     RLS enforces the same at the database (silently), so the ruling tools are hidden here to match.
     Commissioners are unrestricted. */
  var isCommish = CG.role()==="commish";
  var conflicted = review && !isCommish && !!uid && (a.profile_id===uid || a.target_profile_id===uid);
  var metaBits = [];
  if (a.type==="position_change" && a.requested_position) metaBits.push(esc(a.current_position||"?")+" → "+esc(a.requested_position));
  /* prefer the subject's current gamertag over the text captured when the case was filed, so a
     rename doesn't leave the case pointing at a name nobody recognises any more */
  var aboutName = (a.target_profile && a.target_profile.gamertag) || a.target;
  if (aboutName) metaBits.push("About: "+esc(aboutName));
  metaBits.push(CG.fmtFull(Date.parse(a.created_at)));
  var h = '<div class="card"><div class="card-b" style="display:flex;flex-direction:column;gap:10px">'+
    '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">'+CG.ic(meta.icon||"flag",15)+
      '<b style="font-family:var(--f-disp)">'+esc(meta.label)+'</b>'+CG.actionStatusChip(a.status)+
      (review?'<span class="caption">filed by <b>'+esc((a.profiles&&a.profiles.gamertag)||"member")+'</b></span>':"")+
      '<span class="caption" style="margin-left:auto">'+metaBits.join(" · ")+'</span></div>';
  /* one-owner assignment (staff/commish) */
  if (review){
    var who = a.assigned_to ? (names[a.assigned_to]||"a colleague") : null;
    h += '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">'+
      (who ? '<span class="chip chip-chrome" style="font-size:9px">'+esc("Claimed by "+who)+'</span>' : '<span class="chip chip-warn" style="font-size:9px">Unclaimed</span>')+
      (conflicted ? '' : (a.assigned_to===uid ? '<button class="btn btn-ghost btn-sm" data-case-unclaim="'+a.id+'">Release</button>'
        : '<button class="btn btn-ghost btn-sm" data-case-claim="'+a.id+'">Claim</button>'))+'</div>';
  }
  h += (a.subject?'<b style="font-size:14px">'+esc(a.subject)+'</b>':"")+
    '<p class="small" style="color:var(--steel);white-space:pre-wrap">'+esc(a.details||"")+'</p>'+
    (a.response?'<div class="note grn" style="margin:0"><b style="font-family:var(--f-disp);display:block;margin-bottom:3px">Official response</b>'+esc(a.response)+'</div>':"");
  if (msgs.length){
    h += '<div class="stack" style="gap:8px;border-top:1px solid var(--line-soft);padding-top:10px">'+msgs.map(function(m){
      var isStaff = m.profiles && (m.profiles.role==="staff" || m.profiles.role==="commissioner");
      var att = (m.attachments||[]).map(function(u){
        /* render ONLY http(s) links — never a javascript:/data: scheme a filer could inject */
        return /^https?:\/\//i.test(String(u))
          ? '<a href="'+esc(u)+'" target="_blank" rel="noopener nofollow" class="caption" style="border-bottom:2px solid var(--chrome)">'+CG.ic("link",12)+' attachment</a>'
          : '<span class="caption">'+esc(String(u))+'</span>'; }).join(" ");
      return '<div style="display:flex;flex-direction:column;gap:3px'+(m.internal?';background:var(--chrome-tint);border-radius:8px;padding:8px 10px':'')+'">'+
        '<div style="display:flex;gap:9px"><b class="mono" style="font-size:11px;color:'+(isStaff?"var(--chrome-deep)":"var(--steel)")+';flex-shrink:0">'+esc((m.profiles&&m.profiles.gamertag)||"member")+(isStaff?" · league office":"")+(m.internal?' · staff-only note':"")+'</b>'+
        '<span class="small" style="color:var(--steel);white-space:pre-wrap;flex:1">'+esc(m.body||"")+'</span></div>'+
        (att?'<div style="padding-left:2px">'+att+'</div>':"")+'</div>';
    }).join("")+'</div>';
  }
  var closed = a.status==="resolved"||a.status==="denied";
  if (!closed){
    h += '<div style="display:flex;flex-direction:column;gap:6px">'+
      '<div style="display:flex;gap:8px"><input data-reply-for="'+a.id+'" placeholder="Add a reply or more detail…" style="flex:1">'+
        '<button class="btn btn-ghost btn-sm" data-reply-send="'+a.id+'">Reply</button></div>'+
      '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><input data-reply-att="'+a.id+'" placeholder="Attach a link (optional)" style="flex:1;min-width:180px">'+
        (review && !conflicted?'<label class="caption" style="display:flex;gap:6px;align-items:center;cursor:pointer;white-space:nowrap"><input type="checkbox" data-reply-internal="'+a.id+'"> staff-only note</label>':"")+'</div></div>';
  }
  if (review && !conflicted){
    h += '<div style="display:flex;gap:7px;flex-wrap:wrap;border-top:1px solid var(--line-soft);padding-top:10px">'+
      (a.status!=="reviewing"&&!closed?'<button class="btn btn-ghost btn-sm" data-act-status="reviewing" data-act-id="'+a.id+'">Mark reviewing</button>':"")+
      (!closed?'<button class="btn btn-ghost btn-sm" data-act-respond="'+a.id+'">Respond</button>':"")+
      '<button class="btn btn-ghost btn-sm" data-case-discipline="'+a.id+'" data-target="'+esc(a.target||"")+'" data-target-id="'+esc(a.target_profile_id||"")+'">Issue discipline</button>'+
      '<button class="btn btn-ghost btn-sm" data-case-history="'+a.id+'" data-target="'+esc(a.target||"")+'">History</button>'+
      (!closed?'<button class="btn btn-ghost btn-sm" data-act-status="resolved" data-act-id="'+a.id+'">Resolve</button>'+
        '<button class="btn btn-ghost btn-sm" data-act-status="denied" data-act-id="'+a.id+'">Deny</button>':"")+
      /* deletion is a commissioner-only power (RLS enforces it too); staff never see a Delete they can't use */
      (isCommish?'<button class="btn btn-ghost btn-sm" data-act-del="'+a.id+'" style="margin-left:auto">Delete</button>':"")+'</div>';
  } else if (conflicted){
    h += '<div class="note" style="margin:0"><b style="font-family:var(--f-disp);display:block;margin-bottom:3px">You’re involved in this case</b>'+
      'You filed it or you’re named in it, so another official has to rule on it. You can still add a reply as a participant.</div>';
  }
  return h+'</div></div>';
};
CG.hubComplaintsLive = function(opts){
  opts = opts||{};
  var isCommish = CG.role()==="commish";
  var review = isCommish || CG.role()==="staff";
  var all = (CG.lg._actionReqs||[]);
  var uid = CG.auth.user && CG.auth.user.id;
  var mine = CG.auth.user ? all.filter(function(a){ return a.profile_id===uid; }) : [];
  var queue = review && !opts.mineOnly ? all : mine;
  /* review filter: All / Mine (assigned to me) / Unclaimed / Open */
  var flt = review ? (CG._caseFilter||"all") : null;
  if (review){
    if (flt==="mine") queue = queue.filter(function(a){ return a.assigned_to===uid; });
    else if (flt==="unclaimed") queue = queue.filter(function(a){ return !a.assigned_to && a.status!=="resolved" && a.status!=="denied"; });
    else if (flt==="open") queue = queue.filter(function(a){ return a.status!=="resolved" && a.status!=="denied"; });
  }
  var h = '<div style="margin-bottom:20px"><span class="eyebrow chr">'+(review?"All cases · league office":"Your cases")+'</span>'+
    '<h1 class="h-sec" style="margin-top:8px">'+(opts.admin?"Complaints & requests":"League office")+'</h1>'+
    '<p class="lede" style="margin-top:8px">File a complaint, appeal a ruling, or send a request — everything lands with '+(review?"you":"the league office")+' and carries its status here.</p></div>';
  h += '<div class="grid g2" style="margin-bottom:22px">'+Object.keys(CG.ACTION_META).map(function(k){
    var m = CG.ACTION_META[k];
    return '<div class="card raise" data-file-action="'+k+'" role="button" tabindex="0" style="cursor:pointer"><div class="card-b" style="display:flex;gap:12px;align-items:flex-start">'+
      '<span class="nf-ic">'+CG.ic(m.icon,16)+'</span><div><b style="font-family:var(--f-disp)">'+esc(m.label)+'</b>'+
      '<p class="caption" style="margin-top:3px">'+esc(m.blurb)+'</p></div></div></div>';
  }).join("")+'</div>';
  h += '<div class="card-h" style="padding:0 0 12px;border:0;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px"><h3>'+(review?"Case queue ("+queue.length+")":"Your filed cases ("+queue.length+")")+'</h3>'+
    (review?'<div class="seg" role="tablist" aria-label="Filter cases">'+
      [["all","All"],["open","Open"],["mine","Mine"],["unclaimed","Unclaimed"]].map(function(f){
        return '<button data-case-filter="'+f[0]+'" class="'+(flt===f[0]?"on":"")+'" role="tab" aria-selected="'+(flt===f[0])+'">'+f[1]+'</button>'; }).join("")+'</div>':"")+'</div>';
  h += queue.length
    ? '<div class="stack" style="gap:12px">'+queue.map(function(a){ return CG.actionCard(a, review); }).join("")+'</div>'
    : '<div class="card"><div class="empty"><div class="e-art">'+CG.ic("flag",22)+'</div><b>Nothing on file'+(review?"":" yet")+'</b><p>'+(review?"Member complaints and requests queue here the moment they’re filed.":"File one above — you’ll see its status and any league-office response right here.")+'</p></div></div>';
  h += '<div class="note" style="margin-top:18px">Complaints follow Rule 7: submission → review → written decision, with appeals within 48 hours (Rule 7.6). The league office is notified the moment you file.</div>';
  return h;
};
/* Everyone in the league, not just everyone on a roster. A complaint can name a free agent or a
   player between clubs, and the roster-derived list can't see them. Sorted so exact-prefix matches
   feel right when typing, and each entry says where the person actually sits. */
CG.memberIndex = function(){
  var lg = CG.lg || {}, rostered = lg._rosteredIds || {};
  var byId = {}; (lg.players||[]).forEach(function(p){ byId[p.id] = p; });
  return (lg._profilesRaw||[])
    .filter(function(pr){ return !pr.banned; })
    .map(function(pr){
      var p = byId[pr.id];
      var name = pr.gamertag || pr.display_name || "Member";
      var sub = p && CG.TEAM[p.team]
        ? CG.TEAM[p.team].name+" · "+p.pos+(p.jersey?" · #"+p.jersey:"")
        : (rostered[pr.id] ? "Rostered" : "Free agent");
      return { kind:"player", id:pr.id, label:name, sub:sub, team:(p&&p.team)||null };
    })
    .sort(function(a,b){ return a.label.localeCompare(b.label); });
};
/* attachAC indexes players off the roster; "members" widens it to the whole league for the places
   that need to name someone rather than look up a rostered player. */
CG._origAcIndex = CG.acIndex;
CG.acIndex = function(kinds){
  if ((kinds||[]).indexOf("members") >= 0) return CG.memberIndex();
  return CG._origAcIndex.call(CG, kinds||[]);
};
/* A free-text name is unmatchable later, so every "who is this about?" field is a combobox that
   resolves to a real profile. Returns { name, id } — id is null when nothing was picked, which is
   allowed: the field is optional and a member may need to name someone off-roster. */
CG.memberPickerField = function(id, label, hint){
  return '<label class="fld"><span>'+esc(label)+'</span>'+
    '<input id="'+id+'" type="text" autocomplete="off" placeholder="Start typing a name…">'+
    (hint ? '<small class="caption" style="display:block;margin-top:5px">'+esc(hint)+'</small>' : '')+
    '</label>';
};
CG.wireMemberPicker = function(id){
  var el = document.getElementById(id);
  if (el && CG.attachAC) CG.attachAC(el, { kinds:["members"] });
  return el;
};
CG.readMemberPicker = function(id){
  var el = document.getElementById(id);
  if (!el) return { name:null, id:null };
  var name = (el.value||"").trim();
  if (!name) return { name:null, id:null };
  var picked = el.dataset.acId || null;
  /* typed the whole name without touching the menu — resolve it rather than lose the link */
  if (!picked){
    var hit = CG.memberIndex().find(function(m){ return m.label.toLowerCase() === name.toLowerCase(); });
    if (hit) picked = hit.id;
  }
  return { name:name, id:picked };
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
      fields += CG.memberPickerField("acTarget", "Who is this about? (optional)",
        "Type a name and pick from the list — that links the case to their record.");
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
  CG.wireMemberPicker("acTarget");
  document.getElementById("acGo").addEventListener("click", function(){
    var subEl=document.getElementById("acSubject");
    var subject = subEl ? subEl.value : null;
    if (subEl && !subject){ CG.toast("Pick what this is about","err"); return; }
    var details = (document.getElementById("acDetails").value||"").trim();
    if (!details){ CG.toast("Add details — describe what happened","err"); return; }
    var tgt = CG.readMemberPicker("acTarget");
    var payload = { profile_id: CG.auth.user.id, type:type, route:meta.route, details:details,
      season_id: (CG.SEASON&&CG.SEASON.id)||null, subject: subject||null,
      target: tgt.name, target_profile_id: tgt.id };
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
/* issue a warning or suspension straight from a case — resolves it and links the record */
CG.caseDisciplineModal = function(caseId, targetName, targetId){
  var players = (CG.lg.players||[]).slice().sort(function(a,b){ return a.tag.localeCompare(b.tag); });
  /* Prefer the profile the filer actually picked. Falling back to a name comparison is what the
     old behaviour did everywhere, and it silently stops matching the moment someone changes their
     gamertag — so it's now only the path for cases filed before the picker existed. */
  var match = (targetId && players.find(function(p){ return p.id===targetId; }))
    || players.find(function(p){ return targetName && p.tag.toLowerCase()===String(targetName).toLowerCase(); });
  var opts = '<option value="">— pick the player —</option>'+players.map(function(p){ return '<option value="'+p.id+'"'+(match&&match.id===p.id?" selected":"")+'>'+esc(p.tag)+' · '+esc(p.team)+'</option>'; }).join("");
  var cur = (CG.SEASON&&CG.SEASON.number)||1;
  CG.modal("Issue discipline",
    '<label class="fld"><span>Player</span><select id="dcPlayer">'+opts+'</select></label>'+
    '<label class="fld"><span>Type</span><select id="dcType">'+
      '<option value="warning">Formal warning — on record, no games lost</option>'+
      '<option value="games">Suspension — number of games</option>'+
      '<option value="date">Suspension — until a date</option>'+
      '<option value="seasons">Suspension — through a season</option></select></label>'+
    '<div id="dcGames" class="fld" style="display:none"><label><span>Games</span><input id="dcGamesN" type="number" min="1" value="1"></label></div>'+
    '<div id="dcDate" class="fld" style="display:none"><label><span>Ends after</span><input id="dcDateN" type="date"></label></div>'+
    '<div id="dcSeasons" class="fld" style="display:none"><label><span>Through season number</span><input id="dcSeasonsN" type="number" min="'+cur+'" value="'+cur+'"></label></div>'+
    '<label class="fld"><span>Reason (recorded on the player and the case)</span><textarea id="dcReason" rows="3" placeholder="What was the violation?"></textarea></label>'+
    '<p class="caption">This resolves the case, posts to #staff-casework, and notifies the player with appeal instructions (Chapter 7). A games-based suspension needs the player on a roster.</p>',
    '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-ink" id="dcGo">Issue discipline</button>');
  function sync(){ var t=document.getElementById("dcType").value;
    document.getElementById("dcGames").style.display=t==="games"?"block":"none";
    document.getElementById("dcDate").style.display=t==="date"?"block":"none";
    document.getElementById("dcSeasons").style.display=t==="seasons"?"block":"none"; }
  document.getElementById("dcType").addEventListener("change", sync); sync();
  document.getElementById("dcGo").addEventListener("click", function(){
    var pid=document.getElementById("dcPlayer").value; if(!pid){ CG.toast("Pick the player","err"); return; }
    var t=document.getElementById("dcType").value;
    var args={ p_request:caseId, p_profile:pid, p_mode:t, p_reason:(document.getElementById("dcReason").value||"").trim()||null };
    if(t==="games") args.p_games=parseInt(document.getElementById("dcGamesN").value,10)||0;
    if(t==="date"){ var d=document.getElementById("dcDateN").value; if(!d){ CG.toast("Pick an end date","err"); return; } args.p_ends_at=new Date(d+"T23:59:59").toISOString(); }
    if(t==="seasons") args.p_until_season=parseInt(document.getElementById("dcSeasonsN").value,10)||cur;
    var btn=this; btn.disabled=true;
    CG.sb.rpc("discipline_from_case", args).then(function(r){
      btn.disabled=false;
      if(r.error){ CG.toast(r.error.message||"Couldn’t issue discipline","err"); return; }
      if(CG.closeOverlay)CG.closeOverlay(); CG.toast("Discipline issued — case resolved","ok");
      if(CG.reloadLeague) CG.reloadLeague(); else CG.refreshActions();
    });
  });
};
/* rap sheet / precedent for the player a case is about */
CG.caseHistoryModal = function(targetName){
  var p = (CG.lg.players||[]).find(function(x){ return targetName && x.tag.toLowerCase()===String(targetName).toLowerCase(); });
  if(!p){ CG.toast("No rostered player matches “"+(targetName||"—")+"”","err"); return; }
  CG.modal("History — "+esc(p.tag), '<div id="rapBody" class="caption">Loading…</div>', '<button class="btn btn-ghost" data-close>Close</button>');
  CG.sb.rpc("player_rap_sheet",{ p_profile:p.id }).then(function(r){
    var el=document.getElementById("rapBody"); if(!el) return;
    if(r.error){ el.textContent=r.error.message||"Couldn’t load"; return; }
    function dl(x){ return x.mode==="games"?(x.games+"-game suspension"):x.mode==="seasons"?("suspension through Season "+x.until_season):x.mode==="date"?("suspension until "+(x.ends_at?CG.fmtDay(Date.parse(x.ends_at)):"—")):x.mode; }
    var d=r.data||{}, s=d.suspensions||[], w=d.warnings||[], c=d.cases||[], h='';
    h+='<div style="margin-bottom:14px"><b style="font-family:var(--f-disp)">Suspensions</b>'+(s.length?'<div class="stack" style="gap:6px;margin-top:6px">'+s.map(function(x){ return '<div class="small">'+esc(dl(x))+' <span class="caption">· '+esc(x.reason||"no reason")+' · '+CG.fmtDay(Date.parse(x.at))+' · '+esc(x.status)+'</span></div>'; }).join("")+'</div>':'<p class="caption" style="margin-top:4px">None on record.</p>')+'</div>';
    h+='<div style="margin-bottom:14px"><b style="font-family:var(--f-disp)">Warnings</b>'+(w.length?'<div class="stack" style="gap:6px;margin-top:6px">'+w.map(function(x){ return '<div class="small">'+esc(x.reason||"formal warning")+' <span class="caption">· '+CG.fmtDay(Date.parse(x.at))+'</span></div>'; }).join("")+'</div>':'<p class="caption" style="margin-top:4px">None on record.</p>')+'</div>';
    h+='<div><b style="font-family:var(--f-disp)">Prior cases about them</b>'+(c.length?'<div class="stack" style="gap:6px;margin-top:6px">'+c.map(function(x){ return '<div class="small">'+esc((CG.ACTION_META[x.type]||{}).label||x.type)+(x.subject?' — '+esc(x.subject):"")+' <span class="caption">· '+esc(x.status)+' · '+CG.fmtDay(Date.parse(x.at))+'</span></div>'; }).join("")+'</div>':'<p class="caption" style="margin-top:4px">None.</p>')+'</div>';
    el.innerHTML=h;
  });
};
CG.AFTER._complaintsLive = function(){
  document.querySelectorAll("[data-file-action]").forEach(function(c){
    var go = function(){ CG.fileActionRequest(c.getAttribute("data-file-action")); };
    c.addEventListener("click", go);
    c.addEventListener("keydown", function(e){ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); go(); } });
  });
  document.querySelectorAll("[data-case-filter]").forEach(function(b){ b.addEventListener("click", function(){
    CG._caseFilter = this.getAttribute("data-case-filter"); if(CG.router) CG.router();
  }); });
  document.querySelectorAll("[data-reply-send]").forEach(function(b){ b.addEventListener("click", function(){
    var id=this.getAttribute("data-reply-send");
    var inp=document.querySelector('[data-reply-for="'+id+'"]');
    var body=(inp&&inp.value||"").trim();
    if(!body){ CG.toast("Write the reply first","err"); return; }
    var att=((document.querySelector('[data-reply-att="'+id+'"]')||{}).value||"").trim();
    if (att && !/^https?:\/\//i.test(att)){ CG.toast("Attachments must be an http(s) link","err"); return; }
    var internalEl=document.querySelector('[data-reply-internal="'+id+'"]');
    var row={ request_id:id, author_id:CG.auth.user.id, body:body, internal:!!(internalEl&&internalEl.checked) };
    if (att) row.attachments=[att];
    CG.sb.from("action_messages").insert(row).then(function(r){
      if(r.error){ CG.toast("Couldn’t send: "+r.error.message,"err"); return; }
      CG.toast(row.internal?"Staff-only note added":"Reply added","ok"); CG.refreshActions();
    });
  }); });
  document.querySelectorAll("[data-case-claim]").forEach(function(b){ b.addEventListener("click", function(){
    CG.sb.rpc("assign_case",{ p_request:this.getAttribute("data-case-claim"), p_assignee:CG.auth.user.id }).then(function(r){
      if(r.error){ CG.toast(r.error.message||"Couldn’t claim","err"); return; } CG.toast("Case claimed — it’s yours","ok"); CG.refreshActions(); }); }); });
  document.querySelectorAll("[data-case-unclaim]").forEach(function(b){ b.addEventListener("click", function(){
    CG.sb.rpc("assign_case",{ p_request:this.getAttribute("data-case-unclaim"), p_assignee:null }).then(function(r){
      if(r.error){ CG.toast(r.error.message||"Couldn’t release","err"); return; } CG.toast("Released back to the queue","ok"); CG.refreshActions(); }); }); });
  document.querySelectorAll("[data-case-discipline]").forEach(function(b){ b.addEventListener("click", function(){
    CG.caseDisciplineModal(this.getAttribute("data-case-discipline"), this.getAttribute("data-target"), this.getAttribute("data-target-id")||null); }); });
  document.querySelectorAll("[data-case-history]").forEach(function(b){ b.addEventListener("click", function(){
    CG.caseHistoryModal(this.getAttribute("data-target")); }); });
  document.querySelectorAll("[data-act-status]").forEach(function(b){ b.addEventListener("click", function(){
    var id=this.getAttribute("data-act-id"), st=this.getAttribute("data-act-status");
    /* .select() so a row blocked by RLS (a conflict of interest) comes back as 0 rows, not a
       silent success — otherwise the official is told the case was ruled when nothing changed */
    CG.sb.from("action_requests").update({ status:st, updated_at:new Date().toISOString() }).eq("id",id).select("id").then(function(r){
      if(r.error){ CG.toast("Couldn’t update: "+r.error.message,"err"); return; }
      if(!r.data||!r.data.length){ CG.toast("You can’t rule on this case — you filed it or you’re named in it. Another official has to handle it.","err"); return; }
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
      CG.sb.from("action_requests").update({ response:txt||null, updated_at:new Date().toISOString() }).eq("id",id).select("id").then(function(r){
        if(r.error){ CG.toast("Couldn’t save: "+r.error.message,"err"); return; }
        if(!r.data||!r.data.length){ CG.toast("You can’t respond on this case — you filed it or you’re named in it. Another official has to handle it.","err"); return; }
        if (CG.closeOverlay) CG.closeOverlay(); CG.toast("Response saved","ok"); CG.refreshActions();
      });
    });
  }); });
  document.querySelectorAll("[data-act-del]").forEach(function(b){ b.addEventListener("click", function(){
    var id=this.getAttribute("data-act-del");
    CG.confirm("Delete this case?","It’s removed permanently for everyone. This can’t be undone.","Delete case", function(){
      CG.sb.from("action_requests").delete().eq("id",id).select("id").then(function(r){
        if(r.error){ CG.toast("Couldn’t delete: "+r.error.message,"err"); return; }
        if(!r.data||!r.data.length){ CG.toast("Only a commissioner can delete a case.","err"); return; }
        CG.toast("Case deleted","ok"); CG.refreshActions();
      });
    });
  }); });
};
/* route the hub + admin complaint views to the live system */
CG.hubComplaints = function(){ return CG.hubComplaintsLive({}); };
/* Open one case from anywhere it's listed. The conversation itself is CG.actionCard — the same
   component the list uses — so there is exactly one implementation of a case thread and replies,
   attachments, staff-only notes and the ruling buttons behave identically however you reached it.
   Its handlers are bound by AFTER._complaints, which already covers the "complaint" route. */
CG.findCase = function(caseId){
  var all = (CG.lg && CG.lg._actionReqs) || [], id = String(caseId||"").trim();
  if (!id) return null;
  return all.find(function(a){ return a.id === id; })
      /* links written elsewhere carry only the first 8 characters of the id */
      || all.find(function(a){ return String(a.id||"").slice(0, id.length) === id; })
      || null;
};
CG.hubComplaintDetail = function(caseId){
  var review = CG.role()==="commish" || CG.role()==="staff";
  var a = CG.findCase(caseId);
  var back = '<a class="sec-link" href="#/hub/complaints">'+CG.ic("back",14)+' All cases</a>';
  if (!a){
    /* a failed load and a genuinely missing case are different problems — say which */
    return '<div style="margin-bottom:18px">'+back+'</div><div class="card"><div class="empty" style="padding:60px 20px">'+
      '<div class="e-art">'+CG.ic("flag",22)+'</div>'+
      '<b>'+(CG._actionLoadError ? "Couldn’t load this case" : "That case isn’t here")+'</b>'+
      '<p>'+(CG._actionLoadError ? esc(CG._actionLoadError)+" — reload and try again."
                                 : "It may have been deleted, or it isn’t one you have access to.")+'</p>'+
      '</div></div>';
  }
  var meta = CG.ACTION_META[a.type] || { label:a.type };
  return '<div style="margin-bottom:18px">'+back+
    '<h1 class="h-sec" style="margin-top:10px">'+esc(meta.label)+'</h1>'+
    '<p class="lede" style="margin-top:6px">'+
      (review ? "The filer sees every reply here except staff-only notes."
              : "Replies from the league office appear here — you’ll be notified when one lands.")+
    '</p></div>'+
    CG.actionCard(a, review);
};

/* ================================================================
   STAFF DESK — one page for the officials: cases, discipline,
   import spot-checks, and tonight's slate. Staff + commissioner.
   ================================================================ */
/* ================================================================
   STAFF DESK data cards — EA import triage, shared task list, staff
   directory, and the activity feed. Data comes from CG._staffExtras
   (loaded by CG.loadStaffExtras for staff/commissioners).
   ================================================================ */
CG._auditLabel = function(a){
  var m = { role_change:"changed a member’s role", season_rollover:"ran the season rollover",
    case_assign:"assigned a case", discipline_from_case:"issued discipline from a case",
    season_award_finalized:"finalized a season award", playoff_round:"generated a playoff round",
    playoff_clear:"cleared a playoff round", season_status:"changed a season’s status",
    team_upsert:"edited a club", division_upsert:"edited a division", ea_reingest:"re-ran an EA import" };
  return m[a] || String(a||"acted").replace(/_/g," ");
};
CG.staffEaCard = function(){
  var ea = CG._staffExtras && CG._staffExtras.ea; if (!ea) return "";
  var un = ea.unmatched||[], ms = ea.missing_stats||[];
  if (!un.length && !ms.length) return "";
  var h = '<div class="card" style="margin-bottom:18px"><div class="card-h"><h3>EA imports needing a look</h3><span class="chip chip-warn">'+(un.length+ms.length)+'</span></div>';
  if (un.length) h += '<div class="card-b" style="border-top:1px solid var(--line-soft)"><span class="eyebrow chr" style="display:block;margin-bottom:8px">Unmatched imports</span>'+
    un.slice(0,8).map(function(u){
      return '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:7px 0;border-top:1px solid var(--line-soft)">'+
        '<span class="mono caption" style="flex-shrink:0">#'+esc(String(u.match_id||"").slice(0,10))+'</span>'+
        '<span class="small" style="flex:1;min-width:180px;color:var(--steel)">'+esc(u.reason||"couldn’t match to a scheduled game")+'</span>'+
        '<span class="caption">'+(u.at?CG.fmtDay(Date.parse(u.at)):"")+'</span>'+
        '<button class="btn btn-ghost btn-sm" data-ea-dismiss="'+esc(String(u.match_id||""))+'">Dismiss</button></div>'; }).join("")+
    '<p class="caption" style="margin-top:8px">These EA matches couldn’t be tied to a league game — usually a club EA ID that isn’t linked, or a pickup game against a club outside CGHL. Link clubs in <a href="#/admin/eastats" style="font-weight:700;border-bottom:2px solid var(--chrome)">EA stats</a>, or dismiss the ones that aren’t league games.</p></div>';
  if (ms.length) h += '<div class="card-b" style="border-top:1px solid var(--line-soft)"><span class="eyebrow chr" style="display:block;margin-bottom:8px">Finals missing box scores</span>'+
    ms.slice(0,8).map(function(m){ return '<div class="small" style="padding:6px 0;border-top:1px solid var(--line-soft)">'+esc(m.away||"?")+' @ '+esc(m.home||"?")+'<span class="caption"> · '+(m.at?CG.fmtDay(Date.parse(m.at)):"")+'</span></div>'; }).join("")+'</div>';
  return h+'</div>';
};
CG.staffTasksCard = function(){
  var ex = CG._staffExtras; if (!ex) return "";
  var tasks = (ex.tasks||[]), uid = CG.auth.user && CG.auth.user.id;
  var open = tasks.filter(function(t){ return t.status==="open"; });
  var mine = open.filter(function(t){ return t.assignee===uid; });
  var unassigned = open.filter(function(t){ return !t.assignee; });
  var names = {}; ((ex.directory)||[]).forEach(function(d){ names[d.id]=d.gamertag; });
  function row(t){
    var who = t.assignee ? (names[t.assignee]||"assigned") : null;
    return '<div class="card-b" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;border-top:1px solid var(--line-soft)">'+
      '<div style="flex:1;min-width:200px"><b style="font-family:var(--f-disp)">'+esc(t.title)+'</b>'+
      (t.detail?'<p class="caption" style="margin-top:2px">'+esc(t.detail)+'</p>':"")+
      (who?'<span class="chip chip-chrome" style="font-size:9px;margin-top:4px">'+esc(who)+'</span>':'<span class="chip chip-warn" style="font-size:9px;margin-top:4px">Unassigned</span>')+'</div>'+
      (t.assignee!==uid?'<button class="btn btn-ghost btn-sm" data-task-claim="'+t.id+'">Claim</button>':"")+
      '<button class="btn btn-ghost btn-sm" data-task-done="'+t.id+'">Done</button>'+
      '<button class="btn btn-ghost btn-sm" data-task-del="'+t.id+'" aria-label="Delete task">'+CG.ic("x",14)+'</button></div>';
  }
  var h = '<div class="card" style="margin-bottom:18px"><div class="card-h"><h3>Staff tasks</h3>'+
    '<button class="btn btn-chrome btn-sm" data-task-add>New task</button></div>';
  if (!open.length){ h += '<div class="card-b"><p class="caption">No open tasks. Spin one up with <b>New task</b> — assign it to yourself or leave it in the pool for whoever’s free.</p></div>'; }
  else {
    if (mine.length){ h += '<div class="card-b" style="border-top:1px solid var(--line-soft);padding-bottom:4px"><span class="eyebrow chr">Yours</span></div>'+mine.map(row).join(""); }
    var others = open.filter(function(t){ return t.assignee!==uid; });
    if (others.length){ h += '<div class="card-b" style="border-top:1px solid var(--line-soft);padding-bottom:4px"><span class="eyebrow chr">'+(unassigned.length?"Unassigned & others":"Assigned to others")+'</span></div>'+others.map(row).join(""); }
  }
  return h+'</div>';
};
CG.staffDirectoryCard = function(){
  var ex = CG._staffExtras; if (!ex || !ex.directory) return "";
  var dir = ex.directory, uid = CG.auth.user && CG.auth.user.id, isCommish = CG.role()==="commish";
  var h = '<div class="card" style="margin-bottom:18px"><div class="card-h"><h3>League staff</h3><span class="chip">'+dir.length+'</span></div>';
  h += dir.map(function(s){
    var depts = (s.departments||[]).map(function(k){ return '<span class="chip chip-chrome" style="font-size:9px">'+esc(CG.staffDeptLabel(k))+'</span>'; }).join(" ");
    var canEdit = isCommish || s.id===uid;
    return '<div class="card-b" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;border-top:1px solid var(--line-soft)">'+
      '<span class="chip '+(s.role==="commissioner"?"chip-chrome":"")+'" style="font-size:9px">'+(s.role==="commissioner"?"COMMISH":"STAFF")+'</span>'+
      '<b style="font-family:var(--f-disp);min-width:120px">'+esc(s.gamertag||"—")+'</b>'+
      '<span style="flex:1;display:flex;gap:5px;flex-wrap:wrap">'+(depts||'<span class="caption">no departments set</span>')+'</span>'+
      (s.timezone?'<span class="caption mono">'+esc(s.timezone)+'</span>':"")+
      (canEdit?'<button class="btn btn-ghost btn-sm" data-staff-edit="'+s.id+'">Edit</button>':"")+'</div>';
  }).join("");
  return h+'</div>';
};
CG.staffActivityCard = function(){
  var acts = (CG._staffExtras && CG._staffExtras.activity)||[]; if (!acts.length) return "";
  return '<div class="card" style="margin-bottom:18px"><div class="card-h"><h3>Recent staff activity</h3><span class="chip">audit log</span></div>'+
    '<div class="card-b" style="padding-top:6px">'+acts.slice(0,12).map(function(a){
      return '<div style="display:flex;gap:10px;align-items:baseline;padding:6px 0;border-top:1px solid var(--line-soft)">'+
        '<b class="small" style="font-family:var(--f-disp);min-width:110px">'+esc(a.actor||"League office")+'</b>'+
        '<span class="small" style="flex:1;color:var(--steel)">'+esc(CG._auditLabel(a.action))+'</span>'+
        '<span class="caption mono">'+(a.at?CG.fmtFull(Date.parse(a.at)):"")+'</span></div>';
    }).join("")+'</div></div>';
};
CG.staffTaskAddModal = function(){
  var dir = (CG._staffExtras&&CG._staffExtras.directory)||[];
  var opts = '<option value="">Leave in the pool</option>'+dir.map(function(d){ return '<option value="'+d.id+'">'+esc(d.gamertag||"staff")+'</option>'; }).join("");
  CG.modal("New staff task",
    '<label class="fld"><span>Task</span><input id="stTitle" placeholder="e.g. Re-link CHI’s EA club ID" maxlength="140"></label>'+
    '<label class="fld"><span>Detail (optional)</span><textarea id="stDetail" rows="3"></textarea></label>'+
    '<label class="fld"><span>Assign to</span><select id="stWho">'+opts+'</select></label>',
    '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-chrome" id="stGo">Create task</button>');
  document.getElementById("stGo").addEventListener("click", function(){
    var title=(document.getElementById("stTitle").value||"").trim();
    if(!title){ CG.toast("Give the task a title","err"); return; }
    var btn=this; btn.disabled=true;
    CG.sb.from("staff_tasks").insert({ title:title, detail:(document.getElementById("stDetail").value||"").trim()||null,
      assignee:(document.getElementById("stWho").value||null), created_by:CG.auth.user.id }).then(function(r){
      btn.disabled=false;
      if(r.error){ CG.toast("Couldn’t create: "+r.error.message,"err"); return; }
      if(CG.closeOverlay)CG.closeOverlay(); CG.toast("Task created","ok"); CG.refreshStaffExtras();
    });
  });
};
CG.staffProfileEditModal = function(entry){
  var picked = entry.departments||[];
  var chips = CG.STAFF_DEPARTMENTS.map(function(d){ var on=picked.indexOf(d[0])>=0;
    return '<button type="button" class="chip '+(on?"chip-chrome":"")+'" data-dept="'+d[0]+'" aria-pressed="'+on+'" style="cursor:pointer;padding:7px 12px">'+esc(d[1])+'</button>'; }).join(" ");
  CG.modal("Staff profile — "+esc(entry.gamertag||""),
    '<label class="fld"><span>Departments</span></label><div style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:16px">'+chips+'</div>'+
    '<label class="fld"><span>Time zone</span><input id="spTz" value="'+esc(entry.timezone||"")+'" placeholder="e.g. ET, PT, GMT"></label>',
    '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-chrome" id="spGo">Save</button>');
  var sel = picked.slice();
  document.querySelectorAll("[data-dept]").forEach(function(b){ b.addEventListener("click", function(){
    var k=this.getAttribute("data-dept"), i=sel.indexOf(k);
    if(i>=0){ sel.splice(i,1); this.classList.remove("chip-chrome"); this.setAttribute("aria-pressed","false"); }
    else { sel.push(k); this.classList.add("chip-chrome"); this.setAttribute("aria-pressed","true"); }
  }); });
  document.getElementById("spGo").addEventListener("click", function(){
    var btn=this; btn.disabled=true;
    CG.sb.rpc("set_staff_profile",{ p_target:entry.id, p_departments:sel, p_timezone:(document.getElementById("spTz").value||"") }).then(function(r){
      btn.disabled=false;
      if(r.error){ CG.toast(r.error.message||"Couldn’t save","err"); return; }
      if(CG.closeOverlay)CG.closeOverlay(); CG.toast("Staff profile updated","ok"); CG.refreshStaffExtras();
    });
  });
};
CG.wireStaffExtras = function(){
  var t = document.querySelector("[data-task-add]"); if (t) t.addEventListener("click", CG.staffTaskAddModal);
  document.querySelectorAll("[data-ea-dismiss]").forEach(function(b){ b.addEventListener("click", function(){
    var mid=this.getAttribute("data-ea-dismiss"), btn=this; btn.disabled=true;
    CG.sb.rpc("ea_dismiss_import",{ p_match_id:mid }).then(function(r){
      btn.disabled=false;
      if(r.error){ CG.toast(r.error.message||"Couldn’t dismiss","err"); return; }
      CG.toast("Import dismissed — not a league game","ok"); CG.refreshStaffExtras();
    }); }); });
  document.querySelectorAll("[data-task-claim]").forEach(function(b){ b.addEventListener("click", function(){
    CG.sb.from("staff_tasks").update({ assignee:CG.auth.user.id }).eq("id",this.getAttribute("data-task-claim")).then(function(r){
      if(r.error){ CG.toast("Couldn’t claim","err"); return; } CG.toast("Task claimed","ok"); CG.refreshStaffExtras(); }); }); });
  document.querySelectorAll("[data-task-done]").forEach(function(b){ b.addEventListener("click", function(){
    CG.sb.from("staff_tasks").update({ status:"done", completed_at:new Date().toISOString() }).eq("id",this.getAttribute("data-task-done")).then(function(r){
      if(r.error){ CG.toast("Couldn’t update","err"); return; } CG.toast("Task done","ok"); CG.refreshStaffExtras(); }); }); });
  document.querySelectorAll("[data-task-del]").forEach(function(b){ b.addEventListener("click", function(){
    var id=this.getAttribute("data-task-del");
    CG.confirm("Delete this task?","It’s removed for the whole staff.","Delete", function(){
      CG.sb.from("staff_tasks").delete().eq("id",id).then(function(r){
        if(r.error){ CG.toast("Couldn’t delete","err"); return; } CG.toast("Task deleted","ok"); CG.refreshStaffExtras(); }); }); }); });
  document.querySelectorAll("[data-staff-edit]").forEach(function(b){ b.addEventListener("click", function(){
    var id=this.getAttribute("data-staff-edit"), entry=((CG._staffExtras&&CG._staffExtras.directory)||[]).find(function(x){ return x.id===id; });
    if(entry) CG.staffProfileEditModal(entry); }); });
};
/* Consolidated "Needs attention" triage card — the in-app twin of the daily #staff-general
   briefing. Reads the DB aggregation (CG._staffAttention); falls back to what's already loaded
   client-side (open cases, applications, suspensions) if the RPC hasn't returned yet. */
CG.staffAttentionCard = function(){
  var a = CG._staffAttention, lg = CG.lg;
  /* client fallback for the counts the RPC would provide */
  if (!a){
    var oc = (lg._actionReqs||[]).filter(function(x){ return x.status!=="resolved" && x.status!=="denied"; }).length;
    a = { open_cases:oc, oldest_case_hours:null, sla_breached:0,
      pending_staff_apps:(lg._staffApps||[]).filter(function(x){return x.status==="pending";}).length,
      pending_owner_apps:(lg._ownerApps||[]).filter(function(x){return x.status==="pending";}).length,
      active_suspensions:(lg.suspensions||[]).filter(function(x){return x.status==="active";}).length,
      unmatched_ea:null, finals_missing_stats:null };
  }
  var n = function(v){ return (v==null?0:(v|0)); };
  var apps = n(a.pending_staff_apps)+n(a.pending_owner_apps);
  var items = [];
  if (n(a.open_cases)>0) items.push({ label:(n(a.open_cases))+" open case"+(n(a.open_cases)===1?"":"s")+
      (a.oldest_case_hours!=null?" · oldest "+(a.oldest_case_hours>=24?Math.round(a.oldest_case_hours/24)+"d":a.oldest_case_hours+"h"):""),
      go:"#/hub/complaints", warn:n(a.sla_breached)>0 });
  if (apps>0) items.push({ label:apps+" application"+(apps===1?"":"s")+" to review", go:"#/hub/staffdesk", warn:false });
  if (n(a.unmatched_ea)>0) items.push({ label:n(a.unmatched_ea)+" unmatched EA import"+(n(a.unmatched_ea)===1?"":"s"), go:"#/admin/eastats", warn:false });
  if (n(a.finals_missing_stats)>0) items.push({ label:n(a.finals_missing_stats)+" final"+(n(a.finals_missing_stats)===1?"":"s")+" missing box scores", go:"#/admin/eastats", warn:true });
  if (n(a.active_suspensions)>0) items.push({ label:n(a.active_suspensions)+" active suspension"+(n(a.active_suspensions)===1?"":"s"), go:"#/hub/staffdesk", warn:false });

  if (!items.length){
    return '<div class="note grn" style="margin-bottom:20px;display:flex;gap:10px;align-items:center">'+CG.ic("check",16)+
      '<span><b style="font-family:var(--f-disp)">All clear.</b> No cases, applications, or imports need attention right now.</span></div>';
  }
  return '<div class="card" style="margin-bottom:20px;border-color:var(--chrome)"><div class="card-h" style="background:var(--chrome-tint)">'+
    '<h3>'+CG.ic("flag",15)+' Needs attention</h3>'+
    (n(a.sla_breached)>0?'<span class="chip chip-loss">'+n(a.sla_breached)+' past 48h</span>':'<span class="chip chip-warn">'+items.length+' item'+(items.length===1?"":"s")+'</span>')+'</div>'+
    '<div class="card-b" style="display:flex;flex-wrap:wrap;gap:8px">'+items.map(function(it){
      return '<button class="chip '+(it.warn?"chip-loss":"chip-chrome")+'" style="cursor:pointer;padding:8px 12px" data-go="'+it.go+'">'+esc(it.label)+' →</button>';
    }).join("")+'</div></div>';
};
/* One application opened into its own page — the full submission, plus a written response and the
   decision, the same way a case opens from the queue. type is "staff" or "owner". */
/* Staff ballot on an application — each official casts an advisory approve/deny (with an optional
   reason). Visible ONLY to staff + commissioners: the application_ballots RLS enforces office-only
   read, so the applicant never sees the votes, only the final decision. */
CG.appBallotsFor = function(type, id){
  return ((CG.lg && CG.lg._appBallots) || []).filter(function(v){ return v.app_type===type && v.application_id===id; });
};
CG.loadAppBallots = function(){
  if (!CG.sb) return Promise.resolve(false);
  return CG.sb.from("application_ballots")
    .select("app_type,application_id,voter_id,vote,note,updated_at, voter:profiles!application_ballots_voter_id_fkey(gamertag)")
    .then(function(vb){ if(CG.lg) CG.lg._appBallots = (vb && !vb.error && vb.data) || []; return true; }, function(){ return false; });
};
CG.appBallotSection = function(type, a, decided){
  var votes = CG.appBallotsFor(type, a.id);
  var uid = CG.auth.user && CG.auth.user.id;
  var yes = votes.filter(function(v){ return v.vote==="approve"; }).length;
  var no  = votes.filter(function(v){ return v.vote==="deny"; }).length;
  var mine = votes.find(function(v){ return v.voter_id===uid; });
  var tally = votes.length
    ? '<span class="chip chip-win chip-xs">'+yes+' approve</span> <span class="chip chip-loss chip-xs">'+no+' deny</span>'
    : '<span class="chip chip-xs">no votes yet</span>';
  var h = '<div class="card" style="margin-bottom:18px"><div class="card-h"><h3>Staff ballot</h3>'+tally+'</div><div class="card-b">';
  if (votes.length){
    h += '<div class="stack" style="gap:9px;margin-bottom:14px">'+votes.slice().sort(function(x,y){
        return ((x.voter&&x.voter.gamertag)||"").localeCompare((y.voter&&y.voter.gamertag)||""); }).map(function(v){
      var nm = (v.voter && v.voter.gamertag) || ((CG.lg&&CG.lg._profName)||{})[v.voter_id] || "An official";
      return '<div style="display:flex;gap:10px;align-items:baseline;flex-wrap:wrap">'+
        '<span class="chip '+(v.vote==="approve"?"chip-win":"chip-loss")+' chip-xs" style="flex-shrink:0">'+(v.vote==="approve"?"Approve":"Deny")+'</span>'+
        '<b style="font-family:var(--f-disp);font-size:13px">'+esc(nm)+(v.voter_id===uid?' · you':"")+'</b>'+
        (v.note?'<span class="small" style="color:var(--steel);flex:1;min-width:150px">“'+esc(v.note)+'”</span>':"")+'</div>';
    }).join("")+'</div>';
  }
  if (!decided){
    h += '<div style="border-top:1px solid var(--line-soft);padding-top:12px">'+
      '<span class="caption" style="display:block;margin-bottom:8px">'+(mine?"Your vote — change it any time before the decision":"Cast your vote")+'</span>'+
      '<input id="appVoteNote" placeholder="Add a reason (optional)" autocomplete="off" style="width:100%;margin-bottom:8px" value="'+esc((mine&&mine.note)||"")+'">'+
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">'+
        '<button class="btn '+(mine&&mine.vote==="approve"?"btn-chrome":"btn-ghost")+' btn-sm" data-vote-cast="approve" aria-pressed="'+!!(mine&&mine.vote==="approve")+'" data-vt="'+esc(type)+'" data-vid="'+esc(a.id)+'">Approve</button>'+
        '<button class="btn '+(mine&&mine.vote==="deny"?"btn-ink":"btn-ghost")+' btn-sm" data-vote-cast="deny" aria-pressed="'+!!(mine&&mine.vote==="deny")+'" data-vt="'+esc(type)+'" data-vid="'+esc(a.id)+'">Deny</button>'+
        (mine?'<button class="btn btn-ghost btn-sm" data-vote-retract="1" data-vt="'+esc(type)+'" data-vid="'+esc(a.id)+'" style="margin-left:auto">Retract</button>':"")+'</div></div>';
  }
  h += '<p class="caption" style="margin-top:12px">Ballots are advisory and visible only to staff and commissioners. The applicant sees only the final decision.</p>';
  return h + '</div></div>';
};
CG.hubApplicationDetail = function(id, type){
  var review = CG.role()==="commish" || CG.role()==="staff";
  var back = '<a class="sec-link" href="#/hub/staffdesk">'+CG.ic("back",14)+' Staff Desk</a>';
  if (!review) return CG.unauthorized("Applications are reviewed by league staff.");
  var isOwner = type==="owner";
  var list = isOwner ? (CG.lg._ownerApps||[]) : (CG.lg._staffApps||[]);
  var idS = String(id||"");
  var a = list.find(function(x){ return x.id===id; })
       || list.find(function(x){ return String(x.id||"").slice(0, idS.length)===idS; });
  if (!a){
    return '<div style="margin-bottom:18px">'+back+'</div><div class="card"><div class="empty" style="padding:60px 20px">'+
      '<div class="e-art">'+CG.ic("flag",22)+'</div><b>That application isn’t here</b>'+
      '<p>It may have been withdrawn or already decided. Head back to the Staff Desk.</p></div></div>';
  }
  var prof = a.profiles||{}, name = prof.gamertag||"Applicant";
  var decided = a.status==="approved" || a.status==="denied";
  function row(label, val){ return val ? '<div style="display:flex;gap:14px;padding:9px 0;border-bottom:1px solid var(--line-soft)"><span class="caption" style="min-width:118px;flex-shrink:0">'+esc(label)+'</span><span class="small" style="flex:1">'+val+'</span></div>' : ''; }
  var fields = '';
  if (isOwner){
    fields += row("Club choice", esc(a.team_choice==="build" ? "Build a new franchise" : a.team_choice==="random" ? "Take a random open club" : (a.team_choice||"—")));
    fields += row("Proposed name", a.proposed_name?esc(a.proposed_name):"");
    fields += row("Proposed location", a.proposed_location?esc(a.proposed_location):"");
    fields += row("Franchise picks", CG.franchisePicksLine(a));
    fields += row("Preferred club", a.preferred_club?esc(a.preferred_club):"");
    fields += row("EA ID", a.ea_id?esc(a.ea_id):"");
  } else if (a.departments && a.departments.length){
    fields += row("Departments", a.departments.map(function(k){ return '<span class="chip chip-chrome chip-xs">'+esc(CG.staffDeptLabel(k))+'</span>'; }).join(" "));
  }
  fields += row("Timezone", a.timezone?esc(a.timezone):"");
  fields += row("Availability", a.availability?esc(a.availability):"");
  fields += row("Experience", a.experience?esc(a.experience):"");
  fields += row("Submitted", a.created_at?CG.fmtFull(Date.parse(a.created_at)):"");

  var statusChip = a.status==="approved" ? '<span class="chip chip-win">Approved</span>'
    : a.status==="denied" ? '<span class="chip chip-loss">Denied</span>'
    : '<span class="chip chip-warn">Pending</span>';

  var h = '<div style="margin-bottom:18px">'+back+
    '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:10px">'+
      '<span class="chip '+(isOwner?"chip":"chip-chrome")+' chip-xs">'+(isOwner?"OWNER":"STAFF")+'</span>'+
      '<h1 class="h-sec">'+esc(name)+'</h1>'+statusChip+'</div>'+
    '<p class="lede" style="margin-top:8px">'+(isOwner?"Application to own a club.":"Application to join the league staff.")+'</p></div>';

  h += '<div class="card" style="margin-bottom:18px"><div class="card-b">'+fields+
    (a.pitch?'<div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--line)"><span class="caption" style="display:block;margin-bottom:6px">Their pitch</span><p class="small" style="color:var(--ink-3);white-space:pre-wrap;line-height:1.6">'+esc(a.pitch)+'</p></div>':"")+
    '</div></div>';

  /* the staff ballot — who has voted and how — sits above the decision so it informs it */
  h += CG.appBallotSection(type, a, decided);

  if (decided){
    var whoName = (a.decided_by && (CG.lg._profName||{})[a.decided_by]) || "the league office";
    h += '<div class="note '+(a.status==="approved"?"grn":"red")+'"><b style="font-family:var(--f-disp);display:block;margin-bottom:3px">'+
      (a.status==="approved"?"Approved":"Denied")+' by '+esc(whoName)+(a.decided_at?' · '+CG.fmtFull(Date.parse(a.decided_at)):"")+'</b>'+
      (a.response?'“'+esc(a.response)+'”':"No note was left for the applicant.")+'</div>';
  } else {
    h += '<div class="card"><div class="card-h"><h3>Respond &amp; decide</h3></div><div class="card-b">'+
      '<label class="fld"><span>Response to the applicant (optional)</span>'+
      '<textarea id="appResp" rows="4" placeholder="A note delivered to '+esc(name)+' with your decision — a welcome, next steps, or why not this time."></textarea></label>'+
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">'+
        '<button class="btn btn-chrome" data-app-decide="approve" data-app-id="'+a.id+'" data-app-type="'+esc(type)+'" data-name="'+esc(name)+'">Approve</button>'+
        '<button class="btn btn-ghost" data-app-decide="deny" data-app-id="'+a.id+'" data-app-type="'+esc(type)+'" data-name="'+esc(name)+'">Deny</button></div>'+
      '<p class="caption" style="margin-top:10px">'+(isOwner
        ? "Approving green-lights them — a commissioner then hands them their club in Users &amp; roles."
        : "Approving promotes them to staff immediately; the Discord role follows on the next sync.")+' Your note is delivered to them with the decision.</p>'+
    '</div></div>';
  }
  return h;
};
CG.AFTER._applicationDetail = function(){
  document.querySelectorAll("[data-app-decide]").forEach(function(b){ b.addEventListener("click", function(){
    var approve = this.getAttribute("data-app-decide")==="approve";
    var id = this.getAttribute("data-app-id"), type = this.getAttribute("data-app-type"), name = this.getAttribute("data-name");
    var resp = (document.getElementById("appResp")||{}).value || "";
    var all = document.querySelectorAll("[data-app-decide]"); all.forEach(function(x){ x.disabled = true; });
    var rpc = type==="owner" ? "decide_owner_application" : "decide_staff_application";
    CG.sb.rpc(rpc, { p_id:id, p_approve:approve, p_response:(resp.trim()||null) }).then(function(r){
      if (r.error){ all.forEach(function(x){ x.disabled=false; }); CG.toast("Couldn’t decide: "+r.error.message,"err"); return; }
      CG.toast((r.data||name)+(approve?" — approved":" — denied"),"ok");
      CG.reloadLeague().then(function(){ location.hash = "#/hub/staffdesk"; });
    });
  }); });
  /* staff ballot — cast/change/retract an advisory vote; .select() so an RLS-blocked write (a
     non-official) is reported honestly instead of a false success */
  document.querySelectorAll("[data-vote-cast]").forEach(function(b){ b.addEventListener("click", function(){
    var v=this.getAttribute("data-vote-cast"), t=this.getAttribute("data-vt"), id=this.getAttribute("data-vid");
    var note=((document.getElementById("appVoteNote")||{}).value||"").trim();
    var btns=document.querySelectorAll("[data-vote-cast],[data-vote-retract]"); btns.forEach(function(x){ x.disabled=true; });
    CG.sb.from("application_ballots").upsert({ app_type:t, application_id:id, voter_id:CG.auth.user.id, vote:v, note:(note||null), updated_at:new Date().toISOString() }, {onConflict:"app_type,application_id,voter_id"}).select("id").then(function(r){
      if(r.error){ btns.forEach(function(x){x.disabled=false;}); CG.toast("Couldn’t save your vote: "+r.error.message,"err"); return; }
      if(!r.data||!r.data.length){ btns.forEach(function(x){x.disabled=false;}); CG.toast("Only league staff can vote on applications.","err"); return; }
      CG.toast("Vote recorded — "+(v==="approve"?"approve":"deny"),"ok");
      CG.loadAppBallots().then(function(){ if(CG.router) CG.router(); });
    });
  }); });
  document.querySelectorAll("[data-vote-retract]").forEach(function(b){ b.addEventListener("click", function(){
    var t=this.getAttribute("data-vt"), id=this.getAttribute("data-vid");
    CG.sb.from("application_ballots").delete().eq("app_type",t).eq("application_id",id).eq("voter_id",CG.auth.user.id).select("id").then(function(r){
      if(r.error){ CG.toast("Couldn’t retract: "+r.error.message,"err"); return; }
      CG.toast("Vote retracted","ok"); CG.loadAppBallots().then(function(){ if(CG.router) CG.router(); });
    });
  }); });
};
/* Every ticket the league office has handled, in one place — complaints, appeals, trade and
   position requests, and staff/owner applications, open or closed. Each row opens its own detail
   page (the case thread or the application response), so the whole history is browsable. */
CG.allTickets = function(){
  var lg = CG.lg || {}, out = [];
  (lg._actionReqs||[]).forEach(function(a){
    var meta = CG.ACTION_META[a.type] || { label:a.type, icon:"flag" };
    var closed = a.status==="resolved" || a.status==="denied";
    out.push({ group:a.type, typeLabel:meta.label, icon:meta.icon||"flag",
      title: a.subject || (a.details||"Request").slice(0,64),
      who: (a.profiles&&a.profiles.gamertag)||"member",
      result: a.status==="resolved" ? "Resolved" : a.status==="denied" ? "Denied" : "Open",
      isOpen: !closed, at: a.created_at?Date.parse(a.created_at):0,
      route: "#/hub/complaint?id="+a.id, replies: ((lg._actionMsgs||{})[a.id]||[]).length });
  });
  (lg._staffApps||[]).forEach(function(a){
    var closed = a.status==="approved" || a.status==="denied";
    out.push({ group:"staff", typeLabel:"Staff application", icon:"users",
      title:(a.profiles&&a.profiles.gamertag)||"Applicant", who:(a.profiles&&a.profiles.gamertag)||"applicant",
      result: a.status==="approved"?"Approved":a.status==="denied"?"Denied":"Pending", isOpen:!closed,
      at: a.created_at?Date.parse(a.created_at):0, route:"#/hub/application?id="+a.id+"&type=staff", replies:0 });
  });
  (lg._ownerApps||[]).forEach(function(a){
    var closed = a.status==="approved" || a.status==="denied";
    out.push({ group:"owner", typeLabel:"Owner application", icon:"shield",
      title:(a.profiles&&a.profiles.gamertag)||"Applicant", who:(a.profiles&&a.profiles.gamertag)||"applicant",
      result: a.status==="approved"?"Approved":a.status==="denied"?"Denied":"Pending", isOpen:!closed,
      at: a.created_at?Date.parse(a.created_at):0, route:"#/hub/application?id="+a.id+"&type=owner", replies:0 });
  });
  return out.sort(function(x,y){ return y.at - x.at; });
};
CG.hubTicketArchive = function(){
  if (CG.role()!=="staff" && CG.role()!=="commish") return CG.unauthorized("The ticket archive is for league staff.");
  var type = CG._arcType||"all", status = CG._arcStatus||"all";
  var shown = CG.allTickets().filter(function(t){
    if (type!=="all" && t.group!==type) return false;
    if (status==="open" && !t.isOpen) return false;
    if (status==="closed" && t.isOpen) return false;
    return true;
  });
  function fbtn(attr, cur, val, label){ return '<button type="button" class="chip '+(cur===val?"chip-chrome":"")+'" style="cursor:pointer" '+attr+'="'+val+'" aria-pressed="'+(cur===val)+'">'+esc(label)+'</button>'; }
  function resultChip(t){
    var cls = (t.result==="Resolved"||t.result==="Approved") ? "chip-win" : t.result==="Denied" ? "chip-loss" : "chip-warn";
    return '<span class="chip '+cls+' chip-xs">'+esc(t.result)+'</span>';
  }
  function row(t){
    return '<div class="card-b row-go" data-go="'+esc(t.route)+'" role="link" tabindex="0" '+
      'data-arc-text="'+esc((t.title+" "+t.who+" "+t.typeLabel).toLowerCase())+'" '+
      'aria-label="Open '+esc(t.typeLabel)+': '+esc(t.title)+'" '+
      'style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;border-top:1px solid var(--line-soft)">'+
      '<span style="color:var(--steel);flex-shrink:0">'+CG.ic(t.icon,15)+'</span>'+
      '<span style="flex:1;min-width:170px"><b style="font-family:var(--f-disp);display:block">'+esc(t.title)+'</b>'+
        '<span class="caption">'+esc(t.typeLabel)+' · '+esc(t.who)+(t.replies?' · '+t.replies+' repl'+(t.replies===1?"y":"ies"):"")+'</span></span>'+
      resultChip(t)+
      '<span class="caption">'+(t.at?CG.fmtDay(t.at):"")+'</span>'+
      '<span class="caption" aria-hidden="true">→</span></div>';
  }
  var typeF = [["all","All"],["complaint","Complaints"],["appeal","Appeals"],["trade_request","Trade requests"],["position_change","Position changes"],["staff","Staff apps"],["owner","Owner apps"]];
  var statusF = [["all","All"],["open","Open / pending"],["closed","Resolved / decided"]];

  var h = '<div style="margin-bottom:18px"><a class="sec-link" href="#/hub/staffdesk">'+CG.ic("back",14)+' Staff Desk</a>'+
    '<h1 class="h-sec" style="margin-top:10px">Ticket archive</h1>'+
    '<p class="lede" style="margin-top:8px">Every complaint, appeal, request, and application — open or closed — with its result. Open any one to read the full conversation and the decision.</p></div>';
  h += '<div class="card" style="margin-bottom:16px"><div class="card-b" style="display:grid;gap:12px">'+
    '<div style="display:flex;gap:12px;align-items:baseline;flex-wrap:wrap"><span class="caption" style="min-width:54px">Type</span><div style="display:flex;gap:6px;flex-wrap:wrap">'+typeF.map(function(f){ return fbtn("data-arc-type",type,f[0],f[1]); }).join("")+'</div></div>'+
    '<div style="display:flex;gap:12px;align-items:baseline;flex-wrap:wrap"><span class="caption" style="min-width:54px">Status</span><div style="display:flex;gap:6px;flex-wrap:wrap">'+statusF.map(function(f){ return fbtn("data-arc-status",status,f[0],f[1]); }).join("")+'</div></div>'+
    '<div style="display:flex;gap:12px;align-items:center"><span class="caption" style="min-width:54px">Search</span><input id="arcSearch" type="search" placeholder="Filter by name, subject, or type…" style="flex:1" autocomplete="off"></div>'+
  '</div></div>';
  h += '<div class="card"><div class="card-h"><h3>Tickets</h3><span class="chip" id="arcCount">'+shown.length+'</span></div>'+
    (shown.length ? shown.map(row).join("") : '<div class="card-b"><p class="caption">No tickets match these filters. Try widening them above.</p></div>')+'</div>';
  return h;
};
CG.AFTER._ticketArchive = function(){
  document.querySelectorAll("[data-arc-type]").forEach(function(b){ b.addEventListener("click", function(){ CG._arcType = this.getAttribute("data-arc-type"); if(CG.router) CG.router(); }); });
  document.querySelectorAll("[data-arc-status]").forEach(function(b){ b.addEventListener("click", function(){ CG._arcStatus = this.getAttribute("data-arc-status"); if(CG.router) CG.router(); }); });
  var s = document.getElementById("arcSearch");
  if (s) s.addEventListener("input", function(){
    /* live filter without a re-render, so the search box keeps focus */
    var q = this.value.trim().toLowerCase(), n = 0;
    document.querySelectorAll("[data-arc-text]").forEach(function(r){
      var hit = !q || r.getAttribute("data-arc-text").indexOf(q) >= 0;
      r.style.display = hit ? "" : "none"; if (hit) n++;
    });
    var c = document.getElementById("arcCount"); if (c) c.textContent = n;
  });
};
CG.hubStaffDesk = function(){
  var lg = CG.lg;
  var reqs = (lg._actionReqs||[]);
  /* terminal statuses are 'resolved' and 'denied' — a denied case is closed, not open */
  var open = reqs.filter(function(a){ return a.status!=="resolved" && a.status!=="denied"; });
  /* warnings live in the same table but never count as suspensions */
  var sus = (lg.suspensions||[]).filter(function(s){ return s.status==="active" && s.mode!=="warning"; });
  var now = Date.now();
  var finals = (lg.allResults||[]).slice().sort(function(a,b){ return b.at-a.at; });
  var weekFinals = finals.filter(function(r){ return now - r.at < 7*86400000; });
  var tonight = lg.tonight||[];

  var h = '<div style="margin-bottom:20px"><span class="eyebrow chr">League staff · officials’ tools</span>'+
    '<h1 class="h-sec" style="margin-top:8px">Staff Desk</h1>'+
    '<p class="lede" style="margin-top:8px">The case queue, active discipline, and the imports worth a second look — everything an official touches, in one place.</p></div>';

  h += CG.staffAttentionCard();

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
  /* each row opens the application into its own page (CG.hubApplicationDetail) to review it in full
     and respond — the same open-to-decide flow as the case queue. */
  function appRow(a, type){
    var prof = a.profiles||{}, isOwner = type==="owner";
    var sub = isOwner ? CG.franchisePicksLine(a)
      : ((a.departments&&a.departments.length) ? a.departments.map(function(k){ return esc(CG.staffDeptLabel(k)); }).join(" · ") : "Staff application");
    /* how the staff ballot stands so far — a glance-level tally before you open it */
    var vb = CG.appBallotsFor(type, a.id), vy = vb.filter(function(v){return v.vote==="approve";}).length, vn = vb.length - vy;
    var tally = vb.length ? '<span class="chip chip-xs" title="Staff ballot so far">'+vy+' approve · '+vn+' deny</span>' : "";
    return '<div class="card-b row-go" data-go="#/hub/application?id='+a.id+'&amp;type='+type+'" role="link" tabindex="0" '+
      'aria-label="Open '+(isOwner?"owner":"staff")+' application from '+esc(prof.gamertag||"applicant")+'" '+
      'style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;border-top:1px solid var(--line-soft)">'+
      '<span class="chip '+(isOwner?"chip":"chip-chrome")+' chip-xs">'+(isOwner?"OWNER":"STAFF")+'</span>'+
      '<span style="flex:1;min-width:160px"><b style="font-family:var(--f-disp);display:block">'+esc(prof.gamertag||"Applicant")+'</b>'+
        '<span class="caption">'+sub+'</span></span>'+
      tally+
      '<span class="caption">'+(a.created_at?CG.fmtDay(Date.parse(a.created_at)):"")+'</span>'+
      '<span class="caption" aria-hidden="true">→</span></div>';
  }
  if (staffApps.length) h += staffApps.map(function(a){ return appRow(a,"staff"); }).join("");
  if (ownerApps.length) h += ownerApps.map(function(a){ return appRow(a,"owner"); }).join("");
  if (!staffApps.length && !ownerApps.length){
    h += '<div class="card-b"><p class="caption">No applications waiting. Members apply at <b>Apply to own a club</b> (#/owner) and <b>Apply to join the staff</b> (#/staffapply) — both linked in the site footer.</p></div>';
  } else {
    h += '<div class="card-b" style="border-top:1px solid var(--line)"><span class="caption">Open an application to review it in full and respond. Approving a staff application promotes the member immediately (Discord role follows on the next sync); approving an owner application green-lights them, and a commissioner then hands them their club in Users &amp; roles → Club role.</span></div>';
  }
  h += '</div>';

  /* case queue preview */
  h += '<div class="card" style="margin-bottom:18px"><div class="card-h"><h3>Case queue</h3>'+
    '<a class="sec-link" href="#/hub/complaints">Open the queue</a></div>';
  h += open.length ? open.slice(0,5).map(function(a){
      var meta = CG.ACTION_META[a.type] || { label:a.type };
      var replies = ((lg._actionMsgs||{})[a.id]||[]).length;
      var names = (lg&&lg._profName)||{};
      return '<div class="card-b row-go" data-go="#/hub/complaint?id='+esc(a.id)+'" role="link" tabindex="0" '+
        'aria-label="Open case: '+esc(a.subject||meta.label)+'" '+
        'style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;border-top:1px solid var(--line-soft)">'+
        '<span class="chip chip-warn" style="text-transform:capitalize">'+esc(a.status||"open")+'</span>'+
        '<span style="flex:1;min-width:160px">'+
          '<b style="font-family:var(--f-disp);display:block">'+esc(a.subject||meta.label)+'</b>'+
          '<span class="caption">'+esc(meta.label)+' · filed by '+esc((a.profiles&&a.profiles.gamertag)||"member")+
          (a.assigned_to ? ' · claimed by '+esc(names[a.assigned_to]||"a colleague") : '')+'</span></span>'+
        (replies ? '<span class="chip chip-xs">'+replies+' repl'+(replies===1?"y":"ies")+'</span>' : "")+
        '<span class="caption">'+(a.created_at?CG.fmtDay(Date.parse(a.created_at)):"")+'</span>'+
        '<span class="caption" aria-hidden="true">→</span></div>';
    }).join("")
    : CG._actionLoadError
      /* never report an empty queue we aren't sure about — an unanswered case looks identical to
         a clean room, and that is exactly how two open cases went unseen */
      ? '<div class="card-b"><p class="caption" style="color:var(--red-ink)"><b>Couldn’t load the case queue.</b> '+esc(CG._actionLoadError)+' — the count above comes straight from the database, so cases may be waiting. Reload; if it persists this is a bug worth reporting.</p></div>'
      : '<div class="card-b"><p class="caption">Nothing open — the room is clean.</p></div>';
  h += '</div>';

  /* ticket archive — the full history, open or closed */
  var arcAll = CG.allTickets(), arcClosed = arcAll.filter(function(t){ return !t.isOpen; }).length;
  h += '<div class="card raise" style="margin-bottom:18px;cursor:pointer" data-go="#/hub/archive" role="link" tabindex="0" aria-label="Open the ticket archive">'+
    '<div class="card-h"><h3>Ticket archive</h3><span class="sec-link">'+CG.ic("db",14)+' Open the archive</span></div>'+
    '<div class="card-b"><p class="caption">Every complaint, appeal, request, and application the league office has handled — open or closed — with its result and full conversation. '+
      '<b>'+arcAll.length+'</b> ticket'+(arcAll.length===1?"":"s")+' on file'+(arcClosed?', '+arcClosed+' resolved':"")+'.</p></div></div>';

  /* active discipline */
  h += '<div class="card" style="margin-bottom:18px"><div class="card-h"><h3>Active discipline</h3><span class="chip">'+sus.length+'</span></div>';
  h += sus.length ? sus.map(function(s){
      var p = CG.playerById(lg, s.playerId);
      /* an enforcement-void suspension belongs to a player with no roster spot, so they aren't in
         lg.players — fall back to the name carried on the suspension record itself */
      var nm = p ? p.tag : (s.playerName || "A player");
      return '<div class="card-b" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;border-top:1px solid var(--line-soft)">'+
        '<b style="font-family:var(--f-disp)">'+esc(nm)+'</b>'+
        '<span class="caption" style="flex:1">'+esc(s.reason||"")+'</span>'+
        '<span class="chip chip-loss">'+(s.mode==="date"?("until "+(s.endsAt?CG.fmtDay(Date.parse(s.endsAt)):"further notice")):s.mode==="seasons"?("through Season "+(s.untilSeason||"—")):(s.games+" game"+(s.games===1?"":"s")))+'</span>'+
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

  /* staff tools — actionable first (tasks, EA triage), then reference (directory, activity) */
  h += CG.staffTasksCard();
  h += CG.staffEaCard();
  h += CG.staffDirectoryCard();
  h += CG.staffActivityCard();

  /* season award ballots — staff vote all season; the commissioner finalizes after the finale */
  var BALLOT_CATS = [
    ["mvp","Most Valuable Player", null],
    ["best_goalie","Best Goaltender", "G"],
    ["best_defenseman","Best Defenseman", "D"],
    ["rookie_of_year","Rookie of the Year", null]
  ];
  var isCommish = CG.role()==="commish";
  h += '<div class="card" style="margin-top:18px"><div class="card-h"><h3>Season award ballots</h3><span class="chip">one vote each</span></div>';
  h += BALLOT_CATS.map(function(cat){
    var pool = (lg.players||[]).filter(function(p){
      if (cat[2]==="G") return p.pos==="G";
      if (cat[2]==="D") return ["LD","RD","D"].indexOf(p.pos)>=0;
      return true;
    }).slice().sort(function(a,b){ return a.tag.localeCompare(b.tag); });
    var opts = '<option value="">— pick a player —</option>'+pool.map(function(p){
      return '<option value="'+p.id+'">'+esc(p.tag)+' · '+esc(p.team)+'</option>'; }).join("");
    var won = (lg.seasonAwards||[]).find(function(a){ return a.category===cat[0]; });
    return '<div class="card-b" style="border-top:1px solid var(--line-soft);display:flex;gap:12px;align-items:center;flex-wrap:wrap">'+
      '<b style="font-family:var(--f-disp);min-width:190px">'+cat[1]+'</b>'+
      (won ? '<span class="chip chip-win">Decided</span><span class="caption" data-ballot-tally="'+cat[0]+'"></span>'
        : '<select data-ballot-cat="'+cat[0]+'" style="padding:6px;max-width:220px" aria-label="Vote for '+cat[1]+'">'+opts+'</select>'+
          '<button class="btn btn-ghost btn-sm" data-ballot-save="'+cat[0]+'">Save vote</button>'+
          '<span class="caption" data-ballot-tally="'+cat[0]+'">counting…</span>'+
          (isCommish?'<button class="btn btn-chrome btn-sm" data-ballot-final="'+cat[0]+'" data-label="'+esc(cat[1])+'" style="margin-left:auto">Finalize</button>':""))+
      '</div>';
  }).join("");
  h += '<div class="card-b" style="border-top:1px solid var(--line)"><span class="caption">Every staff member and commissioner gets one vote per award (change it any time before the finalize). Finalizing tallies the ballots — a tie asks the commissioner to break it — and publishes the winner to the Awards page and the newsroom.</span></div></div>';
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

  CG.wireStaffExtras();

  /* ---- season award ballots ---- */
  var sid = CG.SEASON && CG.SEASON.id;
  if (sid && CG.sb && document.querySelector("[data-ballot-cat],[data-ballot-tally]")){
    var names = {}; (CG.lg._profilesRaw||[]).forEach(function(p){ names[p.id]=p.gamertag||p.display_name||"—"; });
    CG.sb.from("award_ballots").select("category,voter_id,profile_id").eq("season_id", sid).then(function(r){
      var rows = (r&&r.data)||[];
      document.querySelectorAll("[data-ballot-cat]").forEach(function(sel){
        var mine = rows.find(function(x){ return x.category===sel.getAttribute("data-ballot-cat") && x.voter_id===CG.auth.user.id; });
        if (mine) sel.value = mine.profile_id;
      });
      document.querySelectorAll("[data-ballot-tally]").forEach(function(el){
        var cat = el.getAttribute("data-ballot-tally");
        var votes = rows.filter(function(x){ return x.category===cat; });
        if (!votes.length){ el.textContent = "no votes yet"; return; }
        var counts = {}; votes.forEach(function(v){ counts[v.profile_id]=(counts[v.profile_id]||0)+1; });
        var top = Object.keys(counts).sort(function(a,b){ return counts[b]-counts[a]; }).slice(0,3);
        el.textContent = votes.length+" vote"+(votes.length===1?"":"s")+" · leading: "+
          top.map(function(pid){ return (names[pid]||"?")+" ("+counts[pid]+")"; }).join(", ");
      });
    });
  }
  document.querySelectorAll("[data-ballot-save]").forEach(function(b){ b.addEventListener("click", function(){
    var cat=this.getAttribute("data-ballot-save"), btn=this;
    var sel=document.querySelector('[data-ballot-cat="'+cat+'"]');
    if(!sel||!sel.value){ CG.toast("Pick a player first","err"); return; }
    btn.disabled=true;
    CG.sb.from("award_ballots").upsert({ season_id:CG.SEASON.id, category:cat, voter_id:CG.auth.user.id,
      profile_id:sel.value, updated_at:new Date().toISOString() },{ onConflict:"season_id,category,voter_id" })
      .then(function(r){
        btn.disabled=false;
        if(r.error){ CG.toast("Couldn’t save: "+r.error.message,"err"); return; }
        CG.toast("Vote saved — change it any time","ok"); CG.router();
      });
  }); });
  document.querySelectorAll("[data-ballot-final]").forEach(function(b){ b.addEventListener("click", function(){
    var cat=this.getAttribute("data-ballot-final"), label=this.getAttribute("data-label");
    CG.confirm("Finalize "+label+"?",
      "Tallies the staff ballots and publishes the winner to the Awards page and the newsroom. A tied vote stops and asks you to break it. Re-running later corrects the record.",
      "Finalize award", function(){
      CG.sb.rpc("finalize_season_award",{ p_season:CG.SEASON.id, p_category:cat }).then(function(r){
        if(r.error){ CG.toast(r.error.message,"err"); return; }
        CG.toast(String(r.data||"Winner")+" wins "+label,"ok"); CG.reloadLeague();
      });
    });
  }); });
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
/* ================================================================
   RULE 2.5 DEAD CAP — unsigned contracts count against the cap.
   Mirrors public.team_cap_used: an active, non-management contract
   covering this season whose player has no roster spot holds its full
   salary against the club until the player registers. ============= */
CG.deadCapEntries = function(lg, code){
  if (!lg || !lg.live || !lg._contractsRaw) return [];
  var sn = (CG.SEASON && CG.SEASON.number) || 1, rostered = lg._rosteredIds || {}, idToCode = lg._idToCode || {};
  return lg._contractsRaw.filter(function(c){
    return c.status==="active" && !c.is_manager && c.team_id && idToCode[c.team_id]===code &&
           (c.start_season||1)<=sn && (c.end_season||1)>=sn && !rostered[c.profile_id];
  });
};
CG.deadCapFor = function(lg, code){
  return CG.deadCapEntries(lg, code).reduce(function(s,c){ return s+(c.salary||0); },0);
};
/* profile ids under an active team contract this season. A contracted player returns to
   their own club by registering (Rule 2.5), so they must never appear as a free agent or a
   draft prospect — this guards the client pools even if an auto-activation hasn't run yet. */
CG.contractHeldIds = function(){
  var out = {}, sn = (CG.SEASON && CG.SEASON.number) || 1;
  ((CG.lg && CG.lg._contractsRaw) || []).forEach(function(c){
    if (c.status==="active" && !c.is_manager && c.team_id && (c.start_season||1)<=sn && (c.end_season||1)>=sn) out[c.profile_id]=true;
  });
  return out;
};
CG._origTeamPayroll = CG._origTeamPayroll || CG.teamPayroll;
CG.teamPayroll = function(lg, code){
  return CG._origTeamPayroll(lg, code) + ((lg && lg.live) ? CG.deadCapFor(lg, code) : 0);
};
/* Team HQ → Roster: name the dead money so management knows exactly why the number moved */
CG._origHubRoster = CG._origHubRoster || CG.hubRoster;
CG.hubRoster = function(qs){
  var h = CG._origHubRoster(qs);
  var club = CG.myClub && CG.myClub(); if (!club) return h;
  var dead = CG.deadCapEntries(CG.lg, club);
  if (!dead.length) return h;
  var names = dead.map(function(c){
    var pr = ((CG.lg && CG.lg._profilesRaw) || []).find(function(x){ return x.id===c.profile_id; });
    return '<b>'+esc((pr && (pr.gamertag||pr.display_name)) || "A player")+'</b> ('+CG.fmtMoney(c.salary||0)+' through Season '+(c.end_season||"—")+')';
  }).join(", ");
  var note = '<div class="note" style="margin-bottom:18px;display:flex;gap:10px;align-items:flex-start">'+CG.ic("flag",16)+
    '<span><b style="font-family:var(--f-disp)">Dead cap — unsigned contracts.</b> '+names+' — under contract but not yet registered for this season. The salary counts against your cap and they can’t play until they sign up; registering puts them straight back on your roster at no extra cap cost. If the club changes owners first, the deal is voided and the player is suspended for its remaining length (Rule 2.5).</span></div>';
  var anchor = '<span>Salary cap</span></div></div>';
  h = h.indexOf(anchor) > -1 ? h.replace(anchor, anchor + note) : note + h;
  return h.replace('<span>Active payroll</span>', '<span>Payroll + dead cap</span>');
};

CG.AUTOMATIONS = [
  { key:"ea-poll",          name:"EA stats poller",           every:"Every 5 min on game nights (Wed 6pm–Sat 2am ET)", desc:"Pulls finished EA matches and writes scores + box scores." },
  { key:"twitch-live-sync", name:"Twitch live flags",         every:"Every 2 min",  desc:"Flags streaming players LIVE across the site automatically." },
  { key:"discord-sync",     name:"Discord roles & names",     every:"Every 5 min",  desc:"Keeps Discord roles and display names matched to the league database." },
  { key:"discord-welcome",  name:"Discord welcome bot",       every:"Every 5 min",  desc:"Greets new members in #welcome." },
  { key:"discord-scheduler",name:"Discord scheduler",         every:"Every 5 min",  desc:"Posts scheduled league updates to Discord." },
  { key:"rookie-distribution", name:"Rookie placement",       every:"Every 2 min inside the database", desc:"Ten minutes after the draft’s final pick, assigns rookies under the 5-game pre-season minimum to random clubs.", rpc:"distribute_unproven_rookies" },
  { key:"lifecycle-announcements", name:"Lifecycle announcements", every:"Every 5 min inside the database", desc:"Posts registration, pre-season, draft-night, free-agency, puck-drop, and playoff reminders to Discord — each exactly once.", rpc:"announce_lifecycle_guarded" },
  { key:"latecomer-assign", name:"Late sign-up placement",    every:"Every 5 min inside the database", desc:"Places anyone who registered after the eligibility deadline (or joined mid-season) on a club with an open spot.", rpc:"auto_assign_latecomers" },
  { key:"contract-enforcement", name:"Contract sign-up enforcement", every:"Every 15 min inside the database", desc:"After the sign-up deadline: an unsigned contract holds its club’s cap as dead money; if the club changed owners, the deal is voided and the player suspended for its remaining term (Rule 2.5).", rpc:"enforce_unsigned_contracts" },
  { key:"staff-briefing", name:"Staff briefing", every:"Daily inside the database", desc:"Posts the standing backlog (open cases, pending applications, unmatched EA imports, finals missing box scores, active suspensions) to #staff-general — suppressed when nothing needs attention.", rpc:"staff_briefing" },
  { key:"weekly-potw",      name:"Players of the Week",       every:"Mondays inside the database", desc:"Names the week’s best skater and goaltender from the imported box scores, and publishes the announcement.", rpc:"compute_potw_guarded" },
  { key:"watchdog",         name:"Automation watchdog",       every:"Every 15 min inside the database", desc:"Watches every job above — a dead or failing automation pings the commissioners in-app and on Discord.", rpc:"automation_watchdog_guard" }
];
CG.admAutomationsLive = function(){
  var h = '<div style="margin-bottom:16px"><h2 class="h-sec">Automations</h2><p class="lede" style="margin-top:6px">Everything the league runs on its own. Each job also has a <b>Run now</b> for when you don’t want to wait for the next cycle.</p></div>';
  /* staff channel configuration — turns on the staff notifications */
  h += '<div class="card" style="margin-bottom:16px"><div class="card-h"><h3>Staff Discord channels</h3><span class="chip" id="staffChanSt">checking…</span></div>'+
    '<div class="card-b">'+
    '<p class="caption" style="margin-bottom:14px;max-width:74ch">One webhook per staff channel. In Discord: the channel → <b>Edit Channel → Integrations → Webhooks → New Webhook → Copy URL</b>. Each channel below falls back to <b>general</b> until you set it, so nothing is ever lost.</p>'+
    '<label class="fld"><span>Staff general — applications, daily briefing, weekly report</span><input id="staffWh" type="url" placeholder="https://discord.com/api/webhooks/…" autocomplete="off"></label>'+
    '<label class="fld"><span>Staff welcome — the bot’s welcome post for each new staff member</span><input id="staffWhWelcome" type="url" placeholder="https://discord.com/api/webhooks/…" autocomplete="off"></label>'+
    '<label class="fld"><span>Casework &amp; enforcement — cases filed, discipline issued, forfeit rulings</span><input id="staffWhCase" type="url" placeholder="https://discord.com/api/webhooks/…" autocomplete="off"></label>'+
    '<label class="fld"><span>Staff role ID to ping on urgent items (optional)</span><input id="staffRole" placeholder="e.g. 1524970…" autocomplete="off"></label>'+
    '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-chrome btn-sm" id="staffChanSave">Save channels</button>'+
    '<button class="btn btn-ghost btn-sm" id="staffChanTest">Send test to general</button></div>'+
    '<p class="caption" style="margin-top:10px">Saved webhooks are never shown back here — re-paste to change one. A blank field leaves that channel as-is.</p></div></div>';
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
  /* staff channel config */
  var chSt = document.getElementById("staffChanSt");
  if (chSt){
    /* refresh only the status chip — NOT the whole AFTER binder (re-running it would
       re-addEventListener on the same, un-re-rendered buttons and stack duplicate handlers) */
    function refreshChip(){
      CG.sb.rpc("staff_channel_status").then(function(r){
        var d = (r&&!r.error&&r.data)||{};
        var on = [d.configured&&"general", d.welcome&&"welcome", d.casework&&"casework"].filter(Boolean);
        chSt.textContent = on.length ? on.join(" · ")+(d.has_role?" · pings on":"") : "Not set up";
        chSt.className = "chip "+(d.configured?(on.length===3?"chip-win":"chip-chrome"):"chip-warn");
      });
    }
    refreshChip();
    var saveBtn = document.getElementById("staffChanSave");
    if (saveBtn) saveBtn.addEventListener("click", function(){
      var v=function(id){ return (document.getElementById(id).value||"").trim(); };
      var btn=this; btn.disabled=true;
      CG.sb.rpc("set_staff_channels",{ p_general:v("staffWh"), p_welcome:v("staffWhWelcome"),
        p_casework:v("staffWhCase"), p_role_id:v("staffRole") }).then(function(r){
        btn.disabled=false;
        if(r.error){ CG.toast(r.error.message||"Couldn’t save","err"); return; }
        CG.toast("Staff channels saved","ok");
        ["staffWh","staffWhWelcome","staffWhCase","staffRole"].forEach(function(id){ document.getElementById(id).value=""; });
        refreshChip();
      });
    });
    var testBtn = document.getElementById("staffChanTest");
    if (testBtn) testBtn.addEventListener("click", function(){
      var btn=this; btn.disabled=true; btn.textContent="Sending…";
      CG.sb.rpc("staff_channel_test").then(function(r){
        btn.disabled=false; btn.textContent="Send test to general";
        if(r.error){ CG.toast(r.error.message||"Test failed","err"); return; }
        CG.toast(r.data==="sent"?"Test posted to #staff-general":"Set up the webhook first",r.data==="sent"?"ok":"err");
      });
    });
  }
  /* heartbeats + per-run results: each function stamps rl_<key> every run and rl_<key>_result
     with {ok, errCount, lastError}. A run that happened but FAILED shows red, not green. */
  CG.sb.from("app_config").select("key,value").like("key","rl_%").then(function(r){
    var map = {}, results = {};
    ((r&&r.data)||[]).forEach(function(row){
      var k = row.key.replace(/^rl_/,"");
      if (/_result$/.test(k)){
        try { results[k.replace(/_result$/,"")] = JSON.parse(row.value); } catch(e){}
      } else map[k] = row.value;
    });
    CG.AUTOMATIONS.forEach(function(a){
      var ts = map[a.key] ? Date.parse(map[a.key]) : null;
      var stEl = document.getElementById("auto-st-"+a.key), tsEl = document.getElementById("auto-ts-"+a.key);
      if (!stEl) return;
      if (!ts){ stEl.textContent="never ran"; stEl.className="chip chip-warn"; return; }
      var mins = Math.round((Date.now()-ts)/60000);
      tsEl.textContent = mins<1 ? "just now" : mins<60 ? mins+" min ago" : Math.round(mins/60)+" h ago";
      var res = results[a.key];
      var failed = res && res.ok === false;
      var fresh = mins < 30 || (a.key==="ea-poll" && mins < 24*60);  /* ea-poll only runs in the game window */
      if (failed){
        stEl.textContent = "Failing";
        stEl.className = "chip chip-loss";
        stEl.title = res.lastError ? String(res.lastError).slice(0,180) : "last run reported errors";
      } else {
        stEl.textContent = fresh ? "Running" : "Check";
        stEl.className = "chip "+(fresh?"chip-win":"chip-warn");
        stEl.title = "";
      }
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
    /* The newsroom feed only renders rows stamped with the current season, so publishing without
       one would write an article that is invisible the moment it saves. Refuse instead. */
    if (isNew && !(CG.SEASON && CG.SEASON.id)){
      btn.disabled=false; CG.toast("No active season — create one before publishing","err"); return;
    }
    var q = isNew
      ? CG.sb.from("news").insert(Object.assign({}, rec, { author:((CG.auth.profile&&CG.auth.profile.gamertag)||"Commissioner")+" — Commissioner", published_at:new Date().toISOString(), season_id:CG.SEASON.id }))
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
/* The generator anchors each stage on its configured date, but nothing re-checks that afterwards —
   so editing a season date once the games exist leaves the two silently disagreeing. That is exactly
   how the pre-season came to run Sep 23 - Oct 2 while preseason_starts_at said Sep 16, putting half
   of it AFTER draft night and inside free agency, with the 5-game eligibility gate judged on games
   that hadn't been played. Dates are compared as calendar days in league time, never as instants. */
CG.scheduleIssues = function(){
  var lg = CG.lg, s = CG.SEASON, out = [];
  if (!s || !lg || !lg.schedule || !lg.schedule.length) return out;
  var day = function(v){ return v ? CG.etYMD(v) : null; };
  var pre = lg.schedule.filter(function(g){ return g.stage==="preseason"; }).sort(function(a,b){ return a.at-b.at; });
  var reg = lg.schedule.filter(function(g){ return g.stage!=="preseason"; }).sort(function(a,b){ return a.at-b.at; });

  if (pre.length && s.preseason_starts_at && day(pre[0].at) !== day(s.preseason_starts_at))
    out.push("Pre-season opens "+CG.fmtDate(day(pre[0].at))+" but Seasons says "+CG.fmtDate(day(s.preseason_starts_at))+".");
  if (pre.length && s.draft_at && pre[pre.length-1].at >= Date.parse(s.draft_at))
    out.push("Pre-season runs to "+CG.fmtDate(day(pre[pre.length-1].at))+", on or after draft night ("+CG.fmtDate(day(s.draft_at))+"). Clubs would be drafted before their pre-season finished.");
  if (reg.length && s.starts_at && day(reg[0].at) !== day(s.starts_at))
    out.push("The season opens "+CG.fmtDate(day(reg[0].at))+" but Seasons says "+CG.fmtDate(day(s.starts_at))+".");
  if (pre.length && reg.length && pre[pre.length-1].at >= reg[0].at)
    out.push("Pre-season overlaps the regular season.");
  return out;
};
CG.admScheduleLive = function(){
  var lg = CG.lg;
  var pre = lg.schedule.filter(function(g){ return g.stage==="preseason"; });
  var reg = lg.schedule.filter(function(g){ return g.stage!=="preseason"; });
  var issues = CG.scheduleIssues();
  var future = lg.schedule.filter(function(g){ return g.status!=="final"; }).sort(function(a,b){ return a.at-b.at; });
  var h = '<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:16px"><div><h2 class="h-sec">Schedule</h2><p class="lede" style="margin-top:6px">'+
    (lg.schedule.length ? future.length+' games to play. Move any game — the EA auto-import matches by clubs + date, so stats follow a rescheduled game automatically.'
                        : 'No games yet. Generate the pre-season and the regular season from the dates in Seasons, then fine-tune any game time by hand. Weeks touching Christmas, Canada Day, or July 4 are skipped automatically.')+'</p></div>'+
    '<span style="display:inline-flex;gap:8px;align-self:flex-start;flex-wrap:wrap">'+
    (pre.length ? '<button class="btn btn-ghost" id="preClear">Clear pre-season ('+pre.length+')</button>'
                : '<button class="btn btn-ghost" id="preGen">'+CG.ic("plus",15)+'Generate pre-season</button>')+
    (reg.length ? '<button class="btn btn-ghost" id="schedClear">Clear season ('+reg.length+')</button>'
                : '<button class="btn btn-chrome" id="schedGen">'+CG.ic("plus",15)+'Generate season</button>')+'</span></div>';
  if (issues.length)
    h += '<div class="card" style="margin-bottom:16px;border-color:var(--red)"><div class="card-h"><h3>The schedule disagrees with the season dates</h3>'+
      '<span class="chip chip-warn">'+issues.length+' to resolve</span></div><div class="card-b">'+
      '<ul style="margin:0 0 10px;padding-left:20px;display:grid;gap:6px">'+
        issues.map(function(t){ return '<li>'+esc(t)+'</li>'; }).join("")+'</ul>'+
      '<p class="caption">Either correct the dates in Seasons, or clear and regenerate the affected stage — the generator always builds from the dates set there.</p></div></div>';
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
         ["Off-season begins", s.offseason_starts_at?CG.fmtDay(Date.parse(s.offseason_starts_at)):"—"],
         ["Sign-up deadline", s.registration_deadline?CG.fmtDay(Date.parse(s.registration_deadline)):"—"],
         ["Owner apps close", s.owner_app_deadline?CG.fmtDay(Date.parse(s.owner_app_deadline)):"—"],
         ["Roster moves", s.moves_lock_override||"auto"]
        ].map(function(kv){ return '<div class="kpi" style="cursor:default"><b class="num" style="font-size:16px">'+kv[1]+'</b><span>'+kv[0]+'</span></div>'; }).join("")+'</div>'+
      '<div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap"><button class="btn btn-ghost btn-sm" data-season-edit="'+s.id+'">Edit settings</button>'+
      (s.status!=="complete" && (CG._seasonsRaw||[]).some(function(x){ return x.number<s.number && x.status==="complete"; })
        ? '<button class="btn btn-chrome btn-sm" data-season-rollover="'+s.id+'" data-name="'+esc(s.name||("Season "+s.number))+'">Run rollover from last season</button>' : "")+
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
             salary_cap:60000000, roster_max:15, trade_deadline_week:6, moves_lock_override:"auto" };
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
    '<label class="fld"><span>Roster max</span><input id="ssRoster" type="number" min="6" max="30" value="'+(s.roster_max||15)+'"></label>'+
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
      salary_cap:cap, roster_max:parseInt(document.getElementById("ssRoster").value,10)||15,
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
  document.querySelectorAll("[data-season-rollover]").forEach(function(b){ b.addEventListener("click", function(){
    var id=this.getAttribute("data-season-rollover"), name=this.getAttribute("data-name");
    CG.confirm("Run the rollover into "+name+"?",
      "Contracts that ended with the previous season expire. Multi-year deals no longer auto-fill rosters: every player must sign up again (Rule 2.5) — registering puts them straight back on their club, and until then their salary holds cap space as dead money. After the sign-up deadline, clubs whose ownership changed have their unsigned deals voided and those players suspended for the remaining term. From Season 2 on, this also ends the role-separation grandfathering. Safe to re-run; it only fills gaps.",
      "Run rollover", function(){
      CG.sb.rpc("start_next_season",{ p_new_season:id }).then(function(r){
        if(r.error){ CG.toast("Rollover failed: "+r.error.message,"err"); return; }
        var d=r.data||{};
        CG.toast("Rollover done — "+(d.expired||0)+" expired · "+(d.activated||0)+" activated · "+(d.holds||0)+" awaiting sign-up","ok");
        CG.reloadLeague();
      });
    });
  }); });
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
  if (param==="draft") return CG.adminShell("draft", CG.admDraftLive());
  if (param==="codes") return CG.adminShell("codes", CG.admCodesLive());
  if (param==="audit") return CG.adminShell("audit", CG.admAuditLive());
  /* retired prototype panels — their buttons toasted success while saving nothing real:
     awards (awards program is DB-driven), carousel/media/settings/data (localStorage-only),
     rulebook editor (content ships versioned through the repo) */
  if (["awards","carousel","media","settings","data","rulebook"].indexOf(param)>=0) return CG.ROUTES._404();
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
  if (param==="draft"){ CG.AFTER._admDraft(); return; }
  if (param==="codes"){ return; }
  if (param==="audit"){ CG.AFTER._admAudit(); return; }
  if (param==="" || param==null){ return; }
  if (CG._origAdminAfter) CG._origAdminAfter(param, qs);
};

/* ---- Game codes: the real 6-digit lobby codes on tonight's + upcoming games ---- */
CG.admCodesLive = function(){
  var lg = CG.lg;
  var up = lg.schedule.filter(function(g){ return g.status!=="final"; }).sort(function(a,b){ return a.at-b.at; });
  var tonightKey = up.length ? CG.etYMD(new Date(up[0].at).toISOString()) : null;
  var tonight = up.filter(function(g){ return CG.etYMD(new Date(g.at).toISOString())===tonightKey; }).slice(0,12);
  var h='<div style="margin-bottom:16px"><h2 class="h-sec">Game codes</h2><p class="lede" style="margin-top:6px">Every game carries a stable 6-digit private-lobby code, minted when the schedule is generated. Rostered players see their game’s code on the matchup page 30 minutes before puck drop — this table is the commissioner’s master list.</p></div>';
  h+='<div class="card"><div class="card-h"><h3>'+(tonight.length?'Next game night — '+CG.fmtDay(tonight[0].at):'Upcoming games')+'</h3><span class="chip">'+(tonight.length||up.slice(0,12).length)+' games</span></div>'+
    '<div class="tblwrap"><table class="tbl keepcols"><caption>Lobby codes</caption><thead><tr><th class="tleft">When (ET)</th><th class="tleft">Matchup</th><th>Stage</th><th>Code</th></tr></thead><tbody>'+
    (tonight.length?tonight:up.slice(0,12)).map(function(g){
      return '<tr><td class="tleft mono" style="font-size:12px">'+CG.fmtFull(g.at)+'</td>'+
        '<td class="tleft"><span class="teamcell">'+CG.crest(g.away,20)+'<span class="mono" style="font-size:12px">'+esc(g.away)+'</span></span> <span class="caption">@</span> <span class="teamcell">'+CG.crest(g.home,20)+'<span class="mono" style="font-size:12px">'+esc(g.home)+'</span></span></td>'+
        '<td>'+(g.stage==="preseason"?'<span class="chip" style="font-size:9px">PRE</span>':g.stage==="playoff"?'<span class="chip chip-chrome" style="font-size:9px">PO</span>':'<span class="chip" style="font-size:9px">REG</span>')+'</td>'+
        '<td class="tnum"><b class="mono" style="font-size:15px;letter-spacing:.12em">'+esc(g.code||"—")+'</b></td></tr>';
    }).join("")+'</tbody></table></div>'+
    '<div class="card-b" style="border-top:1px solid var(--line)"><span class="caption">Codes are stable — rescheduling a game keeps its code. Players only ever see their own game’s code, and only from 30 minutes before puck drop (Rule 4.2).</span></div></div>';
  return h;
};

/* ---- Audit log: the real admin_audit table (role changes, forfeits, rollovers, violations) ---- */
CG.admAuditLive = function(){
  return '<div style="margin-bottom:16px"><h2 class="h-sec">Audit log</h2><p class="lede" style="margin-top:6px">Every privileged action the league takes — role changes, forfeits, re-opened finals, rollovers, and rule-violation flags — recorded permanently. Insert-only: nothing here can be edited or deleted.</p></div>'+
    '<div class="card"><div class="card-h"><h3>Recent actions</h3><span class="chip" id="audCount">loading…</span></div><div id="audBody"><div class="card-b"><span class="caption">Loading…</span></div></div></div>';
};
CG.AFTER._admAudit = function(){
  var body=document.getElementById("audBody"), count=document.getElementById("audCount");
  if (!body || !CG.sb) return;
  CG.sb.from("admin_audit").select("action,target_type,target_id,detail,created_at,actor")
    .order("created_at",{ascending:false}).limit(50).then(function(r){
    if (r.error){ body.innerHTML='<div class="card-b"><span class="caption">Couldn’t read the log: '+esc(r.error.message)+'</span></div>'; if(count)count.textContent="—"; return; }
    var rows=r.data||[];
    if (count) count.textContent = rows.length ? rows.length+" shown" : "empty";
    if (!rows.length){ body.innerHTML='<div class="card-b"><p class="caption">No privileged actions recorded yet — they start landing here the first time a role changes, a forfeit is declared, or a final is re-opened.</p></div>'; return; }
    var names={}; (CG.lg._profilesRaw||[]).forEach(function(p){ names[p.id]=p.gamertag||p.display_name||"—"; });
    body.innerHTML = rows.map(function(x){
      var label = { role_change:"Role change", reopen_final:"Final re-opened", season_rollover:"Season rollover",
        playoff_violation_30pct:"Playoff eligibility flag", playoff_violation_series_cap:"Series-cap flag" }[x.action] || x.action;
      var det = x.detail ? Object.keys(x.detail).map(function(k){ return k+": "+String(x.detail[k]); }).join(" · ") : "";
      return '<div class="notif" style="cursor:default"><span class="nf-ic">'+CG.ic("eye",15)+'</span>'+
        '<span style="min-width:0"><b>'+esc(label)+(x.actor&&names[x.actor]?' — '+esc(names[x.actor]):"")+'</b><p>'+esc(det||(x.target_type+" "+(x.target_id||"")))+'</p></span>'+
        '<span class="nf-t">'+CG.fmtFull(Date.parse(x.created_at))+'</span></div>';
    }).join("");
  });
};

/* ================================================================
   TEAM HQ: SCHEDULE DESK — the club's game nights with server picks
   (game_vetoes), lobby codes, and the resolved server. Servers stay
   unset until 30 minutes before the night's FIRST puck drop.
   ================================================================ */
CG.hubScheduleLive = function(){
  var me = CG.me(), lg = CG.lg;
  var club = CG.myClub(), t = CG.TEAM[club];
  if (!me || !t) return '<div class="note">This account doesn’t run a club — the schedule desk belongs to club management.</div>';
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
  if (param==="draft"){
    return CG.can("roster.manage") ? CG.hubShell("draft", CG.hubDraftLive())
      : CG.unauthorized("The draft desk is a team-management tool.");
  }
  if (param==="freeagents"){
    return CG.can("roster.manage") ? CG.hubShell("freeagents", CG.hubFreeAgents())
      : CG.unauthorized("The free-agent board is a team-management tool.");
  }
  if (param==="application"){
    if (CG.role()!=="staff" && CG.role()!=="commish") return CG.unauthorized("Applications are reviewed by league staff.");
    return CG.hubShell("staffdesk", CG.hubApplicationDetail(qs.id, qs.type==="owner"?"owner":"staff"));
  }
  if (param==="archive"){
    if (CG.role()!=="staff" && CG.role()!=="commish") return CG.unauthorized("The ticket archive is for league staff.");
    return CG.hubShell("staffdesk", CG.hubTicketArchive());
  }
  return CG._origHubRoute(param, qs);
};
CG._origHubAfter = CG.AFTER.hub;
CG.AFTER.hub = function(param, qs){
  if (param==="messages"){ CG.AFTER.messages(); return; }
  if (param==="draft"){ CG.AFTER._hubDraft(); return; }
  if (param==="freeagents"){ CG.AFTER._hubFreeAgents(); return; }
  if (param==="application"){ CG.AFTER._applicationDetail(); return; }
  if (param==="archive"){ CG.AFTER._ticketArchive(); return; }
  var hubEa=document.getElementById("hubEaBtn"); if(hubEa) hubEa.addEventListener("click", CG.promptEaId);
  var so=document.getElementById("setSignOut"); if(so) so.addEventListener("click", function(){ CG.signOut(); });
  var sl=document.getElementById("sSaveLive");
  if (sl) sl.addEventListener("click", function(){
    var ea=(document.getElementById("sEaLive").value||"").trim(), plat=document.getElementById("sPlatLive").value;
    if (ea && ea.length<2){ CG.toast("EA ID looks too short","err"); return; }
    CG.sb.from("profiles").update({ ea_id:ea||null, platform:plat||null }).eq("id",CG.auth.user.id).then(function(r){
      if(r.error){ CG.toast("Couldn’t save: "+r.error.message,"err"); return; }
      CG.auth.profile.ea_id=ea||null; CG.auth.profile.platform=plat||null;
      CG.toast("Profile saved","ok");
    });
  });
  if (CG._origHubAfter) CG._origHubAfter(param, qs);
};
CG._wrapHubDashboard();   /* part6 is loaded by now — install the onboarding dashboard */

/* Settings — the live version writes to the real profile; the prototype's placebo privacy
   toggles and demo-seat card are gone. Theme picker keeps part6's markup + wiring. */
CG.hubSettings = function(){
  var p = CG.auth.profile || {}, tp = CG.themePref();
  return '<div style="margin-bottom:20px"><span class="eyebrow chr">Account</span><h1 class="h-sec" style="margin-top:8px">Settings</h1></div>'+
    '<div class="card" style="margin-bottom:18px"><div class="card-h"><h3>Appearance</h3><span class="chip">'+(tp==="auto"?"Following your system":"Set manually")+'</span></div>'+
    '<div class="card-b"><div class="radio-cards" role="radiogroup" aria-label="Theme">'+
    [["light","Light","Fresh Sheet — the ice-white editorial look"],["dark","Dark","Night Game — broadcast charcoal"],["auto","Auto","Follows your device setting"]].map(function(o){
      return '<label class="'+(tp===o[0]?"on":"")+'" data-theme-pick="'+o[0]+'" style="flex-direction:column;align-items:flex-start;gap:3px">'+
        '<input type="radio" name="themePref"'+(tp===o[0]?" checked":"")+'><b>'+o[1]+'</b><span class="caption" style="text-transform:none;letter-spacing:0">'+o[2]+'</span></label>';
    }).join("")+'</div>'+
    '<p class="caption" style="margin-top:12px">Applies instantly on this device.</p></div></div>'+
    '<div class="grid g2" style="align-items:start"><div class="card"><div class="card-h"><h3>League profile</h3></div><div class="card-b">'+
    '<label class="fld"><span>Display name / gamertag</span><input value="'+esc(p.gamertag||p.display_name||"")+'" readonly style="background:var(--ice);color:var(--steel)">'+
    '<span class="hint">Synced automatically from your Discord display name every few minutes — change it there and it flows here.</span></label>'+
    '<label class="fld"><span>EA ID</span><input id="sEaLive" value="'+esc(p.ea_id||"")+'"><span class="hint">Used to link your EA box scores to your profile — required to register.</span></label>'+
    '<label class="fld"><span>Platform</span><select id="sPlatLive">'+["","PS5","XSX","PC"].map(function(x){ return '<option value="'+x+'"'+((p.platform||"")===x?" selected":"")+'>'+(x||"—")+'</option>'; }).join("")+'</select></label>'+
    '<button class="btn btn-ink" id="sSaveLive">Save profile</button></div></div>'+
    '<div class="stack"><div class="card"><div class="card-h"><h3>Your data</h3></div><div class="card-b">'+
    '<p class="small" style="color:var(--steel)">The league stores your Discord identity (id, username, avatar), your EA ID and platform, your registrations and availability, and the stats you generate in league games. Discord passes your email to our sign-in provider, but the league never uses or displays it; availability is visible only to your club’s management and league staff.</p>'+
    '<p class="small" style="color:var(--steel);margin-top:10px">Read the <a href="#/legal" style="font-weight:700;border-bottom:2px solid var(--chrome)">Terms &amp; Privacy</a>. To delete your account and data, message any commissioner from <a href="#/hub/messages" style="font-weight:700;border-bottom:2px solid var(--chrome)">Messages</a> — deletion covers everything except the league’s permanent game record (box scores keep your gamertag).</p>'+
    '</div></div>'+
    '<div class="card"><div class="card-h"><h3>Session</h3></div><div class="card-b"><p class="small" style="color:var(--steel)">Signed in with Discord as <b>'+esc(p.gamertag||p.display_name||"—")+'</b>.</p>'+
    '<button class="btn btn-ghost btn-sm" style="margin-top:12px" id="setSignOut">'+CG.ic("back",14)+'Sign out</button></div></div></div></div>';
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
  if (!t) return '<div class="note">This account doesn’t run a club — the free-agent board belongs to club management.</div>';
  var faO = s.free_agency_opens_at ? Date.parse(s.free_agency_opens_at) : null;
  var faC = s.free_agency_closes_at ? Date.parse(s.free_agency_closes_at) : null;
  var nowMs = Date.now();
  var canSign = !!(faO && nowMs >= faO);   /* signable during the window and after it, never before */
  var winChip = !faO ? '<span class="chip chip-warn">No free-agency dates set yet</span>'
    : nowMs < faO ? '<span class="chip chip-warn">Opens '+CG.fmtFull(faO)+'</span>'
    : (faC && nowMs < faC) ? '<span class="chip chip-live"><span class="live-dot"></span>Window open — closes '+CG.fmtFull(faC)+'</span>'
    : '<span class="chip chip-win">Window closed — free agents stay signable</span>';
  var rosterN=(lg.byTeam[t.code]||[]).length, rosterMax=s.roster_max||15;
  var rosteredIds=lg._rosteredIds||{}, faHeld=CG.contractHeldIds();
  var pool=(lg._registrationsRaw||[]).filter(function(r){
    return (!r.season_id || r.season_id===s.id) && r.status!=="declined" && !rosteredIds[r.profile_id] && !faHeld[r.profile_id] &&
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
    var used=t?CG.teamPayroll(CG.lg, t.code):0;   /* includes unsigned-contract dead cap (Rule 2.5) */
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
  var h='<div style="margin-bottom:18px"><span class="eyebrow chr">'+esc(t.name)+' · club management</span>'+
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
        ["draft","Draft manager","play"],
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
        ["ratings","Overall ratings","chart"]
      ]],
      ["Content", [
        ["news","Newsroom","doc"],
        ["homepage","Homepage","grid"]
      ]],
      ["System", [
        ["automations","Automations","clock"],
        ["audit","Audit log","eye"]
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
  /* land back where the user was before the OAuth round-trip (stashed by CG.signIn just
     before redirecting; consumed only within 10 minutes so a stale stash can't hijack boot) */
  var ret = null;
  try {
    var raw = localStorage.getItem("cg_return");
    if (raw){ localStorage.removeItem("cg_return"); var o = JSON.parse(raw);
      if (o && o.h && o.h.indexOf("#/")===0 && Date.now()-(o.at||0) < 10*60000) ret = o.h; }
  } catch(e){}
  if (ret && (!location.hash || location.hash==="#/home")) location.hash = ret;
  if (!location.hash) location.hash = "#/home";
  CG.router();
};

if (document.readyState === "loading")
  document.addEventListener("DOMContentLoaded", function(){ CG.bootLive(); });
else
  CG.bootLive();
