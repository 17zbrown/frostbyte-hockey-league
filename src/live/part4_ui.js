/* ================================================================
   UI FRAMEWORK — state, permissions, router, shared components
   ================================================================ */

/* ---------- tiny DOM helpers ---------- */
var $  = function(s,r){ return (r||document).querySelector(s); };
var $$ = function(s,r){ return Array.prototype.slice.call((r||document).querySelectorAll(s)); };
function esc(s){ return (s==null?"":String(s)).replace(/[<>&"']/g,function(c){
  return {"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;","'":"&#39;"}[c]; }); }

/* ---------- persistent demo state ---------- */
CG.STORE_KEY = "cgproto:v1";
CG.store = (function(){
  var def = { role:"guest", read:{}, availability:{}, lineups:{}, myComplaints:[],
              results:[], slides:{}, modules:{}, audit:[], weights:null, media:[],
              rbEdits:{}, notifs:{}, recentSearch:[], caseNotes:{}, prefs:{},
              resched:{}, starsOverride:{}, caseDecisions:{}, userRoles:{}, rbPublished:null,
              blockToggles:{}, waived:{}, tradeOffers:[], tradeDecisions:{} };
  var data;
  try { data = Object.assign({}, def, JSON.parse(localStorage.getItem(CG.STORE_KEY)||"{}")); }
  catch(e){ data = def; }
  return {
    get:function(k){ return data[k]; },
    set:function(k,v){ data[k]=v; try{ localStorage.setItem(CG.STORE_KEY, JSON.stringify(data)); }catch(e){} },
    reset:function(){ try{ localStorage.removeItem(CG.STORE_KEY); }catch(e){} location.hash="#/home"; location.reload(); }
  };
})();

/* ---------- demo clock ---------- */
CG._loadEpoch = Date.now();
CG.now = function(){ return Date.parse(CG.DEMO_NOW_ISO) + (Date.now() - CG._loadEpoch); };
CG.fmtDay  = function(ts){ return new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",weekday:"short",month:"short",day:"numeric"}).format(ts); };
CG.fmtTime = function(ts){ return new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",hour:"numeric",minute:"2-digit"}).format(ts)+" ET"; };
CG.fmtFull = function(ts){ return CG.fmtDay(ts)+" · "+CG.fmtTime(ts); };
/* A date-only string ("2026-07-19") is a calendar date, not an instant: Date.parse reads it as
   UTC midnight, which renders as the PREVIOUS day in ET. Format those verbatim; only real
   timestamps get converted to league time. */
CG.fmtDate = function(iso){
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso||""));
  if (m) return new Intl.DateTimeFormat("en-US",{month:"short",day:"numeric",year:"numeric"})
    .format(new Date(+m[1], +m[2]-1, +m[3]));
  return new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",month:"short",day:"numeric",year:"numeric"}).format(Date.parse(iso));
};

/* ---------- league boot (sim + user-entered results overlay) ---------- */
CG.boot = function(){
  var weights = CG.store.get("weights") || undefined;
  CG.lg = CG.buildLeague({ weights: weights });
  (CG.store.get("results")||[]).forEach(function(en){ CG.applyEnteredResult(CG.lg, en); });
  if ((CG.store.get("results")||[]).length) CG.aggregate(CG.lg, { weights: weights });
  /* commissioner reschedules (future games only) */
  var rs = CG.store.get("resched")||{};
  CG.lg.schedule.forEach(function(g){
    if (rs[g.id] && !CG.lg.results.some(function(r){ return r.id===g.id; })){
      g.at = rs[g.id]; g.rescheduled = true;
    }
  });
  /* tonight's slate always excludes games that now have results (entered mid-demo),
     and the marquee flag is re-picked from what's actually left to play */
  CG.lg.tonight = CG.lg.schedule.filter(function(g){
    return !CG.lg.results.some(function(r){ return r.id===g.id; }) && Math.abs(g.at - CG.lg.demoNow) < 10*3600000;
  });
  var bestT = null;
  CG.lg.tonight.forEach(function(g){
    var v = CG.lg.teams[g.home].pts + CG.lg.teams[g.away].pts;
    if (!bestT || v > bestT.v) bestT = { g:g, v:v };
  });
  CG.lg.tonight.forEach(function(g){ g.feature = bestT && g.id===bestT.g.id; });
  /* commissioner Three-Stars overrides */
  var so = CG.store.get("starsOverride")||{};
  CG.lg.results.forEach(function(r){ if (so[r.id]) r.stars = so[r.id]; });
};
/* commissioner-entered result: synthesize a consistent box score for the given final */
CG.applyEnteredResult = function(lg, en){
  var gm = lg.schedule.find(function(g){ return g.id===en.gameId; });
  if (!gm || lg.results.some(function(r){ return r.id===en.gameId; })) return;
  var rng = CG.makeRng(987000 + parseInt(en.gameId.replace(/\D/g,""),10));
  var res = CG.simGame(gm, lg.byTeam, rng, lg.suspensions);
  /* force the entered final by re-simming until the shape matches or patching */
  var diffH = en.hs - res.score[gm.home], diffA = en.as - res.score[gm.away];
  ["home","away"].forEach(function(side){
    var code = gm[side], want = side==="home"?en.hs:en.as;
    var box = res.box[code];
    var sk = Object.keys(box).filter(function(pid){ return !box[pid].goalie; });
    var cur = sk.reduce(function(s,pid){ return s+box[pid].g; },0);
    while (cur < want){ var pid = sk[Math.floor(rng()*sk.length)]; box[pid].g++; box[pid].shots++; cur++; }
    while (cur > want){
      var withG = sk.filter(function(pid){ return box[pid].g>0; });
      var pid2 = withG[Math.floor(rng()*withG.length)]; box[pid2].g--; cur--;
    }
    /* trim assists to legality */
    var maxA = want*2, curA = sk.reduce(function(s,pid){ return s+box[pid].a; },0);
    while (curA > maxA){ var withA = sk.filter(function(pid){ return box[pid].a>0; });
      var pid3 = withA[Math.floor(rng()*withA.length)]; box[pid3].a--; curA--; }
    res.score[code] = want;
  });
  res.ot = !!en.ot;
  res.reg = {}; res.reg[gm.home] = en.ot ? Math.min(en.hs,en.as) : en.hs; res.reg[gm.away] = en.ot ? Math.min(en.hs,en.as) : en.as;
  /* fix goalie GA/SV vs new score */
  ["home","away"].forEach(function(side){
    var code = gm[side], opp = side==="home"?gm.away:gm.home;
    var box = res.box[code];
    Object.keys(box).forEach(function(pid){
      var b = box[pid]; if (!b.goalie) return;
      b.ga = res.score[opp]; b.sa = Math.max(b.sa, b.ga+4); b.sv = b.sa-b.ga;
      b.w = res.score[code]>res.score[opp]?1:0;
      b.l = (res.score[code]<res.score[opp] && !res.ot)?1:0;
      b.otl = (res.score[code]<res.score[opp] && res.ot)?1:0;
      b.so = (b.ga===0 && b.w)?1:0; b.qs = b.sa>0 && (b.sv/b.sa)>=.885?1:0;
    });
  });
  /* re-award GWG + Three Stars from the PATCHED box (the sim's picks may be stale) */
  [gm.home, gm.away].forEach(function(code){
    var box = res.box[code];
    Object.keys(box).forEach(function(pid){ if (!box[pid].goalie) box[pid].gwg = 0; });
  });
  var winCode = res.score[gm.home] > res.score[gm.away] ? gm.home : gm.away;
  var wScorers = Object.keys(res.box[winCode]).filter(function(pid){ var b=res.box[winCode][pid]; return !b.goalie && b.g>0; });
  if (wScorers.length) res.box[winCode][wScorers[Math.floor(rng()*wScorers.length)]].gwg = 1;
  var cand = [];
  [gm.home, gm.away].forEach(function(code){
    Object.keys(res.box[code]).forEach(function(pid){
      var b = res.box[code][pid];
      var sc = b.goalie ? (b.sv*.09 + b.w*1.2 + b.so*2.2) : (b.g*2.1 + b.a*1.3 + b.shots*.06);
      cand.push({ pid:pid, team:code, score:sc });
    });
  });
  cand.sort(function(a,b){ return b.score-a.score; });
  res.stars = cand.slice(0,3).map(function(c){ return { pid:c.pid, team:c.team }; });
  res.entered = true;
  lg.results.push(res);
};

/* ---------- personas & permissions ---------- */
CG.PERSONAS = {
  guest:  { key:"guest",  label:"Guest",        who:"Signed out" },
  member: { key:"member", label:"Member",       tag:"FiveHoleFinn",  who:"FiveHoleFinn · Circuit Breakers LW" },
  mgmt:   { key:"mgmt",   label:"Team Mgmt",    tag:"TapeToTapeTee", who:"TapeToTapeTee · Breakers GM & C" },
  staff:  { key:"staff",  label:"League Staff", tag:"RefCam_Official", who:"RefCam_Official · Complaints & Stats", perms:["complaints.review","stats.enter"] },
  commish:{ key:"commish",label:"Commissioner", tag:"zackbrown17",   who:"zackbrown17 · Commissioner" }
};
/* Discord avatars — the commissioner seat uses zackbrown17's real Discord avatar;
   fictional personas use Discord's stock default avatars, exactly as new accounts would. */
CG.AVATARS = { zack:"data:image/png;base64,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", d0:"data:image/png;base64,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", d2:"data:image/png;base64,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", d4:"data:image/png;base64,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" };
CG.PERSONAS.member.avatar = CG.AVATARS.d0;
CG.PERSONAS.mgmt.avatar   = CG.AVATARS.d2;
CG.PERSONAS.staff.avatar  = CG.AVATARS.d4;
CG.PERSONAS.commish.avatar= CG.AVATARS.zack;
CG.avatarHtml = function(key){
  var p = CG.PERSONAS[key||CG.role()];
  if (p && p.avatar) return '<img src="'+p.avatar+'" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block">';
  return esc(((p&&p.tag)||"G").slice(0,2).toUpperCase());
};

CG.PERMS = {
  "availability.submit":      ["member","mgmt"],
  "availability.viewTeam":    ["mgmt","staff","commish"],
  "roster.manage":            ["mgmt","commish"],
  "trades.manage":            ["mgmt","commish"],
  "lineup.build":             ["mgmt","commish"],
  "lineup.viewOwn":           ["member","mgmt"],
  "codes.view":               ["member","mgmt","staff","commish"],
  "complaints.file":          ["member","mgmt"],
  "complaints.review":        ["staff","commish"],
  "complaints.all":           ["commish"],
  "stats.enter":              ["staff","commish"],
  "admin.core":               ["commish"],
  "news.publish":             ["commish"],
  "awards.manage":            ["staff","commish"],
  "notifications.receive":    ["member","mgmt","staff","commish"]
};
CG.role   = function(){ return CG.store.get("role") || "guest"; };
CG.persona= function(){ return CG.PERSONAS[CG.role()]; };
CG.me     = function(){ var p = CG.persona(); return p.tag ? CG.lg.players.find(function(x){ return x.tag===p.tag; }) : null; };
CG.can    = function(perm){
  var list = CG.PERMS[perm]||[]; var r = CG.role();
  if (r==="staff"){ /* staff is modular: must also be in persona perms for staff-scoped tools */
    if (["complaints.review","stats.enter","awards.manage"].indexOf(perm)>=0)
      return CG.PERSONAS.staff.perms.indexOf(perm)>=0 || perm==="awards.manage";
  }
  return list.indexOf(r)>=0;
};
CG.setRole = function(r){
  CG.store.set("role", r);
  CG.renderChrome();
  CG.router();
  CG.toast("Now viewing as "+CG.PERSONAS[r].label, "ok");
};

/* ---------- audit ---------- */
CG.audit = function(action, detail){
  var a = CG.store.get("audit")||[];
  a.unshift({ at: CG.now(), who: CG.persona().who, action: action, detail: detail||"" });
  CG.store.set("audit", a.slice(0,200));
};

/* ---------- crest ---------- */
CG.crestSeq = 0;
/* current-season naming, derived from the live season row so labels never go stale */
CG.seasonTag = function(){ var s=CG.SEASON||{}; return s.name || s.label || ("Season "+(s.number||1)); };
CG.seasonYear = function(){
  var s=CG.SEASON||{};
  if (s.starts_at) return new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",year:"numeric"}).format(new Date(s.starts_at));
  return String(new Date().getFullYear());
};
/* opts.decorative suppresses the accessible name — pass it wherever the club is already named in
   adjacent text, so a screen reader doesn't read the club twice per row. */
CG.crest = function(code, size, opts){
  var t = CG.TEAM[code]; if (!t) return "";
  /* crest artwork carries its own padding, so it renders at twice the nominal size to read clearly.
     Both branches share the scale: the generated fallback is what a club without an uploaded logo
     gets, and it has to sit at the same size as its neighbours. */
  var s = (size||28)*2;
  var deco = !!(opts && opts.decorative);
  if (t.logo)
    return '<img class="crest" src="'+t.logo+'" width="'+s+'" height="'+Math.round(s*1.05)+'" '+
      'loading="lazy" decoding="async" style="object-fit:contain" alt="'+(deco?"":esc(t.name)+' logo')+'">';
  var lum = (function(hex){ var c=hex.replace("#",""); return (0.299*parseInt(c.slice(0,2),16)+0.587*parseInt(c.slice(2,4),16)+0.114*parseInt(c.slice(4,6),16))/255; })(t.color);
  var fg = lum > .62 ? "#101519" : "#FFFFFF";
  var id = "cr"+(CG.crestSeq++);
  return '<svg class="crest" width="'+s+'" height="'+Math.round(s*1.1)+'" viewBox="0 0 40 44" '+
    (deco ? 'aria-hidden="true"' : 'role="img" aria-label="'+esc(t.name)+' crest"')+'>'+
    '<defs><linearGradient id="'+id+'" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="'+t.color+'"/><stop offset="1" stop-color="'+t.color+'" stop-opacity=".78"/></linearGradient></defs>'+
    '<path d="M3 4 Q3 1.5 5.5 1.5 H34.5 Q37 1.5 37 4 V24 Q37 35 20 42 Q3 35 3 24 Z" fill="url(#'+id+')" stroke="#101519" stroke-width="2"/>'+
    '<text x="20" y="29" text-anchor="middle" font-family="Archivo,sans-serif" font-weight="800" font-size="12.5" letter-spacing="-.3" fill="'+fg+'">'+t.code+'</text></svg>';
};
/* the league's real brand mark — same C/G power mark as chelgamingleague.com */
CG.leagueMark = function(s){
  return '<svg class="crest" width="'+s+'" height="'+s+'" viewBox="0 0 48 48" role="img" aria-label="Chel Gaming">'+
    '<rect width="48" height="48" rx="11" fill="#0a0a0a"/>'+
    '<path d="M35.5 17.4 A13 13 0 1 0 35.5 30.6" fill="none" stroke="#f4f4f0" stroke-width="3.4" stroke-linecap="round"/>'+
    '<path d="M35 24 H28" fill="none" stroke="#ffe500" stroke-width="3.4" stroke-linecap="round"/></svg>';
};
CG.DISCORD_GLYPH = '<svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.3.5a14.6 14.6 0 0 1 4.3 2.2 13.5 13.5 0 0 0-11-.1A14.3 14.3 0 0 1 8.9 3.5L8.6 3a19.7 19.7 0 0 0-4.9 1.4A20.9 20.9 0 0 0 .1 18.6a19.9 19.9 0 0 0 6 3l.7-1.1a12.9 12.9 0 0 1-2-1l.5-.4a14.2 14.2 0 0 0 12.2 0l.5.4c-.6.4-1.3.7-2 1l.7 1.1a19.8 19.8 0 0 0 6-3 20.8 20.8 0 0 0-3.6-14.2ZM8.3 15.3c-1.2 0-2.1-1.1-2.1-2.4S7.1 10.5 8.3 10.5s2.2 1.1 2.1 2.4-.9 2.4-2.1 2.4Zm7.4 0c-1.2 0-2.1-1.1-2.1-2.4s.9-2.4 2.1-2.4 2.2 1.1 2.1 2.4-.9 2.4-2.1 2.4Z"/></svg>';

/* ---------- entity autocomplete (players + clubs, exact-match picker) ---------- */
CG.acIndex = function(kinds){
  var out = [];
  if (kinds.indexOf("players")>=0) CG.lg.players.forEach(function(p){
    out.push({ kind:"player", id:p.id, label:p.tag, sub:CG.TEAM[p.team].name+" · "+p.pos+" · #"+p.jersey, team:p.team });
  });
  if (kinds.indexOf("teams")>=0) CG.TEAMS.forEach(function(t){
    out.push({ kind:"team", id:t.code, label:t.name, sub:t.div+" Division · "+t.city, team:t.code });
  });
  return out;
};
CG.attachAC = function(input, opts){
  if (!input || input._acWired) return;
  input._acWired = true;
  opts = opts||{};
  var items = CG.acIndex(opts.kinds||["players","teams"]);
  var wrap = input.parentNode;
  if (getComputedStyle(wrap).position==="static") wrap.style.position="relative";
  var menu = document.createElement("div");
  menu.className = "ac-menu"; menu.hidden = true;
  menu.setAttribute("role","listbox");
  wrap.appendChild(menu);
  var sel = -1, cur = [];
  function place(){
    menu.style.left = input.offsetLeft+"px";
    menu.style.top  = (input.offsetTop + input.offsetHeight + 6)+"px";
    menu.style.width = Math.max(240, input.offsetWidth)+"px";
  }
  function close(){ menu.hidden = true; sel = -1; }
  function paint(){
    if (!cur.length){ close(); return; }
    place(); menu.hidden = false;
    var q = input.value.trim().toLowerCase();
    menu.innerHTML = cur.map(function(it,i){
      var pos = it.label.toLowerCase().indexOf(q);
      var lab = pos>=0
        ? esc(it.label.slice(0,pos))+"<mark>"+esc(it.label.slice(pos,pos+q.length))+"</mark>"+esc(it.label.slice(pos+q.length))
        : esc(it.label);
      return '<button type="button" class="ac-item'+(i===sel?" on":"")+'" role="option" aria-selected="'+(i===sel)+'" data-i="'+i+'">'+
        CG.crest(it.team,20)+'<span style="min-width:0"><b>'+lab+'</b><small>'+esc(it.sub)+'</small></span>'+
        '<span class="chip chip-xs" style="margin-left:auto;flex-shrink:0">'+(it.kind==="team"?"Club":"Player")+'</span></button>';
    }).join("");
  }
  function run(){
    var q = input.value.trim().toLowerCase();
    delete input.dataset.acId; delete input.dataset.acKind;
    input.classList.remove("ac-ok");
    if (!q){ cur = []; close(); if (opts.onClear) opts.onClear(); return; }
    cur = items.filter(function(it){ return it.label.toLowerCase().indexOf(q)>=0; }).slice(0,8);
    sel = cur.length ? 0 : -1;
    paint();
  }
  function pick(i){
    var it = cur[i]; if (!it) return;
    input.value = it.label;
    input.dataset.acId = it.id; input.dataset.acKind = it.kind;
    input.classList.add("ac-ok");
    close();
    if (opts.onPick) opts.onPick(it);
  }
  input.setAttribute("autocomplete","off");
  input.setAttribute("aria-autocomplete","list");
  input.addEventListener("input", run);
  input.addEventListener("keydown", function(e){
    if (menu.hidden) return;
    if (e.key==="ArrowDown"){ e.preventDefault(); sel = Math.min(cur.length-1, sel+1); paint(); }
    else if (e.key==="ArrowUp"){ e.preventDefault(); sel = Math.max(0, sel-1); paint(); }
    else if (e.key==="Enter"){ e.preventDefault(); pick(sel<0?0:sel); }
    else if (e.key==="Escape"){ close(); e.stopPropagation(); }
  });
  input.addEventListener("blur", function(){ setTimeout(close, 160); });
  menu.addEventListener("mousedown", function(e){ e.preventDefault(); });
  menu.addEventListener("click", function(e){
    var b = e.target.closest(".ac-item"); if (b) pick(+b.getAttribute("data-i"));
  });
};

/* ---------- toasts / modal / drawer ---------- */
CG.toast = function(msg, kind){
  var el = document.createElement("div");
  el.className = "toast"+(kind==="err"?" err":kind==="ok"?" ok":"");
  el.innerHTML = esc(msg);
  $("#toast-root").appendChild(el);
  setTimeout(function(){ el.style.opacity="0"; el.style.transition="opacity .3s"; setTimeout(function(){ el.remove(); },320); }, 2600);
};
CG.closeOverlay = function(){
  $("#overlay-root").innerHTML=""; document.body.style.overflow="";
  if (CG._lastFocus && document.body.contains(CG._lastFocus)){ try{ CG._lastFocus.focus(); }catch(e){} }
  CG._lastFocus = null;
};
CG.modal = function(title, bodyHtml, footHtml){
  CG._lastFocus = document.activeElement;
  document.body.style.overflow="hidden";
  $("#overlay-root").innerHTML =
    '<div class="ov-bg" data-close></div>'+
    '<div class="modal" role="dialog" aria-modal="true" aria-label="'+esc(title)+'">'+
      '<div class="mo-h"><h3>'+esc(title)+'</h3><button class="icon-btn" data-close aria-label="Close">'+CG.ic("x")+'</button></div>'+
      '<div class="mo-b">'+bodyHtml+'</div>'+
      (footHtml?'<div class="mo-f">'+footHtml+'</div>':"")+
    '</div>';
  var f = $(".modal input,.modal select,.modal textarea,.modal button:not([data-close])"); if (f) f.focus();
};
CG.drawer = function(title, bodyHtml){
  CG._lastFocus = document.activeElement;
  document.body.style.overflow="hidden";
  $("#overlay-root").innerHTML =
    '<div class="ov-bg" data-close></div>'+
    '<div class="drawer" role="dialog" aria-modal="true" aria-label="'+esc(title)+'">'+
      '<div class="dr-h"><h3 class="h-card">'+esc(title)+'</h3><button class="icon-btn" data-close aria-label="Close">'+CG.ic("x")+'</button></div>'+
      '<div class="dr-b">'+bodyHtml+'</div></div>';
  var db = $(".drawer [data-close]"); if (db) db.focus();
};
CG.confirm = function(title, msg, okLabel, fn){
  CG.modal(title, '<p style="color:var(--steel)">'+esc(msg)+'</p>',
    '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-ink" id="cfOk">'+esc(okLabel)+'</button>');
  $("#cfOk").addEventListener("click", function(){ CG.closeOverlay(); fn(); });
};

/* ---------- icons (mono-line, 24 viewBox) ---------- */
CG.IC = {
  x:'<path d="M6 6l12 12M18 6L6 18"/>', search:'<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  menu:'<path d="M4 7h16M4 12h16M4 17h16"/>', arrow:'<path d="M5 12h14M13 6l6 6-6 6"/>',
  back:'<path d="M19 12H5M11 18l-6-6 6-6"/>', cal:'<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>',
  chart:'<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>', shield:'<path d="M12 2 4 6v6c0 5 3.4 8.3 8 10 4.6-1.7 8-5 8-10V6l-8-4z"/>',
  users:'<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  user:'<circle cx="12" cy="8" r="4"/><path d="M4 20a8 8 0 0 1 16 0"/>', doc:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h4"/>',
  trophy:'<path d="M6 9V2h12v7a6 6 0 0 1-12 0zM6 5H3v2a3 3 0 0 0 3 3M18 5h3v2a3 3 0 0 1-3 3M9 20h6M12 15v5"/>',
  gear:'<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.4 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.4-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z"/>',
  flag:'<path d="M4 22V4a2 2 0 0 1 2-2h9l1 2h4v12h-8l-1-2H6"/>', clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
  play:'<path d="M6 4l14 8-14 8z"/>', lock:'<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  code:'<path d="m8 8-5 4 5 4M16 8l5 4-5 4"/>', up:'<path d="M12 19V5M5 12l7-7 7 7"/>', down:'<path d="M12 5v14M19 12l-7 7-7-7"/>',
  check:'<path d="M4 12l5 5L20 6"/>', plus:'<path d="M12 5v14M5 12h14"/>', out:'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
  grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  film:'<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M7 4v16M17 4v16M2 9h5M2 15h5M17 9h5M17 15h5"/>',
  db:'<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  home:'<path d="M3 11 12 3l9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/>', star:'<path d="m12 2 3 7 7 .6-5.2 4.8L18.5 22 12 18l-6.5 4 1.7-7.6L2 9.6 9 9z"/>',
  eye:'<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  msg:'<path d="M4 4h16v12H7l-3 3z"/>', dl:'<path d="M12 3v12M6 11l6 6 6-6M4 21h16"/>', ul:'<path d="M12 21V9M6 13l6-6 6 6M4 3h16"/>',
  swap:'<path d="M7 16V4M3 8l4-4 4 4M17 8v12M13 16l4 4 4-4"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon:'<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>'
};

/* ---------- theme (set from Settings → Appearance; "auto" follows the OS) ---------- */
CG.theme = function(){ return document.documentElement.getAttribute("data-theme")==="dark" ? "dark" : "light"; };
CG.themePref = function(){ return (CG.store.get("prefs")||{}).theme || "auto"; };
CG.applyTheme = function(pref){
  pref = ["light","dark","auto"].indexOf(pref)>=0 ? pref : "auto";
  var resolved = pref==="auto"
    ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : pref;
  document.documentElement.setAttribute("data-theme", resolved);
  var prefs = CG.store.get("prefs"); prefs.theme = pref; CG.store.set("prefs", prefs);
};
/* live OS-follow while in auto */
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function(){
  if (CG.themePref()==="auto") CG.applyTheme("auto");
});
CG.ic = function(name, size){
  return '<svg width="'+(size||18)+'" height="'+(size||18)+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+CG.IC[name]+'</svg>';
};

/* ---------- shared render bits ---------- */
CG.ovrClass = function(v){ return v>=88?"":"mid"; };
/* Last-five form. Shape carries the result — filled / half / hollow — because the old green-vs-red
   dots sit at ~1.26:1 for a deuteranope, which is colour-alone encoding (SC 1.4.1). A letter inside
   an 8px dot would just trade that for a 1.4.3 failure, so the dots stay wordless and the strip is
   announced once as a single image. */
CG.FORM5_CLASS = { W:"fd-w", OT:"fd-otl", L:"fd-l" };
CG.form5 = function(res){
  /* the standings exporter hands last5 around as a joined string; never let that render as dots */
  res = Array.isArray(res) ? res : [];
  if (!res.length) return '<span class="form5" aria-hidden="true"></span>';
  return '<span class="form5" role="img" aria-label="Last '+res.length+': '+esc(res.join(" "))+'">'+
    res.map(function(r){ return '<i class="'+(CG.FORM5_CLASS[r]||CG.FORM5_CLASS.L)+'"></i>'; }).join("")+'</span>';
};
CG.playerRoute = function(p){ return "#/player/"+p.id; };
CG.slugTeam = function(code){ return "#/team/"+code; };
CG.moveArrow = function(n){
  if (n>0) return '<span style="color:var(--green);font-weight:600">▲'+n+'</span>';
  if (n<0) return '<span style="color:var(--red);font-weight:600">▼'+(-n)+'</span>';
  return '<span style="color:var(--steel-2)">—</span>';
};
CG.exportCSV = function(name, rows){
  var csv = rows.map(function(r){ return r.map(function(c){
    c = String(c==null?"":c); return /[",\n]/.test(c) ? '"'+c.replace(/"/g,'""')+'"' : c; }).join(","); }).join("\n");
  var a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv],{type:"text/csv"}));
  a.download = name; a.click(); URL.revokeObjectURL(a.href);
  CG.toast("Exported "+name, "ok");
};
CG.sortTable = function(wrapEl){
  $$("th.sortable", wrapEl).forEach(function(th){
    th.setAttribute("tabindex","0"); th.setAttribute("role","button");
    th.setAttribute("aria-sort", th.classList.contains("sorted") ? (th.classList.contains("asc")?"ascending":"descending") : "none");
  });
  wrapEl.addEventListener("keydown", function(e){
    if ((e.key==="Enter"||e.key===" ") && e.target.closest("th.sortable")){ e.preventDefault(); e.target.closest("th.sortable").click(); }
  });
  wrapEl.addEventListener("click", function(e){
    var th = e.target.closest("th.sortable"); if (!th) return;
    var table = th.closest("table"), tbody = table.tBodies[0];
    var idx = Array.prototype.indexOf.call(th.parentNode.children, th);
    var asc = th.classList.contains("sorted") && !th.classList.contains("asc");
    $$("th", table).forEach(function(x){ x.classList.remove("sorted","asc"); if (x.classList.contains("sortable")) x.setAttribute("aria-sort","none"); });
    th.classList.add("sorted"); if (asc) th.classList.add("asc");
    th.setAttribute("aria-sort", asc?"ascending":"descending");
    var rows = $$("tbody tr", table);
    rows.sort(function(a,b){
      var av = a.children[idx].getAttribute("data-v")||a.children[idx].textContent;
      var bv = b.children[idx].getAttribute("data-v")||b.children[idx].textContent;
      var an = parseFloat(av), bn = parseFloat(bv);
      var cmp = (!isNaN(an)&&!isNaN(bn)) ? an-bn : String(av).localeCompare(String(bv));
      return asc ? cmp : -cmp;
    });
    rows.forEach(function(r){ tbody.appendChild(r); });
  });
};

/* ---------- notifications ---------- */
CG.baseNotifs = function(){
  var r = CG.role(), lg = CG.lg, n = [];
  if (r==="guest") return n;
  var feat = lg.tonight.find(function(g){ return g.feature; });
  if (lg.tonight.length) n.push({ id:"n-codes", t:CG.now()-2*3600000, icon:"code",
    title:"Game night — codes at T-30", body:"Tonight's private lobby codes go live on each matchup page 30 minutes before puck drop.", route: feat ? "#/matchup/"+feat.id : "#/schedule" });
  /* nothing to submit against until a game week exists — and with no deadline there is no date to
     put in the body, so the whole notification is withheld rather than shown half-empty */
  if (CG.WEEK8.open) n.push({ id:"n-avail", t:CG.now()-24*3600000, icon:"cal",
    title:CG.WEEK8.label+" availability is open", body:"Submit before "+CG.fmtFull(CG.WEEK8.deadline)+" (Rule 5.1).", route:"#/hub/availability" });
  if (lg.results.length) n.push({ id:"n-rank", t:CG.now()-12*3600000, icon:"chart",
    title:"Power rankings updated", body:"Recomputed from the latest finals.", route:"#/rankings" });
  var me = CG.me();
  var myGame = me && lg.tonight.find(function(g){ return g.home===me.team || g.away===me.team; });
  if (r==="member" && myGame){
    var opp = myGame.home===me.team ? myGame.away : myGame.home;
    var starting = Object.values(CG.plannedLineup(myGame, me.team)).indexOf(me.id)>=0;
    n.push({ id:"n-line", t:Date.parse("2026-07-15T18:05:00-04:00"), icon:"users",
      title: starting ? "You're in tonight's lineup" : "Tonight's lineup is posted",
      body: CG.TEAM[me.team].name+" vs "+CG.TEAM[opp].name+" — "+(starting?("starting "+CG.POS_NAME[me.pos]):"you're a scratch")+". Puck drop "+CG.fmtTime(myGame.at)+".",
      route:"#/hub" });
  }
  if (r==="mgmt" && myGame) n.push({ id:"n-lu", t:Date.parse("2026-07-15T17:30:00-04:00"), icon:"flag",
    title:"Lineup lock at "+CG.fmtTime(myGame.at-30*60000), body:"Submit tonight's lineup before the 30-minute lock (Rule 5.3).", route:"#/hub/lineup" });
  if (r==="staff" || r==="commish"){
    var openCases = CG.visibleComplaints().filter(function(c){ return c.status!=="Resolved"; }).length;
    if (openCases) n.push({ id:"n-case", t:CG.now()-3600000, icon:"flag",
      title: openCases+" open case"+(openCases===1?"":"s")+" in the league office", body:"Complaints and requests waiting on review.", route: r==="commish"?"#/admin/complaints":"#/hub/complaints" });
  }
  if (r==="commish" && lg.tonight.length) n.push({ id:"n-res", t:CG.now()-3600000, icon:"gear",
    title:"Tonight's finals import automatically", body:"EA stats writes scores + box scores after each game — check the EA stats panel if one hasn't landed.", route:"#/admin/eastats" });
  var extra = (CG.store.get("notifs")[r]||[]);
  return extra.concat(n).sort(function(a,b){ return b.t-a.t; });
};
CG.pushNotif = function(icon, title, body, route){
  var all = CG.store.get("notifs"); var r = CG.role();
  (all[r] = all[r]||[]).unshift({ id:"nx"+Date.now(), t:CG.now(), icon:icon, title:title, body:body, route:route });
  CG.store.set("notifs", all);
};
CG.unreadCount = function(){
  var read = CG.store.get("read");
  return CG.baseNotifs().filter(function(n){ return !read[n.id]; }).length;
};

/* ---------- chrome: demo bar, ticker, masthead, footer ---------- */
/* top-level links stay for the everyday pages; everything else lives in two
   grouped dropdowns so the bar keeps breathing room as sections grow */
CG.NAV = [
  ["Home","#/home"],["Schedule","#/schedule"],["Standings","#/standings"]
];
CG.NAV_GROUPS = [
  ["Clubs & Players", [
    ["Teams","#/teams","grid"],["Players","#/players","users"],
    ["Stats","#/stats","chart"],["Awards","#/awards","trophy"]
  ]],
  ["League Office", [
    ["News","#/news","msg"],["Rulebook","#/rulebook","db"],
    ["Apply — own a club","#/owner","shield"],["Apply — join the staff","#/staffapply","flag"]
  ]]
];
/* Does the signed-in user run a club (Owner / GM / AGM)? Independent of their
   league role — a commissioner or staff member can also own a club. */
CG.managesClub = function(){
  var me = CG.me();
  if (me && me.mgmt) return true;
  var uid = (CG.auth && CG.auth.user && CG.auth.user.id) || (me && me.id);
  if (!uid) return false;
  return (CG.TEAMS||[]).some(function(t){ return t.owner===uid || t.gm===uid || t.agm===uid; });
};
/* Every signed-in member always gets "My Hub" (the normal player hub). Every extra
   hat adds its own tab to the RIGHT of it — the tabs are ADDITIVE, not either/or,
   so a commissioner who also owns a club sees My Hub · Team HQ · Control Center. */
CG.hubTabs = function(){
  var r = CG.role();
  if (r==="guest") return [];
  var tabs = [["My Hub","#/hub","home"]];
  if (r==="mgmt" || CG.managesClub()) tabs.push(["Team HQ","#/hub/roster","users"]);
  /* the commissioner is league staff too — the desk is additive, like Team HQ */
  if (r==="staff" || r==="commish") tabs.push(["Staff Desk","#/hub/staffdesk","flag"]);
  if (r==="commish") tabs.push(["Control Center","#/admin","gear"]);
  return tabs;
};
/* back-compat: first tab (My Hub) for any older callers */
CG.hubLabel = function(){ var t = CG.hubTabs(); return t.length ? t[0] : null; };
CG.renderChrome = function(){
  /* demo bar (prototype only — the live site uses real Discord auth, no seat switcher) */
  var demobar = $("#demobar");
  if (CG.LIVE_MODE){
    if (demobar){ demobar.innerHTML = ""; demobar.style.display = "none"; }
  } else if (demobar){
    demobar.innerHTML = '<div class="shell">'+
      '<b>CHEL GAMING · PROTOTYPE</b><span class="db-lab2">Demo data · simulated Season 1 · demo clock '+CG.fmtFull(CG.now())+'</span>'+
      '<div class="db-roles" role="group" aria-label="Switch demo role">'+
        Object.keys(CG.PERSONAS).map(function(k){
          return '<button data-role="'+k+'" class="'+(CG.role()===k?"on":"")+'">'+CG.PERSONAS[k].label+'</button>';
        }).join("")+
        '<button class="db-reset" data-demo-reset title="Clear everything you changed in this demo">Reset</button>'+
      '</div></div>';
  }
  /* ticker: last night finals + tonight */
  var items = [];
  CG.lg.lastNight.forEach(function(r){
    var hw = r.score[r.home]>r.score[r.away];
    items.push('<a class="tk-item" href="#/matchup/'+r.id+'"><span class="tk-lab">FINAL'+(r.ot?"/OT":"")+'</span>'+
      '<b class="'+(hw?"win":"")+'">'+r.home+' '+r.score[r.home]+'</b><b class="'+(!hw?"win":"")+'">'+r.away+' '+r.score[r.away]+'</b></a>');
  });
  CG.lg.tonight.forEach(function(g){
    items.push('<a class="tk-item" href="#/matchup/'+g.id+'"><span class="tk-lab" style="color:var(--red)">TONIGHT</span>'+
      '<b>'+g.away+' @ '+g.home+'</b><span class="tk-lab">'+CG.fmtTime(g.at)+'</span></a>');
  });
  /* league leaders strip — every category links to the player */
  var ps = CG.lg.pstats;
  function tkLead(lab, p, val){
    return '<a class="tk-item tk-stat" href="'+CG.playerRoute(p)+'"><span class="tk-lab">'+lab+'</span>'+
      CG.crest(p.team,16)+'<b>'+esc(p.tag)+'</b><span class="tk-val num">'+val+'</span></a>';
  }
  var skaters = CG.lg.players.filter(function(p){ return p.pos!=="G" && ps[p.id].gp>0; });
  var minGpG = CG.lg.players.filter(function(p){ return p.pos==="G" && ps[p.id].gp>=3; });
  var ptsL = CG.skaterLeaders(CG.lg,"p")[0];
  var gL   = CG.skaterLeaders(CG.lg,"g")[0];
  var aL   = CG.skaterLeaders(CG.lg,"a")[0];
  var pmL  = skaters.slice().sort(function(a,b){ return ps[b.id].pm-ps[a.id].pm; })[0];
  var svL  = CG.goalieLeaders(CG.lg)[0];
  var gaaL = minGpG.slice().sort(function(a,b){ return ps[a.id].ga/ps[a.id].gp - ps[b.id].ga/ps[b.id].gp; })[0];
  if (ptsL) items.push(tkLead("POINTS", ptsL, ps[ptsL.id].p+" PTS"));
  if (gL)   items.push(tkLead("GOALS", gL, ps[gL.id].g+" G"));
  if (aL)   items.push(tkLead("ASSISTS", aL, ps[aL.id].a+" A"));
  if (svL)  items.push(tkLead("SV%", svL, (ps[svL.id].sv/Math.max(1,ps[svL.id].sa)).toFixed(3).replace(/^0/,"")));
  if (gaaL) items.push(tkLead("GAA", gaaL, (ps[gaaL.id].ga/ps[gaaL.id].gp).toFixed(2)));
  if (pmL)  items.push(tkLead("+/-", pmL, (ps[pmL.id].pm>0?"+":"")+ps[pmL.id].pm));
  /* pre-season / empty ticker: show the opening slate instead of a blank bar */
  if (!items.length){
    CG.lg.schedule.filter(function(g){ return g.at>CG.now(); }).sort(function(a,b){ return a.at-b.at; }).slice(0,8).forEach(function(g){
      items.push('<a class="tk-item" href="#/matchup/'+g.id+'"><span class="tk-lab">'+CG.fmtDay(g.at).toUpperCase()+'</span>'+
        '<b>'+g.away+' @ '+g.home+'</b><span class="tk-lab">'+CG.fmtTime(g.at)+'</span></a>');
    });
    if (!items.length) items.push('<span class="tk-item"><span class="tk-lab">CHEL GAMING HOCKEY LEAGUE</span><b>Season 1 — the inaugural season</b></span>');
  }
  var tk = items.join("");
  $("#ticker").innerHTML = '<div class="tk-track"><div style="display:flex;height:100%">'+tk+'</div><div style="display:flex;height:100%" aria-hidden="true">'+tk+'</div></div>';
  /* masthead */
  var hubTabs = CG.hubTabs();
  var me = CG.me(); var p = CG.persona();
  $("#masthead").innerHTML = '<div class="shell mh">'+
    '<a class="mh-brand" href="#/home" aria-label="Chel Gaming home">'+CG.leagueMark(36)+
      '<span class="wm"><b>CHEL GAMING</b><span>Hockey League</span></span></a>'+
    '<nav class="mh-nav" aria-label="Primary">'+
      CG.NAV.map(function(n){ return '<a href="'+n[1]+'" data-navlink>'+n[0]+'</a>'; }).join("")+
      (CG.NAV_GROUPS||[]).map(function(g,gi){
        return '<div class="mh-dd"><a href="'+g[1][0][1]+'" data-dd="navg'+gi+'" aria-haspopup="true" aria-expanded="false">'+g[0]+CG.ic("down",11)+'</a>'+
          '<div class="pop" id="pop-navg'+gi+'" hidden>'+g[1].map(function(n){
            return '<a class="pop-item" href="'+n[1]+'">'+CG.ic(n[2]||"home",16)+n[0]+'</a>';
          }).join("")+'</div></div>';
      }).join("")+
      (hubTabs.length>1
        /* several hats: one compact "Dashboards" dropdown keeps the bar breathable */
        ? '<div class="mh-dd"><a href="'+hubTabs[0][1]+'" id="ddDash" data-dd="dash" aria-haspopup="true" aria-expanded="false">Dashboards'+CG.ic("down",11)+'</a>'+
          '<div class="pop" id="ddDashPop" hidden>'+hubTabs.map(function(h){
            return '<a class="pop-item" href="'+h[1]+'">'+CG.ic(h[2]||"home",16)+h[0]+'</a>';
          }).join("")+'</div></div>'
        : hubTabs.map(function(h){ return '<a href="'+h[1]+'" data-navlink>'+h[0]+'</a>'; }).join(""))+
    '</nav>'+
    '<div class="mh-right">'+
      '<button class="icon-btn" id="searchBtn" aria-label="Search (press /)" title="Search ( / )">'+CG.ic("search")+'</button>'+
      (CG.role()!=="guest"
        ? '<button class="icon-btn" id="bellBtn" aria-label="Notifications" style="position:relative">'+CG.ic("bell")+
            (CG.unreadCount()?'<span class="bub">'+CG.unreadCount()+'</span>':"")+'</button>'
        : "")+
      (CG.role()==="guest"
        /* for a guest this button IS the sign-up: Discord OAuth creates the account. "Sign in"
           read as members-only and hid the funnel entry from everyone who hadn't joined yet. */
        /* "with Discord" drops below 520px — at 375 the full label plus the burger overflowed the
           header and gave the whole document a horizontal scrollbar. The glyph carries the meaning
           once the words are gone, so the accessible name stays complete either way. */
        ? '<a class="btn btn-sm" href="#/signin" aria-label="Join with Discord" style="min-height:42px;background:#5865F2;color:#fff">'+CG.DISCORD_GLYPH+'Join<span class="hide-xs"> with Discord</span></a>'
        : '<button class="avatar" id="avBtn" aria-label="Account menu" title="'+esc(p.tag||"")+'">'+CG.avatarHtml()+'</button>')+
      '<button class="icon-btn mh-burger" id="burger" aria-label="Menu">'+CG.ic("menu")+'</button>'+
    '</div></div>';
  /* mobile nav */
  /* the mobile menu stays a flat, complete list: top-level + both groups + hub tabs */
  var mnav = CG.NAV.concat(
    (CG.NAV_GROUPS||[]).reduce(function(acc,g){ return acc.concat(g[1].map(function(n){ return [n[0],n[1]]; })); }, []),
    hubTabs);
  $("#mobilenav").innerHTML = '<div class="mn-h">'+CG.leagueMark(34)+
    '<button class="icon-btn" data-mn-close aria-label="Close menu" style="border-color:#39434B;background:transparent;color:#fff">'+CG.ic("x")+'</button></div>'+
    '<div class="mn-g">League</div>'+
    mnav.map(function(n){ return '<a href="'+n[1]+'">'+n[0]+' <span style="color:var(--chrome)">→</span></a>'; }).join("")+
    '<div class="mn-g">Account</div>'+
    (CG.role()==="guest" ? '<a href="#/signin">Sign in</a>' :
      (CG.LIVE_MODE?'<a href="#/hub/messages">Messages</a>':"")+'<a href="#/hub/notifications">Notifications</a><a href="#/hub/settings">Settings</a><a href="#/signin">Switch role</a>');
  /* footer */
  $("#sitefoot").innerHTML = '<div class="shell">'+
    '<div class="ft-top">'+
      '<div>'+CG.leagueMark(40)+'<p style="margin-top:14px;max-width:30ch;font-size:13.5px;color:var(--on-ink-dim)">The competitive home of 6v6 EA Sports NHL 27. Run by players, for players — since Season 1.</p>'+
      (CG.LIVE_MODE?'</div>':'<div style="margin-top:16px"><span class="protopill"><span class="live-dot"></span>Prototype — demo data, not the live site</span></div></div>')+
      '<div><h4>League</h4><a class="fl" href="#/schedule">Schedule</a><a class="fl" href="#/standings">Standings</a><a class="fl" href="#/rankings">Power Rankings</a><a class="fl" href="#/awards">Awards</a></div>'+
      '<div><h4>Clubs & Players</h4><a class="fl" href="#/teams">All Clubs</a><a class="fl" href="#/players">Player Directory</a><a class="fl" href="#/stats">Stat Central</a></div>'+
      '<div><h4>League Office</h4><a class="fl" href="#/news">News</a><a class="fl" href="#/rulebook">Rulebook</a><a class="fl" href="#/hub/complaints">Complaints</a>'+
        /* the only registration entry points were both on the homepage; the footer is on every page */
        (CG.SEASON && CG.SEASON.registration_open ? '<a class="fl" href="#/register">Register to play</a>' : "")+
        (CG.LIVE_MODE?'<a class="fl" href="#/owner">Apply — own a club</a><a class="fl" href="#/staffapply">Apply — join the staff</a>':'<a class="fl" href="#/blueprint">Platform Blueprint</a>')+'</div>'+
      '<div><h4>Account</h4>'+(CG.role()==="guest"?'<a class="fl" href="#/signin">Sign in</a>':'<a class="fl" href="#/hub">Dashboard</a><a class="fl" href="#/hub/settings">Settings</a>')+(CG.LIVE_MODE?'':'<a class="fl" href="#/signin">Switch demo role</a>')+'</div>'+
    '</div>'+
    '<div class="ft-base"><span>© '+CG.seasonYear()+' Chel Gaming Hockey League · '+esc(CG.seasonTag())+'</span><span><a href="#/legal" style="color:inherit">Terms &amp; Privacy</a> · All times Eastern</span></div>'+
  '</div>';
  CG.markActiveNav();
};
CG.markActiveNav = function(){
  var h = location.hash || "#/home";
  var base = h.split("/")[1];
  $$("#masthead [data-navlink]").forEach(function(a){
    a.classList.toggle("on", a.getAttribute("href").split("/")[1]===base);
  });
  /* every dropdown trigger lights up when one of its destinations is active */
  $$("#masthead .mh-dd").forEach(function(dd){
    var trig = dd.querySelector("[data-dd]");
    if (!trig) return;
    var active = Array.prototype.some.call(dd.querySelectorAll(".pop a"), function(a){
      return a.getAttribute("href").split("/")[1]===base;
    });
    trig.classList.toggle("on", active);
  });
};
CG.closeNavPops = function(){
  $$("#masthead .mh-dd").forEach(function(dd){
    var pop = dd.querySelector(".pop"), trig = dd.querySelector("[data-dd]");
    if (pop && !pop.hidden){ pop.hidden = true; if (trig) trig.setAttribute("aria-expanded","false"); }
  });
};
CG.closeDashPop = function(){ CG.closeNavPops(); }; /* back-compat alias */

/* ---------- carousel component ---------- */
CG.carousel = function(rootSel, slides, opts){
  var root = $(rootSel); if (!root || !slides.length) return;
  var idx = 0, timer = null, reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  var interval = (opts&&opts.interval)||7000;
  root.innerHTML = '<div class="caro-track">'+
      slides.map(function(s,i){ return '<div class="slide'+(i===0?" on":"")+'" role="group" aria-roledescription="slide" aria-label="Slide '+(i+1)+' of '+slides.length+'">'+s+'</div>'; }).join("")+
    '</div>'+
    '<div class="caro-ctl">'+
      '<div class="caro-dots" role="tablist" aria-label="Slides">'+slides.map(function(_,i){
        return '<button role="tab" aria-selected="'+(i===0)+'" aria-label="Go to slide '+(i+1)+'" data-dot="'+i+'" class="'+(i===0?"on":"")+'"></button>'; }).join("")+'</div>'+
      '<button class="caro-btn" data-prev aria-label="Previous slide">'+CG.ic("back",16)+'</button>'+
      '<button class="caro-btn" data-next aria-label="Next slide">'+CG.ic("arrow",16)+'</button>'+
    '</div>';
  root.setAttribute("tabindex","0");
  root.setAttribute("aria-roledescription","carousel");
  function go(n){
    idx = (n+slides.length)%slides.length;
    $$(".slide",root).forEach(function(el,i){ el.classList.toggle("on", i===idx); });
    $$("[data-dot]",root).forEach(function(d,i){ d.classList.toggle("on", i===idx); d.setAttribute("aria-selected", i===idx); });
  }
  function play(){ if (reduced) return; stop(); timer = setInterval(function(){ go(idx+1); }, interval); }
  function stop(){ if (timer){ clearInterval(timer); timer=null; } }
  root.addEventListener("click", function(e){
    if (e.target.closest("[data-prev]")){ go(idx-1); play(); }
    if (e.target.closest("[data-next]")){ go(idx+1); play(); }
    var d = e.target.closest("[data-dot]"); if (d){ go(+d.getAttribute("data-dot")); play(); }
  });
  root.addEventListener("keydown", function(e){
    if (e.key==="ArrowLeft"){ e.preventDefault(); go(idx-1); }
    if (e.key==="ArrowRight"){ e.preventDefault(); go(idx+1); }
  });
  root.addEventListener("mouseenter", stop); root.addEventListener("mouseleave", play);
  root.addEventListener("focusin", stop);   root.addEventListener("focusout", play);
  var tx = null;
  root.addEventListener("touchstart", function(e){ tx = e.touches[0].clientX; stop(); }, {passive:true});
  root.addEventListener("touchend", function(e){
    if (tx==null) return;
    var dx = e.changedTouches[0].clientX - tx;
    if (Math.abs(dx)>44) go(idx + (dx<0?1:-1));
    tx = null; play();
  }, {passive:true});
  play();
};

/* ---------- global search ---------- */
CG.searchIndex = function(){
  var lg = CG.lg, ix = [];
  lg.players.forEach(function(p){
    ix.push({ cat:"Players", label:p.tag, sub:CG.TEAM[p.team].name+" · "+p.pos, route:CG.playerRoute(p), key:p.tag.toLowerCase() });
  });
  CG.TEAMS.forEach(function(t){
    ix.push({ cat:"Teams", label:t.name, sub:t.div+" Division · "+t.city, route:CG.slugTeam(t.code), key:(t.name+" "+t.code).toLowerCase() });
  });
  CG.CONTENT.articles.forEach(function(a){
    ix.push({ cat:"News", label:a.title, sub:a.category, route:"#/article/"+a.slug, key:(a.title+" "+a.tags.join(" ")).toLowerCase() });
  });
  CG.CONTENT.rulebook.chapters.forEach(function(ch){
    ch.sections.forEach(function(s){
      ix.push({ cat:"Rulebook", label:"Rule "+s.id+" — "+s.title, sub:"Chapter "+ch.num+": "+ch.title, route:"#/rulebook?rule="+s.id, key:(s.id+" "+s.title+" "+ch.title).toLowerCase() });
    });
  });
  lg.schedule.forEach(function(g){
    var done = (lg.allResults||lg.results).some(function(r){ return r.id===g.id; });
    ix.push({ cat:"Games", label:CG.TEAM[g.away].name+" @ "+CG.TEAM[g.home].name,
      sub:(g.stage==="preseason"?"Pre-season week ":g.stage==="playoff"?"Playoff week ":"Week ")+g.week+" · "+CG.fmtDay(g.at)+(done?" · Final":""), route:"#/matchup/"+g.id,
      key:(CG.TEAM[g.away].name+" "+CG.TEAM[g.home].name+" week "+g.week).toLowerCase() });
  });
  return ix;
};
CG.fuzzy = function(hay, q){
  if (hay.indexOf(q)>=0) return 2;
  /* light typo tolerance: all chars in order */
  var i=0; for (var c of q){ i = hay.indexOf(c, i); if (i<0) return 0; i++; }
  return 1;
};
CG.openPalette = function(){
  if ($("#palette")) return;
  var el = document.createElement("div");
  el.id = "palette"; el.className="open";
  el.innerHTML = '<div class="pal-bg" data-close></div><div class="pal" role="dialog" aria-modal="true" aria-label="Search">'+
    '<input id="palIn" type="search" placeholder="Search players, teams, games, news, rules…" autocomplete="off" aria-label="Search query">'+
    '<div class="pal-res" id="palRes"></div>'+
    '<div class="pal-foot"><span><kbd>↑↓</kbd> navigate</span><span><kbd>↵</kbd> open</span><span><kbd>esc</kbd> close</span></div></div>';
  document.body.appendChild(el);
  var ix = CG.searchIndex(), sel = 0, results = [];
  function paint(){
    var box = $("#palRes");
    if (!results.length){
      var recent = CG.store.get("recentSearch");
      box.innerHTML = recent.length
        ? '<div class="pal-group">Recent</div>'+recent.map(function(r,i){
            return '<button class="pal-item'+(i===sel?" on":"")+'" data-i="'+i+'" data-route="'+esc(r.route)+'">'+CG.ic("clock",14)+esc(r.label)+'</button>'; }).join("")
        : '<div class="empty" style="padding:26px"><b>Search the league</b><p>Players, clubs, games, news stories, and rulebook sections.</p></div>';
      results = recent.map(function(r){ return { route:r.route, label:r.label }; });
      return;
    }
    var byCat = {};
    results.forEach(function(r){ (byCat[r.cat]=byCat[r.cat]||[]).push(r); });
    var i = 0;
    box.innerHTML = Object.keys(byCat).map(function(cat){
      return '<div class="pal-group">'+cat+'</div>'+byCat[cat].map(function(r){
        var cur = i++;
        return '<button class="pal-item'+(cur===sel?" on":"")+'" data-i="'+cur+'" data-route="'+esc(r.route)+'" data-label="'+esc(r.label)+'">'+
          '<span>'+r.hl+'</span><span class="pi-meta">'+esc(r.sub)+'</span></button>';
      }).join("");
    }).join("");
    var on = $(".pal-item.on"); if (on) on.scrollIntoView({block:"nearest"});
  }
  function run(q){
    q = q.trim().toLowerCase(); sel = 0;
    if (!q){ results = []; paint(); return; }
    results = ix.map(function(r){ return Object.assign({score:CG.fuzzy(r.key,q)},r); })
      .filter(function(r){ return r.score>0; })
      .sort(function(a,b){ return b.score-a.score; }).slice(0,14)
      .map(function(r){
        var pos = r.label.toLowerCase().indexOf(q);
        r.hl = pos>=0
          ? esc(r.label.slice(0,pos))+"<mark>"+esc(r.label.slice(pos,pos+q.length))+"</mark>"+esc(r.label.slice(pos+q.length))
          : esc(r.label);
        return r;
      });
    /* flatten order = category walk order used in paint */
    var byCat = {}; results.forEach(function(r){ (byCat[r.cat]=byCat[r.cat]||[]).push(r); });
    results = Object.keys(byCat).reduce(function(acc,c){ return acc.concat(byCat[c]); },[]);
    paint();
  }
  function open(route, label){
    if (label){
      var rec = CG.store.get("recentSearch").filter(function(r){ return r.route!==route; });
      rec.unshift({route:route,label:label}); CG.store.set("recentSearch", rec.slice(0,5));
    }
    close(); location.hash = route;
  }
  function close(){ el.remove(); }
  el.addEventListener("click", function(e){
    if (e.target.closest("[data-close]")) close();
    var it = e.target.closest(".pal-item"); if (it) open(it.getAttribute("data-route"), it.getAttribute("data-label"));
  });
  $("#palIn").addEventListener("input", function(){ run(this.value); });
  $("#palIn").addEventListener("keydown", function(e){
    var n = $$(".pal-item").length;
    if (e.key==="ArrowDown"){ e.preventDefault(); sel=Math.min(n-1,sel+1); paint(); }
    if (e.key==="ArrowUp"){ e.preventDefault(); sel=Math.max(0,sel-1); paint(); }
    if (e.key==="Enter"){ var on=$(".pal-item.on")||$$(".pal-item")[0]; if (on) open(on.getAttribute("data-route"), on.getAttribute("data-label")); }
    if (e.key==="Escape") close();
  });
  paint(); $("#palIn").focus();
};

/* ---------- notifications panel ---------- */
CG.openBell = function(){
  var read = CG.store.get("read");
  var list = CG.baseNotifs();
  CG.drawer("Notifications",
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">'+
      '<span class="caption">'+list.filter(function(n){return !read[n.id];}).length+' unread</span>'+
      '<button class="btn btn-ghost btn-sm" id="markAll">Mark all as read</button></div>'+
    '<div class="card">'+ (list.length ? list.map(function(n){
      return '<div class="notif'+(read[n.id]?"":" unread")+'" data-notif="'+n.id+'" data-route="'+esc(n.route||"")+'">'+
        '<span class="nf-ic">'+CG.ic(n.icon||"bell",16)+'</span>'+
        '<span style="min-width:0"><b>'+esc(n.title)+'</b><p>'+esc(n.body)+'</p></span>'+
        '<span class="nf-t">'+CG.fmtDay(n.t)+'</span></div>';
    }).join("") : '<div class="empty"><b>All caught up</b><p>League alerts land here — codes, lineups, rulings, and deadlines.</p></div>')+'</div>');
  $("#markAll").addEventListener("click", function(){
    var r = CG.store.get("read");
    list.forEach(function(n){ r[n.id]=true; });
    CG.store.set("read", r); CG.closeOverlay(); CG.renderChrome();
  });
};

/* ---------- router ---------- */
CG.ROUTES = {};  /* filled by page files: CG.ROUTES.home = fn(param) -> html; CG.AFTER.home = fn(param) */
CG.AFTER = {};

/* Document titles. This is a hash-routed SPA, so nothing updates the title for free — without
   this every one of the 26 routes shares the boot title, which breaks browser history, bookmarks,
   tab-switching, and the page announcement most screen readers make on navigation.
   These constants are the fallback on purpose: reading document.title to seed a default would
   pick up whatever the PREVIOUS route left behind (or a clobbered value) rather than the truth. */
CG.SITE_TITLE = "Chel Gaming Hockey League";
CG.HOME_TITLE = "Chel Gaming Hockey League — Competitive 6v6 EA NHL";
CG.ROUTE_TITLES = {
  standings:  "Standings",
  schedule:   "Schedule",
  rankings:   "Power Rankings",
  stats:      "Stat Central",
  awards:     "Awards",
  teams:      "All Clubs",
  team:       "Club",
  players:    "Player Directory",
  player:     "Player",
  matchup:    "Matchup",
  news:       "News",
  article:    "News",
  rulebook:   "Rulebook",
  draft:      "Draft Room",
  register:   "Register to play",
  owner:      "Apply to own a club",
  staffapply: "Apply to join the staff",
  signin:     "Sign in",
  hub:        "My Dashboard",
  admin:      "Control Center",
  messages:   "Messages",
  search:     "Search",
  legal:      "Terms & Privacy",
  blueprint:  "Platform Blueprint",
  _404:       "Page not found"
};
/* A rendered <h1> names the actual subject (this club, this player, this headline), so it beats the
   generic map wherever a page has one. Home is the exception: its h1 is a visually-hidden landmark
   heading, and the marketing title is what belongs in the tab. */
CG.pageTitleFor = function(name, root){
  if (name==="home") return CG.HOME_TITLE;
  var h1 = root && root.querySelector("h1");
  var lead = h1 ? h1.textContent.replace(/\s+/g," ").trim() : "";
  /* long article headlines get cut at a word boundary — a tab strip only shows the first few words
     anyway, and a mid-word stub reads like a rendering bug */
  if (lead.length > 70) lead = lead.slice(0,70).replace(/\s+\S*$/,"")+"…";
  if (!lead) lead = CG.ROUTE_TITLES[name] || CG.ROUTE_TITLES._404;
  return lead===CG.SITE_TITLE ? lead : lead+" · "+CG.SITE_TITLE;
};
CG.router = function(){
  var h = location.hash || "#/home";
  var parts = h.replace(/^#\//,"").split("?")[0].split("/");
  var name = parts[0]||"home", param = parts.slice(1).join("/")||null;
  var qs = {};
  (h.split("?")[1]||"").split("&").forEach(function(kv){ if(!kv)return; var p=kv.split("="); qs[decodeURIComponent(p[0])]=decodeURIComponent(p[1]||""); });
  var fn = CG.ROUTES[name] || CG.ROUTES._404;
  var app = $("#app");
  app.innerHTML = '<div class="pg">'+fn(param, qs)+'</div>';
  window.scrollTo({top:0, left:0, behavior:"instant"});
  CG.markActiveNav();
  /* a11y: every clickable data-go target is keyboard-reachable */
  $$("#app [data-go]").forEach(function(el){
    if (el.closest("a,button") || el.tagName==="A" || el.tagName==="BUTTON") return;
    if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex","0");
    if (!el.hasAttribute("role")) el.setAttribute("role","link");
  });
  if (CG.AFTER[name]) CG.AFTER[name](param, qs);
  /* must land before focus moves: screen readers read the title when #app takes focus */
  document.title = CG.pageTitleFor(CG.ROUTES[name] ? name : "_404", app);
  app.focus({preventScroll:true});
};

/* ---------- global event wiring ---------- */
document.addEventListener("keydown", function(e){
  if (e.key==="Escape") CG.closeDashPop();
});
document.addEventListener("click", function(e){
  var t;
  if ((t = e.target.closest("[data-role]")) && t.closest("#demobar")){ CG.setRole(t.getAttribute("data-role")); return; }
  if (e.target.closest("[data-demo-reset]")){ CG.confirm("Reset the demo?","Clears every change you made in this prototype — availability, lineups, entered results, edits.","Reset demo", function(){ CG.store.reset(); }); return; }
  if (e.target.closest("#searchBtn")){ CG.openPalette(); return; }
  if (e.target.closest("#bellBtn")){ CG.openBell(); return; }
  var ddTrig = e.target.closest("[data-dd]");
  if (ddTrig && ddTrig.closest(".mh-dd")){
    e.preventDefault();
    var pop = ddTrig.closest(".mh-dd").querySelector(".pop");
    var wasOpen = pop && !pop.hidden;
    CG.closeNavPops();
    if (pop && !wasOpen){ pop.hidden = false; ddTrig.setAttribute("aria-expanded","true"); }
    return;
  }
  if (e.target.closest(".mh-dd .pop a")){ CG.closeNavPops(); /* fall through: let the link navigate */ }
  else if (!e.target.closest(".mh-dd")) CG.closeNavPops();
  if (e.target.closest("#avBtn")){
    var p = CG.persona();
    CG.drawer("Account", '<div class="pop-h" style="padding:0 0 14px"><span class="avatar">'+CG.avatarHtml()+'</span>'+
      '<div><b style="display:block">'+esc(p.tag||"Guest")+'</b><span class="caption">'+esc(p.who)+'</span></div></div>'+
      '<div class="stack" style="gap:4px">'+
      '<a class="pop-item" href="#/hub" data-close-nav>'+CG.ic("home",16)+(CG.role()==="commish"?"Control Center":"My dashboard")+'</a>'+
      (CG.me()?'<a class="pop-item" href="'+CG.playerRoute(CG.me())+'" data-close-nav>'+CG.ic("user",16)+'My player profile</a>':"")+
      (CG.LIVE_MODE?'<a class="pop-item" href="#/hub/messages" data-close-nav>'+CG.ic("msg",16)+'Messages'+
        (CG.dmUnreadTotal&&CG.dmUnreadTotal()?'<span class="hs-n" style="margin-left:auto">'+CG.dmUnreadTotal()+'</span>':"")+'</a>':"")+
      '<a class="pop-item" href="#/hub/notifications" data-close-nav>'+CG.ic("bell",16)+'Notifications</a>'+
      '<a class="pop-item" href="#/hub/settings" data-close-nav>'+CG.ic("gear",16)+'Settings</a>'+
      '<div class="pop-sep"></div>'+
      '<a class="pop-item" href="#/signin" data-close-nav>'+CG.ic("out",16)+'Sign out</a>'+
      '</div>');
    return;
  }
  if (e.target.closest("#burger")){ $("#mobilenav").classList.add("open"); $("#mobilenav").setAttribute("aria-hidden","false"); var fl=$("#mobilenav a"); if (fl) fl.focus(); return; }
  if (e.target.closest("[data-mn-close]")){ CG.closeMobileNav(); return; }
  if (e.target.closest("#mobilenav a")){ CG.closeMobileNav(); return; }
  if (e.target.closest("[data-close-nav]")){ CG.closeOverlay(); return; }
  if (e.target.closest("[data-close]")){ CG.closeOverlay(); return; }
  var nf = e.target.closest("[data-notif]");
  if (nf){
    var r = CG.store.get("read"); r[nf.getAttribute("data-notif")]=true; CG.store.set("read", r);
    var route = nf.getAttribute("data-route");
    CG.closeOverlay(); CG.renderChrome();
    if (route){
      if (/^https?:\/\//.test(route)) window.open(route, "_blank", "noopener");  /* e.g. the Discord invite */
      else location.hash = route;
    }
    return;
  }
  var go = e.target.closest("[data-go]");
  if (go){ location.hash = go.getAttribute("data-go"); return; }
});
document.addEventListener("keydown", function(e){
  if (e.key==="/" && !e.target.closest("input,textarea,select")){ e.preventDefault(); CG.openPalette(); }
  if (e.key==="Escape"){ CG.closeOverlay(); var pal=$("#palette"); if (pal) pal.remove(); CG.closeMobileNav(); }
  /* keyboard activation for data-go rows/cards */
  if ((e.key==="Enter"||e.key===" ") && e.target.getAttribute && e.target.getAttribute("data-go") && !e.target.closest("a,button,input,select,textarea")){
    e.preventDefault(); location.hash = e.target.getAttribute("data-go");
  }
  /* focus trap inside open modal/drawer */
  if (e.key==="Tab"){
    var ov = $("#overlay-root .modal, #overlay-root .drawer");
    if (ov){
      var f = $$("a[href],button:not([disabled]),input,select,textarea,[tabindex='0']", ov)
        .filter(function(x){ return x.offsetParent!==null; });
      if (f.length){
        var first=f[0], last=f[f.length-1];
        if (e.shiftKey && document.activeElement===first){ e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement===last){ e.preventDefault(); first.focus(); }
        else if (!ov.contains(document.activeElement)){ e.preventDefault(); first.focus(); }
      }
    }
  }
});
CG.closeMobileNav = function(){
  var mn = $("#mobilenav");
  mn.classList.remove("open");
  mn.setAttribute("aria-hidden","true");
};
window.addEventListener("hashchange", CG.router);
