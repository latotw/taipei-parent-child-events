"use client";

import { useState } from "react";

/**
 * 需要二次確認的動作。
 *
 * 刻意不用 window.confirm：它無法配合版面、在某些嵌入情境會被瀏覽器擋掉，
 * 而且會把整個頁面鎖住。這裡改成就地展開一行問句 + 取消／確定，
 * 使用者的視線不用離開他剛才按的位置。
 */
type Props = {
  /** 平常顯示的文字 */
  label: string;
  /** 展開後的問句 */
  question: string;
  /** 展開後的確定按鈕文字 */
  confirmLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
  /** link：文字連結樣式（次要動作）；outline：有框的按鈕 */
  variant?: "link" | "outline";
  /** 整行撐滿（給 outline 用） */
  block?: boolean;
};

const TRIGGER = {
  link: "text-xs text-clay-deep underline decoration-clay/40 underline-offset-4 transition-colors hover:decoration-clay disabled:opacity-50",
  outline:
    "rounded-2xl border border-clay/40 px-4 py-2.5 text-sm font-medium text-clay-deep transition-colors hover:bg-clay-soft/60 disabled:opacity-50",
} as const;

export default function ConfirmButton({
  label,
  question,
  confirmLabel,
  onConfirm,
  disabled = false,
  variant = "link",
  block = false,
}: Props) {
  const [armed, setArmed] = useState(false);

  if (!armed) {
    return (
      <button
        type="button"
        onClick={() => setArmed(true)}
        disabled={disabled}
        className={`${TRIGGER[variant]} ${block ? "w-full" : ""}`}
      >
        {label}
      </button>
    );
  }

  return (
    <div
      className={`rounded-2xl bg-clay-soft p-3 ${block ? "w-full" : ""}`}
      role="group"
      aria-label={question}
    >
      <p className="text-xs leading-relaxed text-clay-deep">{question}</p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => {
            setArmed(false);
            onConfirm();
          }}
          className="rounded-full bg-clay px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-clay-deep"
        >
          {confirmLabel}
        </button>
        <button
          type="button"
          onClick={() => setArmed(false)}
          className="rounded-full border border-line bg-card px-3 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:bg-paper"
        >
          取消
        </button>
      </div>
    </div>
  );
}
