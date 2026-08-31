/**
 * 加密模組的行為測試。用 Node 內建的 test runner 跑（Node 的 webcrypto 與
 * 瀏覽器的 Web Crypto 是同一套 API）：
 *
 *   npm run test:crypto
 */

import assert from "node:assert/strict";
import test from "node:test";

import { CryptoError, decryptJournal, encryptJournal } from "./crypto.ts";
import type { JournalPayload } from "./types.ts";

const PASSPHRASE = "warm-tea-2026";

const payload: JournalPayload = {
  date: "2026-08-31",
  items: ["捷運剛好有位子", "同事幫我頂了一個臨時會議", "孩子說今天的湯很好喝"],
  notes: '今天有點忙，但心情是穩的。\n特殊字元： " \\ { } 🌿 <script>',
  savedAt: "2026-08-31T09:10:00.000Z",
};

/** 取出 CryptoError 的代碼，方便斷言。 */
async function codeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return "<no throw>";
  } catch (error) {
    return error instanceof CryptoError ? error.code : `<${String(error)}>`;
  }
}

test("加密後可以用同一組密碼完整還原", async () => {
  const envelope = await encryptJournal(payload, PASSPHRASE);
  assert.deepEqual(await decryptJournal(envelope, PASSPHRASE), payload);
});

test("加密字串是 GJ1 envelope，且看不到明文", async () => {
  const envelope = await encryptJournal(payload, PASSPHRASE);
  assert.match(
    envelope,
    /^GJ1\.600000\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/,
  );
  const rawCiphertext = Buffer.from(envelope.split(".")[4], "base64").toString(
    "utf8",
  );
  assert.ok(!envelope.includes("捷運"));
  assert.ok(!rawCiphertext.includes("捷運"));
});

test("同樣的內容每次加密結果都不同（salt 與 IV 都是隨機的）", async () => {
  const first = await encryptJournal(payload, PASSPHRASE);
  const second = await encryptJournal(payload, PASSPHRASE);
  assert.notEqual(first, second);
  assert.deepEqual(await decryptJournal(second, PASSPHRASE), payload);
});

test("密碼錯誤時丟出 WRONG_PASSPHRASE", async () => {
  const envelope = await encryptJournal(payload, PASSPHRASE);
  assert.equal(
    await codeOf(() => decryptJournal(envelope, "wrong-password")),
    "WRONG_PASSPHRASE",
  );
  // 大小寫與前後空白都算不同的密碼
  assert.equal(
    await codeOf(() => decryptJournal(envelope, PASSPHRASE.toUpperCase())),
    "WRONG_PASSPHRASE",
  );
  assert.equal(
    await codeOf(() => decryptJournal(envelope, `${PASSPHRASE} `)),
    "WRONG_PASSPHRASE",
  );
});

test("空密碼與空內容都會被擋下來", async () => {
  const envelope = await encryptJournal(payload, PASSPHRASE);
  assert.equal(
    await codeOf(() => encryptJournal(payload, "   ")),
    "EMPTY_PASSPHRASE",
  );
  assert.equal(
    await codeOf(() => decryptJournal(envelope, "")),
    "EMPTY_PASSPHRASE",
  );
  assert.equal(
    await codeOf(() =>
      encryptJournal({ ...payload, items: ["", "  "], notes: " " }, PASSPHRASE),
    ),
    "EMPTY_CONTENT",
  );
  assert.equal(
    await codeOf(() => decryptJournal("   ", PASSPHRASE)),
    "EMPTY_CIPHERTEXT",
  );
});

test("格式不對的加密字串丟出 BAD_ENVELOPE", async () => {
  const envelope = await encryptJournal(payload, PASSPHRASE);
  const parts = envelope.split(".");
  const cases: Record<string, string> = {
    "不是 envelope": "hello world",
    "版本不對": envelope.replace("GJ1", "GJ9"),
    "段數不足": parts.slice(0, 4).join("."),
    "不是 base64": "GJ1.600000.@@@.@@@.@@@",
    "salt 長度不符": [
      "GJ1",
      "600000",
      Buffer.alloc(8).toString("base64"),
      parts[3],
      parts[4],
    ].join("."),
    "iterations 不合理": ["GJ1", "0", parts[2], parts[3], parts[4]].join("."),
  };

  for (const [name, broken] of Object.entries(cases)) {
    assert.equal(
      await codeOf(() => decryptJournal(broken, PASSPHRASE)),
      "BAD_ENVELOPE",
      name,
    );
  }
});

test("被竄改的內容無法通過 AES-GCM 驗證", async () => {
  const envelope = await encryptJournal(payload, PASSPHRASE);
  const parts = envelope.split(".");

  const flip = (base64: string) => {
    const bytes = Buffer.from(base64, "base64");
    bytes[0] ^= 0xff;
    return bytes.toString("base64");
  };

  const cases: Record<string, string> = {
    "改 ciphertext": [...parts.slice(0, 4), flip(parts[4])].join("."),
    "改 IV": [...parts.slice(0, 3), flip(parts[3]), parts[4]].join("."),
    "改 salt": [...parts.slice(0, 2), flip(parts[2]), ...parts.slice(3)].join(
      ".",
    ),
    // iterations 有進 additionalData，改了也會驗證失敗
    "改 iterations": ["GJ1", "599999", ...parts.slice(2)].join("."),
  };

  for (const [name, tampered] of Object.entries(cases)) {
    assert.equal(
      await codeOf(() => decryptJournal(tampered, PASSPHRASE)),
      "WRONG_PASSPHRASE",
      name,
    );
  }
});

test("解得開但結構不符時丟出 CORRUPT_PAYLOAD", async () => {
  const forged = await encryptJournal(
    // 故意繞過型別，模擬別的地方寫進來的壞資料
    { date: 1 as never, items: ["x"], notes: "", savedAt: "" },
    PASSPHRASE,
  );
  assert.equal(
    await codeOf(() => decryptJournal(forged, PASSPHRASE)),
    "CORRUPT_PAYLOAD",
  );
});
