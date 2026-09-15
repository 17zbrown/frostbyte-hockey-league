/* seed: trade_request — a rostered Bruin asks his own front office for a move through the Action
   Center (#/hub/complaints → "Trade request" card → one-field modal → the case thread).
   The guide layer's Supabase stub answers every insert with { data:[], error:null }, so this seed
   also wraps CG.sb.from for the two case tables: an action_requests insert lands in
   CG.lg._actionReqs and an action_messages insert in CG.lg._actionMsgs — the arrays the pages
   read — so Submit and Reply behave exactly as on the live site (toast, re-render, the new card or
   line appears). Shapes: part_live.js loadActionRequests (:6849), actionCard (:6911),
   fileActionRequest (:7110), the reply handler (:7247).
   ?state=thread → the case was filed on Monday and the player added one follow-up line on Tuesday,
   so #/hub/complaint?id=ar-demo-1 has a thread for both the player and the club's GM.
   ?state=filed  → the case exists with no follow-up yet. Default: nothing on file. */
(window.GUIDE_SEEDS = window.GUIDE_SEEDS || []).push({ name: "trade_request", run: function(CG, t, uid){
  var st = window.GUIDE.qs.get("state") || "";
  var now = CG.now();
  function ymd(ts){ return new Intl.DateTimeFormat("en-CA", { timeZone:"America/New_York" }).format(new Date(ts)); }
  function etAt(daysAgo, hm){ return new Date(Date.parse(CG.etISO(ymd(now - daysAgo*864e5), hm))).toISOString(); }
  /* the filer is the rostered-player persona — the club's first non-management skater, the same
     pick guide_layer.js makes for ?as=player — so the GM states show that player's request */
  var P = (CG.lg.byTeam[t.code]||[]).filter(function(p){ return !p.mgmt && p.pos !== "G"; })[0];
  var CASE_ID = "ar-demo-1";
  var DETAILS = "I’m third on the depth chart at "+P.pos+" and want a shot at top-six minutes. Happy to go anywhere in the "+t.div+" — no hard feelings either way.";
  var FOLLOW_UP = "Also fine with a move to a "+(t.div==="East"?"West":"East")+" club if that helps get it done.";

  CG.lg._actionReqs = []; CG.lg._actionMsgs = {}; CG._actionLoadError = null;
  /* the demo client cannot reload cases (from() answers []) — refreshActions must keep the store */
  CG.loadActionRequests = async function(){};

  if (st === "thread" || st === "filed"){
    CG.lg._actionReqs = [{ id: CASE_ID, profile_id: P.id, type:"trade_request", route:"manager", status:"open",
      subject:null, details: DETAILS, team_id: t.id, season_id: CG.SEASON.id, target:null, target_profile_id:null,
      target_profile:null, assigned_to:null, response:null, created_at: etAt(2, "19:10"), profiles:{ gamertag:P.tag } }];
    if (st === "thread") CG.lg._actionMsgs[CASE_ID] = [{ id:"am-1", request_id:CASE_ID, author_id:P.id, body: FOLLOW_UP,
      internal:false, attachments:[], created_at: etAt(1, "21:20"), profiles:{ gamertag:P.tag, role:"member" } }];
  }

  /* inserts land in the in-memory case store; everything else stays the guide layer's stub */
  var from0 = CG.sb.from, seq = 1;
  function thenable(rows){ var o = { then:function(res, rej){ return Promise.resolve({ data:rows, error:null }).then(res, rej); }, select:function(){ return o; } }; return o; }
  CG.sb.from = function(table){
    if (table !== "action_requests" && table !== "action_messages") return from0.call(CG.sb, table);
    var base = from0.call(CG.sb, table);
    return new Proxy(base, { get: function(target, k){
      if (k !== "insert") return target[k];
      return function(payload){
        var me = CG.auth.profile || {}, stamp = new Date(CG.now()).toISOString();
        var rows = (Array.isArray(payload) ? payload : [payload]).map(function(p){
          seq += 1;
          if (table === "action_requests"){
            var a = Object.assign({ status:"open", assigned_to:null, response:null, target_profile:null }, p,
              { id:"ar-demo-"+seq, created_at:stamp, profiles:{ gamertag: me.gamertag || "member" } });
            CG.lg._actionReqs.unshift(a);            /* the loader orders newest first */
            return a;
          }
          var m = Object.assign({ attachments:[], internal:false }, p,
            { id:"am-"+seq, created_at:stamp, profiles:{ gamertag: me.gamertag || "member", role: me.role || "member" } });
          (CG.lg._actionMsgs[m.request_id] = CG.lg._actionMsgs[m.request_id] || []).push(m);
          return m;
        });
        console.log("[guide] "+table+" insert", rows);
        return thenable(rows);
      };
    } });
  };
} });
