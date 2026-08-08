// Club role icons render live from the logo on the site. Run: node tools/role-icons.test.mjs
//
// The old pipeline needed a hand-rendered PNG committed to assets/role-icons/ for every club,
// because the site stores logos as WebP and Discord refuses WebP. That made a new club or a
// re-brand a manual step, and Montreal went days with a blank role icon because of it. Supabase's
// image transformer returns PNG, so the logo a commissioner uploads can become the role icon on
// the next sweep with no dependency and no commit. These assertions hold that line.
process.env.SUPABASE_URL ||= "https://sb.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "k";
process.env.DISCORD_BOT_TOKEN ||= "t";
process.env.DISCORD_GUILD_ID ||= "guild1";

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");   // a PNG magic header
let served, lastUrl;
function serve(contentType, bytes = PNG) { served = { contentType, bytes }; }
serve("image/png");

globalThis.fetch = async (url) => {
  lastUrl = String(url);
  return new Response(served.bytes, { status: 200, headers: { "content-type": served.contentType } });
};

const { _internals: I } = await import(new URL("../netlify/functions/discord-sync.js", import.meta.url).pathname);
const fetchClubLogoPng = I.fetchClubLogoPng;

console.log("— the object URL is rewritten to the PNG transformer");
{
  const objUrl = "https://x.supabase.co/storage/v1/object/public/team-logos/mtl-123.webp";
  const img = await fetchClubLogoPng(objUrl);
  A("it requests the render endpoint, not the raw object",
    lastUrl.includes("/storage/v1/render/image/public/") && !lastUrl.includes("/object/public/"));
  A("...at icon size", /width=128/.test(lastUrl) && /height=128/.test(lastUrl));
  A("...preserving aspect ratio", /resize=contain/.test(lastUrl));
  A("a data URI comes back", /^data:image\/png;base64,/.test(img.data));
}

console.log("\n— formats Discord would reject are refused, not sent");
{
  serve("image/webp");
  let threw = null;
  try { await fetchClubLogoPng("https://x.supabase.co/storage/v1/object/public/team-logos/a.webp"); }
  catch (e) { threw = e; }
  A("a WebP response is rejected", !!threw);
  A("...naming the format", /webp/.test(String(threw && threw.message)));

  serve("image/jpeg");
  A("jpeg is accepted", /^data:image\/jpeg;base64,/.test((await fetchClubLogoPng("https://x/y.jpg")).data));
  serve("image/gif");
  A("gif is accepted", /^data:image\/gif;base64,/.test((await fetchClubLogoPng("https://x/y.gif")).data));
  serve("image/png");
}

console.log("\n— guard rails");
{
  serve("image/png", Buffer.alloc(300 * 1024));
  let threw = null;
  try { await fetchClubLogoPng("https://x/big.png"); } catch (e) { threw = e; }
  A("an oversized logo is refused before Discord sees it", !!threw && /limit/.test(String(threw.message)));
  serve("image/png");

  A("no logo means no request", (await fetchClubLogoPng(null)) === null);

  const nonSb = "https://cdn.example.com/logo.png";
  await fetchClubLogoPng(nonSb);
  A("a non-Supabase URL is fetched as-is", lastUrl === nonSb);
}

console.log("\n— the pipeline is genuinely live, not asset-backed");
{
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../netlify/functions/discord-sync.js", import.meta.url), "utf8");
  A("clubs no longer read a shipped PNG", /fetchClubLogoPng\(w\.src\)/.test(src));
  A("...while STAFF keeps its fixed repo artwork", /readRoleIcon\(w\.code\)/.test(src));
  A("a logo fetch failure cannot abort the whole icon pass", /snap\.push\(`\$\{w\.code\}=logo-error`\)/.test(src));
  A("re-application is keyed on the logo URL, so it fires exactly on a re-brand",
    /applied\[rid\] = w\.src/.test(src) && /src: t\.logo_url/.test(src));
}

console.log("\n— the pre-rendered pipeline is fully gone, not just bypassed");
{
  const fs = await import("node:fs");
  const dir = new URL("../assets/role-icons/", import.meta.url);
  const left = fs.readdirSync(dir).filter((f) => !f.startsWith("."));
  A("only the fixed STAFF artwork is still shipped", left.join(",") === "STAFF.png", left.join(","));
  A("...so no club PNG can go stale against the site", !left.some((f) => /^(?!STAFF)[A-Z]{2,3}\.png$/.test(f)));

  const src = fs.readFileSync(new URL("../netlify/functions/discord-sync.js", import.meta.url), "utf8");
  A("the manifest is no longer read", !/manifest\.json/.test(src));
  /* `stale-render` only existed because an image could be rendered from an older logo than the site
     now serves. Nothing is pre-rendered, so that state is unreachable — dead branches that can never
     fire are exactly the kind of thing a future reader trusts and reasons from. Matched on the
     emitted marker and on `img.src`, so the prose above may still explain what was removed. */
  A("the stale-render branch no longer emits", !/=stale-render/.test(src));
  A("...and nothing compares a render's source any more", !/img\.src/.test(src));

  /* The trap this cleanup removed: two copies of the version marker meant that following the
     documented "bump to force a re-apply" instruction parked STAFF in stale-render forever. */
  const markers = src.match(/local:referee-jersey-v\d+/g) || [];
  A("the STAFF version marker exists exactly once", markers.length === 1, markers.join(","));
}

console.log("\n— STAFF still resolves off disk (the one thing still bundled)");
{
  const fs = await import("node:fs");
  const staff = I.readRoleIcon("STAFF");
  A("STAFF.png is found and read", !!staff && /^data:image\/png;base64,/.test(staff.data));
  A("...carrying no manifest-derived src to compare against", !("src" in staff));
  A("a club code no longer resolves to a shipped file", I.readRoleIcon("MTL") === null);

  const toml = fs.readFileSync(new URL("../netlify.toml", import.meta.url), "utf8");
  A("...and the bundler still ships the directory", /assets\/role-icons/.test(toml));

  /* sum.roleIcons was incremented on every apply and then dropped from the result, so a sweep that
     re-rendered an icon looked identical to one that did nothing. The per-role snap key carried the
     detail, but the counter itself was write-only. */
  const src = fs.readFileSync(new URL("../netlify/functions/discord-sync.js", import.meta.url), "utf8");
  A("the icon counter actually reaches the sweep result", /roleIcons: sum\.roleIcons/.test(src));
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
