"use client";

type Props = {
  canSave: boolean;
  canSubmit: boolean;
  isSubmitted: boolean;
  onSaveDraft: () => void;
};

export default function ActionBar({
  canSave,
  canSubmit,
  isSubmitted,
  onSaveDraft,
}: Props) {
  return (
    <div className="sticky bottom-0 z-10 -mx-4 mt-2 border-t border-line bg-paper/85 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur">
      <div className="mx-auto flex max-w-md gap-3">
        <button
          type="button"
          onClick={onSaveDraft}
          disabled={!canSave}
          className="flex-1 rounded-2xl border border-line bg-card px-4 py-3 text-sm font-medium text-ink-soft transition-colors hover:bg-paper-deep disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-card"
        >
          暫存
        </button>
        <button
          type="submit"
          disabled={!canSubmit}
          className="flex-[1.6] rounded-2xl bg-clay px-4 py-3 text-sm font-semibold text-white shadow-soft transition-colors hover:bg-clay-deep disabled:cursor-not-allowed disabled:bg-clay/35 disabled:shadow-none"
        >
          {isSubmitted ? "已送出 · 再送一次" : "送出"}
        </button>
      </div>
    </div>
  );
}
