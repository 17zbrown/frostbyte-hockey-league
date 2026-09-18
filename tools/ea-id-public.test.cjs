#!/usr/bin/env node
/* v2.59 — every player's EA ID is public: on the profile, on the account-only profile, in the directory. */
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const pub = fs.readFileSync(path.join(root, "src/live/part5a_public.js"), "utf8");
const live = fs.readFileSync(path.join(root, "src/live/part_live.js"), "utf8");
const book = fs.readFileSync(path.join(root, "src/live/part3_content.js"), "utf8");
let fails = 0;
function A(name, cond){ console.log((cond ? "ok   " : "FAIL ") + name); if (!cond) fails++; }
A("the EA ID is in the public profile column list (guests see it too)", /CG\.PROFILE_PUBLIC_COLS = "[^"]*"\+\n\s*"[^"]*ea_id/.test(live));
A("one chip renders it, and says when it is missing", /CG\.eaIdChip = function\(eaId\)/.test(pub) && /EA ID not set/.test(pub));
A("the rostered profile hero shows it", /esc\(p\.platform\)\+'<\/span>'\+\n\s*CG\.eaIdChip\(p\.eaId\)\+/.test(pub));
A("the account-only profile fetches and shows it", /select\("gamertag,ea_id,platform"\)/.test(pub) && /CG\.eaIdChip\(r\.data\.ea_id\)/.test(pub));
A("the directory has an EA ID column for rostered and unrostered rows", (pub.match(/<td class="tleft mono" style="font-size:12px">'\+\((p|u)\.eaId\?esc\((p|u)\.eaId\)/g) || []).length === 2 && /<th class="tleft">EA ID<\/th>/.test(pub));
A("...and the search box matches it", /\(u\.eaId\|\|""\)\.toLowerCase\(\)\.indexOf\(fQ\)<0/.test(pub) && /\(p\.eaId\|\|""\)\.toLowerCase\(\)\.indexOf\(fQ\)<0/.test(pub));
A("Rule 1.1 says a registration needs the EA ID and that it is public", /A registration is not accepted without the player's EA ID/.test(book) && /shown on the player's public profile/.test(book));
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED"); process.exit(fails ? 1 : 0);
