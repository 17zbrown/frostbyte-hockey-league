const S2_BASE = process.env.S2_BASE || (() => { throw new Error("S2_BASE unset: run through tools/ui/run.cjs") })();
/* The filed forms and the survey on the Season 2 site (S2 swap, stream e5, 2026-11-24; real-site mode, i3a 2026-11-25):
   node tools/ui/run.cjs --suite flows --mode live (every context is the real site: mock.install(ctx, {live: true}) runs
   the page as the site build ships it, js/live.js signs in as the persona, and the harness answers every read).
   - Each form calls the current site's own door with the exact arguments (j1's write mock records S2.write), nothing
     shows as filed before the database confirms it, a refusal shows the database's own words with the answers kept, and
     the Rule 2.7 conflicts (a staffer's owner application, a GM's staff application) are filed and refused by the
     database, never locked by the page.
   - What the forms read first (the member's profile, the application on file, season_survey_done) is answered by the
     harness's table and RPC answers, through the real supabase-js client (no stand-in client).
   Members are picked from the league read at run time; no member's name is written here. Nothing here reaches
   Supabase, Netlify or Discord.
   Deleted with demo mode (i3a): the concept section (Fill sample answers, the demo receipt, filings kept in S2.demo) and
   the no-write-door section's S2.write stub (the real site always has its write door; a refusal is now the database's,
   from the writes table, and pins the same kept answers). */
const mock = require(process.env.S2_MOCK);
const { chromium } = require(mock.PW);
let fails = 0;
const A = (name, cond, more) => { console.log((cond ? "PASS " : "FAIL ") + name + (cond || more === undefined ? "" : "  (" + JSON.stringify(more).slice(0, 600) + ")")); if (!cond) fails++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const MEMBER = mock.sessionOf("member"), GM = mock.sessionOf("gm");

/* runs in the page before any page code */
function init(cfg) {
  try {
    localStorage.setItem("s2.introSeen", "true");
    /* today's first load is spent, so the daily pop-up never opens over a check; the sign-up path is what is tested */
    localStorage.setItem("s2.surveyLoadDay", new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }));
  } catch (e) { /* storage blocked */ }
  document.addEventListener("s2:filed", function (e) { (window.__filed = window.__filed || []).push(e.detail.flow); });
}
/* a check's read answers ("from:<table>" or "rpc:<name>" -> fn(args) -> { data } or { data: null, error: { message, code } })
   as the harness's table and RPC answers, every read recorded in reads as { kind, name, args: { sel, f } }. A row answered
   gets the columns the read filters on, as the row on file carries them */
function answers(o, reads, base) {
  const tables = {}, rpcs = {};
  const fail = (e) => mock.fail(e.code || "XX000", e.message);
  Object.keys(o).forEach((key) => {
    const [kind, name] = key.split(":"), fn = o[key];
    if (kind === "rpc") rpcs[name] = (args) => { reads.push({ kind, name, args }); const r = fn(args); return r.error ? fail(r.error) : mock.ok(r.data); };
    else tables[name] = (q) => {
      const f = {}; q.filters.forEach(([k, v]) => { f[k] = String(v).replace(/^eq\./, ""); });
      const args = { sel: q.select, f };
      /* profiles is also js/live.js's sign-in read: only the form's own read (its columns) is the check's */
      if (name === "profiles" && !/jersey_number/.test(q.select || "")) return base.profiles;
      reads.push({ kind, name, args });
      const r = fn(args);
      if (r.error) return fail(r.error);
      return r.data ? [Object.assign({}, f, r.data)] : [];
    };
  });
  return { tables, rpcs };
}

(async () => {
  const b = await chromium.launch(), errors = [];
  let reads = [];
  async function open(o) {
    o = o || {};
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
    reads = [];
    const st = await mock.install(ctx, { live: true, persona: o.persona || "anon", writes: o.writes || {}, session: o.session });
    const a = answers(o.reads || {}, reads, { profiles: st.tables.profiles });
    Object.keys(a.tables).forEach((t) => mock.respond(ctx, "table:" + t, a.tables[t]));
    Object.keys(a.rpcs).forEach((r) => mock.respond(ctx, "rpc:" + r, a.rpcs[r]));
    await ctx.addInitScript(init, {});
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    /* refusals are meant here: the flows log each with console.error, and the browser logs a refused read */
    p.on("console", (m) => { if (m.type() === "error" && !/^S2\.flow: |^S2 survey: the answers were refused|^Failed to load resource|^mock: /.test(m.text())) errors.push(m.text()); });
    await p.goto(S2_BASE + (o.hash || "#/today"));
    await p.waitForFunction(() => window.S2 && S2.M && S2.LIVE && S2.$("#page") && S2.$("#page").children.length > 0, null, { timeout: 20000 });
    /* js/live.js has applied the persona's sign-in (a guest needs none) */
    await p.waitForFunction((pid) => !pid || (S2.session && S2.session.profileId === pid && S2.state.role !== "guest"), o.persona && o.persona !== "anon" ? mock.sessionOf(o.persona).profileId : null, { timeout: 20000 });
    await wait(300);
    return { ctx, p };
  }
  const done = (x) => x.ctx.close();
  const sheet = (p) => p.evaluate(() => { const s = [...document.querySelectorAll(".sheet")].pop(); return s ? s.textContent.replace(/\s+/g, " ") : ""; });
  const next = (p) => p.click('.sheet .fl-form button[type="submit"]');
  const send = async (p) => { await p.click(".sheet [data-send]"); };
  const settled = (p) => p.waitForFunction(() => !!document.querySelector(".sheet .fl-done, .sheet .fl-senderr"), null, { timeout: 5000 }).then(() => true, () => false);
  const flow = (p, name, ctx) => p.evaluate((a) => { S2.flow(a[0], a[1] || {}); }, [name, ctx]).then(() => wait(450));
  const calls = (x) => mock.calls(x.ctx).map((c) => ({ rpc: c.rpc, args: c.args, approval: c.approval }));
  const noSurvey = { "rpc:season_survey_done": () => ({ data: true }) };
  /* the member's profile on file (the register and League profile forms read it first): nothing on file, or these fields */
  const onFile = (o) => ({ "from:profiles": (a) => ({ data: Object.assign({ id: a.f.id, ea_id: null, platform: null, platform_gamertag: null, preferred_server: null, jersey_number: null }, o || {}) }) });
  const noDetails = Object.assign(onFile(), noSurvey);

  console.log("## the real site: no demo device, a refusal keeps every answer");
  {
    const refused = "This member cannot receive messages right now.";
    const x = await open({ persona: "member", reads: noSurvey, writes: { "direct_messages.insert": () => mock.fail("42501", refused) } }), p = x.p;
    const name = await p.evaluate((me) => S2.M.players.filter((m) => m.id !== me)[0].tag, MEMBER.profileId);
    await flow(p, "message");
    A("no Fill sample answers and no demo chip", !(await p.$(".sheet [data-fill]")) && !(await p.$(".sheet .chip.sample")) && !(await p.$(".sheet .fl-demo")));
    await p.fill("#flto", name); await p.fill("#flbody", "A note that must survive a refusal.");
    await next(p);
    const ok = await settled(p);
    const r = await p.evaluate(() => ({ err: (document.querySelector(".sheet .fl-senderr") || {}).textContent, body: document.querySelector("#flbody").value, to: document.querySelector("#flto").value, done: !!document.querySelector(".sheet .fl-done") }));
    A("the database's refusal is shown above Send, nothing reads as sent, and the message and recipient are kept", ok && r.err === refused && !r.done && r.body === "A note that must survive a refusal." && r.to === name, r);
    await p.keyboard.press("Escape"); await wait(300);
    /* QA round 2 (A5): this check pinned a trade request offered to a member on no club, which send() then refused after the
       reason was written; it now pins the gate (a trade request is a rostered player's, Rule 2.3), and the next block the
       rostered member who is offered it */
    A("a member's case types: the database's stats_correction key is the front office's, no stat_fix, and no trade request for a member on no club",
      await p.evaluate(() => { const k = S2.caseTypes().map((c) => c[0]); return !S2.session.teamId && k.indexOf("trade_request") < 0 && k.indexOf("complaint") >= 0 && k.indexOf("stats_correction") < 0 && k.indexOf("forfeit_appeal") < 0 && k.indexOf("stat_fix") < 0; }));
    A("the survey's live answer shape passes its self-check (no console error) and is exported, and no answer is made up", await p.evaluate(() => typeof S2.survey.payload === "function" && S2.survey.KEY === "s2-2026" && S2.survey.sample().length === 0));
    A("a door naming no form is said, never a stand-in form", await p.evaluate(() => S2.flow("no-such-form") === null && !document.querySelector(".sheet .fl")));
    await done(x);
  }
  {
    /* QA functional 2026-11-25: four forms (discipline, reply, season, schedule) had no door and no opener, and carried a
       "not connected" text that a member could never reach; they are gone, and no form may come back without one */
    const x = await open({ persona: "staff", reads: noSurvey }), p = x.p;
    const forms = await p.evaluate(() => { const k = Object.keys(S2.flows); return { n: k.length, doorless: k.filter((f) => typeof S2.flows[f].send !== "function" && typeof S2.flows[f].page !== "function") }; });
    A("every form files through a door (send) or opens a page, none says it is not connected", forms.n > 5 && forms.doorless.length === 0, forms);
    A("a refusal's machine prefix never reaches the reader (JOIN_DISCORD, APPLICATION)", await p.evaluate(() =>
      S2.forms.said({ message: "JOIN_DISCORD: You must be in the Chel Gaming Discord server to register." }) === "You must be in the Chel Gaming Discord server to register." &&
      S2.forms.said({ message: "APPLICATION: An application is filed as pending." }) === "An application is filed as pending."));
    await done(x);
  }

  /* gaps (2026-11-25): Write a story files through the ONE news writer (S2.news, shared with the Control Center): it says at
     its top that a story posts to the Discord news channel, the review is the confirm, and nothing reads as published
     until news.insert is confirmed; a refusal keeps every answer */
  console.log("## Write a story: the real news door");
  {
    const refused = "new row violates row-level security policy for table \"news\"";
    let n = 0;
    const x = await open({ persona: "staff", reads: noSurvey, writes: { "news.insert": () => (++n === 1 ? mock.fail("42501", refused) : mock.ok([{ id: "n-1" }])) } }), p = x.p;
    await flow(p, "story");
    let r = await sheet(p);
    A("the story form is connected and says first that it posts to the Discord news channel", !/not connected/.test(r) && /posts to the Discord news channel/.test(r) && /cannot be taken back/.test(r), r.slice(0, 300));
    const cats = await p.$$eval("#flcat option", (os) => os.filter((o) => o.value).map((o) => o.value));
    A("its categories are the newsroom's six as stored (S2.CG.NEWS_CATS), the same list as the Control Center's", JSON.stringify(cats) === JSON.stringify(await p.evaluate(() => S2.CG.NEWS_CATS)), cats);
    await p.fill("#fltitle", "Short"); await p.selectOption("#flcat", "League News"); await p.fill("#flbody", "Line one.\n\nLine two.");
    await next(p);
    A("a headline under eight characters is refused in the form, nothing sent", /At least 8 characters/.test(await sheet(p)) && calls(x).length === 0);
    await p.fill("#fltitle", "Draft night is set for Saturday"); await next(p);
    r = await sheet(p);
    A("the review asks before posting, naming the Discord post", /Check your answers/.test(r) && /Publish and post to Discord/.test(r) && /posts to the Discord news channel/.test(r) && calls(x).length === 0, r.slice(0, 300));
    await send(p); await settled(p);
    r = await p.evaluate(() => ({ err: (document.querySelector(".sheet .fl-senderr") || {}).textContent, done: !!document.querySelector(".sheet .fl-done") }));
    A("a refusal shows the database's words and nothing reads as published", r.err === refused && !r.done, r);
    await send(p); await settled(p);
    const c = calls(x).filter((y) => y.rpc === "news.insert");
    const sid = await p.evaluate(() => S2.M.control.season(S2.M.view.season).settings.id);
    A("then one more news.insert: the season on screen, the category as stored, headline, body and the staffer's byline",
      c.length === 2 && c[1].args.row.season_id === sid && c[1].args.row.category === "League News" && c[1].args.row.title === "Draft night is set for Saturday" &&
      c[1].args.row.body === "Line one.\n\nLine two." && /, League staff$/.test(c[1].args.row.author) && !!c[1].args.row.published_at, c[1] && c[1].args);
    A("the receipt only after the confirmed write, and s2:filed fires", /Story published/.test(await sheet(p)) && (await p.evaluate(() => (window.__filed || []).indexOf("story") >= 0)));
    await done(x);
  }

  console.log("## a member signs up (profiles, then season_registrations)");
  {
    let release; const gate = new Promise((r) => { release = r; });
    const x = await open({ persona: "member", reads: noDetails, writes: {
      "profiles.update": () => mock.ok([{ id: MEMBER.profileId }]),
      "season_registrations.upsert": async () => { await gate; return mock.ok([{ id: "reg-1" }]); } } }), p = x.p;
    const s2 = await p.evaluate(() => ({ id: (S2.forms.regSeason() || {}).id, n: (S2.forms.regSeason() || {}).number, role: S2.state.role }));
    A("the persona is a signed-in player and Season 2 takes sign-ups", s2.role === "player" && s2.n === 2 && !!s2.id, s2);
    await flow(p, "register");
    await p.fill("#flea", "  TestEaName "); await p.selectOption("#flconsole", "PS5"); await wait(150); await p.fill("#fltag", "TestTag");
    await next(p); await wait(250);
    await p.click('.sheet input[name="flpos"][value="LD"]', { force: true }); await next(p); await wait(250);
    await send(p); await wait(400);
    const mid = await p.evaluate(() => { const bt = document.querySelector(".sheet [data-send]"); return { text: bt && bt.textContent, disabled: bt && bt.disabled, done: !!document.querySelector(".sheet .fl-done") }; });
    A("while the database has not answered: Sending, the button waits, no receipt", mid.text === "Sending…" && mid.disabled && !mid.done, mid);
    release(); const ok = await settled(p);
    const c = calls(x), t = await sheet(p);
    A("the profile's three details first, matched to the member", c[0] && c[0].rpc === "profiles.update" && JSON.stringify(c[0].args) === JSON.stringify({ set: { ea_id: "TestEaName", platform: "PS5", platform_gamertag: "TestTag" }, match: { id: MEMBER.profileId } }), c[0]);
    A("then the registration for the season taking sign-ups, one row per member and season", c[1] && c[1].rpc === "season_registrations.upsert" && c[1].args.onConflict === "season_id,profile_id"
      && JSON.stringify(c[1].args.row) === JSON.stringify({ season_id: s2.id, profile_id: MEMBER.profileId, position: "LD" }) && c.length === 2, c[1]);
    A("the receipt only after the confirmation, with no demo line, and s2:filed fires", ok && /You're registered for Season 2!/.test(t) && !/Nothing was sent/.test(t) && JSON.stringify(await p.evaluate(() => window.__filed)) === '["register"]', t.slice(0, 160));
    await done(x);
  }
  {
    const x = await open({ persona: "member", reads: noDetails, writes: {
      "profiles.update": () => mock.ok([{ id: MEMBER.profileId }]),
      "season_registrations.upsert": () => mock.fail("P0001", "DETAILS: Add your console gamertag to your profile first.") } }), p = x.p;
    await flow(p, "register");
    await p.fill("#flea", "TestEaName"); await p.selectOption("#flconsole", "XSX"); await wait(150); await p.fill("#fltag", "TestTag");
    await next(p); await wait(250); await next(p); await wait(250); await send(p);
    const ok = await settled(p);
    const r = await p.evaluate(() => ({ err: (document.querySelector(".sheet .fl-senderr") || {}).textContent, done: !!document.querySelector(".sheet .fl-done"), review: /EA ID/.test((document.querySelector(".sheet .fl-sum") || {}).textContent || "") }));
    A("a refusal shows the database's sentence without its DETAILS: prefix, stays on the review, no receipt", ok && r.err === "Add your console gamertag to your profile first." && r.review && !r.done, r);
    await p.click('.sheet .fl-sum [data-edit="0"]'); await wait(250);
    A("Change goes back to the answers, kept as typed", (await p.inputValue("#flea")) === "TestEaName" && (await p.inputValue("#fltag")) === "TestTag");
    await done(x);
  }
  {
    /* review 2026-11-24: a member with all three details on file typed their EA ID again and the sign-up wrote it over */
    const x = await open({ persona: "member", reads: Object.assign(onFile({ ea_id: "SavedEa", platform: "XSX", platform_gamertag: "SavedTag" }), noSurvey),
      writes: { "season_registrations.upsert": () => mock.ok([{ id: "reg-2" }]) } }), p = x.p;
    await flow(p, "register");
    const rd = reads.filter((q) => q.name === "profiles")[0];
    A("the sign-up reads the member's own profile first", rd && rd.args.f.id === MEMBER.profileId && /ea_id/.test(rd.args.sel) && /platform_gamertag/.test(rd.args.sel), rd);
    A("details on file fill the first step, nothing to retype", (await p.inputValue("#flea")) === "SavedEa" && (await p.inputValue("#flconsole")) === "XSX" && (await p.inputValue("#fltag")) === "SavedTag"
      && /What you have on file is filled in/.test(await sheet(p)));
    await next(p); await wait(250); await next(p); await wait(250); await send(p); const ok = await settled(p);
    const c = calls(x);
    A("unchanged details are not written again: the registration is the only write", ok && c.length === 1 && c[0].rpc === "season_registrations.upsert" && c[0].args.row.profile_id === MEMBER.profileId, c);
    await done(x);
  }

  console.log("## the League profile (profiles, set_my_jersey_number): it starts from what is on file");
  {
    /* review 2026-11-24: the form opened empty, so a member setting only a number retyped their EA ID and lost their server */
    const prof = { ea_id: "SavedEa", platform: "PS5", platform_gamertag: "SavedTag", preferred_server: null, jersey_number: 19 };
    let readFails = true, refuse = false;
    const taken = "#12 is already worn by another player on your club. Pick another number.";
    const x = await open({ persona: "member",
      reads: Object.assign({ "from:profiles": (a) => readFails ? { data: null, error: { message: "network" } } : { data: Object.assign({ id: a.f.id }, prof) } }, noSurvey),
      writes: { "profiles.update": () => mock.ok([{ id: MEMBER.profileId }]),
        set_my_jersey_number: (args) => refuse ? mock.fail("23505", taken) : mock.ok({ chosen: args.p_number, wearing: null, team_id: null }) } }), p = x.p;
    prof.preferred_server = await p.evaluate(() => S2.lobby.SERVERS[1]);
    await flow(p, "profile");
    A("a failed read of the profile is said, with Try again, and no empty form that could overwrite it", /Your profile on file could not be read: network/.test(await sheet(p)) && !!(await p.$(".sheet [data-retry]")) && !(await p.$("#flea")));
    readFails = false; await p.click(".sheet [data-retry]"); await p.waitForSelector("#flea");
    const v = { ea: await p.inputValue("#flea"), con: await p.inputValue("#flconsole"), tag: await p.inputValue("#fltag"), srv: await p.inputValue("#flserver"), num: await p.inputValue("#flnum") };
    A("Try again reads it, and every field starts from the profile on file", v.ea === "SavedEa" && v.con === "PS5" && v.tag === "SavedTag" && v.srv === prof.preferred_server && v.num === "19", v);
    await p.fill("#flnum", "27"); await next(p); let ok = await settled(p);
    let c = calls(x);
    A("changing only the number writes the saved EA ID, console, tag and server back unchanged", ok && c[0] && c[0].rpc === "profiles.update"
      && JSON.stringify(c[0].args) === JSON.stringify({ set: { ea_id: "SavedEa", platform: "PS5", platform_gamertag: "SavedTag", preferred_server: prof.preferred_server }, match: { id: MEMBER.profileId } }), c[0]);
    A("then the number through its own door", c[1] && c[1].rpc === "set_my_jersey_number" && c[1].args.p_number === 27 && c.length === 2, c);
    A("the receipt says what the database answered for the number (no club yet: a choice for the next one)", /#27 is yours when you join a club/.test(await sheet(p)));
    await p.keyboard.press("Escape"); await wait(300);
    prof.jersey_number = 27;
    await flow(p, "profile"); await p.waitForSelector("#flea");
    await p.fill("#flea", "NewEa"); await next(p); ok = await settled(p);
    c = calls(x).slice(2);
    A("a save that leaves the number alone never calls the number's door, and keeps the saved server", ok && c.length === 1 && c[0].rpc === "profiles.update" && c[0].args.set.ea_id === "NewEa" && c[0].args.set.preferred_server === prof.preferred_server, c);
    A("and its receipt claims no number", /Profile saved/.test(await sheet(p)) && !/#\d/.test(await sheet(p)));
    await p.keyboard.press("Escape"); await wait(300);
    refuse = true;
    await flow(p, "profile"); await p.waitForSelector("#flea");
    await p.fill("#flnum", "12"); await next(p); ok = await settled(p);
    const r = await p.evaluate(() => ({ err: (document.querySelector(".sheet .fl-senderr") || {}).textContent, done: !!document.querySelector(".sheet .fl-done"), num: document.querySelector("#flnum").value }));
    A("a number a teammate wears: the profile part is said as saved, the database's sentence follows, the number is kept", ok && r.err === "Your profile was saved, but your number did not change: " + taken && !r.done && r.num === "12", r);
    await done(x);
  }

  console.log("## owner applications (owner_applications, the one edit)");
  {
    const x = await open({ persona: "member", reads: Object.assign({ "from:owner_applications": () => ({ data: null }) }, noSurvey),
      writes: { "owner_applications.upsert": () => mock.ok([{ id: "app-1", status: "pending", edited_at: null }]) } }), p = x.p;
    await flow(p, "owner");
    const rd = reads.filter((q) => q.name === "owner_applications")[0], s2id = await p.evaluate(() => S2.forms.regSeason().id);
    A("the application on file is read first, for this member and the season taking sign-ups", rd && rd.args.f.profile_id === MEMBER.profileId && rd.args.f.season_id === s2id, rd);
    A("a signed-up member meets no notes and no lock", !(await p.$(".sheet .fl-warn")) && !(await p.$('.sheet [data-lk]')) && !!(await p.$("#flea")));
    await p.fill("#flea", "TestEaName"); await next(p); await wait(250);
    await p.selectOption("#flf1", "Seattle Kraken"); await p.selectOption("#flf2", "Utah Mammoth"); await next(p); await wait(250);
    await p.fill("#flwhy", "I keep a full lineup every night."); await next(p); await wait(250);
    A("the review's button reads Submit application", (await p.textContent(".sheet [data-send]")) === "Submit application");
    await send(p); const ok = await settled(p);
    const c = calls(x)[0];
    A("one upsert per member and season, the live payload, and its ids asked back", ok && c.rpc === "owner_applications.upsert" && c.args.onConflict === "profile_id,season_id" && c.args.select === "id,status,edited_at"
      && c.args.row.season_id === s2id && c.args.row.profile_id === MEMBER.profileId && c.args.row.preferred_club === "Seattle Kraken" && c.args.row.franchise_2 === "Utah Mammoth" && c.args.row.franchise_3 === null
      && c.args.row.pitch === "I keep a full lineup every night." && c.args.row.status === "pending" && c.args.row.availability === null && !!c.args.row.updated_at, c);
    A("the receipt says submitted", /Application submitted/.test(await sheet(p)));
    await done(x);
  }
  {
    const onFile = { id: "app-1", status: "pending", ea_id: "TestEaName", availability: null, experience: null, preferred_club: "Seattle Kraken", franchise_2: null, franchise_3: null, pitch: "On file.", edited_at: null };
    const x = await open({ persona: "member", reads: Object.assign({ "from:owner_applications": () => ({ data: onFile }) }, noSurvey),
      writes: { "owner_applications.upsert": (args, info) => info.calls.length === 1 ? mock.fail("23514", "ONE_EDIT: You have already used your one edit.") : mock.ok([{ id: "app-1" }]) } }), p = x.p;
    await flow(p, "owner");
    A("an application in review prefills the form and says the next change is the one edit", (await p.inputValue("#flea")) === "TestEaName" && /saving a change uses your one edit/.test(await sheet(p)));
    await next(p); await wait(250); await next(p); await wait(250);
    A("the pitch on file is in the box", (await p.inputValue("#flwhy")) === "On file.");
    await p.fill("#flwhy", "Changed once."); await next(p); await wait(250);
    A("a changed answer asks before spending the one edit", (await p.textContent(".sheet [data-send]")) === "Use your one edit");
    await send(p); await settled(p);
    A("ONE_EDIT: the database's sentence, prefix stripped, and the change kept", (await p.textContent(".sheet .fl-senderr")) === "You have already used your one edit." && /Changed once\./.test(await p.textContent(".sheet .fl-sum")));
    await send(p); await p.waitForSelector(".sheet .fl-done");
    A("a second try that the database confirms says it was the one edit", /Application saved/.test(await sheet(p)) && /That was your one edit/.test(await sheet(p)));
    await done(x);
  }
  {
    const x = await open({ persona: "member", reads: Object.assign({ "from:owner_applications": () => ({ data: null, error: { message: "permission denied for table owner_applications", code: "42501" } }) }, noSurvey) }), p = x.p;
    await flow(p, "owner");
    A("a failed read of the application on file is said, with Try again, and no form that could overwrite it", /could not be read: permission denied/.test(await sheet(p)) && !!(await p.$(".sheet [data-retry]")) && !(await p.$("#flea")));
    await done(x);
  }

  console.log("## Rule 2.7 at the forms: the database refuses, the page shows its words");
  {
    const words = "Members of the league staff cannot apply to own a club (Rule 2.7). Leave the staff first, then apply.";
    const x = await open({ persona: "staff", reads: Object.assign({ "from:owner_applications": () => ({ data: null }) }, noSurvey),
      writes: { "owner_applications.upsert": () => mock.fail("42501", words) } }), p = x.p;
    await flow(p, "owner");
    const t = await sheet(p);
    A("a staffer's owner application opens as a form, never a lock, with the database's sentence as a note", !(await p.$(".sheet [data-lk]")) && !!(await p.$("#flea")) && t.indexOf(words) >= 0, t.slice(0, 300));
    A("and the note that only a signed-up member may apply (this staffer is not signed up for Season 2)", /Only a member signed up to play in Season 2 may apply/.test(t));
    await p.fill("#flea", "StaffEa"); await next(p); await wait(250); await p.selectOption("#flf1", "Utah Mammoth"); await next(p); await wait(250);
    await p.fill("#flwhy", "Kept after the refusal."); await next(p); await wait(250); await send(p); await settled(p);
    const r = await p.evaluate(() => ({ err: (document.querySelector(".sheet .fl-senderr") || {}).textContent, done: !!document.querySelector(".sheet .fl-done"), sum: document.querySelector(".sheet .fl-sum").textContent }));
    A("the staffer's filing is refused with guard_app_role_conflict's words, the answers kept, nothing filed", r.err === words && !r.done && /Kept after the refusal\./.test(r.sum) && calls(x).length === 1, r);
    await done(x);
  }
  {
    const words = "Owners, General Managers and Assistant General Managers cannot apply to join the league staff (Rule 2.7). Step down from your club seat first, then apply.";
    const x = await open({ persona: "gm", reads: Object.assign({ "from:staff_applications": () => ({ data: null }) }, noSurvey),
      writes: { "staff_applications.upsert": () => mock.fail("42501", words) } }), p = x.p;
    A("the GM persona is the front office", (await p.evaluate(() => S2.state.role)) === "office");
    A("the front office's case types add the database's stats_correction and the forfeit appeal, never stat_fix",
      await p.evaluate(() => { const k = S2.caseTypes().map((c) => c[0]); return k.indexOf("stats_correction") >= 0 && k.indexOf("forfeit_appeal") >= 0 && k.indexOf("stat_fix") < 0; }));
    await flow(p, "staff");
    A("a GM's staff application opens as a form with the seat sentence as a note, never a lock", !(await p.$(".sheet [data-lk]")) && (await sheet(p)).indexOf(words) >= 0 && !!(await p.$('.sheet [data-k="areas"]')));
    await p.click('.sheet [data-k="areas"] input[value="Draft and Bidding"]', { force: true }); await next(p); await wait(250);
    await p.fill("#flwhy", "I know the draft room."); await next(p); await wait(250); await send(p); await settled(p);
    const c = calls(x)[0], r = await p.evaluate(() => ({ err: (document.querySelector(".sheet .fl-senderr") || {}).textContent, done: !!document.querySelector(".sheet .fl-done") }));
    A("the filing went to staff_applications, one row per member, the committee as its key", c && c.rpc === "staff_applications.upsert" && c.args.onConflict === "profile_id" && JSON.stringify(c.args.row.departments) === '["draft"]' && c.args.row.profile_id === GM.profileId, c);
    A("and the database's refusal is shown in its words, nothing filed", r.err === words && !r.done, r);
    await p.click('.sheet .fl-sum [data-edit="0"]'); await wait(250);
    A("the committee pick is kept", await p.evaluate(() => document.querySelector('.sheet [data-k="areas"] input[value="Draft and Bidding"]').checked));
    await done(x);
  }

  console.log("## cases (action_requests) and the trade deadline");
  {
    const x = await open({ persona: "member", reads: noSurvey, writes: { "action_requests.insert": () => mock.ok([{ id: "case-1" }]) } }), p = x.p;
    const other = await p.evaluate((me) => { const m = S2.M.players.filter((y) => y.id !== me)[0]; return { id: m.id, tag: m.tag }; }, MEMBER.profileId);
    await flow(p, "case", { type: "complaint" });
    await next(p); await wait(250);
    await p.selectOption("#flabout", "Something else"); await p.fill("#flwho", other.tag); await p.fill("#fldetails", "What happened, and when.");
    await next(p); await wait(250); await send(p); await settled(p);
    let c = calls(x)[0], view = await p.evaluate(() => S2.M.control.season(S2.M.view.season).settings.id);
    A("a complaint goes to the league office, the named member linked by profile", c && c.rpc === "action_requests.insert" && c.args.row.type === "complaint" && c.args.row.route === "commissioner"
      && c.args.row.subject === "Something else" && c.args.row.target === other.tag && c.args.row.target_profile_id === other.id && c.args.row.profile_id === MEMBER.profileId && c.args.row.season_id === view, c);
    A("its receipt says the league office has it", /The league office has it/.test(await sheet(p)));
    await p.keyboard.press("Escape"); await wait(300);
    await flow(p, "case", { type: "position_change" });
    await next(p); await wait(250);
    await p.click('.sheet input[name="flcur"][value="C"]', { force: true }); await p.click('.sheet input[name="flpos"][value="C"]', { force: true });
    await p.fill("#fldetails", "Please."); await next(p); await wait(250);
    A("a position change to the same position is stopped at the field", /Pick a different position from your current one/.test(await sheet(p)) && calls(x).length === 1);
    await p.keyboard.press("Escape"); await wait(300);
    /* QA round 2 (A5): this check pinned the refusal at send; the door is now never offered to a member on no club, and a
       door that pre-fills it leaves no type picked, so the form stops at the type and nothing is sent */
    await flow(p, "case", { type: "trade_request" });
    const noTr = await p.evaluate(() => ({ card: !!document.querySelector('.sheet input[value="trade_request"]'), picked: !!document.querySelector(".sheet .fl-cards input:checked"), menu: S2.navGroups().map((g) => (g.cols || []).map((c) => (typeof c.links === "function" ? c.links() : c.links) || [])).flat(2).filter((l) => l && l.type === "trade_request").length }));
    await next(p); await wait(250);
    A("a member on no club is not offered a trade request: no card, nothing picked from a door that pre-fills it, the form stays on the type, nothing sent",
      !noTr.card && !noTr.picked && noTr.menu === 0 && !(await p.$("#fldetails")) && !!(await p.$('.sheet .fl-cards input[value="complaint"]')) && calls(x).length === 1, noTr);
    await p.keyboard.press("Escape"); await wait(300);
    await done(x);
  }
  {
    /* QA round 2 (A5): a rostered member (a roster spot this season, no seat) is offered a trade request, in the form and in
       the header's Action Center */
    const x = await open({ persona: "member", session: { teamId: GM.teamId }, reads: noSurvey }), p = x.p;
    const r = await p.evaluate(() => ({ team: S2.session.teamId, types: S2.caseTypes().map((c) => c[0]), menu: S2.navGroups().map((g) => (g.cols || []).map((c) => (typeof c.links === "function" ? c.links() : c.links) || [])).flat(2).filter((l) => l && l.type === "trade_request").length }));
    await flow(p, "case", { type: "trade_request" });
    const card = await p.evaluate(() => { const c = document.querySelector('.sheet input[value="trade_request"]'); return !!(c && c.checked); });
    A("a member on a club roster is offered a trade request, picked when a door pre-fills it", r.team === GM.teamId && r.types.indexOf("trade_request") >= 0 && r.menu > 0 && card, r);
    await p.keyboard.press("Escape"); await wait(300);
    await done(x);
  }
  {
    const closed = "Trades are closed for this season (Rule 2.4), and trade requests close with them, so a request cannot be filed now (Rule 2.3).";
    const x = await open({ persona: "gm", reads: noSurvey, writes: { "action_requests.insert": (args, info) => info.calls.length === 1 ? mock.ok([{ id: "tr-1" }])
      : { error: { code: "23514", message: closed, hint: "trade_requests_closed", details: null } } } }), p = x.p;
    await flow(p, "case", { type: "trade_request" });
    await next(p); await wait(250); await p.fill("#fldetails", "A move, please."); await next(p); await wait(250); await send(p); await settled(p);
    const c = calls(x)[0];
    A("a trade request goes to the filer's own club's front office (route manager, the club's id)", c && c.args.row.type === "trade_request" && c.args.row.route === "manager" && c.args.row.team_id === GM.teamId, c);
    A("its receipt says only the club's front office sees it", /Sent to your club's front office/.test(await sheet(p)));
    await p.keyboard.press("Escape"); await wait(300);
    await flow(p, "case", { type: "trade_request" });
    await next(p); await wait(250); await p.fill("#fldetails", "Another one."); await next(p); await wait(250); await send(p); await settled(p);
    A("past the deadline the database's trade_requests_closed sentence is shown, the answers kept", (await p.textContent(".sheet .fl-senderr")) === closed && /Another one\./.test(await p.textContent(".sheet .fl-sum")));
    A("and the trade request door is gone for the rest of the visit", await p.evaluate(() => S2.caseTypes().every((t) => t[0] !== "trade_request") && S2.forms.tradeRequestsClosed()));
    await done(x);
  }

  console.log("## direct messages (direct_messages)");
  {
    const x = await open({ persona: "member", reads: noSurvey, writes: { "direct_messages.insert": () => mock.ok([{ id: "dm-1" }]) } }), p = x.p;
    const other = await p.evaluate((me) => { const m = S2.M.players.filter((y) => y.id !== me)[0]; return { id: m.id, tag: m.tag }; }, MEMBER.profileId);
    await flow(p, "message");
    A("the To box offers the league's members", await p.evaluate(() => document.querySelectorAll("#flto-l option").length > 50));
    await p.fill("#flto", "Nobody By This Name 0000"); await p.fill("#flbody", "Hello."); await next(p); await wait(250);
    A("a name that is no member is stopped at the field, nothing sent", /Pick a member from the list/.test(await sheet(p)) && calls(x).length === 0);
    await p.fill("#flto", other.tag); await next(p); await settled(p);
    const c = calls(x)[0];
    A("a member's message is one direct_messages row from the member to the picked member", c && c.rpc === "direct_messages.insert" && JSON.stringify(c.args.row) === JSON.stringify({ sender_id: MEMBER.profileId, recipient_id: other.id, body: "Hello." }), c);
    A("and its receipt", /Message sent/.test(await sheet(p)));
    await done(x);
  }

  console.log("## the survey before the sign-up (submit_season_survey, season_survey_done)");
  {
    const x = await open({ persona: "member", reads: Object.assign(onFile(), { "rpc:season_survey_done": () => ({ data: false }) }),
      writes: { submit_season_survey: (args, info) => info.calls.length === 1 ? mock.fail("P0001", "SURVEY: That survey is not open.") : mock.ok(true) } }), p = x.p;
    await p.evaluate(() => S2.flow("register")); await p.waitForSelector(".sheet .sv"); await wait(300);
    A("not finished on the server: the sign-up door opens the survey first", /Before you sign up, help shape Season 2/.test(await sheet(p)) && reads.some((q) => q.name === "season_survey_done" && q.args.p_survey === "s2-2026"));
    await p.click('.sheet [data-sv="next"]'); await wait(450);
    await p.fill("#sv-worked", " Games started on time. "); await wait(400);
    for (let i = 0; i < 2; i++) { await p.click('.sheet .sv-foot [type="submit"]'); await wait(450); }
    await p.click('.sheet input[data-k="locks"][value="open"]', { force: true }); await wait(400);
    for (let i = 0; i < 5; i++) { await p.click('.sheet .sv-foot [type="submit"]'); await wait(450); }
    await p.click('.sheet .sv-foot [type="submit"]'); await wait(700);
    const r = await p.evaluate(() => ({ err: (document.querySelector(".sheet .sv-err") || {}).textContent, hidden: (document.querySelector(".sheet .sv-err") || {}).hidden, q: (document.querySelector(".sheet .sv-q") || {}).textContent, btn: (document.querySelector('.sheet .sv-foot [type="submit"]') || {}).textContent }));
    const c = calls(x)[0];
    A("Finish sends the live site's keys and words, from the sign-up", c && c.rpc === "submit_season_survey" && c.args.p_survey === "s2-2026" && c.args.p_source === "signup"
      && JSON.stringify(c.args.p_answers) === JSON.stringify({ worked: "Games started on time.", positions: "Keep positions open" }), c);
    A("a refusal stays on the last question with the database's words, Finish back", r.err === "Not saved: That survey is not open." && !r.hidden && /Anything you would like to see/.test(r.q) && r.btn === "Finish", r);
    await p.click('.sheet .sv-foot [type="submit"]'); await wait(800);
    A("the database's true brings the thanks, and Continue goes on to the sign-up form", /Thanks, that helps/.test(await sheet(p)));
    await p.click('.sheet [data-sv="end"]'); await wait(700);
    A("the sign-up form follows", !!(await p.$("#flea")));
    await p.keyboard.press("Escape"); await wait(400);
    await p.evaluate(() => S2.flow("register")); await wait(500);
    A("finished: the next sign-up goes straight to the form", !!(await p.$("#flea")) && !(await p.$(".sheet .sv")));
    await done(x);
  }
  {
    const x = await open({ persona: "member", reads: Object.assign(onFile(), { "rpc:season_survey_done": () => ({ data: null, error: { message: "network" } }) }) }), p = x.p;
    await p.evaluate(() => S2.flow("register")); await wait(600);
    A("an unknown answer from season_survey_done keeps the survey shut (fail closed): the form opens", !!(await p.$("#flea")) && !(await p.$(".sheet .sv")));
    await done(x);
  }

  console.log("## the button doors: withdrawals and nominations (S2.forms)");
  {
    const x = await open({ persona: "member", reads: Object.assign({ "from:management_applications": () => ({ data: { status: "pending", seat_block: null } }) }, noSurvey), writes: {
      withdraw_owner_application: (args, info) => [mock.ok({ ok: true, status: "withdrawn", final: false }), mock.ok({ ok: false }), mock.fail("42501", "WITHDRAW: This application was already decided.")][info.calls.length - 1],
      withdraw_staff_application: () => mock.ok({ ok: true, status: "withdrawn" }),
      "management_applications.insert": () => mock.ok([{ id: "nom-1", status: "pending" }]),
      "management_applications.update": () => mock.ok([{ id: "nom-1" }]) } }), p = x.p;
    const r = await p.evaluate(async () => {
      const t = (pr) => pr.then((v) => ({ ok: v }), (e) => ({ err: S2.forms.said(e), code: e.code }));
      return { w1: await t(S2.forms.withdrawOwner("app-1")), w2: await t(S2.forms.withdrawOwner("app-1")), w3: await t(S2.forms.withdrawOwner("app-1")), ws: await t(S2.forms.withdrawStaff("sa-1")),
        none: await t(S2.forms.withdrawOwner(null)),
        nom: await t(S2.forms.nominate({ teamId: "team-1", role: "agm", nomineeId: "p-2", pitch: " Steady. " })), bad: await t(S2.forms.nominate({ teamId: "team-1", role: "owner", nomineeId: "p-2" })),
        wn: await t(S2.forms.withdrawNomination("nom-1")) };
    });
    const c = calls(x);
    A("an owner withdrawal resolves only on the door's confirmed status", r.w1.ok && r.w1.ok.status === "withdrawn" && c[0].rpc === "withdraw_owner_application" && c[0].args.p_app === "app-1", r.w1);
    A("an answer without the confirmed status is a failure, never a success", r.w2.code === "S2_UNCONFIRMED", r.w2);
    A("a refusal prints without its WITHDRAW: prefix", r.w3.err === "This application was already decided.", r.w3);
    A("the staff withdrawal calls its own door", r.ws.ok && c[3].rpc === "withdraw_staff_application" && c[3].args.p_app === "sa-1");
    A("no application, no call", r.none.code === "S2_BAD_CALL" && c.filter((y) => /withdraw/.test(y.rpc)).length === 4);
    const n = c.filter((y) => y.rpc === "management_applications.insert")[0];
    A("a nomination is one management_applications row, its status read back", n && JSON.stringify(n.args.row) === JSON.stringify({ team_id: "team-1", role: "agm", submitted_by: MEMBER.profileId, nominee_id: "p-2", pitch: "Steady." }) && r.nom.ok && r.nom.ok.status === "pending" && r.nom.ok.reread, [n, r.nom]);
    A("a seat that is not GM or AGM is refused before anything is sent", r.bad.code === "S2_BAD_CALL" && c.filter((y) => y.rpc === "management_applications.insert").length === 1);
    const u = c.filter((y) => y.rpc === "management_applications.update")[0];
    A("withdrawing a nomination updates that row to withdrawn", u && u.args.match.id === "nom-1" && u.args.set.status === "withdrawn" && r.wn.ok, u);
    await done(x);
  }

  console.log("## a phone");
  {
    const x = await open({ persona: "staff", reads: Object.assign({ "from:owner_applications": () => ({ data: null }) }, noSurvey) }), p = x.p;
    await p.setViewportSize({ width: 375, height: 760 }); await wait(200);
    await flow(p, "owner");
    A("the owner form with its notes fits 375 wide", await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && [...document.querySelectorAll(".sheet .fl-warn")].every((n) => n.getBoundingClientRect().right <= innerWidth + 1)));
    await done(x);
  }

  A("no console errors", errors.length === 0, errors.slice(0, 6));
  await b.close();
  console.log(fails ? fails + " FAILED" : "ALL PASSED");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
