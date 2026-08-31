"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * 共用解密密碼的狀態管理。
 *
 * 刻意只放在 React state（記憶體）裡：不寫 localStorage、不寫 cookie、
 * 不進 URL，重新整理就會消失。這樣密碼不會留在裝置上，
 * 代價是每次開啟頁面都要重新輸入一次。
 */
type PassphraseContextValue = {
  /** null 表示還沒設定 */
  passphrase: string | null;
  hasPassphrase: boolean;
  /** 密碼長度，只用來顯示遮罩點點，不外流內容 */
  length: number;
  /**
   * 每次設定或清除就 +1。要「密碼換了就重算」的地方請用這個當 key，
   * 不要把密碼本身放進 cache key 或 state 裡多存一份。
   */
  version: number;
  setPassphrase: (value: string) => void;
  clearPassphrase: () => void;
};

const PassphraseContext = createContext<PassphraseContextValue | null>(null);

export const MIN_PASSPHRASE_LENGTH = 6;

export function PassphraseProvider({ children }: { children: ReactNode }) {
  const [passphrase, setValue] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const setPassphrase = useCallback((value: string) => {
    setValue(value);
    setVersion((current) => current + 1);
  }, []);

  const clearPassphrase = useCallback(() => {
    setValue(null);
    setVersion((current) => current + 1);
  }, []);

  const value = useMemo<PassphraseContextValue>(
    () => ({
      passphrase,
      hasPassphrase: passphrase !== null,
      length: passphrase?.length ?? 0,
      version,
      setPassphrase,
      clearPassphrase,
    }),
    [passphrase, version, setPassphrase, clearPassphrase],
  );

  return (
    <PassphraseContext value={value}>{children}</PassphraseContext>
  );
}

export function usePassphrase(): PassphraseContextValue {
  const value = useContext(PassphraseContext);
  if (!value) {
    throw new Error("usePassphrase 必須放在 <PassphraseProvider> 之內使用。");
  }
  return value;
}
