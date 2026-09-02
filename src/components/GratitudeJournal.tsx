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
import DayCompleteCard from "@/components/DayCompleteCard";
import HistoryPanel from "@/components/HistoryPanel";
import NotesField from "@/components/NotesField";
import PassphraseCard from "@/components/PassphraseCard";
import { usePassphrase } from "@/components/PassphraseProvider";
import TabBar, { type TabId } from "@/components/TabBar";
import ThreeThingsList from "@/components/ThreeThingsList";
import WorkspaceCard from "@/components/WorkspaceCard";
import WorkspaceFeed from "@/components/WorkspaceFeed";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { describeCryptoError, encryptJournal } from "@/lib/crypto";
import { describeSyncError } from "@/lib/supabase/errors";
import { deleteEntry, pushEntry } from "@/lib/supabase/workspace";
import { formatFullDate, greetingFor, todayKey } from "@/lib/date";
import type {
  CipherRecord,
  DayEntry,
  ImportedDay,
  JournalByDate,
  JournalPayload,
  LocalCipher,
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

const TAB_HEADINGS: Record<TabId, string> = {
  write: "今天有什麼值得感謝？",
  history: "回頭看看那些小事",
  settings: "密碼與共享設定",
};

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
  const [tab, setTab] = useState<TabId>("write");
  /**
   * 被按了「修改這一天」的日期。送出後畫面會收成完成卡片，
   * 只有這裡記著的那一天才把編輯欄位放回來。
   */
  const [editing, setEditing] = useState<string | null>(null);

  /** 換分頁等於換一個畫面，捲動位置要回到最上面，不然會落在別頁的中段。 */
  const changeTab = (next: TabId) => {
    setTab(next);
    window.scrollTo({ top: 0 });
  };
  const { passphrase, hasPassphrase } = usePassphrase();
  const { workspace } = useWorkspace();

  // 成功／一般提示幾秒後自動淡出；錯誤留在畫面上，等下一個動作才清掉。
  useEffect(() => {
    if (!feedback || feedback.tone === "error") return;
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
        text: "請先到「設定」分頁設定共用解密密碼，內容才能加密後再離開這台裝置。",
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
        synced: false,
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

      if (mode === "submitted") {
        // 收起編輯欄位，換成完成畫面；頁面會變短，捲回上面才看得到那張卡片。
        setEditing(null);
        window.scrollTo({ top: 0, behavior: "smooth" });
      }

      // 本機的加密紀錄也變了，讓月曆與匯出重新取值。
      setSyncedAt((value) => value + 1);

      // 加密完成之後才輪到網路：離開這台裝置的只有 cipher.text。
      if (workspace) {
        try {
          await pushEntry({
            workspaceId: workspace.id,
            entryDate: dateKey,
            ciphertext: cipherText,
          });
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

  /**
   * 刪掉某一天自己寫的紀錄：Workspace 上的那列與本機的內容都清掉。
   * 遠端刪除失敗就不動本機，免得畫面上看起來刪了、其實對方還看得到。
   */
  const deleteDay = async (date: string) => {
    try {
      if (workspace) await deleteEntry(workspace.id, date);
      setJournal((prev) => ({ ...prev, [date]: createEmptyEntry() }));
      setSyncedAt((value) => value + 1);
      setFeedback({ tone: "info", text: `已刪除 ${formatFullDate(date)}的紀錄。` });
    } catch (caught) {
      setFeedback({ tone: "error", text: describeSyncError(caught) });
    }
  };

  const handleDelete = (date: string) => void deleteDay(date);

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

  /**
   * 從備份檔還原幾天的紀錄。
   *
   * 先寫進 journal（就算之後同步失敗，使用者至少看得到資料回來了），
   * 再逐筆上傳。上傳成功的才標記 synced——畫面上不能謊稱已同步。
   */
  const importDays = useCallback(
    async (
      days: ImportedDay[],
      options: { sync: boolean },
      onProgress: (done: number, total: number) => void,
    ): Promise<{ applied: number; syncFailed: number }> => {
      setJournal((prev) => {
        const next = { ...prev };
        for (const day of days) {
          next[day.date] = {
            items: (day.items.length > 0 ? day.items : [""]).map((text) => ({
              id: createId(),
              text,
            })),
            notes: day.notes,
            // 這些是當初寫完送出過的日子，還原後就該是完成的樣子。
            status: "submitted",
            cipher: {
              text: day.ciphertext,
              savedAt: day.savedAt,
              stale: false,
              synced: false,
            },
          };
        }
        return next;
      });

      const syncedDates: string[] = [];
      let syncFailed = 0;

      if (options.sync && workspace) {
        for (const [index, day] of days.entries()) {
          onProgress(index, days.length);
          try {
            await pushEntry({
              workspaceId: workspace.id,
              entryDate: day.date,
              ciphertext: day.ciphertext,
            });
            syncedDates.push(day.date);
          } catch {
            // 單筆失敗不該中斷整份還原，最後一起回報有幾天沒上去。
            syncFailed += 1;
          }
        }
      }

      if (syncedDates.length > 0) {
        setJournal((prev) => {
          const next = { ...prev };
          for (const date of syncedDates) {
            const day = next[date];
            if (day?.cipher) {
              next[date] = { ...day, cipher: { ...day.cipher, synced: true } };
            }
          }
          return next;
        });
      }

      // 月曆、匯出、共享列表都要重新取值。
      setSyncedAt((value) => value + 1);
      return { applied: days.length, syncFailed };
    },
    [workspace],
  );

  /**
   * 這個頁面裡已經有內容的日期。匯入時用來判斷會不會蓋掉東西——
   * 包含還沒暫存的打字內容，那也是會被覆蓋掉的東西。
   */
  const existingDates = useMemo(
    () =>
      Object.entries(journal)
        .filter(
          ([, day]) =>
            day.cipher !== null ||
            day.notes.trim() !== "" ||
            day.items.some((item) => item.text.trim() !== ""),
        )
        .map(([date]) => date),
    [journal],
  );

  /** 這台裝置上所有已加密的日子，給歷史回顧與匯出用。 */
  const localCiphers = useMemo<LocalCipher[]>(
    () =>
      Object.entries(journal)
        .flatMap(([date, day]) =>
          day.cipher
            ? [{ date, ciphertext: day.cipher.text, savedAt: day.cipher.savedAt }]
            : [],
        )
        .sort((a, b) => b.date.localeCompare(a.date)),
    [journal],
  );

  const hasContent = filledCount > 0 || entry.notes.trim() !== "";
  const canSubmit = filledCount > 0;

  /**
   * 這一天已經送出、而且沒有按「修改這一天」。
   * 寫日記是有結束的：這時候把輸入欄位收起來，換成一張完成卡片。
   */
  const isComplete = entry.status === "submitted" && editing !== dateKey;

  return (
    <div className="mx-auto w-full max-w-md px-3 pt-6 pb-4 sm:px-4">
      <header className="mb-4">
        <p className="text-sm text-ink-muted">{greeting}，</p>
        <h1 className="mt-1 text-2xl leading-snug font-semibold text-ink">
          {/* 寫完了就別再問「今天有什麼值得感謝？」，那是還沒寫的人才需要的提問。 */}
          {tab === "write" && isComplete
            ? "今天已經寫完了"
            : TAB_HEADINGS[tab]}
        </h1>
      </header>

      <TabBar
        active={tab}
        onChange={changeTab}
        tabs={[
          { id: "write", label: "寫日記" },
          // 這裡不放筆數：本機 state 重新整理就歸零，會比實際紀錄少。
          // 準確的天數由「回顧月曆」卡片自己顯示（含 Workspace 的資料）。
          { id: "history", label: "回顧" },
          {
            id: "settings",
            label: "設定",
            // 沒設密碼就寫不了，用小紅點提醒
            badge: hasPassphrase ? undefined : { kind: "attention" },
          },
        ]}
      />

      {/* 分頁用 hidden 切換而不是卸載，這樣月曆選到的日期、解密結果都不會被清掉 */}
      <form
        id="panel-write"
        role="tabpanel"
        aria-label="寫日記"
        hidden={tab !== "write"}
        onSubmit={handleSubmit}
      >
        <div className="space-y-4">
          <DateNavigator
            dateKey={dateKey}
            status={entry.status}
            onChange={handleDateChange}
          />

          {isComplete ? (
            <DayCompleteCard
              dateKey={dateKey}
              items={entry.items
                .map((item) => item.text.trim())
                .filter((text) => text !== "")}
              notes={entry.notes.trim()}
              cipher={entry.cipher}
              inWorkspace={workspace !== null}
              onReview={() => changeTab("history")}
            />
          ) : (
            <>
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
            </>
          )}

          <WorkspaceFeed
            dateKey={dateKey}
            refreshToken={syncedAt}
            active={tab === "write"}
            onRestore={handleRestore}
            onDelete={handleDelete}
          />
        </div>

        <p className="mt-4 text-center text-[11px] leading-relaxed text-ink-muted">
          {formatFullDate(dateKey)}的明文只存在這個頁面的記憶中，重新整理後會重新開始；
          只有加密字串適合離開這台裝置。
        </p>

        <ActionBar
          mode={isComplete ? "done" : "edit"}
          canSave={hasContent}
          canSubmit={canSubmit}
          hasPassphrase={hasPassphrase}
          busy={busy}
          message={feedback}
          onSaveDraft={handleSaveDraft}
          onEdit={() => setEditing(dateKey)}
        />
      </form>

      <div
        id="panel-history"
        role="tabpanel"
        aria-label="回顧"
        hidden={tab !== "history"}
      >
        <HistoryPanel
          localCiphers={localCiphers}
          refreshToken={syncedAt}
          active={tab === "history"}
          onDelete={handleDelete}
          existingDates={existingDates}
          onImport={importDays}
          onJumpToDate={(nextKey) => {
            handleDateChange(nextKey);
            changeTab("write");
          }}
        />
      </div>

      <div
        id="panel-settings"
        role="tabpanel"
        aria-label="設定"
        hidden={tab !== "settings"}
        className="space-y-4"
      >
        <PassphraseCard />

        <WorkspaceCard />

        {/* 進階：一般使用不會用到，所以獨立分組並排在最後 */}
        <section aria-labelledby="advanced-heading" className="pt-2">
          <h2
            id="advanced-heading"
            className="mb-2 px-1 text-[11px] font-medium tracking-widest text-ink-muted"
          >
            進階
          </h2>

          <CipherPanel
            // 換日期或產生新的加密字串時重設面板；單純編輯表單不會（savedAt 不變）。
            key={`${dateKey}:${entry.cipher?.savedAt ?? "none"}`}
            cipher={entry.cipher}
            onRestore={handleRestore}
          />
        </section>
      </div>
    </div>
  );
}
