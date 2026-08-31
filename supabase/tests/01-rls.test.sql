-- ============================================================================
-- schema.sql 的行為測試：RLS、邀請機制、trigger、CHECK 約束
--
-- 在一個「用不到的」本機 Postgres 上跑（不要對正式 Supabase 專案執行，
-- 裡面有 truncate）：
--
--   psql -f supabase/tests/00-emulate-supabase.sql   # 補上 Supabase 的 auth schema 與角色
--   psql -f supabase/schema.sql
--   psql -f supabase/tests/01-rls.test.sql           # 每個檢查會印一行 ok
--
-- 任何一項不符就會 raise exception，psql 以非零離開。
-- ============================================================================

\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned

-- 乾淨起點
set role postgres;
truncate table public.journal_entries, public.workspace_members, public.workspaces cascade;
delete from auth.users;
insert into auth.users (id) values
  ('11111111-1111-1111-1111-111111111111'),  -- A（老公）
  ('22222222-2222-2222-2222-222222222222'),  -- B（老婆）
  ('33333333-3333-3333-3333-333333333333'),  -- C（陌生人）
  ('44444444-4444-4444-4444-444444444444');  -- D（第三人）

create or replace function pg_temp.login(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_uid, false);
end $$;

create or replace function pg_temp.expect(p_ok boolean, p_name text) returns void language plpgsql as $$
begin
  if p_ok then raise notice '  ok   %', p_name;
  else raise exception 'FAIL: %', p_name; end if;
end $$;

-- 用 A 的身分建立 workspace
select pg_temp.login('11111111-1111-1111-1111-111111111111');
set role authenticated;

create temp table envs (name text primary key, v text);
insert into envs values
  ('a', 'GJ1.600000.ssVUHXcThN7Qhb7yBzY1wA==.6w9/fN8QJTkCXvoa.Qaf5vuYWvhT8+gjcTVXq3yXDLNkowybu6utQIq+q19557R+hyNEx4sPONmj0jayBBNIuylx51TMfxgARK87y2EjNJfypKXa7vug1KaoLZmF2JNapSYwpLtT8o4PHgN3HZmCUKGHSJ+Zi/0nhoQ=='),
  ('b', 'GJ1.600000.HORfPGJVYbRAT7GHu7KoSw==.fHJ3DWr4SJLdfFK0.wmeW8z3cZT3Gix5RXljrI7Lxdq+YQRmtr9zo57fhP03k9T5FbFYeYC/3xTojDbuuy6ARnsgk6DA1su0Yci7l74Bv06lhe0iFA3W2tTaKcnLb664mw4VBQwy8oUeW1QrCA4RsFmHdLCZ8rV3ukQ==');
create temp table ws as select * from public.create_workspace('小明', (select v from envs where name = 'a'));
select pg_temp.expect((select count(*) = 1 from ws), 'A 建立 workspace 成功');
select pg_temp.expect((select invite_code ~ '^[0-9A-F]{10}$' from ws), '邀請碼是 10 碼 hex');
select pg_temp.expect((select count(*) = 1 from public.workspaces), 'A 看得到自己的 workspace');
select pg_temp.expect((select count(*) = 1 from public.workspace_members), 'A 是成員');

-- 陌生人 C 看不到
select pg_temp.login('33333333-3333-3333-3333-333333333333');
select pg_temp.expect((select count(*) = 0 from public.workspaces), 'C 看不到別人的 workspace（RLS）');
select pg_temp.expect((select count(*) = 0 from public.workspace_members), 'C 看不到別人的成員名單');

-- 錯的邀請碼
do $$ begin
  perform public.join_workspace('0000000000', 'C');
  raise exception 'FAIL: 錯邀請碼竟然成功';
exception when sqlstate '22023' then raise notice '  ok   錯的邀請碼被拒絕';
end $$;
do $$ begin
  perform public.join_workspace('not-a-code', 'C');
  raise exception 'FAIL: 亂碼竟然成功';
exception when sqlstate '22023' then raise notice '  ok   格式不對的邀請碼被拒絕';
end $$;

-- B 用（小寫 + 分隔線）的邀請碼加入
select pg_temp.login('22222222-2222-2222-2222-222222222222');
select pg_temp.expect(
  (select member_count = 2 from public.join_workspace(
     lower(substr((select invite_code from ws),1,4) || '-' || substr((select invite_code from ws),5,4) || '-' || substr((select invite_code from ws),9,2)),
     '小美')),
  'B 用小寫帶分隔線的邀請碼加入，人數 2');
select pg_temp.expect((select count(*) = 1 from public.workspaces), 'B 現在看得到同一個 workspace');
select pg_temp.expect((select count(*) = 2 from public.workspace_members), 'B 看得到兩位成員');

-- 湊滿兩人後邀請碼失效，第三人 D 進不來
select pg_temp.login('44444444-4444-4444-4444-444444444444');
do $$ begin
  perform public.join_workspace((select invite_code from ws), 'D');
  raise exception 'FAIL: 滿了還讓 D 加入';
exception when sqlstate '22023' then raise notice '  ok   湊滿兩人後邀請碼自動失效';
end $$;

-- A 寫入加密日記
select pg_temp.login('11111111-1111-1111-1111-111111111111');
insert into public.journal_entries (workspace_id, entry_date, ciphertext, author_id, author_label)
values ((select workspace_id from ws), '2026-08-31', (select v from envs where name = 'a'), '00000000-0000-0000-0000-000000000000', '冒名');
select pg_temp.expect(
  (select author_id = '11111111-1111-1111-1111-111111111111' and author_label = '小明'
   from public.journal_entries), 'trigger 覆寫 author_id / 使用者標籤，冒名無效');

-- 明文寫不進去
do $$ begin
  insert into public.journal_entries (workspace_id, entry_date, ciphertext)
  values ((select workspace_id from ws), '2026-08-30', '今天很開心，孩子笑得很甜');
  raise exception 'FAIL: 明文竟然寫進去了';
exception when check_violation then raise notice '  ok   明文被 CHECK 擋下（伺服器只收 envelope）';
end $$;

-- B 讀得到 A 的、也能寫自己的
select pg_temp.login('22222222-2222-2222-2222-222222222222');
select pg_temp.expect((select count(*) = 1 from public.journal_entries), 'B 讀得到 A 的加密日記（共享成立）');
insert into public.journal_entries (workspace_id, entry_date, ciphertext)
values ((select workspace_id from ws), '2026-08-31', (select v from envs where name = 'b'));
select pg_temp.expect((select count(*) = 2 from public.journal_entries where entry_date = '2026-08-31'),
  '同一天兩人各一列');

-- B 不能改 A 的
with updated as (
  update public.journal_entries set ciphertext = (select v from envs where name = 'b')
  where author_id = '11111111-1111-1111-1111-111111111111' returning 1)
select pg_temp.expect((select count(*) = 0 from updated), 'B 改不動 A 的日記');
with deleted as (
  delete from public.journal_entries
  where author_id = '11111111-1111-1111-1111-111111111111' returning 1)
select pg_temp.expect((select count(*) = 0 from deleted), 'B 刪不掉 A 的日記');

-- B 可以更新自己的（upsert 路徑）
insert into public.journal_entries (workspace_id, entry_date, ciphertext)
values ((select workspace_id from ws), '2026-08-31', (select v from envs where name = 'a'))
on conflict (workspace_id, entry_date, author_id) do update set ciphertext = excluded.ciphertext;
select pg_temp.expect((select count(*) = 2 from public.journal_entries where entry_date = '2026-08-31'),
  'upsert 不會多開一列');

-- 陌生人 C 什麼都讀不到、寫不進去
select pg_temp.login('33333333-3333-3333-3333-333333333333');
select pg_temp.expect((select count(*) = 0 from public.journal_entries), 'C 讀不到任何加密日記');
do $$ begin
  insert into public.journal_entries (workspace_id, entry_date, ciphertext)
  values ((select workspace_id from ws), '2026-08-31', (select v from envs where name = 'a'));
  raise exception 'FAIL: C 竟然寫得進去';
exception when others then raise notice '  ok   C 寫不進別人的 workspace（%）', sqlstate;
end $$;
do $$ begin
  perform public.rotate_invite_code((select workspace_id from ws));
  raise exception 'FAIL: C 竟然能換邀請碼';
exception when sqlstate '42501' then raise notice '  ok   非成員不能重新產生邀請碼';
end $$;
do $$ begin
  perform public.set_passphrase_check((select workspace_id from ws), (select v from envs where name = 'a'));
  raise exception 'FAIL: C 竟然能改密碼驗證字串';
exception when sqlstate '42501' then raise notice '  ok   非成員不能改 passphrase_check';
end $$;

-- 成員可以換碼、設定 probe
select pg_temp.login('11111111-1111-1111-1111-111111111111');
create temp table rotated as select * from public.rotate_invite_code((select workspace_id from ws));
select pg_temp.expect((select invite_code <> (select invite_code from ws) from rotated), '成員可以重新產生邀請碼');
select public.set_passphrase_check((select workspace_id from ws), (select v from envs where name = 'a'));
select pg_temp.expect((select passphrase_check = (select v from envs where name = 'a') from public.workspaces), '成員可以寫入 passphrase_check');

-- 離開 workspace
select pg_temp.login('22222222-2222-2222-2222-222222222222');
delete from public.workspace_members where user_id = auth.uid();
select pg_temp.expect((select count(*) = 0 from public.journal_entries), 'B 離開後就讀不到資料了');
select pg_temp.expect((select count(*) = 0 from public.workspaces), 'B 離開後看不到 workspace');
select pg_temp.login('11111111-1111-1111-1111-111111111111');
select pg_temp.expect((select count(*) = 2 from public.journal_entries), 'A 的資料仍在（含 B 之前寫的那列）');

\echo '--- 全部通過'
