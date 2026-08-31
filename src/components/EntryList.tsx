"use client";

import type { JournalPayload } from "@/lib/types";

/**
 * 一則已讀回（並嘗試解密）的日記。payload 為 null 表示解不開。
 * 「這一天的共享內容」與「回顧」用的是同一份呈現邏輯，所以抽在這裡。
 */
export type EntryListItem = {
  id: string;
  authorLabel: string;
  isMine: boolean;
  /** 更新時間，ISO 字串 */
  timestamp: string;
  /** 額外標註，例如「未同步」 */
  note?: string;
  payload: JournalPayload | null;
  /** 有值時顯示還原按鈕 */
  restoreLabel?: string;
};

type Props = {
  /** null 表示還在載入 */
  items: EntryListItem[] | null;
  loading: boolean;
  error: string | null;
  emptyText: string;
  hasPassphrase: boolean;
  onRestore?: (payload: JournalPayload) => void;
};

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

export default function EntryList({
  items,
  loading,
  error,
  emptyText,
  hasPassphrase,
  onRestore,
}: Props) {
  if (error) {
    return (
      <p
        role="alert"
        className="rounded-2xl bg-clay-soft px-3 py-2 text-xs leading-relaxed text-clay-deep"
      >
        {error}
      </p>
    );
  }

  if (loading && items === null) {
    return (
      <p className="text-xs text-ink-muted" aria-live="polite">
        讀取並解密中…
      </p>
    );
  }

  if (items !== null && items.length === 0) {
    return <p className="text-xs text-ink-muted">{emptyText}</p>;
  }

  return (
    <ul className="space-y-3">
      {items?.map((item) => (
        <li
          key={item.id}
          className="rounded-2xl border border-line bg-paper p-3"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-ink">
              {item.authorLabel}
              {item.isMine && (
                <span className="ml-1 text-xs text-ink-muted">（你）</span>
              )}
            </p>
            <span className="text-xs text-ink-muted">
              {formatTime(item.timestamp)}
              {item.note && ` · ${item.note}`}
            </span>
          </div>

          {item.payload ? (
            <>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-[13px] leading-relaxed text-ink">
                {item.payload.items.map((text, index) => (
                  <li key={index}>{text}</li>
                ))}
              </ol>
              {item.payload.notes && (
                <p className="mt-2 border-t border-line pt-2 text-[13px] leading-relaxed whitespace-pre-wrap text-ink-soft">
                  {item.payload.notes}
                </p>
              )}
              {item.restoreLabel && onRestore && (
                <button
                  type="button"
                  onClick={() => {
                    if (item.payload) onRestore(item.payload);
                  }}
                  className="mt-2 text-xs text-ink-muted underline decoration-line underline-offset-4 transition-colors hover:text-clay-deep"
                >
                  {item.restoreLabel}
                </button>
              )}
            </>
          ) : (
            <p className="mt-2 text-xs leading-relaxed text-clay-deep">
              {hasPassphrase
                ? "用目前的密碼解不開這則——兩人要使用同一組共用密碼才看得到對方的內容。"
                : "尚未設定共用密碼。到「設定」分頁輸入後就能解密。"}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
