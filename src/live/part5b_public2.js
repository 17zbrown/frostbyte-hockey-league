/* ================================================================
   PUBLIC PAGES II — awards, rankings, news, rulebook, matchup, misc
   ================================================================ */

/* ---------- AWARDS ---------- */
CG.ROUTES.awards = function(param, qs){
  var lg = CG.lg, C = CG.CONTENT;
  var tab = qs.tab||"stars";
  var head = CG.pageHead("Hardware","Awards & honors","Three Stars every game night, Players of the Week every Monday, season hardware in August.");
  if (CG.isPreseason && CG.isPreseason()){
    return head + '<div class="shell" style="padding-bottom:48px"><div class="card"><div class="empty" style="padding:70px 20px">'+
      '<div class="e-art">'+CG.ic("trophy",22)+'</div><b>Awards begin when the season does</b>'+
      '<p>Three Stars are named after every game night, Players of the Week every Monday, and season hardware in the finale. The first honors go out in Week 1.</p>'+
      '<a class="btn btn-chrome" style="margin-top:18px" href="#/schedule">Opening schedule</a></div></div></div>';
  }
  var tabs = '<div class="shell"><div class="tabs" role="tablist">'+
    [["stars","Three Stars"],["potw","Players of the Week"],["season","Season awards"]].map(function(x){
      return '<button role="tab" aria-selected="'+(tab===x[0])+'" class="'+(tab===x[0]?"on":"")+'" data-tab="'+x[0]+'">'+x[1]+'</button>'; }).join("")+'</div></div>';
  var body = '<div class="shell" style="padding:22px 0 40px">';
  if (tab==="stars"){
    var nights = lg.lastNight.filter(function(r){ return (r.stars||[]).every(function(st){ return CG.playerById(lg, st.pid); }); });
    body += nights.length ? nights.map(function(r){
      return '<div class="card" style="margin-bottom:18px"><div class="card-h">'+
        '<h3>'+esc(CG.TEAM[r.home].name)+' '+r.score[r.home]+'–'+r.score[r.away]+' '+esc(CG.TEAM[r.away].name)+(r.ot?" (OT)":"")+'</h3>'+
        '<a class="sec-link" href="#/matchup/'+r.id+'">Box score</a></div>'+
        '<div class="card-b"><div class="starsrow">'+r.stars.map(function(st,i){
          var p = CG.playerById(lg, st.pid); var b = r.box[st.team][st.pid]||{};
          return '<div class="starcard" data-go="'+CG.playerRoute(p)+'" role="link" tabindex="0"><span class="st-k">'+["1st star","2nd star","3rd star"][i]+'</span>'+
            '<div style="display:flex;gap:10px;align-items:center;margin-top:6px">'+CG.crest(p.team,30)+
            '<div><b style="font-family:var(--f-disp)">'+esc(p.tag)+'</b>'+
            '<span class="caption" style="display:block">'+(b.goalie? (b.sv||0)+" saves"+(b.so?", shutout":"") : (b.g||0)+"G "+(b.a||0)+"A")+'</span></div></div></div>';
        }).join("")+'</div><p class="caption" style="margin-top:14px">Picked automatically from the night’s box scores.</p></div></div>';
    }).join("") : '<div class="card"><div class="empty" style="padding:60px 20px"><div class="e-art">'+CG.ic("trophy",22)+'</div><b>No Three Stars yet</b><p>Stars are named automatically after every completed game night.</p></div></div>';
  }
  if (tab==="potw"){
    var weeks = lg.potw.slice().reverse().filter(function(w){ return CG.playerById(lg,w.skater) && CG.playerById(lg,w.goalie); });
    var latestWeek = weeks.length ? weeks[0].week : null;
    body += weeks.length ? '<div class="stack">'+weeks.map(function(w){
      var sk = CG.playerById(lg,w.skater), gl = CG.playerById(lg,w.goalie);
      return '<div class="card"><div class="card-h"><h3>Week '+w.week+'</h3><span class="chip">'+(w.week===latestWeek?"Latest":"")+'</span></div>'+
        '<div class="grid g2" style="gap:0">'+
        [[sk,"Skater of the Week",w.skBlurb],[gl,"Goaltender of the Week",w.glBlurb]].map(function(row){
          return '<div class="card-b" style="display:flex;gap:14px;align-items:flex-start;border-top:1px solid var(--line-soft)">'+CG.crest(row[0].team,38)+
            '<div style="min-width:0"><span class="chip chip-chrome">'+row[1]+'</span>'+
            '<b style="display:block;font-family:var(--f-disp);font-size:17px;margin-top:7px;cursor:pointer" data-go="'+CG.playerRoute(row[0])+'">'+esc(row[0].tag)+'</b>'+
            '<span class="caption">'+esc(CG.TEAM[row[0].team].name)+'</span>'+
            '<p class="small" style="color:var(--steel);margin-top:8px">'+esc(row[2]||"")+'</p></div></div>';
        }).join("")+'</div></div>';
    }).join("")+'</div>' : '<div class="card"><div class="empty" style="padding:60px 20px"><div class="e-art">'+CG.ic("trophy",22)+'</div><b>No weekly honors yet</b><p>The first Players of the Week are computed automatically the Monday after Week 1 — straight from the imported box scores.</p></div></div>';
  }
  if (tab==="season"){
    var mvps = CG.skaterLeaders(lg,"p").slice(0,3);
    /* finalized hardware first — champion + any staff-balloted awards already decided */
    var AWARD_LABELS = { mvp:"Most Valuable Player", best_goalie:"Best Goaltender", best_defenseman:"Best Defenseman", rookie_of_year:"Rookie of the Year" };
    var decided = (lg.seasonAwards||[]).filter(function(a){ return a.profile_id && CG.playerById(lg, a.profile_id); });
    if (lg.champion || decided.length){
      body += '<div class="grid g3" style="margin-bottom:18px">'+
        (lg.champion && lg.champion.team_id && (lg._idToCode||{})[lg.champion.team_id]
          ? (function(){ var code = lg._idToCode[lg.champion.team_id];
              return '<div class="card raise" data-go="#/team/'+code+'" role="link" tabindex="0"><div class="card-b" style="display:flex;gap:14px;align-items:center">'+CG.crest(code,44)+
                '<div><span class="chip chip-chrome">League Champions</span><b style="display:block;font-family:var(--f-disp);font-size:17px;margin-top:7px">'+esc(CG.TEAM[code].name)+'</b>'+
                '<span class="caption">'+esc(lg.champion.stat_line||"")+'</span></div></div></div>'; })()
          : "")+
        decided.map(function(a){ var p = CG.playerById(lg, a.profile_id);
          return '<div class="card raise" data-go="'+CG.playerRoute(p)+'" role="link" tabindex="0"><div class="card-b" style="display:flex;gap:14px;align-items:center">'+CG.crest(p.team,44)+
            '<div><span class="chip chip-chrome">'+esc(AWARD_LABELS[a.category]||a.category)+'</span><b style="display:block;font-family:var(--f-disp);font-size:17px;margin-top:7px">'+esc(p.tag)+'</b>'+
            '<span class="caption">'+esc(CG.TEAM[p.team].name)+' · staff ballot</span></div></div></div>';
        }).join("")+'</div>';
    }
    body += '<div class="note chr" style="margin-bottom:18px"><b style="font-family:var(--f-disp)">Season hardware is decided by staff ballot.</b> Staff vote from the Staff Desk through the season; the commissioner finalizes each award after the finale. Nominees below are the current statistical front-runners, not winners.</div>'+
      '<div class="grid g3">'+
      [["Most Valuable Player", mvps],
       ["Best Goaltender", CG.goalieLeaders(lg).slice(0,3)],
       ["Rookie of the Year", lg.players.filter(function(p){return p.rookie && p.pos!=="G";}).sort(function(a,b){ return lg.pstats[b.id].p-lg.pstats[a.id].p; }).slice(0,3)]
      ].map(function(pair){
        return '<div class="card"><div class="card-h"><h3>'+pair[0]+'</h3><span class="chip">Front-runners</span></div>'+
          pair[1].map(function(p,i){ var s = lg.pstats[p.id];
            return '<div class="leaderrow'+(i===0?" top":"")+'" data-go="'+CG.playerRoute(p)+'"><span class="rk num">'+(i+1)+'</span>'+CG.crest(p.team,28)+
              '<span style="min-width:0"><b style="font-size:14px">'+esc(p.tag)+'</b><small class="caption" style="display:block">'+esc(CG.TEAM[p.team].name)+'</small></span>'+
              '<span class="val"><b class="num">'+(p.pos==="G"?(s.sv/Math.max(1,s.sa)).toFixed(3).replace(/^0/,""):s.p)+'</b><span>'+(p.pos==="G"?"SV%":"PTS")+'</span></span></div>';
          }).join("")+'</div>';
      }).join("")+'</div>'+
      '<div class="grid g4" style="margin-top:18px;grid-template-columns:repeat(auto-fill,minmax(210px,1fr))">'+
      ["Most Valuable Player","Best Goaltender","Best Defenseman","Rookie of the Year"].map(function(a){
        return '<div class="kpi" style="cursor:default"><b style="font-size:15px;font-family:var(--f-disp)">'+a+'</b><span>Decided by staff ballot</span></div>';
      }).join("")+'</div>';
  }
  return head + tabs + body + '</div>';
};
CG.AFTER.awards = function(param){
  $$("[data-tab]").forEach(function(b){ b.addEventListener("click", function(){ location.hash="#/awards?tab="+this.getAttribute("data-tab"); }); });
};

/* ---------- POWER RANKINGS ---------- */
CG.ROUTES.rankings = function(){
  var lg = CG.lg, C = CG.CONTENT;
  if (CG.isPreseason && CG.isPreseason()){
    var pHead = CG.pageHead("Preseason projections","CGHL Power Rankings","Weekly power rankings begin once games are played. Until then, here's how the clubs line up on paper — by roster overall.");
    var order = CG.TEAMS.slice().sort(function(a,b){ return lg.teamRatings[b.code].ovr - lg.teamRatings[a.code].ovr; });
    var pRows = order.map(function(t, i){
      var r = lg.byTeam[t.code]||[];
      return '<div class="card raise" style="--tc:'+t.color+'" data-go="#/team/'+t.code+'" role="link" tabindex="0"><div class="card-b" style="display:grid;grid-template-columns:64px auto 1fr;gap:18px;align-items:center">'+
        '<div style="text-align:center"><b style="font-family:var(--f-disp);font-weight:900;font-size:34px;letter-spacing:-.02em">'+(i+1)+'</b></div>'+
        CG.crest(t.code,52)+
        '<div style="min-width:0"><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">'+
          '<b style="font-family:var(--f-disp);font-size:19px">'+esc(t.name)+'</b>'+
          '<span class="chip">'+esc(t.div)+' Division</span>'+
          '<span class="ovrbox '+CG.ovrClass(lg.teamRatings[t.code].ovr)+'" style="min-width:36px;height:24px;font-size:13px">'+lg.teamRatings[t.code].ovr+'</span></div>'+
          '<p class="caption" style="margin-top:8px">'+r.length+' player'+(r.length===1?"":"s")+' signed · roster building</p></div></div></div>';
    }).join("");
    return pHead + '<div class="shell" style="padding-bottom:40px"><div class="stack">'+pRows+'</div>'+
      '<div class="note" style="margin-top:20px">Projections from roster overall only — no games have been played yet. Weekly rankings with commentary start in Week 1.</div></div>';
  }
  var rkWeek = lg.results.reduce(function(m,r){ return Math.max(m, r.week||1); }, 1);
  var head = CG.pageHead("Week "+rkWeek+" · recomputed after every final","CGHL Power Rankings",
    "Every club, ranked by record, goal share, and recent form — straight math, updated the moment a game goes final.");
  var rows = lg.powerRankings.map(function(pr){
    var t = CG.TEAM[pr.team], s = lg.teams[pr.team];
    /* commentary is computed from real results — the club's record and current form */
    var line = t.name+" sit "+(pr.rank===1?"top of the league":pr.rank<=3?"inside the top three":"at #"+pr.rank)+
      " at "+s.w+"-"+s.l+"-"+s.otl+(s.gf!=null&&s.ga!=null?", "+(s.gf>s.ga?"outscoring opponents "+s.gf+"–"+s.ga:s.gf<s.ga?"outscored "+s.ga+"–"+s.gf:"even on goals at "+s.gf)+" so far":"")+".";
    var top = (lg.byTeam[pr.team]||[]).slice().sort(function(a,b){ return (lg.pstats[b.id]?lg.pstats[b.id].p:0)-(lg.pstats[a.id]?lg.pstats[a.id].p:0); })[0];
    return '<div class="card raise" style="--tc:'+t.color+'" data-go="#/team/'+pr.team+'" role="link" tabindex="0"><div class="card-b" style="display:grid;grid-template-columns:64px auto 1fr;gap:18px;align-items:start">'+
      '<div style="text-align:center"><b style="font-family:var(--f-disp);font-weight:900;font-size:34px;letter-spacing:-.02em">'+pr.rank+'</b>'+
        '<span style="display:block;margin-top:2px">'+CG.moveArrow(pr.move)+'</span></div>'+
      CG.crest(pr.team,52)+
      '<div style="min-width:0"><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">'+
        '<b style="font-family:var(--f-disp);font-size:19px">'+esc(t.name)+'</b>'+
        '<span class="chip">'+s.w+"-"+s.l+"-"+s.otl+'</span><span class="ovrbox '+CG.ovrClass(lg.teamRatings[pr.team].ovr)+'" style="min-width:36px;height:24px;font-size:13px">'+lg.teamRatings[pr.team].ovr+'</span>'+CG.form5(s.last5)+'</div>'+
        '<p class="small" style="color:var(--steel);margin-top:8px;max-width:72ch">'+esc(line)+'</p>'+
        (top && lg.pstats[top.id] && lg.pstats[top.id].p>0?'<p class="caption" style="margin-top:7px"><b style="color:var(--ink)">Key player:</b> '+esc(top.tag)+' — '+lg.pstats[top.id].p+' pts</p>':"")+
      '</div></div></div>';
  }).join("");
  return head + '<div class="shell" style="padding-bottom:40px"><div class="stack">'+rows+'</div>'+
    '<div class="note" style="margin-top:20px"><b style="font-family:var(--f-disp)">How these differ from standings:</b> the standings count points; the rankings weigh record, goal difference, and the last five games together — a hot club can outrank a higher-seeded one.</div></div>';
};

/* ---------- NEWS ---------- */
CG.ROUTES.news = function(param, qs){
  var C = CG.CONTENT;
  var cat = qs.cat||"";
  var cats = []; C.articles.forEach(function(a){ if (cats.indexOf(a.category)<0) cats.push(a.category); });
  var arts = C.articles.slice().sort(function(a,b){ return b.dateIso.localeCompare(a.dateIso); })
    .filter(function(a){ return !cat || a.category===cat; });
  var head = CG.pageHead("The newsroom","League news","Recaps, rulings, rankings, and roster moves — written by the league, for the league.");
  var filter = '<div class="shell" style="margin-bottom:20px"><div class="filters"><div class="seg" style="flex-wrap:wrap">'+
    '<button data-cat="" class="'+(cat===""?"on":"")+'">All</button>'+
    cats.map(function(c){ return '<button data-cat="'+esc(c)+'" class="'+(cat===c?"on":"")+'">'+esc(c)+'</button>'; }).join("")+'</div></div></div>';
  var body = arts.length
    ? '<div class="grid g3" style="grid-template-columns:repeat(auto-fill,minmax(300px,1fr))">'+arts.map(function(a,i){ return CG.newsCard(a, i===0 && !cat); }).join("")+'</div>'
    : '<div class="empty"><div class="e-art">'+CG.ic("doc",22)+'</div><b>Nothing in this category yet</b><p>Stories land here as the newsroom publishes them.</p></div>';
  return head + filter + '<div class="shell" style="padding-bottom:40px">'+body+'</div>';
};
CG.AFTER.news = function(){
  $$("[data-cat]").forEach(function(b){ b.addEventListener("click", function(){ location.hash="#/news?cat="+encodeURIComponent(this.getAttribute("data-cat")); }); });
};
CG.ROUTES.article = function(slug){
  var a = CG.CONTENT.articles.find(function(x){ return x.slug===slug; });
  if (!a) return CG.ROUTES._404();
  var related = CG.CONTENT.articles.filter(function(x){ return x.slug!==slug && (x.category===a.category || x.relatedTeams.some(function(t){ return a.relatedTeams.indexOf(t)>=0; })); }).slice(0,3);
  var teams = a.relatedTeams.map(function(nm){ return CG.TEAMS.find(function(t){ return t.name===nm; }); }).filter(Boolean);
  return '<section class="sec-tight"><div class="shell" style="max-width:860px">'+
    '<a href="#/news" class="sec-link">'+CG.ic("back",14)+'Back to the newsroom</a>'+
    '<div style="margin-top:26px"><span class="eyebrow chr">'+esc(a.category)+'</span>'+
    '<h1 class="h-page" style="margin-top:12px;font-size:clamp(28px,4vw,44px)">'+esc(a.title)+'</h1>'+
    '<p class="lede" style="margin-top:14px">'+esc(a.excerpt)+'</p>'+
    '<div style="display:flex;gap:14px;align-items:center;margin:18px 0 26px;padding-bottom:18px;border-bottom:1.5px solid var(--ink);flex-wrap:wrap">'+
      '<span class="caption">'+esc(a.author)+' · '+CG.fmtDate(a.dateIso)+'</span>'+
      teams.map(function(t){ return '<a class="chip" href="#/team/'+t.code+'">'+esc(t.name)+'</a>'; }).join("")+'</div>'+
    '<div style="font-size:16.5px;line-height:1.75;max-width:68ch">'+
      a.body.map(function(p){ return '<p style="margin-bottom:18px">'+esc(p)+'</p>'; }).join("")+'</div>'+
    '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">'+a.tags.map(function(t){ return '<span class="chip">'+esc(t)+'</span>'; }).join("")+'</div>'+
    (related.length?'<div style="margin-top:40px"><span class="eyebrow chr">Related coverage</span><div class="grid g3" style="margin-top:16px">'+
      related.map(function(r){ return CG.newsCard(r); }).join("")+'</div></div>':"")+
  '</div></section>';
};

/* ---------- RULEBOOK ---------- */
CG.ROUTES.rulebook = function(param, qs){
  var rb = CG.CONTENT.rulebook;
  var q = (qs.q||"").toLowerCase();
  var target = qs.rule||"";
  var edits = CG.store.get("rbEdits")||{};
  var head = CG.pageHead("Official rulebook · v"+rb.changelog[0].version+" · effective "+CG.fmtDate("2026-07-01"),
    "CGHL Rulebook","Ten chapters. Searchable, versioned, and linkable — cite a rule by its number anywhere in the league.",
    '<div style="display:flex;gap:9px;align-self:flex-end"><button class="btn btn-ghost btn-sm" id="rbPrint">'+CG.ic("doc",14)+'Print view</button></div>');
  var toc = '<div class="card"><div class="card-h"><h3>Contents</h3></div><div style="padding:8px 0">'+
    rb.chapters.map(function(ch){
      return '<a class="pop-item" href="#/rulebook?rule='+ch.sections[0].id+'" style="font-size:13px"><b class="num" style="font-family:var(--f-mono);color:var(--steel);width:20px">'+ch.num+'</b>'+esc(ch.title)+'</a>';
    }).join("")+'</div></div>'+
    '<div class="card" style="margin-top:16px"><div class="card-h"><h3>Version history</h3></div>'+
    rb.changelog.map(function(c){
      return '<div class="notif" style="cursor:default"><span class="nf-ic">'+CG.ic("doc",14)+'</span><span><b>v'+esc(c.version)+'</b><p>'+esc(c.summary)+'</p></span><span class="nf-t">'+CG.fmtDate(c.dateIso)+'</span></div>';
    }).join("")+'</div>';
  var chaptersHtml = rb.chapters.map(function(ch){
    var secs = ch.sections.filter(function(s){
      if (!q) return true;
      return (s.id+" "+s.title+" "+s.paragraphs.join(" ")).toLowerCase().indexOf(q)>=0;
    });
    if (!secs.length) return "";
    return '<div class="card" style="margin-bottom:18px" id="ch'+ch.num+'"><div class="card-h"><h3>Chapter '+ch.num+' — '+esc(ch.title)+'</h3></div><div class="card-b">'+
      secs.map(function(s){
        var text = edits[s.id] ? edits[s.id] : s.paragraphs.join("\n\n");
        var hl = target===s.id;
        return '<div id="rule-'+s.id+'" style="padding:14px;border-radius:10px;margin-bottom:8px;'+(hl?"background:var(--chrome-tint);border:1.5px solid var(--chrome-deep)":"")+'">'+
          '<div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap"><b class="mono" style="font-size:13px;color:var(--steel)">'+s.id+'</b>'+
          '<b style="font-family:var(--f-disp);font-size:16px">'+esc(s.title)+'</b>'+
          '<button class="chip" data-copyrule="'+s.id+'" title="Copy a direct link to this rule" style="cursor:pointer">Link</button>'+
          (edits[s.id]?'<span class="chip chip-warn">Amended v-next (draft)</span>':"")+'</div>'+
          text.split("\n\n").map(function(pp){ return '<p class="small" style="color:var(--ink-3);margin-top:9px;line-height:1.65;max-width:76ch">'+esc(pp)+'</p>'; }).join("")+
        '</div>';
      }).join("")+'</div></div>';
  }).join("");
  if (q && !chaptersHtml) chaptersHtml = '<div class="empty"><div class="e-art">'+CG.ic("search",22)+'</div><b>No rules match “'+esc(qs.q)+'”</b><p>Try a rule number (like 7.4) or a keyword like “forfeit” or “availability”.</p></div>';
  return head + '<div class="shell" style="padding-bottom:40px"><div class="grid g32" style="align-items:start">'+
    '<div class="hub-side" style="position:static;display:block">'+toc+'</div>'+
    '<div><input type="search" id="rbQ" placeholder="Search the rulebook… (e.g. 7.4, forfeit, overtime)" value="'+esc(qs.q||"")+'" style="margin-bottom:18px" aria-label="Search rulebook">'+chaptersHtml+'</div>'+
  '</div></div>';
};
CG.AFTER.rulebook = function(param, qs){
  var tid;
  $("#rbQ").addEventListener("input", function(){ var v=this.value; clearTimeout(tid); tid=setTimeout(function(){ location.hash="#/rulebook?q="+encodeURIComponent(v); },400); });
  $("#rbPrint").addEventListener("click", function(){ window.print(); });
  $$("[data-copyrule]").forEach(function(b){
    b.addEventListener("click", function(){
      var id = this.getAttribute("data-copyrule");
      var url = location.origin+location.pathname+"#/rulebook?rule="+id;
      if (navigator.clipboard) navigator.clipboard.writeText(url);
      CG.toast("Link to Rule "+id+" copied", "ok");
    });
  });
  if (qs.rule){ var el = $("#rule-"+CSS.escape(qs.rule)); if (el) setTimeout(function(){ el.scrollIntoView({block:"center", behavior:"instant"}); }, 420); }
};

/* ---------- MATCHUP CENTER ---------- */
CG.gameCode = function(id){
  /* prefer a real EA lobby code assigned to the game (EA club codes are 6-digit numbers) */
  var g = CG.lg && CG.lg.schedule && CG.lg.schedule.find(function(x){ return x.id===id; });
  if (g && g.code) return String(g.code);
  /* otherwise a stable 6-digit code hashed from the game id — same number for both
     clubs on every render, never drifts */
  var h = 2166136261, s = String(id);
  for (var i=0;i<s.length;i++){ h ^= s.charCodeAt(i); h = (h*16777619) >>> 0; }
  return String(100000 + (h % 900000));
};
CG.plannedLineup = function(g, code){
  var saved = (CG.store.get("lineups")||{})[g.id+":"+code];
  if (saved && saved.status!=="draft") return saved.slots;
  var slots = {};
  ["LW","C","RW","LD","RD","G"].forEach(function(pos){
    var pick = (CG.lg.byTeam[code]||[]).filter(function(p){ return p.pos===pos; }).sort(function(a,b){ return a.depth-b.depth; })[0];
    slots[pos] = pick ? pick.id : null;   /* a thin roster must not crash the page */
  });
  return slots;
};
CG.ROUTES.matchup = function(id){
  var lg = CG.lg;
  var g = lg.schedule.find(function(x){ return x.id===id; });
  if (!g) return CG.ROUTES._404();
  var res = (lg.allResults||lg.results).find(function(r){ return r.id===id; });
  var now = CG.now();
  var th = lg.teams[g.home], ta = lg.teams[g.away];
  var prPos = {}; lg.powerRankings.forEach(function(p){ prPos[p.team]=p.rank; });
  /* head-to-head from results */
  var h2h = { home:0, away:0 };
  lg.results.forEach(function(r){
    if ((r.home===g.home&&r.away===g.away)||(r.home===g.away&&r.away===g.home)){
      var w = r.score[g.home]!==undefined && r.score[g.home]>r.score[g.away] ? "home":"away";
      if (r.score[g.home]===undefined) return;
      h2h[ r.score[g.home]>r.score[g.away] ? "home":"away" ]++;
    }
  });
  var status = res ? (res.ot?"Final / OT":"Final")
    : (g.at - now < 4*3600000 && g.at - now > -3*3600000 ? "Tonight" : "Scheduled");
  var hero = '<section class="sec-tight"><div class="shell">'+
    '<a href="#/schedule" class="sec-link">'+CG.ic("back",14)+'Schedule</a>'+
    '<div class="mx-hero" style="margin-top:18px"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:20px">'+
      '<span class="chip '+(status==="Tonight"?"chip-live":"chip-ink")+'" style="border-color:#39434B">'+(status==="Tonight"?'<span class="live-dot"></span>':"")+status+' · '+(g.stage==="preseason"?"Pre-season week ":g.stage==="playoff"?"Playoff week ":"Week ")+g.week+'</span>'+
      '<span class="chip chip-ink" style="border-color:#39434B">'+CG.fmtFull(g.at)+' · '+esc(CG.TEAM[g.home].arena)+'</span></div>'+
    '<div class="mx-teams">'+
      '<div class="mx-side">'+CG.crest(g.away,64)+'<div><div class="mx-nm">'+esc(CG.TEAM[g.away].name)+'</div>'+
        '<div class="mx-rec">'+ta.w+"-"+ta.l+"-"+ta.otl+' · #'+prPos[g.away]+' PR · OVR '+lg.teamRatings[g.away].ovr+'</div></div></div>'+
      '<div class="mx-mid">'+(res
        ? '<div class="mx-score num">'+res.score[g.away]+' — '+res.score[g.home]+'</div><div class="mx-t">'+(res.ot?"Overtime final":"Final")+'</div>'
        : '<div class="mx-score num" id="mxCount">—</div><div class="mx-t">to puck drop</div>')+'</div>'+
      '<div class="mx-side away">'+CG.crest(g.home,64)+'<div><div class="mx-nm">'+esc(CG.TEAM[g.home].name)+'</div>'+
        '<div class="mx-rec">'+th.w+"-"+th.l+"-"+th.otl+' · #'+prPos[g.home]+' PR · OVR '+lg.teamRatings[g.home].ovr+'</div></div></div>'+
    '</div>'+
    '<div style="display:flex;gap:16px;margin-top:22px;justify-content:center;font-family:var(--f-mono);font-size:11px;color:var(--on-ink-dim);flex-wrap:wrap">'+
      '<span>Season series: '+esc(CG.TEAM[g.away].code)+' '+h2h.away+' — '+h2h.home+' '+esc(CG.TEAM[g.home].code)+'</span>'+
      (g.feature?'<span style="color:var(--chrome)">MARQUEE GAME</span>':"")+'</div>'+
    '</div></div></section>';
  var body = '<div class="shell" style="padding:6px 0 40px">';
  if (res){
    /* FINAL: box score + stars */
    var starsBlurb = (CG.CONTENT.awards.threeStars.find(function(t){ return t.gameId===id; })||{}).blurb;
    body += '<div class="grid g23" style="align-items:start"><div>';
    /* a box line can outlive its roster spot (players released after the pre-season,
       unlinked EA accounts) — fall back to the name the EA record carried */
    function boxPlayer(pid, code, b){
      return CG.playerById(lg, pid) || { id:null, tag:(b&&b.name)||"Former roster player", pos:(b&&b.pos)||"", team:code };
    }
    /* Rule 8.3: no more than four appearances per player in one series — flag a 5th */
    var seriesKey = [g.home,g.away].sort().join("~");
    var seriesGames = g.stage==="playoff" ? lg.schedule.filter(function(x){
      return x.stage==="playoff" && (x.week||1)===(g.week||1)
        && [x.home,x.away].sort().join("~")===seriesKey && x.at<=g.at; }) : [];
    function capFlag(pid){
      if (g.stage!=="playoff") return "";
      var n=0; seriesGames.forEach(function(x){
        var r2=(lg.allResults||[]).find(function(q){ return q.id===x.id; });
        if (r2 && ((r2.box[x.home]&&r2.box[x.home][pid])||(r2.box[x.away]&&r2.box[x.away][pid]))) n++;
      });
      return n>4 ? ' <span class="chip chip-loss" style="font-size:9px" title="More than four appearances in this series — an ineligible-player forfeit under Rule 8.3">5TH GAME</span>' : "";
    }
    [g.away, g.home].forEach(function(code){
      var box = res.box[code];
      var sk = Object.keys(box).filter(function(pid){ return !box[pid].goalie; }).map(function(pid){ return { p: boxPlayer(pid, code, box[pid]), b: box[pid], pid: pid }; })
        .sort(function(a,b){ return (b.b.g+b.b.a)-(a.b.g+a.b.a); });
      var gl = Object.keys(box).filter(function(pid){ return box[pid].goalie; }).map(function(pid){ return { p: boxPlayer(pid, code, box[pid]), b: box[pid], pid: pid }; })[0];
      body += '<div class="card" style="margin-bottom:18px"><div class="card-h"><h3><span style="display:inline-flex;align-items:center;gap:9px">'+CG.crest(code,22)+esc(CG.TEAM[code].name)+' — '+res.score[code]+'</span></h3></div>'+
        '<div class="tblwrap"><table class="tbl keepcols"><thead><tr><th class="tleft">Skater</th><th>G</th><th>A</th><th>P</th><th>S</th><th>HIT</th><th>BLK</th><th>TK</th><th>GV</th><th>PIM</th><th>+/-</th><th>TOI</th></tr></thead><tbody>'+
        sk.map(function(row){ var b=row.b;
          return '<tr'+(row.p.id?' class="rowlink" data-go="'+CG.playerRoute(row.p)+'"':'')+'><td class="tleft"><span class="playercell"><span class="nm">'+esc(row.p.tag)+'</span><small>'+esc(row.p.pos||"")+'</small>'+capFlag(row.pid)+'</span></td>'+
          '<td class="'+(b.g?"":"z")+'">'+b.g+'</td><td class="'+(b.a?"":"z")+'">'+b.a+'</td><td class="pts">'+(b.g+b.a)+'</td><td>'+b.shots+'</td>'+
          '<td class="'+(b.hits?"":"z")+'">'+b.hits+'</td><td class="'+(b.blk?"":"z")+'">'+b.blk+'</td><td class="'+(b.tk?"":"z")+'">'+(b.tk||0)+'</td><td class="'+(b.gv?"":"z")+'">'+(b.gv||0)+'</td>'+
          '<td class="'+(b.pim?"":"z")+'">'+b.pim+'</td><td>'+(b.pm>0?"+":"")+b.pm+'</td><td class="mono" style="font-size:11px">'+(b.toi?CG.fmtToi(b.toi):"—")+'</td></tr>';
        }).join("")+
        (gl?'<tr><td class="tleft" style="font-family:var(--f-mono);font-size:11px;color:var(--steel)">G: '+esc(gl.p.tag)+capFlag(gl.pid)+'</td><td colspan="11" class="tleft" style="font-family:var(--f-mono);font-size:11px;color:var(--steel)">'+gl.b.sv+'/'+gl.b.sa+' saves'+(gl.b.sa?" ("+(gl.b.sv/gl.b.sa).toFixed(3).replace(/^0/,"")+")":"")+' · '+gl.b.ga+' GA'+(gl.b.so?" · SHUTOUT":"")+((gl.b.brkShots||gl.b.pokes)?' · '+(gl.b.brkSv||0)+'/'+(gl.b.brkShots||0)+' brk · '+(gl.b.pokes||0)+' poke':"")+(gl.b.toi?' · '+CG.fmtToi(gl.b.toi):"")+'</td></tr>':"")+
        '</tbody></table></div></div>';
    });
    body += '</div><div class="stack">'+
      '<div class="card"><div class="card-h"><h3>Three Stars</h3><span class="chip chip-chrome">Official</span></div><div class="card-b"><div class="stack" style="gap:10px">'+
      res.stars.map(function(st,i){
        var b = res.box[st.team][st.pid];
        var p = boxPlayer(st.pid, st.team, b);
        return '<div class="starcard"'+(p.id?' data-go="'+CG.playerRoute(p)+'" role="link" tabindex="0"':'')+'><span class="st-k">'+["1st star","2nd star","3rd star"][i]+'</span>'+
          '<div style="display:flex;gap:10px;align-items:center;margin-top:4px">'+CG.crest(p.team,28)+'<div><b style="font-family:var(--f-disp)">'+esc(p.tag)+'</b>'+
          '<span class="caption" style="display:block">'+(b.goalie? b.sv+" saves" : b.g+"G "+b.a+"A")+'</span></div></div></div>';
      }).join("")+'</div>'+(starsBlurb?'<p class="caption" style="margin-top:12px">'+esc(starsBlurb)+'</p>':"")+'</div></div>'+
    '</div></div>';
  } else {
    /* PREVIEW: server, code, lineups */
    var released = now >= g.at - 30*60000;
    var lineupsOut = now >= g.at - 60*60000;
    var canCode = CG.can("codes.view") && (CG.role()==="staff"||CG.role()==="commish"|| (CG.me() && (CG.me().team===g.home||CG.me().team===g.away)));
    var codeBox;
    if (CG.role()==="guest"){
      codeBox = '<div class="codebox locked"><span class="lock">'+CG.ic("lock",14)+'Private game code</span><div class="cb-code">Sign in to view</div>'+
        '<a class="btn btn-chrome btn-sm" href="#/signin" style="margin-top:10px">Sign in</a></div>';
    } else if (!canCode){
      codeBox = '<div class="codebox locked"><span class="lock">'+CG.ic("lock",14)+'Private game code</span><div class="cb-code">Restricted to the two clubs</div>'+
        '<p class="caption" style="margin-top:8px;color:var(--on-ink-dim)">Codes are visible only to rostered players, management, staff, and the commissioner (Rule 4.2).</p></div>';
    } else if (!released){
      codeBox = '<div class="codebox locked"><span class="lock">'+CG.ic("clock",14)+'Code releases at T-30</span><div class="cb-code">'+CG.fmtTime(g.at-30*60000)+'</div>'+
        '<p class="caption" style="margin-top:8px;color:var(--on-ink-dim)">Automatic release 30 minutes before puck drop. Never share codes publicly (Rule 4.2).</p></div>';
    } else {
      codeBox = '<div class="codebox"><span class="lock" style="color:var(--chrome)">'+CG.ic("code",14)+'Private game code · live</span><div class="cb-code">'+CG.gameCode(g.id)+'</div>'+
        '<p class="caption" style="margin-top:8px;color:var(--on-ink-dim)">Released '+CG.fmtTime(g.at-30*60000)+' · visible to rostered players and staff only.</p></div>';
    }
    body += '<div class="grid g23" style="align-items:start"><div class="stack">';
    /* lineups */
    body += '<div class="card"><div class="card-h"><h3>Confirmed lineups</h3>'+
      '<span class="chip">'+(lineupsOut?"Released "+CG.fmtTime(g.at-60*60000):"Release at "+CG.fmtTime(g.at-60*60000))+'</span></div>';
    if (lineupsOut){
      body += '<div class="grid g2" style="gap:0" id="muLineups">'+[g.away,g.home].map(function(code){
        var slots = CG.plannedLineup(g, code);
        var anyone = ["LW","C","RW","LD","RD","G"].some(function(pos){ return slots[pos] && CG.playerById(lg, slots[pos]); });
        return '<div class="card-b" style="border-top:1px solid var(--line-soft)"><span class="teamcell" style="margin-bottom:12px">'+CG.crest(code,26)+'<span class="nm">'+esc(CG.TEAM[code].name)+'</span></span>'+
          (anyone ? ["LW","C","RW","LD","RD","G"].map(function(pos){
            var p = slots[pos] && CG.playerById(lg, slots[pos]);
            return '<div style="display:flex;gap:10px;align-items:center;padding:7px 0;border-top:1px solid var(--line-soft)">'+
              '<span class="mono" style="font-size:10px;color:var(--steel);width:26px">'+pos+'</span>'+
              (p ? '<b style="font-size:13.5px;cursor:pointer" data-go="'+CG.playerRoute(p)+'">'+esc(p.tag)+'</b>'+
                   '<span class="ovrbox mid" style="min-width:30px;height:20px;font-size:11px;margin-left:auto">'+lg.ratings[p.id].ovr+'</span>'
                 : '<span class="caption">TBD</span>')+'</div>';
          }).join("") : '<p class="caption" style="padding:12px 0">Lineup not submitted yet.</p>')+'</div>';
      }).join("")+'</div>';
    } else {
      body += '<div class="empty"><div class="e-art">'+CG.ic("lock",20)+'</div><b>Lineups are sealed</b><p>Both lineups release simultaneously 60 minutes before puck drop — neither club sees the other’s sheet early.</p></div>';
    }
    body += '</div>';
    /* team leaders comparison */
    body += '<div class="card"><div class="card-h"><h3>Players to watch</h3></div><div class="grid g2" style="gap:0">'+
      [g.away,g.home].map(function(code){
        var top = lg.byTeam[code].filter(function(p){ return p.pos!=="G"; }).sort(function(a,b){ return lg.pstats[b.id].p-lg.pstats[a.id].p; }).slice(0,3);
        return '<div style="border-top:1px solid var(--line-soft)">'+top.map(function(p,i){
          var s = lg.pstats[p.id];
          return '<div class="leaderrow'+(i===0?" top":"")+'" data-go="'+CG.playerRoute(p)+'"><span class="rk num">'+(i+1)+'</span>'+CG.crest(code,26)+
            '<span style="min-width:0"><b style="font-size:13.5px">'+esc(p.tag)+'</b></span><span class="val"><b class="num">'+s.p+'</b><span>'+s.g+'G '+s.a+'A</span></span></div>';
        }).join("")+'</div>';
      }).join("")+'</div></div>';
    if (g.feature){
      var mh = CG.lg.teams[g.home], ma = CG.lg.teams[g.away];
      body += '<div class="card"><div class="card-h"><h3>Matchup preview</h3><span class="chip chip-chrome">Marquee</span></div><div class="card-b"><p class="small" style="color:var(--steel);line-height:1.7">'+
        esc(CG.TEAM[g.away].name)+' ('+ma.w+'-'+ma.l+'-'+ma.otl+') visit '+esc(CG.TEAM[g.home].name)+' ('+mh.w+'-'+mh.l+'-'+mh.otl+') in tonight’s marquee matchup. Lineups release an hour before puck drop; the private lobby code goes live for rostered players 30 minutes out.</p></div></div>';
    }
    body += '</div><div class="stack">'+codeBox+
      '<div class="card"><div class="card-h"><h3>Lobby settings</h3><span class="chip">League standard</span></div><div class="card-b" style="padding-top:10px">'+
        [["Server", g.server ? esc(g.server) : "Set at T-30 from the clubs’ picks"],
         ["Mode","EASHL 6v6 · Club Private"],
         ["Grudge Match","Off"],
         ["Allow Replay Skips","On"],
         ["Periods","3 × 5:00"],
         ["Overtime","3v3 · 5:00, then SO (v1.2)"],
         ["Host","Home club creates lobby"],
         ["Streaming", g.stage==="playoff" ? "Required — at least one stream per club" : "Optional in the regular season"]].map(function(kv){
          return '<div style="display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px solid var(--line-soft);font-size:13px"><span style="color:var(--steel)">'+kv[0]+'</span><b style="text-align:right">'+kv[1]+'</b></div>';
        }).join("")+
        '<p class="caption" style="margin-top:10px">The server resolves from both clubs’ private picks 30 minutes before the night’s first puck drop — home names two choices, away holds a veto. Playoff games require at least one stream per club.'+
        (g.stage==="playoff" ? ' Playoff rosters: dressed players need '+Math.round((CG.PLAYOFF_MIN_PCT||0.3)*100)+'% of the regular season played, and nobody may appear in more than four games of this series (Rule 8.3).' : '')+
        ' <a href="#/rulebook?rule=4.1" style="border-bottom:2px solid var(--chrome);font-weight:600">Rule 4 →</a></p></div></div>'+
      '<div class="card"><div class="card-h"><h3>Broadcast</h3>'+(g.feature?'<span class="chip chip-live"><span class="live-dot"></span>Twitch flag armed</span>':"")+'</div>'+
      '<div class="card-b"><p class="small" style="color:var(--steel)">'+(g.feature?"Tonight’s marquee stream goes live 15 minutes before puck drop on the league channel. Twitch sync flags this card LIVE automatically the moment a rostered player starts streaming.":"No league stream scheduled — if a rostered player goes live on Twitch, this card flags LIVE automatically (5-minute sync).")+'</p>'+
      (g.feature?'<button class="btn btn-ghost btn-sm" style="margin-top:12px" data-toast="Stream links activate at puck drop">'+CG.ic("play",14)+'Watch page</button>':"")+'</div></div>'+
    '</div></div>';
  }
  return hero + body + '</div>';
};
CG.AFTER.matchup = function(id){
  var g = CG.lg.schedule.find(function(x){ return x.id===id; });
  var el = $("#mxCount");
  if (el && g){
    function tick(){
      var ms = g.at - CG.now();
      if (ms<=0){ el.textContent = "LIVE"; return; }
      var h = Math.floor(ms/3600000), m = Math.floor(ms%3600000/60000), s = Math.floor(ms%60000/1000);
      el.textContent = (h?h+":":"")+String(m).padStart(2,"0")+":"+String(s).padStart(2,"0");
    }
    tick();
    var iv = setInterval(function(){ if (!document.body.contains(el)){ clearInterval(iv); return; } tick(); }, 1000);
  }
};

/* ---------- SIGN IN (Discord-first, with auto-join — same flow as the live site) ---------- */
CG.ROUTES.signin = function(){
  return '<section class="sec"><div class="shell" style="max-width:900px">'+
    '<div style="text-align:center;margin-bottom:30px"><span class="eyebrow chr">One account for everything</span>'+
    '<h1 class="h-page" style="margin-top:10px">Sign in with Discord</h1>'+
    '<p class="lede" style="margin:12px auto 0">Your Discord account is your league account. Not in the Chel Gaming server yet? Signing in <b>adds you to our Discord automatically</b> and signs you into the site in one step.</p>'+
    '<button class="btn btn-lg" id="dcSignIn" style="margin-top:22px;background:#5865F2;color:#fff">'+CG.DISCORD_GLYPH+'Sign in with Discord</button>'+
    '<p class="caption" style="margin-top:12px">Scopes: identify · guilds.join — exactly what the live site requests. The prototype simulates the OAuth handshake.</p></div>'+
    '<div style="display:flex;align-items:center;gap:14px;margin:26px 0"><span style="flex:1;height:1px;background:var(--line)"></span>'+
    '<span class="eyebrow">or jump straight to a demo seat</span><span style="flex:1;height:1px;background:var(--line)"></span></div>'+
    '<div class="grid g2">'+
    Object.keys(CG.PERSONAS).filter(function(k){ return k!=="guest"; }).map(function(k){
      var p = CG.PERSONAS[k];
      var desc = { member:"Submit availability, see your lineup status and game codes, file complaints, track your own cases.",
        mgmt:"Everything a member gets, plus the team availability grid, the lineup builder, and club transaction tools.",
        staff:"Modular staff seat with two grants: complaints review and stats entry. Nothing else unlocks.",
        commish:"The whole league: results, codes, ratings, rankings, awards, newsroom, homepage, rulebook, audit log." }[k];
      return '<button class="card raise" data-role-pick="'+k+'" style="text-align:left;cursor:pointer"><div class="card-b" style="display:flex;gap:16px;align-items:flex-start">'+
        '<span class="avatar" style="flex-shrink:0">'+CG.avatarHtml(k)+'</span>'+
        '<span><b style="font-family:var(--f-disp);font-size:17px;display:block">'+p.label+'</b>'+
        '<span class="caption">'+esc(p.who)+'</span><p class="small" style="color:var(--steel);margin-top:8px">'+desc+'</p></span>'+
        '<span style="margin-left:auto;color:var(--chrome-deep)">'+CG.ic("arrow",18)+'</span></div></button>';
    }).join("")+'</div>'+
    '<div class="note" style="margin-top:22px;text-align:center">Or continue as a <button style="font-weight:700;border-bottom:2px solid var(--chrome);cursor:pointer" data-role-pick="guest">signed-out guest</button> to see the public league site only. You can switch seats any time from the yellow strip at the very top.</div>'+
  '</div></section>';
};
CG.AFTER.signin = function(){
  $$("[data-role-pick]").forEach(function(b){
    b.addEventListener("click", function(){
      var r = this.getAttribute("data-role-pick");
      CG.setRole(r);
      location.hash = r==="commish" ? "#/admin" : (r==="guest" ? "#/home" : "#/hub");
    });
  });
  var dc = $("#dcSignIn");
  if (dc) dc.addEventListener("click", function(){
    var wasMember = !!CG.store.get("prefs").dcMember;
    CG.modal("Discord — authorize Chel Gaming",
      '<div style="border:1.5px solid var(--line);border-radius:12px;padding:18px;background:var(--ice)">'+
        '<div style="display:flex;gap:12px;align-items:center">'+
          '<span style="width:44px;height:44px;border-radius:12px;background:#5865F2;color:#fff;display:grid;place-items:center">'+CG.DISCORD_GLYPH+'</span>'+
          '<div><b style="font-family:var(--f-disp)">Chel Gaming Hockey League</b>'+
          '<span class="caption" style="display:block">wants to access your Discord account</span></div></div>'+
        '<div style="margin-top:14px;border-top:1px solid var(--line);padding-top:12px">'+
          '<div style="display:flex;gap:9px;padding:5px 0;font-size:13.5px">'+CG.ic("check",15)+'Access your username and avatar <span class="mono caption" style="margin-left:auto">identify</span></div>'+
          '<div style="display:flex;gap:9px;padding:5px 0;font-size:13.5px">'+CG.ic("check",15)+'Join servers for you <span class="mono caption" style="margin-left:auto">guilds.join</span></div>'+
        '</div></div>'+
      '<div id="dcSteps" style="margin-top:14px"></div>',
      '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn" id="dcAuth" style="background:#5865F2;color:#fff">Authorize</button>');
    $("#dcAuth").addEventListener("click", function(){
      this.disabled = true; this.textContent = "Authorized ✓";
      var steps = $("#dcSteps");
      function line(html){ var d=document.createElement("div"); d.className="note"; d.style.marginTop="8px"; d.innerHTML=html; steps.appendChild(d); return d; }
      var l1 = line('<span class="lock">'+CG.ic("clock",13)+'Checking Chel Gaming server membership…</span>');
      setTimeout(function(){
        if (wasMember){
          l1.className = "note grn";
          l1.innerHTML = '<b style="font-family:var(--f-disp)">Already in the server ✓</b> — welcome back.';
        } else {
          l1.className = "note grn";
          l1.innerHTML = '<b style="font-family:var(--f-disp)">You weren’t in the Chel Gaming Discord — we added you automatically ✓</b>'+
            '<p class="small" style="margin-top:6px;color:var(--steel)">Same as the live site: your OAuth token carries guilds.join, so the league bot adds you to the server, flags your profile as in-guild, and the welcome bot greets you in #welcome within 5 minutes.</p>';
          var prefs = CG.store.get("prefs"); prefs.dcMember = true; CG.store.set("prefs", prefs);
        }
        setTimeout(function(){
          line('<b style="font-family:var(--f-disp)">Signed in.</b> Pick which league profile this demo account maps to:'+
            '<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">'+
            ["member","mgmt","staff","commish"].map(function(k){
              return '<button class="btn btn-ghost btn-sm" data-dc-seat="'+k+'">'+CG.PERSONAS[k].label+'</button>'; }).join("")+'</div>');
          $$("[data-dc-seat]").forEach(function(sb){
            sb.addEventListener("click", function(){
              var r = this.getAttribute("data-dc-seat");
              CG.closeOverlay();
              CG.setRole(r);
              if (!wasMember) CG.pushNotif("msg","Welcome to the Chel Gaming Discord","You were added during sign-in — say hey in #welcome.","#/hub/notifications");
              CG.renderChrome();
              location.hash = r==="commish" ? "#/admin" : "#/hub";
            });
          });
        }, 700);
      }, 900);
    });
  });
};

/* ---------- 404 ---------- */
CG.ROUTES._404 = function(){
  return '<section class="sec"><div class="shell"><div class="empty" style="padding:80px 20px">'+
    '<div class="e-art">'+CG.ic("search",22)+'</div><b>Icing — nothing at this address</b>'+
    '<p>There’s no page at this address. Try the navigation above or head back to the front page.</p>'+
    '<a class="btn btn-ink" href="#/home" style="margin-top:18px">Back to the front page</a></div></div></section>';
};

/* toast helper for demo-only buttons */
document.addEventListener("click", function(e){
  var t = e.target.closest("[data-toast]");
  if (t) CG.toast(t.getAttribute("data-toast"));
});
