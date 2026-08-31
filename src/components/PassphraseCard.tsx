"use client";

import { useState } from "react";

import {
  MIN_PASSPHRASE_LENGTH,
  usePassphrase,
} from "@/components/PassphraseProvider";
import { CRYPTO_INFO } from "@/lib/crypto";

const INPUT_CLASS =
  "w-full rounded-2xl border border-line bg-paper px-4 py-2.5 text-[15px] text-ink outline-none transition placeholder:text-ink-muted/70 focus:border-clay focus:bg-card focus:ring-2 focus:ring-clay/20";

function LockIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 20 20" className="size-4" aria-hidden>
      <path
        d={
          open
            ? "M6.5 9V6.5a3.5 3.5 0 0 1 6.9-.8"
            : "M6.5 9V6.5a3.5 3.5 0 0 1 7 0V9"
        }
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <rect
        x="4.5"
        y="9"
        width="11"
        height="7.5"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

export default function PassphraseCard() {
  const { hasPassphrase, length, setPassphrase, clearPassphrase } =
    usePassphrase();

  const [editing, setEditing] = useState(false);
  const [first, setFirst] = useState("");
  const [second, setSecond] = useState("");
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const formOpen = editing || !hasPassphrase;

  const resetForm = () => {
    setFirst("");
    setSecond("");
    setReveal(false);
    setError(null);
  };

  const handleSave = () => {
    if (first.trim() === "") {
      setError("請輸入密碼。");
      return;
    }
    if (first.length < MIN_PASSPHRASE_LENGTH) {
      setError(`密碼至少要 ${MIN_PASSPHRASE_LENGTH} 個字。`);
      return;
    }
    if (first !== second) {
      setError("兩次輸入的密碼不一致。");
      return;
    }
    setPassphrase(first);
    setEditing(false);
    resetForm();
  };

  const handleClear = () => {
    clearPassphrase();
    setEditing(false);
    resetForm();
  };

  return (
    <section
      aria-label="共用解密密碼"
      className="rounded-3xl border border-line bg-card p-4 shadow-soft"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-base font-medium text-ink">
            <span className={hasPassphrase ? "text-leaf" : "text-ink-muted"}>
              <LockIcon open={!hasPassphrase} />
            </span>
            共用解密密碼
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">
            {hasPassphrase
              ? `內容會用 ${CRYPTO_INFO.algorithm} 在這台裝置上加密後才離開。`
              : "設定密碼後，日記才會在暫存或送出前完成加密。"}
          </p>
        </div>

        {hasPassphrase && !editing && (
          <span className="shrink-0 rounded-full bg-leaf-soft px-3 py-1 text-xs font-medium text-leaf ring-1 ring-leaf/25 ring-inset">
            已設定
          </span>
        )}
      </div>

      {formOpen ? (
        <div className="mt-4 space-y-3">
          <div>
            <label className="text-xs text-ink-soft" htmlFor="passphrase">
              密碼
            </label>
            <input
              id="passphrase"
              type={reveal ? "text" : "password"}
              value={first}
              autoComplete="new-password"
              placeholder={`至少 ${MIN_PASSPHRASE_LENGTH} 個字`}
              onChange={(event) => {
                setFirst(event.target.value);
                setError(null);
              }}
              className={`mt-1 ${INPUT_CLASS}`}
            />
          </div>

          <div>
            <label
              className="text-xs text-ink-soft"
              htmlFor="passphrase-confirm"
            >
              再次輸入
            </label>
            <input
              id="passphrase-confirm"
              type={reveal ? "text" : "password"}
              value={second}
              autoComplete="new-password"
              placeholder="確認密碼"
              onChange={(event) => {
                setSecond(event.target.value);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleSave();
                }
              }}
              className={`mt-1 ${INPUT_CLASS}`}
            />
          </div>

          <label className="flex items-center gap-2 text-xs text-ink-soft">
            <input
              type="checkbox"
              checked={reveal}
              onChange={(event) => setReveal(event.target.checked)}
              className="size-4 accent-clay"
            />
            顯示密碼
          </label>

          {error && (
            <p role="alert" className="text-xs text-clay-deep">
              {error}
            </p>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleSave}
              className="flex-1 rounded-2xl bg-clay px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-clay-deep"
            >
              {hasPassphrase ? "更新密碼" : "設定密碼"}
            </button>
            {hasPassphrase && (
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  resetForm();
                }}
                className="rounded-2xl border border-line px-4 py-2.5 text-sm font-medium text-ink-soft transition-colors hover:bg-paper-deep"
              >
                取消
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-4 flex items-center justify-between gap-3">
          <p
            className="truncate text-sm tracking-[0.3em] text-ink-soft"
            aria-label={`密碼共 ${length} 個字`}
          >
            {"•".repeat(Math.min(length, 12))}
          </p>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => {
                resetForm();
                setEditing(true);
              }}
              className="rounded-full border border-line px-3 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:bg-paper-deep"
            >
              更改
            </button>
            <button
              type="button"
              onClick={handleClear}
              className="rounded-full px-3 py-1.5 text-xs font-medium text-clay-deep underline decoration-clay/40 underline-offset-4 transition-colors hover:decoration-clay"
            >
              清除
            </button>
          </div>
        </div>
      )}

      <p className="mt-3 border-t border-line pt-3 text-[11px] leading-relaxed text-ink-muted">
        金鑰推導：{CRYPTO_INFO.kdf}。密碼只留在這個分頁的記憶體中，不會被儲存或送出；
        重新整理後要再輸入一次，忘記密碼將無法還原已加密的內容。
      </p>
    </section>
  );
}
