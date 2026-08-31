"use client";

import StatusBadge from "@/components/StatusBadge";
import {
  formatFullDate,
  isFuture,
  relativeDayLabel,
  shiftDateKey,
  todayKey,
} from "@/lib/date";
import type { DayStatus } from "@/lib/types";

type Props = {
  dateKey: string;
  status: DayStatus;
  onChange: (dateKey: string) => void;
};

const ARROW_BUTTON =
  "flex size-10 shrink-0 items-center justify-center rounded-full border border-line bg-card text-ink-soft transition-colors hover:bg-paper-deep active:bg-paper-deep disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-card";

export default function DateNavigator({ dateKey, status, onChange }: Props) {
  const nextKey = shiftDateKey(dateKey, 1);
  const canGoForward = !isFuture(nextKey);
  const isToday = dateKey === todayKey();
  const nickname = relativeDayLabel(dateKey);

  return (
    <section
      aria-label="日期選擇"
      className="rounded-3xl border border-line bg-card p-4 shadow-soft"
    >
      <div className="flex items-center gap-3">
        <button
          type="button"
          className={ARROW_BUTTON}
          onClick={() => onChange(shiftDateKey(dateKey, -1))}
          aria-label="前一天"
        >
          <svg viewBox="0 0 20 20" className="size-5" aria-hidden>
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

        <div className="min-w-0 flex-1 text-center">
          <p className="truncate text-base font-medium text-ink">
            {formatFullDate(dateKey)}
          </p>
          {nickname && (
            <p className="mt-0.5 text-xs text-ink-muted">{nickname}</p>
          )}
        </div>

        <button
          type="button"
          className={ARROW_BUTTON}
          onClick={() => onChange(nextKey)}
          disabled={!canGoForward}
          aria-label="後一天"
        >
          <svg viewBox="0 0 20 20" className="size-5" aria-hidden>
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

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          <span className="sr-only">選擇日期</span>
          <input
            type="date"
            value={dateKey}
            max={todayKey()}
            onChange={(event) => {
              if (event.target.value) onChange(event.target.value);
            }}
            className="rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink outline-none transition focus:border-clay focus:ring-2 focus:ring-clay/20"
          />
        </label>

        <div className="flex items-center gap-2">
          <StatusBadge status={status} />
          {!isToday && (
            <button
              type="button"
              onClick={() => onChange(todayKey())}
              className="rounded-full px-3 py-1 text-xs font-medium text-clay-deep underline decoration-clay/40 underline-offset-4 transition-colors hover:decoration-clay"
            >
              回到今天
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
