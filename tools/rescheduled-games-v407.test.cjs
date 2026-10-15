/* v4.07 (commissioner, 2026-10-14): "It looks like the Stars and Islanders had their Friday 10:10 PM games removed from
   this week because of their reschedule. They should still have all their normal games, just the rescheduled game tacked
   on after the fact." The lineup page's nine-game cap is pinned in tools/lineup-per-game.test.cjs. This pins the rest:
   the make-up mark (games.rescheduled_from), the office's schedule check, the one reschedule door, and Rule 3.3.
   Run: node tools/rescheduled-games-v407.test.cjs */
const fs = require("fs"), vm = require("vm"), path = require("path");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + got)); } };
const ROOT = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const live = R("src/live/part_live.js");

console.log("— the database record (sql/2026-10-14-rescheduled-games-v407.sql)");
const sql = R("sql/2026-10-14-rescheduled-games-v407.sql");
A("games.rescheduled_from exists", /alter table public\.games add column if not exists rescheduled_from timestamptz;/.test(sql));
A("...readable by the site (games is read through column grants; an ungranted column fails the boot query)",
  /grant select \(rescheduled_from\) on public\.games to anon, authenticated;/.test(sql));
A("...and members are given nothing else on it", !/grant (insert|update)[^;]*rescheduled_from/i.test(sql));
A("ops_reschedule_game keeps the FIRST original time and clears the mark when a game goes back to it",
  /rescheduled_from = case when p_at = coalesce\(g\.rescheduled_from, g\.scheduled_at\) then null\s+else coalesce\(g\.rescheduled_from, g\.scheduled_at\) end/.test(sql));
A("games already moved are marked from the office's own audit trail", /where a\.action = 'reschedule_game'/.test(sql) && /min\(\(a\.detail->>'from'\)::timestamptz\)/.test(sql));
A("...and the migration proves the Oct 9 make-up was marked", /d6359d09-9414-4bea-9f67-9a153b01ee49/.test(sql));
A("the reschedule messages lose their spaced hyphens (they reach the public transactions feed)",
  /b1 text := 'That date has passed\. Pick a slot the clubs can actually play\.';/.test(sql) && /b2 text := 'Rescheduled: %s at %s moved to %s ET\.';/.test(sql));
A("the office caption says what a moved game still counts toward",
  /is not checked for its night or puck-drop time here, but it still counts toward each club/.test(live) && !/a moved game is never counted here/.test(live));

console.log("\n— the site reads the mark");
A("the games select asks for rescheduled_from", /CG\.GAME_PUBLIC_COLS = [\s\S]{0,400}"rescheduled_from";/.test(live));
A("...and a game carries it as rescheduledFrom", /rescheduledFrom: g\.rescheduled_from \? Date\.parse\(g\.rescheduled_from\) : null/.test(live));

console.log("\n— the office's schedule check reads a make-up as a make-up");
{
  const m = live.match(/CG\.shapeMismatch = function\(\)\{[\s\S]*?\n\};/);
  A("located CG.shapeMismatch", !!m);
  const ET = (s) => Date.parse(s + "-04:00");
  const mk = (id, home, away, at, extra) => Object.assign({ id, home, away, at: ET(at), stage: "regular", status: "scheduled" }, extra || {});
  const games = [];
  let k = 0;
  for (const day of ["2026-10-14", "2026-10-15", "2026-10-16"]) for (const t of ["21:00", "21:35", "22:10"]) games.push(mk("g" + (k++), "DAL", "NYI", day + "T" + t + ":00"));
  const makeup = mk("mk", "DAL", "NYI", "2026-10-14T20:25:00", { rescheduledFrom: ET("2026-10-09T21:00:00") });
  const ctx = { console, Math, Object, Array, String, Number, JSON, Date, Intl };
  ctx.CG = {
    SEASON: { id: "s1" },
    seasonShape: () => ({ perClub: 10, weeks: 1, nights: 3, perNight: 3, slots: ["21:00", "21:35", "22:10"] }),
    nightNames: () => ["Wed", "Thu", "Fri"],
    etYMD: (at) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(at)),
  };
  vm.createContext(ctx);
  vm.runInContext(m ? m[0] : "", ctx);
  ctx.CG.lg = { schedule: games.concat([makeup]) };
  A("a make-up at 8:25 PM is not a schedule that disagrees with the season", ctx.CG.shapeMismatch() === null, JSON.stringify(ctx.CG.shapeMismatch()));
  ctx.CG.lg = { schedule: games.concat([Object.assign({}, makeup, { rescheduledFrom: null })]) };
  const flagged = ctx.CG.shapeMismatch();
  A("...while a game at an off-shape time that nobody moved still is", Array.isArray(flagged) && flagged.some((t) => /Puck-drop times differ/.test(t)), JSON.stringify(flagged));
  ctx.CG.lg = { schedule: games.concat([makeup]) };
  ctx.CG.seasonShape = () => ({ perClub: 9, weeks: 1, nights: 3, perNight: 3, slots: ["21:00", "21:35", "22:10"] });
  A("...and a make-up still counts toward each club's total games", (ctx.CG.shapeMismatch() || []).some((t) => /gives each club 10 games/.test(t)));
}
A("the card no longer claims nothing has been played when games are final",
  /var finals = \(CG\.lg\.schedule\|\|\[\]\)\.filter\(function\(g\)\{ return g\.status === "final"; \}\)\.length;/.test(live) &&
  /do not clear the season to fix this<\/b>, because regenerating deletes those results/.test(live));

console.log("\n— one door for moving a game");
A("the Control Center's Reschedule goes through ops_reschedule_game", /CG\.sb\.rpc\("ops_reschedule_game", \{ p_game: id, p_at: iso \}\)/.test(live));
const site = ["part_live.js", "part6_hub.js", "part7_admin.js", "part9_staffdesks.js", "part5a_public.js", "part5b_public2.js", "part4_ui.js"]
  .map((f) => R("src/live/" + f)).join("\n");
A("nothing on the site moves a game by writing games.scheduled_at itself", !/from\("games"\)\.update\(\{[^}]*scheduled_at/.test(site));
A("both reschedule screens use the same database door", (site.match(/rpc\("ops_reschedule_game"/g) || []).length >= 2);

console.log("\n— Rule 3.3 and the changelog, as published");
{
  const CG = {};
  new Function("CG", R("src/live/part3_content.js"))(CG);
  const rb = CG.CONTENT.rulebook;
  const r33 = rb.chapters.find((c) => c.num === 3).sections.find((s) => s.id === "3.3");
  A("Rule 3.3: a moved game is played on top of that week's schedule and never displaces another",
    /A game moved into another week is played on top of that week's schedule: it never replaces or removes any of the clubs' other games, and each club still plays every game on its schedule\./.test(r33.paragraphs[0]));
  A("...in both formats (3.3 has no separate full text)", !r33.full);
  A("the changelog has its 4.07 entry", rb.changelog.some((c) => c.version === "4.07"));
}

console.log(fail ? `\n${fail} of ${n} FAILED` : `\nall ${n} passed`);
process.exit(fail ? 1 : 0);
