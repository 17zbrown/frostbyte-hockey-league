/* v3.91: Rule 5.4, Scheduling by management. Commissioner, 2026-10-08: "Make a rule in the rulebook with no mechanic
   behind it to be a play can report a manager for negligently scheduling players. It can be vague so staff can keep it
   case by case but dont say that in the rules." A rule only: no tool enforces it, and the text does not say how staff
   weigh a complaint. */
const fs = require("fs"), path = require("path"), vm = require("vm");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + got)); } };
global.CG = {}; vm.runInThisContext(fs.readFileSync(path.join(__dirname, "..", "src/live/part3_content.js"), "utf8"));
const rb = CG.CONTENT.rulebook, ch5 = rb.chapters.find((c) => c.num === 5), s = ch5 && ch5.sections.find((x) => x.id === "5.4");
A("Rule 5.4 sits in Chapter 5, after the lineup lock", !!s && ch5.sections.map((x) => x.id).join(",") === "5.1,5.2,5.3,5.4" && s.title === "Scheduling by management");
const t = s ? s.paragraphs.join(" ") : "";
A("management is expected to schedule fairly and with reasonable care", /expected to do so fairly and with reasonable care/.test(t));
A("a player may file a complaint for negligent scheduling, through Rule 7.1", /A player who believes his club's management has scheduled players negligently may file a complaint with the league office \(Rule 7\.1\)/.test(t));
A("the league office reviews it and may act under Chapter 7", /reviews every such complaint and may act on it under Chapter 7/.test(t));
A("it does not say how a complaint is weighed", !/case by case|case-by-case|discretion/i.test(t));
A("no em dash, and the same text in both formats (no shelved full-format version)", !/—/.test(t) && !s.full);
A("changelog 3.91", !!rb.changelog.find((c) => c.version === "3.91" && /Rule 5\.4/.test(c.summary)));
console.log(fail ? "\n" + fail + " of " + n + " FAILED" : "\nall " + n + " passed");
process.exit(fail ? 1 : 0);
