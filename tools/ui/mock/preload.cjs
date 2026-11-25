/* v5.00 swap (j1): tools/ui/run.cjs preloads this into every suite (node --require) in --mode live-fixture,
   --mode mock and --mode live, so each browser context a suite opens carries the mock without the suite changing a line:
   live-fixture installs the network layer only (the page's own signed-out code reads the recorded bodies), mock
   installs the persona (--persona, default anon) and the write mock as well, and live (h0) adds the real site: the
   page as the build ships it, the persona's stored sign-in, the table answers and the fence (mock/index.cjs). A suite's own mock.install call on a
   context afterwards switches it to that suite's persona and writes table. It patches the same Playwright module the
   suites load: run.cjs sets PLAYWRIGHT to mock.PW, and the suites require process.env.PLAYWRIGHT. */
const mock = require("./index.cjs");
const mode = process.env.S2_MODE;
if (["live-fixture", "mock", "live"].indexOf(mode) < 0) throw new Error("mock/preload: S2_MODE is " + mode + "; run.cjs preloads this only for live-fixture, mock and live");
const { chromium } = require(mock.PW);
const launch = chromium.launch;
chromium.launch = async function () {
  const browser = await launch.apply(this, arguments), newContext = browser.newContext;
  /* browser.newPage() opens its context through this.newContext, so it is covered too */
  browser.newContext = async function () {
    const ctx = await newContext.apply(this, arguments);
    await mock.install(ctx, { page: mode !== "live-fixture", live: mode === "live" });
    return ctx;
  };
  return browser;
};
