/* CGHL Season 2: the live client (v5.00 swap, stream f, 2026-11-24). Sign-in with Discord through Supabase Auth, the ONE
   write door behind S2.write (S2._writeImpl), the bell, the league pulse and the new-version check. Each part is a port of
   the current site's own door in src/live/part_live.js, and keeps the rules its incidents taught:
     sign-in        CG.ensureSb, CG.signIn, CG.signOut, CG.initAuth, CG.applySession, CG.discordIdentityPatch (memories
                    auth-event-thrash, discord-account-switching)
     writes         CG.mgmtQueue (Owner approval) and the house trap: an update or delete that RLS filters returns 0 rows
                    and no error, so every table write asks for its ids back and an empty answer is a failure
     the bell       CG.loadNotifs, CG.openBell
     the pulse      CG.LIVE_DOMAINS, CG.pulseApply, CG._pulseFlush, CG.pulseCatchUp, CG.subscribeLeague, CG.quietRepaint
                    (memory live-pulse-v405; nothing here ever asks Netlify for anything: netlify-usage-efficiency)
     new versions   CG._checkBuild, CG._applyUpdate, CG.armLiveWatch
   Live mode only (S2.LIVE, js/core.js). In the demo and the fixture suites nothing here touches the network, and S2.write
   still rejects with no S2._writeImpl, so no page can pass against a stub that pretends to save. Contract:
   ~/Developer/cghl-private/contracts/client-api.md. */
(function () {
  "use strict";
  var S2 = window.S2;
  if (!S2 || !S2.session || !S2.live || !S2.route) throw new Error("js/live.js loads after js/core.js");

  /* the project and its PUBLIC anon key, exactly as the current site has them (src/live/part_live.js CG.SB_URL and
     CG.SB_KEY). The anon key is public by design; tools/ui/live.test.cjs fails if the two sites ever disagree */
  S2.SB_URL = "https://bzbuyclwdhmhdzujxeqd.supabase.co";
  S2.SB_KEY = "sb_publishable_9OVgiNJSCSKKp0NfnCwbBQ_W1rcrK3Z";
  /* the league read (js/load.js) asks s2_league for these sections and no others (sql v4.57, v_all) */
  S2.SECTIONS = ["league", "teams", "seasons", "config", "games", "box", "pct", "rosters", "ratings", "people", "career", "honors", "tenures",
    "signups", "suspensions", "draft", "news", "wire"];

  /* the client, made the first time supabase-js is actually on the page. Re-runnable, as CG.ensureSb is: the library can
     arrive late from the CDN fallback, and latching null here would make that fallback inert */
  S2.sb = null;
  S2.ensureSb = function () {
    if (S2.sb) return S2.sb;
    if (!S2.LIVE || !(window.supabase && window.supabase.createClient)) return null;
    S2.sb = window.supabase.createClient(S2.SB_URL, S2.SB_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
    return S2.sb;
  };

  /* every refusal is an Error carrying the database's code and hint (client-api.md); the page shows message and keeps input */
  function fail(message, code, hint) { var e = new Error(message); e.code = code || null; e.hint = hint || null; return e; }
  /* the ONE read door (QA round 2, 2026-11-25: lobby, desk, control, gamedesk, lineups, hq and pickups each kept their own
     six-line copy). q(c) builds the request on the league's read client (S2.ensureSb). No client is an error, never an
     empty answer, so an empty list always means the league answered empty, never that nothing was asked; o.offline is
     that error's sentence for the page (default: this can't be read here). A refusal is an Error with the database's
     message (or "The league did not answer."), code and hint. The answer is r.data as the league gave it (null when
     none), or with o.list a list ([] for an empty answer). Phase B moves each copy onto it; every copy is one of these
     shapes, so the move changes no behavior */
  S2.rd = function (q, o) {
    o = o || {};
    return Promise.resolve().then(function () {
      var c = S2.ensureSb();
      if (!c) throw new Error(o.offline || "Not connected to the league, so this can't be read here. Reload the page and try again.");
      return q(c);
    }).then(function (r) {
      if (r && r.error) throw fail(r.error.message || "The league did not answer.", r.error.code, r.error.hint);
      return o.list ? (r && r.data) || [] : r ? r.data : null;
    });
  };
  function fromDb(err) { var e = fail(err.message || "The league could not save that.", err.code, err.hint); if (err.details) e.details = err.details; return e; }
  function store(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private window: the return trip is simply not remembered */ } }
  function stored(k) { try { var v = localStorage.getItem(k); if (v != null) localStorage.removeItem(k); return v == null ? null : JSON.parse(v); } catch (e) { return null; } }

  /* ================================================================ sign-in ================================================================ */
  var A = S2.auth = { user: null, profile: null };
  var authUid, applying = false, queued = null, idPatchRefused = null, notifCh = null;
  var DEFAULTS = { user: null, profileId: null, accessToken: null, isStaff: false, isCommissioner: false, teamId: null, teamCode: null, seat: null, committees: [] };
  /* Discord sends the member back to the page they started on (Supabase allows https://chelgamingleague.com/**). The root
     keeps the current site's exact origin-only address, which the allowlist has always held */
  function back() { return location.pathname === "/" ? location.origin : location.origin + location.pathname; }
  /* where to land after the round trip, kept ten minutes at most so a stale one never hijacks a later visit */
  function stashReturn(h) { store("s2_return", { h: h, at: Date.now() }); }
  function takeReturn() { var o = stored("s2_return"); return o && typeof o.h === "string" && o.h.indexOf("#/") === 0 && Date.now() - (o.at || 0) < 600000 ? o.h : null; }

  S2.signIn = function () {
    var sb = S2.ensureSb();
    if (!sb) { S2.toast("Sign-in is not connected on this page. Reload it and try again.", "err"); return Promise.resolve(false); }
    stashReturn(/^#\/./.test(location.hash) ? location.hash : "#/today");
    /* identify only: the site never asks Discord to add anyone to the server (auto-join is retired) */
    return sb.auth.signInWithOAuth({ provider: "discord", options: { redirectTo: back(), scopes: "identify" } }).then(function (r) {
      if (r && r.error) { store("s2_return", null); S2.toast("Discord sign-in did not start: " + r.error.message, "err"); return false; }
      return true;
    });
  };
  S2.signOut = function () {
    var sb = S2.ensureSb(); if (!sb) return Promise.resolve(false);
    return sb.auth.signOut().then(function (r) {
      if (r && r.error) { S2.toast("Sign-out did not finish: " + r.error.message, "err"); return false; }
      S2.go("#/today"); return true;
    });
  };
  /* a new Discord account joins this login (memory discord-account-switching): back on Settings, the account linked after
     this moment is the one the member proved they own, and S2.takeDiscordSwitch picks it out */
  S2.linkDiscord = function () {
    var sb = S2.ensureSb();
    if (!sb || !sb.auth.linkIdentity) return Promise.reject(fail("Not connected. Reload the page and try again.", "S2_OFFLINE"));
    stashReturn("#/you?tab=settings"); store("s2_dc_switch", { at: Date.now() });
    return sb.auth.linkIdentity({ provider: "discord", options: { redirectTo: back(), scopes: "identify" } }).then(function (r) {
      /* verbatim: "manual linking disabled" means the Supabase setting Allow manual linking is off */
      if (r && r.error) { store("s2_dc_switch", null); store("s2_return", null); throw fromDb(r.error); }
      return true;
    });
  };
  /* -> the identity linked since the stash (the one to switch to), or null. The stash is consumed on read, so a refresh can
     never repeat a switch; an older linked account is never chosen because a later link was abandoned on Discord's page */
  S2.takeDiscordSwitch = function (accounts, current) {
    var o = stored("s2_dc_switch"), since = o && o.at;
    if (!since || Date.now() - since > 600000) return null;
    return (accounts || []).filter(function (a) { return String(a.discord_id) !== String(current || "") && a.linked_at && Date.parse(a.linked_at) >= since - 60000; })
      .sort(function (a, b) { return Date.parse(b.linked_at) - Date.parse(a.linked_at); })[0] || null;
  };

  /* the Discord accounts on this login, the one the league follows and whether it is in the server (my_discord_accounts) */
  S2.discordAccounts = function () {
    var sb = S2.ensureSb();
    if (!sb || !S2.session.user) return Promise.reject(fail("Sign in with Discord first.", "S2_SIGNED_OUT"));
    return sb.rpc("my_discord_accounts").then(function (r) { if (r.error) throw fromDb(r.error); return r.data || {}; });
  };
  /* What the profile's Discord NAME and AVATAR should be, or null: a pure port of CG.discordIdentityPatch. WHICH account the
     league follows changes only through switch_discord_account (Settings); this never proposes discord_id. A discord_id
     that belongs to none of this login's identities was pinned by the league office and is left alone */
  S2.discordIdentityPatch = function (user, profile) {
    if (!user || !profile) return null;
    var ids = (user.identities || []).filter(function (i) { return i.provider === "discord"; });
    if (!ids.length) return null;
    var idOf = function (i) { var dd = i.identity_data || {}; return String(dd.provider_id || dd.sub || i.id || ""); };
    var chosen = profile.discord_id ? ids.filter(function (i) { return idOf(i) === String(profile.discord_id); })[0] : null;
    if (profile.discord_id && !chosen) return null;
    var cur = chosen || ids.slice().sort(function (a, b) { return Date.parse(b.last_sign_in_at || 0) - Date.parse(a.last_sign_in_at || 0); })[0];
    var d = cur.identity_data || {}, patch = {};
    var name = d.custom_claims && d.custom_claims.global_name || d.full_name || d.name || d.user_name || d.preferred_username || null;
    if (name && profile.discord_username !== name) patch.discord_username = name;
    /* the avatar follows the account too, but a custom (Supabase-hosted) picture is never replaced */
    var av = d.avatar_url || null, replaceable = !profile.avatar_url || /^https:\/\/(cdn|media)\.discordapp\./.test(String(profile.avatar_url));
    if (av && replaceable && profile.avatar_url !== av) patch.avatar_url = av;
    return Object.keys(patch).length ? patch : null;
  };

  /* who the member is to the league, read once per identity (and quietly on the hourly token refresh). Each lookup but the
     profile settles to null on its own failure, so one refused read never blanks the rest; the profile is retried once and
     a profile already held is kept, because losing it would show a signed-in member as a guest */
  var PROFILE_COLS = "id,gamertag,display_name,avatar_url,role,banned,ban_reason,discord_id,discord_username,in_guild";
  function one(q) { return Promise.resolve(q).then(function (r) { if (r && r.error) { console.warn("live.js: a sign-in lookup was refused:", r.error.message); return null; } return r ? r.data : null; }, function (e) { console.warn("live.js: a sign-in lookup failed:", e); return null; }); }
  function profileOf(sb, uid) {
    var q = function () { return one(sb.from("profiles").select(PROFILE_COLS).eq("id", uid).maybeSingle()); };
    return q().then(function (p) { return p || new Promise(function (r) { setTimeout(r, 400); }).then(q); });
  }
  function viewerOf(sb, uid) {
    return Promise.all([profileOf(sb, uid), one(sb.rpc("is_staff")), one(sb.rpc("is_commissioner")),
      one(sb.from("teams").select("id,code,owner_profile_id,gm_profile_id,agm_profile_id").or("owner_profile_id.eq." + uid + ",gm_profile_id.eq." + uid + ",agm_profile_id.eq." + uid)),
      one(sb.rpc("current_season_id")), one(sb.from("committees").select("key").eq("manager_profile_id", uid))
    ]).then(function (x) {
      var seats = x[3] || [], seat = null, club = seats[0] || null;
      /* Rule 2.6, one seat, one holder: two seats on one member is a data fault, said and shown as the first */
      if (seats.length > 1) console.error("live.js: this member holds " + seats.length + " club seats; showing " + club.code);
      if (club) seat = club.owner_profile_id === uid ? "owner" : club.gm_profile_id === uid ? "gm" : "agm";
      var v = { profile: x[0], isStaff: x[1] === true, isCommissioner: x[2] === true, seat: seat, team: club, committees: (x[5] || []).map(function (c) { return c.key; }) };
      if (club || !x[4]) return v;
      /* no seat: the club the member is rostered on this season, if any */
      return one(sb.from("roster_spots").select("team_id,teams(code)").eq("profile_id", uid).eq("season_id", x[4]).limit(1)).then(function (rs) {
        var s = rs && rs[0]; if (s) v.team = { id: s.team_id, code: s.teams && s.teams.code || null }; return v;
      });
    });
  }
  function apply(sess, quiet) {
    var sb = S2.ensureSb(), user = sess ? sess.user : null;
    A.user = user;
    if (!user) {
      A.profile = null; Object.assign(S2.session, DEFAULTS, { committees: [] });
      notifsFor(null);
      return Promise.resolve();
    }
    return viewerOf(sb, user.id).then(function (v) {
      if (v.profile) A.profile = v.profile;
      else if (A.profile && A.profile.id === user.id) S2.toast("Your account could not be reached just now. Showing what was last loaded.", "err");
      else A.profile = null;
      Object.assign(S2.session, { user: user, profileId: user.id, accessToken: sess.access_token || null, isStaff: v.isStaff, isCommissioner: v.isCommissioner,
        teamId: v.team ? v.team.id : null, teamCode: v.team ? v.team.code : null, seat: v.seat, committees: v.committees });
      var patch = S2.discordIdentityPatch(user, A.profile);
      if (!patch) return;
      /* fail loud, and remembered: a refused patch recomputes the same way forever and would otherwise force a loud run on
         every tab refocus, the shake this handler exists to stop */
      return sb.from("profiles").update(patch).eq("id", user.id).select("id").then(function (r) {
        if (r && !r.error && r.data && r.data.length) { Object.assign(A.profile, patch); idPatchRefused = null; return; }
        idPatchRefused = JSON.stringify(patch);
        console.warn("live.js: the Discord name and avatar refresh was refused", r && r.error ? r.error.message : "(0 rows)");
      }, function (e) { idPatchRefused = JSON.stringify(patch); console.warn("live.js: the Discord name and avatar refresh failed", e); });
    }).then(function () { notifsFor(user); });
  }
  /* what the header and the pages draw from the viewer: a run that changes none of it repaints nothing (a guest's first
     load, a refocus), and one that changes any of it repaints once, in place */
  function viewerKey() { var s = S2.session; return [S2.state.role, s.profileId, s.teamCode, s.seat, (s.committees || []).join(","), !!(A.profile && A.profile.banned)].join("|"); }
  var painted = null, routeOwed = false;
  function repaint() {
    /* a throwing page must never strand a queued session */
    try {
      /* the first session after a guessed role always routes once: an old link held for the role (S2.route) resolves now */
      var guessed = S2.roleGuessed;
      S2.applyRole(); banScreen();
      var k = viewerKey(); if (k === painted && !routeOwed && !guessed) return;
      painted = k; routeOwed = false;
      S2.shell(); S2.route(true);
    } catch (e) { console.error("live.js: the repaint after sign-in failed", e); }
  }
  /* Supabase fires auth events in BURSTS (INITIAL_SESSION on subscribe, SIGNED_IN plus TOKEN_REFRESHED around a login,
     SIGNED_IN again on every refocus). Two guards, from the 2026-08-27 "the page shakes on every login" fix:
     1) identity dedupe: an event for the member already applied changes nothing on screen, only the token; it counts as
        applied only once the profile actually LOADED, or a flaky first read would leave "Completing sign-in" up for good;
     2) latest-wins serializer: an identity change during a run queues ONE follow-up with the newest session.
     The hourly TOKEN_REFRESHED re-reads the member QUIETLY: fresh data, no repaint. */
  function run(sess, quiet) {
    if (applying) { queued = { sess: sess, quiet: (queued ? queued.quiet : true) && quiet }; return Promise.resolve(); }
    applying = true;
    return apply(sess, quiet).catch(function (e) { console.error("live.js: applying the session failed", e); }).then(function () {
      /* the league body was read as someone else (a visitor before sign-in, or before an expired sign-in was renewed): read
         it again once as this member before the repaint, so their own fields are on the first page drawn (js/load.js) */
      return S2.load && S2.load.matchViewer ? S2.load.matchViewer().catch(function (e) { console.error("live.js: reading the league again as this member failed", e); }) : null;
    }).then(function () {
      applying = false;
      if (!quiet) repaint();
      var nx = queued; queued = null;
      if (nx) return run(nx.sess, nx.quiet);
    });
  }
  S2.refreshViewer = function () { var sb = S2.ensureSb(); if (!sb) return Promise.resolve(); return sb.auth.getSession().then(function (s) { return run(s && s.data ? s.data.session : null, false); }); };
  function onAuth(ev, sess) {
    var uid = sess && sess.user ? sess.user.id : null;
    if ((sess || ev === "SIGNED_OUT") && S2._oauthPending) { S2._oauthPending = false; routeOwed = true; }
    if (sess) S2.session.accessToken = sess.access_token || S2.session.accessToken;
    if (uid === authUid) {
      if (uid) { A.user = sess.user; S2.session.user = sess.user; }
      var incomplete = uid && !A.profile;
      var patch = uid && !incomplete ? S2.discordIdentityPatch(sess.user, A.profile) : null;
      if (patch && JSON.stringify(patch) === idPatchRefused) patch = null;
      if (!incomplete && !patch) { if (ev === "TOKEN_REFRESHED" && uid && !applying) run(sess, true); return; }
    }
    authUid = uid; idPatchRefused = null;
    run(sess, false);
  }
  S2.initAuth = function () {
    var sb = S2.ensureSb(); if (!sb) return Promise.resolve(false);
    return sb.auth.getSession().then(function (s) {
      var boot = s && s.data ? s.data.session : null;
      if (s && s.error) console.error("live.js: the stored sign-in could not be read:", s.error.message);
      authUid = boot && boot.user ? boot.user.id : null;
      /* "Completing sign-in" is on screen: the landing session routes once even when the viewer did not change (a link) */
      if (boot && S2._oauthPending) { S2._oauthPending = false; routeOwed = true; }
      return run(boot, false).then(function () {
        /* a page that ran initAuth twice (a retry) must not hold two subscriptions: each would run every event again */
        if (A.sub) { try { A.sub.data.subscription.unsubscribe(); } catch (e) { console.warn(e); } }
        A.sub = sb.auth.onAuthStateChange(onAuth);
        return true;
      });
    });
  };
  /* "Discord sign-in did not complete", in Supabase's words; a new account that shares the old one's email gets the fix */
  S2.showAuthError = function (o) {
    var d = String(o && o.desc || ""), clash = /already (registered|linked|exists)|identity.*another user|email.*(exists|registered|in use)/i.test(d);
    S2.sheet({ title: "Discord sign-in did not complete", html: '<div class="cf"><p class="lk-why">' + S2.esc(d) + "</p>" +
      (clash ? '<p class="lk-why">Switched Discord accounts? Your league account is attached to the old one. Sign in with the old account once, open Settings and use Link a new Discord account: your history, roster spot and stats all stay with you.</p>' : "") +
      '<p class="fl-note">Discord keeps choosing the wrong account? This browser is signed into it at discord.com: use "Not you?" on Discord\'s page, or log out at discord.com first.</p></div>' });
  };
  /* a banned member keeps their session but not the league (the current site's CG.enforceBan) */
  function banScreen() {
    var on = !!(A.profile && A.profile.banned), el = document.getElementById("banScreen");
    if (!on) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement("div"); el.id = "banScreen"; el.setAttribute("role", "alertdialog"); el.setAttribute("aria-modal", "true"); document.body.appendChild(el); }
    el.style.cssText = "position:fixed;inset:0;z-index:9999;display:grid;place-items:center;padding:24px;background:var(--canvas);color:var(--ink)";
    el.innerHTML = '<div style="max-width:440px;text-align:center"><h2 class="t-title2">Your access has been revoked</h2><p class="t-sub">' +
      S2.esc(A.profile.ban_reason || "Contact the league office.") + '</p><button type="button" class="btn secondary" id="banOut">Sign out</button></div>';
    S2.$("#banOut", el).addEventListener("click", S2.signOut);
  }

  /* ================================================================ writes ================================================================ */
  var DOOR = /^[a-z_][a-z0-9_]*$/, TABLE = /^([a-z_][a-z0-9_]*)\.(insert|update|upsert|delete)$/;
  /* The real S2.write. rpc is an RPC name, or "<table>.<insert|update|upsert|delete>" for the live site's table doors
     (args: row, onConflict, set, match, select). Resolves only after a confirmed write: an RPC that answered without an
     error, or a table write whose rows came back. The opts are checked before anything is sent. Installed in live mode
     only, and never over one already there (j1's test mock is injected before any page code runs): in the demo S2.write keeps
     rejecting, as the contract promises */
  function writeImpl(rpc, args, opts) {
    var t = TABLE.exec(rpc), bad = !t && !DOOR.test(rpc) ? "S2.write: " + rpc + " is not a door" :
      opts.approval != null && opts.approval !== "owner" ? "S2.write: approval is \"owner\" or null" :
      opts.approval === "owner" && t && !opts.action ? "S2.write: a table write under Owner approval names its move in opts.action (trade_propose, roster_block, trade_decline, trade_cancel, schedule_pick)" :
      (opts.sections || []).filter(function (x) { return S2.SECTIONS.indexOf(x) < 0; }).map(function (x) { return "S2.write: no league section named " + x; })[0] || null;
    if (bad) return Promise.reject(fail(bad, "S2_BAD_CALL"));
    var sb = S2.ensureSb();
    if (!sb) return Promise.reject(fail("Not connected to the league. Reload the page and try again.", "S2_OFFLINE"));
    if (!S2.session.user) return Promise.reject(fail("Sign in with Discord first.", "S2_SIGNED_OUT"));
    var direct = function () { return t ? tableWrite(sb, t[1], t[2], args) : sb.rpc(rpc, args).then(function (r) { if (r.error) throw fromDb(r.error); return { data: r.data }; }); };
    var p = opts.approval === "owner" ? viaOwner(sb, rpc, args, opts, direct) : Promise.resolve().then(direct);
    return p.then(function (res) { return settle(res, opts); });
  }
  if (S2.LIVE && !S2._writeImpl) S2._writeImpl = writeImpl;
  function tableWrite(sb, table, op, a) {
    var q = sb.from(table), name = table + "." + op;
    if (op === "insert" || op === "upsert") {
      if (!a.row || typeof a.row !== "object") throw fail("S2.write " + name + " needs args.row", "S2_BAD_CALL");
      q = op === "insert" ? q.insert(a.row) : q.upsert(a.row, a.onConflict ? { onConflict: a.onConflict } : undefined);
    } else {
      /* never an unqualified update or delete (pg_safeupdate refuses them for the API roles anyway) */
      var m = a.match;
      if (!m || typeof m !== "object" || !Object.keys(m).length) throw fail("S2.write " + name + " needs args.match naming the rows", "S2_BAD_CALL");
      if (op === "update" && (!a.set || typeof a.set !== "object" || !Object.keys(a.set).length)) throw fail("S2.write " + name + " needs args.set", "S2_BAD_CALL");
      q = op === "update" ? q.update(a.set) : q.delete();
      Object.keys(m).forEach(function (k) { var v = m[k]; q = v === null ? q.is(k, null) : Array.isArray(v) ? q.in(k, v) : q.eq(k, v); });
    }
    var want = op !== "update" && op !== "delete" && Array.isArray(a.row) ? a.row.length : 1;
    return q.select(a.select || "id").then(function (r) {
      if (r.error) throw fromDb(r.error);
      /* the trap this door exists for: RLS filters an update or delete silently, 0 rows and no error */
      if (!r.data || r.data.length < want) throw fail("Nothing was saved. The league's rules did not let this change through, or the record has changed. Reload the page and try again.", "S2_NO_ROWS",
        "0 of " + want + " rows came back from " + name);
      return { data: r.data };
    });
  }
  /* Owner approval (Rule 2.6). The DATABASE decides who waits for the Owner: every front-office door calls mgmt_gate,
     which refuses a GM or AGM whose page the Owner approves with MGMT_APPROVAL_REQUIRED (42501), inside the same statement,
     so nothing was written. Only then is the move sent to the Owner (mgmt_request_move builds the Owner's summary itself
     and refuses a move that needs no approval). So the client keeps no copy of the club's policy that could go stale, and
     the league office and an Owner are never queued, because the gate never refuses them. */
  function viaOwner(sb, rpc, args, opts, direct) {
    return Promise.resolve().then(direct).catch(function (e) {
      if (!/^MGMT_APPROVAL_REQUIRED:/.test(e && e.message || "")) throw e;
      if (!S2.session.teamCode) throw e;
      return sb.rpc("mgmt_request_move", { p_team_code: S2.session.teamCode, p_action: opts.action || rpc, p_args: opts.queueArgs || args, p_summary: opts.summary || null }).then(function (r) {
        if (r.error) throw fromDb(r.error);
        if (!r.data) throw fail("The request to the Owner was not recorded. Try again.", "S2_NO_ROWS");
        return { data: r.data, queued: true };
      });
    });
  }
  /* the writer's own tab reads what it changed at once (the pulse reaches every other tab within seconds), then the page
     repaints its widget in place. A write that landed is never reported as failed because the re-read or repaint did not */
  function settle(res, opts) {
    var after = res.queued ? Promise.resolve(true) : S2.reread(opts.sections || [], { gameIds: opts.gameIds || null });
    return after.then(function (ok) {
      res.reread = ok;
      if (!ok) S2.toast("Saved. The page could not refresh itself; reload it to see the change.", "err");
      if (opts.repaint) { try { opts.repaint(res); } catch (e) { console.error("S2.write: the repaint after " + (res.queued ? "the request" : "the save") + " failed", e); S2.toast("Saved. Part of this page could not redraw; the details are in the console.", "err"); } }
      return res;
    });
  }
  /* -> true when the named sections were read again (or none were named, or none is held). The ONE re-read: the league
     read itself (js/load.js S2.load.read, which carries the member's token) for the season on screen, only the sections
     this page's body holds (news and wire are lazy), merged into the body the model was built from (S2.data.body), then
     S2.buildModel refills S2.M in place, so pages that hold S2.M see the change. Named games go to s2_league as p_game_ids,
     which narrows "games" and "box" to those games, so those two replace only the named games' rows and lines. Re-reads
     run one at a time, so two never build from the same stale body.
     The merged body takes the read's own moment (generated, which s2_league always returns) when it is later than the
     body's, so M.generated and M.now follow the newest read (QA round 2, 2026-11-25: the merge copied back only the
     named sections, so M.generated kept the first read's moment for the life of the page; everything keyed on it never
     read again: the model's title race (M.readTitles) and the Stats page's own, Control Center's confirmed rows, and the
     model's clock (Today's tonight, the sign-up strip). The clock never moves back, and a read with no moment is refused
     like a read missing a section) */
  var saidNoLoader = false, rereading = Promise.resolve(true);
  S2.reread = function (sections, o) {
    if (!sections || !sections.length || !S2.LIVE) return Promise.resolve(true);
    var D = S2.data;
    if (!(S2.load && S2.load.read && S2.buildModel && D && D.body)) {
      if (!saidNoLoader) { saidNoLoader = true; console.error("live.js: there is no league read to repeat (js/load.js S2.load.read, S2.data.body, S2.buildModel), so league data is not read again after a change"); }
      return Promise.resolve(false);
    }
    var ids = o && o.gameIds || null;
    rereading = rereading.then(function () {
      var held = S2.data.body.sections || [], want = sections.filter(function (k) { return held.indexOf(k) >= 0; });
      if (!want.length) return true;
      return S2.load.read(S2.data.body.season, want, ids).then(function (part) {
        var b = Object.assign({}, S2.data.body);
        if (!part.generated || isNaN(Date.parse(part.generated))) throw new Error("s2_league did not return generated, the moment it was read");
        if (!(Date.parse(b.generated) >= Date.parse(part.generated))) b.generated = part.generated;
        want.forEach(function (k) {
          if (part[k] == null) throw new Error("s2_league did not return " + k);
          if (!ids || (k !== "box" && k !== "games")) { b[k] = part[k]; return; }
          if (k === "games") { b.games = (b.games || []).filter(function (g) { return ids.indexOf(g.id) < 0; }).concat(part.games); return; }
          var by = Object.assign({}, (b.box || {}).byGame);
          ids.forEach(function (g) { delete by[g]; });   /* a game whose lines were all removed comes back with none */
          b.box = { cols: part.box.cols, byGame: Object.assign(by, part.box.byGame || {}) };
        });
        S2.buildModel(b, S2.data.archive);
        S2.data.body = b;
        return true;
      });
    }).catch(function (e) { console.error("live.js: reading " + sections.join(", ") + " again failed", e); return false; });
    return rereading;
  };

  /* ================================================================ the bell ================================================================ */
  var N = S2.notifs = { list: null };
  function mapNotif(n) {
    return { id: n.id, at: Date.parse(n.created_at || new Date().toISOString()), type: n.type, title: n.title || "League update", body: n.body || "", read: !!n.read,
      silent: !!n.silent, route: S2.notifRoute(n.link_view, n.link_param) };
  }
  /* the unread count is the database's (QA worst-case 2026-11-25: only the newest fifty were read, so a member with 267
     unread saw 33 and could not reach the rest). N.unreadTotal is an exact count of the member's unread rows (RLS keeps it
     to their own); until it is read, or if it fails, the count is the rows on hand, said as "33+" while older rows wait.
     N.unread() -> a number; N.unreadLabel() -> the words a count is shown in */
  N.unreadTotal = null; N.more = false;
  N.unread = function () { var on = (N.list || []).filter(function (n) { return !n.read; }).length; return N.unreadTotal == null ? on : Math.max(N.unreadTotal, on); };
  N.unreadLabel = function () { var n = N.unread(); return N.unreadTotal == null && N.more ? n + "+" : String(n); };
  var PAGE = 50, COLS = "id,type,title,body,link_view,link_param,read,created_at,silent";
  function countUnread(sb) {
    return sb.from("notifications").select("id", { count: "exact", head: true }).eq("read", false).then(function (r) {
      if (r.error || typeof r.count !== "number") { if (r.error) console.error("live.js: the unread count could not be read:", r.error.message); N.unreadTotal = null; }
      else N.unreadTotal = r.count;
      syncBell(); S2.live.emit("notifs", N.list);
    });
  }
  function syncBell() {
    var b = S2.$("#openBell"); if (!b || !S2.LIVE) return;
    var n = N.unread();
    b.classList.toggle("has-dot", n > 0);
    b.setAttribute("aria-label", n ? "Notifications, " + N.unreadLabel() + " unread" : "Notifications");
  }
  /* the next page of older alerts, appended in place (the Inbox's Show older). Resolves the rows added */
  N.older = function () {
    var sb = S2.ensureSb(), last = (N.list || []).slice(-1)[0];
    if (!sb || !last) return Promise.resolve(0);
    return sb.from("notifications").select(COLS).lt("created_at", new Date(last.at).toISOString()).order("created_at", { ascending: false }).limit(PAGE).then(function (r) {
      if (r.error) throw new Error("Older alerts could not be read: " + r.error.message);
      var rows = (r.data || []).map(mapNotif); N.list = N.list.concat(rows); N.more = rows.length === PAGE;
      S2.live.emit("notifs", N.list); return rows.length;
    });
  };
  document.addEventListener("s2:shell", syncBell);
  function notifsFor(user) {
    var sb = S2.ensureSb();
    if (!user) { N.list = null; N.cases = null; N.dms = null; N.unreadTotal = null; if (notifCh) { try { sb.removeChannel(notifCh); } catch (e) { console.warn(e); } notifCh = null; } syncBell(); S2.live.emit("notifs", null); return; }
    if (notifCh && notifCh.uid === user.id) return;
    if (notifCh) { try { sb.removeChannel(notifCh); } catch (e) { console.warn(e); } notifCh = null; }
    sb.from("notifications").select(COLS).order("created_at", { ascending: false }).limit(PAGE).then(function (r) {
      if (r.error) { console.error("live.js: notifications could not be read:", r.error.message); N.list = N.list || []; return; }
      N.list = (r.data || []).map(mapNotif); N.more = N.list.length === PAGE; syncBell(); S2.live.emit("notifs", N.list);
    });
    countUnread(sb); N.mine(true);
    /* new alerts light the bell without a reload; a seat that changed hands re-reads who the member is, so Team HQ
       appears or goes on its own */
    notifCh = sb.channel("notifs-" + user.id).on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: "profile_id=eq." + user.id }, function (p) {
      var n = mapNotif(p && p["new"] || {});
      if (!n.read && N.unreadTotal != null) N.unreadTotal++;
      (N.list = N.list || []).unshift(n); syncBell(); S2.live.emit("notifs", N.list);
      N.mine(true);   /* an alert may be a case answer or a message: the Inbox reads them again */
      if (n.type === "role" || n.type === "request") S2.refreshViewer();
    }).subscribe();
    notifCh.uid = user.id;
  }
  /* opening the bell marks every unread notification read. Zero rows back is not a refusal here: the filter is the
     member's own rows, which RLS lets them update, so an empty answer means another tab already marked them */
  N.seen = function () {
    var sb = S2.ensureSb(), uid = S2.session.profileId;
    if (!sb || !uid || !N.unread()) return Promise.resolve(0);
    return sb.from("notifications").update({ read: true }).eq("profile_id", uid).eq("read", false).select("id").then(function (r) {
      if (r.error) { S2.toast("Notifications could not be marked read: " + r.error.message, "err"); return 0; }
      N.list.forEach(function (n) { n.read = true; }); N.unreadTotal = 0; syncBell(); S2.live.emit("notifs", N.list);
      return (r.data || []).length;
    });
  };
  /* ---- the member's own cases and conversations (QA functional 2026-11-25: the Inbox held alerts only, so a member could
     not see a filed case, read an official's answer or reply to it, or read a direct message anywhere on the site, though
     the case and message receipts sent them to the Inbox). RLS keeps every read to the member's own rows: their cases
     (ar_read; filtered to profile_id here, because a GM also reads their club's), the case thread without a staff-only
     note (am_read), and the conversations they are in (dm_select). N.cases and N.dms are null until read; N.mineErr is
     the database's words when a read failed (the Inbox says so, never "nothing here").
     shortcut: the newest 100 cases and 400 direct messages; page further when a member nears either */
  N.cases = null; N.dms = null; N.mineErr = null; N.names = {};
  var mineAt = 0, mineBusy = null;
  var CASE_COLS = "id,type,route,status,subject,details,response,created_at,updated_at", THREAD_COLS = "id,request_id,author_id,body,created_at,deleted_at";
  N.mine = function (force) {
    var sb = S2.ensureSb(), uid = S2.session.profileId;
    if (!sb || !uid) { N.cases = null; N.dms = null; return Promise.resolve(); }
    if (mineBusy) return mineBusy;
    if (!force && Date.now() - mineAt < 30000) return Promise.resolve();
    var rd = function (q, what) { return q.then(function (r) { if (r.error) throw new Error(what + " could not be read: " + r.error.message); return r.data || []; }); };
    mineBusy = Promise.all([
      rd(sb.from("action_requests").select(CASE_COLS).eq("profile_id", uid).order("created_at", { ascending: false }).limit(100), "Your cases"),
      rd(sb.from("direct_messages").select("id,sender_id,recipient_id,body,created_at,read_at,deleted_at").or("sender_id.eq." + uid + ",recipient_id.eq." + uid).order("created_at", { ascending: false }).limit(400), "Your messages")
    ]).then(function (x) {
      var ids = x[0].map(function (c) { return c.id; });
      return (ids.length ? rd(sb.from("action_messages").select(THREAD_COLS).in("request_id", ids).eq("internal", false).order("created_at", { ascending: true }), "Your case threads") : Promise.resolve([])).then(function (msgs) {
        var by = {}; msgs.forEach(function (m) { if (!m.deleted_at) (by[m.request_id] = by[m.request_id] || []).push(m); });
        x[0].forEach(function (c) { c.thread = by[c.id] || []; });
        /* the names in the threads: the league read holds most; the rest (a commissioner who never played) are read once */
        var who = {}; msgs.forEach(function (m) { who[m.author_id] = 1; }); x[1].forEach(function (m) { who[m.sender_id] = 1; who[m.recipient_id] = 1; });
        var need = Object.keys(who).filter(function (id) { return id !== uid && !N.names[id] && !(S2.M && S2.M.player(id)); });
        return (need.length ? rd(sb.from("profiles").select("id,gamertag,display_name").in("id", need), "Names") : Promise.resolve([])).then(function (ps) {
          ps.forEach(function (p) { N.names[p.id] = p.gamertag || p.display_name || "A member"; });
          N.cases = x[0]; N.dms = x[1].filter(function (m) { return !m.deleted_at; }); N.mineErr = null; mineAt = Date.now();
        });
      });
    /* a failure waits the same 30 seconds (or Try again) before the next read, so a repaint never loops on it */
    }).catch(function (e) { console.error("live.js:", e.message); N.mineErr = e.message; mineAt = Date.now(); }).then(function () { mineBusy = null; S2.live.emit("notifs", N.list); });
    return mineBusy;
  };
  /* a member's name for the Inbox: the league read's tag, else the one read above */
  N.name = function (id) { var p = S2.M && S2.M.player(id); return p ? p.tag : N.names[id] || "A member"; };
  /* a notification opens the record it is about; the server invite opens in a new tab */
  N.open = function (n) {
    if (/^https?:\/\//.test(n.route)) { window.open(n.route, "_blank", "noopener"); return; }
    S2.go(n.route);
  };

  /* ================================================================ the pulse ================================================================ */
  /* The database marks every real change to the league's public tables and, at most every 10 seconds, makes ONE update to
     public.live_pulse naming the kinds that changed (sql/2026-10-14-live-pulse-v405.sql). Each kind maps to the league
     read's sections and spreads a crowd of tabs over its jitter, the current site's numbers. codes and market name no
     section: codes is re-read by the lobby page itself (signed in only, Rule 4.2), market by the bid room (v4.59) */
  S2.LIVE_DOMAINS = {
    scores: { sections: ["games", "ratings"], jitter: 8000 },
    stats: { sections: ["box", "career"], jitter: 8000 },
    codes: { sections: [], jitter: 2500, signedIn: true },
    rosters: { sections: ["rosters", "tenures"], jitter: 13000 },
    wire: { sections: ["wire"], jitter: 17000 },
    news: { sections: ["news", "honors"], jitter: 25000 },
    league: { sections: ["league", "teams", "seasons", "config"], jitter: 25000 },
    signups: { sections: ["signups"], jitter: 17000 },
    discipline: { sections: ["suspensions"], jitter: 25000 },
    picks: { sections: ["draft"], jitter: 17000 },
    people: { sections: ["people"], jitter: 25000 },
    market: { sections: [], jitter: 3000 }
  };
  /* pages that read no league data: what changes while they are open is owed to the next page that does */
  S2.LIVE_QUIET_ROUTES = { rulebook: 1, terms: 1, privacy: 1 };
  var P = S2.pulse = { seen: null, owed: {}, owedStats: null, owedStatsAll: false, timer: 0, joined: false, caughtAt: 0, ch: null };
  /* what this page already holds. js/load.js passes the pulse that came in the SAME s2_league body as the league data, so
     nothing between the two is missed; without it the first row seen is the baseline, as on the current site */
  P.baseline = function (row) {
    P.seen = {};
    var d = (row && row.d) || {};
    Object.keys(d).forEach(function (k) { P.seen[k] = +((d[k] || {}).v) || 0; });
    if (row && row.site_build) U.check(row.site_build);
  };
  P.apply = function (row) {
    if (!row) return;
    U.check(row.site_build);
    if (!P.seen) { P.baseline(row); return; }
    var d = row.d || {}, fresh = [];
    Object.keys(d).forEach(function (k) { if ((+((d[k] || {}).v) || 0) > (P.seen[k] || 0)) fresh.push(k); });
    if (!fresh.length) return;
    if (fresh.indexOf("stats") >= 0) {
      /* the box scores that changed, by game; a gap in the log (a long-hidden tab) re-reads the season's box scores */
      var sv = P.seen.stats || 0, log = (d.stats && d.stats.log) || [];
      var newer = log.filter(function (e) { return e && +e[0] > sv; });
      var gap = !newer.length || (log.length >= 24 && +log[log.length - 1][0] > sv) || newer.some(function (e) { return !Array.isArray(e[1]); });
      if (gap) P.owedStatsAll = true;
      else newer.forEach(function (e) { e[1].forEach(function (id) { (P.owedStats = P.owedStats || {})[id] = 1; }); });
    }
    fresh.forEach(function (k) { P.seen[k] = +d[k].v; P.owed[k] = true; });
    P.flush();
  };
  function draftLive() { var D = S2.M && S2.M.draft, st = D && D.state; return !!(st && (st.status === "live" || st.status === "paused")); }
  P.flush = function () {
    if (document.visibilityState === "hidden") return;            /* a hidden tab owes it */
    if (S2.LIVE_QUIET_ROUTES[S2.parse().name]) return;
    var owed = Object.keys(P.owed); if (!owed.length) return;
    var sections = {}, domains = [], jitter = 1000, live = draftLive() && (S2.M.draft.state.status === "live"), signedIn = !!S2.session.user;
    owed.forEach(function (k) {
      var m = S2.LIVE_DOMAINS[k]; if (!m) { console.warn("live.js: the pulse names a kind this page does not know: " + k); return; }
      if (m.signedIn && !signedIn) return;
      /* draft night: the draft room keeps its own pace; elsewhere the picks' roster changes spread over a minute */
      if (live && (k === "rosters" || k === "picks")) { if (S2.parse().name === "draft") return; jitter = Math.max(jitter, 60000); }
      m.sections.forEach(function (s) { sections[s] = 1; });
      domains.push(k); jitter = Math.max(jitter, m.jitter);
    });
    var statsAll = P.owedStatsAll, ids = P.owedStats ? Object.keys(P.owedStats) : null;
    P.owed = {}; P.owedStats = null; P.owedStatsAll = false;
    if (!domains.length) return;
    var list = Object.keys(sections), gameIds = sections.box && !statsAll && ids && ids.length ? ids : null;
    setTimeout(function () {
      S2.reread(list, { gameIds: gameIds }).then(function () {
        domains.forEach(function (k) { S2.live.emit(k, { sections: list, gameIds: gameIds }); });
        var def = S2.pages[S2.parse().name];
        if (!(def && def.repaintsItself)) S2.quietRepaint();
      });
    }, Math.floor(Math.random() * jitter));
  };
  /* catch up after a gap the channel cannot cover (joining, waking a hidden tab, coming back online) with one read of the
     one row, spread so a crowd that reconnects together does not read together */
  P.catchUp = function (delay) {
    clearTimeout(P.timer);
    P.timer = setTimeout(function () {
      var sb = S2.ensureSb(); if (!sb) return;
      P.caughtAt = Date.now();
      sb.from("live_pulse").select("v,d,site_build,at").eq("id", 1).maybeSingle().then(function (r) {
        if (r && r.error) { console.warn("live.js: the league pulse could not be read:", r.error.message); return; }
        if (r && r.data) P.apply(r.data);
      });
    }, Math.max(0, delay || 0));
  };
  /* one public channel for the session, guests included */
  P.subscribe = function () {
    var sb = S2.ensureSb(); if (!sb || P.ch) return;
    P.ch = sb.channel("league-live").on("postgres_changes", { event: "UPDATE", schema: "public", table: "live_pulse" }, function (p) { P.apply(p && p["new"]); })
      .subscribe(function (status) {
        if (status !== "SUBSCRIBED") return;
        P.catchUp(P.joined ? 2000 + Math.floor(Math.random() * 28000) : Math.floor(Math.random() * 1000));
        P.joined = true;
      });
  };

  /* ---- the one door for automatic repaints: a hidden tab, or a page someone is using, OWES the repaint and gets it the
     moment they are done (the standing rule: an update never resets the page under the reader) ---- */
  var owedRepaint = false, owedSince = 0, owedTimer = 0, repaintToast = null;
  /* anything typed or changed on the page that differs from how it was drawn (CG._pageDirty, with its select trap: a
     single select with no selected attribute shows its first enabled option, and that is clean) */
  S2.pageDirty = function () {
    var els = S2.$$("#page input, #page textarea, #page select");
    for (var i = 0; i < els.length; i++) {
      var e = els[i], t = (e.type || "").toLowerCase();
      if (t === "hidden" || t === "button" || t === "submit" || t === "reset" || t === "file") continue;
      if (t === "checkbox" || t === "radio") { if (e.checked !== e.defaultChecked) return true; continue; }
      if (e.tagName === "SELECT") {
        if (e.multiple) { for (var j = 0; j < e.options.length; j++) if (e.options[j].selected !== e.options[j].defaultSelected) return true; continue; }
        var def = -1, k;
        for (k = 0; k < e.options.length; k++) if (e.options[k].defaultSelected) { def = k; break; }
        if (def < 0) for (k = 0; k < e.options.length; k++) if (!e.options[k].disabled) { def = k; break; }
        if (e.options.length && e.selectedIndex !== (def < 0 ? 0 : def)) return true;
        continue;
      }
      if (e.value !== e.defaultValue) return true;
    }
    return false;
  };
  /* pages hold a reload or a repaint with work kept only in memory (a trade being built, a board waiting to save):
     S2.holds.push(fn), fn returns true while it holds */
  S2.holds = S2.holds || [];
  function held() { return S2.holds.some(function (f) { try { return !!f(); } catch (e) { console.error("live.js: a hold check failed", e); return true; } }); }
  S2.busy = function () {
    var a = document.activeElement, tn = a && a.tagName;
    if (tn === "INPUT" || tn === "TEXTAREA" || tn === "SELECT" || (a && a.isContentEditable)) return true;
    if (S2.layer.top()) return true;                                  /* a sheet or the palette is open */
    if (document.documentElement.classList.contains("menu-open")) return true;
    return S2.pageDirty() || held();
  };
  S2.quietRepaint = function () {
    if (document.visibilityState === "hidden") { owedRepaint = true; return; }
    if (S2.busy()) { owedRepaint = true; armRepaint(); return; }
    owedRepaint = false; owedSince = 0;
    if (repaintToast) { repaintToast.close(); repaintToast = null; }
    S2.route(true);
  };
  function armRepaint() {
    if (owedTimer) return;
    owedSince = owedSince || Date.now();
    owedTimer = setInterval(function () {
      if (!owedRepaint) { clearInterval(owedTimer); owedTimer = 0; owedSince = 0; return; }
      if (document.visibilityState === "hidden") return;
      if (S2.busy()) {
        /* a minute later, offer it: a field changed and saved in place can look unsaved for good */
        if (Date.now() - owedSince > 60000 && !repaintToast) repaintToast = S2.toast("New updates", "", { sticky: true, group: "repaint",
          action: { label: "Show them", run: function () { repaintToast = null; owedRepaint = false; owedSince = 0; S2.route(true); } } });
        return;
      }
      clearInterval(owedTimer); owedTimer = 0;
      S2.quietRepaint();
    }, 1500);
  }

  /* ================================================================ new versions ================================================================ */
  /* The site build stamps a content id into the page (meta cg-build) and /version.json; the database reads version.json
     every 10 minutes and copies the id into live_pulse.site_build, so no page ever polls Netlify. A page on an older build
     takes the new one at the next click, when it is looked at again after half an hour away, or after 15 idle minutes
     (plus up to 10 more, so idle tabs never reload in the same minute), and never while it is hidden, while something is
     open or half typed, while a page holds unsaved work, or during a live or paused draft */
  var U = S2.updates = { ready: null, seen: undefined, toast: null };
  U.build = function () { var m = document.querySelector('meta[name="cg-build"]'), b = m && m.getAttribute("content"); return /^[0-9a-f]{12}$/.test(b || "") ? b : null; };
  U.liveHost = function () { return /(^|\.)chelgamingleague\.com$/.test(location.hostname || ""); };
  function state() { try { return JSON.parse(sessionStorage.getItem("s2_update") || "null"); } catch (e) { return null; } }
  U.check = function (site) {
    var mine = U.build();
    if (!site || !/^[0-9a-f]{12}$/.test(site) || !mine) return;
    /* the id the league had when this page loaded is only a baseline: the database reads the live site every 10 minutes,
       so for a while after a deploy it still names the OLD build to a page already running the new one. Only a CHANGE
       seen after loading means a new version was published */
    if (U.seen === undefined) { U.seen = site; return; }
    if (site === U.seen) return;
    U.seen = site;
    if (site === mine) { U.ready = null; if (U.toast) { U.toast.close(); U.toast = null; } return; }
    if (!U.liveHost()) return;                                        /* a local or preview copy never reloads itself */
    var st = state();
    if (st && st.target === site && st.tries >= 2 && Date.now() - st.at < 600000) return;   /* the edge has not caught up */
    if (U.ready === site) return;
    U.ready = site;
    clearTimeout(U.offerT);
    U.offerT = setTimeout(function () {
      if (U.ready && !U.toast) U.toast = S2.toast("The site was updated", "", { sticky: true, group: "update", action: { label: "Refresh", run: function () { U.toast = null; U.apply("offer"); } } });
    }, 30000);
  };
  U.navBusy = function () { return !!S2._oauthPending || draftLive() || held() || !!S2.layer.top(); };
  U.apply = function (why) {
    if (!U.ready) return false;
    if (why !== "offer" && (U.navBusy() || (why !== "nav" && S2.busy()))) return false;
    var st = state(), target = U.ready, tries = st && st.target === target ? (st.tries || 0) + 1 : 1;
    try {
      sessionStorage.setItem("s2_update", JSON.stringify({ target: target, tries: tries, at: Date.now() }));
      sessionStorage.setItem("s2_scroll", JSON.stringify({ h: location.hash, y: window.pageYOffset, at: Date.now() }));
    } catch (e) { /* storage blocked: the loop breaker cannot count, so this try is the only one this minute */ }
    location.reload();
    return true;
  };
  var lastInput = Date.now(), hiddenAt = 0;
  function arm() {
    /* after a version reload: the try landed (or counts), and the reader is put back where they were */
    var st = state(), mine = U.build();
    if (st && st.target === mine) { try { sessionStorage.removeItem("s2_update"); } catch (e) { console.warn(e); } }
    try {
      var sc = JSON.parse(sessionStorage.getItem("s2_scroll") || "null"); sessionStorage.removeItem("s2_scroll");
      if (sc && sc.h === location.hash && Date.now() - sc.at < 60000) setTimeout(function () { window.scrollTo(0, sc.y || 0); }, 60);
    } catch (e) { console.warn(e); }
    ["pointerdown", "keydown", "wheel", "touchstart"].forEach(function (ev) { window.addEventListener(ev, function () { lastInput = Date.now(); }, { passive: true, capture: true }); });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") { hiddenAt = Date.now(); return; }
      var away = hiddenAt ? Date.now() - hiddenAt : 0; hiddenAt = 0;
      if (U.ready && away >= 30 * 60000 && U.apply("return")) return;
      P.flush();
      if (owedRepaint) S2.quietRepaint();
      if (Date.now() - P.caughtAt > 30000) P.catchUp(300 + Math.floor(Math.random() * 1700));
    });
    window.addEventListener("online", function () { P.catchUp(2000 + Math.floor(Math.random() * 18000)); });
    window.addEventListener("hashchange", function () {
      if (U.ready && U.apply("nav")) return;
      setTimeout(P.flush, 200 + Math.floor(Math.random() * 1300));   /* what a quiet page owed */
    });
    var idleAfter = 15 * 60000 + Math.floor(Math.random() * 10 * 60000);
    setInterval(function () { if (U.ready && document.visibilityState !== "hidden" && Date.now() - lastInput >= idleAfter) U.apply("idle"); }, 60000);
  }

  /* ================================================================ start ================================================================ */
  if (!S2.LIVE) return;
  /* back from Discord with a session: where to land once supabase-js has read and cleared the fragment (S2.route) */
  var frag = S2.authFragment(location.hash);
  if (frag) {
    var ret = takeReturn();
    if (frag.pending) {
      S2._authReturn = ret || "#/today";
      S2._oauthPending = true;
      /* an abandoned round trip falls back to the page after 15 seconds instead of "Completing sign-in" for good */
      setTimeout(function () {
        if (!S2._oauthPending || A.profile) return;
        S2._oauthPending = false;
        if (S2.authFragment(location.hash) || !/^#\/./.test(location.hash)) { history.replaceState(history.state, "", S2._authReturn || "#/you"); S2._authReturn = null; }
        S2.route();
      }, 15000);
    }
  }
  if (!S2.ensureSb()) {
    /* the sign-in library did not arrive: say so on the page, and come back by itself when the CDN fallback lands */
    console.error("live.js: supabase-js is not on the page, so sign-in, saving and live updates are off");
    document.addEventListener("s2:boot", function () { S2.toast("The league connection did not load. Reload the page to sign in and save.", "err"); });
    return;
  }
  /* the first paint guesses from the stored sign-in (supabase-js keeps it under sb-<project>-auth-token), so a member's
     header does not flash as a guest's before the session lands. Only once the client exists (i3f): a guess is settled by
     the session it brings, and with no client there is none to wait for */
  try { if (localStorage.getItem("sb-" + S2.SB_URL.split("//")[1].split(".")[0] + "-auth-token")) S2.applyRole("player"); } catch (e) { /* storage blocked: a guest's first paint */ }
  /* the client exists from here (it reads a sign-in fragment as early as it can); the session, the pulse and the watchers
     start once S2.boot has drawn the first page, because a stored session can resolve before the page scripts have even
     loaded, and a repaint then has no page to draw */
  document.addEventListener("s2:boot", function () {
    painted = viewerKey();   /* what S2.boot drew */
    /* the pulse that came in the same s2_league body as the league data is the exact baseline (nothing between the read
       and the channel join is missed) */
    if (S2.data && S2.data.body && S2.data.body.pulse) P.baseline(S2.data.body.pulse);
    arm();
    P.subscribe();
    S2.initAuth().catch(function (e) { console.error("live.js: sign-in could not start", e); S2.toast("Sign-in could not start. Reload the page.", "err"); repaint(); });
  }, { once: true });
})();
