"use client";

export type ActionMessage = {
  tone: "info" | "success" | "error";
  text: string;
};

type Props = {
  /**
   * edit：還在寫，暫存與送出並排。
   * done：這一天已經送出了，只留一顆「修改這一天」——寫完就該收工，
   * 不要再擺兩顆按鈕讓人猶豫「是不是還得再按一次」。
   */
  mode: "edit" | "done";
  canSave: boolean;
  canSubmit: boolean;
  hasPassphrase: boolean;
  busy: "draft" | "submitted" | null;
  /**
   * 操作結果。刻意跟按鈕放在同一個 sticky 區塊裡：
   * 按鈕永遠看得到，訊息就不能留在頁面深處讓人以為「按了沒反應」。
   */
  message: ActionMessage | null;
  onSaveDraft: () => void;
  onEdit: () => void;
};

const TONE_CLASS = {
  info: "text-ink-soft",
  success: "text-leaf",
  error: "text-clay-deep",
} as const;

export default function ActionBar({
  mode,
  canSave,
  canSubmit,
  hasPassphrase,
  busy,
  message,
  onSaveDraft,
  onEdit,
}: Props) {
  const working = busy !== null;

  const hint = !hasPassphrase
    ? "尚未設定共用解密密碼——到「設定」分頁設定後才能加密"
    : mode === "done"
      ? "這一天已經加密收好了，要補寫再按「修改這一天」"
      : "內容會先在這台裝置上以 AES-GCM 加密，再暫存或送出";

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
          {message?.text ?? hint}
        </p>

        {mode === "done" ? (
          <button
            type="button"
            onClick={onEdit}
            className="w-full rounded-2xl border border-line bg-card px-4 py-3 text-sm font-medium text-ink-soft transition-colors hover:bg-paper-deep"
          >
            修改這一天
          </button>
        ) : (
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
              {busy === "submitted" ? "加密中…" : "加密並送出"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
