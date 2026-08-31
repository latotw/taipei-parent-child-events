"use client";

import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import ActionBar from "@/components/ActionBar";
import DateNavigator from "@/components/DateNavigator";
import NotesField from "@/components/NotesField";
import ThreeThingsList from "@/components/ThreeThingsList";
import { formatFullDate, greetingFor, todayKey } from "@/lib/date";
import type { DayEntry, JournalByDate } from "@/lib/types";

const DEFAULT_ITEM_COUNT = 3;
const MAX_ITEMS = 5;
const NOTES_MAX_LENGTH = 500;

let idSeed = 0;
const createId = () => `item-${++idSeed}`;

function createEmptyEntry(): DayEntry {
  return {
    items: Array.from({ length: DEFAULT_ITEM_COUNT }, () => ({
      id: createId(),
      text: "",
    })),
    notes: "",
    status: "empty",
  };
}

/** 理論上不會用到（切換日期時就會建立當天的資料），純粹讓型別安全。 */
const EMPTY_FALLBACK = createEmptyEntry();

type Feedback = { tone: "info" | "success"; text: string };

/** 這個元件只在瀏覽器端渲染（見 JournalLoader），所以可以直接讀本地時間。 */
export default function GratitudeJournal() {
  const [dateKey, setDateKey] = useState(todayKey);
  const [journal, setJournal] = useState<JournalByDate>(() => ({
    [todayKey()]: createEmptyEntry(),
  }));
  const [greeting] = useState(() => greetingFor(new Date()));
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  // 提示訊息幾秒後自動淡出。
  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(null), 3200);
    return () => clearTimeout(timer);
  }, [feedback]);

  const entry = journal[dateKey] ?? EMPTY_FALLBACK;

  const updateEntry = useCallback(
    (update: (current: DayEntry) => DayEntry) => {
      setJournal((prev) => {
        const current = prev[dateKey] ?? createEmptyEntry();
        return { ...prev, [dateKey]: update(current) };
      });
    },
    [dateKey],
  );

  const handleDateChange = (nextKey: string) => {
    setDateKey(nextKey);
    setFeedback(null);
    setJournal((prev) =>
      prev[nextKey] ? prev : { ...prev, [nextKey]: createEmptyEntry() },
    );
  };

  /** 只要內容被改動過，就從「已送出」退回「已暫存」，提醒使用者記得再送出。 */
  const markEdited = (status: DayEntry["status"]): DayEntry["status"] =>
    status === "submitted" ? "draft" : status;

  const handleItemChange = (id: string, text: string) => {
    updateEntry((current) => ({
      ...current,
      items: current.items.map((item) =>
        item.id === id ? { ...item, text } : item,
      ),
      status: markEdited(current.status),
    }));
  };

  const handleAddItem = () => {
    updateEntry((current) =>
      current.items.length >= MAX_ITEMS
        ? current
        : {
            ...current,
            items: [...current.items, { id: createId(), text: "" }],
            status: markEdited(current.status),
          },
    );
  };

  const handleRemoveItem = (id: string) => {
    updateEntry((current) =>
      current.items.length <= 1
        ? current
        : {
            ...current,
            items: current.items.filter((item) => item.id !== id),
            status: markEdited(current.status),
          },
    );
  };

  const handleNotesChange = (notes: string) => {
    updateEntry((current) => ({
      ...current,
      notes,
      status: markEdited(current.status),
    }));
  };

  const handleSaveDraft = () => {
    updateEntry((current) => ({ ...current, status: "draft" }));
    setFeedback({ tone: "info", text: "已暫存，隨時回來繼續寫。" });
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;

    // 送出時順手清掉全空的欄位，至少留一格。
    updateEntry((current) => {
      const kept = current.items.filter((item) => item.text.trim() !== "");
      return {
        ...current,
        items: kept.length > 0 ? kept : current.items.slice(0, 1),
        notes: current.notes.trim(),
        status: "submitted",
      };
    });
    setFeedback({ tone: "success", text: "今天的感恩日記已送出，謝謝你 🌿" });
  };

  const filledCount = useMemo(
    () => entry.items.filter((item) => item.text.trim() !== "").length,
    [entry],
  );

  const hasContent = filledCount > 0 || entry.notes.trim() !== "";
  const canSubmit = filledCount > 0;

  return (
    <form
      onSubmit={handleSubmit}
      className="mx-auto w-full max-w-md px-4 pt-6 pb-4"
    >
      <header className="mb-5">
        <p className="text-sm text-ink-muted">{greeting}，</p>
        <h1 className="mt-1 text-2xl leading-snug font-semibold text-ink">
          今天有什麼值得感謝？
        </h1>
      </header>

      <div className="space-y-4">
        <DateNavigator
          dateKey={dateKey}
          status={entry.status}
          onChange={handleDateChange}
        />

        <ThreeThingsList
          items={entry.items}
          maxItems={MAX_ITEMS}
          onItemChange={handleItemChange}
          onAdd={handleAddItem}
          onRemove={handleRemoveItem}
        />

        <NotesField
          value={entry.notes}
          maxLength={NOTES_MAX_LENGTH}
          onChange={handleNotesChange}
        />
      </div>

      <p
        aria-live="polite"
        className={`mt-4 min-h-6 text-center text-xs transition-opacity ${
          feedback
            ? feedback.tone === "success"
              ? "text-leaf opacity-100"
              : "text-clay-deep opacity-100"
            : "opacity-0"
        }`}
      >
        {feedback?.text ?? "　"}
      </p>

      <p className="mt-3 text-center text-[11px] leading-relaxed text-ink-muted">
        {formatFullDate(dateKey)}的內容只存在這個頁面的記憶中，重新整理後會重新開始。
      </p>

      <ActionBar
        canSave={hasContent}
        canSubmit={canSubmit}
        isSubmitted={entry.status === "submitted"}
        onSaveDraft={handleSaveDraft}
      />

    </form>
  );
}
