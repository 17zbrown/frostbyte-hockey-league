/* ================================================================
   PREVIEW LAYER — loaded ONLY in preview.html (never index.html).
   League-site direction modeled on wnba.com's homepage anatomy:
   nav on top, score strip below it, featured hero + slides rail,
   a top-stories tile band, and a marquee band — rebuilt in CGHL's
   own brand (square corners, chrome/ink, real data only).
   Everything else — every route, module, and behavior — is the
   production code untouched. All overrides fail safe: if a marker
   isn't found, the original rendering ships unchanged.
   ================================================================ */
(function(){
  "use strict";

  /* ---- preview-only styles ---- */
  var css = ''+
  '#pv-ribbon{background:var(--gold);color:#101519;font-family:var(--f-mono);font-size:10.5px;font-weight:600;'+
    'letter-spacing:.14em;text-transform:uppercase;text-align:center;padding:6px 12px}'+

  /* ---- score strip: light ground under the dark nav, date groups + game cards ---- */
  '#ticker{height:auto;position:relative;background:var(--paper);border-bottom:1px solid var(--line)}'+
  '.pvstrip{display:flex;align-items:stretch;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;'+
    'padding:0 clamp(8px,2vw,24px);scroll-behavior:smooth}'+
  '.pvstrip::-webkit-scrollbar{display:none}'+
  '.pv-date{flex:0 0 auto;display:flex;flex-direction:column;justify-content:center;gap:1px;padding:10px 14px;border-right:1px solid var(--line)}'+
  '.pv-date span{font-family:var(--f-mono);font-size:9.5px;font-weight:600;letter-spacing:.14em;color:var(--steel)}'+
  '.pv-date b{font-family:var(--f-disp);font-weight:900;font-size:15px;color:var(--ink)}'+
  '.pv-game{flex:0 0 auto;min-width:172px;padding:9px 14px;border-right:1px solid var(--line);display:flex;flex-direction:column;gap:4px;color:var(--ink)}'+
  'a.pv-game:hover{background:var(--ice)}'+
  '.pv-st{font-family:var(--f-mono);font-size:9.5px;font-weight:600;letter-spacing:.13em;color:var(--steel);display:flex;align-items:center;gap:7px}'+
  '.pv-row{display:flex;align-items:center;gap:8px;font-size:13px}'+
  '.pv-row b{font-family:var(--f-disp);font-weight:800;letter-spacing:.01em}'+
  '.pv-row .sc{margin-left:auto;font-family:var(--f-mono);font-weight:600;font-variant-numeric:tabular-nums}'+
  '.pv-row .rec{margin-left:auto;font-family:var(--f-mono);font-size:11px;color:var(--steel);font-variant-numeric:tabular-nums}'+
  '.pv-row.win b,.pv-row.win .sc{color:var(--ink)}'+
  '.pv-row.dim{opacity:.52}'+
  '.pv-arr{position:absolute;top:0;bottom:0;width:34px;display:grid;place-items:center;z-index:2;color:var(--ink);'+
    'background:var(--paper);border:0;cursor:pointer;font-size:15px;line-height:1}'+
  '.pv-arr:hover{color:var(--gold)}'+
  '.pv-arr.l{left:0;border-right:1px solid var(--line)}'+
  '.pv-arr.r{right:0;border-left:1px solid var(--line)}'+
  '#ticker.pv-has-arrows .pvstrip{margin:0 34px}'+
  '@media(max-width:820px){.pv-arr{display:none}#ticker.pv-has-arrows .pvstrip{margin:0}}'+

  /* ---- featured hero: big featured story left, slides rail right (dark) ---- */
  '.pv-hero-grid{display:grid;grid-template-columns:1.6fr 1fr;gap:clamp(22px,3.5vw,54px);align-items:stretch}'+
  '.pv-feat{display:flex;flex-direction:column;background:#151B21;border:1px solid #232B31}'+
  '.pv-feat .art{aspect-ratio:16/7.5;min-height:0;overflow:hidden}'+
  '.pv-feat .art svg{width:100%;height:100%;display:block}'+
  '.pv-feat .fb{padding:clamp(16px,2vw,26px);display:flex;flex-direction:column;gap:9px;flex:1}'+
  '.pv-feat .fe{font-family:var(--f-mono);font-size:10px;font-weight:600;letter-spacing:.18em;text-transform:uppercase;color:var(--chrome)}'+
  '.pv-feat h2{font-family:var(--f-disp);font-weight:900;font-size:clamp(24px,2.9vw,40px);line-height:1;letter-spacing:-.02em;'+
    'text-transform:uppercase;color:#fff;max-width:24ch}'+
  '.pv-feat p{font-size:15px;line-height:1.55;color:var(--on-ink-dim);max-width:60ch}'+
  '.pv-flink{margin-top:auto;padding-top:6px;font-family:var(--f-disp);font-weight:700;font-size:14.5px;color:#fff;'+
    'display:inline-flex;align-items:center;gap:8px}'+
  '.pv-flink::after{content:"\\2197";color:var(--chrome)}'+
  '.pv-flink:hover{color:var(--chrome)}'+
  '.pv-slides{display:flex;flex-direction:column;justify-content:center}'+
  '.pv-slide{padding:clamp(14px,1.8vw,22px) 0;border-bottom:1px solid #232B31}'+
  '.pv-slide:first-child{padding-top:0}'+
  '.pv-slide:last-child{border-bottom:0;padding-bottom:0}'+
  '.pv-slide h3{font-family:var(--f-disp);font-weight:800;font-size:clamp(16px,1.4vw,19px);line-height:1.25;color:#fff;margin-bottom:7px}'+
  '.pv-slide a{font-family:var(--f-disp);font-weight:700;font-size:13.5px;color:var(--chrome);border-bottom:2px solid var(--chrome);padding-bottom:1px}'+
  '.pv-slide a:hover{color:#fff;border-color:#fff}'+
  '@media(max-width:820px){.pv-hero-grid{grid-template-columns:1fr}.pv-slides{padding-top:6px}}'+

  /* ---- top stories: dark band of portrait tiles ---- */
  '.pv-tiles{display:flex;gap:14px;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;padding-bottom:6px}'+
  '.pv-tiles::-webkit-scrollbar{display:none}'+
  '.pv-tile{flex:0 0 152px;height:222px;position:relative;overflow:hidden;border:1px solid #232B31;display:block}'+
  '.pv-tile svg{position:absolute;inset:0;width:100%;height:100%}'+
  '.pv-tile .shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(11,15,18,0) 40%,rgba(11,15,18,.92) 100%)}'+
  '.pv-tile .nw{position:absolute;top:8px;right:8px;font-family:var(--f-mono);font-size:9px;font-weight:600;letter-spacing:.12em;'+
    'text-transform:uppercase;background:var(--chrome);color:#101519;padding:2px 7px}'+
  '.pv-tile b{position:absolute;left:11px;right:11px;bottom:10px;font-family:var(--f-disp);font-weight:700;font-size:13.5px;'+
    'line-height:1.25;color:#fff}'+
  '.pv-tile:hover{border-color:var(--chrome)}'+

  /* ---- marquee band: scrolling wordmark + promo panel ---- */
  '.pv-marq{background:#0B0F12;border-top:1px solid #232B31;overflow:hidden}'+
  '.pv-marq-scroll{display:flex;white-space:nowrap;padding:16px 0;border-bottom:1px solid #232B31}'+
  '.pv-marq-scroll span{font-family:var(--f-disp);font-weight:900;font-size:clamp(30px,4.5vw,54px);line-height:1;'+
    'text-transform:uppercase;letter-spacing:-.02em;color:transparent;-webkit-text-stroke:1.5px var(--chrome);padding-right:.6em;flex:0 0 auto;'+
    'animation:pvmarq 26s linear infinite}'+
  '@keyframes pvmarq{to{transform:translateX(-100%)}}'+
  '@media(prefers-reduced-motion:reduce){.pv-marq-scroll span{animation:none}}'+
  '.pv-marq-in{display:flex;align-items:center;gap:clamp(18px,3vw,40px);padding:clamp(24px,3.5vw,44px) 0;flex-wrap:wrap}'+
  '.pv-marq-in h3{font-family:var(--f-disp);font-weight:900;font-size:clamp(22px,2.6vw,34px);line-height:1;'+
    'text-transform:uppercase;letter-spacing:-.02em;color:#fff}'+
  '.pv-marq-in p{font-size:15px;line-height:1.55;color:var(--on-ink-dim);max-width:52ch;margin-top:8px}'+
  '.pv-marq-in .mq-cta{margin-left:auto}'+
  '@media(max-width:820px){.pv-marq-in .mq-cta{margin-left:0}}'+

  /* ---- full-site skin: the league-site visual language on EVERY page ---- */
  '.h-page,.h-sec{font-family:var(--f-disp);font-weight:900;text-transform:uppercase;letter-spacing:-.02em}'+
  '.h-page{font-size:clamp(30px,4.4vw,52px);line-height:.98}'+
  '.h-sec{font-size:clamp(24px,3vw,34px);line-height:1.02}'+
  '.h-card{font-weight:800}'+
  '.card-h h3{font-family:var(--f-disp);font-weight:900;font-size:14.5px;letter-spacing:.03em}'+
  '.tbl th{font-size:9.5px;letter-spacing:.13em}'+
  '.btn{font-family:var(--f-disp);font-weight:700}'+
  '.mh-nav a{font-weight:700}'+
  '.chip{font-family:var(--f-mono);font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase}'+
  '.statline>div b{font-family:var(--f-disp);font-weight:900}'+
  '.kpi b.num{font-family:var(--f-disp);font-weight:900}'+
  '.card.raise{transition:transform .18s ease,border-color .18s ease}'+
  '.card.raise:hover{transform:translateY(-3px);border-color:var(--steel)}';
  var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  /* ---- preview ribbon (so nobody mistakes this for the live site) ---- */
  function ensureRibbon(){
    if (document.getElementById("pv-ribbon")) return;
    var r = document.createElement("div");
    r.id = "pv-ribbon";
    r.textContent = "Preview build · testing the new look · the real site is unchanged";
    document.body.insertBefore(r, document.body.firstChild);
  }

  /* ---- generative art for story tiles / the featured panel (no photography yet:
         club colour + the mark carry the image slot) ---- */
  function artFor(a, w, h){
    var t0 = a && a.relatedTeams && a.relatedTeams[0] &&
      CG.TEAMS.find(function(t){ return t.name === a.relatedTeams[0]; });
    var c = (t0 && t0.color) || "#FFE500";
    return '<svg viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="xMidYMid slice" aria-hidden="true">'+
      '<rect width="'+w+'" height="'+h+'" fill="#101519"/>'+
      '<circle cx="'+(w*0.82)+'" cy="'+(h*0.14)+'" r="'+(h*0.62)+'" fill="'+c+'" opacity=".24"/>'+
      '<circle cx="'+(w*0.82)+'" cy="'+(h*0.14)+'" r="'+(h*0.38)+'" fill="'+c+'" opacity=".34"/>'+
      '<path d="M0 '+(h*0.8)+' L'+w+' '+(h*0.62)+' L'+w+' '+h+' L0 '+h+' Z" fill="'+c+'" opacity=".15"/>'+
      '<text x="'+(w*0.05)+'" y="'+(h*0.9)+'" font-family="Archivo, sans-serif" font-weight="900" '+
        'font-size="'+(h*0.3)+'" fill="#FFFFFF" opacity=".08">CGHL</text></svg>';
  }

  /* ---- score strip: date groups + game cards (finals, upcoming, or real milestones) ---- */
  function crest(code, size){ return CG.crest ? CG.crest(code, size||20) : ""; }
  function dateCard(ms){
    var d = CG.fmtDay(ms), m = d.split(", ");
    return '<div class="pv-date"><span>'+esc((m[0]||d).toUpperCase())+'</span><b>'+esc((m[1]||"").toUpperCase())+'</b></div>';
  }
  function recOf(code){
    var t = CG.lg && CG.lg.teams && CG.lg.teams[code];
    if (!t || (t.w|0)+(t.l|0)+(t.otl|0) === 0) return "";
    return '<span class="rec">'+t.w+'-'+t.l+'-'+t.otl+'</span>';
  }
  function stripHtml(){
    var lg = CG.lg || {}, out = [], lastDay = null;
    function dayMark(ms){
      var k = CG.fmtDay(ms);
      if (k !== lastDay){ lastDay = k; out.push(dateCard(ms)); }
    }
    var finals = (lg.allResults||[]).slice().sort(function(a,b){ return a.at-b.at; }).slice(-4);
    var upcoming = (lg.schedule||[]).filter(function(g){ return g.at > CG.now(); })
      .sort(function(a,b){ return a.at-b.at; }).slice(0, 8 - finals.length);
    finals.forEach(function(r){
      dayMark(r.at);
      var aw = r.score[r.away], hs = r.score[r.home];
      out.push('<a class="pv-game" href="#/matchup/'+r.id+'"><span class="pv-st">FINAL'+(r.ot?" · OT":"")+'</span>'+
        '<span class="pv-row'+(aw>hs?" win":" dim")+'">'+crest(r.away)+'<b>'+esc(r.away)+'</b><span class="sc">'+aw+'</span></span>'+
        '<span class="pv-row'+(hs>aw?" win":" dim")+'">'+crest(r.home)+'<b>'+esc(r.home)+'</b><span class="sc">'+hs+'</span></span></a>');
    });
    upcoming.forEach(function(g){
      dayMark(g.at);
      var live = (CG.liveStreamers && CG.liveStreamers(g).length);
      out.push('<a class="pv-game" href="#/matchup/'+g.id+'"><span class="pv-st">'+
          (live ? '<span class="live-dot"></span>LIVE' : esc(CG.fmtTime(g.at).toUpperCase())+' ET')+'</span>'+
        '<span class="pv-row">'+crest(g.away)+'<b>'+esc(g.away)+'</b>'+recOf(g.away)+'</span>'+
        '<span class="pv-row">'+crest(g.home)+'<b>'+esc(g.home)+'</b>'+recOf(g.home)+'</span></a>');
    });
    if (!out.length){
      /* no games yet — the strip carries the real season milestones instead of going blank */
      var s = CG.SEASON || {};
      [["Sign-up deadline", s.registration_deadline, "#/register"], ["Pre-season", s.preseason_starts_at, "#/schedule"],
       ["Draft night", s.draft_at, "#/schedule"], ["Free agency", s.free_agency_opens_at, "#/rulebook"],
       ["Puck drop", s.starts_at, "#/schedule"]]
      .forEach(function(m){
        if (!m[1]) return;
        var ms = Date.parse(m[1]);
        out.push(dateCard(ms));
        out.push('<a class="pv-game" href="'+m[2]+'"><span class="pv-st">'+esc(((CG.seasonTag&&CG.seasonTag())||"Season 1").toUpperCase())+'</span>'+
          '<span class="pv-row"><b>'+esc(m[0])+'</b></span></a>');
      });
    }
    return '<button class="pv-arr l" data-pv-arr="-1" aria-label="Scroll games back">&#9664;</button>'+
      '<div class="pvstrip">'+out.join("")+'</div>'+
      '<button class="pv-arr r" data-pv-arr="1" aria-label="Scroll games forward">&#9654;</button>';
  }

  /* strip arrows: one delegated listener, wired once */
  document.addEventListener("click", function(ev){
    var b = ev.target && ev.target.closest && ev.target.closest("[data-pv-arr]");
    if (!b) return;
    var track = document.querySelector("#ticker .pvstrip");
    if (track) track.scrollBy({ left: 320 * (+b.getAttribute("data-pv-arr") || 1), behavior: "smooth" });
  });

  var _renderChrome = CG.renderChrome;
  CG.renderChrome = function(){
    _renderChrome.apply(this, arguments);
    try {
      ensureRibbon();
      var t = document.getElementById("ticker"), mast = document.getElementById("masthead");
      if (t){ t.innerHTML = stripHtml(); t.classList.add("pv-has-arrows"); }
      /* the reference order: nav first, scores under it */
      if (t && mast && mast.parentNode && (mast.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_PRECEDING)){
        mast.parentNode.insertBefore(t, mast.nextSibling);
      }
      /* calm the masthead CTA: outline treatment, chrome stays the page's only filled accent. */
      var dj = document.querySelector('#masthead a[aria-label="Join with Discord"]');
      if (dj){ dj.style.background = "transparent"; dj.style.border = "1.5px solid #5865F2"; dj.style.color = "var(--on-ink)"; }
    } catch(e){ /* fail safe: the original ticker stays */ }
  };

  /* ---- home: featured hero + slides rail, stories band, marquee band ---- */
  function pvHero(){
    var s = CG.SEASON || {};
    var regOpen = !!(s.registration_open && s.status !== "active");
    var startMs = CG.seasonStartMs && CG.seasonStartMs();
    var dateTag = startMs ? CG.fmtDay(startMs).replace(/^[A-Za-z]+, /, "") : "";
    var arts = ((CG.CONTENT && CG.CONTENT.articles) || []).slice()
      .sort(function(a,b){ return (b.dateIso||"").localeCompare(a.dateIso||""); });

    /* the featured slot: the season-launch story while registration runs, else the newest article */
    var feat;
    if (regOpen || !arts.length){
      feat = {
        eyebrow: "Featured",
        title: s.status === "active" ? esc((s.name||"The season"))+" is live." : "The puck drops "+esc(dateTag)+".",
        text: esc(CG.TEAMS.length)+" clubs, "+esc((CG.DIVISIONS||[1,2]).length)+" divisions. "+
          (regOpen && s.registration_deadline
            ? "Registration is open now — sign up by "+esc(CG.fmtDay(Date.parse(s.registration_deadline)))+" to enter the draft."
            : "Every box score imports straight from EA."),
        href: regOpen ? "#/register" : "#/schedule",
        label: regOpen ? "Register to play" : "Full schedule",
        art: artFor(arts[0], 640, 300)
      };
    } else {
      var a0 = arts[0];
      feat = { eyebrow: esc(a0.category||"Featured"), title: esc(a0.title), text: esc(a0.excerpt||""),
        href: "#/article/"+esc(a0.slug), label: "Read the story", art: artFor(a0, 640, 300) };
    }

    /* the slides rail: real stories + one utility slide, like the reference's stacked links */
    var slides = arts.slice(regOpen ? 0 : 1, regOpen ? 3 : 4).map(function(a){
      return '<div class="pv-slide"><h3>'+esc(a.title)+'</h3><a href="#/article/'+esc(a.slug)+'">Read the story</a></div>';
    });
    slides.push('<div class="pv-slide"><h3>How the season works</h3><a href="#/rulebook">Read the rulebook</a></div>');
    if (slides.length < 3 && regOpen)
      slides.push('<div class="pv-slide"><h3>Own or manage a club</h3><a href="#/owner">Apply to the league office</a></div>');

    return '<section id="hero"><div class="shell pv-hero-grid" style="padding-top:clamp(20px,3vw,36px);padding-bottom:clamp(20px,3vw,36px)">'+
      '<article class="pv-feat"><div class="art">'+feat.art+'</div><div class="fb">'+
        '<span class="fe">'+feat.eyebrow+'</span>'+
        '<h2>'+feat.title+'</h2>'+
        '<p>'+feat.text+'</p>'+
        '<a class="pv-flink" href="'+feat.href+'">'+feat.label+'</a></div></article>'+
      '<aside class="pv-slides" aria-label="More headlines">'+slides.slice(0,4).join("")+'</aside>'+
    '</div></section>';
  }

  function storiesBand(){
    var arts = ((CG.CONTENT && CG.CONTENT.articles) || []).slice()
      .sort(function(a,b){ return (b.dateIso||"").localeCompare(a.dateIso||""); }).slice(0, 10);
    if (arts.length < 2) return "";
    var week = 7*24*3600*1000;
    return '<section class="sec sec-dark" style="padding-top:clamp(26px,3.5vw,44px);padding-bottom:clamp(26px,3.5vw,44px)"><div class="shell">'+
      '<div class="sec-head"><div class="lead"><h2 class="h-sec" style="color:#fff">Top stories</h2></div>'+
      '<a class="sec-link" style="color:#fff" href="#/news">All news</a></div>'+
      '<div class="pv-tiles">'+arts.map(function(a){
        var fresh = a.dateIso && (CG.now() - Date.parse(a.dateIso)) < week;
        return '<a class="pv-tile" href="#/article/'+esc(a.slug)+'">'+artFor(a, 152, 222)+
          '<span class="shade"></span>'+(fresh?'<span class="nw">New</span>':"")+
          '<b>'+esc(a.title)+'</b></a>';
      }).join("")+'</div></div></section>';
  }

  function marqueeBand(){
    var run = "CHEL GAMING HOCKEY LEAGUE · ";
    var txt = esc(run + run + run);
    return '<section class="pv-marq"><div class="pv-marq-scroll" aria-hidden="true"><span>'+txt+'</span><span>'+txt+'</span></div>'+
      '<div class="shell pv-marq-in">'+(CG.leagueMark ? CG.leagueMark(56) : "")+
      '<div><h3>Every game counts.</h3>'+
      '<p>Wednesday and Friday nights, three games a night. Every box score imports straight from EA — nobody types in a score.</p></div>'+
      '<a class="btn mq-cta" style="border:1.5px solid #39434B;color:var(--on-ink)" href="#/rulebook">How the season works</a>'+
    '</div></section>';
  }

  var _home = CG.ROUTES.home;
  CG.ROUTES.home = function(param, qs){
    var html = _home(param, qs);
    try {
      /* 1) the hero: featured story + slides rail in place of the carousel */
      var a = html.indexOf('<section id="hero">');
      var endMark = '</aside></div></section>';
      var b = html.indexOf(endMark, a);
      if (a < 0 || b < 0) return html;            /* markers moved — ship the original untouched */
      html = html.slice(0, a) + pvHero() + html.slice(b + endMark.length);
      /* 2) the top-stories band, right after the fact strip */
      var sIdx = html.indexOf('class="statline"');
      if (sIdx > -1){
        var sEnd = html.indexOf('</section>', sIdx);
        if (sEnd > -1) html = html.slice(0, sEnd + 10) + storiesBand() + html.slice(sEnd + 10);
      }
      /* 3) the marquee band closes the page, above the footer */
      html += marqueeBand();
      return html;
    } catch(e){ return html; }
  };
  /* AFTER.home stays the original: the carousel call no-ops without #heroCaro,
     and the countdown wiring is id-based and untouched. */
})();
