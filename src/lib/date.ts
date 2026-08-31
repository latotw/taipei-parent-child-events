/**
 * 日期工具：一律以「本地時區的 YYYY-MM-DD」當作日記的 key，
 * 避免用 toISOString() 造成跨時區差一天的問題。
 */

const pad = (n: number) => String(n).padStart(2, "0");

export function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function fromDateKey(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function todayKey(): string {
  return toDateKey(new Date());
}

/** 往前／往後移動天數，回傳新的 date key。 */
export function shiftDateKey(key: string, days: number): string {
  const date = fromDateKey(key);
  date.setDate(date.getDate() + days);
  return toDateKey(date);
}

export function isFuture(key: string): boolean {
  return key > todayKey();
}

/** 例：2026年8月31日 星期一 */
export function formatFullDate(key: string): string {
  return new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(fromDateKey(key));
}

/** 相對今天的暱稱，沒有對應的就回傳 null。 */
export function relativeDayLabel(key: string): string | null {
  const diff = Math.round(
    (fromDateKey(key).getTime() - fromDateKey(todayKey()).getTime()) / 86_400_000,
  );

  switch (diff) {
    case 0:
      return "今天";
    case -1:
      return "昨天";
    case -2:
      return "前天";
    case 1:
      return "明天";
    default:
      return null;
  }
}

/** 依時間給一句溫暖的問候。 */
export function greetingFor(date: Date): string {
  const hour = date.getHours();
  if (hour < 5) return "夜深了";
  if (hour < 11) return "早安";
  if (hour < 14) return "午安";
  if (hour < 18) return "午後好";
  return "晚安";
}
