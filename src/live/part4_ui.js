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
/* Avatars come from the signed-in Discord profile (CG.avatarHtml in part_live.js reads
   profile.avatar_url); the prototype's bundled portraits were never reachable in the live
   build and cost every visitor ~50 KB. PERSONAS keeps its labels, just not the artwork. */
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
/* The C/G power mark. Default is the dark badge (light C + chrome crossbar on a near-black tile),
   which is what every current caller sits on — the masthead, mobile nav and footer all live on the
   constant-dark broadcast surface. Pass a variant for light surfaces:
     "light"      transparent, ink C + gold crossbar — drops onto any light background
     "light-tile" the same mark on a white tile with a hairline border — the badge form
   Chrome yellow (#FFE500) is ~1.07:1 on white, so the light variants deepen it to gold to stay
   legible while reading as the same brand yellow. */
CG.leagueMark = function(s, variant){
  var open = '<svg class="crest" width="'+s+'" height="'+s+'" viewBox="0 0 48 48" role="img" aria-label="Chel Gaming">';
  var cArc = function(stroke){ return '<path d="M35.5 17.4 A13 13 0 1 0 35.5 30.6" fill="none" stroke="'+stroke+'" stroke-width="3.4" stroke-linecap="round"/>'; };
  var cross = function(stroke){ return '<path d="M35 24 H28" fill="none" stroke="'+stroke+'" stroke-width="3.6" stroke-linecap="round"/>'; };
  if (variant==="light")
    return open + cArc("#101519") + cross("#D9A800") + '</svg>';
  if (variant==="light-tile")
    return open + '<rect x="1" y="1" width="46" height="46" rx="10.5" fill="#FFFFFF" stroke="#E3E6DF" stroke-width="1.4"/>'
      + cArc("#101519") + cross("#D9A800") + '</svg>';
  return open + '<rect width="48" height="48" rx="11" fill="#0a0a0a"/>'
    + '<path d="M35.5 17.4 A13 13 0 1 0 35.5 30.6" fill="none" stroke="#f4f4f0" stroke-width="3.4" stroke-linecap="round"/>'
    + '<path d="M35 24 H28" fill="none" stroke="#ffe500" stroke-width="3.4" stroke-linecap="round"/></svg>';
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
  sound:'<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
  mute:'<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M22 9l-6 6M16 9l6 6"/>',
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
      '<div><h4>League Office</h4><a class="fl" href="#/news">News</a><a class="fl" href="#/rulebook">Rulebook</a><a class="fl" href="#/brand">Brand</a><a class="fl" href="#/hub/complaints">Complaints</a>'+
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
  ix.push({ cat:"Pages", label:"Brand & identity", sub:"Logos, colour, type, and voice", route:"#/brand", key:"brand identity logo logos colour color typography font voice guidelines press kit" });
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
    '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px">'+
      '<span class="caption">'+list.filter(function(n){return !read[n.id];}).length+' unread</span>'+
      '<span style="display:flex;gap:6px">'+
        (CG.sound ? '<button class="btn btn-ghost btn-sm" id="soundToggle" title="Play a sound for new alerts and messages" aria-pressed="'+(CG.sound.isOn()?"true":"false")+'">'+
          CG.ic(CG.sound.isOn()?"sound":"mute",15)+(CG.sound.isOn()?"Sound on":"Muted")+'</button>' : '')+
        '<button class="btn btn-ghost btn-sm" id="markAll">Mark all as read</button></span></div>'+
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
  var st = $("#soundToggle");
  if (st) st.addEventListener("click", function(){
    var on = CG.sound.toggle();   /* plays a sample chime when turning on */
    this.setAttribute("aria-pressed", on?"true":"false");
    this.innerHTML = CG.ic(on?"sound":"mute",15)+(on?"Sound on":"Muted");
    CG.toast(on?"Notification sound on":"Notification sound muted","ok");
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
  brand:      "Brand & identity",
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
