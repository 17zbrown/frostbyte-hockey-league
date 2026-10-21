/* v4.27 (2026-10-21). Commissioner, on v4.25 binding the league office to the suspended-player waiver bar:
   "Commissioners may move remove or edit any player at any time. Commissioners always have more ability that team
   managers, even in the team HQ."
   The waiver bar is now the club's only: waive_player and the roster delete trigger let a commissioner through, Team HQ
   keeps the Waive button for the office, and Rules 2.1, 2.6 and 7.2 say so (2.6 states the principle). The SQL ran as a
   rolled-back rehearsal on production before it was applied (results recorded in the SQL file).
   Run: node tools/commissioner-powers-v427.test.cjs */
const fs = require("fs"), path = require("path");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + got)); } };
const ROOT = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const strip = (s) => s.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
const fnBody = (src, name) => { const i = src.indexOf("create or replace function public." + name); return i < 0 ? "" : src.slice(i, src.indexOf("$function$;", i)); };

console.log("\n1. The database record");
const sql = R("sql/2026-10-21-commissioner-powers-v427.sql"), body = strip(sql);
const w = fnBody(body, "waive_player"), g = fnBody(body, "guard_roster_waive");
A("waive_player bars a suspended player for the club only", /if public\.is_suspended\(p_profile\) and not public\.is_commissioner\(\) then\s+raise exception 'Rule 7\.2: % is suspended and cannot be waived/.test(w));
A("...still before the delete, and the quote is recorded", w.indexOf("is_suspended(p_profile)") < w.indexOf("delete from public.roster_spots") && /Commissioners\s+always\s+have more ability that team managers, even in the team HQ\./.test(w));
A("the delete trigger refuses only a signed-in member who is not the office or the league's automation", /if public\.is_suspended\(old\.profile_id\)\s+and auth\.uid\(\) is not null and not \(public\.is_commissioner\(\) or public\.trusted_writer\(\)\) then/.test(g) && !/= 'waived'/.test(g));
A("...keeping the office-removal bypass first and the release close last", g.indexOf("app.office_removal") < g.indexOf("is_suspended(old.profile_id)") && g.indexOf("is_suspended(old.profile_id)") < g.indexOf("fa_moves_closed(old.season_id)"));
A("both keep an empty search_path and stay CREATE OR REPLACE", [w, g].every((x) => /set search_path to ''/.test(x)) && !/drop function/i.test(body));
A("the self-check asserts it", /v4\.27 check: waive_player does not exempt a commissioner/.test(body) && /v4\.27 check: guard_roster_waive still binds the office/.test(body));
A("the rehearsal is recorded: the club refused, the office waives, the control unchanged", /Result: REHEARSAL OK: T0 T1 T2 T3\./.test(sql) && /a commissioner waives Tager: the roster row is deleted/.test(sql) && /the NYI Owner \(a member\) still cannot waive Tager/.test(sql));
A("applied and audited", /Applied as migration v427_commissioner_powers; tools\/sql\/grant-audit\.sql \(all nine checks\) returned zero rows\./.test(sql));

console.log("\n2. Team HQ");
const hub = R("src/live/part6_hub.js");
A("the Waive button is locked for the club, never for a commissioner", /if \(susp && CG\.role\(\)!=="commish"\) return '<button class="btn btn-ghost btn-sm" disabled title="'\+esc\(CG\.suspensionText\(susp\)\)\+'">'\+CG\.ic\("lock",12\)\+' Waive<\/button>';/.test(hub));
A("...with the ruling quoted beside it", /Commissioners always have more ability that team managers, even in the team HQ\."\): the office keeps the\s+button/.test(hub));

console.log("\n3. The rulebook, as rendered");
global.window = global; global.CG = {}; eval(R("src/live/part3_content.js"));
const rb = CG.CONTENT.rulebook, sec = (id) => [].concat(...rb.chapters.map((c) => c.sections || [])).find((x) => x.id === id) || { paragraphs: [] };
eval(R("src/live/part5b_public2.js").match(/CG\.rulebookForFormat = function\(rb, fmt\)\{[\s\S]*?\n\};/)[0]);
const r72 = sec("7.2").paragraphs.join(" "), r21 = sec("2.1").paragraphs.join(" ");
A("7.2: the club may not waive; a commissioner may", /The club may not waive a suspended player until the suspension is served; a commissioner may, as a commissioner may move, remove or edit any player at any time \(Rule 2\.6\)\./.test(r72) && !/binds the league office as it binds the club/.test(r72));
A("2.6, both formats: the principle and the example", [sec("2.6").paragraphs[6], sec("2.6").full[6]].every((p) => /A commissioner may move, remove or edit any player at any time and holds, in a club's Team HQ, every power the club's own management holds and more: a commissioner may, for example, waive a suspended player, whom the club itself may not waive \(Rule 7\.2\)\./.test(p) && !/Neither the club nor the league office may waive/.test(p)));
A("2.1: by their club", /but may not be waived by their club until their suspension is served \(Rule 7\.2\)\./.test(r21));
for (const fmt of ["basic", "full"]) {
  const b = JSON.stringify(CG.rulebookForFormat(rb, fmt).chapters);
  A("the rendered " + fmt + " book binds no office to the waiver bar", /whom the club itself may not waive/.test(b) && !/Neither the club nor the league office may waive|binds the league office as it binds the club/.test(b));
}
A("no dash as punctuation in the changed sections", !/—| - /.test(JSON.stringify(["2.1", "2.6", "7.2"].map((k) => [sec(k).paragraphs, sec(k).full || []]))));

console.log("\n4. The changelog");
const e = rb.changelog.find((c) => c.version === "4.27") || {};
A("4.27 is recorded, right before 4.26", e.version === "4.27" && (rb.changelog[rb.changelog.indexOf(e) + 1] || {}).version === "4.26");
A("...in key order, naming the rules", JSON.stringify(Object.keys(e)) === JSON.stringify(["version", "dateIso", "summary", "items"]) && (e.items || []).some((i) => /Rules 2\.1, 2\.6 and 7\.2/.test(i)));
A("...with no em dash or gendered pronoun", !/[—–]| - /.test(JSON.stringify(e)) && !/\b(he|his|him|she|her)\b/i.test(JSON.stringify(e)));

console.log("\n" + (n - fail) + "/" + n + " passed");
if (fail) process.exit(1);
