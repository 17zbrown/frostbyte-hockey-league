/* v2.40 — the pre-season random assignment fills every open active seat before anyone goes to camp.
   The placement itself lives in Postgres (_assign_reg_random modes exact/group/any/camp,
   preseason_random_assign's four passes) and was rehearsed in rollback on the live pool: 8 clubs all
   3-3-3-3-3-2, 6 forwards loaned to defense, 24 to camp, 7 left only because 167 people exceed
   8 × 20 seats. This file pins the copy the site shows for it. Run: node tools/preseason-fill-first.test.cjs */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const live = R("src/live/part_live.js"), content = R("src/live/part3_content.js");
let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };
A("Pre-season Central's confirm explains the fill-first order", /Every open active-roster seat in the league is filled before anyone goes to camp/.test(live) && /loaned into an open seat in his group, then into any open seat, and only then to training camp/.test(live));
A("...and the result toast reports out-of-position loans and camp placements from the RPC", /d\.out_of_position\?" · "\+d\.out_of_position\+" loaned out of position to fill open seats"/.test(live) && /d\.camp\?" · "\+d\.camp\+" to camp"/.test(live));
A("...with the honest reason when someone is left out", /every seat and camp spot is taken/.test(live));
const rb = JSON.parse(content.match(/CG\.CONTENT = (\{[\s\S]*?\});\n/)[1]).rulebook;
const sec = (id) => { for (const ch of rb.chapters) for (const s of ch.sections) if (s.id === id) return s.paragraphs.join(" "); };
A("Rule 0.4 states the order: own position → group → any seat → camp", /open seat at his registered position; when no club has one, he is loaned into an open seat in his position group, and failing that into any open seat at all/.test(sec("0.4")) && /Only once every active seat in the league is taken are the remaining players placed in training camp, spread evenly and at random/.test(sec("0.4")));
A("...and says a loan does not change the registered position", /A pre-season loan does not change a player's registered position for the draft/.test(sec("0.4")));
A("changelog 2.40", rb.changelog[0].version === "2.40" && /fills every open roster seat before anyone goes to camp/.test(rb.changelog[0].summary));
A("...American spelling", !/practis|colour|centre|organis|defence/i.test(rb.changelog[0].summary + sec("0.4")));
console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
