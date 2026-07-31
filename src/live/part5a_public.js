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
/* Empty state for a table that has to keep its <table> element: CG.AFTER.stats binds column
   sorting to #statTbl with no null guard, so swapping the node out for a standalone .empty div
   throws and takes every other handler on the page down with it. One full-width row instead.
   (Sorting a single-row tbody never invokes the comparator, so the short row is safe.) */
CG.emptyRow = function(cols, title, note){
  return '<tr><td colspan="'+cols+'"><div class="empty"><b>'+esc(title)+'</b><p>'+esc(note)+'</p></div></td></tr>';
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
/* Before a single game is played every club is 0-0-0, the standings comparator returns 0 for every
   pair, and the table publishes alphabetical order as a verdict. This is what runs in its place:
   the division's clubs stated as clubs, with no rank column and no implied order. */
CG.divisionField = function(div){
  var byTeam = (CG.lg && CG.lg.byTeam) || {};
  return CG.TEAMS.filter(function(t){ return t.div===div; })
    .slice().sort(function(a,b){ return a.name<b.name?-1:a.name>b.name?1:0; })
    .map(function(t){
      var n = (byTeam[t.code]||[]).length;
      return '<div class="notif" style="align-items:center" data-go="#/team/'+t.code+'" role="link" tabindex="0">'+
        CG.crest(t.code,30)+'<span style="min-width:0"><b>'+esc(t.name)+'</b>'+
        '<p>'+esc(t.city)+' · '+n+' player'+(n===1?"":"s")+' signed</p></span>'+
        '<span class="nf-t">0-0-0</span></div>';
    }).join("");
};
/* the honest footer under a pre-season field: what the table will mean, and when it starts */
CG.fieldNote = function(){
  var start = CG.seasonStartMs();
  return '<div class="card-b" style="border-top:1px solid var(--line)"><span class="caption">'+
    'No games played yet, so there is nothing to rank. The table starts filling in'+
    (start ? ' '+CG.fmtDay(start) : ' at puck drop')+' — two points for a win, one for an overtime loss.</span></div>';
};
CG.gameCard = function(g){
  var lg = CG.lg;
  var res = (lg.allResults||lg.results).find(function(r){ return r.id===g.id; });
  var tag;
  if (res) tag = '<span class="chip">'+ (res.ot?"Final / OT":"Final") +'</span>';
  else if (Math.abs(g.at - CG.now()) < 10*3600000 && g.at > CG.now()) tag = '<span class="chip chip-live"><span class="live-dot"></span>Tonight</span>';
  else if (g.at < CG.now()) tag = '<span class="chip chip-warn">Awaiting result</span>';
  else tag = '<span class="chip">'+(g.stage==="preseason"?"Pre-season · Wk "+g.week:g.stage==="playoff"?"Playoffs · Wk "+g.week:"Week "+g.week)+'</span>';
  /* "Wed, Sep 23" -> weekday over date over time. .gc-when is a fixed grid track (74px / 60px
     on mobile), so the date stacks under the weekday instead of widening the column. */
  var day = CG.fmtDay(g.at), wd = day.split(",")[0], mmdd = day.slice(wd.length+1).trim();
  return '<div class="gamecard" data-go="#/matchup/'+g.id+'" role="link" tabindex="0">'+
    '<div class="gc-when"><b>'+esc(wd)+'</b>'+
      '<span style="display:block;font-size:11px;color:var(--ink);margin:2px 0 3px">'+esc(mmdd)+'</span>'+
      '<span>'+CG.fmtTime(g.at)+'</span></div>'+
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
      '<p class="s-dek">'+(days!=null?days+' day'+(days===1?"":"s")+' out. ':"")+(sNum===1?'Chel Gaming’s first competitive season':esc(CG.seasonTag())+' of Chel Gaming hockey')+'. '+
      (regOpen?'Registration is open — claim your spot before the draft.':'Rosters take shape through the pre-season and the draft.')+'</p>'+
      '<div class="s-cta">'+(regOpen?'<a class="btn btn-chrome" href="#/register">Register to play</a><a class="btn btn-ghost" href="#/schedule">Opening schedule</a>'
        :'<a class="btn btn-chrome" href="#/schedule">Opening schedule</a><a class="btn btn-ghost" href="#/teams">The clubs</a>')+'</div>'+
      '<span class="s-date">Season opens '+startTxt+'</span>' });
    slides.push({ key:"clubs", label:"The clubs", html:
      '<span class="s-cat"><span class="chip chip-chrome">The clubs</span></span>'+
      '<h2>Meet the founding clubs.</h2>'+
      '<p class="s-dek">Real rosters, real management under a $'+Math.round((CG.CAP||60000000)/1000000)+'M cap. Explore each club and its cap sheet.</p>'+
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
  { key:"news",      label:"Latest News" },
  { key:"honors",    label:"Three Stars & Weekly Honors" },
  { key:"deadlines", label:"League Deadlines" }
];
CG.modOn = function(key){
  var cfg = CG.store.get("modules")||{};
  return !(cfg[key]&&cfg[key].off);
};
/* ---------- season roadmap: every stop from sign-up to the playoffs, real dates only ---------- */
CG.seasonTimeline = function(){
  var s = CG.SEASON || {};
  var now = CG.now();
  var faC = s.free_agency_closes_at ? Date.parse(s.free_agency_closes_at) : null;
  var defs = [
    [s.registration_deadline, "Sign-up deadline",
      "Last day to register and be draft-eligible. Late sign-ups still play — they’re placed on clubs automatically after the draft."],
    [s.preseason_starts_at, "Pre-season",
      "Two weeks of real games on randomly assigned rosters. First-year players need five appearances to enter the draft."],
    [s.draft_at, "Draft night",
      "Clubs build their rosters live from the eligible pool"+(s.draft_at?", starting "+CG.fmtTime(Date.parse(s.draft_at)):"")+"."],
    [s.free_agency_opens_at, "Free agency",
      "Clubs sign the remaining free agents at negotiated salaries"+(faC?" — the window closes "+CG.fmtDay(faC):"")+"."],
    [s.starts_at, "Regular season",
      "Wednesday and Friday nights, three games a night, every point counting toward the playoff race."],
    [s.playoffs_start_at, "Playoffs",
      "Top three per division qualify. Best-of series all the way to the championship."]
  ];
  /* live week counter for the regular-season stop: the week we're actually in, as a fraction.
     Time-based (next game night's week) with played-games as a floor, so a postponed early
     game can't drag the number backward. */
  var regGames = ((CG.lg && CG.lg.schedule) || []).filter(function(g){ return g.stage!=="preseason" && g.stage!=="playoff"; });
  var totW = regGames.reduce(function(m,g){ return Math.max(m, g.week||0); }, 0);
  var curW = null;
  if (totW && s.starts_at && now >= Date.parse(s.starts_at)
      && !(s.playoffs_start_at && now >= Date.parse(s.playoffs_start_at))){
    var maxFinalW = regGames.reduce(function(m,g){ return g.status==="final" ? Math.max(m, g.week||0) : m; }, 0);
    var nextByTime = regGames.filter(function(g){ return g.at >= now - 6*3600000; })
      .sort(function(a,b){ return a.at-b.at; })[0];
    curW = Math.min(totW, Math.max(maxFinalW || 1, nextByTime ? (nextByTime.week||1) : totW));
  }
  var stops = defs.filter(function(d){ return d[0]; }).map(function(d){
    return { at: Date.parse(d[0]), name: d[1], desc: d[2] };
  }).sort(function(a,b){ return a.at-b.at; });
  if (stops.length < 3) return "";
  /* which phase are we in? the latest stop whose date has passed */
  var nowIdx = -1;
  stops.forEach(function(st,i){ if (st.at <= now) nowIdx = i; });
  var regOpenNow = nowIdx === -1 && s.registration_open && stops[0].name === "Sign-up deadline";
  var N = stops.length;
  var fillPct = nowIdx >= 0 ? ((nowIdx + 0.5) / N) * 100 : (regOpenNow ? (0.5 / N) * 100 : 0);
  var body = stops.map(function(st, i){
    var state = i < nowIdx ? "done" : i === nowIdx ? "now" : (regOpenNow && i === 0 ? "now" : "");
    var chip = "";
    if (i === nowIdx) chip = '<span class="szn-chip">Happening now</span>';
    else if (regOpenNow && i === 0) chip = '<span class="szn-chip">Open now</span>';
    else if (nowIdx === -1 && !regOpenNow && i === 0) chip = '<span class="szn-chip">Up next</span>';
    else if (i === nowIdx + 1 && nowIdx >= 0) chip = '<span class="szn-chip">Up next</span>';
    var weekLine = (st.name==="Regular season" && curW)
      ? '<span class="szn-week">Week '+curW+' <span>/ '+totW+'</span></span>' : "";
    return '<div class="szn-stop '+state+'" data-rv="pop" style="--rv-i:'+i+'"><span class="szn-node" aria-hidden="true"></span>'+
      '<span class="szn-date">'+CG.fmtDay(st.at)+'</span>'+
      '<b class="szn-name">'+esc(st.name)+'</b>'+weekLine+
      '<p class="szn-desc">'+esc(st.desc)+'</p>'+chip+'</div>';
  }).join("");
  return '<section class="sec-tight"><div class="shell">'+
    '<div class="sec-head" data-rv="mask"><div class="lead"><span class="eyebrow chr">Season roadmap</span>'+
    '<h2 class="h-sec">Season schedule</h2></div>'+
    '<a class="sec-link" href="#/rulebook">The rulebook</a></div>'+
    /* the track fills and each stop arrives on its own beat, rather than the whole row fading in
       as one block — the timeline is a sequence, so it should read as one */
    '<div class="szn-tl" data-rv="up" style="grid-template-columns:repeat('+N+',1fr);--fillv:'+fillPct.toFixed(1)+'%">'+
    '<span class="szn-fill" aria-hidden="true" style="width:'+fillPct.toFixed(1)+'%"></span>'+body+'</div>'+
  '</div></section>';
};

/* ================================================================
   THE MAP — where the league actually is.

   Real geography, not a sketch. Three layers, all from Natural Earth's
   public-domain data at 1:10m — the detailed cut, the one with Cape Cod and
   the Chesapeake and Puget Sound in it:

     d  land: coastlines and international borders
     b  the internal borders — US states, Canadian provinces, Mexican estados
     k  lakes, so the Great Lakes read as water and not as more Ontario

   All three are projected with an Albers equal-area conic (standard parallels
   29.5/45.5, central meridian -96), the projection real North American maps
   use, then simplified with Douglas-Peucker to under half a pixel of error at
   the size this actually renders, and clipped to `bl` — the furthest the hero
   can ever zoom out. Coordinates are relative deltas between rounded points,
   which is the same picture in about half the bytes.

   Baked in at build time, so the page makes no external request for any of it
   and there is no tile provider watching our visitors.

   Every club sits at its arena city. Markers carry the club's own logo where
   one is uploaded and the generated crest where it isn't, so the map fills in
   as clubs do.
   ================================================================ */
CG.NA_MAP = {
  w: 1000, h: 562,
  /* how far past the frame real geometry exists: the window can open this wide
     without ever exposing the straight edge where the source data was cut */
  bl: [-240, -110, 1240, 672.2],
  d: "M1056.7 604.5l-.7 1.2-.3-1.1-3.1 1.4-.8-.5 1.4-1.1-.6-.8-1 .5-1.5-.4-1.9-2.2 1.1-1 3.4.8 1.2-.9-.7.7.6.5-.3.7 2.2.7 1 1.5ZM1042.6 585.7l-.9 1.3-1.2-.5.6-1.5 1.5.7ZM1035.2 582.7l1.2 3.7-1.5 2-1.9-1.6-1.7-3.1.6-1.1 3.3.1ZM1035.3 582.7l.4-1.5-1.1-1 .7-1.3 2.4 1.8 3.6.2-4.2 2.5-1.3 0-.5-.7ZM863.4 581.7l2 4.2-.7 1.9 2.4.9.2.9-1.5 3-1.2.8 1.1-.2 1.3.9.7 2-1.3 2.4-2.5 1 1.9 1.2.2.9 3.6.9-.6 2 .7 2.5-2.4-1.4-3-.4-7.3 2.1 0 .8-4.9 1.7-8.1.1-2.7.7-.3.7-.7-.4-.5.8 0-.8-2.4 2.5.9 1.6-1.2.3-4.4-2.5-2.3-.5-2.4.6-1.9-1.5.4-3.1 2.4-1.4 7.6.3 3.1-1.4-1.9 1 1.2.5 4.3-1.3 7.5-.6 2.9-.7 1.3-2.3 3.9-.5-.2-2.4-3.8-.7-5-3.1 1.3-1.4-1.9-1.3 1.1-1.3-1.2-1 .8-.3-.3-.7.8.1-.4-.5-5.2-1.2-6.4 1-1.2-1.1 1.2-1.9-.8.2 3.4-2.7 3.2-.2 2.7-1.4 6.5.6 1.1 1.2.1-.8 1.4-.7.5.6 2.8 0 2.4-.9-.4.8 1.3-.1-.5-.9 1.3-.1ZM845.2 580.1l3.7.4-4.6.7-.6-.2 1.5-.9ZM843.5 600.1l-.7-.8 1.3-.8 6 .8 1 1.5-3.7.2-3.9-.9ZM863.4 581.7l.6 0-1.2-1.1 1.5-2.2 2.5-.9 3.5.3 1-.9.5.5 2.1-2.3 1 .6 1.5-.8 1.2.9 2.8.4 2.8-.9 2.8 1.2 2.7-.3.9-1.1 1.4-.4 1.2.7.9 2.5 2.2 1.7 3.5-1.6 3.1-.2 1.3-1.5 0 1.1 1.2-.5-.7 2.2-5.7 1 .6 1.9 2.8-1.1 1.3.6 2.9-.1.3-.8 1.7.7.9-1.1 3.9-.1 7.2 2.9.7 1.1-.9 3.8-2.1.3-.1 2.7-1.5.6-1.8-1.7-1.8-.6-2.5 1-3.7.2-3.1 1.6-1.5-.4-.4.8-.9-.4-2.8.5-2.2 1.9-1.3 3-5.8 2.1-1.1-1.1-.1-1.6-2-.1-.3 1.3-1.6.7-1 1.5-2.5 0 1 2.3-3.3 9.6-2.4-1.8-2.4.4.6-.9-1-2-2.1-.8-.7-2.5.6-2-3.6-.9-.2-.9-1.9-1.2 2.5-1 1.3-2.4-.7-2-1.3-.9-1.1.2 1.2-.8 1.5-3-.2-.9-2.4-.9.7-1.9-2-4.2ZM917.1 591.7l1-.3.7.8-2 .5-1.7-.9 2-.1ZM567.6 672.2l-1.8-.7-3.8-4-2.5-.6 7.2-.6-.3-8.7 29.2-1.9 1.1 16.5ZM811.7 591.1l-.3-1.1-.6.1.4-1.5-2.4 3.3-3.6.9-3.3-.5-7.6 1.1-10 2.9-1.3 1.1-5.2.7-.8.9-5.3 1.6-.6-.6 1.7-3.8 4.7-4.3.7.1 1-1.5.2-1.6-2.8-1 .5-1.3-2.5-.8-2.2 1.1-6 .2-2.8.9-7.4-3.8-1.3-2.9.5-.7-.8-.3-1.9-3.2-2-.4.9-.5-1.3-.6-6.6 2.7-4.1-.2-.8-.6-.3.5-1.9-.8-3 .7-.7-.2-.1-.9-1.8.4.2.5-1.2-1.4-3.2-.5-3.2-2.1.8-.7-1.7-1.5-.8.6 1.4 1.8-8.3 1-1.4-.3-.9-2.1-1-.6.4 3.5-.8-1.4-1.3 1.2-1-1.1-2.1-.3-4.5 1-1-1-4.6-1.5 7.5-2.6-.1-1.4-3.8-1.1-3.2.9-10.1.6-.4 1.4-3.7 2.7-1.3 2.5-1.4.2-2 2.7-2.3 0-.3-.6-1.3 1.4-3.9.5-1.1 4.1-1.4-.2-1.7.8-3.9 2.8-.1-2.7-2.4.7-2.6 1.7-1.8-.7.2-.6.9.3.3-.8.5.4 4.3-2.7 3.6 0 .1-.9-.4.6-.6-1.4-1.8-1 .5-2.4 2.3-2.9-.1-1 1.1 0 1.7-1.9-.8-.2.3-.4 1 .4 6.4-3.9 2.2-.3 2.2-2.3.8.2.2.9.1-.9 1.3-.8 1.6.5.6-1 5.1-1 5-3 9.7-.9 1 1.6.6-.9 4.7-2.5-1.8 1.7 2.2 1.1.9-1.3 1.4-.2.5.6 4.4-1.2.8-1.2-.2 1.1 1.2 1.2 2 .5 2.9.2 1.1-1 1.8-.3 2.2 1.4 1.7-1-.8.5.1.8 3.2.5 2.2 2.7 3.9 2 8-1.3 1 1 .1-1.2 5.4 1.3 1.4 1.1 3.8.5 3.3 2.9.2-1.6.8-.2-.5 1 1.8 1.4 3.6.1.9-.6 1 1.8 1 .1.1-.5-2-1.8-2.8-.8.7-.8 2.8 1.7 4.5 1.1 0 1.7-3.4-.2 1.8.4.2 1.4 1.5-.4.7-2.1 2.6 1.8 2.3.5-1.2 1.1.3.6.8-.3.2-1.3 2.1.1.7.5-1.4.8 1.9.3-.7-.6 1.6-.3 0 .9-.8.3 1.3.4 1.1-.9-1.2-.7 2-.5 6 2.2 1.6-1 .9.2.6-.9 1.9-.1 2.2 1.2-.7 2-1.2-.1-.2.6 3.2.4-3.4.5.1 1.4 1 .6 1.2-1.6 1.5 1.2 1.6-.5-.5-.3.4-.5 2.2.8.9-.3-1.3-.2.5-.5 3.1.3 1.5-.9 4.3.5.2.7 6.1 3 2.7-1 1.6 1.4-1.6 2.5-8.2 2.4-2.1 2.3-1.7.8ZM692.3 585.1l.6.6-.7.9-4.6 2.3-2.7-.1-2-2.3 1.8 1 1.7-1 .2.6.2-.5-2.7-3 1.7-2.2-.6-.3 4.5.3 2.6 3.7ZM766.1 565.9l.3 1.7-1 .8-1.9-.8-.1-.8-1.2.5-1-1.2 4.9-.2ZM760.4 565.5l-1-.6.5-.7-.4-1.2.7.1.1 1 1.8-.2-.5.7 1.3.3-.4 1-2.1-.4ZM756.8 563.3l-.2-.6-.4.6-.3-1-1.1.2 2.1-.9 2.8 1.9-2.9-.2ZM753 561.9l-1.4.4-2.3-.8-.5.4-.1-.5 4.8-1.1 1.7 1.5-2.1.8-.1-.7ZM1227.2 47.6l1.2-.1.6.9-.7 1.5-1.1-.9-.5-1 .5-.4ZM727.3 193.9l35.6-9 .3-3.3-.6-.2 1.1-1.3 2 .2 1.4-2.1 1.6 1.5.1-3.2 1.9-.3-1.3-1 .1-1.4 2.4-3.1-.4-1.5 1.1-1.6-1.4-5 .4-2.6 1-1.3-.6-4.6 5.1-14.1 1.7 0 .9 2.5 1.9.7 3.6-3 1.5-.3.6-1.4 6.4 2.9 6.1 17.6.4 3.5 4.7.6-.2 1.8 1.2 1.4.1 2 2.2 1.3.5-1.1 1 .2 2.4 2.7 0 .7-.7-.1.2.9-.9.1 1 1.2.3-1.3.8.7-.5-1 1.3 1-1.6 3.4-.8.5-1-1-.6.4.3 1.6-.6-.9.1.9-1.3-.3.3 1.8-1.1-.2-.5 1.2-.6-1.4-.1 1.2-.3-1.1-.5.4.1 3.2-.4-1.4 0 1.3-.9-1.3-.4.7 1 .9-.7 1.3-1.3-2.1-.5-.2-.1.7-.6-.9.1 1-1.3-.7.8 1-1 .1-.3 1.1-1.2-1.1.7 1.5-.5-.6-.9.7 1.2 2.6-2.5-.8-.9.5-.1-.9 1-1-.4-.5-.9 1 .2-2.3-.8-.2.4 1.4-1.8 1.3 1 1.3-.8 3.5.6 1-.9 2.2-.7.6.1-1.4-.7 1.4-.1-.7-.7.4-.3-1.4-1.1 4.1-.6-3 .2 3.6-.1-.7-1 0-.2-2.6-.9 2.6.5 1.1.4-.4-.3 1.3-1.5-4.7-.8 1.7.6-.1 1.4 2.9-.2 1.4-1.2-2.6 0 1.3-.8 1.3.2-2.1-.6 2 .4-1.9-.7.5.2-.6-2.4 4.2.9 0 .4 1.2-1.6 1 .3 1.3.4-.3-2.1 3.2-.1 3.5-1-.2 0 1.1.6-.2-.2 4-.6.2.8.3.7 1.1-.8-.4.3.5.9.8 1 .1.3-1.1.6.9-2.8 2.3.6.5-.8.8.6.5-.9.1.5 1.2-1.1 0 .1.9 1.5.9.8-.4-.5-.9 2.1.8 2.7 2.9-.5.3-.4-.8-.5 1.2 2.2.4.7 1.9 1.3.7 2-.2-.6.4 3.4-2.6-.2-1.7-.7-.1-.2.8-.9-2.2-.9-.1-.1.7-.8-.5 1.9-.4 2.7 2.9-.4.8.5-.1.5 1.9-2.8 1-.8 1.1 0-.6-1.8.6-.4 1.3-1.9 1.4-.5-3.4-1.2 0 .4.9-1.4 1.4.2.5-.8-.6-.1 1.8-1 .8-.5-.9-1 1.9-1-2.7.5-2.7-1.1 2.8-.6-.2-.1-1.3-.5.4-1-1.1.8 1.7-.9.6 1.1 3-.4 2.1-4.1 2.2-.3-.7-1.7.9-.6-.4-.2.7-2 1-1.5-1 .8 1.1-1.7 1-1.3-.2-3.2 1.5-.4-.9-1.8 3-1.3.1-4.3 3.7-1.6 2.7.4.8-1.5.5-.5-5.1-1.9-2.5 2 5.6-.5 3.8-.9 1.4-.1-1.3-.8 1.6-.3 2.4 1.2.7 2.5 0-.2-1 .9 2.9.5 8.4-.6-4.6-.6 1.1.6 4.9-1.5 2.4.6 1-1.5-.5.6 1.3-.8 1.2.9.7-1.3 1.1.1-1.1-.3 1.2-1.1.3 1.2.1-1.7 3 .4.4-.7 2-1.6 1.4-.4-4.2-1.7-.2-1.2.8-5.7-3.7 0-1.3-.8-.7.9-3 3.2-2.3.9-2.6-1 .9-.1 1.2-2.6 1.7-1.9 3.9.9 1-.1 1.6 3.1 2.9.7 3.1 3.2 3.3 1.5 0 .8 2.6-.3-.8-.8.1.7.7-1.1 1.4 1.4-.3.2-.8.9 2.9-.1 1.6-.3-2-.3 1.1-.9 0 1.3.6-.1 1-2.3 4-.5 2.2.5 1.2-3.5 7.9.5.8-1 1 0 3.9-1.3-2.3.5-4.9-.5-.7 1.1-1.2-.1-2.3 1.1-.1-.2-.7.5-.1-1.2-.9 1.2-1-3 .8 0-1.4 1.1-1.5-1.3.6.5-1.3-1.7.8-.1-1 1.2-.9-1.1-.4.2-2.3-.9 2.8-.7-1.7-.2 2.2-2.6-2.1.2 1.2-1.8-2.2.3-.5.4.4.8-1.8-1.4.4-.1-1.1 1.4-.4 1.5.8.9-.9-.1-.8-.5 1.2-1.1-.3 0-.6-.7.3.5-.7-.8.3-.1-.8-.3.9-.5-1.1-.7.6-.1-.8-.4 1.7 0-2.5.5-.6 1.3 1.4.6-.9-.8.4-.3-.9.9-.8-.8-.6-.3.9-.9-1.1-1.1 2.1 0-3.1 1.7.4 1-3-1.3.7.1 1.8-.6-.2-.8-2.1.7-2.6.6-1 3.3-.7-2.5.1 1-1.5 1.2-.1-.9-.6.5-1.4-1.6 2.6.3-2.6-.7 1.1-.9 0-.3 1.1.8.5-1.4 1.8-.6-1.7-.1 2.8-.7-1.4-1 .4.9.5-1 .7.5.9-1.2-.6 1.3.9-.4.9-1.8-1-.6.4 2.8 1.5.2 1.1-1.1 0 1.7.5-.6.8-1.5-1.2-.1.7 1.8 1.2 0 .5-1.5-.4 1.1.7-.5.2.7.7-.5 1.2 1.3 3.9 2.1 1.9-.7 1.2-.6-1-2.1-.9-1.3-3.2.7 3.1 3.4 2.5 1-.3 1.5 3.9-2.2-2.2-.5 1.3-1.2-1-2.8-.2-1.4-2.1 1 2.2-1.2-.4-1.9-2.8-.5 1.4-.4-1-.2 1.4-1.4.2-.2-2.7 1.4-2.5.8-.3-.6-2.5-.7-.6.8 2.9-1.4.8.6.7-.6.4-.6-.5-.2 4.3-.7-.3 1.1 1-.6.2 1.2.1 2.3-1.6.6 1-.5.3 1.6 1.5 2.9.6 1.5-.5 1.4 1.8 4 1.2.2 1.3-1-.2 1 3.3-1.3.2-1-.9-.3.9-2-2.2-3.8-2.2-1.1-1.6-2.5-.5 2.3.7.8 1.7 4.7 3.1 1.1 1.6 3.6.2-1.3.9 1.6-.1.8 2.9-2.4-1.3.2 2 .9.4-1.4.9-3.7-3.3-.8-.5-.1.5 3 2.9 2.1.9 1.1-.3 1.3 1.2-.4.6.9.3-.2 1-1.3.9-2.9-1.8-.7-1.6-1.3.7-1.6-.8-.2-.9-.7 1.4-1.1-1.1-.6.7-.5-.5-2.1 0-.2.6 2.8.3.5-.6.7.8 3.5.8.5-.7.6 2.3 2.4 1-.1 1.5 1.3-1 1.7.6-.7-1.7 3.1.1.9-.5 5 9.8 5 7.1-3.2-2.9.4-.6-.8-.4-5-9.7.3 2.7.6-.5.5 1.2-.9.1-1.3-1.2.4 1.4 1.6 1.7.2-.9 2.9 5.2-3-3.1.3 1.6.8.5-4.2-1.7-.1.6 2.4 1.6-1.2.7-1.9-.9 1.3 1.6-3.4-1.1 2.3 1.4-3.2 2-1.5-.4-.9-1.9.3-1.8-.8-.4.3 3.2 1.3 1.7-.4 1.1 3.9-1.4.6.7 1.5-.2-.4-.7 3-.8.5 3-.8.2 1.4 1.3-1.4.3 1.5.5-.2-3.9.6-.8 1.1.5-.8-.8 1.1-.1-.6-.7 2.3 2.1.1 4.2-.8.2-.8-.9-1 3.8-.5-.2.1.9-1 .8-1.6.3-1.2-.8 0 1.2-1-1.8-.3 1.5-.5-.1-1.3-1.5 1.3-1-2.3.8 1 1.9-6.2-1.1 1.2 1.4 6.6.7.5.6-.1.7-1 .1.5.5-1.7.9 1.3-.4.3.8-2.2 2.7-1.4 0-3.1-1.9 2.3 2.5 2.6.6 1.4-1.5 1.3.6-.5-.9 1.1.1.1-1.7.7 1.3-.4.9 1.6-1-.5-.7 1.3.6-.8.8.1.9-.8.1-1 2.8-1.4-1.1.1 1.7-1-1.3-1 1 1 .2-2.5.3-2.4 1.6-.8-1.3.2 1.3-2.2 2.5-.9-.3.7-1.2-1.7-1.4 1.1 1.8-.8.6 1.2 1.1-1.9 1.4-2 2.9-1 2-.6 4.7-.3-2.9-.8-1.2.8 2.9-.6 1.9-4.2.6-.6-.6-4.6 3.7-3.8 6.7-.1 3.3-.7-1.2-.8-.1.8-2.2-1 1.5.1 1.4 1.7 1.2-.5.8-.6-.3.1.7-1-.4.7.7-.9 1.6-2.7.6-.3 1.2.6.2-2.8 3.2-1.1-.5.2-.7-.9 0 .3 1.1-.5 0 1.5.5-.1.9-3.6 2.6-1.3-.7 1 .8-1.4 1.5-.7-.6-.4.9-2-1 .2.7-1.8.2 2.7.3-1.5.6 1.9.2-1 1.4 1.4-1.2-.3 1.5-2.1 1.2-.8-3.1.1 2.6-2.9-3.4 1.3 3.4 1.9 1.5-1.6 2 .1-2.1-1 3.1.9.7-.8 1-.5-.4-.1 1.7-2.2-.2.5.5-.7.4 1.5.3-.7 1.5-2.3 0 1.1.6-1.4 3-.2 1.8.8 1.4-2.3 0 3.3 1-1.3 2.4-.7-1.1-.4.2.3 1.2-.6.4 1.3.1-.2 1.2-1.3-.9 1.1 1-.9.9 1 0-.3 2-.6-.1.8 2.4 1.1.2.2 2.6-.8-1.5-.2.9 1.6 1.6 3 8.7 7.2 12.4 7.1 8.6-.7 1.3.1 1.8 1 2.9 2.3 3.5-3.3-5-.7-6.3-2.4.2-.1-2.2-1.5-.5.6 2 2 4.4 10.8 17.5-1.8-.5 2.6 1.3 1.6 2.4-.5.7 1.4 1.8 1.5 16.6-.6-2-1.6 4.9-.2 2.1.7 1.7-1.2 2.3.5 1-.9-.8-.7.5.8.6-1-1-.8.1-1.9 2-2.2-.3-3.2 1.5-1.6-1.4.2-1.7 2.6 1.5.8-1-3.5-1.4-1.4-2.1.3-.6-.7.1-1-2.1-1.3-.6 0-1.1-4.3-1.4-1.5.6-.3-.5.8.1.3-.7-1-.1-1.1-2.1-.1.7-1.7-5.5-.4-.7 0 .8-1.8-.2 2.7-4.3-1.6 1.4-.5 1.7-1.2.5-1-2.4 0-3-.7-.6 1.5-1.6-2.4 1.4-1.9-1.1 2.3 3.1-2.5-.4-4.5-6.3-.5-1.8-2.5-1.6 1.2.7-.2-1 1 .2-.7-.3.9-.7-.7.2 2.7-4.6-1.1-1.7-.2 1.8-.7 0-.4-1.9-2.4-1.2.2 1.1.6 0-1 .8 2.4.3-.9 3.2-2.6-1.8 1.7 2.5-2.3-3.1.7-3.9-.5-1.3 1.1-4.4-.1-4.1-.9-1.5.8.2-.3-1.7-1.5-.9-1.5-3.3-3.4.3-3.2-3.6-2.6-1.3-.2-2-2.2-.9-2.1-2.7-5.3-2.5-2.1.8-.5-.5-2.4 1.6.7.8-1.5-.3.3.6 1.3.1-.3 1-1.9-.3-4.9 3.7 0-1.2-1.7 1.6-4.7 1.2-1.2-2.7.7 1.9.9.5.1-1.7-1-1.4-4.9-3.5 3.5 1.5.6-.6-.9.4-.7-1.6-1 .5-2.2-1.1 2.1-1.7-.4-.6-1.6 1.5-.8-1.1-1.3 1 1.5.4.6 1.5-5-2.3-6.4-1 2.3 0 .4-.7 1.1.6-.2-.7 1.9.7-.5-1.6-1-.3-2.7 1-.1-.9-1.1 0 .1.7-1.5 1.2-8.1 1.7 3.4-1.9.6.2-1.8-1 .7-.9-1-.6-.4 2.6-1.7-2 .5 1.7-2.1 2.8-2.8.9 2.4-2.7-1.2-.8.5.5-1 1.6-1.1.7-.8-.5.1.8.6-.2-.3.7-6.1 1.3 3.7-1.2-1-1.9-1.4-.2-.1-2.6-1.8-2.4-1 6.9-2.4-1.1-1.4.3-.8 1.1-1.8-1-2 .8-2.7-1.2-.8.4 1.6.3-5 1.6-1.2-.9-.5.5.5.6-1.2 1-.3 1.1-2.1.7 0-.5-2.1.1-.1-.8-3.1-.2-1.4-1.5-1.8-.4-2.9 3-.3 1.2.8 1 3.4.7 2-.6 1.5-1.7 1.4.8.6-1.3 0 1.3 1-1.2.4.4-1 1.8-1.1-.2-.5.9.4.8 1.5-.3-.3.6 1 .7.8-.3 1.4-3.1 1.7.3-1.1 1.3 1.2.3-.9.4 1.5.7-.6.8.5.6-.9.5-1.1-1-1.5 1.7 1.7 1.5-3.1-1 1.2 1.3-1.9 0 1.2 1.6 2.3.8-.2 1.2 2.9-.1-.5.6 1.9.5.6-.6 1.3 1.3-.4.5 1.6.2.4.7-1.1.1-.2.4 1.1-.1-.5 1.1-.5-.6-.6 2.2-1.5-1.8-2.2 3.1 1.7-3.9-.4.5-.3-.8-.1 1.3-.6.3-1.2-2.6-5.2-.7 1-1-1.4-.9.3-.7-1.8.3-3.5-1.6-.4 1 2.8 1.2-.5 1.2.7.9-1.1.4.2.9.5-.1-.4 1-2 1.5-.5-2.8-.4.4-1-1.1-.6 1.1-.6-1.8-.6 1.1-1.8-.2.3 1.2-.5-.2-.1 1.7-.4-.3-.5.7-1.5 0 .4-.7-1-.2-.5.8-1.8-.7-.1-.6-.9.5-2.9-.9-.9-1.3.7.3.9-1 .9.6.2 1.4.6-.3-.2-1.1-2.1-2 .4-2.3-.9 2.1-1.8-.6-.1-.7-1.8.6-.1-1.7-1.2.2 0-1.8-3 .5-.3-.9.6-.7-.9-.3-1.3.2-2.1 1.6-.9-.4.4 1.1 1-.3-.5.4.5 1.1 1.1-.2-4 1.7-5.2-1-7.3-2.5-5.1.3-3.8 1.1-.9-1.4 1.5-1.1.3-1.7-1.3-.4-1.1 3 .9 2.1-3.2.1-7.7 3.7-1.5 1.4-.3-.4 1.1-1.2 2.8-1 .3-.7-4.2.6 1.2-2.7-.6-1.3-1.3.2-1.3 1.8-1.9-1.5-.1.6 1.1.6-.5 2.2 1.6.7-.8.5.4.7 1.7.8-1-.1-3.1 3.4-.8-.6.2 2.6-6.3 4.6-5 1.3.2 1 3.1-1.5-7.1 3.7 3.3-2.5-3.4.9 1.3-.6-1.2-.1.5-1-2.3.9-1.4-2.1.7.9-.3 1.1.6.3-1.7.7.7-.9-.6.4-2.3-1.9.7 2.6 1.4.6-.7 1 1.1-.4 1 1-3.6 1.8-2.1-2.5.5 1-1.1-.1.8 2.8-1.4 1.5-.9.4.5-2.2-1.1 2.1-.4-1.2-2.3.7-.6 1.4.9 1.1 1.9-1.5-.1 1-2.3 3.2-.7.2-.5-.9-3.6.1.4.6 1.4-.2.3 1.5 1.6 1-2.3 5.8-1.9.7 1.2-.9-.4-.9-2.1 1.6-2-2.8 1.5 2.6-1.4.5 3.5.8 1.4-.5-.4 2.1-.7.4.2 1.4-1.2.4 1.2 1.9-1-.4-.2 1 1.1 1.1.9 4.4-.8 0 .5.2-.2 1 1.6 1.3.4 3.6 1.4.5-.6 1.5 1.5-1.2.2 1.7-1.9.1-1.2.6 0 1.1-1.2 0-3.3-2.9-7.7-.7-3.6-2.6-3.2-.5-2.1-2.1-4.2-.7-2.1-6.8-3-3.8.5-2.4-1.2-1.8.7-1.6-.4-2.8-2.7-1.3-1.8-1.9-3-6-2.8-2.1-1.2-3.6.5-.5-.9-.4-3-6.3-.6-3.3-1.2-1-.4-1.3-2.9-2.2-.4-1.3-2.5-1.4-.1-1.4-1.1.4.2-.9-.8-.3-.5-1.8-1.7.1-.3-.9-1.2.6-6.7-.8-2.9-1.7-1.3 1.8-4.1.4-2.4 4.4 0 1.4-.7.4.2 1.8-1.9.7-2.1 2.8-3.7-.8-2.1-2.2-3-1.5-.2-.7-3.7-1.4-2.7-3.3-1 0-2.3-2.3-1.9-5 .4-3.9-2.1-3.9-.8-3.2-3-3.1-2.6-1.4-7.3-9.2-3.3-2.1-2-4.6-24.7-3.5-1 7.3-38-5.5-48-28 1.9-3.2-32.4-3.8-.1-2.3-.7-.7.8.2.4 1.7 0-1.5-.4-.7-1 .7-.2-.5.6-6.7-1.6-4.2-6.1-8-2-1.1-.7.9-1.4-1 .4-3.4-1-1.7-3.6-.2-3.7-2.6-1-1-.4-2.3-3-3.1-4.1-.9-3-1.9-4.2-.6-.4-1.4-1.4-1.1 1-2.1.5-2.5-.5-1 1.3-3.6-2.7-2.3.9-1.9.3.5-.4-1.7-1.3-.8-1.3-3.4-1.4-.8-1.3-6.1-3.6-6.1.7-4.1-.5-.6.8-.7.6.8 1.5-1.9.4.4.1-1.4-.8-3-2.8-.7-1.8-3.2-.5-2 .7-4-.6-1.1 1.2-3.9 1.4-.1.3 1.5-.8 1.9 2.7 3.3.9.1-1.5-4.9.5-.4-1.3-.8.7-1.5-1-1.7.9-.5 1.9-.2 6.4 2.6-.4-.4.9-.8.9 0-.4 1.3.7-.6 1.2 1.4-1.5-2.2-2.4.5 1.6-1.4-1.8.9-1.2-.1-1.5-1.8-1.3 1.1-2.8-2.6-1.5.2-.4 1.5.6.7-1 .8.6.9-.7-.4.1 1.1-.8 0-1-1.7-1-.3-1.6-3.3-.9 1-.7-.3 1.6-2-.2-1.7 1.4 2.8-1.2-3.7-.7-.2-.1-2.7-1.9-2.5-3.1-6.9 1-1.6-.1-5.5 1.6-3.2.3-4.5-1.8-5.2-2.2-3.3.4-3 3.5-4.4-.2 1.2 1.1-1.6 1.2 0-.6-.9-1.4 1.3 2.6-3.5 0-2.1 2.6-4.3.3-5-1-1 1.6-3-1.1-2.3.1-2.6 1.9-6.2-.9-3.5 2.3-2.6 2.1-4.4.8-.1-.2.8 1.6-1.7 0 .8.8.3-.4-1.4-1.8.9 2.8-4.1 1.2-1 .6.6-.7-.8-1 .8 4-9.5.8-1.4.7.2-.1-.7-.5.2.3-1.1.8-1.6.7.1-.7-.3.2-.9 3.5-7.3.4-2.8 1.3-.9-.4-.7.6-1.4.4 1.3.3-1.3-.6-.5 1.5-1.6-.9.4 0-1.8.7-2.7 1.1-.9 0-3.7 1.7 1.6.1 1.1.4-.6-.7-.9 1.6.7 2.1-.4 1.2 1.8 1.4.7 1-.5-1.4 0-1.1-2.3-1.7-.3-.7-1-2.3.4-.8-1.4-1.3.3 1.9-5.7-.6 4.1.6.3.6-.8.8.6-.8-1.2.8-.7-.3-1.7.6.6.6-1.4 1.1.6-1.1-1.5-.8-.1-.2.6-1.1-1.1.4-2.5.8 1.4 0-1 2.8-.3-2.8-2.3-.4 1.8-.8-.2 1.1-4.7-.6-2.4.8-6.2-1.4-2.7-.1-1.9.2-3 1.5-2-.4-1.3 6.9 5.8 7.3 3.1 1.8-.7-.8.3 1.2 2.3.3-.8.7.2.2 1.7.7-.5-.3-1.3 1.3-.2-.5.8.9 3.8-2.8 2.5.7-2.6-.6.8 0-.7-.2 1.3-5.2 5 .9.5 2.9-.7-2.5.4-.5-.8 2.6-2.4 2.3-.6 2.1-2.2.6.5.1-2.1.7.9 0 2.5-1.7.6-.5-.8.1 2.5-.6-1.4-.3.4.4.9-.7.7 1.6-.5.2 1.1-1.8 3.8-1.1-1 1.1-1.4-1.3.7-1.3 2.5.7-3.6-2.6 2.8-1.5.5.6.2-.8.3 2-.7-1.3 1.1 1-.5.1 1.4.4-1.4 1-.2.6 1.5 2.1-1.4.9-1.5.9 1.1 1.5-1.1.1-3.6.6.3.2-.5-.6-1.2.8-2.1 1.6-2 1.7-.9-1.3-1.4.2-2-.7-.5-.5.8.7 2.2-1.3-1.9.3-1.6 1.3.6.5-1-1.3-2.6-1.3-.3.1-1.1.8-.1.3 1.1.3-.5.6.8-.2-2.2.9.8.4-.4.1-2.9-.6-.5-1.2.4 0-3.1-.6-.4 1-.2-.1-.5 37.5 10 36.9 8.5 37.2 7.1 39.8 6 56.4 5.8 56.7 2.6 28.4.2.1-6.1 1.9.2 1.7 1 1.3 7.8 1.3 1.3 3.3.1.6 1 3.9.1 1.3 1.9 2.9-.4 1.1-1.2 4.7-.1 3.3 1.1-.5 1.4 2.3.2 1.4 3.3.9-.5 0-1.3 2.3-.3 1.1 1.7 2.6.8.3 1.1 1.6.9 3.3-.4 4.2-3 1.5 2.4 6.8-.9 2.3 1.9 1.7-.6 4.4.3 7.5-5 3.2-.9 39.9 18.5 1.9 4.2 2.6 2.5 1.9-1.2 3.1-.5-.4 1.6 1.3 3.6 1.6 2.1 1.3-1.1 2.5-.3 2 1.5-1.1 3.3 12.8 6.1 8.6 27.2-1.8 9.3-.3 7.1-6.3 7.2.2 3.9 1 1.9 5 2.5 3.4-.4 12.3-10.6 11.7-4.5 13.1-9.5 1-2.3-1.7-1.1-1.1-4.1-1.9-2.8 4.4-3.3 21.9-4.4 2.9-8.2 2.6-2.9.1-1.3 2.8-2.4 1.4-3.1 3.8-5.6 3.8-3.2 1.9-.3ZM99.7-110l2.5 2.3 1.3-.6 3 3.2 3.2-.6 4.9 2.2-2.5 3.1 2.8 4.2-.1 2.2 4.8 10.7-1.1 5 6.9-.8 2.4.7 1.6-1.2 1-2.3 1.7.4.6-.9-.6-.8 1-.1 7.4.6 2.1 3.9.3 1.1-1.4 1.4.6.9-.4 1.2 2.1 1.8.1 1.6 1.1 1.2-.3 1.9.7 2.4 2.6 3.1 1.9 5.8-.5 1.7 3.7 19.2-1.6 1.2 2.4 1.8-1.6 2.2 1.7 1.7-.7 3 2.3.9 3.1 4.2 2.7 2.1.5 1.6 1.4 1.1.1 1.7 2.7 1.6-.4 2.6-2.3 2-.8 2.9 0 4.3-1.3.4-4.2 3.7-2.5.8.2-.7-1.5.9.7-3.1-.7 1.9-1.2.7-.6-1.3.7-1.9-.4-.9 1.9-.9 1.1.8 3.8-2.7-4.2 2.4-.1-.9-1.7.3-.6-.9.4-1.1 1.7-.9 2.9 1.1-.1-1-2.1-.1 2.2-7.3-.8-.5-.8-2.8 2.5-1.3-3.8.9-.4-.9-5.3.4 1 1.4-1.3.6-.9 1.8-.7-1.4.2 1.4-.8 1.1-1.3-2 0-2.7.8.8.4-1.1 1.1.2.7-1.8 1.1 0 .9-2.7 4.6.7-3.4-1.4-.1-2.3-1.6-.9.2-1.4-1-1.3 1-1.5-1.7-.1-.5-.7 2.7-1.8-1.8.2-1.5-2.1-.6-2.5 1.2.8.5-1.8-1.1.6-2.2-1.9.5-1.1-.5.2-.1-.6-.9.9-1.8-2.1 1.3-1.1 1.9.8 2.3-.4-1.8 0-1.6-1.1-.1-.6 1.4-.4-1.1-.3.2-1.6 1.9-.2-2.5-.7.3-2 .8.2 3.7 4.7-.8-2.1-2.4-3 .8-2.4 3.3 2.4-3.3-2.6-1.9 1.5-.6-3 1-.1.4.9.6-.9-.5-1 1.2-1-2.5 1.7-1.2-1.9 2.4-4.4 1.3-.9 1.4.1-1.9-.4-3.2 3.5-2.1-3.3-2-1.3.4-1.7-.6-3.3.5.6.7-2.3-1.1.8-.5-1.9 1-4.1-.2-2.5 1.3-2.6-1.6 2.1-1-.8 1 2.1-.4 1.9-.2-2-.9-.8.6 2.6-.9 2 0 4.9-.7.1-.1 4.2-1 1.4-1.7-1-.1-3.8-.6 1.5-1-1.3-2.6-.4.8-1-.7-.3.9.3.4-1.7.7 0-.9-3.8 3.1-.1-1.5-1-1.1.5.2-2.8-.4 1.2-.9.2 1 .2-.4 1.1-1.5 1-1.1-1.4 1.1.2-1.7-.9.7-1.9-1 .4-.5-2-.2 2.1-2.3-3.9.3 2.4-.9-.3-1.6.8 1.5-.4 1.3 1.5.8-.2 1.1.9.3 1.2-1.1-.9.5 2 .4.7 0-1.3.9 1.3-2 .4 1.6.9.7-.8.8 2-1 .5 1 .4 0 .6-.7 1.6-2.1-.2.1-1.5-.3.4-1-1.5-.9.7 1.3.5-.1 1.2-1.8-1.7-.1 1.6-1.1.1.4-1.2-1.3-1 .3-.8-.5.4-.4-1.1-1.1-.4-3.1-4.9 2 .1-.1-.4-2-.2-1.1-3.2.3-1.9-1.5-3.3-2.3-1.9.8.5.9-.7-1.8-.1-3.6-4.6.7.4-.6-1.4-1.4-.6-.5-.9 1.1.7-3.1-3.8 1.9.5 2.2-1.1.1-3 1.8-.8.5 2.4-1.2 1.8 0 1.6-.8-.1.3.6.8-.4.9-3 3 1.8-2.3-2.2-1.2-3.4-1.1 1-3 .7-4.6-.3-3.4-2.2-4.4-4.6.1-.7 1.8.3.6-1.5-.3-1.2-.9 0-.2 1.3-2.4-.4-1-.9ZM135.8-3.3l0 .9-.4-.3-.4-1.7.3-1.1 1.2 1-.7 1.2ZM149.2.1l.2.6-1.4.1-1-1.4 2.4-.3-.2 1ZM135.6-7.4l.8-1.9.6 2.6-1.1.5-.8-1.1.5-.1ZM134.6-1.9l0 .5-1.3-.9-.4-1.9.7-.4-.8-.3-.5-1.6.5-.2-.7-.4.2-2.3.9.3-.6-1.1.5.2-.4-.5.9-.8.6.1.2 2.2.1 1-1.1-.9.7.8-.6.1.7.6.4 5.5ZM147.5-1.8l-.2-1.4-.3 1-.7-.3.9-1.4.5.3.7-2.3 1.2 1.7-.2.9-.6 1.6-1.3-.1ZM132.6-12l.8.1-.6.7-1.8-.7.6-1.4 1.2.1-.2 1.2ZM146.7-8.8l1 2.2-.8.9-.6-.6-.3 1.7-.2-2.7.9-1.5ZM132-14.7l-1.5.4-1 1.3-.2-1.2.7-.8 1-.4 1 .7ZM135.6-19.7l-1.3.4-.4-1-1 1.2-.7-1.9.9-.3 2.5 1.6ZM155.4-8.3l-1.2 2.9-.4-.6-.9 1.9-1.8.8-.8-1.2 1.9-2.1-.9.3-.6 1.3-1.5-.8 2.7-1.6.4-3.1-.9 3-1.9 1.1 1.5-2.7-.8 0-.5 2.1-1 .8-1.7-3.3 2.5-1.2-.6-.8.5-.7 1.8-.1-1.7-.2.1-.6 2.2.2-.2-.8-1.1.3-.2-.9 1.9.7-.6-1.4 3 .2 1.4 4.9-.6 1.6ZM134.6-24.7l1.1.2-.9-1 3 1-1.1 2-1.3-.9-2.7.8-.6-.9 1.8-1.4.7.2ZM145.3-24.1l1.5-.1-.5 1.7-1.1.2 1.2.1 1.8 2.5-1.1-.1-.3 2.5-.2-.7-1.7.2-.5-1.1.7-.6-.3-.8-1.8-.6.4-2.6 1.9-.6ZM142-1.1l-1 1.9-2-1.6-.4.3.1-.7.9-.3-1.3-.6 1.2-.2-.7-1.8.6-1.2-1.1 1.3-.6-.1.8-.6-.2-.7-.6.8-.5-.7.8-.4-.2-.6 1 .3-.4-1.4-.8.7 1-1.3-.2-1.5-.4 1.5-.7-.2-.6-1.2.4-.9-1.8.3-.6-.6 1.4-.3-2.7-1.1-.1-1.1.8-.4 3 1.8-1.2-1.1-.3-.8.9.1-1.1-1.1 1-1.1 1.8-.2-3.3-.6-.9-1.1.5-1.3 1.4.2 1.7-1.5-.7-1.4 1.1-2.9-2.5-1.6.6-2.5 2.3 1.3 0 .8 1.4-.3.5 2.9-.8.6-.6-.3.2 1.1 1.4.3 1.3 1.8 1.1 3.2-.5 3.1.8-.3 0 2.1.9 1.6-2.2-2.3-.3-1.4-.7.6.3.6-2 .7 0 .5 1.8-.7 1.1.3.7 1.4-2.1-.1.9.8 1.3-.1.5 1.1 0 1.6-1.4-.4-.3.8 2.6-.1-1 2.3-.8-.3-.2 1-1.7.2 1.2.7 1.4-.4-.8 1.7-.7-.1.3 1.2ZM145.2-25.7l-1 1.6-1.7 0-1.5-2.4 1.8-1 2 .7.4 1.1ZM150.3-22.6l-.2 2.3-1.7.5-1.6-2.9 1-3.4 1.2 2.8 1.3.7ZM144.4-32.3l.6-.5.7.8 1.3 4.1-1.5.2-.5-.7-.6.8-1.2-.7.1-1.3.9-.4.2-2.3ZM134.6-31.6l.2.9-.8-.2-.4.9.1 1.3-.7-1.4-.5 1.1.5 1.1-1.4 1.7-.6-.6 1.1-3-1.1 1.7-1-.2.4 1.6-.9 1.1-.4-1.4.8-2.8 1.2-.6-1.2.1.4-1 1.4-.7-.3 1.2.8-.4.2.8.8-1.5 0-1.2-.7.6-1.2-1.7 2.4-.3-1.5-.2-.2-.5.8-.5-1.3-.2.7-2.7.7 1.4.4-1.6 1.4 1.4-.8-1.9 1.9 1.7.2 2.2-1.5 1.4 1.5-.6.6-1.3 1.1 1-1.1 1-.3 1.8-1.3-1.4.3 1-.7.9ZM137.8-39.9l4.5 3.3.2 1.2.2-1.3 1.6.9.8 1.5-1.8 4.4-2.1-4.5-.1 1.5.7.4-.8 1.3 1.2.9-.6-.4.3 1.5-1 .7-1.9-1.4-1.6.4-1-.9 2.1-5.5-.9.4-.7-1.4 1.3.2-1.7-2.7 1.3-.5ZM123.7-47.5l.3.7-1.5 1.4-2-.5 2.3-2-.9-.4.5-.8-.6-.1.8-1.3 1.7 1.4.2 1-.6-.4-.2 1ZM129.6-37.8l-3.7 7.8-1-3-.3-3.6 2.7-1.3-1.3.4.3-1.3-1.8 1.1.5-1.1 1.4-.7-2.1.5 1.5-1.9-1.5 0-.6-1 .4-.7.6.2 0-1.3 2-.3-1.5-1.5 1.3-.6-1.2-.5 1.2-.9-1.8-.6-.5-2.1 1.7.7-.9-1 2.5-1.6 1.1 1.1-1.5.6 2.1.2-.5.7 1.2.6.8 1.7-.7-.4-.2.7 1 1.1-1.2 8ZM121.9-61.4l-1.3 1.4.3-1.3-.6-.2 1.5-2.1.8 1.7-.7.5ZM123-51.5l-.7-2.3 1.5 1.5-1.4-3 1.1.3-1.4-.6.6-.8-.5-1.9-1.4-1.3 1.7-2 1.7 3.2-1.8-4.6.6-.7.7.8 0-1.8.8.4-.2 2 .6.7-.3-.8 1-1.5 1.1 1.4 1.9-.9 1.3 1.2.8 1.6-1.9 1.1-1.3-.6 1.1 1-1.5-.3.9 1 3.4-1.6 3.3 3.3-1 2.5-1.9-2.4 1.5 2.8-.8.1-2.1-1.1-4.1-5.1 3.2 4.6-.4 1.1 1.2.8 2.9.4-.7 4-2.3-.5-4.7-6.9.4 1.6-1.1.1 1.6 1.2 0 .6-.8 0 .7.2-.3 1.4-1.9.8-1.1-1ZM138.7-58.4l-.3-1.3 1.9.4 1.1 2.7-2.7-1.8ZM134-41.7l-2.7.2 1.2-1.9-.1-1.2.9.6-.2-1 1.4-.1-.4-1.6 1.7 1.8-.2-.7.6-.1-1.3-.6-.4-1.5 2.2-.2-2-.3-.3-1.5 1.5-6.9 1.3-1.4-.9.7-.5-1.8 1-2.9.7 4.3 4.3 1.9 0 9.4-.9-2.1-.3-5.6.4.4-.6-1.6-.1 1.1-.4-.3.4 1.2-.6-.7-.7 2.3.7.3.1 3.1.9.9 0 2.5-1.8-1.5.1 1.6 1 .1-.2 1.3-1.1.3-1.4-1.9 0 2.1-3.1.7-.2.6ZM717.1 523.1l-.3 1.5-2.9 3.9 1.9-3-.4-.6.7 0 .7-1.7-.4-.6 1.5-1.2-.8 1.7ZM468.4 525.6l.1 2.1-2.9-11 .4-6.1.4 7.3 2 7.7ZM470.4 500.9l-4.5 9.5 2-7 .6.4 1.9-2.9ZM479.8 491.6l.2 1.1-6.1 4.1.5-1.9 5.2-2.4.2-.9ZM703.3 471.1l1 0 .4 5.6-2.1-4.5.7-1.1ZM502.6 476l1.3.3-5.4 4 4.1-4.3ZM545.1 472.6l-3.4-1.6 1.6-.9 2.9 1-1.1 1.5ZM615.4 452.7l2.2 0-10.4 2 8.2-2ZM186.3 384.3l-1 .1-.8-.9-.7-3.2 2.5 4ZM186.5 374.4l-1-1.2.9.2 1.9 1.6.6 1.8-2.1-.7-.3-1.7ZM169.1 359.7l.6 1.7-2 .3-1.4-2.2 2.8.2ZM175.7 361.6l-4 0-1.1-1.9 5.1 1.9ZM751.3 344.1l.8 1.7.3 5.4-2.6 1.7 2.4-2.2-.4-4.9-1.4-2.8.9 1.1ZM750.1 261.6l.5-.4.5.7-2 2.2.3-2.4.7-.1ZM774.4 248.4l.7-.3-.2.5-5.4 4.4-1.1-.1.1.8-2.3 1.7.7-.6-.9 0-1.3 1.3-9.4 4.5 1.4.3-4 1.7 1.7-1.8-1.3 0 .1.9-1.2.6-.8-.7.9-3.1 1.9-.1-.3-1 .8.2-.3-.9.8.6-.1-1.3 1.3-.6-.3.5.9 0-.3-1 1.6.3-.7-.7 2.3.2 1-1.4 5.7-1.5 3.5-3.9.4.3-1.7 1.6.1 1.4-1.9 1.4 1.7.1 1.3-2.7 1.7 0 .2-.8.7.8 2-1.6ZM794.8 237.3l1.6 2-1.9.6-1.9-.5 2.2-.3.7-.9-.6.5-.1-1.4ZM788.6 238.5l1.1.8-2.2.7-.7 1-1-.4 2.2-2.8.8.2-.2.5ZM779.7 238.3l.4-1.5.6 2.8-1.2.8.2-2.1ZM201.5 133.3l-.6 1-.6-1.5-.7 0 .1-3-1.2-1.2 1.7-2.5.7-.1.3 1.9-.7-.4-1.7.7 1.3 1.2-.3 2.9.6-1.2 1.1 2.2ZM196.9 123.2l.4 1-1.7-1.3.4-1.9 1.5 1.9-.6.3ZM200.5 121.5l-1 .6-.4-1.6-.1 1.7-1.6-.9 1.5-1 1.6 1.2ZM801.5 184l1.2 1.2-1.4.8.1 1.4-1.5-1.1.4-1.9 1.2-.4ZM727.3 193.9l-1.9.3-3.8 3.2-3.8 5.6-1.4 3.1-2.8 2.4-.1 1.3-2.6 2.9-2.9 8.2-21.9 4.4-4.4 3.3 1.9 2.8 1.1 4.1 1.7 1.1-1 2.3-13.1 9.5-11.7 4.5-12.3 10.6-3.4.4-5-2.5-1-1.9-.2-3.9 6.3-7.2.3-7.1 1.8-9.3-8.6-27.2-12.8-6.1 1.1-3.3-2-1.5-2.5.3-1.3 1.1-1.6-2.1-1.3-3.6.4-1.6-3.1.5-1.9 1.2-2.6-2.5-1.9-4.2-39.9-18.5-3.2.9-7.5 5-4.4-.3-1.7.6-2.3-1.9-6.8.9-1.5-2.4-4.2 3-3.3.4-1.6-.9-.3-1.1-2.6-.8-1.1-1.7-2.3.3 0 1.3-.9.5-1.4-3.3-2.3-.2.5-1.4-3.3-1.1-4.7.1-1.1 1.2-2.9.4-1.3-1.9-3.9-.1-.6-1-3.3-.1-1.3-1.3-1.3-7.8-1.7-1-1.9-.2-.1 6.1-30.8-.2-56.6-2.8-56.5-6-37.4-5.6-39.5-7.6-57.4-13.9-14.7-4.1-1.4-2-2.1.9-.3-1.2 1.5-1-1.9-.2.5-1.1.6.3-.7-1.6 1 .3 0-.5 1.9 1 1.8-2.1-1.4 1.5-3.3-1.2 2.7-5.3-1.4 1.5-2.9.5 0 1.2-.9.5-3.2-2.4-1.1-2.9.9-1.4.9 0 .6 4.2.6-1.5 2.8-.8-3 .1-.8-2.2 1.1-2-.3-1.5 2.5-1-.3-1-1.5-1.7 1.3 2.4-2.3.8-.1 2.8-.9.2.2-1.8-1 1.6-2.4.4-2.1-1.5-2-4.7.2-.5 1 1.8.3-1.9 1.7-1.8-.7-1.7.9-.8 1.4.3 2.2-.9-3.6 0-2.1 1.3-1.2-.6 0-1.7-.3 1.1-1 .2 1-2.2 2.4-1 1.1-2.1-.6-1.2 1.7-1-.1-.7-2.3 1.2.6 1.4-.6 1.6-3.1 2.2-.8 0-.1-1.4-.9.2 0-1.1-1.1.9-1.5-.5 2.5-3.4-1.3.5-1.6 2.7-1 .2-.4-1.6-2.5.1-2.5-1.6 1.1.4.2-.9 2.6-.3-2.3.1-1-.9 6 1.1 1.4-1.2 0-1.3.9.2.9-1-.5-2.9.2 2.8-1.7.6-.1 1.4-1.6.8-4.4-.8 0-.7 2.1-.7-1.5-.3.4-1.3-3.7-.7.9-1.2 2.6 1.2.7-.3-2.8-1.2.1-2-.7 1.8-1.9.7-1.3-1.6-.8.4-2.4-1.4 2 1.7-1.2.5-3.9-4.1.7-2-1.7-.2-.8-1.4.3-1 2.4-.3 1.8 1 2.8-.1.4-.9-2.1.9-2.2-.9.5-.6-3-.5 2.9-1.4 1.3-2 4.7.8 3.5 1.5 1-.8-.2-1.5-1 1.9-6.1-2.8-.9.4 1.7-2.8-2.3 2.1-1.4-.5 1.5 1.1-1.1.4-1.4 1.9-.9 0-.3-.7 1.1 0-1.3-.6 0-2.5 1.5-3.6 2 .1.9-1.8 1.2-.6.7.2-.2.6-.9-.2-.9.9 1-.6 1.1.3.3-1.4 3.4-1.1 1.6.8 1.6 5.7.3-.9-1.3-2.9 0-1.8 2.3-.7-4.1-.6-.2-1.9.8-1.3 3.3-1.5.3-1.9-.8-1.1 0 2.8-3.4 1.5-.8 1.3-4 1.3-1.4-.2.5-1.1-1.9 1.6-.1-1.6 1.1-.6-.3-1.4.6-.8-.8 1.8-.9.7-.4-.5.4-2.1 1.2.1 1-1-2.5.4-3.1 2.7-.9-.6 2.5-1.9 3.1-5.7 1.2-.4-1-.5-1.7 1.5-1.8-1 .5-4.1.5-.1-.4-.6.8 0-2.9-3.2.5-2.4.8-.7-.9.2 0-1.7 1.8.5-.1 1.2 1 .7.7 2.4.2-1 1.8-.5 2 1.2.3.9-.7.8.7-.4.6.7.4 2.1-1-4.6-2.4-1.1-1.8.5-1.7-3.6 1.3-2.6 1.5-.6 1.6 1-1.8-1.5 1.6-1.7-4.5 2.6.6-.9-.6.3-.1-1.5-.3 1.9-.6-.8-.1 1-2.4 1.1-1.9 3.4-4.6-11 1-2.2 1.5-.5 1.1 3.9-.7-4.1 1.1-.2 1.9 1.3 1.4-.5-1.2.3-2-1.4-3.1.2-1.2-1.7 1.1 0 .2-2.3-1.3.7-1-1.1.5-.9.9 0-.2-1.1.9-1.4 1.7 5.5.8.5-.8-1.4 1.6-1.5-.8-.1-.8 1-1.2-4.4 1.6-.2 1.5 2.1 1.2.5-2.3-2.7 2.2-1.9-1.4.3 2.1-1.3.5.4-.5.5 1.9-.6 1.7.7-3.1-1.7 5.5-4.8 1.7 0-2.5.1.1-3.3-1.2 4.1-4.2 3.9-.7-.1.1-1.3 3.1-2.3.7-7 2.5-2-.6 0 .5-2.8-2.7-1.6-.1-1.7-1.4-1.1-.5-1.6-2.7-2.1-3.1-4.2-2.3-.9.7-3-1.7-1.7 1.6-2.2-2.4-1.8 1.6-1.2-3.7-19.2.5-1.7-1.9-5.8-2.6-3.1-.7-2.4.3-1.9-1.1-1.2-.1-1.6-2.1-1.8.4-1.2-.6-.9 1.4-1.4-.3-1.1-2.1-3.9-7.4-.6-1 .1.6.8-.6.9-1.7-.4-1 2.3-1.6 1.2-2.4-.7-6.9.8 1.1-5-4.8-10.7.1-2.2-2.8-4.2 2.5-3.1-4.9-2.2-3.2.6-3-3.2-1.3.6-2.5-2.3 293.1 0 2.9 3.5.4-.4-2.6-3.1 97.8 0-.8 1-1.4 0 0-.5-2.5.5-.5-1-.9.9-2.6-.9 2.5 2.5 1.9.9.7 1.1-.3 1.1 1.5-1.1-.2-.7-.8.6-2.7-3.1 6.2.3.7-1-.6-.6 98 0-2.2 2-1.6.2-.9-.7 1.1.1-1.4-1.5-4-.1 2.4 1.5.5 1.5 1.5 1.3-1.2.7.5-.7-1.5.3-2.1-1.4-1 .8-1.8-1.5-.6.9 2.2 1.8-.7.4-4.2-.7-1.2-.9-.9.9-1.8-3.7-2.8 1.2-4.6-.2-.3.5-1.5-.3-.4.6-1.3 0 1.3.9-1.4.1 1.7 1.5 6.3 1.4-.7 1.7-3.5 2.2-.7 3.1-3.4 2.1-.9 1.1.4.8-2.4 1.2-5.6.1-3.5-2.3-3.1-1 3.2-.3-5.5-.7-4.9-2.5-2.5.2 2.1.7-.2.8-2.2-.8-3.2.3 1.6-.7-10.2.3 3.8 1.7-.8-1.3.4-.3 9.2 1.2 4.1 2.3.7 1.3 3 2.1 16.4-.2 1 1.2-.2 1.2-1.9 2.6-.3 1.6-1.2.9-.6-.3-.3 2.2-1.8.9-.4 2.2-1.3 1.5.6.8-1 .8-5.1 2.7-2.2-.1-2.4-2.1 2.1 2.8-4.3-1.5.6 1.7-1.9-1.6 0 .6-1.1-1 .7-.6-.5-1.3-.8.6.5.9-2.4.3 1.6.1.8 1.1-.5.4.9.8-1.2.4-.4-.9-.8.5-1.6-.7 2.8 2.5-1.3.6.6.5-.7 1.6-.9.3-.1-.6-1.5.5-1.7-1-.5.6 1.1-.2.2 1-2.9.6-5.2-2-1.4.2-.2-.8-2.1.4-.4-.3.9-.4-.8-.2-.5 1-2.8-.3-9.1-3-1.6-1.9-1.2-.4 2 2.5-1.8.3 1 1.5 2.3.8 1.3-.4-2-1.2.4-.6 2.7 1.3 4 1.2.9-.6.8 1 2.6.6-3.5 2 .5.4 1.1-.7.9.5.4-1.1 3.4-1.5 3.4 3 3.1.1 2.1.9-1.7-.3 2.5.8-.2 2.4 1 1.7-1.3 1.7-2.3.1-3 1.9.2.5-6.4-1 .4 1-3.1-.2 2.1 1.8-.6.1 2.8.3.7.8-.6.9-1.8-.1-.1-.9-1.9 1.1-1.9-1.1.6 1.8.5-.3-.3 1-1.5-.3.3 1.3-1.2.3 1.8.4-.1.9 1.4 1.5-1.1-.1-1.2-1.8-4.5-1 4.3 2.1-.4.5-1.6-.3-1 .7.3.6 1.3-.1-1.9 1-.1 1-1.3-1 .2.5-1.1-.2 1.8 1.1-1.5.1 1 .8-3-.8 1.1.9-1 .4 2.3.5-.8.3 1.7.2-.2.6-1.8-.3 1.4.5-4.4 2.4-1.3 1.7 1.4 1.5-.8.7-1.7-.3 1 1.4-.9.9 1 1.1-1.2.3-1 2.5-.9.5-1.4 4.6-1.5-.1.2.9-1.2-.1 1.1.3.6 1.2-1.8 6.5.3 6.2.6 2.7.7-.2-1 .9-.2 3-1.8.6 1.7-.2 1.2 1.7-.6 1.8 1.3-.8 1.6 2.3 2.1-1.2-1.3 8.7 1.1-2.7.4-5.6 6.3-.1.8 1 .7-.8 1.6.2.4 3.4 3.1 6.4.3 3.5 3.7 7.2-1.5 4.7-2.4 2.2 3.4-2.1 2.6-.5-2.3 2.1 13.3-5.6 4.2.3 7.4 3.3 7.4 1.5 1.7-.3 5.7 4.4 3.3 1.2 4.1 5.1-.1 1.3.8-.8 1.7.6 0 .8 3.7-.1 6.9 2.5 3.8.6 2.1.7 2.8 2.4 3.1.8-2.1 3.9 0 1.8 1.6-4 1.4-.9 4.3.2 5.1-1.1 1.3-.9 1.7.5.4.8 1.3-.2.6 1.4-.4-1.5-1.2-.7 5.1.6 1.9-.8.9.8-.4 1.1.6-.9 2.2-.5 3.4 1.1-.6-1.4 1.1.6.2 2.8 1 1.5-1.4 7.5 1.2 3.6 1.5.7 1.7 3.7-.5 3.4 1.8 4.7-1.2 1.4.1 3.8 2.8 1.6 1.7 2.3 4 3 .4 1.5.9.7-3.4 1.2-.4 1.1 1.2-.9 2.4-.4 1.9 1.9 4.1 1 .8 1.3 3.8 2.6 2.6 5.2-1.9 1.3-3.3 4.7.7-.4 0 .7.8-1.9 1.5-.9 2.4-3.3 2.9.2 4.5 2.1 5.3 5.4-1.2-2.1-3.9-3.3-.4-4.4 1.6-1.4-.7-1.3 2.1-2.1.9.4 0 1.6 1.5-.5 1.3 1 1.3 3.8 1.3.6-1-.9.6-2-.7-.7 1.7-1.7-1.3-.2 0-1.5-3-2 1.8-1.5-.8-1.6 1.4-.7.1-1.3 1.1-1 0-2.2 1.4-.3-1.5-.1-.2-3.2-.6-.8-2.2-.2.7-.6-2.1-2.2 1.1-.7-.1-.6-.5.3.8-1.2-1.7.3-.5-.6 1-1-2.1-.4.5-.7-.6 0 .4-2.8-1.6-3-.6.3-.8-.9.8-.6.6.4-.7-.7 1.1-.4-.8-.6-.7.4.2-1.6-1.4.1 1-.5-.4-1.7 1.6.1-1.8-.4-.5-.6 1.1-.4-1.5-.4.9 0-.6-.4 1-.8-3.2-.5 1.7-.7-.4-.5.8-.6-3.3.3.8-1.1-1.9-.5-.5-.9.4-.8-1.9-1.8.5-.8-.8.5.2-.9-1.7-.1 1.1-1.5.2.4 5.9-3.2 5-3.7 5.1-4.8 5.2-7.3.1-.6-.7.2 3.5-5.9.4-6.3-2.3-10-4.2-7.7-4.1-4.4-3.6-1.6.1-.7-5.6-1.6 0-.5-4.1-2.4.8 1.3-2.3-1.1.8-1.2-.9-.7.4-.9-1.1-1.9 2.3.1.5-1.2-.7.2.2-1 1.2-1-.1-1.5 2.4-1.7-.8-.2 1.7-1.7-2.1.2 1.2-2.2-.8-2.2 1.8-.1 1.5 1.4 1.2-.1-1.4-.4-1.2-1.7 2.1-1.3-1.5-1.4 1.7-2.5-4 .7.5-1 1.3-.4-1.2-.4-.3-.4.7-.2-.8-.9-.6.4.1-.8-1.6-1.2 1.3-2.1 1.2-.2-2.4.3-1.5-1.1 1.6-1.9-1.2.1 1.8-1.4-3.1 1.9.2-.7-.9.2.3-.6-2.3 1 3.2-6.5-1.4-3.5.8.2 1.1-1.1-1.1-.3.1-.6 1.5 0-2.2-.6-.9-1.1-1.9 0-2.6-5.9.1-2.6 4.6-4.4 16.1.9.7.3-2.2 2 4.3-3.2 1.6.1.1.8 1.2-.8 4.2 1.3-1.9-.8.1-.7 2.7-.8 3-2.3.8-1.6 1.6-.6 1.1 1 3.3.3.3.7 2.9 1-.4.4 2.7-.6.7 2-1.1 2.3.9-1 .8.9-.5-1.8 3.7.2.8.7-.6.9 1.3-.2.9.7-.5 1.2-1.4.2-.3.8 2.6-1.2-.2-1.5 3.5.5.4.7-2.4 1 1.1.5-1 1 2.6-.4-1.8 1.3 1.4-.1-.3.8 1.2.1.6 1.4.3-1.2 1.5 1.2 1.2-.9.4.5 1.2-.5 2.4.6.1-.6 2.2.5-.1-.7 1 .3-.2-.9 2.3-.6 1 1.5-.2 1.4 2.3.4.7-1.9 1.1.2-.6-2.5.9-.5 2.1 1.9.4 1.7-2.5 2.4 1 1.5-1.2.9 1.5 1.9-.2.9 1.8.9.4 2.1-1.7.6.3 1.2-4.6.6-1.9 1.1-4.3.1 4.3.1 7.4-1.9-.1.8 2 .3-.1 1.2.6.1-.7 1.2 1.4.4-1.4 2.4 1.5 1.7-.8 1.2 2.5-1.4 1.8 0 .5 1.4-1.1 0 0 .8-.7-.3-.6 1 .5.8.4-.5 1.2.3-.5 1.2-.8-.5 1.2 2.4-1.5 2-.8-.9.2-1-2.2-1.4.1 1.4.7.1.7 1.7-1.2-.4.4.5-3 1.8 2-.1.9-.9.4 1.4 1-.5-.5 1 .8.5 2.7-5 4.2-1.4.9-.9 3.6.5 1.5 3 .7 0 .3.8.6-.5.4 6.5-1.1 1.8-3.7 2.2-2.8 3.7 3.1-3.5 4.3-2.8.6-1.5-.4-5.6 1.2-.9-.1-.8 1.4.8 1 2.6-1.3 4 1.7-3 0-3.6.8.5.1 2.1 1 .5.8 4.5-.1-4.6 2.9-3.3.7 0 .7-2.3 1.1.8.1-1.1 1.7-.6-.7-.4 0-2.2.9-1-.4-1.2.6-.9 4.9 2.1.5 3.1-.6 1 .5.3.6-2-.7-.5.9-1.7-3.4-2 .4-1.4.6.4 1.4-.9-1.9-.4.9-.7-.5-.8 2.2.5-1.4-.8.7-1 1.9.5-1-.6.3-.4 2-.4-2.2-.3-.7.8-1-.9-.7-1.6 1.6.8-.4-1 1-.3-1.2-1.4 2.2.7-1.2-.9.4-.7-1.9-.7 3.4-.7 2.1.5-4.6-.8-1.9-2.4.1-1 1.1-.5.2-.8 3.3.2-2.4-.4-.4-.7.9.1-.8-.6 1.1-.4-1-1.5 1.4-2.9-.9-.5.4-1.8 1.9-.4 2.6.7-2.4.1-.8 1.1 1.6-1 .9.1-.5 1.2 1-1.1.6.6-.8 1.1.5.3-2.6 2.5 2.7-2.2.4-1.1.4 1.6-1.2.5 1.5.6-.8.8 2-2.1-1.2-.6 1.4-.1.5.6-1.1 1 1.1.1-.4.8 1-.9 0 2-.5.4 1.4.8 1.5-.7.5.4-.9.5-.1 2 .5-1.8 1.3-.3-.6 1.8.6-1.2 1.6.3-.1 1.6-2.2 1.2 3.2-.8-.5 2.1.8-.6.2-1.6 1.2.1-.4 1.9 1.9-1.6-.4.7.1.7.9-.4-.3 1.4-2.3 1.8-2.1.4-.3 1 1.1-1 .6 1.3.1-1.4 2.5-.7 1.2-1.5 2.1-.1-1.6 1.1 1.1 0-.4 1.1.9-.9-.2.7.7.1-1.2 1.3 1.3-.7.4.7.9-1.5-.2.7 1.3.1.4 1-.9 1 1.9-.3-1.9 3.5-2.5.6-.5.9 1.7-.4-1.4 3 2-3.3 1.7-.4-.2 1.5.4-1.5.6.2 1.4-1.7.3.6 1.2-1.2.7.2-.5 1.2.8 1.3-1.8 1.3-.2 1 1.8-1.6 1.1.4-.5.9-3.5 1.6.6 0-1.3 1.6.6-.1-.1.6-1.3 1.2 1.8-1 1.1-2.4 2.4-.8.4-.8.5.4.5-1 .1 1.9 1-1.2-.4.6 1.4.3-1.7.9-1 1.6 2-1.2.6 1.3.1-1.8.5 1 .1-.8.9.4.2-1.2 1.1.8 0 1.7 1.1-.1 1.8 1.6-1.2 2-1.6.6-.3 1.4-1.8.1 1.7.4 1.7-1.2 2.6-.1 1.1.3-1.1.4.9 1.1-1 1 1.7.5.6-.6.2.6 1-1.6-.2 1.2 1.9-.7 1.2.3 1 2.1-1.6.3-.4 2.8-2.1 1.1.7 1.2.3-1 1.2 0-1 .7 1.7.2 0 .6-8.1.4 3.4-2.2-3.7 1.1-.5 1.2 6.8.2-2.8 1.2 4.9-1.2.8.9-3.3 1.2-.3.5 1.3-.2-1.7.8 3.2-.4 2.5 1-4.1 1.5 1.5.6 5.3-2.1-.1 1.5.5-.4.3.5-.8 1.1 2.1-.5-2.3 1.4 1.2-.3-.7.2.7.4 2.3-1 1 .9-1 .6 1.1.1 3.1-1.3.3 1.1-1.4 1.3 1.7-.7.9-1.7.7 3.9.2-4 1.7-.3.2 1.5-1 1.5 1.1-.4.2 1.8.5-1.6.7.6-.9 1.7.3 1.5.5-2.6.1 1 .7-.3-.2-1.1 1 .9-1.3 1.1.2 1.6-.8.7-.4 1.8 1.8-2-1.5 4.8 3.2-6.1.1 1.4 1.2-1.5-1.1 4.4 1.3-4.1.9-.4.7-1.8 1.1 1.8-1.7 1.3.2.6 2.7-1.3.6-1.6.8.9.5-.3-1.7 3.6-.4 3.9.9-1.1-.5-1.2 2.1-3.9.5.3.2-3.1.5-.3.2.7.1-1.2.7 1.1-1.1 3.4 1.4-3.1.5.6.2-1.4.8.2 0 2.2.3-.6 1.3.6-.8 1.4.9-.9.3 1.1 1-.5.8.6 0-.9 3.3.5 0-.9 1.7-.7.7.6 2.6-1.2 2.3.9 1.7-1.1 1.6.5-.5.7.7.2-.1.7-2.6 1.4 2.7-.9-1.5 1.9-4.9 2.5-.3.9 1.3-.9-1.1 1.2.3.4-3.5 3.1-7.6 4.9.9.5 1.9-1 7.2-6.6-1.2 3.6-3.7 1.8 1.2-.3-.3.9-3.7 4-3.5 1.1.5.6-2.9 1.3 1.5.6-.6.5 1 1.8-.4.8-3.2-1.1-4.4 0-.9-.7.1 2 2.7-.9 6.5.8.6.8-1 .1-2 2.5 2.3-.5-1.9 1.8 2.1-1.4.7.2-.6-.7 1-.8.7-2.5.8-.2-1.2-.5 2.6-.9 1.8-3.3 2.5-1.5-.9-1 1.2-3.1 5.6-4.8 3.2-.9-3.6.3-1.3 1.4-1.1-.3.1-1.3 2.7-1.6 4.3-.6 1.2-1.1 3.2 2.4 1.3.2-.6.3.3.7 1.6.3-.5.2.6 1.1-3 3.9.7-.9 1.5 0 .4 2.4.8-.4 1-5.3 2.2-1.5 1.4.1-.5-.7 1.1-.8 1 .6-2.4 1.9 7.5-1.2-.1.8-2.6.4 3.7.8-.5.8.9-.9 1.5.5-.8.8.9-.2-.1.9 1.1-.6-.6 1 1.3.6-.5 1-1.2.2.9.3-.2.9-2.1.9.8-.2-.1.9 2-1.1 1.8 1.6-1.5 1.3.7-.1-.4.4-2 .3 2.9 1 1.6-.7.6.7-.3.6-3.2.3 1.4.1-.4.9.7 0-2 1.3-3 .3 2.6-.1 4.1-1.6 1 0 .1.7 1.1-.3.5 1.1-1.6.4.5.5-4.5.2 4.2.1-.1.5 1.4-.5-.4 1.2 1.8-.5-1.5.9 1-.1.5 1.1-.9.9.3.9-1.4.6 1 1.1-1.9 3.2-3.5 4.1.2 1.1-.8 2.2-.7-.1.1 1.2-2.1 1-1.2-1-2.9 2.5.1-.6-.8.9-.3-.6-2.4 3.8-1.6 1.3-.9-.6.4.9-1.8 0-1 1.5-.4-.2.3.6-.7.1 1.2.5-.1.6-1.6 1.7 0 1.7-.4-.9-.8 1 1.4 1.7.1 2.1-1-.1-.6-1.5-.2 2.8-.6-.3-1.1 2.1 0 1.3.7.6-3.1 2.8-.4 1.4.9.5-2.4 2.8-.6-1-.6 1.2-.6-.8-.5 1.4-1-.3-1.3 1.3-.4-.5-1.4 1.4-.4-.9-1 1.6-1-.1-1 1.1-1.6.4-3.5 3-.7.1 1.4-2-1.5 1.6-1.4-1.1-3.5 1.1-2-.1-3.6 1.4.3-.6-3.1 1.1-3.4 2.9-4.4-.1-3.1 1.9-3.3.2-4.1 2.2-4 .6-4.5 2.5-2.4.3-.5 1.3-.7-.2.4.8-2.7.7-1.3-.8-.6 1.5 1.3.2-2.1.3-.6 2.6-1.7 1.4-.2 2.7-.8.2.6 6.1-.8 2.2-4.2 2.3-2.5.5-.7 1.7-1.4.5 1.6.8-1.9 1.6-.6.2.6-1.1-1.2-1 .8 1-1.8 1.9-.4 1.7.6.3-1.5.6-2.1 2.8 0 2.5-1 .9-.9 5.2-1.8 2.9-1.5.3-2.3-1.3-1.6.5-2.8-.9-7.6.9 2.9-.2-.7 1 .4.5 4-1.6 3.7.8 2.3-.4 1.5 1 1.2 0-.5 6-1.8 2.5-.3 2.7-2.4 1.5-1 5.8-2.2 2.2-2.9 5.4-3.9 2.2-1.8.1-3.2 3.2 0 1.4-3 3.5-4 2.5.2 1.7-1.4.9-.5 3-1.9 3.4-2.6 1.4-2.1 3.6-4.4-.1.8.7 3.6.1 1 1.4-2 1-5.1 6.5ZM727.3 193.9l2.5-1.7 1.2-2.1 3.3-1.9 2.4-3.4 2.3-.7-.3-4.6 1.8-3.7.1-2.5 4.2-3.1 1.8-3.6 2.2-1.5.5-1.9 1.8-1.2 1.1-1.9 1.8.1 11.1-9.3 6.7-15.5.5-2.9 8.2-11.7 7.6-7.6 8.3-6.9 3.6-2.6 6.4-3.1 8-1.4 6.5 1.7 2.3 2.5-4.6-.5 1.1.3-.5.6 1.4-.5-.1.7 3.5 1.3-1 1.1 1.3.6-.2.6-.7 1.5-3.6 2.7.1 2.2-1.8.9 0 1-2.4 2.8-1.5.6-4.2-.5-1.8-1.3-1.1 2.5-2.3.5.2.8-2.2-.2-.4 1.1-2.9 2 1.3-.2 3.1-2.5 2 .8 4.8-.2 3.3 3.7 2.1-3 3.1-2.6.5 0-.7 1.3 2.4-1.4.6.5-.6.5 1.2.4-.1-.8.8 0-1 1.4-.2 2.1.1 1.8.5-.8 0 3.3-3.2 4.6 1.7-.7.2.7 1.6-1.3.7.3 1.8-1 .1 3.8 1.8 1.7-.3.9 1.5-.5 1 3 1.3.6.2 1-.7.7 1.4-1.1.7 2.2 3.2-1.3 1.5.7 1.7-1 2.3.2-.8 1.4-1.9 1.2 2.7.2 2.2.9-.4.5 1.1 0-.1-.8 2.3-.9.4.2-.8.2.8.3-.9.6 3.1-1-1.4 1.1 1.2.4.8-1.3 0 .7 1.4-.8-.7-.7 4.8-1-.8.5 1.5.1-1.2 1.8 1.5-.3.1-1.1 1.6-.1.1.9 4.6-6.6 1.2 2.7 3.5.3.2-1.3 1-.4 3.4 1.8.2.8-1.7 2.4 5.1-1.6.7.8-.9-.1.3.5-.7 1.1-.4-.8-.4.3.3.9-1.4-.3-.7 1.8-3.3 1 1.1 1.2-2.1.5.2.9-2.1 1.4.8.1-3.9 2.8-.2 1.3-.7-.9-.6.8.6.9-1-.2-.2.9-1.6.7.1 1.1-1.7.7-.5-.8-.6.1.8.8-.3.8-1.2-1.6.3 1.7-.4-.6-.4 1-.5-.8 0 1.9-1.7-.4.3 1.5-3.1-1 2.5 2.5-.7 1.6-1.8-.5-.1.7-.2-1-1.5.8-.6-3-1.5 1.7 1.2 1.6-.5.8-1.5-1.2-.5.9-1-.2.5 2.5 1.6.2-1.5.6 1.6.6-.4.8-1.9-.7 1.1.7-.8 2.6-1.3.1.8.4 0 .9-1.5.7.9.7-1.6 1.7.9.6-.3.9-1.1-.5.4 1.2-1-.8.7 1.6-1.3-.8.8 1.6-.3.5-.6-.7 0 1.4-.6-1.1-.2.8-1.1-1.3.5 2.1-1-.1-.4-.9 1.1 3.3-1.6-.4 1.1 1.3-.8-.7.2 1.4-1.6-1.2-.7 1.6-.6 0-3.1-4.1 0 .6-.9-.7-.2.9-.7-1.1 1 2.2-.9-.4 0 .6-.6-.8-.3.6-1.6-4-1.1-1-.2-4.9 1.8-4-1.2.3-1.8 3.1 3-5.5.8 1.3.6-.4 2.1-3.4-2.9 2.8-.1-.9 2.7-3.8 4.5-5.7 4-3.3.2-.9-1.1-.3 1.8-.1.7 3.2.4-.8 1.1.3 1.4 1.6.2-1.3-1.5-1 .5-1.3 3.7-3.3 2-.8.8.4.8-1.4-5 1.2-.6.9-.7-.5-1.9.4-2.8 1.7-2.3 0-1.4 2.5-.9-.5-1 .7-.3-1.7 3.5-5.5.2-2 .6-.8.1 1.4.7-.6-1.6-1.6-.5 3-.8.1.2-1.5-.9-1.1-.3.4-3-2.5 3.1 2.9-.8 4.5-1.5.3-7.2 8.9-1.8 1.1-2.7-.8 1-1.8-.4-1-.4 2-1 .7 1.9.7-1.1 2-1.4-.3.8.5-1.6 1.9-.9-1-1.8 1.9-.9.6-.4-.7-.8 1-.5-.7.7-.5-1.4-.6-.8 1.1.3 1-2.3-1.9.4.8-1-.2-.5 1.1-2.2-1.3-.1-2-1.2-1.4.2-1.8-4.7-.6-.4-3.5-6.1-17.6-6.4-2.9-.6 1.4-1.5.3-3.6 3-1.9-.7-.9-2.5-1.7 0-5.1 14.1.6 4.6-1 1.3-.4 2.6 1.4 5-1.1 1.6.4 1.5-2.4 3.1-.1 1.4 1.3 1-1.9.3-.1 3.2-1.6-1.5-1.4 2.1-2-.2-1.1 1.3.6.2-.3 3.3-35.6 9ZM931.3 78.6l.4 4-1.1.6.7-4.6ZM933 68.1l.5-.2.4 1.2-.7.8-2.7.8-1.2-1.2 2.9-.3.8-1.1ZM910.9 54.3l.1-.9.9.4.7-.5.9-2 .4 1.1-1.3 2.2-1.3.6.6-.6-1-.3ZM916.6 51.3l-1-2.2 1.1.4-.1-1.3.6-.3 1.7.8-2.3 2.6ZM946.9 73.2l.4 3.5-.6.5.5-.1.3 3.4-.6.5 1-.1.3.6.8 3.8-.4 2.5-1 1.1-1.5-1.2-.9 1.4 0-1-1.2 2.7-1.4-.9.2-3.5-.9 2.2.2-2.7-1.5 0 .4-2.9-.9.1-.2-.8-1.5 7-1 1.4-1.2.1-1-6.6.8-.6-1.2-.9.7 0-.2-1.5.6-.9-1.3.2-.7-2.3-3.8-3.1-.1.8-1.9-.4 1.1.7-.3 6.1.9.4-1.6 2.2.4-4.4-.9 4.6-1.5.8-.1-1 0 .9-.4-.6-.7 3.5.4 1.2-.8-.4-.2.7.6-.1.5 1.6-.3.9-.8-.7.6 2.2-1.5 1.9-1.6-.6-.9 1.8-1.9.7-1.5-.2-.4-.7.4-2 3.4-2.7 1-2.7-.1-3.4 2-1.7 1.5-3.6-3.5 2.8.3-3.4-.3 3.7-.8-1-2.3 1.2-.4-1.2-.6.5.1 1.6.9-.2.6 1.7-1.2 2.4-.3-.9-.7.6.3-1.4-.7-.3.1.9-.9 1-.3-1.3 0 1.4-1 .9.7-3-2.8 3.4-.9-.3 4.3-4.9-1.7 1.7-1-.2 0-4.7-.6-.3.3 2.8-1.4 2.3-.6.1.1-1.3-.3.5-1.1-1 1.1 3.2-1.2.6-.9-1.8.6 2.1-3.4 1.4.3.7-1.2-.5.9.8-.6.9-2.3 0-1.4.9-.8-.8-1.1 1.4-.6-.8-2 .8-.7 1.1-1.4-.3-.1.7-1.7.1 0-.8-4.3 2.8.2-2-.9.6-.1 1.8-1.2 0-.7 1.2-4.6 2.8-2.2 0-.7-2.2-2.1-1.9 2.9-5.1 2.2-6.1.7-.5-.6 1.1 2.4-3-2.4 1.2-2.1.1-5.1 3.5-.1-1.2 3.1-5.4-.9 3.2 1.1.6-.1-1.3.8.8 1-.4-.6-7.4.4-2.6.7 1.2 1.8-.8 1.5.8 1.9-.6-1.7.3-1.6-1.2 2.1-1.3.2-1.1-2 1.5-.4-.4 1-.5.3-1.2-.9.9-2 .2-.9-2.3 1.1-3.1 1 .1 1.1 1.3-.5-1.1 2-.1-1.8-1-.3.8-1.8-2.4.1-15.6 1.8-1.1-.9.5-2-.7 2-1.6 1.2-3.4-2.2-.8 1.3 0 .5-.8-.9-.2 1.2-1.9-.5-.8.6-.3-.8-.4.6-2.1 5.5-7.3.7-.2.3 2 2.6-.9-1.7-.5.7-1.2.4.5.7-1 1.3.1-.6.3.5.9-.8.2 1.1.3-.4 2.8-5 1.2 1.3 1-.3 1 1.7.5-.4-.5 1.8-1.1 1.1 1.8-.6.5.7 3.3-.6-.1-.4 3-.9-.5-.5-2.1-.4.6 1.1 2.5.8.1-.5 2.9-.7.3.7.1-.5 2.3-1 .4.8.1.3.9-.1 1.9-1 1.6.4.3-.2 3 .5-.5.3 2-.9 1.7 1.4-.2.4 3 1-5.7.5-1.1.8.6-.2-3.3 1.2-2.6 1 .9-.2 2.8 1-2.3.5.8-.1-1.2 2.8.7 1.9-2.3.8.9-1.7 2.9-2.3 2.2-.4 3.3 1.1-2.7 1.3-.4-.4 1.6.6-.1.1.6-1.4 3 2.4-2.7 1.3.2-.5.6.9-.7.8 1.2.6-2.2.4 2.1 0-2.1 1-.9-.1 1.5.9-.9-.6 1.9.8.1.5-1.4.3 1.3.2-1.4-1.7-1.7 1.3-.1-.3-.4.7-.4 1 4.4-.8 2 1 .8-.3 1.1 1.4-2-.8.6-.7-1.2 1.6-2.5-.7-.9 1.3.6 0 1.1.4-1.2.8-.3-.4-2 1.1 1.9 1.5-5.5.1 1.8.8-.9.9 3.2 0-2.7 1.5-.7.3.9 1-2.6.7.1-.4.5 1-.7 5.3.4.7.4-.7 2.8.7.6-2.3 1.4 1.3-.2-1.5 1.3 1.2.3-1.4 1.3 1-.4-.6 1.2-1.7 2 1.5-1.5.6.6.9-1.7.6.1-1 .8.9 0-.2.5-1.4.7.9 0 .8 1.3 1-1.3-1.1.6.2-1.5.1.8 1-.6.6.6 1.1-.8-2.6 3.5 2.3-1.3-.6.7.6 0-3.2 3.9.5.3 1.9-3 .7 1.5.7-3.5.8.5-.6 1.5.8-.7-.1-1.3.3.7.3-.4-.1 1.5.7-2.1-.4-1.7.9-.4 1.6.8.4-3.4 2 1.8-.6 3.8-1.9.3.5 1.4-1.8 3.1-3.3.6 1.3 1.9 2.5-.8-2.1 1.7 1.5-.3 1.2-1.6.3 2.7-1 .4.7-.1.2 2-2-.5 3.3 2.5.5-1.3.1 1.3 1 1 .2-.7.9-.1-.9-3.2.2-4.5.8-1.6 1.3-.7.4-2.1 1.3.5-.7.8-.4 6.3.9.5-.3 2 .6-.8-.5 1.2.7-.4.5 1.3.5-.3-.2.8.8 0 1.3-3.7-.5-3.6 1 .3.5 1.3.7-.1.4 1.7.8.1ZM162.2 61.6l.1 1.2-.8.3-1.1-1.2-.1-2.1.5-.9 1.4-.6 0 3.3ZM161.8 55.8l-1.1-.4 1.5-2 2.3 0-1.8 4-1.4.1.5-1.7ZM135.7 42l0 .7-1-.3.5 1-.4-.4-.3 1.3-.6-1.1.4-1.5.7-.7.7 1ZM165.3 51.9l.6.2-1 1-1.4-.5 0-1 1.8.3ZM161.6 53.1l.1-1.7 1.7-.6-.7 1.8-1.1.5ZM162.8 50.3l-1.8 1.6.2-1-1.5-.8 1.1-.9 2 1.1ZM164.2 50.3l-.7-.4 1.4-.4.9.5-.1 1.8-1.5-.5.8-.9-.8-.1ZM173.4 50.4l-.5 1.7-4 .8-2.3 2.5-1.9-.1 1.6-3 1.3-1 5.8-.9ZM160.3 45.4l-1.5 2.5.1-2.9 1-.3.4.7ZM161.7 43.3l-.3 2.8-2.7-2.4 1.2.4.1-1.2 1.7.4ZM133.8 30.9l-1.2-.1 2.1.3-.3 1.4-1.2-.8 0 .9-.5.1-.2-2.2 1.3.4ZM163.1 46.8l-1.7.2 1.1-1.1.3-2.5 1.5-2.3.1 1.9-1.3 3.8ZM158.2 41.9l-1.4 2.2-1.3-5 .5-1.4 2.2 4.2ZM164.7 42.4l.1-.8 1.7-.2-2.1 3 .3-2ZM156.9 34.5l-.3.9-.8-.7-.3-3.2.7.2.7 2.8ZM134.9 40.7l-.1-.8-.8 1.2-.3-2-.6 1.5-.1-1.7-.5.3-.9-2.5 0-1 .9 0-2.6-3.8-1-3.1.6-.3.5.9 0-1 .4 1.1.1-.7-.9-1.8-.8 1.4-.7-1.1-.4-2.5 1.4.9.1-.7.3.7.7-.9-3.3-1.8-.1-1.9 4.8 1.6 3-.4-.4 1.4 1.1 2.5-3.7-1.9.3 1.5 1.2-.6 1.7 1.5-.3 1.1-2.1.1-.9-1.5.3.5-1.1.2 1.2.5-.2 1.2 1.6.6-2-.2-.2.8 1 .6.3 2.3-.6.3 1.6 1.2-.2 2.5 2-.8-1.1 1.1.5.3-1.1-.3.7 1.7.1-.7.8.1.6.7-1.1.5 1.5 1-1.2.2ZM159.8 41.1l-1.3 0-.9-3.2.2-.5.9.6-.4-.6 3-1.3-.2-.7-.9-1.6.8 2.2-2.9 1.1-.6-1 .9-1.7 1-.3 1.2-2.8 1.4.7 1.9 2.9.2 2.4-2.6 5.7-1.7-.3 2.8-5.1-.6 1-.5-.4-1.4 3.5-.3-.6ZM157.4 33.4l-.1-1.2 1.7-1.9.5.7-.6 2.8-1.5-.4ZM162.5 30.4l-.7 1.1-1.6-.6-.1-.7 2.4-2.1 0 2.3ZM153.8 30l-.7 1-1.5-.7-.6-2.8-1.8-2-.3-1.7.8 0-1.5-1.2.5-1.1 4.1 4.5 1 4ZM160 29.8l1.7-3.8 3.3.3-1.3 1.7-.9-.5-1.4.8-1.4 1.5ZM150 21.1l2-1.1-.1 1.1.8.8-.4 2-1.9-1.6-.4-1.2ZM152.6 18.6l.8 0 2.3 3.8 1.6 4.5-1.2-.1 1.5.7.7 2.1-.5 1.4-.5-1.4-.9.1-.2 1.4-1-.4 0-2-1.1-1 .2-1.4-.6-.4.5-2-1.4-.1.4-.6 1.6.4-2-.8.2-.9-.9-.8.4-1.2-.6-.6.7-.7ZM151.3 16.7l-.9 1-1.2-1.6-.6.6.4 1.2-.9-.4 1.1-1.8 3-.7 1 2.5-1.8 1.6-1.1-1.1 2.1-1.2-1.1-.1ZM127 20.1l.5-.3-1.4-1 2-.3-2.1-.7.9-.6 1.5.8.7 1.4.3-.4-1.8-2.6.3-.7-.6.4.1-1.1-1.4.3.6-.7-1.2-1.1 1.2-.5-.7-1.5.7.3 0-1.3-1.1-.8.6-.2-.2-1.5 1.8-1.7.4-1.9 4.3 2.6-1.8 2.2 3.2-1.3 1.1.2.7 2-.4 2.1-1.7.9-4.4-.3.2 1.1 2.6.3-1.7 1 2 0 0-.8 1 .6.6-.5.1-1.1 1.8-1.3-.1-2.6 2.4 1 3.1-.9-1.3 2.5-4.4 4.5-1.2 3.8-1.3 1.2-3-.5 1.3.8-.9.4-.8-1.1-1.6.3-.9-1.4ZM152 6.6l-2.8 1.4 1.2-2.3 1.6.9ZM849.4-8.9l-1 1.5-1.2.4-1.3-1.3 2.2-1.8.4 1.9.9-.7ZM155.9 5l-.1-.7 3.7-1.9-.3 1.3-1.6 1.3-1.7 0ZM814.2-14.9l.5.4-1.9.3-.9-.7.8-.2 0-1.4 1.8.7-.3.9ZM808.8-18.2l.2.7-1.7.5-2.2-.6 3.7-.6ZM810-20l-2.4 1.1-1.5-.3 1.9-.7-1.9.5.5-.4-.5-.5 1.3-.2 1.4 0-.2.7 1.8-.7-.4.5ZM804.3-24.2l.4-1.8 1.7-.4.2 1.3-1 .5-.5 1.3 1.8-.7.7 2.2-2.9-.8-.4-1.6ZM798.4-33.9l.9.9-.9 1.2-1.3-1 1.3-1.1ZM796.6-36.6l-1.7 0 .6-1.5 1.3.6-.2.9ZM727.7-34.6l.5.6-1 2.2-.6-.2-.3.6 0-1.9-.9-.8 2.3-.5ZM742.2-110l.1 1 2.1-.4 1.9.7-.2 1.1 1.4 2.1-1 .4 1.4.6-.9.7 1.3 0-1 1.1-.8-.4-3.4-3.9-2.5-1.5-1.2.1 3.6 2-.8.9.8 1.1-.6.5.7-.3-.4.7 1.6 0 .9 1.5-1.6-.6.5.8-1.1-.2 1.7.6-.9.4 2.8.2.4.2-.9.4.8 0 .5 1.2-.6.4 2.1.2-2 1.3-2.5-1.1.4 1-1.5-.7 4.3 3.9-1.6 1.6-1.3-1.4-.7.4.5-1.6-1.1.3.8-1-.9 0-.1-.9-.3 1.5-1.6.5-1.6-.9-.2-1.8-.4 1.9.5.7-1.7-.4.7-1.7-1.4 1.2-.5-.9-.4.5-1.8-.9 2.2 1.9-2.5.2-3.6-3 0-1.4-.5 1.4 1.5.7.9 1.6-1.1.1 1.4 1-2-.7-1.1-2.3.3 1.7-1.9-.7-.3-2.2.1 1.5-1.5.5-2.3-1.8 0 .7-.7-.2-2.3-2.4-.9.5-1.6-1.3 3.5 4.7-4.5-2.1-.7.4-.9-1.2.2.8-2.1-.9-4.1.9 1.8 1.1-.1.6 4 1.2-.3.4 3 2.4 2.8-.1-.1 1.2.4-.9 2.4-.4-1.2 1.6.4.6 1.4-1.8.6.5-1 .9.1.7 1.7-1.4.3.6 1.5.1-.8.8 1.3-.7-.2.9 1-.5.3.9.9.1-.1.7 1.2-.5-.6.8 1.8-1 .2.7 1.4-.2 1.5 1.2.1 1.2 1.1-.8.5.9-.9.9 1.3.6-.4-.8 1.1-.6 1 1.1-1 .1 3 0-.7 1 .4 1-1.5-.1 3 2.3-2.5 1.4-3.3.1 0-.7-1.3-.3-2.9.6-1.6-.5-.5.6-.4-.9-10.5 1.6-2.9-1.1-1.5.5-1.7-.5-1.4-1-.1-1.2-.3 1.5-1.1-1.1.4.9-1.6-1.1.9-.5.2-.5-1.1.2 1.3-1.1-2.1.3-.4.7-1.4-.8.9 1.2-1.7-.5-2.3 1.3-2.5-.9-4.9-.1.8-.4-.3-.8-1.5 1 2.2-2.6-.8.5.1-.8-.8 1.5-1.1-.1-.3 1.5-1.6-.3-.3-.9-2.7-.1.4-.4-1-.2.9-.6-1 .3-.6-2.1-2.5.8-.6-.5 4.4-.8 2.5-3.2-1.3.8-.4-.8 0 .6-1 .4.5-.8-.9-.1.2-.9-.9.1.1.9-.6-1.2-.3.9-1.8-1.3-.5 1 1.3-.4-.3 1.6-.4-.9-.6.9-1.6-1.1.2 1.4-.9.2-.6-1 .9-.3-.1-1.5.9-.8-.9.4-.5-.7.1 1-.4-.1-.6 1.2.5.5-1.2.2.3-.5-1.8-.1 0-2.4-.5.3-.3-.9 0 1.7-2-.8-.2-1.5-1.4.1-.5-1.2-1.4-.5 0 1.1-.9-.1.1-1.4.6 0-1.9 0 1.9-3.2-.8.2-.5-.8.3 1.7-1.1.7 0-1.4-1.2.4-.8-.8.3 1.2-.7.7-1.6-.6 1.5 1.5-1.4.3.2 2.1-.7.1-.9-.3.6-.9-.9-.4 1.1 0-.9-1.1 1.4 0-1.9-.3 1.3-.5-.8-.6 0-1.2-.6-.1.2.8-.8.3.1 1.3-.8-1.2-.1.7-.8-.3.5 1.1-3.1-1.5 1-1.7.5 0-1.4-.6-.7.8.4 1.1-2.2 0 4.9 2.3-1.3.7 1.3.7-1.1 1.4-4.2-.7-.4 1-5.4-1.5.3 1.2 1.7.7-2.4.1 1.8 1.2-1.8-.1-3.2 1.3 1.5.5-2.3.2.8.3-.6.4-2.1 0 .4 1.4-3.9-.7-1.6 1.2-.9-.6.2-.5-1.1.4.2-.6-1.3-.2 0 .9-1.7-.4.1-.7-1.4.2.2-.5-2-1.2 0-1.7-1.2.2 1.5-1.9-.9-1.7 1.2-1.5 4.9-3-2-1.4.3-.8 1.4-.2-1.1-1.1 5.9-.3 7.6.8.6.9 2.7.7.4 1.2-1.9.8 1 1 1 0-.5.9 1.5.5.6-.5-.9-2.2-1.7.9 1.1-1.6 1.1.1.1-2.1-1 1.6-2.1-1.7-3-.6-.5-.8 2.6-.8.7.7 2.9-.3.8-.8-.5-1.2 2.5-.4.5-.9.7 1.1.9 0 2-2.5ZM194.5 118l-.9-.2-.3.8-.6-.5.3-3.6 1.5 3.5ZM169.3 101l-.2 1-1.5-.9.5-1.6 1.2.4 0 1.1ZM185.8 99l.6-.7 2.4 2.4 1.3 3.8-4.3-5.5ZM165.8 91.9l-.4 2.5-.8.4-2.3-3.2 1.5-.2-1.2-1 2.5-.3.7 1.8ZM184 91.9l.7-1.3.3 2.8-1.2.6.2-2.1ZM181.7 92.9l-.7-2.2.4-1.6.6-.3.9 1.7-1.1 1.1.2 2-.3-.7ZM185.6 91.6l-.5-1.1.8-.7.8.8.1 1.8-1 .5.4-1-.6-.3ZM181.6 88.5l-.5-.7 1 0 .7-1.2.9 1.1.4 3-1.3 1.1.2-3.2-1.4-.1ZM173.1 80.7l.9.9-.9.2-3.2-1 3.2-.1ZM170.6 78.7l4.1-1.3.7 1.6-1.6 1.1-3.2-1.4ZM169.5 76.6l-1-1.1.5-.1.6.7 1.7-.1.6 1-2.4-.4ZM193.8 122.4l-.2 1.3-1.3-.9-1.8 1.7-1-.4-7.2-5.7.6-.5-2.7-.9-3.8-4-.5-1.2 4.5-2.3 1.4-1.7.1-1.6-1.9 3.3-2.7-.6-1 .4-1.1-.6 1-.6-.8-.5-1.9 1.5-1.1-1.2-2.1-2.8 2 0 1.2-.9-1.7.5.8-3.5-1.2 1.3-1.3.2-.5-.9 2-2.1-1.6 1.4.2-2-1.6.2-.6-.9-.6 1.2-.9-2.1-1 1.1-.7-.7 1.1-2.7 4.9.1-2.3-.1-1.2-.9-.3-.4 1.2-1-.5-.4-.6 1-1-.3.3-2.9-.8 0-.7-1.8-.4 1.3-.5-.1.1-1.5-.7 1.6-1.9-.5-.6-2 2.3-2.3-1.2.5-.6-1.2-.5 1.4-.9.1-.8-1.2.7-.4-.7-.3.5-.7-1.6.5-.2-1-2 .9-.9-.8 2.2-1.4-.8-1 .6-.5-1.5-.8 1.1-1.7 3.4.8.9 2.2-.4-2.6 1.9-.7-1.5 0-3-2 2.4 2.3-3.9-.3-.9-.6-.3.6-1.8-3.3.8-.7-.9-.5 0-1.5 3.9-.3 1.9.7 3.2 2.6 0 1.4.9-.6.2 1.3 4.3 3.4-.2.4 6.4 3.2 2 1.9 4.5 2.4 1 7.2 2.1 4.2-.2.5-1.1-.1.9 3.5 2.1 2.2 3.5 2.2.5.7-.6.2 2 1.1-.2 1.4 1 .5.3 1.6-.3.8-.7-.4 1.9 3.5-.3 1.1-.8-.3 1 1.4-.8 2.2 1.6-1.4-.2-.6.5.1.2 3.3ZM762.1-64l.6.5-3.1-.3-1.4-.9 1.7-1 1.5 1.2.8-.6-.1 1.1ZM732.5-56.9l.6 1-.5 2.1-3.5 2.3 0-5.7 2-.7 1.4 1ZM642.1-39.7l-.7 1 .6-.1-3.5 1.5.6-1 3-1.4ZM754.3-76.9l-1.1.4.2-.9-1.4.2-4.1-1.2-.2-.7 3.3-1.9 2.9-.5-.5.8 1.3-.2-.4 1 .7 1-.7 2ZM748.3-83.5l1-.7 1.2 1 .1-.7 1.9 1.5-.7.7-2.1-.2-1.4-1.6ZM629.5-58.3l.3 4-.6-.1-1.3 5.2-1.4 1.5-4.4-3.3-.2-4 2.6-4.4 1.1.3 1.3-.8 2.6 1.6ZM752.6-94l-.6.8.8.1-1.2 1.8-2.9.2-.5-.4 1.2-.9-.7-.2.3-.8 3.6-.6ZM672.7-72.9l.6.7-1.3.4-4.8-.6 1-.7 1.4.7 3.1-.5ZM704.2-80.2l.6.5-1.2.9-3.2.5-2.3-2.2 1.1-.6-3.2.4.9-.6-1.9-.4 5.5-.2 3.7 1.7ZM603.2-64.2l2.9.4-.3 3.3-3 2.3-.5 1.4-4.9 4.8-2-.7-3.4 2-.5-1.9-2.1-2.2 2.8-3.6.7-2.8 1.2-1 2.1 1 2.5-1.7 2.7-.2 1.8-1.1ZM641.5-75l-.5 2.1-2.3 1.3-5.5-3.1-.5-.9.7-1.2.7.8 4.4-1 .2.5 1.2-.3 1.6 1.8ZM751.3-105.5l.2.7-2.6-.7-2.2-2.5.6-1.1 1.9 2.8 2.1.8ZM648-79.1l1.3 0-1.1 1.6-2.4-.1-4.3-1.8.8-.6-1-.3.5-.6 2.1-.2 3.7.9.9.5-.5.6ZM742.8-109.3l-.2-.7 4.4 0 .2.6-.4.5-2.5-.8-1.5.4ZM636.1-83.5l.4-.9 3-.6-1.4 1.6-2-.1ZM670.8-98.6l.5 1.8-.9.9-.5-1.4.5-1-.9-.2 1.1-.9.2.8ZM618.3-77.6l-2.3 1.1-3.7 4.4-1.1 0-5.7-1.6-6.1.2-.7-.9 1.3-1.1-.1-1.2-1.5-.6-4.5.8-.6-.6 1.2-2-1.1-.5-.8 1-2.6.4-1.2 1.6.8 1 0 2.3-1.2.2-2.3 2.5-1.6-.1-2.1 4.6-5.4 3.4-2.1.1-1.2-1.4-.2-5.2-1.3-2.1-.7 1.1-3.3 1.1-3.5.1-1.8 1.6-2.2.2-.9-1.2 2.4-4 5.6-3-1.7-2.6-.9-3.9 1.7-3.3-.6-2.3.5-1.5-.5-3.8 1.2-5 3.4-2.5.2 1.7.9-.7 1.7.5 1.2 2.2-2 1.2 2.7 1.3 1 2.6 1-.4 1.5-3.5 3.5 1.4-.5 1.1 1.5.8 5.6.1 1.8 2.3 3 .6 1.4 1.1 4.3.2 3.9 2.3.3 2.5 1.7 1.3.2 1.1-2.7 1.3-.3 1 4.4-1.2.3-1 4.1.9-.5-1 .6-.8 3.4 1.6.3.6-1.4.6 4.1.4.2.6ZM574.7-101.9l1.2.4 2.6 3.5-.6 1.7-.9 0-.7-1.3-2.1-.9-.9-3 1.4-.4ZM578.8-103.4l.3-.8 3.4.3 2.9 1.8-.6 1.6 2.3 1 2.3-.4 0 .8-1 .7-2-.3.2-.6-.2.7-1.7.2 1-1.5-1.1.2.1-.6-1.1.9-1.6-.2-.1-1.8-3.1-2ZM588.1-107.5l.2-.5.6.6 2.2 0-1.2 1.1-1.9-.7.1-.5ZM638.6 30.9l-1.3.2.2-1.6 1.7-.8-.1-.7 1.8-.3.9-2.4-.8 3.2-2.4 2.4ZM815.3 174.6l.1-1.1.9-.2 1.4 2.3-1.2-.3-1.1 1.3-.1-2ZM734.8 183l.9-2.1 1.8-1-1.2 2.6-1.5.5ZM738.1 179.5l.5 3.7-.5.8-4.1 1.1 2.6-2.6 1.5-3ZM882.3 132.4l-2.5 3.6-3 2.5-2-.6-2.5 2.5-.9-.6-.4 1.2-2.5-1.3-3.1-5.1 1.6-4.1.7-3.9-.4-2.8.4.4 1.7-8.3 2.4-.6-.4 2.2 2.1-.1.2 3.1.9.9-.3 6.9.7-2.2.5-.4.2.8-1 3.1-2.5 1.8-1.8 2.9 1.2-.3.8-1.9 1.4-1-.1 2.2-2.5 1.6 0 .8.9-1 1 .2-1.5 1.9-.1 1.3.8 0 1.4-1.7 1.3.1.2 1.3.8-1.1-.6-1.3 2.3-4.7-2.5 2.8-1.3-.4 3.4-6 0-.5-.9.7-1.9 3.1 2.4-5.2 1.4 1-.4 1.6 1-.1 0-2 2.4.1.3.5 1.2-.7-.2 1.7.6-.7-1.1 1.8 1.5-.2.7.9-3 2.3-.1.7 1.1.3ZM858.2 130.1l-1.1 2.2-2.1.7.5 1.4-1.4.5.9.6-1.6.2 1.2.5-1.2.5 2.1.5-.9 1.6 1.3-.3-.7 1.1-2 1.2-1.9-.3-.5-1-1.2.6 1.1-2-.6.7-.2-.9-2.1.2 1.1-2.1-1.4 1.8-.8-.2.5.6-.9.8.9-.7.5.4-.7.9-4.3.3-2.7-1-.3-.6 1.1 0-.5-.6-4.2 1.3-.6-3.8-.6.9-2.7.5-.6-.8.8-4 1.6-3.4 1.1 2.6-.6 2.2 1.5.1 1.5 1.9.6-.4-.3 2.4.9-1 .4.9 1.3-.2-.7-1.3.3-.7 2.1-.1.8.8-.1-.8 1.2-.2 1.5 1.1 6.8-2.9-1.4.1 1.1-.8 6.2-2ZM855.5 112.4l-.8 2.6 1.5-3.1-2.3 5.6 2.1 0-2.2 1.1-.2-3.2 2.8-4.9 1.5-.4-.7 1.5-.6.1.5-1.2-.6.2-1 1.7ZM824.4 117.8l-.3 2.2-.4.7-.7-.2.4-.7-.7-.4.1-.8 1.6-.8ZM816.3 88.4l-2.3-.5 2.6-2.3 11.7-1.3 6.9.5 4.4 1.6 3.5-.3 3.4 2.2-1 1.8-4.4 1.7-9.5.6-5.8-.6-.9-1.5-2-1-6.6-.9ZM655.2 92.8l1.4-.1-.5 1.9-2.8 1.1-.4-1.5 2.3-1.4ZM639.3 82.2l1.3 2.6-.4.8-14.2-3 1.7-2.8 6.7-1.5 4.9 3.9ZM648.5 49.2l2.4-.6-6.8 3.4 1.1-1.3 3.3-1.5ZM650.2 29.4l-1.6 1 .4-3.8.9-1.5 1 3.1-.7 1.2ZM643.1 32.6l.4-1.3-1 .3-2.3 4.9-1.3-1 3.7-6.7-.2-4 .7 1.8-.8 4.8 1.6-1.7 0-6.8.7-.5.8.9-.9-.3 0 1.3 1.1.1 1 1.5 1.2-.1.1 1.6.6-.2-1.7 7.6.6-8.4-1.4 8.4.7-4.7-.5-1.1-2 5.9-1.6 0-1.2 1.9 1.7-4.2ZM469.2 530.6l-.5 3.9-4.4 8.7-3.1 10.5-1.2 11.3-1.5.3 1 .3-.1 1.9.6-1.4-.9 7.6.3 4.6-.2 1.9.1-1.1-.7 1.8-1.3 1.1-.3 2 .6.3.4-1.2-.3 2.1 1.2 7 2.3 4.1 4.4 4.5-1.6 4.5-.8-2.6 1.3-.6.1-1.2-3.7-3.9-2.3-4.8 1.5 6.7 1.5 2.7 1.3.4-.1 1.3 4.5 9.3 0 1.1 11.4 13.8 2.6 8.4 2.5 1.6 1.2 2.4 1.3.4 1.2 2.7 2.4 1.3 0 .5-3.3-1.4 2.4 1.6-1-.1.1.6 1.4-.3 3 1.1-2.3-2 3.7 1.4 4.9 0 2.7 2.2 3.8.8 3.3 4.9 1.9.7 9.6-2.7-.3.8 1.3-.2.9-1.2 2.4-.1.1-1.1-4.1 1.6 4.6-1.8 6.3-.4-.3 1 .9-.2-.1.8.6-.9-.8-.5 4.4-.7 2.2-2.1.8 2.5-.5-2.8 4.6-1.1 7.3-.6 1.3 1.4-2.2-.1-.7 1 2.6.6-1.4-1.3 1.1.1.2.9 1.1.4-.5 1 .8.6 0-.9.7.2-.5-.9 5 .7 0-1-.9.5.6-.7 4.9-2.5-1.8.5.2-2.1-2.1-.7 2.6-2.4-2.7 2.2-1.4.2 8.8-5.8 2.5-2.5.9-7 3.1-2.8-.7-9.6.3-2.9 1.6-3.6-1.4 2.4 1.4-3.9 8.2-4.5 12.2-2.5 8.1-3.6 7.5-1 3.9.7-2.4-.1 1.4.6 2.4-.4 5.8.8 1.4-.8.2-1.3-4.2.9 4.5-1.9 1.4.4 2 2.3 1.3-.1.5 3.6 1.2.5-2.5 6.6-4.1 4.6-2.7 4.6-.4 2.4.8 2.6-.5 1.9.3-2.1-.7-.7.6 1.1-1.8 1.6-1.2 2.7.1-.8-1.3.3.3 1.1 1.1.4-.1 1 1.6-1.1 1.9 0 .3-.6-1.7.2 1.3 0 .1-.9.5.9-.5 2-2.5 1-.8 1.5-.1 1.1.7.3 1.1-1.6 1.1-.3-.2.7.8-.5-1 1.4-1.4 7.4-1.1 2-1.1 7.1-1.7-3.7-2.3-.7.9-3-.8-2.9-1.2 2.4-.2-.6-1.7 1.3.9-.8 0 1 .6-.4-1.8 3.4-3.8.9-1.2 3.5-3.8 5.7-2.8-1.5-1.6 1 0 2-29.2 1.9.3 8.7-7.2.6 2.5.6 3.8 4 1.8.7-146.8 0-16.5-6.2-1.8-2.4-4.3-2-.6-1.4-2.4-1-2.4-3.6-2.8-1.5-1.7-.2-1.6.9-18.3-6.8-2.1-1.1-1-2.6-2-1.7.2-1-4.1-3.8-5.4-2.8.6-.6-.4-.6-1.8.2-5.6-2.9.2-1-1.3.1-1.7-1.1-1.1-3.6-2.4-1.8-2.7-4.1-1.1-2.4-.2-2.7-1.8-3.1 2-1.1 3.9 0 1.4-1 .2-.8-1.5-2-3.1-.5 4.1-3.8 1.2-.4.3-4.4 1-1.5-.4-1.2-3.3-2.1-2.4-5.4-.5-9.4-3.6-4.8.3-.6-.8.3-2.6-3.9-1.9-2.2-.9-.1-1-3.7-3.7-4-1.2-3.6-1.7-2.3-10.4-9.5.2-.5 3.9 3.4-.7-.7.8.5.4-.7-.6-2-.9-.1.5.4-1.1.6-2.6-2.6-1.7-.9 1.3 1.8-2.1-2.1-.7-2.1 1.2.5.1-3.4-.7-.7-.3 2.8-.7 0-2.9-5 .9.3 1 2 .8.2-.5-.8.5-.6 1.7 1.2.2-.5-2.9-2.6-1.9-.2.6-.9-.6-.7-.8 1.9-.4-2.1-4-1.9 2 .4-1.3-1-1.2.1.6-.3-.7-.5.4-1.7-1.8-.6-.5 1.5-.4-.7-1.7.1-.6-.9.9-.7 1 .8 2.7-3.8-1.1 1.5-2.6 1.4-1 0-1.7-1.8 1.2 2.2-.9-1.3-2.6-.7 1.7.1.2-.9-1.2-.9-.6 1 .4-5.3 3.1-4.1-.4 2.1 1.2-2.7.7.4-.3 1 .9.9.5-1.1-1.3-1.6-1 .5.3-2.6-2.9-3.4.8.3-.7-1.3-1.1.3.8.9-4.1-1.4-.8-1.5-.9-5.1-1.4.2-3.1-1.5-3-2.8 1.4 0-.5-1.3-1.1-.1-.4-4.4 1.3-1.4-.8-1.3 1.7-.8-4.7-1.2.6-.3-.3-1-1 2.3-1.3-2.3-1.6.2-2.1-2.9-1.8-4.1.4-.9-3.6-1.8-.5-2.1-2.1-3.2.8-.3.3.6.1-.9-3.7-3.3.4-2.4-.6-1.2.1-2.1-1-.5-.3.5-1-.9.9-2.2-1.4-2.4-1.5-4.8-1-.4.6-4.5-1.2-1.5.5-2.1-2-3.8-.6-3.5.7-4 .5 1.3.9-2.6-1.8-1.5-.3-1.1-.6.1.3.7-4.9-2.3.1-2.9-2.8-2.4-.7.1-.4-1.1.1 1.6-1.3 1-2.3-.8-4.3-5-2.8-1.5-2.5-3 0 .9 2 2.3.3 2.5-1.4 1.8-1.6 5.7.3 3 1.3 1.4-.7 4.5.5 2.5-1.5 4.6.4 1.4.7 2.6 1.5 1.7-.1 1.6 2.4 1.1 6.5 8.9-.5 1.1 1.2 2.9-.3 2.5.6.1.3-.8 1.2.4 0 2.2 1.5-.4.7.8.5 5 3.4 1.6-.8 2.4.9 1.7-.7 5.3 1.9 3.7 3.1 2.3 1.2 5.7 3.3 2.5-1.2 1.7 1.7 2.7-.7 1.4.6 1.6 1.3 1.9.9-.5-1.6-2.4-.1-2.6.5-.3 3.2 3.8-.4 2.2 1.7.9-.7 1.5.9 1.6.4 3.8-.9 2.1.3 3 1 1.1 1 3.3 1.5.5.8 6.1 1.8 2.4 1 3.5-1.9 3.8 1.2 5 1.3 1.2 2.7.7-1.6-.2.1 1.1.8 0 1.2-1.5-.3-1.6 1.4-.4.9 1.7 2.2 1.9 0 1.8 2.4.1-.4 1.9 1.8 2.6-.3 2 3.1 2.3.5 2.4-1 3.2-1.4 1.3-2.9.8-3.1 2.1-1.3-.4-1.3-1.7-.4-5.6-1.6-3.7-4.7-3.9-4.9-6.7-5.4-4.4 1.2.7-3.1-3-.8-2.4-.5.7-1.5-.4.6.6-.8 0-.2-2.4-1.6-3.7.1 1.9-.8-.3.1-1.3-.3 1.3-.6-.2-.3-1.9.7-1.9-1.1 1.9 0-1.4 2.1-4.5.4-3 .9-.3-.8-.3.8-3.6-1 3.2.7-4.4-.7-3.6-1.3-1.1-.8-2.9-4.2-2.4-3.8-4.4-1.4-3.6.4-.6-1.5.6-.2-.7 1.9-1.3-.1-1.4-2.4 3.1-2.7-1.4-2.1 1.2-3.2-5.1-1.7-.1-2.1-3.2-1.7-.1-1.8-1.2-.3-3.8-2.9-2.4-.4-1.5-1.2-.9.4-.7-.7.3-1.5-1.5 0-2 7.6 2.9 2.8-1.1-.2 1.8 2.4 3.1.9-.6-.2-.7 1.6.9.7-.9-1.8-1.7-.1 1.3-1.2-.4.5-3.4-1.9.3 2.5-2.5-.5 1.2.5 1.4 0-1.6.7.6.5-.4-.8-.6.1-1.1.9-1.8-.7-.4 1.7-3-.4-1.6-.8-.4 0-1.5-1.3-.3-1.4-3.9-2.1-1.8-.2-2.2-1-.2-.2-1.6-2.6-3.6-2.8-1.4-1-1.9-2.7-1.9-2.2-2.9.4-2.2-1.3-1.5.8-1.9.1-4.1-1.7-1.3.7-.7-.5-.9-.8 2.2-.1-2.1 1-5.1-2.1-3-1.2-.3.8-4.2-3.3-6.3.8-1.6-1.1-1.8 1.4.7.8-1.7-2.8-3.4-.1-3.5-1.1-1.2-.4-4.3 32.4 3.8-1.9 3.2 48 28 38 5.5 1-7.3 24.2 3.2 2.5 4.9 3.3 2.1 7.3 9.2 2.6 1.4 3 3.1.8 3.2 2.1 3.9-.4 3.9 1.7 4.8 2.5 2.5 1 0 2.7 3.3 3.7 1.4.2.7 3 1.5 2.1 2.2 3.4 1 2.4-3 1.9-.7-.2-1.8.7-.4 0-1.4 2.6-4.5 3.9-.3 1.3-1.8 2.9 1.7 6.7.8 1.2-.6.3.9 1.7-.1.5 1.8.8.3-.2.9 1.1-.4.1 1.4 2.5 1.4.4 1.3 2.9 2.2.4 1.3 1.2 1 .6 3.3 3 6.3.9.4-.5.5 1.2 3.6 2.8 2.1 3 6 1.8 1.9 2.7 1.3.4 2.8-.7 1.6 1.2 1.8-.5 2.4 3 3.8 1 4.6 1.1 1-.3.9 4.5 1 2.1 2.1 3.2.5 3.6 2.6 7.7.7 3.3 2.9 1.2 0 0-1.1 1.2-.6 1.9-.1ZM249.4 625.7l.2 1.1-2.1-1 1.2-1.3.7 1.2ZM324.1 591.4l-.4.8-1.4-1.1-.3-1.5 1.7.6.4 1.2ZM279.3 543.5l.3 1.5-1.1-.4-.3-3.7 1.1 2.6ZM251.5 535.6l.7 1.3-.4 1.1-3.9-4.1 2.1.2 1.5 1.5ZM272.7 537.9l.5.8-1 .9-.7-2.8.5-.2.7 1.3ZM268.5 527.8l1.8 1.6.4 2.2-.9.2-.8-1-.5-3ZM246.8 532l.5 1.1-.5 0-1-1.8.7-.6-.4-1.2-1-.6-.2.6-.6-.8 3.7-7-1.6 6.1-.6.3 1 3.9ZM265.3 512.7l.2.5-.8-.5-1.1 1.2-.5 1.6-.3-.8 1.3-3 1.8-.1-.6 1.1ZM213.4 464.9l0 3.3-.8 1.7-.6-.2-.5-1-1.2-.2 2.2-2 .2-2.1.6-.2.1.7ZM255.6 465.8l-1.2 0-2.8-2.4 1.7-1.3.9-3.3 2.9-.6-.4 1.7.7 2.1-1.8 3.8ZM244.4 459l.5.2-.4 1.1-.9-.9-3.5-4.9-1-2.2.7-2 .9 0 1.3 1.7.4 1.3-.5 1.2 2.7 1-.2 3.5ZM555.8 643.1l1-.4.2.7-1.5.1-1 1.3-.6.1.4-.6-2.2.9 3.7-2.1ZM630 609.2l-1.9 3.9-1.5 1.6-.5-2.1.6-1.8.8-1 1.1.2 1.4-.8ZM173.6 443.7l0 2.1-1.3 1.2-.2-4.1 1.6-.9-.1 1.7ZM582.8 584.8l-.6-2.4-1.2 0 .6-.9 1.9 1.9-.7 1.4ZM595.6 655.7l0-2 1.6-1 2.9 1.5 2-2.7.5-2 1.2-1 1.7-4 3.3.1-1.5 1.5 1.1-.1-.5 1.1 1.2-.9 2.9-.5-.8.9.9-.2.2 3.5-2.5 8 2.1 1.2-1.2.5-.5 2.4 0 2.5 1.6 3.1-.9 1.1.6 1.3-.8.8.1 1.4-14.1 0-1.1-16.5ZM1038.4 672.2l.8-.9 4-.9 3.2-2.1 9.4-2.3 4.6-2.6-1.4 2-4.4 1.8-1 2.1-8.4 2.9ZM1026.1 669.6l1.8 1.9-.9.7-3 0 .1-1.6 1.3-1.4.7.4ZM837.8 559.8l-.7.6-.6-1.1 1-1.2 1.5.6-1.2 1.1ZM832.3 546.3l-.3-1.5 6.2.6-.3.8-1.7-.7-3.9.8ZM829.5 568.2l-.5-.7 1.7-.7 2.1-2.2.9.9 1.5.1 1.3-.9 1-2.8.6-.2.4 2.8-1.2 3.1-2.2 1.3-4.4.9-.6.7-1.2-1.4.6-.9ZM818.5 544.9l-.4-.4.6.1.2-.9 1.4-.5-.1 1-.4-.3 1.6 2.2-.3 1-1.7 2.9-3.3 3.3-.2-.8.9-.3 1.4-2.9 2.6-2.4-.4-1.2-2.3-.2.4-.6ZM813.9 544.7l-1.3-1.2.6-.4 2.4 1 2.4-.1-.9 1.2-2.6-.4-.4.5-.2-.6ZM788.7 537.2l2.2 1.2-1.9-.1-2.6-1.4-1.4.2.5-.4-.6-.8 1.8 0 2 1.3ZM804.6 542.8l.4 1.8-2.6-2.8-4-.7.3-.6.6.7 1.6.2-1.3-1.1-.4-2.4-1.7-1.1-1.3-1.9-.4.2-.2-1.1-.6.5.1-1.1 2.4 2 3.5 5.6 2.5.7 1.1 1.1ZM806.6 525.3l-.1 1.1-1 .2-.1-2.3.8-.9.8.9-.4 1ZM762 536.3l0 3.2-3.2.5 1.5-.5 1.2-1.7-1.9 1.4-.8-.5 1.3-1.2-1.9.8-1.1-2.5-1.8-.8 3.3-4 .8.7-1.6 1.6 1 .7-.4 1.4 1.5-3.3 2 3.7-1 1.2 1.1-.7ZM793.5 525.1l.6 1-3.2.8 1.2-1.4-.2-.9-1.1-.4-3.6-3.9-1.6-.7.2-.7 1.7.5 3.1 3.8 2.9 1.9ZM759.4 519.6l-1.3-.2.7-.9 3.5-.6-2.9 1.7ZM747.6 527.3l.5-.9.1 2 .7-.9.4 1 .7-.7-1.3-2 .1 1-.6-.6 1.3-3.5-.1-1.8-1.3-2.2 2.5-.5 1.1.5.3 2.2 4.5 4 .9 3.5-3.9 4.1-1.9-1.8-.3-1.6-1.3.9-3.4-1.6 1-1.1ZM778 513l.8.6.9 7.5-.5-.1-.9-1.4-1.7-.6 1.7-.3.4-.7-.6-.7.5-1.8-.5-2-3.7-2.4-4.1-.9-2.2.5.3-2.2.9-.1 0 1.1 3.7 1.4 1.7-.1 3.3 2.2ZM738.6 498.4l-2.4.9-3.9-2.5 3.1 1.5 1.4-.2 1.7-2.1-1.1-.3.4-1.7 1.3 1.1 3.4.1 4.4-1.6.7-.9.2 2.2-5.1 1.3-4.1 2.2ZM748.7 490.4l3.7-.6 5 2.5-.8.4.7.6 3.5 1.1 1.1 3.1-1.9 1.5.3 5.8-3.1-1.7 2.3-2.4-1-2.5.5-4.2-2.5-.2-3.7-3.5-4.1.1ZM854.4 550.1l-.9-.8 2.6-.5.9.9-.9-.6.8 1.1-2.5-.1ZM914.7 99.5l.5.1-.1 1.1-.5.8-.7-.5.1-1.6-1.9-3.1 1.8.7.1 1.1-.7.2 1.4 1.2ZM1074.2 658.8l-.4.4 1.1 2-.4.5.8 1.4 1.5.6-.2 1.5.7 1.4-2.6 2-6.9 3-3.8.6 2.6-3.2 2-.7.4-.8-1.8-4.3-3.7-.4 4.3-3.2 6.4-3.1.8-.2-.8 2.5ZM1078.2 646.8l.4 1.2-3.6 3.4-.8 0 1.9-2.9 2.1-1.7ZM1056.3 641.3l.6 2.5-2.3 1.4.7-3.9 1 0ZM1058.3 625.4l-2.1-.3-.3-1.1.8-1.8 1.4.6.2 2.6ZM1085.4 614.5l-.7 1.9-1.9.2-1.7-3.1.8-.5 1.4 1.1 2.1.4ZM1058 611.4l.9 3.3-.4 1.3-2.1-.3-.7-1.3 1-4.2 1.3 1.2ZM1044 597.2l-3.7-4-.2-1.6 2.7-.1 1.4 1.2 1 2.7-1.2 1.8ZM1026 573.6l-.4-.7.6-1.4 2.9.4-.6 1.7-2.5 0ZM1023.7 565.4l-1.1-1.2 1.1.9-.7-1.7 1.6.4.9 1.2-.5.7-1.3-.3ZM1013.2 574.7l.4.7-1.3-.8-2.2.2-.7-.8.5-.6 1.7.3 1.6 1ZM981.8 577.9l-4.8 2.7-.2-1.4 5-1.3ZM968 576.6l-2 1.1-1.6-.1 2.5-1.6 1.8-.3-.7.9ZM962.9 575.6l.6.8-1.8 1.1-.7 2.8-1.3 1.4-3.8 2-.3-.5-8.8 2.1-2.1 1.8-2.3.1-1.8 1.1-.5-4.2-2.6-1.7 1.4-1.5-.4-.9.8-.8 3.2-.4 7.9-2.7 3.7-.8.8.5.7-.4-1.1-.3 3.3-.8 3.6.3 1.1-.7.4 1.7ZM799.8 623.9l1.5 1.2-2.6 1.4-3.8.7-1.9-.9-1.9.6 1.7-.6-2.1-.2-1 2.7-1.6.1-.5-.7-1.2.5-.2 1.7-.6.2 1.2-.1.3.8-.7.2-4.2-1.6-5 1-1.9-1-.3-1.1-1.8.1-2-2-2.9.4-2.4-.7.4-1.6 1.4-1.6 4-.7.6-1.2 1.6-.5 11-.4 3.8-.7 2.1 1.6 7.2.5 1.8 1.9ZM719.8 617.3l.8.2-.2.6-4.3 1.2-.7-1.6.5-.4.7 1.3 1.1-.6-.3-.6 2.4-.1Z",
  b: "M741.3 308.3l4.8-2M762.3-64.7l-.6 1.3-2.4 1.4 2.8 1.3-2.3 1.8.9 1 1.8.1-.7.9.7 2.5-.6 1.7 2.5 1.6 1.7-1.8 1-.1-.9 1.6.8 3.3 1.1 1.3 1.9.6-1.1.8-3.2-.2-.4 2.2 5.1-1 1 1.3 1 .1 2.8-3 3 .8-4.5 3.1.4 1.7 1.5-.8 1.1 1.1-2.3 2.8.1 1.7-1.4 1.2.3 1.7 1.9-.2 2.8 3.4.9-.8 2.8 1.3.1-1.2.7.1-.9 2.6 1.4 2.4-.7 2.4.4.8-.1-1.3.9.5-.3 2.8.9 2.5-1 .8.4.9-.8 1.5 3.6 3.1-2.6 1.1 1.5 2.1 2.2 0-.9 1.3.4 1.3 1.1-1.3.9 1 3.4-.9-3 2.9 2 1.5.1 1.9.9.2-.1 2.7 4.4-.4-2 1.5.5.4-.9.9 2.4-.1-1 2 1 3.3-2.2.1 0 2.6 2.3 1.4-1.3 1.2-1.4.4-4.1-1.6-1.4 1.5-1.9.5-.6-1.4-3.5-.8-1.2 2.6-1.7.3.5 1.6-1.8.9-2.6-2.3-1.7.5-2.4-.6-6.4-3.5-.5.5 1.9 1.3-.2 1.6 1.5 1.5-.5.9 1.8 1.6-.9.7.3.5-2.8-.3-.9-1-3.2-1 .1-.8-1.5.5 5 4.6-1.1 2.1.3 1.3-2.7-.9.4 1.6-2 1.6 2.2 3.2-1 1.3.1 1.5 3.6 2.1-.5 1 2.2.8 1.4 1.6 3.1-.1 1.8 1.1-.9 1.2 1.4 4-2.7-.5-1.1 1.4 1.9 3.3 1.5.3.8-1.2.6 1.4 2.3 1.2-.2-1.1 1 .6.2-4.3 1.4-2.1 2.2 2.4-1 .4 2.2 3.1-1.3-.2 1.9 4.1-1.2.8 2 2.6 1-.6-.9-2.2 4 2.8 3.1-1.8.5 1.8 1-2.2 1.8 1.3 1.2 2.4.3-.9 1.4 1 2.5.1 1.6-1.3 3.2 1.8 1.7-3.1-2-3.1 0-.7 1.2.1-.9-1.9.9-.6-1.3-1.8.2-2.1-1.8-4.1 3.7-3.1.6-1.5.6 1.2 2.7 1.1-4.5 2.3-1.3 2.7 1.7 1.4 2.3-.3 2.5 3.7-1.8.3 1.1.7 31.5-11.7 31.9-13.1 3.6 8.4M227.8 473.3l-1.5-.3M657 110.8l9.3 52.6-.3 2.4 1.9 2.6.7 2.9 6.7 7.9 3.5 2.6 8.9 0 5.3.9 2.1 1.2 1.3 1.9 2.6 1 .9-.2-.1-1.4 1.1-.3 2.9 4.5 3.7 1 2.2-1.4 3.4 1.5 1-.2.8-1.4 4-2.7 6.8-2.8 3.1.6 0 4.3 1.8 1.2M839.2 145l-1.1.9-.5 2.4M432.5 502.3l-3 2 2.2 1.5 1 4.8-1 3.5 2.4 1.7-1.4 2.4 3.5 1.1-.3 3.6.4.5.9-.4 1.1 1.6 1.1.2.5 3.7 1.5-.6 2.1 2.1.9-1.4 3.8 1.1-.1 7.9 1.6.6.1.7-6.7 5.3-1.4.2-.8-.8-1.7 1-.6.7.6 1-.8 1.1.4 1.6-1.9-.9-6.7 3.9.3 1.6 1.6-.6.4 2.4-.7 4.3 2.2 3.3-2.3 1.9-3.6.2-1.8 3.2.5 2.6-2-.7-1.3.9 1.1.7-.1 1.1-4.1-.3-.2 1-1.5-.7-.2-8.9-1.6-3.1-.1-5.4-2.9-4.2-6.5 8.7-9.4 6.2-3.3 3-1.2.4-.3-1-1 .2-.6 1.8-1.1.7 1 2.1-.5 1.8 1.8 3.8 4.7 5.1 2.5-.6.8-1.3 1.1-.3 2.2.2.9 2-1.3 1.5.6 4.7-4.2 4.6.5 2.3-1.7 1.2.9 3.3-1.7 1.6-1.7.2-4.4 5.3-.9 1.7 1.8 2.8-2.2 3.1-5.1.3-3.7 1.6-6.8 1.4.5 2.2 4.2.5.8 1.5-1.6.6-.2 1.1 1 2.4-.2 1.9 2.2 0 .9 1.4-1.7 2.3-1.7-.3-2.5.9-1.2 1.8-3 1.6-2-1.7-1.1 1.1-2.3 0-2 1.1-.3 1.3-2.1 1.6M559.6 666.6l.7-1.3-1.7-1-.2-.9-2.4-.9-1-2.8-1.5-.2-.5-2.4-2 .5-.9-.7-1.3 1.9-4.1 1.3-.6 1.4-5.9 4.3-2.5-2.5-1.2-.2-.5-6-1.4.5-3-1.4-2.1 5.6-3 4.1-.6-.6.3-2.2-7.4-4.8.4-1.8-1.5-3.3M228.6 408.9l.4-3.8-.6-2.6 2.1-2.7 1.5 0M246.7 476.9l-18.5-3.5M616.4 596.1l.5 3.1-.7 3 1.1 2.4-1.8 5-4.6 3.7-3.2.1-1.1 1.8.3 1.2-1.4-.7-1.4 2.2-4 1.9-1.1 1.7-.8-.5-1.3 1.3-6.8 2.4-.6 2.7-3.7-5.6-3-1.6-3.5-5-1.2 1-2.3-1.5-2.1 0-.4-4.8M382.4 477.4l-10.7 17.1 3.1 20.9 4.8 5.7-1.4 3.7-.1 6.1-2.6 2.3.8 2-1.4 2.1 3.1 3.6.5 3 5.5 3 .3-2.7 2.7-2.7 2.4 4.2-.4 5.6-4.1.8-7.7-1.8-1.8.8-.3 1-1.6.2-2.5 2.7-2.6 1-.2 2.2-1 .2 1.1 4.2-.4.6-1.3-.5-.6 1.6-2.4 1.4-.8 4.1-1 1.1-.9 7.4-2 5-.2-2.5-3.1.5-3-4.2-3.8 1.7.3-2.3 1.7-1.4-.7-2.1-3.4-2.1-3.1-.4.1-1.8-1.9-.1-2.2-2.5-.4-3.3-1.6-1.6-.6-2.2 0-3 1.1-2.5-1.3-.3-1.2-3.5-2.5-2.1-2.9 1.4-2.5-1.5-1.8-5.6-3.7-3.9-.8-3.7 1.1-5.1 2.5-2.5-4.3-4.1-1.1-4.1-5.8-2.2-.1-6.5-1.9-3.7-.1-1.7-4.8-3.2-1.6 1.2-.9 2.9-10.1 6.3M292 512.7l-.2.1M754.4 254.4l.6.7 18.3-10.6 3.5 3.7M773.6 244.5l.7-2-2.4-9.4 4.8-1.4 1.4 3.3 1.6 1.1M750.9 261.1l-1.7.8-.1 2.4 3.5-1.5.9.4M781.9 238.8l-.8-2.3-1.4-.4M175.3 154.4l.8-.3 1.4 1.4 4.4.8.6 2.2 3 .2 1.3 1.2 1 3-.5 5.4 4.6 2.7 5.8-1 5.6 1.8.9 1.7 2.9.4 3.3-.6 4.4 1.1 8-1.2 5.3 1 1.2-.5 23.3 5.4.7 2.9 2.3 1.9.3 2.6-6.2 8.1-.9 2.5-5.2 5.2-.6 2.9 2.4 1.1.6 1.6-1.1 1.1.1 1.4-1.8 2.7-6.4 29.1-40.7-9.9-42.4-12.1M576.3 459.4l.4.5 4.4-1.1 4.7.9M399.4 153l-8.2 96.5 65.5 3.7 5.8 3.6 1.7-1.4 6.7-.1 1.7 1.6 5.1 2 1 2.2 2.5.6.6 5.2 2.3 3.1 1.1 3.2-.3 4 1.2.2-.2.9.9.4-.4 1.9 1.1.5-.7 1.4.9.8-.2 7.3 1.3 2.1 21.3.2 27.8-1.7 3.7 3.8-.7 3.3 2.1 7.1 7.8 7.1 1.8 5.8.9.6 1.9-1.6 3.9 2.1-2.7 8.2.4 1.9 3.3 3.1 2.4.9 5.4 4.2 1.3 4.5-.9 2.2 2.1 3.4 1.4.7-.5-1.1.6-.3 1 1.6.9 0-.7 6.1-.5.7-1.6-.9-.5 2.2 17.7-1.3-.6-3.1 3 .5 52.7-4.8 26.4-4.1-.6 3.6.5.8-1.2-.1-1 .9-1.7 3.7-2-.5-2 1.1-2 2.7-1.1-1.4-2.1 2.3-1.2 0-.7 2.8-2.3.7-3.8 3.6-5 1.6-1.4 1.6-.5 2.7-2.7.9 0 4-50.5 4.9 1.4 1.8-1.3 49.2 3.6 27.9M691.5 416.3l-3.6-1.2-.4-3-1.3-2.5-3.1-1.8-2.6-6.4-3.5-1.4-1.5-2.4-1.3-.6-.3-1.8-3.5-1.8-1.7-2.4-4.4-2.5-4.8-7.5-2.6-.2-4.5-2.9 2.5-5.1 4.6-1.9 4.3-3 17.4-1.5.5 1.4 1.3-1.1 2.2 2.2.5 2.1 14.7-1.9 16.8 12.1M741.4 332l-51.4 10-20.1 2M742.9 331.7l-.4 0M737.6 278.3l3.1-2 0-1.4 3.9-4.1-7.2-6.1-.4-2.2 1.2-2.2-1.4-1.5 3-6.4.9-.7 10.6 3.6M271.8 134l-3.3 15.5 2.5 5.6.2 1.6-.8.6.7 1.4-1 .4 3.6 3.7 3.5 6.3 1 3.6 1.2-.3.7 1.9 2.7.2-2.6 7.2-.9.4.4 4.5-2.1 1.4.4 1.3-1 2 2.5 2 2.3-1 1.8-1.8 1.8 1.9 0 4.9 2.3 5.2-.8 1.3.4 1.2.9 1.3 1.2-.2.9.9.8 5.3 1.5 1.7 1.3-1.6 4 1.2 2-1.5 8.8 1.8-.1-1.6 1.6-1.5 3 4.7-8.9 56.3 42.9 6 41.2 4.2 2.8-32.5M236.8 242.2l34.8 7.2-15.4 80.2 63.1 10.5-12.6 91.7M328.3 275.3l-9 64.8 38.5 4.7 38.5 3.5-6.9 81.2-48.9-4.5.5 2.7 1.2 1.2M472.7 156.6l1.3 5.5-.6 1.9.3 6.4 2.8 8.6.2 9.6.8 1.3-.4 4.5 2.1 5.2.5 6.2-42.1-1.1-42.3-2.7M396.3 348.3l12.3.8 4-65.3-24.2-1.8M488.8 292.7l1.4 4.7 2.1 1 .8 3.3 1.2.8-41.2-.5-41.5-1.9M516.8 465.5l1.2-2.6-.8-3.7.7-1.6-.4-1.5 2.1-4.2.4-2-.6-1 .9-.6-3.1-7.6-1.5-1.3-.2-3.2-2.8-3.3-.6-25.3-2-.6-2.6.5-1.1-1.3-5.4-1.7-1.3-1.6-3.4-1.8-1.8 1.6-1.9-.1-1.3-1.3-2.5 1.6-2-.6-4.7 2.1-.6 1-1.1-1.4-2.2-.8-.3-1.1-2 .9-2.4-1.8-1.2 1.6-.7-.1-.3 2-.7.3-.8-3.1-.8.9-2.3.4-2.6-2.7-2.7 2-1.2-.1-.3-2-1.8-.6-.2-2-3.1 0-2 1.1-1.3-1.4-1.7.3-3.4-1.4-2.7-.1-.1-1.7-2.2-2.4-.8 1.3-3.2-.2-2.9-3.1-1.5-.1 1.3-31.5-38.6-2.2M494.3 302.5l2.8 2.2 1.8-.7.9 2.6-1.2.1-1.7 3.1 2.7 2.7.9 2.7 2.7 1.2.4 35-47.3-.2-47.7-2.1M479.7 205.8l-1 2.9-2.6 2.6 1.8 2.9 1.6.4 1.3 1.6-.2 29.2-1.7 0 .8 2-.5 2.4 1.1.2.3 1.6-2.2 6 1.3 1.6.5 2.2M228.2 473.4l-.4-.1M799.5 124.2l-.8.7.1 1.2-1.1-.2-2.6 1.4-.2 1-3-.7-.4-.9-5.2 1.6.3 1-2.8.9 1.5 6.1-1.3 2.3-4.5 3.5M203.5-110l.5 2.1 1.7 1-2.2 2.2 1.1 3.3-.9 1.1 1 .2 1.7 2.3-1.3.3.5.9-1.1.5.4 1.7-1 .6 3 1.6.7 1.1 2.2-.1 3.6 8.9 1.7 2.1 2 .6 1.1 1.2-.1 4.2-1.3 1.3 1.3.6-.7 4.3 1.4.7 1.7-.5 1.7 1.1 1.7-.8.8 1.3 1.3-1 4 3 1.9-.4 2.4.7 1.3-1.3 1.7.6.2 2.7-1.6 1.1.9 3.3 1.6.8-.4 1.9.9 3.8-.8 1 1.7.8-32.5-10.5-32.1-11.8-31.5-13.1-31.1-14.4M655.6 102.6l1.3 7.8M292.7 138.3l.5-.6-.9-2-2.2-1.4-1.5-3.4.5-2.5-1.7-.8 1.9-2.8.5-4.5-.3-4.8-1.7-3.7-.9-.6-1.4.3-.6-2.9-2.8-2.6.9-.6-.2-1.2-1.3-2-1.9-1-.3-2.1-1.9-1.6.1-2.2-2.2-3.6-.4-2.7-1.8 1.1-1.2-.4-.4-3.2-1.8-2.5 0-2.2-.7.6-2.2-.5-1.3-1.4-.4-1.4 1.2-1.5-2.2-2-.8 1-1.9.2.6-1.7-.9-2.4.6-.8-.5-2.8-.6-1-1.3-.2.1-2.3-.9-.5.4-.9-.7-1.3-1.2-1.2-.7 1.5-2-1.5-.7-2.9-2.4-.4-1.9-3.2.1-1.5 1.9.4-1.8-3.7 23.3-90.4-33-9.2M272.8-40l38.3 8.9 38.6 7.2 42.2 5.7 40.2 3.5 3.8-59.7-56.9-13.2-4.2-2.3-8.2-9.3-14.5-2.4-11.3-8.4M360.7-22.2l-24.8 167.8M552.6 31.4l-43 49.9-15.1 14.7.4 54.6M428.2 155.1l0-107.2 3.9-62.6 32.3 1.5 32.3.2M444.3 633.4l-.6 8.9-1.2 1.2 1 1.8-1.3 0 1 4.2-2.3-1.1-3.6 2.1-1.6-3.1-1 0-.5 1.4-1.4 0-2.7-2.8.2-.8-2.5-1.5-2.1 2.2-1-.7-3.6.7-1.3 1.8-2.5 1.4-1.9-3.9-.1-3.2-2.8-.6 5.5-5.8-.5-1 3-1.7-1-2.1 1.7-5.7 2.9-3.6 1-.2-.8-1 1.5-.9.5-3.2 5.3-2.1-.5-1.2 2-2.7.8-1.8-.4-1.1 1.2-.8 1.2.5 2.9-.8.3-1.7 1.3 0 1.8 1.8 3.6-.4.1-2.6 1.1-.4 1.1.8-.8 1.5 1.3 1.3.8.3 1.1-1.4.1 2 1-.4 1.3 1.2-1.7 2.1.1 1.7-3.1-.7.1 1.3-1.2.5 1.2.8-2.5 3.3 1.5 2.2 5.7-5.1 1.4.5.3 2.7-4.4 3.8.5.6 1.7-.1.5 1.7-2.5 3.9 1.7 2.8-1.7-.7-1.5 1.9-2.2-.8-3.6.8 1.1 2 2.7.4 1.9 3.3 2.3 2 2.3-1.6 2.2.9 1.3-2.4 2.6.5.8-1-2.5-1.7-1.1.3-.6-1.1.7-.6-3-1.5-.4-1.5-.2.8-1.1 0M438.8 604.8l-1-.4.2-1.4-1.4-4.3-2.8 3.2-1.6.4-1.6.2-2.5-1.9-.9 3.4 1.2.9-1.8 1.2-3.2-.5-.9 3.7-1.3.9-1-.8-1.7.4-2-.9-1.7 3.9 1.1 4.2 1.6 2.6 2.7 2.2.2 2.6.8.7M427.4 602l-9.3-4.5-1.6 2.5-2 .3-5-4.4-4.2-.3-1.2-1.9-2.5.6-5.4-3.4-3.3 2.2-.5 1.5-2.4 1.3-3.7-.5-2.9-1.5-1.5.3-.4 2.2 2 .8-.8 2.5-1.7 1.7-.4-.8-1.6.8-2-.2-.9 3.8-8-3.1-.5-1.1-1.6.3.9-2-.2-2.5 1.3.7 2.1-1.6-.2-3 2.4-2 3.8-.9 1.2-1.3-.6-1.2 1.5-2.1-2.2-.5.1-.9-2.7-2.4-.9 1.6.9 1.1-2.2 3.2-2.6.1-.1-3.3 1.4-3.1-.5-1.1-1.3-.3-2.4 6.5-.2-4.5 2-4.1-3-.9-.4 3.1.9 1.2-.6 2.1-5.9 1.2.4-.9M454.7 617.5l1.9-5.2 1.6.1.9 3.2 2 .5.5 1.3-1 1.3-1.1-.8-1.3.6 0 2.4 1.5 1.5 1.1-.1.4 1.1 2.8-2.2 4.1 2.3-2.7 3.5 0 2.3-1.4 2.7 1.1 1.5-1.4.5 3.1 1.9 3.6.8-2 1.6-2.5.2.6 4.2-1.9 2.2.8 1.4 2.4.2.6 2.6 4.8-1 .9 2.8-4.1 3.9-4.2-.8-3.2 2.9-2.9-3 .6-3-1.9.9-1.5 2.3 1.3 2.2-1.1 1.1-1.2.4-.8-1.9-3.6.1-1.5 1.7-1.7.3-1.3-1.2-5.1-.8-1.2-1.7-3.2-2-.2-1.8M448.3 658l-.8 3.9.9 5 1.6 1.5 1.2.2 2.2 3.6M418.8 620.6l-1.7 1.5.1 2.2-2.2.9-.7-.6-3.3.4-.8-1.1-1.7.8-1.6-.8.9-1.1-.5-.9-2.3-.2-.8 1.1-3.2-.6-.1-2.7.9-.6-1.2-1.1-2.4.1-1.1 1.9-3.4-.3-.7-2.7-.9.5.2-1.1-1.6.2M412.5 641.4l-1 1.1-.7-1-.9.9.6 1-.1 3.3 2.2 2.1-.6.9-.9.1-.1-1.8-1.8-.9-2.2.3-1.1-1.1-3.7-.2-4.1.7-2-1.7-2.5-.3-1.3.9-.2 3.6-.9 1.3-3.8.6-.3 3.6M474.3 650.3l1.5-1.9-.4-2.1 4 2 .8 2.4 3.2 3.7 3.1-.2 2 .7 1 1.9-2.1 3.8 2 3.6 3 .1 6.2-3.4-.7 2.3 4.2 3.4 1 2.2 17.2.8.1 2.1-.6.5M367.4 637l-.6-2 .8-3.4-2.2-3.1-3 1.3-3.3-2.4-2.8 3.1-3.3.3-1 .8-.9-.4-1 1.5M387 541.5l.9-.7 6.5-.2 4.6 1.7 1.2 2.3 2.4.9.4 1.4-1.2-.4.5 1.1 2.6.2 1.5-1.2 1.7.4 1.8 2.9 4 1.4 1.1-3.3-.4-1.9 1-1-1.4-1.4.6-1.2 3-1.6 4.8.6 1.2-1.1-1.5-1.2-2.5 0-3.2-2.8 1.8.2 0-.6-2.9-2.4-.9-1.8.1-2.7-5-7 7-5.4.5 1.9 1.6-1.6 1-5.3-1.5-.9-1.4 1.4-.7-3.1 2.8-1.9 2.5-.3 1.7-5.1 2.6-1.8 2.8 2.6 2.6-2M325 526.7l2.8.6 3.2-2.2.9-3.8 1.5-.3.6-1.2-.4-3.8 3.6-1-.2-1.8 1-.9.3-1.9.9.2 1.1-1.6 3 2.7 1.8.1 1.3 1.9 3.5 2.4 3.2-1.2 1.1 1.6.7-.6 2.2.5 3.8 2.7 6.4-6.3 2.5 0 5 2.6M396.2 590.9l-1.9-1.8-.2-2.4-2.4-1.7-.7.2-1.2-1.8-3 2.2-3 .6.2 1.2-3.4 4.5 0 1.2 1.3 1.1M439 639l0-3.3-1.4-1.2.4-.8-1.3-2.3-2.3 3.2-.7 0-.5 1.8.6 1.5 3.9 1.6 2.3-.2 1.5 1.7 2.5-.8M444 631.4l1.1-2.1-.7-1.2-3-1.5-2 1.2.5-1.9-1-1.8-3.2.9-.4 1.3-2.6 2.1-.7-2.3-1.2-.6.5-2-1-1.5-1.7.3-2.8-2.9M433.9 638l-.7.8.3 2.5-2.7 2-.5 1.9M341.4 607.6l3.4-3.3 2.7 0 2.4-1.2 3.7 2.2 3.4 3.4 1.6-4.3 0-2.8 2.9-.6 1.7-2.3-3.9-2.6 2.1-4-4.1-4.9 1.2-3M343.6 570.5l-1 .1-.1 1.7-2.2 2.1 1.2 1.5.4 2.7-3.5-.6-.2 1.3-.5-1M447 602.9l-.1-2-1.7-1.3.3-1.2 2.6-1.7-1.6-1.4.6-1.2-1-.4 2.2.1 1.5-4.2-4.5-3.2-2.7 1.2-6-1.5-2.2-3.9-.8.7-1.7-1.5.1 1.8-7-2.9-.5-1.6 2.1-1.6-1.4-2.9-1.3.6.6-1.9M520.3 669.6l4.5-3.6M305.3 502.4l-1.3-1-1.3-2.8.9-1.7.2-3.4-2.9-5.4-1.4-1.2-1.3-5.1 1.7-1.2 5.7 1.5 1.6-1.1-.9-4.8.8-2.1 0-10.7 1.4 0 2.4-9.9.3-7.7-5.6-5.8 2.1-8.1M445.9 586.8l4.7.4.3-1.1 1.4-.1 1.6 1.7 2.8.9.7 1.6 1.2-.8M566.3 657.7l-.1-2.6-7.9-1.6-1.8.1-.6 2.3-4.1 0-4.4-3-.1-4.6-3.5.2-1.9-2.9M589.5 627.4l4.7 3.5 2.2 2.8-1 8.3 1.3 3 .5 4.5-1.7 2.8.2 1.3M294 511.9l-1.2.6M252.6 179.1l-.5-1.8.7-2.4-.7-2.2 9.3-40.9M313.2 215.5l1.3-8.1 38.8 5.5 40.6 4.2M256.2 329.6l-2.4 12.6-1.6 2.6-1.4.1-1.2-2.3-2.5-.7-2.1.4-.7 1.5.5 2.2-1.2 5.9.3 5.1-1.2 1.3-.5 4 1.8 4.4.2 2.7 2.7 3.5-4 2.1-2.3 2.2-.3 3.9-1.1 2.4-1.7 1.8-1.4.2-.6 5.2 2.4 1.6.1 2.4-1.5 2-2.6-.1M306.8 255.6l-35.2-6.2M591.2 268.9l1.1-12.2-2.8-14.2.1-9.6 2.6-14.5 4.6-6.9-6.1-2.7-3.7.3-3.2 4.2-.2 2.1-2.5-.5-1.1-1.2.6-2.8-2.5.1.7-2.1-.2-3-3.6-1.6-.3-2-4.7-1.2-3.5.1-3.3-1.5-11.4-2.4-1.4-2.6-1.9-.6 8.4-23.8M503.6 351.4l.1 8.2 57.5-2.2 1.3 2 .1 1.4-3.7 5.1 8.4-.7.7.9.1.8-.9-.3-.5.7.8.6-2.8 2 .6 2.8-1.2.7-1.2 2.4.6 3.6-2.8 2.4.6 1.4-2.4 1.7-.1 1.5-1 0-.3 5.2-2.1.8-.1 1.6-2.3 2.2 1.1 1.5-2.8 1.3.8 1 0 1.9-2.3 2.1 1 .9-1.1 1.1 1.6 1.4-.6 2.6.9.6.4 1.8-.9.9 0 2.2 1.4.9-1.1 2.5 1.3 1-1.3 1.1 1 1.2 0 1.7 2.8 2.1-1.5 3-.9.1.2 2.1-3.4 3-1 4.4-1.2 1.2.2 3.4-1.7.4 1.1 3.5-1 .9 26.6-1.4-1.2 5.2 2.5 3.5 1.6 3.9.8.2M569.7 356.8l-1-.2.4-.8.6 1.8 1-.8M242.5 360.2l-52.6-78.9 12.3-47.5M503.7 359.6l2.7 18.2-.2 28.4M568.9 356.9l.5 1.9-1.2.8 1 1-1.8.6 1.2 1.6-1.3 2.4M639.4 260.5l-2.9 3.7-16.5 2.7 4.7 42.2 1.1-.9 1.3.9 2-.8 2.2 1.3 1.5 3 4.5.5 2.1 1.7 2.1-1.4 3.1 1.4 1.8-.6 2.9-2.6 1.2 2.6 4.4 2.3 2.1-.9.4-2.4 1.1-.6-.8-2.7 1.4-3.8 1.5 0 .7 1.8.8-1.5.8.2-1.1-2.2.8-.5.5-2.8 1.2-.3 1.1-2.4 1.3.8 1.6-1.1 3.7-4.4-.3-2.3 1.9-9.4-.5-2.6-1.2-1.5 1.8-1.3-4.5-27M644.3 347.7l6.5-3.3.7-1.7 2.3-1.1 1.9-4.2 3.8-2.9 4.3-4.9-2-.1-2.5-1.6-3-3.8-2.4-3.4.6-1.5-.6-2.7M745.6 292.8l-4.8-5.9-3.6-2.6-.7-2.8 1.1-3.2-1-.2-2.1.7-.9 1.8-57.5 10.9-2.4-14.9M512.4 416.4l38.7-1.4M560.8 382l27.9-2M622.4 377l9.1 32.7 4.1 7.7-.2 1.6 1.4 1-1.6 1.8-.9 5.7 1.9 4.5-.1 5.8 1.7 2.6-35.7 3.9-.2 2.2 3.3 2.9-.3 2.3 1.2 1.3-1.9 3.3M637.7 440.6l2.4 4.3 36.6-2.2 1.4 3 1.7-.4-.8-5.8.9-1.5 6.6.8M639.1 375l15.8-2.2M779.6 216.4l-3.4 2-1.4 2.3-22.7 5 .2 11.6 8-1.2 11.6-3M663.8 329.6l.8 2.6 4.8 2.1 2.4-2.6 2 1.2 4.1-2 .2-1.6 1.4.4 2.5-1.8 1 .5 1.9-1.7-.4-.8.9-1.1-.9-.9 4.5-10.5.9-5.4 1.3.2.7 1.2 3 .4 2.3-7.3 1.7.6 4.4-7 .2-4.8 7 3.7.7-3.3-1.3-1.7.3-.9-1.1 0-.2-1.6-1.4.4-2.9-1.1-1 1.3-1.8.5-.2 1.6-2.6.3-1.5-1.3-1.6 3.3-1.8.2-3.9 5-1.4-8.3M742.2 331.8l-.6.1M743.6 331.5l-.3.1M733.5 280.6l5.5 19.9 7.8-1.6M746.8 298.9l.2 0M719.9 296.6l.8-1.2 1.9 1.3-1.3 2.1-.1-1.2-1.7-1.4-5-1.9.2-1.8-3.5-.8M740.7 251.7l-.8-1.1-3.1-.4-1.3-1.5-1-3.5-2.2-.4-1.4-1.6-51.9 10.1-1.5-8.6M752.3 237.3l2.2 12.2 1 1-2.4 2.5 1.3 1.4M752.1 225.7l-2.9-12.8-1-1-.9 1.1-.3-.5 0-2.9-1.9-4.2.6-3.2-.5-3.4-1.5-2.4-1.2-6.1M762.9 184.9l.4 1.9-.7 2.8 1.6 2.2-.9 2.5-3.3 3.1.5 5.6-1.6 7.4 1.3 8.9-.5 2.3 1.7 2.1M779.5 212.9l-3.9-4.1-9.3-29.7M541.6 295l.9-.5-.5-2.9 2.9-1.6 2.2-5.2-.3-2.1-1.7-1.9.7-3 4.4-1 3.5-2.3.5-2.6 1.3-1.5.4-3.2-.6-1.5-2.8-1.8-.4-1.7-2.6-1.9-.9-2.9-4.1-1.2-1.8-6.7.8-2.6-1.5-.8-.6-2.1-60.8 1.4M541.4 244l-.7-6.4-1.5-1.8-3-.9-5.3-5.6-2.2-.5-1.3-1.7-2.2-.4-2.8-2.3.4-8.6 1-2.3-1-2.1-1.5-.3-.2-2 2-3.5 4.5-2.9-.3-9.3.8-.1.8-1.5 2 .3 14-10 7.7-.1M624.7 309.1l-.3 3 1.2.2-.1 1.7-4.5 2.2-1-.7-2.4.5.8 2.8-2 1.7-.7 2.6-2 .7-1.1 4.6-1.1.7-1.8-.7-2.8-2.5.7.7-1.6.3.4 1.1-.9.6.1 1.6-1.2 1.5-2.6-2-2.4 1.5-1.1 2.2-4.1-2.2-1.5.7-.8-1 .3 1.5-.7 1-.5-1.3-1.4.6-1.5-.7.3 1.6-.6.8-1.2-.3-1.2 2.5 1 2.7-4.9 2.2-.2 1.3 1.3 2.7-.6 1.1-6.8-2-2 2.8.8 1.3M549.5 259.7l42.8-3M586.6 334.1l-1-1.4.9-.1-.2-2.4.9-.6-.8-.2 1.1-1.1-.8-1.2.5-1.1 1.2 0 .8-2.8 1.4-.7-.3-1.2 1.6-3.3-.6-3.2-1.8-2.4.7-1.5-.4-1.9 1-.7-3.3-39.1 32.3-3.3.2 1M721.4 298.8l.1 1.1-2.5 4.1.9 2.6 2.7-1.6 1.7 2.8 4.4.1 1.8 1.8 3.8 1.4 2.1-1.5M750.9 260.7l.4-5.4M736.4 309.6l.3-.1M736.8 309.5l.2-.1M737.1 309.4l.6.7 3.6-1.8",
  k: "M351.6-58.4l4-2.7 6.5.4.6-1.8 5.9 1.9-5.1-1.1-.5 1 5.9 1.2-4.3.9-4.9-.8.7 1 3-.3-3.1 1.1 7.1-.8-5.7 1.6 1.8.5-6.5-1.3-6.5 3.8 1.8 0 0 .5-5.5 3.1-1.7 1.9-7 2-1-1.6-5.3 1.6-1.1 2 .8.1 0 1-1.3 1.1-2.6 0-1.3-1-4.6.9-.7-.6-4.3.3-5.9-1.1-3.6-2.3-.9-1.5-5.6-1.7-2-3.4-1.4-1 4.7 3.4 3.5-.3-.7-1.1.5-.5 4.6 1.8 1.8 1.8-.4-1 1.7-.7-1.6-1.3 3.1-.2-.2-1.2 2.7-2.2-.1-.7 6.1 1.1 2.1-1-.5-.5.6-.5-1-.3-.1-1.1-1.8-1.5-.7-2.5-1.5 0 1.1-1.1-.5-.5.7-1.7-3.7-.7-.5-.9.8-.2-2.6-2.7.8-1 2.3 1.8-.9.4 3.8 1.4 4.4 4.4 4 .3-.3 1.1 3.8 3.1-.4.4 1.8 2 9.6.7 4.9-2.7 2.4-.5ZM483 120.9l-.8 1.2.5.8-1.1.2.3 6.2.9 1.4-1.3-.1-1.2-1.6-.7 4.8-1.1.6-2.1-.5-.8-4.3.5-5.7 3.5-4.6-1.3-.4-1.7 2.5-.9 0 2.7-6.4-.7.1.2-1-1.2-.9-2.1 1.1-.3 2.2-1.5 1.2-.2-3.2.8-2.6-1.2-3.7-.8 0-1.7 1.8-.3-1.1 1.4-2.1-1.8.4-.4-.7-.9.7.7.3-1 2.4.5.9-2.8-1.2-.2-2.2-1.5-3.3-2.1-1.2-.5-2.2-3.4-3.7-.7-3 4.6-1.9-3.4-.7-.6.9-.9-.6-.8.5-2.4-2.5 3.6-10.6 1.8-.1.5.8 3.2-.2 3 1.5.8 1.2 1-.2-3.5-2.9-.7-1.7 3.1-6.5 1.1.9-.7.7 1.7.2-3.4 1.8-.1 2-.8.6 1.6 1.4.4-.9 2.9-1.6-.4 1.4-2 .5 1.5 3.8-.2 1.7 4.1 6.9-.1 1.7.9.9-1.1.7.3 1.5 2.1 2.9 1.6 4.4-.4 1.2.7.9-.9.5 2.7 4.3-.4 1.6 1.5.7.3.7-1 .3 5.1 8.2ZM639.2 254.4l.2 4.1 2.9.8 2.9-1.3 1.7 1.8-.1-2 .9-1.6 3.3-2.6 1.9-.4.6-1.2.2 1.1.4-2.4 4.5-4.8 4.9-1 5.2.7 4.8-.3-4.3-.6 2.2-3 5.7-2.4 7.3-1 1.9-1.7-1.7-1-.6-1.5 2.2.5-.3 1.3 1.2 3.1-6.7 8.1-8.7 7.1-10.7 6.5-4.1 4.5-3.6.3-4.7 2.6-2.9-1.2 1 .9-2.2-.4-1.6.9-1.7-.3 4-1.9-1.7-.5-.3.9-1.3.1-6.1-2.5 2.8-4.8-.3-1.5.9-3.4ZM715.5 213.6l-1.1 2.1-.3-.6-.7.8 1.8 3.1.4-.4-.5 2.3-2 .5-2.7 3.8-2.4 1.1-.1.8-4.9.2-2.3 1.2-2.2-1-4.3 0-6.6 1.7-6.9 4.1-3.1.1-2.3-.8 1.4-4.9 1.1-1.4 1.2-.2 2.6-3.4 15.7-5.9-.5-.6 2.1 0-.5.4 1.3.6 2.5-.8-.8.3.9.5.9-.8-.5 1.4 1.3 0 2.9-2-2.3.3 1.7-3-2.8 1.8.1-2.3-2.4 1.9-.2-1-2.9 1.9.2-.8 5.8-2.7 0 1.3 1.6-1.1-1.8 1.9 1.1 0 3.3-3.3 2.2-.6 4.8-3.3 1.5-2.3.6.8-.7 1.2-4.9 5.5 1 1.1 1.5-1 .4.4-.7 1.1 1.4-.6.1.6ZM415.5 8l.9-.9.4.6 2.6-.5.5-1.6.3.8 2.1-.3-.1 1.3 1.4.9-.9 1.5-.3-.8-1.3 1.3-.2.9 1.3-.1-.6.8-1.1.6.2-.9-1.9 1-.8 3.1.5 1 .9-.7-2.6 2.9 1.5-1.9-.8-1.1-1.8-.6-1.8 1.8-1.2.1 2.4-2.4-1.8-.5 2.5-1.2.6-1.1-2.7.8 2.5-3.3-1.3.4.6-1.9ZM434.7 16.2l-2.6 4.7-1.7 1.5-1.4-.1-.9 2.3 2 .1 1.1.9-2.3 1.4.8 3.1-4.6 2.7 1.8.6-2 .7-.7.9.9.2-.4.5-1.2-.1-.2.7-3.4 1.2-.4 1.5-.9-.1-.4-1.3-2 2.4.1-1.7 1.3-1.5-.8-.3-.4.7-.1-1.5 1-.6.6.9.8-4.9.5-.1-.1 1.8-1 4.3 1.7-.8 2.2-3.8-1.4 2.9 2.1-1.4-.1-1.2 1.2.1.3-4.3-2-.6.9-.7-.6-.5.8-1.2-.8.1-.3-1.1-1.8.7.8-1-.2-1.8 2.7-1.7-.4-1.7.9-.4.5.7 1.7-2.6 2.5-1.2 0-1.4 1.6-1.3-.8 2.4.8.4 2.1-3-.7 1.3.5 1.8-1.6 2.3.9-.9.5.5.7-1.7.5.7 1.4-.5ZM503.9 155l-3.7 3.7-1.8-.1-1.6-1.7-2.6 1.5-1-.7 1-1.6-.3-2.1 1.3-.5.2.6 1.8-1 0-1.7-1.5-.7 1.7-.4.7-2.1 1.6-.3 1-1.3-1.5-.1-3.8 2.9-.5-.5.6-1.3-.8-.8.6-.7 1.4.3.1 1 1 0 .8-1-1-.3.9-.7 3.2-.1-2.1-3.9.6-.8 1.3.7-.3 1.4 1.2 2 1.9.7-1.1.9 1.4.7-1.8 0 1.2 1.3 2.6.9-1.2.1 1.7 1.2-.3 2.1-.9.7.6-1.2-1.5-.9.2-1.1-1.4.3 1.1-1.4-.5-.3-3.8.3-1.4.8-.3 1.7 1.2-.9 1.2.4-.6.3 1.2 1.4 2.2-.8.3 1.8 2.8-.3-1.4 1.5-1.3-.5-.6.6ZM560.5 137.1l.9-.4.3-2 1.5-1.6 1.2 1 .7-.6 1.9 1.7.4-.7-1.7-1.7 2.3 1 .8 1.6-.1.4-.9-.6.3 2.3.8-1 1.6 1.3-2 .9 1.2.2.1 7.8-.7-1.1-.2.6-1.3-.5-.8 1.8-1.5-3.2.3 1.5-.9 1.1-1.5-.4-.5-.7.8-1.6 1.4-.2-.3-.8-1.2.6-.5-.4-.2 1.5-1.6 1.2-1.2-1.7 1.6.6-.4-3.3-1.3.9-.7-1 .3-1.5 1.1 1.3-.2-1.7 1.3-.9-1.1-1.7ZM465.5 133.5l0 1.6-2.5 1.8-2.6.4-1.4-.9.3-3.4-1.7-4.8-1.5-1.9.3-1.5-.8 0-1.1-2 .4-1.1 1.4 2.3.7-1.3-1-.6.4-1.8-1 1.1-1.3-1.6-.4-3.5-.4-.9-1.1.4-.4-1.8-1.6 0-.6 2.1-.4-2.8 1.1-1.9 1.5.4.8 2.4 1-.4-.3-2.2 1.2 1.5 1.5 5.8-.1-3.8-.8-1.4.5-.7 1.2.1 1 2.1-1 2.6.8 1.6 1.7.4-.9 2.9-1.4 1.1.2 1.7 3.7 1.5 4.6 6.5ZM448.5 113.3l.2 1-1.8.6-1.6-1.9-.1-1.7.8-.8-.7-3-.7.1.5 3.1-.5 1.9-1.2-3.3-.1-6.1 2.2-3.8-.9-1.1.3-2.8-.9.1-1.2-1.7-1 1.3.9.6 0 2.7-.2-.9-.9 0 .5-.8-1-.6.2-3.3-.9.1-.5-1-1.7.5 1.3 1.2-.9 2.2-1.6.2.4-1.1-1.4.3.1-1.1-.8-.3.5-2-1.4-1.4.6-.8 1.3 0-.2.8.8.3 1.8 0 1.6-1.4 1.4 1.2 6.4 2.5-.6 1.5 1.3-.7-.7 1.5.9 4.4-2.5 4.3.3 3.1.7.1.1 1.5-.9.9 0 2.3.9.4.5-2.2.4 3.1ZM366.2-7.9l-.8-.8-6.1 1-4.6 2.4-1.2 1.8 1.2-.2-.7 1.3-3.2-.9-.9 2.1.2-2.3-.9-.2-1.6 1.7.4-1.6-2-2.4 1.5-.3-.1 1.4 2.5-1 3.9-4.1 7.1-2.6-.3-.6 1-.1-.6-.3.9-.9 2.6-1.3 3 .5.7 1.9 2.6 0-1.9 1.6 7.4-.5 5.4 1.6 2.3 1.7 3.3 0 2.2 1.1 5.6.7-7.1-.3-3.2-1.3-3.9-.1-.6-.9-.8-.1-1 1.9-12.3.1ZM720 99.6l-1.2 1.7.9-2.8 2.1-4-.9-.8-3.1 7.3-.2-1-1.1 4.3.5 2.2 1.2.9-.8.3-.7-1.5 1.1 3.8-2.3 2.7.3.6-1.4.2 3.4-3.7-1.5-2.1.7.2-.7-5-.8 2.5.3.7.4-.5-.2 1.3-1-.6-1.6 3.6 1.9-10.2-1 .4.5-1.5-1-.2 2-1.1 5.3-7.2 1.5-.1-2 2.4 3.6-2.8-2.9 3.9.9.4 2.7-2.9.1.5 1.3-.3-3.1 2.5-1.3 3.2-.2-1.2-1.7 3.9ZM433.3-59.9l2.8-.6 1.9-2.3 1.2.2-.5-1.1 2.3 1.2.1-.8-.9-.4.9-.5 1.8 1.9 0-1.4.8.7.9-1.5.7.6.4-1.2 1.2 1.3-.8 2.4-1.4 0 .2.7-1.5-.8-.5.5.6.8-1.3.9.2.9 2.4 1.4-1.1 1.5-1.6.4 1.4 1.1-2.8 1.9-1.3-.3 0-1.1 1.2-1.1-.4-1.7-1-.1.6 1.4-1.4 2.5.1-1.7-1.9-.1-.2-1.4-1.7 0 .2-1.4-1-1 1.3-.4-1.4-.1-.5-1.3ZM368.6 40.7l-4.3 2.8-.4 2.5-.1-6-2.6-.5-1.5-2.7.8-.7 2.3.6 2.3 3.1-.4 1.6 1.3-.4.8-3.6 2.2-.6-.5-2.2-.5.6-.5-1.4-1.2.2 1.6-3.9-1.2 1.6-.4-.6-.8.5-.4-1.9.8-1.3-2.2 0 1.2-2 1.6.2-.6.9.8 1.2 1.1-.4.5 4.6.9-.7.4.8 1.8.3-.7 2.2-1.4-.5.7 3.6-1.4 2.1ZM693.2-106.3l.5-1-2.7-.7-1.2.7-.2 2-3.5 1.5-2.3-.5-.9-.6.5-.9-1.1.2-1.1-1.1.8-1 .3.8 1-.8-.9 1.4 1.5.2.8-.6-1.4-.3 3.2-1-2.4-.5.8-1.5 7.7 0 3 2.2-.8 1.3 1.1.1-.4.6-1.5-.6-1.5.7.7-.6ZM450.2-11.4l.2 2.8-1 .8-1.8-2.9 1.6 1-.5-1.9 1.3-2.6 1.7-.5-.4-.6 2-3.4.2-1.4-1.4-2.4 2.3 2 .6-.7-.6-.7 1.2.3-.5-.6 1.5-2.4 2.1-.7 2.1.3 1.3-1-.7 1.3-1.5.6-1.5-.5-2.1 1.6.3 1.7 1-.2.2 1.1-1.7-.6-1.8 2.9 1.1.4 1.2-.9.1 2 1.2 1.8-1.6-.1-1-1.5-2.2-.7-.1 1.1 1.4 0 .1.6-.9.4-.6 4.1.9-.4 1.6.6-1 2.9-1 .3.5-2.6-3.8-1.3ZM614.3 189.4l-.7.9-1.2-1.1-1.7.9-2.4-.4.3-4.7-2.7.5-3.4 1.9-6.9.6-5.3 4.6-1.2-.9-1.3.8-1.6-1.3-3.7.9-3.6-4.7-1.9-1-3.6-.2-1.9 1.7 1.2-2.3-3.2 3.4.1-3.6-.9-.7.1-1.1-1.4-.5-.4-1.4-3.1 3.8-1.8.4-1.9 1.9-5.3 1.4-2.8 2.6-4.1 1.9-3.7-1.8-.2 1.1-1.9.5 1.9-4.7-1.1-1.2-2.9 2-1.1-.4-1.9 1.7-4.3 1.5-1.9.3-1.7-1.2 13.9-14.3 7.6-3.6 7.9-5.5 1.1-5.6 4.3-2.3-1.4 4.4 2-1 1.1-4.1.8-.4.3-3.3 1.4 0 .6 1.4-2.3 3.6.1 1.7 1.2-2.4 1.4-.4-.4-1 .7.7.4-.5.1.7 1-3.3-1.8-1.4-.2-1.5 2.5-.8 1.1 1.2 7.2 2.1 3.2-.9 1.5.7 1.4-1 1.1.3-.1.7 2.2-.7 2 2.8 2.8 6.5 2.6 2.6 3.7.6 7.3-1.4-1.3 5.6 5.5 4.5-1.5 5.4 2 1 1.6-.8 1.2.7-.3.9-1.7.4.3 2.1.6-1.1.7.7-1.5 2.6 1.2 1.3ZM612.5 200.6l-2.5.6.7.7-1.5 2.3.3 1.7 2.2 1-.3.4-2.6.6-2.3 2.1.5 4.1-1.3 4.1.2-3.7-1 3.5-.7-1 .5-6-2.6 4.6-1.3-.4-.6 1.2-.9.1.1 2.6-1.7.9.4 5.4-2.4 5 1.3 4.2-.9 3.2 2.8 5.8 1.1-.3-.7.8 1.6 4.1.3 8.1-4.3 11-5.4 3.6-2.5.1-2.3-2.2-1.5-4.5-1.9-2.6-.3-8.9-1.8-3.7-.4-3.9 1.7-7.4-.5-3.7.7-2.7 1.5-1.7-.8-2 1.9-8-1.6-1.2-1.8.8-1.3 3.1-2 2.1-1.2-.5.4-2.3 1.6-3.9 2-1.1.2-2.7 5-9 .8-3.7.6 3.7 1.2-.8.7-2.2 2.5-.5 0 1.6-.7 0-.8 1.9 1.1 1 .9-2.6 1.8-1.1.9-2.3 1.9-.6 1.9.6.2-.8 2.8-.6 1.1-2 2.1-.2 3.7.9 3 2.3.2 1ZM672.4 208.8l-2.4.3-.9-1.4-1.8 1 .2 1 1.5.9.2 2.6-1 1.1-5.7-1.3-1.4-1.7-2.6 2.6-.1-3.2-1-.2-1.5 1.1 1.5-3.7-1.4 1.3-.7 0 .2-.9-.9-.6-.8.3-1.1-4-4.4.5-.1.9 1.6 0-.2.7 2.4 2.5.9-.1 1.7 5.5-1.1 3.2-1.8 2-1.1 4.1 1.9 9.3-.2 2.8-3.7 4.5-3.3 2-4.4-12.5-2.4-3.1-1.9-.5-4.7 3.1.8.2-1.2 3.1-.8 0-1.3 2.1-3.1-1.1.1-4.7 3-1.6.3-3.4.7 0 1.4-1.7-.7-7.4-2.2-2.9.4-1.2 1.7.4-2.9-4.5-5.7-1.9-2 0-1.4-1.9-3.2-.3-3.3-1.5-.2-1 .8-.3-.4-1.4.6-1.6 1.5.9 7.1-.5.1-.7-2.1-1.2.2-.8-2.7-.7.9-.8-.8-1.6 3.8-.2.7.6 9.7.7 3.8-1.3-.3.9 3.8-1-.3.6 2.6.4 4.6-.5-.2 1.5 1.3-2 1 .8-1.7 1.1 2.2-.8-1.5.7.9-.1-1.1 1.2 1.9-1.4-.1.6 2.8-.2.8-.9.4 1.2 3.9-.9 4.3 5.6 1-.9 1.2 3.5.4-.8.3 1.1 1.4.2-.1-1 1.2 0 .6.9-.8 1.7 1.6.9-1 .8 2.4 2.3 1.1.1.9 1.8.8-1.2-.1 1.4.7.5ZM636 226.1l-4.1 2.8.8.2-1.2 3.1-.8 0-1.3 2.1-3.1-1.1.1-4.7 3-1.6.3-3.4.7 0 1.4-1.9 4.2 4.5ZM643.9 193l.5.8-1.8.1-1 2.1-1.8-2.1-1.8 1.4-.5-.4-.8.9 1.1.7-.3 1-.8-.9-1.8.3-1-1 .1-1.3-3 1.6-3-.8-1.1.9-1.6-2-1.6-.1.5.6-1.7-1-.5-2.5 9.7.7 3.8-1.3-.3.9 3.8-1-.6.4.7.3 4.3.1.5 1.6ZM672.4 208.8l-2.4.3-.9-1.4-1.8 1 .2 1 1.5.9.2 2.6-1 1.1-5.7-1.3-1.4-1.7-2.6 2.6-.1-3.2-1-.2-1.5 1.1 1.5-3.7-2.1 1.3.2-.9-1.7-.3-1-2.3.2-1.5-3.7.4-2.3-5.8 1.2-2.8-1.4 0 .4-2.6 1.4-1.3 0 .6 2.8-.2.8-.9.4 1.2 4.5-.5 3.7 5.2 1-.9 1.2 3.5.4-.8.3 1.1 1.4.2-.1-1 1.2 0 .6.9-.8 1.7 1.6.9-1 .8 2.4 2.3 1.1.1.9 1.8.8-1.2-.1 1.4.7.5ZM467 26l-1.2.4-.9 3.3-3.4.4-2.1 3.7-1.4.1-1-.9-1.9 2.5-3.1-.5.6.6-.5 1-1.6-1.5 2.2-.7-.2-1.2.8.5 1.2-2.6 1.6 1.3 1.2-2.7.6.4-.8 2.4 1.8 0-.4-2.5 1.6.4 1.1-2.9-2.4-.4 3.2.3.6-.7-.5-.1.2-2.2-.9-1 .7-1.5.3 1.7 1.8-2.1 2-.1-1.4.7.6.5-.5 1-1.4.4 1.3.1.4 1.5 2-.3-.2.7ZM443.4 82.6l2.4 1.1.3 1.7.9.6-1.1 1 1.3 1.9 1.1-1.3 2.2.2 1.5-.8-.4 2.4.8.8-1.1.1.4 1.5-1.5.1.4-.9-.8-.1-.4-1.5.1.8-1.1.4-.4-.6-1.5 1.2-4-1.6-.9-2.2-1.1.5-.8-1.2-3.1-1.6 1.3-1.3 2.1 1-.6-1.8 1.4.6 1.1-1 1.5 0ZM682.6 61.5l-3.3 2.3 1.9-.9.6 0-.3.6-4.4 2.3.1.6-.5-.7-2 1.3-1-.4-.9.8-.8-1.2-.3 1-1.4 0-1-1.3 1.2-.7-3 0 2.4-2.5 2.5-.1 3.5-2.7.9-1.6-2.3 0-1.4-.9 1.1.4.1-.8 2.6 1-.2-.8 1.1.3.8-.7-2.6-1.1 1.4.1 2.1-1.4-.8.8 1.6.3.5-.6 1.5.6-2.5.7.8.7-.8.7.9.5-3.3 2.2 2.8-.2-2.5 1-1.7 2 2.7-.5 1.5-1.1 2.4 0ZM770.2 77.7l-.6 3.5-1.4.4-1.1 2.4.4 5-.5-3.6-2.9-2.6-3.1-2-.4.5-.7-4.7-3.5-2.7.9.3.1-.9.5 1.6 1.9.6-1.2-4.3 2.2 4.5 1.1-1.3-.2-1.2.8 1.1 1.7-.8-.3-1.5 1 .7.1-1.3-1-2.9 1.1 2.2.4-1.2-.5 4 1.4-.6 1.2.5.7-2.5.3 1.4-.9 1.6.9.4-.6.2.5 1.1 1.7 2.1ZM682.6 61.3l2.2-1.2-.8-.5 2-1.7 4.4-1.3 1 1.7 4.7-3.1-.2.6 1 .3-3.4 1.4 2.1-.1-5.5 3.1 4.4-1.2 1.5.7 3.3-1.7-4.4 2.3-1.3 1.5.8-2.1-1.9 1.3-.6-.6-5 1.3-.1.7 2-.7-.8.4.3 1-3.3 1.9-1.5 0-.5-1 2.4-2.7-1-.3-1.4 1.2-.4-1.2ZM293.4 270.3l-3.3 2.8-2.8.8-.3-4.1-1.3 1.6-1.9-3.8.4-2.4-.6-1.4-.8-1.1-1.2.5 1-.6-.1-4.7 3.6-.2-.4 2.6 2.2 1.8.5 3.6 1-.3 0-3.6 1.3.3.1 1 2.4.1-.5 1.1-1.9-.5-1 1.1.8.2 1.2 3.6 1.6 1.6ZM806.2 21.5l-.8 1.3-2.7-.1-1.2 1.1 2.6 0-2.3.4-1.8 1.1 1 .6-3.5 1.4-1.4-2.5-4.3 1.1 1.4.6-1.1.7 1 .6-3 .5-1.3 1.6-1.1.1-.3.7 1.3.6-2.3-.1.8.5-.8 1.1 1.9.1-.2 1.3 1.8 1.1-.3.4-1.6-1.1.1 1.7 2.8-.6.5.5-4.3 1-2.1-.2-.3-.8 2.3-.1-.8-.9 1 .1.2-.6-2.2-1.5 1.6.4-1.4-1.1 1.1-.4-1.4-2.2-.1 1.1-1.9-.8 1.3.2-.9-1.3-2.1-.9-.8.8-9.1-5.3 1.9 2.2 2.1.6-2.6 0-.3.6 2 1.1-1.5 0 2.3 2.1-2.1-1.3-2.1-2.3 1.3-.4-1.8-.2-.1-1.2 1.2.2-2.5-.8 1.8.3-1.4-.7.6.1-.5-.8.9.5.5-.6-.8-.5.7-.1-1-1.8 2.1.4-3.4-1.5-1-.9 1.2.3.2-.6-1.5-.9.9.3-.4-.8 2 1-2.1-1.4.8.1-.5-.5 3 1.4-1 .7 1.1.7-1.2.3 1.1 1.1-2.1-1 3.2 1.9-1.2.3 1.3.6-.6.4.7-.3 2.7 1.9-3.6-.9 5.1 3 .5-.4.8 1.1.2-.9 1.4 1.8 1.4 0 0-.6 3.8 2.3-1.5-2 1.7-1.3-.8-.7.7-.4 1.9 1.4 2.2-.4-1.7-.6-2.7-3.9-1.9.3.5-.4-.9-2.5 1.3-.4.4 1.3-1.1-.3.3 1 1.4.2.6 1.6 1.8.7-.1 1.1 1 1 3.1-.5-2.2-1.3.3-1.4 1.5.4-1.1-.5.9-.8.8 1.9.8-1.3-.2-1.7-.8-.9 0-2.6-1.7-2 2.6 1.6-.4 2.4 1.6.8.8-.4.8 1.6 2.1.2 2.3 2 2.5-.5-2.4-.2 1.5-2-2.3-.5 3.6-3.5 1 2.3 1.6-.2-.9 1.5 2.3 1.8Z",
  /* percent-of-frame, from the same Albers projection that drew the paths above, and drawn
     through the same viewBox at runtime — so a marker can't drift off its own coastline */
  at: {ANA:[19.63,65.85], BOS:[77.9,40.06], BUF:[68.69,42.23], CAR:[70.96,62.39], CBJ:[64.52,51.96], CGY:[29.9,18.92], CHI:[58.55,47.57], COL:[37.5,53.6], DAL:[47.5,74.75], DET:[63.95,45.19], EDM:[31.19,12.21], FLA:[71.47,90.49], LAK:[19.21,64.98], MIN:[51.91,39.39], MTL:[73.82,32.57], NJD:[74.92,46.27], NSH:[60.52,63.95], NYI:[75.61,46.02], NYR:[75.12,46.14], OTT:[71.28,34.19], PHI:[74.03,49.12], PIT:[68.06,49.61], SEA:[20,24.69], SJS:[15.97,53.61], STL:[55.85,57.41], TBL:[67.98,86.28], TOR:[67.89,40.23], UTA:[29.35,48.71], VAN:[19.95,19.75], VGK:[23.9,60.7], WPG:[47.38,25.31], WSH:[72.13,52.82]}
};

/* Percent-positioned HTML markers over the SVG rather than <image> inside it: it reuses
   CG.crest (logo when a club has uploaded one, generated crest when not), and every pin is
   a real link to the club with a real accessible name. */
CG.naMapPins = function(){
  var seen = {}, out = [], i = 0;
  (CG.TEAMS || []).slice()
    /* south-first so northern pins stack above southern ones where they nearly touch */
    .sort(function(a, b){ return (((CG.NA_MAP.at[b.code]||[0,0])[1]) - ((CG.NA_MAP.at[a.code]||[0,0])[1])); })
    .forEach(function(t){
      var at = CG.NA_MAP.at[t.code];
      if (!at || seen[t.code]) return;          /* a franchise we have no coordinate for is skipped, not guessed */
      seen[t.code] = 1;
      /* the crest alone — the club is identified by its own mark, which is the point of using
         real logos; a three-letter code under every one of them was just clutter on the map */
      /* the club's own colour rides along on the element, so the hover glow and the zoom flare are
         that club's rather than one shared gold for everyone */
      out.push('<a class="na-pin" data-mx="' + at[0] + '" data-my="' + at[1] + '"' +
        ' style="--pin-i:' + (i++) + (t.color ? ';--team:' + esc(t.color) : "") + '"' +
        ' href="#/team/' + esc(t.code) + '"' +
        ' aria-label="' + esc((t.city ? t.city + " " : "") + t.name) + '">' +
        CG.crest(t.code, 54) + '</a>');
    });
  return out.join("");
};
/* Frame the map on the CLUBS, not on the continent.

   A fixed viewBox with preserveAspectRatio has to pick a poison: "slice" fills the box but crops
   whatever the box's aspect can't hold — at 375px wide that cropped San Jose clean off the map —
   and "meet" letterboxes instead. Neither knows which parts of the picture actually matter.

   So compute the window: take the bounding box of the pins, grow it to the container's aspect,
   leave a px margin for the crest disc and its label, and hand that rect to the SVG as its viewBox.
   The pins are then placed from that same rect, so the path and the markers can never disagree —
   and every club stays in frame at every size, because the frame is derived from the clubs. */
CG.naMapView = function(box, padB){
  var m = CG.NA_MAP, xs = [], ys = [];
  (CG.TEAMS || []).forEach(function(t){
    var at = m.at[t.code];
    if (at){ xs.push(at[0] / 100 * m.w); ys.push(at[1] / 100 * m.h); }
  });
  if (!xs.length){ xs = [0, m.w]; ys = [0, m.h]; }
  var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
  var y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
  /* A tier with one club — or two in the same city — gives the pins zero span, and a zero-span
     bbox divides through to a 0x0 viewBox, which switches the whole SVG off and leaves every pin
     at left:NaNpx. Floor the span so a small league gets a sensible regional view instead. */
  var MIN_W = 260, MIN_H = MIN_W * m.h / m.w;
  if (x1 - x0 < MIN_W){ var mx0 = (x0 + x1) / 2; x0 = mx0 - MIN_W / 2; x1 = mx0 + MIN_W / 2; }
  if (y1 - y0 < MIN_H){ var my0 = (y0 + y1) / 2; y0 = my0 - MIN_H / 2; y1 = my0 + MIN_H / 2; }

  /* Breathing room around the outermost pins: half a crest either side, and more below, where each
     pin carries its code and the caption sits over the bottom-left corner. Capped as a fraction of
     the box as well as in px — these get DIVIDED BY below, so a fixed 44px pad on a narrow plot
     eats most of the width and demands a window several times the size of the map. */
  var padX = Math.min(44, box.width * 0.12), padT = Math.min(34, box.height * 0.12);
  /* the ceiling here matches the one naMapLayout stops growing padB at, so the caption-clearance
     passes are never silently capped out from under them */
  padB = Math.min(padB || 58, box.height * 0.45);
  var usableX = box.width - padX * 2;
  var usableY = box.height - padT - padB;
  var vw = (x1 - x0) * box.width / usableX;
  var vh = (y1 - y0) * box.height / usableY;

  var aspect = box.width / box.height;
  var VW = Math.max(vw, vh * aspect), VH = VW / aspect;      /* grow the tight fit to the box's shape */
  /* Never open the window wider than the geometry goes. Past `bl` there is nothing drawn, so the
     straight edge where the source data was clipped would come into view — and, the reason this is
     a guard rather than a nicety, a box measured before the hero has settled asks for a window many
     times the map. Bounded here, the worst a bad measurement can do is show the whole continent.
     The pin fit still wins if the two ever disagree: losing a club is worse than showing an edge. */
  var bl = m.bl || [0, 0, m.w, m.h];
  var capW = Math.min(bl[2] - bl[0], (bl[3] - bl[1]) * aspect);
  if (VW > capW){ VW = Math.max(vw, capW); VH = VW / aspect; }
  var sx = box.width / VW, sy = box.height / VH;
  /* park the pin bbox in the middle of what's left after the margins */
  var vx = (x0 + x1) / 2 - (box.width / 2) / sx;                     /* left and right pads match */
  var vy = (y0 + y1) / 2 - ((padT + box.height - padB) / 2) / sy;
  /* prefer a window that stays on the map rather than one hanging over empty background — but never
     at the cost of pushing a club out of frame */
  var cx = VW <= m.w ? Math.max(0, Math.min(m.w - VW, vx)) : (m.w - VW) / 2;
  var cy = VH <= m.h ? Math.max(0, Math.min(m.h - VH, vy)) : (m.h - VH) / 2;
  if (x0 >= cx && x1 <= cx + VW) vx = cx;
  if (y0 >= cy && y1 <= cy + VH) vy = cy;
  return { x:vx, y:vy, w:VW, h:VH, sx:sx, sy:sy };
};

/* Lay the map out: window first, then separate the pins that still collide. Toronto and Pittsburgh
   are 47 map-units apart while the crests are 40px wide, so the Great Lakes clubs land on each
   other at any sane zoom — nudge them apart afterwards, capped so a pin never wanders off the city
   it marks. */
CG.naMapLayout = function(){
  var wrap = document.querySelector(".na-pins");
  if (!wrap) return;
  var pins = [].slice.call(wrap.querySelectorAll(".na-pin"));
  if (!pins.length) return;
  var box = wrap.getBoundingClientRect();
  if (!box.width || !box.height) return;          /* hero not laid out yet */

  var m = CG.NA_MAP, plot = wrap.parentNode;
  var svg = plot.querySelector(".na-svg");
  var card = plot.parentNode;
  var cap = card && card.querySelector(".na-cap");
  /* the caption only competes for space where it overlays the plot — below the map (as on a phone)
     its rect never meets a pin and this settles on the first pass */
  var v, padB = 58;
  var place = function(){
    v = CG.naMapView(box, padB);
    pins.forEach(function(el){
      var mx = parseFloat(el.getAttribute("data-mx")) / 100 * m.w;
      var my = parseFloat(el.getAttribute("data-my")) / 100 * m.h;
      el.style.left = ((mx - v.x) * v.sx).toFixed(1) + "px";
      el.style.top  = ((my - v.y) * v.sy).toFixed(1) + "px";
    });
  };
  for (var pass = 0; pass < 4; pass++){
    place();
    if (!cap) break;
    var cr = cap.getBoundingClientRect(), worst = 0;
    pins.forEach(function(el){
      var r = el.getBoundingClientRect();
      if (r.right > cr.left && r.left < cr.right) worst = Math.max(worst, r.bottom - cr.top);
    });
    if (worst <= 0) break;
    var next = padB + worst + 4;
    /* clearing the caption is worth some zoom, but not a map squeezed into half its own box */
    if (next > box.height * 0.45) break;
    padB = next;
  }
  if (svg) svg.setAttribute("viewBox", v.x.toFixed(1) + " " + v.y.toFixed(1) + " " + v.w.toFixed(1) + " " + v.h.toFixed(1));
  if (pins.length < 2) return;
  var p = pins.map(function(el){
    var r = el.getBoundingClientRect();
    var cx = r.left - box.left + r.width / 2, cy = r.top - box.top + r.height / 2;
    return { el:el, x:cx, y:cy, ox:cx, oy:cy, w:r.width, h:r.height,
             bx:parseFloat(el.style.left), by:parseFloat(el.style.top) };
  });
  var CAP = 26;                                   /* px — beyond this the pin would lie about where the club is */
  for (var it = 0; it < 60; it++){
    var moved = false;
    for (var i = 0; i < p.length; i++){
      for (var j = i + 1; j < p.length; j++){
        var a = p[i], b = p[j];
        var dx = b.x - a.x, dy = b.y - a.y;
        var needX = (a.w + b.w) / 2 * 0.86, needY = (a.h + b.h) / 2 * 0.72;
        if (Math.abs(dx) >= needX || Math.abs(dy) >= needY) continue;
        var d = Math.sqrt(dx * dx + dy * dy) || 0.01;
        var push = (needY - Math.abs(dy)) / 2 + 0.6;
        var ux = dx / d, uy = dy / d;
        a.x -= ux * push; a.y -= uy * push;
        b.x += ux * push; b.y += uy * push;
        moved = true;
      }
    }
    if (!moved) break;
  }
  p.forEach(function(q){
    var dx = Math.max(-CAP, Math.min(CAP, q.x - q.ox));
    var dy = Math.max(-CAP, Math.min(CAP, q.y - q.oy));
    q.el.style.left = (q.bx + dx).toFixed(1) + "px";
    q.el.style.top  = (q.by + dy).toFixed(1) + "px";
  });
};
CG.naMap = function(){
  var m = CG.NA_MAP, n = (CG.TEAMS || []).filter(function(t){ return m.at[t.code]; }).length;
  return '<div class="na-wrap">' +
    '<div class="na-plot">' +
      /* viewBox is replaced by CG.naMapLayout once the plot has a measured size; this one is the
         whole continent, so the map is never wrong even in the frame before that runs. */
      '<svg class="na-svg" viewBox="0 0 ' + m.w + ' ' + m.h + '" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">' +
        /* painted in this order on purpose: state lines belong on the land, and the water goes
           over them, so no border is left stranded across the middle of a lake */
        '<path class="na-land" d="' + m.d + '"/>' +
        '<path class="na-bord" d="' + m.b + '"/>' +
        '<path class="na-lake" d="' + m.k + '"/>' +
      '</svg>' +
      '<div class="na-pins">' + CG.naMapPins() + '</div>' +
    '</div>' +
    '<div class="na-cap">' +
      '<b class="na-cap-h">' + n + ' club' + (n === 1 ? "" : "s") + ' across North America</b>' +
      '<span class="na-cap-s">Select a club to view its roster and staff.</span>' +
    '</div>' +
  '</div>';
};

/* ================================================================
   THE FIRST-VISIT NUMBERS

   What someone who has never heard of this league needs in order to decide
   whether it is worth joining: how many people are already here, how many are
   in for this season, how many clubs, and how long until it starts.

   Every figure is a real count read out of the live data, and a figure whose
   source is missing is DROPPED rather than shown as a zero — an empty league
   reads worse than a shorter row, and a fabricated one reads worst of all.
   The number is printed in the markup; the count-up only animates toward it.
   ================================================================ */
CG.homeFigures = function(){
  var lg = CG.lg || {}, s = lg.season || {};
  var figs = [];
  var fig = function(n, label, sub, meter, go){
    figs.push('<div class="fig"' + (go ? ' style="cursor:pointer" data-go="' + go + '"' : "") + '>' +
      '<b><span data-to="' + n + '">' + n.toLocaleString() + '</span></b>' +
      '<span class="fig-l">' + label + '</span>' +
      (meter != null ? '<div class="rv-meter" style="--v:' + meter.toFixed(3) + '"><i></i></div>' : "") +
      (sub ? '<span class="fig-s">' + sub + '</span>' : "") + '</div>');
  };

  var members = (lg._profilesRaw || []).length;
  if (members) fig(members, "Accounts", "People registered on the site", null, "#/players");

  var signed = lg.registrationsCount || (lg._registrationsRaw || []).length || 0;
  var clubs  = (CG.TEAMS || []).length;
  var spots  = clubs * (s.roster_max || 15);
  if (signed) fig(signed, "Signed up for Season " + (s.number || 1),
    spots ? signed.toLocaleString() + " of " + spots.toLocaleString() + " roster spots claimed" : "",
    spots ? Math.max(0, Math.min(1, signed / spots)) : null, "#/register");

  if (clubs) fig(clubs, "Clubs", "Each with an owner, GM and assistant GM", null, "#/teams");

  var days = CG.daysToStart(), start = CG.seasonStartMs();
  if (days != null && days >= 0) fig(days, "Day" + (days === 1 ? "" : "s") + " to puck drop",
    start ? "First game " + CG.fmtDay(start) : "", null, "#/schedule");

  if (figs.length < 2) return "";                 /* not enough real numbers to be worth a band */
  return '<section class="sec-tight"><div class="shell">' +
    '<div class="sec-head" data-rv="mask"><div class="lead"><span class="eyebrow chr">League</span>' +
    '<h2 class="h-sec">Season 1 at a glance</h2></div>' +
    '<a class="sec-link" href="#/register">Sign up to play</a></div>' +
    '<div class="figs" data-rv="up">' + figs.join("") + '</div></div></section>';
};

/* Split a line into per-letter spans, each inside a per-word mask, so the wordmark can rise
   letter by letter out of its own baseline. Kept to whole words as the mask unit: masking each
   letter separately clips the overhangs on a display face this tight. */
CG.splitChars = function(text){
  var i = 0;
  return String(text).split(/(\s+)/).map(function(tok){
    if (!tok) return "";
    if (/^\s+$/.test(tok)) return " ";
    return '<span class="rv-word">' + tok.split("").map(function(ch){
      return '<i style="--w-i:' + (i++) + '">' + esc(ch) + '</i>';
    }).join("") + '</span>';
  }).join("");
};

/* The road to puck drop — was the hero's right rail, now a module of its own so the hero can be
   nothing but the map. In season it carries tonight's slate instead. */
CG.roadModule = function(pre){
  var lg = CG.lg;
  var games = pre ? lg.schedule.filter(function(g){ return g.at > CG.now(); })
                      .sort(function(a,b){ return a.at-b.at; }).slice(0,4)
                  : (lg.tonight || []);
  var stageWk = function(g){ return (g.stage==="preseason"?"Pre-season week ":g.stage==="playoff"?"Playoff week ":"Week ")+g.week; };
  var head = pre ? (games.length ? "Next up · "+stageWk(games[0]) : "Key dates")
                 : "Tonight"+(games.length ? " · "+stageWk(games[0]) : "");
  var rows;
  if (games.length){
    rows = games.map(function(g, i){
      var streamers = CG.liveStreamers(g);
      return '<a class="railgame mag" data-rv="slide" style="--rv-i:'+i+'" href="#/matchup/'+g.id+'">'+
        '<span class="rg-line">'+CG.crest(g.away,22)+esc(CG.TEAM[g.away].code)+' @ '+CG.crest(g.home,22)+esc(CG.TEAM[g.home].code)+
          (streamers.length?' <span class="chip chip-live" style="font-size:9px;padding:1px 8px;margin-left:auto"><span class="live-dot"></span>LIVE</span>':"")+'</span>'+
        '<span class="rg-t">'+(pre?CG.fmtDay(g.at):CG.fmtTime(g.at))+'</span>'+
        '<span class="rg-meta">'+esc(CG.TEAM[g.away].name)+' at '+esc(CG.TEAM[g.home].name)+
          (g.feature?' · <b style="color:var(--viz-accent)">MARQUEE</b>':"")+
          (streamers.length?' · streaming: '+streamers.map(function(p){ return esc(p.tag); }).join(", "):"")+'</span></a>';
    }).join("");
  } else {
    /* Pre-season, no slate yet — the real dates, so the module carries its weight instead of
       apologising for an empty schedule. */
    var sD = CG.SEASON || {}, nowMs = CG.now();
    rows = [
      ["Sign-up deadline", sD.registration_deadline, "draft-eligibility cutoff", "#/register"],
      ["Pre-season", sD.preseason_starts_at, "two weeks, own standings", "#/schedule"],
      ["Draft night", sD.draft_at, "ten rounds, live on the site", "#/schedule"],
      ["Puck drop", sD.starts_at, "the regular season begins", "#/schedule"]
    ].filter(function(x){ return x[1]; }).map(function(st, i){
      var past = Date.parse(st[1]) < nowMs;
      return '<a class="railgame mag" data-rv="slide" style="--rv-i:'+i+';opacity:'+(past?".55":"1")+'" href="'+st[3]+'">'+
        '<span class="rg-line"><span style="width:9px;height:9px;border-radius:50%;flex:none;background:'+
          (past?"var(--steel)":"var(--viz-accent)")+';display:inline-block"></span>'+esc(st[0])+'</span>'+
        '<span class="rg-t">'+CG.fmtDate(st[1])+'</span>'+
        '<span class="rg-meta">'+esc(st[2])+'</span></a>';
    }).join("");
  }
  return '<section class="sec"><div class="shell">'+
    '<div class="sec-head" data-rv="mask"><div class="lead"><span class="eyebrow chr">'+esc(head)+'</span>'+
    '<h2 class="h-sec">'+(pre?"Before the season starts":"Tonight\u2019s games")+'</h2></div>'+
    '<a class="sec-link" href="#/schedule">Full schedule</a></div>'+
    '<div class="roadgrid">'+rows+'</div></div></section>';
};

/* The newsroom, lifted out of the hero into its own module. */
CG.newsModule = function(){
  /* kept on a constant-dark band: the slides are a broadcast surface whose white headline and
     dim deck are correct against it in BOTH themes, rather than fixed-light text stranded on a
     page that turns pale */
  return '<section class="sec sec-dark"><div class="shell">'+
    '<div class="sec-head" data-rv="mask"><div class="lead"><span class="eyebrow chr">News</span>'+
    '<h2 class="h-sec" style="color:var(--on-ink)">Latest news</h2></div>'+
    '<a class="sec-link" style="color:var(--on-ink)" href="#/news">All stories</a></div>'+
    '<div data-rv="up"><div class="caro caro-band" id="heroCaro" aria-label="Featured stories"></div></div>'+
  '</div></section>';
};

/* What this actually is, for someone who arrived from a link and has no idea. Three sentences,
   each rising on its own beat, and the two things they might want to do next. Every claim here is
   one the rest of the site can back up — the cap figure comes from the season row, not prose. */
CG.leagueIntro = function(){
  var s = (CG.lg && CG.lg.season) || {};
  var cap = s.salary_cap ? "$" + Math.round(s.salary_cap / 1e6) + "M" : null;
  var lines = [
    "Six-on-six EA NHL. Fixed schedule, fixed rosters, published rulebook" +
      (cap ? ", " + cap + " salary cap." : "."),
    "Each club is run by an owner, a general manager and an assistant GM, who draft, trade and set lines.",
    "Register, enter the draft, get picked up by a club. Games and lineups are managed here; day-to-day runs in Discord."
  ];
  return '<section class="sec sec-dark"><div class="shell">' +
    '<div class="sec-head" data-rv="mask"><div class="lead"><span class="eyebrow chr">Format</span>' +
    '<h2 class="h-sec">How the league works</h2></div></div>' +
    '<div style="max-width:62ch;display:flex;flex-direction:column;gap:13px">' +
      lines.map(function(l, i){
        return '<p data-rv="mask" style="--rv-i:' + (i + 1) + ';font-size:16.5px;line-height:1.6;color:var(--on-ink-dim);margin:0">' + l + '</p>';
      }).join("") +
      '<div data-rv="up" style="--rv-i:4;display:flex;gap:11px;flex-wrap:wrap;margin-top:9px">' +
        '<a class="btn btn-chrome" href="#/register">Sign up to play</a>' +
        '<a class="btn btn-ghost" href="#/rulebook">Read the rulebook</a>' +
      '</div>' +
    '</div></div></section>';
};

/* ================================================================
   THE LADDER — standings as lanes on a sheet of ice, not a table.

   Each club gets a lane: crest at the rail, a track that fills, and the cutline drawn across all
   of them like a blue line. Lanes sweep in from the boards one after another and the tracks fill
   behind them, so the order arrives as a sequence rather than a grid appearing at once.

   What the track measures depends on what is true. Once games are played it is points, against
   the leader. Before that there is nothing to rank, so it measures roster build — contracts
   signed against the roster limit — which is a real number, and the lane carries the seeding
   position as a rank rather than implying a record nobody has yet.
   ================================================================ */
CG.standingsLadder = function(dv, pre){
  var lg = CG.lg;
  var rows = (CG.TEAMS || []).filter(function(t){ return !dv || t.div === dv; });
  if (!rows.length) return "";
  var max = (CG.SEASON && CG.SEASON.roster_max) || 15;

  var scored = rows.map(function(t){
    var rec = (lg.teams && lg.teams[t.code]) || {};
    var pts = pre ? null : ((rec.w || 0) * 2 + (rec.otl || 0));
    var filled = ((lg.byTeam && lg.byTeam[t.code]) || []).length;
    return { t:t, pts:pts, rec:rec, filled:filled,
             val: pre ? filled / max : pts,
             label: pre ? filled + "/" + max : pts + " pts",
             sub:  pre ? "roster" : (rec.w||0) + "-" + (rec.l||0) + "-" + (rec.otl||0) };
  });
  var peak = scored.reduce(function(m, r){ return Math.max(m, r.val || 0); }, 0) || 1;
  if (!pre) scored.sort(function(a,b){ return (b.pts||0) - (a.pts||0); });

  /* three qualify per division — the cutline sits under the third lane */
  var CUT = 3;
  return '<div class="ladder" data-rv="up">' + scored.map(function(r, i){
    var pct = Math.max(4, Math.round(100 * (r.val || 0) / peak));
    return '<a class="lane' + (i < CUT ? " in" : "") + '" href="#/team/' + esc(r.t.code) + '"' +
      ' style="--lane-i:' + i + (r.t.color ? ';--team:' + esc(r.t.color) : "") + '">' +
      '<span class="lane-rk">' + (i + 1) + '</span>' +
      '<span class="lane-crest">' + CG.crest(r.t.code, 30) + '</span>' +
      '<span class="lane-name">' + esc(r.t.name) + '<small>' + esc(r.sub) + '</small></span>' +
      '<span class="lane-track"><i style="width:' + pct + '%"></i></span>' +
      '<span class="lane-val">' + esc(r.label) + '</span>' +
      (i === CUT - 1 ? '<span class="lane-cut" aria-hidden="true"></span>' : "") +
    '</a>';
  }).join("") +
  '<p class="caption lane-note">' + (pre
      ? "No games played. Track shows roster spots filled; number is the pre-season seed."
      : "Top three per division qualify. The line marks the cutoff.") + '</p></div>';
};

/* ================================================================
   THE PULSE — charts, from counts already loaded on this page.

   Two of them, and both are here because they answer something a prospective player actually
   asks. The curve answers "is anyone joining this": it is the real cumulative sign-up count by
   day, spike and all. The position bars answer "will I get picked": they show what the draft
   pool is short of, which today is defence. That is a recruiting tool, not decoration — and it
   is why these are the charts and not a generic three-number row.

   Anything without data behind it is omitted rather than drawn empty.
   ================================================================ */
CG.pulseModule = function(){
  var lg = CG.lg || {}, V = CG.viz, s = lg.season || {};
  var regs  = (lg._registrationsRaw || []).filter(function(r){ return r && r.created_at; });
  var profs = (lg._profilesRaw || []).filter(function(p){ return p && p.created_at; });
  var teams = CG.TEAMS || [];
  var cards = [];

  /* ---- registrations over time ---- */
  var cum = function(rows){
    var m = {};
    rows.forEach(function(r){ var d = String(r.created_at).slice(0,10); m[d] = (m[d]||0) + 1; });
    var days = Object.keys(m).sort(), run = 0;
    return days.map(function(d){ run += m[d]; return { d:d, n:m[d], v:run }; });
  };
  var reg = cum(regs), mem = cum(profs);
  var series = reg.length >= 4 ? reg : (mem.length >= 4 ? mem : null);
  if (series){
    var isReg = series === reg, last = series[series.length-1];
    var busiest = series.reduce(function(b,p){ return p.n > b.n ? p : b; }, series[0]);
    cards.push(V.card({
      title: isReg ? "Registrations" : "Accounts",
      sub: "Cumulative, by day",
      value: last.v, count: true, rv: "draw", wide: true,
      body: V.area(series, { from: CG.fmtDate(series[0].d), to: CG.fmtDate(last.d) }) +
            '<p class="vz-note">Busiest day: ' + busiest.n + ' on ' + esc(CG.fmtDate(busiest.d)) + '.</p>'
    }));
  }

  /* ---- registrations by position ---- */
  var POS = [["C","C"],["LW","LW"],["RW","RW"],["LD","LD"],["RD","RD"],["G","G"]];
  var byPos = {};
  regs.forEach(function(r){ if (r.position) byPos[r.position] = (byPos[r.position]||0) + 1; });
  /* second series: of the players registered at each position, how many already hold a contract.
     Derived from the two sets we already have — no new query, no estimate. */
  var signedIds = {};
  (lg._contractsRaw || []).forEach(function(c){ if (c && c.profile_id) signedIds[c.profile_id] = 1; });
  var byPosSigned = {};
  regs.forEach(function(r){
    if (r.position && r.profile_id && signedIds[r.profile_id])
      byPosSigned[r.position] = (byPosSigned[r.position]||0) + 1;
  });
  var posRows = POS.filter(function(p){ return byPos[p[0]]; })
                   .map(function(p){ return { k:p[1], v:byPos[p[0]], s:byPosSigned[p[0]]||0 }; });
  if (posRows.length >= 3){
    var fewest = posRows.reduce(function(b,r){ return r.v < b.v ? r : b; }, posRows[0]);
    var openAt = posRows.reduce(function(a,r){ return a + (r.v - r.s); }, 0);
    cards.push(V.card({
      title: "Registrations by position",
      sub: "Fewest: " + fewest.k,
      value: posRows.reduce(function(a,r){ return a + r.v; }, 0), count: true,
      body: V.bars2(posRows, { markMin:true,
        legend: [{ k:"Registered", c:"" }, { k:"Already on a club", c:"b" }],
        note: fewest.k + " has the fewest registrations. " + openAt + " registered players are still unsigned." })
    }));
  }

  /* sign-ups per day, as a grid — one cell per day since the first registration */
  if (regs.length >= 10){
    var perDay = {};
    regs.forEach(function(r){ var d = String(r.created_at).slice(0,10); perDay[d] = (perDay[d]||0) + 1; });
    var days = Object.keys(perDay).sort();
    var d0 = new Date(days[0] + "T00:00:00Z"), d1 = new Date(days[days.length-1] + "T00:00:00Z");
    var cells = [], cur = new Date(d0);
    while (cur <= d1 && cells.length < 120){
      var key = cur.toISOString().slice(0,10);
      cells.push({ k: key, v: perDay[key] || 0 });
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    if (cells.length >= 7){
      var busiest = cells.reduce(function(b,c){ return c.v > b.v ? c : b; }, cells[0]);
      cards.push(V.card({
        title: "Sign-ups per day",
        sub: cells.length + " days of registration",
        value: busiest.v, 
        body: V.heat(cells, { cols: 7,
          legend: [{ k:"None", c:"t" }, { k:"Busiest: " + busiest.v, c:"b" }],
          note: "One cell per day, first registration to today. Darkest is the busiest day." })
      }));
    }
  }

  /* ---- roster spots filled, league-wide ---- */
  var max = (s.roster_max || 15), spots = teams.length * max;
  var filled = teams.reduce(function(a,t){ return a + (((lg.byTeam||{})[t.code]||[]).length); }, 0);
  if (spots && filled >= 0){
    cards.push(V.card({
      title: "Roster spots filled",
      sub: filled + " of " + spots,
      body: V.donut(filled, spots, { label: "of " + spots + " spots",
        note: max + " players per club across " + teams.length + " clubs. The rest are filled at the draft." })
    }));
  }

  /* ---- signed players per club ---- */
  /* deliberately NOT tinted per club: the code is already inside the bar, so colour would be
     carrying nothing, and ten brand colours in one chart pulls it off the league palette */
  var clubRows = teams.map(function(t){
    return { k:t.code, v:((lg.byTeam||{})[t.code]||[]).length };
  }).filter(function(r){ return r.v > 0; });
  if (clubRows.length >= 3){
    cards.push(V.card({
      title: "Players signed, by club",
      sub: "Management and returning players",
      value: clubRows.reduce(function(a,r){ return a + r.v; }, 0), count: true,
      body: V.hbars(clubRows, { fmt: function(v){ return v + "/" + max; } })
    }));
  }

  if (!cards.length) return "";
  return '<section class="sec"><div class="shell">' +
    '<div class="sec-head" data-rv="mask"><div class="lead"><span class="eyebrow chr">Registration</span>' +
    '<h2 class="h-sec">Season ' + ((s.number)||1) + ' sign-ups</h2></div>' +
    '<a class="sec-link" href="#/register">Register</a></div>' +
    '<div class="vzgrid">' + cards.join("") + '</div></div></section>';
};

/* The clubs, as a ticker of crests and nothing else — no card, no border, no name plate. The
   track is the club list twice over so the -50% loop is seamless; hover pauses it, and reduced
   motion drops it to a plain wrapped row. */
CG.clubTicker = function(){
  var ts = (CG.TEAMS || []).slice();
  if (!ts.length) return "";
  var one = function(t, dup){
    return '<a class="ticklink" href="#/team/' + esc(t.code) + '"' +
      (dup ? ' aria-hidden="true" tabindex="-1"' : ' aria-label="' + esc((t.city ? t.city + " " : "") + t.name) + '"') +
      '>' + CG.crest(t.code, 78) + '</a>';
  };
  var run = ts.map(function(t){ return one(t, false); }).join("") +
            ts.map(function(t){ return one(t, true); }).join("");
  return '<section class="sec"><div class="shell">' +
    '<div class="sec-head" data-rv="mask"><div class="lead"><span class="eyebrow chr">Clubs</span>' +
    '<h2 class="h-sec">' + ts.length + ' club' + (ts.length === 1 ? "" : "s") + '</h2></div>' +
    '<a class="sec-link" href="#/teams">All clubs</a></div></div>' +
    '<div class="tickwrap" data-rv="up" style="--tick-dur:' + Math.max(26, ts.length * 4.4).toFixed(0) + 's">' +
      '<div class="tickrow">' + run + '</div>' +
    '</div></section>';
};

CG.ROUTES.home = function(){
  var lg = CG.lg, C = CG.CONTENT;
  var pre = CG.isPreseason();
  /* the front page's own heading — the hero headline lives inside a rotating carousel, so it
     can't be the document h1. Visually hidden, but it makes the page start at level 1. */
  var html = '<h1 class="sr-only">'+esc(CG.seasonTag())+' — Chel Gaming Hockey League</h1>';
  /* sign-ups run right up to puck drop; registration_deadline is only the draft-eligibility
     cutoff. Both strips below key off registration_open and stop once the season is live. */
  var regOpen = !!(CG.SEASON && CG.SEASON.registration_open && CG.SEASON.status !== "active");
  /* free-agency countdown — pinned to the top of the front page while the window is open */
  var faO = CG.SEASON && CG.SEASON.free_agency_opens_at ? Date.parse(CG.SEASON.free_agency_opens_at) : null;
  var faC = CG.SEASON && CG.SEASON.free_agency_closes_at ? Date.parse(CG.SEASON.free_agency_closes_at) : null;
  var faLive = !!(faO && faC && Date.now() >= faO && Date.now() < faC);
  if (faLive){
    html += '<section style="background:var(--bc);border-bottom:2px solid var(--chrome)"><div class="shell" style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:13px 0">'+
      '<span class="chip chip-live"><span class="live-dot"></span>Free agency is open</span>'+
      '<span style="color:var(--on-ink-dim);font-size:13px">Clubs can sign free agents until '+CG.fmtFull(faC)+
        (regOpen?' — register now and you’re in the pool they’re signing from':"")+'</span>'+
      '<span style="margin-left:auto;display:inline-flex;align-items:center;gap:12px;flex-wrap:wrap"><span style="display:inline-flex;align-items:baseline;gap:9px"><span class="eyebrow" style="color:var(--on-ink-dim)">Closes in</span>'+
      '<b id="faCountdown" class="num" data-close="'+faC+'" style="font-family:var(--f-disp);font-size:24px;line-height:1;color:#fff;font-variant-numeric:tabular-nums">—</b></span>'+
      (regOpen?'<a class="btn btn-chrome btn-sm" href="#/register">Register to play</a>':"")+'</span>'+
    '</div></section>';
  }
  /* registration strip — stays up for the whole sign-up window, not just the eligibility run-up */
  var regDl = CG.SEASON && CG.SEASON.registration_deadline ? Date.parse(CG.SEASON.registration_deadline) : null;
  if (regOpen && !faLive){
    var draftEligible = !!(regDl && Date.now() < regDl);
    html += '<section style="background:var(--bc);border-bottom:2px solid var(--chrome)"><div class="shell" style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:13px 0">'+
      '<span class="chip chip-chrome">'+esc(CG.seasonTag())+' registration is open</span>'+
      '<span style="color:var(--on-ink-dim);font-size:13px">'+(draftEligible
        ? 'Register by '+CG.fmtFull(regDl)+' to be draft-eligible'
        : 'The draft-eligibility deadline has passed — sign up now and you’re placed on a club automatically after the draft')+'</span>'+
      '<span style="margin-left:auto;display:inline-flex;align-items:center;gap:12px;flex-wrap:wrap">'+
      (draftEligible?'<span style="display:inline-flex;align-items:baseline;gap:9px"><span class="eyebrow" style="color:var(--on-ink-dim)">Deadline in</span>'+
        '<b id="regCountdown" class="num" data-close="'+regDl+'" style="font-family:var(--f-disp);font-size:24px;line-height:1;color:#fff;font-variant-numeric:tabular-nums">—</b></span>':"")+
      '<a class="btn btn-chrome btn-sm" href="#/register">Register to play</a></span>'+
    '</div></section>';
  }
  /* HERO — the wordmark, then the continent resolving underneath it. Nothing else lives here:
     the schedule rail and the newsroom carousel are their own modules further down the scroll,
     so the first thing anyone sees is the league's name and where it plays. */
  var seasonLine = (CG.SEASON && CG.SEASON.name ? CG.SEASON.name : "Season 1") + " · Hockey League";
  html += '<section id="hero">'+
    '<div class="hero-name">'+
      '<h1 data-rv="words">'+CG.splitChars("Chel Gaming")+'</h1>'+
      '<span class="hn-sub" data-rv="up" style="--rv-i:4">'+esc(seasonLine)+'</span>'+
    '</div>'+
    CG.naMap()+
  '</section>';

  /* quick fact strip. In the pre-season the figures band says all of this and more, with real
     counts of members and sign-ups, so the thin strip would only repeat it. */
  var figures = pre ? CG.homeFigures() : "";
  if (pre && figures){
    html += figures;
  } else if (pre){
    var days = CG.daysToStart(), start = CG.seasonStartMs();
    /* The signed-player count only means something once it's league-sized. Published at 2 next to
       "8 clubs" it reads as a fabricated stat, so below a full 6v6 night's worth of players the
       slot carries the sign-up state instead. */
    var signed = lg.players.length, signedFloor = CG.TEAMS.length * 6;
    html += '<section class="sec-tight"><div class="shell"><div class="statline">'+
      '<div><b class="num">'+esc((CG.SEASON&&CG.SEASON.name)||"Off-season")+'</b><span>inaugural season</span></div>'+
      '<div style="cursor:pointer" data-go="#/schedule"><b class="num">'+(days!=null?days:"—")+'</b><span>day'+(days===1?"":"s")+' to puck drop'+(start?" · "+CG.fmtDay(start):"")+'</span></div>'+
      '<div style="cursor:pointer" data-go="#/teams"><b class="num">'+CG.TEAMS.length+'</b><span>clubs</span></div>'+
      (signed >= signedFloor
        ? '<div style="cursor:pointer" data-go="#/players"><b class="num">'+signed+'</b><span>players signed</span></div>'
        : regOpen
          ? '<div style="cursor:pointer" data-go="#/register"><b>Open</b><span>sign-ups · anyone can join</span></div>'
          : '<div style="cursor:pointer" data-go="#/rulebook"><b>6v6</b><span>EA NHL · published rulebook</span></div>')+
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
  /* The scroll, in the order a first-time visitor asks the questions:
     what is it -> who is turning up -> when does it start -> who is in it -> what is happening. */
  html += CG.leagueIntro();
  html += CG.pulseModule();
  html += CG.seasonTimeline();
  html += CG.roadModule(pre);
  html += CG.clubTicker();
  html += CG.newsModule();
  /* TONIGHT dark band */
  if (CG.modOn("tonight") && !pre){
    html += '<section class="sec sec-dark"><div class="shell">'+
      '<div class="sec-head" data-rv="mask"><div class="lead"><span class="eyebrow chr">Game night</span><h2 class="h-sec">Tonight’s matchups</h2></div>'+
      '<a class="sec-link" style="color:#fff" href="#/schedule">'+(lg.tonight[0]?"Week "+(lg.tonight[0].week||1)+" slate":"Full schedule")+'</a></div>'+
      '<div class="grid g2" data-rv="up">'+lg.tonight.map(function(g){
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
      '<div class="sec-head" data-rv="mask"><div class="lead"><span class="eyebrow chr">Standings</span><h2 class="h-sec">'+
        (pre?'Divisions':'Standings')+'</h2></div>'+
        '<a class="sec-link" href="#/standings">Full standings</a></div>'+
      '<div class="grid g2">'+
        (CG.DIVISIONS||["East","West"]).map(function(dv){
          return '<div class="ladderwrap"><div class="ladder-h" data-rv="slide"><h3>'+esc(dv)+' Division</h3>'+
            '<span class="chip">Top 3 qualify</span></div>'+CG.standingsLadder(dv, pre)+'</div>';
        }).join("")+
      '</div>'+
      '<div class="grid g2" style="margin-top:18px;align-items:start">'+
        /* Pre-season this list is a seeding order, not a results ranking — say so, or it reads as a
           contradiction of the "nothing to rank yet" note in the cards above. Don't name the basis
           more precisely than that: the order is the engine's roster-strength seed UNLESS the league
           office has set a manual override, and neither is the same figure as teamRatings.ovr, which
           is derived from played results. Asserting a number alongside it would be a claim we can't
           keep, so pre-season the value column stays empty. */
        '<div class="card"><div class="card-h"><h3>Power Rankings</h3><a class="sec-link" href="#/rankings">Full list</a></div>'+
          (pre?'<div class="card-b" style="border-bottom:1px solid var(--line)"><span class="caption">'+
            (lg.prManual ? 'Pre-season seeding, set by the league office.' : 'No results to rank yet — this is the pre-season seeding order.')+
            ' It becomes a results ranking after the first game night.</span></div>':"")+
          lg.powerRankings.map(function(pr){
            var t = CG.TEAM[pr.team];
            return '<div class="leaderrow'+(pr.rank===1?" top":"")+'" data-go="#/team/'+pr.team+'"><span class="rk num">'+pr.rank+'</span>'+
              CG.crest(pr.team,30)+'<span style="min-width:0"><b style="font-family:var(--f-disp);font-size:14px">'+esc(t.name)+'</b>'+
              '<small style="display:block" class="caption">'+(pre?"":lg.teams[pr.team].w+"-"+lg.teams[pr.team].l+"-"+lg.teams[pr.team].otl+' · ')+esc(t.div)+' Division</small></span>'+
              '<span class="val">'+(pre?"":CG.moveArrow(pr.move))+'</span></div>';
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
      '<div class="sec-head" data-rv="mask"><div class="lead"><span class="eyebrow chr">Stat central</span><h2 class="h-sec">Who’s lighting the lamp</h2></div>'+
      '<a class="sec-link" href="#/stats">Stat central</a></div>'+
      '<div class="grid g3" data-rv="up">'+
        leadCard("Points", pts, function(p){ var s=lg.pstats[p.id]; return [s.p, s.g+"G · "+s.a+"A"]; })+
        leadCard("Goals", gls, function(p){ var s=lg.pstats[p.id]; return [s.g, s.gp+" GP"]; })+
        leadCard("Goaltending", gs, function(p){ var s=lg.pstats[p.id]; return [(s.sv/Math.max(1,s.sa)).toFixed(3).replace(/^0/,""), s.w+"-"+s.l+"-"+s.otl]; })+
      '</div></div></section>';
  }
  /* NEWS */
  if (CG.modOn("news") && !pre){
    var arts = C.articles.slice().sort(function(a,b){ return b.dateIso.localeCompare(a.dateIso); });
    var leadA = arts[0], rest = arts.slice(1,4);
    html += '<section class="sec"><div class="shell">'+
      '<div class="sec-head" data-rv="mask"><div class="lead"><span class="eyebrow chr">Off the wire</span><h2 class="h-sec">Every story, in full</h2></div>'+
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
    html += '<section class="sec sec-dark"><div class="shell"><div class="grid g5x7" data-rv="up">'+
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
      html += '<section class="sec-tight"><div class="shell"><div class="grid g3" data-rv="up">'+
        mile.map(function(m){
          return '<div class="note chr"><b style="font-family:var(--f-disp);display:block;margin-bottom:4px;color:var(--ink)">'+esc(m[1])+'</b>'+esc(m[2])+
            '<span class="caption" style="display:block;margin-top:8px">'+CG.fmtFull(Date.parse(m[0]))+'</span></div>';
        }).join("")+
        /* every signed-in role reaches the availability page — staff and commissioners play too,
           and "availability.submit" excludes them. Guests get the ask that actually applies to them. */
        '<div class="note"><b style="font-family:var(--f-disp);display:block;margin-bottom:4px;color:var(--ink)">Availability window</b>'+
          (CG.WEEK8.open
            ? esc(CG.WEEK8.label)+' submissions close '+CG.fmtFull(CG.WEEK8.deadline)+' (Rule 5.1). '
            : 'Opens with the first game week of the schedule (Rule 5.1). ')+
          (CG.role()!=="guest"
            ? '<a href="#/hub/availability" style="font-weight:700;border-bottom:2px solid var(--chrome)">Submit yours →</a>'
            : regOpen
              ? '<a href="#/register" style="font-weight:700;border-bottom:2px solid var(--chrome)">Register to play →</a>'
              : '<a href="#/signin" style="font-weight:700;border-bottom:2px solid var(--chrome)">Sign in →</a>')+'</div>'+
      '</div></div></section>';
    }
  }
  return html;
};
CG.newsCard = function(a, lead, feature){
  var t0 = a.relatedTeams[0] && CG.TEAMS.find(function(t){ return t.name===a.relatedTeams[0]; });
  var showExcerpt = lead || feature;
  var art = '<svg viewBox="0 0 400 150" preserveAspectRatio="xMidYMid slice" aria-hidden="true">'+
    '<rect width="400" height="150" fill="#101519"/>'+
    '<circle cx="330" cy="20" r="90" fill="'+(t0?t0.color:"#FFE500")+'" opacity=".25"/>'+
    '<circle cx="330" cy="20" r="56" fill="'+(t0?t0.color:"#FFE500")+'" opacity=".35"/>'+
    '<path d="M0 118 L400 92 L400 150 L0 150 Z" fill="'+(t0?t0.color:"#FFE500")+'" opacity=".16"/>'+
    '<text x="22" y="126" font-family="Archivo, sans-serif" font-weight="900" font-size="44" fill="#FFFFFF" opacity=".1">CGHL</text></svg>';
  return '<article class="newscard'+(lead?" lead":"")+(feature?" feature":"")+'" data-go="#/article/'+a.slug+'" role="link" tabindex="0">'+
    '<div class="nc-art">'+art+(feature?'<span class="nc-flag">Latest</span>':"")+'</div><div class="nc-b">'+
    '<span class="eyebrow" style="font-size:10px">'+esc(a.category)+'</span>'+
    '<h3>'+esc(a.title)+'</h3>'+(showExcerpt?'<p>'+esc(a.excerpt)+'</p>':"")+
    '<span class="nc-meta">'+CG.fmtDate(a.dateIso)+' · '+esc(a.author.split("—")[0].trim())+'</span></div></article>';
};
CG.AFTER.home = function(){
  CG.carousel("#heroCaro", CG.slideDefs().map(function(s){ return s.html; }));
  /* the map frames itself from its container, so it has to be laid out once the hero has a real
     size — and again whenever that size changes, which moves both the window and the pixel gap
     between cities. Run it straight off the event rather than deferring into rAF: the whole pass is
     ~20 reads of ten pins, and a deferred one leaves the SVG window and the pins out of step —
     worse, a rAF that never fires (hidden tab, throttled pane) strands the map at its old size. */
  /* The opening: the name is already rising when the continent starts to resolve under it, and
     the crests only land once the map has settled. Driven by classes rather than a timeline so
     that a browser which skips the transitions still ends in the finished state. */
  var wrap = document.querySelector(".na-wrap");
  if (wrap){
    var lit = function(){ wrap.classList.add("map-in"); setTimeout(function(){ wrap.classList.add("pins-in"); }, 620); };
    if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches){
      wrap.classList.add("map-in", "pins-in");
    } else {
      setTimeout(lit, 90);
    }
  }
  /* Click a crest and the map recedes while that club's mark rushes forward, then the route
     changes. Plain left-clicks only — a modified click or a middle click must still open a tab the
     way the browser intends. Navigation is fired by whichever comes first, the transition ending
     or a timeout, so a dropped transitionend can never strand someone on the map. */
  if (!CG._naZoom){
    CG._naZoom = true;
    document.addEventListener("click", function(e){
      var a = e.target && e.target.closest && e.target.closest(".na-pin");
      if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      var wrap = a.closest(".na-wrap"), href = a.getAttribute("href");
      if (!wrap || !href) return;
      e.preventDefault();
      wrap.classList.add("pin-zooming");
      a.classList.add("pin-zoom");
      var fired = false;
      var go = function(){
        if (fired) return;
        fired = true;
        location.hash = href.replace(/^#/, "");
      };
      a.addEventListener("transitionend", go, { once:true });
      setTimeout(go, 700);
    });
  }
  var relayout = function(){ if (document.querySelector(".na-pins")) CG.naMapLayout(); };
  CG.naMapLayout();
  requestAnimationFrame(relayout);                 /* again once the crests have their real size */
  /* and again when the things that change the hero's height land — on a cold load the first
     measurement can happen before the web font does, and the map would keep that frame */
  if (document.readyState !== "complete") window.addEventListener("load", relayout, { once:true });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(relayout);
  if (!CG._naResize){
    CG._naResize = true;
    window.addEventListener("resize", relayout);
  }
  /* the plot can also change size without the window doing so — the fonts landing, a scrollbar
     appearing, the rail growing. Watch the box itself where the browser allows it. */
  if (window.ResizeObserver){
    if (CG._naRO) CG._naRO.disconnect();
    var plotEl = document.querySelector(".na-plot");
    if (plotEl){
      CG._naRO = new ResizeObserver(function(){ CG.naMapLayout(); });
      CG._naRO.observe(plotEl);
    }
  }
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
      /* Weeks come from the actual schedule, not a hardcoded 1–10: the regular season is nine
         game-weeks (Rule 3.1), so "Week 10" could never match, and pre-season/playoff weeks
         belong here too. Distinct, sorted, real. */
      (function(){
        var wks = {}; (CG.lg.schedule||[]).forEach(function(g){ if(g.week) wks[g.week]=1; });
        return Object.keys(wks).map(Number).sort(function(a,b){return a-b;})
          .map(function(w){ return '<option value="'+w+'"'+(fWeek==String(w)?" selected":"")+'>Week '+w+'</option>'; }).join("");
      })()+'</select>'+
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
  }).join("") : (
    /* Two different empty states. Before the draft there is no slate at all, so blaming the
       visitor's filters ("clear a filter or two") reads as a broken page — which is what every
       visitor saw between now and puck drop. Only show the filter copy when games actually
       exist and the current filter set excludes them. */
    (CG.lg.schedule && CG.lg.schedule.length)
      ? '<div class="empty"><div class="e-art">'+CG.ic("cal",22)+'</div><b>No games match those filters</b><p>Clear a filter or two — the full slate lives here.</p></div>'
      : (function(){
          var s = CG.SEASON || {};
          var draftTxt = s.draft_at ? " — "+CG.fmtFull(Date.parse(s.draft_at)) : "";
          var dropTxt  = s.starts_at ? CG.fmtDate(Date.parse(s.starts_at)) : "the season opener";
          return '<div class="empty"><div class="e-art">'+CG.ic("cal",22)+'</div><b>The Season 1 slate posts after the draft</b>'+
            '<p>Clubs are built on draft night'+esc(draftTxt)+', and the schedule goes up once the rosters that will play it exist. Puck drops '+esc(dropTxt)+'.</p>'+
            '<a class="btn btn-chrome" href="#/register" style="margin-top:16px">Register to play</a></div>';
        })()
  );
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
  /* With no results the seed comparator ties on every field, so a "projected bracket" is just
     the club list in alphabetical order — dressed up as six qualifiers. Publish the format and
     the date instead; the bracket returns the moment there are points to seed it with. */
  if (CG.isPreseason()){
    var poAt = CG.SEASON && CG.SEASON.playoffs_start_at ? Date.parse(CG.SEASON.playoffs_start_at) : null;
    return '<div class="card" style="margin-bottom:22px"><div class="card-h"><h3>Playoff format</h3>'+
      '<span class="chip">Seeded once games are played</span></div><div class="card-b">'+
      '<p class="small" style="color:var(--steel);line-height:1.65">Top three in each division qualify — six clubs, three rounds. '+
      'Division winners take seeds 1 and 2 and skip the quarter-finals; the other four seed by points percentage, '+
      'with ties broken by head-to-head, regulation wins, then goal differential (Rule 8.1, Rule 8.2). '+
      'The bracket appears here as soon as there are results to seed it.</p>'+
      '<span class="caption" style="display:block;margin-top:10px">'+
      (poAt ? 'Playoffs begin '+CG.fmtDay(poAt)+'.' : 'Playoff dates are set with the season schedule.')+'</span></div></div>';
  }
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
    "Two points for a win, one for an overtime loss. Top three per division qualify — the dashed line is the cut (Rule 8.1). Ties break by head-to-head record, then regulation wins, then goal differential (Rule 8.2).",
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
  } else if (view==="wildcard" && CG.isPreseason()){
    /* Nobody is in or out at 0-0-0 — "below the cut · 0 pts back of the line" is the comparator
       tie rendered as a verdict. Show the field and the rule that will decide it. */
    body = '<div class="grid g2">'+
      DIVS.map(function(dv){
        return '<div class="card"><div class="card-h"><h3>'+esc(dv)+' Division</h3><span class="chip">Top 3 qualify</span></div>'+
          CG.divisionField(dv)+CG.fieldNote()+'</div>';
      }).join("")+
    '</div><p class="note" style="margin-top:16px">Nobody is in or out yet — every club sits at 0-0-0. '+
    'Three clubs per division qualify; division winners take the top seeds and the rest seed by points (Rule 8.1). '+
    'This page splits into the field and the chasers after the first game night.</p>';
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
  /* "Top of the East" before a puck is dropped is the standings comparator tying and the club
     landing first alphabetically. State what is actually known about the club instead. */
  if (CG.isPreseason()){
    var n = (lg.byTeam[code]||[]).length;
    var start = CG.seasonStartMs();
    return (n ? n+" player"+(n===1?"":"s")+" signed" : "No players signed yet")+
      (start ? ". First puck drop "+CG.fmtDay(start)+"." : ".");
  }
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
      /* the tier's own emblem when a commissioner has set one, the TIER plate otherwise */
      '<div class="tier-mark">'+CG.tierPlate(topL, 20)+'</div>'+
      '<div><div style="font-family:var(--f-disp);font-size:16px;line-height:1.1">'+esc(topL.code)+'</div><div class="caption" style="margin-top:3px">Top tier'+(topL.inspiration?' · modeled on the '+esc(topL.inspiration):'')+'</div></div>'+
    '</div>' : "";
  var head = CG.pageHead("The clubs","One trophy. Every club chasing it.",
    "Every club runs a real room — front office, "+(CG.ROSTER_MAX||15)+"-player roster, and a rivalry waiting to happen.", tierBadge);
  var pr = {}; lg.powerRankings.forEach(function(p){ pr[p.team]=p.rank; });
  var preT = CG.isPreseason();
  var cards = CG.TEAMS.map(function(t){
    var s = lg.teams[t.code];
    var note = CG.teamLine(t.code);
    return '<div class="card raise" data-go="#/team/'+t.code+'" role="link" tabindex="0" style="--tc:'+t.color+'">'+
      '<div class="card-b" style="display:flex;flex-direction:column;gap:12px">'+
        '<div style="display:flex;align-items:center;gap:13px">'+CG.crest(t.code,46)+
          '<div style="min-width:0"><b style="font-family:var(--f-disp);font-weight:800;font-size:17px;display:block">'+esc(t.name)+'</b>'+
          '<span class="caption">'+esc(t.city)+' · '+esc(t.arena)+'</span></div>'+
          '<span class="ovrbox '+CG.ovrClass(lg.teamRatings[t.code].ovr)+'" style="margin-left:auto" title="Team overall">'+lg.teamRatings[t.code].ovr+'</span></div>'+
        /* Reserve two lines for the note so a 1-line club ("3 players signed…") and a 2-line one
           ("No players signed yet…") keep their record/seed rows on the same baseline across a row. */
        '<p class="small" style="color:var(--steel);min-height:2.8em;margin:0">'+esc(note)+'</p>'+
        '<div style="display:flex;gap:16px;align-items:center;font-family:var(--f-mono);font-size:12px;flex-wrap:wrap">'+
          '<span><b class="num">'+s.w+"-"+s.l+"-"+s.otl+'</b> record</span>'+
          '<span><b class="num">'+s.pts+'</b> pts</span>'+
          '<span>#'+pr[t.code]+(preT?' pre-season seed':' power ranking')+'</span>'+CG.form5(s.last5)+'</div>'+
        /* nobody leads a division at 0-0-0 — the badge would land on whichever club sorts first */
        /* margin-top:auto pins the division footer to the card bottom so every card's footer aligns */
        '<div style="display:flex;gap:8px;margin-top:auto"><span class="chip">'+t.div+' Division</span>'+
          (!preT && CG.standings(lg,t.div)[0].code===t.code?'<span class="chip chip-chrome">Division lead</span>':"")+'</div>'+
      '</div></div>';
  }).join("");
  return head + '<div class="shell" style="padding-bottom:40px"><div class="grid g4" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr))">'+cards+'</div></div>';
};

/* ---------- TEAM PAGE ---------- */
CG.ROUTES.team = function(code, qs){
  /* Accept the legacy query form #/team?code=BOS (used in early Discord posts and docs) as
     well as the canonical #/team/BOS, so old links resolve instead of 404-ing. */
  code = code || (qs && qs.code) || null;
  var t = CG.TEAM[code]; if (!t) return CG.ROUTES._404();
  var lg = CG.lg;
  var seasonKey = (qs.season && CG.lg.archive && CG.lg.archive[qs.season]) ? qs.season : "cur";
  var SD = CG.seasonData(seasonKey);
  var archived = seasonKey!=="cur";
  var s = SD.teams[code];
  var tab = qs.tab||"roster";
  if (tab==="stats") tab="roster";   /* "Team stats" merged into "Roster & stats" — keep old links working */
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
    '<div class="hero-row" style="display:flex;gap:22px;align-items:center;flex-wrap:wrap">'+
      '<span class="crest3d">'+CG.crest(code,52,{decorative:true})+'</span>'+
      '<div class="hero-main" style="min-width:0;flex:1"><span class="eyebrow chr">'+t.div+' Division · '+esc(t.city)+' · '+esc(t.arena)+'</span>'+
        '<h1 class="h-page" style="color:#fff;margin-top:8px">'+esc(t.name)+'</h1>'+
        '<div style="display:flex;gap:18px;margin-top:12px;font-family:var(--f-mono);font-size:12.5px;color:var(--on-ink-dim);flex-wrap:wrap">'+
          '<span><b style="color:#fff" class="num">'+s.w+"-"+s.l+"-"+s.otl+'</b> record</span>'+
          '<span><b style="color:#fff" class="num">'+s.pts+'</b> points</span>'+
          '<span><b style="color:#fff" class="num">'+(s.diff>0?"+":"")+s.diff+'</b> diff</span>'+
          (archived||!pr?'':'<span>#'+pr.rank+' power ranking '+ (pr.move? (pr.move>0?"▲":"▼")+Math.abs(pr.move):"") +'</span>')+
          CG.form5(s.last5)+'</div></div>'+
      (archived?'':'<div class="hero-ovr" style="text-align:center"><span class="ovrbox" style="min-width:64px;height:52px;font-size:26px">'+lg.teamRatings[code].ovr+'</span>'+
        '<span class="caption" style="display:block;margin-top:6px;color:var(--on-ink-dim)">Team overall</span></div>')+'</div>'+
    '<div style="display:flex;gap:8px;margin-top:20px;flex-wrap:wrap;align-items:center">'+
      (mgmt.owner?'<span class="chip chip-ink" style="border-color:#39434B">Owner · '+esc(mgmt.owner.tag)+'</span>':"")+
      (mgmt.gm?'<span class="chip chip-ink" style="border-color:#39434B">GM · '+esc(mgmt.gm.tag)+'</span>':"")+
      (mgmt.agm?'<span class="chip chip-ink" style="border-color:#39434B">AGM · '+esc(mgmt.agm.tag)+'</span>':"")+
      (!mgmt.owner&&!mgmt.gm&&!mgmt.agm?'<span class="chip chip-ink" style="border-color:#39434B">Management not yet named</span>':"")+'</div>'+
    '<div style="display:flex;gap:12px;align-items:center;margin-top:16px;flex-wrap:wrap">'+
      CG.seasonPicker(seasonKey)+
      (archived?'<span class="chip chip-warn">Archived season — final, read-only</span>'
        /* "Live" is a semantic status. Before a single game exists it is simply untrue, and a
           green pill on an 0-0-0 club dilutes the token everywhere else it is used. */
        :((CG.lg.schedule&&CG.lg.schedule.length)?'<span class="chip chip-win">Live — updates after every final</span>'
                                                 :'<span class="chip">Season 1 — not yet under way</span>'))+
    '</div>'+
  '</div></section>';
  var tabs = '<div class="shell" style="margin-top:22px"><div class="tabs" role="tablist">'+
    [["roster","Roster & stats"],["games","Schedule & results"],["moves","Transactions & discipline"],["honors","Honors"]].map(function(x){
      return '<button role="tab" aria-selected="'+(tab===x[0])+'" class="'+(tab===x[0]?"on":"")+'" data-tab="'+x[0]+'">'+x[1]+'</button>';
    }).join("")+'</div></div>';
  var body = '<div class="shell" style="padding:22px 0 40px">';
  if (tab==="roster"){
    var rosterTable = '<div class="card"><div class="tblwrap"><table class="tbl keepcols"><caption>Roster — '+esc(SD.label)+'</caption><thead><tr>'+
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
      }).join("")+
      (roster.length ? "" : CG.emptyRow(archived?5:6, "No players on this roster yet",
        "Clubs fill up at the draft and in free agency. Signings show here the moment they’re made."))+
      '</tbody></table></div></div>';
    /* consolidated — team stats live in this same tab (no separate Team stats tab).
       Before a single game exists (pre-season) every rate is 0.00 / .000, so we swap the
       zero-wall + the results-derived rating breakdown for one honest "not yet under way" note —
       the same discipline as the player Fresh-sheet card. Archived + played clubs keep the grid. */
    var teamPlayed = archived || (s.gp||0) > 0;
    var teamStats;
    if (!teamPlayed){
      teamStats = '<h3 class="h-sec" style="font-size:18px;margin:0 0 14px">Team stats</h3>'+
        '<div class="card"><div class="empty" style="padding:40px 20px"><div class="e-art">'+CG.ic("chart",22)+'</div>'+
        '<b>No games played yet</b><p>Goals per game, save percentage, the overall rating and the rest fill in automatically from EA box scores after '+esc(CG.TEAM[code].name)+'’s first final. Nothing here is entered by hand.</p></div></div>';
    } else {
      var _gp = Math.max(1,s.gp), _goalies = roster.filter(function(p){ return p.pos==="G"; }),
          _svp = _goalies.reduce(function(a,p){ return a+SD.pstats[p.id].sv; },0) / Math.max(1,_goalies.reduce(function(a,p){ return a+SD.pstats[p.id].sa; },0));
      teamStats = '<h3 class="h-sec" style="font-size:18px;margin:0 0 14px">Team stats</h3>'+
        '<div class="grid g4" style="grid-template-columns:repeat(auto-fill,minmax(190px,1fr))">'+
        [["Goals per game",(s.gf/_gp).toFixed(2)],["Goals against per game",(s.ga/_gp).toFixed(2)],
         ["Team save percentage",_svp.toFixed(3).replace(/^0/,"")],["Shots per game",(s.sf/_gp).toFixed(1)],
         ["Shots against per game",(s.sa/_gp).toFixed(1)],["Home record",s.hw+"-"+s.hl],["Road record",s.aw+"-"+s.al],
         ["Points percentage",(s.ptsPct*100).toFixed(0)+"%"]].map(function(kv){
          return '<div class="kpi" style="cursor:default"><b class="num">'+kv[1]+'</b><span>'+kv[0]+'</span></div>';
        }).join("")+'</div>'+
        (archived
          ? '<div class="note" style="margin-top:18px"><b style="font-family:var(--f-disp)">'+esc(SD.label)+' — final.</b> Archived team numbers are frozen exactly as the season ended.</div>'
          : '<div class="card" style="margin-top:18px"><div class="card-h"><h3>Overall rating breakdown</h3><span class="chip">Formula v1 · configurable</span></div><div class="card-b">'+
        Object.keys(lg.teamRatings[code].parts).map(function(k){
          var v = lg.teamRatings[code].parts[k];
          return '<div class="rbar"><span class="rb-lab">'+k+'</span><span class="rb-track"><span class="rb-fill" style="width:'+v+'%"></span></span><span class="rb-v num">'+v+'</span></div>';
        }).join("")+
        '<p class="caption" style="margin-top:10px">Team overall blends record, goal differential, goaltending, roster depth, and recent form. The commissioner can re-weight the formula in the Control Center — every number traces to real results.</p></div></div>');
    }
    body += teamStats + '<h3 class="h-sec" style="font-size:18px;margin:28px 0 14px">Roster</h3>'+rosterTable;
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
  /* the former "Team stats" tab is consolidated into the Roster & stats tab above */
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
    var wins = lg.potw.filter(function(w){
      var sk = CG.playerById(lg,w.skater), gl = CG.playerById(lg,w.goalie);   /* winner may have left the roster */
      return (sk && sk.team===code) || (gl && gl.team===code);
    });
    body += wins.length ? '<div class="grid g3">'+wins.map(function(w){
      var sk = CG.playerById(lg,w.skater);
      var p = CG.playerById(lg, sk && sk.team===code ? w.skater : w.goalie);
      if (!p) return "";
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
  var nRostered = lg.players.length;
  var head = CG.pageHead("Player directory","Every skater. Every tendy.",
    esc(nRostered+" rostered player"+(nRostered===1?"":"s")+" across "+CG.TEAMS.length+" clubs. "+
      "Overalls are the league's scouting baseline; games, points, and save percentage come straight from EA box scores."));
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
  pid = pid || (qs && (qs.id || qs.pid)) || null;  /* accept legacy #/player?id=… links */
  var p = lg.players.find(function(x){ return x.id===pid; });
  /* Not a rostered league player, but may be a website account holder with pickup stats — render a
     minimal profile whose header + pickup section are filled async in AFTER.player. */
  if (!p) return CG.pageHead("Player", "Player profile", "") +
    '<div class="shell" style="max-width:960px;padding-bottom:2px"><div id="acctHdr" class="note">Loading account…</div></div>' +
    '<section class="sec-tight" style="padding-top:10px"><div class="shell" style="max-width:960px"><div id="pickupSection"></div></div></section>';
  var seasonKey = (qs.season && CG.lg.archive && CG.lg.archive[qs.season]) ? qs.season : "cur";
  var SD = CG.seasonData(seasonKey);
  var archived = seasonKey!=="cur";
  var t = CG.TEAM[p.team], s = SD.pstats[p.id], r = lg.ratings[p.id];
  var tab = qs.tab||"overview";
  var sus = lg.suspensions.find(function(x){ return x.playerId===p.id; });
  var isG = p.pos==="G";
  var me = CG.me();
  var canSeeAvail = CG.role()==="commish" || CG.role()==="staff" || (me && me.team===p.team && CG.can("availability.viewTeam")) || (me && me.id===p.id);
  /* "no games" has to mean no games at ANY stage: s.gp is regular-season only, and a player
     with five pre-season appearances does have a sample to talk about. */
  var preS = (!archived && CG.lg.pre && CG.lg.pre.pstats) ? CG.lg.pre.pstats[p.id] : null;
  var anyGp = (s.gp||0) + ((preS && preS.gp)||0);
  /* Broadcast-grade backdrop: a rink-level environment (Higgsfield soul_location) under a heavy
     charcoal scrim so the crest, name and overall stay fully legible; the club colour rides the
     6px border. The base #101519 shows if the image 404s. */
  var head = '<section class="sec-dark" style="padding:clamp(28px,4vw,52px) 0;border-bottom:6px solid '+t.color+
    ';background:linear-gradient(90deg,rgba(16,21,25,.95),rgba(16,21,25,.72) 46%,rgba(16,21,25,.5)),linear-gradient(180deg,rgba(16,21,25,.32),rgba(16,21,25,.58)),#101519 url(\'/assets/cinema/profile-hero-21x9.jpg\') center/cover no-repeat"><div class="shell">'+
    '<div class="hero-row" style="display:flex;gap:22px;align-items:center;flex-wrap:wrap">'+
      /* the club logo itself, tilted in 3D → links to the team page (same site-wide crest mark) */
      '<a href="#/team/'+esc(p.team)+'" class="crest3d" aria-label="'+esc(t.name)+' — team page">'+CG.crest(p.team,52,{decorative:true})+'</a>'+
      '<div class="hero-main" style="min-width:0;flex:1"><span class="eyebrow chr">'+esc(t.name)+' · '+CG.POS_NAME[p.pos]+' · #'+p.jersey+'</span>'+
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
          (canSeeAvail?'<span class="chip '+(CG.availGet(p.id)?"chip-win":"chip-warn")+'">'+esc(CG.WEEK8.label)+' availability: '+(CG.availGet(p.id)?"submitted":"not submitted")+'</span>':"")+
        '</div></div>'+
      /* OVR is the staff scouting number on the profile — the live adapter sets it from
         profiles.overall for every player, played games or not. It is never derived from results. */
      '<div class="hero-ovr" style="text-align:center"><span class="ovrbox" style="min-width:64px;height:52px;font-size:26px">'+r.ovr+'</span>'+
        '<span class="caption" style="display:block;margin-top:6px;color:var(--on-ink)">Overall · scouted</span></div></div>'+
    '<div style="display:flex;gap:12px;align-items:center;margin-top:20px;flex-wrap:wrap">'+
      CG.seasonPicker(seasonKey)+
      (archived?'<span class="chip chip-warn">Archived season — final, read-only</span>'
        /* "Live" is a semantic status. Before a single game exists it is simply untrue, and a
           green pill on an 0-0-0 club dilutes the token everywhere else it is used. */
        :((CG.lg.schedule&&CG.lg.schedule.length)?'<span class="chip chip-win">Live — updates after every final</span>'
                                                 :'<span class="chip">Season 1 — not yet under way</span>'))+
    '</div>'+
  '</div></section>';
  var tabs = '<div class="shell" style="margin-top:22px"><div class="tabs" role="tablist">'+
    [["overview","Overview"],["pickup","Pickup Stats"],["log","Game log"],["honors","Honors & history"]].map(function(x){
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
      /* the breakdown bars are computed from box scores. At zero games they read "Production 0 ·
         Discipline 100" — a scouting verdict on a player who has never taken a shift, printed
         right under a card that correctly says there are no conclusions yet. */
      : (anyGp===0
        ? '<div class="card"><div class="card-h"><h3>Rating breakdown</h3><span class="chip">OVR '+r.ovr+'</span></div><div class="card-b">'+
          '<p class="small" style="color:var(--steel);line-height:1.65">'+esc(p.tag)+' hasn’t played a game yet, so there is nothing to break down. '+
          'The '+r.ovr+' overall is the staff scouting number from registration; production, defence, and discipline bars '+
          'appear here once box scores exist.</p></div></div>'
        : '<div class="card"><div class="card-h"><h3>Rating breakdown</h3><span class="chip">OVR '+r.ovr+'</span></div><div class="card-b">'+
        Object.keys(r.parts).map(function(k){
          return '<div class="rbar"><span class="rb-lab">'+k+'</span><span class="rb-track"><span class="rb-fill" style="width:'+r.parts[k]+'%"></span></span><span class="rb-v num">'+r.parts[k]+'</span></div>';
        }).join("")+
        '<p class="caption" style="margin-top:10px">Bars are a weighted blend of recorded stats, regressed toward league average under small samples; the weights are commissioner-configurable. The overall itself is the staff scouting number.</p>'+
      '</div></div>');
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
    var ps = preS;
    var preCard = (ps && ps.gp>0) ? '<div class="card" style="margin-top:18px"><div class="card-h"><h3>Pre-season</h3><span class="chip">'+ps.gp+' GP · counts toward overall</span></div><div class="card-b">'+
      '<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(118px,1fr));gap:12px">'+
      (isG ? [["GP",ps.gp],["Record",ps.w+"-"+ps.l+"-"+ps.otl],["SV%",ps.sa?(ps.sv/ps.sa).toFixed(3).replace(/^0/,""):"—"],["GAA",ps.gp?(ps.ga/ps.gp).toFixed(2):"—"],["Shutouts",ps.so]]
           : [["GP",ps.gp],["Goals",ps.g],["Assists",ps.a],["Points",ps.p],["+/-",(ps.pm>0?"+":"")+ps.pm],["Shots",ps.shots]])
        .map(function(kv){ return '<div class="kpi" style="cursor:default"><b class="num" style="font-size:20px">'+kv[1]+'</b><span>'+kv[0]+'</span></div>'; }).join("")+'</div>'+
      '<p class="caption" style="margin-top:12px">Pre-season games stay out of the league standings but count toward the overall rating — and toward the five games that make a first-year player draft-eligible.</p></div></div>' : '';
    /* Empty-state cleanup: a first-year (or just-signed) player with no games at any stage gets a
       single broadcast "fresh sheet" panel instead of a wall of twelve zeroes. The pristine-ice
       still (Higgsfield soul_location) carries the moment; the rating breakdown is dropped as
       redundant here. Played players keep the full KPI grid + scouting card. */
    var isEmpty = !archived && anyGp===0;
    /* the fresh-ice still is dark at the TOP, bright ice at the BOTTOM — so the headline sits at the
       top over the dark region (align-items:flex-start) and the scrim eases through the middle so the
       ice actually reads in the lower band instead of being crushed under a heavy floor scrim */
    var emptyCard = '<div class="card" style="overflow:hidden;padding:0">'+
      '<div style="position:relative;min-height:210px;display:flex;align-items:flex-start;'+
        'background:linear-gradient(180deg,rgba(16,21,25,.9),rgba(16,21,25,.32) 46%,rgba(16,21,25,.08) 74%,rgba(16,21,25,.42)),'+
        '#0e1216 url(\'/assets/cinema/fresh-ice-16x9.jpg\') center 62%/cover no-repeat">'+
        '<div style="position:relative;padding:22px 22px 18px">'+
          '<span class="eyebrow" style="color:var(--chrome)">Fresh sheet</span>'+
          '<h3 style="font-family:var(--f-disp);font-weight:800;font-size:clamp(22px,3.4vw,30px);color:#fff;line-height:1.04;letter-spacing:-.01em;text-transform:none;margin:8px 0 0">Yet to take a shift</h3>'+
        '</div></div>'+
      '<div class="card-b"><p class="small" style="color:var(--steel);line-height:1.7;margin:0">'+esc(scout)+'</p>'+
        '<p class="caption" style="margin-top:10px">Goals, assists and the full stat line fill in automatically from EA box scores after '+esc(p.tag)+'’s first final. The '+r.ovr+' overall is the staff scouting number from registration.</p></div></div>';
    /* Stat Lab viz for players with a REGULAR-SEASON game sample: skater DNA radar + efficiency
       gauges (goalies get goaltending gauges). Gated on s.gp (season only) — a player with just
       pre-season games has an all-zero season line, which would collapse the radar to its floor,
       so they keep the numeric pre-season card without the misleading shape. */
    var playerViz = (isEmpty || archived || (s.gp||0)<1) ? "" : (isG
      ? '<div class="viz-card" style="margin-bottom:16px"><div class="vch"><h4>Efficiency</h4><span class="vsub">goaltending</span></div><div class="vgauges">'+
          CG.vizGauge(s.sa?(s.sv/s.sa*100):0,100, s.sa?(s.sv/s.sa).toFixed(3).replace(/^0/,""):"—","Save %")+
          CG.vizGauge(s.gp?(3-Math.min(3,s.ga/s.gp)):0,3, s.gp?(s.ga/s.gp).toFixed(2):"—","GAA","var(--gold)")+
          CG.vizGauge(s.qs||0, Math.max(s.gp,1), ""+(s.qs||0), "Quality starts","var(--steel)")+
        '</div></div>'
      : '<div class="grid g2" style="align-items:start;margin-bottom:16px">'+
          '<div class="viz-card"><div class="vch"><h4>Skater DNA</h4><span class="vsub">0–100 profile</span></div>'+CG.vizRadar(CG.SKATER_DNA_AXES, CG.skaterDNA(s), null, p.tag)+'</div>'+
          '<div class="viz-card"><div class="vch"><h4>Efficiency</h4><span class="vsub">per game</span></div><div class="vgauges">'+
            CG.vizGauge(s.shots?(s.g/s.shots*100):0,20,(s.shots?Math.round(s.g/s.shots*100):0)+"%","Shooting %")+
            CG.vizGauge(s.p||0, Math.max(s.gp*3,1), ((s.p||0)/Math.max(1,s.gp)).toFixed(2), "Pts / GP","var(--steel)")+
            CG.vizGauge(s.hits||0, Math.max(s.gp*5,1), ""+(s.hits||0), "Hits","var(--gold)")+
          '</div></div></div>');
    var leftTop = isEmpty ? emptyCard :
      playerViz +
      '<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:12px">'+
      cells.map(function(kv){ return '<div class="kpi" style="cursor:default"><b class="num" style="font-size:24px">'+kv[1]+'</b><span>'+kv[0]+'</span></div>'; }).join("")+'</div>'+
      '<div class="card" style="margin-top:18px"><div class="card-h"><h3>'+(archived?"Season summary":"Scouting the numbers")+'</h3><span class="chip">'+(archived?"Archived":"Derived from box scores")+'</span></div><div class="card-b">'+
        '<p class="small" style="color:var(--steel);line-height:1.65">'+esc(scout)+'</p></div></div>';
    if (isEmpty) sideCard = "";   /* the fresh-sheet card already explains the scouted overall */
    body += '<div class="grid g23"><div>'+ leftTop +preCard+advCard+'</div>'+
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
  if (tab==="pickup"){
    body += '<div id="pickupTab"><p class="caption">Loading pickup stats…</p></div>';
  }
  body += '</div>';
  /* Pickup stats live in their own tab (#pickupTab), filled async in AFTER.player from the isolated
     pickup_stats table — the same stat presentation as league play, minus the overall rating. */
  return head + tabs + body;
};
/* ================================================================
   STAT LAB data-viz helpers — theme-aware vanilla SVG/CSS. Colours
   come from design tokens so every chart adapts to light + dark.
   ================================================================ */
CG.vizGauge = function(val, max, disp, label, color){
  color = color || "var(--viz-accent)";
  var r=34, circ=2*Math.PI*r, sweep=0.75, frac=Math.max(0,Math.min(1,(val/max)||0))*sweep, len=(circ*frac).toFixed(1);
  var dispTxt = String(disp==null?val:disp);
  /* value arc drawn only when there's a positive fraction — a 0-value round-cap otherwise leaves a
     stray dot at the track's start. The value is voiced to screen readers via the sr-only span
     (the SVG itself is aria-hidden). */
  var arc = frac>0 ? '<circle class="varc" style="--varc-len:'+len+'" cx="44" cy="42" r="34" fill="none" stroke="'+color+'" stroke-width="6.5" stroke-linecap="round" stroke-dasharray="'+len+' '+circ.toFixed(1)+'" transform="rotate(135 44 42)"/>' : '';
  return '<div class="vgauge"><svg viewBox="0 0 88 80" width="88" height="80" aria-hidden="true">'+
    '<circle class="vgt" cx="44" cy="42" r="34" fill="none" stroke-width="6.5" stroke-linecap="round" stroke-dasharray="'+(circ*sweep).toFixed(1)+' '+circ.toFixed(1)+'" transform="rotate(135 44 42)"/>'+
    arc +
    '<text x="44" y="42" text-anchor="middle" dominant-baseline="central" class="vgv">'+esc(dispTxt)+'</text></svg>'+
    '<div class="vgl">'+esc(label)+'</div><span class="sr-only">'+esc(label)+': '+esc(dispTxt)+'</span></div>';
};
CG.vizRadar = function(axes, me, cmp, meLabel, cmpLabel){
  var cx=150, cy=120, R=86, n=axes.length, TAU=Math.PI*2, g="";
  function poly(vals, mx){ return vals.map(function(v,i){ var a=-Math.PI/2+i*TAU/n, rr=R*Math.max(0,Math.min(1,v/mx)); return [cx+Math.cos(a)*rr, cy+Math.sin(a)*rr]; }); }
  function ptsOf(P){ return P.map(function(p){return p.map(function(z){return z.toFixed(1);}).join(",");}).join(" "); }
  /* faint filled backdrop so the web reads as a surface, then the concentric grid + spokes */
  g+='<polygon class="vr-surface" points="'+ptsOf(poly(axes.map(function(){return 1;}),1))+'"/>';
  [0.25,0.5,0.75,1].forEach(function(f){ g+='<polygon class="vr-grid" points="'+ptsOf(poly(axes.map(function(){return f;}),1))+'"/>'; });
  axes.forEach(function(name,i){ var a=-Math.PI/2+i*TAU/n, ex=cx+Math.cos(a)*R, ey=cy+Math.sin(a)*R;
    g+='<line class="vr-spoke" x1="'+cx+'" y1="'+cy+'" x2="'+ex.toFixed(1)+'" y2="'+ey.toFixed(1)+'"/>';
    var lx=cx+Math.cos(a)*(R+15), ly=cy+Math.sin(a)*(R+15), anc=Math.abs(Math.cos(a))<0.3?"middle":(Math.cos(a)>0?"start":"end");
    g+='<text x="'+lx.toFixed(1)+'" y="'+(ly+3).toFixed(1)+'" text-anchor="'+anc+'">'+esc(name.toUpperCase())+'</text>'; });
  function shape(vals,fill,stroke,dots){ var P=poly(vals,100);
    var o='<polygon points="'+ptsOf(P)+'" fill="'+fill+'" stroke="'+stroke+'" stroke-width="2.25" stroke-linejoin="round"/>';
    if(dots) P.forEach(function(p){ o+='<circle class="vr-dot" cx="'+p[0].toFixed(1)+'" cy="'+p[1].toFixed(1)+'" r="3.2" fill="'+stroke+'"/>'; }); return o; }
  if (cmp) g+=shape(cmp,"color-mix(in srgb,var(--steel) 18%,transparent)","var(--steel)",false);
  g+=shape(me,"color-mix(in srgb,var(--viz-accent) 20%,transparent)","var(--viz-accent)",true);
  var legend = '<div class="vlegend"><span><i style="background:var(--viz-accent)"></i>'+esc(meLabel||"This player")+'</span>'+(cmp?'<span><i style="background:var(--steel)"></i>'+esc(cmpLabel||"League avg")+'</span>':'')+'</div>';
  return '<svg class="vradar" viewBox="0 0 300 244" role="img" aria-label="Attribute radar">'+g+'</svg>'+legend;
};
/* 0-100 attribute profile from a real stat line (per-game, clamped) — the radar's shape. */
CG.skaterDNA = function(s){
  var gp=Math.max(1,s.gp||0), cl=function(x){return Math.max(4,Math.min(100,Math.round(x)));};
  return [
    cl(s.shots? (s.g/s.shots)*100*4.5 : 0),          /* Shooting  — finishing % */
    cl((s.a/gp)/1.2*100),                             /* Playmaking — assists/gp */
    cl(((s.blk||0)+(s.tk||0))/gp/4*100),              /* Defense */
    cl((s.hits||0)/gp/5*100),                         /* Physical */
    cl(100 - (s.pim||0)/gp/3*100),                    /* Discipline — fewer PIM */
    cl(55 + (s.pm||0)/gp*18 + (s.gwg||0)/gp*30)       /* Clutch — +/- & GWG */
  ];
};
CG.SKATER_DNA_AXES = ["Shooting","Playmaking","Defense","Physical","Discipline","Clutch"];

/* Pickup Stats tab — the same stat presentation as league play (KPI grid + game-by-game table),
   built from the isolated pickup_stats rows, minus the overall/rating. W/L is derived from the
   game score + the player's team side. Never feeds league totals, eligibility, or overall. */
CG.renderPickupStats = function(rows){
  var note = '<div class="note" style="margin-bottom:16px">These are <b>pickup games</b> from the #pickup-games lobbies — the same stats as league play, kept separate. They never count toward league totals, the five-game minimum, draft or bid eligibility, or the overall rating.</div>';
  if (!rows || !rows.length){
    return note + '<div class="card"><div class="empty" style="padding:48px 20px"><div class="e-art">'+CG.ic("chart",22)+'</div><b>No pickup games yet</b>'+
      '<p>#pickup-games matches between two EASHL clubs appear here once their box score is imported.</p></div></div>';
  }
  var gp=rows.length, g=0,a=0,sh=0,hit=0,pim=0,pm=0,tk=0, gGames=0, sv=0,sa=0,ga=0, so=0, w=0,l=0,otl=0;
  function sideScores(x){ var gm=x.pickup_games||{}, side=(x.team_side||"").toUpperCase();
    return { my: side==="A"?gm.score_a:(side==="B"?gm.score_b:null), opp: side==="A"?gm.score_b:(side==="B"?gm.score_a:null), ot:gm.went_ot }; }
  rows.forEach(function(x){
    g+=x.goals||0; a+=x.assists||0; sh+=x.shots||0; hit+=x.hits||0; pim+=x.pim||0; pm+=x.plus_minus||0; tk+=x.takeaways||0;
    if (x.is_goalie){ gGames++; sv+=x.saves||0; sa+=x.shots_against||0; ga+=x.goals_against||0; if(x.shutout) so++; }
    var ss=sideScores(x);
    if (ss.my!=null && ss.opp!=null){ if (ss.my>ss.opp) w++; else if (ss.ot) otl++; else l++; }
  });
  var mostlyG = gGames > gp/2;
  var vizCards = "";
  if (!mostlyG){
    /* pickup box scores carry takeaways (no blocked shots), so Defense is takeaway-driven here. */
    var dna = CG.skaterDNA({gp:gp, g:g, a:a, shots:sh, hits:hit, pim:pim, pm:pm, blk:0, tk:tk, gwg:0});
    vizCards = '<div class="grid g2" style="align-items:start;margin-bottom:16px">'+
      '<div class="viz-card"><div class="vch"><h4>Skater DNA</h4><span class="vsub">0–100 profile</span></div>'+CG.vizRadar(CG.SKATER_DNA_AXES, dna, null, "This player")+'</div>'+
      '<div class="viz-card"><div class="vch"><h4>Efficiency</h4><span class="vsub">per game</span></div><div class="vgauges">'+
        CG.vizGauge(sh?(g/sh*100):0, 20, (sh?Math.round(g/sh*100):0)+"%", "Shooting %")+
        CG.vizGauge(g+a, Math.max(gp*3,1), ((g+a)/gp).toFixed(2), "Pts / GP", "var(--steel)")+
        CG.vizGauge(hit, Math.max(gp*5,1), ""+hit, "Hits", "var(--gold)")+
      '</div></div></div>';
  } else {
    vizCards = '<div class="viz-card" style="margin-bottom:16px"><div class="vch"><h4>Efficiency</h4><span class="vsub">goaltending</span></div><div class="vgauges">'+
      CG.vizGauge(sa?(sv/sa*100):0, 100, sa?(sv/sa).toFixed(3).replace(/^0/,""):"—", "Save %")+
      CG.vizGauge(gGames?(3-Math.min(3,ga/gGames)):0, 3, gGames?(ga/gGames).toFixed(2):"—", "GAA", "var(--gold)")+
      CG.vizGauge(sv, Math.max(sa,1), ""+sv, "Saves", "var(--steel)")+
    '</div></div>';
  }
  var cells = mostlyG
    ? [["GP",gp],["Record",w+"-"+l+"-"+otl],["SV%",sa?(sv/sa).toFixed(3).replace(/^0/,""):"—"],["GAA",gGames?(ga/gGames).toFixed(2):"—"],["Saves",sv],["GA",ga],["Shutouts",so]]
    : [["GP",gp],["Goals",g],["Assists",a],["Points",g+a],["+/-",(pm>0?"+":"")+pm],["Shots",sh],["Shooting%",sh?Math.round(100*g/sh)+"%":"—"],["Hits",hit],["PIM",pim]];
  var kpiGrid = '<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:12px">'+
    cells.map(function(kv){ return '<div class="kpi" style="cursor:default"><b class="num" style="font-size:24px">'+kv[1]+'</b><span>'+kv[0]+'</span></div>'; }).join("")+'</div>';
  var sorted = rows.slice().sort(function(x,y){ return ((y.pickup_games&&y.pickup_games.played_at)||"").localeCompare((x.pickup_games&&x.pickup_games.played_at)||""); });
  var logTable = '<div class="card" style="margin-top:18px"><div class="card-h"><h3>Game-by-game</h3><span class="chip">'+gp+' game'+(gp===1?"":"s")+'</span></div>'+
    '<div class="tblwrap"><table class="tbl keepcols"><caption class="sr">Pickup game log</caption><thead><tr>'+
    (mostlyG ? '<th class="tleft">Date</th><th class="tleft">Matchup</th><th>SA</th><th>SV</th><th>GA</th><th>Result</th>'
             : '<th class="tleft">Date</th><th class="tleft">Matchup</th><th>G</th><th>A</th><th>P</th><th>S</th><th>+/-</th><th>PIM</th>')+
    '</tr></thead><tbody>'+sorted.map(function(x){
      var gm=x.pickup_games||{}, when = gm.played_at ? CG.fmtDate(gm.played_at) : "—", ss=sideScores(x);
      var link = gm.id ? ' class="rowlink" data-go="#/pickup/'+gm.id+'"' : '';
      var resChip = (ss.my!=null&&ss.opp!=null) ? '<span class="chip '+(ss.my>ss.opp?"chip-win":"chip-loss")+'">'+(ss.my>ss.opp?"W":(ss.ot?"OTL":"L"))+'</span>' : '—';
      var matchup = esc(gm.club_a||"?")+' '+(gm.score_a==null?"–":gm.score_a)+'–'+(gm.score_b==null?"–":gm.score_b)+' '+esc(gm.club_b||"?");
      return '<tr'+link+'><td class="tleft mono" style="font-size:11px;white-space:nowrap">'+esc(when)+'</td>'+
        '<td class="tleft">'+matchup+(gm.went_ot?' <span class="caption">OT</span>':'')+'</td>'+
        (mostlyG
          ? '<td>'+(x.shots_against||0)+'</td><td>'+(x.saves||0)+'</td><td>'+(x.goals_against||0)+'</td><td>'+resChip+'</td>'
          : '<td class="'+((x.goals||0)?"":"z")+'">'+(x.goals||0)+'</td><td class="'+((x.assists||0)?"":"z")+'">'+(x.assists||0)+'</td><td class="pts">'+((x.goals||0)+(x.assists||0))+'</td><td>'+(x.shots||0)+'</td><td>'+((x.plus_minus||0)>0?"+":"")+(x.plus_minus||0)+'</td><td class="'+((x.pim||0)?"":"z")+'">'+(x.pim||0)+'</td>')+
        '</tr>';
    }).join("")+'</tbody></table></div></div>';
  return note + vizCards + kpiGrid + logTable;
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
  /* Account-only profile (not a rostered league player): fill the minimal header with the gamertag.
     The rest of this handler's selectors are all guarded and no-op on the minimal page; the pickup
     fetch below targets #pickupSection and runs for any account. */
  if (!CG.lg.players.find(function(x){ return x.id===pid; }) && CG.sb){
    CG.sb.from("profiles").select("gamertag").eq("id", pid).maybeSingle().then(function(r){
      var hdr = document.getElementById("acctHdr"); if (!hdr) return;
      if (r && r.data) hdr.innerHTML = '<b style="font-family:var(--f-disp);font-size:16px">'+esc(r.data.gamertag||"Player")+'</b><p class="caption" style="margin:4px 0 0">This account isn’t on a league roster — only pickup game stats show here.</p>';
      else { hdr.innerHTML = '<b>Profile not found.</b>'; var ps=document.getElementById("pickupSection"); if (ps) ps.innerHTML=""; }
    }, function(){});
  }
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

  /* Pickup stats — into the Pickup Stats tab (rostered player) or the account-only section.
     Same league-style presentation via CG.renderPickupStats; runs only when a container exists. */
  var box = document.getElementById("pickupTab") || document.getElementById("pickupSection");
  if (box && CG.sb){
    CG.sb.from("pickup_stats")
      .select("goals,assists,shots,hits,pim,plus_minus,is_goalie,saves,shots_against,goals_against,shutout,team_side,pickup_games(id,club_a,club_b,score_a,score_b,played_at,went_ot)")
      .eq("profile_id", pid)
      .then(function(r){
        box.innerHTML = CG.renderPickupStats((r && r.data) || []);
      }, function(){ box.innerHTML = '<div class="note red">Couldn’t load pickup stats — try again in a moment.</div>'; });
  }
};

/* ================================================================
   PICKUP BOX SCORE — the full box score for one #pickup-games pickup game.
   Structurally isolated from league play: it links out to player
   profiles for convenience, but is never folded into league totals,
   standings, eligibility or overall. pickup_games / pickup_stats are
   not preloaded into CG.lg, so the page is a dark hero skeleton that
   AFTER.pickup fills once the two isolated tables come back.
   ================================================================ */
CG.ROUTES.pickup = function(id){
  if (!id) return CG.ROUTES._404();
  CG._pickupId = id;
  return '<section class="sec-dark" style="padding:clamp(26px,4vw,46px) 0;border-bottom:6px solid var(--chrome);background:linear-gradient(180deg,rgba(16,21,25,.55),rgba(16,21,25,.8)),linear-gradient(90deg,rgba(16,21,25,.9),rgba(16,21,25,.58) 60%,rgba(16,21,25,.4)),#101519 url(\'/assets/cinema/ice-macro-21x9.jpg\') center/cover no-repeat"><div class="shell">'+
    '<a href="#/stats" id="pkBack" class="sec-link" style="color:var(--on-ink-dim)">'+CG.ic("back",14)+'Back</a>'+
    '<h1 id="pkH1" class="sr-only">Pickup game</h1>'+
    '<div id="pkHero" style="margin-top:16px;min-height:92px"><p class="caption" style="color:var(--on-ink-dim)">Loading the box score…</p></div>'+
    '</div></section>'+
    '<div class="shell" style="padding:22px 0 40px"><div id="pkBody"></div></div>';
};
CG.AFTER.pickup = function(id){
  id = id || CG._pickupId;
  var hero = document.getElementById("pkHero"), body = document.getElementById("pkBody");
  if (!id || !CG.sb || !hero) return;
  /* back-arrow returns to wherever they came from (a player profile's pickup section); the
     #/stats href is only the fallback for a cold direct load with no history */
  var bk = document.getElementById("pkBack");
  if (bk) bk.addEventListener("click", function(e){ if (history.length>1){ e.preventDefault(); history.back(); } });
  /* a neutral monogram stands in for the club crest (pickup clubs have no logo record) */
  function pkBadge(name, size){ size = size||56;
    var ch = (((name||"?").trim().charAt(0))||"?").toUpperCase();
    return '<span aria-hidden="true" style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;'+
      'width:'+size+'px;height:'+size+'px;border-radius:50%;background:linear-gradient(135deg,#1b2027,#0f1317);'+
      'border:1px solid #39434B;color:var(--chrome);font-family:var(--f-disp);font-size:'+Math.round(size*0.4)+'px">'+esc(ch)+'</span>';
  }
  function nrm(s){ return (s==null?"":String(s)).trim().toUpperCase(); }
  Promise.all([
    CG.sb.from("pickup_games").select("*").eq("id", id).maybeSingle(),
    CG.sb.from("pickup_stats").select("*, profiles(gamertag)").eq("pickup_game_id", id)
  ]).then(function(rs){
    var g = rs[0] && rs[0].data;
    var rows = (rs[1] && rs[1].data) || [];
    if (!g){ hero.innerHTML = '<b style="color:#fff;font-family:var(--f-disp);font-size:20px">Pickup game not found</b>'+
      '<p class="caption" style="color:var(--on-ink-dim);margin-top:6px">It may have been removed, or the link is out of date.</p>'; if (body) body.innerHTML=""; return; }
    var when = g.played_at ? CG.fmtDate(g.played_at) : "";
    var h1el = document.getElementById("pkH1"); if (h1el) h1el.textContent = (g.club_a||"Club A")+" vs "+(g.club_b||"Club B")+" — pickup game";
    hero.innerHTML = '<span class="eyebrow chr">Pickup game · not league play'+(when?' · '+esc(when):"")+'</span>'+
      '<div class="mx-teams" style="margin-top:14px">'+
        '<div class="mx-side">'+pkBadge(g.club_a,64)+'<div><div class="mx-nm" style="color:#fff">'+esc(g.club_a||"Club A")+'</div><div class="mx-rec">Team A</div></div></div>'+
        '<div class="mx-mid"><div class="mx-score num">'+(g.score_a==null?"–":g.score_a)+' — '+(g.score_b==null?"–":g.score_b)+'</div><div class="mx-t">'+(g.went_ot?"Overtime final":"Final")+'</div></div>'+
        '<div class="mx-side away">'+pkBadge(g.club_b,64)+'<div><div class="mx-nm" style="color:#fff">'+esc(g.club_b||"Club B")+'</div><div class="mx-rec">Team B</div></div></div>'+
      '</div>';
    /* one box-score card per side — skater table + a goalie line, matching the league matchup */
    function boxCard(title, score, list){
      var sk = list.filter(function(x){ return !x.is_goalie; })
        .sort(function(a,b){ return ((b.goals||0)+(b.assists||0))-((a.goals||0)+(a.assists||0)); });
      var gs = list.filter(function(x){ return x.is_goalie; });
      function nameCell(x){
        var gt = x.profiles && x.profiles.gamertag, label = gt || x.skater_name || "Player";
        return '<span class="playercell"><span class="nm">'+esc(label)+'</span>'+(x.position?'<small>'+esc(x.position)+'</small>':"")+'</span>';
      }
      function rowAttr(x){ var gt = x.profiles && x.profiles.gamertag;
        return (x.profile_id && gt) ? ' class="rowlink" data-go="#/player/'+x.profile_id+'" role="link" tabindex="0"' : ""; }
      var skHtml = sk.map(function(x){
        return '<tr'+rowAttr(x)+'><td class="tleft">'+nameCell(x)+'</td>'+
          '<td class="'+((x.goals||0)?"":"z")+'">'+(x.goals||0)+'</td><td class="'+((x.assists||0)?"":"z")+'">'+(x.assists||0)+'</td>'+
          '<td class="pts">'+((x.goals||0)+(x.assists||0))+'</td><td>'+(x.shots||0)+'</td>'+
          '<td class="'+((x.hits||0)?"":"z")+'">'+(x.hits||0)+'</td><td class="'+((x.pim||0)?"":"z")+'">'+(x.pim||0)+'</td>'+
          '<td>'+((x.plus_minus||0)>0?"+":"")+(x.plus_minus||0)+'</td></tr>';
      }).join("");
      var glHtml = gs.map(function(x){
        var gt = x.profiles && x.profiles.gamertag, label = gt || x.skater_name || "Goalie";
        var sa = x.shots_against||0, sv = x.saves||0;
        return '<tr'+rowAttr(x)+'><td class="tleft" style="font-family:var(--f-mono);font-size:11px;color:var(--steel)">G: '+esc(label)+'</td>'+
          '<td colspan="7" class="tleft" style="font-family:var(--f-mono);font-size:11px;color:var(--steel)">'+
          sv+'/'+sa+' saves'+(sa?" ("+(sv/sa).toFixed(3).replace(/^0/,"")+")":"")+' · '+(x.goals_against||0)+' GA'+(x.shutout?" · SHUTOUT":"")+'</td></tr>';
      }).join("");
      if (!sk.length && !gs.length) skHtml = '<tr><td colspan="8" class="tleft"><span class="caption">No player lines imported for this side.</span></td></tr>';
      return '<div class="card" style="margin-bottom:18px"><div class="card-h"><h3><span style="display:inline-flex;align-items:center;gap:9px">'+
        pkBadge(title,22)+esc(title)+' — '+(score==null?"–":score)+'</span></h3></div>'+
        '<div class="tblwrap"><table class="tbl keepcols"><thead><tr><th class="tleft">Skater</th><th>G</th><th>A</th><th>P</th><th>S</th><th>HIT</th><th>PIM</th><th>+/-</th></tr></thead><tbody>'+
        skHtml+glHtml+'</tbody></table></div></div>';
    }
    var sideA = rows.filter(function(x){ return nrm(x.team_side)==="A"; });
    var sideB = rows.filter(function(x){ return nrm(x.team_side)==="B"; });
    var other = rows.filter(function(x){ return nrm(x.team_side)!=="A" && nrm(x.team_side)!=="B"; });
    if (other.length) sideA = sideA.concat(other);   /* never drop a line we can't bucket */
    body.innerHTML = '<div class="grid g23" style="align-items:start"><div>'+
      boxCard(g.club_a||"Club A", g.score_a, sideA)+
      boxCard(g.club_b||"Club B", g.score_b, sideB)+
      '</div><div class="stack">'+
      '<div class="card"><div class="card-h"><h3>Pickup game</h3><span class="chip">Not league play</span></div><div class="card-b">'+
        '<p class="small" style="color:var(--steel);line-height:1.65">Imported from the EA NHL match record through the pickup importer. Pickup lines show on player profiles for fun — they never count toward league standings, the five-game minimum, draft or bid eligibility, or overall ratings.</p>'+
        (when?'<p class="caption" style="margin-top:10px">Played '+esc(when)+(g.went_ot?" · settled in overtime":"")+'.</p>':"")+
      '</div></div>'+
      '</div></div>';
  }, function(){ hero.innerHTML = '<b style="color:#fff">Couldn’t load this game.</b><p class="caption" style="color:var(--on-ink-dim);margin-top:6px">Try again in a moment.</p>'; });
};

/* ---------- STATS CENTRAL ---------- */
CG.ROUTES.stats = function(param, qs){
  var lg = CG.lg;
  var tab = qs.tab||"skaters", minGp = qs.min===undefined? 3 : +qs.min, fTeam = qs.team||"";
  /* an empty table has two very different causes, and the reader can only act on one of them */
  var noGames = !(lg.allResults||lg.results).length;
  var emptyStats = function(cols, what){
    return noGames
      ? CG.emptyRow(cols, "No "+what+" yet",
          "The season hasn’t started. Every column here fills in automatically from EA box scores after the first final.")
      : CG.emptyRow(cols, "No "+what+" match this view",
          "Lower the minimum GP or pick a different club — the filters above are hiding everyone.");
  };
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
        '<td data-v="'+(s.fot?100*s.fow/s.fot:0).toFixed(1)+'">'+(s.fot?(100*s.fow/s.fot).toFixed(1):"—")+'</td></tr>'; }).join("")+
      (list.length ? "" : emptyStats(15,"skater stats"))+'</tbody></table>';
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
        '<td data-v="'+(s._ratN?+s.ratTeam:0).toFixed(1)+'">'+(s._ratN?(+s.ratTeam).toFixed(1):"—")+'</td></tr>'; }).join("")+
      (la.length ? "" : emptyStats(15,"advanced metrics"))+'</tbody></table>';
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
        '<td data-v="'+(s.pokes||0)+'">'+(s.pokes||0)+'</td></tr>'; }).join("")+
      (gl.length ? "" : emptyStats(13,"goaltender stats"))+'</tbody></table>';
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
