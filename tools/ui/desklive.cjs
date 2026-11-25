/* The live Staff Desk under test: the shared league office the staffing, discipline and application suites open the
   desk on. Never a suite of its own (run.cjs runs *.test.cjs only).
   v5.00 swap (g1, 2026-11-24); i3d (2026-11-25) moved it onto the harness's real-site mode (h0, tools/ui/mock/index.cjs):
   the page is the site as the build ships it, js/live.js's own supabase-js client signs in as the persona, and every
   PostgREST read the desk makes (js/pages/desk.js's live layer) is answered by the harness from the small league office
   below (tables and read RPCs), with the RLS the policies apply. The private read client this file used to put in the
   page (S2.ensureSb over window.__db) is gone, and so are S2.LIVE and S2.reread stubs: the page is live on its own.
   The gates (is_commissioner, is_staff, has_department, is_app_reviewer, can_vote_committee_app, staff_voter_count) and,
   only after the Season 2 staffing flip, is_any_committee_manager and the suspension_requests table; before the flip both
   answer as PostgREST does when they do not exist (PGRST202, PGRST205), which is how the desk tells the two apart.
   Writes go to the harness's write mock (S2.write): each door in DOORS changes the office below and answers in its own
   shape, after L.delay(ms) (default 120 ms, so "nothing shows as done before the database answers" can be seen), or
   refuses with L.refuse(door, code, message). An unknown door rejects MOCK1.
   The season on screen is the recorded current season, given one club's roster (Season 1's, copied) so a rostered member
   exists for the games-or-date split; Season 2's real rosters start at the draft.
   Every name in the office is a placeholder (BRIEF privacy): no gamertag, EA id or Discord id of a real member. */
const mock = require(process.env.S2_MOCK);
const MODE = "live";
const DOORS = ["assign_case", "action_requests.update", "action_messages.insert", "decide_position_change", "decide_forfeit_appeal", "discipline_from_case",
  "suspend_player", "extend_suspension", "lift_suspension", "ban_player", "unban_player", "request_suspension", "decide_suspension_request", "withdraw_suspension_request",
  "application_ballots.upsert", "application_ballots.delete", "application_messages.insert", "override_application_decision",
  "feature_flags.upsert", "apply_committee_seat", "withdraw_committee_application", "reverse_trade", "resend_trade"];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* the desk's personas on the harness's: a committee manager is the staff persona with a seat (the session option) */
const AS = { staff: ["staff", undefined], manager: ["staff", { committees: ["officiating"] }], commissioner: ["commissioner", undefined], member: ["member", undefined] };
/* the gates the database answers for each persona */
const GATES = {
  staff: { is_commissioner: false, is_staff: true, officiating: true, community: false, is_app_reviewer: true, cm: false },
  manager: { is_commissioner: false, is_staff: true, officiating: true, community: false, is_app_reviewer: true, cm: true },
  commissioner: { is_commissioner: true, is_staff: false, officiating: true, community: true, is_app_reviewer: true, cm: false },
  member: { is_commissioner: false, is_staff: false, officiating: false, community: false, is_app_reviewer: false, cm: false }
};
/* the columns each read selects (js/pages/desk.js CASE_COLS, MSG_COLS, APP_SRC, REQ_COLS, REC_COLS): every row carries
   all of them, as PostgREST rows do, so the harness's column check reads a real query */
const COLS = {
  action_requests: "id,type,route,status,subject,details,target,target_profile_id,profile_id,assigned_to,assigned_at,response,created_at,updated_at,current_position,requested_position,dept,suspension_id,game_id,team_id,filer,about,claimer",
  action_messages: "id,request_id,author_id,body,internal,created_at,deleted_at,author",
  owner_applications: "id,season_id,profile_id,ea_id,timezone,availability,preferred_club,franchise_2,franchise_3,experience,pitch,status,response,created_at,filed_at,decided_at,applicant",
  staff_applications: "id,profile_id,timezone,availability,experience,pitch,departments,status,response,created_at,filed_at,decided_at,applicant",
  management_applications: "id,team_id,role,submitted_by,nominee_id,pitch,status,response,created_at,decided_at,nominee,owner",
  committee_applications: "id,committee_key,profile_id,pitch,status,response,created_at,decided_at,applicant",
  application_ballots: "app_type,application_id,voter_id,vote,note,updated_at,voter",
  application_messages: "id,app_type,application_id,sender_id,body,created_at,deleted_at,sender",
  suspension_requests: "id,profile_id,mode,games,ends_at,until_season,days,extends_id,reason,filed_by,case_id,status,created_at,member,filer",
  suspension_record: "id,profile_id,mode,games_total,games_served,ends_at,until_season,status,running,lifted_at,created_at,season_id,scope,venue,reason,created_by,grounds",
  profiles: "id,gamertag,display_name,avatar_url,role,banned,ban_reason,discord_id,discord_username,in_guild",
  committees: "key,name,sort,manager_profile_id,manager",
  trades: "id,season_id,from_team_id,to_team_id,from_profile_id,offered_profile_ids,requested_profile_ids,offered_pick_ids,requested_pick_ids,note,status,created_at,updated_at"
};
const full = (t, r) => { const o = {}; COLS[t].split(",").forEach((k) => { o[k] = k in r ? r[k] : null; }); return Object.assign(o, r); };

/* s2_league as recorded, the current season given one club's Season 1 roster (see the header) */
function league(a) {
  const b = mock.league(a);
  if (b.rosters && !b.rosters.spots.length) {
    const s1 = mock.league({ p_season: 1, p_sections: ["rosters"] }).rosters.spots, team = s1[0].team;
    b.rosters.spots = s1.filter((x) => x.team === team);
  }
  return b;
}

/* the league office, in Node: o = { persona, me, myTag, flip } */
function office(o) {
  const me = o.me, now = Date.now(), iso = (h) => new Date(now - h * 3600e3).toISOString();
  const P = (tag, role) => ({ gamertag: tag, role: role || "member" });
  return {
    flip: !!o.flip, gates: GATES[o.persona], voters: 11, cmVote: {}, subject: null,
    s2_desk: { staff: [{ id: me, gamertag: o.myTag, role: o.persona === "commissioner" ? "commissioner" : "staff" }, { id: "u-off2", gamertag: "Official Two", role: "staff" }, { id: "u-off3", gamertag: "Official Three", role: "staff" }],
      /* the real shape (s2_desk, v4.57): n is every row in the group and running a COUNT; the games group holds one active
         suspension that is not running, so a reader of n would say three */
      suspensions: [{ n: 3, mode: "games", scope: "play", status: "active", running: 2 }, { n: 1, mode: "seasons", scope: "play", status: "active", running: 1 },
        { n: 2, mode: "warning", scope: "play", status: "active", running: 0 }, { n: 4, mode: "games", scope: "play", status: "lifted", running: 0 }],
      activity: [{ at: iso(2), actor: "Official Two", action: "case_assign", target_type: "action_request" }],
      /* gaps (2026-11-25): the counts the Reports band reads, in s2_desk's shapes (v4.57: grouped rows; ea_import_issues) */
      generated: iso(0),
      cases: [{ type: "complaint", status: "open", route: "commissioner", n: 2, assigned: 1, oldest: iso(30), updated: iso(5) }, { type: "trade_request", status: "open", route: "manager", n: 1, assigned: 0, oldest: iso(300), updated: iso(3) },
        { type: "complaint", status: "resolved", route: "commissioner", n: 1, assigned: 1, oldest: iso(400), updated: iso(300) }],
      applications: [{ kind: "owner", season: 2, role: null, status: "pending", n: 1 }, { kind: "staff", season: null, role: null, status: "pending", n: 1 }, { kind: "management", season: null, role: "agm", status: "pending", n: 1 },
        { kind: "owner", season: 1, role: null, status: "approved", n: 1 }],
      ea_import: { unmatched: [{ match_id: "m-1", reason: "no league game", clubs: [], day: null, at: iso(20) }], missing_stats: [] },
      audit: [{ action: "case_assign", n_7d: 3, n_30d: 9, last: iso(2) }] },
    action_requests: [
      { id: "c-complaint-1", type: "complaint", route: "commissioner", status: "open", subject: "Conduct in a game-night lobby", details: "Placeholder details of the filing.", target: "Member B", target_profile_id: "u-memb", profile_id: "u-mema",
        assigned_to: null, response: null, created_at: iso(30), updated_at: iso(30), dept: "officiating", filer: P("Member A"), about: P("Member B"), claimer: null },
      { id: "c-pos-1", type: "position_change", route: "commissioner", status: "open", subject: null, details: "I would like to play defense.", profile_id: "u-memc", current_position: "C", requested_position: "LD",
        assigned_to: null, response: null, created_at: iso(20), updated_at: iso(20), filer: P("Member C"), about: null, claimer: null },
      { id: "c-ffa-1", type: "forfeit_appeal", route: "commissioner", status: "open", subject: "Forfeit appeal", details: "Our lineup was filed in time.", profile_id: "u-memd", team_id: "t1",
        assigned_to: null, response: null, created_at: iso(10), updated_at: iso(10), filer: P("Member D"), about: null, claimer: null },
      { id: "c-appeal-staff", type: "appeal", route: "commissioner", status: "open", subject: "Appeal of my suspension", details: "I was on staff duty.", profile_id: "u-off3", suspension_id: "s-x", dept: "officiating",
        assigned_to: null, response: null, created_at: iso(8), updated_at: iso(8), filer: P("Official Three", "staff"), about: null, claimer: null },
      { id: "c-mine-1", type: "complaint", route: "commissioner", status: "open", subject: "A complaint I filed", details: "Placeholder.", profile_id: me, target_profile_id: "u-meme",
        assigned_to: null, response: null, created_at: iso(5), updated_at: iso(5), dept: "officiating", filer: P(o.myTag, "staff"), about: P("Member E"), claimer: null },
      { id: "c-trade-1", type: "trade_request", route: "manager", status: "open", subject: "Trade me", details: "x", profile_id: "u-memf", created_at: iso(3), updated_at: iso(3), filer: P("Member F") },
      { id: "c-closed-1", type: "complaint", route: "commissioner", status: "resolved", subject: "An older complaint", details: "Placeholder.", profile_id: "u-memg", response: "Placeholder statement.",
        assigned_to: "u-off2", created_at: iso(400), updated_at: iso(300), filer: P("Member G"), about: null, claimer: P("Official Two") }
    ],
    action_messages: [{ id: "m1", request_id: "c-complaint-1", author_id: "u-mema", body: "Placeholder message from the filer.", internal: false, created_at: iso(29), author: P("Member A") },
      { id: "m2", request_id: "c-complaint-1", author_id: "u-off2", body: "Placeholder staff note.", internal: true, created_at: iso(28), author: P("Official Two", "staff") }],
    owner_applications: [{ id: "oa-1", season_id: "s2", profile_id: "u-appa", ea_id: "SampleEA1", availability: "Weeknights", preferred_club: "Detroit Red Wings", franchise_2: "Boston Bruins", franchise_3: null,
      experience: "Two seasons.", pitch: "Placeholder pitch.", status: "pending", created_at: iso(70), filed_at: iso(70), applicant: P("Applicant One") },
      { id: "oa-old", season_id: "s1", profile_id: "u-appz", status: "approved", created_at: iso(2000), decided_at: iso(1900), applicant: P("Applicant Old") }],
    staff_applications: [{ id: "sa-1", profile_id: "u-appb", availability: "Most nights", experience: "", pitch: "Placeholder staff pitch.", departments: ["statistics"], status: "pending", created_at: iso(50), filed_at: iso(50), applicant: P("Applicant Two") }],
    management_applications: [{ id: "ma-1", team_id: null, role: "agm", submitted_by: "u-own", nominee_id: "u-appc", pitch: "Placeholder nomination.", status: "pending", created_at: iso(40), nominee: P("Applicant Three"), owner: P("Owner One") }],
    committee_applications: [{ id: "ca-1", committee_key: "community", profile_id: "u-off2", pitch: "Placeholder seat pitch.", status: "pending", created_at: iso(30), applicant: P("Official Two", "staff") }],
    /* the staff application was filed again at iso(50): the two ballots on it from before that are kept but do not count
       (v4.22 "Fresh vote"), this reader's own among them */
    application_ballots: [{ app_type: "owner", application_id: "oa-1", voter_id: "u-off2", vote: "approve", note: "Placeholder reason.", updated_at: iso(60), voter: P("Official Two", "staff") },
      { app_type: "staff", application_id: "sa-1", voter_id: me, vote: "approve", note: "Placeholder: before the refiling.", updated_at: iso(55), voter: P(o.myTag, "staff") },
      { app_type: "staff", application_id: "sa-1", voter_id: "u-off3", vote: "deny", note: "Placeholder: an old ballot.", updated_at: iso(52), voter: P("Official Three", "staff") }],
    application_messages: [{ id: "am1", app_type: "owner", application_id: "oa-1", sender_id: "u-off2", body: "Placeholder question.", created_at: iso(65), sender: P("Official Two", "staff") }],
    /* the subject's record is filled once the page has chosen the subject (open below) */
    suspension_record: [],
    /* the signed-in member's own row (js/live.js reads it at sign-in) and, once chosen, the subject's */
    profiles: [{ id: me, gamertag: o.myTag, display_name: o.myTag, avatar_url: null, role: o.persona === "commissioner" ? "commissioner" : o.persona === "member" ? "member" : "staff",
      banned: false, ban_reason: null, discord_id: null, discord_username: null, in_guild: true }],
    committees: ["officiating", "statistics", "applications", "community", "transactions", "draft"].map((k, i) => ({ key: k, name: k, sort: i, manager_profile_id: k === "officiating" ? "u-off2" : null, manager: k === "officiating" ? P("Official Two", "staff") : null })),
    trades: [],   /* filled once the page has the league's clubs (open below) */
    suspension_requests: [{ id: "rq-1", profile_id: "u-memh", mode: "games", games: 6, filed_by: "u-off2", status: "pending", created_at: iso(4), reason: "Placeholder request.", member: P("Member H"), filer: P("Official Two", "staff") }],
    iso: iso, P: P
  };
}
/* the subject's record: a running six-game suspension and a warning this reader gave, and an extension request on file */
function withSubject(db, sid, me, myTag) {
  db.subject = sid;
  db.suspension_record = [{ id: "sr-run", profile_id: sid, mode: "games", games_total: 6, games_served: 2, status: "active", running: true, created_at: db.iso(100), season_id: "s2", scope: "play", venue: "ice", reason: "Placeholder grounds.", created_by: "u-off2" },
    { id: "sr-warn", profile_id: sid, mode: "warning", status: "active", running: false, created_at: db.iso(300), scope: "play", reason: "Placeholder warning.", created_by: me }];
  db.profiles.push({ id: sid, gamertag: "Member S", display_name: "Member S", avatar_url: null, role: "member", banned: false, ban_reason: null, discord_id: null, discord_username: null, in_guild: true });
  db.suspension_requests.push({ id: "rq-2", profile_id: sid, mode: "games", games: 3, extends_id: "sr-run", filed_by: me, status: "pending", created_at: db.iso(3), reason: "Placeholder extension.", member: db.P("Member S"), filer: db.P(myTag, "staff") });
}

/* the reads, with the RLS the policies apply: a member sees only what they filed, and no application, ballot or record */
function tables(db, me, reads) {
  const notTable = (t) => Object.assign(mock.fail("PGRST205", "Could not find the table 'public." + t + "' in the schema cache"), { status: 404 });
  const read = (t, rows) => (q) => {
    /* QA core 2026-11-25: the Inbox reads the member's OWN cases and their threads on every page (js/live.js N.mine,
       filtered to profile_id), which is not a case list; it is recorded apart so a check for the desk's case list still
       catches any read of it */
    const own = (q && q.filters || []).some((f) => (f[0] === "profile_id" && f[1] === "eq." + me));
    reads.push("from:" + t + (own ? ":own" : ""));
    if (t === "suspension_requests" && !db.flip) return notTable(t);
    const office0 = db.gates.is_staff || db.gates.is_commissioner;
    let r = rows();
    if (!office0 && t === "action_requests") r = r.filter((x) => x.profile_id === me);
    if (!office0 && /applications|ballots|suspension_record|suspension_requests|action_messages/.test(t)) r = [];
    if (t === "trades" && !(db.gates.is_commissioner || db.gates.transactions)) r = [];   /* "trades visible to involved", "transactions staff read trades" */
    return r.map((x) => full(t, x));
  };
  const out = {};
  Object.keys(COLS).forEach((t) => { out[t] = read(t, () => db[t]); });
  return out;
}
function rpcs(db, reads) {
  const notFn = (n) => Object.assign(mock.fail("PGRST202", "Could not find the function public." + n + " in the schema cache"), { status: 404 });
  const r = (name, fn) => (a) => { reads.push("rpc:" + name); return fn(a || {}); };
  const G = () => db.gates;
  return {
    is_commissioner: r("is_commissioner", () => mock.ok(G().is_commissioner)),
    is_staff: r("is_staff", () => mock.ok(G().is_staff)),
    has_department: r("has_department", (a) => mock.ok(!!G()[a.p_key] || G().is_commissioner)),
    is_app_reviewer: r("is_app_reviewer", () => mock.ok(G().is_app_reviewer)),
    is_any_committee_manager: r("is_any_committee_manager", () => (db.flip ? mock.ok(G().cm) : notFn("is_any_committee_manager(p_profile)"))),
    can_vote_committee_app: r("can_vote_committee_app", (a) => mock.ok(!!db.cmVote[a.p_app])),
    staff_voter_count: r("staff_voter_count", () => mock.ok(db.voters)),
    s2_desk: r("s2_desk", () => (G().is_staff || G().is_commissioner ? mock.ok(JSON.parse(JSON.stringify(db.s2_desk))) : mock.fail("42501", "staff only"))),
    s2_league: (a) => mock.ok(league(a)),
    /* js/survey.js asks at sign-in; the survey stays shut over the desk */
    season_survey_done: () => mock.ok(true)
  };
}

/* the doors' effects on the office (the shape each answers with) */
function apply(db, me, myTag, rpc, a) {
  const fail = (code, message) => { throw Object.assign(new Error(message), { code: code }); };
  const caseOf = (id) => db.action_requests.filter((x) => x.id === id)[0];
  const staffOf = (id) => db.s2_desk.staff.filter((x) => x.id === id)[0];
  const at = () => new Date().toISOString();
  switch (rpc) {
    case "assign_case": { const c = caseOf(a.p_request); c.assigned_to = a.p_assignee; c.claimer = a.p_assignee ? { gamertag: (staffOf(a.p_assignee) || {}).gamertag || "Someone" } : null; return null; }   /* assign_case writes who has it, never the status */
    case "action_requests.update": { const c = caseOf(a.match.id); if (!c) fail("S2_NO_ROWS", "Nothing was saved."); Object.assign(c, a.set); return [{ id: c.id }]; }
    case "action_messages.insert": db.action_messages.push(Object.assign({ id: "m" + Date.now(), created_at: at(), deleted_at: null, author: { gamertag: myTag, role: "staff" } }, a.row)); return [{ id: "m-new" }];
    case "decide_position_change": { const c = caseOf(a.p_request); c.status = a.p_approve ? "resolved" : "denied"; c.response = a.p_note; return "ok"; }
    case "decide_forfeit_appeal": { const c = caseOf(a.p_request); c.status = a.p_overturn ? "resolved" : "denied"; c.response = a.p_response; return null; }
    case "discipline_from_case": { const c = caseOf(a.p_request); c.status = "resolved"; c.response = a.p_statement; db.suspension_record.unshift({ id: "sr-" + Date.now(), profile_id: a.p_profile, mode: a.p_mode, games_total: a.p_games, status: "active", running: a.p_mode !== "warning", created_at: at(), reason: a.p_reason, created_by: me }); return "sr-new"; }
    case "suspend_player": db.suspension_record.unshift({ id: "sr-" + Date.now(), profile_id: a.p_profile, mode: a.p_mode, games_total: a.p_games, ends_at: a.p_ends_at, until_season: a.p_until_season, status: "active", running: a.p_mode !== "warning", created_at: at(), reason: a.p_reason, created_by: me }); return "sr-new";
    case "extend_suspension": { const r = db.suspension_record.filter((x) => x.id === a.p_id)[0]; if (a.p_games) r.games_total += a.p_games; return null; }
    case "lift_suspension": { const r = db.suspension_record.filter((x) => x.id === a.p_id)[0]; r.status = "lifted"; r.running = false; return null; }
    case "ban_player": db.profiles.forEach((x) => { if (x.id === a.p_profile) { x.banned = true; x.ban_reason = a.p_reason; } }); return null;
    case "unban_player": db.profiles.forEach((x) => { if (x.id === a.p_profile) { x.banned = false; x.ban_reason = null; } }); return null;
    case "request_suspension": { const run = db.suspension_record.filter((x) => x.profile_id === a.p_profile && x.running && x.mode !== "warning")[0];
      db.suspension_requests.push({ id: "rq-" + Date.now(), profile_id: a.p_profile, mode: a.p_mode, games: a.p_games, ends_at: a.p_ends_at, extends_id: run ? run.id : null, filed_by: me, status: "pending", created_at: at(), reason: a.p_reason, member: { gamertag: "Member S" }, filer: { gamertag: myTag } });
      return { ok: true, id: "rq-new", status: "pending", extends: run ? run.id : null }; }
    case "decide_suspension_request": case "withdraw_suspension_request": { const r = db.suspension_requests.filter((x) => x.id === a.p_id)[0]; r.status = rpc === "withdraw_suspension_request" ? "withdrawn" : a.p_approve ? "approved" : "denied"; return { ok: true }; }
    case "application_ballots.upsert": { const r = a.row; db.application_ballots = db.application_ballots.filter((b) => !(b.app_type === r.app_type && b.application_id === r.application_id && b.voter_id === r.voter_id));
      db.application_ballots.push(Object.assign({ updated_at: at(), voter: { gamertag: myTag } }, r)); return [{ id: "b-new" }]; }
    case "application_ballots.delete": { const m = a.match, before = db.application_ballots.length; db.application_ballots = db.application_ballots.filter((b) => !(b.app_type === m.app_type && b.application_id === m.application_id && b.voter_id === m.voter_id));
      if (db.application_ballots.length === before) fail("S2_NO_ROWS", "Nothing was saved."); return [{ id: "b-gone" }]; }
    case "application_messages.insert": db.application_messages.push(Object.assign({ id: "am" + Date.now(), created_at: at(), deleted_at: null, sender: { gamertag: myTag, role: "staff" } }, a.row)); return [{ id: "am-new" }];
    case "feature_flags.upsert": return [{ key: a.row.key }];
    /* gaps (2026-11-25): the committee seat application's two doors (v4.59), in their own shapes and words */
    case "apply_committee_seat": { const c = db.committees.filter((x) => x.key === a.p_committee)[0];
      if (!c) fail("P0001", "COMMITTEE: That committee was not found.");
      if (c.manager_profile_id) fail("P0001", "COMMITTEE: The " + c.name + " committee already has a manager. A seat is applied for only while it is open.");
      db.committee_applications.unshift({ id: "ca-new", committee_key: c.key, profile_id: me, pitch: a.p_pitch, status: "pending", created_at: at(), applicant: { gamertag: myTag, role: "staff" } });
      return { ok: true, id: "ca-new", committee: c.key, status: "pending" }; }
    case "withdraw_committee_application": { const r = db.committee_applications.filter((x) => x.id === a.p_app)[0];
      if (!r || r.profile_id !== me) fail("42501", "WITHDRAW: Only the applicant may withdraw their committee application.");
      r.status = "withdrawn"; return { ok: true, id: r.id, status: "withdrawn" }; }
    /* the league office's trade doors (reverse_trade, resend_trade), on the office's trades */
    case "reverse_trade": { const t = (db.trades || []).filter((x) => x.id === a.p_trade)[0];
      if (!t || t.status !== "accepted") fail("P0001", "Only a completed trade can be reversed (this one is " + (t ? t.status : "missing") + ").");
      t.status = "reversed"; t.updated_at = at(); return null; }
    case "resend_trade": { const t = (db.trades || []).filter((x) => x.id === a.p_trade)[0];
      if (!t || ["declined", "cancelled"].indexOf(t.status) < 0) fail("P0001", "Only a declined or withdrawn offer can be resent (this one is " + (t ? t.status : "missing") + ").");
      const n = Object.assign({}, t, { id: "tr-resent", status: "proposed", created_at: at(), updated_at: at(), note: "Resent by the league office" }); db.trades.unshift(n); return n.id; }
    case "override_application_decision": { const t = { owner: "owner_applications", staff: "staff_applications", management: "management_applications", committee: "committee_applications" }[a.p_type];
      const r = db[t].filter((x) => x.id === a.p_id)[0]; r.status = a.p_approve ? "approved" : "denied"; r.decided_at = at(); return null; }
  }
  return fail("MOCK1", "desklive: no door named " + rpc);
}

/* open the live desk as a persona: { persona, flip, subject: "rostered"|"free", cmVote, hash, w, dark, locked } -> L:
   { p, ctx, db, me, subject, errors, calls(), reads(), delay(ms), refuse(door, code, message), unrefuse(door), close() } */
async function open(browser, base, o) {
  o = o || {};
  const persona = o.persona || "staff", as = AS[persona];
  const ctx = await browser.newContext(Object.assign(o.w ? { viewport: { width: o.w, height: 812 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 900 } }, o.dark ? { colorScheme: "dark" } : {}));
  const me = mock.sessionOf(as[0]).profileId, myTag = persona === "commissioner" ? "Commissioner One" : "Official One";
  const db = office({ persona: persona, me: me, myTag: myTag, flip: o.flip }), reads = [], refused = {};
  (o.cmVote || []).forEach((id) => { db.cmVote[id] = true; });
  const H = { delay: 120 };
  const writes = {};
  DOORS.forEach((d) => { writes[d] = async (args) => {
    await wait(H.delay);
    if (refused[d]) return mock.fail(refused[d][0], refused[d][1]);
    try { return mock.ok(apply(db, me, myTag, d, JSON.parse(JSON.stringify(args)))); } catch (e) { return mock.fail(e.code || "P0001", e.message); }
  }; });
  await mock.install(ctx, { live: true, persona: as[0], session: as[1], writes: writes, tables: tables(db, me, reads), rpcs: rpcs(db, reads) });
  await ctx.addInitScript(() => { try { localStorage.setItem("s2.introSeen", "true"); localStorage.setItem("s2.survey", JSON.stringify({ done: "2026-11-01" })); } catch (e) { /* storage blocked */ } });
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  /* the browser logs every non-2xx answer as "Failed to load resource" (the not-yet 404s before the flip, a refusal a check
     asks for); what the page itself says is what counts */
  p.on("console", (m) => { if (m.type() === "error" && !/^Failed to load resource/.test(m.text()) && !(o.allow && o.allow.test(m.text()))) errors.push(m.text()); });
  /* a page that never comes up says what it showed and what it logged, never a bare timeout */
  const up = (fn, arg, what) => p.waitForFunction(fn, arg, { timeout: 15000 }).catch(async (e) => {
    const shown = await p.evaluate(() => (document.body ? document.body.innerText : "").replace(/\s+/g, " ").slice(0, 300)).catch(() => "(no page)");
    throw new Error("desklive: " + what + " (" + persona + "): " + e.message.split("\n")[0] + " | page: " + shown + " | errors: " + errors.slice(0, 3).join(" / ") + " | unexpected: " + mock.unexpected(ctx).slice(0, 5).join(", "));
  });
  await p.goto(base + "#/today");
  await up(() => window.S2 && S2.LIVE && S2.M && S2._desk && document.querySelector("#app header, #app section"), null, "the site did not come up");
  /* the member whose record the discipline sections open: chosen from the page's own members, as the desk lists them */
  let subject = null;
  if (o.subject) {
    subject = await p.evaluate((k) => (S2.M.players.filter((x) => x.id && (k === "rostered" ? x.rostered : !x.rostered) && x.id !== S2.session.profileId)[0] || {}).id, o.subject);
    if (!subject) throw new Error("desklive: no " + o.subject + " member in the league on screen");
    withSubject(db, subject, me, myTag);
  }
  /* gaps (2026-11-25): three of the season's offers between the first two clubs of the league read (placeholder players) */
  const tr = await p.evaluate(() => ({ sid: S2.M.control.season(S2.M.view.season).settings.id, a: S2.M.teams[0].id, b: S2.M.teams[1].id }));
  const trow = (n, status, h) => ({ id: "00000000-0000-4000-8000-0000000000a" + n, season_id: tr.sid, from_team_id: tr.a, to_team_id: tr.b, from_profile_id: "u-own", offered_profile_ids: ["u-tp" + n],
    requested_profile_ids: ["u-tq" + n], offered_pick_ids: [], requested_pick_ids: [], note: null, status: status, created_at: db.iso(h), updated_at: db.iso(h - 1) });
  db.trades = [trow(1, "proposed", 2), trow(2, "accepted", 30), trow(3, "declined", 60)];
  db.management_applications[0].team_id = tr.a;   /* the nomination names a real club of the league read (teams.id, i3a) */
  await p.evaluate((h) => { location.hash = h; }, o.hash || "#/desk");
  /* o.locked: a reader the site keeps off the desk (core.js sends them to the staff-only page before the desk draws) */
  if (o.locked) await up(() => !document.getElementById("dk") && /for the league's staff/.test((document.getElementById("page") || {}).textContent || ""), null, "the staff-only page never showed");
  else await up(() => S2._desk.LV.state === "ready" || S2._desk.LV.state === "error", null, "the desk never read the league office");
  await wait(250);
  return {
    p: p, ctx: ctx, db: db, me: me, subject: subject, errors: errors,
    calls: async () => mock.calls(ctx).map((c) => ({ rpc: c.rpc, args: c.args })),
    reads: () => reads.slice(),
    delay: (ms) => { H.delay = ms; },
    refuse: (door, code, message) => { refused[door] = [code, message]; },
    unrefuse: (door) => { delete refused[door]; },
    unexpected: () => mock.unexpected(ctx),
    close: () => ctx.close()
  };
}
module.exports = { open: open, league: league, MODE: MODE, DOORS: DOORS, wait: wait };
