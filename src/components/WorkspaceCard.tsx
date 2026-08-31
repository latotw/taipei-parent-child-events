"use client";

import { useState } from "react";

import { usePassphrase } from "@/components/PassphraseProvider";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { createPassphraseProbe } from "@/lib/crypto";
import {
  formatInviteCode,
  isValidInviteCode,
  MAX_LABEL_LENGTH,
} from "@/lib/supabase/invite";

const INPUT_CLASS =
  "w-full rounded-2xl border border-line bg-paper px-4 py-2.5 text-[15px] text-ink outline-none transition placeholder:text-ink-muted focus:border-clay focus:bg-card focus:ring-2 focus:ring-clay/20";

type Mode = "create" | "join";

export default function WorkspaceCard() {
  const { status, workspace, error, busy, connect, create, join, leave, rotateInvite } =
    useWorkspace();
  const { passphrase } = usePassphrase();

  const [mode, setMode] = useState<Mode>("create");
  const [label, setLabel] = useState("");
  const [code, setCode] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (status === "disabled") {
    return (
      <section
        aria-label="共享 Workspace"
        className="rounded-3xl border border-dashed border-line bg-card/60 p-4"
      >
        <h2 className="text-base font-medium text-ink">兩人共享</h2>
        <p className="mt-1 text-xs leading-relaxed text-ink-muted">
          尚未設定 Supabase，目前只在這台裝置上運作。
          把 <code className="font-mono">NEXT_PUBLIC_SUPABASE_URL</code> 與{" "}
          <code className="font-mono">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> 寫進{" "}
          <code className="font-mono">.env.local</code> 後重啟即可開啟同步。
        </p>
      </section>
    );
  }

  const handleSubmit = async () => {
    setLocalError(null);

    if (label.trim() === "") {
      setLocalError("請先填一個顯示用的名字，例如「小美」。");
      return;
    }

    if (mode === "join") {
      if (!isValidInviteCode(code)) {
        setLocalError("邀請碼是 10 個字，例如 9F3A-1C7B-2D。");
        return;
      }
      await join(code, label);
      return;
    }

    // 建立 workspace 時，若已經設好共用密碼就順手登記驗證字串，
    // 另一半加入後就能立刻確認自己輸入的密碼對不對。
    const probe = passphrase ? await createPassphraseProbe(passphrase) : null;
    await create(label, probe);
  };

  const handleCopyCode = async () => {
    if (!workspace) return;
    try {
      await navigator.clipboard.writeText(formatInviteCode(workspace.inviteCode));
      setCopied(true);
    } catch {
      setCopied(false);
      setLocalError("這個瀏覽器不允許自動複製，請手動選取邀請碼。");
    }
  };

  return (
    <section
      aria-label="共享 Workspace"
      className="rounded-3xl border border-line bg-card p-4 shadow-soft"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-medium text-ink">兩人共享</h2>
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">
            {workspace
              ? "加密後的日記會同步到你們共用的 Workspace。"
              : "建立一個 Workspace 並把邀請碼給另一半，就能一起寫。"}
          </p>
        </div>
        {workspace && (
          <span className="shrink-0 rounded-full bg-leaf-soft px-3 py-1 text-xs font-medium text-leaf ring-1 ring-leaf/25 ring-inset">
            {workspace.members.length} / 2 人
          </span>
        )}
      </div>

      {(status === "idle" || status === "connecting") && (
        <p className="mt-4 text-xs text-ink-muted" aria-live="polite">
          連線中…
        </p>
      )}

      {status === "error" && (
        <button
          type="button"
          onClick={connect}
          disabled={busy}
          className="mt-4 w-full rounded-2xl border border-clay/40 py-3 text-sm font-medium text-clay-deep transition-colors hover:bg-clay-soft/60 disabled:opacity-50"
        >
          {busy ? "連線中…" : "重新連線"}
        </button>
      )}

      {(status === "unpaired" || status === "error") && (
        <div className="mt-4 space-y-3">
          <div className="flex gap-2 rounded-2xl bg-paper-deep p-1">
            {(["create", "join"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => {
                  setMode(option);
                  setLocalError(null);
                }}
                aria-pressed={mode === option}
                className={`flex-1 rounded-xl px-3 py-2 text-xs font-medium transition-colors ${
                  mode === option
                    ? "bg-card text-ink shadow-soft"
                    : "text-ink-muted hover:text-ink-soft"
                }`}
              >
                {option === "create" ? "建立 Workspace" : "用邀請碼加入"}
              </button>
            ))}
          </div>

          <div>
            <label className="text-xs text-ink-soft" htmlFor="workspace-label">
              你的名字（使用者標籤）
            </label>
            <input
              id="workspace-label"
              value={label}
              maxLength={MAX_LABEL_LENGTH}
              placeholder="例如：小美"
              onChange={(event) => {
                setLabel(event.target.value);
                setLocalError(null);
              }}
              className={`mt-1 ${INPUT_CLASS}`}
            />
          </div>

          {mode === "join" && (
            <div>
              <label className="text-xs text-ink-soft" htmlFor="workspace-code">
                邀請碼
              </label>
              <input
                id="workspace-code"
                value={code}
                placeholder="9F3A-1C7B-2D"
                autoCapitalize="characters"
                spellCheck={false}
                onChange={(event) => {
                  setCode(event.target.value);
                  setLocalError(null);
                }}
                className={`mt-1 font-mono ${INPUT_CLASS}`}
              />
            </div>
          )}

          <button
            type="button"
            onClick={handleSubmit}
            disabled={busy}
            className="w-full rounded-2xl bg-clay px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-clay-deep disabled:opacity-50"
          >
            {busy
              ? "處理中…"
              : mode === "create"
                ? "建立並取得邀請碼"
                : "加入 Workspace"}
          </button>
        </div>
      )}

      {workspace && (
        <div className="mt-4 space-y-3 border-t border-line pt-4">
          <ul className="space-y-1 text-sm text-ink">
            {workspace.members.map((member) => (
              <li key={member.userId} className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="size-1.5 rounded-full bg-clay/50"
                />
                {member.label}
                {member.isMe && (
                  <span className="text-xs text-ink-muted">（你）</span>
                )}
              </li>
            ))}
          </ul>

          {workspace.inviteActive ? (
            <div className="rounded-2xl bg-paper-deep p-3">
              <p className="text-xs text-ink-soft">把這組邀請碼給另一半：</p>
              <p className="mt-1 font-mono text-lg tracking-wider text-ink">
                {formatInviteCode(workspace.inviteCode)}
              </p>
              <div className="mt-2 flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleCopyCode}
                  className="rounded-full border border-line bg-card px-3 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:bg-paper"
                >
                  複製
                </button>
                {copied && (
                  <span className="text-xs text-ink-muted" aria-live="polite">
                    已複製
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3 rounded-2xl bg-paper-deep p-3">
              <p className="text-xs leading-relaxed text-ink-muted">
                {workspace.members.length >= 2
                  ? "已配對完成，邀請碼已自動停用。"
                  : "邀請碼已過期。"}
              </p>
              <button
                type="button"
                onClick={rotateInvite}
                disabled={busy}
                className="shrink-0 rounded-full border border-line bg-card px-3 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:bg-paper disabled:opacity-50"
              >
                重新產生
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={leave}
            disabled={busy}
            className="text-xs text-clay-deep underline decoration-clay/40 underline-offset-4 transition-colors hover:decoration-clay disabled:opacity-50"
          >
            離開這個 Workspace
          </button>
        </div>
      )}

      {(localError ?? error) && (
        <p
          role="alert"
          className="mt-3 rounded-2xl bg-clay-soft px-3 py-2 text-xs leading-relaxed text-clay-deep"
        >
          {localError ?? error}
        </p>
      )}

      <p className="mt-3 border-t border-line pt-3 text-[11px] leading-relaxed text-ink-muted">
        資料庫只會存到 Workspace ID、日期、你的標籤與加密字串；
        共用密碼不會上傳，伺服器也解不開內容。
      </p>
    </section>
  );
}
