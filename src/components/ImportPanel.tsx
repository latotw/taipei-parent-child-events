"use client";

import { type ChangeEvent, useState } from "react";

import ConfirmButton from "@/components/ConfirmButton";
import { usePassphrase } from "@/components/PassphraseProvider";
import { useWorkspace } from "@/components/WorkspaceProvider";
import {
  BackupParseError,
  parseBackup,
  type ImportCandidate,
  type ParsedBackup,
} from "@/lib/backup";
import { decryptJournal, encryptJournal } from "@/lib/crypto";
import { formatFullDate } from "@/lib/date";
import { describeSyncError } from "@/lib/supabase/errors";
import { pullEntryDates } from "@/lib/supabase/workspace";
import type { ImportedDay } from "@/lib/types";

type Props = {
  /** 這個頁面裡已經有內容的日期，會被視為衝突 */
  existingDates: string[];
  onImport: (
    days: ImportedDay[],
    options: { sync: boolean },
    onProgress: (done: number, total: number) => void,
  ) => Promise<{ applied: number; syncFailed: number }>;
};

type Plan = {
  /** 沒有撞到任何現有內容，可以直接還原 */
  fresh: ImportedDay[];
  /** 這一天已經有內容了，要使用者決定覆蓋或保留 */
  clashing: ImportedDay[];
  /** 用目前的密碼解不開的筆數（通常是備份當時用了別的密碼） */
  failed: number;
};

function shortDate(dateKey: string): string {
  return dateKey.slice(5).replace("-", "/");
}

/** 把日期清單講成人看得懂的一句話，太多就只講前幾天。 */
function listDates(days: ImportedDay[], limit = 4): string {
  const shown = days.slice(0, limit).map((day) => shortDate(day.date));
  return days.length > limit
    ? `${shown.join("、")} 等 ${days.length} 天`
    : shown.join("、");
}

/**
 * 資料匯入（還原備份）。
 *
 * 匯出一直都是一個按鈕，匯入卻只能到「進階」面板一天一則貼回去——
 * 那不是還原功能，是懲罰。這裡把整份備份一次讀回來。
 *
 * 兩種備份都收：加密備份用密碼解開，明文備份用現在的密碼重新加密，
 * 兩者最後都以 envelope 的形式回到 app，跟平常寫完的那一天沒有差別。
 */
export default function ImportPanel({ existingDates, onImport }: Props) {
  const { passphrase, hasPassphrase } = usePassphrase();
  const { workspace } = useWorkspace();

  const [file, setFile] = useState<{
    name: string;
    parsed: ParsedBackup;
  } | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [syncUp, setSyncUp] = useState(true);
  const [busy, setBusy] = useState<"planning" | "importing" | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const reset = () => {
    setPlan(null);
    setOverwrite(false);
    setError(null);
    setResult(null);
    setProgress(null);
  };

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0];
    // 清掉 input，這樣選同一個檔案第二次也會再觸發一次。
    event.target.value = "";
    if (!picked) return;

    reset();
    setFile(null);

    try {
      const parsed = parseBackup(await picked.text());
      setFile({ name: picked.name, parsed });
      if (parsed.mine.length === 0) {
        setError(
          parsed.others.length > 0
            ? "這個檔案裡沒有你自己的紀錄，只有另一半寫的——那些不會匯進你的日記。"
            : "這個備份檔裡沒有可以還原的紀錄。",
        );
      }
    } catch (caught) {
      setError(
        caught instanceof BackupParseError
          ? caught.message
          : "讀取檔案時發生問題，請再試一次。",
      );
    }
  };

  /** 把候選逐筆變成可還原的內容：加密備份要解開，明文備份要重新加密。 */
  const buildDay = async (
    candidate: ImportCandidate,
    key: string,
  ): Promise<ImportedDay | null> => {
    if (candidate.ciphertext) {
      const payload = await decryptJournal(candidate.ciphertext, key).catch(
        () => null,
      );
      if (!payload) return null;
      return {
        date: candidate.date,
        items: payload.items,
        notes: payload.notes,
        ciphertext: candidate.ciphertext,
        savedAt: candidate.savedAt,
      };
    }

    if (!candidate.plain) return null;
    // 明文備份沒有 envelope，用現在的密碼補上一份——app 裡只放加密字串。
    const ciphertext = await encryptJournal(
      {
        date: candidate.date,
        items: candidate.plain.items,
        notes: candidate.plain.notes,
        savedAt: candidate.savedAt,
      },
      key,
    ).catch(() => null);
    if (!ciphertext) return null;
    return {
      date: candidate.date,
      items: candidate.plain.items,
      notes: candidate.plain.notes,
      ciphertext,
      savedAt: candidate.savedAt,
    };
  };

  const handlePlan = async () => {
    if (!file || !passphrase || busy) return;

    setBusy("planning");
    setError(null);
    setResult(null);
    setPlan(null);

    try {
      const candidates = file.parsed.mine;

      /**
       * 衝突不只看這個頁面——Workspace 上可能已經有更新的紀錄，
       * 而還原會 upsert 蓋掉那一天。所以先問一次遠端有哪幾天是我寫的。
       */
      const clashDates = new Set(existingDates);
      if (workspace) {
        const dates = candidates.map((candidate) => candidate.date).sort();
        const rows = await pullEntryDates(
          workspace.id,
          dates[0],
          dates[dates.length - 1],
        );
        for (const row of rows) {
          if (row.isMine) clashDates.add(row.entryDate);
        }
      }

      const fresh: ImportedDay[] = [];
      const clashing: ImportedDay[] = [];
      let failed = 0;

      // 每筆 envelope 都有自己的 salt，所以要各跑一次 PBKDF2——逐筆做並回報進度。
      for (const [index, candidate] of candidates.entries()) {
        setProgress({ done: index, total: candidates.length });
        const day = await buildDay(candidate, passphrase);
        if (!day) {
          failed += 1;
          continue;
        }
        (clashDates.has(day.date) ? clashing : fresh).push(day);
      }

      setPlan({ fresh, clashing, failed });
      if (fresh.length === 0 && clashing.length === 0) {
        setError(
          failed > 0
            ? `${failed} 筆都解不開。這份備份很可能是用另一組密碼加密的——請到「設定」分頁改成當時那組密碼再試。`
            : "沒有可以還原的紀錄。",
        );
      }
    } catch (caught) {
      setError(describeSyncError(caught));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const handleImport = async () => {
    if (!plan || busy) return;

    const days = overwrite ? [...plan.fresh, ...plan.clashing] : plan.fresh;
    if (days.length === 0) return;

    setBusy("importing");
    setError(null);
    setResult(null);

    try {
      const sync = syncUp && workspace !== null;
      const outcome = await onImport(days, { sync }, (done, total) =>
        setProgress({ done, total }),
      );

      const parts = [`已還原 ${outcome.applied} 天的紀錄`];
      if (sync) {
        parts.push(
          outcome.syncFailed > 0
            ? `其中 ${outcome.syncFailed} 天同步失敗，只留在這台裝置`
            : "並已同步到 Workspace",
        );
      }
      if (!overwrite && plan.clashing.length > 0) {
        parts.push(`保留了現有的 ${plan.clashing.length} 天沒有覆蓋`);
      }
      if (plan.failed > 0) {
        parts.push(`${plan.failed} 筆解不開，沒有還原`);
      }
      setResult(`${parts.join("；")}。`);
      setPlan(null);
      setFile(null);
    } catch (caught) {
      setError(describeSyncError(caught));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const readyCount = plan
    ? plan.fresh.length + (overwrite ? plan.clashing.length : 0)
    : 0;

  return (
    <div>
      <h2 className="text-base font-medium text-ink">資料匯入（還原備份）</h2>
      <p className="mt-1 text-xs leading-relaxed text-ink-muted">
        把之前下載的備份檔讀回來。加密備份與明文備份都可以，
        兩種都需要當初那組共用密碼。
      </p>

      {/*
        沒有 Workspace 時，還原的內容只活在這個頁面。這件事要在使用者
        花好幾分鐘解密之前就說，不能等到還原完才講。
      */}
      {!workspace && (
        <p className="mt-2 rounded-2xl bg-paper-deep/60 px-3 py-2 text-[11px] leading-relaxed text-ink-soft">
          目前沒有連上 Workspace，還原的內容只留在這個頁面，重新整理就會消失。
          要長期保存請先到「設定」分頁設定「兩人共享」。
        </p>
      )}

      <div className="mt-3">
        <label className="sr-only" htmlFor="import-file">
          選擇備份檔
        </label>
        <input
          id="import-file"
          type="file"
          accept="application/json,.json"
          onChange={(event) => void handleFile(event)}
          disabled={busy !== null}
          className="block w-full cursor-pointer rounded-2xl border border-line bg-paper text-xs text-ink-muted file:mr-3 file:cursor-pointer file:rounded-2xl file:border-0 file:bg-card file:px-4 file:py-3 file:text-sm file:font-medium file:text-clay-deep file:transition-colors hover:file:bg-clay-soft/60 disabled:opacity-50"
        />
      </div>

      {file && (
        <div className="mt-3 rounded-2xl bg-paper-deep/60 px-3 py-2.5">
          <p className="text-xs font-medium break-all text-ink-soft">
            {file.name}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">
            {file.parsed.kind === "encrypted" ? "加密備份" : "明文備份"}
            {file.parsed.exportedAt &&
              ` · ${formatFullDate(file.parsed.exportedAt.slice(0, 10))}匯出`}
            {` · 你的紀錄 ${file.parsed.mine.length} 筆`}
            {file.parsed.others.length > 0 &&
              ` · 另一半的 ${file.parsed.others.length} 筆（不會匯入）`}
            {file.parsed.malformed > 0 &&
              ` · ${file.parsed.malformed} 筆格式不對，已跳過`}
            {file.parsed.undecryptable > 0 &&
              ` · ${file.parsed.undecryptable} 筆當初就解不開`}
          </p>
        </div>
      )}

      {file && file.parsed.mine.length > 0 && !hasPassphrase && (
        <p className="mt-3 rounded-2xl bg-clay-soft px-3 py-2 text-xs leading-relaxed text-clay-deep">
          還原需要當初那組共用密碼。請先到「設定」分頁輸入，再回來匯入。
        </p>
      )}

      {file && file.parsed.mine.length > 0 && hasPassphrase && !plan && (
        <>
          <button
            type="button"
            onClick={() => void handlePlan()}
            disabled={busy !== null}
            className="mt-3 w-full rounded-2xl border border-clay/40 px-4 py-3 text-sm font-medium text-clay-deep transition-colors hover:bg-clay-soft/60 disabled:opacity-50"
          >
            {busy === "planning"
              ? progress
                ? `處理中 ${progress.done} / ${progress.total}`
                : "處理中…"
              : file.parsed.kind === "encrypted"
                ? "用密碼解開並預覽"
                : "重新加密並預覽"}
          </button>
          {file.parsed.mine.length > 30 && busy === null && (
            <p className="mt-2 text-[11px] leading-relaxed text-ink-muted">
              每一筆都要各自推導一次金鑰（這是加密設計的代價，不是卡住了），
              {file.parsed.mine.length} 筆大約要等一兩分鐘，請別關掉分頁。
            </p>
          )}
        </>
      )}

      {plan && (plan.fresh.length > 0 || plan.clashing.length > 0) && (
        <div className="mt-3 space-y-3 rounded-2xl border border-line bg-paper/70 p-3">
          <p className="text-xs leading-relaxed text-ink-soft">
            {plan.fresh.length > 0
              ? `${plan.fresh.length} 天可以直接還原（${listDates(plan.fresh)}）。`
              : "沒有可以直接還原的日期。"}
            {plan.failed > 0 && (
              <span className="text-clay-deep">
                {" "}
                另有 {plan.failed} 筆用目前的密碼解不開，不會還原。
              </span>
            )}
          </p>

          {plan.clashing.length > 0 && (
            <fieldset className="border-t border-line pt-3">
              <legend className="text-xs leading-relaxed text-ink-soft">
                有 {plan.clashing.length} 天已經有內容了（{listDates(plan.clashing)}
                ）。要怎麼處理？
              </legend>
              <div className="mt-2 space-y-2">
                <label className="flex items-start gap-2 text-xs leading-relaxed text-ink-soft">
                  <input
                    type="radio"
                    name="import-clash"
                    checked={!overwrite}
                    onChange={() => setOverwrite(false)}
                    className="mt-0.5 size-4 shrink-0 accent-clay"
                  />
                  <span>
                    <span className="font-medium text-ink">保留現在的內容</span>
                    ——這幾天跳過不還原
                  </span>
                </label>
                <label className="flex items-start gap-2 text-xs leading-relaxed text-ink-soft">
                  <input
                    type="radio"
                    name="import-clash"
                    checked={overwrite}
                    onChange={() => setOverwrite(true)}
                    className="mt-0.5 size-4 shrink-0 accent-clay"
                  />
                  <span>
                    <span className="font-medium text-clay-deep">
                      用備份覆蓋
                    </span>
                    ——現在這幾天的內容會被取代，無法復原
                  </span>
                </label>
              </div>
            </fieldset>
          )}

          {workspace && (
            <label className="flex items-start gap-2 border-t border-line pt-3 text-xs leading-relaxed text-ink-soft">
              <input
                type="checkbox"
                checked={syncUp}
                onChange={(event) => setSyncUp(event.target.checked)}
                className="mt-0.5 size-4 shrink-0 accent-clay"
              />
              <span>
                同時同步到 Workspace
                <span className="mt-0.5 block text-[11px] text-ink-muted">
                  不同步的話，還原的內容只留在這個頁面，重新整理就會消失。
                </span>
              </span>
            </label>
          )}

          {overwrite && plan.clashing.length > 0 ? (
            <ConfirmButton
              variant="outline"
              block
              label={
                busy === "importing"
                  ? progress
                    ? `還原中 ${progress.done} / ${progress.total}`
                    : "還原中…"
                  : `還原 ${readyCount} 天（覆蓋 ${plan.clashing.length} 天）`
              }
              question={`會覆蓋 ${plan.clashing.length} 天現有的內容，無法復原。確定要還原嗎？`}
              confirmLabel="確定還原"
              onConfirm={() => void handleImport()}
              disabled={busy !== null || readyCount === 0}
            />
          ) : (
            <button
              type="button"
              onClick={() => void handleImport()}
              disabled={busy !== null || readyCount === 0}
              className="w-full rounded-2xl bg-clay px-4 py-3 text-sm font-semibold text-white shadow-soft transition-colors hover:bg-clay-deep disabled:cursor-not-allowed disabled:bg-clay/35 disabled:shadow-none"
            >
              {busy === "importing"
                ? progress
                  ? `還原中 ${progress.done} / ${progress.total}`
                  : "還原中…"
                : `還原 ${readyCount} 天的紀錄`}
            </button>
          )}
        </div>
      )}

      {result && (
        <p
          aria-live="polite"
          className="mt-3 rounded-2xl bg-leaf-soft/70 px-3 py-2 text-xs leading-relaxed text-leaf"
        >
          {result}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="mt-3 rounded-2xl bg-clay-soft px-3 py-2 text-xs leading-relaxed text-clay-deep"
        >
          {error}
        </p>
      )}
    </div>
  );
}
