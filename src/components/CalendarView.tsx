"use client";

import { buildMonth, WEEKDAY_LABELS, type CalendarMonth } from "@/lib/calendar";

type Props = {
  year: number;
  month: number;
  todayKey: string;
  /** 目前選到的日期 */
  selected: string | null;
  /** dateKey → 那天有幾則紀錄（1 或 2；0 表示沒有） */
  marks: Record<string, number>;
  loading: boolean;
  onSelect: (dateKey: string) => void;
  onShiftMonth: (delta: number) => void;
  /** 是否還能往後翻（不讓人翻到未來的月份） */
  canGoForward: boolean;
};

const ARROW =
  "flex size-9 shrink-0 items-center justify-center rounded-full border border-line bg-card text-ink-soft transition-colors hover:bg-paper-deep disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-card";

/**
 * 觸控目標：320px 寬的螢幕上，七欄要各有 44px 寬在幾何上不可能
 * （7×44 = 308px 已經超過扣掉留白後的可用寬度），所以改為保證「高度」
 * 至少 44px（min-h-11），並在小螢幕收緊留白把寬度盡量撐大。
 */
function cellClass(params: {
  inMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  isFuture: boolean;
  hasEntry: boolean;
}): string {
  const base =
    "relative flex min-h-11 w-full flex-col items-center justify-center gap-1 rounded-2xl py-1.5 text-sm transition-colors sm:aspect-square";

  if (params.isSelected) return `${base} bg-clay font-semibold text-white`;
  if (params.isFuture) return `${base} text-ink-muted/40`;
  if (!params.inMonth) return `${base} text-ink-muted/50 hover:bg-paper-deep`;
  if (params.hasEntry) {
    return `${base} bg-clay-soft/70 font-medium text-clay-deep hover:bg-clay-soft`;
  }
  if (params.isToday) return `${base} text-ink ring-1 ring-clay/40 ring-inset`;
  return `${base} text-ink-soft hover:bg-paper-deep`;
}

export default function CalendarView({
  year,
  month,
  todayKey,
  selected,
  marks,
  loading,
  onSelect,
  onShiftMonth,
  canGoForward,
}: Props) {
  const grid: CalendarMonth = buildMonth(year, month, todayKey);

  return (
    <div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          className={ARROW}
          onClick={() => onShiftMonth(-1)}
          aria-label="上個月"
        >
          <svg viewBox="0 0 20 20" className="size-4" aria-hidden>
            <path
              d="M12.5 4.5 7 10l5.5 5.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        <p className="flex-1 text-center text-sm font-medium text-ink">
          {grid.label}
          {loading && (
            <span className="ml-2 text-xs font-normal text-ink-muted">
              讀取中…
            </span>
          )}
        </p>

        <button
          type="button"
          className={ARROW}
          onClick={() => onShiftMonth(1)}
          disabled={!canGoForward}
          aria-label="下個月"
        >
          <svg viewBox="0 0 20 20" className="size-4" aria-hidden>
            <path
              d="M7.5 4.5 13 10l-5.5 5.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      <div className="mt-3 grid grid-cols-7 gap-0.5 sm:gap-1">
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            className="pb-1 text-center text-[11px] text-ink-muted"
          >
            {label}
          </div>
        ))}

        {grid.weeks.flat().map((cell) => {
          const count = marks[cell.dateKey] ?? 0;
          const isSelected = cell.dateKey === selected;

          return (
            <button
              key={cell.dateKey}
              type="button"
              onClick={() => onSelect(cell.dateKey)}
              disabled={cell.isFuture}
              aria-pressed={isSelected}
              aria-label={`${cell.dateKey}${count > 0 ? `，有 ${count} 則紀錄` : ""}`}
              className={cellClass({
                inMonth: cell.inMonth,
                isToday: cell.isToday,
                isSelected,
                isFuture: cell.isFuture,
                hasEntry: count > 0,
              })}
            >
              <span>{cell.day}</span>
              {/* 有紀錄就點一個點，兩人都寫就兩個點 */}
              <span aria-hidden className="flex h-1 items-center gap-0.5">
                {Array.from({ length: Math.min(count, 2) }, (_, index) => (
                  <span
                    key={index}
                    className={`size-1 rounded-full ${
                      isSelected ? "bg-white/80" : "bg-clay"
                    }`}
                  />
                ))}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
