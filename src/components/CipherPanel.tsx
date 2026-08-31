"use client";

import { useState } from "react";

import { usePassphrase } from "@/components/PassphraseProvider";
import { formatFullDate } from "@/lib/date";
import { decryptJournal, describeCryptoError } from "@/lib/crypto";
import type { CipherRecord, JournalPayload } from "@/lib/types";

type Props = {
  cipher: CipherRecord | null;
  onRestore: (payload: JournalPayload) => void;
};

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

export default function CipherPanel({ cipher, onRestore }: Props) {
  const { passphrase, hasPassphrase } = usePassphrase();

  // 預設收起。這是進階工具，不該每次加密完就自己展開來搶注意力。
  const [open, setOpen] = useState(false);
  const [envelope, setEnvelope] = useState(cipher?.text ?? "");
  const [attempt, setAttempt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<JournalPayload | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(envelope);
      setCopied("已複製加密字串。");
    } catch {
      setCopied("這個瀏覽器不允許自動複製，請手動選取。");
    }
  };

  const handleDecrypt = async () => {
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      // 密碼為空、字串為空、格式錯誤、密碼錯誤都由 decryptJournal 丟出帶訊息的 CryptoError。
      setResult(await decryptJournal(envelope, attempt));
    } catch (caught) {
      setError(describeCryptoError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-label="加密字串與單筆還原"
      className="rounded-3xl border border-line bg-card shadow-soft"
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 p-4 text-left"
      >
        <span>
          <span className="text-base font-medium text-ink">
            加密字串與單筆還原
          </span>
          <span className="mt-1 block text-xs text-ink-muted">
            {cipher
              ? `${formatTime(cipher.savedAt)} 加密 · ${cipher.text.length} 字元${
                  cipher.stale ? " · 之後又改過內容" : ""
                }`
              : "貼上備份裡的加密字串，用密碼解回內容"}
          </span>
        </span>
        <svg
          viewBox="0 0 20 20"
          className={`size-5 shrink-0 text-ink-muted transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        >
          <path
            d="M5.5 8 10 12.5 14.5 8"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div className="space-y-4 border-t border-line p-4">
          <p className="text-xs leading-relaxed text-ink-muted">
            一般使用不需要打開這裡。它的用途有兩個：確認內容真的被加密了，
            以及把備份檔（或另一台裝置）裡的單一加密字串解回內容。
          </p>

          {cipher?.stale && (
            <p className="rounded-2xl bg-clay-soft px-3 py-2 text-xs leading-relaxed text-clay-deep">
              表單內容在這次加密之後又改過了，請重新暫存或送出以取得最新的加密字串。
            </p>
          )}

          <div>
            <label
              className="text-xs text-ink-soft"
              htmlFor="cipher-envelope"
            >
              加密字串（Ciphertext）
            </label>
            <textarea
              id="cipher-envelope"
              rows={4}
              value={envelope}
              onChange={(event) => {
                setEnvelope(event.target.value);
                setError(null);
                setResult(null);
                setCopied(null);
              }}
              spellCheck={false}
              placeholder="GJ1.600000.…（也可以貼上別處產生的加密字串來解密）"
              className="mt-1 min-h-24 w-full resize-y rounded-2xl border border-line bg-paper px-3 py-2.5 font-mono text-[11px] leading-relaxed break-all text-ink-soft outline-none transition placeholder:text-ink-muted focus:border-clay focus:bg-card focus:ring-2 focus:ring-clay/20"
            />
            <div className="mt-2 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={handleCopy}
                disabled={envelope === ""}
                className="rounded-full border border-line px-3 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:bg-paper-deep disabled:opacity-40 disabled:hover:bg-transparent"
              >
                複製
              </button>
              {copied && (
                <p className="text-xs text-ink-muted" aria-live="polite">
                  {copied}
                </p>
              )}
            </div>
          </div>

          <div className="border-t border-line pt-4">
            <label className="text-xs text-ink-soft" htmlFor="decrypt-pass">
              用密碼解回內容
            </label>
            <div className="mt-1 flex gap-2">
              <input
                id="decrypt-pass"
                type="password"
                value={attempt}
                autoComplete="off"
                placeholder="輸入解密密碼"
                onChange={(event) => {
                  setAttempt(event.target.value);
                  setError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handleDecrypt();
                  }
                }}
                className="min-w-0 flex-1 rounded-2xl border border-line bg-paper px-4 py-2.5 text-[15px] text-ink outline-none transition placeholder:text-ink-muted focus:border-clay focus:bg-card focus:ring-2 focus:ring-clay/20"
              />
              <button
                type="button"
                onClick={handleDecrypt}
                disabled={busy}
                className="shrink-0 rounded-2xl border border-clay/40 px-4 py-2.5 text-sm font-medium text-clay-deep transition-colors hover:bg-clay-soft/60 disabled:opacity-50"
              >
                {busy ? "解密中…" : "解密"}
              </button>
            </div>

            {hasPassphrase && (
              <button
                type="button"
                onClick={() => {
                  setAttempt(passphrase ?? "");
                  setError(null);
                }}
                className="mt-2 text-xs text-ink-muted underline decoration-line underline-offset-4 transition-colors hover:text-clay-deep"
              >
                帶入上面設定的共用密碼
              </button>
            )}

            {error && (
              <p
                role="alert"
                className="mt-3 rounded-2xl bg-clay-soft px-3 py-2 text-xs leading-relaxed text-clay-deep"
              >
                {error}
              </p>
            )}

            {result && (
              <div className="mt-3 rounded-2xl bg-leaf-soft/70 p-3">
                <p className="text-xs font-medium text-leaf">
                  解密成功 · {formatFullDate(result.date)}
                </p>
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-[13px] leading-relaxed text-ink">
                  {result.items.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ol>
                {result.notes && (
                  <p className="mt-2 border-t border-leaf/20 pt-2 text-[13px] leading-relaxed whitespace-pre-wrap text-ink-soft">
                    {result.notes}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => onRestore(result)}
                  className="mt-3 rounded-full border border-leaf/30 bg-card px-3 py-1.5 text-xs font-medium text-leaf transition-colors hover:bg-leaf-soft"
                >
                  填回表單
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
