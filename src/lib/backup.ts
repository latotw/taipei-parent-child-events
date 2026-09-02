/**
 * 資料匯出與匯入（JSON Backup）。
 *
 * 兩種格式：
 *   encrypted — 直接把 envelope 原封不動存下來。檔案本身還是加密的，
 *               沒有共用密碼也讀不出內容，適合丟到任何地方備份。
 *   plain     — 在客戶端解密後的明文。真正「拿得回自己的資料」，
 *               但檔案沒有任何保護，UI 上必須講清楚。
 *
 * 匯出的檔案要能再匯入回來，否則「資料自主權」只做了一半——
 * 拿得回檔案，卻拿不回日記。parseBackup 負責把檔案讀回可還原的形狀。
 *
 * 這個檔案只做資料整理，不碰 DOM、不碰網路、不碰加解密，方便測試。
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

// --- 匯入（還原備份）-------------------------------------------------------

/**
 * 匯入時的單筆候選。
 *
 * 加密備份帶的是原本的 envelope（要用密碼解開才知道內容）；
 * 明文備份帶的是內容（要用現在的密碼重新加密才能放回 app）。
 * 兩種都需要密碼，只是方向相反。
 */
export type ImportCandidate = {
  /** YYYY-MM-DD */
  date: string;
  /** 這筆紀錄當初的時間，ISO 字串 */
  savedAt: string;
  /** 加密備份：原始 envelope；明文備份：null */
  ciphertext: string | null;
  /** 明文備份：解密後的內容；加密備份：null */
  plain: { items: string[]; notes: string } | null;
};

export type ParsedBackup = {
  kind: BackupKind;
  /** 檔案產生的時間；壞掉或缺少時是空字串 */
  exportedAt: string;
  workspace: BackupWorkspace | null;
  /** 檔案裡屬於自己的紀錄，日期新到舊 */
  mine: ImportCandidate[];
  /** 另一半寫的。不會匯進自己的日記——那是對方的紀錄，不能改掛在我名下 */
  others: { date: string; authorLabel: string }[];
  /** 格式不對、只能跳過的筆數。壞掉幾筆不該讓整個檔案都救不回來 */
  malformed: number;
  /** 明文備份裡當初就解不開的筆數（檔案裡仍以 envelope 保留） */
  undecryptable: number;
};

/** 檔案根本不是備份檔（或格式無法辨識）時丟出，message 可直接顯示。 */
export class BackupParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupParseError";
  }
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** 加密字串的開頭，見 lib/crypto.ts */
const ENVELOPE_PREFIX = "GJ1.";

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parseWorkspace(value: unknown): BackupWorkspace | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as { id?: unknown; members?: unknown };
  if (typeof raw.id !== "string") return null;
  const members = Array.isArray(raw.members)
    ? raw.members.flatMap((member) => {
        if (typeof member !== "object" || member === null) return [];
        const row = member as { label?: unknown; isMe?: unknown };
        if (typeof row.label !== "string") return [];
        return [{ label: row.label, isMe: row.isMe === true }];
      })
    : [];
  return { id: raw.id, members };
}

/**
 * 把備份檔的文字讀成可還原的形狀。
 *
 * 刻意寬鬆對待「單筆壞掉」：跳過並計數，其他筆照樣還原。
 * 只有整個檔案無法辨識（不是 JSON、format 不符、版本太新）才丟 BackupParseError。
 */
export function parseBackup(text: string): ParsedBackup {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BackupParseError(
      "這個檔案不是有效的 JSON，請確認選到的是備份檔本身。",
    );
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new BackupParseError("備份檔的內容不是預期的格式。");
  }

  const file = raw as Record<string, unknown>;

  if (file.format !== BACKUP_FORMAT) {
    throw new BackupParseError(
      "這不是感恩日記的備份檔（缺少對應的 format 標記）。",
    );
  }

  const version = typeof file.version === "number" ? file.version : 0;
  if (version > BACKUP_VERSION) {
    throw new BackupParseError(
      `這個備份檔來自較新版本的 app（version ${version}），請先更新後再匯入。`,
    );
  }

  if (typeof file.encrypted !== "boolean") {
    throw new BackupParseError(
      "備份檔沒有標明是加密備份還是明文備份，無法判斷怎麼還原。",
    );
  }

  if (!Array.isArray(file.entries)) {
    throw new BackupParseError("備份檔裡找不到 entries 清單。");
  }

  const kind: BackupKind = file.encrypted ? "encrypted" : "plain";
  const exportedAt = asString(file.exportedAt);

  const mineByDate = new Map<string, ImportCandidate>();
  const others: { date: string; authorLabel: string }[] = [];
  let malformed = 0;

  for (const row of file.entries) {
    if (typeof row !== "object" || row === null) {
      malformed += 1;
      continue;
    }
    const entry = row as Record<string, unknown>;

    const date = asString(entry.date);
    if (!DATE_PATTERN.test(date)) {
      malformed += 1;
      continue;
    }

    // savedAt 缺少時退回檔案的匯出時間——比整筆丟掉好。
    const savedAt = asString(entry.savedAt) || exportedAt;

    if (entry.isMine === false) {
      others.push({ date, authorLabel: asString(entry.authorLabel) || "另一半" });
      continue;
    }

    let candidate: ImportCandidate;
    if (kind === "encrypted") {
      const ciphertext = asString(entry.ciphertext);
      if (!ciphertext.startsWith(ENVELOPE_PREFIX)) {
        malformed += 1;
        continue;
      }
      candidate = { date, savedAt, ciphertext, plain: null };
    } else {
      if (!Array.isArray(entry.items)) {
        malformed += 1;
        continue;
      }
      const items = entry.items.filter(
        (item): item is string => typeof item === "string" && item.trim() !== "",
      );
      const notes = asString(entry.notes);
      if (items.length === 0 && notes.trim() === "") {
        // 整筆是空的，還原回去也只是一天空白。
        malformed += 1;
        continue;
      }
      candidate = { date, savedAt, ciphertext: null, plain: { items, notes } };
    }

    // 同一天出現兩次（例如手動合併過的檔案）時留較新的那一筆。
    const existing = mineByDate.get(date);
    if (!existing || candidate.savedAt > existing.savedAt) {
      mineByDate.set(date, candidate);
    }
  }

  return {
    kind,
    exportedAt,
    workspace: parseWorkspace(file.workspace),
    mine: [...mineByDate.values()].sort((a, b) => b.date.localeCompare(a.date)),
    others,
    malformed,
    undecryptable: Array.isArray(file.undecryptable)
      ? file.undecryptable.length
      : 0,
  };
}
