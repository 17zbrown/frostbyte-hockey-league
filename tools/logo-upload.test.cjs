/* Club logo upload — the privileged storage write, driven for real against stubbed auth.
   Run: node tools/logo-upload.test.cjs

   The bug this exists for: uploadArtwork reached for `session.access_token`, but `session` was a
   local inside CG.assertCommissioner and was never bound in the uploader. Every upload died with
   "Upload failed: session is not defined" — a ReferenceError no static read caught, because the
   identifier only fails when the line actually runs. So this executes the real function. */
const fs = require("fs"), vm = require("vm"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "src", "live", "part_live.js"), "utf8");

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

function makeCtx(){
  const ctx = { console, Promise, JSON, Object, Array, String, Number, Boolean, Error, Math, Date,
                RegExp, setTimeout, clearTimeout, Symbol, Intl, encodeURIComponent };
  ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx;
  ctx.CG = { SB_URL: "https://sb.test", SB_KEY: "anonkey" };
  vm.createContext(ctx);
  for (const re of [/CG\.assertCommissioner = async function[\s\S]*?\n\};/,
                    /CG\.uploadArtwork = async function[\s\S]*?\n\};/]) {
    const m = src.match(re);
    if (!m) { A("source located for " + re, false); process.exit(1); }
    vm.runInContext(m[0], ctx);
  }
  return ctx;
}

/* a fake image the size checks won't touch */
const BYTES = { __isBlob: true, size: 1234 };

function wire(ctx, { session, refreshed, isComm = true, responses }) {
  ctx.CG.shrinkImage = async () => ({ blob: BYTES, type: "image/webp", ext: "webp" });
  ctx.CG.sb = {
    auth: {
      getSession: async () => ({ data: { session } }),
      refreshSession: async () => ({ data: { session: refreshed } }),
    },
    rpc: async () => ({ data: isComm }),
    storage: { from: () => ({ getPublicUrl: (p) => ({ data: { publicUrl: "https://sb.test/pub/" + p } }) }) },
  };
  const calls = [];
  ctx.fetch = async (url, init) => {
    calls.push({ url, auth: (init.headers || {})["Authorization"], body: init.body, type: (init.headers||{})["Content-Type"] });
    const r = responses[Math.min(calls.length - 1, responses.length - 1)];
    return { ok: r.ok, status: r.status, json: async () => r.body || {} };
  };
  return calls;
}

console.log("— the happy path actually runs (this is the regression)");
{
  const ctx = makeCtx();
  const calls = wire(ctx, { session: { access_token: "TOKEN-A" }, responses: [{ ok: true, status: 200 }] });
  let url = null, error = null;
  const done = ctx.CG.uploadArtwork({ name: "kraken.png" }, "SEA", { cap: 384 })
    .then((u) => { url = u; }).catch((e) => { error = e; });
  done.then(() => {
    /* message, not instanceof: the error is constructed inside the vm realm, so a cross-realm
       `instanceof ReferenceError` is false even when it IS one, and the assertion would pass
       against the very bug it guards. */
    A("no unbound identifier — the uploader binds its session",
      !(error && /is not defined/.test(String(error.message))), error ? String(error.message) : "");
    A("...and does not throw at all", error === null, error ? String(error.message) : "");
    A("one PUT went out", calls.length === 1);
    A("...bearing the session's access token", calls[0] && calls[0].auth === "Bearer TOKEN-A",
      calls[0] ? String(calls[0].auth) : "no call");
    A("...carrying the image bytes, not a stringified object", calls[0] && calls[0].body === BYTES);
    A("...to a path built from the slug", calls[0] && /\/team-logos\/sea-\d+\.webp$/.test(calls[0].url), calls[0] && calls[0].url);
    A("the public URL comes back", /^https:\/\/sb\.test\/pub\/sea-\d+\.webp$/.test(String(url)), String(url));
    step2();
  });

  function step2(){
    console.log("\n— a stale token is refreshed and retried with the NEW token");
    const c2 = makeCtx();
    const calls2 = wire(c2, {
      session: { access_token: "STALE" }, refreshed: { access_token: "FRESH" },
      responses: [{ ok: false, status: 403, body: { message: "expired" } }, { ok: true, status: 200 }],
    });
    c2.CG.uploadArtwork({ name: "l.png" }, "BOS", {}).then((u) => {
      A("it retried once", calls2.length === 2, calls2.length + " calls");
      A("...with the refreshed token", calls2[1] && calls2[1].auth === "Bearer FRESH");
      A("...and re-sent the IMAGE, never the parsed error body", calls2[1] && calls2[1].body === BYTES);
      A("...and still returns the public URL", /^https:\/\/sb\.test\/pub\//.test(String(u)));
      step3();
    }).catch((e) => { A("retry path threw", false, e.message); step3(); });
  }

  function step3(){
    console.log("\n— an expired sign-in is refused in plain words, before any upload");
    const c3 = makeCtx();
    const calls3 = wire(c3, { session: null, refreshed: null, responses: [{ ok: true, status: 200 }] });
    c3.CG.uploadArtwork({ name: "l.png" }, "BOS", {}).then(() => {
      A("an expired session must not upload", false);
      finish();
    }).catch((e) => {
      A("refused with the sign-in message", /sign-in expired/.test(e.message), e.message);
      A("...and nothing was sent", calls3.length === 0);
      finish();
    });
  }

  function finish(){
    console.log("\n— the guard hands back the session it validated");
    A("assertCommissioner returns the session, not a bare true", /return session;/.test(src));
    A("...and uploadArtwork takes it from there",
      /var session = await CG\.assertCommissioner\(\);/.test(src));
    A("no caller reads an unbound session", !/await put\(session\.access_token\)[\s\S]{0,0}/.test("") &&
      /var session = await CG\.assertCommissioner\(\);[\s\S]*?await put\(session\.access_token\)/.test(src));
    console.log(`\n${ok ? "PASS" : "FAIL"}`);
    process.exit(ok ? 0 : 1);
  }
}
