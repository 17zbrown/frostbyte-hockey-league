/* v4.67 (2026-11-26): the browser tab icon in the Glacier colors. Commissioner, 2026-11-26: "Can you change the logo that
   appears in the search engine tab to be the correct glacier colors?" Until now /favicon.svg and the three app icons
   (apple-touch-icon.png, icon-192.png, icon-512.png) still carried the Season 1 badge with its yellow crossbar, while the
   site header draws S2.mark (src/s2/js/core.js) in Glacier. Now the favicon IS that mark in its light colors (ink tile,
   white C, the Glacier crossbar --accent-2) and the app icons are the same mark on a full-bleed tile (iOS and Android
   round the corners themselves). The links carry ?v=2 because netlify.toml caches icons for a week.
   This pins the favicon to the header mark's own paths and to the tokens, reads real pixels out of each PNG (a small
   PNG reader below: no npm packages), and checks the links and the changelog entry.
   Run: node tools/favicon-glacier-v467.test.cjs */
const fs = require("fs"), path = require("path"), zlib = require("zlib"), vm = require("vm");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + String(got).slice(0, 600))); } };
const REPO = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(REPO, p), "utf8");

/* an 8-bit, non-interlaced RGB or RGBA PNG to {w, h, px(x, y) -> [r, g, b]}; throws on anything else so a changed
   export format fails loud instead of reading garbage */
function readPng(file) {
  const b = fs.readFileSync(file);
  if (b.readUInt32BE(0) !== 0x89504e47) throw new Error(file + " is not a PNG");
  let o = 8, w = 0, h = 0, depth = 0, type = 0, lace = 0; const idat = [];
  while (o < b.length) {
    const len = b.readUInt32BE(o), kind = b.toString("ascii", o + 4, o + 8), d = b.subarray(o + 8, o + 8 + len);
    if (kind === "IHDR") { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; type = d[9]; lace = d[12]; }
    if (kind === "IDAT") idat.push(d);
    o += 12 + len;
  }
  if (depth !== 8 || (type !== 2 && type !== 6) || lace) throw new Error(file + ": unsupported PNG (depth " + depth + ", type " + type + ", interlace " + lace + ")");
  const bpp = type === 6 ? 4 : 3, stride = w * bpp, raw = zlib.inflateSync(Buffer.concat(idat)), img = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? img[y * stride + x - bpp] : 0, up = y ? img[(y - 1) * stride + x] : 0, c = y && x >= bpp ? img[(y - 1) * stride + x - bpp] : 0;
      let v = src[x];
      if (f === 1) v += a; else if (f === 2) v += up; else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) { const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
      else if (f !== 0) throw new Error(file + ": bad filter " + f);
      img[y * stride + x] = v & 255;
    }
  }
  return { w, h, px: (x, y) => { const i = Math.floor(y) * stride + Math.floor(x) * bpp; return [img[i], img[i + 1], img[i + 2]]; }, all: img, bpp };
}
const hex = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
const near = (got, want, tol) => got.every((v, i) => Math.abs(v - want[i]) <= (tol || 10));

console.log("the favicon is the header mark in its light Glacier colors");
const fav = R("favicon.svg"), core = R("src/s2/js/core.js"), tokens = R("src/s2/css/tokens.css");
const markFn = (core.match(/S2\.mark = function \(size\) \{[\s\S]*?\n  \};/) || [""])[0];
const markPaths = [...markFn.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1]);
const favPaths = [...fav.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1]);
A("S2.mark draws two paths (the C and the crossbar)", markPaths.length === 2, markPaths);
A("the favicon draws the same two paths as the header mark", JSON.stringify(favPaths) === JSON.stringify(markPaths), favPaths);
A("the favicon's tile matches the header mark's (32 box, corner radius 8)", /viewBox="0 0 32 32"/.test(fav) && /<rect width="32" height="32" rx="8" fill="#1d1d1f"\/>/.test(fav), fav);
const lightInk = (tokens.match(/:root \{[\s\S]*?--ink: (#[0-9a-f]{6})/) || [])[1];
const lightA2 = (tokens.match(/:root \{[\s\S]*?--accent-2: (#[0-9a-f]{6})/) || [])[1];
const siteCanvas = (tokens.match(/--canvas: (#ffffff); --surface: #f5f5f7/) || [])[1];
A("the tile is the light --ink token", lightInk === "#1d1d1f" && fav.includes('fill="' + lightInk + '"'), lightInk);
A("the C is the site's light --canvas (white)", siteCanvas === "#ffffff" && fav.includes('stroke="' + siteCanvas + '" stroke-width="3.2"'), siteCanvas);
A("the crossbar is Glacier's --accent-2", lightA2 === "#5ac8fa" && /<path d="M15\.5 16\.2h8" stroke="#5ac8fa"/.test(fav), lightA2);
A("the Season 1 yellow is gone from the favicon", !/#ffe500/i.test(fav), fav);
A("the favicon's comment records the request and its version", /v4\.67/.test(fav) && /correct glacier colors/.test(fav), fav);
A("S2.mark points back at the favicon so they change together", /v4\.67: \/favicon\.svg is this mark/.test(core), "");

console.log("the app icons are the same mark on a full-bleed tile");
for (const [file, size] of [["apple-touch-icon.png", 180], ["icon-192.png", 192], ["icon-512.png", 512]]) {
  const p = readPng(path.join(REPO, file)), k = size / 32;
  A(file + " is " + size + " by " + size, p.w === size && p.h === size, p.w + "x" + p.h);
  A(file + ": the corner is the ink tile, not transparent (full bleed)", near(p.px(1, 1), hex("#1d1d1f"), 4), p.px(1, 1));
  A(file + ": the crossbar is Glacier", near(p.px(19.5 * k, 16.2 * k), hex("#5ac8fa")), p.px(19.5 * k, 16.2 * k));
  A(file + ": the C is white", near(p.px(7.6 * k, 16 * k), [255, 255, 255]), p.px(7.6 * k, 16 * k));
  A(file + ": inside the C is the tile", near(p.px(11 * k, 16 * k), hex("#1d1d1f"), 4), p.px(11 * k, 16 * k));
  let yellow = 0;
  for (let i = 0; i < p.all.length; i += p.bpp) if (p.all[i] > 200 && p.all[i + 1] > 180 && p.all[i + 2] < 90) yellow++;
  A(file + ": no Season 1 yellow pixel anywhere", yellow === 0, yellow);
  /* maskable: Android may crop to a circle of 40% of the side around the center; the mark's farthest ink (the C's
     end caps) must sit inside it */
  if (file === "icon-512.png") {
    const r = (x, y) => Math.hypot(x - 16, y - 16);
    A("icon-512.png: the mark sits inside the maskable safe circle", Math.max(r(22.5, 10.2), r(22.5, 21.3)) + 1.6 < 0.4 * 32 && 8.4 + 1.6 < 0.4 * 32, "");
  }
}

console.log("the links fetch the new icons past the week-long cache");
const head = R("src/s2/head.html"), mani = JSON.parse(R("site.webmanifest"));
A("the tab icon link carries ?v=2", head.includes('<link rel="icon" type="image/svg+xml" href="/favicon.svg?v=2">'), "");
A("the home-screen icon link carries ?v=2", head.includes('<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png?v=2">'), "");
A("every manifest icon carries ?v=2", mani.icons.length === 3 && mani.icons.every((i) => /\.png\?v=2$/.test(i.src)), JSON.stringify(mani.icons));
A("the manifest still names a maskable 512 icon", mani.icons.some((i) => i.purpose === "maskable" && i.sizes === "512x512"), "");

console.log("the changelog");
const content = (() => { const c = { CG: {} }; vm.createContext(c); vm.runInContext(R("src/live/part3_content.js"), c); return c.CG.CONTENT; })();
const e = content.rulebook.changelog.find((c) => c.version === "4.67");
A("a 4.67 changelog entry exists", !!e, "");
A("it names the tab icon and Glacier", !!e && /tab/i.test(e.summary + e.items.join(" ")) && /Glacier/.test(e.summary + e.items.join(" ")), e && e.summary);

console.log(fail ? "\n" + fail + " of " + n + " checks FAILED" : "\nall " + n + " checks passed");
process.exit(fail ? 1 : 0);
