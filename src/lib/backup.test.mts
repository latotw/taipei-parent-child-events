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
  BackupParseError,
  backupFilename,
  buildEncryptedBackup,
  buildPlainBackup,
  collectEntries,
  parseBackup,
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

// --- 匯入（parseBackup）---------------------------------------------------
//
// 匯出的檔案要能再匯入回來，否則「資料自主權」只做了一半。
// 這裡特別在意兩件事：壞掉一筆不該讓整份備份都救不回來，
// 以及另一半寫的紀錄不能改掛在我名下。

const ENVELOPE = "GJ1.600000.c2FsdHNhbHQ=.aXZpdml2.Y2lwaGVydGV4dA==";

const wrap = (extra: Record<string, unknown>) =>
  JSON.stringify({
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: "2026-09-01T02:00:00.000Z",
    workspace: null,
    entryCount: 0,
    ...extra,
  });

test("加密備份可以匯出再匯入（round-trip）", () => {
  const entries: CollectedEntry[] = [
    {
      date: "2026-08-30",
      authorLabel: "小美",
      isMine: true,
      savedAt: "2026-08-30T13:00:00.000Z",
      source: "local",
      ciphertext: ENVELOPE,
    },
    {
      date: "2026-08-31",
      authorLabel: "小美",
      isMine: true,
      savedAt: "2026-08-31T13:00:00.000Z",
      source: "workspace",
      ciphertext: ENVELOPE,
    },
  ];
  const backup = buildEncryptedBackup({
    exportedAt: "2026-09-01T02:00:00.000Z",
    workspace: { id: "ws-1", members: [{ label: "小美", isMe: true }] },
    entries,
  });

  const parsed = parseBackup(serializeBackup(backup));
  assert.equal(parsed.kind, "encrypted");
  assert.equal(parsed.exportedAt, "2026-09-01T02:00:00.000Z");
  assert.equal(parsed.workspace?.id, "ws-1");
  assert.equal(parsed.malformed, 0);
  // 日期新到舊
  assert.deepEqual(
    parsed.mine.map((row) => row.date),
    ["2026-08-31", "2026-08-30"],
  );
  assert.equal(parsed.mine[0].ciphertext, ENVELOPE);
  assert.equal(parsed.mine[0].plain, null);
});

test("明文備份匯入後帶的是內容而不是 envelope", () => {
  const backup = buildPlainBackup({
    exportedAt: "2026-09-01T02:00:00.000Z",
    workspace: null,
    decrypted: [
      {
        entry: {
          date: "2026-08-31",
          authorLabel: "我",
          isMine: true,
          savedAt: "2026-08-31T13:00:00.000Z",
          source: "local",
          ciphertext: ENVELOPE,
        },
        payload: {
          date: "2026-08-31",
          items: ["捷運剛好有位子", "同事幫我頂了會議"],
          notes: "今天有點忙。",
          savedAt: "2026-08-31T13:00:00.000Z",
        },
      },
    ],
  });

  const parsed = parseBackup(serializeBackup(backup));
  assert.equal(parsed.kind, "plain");
  assert.equal(parsed.mine.length, 1);
  assert.equal(parsed.mine[0].ciphertext, null);
  assert.deepEqual(parsed.mine[0].plain, {
    items: ["捷運剛好有位子", "同事幫我頂了會議"],
    notes: "今天有點忙。",
  });
});

test("另一半寫的紀錄不會被匯進自己的日記", () => {
  const parsed = parseBackup(
    wrap({
      encrypted: true,
      entries: [
        { date: "2026-08-31", isMine: true, savedAt: "x", ciphertext: ENVELOPE },
        {
          date: "2026-08-31",
          isMine: false,
          authorLabel: "小明",
          savedAt: "x",
          ciphertext: ENVELOPE,
        },
      ],
    }),
  );
  assert.equal(parsed.mine.length, 1);
  assert.deepEqual(parsed.others, [
    { date: "2026-08-31", authorLabel: "小明" },
  ]);
});

test("沒有 isMine 欄位時視為自己的紀錄（單人匯出的檔案）", () => {
  const parsed = parseBackup(
    wrap({
      encrypted: true,
      entries: [{ date: "2026-08-31", savedAt: "x", ciphertext: ENVELOPE }],
    }),
  );
  assert.equal(parsed.mine.length, 1);
  assert.equal(parsed.others.length, 0);
});

test("壞掉一筆只跳過那一筆，其他照樣還原", () => {
  const parsed = parseBackup(
    wrap({
      encrypted: true,
      entries: [
        { date: "2026-08-31", savedAt: "x", ciphertext: ENVELOPE },
        // 日期格式不對
        { date: "2026/08/30", savedAt: "x", ciphertext: ENVELOPE },
        // ciphertext 不是 envelope（例如有人手動塞了明文進去）
        { date: "2026-08-29", savedAt: "x", ciphertext: "今天很開心" },
        // 根本不是物件
        "壞掉的一列",
        // 缺日期
        { savedAt: "x", ciphertext: ENVELOPE },
      ],
    }),
  );
  assert.equal(parsed.mine.length, 1);
  assert.equal(parsed.malformed, 4);
});

test("明文備份裡空白或格式不對的紀錄會被跳過", () => {
  const parsed = parseBackup(
    wrap({
      encrypted: false,
      entries: [
        { date: "2026-08-31", savedAt: "x", items: ["有內容"], notes: "" },
        // 三件事全空、notes 也空——還原回去只是一天空白
        { date: "2026-08-30", savedAt: "x", items: ["", "  "], notes: "  " },
        // items 不是陣列
        { date: "2026-08-29", savedAt: "x", items: "不是陣列", notes: "" },
        // 只有 notes 也算有內容
        { date: "2026-08-28", savedAt: "x", items: [], notes: "只寫了心情" },
      ],
    }),
  );
  assert.deepEqual(
    parsed.mine.map((row) => row.date),
    ["2026-08-31", "2026-08-28"],
  );
  assert.equal(parsed.malformed, 2);
  // 空字串會被濾掉，不會變成空白的一件事
  assert.deepEqual(parsed.mine[0].plain?.items, ["有內容"]);
});

test("同一天出現兩次時留較新的那一筆", () => {
  const parsed = parseBackup(
    wrap({
      encrypted: false,
      entries: [
        {
          date: "2026-08-31",
          savedAt: "2026-08-31T10:00:00.000Z",
          items: ["舊的"],
          notes: "",
        },
        {
          date: "2026-08-31",
          savedAt: "2026-08-31T22:00:00.000Z",
          items: ["新的"],
          notes: "",
        },
      ],
    }),
  );
  assert.equal(parsed.mine.length, 1);
  assert.deepEqual(parsed.mine[0].plain?.items, ["新的"]);
});

test("缺少 savedAt 時退回檔案的匯出時間，而不是丟掉整筆", () => {
  const parsed = parseBackup(
    wrap({
      encrypted: true,
      entries: [{ date: "2026-08-31", ciphertext: ENVELOPE }],
    }),
  );
  assert.equal(parsed.mine.length, 1);
  assert.equal(parsed.mine[0].savedAt, "2026-09-01T02:00:00.000Z");
});

test("明文備份裡當初解不開的筆數會被回報", () => {
  const parsed = parseBackup(
    wrap({
      encrypted: false,
      entries: [{ date: "2026-08-31", savedAt: "x", items: ["有"], notes: "" }],
      undecryptable: [
        { date: "2026-08-01", ciphertext: ENVELOPE },
        { date: "2026-08-02", ciphertext: ENVELOPE },
      ],
    }),
  );
  assert.equal(parsed.undecryptable, 2);
});

test("整個檔案無法辨識時丟出可以直接顯示的錯誤", () => {
  const cases: [string, RegExp][] = [
    ["不是 json", /不是有效的 JSON/],
    ["[1,2,3]", /不是預期的格式/],
    [JSON.stringify({ format: "something-else" }), /不是感恩日記的備份檔/],
    [
      JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION + 1 }),
      /較新版本/,
    ],
    [wrap({ entries: [] }), /加密備份還是明文備份/],
    [wrap({ encrypted: true }), /找不到 entries/],
  ];

  for (const [text, pattern] of cases) {
    assert.throws(
      () => parseBackup(text),
      (error: unknown) =>
        error instanceof BackupParseError && pattern.test(error.message),
      text.slice(0, 40),
    );
  }
});

test("舊版本的備份檔仍然讀得進來", () => {
  const parsed = parseBackup(
    JSON.stringify({
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION - 1,
      exportedAt: "2026-01-01T00:00:00.000Z",
      encrypted: true,
      entries: [{ date: "2026-01-01", savedAt: "x", ciphertext: ENVELOPE }],
    }),
  );
  assert.equal(parsed.mine.length, 1);
});
