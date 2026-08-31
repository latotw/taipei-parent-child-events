/**
 * 匯出格式的測試：合併去重、排序、檔名、以及「解不開的紀錄不會靜靜消失」。
 *
 *   npm run test:backup
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  backupFilename,
  buildEncryptedBackup,
  buildPlainBackup,
  collectEntries,
  serializeBackup,
  type CollectedEntry,
} from "@/lib/backup";

const cipher = (tag: string) => `GJ1.600000.salt${tag}.iv${tag}.body${tag}`;

test("collectEntries 合併本機與 workspace 的紀錄", () => {
  const entries = collectEntries({
    local: [
      { date: "2026-08-30", ciphertext: cipher("local30"), savedAt: "2026-08-30T10:00:00.000Z" },
    ],
    workspace: [
      {
        date: "2026-08-31",
        authorLabel: "小美",
        isMine: false,
        savedAt: "2026-08-31T12:00:00.000Z",
        ciphertext: cipher("her31"),
      },
    ],
    myLabel: "小明",
  });

  assert.equal(entries.length, 2);
  // 日期新到舊
  assert.deepEqual(
    entries.map((entry) => [entry.date, entry.authorLabel, entry.source]),
    [
      ["2026-08-31", "小美", "workspace"],
      ["2026-08-30", "小明", "local"],
    ],
  );
});

test("同一天同一人兩邊都有時，保留時間較新的那一筆", () => {
  const shared = {
    date: "2026-08-31",
    authorLabel: "小明",
    isMine: true,
  };

  const localNewer = collectEntries({
    local: [{ date: shared.date, ciphertext: cipher("new"), savedAt: "2026-08-31T18:00:00.000Z" }],
    workspace: [{ ...shared, savedAt: "2026-08-31T09:00:00.000Z", ciphertext: cipher("old") }],
    myLabel: "小明",
  });
  assert.equal(localNewer.length, 1);
  assert.equal(localNewer[0].source, "local");
  assert.equal(localNewer[0].ciphertext, cipher("new"));

  const remoteNewer = collectEntries({
    local: [{ date: shared.date, ciphertext: cipher("old"), savedAt: "2026-08-31T09:00:00.000Z" }],
    workspace: [{ ...shared, savedAt: "2026-08-31T18:00:00.000Z", ciphertext: cipher("new") }],
    myLabel: "小明",
  });
  assert.equal(remoteNewer.length, 1);
  assert.equal(remoteNewer[0].source, "workspace");
  assert.equal(remoteNewer[0].ciphertext, cipher("new"));
});

test("同一天不同人各自保留", () => {
  const entries = collectEntries({
    local: [{ date: "2026-08-31", ciphertext: cipher("mine"), savedAt: "2026-08-31T10:00:00.000Z" }],
    workspace: [
      {
        date: "2026-08-31",
        authorLabel: "小美",
        isMine: false,
        savedAt: "2026-08-31T11:00:00.000Z",
        ciphertext: cipher("hers"),
      },
    ],
    myLabel: "小明",
  });
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((e) => e.authorLabel).sort(), ["小明", "小美"]);
});

const sample: CollectedEntry[] = [
  {
    date: "2026-08-31",
    authorLabel: "小明",
    isMine: true,
    savedAt: "2026-08-31T10:00:00.000Z",
    source: "workspace",
    ciphertext: cipher("a"),
  },
];

test("加密備份保留原始 envelope 並附上解法說明", () => {
  const backup = buildEncryptedBackup({
    exportedAt: "2026-08-31T13:45:00.000Z",
    workspace: { id: "ws-1", members: [{ label: "小明", isMe: true }] },
    entries: sample,
  });

  assert.equal(backup.format, BACKUP_FORMAT);
  assert.equal(backup.version, BACKUP_VERSION);
  assert.equal(backup.encrypted, true);
  assert.equal(backup.entryCount, 1);
  assert.equal(backup.entries[0].ciphertext, cipher("a"));
  assert.match(backup.hint, /AES-256-GCM/);
  // 檔案裡不應該出現密碼或任何解密後的欄位
  const json = serializeBackup(backup);
  assert.ok(!json.includes("passphrase"));
  assert.ok(json.endsWith("\n"));
  assert.deepEqual(JSON.parse(json), backup);
});

test("明文備份把解不開的紀錄分開列出，不會靜靜消失", () => {
  const backup = buildPlainBackup({
    exportedAt: "2026-08-31T13:45:00.000Z",
    workspace: null,
    decrypted: [
      {
        entry: sample[0],
        payload: {
          date: "2026-08-31",
          items: ["捷運有位子"],
          notes: "心情是穩的",
          savedAt: "2026-08-31T10:00:00.000Z",
        },
      },
      {
        entry: { ...sample[0], date: "2026-08-30", authorLabel: "小美", isMine: false },
        payload: null,
      },
    ],
  });

  assert.equal(backup.encrypted, false);
  assert.equal(backup.entryCount, 1);
  assert.deepEqual(backup.entries[0].items, ["捷運有位子"]);
  assert.equal(backup.entries[0].notes, "心情是穩的");
  assert.equal(backup.undecryptable.length, 1);
  assert.equal(backup.undecryptable[0].date, "2026-08-30");
  // 解不開的那筆仍然帶著 ciphertext，之後想到密碼還能救回來
  assert.equal(backup.undecryptable[0].ciphertext, cipher("a"));
});

test("檔名帶日期與類型", () => {
  assert.equal(
    backupFilename("2026-08-31T13:45:00.000Z", "encrypted"),
    "gratitude-journal-2026-08-31-encrypted.json",
  );
  assert.equal(
    backupFilename("2026-08-31T13:45:00.000Z", "plain"),
    "gratitude-journal-2026-08-31-plain.json",
  );
});

test("空紀錄也能匯出（不會壞掉）", () => {
  const encrypted = buildEncryptedBackup({
    exportedAt: "2026-08-31T13:45:00.000Z",
    workspace: null,
    entries: [],
  });
  assert.equal(encrypted.entryCount, 0);
  assert.deepEqual(encrypted.entries, []);

  const plain = buildPlainBackup({
    exportedAt: "2026-08-31T13:45:00.000Z",
    workspace: null,
    decrypted: [],
  });
  assert.equal(plain.entryCount, 0);
  assert.deepEqual(plain.undecryptable, []);
  assert.equal(
    collectEntries({ local: [], workspace: [], myLabel: "我" }).length,
    0,
  );
});
