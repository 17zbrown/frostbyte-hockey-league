/* ================================================================
   PREVIEW LAYER — loaded ONLY in preview.html (never index.html).
   Direction: soft, classy, editorial. A calm first viewport (nav,
   one quiet "up next" line, a serif hero with a single action),
   boxless icon modules, gentle reveal animations, and a softened
   skin across every page. Every route, module, and behavior is the
   production code untouched; overrides fail safe to the original.
   ================================================================ */
(function(){
  "use strict";

  /* the display serif that replaces the poster caps */
  var fl = document.createElement("link");
  fl.rel = "stylesheet";
  fl.href = "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,420;9..144,520;9..144,600&display=swap";
  document.head.appendChild(fl);

  var css = ''+
  ':root{--f-serif:"Fraunces",Georgia,serif}'+
  '#pv-ribbon{background:var(--gold);color:#101519;font-size:11px;font-weight:600;letter-spacing:.06em;'+
    'text-transform:uppercase;text-align:center;padding:5px 12px}'+

  /* ---- the "up next" whisper line in place of the ticker ---- */
  '#ticker{height:auto;background:var(--ice);border-bottom:1px solid var(--line-soft)}'+
  '.pv-line{display:flex;align-items:center;gap:14px;max-width:1240px;margin:0 auto;padding:8px clamp(16px,3.5vw,40px);'+
    'font-size:12.5px;color:var(--steel);white-space:nowrap;overflow:hidden}'+
  '.pv-line .k{font-weight:600;color:var(--ink);flex:0 0 auto}'+
  '.pv-line a{color:var(--steel);transition:color .25s}'+
  '.pv-line a:hover{color:var(--ink)}'+
  '.pv-line .more{margin-left:auto;flex:0 0 auto;font-weight:600;color:var(--ink)}'+
  '.pv-line .sep{opacity:.45}'+

  /* ---- soft hero ---- */
  '#hero{background:var(--paper);color:var(--ink)}'+
  '.pv-soft{padding:clamp(56px,9vw,120px) 0 clamp(40px,6vw,80px)}'+
  '.pv-soft .kick{font-size:11.5px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:var(--steel)}'+
  '.pv-soft h2.big{font-family:var(--f-serif);font-weight:520;font-size:clamp(38px,5.2vw,62px);line-height:1.04;'+
    'letter-spacing:-.015em;color:var(--ink);margin:18px 0 16px;max-width:20ch;text-wrap:balance}'+
  '.pv-soft .dek{font-size:clamp(15.5px,1.35vw,18px);line-height:1.65;color:var(--steel);max-width:56ch}'+
  '.pv-soft .row{display:flex;align-items:center;gap:22px;margin-top:30px;flex-wrap:wrap}'+
  '.pv-soft .quiet{font-family:var(--f-serif);font-weight:520;font-size:15px;color:var(--ink);'+
    'border-bottom:1.5px solid var(--chrome);padding-bottom:2px;transition:border-color .25s,color .25s}'+
  '.pv-soft .quiet:hover{color:var(--gold)}'+
  '.pv-count{margin-top:26px;font-size:13px;color:var(--steel)}'+
  '.pv-count b{font-weight:600;color:var(--ink);font-variant-numeric:tabular-nums}'+

  /* ---- boxless icon modules ---- */
  '.pv-icons{display:grid;grid-template-columns:repeat(4,1fr);gap:clamp(20px,3vw,44px);'+
    'padding:clamp(28px,4vw,52px) 0;border-top:1px solid var(--line-soft)}'+
  '.pv-ic svg{width:30px;height:30px;stroke:var(--ink);fill:none;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}'+
  '.pv-ic svg .acc{stroke:var(--gold)}'+
  '.pv-ic b{display:block;font-family:var(--f-serif);font-weight:520;font-size:17px;color:var(--ink);margin:10px 0 3px}'+
  '.pv-ic span{font-size:13px;line-height:1.5;color:var(--steel)}'+
  '@media(max-width:820px){.pv-icons{grid-template-columns:1fr 1fr;gap:22px}}'+

  /* ---- gentle reveals + hover motion (off under reduced motion) ---- */
  '.pv-rv{opacity:0;transform:translateY(14px);transition:opacity .65s ease,transform .65s ease}'+
  '.pv-rv.in{opacity:1;transform:none}'+
  'a,button{transition:color .22s ease,border-color .22s ease,background .22s ease}'+
  '.card{transition:border-color .3s ease,transform .3s ease}'+
  '.card.raise:hover{transform:translateY(-2px);border-color:var(--line)}'+
  '@media(prefers-reduced-motion:reduce){.pv-rv{opacity:1;transform:none;transition:none}}'+

  /* ---- soft skin, site-wide: editorial serif, sentence case, fewer boxes ---- */
  '.h-page,.h-sec{font-family:var(--f-serif);font-weight:520;text-transform:none;letter-spacing:-.012em}'+
  '.h-page{font-size:clamp(30px,3.8vw,44px);line-height:1.08}'+
  '.h-sec{font-size:clamp(23px,2.5vw,30px);line-height:1.12}'+
  '.h-card,.card-h h3{font-family:var(--f-serif);font-weight:520;text-transform:none;letter-spacing:0;font-size:16.5px}'+
  '.eyebrow{font-family:var(--f-body);font-weight:600;letter-spacing:.15em;font-size:10.5px}'+
  '.lede{font-size:15.5px;line-height:1.65}'+
  /* boxes breathe: hairlines, not frames */
  '.card{border-width:1px;border-color:var(--line-soft)}'+
  '.card-h{border-bottom-color:var(--line-soft)}'+
  '.chip{font-family:var(--f-body);font-size:11.5px;font-weight:600;letter-spacing:0;text-transform:none;'+
    'background:var(--ice);border-color:transparent}'+
  '.note{border-width:1px;border-color:var(--line-soft)}'+
  '.btn{font-family:var(--f-body);font-weight:600;letter-spacing:.01em}'+
  '.mh-nav a{font-weight:600}'+
  '.tbl th{font-size:10px;letter-spacing:.1em;color:var(--steel)}'+
  '.statline>div b{font-family:var(--f-serif);font-weight:520}';
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
    document.querySelectorAll("#app .sec, #app .sec-tight, #app .sec-dark, .pv-soft > .shell > *, .pv-icons > *")
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
      var t = document.getElementById("ticker"), mast = document.getElementById("masthead");
      if (t) t.innerHTML = lineHtml();
      if (t && mast && mast.parentNode && (mast.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_PRECEDING)){
        mast.parentNode.insertBefore(t, mast.nextSibling);
      }
      var dj = document.querySelector('#masthead a[aria-label="Join with Discord"]');
      if (dj){ dj.style.background = "transparent"; dj.style.border = "1.5px solid #5865F2"; dj.style.color = "var(--on-ink)"; }
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

  /* ---- the soft home: calm hero + icon modules; roadmap and the data
         sections follow untouched (softened by the skin) ---- */
  function softHero(){
    var s = CG.SEASON || {};
    var regOpen = !!(s.registration_open && s.status !== "active");
    var active = s.status === "active";
    var startMs = CG.seasonStartMs && CG.seasonStartMs();
    var head = active
      ? esc(s.name||"The season")+" is under way."
      : "The puck drops "+(startMs ? esc(CG.fmtDay(startMs).replace(/^[A-Za-z]+, /,"")) : "soon")+".";
    var dek = "Eight clubs, two divisions, and a fresh sheet. "+
      (regOpen && s.registration_deadline
        ? "Sign up by "+esc(CG.fmtDay(Date.parse(s.registration_deadline)))+" and hear your name on draft night."
        : "Every box score imports straight from EA — the standings keep themselves.");
    /* the live countdowns keep their ids so the untouched AFTER.home wiring drives them */
    var regDl = s.registration_deadline ? Date.parse(s.registration_deadline) : null;
    var faO = s.free_agency_opens_at ? Date.parse(s.free_agency_opens_at) : null;
    var faC = s.free_agency_closes_at ? Date.parse(s.free_agency_closes_at) : null;
    var faLive = !!(faO && faC && Date.now() >= faO && Date.now() < faC);
    var count = "";
    if (faLive)
      count = '<p class="pv-count">Free agency closes in <b id="faCountdown" data-close="'+faC+'">—</b></p>';
    else if (regOpen && regDl && Date.now() < regDl)
      count = '<p class="pv-count">Registration closes in <b id="regCountdown" data-close="'+regDl+'">—</b></p>';

    var facts = [];
    facts.push([IC.pad, "6v6 · EA Sports NHL", "Full games, real box scores, nothing typed in by hand."]);
    if (s.draft_at) facts.push([IC.cal, "Draft night "+esc(CG.fmtDay(Date.parse(s.draft_at)).replace(/^[A-Za-z]+, /,"")),
      "Clubs build their rosters live on the site."]);
    if (CG.CAP) facts.push([IC.cap, "$"+(CG.CAP/1e6)+"M salary cap", "Every contract counts against it."]);
    facts.push([IC.puck, active ? "Wednesdays and Fridays" : "Puck drop "+(startMs ? esc(CG.fmtDay(startMs).replace(/^[A-Za-z]+, /,"")) : "soon"),
      active ? "Three games a night, every point counting." : "The regular season begins."]);

    return '<section id="hero"><div class="shell pv-soft">'+
      '<span class="kick">'+esc((CG.seasonTag&&CG.seasonTag())||"Season 1")+' · Inaugural</span>'+
      '<h2 class="big">'+head+'</h2>'+
      '<p class="dek">'+dek+'</p>'+
      '<div class="row">'+
        (regOpen ? '<a class="btn btn-chrome" href="#/register">Register to play</a>' : '<a class="btn btn-chrome" href="#/schedule">See the schedule</a>')+
        '<a class="quiet" href="#/rulebook">How the season works</a></div>'+
      count+
      '<div class="pv-icons">'+facts.slice(0,4).map(function(f){
        return '<div class="pv-ic">'+f[0]+'<b>'+f[1]+'</b><span>'+f[2]+'</span></div>';
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
      /* a calm open: the banner strips fold into the hero (countdowns included),
         and the stat boxes fold into the icon modules */
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
     (#regCountdown / #faCountdown) are provided by the soft hero. */
})();
