/* v4.59: Season 2 Saturday bidding. node tools/s2-bid-nights-v459.test.cjs
   Commissioner, 2026-11-02: "bids always start at 750k and can only be raised by 250k at a time. a team cannot place two
   bids in a row on the same player." 2026-11-23: no automatic bidding; the office pause freezes and resumes every
   countdown; pause and resume belong only to the Draft and Bidding manager or a commissioner. 2026-11-23 (night): "Every
   week should have a bidding if games are played up until after the deadline". Pins the record (tables, RLS and grants,
   Realtime and the pulse, can_run_market, the bid-night calendar, market_bid's checks and locks, the tick steps, the
   office tools, the board, the recap, the patches, the self-checks) and its rehearsal. */
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const R = (f) => fs.readFileSync(path.join(root, f), "utf8");
let pass = 0, fail = 0;
const A = (name, cond, more) => { if (cond) { pass++; console.log("PASS " + name); } else { fail++; console.log("FAIL " + name + (more ? "  (" + more + ")" : "")); } };
const DASHES = new RegExp("[" + String.fromCharCode(0x2014, 0x2013) + "]");
const GENDERED = /\b(he|his|him|she|her|hers|himself|herself)\b/i;

const REC = "sql/2026-11-24-s2-bid-nights-v459.sql";
const REH = REC.replace(/\.sql$/, ".rehearsal.sql");
const sql = R(REC);
const fn = (name) => { const m = sql.match(new RegExp("create or replace function public\\." + name + "\\([\\s\\S]*?\\$f\\$([\\s\\S]*?)\\$f\\$;")); return m ? m[1] : ""; };
const tag = (src, t) => { const m = src.match(new RegExp("\\$" + t + "\\$([\\s\\S]*?)\\$" + t + "\\$")); return m ? m[1] : ""; };
const before = (s, a, b) => s.indexOf(a) >= 0 && s.indexOf(b) >= 0 && s.indexOf(a) < s.indexOf(b);
const once = (s, a) => s.split(a).length === 2;
/* what a member or the office reads: comments, raise messages and one-line text literals (code with '::' is not text) */
const messages = [(sql.match(/^\s*--.*$/gm) || []).join("\n"), (sql.match(/\/\*[\s\S]*?\*\//g) || []).join("\n"),
  (sql.match(/raise exception '(?:[^']|'')*'/g) || []).join("\n"),
  (sql.match(/'(?:[^'\n]|'')*'/g) || []).filter((s) => / \w+ /.test(s) && !/::|\(/.test(s)).join("\n")].join("\n");

console.log("1. Rulings and preconditions");
A("the header quotes the bidding rulings",
  /"bids always start at 750k and can only be raised by 250k at a time\. a team cannot place two bids in a row\n--     on the same player\./.test(sql)
  && /"Only training camp players with at least 6 games played can be bid on at the saturday bidding events\."/.test(sql)
  && /"a team cannot place a bid on a player that would take them over their salary cap\."/.test(sql)
  && /"Every week should have a bidding if games are played up until after the deadline"/.test(sql));
A("it refuses to run without v4.58, on a changed _market_led, without the tick's end line, or twice",
  ["the v4.58 Season 2 records (db-guards, waivers, minimums) must be applied first", "_market_led is no longer the waivers record''s placeholder",
   "market_tick has no steps end line", "roster_spots_origin_check does not accept market_bid", "a bid-night table already exists",
   "can_run_market already exists", "season_rules(Season 2) carries no bidding constants"].every((t) => sql.indexOf(t) >= 0));

console.log("\n2. The tables");
A("one night per season and date; one lot per player per night; the lot order is unique",
  /constraint market_bid_nights_one unique \(season_id, night\)/.test(sql) && /constraint market_lots_one unique \(night_id, profile_id\)/.test(sql)
  && /constraint market_lots_ord unique \(night_id, ord\)/.test(sql));
A("ties are impossible in the table: unique (lot_id, seq) and unique (lot_id, amount)",
  /constraint market_bids_seq unique \(lot_id, seq\),\n\s+constraint market_bids_amount unique \(lot_id, amount\)/.test(sql));
A("a lot's shape: sold has a club and a time; an unbid lot has no price; a running one has a clock or a frozen remainder, never both",
  /constraint market_lots_sold_shape check \(\(state = 'sold'\) = \(sold_team_id is not null\) and \(state = 'sold'\) = \(sold_at is not null\)\)/.test(sql)
  && /constraint market_lots_unbid_shape check \(state not in \('open', 'unsold'\) or \(bids = 0 and price is null\)\)/.test(sql)
  && /constraint market_lots_bid_shape check \(state not in \('running', 'sold'\) or \(bids >= 1 and price is not null\)\)/.test(sql)
  && /constraint market_lots_clock_shape check \(state <> 'running' or \(\(ends_at is null\) <> \(paused_remaining is null\)\)\)/.test(sql));
const lotsTable = (sql.match(/create table public\.market_lots \(([\s\S]*?)\n\);/) || [])[1] || "";
A("the leading club is never a column of the lot (bidders stay hidden while it runs)",
  lotsTable.length > 0 && /sold_team_id uuid/.test(lotsTable) && !/^\s+(leader|leading|top_team|top_bid|team_id)\b/m.test(lotsTable));
A("every table: RLS on and every API grant revoked before any grant",
  ["market_bid_nights", "market_lots", "market_bids", "market_boards"].every((t) =>
    before(sql, "alter table public." + t + " enable row level security;", "grant select")
    && before(sql, "revoke all on public." + t + " from public, anon, authenticated;", "grant select")));
A("column grants leave who paused, why, who voided, the void detail and who placed a bid to the office",
  /grant select \(id, season_id, night, opens_at, new_until, state, paused_at, closed_at, recap_at, created_at\)\n\s+on public\.market_bid_nights to anon, authenticated;/.test(sql)
  && /grant select \(id, lot_id, night_id, team_id, seq, amount, placed_at\) on public\.market_bids to anon, authenticated;/.test(sql)
  && !/grant select \([^)]*\b(paused_by|pause_reason|void_detail|voided_by|placed_by)\b/.test(sql)
  && !/grant (insert|update|delete|all)[^;]*market_(bid_nights|lots|bids|boards)/i.test(sql)
  && /grant select on public\.market_boards to authenticated;/.test(sql) && !/market_boards to anon/.test(sql));
A("bids: a club reads its own, the office all, everyone once the auction is over",
  /create policy "bids: own club, the office, or everyone once the auction is over" on public\.market_bids for select to anon, authenticated\n\s+using \(public\.can_run_market\(\) or public\.is_gm_of\(team_id\)\n\s+or exists \(select 1 from public\.market_lots l where l\.id = lot_id and l\.state in \('sold', 'unsold', 'void'\)\)\);/.test(sql));
A("boards: the club's own front office and the commissioners (the draft_boards pattern)",
  /create policy "bid boards: own club and the office" on public\.market_boards for select to authenticated\n\s+using \(public\.is_gm_of\(team_id\) or public\.is_commissioner\(\)\);/.test(sql));
A("Realtime carries the three room tables, not the boards",
  /alter publication supabase_realtime add table public\.market_bid_nights, public\.market_lots, public\.market_bids;/.test(sql)
  && !/alter publication[^;]*market_boards/.test(sql));
A("the 'market' pulse marks nights and lot state changes; a raise (price, bids, clock) does not",
  (sql.match(/execute function public\._live_mark\('market', '', ''\);/g) || []).length === 3
  && /live_mark_market_lots_upd after update on public\.market_lots\n\s+referencing old table as old_rows new table as new_rows for each statement execute function public\._live_mark\('market', '', 'price,bids,last_bid_at,ends_at,paused_remaining'\);/.test(sql)
  && !/_live_mark[^;]*on public\.market_bids/.test(sql));

console.log("\n3. Who runs the market");
const crm = fn("can_run_market");
A("can_run_market is created before the policy that calls it (CREATE POLICY resolves its functions when it runs)",
  before(sql, "create or replace function public.can_run_market()", "create policy") && before(sql, "-- 1. who runs Saturday bidding", "-- 2. the tables"));
A("the apply order is written down: bid nights before committees, and a can_run_market that already exists stops the record",
  /Apply order \(main session, 2026-11-24, binding\): this record BEFORE the committees record\./.test(sql)
  && /raise exception 'v4.59 bid nights: can_run_market already exists \(this record creates it and applies BEFORE the committees record, which only widens it\)';/.test(sql)
  && (crm.match(/public\.is_commissioner\(\)/g) || []).length === 1);
A("can_run_market is is_commissioner() with the shortcut marker the committees record widens",
  /\n  -- shortcut: commissioners only until a Draft and Bidding manager is seated, widen when committee seats exist\n  select public\.is_commissioner\(\)\n$/.test(crm)
  && /grant execute on function public\.can_run_market\(\) to anon, authenticated;/.test(sql));
["market_pause", "market_resume", "market_void_lot"].forEach((f) => {
  const b = fn(f);
  A(f + ": can_run_market first, refused in a sentence the grant audit reads as a gate ('Only ...')",
    /^\s*\/\*[\s\S]*?\*\/\ndeclare [\s\S]*?\nbegin\n  if not public\.can_run_market\(\) then\n    raise exception 'Only a commissioner or the Draft and Bidding manager can /.test(b)
    && /using errcode = '42501';/.test(b) && /public\.market_on\(v_[nl]\.season_id\)/.test(b) && /log_admin_action\('market_/.test(b));
});

console.log("\n4. The bid nights");
const bn = fn("_market_bid_nights");
A("computed from the schedule and movement_deadline_at, never hard-coded",
  /public\.movement_deadline_at\(x\.id\) as deadline/.test(bn) && /from public\.games g/.test(bn)
  && /coalesce\(g\.stage, 'regular'\) = 'regular'/.test(bn) && /not coalesce\(g\.voided, false\)/.test(bn)
  && !/20\d\d-\d\d-\d\d/.test(bn.replace(/\/\*[\s\S]*?\*\//g, "")) && !/'(21|22):00'/.test(bn)
  && /season_rules\(x\.id\)->'mk'->>'opens'/.test(bn) && /season_rules\(x\.id\)->'mk'->>'new_until'/.test(bn));
A("the Saturday of the game's Sunday to Saturday week, Eastern, after the draft and before the deadline",
  /\(gd\.d \+ \(6 - extract\(dow from gd\.d\)::int\)\)::date as sat/.test(bn) && /at time zone 'America\/New_York'\)::date as d/.test(bn)
  && /\(sp\.sat \+ s\.t_open\) at time zone 'America\/New_York' < s\.deadline/.test(bn)
  && /\(s\.draft_at is null or \(sp\.sat \+ s\.t_open\) at time zone 'America\/New_York' > s\.draft_at\)/.test(bn));
A("weeks between with no games are returned skipped (holiday weeks)",
  /generate_series\(m\.a, m\.b, interval '7 days'\)/.test(bn) && /not exists \(select 1 from wk where wk\.sat = sp\.sat\)/.test(bn));
const cal = fn("market_calendar");
A("market_calendar: a night that opened reports its stored state first, even if its week later lost every game",
  /'state', case when n\.id is not null then n\.state when b\.skipped then 'skipped'/.test(cal)
  && (cal.match(/full join \(select x\.\* from public\.market_bid_nights x where x\.season_id = p_season\) n on n\.night = b\.night/g) || []).length === 2
  && /'skipped', n\.id is null and b\.skipped/.test(cal) && /where \(n\.id is not null and n\.state <> 'closed'\) or \(n\.id is null and not b\.skipped and now\(\) < b\.new_until\)/.test(cal));
A("market_calendar reads them through the one definition, with the night's own times once it opened, and a missed state",
  (cal.match(/public\._market_bid_nights\(p_season\)/g) || []).length === 2 && /coalesce\(n\.new_until, b\.new_until\)/.test(cal)
  && /when now\(\) >= b\.new_until then 'missed' else 'upcoming'/.test(cal) && /public\.night_lock_at\(p_season, gn\.gd\)/.test(cal)
  && /return jsonb_build_object\('season_id', p_season, 'market', false\);/.test(cal)
  && /grant execute on function public\.market_calendar\(uuid\) to anon, authenticated;/.test(sql));

console.log("\n5. market_bid");
const bid = fn("market_bid");
A("the seat, then the Owner-approval refusal, then the market context, then the deadline",
  before(bid, "if not (v_office or public.is_gm_of(p_team)) then", "hint = 'owner_bids'") && before(bid, "hint = 'owner_bids'", "public._market_ctx(p_team, 'freeagents')")
  && before(bid, "public._market_ctx(p_team, 'freeagents')", "hint = 'deadline'"));
A("the club lock, then the night FOR SHARE, then the lot row FOR UPDATE (the pause's order), all before every check",
  before(bid, "perform public._market_club_lock(p_team);", "select n.* into v_n from public.market_bid_nights n where n.id = v_night for share;")
  && before(bid, "select n.* into v_n from public.market_bid_nights n where n.id = v_night for share;", "select l.* into v_l from public.market_lots l where l.id = p_lot for update;")
  && before(bid, "for update;", "hint = 'over'") && !/where n\.id = v_l\.night_id/.test(bid)
  && /select l\.night_id into v_night from public\.market_lots l where l\.id = p_lot and l\.season_id = v_season;/.test(bid)
  && /market_bid must hold the night before it locks the lot/.test(sql));
const order = ["hint = 'over'", "hint = 'paused'", "hint = 'void'", "hint = 'new_closed'", "hint = 'price_moved'", "hint = 'own_top'",
  "hint = 'unavailable'", "hint = 'suspended'", "hint = 'no_spot'", "hint = 'over_cap'", "hint = 'minimums'", "insert into public.market_bids"];
A("the refusals in the concept's order: closed, paused, void, 10 PM, over, price, own top, eligibility, spot, cap, minimums",
  order.every((h, i) => i === 0 || before(bid, order[i - 1], h)), order.find((h, i) => i > 0 && !before(bid, order[i - 1], h)));
A("every clock test reads clock_timestamp(), never now()",
  /clock_timestamp\(\) >= v_n\.new_until/.test(bid) && /v_l\.ends_at <= clock_timestamp\(\)/.test(bid) && !/now\(\)/.test(bid)
  && /ends_at = clock_timestamp\(\) \+ make_interval\(secs => v_secs\)/.test(bid));
A("the engine sets the amount: the opening price, else the top bid plus one step; any other expected price is refused",
  /v_next := case when v_l\.price is null then v_open else v_l\.price \+ v_step end;/.test(bid) && /if p_expect <> v_next then/.test(bid)
  && /v_open := \(v_rules->'mk'->>'bid_open'\)::bigint;/.test(bid) && /v_step := \(v_rules->'mk'->>'bid_step'\)::bigint;/.test(bid)
  && !/750000|250000/.test(bid));
A("own top: the newest bid on the lot is the club's",
  /select b\.team_id into v_top from public\.market_bids b where b\.lot_id = v_l\.id order by b\.seq desc limit 1;\n\s+if v_top = p_team then/.test(bid));
A("spots and cap count every bid the club leads (_market_led), read after the lock",
  /select count\(\*\), coalesce\(sum\(x\.amount\), 0\) into v_led_n, v_led from public\._market_led\(p_team\) x;/.test(bid)
  && /if v_active \+ v_led_n \+ 1 > v_max then/.test(bid) && /v_pay := public\.team_cap_used\(v_season, p_team\);\n\s+if v_pay \+ v_led \+ v_next > v_cap then/.test(bid));
const mb = fn("_market_min_blocked");
A("the minimums: one test (_market_min_blocked over roster_min_gap), each led lot filling a spot of its own group",
  /v_gap jsonb := public\.roster_min_gap\(p_season, p_team, p_group, null\);/.test(mb)
  && /greatest\(coalesce\(\(v_gap->>grp\.g\)::int, 0\) - coalesce\(led\.n, 0\), 0\)/.test(mb)
  && /return v_short > coalesce\(\(v_gap->>'open'\)::int, 0\) - v_led_n;/.test(mb)
  && /if public\._market_min_blocked\(v_season, p_team, public\.pos_group\(v_l\.position\)\) then/.test(bid) && !/roster_min_gap/.test(bid.replace(/\/\*[\s\S]*?\*\//g, "")));
const cpatch = tag(sql, "claim");
A("...and the claim uses the same test: market_claim patched on its own formula, anchored once, self-checked",
  /a text := \$a\$  v_gap := public\.roster_min_gap\(v_season, p_team, v_grp, null\);\n  if coalesce\(\(v_gap->>'short'\)::int, 0\) > coalesce\(\(v_gap->>'open'\)::int, 0\) - v_led_n then\n\$a\$;/.test(cpatch)
  && /\n  if public\._market_min_blocked\(v_season, p_team, v_grp\) then\n\$b\$;/.test(cpatch)
  && /if n <> 1 then raise exception 'v4.59 bid nights: the market_claim anchor matched % times, expected exactly 1', n; end if;/.test(cpatch)
  && /the bid and the claim must share _market_min_blocked/.test(sql) && /to_regprocedure\('public\.market_claim\(uuid,uuid\)'\) is null/.test(sql));
A("the bid row, then the lot: running, the price, the count, the clock reset; the player's DM on the first bid only, without the club",
  before(bid, "insert into public.market_bids (lot_id, night_id, team_id, seq, amount, placed_by)", "update public.market_lots")
  && /values \(v_l\.id, v_l\.night_id, p_team, v_l\.bids \+ 1, v_next, auth\.uid\(\)\)/.test(bid)
  && /set state = 'running', price = v_next, bids = bids \+ 1, last_bid_at = clock_timestamp\(\),/.test(bid)
  && /if v_l\.bids = 0 then\n\s+perform public\._market_dm\(v_l\.profile_id, 'Bidding opened on you at Saturday bidding\. The clubs bidding stay hidden until your auction ends\.'\);/.test(bid)
  && /grant execute on function public\.market_bid\(uuid, uuid, bigint\) to authenticated;/.test(sql));

console.log("\n6. The tick");
const cl = fn("_market_close_lots");
A("withdrawals first: a lot whose player left the pool or is suspended is void at once, the detail for the office only",
  before(cl, "-- a. withdrawals", "-- b. sales") && /public\._market_waiver_void_why\(p_season, l\.profile_id\) is not null or public\.is_suspended\(l\.profile_id\)/.test(cl)
  && /order by l\.id for update skip locked/.test(cl));
A("a sale: lots locked SKIP LOCKED and re-judged on clock_timestamp(); a paused night sells nothing; the winner's club lock only tried",
  /l\.state = 'running' and l\.ends_at <= clock_timestamp\(\)\n\s+and not exists \(select 1 from public\.market_bid_nights n where n\.id = l\.night_id and n\.paused_at is not null\)\n\s+order by l\.ends_at, l\.id for update of l skip locked/.test(cl)
  && /continue when not public\._market_club_lock\(w\.team_id, false\);/.test(cl));
A("...the player signs at the price, origin market_bid, the deferred roster check fired inside the block by name",
  /values \(p_season, w\.team_id, r\.profile_id, v_jersey, r\.position, r\.price, 'market_bid', 'pro'\);/.test(cl)
  && /execute 'set constraints public\.check_roster_structure_trg immediate';\n\s+execute 'set constraints public\.check_roster_structure_trg deferred';/.test(cl)
  && !/set constraints all/.test(cl) && /values \(p_season, 'bid', v_club \|\| ' won <b>'/.test(cl));
A("...a refused sale voids the lot loudly (staff channel, the winning club's seats, never its room) and the tick goes on",
  /exception when others then\n\s+v_err := sqlerrm;/.test(cl) && /why = 'The sale could not be completed\.', void_detail = left\(v_err, 500\)/.test(cl)
  && /perform public\.notify_staff_ch\(null, 'Saturday bidding: the sale of \*\*'/.test(cl)
  && /'Saturday bidding: sale not completed',[\s\S]*?null, 'manager', null, null, false\);/.test(cl));
A("the 10 PM cut makes open lots of an unpaused night unsold; running countdowns finish",
  /update public\.market_lots l set state = 'unsold', ended_at = clock_timestamp\(\)\n\s+from public\.market_bid_nights n\n\s+where n\.id = l\.night_id and n\.season_id = p_season and n\.state in \('live', 'closing'\) and n\.paused_at is null\n\s+and clock_timestamp\(\) >= n\.new_until and l\.state = 'open';/.test(cl));
const cn = fn("_market_close_night");
A("a night closes when no auction is open or running; nights taken SKIP LOCKED",
  /for update skip locked/.test(cn) && /l\.state in \('open', 'running'\)/.test(cn) && /set state = 'closing'/.test(cn) && /set state = 'closed', closed_at = clock_timestamp\(\)/.test(cn));
const rc = fn("_market_post_recaps");
A("the recap posts once through _announce_once to the news channel, and fails loudly with no webhook",
  /perform public\._announce_once\(v_num, v_key, 'discord_news_webhook', v_title, left\(v_body, 4000\)\);/.test(rc)
  && /v_key := 'market-recap-' \|\| to_char\(r\.night, 'YYYY-MM-DD'\);/.test(rc)
  && /if not exists \(select 1 from public\.app_config c where c\.key = 'ann_' \|\| v_num \|\| '_' \|\| v_key\) then\n\s+raise exception/.test(rc)
  && /set recap_at = clock_timestamp\(\)/.test(rc) && /regexp_replace\(/.test(rc));
A("the recap says only what is true: the next bid night by name when there is one, else the pool; a neutral empty night",
  /select min\(b\.night\) into v_next from public\._market_bid_nights\(p_season\) b where not b\.skipped and b\.night > r\.night;/.test(rc)
  && /' eligible for the next bid night, ' \|\| to_char\(v_next, 'FMMonth FMDD'\) \|\| '\.'/.test(rc) && /else ' in the training camp pool\.' end/.test(rc)
  && /'No training camp player was up for bidding\.'/.test(rc) && !/had played/.test(rc) && !/v_gp/.test(rc));
const op = fn("_market_open_night");
A("the open step: the one calendar, the draft done, never after the deadline, once per night, lots only on a real insert",
  /public\._market_bid_nights\(p_season\) b\n\s+where not b\.skipped and b\.opens_at <= p_now and p_now < b\.new_until;/.test(op)
  && /if not public\._market_draft_done\(p_season\) or public\.moves_locked\(p_season\) then return 0; end if;/.test(op)
  && /on conflict \(season_id, night\) do nothing\n\s+returning id into v_id;\n\s+if v_id is null then return 0; end if;/.test(op)
  && before(op, "returning id into v_id;", "insert into public.market_lots"));
A("...eligible pool players only (market_pool: six box-score games, not suspended), in rating order, fixed",
  /from public\.market_pool\(p_season\) mp join public\.profiles p on p\.id = mp\.profile_id\n\s+where mp\.eligible/.test(op)
  && /row_number\(\) over \(order by \(select max\(o\.overall\) from public\.player_position_overalls o\n\s+where o\.profile_id = mp\.profile_id and o\.headline\) desc nulls last,\n\s+mp\.gp desc, mp\.profile_id\)/.test(op)
  && /'postdraft_done_' \|\| p_season::text/.test(op) && /shortcut: no catch-up night/.test(op));
A("...never a second lot on a player still up for auction, and a pause left on is reported when the next night opens",
  /and not exists \(select 1 from public\.market_lots ml where ml\.profile_id = mp\.profile_id and ml\.state in \('open', 'running'\)\);/.test(op)
  && /from public\.market_bid_nights n where n\.season_id = p_season and n\.id <> v_id and n\.paused_at is not null;/.test(op)
  && /perform public\.notify_staff_ch\(null, 'Saturday bidding \(' \|\| to_char\(v_b\.night, 'Dy, Mon FMDD'\) \|\| '\) opened while the bidding of '/.test(op));
const tk = tag(sql, "tick");
A("market_tick runs the four steps in their own blocks, above the steps end line, anchored once",
  ["_market_close_lots", "_market_close_night", "_market_post_recaps", "_market_open_night"].every((s, i, a) =>
    new RegExp("    begin\\n      perform public\\." + s + "\\(v_season\\);   -- v4.59: [^\\n]+\\n    exception when others then\\n      v_errors := v_errors \\|\\| \\('[a-z ]+: ' \\|\\| sqlerrm\\);\\n    end;").test(tk)
    && (i === 0 || before(tk, a[i - 1] + "(v_season)", s + "(v_season)")))
  && /a text := \$a\$    -- market-tick steps end\n\$a\$;/.test(tk) && /\$b\$ \|\| a;/.test(tk)
  && /if n <> 1 then raise exception 'v4.59 bid nights: the market_tick anchor matched % times, expected exactly 1', n; end if;/.test(tk));

console.log("\n7. The office tools and the board");
const pa = fn("market_pause"), re = fn("market_resume"), vo = fn("market_void_lot"), sb = fn("save_market_board");
A("pause freezes each running countdown's remainder, locks running lots in id order, leaves a run-out countdown to settle",
  /perform 1 from public\.market_lots l where l\.night_id = p_night and l\.state = 'running' order by l\.id for update;/.test(pa)
  && /update public\.market_lots set paused_remaining = ends_at - v_at, ends_at = null\n\s+where night_id = p_night and state = 'running' and ends_at > v_at;/.test(pa));
A("resume gives the time back and moves the 10 PM cut by the pause when it began before it",
  /v_until := case when v_n\.paused_at < v_n\.new_until then v_n\.new_until \+ v_len else v_n\.new_until end;/.test(re)
  && /update public\.market_lots set ends_at = v_at \+ paused_remaining, paused_remaining = null/.test(re));
A("void needs a reason, never undoes a sale, tells the leading club's seats only",
  /if p_lot is null or v_reason is null then/.test(vo) && /hint = 'sold'/.test(vo) && /why = 'Withdrawn by the league office\.'/.test(vo)
  && /null, 'manager', null, null, false\);/.test(vo));
A("the board: an approve seat saves its plan (no approval move exists), every other mode through mgmt_gate; bad input is plain",
  /if public\.mgmt_access\(p_team, 'freeagents'\) is distinct from 'approve' then\n\s+perform public\.mgmt_gate\(p_team, 'freeagents'\);\n\s+end if;/.test(sb)
  && /exception when invalid_text_representation then\n\s+v_pid := null;/.test(sb)
  && /exception when invalid_text_representation or numeric_value_out_of_range then\n\s+v_ceil := -1;/.test(sb));
A("the board: the seat, the market, Free agents access; pool or waivers only; ceilings in whole bid steps; 60 rows; notes of 200",
  before(sb, "if not (public.is_gm_of(p_team) or public.is_commissioner()) then", "perform public.mgmt_gate(p_team, 'freeagents');")
  && /hint = 'not_in_pool'/.test(sb) && /\(v_ceil - v_open\) % v_step <> 0/.test(sb) && /> 60 then/.test(sb) && /char_length\(v_note\) > 200/.test(sb)
  && /grant execute on function public\.save_market_board\(uuid, jsonb\) to authenticated;/.test(sql));

console.log("\n8. Patches and self-checks");
const led = fn("_market_led");
A("_market_led: the real read keeps the ruling comment and drops the placeholder",
  /"a team cannot place a\n\s+bid on a player that would take them over their salary cap", commissioner, 2026-11-02\)/.test(led)
  && /order by x\.seq desc limit 1\) b\n\s+where l\.state = 'running' and b\.team_id = p_team/.test(led) && !/where false/.test(led));
const dr = tag(sql, "draw");
A("the shortfall draw never takes a player up for auction (anchored once on its pool filter)",
  /a text := \$a\$       where mp\.pos_group = r\.pos_group and not mp\.suspended\n\$a\$;/.test(dr)
  && /and not exists \(select 1 from public\.market_lots ml where ml\.profile_id = mp\.profile_id and ml\.state in \('open', 'running'\)\)/.test(dr)
  && /if n <> 1 then raise exception/.test(dr));
A("every new function is revoked from the API roles first; only the client RPCs and the gate helper are granted",
  before(sql, "do $grants$", "grant execute on function public.can_run_market()")
  && ["can_run_market()", "_market_bid_nights(uuid)", "market_calendar(uuid)", "_market_led(uuid)", "_market_min_blocked(uuid,uuid,text)", "market_bid(uuid,uuid,bigint)", "_market_close_lots(uuid)",
      "_market_close_night(uuid)", "_market_post_recaps(uuid)", "_market_open_night(uuid,timestamp with time zone)", "market_pause(uuid,text)",
      "market_resume(uuid)", "market_void_lot(uuid,text)", "save_market_board(uuid,jsonb)"].every((f) => tag(sql, "grants").indexOf("'public." + f + "'") >= 0)
  && !/grant execute on function public\._market/.test(sql));
A("every new function is a definer with search_path ''",
  (sql.match(/create or replace function public\.[a-z_]+\([^)]*\)\n?\s*returns[\s\S]*?as \$f\$/g) || []).every((h) => /security definer set search_path to ''/.test(h))
  && (sql.match(/create or replace function public\./g) || []).length === 14);
A("the self-checks raise on grants, RLS, Realtime, the pulse, the backstops, the tick order, the patches, the cron job and Season 1",
  ["must be SECURITY DEFINER with search_path", "anon can execute %", "authenticated can execute the internal %", "a client RPC or the gate helper lost its grant",
   "can_run_market must be one function, is_commissioner() with its shortcut marker", "must have RLS on and exactly one (SELECT) policy", "grants are wrong: % has %",
   "reads an office-only column", "cannot read the room", "anon reads the bid boards", "Realtime must carry exactly the three room tables",
   "the market pulse triggers are missing", "a race backstop (unique constraint) is missing", "market_tick does not run the four bid-night steps in order",
   "_market_led is still the placeholder", "the shortfall draw can still take a player up for auction", "the market-tick job must exist exactly once",
   "season_rules(Season 1) changed", "Season 1 must not be a market season", "Season 1 has a market calendar"].every((t) => tag(sql, "chk").indexOf(t) >= 0));
A("Season 1's rules are compared to the literal captured before the change",
  /s1_rules constant jsonb := '\{"flex": null, "lines": null, "quota": \{"D": 5, "F": 7, "G": 3\}[^']*"trade_deadline_week": 4\}'::jsonb;/.test(sql));
A("the grant self-check covers both API roles and every write privilege, with any CASE in an IF parenthesized",
  /foreach r in array array\['anon', 'authenticated'\] loop\n\s+foreach pr in array array\['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'\] loop/.test(sql)
  && !/\n\s*(if|elsif|or|and) case when/i.test(sql));
A("no em dashes, no spaced hyphens in messages, no gendered pronouns, no S2 rule numbers, no dormant-rule word",
  !DASHES.test(sql) && !/ - /.test(messages) && !GENDERED.test(sql) && !/Rule S2/.test(sql) && !/abandon/i.test(sql));
A("Discord only through the doors; nothing posts straight to pg_net; no new Netlify function",
  !/net\.http_post|discord_http_post\(/.test(sql) && /_announce_once/.test(sql) && !fs.readdirSync(path.join(root, "netlify/functions")).some((f) => /market|bid/i.test(f)));
A("the record names no version but v4.59 (stamped at ship time)", !/\bv4\.([6-9]\d)\b/.test(sql) && /v4.59 bid nights/.test(sql));

console.log("\n9. The rehearsal");
const reh = R(REH);
const embedded = (reh.match(/-- >>> record text: [^\n]*\n([\s\S]*?)-- <<< record text\n/) || [])[1] || "";
const rest = reh.replace(embedded, "");
A("it carries the record's text byte for byte", embedded === sql.replace(/\n?$/, "\n"));
A("one transaction: begins once and never commits", (reh.match(/^begin;$/gm) || []).length === 1 && !/^(commit|end)\s*;/im.test(reh));
A("it acts through the API roles as each club's Owner, a commissioner and anon",
  (rest.match(/set local role authenticated;/g) || []).length >= 8 && (rest.match(/set local role anon;/g) || []).length >= 5
  && /json_build_object\('sub', current_setting\('rh\.com'\), 'role', 'authenticated'\)/.test(rest));
const world = (rest.match(/do \$w\$([\s\S]*?)end \$w\$;/) || [])[1] || "";
A("the world builds its own schedule and box scores and says why it needs an empty Season 2",
  /This rehearsal needs an empty Season 2: run it before the Dec 5 seating\./.test(world)
  && /This rehearsal builds its own schedule: run it before the Season 2 schedule is generated\./.test(world)
  && /insert into public\.games/.test(world) && /insert into public\.game_stats/.test(world) && /p\.role = 'member'/.test(world));
A("the calendar is asserted, not assumed: Dec 19, Jan 9, Jan 16; Dec 26 and Jan 2 skipped; the Jan 23 deadline",
  /'2026-12-19,2027-01-09,2027-01-16'/.test(rest) && /'2026-12-26,2027-01-02'/.test(rest) && /timestamptz '2027-01-23 00:00 America\/New_York'/.test(rest));
A("every refusal is checked by its hint or state, and re-raised when it is not the expected one",
  ["own_top", "price_moved", "no_spot", "over_cap", "minimums", "void", "paused", "new_closed", "over", "ceiling", "not_in_pool", "duplicate"]
    .every((h) => new RegExp("if v_h is distinct from '" + h + "'").test(rest))
  && (rest.match(/if v_state <> '42501' then raise; end if;/g) || []).length >= 5);
A("the led goaltender counts toward the minimums (T6), a refused sale voids without failing the tick (T12), the recap posts once (T14)",
  /T6 failed: E''s bid on Pf3 did not land/.test(rest) && /T12 failed: the refused sale failed the tick/.test(rest)
  && /T14 failed: a second tick posted again/.test(rest) && /ann_2_market-recap-2026-12-19/.test(rest));
A("hidden bidders (T7) and the pause that freezes and gives the time back (T10)",
  /T7 failed: anon read a live bid/.test(rest) && /T7 failed: C read another club''s live bid/.test(rest)
  && /T10 failed: the pause did not freeze the three running countdowns/.test(rest) && /T10 failed: the countdown did not get its time back/.test(rest));
const t3 = (rest.match(/do \$t3\$([\s\S]*?)end \$t3\$;/) || [])[1] || "";
A("client-role blocks read the room by named columns only (select * needs the office's columns), T3 included",
  t3.length > 0 && !/select \* into/.test(t3) && /select state, price, bids, ends_at into l from public\.market_lots where id = v_lot;/.test(t3));
A("Discord requests are counted by this transaction's own text, never by the queue's total",
  !/select count\(\*\) from net\.http_request_queue\)/.test(rest) && /convert_from\(q\.body, 'UTF8'\) like '%Saturday bidding: December 19%'/.test(rest)
  && /stays eligible for the next bid night, January 9\./.test(rest));
A("the pulse case needs a mark newer than the open; anon's market_bid refusal is the grant; T12's setup is $750K",
  /where domain = 'market' and id > v_mark/.test(rest) && /sqlerrm not like 'permission denied for function market_bid%'/.test(rest)
  && /= current_setting\('rh\.fx'\)::uuid\), 750000, 'draft'\);/.test(rest) && !/\$500K/.test(reh));
A("a pause left on: the next night opens without its players, and the staff channel is told (T18)",
  /T18 failed: Jan 16 auctioned a player still up for auction on the paused Jan 9/.test(rest)
  && /opened while the bidding of Jan 9 is still paused/.test(rest));
A("the verdict block raises uncaught with every case named", /do \$v\$\nbegin\n  raise exception 'REHEARSAL OK: T1 T2 T3 T4 T5 T6 T7 T8 T9 T10 T11 T12 T13 T14 T15 T16 T17 T18 T19';\nend \$v\$;\s*$/.test(reh));
A("no dblink, no http, no member named, no profile written by hand",
  !/dblink|http_get|http_post\(/i.test(rest) && !/'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'/.test(rest)
  && !/update public\.profiles/.test(rest));
A("no em dashes in the rehearsal", !DASHES.test(reh));

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
