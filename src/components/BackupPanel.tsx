"use client";

import { useState } from "react";

import ConfirmButton from "@/components/ConfirmButton";
import { usePassphrase } from "@/components/PassphraseProvider";
import { useWorkspace } from "@/components/WorkspaceProvider";
import {
  backupFilename,
  buildEncryptedBackup,
  buildPlainBackup,
  collectEntries,
  serializeBackup,
  type BackupKind,
  type BackupWorkspace,
  type CollectedEntry,
} from "@/lib/backup";
import { decryptJournal } from "@/lib/crypto";
import { describeSyncError } from "@/lib/supabase/errors";
import { pullAllEntries } from "@/lib/supabase/workspace";
import type { LocalCipher } from "@/lib/types";

type Props = {
  /** 這台裝置上（尚未同步或離線模式）的加密紀錄 */
  localCiphers: LocalCipher[];
};

function downloadJson(filename: string, text: string): void {
  const url = URL.createObjectURL(
    new Blob([text], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // 立刻 revoke 有機會讓下載被取消，等一個 tick 再放掉。
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function BackupPanel({ localCiphers }: Props) {
  const { workspace } = useWorkspace();
  const { passphrase } = usePassphrase();

  const [busy, setBusy] = useState<BackupKind | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** 把本機與 Workspace 的紀錄合成一份完整清單。 */
  const collectAll = async (): Promise<{
    entries: CollectedEntry[];
    workspaceInfo: BackupWorkspace | null;
  }> => {
    const remote = workspace ? await pullAllEntries(workspace.id) : [];

    return {
      entries: collectEntries({
        local: localCiphers,
        workspace: remote.map((row) => ({
          date: row.entryDate,
          authorLabel: row.authorLabel,
          isMine: row.isMine,
          savedAt: row.updatedAt,
          ciphertext: row.ciphertext,
        })),
        myLabel: workspace?.myLabel || "我",
      }),
      workspaceInfo: workspace
        ? {
            id: workspace.id,
            members: workspace.members.map((member) => ({
              label: member.label,
              isMe: member.isMe,
            })),
          }
        : null,
    };
  };

  const handleExport = async (kind: BackupKind) => {
    if (busy) return;
    setBusy(kind);
    setMessage(null);
    setError(null);
    setProgress(null);

    try {
      const exportedAt = new Date().toISOString();
      const { entries, workspaceInfo } = await collectAll();

      if (entries.length === 0) {
        setError("目前還沒有任何紀錄可以匯出。");
        return;
      }

      if (kind === "encrypted") {
        const backup = buildEncryptedBackup({
          exportedAt,
          workspace: workspaceInfo,
          entries,
        });
        downloadJson(
          backupFilename(exportedAt, kind),
          serializeBackup(backup),
        );
        setMessage(`已下載 ${entries.length} 筆加密紀錄。`);
        return;
      }

      if (!passphrase) {
        setError("要匯出明文需要先輸入共用密碼。");
        return;
      }

      // 每一筆都要跑一次 PBKDF2，所以逐筆做並回報進度。
      const decrypted: {
        entry: CollectedEntry;
        payload: Awaited<ReturnType<typeof decryptJournal>> | null;
      }[] = [];
      for (const [index, entry] of entries.entries()) {
        setProgress({ done: index, total: entries.length });
        const payload = await decryptJournal(entry.ciphertext, passphrase).catch(
          () => null,
        );
        decrypted.push({ entry, payload });
      }
      setProgress(null);

      const backup = buildPlainBackup({
        exportedAt,
        workspace: workspaceInfo,
        decrypted,
      });
      downloadJson(backupFilename(exportedAt, kind), serializeBackup(backup));
      setMessage(
        backup.undecryptable.length > 0
          ? `已下載 ${backup.entryCount} 筆明文；另有 ${backup.undecryptable.length} 筆用目前的密碼解不開，仍以加密形式保留在檔案裡。`
          : `已下載 ${backup.entryCount} 筆明文紀錄。`,
      );
    } catch (caught) {
      setError(describeSyncError(caught));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  return (
    <div>
      <h2 className="text-base font-medium text-ink">資料匯出（JSON Backup）</h2>
      <p className="mt-1 text-xs leading-relaxed text-ink-muted">
        隨時把完整紀錄下載到自己的裝置。
      </p>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={() => void handleExport("encrypted")}
          disabled={busy !== null}
          className="flex-1 rounded-2xl border border-line bg-card px-4 py-2.5 text-sm font-medium text-ink-soft transition-colors hover:bg-paper-deep disabled:opacity-50"
        >
          {busy === "encrypted" ? "準備中…" : "下載加密備份"}
        </button>
        <div className="flex-1">
          <ConfirmButton
            variant="outline"
            block
            label={
              busy === "plain"
                ? progress
                  ? `解密中 ${progress.done} / ${progress.total}`
                  : "解密中…"
                : "下載明文備份"
            }
            question="這個檔案是解密後的內容，本身沒有任何保護——任何拿到檔案的人都讀得到。確定要下載嗎？"
            confirmLabel="確定下載"
            onConfirm={() => void handleExport("plain")}
            disabled={busy !== null}
          />
        </div>
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-ink-muted">
        加密備份保留原始的 envelope，之後要還原需要當時的共用密碼；
        <span className="text-clay-deep">
          明文備份是解密後的內容，檔案本身沒有任何保護
        </span>
        ，請放在你信得過的地方。
      </p>

      {message && (
        <p
          aria-live="polite"
          className="mt-3 rounded-2xl bg-leaf-soft/70 px-3 py-2 text-xs leading-relaxed text-leaf"
        >
          {message}
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
