import type { DayStatus } from "@/lib/types";

const STATUS_STYLE: Record<DayStatus, { label: string; className: string }> = {
  empty: {
    label: "尚未填寫",
    className: "bg-paper-deep text-ink-muted ring-line",
  },
  draft: {
    label: "已暫存",
    className: "bg-clay-soft text-clay-deep ring-clay/20",
  },
  submitted: {
    label: "已送出",
    className: "bg-leaf-soft text-leaf ring-leaf/25",
  },
};

export default function StatusBadge({ status }: { status: DayStatus }) {
  const { label, className } = STATUS_STYLE[status];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset ${className}`}
    >
      <span
        aria-hidden
        className="size-1.5 rounded-full bg-current opacity-70"
      />
      {label}
    </span>
  );
}
