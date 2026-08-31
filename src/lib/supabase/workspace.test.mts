/**
 * 同步層裡「不需要連線」的部分：邀請碼正規化、顯示格式、有效期判斷、
 * 以及錯誤代碼對照。連線行為請看 supabase/tests/01-rls.test.sql。
 *
 *   npm run test:sync
 */

import assert from "node:assert/strict";
import test from "node:test";

import { SyncError, toSyncError } from "./errors.ts";
import {
  formatInviteCode,
  isInviteActive,
  isValidInviteCode,
  normalizeInviteCode,
  normalizeLabel,
} from "./invite.ts";

test("邀請碼正規化：去掉分隔符號、轉大寫", () => {
  assert.equal(normalizeInviteCode("9f3a-1c7b-2d"), "9F3A1C7B2D");
  assert.equal(normalizeInviteCode(" 9F3A 1C7B 2D "), "9F3A1C7B2D");
  assert.equal(normalizeInviteCode("9f3a1c7b2d"), "9F3A1C7B2D");
  // 非 hex 的字元直接丟掉，不會偷偷變成別的碼
  assert.equal(normalizeInviteCode("9F3A-1C7B-2D!!"), "9F3A1C7B2D");
  assert.equal(normalizeInviteCode("hello world"), "ED"); // 只有 e 與 d 是 hex
  assert.equal(normalizeInviteCode(""), "");
});

test("邀請碼長度檢查", () => {
  assert.equal(isValidInviteCode("9f3a-1c7b-2d"), true);
  assert.equal(isValidInviteCode("9F3A1C7B2"), false);
  assert.equal(isValidInviteCode("9F3A1C7B2D1"), false);
  assert.equal(isValidInviteCode(""), false);
});

test("邀請碼顯示成 4-4-2", () => {
  assert.equal(formatInviteCode("9F3A1C7B2D"), "9F3A-1C7B-2D");
  assert.equal(formatInviteCode("9f3a-1c7b-2d"), "9F3A-1C7B-2D");
  assert.equal(formatInviteCode(""), "");
});

test("邀請碼有效期：null 視為不過期", () => {
  assert.equal(isInviteActive(null), true);
  assert.equal(isInviteActive(new Date(Date.now() + 60_000).toISOString()), true);
  assert.equal(isInviteActive(new Date(Date.now() - 60_000).toISOString()), false);
  // 湊滿兩人時伺服器會把到期時間設成 now()，之後就是過去式
  assert.equal(isInviteActive("2020-01-01T00:00:00.000Z"), false);
  assert.equal(isInviteActive("not-a-date"), false);
});

test("標籤正規化：去空白並截斷到 20 字", () => {
  assert.equal(normalizeLabel("  小美  "), "小美");
  assert.equal(normalizeLabel(""), "");
  assert.equal(normalizeLabel("   "), "");
  assert.equal(normalizeLabel("あ".repeat(30)).length, 20);
});

test("Postgres 錯誤代碼對照成看得懂的 SyncError", () => {
  const cases: Record<string, string> = {
    "22023": "INVALID_CODE",
    "23505": "WORKSPACE_FULL",
    "42501": "FORBIDDEN",
    "28000": "AUTH_FAILED",
    "23514": "REJECTED",
  };
  for (const [pgCode, expected] of Object.entries(cases)) {
    assert.equal(toSyncError({ code: pgCode, message: "x" }).code, expected, pgCode);
  }

  assert.equal(toSyncError({ message: "TypeError: Failed to fetch" }).code, "NETWORK");
  assert.equal(toSyncError(new Error("boom")).code, "UNKNOWN");
  assert.equal(toSyncError(null).code, "UNKNOWN");

  // 已經是 SyncError 就原封不動傳回
  const original = new SyncError("NOT_CONFIGURED", "沒設定");
  assert.equal(toSyncError(original), original);

  // 每個代碼都要有中文訊息
  for (const pgCode of Object.keys(cases)) {
    assert.match(toSyncError({ code: pgCode }).message, /[一-鿿]/);
  }
});
