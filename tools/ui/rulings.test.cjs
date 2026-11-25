const S2_BASE = process.env.S2_BASE || (() => { throw new Error("S2_BASE unset: run through tools/ui/run.cjs") })();
const S2_ROOT = process.env.S2_ROOT || (() => { throw new Error("S2_ROOT unset: run through tools/ui/run.cjs") })();
/* The commissioner's November 23 rulings in the concept: node tools/ui/run.cjs rulings (needs the s2-concept server on
   S2_BASE (tools/ui/run.cjs)). Answers to the cutover list, 2026-11-23:
   5. "remove the waitlist entirely from the website and rulebook."
   6. "I prefer glacier and keep the current fonts shown on the concept site."
   10. the waiver readings confirmed, "but add a confirm popup when a team tries to place someone on waivers acknowledging
       they cannot reclaim them until they have cleared waivers and become available during the Saturday bidding."
   12. "do 3 forwards, 2 defensemen, and 1 goalie." (minimums, no maximums)
   13. "The agm can be nominated only after the draft completes, and must be a player on the current roster. A team cannot
       nominate a player to be AGM from another roster, or training camp."
   v5.00 swap (i3b, 2026-11-25): the suite runs the REAL site (stream h0's live mode, tools/ui/mock/index.cjs) on the
   recorded production s2_league, each page as a persona (anon, member, gm, staff, commissioner). Deleted with the demo,
   each pinning only a demo device: the concept sheet and its dock, the #/concept page, S2.demo.waive's minimum stop, Team
   HQ's demo seats and AGM nomination (S2.market.now moved by hand), Team HQ's demo waiver sheet and the demo market's
   own-claim refusal (the ruled popup, its box and the database's refusal are pinned on S2.market.waiveDoor in
   market.test.cjs), the sample clubs' twelve and their note, the mock draft room's seats, and every View as. Reads only;
   nothing reaches production. */
const mock = require(process.env.S2_MOCK);
const { chromium } = require(mock.PW);
const BASE = S2_BASE;
/* a persona for each of the concept's roles */
const AS = { guest: "anon", player: "member", office: "gm", staff: "staff", commish: "commissioner" };
/* the recording (2026-11-24 01:30 UTC) predates v4.58, which set the Season 2 row to ten rounds and a $30M cap on
   production the same day; the league is served with the row as production holds it now */
const v458 = (body) => { (body.seasons || []).forEach((s) => { if (s.number === 2) { s.draft_rounds = 10; s.salary_cap = 30000000; } }); return body; };
const LEAGUE = { s2_league: (a) => mock.ok(v458(mock.league({ p_season: a.p_season }))) };
/* the reads the pages make beside the league's, answered empty: the forms' applications on file (js/flows.js), the staff
   desk's keys (js/pages/desk.js), and Team HQ's office (js/pages/hq.js) */
/* the league's people as the harness's default profiles table holds them, with the columns You, Settings reads (the
   member's league profile: js/pages/you.js), empty */
const PROFILES = mock.league({}).people.map((x) => ({ id: x.id, gamertag: x.gamertag, display_name: x.display_name, avatar_url: x.avatar_url, role: x.role, banned: !!x.banned, ban_reason: null,
  discord_id: null, discord_username: null, in_guild: true, ea_id: null, platform: null, platform_gamertag: null, preferred_server: null, jersey_number: null, ea_player_id: null }));
const READS = { tables: { owner_applications: [], staff_applications: [], committee_applications: [], management_applications: [], team_mgmt_policy: [], team_mgmt_moves: [],
  club_notices: [], trades: [], action_requests: [], draft_boards: [], market_waivers: [], market_pool_requests: [], market_boards: [], market_bid_nights: [], market_lots: [], market_bids: [], application_ballots: [], suspension_requests: [] },
  rpcs: { has_department: mock.ok(false), is_app_reviewer: mock.ok(false), is_any_committee_manager: mock.ok(false), my_discord_accounts: mock.ok([]), staff_voter_count: mock.ok(11),
    market_calendar: mock.ok({}), market_pool: mock.ok([]), market_club_state: mock.ok(null) } };
let fails = 0;
const A = (name, cond, more) => { console.log((cond ? "PASS " : "FAIL ") + name + (cond || more == null ? "" : "  (" + (typeof more === "string" ? more : JSON.stringify(more)).slice(0, 600) + ")")); if (!cond) fails++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/* v5.00 swap (e6, one book; main session 2026-11-24): the rulebook page is the ONE published book (S2.RB, js/rulebook.js,
   generated from src/live), so the rulings below are pinned in the live book's own words and nothing is marked proposed.
   Text the held staffing flip rewrites (tools/s2-rulebook/rulebook-s2.json, run only in the flip commit) is pinned as
   published today and marked "moves with the staffing flip". */

(async () => {
  const b = await chromium.launch();
  const errors = [];
  async function page(hash, o) {
    o = o || {};
    const ctx = await b.newContext(Object.assign(o.w ? { viewport: { width: o.w, height: 812 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 900 } }, o.dark ? { colorScheme: "dark" } : {}));
    await ctx.addInitScript((x) => { try { localStorage.setItem("s2.introSeen", "true"); localStorage.setItem("s2.survey", JSON.stringify({ done: "2026-11-01" }));
      if (x.finish) localStorage.setItem("s2.finish", JSON.stringify(x.finish)); } catch (e) { /* storage blocked: the page still renders */ } }, { finish: o.finish });
    await mock.install(ctx, { live: true, persona: AS[o.role || "guest"], session: o.session, tables: Object.assign({}, READS.tables, o.tables || {}), rpcs: Object.assign({}, LEAGUE, READS.rpcs, o.rpcs || {}) });
    const p = await ctx.newPage();
    p.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    await p.goto(BASE + hash);
    await p.waitForFunction(() => window.S2 && S2.M && S2.LIVE && S2.auth && S2.auth.sub && document.querySelector("#app section, #app header"), null, { timeout: 30000 });
    await wait(450);
    return p;
  }
  const unexpected = [];
  const done = (p) => { unexpected.push(...mock.unexpected(p.context())); return p.context().close(); };
  const go = async (p, hash) => { await p.evaluate((h) => { location.hash = h; }, hash); await wait(450); };
  const sheetGone = async (p) => { await p.waitForFunction(() => !document.querySelector(".sheet")); await wait(80); };
  let p, r;

  console.log("## 5. the waitlist is gone, rulebook included");
  p = await page("#/rulebook");
  r = await p.evaluate(() => {
    const sec = document.getElementById("rb-2.6"), paras = sec ? [...sec.querySelectorAll(".lg-rb-p")] : [];
    const RB = S2.RB, inForce = RB.chapters.filter((c) => !c.shelved);
    return { has: !!sec, title: sec && sec.querySelector(".lg-rb-st").textContent, n: paras.length, wl: /waitlist/i.test(document.getElementById("rbBody").textContent),
      p3: paras[3] && paras[3].textContent, kicker: document.querySelector(".lg-hero .kicker").textContent, lede: document.querySelector(".lg-hero .lede-l").textContent,
      toc: !!document.querySelector('.lg-toc-a[data-rule="2.6"]'), marks: document.querySelectorAll(".lg-rb-p.prop, .lg-rb-prop-n").length, version: RB.version,
      chapters: inForce.length, sections: inForce.reduce((a, c) => a + c.sections.length, 0), releases: RB.changelog.length,
      rendered: document.querySelectorAll("#rbBody .lg-rb-sec").length, all: RB.chapters.reduce((a, c) => a + c.sections.length, 0),
      about: [...document.querySelectorAll("#lgAboutB > p")].map((x) => x.textContent).join(" "), hist: document.querySelectorAll("#lgAboutB .lg-rb-hist li").length };
  });
  A("Rule 2.6 is in the book, in Chapter 2, with its contents link", r.has && r.title === "2.6Team management structure" && r.n === 7 && r.toc, r);
  r.chips = await p.evaluate(() => [...document.querySelectorAll(".lg-rb-cht")].map((h) => [h.querySelector(".kicker").textContent, ((h.querySelector(".lg-rb-chip") || {}).textContent || "")]).filter((x) => x[1]));
  A("the current site's chapter chips: Season 2 on Chapter S2, not in force on Appendix A, and on no other chapter", JSON.stringify(r.chips) === JSON.stringify([["Chapter S2", "Season 2"], ["Appendix A", "not in force"]]), r.chips);
  A("no word of the waitlist anywhere in the rulebook", !r.wl);
  /* the About disclosure carries the version history (S2.RB's changelog): opened, the page still names no waitlist, since
     the two releases that described it show their version and date only (review 2026-11-24) */
  const ab = await p.evaluate(() => { const d = document.getElementById("lgAbout"); if (d) d.open = true;
    return { open: !!(d && d.open), hist: document.querySelectorAll("#lgAboutB .lg-rb-hist li").length, wl: /wait\s*-?\s*list/i.test(document.body.innerText + " " + document.getElementById("page").textContent),
      bare: [...document.querySelectorAll("#lgAboutB .lg-rb-hist li")].filter((li) => !li.querySelector("p")).map((li) => li.querySelector(".num").textContent) }; });
  A("About opened, with its version history: no waitlist anywhere on #/rulebook", ab.open && ab.hist > 0 && !ab.wl, ab);
  A("the releases held back show version and date only: the three that name members and the two that described the waitlist", JSON.stringify(ab.bare) === '["v4.22","v3.84","v3.45","v2.20","v2.8"]', ab.bare);
  A("the book is the published one: no paragraph marked proposed, every section of S2.RB drawn", r.marks === 0 && r.rendered === r.all && r.all > 0, r);
  A("paragraph 4 now withdraws a pending application only", /may withdraw a pending owner application at any time/.test(r.p3) && /may withdraw a pending staff application at any time/.test(r.p3), r.p3);
  A("the hero names the published version and the basic format, the full format in Appendix A", r.kicker === "Rulebook, version " + r.version && /This season runs the basic format, the league standard; the full format is preserved in Appendix A\./.test(r.lede), [r.kicker, r.lede]);
  A("About says word for word, with the book's own counts, and lists every release", r.about.indexOf("This is the published rulebook, version " + r.version + ", word for word: ") === 0 && r.about.indexOf(" chapters and " + r.sections + " sections in force, and Appendix A") > 0 &&
    r.about.indexOf("It has had " + r.releases + " releases since ") > 0 && r.hist === r.releases && r.chapters === 12, r.about.slice(0, 300));
  await p.fill("#rbQ", "waitlist"); await wait(250);
  A("searching the rulebook for waitlist finds nothing", await p.evaluate(() => /No matches/.test(document.getElementById("rbCount").textContent)));
  await done(p);
  for (const [role, hash] of [["player", "#/you?tab=applications"], ["staff", "#/desk?tab=applications"], ["commish", "#/control?tab=staff"], ["guest", "#/season"]]) {
    p = await page(hash, { role });
    A(role + " " + hash + ": no waitlist on the page", await p.evaluate(() => !/waitlist/i.test(document.getElementById("page").textContent)));
    await done(p);
  }

  console.log("## 6. Glacier is the one finish; the type stays");
  p = await page("#/today", { finish: "gold" });
  r = await p.evaluate(() => ({ fin: document.documentElement.dataset.finish, state: S2.state.finish, accent: getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(),
    btn: !!document.getElementById("finishBtn"), font: getComputedStyle(document.querySelector("h1, .d-hero, .d-1") || document.body).fontFamily }));
  A("a Gold finish stored from an earlier visit is ignored: the page is Glacier", r.fin === "glacier" && r.state === "glacier" && r.accent.toLowerCase() === "#0a6cdf", r);
  A("the page has no finish button", !r.btn);
  A("headlines keep Archivo", /Archivo/.test(r.font), r.font);
  A("no Gold or Ember finish tokens are left in the style sheets", await p.evaluate(() => ![...document.styleSheets].some((sh) => { try { return [...sh.cssRules].some((x) => /data-finish="(gold|ember)"/.test(x.selectorText || "")); } catch (e) { return false; } })));
  await done(p);
  p = await page("#/you?tab=settings", { role: "player", dark: true, tables: { profiles: PROFILES } });
  r = await p.evaluate(() => ({ fin: document.querySelectorAll("[data-act=finish], .hqx-finishes").length, theme: document.querySelectorAll("[data-act=theme]").length, dark: document.documentElement.dataset.theme,
    accent: getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() }));
  A("You, Settings: Appearance is light or dark only", r.fin === 0 && r.theme === 2, r);
  A("dark mode keeps Glacier's dark accent", r.dark === "dark" && r.accent.toLowerCase() === "#3b94ff", r);
  await done(p);

  console.log("## 12. minimums of 3 F, 2 D and 1 G");
  p = await page("#/hq?tab=roster", { role: "office" });
  r = await p.evaluate(() => ({ min: S2.M.RULES.s2.min, cs: S2.market.clubState(S2.session.teamCode).mins, gauge: (document.querySelector(".hqx-gaugecard .sec-head p") || {}).textContent || "",
    page: document.getElementById("page").textContent }));
  A("one definition: M.RULES.s2.min and the market's club state say 3, 2 and 1", JSON.stringify(r.min) === '{"F":3,"D":2,"G":1}' && JSON.stringify(r.cs) === '{"F":3,"D":2,"G":1}', r);
  A("the Season 2 gauge says at least 3 forwards, 2 defense and 1 goaltender", /At least 3 forwards, 2 defense and 1 goaltender from the draft on/.test(r.gauge), r.gauge);
  A("the gauge says the AGM is named from the roster after the draft", /the Owner and GM are seated before it and 10 rounds follow \(Rule S2\.3\); the AGM is then named from the club's own roster \(Rule 2\.6\)/.test(r.gauge), r.gauge);
  A("no five-forward minimum is left on Roster & cap", !/at least 5 forwards|five forwards/i.test(r.page));
  await done(p);
  p = await page("#/camp");
  A("the training camp page says three forwards, two defense and one goaltender", await p.evaluate(() => /keeps at least three forwards, two defense and one goaltender/.test(document.getElementById("page").textContent)));
  await done(p);
  p = await page("#/season");
  await p.click('[data-door="draft"]'); await wait(450);
  r = await p.evaluate(() => document.querySelector(".sheet").textContent);
  A("the draft room's door: ten rounds, the GM before it, the AGM after it from the twelve, the 3/2/1 minimums", /The draft is ten rounds\. Every club must have its General Manager seated before it, so the Owner, the General Manager and the ten picks make a club's twelve; the Assistant General Manager is named after it, from those players/.test(r) && /three forwards, two defense and one goaltender inside its twelve/.test(r), r);
  await done(p);
  p = await page("#/rulebook?rule=S2.4");
  r = await p.evaluate(() => ({ s24: document.querySelector('#rb-S2\\.4 .lg-rb-p').textContent, s23: document.querySelector('#rb-S2\\.3 .lg-rb-p').textContent }));
  A("S2.4 says three (3) forwards, two (2) defensemen and one (1) goaltender, and no maximum", /Every roster must include at least three \(3\) forwards, two \(2\) defensemen and one \(1\) goaltender from the draft onward, through the end of the playoffs, and no position group has a maximum/.test(r.s24), r);

  console.log("## 13. the AGM after the draft, from the club's own roster");
  /* coordinator, 2026-11-23: the commissioner set the draft at ten rounds the same day (Owner + GM + ten picks = 12) */
  A("S2.3: ten rounds, the GM before the draft, the Owner, GM and ten picks make twelve, the AGM after it from the roster, and the GM from the roster once the draft starts",
    /^1The draft is ten \(10\) rounds\. Every club must have its Owner and its General Manager seated before the draft begins: the Owner must nominate a General Manager in time for the nomination to be decided before the draft \(Rule 2\.6\), so that the Owner, the General Manager and the club's ten \(10\) selections make up its twelve \(12\) players \(Rule S2\.4\)\. An Owner may nominate their Assistant General Manager only after the draft is complete, from the players then on the club's roster, never from another club's roster or the training camp pool \(Rule 2\.6\)\. From the start of the draft, a General Manager is likewise nominated only from the players on the club's own roster\.$/.test(r.s23), r);
  r = await p.evaluate(() => document.querySelector('#rb-2\\.6 .lg-rb-p').textContent);
  /* the published 2.6 keeps the standing windows and hands Season 2's to Rule S2.3 in its last sentence (v4.58) */
  A("2.6: the Owner and GM seats before the draft, the AGM's later, and Season 2's windows from Rule S2.3: the AGM only after the draft, from the club's own roster",
    /Every club must hold its Owner and General Manager seats before the entry draft begins; the Assistant General Manager's seat may be filled later \(Rule 2\.8\)\./.test(r) &&
    /For Season 2, Rule S2\.3 governs the windows: once the draft starts, a General Manager is nominated only from the players on the club's own active roster, and the Assistant General Manager only after the draft is complete and only from that roster, never from another club or the training camp pool\.$/.test(r) &&
    /Between the end of the playoffs and the next entry draft, the Owner may name anyone signed up for the coming season/.test(r), r.slice(-400));
  await done(p);
  console.log("## 10. the waiver, in the book");
  p = await page("#/rulebook?rule=S2.5");
  r = await p.evaluate(() => ({ t: document.querySelectorAll('#rb-S2\\.5 .lg-rb-p')[1].textContent }));
  A("S2.5: 24 hours, the first valid claim, and the waiving club may not claim, only bid once eligible", /A waived player stays on waivers for twenty-four \(24\) hours, during which any other club may claim them at the salary they carried, if the claiming club has an open roster spot and room under the salary cap for that salary; the first valid claim is accepted at once\. The club that placed the player on waivers may not claim them: it may get them back only by bidding, once they have cleared waivers and are eligible in a bidding event \(Rule S2\.6\)/.test(r.t), r);
  await done(p);

  console.log("## ten rounds: the Owner and GM before the draft, the AGM from the twelve after it (2026-11-23)");
  p = await page("#/draft", { role: "office" });
  r = await p.evaluate(() => ({ rounds: S2.M.RULES.s2.draftRounds, limit: S2.M.RULES.s2.limit, about: [...document.querySelectorAll("details p")].map((x) => x.textContent).join(" "),
    hero: (document.querySelector(".lg-hero h1") || {}).textContent || "" }));
  A("ten draft rounds and a twelve-player limit", r.rounds === 10 && r.limit === 12, r);
  A("the room's hero says ten rounds", /^Ten rounds, \d+ picks$/.test(r.hero), r.hero);
  A("the room's About says the AGM is named from the twelve after the draft", /[Tt]he Assistant General Manager is named from the club.s twelve after the draft/.test(r.about) && /ten rounds, the Owner and General Manager seated first/.test(r.about), r.about.slice(0, 400));
  await done(p);
  p = await page("#/season");
  A("the Season page's draft door: 10 rounds, Owner and GM seated first", await p.evaluate(() => { const d = [...document.querySelectorAll(".lg-door")].filter((x) => /Draft room/.test(x.textContent))[0].textContent; return /Rounds10/.test(d) && /Seated firstOwner and GM, required/.test(d) && /Ten rounds, live/.test(d); }));
  await done(p);

  console.log("## the November 23 fix round: S2.2, the pool's requests (S2.5), Rule 2.7");
  p = await page("#/rulebook?rule=2.7");
  r = await p.evaluate(() => {
    const s = (id) => { const e = document.getElementById("rb-" + id); return e ? { p: [...e.querySelectorAll(".lg-rb-p")].map((x) => x.textContent.slice(1)) } : null; };
    return { s22: s("S2.2"), s23: s("S2.3"), s25: s("S2.5"), r27: s("2.7"), r32: s("3.2") };
  });
  /* v5.00 swap, the staffing flip (2026-11-25): S2.2 has the staff and the commissioners vote, not the reviewers (the
     all-staff vote of Rule 2.6; staffing.test.cjs pins it beside 2.6) */
  A("S2.2: no owner application is decided before applications close, the staff and commissioners vote, the clubs assigned by Saturday, December 5",
    /^No owner application is decided before applications close\. League staff and the commissioners may vote while applications are open; the league office decides every application and assigns the clubs in the week that follows, by Saturday, December 5\./.test(r.s22.p[1]) && !/Reviewers/i.test(r.s22.p[1]), r.s22.p[1].slice(0, 200));
  A("S2.5: a request is seen by the club's management, the player and staff until the night's lineup lock, then by everyone; the pool's channel is staff, management and the pool only",
    /Until the night's lineup lock, a request is visible only to the requesting club's management, the player requested and league staff; from the lock it is visible to everyone\./.test(r.s25.p[2]) &&
    /Management may ask pool players informally in the training camp channel of the league Discord, which is open only to league staff, club management and the training camp pool, whether they can play, but only a request made on the site counts\./.test(r.s25.p[0]), r.s25 && r.s25.p[2]);
  A("S2.5: a request is for one game and the player accepts or declines it; the first acceptance wins; one club a night; the site request is what counts",
    /A club's management may request a pool player to play one specific game for the club\. The request is made on the site, for that one game, and the player accepts or declines it on the site\./.test(r.s25.p[0]) &&
    /An accepted request covers that game alone and ends with it: the player takes no roster spot, signs no contract, and counts against neither the salary cap nor the roster limit\./.test(r.s25.p[0]) &&
    /the player's first acceptance wins: a pool player plays for only one club a night/.test(r.s25.p[0]) && /A suspended player can be neither requested nor dressed\./.test(r.s25.p[2]) && !/first club that requests them/.test(r.s25.p.join(" ")), r.s25.p[0].slice(0, 300));
  A("S2.5: three different pool players a night and three in a game, close and lapse at the lock, withdraw before it, the one-game guest, the forfeit",
    /A club may use at most three \(3\) different training camp pool players across a night, and no game lineup may include more than three \(3\), because at least half of every game lineup, three \(3\) of its six \(6\) players, must be the club's own rostered players; a lineup with four \(4\) or more pool players is refused\./.test(r.s25.p[2]) &&
    /Requests and answers close at the night's lineup lock, thirty \(30\) minutes before the night's first scheduled puck drop, when the server picks of Rule 4\.2 freeze, and a request not answered by then lapses\./.test(r.s25.p[2]) &&
    /Until that lock, the club may withdraw a request or release a player who has accepted, and the player may withdraw their acceptance/.test(r.s25.p[2]) &&
    /plays only in the game accepted, may play any position in it, and receives that game's lobby code by direct message, with no access to the club's room/.test(r.s25.p[2]) && /never treated as an unrostered player/.test(r.s25.p[2]) &&
    /A club that has not set a full lineup of six \(6\) for a game by that game's lineup lock forfeits the game \(Rule 3\.2\)\.$/.test(r.s25.p[2]) && r.s25.p.length === 3, r.s25.p[2]);
  A("S2.3: a skipped selection that cannot be filled when the draft ends lapses, filled later only by a claim or bidding",
    /A selection it cannot fill, because the club's roster is full or no player who was not selected keeps the club able to meet the minimums, lapses: it is not filled later, the commissioners are told, and the club fills the spot by a waiver claim or in a bidding event \(Rules S2\.5 and S2\.6\)\./.test(r.s23.p[1]), r.s23.p[1].slice(-300));
  A("3.2: no full lineup of six by the game's lock forfeits it, ruled once at the lock, in every stage",
    /^For Season 2, a club that has not set a full lineup of six \(6\) for a game by that game's lineup lock, thirty \(30\) minutes before its scheduled puck drop \(Rule 5\.3\), forfeits the game; if neither club has set one, the game is voided\. The forfeit, or the void, is ruled once, at the lock, and a lineup filed after the lock does not undo it\. This applies in every stage of the season, the playoffs included \(Rule S2\.5\)\.$/.test(r.r32.p[r.r32.p.length - 1]), r.r32.p[r.r32.p.length - 1]);
  /* the staffing flip rewrites paragraph 2's first sentence (no staff department left to name); the sentence pinned here survives it */
  A("Rule 2.7: no exception, the submission rule (staff never apply to own, seat holders never apply to the staff, until they leave the seat), and no sit-out for a member who leaves before the decision",
    !!r.r27 && /may not be held at once, and there is no exception/.test(r.r27.p[0]) && /A commissioner or staff member shall not file an application to own a club, and a club's Owner, General Manager or Assistant General Manager shall not file an application to join the staff, until they step down from, or are removed from, the conflicting seat\./.test(r.r27.p[1]) &&
    !/loses their staff role|Media/.test(r.r27.p.join(" ")) && /The one-season wait does not apply to a member who leaves the staff before their owner application is decided\./.test(r.r27.p[3]), r.r27);
  await done(p);

  console.log("## the playoff ruling (2026-11-24): the series limits and eligibility at the signed-up group");
  p = await page("#/rulebook?rule=8.3");
  r = await p.evaluate(() => {
    const s = (id) => { const e = document.getElementById("rb-" + id); return e ? { p: [...e.querySelectorAll(".lg-rb-p")].map((x) => x.textContent.slice(1)) } : null; };
    return { r83: s("8.3"), s27: s("S2.7") };
  });
  A("8.3: four games of a series, goaltenders and camp players included, removed automatically at four, and from Season 2 two of the first four",
    /No player, whether a skater, a goaltender or a training-camp player, may play in more than four \(4\) games of a single series\./.test(r.r83.p[2]) &&
    /Once the box scores show that a player has played four \(4\) games of a series, that player is removed automatically from every lineup filed for the remaining games of that series/.test(r.r83.p[2]) &&
    /From Season 2, a player may also play in no more than two \(2\) of the first four \(4\) games of a series \(Rule S2\.7\)\.$/.test(r.r83.p[2]), r.r83 && r.r83.p[2].slice(-300));
  A("8.3: the floor is six, prorated by share, and from Season 2 only games at the signed-up group count",
    /\(the playoff eligibility floor\) is six \(6\)/.test(r.r83.p[3]) && /needs the same share of that figure/.test(r.r83.p[3]) && /From Season 2, only games played at the player's signed-up position group count toward the floor \(Rule S2\.7\)\.$/.test(r.r83.p[3]), r.r83.p[3].slice(-400));
  A("S2.7: six games at the signed-up group, any position any night, two of the first four and four of a series",
    /at least the playoff eligibility floor of Rule 8\.3, six \(6\) regular-season games, prorated for a player first placed after opening night, at the position group they signed up for that season: forward, defense or goaltender\./.test(r.s27.p[0]) &&
    /may play any position on a given night, but only games at their signed-up group count toward the floor/.test(r.s27.p[0]) &&
    /^No player, goaltenders included, may play in more than four \(4\) games of a playoff series, nor in more than two \(2\) of its first four \(4\) games\./.test(r.s27.p[1]), r.s27);
  await done(p);

  console.log("## Rule 2.7's submission rule at the forms (late ruling, 2026-11-23)");
  const lockOf = (q) => q.evaluate(() => { const s = [...document.querySelectorAll(".sheet")].pop(); return s ? { t: s.textContent, as: (s.querySelector('[data-lk="as"]') || {}).textContent || "", form: !!s.querySelector(".fl form, .fl .fl-f, .fl [data-fill]") } : null; });
  /* on the real site a Rule 2.7 conflict is a note on the form, never a lock (js/flows.js, e5): the form opens, says first
     what the database will refuse (guard_app_role_conflict, v4.58), and the database's refusal is what stops a filing */
  const formOf = (q) => q.evaluate(() => { const s = [...document.querySelectorAll(".sheet")].pop();
    return s ? { title: (s.querySelector("h2") || {}).textContent || "", lock: !!s.querySelector("[data-lk]"), as: !!s.querySelector('[data-lk="as"]'), notes: [...s.querySelectorAll(".fl-warn")].map((x) => x.textContent) } : null; });
  for (const [role, said] of [["staff", "Members of the league staff cannot apply to own a club (Rule 2.7). Leave the staff first, then apply."], ["commish", "Commissioners cannot apply to own a club (Rule 2.7). Step down as commissioner first, then apply."]]) {
    p = await page("#/season", { role });
    await p.evaluate(() => S2.flow("owner")); await wait(450);
    r = await formOf(p);
    A(role + ": the owner application opens with the Rule 2.7 note first, no lock and no View as", !!r && r.title === "Apply to own a club" && !r.lock && !r.as && r.notes.indexOf(said) >= 0, r);
    await done(p);
  }
  p = await page("#/season", { role: "office" });
  await p.evaluate(() => S2.flow("staff")); await wait(450);
  r = await formOf(p);
  A("a club seat holder: the staff application opens with the Rule 2.7 note first, no lock and no View as", !!r && r.title === "Apply to join the staff" && !r.lock && !r.as &&
    r.notes.indexOf("Owners, General Managers and Assistant General Managers cannot apply to join the league staff (Rule 2.7). Step down from your club seat first, then apply.") >= 0, r);
  await done(p);
  p = await page("#/season", { role: "player" });
  await p.evaluate(() => S2.flow("owner")); await wait(450);
  r = await formOf(p);
  A("a player with no seat meets no Rule 2.7 note: the owner application opens", !!r && r.title === "Apply to own a club" && !r.lock && !r.as && !r.notes.some((t) => /Rule 2\.7/.test(t)), r);
  await done(p);

  console.log("## phones and dark mode");
  for (const hash of ["#/hq?tab=office", "#/rulebook?rule=2.6"]) {
    p = await page(hash, { role: "office", w: 375, dark: true });
    A(hash + " at 375 in dark mode: no sideways scroll", await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await done(p);
  }

  A("no console errors", errors.length === 0, errors.slice(0, 5));
  A("every read the pages made was answered (nothing unexpected reached the fence)", unexpected.length === 0, unexpected.slice(0, 5));
  await b.close();
  console.log(fails ? fails + " FAILED" : "ALL PASSED");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
