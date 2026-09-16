#!/usr/bin/env node
/* Pages: a poster cut into Discord-sized images (2026-09-16).
     node tools/guides/build-pages.mjs [topic …]
   Discord shrinks anything much taller than ~4,600 px to a blurry strip, so each desktop poster
   (2400 px wide, up to 15,000 tall) is rendered once with its section boundaries reported, then
   sliced on those boundaries into docs/guides/pages/<topic>-<n>.png, every page at most MAX_H px
   tall and never cut mid-section. The band header opens page 1 and the footer closes the last. */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const SRC = path.join(HERE, "src");
const OUT = path.join(ROOT, "docs/guides/pages");
const MAX_H = +(process.env.PAGE_MAX_H || 4800);
const PORT = process.env.SHOOT_PORT || "9377";
fs.mkdirSync(OUT, { recursive: true });
const want = process.argv.slice(2);
const topics = fs.readdirSync(SRC).filter((f) => f.endsWith(".html")).map((f) => f.replace(/\.html$/, "")).filter((t) => !want.length || want.includes(t));

for (const topic of topics) {
  const list = { base: "file://" + SRC + "/", out: OUT,
    shots: [{ name: "_full-" + topic, url: topic + ".html", width: 1600, height: 900, scale: 1.5, settle: 1500, full: true, maxHeight: 12000, colorScheme: "light",
      cuts: ".sec-h, .sec, .foot" }] };
  const lp = path.join(OUT, "_shots-" + topic + ".json");
  fs.writeFileSync(lp, JSON.stringify(list, null, 1));
  const r = spawnSync(process.execPath, [path.join(ROOT, "tools/demo/shoot.mjs"), lp, "--port", PORT], { stdio: "inherit" });
  fs.rmSync(lp, { force: true });
  if (r.status) { console.error("render failed: " + topic); continue; }
  const rep = JSON.parse(fs.readFileSync(path.join(OUT, "_report.json"), "utf8")).find((x) => x.name === "_full-" + topic);
  const full = path.join(OUT, "_full-" + topic + ".png");
  /* balanced paging on the reported boundaries: as few pages as MAX_H allows, each ending at the
     boundary nearest its fair share of the remaining height; a section taller than MAX_H on its
     own is left whole (never cut mid-section), and a footer-only tail is folded into the page
     before it whenever that still fits */
  const py = spawnSync("python3", ["-c", `
import json, sys
from PIL import Image
full, out, topic, MAXH = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
raw = json.loads(sys.argv[5])
im = Image.open(full); W, H = im.size
# a section head or the footer is a clean break (primary); the start of a section body under the
# same head is a fallback break (secondary) — the head stays with its first block, the rest of the
# group continues on the next page
prim = sorted(set(int(c["y"]) for c in raw if c["y"] > 0 and ("sec-h" in c["sel"] or "foot" in c["sel"])))
sec = sorted(set(int(c["y"]) for c in raw if c["y"] > 0 and "sec-h" not in c["sel"] and "foot" not in c["sel"]))
cuts = sorted(set([y for y in prim if 0 < y < H] + [H]))
sec = [y for y in sec if 0 < y < H and y not in cuts]
def cost(y, ideal): return abs(y - ideal) * (1 if y in cuts else 2.5)
pages = []; start = 0
while start < H:
    lim = start + MAXH
    end = max([y for y in cuts if start < y <= lim], default=None)          # furthest clean break
    if end is None or end - start < 0.6 * MAXH:
        alt = max([y for y in sec if start < y <= lim], default=None)       # a fuller page on a fallback break
        if alt is not None and (end is None or alt > end): end = alt
    if end is None:
        end = next((y for y in sorted(cuts + sec) if y > start), H)         # one oversize block: keep it whole
    pages.append((start, end)); start = end
if len(pages) > 1 and pages[-1][1] - pages[-1][0] < 900 and (pages[-1][1] - pages[-2][0]) <= MAXH + 300:
    pages[-2] = (pages[-2][0], pages[-1][1]); pages.pop()
files = []
ICE = (245, 246, 242); PAD = 54
for i, (a, b) in enumerate(pages, 1):
    part = im.crop((0, a, W, b))
    # breathing room where a page was cut: the poster's own ice above a continued page and below
    # an unfinished one (the band opens page 1 and the footer closes the last, edge to edge)
    top = PAD if i > 1 else 0; bot = PAD if i < len(pages) else 0
    page = Image.new("RGB", (W, part.height + top + bot), ICE); page.paste(part, (0, top))
    f = f"{out}/{topic}-{i}.png"; page.save(f); files.append((f, W, page.height))
print(json.dumps(files))
`, full, OUT, topic, String(MAX_H), JSON.stringify(rep.cuts || [])], { encoding: "utf8" });
  if (py.status) { console.error(py.stderr); continue; }
  const files = JSON.parse(py.stdout);
  fs.rmSync(full, { force: true });
  console.log(topic + ": " + files.length + " page(s) — " + files.map((f) => f[1] + "×" + f[2]).join(", "));
}
fs.rmSync(path.join(OUT, "_report.json"), { force: true });
