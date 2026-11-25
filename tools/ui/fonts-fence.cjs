/* main session, 2026-11-24: tools/ui/run.cjs preloads this into every suite in every mode (node --require). Google
   Fonts was the only request a suite made outside this Mac, and a page's "load" waits for the stylesheet, so a dropped
   connection timed out whole suites at 30 seconds (g4's runs: ERR_INTERNET_DISCONNECTED on fonts.googleapis.com, the
   same suites green on rerun). Each font request is now served from a local copy: the first run fetches and keeps it
   in ~/Developer/cghl-private/fixtures/fonts (outside the repo; third-party files never enter git), every later run
   reads it, so pages render with the same fonts with or without a connection. A request that is neither cached nor
   fetchable gets an empty answer and a logged line instead of a 30-second stall: a font-dependent check then fails
   loudly on its own terms, never silently passes. It patches the same Playwright module the suites load, exactly as
   tools/ui/mock/preload.cjs does (process.env.PLAYWRIGHT), and composes with it. */
const fs = require("fs"), path = require("path"), os = require("os"), crypto = require("crypto");
const PW = process.env.PLAYWRIGHT;
if (!PW) throw new Error("fonts-fence: PLAYWRIGHT is unset; run suites through tools/ui/run.cjs");
const CACHE = path.join(os.homedir(), "Developer/cghl-private/fixtures/fonts");
const FONTS = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//;
const key = (url) => crypto.createHash("sha256").update(url).digest("hex").slice(0, 32);

async function serve(route) {
  const url = route.request().url(), base = path.join(CACHE, key(url));
  try {
    const meta = JSON.parse(fs.readFileSync(base + ".json", "utf8"));
    return route.fulfill({ status: 200, headers: meta.headers, body: fs.readFileSync(base + ".bin") });
  } catch (e) { /* not cached yet: fetch it once */ }
  try {
    const res = await route.fetch();
    const body = await res.body(), headers = res.headers();
    if (res.status() === 200) {
      fs.mkdirSync(CACHE, { recursive: true });
      const keep = {};
      for (const h of ["content-type", "access-control-allow-origin", "timing-allow-origin"]) if (headers[h]) keep[h] = headers[h];
      fs.writeFileSync(base + ".bin", body);
      fs.writeFileSync(base + ".json", JSON.stringify({ url, headers: keep }));
    }
    return route.fulfill({ response: res, body });
  } catch (e) {
    console.log("fonts-fence: " + url.slice(0, 80) + " is not cached and could not be fetched (" + e.message.split("\n")[0] + "); answered empty");
    const css = /fonts\.googleapis\.com/.test(url);
    return route.fulfill({ status: 200, headers: { "content-type": css ? "text/css" : "font/woff2", "access-control-allow-origin": "*" }, body: "" });
  }
}

const { chromium } = require(PW);
const launch = chromium.launch;
chromium.launch = async function () {
  const browser = await launch.apply(this, arguments), newContext = browser.newContext;
  /* browser.newPage() opens its context through this.newContext, so it is covered too */
  browser.newContext = async function () {
    const ctx = await newContext.apply(this, arguments);
    await ctx.route(FONTS, serve);
    return ctx;
  };
  return browser;
};
