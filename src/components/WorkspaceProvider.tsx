"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { isSupabaseConfigured } from "@/lib/supabase/client";
import { describeSyncError } from "@/lib/supabase/errors";
import {
  createWorkspace,
  joinWorkspace,
  leaveWorkspace,
  loadWorkspace,
  rotateInviteCode,
  savePassphraseProbe,
  type WorkspaceInfo,
} from "@/lib/supabase/workspace";

export type WorkspaceStatus =
  /** 沒設定 Supabase，純離線 */
  | "disabled"
  /** 還沒連線過 */
  | "idle"
  | "connecting"
  /** 連上了，但還沒加入任何 workspace */
  | "unpaired"
  /** 已在 workspace 裡 */
  | "paired"
  | "error";

type WorkspaceContextValue = {
  status: WorkspaceStatus;
  workspace: WorkspaceInfo | null;
  error: string | null;
  busy: boolean;
  connect: () => Promise<void>;
  create: (label: string, probe: string | null) => Promise<void>;
  join: (inviteCode: string, label: string) => Promise<void>;
  leave: () => Promise<void>;
  rotateInvite: () => Promise<void>;
  /** 把共用密碼的驗證字串登記到 workspace 上 */
  registerProbe: (probe: string) => Promise<void>;
  clearError: () => void;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<WorkspaceStatus>(
    isSupabaseConfigured ? "idle" : "disabled",
  );
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** 所有動作共用：管好 busy / error，成功後把 workspace 與狀態寫回去。 */
  const run = useCallback(
    async (action: () => Promise<WorkspaceInfo | null>) => {
      if (!isSupabaseConfigured) return;
      setBusy(true);
      setError(null);
      try {
        const next = await action();
        setWorkspace(next);
        setStatus(next ? "paired" : "unpaired");
      } catch (caught) {
        setError(describeSyncError(caught));
        setStatus((current) => (current === "paired" ? "paired" : "error"));
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const connect = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    setStatus("connecting");
    await run(loadWorkspace);
  }, [run]);

  // 匿名 session 存在 localStorage，所以重新整理後應該自己接回原本的 workspace，
  // 不該讓使用者再按一次「連線」。
  const connected = useRef(false);
  useEffect(() => {
    if (!isSupabaseConfigured || connected.current) return;
    connected.current = true;
    void connect();
  }, [connect]);

  const create = useCallback(
    (label: string, probe: string | null) =>
      run(() => createWorkspace(label, probe)),
    [run],
  );

  const join = useCallback(
    (inviteCode: string, label: string) =>
      run(() => joinWorkspace(inviteCode, label)),
    [run],
  );

  const leave = useCallback(async () => {
    const current = workspace;
    if (!current) return;
    await run(async () => {
      await leaveWorkspace(current.id);
      return null;
    });
  }, [run, workspace]);

  const rotateInvite = useCallback(async () => {
    const current = workspace;
    if (!current) return;
    await run(async () => {
      await rotateInviteCode(current.id);
      return loadWorkspace();
    });
  }, [run, workspace]);

  const registerProbe = useCallback(
    async (probe: string) => {
      const current = workspace;
      if (!current) return;
      await run(async () => {
        await savePassphraseProbe(current.id, probe);
        return loadWorkspace();
      });
    },
    [run, workspace],
  );

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      status,
      workspace,
      error,
      busy,
      connect,
      create,
      join,
      leave,
      rotateInvite,
      registerProbe,
      clearError: () => setError(null),
    }),
    [
      status,
      workspace,
      error,
      busy,
      connect,
      create,
      join,
      leave,
      rotateInvite,
      registerProbe,
    ],
  );

  return <WorkspaceContext value={value}>{children}</WorkspaceContext>;
}

export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (!value) {
    throw new Error("useWorkspace 必須放在 <WorkspaceProvider> 之內使用。");
  }
  return value;
}
