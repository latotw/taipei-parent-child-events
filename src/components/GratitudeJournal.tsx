"use client";

import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import ActionBar from "@/components/ActionBar";
import CipherPanel from "@/components/CipherPanel";
import DateNavigator from "@/components/DateNavigator";
import NotesField from "@/components/NotesField";
import PassphraseCard from "@/components/PassphraseCard";
import { usePassphrase } from "@/components/PassphraseProvider";
import ThreeThingsList from "@/components/ThreeThingsList";
import WorkspaceCard from "@/components/WorkspaceCard";
import WorkspaceFeed from "@/components/WorkspaceFeed";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { describeCryptoError, encryptJournal } from "@/lib/crypto";
import { describeSyncError } from "@/lib/supabase/errors";
import { pushEntry } from "@/lib/supabase/workspace";
import { formatFullDate, greetingFor, todayKey } from "@/lib/date";
import type {
  CipherRecord,
  DayEntry,
  JournalByDate,
  JournalPayload,
} from "@/lib/types";

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
    cipher: null,
  };
}

/** 理論上不會用到（切換日期時就會建立當天的資料），純粹讓型別安全。 */
const EMPTY_FALLBACK = createEmptyEntry();

type Feedback = { tone: "info" | "success" | "error"; text: string };

/** 這個元件只在瀏覽器端渲染（見 JournalLoader），所以可以直接讀本地時間。 */
export default function GratitudeJournal() {
  const [dateKey, setDateKey] = useState(todayKey);
  const [journal, setJournal] = useState<JournalByDate>(() => ({
    [todayKey()]: createEmptyEntry(),
  }));
  const [greeting] = useState(() => greetingFor(new Date()));
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [busy, setBusy] = useState<"draft" | "submitted" | null>(null);
  // 每次成功上傳就 +1，讓下面的共享列表重新讀一次
  const [syncedAt, setSyncedAt] = useState(0);
  const { passphrase, hasPassphrase } = usePassphrase();
  const { workspace } = useWorkspace();

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

  /**
   * 內容改了之後，先前算出的加密字串就對不上了。標記為過期（而不是直接刪掉），
   * 這樣使用者還能複製舊字串，畫面上也會提示要重新加密。
   */
  const staleCipher = (current: DayEntry): CipherRecord | null =>
    current.cipher ? { ...current.cipher, stale: true } : null;

  /** 內容一被改動：狀態從「已送出」退回「已暫存」，並把加密字串標記為過期。 */
  const touched = (current: DayEntry): Pick<DayEntry, "status" | "cipher"> => ({
    status: current.status === "submitted" ? "draft" : current.status,
    cipher: staleCipher(current),
  });

  const handleItemChange = (id: string, text: string) => {
    updateEntry((current) => ({
      ...current,
      items: current.items.map((item) =>
        item.id === id ? { ...item, text } : item,
      ),
      ...touched(current),
    }));
  };

  const handleAddItem = () => {
    updateEntry((current) =>
      current.items.length >= MAX_ITEMS
        ? current
        : {
            ...current,
            items: [...current.items, { id: createId(), text: "" }],
            ...touched(current),
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
            ...touched(current),
          },
    );
  };

  const handleNotesChange = (notes: string) => {
    updateEntry((current) => ({
      ...current,
      notes,
      ...touched(current),
    }));
  };

  /** 把表單目前的內容整理成要加密的明文 payload。 */
  const buildPayload = (source: DayEntry): JournalPayload => ({
    date: dateKey,
    items: source.items
      .map((item) => item.text.trim())
      .filter((text) => text !== ""),
    notes: source.notes.trim(),
    savedAt: new Date().toISOString(),
  });

  /**
   * 暫存與送出共用的流程：先在客戶端加密，成功之後才更新狀態。
   * 加密失敗（例如沒設密碼、沒有內容）就什麼都不動，只顯示提示。
   */
  const persist = async (mode: "draft" | "submitted") => {
    if (busy) return;

    if (!passphrase) {
      setFeedback({
        tone: "error",
        text: "請先在上方設定共用解密密碼，內容才能加密後再離開這台裝置。",
      });
      return;
    }

    setBusy(mode);
    setFeedback(null);
    try {
      const cipherText = await encryptJournal(buildPayload(entry), passphrase);
      const cipher: CipherRecord = {
        text: cipherText,
        savedAt: new Date().toISOString(),
        stale: false,
      };

      // 真的要接後端時，這裡送出去的就只有 cipher.text，明文不離開瀏覽器。
      updateEntry((current) => {
        if (mode === "draft") return { ...current, status: "draft", cipher };

        // 送出時順手清掉全空的欄位，至少留一格。
        const kept = current.items.filter((item) => item.text.trim() !== "");
        return {
          ...current,
          items: kept.length > 0 ? kept : current.items.slice(0, 1),
          notes: current.notes.trim(),
          status: "submitted",
          cipher,
        };
      });

      // 加密完成之後才輪到網路：離開這台裝置的只有 cipher.text。
      if (workspace) {
        try {
          await pushEntry({
            workspaceId: workspace.id,
            entryDate: dateKey,
            ciphertext: cipherText,
          });
          setSyncedAt((value) => value + 1);
          setFeedback({
            tone: mode === "draft" ? "info" : "success",
            text:
              mode === "draft"
                ? "已加密並同步暫存。"
                : "已加密並同步給你們兩人 🌿",
          });
        } catch (syncFailure) {
          // 本機已經加密好了，只是上傳失敗——內容不會因此消失。
          setFeedback({
            tone: "error",
            text: `已在本機加密，但同步失敗：${describeSyncError(syncFailure)}`,
          });
        }
        return;
      }

      setFeedback(
        mode === "draft"
          ? { tone: "info", text: "已加密並暫存，隨時回來繼續寫。" }
          : { tone: "success", text: "已加密送出，謝謝你 🌿" },
      );
    } catch (caught) {
      setFeedback({ tone: "error", text: describeCryptoError(caught) });
    } finally {
      setBusy(null);
    }
  };

  const handleSaveDraft = () => void persist("draft");

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void persist("submitted");
  };

  /** 解密面板按「填回表單」：用還原出來的內容覆蓋目前的表單。 */
  const handleRestore = (payload: JournalPayload) => {
    const items = payload.items.length > 0 ? payload.items : [""];
    updateEntry((current) => ({
      ...current,
      items: items.map((text) => ({ id: createId(), text })),
      notes: payload.notes,
      status: "draft",
      cipher: staleCipher(current),
    }));
    setFeedback({ tone: "info", text: "已把解密的內容填回表單。" });
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

        <PassphraseCard />

        <WorkspaceCard />

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

        <CipherPanel
          // 換日期或產生新的加密字串時重設面板；單純編輯表單不會（savedAt 不變）。
          key={`${dateKey}:${entry.cipher?.savedAt ?? "none"}`}
          cipher={entry.cipher}
          onRestore={handleRestore}
        />

        <WorkspaceFeed
          dateKey={dateKey}
          refreshToken={syncedAt}
          onRestore={handleRestore}
        />
      </div>

      <p
        aria-live="polite"
        className={`mt-4 min-h-6 text-center text-xs transition-opacity ${
          feedback
            ? `opacity-100 ${
                feedback.tone === "success" ? "text-leaf" : "text-clay-deep"
              }`
            : "opacity-0"
        }`}
      >
        {feedback?.text ?? "　"}
      </p>

      <p className="mt-3 text-center text-[11px] leading-relaxed text-ink-muted">
        {formatFullDate(dateKey)}的明文只存在這個頁面的記憶中，重新整理後會重新開始；
        只有加密字串適合離開這台裝置。
      </p>

      <ActionBar
        canSave={hasContent}
        canSubmit={canSubmit}
        isSubmitted={entry.status === "submitted"}
        hasPassphrase={hasPassphrase}
        busy={busy}
        onSaveDraft={handleSaveDraft}
      />

    </form>
  );
}
