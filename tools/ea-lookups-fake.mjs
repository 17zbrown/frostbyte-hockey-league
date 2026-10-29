// v4.34: a stand-in for public.ea_lookups behind PostgREST, and for the bot's lane that answers it, shared by the
// tests that drive the site's EA actions (tools/manager-merge.test.mjs, tools/pickup-merge.test.mjs,
// tools/ea-lookup-v434.test.mjs). Not a test itself (npm test runs tools/*.test.*).
//
// Mount it in a fake fetch:  if (u.includes("/rest/v1/ea_lookups")) return LOOKUPS.handle(u, opts);
// It understands what shared/ea-relay.cjs sends: GET with id/kind/arg eq filters (newest first), POST of one row.

export function createLookupsFake({ now = () => Date.now() } = {}) {
  const J = (b, c) => new Response(JSON.stringify(b), { status: c || 200, headers: { "content-type": "application/json" } });
  const L = {
    rows: [], posts: [], seq: 0,
    handle(url, opts = {}) {
      const m = opts.method || "GET";
      if (m === "POST") {
        const b = JSON.parse(opts.body);
        L.posts.push(b);
        const row = { id: ++L.seq, kind: b.kind, arg: b.arg, source: b.source, requested_by: b.requested_by,
          created_at: new Date(now()).toISOString(), answered_at: null, ok: null, error: null, raw: null };
        L.rows.push(row);
        return J([{ id: row.id }], 201);
      }
      const q = new URL(url).searchParams;
      const eq = (k, v) => !q.get(k) || q.get(k) === "eq." + v;
      return J(L.rows.filter((r) => eq("id", r.id) && eq("kind", r.kind) && eq("arg", r.arg)).slice().reverse());
    },
    /* the bot's lane: answer every pending row; ea(row) returns EA's raw JSON, or { error } for a failure */
    answerAll(ea) {
      for (const r of L.rows) if (!r.answered_at) {
        const got = ea(r);
        const fail = got && !Array.isArray(got) && typeof got.error === "string";
        Object.assign(r, { answered_at: new Date(now()).toISOString(), ok: !fail, error: fail ? got.error : null, raw: fail ? null : got });
      }
    },
    /* an answer the bot stored earlier (e.g. when the staffer listed the club's games) */
    seed(kind, arg, raw, ageMs = 0) {
      const t = new Date(now() - ageMs).toISOString();
      L.rows.push({ id: ++L.seq, kind, arg, source: "site", requested_by: null, created_at: t, answered_at: t, ok: true, error: null, raw });
      return L.seq;
    },
  };
  return L;
}
