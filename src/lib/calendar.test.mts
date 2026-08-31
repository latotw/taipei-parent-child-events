/**
 * 月曆格子計算的測試（跨月、跨年、閏年、週日對齊都是容易出錯的地方）。
 *
 *   npm run test:calendar
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMonth,
  monthOf,
  monthRange,
  shiftMonth,
  WEEKDAY_LABELS,
} from "@/lib/calendar";

test("monthOf 從 date key 取出年月", () => {
  assert.deepEqual(monthOf("2026-08-31"), { year: 2026, month: 8 });
  assert.deepEqual(monthOf("2026-01-01"), { year: 2026, month: 1 });
  assert.deepEqual(monthOf("2026-12-31"), { year: 2026, month: 12 });
});

test("shiftMonth 會正確跨年", () => {
  assert.deepEqual(shiftMonth(2026, 8, 1), { year: 2026, month: 9 });
  assert.deepEqual(shiftMonth(2026, 12, 1), { year: 2027, month: 1 });
  assert.deepEqual(shiftMonth(2026, 1, -1), { year: 2025, month: 12 });
  assert.deepEqual(shiftMonth(2026, 1, -13), { year: 2024, month: 12 });
  assert.deepEqual(shiftMonth(2026, 6, 18), { year: 2027, month: 12 });
  assert.deepEqual(shiftMonth(2026, 8, 0), { year: 2026, month: 8 });
});

test("monthRange 給出當月第一天與最後一天", () => {
  assert.deepEqual(monthRange(2026, 8), { from: "2026-08-01", to: "2026-08-31" });
  assert.deepEqual(monthRange(2026, 2), { from: "2026-02-01", to: "2026-02-28" });
  // 閏年
  assert.deepEqual(monthRange(2028, 2), { from: "2028-02-01", to: "2028-02-29" });
  assert.deepEqual(monthRange(2026, 4), { from: "2026-04-01", to: "2026-04-30" });
  assert.deepEqual(monthRange(2026, 12), { from: "2026-12-01", to: "2026-12-31" });
});

test("buildMonth 每列七格、第一格是週日", () => {
  const month = buildMonth(2026, 8, "2026-08-31");
  assert.equal(WEEKDAY_LABELS.length, 7);
  for (const week of month.weeks) assert.equal(week.length, 7);
  // 2026-08-01 是週六，所以第一列只有最後一格屬於這個月
  assert.equal(month.weeks[0][0].dateKey, "2026-07-26");
  assert.equal(month.weeks[0][0].inMonth, false);
  assert.equal(month.weeks[0][6].dateKey, "2026-08-01");
  assert.equal(month.weeks[0][6].inMonth, true);
  assert.equal(month.label, "2026年8月");
});

test("buildMonth 的當月天數正確（含閏月）", () => {
  const count = (year: number, month: number) =>
    buildMonth(year, month, "2026-08-31")
      .weeks.flat()
      .filter((cell) => cell.inMonth).length;

  assert.equal(count(2026, 8), 31);
  assert.equal(count(2026, 2), 28);
  assert.equal(count(2028, 2), 29);
  assert.equal(count(2026, 4), 30);
  // 2026-02-01 剛好是週日，整月正好塞滿 4 列
  assert.equal(buildMonth(2026, 2, "2026-08-31").weeks.length, 4);
});

test("buildMonth 標出今天與未來", () => {
  const month = buildMonth(2026, 8, "2026-08-15");
  const cells = month.weeks.flat();
  const today = cells.filter((cell) => cell.isToday);
  assert.equal(today.length, 1);
  assert.equal(today[0].dateKey, "2026-08-15");

  assert.equal(cells.find((c) => c.dateKey === "2026-08-14")?.isFuture, false);
  assert.equal(cells.find((c) => c.dateKey === "2026-08-15")?.isFuture, false);
  assert.equal(cells.find((c) => c.dateKey === "2026-08-16")?.isFuture, true);
  // 補在後面的下個月日期也算未來
  assert.equal(cells.find((c) => c.dateKey === "2026-09-01")?.isFuture, true);
});

test("buildMonth 的格子日期連續且不重複", () => {
  for (const [year, month] of [
    [2026, 1],
    [2026, 2],
    [2026, 8],
    [2026, 12],
    [2028, 2],
  ] as const) {
    const cells = buildMonth(year, month, "2026-08-31").weeks.flat();
    const keys = cells.map((cell) => cell.dateKey);
    assert.equal(new Set(keys).size, keys.length, `${year}-${month} 有重複日期`);
    for (let i = 1; i < keys.length; i += 1) {
      const previous = new Date(`${keys[i - 1]}T00:00:00Z`);
      const current = new Date(`${keys[i]}T00:00:00Z`);
      assert.equal(
        current.getTime() - previous.getTime(),
        86_400_000,
        `${keys[i - 1]} → ${keys[i]} 不連續`,
      );
    }
  }
});
