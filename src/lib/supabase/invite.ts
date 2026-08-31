/**
 * 邀請碼與標籤的純函式。刻意不 import 任何東西，
 * 方便單獨測試，也讓 UI 不必為了格式化字串而載入 Supabase client。
 */

export const INVITE_CODE_LENGTH = 10;
export const MAX_LABEL_LENGTH = 20;

/** 把使用者輸入的邀請碼整理成資料庫裡的樣子：去掉分隔符號、轉大寫。 */
export function normalizeInviteCode(raw: string): string {
  return raw.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
}

/** 顯示用：9F3A1C7B2D → 9F3A-1C7B-2D */
export function formatInviteCode(code: string): string {
  const groups = normalizeInviteCode(code).match(/.{1,4}/g);
  return groups ? groups.join("-") : "";
}

export function isValidInviteCode(raw: string): boolean {
  return normalizeInviteCode(raw).length === INVITE_CODE_LENGTH;
}

export function normalizeLabel(raw: string): string {
  return raw.trim().slice(0, MAX_LABEL_LENGTH);
}

/** 邀請碼是否還在有效期內。null 代表不設期限。 */
export function isInviteActive(expiresAt: string | null): boolean {
  if (expiresAt === null) return true;
  const time = Date.parse(expiresAt);
  return Number.isFinite(time) && time > Date.now();
}
