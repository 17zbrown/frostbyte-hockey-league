/* Rulebook v2.32 — position changes close 11:59 PM ET on the Tuesday before the pre-season opens.
   Run: node tools/position-change-deadline.test.cjs   (build index.html first)

   The deadline is DERIVED from the schedule, not stored, so the thing most likely to break is the
   weekday arithmetic — and it only shows up once a year, on the one day it matters. These
   assertions pin it against every shape of week.

   NOT COVERED HERE: the database half — public.position_change_deadline() and the two gates it
   feeds (a BEFORE INSERT trigger on action_requests, and the approval branch of
   decide_position_change) — is the real enforcement and nothing in CI touches it. It was verified
   by rolled-back rehearsal against production: a season whose pre-season had already opened refused
   the insert naming the date, a season whose pre-season was still ahead accepted it, and
   is_commissioner() was false in that context so the guard was genuinely exercised rather than
   bypassed. Re-run that rehearsal if you change the SQL. */
const fs = require("fs"), vm = require("vm"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const content = R("src/live/part3_content.js");
const live = R("src/live/part_live.js");

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

const rb = JSON.parse(content.match(/CG\.CONTENT = (\{[\s\S]*?\});\n?$/)[1]).rulebook;
const findSec = (id) => {
  for (const ch of rb.chapters) for (const s of ch.sections) if (s.id === id) return s;
  throw new Error("no section " + id);
};
const sec = (id) => findSec(id).paragraphs.join(" ");
const secFull = (id) => { const s = findSec(id); return (s.full || s.paragraphs).join(" "); };

/* pull the two date helpers plus the deadline function out of part_live.js and run them for real */
const CG = { lg: {}, SEASON: { format: "full" } };   /* v2.48: these fixtures model the full-format pre-season path */
const grab = (name) => {
  const i = live.indexOf("CG." + name + " = function");
  if (i < 0) throw new Error("no CG." + name);
  return live.slice(i, live.indexOf("\nCG.", i + 5));
};
const runCtx = { CG, Date, Intl, isNaN, console };
{
  /* positionChangeDeadline now branches on CG.isBasic() — load the format block first */
  const fmtBlock = live.slice(live.indexOf("CG.FORMAT_RULES = {"), live.indexOf("CG.GROUP_NAME = {"));
  if (!fmtBlock || fmtBlock.indexOf("CG.FORMAT_RULES") !== 0) throw new Error("could not locate the format rules block");
  vm.runInNewContext(fmtBlock, runCtx);
}
vm.runInNewContext(grab("etISO") + "\n" + grab("etYMD") + "\n" + grab("positionChangeDeadline"), runCtx);

const etFull = (ts) => new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric",
  hour: "numeric", minute: "2-digit"
}).format(ts);

/* build a fake schedule whose first pre-season game falls on a given ET day */
const withFirstGame = (ymd, hm) => {
  CG.lg = { schedule: [
    { stage: "preseason", at: Date.parse(CG.etISO(ymd, hm || "21:00")) },
    { stage: "preseason", at: Date.parse(CG.etISO(ymd, "22:10")) + 864e5 },
    { stage: "regular",   at: Date.parse(CG.etISO(ymd, "21:00")) - 864e5 * 30 }
  ] };
  return CG.positionChangeDeadline();
};

console.log("— the real Season 1 date");
{
  const dl = withFirstGame("2026-09-16");   /* first pre-season game: Wed Sep 16, 9:00 PM ET */
  A("closes Tue Sep 15 at 11:59 PM ET", etFull(dl) === "Tue, Sep 15, 11:59 PM", etFull(dl));
  A("...which is 2026-09-16T03:59:00Z, matching the database",
    new Date(dl).toISOString() === "2026-09-16T03:59:00.000Z", new Date(dl).toISOString());
  A("...and is before the first game, not after", dl < Date.parse(CG.etISO("2026-09-16", "21:00")));
}

console.log("— every shape of week lands on a Tuesday at 11:59 PM");
{
  const cases = [
    ["Mon", "2026-09-21", "Tue, Sep 15, 11:59 PM"],
    ["Tue", "2026-09-15", "Tue, Sep 8, 11:59 PM"],   /* a Tuesday opener closes the Tuesday PRIOR */
    ["Wed", "2026-09-16", "Tue, Sep 15, 11:59 PM"],
    ["Thu", "2026-09-17", "Tue, Sep 15, 11:59 PM"],
    ["Fri", "2026-09-18", "Tue, Sep 15, 11:59 PM"],
    ["Sat", "2026-09-19", "Tue, Sep 15, 11:59 PM"],
    ["Sun", "2026-09-20", "Tue, Sep 15, 11:59 PM"]
  ];
  for (const [day, ymd, want] of cases) {
    const got = etFull(withFirstGame(ymd));
    A(`a ${day} opener closes ${want}`, got === want, got);
  }
  A("a Tuesday opener never closes on its own day — it goes back a full week",
    withFirstGame("2026-09-15") < Date.parse(CG.etISO("2026-09-15", "00:00")));
}

console.log("— it survives the clock changing");
{
  /* EST/EDT: a pre-season opening either side of the November change must still read 11:59 PM ET */
  const nov = etFull(withFirstGame("2026-11-11"));   /* after the US fall-back */
  const jul = etFull(withFirstGame("2026-07-15"));   /* deep in EDT */
  A("an EST-side opener still closes at 11:59 PM ET", /11:59 PM$/.test(nov), nov);
  A("an EDT-side opener still closes at 11:59 PM ET", /11:59 PM$/.test(jul), jul);
  A("...and both land on a Tuesday", /^Tue/.test(nov) && /^Tue/.test(jul), nov + " / " + jul);
}

console.log("— it follows the schedule, and degrades safely");
{
  const early = withFirstGame("2026-09-16"), late = withFirstGame("2026-09-30");
  A("re-spacing the pre-season moves the deadline with it", late > early,
    etFull(early) + " -> " + etFull(late));
  A("it reads the EARLIEST pre-season game, not whichever comes first in the array", (() => {
    CG.lg = { schedule: [
      { stage: "preseason", at: Date.parse(CG.etISO("2026-09-25", "22:10")) },
      { stage: "preseason", at: Date.parse(CG.etISO("2026-09-16", "21:00")) }
    ] };
    return etFull(CG.positionChangeDeadline()) === "Tue, Sep 15, 11:59 PM";
  })());
  A("regular-season games are ignored", (() => {
    CG.lg = { schedule: [{ stage: "regular", at: Date.parse(CG.etISO("2026-08-05", "21:00")) },
                         { stage: "preseason", at: Date.parse(CG.etISO("2026-09-16", "21:00")) }] };
    return etFull(CG.positionChangeDeadline()) === "Tue, Sep 15, 11:59 PM";
  })());
  A("with no pre-season games it falls back to preseason_starts_at", (() => {
    CG.lg = { schedule: [] };
    CG.SEASON = { format: "full", preseason_starts_at: CG.etISO("2026-09-16", "21:00") };
    const r = CG.positionChangeDeadline(); CG.SEASON = { format: "full" };
    return etFull(r) === "Tue, Sep 15, 11:59 PM";
  })());
  A("with nothing at all it returns null rather than a wrong date", (() => {
    CG.lg = { schedule: [] }; CG.SEASON = { format: "full" };
    return CG.positionChangeDeadline() === null;
  })());
}

console.log("— basic format: the deadline IS the sign-up cutoff (Rule 2.9)");
{
  CG.lg = { schedule: [] };
  CG.SEASON = { format: "basic", signup_deadline_at: "2026-09-25T03:59:00.000Z" };
  A("basic reads signup_deadline_at directly, ignoring any schedule",
    CG.positionChangeDeadline() === Date.parse("2026-09-25T03:59:00.000Z"));
  CG.lg = { schedule: [{ stage: "preseason", at: Date.parse("2026-09-16T01:00:00.000Z") }] };
  A("...and a pre-season game on the schedule (a full-format leftover) is ignored in basic",
    CG.positionChangeDeadline() === Date.parse("2026-09-25T03:59:00.000Z"));
  CG.SEASON = { format: "basic", registration_deadline: "2026-09-25T03:59:00.000Z" };
  A("...falling back to registration_deadline when signup_deadline_at is unset",
    CG.positionChangeDeadline() === Date.parse("2026-09-25T03:59:00.000Z"));
  CG.SEASON = { format: "basic" };
  A("...and null when the season has neither", CG.positionChangeDeadline() === null);
  CG.lg = {}; CG.SEASON = { format: "full" };
}

console.log("— the request form refuses after it");
{
  A("filing is gated on the deadline", /var pcDl = CG\.positionChangeDeadline\(\);/.test(live));
  A("...and returns instead of opening the form",
    /if \(pcDl && Date\.now\(\) > pcDl\)\{[\s\S]{0,220}return;/.test(live));
  A("...telling the member when it closed, not just that it did",
    /Position changes closed "\+CG\.fmtFull\(pcDl\)/.test(live));
  A("the open form states the deadline up front", /Position changes close <b>/.test(live));
  A("...and cites the rule", /\(Rule 2\.9\)/.test(live));
}

console.log("— the rulebook says the same thing");
{
  A("the changelog records v2.32", rb.changelog.some((c) => c.version === "2.32"));
  A("...and the newest entry sits first", rb.changelog[0].version >= "2.32", rb.changelog[0].version);
  A("...carrying dateIso like every other entry", rb.changelog.every((e) => !!e.dateIso));
  A("Rule 2.9 exists and is about position changes",
    rb.chapters.some((c) => c.sections.some((s) => s.id === "2.9" && /Position changes/i.test(s.title))));
  /* v2.48 — basic has no pre-season, so Rule 2.9's basic text closes position changes at the
     sign-up cutoff itself (Rule 2.8's deadline); the old "Tuesday before the first pre-season
     game" wording is preserved verbatim as the full-format variant */
  A("basic states the deadline is the sign-up cutoff, not a pre-season-relative date",
    /Position changes close at the sign-up cutoff — 11:59 PM Eastern on the Thursday before the draft/.test(sec("2.9")));
  A("...(full format) states the old Tuesday-before-pre-season deadline exactly",
    /11:59 PM Eastern on the Tuesday before the first pre-season game/.test(secFull("2.9")));
  A("...says filing AND approving both close", /no request may be filed, and none may be approved/.test(sec("2.9")));
  A("...but a pending request can still be declined", /may still be declined and closed/.test(sec("2.9")));
  A("basic says it follows the published calendar rather than a fixed date",
    /follows the published calendar rather than a fixed date/.test(sec("2.9")));
  A("...(full) says it follows the published schedule rather than a fixed calendar date",
    /follows the published schedule rather than a fixed calendar date/.test(secFull("2.9")));
  A("...and separates 'registered at' from Rule 2.1's 'dressed at'",
    /governs the position a player is registered AT/.test(sec("2.9")));
  A("Chapter 0.3 (basic) warns members at sign-up that it closes at the cutoff itself",
    /can only be changed by request to the league office up to the sign-up cutoff \(Rule 2\.9\)/.test(sec("0.3")));
  A("...(full) warns members it closes the Tuesday before the first pre-season game",
    /Tuesday before the first pre-season\s*game \(Rule 2\.9\)/.test(secFull("0.3")));
}

console.log(ok ? "\nPASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
