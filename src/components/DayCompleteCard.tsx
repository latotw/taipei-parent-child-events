"use client";

import { formatFullDate } from "@/lib/date";
import type { CipherRecord } from "@/lib/types";

type Props = {
  dateKey: string;
  /** 已濾掉空白的三件事 */
  items: string[];
  notes: string;
  cipher: CipherRecord | null;
  /** 是否在 Workspace 裡（決定要不要提同步狀態） */
  inWorkspace: boolean;
  onReview: () => void;
};

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

/**
 * 送出之後取代編輯表單的完成畫面。
 *
 * 寫日記是一個有結束的儀式，輸入欄位一直留在那裡等人繼續打字，
 * 反而讓人不知道「寫完了沒」。這裡把當天的內容收成一張安靜的卡片，
 * 要改再按底部的「修改這一天」。
 */
export default function DayCompleteCard({
  dateKey,
  items,
  notes,
  cipher,
  inWorkspace,
  onReview,
}: Props) {
  return (
    <section
      aria-label="今天已完成"
      className="rounded-3xl border border-leaf/25 bg-leaf-soft/40 p-4 shadow-soft"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-leaf text-white"
        >
          <svg viewBox="0 0 20 20" className="size-4">
            <path
              d="M5 10.5 8.5 14 15 6.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>

        <div className="min-w-0 flex-1">
          <h2 className="text-base font-medium text-ink">
            {items.length === 3
              ? "今天的三件事寫完了"
              : `今天記下了 ${items.length} 件事`}
          </h2>
          <p className="mt-0.5 text-xs text-ink-soft">
            {formatFullDate(dateKey)}
            {cipher && ` · ${formatTime(cipher.savedAt)} 加密`}
            {cipher &&
              (cipher.synced
                ? " · 已同步"
                : inWorkspace
                  ? " · 尚未同步"
                  : " · 只在這台裝置")}
          </p>
        </div>
      </div>

      <ol className="mt-4 list-decimal space-y-2 pl-8 text-[15px] leading-relaxed text-ink">
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ol>

      {notes && (
        <p className="mt-3 ml-8 border-t border-leaf/20 pt-3 text-[13px] leading-relaxed whitespace-pre-wrap text-ink-soft">
          {notes}
        </p>
      )}

      <button
        type="button"
        onClick={onReview}
        className="mt-4 ml-8 text-xs text-ink-soft underline decoration-line underline-offset-4 transition-colors hover:text-clay-deep"
      >
        看看過去寫過的
      </button>
    </section>
  );
}
