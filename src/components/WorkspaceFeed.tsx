"use client";

import { useEffect, useState } from "react";

import { usePassphrase } from "@/components/PassphraseProvider";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { decryptJournal } from "@/lib/crypto";
import { describeSyncError } from "@/lib/supabase/errors";
import { pullEntries, type RemoteEntry } from "@/lib/supabase/workspace";
import type { JournalPayload } from "@/lib/types";

type Props = {
  dateKey: string;
  /** 父層每次成功上傳就 +1，用來觸發重新讀取 */
  refreshToken: number;
  onRestore: (payload: JournalPayload) => void;
};

/** 一列遠端資料 + 在本機解密的結果。 */
type FeedItem = {
  entry: RemoteEntry;
  payload: JournalPayload | null;
};

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

export default function WorkspaceFeed({
  dateKey,
  refreshToken,
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
    items: FeedItem[] | null;
    error: string | null;
  }>({ key: "", items: null, error: null });

  const settled = loaded.key === requestKey;
  const loading = workspaceId !== null && !settled;
  const items = settled ? loaded.items : null;
  const error = settled ? loaded.error : null;

  useEffect(() => {
    if (!workspaceId) return;

    let cancelled = false;

    // 讀回來的是加密字串，解密一律在這裡（客戶端）做。
    void (async () => {
      try {
        const entries = await pullEntries(workspaceId, dateKey);
        const decrypted = await Promise.all(
          entries.map(async (entry) => ({
            entry,
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
  }, [requestKey, workspaceId, dateKey, passphrase]);

  if (!workspaceId) return null;

  return (
    <section
      aria-label="這一天的共享內容"
      className="rounded-3xl border border-line bg-card p-4 shadow-soft"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-base font-medium text-ink">這一天的共享內容</h2>
        <span className="text-xs text-ink-muted">
          {loading ? "讀取中…" : `${items?.length ?? 0} 則`}
        </span>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-ink-muted">
        從 Workspace 讀回加密字串，在這台裝置上用你的密碼解開。
      </p>

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-2xl bg-clay-soft px-3 py-2 text-xs leading-relaxed text-clay-deep"
        >
          {error}
        </p>
      )}

      {!error && items?.length === 0 && (
        <p className="mt-3 text-xs text-ink-muted">
          這一天還沒有人寫。按「加密並送出」就會同步上去。
        </p>
      )}

      <ul className="mt-3 space-y-3">
        {items?.map(({ entry, payload }) => (
          <li
            key={entry.id}
            className="rounded-2xl border border-line bg-paper p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-ink">
                {entry.authorLabel}
                {entry.isMine && (
                  <span className="ml-1 text-xs text-ink-muted">（你）</span>
                )}
              </p>
              <span className="text-xs text-ink-muted">
                {formatTime(entry.updatedAt)}
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
                {/* 自己的那則可以填回表單繼續寫（例如重新整理後）；
                    對方的則是複製過來當靈感。 */}
                <button
                  type="button"
                  onClick={() => onRestore(payload)}
                  className="mt-2 text-xs text-ink-muted underline decoration-line underline-offset-4 transition-colors hover:text-clay-deep"
                >
                  {entry.isMine ? "填回表單繼續寫" : "複製到我的表單"}
                </button>
              </>
            ) : (
              <p className="mt-2 text-xs leading-relaxed text-clay-deep">
                {passphrase
                  ? "用目前的密碼解不開這則——兩人要使用同一組共用密碼才看得到對方的內容。"
                  : "尚未輸入共用密碼，無法解密。"}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
