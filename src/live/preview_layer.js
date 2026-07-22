/* ================================================================
   PREVIEW LAYER — loaded ONLY in preview.html (never index.html).
   Direction: clean, sharp, modern. Sora carries the whole page —
   heavy for headlines, light for the small text. A stripped hero
   (headline, one line, one action, one meta line, icon labels),
   gentle reveal animations, and a softened skin on every page.
   Every route, module, and behavior is the production code
   untouched; overrides fail safe to the original rendering.
   ================================================================ */
(function(){
  "use strict";

  /* one family, full range: 300 for the small text, 700/800 for the display */
  var fl = document.createElement("link");
  fl.rel = "stylesheet";
  fl.href = "https://fonts.googleapis.com/css2?family=Sora:wght@300;400;600;700;800&display=swap";
  document.head.appendChild(fl);

  var css = ''+
  ':root{--f-sharp:"Sora",-apple-system,sans-serif}'+
  '#pv-ribbon{background:var(--gold);color:#101519;font-size:11px;font-weight:600;letter-spacing:.06em;'+
    'text-transform:uppercase;text-align:center;padding:5px 12px}'+

  /* ---- the "up next" whisper line in place of the ticker ---- */
  '#ticker{height:auto;background:var(--ice);border-bottom:1px solid var(--line-soft)}'+
  '.pv-line{display:flex;align-items:center;gap:14px;max-width:1240px;margin:0 auto;padding:8px clamp(16px,3.5vw,40px);'+
    'font-family:var(--f-sharp);font-size:12px;font-weight:300;color:var(--steel);white-space:nowrap;overflow:hidden}'+
  '.pv-line .k{font-weight:600;color:var(--ink);flex:0 0 auto}'+
  '.pv-line a{color:var(--steel);transition:color .25s}'+
  '.pv-line a:hover{color:var(--ink)}'+
  '.pv-line .more{margin-left:auto;flex:0 0 auto;font-weight:600;color:var(--ink)}'+
  '.pv-line .sep{opacity:.45}'+

  /* ---- stripped hero ---- */
  '#hero{background:var(--paper);color:var(--ink)}'+
  '.pv-soft{padding-top:clamp(64px,10vw,130px);padding-bottom:clamp(36px,5vw,64px)}'+
  '.pv-soft h2.big{font-family:var(--f-sharp);font-weight:800;font-size:clamp(38px,5.2vw,64px);line-height:1.02;'+
    'letter-spacing:-.03em;color:var(--ink);margin:0 0 18px;max-width:18ch;text-wrap:balance}'+
  '.pv-soft .dek{font-family:var(--f-sharp);font-weight:300;font-size:clamp(15.5px,1.35vw,18.5px);line-height:1.6;'+
    'color:var(--steel);max-width:52ch}'+
  '.pv-soft .row{display:flex;align-items:center;gap:24px;margin-top:32px;flex-wrap:wrap}'+
  '.pv-soft .quiet{font-family:var(--f-sharp);font-weight:600;font-size:14px;color:var(--ink);'+
    'border-bottom:2px solid var(--chrome);padding-bottom:2px;transition:color .25s}'+
  '.pv-soft .quiet:hover{color:var(--gold)}'+
  '.pv-meta{margin-top:22px;font-family:var(--f-sharp);font-weight:300;font-size:13px;color:var(--steel)}'+
  '.pv-meta b{font-weight:600;color:var(--ink);font-variant-numeric:tabular-nums}'+

  /* ---- icon labels: one quiet spec line, no boxes, no captions ---- */
  '.pv-specs{display:flex;gap:clamp(22px,3.5vw,48px);flex-wrap:wrap;align-items:center;'+
    'margin-top:clamp(36px,5vw,60px);padding-top:clamp(20px,2.5vw,30px);border-top:1px solid var(--line-soft)}'+
  '.pv-sp{display:inline-flex;align-items:center;gap:10px}'+
  '.pv-sp svg{width:22px;height:22px;stroke:var(--ink);fill:none;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;flex-shrink:0}'+
  '.pv-sp svg .acc{stroke:var(--gold)}'+
  '.pv-sp span{font-family:var(--f-sharp);font-weight:400;font-size:13.5px;color:var(--ink)}'+

  /* ---- gentle reveals + hover motion (off under reduced motion) ---- */
  '.pv-rv{opacity:0;transform:translateY(14px);transition:opacity .65s ease,transform .65s ease}'+
  '.pv-rv.in{opacity:1;transform:none}'+
  'a,button{transition:color .22s ease,border-color .22s ease,background .22s ease}'+
  '.card{transition:border-color .3s ease,transform .3s ease}'+
  '.card.raise:hover{transform:translateY(-2px);border-color:var(--line)}'+
  '@media(prefers-reduced-motion:reduce){.pv-rv{opacity:1;transform:none;transition:none}}'+

  /* ---- sharp skin, site-wide: heavy display, light small text ---- */
  '.h-page,.h-sec{font-family:var(--f-sharp);font-weight:800;text-transform:none;letter-spacing:-.025em}'+
  '.h-page{font-size:clamp(28px,3.6vw,42px);line-height:1.05}'+
  '.h-sec{font-size:clamp(22px,2.4vw,29px);line-height:1.1}'+
  '.h-card,.card-h h3{font-family:var(--f-sharp);font-weight:700;text-transform:none;letter-spacing:-.01em;font-size:15.5px}'+
  '.eyebrow{font-family:var(--f-sharp);font-weight:600;letter-spacing:.15em;font-size:10px}'+
  '.lede,.caption{font-family:var(--f-sharp);font-weight:300}'+
  '.lede{font-size:15.5px;line-height:1.65}'+
  '.card{border-width:1px;border-color:var(--line-soft)}'+
  '.card-h{border-bottom-color:var(--line-soft)}'+
  '.chip{font-family:var(--f-sharp);font-size:11px;font-weight:400;letter-spacing:0;text-transform:none;'+
    'background:var(--ice);border-color:transparent}'+
  '.note{border-width:1px;border-color:var(--line-soft)}'+
  '.btn{font-family:var(--f-sharp);font-weight:600;letter-spacing:0}'+
  '.mh-nav a{font-family:var(--f-sharp);font-weight:600}'+
  '.tbl th{font-size:10px;letter-spacing:.1em;color:var(--steel)}'+
  '.statline>div b{font-family:var(--f-sharp);font-weight:800}'+
  '#masthead a[aria-label="Join with Discord"]{background:transparent!important;'+
    'border:1.5px solid #5865F2!important;color:var(--ink)!important}';
  var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  /* ---- preview ribbon (so nobody mistakes this for the live site) ---- */
  function ensureRibbon(){
    if (document.getElementById("pv-ribbon")) return;
    var r = document.createElement("div");
    r.id = "pv-ribbon";
    r.textContent = "Preview build · the real site is unchanged";
    document.body.insertBefore(r, document.body.firstChild);
  }

  /* ---- scroll reveals: one observer, re-attached after every render ---- */
  var io = ("IntersectionObserver" in window) ? new IntersectionObserver(function(es){
    es.forEach(function(e){ if (e.isIntersecting){ e.target.classList.add("in"); io.unobserve(e.target); } });
  }, { rootMargin: "0px 0px -8% 0px" }) : null;
  function attachReveals(){
    if (!io) return;
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
      var saved = null;
      try { saved = (JSON.parse(localStorage.getItem("cgproto:v1")||"{}").prefs||{}).theme; } catch(e){}
      if (!saved || saved === "auto") document.documentElement.setAttribute("data-theme","light");
      var t = document.getElementById("ticker"), mast = document.getElementById("masthead");
      if (t) t.innerHTML = lineHtml();
      if (t && mast && mast.parentNode && (mast.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_PRECEDING)){
        mast.parentNode.insertBefore(t, mast.nextSibling);
      }
    } catch(e){ /* fail safe */ }
  };

  /* ---- hand-drawn line icons (simple strokes, one chrome accent each) ---- */
  var IC = {
    puck: '<svg viewBox="0 0 32 32" aria-hidden="true"><ellipse cx="16" cy="13" rx="10" ry="4.5"/>'+
      '<path d="M6 13v6c0 2.5 4.5 4.5 10 4.5s10-2 10-4.5v-6"/><path class="acc" d="M11 12.6h10"/></svg>',
    cal: '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="5" y="7" width="22" height="20"/>'+
      '<path d="M5 13h22M11 4.5V9M21 4.5V9"/><path class="acc" d="M14.5 20l2 2 4-4.5"/></svg>',
    cap: '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="11"/>'+
      '<path d="M16 9.5v13M19.5 12.5c0-1.6-1.6-2.6-3.5-2.6s-3.5 1-3.5 2.6 1.3 2.3 3.5 2.9c2.2.6 3.7 1.3 3.7 3s-1.7 2.7-3.7 2.7-3.7-1-3.7-2.7"/>'+
      '<path class="acc" d="M25.5 5.5l2.5-2.5"/></svg>',
    pad: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M8 10h16c3 0 5 2.5 5 6s-2 9-4.5 9c-2 0-3-2.5-4.5-2.5h-8C10.5 22.5 9.5 25 7.5 25 5 25 3 19.5 3 16s2-6 5-6z"/>'+
      '<path d="M10.5 14v5M8 16.5h5"/><circle class="acc" cx="22" cy="15" r="1" /><circle class="acc" cx="25" cy="18" r="1"/></svg>'
  };

  /* ---- the stripped home hero: headline, one line, one action, one meta line,
         icon labels. The data sections follow untouched, softened by the skin. ---- */
  function softHero(){
    var s = CG.SEASON || {};
    var regOpen = !!(s.registration_open && s.status !== "active");
    var active = s.status === "active";
    var startMs = CG.seasonStartMs && CG.seasonStartMs();
    var startTag = startMs ? esc(CG.fmtDay(startMs).replace(/^[A-Za-z]+, /,"")) : "soon";
    var head = active ? esc(s.name||"The season")+" is under way." : "The puck drops "+startTag+".";
    var dek = "Eight clubs, two divisions, and a fresh sheet.";

    /* one meta line: the live countdown keeps its id so the untouched AFTER.home drives it */
    var regDl = s.registration_deadline ? Date.parse(s.registration_deadline) : null;
    var faO = s.free_agency_opens_at ? Date.parse(s.free_agency_opens_at) : null;
    var faC = s.free_agency_closes_at ? Date.parse(s.free_agency_closes_at) : null;
    var faLive = !!(faO && faC && Date.now() >= faO && Date.now() < faC);
    var meta = "";
    if (faLive)
      meta = '<p class="pv-meta">Free agency closes in <b id="faCountdown" data-close="'+faC+'">—</b></p>';
    else if (regOpen && regDl && Date.now() < regDl)
      meta = '<p class="pv-meta">Registration closes '+esc(CG.fmtDay(regDl))+' · <b id="regCountdown" data-close="'+regDl+'">—</b></p>';

    var specs = [];
    specs.push([IC.pad, "6v6 · EA Sports NHL"]);
    if (s.draft_at) specs.push([IC.cal, "Draft night "+esc(CG.fmtDay(Date.parse(s.draft_at)).replace(/^[A-Za-z]+, /,""))]);
    if (CG.CAP) specs.push([IC.cap, "$"+(CG.CAP/1e6)+"M salary cap"]);
    specs.push([IC.puck, active ? "Wednesdays & Fridays" : "Puck drop "+startTag]);

    return '<section id="hero"><div class="shell pv-soft">'+
      '<h2 class="big">'+head+'</h2>'+
      '<p class="dek">'+dek+'</p>'+
      '<div class="row">'+
        (regOpen ? '<a class="btn btn-chrome" href="#/register">Register to play</a>' : '<a class="btn btn-chrome" href="#/schedule">See the schedule</a>')+
        '<a class="quiet" href="#/rulebook">How the season works</a></div>'+
      meta+
      '<div class="pv-specs">'+specs.slice(0,4).map(function(f){
        return '<span class="pv-sp">'+f[0]+'<span>'+f[1]+'</span></span>';
      }).join("")+'</div>'+
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
      /* a calm open: the banner strips fold into the hero (countdown included),
         and the stat boxes fold into the icon labels */
      var h1 = html.indexOf('</h1>');
      var head = h1 > -1 ? html.slice(0, h1 + 5) : "";
      html = head + softHero() + html.slice(b + endMark.length);
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
