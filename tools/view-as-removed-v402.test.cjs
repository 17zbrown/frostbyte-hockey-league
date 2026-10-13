/* v4.02 (2026-10-13). Commissioner: "can you remove the view as box at the bottom of my screen on the website?"
   The admin "View as" preview bar (CG.viewAs / CG.renderViewAsBar, #cgViewAs) is gone, with its styling and the call that
   drew it on every sign-in; nothing else used it. */
const fs = require("fs"), path = require("path"), vm = require("vm");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
const A = (name, cond) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name); } };
const src = ["src/live/part_live.js", "src/live/part1_head.html", "src/live/part2_engine.js", "src/live/part4_ui.js", "src/live/part6_hub.js",
  "src/live/part7_admin.js", "src/live/part9_staffdesks.js"].map(R).join("\n");
A("no View as bar is drawn", !/CG\.renderViewAsBar\s*=/.test(src) && !/CG\.viewAs\s*=/.test(src) && !/createElement\("div"\); el\.id = "cgViewAs"/.test(src));
A("its styling is gone", !/#cgViewAs/.test(src) && !/\.cgva-/.test(src));
A("sign-in no longer calls it", !/renderViewAsBar\(\)/.test(src) && !/CG\._va\b/.test(src));
global.CG = {}; vm.runInThisContext(R("src/live/part3_content.js"));
const cl = CG.CONTENT.rulebook.changelog.find((c) => c.version === "4.02");
A("changelog 4.02 records it", !!cl && /View as/.test(cl.summary) && !/—/.test(JSON.stringify(cl)));
console.log(fail ? "\n" + fail + " of " + n + " FAILED" : "\nall " + n + " passed");
process.exit(fail ? 1 : 0);
