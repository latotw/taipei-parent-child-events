"use client";

type Props = {
  canSave: boolean;
  canSubmit: boolean;
  isSubmitted: boolean;
  hasPassphrase: boolean;
  busy: "draft" | "submitted" | null;
  onSaveDraft: () => void;
};

export default function ActionBar({
  canSave,
  canSubmit,
  isSubmitted,
  hasPassphrase,
  busy,
  onSaveDraft,
}: Props) {
  const working = busy !== null;

  return (
    <div className="sticky bottom-0 z-10 -mx-4 mt-2 border-t border-line bg-paper/85 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur">
      <div className="mx-auto max-w-md">
        <p
          className={`mb-2 text-center text-[11px] ${
            hasPassphrase ? "text-ink-muted" : "text-clay-deep"
          }`}
        >
          {hasPassphrase
            ? "內容會先在這台裝置上以 AES-GCM 加密，再暫存或送出"
            : "尚未設定共用解密密碼，無法加密"}
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
