-- v3.89: mid-season random assignments go round the league.
-- Commissioner, 2026-10-07: "Make the mid-season random assignments random but run through each team once before a team
-- can get a 2nd RA." Answers: "Catch up first" (count this season's late sign-up placements so far, so the clubs that had
-- the fewest get the next ones until everyone is level), and "No, mid-season only" (the post-draft placement keeps its
-- straight draw).
--
-- The rule (Rule 2.8): a late sign-up the league office places as depth is drawn at random from the clubs that have
-- received the FEWEST late sign-ups this season, so every club receives one before any club receives a second. Within
-- that set a club with an empty training camp still goes first (v3.16). A club that cannot take him (camp full, or no
-- cap room for the league minimum) is passed over for that draw and keeps its place in line. A placement the league
-- office undoes (removed by the league office, a withdrawn sign-up, or a reversal) does not use up the club's turn; a
-- waiver, a departure from the Discord, a ban or a discipline removal does, because the club received the player.
-- The count restarts each season. Full-format seasons place late sign-ups by positional need ('fill'), not by this
-- rotation; every season is basic by standing order.
--
-- WHY A TABLE: the roster cannot answer "who was placed where". A trade moves the player's roster row to his new club
-- (Themay7: placed on NYI, now on DAL), and a reinstatement writes a new row. random_assignments records the club at
-- the moment of placement and never moves.
--
-- Season 1 backfill: every league-office placement after the post-draft round (that round was one batch at 10:23 PM ET
-- on Sep 19, 50 players) is a late sign-up placement: 43 of them, from the transactions log, which names the club at the
-- moment of placement. 13 do not count (listed below with the reason): the office undid them, or they handed a club back
-- a player it had just lost. Counted: DAL 6, DET 5, NYI 4, PIT 4, SEA 4, UTA 3, BOS 2, VAN 2.

create table if not exists public.random_assignments (
  id                uuid primary key default gen_random_uuid(),
  season_id         uuid not null references public.seasons(id) on delete cascade,
  team_id           uuid not null references public.teams(id) on delete cascade,
  profile_id        uuid references public.profiles(id) on delete set null,
  placed_at         timestamptz not null default now(),
  counts            boolean not null default true,
  note              text,
  voided_by_removal uuid
);
create index if not exists random_assignments_turns on public.random_assignments (season_id, team_id) where counts;
create index if not exists random_assignments_player on public.random_assignments (season_id, profile_id, team_id);
comment on table public.random_assignments is 'v3.89 (Rule 2.8): one row per late sign-up the league office placed as depth, on the club it went to at that moment. counts=false: the office undid it. The late sign-up draw takes the clubs with the fewest counted rows this season.';

-- a new table here is born writable by anon and authenticated (pg_default_acl): revoke by role, then grant the read
alter table public.random_assignments enable row level security;
revoke all on public.random_assignments from public, anon, authenticated;
grant select on public.random_assignments to authenticated;
drop policy if exists random_assignments_read on public.random_assignments;
create policy random_assignments_read on public.random_assignments for select to authenticated using (true);

-- an office correction gives the club its turn back; reinstating that removal takes it again
create or replace function public.random_assignment_undone() returns trigger
language plpgsql security definer set search_path to 'public' as $function$
begin
  if tg_op = 'INSERT' then
    if new.origin = 'depth_random'
       and coalesce(new.reason, '') ~* '(by the league office|^league office: revers|^reversing a placement)' then
      update public.random_assignments ra
         set counts = false, voided_by_removal = new.id,
             note = 'undone by the league office: ' || new.reason
       where ra.id = (select r2.id from public.random_assignments r2
                       where r2.season_id = new.season_id and r2.profile_id = new.profile_id
                         and r2.team_id = new.team_id and r2.counts
                       order by r2.placed_at desc limit 1);
    end if;
  elsif new.reinstated_at is not null and old.reinstated_at is null then
    update public.random_assignments set counts = true, voided_by_removal = null, note = null
     where voided_by_removal = new.id;
  end if;
  return null;
end $function$;
revoke execute on function public.random_assignment_undone() from public, anon, authenticated;
drop trigger if exists random_assignment_undone_trg on public.roster_spot_removals;
create trigger random_assignment_undone_trg after insert or update of reinstated_at on public.roster_spot_removals
  for each row execute function public.random_assignment_undone();

-- the draw, and the record of each placement, inside the one function that creates every automatic spot
do $patch$
declare d text; n int;
  a_old text := $a$      if v_origin = 'depth_random' then
        select t.id into v_team from (select * from public.teams tt where public.cap_has_room(v_reg.season_id, tt.id, 750000)) t
          /* v3.55: only a club whose training camp has room (Rule 2.1, camp limit) */
          where (select count(*) from public.roster_spots rs
                   where rs.season_id = v_reg.season_id and rs.team_id = t.id
                     and rs.status = 'active' and rs.squad = 'tc') < public.camp_max(v_reg.season_id)
          order by ((select count(*) from public.roster_spots rs
                       where rs.season_id = v_reg.season_id and rs.team_id = t.id
                         and rs.status = 'active' and rs.squad = 'tc') = 0) desc,
                   random()
          limit 1;$a$;
  a_new text := $a$      if v_origin = 'depth_random' then
        /* v3.89 (commissioner, 2026-10-07): "Make the mid-season random assignments random but run through each team
           once before a team can get a 2nd RA." A LATE SIGN-UP is drawn from the clubs with the fewest late sign-ups
           this season (random_assignments, counted rows), so every club gets one before any club gets a second; the
           v3.16 empty-camp clause and the random draw still decide WITHIN that set. A club passed over because its camp
           is full or its cap has no room keeps its low count, so it is first in line once it can take one. The
           post-draft placement (p_origin postdraft_random) reads every club at 0 turns: its straight draw is unchanged. */
        select e.id into v_team
          from (select t.id,
                       (select count(*) from public.roster_spots rs
                          where rs.season_id = v_reg.season_id and rs.team_id = t.id
                            and rs.status = 'active' and rs.squad = 'tc') as camp_n,
                       case when p_origin = 'latecomer_random'
                            then (select count(*) from public.random_assignments ra
                                   where ra.season_id = v_reg.season_id and ra.team_id = t.id and ra.counts)
                            else 0 end as turns
                  from public.teams t
                 where public.cap_has_room(v_reg.season_id, t.id, 750000)) e
          /* v3.55: only a club whose training camp has room (Rule 2.1, camp limit) */
          where e.camp_n < public.camp_max(v_reg.season_id)
          order by e.turns asc, (e.camp_n = 0) desc, random()
          limit 1;$a$;
  b_old text := $b$    values (v_reg.season_id, v_team, v_reg.profile_id, coalesce(v_jersey,0), v_slot, 0, v_origin, case when v_camp then 'tc' else null end);
  update public.season_registrations set status = 'assigned' where id = v_reg.id;$b$;
  b_new text := $b$    values (v_reg.season_id, v_team, v_reg.profile_id, coalesce(v_jersey,0), v_slot, 0, v_origin, case when v_camp then 'tc' else null end);
  /* v3.89: a late sign-up's placement takes the club's turn in the rotation (Rule 2.8) */
  if v_origin = 'depth_random' and p_origin = 'latecomer_random' then
    insert into public.random_assignments (season_id, team_id, profile_id) values (v_reg.season_id, v_team, v_reg.profile_id);
  end if;
  update public.season_registrations set status = 'assigned' where id = v_reg.id;$b$;
begin
  d := pg_get_functiondef('public._assign_reg_random(uuid,text,boolean,text)'::regprocedure);
  n := (length(d) - length(replace(d, a_old, ''))) / length(a_old);
  if n <> 1 then raise exception 'v3.89 patch: the depth draw anchor matched % times', n; end if;
  n := (length(d) - length(replace(d, b_old, ''))) / length(b_old);
  if n <> 1 then raise exception 'v3.89 patch: the insert anchor matched % times', n; end if;
  execute replace(replace(d, a_old, a_new), b_old, b_new);
end $patch$;

-- Season 1: the 43 late sign-up placements so far (club at placement, from the transactions log)
insert into public.random_assignments (season_id, team_id, profile_id, placed_at, counts, note)
select s.id, t.id, p.id, v.at::timestamptz, v.counts, v.note
  from (values
    ('PIT','2026-09-21T02:44:00.162821Z','Delagray924',true,null),
    ('UTA','2026-09-21T04:44:00.150446Z','Stutz x77',true,null),
    ('NYI','2026-09-21T13:26:00.156975Z','Themay7',true,null),
    ('BOS','2026-09-23T22:04:00.140564Z','jglehan29',true,'the office swapped him with ItzKloudzy that evening; Boston kept one late sign-up'),
    ('DET','2026-09-23T22:34:00.152403Z','ItzKloudzy',false,'the office moved him to Boston at 7:49 PM; Detroit received jglehan29 in his place'),
    ('DET','2026-09-23T23:52:00.115573Z','jglehan29',true,null),
    ('DAL','2026-09-24T02:52:00.153146Z','atlasx27x.',false,'handed Dallas back a player it had waived a minute earlier (fixed in v3.45)'),
    ('DAL','2026-09-24T02:56:00.102296Z','atlasx27x.',false,'handed Dallas back a player it had waived a minute earlier (fixed in v3.45)'),
    ('DAL','2026-09-24T21:39:16.831426Z','Roadamerica04',true,null),
    ('DAL','2026-09-24T23:26:42.409173Z','Cheese',true,null),
    ('VAN','2026-09-24T23:47:55.840812Z','Šuprèmêrüst¥',true,null),
    ('DAL','2026-09-25T00:48:00.148887Z','Rhegain',false,'the office moved a Dallas player to depth on his own club; not a new player'),
    ('VAN','2026-09-25T01:24:00.203801Z','Lekkerimaki1748',false,'Utah''s Owner, returned to Utah by the league office within the hour'),
    ('UTA','2026-09-25T01:24:00.203801Z','HAGERS',false,'Utah''s own General Manager, placed back on Utah two minutes after leaving the seat'),
    ('UTA','2026-09-25T01:24:00.203801Z','Toine',false,'Utah''s own Assistant GM, placed back on Utah two minutes after leaving the seat'),
    ('PIT','2026-09-25T02:16:48.890925Z','KevinDegener',true,null),
    ('DAL','2026-09-25T03:12:02.733328Z','🇺🇲PORTA DUMP🇺🇲',true,null),
    ('SEA','2026-09-25T03:15:40.648736Z','scarpce',true,null),
    ('DET','2026-09-25T18:24:00.119914Z','fearasaphobia',false,'undone by the league office: reversing a placement caused by a management removal (Rule 2.6)'),
    ('SEA','2026-09-25T23:07:49.855599Z','Jonsyy-',true,null),
    ('NYI','2026-09-25T23:29:08.647070Z','Baary',false,'undone by the league office: removed by the league office'),
    ('PIT','2026-09-25T23:49:07.124609Z','Savvy',false,'undone by the league office: removed by the league office'),
    ('NYI','2026-09-26T02:12:46.994603Z','captain_sticky_bandit',true,null),
    ('SEA','2026-09-26T03:10:33.920787Z','KwikTripJesus',true,null),
    ('DET','2026-09-26T22:10:00.293439Z','jglehan29',false,'handed Detroit back a player it had waived five minutes earlier; reversed by the league office (fixed in v3.45)'),
    ('DAL','2026-09-26T23:05:52.885008Z','CapitalsFan-',true,null),
    ('DAL','2026-09-26T23:12:53.557398Z','Nelly',true,null),
    ('PIT','2026-09-27T17:19:51.942212Z','Yungcj',true,null),
    ('PIT','2026-09-28T01:02:25.651971Z','DosSiete',true,null),
    ('DET','2026-09-28T03:36:04.468242Z','cheech843',true,null),
    ('NYI','2026-09-28T08:40:05.818682Z','LIL__Dark200',true,null),
    ('DET','2026-09-30T03:19:41.329180Z','Šuprèmêrüst¥',true,null),
    ('BOS','2026-10-02T13:11:36.848843Z','i2sweat977760',true,null),
    ('DET','2026-10-02T14:33:22.956329Z','wiliestjester56',true,null),
    ('UTA','2026-10-02T22:02:00.074956Z','Replays',true,null),
    ('NYI','2026-10-03T01:57:10.160111Z','BlakeCx4',false,'undone by the league office: removed by the league office'),
    ('NYI','2026-10-04T03:38:36.533019Z','Jake',true,null),
    ('UTA','2026-10-04T04:48:16.711728Z','SqurlyDanNit',true,null),
    ('VAN','2026-10-04T23:36:41.002968Z','Ꭻα𝐲𝙧𝖎c²',true,null),
    ('DAL','2026-10-05T01:28:15.508377Z','Polish72',true,null),
    ('SEA','2026-10-05T10:56:57.327927Z','RecklessRob96',true,null),
    ('VAN','2026-10-05T16:02:39.047173Z','Jugg Backup Acc',false,'undone by the league office: removed by the league office'),
    ('DET','2026-10-05T23:10:20.362393Z','SparkyMark88',true,null)
  ) as v(code, at, tag, counts, note)
  join public.seasons s on s.number = 1
  join public.teams t on t.code = v.code
  join public.profiles p on p.gamertag = v.tag
 where not exists (select 1 from public.random_assignments ra where ra.season_id = s.id);   -- once

do $check$
declare v_rows int; v_counted int;
begin
  select count(*), count(*) filter (where counts) into v_rows, v_counted
    from public.random_assignments ra join public.seasons s on s.id = ra.season_id and s.number = 1;
  if v_rows <> 43 or v_counted <> 30 then
    raise exception 'v3.89 backfill: expected 43 placements (30 counted), found % (% counted)', v_rows, v_counted;
  end if;
end $check$;
