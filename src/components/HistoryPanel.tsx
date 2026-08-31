"use client";

import { useEffect, useState } from "react";

import BackupPanel from "@/components/BackupPanel";
import CalendarView from "@/components/CalendarView";
import EntryList, { type EntryListItem } from "@/components/EntryList";
import { usePassphrase } from "@/components/PassphraseProvider";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { collectEntries } from "@/lib/backup";
import { monthOf, monthRange, shiftMonth } from "@/lib/calendar";
import { decryptJournal } from "@/lib/crypto";
import { formatFullDate, todayKey } from "@/lib/date";
import { describeSyncError } from "@/lib/supabase/errors";
import { pullEntries, pullEntryDates } from "@/lib/supabase/workspace";
import type { LocalCipher } from "@/lib/types";

type Props = {
  /** 這台裝置上每一天的加密結果 */
  localCiphers: LocalCipher[];
  /** 父層每次成功加密／同步就 +1 */
  refreshToken: number;
  /** 分頁沒被選到時不用去讀 */
  active: boolean;
  /** 把編輯器切到某一天 */
  onJumpToDate: (dateKey: string) => void;
  /** 刪掉某一天自己寫的紀錄 */
  onDelete: (dateKey: string) => void;
};

export default function HistoryPanel({
  localCiphers,
  refreshToken,
  active,
  onJumpToDate,
  onDelete,
}: Props) {
  const { workspace } = useWorkspace();
  const { passphrase, version } = usePassphrase();

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
    if (!active || !workspaceId) return;

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
  }, [active, workspaceId, from, to, marksKey]);

  const marksSettled = !workspaceId || remoteMarks.key === marksKey;

  // 本機的紀錄一定算進來（離線模式下這就是全部）。
  const marks: Record<string, number> = { ...remoteMarks.counts };
  for (const cipher of localCiphers) {
    marks[cipher.date] = Math.max(marks[cipher.date] ?? 0, 1);
  }
  const markedDays = Object.values(marks).filter((count) => count > 0).length;

  // --- 點某一天：抓回來、解密 --------------------------------------------
  const detailKey = `${workspaceId}|${selected}|${version}|${refreshToken}`;
  const [detail, setDetail] = useState<{
    key: string;
    items: EntryListItem[];
    error: string | null;
  }>({ key: "", items: [], error: null });

  useEffect(() => {
    if (!active || !selected) return;

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

        const items: EntryListItem[] = [];
        for (const entry of entries) {
          items.push({
            id: `${entry.date}|${entry.authorLabel}|${entry.source}`,
            authorLabel: entry.authorLabel,
            isMine: entry.isMine,
            timestamp: entry.savedAt,
            note: entry.source === "local" ? "未同步" : undefined,
            deletable: entry.isMine,
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
  }, [active, detailKey, selected, workspaceId, passphrase]);

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
    <div className="space-y-4">
      <section
        aria-label="月曆"
        className="rounded-3xl border border-line bg-card p-3 shadow-soft sm:p-4"
      >
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h2 className="text-base font-medium text-ink">回顧月曆</h2>
          <span className="text-xs text-ink-muted">
            {markedDays > 0 ? `${markedDays} 天有紀錄` : "還沒有紀錄"}
          </span>
        </div>

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
            setView((current) => shiftMonth(current.year, current.month, delta))
          }
        />

        {remoteMarks.error && (
          <p
            role="alert"
            className="mt-3 rounded-2xl bg-clay-soft px-3 py-2 text-xs leading-relaxed text-clay-deep"
          >
            {remoteMarks.error}
          </p>
        )}

        {!selected && (
          <p className="mt-3 border-t border-line pt-3 text-xs leading-relaxed text-ink-muted">
            點一個日期，就會用共用密碼把那天的紀錄解開來看。
          </p>
        )}
      </section>

      {selected && (
        <section
          aria-label="選到的日期"
          className="rounded-3xl border border-line bg-card p-4 shadow-soft"
        >
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h2 className="text-base font-medium text-ink">
              {formatFullDate(selected)}
            </h2>
            <button
              type="button"
              onClick={() => onJumpToDate(selected)}
              className="shrink-0 text-xs text-clay-deep underline decoration-clay/40 underline-offset-4 transition-colors hover:decoration-clay"
            >
              切到這一天
            </button>
          </div>

          <EntryList
            items={detailSettled ? detail.items : null}
            loading={!detailSettled}
            error={detailSettled ? detail.error : null}
            emptyText="這一天沒有紀錄。"
            hasPassphrase={passphrase !== null}
            onDelete={() => onDelete(selected)}
          />
        </section>
      )}

      <section
        aria-label="資料匯出"
        className="rounded-3xl border border-line bg-card p-4 shadow-soft"
      >
        <BackupPanel localCiphers={localCiphers} />
      </section>
    </div>
  );
}
