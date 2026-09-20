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
A("Pre-season Central's confirm explains the fill-first order, by group", /Every open active-roster seat in the league is filled first/.test(live) && /a club short of left defensemen takes an extra right defenseman \(Rule 2\.1\)/.test(live) && /loaned into another group's open seat, and once every seat is taken the rest are loaned out too/.test(live) && /no cap on how many pre-season loans a club carries/.test(live));
A("...and the result toast reports cross-group and overflow loans from the RPC", /d\.out_of_position\?" · "\+d\.out_of_position\+" loaned across position groups to fill open seats"/.test(live) && /d\.overflow\?" · "\+d\.overflow\+" loaned as extra pre-season depth"/.test(live));
A("...everyone is assigned: no one is left out (the pre-season loan pool is uncapped)", /right defenseman \(Rule 2\.1\)/.test(live) && !/every seat and camp spot is taken/.test(live));
const rb = JSON.parse(content.match(/CG\.CONTENT = (\{[\s\S]*?\});\n/)[1]).rulebook;
const sec = (id) => { for (const ch of rb.chapters) for (const s of ch.sections) if (s.id === id) return s.paragraphs.join(" "); };
const secFull = (id) => { for (const ch of rb.chapters) for (const s of ch.sections) if (s.id === id) return (s.full || s.paragraphs).join(" "); };
/* FULL format: the pre-season fill-first loan order is preserved word for word in Appendix A */
A("[full] Rule 0.4 states the order: own group → another group's seat → uncapped overflow loans", /keeps his registered position and goes to a club with room in his group/.test(secFull("0.4")) && /a club short of left defensemen takes an extra right defenseman/.test(secFull("0.4")) && /loaned into another group's open seat/.test(secFull("0.4")) && /the remaining players are loaned out too/.test(secFull("0.4")) && /there is no cap on how many pre-season loans a club carries/.test(secFull("0.4")));
A("[full] ...and says a loan does not change the registered position and counts against no limit", /A pre-season loan does not change a player's registered position for the draft, counts against no roster limit/.test(secFull("0.4")));
/* BASIC format has no pre-season: the fill-first order is replaced by a depth placement */
A("[basic] Rule 0.4 says there is no pre-season", /The basic format has no pre-season/.test(sec("0.4")));
/* v2.73: depth is carried in training camp, outside the composition; called up, it counts like anyone else */
A("[basic] Rule 2.1 carries depth placements in training camp, outside the composition", /is carried in the club's training camp as depth/.test(sec("2.1")) && /Camp is not counted against the published composition/.test(sec("2.1")) && /Called up to the active roster, a depth player takes one of its spots like any other player/.test(sec("2.1")));
const cl240 = rb.changelog.find((c) => c.version === "2.40"), cl241 = rb.changelog.find((c) => c.version === "2.41");
A("changelog 2.40 + 2.41", !!cl240 && /fills every open roster seat before anyone goes to camp/.test(cl240.summary) && !!cl241 && /roster shape is by position group/.test(cl241.summary));
A("...American spelling", !/practis|colour|centre|organis|defence/i.test(rb.changelog[0].summary + secFull("0.4") + secFull("2.1") + sec("0.4") + sec("2.1")));
console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
