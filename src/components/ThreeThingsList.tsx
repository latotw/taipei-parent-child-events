"use client";

import type { GratitudeItem } from "@/lib/types";

type Props = {
  items: GratitudeItem[];
  maxItems: number;
  onItemChange: (id: string, text: string) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
};

const PLACEHOLDERS = [
  "今天最想感謝的一件小事…",
  "有誰讓你覺得被支持？",
  "哪個瞬間讓你鬆了一口氣？",
  "還有什麼值得記下來？",
  "再多一點也沒關係 :)",
];

export default function ThreeThingsList({
  items,
  maxItems,
  onItemChange,
  onAdd,
  onRemove,
}: Props) {
  const filledCount = items.filter((item) => item.text.trim() !== "").length;
  const canRemove = items.length > 1;
  const canAdd = items.length < maxItems;

  return (
    <section
      aria-label="今天的三件事"
      className="rounded-3xl border border-line bg-card p-4 shadow-soft"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-base font-medium text-ink">今天的三件事</h2>
        <span className="text-xs text-ink-muted">
          {filledCount} / {items.length} 已寫
        </span>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-ink-muted">
        不用寫得漂亮，寫得真實就好。
      </p>

      <ul className="mt-4 space-y-3">
        {items.map((item, index) => (
          <li key={item.id} className="flex items-start gap-3">
            <span
              aria-hidden
              className="mt-2.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-clay-soft text-xs font-medium text-clay-deep"
            >
              {index + 1}
            </span>

            <div className="min-w-0 flex-1">
              <label className="sr-only" htmlFor={`gratitude-${item.id}`}>
                第 {index + 1} 件感謝的事
              </label>
              <textarea
                id={`gratitude-${item.id}`}
                rows={1}
                value={item.text}
                onChange={(event) => onItemChange(item.id, event.target.value)}
                placeholder={PLACEHOLDERS[index] ?? PLACEHOLDERS.at(-1)}
                className="min-h-11 w-full resize-none rounded-2xl border border-line bg-paper px-4 py-2.5 text-[15px] leading-relaxed text-ink outline-none transition placeholder:text-ink-muted focus:border-clay focus:bg-card focus:ring-2 focus:ring-clay/20"
              />
            </div>

            <button
              type="button"
              onClick={() => onRemove(item.id)}
              disabled={!canRemove}
              aria-label={`刪除第 ${index + 1} 件事`}
              className="mt-1.5 flex size-8 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-paper-deep hover:text-clay-deep disabled:invisible"
            >
              <svg viewBox="0 0 20 20" className="size-4" aria-hidden>
                <path
                  d="M6 6l8 8M14 6l-8 8"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={onAdd}
        disabled={!canAdd}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-clay/40 py-3 text-sm font-medium text-clay-deep transition-colors hover:bg-clay-soft/60 disabled:cursor-not-allowed disabled:border-line disabled:text-ink-muted disabled:hover:bg-transparent"
      >
        <svg viewBox="0 0 20 20" className="size-4" aria-hidden>
          <path
            d="M10 4.5v11M4.5 10h11"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
        </svg>
        {canAdd ? "再加一件" : `最多 ${maxItems} 件就好`}
      </button>
    </section>
  );
}
