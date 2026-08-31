/** 一則感恩事項。id 只用於 React key 與增刪操作。 */
export type GratitudeItem = {
  id: string;
  text: string;
};

/** 某一天的填寫狀態：未開始 / 已暫存 / 已送出。 */
export type DayStatus = "empty" | "draft" | "submitted";

/** 某一天的完整日記內容。 */
export type DayEntry = {
  items: GratitudeItem[];
  notes: string;
  status: DayStatus;
};

/** 以 YYYY-MM-DD 當 key，存放每一天的日記。 */
export type JournalByDate = Record<string, DayEntry>;
