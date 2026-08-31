"use client";

import { useEffect, useState } from "react";

import EntryList, { type EntryListItem } from "@/components/EntryList";
import { usePassphrase } from "@/components/PassphraseProvider";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { decryptJournal } from "@/lib/crypto";
import { describeSyncError } from "@/lib/supabase/errors";
import { pullEntries } from "@/lib/supabase/workspace";
import type { JournalPayload } from "@/lib/types";

type Props = {
  dateKey: string;
  /** 父層每次成功上傳就 +1，用來觸發重新讀取 */
  refreshToken: number;
  /** 分頁沒被選到時不用去讀 */
  active: boolean;
  onRestore: (payload: JournalPayload) => void;
};

export default function WorkspaceFeed({
  dateKey,
  refreshToken,
  active,
  onRestore,
}: Props) {
  const { workspace } = useWorkspace();
  const { passphrase, version } = usePassphrase();

  const workspaceId = workspace?.id ?? null;

  /**
   * 一次讀取的識別字串。用密碼的 version 而不是密碼本身，
   * 免得把祕密多複製一份到 state 裡。
   */
  const requestKey = `${workspaceId}|${dateKey}|${version}|${refreshToken}`;

  // 只在非同步結果回來時寫入 state（避免 effect 內同步 setState 造成連鎖 render）。
  const [loaded, setLoaded] = useState<{
    key: string;
    items: EntryListItem[] | null;
    error: string | null;
  }>({ key: "", items: null, error: null });

  const settled = loaded.key === requestKey;
  const items = settled ? loaded.items : null;

  useEffect(() => {
    if (!active || !workspaceId) return;

    let cancelled = false;

    // 讀回來的是加密字串，解密一律在這裡（客戶端）做。
    void (async () => {
      try {
        const entries = await pullEntries(workspaceId, dateKey);
        const decrypted: EntryListItem[] = await Promise.all(
          entries.map(async (entry) => ({
            id: entry.id,
            authorLabel: entry.authorLabel,
            isMine: entry.isMine,
            timestamp: entry.updatedAt,
            restoreLabel: entry.isMine ? "填回表單繼續寫" : "複製到我的表單",
            payload: passphrase
              ? await decryptJournal(entry.ciphertext, passphrase).catch(
                  () => null,
                )
              : null,
          })),
        );
        if (!cancelled) {
          setLoaded({ key: requestKey, items: decrypted, error: null });
        }
      } catch (caught) {
        if (!cancelled) {
          setLoaded({
            key: requestKey,
            items: null,
            error: describeSyncError(caught),
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [active, requestKey, workspaceId, dateKey, passphrase]);

  if (!workspaceId) return null;

  return (
    <section
      aria-label="這一天的共享內容"
      className="rounded-3xl border border-line bg-card p-4 shadow-soft"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-base font-medium text-ink">這一天的共享內容</h2>
        <span className="text-xs text-ink-muted">
          {settled ? `${items?.length ?? 0} 則` : "讀取中…"}
        </span>
      </div>
      <p className="mt-1 mb-3 text-xs leading-relaxed text-ink-muted">
        從 Workspace 讀回加密字串，在這台裝置上用你的密碼解開。
      </p>

      <EntryList
        items={items}
        loading={!settled}
        error={settled ? loaded.error : null}
        emptyText="這一天還沒有人寫。按「加密並送出」就會同步上去。"
        hasPassphrase={passphrase !== null}
        onRestore={onRestore}
      />
    </section>
  );
}
