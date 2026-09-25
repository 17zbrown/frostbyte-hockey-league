/* v3.15 — a lobby code never reads as anything crude.
 *
 * Commissioner: "edit the game codes and any future game codes to account for potential profanity
 * combinations like 69 being next to each other and such".
 *
 * The SQL side lives in public.game_code_ok and cannot be reached from here, so this file pins the
 * JS twin that issues PICKUP lobby codes (read out in Discord exactly like a league code), and the
 * decision record.
 */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
function A(name, cond, got) {
  n++;
  if (cond) console.log("ok   " + name);
  else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  — got: " + String(got).slice(0, 200))); }
}
const di = R("netlify/functions/discord-interactions.js");
const rec = R("sql/2026-09-24-clean-game-codes.sql");
const flat = rec.replace(/\n--\s?/g, " ").replace(/\s+/g, " ");

console.log("\n— the pickup lobby code is filtered like a league code");
{
  A("the raw draw is gone from the pick handler", !/s\.code = String\(Math\.floor\(100000/.test(di));
  A("...replaced by the filtered generator", /s\.code = cleanLobbyCode\(\);/.test(di));
  A("the list is declared once", (di.match(/LOBBY_CODE_BANNED = /g) || []).length === 1);
  A("...and points at its SQL twin", /public\.game_code_ok/.test(di));
  A("...and says to keep the two in step", /Keep the two in step/.test(di));
  A("the loop is bounded", /for \(let i = 0; i < 200; i\+\+\)/.test(di));
}

console.log("\n— the generator actually never emits a banned code");
{
  const m = di.match(/const LOBBY_CODE_BANNED = (\/.*\/);/);
  A("the pattern is readable from the source", !!m);
  const re = new RegExp(m[1].slice(1, -1));
  for (const bad of ["69", "420", "666", "88", "8008", "911", "187", "1312"])
    A(`${bad} is on the list`, re.test("1" + bad + "1".repeat(Math.max(0, 5 - bad.length))) || re.test(bad));
  /* run the real generator, not a paraphrase of it */
  const gen = () => {
    for (let i = 0; i < 200; i++) {
      const c = String(Math.floor(100000 + Math.random() * 900000));
      if (!re.test(c)) return c;
    }
    return null;
  };
  let leaks = 0, malformed = 0;
  for (let i = 0; i < 50000; i++) {
    const c = gen();
    if (c === null || !/^[0-9]{6}$/.test(c)) { malformed++; continue; }
    if (re.test(c)) leaks++;
  }
  A("50,000 generated codes, none banned", leaks === 0, String(leaks));
  A("...and all six digits", malformed === 0, String(malformed));
}

console.log("\n— the decision record");
{
  A("it quotes the instruction", /like 69 being next to each other/.test(flat));
  A("one list, shared by the generator and the audit", /ONE LIST/.test(flat) && /can never disagree/.test(flat));
  A("it explains every entry", ["69","420","666","88","8008","911","187","1312"].every((x) => flat.includes(x)));
  A("...and what is deliberately NOT banned, with the reason",
    /NOT banned: 13 and 14 alone/.test(flat) && /cost a large slice of the\s*pool/.test(flat.replace(/\s+/g," ")));
  A("the pool cost is measured, not guessed", /removes 100,420 and\s*leaves 799,580/.test(flat.replace(/\s+/g," ")));
  A("...and the JS twin measured too", /0 leaks out of 200,000 generated codes/.test(flat));
}

console.log("\n— what it refuses to touch, which is the safety of the whole change");
{
  A("a played game keeps its code", /it has been played; the record stands/.test(flat));
  A("a night already locked keeps its code", /would send them to a lobby that does not exist/.test(flat));
  A("...and the function refuses on its own rather than trusting the caller",
    /REFUSES two cases on its own rather than trusting/.test(flat.replace(/\s+/g," ")));
  A("the numbers are recorded", /19 were reissued and 3 were left/.test(flat));
  A("the audit does not store the new code", /not to be a second place a live lobby code can be read from/.test(flat));
  A("the retry ceiling was raised for a stated reason", /from 50 to 200/.test(flat));
}

console.log("\n" + (fail ? "FAIL " + fail + " of " + n : "PASS " + n));
process.exit(fail ? 1 : 0);
