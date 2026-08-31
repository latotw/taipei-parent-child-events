/**
 * 資料匯出（JSON Backup）。
 *
 * 兩種格式：
 *   encrypted — 直接把 envelope 原封不動存下來。檔案本身還是加密的，
 *               沒有共用密碼也讀不出內容，適合丟到任何地方備份。
 *   plain     — 在客戶端解密後的明文。真正「拿得回自己的資料」，
 *               但檔案沒有任何保護，UI 上必須講清楚。
 *
 * 這個檔案只做資料整理，不碰 DOM、不碰網路，方便測試。
 */

import type { JournalPayload } from "@/lib/types";

export const BACKUP_FORMAT = "gratitude-journal-backup";
export const BACKUP_VERSION = 1;

export type BackupKind = "encrypted" | "plain";

/** 一筆紀錄的來源：這台裝置的暫存，或共用 Workspace。 */
export type BackupSource = "local" | "workspace";

export type CollectedEntry = {
  date: string;
  authorLabel: string;
  isMine: boolean;
  /** 最後更新時間（ISO） */
  savedAt: string;
  source: BackupSource;
  ciphertext: string;
};

export type BackupWorkspace = {
  id: string;
  members: { label: string; isMe: boolean }[];
};

type BaseBackup = {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  workspace: BackupWorkspace | null;
  entryCount: number;
};

export type EncryptedBackup = BaseBackup & {
  encrypted: true;
  /** 說明怎麼解開，免得幾年後看到檔案不知道從何下手 */
  hint: string;
  entries: CollectedEntry[];
};

export type PlainBackupEntry = {
  date: string;
  authorLabel: string;
  isMine: boolean;
  savedAt: string;
  source: BackupSource;
  items: string[];
  notes: string;
};

export type PlainBackup = BaseBackup & {
  encrypted: false;
  entries: PlainBackupEntry[];
  /** 解不開的紀錄（例如密碼換過），保留下來以免使用者以為資料不見了 */
  undecryptable: CollectedEntry[];
};

export type Backup = EncryptedBackup | PlainBackup;

/**
 * 把本機暫存與 Workspace 的紀錄合成一份清單。
 *
 * 同一天、同一個人可能兩邊都有（本機剛寫完、遠端是上次同步的），
 * 這時保留時間較新的那一筆。排序為日期新到舊，同一天依標籤排。
 */
export function collectEntries(input: {
  local: { date: string; ciphertext: string; savedAt: string }[];
  workspace: {
    date: string;
    authorLabel: string;
    isMine: boolean;
    savedAt: string;
    ciphertext: string;
  }[];
  /** 沒有 workspace 時，自己的紀錄要掛在哪個標籤下 */
  myLabel: string;
}): CollectedEntry[] {
  const byKey = new Map<string, CollectedEntry>();

  const consider = (entry: CollectedEntry) => {
    const key = `${entry.date}|${entry.authorLabel}`;
    const existing = byKey.get(key);
    if (!existing || entry.savedAt > existing.savedAt) byKey.set(key, entry);
  };

  for (const row of input.workspace) {
    consider({
      date: row.date,
      authorLabel: row.authorLabel,
      isMine: row.isMine,
      savedAt: row.savedAt,
      source: "workspace",
      ciphertext: row.ciphertext,
    });
  }

  for (const row of input.local) {
    consider({
      date: row.date,
      authorLabel: input.myLabel,
      isMine: true,
      savedAt: row.savedAt,
      source: "local",
      ciphertext: row.ciphertext,
    });
  }

  return [...byKey.values()].sort(
    (a, b) =>
      b.date.localeCompare(a.date) || a.authorLabel.localeCompare(b.authorLabel),
  );
}

export function buildEncryptedBackup(input: {
  exportedAt: string;
  workspace: BackupWorkspace | null;
  entries: CollectedEntry[];
}): EncryptedBackup {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: input.exportedAt,
    workspace: input.workspace,
    entryCount: input.entries.length,
    encrypted: true,
    hint: "每筆 ciphertext 是 AES-256-GCM envelope：GJ1.<PBKDF2 迭代次數>.<salt>.<iv>.<ciphertext+tag>，需要當初的共用密碼才能解開。",
    entries: input.entries,
  };
}

export function buildPlainBackup(input: {
  exportedAt: string;
  workspace: BackupWorkspace | null;
  /** 已在客戶端解密的結果；payload 為 null 表示解不開 */
  decrypted: { entry: CollectedEntry; payload: JournalPayload | null }[];
}): PlainBackup {
  const entries: PlainBackupEntry[] = [];
  const undecryptable: CollectedEntry[] = [];

  for (const { entry, payload } of input.decrypted) {
    if (!payload) {
      undecryptable.push(entry);
      continue;
    }
    entries.push({
      date: entry.date,
      authorLabel: entry.authorLabel,
      isMine: entry.isMine,
      savedAt: entry.savedAt,
      source: entry.source,
      items: payload.items,
      notes: payload.notes,
    });
  }

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: input.exportedAt,
    workspace: input.workspace,
    entryCount: entries.length,
    encrypted: false,
    entries,
    undecryptable,
  };
}

/** gratitude-journal-2026-08-31-encrypted.json */
export function backupFilename(exportedAt: string, kind: BackupKind): string {
  const date = exportedAt.slice(0, 10);
  return `gratitude-journal-${date}-${kind}.json`;
}

export function serializeBackup(backup: Backup): string {
  return `${JSON.stringify(backup, null, 2)}\n`;
}
