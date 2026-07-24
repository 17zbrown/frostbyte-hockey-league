/* ================================================================
   SEARCH PAGE + INIT
   ================================================================ */
/* The Platform Blueprint route was removed: it was a prototype-era pitch page
   ("how this prototype maps to the real build", recommended stack, phase plan) that
   shipped to production and rendered publicly at /#/blueprint. */


/* ---------- search results page (palette handles quick search; this is the full page) ---------- */
CG.ROUTES.search = function(param, qs){
  return CG.pageHead("Search","League search","Players, clubs, games, stories, and rules — press / anywhere to search.")+
    '<div class="shell" style="padding-bottom:40px"><div class="empty"><div class="e-art">'+CG.ic("search",22)+'</div><b>Search opens in the command palette</b><p>Type to find anything; ↑↓ to move, Enter to open.</p></div></div>';
};
CG.AFTER.search = function(){ setTimeout(CG.openPalette, 50); };

/* ================================================================
   INIT
   ================================================================ */
(function init(){
  /* theme: saved preference wins, otherwise follow the OS */
  var savedTheme = (CG.store.get("prefs")||{}).theme;
  document.documentElement.setAttribute("data-theme",
    savedTheme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
  /* the simulated boot runs only for the prototype build; the live build sets
     CG.LIVE_MODE and boots asynchronously from Supabase (see part_live.js). */
  if (!CG.LIVE_MODE){
    CG.boot();
    /* merge session-published articles into the newsroom */
    (CG.store.get("published")||[]).forEach(function(a){
      if (!CG.CONTENT.articles.some(function(x){ return x.slug===a.slug; })) CG.CONTENT.articles.unshift(a);
    });
    CG.renderChrome();
    if (!location.hash) location.hash = "#/home";
    CG.router();
  }
  /* dev smoke test: CG.__smoke() renders every route in every role and reports errors */
  CG.__smoke = function(){
    var routes = ["home","schedule","standings","standings?view=league","standings?view=wildcard","teams","players","stats","stats?tab=goalies","stats?tab=teams","awards","awards?tab=potw","awards?tab=season","rankings","news","rulebook","blueprint","signin","search"];
    CG.TEAMS.forEach(function(t){ routes.push("team/"+t.code, "team/"+t.code+"?tab=games", "team/"+t.code+"?tab=stats", "team/"+t.code+"?tab=moves", "team/"+t.code+"?tab=honors", "team/"+t.code+"?season=pre", "team/"+t.code+"?season=pre&tab=games", "team/"+t.code+"?season=pre&tab=stats"); });
    CG.lg.players.forEach(function(p,i){ if (i%12===0) routes.push("player/"+p.id, "player/"+p.id+"?tab=log", "player/"+p.id+"?tab=honors", "player/"+p.id+"?season=pre", "player/"+p.id+"?season=pre&tab=log", "player/"+p.id+"?season=pre&tab=honors"); });
    CG.lg.schedule.forEach(function(g,i){ if (i%9===0) routes.push("matchup/"+g.id); });
    routes.push("hub","hub/availability","hub/lineup","hub/complaints","hub/complaint?id=CG-0142","hub/statsentry","hub/notifications","hub/settings");
    ["","results","codes","presets","schedule","seasons","users","ratings","rankings","awards","complaints","news","homepage","carousel","media","rulebook","automations","data","audit","settings"].forEach(function(s){ routes.push("admin"+(s?"/"+s:"")); });
    var errs = [], count = 0;
    var article0 = CG.CONTENT.articles[0]; routes.push("article/"+article0.slug);
    ["guest","member","mgmt","staff","commish"].forEach(function(role){
      CG.store.set("role", role);
      routes.forEach(function(r){
        try {
          var parts = r.split("?");
          var seg = parts[0].split("/");
          var qs = {};
          (parts[1]||"").split("&").forEach(function(p){ if(!p)return; var x=p.split("="); qs[x[0]]=decodeURIComponent(x[1]||""); });
          var fn = CG.ROUTES[seg[0]] || CG.ROUTES._404;
          var html = fn(seg.slice(1).join("/")||null, qs);
          if (typeof html !== "string" || (html.length<40 && seg[0]!=="hub")) errs.push(role+" /"+r+" -> suspiciously empty");
          count++;
        } catch(e){ errs.push(role+" /"+r+" -> "+e.message); }
      });
    });
    CG.store.set("role","guest");
    return { rendered: count, errors: errs };
  };
})();
</script>
</body>
</html>
