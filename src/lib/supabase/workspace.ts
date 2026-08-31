/**
 * Workspace（夫妻共用空間）與加密日記的同步層。
 *
 * 這一層只搬「加密字串」：不論寫入或讀取，明文與密碼都不會經過這裡。
 * 資料表與 RLS 定義在 supabase/schema.sql。
 */

import { getSupabaseClient } from "@/lib/supabase/client";
import { SyncError, toSyncError } from "@/lib/supabase/errors";
import {
  INVITE_CODE_LENGTH,
  isInviteActive,
  normalizeInviteCode,
  normalizeLabel,
} from "@/lib/supabase/invite";

export type WorkspaceMember = {
  userId: string;
  label: string;
  joinedAt: string;
  isMe: boolean;
};

export type WorkspaceInfo = {
  id: string;
  /** 邀請碼；只有成員讀得到（RLS） */
  inviteCode: string;
  inviteExpiresAt: string | null;
  /** 邀請碼是否還能用（湊滿兩人後會自動失效） */
  inviteActive: boolean;
  /** 共用密碼的驗證用 envelope，可能還沒設 */
  passphraseCheck: string | null;
  members: WorkspaceMember[];
  myUserId: string;
  myLabel: string;
};

/** 從資料庫讀回來的一則加密日記。 */
export type RemoteEntry = {
  id: string;
  entryDate: string;
  authorLabel: string;
  authorId: string;
  ciphertext: string;
  updatedAt: string;
  isMine: boolean;
};

function assertLabel(label: string): string {
  const normalized = normalizeLabel(label);
  if (normalized === "") {
    throw new SyncError("LABEL_REQUIRED", "請先填一個顯示用的名字（使用者標籤）。");
  }
  return normalized;
}

// ---------------------------------------------------------------------------
// 登入：用 Supabase 的匿名登入，不用註冊也能有穩定的 user id
// ---------------------------------------------------------------------------

/** 確保有一個 session，回傳 user id。 */
export async function ensureSession(): Promise<string> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase.auth.getSession();
  if (error) throw toSyncError(error);
  if (data.session?.user.id) return data.session.user.id;

  const signIn = await supabase.auth.signInAnonymously();
  if (signIn.error) {
    throw new SyncError(
      "AUTH_FAILED",
      "匿名登入失敗，請確認 Supabase 專案已開啟 Anonymous sign-ins。",
    );
  }
  if (!signIn.data.user) {
    throw new SyncError("AUTH_FAILED", "匿名登入沒有回傳使用者，請再試一次。");
  }

  return signIn.data.user.id;
}

type WorkspaceRow = {
  id: string;
  invite_code: string;
  invite_expires_at: string | null;
  passphrase_check: string | null;
};

type MemberRow = {
  workspace_id: string;
  user_id: string;
  label: string;
  joined_at: string;
};

/**
 * 讀出目前使用者所屬的 workspace（RLS 會保證只看得到自己的）。
 * 沒有加入任何 workspace 時回傳 null。
 */
export async function loadWorkspace(): Promise<WorkspaceInfo | null> {
  const supabase = getSupabaseClient();
  const myUserId = await ensureSession();

  const { data: workspaces, error } = await supabase
    .from("workspaces")
    .select("id, invite_code, invite_expires_at, passphrase_check")
    .order("created_at", { ascending: true })
    .limit(1)
    .returns<WorkspaceRow[]>();
  if (error) throw toSyncError(error);

  const workspace = workspaces?.[0];
  if (!workspace) return null;

  const { data: memberRows, error: membersError } = await supabase
    .from("workspace_members")
    .select("workspace_id, user_id, label, joined_at")
    .eq("workspace_id", workspace.id)
    .order("joined_at", { ascending: true })
    .returns<MemberRow[]>();
  if (membersError) throw toSyncError(membersError);

  const members: WorkspaceMember[] = (memberRows ?? []).map((row) => ({
    userId: row.user_id,
    label: row.label,
    joinedAt: row.joined_at,
    isMe: row.user_id === myUserId,
  }));

  return {
    id: workspace.id,
    inviteCode: workspace.invite_code,
    inviteExpiresAt: workspace.invite_expires_at,
    inviteActive: isInviteActive(workspace.invite_expires_at),
    passphraseCheck: workspace.passphrase_check,
    members,
    myUserId,
    myLabel: members.find((member) => member.isMe)?.label ?? "",
  };
}

/**
 * User A：建立 workspace 並取得邀請碼。
 * passphraseProbe 是用共用密碼加密的驗證字串，可以先不給。
 */
export async function createWorkspace(
  label: string,
  passphraseProbe: string | null,
): Promise<WorkspaceInfo> {
  const supabase = getSupabaseClient();
  await ensureSession();

  const { error } = await supabase.rpc("create_workspace", {
    p_label: assertLabel(label),
    p_passphrase_check: passphraseProbe,
  });
  if (error) throw toSyncError(error);

  const workspace = await loadWorkspace();
  if (!workspace) {
    throw new SyncError("UNKNOWN", "Workspace 建立後卻讀不到，請重新整理。");
  }
  return workspace;
}

/** User B：用邀請碼加入 User A 的 workspace。 */
export async function joinWorkspace(
  inviteCode: string,
  label: string,
): Promise<WorkspaceInfo> {
  const supabase = getSupabaseClient();
  await ensureSession();

  const normalizedCode = normalizeInviteCode(inviteCode);
  if (normalizedCode.length !== INVITE_CODE_LENGTH) {
    throw new SyncError("INVALID_CODE", "邀請碼是 10 個字（例如 9F3A-1C7B-2D）。");
  }

  const { error } = await supabase.rpc("join_workspace", {
    p_invite_code: normalizedCode,
    p_label: assertLabel(label),
  });
  if (error) throw toSyncError(error);

  const workspace = await loadWorkspace();
  if (!workspace) {
    throw new SyncError("UNKNOWN", "加入後卻讀不到 Workspace，請重新整理。");
  }
  return workspace;
}

/** 重新產生邀請碼（原本那組立刻失效）。 */
export async function rotateInviteCode(workspaceId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.rpc("rotate_invite_code", {
    p_workspace_id: workspaceId,
  });
  if (error) throw toSyncError(error);
}

/** 把共用密碼的驗證字串寫上 workspace。 */
export async function savePassphraseProbe(
  workspaceId: string,
  probe: string,
): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.rpc("set_passphrase_check", {
    p_workspace_id: workspaceId,
    p_passphrase_check: probe,
  });
  if (error) throw toSyncError(error);
}

/** 離開 workspace（自己那列成員資料刪掉，寫過的日記留在 workspace 裡）。 */
export async function leaveWorkspace(workspaceId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const myUserId = await ensureSession();

  const { error } = await supabase
    .from("workspace_members")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("user_id", myUserId);
  if (error) throw toSyncError(error);
}

// ---------------------------------------------------------------------------
// 加密日記的讀寫
// ---------------------------------------------------------------------------

type EntryRow = {
  id: string;
  entry_date: string;
  author_id: string;
  author_label: string;
  ciphertext: string;
  updated_at: string;
};

const ENTRY_COLUMNS = "id, entry_date, author_id, author_label, ciphertext, updated_at";

function toRemoteEntry(row: EntryRow, myUserId: string): RemoteEntry {
  return {
    id: row.id,
    entryDate: row.entry_date,
    authorId: row.author_id,
    authorLabel: row.author_label,
    ciphertext: row.ciphertext,
    updatedAt: row.updated_at,
    isMine: row.author_id === myUserId,
  };
}

/**
 * 寫入（或覆蓋）自己在某一天的日記。
 *
 * ciphertext 必須已經是加密字串——資料庫的 CHECK 約束也只收 envelope，
 * 所以不可能不小心把明文送上去。author_id / author_label 由資料庫的
 * trigger 蓋掉，這裡帶上去只是為了讓 upsert 的衝突鍵完整。
 */
export async function pushEntry(params: {
  workspaceId: string;
  entryDate: string;
  ciphertext: string;
}): Promise<RemoteEntry> {
  const supabase = getSupabaseClient();
  const myUserId = await ensureSession();

  const { data, error } = await supabase
    .from("journal_entries")
    .upsert(
      {
        workspace_id: params.workspaceId,
        entry_date: params.entryDate,
        author_id: myUserId,
        ciphertext: params.ciphertext,
      },
      { onConflict: "workspace_id,entry_date,author_id" },
    )
    .select(ENTRY_COLUMNS)
    .single<EntryRow>();
  if (error) throw toSyncError(error);

  return toRemoteEntry(data, myUserId);
}

/** 讀出某一天 workspace 裡所有人的加密日記（自己的 + 另一半的）。 */
export async function pullEntries(
  workspaceId: string,
  entryDate: string,
): Promise<RemoteEntry[]> {
  const supabase = getSupabaseClient();
  const myUserId = await ensureSession();

  const { data, error } = await supabase
    .from("journal_entries")
    .select(ENTRY_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("entry_date", entryDate)
    .order("updated_at", { ascending: true })
    .returns<EntryRow[]>();
  if (error) throw toSyncError(error);

  return (data ?? []).map((row) => toRemoteEntry(row, myUserId));
}

/**
 * 月曆用：某段日期區間內「哪幾天有誰寫過」。
 * 刻意不撈 ciphertext——標記日期不需要內容，等點進某一天再抓。
 */
export async function pullEntryDates(
  workspaceId: string,
  fromDate: string,
  toDate: string,
): Promise<{ entryDate: string; authorLabel: string; isMine: boolean }[]> {
  const supabase = getSupabaseClient();
  const myUserId = await ensureSession();

  const { data, error } = await supabase
    .from("journal_entries")
    .select("entry_date, author_id, author_label")
    .eq("workspace_id", workspaceId)
    .gte("entry_date", fromDate)
    .lte("entry_date", toDate)
    .order("entry_date", { ascending: true })
    .returns<Pick<EntryRow, "entry_date" | "author_id" | "author_label">[]>();
  if (error) throw toSyncError(error);

  return (data ?? []).map((row) => ({
    entryDate: row.entry_date,
    authorLabel: row.author_label,
    isMine: row.author_id === myUserId,
  }));
}

/** 匯出用：整個 workspace 的所有加密日記。 */
export async function pullAllEntries(
  workspaceId: string,
): Promise<RemoteEntry[]> {
  const supabase = getSupabaseClient();
  const myUserId = await ensureSession();

  const { data, error } = await supabase
    .from("journal_entries")
    .select(ENTRY_COLUMNS)
    .eq("workspace_id", workspaceId)
    .order("entry_date", { ascending: false })
    .returns<EntryRow[]>();
  if (error) throw toSyncError(error);

  return (data ?? []).map((row) => toRemoteEntry(row, myUserId));
}

/** 刪掉自己在某一天的日記。 */
export async function deleteEntry(
  workspaceId: string,
  entryDate: string,
): Promise<void> {
  const supabase = getSupabaseClient();
  const myUserId = await ensureSession();

  const { error } = await supabase
    .from("journal_entries")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("entry_date", entryDate)
    .eq("author_id", myUserId);
  if (error) throw toSyncError(error);
}
