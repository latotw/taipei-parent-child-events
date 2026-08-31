/** 一則感恩事項。id 只用於 React key 與增刪操作。 */
export type GratitudeItem = {
  id: string;
  text: string;
};

/** 某一天的填寫狀態：未開始 / 已暫存 / 已送出。 */
export type DayStatus = "empty" | "draft" | "submitted";

/** 加密後的結果：只有這份東西適合離開這台裝置。 */
export type CipherRecord = {
  /** 加密字串（envelope），格式見 lib/crypto.ts */
  text: string;
  /** 產生時間，ISO 字串 */
  savedAt: string;
  /** 表單在這次加密之後又被改過，字串已對不上目前內容 */
  stale: boolean;
};

/** 某一天的完整日記內容。 */
export type DayEntry = {
  items: GratitudeItem[];
  notes: string;
  status: DayStatus;
  cipher: CipherRecord | null;
};

/** 以 YYYY-MM-DD 當 key，存放每一天的日記。 */
export type JournalByDate = Record<string, DayEntry>;

/** 這台裝置上某一天的加密結果，匯出與歷史回顧都會用到。 */
export type LocalCipher = {
  /** YYYY-MM-DD */
  date: string;
  ciphertext: string;
  /** 加密時間，ISO 字串 */
  savedAt: string;
};

/**
 * 真正被加密的資料結構（明文 payload）。
 * 刻意不帶 React 用的 id，解密後就是乾淨的日記內容。
 */
export type JournalPayload = {
  /** YYYY-MM-DD */
  date: string;
  /** 三件事，已濾掉空白欄位 */
  items: string[];
  /** 其他 (Notes) */
  notes: string;
  /** 加密當下的時間，ISO 字串 */
  savedAt: string;
};
