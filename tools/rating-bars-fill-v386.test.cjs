/* v3.86: the rating bars fill. Commissioner, 2026-10-06 (screenshot): "The ratings bars are empty and not filled".
   The fill is a <span>; an inline element ignores width and height, so every bar painted an empty track. Pins that every
   style that sizes a fill also makes it a block, and that the bar itself still carries its width. */
const fs = require("fs"), path = require("path");
const head = fs.readFileSync(path.join(__dirname, "..", "src/live/part1_head.html"), "utf8");
const pub = fs.readFileSync(path.join(__dirname, "..", "src/live/part5a_public.js"), "utf8");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + got)); } };
const rules = head.match(/[^{}\n]*\.rb-fill\{[^}]*height:100%[^}]*\}/g) || [];
A("found the fill rules that size a bar", rules.length >= 2, rules.length);
A("every one makes the fill a block", rules.every((r) => /display:block/.test(r)), rules.filter((r) => !/display:block/.test(r)).join(" | "));
A("the breakdown bar still carries its width, 50 empty to 99 full", /var w = Math\.max\(0, Math\.min\(100, Math\.round\(\(c\.score - 50\) \/ 49 \* 100\)\)\);/.test(pub) && /<span class="rb-fill" style="width:'\+w\+'%">/.test(pub));
console.log(fail ? "\n" + fail + " of " + n + " FAILED" : "\nall " + n + " passed");
process.exit(fail ? 1 : 0);
