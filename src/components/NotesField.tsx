"use client";

type Props = {
  value: string;
  maxLength: number;
  onChange: (value: string) => void;
};

export default function NotesField({ value, maxLength, onChange }: Props) {
  return (
    <section
      aria-label="其他"
      className="rounded-3xl border border-line bg-card p-4 shadow-soft"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-base font-medium text-ink">
          其他 <span className="text-sm text-ink-muted">Notes</span>
        </h2>
        <span className="text-xs text-ink-muted">
          {value.length} / {maxLength}
        </span>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-ink-muted">
        想多說一點的、還沒整理好的，都可以放這裡。
      </p>

      <label className="sr-only" htmlFor="notes">
        其他想記下的內容
      </label>
      <textarea
        id="notes"
        rows={7}
        value={value}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        placeholder="今天的天氣、一段對話、一個念頭…"
        className="mt-3 min-h-40 w-full resize-y rounded-2xl border border-line bg-paper px-4 py-3 text-[15px] leading-7 text-ink outline-none transition placeholder:text-ink-muted/70 focus:border-clay focus:bg-card focus:ring-2 focus:ring-clay/20"
      />
    </section>
  );
}
