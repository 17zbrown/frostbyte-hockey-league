#!/usr/bin/env node
/* v5.00 swap (i2, 2026-11-24): the RPCs both sites call, for grant-audit.sql check 4 ("client RPCs that lost their grant").
   The check used to be pasted from a grep over src/live alone and had fallen to 29 of the 128 names the classic site
   calls; the Season 2 site (src/s2) calls more as its pages are wired (PLAN R2: regenerated from both at the hand-off).
     node tools/sql/client-rpcs.cjs           print what each site calls, and what check 4 lacks
     node tools/sql/client-rpcs.cjs --write   add the missing names to check 4b (it never drops one: a name leaving the
                                              client is removed by hand, so the audit never loosens by accident)
   Check 4 keeps its hand list exactly as it was (eleven tests pin its words); 4b, right under it, holds the rest.
   Found as string literals passed to the call doors: .rpc("x"), the CG.sbAllRpc/sbCapped family ("...Rpc("x""),
   simpleRpc(id, "x") in the classic draft room, S2.write("x") and /rest/v1/rpc/x. A call whose name is a variable is not
   found; tools/s2-site-modes.test.cjs pins that the classic list stays above 100 names. */
const fs = require("fs"), path = require("path");
const PATTERNS = [/[.\s(]rpc\(\s*["']([a-z_0-9]+)["']/g, /Rpc\(\s*["']([a-z_0-9]+)["']/g, /simpleRpc\(\s*["'][A-Za-z0-9_]+["']\s*,\s*["']([a-z_0-9]+)["']/g,
  /S2\.write\(\s*["']([a-z_0-9]+)["']/g, /\/rpc\/([a-z_0-9]+)/g];
const HAND = /-- 4\)[^\n]*\n[^\n]*\nfrom unnest\(array\[([^\]]*)\]\)/, ANCHOR = /(-- 4b\)[^\n]*\n[^\n]*\n[^\n]*\nfrom unnest\(array\[)([^\]]*)(\]\))/;

function files(d) {
  return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? files(path.join(d, e.name)) : /\.js$/.test(e.name) ? [path.join(d, e.name)] : []);
}
function namesIn(dir) {
  const out = new Set();
  for (const f of files(dir)) { const t = fs.readFileSync(f, "utf8"); for (const p of PATTERNS) for (const m of t.matchAll(p)) out.add(m[1]); }
  return [...out].sort();
}
function calls(repo) {
  const live = namesIn(path.join(repo, "src/live")), s2 = namesIn(path.join(repo, "src/s2/js"));
  return { live, s2, all: [...new Set(live.concat(s2))].sort() };
}
const names = (list) => (list.match(/'([a-z_0-9]+)'/g) || []).map((x) => x.slice(1, -1));
/* -> { hand: check 4's names, gen: check 4b's names, all: both } */
function listed(sql) {
  const h = sql.match(HAND), g = sql.match(ANCHOR);
  if (!h || !g) throw new Error("client-rpcs: check 4's or 4b's `from unnest(array[...])` line is not where it was in tools/sql/grant-audit.sql");
  const hand = names(h[1]), gen = names(g[2]);
  return { hand, gen, all: [...new Set(hand.concat(gen))] };
}

module.exports = { calls, listed };
if (require.main === module) {
  const repo = path.join(__dirname, "../.."), file = path.join(__dirname, "grant-audit.sql");
  const sql = fs.readFileSync(file, "utf8"), c = calls(repo), have = listed(sql), miss = c.all.filter((x) => !have.all.includes(x));
  console.log(`src/live calls ${c.live.length}, src/s2 calls ${c.s2.length}; checks 4 and 4b list ${have.all.length}; missing: ${miss.join(" ") || "none"}`);
  if (process.argv.includes("--write") && miss.length) {
    if ((sql.match(new RegExp(ANCHOR.source, "g")) || []).length !== 1) throw new Error("client-rpcs: check 4b's list is not found exactly once");
    const next = sql.replace(ANCHOR, (m, a, list, z) => a + have.gen.concat(miss).sort().map((x) => "'" + x + "'").join(",") + z);
    fs.writeFileSync(file, next);
    console.log(`client-rpcs: check 4b now lists ${have.gen.length + miss.length} names; run tools/sql/grant-audit.sql (zero rows) before shipping`);
  }
}
