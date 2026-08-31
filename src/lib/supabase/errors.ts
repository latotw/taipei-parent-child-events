/** 同步層的錯誤代碼。message 直接是可以顯示給使用者的中文。 */
export type SyncErrorCode =
  /** 沒設定 NEXT_PUBLIC_SUPABASE_URL / ANON_KEY，只能離線使用 */
  | "NOT_CONFIGURED"
  /** 匿名登入失敗（通常是專案沒開 Anonymous sign-ins） */
  | "AUTH_FAILED"
  /** 邀請碼錯誤、格式不對或已失效 */
  | "INVALID_CODE"
  /** Workspace 已經有兩個人了 */
  | "WORKSPACE_FULL"
  /** 不是這個 workspace 的成員 */
  | "FORBIDDEN"
  /** 標籤沒填 */
  | "LABEL_REQUIRED"
  /** 資料庫拒收（例如不是 envelope 格式的字串） */
  | "REJECTED"
  /** 連不上 Supabase */
  | "NETWORK"
  | "UNKNOWN";

export class SyncError extends Error {
  readonly code: SyncErrorCode;

  constructor(code: SyncErrorCode, message: string) {
    super(message);
    this.name = "SyncError";
    this.code = code;
  }
}

const POSTGRES_CODE_MAP: Record<string, [SyncErrorCode, string]> = {
  // join_workspace / create_workspace 用 raise exception ... using errcode 丟出來的
  "22023": ["INVALID_CODE", "邀請碼不正確或已失效，請再確認一次。"],
  "23505": ["WORKSPACE_FULL", "這個 Workspace 已經有兩個人了。"],
  "42501": ["FORBIDDEN", "你不是這個 Workspace 的成員。"],
  "28000": ["AUTH_FAILED", "尚未登入，請重新整理後再試。"],
  // CHECK 約束：資料庫只收 envelope 格式
  "23514": ["REJECTED", "資料庫拒收這筆內容（必須是加密後的字串）。"],
  "40001": ["UNKNOWN", "伺服器忙碌中，請再試一次。"],
};

/** 把 supabase-js / PostgREST 的錯誤轉成 SyncError。 */
export function toSyncError(error: unknown): SyncError {
  if (error instanceof SyncError) return error;

  if (typeof error === "object" && error !== null) {
    const candidate = error as { code?: unknown; message?: unknown };
    const code = typeof candidate.code === "string" ? candidate.code : "";
    const mapped = POSTGRES_CODE_MAP[code];
    if (mapped) return new SyncError(mapped[0], mapped[1]);

    // fetch 失敗時 supabase-js 會包成 message 帶 "Failed to fetch"
    const message = typeof candidate.message === "string" ? candidate.message : "";
    if (/fetch|network|timeout/i.test(message)) {
      return new SyncError("NETWORK", "連不上 Supabase，請檢查網路後再試。");
    }
  }

  return new SyncError("UNKNOWN", "同步時發生未預期的錯誤，請再試一次。");
}

export function describeSyncError(error: unknown): string {
  return toSyncError(error).message;
}
