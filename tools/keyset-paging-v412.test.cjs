#!/usr/bin/env node
/* v4.12 (2026-10-15). CG.sbAll paged by OFFSET, so when the importer deleted and re-inserted one game's box score (a
   re-filed or merged game) while a page was mid-read, every later row shifted: lines of games nobody touched were
   skipped or read twice, and the league pulse (which re-reads only the game it names) never healed them. The pulse's
   delta reads were unpaged and could be cut off at the API's 1000-row ceiling.
   This runs the real reader from src/live/part_live.js against a fake PostgREST that caps every response at 1000 rows
   and rewrites a game's box score between pages, exactly as ingest-stats does (DELETE, then POST with fresh ids). */
const fs = require("fs"), path = require("path"), vm = require("vm");
const live = fs.readFileSync(path.join(__dirname, "..", "src/live/part_live.js"), "utf8");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + JSON.stringify(got))); } };
const slice = (from, to) => { const i = live.indexOf(from), j = live.indexOf(to, i); if (i < 0 || j < 0) throw new Error("cannot find " + from); return live.slice(i, j); };
const fnSrc = (head) => { const i = live.indexOf(head); if (i < 0) throw new Error("cannot find " + head); return live.slice(i, live.indexOf("\n};\n", i) + 3); };

/* ---------- a seeded world ---------- */
let seed = 20261015;
const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const hex = (k) => { let s = ""; for (let i = 0; i < k; i++) s += Math.floor(rnd() * 16).toString(16); return s; };
const uuid = (prefix) => { const h = (prefix || "") + hex(32 - (prefix || "").length); return h.slice(0, 8) + "-" + h.slice(8, 12) + "-4" + h.slice(13, 16) + "-a" + h.slice(17, 20) + "-" + h.slice(20, 32); };
const SEASON = uuid(), CAP = 1000;

/* ---------- a fake PostgREST: filters, ORDER BY, LIMIT, the 1000-row ceiling, and a hook between requests ---------- */
function pgCmp(a, b){ if (a == null || b == null) return a == null && b == null ? 0 : (a == null ? 1 : -1); return typeof a === "number" ? a - b : (a < b ? -1 : a > b ? 1 : 0); }
function unq(v){ return /^".*"$/.test(v) ? v.slice(1, -1).replace(/\\(.)/g, "$1") : v; }
function splitTop(s){ const out = []; let d = 0, q = false, cur = ""; for (let i = 0; i < s.length; i++){ const c = s[i];
  if (c === "\\" && q){ cur += c + s[++i]; continue; } if (c === '"') q = !q; if (!q && c === "(") d++; if (!q && c === ")") d--;
  if (!q && d === 0 && c === ","){ out.push(cur); cur = ""; } else cur += c; } out.push(cur); return out; }
function orPred(expr){
  const items = splitTop(expr).map((it) => {
    if (it.startsWith("and(")) { const parts = splitTop(it.slice(4, -1)).map(orPred1); return (r) => parts.every((p) => p(r)); }
    return orPred1(it);
  });
  return (r) => items.some((p) => p(r));
}
function orPred1(it){ const m = it.match(/^([a-z_]+)\.(eq|gt|gte|lt|lte)\.(.*)$/); if (!m) throw new Error("fake cannot parse " + it);
  const [, col, op, raw] = m, v = unq(raw); return (r) => cmpOp(r[col], op, v); }
function cmpOp(x, op, v){ if (x == null) return false; const c = typeof x === "number" ? x - Number(v) : (String(x) < String(v) ? -1 : String(x) > String(v) ? 1 : 0);
  return op === "eq" ? c === 0 : op === "gt" ? c > 0 : op === "gte" ? c >= 0 : op === "lt" ? c < 0 : c <= 0; }
function makeDb(tables, hook){
  const st = { requests: 0, inFlight: 0, maxInFlight: 0, log: [] };
  function builder(name, rowsFn){
    const b = { preds: [], orders: [], lim: null, cols: "*", url: new URL("http://fake/rest/v1/" + name) };
    const add = (k, v, p) => { b.url.searchParams.append(k, v); b.preds.push(p); return b; };
    b.select = (c) => { b.cols = c || "*"; b.url.searchParams.set("select", b.cols); return b; };
    ["eq", "gt", "gte", "lt", "lte"].forEach((op) => { b[op] = (col, v) => add(col, op + "." + v, (r) => cmpOp(r[col], op, v)); });
    b.in = (col, vs) => add(col, "in.(" + vs.join(",") + ")", (r) => vs.indexOf(r[col]) >= 0);
    b.is = (col, v) => add(col, "is." + v, (r) => r[col] === v);
    b.or = (expr) => add("or", "(" + expr + ")", orPred(expr));
    b.order = (col, o) => { b.url.searchParams.append("order", col); b.orders.push([col, !o || o.ascending !== false]); return b; };
    b.limit = (k) => { b.url.searchParams.set("limit", String(k)); b.lim = k; return b; };
    b.range = (a, z) => { b.url.searchParams.set("offset", String(a)); b.off = a; return b.limit(z - a + 1); };
    b.then = (ok, bad) => {
      st.requests++; if (hook) hook(st.requests, b);
      st.log.push({ table: name, url: b.url.toString() });
      let rows = rowsFn().filter((r) => b.preds.every((p) => p(r)));
      if (b.orders.length) rows = rows.slice().sort((x, y) => { for (const [c, asc] of b.orders){ const d = pgCmp(x[c], y[c]); if (d) return asc ? d : -d; } return 0; });
      rows = rows.slice(b.off || 0, (b.off || 0) + Math.min(b.lim == null ? Infinity : b.lim, CAP));   /* max-rows truncates silently */
      if (b.cols !== "*"){ const keep = splitTop(b.cols).map((s) => s.trim()).filter((s) => /^[a-z_]+$/.test(s));
        rows = rows.map((r) => { const o = {}; keep.forEach((k) => { if (k in r) o[k] = r[k]; }); return o; }); }
      else rows = rows.map((r) => Object.assign({}, r));
      st.inFlight++; st.maxInFlight = Math.max(st.maxInFlight, st.inFlight);
      return new Promise((res) => setTimeout(() => { st.inFlight--; res({ data: rows, error: null }); }, 1)).then(ok, bad);
    };
    return b;
  }
  /* a count=exact head request, as the old reader made */
  const count = (t) => { st.requests++; if (hook) hook(st.requests); return (tables[t] || []).length; };
  return { st, count, client: { from: (t) => builder(t, () => tables[t] || []), rpc: (fn) => builder(fn, () => tables["rpc:" + fn] || []) } };
}

/* ---------- the code under test, straight from the page ---------- */
const reader = slice("/* v4.12: KEYSET READS.", "/* Columns of `profiles` the public league load may read.");
const slots = slice("CG.PROFILE_PUBLIC_COLS =", "CG.buildLiveLeague = async function");
function load(db){
  const errors = [];
  const ctx = { CG: { now: () => Date.parse("2026-10-15T23:00:00Z"), sb: db.client, SEASON: { id: SEASON } }, URL, Promise, Math, Date, JSON, Object, Array, String, Number,
    setTimeout, clearTimeout, console: { error: (m) => errors.push(m), warn(){}, log(){} }, localStorage: { getItem: () => null }, document: {}, window: {} };
  vm.createContext(ctx); vm.runInContext(reader + "\n" + slots, ctx);
  return { CG: ctx.CG, errors };
}
/* the reader this replaces, kept here to show the test catches what it got wrong */
async function offsetReader(db, table){
  const page = 1000, at = (a) => db.client.from(table).select("*").order("id", { ascending:true }).range(a, a + page - 1);
  const first = (await at(0)).data;
  if (first.length < page) return first;
  const total = db.count(table), reqs = [];                    /* one count, then every page at once */
  for (let s = page; s < total; s += page) reqs.push(at(s));
  return first.concat(...(await Promise.all(reqs)).map((r) => r.data));
}

/* a season of box scores: 13 lines a game, one per player, ids random like gen_random_uuid() */
function boxScores(games, opts){
  const rows = [], gameIds = [];
  for (let g = 0; g < games; g++){
    const gid = uuid(), home = uuid(), away = uuid(); gameIds.push(gid);
    for (let p = 0; p < 13; p++) rows.push({ id: uuid(g === 0 && opts && opts.lowFirst ? "000" : ""), game_id: gid, team_id: p < 7 ? home : away,
      ea_player_id: String(100000 + g * 20 + p), profile_id: uuid(), skater_name: "P" + p, season_id: SEASON, is_goalie: p === 6 || p === 12, goals: p % 3, gen: "old" });
  }
  return { rows, gameIds };
}
/* the importer re-files a game: DELETE its lines, then POST them again with fresh ids (ingest-stats, two requests) */
function refile(rows, gid){
  const old = rows.filter((r) => r.game_id === gid), keep = rows.filter((r) => r.game_id !== gid);
  return keep.concat(old.map((r) => Object.assign({}, r, { id: uuid(), goals: r.goals + 1, gen: "new" })));
}
const ids = (rows) => rows.map((r) => r.id);
const dupes = (arr) => arr.length - new Set(arr).size;

(async () => {
  console.log("— a whole table, read by key");
  {
    const { rows } = boxScores(240);                                   /* 3120 lines, four pages' worth */
    const db = makeDb({ game_stats: rows }), { CG } = load(db);
    const r = await CG.sbAll("game_stats", "*", "id");
    A("every one of 3120 lines comes back, once", !r.error && r.data.length === rows.length && dupes(ids(r.data)) === 0, r.error || r.data.length);
    A("...in key order", r.data.every((x, i) => i === 0 || r.data[i - 1].id < x.id));
    A("...from at most 8 requests (the old reader made 5: first page, count, three pages)", db.st.requests <= 8, db.st.requests);
    A("...and the key ranges after the first page are read at the same time", db.st.maxInFlight >= 3, db.st.maxInFlight);
    A("every request asks for the rows after a key, never an offset", db.st.log.slice(1).every((l) => /id=(gt|gte)\./.test(l.url)) && !db.st.log.some((l) => /offset=/.test(l.url)));
    const small = makeDb({ news: rows.slice(0, 40).map((x, i) => ({ id: x.id, published_at: i % 7 ? "2026-10-" + String(10 + (i % 5)).padStart(2, "0") + "T12:00:0" + (i % 10) + "+00:00" : null })) });
    const s = load(small);
    const nr = await s.CG.sbAll("news", "*", "published_at", false);
    A("a table under the ceiling is one request", small.st.requests === 1, small.st.requests);
    A("...and the caller's order is applied: newest first, nulls first (as Postgres does for DESC)",
      nr.data.slice(0, 6).every((x) => x.published_at === null) && nr.data.slice(6).every((x, i, a) => i === 0 || a[i - 1].published_at >= x.published_at));
  }

  console.log("— the row set changes between pages (a re-filed game)");
  {
    /* the defect, shown with the reader this replaces: the re-filed game's lines sat in the first page, the delete and
       insert landed before the later pages ran, and other games' lines shifted out of the read */
    const w = boxScores(240, { lowFirst: true }), G = w.gameIds[0];
    let tbl = w.rows.slice();
    const before = new Set(w.rows.filter((r) => r.game_id !== G).map((r) => r.id));
    const old = makeDb({ get game_stats(){ return tbl; } }, (k) => { if (k === 2) tbl = refile(tbl, G); });
    const got = await offsetReader(old, "game_stats");
    const untouchedSeen = got.filter((r) => before.has(r.id));
    A("(the old offset reader loses lines of games nobody touched)", untouchedSeen.length < before.size || dupes(ids(got)) > 0, { seen: untouchedSeen.length, of: before.size });

    tbl = w.rows.slice();
    const db = makeDb({ get game_stats(){ return tbl; } }, (k) => { if (k === 2) tbl = refile(tbl, G); });
    const { CG } = load(db);
    const raw = await CG.sbAll("game_stats", "*", "id", true, (qb) => qb.eq("season_id", SEASON));
    const seen = raw.data.filter((r) => before.has(r.id));
    A("keyset: every line of every untouched game comes back exactly once", seen.length === before.size && dupes(ids(seen)) === 0, seen.length);
    A("keyset: no row twice", dupes(ids(raw.data)) === 0);
    const gl = raw.data.filter((r) => r.game_id === G);
    A("(the re-filed game itself was caught in two states, old lines read before the delete and new ones after)",
      gl.some((r) => r.gen === "old") && gl.some((r) => r.gen === "new"), gl.map((r) => r.gen));
    const settled = await CG._settleStats(raw, SEASON);
    const sg = settled.data.filter((r) => r.game_id === G);
    A("...and is read again whole: one line per player, all from the re-filed box score",
      sg.length === 13 && sg.every((r) => r.gen === "new") && dupes(sg.map((r) => r.ea_player_id)) === 0, sg.map((r) => r.gen));
    A("...without touching the untouched games", settled.data.filter((r) => before.has(r.id)).length === before.size);
    /* v4.11 two-role lines: one player, one game, a skating line and an in-goal line (both indexes include is_goalie) */
    const two = boxScores(3), p0 = two.rows[0];
    two.rows.push(Object.assign({}, p0, { id: uuid(), is_goalie: true, goals: 0, saves: 9 }));
    const tdb = makeDb({ game_stats: two.rows }), T = load(tdb);
    const tr = await T.CG._settleStats({ data: two.rows.slice(), error: null }, SEASON);
    A("a player's skating line and in-goal line in one game are two lines, not a torn box score",
      tdb.st.requests === 0 && tr.data.length === two.rows.length && tr.data.filter((x) => x.ea_player_id === p0.ea_player_id).length === 2, tdb.st.requests);
    A("the line identity carries the role, as both unique indexes do", /var role = r\.is_goalie \? "G" : "S";/.test(live));
    A("the stats slot settles on its own (CG._statsLoad)", /\.then\(function\(r\)\{ return CG\._settleStats\(r, season\); \}\);/.test(live));
  }
  {
    /* 300 rewrites at random moments, of random games, in tables of random size */
    let offBad = 0, keyBad = 0, settledBad = 0;
    for (let t = 0; t < 300; t++){
      const w = boxScores(80 + Math.floor(rnd() * 240)), G = w.gameIds[Math.floor(rnd() * w.gameIds.length)], at = 2 + Math.floor(rnd() * 6);
      const before = new Set(w.rows.filter((r) => r.game_id !== G).map((r) => r.id));
      let tbl = w.rows.slice();
      const o = makeDb({ get game_stats(){ return tbl; } }, (k) => { if (k === at) tbl = refile(tbl, G); });
      const og = await offsetReader(o, "game_stats");
      if (og.filter((r) => before.has(r.id)).length !== before.size || dupes(ids(og))) offBad++;
      tbl = w.rows.slice();
      const k = makeDb({ get game_stats(){ return tbl; } }, (q) => { if (q === at) tbl = refile(tbl, G); }), { CG } = load(k);
      const r = await CG._statsLoad(SEASON);
      const seen = r.data.filter((x) => before.has(x.id));
      if (seen.length !== before.size || dupes(ids(r.data))) keyBad++;
      const lines = r.data.map((x) => x.game_id + "|" + x.team_id + "|" + x.is_goalie + "|" + x.ea_player_id);
      if (dupes(lines)) settledBad++;
    }
    A("300 random rewrites: the old reader got untouched games wrong in some", offBad > 0, offBad);
    A("...the keyset reader returned every untouched line exactly once in all 300", keyBad === 0, keyBad);
    A("...and no player's line was ever shown twice", settledBad === 0, settledBad);
  }

  console.log("— other keys");
  {
    const ppo = []; for (let i = 0; i < 1300; i++){ const p = uuid(); ["F", "D", "G"].forEach((c, j) => { if (j < 2 || i % 3 === 0) ppo.push({ profile_id: p, pos_cat: c, overall: 60 + (i % 30), gp: i % 9, headline: j === 0 }); }); }
    const db = makeDb({ player_position_overalls: ppo }), { CG } = load(db);
    const r = await CG._posOvrLoad();
    const k = (x) => x.profile_id + x.pos_cat;
    A("a two-column key (profile_id, pos_cat) pages past the ceiling, every rating once", !r.error && r.data.length === ppo.length && dupes(r.data.map(k)) === 0, r.error || r.data.length);
    A("...walking k1 > v1, or k1 = v1 and k2 > v2", db.st.log.length > 2 && db.st.log.slice(1).every((l) => /or=\(profile_id\.gt\."[0-9a-f-]+",and\(profile_id\.eq\."[0-9a-f-]+",pos_cat\.gt\."[A-Z]"\)\)/.test(decodeURIComponent(l.url))), db.st.log[1] && decodeURIComponent(db.st.log[1].url));
    const flags = []; for (let i = 0; i < 2300; i++) flags.push({ key: "home_mod_" + String(i).padStart(5, "0"), enabled: i % 2 === 0 });
    const f = makeDb({ feature_flags: flags }), L = load(f);
    const fr = await L.CG.sbAll("feature_flags", "key,enabled", null, true, null, { key: "key" });
    A("a text key is walked one page after another", !fr.error && fr.data.length === 2300 && f.st.requests === 3, f.st.requests);
    const pool = []; for (let i = 0; i < 2600; i++) pool.push({ id: uuid(), profile_id: uuid(), season_id: SEASON, status: "pending", position: "C", created_at: "2026-10-01T00:00:00+00:00", gamertag: "g" + i, ea_id: "e" + i });
    const rp = makeDb({ "rpc:registration_pool": pool }), R = load(rp);
    const rr = await R.CG.sbAllRpc("registration_pool", null, "id");
    A("a set-returning function pages by key too", !rr.error && rr.data.length === 2600 && dupes(ids(rr.data)) === 0, rr.error || rr.data.length);
    const av = makeDb({ availability: pool.slice(0, 1200).map((x, i) => ({ id: x.id, profile_id: x.profile_id, week_key: "w" + (i % 9), season_id: SEASON, nights: {} })) }), V = load(av);
    const vr = await V.CG.sbAll("availability", "profile_id,week_key,nights", "week_key", true, (qb) => qb.eq("season_id", SEASON));
    A("a select without the key gets it added, so it can still page", !vr.error && vr.data.length === 1200 && vr.data.every((x) => x.id), vr.error || vr.data.length);
  }

  console.log("— what a keyset read refuses, out loud");
  {
    const db = makeDb({ draft_picks: [] }), { CG } = load(db);
    const a = await CG.sbAll("draft_picks", "*", null, true, (qb) => qb.order("season_number"));
    A("a filter that orders the rows is refused (the order goes in orderCol)", a.error && a.error.code === "CG_KEYSET" && a.data === null, a.error);
    const b = await CG.sbAll("draft_picks", "*", null, true, (qb) => qb.limit(10));
    A("a filter with a limit is refused", b.error && b.error.code === "CG_KEYSET");
    const c = await CG.sbAll("x", "*", null, true, (qb) => qb.or("a.eq.1,b.eq.2"), { key: ["a", "b"] });
    A("a two-column key with its own or() is refused", c.error && c.error.code === "CG_KEYSET");
    A("...and none of them sent a request", db.st.requests === 0, db.st.requests);
    const cap = makeDb({ teams: boxScores(80).rows }), C = load(cap);
    const t = await C.CG.sbCapped(cap.client.from("teams").select("*"), "teams");
    A("an unpaged read that comes back at the ceiling fails loudly", t.error && t.error.code === "CG_ROW_CAP" && t.data === null && C.errors.length === 1, t.error);
    const ok = await C.CG.sbCapped(Promise.resolve({ data: new Array(999).fill({}), error: null }), "x");
    A("...and one under it passes untouched", !ok.error && ok.data.length === 999);
  }

  console.log("— the order the caller asked for");
  {
    const { CG } = load(makeDb({}));
    const rows = [{ id: "a", s: 2, r: 1 }, { id: "b", s: 1, r: 2 }, { id: "c", s: 1, r: 1 }, { id: "d", s: null, r: 1 }, { id: "e", s: 1, r: 1 }];
    A("season then round, ties in key order, nulls last ascending", CG._sortRows(rows, ["s", "r"], true, ["id"]).map((x) => x.id).join("") === "cebad");
    A("descending puts nulls first", CG._sortRows(rows, "s", false, ["id"]).map((x) => x.id).join("") === "dabce");
    A("timestamps sort by their text, fractions included", CG._sortRows([{ id: 1, t: "2026-10-14T15:14:50.348+00:00" }, { id: 2, t: "2026-10-14T15:14:50+00:00" }, { id: 3, t: "2026-10-14T15:14:50.35+00:00" }], "t", true, ["id"]).map((x) => x.id).join("") === "213");
  }

  console.log("— every list the league pulse re-reads");
  {
    const big = (mk) => { const o = []; for (let i = 0; i < 2500; i++) o.push(mk(i)); return o; };
    const tables = {
      teams: big((i) => ({ id: uuid(), code: "T" + i })),
      divisions: big((i) => ({ id: uuid(), sort_order: i % 4 })),
      seasons: big((i) => ({ id: uuid(), number: i })),
      profiles: big(() => ({ id: uuid(), gamertag: "x" })),
      roster_spots: big(() => ({ id: uuid() })), contracts: big(() => ({ id: uuid() })),
      games: big((i) => ({ id: uuid(), scheduled_at: "2026-10-1" + (i % 10) + "T01:00:00+00:00" })),
      transactions: big((i) => ({ id: uuid(), occurred_at: "2026-10-0" + (i % 10) + "T01:00:00+00:00" })),
      news: big(() => ({ id: uuid(), published_at: "2026-10-01T01:00:00+00:00" })),
      draft_picks: big((i) => ({ id: uuid(), season_number: 1 + (i % 9), round: 1 + (i % 14) })),
      "rpc:registration_pool": big(() => ({ id: uuid(), profile_id: uuid() })),
      leagues: big((i) => ({ id: uuid(), sort_order: i })),
      game_stats: boxScores(193).rows.slice(0, 2500),
      feature_flags: big((i) => ({ key: "f" + String(i).padStart(4, "0"), enabled: true })),
      site_config: big((i) => ({ key: "c" + String(i).padStart(4, "0"), value: {} })),
      suspension_record: big(() => ({ id: uuid(), created_at: "2026-10-01T01:00:00+00:00" })),
      awards: big((i) => ({ id: uuid(), week: i % 12 })),
      player_position_overalls: big(() => ({ profile_id: uuid(), pos_cat: "F", overall: 70, gp: 3, headline: true })),
      "rpc:career_games_played": big(() => ({ profile_id: uuid(), gp: 4 })),
      games_public: big(() => ({ id: uuid(), scheduled_at: "2026-10-16T01:00:00.000Z", game_code: "123456", server: "NA Central" }))
    };
    const db = makeDb(tables), { CG, errors } = load(db);
    const loaders = CG._bootLoaders(SEASON);
    const res = await Promise.all(loaders.map((f) => f()));
    const BOUNDED = [0];          /* the clubs keep the database's order: eight rows, bounded, loud at the ceiling */
    const bad = [];
    res.forEach((r, i) => {
      if (BOUNDED.indexOf(i) >= 0){ if (!(r.error && r.error.code === "CG_ROW_CAP")) bad.push(i + " should fail loudly"); }
      else if (r.error || !r.data || r.data.length !== 2500) bad.push(i + ": " + (r.error ? r.error.message : r.data && r.data.length));
    });
    A("all " + loaders.length + " boot slots: every one pages past the ceiling or fails loudly", bad.length === 0, bad);
    A("...and the loud one said so in the console", errors.some((e) => /teams came back at the 1000-row API limit/.test(e)));
    const ordered = res[9].data.every((x, i, a) => i === 0 || a[i - 1].season_number < x.season_number || (a[i - 1].season_number === x.season_number && a[i - 1].round <= x.round));
    A("the draft picks still come season, then round", ordered);
    A("the seasons still come newest first", res[2].data.every((x, i, a) => i === 0 || a[i - 1].number > x.number));

    /* the pulse names 120 games: their box scores are re-read by key in chunks of 50 games and merged */
    const named = tables.game_stats.map((r) => r.game_id).filter((g, i, a) => a.indexOf(g) === i).slice(0, 120);
    const cache = res.slice(); cache[0] = { data: [], error: null };
    tables.game_stats = tables.game_stats.map((r) => named.indexOf(r.game_id) >= 0 ? Object.assign({}, r, { id: uuid(), gen: "new" }) : r);
    db.st.log.length = 0;
    const q = await CG._deltaSlots(cache, { slots: [], statsIds: named }, SEASON);
    const lines = q[12].data, renamed = lines.filter((r) => named.indexOf(r.game_id) >= 0);
    A("a pulse naming 120 games merges every one of their lines, fresh, and keeps the rest", !CG._deltaFailed && lines.length === 2500 && renamed.length > 1000 && renamed.every((r) => r.gen === "new"), CG._deltaFailed || [lines.length, renamed.length]);
    const inLists = db.st.log.filter((l) => /game_stats/.test(l.url)).map((l) => (decodeURIComponent(l.url).match(/game_id=in\.\(([^)]*)\)/) || [, ""])[1].split(",").length);
    A("...in requests naming at most 50 games each, scoped to the season", inLists.length >= 3 && inLists.every((k) => k <= 50) && db.st.log.every((l) => /season_id=eq\./.test(l.url)), inLists);
  }

  console.log("— no raw read left on the pulse's path");
  {
    const pulsePath = ["CG._bootLoaders = function", "CG._deltaBoot = async function", "CG._deltaSlots = async function", "CG._codesToday = function",
      "CG._statsForGames = async function", "CG.loadManagerData = async function", "CG.refreshDraftLite = function", "CG.loadSpectatorDraft = async function"];
    const raw = [];
    pulsePath.forEach((h) => {
      const src = fnSrc(h).replace(/\/\*[\s\S]*?\*\//g, "");
      (src.match(/[^\n]*\bsb\.from\([^\n]*/g) || []).forEach((line) => {
        if (/CG\.sbCapped\(\s*(CG\.)?sb\.from\(/.test(line) || /\.maybeSingle\(\)/.test(line)) return;
        raw.push(h.split(" ")[0] + ": " + line.trim().slice(0, 90));
      });
      (src.match(/[^\n]*\bsb\.rpc\("([a-z_]+)"[^\n]*/g) || []).forEach((line) => { if (!/resolve_game_server/.test(line)) raw.push(h.split(" ")[0] + ": " + line.trim().slice(0, 90)); });
      if (/\.limit\(\d+\)/.test(src)) raw.push(h.split(" ")[0] + ": a fixed .limit() window");
    });
    A("every read the pulse triggers goes through CG.sbAll, CG.sbAllRpc or CG.sbCapped", raw.length === 0, raw);
  }

  console.log(fail ? `\n${fail} of ${n} FAILED` : `\nALL ${n} PASSED`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("FAIL threw " + (e && e.stack || e)); process.exit(1); });
