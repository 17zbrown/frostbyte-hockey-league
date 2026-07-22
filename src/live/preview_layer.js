/* ================================================================
   PREVIEW LAYER — loaded ONLY in preview.html (never index.html).
   Direction: the framed-canvas look — a dark, warmly lit surround
   holding one large rounded light canvas; floating pill nav; an
   elegant serif hero; and a dark showcase panel carrying a live
   statistical dashboard (animated counters, a real sign-up curve,
   position mix) built ONLY from league data.
   Every route, module, and behavior is the production code
   untouched; overrides fail safe to the original rendering.
   ================================================================ */
(function(){
  "use strict";

  /* serif display + Sora for everything else */
  var fl = document.createElement("link");
  fl.rel = "stylesheet";
  fl.href = "https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Sora:wght@300;400;600;700&display=swap";
  document.head.appendChild(fl);

  /* Zuume (Adobe Fonts): paste the web-project id from fonts.adobe.com and the
     real face takes over everywhere; until then Bebas Neue stands in. */
  var TYPEKIT_ID = "dvf3fqu";
  if (TYPEKIT_ID){
    var tk = document.createElement("link");
    tk.rel = "stylesheet"; tk.href = "https://use.typekit.net/" + TYPEKIT_ID + ".css";
    document.head.appendChild(tk);
  }

  var css = ''+
  ':root{--f-sharp:"Sora",-apple-system,sans-serif;--f-display:"zuume","Bebas Neue",Impact,sans-serif}'+

  /* ---- the dark, warmly lit surround + the floating canvas ---- */
  'html[data-theme="light"] body,body{background:#16110C!important;background-image:'+
    'radial-gradient(900px 520px at 85% -5%,rgba(255,170,60,.30),transparent 60%),'+
    'radial-gradient(820px 540px at 6% 18%,rgba(255,84,40,.18),transparent 60%),'+
    'radial-gradient(1100px 720px at 50% 112%,rgba(255,229,0,.10),transparent 65%)!important}'+
  '#pv-frame{width:calc(100% - clamp(20px,3.5vw,56px));max-width:1720px;margin:0 auto 48px;'+
    'border-radius:30px;overflow:clip;background:var(--paper);box-shadow:0 30px 90px rgba(0,0,0,.55);position:relative}'+
  '#pv-ribbon{background:transparent;color:#E8C05A;font-family:var(--f-sharp);font-size:10.5px;font-weight:600;'+
    'letter-spacing:.14em;text-transform:uppercase;text-align:center;padding:9px 12px 3px}'+

  /* ---- masthead on the dark surround; the nav is a white tab fused to the canvas ---- */
  '#masthead{position:static!important;background:transparent!important;border-bottom:0!important;color:#fff}'+
  '#masthead .mh{align-items:flex-end;padding-top:8px}'+
  '#masthead .mh>*:not(.mh-nav){margin-bottom:15px}'+
  '#masthead .wm b{color:#fff!important}'+
  '#masthead .wm span{color:rgba(255,255,255,.55)!important}'+
  '#masthead .mh-nav{background:var(--paper);border:0;border-radius:20px 20px 0 0;'+
    'padding:13px 12px 15px;margin:0 auto;flex:0 1 auto;position:relative;gap:2px}'+
  '#masthead .mh-nav::before,#masthead .mh-nav::after{content:"";position:absolute;bottom:0;width:18px;height:18px}'+
  '#masthead .mh-nav::before{left:-18px;background:radial-gradient(circle at 0 0,transparent 17.5px,var(--paper) 18px)}'+
  '#masthead .mh-nav::after{right:-18px;background:radial-gradient(circle at 100% 0,transparent 17.5px,var(--paper) 18px)}'+
  '#masthead .mh-nav a{color:var(--steel)!important;border:1px solid transparent;border-radius:999px;padding:8px 16px;'+
    'font-family:var(--f-sharp);font-weight:600;font-size:13.5px}'+
  '#masthead .mh-nav a:hover{color:var(--ink)!important}'+
  '#masthead .mh-nav a.on{background:#fff;border-color:var(--line);color:var(--ink)!important;'+
    'box-shadow:0 1px 5px rgba(16,21,25,.08)}'+
  '#masthead .mh-nav a.on::after{display:none}'+
  '#masthead .icon-btn{color:#fff;border-color:rgba(255,255,255,.28);background:transparent;border-radius:999px}'+
  '#masthead .mh-burger{color:#fff}'+
  '#masthead a[aria-label="Join with Discord"]{background:#fff!important;border:0!important;'+
    'color:var(--ink)!important;border-radius:999px!important;font-weight:600}'+
  '@media(max-width:900px){#masthead .mh-nav::before,#masthead .mh-nav::after{display:none}}'+

  /* ---- the "up next" whisper line ---- */
  '#ticker{height:auto;background:transparent;border-bottom:1px solid var(--line-soft)}'+
  '.pv-line{display:flex;align-items:center;gap:14px;max-width:1240px;margin:0 auto;padding:7px clamp(16px,3.5vw,40px);'+
    'font-family:var(--f-sharp);font-size:12px;font-weight:300;color:var(--steel);white-space:nowrap;overflow:hidden}'+
  '.pv-line .k{font-weight:600;color:var(--ink);flex:0 0 auto}'+
  '.pv-line a{color:var(--steel);transition:color .25s}'+
  '.pv-line a:hover{color:var(--ink)}'+
  '.pv-line .more{margin-left:auto;flex:0 0 auto;font-weight:600;color:var(--ink)}'+
  '.pv-line .sep{opacity:.45}'+

  /* ---- serif hero, centered like the reference ---- */
  '#hero{background:var(--paper);color:var(--ink)}'+
  '.pv-soft{text-align:center;padding-top:clamp(56px,8vw,104px);padding-bottom:clamp(40px,5.5vw,72px)}'+
  '.pv-soft h2.big{font-family:var(--f-display);font-weight:700;font-size:clamp(58px,9vw,132px);line-height:.92;'+
    'letter-spacing:.01em;text-transform:uppercase;color:var(--ink);margin:0 auto 18px;max-width:16ch;text-wrap:balance}'+
  '.pv-soft .dek{font-family:var(--f-sharp);font-weight:300;font-size:clamp(15px,1.3vw,17.5px);line-height:1.65;'+
    'color:var(--steel);max-width:46ch;margin:0 auto}'+
  '.pv-soft .row{display:flex;align-items:center;justify-content:center;gap:24px;margin-top:32px;flex-wrap:wrap}'+
  '.pv-cta{display:inline-flex;align-items:center;gap:12px;background:var(--ink);color:#fff;border-radius:999px;'+
    'padding:10px 10px 10px 22px;font-family:var(--f-sharp);font-weight:600;font-size:14.5px;transition:transform .25s ease,box-shadow .25s ease}'+
  '.pv-cta .dot{width:30px;height:30px;border-radius:50%;background:var(--chrome);display:grid;place-items:center;color:#101519;font-size:14px}'+
  '.pv-cta:hover{transform:translateY(-1px);box-shadow:0 10px 26px rgba(16,21,25,.25)}'+
  '.pv-soft .quiet{font-family:var(--f-sharp);font-weight:600;font-size:14px;color:var(--ink);'+
    'border-bottom:2px solid var(--chrome);padding-bottom:2px;transition:color .25s}'+
  '.pv-soft .quiet:hover{color:var(--gold)}'+
  '.pv-meta{margin-top:20px;font-family:var(--f-sharp);font-weight:300;font-size:12.5px;color:var(--steel)}'+
  '.pv-meta b{font-weight:600;color:var(--ink);font-variant-numeric:tabular-nums}'+
  '.pv-crests{display:flex;justify-content:center;align-items:center;gap:clamp(16px,2.6vw,32px);flex-wrap:wrap;'+
    'margin-top:clamp(36px,5vw,56px)}'+
  '.pv-crests a{opacity:.45;filter:grayscale(1);transition:opacity .3s ease,filter .3s ease}'+
  '.pv-crests a:hover{opacity:1;filter:none}'+

  /* ---- the dark stage: ambient panel + the live dashboard ---- */
  '.pv-stage{position:relative;border-radius:26px;background:#12161B;color:#EDEFE9;overflow:hidden;'+
    'padding:clamp(24px,4vw,56px)}'+
  '.pv-stage::before{content:"";position:absolute;inset:0;pointer-events:none;background:'+
    'radial-gradient(640px 420px at 78% 8%,rgba(255,160,64,.30),transparent 60%),'+
    'radial-gradient(560px 420px at 12% 92%,rgba(255,72,40,.22),transparent 60%)}'+
  '.pv-stage-grid{position:relative;display:grid;grid-template-columns:1.12fr .88fr;gap:clamp(24px,4vw,56px);align-items:center}'+
  '.pv-stage p.cap{font-family:var(--f-sharp);font-weight:300;font-size:clamp(15px,1.25vw,17px);line-height:1.7;'+
    'color:rgba(237,239,233,.85);max-width:44ch}'+
  '.pv-stage .cap-link{display:inline-block;margin-top:16px;font-family:var(--f-sharp);font-weight:600;font-size:13.5px;'+
    'color:#fff;border-bottom:2px solid var(--chrome);padding-bottom:2px}'+
  '.pv-stage .cap-link:hover{color:var(--chrome)}'+
  '.pv-scroll{position:relative;display:flex;align-items:center;gap:10px;margin-top:clamp(22px,3vw,34px);'+
    'font-family:var(--f-sharp);font-weight:300;font-size:12px;color:rgba(237,239,233,.6)}'+
  '.pv-scroll .o{width:30px;height:30px;border-radius:50%;border:1px solid rgba(237,239,233,.3);display:grid;place-items:center}'+

  /* the dashboard card */
  '.pv-dash{background:#fff;color:var(--ink);border-radius:18px;box-shadow:0 26px 70px rgba(0,0,0,.5);'+
    'padding:20px 22px;max-width:540px;margin:0 auto;width:100%}'+
  '.pv-dash .dh{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:16px}'+
  '.pv-dash .dh b{font-family:var(--f-sharp);font-weight:700;font-size:15px}'+
  '.pv-dash .dh span{font-family:var(--f-sharp);font-weight:300;font-size:11.5px;color:var(--steel)}'+
  '.pv-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:18px}'+
  '.pv-kpi b{display:block;font-family:var(--f-sharp);font-weight:700;font-size:clamp(19px,1.8vw,25px);'+
    'color:var(--ink);font-variant-numeric:tabular-nums}'+
  '.pv-kpi span{font-family:var(--f-sharp);font-weight:300;font-size:10.5px;color:var(--steel);line-height:1.35;display:block;margin-top:2px}'+
  '.pv-ch h4{font-family:var(--f-sharp);font-weight:600;font-size:12px;color:var(--steel);margin:0 0 8px}'+
  '.pv-ch svg{width:100%;height:110px;display:block}'+
  '.pv-ch .ln{fill:none;stroke:var(--gold);stroke-width:2;stroke-linecap:round;'+
    'stroke-dasharray:1;stroke-dashoffset:1;transition:stroke-dashoffset 1.4s ease .25s}'+
  '.in .pv-ch .ln{stroke-dashoffset:0}'+
  '.pv-ch .ar{fill:var(--chrome);opacity:0;transition:opacity 1s ease .8s}'+
  '.in .pv-ch .ar{opacity:.16}'+
  '.pv-ch .dotp{fill:var(--gold);opacity:0;transition:opacity .5s ease 1.3s}'+
  '.in .pv-ch .dotp{opacity:1}'+
  '.pv-prog{height:8px;border-radius:999px;background:var(--ice);overflow:hidden}'+
  '.pv-prog i{display:block;height:100%;border-radius:999px;background:var(--gold);'+
    'transform:scaleX(0);transform-origin:left;transition:transform 1.2s ease .3s}'+
  '.in .pv-prog i{transform:scaleX(1)}'+
  '.pv-pos{display:flex;gap:14px;margin-top:16px}'+
  '.pv-pos .p{flex:1}'+
  '.pv-pos .p em{font-style:normal;font-family:var(--f-sharp);font-weight:300;font-size:10.5px;color:var(--steel);'+
    'display:flex;justify-content:space-between;margin-bottom:5px}'+
  '.pv-pos .p em b{font-weight:600;color:var(--ink)}'+
  '.pv-bar{height:6px;border-radius:999px;background:var(--ice);overflow:hidden}'+
  '.pv-bar i{display:block;height:100%;border-radius:999px;background:var(--ink);'+
    'transform:scaleX(0);transform-origin:left;transition:transform .9s ease .4s}'+
  '.in .pv-bar i{transform:scaleX(1)}'+
  '@media(max-width:900px){.pv-stage-grid{grid-template-columns:1fr}.pv-kpis{grid-template-columns:1fr 1fr}}'+

  /* ---- gentle reveals + hover motion (off under reduced motion) ---- */
  '.pv-rv{opacity:0;transform:translateY(14px);transition:opacity .65s ease,transform .65s ease}'+
  '.pv-rv.in{opacity:1;transform:none}'+
  'a,button{transition:color .22s ease,border-color .22s ease,background .22s ease}'+
  '.card{transition:border-color .3s ease,transform .3s ease}'+
  '.card.raise:hover{transform:translateY(-2px);border-color:var(--line)}'+
  '@media(prefers-reduced-motion:reduce){.pv-rv{opacity:1;transform:none;transition:none}'+
    '.pv-ch .ln{stroke-dashoffset:0;transition:none}.pv-ch .ar{opacity:.16;transition:none}'+
    '.pv-ch .dotp{opacity:1;transition:none}.pv-prog i,.pv-bar i{transform:scaleX(1);transition:none}}'+

  /* ---- skin, site-wide: serif display, Sora UI, soft pills and cards ---- */
  '.h-page,.h-sec{font-family:var(--f-display);font-weight:700;text-transform:uppercase;letter-spacing:.015em}'+
  '.h-page{font-size:clamp(36px,4.6vw,58px);line-height:.98}'+
  '.h-sec{font-size:clamp(30px,3.2vw,44px);line-height:1}'+
  '.h-card,.card-h h3{font-family:var(--f-sharp);font-weight:700;text-transform:none;letter-spacing:-.01em;font-size:15px}'+
  '.eyebrow{font-family:var(--f-sharp);font-weight:600;letter-spacing:.15em;font-size:10px}'+
  '.lede,.caption{font-family:var(--f-sharp);font-weight:300}'+
  '.lede{font-size:15.5px;line-height:1.65}'+
  '.card{border-width:1px;border-color:var(--line-soft);border-radius:16px;overflow:hidden}'+
  '.card-h{border-bottom-color:var(--line-soft)}'+
  '.chip{font-family:var(--f-sharp);font-size:11px;font-weight:400;letter-spacing:0;text-transform:none;'+
    'background:var(--ice);border-color:transparent;border-radius:999px}'+
  '.note{border-width:1px;border-color:var(--line-soft);border-radius:14px}'+
  '.btn{font-family:var(--f-sharp);font-weight:600;letter-spacing:0;border-radius:999px}'+
  '.tbl th{font-size:10px;letter-spacing:.1em;color:var(--steel)}'+
  '.statline>div b{font-family:var(--f-sharp);font-weight:700}';
  var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  /* ---- ribbon + the floating canvas frame ---- */
  function ensureRibbon(){
    if (document.getElementById("pv-ribbon")) return;
    var r = document.createElement("div");
    r.id = "pv-ribbon";
    r.textContent = "Preview build · the real site is unchanged";
    document.body.insertBefore(r, document.body.firstChild);
  }
  function ensureFrame(){
    if (document.getElementById("pv-frame")) return;
    var mast = document.getElementById("masthead");
    if (!mast || !mast.parentNode) return;
    var f = document.createElement("div"); f.id = "pv-frame";
    mast.parentNode.insertBefore(f, mast);
    ["ticker","app","sitefoot"].forEach(function(id){
      var el = document.getElementById(id); if (el) f.appendChild(el);
    });
  }

  /* ---- reveals + animated numbers ---- */
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  function runCounters(root){
    root.querySelectorAll("[data-count]").forEach(function(el){
      if (el.getAttribute("data-done")) return;
      el.setAttribute("data-done","1");
      var end = parseFloat(el.getAttribute("data-count")) || 0;
      var pre = el.getAttribute("data-pre") || "", post = el.getAttribute("data-post") || "";
      if (reduce){ el.textContent = pre + end + post; return; }
      var t0 = null, D = 950;
      function tick(ts){
        if (!t0) t0 = ts;
        var p = Math.min(1, (ts - t0) / D); p = 1 - Math.pow(1 - p, 3);
        el.textContent = pre + Math.round(end * p) + post;
        if (p < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
  }
  var io = ("IntersectionObserver" in window) ? new IntersectionObserver(function(es){
    es.forEach(function(e){
      if (!e.isIntersecting) return;
      e.target.classList.add("in");
      runCounters(e.target);
      io.unobserve(e.target);
    });
  }, { rootMargin: "0px 0px -8% 0px" }) : null;
  function attachReveals(){
    if (!io){ document.querySelectorAll("[data-count]").forEach(function(el){ runCounters(el.parentNode||el); }); return; }
    document.querySelectorAll("#app .sec, #app .sec-tight, #app .sec-dark, .pv-soft > *")
      .forEach(function(el, i){
        if (el.classList.contains("pv-rv")) return;
        el.classList.add("pv-rv");
        el.style.transitionDelay = Math.min(i * 45, 220) + "ms";
        io.observe(el);
      });
  }
  var app = document.getElementById("app");
  if (app && "MutationObserver" in window){
    new MutationObserver(function(){ requestAnimationFrame(attachReveals); })
      .observe(app, { childList: true });
  }

  /* ---- the "up next" line: next games when they exist, else the next real milestones ---- */
  function lineHtml(){
    var lg = CG.lg || {}, items = [];
    var upcoming = (lg.schedule||[]).filter(function(g){ return g.at > CG.now(); })
      .sort(function(a,b){ return a.at-b.at; }).slice(0, 3);
    if (upcoming.length){
      items = upcoming.map(function(g){
        return '<a href="#/matchup/'+g.id+'">'+esc(g.away)+' @ '+esc(g.home)+' · '+esc(CG.fmtTime(g.at))+'</a>';
      });
    } else {
      var s = CG.SEASON || {};
      items = [["Sign-up deadline", s.registration_deadline, "#/register"], ["Draft night", s.draft_at, "#/schedule"],
               ["Puck drop", s.starts_at, "#/schedule"]]
        .filter(function(m){ return m[1] && Date.parse(m[1]) > CG.now(); }).slice(0, 2)
        .map(function(m){ return '<a href="'+m[2]+'">'+esc(m[0])+' · '+esc(CG.fmtDay(Date.parse(m[1])))+'</a>'; });
    }
    if (!items.length) return "";
    return '<div class="pv-line"><span class="k">Up next</span>'+
      items.join('<span class="sep">·</span>')+
      '<a class="more" href="#/schedule">Schedule</a></div>';
  }

  var _renderChrome = CG.renderChrome;
  CG.renderChrome = function(){
    _renderChrome.apply(this, arguments);
    try {
      ensureRibbon();
      ensureFrame();
      var saved = null;
      try { saved = (JSON.parse(localStorage.getItem("cgproto:v1")||"{}").prefs||{}).theme; } catch(e){}
      if (!saved || saved === "auto") document.documentElement.setAttribute("data-theme","light");
      var t = document.getElementById("ticker");
      if (t) t.innerHTML = lineHtml();
    } catch(e){ /* fail safe */ }
  };

  /* ---- the dashboard: real registrations, real dates, nothing invented ---- */
  function seasonRegs(){
    var sid = (CG.SEASON && CG.SEASON.id) || null;
    return ((CG.lg && CG.lg._registrationsRaw) || []).filter(function(r){
      return (!r.season_id || r.season_id === sid) && String(r.status||"") !== "declined";
    });
  }
  function posMix(regs){
    var f = 0, d = 0, g = 0;
    regs.forEach(function(r){
      var p = String(r.position||"").toUpperCase();
      if (p.indexOf("G") === 0) g++;
      else if (p === "D" || p === "LD" || p === "RD" || p.indexOf("DEF") === 0) d++;
      else f++;
    });
    return { F:f, D:d, G:g };
  }
  function signupChart(regs){
    var days = {};
    regs.forEach(function(r){
      if (!r.created_at) return;
      days[String(r.created_at).slice(0,10)] = (days[String(r.created_at).slice(0,10)]||0) + 1;
    });
    var keys = Object.keys(days).sort();
    if (keys.length < 2 || regs.length < 4) return null;   /* too little curve to be honest */
    var pts = [], total = 0;
    keys.forEach(function(k){ total += days[k]; pts.push(total); });
    var W = 480, H = 100, n = pts.length, max = pts[n-1];
    var xy = pts.map(function(v,i){
      return [ (i/(n-1))*W, H - 6 - (v/max)*(H-16) ];
    });
    var line = xy.map(function(p,i){ return (i?"L":"M") + p[0].toFixed(1) + " " + p[1].toFixed(1); }).join(" ");
    var area = line + " L" + W + " " + H + " L0 " + H + " Z";
    var last = xy[n-1];
    return '<div class="pv-ch"><h4>Sign-ups since registration opened</h4>'+
      '<svg viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none" aria-hidden="true">'+
      '<path class="ar" d="'+area+'"/>'+
      '<path class="ln" pathLength="1" d="'+line+'"/>'+
      '<circle class="dotp" cx="'+last[0].toFixed(1)+'" cy="'+last[1].toFixed(1)+'" r="3.5"/></svg></div>';
  }
  function progressBlock(){
    /* honest fallback: how far the off-season has run, first sign-up → puck drop */
    var s = CG.SEASON || {};
    var start = s.starts_at ? Date.parse(s.starts_at) : null;
    var regs = seasonRegs().map(function(r){ return r.created_at ? Date.parse(r.created_at) : null; })
      .filter(Boolean).sort(function(a,b){ return a-b; });
    if (!start || !regs.length || CG.now() >= start) return "";
    var pct = Math.max(2, Math.min(100, Math.round(100 * (CG.now() - regs[0]) / (start - regs[0]))));
    return '<div class="pv-ch"><h4>Road to puck drop · '+pct+'% of the off-season gone</h4>'+
      '<div class="pv-prog"><i style="width:'+pct+'%"></i></div></div>';
  }
  function dashHtml(){
    var s = CG.SEASON || {};
    var regs = seasonRegs();
    var mix = posMix(regs);
    var days = CG.daysToStart && CG.daysToStart();
    var kpis = [];
    kpis.push(['<b data-count="'+regs.length+'">0</b>', "players signed"]);
    if (days != null) kpis.push(['<b data-count="'+days+'">0</b>', "days to puck drop"]);
    kpis.push(['<b data-count="'+CG.TEAMS.length+'">0</b>', "clubs · "+esc((CG.DIVISIONS||[1,2]).length)+" divisions"]);
    if (CG.CAP) kpis.push(['<b data-count="'+(CG.CAP/1e6)+'" data-pre="$" data-post="M">$0M</b>', "salary cap"]);
    var chart = signupChart(regs) || progressBlock();
    var maxP = Math.max(mix.F, mix.D, mix.G, 1);
    var pos = regs.length ? '<div class="pv-pos">'+[["Forwards",mix.F],["Defense",mix.D],["Goalies",mix.G]].map(function(p){
        return '<div class="p"><em>'+p[0]+'<b>'+p[1]+'</b></em>'+
          '<div class="pv-bar"><i style="width:'+Math.round(100*p[1]/maxP)+'%"></i></div></div>';
      }).join("")+'</div>' : "";
    return '<div class="pv-dash"><div class="dh"><b>League pulse</b><span>'+esc((CG.seasonTag&&CG.seasonTag())||"Season 1")+' · live from the database</span></div>'+
      '<div class="pv-kpis">'+kpis.slice(0,4).map(function(k){
        return '<div class="pv-kpi">'+k[0]+'<span>'+k[1]+'</span></div>';
      }).join("")+'</div>'+chart+pos+'</div>';
  }
  function stageHtml(){
    return '<section class="sec" style="padding-top:0;padding-bottom:clamp(28px,4vw,52px)"><div class="shell">'+
      '<div class="pv-stage"><div class="pv-stage-grid">'+
        '<div>'+dashHtml()+'</div>'+
        '<div><p class="cap">Every game writes itself into the record. Box scores import straight from EA within '+
          'minutes of the final horn — standings, player stats, and salaries update on their own.</p>'+
          '<a class="cap-link" href="#/stats">Explore the numbers</a>'+
          '<div class="pv-scroll"><span class="o">↓</span>The season, below</div></div>'+
      '</div></div>'+
    '</div></section>';
  }

  /* ---- the serif hero: centered, minimal, with the crest strip ---- */
  function softHero(){
    var s = CG.SEASON || {};
    var regOpen = !!(s.registration_open && s.status !== "active");
    var active = s.status === "active";
    var startMs = CG.seasonStartMs && CG.seasonStartMs();
    var startTag = startMs ? esc(CG.fmtDay(startMs).replace(/^[A-Za-z]+, /,"")) : "soon";
    var head = active ? esc(s.name||"The season")+" is under way." : "The puck drops "+startTag+".";
    var dek = "Eight clubs, two divisions, and a fresh sheet.";

    var regDl = s.registration_deadline ? Date.parse(s.registration_deadline) : null;
    var faO = s.free_agency_opens_at ? Date.parse(s.free_agency_opens_at) : null;
    var faC = s.free_agency_closes_at ? Date.parse(s.free_agency_closes_at) : null;
    var faLive = !!(faO && faC && Date.now() >= faO && Date.now() < faC);
    var meta = "";
    if (faLive)
      meta = '<p class="pv-meta">Free agency closes in <b id="faCountdown" data-close="'+faC+'">—</b></p>';
    else if (regOpen && regDl && Date.now() < regDl)
      meta = '<p class="pv-meta">Registration closes '+esc(CG.fmtDay(regDl))+' · <b id="regCountdown" data-close="'+regDl+'">—</b></p>';

    var crests = (CG.TEAMS||[]).map(function(t){
      return '<a href="#/team/'+esc(t.code)+'" aria-label="'+esc(t.name)+'">'+CG.crest(t.code, 38)+'</a>';
    }).join("");

    return '<section id="hero"><div class="shell pv-soft">'+
      '<h2 class="big">'+head+'</h2>'+
      '<p class="dek">'+dek+'</p>'+
      '<div class="row">'+
        (regOpen ? '<a class="pv-cta" href="#/register">Register to play<span class="dot">→</span></a>'
                 : '<a class="pv-cta" href="#/schedule">See the schedule<span class="dot">→</span></a>')+
        '<a class="quiet" href="#/rulebook">How the season works</a></div>'+
      meta+
      (crests ? '<div class="pv-crests">'+crests+'</div>' : "")+
    '</div></section>';
  }

  var _home = CG.ROUTES.home;
  CG.ROUTES.home = function(param, qs){
    var html = _home(param, qs);
    try {
      var a = html.indexOf('<section id="hero">');
      var endMark = '</aside></div></section>';
      var b = html.indexOf(endMark, a);
      if (a < 0 || b < 0) return html;            /* markers moved — ship the original untouched */
      var h1 = html.indexOf('</h1>');
      var head = h1 > -1 ? html.slice(0, h1 + 5) : "";
      html = head + softHero() + stageHtml() + html.slice(b + endMark.length);
      var sIdx = html.indexOf('class="statline"');
      if (sIdx > -1){
        var sOpen = html.lastIndexOf('<section', sIdx);
        var sEnd = html.indexOf('</section>', sIdx);
        if (sOpen > -1 && sEnd > -1) html = html.slice(0, sOpen) + html.slice(sEnd + 10);
      }
      return html;
    } catch(e){ return html; }
  };
  /* AFTER.home stays the original: the carousel no-ops, and the countdown ids
     (#regCountdown / #faCountdown) are provided by the hero's meta line. */
})();
