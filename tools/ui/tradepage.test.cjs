const S2_BASE = process.env.S2_BASE || (() => { throw new Error("S2_BASE unset: run through tools/ui/run.cjs") })();
/* The Team HQ trade page, proved on the real site: node tools/ui/run.cjs --suite tradepage --mode live
   (every context opts in with live: true, so any mode runs it).
   Commissioner, 2026-11-03: "instead of the trade page being a pop-up, can you integrate it into the entire page to be able
   to show more in-depth stats and lines? I want the trade page to show teams as much valuable info as possible in order to
   make the best decision." The builder is #/trade (js/pages/tradebuild.js). The page runs as the site build ships it
   (tools/ui/mock, h0's live mode): supabase-js signs in as each persona (the gm persona seated, through install's session
   option, as GM or Owner at the proposing club, the receiving club or a third club; staff; a member; the commissioner
   previewing a club), the league is the recorded Season 1 (?season=1: its eight clubs and their rosters), the offers are
   a trades table answered as RLS would (a reader sees a row only when their seat is one of its two clubs, or they are
   staff or a commissioner), and every door is answered by the write mock from that same table, so the read after a write
   sees what the write did. Nothing reaches Supabase, Netlify or Discord.
   Proves, the builder: every trade door opens the page and never a sheet; the picks live in the address; the match
   center, the tray, the full reading, the lineups and the send all follow a pick in place (no re-render, the bar element
   kept); the reading on the page is S2.trade.evaluate's; the accent in every bar means what you get; the lineup is the
   best six by rating at each spot; a seat holder can't be ticked; a phone shows one roster at a time with no sideways
   scroll. The doors: the exact door and arguments of every trade action (propose, counter, accept, decline, withdraw,
   reverse, resend, the trade block), Owner approval passed on every club door and on none of the league office's, a move
   the database sends to the Owner said as sent to the Owner, nothing said as done before the database answers, a refusal
   (the movement deadline, the Season 2 minimums, a reversal that can no longer run) shown in the database's own words
   with the picks, the note and the reason kept, the page read back after each write, repaint in place on the pulse with
   the note kept, a staffer who reads an offer but answers nothing, and an offer that never reaches a member or a third
   club. Deleted with demo mode (i3c, 2026-11-25), each pinning only the demo engine: the demo's sample listings never
   drawn as the league's (no sample is seeded now), Propose returning to Trades and Counter marking the offer
   "countered" (the real doors open the new offer and decline the old one, both checked), an offer row in Team HQ
   opening the page (Team HQ's real offer rows answer in place), a demo sample offer's id asked for, and the dock's
   role switch onto the lock (the member persona meets it). */
const mock = require(process.env.S2_MOCK);
const { chromium } = require(mock.PW);
let fails = 0;
const A = (name, cond, more) => { console.log((cond ? "PASS " : "FAIL ") + name + (cond || more == null ? "" : "  (" + more + ")")); if (!cond) fails++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const LEAGUE = mock.league({ p_season: 1 }), TID = {}; LEAGUE.teams.forEach((t) => { TID[t.code] = t.id; });
const SID = LEAGUE.seasons.filter((s) => s.number === 1)[0].id;
const OFFICE = { team_mgmt_policy: [], team_mgmt_moves: [], management_applications: [], club_notices: [], action_requests: [], action_messages: [], game_lineups: [], availability: [], market_pool_requests: [], team_lines: [], team_line_plan: [], game_vetoes: [], games_public: [] };
const PEND = "00000000-0000-4000-8000-00000000a001", INC = "00000000-0000-4000-8000-00000000a002", INC2 = "00000000-0000-4000-8000-00000000a003",
  ACC = "00000000-0000-4000-8000-00000000a004", DEC = "00000000-0000-4000-8000-00000000a005", NOTE = "A private note between two front offices";
const TRADES = [{ id: PEND, from: "DET", to: "BOS", note: NOTE }, { id: INC, from: "DET", to: "BOS", skip: 1 }, { id: INC2, from: "DET", to: "BOS", skip: 2 },
  { id: ACC, from: "DET", to: "BOS", status: "accepted", skip: 3 }, { id: DEC, from: "DET", to: "BOS", status: "declined", skip: 4 }];

(async () => {
  const b = await chromium.launch(), errs = [];
  let H = null, seq = 0;
  const uuid = () => "00000000-0000-4000-8000-" + String(++seq).padStart(12, "0");
  /* what the database does when a door lets a write through: the trades table changes as the real doors change it */
  function apply(rpc, a) {
    const T = H.T, by = (id) => T.filter((x) => x.id === id)[0], now = new Date().toISOString();
    if (rpc === "trades.insert") { const id = uuid(); T.push(Object.assign({ id, status: "proposed", note: null, created_at: now, updated_at: now }, a.row)); return mock.ok([{ id }]); }
    if (rpc === "trades.update") { const hit = T.filter((x) => Object.keys(a.match).every((k) => x[k] === a.match[k])); if (!hit.length) return mock.fail("S2_NO_ROWS", "Nothing was saved."); hit.forEach((x) => Object.assign(x, a.set)); return mock.ok(hit.map((x) => ({ id: x.id }))); }
    if (rpc === "accept_trade") { by(a.p_trade).status = "accepted"; return mock.ok(null); }
    if (rpc === "reverse_trade") { by(a.p_trade).status = "reversed"; return mock.ok(null); }
    if (rpc === "resend_trade") { const t = by(a.p_trade), id = uuid(); T.push(Object.assign({}, t, { id, status: "proposed", note: "Resent by the league office" })); return mock.ok(id); }
    if (rpc === "roster_spots.update") return mock.ok([{ id: "rs-1" }]);
    return mock.fail("STUB", "no door " + rpc);
  }
  /* opens the page as `who` (gm or owner seated at club c; staff; member; commissioner previewing c), with the offers on file;
     o.season: the season on screen (1, the recorded Season 1, unless a check needs the recorded Season 2) */
  async function open(who, c, hash, o) {
    o = Object.assign({ vp: { width: 1280, height: 900 } }, o);
    const ctx = await b.newContext({ viewport: o.vp });
    const office = who === "staff" || who === "commissioner", sees = office ? null : who === "member" ? [] : [TID[c]];
    H = { ctx, T: [], R: [], answers: {}, delay: 0, noIds: H && H.noIds };
    const writes = {};
    ["trades.insert", "trades.update", "accept_trade", "reverse_trade", "resend_trade", "roster_spots.update"].forEach((k) => { writes[k] = async (args) => {
      if (H.delay) await wait(H.delay);
      const s = H.answers[k]; if (s) { delete H.answers[k]; return s; }   /* a scripted answer (a refusal, or the Owner's queue) wins once */
      return apply(k, args);
    }; });
    const trades = (q) => { H.R.push({ t: "trades", f: q.filters.slice() }); return H.T.filter((x) => !sees || sees.indexOf(x.from_team_id) >= 0 || sees.indexOf(x.to_team_id) >= 0); };
    await mock.install(ctx, { live: true, persona: who === "owner" ? "gm" : who, session: who === "gm" || who === "owner" ? { teamId: TID[c], seat: who === "owner" ? "owner" : "gm" } : undefined,
      writes, tables: Object.assign({ trades }, OFFICE),
      /* QA core 2026-11-25: js/trade.js sends only for the current season (never from an archive on screen), so the
         recorded Season 1 this suite trades in is made the current season, as a live season would be */
      rpcs: { s2_league: (a) => { const lb = mock.league(a); if (o.season !== 2) (lb.seasons || []).forEach((x) => { if (x.number === 1) x.status = "active"; }); return mock.ok(lb); } } });
    /* main session 2026-11-25 (release check): only while Season 1 is the season on screen. The Season 2 check (qa-club,
       open(..., {season: 2})) needs Season 1 closed as it is on production, or the world has two current seasons, Season 1
       has no off-season, and Today says loudly that Season 2 has no titles to show (it failed "no console errors"). */
    await ctx.addInitScript((q) => { try { localStorage.setItem("s2.introSeen", "true"); localStorage.setItem("s2.survey", JSON.stringify({ done: "2026-11-24T00:00:00.000Z", from: "daily" }));
      if (q.preview) localStorage.setItem("s2.previewClub", JSON.stringify(q.preview)); } catch (e) {} }, { preview: who === "commissioner" ? c : null });
    const p = await ctx.newPage();
    p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|^S2\.market:/.test(m.text())) errs.push(m.text()); });
    p.on("pageerror", (e) => errs.push("pageerror: " + e.message));
    await p.goto(S2_BASE + "?season=" + (o.season || 1) + "#/today", { waitUntil: "domcontentloaded" });
    await p.waitForFunction(() => window.S2 && S2.M && S2.trade && S2.trade.door && S2.auth && S2.auth.sub && document.querySelector("#page") && (document.querySelector("#page") || { children: [] }).children.length > 0, null, { timeout: 20000 });
    /* i3c, 2026-11-25, a defect found converting this suite: js/trade.js finds a club's teams.id as M.team(code).id
       (teamId, codeOfId), and the model's clubs carry no id on the real site (js/model.js line 137 builds M.teams without
       it), so every trade door and every offer read refuses ("The league data carries no id for ..."). The old suite set
       the ids by hand and hid it. It is checked at the end (and fails until js/trade.js reads S2.lobby.teamId, the one
       definition, or the model carries the id); the ids are then put on the model here so the page's own behavior is
       still proved */
    H.noIds = H.noIds || await p.evaluate(() => S2.M.teams.filter((t) => !t.id).map((t) => t.code));
    await p.evaluate(() => { (S2.data.body.teams || []).forEach((row) => { const t = S2.M.team(row.code); if (t && !t.id) t.id = row.id; }); });
    /* the toasts and every write's options, recorded as the page passes them (core's S2.write wrapped; the mock still answers) */
    const ids = await p.evaluate(() => {
      window.__toasts = []; window.__opts = [];
      const t0 = S2.toast; S2.toast = function (m, k) { window.__toasts.push((k || "") + ":" + String(m)); return t0.apply(this, arguments); };
      const w0 = S2.write; S2.write = function (rpc, args, opts) { window.__opts.push({ rpc, action: (opts && opts.action) || null, queueArgs: (opts && opts.queueArgs) ? JSON.parse(JSON.stringify(opts.queueArgs)) : null, sections: (opts && opts.sections) || [] }); return w0.apply(this, arguments); };
      const ids = (c) => S2.M.roster(c).active.filter((p) => !p.seat).map((p) => p.id);
      return { DET: ids("DET"), BOS: ids("BOS") };
    });
    const at = (h) => new Date(Date.now() - h * 3600000).toISOString();
    H.ids = ids;
    H.T = TRADES.map((x) => ({ id: x.id, season_id: SID, from_team_id: TID[x.from], to_team_id: TID[x.to], from_profile_id: "u-" + x.from, offered_profile_ids: [ids[x.from][x.skip || 0]],
      requested_profile_ids: [ids[x.to][x.skip || 0]], offered_pick_ids: [], requested_pick_ids: [], note: x.note || null, status: x.status || "proposed", created_at: at(3), updated_at: at(1) }));
    await p.evaluate((hh) => { location.hash = hh; }, hash);
    await wait(600);
    return { ctx, p };
  }
  const calls = () => mock.calls(H.ctx).map((k) => ({ rpc: k.rpc, args: k.args, approval: k.approval }));
  const opts = (x) => x.p.evaluate(() => window.__opts.slice());
  const script = (rpc, a) => { H.answers[rpc] = a; };
  const toasts = (x) => x.p.evaluate(() => window.__toasts.slice());
  const okToast = (x) => x.p.evaluate(() => window.__toasts.filter((t) => /^ok:/.test(t)).pop() || "");
  const go = async (x, hh) => { await x.p.evaluate((q) => { location.hash = q; }, hh); await wait(600); };
  const confirmSheet = (x) => x.p.click('.sheet [data-cf="ok"]');
  /* the trade page's own answer sheets, and the site's one reversal and resend doors (js/flows.js, gaps 2026-11-25) */
  const sheetErr = (x) => x.p.evaluate(() => { const e = [...document.querySelectorAll(".sheet .tp-cf-err, .sheet [data-rv-err], .sheet [data-rs-err]")].pop(); return e ? e.textContent : null; });
  const h = (x) => x.p.evaluate(() => { const s = document.querySelector("#tpSend .sec-head h2"); return s ? s.textContent : ""; });
  const acts = (x) => x.p.evaluate(() => [...document.querySelectorAll("#tpSend .tp-acts .btn")].map((e) => e.dataset.act));
  const readOf = (id) => H.R.filter((r) => r.t === "trades" && r.f.some((f) => f[0] === "id" && f[1] === "eq." + id));
  const DEADLINE = "Roster moves are locked: the trade deadline has passed.";
  const MINIMUM = "Season 2 roster minimums: this would leave the club under its minimum of 2 defense players (Rule S2.4).";
  const STALE = "This trade can no longer be reversed cleanly: a player in it has already moved to another club. Undo that move first.";
  const WHY = "A lopsided giveaway between allied clubs, not a natural deal";
  let x, r, c;

  console.log("## the builder: doors, picks and the reading (a GM at Detroit)");
  x = await open("gm", "DET", "#/hq?tab=trades");
  const p = x.p;
  await p.click('[data-w="troffers"] .btn[data-flow="trade"]'); await p.waitForSelector(".tp");
  const d1 = await p.evaluate(() => ({ hash: location.hash, sheet: !!document.querySelector(".sheet"), h1: document.querySelector(".tp h1").textContent, mode: document.documentElement.dataset.mode,
    clubs: [...document.querySelectorAll(".tp-club")].map((x) => x.dataset.v), here: document.querySelector('#navbar [data-here~="trade"]')?.getAttribute("aria-current") }));
  A("Build a trade opens the page, not a sheet", d1.hash === "#/trade" && !d1.sheet && d1.h1 === "Build a trade" && d1.mode === "app", JSON.stringify(d1));
  A("the partner rail lists the seven other clubs", d1.clubs.length === 7 && d1.clubs.indexOf("DET") < 0, d1.clubs.join(","));
  A("the header lights Team HQ on the trade page", d1.here === "true", d1.here);
  const door = await p.evaluate((pend) => {
    const oth = S2.M.roster("VAN").active.find((x) => !x.seat), det = S2.M.roster("DET").active.find((x) => !x.seat);
    return { get: S2.tradePage.href({ player: oth.id }), send: S2.tradePage.href({ player: det.id }), counter: S2.tradePage.href({ counter: pend }), othId: oth.id, detId: det.id };
  }, PEND);
  A("a player door starts with that player on the right side", door.get === "#/trade?with=VAN&get=" + door.othId && door.send === "#/trade?send=" + door.detId, door.get + " " + door.send);
  A("a counter door names the offer", door.counter === "#/trade?counter=" + PEND, door.counter);

  /* audit 2026-11-09: the trade page lists the ACTIVE roster only */
  await p.click('.tp-club[data-v="BOS"]');
  const ids = await p.evaluate(() => ({ me: S2.M.roster("DET").active.filter((x) => !x.seat).map((x) => x.id), them: S2.M.roster("BOS").active.filter((x) => !x.seat).map((x) => x.id), seat: S2.M.roster("BOS").active.find((x) => x.seat) }));
  const me = ids.me[0], them = ids.them[0];
  await p.evaluate(() => { window.__band = document.querySelector('[data-w="mmid"] .tr-bar-a'); window.__page = document.querySelector(".tp"); });
  await p.click(`.tp-tick[data-side="me"][data-pid="${me}"]`); await p.click(`.tp-tick[data-side="them"][data-pid="${them}"]`);
  const pk = await p.evaluate(([me, them]) => {
    const ev = S2.trade.evaluate({ from: "DET", to: "BOS", send: [me], get: [them] });
    return { hash: location.hash, samePage: window.__page === document.querySelector(".tp"), verdict: document.querySelector(".tp-m-verdict b").textContent, want: S2.trade.verdict(ev, "DET"),
      vSend: document.querySelector('[data-w="mv-me"]').textContent, vGet: document.querySelector('[data-w="mv-them"]').textContent, rec: ev.receives,
      bar: document.querySelector('[data-w="mmid"] .tr-bar-a').style.transform, origin: getComputedStyle(document.querySelector('[data-w="mmid"] .tr-bar-a')).transformOrigin,
      read: !!document.querySelector('[data-w="read"] [data-tr]'), readVerdict: document.querySelector('[data-w="read"] .tr-verdict b')?.textContent,
      lists: [...document.querySelectorAll('[data-w="ml-me"] li, [data-w="ml-them"] li')].map((li) => li.dataset.pid), pressed: [...document.querySelectorAll('.tp-tick[aria-pressed="true"]')].map((t) => t.dataset.pid),
      send: document.querySelector('#tpSend [data-act="propose"]').getAttribute("aria-disabled"), tray: document.querySelector(".tp-tray .tp-tray-v b").textContent };
  }, [me, them]);
  A("the picks are in the address", pk.hash === `#/trade?with=BOS&send=${me}&get=${them}`, pk.hash);
  A("a pick repaints in place, never the page", pk.samePage);
  A("the match center's verdict is the reading's (S2.trade.evaluate)", pk.verdict === pk.want && pk.readVerdict === pk.want && pk.tray === pk.want, pk.verdict + " / " + pk.readVerdict + " / " + pk.want);
  A("the send and get totals are the value each club receives", +pk.vSend === pk.rec.BOS && +pk.vGet === pk.rec.DET, pk.vSend + "/" + pk.vGet + " " + JSON.stringify(pk.rec));
  const sh = pk.rec.DET / (pk.rec.DET + pk.rec.BOS);
  A("the accent fills what you get, from the right under the You get column", pk.bar === "scaleX(" + sh.toFixed(4) + ")" && /^\d+(\.\d+)?px /.test(pk.origin) && parseFloat(pk.origin) > 100, pk.bar + " " + pk.origin);
  A("the full reading opens once both sides have a player", pk.read);
  A("both picks sit in the match center and stay ticked", pk.lists.join() === [me, them].join() && pk.pressed.sort().join() === [me, them].sort().join(), pk.lists.join());
  A("the send opens once both sides have a player", pk.send === null, String(pk.send));
  const kept = await p.evaluate(() => window.__band === document.querySelector('[data-w="mmid"] .tr-bar-a') || document.querySelector('[data-w="mmid"] .tr-bar-a').style.transform !== "");
  A("the bar keeps a transform to glide from", kept);
  if (ids.seat) {
    await p.click(`.tp-tick[data-pid="${ids.seat.id}"]`, { force: true });   /* aria-disabled: the page must still say why on a press */
    const st = await p.evaluate((id) => ({ hash: location.hash, dis: document.querySelector(`.tp-tick[data-pid="${id}"]`).getAttribute("aria-disabled"), toast: document.querySelector(".toast")?.textContent || "" }), ids.seat.id);
    A("a seat holder can't be ticked, and the page says why", st.dis === "true" && st.hash.indexOf(ids.seat.id) < 0 && /can't be traded \(Rule 2\.6\)/.test(st.toast), st.toast);
  }
  const opened = await p.evaluate(() => {
    const L = S2.M.roster("DET").active.find((x) => S2.trade.playerEval(x.id).ranks.filter((r) => r.score != null).length >= 3); const b = document.querySelector(`.tp-name[data-pid="${L.id}"]`); b.click();
    const row = document.getElementById("tpMore-" + L.id);
    return { open: !row.hidden && b.getAttribute("aria-expanded") === "true", ranks: row.querySelectorAll(".tr-pc").length, cats: row.querySelectorAll(".tp-cats div").length, profile: !!row.querySelector('a[href="' + L.href + '"]'),
      same: row.querySelector(".tr-p-body").innerHTML === (() => { const t = document.createElement("div"); t.innerHTML = S2.trade.playerBody(S2.trade.playerEval(L.id)); return t.querySelector(".tr-p-body").innerHTML; })() };
  });
  A("an opened player shows rating parts, ranks and a profile link", opened.open && opened.ranks >= 3 && opened.cats >= 3 && opened.profile, JSON.stringify(opened));
  A("its numbers are the reading's own player block (S2.trade.playerBody)", opened.same);
  const sorted = await p.evaluate(async () => {
    const cell = () => [...document.querySelectorAll('[data-w="tbl-them"] table[data-unit="F"] tbody tr.tp-row td.tp-val')].map((td) => +td.textContent);
    document.querySelector('[data-w="tbl-them"] table[data-unit="F"] [data-k="val"]').click(); const a = cell();
    document.querySelector('[data-w="tbl-them"] table[data-unit="F"] [data-k="val"]').click(); const z = cell();
    document.querySelector('[data-w="tbl-them"] table[data-unit="F"] [data-k=""]').click();
    return { a, z };
  });
  const isDesc = (q) => q.every((v, i) => !i || q[i - 1] >= v), isAsc = (q) => q.every((v, i) => !i || q[i - 1] <= v);
  A("Value sorts best first, then the other way", sorted.a.length > 3 && isDesc(sorted.a) && isAsc(sorted.z), sorted.a.slice(0, 4).join(",") + " / " + sorted.z.slice(0, 4).join(","));
  const lu = await p.evaluate(() => {
    const R = S2.M.roster("DET"), best = R.active.filter((x) => x.pos === "G").map((x) => { const r = S2.M.ratings(x.id).find((y) => y.pos === "G"); return r ? r.ovr : S2.trade.tradeValue(x.id).overall; });
    const g = [...document.querySelectorAll(".tp-lu")][0].querySelector(".tp-rk-row.g .tp-slot-r");
    return { g: g && +g.textContent, best: Math.max.apply(null, best), slots: document.querySelectorAll(".tp-lu .tp-slot").length };
  });
  A("each lineup has six spots, and goal holds the best-rated goaltender", lu.slots === 12 && lu.g === lu.best, JSON.stringify(lu));
  const lu2 = await p.evaluate(() => {
    const c = [...document.querySelectorAll(".tp-lu")][0].querySelectorAll(".tp-rk-row.f .tp-slot")[1], tag = c.querySelector(".tp-slot-n").textContent;
    const pl = S2.M.roster("DET").active.find((x) => x.tag === tag); document.querySelector(`.tp-tick[data-side="me"][data-pid="${pl.id}"]`).click();
    const c2 = [...document.querySelectorAll(".tp-lu")][0].querySelectorAll(".tp-rk-row.f .tp-slot")[1];
    return { tag, isNew: c2.classList.contains("is-new"), was: c2.querySelector(".tp-slot-was")?.textContent || "", head: document.querySelector('[data-w="luh"]').textContent };
  });
  A("sending a lineup player highlights the spot and names who it was", lu2.isNew && lu2.was.indexOf("Was " + lu2.tag) === 0 && /Detroit goes from/.test(lu2.head), JSON.stringify(lu2));
  const cmp = await p.evaluate(() => {
    const row = [...document.querySelectorAll(".tp-cmp tbody tr")].find((r) => r.querySelector("th").textContent === "Goals against a game"), td = row.querySelectorAll("td");
    return { a: +td[0].textContent, b: +td[1].textContent, la: td[0].classList.contains("lead"), lb: td[1].classList.contains("lead"), rows: document.querySelectorAll(".tp-cmp tbody tr").length };
  });
  A("the club table bolds the lower goals against", cmp.rows >= 12 && (cmp.a < cmp.b ? cmp.la && !cmp.lb : cmp.a > cmp.b ? cmp.lb && !cmp.la : !cmp.la && !cmp.lb), JSON.stringify(cmp));
  const tray = await p.evaluate(async () => {
    const t = document.querySelector(".tp-tray"); window.scrollTo(0, 0); await new Promise((r) => setTimeout(r, 400));
    const at0 = t.classList.contains("on");
    window.scrollTo(0, document.querySelector("#tpRead").getBoundingClientRect().top + scrollY); await new Promise((r) => setTimeout(r, 400));
    const on = t.classList.contains("on"), tab = t.querySelector("a").tabIndex; window.scrollTo(0, 0); await new Promise((r) => setTimeout(r, 400));
    return { at0, on, tab, off: !t.classList.contains("on") };
  });
  A("the tray drops in once the match center scrolls away, and leaves the tab order when it goes", !tray.at0 && tray.on && tray.tab === 0 && tray.off, JSON.stringify(tray));
  const jump = await p.evaluate(async () => { window.scrollTo(0, document.documentElement.scrollHeight); await new Promise((r) => setTimeout(r, 400)); const on = document.querySelector(".tp-tray").classList.contains("on"); window.scrollTo(0, 0); await new Promise((r) => setTimeout(r, 300)); return on; });
  A("a jump straight past the match center still brings the tray", jump);
  await x.ctx.close();

  console.log("## a GM proposes: the door, nothing said before the answer, a refusal kept, the pulse in place");
  x = await open("gm", "DET", "#/trade?with=BOS");
  r = await x.p.evaluate(() => ({ tp: !!document.querySelector(".tp"), h1: (document.querySelector(".tp h1") || {}).textContent }));
  A("a GM's trade page opens on their own club's build", r.tp && r.h1 === "Build a trade", JSON.stringify(r));
  const meIds = H.ids.DET, themIds = H.ids.BOS;
  await x.p.click(`.tp-tick[data-side="me"][data-pid="${meIds[0]}"]`); await x.p.click(`.tp-tick[data-side="them"][data-pid="${themIds[0]}"]`);
  await x.p.fill("#tpNote", "Live test note");
  script("trades.insert", mock.fail("P0001", DEADLINE));
  H.delay = 600; await x.p.evaluate(() => { window.__tp = document.querySelector(".tp"); });
  const hash0 = await x.p.evaluate(() => location.hash);
  await x.p.click('#tpSend [data-act="propose"]'); await wait(150);
  r = await x.p.evaluate(() => { const bt = document.querySelector('#tpSend [data-act="propose"]'); return { busy: bt.getAttribute("aria-busy"), text: bt.textContent, ok: window.__toasts.filter((t) => /^ok:/.test(t)).length, hash: location.hash }; });
  A("nothing is said as sent while the league answers (the button says Sending)", r.busy === "true" && r.text === "Sending" && !r.ok && r.hash === hash0, JSON.stringify(r));
  await wait(900);
  r = await x.p.evaluate(() => ({ err: document.querySelector("#tpSend .tp-err").textContent, hash: location.hash, note: document.querySelector("#tpNote").value, busy: document.querySelector('#tpSend [data-act="propose"]').getAttribute("aria-busy"), same: window.__tp === document.querySelector(".tp") }));
  A("the deadline refusal shows the database's own words, and the picks and the note stay", r.err === DEADLINE && r.hash === hash0 && r.note === "Live test note" && r.busy === null && r.same, JSON.stringify(r));
  c = calls(); const o0 = (await opts(x))[0] || {};
  r = await x.p.evaluate((q) => { const k = q.c[0], row = k.args.row || {}; return { rpc: k.rpc, approval: k.approval, n: q.c.length,
    row: row.season_id === q.sid && row.from_team_id === S2.M.team("DET").id && row.to_team_id === S2.M.team("BOS").id && row.from_profile_id === S2.session.profileId &&
      row.offered_profile_ids.join() === q.me && row.requested_profile_ids.join() === q.them && row.note === "Live test note",
    action: q.o.action, qa: !!q.o.queueArgs && q.o.queueArgs.countered_id === null && q.o.queueArgs.to_team_id === S2.M.team("BOS").id && q.o.queueArgs.offered_profile_ids.join() === q.me && q.o.queueArgs.offered_pick_ids.length === 0 }; }, { c, o: o0, sid: SID, me: meIds[0], them: themIds[0] });
  A("propose is trades.insert with the season, both clubs, the proposer, the players and the note, under Owner approval", r.n === 1 && r.rpc === "trades.insert" && r.approval === "owner" && r.row, JSON.stringify(r));
  A("its Owner move is trade_propose with the arguments _mgmt_describe reads", r.action === "trade_propose" && r.qa, JSON.stringify(r));
  H.delay = 0;
  await x.p.evaluate(() => { const n = window.__note = document.querySelector("#tpNote"); n.focus(); n.value += " more"; n.dispatchEvent(new Event("input", { bubbles: true })); n.setSelectionRange(4, 4); S2.live.emit("rosters", { sections: ["rosters"] }); });
  await wait(200);
  r = await x.p.evaluate(() => ({ same: window.__note === document.querySelector("#tpNote"), value: window.__note.value, focus: document.activeElement === window.__note, caret: window.__note.selectionStart, page: window.__tp === document.querySelector(".tp"), err: document.querySelector("#tpSend .tp-err").textContent }));
  A("the pulse repaints in place and never the note being typed", r.same && r.value === "Live test note more" && r.focus && r.caret === 4 && r.page, JSON.stringify(r));
  A("the refusal survives the repaint", r.err === DEADLINE, r.err);
  H.R = [];
  await x.p.click('#tpSend [data-act="propose"]'); await wait(900);
  r = await x.p.evaluate(() => ({ hash: location.hash, toast: window.__toasts.filter((t) => /^ok:/.test(t)).pop() || "", h1: (document.querySelector(".tp h1") || {}).textContent }));
  const newId = (r.hash.match(/offer=([0-9a-f-]+)/) || [])[1];
  A("once the league has it, the page opens the new offer, read back from the league", !!newId && /^ok:Trade proposed to the Boston Bruins\./.test(r.toast) && readOf(newId).length >= 1 && r.h1 === "Offer to the Bruins", JSON.stringify(r));
  A("the sender's offer offers Withdraw and Change it", (await acts(x)).join() === "withdraw,counter", (await acts(x)).join());
  await x.p.click('#tpSend [data-act="withdraw"]'); await confirmSheet(x); await wait(600);
  c = calls().pop(); const o1 = (await opts(x)).pop();
  r = await x.p.evaluate((k) => ({ ok: k.rpc === "trades.update" && k.args.set.status === "cancelled" && k.args.match.id === location.hash.split("offer=")[1] && k.args.match.status === "proposed" && k.approval === "owner",
    h: (document.querySelector("#tpSend .sec-head h2") || {}).textContent, toast: window.__toasts.filter((t) => /^ok:/.test(t)).pop() }), c);
  A("Withdraw is trades.update to cancelled, only while it is still proposed, under Owner approval (trade_cancel)", r.ok && o1.action === "trade_cancel" && o1.queueArgs && o1.queueArgs.p_trade === newId, JSON.stringify({ r, o1 }));
  A("the page reads the offer again and shows it withdrawn", r.h === "Withdrawn" && /^ok:Offer withdrawn/.test(r.toast), JSON.stringify(r));
  await go(x, "#/trade?with=BOS");
  await x.p.click(`.tp-name[data-pid="${meIds[1]}"]`); await x.p.click(`[data-act="block"][data-pid="${meIds[1]}"]`); await wait(400);
  c = calls().pop(); const o2 = (await opts(x)).pop();
  r = { ok: c.rpc === "roster_spots.update" && c.args.set.on_block === true && c.args.match.season_id === SID && c.args.match.profile_id === meIds[1] && c.approval === "owner", toast: await okToast(x) };
  A("the trade block is roster_spots.on_block for the season on screen, under Owner approval (roster_block)", r.ok && o2.action === "roster_block" && o2.queueArgs.p_profile === meIds[1] && o2.queueArgs.on_block === true, JSON.stringify({ c, o2 }));
  A("and it says so only once the league confirms it", / is on the trade block\. Every front office sees the listing\.$/.test(r.toast), r.toast);
  /* QA core 2026-11-25 (nits 12): on an archive (the season on screen is not the current one) the doors refuse and write
     nothing; before, the block door wrote the archived season's roster row, which RLS does not stop */
  const before = calls().length;
  r = await x.p.evaluate(async (pid) => {
    const s1 = S2.M.control.seasons.filter((s) => s.number === 1)[0].settings, was = s1.status; s1.status = "complete";
    try { await S2.trade.door.block(pid, false); return { sent: true }; } catch (e) { return { code: e.code, msg: e.message }; } finally { s1.status = was; }
  }, meIds[1]);
  A("on an archive the trade block door refuses with what to do, and nothing is written", r.code === "S2_ARCHIVE" && /open it without \?season/.test(r.msg) && calls().length === before, JSON.stringify(r));
  /* audit 2026-11-09: a counter link for an offer this club sent (not one sent to it) opens a new trade, never the offer */
  await go(x, "#/trade?counter=" + PEND);
  r = await x.p.evaluate(() => ({ h1: (document.querySelector(".tp h1") || {}).textContent, flash: document.body.textContent.indexOf("That counter link is for another club's offer") >= 0, hash: location.hash, picks: document.querySelectorAll('.tp-tick[aria-pressed="true"]').length }));
  A("a counter link for an offer the club sent opens a new trade for its own club, and says why", r.h1 === "Build a trade" && r.flash && !/counter=|club=/.test(r.hash) && r.picks === 0, JSON.stringify(r));
  await x.ctx.close();

  console.log("## the receiving GM: a refusal under the minimums, then the accept; a counter");
  x = await open("gm", "BOS", "#/trade?offer=" + INC);
  A("a received offer is read by its id and offers Accept, Counter and Decline", (await acts(x)).join() === "accept,counter,decline", (await acts(x)).join());
  r = await x.p.evaluate((o) => ({ ticks: [...document.querySelectorAll('.tp-tick[aria-pressed="true"]')].map((t) => t.dataset.pid).sort().join(), dis: [...document.querySelectorAll(".tp-tick")].every((t) => t.getAttribute("aria-disabled") === "true"), rail: document.querySelector('[data-w="rail"]').hidden }), {});
  A("the offer's players are ticked and nothing can be ticked", r.ticks === [H.ids.DET[1], H.ids.BOS[1]].sort().join() && r.dis && r.rail, JSON.stringify(r));
  r = await x.p.evaluate(() => { const els = [...document.querySelectorAll("#page .reveal")]; return { n: els.length, shown: els.filter((e) => e.classList.contains("in")).length }; });
  A("the offer drawn after its read is shown, not left hidden behind the entrance", r.n > 2 && r.shown === r.n, JSON.stringify(r));
  script("accept_trade", mock.fail("23514", MINIMUM, "below_minimum"));
  await x.p.click('#tpSend [data-act="accept"]'); await confirmSheet(x); await wait(500);
  r = { err: await sheetErr(x), open: await x.p.evaluate(() => !!document.querySelector(".sheet")), h: await h(x) };
  A("a trade that would take a club under the Season 2 minimums is refused in the database's words, in the sheet", r.err === MINIMUM && r.open && r.h === "Answer the Red Wings", JSON.stringify(r));
  await confirmSheet(x); await wait(700);
  c = calls().filter((k) => k.rpc === "accept_trade"); const oa = (await opts(x)).filter((k) => k.rpc === "accept_trade");
  r = { h: await h(x), toast: await okToast(x), acts: (await acts(x)).length };
  A("Accept is accept_trade with the offer's id, under Owner approval, reading the rosters again", c.length === 2 && c.every((k) => k.args.p_trade === INC && k.approval === "owner") && oa[1].sections.join() === "rosters,tenures,wire", JSON.stringify({ c, oa }));
  A("once accepted the page reads it back as Accepted, and a club holds no reverse button", r.h === "Accepted" && /^ok:Trade completed\./.test(r.toast) && r.acts === 0, JSON.stringify(r));
  await go(x, "#/trade?offer=" + INC2);
  await x.p.click('#tpSend [data-act="counter"]'); await wait(200);
  r = await x.p.evaluate(() => ({ hash: location.hash, mode: document.querySelector(".tp").dataset.mode, rail: document.querySelector('[data-w="rail"]').hidden, btn: document.querySelector('#tpSend [data-act="propose"]').textContent }));
  A("Counter turns the offer into a build in place", r.hash.indexOf("counter=" + INC2) > 0 && r.mode === "build" && !r.rail && r.btn === "Send the counter", JSON.stringify(r));
  await x.p.click('#tpSend [data-act="propose"]'); await wait(900);
  c = calls().slice(-2); const oc = (await opts(x)).filter((k) => k.rpc === "trades.insert").pop();
  r = { ins: c[0].rpc === "trades.insert" && c[0].args.row.from_team_id === TID.BOS && c[0].args.row.to_team_id === TID.DET && c[0].approval === "owner",
    dec: c[1].rpc === "trades.update" && c[1].args.set.status === "declined" && c[1].args.match.id === INC2 && c[1].args.match.status === "proposed" && c[1].approval === "owner",
    old: H.T.filter((t) => t.id === INC2)[0].status, hash: await x.p.evaluate(() => location.hash), qa: oc && oc.queueArgs && oc.queueArgs.countered_id };
  A("the counter is a new offer the other way, and their offer is declined once it is in", r.ins && r.dec && r.old === "declined" && r.qa === INC2 && /offer=/.test(r.hash), JSON.stringify(r));
  await x.ctx.close();

  console.log("## the Owner's approval: a GM's move waits for the Owner; the Owner's own goes straight to the league");
  x = await open("gm", "DET", "#/trade?with=BOS");
  await x.p.click(`.tp-tick[data-side="me"][data-pid="${H.ids.DET[0]}"]`); await x.p.click(`.tp-tick[data-side="them"][data-pid="${H.ids.BOS[0]}"]`);
  script("trades.insert", Object.assign(mock.ok("move-1"), { queued: true }));
  await x.p.click('#tpSend [data-act="propose"]'); await wait(500);
  r = { t: await toasts(x), hash: await x.p.evaluate(() => location.hash), rows: H.T.length };
  A("a GM whose Trades page the Owner approves is told the offer went to the Owner, not that it was sent", r.t.some((t) => t === "ok:Sent to the Owner for approval. The offer goes to the Boston Bruins once the Owner approves it.") && !r.t.some((t) => /Trade proposed/.test(t)) && r.hash === "#/hq?tab=trades" && r.rows === 5, JSON.stringify(r));
  await x.ctx.close();
  x = await open("owner", "BOS", "#/trade?offer=" + INC);
  await x.p.click('#tpSend [data-act="accept"]'); await confirmSheet(x); await wait(700);
  r = { t: await okToast(x), h: await h(x), c: calls().pop() };
  A("the Owner's own accept goes straight through (the database never queues an Owner)", r.c.rpc === "accept_trade" && r.c.approval === "owner" && /^ok:Trade completed\./.test(r.t) && r.h === "Accepted", JSON.stringify(r));
  await x.ctx.close();
  x = await open("commissioner", "DET", "#/trade?with=BOS");
  await x.p.click(`.tp-tick[data-side="me"][data-pid="${H.ids.DET[0]}"]`); await x.p.click(`.tp-tick[data-side="them"][data-pid="${H.ids.BOS[0]}"]`);
  await x.p.click('#tpSend [data-act="propose"]'); await wait(800);
  r = { c: calls().pop(), t: await toasts(x) };
  A("the league office, previewing Detroit, proposes straight to the league for Detroit", r.c.rpc === "trades.insert" && r.c.args.row.from_team_id === TID.DET && r.t.some((t) => /^ok:Trade proposed to the Boston Bruins\./.test(t)), JSON.stringify(r.c) + " " + r.t.join(" | "));
  await x.ctx.close();

  console.log("## a staffer: reads every offer, answers none, reverses and resends");
  x = await open("staff", null, "#/trade?offer=" + PEND);
  r = await x.p.evaluate(() => ({ acts: [...document.querySelectorAll("#tpSend .tp-acts .btn")].map((e) => e.dataset.act), h: (document.querySelector("#tpSend .sec-head h2") || {}).textContent, k: (document.querySelector('[data-w="mk"]') || {}).textContent || "",
    lede: (document.querySelector('[data-w="lede"]') || {}).textContent || "", ticks: [...document.querySelectorAll(".tp-tick")].every((t) => t.getAttribute("aria-disabled") === "true") }));
  A("a staffer reads an open offer and answers nothing (only the two clubs answer it)", !r.acts.length && r.h === "Waiting on the Bruins" && /^Offer from the Red Wings/.test(r.k) && /^Read by the league office/.test(r.lede) && r.ticks, JSON.stringify(r));
  await go(x, "#/trade?offer=" + ACC);
  A("on a completed trade a staffer has Reverse", (await acts(x)).join() === "reverse", (await acts(x)).join());
  await x.p.click('#tpSend [data-act="reverse"]');
  await x.p.fill("#rvWhy", "too short"); await confirmSheet(x); await wait(150);
  r = { err: await sheetErr(x), n: calls().length };
  A("a reason under ten characters is refused before anything is sent", /at least ten characters/.test(r.err || "") && r.n === 0, JSON.stringify(r));
  script("reverse_trade", mock.fail("P0001", STALE));
  await x.p.fill("#rvWhy", WHY); await confirmSheet(x); await wait(500);
  r = { err: await sheetErr(x), why: await x.p.evaluate(() => (document.querySelector("#rvWhy") || {}).value) };
  A("the database's refusal stays in the sheet with the reason kept", r.err === STALE && r.why === WHY, JSON.stringify(r));
  await confirmSheet(x); await wait(700);
  c = calls().filter((k) => k.rpc === "reverse_trade"); const orv = (await opts(x)).filter((k) => k.rpc === "reverse_trade");
  r = { h: await h(x), t: await okToast(x) };
  A("Reverse is reverse_trade with the offer and the reason, never queued for an Owner, reading the rosters again", c.length === 2 && c.every((k) => k.args.p_trade === ACC && k.args.p_reason === WHY && k.approval === null) && orv[1].sections.join() === "rosters,tenures,wire", JSON.stringify({ c, orv }));
  A("the page reads it back as Reversed", r.h === "Reversed" && /^ok:Trade reversed\./.test(r.t), JSON.stringify(r));
  await go(x, "#/trade?offer=" + DEC);
  A("on a declined offer a staffer has Resend", (await acts(x)).join() === "resend", (await acts(x)).join());
  await x.p.click('#tpSend [data-act="resend"]'); await confirmSheet(x); await wait(900);
  c = calls().pop();
  r = await x.p.evaluate(() => ({ hash: location.hash, toast: window.__toasts.filter((t) => /^ok:/.test(t)).pop(), h: (document.querySelector("#tpSend .sec-head h2") || {}).textContent }));
  A("Resend is resend_trade, and the page opens the offer the league sent again", c.rpc === "resend_trade" && c.args.p_trade === DEC && c.approval === null && r.toast === "ok:Offer resent to the Boston Bruins." && /offer=00000000-0000-4000-8000-0000000000\d\d$/.test(r.hash) && r.h === "Waiting on the Bruins", JSON.stringify(r));
  await x.ctx.close();

  console.log("## privacy: a member and a third club never see an offer");
  x = await open("member", null, "#/trade?offer=" + PEND);
  r = await x.p.evaluate((note) => ({ tp: !!document.querySelector(".tp"), h1: (document.querySelector("#page h1") || {}).textContent, note: document.body.textContent.indexOf(note) >= 0 }), NOTE);
  A("a member meets Team HQ's lock on an offer's address, and the page never reads it", !r.tp && r.h1 === "Front offices only" && !H.R.some((q) => q.t === "trades") && !r.note, JSON.stringify(r));
  await x.ctx.close();
  x = await open("gm", "PIT", "#/trade?offer=" + PEND);
  r = await x.p.evaluate((q) => ({ h1: (document.querySelector("#page h1") || {}).textContent, note: document.body.textContent.indexOf(q.note) >= 0, tp: !!document.querySelector(".tp"),
    shown: [...document.querySelectorAll("#page .reveal")].every((e) => e.classList.contains("in")) }), { note: NOTE });
  A("a third club's GM reads no offer (RLS gives no row), and the page says nothing more", r.h1 === "No offer to show" && readOf(PEND).length === 1 && !r.note && !r.tp && r.shown, JSON.stringify(r));
  await go(x, "#/trade?counter=" + PEND);
  r = await x.p.evaluate(() => ({ h1: (document.querySelector(".tp h1") || {}).textContent, flash: (document.querySelector(".tp-flash") || {}).textContent || "", hash: location.hash, picks: document.querySelectorAll('.tp-tick[aria-pressed="true"]').length }));
  A("a counter link for an offer the club cannot see opens a new trade, and says why", r.h1 === "Build a trade" && /names no offer your club can see/.test(r.flash) && !/counter=/.test(r.hash) && r.picks === 0, JSON.stringify(r));
  await x.ctx.close();

  /* QA function 0 and 16 (2026-11-25): on Season 2 before puck drop every club's pp_pct and pk_pct are null, and picking a
     partner threw in clubsHtml (toFixed on null) before the comparison and the Send section drew; the partner cards read
     "0-0-0 · 1st East" */
  console.log("## Season 2 before its first final: picking a partner draws the comparison, with no rank over zeros");
  x = await open("gm", "DET", "#/trade", { season: 2 });
  const e0 = errs.length;
  r = await x.p.evaluate(() => ({ view: S2.M.view.season, none: S2.M.view.empty.finals, nullPp: S2.M.standings("league").every((s) => s.pp_pct == null), send: (S2.$("#tpSend") || {}).textContent || "" }));
  const send0 = r.send;
  A("the recorded Season 2 is on screen, with no final and no power play yet", r.view === 2 && r.none && r.nullPp, JSON.stringify(r).slice(0, 300));
  await x.p.click('[data-act="partner"][data-v="BOS"]'); await wait(600);
  r = await x.p.evaluate(() => ({ clubs: ((S2.$('[data-w="clubs"]') || {}).textContent || "").replace(/\s+/g, " "), send: (S2.$("#tpSend") || {}).textContent || "",
    rail: [...document.querySelectorAll(".tp-club-r")].map((e) => e.textContent), bold: document.querySelectorAll('[data-w="clubs"] td.lead').length, want: "Note to the " + S2.M.team("BOS").name }));
  A("picking a partner throws nothing", !errs.slice(e0).some((e) => /pageerror/.test(e)), errs.slice(e0).join(" | ").slice(0, 400));
  A("the two clubs are compared, a missing power play or kill said in words and bolded on neither side", /Power play/.test(r.clubs) && /No chances yet/.test(r.clubs) && /Neither club has played yet/.test(r.clubs) && r.bold === 0, r.clubs.slice(0, 500));
  A("no standing, rank or power ranking over a table of zeros", !/\d(st|nd|rd|th) in the|Power ranking|team OVR/.test(r.clubs) && r.rail.length === 7 && r.rail.every((t) => t === "No games yet"), JSON.stringify(r.rail));
  A("and the Send section repainted for the partner", r.send !== send0 && r.send.indexOf(r.want) >= 0, r.send.slice(0, 200));
  await x.ctx.close();

  console.log("## a phone");
  x = await open("gm", "DET", "#/trade?with=BOS", { vp: { width: 375, height: 812 } });
  const pw = await x.p.evaluate(async () => {
    const me = [...document.querySelectorAll('.tp-tick[data-side="me"]:not([aria-disabled])')][2]; me.click();
    document.querySelector('[data-seg="pane"] button[data-v="them"]').click(); await new Promise((r) => setTimeout(r, 200));
    const vis = (sel) => { const e = document.querySelector(sel); return !!e && e.getBoundingClientRect().height > 0; };
    return { sw: document.documentElement.scrollWidth, w: innerWidth, me: vis('[data-w="panel-me"] .tp-panel'), them: vis('[data-w="panel-them"] .tp-panel'),
      cols: [...document.querySelectorAll('[data-w="panel-them"] table[data-unit="F"] thead th')].filter((th) => th.getBoundingClientRect().width > 0).map((th) => th.textContent.trim()) };
  });
  A("a phone has no sideways scroll", pw.sw <= pw.w, pw.sw + " > " + pw.w);
  A("a phone shows one roster at a time, switched by the segmented control", !pw.me && pw.them, JSON.stringify(pw));
  A("a phone roster keeps the rating, the points and the value", pw.cols.slice(2).join() === "OVR,P,Value", pw.cols.join(","));
  await x.ctx.close();

  A("the model's clubs carry their league ids, which js/trade.js reads for every door and offer (M.team(code).id)", H.noIds && !H.noIds.length, "no id on " + (H.noIds || []).join(","));
  A("no console errors", !errs.length, errs.join(" | ").slice(0, 900));
  await b.close();
  console.log(fails ? "\n" + fails + " FAILED" : "\nALL TRADE PAGE CHECKS PASSED");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
