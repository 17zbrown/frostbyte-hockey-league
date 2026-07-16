/* ================================================================
   COMMISSIONER CONTROL CENTER
   ================================================================ */

CG.ADMIN_NAV = [
  ["Operations", [["","Overview","home"],["results","Results entry","chart"],["codes","Game codes","code"],["presets","Server presets","gear"],["schedule","Schedule","cal"]]],
  ["League",     [["seasons","Seasons","db"],["users","Users & roles","users"],["ratings","Overall ratings","chart"],["rankings","Power rankings","up"],["awards","Awards","trophy"],["complaints","Complaints","flag"]]],
  ["Content",    [["news","Newsroom","doc"],["homepage","Homepage","grid"],["carousel","Hero carousel","film"],["media","Media library","ul"],["rulebook","Rulebook","doc"]]],
  ["System",     [["automations","Automations","clock"],["data","Import / export","db"],["audit","Audit log","eye"],["settings","Site settings","gear"]]]
];
CG.adminShell = function(section, inner){
  var side = '<nav class="hub-side" aria-label="Control center">'+CG.ADMIN_NAV.map(function(grp){
    return '<div class="hs-group">'+grp[0]+'</div>'+grp[1].map(function(it){
      return '<a href="#/admin'+(it[0]?"/"+it[0]:"")+'" class="'+(section===it[0]?"on":"")+'">'+CG.ic(it[2],15)+it[1]+'</a>';
    }).join("");
  }).join("")+'</nav>';
  var who = CG.LIVE_MODE ? ((CG.persona()||{}).tag || "Commissioner") : "zackbrown17";
  var notice = CG.LIVE_MODE
    ? '<div class="note chr" style="margin-bottom:18px;display:flex;gap:10px;align-items:flex-start">'+CG.ic("clock",15)+'<span><b style="font-family:var(--f-disp)">Live:</b> Pre-season (registrations, signings, scouting, owner apps), the <b>draft</b>, <b>Users &amp; roles</b>, <b>trades</b>, <b>leagues &amp; tiers</b>, and <b>EA stats</b> (scores + box scores import automatically) all run on the database. Formal discipline (suspensions) is being finalized.</span></div>'
    : "";
  return '<section class="sec-tight"><div class="shell"><div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:20px">'+
    '<div><span class="eyebrow chr">Control center · Season 1</span><h1 class="h-sec" style="margin-top:6px">League operating system</h1></div>'+
    '<span class="chip chip-ink">Signed in as '+esc(who)+' · Commissioner</span></div>'+
    notice+'<div class="hub-grid">'+side+'<div>'+inner+'</div></div></div></section>';
};
CG.ROUTES.admin = function(param, qs){
  if (CG.role()!=="commish") return CG.unauthorized("The Control Center is commissioner-only. Every route in it is permission-checked — switch to the Commissioner seat to explore.");
  var s = param||"";
  var pages = { "":CG.admOverview, results:CG.admResults, codes:CG.admCodes, presets:CG.admPresets,
    schedule:CG.admSchedule, seasons:CG.admSeasons, users:CG.admUsers, ratings:CG.admRatings,
    rankings:CG.admRankings, awards:CG.admAwards, complaints:CG.admComplaints, news:CG.admNews,
    homepage:CG.admHomepage, carousel:CG.admCarousel, media:CG.admMedia, rulebook:CG.admRulebook,
    automations:CG.admAutomations, data:CG.admData, audit:CG.admAudit, settings:CG.admSettings };
  var fn = pages[s];
  if (!fn) return CG.ROUTES._404();
  return CG.adminShell(s, fn(qs||{}));
};

/* ---------- overview ---------- */
CG.admOverview = function(){
  var lg = CG.lg;
  var missingResults = lg.schedule.filter(function(g){ return g.at < CG.now()-90*60000 && !lg.results.some(function(r){ return r.id===g.id; }); }).length;
  var lineupsIn = Object.keys(CG.store.get("lineups")||{}).filter(function(k){ return (CG.store.get("lineups")[k].status)==="submitted"; }).length;
  var teamsTonight = lg.tonight.length*2;
  var noResp = lg.players.filter(function(p){ var a=CG.avFor(p.id); return a.nights.n1.st==="nr"&&a.nights.n2.st==="nr"; }).length;
  var pending = CG.visibleComplaints().filter(function(c){ return c.status!=="Resolved"; }).length;
  var codesLive = lg.tonight.filter(function(g){ return CG.now()>=g.at-30*60000; }).length;
  var kpis = [
    [lg.tonight.length+"", "Games tonight", "#/admin/schedule", false],
    [codesLive+"/"+lg.tonight.length, "Codes released", "#/admin/codes", false],
    [missingResults+"", "Games missing results", "#/admin/results", missingResults>0],
    [(teamsTonight-lineupsIn)+"", "Lineups not submitted", "#/admin/schedule", teamsTonight-lineupsIn>0],
    [noResp+"", "No "+CG.WEEK8.label+" availability", "#/admin/users", noResp>0],
    [pending+"", "Open complaint cases", "#/admin/complaints", pending>0],
    ["1", "Award slate pending (Wk 7)", "#/admin/awards", false],
    [(CG.store.get("audit")||[]).length+"", "Audit entries this session", "#/admin/audit", false]
  ];
  var acts = (CG.store.get("audit")||[]).slice(0,6);
  return '<div class="grid g4" style="grid-template-columns:repeat(auto-fill,minmax(200px,1fr))">'+
    kpis.map(function(k){ return '<div class="kpi'+(k[3]?" alert":"")+'" data-go="'+k[2]+'" role="link" tabindex="0"><b class="num">'+k[0]+'</b><span>'+k[1]+'</span></div>'; }).join("")+'</div>'+
    '<div class="grid g2" style="margin-top:20px;align-items:start">'+
    '<div class="card"><div class="card-h"><h3>Tonight, minute by minute</h3></div><div class="tasklist">'+
      lg.tonight.map(function(g){
        var released = CG.now()>=g.at-30*60000;
        return '<div class="titem"><span class="t-dot'+(released?" grn":"")+'"></span><span style="flex:1"><b>'+CG.TEAM[g.away].code+' @ '+CG.TEAM[g.home].code+'</b> — '+CG.fmtTime(g.at)+
          (released?" · code live":" · code at "+CG.fmtTime(g.at-30*60000))+'</span><a class="btn btn-ghost btn-sm" href="#/matchup/'+g.id+'">Game page</a></div>';
      }).join("")+
      '<div class="titem"><span class="t-dot"></span><span style="flex:1">Enter finals right after each game — standings, stats, and ratings update instantly.</span><a class="btn btn-ghost btn-sm" href="#/admin/results">Results</a></div>'+
    '</div></div>'+
    '<div class="card"><div class="card-h"><h3>Recent staff activity</h3><a class="sec-link" href="#/admin/audit">Full log</a></div>'+
      (acts.length?acts.map(function(a){
        return '<div class="notif" style="cursor:default"><span class="nf-ic">'+CG.ic("eye",14)+'</span><span style="min-width:0"><b>'+esc(a.action)+'</b><p>'+esc(a.who)+(a.detail?" · "+esc(a.detail):"")+'</p></span><span class="nf-t">'+CG.fmtTime(a.at)+'</span></div>';
      }).join(""):'<div class="empty"><b>No session activity yet</b><p>Every commissioner and staff action in this demo is written to the audit log.</p></div>')+'</div></div>';
};

/* ---------- results entry ---------- */
CG.admResults = function(){
  var lg = CG.lg;
  var enterable = lg.schedule.filter(function(g){ return !lg.results.some(function(r){ return r.id===g.id; }) && g.at <= CG.now()+4*3600000; });
  var recent = lg.results.slice(-6).reverse();
  return '<div class="note chr" style="margin-bottom:18px"><b style="font-family:var(--f-disp)">This is live.</b> Enter a final for one of tonight’s games and watch the standings, leaders, and power rankings shift everywhere on the site. The engine synthesizes a legal box score around your score line.</div>'+
    (enterable.length?'<div class="card" style="margin-bottom:18px"><div class="card-h"><h3>AI box-score import</h3><span class="chip chip-chrome">Gemini → Groq</span></div>'+
    '<div class="card-b"><p class="small" style="color:var(--steel)">Drop the EA end-of-game screenshots and the vision model reads the final and both box scores for you — same flow as the live site. The prototype simulates the parse; production calls the real models.</p>'+
    '<div style="display:flex;gap:10px;margin-top:12px;flex-wrap:wrap;align-items:center">'+
    '<select id="aiGame" aria-label="Game to import" style="max-width:280px">'+enterable.map(function(g){
      return '<option value="'+g.id+'">'+CG.TEAM[g.away].code+' @ '+CG.TEAM[g.home].code+' — '+CG.fmtDay(g.at)+'</option>'; }).join("")+'</select>'+
    '<label class="btn btn-ghost btn-sm" style="cursor:pointer">'+CG.ic("ul",14)+'Upload screenshots<input type="file" id="aiShots" accept="image/*" multiple hidden></label>'+
    '</div><div id="aiOut"></div></div></div>':"")+
    '<div class="card"><div class="card-h"><h3>Awaiting results</h3><span class="chip">'+enterable.length+' games</span></div>'+
    (enterable.length?enterable.map(function(g){
      return '<div class="notif" style="cursor:default"><span class="nf-ic">'+CG.ic("chart",15)+'</span>'+
        '<span style="min-width:0"><b>'+esc(CG.TEAM[g.away].name)+' @ '+esc(CG.TEAM[g.home].name)+'</b><p>Week '+g.week+' · '+CG.fmtFull(g.at)+'</p></span>'+
        '<button class="btn btn-chrome btn-sm" data-enter="'+g.id+'" style="flex-shrink:0">Enter final</button></div>';
    }).join(""):'<div class="empty"><b>Nothing waiting</b><p>Every playable game has a recorded result.</p></div>')+'</div>'+
    '<div class="card" style="margin-top:18px"><div class="card-h"><h3>Recent finals</h3><span class="chip">Verified</span></div>'+
    recent.map(function(r){
      return '<div class="notif" data-go="#/matchup/'+r.id+'"><span class="nf-ic">'+CG.ic("check",14)+'</span>'+
        '<span style="min-width:0"><b>'+CG.TEAM[r.home].code+' '+r.score[r.home]+'–'+r.score[r.away]+' '+CG.TEAM[r.away].code+(r.ot?" (OT)":"")+'</b>'+
        '<p>Week '+r.week+(r.entered?" · entered this session":"")+'</p></span></div>';
    }).join("")+'</div>';
};
CG.AFTER._admResults = function(){
  var shots = $("#aiShots");
  if (shots) shots.addEventListener("change", function(){
    var files = this.files; if (!files.length) return;
    var gid = $("#aiGame").value;
    var g = CG.lg.schedule.find(function(x){ return x.id===gid; });
    /* simulated parse: deterministic scores from the file names */
    var seed = 0; Array.prototype.forEach.call(files, function(f){ for (var i=0;i<f.name.length;i++) seed += f.name.charCodeAt(i); });
    var rng = CG.makeRng(seed + parseInt(gid.replace(/\D/g,""),10));
    var hs = 1+Math.floor(rng()*5), as = 1+Math.floor(rng()*5);
    if (hs===as) hs++;
    $("#aiOut").innerHTML = '<div class="note grn" style="margin-top:12px"><b style="font-family:var(--f-disp)">Parsed '+files.length+' screenshot'+(files.length>1?"s":"")+' — simulated Gemini read:</b>'+
      '<p class="small" style="margin-top:6px">'+esc(CG.TEAM[g.home].name)+' '+hs+' — '+as+' '+esc(CG.TEAM[g.away].name)+' · 12 skater lines + 2 goalie lines extracted</p>'+
      '<div style="display:flex;gap:9px;margin-top:10px"><button class="btn btn-ink btn-sm" id="aiUse">Verify & post this final</button>'+
      '<span class="caption" style="align-self:center">Staff always verify before it posts (Rule 6).</span></div></div>';
    $("#aiUse").addEventListener("click", function(){
      var entries = CG.store.get("results")||[];
      entries.push({ gameId:gid, hs:hs, as:as, ot:false });
      CG.store.set("results", entries);
      CG.audit("Final posted via AI import (simulated)", CG.TEAM[g.home].code+" "+hs+"–"+as+" "+CG.TEAM[g.away].code);
      CG.boot(); CG.renderChrome();
      CG.toast("Box score imported — league recomputed","ok");
      CG.router();
    });
  });
  $$("[data-enter]").forEach(function(b){
    b.addEventListener("click", function(){
      var id = this.getAttribute("data-enter");
      var g = CG.lg.schedule.find(function(x){ return x.id===id; });
      CG.modal("Enter final — "+CG.TEAM[g.away].code+" @ "+CG.TEAM[g.home].code,
        '<div class="grid g2"><label class="fld"><span>'+esc(CG.TEAM[g.away].name)+' (away)</span><input type="number" id="rsA" min="0" max="15" value="2"></label>'+
        '<label class="fld"><span>'+esc(CG.TEAM[g.home].name)+' (home)</span><input type="number" id="rsH" min="0" max="15" value="3"></label></div>'+
        '<label class="check"><input type="checkbox" id="rsOT"><span>Decided in overtime / shootout (loser gets 1 point)</span></label>'+
        '<p class="caption" style="margin-top:10px">A legal box score is synthesized around this line: goals distributed to the confirmed lineup, goalie saves reconciled, three stars picked. In production, staff enter or import the full box.</p>',
        '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-ink" id="rsSave">Record final</button>');
      $("#rsSave").addEventListener("click", function(){
        var hs = parseInt($("#rsH").value,10), as = parseInt($("#rsA").value,10), ot = $("#rsOT").checked;
        if (isNaN(hs)||isNaN(as)||hs<0||as<0){ CG.toast("Enter both scores","err"); return; }
        if (hs===as){ CG.toast("No ties in the CGHL — check the OT box and give someone the extra goal","err"); return; }
        if (ot && Math.abs(hs-as)!==1){ CG.toast("OT finals must be decided by exactly one goal","err"); return; }
        var entries = CG.store.get("results")||[];
        entries.push({ gameId:id, hs:hs, as:as, ot:ot });
        CG.store.set("results", entries);
        CG.audit("Final recorded", CG.TEAM[g.home].code+" "+hs+"–"+as+" "+CG.TEAM[g.away].code+(ot?" OT":""));
        CG.boot();               /* recompute the entire league */
        CG.renderChrome();
        CG.closeOverlay();
        CG.toast("Final recorded — standings and stats recomputed league-wide","ok");
        CG.router();
      });
    });
  });
};

/* ---------- game codes ---------- */
CG.admCodes = function(){
  var lg = CG.lg;
  var games = lg.schedule.filter(function(g){ return !lg.results.some(function(r){ return r.id===g.id; }); }).slice(0,8);
  return '<div class="note red" style="margin-bottom:18px"><b style="font-family:var(--f-disp)">Handle with care.</b> Codes are never exposed publicly — players see them on the matchup page only after release, and only if rostered in the game (Rule 4.2). In production they live server-side; the prototype simulates the gate client-side.</div>'+
    '<div class="card"><div class="tblwrap"><table class="tbl keepcols"><caption>Upcoming lobby codes</caption><thead><tr>'+
    '<th class="tleft">Game</th><th>Week</th><th class="tleft">Release</th><th class="tleft">Code</th><th></th></tr></thead><tbody>'+
    games.map(function(g){
      var released = CG.now()>=g.at-30*60000;
      return '<tr><td class="tleft"><b style="font-family:var(--f-disp);font-size:13px">'+CG.TEAM[g.away].code+' @ '+CG.TEAM[g.home].code+'</b><small style="display:block;color:var(--steel);font-family:var(--f-mono);font-size:10px">'+CG.fmtFull(g.at)+'</small></td>'+
      '<td>'+g.week+'</td><td class="tleft"><span class="chip '+(released?"chip-win":"")+'">'+(released?"Live":"T-30 · "+CG.fmtTime(g.at-30*60000))+'</span></td>'+
      '<td class="tleft mono" style="letter-spacing:.14em">'+CG.gameCode(g.id)+'</td>'+
      '<td><button class="btn btn-ghost btn-sm" data-regen="'+g.id+'">Regenerate</button></td></tr>';
    }).join("")+'</tbody></table></div></div>'+
    '<div class="card" style="margin-top:18px"><div class="card-h"><h3>Release policy</h3></div><div class="card-b">'+
    '<div class="grid g3"><label class="fld"><span>Code release</span><select><option>30 min before puck drop</option><option>45 min</option><option>60 min</option></select></label>'+
    '<label class="fld"><span>Lineup release</span><select><option>60 min before puck drop</option><option>45 min</option><option>30 min</option></select></label>'+
    '<label class="fld"><span>Lineup lock</span><select><option>30 min before puck drop</option><option>15 min</option></select></label></div>'+
    '<button class="btn btn-ink btn-sm" data-toast="Code release is automatic at T-30 — this policy is fixed by Rule 4.2">Save policy</button></div></div>';
};
CG.AFTER._admCodes = function(){
  $$("[data-regen]").forEach(function(b){
    b.addEventListener("click", function(){
      var id = this.getAttribute("data-regen");
      CG.confirm("Regenerate this code?","Both clubs are notified immediately and the old code stops working.","Regenerate", function(){
        CG.audit("Game code regenerated", id);
        CG.toast("New code issued — clubs notified","ok");
      });
    });
  });
};

/* ---------- server presets ---------- */
CG.admPresets = function(){
  var presets = [
    { name:"League Night", assigned:"All regular-season games", set:[["Region","NA East"],["Mode","EASHL 6v6 Private"],["Periods","3 × 5:00"],["OT","3v3 5:00 → SO"],["Host","Home club"],["Pauses","2 per club"],["Streaming","Both goalie POVs"]] },
    { name:"Playoff Standard", assigned:"Weeks 11+ (playoffs)", set:[["Region","NA East"],["Mode","EASHL 6v6 Private"],["Periods","3 × 6:00"],["OT","5v5 continuous"],["Host","Higher seed"],["Pauses","1 per club"],["Streaming","League broadcast + POVs"]] }
  ];
  return '<div class="grid g2">'+presets.map(function(p,i){
    return '<div class="card"><div class="card-h"><h3>'+p.name+'</h3><span class="chip'+(i===0?" chip-chrome":"")+'">'+(i===0?"Active default":"Scheduled")+'</span></div>'+
    '<div class="card-b" style="padding-top:8px">'+p.set.map(function(kv){
      return '<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--line-soft);font-size:13px"><span style="color:var(--steel)">'+kv[0]+'</span><b>'+kv[1]+'</b></div>';
    }).join("")+
    '<p class="caption" style="margin:10px 0 12px">Assigned to: '+p.assigned+' · last updated '+CG.fmtDate("2026-07-01")+'</p>'+
    '<div style="display:flex;gap:8px"><button class="btn btn-ghost btn-sm" data-toast="Preset editor opens with full settings in the production build">Edit preset</button>'+
    '<button class="btn btn-ghost btn-sm" data-toast="Per-game overrides are set from any matchup page (demo)">Override a game</button></div></div></div>';
  }).join("")+'</div>'+
  '<button class="btn btn-ink" style="margin-top:16px" data-toast="New presets can be cloned from an existing one (demo)">'+CG.ic("plus",15)+'New preset</button>';
};

/* ---------- schedule manager ---------- */
CG.admSchedule = function(){
  var lg = CG.lg;
  var future = lg.schedule.filter(function(g){ return !lg.results.some(function(r){ return r.id===g.id; }); });
  return '<div class="card"><div class="card-h"><h3>Remaining slate</h3><span class="chip">'+future.length+' games · weeks 7–10</span></div>'+
    future.slice(0,12).map(function(g){
      return '<div class="notif" style="cursor:default"><span class="nf-ic">'+CG.ic("cal",14)+'</span>'+
        '<span style="min-width:0"><b>'+esc(CG.TEAM[g.away].name)+' @ '+esc(CG.TEAM[g.home].name)+'</b><p>Week '+g.week+' · '+CG.fmtFull(g.at)+'</p></span>'+
        '<span style="display:flex;gap:7px;flex-shrink:0"><a class="btn btn-ghost btn-sm" href="#/matchup/'+g.id+'">Open</a>'+
        '<button class="btn btn-ghost btn-sm" data-resched="'+g.id+'">Reschedule</button></span></div>';
    }).join("")+'</div>'+
    '<div class="note" style="margin-top:16px">The production scheduler generates balanced round-robin slates per division, handles postponements with automatic make-up slots, and notifies both clubs plus staff on any change.</div>';
};
CG.AFTER._admSchedule = function(){
  $$("[data-resched]").forEach(function(b){
    b.addEventListener("click", function(){
      var id = this.getAttribute("data-resched");
      var g = CG.lg.schedule.find(function(x){ return x.id===id; });
      CG.modal("Reschedule — "+CG.TEAM[g.away].code+" @ "+CG.TEAM[g.home].code,
        '<label class="fld"><span>New date & time (ET)</span><input type="datetime-local" id="rsWhen"></label>'+
        '<label class="fld"><span>Reason (shared with both clubs)</span><input id="rsWhy" placeholder="e.g. server outage make-up"></label>',
        '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-ink" id="rsGo">Reschedule & notify</button>');
      $("#rsGo").addEventListener("click", function(){
        CG.audit("Game rescheduled", id+" — "+($("#rsWhy").value||"no reason given"));
        CG.closeOverlay(); CG.toast("Rescheduled — both clubs and staff notified","ok");
      });
    });
  });
};

/* ---------- seasons ---------- */
CG.admSeasons = function(){
  return '<div class="grid g2">'+
    '<div class="card" style="border-color:var(--ink)"><div class="card-h"><h3>Season 1 · 2026</h3><span class="chip chip-chrome">Active</span></div>'+
    '<div class="card-b"><div class="grid g2" style="gap:10px">'+
    [["Format","6v6 · 2 divisions"],["Weeks","10 + playoffs"],["Games played",CG.lg.results.length],["Clubs","8"],["Players","96"],["Points","2 W · 1 OTL"]].map(function(kv){
      return '<div class="kpi" style="cursor:default;padding:12px 14px"><b style="font-size:16px" class="num">'+kv[1]+'</b><span>'+kv[0]+'</span></div>'; }).join("")+'</div>'+
    '<div style="display:flex;gap:8px;margin-top:14px"><button class="btn btn-ghost btn-sm" data-toast="Playoff bracket setup opens once the regular season ends">Configure playoffs</button>'+
    '<button class="btn btn-ghost btn-sm" data-toast="Archiving unlocks after the Cup is awarded — records then lock read-only">Archive season</button></div></div></div>'+
    '<div class="card"><div class="card-h"><h3>Preseason · 2026</h3><span class="chip">Archived</span></div>'+
    '<div class="card-b"><p class="small" style="color:var(--steel)">Two exhibition nights used for rules calibration. Archived read-only: every player and team profile keeps its preseason stat line under the season dropdown.</p>'+
    '<button class="btn btn-ghost btn-sm" style="margin-top:12px" data-go="#/team/CBR?season=pre">Browse an archived team page</button></div></div></div>'+
    '<button class="btn btn-ink" style="margin-top:16px" data-toast="Season 2 setup opens after this season wraps">'+CG.ic("plus",15)+'Create Season 2</button>';
};

/* ---------- users & roles ---------- */
CG.admUsers = function(qs){
  var lg = CG.lg;
  var q = (qs.q||"").toLowerCase();
  var list = lg.players.filter(function(p){ return !q || p.tag.toLowerCase().indexOf(q)>=0; });
  function roleOf(p){
    if (p.tag==="TapeToTapeTee") return "GM · Circuit Breakers";
    if (p.pos==="C"&&p.depth===1) return "GM";
    if (p.pos==="RW"&&p.depth===1) return "Owner";
    if (p.pos==="LD"&&p.depth===1) return "AGM";
    return "Member";
  }
  return '<div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap">'+
    '<input type="search" id="uQ" placeholder="Search accounts…" value="'+esc(qs.q||"")+'" style="max-width:280px" aria-label="Search users">'+
    '<button class="btn btn-ghost btn-sm" data-toast="Invites send a Discord/email link that maps the account to a player profile (demo)">'+CG.ic("plus",14)+'Invite user</button>'+
    '<button class="btn btn-ghost btn-sm" data-go="#/blueprint">Permission matrix</button></div>'+
    '<div class="card"><div class="tblwrap"><table class="tbl keepcols"><caption>League accounts — all 96</caption><thead><tr>'+
    '<th class="tleft">Account</th><th class="tleft">Club</th><th class="tleft">League role</th><th class="tleft">Status</th><th></th></tr></thead><tbody>'+
    list.map(function(p){
      var sus = lg.suspensions.some(function(s){ return s.playerId===p.id && s.status!=="served"; });
      return '<tr><td class="tleft"><span class="playercell">'+CG.crest(p.team,20)+'<span><span class="nm">'+esc(p.tag)+'</span><small>'+esc(p.eaId)+'</small></span></span></td>'+
      '<td class="tleft" style="font-size:12px">'+esc(CG.TEAM[p.team].name)+'</td>'+
      '<td class="tleft"><span class="chip'+(roleOf(p)!=="Member"?" chip-chrome":"")+'">'+roleOf(p)+'</span></td>'+
      '<td class="tleft"><span class="chip '+(sus?"chip-loss":"chip-win")+'">'+(sus?"Suspended":"Active")+'</span></td>'+
      '<td><button class="btn btn-ghost btn-sm" data-user="'+p.id+'">Manage</button></td></tr>';
    }).join("")+'</tbody></table></div></div>'+
    '<div class="note" style="margin-top:16px">Staff seats are modular: RefCam_Official holds <b>complaints.review</b> + <b>stats.enter</b> and nothing else. Grants are enforced server-side in production — role names are just labels over the permission matrix.</div>';
};
CG.AFTER._admUsers = function(qs){
  var u = $("#uQ");
  if (u){
    var filterRows = function(){
      var q = u.value.trim().toLowerCase();
      $$("#app table tbody tr").forEach(function(tr){
        tr.style.display = (!q || tr.textContent.toLowerCase().indexOf(q)>=0) ? "" : "none";
      });
    };
    u.addEventListener("input", function(){ if (!this.dataset.acId) filterRows(); });
    CG.attachAC(u, { kinds:["players"], onPick: filterRows, onClear: filterRows });
  }
  $$("[data-user]").forEach(function(b){
    b.addEventListener("click", function(){
      var p = CG.playerById(CG.lg, this.getAttribute("data-user"));
      CG.modal("Manage account — "+p.tag,
        '<label class="fld"><span>League role</span><select id="urRole">'+["Member","Captain","AGM","GM","Owner","League staff","Commissioner"].map(function(r){ return "<option>"+r+"</option>"; }).join("")+'</select></label>'+
        '<label class="fld"><span>Staff grants (if staff)</span><div class="radio-cards">'+["Scheduler","Statistician","Complaints","News editor","Awards voter","Rulebook editor"].map(function(g){
          return '<label><input type="checkbox">'+g+'</label>'; }).join("")+'</div></label>'+
        '<label class="check"><input type="checkbox" id="urSusp"><span>Suspend this account (site access + roster lock)</span></label>',
        '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-ink" id="urSave">Save changes</button>');
      $("#urSave").addEventListener("click", function(){
        CG.audit("Account updated", p.tag+" → "+$("#urRole").value+($("#urSusp").checked?" (suspended)":""));
        CG.closeOverlay(); CG.toast(p.tag+" updated — change logged to audit","ok");
      });
    });
  });
};

/* ---------- ratings config ---------- */
CG.admRatings = function(){
  var W = (CG.store.get("weights")||CG.DEFAULT_WEIGHTS).skater;
  var top = CG.skaterLeaders(CG.lg,"p").slice(0,8);
  return '<div class="note chr" style="margin-bottom:18px"><b style="font-family:var(--f-disp)">The formula is the product.</b> Overall ratings are computed from real box scores — never hand-typed. Drag the weights and preview the effect, then publish. Small samples regress toward the league average automatically.</div>'+
    '<div class="grid g2" style="align-items:start"><div class="card"><div class="card-h"><h3>Skater weights</h3><span class="chip">Sum ≈ 100</span></div><div class="card-b">'+
    Object.keys(W).map(function(k){
      return '<label class="fld"><span>'+k+' — <b class="num" id="wv_'+k+'">'+W[k]+'</b></span>'+
        '<input type="range" min="0" max="60" value="'+W[k]+'" data-w="'+k+'" style="padding:0;accent-color:var(--ink)"></label>';
    }).join("")+
    '<div style="display:flex;gap:9px;margin-top:6px"><button class="btn btn-ink btn-sm" id="wSave">Recalculate & publish</button>'+
    '<button class="btn btn-ghost btn-sm" id="wReset">Reset defaults</button></div>'+
    '<p class="caption" style="margin-top:12px">Manual per-player adjustments require a written reason and land in the audit log. Goaltender and team formulas have their own tabs in production.</p></div></div>'+
    '<div class="card"><div class="card-h"><h3>Live preview — top skaters</h3><span class="chip" id="wPrev">current weights</span></div><div id="wPrevList">'+
    top.map(function(p,i){
      return '<div class="leaderrow'+(i===0?" top":"")+'"><span class="rk num">'+(i+1)+'</span>'+CG.crest(p.team,26)+
        '<span style="min-width:0"><b style="font-size:14px">'+esc(p.tag)+'</b><small class="caption" style="display:block">'+CG.lg.pstats[p.id].p+' pts</small></span>'+
        '<span class="val"><b class="num">'+CG.lg.ratings[p.id].ovr+'</b><span>OVR</span></span></div>';
    }).join("")+'</div></div></div>';
};
CG.AFTER._admRatings = function(){
  var pending = JSON.parse(JSON.stringify(CG.store.get("weights")||CG.DEFAULT_WEIGHTS));
  var tid;
  function preview(){
    var lg2 = CG.buildLeague({ weights: pending });
    var top = CG.skaterLeaders(lg2,"p").slice(0,8);
    $("#wPrevList").innerHTML = top.map(function(p,i){
      var was = CG.lg.ratings[p.id].ovr, now = lg2.ratings[p.id].ovr;
      var d = now-was;
      return '<div class="leaderrow'+(i===0?" top":"")+'"><span class="rk num">'+(i+1)+'</span>'+CG.crest(p.team,26)+
        '<span style="min-width:0"><b style="font-size:14px">'+esc(p.tag)+'</b><small class="caption" style="display:block">'+lg2.pstats[p.id].p+' pts</small></span>'+
        '<span class="val"><b class="num">'+now+'</b><span>'+(d? (d>0?"▲":"▼")+Math.abs(d):"no change")+'</span></span></div>';
    }).join("");
    $("#wPrev").textContent = "previewing new weights";
  }
  $$("[data-w]").forEach(function(sl){
    sl.addEventListener("input", function(){
      pending.skater[this.getAttribute("data-w")] = +this.value;
      $("#wv_"+this.getAttribute("data-w")).textContent = this.value;
      clearTimeout(tid); tid = setTimeout(preview, 250);
    });
  });
  $("#wSave").addEventListener("click", function(){
    CG.store.set("weights", pending);
    CG.audit("Rating weights published", Object.keys(pending.skater).map(function(k){ return k+"="+pending.skater[k]; }).join(", "));
    CG.boot(); CG.renderChrome();
    CG.toast("Ratings recalculated league-wide","ok");
    CG.router();
  });
  $("#wReset").addEventListener("click", function(){
    CG.store.set("weights", null);
    CG.audit("Rating weights reset to defaults","");
    CG.boot(); CG.renderChrome(); CG.toast("Default weights restored","ok"); CG.router();
  });
};

/* ---------- power rankings editor ---------- */
CG.admRankings = function(){
  var lg = CG.lg;
  return '<div class="note" style="margin-bottom:18px">Drafts start from team overall + form; you reorder and edit the commentary before publishing. Week 7 is live — Week 8 drafts after Sunday’s games.</div>'+
    '<div class="card"><div class="card-h"><h3>Week 7 — published '+CG.fmtDate("2026-07-13")+'</h3><span class="chip chip-win">Live on site</span></div>'+
    lg.powerRankings.map(function(pr,i){
      var e = CG.CONTENT.rankings.entries.find(function(x){ return x.code===pr.team; })||{};
      return '<div class="notif" style="cursor:default"><b class="num" style="font-family:var(--f-disp);font-size:18px;width:26px">'+pr.rank+'</b>'+
        CG.crest(pr.team,24)+'<span style="min-width:0"><b>'+esc(CG.TEAM[pr.team].name)+'</b><p>'+esc((e.comment||"").slice(0,90))+'…</p></span>'+
        '<span style="display:flex;gap:5px;flex-shrink:0">'+
        '<button class="btn btn-ghost btn-sm" data-rkmove="'+i+':-1" aria-label="Move up" '+(i===0?"disabled":"")+'>↑</button>'+
        '<button class="btn btn-ghost btn-sm" data-rkmove="'+i+':1" aria-label="Move down" '+(i===lg.powerRankings.length-1?"disabled":"")+'>↓</button>'+
        '<button class="btn btn-ghost btn-sm" data-rkedit="'+pr.team+'">Edit note</button></span></div>';
    }).join("")+'</div>'+
    '<div style="display:flex;gap:9px;margin-top:16px"><button class="btn btn-ink" data-toast="Overalls update automatically from EA box scores — no manual draft needed">Draft Week 8</button>'+
    '<a class="btn btn-ghost" href="#/rankings">View public page</a></div>';
};
CG.AFTER._admRankings = function(){
  $$("[data-rkmove]").forEach(function(b){
    b.addEventListener("click", function(){
      var kv = this.getAttribute("data-rkmove").split(":");
      var i = +kv[0], d = +kv[1], pr = CG.lg.powerRankings;
      var tmp = pr[i]; pr[i]=pr[i+d]; pr[i+d]=tmp;
      pr.forEach(function(x,idx){ x.rank=idx+1; });
      CG.audit("Power rankings reordered", "manual adjustment");
      CG.toast("Reordered — republish to make it official (demo persists until reload)","ok");
      CG.router();
    });
  });
  $$("[data-rkedit]").forEach(function(b){
    b.addEventListener("click", function(){
      var code = this.getAttribute("data-rkedit");
      var e = CG.CONTENT.rankings.entries.find(function(x){ return x.code===code; });
      CG.modal("Edit commentary — "+CG.TEAM[code].name,
        '<label class="fld"><span>Staff analysis</span><textarea id="rkTxt" rows="4">'+esc(e.comment)+'</textarea></label>',
        '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-ink" id="rkSave">Save</button>');
      $("#rkSave").addEventListener("click", function(){
        e.comment = $("#rkTxt").value;
        CG.audit("Ranking commentary edited", code);
        CG.closeOverlay(); CG.toast("Commentary updated","ok");
      });
    });
  });
};

/* ---------- awards admin ---------- */
CG.admAwards = function(){
  var lg = CG.lg;
  var last = lg.lastNight;
  return '<div class="grid g2" style="align-items:start"><div class="card"><div class="card-h"><h3>Three Stars — last night</h3><span class="chip chip-win">Auto-suggested · published</span></div>'+
    last.map(function(r){
      return '<div class="notif" style="cursor:default"><span class="nf-ic">'+CG.ic("star",14)+'</span>'+
        '<span style="min-width:0"><b>'+CG.TEAM[r.home].code+' '+r.score[r.home]+'–'+r.score[r.away]+' '+CG.TEAM[r.away].code+'</b>'+
        '<p>'+r.stars.map(function(s,i){ return (i+1)+". "+CG.playerById(lg,s.pid).tag; }).join(" · ")+'</p></span>'+
        '<button class="btn btn-ghost btn-sm" data-stars="'+r.id+'" style="flex-shrink:0">Adjust</button></div>';
    }).join("")+
    '<div class="card-b" style="border-top:1px solid var(--line)"><span class="caption">Suggestions rank game score (goals, assists, saves, shutouts). Staff can override before the nightly publish.</span></div></div>'+
    '<div class="stack"><div class="card"><div class="card-h"><h3>Player of the Week 7</h3><span class="chip chip-warn">Week in progress</span></div>'+
    '<div class="empty"><div class="e-art">'+CG.ic("trophy",20)+'</div><b>Voting opens after Saturday’s games</b><p>Nominees auto-populate from weekly stat lines; staff ballots are logged and auditable.</p></div></div>'+
    '<div class="card"><div class="card-h"><h3>Season awards</h3></div><div class="card-b"><p class="small" style="color:var(--steel)">Ballots configured: MVP, Best Forward, Best Defenseman, Best Goaltender, Rookie of the Year, Sportsmanship, Playoff MVP. Voting window: after Week 10.</p>'+
    '<button class="btn btn-ghost btn-sm" style="margin-top:12px" data-toast="Ballot voting isn’t wired yet — awards are selected at season’s end">Configure ballots</button></div></div></div></div>';
};
CG.AFTER._admAwards = function(){
  $$("[data-stars]").forEach(function(b){
    b.addEventListener("click", function(){
      var r = CG.lg.results.find(function(x){ return x.id===b.getAttribute("data-stars"); });
      CG.modal("Adjust Three Stars",
        r.stars.map(function(s,i){
          return '<label class="fld"><span>'+["First","Second","Third"][i]+' star</span><select>'+
            [r.home,r.away].map(function(code){
              return Object.keys(r.box[code]).map(function(pid){
                var p = CG.playerById(CG.lg,pid);
                return '<option'+(pid===s.pid?" selected":"")+'>'+p.tag+' ('+code+')</option>';
              }).join("");
            }).join("")+'</select></label>';
        }).join(""),
        '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-ink" id="stSave">Publish stars</button>');
      $("#stSave").addEventListener("click", function(){
        CG.audit("Three Stars adjusted", r.id);
        CG.closeOverlay(); CG.toast("Three Stars republished","ok");
      });
    });
  });
};

/* ---------- complaints admin ---------- */
CG.admComplaints = function(){
  var list = CG.visibleComplaints();
  return '<div class="card"><div class="card-h"><h3>All cases</h3><span class="chip">'+list.filter(function(c){ return c.status!=="Resolved"; }).length+' open</span></div>'+
    list.map(function(c){
      return '<div class="notif" data-go="#/hub/complaint?id='+esc(c.caseId)+'"><span class="nf-ic" style="color:'+(c.confidential?"var(--red)":"var(--steel)")+'">'+CG.ic(c.confidential?"lock":"flag",15)+'</span>'+
        '<span style="min-width:0"><b>'+esc(c.caseId)+' — '+esc(c.category)+(c.confidential?' <span class="chip chip-loss" style="font-size:9px">confidential</span>':"")+'</b>'+
        '<p>'+esc(c.summary)+'</p><span class="caption">Filed by '+esc(c.filedBy)+' · reviewer: '+esc(c.assignedTo||"unassigned")+'</span></span>'+
        '<span class="chip '+(c.status==="Resolved"?"chip-win":"chip-warn")+'" style="flex-shrink:0">'+esc(c.status)+'</span></div>';
    }).join("")+'</div>'+
    '<div class="note red" style="margin-top:16px">Every case view is access-logged. Reviewer conflicts of interest (same club, named party) block assignment automatically in production.</div>';
};

/* ---------- newsroom admin ---------- */
CG.admNews = function(){
  var drafts = CG.store.get("myArticles")||[];
  return '<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:16px">'+
    '<span class="caption" style="align-self:center">'+CG.CONTENT.articles.length+' published · '+drafts.length+' drafts</span>'+
    '<button class="btn btn-chrome" id="newArt">'+CG.ic("plus",15)+'New story</button></div>'+
    (drafts.length?'<div class="card" style="margin-bottom:16px"><div class="card-h"><h3>Drafts</h3></div>'+drafts.map(function(d,i){
      return '<div class="notif" style="cursor:default"><span class="nf-ic">'+CG.ic("doc",14)+'</span><span style="min-width:0"><b>'+esc(d.title)+'</b><p>'+esc(d.category)+'</p></span>'+
        '<button class="btn btn-ink btn-sm" data-pub="'+i+'" style="flex-shrink:0">Publish</button></div>';
    }).join("")+'</div>':"")+
    '<div class="card"><div class="card-h"><h3>Published</h3></div>'+
    CG.CONTENT.articles.slice().sort(function(a,b){ return b.dateIso.localeCompare(a.dateIso); }).map(function(a){
      return '<div class="notif" data-go="#/article/'+a.slug+'"><span class="nf-ic">'+CG.ic("doc",14)+'</span>'+
        '<span style="min-width:0"><b>'+esc(a.title)+'</b><p>'+esc(a.category)+' · '+esc(a.author)+'</p></span>'+
        '<span class="nf-t">'+CG.fmtDate(a.dateIso)+'</span></div>';
    }).join("")+'</div>';
};
CG.AFTER._admNews = function(){
  var na = $("#newArt");
  if (na) na.addEventListener("click", function(){
    CG.modal("New story",
      '<label class="fld"><span>Headline</span><input id="naT" placeholder="Sentence case, specific, no clickbait"></label>'+
      '<div class="grid g2"><label class="fld"><span>Category</span><select id="naC">'+["League News","Game Recap","Transactions","Awards","Commissioner Update","Team Feature"].map(function(c){ return "<option>"+c+"</option>"; }).join("")+'</select></label>'+
      '<label class="fld"><span>Placement</span><select><option>Newsroom only</option><option>Homepage + carousel</option></select></label></div>'+
      '<label class="fld"><span>Excerpt</span><textarea id="naE" rows="2"></textarea></label>'+
      '<label class="fld"><span>Body</span><textarea id="naB" rows="5" placeholder="Write like a beat reporter. Paragraph breaks become real paragraphs."></textarea></label>',
      '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-ghost" id="naDraft">Save draft</button><button class="btn btn-ink" id="naPub">Publish now</button>');
    function collect(){
      var t = $("#naT").value.trim();
      if (t.length<8){ CG.toast("Give it a real headline first","err"); return null; }
      return { slug:"custom-"+Date.now(), title:t, category:$("#naC").value, excerpt:$("#naE").value||t,
        author:"zackbrown17 — Commissioner", dateIso:new Date(CG.now()).toISOString().slice(0,10),
        body: ($("#naB").value||"(Body to come.)").split(/\n+/), relatedTeams:[], tags:["commissioner"] };
    }
    $("#naDraft").addEventListener("click", function(){
      var a = collect(); if (!a) return;
      var d = CG.store.get("myArticles")||[]; d.push(a); CG.store.set("myArticles", d);
      CG.audit("Story drafted", a.title);
      CG.closeOverlay(); CG.toast("Draft saved","ok"); CG.router();
    });
    $("#naPub").addEventListener("click", function(){
      var a = collect(); if (!a) return;
      CG.CONTENT.articles.unshift(a);
      var pub = CG.store.get("published")||[]; pub.push(a); CG.store.set("published", pub);
      CG.audit("Story published", a.title);
      CG.closeOverlay(); CG.toast("Published — it’s live in the newsroom and search","ok"); CG.router();
    });
  });
  $$("[data-pub]").forEach(function(b){
    b.addEventListener("click", function(){
      var d = CG.store.get("myArticles")||[];
      var a = d.splice(+this.getAttribute("data-pub"),1)[0];
      CG.store.set("myArticles", d);
      CG.CONTENT.articles.unshift(a);
      var pub = CG.store.get("published")||[]; pub.push(a); CG.store.set("published", pub);
      CG.audit("Story published", a.title);
      CG.toast("Published","ok"); CG.router();
    });
  });
};

/* ---------- homepage manager ---------- */
CG.admHomepage = function(){
  var cfg = CG.store.get("modules")||{};
  return '<div class="note" style="margin-bottom:16px">Toggle homepage modules and reorder the hero. Changes apply immediately — open the front page in another tab to compare.</div>'+
    '<div class="card"><div class="card-h"><h3>Homepage modules</h3><a class="sec-link" href="#/home">View front page</a></div>'+
    CG.HOMEMODS.map(function(m){
      var off = cfg[m.key]&&cfg[m.key].off;
      return '<div style="display:flex;align-items:center;gap:12px;padding:12px 18px;border-top:1px solid var(--line-soft)">'+
        '<span style="flex:1;font-weight:600;font-size:14px">'+m.label+'</span>'+
        '<button class="toggle'+(off?"":" on")+'" data-mod="'+m.key+'" role="switch" aria-checked="'+(!off)+'" aria-label="'+m.label+'"></button></div>';
    }).join("")+'</div>'+
    '<div class="card" style="margin-top:16px"><div class="card-h"><h3>Intermission video</h3></div><div class="card-b">'+
    '<p class="small" style="color:var(--steel)">Drop an MP4/WebM to run muted on loop in the homepage video slot (session-only in the prototype — production stores it in the media library with poster + schedule).</p>'+
    '<input type="file" id="vidUp" accept="video/mp4,video/webm" style="margin-top:12px">'+
    (CG.store.get("prefs").video?'<button class="btn btn-ghost btn-sm" style="margin-top:10px" id="vidClear">Remove current video</button>':"")+
    '</div></div>';
};
CG.AFTER._admHomepage = function(){
  /* bind per rendered toggle — a document-level listener here would stack across visits */
  $$("[data-mod]").forEach(function(t){
    t.addEventListener("click", function(){
      var cfg = CG.store.get("modules")||{};
      var k = t.getAttribute("data-mod");
      cfg[k] = cfg[k]||{};
      cfg[k].off = !cfg[k].off;
      CG.store.set("modules", cfg);
      t.classList.toggle("on", !cfg[k].off);
      t.setAttribute("aria-checked", !cfg[k].off);
      CG.audit("Homepage module "+(cfg[k].off?"hidden":"shown"), k);
      CG.toast("Front page updated","ok");
    });
  });
  var v = $("#vidUp");
  if (v) v.addEventListener("change", function(){
    var f = this.files[0]; if (!f) return;
    var prefs = CG.store.get("prefs");
    prefs.video = URL.createObjectURL(f);
    CG.store.set("prefs", prefs);
    CG.audit("Homepage video uploaded", f.name);
    CG.toast(f.name+" is live on the homepage (this session)","ok");
    CG.router();
  });
  var vc = $("#vidClear");
  if (vc) vc.addEventListener("click", function(){
    var prefs = CG.store.get("prefs"); delete prefs.video; CG.store.set("prefs", prefs);
    CG.audit("Homepage video removed","");
    CG.toast("Video removed — poster fallback restored","ok"); CG.router();
  });
};

/* ---------- carousel manager ---------- */
CG.admCarousel = function(){
  var defs = [
    ["news","Breaking news"],["matchup","Featured matchup"],["potw","Player of the Week"],
    ["rankings","Power Rankings"],["standings","Standings snapshot"]
  ];
  var cfg = CG.store.get("slides")||{};
  return '<div class="note" style="margin-bottom:16px">Slides pull live league data (the POTW slide always shows the current winner). Toggle, reorder, and check the hero — production adds scheduling, expiry, and per-slide analytics.</div>'+
    '<div class="card"><div class="card-h"><h3>Hero slides</h3><a class="sec-link" href="#/home">Preview hero</a></div>'+
    defs.map(function(d,i){
      var c = cfg[d[0]]||{};
      return '<div style="display:flex;align-items:center;gap:12px;padding:12px 18px;border-top:1px solid var(--line-soft)">'+
        '<span class="mono" style="color:var(--steel);font-size:11px;width:20px">'+(i+1)+'</span>'+
        '<span style="flex:1;font-weight:600;font-size:14px">'+d[1]+'</span>'+
        '<button class="btn btn-ghost btn-sm" data-slmove="'+d[0]+':-1" aria-label="Move earlier">↑</button>'+
        '<button class="btn btn-ghost btn-sm" data-slmove="'+d[0]+':1" aria-label="Move later">↓</button>'+
        '<button class="toggle'+(c.off?"":" on")+'" data-slide="'+d[0]+'" role="switch" aria-checked="'+(!c.off)+'" aria-label="'+d[1]+'"></button></div>';
    }).join("")+'</div>'+
    '<button class="btn btn-ink" style="margin-top:16px" data-toast="Custom slides aren’t wired yet — the carousel runs on live news">'+CG.ic("plus",15)+'Custom slide</button>';
};
CG.AFTER._admCarousel = function(){
  $$("[data-slide]").forEach(function(t){
    t.addEventListener("click", function(){
      var cfg = CG.store.get("slides")||{};
      var k = this.getAttribute("data-slide");
      cfg[k]=cfg[k]||{}; cfg[k].off=!cfg[k].off;
      CG.store.set("slides", cfg);
      this.classList.toggle("on", !cfg[k].off);
      CG.audit("Hero slide "+(cfg[k].off?"paused":"activated"), k);
      CG.toast("Hero updated","ok");
    });
  });
  $$("[data-slmove]").forEach(function(b){
    b.addEventListener("click", function(){
      var kv = this.getAttribute("data-slmove").split(":");
      var cfg = CG.store.get("slides")||{};
      cfg[kv[0]]=cfg[kv[0]]||{};
      cfg[kv[0]].ord = (cfg[kv[0]].ord||0) + (+kv[1]);
      CG.store.set("slides", cfg);
      CG.audit("Hero slides reordered", kv[0]);
      CG.toast("Order saved — check the hero","ok");
      CG.router();
    });
  });
};

/* ---------- media library ---------- */
CG.admMedia = function(){
  var base = [
    ["cbr-crest.png","Logo · Circuit Breakers","82 KB", "in use — team page"],
    ["tuc-crest.png","Logo · Tucson Vipers","78 KB", "in use — team page"],
    ["wk6-recap-cover.jpg","Article cover","310 KB", "in use — newsroom"],
    ["intermission-poster.jpg","Video poster","190 KB", "in use — homepage"]
  ].concat((CG.store.get("media")||[]).map(function(m){ return [m,"Uploaded this session","—","unused"]; }));
  return '<div class="card"><div class="card-h"><h3>Library</h3><label class="btn btn-chrome btn-sm" style="cursor:pointer">'+CG.ic("ul",14)+'Upload<input type="file" id="mediaUp" multiple hidden></label></div>'+
    '<div class="card-b"><div class="grid g4" style="grid-template-columns:repeat(auto-fill,minmax(160px,1fr))">'+
    base.map(function(m){
      return '<div class="kpi" style="cursor:default"><div style="height:64px;border-radius:8px;background:var(--ink);display:grid;place-items:center;color:var(--chrome);margin-bottom:10px">'+CG.ic("film",22)+'</div>'+
        '<b style="font-size:12px;font-family:var(--f-mono);word-break:break-all">'+esc(m[0])+'</b>'+
        '<span>'+esc(m[1])+' · '+esc(m[2])+'</span><span class="caption" style="margin-top:4px">'+esc(m[3])+'</span></div>';
    }).join("")+'</div>'+
    '<p class="caption" style="margin-top:14px">Production: server-side type/size validation, optimized variants, alt text, tags, folders, usage references, and delete-protection for assets in use.</p></div></div>';
};
CG.AFTER._admMedia = function(){
  var up = $("#mediaUp");
  if (up) up.addEventListener("change", function(){
    var m = CG.store.get("media")||[];
    Array.prototype.forEach.call(this.files, function(f){ m.push(f.name); });
    CG.store.set("media", m);
    CG.audit("Media uploaded", this.files.length+" file(s)");
    CG.toast(this.files.length+" file(s) added to the library","ok");
    CG.router();
  });
};

/* ---------- rulebook editor ---------- */
CG.admRulebook = function(){
  var rb = CG.CONTENT.rulebook;
  var edits = CG.store.get("rbEdits")||{};
  return '<div class="note" style="margin-bottom:16px">Edits save as a draft amendment; publishing bumps the version with a changelog entry and highlights the changed rules for members. Prior versions stay readable.</div>'+
    '<div class="card"><div class="card-h"><h3>Amend a rule</h3><span class="chip">v'+rb.changelog[0].version+' live</span></div><div class="card-b">'+
    '<label class="fld"><span>Rule</span><select id="rbSec">'+rb.chapters.map(function(ch){
      return '<optgroup label="Ch. '+ch.num+' — '+esc(ch.title)+'">'+ch.sections.map(function(s){
        return '<option value="'+s.id+'">'+s.id+' — '+esc(s.title)+(edits[s.id]?" (draft)":"")+'</option>'; }).join("")+'</optgroup>';
    }).join("")+'</select></label>'+
    '<label class="fld"><span>Text</span><textarea id="rbTxt" rows="7"></textarea></label>'+
    '<div style="display:flex;gap:9px;flex-wrap:wrap"><button class="btn btn-ghost btn-sm" id="rbLoad">Load current text</button>'+
    '<button class="btn btn-ink btn-sm" id="rbDraft">Save draft amendment</button>'+
    '<button class="btn btn-chrome btn-sm" id="rbPub">Publish v1.3</button></div></div></div>'+
    (Object.keys(edits).length?'<div class="card" style="margin-top:16px"><div class="card-h"><h3>Draft amendments</h3></div>'+
      Object.keys(edits).map(function(id){
        return '<div class="notif" style="cursor:default"><span class="nf-ic">'+CG.ic("doc",14)+'</span><span style="min-width:0"><b>Rule '+id+'</b><p>'+esc(edits[id].slice(0,110))+'…</p></span>'+
        '<a class="btn btn-ghost btn-sm" href="#/rulebook?rule='+id+'" style="flex-shrink:0">Preview</a></div>';
      }).join("")+'</div>':"");
};
CG.AFTER._admRulebook = function(){
  function findSec(id){
    var out=null;
    CG.CONTENT.rulebook.chapters.forEach(function(ch){ ch.sections.forEach(function(s){ if (s.id===id) out=s; }); });
    return out;
  }
  $("#rbLoad").addEventListener("click", function(){
    var id = $("#rbSec").value;
    var edits = CG.store.get("rbEdits")||{};
    $("#rbTxt").value = edits[id] || findSec(id).paragraphs.join("\n\n");
  });
  $("#rbDraft").addEventListener("click", function(){
    var id = $("#rbSec").value, txt = $("#rbTxt").value.trim();
    if (txt.length<20){ CG.toast("Load the rule and make a real edit first","err"); return; }
    var edits = CG.store.get("rbEdits")||{}; edits[id]=txt; CG.store.set("rbEdits", edits);
    CG.audit("Rulebook draft amendment", "Rule "+id);
    CG.toast("Draft saved for Rule "+id+" — preview it on the public rulebook","ok");
    CG.router();
  });
  $("#rbPub").addEventListener("click", function(){
    var edits = CG.store.get("rbEdits")||{};
    if (!Object.keys(edits).length){ CG.toast("No draft amendments to publish","err"); return; }
    CG.confirm("Publish rulebook v1.3?","Members are notified, changed rules get highlighted, and v1.2 stays in the version history.","Publish v1.3", function(){
      CG.audit("Rulebook v1.3 published", Object.keys(edits).map(function(k){ return "Rule "+k; }).join(", "));
      CG.toast("v1.3 published — league notified","ok");
    });
  });
};

/* ---------- automations (the live site's auto-set features, modeled 1:1) ---------- */
CG.AUTOMATIONS = [
  { key:"discordSync", icon:"users", name:"Discord roster & role sync", every:"Every 5 minutes", lastMin:3,
    desc:"Gamertags follow Discord display names automatically. Owner / GM / AGM, club, position, Free Agent, and Commissioner roles are reconciled on every pass — and banned accounts are removed from the server and kept out." },
  { key:"discordJoin", icon:"out", name:"Sign-in auto-join", every:"On every sign-in", lastMin:12, tryIt:"#/signin",
    desc:"Signing in with Discord doubles as a server invite: if the account isn’t in the Chel Gaming Discord, the league bot adds it automatically (guilds.join), flags the profile in-guild, and signs them into the site — one step, no invite links." },
  { key:"welcomeBot", icon:"msg", name:"Welcome bot", every:"Every 5 minutes", lastMin:3,
    desc:"New Discord members get greeted once in #welcome — catches invite-link joins and site sign-ins alike, with a burst guard so a raid never triggers a mass-ping." },
  { key:"webhooks", icon:"arrow", name:"Discord feeds", every:"On publish", lastMin:64,
    desc:"Finals post to #game-scores, stories to #news, roster moves to #transactions with player and club @mentions, and signups to #season-signups — the moment they happen on the site." },
  { key:"gamenight", icon:"clock", name:"Game-night clock", every:"Per game", lastMin:15,
    desc:"Codes release at T-30 to rostered players only, both lineups unseal simultaneously at T-60, edits lock at T-30 (Rule 5.3), and the forfeit timer arms at puck drop +15 (Rule 3.2)." },
  { key:"serverpick", icon:"gear", name:"Server auto-resolution", every:"At the pick lock", lastMin:15,
    desc:"Both clubs file private region picks; at the pick lock the league server resolves automatically and the match card fills itself in — no DM negotiation." },
  { key:"aiimport", icon:"film", name:"AI box-score import", every:"On upload", lastMin:0, tryIt:"#/admin/results",
    desc:"End-of-game screenshots are read by a vision model (Gemini, with Groq fallback) into a full box score — skater lines, goalie lines, both teams. Staff verify before it posts." },
  { key:"twitch", icon:"play", name:"Twitch live flags", every:"Every 5 minutes", lastMin:3,
    desc:"When a rostered player goes live, their match card and the schedule get a LIVE badge automatically — and it clears when the stream ends." },
  { key:"notifs", icon:"bell", name:"Notification engine", every:"Continuous", lastMin:1,
    desc:"Ticket receipts on submission, staff-response alerts, availability reminders before Sunday 8 PM ET, code-release pings, and lineup-lock warnings — in-app, with Discord DM delivery in production." },
  { key:"recompute", icon:"chart", name:"Standings & ratings recompute", every:"On every verified final", lastMin:null, core:true,
    desc:"Each verified final instantly rebuilds standings, stat leaders, overall ratings, and the power-ranking draft. You've seen this one work — enter a result and watch the ticker." }
];
CG.admAutomations = function(){
  var cfg = CG.store.get("autoCfg")||{};
  return '<div class="note chr" style="margin-bottom:18px"><b style="font-family:var(--f-disp)">Everything the league does on its own.</b> These are the automations running on the current live site, carried into this model. Toggles persist; in production each one is a scheduled job or database trigger with its run log in the audit trail.</div>'+
    '<div class="grid g2">'+CG.AUTOMATIONS.map(function(a){
      var off = cfg[a.key]===false;
      return '<div class="card"><div class="card-b" style="display:flex;gap:14px;align-items:flex-start">'+
        '<span class="nf-ic" style="width:38px;height:38px;flex-shrink:0">'+CG.ic(a.icon,17)+'</span>'+
        '<div style="min-width:0;flex:1"><div style="display:flex;gap:9px;align-items:center;flex-wrap:wrap">'+
          '<b style="font-family:var(--f-disp);font-size:15px">'+a.name+'</b>'+
          '<span class="chip" style="font-size:9px">'+a.every+'</span></div>'+
          '<p class="small" style="color:var(--steel);margin-top:6px;line-height:1.55">'+a.desc+'</p>'+
          '<div style="display:flex;gap:12px;align-items:center;margin-top:9px" class="caption">'+
          (a.core ? '<span class="chip chip-chrome" style="font-size:9px">Core — always on</span>'
            : '<span>'+(off?"Paused":"Last run "+(a.lastMin===0?"just now":a.lastMin+" min ago"))+'</span>')+
          (a.tryIt?'<a href="'+a.tryIt+'" style="font-weight:700;border-bottom:2px solid var(--chrome)">Try it →</a>':"")+
          '</div></div>'+
        (a.core ? "" : '<button class="toggle'+(off?"":" on")+'" data-auto="'+a.key+'" role="switch" aria-checked="'+(!off)+'" aria-label="'+a.name+'"></button>')+
      '</div></div>';
    }).join("")+'</div>';
};
CG.AFTER._admAutomations = function(){
  $$("[data-auto]").forEach(function(t){
    t.addEventListener("click", function(){
      var cfg = CG.store.get("autoCfg")||{};
      var k = this.getAttribute("data-auto");
      cfg[k] = cfg[k]===false ? true : false;
      CG.store.set("autoCfg", cfg);
      var on = cfg[k]!==false;
      this.classList.toggle("on", on); this.setAttribute("aria-checked", on);
      var a = CG.AUTOMATIONS.find(function(x){ return x.key===k; });
      CG.audit("Automation "+(on?"resumed":"paused"), a.name);
      CG.toast(a.name+" "+(on?"resumed":"paused"), on?"ok":undefined);
    });
  });
};

/* ---------- data import/export ---------- */
CG.admData = function(){
  return '<div class="grid g2" style="align-items:start">'+
    '<div class="card"><div class="card-h"><h3>CSV import</h3></div><div class="card-b">'+
    '<label class="fld"><span>Data type</span><select id="impType"><option>Skater game stats</option><option>Goalie game stats</option><option>Results</option><option>Players</option><option>Schedule</option></select></label>'+
    '<label class="fld"><span>File</span><input type="file" id="impFile" accept=".csv,text/csv"></label>'+
    '<div id="impPreview"></div></div></div>'+
    '<div class="card"><div class="card-h"><h3>Exports</h3></div><div class="card-b"><div class="stack" style="gap:9px">'+
    [["Standings","standings"],["Full schedule + results","schedule"],["Skater statistics","skaters"],["Goaltender statistics","goalies"],["Audit log","audit"]].map(function(x){
      return '<button class="btn btn-ghost" data-export="'+x[1]+'" style="justify-content:space-between">'+x[0]+CG.ic("dl",15)+'</button>';
    }).join("")+'</div>'+
    '<p class="caption" style="margin-top:12px">Exports respect permissions — complaint and availability exports are commissioner-only and exclude confidential fields.</p></div></div></div>';
};
CG.AFTER._admData = function(){
  $("#impFile").addEventListener("change", function(){
    var f = this.files[0]; if (!f) return;
    var rd = new FileReader();
    rd.onload = function(){
      var lines = String(rd.result).split(/\r?\n/).filter(Boolean);
      var head = (lines[0]||"").split(",");
      $("#impPreview").innerHTML = '<div class="note chr" style="margin-top:6px"><b style="font-family:var(--f-disp)">'+esc(f.name)+'</b> — '+(lines.length-1)+' rows · '+head.length+' columns detected'+
        '<div style="margin:10px 0"><span class="caption">Map columns:</span>'+head.slice(0,4).map(function(h){
          return '<div style="display:flex;gap:8px;align-items:center;margin-top:6px"><code class="mono" style="font-size:11px;background:var(--ice);padding:2px 8px;border-radius:5px">'+esc(h)+'</code>→'+
            '<select style="max-width:170px;padding:6px 8px"><option>player_tag</option><option>goals</option><option>assists</option><option>ignore</option></select></div>';
        }).join("")+'</div>'+
        '<button class="btn btn-ink btn-sm" id="impGo">Validate & import '+(lines.length-1)+' rows</button></div>';
      $("#impGo").addEventListener("click", function(){
        CG.audit("CSV import", f.name+" ("+(lines.length-1)+" rows)");
        CG.toast((lines.length-1)+" rows validated — import logged with rollback point","ok");
        $("#impPreview").innerHTML = '<div class="note grn" style="margin-top:6px">Import complete. In production this writes through the same validation layer as manual entry, with a job log and rollback.</div>';
      });
    };
    rd.readAsText(f);
  });
  $$("[data-export]").forEach(function(b){
    b.addEventListener("click", function(){
      var kind = this.getAttribute("data-export");
      if (kind==="standings"){
        var rows=[["Rank","Club","GP","W","L","OTL","GF","GA","DIFF","PTS"]];
        CG.standings(CG.lg).forEach(function(r,i){ rows.push([i+1,r.team.name,r.gp,r.w,r.l,r.otl,r.gf,r.ga,r.diff,r.pts]); });
        CG.exportCSV("cghl-standings.csv", rows); return;
      }
      if (kind==="schedule"){
        var rs=[["Week","Date","Away","Home","AS","HS","OT"]];
        CG.lg.schedule.forEach(function(g){ var r=CG.lg.results.find(function(x){return x.id===g.id;});
          rs.push([g.week,CG.fmtDay(g.at),CG.TEAM[g.away].name,CG.TEAM[g.home].name,r?r.score[g.away]:"",r?r.score[g.home]:"",r&&r.ot?"Y":""]); });
        CG.exportCSV("cghl-schedule.csv", rs); return;
      }
      if (kind==="skaters"||kind==="goalies"){
        var rows2=[kind==="skaters"?["Player","Team","POS","GP","G","A","P","PIM"]:["Goalie","Team","GP","W","L","OTL","SV%","GAA","SO"]];
        CG.lg.players.filter(function(p){ return kind==="skaters"?p.pos!=="G":p.pos==="G"; }).forEach(function(p){
          var s=CG.lg.pstats[p.id];
          rows2.push(kind==="skaters"?[p.tag,p.team,p.pos,s.gp,s.g,s.a,s.p,s.pim]
            :[p.tag,p.team,s.gp,s.w,s.l,s.otl,s.sa?(s.sv/s.sa).toFixed(3):"",s.gp?(s.ga/s.gp).toFixed(2):"",s.so]);
        });
        CG.exportCSV("cghl-"+kind+".csv", rows2); return;
      }
      if (kind==="audit"){
        var rows3=[["When","Who","Action","Detail"]];
        (CG.store.get("audit")||[]).forEach(function(a){ rows3.push([CG.fmtFull(a.at),a.who,a.action,a.detail]); });
        CG.exportCSV("cghl-audit.csv", rows3);
      }
    });
  });
};

/* ---------- audit log ---------- */
CG.admAudit = function(){
  var seed = [
    { at: Date.parse("2026-07-14T21:12:00-04:00"), who:"zackbrown17 · Commissioner", action:"Week 7 Power Rankings published", detail:"" },
    { at: Date.parse("2026-07-14T09:30:00-04:00"), who:"RefCam_Official · Staff", action:"Case CG-0151 assigned", detail:"harassment review" },
    { at: Date.parse("2026-07-13T10:00:00-04:00"), who:"zackbrown17 · Commissioner", action:"Week 8 availability window opened", detail:"deadline Sun 8 PM ET" },
    { at: Date.parse("2026-07-12T23:44:00-04:00"), who:"RefCam_Official · Staff", action:"Week 6 finals verified", detail:"4 games" },
    { at: Date.parse("2026-07-06T18:20:00-04:00"), who:"Player Safety", action:"Suspension issued", detail:"OpenIceOpie — 2 games (Rule 7.4)" }
  ];
  var all = (CG.store.get("audit")||[]).concat(seed);
  return '<div class="card"><div class="card-h"><h3>Immutable audit log</h3><span class="chip">'+all.length+' entries</span></div>'+
    '<div class="tblwrap"><table class="tbl keepcols"><thead><tr><th class="tleft">When</th><th class="tleft">Actor</th><th class="tleft">Action</th></tr></thead><tbody>'+
    all.map(function(a){
      return '<tr><td class="tleft tnum" style="font-size:11px;white-space:nowrap">'+CG.fmtFull(a.at)+'</td>'+
        '<td class="tleft" style="font-size:12.5px">'+esc(a.who)+'</td>'+
        '<td class="tleft" style="font-size:13px"><b>'+esc(a.action)+'</b>'+(a.detail?' <span class="caption">— '+esc(a.detail)+'</span>':"")+'</td></tr>';
    }).join("")+'</tbody></table></div></div>'+
    '<p class="caption" style="margin-top:14px">Entries marked with your session are actions you took in this demo. Production writes append-only records with actor, IP, and before/after snapshots.</p>';
};

/* ---------- site settings ---------- */
CG.admSettings = function(){
  return '<div class="grid g2" style="align-items:start"><div class="card"><div class="card-h"><h3>League settings</h3></div><div class="card-b">'+
    '<label class="fld"><span>League name</span><input value="Chel Gaming Hockey League"></label>'+
    '<div class="grid g2"><label class="fld"><span>Points — win</span><input type="number" value="2"></label>'+
    '<label class="fld"><span>Points — OT loss</span><input type="number" value="1"></label></div>'+
    '<div class="grid g2"><label class="fld"><span>Playoff spots / division</span><input type="number" value="3"></label>'+
    '<label class="fld"><span>League time zone</span><select><option>Eastern</option><option>Central</option></select></label></div>'+
    '<button class="btn btn-ink btn-sm" data-toast="These settings aren’t wired to the database yet — current values match the rulebook">Save settings</button></div></div>'+
    '<div class="stack"><div class="card"><div class="card-h"><h3>Integrations</h3></div><div class="card-b">'+
    [["Discord bot — role sync, codes DM","Connected"],["Discord webhooks — scores, news","Connected"],["Twitch — live game flags","Connected"],["Email — digests & resets","Configured"]].map(function(x){
      return '<div style="display:flex;justify-content:space-between;gap:10px;padding:9px 0;border-bottom:1px solid var(--line-soft);font-size:13.5px"><span>'+x[0]+'</span><span class="chip chip-win">'+x[1]+'</span></div>';
    }).join("")+'</div></div>'+
    '<div class="card"><div class="card-h"><h3>Backups</h3></div><div class="card-b"><p class="small" style="color:var(--steel)">Nightly snapshots with 30-day retention; season archives are immutable. Last snapshot: this morning, 4:00 AM ET.</p>'+
    '<button class="btn btn-ghost btn-sm" style="margin-top:10px" data-toast="Manual snapshots aren’t wired yet — nightly backups run automatically">Snapshot now</button></div></div></div></div>';
};

CG.AFTER.admin = function(param){
  if (CG.role()!=="commish") return;   /* unauthorized page has none of the admin controls */
  var m = { results:CG.AFTER._admResults, codes:CG.AFTER._admCodes, schedule:CG.AFTER._admSchedule,
    users:CG.AFTER._admUsers, ratings:CG.AFTER._admRatings, rankings:CG.AFTER._admRankings,
    awards:CG.AFTER._admAwards, news:CG.AFTER._admNews, homepage:CG.AFTER._admHomepage,
    carousel:CG.AFTER._admCarousel, media:CG.AFTER._admMedia, rulebook:CG.AFTER._admRulebook,
    automations:CG.AFTER._admAutomations, data:CG.AFTER._admData };
  if (m[param]) m[param]( );
};
