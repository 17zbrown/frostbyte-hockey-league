/* ================================================================
   PLATFORM BLUEPRINT (Phase-1 deliverables, reviewable in-app) + INIT
   ================================================================ */
CG.ROUTES.blueprint = function(){
  function block(title, inner){
    return '<div class="card" style="margin-bottom:18px"><div class="card-h"><h3>'+title+'</h3></div><div class="card-b">'+inner+'</div></div>';
  }
  var kv = function(rows){ return rows.map(function(r){
    return '<div style="display:flex;gap:14px;padding:8px 0;border-bottom:1px solid var(--line-soft);font-size:13.5px">'+
      '<b style="min-width:190px;font-family:var(--f-disp)">'+r[0]+'</b><span style="color:var(--steel)">'+r[1]+'</span></div>'; }).join(""); };
  return CG.pageHead("How this prototype maps to production","Platform blueprint",
    "The architecture behind what you’re clicking: every decision here carries straight into the production build.")+
  '<div class="shell" style="padding-bottom:40px;max-width:980px">'+
  block("Product vision", '<p class="small" style="line-height:1.7;color:var(--steel)">Chel Gaming is a competitive EA Sports NHL 6v6 league that deserves better than spreadsheets and Discord pins. The platform is the league’s single source of truth: schedules, standings, and stats computed from verified results; private operations (availability, lineups, game codes, complaints) gated by real roles; and a commissioner console that runs the whole league without touching code. Premium sports-editorial feel — broadcast, not “gamer.”</p>')+
  block("Design tokens", kv([
    ["Palette (6)","Ice #F5F6F2 canvas · Paper #FFFFFF · Jersey Ink #101519 · Steel #5C6B75 · Chrome Yellow #FFE500 (single accent) · Goal Red #D6453D + Win Green #1F9D58 (semantic only)"],
    ["Type","Archivo 800–900 display (broadcast confidence) · IBM Plex Sans body · IBM Plex Mono for data, codes, and labels — font-display: swap with system fallbacks"],
    ["Scale","Display clamp(38→62)/0.98 · Page 28→42 · Section 21→27 · Card 16.5 · Body 15.5/1.6 · Small 13 · Caption 12 · Mono labels 10–11/0.1–0.2em tracking · tabular numerals in every table"],
    ["Signatures","Ink scoreboard ticker · chrome underline on active nav & section eyebrows · team-color spines on data rows · dark broadcast bands between light editorial sections · hard 1.5px ink borders instead of shadow soup"]
  ]))+
  block("Sitemap", '<div class="grid g3" style="font-size:13px">'+
    [["Public","Home · Schedule · Standings · Teams (+8 club pages) · Players (+96 profiles) · Stats · Awards · Power Rankings · News (+articles) · Rulebook · Matchup center (×80) · Search · Sign in"],
     ["Member hub","Dashboard · Availability · Lineup builder (mgmt) · Complaints (+case pages) · Notifications · Settings · Staff desk (modular grants)"],
     ["Control center","Overview · Results (+ AI screenshot import) · Codes · Presets · Schedule · Seasons · Users & roles · Ratings · Rankings · Awards · Complaints · Newsroom · Homepage · Carousel · Media · Rulebook · Automations · Import/export · Audit · Settings"]
    ].map(function(c){ return '<div><span class="eyebrow chr">'+c[0]+'</span><p style="margin-top:10px;color:var(--steel);line-height:1.7">'+c[1]+'</p></div>'; }).join("")+'</div>')+
  block("Role & permission matrix", '<div class="tblwrap"><table class="tbl keepcols"><thead><tr><th class="tleft">Capability</th><th>Guest</th><th>Member</th><th>Mgmt</th><th>Staff*</th><th>Commish</th></tr></thead><tbody>'+
    [["View public league content","✓","✓","✓","✓","✓"],
     ["Submit weekly availability","—","✓","✓","—","override"],
     ["View team availability grid","—","—","✓","✓","✓"],
     ["Build & submit lineups","—","—","✓","—","override"],
     ["View private game codes","—","own games","own games","✓","✓"],
     ["File complaints","—","✓","✓","—","✓"],
     ["Review complaints","—","—","—","if granted","✓"],
     ["Enter results / stats","—","—","—","if granted","✓"],
     ["Publish news & rankings","—","—","—","if granted","✓"],
     ["Configure ratings, rules, settings","—","—","—","—","✓"],
     ["Read audit log","—","—","—","—","✓"]
    ].map(function(r){ return '<tr><td class="tleft">'+r[0]+'</td>'+r.slice(1).map(function(c){ return '<td style="font-family:var(--f-mono);font-size:11px">'+c+'</td>'; }).join("")+'</tr>'; }).join("")+
    '</tbody></table></div><p class="caption" style="margin-top:10px">*Staff grants are modular (scheduler, statistician, complaints, news, awards, rulebook…). Enforcement is server-side in production — the UI merely reflects it. Try any gated page in the wrong seat and you’ll get the unauthorized state, here and in production.</p>')+
  block("Recommended stack", kv([
    ["Framework","Next.js (App Router) + TypeScript + React — server components for public pages, client islands for builders"],
    ["Data","PostgreSQL + Prisma · Supabase-hosted (matches the league’s existing infrastructure and RLS posture)"],
    ["Auth","Auth.js with Discord OAuth primary + email fallback; sessions in secure cookies; role claims resolved server-side"],
    ["UI","Tailwind + custom token system (the palette above) · shadcn/ui as low-level a11y primitives only · Framer Motion, sparingly"],
    ["Validation","Zod schemas shared by forms and API routes · React Hook Form on complex forms (complaint, lineup, imports)"],
    ["Media","S3-compatible storage, signed URLs for private assets, optimized variants on upload"],
    ["Email","Resend for digests, resets, and notification fallback"],
    ["Testing","Vitest (ratings, standings, tiebreakers, code-visibility, permissions) + Playwright (availability, lineup, complaint, publish flows)"]
  ]))+
  block("Database model (48 entities)", '<p class="caption" style="margin-bottom:10px">Grouped; every table gets timestamps, and mutating tables get soft-delete + audit hooks. Histories are stored, not overwritten: rating snapshots, lineup revisions, rulebook versions, complaint status trails.</p>'+
    kv([
      ["Identity","User · Account · Session · Role · Permission · UserRole · RolePermission · NotificationPreference"],
      ["League","Season · Conference · Division · Team · TeamMembership · TeamManagementRole · Player · PlayerProfile"],
      ["Competition","ScheduleWeek · Game · GameCode · ServerPreset · GameServerSetting · GameLineup · LineupSlot · LineupRevision"],
      ["Participation","AvailabilitySubmission · AvailabilityEntry"],
      ["Statistics","SkaterGameStat · GoalieGameStat · TeamGameStat · PlayerSeasonStat · TeamSeasonStat · Standing"],
      ["Ratings","RatingFormula · PlayerOverall · TeamOverall (history rows, never overwritten)"],
      ["Honors","PowerRanking · PowerRankingEntry · Award · AwardNominee · AwardVote · AwardRecipient"],
      ["Operations","Complaint · ComplaintEvidence · ComplaintAssignment · ComplaintComment · ComplaintDecision · Appeal · Suspension · Warning · Transaction"],
      ["Content","Article · ArticleCategory · Tag · MediaAsset · HeroSlide · HomepageModule · Announcement · Rulebook · RulebookVersion · RulebookSection"],
      ["System","Notification · AuditLog · ImportJob · ExportJob · SiteSetting"]
    ]))+
  block("Security posture", '<p class="small" style="color:var(--steel);line-height:1.7">Server-side authorization on every action (the permission matrix above lives in code, not in role names). Game codes exist only server-side and are released by a scheduled job at T-30 to eligible accounts — never rendered into public HTML, API responses, metadata, or logs. Complaints carry row-level access rules plus an access log. Rate limits on submissions; validated uploads with restricted MIME types; signed media URLs; secure cookies; immutable audit trail; environment-validated secrets; nightly backups with 30-day retention.</p>'+
    '<p class="caption" style="margin-top:10px">Prototype honesty: this demo is client-only, so its “private” codes are gated by UI logic, not a server — the real gate ships with the backend.</p>')+
  block("What the engine does (and why the demo numbers are real)", '<p class="small" style="color:var(--steel);line-height:1.7">The prototype simulates Season 1 deterministically: 48 completed box scores drive everything you see. Standings are summed from results; leaderboards are summed from box scores; ratings run the documented formula; Three Stars rank real game performances. Enter a final in the Control Center and the entire league recomputes — which is exactly the data-flow contract the production backend implements with PostgreSQL instead of an in-browser engine.</p>')+
  block("Implementation order", kv([
    ["Phase 2 · Foundation","Schema + migrations · auth + RBAC · design system · navigation · seed data · dashboards (shells)"],
    ["Phase 3 · Core league","Teams · players · schedule · standings · stats · availability · lineups · matchup center · codes"],
    ["Phase 4 · Operations","Complaints · discipline · transactions · awards · rankings · rulebook · newsroom · homepage/carousel managers · media · notifications"],
    ["Phase 5 · Launch","Test suites · a11y + responsive passes · security review · SEO · docs · deployment + backups · admin guide"]
  ]))+
  '<div class="note chr"><b style="font-family:var(--f-disp)">Reviewing this prototype:</b> use the yellow strip up top to switch seats (Guest → Member → Team Mgmt → Staff → Commissioner). Everything clickable does something; everything gated explains itself. Reset wipes your demo changes.</div>'+
  '</div>';
};

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
