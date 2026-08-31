-- ============================================================================
-- 感恩日記 · Supabase schema
--
-- 設計前提：伺服器端「無從得知明文」。
--   * journal_entries 只存 workspace_id、日期、使用者標籤、加密字串。
--   * ciphertext 有 CHECK 限制只能是 lib/crypto.ts 產生的 envelope
--     （GJ1.<iterations>.<salt>.<iv>.<ciphertext+tag>），所以就算客戶端寫錯，
--     也不可能把明文塞進資料庫。
--   * 解密金鑰由使用者的共用密碼在瀏覽器用 PBKDF2 推導，從不離開裝置，
--     資料庫裡沒有任何一欄放得下它。
--
-- 在 Supabase SQL Editor 直接執行整份檔案即可（可重複執行）。
-- 需要在 Authentication → Providers 開啟 Anonymous sign-ins。
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;

-- ----------------------------------------------------------------------------
-- 1. workspaces：一對夫妻共用的空間
-- ----------------------------------------------------------------------------
create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users (id) on delete cascade,

  -- 邀請碼：10 個 hex 字元（40 bits 亂數），顯示時會分組成 XXXX-XXXX-XX
  invite_code text not null unique,
  -- 邀請碼到期時間；湊滿兩人之後會自動設成 now() 讓它失效
  invite_expires_at timestamptz,

  -- 用共用密碼加密的固定字串，讓另一台裝置可以驗證「密碼有沒有打對」。
  -- 對伺服器來說一樣只是一段 envelope。
  passphrase_check text,

  constraint workspaces_invite_code_format check (invite_code ~ '^[0-9A-F]{10}$'),
  constraint workspaces_passphrase_check_format check (
    passphrase_check is null
    or passphrase_check ~ '^GJ1\.[0-9]{4,7}\.[A-Za-z0-9+/]+={0,2}\.[A-Za-z0-9+/]+={0,2}\.[A-Za-z0-9+/]+={0,2}$'
  )
);

comment on table public.workspaces is
  '夫妻共用的 workspace。不存任何明文日記內容。';
comment on column public.workspaces.passphrase_check is
  '共用密碼的驗證用 envelope（加密後的固定字串），伺服器無法解密。';

-- ----------------------------------------------------------------------------
-- 2. workspace_members：誰在這個 workspace 裡（上限兩人）
-- ----------------------------------------------------------------------------
create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- 使用者標籤：顯示用的暱稱，例如「小美」。請不要放個資。
  label text not null,
  joined_at timestamptz not null default now(),

  primary key (workspace_id, user_id),
  constraint workspace_members_label_length check (
    char_length(btrim(label)) between 1 and 20
  )
);

comment on column public.workspace_members.label is
  '顯示用的暱稱（使用者標籤），非個資、非帳號。';

-- ----------------------------------------------------------------------------
-- 3. journal_entries：加密後的日記
--    一個 workspace、一個日期、一位作者 → 一列。
-- ----------------------------------------------------------------------------
create table if not exists public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  entry_date date not null,
  -- 寫這則日記的人（RLS 用；不是日記內容）
  author_id uuid not null references auth.users (id) on delete cascade,
  -- 使用者標籤，由 trigger 從 workspace_members 帶入，客戶端不需要（也無法）自己指定
  author_label text not null,
  -- 唯一的內容欄位：AES-256-GCM envelope
  ciphertext text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (workspace_id, entry_date, author_id),

  -- 只接受 lib/crypto.ts 的 envelope 格式：明文永遠進不來
  constraint journal_entries_ciphertext_is_envelope check (
    ciphertext ~ '^GJ1\.[0-9]{4,7}\.[A-Za-z0-9+/]+={0,2}\.[A-Za-z0-9+/]+={0,2}\.[A-Za-z0-9+/]+={0,2}$'
  ),
  constraint journal_entries_ciphertext_size check (
    char_length(ciphertext) between 100 and 20000
  )
);

comment on table public.journal_entries is
  '加密後的日記。只有 workspace_id / entry_date / author_label / ciphertext 是資料本體，伺服器無法解密。';

create index if not exists journal_entries_workspace_date_idx
  on public.journal_entries (workspace_id, entry_date desc);

-- ----------------------------------------------------------------------------
-- 4. 共用函式
-- ----------------------------------------------------------------------------

-- 判斷目前登入者是不是某 workspace 的成員。
-- 用 security definer 是為了避免在 workspace_members 自己的 policy 裡遞迴查自己。
create or replace function public.is_workspace_member(p_workspace_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members m
    where m.workspace_id = p_workspace_id
      and m.user_id = auth.uid()
  );
$$;

-- 產生一組邀請碼：5 bytes 的密碼學亂數 → 10 個大寫 hex 字元
create or replace function public.new_invite_code()
returns text
language sql
volatile
set search_path = public, extensions
as $$
  select upper(encode(extensions.gen_random_bytes(5), 'hex'));
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists journal_entries_set_updated_at on public.journal_entries;
create trigger journal_entries_set_updated_at
  before update on public.journal_entries
  for each row execute function public.set_updated_at();

-- author_id 與 author_label 一律由伺服器決定，避免有人冒名寫入。
create or replace function public.stamp_entry_author()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_label text;
begin
  new.author_id := auth.uid();

  select m.label into v_label
  from public.workspace_members m
  where m.workspace_id = new.workspace_id
    and m.user_id = auth.uid();

  if v_label is null then
    raise exception 'not a member of this workspace' using errcode = '42501';
  end if;

  new.author_label := v_label;
  return new;
end;
$$;

drop trigger if exists journal_entries_stamp_author on public.journal_entries;
create trigger journal_entries_stamp_author
  before insert or update on public.journal_entries
  for each row execute function public.stamp_entry_author();

-- ----------------------------------------------------------------------------
-- 5. RLS
-- ----------------------------------------------------------------------------
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.journal_entries enable row level security;

-- workspaces：只有成員看得到（所以邀請碼不會外洩給非成員）。
-- 建立與修改都走下面的 RPC，這裡不開 insert / update / delete。
drop policy if exists "members can read their workspace" on public.workspaces;
create policy "members can read their workspace"
  on public.workspaces for select
  to authenticated
  using (public.is_workspace_member(id));

-- workspace_members：看得到同一個 workspace 的夥伴；只能刪自己那列（＝離開）。
-- 加入一律走 join_workspace()。
drop policy if exists "members can read the roster" on public.workspace_members;
create policy "members can read the roster"
  on public.workspace_members for select
  to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists "members can leave" on public.workspace_members;
create policy "members can leave"
  on public.workspace_members for delete
  to authenticated
  using (user_id = auth.uid());

-- journal_entries：同 workspace 的兩人都讀得到（這就是共享），但只能改自己寫的。
drop policy if exists "members can read workspace entries" on public.journal_entries;
create policy "members can read workspace entries"
  on public.journal_entries for select
  to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists "members can write their own entries" on public.journal_entries;
create policy "members can write their own entries"
  on public.journal_entries for insert
  to authenticated
  with check (public.is_workspace_member(workspace_id) and author_id = auth.uid());

drop policy if exists "members can update their own entries" on public.journal_entries;
create policy "members can update their own entries"
  on public.journal_entries for update
  to authenticated
  using (public.is_workspace_member(workspace_id) and author_id = auth.uid())
  with check (public.is_workspace_member(workspace_id) and author_id = auth.uid());

drop policy if exists "members can delete their own entries" on public.journal_entries;
create policy "members can delete their own entries"
  on public.journal_entries for delete
  to authenticated
  using (public.is_workspace_member(workspace_id) and author_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 6. 建立 / 加入 workspace 的 RPC
-- ----------------------------------------------------------------------------

-- User A：建立 workspace，同時把自己加進去，回傳邀請碼。
create or replace function public.create_workspace(
  p_label text,
  p_passphrase_check text default null,
  p_invite_ttl interval default interval '7 days'
)
returns table (workspace_id uuid, invite_code text, invite_expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_code text;
  v_expires timestamptz;
  v_label text := nullif(btrim(coalesce(p_label, '')), '');
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if v_label is null then
    raise exception 'label is required' using errcode = '22023';
  end if;

  v_expires := now() + p_invite_ttl;

  -- 撞碼機率極低，但還是重試幾次
  for _ in 1..5 loop
    v_code := public.new_invite_code();
    begin
      insert into public.workspaces (created_by, invite_code, invite_expires_at, passphrase_check)
      values (auth.uid(), v_code, v_expires, p_passphrase_check)
      returning id into v_id;
      exit;
    exception when unique_violation then
      v_id := null;
    end;
  end loop;

  if v_id is null then
    raise exception 'could not allocate an invite code' using errcode = '40001';
  end if;

  insert into public.workspace_members (workspace_id, user_id, label)
  values (v_id, auth.uid(), v_label);

  return query select v_id, v_code, v_expires;
end;
$$;

-- User B：輸入邀請碼加入同一個 workspace。
-- 因為非成員讀不到 workspaces，這一步一定要走 security definer 的函式。
create or replace function public.join_workspace(
  p_invite_code text,
  p_label text
)
returns table (workspace_id uuid, member_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_code text := upper(regexp_replace(coalesce(p_invite_code, ''), '[^0-9A-Fa-f]', '', 'g'));
  v_label text := nullif(btrim(coalesce(p_label, '')), '');
  v_count integer;
  v_already boolean;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if v_label is null then
    raise exception 'label is required' using errcode = '22023';
  end if;
  if v_code !~ '^[0-9A-F]{10}$' then
    raise exception 'invalid invite code' using errcode = '22023';
  end if;

  select w.id into v_id
  from public.workspaces w
  where w.invite_code = v_code
    and (w.invite_expires_at is null or w.invite_expires_at > now());

  if v_id is null then
    -- 故意不區分「不存在」與「已過期」，避免當成猜碼的提示
    raise exception 'invalid invite code' using errcode = '22023';
  end if;

  select
    count(*)::integer,
    bool_or(m.user_id = auth.uid())
  into v_count, v_already
  from public.workspace_members m
  where m.workspace_id = v_id;

  -- 夫妻配對：兩人為上限
  if v_count >= 2 and not coalesce(v_already, false) then
    raise exception 'workspace is full' using errcode = '23505';
  end if;

  -- 注意：這個函式的 OUT 參數叫 workspace_id，所以 on conflict 不能寫成
  -- (workspace_id, user_id)——PL/pgSQL 會分不出是變數還是欄位。指定約束名最乾淨。
  insert into public.workspace_members (workspace_id, user_id, label)
  values (v_id, auth.uid(), v_label)
  on conflict on constraint workspace_members_pkey
  do update set label = excluded.label;

  select count(*)::integer into v_count
  from public.workspace_members m
  where m.workspace_id = v_id;

  -- 湊滿兩人就讓邀請碼失效，減少被猜中的機會
  if v_count >= 2 then
    update public.workspaces
    set invite_expires_at = now()
    where id = v_id;
  end if;

  return query select v_id, v_count;
end;
$$;

-- 重新產生邀請碼（例如碼流出去了，或想再邀一次）。
create or replace function public.rotate_invite_code(
  p_workspace_id uuid,
  p_invite_ttl interval default interval '7 days'
)
returns table (invite_code text, invite_expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_expires timestamptz := now() + p_invite_ttl;
begin
  if not public.is_workspace_member(p_workspace_id) then
    raise exception 'not a member of this workspace' using errcode = '42501';
  end if;

  for _ in 1..5 loop
    v_code := public.new_invite_code();
    begin
      update public.workspaces
      set invite_code = v_code, invite_expires_at = v_expires
      where id = p_workspace_id;
      exit;
    exception when unique_violation then
      v_code := null;
    end;
  end loop;

  if v_code is null then
    raise exception 'could not allocate an invite code' using errcode = '40001';
  end if;

  return query select v_code, v_expires;
end;
$$;

-- 設定／更新共用密碼的驗證字串。走 RPC 是為了不開放整列 update
-- （否則成員也能改別人的邀請碼）。
create or replace function public.set_passphrase_check(
  p_workspace_id uuid,
  p_passphrase_check text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_workspace_member(p_workspace_id) then
    raise exception 'not a member of this workspace' using errcode = '42501';
  end if;

  update public.workspaces
  set passphrase_check = p_passphrase_check
  where id = p_workspace_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 7. 權限：未登入的 anon 什麼都碰不到
-- ----------------------------------------------------------------------------
revoke all on public.workspaces from anon;
revoke all on public.workspace_members from anon;
revoke all on public.journal_entries from anon;

grant select on public.workspaces to authenticated;
grant select, delete on public.workspace_members to authenticated;
grant select, insert, update, delete on public.journal_entries to authenticated;

revoke all on function public.create_workspace(text, text, interval) from anon, public;
revoke all on function public.join_workspace(text, text) from anon, public;
revoke all on function public.rotate_invite_code(uuid, interval) from anon, public;
revoke all on function public.set_passphrase_check(uuid, text) from anon, public;
revoke all on function public.is_workspace_member(uuid) from anon, public;
revoke all on function public.new_invite_code() from anon, public;

grant execute on function public.create_workspace(text, text, interval) to authenticated;
grant execute on function public.join_workspace(text, text) to authenticated;
grant execute on function public.rotate_invite_code(uuid, interval) to authenticated;
grant execute on function public.set_passphrase_check(uuid, text) to authenticated;
grant execute on function public.is_workspace_member(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 8. 選用：開啟 Realtime，讓另一半寫入時自己這邊會即時更新
--    （Supabase 專案才有 supabase_realtime 這個 publication）
-- ----------------------------------------------------------------------------
-- alter publication supabase_realtime add table public.journal_entries;
