/**
 * 月曆格子的計算。純函式，不看「現在幾點」——今天是哪一天由呼叫端傳進來，
 * 這樣測試才好寫，也才不會在 SSR 與客戶端算出不同結果。
 */

import { fromDateKey, toDateKey } from "@/lib/date";

/** 週日起算，配合台灣的習慣。 */
export const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"] as const;

export type CalendarCell = {
  dateKey: string;
  day: number;
  /** 是否屬於正在看的那個月（前後補滿的格子為 false） */
  inMonth: boolean;
  isToday: boolean;
  /** 未來的日期不能寫日記，也不會有紀錄 */
  isFuture: boolean;
};

export type CalendarMonth = {
  year: number;
  /** 1–12 */
  month: number;
  /** 例：2026年8月 */
  label: string;
  /** 每列七格，第一列從週日開始 */
  weeks: CalendarCell[][];
};

/** "2026-08-31" → { year: 2026, month: 8 } */
export function monthOf(dateKey: string): { year: number; month: number } {
  const date = fromDateKey(dateKey);
  return { year: date.getFullYear(), month: date.getMonth() + 1 };
}

/** 往前／往後移動月份，會正確跨年。 */
export function shiftMonth(
  year: number,
  month: number,
  delta: number,
): { year: number; month: number } {
  const zeroBased = month - 1 + delta;
  return {
    year: year + Math.floor(zeroBased / 12),
    month: ((zeroBased % 12) + 12) % 12 + 1,
  };
}

/** 這個月的第一天與最後一天，用來查資料庫的日期區間。 */
export function monthRange(
  year: number,
  month: number,
): { from: string; to: string } {
  return {
    from: toDateKey(new Date(year, month - 1, 1)),
    // 下個月的第 0 天 = 這個月的最後一天
    to: toDateKey(new Date(year, month, 0)),
  };
}

export function monthLabel(year: number, month: number): string {
  return `${year}年${month}月`;
}

/**
 * 產生一個月的格子。前後會補上鄰月的日期把每一列填滿七格
 * （`inMonth: false`），這樣版面不會忽高忽低。
 */
export function buildMonth(
  year: number,
  month: number,
  todayKey: string,
): CalendarMonth {
  const firstOfMonth = new Date(year, month - 1, 1);
  // 從包含這個月第一天的那一週的週日開始
  const gridStart = new Date(year, month - 1, 1 - firstOfMonth.getDay());
  const daysInMonth = new Date(year, month, 0).getDate();
  const cellCount = Math.ceil((firstOfMonth.getDay() + daysInMonth) / 7) * 7;

  const weeks: CalendarCell[][] = [];
  for (let index = 0; index < cellCount; index += 1) {
    const date = new Date(
      gridStart.getFullYear(),
      gridStart.getMonth(),
      gridStart.getDate() + index,
    );
    const dateKey = toDateKey(date);
    const cell: CalendarCell = {
      dateKey,
      day: date.getDate(),
      inMonth: date.getMonth() === month - 1 && date.getFullYear() === year,
      isToday: dateKey === todayKey,
      isFuture: dateKey > todayKey,
    };

    if (index % 7 === 0) weeks.push([]);
    weeks[weeks.length - 1].push(cell);
  }

  return { year, month, label: monthLabel(year, month), weeks };
}
