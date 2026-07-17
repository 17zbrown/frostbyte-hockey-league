/* ================================================================
   PUBLIC PAGES I — home, schedule, standings, teams, players, stats
   ================================================================ */

/* ---------- shared page builders ---------- */
CG.pageHead = function(eyebrow, title, lede, right){
  return '<section class="sec-tight"><div class="shell"><div class="sec-head"><div class="lead">'+
    '<span class="eyebrow chr">'+esc(eyebrow)+'</span><h1 class="h-page" style="margin-top:10px">'+title+'</h1>'+
    (lede?'<p class="lede" style="margin-top:10px">'+lede+'</p>':"")+
    '</div>'+(right||"")+'</div></div></section>';
};
/* ---- Twitch (ported from the classic site): profiles.twitch + profiles.live ----
   Twitch purple is used ONLY on Twitch elements (brand use), never as site color. */
CG.TWITCH_PURPLE = "#9146ff";
CG.liveStreamers = function(g){
  /* rostered players on either club who are flagged live with a handle */
  return CG.lg.players.filter(function(p){
    return (p.team===g.home || p.team===g.away) && p.twitchLive && p.twitch;
  });
};
CG.twitchChip = function(p, dark){
  return '<a class="chip" target="_blank" rel="noopener" href="https://twitch.tv/'+encodeURIComponent(p.twitch)+'" '+
    'style="background:'+CG.TWITCH_PURPLE+';border-color:'+CG.TWITCH_PURPLE+';color:#fff" '+
    'onclick="event.stopPropagation()" aria-label="Watch '+esc(p.tag)+' on Twitch">'+
    '<span class="live-dot"></span>'+esc(p.tag)+'</a>';
};
CG.setTwitchLive = function(on){
  if (!CG.LIVE_MODE || !CG.sb || !CG.auth.user){ CG.toast("Sign in first","err"); return; }
  CG.sb.from("profiles").update({ live: on }).eq("id", CG.auth.user.id).then(function(r){
    if (r.error){ CG.toast("Couldn’t update: "+r.error.message,"err"); return; }
    if (CG.auth.profile) CG.auth.profile.live = on;
    var me = CG.lg.players.find(function(x){ return x.id===CG.auth.user.id; });
    if (me) me.twitchLive = on;
    CG.toast(on ? "You’re flagged LIVE — your profile and game cards show it" : "Stream ended","ok");
    CG.router();
  });
};
CG.setTwitchHandle = function(){
  if (!CG.LIVE_MODE || !CG.sb || !CG.auth.user){ CG.toast("Sign in first","err"); return; }
  var me = CG.lg.players.find(function(x){ return x.id===CG.auth.user.id; });
  var cur = (me && me.twitch) || (CG.auth.profile && CG.auth.profile.twitch) || "";
  CG.modal("Twitch channel",
    '<label class="fld"><span>Your Twitch handle</span><input id="twHandle" value="'+esc(cur)+'" placeholder="e.g. zackbrown17" maxlength="40"></label>'+
    '<p class="caption">Shown on your profile and flagged on game cards when you go live. Handle only — not the full URL.</p>',
    '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-chrome" id="twSave">Save</button>');
  document.getElementById("twSave").addEventListener("click", function(){
    var h = (document.getElementById("twHandle").value||"").trim().replace(/^@|.*twitch\.tv\//i,"");
    var patch = h ? { twitch: h } : { twitch: null, live: false };
    CG.sb.from("profiles").update(patch).eq("id", CG.auth.user.id).then(function(r){
      if (r.error){ CG.toast("Couldn’t save: "+r.error.message,"err"); return; }
      if (CG.auth.profile) CG.auth.profile.twitch = h||null;
      if (me) me.twitch = h||null;
      if (CG.closeOverlay) CG.closeOverlay();
      CG.toast(h ? "Twitch channel saved" : "Twitch channel removed","ok");
      CG.router();
    });
  });
};

CG.standRows = function(div, opts){
  opts = opts||{};
  var rows = CG.standings(CG.lg, div);
  return rows.map(function(r, i){
    var cut = opts.cutline && i===2;  /* top 3 per division qualify (Rule 8.1) */
    return '<tr class="rowlink'+(cut?" cutline":"")+'" style="--tc:'+r.team.color+'" data-go="#/team/'+r.code+'">'+
      '<td><span class="rankn num">'+(i+1)+'</span></td>'+
      '<td class="tleft"><span class="teamcell">'+CG.crest(r.code,26)+'<span><span class="nm">'+esc(r.team.name)+'</span><small>'+r.team.div+' Division</small></span></span></td>'+
      '<td data-v="'+r.gp+'">'+r.gp+'</td><td data-v="'+r.w+'">'+r.w+'</td><td data-v="'+r.l+'">'+r.l+'</td><td data-v="'+r.otl+'">'+r.otl+'</td>'+
      (opts.full?'<td data-v="'+r.gf+'">'+r.gf+'</td><td data-v="'+r.ga+'">'+r.ga+'</td>':"")+
      '<td data-v="'+r.diff+'" style="color:'+(r.diff>0?"var(--green)":r.diff<0?"var(--red)":"inherit")+'">'+(r.diff>0?"+":"")+r.diff+'</td>'+
      (opts.full?'<td>'+CG.form5(r.last5)+'</td><td>'+esc(r.streak)+'</td>':"")+
      '<td class="pts" data-v="'+r.pts+'">'+r.pts+'</td></tr>';
  }).join("");
};
CG.standTable = function(div, opts){
  opts = opts||{};
  var cols = '<th>#</th><th class="tleft">Club</th><th title="Games played">GP</th><th title="Wins">W</th><th title="Losses">L</th><th title="Overtime losses">OTL</th>'+
    (opts.full?'<th title="Goals for">GF</th><th title="Goals against">GA</th>':"")+
    '<th title="Goal differential">DIFF</th>'+
    (opts.full?'<th title="Last five games">L5</th><th title="Streak">STRK</th>':"")+
    '<th title="Points: 2 per win, 1 per OT loss">PTS</th>';
  return '<div class="tblwrap"><table class="tbl'+(opts.keepcols?" keepcols":"")+(opts.compact?" compact":"")+'">'+
    (opts.caption?'<caption class="'+(opts.srCaption?"sr":"")+'">'+esc(opts.caption)+'</caption>':"")+
    '<thead><tr>'+cols+'</tr></thead><tbody>'+CG.standRows(div,opts)+'</tbody></table></div>';
};
CG.gameCard = function(g){
  var lg = CG.lg;
  var res = (lg.allResults||lg.results).find(function(r){ return r.id===g.id; });
  var tag;
  if (res) tag = '<span class="chip">'+ (res.ot?"Final / OT":"Final") +'</span>';
  else if (Math.abs(g.at - CG.now()) < 10*3600000 && g.at > CG.now()) tag = '<span class="chip chip-live"><span class="live-dot"></span>Tonight</span>';
  else if (g.at < CG.now()) tag = '<span class="chip chip-warn">Awaiting result</span>';
  else tag = '<span class="chip">'+(g.stage==="preseason"?"Pre-season · Wk "+g.week:g.stage==="playoff"?"Playoffs · Wk "+g.week:"Week "+g.week)+'</span>';
  return '<div class="gamecard" data-go="#/matchup/'+g.id+'" role="link" tabindex="0">'+
    '<div class="gc-when"><b>'+CG.fmtDay(g.at).split(",")[0]+'</b><span>'+CG.fmtTime(g.at)+'</span></div>'+
    '<div class="gc-match">'+CG.crest(g.away,26)+esc(CG.TEAM[g.away].name)+
      (res?'<span class="gc-score num">'+res.score[g.away]+'</span>':"")+
      '<span class="at">'+(res?"—":"@")+'</span>'+
      (res?'<span class="gc-score num">'+res.score[g.home]+'</span>':"")+
      CG.crest(g.home,26)+esc(CG.TEAM[g.home].name)+'</div>'+
    '<span class="gc-tag">'+tag+'</span></div>';
};

/* ---------- HOME ---------- */
/* pre-season = no games played yet; drives the "season hasn't started" framing on
   the live site. The prototype build has 48 simulated results, so this is false there. */
CG.isPreseason = function(){ return !!(CG.lg && CG.lg.results && CG.lg.results.length===0); };
/* transaction descriptions carry <b> emphasis written by the DB — escape everything else */
CG.txText = function(s){ return esc(String(s||"")).replace(/&lt;b&gt;/g,"<b>").replace(/&lt;\/b&gt;/g,"</b>"); };
CG.seasonStartMs = function(){ var s=CG.SEASON||(CG.lg&&CG.lg.season); return s&&s.starts_at?Date.parse(s.starts_at):null; };
CG.daysToStart = function(){ var m=CG.seasonStartMs(); return m?Math.max(0,Math.ceil((m-CG.now())/86400000)):null; };
CG.slideDefs = function(){
  var lg = CG.lg, C = CG.CONTENT;
  if (CG.isPreseason()){
    var start = CG.seasonStartMs(), days = CG.daysToStart(), slides = [];
    var startTxt = start ? CG.fmtDate(new Date(start).toISOString()) : "soon";
    var sNum = (CG.SEASON&&CG.SEASON.number)||1;
    var regOpen = CG.SEASON && CG.SEASON.registration_open;
    slides.push({ key:"kickoff", label:CG.seasonTag(), html:
      '<span class="s-cat"><span class="chip chip-chrome">'+esc(CG.seasonTag())+(sNum===1?' · Inaugural':'')+'</span></span>'+
      '<h2>The puck drops '+startTxt+'.</h2>'+
      '<p class="s-dek">'+(days!=null?days+' day'+(days===1?"":"s")+' out. ':"")+CG.TEAMS.length+' clubs, '+((CG.DIVISIONS&&CG.DIVISIONS.length)||2)+' divisions — '+(sNum===1?'Chel Gaming’s first competitive season':esc(CG.seasonTag())+' of Chel Gaming hockey')+'. '+
      (regOpen?'Registration is open — claim your spot before the draft.':'Rosters take shape through the pre-season and the draft.')+'</p>'+
      '<div class="s-cta">'+(regOpen?'<a class="btn btn-chrome" href="#/register">Register to play</a><a class="btn btn-ghost" href="#/schedule">Opening schedule</a>'
        :'<a class="btn btn-chrome" href="#/schedule">Opening schedule</a><a class="btn btn-ghost" href="#/teams">The clubs</a>')+'</div>'+
      '<span class="s-date">Season opens '+startTxt+'</span>' });
    slides.push({ key:"clubs", label:"The clubs", html:
      '<span class="s-cat"><span class="chip chip-chrome">'+CG.TEAMS.length+' founding clubs</span></span>'+
      '<h2>Meet the founding eight.</h2>'+
      '<p class="s-dek">Two divisions, real rosters, real management under a $'+Math.round((CG.CAP||60000000)/1000000)+'M cap. Explore each club and its cap sheet.</p>'+
      '<div class="s-cta"><a class="btn btn-chrome" href="#/teams">Browse clubs</a>'+
      '<a class="btn btn-ghost" href="#/players">Player directory</a></div>'+
      '<span class="s-date">'+esc(CG.seasonTag())+' · '+CG.seasonYear()+'</span>' });
    slides.push({ key:"howitworks", label:"How it works", html:
      '<span class="s-cat"><span class="chip chip-chrome">The format</span></span>'+
      '<h2>6v6 EA NHL, run like a real league.</h2>'+
      '<p class="s-dek">Salary caps and contracts, weekly availability and lineups, verified stats, and a live rulebook. Everything below is built out and ready for opening night.</p>'+
      '<div class="s-cta"><a class="btn btn-chrome" href="#/rulebook">The rulebook</a></div>'+
      '<span class="s-date">Chel Gaming Hockey League</span>' });
    var cfgP = CG.store.get("slides")||{};
    return slides.filter(function(s){ return !(cfgP[s.key]&&cfgP[s.key].off); });
  }
  var feat = lg.tonight.find(function(g){ return g.feature; });
  var a1 = C.articles.find(function(a){ return a.featured; }) || C.articles[0];
  var potw = lg.potw[lg.potw.length-1];
  var sk = potw ? CG.playerById(lg, potw.skater) : null;
  var divLeaders = (CG.DIVISIONS||["East","West"]).map(function(dv){ return CG.standings(lg,dv)[0]; }).filter(Boolean);
  var curWeek = lg.results.reduce(function(m,r){ return Math.max(m, r.week||1); }, 1);
  var slides = [];
  if (a1) slides.push({ key:"news", label:"Breaking news", html:
    '<span class="s-cat"><span class="chip chip-chrome">League news</span></span>'+
    '<h2>'+esc(a1.title)+'</h2><p class="s-dek">'+esc(a1.excerpt)+'</p>'+
    '<div class="s-cta"><a class="btn btn-chrome" href="#/article/'+a1.slug+'">Read the story</a>'+
    '<a class="btn btn-ghost" href="#/news">All news</a></div>'+
    '<span class="s-date">'+CG.fmtDate(a1.dateIso)+' · '+esc(a1.author)+'</span>' });
  if (feat){
    var frh = lg.teams[feat.home], fra = lg.teams[feat.away];
    slides.push({ key:"matchup", label:"Featured matchup", html:
      '<span class="s-cat"><span class="chip chip-live"><span class="live-dot"></span>Tonight · '+(feat.stage==="preseason"?"Pre-season week ":feat.stage==="playoff"?"Playoffs · Round ":"Week ")+feat.week+'</span></span>'+
      '<h2>'+esc(CG.TEAM[feat.away].name)+' at '+esc(CG.TEAM[feat.home].name)+'</h2>'+
      '<p class="s-dek">'+esc(CG.TEAM[feat.away].name)+' ('+fra.w+'-'+fra.l+'-'+fra.otl+') visit '+esc(CG.TEAM[feat.home].name)+' ('+frh.w+'-'+frh.l+'-'+frh.otl+') in tonight’s marquee. Lineups release an hour before puck drop.</p>'+
      '<div class="s-cta"><a class="btn btn-chrome" href="#/matchup/'+feat.id+'">Matchup center</a>'+
      '<a class="btn btn-ghost" href="#/schedule">Tonight’s slate</a></div>'+
      '<span class="s-date">Puck drop '+CG.fmtTime(feat.at)+'</span>' });
  }
  if (potw && sk) slides.push({ key:"potw", label:"Player of the Week", html:
    '<span class="s-cat"><span class="chip chip-chrome">Player of the Week '+potw.week+'</span></span>'+
    '<h2>'+esc(sk.tag)+'</h2>'+
    '<p class="s-dek">'+esc(potw.blurb || (sk.tag+" takes Week "+potw.week+"’s honors for "+CG.TEAM[sk.team].name+"."))+'</p>'+
    '<div class="s-cta"><a class="btn btn-chrome" href="'+CG.playerRoute(sk)+'">Player profile</a>'+
    '<a class="btn btn-ghost" href="#/awards">Award history</a></div>'+
    '<span class="s-date">'+esc(CG.TEAM[sk.team].name)+' · '+sk.pos+'</span>' });
  if ((lg.powerRankings||[]).length){
    var pr1 = lg.powerRankings[0], pr1t = CG.TEAM[pr1.team];
    slides.push({ key:"rankings", label:"Power Rankings", html:
      '<span class="s-cat"><span class="chip chip-chrome">Week '+curWeek+' Power Rankings</span></span>'+
      '<h2>'+esc(pr1t?pr1t.name:"The top club")+' holds the top spot.</h2>'+
      '<p class="s-dek">Computed fresh from results — record, goal share, and recent form, re-ranked after every final.</p>'+
      '<div class="s-cta"><a class="btn btn-chrome" href="#/rankings">Full rankings</a></div>'+
      '<span class="s-date">Updated after the latest finals · CGHL Wire</span>' });
  }
  if (divLeaders.length) slides.push({ key:"standings", label:"Standings snapshot", html:
    '<span class="s-cat"><span class="chip chip-chrome">Standings · Week '+curWeek+'</span></span>'+
    '<h2>'+divLeaders.map(function(l){ return esc(l.team.name); }).join(divLeaders.length===2?" and ":", ")+' set'+(divLeaders.length===1?"s":"")+' the pace.</h2>'+
    '<p class="s-dek">'+divLeaders.map(function(l){ return esc(l.team.name)+' ('+l.w+"-"+l.l+"-"+l.otl+')'; }).join(" · ")+'. Three playoff spots per division — the cutlines are already forming.</p>'+
    '<div class="s-cta"><a class="btn btn-chrome" href="#/standings">Full standings</a></div>'+
    '<span class="s-date">Updated after last night’s finals</span>' });
  /* admin overrides: hide/reorder */
  var cfg = CG.store.get("slides")||{};
  slides = slides.filter(function(s){ return !(cfg[s.key]&&cfg[s.key].off); });
  slides.sort(function(a,b){ return ((cfg[a.key]||{}).ord||0) - ((cfg[b.key]||{}).ord||0); });
  return slides;
};
CG.HOMEMODS = [
  { key:"tonight",   label:"Tonight’s Games" },
  { key:"standings", label:"League Standings" },
  { key:"leaders",   label:"Statistical Leaders" },
  { key:"video",     label:"Intermission Report (video)" },
  { key:"news",      label:"Latest News" },
  { key:"honors",    label:"Three Stars & Weekly Honors" },
  { key:"deadlines", label:"League Deadlines" }
];
CG.modOn = function(key){
  var cfg = CG.store.get("modules")||{};
  return !(cfg[key]&&cfg[key].off);
};
CG.ROUTES.home = function(){
  var lg = CG.lg, C = CG.CONTENT;
  var pre = CG.isPreseason();
  var html = "";
  /* free-agency countdown — pinned to the top of the front page while the window is open */
  var faO = CG.SEASON && CG.SEASON.free_agency_opens_at ? Date.parse(CG.SEASON.free_agency_opens_at) : null;
  var faC = CG.SEASON && CG.SEASON.free_agency_closes_at ? Date.parse(CG.SEASON.free_agency_closes_at) : null;
  if (faO && faC && Date.now() >= faO && Date.now() < faC){
    html += '<section style="background:var(--bc);border-bottom:2px solid var(--chrome)"><div class="shell" style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:13px 0">'+
      '<span class="chip chip-live"><span class="live-dot"></span>Free agency is open</span>'+
      '<span style="color:var(--on-ink-dim);font-size:13px">Clubs can sign free agents until '+CG.fmtFull(faC)+'</span>'+
      '<span style="margin-left:auto;display:inline-flex;align-items:baseline;gap:9px"><span class="eyebrow" style="color:var(--on-ink-dim)">Closes in</span>'+
      '<b id="faCountdown" class="num" data-close="'+faC+'" style="font-family:var(--f-disp);font-size:24px;line-height:1;color:#fff;font-variant-numeric:tabular-nums">—</b></span>'+
    '</div></section>';
  }
  /* registration countdown — pinned while sign-ups are open ahead of the eligibility deadline */
  var regDl = CG.SEASON && CG.SEASON.registration_deadline ? Date.parse(CG.SEASON.registration_deadline) : null;
  if (CG.SEASON && CG.SEASON.registration_open && regDl && Date.now() < regDl && !(faO && faC && Date.now() >= faO && Date.now() < faC)){
    html += '<section style="background:var(--bc);border-bottom:2px solid var(--chrome)"><div class="shell" style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:13px 0">'+
      '<span class="chip chip-chrome">'+esc(CG.seasonTag())+' registration is open</span>'+
      '<span style="color:var(--on-ink-dim);font-size:13px">Register by '+CG.fmtFull(regDl)+' to be draft-eligible</span>'+
      '<span style="margin-left:auto;display:inline-flex;align-items:center;gap:12px;flex-wrap:wrap"><span style="display:inline-flex;align-items:baseline;gap:9px"><span class="eyebrow" style="color:var(--on-ink-dim)">Deadline in</span>'+
      '<b id="regCountdown" class="num" data-close="'+regDl+'" style="font-family:var(--f-disp);font-size:24px;line-height:1;color:#fff;font-variant-numeric:tabular-nums">—</b></span>'+
      '<a class="btn btn-chrome btn-sm" href="#/register">Register to play</a></span>'+
    '</div></section>';
  }
  /* HERO */
  var railGames = pre ? lg.schedule.filter(function(g){ return g.at>CG.now(); }).sort(function(a,b){return a.at-b.at;}).slice(0,4) : lg.tonight;
  var railLabel = pre ? "Opening games"
    : "Tonight"+(railGames.length ? " · "+(railGames[0].stage==="preseason"?"Pre-season week ":"Week ")+railGames[0].week : "");
  html += '<section id="hero"><div class="shell hero-grid">'+
    '<div class="caro" id="heroCaro" aria-label="Featured stories"></div>'+
    '<aside class="hero-rail"><div class="rail-h"><span class="eyebrow" style="color:var(--on-ink-dim)">'+railLabel+'</span>'+
      '<a class="sec-link" style="color:#fff" href="#/schedule">Full schedule</a></div>'+
      (railGames.length ? railGames.map(function(g){
        var streamers = CG.liveStreamers(g);
        return '<a class="railgame" href="#/matchup/'+g.id+'">'+
          '<span class="rg-line">'+CG.crest(g.away,22)+esc(CG.TEAM[g.away].code)+' @ '+CG.crest(g.home,22)+esc(CG.TEAM[g.home].code)+
            (streamers.length?' <span class="chip chip-live" style="font-size:9px;padding:1px 8px;margin-left:auto"><span class="live-dot"></span>LIVE</span>':"")+'</span>'+
          '<span class="rg-t">'+(pre?CG.fmtDay(g.at):CG.fmtTime(g.at))+'</span>'+
          '<span class="rg-meta">'+esc(CG.TEAM[g.away].name)+' at '+esc(CG.TEAM[g.home].name)+(g.feature?' · <b style="color:var(--chrome)">MARQUEE</b>':"")+
            (streamers.length?' · streaming: '+streamers.map(function(p){ return esc(p.tag); }).join(", "):"")+'</span></a>';
      }).join("") : '<p class="caption" style="color:var(--on-ink-dim);padding:8px 0">The opening schedule is being finalized.</p>')+
      '<p class="caption" style="color:var(--on-ink-dim)">'+(pre?"Lineups and private game codes go live on game day (Rule 4.2).":"Lineups release 60 min before puck drop · codes at T-30 (Rule 4.2).")+'</p>'+
    '</aside></div></section>';
  /* quick fact strip */
  if (pre){
    var days = CG.daysToStart(), start = CG.seasonStartMs();
    html += '<section class="sec-tight"><div class="shell"><div class="statline">'+
      '<div><b class="num">'+esc((CG.SEASON&&CG.SEASON.name)||"Off-season")+'</b><span>inaugural season</span></div>'+
      '<div style="cursor:pointer" data-go="#/schedule"><b class="num">'+(days!=null?days:"—")+'</b><span>day'+(days===1?"":"s")+' to puck drop'+(start?" · "+CG.fmtDay(start):"")+'</span></div>'+
      '<div style="cursor:pointer" data-go="#/teams"><b class="num">'+CG.TEAMS.length+'</b><span>clubs · '+(CG.DIVISIONS?CG.DIVISIONS.length:2)+' divisions</span></div>'+
      '<div style="cursor:pointer" data-go="#/players"><b class="num">'+lg.players.length+'</b><span>players signed</span></div>'+
    '</div></div></section>';
  } else {
    var lead = CG.skaterLeaders(lg,"p")[0];
    var homeCurWeek = lg.results.reduce(function(m,r){ return Math.max(m, r.week||1); }, 1);
    var homeTotWeeks = lg.schedule.filter(function(g){ return g.stage!=="preseason" && g.stage!=="playoff"; })
      .reduce(function(m,g){ return Math.max(m, g.week||1); }, homeCurWeek);
    html += '<section class="sec-tight"><div class="shell"><div class="statline">'+
      '<div><b class="num">Week '+homeCurWeek+'</b><span>of '+homeTotWeeks+' · '+esc(CG.seasonTag())+'</span></div>'+
      '<div style="cursor:pointer" data-go="#/schedule"><b class="num">'+lg.results.length+'</b><span>Games played</span></div>'+
      (lead?'<div style="cursor:pointer" data-go="'+CG.playerRoute(lead)+'"><b>'+esc(lead.tag)+'</b><span>'+lg.pstats[lead.id].p+' pts · scoring lead</span></div>':"")+
      '<div style="cursor:pointer" data-go="#/standings"><b class="num">3×2</b><span>Playoff spots per division</span></div>'+
    '</div></div></section>';
  }
  /* TONIGHT dark band */
  if (CG.modOn("tonight") && !pre){
    html += '<section class="sec sec-dark"><div class="shell">'+
      '<div class="sec-head"><div class="lead"><span class="eyebrow chr">Game night</span><h2 class="h-sec">Tonight’s matchups</h2></div>'+
      '<a class="sec-link" style="color:#fff" href="#/schedule">'+(lg.tonight[0]?"Week "+(lg.tonight[0].week||1)+" slate":"Full schedule")+'</a></div>'+
      '<div class="grid g2">'+lg.tonight.map(function(g){
        var released = CG.now() >= g.at - 30*60000;
        var streamers = CG.liveStreamers(g);
        return '<div class="card raise" data-go="#/matchup/'+g.id+'" role="link" tabindex="0"><div class="card-b" style="display:flex;flex-direction:column;gap:12px">'+
          '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><span class="chip chip-live"><span class="live-dot"></span>'+CG.fmtTime(g.at)+'</span>'+
          '<span style="display:inline-flex;gap:6px;flex-wrap:wrap">'+streamers.map(function(p){ return CG.twitchChip(p); }).join("")+
          (g.feature?'<span class="chip chip-chrome">Marquee</span>':"")+'</span></div>'+
          '<div style="display:flex;align-items:center;gap:12px;font-family:var(--f-disp);font-weight:800;font-size:19px;color:#fff;flex-wrap:wrap">'+
            CG.crest(g.away,34)+esc(CG.TEAM[g.away].name)+'<span style="color:var(--on-ink-dim);font-size:12px;font-family:var(--f-mono)">at</span>'+CG.crest(g.home,34)+esc(CG.TEAM[g.home].name)+'</div>'+
          '<div style="display:flex;gap:14px;flex-wrap:wrap;font-family:var(--f-mono);font-size:11px;color:var(--on-ink-dim)">'+
            '<span>'+["",""].map(function(){return "";}).join("")+CG.lg.teams[g.away].w+"-"+CG.lg.teams[g.away].l+"-"+CG.lg.teams[g.away].otl+' vs '+CG.lg.teams[g.home].w+"-"+CG.lg.teams[g.home].l+"-"+CG.lg.teams[g.home].otl+'</span>'+
            '<span class="lock">'+CG.ic(released?"code":"lock",13)+(released?"Code live for rostered players":"Code at "+CG.fmtTime(g.at-30*60000))+'</span></div>'+
        '</div></div>';
      }).join("")+'</div></div></section>';
  }
  /* STANDINGS + rail */
  if (CG.modOn("standings")){
    html += '<section class="sec"><div class="shell">'+
      '<div class="sec-head"><div class="lead"><span class="eyebrow chr">Standings</span><h2 class="h-sec">The race, division by division</h2></div>'+
        '<a class="sec-link" href="#/standings">Full standings</a></div>'+
      '<div class="grid g2">'+
        (CG.DIVISIONS||["East","West"]).map(function(dv){
          return '<div class="card"><div class="card-h"><h3>'+esc(dv)+' Division</h3><span class="chip">Top 3 qualify</span></div>'+CG.standTable(dv,{cutline:true})+'</div>';
        }).join("")+
      '</div>'+
      '<div class="grid g2" style="margin-top:18px;align-items:start">'+
        '<div class="card"><div class="card-h"><h3>Power Rankings</h3><a class="sec-link" href="#/rankings">Full list</a></div>'+
          lg.powerRankings.map(function(pr){
            var t = CG.TEAM[pr.team];
            return '<div class="leaderrow'+(pr.rank===1?" top":"")+'" data-go="#/team/'+pr.team+'"><span class="rk num">'+pr.rank+'</span>'+
              CG.crest(pr.team,30)+'<span style="min-width:0"><b style="font-family:var(--f-disp);font-size:14px">'+esc(t.name)+'</b>'+
              '<small style="display:block" class="caption">'+lg.teams[pr.team].w+"-"+lg.teams[pr.team].l+"-"+lg.teams[pr.team].otl+' · '+esc(t.div)+' Division</small></span>'+
              '<span class="val">'+CG.moveArrow(pr.move)+'</span></div>';
          }).join("")+'</div>'+
        '<div class="card"><div class="card-h"><h3>Transactions</h3><span class="chip">'+esc(CG.seasonTag())+' log</span></div>'+
          ((lg.liveTransactions||[]).length ? lg.liveTransactions.slice(0,7).map(function(tx){
            return '<div class="notif" style="cursor:default"><span class="nf-ic">'+CG.ic(tx.type==="trade"?"swap":tx.type==="draft"?"grid":tx.type==="sign"?"check":tx.type==="waive"?"back":"flag",15)+'</span>'+
              '<span style="min-width:0"><p style="font-weight:600">'+CG.txText(tx.text)+'</p></span><span class="nf-t">'+(tx.dateIso?CG.fmtDate(tx.dateIso):"")+'</span></div>';
          }).join("") : '<div class="card-b"><p class="caption">No transactions yet — trades, signings, waivers, and placements land here the moment they happen.</p></div>')+'</div>'+
      '</div></div></section>';
  }
  /* LEADERS band */
  if (CG.modOn("leaders") && !pre){
    var pts = CG.skaterLeaders(lg,"p").slice(0,5);
    var gls = CG.skaterLeaders(lg,"g").slice(0,5);
    var gs  = CG.goalieLeaders(lg).slice(0,4);
    function leadCard(title, rows, fmt){
      return '<div class="card"><div class="card-h"><h3>'+title+'</h3><a class="sec-link" href="#/stats">All stats</a></div>'+
        rows.map(function(p,i){ var f = fmt(p);
          return '<div class="leaderrow'+(i===0?" top":"")+'" data-go="'+CG.playerRoute(p)+'"><span class="rk num">'+(i+1)+'</span>'+CG.crest(p.team,30)+
            '<span style="min-width:0"><b style="font-size:14px">'+esc(p.tag)+'</b><small style="display:block" class="caption">'+esc(CG.TEAM[p.team].name)+' · '+p.pos+'</small></span>'+
            '<span class="val"><b class="num">'+f[0]+'</b><span>'+f[1]+'</span></span></div>';
        }).join("")+'</div>';
    }
    html += '<section class="sec" style="padding-top:0"><div class="shell">'+
      '<div class="sec-head"><div class="lead"><span class="eyebrow chr">Stat central</span><h2 class="h-sec">Who’s lighting the lamp</h2></div>'+
      '<a class="sec-link" href="#/stats">Stat central</a></div>'+
      '<div class="grid g3">'+
        leadCard("Points", pts, function(p){ var s=lg.pstats[p.id]; return [s.p, s.g+"G · "+s.a+"A"]; })+
        leadCard("Goals", gls, function(p){ var s=lg.pstats[p.id]; return [s.g, s.gp+" GP"]; })+
        leadCard("Goaltending", gs, function(p){ var s=lg.pstats[p.id]; return [(s.sv/Math.max(1,s.sa)).toFixed(3).replace(/^0/,""), s.w+"-"+s.l+"-"+s.otl]; })+
      '</div></div></section>';
  }
  /* VIDEO — Intermission Report */
  if (CG.modOn("video") && !pre){
    var vid = CG.store.get("prefs").video;
    html += '<section class="sec-tight"><div class="shell"><div class="grid g32" style="align-items:center">'+
      '<div><span class="eyebrow chr">Intermission report</span><h2 class="h-sec" style="margin:12px 0 10px">The week in one sitting</h2>'+
      '<p class="lede">A commissioner-curated highlight reel runs here on loop. Upload an MP4 or WebM in the Control Center — muted autoplay, poster fallback, and reduced-motion support are built in.</p>'+
      (CG.role()==="commish"?'<a class="btn btn-ink" style="margin-top:16px" href="#/admin/homepage">Manage the reel</a>':"")+'</div>'+
      '<div class="vidbox">'+
        (vid ? '<video src="'+esc(vid)+'" autoplay muted loop playsinline controls></video>'
             : '<div class="vb-fallback"><div style="text-align:center">'+CG.ic("film",34)+'<p style="margin-top:10px;font-family:var(--f-mono);font-size:12px">No video published for this week</p>'+
               '<p class="caption" style="color:var(--on-ink-dim)">Static poster shown until the commissioner uploads one.</p></div></div>')+
        '<div class="vb-overlay"><b style="font-family:var(--f-disp)">The week in review</b></div>'+
      '</div></div></div></section>';
  }
  /* NEWS */
  if (CG.modOn("news") && !pre){
    var arts = C.articles.slice().sort(function(a,b){ return b.dateIso.localeCompare(a.dateIso); });
    var leadA = arts[0], rest = arts.slice(1,4);
    html += '<section class="sec"><div class="shell">'+
      '<div class="sec-head"><div class="lead"><span class="eyebrow chr">Off the wire</span><h2 class="h-sec">Around the league</h2></div>'+
      '<a class="sec-link" href="#/news">The newsroom</a></div>'+
      '<div class="grid" style="grid-template-columns:1.6fr 1fr 1fr">'+
        CG.newsCard(leadA, true) + rest.slice(0,2).map(function(a){ return CG.newsCard(a); }).join("")+
      '</div></div></section>';
  }
  /* HONORS — needs at least one completed game night AND a minted POTW; either can lag early
     in the season, so both are hard requirements or this section would throw on week 1 */
  if (CG.modOn("honors") && !pre && lg.lastNight.length && lg.potw.length
      && CG.playerById(lg, (lg.potw[lg.potw.length-1]||{}).skater)
      && CG.playerById(lg, (lg.potw[lg.potw.length-1]||{}).goalie)){
    var stars = (lg.lastNight[lg.lastNight.length-1].stars||[]).filter(function(s){ return CG.playerById(lg, s.pid); });
    var potw = lg.potw[lg.potw.length-1];
    var skp = CG.playerById(lg, potw.skater), glp = CG.playerById(lg, potw.goalie);
    html += '<section class="sec sec-dark"><div class="shell"><div class="grid g5x7">'+
      '<div><span class="eyebrow chr">Three Stars · last game night</span>'+
        '<div class="starsrow" style="margin-top:22px">'+stars.map(function(s,i){
          var p = CG.playerById(lg, s.pid);
          return '<div class="starcard" style="background:var(--ink-2);border-color:#2A343B" data-go="'+CG.playerRoute(p)+'" role="link" tabindex="0"><span class="st-k">'+["1st star","2nd star","3rd star"][i]+'</span>'+
            '<div style="display:flex;gap:10px;align-items:center;margin-top:6px">'+CG.crest(p.team,30)+
            '<div><b style="font-family:var(--f-disp);color:#fff">'+esc(p.tag)+'</b><span class="caption" style="display:block;color:var(--on-ink-dim)">'+esc(CG.TEAM[p.team].name)+'</span></div></div></div>';
        }).join("")+'</div>'+
        '<p class="caption" style="margin-top:14px;color:var(--on-ink-dim)">Picked automatically from the night’s box scores.</p></div>'+
      '<div><span class="eyebrow chr">Players of the Week '+potw.week+'</span>'+
        '<div class="stack" style="margin-top:22px">'+ [ [skp,"Skater"], [glp,"Goaltender"] ].map(function(pair){
          return '<div class="card raise" data-go="'+CG.playerRoute(pair[0])+'" role="link" tabindex="0"><div class="card-b" style="display:flex;gap:14px;align-items:center">'+
            CG.crest(pair[0].team,40)+'<div style="min-width:0"><span class="chip chip-chrome">'+pair[1]+'</span>'+
            '<b style="display:block;font-family:var(--f-disp);font-size:18px;color:#fff;margin-top:6px">'+esc(pair[0].tag)+'</b>'+
            '<span class="caption" style="color:var(--on-ink-dim)">'+esc(CG.TEAM[pair[0].team].name)+'</span></div>'+
            '<span class="ovrbox" style="margin-left:auto">'+CG.lg.ratings[pair[0].id].ovr+'</span></div></div>';
        }).join("")+'</div></div>'+
    '</div></div></section>';
  }
  /* DEADLINES — real dates only, straight off the season row (next two upcoming milestones) */
  if (CG.modOn("deadlines")){
    var s0 = CG.SEASON||{};
    var mile = [
      [s0.registration_deadline, "Draft-eligibility deadline", "Register by now to enter the draft. Later sign-ups still play — they’re placed on a club automatically after it."],
      [s0.preseason_starts_at, "Pre-season opens", "Two weeks of real games on randomly assigned rosters."],
      [s0.draft_at, "Draft night", "Clubs pick from the eligible pool live on the site."],
      [s0.free_agency_opens_at, "Free agency opens", "One week for clubs to sign the remaining free agents."],
      [s0.free_agency_closes_at, "Free agency closes", "Rosters settle — puck drop is the Wednesday after."],
      [s0.starts_at, "Puck drop", "The regular season begins."],
      [s0.playoffs_start_at, "Playoffs begin", "Top three per division qualify."]
    ].filter(function(m){ return m[0] && Date.parse(m[0]) > CG.now(); }).slice(0,2);
    if (mile.length){
      html += '<section class="sec-tight"><div class="shell"><div class="grid g3">'+
        mile.map(function(m){
          return '<div class="note chr"><b style="font-family:var(--f-disp);display:block;margin-bottom:4px;color:var(--ink)">'+esc(m[1])+'</b>'+esc(m[2])+
            '<span class="caption" style="display:block;margin-top:8px">'+CG.fmtFull(Date.parse(m[0]))+'</span></div>';
        }).join("")+
        '<div class="note"><b style="font-family:var(--f-disp);display:block;margin-bottom:4px;color:var(--ink)">Availability window</b>'+esc(CG.WEEK8.label)+' submissions close '+CG.fmtFull(CG.WEEK8.deadline)+' (Rule 5.1). '+
          (CG.can("availability.submit")?'<a href="#/hub/availability" style="font-weight:700;border-bottom:2px solid var(--chrome)">Submit yours →</a>':'<a href="#/signin" style="font-weight:700;border-bottom:2px solid var(--chrome)">Sign in to submit →</a>')+'</div>'+
      '</div></div></section>';
    }
  }
  return html;
};
CG.newsCard = function(a, lead){
  var t0 = a.relatedTeams[0] && CG.TEAMS.find(function(t){ return t.name===a.relatedTeams[0]; });
  var art = '<svg viewBox="0 0 400 150" preserveAspectRatio="xMidYMid slice" aria-hidden="true">'+
    '<rect width="400" height="150" fill="#101519"/>'+
    '<circle cx="330" cy="20" r="90" fill="'+(t0?t0.color:"#FFE500")+'" opacity=".25"/>'+
    '<circle cx="330" cy="20" r="56" fill="'+(t0?t0.color:"#FFE500")+'" opacity=".35"/>'+
    '<path d="M0 118 L400 92 L400 150 L0 150 Z" fill="'+(t0?t0.color:"#FFE500")+'" opacity=".16"/>'+
    '<text x="22" y="126" font-family="Archivo, sans-serif" font-weight="900" font-size="44" fill="#FFFFFF" opacity=".1">CGHL</text></svg>';
  return '<article class="newscard'+(lead?" lead":"")+'" data-go="#/article/'+a.slug+'" role="link" tabindex="0">'+
    '<div class="nc-art">'+art+'</div><div class="nc-b">'+
    '<span class="eyebrow" style="font-size:10px">'+esc(a.category)+'</span>'+
    '<h3>'+esc(a.title)+'</h3>'+(lead?'<p>'+esc(a.excerpt)+'</p>':"")+
    '<span class="nc-meta">'+CG.fmtDate(a.dateIso)+' · '+esc(a.author.split("—")[0].trim())+'</span></div></article>';
};
CG.AFTER.home = function(){
  CG.carousel("#heroCaro", CG.slideDefs().map(function(s){ return s.html; }));
  /* free-agency countdown tick — stops itself when the strip leaves the page */
  var faEl = document.getElementById("faCountdown");
  if (faEl){
    var faEnd = +faEl.getAttribute("data-close");
    var faTick = function(){
      var el = document.getElementById("faCountdown");
      if (!el){ clearInterval(faIv); return; }
      var ms = faEnd - Date.now();
      if (ms <= 0){ clearInterval(faIv); CG.router(); return; } /* window closed — re-render without the strip */
      var t = Math.floor(ms/1000);
      var d = Math.floor(t/86400), hh = Math.floor((t%86400)/3600), mm = Math.floor((t%3600)/60), ss = t%60;
      el.textContent = (d ? d+"d " : "")+String(hh).padStart(2,"0")+":"+String(mm).padStart(2,"0")+":"+String(ss).padStart(2,"0");
    };
    var faIv = setInterval(faTick, 1000); faTick();
  }
  /* registration countdown tick — same self-stopping pattern */
  var rgEl = document.getElementById("regCountdown");
  if (rgEl){
    var rgEnd = +rgEl.getAttribute("data-close");
    var rgTick = function(){
      var el = document.getElementById("regCountdown");
      if (!el){ clearInterval(rgIv); return; }
      var ms = rgEnd - Date.now();
      if (ms <= 0){ clearInterval(rgIv); CG.router(); return; }
      var t = Math.floor(ms/1000);
      var d = Math.floor(t/86400), hh = Math.floor((t%86400)/3600), mm = Math.floor((t%3600)/60), ss = t%60;
      el.textContent = (d ? d+"d " : "")+String(hh).padStart(2,"0")+":"+String(mm).padStart(2,"0")+":"+String(ss).padStart(2,"0");
    };
    var rgIv = setInterval(rgTick, 1000); rgTick();
  }
};

/* ---------- SCHEDULE ---------- */
CG.ROUTES.schedule = function(param, qs){
  var lg = CG.lg;
  var fTeam = qs.team||"", fState = qs.state||"all", fWeek = qs.week||"";
  var head = CG.pageHead(esc(CG.seasonTag())+" · schedule","Schedule & results","Every night, every final. All times Eastern. Game codes and lineups live on each matchup page.");
  var filters = '<div class="shell" style="margin-bottom:20px"><div class="filters">'+
    '<select id="fTeam" aria-label="Filter by club" style="max-width:220px"><option value="">All clubs</option>'+
      CG.TEAMS.map(function(t){ return '<option value="'+t.code+'"'+(fTeam===t.code?" selected":"")+'>'+esc(t.name)+'</option>'; }).join("")+'</select>'+
    '<div class="seg" role="group" aria-label="Game state">'+["all","final","upcoming"].map(function(s){
      return '<button data-state="'+s+'" class="'+(fState===s?"on":"")+'">'+s[0].toUpperCase()+s.slice(1)+'</button>'; }).join("")+'</div>'+
    '<select id="fWeek" aria-label="Filter by week" style="max-width:140px"><option value="">All weeks</option>'+
      Array.from({length:10},function(_,i){ return '<option value="'+(i+1)+'"'+(fWeek==String(i+1)?" selected":"")+'>Week '+(i+1)+'</option>'; }).join("")+'</select>'+
    '<button class="btn btn-ghost btn-sm" id="csvSched">'+CG.ic("dl",14)+'Export CSV</button>'+
  '</div></div>';
  /* group by stage + week so pre-season week 1 never merges with regular week 1 */
  var stageOrder = { preseason:0, regular:1, playoff:2 };
  var byWeek = {};
  lg.schedule.forEach(function(g){
    if (fTeam && g.home!==fTeam && g.away!==fTeam) return;
    if (fWeek && g.week!=+fWeek) return;
    var done = (lg.allResults||lg.results).some(function(r){ return r.id===g.id; });
    if (fState==="final" && !done) return;
    if (fState==="upcoming" && done) return;
    var st = g.stage||"regular";
    var k = st+":"+g.week;
    (byWeek[k]=byWeek[k]||{stage:st, week:g.week, games:[]}).games.push(g);
  });
  /* "this week" = the group holding the next game still to be played */
  var nowKey = null, soonest = Infinity;
  Object.keys(byWeek).forEach(function(k){
    byWeek[k].games.forEach(function(g){
      if (g.status!=="final" && g.at >= CG.now()-6*3600000 && g.at < soonest){ soonest = g.at; nowKey = k; }
    });
  });
  var keys = Object.keys(byWeek).sort(function(a,b){
    var A=byWeek[a], B=byWeek[b];
    return (stageOrder[A.stage]-stageOrder[B.stage]) || (A.week-B.week);
  });
  var body = keys.length ? keys.map(function(k){
    var grp = byWeek[k];
    var lab = (grp.stage==="preseason"?"Pre-season · Week ":grp.stage==="playoff"?"Playoffs · Week ":"Week ")+grp.week;
    return '<div style="margin-bottom:30px"><div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">'+
      '<span class="eyebrow chr">'+lab+'</span>'+(k===nowKey?'<span class="chip chip-live"><span class="live-dot"></span>Next up</span>':"")+'</div>'+
      '<div class="stack" style="gap:9px">'+grp.games.map(CG.gameCard).join("")+'</div></div>';
  }).join("") : '<div class="empty"><div class="e-art">'+CG.ic("cal",22)+'</div><b>No games match those filters</b><p>Clear a filter or two — the full slate lives here.</p></div>';
  return head + filters + '<div class="shell" style="padding-bottom:40px">'+body+'</div>';
};
CG.AFTER.schedule = function(param, qs){
  function nav(patch){
    var q = Object.assign({team:qs.team||"",state:qs.state||"all",week:qs.week||""}, patch);
    location.hash = "#/schedule?team="+q.team+"&state="+q.state+"&week="+q.week;
  }
  $("#fTeam").addEventListener("change", function(){ nav({team:this.value}); });
  $("#fWeek").addEventListener("change", function(){ nav({week:this.value}); });
  $$("[data-state]").forEach(function(b){ b.addEventListener("click", function(){ nav({state:this.getAttribute("data-state")}); }); });
  $("#csvSched").addEventListener("click", function(){
    var rows = [["Stage","Week","Date","Away","Home","Away score","Home score","OT"]];
    CG.lg.schedule.forEach(function(g){
      var r = (CG.lg.allResults||CG.lg.results).find(function(x){ return x.id===g.id; });
      rows.push([g.stage||"regular", g.week, CG.fmtDay(g.at), CG.TEAM[g.away].name, CG.TEAM[g.home].name,
        r?r.score[g.away]:"", r?r.score[g.home]:"", r?(r.ot?"Y":"N"):""]);
    });
    CG.exportCSV("cghl-schedule.csv", rows);
  });
};

/* ---------- PLAYOFF BRACKET ----------
   Renders the live postseason (stage='playoff' series, round = week) when it
   exists; before then, the projected field seeded by Rule 8.1. A club that has
   mathematically clinched a top-3 spot (server-detected, mirrored to
   lg.clinched) shows a lock icon. */
CG.LOCK_ICON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true" style="flex-shrink:0"><path d="M6 10V8a6 6 0 1 1 12 0v2m-13 0h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
CG.playoffBracket = function(){
  var lg = CG.lg, DIVS = CG.DIVISIONS && CG.DIVISIONS.length ? CG.DIVISIONS : ["East","West"];
  var clinched = lg.clinched || [];
  var isClinched = function(code){ return clinched.indexOf(code)>=0; };
  var pog = (lg.playoffGames||[]);
  var live = pog.length > 0;

  /* ----- LIVE postseason: real series grouped by round (week) ----- */
  if (live){
    var bestOf = (CG._siteCfg && CG._siteCfg.playoff_format && CG._siteCfg.playoff_format.bestOf) || 3;
    var need = Math.floor(bestOf/2)+1;
    /* collapse each round's games into series keyed by the club pair */
    var seriesByRound = {1:{},2:{},3:{}};
    pog.forEach(function(g){
      var rd = g.week||1; if(!seriesByRound[rd]) seriesByRound[rd]={};
      var key = [g.home,g.away].sort().join("~");
      var s = seriesByRound[rd][key] || (seriesByRound[rd][key]={ a:[g.home,g.away].sort()[0], b:[g.home,g.away].sort()[1], aw:0, bw:0, games:0 });
      s.games++;
      var res = (lg.allResults||[]).find(function(r){ return r.id===g.id; });
      if (res){ var winner = res.score[g.home] > res.score[g.away] ? g.home : g.away;
        if (winner===s.a) s.aw++; else s.bw++; }
    });
    var roundName = {1:"Quarter-finals",2:"Semi-finals",3:"Final"};
    var seriesCard = function(s){
      var done = s.aw>=need || s.bw>=need;
      var aWon = s.aw>=need, bWon = s.bw>=need;
      var side = function(code, wins, won){
        return '<div style="display:flex;align-items:center;gap:9px;'+(done&&!won?"opacity:.5":"")+'">'+CG.crest(code,22)+
          '<b class="mono" style="font-size:12.5px">'+esc(code)+'</b>'+(won?' <span class="chip chip-win" style="font-size:9px">WON</span>':"")+
          '<b class="num" style="margin-left:auto;font-size:16px">'+wins+'</b></div>'; };
      return '<div data-go="#/team/'+s.a+'" style="border:1px solid '+(done?"var(--chrome)":"var(--line)")+';border-radius:var(--r-s);padding:11px 13px;display:flex;flex-direction:column;gap:8px;cursor:pointer">'+
        side(s.a,s.aw,aWon)+side(s.b,s.bw,bWon)+
        '<span class="caption" style="text-align:center">'+(done?"Series won "+Math.max(s.aw,s.bw)+"–"+Math.min(s.aw,s.bw):"Best of "+((need-1)*2+1)+" · "+s.aw+"–"+s.bw)+'</span></div>'; };
    var col = function(rd){
      var list = Object.keys(seriesByRound[rd]||{}).map(function(k){ return seriesByRound[rd][k]; });
      return '<div><span class="eyebrow" style="display:block;margin-bottom:10px">'+roundName[rd]+'</span>'+
        (list.length ? '<div class="stack" style="gap:10px">'+list.map(seriesCard).join("")+'</div>'
                     : '<div style="border:1px dashed var(--line);border-radius:var(--r-s);padding:20px 14px;text-align:center"><span class="caption">Set from the Control Center once the previous round ends.</span></div>')+'</div>'; };
    var champ = null;
    (Object.keys(seriesByRound[3]||{})).forEach(function(k){ var s=seriesByRound[3][k]; if(s.aw>=need) champ=s.a; else if(s.bw>=need) champ=s.b; });
    return '<div class="card" style="margin-bottom:22px"><div class="card-h"><h3>Playoff bracket</h3>'+
      (champ?'<span class="chip chip-win">'+esc((CG.TEAM[champ]||{}).name||champ)+' — champions</span>':'<span class="chip chip-chrome">Postseason live</span>')+'</div>'+
      '<div class="card-b"><div class="grid g3" style="gap:16px;align-items:start">'+col(1)+col(2)+col(3)+'</div>'+
      '<p class="caption" style="margin-top:14px">Series play out best-of-'+((need-1)*2+1)+'; the higher seed holds home designation (Rule 8.1). Decided series drop their unplayed games automatically.</p></div></div>';
  }

  /* ----- PROJECTION: seed the field from today's table (Rule 8.1) ----- */
  var pWinners = DIVS.map(function(dv){ return CG.standings(CG.lg,dv)[0]; }).filter(Boolean);
  pWinners.sort(function(a,b){ return b.pts-a.pts||b.w-a.w||b.diff-a.diff||b.gf-a.gf; });
  var pRest = [];
  DIVS.forEach(function(dv){ CG.standings(CG.lg,dv).slice(1,3).forEach(function(r){ pRest.push(r); }); });
  pRest.sort(function(a,b){ return b.pts-a.pts||b.w-a.w||b.diff-a.diff||b.gf-a.gf; });
  var seeds = pWinners.concat(pRest).slice(0,6);
  if (seeds.length!==6) return "";
  var played = (CG.lg.results||[]).length;
  var anyClinch = seeds.some(function(r){ return isClinched(r.code); });
  var seedRow = function(i){ var r=seeds[i], lock=isClinched(r.code);
    return '<div style="display:flex;align-items:center;gap:9px;min-width:0"><span class="rk num" style="width:18px;flex-shrink:0">'+(i+1)+'</span>'+CG.crest(r.code,22)+
      '<b class="mono" style="font-size:12px">'+esc(r.code)+'</b>'+
      (lock?'<span title="Clinched a playoff spot" style="color:var(--chrome);display:inline-flex;align-items:center">'+CG.LOCK_ICON+'</span>':"")+
      '<span class="caption num" style="margin-left:auto">'+r.pts+' pts</span></div>'; };
  var tbdRow = function(txt){
    return '<div style="display:flex;align-items:center;gap:9px"><span class="rk num" style="width:18px;flex-shrink:0">—</span><span class="caption">'+txt+'</span></div>'; };
  var matchCard = function(a,b){
    return '<div style="border:1px solid var(--line);border-radius:var(--r-s);padding:11px 13px;display:flex;flex-direction:column;gap:8px">'+a+b+'</div>'; };
  return '<div class="card" style="margin-bottom:22px"><div class="card-h"><h3>Projected playoff bracket</h3>'+
    '<span class="chip">'+(played?'If the season ended today':'Before puck drop — seeded by the table below')+'</span></div>'+
    '<div class="card-b"><div class="grid g3" style="gap:16px;align-items:start">'+
    '<div><span class="eyebrow" style="display:block;margin-bottom:10px">Quarter-finals</span><div class="stack" style="gap:10px">'+
      matchCard(seedRow(2),seedRow(5))+matchCard(seedRow(3),seedRow(4))+
      '</div><p class="caption" style="margin-top:10px">Division winners — seeds 1 and 2 — skip straight to the semi-finals.</p></div>'+
    '<div><span class="eyebrow" style="display:block;margin-bottom:10px">Semi-finals</span><div class="stack" style="gap:10px">'+
      matchCard(seedRow(0),tbdRow("Lowest seed through"))+
      matchCard(seedRow(1),tbdRow("Highest seed through"))+'</div></div>'+
    '<div><span class="eyebrow" style="display:block;margin-bottom:10px">Final</span>'+
      '<div style="border:1px solid var(--line);border-radius:var(--r-s);padding:20px 14px;text-align:center"><b style="font-family:var(--f-disp)">Semi-final winners</b>'+
      '<p class="caption" style="margin-top:6px">One series for the cup.</p></div></div>'+
    '</div>'+
    '<p class="caption" style="margin-top:14px">Top three per division qualify; division winners take the top seeds and the rest seed by points (Rule 8.1). The projection re-sorts after every final'+
    (anyClinch?'. '+CG.LOCK_ICON.replace('width="12" height="12"','width="11" height="11"')+' marks a club that has mathematically clinched a spot.':'.')+'</p></div></div>';
};

/* ---------- STANDINGS ---------- */
CG.ROUTES.standings = function(param, qs){
  var view = qs.view||"division";
  var hasPre = (CG.lg.schedule||[]).some(function(g){ return g.stage==="preseason"; });
  var regWk = (CG.lg.results||[]).reduce(function(m,r){ return Math.max(m, r.week||1); }, 0);
  var eyebrow = esc((CG.SEASON&&CG.SEASON.name)||"Season") + (regWk ? " · through week "+regWk : (hasPre ? " · pre-season" : ""));
  var views = [["division","Divisions"],["league","League"],["wildcard","Playoff picture"]];
  if (hasPre) views.push(["preseason","Pre-season"]);
  var head = CG.pageHead(eyebrow,"League standings",
    "Two points for a win, one for an overtime loss. Top three per division qualify — the dashed line is the cut (Rule 8.1). Tiebreakers: wins, then goal differential, then goals for.",
    '<div style="display:flex;gap:9px;align-items:flex-end;flex-wrap:wrap">'+
      '<div class="seg" role="group" aria-label="Standings view">'+views.map(function(v){
        return '<button data-view="'+v[0]+'" class="'+(view===v[0]?"on":"")+'">'+v[1]+'</button>'; }).join("")+'</div>'+
      '<button class="btn btn-ghost btn-sm" id="csvStand">'+CG.ic("dl",14)+'CSV</button></div>');
  var body;
  var DIVS = CG.DIVISIONS && CG.DIVISIONS.length ? CG.DIVISIONS : ["East","West"];
  if (view==="preseason" && hasPre){
    var preTeams = (CG.lg.pre && CG.lg.pre.teams) || null;
    var preRows = preTeams ? CG.standings({teams:preTeams}) : CG.TEAMS.map(function(t){ return {team:t, code:t.code, gp:0,w:0,l:0,otl:0,gf:0,ga:0,diff:0,pts:0}; });
    body = '<div class="card"><div class="card-h"><h3>Pre-season table</h3><span class="chip">separate from the season</span></div>'+
      '<div class="tblwrap"><table class="tbl compact"><caption class="sr">Pre-season standings</caption>'+
      '<thead><tr><th>#</th><th class="tleft">Club</th><th>GP</th><th>W</th><th>L</th><th>OTL</th><th>GF</th><th>GA</th><th>DIFF</th><th>PTS</th></tr></thead><tbody>'+
      preRows.map(function(r,i){
        return '<tr data-go="#/team/'+r.code+'"><td class="tnum">'+(i+1)+'</td>'+
          '<td class="tleft"><span class="teamcell">'+CG.crest(r.code,22)+'<b>'+esc(r.team.name)+'</b></span></td>'+
          '<td class="tnum">'+r.gp+'</td><td class="tnum">'+r.w+'</td><td class="tnum">'+r.l+'</td><td class="tnum">'+r.otl+'</td>'+
          '<td class="tnum">'+r.gf+'</td><td class="tnum">'+r.ga+'</td><td class="tnum">'+(r.diff>0?"+":"")+r.diff+'</td><td class="tnum"><b>'+r.pts+'</b></td></tr>';
      }).join("")+'</tbody></table></div>'+
      '<div class="card-b" style="border-top:1px solid var(--line)"><span class="caption">Two weeks, rosters filled by random assignment. Pre-season results never touch the league standings — they exist so every player logs the five games that make them draft-eligible.</span></div></div>';
  } else if (view==="league"){
    body = '<div class="card"><div class="card-h"><h3>Overall league table</h3><span class="chip">'+CG.TEAMS.length+' clubs</span></div>'+CG.standTable(null,{full:true,caption:"League standings — all clubs"})+'</div>';
  } else if (view==="wildcard"){
    var byDiv = DIVS.map(function(dv){ return { name:dv, rows:CG.standings(CG.lg,dv) }; });
    body = '<div class="grid g2">'+
      '<div class="card"><div class="card-h"><h3>In the field today</h3><span class="chip chip-win">Qualified pace</span></div>'+
        byDiv.map(function(d){
          return '<div style="padding:10px 18px 4px"><span class="eyebrow">'+esc(d.name)+'</span></div>'+d.rows.slice(0,3).map(function(r,i){
            return '<div class="leaderrow" data-go="#/team/'+r.code+'"><span class="rk num">'+(i+1)+'</span>'+CG.crest(r.code,30)+
              '<span><b style="font-family:var(--f-disp);font-size:14px">'+esc(r.team.name)+'</b></span><span class="val"><b class="num">'+r.pts+'</b><span>PTS</span></span></div>';
          }).join("");
        }).join("")+'</div>'+
      '<div class="card"><div class="card-h"><h3>On the outside</h3><span class="chip chip-loss">Below the cut</span></div>'+
        byDiv.map(function(d){
          var third = d.rows[2];
          return '<div style="padding:10px 18px 4px"><span class="eyebrow">'+esc(d.name)+'</span></div>'+d.rows.slice(3).map(function(r,i){
            return '<div class="leaderrow" data-go="#/team/'+r.code+'"><span class="rk num">'+(i+4)+'</span>'+CG.crest(r.code,30)+
              '<span><b style="font-family:var(--f-disp);font-size:14px">'+esc(r.team.name)+'</b><small class="caption" style="display:block">'+(third?(third.pts-r.pts)+' pts back of the line':'')+'</small></span>'+
              '<span class="val"><b class="num">'+r.pts+'</b><span>PTS</span></span></div>';
          }).join("");
        }).join("")+'</div>'+
    '</div><p class="note" style="margin-top:16px">Playoff seeding: division winners take the top seeds; remaining qualifiers seed by points (Rule 8.1).</p>';
  } else {
    body = '<div class="grid g2">'+
      DIVS.map(function(dv){
        return '<div class="card"><div class="card-h"><h3>'+esc(dv)+' Division</h3><span class="chip">Top 3 qualify</span></div>'+CG.standTable(dv,{full:true,cutline:true,compact:true,srCaption:true,caption:esc(dv)+" Division standings"})+'</div>';
      }).join("")+
    '</div>';
  }
  /* playoff bracket — real series once the postseason is live, otherwise the
     Rule 8.1 projection from today's table. Clinched clubs get a lock icon. */
  var bracket = (view!=="preseason" && CG.TEAMS.length >= 6) ? CG.playoffBracket() : "";
  var legend = '<p class="caption" style="margin-top:16px">GP games played · W wins · L regulation losses · OTL overtime/shootout losses · GF/GA goals for/against · DIFF goal differential · L5 last five · STRK streak · PTS points.</p>';
  return head + '<div class="shell" style="padding-bottom:40px">'+bracket+body+legend+'</div>';
};
CG.AFTER.standings = function(param, qs){
  $$("[data-view]").forEach(function(b){ b.addEventListener("click", function(){ location.hash="#/standings?view="+this.getAttribute("data-view"); }); });
  var btn = $("#csvStand");
  if (btn) btn.addEventListener("click", function(){
    var rows = [["Rank","Club","Div","GP","W","L","OTL","GF","GA","DIFF","STRK","PTS"]];
    CG.standings(CG.lg).forEach(function(r,i){
      rows.push([i+1,r.team.name,r.team.div,r.gp,r.w,r.l,r.otl,r.gf,r.ga,r.diff,r.streak,r.pts]);
    });
    CG.exportCSV("cghl-standings.csv", rows);
  });
};

/* ---------- per-profile season archive ---------- */
CG.SEASONS_LIST = function(){
  return [ { key:"cur", label:CG.seasonTag()+" · "+CG.seasonYear(), status:"Current" } ]
    .concat(Object.keys(CG.lg.archive||{}).map(function(k){ return CG.lg.archive[k]; }));
};
CG.seasonData = function(key){
  if (key!=="cur" && CG.lg.archive && CG.lg.archive[key]) return CG.lg.archive[key];
  return { key:"cur", label:CG.seasonTag()+" · "+CG.seasonYear(), status:"Current",
    teams:CG.lg.teams, pstats:CG.lg.pstats, glog:CG.lg.glog, results:CG.lg.results };
};
CG.seasonPicker = function(cur){
  return '<label style="display:flex;align-items:center;gap:9px">'+
    '<span class="eyebrow" style="color:var(--on-ink-dim)">Season</span>'+
    '<select id="seasonPick" aria-label="Season to view" style="width:auto;min-width:200px;background:var(--bc2);color:#fff;border-color:#39434B;font-family:var(--f-mono);font-size:12px">'+
    CG.SEASONS_LIST().map(function(s){
      return '<option value="'+s.key+'"'+(cur===s.key?" selected":"")+'>'+esc(s.label)+' — '+esc(s.status)+'</option>';
    }).join("")+'</select></label>';
};

/* Editorial one-liner computed from live results — always factually current. */
CG.teamLine = function(code){
  var lg = CG.lg, t = CG.TEAM[code], s = lg.teams[code];
  var div = CG.standings(lg, t.div);
  var rank = div.findIndex(function(r){ return r.code===code; }) + 1;
  var pos = rank===1 ? "Top of the "+t.div : rank===div.length ? "Bottom of the "+t.div : ["","","Second","Third"][rank]+" in the "+t.div;
  var sn = parseInt(s.streak.slice(1),10)||0;
  var flavor;
  if (s.streak[0]==="W" && sn>=3) flavor = "winners of "+sn+" straight";
  else if (s.streak[0]==="L" && sn>=3) flavor = "trying to snap a "+sn+"-game skid";
  else if (s.diff >= 15) flavor = "a "+(s.diff>0?"+":"")+s.diff+" goal differential doing the talking";
  else if (s.diff <= -15) flavor = "chasing a "+s.diff+" goal differential";
  else flavor = s.gf+" goals for, "+s.ga+" against";
  return pos+" at "+s.w+"-"+s.l+"-"+s.otl+" — "+flavor+".";
};

/* ---------- TEAMS ---------- */
CG.ROUTES.teams = function(){
  var lg = CG.lg;
  var topL = CG.TOP_LEAGUE;
  var tierBadge = topL ? '<div class="card" style="padding:12px 16px;display:flex;align-items:center;gap:14px">'+
      '<div style="flex:0 0 auto;display:flex;flex-direction:column;align-items:center;justify-content:center;width:46px;height:46px;border-radius:var(--r-s);background:var(--bc);color:var(--on-ink)"><span style="font-family:var(--f-mono);font-size:7.5px;letter-spacing:.12em;opacity:.7">TIER</span><b style="font-family:var(--f-disp);font-size:20px;line-height:1">'+topL.tier+'</b></div>'+
      '<div><div style="font-family:var(--f-disp);font-size:16px;line-height:1.1">'+esc(topL.code)+'</div><div class="caption" style="margin-top:3px">Top tier'+(topL.inspiration?' · modeled on the '+esc(topL.inspiration):'')+'</div></div>'+
    '</div>' : "";
  var head = CG.pageHead("The clubs","Eight franchises. One trophy.","Every club runs a real room — front office, 12-player roster, and a rivalry waiting to happen.", tierBadge);
  var pr = {}; lg.powerRankings.forEach(function(p){ pr[p.team]=p.rank; });
  var cards = CG.TEAMS.map(function(t){
    var s = lg.teams[t.code];
    var note = CG.teamLine(t.code);
    return '<div class="card raise" data-go="#/team/'+t.code+'" role="link" tabindex="0" style="--tc:'+t.color+'">'+
      '<div class="card-b" style="display:flex;flex-direction:column;gap:12px">'+
        '<div style="display:flex;align-items:center;gap:13px">'+CG.crest(t.code,46)+
          '<div style="min-width:0"><b style="font-family:var(--f-disp);font-weight:800;font-size:17px;display:block">'+esc(t.name)+'</b>'+
          '<span class="caption">'+esc(t.city)+' · '+esc(t.arena)+'</span></div>'+
          '<span class="ovrbox '+CG.ovrClass(lg.teamRatings[t.code].ovr)+'" style="margin-left:auto" title="Team overall">'+lg.teamRatings[t.code].ovr+'</span></div>'+
        '<p class="small" style="color:var(--steel)">'+esc(note)+'</p>'+
        '<div style="display:flex;gap:16px;align-items:center;font-family:var(--f-mono);font-size:12px;flex-wrap:wrap">'+
          '<span><b class="num">'+s.w+"-"+s.l+"-"+s.otl+'</b> record</span>'+
          '<span><b class="num">'+s.pts+'</b> pts</span>'+
          '<span>#'+pr[t.code]+' power ranking</span>'+CG.form5(s.last5)+'</div>'+
        '<div style="display:flex;gap:8px"><span class="chip">'+t.div+' Division</span>'+(CG.standings(lg,t.div)[0].code===t.code?'<span class="chip chip-chrome">Division lead</span>':"")+'</div>'+
      '</div></div>';
  }).join("");
  return head + '<div class="shell" style="padding-bottom:40px"><div class="grid g4" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr))">'+cards+'</div></div>';
};

/* ---------- TEAM PAGE ---------- */
CG.ROUTES.team = function(code, qs){
  var t = CG.TEAM[code]; if (!t) return CG.ROUTES._404();
  var lg = CG.lg;
  var seasonKey = (qs.season && CG.lg.archive && CG.lg.archive[qs.season]) ? qs.season : "cur";
  var SD = CG.seasonData(seasonKey);
  var archived = seasonKey!=="cur";
  var s = SD.teams[code];
  var tab = qs.tab||"roster";
  var pr = lg.powerRankings.find(function(p){ return p.team===code; });
  var roster = lg.byTeam[code].slice().sort(function(a,b){
    var ord = {C:0,LW:1,RW:2,LD:3,RD:4,G:5};
    return ord[a.pos]-ord[b.pos] || a.depth-b.depth;
  });
  /* management comes from the real owner/GM/AGM assignment (p.mgmt) in both builds;
     a club may not have named all three yet, so every use below is guarded. */
  var mgmt = { owner: roster.find(function(p){return p.mgmt==="owner";}),
               gm: roster.find(function(p){return p.mgmt==="gm";}),
               agm: roster.find(function(p){return p.mgmt==="agm";}) };
  var head = '<section class="sec-dark" style="padding:clamp(28px,4vw,52px) 0;border-bottom:6px solid '+t.color+'"><div class="shell">'+
    '<div style="display:flex;gap:22px;align-items:center;flex-wrap:wrap">'+CG.crest(code,84)+
      '<div style="min-width:0;flex:1"><span class="eyebrow chr">'+t.div+' Division · '+esc(t.city)+' · '+esc(t.arena)+'</span>'+
        '<h1 class="h-page" style="color:#fff;margin-top:8px">'+esc(t.name)+'</h1>'+
        '<div style="display:flex;gap:18px;margin-top:12px;font-family:var(--f-mono);font-size:12.5px;color:var(--on-ink-dim);flex-wrap:wrap">'+
          '<span><b style="color:#fff" class="num">'+s.w+"-"+s.l+"-"+s.otl+'</b> record</span>'+
          '<span><b style="color:#fff" class="num">'+s.pts+'</b> points</span>'+
          '<span><b style="color:#fff" class="num">'+(s.diff>0?"+":"")+s.diff+'</b> diff</span>'+
          (archived||!pr?'':'<span>#'+pr.rank+' power ranking '+ (pr.move? (pr.move>0?"▲":"▼")+Math.abs(pr.move):"") +'</span>')+
          CG.form5(s.last5)+'</div></div>'+
      (archived?'':'<div style="text-align:center"><span class="ovrbox" style="min-width:64px;height:52px;font-size:26px">'+lg.teamRatings[code].ovr+'</span>'+
        '<span class="caption" style="display:block;margin-top:6px;color:var(--on-ink-dim)">Team overall</span></div>')+'</div>'+
    '<div style="display:flex;gap:8px;margin-top:20px;flex-wrap:wrap;align-items:center">'+
      (mgmt.owner?'<span class="chip chip-ink" style="border-color:#39434B">Owner · '+esc(mgmt.owner.tag)+'</span>':"")+
      (mgmt.gm?'<span class="chip chip-ink" style="border-color:#39434B">GM · '+esc(mgmt.gm.tag)+'</span>':"")+
      (mgmt.agm?'<span class="chip chip-ink" style="border-color:#39434B">AGM · '+esc(mgmt.agm.tag)+'</span>':"")+
      (!mgmt.owner&&!mgmt.gm&&!mgmt.agm?'<span class="chip chip-ink" style="border-color:#39434B">Management not yet named</span>':"")+'</div>'+
    '<div style="display:flex;gap:12px;align-items:center;margin-top:16px;flex-wrap:wrap">'+
      CG.seasonPicker(seasonKey)+
      (archived?'<span class="chip chip-warn">Archived season — final, read-only</span>':'<span class="chip chip-win">Live — updates after every final</span>')+
    '</div>'+
  '</div></section>';
  var tabs = '<div class="shell" style="margin-top:22px"><div class="tabs" role="tablist">'+
    [["roster","Roster"],["games","Schedule & results"],["stats","Team stats"],["moves","Transactions & discipline"],["honors","Honors"]].map(function(x){
      return '<button role="tab" aria-selected="'+(tab===x[0])+'" class="'+(tab===x[0]?"on":"")+'" data-tab="'+x[0]+'">'+x[1]+'</button>';
    }).join("")+'</div></div>';
  var body = '<div class="shell" style="padding:22px 0 40px">';
  if (tab==="roster"){
    body += '<div class="card"><div class="tblwrap"><table class="tbl keepcols"><caption>Roster — '+esc(SD.label)+'</caption><thead><tr>'+
      '<th class="tleft">Player</th><th>POS</th><th>#</th><th>GP</th><th>Pts / Record</th>'+(archived?"":'<th>OVR</th>')+'</tr></thead><tbody>'+
      roster.map(function(p){
        var ps = SD.pstats[p.id], line;
        if (p.pos==="G") line = ps.w+"-"+ps.l+"-"+ps.otl+" · "+(ps.sa?(ps.sv/ps.sa).toFixed(3).replace(/^0/,""):"—");
        else line = ps.p+" pts ("+ps.g+"G "+ps.a+"A)";
        var route = CG.playerRoute(p)+(archived?"?season="+seasonKey:"");
        return '<tr class="rowlink" style="--tc:'+t.color+'" data-go="'+route+'">'+
          '<td class="tleft"><span class="playercell"><span class="nm">'+esc(p.tag)+'</span>'+(p.rookie?' <span class="chip" style="font-size:9px;padding:1px 7px">R</span>':"")+
          (p.mgmt?' <span class="chip chip-chrome" style="font-size:9px;padding:1px 7px">'+(p.mgmt==="owner"?"OWNER":p.mgmt==="gm"?"GM":"AGM")+'</span>':"")+'</span></td>'+
          '<td class="tnum">'+p.pos+'</td><td class="tnum">'+p.jersey+'</td>'+
          '<td>'+ps.gp+'</td><td class="tleft" style="font-family:var(--f-mono);font-size:12px">'+line+'</td>'+
          (archived?"":'<td><span class="ovrbox '+CG.ovrClass(lg.ratings[p.id].ovr)+'" style="min-width:34px;height:24px;font-size:13px">'+lg.ratings[p.id].ovr+'</span></td>')+'</tr>';
      }).join("")+'</tbody></table></div></div>';
  }
  if (tab==="games"){
    if (archived){
      var pgames = SD.results.filter(function(r){ return r.home===code||r.away===code; });
      body += '<div class="card">'+pgames.map(function(r){
        var won = r.score[code] > r.score[r.home===code?r.away:r.home];
        var opp = r.home===code?r.away:r.home;
        return '<div class="notif" style="cursor:default"><span class="nf-ic">'+CG.crest(opp,20)+'</span>'+
          '<span style="min-width:0"><b>'+(r.home===code?"vs ":"at ")+esc(CG.TEAM[opp].name)+'</b>'+
          '<p>Final '+r.score[code]+'–'+r.score[opp]+(r.ot?" (OT)":"")+'</p></span>'+
          '<span class="chip '+(won?"chip-win":"chip-loss")+'">'+(won?"W":"L")+'</span></div>';
      }).join("")+
      '<div class="card-b" style="border-top:1px solid var(--line)"><span class="caption">Exhibition finals from '+esc(SD.label)+' — archived for the record.</span></div></div>';
    } else {
      var games = lg.schedule.filter(function(g){ return g.home===code||g.away===code; });
      body += '<div class="stack" style="gap:9px">'+games.map(CG.gameCard).join("")+'</div>';
    }
  }
  if (tab==="stats"){
    var gp = Math.max(1,s.gp);
    var goalies = roster.filter(function(p){ return p.pos==="G"; });
    var svp = goalies.reduce(function(a,p){ return a+SD.pstats[p.id].sv; },0) / Math.max(1,goalies.reduce(function(a,p){ return a+SD.pstats[p.id].sa; },0));
    body += '<div class="grid g4" style="grid-template-columns:repeat(auto-fill,minmax(190px,1fr))">'+
      [["Goals per game",(s.gf/gp).toFixed(2)],["Goals against per game",(s.ga/gp).toFixed(2)],
       ["Team save percentage",svp.toFixed(3).replace(/^0/,"")],["Shots per game",(s.sf/gp).toFixed(1)],
       ["Shots against per game",(s.sa/gp).toFixed(1)],["Home record",s.hw+"-"+s.hl],["Road record",s.aw+"-"+s.al],
       ["Points percentage",(s.ptsPct*100).toFixed(0)+"%"]].map(function(kv){
        return '<div class="kpi" style="cursor:default"><b class="num">'+kv[1]+'</b><span>'+kv[0]+'</span></div>';
      }).join("")+'</div>'+
      (archived
        ? '<div class="note" style="margin-top:18px"><b style="font-family:var(--f-disp)">'+esc(SD.label)+' — final.</b> Archived team numbers are frozen exactly as the season ended. Overall ratings and power rankings are computed per season and live on the current campaign only.</div>'
        : '<div class="card" style="margin-top:18px"><div class="card-h"><h3>Overall rating breakdown</h3><span class="chip">Formula v1 · configurable</span></div><div class="card-b">'+
      Object.keys(lg.teamRatings[code].parts).map(function(k){
        var v = lg.teamRatings[code].parts[k];
        return '<div class="rbar"><span class="rb-lab">'+k+'</span><span class="rb-track"><span class="rb-fill" style="width:'+v+'%"></span></span><span class="rb-v num">'+v+'</span></div>';
      }).join("")+
      '<p class="caption" style="margin-top:10px">Team overall blends record, goal differential, goaltending, roster depth, and recent form. The commissioner can re-weight the formula in the Control Center — every number traces to real results.</p></div></div>');
  }
  if (tab==="moves" && archived){
    body += '<div class="card"><div class="empty"><div class="e-art">'+CG.ic("swap",22)+'</div><b>No transactions in '+esc(SD.label)+'</b><p>Rosters were frozen for the exhibition slate; league transactions began with Season 1.</p></div></div>';
  }
  else if (tab==="moves"){
    /* the real transaction log has no team column — match this club's name or code in the text */
    var tx = (lg.liveTransactions||[]).filter(function(x){
      var s = (x.text||"");
      return s.indexOf(t.name)>=0 || new RegExp("\\b"+code+"\\b").test(s);
    }).slice(0,12);
    var sus = lg.suspensions.filter(function(x){ return x.team===code; });
    body += '<div class="grid g2"><div class="card"><div class="card-h"><h3>Transactions</h3></div>'+
      (tx.length?tx.map(function(x){ return '<div class="notif" style="cursor:default"><span class="nf-ic">'+CG.ic(x.type==="trade"?"swap":x.type==="draft"?"grid":x.type==="sign"?"check":"flag",15)+'</span><span style="min-width:0"><p style="font-weight:600">'+CG.txText(x.text)+'</p></span><span class="nf-t">'+(x.dateIso?CG.fmtDate(x.dateIso):"")+'</span></div>'; }).join(""):
        '<div class="empty"><b>No transactions</b><p>Trades, signings, waivers, and placements involving this club appear here when they happen.</p></div>')+'</div>'+
      '<div class="card"><div class="card-h"><h3>Discipline</h3></div>'+
      (sus.length?sus.map(function(x){ var p = CG.playerById(lg,x.playerId);
        return '<div class="notif" style="cursor:default"><span class="nf-ic" style="color:var(--red)">'+CG.ic("flag",15)+'</span><span><b>'+esc(p.tag)+' — '+x.games+'-game suspension ('+x.status+')</b><p>'+esc(x.reason)+'</p></span><span class="nf-t">'+CG.fmtDate(x.issued)+'</span></div>'; }).join(""):
        '<div class="empty"><b>Clean sheet</b><p>No suspensions or warnings on record for this club.</p></div>')+'</div></div>';
  }
  if (tab==="honors" && archived){
    body += '<div class="card"><div class="empty"><div class="e-art">'+CG.ic("trophy",22)+'</div><b>No honors in '+esc(SD.label)+'</b><p>Weekly hardware began with Season 1 — exhibition games didn’t award stars or Players of the Week.</p></div></div>';
  }
  else if (tab==="honors"){
    var wins = lg.potw.filter(function(w){ return CG.playerById(lg,w.skater).team===code || CG.playerById(lg,w.goalie).team===code; });
    body += wins.length ? '<div class="grid g3">'+wins.map(function(w){
      var p = CG.playerById(lg, CG.playerById(lg,w.skater).team===code ? w.skater : w.goalie);
      return '<div class="card raise" data-go="'+CG.playerRoute(p)+'"><div class="card-b" style="display:flex;gap:12px;align-items:center">'+
        CG.crest(code,34)+'<div><span class="chip chip-chrome">Week '+w.week+' POTW</span><b style="display:block;font-family:var(--f-disp);margin-top:6px">'+esc(p.tag)+'</b></div></div></div>';
    }).join("")+'</div>' : '<div class="card"><div class="empty"><div class="e-art">'+CG.ic("trophy",22)+'</div><b>No hardware yet</b><p>Weekly honors and season awards land here once this club starts collecting them.</p></div></div>';
  }
  body += '</div>';
  return head + tabs + body;
};
CG.AFTER.team = function(code, qs){
  var season = (qs&&qs.season)||"";
  $$("[data-tab]").forEach(function(b){ b.addEventListener("click", function(){
    location.hash="#/team/"+code+"?tab="+this.getAttribute("data-tab")+(season&&season!=="cur"?"&season="+season:"");
  }); });
  var sp = $("#seasonPick");
  if (sp) sp.addEventListener("change", function(){
    var v = this.value;
    location.hash = "#/team/"+code+(v!=="cur"?"?season="+v:"");
  });
};

/* ---------- PLAYERS DIRECTORY ---------- */
CG.ROUTES.players = function(param, qs){
  var lg = CG.lg;
  var fTeam = qs.team||"", fPos = qs.pos||"", fQ = (qs.q||"").toLowerCase(), fFlag = qs.flag||"";
  var head = CG.pageHead("Player directory","Every skater. Every tendy.","96 rostered players across eight clubs. Ratings update nightly from real box scores.");
  var filters = '<div class="shell" style="margin-bottom:20px"><div class="filters">'+
    '<input type="search" id="pQ" placeholder="Search gamertag…" value="'+esc(qs.q||"")+'" style="max-width:230px" aria-label="Search players">'+
    '<select id="pTeam" style="max-width:200px" aria-label="Filter by club"><option value="">All clubs</option>'+CG.TEAMS.map(function(t){ return '<option value="'+t.code+'"'+(fTeam===t.code?" selected":"")+'>'+esc(t.name)+'</option>'; }).join("")+'</select>'+
    '<select id="pPos" style="max-width:150px" aria-label="Filter by position"><option value="">All positions</option>'+["LW","C","RW","LD","RD","G"].map(function(p){ return '<option'+(fPos===p?" selected":"")+'>'+p+'</option>'; }).join("")+'</select>'+
    '<div class="seg"><button data-flag="" class="'+(fFlag===""?"on":"")+'">All</button><button data-flag="rookie" class="'+(fFlag==="rookie"?"on":"")+'">Rookies</button><button data-flag="susp" class="'+(fFlag==="susp"?"on":"")+'">Suspended</button></div>'+
  '</div></div>';
  var list = lg.players.filter(function(p){
    if (fTeam && p.team!==fTeam) return false;
    if (fPos && p.pos!==fPos) return false;
    if (fQ && p.tag.toLowerCase().indexOf(fQ)<0) return false;
    if (fFlag==="rookie" && !p.rookie) return false;
    if (fFlag==="susp" && !lg.suspensions.some(function(s){ return s.playerId===p.id && s.status!=="served"; })) return false;
    return true;
  }).sort(function(a,b){ return lg.ratings[b.id].ovr - lg.ratings[a.id].ovr; });
  var rows = list.map(function(p){
    var s = lg.pstats[p.id];
    var stat = p.pos==="G" ? (s.gp? (s.sv/Math.max(1,s.sa)).toFixed(3).replace(/^0/,"")+" SV%" : "—") : s.p+" pts";
    return '<tr class="rowlink" style="--tc:'+CG.TEAM[p.team].color+'" data-go="'+CG.playerRoute(p)+'">'+
      '<td class="tleft"><span class="playercell">'+CG.crest(p.team,24)+'<span><span class="nm">'+esc(p.tag)+'</span><small>'+esc(CG.TEAM[p.team].name)+'</small></span>'+
        (p.rookie?'<span class="chip" style="font-size:9px;padding:1px 7px">R</span>':"")+'</span></td>'+
      '<td class="tnum">'+p.pos+'</td><td class="tnum">'+p.jersey+'</td>'+
      '<td class="tnum">'+s.gp+'</td><td class="tleft tnum" style="font-size:12px">'+stat+'</td>'+
      '<td><span class="ovrbox '+CG.ovrClass(lg.ratings[p.id].ovr)+'" style="min-width:34px;height:24px;font-size:13px">'+lg.ratings[p.id].ovr+'</span></td></tr>';
  }).join("");
  var body = list.length
    ? '<div class="card"><div class="card-h"><h3>'+list.length+' players</h3><span class="chip">Sorted by overall</span></div>'+
      '<div class="tblwrap"><table class="tbl keepcols"><thead><tr><th class="tleft">Player</th><th>POS</th><th>#</th><th>GP</th><th class="tleft">Season</th><th>OVR</th></tr></thead><tbody>'+rows+'</tbody></table></div></div>'
    : '<div class="empty"><div class="e-art">'+CG.ic("user",22)+'</div><b>No players match</b><p>Loosen the filters — every rostered player in the league lives in this directory.</p></div>';
  return head + filters + '<div class="shell" style="padding-bottom:40px">'+body+'</div>';
};
CG.AFTER.players = function(param, qs){
  function nav(patch){
    var q = Object.assign({team:qs.team||"",pos:qs.pos||"",q:qs.q||"",flag:qs.flag||""}, patch);
    location.hash = "#/players?team="+q.team+"&pos="+q.pos+"&q="+encodeURIComponent(q.q)+"&flag="+q.flag;
  }
  $("#pTeam").addEventListener("change", function(){ nav({team:this.value}); });
  $("#pPos").addEventListener("change", function(){ nav({pos:this.value}); });
  $$("[data-flag]").forEach(function(b){ b.addEventListener("click", function(){ nav({flag:this.getAttribute("data-flag")}); }); });
  /* live in-place filter — no re-render, so the suggestion menu and focus survive typing */
  var pq = $("#pQ");
  function filterRows(){
    var q = pq.value.trim().toLowerCase();
    var rows = $$("#app table tbody tr"), shown = 0;
    rows.forEach(function(tr){
      var hit = !q || tr.textContent.toLowerCase().indexOf(q)>=0;
      tr.style.display = hit ? "" : "none";
      if (hit) shown++;
    });
    var h = $("#app .card-h h3");
    if (h) h.textContent = shown+" player"+(shown===1?"":"s");
  }
  pq.addEventListener("input", function(){ if (!this.dataset.acId) filterRows(); });
  CG.attachAC(pq, { kinds:["players"],
    onPick: function(it){ location.hash = "#/player/"+it.id; },
    onClear: filterRows
  });
};

/* ---------- PLAYER PROFILE ---------- */
CG.ROUTES.player = function(pid, qs){
  var lg = CG.lg;
  var p = lg.players.find(function(x){ return x.id===pid; });
  if (!p) return CG.ROUTES._404();
  var seasonKey = (qs.season && CG.lg.archive && CG.lg.archive[qs.season]) ? qs.season : "cur";
  var SD = CG.seasonData(seasonKey);
  var archived = seasonKey!=="cur";
  var t = CG.TEAM[p.team], s = SD.pstats[p.id], r = lg.ratings[p.id];
  var tab = qs.tab||"overview";
  var sus = lg.suspensions.find(function(x){ return x.playerId===p.id; });
  var isG = p.pos==="G";
  var me = CG.me();
  var canSeeAvail = CG.role()==="commish" || CG.role()==="staff" || (me && me.team===p.team && CG.can("availability.viewTeam")) || (me && me.id===p.id);
  var head = '<section class="sec-dark" style="padding:clamp(28px,4vw,52px) 0;border-bottom:6px solid '+t.color+'"><div class="shell">'+
    '<div style="display:flex;gap:22px;align-items:center;flex-wrap:wrap">'+
      (t.logo
        ? '<img class="crest" src="'+t.logo+'" width="104" height="110" style="object-fit:contain" alt="'+esc(t.name)+' logo">'
        : '<div style="flex-shrink:0">'+CG.crest(p.team,84)+'</div>')+
      '<div style="min-width:0;flex:1"><span class="eyebrow chr">'+esc(t.name)+' · '+CG.POS_NAME[p.pos]+' · #'+p.jersey+'</span>'+
        '<h1 class="h-page" style="color:#fff;margin-top:8px">'+esc(p.tag)+'</h1>'+
        '<div style="display:flex;gap:9px;margin-top:12px;flex-wrap:wrap">'+
          (p.rookie?'<span class="chip chip-chrome">Rookie</span>':"")+
          '<span class="chip chip-ink" style="border-color:#39434B">'+esc(p.platform)+'</span>'+
          (p.twitchLive&&p.twitch?'<a class="chip" target="_blank" rel="noopener" href="https://twitch.tv/'+encodeURIComponent(p.twitch)+'" style="background:'+CG.TWITCH_PURPLE+';border-color:'+CG.TWITCH_PURPLE+';color:#fff"><span class="live-dot"></span>LIVE on Twitch</a>':"")+
          (!archived?'<span class="chip chip-ink" style="border-color:#39434B">'+
            (p.mgmt?(p.mgmt==="owner"?"Owner":p.mgmt==="gm"?"GM":"AGM")+" · "+CG.fmtMoney(p.salary):CG.fmtMoney(p.salary)+" · "+p.term+" yr")+'</span>':"")+
          (sus? (sus.status==="served"
            ? '<span class="chip chip-warn">Suspension served</span>'
            : '<span class="chip chip-loss">Suspended</span>') : "")+
          (canSeeAvail?'<span class="chip chip-win">'+esc(CG.WEEK8.label)+' availability: '+(CG.availGet(p.id)?"submitted":"not submitted")+'</span>':"")+
        '</div></div>'+
      '<div style="text-align:center"><span class="ovrbox" style="min-width:64px;height:52px;font-size:26px">'+r.ovr+'</span>'+
        '<span class="caption" style="display:block;margin-top:6px;color:var(--on-ink-dim)">Overall · from results</span></div></div>'+
    '<div style="display:flex;gap:12px;align-items:center;margin-top:20px;flex-wrap:wrap">'+
      CG.seasonPicker(seasonKey)+
      (archived?'<span class="chip chip-warn">Archived season — final, read-only</span>':'<span class="chip chip-win">Live — updates after every final</span>')+
    '</div>'+
  '</div></section>';
  var tabs = '<div class="shell" style="margin-top:22px"><div class="tabs" role="tablist">'+
    [["overview","Overview"],["log","Game log"],["honors","Honors & history"]].map(function(x){
      return '<button role="tab" aria-selected="'+(tab===x[0])+'" class="'+(tab===x[0]?"on":"")+'" data-tab="'+x[0]+'">'+x[1]+'</button>'; }).join("")+'</div></div>';
  var body = '<div class="shell" style="padding:22px 0 40px">';
  if (tab==="overview"){
    var cells = isG
      ? [["GP",s.gp],["Record",s.w+"-"+s.l+"-"+s.otl],["SV%",s.sa?(s.sv/s.sa).toFixed(3).replace(/^0/,""):"—"],["GAA",s.gp?(s.ga/s.gp).toFixed(2):"—"],["Shutouts",s.so],["Quality starts",s.qs]]
      : [["GP",s.gp],["Goals",s.g],["Assists",s.a],["Points",s.p],["+/-",(s.pm>0?"+":"")+s.pm],["Shots",s.shots],["Shooting%",s.shots?Math.round(100*s.g/s.shots)+"%":"—"],["Hits",s.hits],["Blocks",s.blk],["Takeaways",s.tk],["PIM",s.pim],["GWG",s.gwg]];
    var sideCard = archived
      ? '<div class="card"><div class="card-h"><h3>'+esc(SD.label)+'</h3><span class="chip">Final</span></div><div class="card-b">'+
        '<p class="small" style="color:var(--steel);line-height:1.65">This season is archived — the line above is final and read-only. Overall ratings are computed per season, so archived seasons keep their stat lines while the rating on the header always reflects the current campaign.</p>'+
        '<a class="btn btn-ghost btn-sm" style="margin-top:12px" href="#/player/'+p.id+'">Back to the current season</a></div></div>'
      : '<div class="card"><div class="card-h"><h3>Rating breakdown</h3><span class="chip">OVR '+r.ovr+'</span></div><div class="card-b">'+
        Object.keys(r.parts).map(function(k){
          return '<div class="rbar"><span class="rb-lab">'+k+'</span><span class="rb-track"><span class="rb-fill" style="width:'+r.parts[k]+'%"></span></span><span class="rb-v num">'+r.parts[k]+'</span></div>';
        }).join("")+
        '<p class="caption" style="margin-top:10px">Weighted blend, regressed toward league average under small samples. Weights are commissioner-configurable; every input is a real recorded stat.</p>'+
      '</div></div>';
    var scout = archived
      ? p.tag+" finished the preseason with "+(p.pos==="G"
          ? (s.gp? s.gp+" appearance"+(s.gp>1?"s":"")+", a "+(s.sa?(s.sv/s.sa).toFixed(3).replace(/^0/,""):"—")+" save percentage and a "+s.w+"-"+s.l+"-"+s.otl+" record." : "no game action.")
          : (s.gp? s.gp+" games played and "+s.p+" points ("+s.g+"G, "+s.a+"A) on "+s.shots+" shots." : "no game action."))+" Archived totals never change."
      : CG.scoutLine(p);
    /* advanced EA metrics — only when real box scores exist (auto-imported) */
    var hasAdv = !archived && s.gp>0 && s.toi!=null;
    var advCells = isG
      ? [["TOI/GP", s.gp?CG.fmtToi(s.toi/s.gp):"—"],["Brk SV%", s.brkShots?Math.round(100*s.brkSv/s.brkShots)+"%":"—"],
         ["Brk saves",(s.brkSv||0)+"/"+(s.brkShots||0)],["Poke checks", s.pokes||0]]
      : [["TOI/GP", s.gp?CG.fmtToi(s.toi/s.gp):"—"],["PPG", s.ppg||0],["SHG", s.shg||0],["Giveaways", s.gv||0],
         ["Pass%", s.passAtt?Math.round(100*s.pass/s.passAtt)+"%":"—"],["Poss/GP",(s.gp&&s.poss!=null)?CG.fmtToi(s.poss/s.gp):"—"],
         ["Shot att.", s.sat||0],["Interceptions", s.intc||0],["Pen. drawn", s.pdrawn||0],["Deflections", s.defl||0],["Saucer", s.saucer||0],
         ["EA OFF", s._ratN?(+s.ratOff).toFixed(1):"—"],["EA DEF", s._ratN?(+s.ratDef).toFixed(1):"—"],["EA TP", s._ratN?(+s.ratTeam).toFixed(1):"—"]];
    var advCard = hasAdv ? '<div class="card" style="margin-top:18px"><div class="card-h"><h3>Advanced — from EA box scores</h3><span class="chip chip-chrome">Auto-imported</span></div><div class="card-b">'+
      '<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(118px,1fr));gap:12px">'+
      advCells.map(function(kv){ return '<div class="kpi" style="cursor:default"><b class="num" style="font-size:20px">'+kv[1]+'</b><span>'+kv[0]+'</span></div>'; }).join("")+'</div>'+
      '<p class="caption" style="margin-top:12px">Every figure is pulled automatically from the EA NHL match record — no manual entry.</p></div></div>' : '';
    /* pre-season line — separate from the season, but part of the overall rating */
    var ps = (!archived && CG.lg.pre && CG.lg.pre.pstats) ? CG.lg.pre.pstats[p.id] : null;
    var preCard = (ps && ps.gp>0) ? '<div class="card" style="margin-top:18px"><div class="card-h"><h3>Pre-season</h3><span class="chip">'+ps.gp+' GP · counts toward overall</span></div><div class="card-b">'+
      '<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(118px,1fr));gap:12px">'+
      (isG ? [["GP",ps.gp],["Record",ps.w+"-"+ps.l+"-"+ps.otl],["SV%",ps.sa?(ps.sv/ps.sa).toFixed(3).replace(/^0/,""):"—"],["GAA",ps.gp?(ps.ga/ps.gp).toFixed(2):"—"],["Shutouts",ps.so]]
           : [["GP",ps.gp],["Goals",ps.g],["Assists",ps.a],["Points",ps.p],["+/-",(ps.pm>0?"+":"")+ps.pm],["Shots",ps.shots]])
        .map(function(kv){ return '<div class="kpi" style="cursor:default"><b class="num" style="font-size:20px">'+kv[1]+'</b><span>'+kv[0]+'</span></div>'; }).join("")+'</div>'+
      '<p class="caption" style="margin-top:12px">Pre-season games stay out of the league standings but count toward the overall rating — and toward the five games that make a first-year player draft-eligible.</p></div></div>' : '';
    body += '<div class="grid g23"><div>'+
      '<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:12px">'+
      cells.map(function(kv){ return '<div class="kpi" style="cursor:default"><b class="num" style="font-size:24px">'+kv[1]+'</b><span>'+kv[0]+'</span></div>'; }).join("")+'</div>'+
      '<div class="card" style="margin-top:18px"><div class="card-h"><h3>'+(archived?"Season summary":"Scouting the numbers")+'</h3><span class="chip">'+(archived?"Archived":"Derived from box scores")+'</span></div><div class="card-b">'+
        '<p class="small" style="color:var(--steel);line-height:1.65">'+esc(scout)+'</p></div></div>'+preCard+advCard+'</div>'+
      '<div class="stack">'+sideCard+(archived?"":
        '<div class="card"><div class="card-h"><h3>Contract</h3>'+
        (p.mgmt?'<span class="chip chip-chrome">'+(p.mgmt==="owner"?"Owner":p.mgmt==="gm"?"GM":"AGM")+'</span>':'<span class="chip">Under contract</span>')+'</div><div class="card-b">'+
        '<div style="display:flex;gap:26px;flex-wrap:wrap">'+
          '<div><b class="num" style="font-size:22px">'+CG.fmtMoney(p.salary)+'</b><span class="caption" style="display:block">Cap hit</span></div>'+
          '<div><b class="num" style="font-size:22px">'+p.term+' yr'+(p.term>1?"s":"")+'</b><span class="caption" style="display:block">Term remaining</span></div></div>'+
        '<p class="caption" style="margin-top:12px">'+(p.mgmt
          ? "Management contracts (Owner, GM, AGM) carry a fixed cap value and are protected from waivers and trades (Rule 2.6)."
          : "Counts against the club’s $"+(CG.CAP/1000000)+"M cap. Contracts run one to three seasons; expiring deals return to free agency (Rule 2.5).")+'</p>'+
        '</div></div>')+CG.broadcastCard(p)+'</div></div>';
  }
  if (tab==="log"){
    var log = SD.glog[p.id];
    body += log.length ? '<div class="card"><div class="tblwrap"><table class="tbl keepcols"><caption>Game-by-game — '+esc(SD.label)+'</caption><thead><tr>'+
      (isG?'<th>Wk</th><th class="tleft">Opponent</th><th>SA</th><th>SV</th><th>GA</th><th>Result</th>'
          :'<th>Wk</th><th class="tleft">Opponent</th><th>G</th><th>A</th><th>P</th><th>S</th><th>+/-</th><th>PIM</th>')+
      '</tr></thead><tbody>'+log.map(function(en){
        var b = en.line;
        var link = archived ? '' : ' class="rowlink" data-go="#/matchup/'+en.game+'"';
        return '<tr'+link+'><td class="tnum">'+en.week+'</td>'+
          '<td class="tleft"><span class="teamcell">'+CG.crest(en.opp,22)+'<span class="nm">'+esc(CG.TEAM[en.opp].name)+'</span></span></td>'+
          (isG? '<td>'+b.sa+'</td><td>'+b.sv+'</td><td>'+b.ga+'</td><td><span class="chip '+(b.w?"chip-win":"chip-loss")+'">'+(b.w?"W":b.otl?"OTL":"L")+(b.so?" · SO":"")+'</span></td>'
              : '<td class="'+(b.g?"":"z")+'">'+b.g+'</td><td class="'+(b.a?"":"z")+'">'+b.a+'</td><td class="pts">'+(b.g+b.a)+'</td><td>'+b.shots+'</td><td>'+(b.pm>0?"+":"")+b.pm+'</td><td class="'+(b.pim?"":"z")+'">'+b.pim+'</td>')+
          '</tr>';
      }).join("")+'</tbody></table></div>'+
      (archived?'<div class="card-b" style="border-top:1px solid var(--line)"><span class="caption">Archived box scores are kept for the record; match pages are only linked for the current season.</span></div>':"")+'</div>'
    : '<div class="card"><div class="empty"><div class="e-art">'+CG.ic("chart",22)+'</div><b>No games recorded'+(archived?" that season":" yet")+'</b><p>'+(archived?"This player didn’t draw into a lineup during "+esc(SD.label)+".":"This player hasn’t drawn into a lineup — the game log fills in after their first shift.")+'</p></div></div>';
    /* pre-season game log — its own table, never mixed into the season's */
    var preLog = (!archived && CG.lg.pre && CG.lg.pre.glog && CG.lg.pre.glog[p.id]) || [];
    if (preLog.length){
      body += '<div class="card" style="margin-top:18px"><div class="card-h"><h3>Pre-season games</h3><span class="chip">'+preLog.length+' GP</span></div>'+
        '<div class="tblwrap"><table class="tbl keepcols"><caption class="sr">Pre-season game log</caption><thead><tr>'+
        (isG?'<th>Wk</th><th class="tleft">Opponent</th><th>SA</th><th>SV</th><th>GA</th><th>Result</th>'
            :'<th>Wk</th><th class="tleft">Opponent</th><th>G</th><th>A</th><th>P</th><th>S</th><th>+/-</th><th>PIM</th>')+
        '</tr></thead><tbody>'+preLog.map(function(en){
          var b = en.line;
          return '<tr class="rowlink" data-go="#/matchup/'+en.game+'"><td class="tnum">'+en.week+'</td>'+
            '<td class="tleft"><span class="teamcell">'+CG.crest(en.opp,22)+'<span class="nm">'+esc(CG.TEAM[en.opp].name)+'</span></span></td>'+
            (isG? '<td>'+b.sa+'</td><td>'+b.sv+'</td><td>'+b.ga+'</td><td><span class="chip '+(b.w?"chip-win":"chip-loss")+'">'+(b.w?"W":b.otl?"OTL":"L")+(b.so?" · SO":"")+'</span></td>'
                : '<td class="'+(b.g?"":"z")+'">'+b.g+'</td><td class="'+(b.a?"":"z")+'">'+b.a+'</td><td class="pts">'+(b.g+b.a)+'</td><td>'+b.shots+'</td><td>'+(b.pm>0?"+":"")+b.pm+'</td><td class="'+(b.pim?"":"z")+'">'+b.pim+'</td>')+
            '</tr>';
        }).join("")+'</tbody></table></div></div>';
    }
  }
  if (tab==="honors" && archived){
    body += '<div class="card"><div class="empty"><div class="e-art">'+CG.ic("trophy",22)+'</div><b>No honors in '+esc(SD.label)+'</b><p>Weekly hardware — Three Stars and Players of the Week — began with Season 1. Preseason games were exhibitions.</p></div></div>';
  }
  else if (tab==="honors"){
    var potws = lg.potw.filter(function(w){ return w.skater===p.id||w.goalie===p.id; });
    var starN = lg.results.reduce(function(acc,r2){ return acc + (r2.stars.some(function(st){ return st.pid===p.id; })?1:0); },0);
    body += '<div class="grid g3">'+
      '<div class="kpi" style="cursor:default"><b class="num">'+potws.length+'</b><span>Player of the Week awards</span></div>'+
      '<div class="kpi" style="cursor:default"><b class="num">'+starN+'</b><span>Three Stars selections</span></div>'+
      '<div class="kpi" style="cursor:default"><b class="num">'+(sus?sus.games:0)+'</b><span>Suspension games</span></div></div>'+
      (potws.length?'<div class="card" style="margin-top:18px"><div class="card-h"><h3>Weekly honors</h3></div>'+potws.map(function(w){
        var blurb = (CG.CONTENT.awards.potw.find(function(x){ return x.week===w.week; })||{});
        return '<div class="notif" style="cursor:default"><span class="nf-ic">'+CG.ic("trophy",15)+'</span><span><b>Week '+w.week+' — '+(w.skater===p.id?"Skater":"Goaltender")+' of the Week</b>'+
          '<p>'+esc(w.skater===p.id?blurb.skaterBlurb||"":blurb.goalieBlurb||"")+'</p></span></div>';
      }).join("")+'</div>':"")+
      (sus?'<div class="note red" style="margin-top:18px"><b style="display:block;font-family:var(--f-disp)">Discipline record</b>'+esc(sus.reason)+' — '+sus.games+' games, '+sus.status+'. Issued '+CG.fmtDate(sus.issued)+' by '+esc(sus.decidedBy)+'. <a href="#/rulebook?rule=7.4" style="font-weight:700;border-bottom:2px solid var(--chrome)">Rule 7.4 →</a></div>':"")+
      '<div class="card" style="margin-top:18px"><div class="card-h"><h3>Team history</h3></div><div class="notif" style="cursor:default"><span class="nf-ic">'+CG.ic("users",15)+'</span><span><b>'+esc(t.name)+'</b><p>Signed '+esc(p.joined)+' · Season 1 original roster</p></span></div></div>';
  }
  body += '</div>';
  return head + tabs + body;
};
/* Twitch broadcast card on the profile: watch link for everyone; the profile's own
   player also gets Go Live / End Stream + channel controls. Omitted entirely when
   there's no handle and it isn't your profile. */
CG.broadcastCard = function(p){
  var isMine = !!(CG.auth && CG.auth.user && CG.auth.user.id===p.id);
  if (!p.twitch && !isMine) return "";
  var h = '<div class="card"><div class="card-h"><h3>Broadcast</h3>'+
    (p.twitchLive&&p.twitch?'<span class="chip chip-live"><span class="live-dot"></span>LIVE</span>':'<span class="chip">Twitch</span>')+'</div><div class="card-b">';
  if (p.twitch){
    h += '<p class="small" style="color:var(--steel)">'+(p.twitchLive
        ? esc(p.tag)+" is live right now — game cards across the site are flagged."
        : "Streams league games at twitch.tv/"+esc(p.twitch)+".")+'</p>'+
      '<a class="btn btn-sm" target="_blank" rel="noopener" href="https://twitch.tv/'+encodeURIComponent(p.twitch)+'" style="margin-top:12px;background:'+CG.TWITCH_PURPLE+';color:#fff">Watch on Twitch</a>';
  } else {
    h += '<p class="small" style="color:var(--steel)">Add your Twitch channel and go live on game nights — your profile and the night’s game cards flag it automatically.</p>';
  }
  if (isMine){
    h += '<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">'+
      (p.twitch?'<button class="btn btn-ghost btn-sm" id="twToggle">'+(p.twitchLive?"End stream":"Go live")+'</button>':"")+
      '<button class="btn btn-ghost btn-sm" id="twChange">'+(p.twitch?"Change channel":"Add channel")+'</button></div>';
  }
  return h+'</div></div>';
};
CG.scoutLine = function(p){
  var lg = CG.lg, s = lg.pstats[p.id], r = lg.ratings[p.id];
  if (p.pos==="G"){
    if (!s.gp) return p.tag+" has yet to see game action this season, so there is no performance record to evaluate.";
    var svp = (s.sv/Math.max(1,s.sa)).toFixed(3).replace(/^0/,"");
    return p.tag+" has started "+s.gp+" of "+lg.teams[p.team].gp+" club games with a "+svp+" save percentage and a "+
      (s.ga/Math.max(1,s.gp)).toFixed(2)+" goals-against average ("+s.w+"-"+s.l+"-"+s.otl+"). "+
      (s.so?("Has "+s.so+" shutout"+(s.so>1?"s":"")+" and "):"Has ")+s.qs+" quality starts in "+s.gp+" appearances. Every figure here is aggregated from recorded box scores.";
  }
  if (!s.gp) return p.tag+" has not drawn into a lineup yet this season — no conclusions until the sample exists.";
  var ppg = (s.p/s.gp).toFixed(2);
  return p.tag+" is producing "+ppg+" points per game across "+s.gp+" games ("+s.g+"G, "+s.a+"A), shooting "+
    (s.shots?Math.round(100*s.g/s.shots):0)+"% with a "+(s.pm>0?"+":"")+s.pm+" rating. Defensive activity — "+
    s.blk+" blocks, "+s.tk+" takeaways, "+s.hits+" hits — rates "+ (r.parts.defense>=60?"above":"near")+" the league bar for the position. Discipline: "+
    s.pim+" PIM. This summary is computed from verified game data only.";
};
CG.AFTER.player = function(pid, qs){
  var season = (qs&&qs.season)||"";
  $$("[data-tab]").forEach(function(b){ b.addEventListener("click", function(){
    location.hash="#/player/"+pid+"?tab="+this.getAttribute("data-tab")+(season&&season!=="cur"?"&season="+season:"");
  }); });
  var sp = $("#seasonPick");
  if (sp) sp.addEventListener("change", function(){
    var v = this.value;
    location.hash = "#/player/"+pid+(v!=="cur"?"?season="+v:"");
  });
  /* Twitch controls (own profile only) */
  var twT = $("#twToggle");
  if (twT) twT.addEventListener("click", function(){
    var me = CG.lg.players.find(function(x){ return x.id===pid; });
    CG.setTwitchLive(!(me && me.twitchLive));
  });
  var twC = $("#twChange");
  if (twC) twC.addEventListener("click", CG.setTwitchHandle);
};

/* ---------- STATS CENTRAL ---------- */
CG.ROUTES.stats = function(param, qs){
  var lg = CG.lg;
  var tab = qs.tab||"skaters", minGp = qs.min===undefined? 3 : +qs.min, fTeam = qs.team||"";
  var head = CG.pageHead("Stat central","League statistics",
    "Sortable, filterable, exportable. "+(lg.results.length
      ? "Auto-imported from EA box scores after every final — "+lg.results.length+" game"+(lg.results.length===1?"":"s")+" recorded."
      : "Every category fills in automatically from EA box scores once the season starts.")
    ,'<button class="btn btn-ghost btn-sm" id="csvStats" style="align-self:flex-end">'+CG.ic("dl",14)+'Export view</button>');
  var tabs = '<div class="shell"><div class="tabs" role="tablist">'+
    [["skaters","Skaters"],["advanced","Advanced"],["goalies","Goaltenders"],["teams","Teams"]].map(function(x){
      return '<button role="tab" aria-selected="'+(tab===x[0])+'" class="'+(tab===x[0]?"on":"")+'" data-tab="'+x[0]+'">'+x[1]+'</button>'; }).join("")+'</div>'+
    '<div class="filters" style="margin:16px 0 18px">'+
    (tab!=="teams"?'<select id="sTeam" style="max-width:190px" aria-label="Filter by club"><option value="">All clubs</option>'+CG.TEAMS.map(function(t){ return '<option value="'+t.code+'"'+(fTeam===t.code?" selected":"")+'>'+esc(t.name)+'</option>'; }).join("")+'</select>':"")+
    (tab!=="teams"?'<label style="display:flex;align-items:center;gap:8px;font-family:var(--f-mono);font-size:12px;color:var(--steel)">Min GP <input type="number" id="sMin" min="0" max="12" value="'+minGp+'" style="width:70px"></label>':"")+
    '<span class="caption">Click a column to sort.</span></div>';
  var table;
  if (tab==="skaters"){
    var list = lg.players.filter(function(p){ return p.pos!=="G" && lg.pstats[p.id].gp>=minGp && (!fTeam||p.team===fTeam); })
      .sort(function(a,b){ return lg.pstats[b.id].p-lg.pstats[a.id].p; });
    table = '<table class="tbl keepcols" id="statTbl"><caption>Skater statistics — minimum '+minGp+' GP</caption><thead><tr>'+
      '<th class="tleft">Player</th><th class="sortable">GP</th><th class="sortable">G</th><th class="sortable">A</th><th class="sortable sorted">P</th><th class="sortable">P/GP</th><th class="sortable">+/-</th><th class="sortable">S</th><th class="sortable">S%</th><th class="sortable">HIT</th><th class="sortable">BLK</th><th class="sortable">TK</th><th class="sortable">PIM</th><th class="sortable">GWG</th><th class="sortable">FO%</th></tr></thead><tbody>'+
      list.map(function(p){ var s=lg.pstats[p.id];
        return '<tr class="rowlink" style="--tc:'+CG.TEAM[p.team].color+'" data-go="'+CG.playerRoute(p)+'">'+
        '<td class="tleft"><span class="playercell">'+CG.crest(p.team,22)+'<span><span class="nm">'+esc(p.tag)+'</span><small>'+p.pos+' · '+CG.TEAM[p.team].code+'</small></span></span></td>'+
        '<td data-v="'+s.gp+'">'+s.gp+'</td><td data-v="'+s.g+'" class="'+(s.g?"":"z")+'">'+s.g+'</td><td data-v="'+s.a+'" class="'+(s.a?"":"z")+'">'+s.a+'</td>'+
        '<td data-v="'+s.p+'" class="pts">'+s.p+'</td><td data-v="'+(s.p/Math.max(1,s.gp)).toFixed(2)+'">'+(s.p/Math.max(1,s.gp)).toFixed(2)+'</td>'+
        '<td data-v="'+s.pm+'">'+(s.pm>0?"+":"")+s.pm+'</td><td data-v="'+s.shots+'">'+s.shots+'</td>'+
        '<td data-v="'+(s.shots?100*s.g/s.shots:0).toFixed(1)+'">'+(s.shots?(100*s.g/s.shots).toFixed(1):"—")+'</td>'+
        '<td data-v="'+s.hits+'">'+s.hits+'</td><td data-v="'+s.blk+'">'+s.blk+'</td><td data-v="'+s.tk+'">'+s.tk+'</td>'+
        '<td data-v="'+s.pim+'" class="'+(s.pim?"":"z")+'">'+s.pim+'</td><td data-v="'+s.gwg+'" class="'+(s.gwg?"":"z")+'">'+s.gwg+'</td>'+
        '<td data-v="'+(s.fot?100*s.fow/s.fot:0).toFixed(1)+'">'+(s.fot?(100*s.fow/s.fot).toFixed(1):"—")+'</td></tr>'; }).join("")+'</tbody></table>';
  } else if (tab==="advanced"){
    var la = lg.players.filter(function(p){ return p.pos!=="G" && lg.pstats[p.id].gp>=minGp && (!fTeam||p.team===fTeam); })
      .sort(function(a,b){ return (lg.pstats[b.id].toi||0)-(lg.pstats[a.id].toi||0); });
    table = '<table class="tbl keepcols" id="statTbl"><caption>Advanced skater metrics — auto-imported from EA box scores</caption><thead><tr>'+
      '<th class="tleft">Player</th><th class="sortable">GP</th><th class="sortable sorted">TOI/GP</th><th class="sortable">PPG</th><th class="sortable">SHG</th><th class="sortable">GV</th><th class="sortable">TK</th><th class="sortable">Pass%</th><th class="sortable">Poss/GP</th><th class="sortable">SAT</th><th class="sortable">INT</th><th class="sortable">PD</th><th class="sortable">OFF</th><th class="sortable">DEF</th><th class="sortable">TP</th></tr></thead><tbody>'+
      la.map(function(p){ var s=lg.pstats[p.id];
        var toiPg=s.gp?(s.toi||0)/s.gp:0, possPg=s.gp?(s.poss||0)/s.gp:0, passp=s.passAtt?100*s.pass/s.passAtt:0;
        return '<tr class="rowlink" style="--tc:'+CG.TEAM[p.team].color+'" data-go="'+CG.playerRoute(p)+'">'+
        '<td class="tleft"><span class="playercell">'+CG.crest(p.team,22)+'<span><span class="nm">'+esc(p.tag)+'</span><small>'+p.pos+' · '+CG.TEAM[p.team].code+'</small></span></span></td>'+
        '<td data-v="'+s.gp+'">'+s.gp+'</td>'+
        '<td data-v="'+toiPg.toFixed(0)+'">'+(s.gp?CG.fmtToi(toiPg):"—")+'</td>'+
        '<td data-v="'+(s.ppg||0)+'" class="'+((s.ppg||0)?"":"z")+'">'+(s.ppg||0)+'</td>'+
        '<td data-v="'+(s.shg||0)+'" class="'+((s.shg||0)?"":"z")+'">'+(s.shg||0)+'</td>'+
        '<td data-v="'+(s.gv||0)+'">'+(s.gv||0)+'</td><td data-v="'+(s.tk||0)+'">'+(s.tk||0)+'</td>'+
        '<td data-v="'+passp.toFixed(1)+'">'+(s.passAtt?passp.toFixed(1):"—")+'</td>'+
        '<td data-v="'+possPg.toFixed(0)+'">'+(s.poss!=null&&s.gp?CG.fmtToi(possPg):"—")+'</td>'+
        '<td data-v="'+(s.sat||0)+'">'+(s.sat||0)+'</td><td data-v="'+(s.intc||0)+'">'+(s.intc||0)+'</td><td data-v="'+(s.pdrawn||0)+'">'+(s.pdrawn||0)+'</td>'+
        '<td data-v="'+(s._ratN?+s.ratOff:0).toFixed(1)+'">'+(s._ratN?(+s.ratOff).toFixed(1):"—")+'</td>'+
        '<td data-v="'+(s._ratN?+s.ratDef:0).toFixed(1)+'">'+(s._ratN?(+s.ratDef).toFixed(1):"—")+'</td>'+
        '<td data-v="'+(s._ratN?+s.ratTeam:0).toFixed(1)+'">'+(s._ratN?(+s.ratTeam).toFixed(1):"—")+'</td></tr>'; }).join("")+'</tbody></table>';
  } else if (tab==="goalies"){
    var gl = lg.players.filter(function(p){ return p.pos==="G" && lg.pstats[p.id].gp>=Math.min(minGp,3) && (!fTeam||p.team===fTeam); })
      .sort(function(a,b){ var A=lg.pstats[a.id],B=lg.pstats[b.id]; return B.sv/Math.max(1,B.sa)-A.sv/Math.max(1,A.sa); });
    table = '<table class="tbl keepcols" id="statTbl"><caption>Goaltender statistics</caption><thead><tr>'+
      '<th class="tleft">Goaltender</th><th class="sortable">GP</th><th class="sortable">W</th><th class="sortable">L</th><th class="sortable">OTL</th><th class="sortable">SA</th><th class="sortable">SV</th><th class="sortable sorted">SV%</th><th class="sortable">GAA</th><th class="sortable">SO</th><th class="sortable">QS</th><th class="sortable">Brk%</th><th class="sortable">Poke</th></tr></thead><tbody>'+
      gl.map(function(p){ var s=lg.pstats[p.id]; var svp = s.sa? s.sv/s.sa : 0;
        return '<tr class="rowlink" style="--tc:'+CG.TEAM[p.team].color+'" data-go="'+CG.playerRoute(p)+'">'+
        '<td class="tleft"><span class="playercell">'+CG.crest(p.team,22)+'<span><span class="nm">'+esc(p.tag)+'</span><small>'+CG.TEAM[p.team].code+'</small></span></span></td>'+
        '<td data-v="'+s.gp+'">'+s.gp+'</td><td data-v="'+s.w+'">'+s.w+'</td><td data-v="'+s.l+'">'+s.l+'</td><td data-v="'+s.otl+'">'+s.otl+'</td>'+
        '<td data-v="'+s.sa+'">'+s.sa+'</td><td data-v="'+s.sv+'">'+s.sv+'</td>'+
        '<td data-v="'+svp.toFixed(3)+'" class="pts">'+svp.toFixed(3).replace(/^0/,"")+'</td>'+
        '<td data-v="'+(s.gp?s.ga/s.gp:99).toFixed(2)+'">'+(s.gp?(s.ga/s.gp).toFixed(2):"—")+'</td>'+
        '<td data-v="'+s.so+'" class="'+(s.so?"":"z")+'">'+s.so+'</td><td data-v="'+s.qs+'">'+s.qs+'</td>'+
        '<td data-v="'+(s.brkShots?Math.round(100*s.brkSv/s.brkShots):0)+'">'+(s.brkShots?Math.round(100*s.brkSv/s.brkShots)+"%":"—")+'</td>'+
        '<td data-v="'+(s.pokes||0)+'">'+(s.pokes||0)+'</td></tr>'; }).join("")+'</tbody></table>';
  } else {
    table = '<table class="tbl keepcols" id="statTbl"><caption>Team statistics</caption><thead><tr>'+
      '<th class="tleft">Club</th><th class="sortable">GP</th><th class="sortable">GF/GP</th><th class="sortable">GA/GP</th><th class="sortable sorted">DIFF</th><th class="sortable">S/GP</th><th class="sortable">SA/GP</th><th class="sortable">S%</th><th class="sortable">Home</th><th class="sortable">Road</th><th class="sortable">PTS%</th></tr></thead><tbody>'+
      CG.standings(lg).map(function(r){
        var gp = Math.max(1,r.gp);
        return '<tr class="rowlink" style="--tc:'+r.team.color+'" data-go="#/team/'+r.code+'">'+
        '<td class="tleft"><span class="teamcell">'+CG.crest(r.code,24)+'<span class="nm">'+esc(r.team.name)+'</span></span></td>'+
        '<td data-v="'+r.gp+'">'+r.gp+'</td><td data-v="'+(r.gf/gp).toFixed(2)+'">'+(r.gf/gp).toFixed(2)+'</td><td data-v="'+(r.ga/gp).toFixed(2)+'">'+(r.ga/gp).toFixed(2)+'</td>'+
        '<td data-v="'+r.diff+'" class="pts" style="color:'+(r.diff>0?"var(--green)":r.diff<0?"var(--red)":"inherit")+'">'+(r.diff>0?"+":"")+r.diff+'</td>'+
        '<td data-v="'+(r.sf/gp).toFixed(1)+'">'+(r.sf/gp).toFixed(1)+'</td><td data-v="'+(r.sa/gp).toFixed(1)+'">'+(r.sa/gp).toFixed(1)+'</td>'+
        '<td data-v="'+(r.sf?100*r.gf/r.sf:0).toFixed(1)+'">'+(r.sf?(100*r.gf/r.sf).toFixed(1):"—")+'</td>'+
        '<td data-v="'+r.hw+'">'+r.hw+"-"+r.hl+'</td><td data-v="'+r.aw+'">'+r.aw+"-"+r.al+'</td>'+
        '<td data-v="'+(r.ptsPct*100).toFixed(0)+'">'+(r.ptsPct*100).toFixed(0)+'%</td></tr>'; }).join("")+'</tbody></table>';
  }
  return head + tabs + '<div class="card"><div class="tblwrap">'+table+'</div></div>'+
    '<p class="caption" style="margin:14px 0 40px">Definitions: P/GP points per game · S% shooting percentage · TK takeaways · GV giveaways · GWG game-winning goals · FO% faceoff win rate · QS quality starts (≥.885 SV% in a start) · TOI/GP time on ice per game · Pass% pass completion · SAT shot attempts · INT interceptions · PD penalties drawn · OFF/DEF/TP EA offense / defense / team-play ratings · Brk% breakaway save rate. Everything is auto-imported from EA box scores — metrics the data can’t support aren’t shown.</p></div>';
};
CG.AFTER.stats = function(param, qs){
  var tab = qs.tab||"skaters";
  $$("[data-tab]").forEach(function(b){ b.addEventListener("click", function(){ location.hash="#/stats?tab="+b.getAttribute("data-tab"); }); });
  var st = $("#sTeam"); if (st) st.addEventListener("change", function(){ location.hash="#/stats?tab="+tab+"&team="+this.value+"&min="+($("#sMin")?$("#sMin").value:3); });
  var sm = $("#sMin"); if (sm) sm.addEventListener("change", function(){ location.hash="#/stats?tab="+tab+"&team="+(st?st.value:"")+"&min="+this.value; });
  CG.sortTable($("#statTbl").closest(".tblwrap"));
  $("#csvStats").addEventListener("click", function(){
    var rows = $$("#statTbl tr").map(function(tr){
      return $$("th,td",tr).map(function(c){ return c.textContent.trim().replace(/\s+/g," "); });
    });
    CG.exportCSV("cghl-stats-"+tab+".csv", rows);
  });
};
