/* seed: offers — Rule 2.2 contract offers, both sides, mid-season on the Bruins.
   Free agency is OPEN (the board's window check and the extension window read Date.now(), so the
   dates hang off the real clock; everything else hangs off the fixed CG.now()). A six-man free-agent
   pool, two offers the club has out (one waiting on him, one countered), the persona's own final-season
   contract, and the Owner-approves policy for the AGM. Sources: CG.hubFreeAgents (part_live.js:11728),
   CG.clubOffersCardHtml / offersCardHtml (:1570-1641), CG.extensionCardHtml (:9254), hubRoster
   Extend (part6_hub.js:1517), mgmtApprovalBanner (:6284).
   ?state= variants:
     before_window  free agency opens in 5 days (Offer disabled, "Opens …" chip)
     extout         the club also has an extension offer out to the persona's final-season player
     two            player: two free-agent offers waiting (Red Wings + Islanders)
     final          player: final-season contract, no offers ("Your contract" → Ask to re-sign)
     ask            player: his own ask (his salary + $500K × 2) is with the Bruins
     extoffer       player: the Bruins offered him his current number × 2 from Season 2 */
(window.GUIDE_SEEDS = window.GUIDE_SEEDS || []).push({ name: "offers", run: function(CG, t, uid){
  var lg = CG.lg, st = (window.GUIDE.qs.get("state") || ""), AS = window.GUIDE.as;
  var now = CG.now(), real = Date.now(), D = 864e5;
  var iso = function(ms){ return new Date(ms).toISOString(); };
  var tid = t.id;   /* "t-BOS" */

  /* ---- every salary on the $250K lattice from $750K (Rule 2.5 / v2.31) ---- */
  /* the prototype pins the richest club (this one) just under the cap; a club working the market
     has a few million of room, so the Bruins' deals come down a notch before they snap to the lattice */
  lg.players.forEach(function(p){
    if (p.salary > 0 && p.team === t.code && !p.mgmt) p.salary = p.salary * 0.9;
    if (p.salary > 0) p.salary = Math.max(CG.MIN_SALARY, Math.round(p.salary / CG.SALARY_STEP) * CG.SALARY_STEP);
  });

  /* ---- the season: free agency open now (or opening in 5 days), 17-man roster ---- */
  var ymd = function(ms){ return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(ms)); };
  /* opened three days before the fixed clock (so it is in the past on BOTH clocks — the board checks
     Date.now(), the dashboard's Road ahead card checks CG.now()); "before_window" opens five real days out */
  var opens = Date.parse(CG.etISO(ymd(st === "before_window" ? real + 5 * D : now - 3 * D), "12:00"));
  var closes = Date.parse(CG.etISO(ymd(real + 11 * D), "20:00"));
  Object.assign(CG.SEASON, { free_agency_opens_at: iso(opens), free_agency_closes_at: iso(closes), roster_max: 17, salary_cap: CG.CAP });

  /* ---- the persona's club-mates are all under contract; the first non-mgmt forward (the
          ?as=player persona, "Frostbyte") is in the final season of his ---- */
  var mine = (lg.byTeam[t.code] || []).filter(function(p){ return !p.mgmt && p.pos !== "G"; })[0];
  mine.term = 1;
  lg._contractsRaw = (lg.byTeam[t.code] || []).filter(function(p){ return !p.mgmt; }).map(function(p, i){
    return { id: "c-" + p.id, profile_id: p.id, team_id: tid, salary: p.salary, start_season: 1, end_season: p.term, status: "active", is_manager: false };
  });

  /* ---- the free-agent pool (CG.hubFreeAgents: draft complete + returning + not rostered) ---- */
  lg.draftState = { status: "complete", season_number: 1 };
  lg._rosteredIds = {}; lg.players.forEach(function(p){ lg._rosteredIds[p.id] = true; });
  lg.isReturning = function(){ return true; };
  lg.isVeteran = function(pid){ return pid !== "fa-3" && pid !== "fa-5"; };
  lg.preGp = { "fa-3": { gp: 4, g: 0, a: 1 }, "fa-5": { gp: 5, g: 2, a: 3 } };
  var FA = [
    ["fa-1", "Sn1per_Kane",   "LD", 81],
    ["fa-2", "DangleDan_88",  "C",  77],
    ["fa-3", "WallOfWaffles", "G",  null],
    ["fa-4", "TopCheddar_Ty", "RW", 74],
    ["fa-5", "BlueLineBrody", "LD", 70],
    ["fa-6", "Saucer_Sam",    "LW", 68]
  ];
  lg._profilesRaw = (lg._profilesRaw || []).concat(FA.map(function(x){ return { id: x[0], gamertag: x[1] }; }));
  lg._registrationsRaw = (lg._registrationsRaw || []).concat(FA.map(function(x, i){
    return { id: "reg-" + x[0], profile_id: x[0], position: x[2], scout_ovr: x[3], season_id: CG.SEASON.id, status: "registered",
      created_at: iso(now - (30 + i) * D), profiles: { gamertag: x[1] } };
  }));
  FA.forEach(function(x){ lg._profName[x[0]] = x[1]; });
  lg._profName[mine.id] = mine.tag;

  /* ---- Owner-approves policy for the AGM's free-agent moves, with one move already waiting ---- */
  lg._mgmtPolicy = { gm: {}, agm: { freeagents: "approve" } };
  lg._mgmtMoves = [{ id: "m-fa-1", team_id: tid, page: "freeagents", action: "offer_free_agent", status: "pending", requested_by: "u-agm",
    requester: { gamertag: window.GUIDE.names["u-agm"] }, summary: "offer Saucer_Sam $1M × 1 season", created_at: iso(now - 5 * 6e4) }];

  /* ---- offers: what the club has out, and what is waiting on the persona ---- */
  var offer = function(o){ return Object.assign({ from_team_id: tid, start_season: 1, status: "pending", last_actor: "team", note: null, immediate: true, updated_at: iso(now - 2 * 36e5) }, o); };
  CG._clubOffers = [
    offer({ id: "co-1", player_id: "fa-1", salary: 1250000, years: 2, note: "Top-pair minutes from day one." }),
    offer({ id: "co-2", player_id: "fa-2", salary: 1750000, years: 2, status: "countered", last_actor: "player", updated_at: iso(now - 40 * 6e4) })
  ];
  if (st === "extout") CG._clubOffers.push(offer({ id: "co-3", player_id: mine.id, salary: mine.salary, years: 2, start_season: 2, immediate: false, note: "Same number, two more years.", updated_at: iso(now - 20 * 6e4) }));
  /* the club-side card belongs to management only — a player runs no club */
  if (AS === "player") CG._clubOffers = [];
  CG._myOffers = [];
  if (AS === "player"){
    var extStates = { final: 1, ask: 1, extoffer: 1 };
    if (!extStates[st]){
      /* a free agent being courted: no deal of his own on the books */
      lg._contractsRaw = lg._contractsRaw.filter(function(c){ return c.profile_id !== mine.id; });
      CG._myOffers = [offer({ id: "o-1", from_team_id: CG.TEAMS[1].id, player_id: uid, salary: 1250000, years: 2, note: "You’d be a top-six wing for us from night one.", updated_at: iso(now - 3 * 36e5) })];
      if (st === "two") CG._myOffers.push(offer({ id: "o-2", from_team_id: CG.TEAMS[2].id, player_id: uid, salary: 1500000, years: 1, note: "One season to show us, then we talk again.", updated_at: iso(now - 50 * 6e4) }));
    }
    if (st === "ask")      CG._myOffers = [offer({ id: "o-ask", player_id: uid, salary: mine.salary + 2 * CG.SALARY_STEP, years: 2, start_season: 2, status: "countered", last_actor: "player", immediate: false, updated_at: iso(now - 25 * 6e4) })];
    if (st === "extoffer") CG._myOffers = [offer({ id: "o-ext", player_id: uid, salary: mine.salary, years: 2, start_season: 2, immediate: false, note: "Same number, two more years.", updated_at: iso(now - 25 * 6e4) })];
  }

  /* ---- the bell (CG.baseNotifs reads CG._notifs, and the dashboard's "Latest alerts" card is the
          first three of them — with none seeded the card rendered as an empty box). Every row is
          built from the offers above, so the card can never claim a deal this screen doesn't show.
          Management's are pre-read: their dashboard has no alerts card, and an unread badge in the
          masthead would be noise on every club shot. ---- */
  var notifs = [], read = {};
  var money = function(v){ return CG.fmtMoney(v); };
  var yrs = function(n){ return n + " season" + (n === 1 ? "" : "s"); };
  if (AS === "player"){
    (CG._myOffers || []).forEach(function(o){
      if (o.last_actor !== "team") return;   /* his own ask is not an alert TO him */
      var code = lg._idToCode[o.from_team_id] || t.code, club = (CG.TEAM[code] || {}).name || code;
      notifs.push({ id: "n-" + o.id, t: Date.parse(o.updated_at), icon: "check", read: false,
        title: (o.immediate ? "Contract offer — " : "Extension offer — ") + club,
        body: money(o.salary) + " per season for " + yrs(o.years) + ". Accept, counter, or decline from your dashboard (Rule 2.2).",
        route: "#/hub" });
    });
    if (st === "ask") notifs.push({ id: "n-ask", t: now - 25 * 6e4, icon: "check", read: false,
      title: "Your re-sign ask is with " + t.name, body: money(mine.salary + 2 * CG.SALARY_STEP) + " per season for " + yrs(2) + ", from Season 2. Management can accept, revise, or walk away.", route: "#/hub" });
    if (st === "final") notifs.push({ id: "n-final", t: now - 26 * 36e5, icon: "cal", read: false,
      title: "You're in the final season of your deal", body: "Ask " + t.name + " to re-sign you, or hear other clubs out when free agency opens (Rule 2.2).", route: "#/hub" });
  } else {
    var counter = (CG._clubOffers || []).filter(function(o){ return o.last_actor === "player"; })[0];
    if (counter) notifs.push({ id: "n-" + counter.id, t: Date.parse(counter.updated_at), icon: "check", read: true,
      title: (lg._profName[counter.player_id] || "A free agent") + " countered",
      body: "He wants " + money(counter.salary) + " per season for " + yrs(counter.years) + ". Accept his terms, revise, or walk away.", route: "#/hub" });
    if (AS === "owner") notifs.push({ id: "n-appr", t: now - 5 * 6e4, icon: "users", read: true,
      title: "1 move waiting for your approval", body: (window.GUIDE.names["u-agm"] || "Your AGM") + " sent a free-agent offer for you to approve (Rule 2.6).", route: "#/hub/management" });
    else if (AS === "agm") notifs.push({ id: "n-appr", t: now - 5 * 6e4, icon: "users", read: true,
      title: "Your offer is with the Owner", body: "Free-agent moves take effect only once " + (window.GUIDE.names["u-own"] || "the Owner") + " approves them (Rule 2.6).", route: "#/hub/freeagents" });
  }
  notifs.push({ id: "n-fa-open", t: opens, icon: "users", read: AS !== "player",
    title: st === "before_window" ? "Free agency opens " + CG.fmtFull(opens) : "Free agency is open",
    body: st === "before_window"
      ? "Clubs can send terms to any player without a contract the moment the window opens (Rule 2.2)."
      : (AS === "player" ? "Any club can send you terms until " + CG.fmtFull(closes) + " (Rule 2.2)."
                         : "Send terms to any player without a club until " + CG.fmtFull(closes) + " (Rule 2.2)."),
    route: AS === "player" ? "#/hub" : "#/hub/freeagents" });
  if (CG.WEEK8 && CG.WEEK8.open) notifs.push({ id: "n-avail", t: now - 24 * 36e5, icon: "cal", read: true,
    title: CG.WEEK8.label + " availability is open", body: "Submit before " + CG.fmtFull(CG.WEEK8.deadline) + " (Rule 5.1).", route: "#/hub/availability" });
  CG._notifs = notifs.sort(function(a, b){ return b.t - a.t; });
  /* the bell's read state lives in the local store, not on the row — keep the two in step */
  try { CG._notifs.forEach(function(n){ if (n.read) read[n.id] = true; }); CG.store.set("read", Object.assign(CG.store.get("read") || {}, read)); } catch(e){}

  /* ---- the cap outlook the Roster page and the Extend modal read (team_cap_outlook) ---- */
  var room = (lg.byTeam[t.code] || []).filter(function(p){ return !p.mgmt; });
  var mgmtPay = (lg.byTeam[t.code] || []).filter(function(p){ return p.mgmt; }).reduce(function(s, p){ return s + (p.salary || 0); }, 0);
  var outlook = [1, 2, 3, 4].map(function(sn){
    var deals = room.filter(function(p){ return p.term >= sn; }).map(function(p){ return { name: p.tag, salary: p.salary, final: p.term === sn }; });
    var committed = deals.reduce(function(s, d){ return s + d.salary; }, 0) + mgmtPay;
    return { season: sn, space: CG.CAP - committed, committed: committed, management: mgmtPay, deals: deals, current: sn === 1,
      expiring_after: deals.filter(function(d){ return d.final; }).reduce(function(s, d){ return s + d.salary; }, 0) };
  });
  window.GUIDE_RPC = window.GUIDE_RPC || {};
  window.GUIDE_RPC.team_cap_outlook = function(){ return { data: outlook, error: null }; };

  /* ---- the negotiation RPCs behave: the seeded offers move the way the real rows would, so an
          after-state (toast + re-render) is honest rather than a repeat of the before-state ---- */
  var byId = function(list, id){ return (list || []).filter(function(o){ return o.id === id; })[0]; };
  window.GUIDE_RPC.mgmt_request_move = function(a){
    lg._mgmtMoves.push({ id: "m-new", team_id: tid, page: CG.MGMT_ACTION_PAGE[a.p_action] || "freeagents", action: a.p_action, status: "pending", requested_by: uid,
      requester: { gamertag: window.GUIDE.names[uid] }, summary: a.p_summary, created_at: iso(now) });
    return { data: "m-new", error: null };
  };
  window.GUIDE_RPC.offer_free_agent = function(a){
    var reg = (lg._registrationsRaw || []).filter(function(r){ return r.id === a.p_registration; })[0];
    if (reg){ CG._clubOffers = CG._clubOffers.filter(function(o){ return o.player_id !== reg.profile_id; }); CG._clubOffers.unshift(offer({ id: "co-new", player_id: reg.profile_id, salary: a.p_salary, years: a.p_years, note: a.p_note, updated_at: iso(now) })); }
    return { data: "co-new", error: null };
  };
  window.GUIDE_RPC.offer_extension = function(a){
    CG._clubOffers = CG._clubOffers.filter(function(o){ return !(o.player_id === a.p_profile && !o.immediate); });
    CG._clubOffers.push(offer({ id: "co-ext", player_id: a.p_profile, salary: a.p_salary, years: a.p_years, start_season: 2, immediate: false, note: a.p_note, updated_at: iso(now) }));
    return { data: "co-ext", error: null };
  };
  window.GUIDE_RPC.request_extension = function(a){
    CG._myOffers = (CG._myOffers || []).filter(function(o){ return o.immediate; });
    CG._myOffers.push(offer({ id: "o-ask", player_id: uid, salary: a.p_salary, years: a.p_years, start_season: 2, status: "countered", last_actor: "player", immediate: false, note: a.p_note, updated_at: iso(now) }));
    return { data: "o-ask", error: null };
  };
  window.GUIDE_RPC.respond_offer = function(a){
    var o = byId(CG._myOffers, a.p_offer) || byId(CG._clubOffers, a.p_offer);
    var isPlayer = !!byId(CG._myOffers, a.p_offer);
    if (o){
      if (a.p_action === "accept"){
        if (isPlayer) CG._myOffers = [];
        CG._clubOffers = CG._clubOffers.filter(function(x){ return x.id !== o.id; });
        /* a free-agent signing moves the persona to the club that signed him, so the dashboard that
           re-renders under the "welcome aboard" toast is the new club's */
        var code = lg._idToCode[o.from_team_id], me = CG.me && CG.me();
        if (isPlayer && o.immediate && code && me && me.team !== code){
          lg.byTeam[me.team] = lg.byTeam[me.team].filter(function(p){ return p !== me; });
          me.team = code; (lg.byTeam[code] = lg.byTeam[code] || []).push(me);
        }
      }
      else if (a.p_action === "deny"){ CG._myOffers = (CG._myOffers || []).filter(function(x){ return x.id !== o.id; }); CG._clubOffers = CG._clubOffers.filter(function(x){ return x.id !== o.id; }); }
      else if (a.p_action === "edit"){ o.salary = a.p_salary; o.years = a.p_years; o.status = "countered"; o.last_actor = isPlayer ? "player" : "team"; o.updated_at = iso(now); }
    }
    return { data: null, error: null };
  };
} });
