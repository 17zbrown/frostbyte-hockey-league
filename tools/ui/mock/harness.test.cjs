const S2_BASE = process.env.S2_BASE || (() => { throw new Error("S2_BASE unset: run through tools/ui/run.cjs") })();
/* v5.00 swap (j1): the harness proves its own mock before any page suite leans on it.
   node tools/ui/run.cjs --suite mock/harness [--mode live-fixture|mock]
   Personas, the recorded reads, the network fence, the realtime socket and the S2.write mock (tools/ui/mock/index.cjs),
   on the real page. i3f (2026-11-25): it runs in every mode, the default live (the real site) included, since fixture
   mode is retired: in live mode each context is the real site, so the session is the persona's in js/live.js's shape
   (mock.liveSessionOf) and the default tables (notifications, profiles, ...) answer. Every Supabase request below is answered by the mock; nothing reaches production, writes
   nothing and posts nothing. The hosts and values are fake except the recorded bodies, which stay in memory. */
const mock = require(process.env.S2_MOCK);
const { chromium } = require(mock.PW);
let fails = 0;
const A = (name, cond, more) => { console.log((cond ? "PASS " : "FAIL ") + name + (cond || more === undefined ? "" : "  (" + JSON.stringify(more) + ")")); if (!cond) fails++; };
const HOST = "https://mockproject.supabase.co", MODE = process.env.S2_MODE, LIVE = MODE === "live";
/* the session the page holds in this mode: the contract's, or js/live.js's shape on the real site (teamCode, committees) */
const sessionIn = (name) => (LIVE ? mock.liveSessionOf(name) : mock.sessionOf(name));
const SIGNED_OUT = Object.assign({ user: null, profileId: null, accessToken: null, isStaff: false, isCommissioner: false, teamId: null, seat: null }, LIVE ? { teamCode: null, committees: [] } : {});

(async () => {
  const b = await chromium.launch(), errors = [];
  async function open(persona, opts) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(() => { try { localStorage.setItem("s2.introSeen", "true"); localStorage.setItem("s2.survey", JSON.stringify({ done: "2026-11-24T00:00:00.000Z", from: "daily" })); } catch (e) {} });
    await mock.install(ctx, Object.assign({ persona }, opts));
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errors.push(String(e))); /* the refusals and 501s below are meant: the browser logs each as "Failed to load resource" */
    p.on("console", (m) => { if (m.type() === "error" && !/^Failed to load resource/.test(m.text())) errors.push(m.text()); });
    await p.goto(S2_BASE + "#/today");
    await p.waitForFunction(() => window.S2 && S2.$ && S2.$("#navbar") && S2.$("#page") && S2.$("#page").children.length > 0);
    return { ctx, p };
  }
  const call = (p, rpc, body, method) => p.evaluate(async (a) => {
    const r = await fetch(a.url, a.method === "GET" ? {} : { method: "POST", headers: { "content-type": "application/json", apikey: "x" }, body: JSON.stringify(a.body || {}) });
    let json = null; try { json = await r.json(); } catch (e) {}
    return { status: r.status, json };
  }, { url: HOST + rpc, body, method });

  console.log("## personas: the session each one injects");
  for (const name of mock.personas()) {
    const { ctx, p } = await open(name);
    const s = await p.evaluate(() => ({ s: S2.session, blocked: S2_MOCK.blocked.slice(), same: S2.session !== S2.session }));
    const want = sessionIn(name);
    A(name + ": S2.session is the persona's, after core.js ran", JSON.stringify(s.s) === JSON.stringify(want) && s.blocked.length === 0, s.blocked);
    A(name + ": each read is a fresh copy, so no page can edit the persona", s.same);
    if (want.accessToken) {
      const claims = JSON.parse(Buffer.from(want.accessToken.split(".")[1], "base64url").toString("utf8"));
      A(name + ": the token names the profile, role authenticated, and is never a signed JWT", claims.sub === want.profileId && claims.role === "authenticated" && want.accessToken.endsWith(".mock"));
    } else A(name + ": signed out is exactly the contract's default", JSON.stringify(want) === JSON.stringify(SIGNED_OUT));
    const desk = await call(p, "/rest/v1/rpc/s2_desk"), control = await call(p, "/rest/v1/rpc/s2_control"), ops = await call(p, "/rest/v1/rpc/ops_job_health");
    const gate = { anon: [401, 401, 401], member: [403, 403, 403], gm: [403, 403, 403], staff: [200, 403, 403], commissioner: [200, 200, 200] }[name];
    A(name + ": the office reads answer as production did for this persona", desk.status === gate[0] && control.status === gate[1] && ops.status === gate[2], [desk.status, control.status, ops.status]);
    if (desk.status !== 200) A(name + ": a refused read carries the real 42501 body", desk.json && desk.json.code === "42501" && /staff only|permission denied/.test(desk.json.message), desk.json);
    else A(name + ": the staff desk body is the recorded one", desk.json && desk.json.media_only === false && Array.isArray(desk.json.staff));
    const user = await call(p, "/auth/v1/user", null, "GET");
    A(name + ": /auth/v1/user answers as the persona", want.user ? user.status === 200 && user.json.id === want.profileId : user.status === 401, user.status);
    await ctx.close();
  }

  console.log("## the league read and the fence");
  {
    const { ctx, p } = await open("member");
    const cur = await call(p, "/rest/v1/rpc/s2_league", {}), s1 = await call(p, "/rest/v1/rpc/s2_league", { p_season: 1 });
    A("s2_league with no season is the current season (2) and carries teams and people", cur.status === 200 && cur.json.season === 2 && cur.json.teams.length > 0 && cur.json.people.length > 0, cur.status);
    A("s2_league(1) is Season 1, with its box scores", s1.status === 200 && s1.json.season === 1 && Object.keys(s1.json.box || {}).length > 0);
    const cut = await call(p, "/rest/v1/rpc/s2_league", { p_sections: ["teams", "config"] });
    A("p_sections cuts the body to the named sections plus its header", cut.status === 200 && cut.json.teams && cut.json.config && !cut.json.people && cut.json.sections.join() === "teams,config" && cut.json.pulse);
    const lazy = await call(p, "/rest/v1/rpc/s2_league", { p_sections: ["news"] });
    A("a section the recording lacks answers 501 with a mock message, never an empty section", lazy.status === 501 && /^mock:/.test(lazy.json.message), lazy.json);
    const get = await call(p, "/rest/v1/rpc/s2_league?p_season=1", null, "GET");
    A("a GET rpc reads its arguments from the query", get.status === 200 && get.json.season === 1);
    /* QA round 2: the title race board has a default on the real site, so a page that opens Leaders makes no unexpected read */
    if (LIVE) {
      const before = mock.unexpected(ctx).length, tb = await call(p, "/rest/v1/rpc/statistical_title_board", { p_season: cur.json.seasons.filter((s) => s.number === 2)[0].id, p_top: 5 });
      A("statistical_title_board answers an empty board (the RPC's rows, none yet) by default, and nothing is unexpected", tb.status === 200 && Array.isArray(tb.json) && tb.json.length === 0 && mock.unexpected(ctx).length === before, tb);
      /* and the teams table carries production's link columns (the Control Center's club links, the game desk), unlinked */
      const tl = await call(p, "/rest/v1/teams?select=id,code,ea_club_id,ea_club_name,discord_role_id,discord_channel_id", null, "GET");
      A("the default teams read carries production's EA and Discord link columns, every club unlinked, never 42703", tl.status === 200 && tl.json.length === cur.json.teams.length &&
        tl.json.every((t) => t.code && t.ea_club_id === null && t.ea_club_name === null && t.discord_role_id === null && t.discord_channel_id === null), tl.status === 200 ? tl.json.length : tl.json);
    }
    /* a table nobody answers: notifications has a default on the real site (the bell). QA round 2: this read named
       direct_messages, which has had a default since the Inbox port (QA core round 1: js/live.js N.mine reads it on every
       page), so the check failed on the base; guild_departures (the Control Center's own read) has none anywhere */
    const before = mock.unexpected(ctx).length, stray = await call(p, "/rest/v1/guild_departures?select=id", null, "GET"), edge = await call(p, "/functions/v1/anything", {});
    A("an unrecorded table read and an Edge call answer 501 and are listed", stray.status === 501 && edge.status === 501
      && mock.unexpected(ctx).slice(before).join("|") === "GET /rest/v1/guild_departures|POST /functions/v1/anything", mock.unexpected(ctx));
    const joined = await p.evaluate((host) => new Promise((res) => {
      const ws = new WebSocket(host.replace("https", "wss") + "/realtime/v1/websocket?vsn=1.0.0");
      ws.onopen = () => ws.send(JSON.stringify({ topic: "realtime:market", event: "phx_join", ref: "1", join_ref: "1",
        payload: { config: { postgres_changes: [{ event: "*", schema: "public", table: "market_bids" }] } } }));
      ws.onmessage = (m) => { res(JSON.parse(m.data)); ws.close(); };
      setTimeout(() => res(null), 3000);
    }), HOST);
    A("the realtime socket answers a join ok and echoes its bindings with ids", joined && joined.event === "phx_reply" && joined.payload.status === "ok"
      && joined.payload.response.postgres_changes[0].id === 1 && joined.payload.response.postgres_changes[0].table === "market_bids", joined);
    /* on the real site the page joins its own channels too (the pulse, the bell), so the suite's join is the last one */
    A("the join is listed", mock.realtime(ctx).slice(-1).join() === "realtime:market" && (LIVE || mock.realtime(ctx).length === 1), mock.realtime(ctx));
    await ctx.close();
  }

  console.log("## S2.write: recorded, answered from the table, never a fake success");
  {
    const seen = [];
    const { ctx, p } = await open("gm", { writes: {
      market_bid: mock.ok({ lot: "L1", price: 1000000 }),
      waive_player: mock.fail("23514", "Someone holds the club's GM seat and cannot be waived.", "seat"),
      set_game_lineup: (args, info) => { seen.push(info); return args.p_slots && args.p_slots.length === 6 ? mock.ok(null) : mock.fail("23514", "A lineup needs six.", "short"); }
    } });
    const r = await p.evaluate(async () => {
      let repaints = 0; const out = {};
      out.bid = await S2.write("market_bid", { p_lot: "L1", p_amount: 1000000 }, { repaint: () => { repaints++; } });
      out.repaints = repaints;
      const err = async (fn) => { try { await fn(); return "resolved"; } catch (e) { return { message: e.message, code: e.code, hint: e.hint, isError: e instanceof Error }; } };
      out.waive = await err(() => S2.write("waive_player", { p_profile: "x" }, { repaint: () => { repaints++; } }));
      out.repaintsAfterError = repaints;
      out.unlisted = await err(() => S2.write("accept_trade", { p_trade: "t" }));
      out.lineup6 = await S2.write("set_game_lineup", { p_slots: [1, 2, 3, 4, 5, 6] }, { approval: "owner" });
      out.lineup5 = await err(() => S2.write("set_game_lineup", { p_slots: [1, 2, 3, 4, 5] }));
      S2._writeImpl = function () { return Promise.resolve({ data: "real client" }); };
      out.afterSwap = await S2.write("market_bid", {});
      out.blocked = S2_MOCK.blocked.slice(); out.pageCalls = S2_MOCK.calls.length;
      return out;
    });
    A("a {data} answer resolves {data} and repaints once", JSON.stringify(r.bid) === JSON.stringify({ data: { lot: "L1", price: 1000000 } }) && r.repaints === 1, r);
    A("a league error rejects an Error with its code, message and hint, and repaints nothing", r.waive.isError && r.waive.code === "23514" && r.waive.hint === "seat"
      && /GM seat/.test(r.waive.message) && r.repaintsAfterError === 1, r.waive);
    A("an rpc the table does not name rejects MOCK1, never a fake success", r.unlisted.code === "MOCK1" && /accept_trade/.test(r.unlisted.message), r.unlisted);
    A("a function answer sees the args, the persona and the approval route", r.lineup6.data === null && r.lineup5.hint === "short" && seen[0].persona === "gm" && seen[0].approval === "owner", seen);
    A("a later S2._writeImpl assignment is blocked and listed, the mock keeps answering", r.afterSwap.data.lot === "L1" && r.blocked.indexOf("_writeImpl") >= 0, r.blocked);
    const calls = mock.calls(ctx);
    A("Node holds every call in order with its args, approval and persona", calls.map((c) => c.rpc).join() === "market_bid,waive_player,accept_trade,set_game_lineup,set_game_lineup,market_bid"
      && calls[3].approval === "owner" && calls[0].args.p_amount === 1000000 && calls.every((c) => c.persona === "gm") && r.pageCalls === 6, calls.map((c) => c.rpc));
    mock.respond(ctx, "accept_trade", mock.ok({ id: "t" }));
    A("respond() changes one answer mid-test", (await p.evaluate(() => S2.write("accept_trade", {}))).data.id === "t");
    await mock.install(ctx, { persona: "staff" });
    await p.reload(); await p.waitForFunction(() => window.S2 && S2.$ && S2.$("#navbar") && S2.$("#page") && S2.$("#page").children.length > 0);
    const s = await p.evaluate(() => ({ staff: S2.session.isStaff, seat: S2.session.seat }));
    A("install again switches persona (and empties the writes table)", s.staff === true && s.seat === null
      && (await p.evaluate(async () => { try { await S2.write("market_bid", {}); return "resolved"; } catch (e) { return e.code; } })) === "MOCK1");
    A("the desk read follows the switch at once", (await call(p, "/rest/v1/rpc/s2_desk")).status === 200);
    await ctx.close();
  }

  console.log("## run.cjs modes");
  {
    /* i3f: every mode mocks every context now (fixture mode, which mocked none, is retired) */
    const ctx = await b.newContext(), installed = await (async () => { try { mock.calls(ctx); return true; } catch (e) { return false; } })();
    A("the context a suite opens is mocked in every mode (" + MODE + ")", installed);
    const p = await ctx.newPage(); await p.goto(S2_BASE + "#/today");
    await p.waitForFunction(() => window.S2 && S2.$ && S2.$("#navbar") && S2.$("#page") && S2.$("#page").children.length > 0);
    const s = await p.evaluate(() => ({ mock: !!window.S2_MOCK, live: S2.LIVE }));
    A("live-fixture fences the network only, mock adds the page layer, live is the real site with it", s.mock === (MODE !== "live-fixture") && s.live === LIVE, s);
    await ctx.close();
  }

  A("no page error or console error across the whole run", errors.length === 0, errors.slice(0, 5));
  await b.close();
  console.log(fails ? "\nFAIL (" + fails + ")" : "\nPASS");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
