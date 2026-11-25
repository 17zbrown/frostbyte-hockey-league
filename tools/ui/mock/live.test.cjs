const S2_BASE = process.env.S2_BASE || (() => { throw new Error("S2_BASE unset: run through tools/ui/run.cjs") })();
/* v5.00 swap (h0, 2026-11-25): the harness proves its real-site mode before the page suites move onto it (stream i3
   deletes demo mode, and pages then run only their real path).
     node tools/ui/run.cjs --suite mock/live                  live mode (the default): every context the run opens is the real site
     node tools/ui/run.cjs --suite mock/live --mode mock      each context below opts in with live: true
   A page boots as the site build ships it (supabase-js from vendor/, window.S2_MODE "live", no fixture) with S2.LIVE
   true, signed in as each persona both ways (the injected session, and js/live.js's own sign-in over the network),
   reads the recorded league, answers table reads from the suite's tables with PostgREST's semantics through the REAL
   supabase-js client, captures writes in the write mock, and never reaches past the fence. Every Supabase request is
   answered by tools/ui/mock/index.cjs; nothing reaches production, writes nothing and posts nothing. The row values
   below are placeholders; the recorded bodies stay in memory and no member's name is printed. */
const mock = require(process.env.S2_MOCK);
const { chromium } = require(mock.PW);
const MODE = process.env.S2_MODE;
let fails = 0;
const A = (name, cond, more) => { console.log((cond ? "PASS " : "FAIL ") + name + (cond || more === undefined ? "" : "  (" + JSON.stringify(more).slice(0, 600) + ")")); if (!cond) fails++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//, SUPA = /^https:\/\/[a-z0-9-]+\.supabase\.co\//, FONTS = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//;
const PICTURE = /^GET https:\/\/[a-z0-9-]+\.supabase\.co\/storage\/v1\/object\/public\//;
/* a session in a failure line, with its ids and token masked (personas.json is private) */
const masked = (s) => s && Object.assign({}, s, { user: s.user ? "<user>" : null, profileId: s.profileId ? "<id>" : null, accessToken: s.accessToken ? "<token>" : null, teamId: s.teamId ? "<id>" : null });

(async () => {
  const b = await chromium.launch(), errors = [];
  /* a context on the real site; quiet: the console errors this section causes on purpose */
  async function open(persona, opts, quiet) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } }), reqs = [];
    await ctx.addInitScript(() => { try { localStorage.setItem("s2.introSeen", "true"); localStorage.setItem("s2.survey", JSON.stringify({ done: "2026-11-24T00:00:00.000Z", from: "daily" })); } catch (e) {} });
    if (persona !== null) await mock.install(ctx, Object.assign({ live: true, persona }, opts));
    ctx.on("request", (r) => reqs.push(r.url()));
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errors.push(String(e)));
    p.on("console", (m) => { if (m.type() === "error" && !(quiet && quiet.test(m.text()))) errors.push(m.text()); });
    await p.goto(S2_BASE + "#/today");
    await p.waitForFunction(() => window.S2 && S2.$ && S2.data && S2.$("#page") && S2.$("#page").children.length > 0, null, { timeout: 15000 });
    /* js/live.js's start has settled: the session is applied (initAuth subscribes after it) and the pulse was caught up */
    await p.waitForFunction(() => S2.auth && S2.auth.sub, null, { timeout: 10000 });
    for (let i = 0; i < 40 && !reqs.some((u) => /\/rest\/v1\/live_pulse\?/.test(u)); i++) await wait(100);
    await wait(300);
    return { ctx, p, reqs };
  }
  const league = mock.league({}), people = (id) => league.people.some((x) => x.id === id);
  const outside = (reqs) => reqs.filter((u) => !LOCAL.test(u) && !SUPA.test(u) && !FONTS.test(u) && !/^(data|blob):/.test(u));

  console.log("## each persona boots the real site (mode " + MODE + ")");
  for (const name of mock.personas()) {
    const want = mock.liveSessionOf(name), { ctx, p, reqs } = await open(name);
    const s = await p.evaluate(() => ({
      LIVE: S2.LIVE, mode: window.S2_MODE, role: S2.state.role === S2.roleOf(S2.session), fixture: !!window.S2DATA, source: S2.data.source, season: S2.data.body.season,
      teams: S2.data.body.teams.length, archive: S2.data.archive && S2.data.archive.season, readAs: S2.load.readAs, M: !!(S2.M && S2.M.teams),
      vendor: (document.querySelector('script[src^="/vendor/supabase-js-"]') || {}).integrity || null, client: !!(window.supabase && window.supabase.createClient && S2.ensureSb()),
      session: S2.session, user: S2.auth.user && S2.auth.user.id, profile: S2.auth.profile && S2.auth.profile.id, blocked: S2_MOCK.blocked.slice()
    }));
    A(name + ": S2.LIVE, window.S2_MODE live, the session decides the role, and no fixture on the page", s.LIVE === true && s.mode === "live" && s.role === true && !s.fixture, { LIVE: s.LIVE, mode: s.mode, role: s.role, fixture: s.fixture });
    A(name + ": supabase-js is the build's pinned file from vendor/ with its integrity hash, and the client exists", /^sha384-/.test(s.vendor || "") && s.client
      && reqs.some((u) => /\/vendor\/supabase-js-[0-9.]+\.min\.js$/.test(u)) && !reqs.some((u) => /data\/snapshot\.js/.test(u)), s.vendor);
    A(name + ": the league is the recorded s2_league (Season " + league.season + ", " + league.teams.length + " teams), with the last complete season beside it",
      s.source === "live" && s.season === league.season && s.teams === league.teams.length && s.M && s.archive === 1, { source: s.source, season: s.season, teams: s.teams, M: s.M, archive: s.archive });
    A(name + ": S2.session is the persona's in live.js's shape (teamCode, committees)", JSON.stringify(s.session) === JSON.stringify(want) && s.blocked.length === 0, { got: masked(s.session), blocked: s.blocked });
    A(name + ": supabase-js signed in from the stored session as the persona, and the league was read as them", want.user
      ? s.user === want.profileId && s.profile === want.profileId && s.readAs === want.profileId && people(want.profileId) : s.user === null && s.profile === null && s.readAs === null,
      { user: s.user === want.profileId, profile: s.profile === want.profileId, readAs: s.readAs === want.profileId });
    const rt = mock.realtime(ctx);
    A(name + ": the pulse channel joined (and the bell's, signed in), quietly", rt.indexOf("realtime:league-live") >= 0 && (!want.user || rt.indexOf("realtime:notifs-" + want.profileId) >= 0), rt);
    A(name + ": the sign-in lookups, the bell and the pulse were all answered: nothing unexpected", mock.unexpected(ctx).length === 0, mock.unexpected(ctx));
    const pics = mock.offsite(ctx);
    A(name + ": no request left this Mac except to the fenced Supabase and fonts hosts", outside(reqs).length === 0 && pics.every((x) => PICTURE.test(x)), outside(reqs).concat(pics.filter((x) => !PICTURE.test(x))).slice(0, 5));
    A(name + ": the club crests from public storage got blank pictures, never production's", pics.length > 0, pics.length);
    await ctx.close();
  }

  console.log("## page: false: js/live.js builds S2.session itself from the network answers, and agrees with the persona");
  for (const name of mock.personas()) {
    const want = mock.liveSessionOf(name), { ctx, p } = await open(name, { page: false });
    const s = await p.evaluate(() => ({ s: S2.session, mock: !!window.S2_MOCK }));
    const same = ["profileId", "accessToken", "isStaff", "isCommissioner", "teamId", "teamCode", "seat"].every((k) => s.s[k] === want[k])
      && JSON.stringify(s.s.committees) === JSON.stringify(want.committees) && (s.s.user && s.s.user.id) === (want.user && want.user.id);
    A(name + ": the session live.js signed in to equals the injected one (seat " + (want.seat || "none") + ")", same && !s.mock, { got: masked(s.s), want: masked(want), mock: s.mock });
    A(name + ": and nothing was unexpected", mock.unexpected(ctx).length === 0, mock.unexpected(ctx));
    await ctx.close();
  }

  console.log("## a seat or a power no recorded persona holds (install's session option), both ways");
  for (const [name, over, hat] of [["staff", { committees: ["draft"] }, "draftbid"], ["gm", { seat: "owner" }, null], ["member", { teamId: league.teams[1].id }, null]]) {
    const want = mock.liveSessionOf(name, over), label = name + " with " + JSON.stringify(Object.assign({}, over, over.teamId ? { teamId: "<a club>" } : {}));
    for (const page of [true, false]) {
      const { ctx, p } = await open(name, { session: over, page });
      const s = await p.evaluate((hat) => ({ s: S2.session, hat: hat ? S2.has(hat) : null }), hat);
      const same = ["profileId", "isStaff", "isCommissioner", "teamId", "teamCode", "seat"].every((k) => s.s[k] === want[k]) && JSON.stringify(s.s.committees) === JSON.stringify(want.committees);
      A(label + (page ? ": the injected session" : ": the session live.js signed in to") + " carries it" + (hat ? ", and S2.has(\"" + hat + "\") is true" : ""),
        same && (!hat || s.hat === true) && mock.unexpected(ctx).length === 0, { got: masked(s.s), want: masked(want), hat: s.hat, unexpected: mock.unexpected(ctx) });
      await ctx.close();
    }
  }
  {
    let threw = []; for (const [n, o] of [["anon", { seat: "gm" }], ["member", { gamertag: "x" }], ["member", { seat: "gm" }]]) { try { mock.liveSessionOf(n, o); threw.push(null); } catch (e) { threw.push(e.message.slice(0, 40)); } }
    A("a seat for anon, an unknown key, or a seat with no club is refused", threw.every(Boolean), threw);
  }

  console.log("## table reads through the real supabase-js client");
  {
    const seen = [];
    const notices = [
      { id: "n1", team_id: "t1", kind: "trade", body: "Hello there", read: false, created_at: "2026-11-20T10:00:00Z", author: { gamertag: "Author A" } },
      { id: "n2", team_id: "t1", kind: "waiver", body: "Second", read: null, created_at: "2026-11-21T10:00:00Z", author: null },
      { id: "n3", team_id: "t1", kind: "trade", body: "third HELLO", read: true, created_at: "2026-11-22T10:00:00Z", author: null },
      { id: "n4", team_id: "t2", kind: "news", body: "Other club", read: false, created_at: null, author: null },
      { id: "n5", team_id: "t2", kind: "news", body: "50% off", read: false, created_at: "2026-11-19T10:00:00Z", author: null }
    ];
    const { ctx, p } = await open("gm", {
      tables: { club_notices: notices, trades: (q) => { seen.push(q); return [{ id: "tr1", season_id: "s2", status: "proposed" }, { id: "tr2", season_id: "s1", status: "proposed" }]; } },
      rpcs: { has_department: (args, info) => mock.ok(args.p_key === "draft" && info.persona === "gm") }
    }, /status of 40[046]|status of 501|mock: cannot answer|PGRST/);
    mock.respond(ctx, "table:suspension_requests", mock.fail("PGRST205", "Could not find the table 'public.suspension_requests' in the schema cache"));
    mock.respond(ctx, "rpc:staff_voter_count", mock.ok(11));
    const r = await p.evaluate(async () => {
      const sb = S2.ensureSb(), q = (t) => sb.from(t), ids = (res) => res.error ? "error " + res.error.code : (res.data || []).map((x) => x.id).join();
      const out = {};
      const newest = await q("club_notices").select("id,body").eq("team_id", "t1").order("created_at", { ascending: false }).limit(2);
      out.newest = ids(newest); out.newestKeys = Object.keys(newest.data[0]).join();
      out.inNeq = ids(await q("club_notices").select("*").in("id", ["n1", "n2", "n4"]).neq("kind", "waiver"));
      out.isNull = ids(await q("club_notices").select("id").is("read", null));
      out.isFalse = ids(await q("club_notices").select("id").is("read", false).order("id"));
      out.or = ids(await q("club_notices").select("id").or("kind.eq.waiver,team_id.eq.t2").order("id", { ascending: false }));
      out.ilike = ids(await q("club_notices").select("id").ilike("body", "%hello%").order("id"));
      out.likeEsc = ids(await q("club_notices").select("id").like("body", "50\\%%"));
      out.range = ids(await q("club_notices").select("id").gte("created_at", "2026-11-20T10:00:00Z").lt("created_at", "2026-11-22T00:00:00Z").order("id"));
      /* main session, 2026-11-25: an equal instant in another format (text order would drop n1), and misspelled columns */
      out.isoEq = ids(await q("club_notices").select("id").lte("created_at", "2026-11-20T10:00:00.000+00:00").order("id"));
      const badCol = await q("club_notices").select("id").eq("tema_id", "t1"), badSel = await q("club_notices").select("id,bodyy");
      out.badCol = badCol.error && badCol.error.code + " " + badCol.status; out.badSel = badSel.error && badSel.error.code + " " + badSel.status;
      out.notIn = ids(await q("club_notices").select("id").not("kind", "in", "(trade,news)"));
      out.nullsLast = ids(await q("club_notices").select("id").order("created_at", { ascending: true }));
      out.nullsFirst = ids(await q("club_notices").select("id").order("created_at", { ascending: false }).limit(2));
      out.offset = ids(await q("club_notices").select("id").order("id").range(1, 2));
      const alias = await q("club_notices").select("id,author:profiles!club_notices_author_fkey(gamertag)").eq("id", "n1").maybeSingle();
      out.alias = alias.data && Object.keys(alias.data).join() + " " + alias.data.author.gamertag;
      const embed = await q("club_notices").select("id,author(gamertag)").eq("id", "n1").maybeSingle();
      out.embed = embed.data && embed.data.author && embed.data.author.gamertag;
      out.maybeNone = (await q("club_notices").select("id").eq("id", "zz").maybeSingle()).data;
      const one = await q("club_notices").select("id,kind").eq("id", "n3").single();
      out.single = one.data && one.data.kind;
      const two = await q("club_notices").select("id").eq("team_id", "t2").single();
      out.singleTwo = two.error && two.error.code + " " + two.status;
      out.fn = ids(await q("trades").select("id,status").eq("season_id", "s2").eq("status", "proposed"));
      const gone = await q("suspension_requests").select("id");
      out.fail = gone.error && gone.error.code + " " + gone.status;
      const odd = await q("club_notices").select("id").contains("kind", ["trade"]);
      out.unsupported = odd.error && odd.error.message;
      /* i3f: game_vetoes is one of the live defaults now (the empty league office); direct_messages has none anywhere */
      const nobody = await q("direct_messages").select("id");
      out.unanswered = nobody.error && nobody.status;
      out.me = (await q("profiles").select("id,gamertag").eq("id", S2.session.profileId).maybeSingle()).data;
      out.me = out.me && out.me.id === S2.session.profileId && typeof out.me.gamertag === "string";
      out.rpc = (await sb.rpc("has_department", { p_key: "draft" })).data;
      out.rpcNo = (await sb.rpc("has_department", { p_key: "officiating" })).data;
      out.voters = (await sb.rpc("staff_voter_count")).data;
      return out;
    });
    A("eq, order desc and limit, and select keeps only the named columns", r.newest === "n3,n2" && r.newestKeys === "id,body", r);
    A("in and neq", r.inNeq === "n1,n4", r.inNeq);
    A("is null, and is false with order", r.isNull === "n2" && r.isFalse === "n1,n4,n5", [r.isNull, r.isFalse]);
    A("or=(...) and order desc", r.or === "n5,n4,n2", r.or);
    A("ilike is case-blind, like escapes its own wildcard", r.ilike === "n1,n3" && r.likeEsc === "n5", [r.ilike, r.likeEsc]);
    A("gte and lt on timestamps", r.range === "n1,n2", r.range);
    A("timestamps compare as instants: an equal instant written another way still matches", r.isoEq === "n1,n5", r.isoEq);
    A("a filter or select on a column the rows lack answers 400 42703, as PostgREST does", r.badCol === "42703 400" && r.badSel === "42703 400", [r.badCol, r.badSel]);
    A("not.in", r.notIn === "n2", r.notIn);
    A("order puts nulls last ascending and first descending", r.nullsLast === "n5,n1,n2,n3,n4" && r.nullsFirst === "n4,n3", [r.nullsLast, r.nullsFirst]);
    A("range (offset and limit)", r.offset === "n2,n3", r.offset);
    A("an aliased embed is kept under its alias, a plain embed under its name, each as the suite gave it", r.alias === "id,author Author A" && r.embed === "Author A", [r.alias, r.embed]);
    A("maybeSingle: null for none; single: one object, or 406 PGRST116 for two", r.maybeNone === null && r.single === "trade" && r.singleTwo === "PGRST116 406", [r.maybeNone, r.single, r.singleTwo]);
    A("a function table sees the query and the persona; the mock applies the filters to its rows", r.fn === "tr1" && seen.length === 1 && seen[0].persona === "gm" && seen[0].table === "trades"
      && seen[0].select === "id,status" && JSON.stringify(seen[0].filters) === JSON.stringify([["season_id", "eq.s2"], ["status", "eq.proposed"]]) && seen[0].single === false, seen);
    A("respond table: with mock.fail answers PostgREST's error and status", r.fail === "PGRST205 404", r.fail);
    A("a filter the mock cannot read answers 501 with why, never a wrong set of rows", /cannot answer GET \/rest\/v1\/club_notices: the filter kind=cs\./.test(r.unsupported || ""), r.unsupported);
    A("a table nobody answers is 501", r.unanswered === 501, r.unanswered);
    A("the default profiles table holds the persona's own row", r.me === true);
    A("read RPCs answer from rpcs and respond rpc: (a function sees args and persona)", r.rpc === true && r.rpcNo === false && r.voters === 11, [r.rpc, r.rpcNo, r.voters]);
    A("both refusals are listed as unexpected, nothing else", mock.unexpected(ctx).join("|") === "GET /rest/v1/club_notices|GET /rest/v1/direct_messages", mock.unexpected(ctx));
    await ctx.close();
  }

  console.log("## a shaped league body (rpcs.s2_league over mock.league)");
  {
    const { ctx, p } = await open("member", { rpcs: { s2_league: (a) => { const body = mock.league(a); if (body.teams) body.teams[0].name = "Shaped Club"; return mock.ok(body); } } });
    const n = await p.evaluate(() => [S2.data.body.teams[0].name, JSON.stringify(S2.M.teams).indexOf("Shaped Club") >= 0]);
    A("the page reads and builds from the suite's body, not the recording", n[0] === "Shaped Club" && n[1], n);
    A("mock.league hands out a copy, so a suite never edits the recording", mock.league({}).teams[0].name === league.teams[0].name && league.teams[0].name !== "Shaped Club");
    const s1 = mock.league({ p_season: 1 }), ids = s1.games.filter((g) => s1.box.byGame[g.id]).slice(0, 2).map((g) => g.id);
    const d = await p.evaluate(async (ids) => { const b = await S2.load.read(1, ["games", "box"], ids); return { games: b.games.map((g) => g.id), box: Object.keys(b.box.byGame), cols: b.box.cols.length }; }, ids);
    A("a delta read (p_game_ids, js/load.js) narrows games and box to the named games", ids.length === 2 && d.games.join() === ids.join() && d.box.sort().join() === ids.slice().sort().join() && d.cols > 0, d);
    await ctx.close();
  }

  console.log("## writes: the write mock wins over f's client and never reaches the network");
  {
    const { ctx, p, reqs } = await open("gm", { writes: { market_bid: mock.ok({ lot: "L1", price: 1000000 }), draft_make_pick: Object.assign(mock.ok("move-1"), { queued: true }) } });
    const r = await p.evaluate(async () => {
      const out = {}; let repaints = 0;
      out.bid = await S2.write("market_bid", { p_lot: "L1", p_amount: 1000000 }, { repaint: () => { repaints++; } });
      out.repaints = repaints;
      out.queued = await S2.write("draft_make_pick", { p_pick: "pk-1" }, { approval: "owner", repaint: (res) => { out.repaintSaw = res; } });
      try { await S2.write("waive_player", { p_profile: "x" }); out.unlisted = "resolved"; } catch (e) { out.unlisted = e.code; }
      out.blocked = S2_MOCK.blocked.slice();
      return out;
    });
    A("a listed write resolves from the writes table and repaints", r.bid.data.lot === "L1" && r.repaints === 1, r);
    A("a move sent to the Owner resolves {data, queued: true}, and the repaint gets the result as live.js gives it", JSON.stringify(r.queued) === JSON.stringify({ data: "move-1", queued: true })
      && JSON.stringify(r.repaintSaw) === JSON.stringify(r.queued), r);
    A("an unlisted write rejects MOCK1", r.unlisted === "MOCK1", r.unlisted);
    A("Node holds every call with the persona and the approval route", mock.calls(ctx).map((c) => c.rpc + ":" + c.persona + ":" + c.approval).join() === "market_bid:gm:null,draft_make_pick:gm:owner,waive_player:gm:null", mock.calls(ctx));
    A("live.js left the write mock in place, and no write went out on the network", r.blocked.length === 0 && !reqs.some((u) => /\/rest\/v1\/rpc\/(market_bid|waive_player)/.test(u)), r.blocked);
    await ctx.close();
  }

  console.log("## realtime: mock.push reaches the real client's channels, the pulse included");
  {
    const { ctx, p, reqs } = await open("gm");
    await p.evaluate(() => new Promise((res) => {
      window.__got = [];
      S2.ensureSb().channel("h0-test").on("postgres_changes", { event: "INSERT", schema: "public", table: "club_notices", filter: "team_id=eq.t1" }, (x) => { window.__got.push(x); })
        .subscribe((st) => { if (st === "SUBSCRIBED") res(); });
    }));
    const hit = mock.push(ctx, "club_notices", "INSERT", { id: "n9", team_id: "t1", body: "Pushed" }), miss = mock.push(ctx, "club_notices", "INSERT", { id: "n10", team_id: "t2" });
    const upd = mock.push(ctx, "club_notices", "UPDATE", { id: "n9", team_id: "t1" }, { id: "n9" });
    await p.waitForFunction(() => window.__got.length > 0, null, { timeout: 5000 }).catch(() => null);
    await wait(300);
    const got = await p.evaluate(() => window.__got.map((x) => [x.eventType, x.table, x.new.id, x.new.body]));
    A("a push reaches the channel whose binding and filter take it, and only that change arrives", hit === 1 && miss === 0 && upd === 0 && JSON.stringify(got) === JSON.stringify([["INSERT", "club_notices", "n9", "Pushed"]]), { hit, miss, upd, got });
    /* the pulse (js/live.js): a newer scores mark re-reads games and ratings, then tells the pages */
    await p.evaluate(() => { Math.random = () => 0; window.__scores = 0; S2.live.on("scores", () => { window.__scores++; }); });
    const pulse = JSON.parse(JSON.stringify(league.pulse)); pulse.d.scores.v = +pulse.d.scores.v + 1;
    const reached = mock.push(ctx, "live_pulse", "UPDATE", Object.assign({ id: 1 }, pulse), { id: 1 });
    const told = await p.waitForFunction(() => window.__scores > 0, null, { timeout: 5000 }).then(() => true, () => false);
    A("a pushed pulse makes js/live.js re-read the scores sections and tell the pages", reached === 1 && told && reqs.filter((u) => /\/rest\/v1\/rpc\/s2_league/.test(u)).length >= 3, { reached, told });
    A("and nothing was unexpected", mock.unexpected(ctx).length === 0, mock.unexpected(ctx));
    await ctx.close();
  }

  console.log("## the fence");
  {
    const { ctx, p } = await open("anon", null, /status of 501|fenced/);
    const r = await p.evaluate(async () => {
      const out = {};
      try { const res = await fetch("https://example.com/api?x=1"); out.fetch = res.status; } catch (e) { out.fetch = "threw " + e.message; }
      out.img = await new Promise((res) => { const i = new Image(); i.onload = () => res(i.naturalWidth); i.onerror = () => res("error"); i.src = "https://cdn.discordapp.com/avatars/x/y.png"; });
      return out;
    });
    A("a request to another host answers 501 here and is listed", r.fetch === 501 && mock.unexpected(ctx).join() === "GET https://example.com/api", [r.fetch, mock.unexpected(ctx)]);
    const other = mock.offsite(ctx).filter((x) => !PICTURE.test(x));
    A("an image from another host gets a blank picture, listed in mock.offsite, not unexpected", r.img === 1 && other.join() === "GET https://cdn.discordapp.com/avatars/x/y.png", [r.img, other]);
    let threw = null; try { await mock.install(ctx, { live: false }); } catch (e) { threw = e.message; }
    A("a live context refuses to leave live mode", /this context is live/.test(threw || ""), threw);
    await ctx.close();
  }

  console.log("## the run's mode");
  {
    const ctx = await b.newContext(), installed = (() => { try { mock.calls(ctx); return true; } catch (e) { return false; } })();
    if (MODE === "live") {
      const p = await ctx.newPage(); await p.goto(S2_BASE + "#/today");
      await p.waitForFunction(() => window.S2 && S2.$ && S2.data && S2.$("#page") && S2.$("#page").children.length > 0, null, { timeout: 15000 });
      const s = await p.evaluate(() => ({ LIVE: S2.LIVE, mock: !!window.S2_MOCK, persona: window.S2_MOCK && S2_MOCK.persona }));
      A("--mode live: a context the suite never installed is the real site with the run's persona", installed && s.LIVE === true && s.mock && s.persona === (process.env.S2_PERSONA || "anon"), s);
    } else A("--mode " + MODE + ": a plain context is mocked, not live (each context above opted in)", installed);
    await ctx.close();
  }

  A("no page error or console error across the whole run", errors.length === 0, errors.slice(0, 6));
  await b.close();
  console.log(fails ? "\nFAIL (" + fails + ")" : "\nPASS");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
