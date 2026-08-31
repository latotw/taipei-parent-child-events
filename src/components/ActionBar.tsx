"use client";

export type ActionMessage = {
  tone: "info" | "success" | "error";
  text: string;
};

type Props = {
  canSave: boolean;
  canSubmit: boolean;
  isSubmitted: boolean;
  hasPassphrase: boolean;
  busy: "draft" | "submitted" | null;
  /**
   * 操作結果。刻意跟按鈕放在同一個 sticky 區塊裡：
   * 按鈕永遠看得到，訊息就不能留在頁面深處讓人以為「按了沒反應」。
   */
  message: ActionMessage | null;
  onSaveDraft: () => void;
};

const TONE_CLASS = {
  info: "text-ink-soft",
  success: "text-leaf",
  error: "text-clay-deep",
} as const;

export default function ActionBar({
  canSave,
  canSubmit,
  isSubmitted,
  hasPassphrase,
  busy,
  message,
  onSaveDraft,
}: Props) {
  const working = busy !== null;

  return (
    <div className="sticky bottom-0 z-10 -mx-3 mt-2 border-t border-line bg-paper/85 px-3 pt-3 sm:-mx-4 sm:px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur">
      <div className="mx-auto max-w-md">
        <p
          aria-live="polite"
          role={message?.tone === "error" ? "alert" : undefined}
          className={`mb-2 min-h-8 text-center text-[11px] leading-4 ${
            message
              ? TONE_CLASS[message.tone]
              : hasPassphrase
                ? "text-ink-muted"
                : "text-clay-deep"
          }`}
        >
          {message?.text ??
            (hasPassphrase
              ? "內容會先在這台裝置上以 AES-GCM 加密，再暫存或送出"
              : "尚未設定共用解密密碼——到「設定」分頁設定後才能加密")}
        </p>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onSaveDraft}
            disabled={!canSave || working}
            className="flex-1 rounded-2xl border border-line bg-card px-4 py-3 text-sm font-medium text-ink-soft transition-colors hover:bg-paper-deep disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-card"
          >
            {busy === "draft" ? "加密中…" : "暫存"}
          </button>
          <button
            type="submit"
            disabled={!canSubmit || working}
            className="flex-[1.6] rounded-2xl bg-clay px-4 py-3 text-sm font-semibold text-white shadow-soft transition-colors hover:bg-clay-deep disabled:cursor-not-allowed disabled:bg-clay/35 disabled:shadow-none"
          >
            {busy === "submitted"
              ? "加密中…"
              : isSubmitted
                ? "已送出 · 再送一次"
                : "加密並送出"}
          </button>
        </div>
      </div>
    </div>
  );
}
