"use client";

import { useEffect, useState } from "react";

import BackupPanel from "@/components/BackupPanel";
import CalendarView from "@/components/CalendarView";
import { usePassphrase } from "@/components/PassphraseProvider";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { collectEntries, type CollectedEntry } from "@/lib/backup";
import { monthOf, monthRange, shiftMonth } from "@/lib/calendar";
import { decryptJournal } from "@/lib/crypto";
import { formatFullDate, todayKey } from "@/lib/date";
import { describeSyncError } from "@/lib/supabase/errors";
import { pullEntries, pullEntryDates } from "@/lib/supabase/workspace";
import type { JournalPayload, LocalCipher } from "@/lib/types";

type Props = {
  /** 這台裝置上每一天的加密結果 */
  localCiphers: LocalCipher[];
  /** 父層每次成功加密／同步就 +1 */
  refreshToken: number;
  /** 把編輯器切到某一天 */
  onJumpToDate: (dateKey: string) => void;
};

type DetailItem = {
  entry: CollectedEntry;
  payload: JournalPayload | null;
};

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

export default function HistoryPanel({
  localCiphers,
  refreshToken,
  onJumpToDate,
}: Props) {
  const { workspace } = useWorkspace();
  const { passphrase, version } = usePassphrase();

  const [open, setOpen] = useState(false);
  const [today] = useState(todayKey);
  const [view, setView] = useState(() => monthOf(today));
  const [selected, setSelected] = useState<string | null>(null);

  const workspaceId = workspace?.id ?? null;
  const { from, to } = monthRange(view.year, view.month);

  // --- 這個月哪幾天有紀錄 -------------------------------------------------
  const marksKey = `${workspaceId}|${from}|${refreshToken}`;
  const [remoteMarks, setRemoteMarks] = useState<{
    key: string;
    counts: Record<string, number>;
    error: string | null;
  }>({ key: "", counts: {}, error: null });

  useEffect(() => {
    if (!open || !workspaceId) return;

    let cancelled = false;
    void (async () => {
      try {
        const rows = await pullEntryDates(workspaceId, from, to);
        const counts: Record<string, number> = {};
        for (const row of rows) {
          counts[row.entryDate] = (counts[row.entryDate] ?? 0) + 1;
        }
        if (!cancelled) setRemoteMarks({ key: marksKey, counts, error: null });
      } catch (caught) {
        if (!cancelled) {
          setRemoteMarks({
            key: marksKey,
            counts: {},
            error: describeSyncError(caught),
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, workspaceId, from, to, marksKey]);

  const marksSettled = !workspaceId || remoteMarks.key === marksKey;

  // 本機的紀錄一定算進來（離線模式下這就是全部）。
  const marks: Record<string, number> = { ...remoteMarks.counts };
  for (const cipher of localCiphers) {
    // 已經同步上去的那一天不要重複計數：本機只在「遠端還沒有我的那筆」時 +1
    marks[cipher.date] = Math.max(marks[cipher.date] ?? 0, 1);
  }
  const markedDays = Object.values(marks).filter((count) => count > 0).length;

  // --- 點某一天：抓回來、解密 --------------------------------------------
  const detailKey = `${workspaceId}|${selected}|${version}|${refreshToken}`;
  const [detail, setDetail] = useState<{
    key: string;
    items: DetailItem[];
    error: string | null;
  }>({ key: "", items: [], error: null });

  useEffect(() => {
    if (!selected) return;

    let cancelled = false;
    void (async () => {
      try {
        const remote = workspaceId
          ? await pullEntries(workspaceId, selected)
          : [];

        const entries = collectEntries({
          local: localCiphers.filter((cipher) => cipher.date === selected),
          workspace: remote.map((row) => ({
            date: row.entryDate,
            authorLabel: row.authorLabel,
            isMine: row.isMine,
            savedAt: row.updatedAt,
            ciphertext: row.ciphertext,
          })),
          myLabel: workspace?.myLabel || "我",
        });

        const items: DetailItem[] = [];
        for (const entry of entries) {
          items.push({
            entry,
            payload: passphrase
              ? await decryptJournal(entry.ciphertext, passphrase).catch(
                  () => null,
                )
              : null,
          });
        }

        if (!cancelled) setDetail({ key: detailKey, items, error: null });
      } catch (caught) {
        if (!cancelled) {
          setDetail({
            key: detailKey,
            items: [],
            error: describeSyncError(caught),
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // localCiphers / workspace 只是讀取當下的值，變動時由 refreshToken 帶動重讀
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailKey, selected, workspaceId, passphrase]);

  const detailSettled = detail.key === detailKey;

  const handleSelect = (dateKey: string) => {
    setSelected(dateKey);
    const month = monthOf(dateKey);
    if (month.year !== view.year || month.month !== view.month) setView(month);
  };

  const canGoForward = (() => {
    const next = shiftMonth(view.year, view.month, 1);
    const limit = monthOf(today);
    return (
      next.year < limit.year ||
      (next.year === limit.year && next.month <= limit.month)
    );
  })();

  return (
    <section
      aria-label="歷史回顧"
      className="rounded-3xl border border-line bg-card shadow-soft"
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 p-4 text-left"
      >
        <span>
          <span className="text-base font-medium text-ink">歷史回顧</span>
          <span className="mt-1 block text-xs text-ink-muted">
            {markedDays > 0
              ? `月曆上有 ${markedDays} 天留下紀錄`
              : "用月曆回頭看，或匯出完整備份"}
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
          <CalendarView
            year={view.year}
            month={view.month}
            todayKey={today}
            selected={selected}
            marks={marks}
            loading={!marksSettled}
            canGoForward={canGoForward}
            onSelect={handleSelect}
            onShiftMonth={(delta) =>
              setView((current) =>
                shiftMonth(current.year, current.month, delta),
              )
            }
          />

          {remoteMarks.error && (
            <p
              role="alert"
              className="rounded-2xl bg-clay-soft px-3 py-2 text-xs leading-relaxed text-clay-deep"
            >
              {remoteMarks.error}
            </p>
          )}

          {selected && (
            <div className="border-t border-line pt-4">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-medium text-ink">
                  {formatFullDate(selected)}
                </h3>
                <button
                  type="button"
                  onClick={() => onJumpToDate(selected)}
                  className="shrink-0 text-xs text-clay-deep underline decoration-clay/40 underline-offset-4 transition-colors hover:decoration-clay"
                >
                  切到這一天
                </button>
              </div>

              {!detailSettled && (
                <p className="mt-2 text-xs text-ink-muted" aria-live="polite">
                  解密中…
                </p>
              )}

              {detailSettled && detail.error && (
                <p
                  role="alert"
                  className="mt-2 rounded-2xl bg-clay-soft px-3 py-2 text-xs leading-relaxed text-clay-deep"
                >
                  {detail.error}
                </p>
              )}

              {detailSettled && !detail.error && detail.items.length === 0 && (
                <p className="mt-2 text-xs text-ink-muted">
                  這一天沒有紀錄。
                </p>
              )}

              <ul className="mt-2 space-y-3">
                {detailSettled &&
                  detail.items.map(({ entry, payload }) => (
                    <li
                      key={`${entry.date}|${entry.authorLabel}|${entry.source}`}
                      className="rounded-2xl border border-line bg-paper p-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-ink">
                          {entry.authorLabel}
                          {entry.isMine && (
                            <span className="ml-1 text-xs text-ink-muted">
                              （你）
                            </span>
                          )}
                        </p>
                        <span className="text-xs text-ink-muted">
                          {formatTime(entry.savedAt)}
                          {entry.source === "local" && " · 未同步"}
                        </span>
                      </div>

                      {payload ? (
                        <>
                          <ol className="mt-2 list-decimal space-y-1 pl-5 text-[13px] leading-relaxed text-ink">
                            {payload.items.map((item, index) => (
                              <li key={index}>{item}</li>
                            ))}
                          </ol>
                          {payload.notes && (
                            <p className="mt-2 border-t border-line pt-2 text-[13px] leading-relaxed whitespace-pre-wrap text-ink-soft">
                              {payload.notes}
                            </p>
                          )}
                        </>
                      ) : (
                        <p className="mt-2 text-xs leading-relaxed text-clay-deep">
                          {passphrase
                            ? "用目前的密碼解不開這則——當時可能用的是另一組共用密碼。"
                            : "請先在上方輸入共用密碼，才能解密回顧。"}
                        </p>
                      )}
                    </li>
                  ))}
              </ul>
            </div>
          )}

          <BackupPanel localCiphers={localCiphers} />
        </div>
      )}
    </section>
  );
}
