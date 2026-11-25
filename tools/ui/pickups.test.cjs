const S2_BASE = process.env.S2_BASE || (() => { throw new Error("S2_BASE unset: run through tools/ui/run.cjs") })();
const S2_ROOT = process.env.S2_ROOT || (() => { throw new Error("S2_ROOT unset: run through tools/ui/run.cjs") })();
/* Pickup games on the Season 2 site (js/pages/pickups.js, S2 swap stream g5, 2026-11-24):
     node tools/ui/run.cjs --suite pickups --mode live
   The page is a port of the classic pickup tools (the #/pickup-import flow, the Stats manager's pickup list, delete and line
   editor, the public pickup box score). Every check drives it the way a statistics staffer or a member would and reads what
   it sent. i3d (2026-11-25): every context is the REAL site (j1's mock with live: true, h0): the page as the site build ships
   it, js/live.js's own supabase-js client signed in as the persona, and the harness answering PostgREST from this file's
   tables. The doubles, all in this browser context, nothing leaving it:
   - the harness (tools/ui/mock): the persona's S2.session, the S2.write door (answered from this file's writes, which edit a
     small in-memory database so a read back sees the write), the table reads and read RPCs (from that database), and the
     network fence;
   - /api/pickup-import (the Netlify function): stubbed here, never called.
   The games, clubs, members and EA ids are made up; no member's name is written here.
   What is checked, for each action: the door and its exact arguments, that nothing shows as done before the league
   confirms it, that a refusal is shown in place with the input kept, that the page repaints in place, that a member sees
   no control, and that no write ever reaches a league table (pickup lines never count toward league totals). */
const mock = require(process.env.S2_MOCK);
const { chromium } = require(mock.PW);
let fails = 0, n = 0;
const A = (name, cond, more) => { n++; console.log((cond ? "PASS " : "FAIL ") + name + (cond || more == null ? "" : "  (" + (typeof more === "string" ? more : JSON.stringify(more)).slice(0, 600) + ")")); if (!cond) fails++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* the made-up league of pickup games: two games, three members */
const GID = "00000000-0000-4000-8000-0000000000a1", GID2 = "00000000-0000-4000-8000-0000000000a2", NEW = "00000000-0000-4000-8000-0000000000a3";
const PA = "00000000-0000-4000-8000-0000000000b1", PB = "00000000-0000-4000-8000-0000000000b2", PC = "00000000-0000-4000-8000-0000000000b3";
function seed() {
  const line = (id, game, o) => Object.assign({ id, pickup_game_id: game, profile_id: null, ea_player_id: "ea-" + id, skater_name: "EA " + id, team_side: "A", position: "C", goals: 0, assists: 0, shots: 0, hits: 0, pim: 0,
    plus_minus: 0, takeaways: 0, giveaways: 0, faceoffs_won: 0, faceoffs_lost: 0, time_on_ice_seconds: 3600, is_goalie: false, saves: 0, shots_against: 0, goals_against: 0, shutout: false }, o);
  return {
    games: [
      { id: GID, ea_match_id: "m-old1", ea_match_ids: ["m-old1"], source: "ea", played_at: "2026-11-21T02:30:00Z", club_a: "Northside Blades", club_b: "Harbor Wolves", score_a: 5, score_b: 3, went_ot: false },
      { id: GID2, ea_match_id: "m-old2", ea_match_ids: ["m-old2"], source: "ea", played_at: "2026-11-19T02:30:00Z", club_a: "Iron Range", club_b: "Harbor Wolves", score_a: 2, score_b: 4, went_ot: true }],
    stats: [
      line("r1", GID, { profile_id: PA, skater_name: "EA Alpha", goals: 2, assists: 1, shots: 6 }),
      line("r2", GID, { skater_name: "EA Bravo", team_side: "B", position: "G", is_goalie: true, saves: 20, shots_against: 25, goals_against: 5 }),
      line("r3", GID, { skater_name: "EA Charlie", team_side: "B", goals: 1, plus_minus: -1 }),
      line("r9", GID2, { profile_id: PB, skater_name: "EA Delta" })],
    profiles: [{ id: PA, gamertag: "Member Alpha", display_name: "Alpha", ea_id: "EA Alpha" }, { id: PB, gamertag: "Member Bravo", display_name: "Bravo", ea_id: null },
      { id: PC, gamertag: "Member Charlie", display_name: "Charlie", ea_id: "EA Charlie" }]
  };
}
/* the league's people as the harness's default profiles table carries them (the persona's own row among them, for
   js/live.js's sign-in read); the picker reads the made-up members only */
const PEOPLE = mock.league().people.map((x) => ({ id: x.id, gamertag: x.gamertag, display_name: x.display_name, avatar_url: x.avatar_url, role: x.role,
  banned: !!x.banned, ban_reason: null, discord_id: null, discord_username: null, in_guild: true, ea_id: null }));
const qs = (url) => new URL(url).searchParams.toString();

/* the reads: PostgREST as the page's real client calls it, answered by the harness from the in-memory database (the harness
   applies each query's filters, order, limit and select; the embeds are on the rows as PostgREST returns them) */
function tables(H) {
  const D = H.db, tag = (pid) => { const p = D.profiles.filter((x) => x.id === pid)[0]; return p ? { gamertag: p.gamertag } : null; };
  const gameOf = (gid) => { const g = D.games.filter((x) => x.id === gid)[0]; return g ? { id: g.id, club_a: g.club_a, club_b: g.club_b, score_a: g.score_a, score_b: g.score_b, played_at: g.played_at, went_ot: g.went_ot } : null; };
  return {
    pickup_games: (q) => { H.reads.push("pickup_games?" + qs(q.url)); if (H.gameReadFail && q.filters.some((f) => f[0] === "id")) return mock.fail("57014", "canceling statement due to statement timeout"); return D.games.map((g) => Object.assign({}, g, { pickup_stats: [{ count: D.stats.filter((x) => x.pickup_game_id === g.id).length }] })); },
    pickup_stats: (q) => { H.reads.push("pickup_stats?" + qs(q.url)); return D.stats.map((x) => Object.assign({}, x, { profiles: tag(x.profile_id), pickup_games: gameOf(x.pickup_game_id) })); },
    profiles: (q) => { H.reads.push("profiles?" + qs(q.url)); if (H.profFail && !q.filters.some((f) => f[0] === "id")) return mock.fail("57014", "canceling statement due to statement timeout"); return q.filters.some((f) => f[0] === "id") ? PEOPLE.concat(D.profiles) : D.profiles; }
  };
}
function rpcs(H) {
  return {
    is_stats_staff: (a, info) => { H.gateAsked++; return mock.ok(info.persona === "staff" || info.persona === "commissioner"); },
    ea_lookup_health: () => mock.ok({ state: "working", at: new Date(Date.now() - 120000).toISOString(), latencyMs: 900, error: null }),
    ea_lookup_state: (a) => { H.states.push(a); return mock.ok({ pending: false }); }
  };
}
/* the writes, as the four doors behave (sql: stats_pickup_row returns the row; the other three return nothing). H.w lets a
   check swap one answer for a refusal or a door that changes nothing */
function writes(H) {
  const D = H.db, call = (k, args) => (H.w[k] ? H.w[k](args) : base[k](args));
  const base = {
    stats_pickup_delete: (a) => { D.games = D.games.filter((g) => g.id !== a.p_game); D.stats = D.stats.filter((s) => s.pickup_game_id !== a.p_game); return mock.ok(null); },
    stats_pickup_row_delete: (a) => { D.stats = D.stats.filter((s) => s.id !== a.p_row_id); return mock.ok(null); },
    stats_pickup_update_game: (a) => {
      const g = D.games.filter((x) => x.id === a.p_game)[0], p = a.p;
      if (g) { ["club_a", "club_b"].forEach((k) => { if (p[k]) g[k] = p[k]; }); ["score_a", "score_b"].forEach((k) => { if (p[k] != null) g[k] = p[k]; }); if (p.went_ot != null) g.went_ot = p.went_ot; if (p.played_at) g.played_at = p.played_at; }
      return mock.ok(null);
    },
    stats_pickup_row: (a) => {
      const p = a.p;
      if (a.p_row_id == null) {
        if (p.profile_id && D.stats.some((s) => s.pickup_game_id === a.p_game && s.profile_id === p.profile_id)) return mock.fail("23505", "duplicate key value violates unique constraint \"pickup_stats_game_profile_uq\"");
        const row = { id: "r" + (100 + D.stats.length), pickup_game_id: a.p_game, profile_id: p.profile_id || null, ea_player_id: null, skater_name: p.skater_name || null, team_side: p.team_side || null, position: null,
          goals: 0, assists: 0, shots: 0, hits: 0, pim: 0, plus_minus: 0, takeaways: 0, giveaways: 0, faceoffs_won: 0, faceoffs_lost: 0, time_on_ice_seconds: 0, is_goalie: !!p.is_goalie, saves: 0, shots_against: 0, goals_against: 0, shutout: false };
        D.stats.push(row); return mock.ok(Object.assign({}, row));
      }
      const s = D.stats.filter((x) => x.id === a.p_row_id)[0];
      if (!s) return mock.ok({ id: null });
      if ("profile_id" in p && p.profile_id && D.stats.some((x) => x.id !== s.id && x.pickup_game_id === s.pickup_game_id && x.profile_id === p.profile_id)) return mock.fail("23505", "duplicate key value violates unique constraint \"pickup_stats_game_profile_uq\"");
      if ("profile_id" in p) s.profile_id = p.profile_id || null;
      if (p.is_goalie != null) s.is_goalie = p.is_goalie;
      ["goals", "assists", "shots", "hits", "pim", "plus_minus", "saves", "shots_against", "goals_against"].forEach((k) => { if (p[k] != null) s[k] = parseInt(p[k], 10); });
      return mock.ok(Object.assign({}, s));
    }
  };
  const out = {}; Object.keys(base).forEach((k) => { out[k] = (args) => call(k, args); });
  return out;
}

(async () => {
  const b = await chromium.launch();
  const errors = [];
  async function open(persona, hash, o) {
    o = o || {};
    const ctx = await b.newContext(Object.assign({ viewport: { width: o.width || 1280, height: 900 } }, o.touch ? { isMobile: true, hasTouch: true } : {}));
    const H = { db: seed(), posts: [], reads: [], states: [], gateAsked: 0, w: {}, pickup: o.pickup || (() => ({ status: 400, json: { error: "no answer in this check" } })) };
    await ctx.addInitScript(() => { try { localStorage.setItem("s2.introSeen", "true"); localStorage.setItem("s2.survey", JSON.stringify({ done: "2026-11-24T00:00:00.000Z", from: "daily" })); } catch (e) { /* storage blocked */ } });
    await mock.install(ctx, { live: true, persona, writes: writes(H), tables: tables(H), rpcs: rpcs(H) });
    await ctx.route("**/api/pickup-import", async (r) => {
      const body = JSON.parse(r.request().postData() || "{}"); H.posts.push({ body, auth: r.request().headers().authorization || null });
      const out = await H.pickup(body, H);
      r.fulfill({ status: out.status || 200, contentType: "application/json", body: JSON.stringify(out.json || out) });
    });
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    /* a stubbed 409 or a fenced 501 is meant: the browser logs each as "Failed to load resource" */
    p.on("console", (m) => { if (m.type() === "error" && !/^Failed to load resource/.test(m.text())) errors.push(m.text()); });
    await p.goto(S2_BASE + hash);
    await p.waitForFunction(() => window.S2 && S2.M && document.querySelector("#puRoot"), null, { timeout: 15000 });
    return { ctx, p, H };
  }
  const until = (p, fn, arg, ms) => p.waitForFunction(fn, arg, { timeout: ms || 6000 }).then(() => true, () => false);
  const txt = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, " ").trim() : null; }, sel);
  const sheetOk = async (p) => { await p.waitForSelector('.sheet [data-cf="ok"]'); await p.click('.sheet [data-cf="ok"]'); };
  const calls = (ctx) => (mock.calls(ctx) || []);
  const soon = async (fn, ms) => { const t0 = Date.now(); while (Date.now() - t0 < (ms || 4000)) { if (fn()) return true; await wait(50); } return fn(); };
  const leagueHash = (p) => p.evaluate(() => JSON.stringify((S2.M.games || []).map((g) => [g.id, g.hs, g.as, g.status, g.lines || 0])));
  let o, r;

  console.log("## the page registers; a visitor reads the games and gets no control; a refused read says so (" + process.env.S2_MODE + " mode)");
  o = await open("anon", "#/pickups");
  A("#/pickups is a page of its own, titled Pickup games", await o.p.evaluate(() => !!S2.pages.pickups && /Pickup games/.test(document.getElementById("page").textContent)));
  A("a visitor reads the league's games", await until(o.p, () => document.querySelectorAll("#puList tbody tr").length === 2), await txt(o.p, "#puList"));
  A("a visitor gets no import, no delete and no editor", await o.p.evaluate(() => document.getElementById("puImp").hidden && !document.getElementById("puQ") && !document.querySelector('[data-pu="list-del"]')));
  A("nothing was posted to the import function", o.H.posts.length === 0);
  A("the page carries its stylesheet (css/pickups.css)", await o.p.evaluate(() => [...document.styleSheets].some((s) => /css\/pickups\.css$/.test(s.href || ""))));
  /* i3d: the no-connection checks pinned the demo and fixture pages (no read client); the site always has one, so a read
     the league refuses is what a visitor can meet, and it is said, never shown as an empty list */
  mock.respond(o.ctx, "table:pickup_games", mock.fail("57014", "canceling statement due to statement timeout"));
  mock.respond(o.ctx, "table:pickup_stats", mock.fail("57014", "canceling statement due to statement timeout"));
  await o.p.reload();
  A("a refused list read says the league's words, with Try again", await until(o.p, () => /statement timeout/.test((document.getElementById("puList") || {}).textContent || "")) &&
    /Couldn’t load the pickup games/.test(await txt(o.p, "#puList")) && !!(await o.p.$('#puList [data-pu="list-retry"]')), await txt(o.p, "#puList"));
  await o.p.goto(S2_BASE + "#/pickups/" + GID);
  A("one game's page says the same, in place of the box score", await until(o.p, () => /Couldn’t load this game/.test((document.getElementById("puHead") || {}).textContent || "")), await txt(o.p, "#puHead"));
  mock.respond(o.ctx, "table:pickup_games", tables(o.H).pickup_games);
  mock.respond(o.ctx, "table:pickup_stats", tables(o.H).pickup_stats);
  await o.p.goto(S2_BASE + "#/pickups");
  await o.p.click('#puList [data-pu="list-retry"]').catch(() => null);
  A("Try again reads the list once more and fills it in place", await until(o.p, () => document.querySelectorAll("#puList tbody tr").length === 2), await txt(o.p, "#puList"));
  A("a visitor wrote nothing", calls(o.ctx).length === 0, calls(o.ctx));
  await o.ctx.close();

  console.log("## a member reads the games and box scores, and sees no control");
  o = await open("member", "#/pickups");
  A("the list is the league's: both games, newest first, with their line counts", await until(o.p, () => document.querySelectorAll("#puList tbody tr").length === 2) &&
    /Northside Blades 5, Harbor Wolves 3/.test(await txt(o.p, "#puList tbody tr:first-child")) && /\b3\b/.test(await txt(o.p, "#puList tbody tr:first-child td:nth-child(3)")), await txt(o.p, "#puList"));
  A("the list read asks for the counts, newest first, the newest 60", o.H.reads.some((x) => /^pickup_games\?/.test(x) && /pickup_stats%28count%29|pickup_stats\(count\)/.test(x) && /order=played_at\.desc/.test(x) && /limit=60/.test(x)), o.H.reads);
  A("the gate is the database's answer (is_stats_staff asked once)", await soon(() => o.H.gateAsked === 1), o.H.gateAsked);
  await wait(300);
  A("no import, no delete button for a member", await o.p.evaluate(() => document.getElementById("puImp").hidden && !document.getElementById("puQ") && !document.querySelector('[data-pu="list-del"]')));
  await o.p.click('#puList a[href="#/pickups/' + GID + '"]');
  A("a game opens on its own page: the score, then a box score per side", await until(o.p, () => document.querySelectorAll("#puGame .pu-side").length === 2) && /Northside Blades 5, Harbor Wolves 3/.test(await txt(o.p, "#puHead")), await txt(o.p, "#puRoot"));
  r = await o.p.evaluate(() => ({ links: [...document.querySelectorAll("#puGame a")].map((a) => a.getAttribute("href")), inputs: document.querySelectorAll("#puGame input, #puGame select, #puGame [data-pu]").length,
    goalie: /20\s*25\s*\.800/.test(document.querySelector("#puGame .pu-side:nth-child(2)").textContent.replace(/\s+/g, " ")) }));
  A("a matched line links to the member's profile; an unmatched one is plain text", r.links.length === 1 && r.links[0] === "#/player/" + PA, r.links);
  A("the goaltender's line reads saves, shots against and save percentage", r.goalie, await txt(o.p, "#puGame"));
  A("a member's game page has no input, picker or control", r.inputs === 0, r.inputs);
  A("a member wrote nothing and posted nothing", calls(o.ctx).length === 0 && o.H.posts.length === 0, calls(o.ctx));
  A("no request went past the recorded reads and this suite's routes", mock.unexpected(o.ctx).length === 0, mock.unexpected(o.ctx));
  await o.ctx.close();

  console.log("## a member's pickup lines on their profile (S2.pickups.profileHtml, the one call js/pages/profile.js makes)");
  o = await open("member", "#/pickups");
  o.H.db.stats.push({ id: "r20", pickup_game_id: GID2, profile_id: PA, skater_name: "EA Alpha", team_side: "B", position: "G", is_goalie: true, goals: 0, assists: 0, shots: 0, hits: 0, pim: 0, plus_minus: 0,
    saves: 18, shots_against: 20, goals_against: 2, shutout: false });
  const pfId = await o.p.evaluate(() => S2.M.players[0].id);
  await o.p.goto(S2_BASE + "#/player/" + pfId);
  await o.p.waitForFunction(() => !!document.getElementById("pfBody"), null, { timeout: 15000 });
  const before2 = await leagueHash(o.p);
  /* e7's one line, placed by hand until profile.js carries it: the section after the player's body, before About */
  const place = (pid) => o.p.evaluate((id) => { const old = document.getElementById("puProf"); if (old) old.remove(); document.getElementById("pfBody").insertAdjacentHTML("afterend", S2.pickups.profileHtml(id)); }, pid);
  await place(PA);
  A("the section is hidden while the league is asked, then fills in place", await until(o.p, () => { const x = document.getElementById("puProf"); return x && !x.hidden && /Pickup games/.test(x.textContent); }), await txt(o.p, "#puProf"));
  A("the read is the member's pickup lines with their games", o.H.reads.some((x) => /^pickup_stats\?/.test(x) && x.indexOf("profile_id=eq." + PA) >= 0 && /pickup_games%28|pickup_games\(/.test(x)), o.H.reads);
  r = await txt(o.p, "#puProf");
  A("it says these are not league play and never count toward league totals", /Not league play/.test(r) && /never count toward league totals/.test(r) && /2 games/.test(r), r);
  r = await o.p.evaluate(() => [...document.querySelectorAll("#puProf .pu-role")].map((b) => ({ h: (b.querySelector("h3") || {}).textContent || "", figs: [...b.querySelectorAll(".metric")].map((m) => m.querySelector("dt").textContent + "=" + m.querySelector("dd").textContent),
    links: [...b.querySelectorAll("tbody a")].map((a) => a.getAttribute("href")), rows: b.querySelectorAll("tbody tr").length })));
  A("each role played has its own figures and log: as a skater, then in goal", r.length === 2 && r[0].h === "As a skater" && r[1].h === "In goal" && r[0].rows === 1 && r[1].rows === 1, r);
  A("the skater's figures are the game's line", ["Games=1", "Goals=2", "Assists=1", "Points=3", "Shots=6", "Shooting %=33%"].every((f) => r[0].figs.indexOf(f) >= 0), r[0].figs);
  A("the goaltender's figures read the record from the side and the score", ["Games=1", "Record=1-0-0", "Save %=.900", "GAA=2.00", "Saves=18"].every((f) => r[1].figs.indexOf(f) >= 0), r[1].figs);
  A("each game links to its pickup box score", r[0].links[0] === "#/pickups/" + GID && r[1].links[0] === "#/pickups/" + GID2, r.map((x) => x.links));
  A("a profile's pickup lines leave the league's record untouched", (await leagueHash(o.p)) === before2);
  await place(PC);
  A("a member with no pickup game: asked, and the section stays hidden", await soon(() => o.H.reads.some((x) => x.indexOf("profile_id=eq." + PC) >= 0)) && await wait(300).then(() => o.p.evaluate(() => document.getElementById("puProf").hidden)));
  /* a 500, not a 503: supabase-js retries a GET that answers 503 three times over seven seconds before it gives up */
  const statsOk = tables(o.H).pickup_stats;
  mock.respond(o.ctx, "table:pickup_stats", (q) => (q.filters.some((f) => f[0] === "profile_id") ? Object.assign(mock.fail("57014", "upstream timed out"), { status: 500 }) : statsOk(q)));
  await place(PB);
  A("a failed read is said in the section, with the league's words and Try again", await until(o.p, () => /Couldn’t load pickup stats/.test((document.getElementById("puProf") || {}).textContent || "")) &&
    /upstream timed out/.test(await txt(o.p, "#puProf")) && !!(await o.p.$('#puProf [data-pu="prof-retry"]')), await txt(o.p, "#puProf"));
  mock.respond(o.ctx, "table:pickup_stats", statsOk);
  await o.p.click('#puProf [data-pu="prof-retry"]');
  A("Try again reads once more and fills the section in place, focus on its heading", await until(o.p, () => document.querySelectorAll("#puProf .pu-role tbody tr").length === 1) &&
    await o.p.evaluate(() => document.activeElement && document.activeElement.id === "puProfH"), await txt(o.p, "#puProf"));
  await o.p.click('#puProf tbody a');
  A("a game in the log opens its pickup box score", await until(o.p, (id) => location.hash === "#/pickups/" + id && document.querySelectorAll("#puGame .pu-side").length === 2, GID2), await o.p.evaluate(() => location.hash));
  A("the profile wrote nothing and posted nothing", calls(o.ctx).length === 0 && o.H.posts.length === 0, calls(o.ctx));
  await o.ctx.close();

  console.log("## a staffer imports a game from EA, through the bot server, and the league confirms it");
  const MATCHES = [
    { matchId: "m1", playedAt: "2026-11-24T03:42:00Z", wentOt: false, minutes: 60, a: { name: "Northside Blades", score: 5 }, b: { name: "Harbor Wolves", score: 3 } },
    { matchId: "m2", playedAt: "2026-11-24T03:05:00Z", wentOt: false, minutes: 14, a: { name: "Northside Blades", score: 1 }, b: { name: "Harbor Wolves", score: 1 } },
    { matchId: "m3", playedAt: "2026-11-24T03:25:00Z", wentOt: false, minutes: 46, a: { name: "Harbor Wolves", score: 2 }, b: { name: "Northside Blades", score: 3 } },
    { matchId: "m4", playedAt: "2026-11-23T03:20:00Z", wentOt: true, minutes: 61, a: { name: "Northside Blades", score: 2 }, b: { name: "Iron Range", score: 3 } },
    { matchId: "m5", playedAt: "2026-11-22T03:20:00Z", wentOt: false, minutes: 30, a: { name: "Northside Blades", score: 0 }, b: { name: "Harbor Wolves", score: 0 } },
    { matchId: "m6", playedAt: "2026-11-22T02:20:00Z", wentOt: false, minutes: 30, a: { name: "Northside Blades", score: 1 }, b: { name: "Harbor Wolves", score: 0 } }];
  let importAns = null;
  o = await open("staff", "#/pickups", { pickup: (body, H) => {
    if (body.action === "search") return body.eaLookup ? { clubs: [{ clubId: "9001", name: "Northside Blades", memberCount: 9 }, { clubId: "9002", name: "Northside Two" }] } : { eaPending: 41 };
    if (body.action === "matches") return { matches: MATCHES };
    if (body.action === "import") return importAns(body, H);
    return { status: 400, json: { error: "Unknown action." } };
  } });
  const before = await leagueHash(o.p);
  A("the gate is the database's answer: is_stats_staff says yes, and the import appears", await until(o.p, () => !!document.getElementById("puQ")) && o.H.gateAsked === 1, o.H.gateAsked);
  A("the EA search status line is the bot server's own reading", await until(o.p, () => /EA search is working/.test((document.querySelector("#puImp [data-ea-status]") || {}).textContent || "")), await txt(o.p, "#puImp [data-ea-status]"));
  await o.p.fill("#puQ", "N"); await o.p.click('#puImp [data-pu="search"]');
  A("one letter is refused in place, and nothing is asked", /at least two letters/.test(await txt(o.p, "#puImpOut")) && o.H.posts.length === 0, await txt(o.p, "#puImpOut"));
  await o.p.fill("#puQ", "Northside"); await o.p.press("#puQ", "Enter");
  A("Return searches: the club list comes back after the bot server answers", await until(o.p, () => document.querySelectorAll('#puImpOut [data-pu="club"]').length === 2, null, 9000), await txt(o.p, "#puImpOut"));
  A("the search filed a lookup, waited on it, then read the bot's answer (S2.ea, with the staffer's token)", o.H.posts.length === 2 && o.H.posts[0].body.action === "search" && o.H.posts[0].body.clubName === "Northside" &&
    o.H.posts[1].body.eaLookup === 41 && o.H.states.length >= 1 && o.H.states[0].p_id === 41 && /^Bearer .+\.mock$/.test(o.H.posts[0].auth || ""), o.H.posts.map((x) => x.body));
  A("the typed search is kept", await o.p.evaluate(() => document.getElementById("puQ").value === "Northside"));
  await o.p.click('#puImpOut [data-pu="club"][data-i="0"]');
  A("the club's recent private matches are listed", await until(o.p, () => document.querySelectorAll('#puImpOut input[name="puMatch"]').length === 6), await txt(o.p, "#puImpOut"));
  A("the spoken status line says what came back, and stays a screen-reader line", await o.p.evaluate(() => { const x = document.getElementById("puSay"); return x.className === "sr" && /6 recent matches/.test(x.textContent); }));
  A("the matches were asked for that club", o.H.posts[2].body.action === "matches" && o.H.posts[2].body.clubId === "9001", o.H.posts[2] && o.H.posts[2].body);
  r = await txt(o.p, "#puImpOut");
  A("a sitting under 45 minutes is flagged as likely one sitting of a game that lagged out", /~14 min/.test(r) && /likely one sitting of a game that lagged out/.test(r), r);
  A("with nothing ticked the button waits and says to tick the game", await o.p.evaluate(() => document.querySelector('#puImpBar [data-pu="import"]').disabled) && /Tick the game to import/.test(await txt(o.p, "#puImpBar")));
  await o.p.evaluate(() => { document.querySelector('input[name="puMatch"][value="m2"]').__mark = 1; });
  await o.p.click('input[name="puMatch"][value="m2"]');
  A("one tick: Import this game", /Import this game/.test(await txt(o.p, "#puImpBar")));
  A("the checkbox under the finger is not redrawn", await o.p.evaluate(() => document.querySelector('input[name="puMatch"][value="m2"]').__mark === 1));
  await o.p.click('input[name="puMatch"][value="m3"]');
  A("two ticks: Import 2 sittings as one game", /Import 2 sittings as one game/.test(await txt(o.p, "#puImpBar")), await txt(o.p, "#puImpBar"));
  await o.p.click('input[name="puMatch"][value="m4"]');
  A("a sitting against another club is refused: a game that lagged out is always the same two clubs", !(await o.p.isChecked('input[name="puMatch"][value="m4"]')) && /Import 2 sittings/.test(await txt(o.p, "#puImpBar")));
  await o.p.click('input[name="puMatch"][value="m1"]'); await o.p.click('input[name="puMatch"][value="m5"]'); await o.p.click('input[name="puMatch"][value="m6"]');
  A("a fifth sitting is refused: four is the most one game is imported from", !(await o.p.isChecked('input[name="puMatch"][value="m6"]')) && /Import 4 sittings/.test(await txt(o.p, "#puImpBar")), await txt(o.p, "#puImpBar"));
  await o.p.click('input[name="puMatch"][value="m1"]'); await o.p.click('input[name="puMatch"][value="m5"]');

  importAns = () => ({ status: 409, json: { error: "One of those sessions is already part of an imported game.", pickupGameId: GID } });
  await o.p.click('#puImpBar [data-pu="import"]');
  A("a refused import says the function's words beside the button, with a way to the game on file", await until(o.p, () => /already part of an imported game/.test((document.getElementById("puImpErr") || {}).textContent || "")) &&
    (await o.p.$eval("#puImpErr a", (a) => a.getAttribute("href"))) === "#/pickups/" + GID, await txt(o.p, "#puImpBar"));
  A("the import sent exactly the two ticked sittings, merged, for that club", JSON.stringify(o.H.posts[o.H.posts.length - 1].body) === JSON.stringify({ action: "import", clubId: "9001", matchIds: ["m2", "m3"] }), o.H.posts[o.H.posts.length - 1].body);
  A("the ticks are kept and the button is back", await o.p.evaluate(() => document.querySelector('input[name="puMatch"][value="m2"]').checked && document.querySelector('input[name="puMatch"][value="m3"]').checked &&
    !document.querySelector('#puImpBar [data-pu="import"]').disabled));
  importAns = () => ({ ok: true, pickupGameId: "00000000-0000-4000-8000-00000000dead", players: [], sessions: 2 });
  await o.p.click('#puImpBar [data-pu="import"]');
  A("the function's word is not enough: a game the league does not hold is reported, not Imported", await until(o.p, () => /no such game on file/.test((document.getElementById("puImpErr") || {}).textContent || "")) && !(await o.p.$("#puImpRes")), await txt(o.p, "#puImpBar"));
  importAns = (body, H) => {
    H.db.games.push({ id: NEW, ea_match_id: "m2", ea_match_ids: ["m2", "m3"], source: "ea", played_at: "2026-11-24T03:25:00Z", club_a: "Northside Blades", club_b: "Harbor Wolves", score_a: 4, score_b: 3, went_ot: false });
    return { ok: true, pickupGameId: NEW, sessions: 2, clubA: "Northside Blades", clubB: "Harbor Wolves", unmatched: 1, lobbyClosed: null,
      players: [{ name: "EA Alpha", matched: true, side: "A", goals: 2, assists: 1 }, { name: "EA Zulu", matched: false, side: "B", goals: 1, assists: 0 }, { name: "EA Charlie", matched: true, side: "B", goals: 0, assists: 2 }] };
  };
  await o.p.click('#puImpBar [data-pu="import"]');
  A("Imported, only after the league reads the game back", await until(o.p, () => !!document.getElementById("puImpRes")) && o.H.reads.some((x) => x.indexOf("pickup_games?") === 0 && x.indexOf("id=eq." + NEW) >= 0), o.H.reads.slice(-3));
  r = await txt(o.p, "#puImpRes");
  A("the result is the classic's: sittings merged, who matched, the unmatched first", /2 sittings merged into one pickup game\. 2 of 3 players matched to CGHL profiles, 1 unmatched/.test(r) &&
    (await o.p.$eval("#puImpRes li", (li) => li.textContent)).indexOf("EA Zulu") === 0, r);
  A("the result opens the new game", (await o.p.$eval('#puImpRes a', (a) => a.getAttribute("href"))) === "#/pickups/" + NEW);
  A("the list below is read again and holds the new game, in place", await until(o.p, () => document.querySelectorAll("#puList tbody tr").length === 3) && /Northside Blades 4, Harbor Wolves 3/.test(await txt(o.p, "#puList tbody tr:first-child")), await txt(o.p, "#puList"));
  A("the search field kept its text through every repaint", await o.p.evaluate(() => document.getElementById("puQ").value === "Northside" && location.hash === "#/pickups"));
  A("the league's own record is untouched by an import (pickup lines never count toward league totals)", (await leagueHash(o.p)) === before);
  A("the import wrote nothing through S2.write: the function files the game", calls(o.ctx).length === 0, calls(o.ctx));

  console.log("## a staffer deletes a game from the list: refused, unconfirmed, then confirmed");
  o.H.w.stats_pickup_delete = () => mock.fail("42501", "Only statistics staff can manage games.");
  await o.p.click('#puList [data-pu="list-del"][data-id="' + GID2 + '"]');
  A("the confirm names the game and its lines, and says league results are not affected", await until(o.p, () => !!document.querySelector(".sheet")) && /Delete Iron Range vs Harbor Wolves\?/.test(await txt(o.p, ".sheet")) &&
    /1 player line come off/.test(await txt(o.p, ".sheet")) && /League results are not affected/.test(await txt(o.p, ".sheet")), await txt(o.p, ".sheet"));
  await sheetOk(o.p);
  A("a refusal shows the league's own words, and the game stays", await until(o.p, () => /Only statistics staff can manage games/.test((document.getElementById("puListRes") || {}).textContent || "")) &&
    !!(await o.p.$('#puList [data-pu="list-del"][data-id="' + GID2 + '"]')), await txt(o.p, "#puList"));
  A("the door was stats_pickup_delete with the game's id", JSON.stringify(calls(o.ctx).slice(-1)[0]) === JSON.stringify({ rpc: "stats_pickup_delete", args: { p_game: GID2 }, approval: null, persona: "staff" }), calls(o.ctx).slice(-1));
  o.H.w.stats_pickup_delete = () => mock.ok(null);
  await o.p.click('#puList [data-pu="list-del"][data-id="' + GID2 + '"]'); await sheetOk(o.p);
  A("a door that answers but deletes nothing is caught by the read back", await until(o.p, () => /did not confirm the delete/.test((document.getElementById("puListRes") || {}).textContent || "")), await txt(o.p, "#puListRes"));
  delete o.H.w.stats_pickup_delete;
  await o.p.click('#puList [data-pu="list-del"][data-id="' + GID2 + '"]'); await sheetOk(o.p);
  A("deleted: gone from the league's list before the page says so", await until(o.p, () => /was deleted/.test((document.getElementById("puListRes") || {}).textContent || "")) && !(await o.p.$('[data-id="' + GID2 + '"]')) &&
    o.H.db.games.every((g) => g.id !== GID2), await txt(o.p, "#puList"));
  A("focus lands on the result, and the page was never reset", await o.p.evaluate(() => document.activeElement && document.activeElement.id === "puListRes" && document.getElementById("puQ").value === "Northside"));
  await o.ctx.close();

  console.log("## a staffer corrects a game: lines, a new line, a removal, the game itself, then deletes it");
  o = await open("staff", "#/pickups/" + GID);
  A("the editor opens for statistics staff: the game, then one row per line", await until(o.p, () => document.querySelectorAll("#puRows tr[data-row]").length === 3 && !!document.getElementById("puMeta")), await txt(o.p, "#puRoot"));
  A("the member picker fills in place from the profiles read", await until(o.p, () => { const s = document.querySelector('#puRow-r1 select'); return s && !s.disabled && s.options.length === 4 && s.value; }, null, 6000) &&
    (await o.p.$eval("#puRow-r1 select", (s) => s.value)) === PA, await o.p.evaluate(() => [...document.querySelector("#puRow-r1 select").options].map((x) => x.textContent)));
  A("an unmatched line says so", /unmatched/.test(await txt(o.p, "#puRow-r3")) && !/unmatched/.test(await txt(o.p, "#puRow-r1")));
  await o.p.fill('#puRow-r1 [data-f="goals"]', "3");
  await o.p.fill('#puRow-r3 [data-f="assists"]', "7");
  await o.p.click('#puRow-r1 [data-pu="row-save"]');
  A("Save on one line sends that line only, through stats_pickup_row", await until(o.p, () => /Saved/.test((document.getElementById("puBoxMsg") || {}).textContent || "")), await txt(o.p, "#puBoxMsg"));
  r = calls(o.ctx).slice(-1)[0];
  A("the patch is the classic one: numbers as integers, the goaltender mark, and no member change when the picker did not move", r.rpc === "stats_pickup_row" && r.args.p_row_id === "r1" && r.args.p_game === GID && r.args.p.goals === "3" &&
    r.args.p.assists === "1" && r.args.p.is_goalie === false && !("profile_id" in r.args.p), r.args);
  A("the saved line shows what the league returned", (await o.p.$eval('#puRow-r1 [data-f="goals"]', (x) => x.value)) === "3" && o.H.db.stats.filter((s) => s.id === "r1")[0].goals === 3);
  A("another line's unsaved number is kept (only the saved row is redrawn)", (await o.p.$eval('#puRow-r3 [data-f="assists"]', (x) => x.value)) === "7");
  A("focus stays on that line's Save", await o.p.evaluate(() => document.activeElement && document.activeElement.closest("#puRow-r1") && document.activeElement.dataset.pu === "row-save"));
  await o.p.selectOption("#puRow-r3 select", PA);
  await o.p.click('#puRow-r3 [data-pu="row-save"]');
  A("a member already on this game is refused with the league's own words", await until(o.p, () => /Not saved: duplicate key/.test((document.getElementById("puBoxMsg") || {}).textContent || "")), await txt(o.p, "#puBoxMsg"));
  A("the refused line keeps the staffer's input", (await o.p.$eval("#puRow-r3 select", (s) => s.value)) === PA && (await o.p.$eval('#puRow-r3 [data-f="assists"]', (x) => x.value)) === "7" &&
    !(await o.p.$eval('#puRow-r3 [data-pu="row-save"]', (x) => x.disabled)));
  await o.p.selectOption("#puRow-r3 select", PC);
  await o.p.click('#puRow-r3 [data-pu="row-save"]');
  A("reassigning sends the member, and the line is matched", await until(o.p, () => /Saved Member Charlie/.test((document.getElementById("puBoxMsg") || {}).textContent || "")) &&
    calls(o.ctx).slice(-1)[0].args.p.profile_id === PC && !/unmatched/.test(await txt(o.p, "#puRow-r3")) && (await o.p.$eval('#puRow-r3 [data-f="assists"]', (x) => x.value)) === "7", await txt(o.p, "#puBoxMsg"));

  await o.p.fill("#puNewName", "Late Sub"); await o.p.selectOption("#puNewSide", "B"); await o.p.check("#puNewG");
  await o.p.click('#puBox [data-pu="row-add"]');
  A("a new line is added through stats_pickup_row with no row id", await until(o.p, () => document.querySelectorAll("#puRows tr[data-row]").length === 4) &&
    JSON.stringify(calls(o.ctx).slice(-1)[0].args) === JSON.stringify({ p_row_id: null, p_game: GID, p: { skater_name: "Late Sub", team_side: "B", is_goalie: true } }), calls(o.ctx).slice(-1));
  A("it appears in place, the count follows, and the add form is cleared", /4 lines/.test(await txt(o.p, "#puBoxN")) && (await o.p.$eval("#puNewName", (x) => x.value)) === "" &&
    (await o.p.$eval('#puRow-r3 [data-f="assists"]', (x) => x.value)) === "7");
  const added = await o.p.evaluate(() => [...document.querySelectorAll("#puRows tr[data-row]")].pop().dataset.row);
  await o.p.click("#puRow-" + added + ' [data-pu="row-del"]');
  A("removing a line asks first", await until(o.p, () => /Remove this line\?/.test((document.querySelector(".sheet") || {}).textContent || "")));
  await sheetOk(o.p);
  A("removed: the door, then the read back, then the row leaves", await until(o.p, (id) => !document.getElementById("puRow-" + id) && document.querySelectorAll("#puRows tr[data-row]").length === 3, added) &&
    JSON.stringify(calls(o.ctx).slice(-1)[0].args) === JSON.stringify({ p_row_id: added }) && o.H.reads.some((x) => x.indexOf("pickup_stats?") === 0 && x.indexOf("id=eq." + added) >= 0) && /3 lines/.test(await txt(o.p, "#puBoxN")), calls(o.ctx).slice(-1));

  await o.p.fill('#puMeta [data-m="score_a"]', "6");
  await o.p.fill('#puMeta [data-m="played_at"]', "2026-11-18");
  o.H.w.stats_pickup_update_game = () => mock.ok(null);
  await o.p.click('#puMeta [data-pu="meta-save"]');
  A("a game the door does not change is caught by the read back", await until(o.p, () => /did not take every change: Score A, Date/.test((document.getElementById("puMetaMsg") || {}).textContent || "")), await txt(o.p, "#puMetaMsg"));
  delete o.H.w.stats_pickup_update_game;
  await o.p.fill('#puMeta [data-m="score_a"]', "6");
  await o.p.fill('#puMeta [data-m="played_at"]', "2026-11-18");
  await o.p.click('#puMeta [data-pu="meta-save"]');
  A("Save the game: the classic patch (the date only when changed, at midday Eastern)", await until(o.p, () => ((document.getElementById("puMetaMsg") || {}).textContent || "") === "Saved."), await txt(o.p, "#puMetaMsg"));
  r = calls(o.ctx).slice(-1)[0];
  A("stats_pickup_update_game got every field, the new score and the anchored date", r.rpc === "stats_pickup_update_game" && r.args.p_game === GID && r.args.p.score_a === 6 && r.args.p.score_b === 3 &&
    r.args.p.played_at === "2026-11-18T17:00:00.000Z" && r.args.p.went_ot === false && r.args.p.club_a === "Northside Blades", r.args);
  A("the heading shows what the league now holds", /Northside Blades 6, Harbor Wolves 3/.test(await txt(o.p, "#puHead")), await txt(o.p, "#puHead"));
  await o.p.click('#puMeta [data-pu="meta-save"]');
  await until(o.p, () => ((document.getElementById("puMetaMsg") || {}).textContent || "") === "Saved.");
  A("an unchanged date is not sent again", !("played_at" in calls(o.ctx).slice(-1)[0].args.p), calls(o.ctx).slice(-1)[0].args);

  o.H.w.stats_pickup_delete = () => mock.fail("42501", "Only statistics staff can manage games.");
  await o.p.click('#puMeta [data-pu="game-del"]'); await sheetOk(o.p);
  A("a refused game delete says why and stays on the game", await until(o.p, () => /Not deleted: Only statistics staff/.test((document.getElementById("puMetaMsg") || {}).textContent || "")) && /#\/pickups\//.test(await o.p.evaluate(() => location.hash)));
  delete o.H.w.stats_pickup_delete;
  await o.p.click('#puMeta [data-pu="game-del"]'); await sheetOk(o.p);
  A("deleted: read back gone, then the list, which says so", await until(o.p, () => location.hash === "#/pickups" && /was deleted/.test((document.getElementById("puListRes") || {}).textContent || "")) &&
    o.H.db.games.every((g) => g.id !== GID), await txt(o.p, "#puList"));
  A("every write on the page went to a stats_pickup_* door, never a league table", calls(o.ctx).length > 0 && calls(o.ctx).every((c) => /^stats_pickup_(row|row_delete|update_game|delete)$/.test(c.rpc)), calls(o.ctx).map((c) => c.rpc));
  A("no request went past this suite's routes", mock.unexpected(o.ctx).length === 0, mock.unexpected(o.ctx));
  await o.ctx.close();

  console.log("## qa: the member list failing keeps typed numbers and links; a read back that fails is not 'Not saved'; Back after a delete");
  o = await open("staff", "#/pickups/" + GID);
  o.H.profFail = true;
  await o.p.reload(); await o.p.waitForFunction(() => document.querySelector("#puRoot"));
  A("qa: a failed member list is said in the note above the lines, with Try again", await until(o.p, () => /member list didn’t load/.test((document.getElementById("puProfsNote") || {}).textContent || "") && document.querySelectorAll("#puRows tr[data-row]").length === 3), await txt(o.p, "#puBox"));
  await o.p.fill('#puRow-r3 [data-f="assists"]', "4");
  await o.p.click('#puProfsNote [data-pu="profs-retry"]');
  A("qa (nits 14): Try again repaints only the note: the number typed and not saved is kept", await until(o.p, () => /member list didn’t load/.test((document.getElementById("puProfsNote") || {}).textContent || "") && !!document.querySelector('#puProfsNote [data-pu="profs-retry"]:not([aria-busy])')) &&
    (await o.p.$eval('#puRow-r3 [data-f="assists"]', (x) => x.value)) === "4" && o.H.reads.filter((x) => /^profiles\?/.test(x) && !/id=eq/.test(x)).length >= 2, await txt(o.p, "#puProfsNote"));
  A("qa: focus stays in the note, never on the page body", await o.p.evaluate(() => !!document.activeElement && document.activeElement !== document.body && !!document.activeElement.closest("#puProfsNote")));
  await o.p.click('#puRow-r1 [data-pu="row-save"]');
  A("qa (nits 16): saving a linked line while the member list is missing keeps its member, never 'unmatched'", await until(o.p, () => /Saved/.test((document.getElementById("puBoxMsg") || {}).textContent || "")) &&
    !/unmatched/.test(await txt(o.p, "#puRow-r1")) && /Member Alpha/.test(await o.p.$eval("#puRow-r1 select", (s) => s.options[s.selectedIndex].textContent)), await txt(o.p, "#puRow-r1"));
  o.H.profFail = false;
  await o.p.click('#puProfsNote [data-pu="profs-retry"]');
  A("qa: once the list loads the pickers fill in place and the unsaved number is still there", await until(o.p, () => { const s = document.querySelector("#puRow-r3 select"); return s && !s.disabled && s.options.length === 4; }) &&
    (await o.p.$eval('#puRow-r3 [data-f="assists"]', (x) => x.value)) === "4" && (await txt(o.p, "#puProfsNote")) === "", await txt(o.p, "#puProfsNote"));
  o.H.gameReadFail = true;
  await o.p.fill('#puMeta [data-m="score_a"]', "7");
  await o.p.click('#puMeta [data-pu="meta-save"]');
  A("qa (nits 15): a confirmed write whose read back fails says it was sent, never 'Not saved'", await until(o.p, () => /The change was sent, but the game could not be read back/.test((document.getElementById("puMetaMsg") || {}).textContent || "")) &&
    !/Not saved/.test(await txt(o.p, "#puMetaMsg")) && o.H.db.games.filter((g) => g.id === GID)[0].score_a === 7, await txt(o.p, "#puMetaMsg"));
  o.H.gameReadFail = false;
  await o.p.click('#puMeta [data-pu="game-del"]'); await sheetOk(o.p);
  await until(o.p, () => location.hash === "#/pickups" && /was deleted/.test((document.getElementById("puListRes") || {}).textContent || ""));
  await o.p.goBack();
  A("qa (nits 17): Back after the delete never redraws the deleted game: the page reads it again and finds none", await until(o.p, () => /Pickup game not found/.test((document.getElementById("puHead") || {}).textContent || "")) && !(await o.p.$("#puMeta")), await txt(o.p, "#puRoot"));
  await o.ctx.close();
  o = await open("member", "#/pickups/" + GID);
  mock.respond(o.ctx, "rpc:is_stats_staff", Object.assign(mock.fail("57014", "upstream timed out"), { status: 503 }));
  await o.p.reload(); await o.p.waitForFunction(() => document.querySelector("#puRoot"));
  A("qa (nits 18): on a game's page a gate the league did not answer is said above the read-only box score, with Try again", await until(o.p, () => /Couldn’t check your statistics access/.test((document.getElementById("puGame") || {}).textContent || "")) &&
    !!(await o.p.$('#puGame [data-pu="gate"]')) && !!(await o.p.$("#puGame .pu-side")) && !(await o.p.$("#puMeta")), await txt(o.p, "#puGame"));
  await o.ctx.close();

  console.log("## qa: a touch phone's box-score numbers, and a one-word EA club name at phone and desktop width");
  o = await open("staff", "#/pickups/" + GID, { width: 390, touch: true });
  await until(o.p, () => document.querySelectorAll("#puRows .pu-n").length > 0);
  r = await o.p.evaluate(() => { const n = document.querySelector("#puRows .pu-n"), s = document.querySelector("#puRows .pu-sel"); return { n: n.getBoundingClientRect().height, nf: getComputedStyle(n).fontSize, s: s.getBoundingClientRect().height, sf: getComputedStyle(s).fontSize }; });
  A("qa (phone 4): on a touch phone a box-score number is a 44px target, and the member picker 44px at 16px", r.n >= 44 && r.s >= 44 && r.nf === "16px" && r.sf === "16px", r);
  await o.ctx.close();
  for (const w of [390, 1440]) {
    o = await open("anon", "#/pickups/" + GID, { width: w });
    o.H.db.games[0].club_a = "NorthsideBladesSeniorHockeyAssociation";
    await o.p.reload(); await until(o.p, () => /NorthsideBlades/.test((document.getElementById("puH1") || {}).textContent || ""));
    r = await o.p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, h1: Math.round(document.getElementById("puH1").getBoundingClientRect().right) }));
    A("qa (worst 6): a one-word EA club name breaks inside the headline at " + w + "px instead of widening the page", r.sw <= r.iw + 1 && r.h1 <= r.iw, r);
    await o.ctx.close();
  }

  console.log("## the commissioner holds the gate too; a failed gate read is said, not hidden; phone width");
  o = await open("commissioner", "#/pickups", { width: 375 });
  A("a commissioner gets the import (is_stats_staff says yes)", await until(o.p, () => !!document.getElementById("puQ")));
  A("at phone width the page does not scroll sideways", await o.p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), await o.p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]));
  await o.ctx.close();
  o = await open("member", "#/pickups");
  mock.respond(o.ctx, "rpc:is_stats_staff", Object.assign(mock.fail("57014", "upstream timed out"), { status: 503 }));
  await o.p.reload(); await o.p.waitForFunction(() => document.querySelector("#puRoot"));
  A("a gate the league did not answer is shown with Try again, and no control is offered", await until(o.p, () => /Couldn’t check your statistics access/.test((document.getElementById("puImp") || {}).textContent || "")) &&
    !!(await o.p.$('#puImp [data-pu="gate"]')) && !(await o.p.$("#puQ")), await txt(o.p, "#puImp"));
  await o.ctx.close();

  /* QA round 2 (A10): the pickup pages read through S2.rd (js/live.js), the one read door, and keep no copy of it */
  const puSrc = require("fs").readFileSync(require("path").join(S2_ROOT, "js/pages/pickups.js"), "utf8");
  A("qa2: pickups.js reads through S2.rd and keeps no read door of its own", /function rd\(q\) \{ return S2\.rd\(q\); \}/.test(puSrc) && !/r\.error\.message \|\| "The league did not answer\."/.test(puSrc) && !/S2\.ensureSb/.test(puSrc));

  A("no page error or console error across the whole run", errors.length === 0, errors.slice(0, 6));
  await b.close();
  console.log("\n" + n + " checks, " + fails + " failed");
  console.log(fails ? "FAIL (" + fails + ")" : "PASS");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
