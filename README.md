# 感恩日記 Gratitude Journal

一個溫暖、簡約、Mobile-First 的感恩日記首頁，使用 Next.js（App Router）＋ TypeScript ＋ Tailwind CSS。
目前所有互動都以 React state 保存在頁面記憶體中，**尚未串接資料庫**，重新整理後會回到空白狀態。

> 註：本 repo 原有的 `activities.json`、`親子館活動_*.json` 等資料檔案並未變動，仍保留在根目錄。

## 開始開發

```bash
npm install
npm run dev      # http://localhost:3000
```

其他指令：

```bash
npm run build    # 產生 production build（同時做 TypeScript 型別檢查）
npm run start    # 啟動 production server
npm run lint     # ESLint
```

## 畫面功能

| 區塊 | 說明 |
| --- | --- |
| 日期選擇器與當日狀態 | 前一天／後一天箭頭、原生 `<input type="date">`、「回到今天」捷徑；右側狀態標籤顯示「尚未填寫／已暫存／已送出」。未來的日期無法選取。 |
| 「三件事」動態欄位 | 預設 3 格，可「再加一件」（最多 5 格）或逐格刪除（至少保留 1 格）；標題右側即時顯示「已寫 N / M」。 |
| 其他（Notes） | 較大的多行文字方塊，附 500 字上限與字數計數。 |
| 暫存 / 送出 | 底部 sticky 按鈕列。有任何內容才能「暫存」；至少寫滿一件事才能「送出」。送出時會自動清掉全空的欄位，並顯示提示訊息。 |

其他細節：

- 每一天的內容各自保存在 `Record<dateKey, DayEntry>` 中，切換日期不會互相覆蓋，切回來內容還在。
- 已送出的那一天若再被修改，狀態會自動退回「已暫存」，提醒使用者重新送出。
- 日期一律以「本地時區的 `YYYY-MM-DD`」當 key，避免 `toISOString()` 造成跨時區差一天。

## 專案結構

```
src/
├── app/
│   ├── globals.css          # Tailwind v4 進入點 + 暖色系 design tokens
│   ├── layout.tsx           # 根 layout（zh-Hant-TW、viewport、metadata）
│   └── page.tsx             # 首頁（server component）
├── components/
│   ├── JournalLoader.tsx    # 以 dynamic(ssr:false) 載入日記，避免時區造成 hydration 不一致
│   ├── JournalSkeleton.tsx  # 載入中的骨架畫面
│   ├── GratitudeJournal.tsx # 唯一持有狀態的容器元件
│   ├── DateNavigator.tsx    # 日期選擇器 + 狀態標籤
│   ├── ThreeThingsList.tsx  # 「三件事」動態增減欄位
│   ├── NotesField.tsx       # 其他 (Notes) 文字方塊
│   ├── ActionBar.tsx        # 暫存 / 送出
│   └── StatusBadge.tsx      # 當日狀態標籤
└── lib/
    ├── date.ts              # 日期 key、格式化、問候語
    └── types.ts             # DayEntry / GratitudeItem / DayStatus
```

## 設計方向

暖色紙感的單一亮色主題，色票定義在 `globals.css` 的 `@theme` 中（Tailwind v4）：

- `paper` / `paper-deep`：米白背景
- `card` / `line`：卡片與描線
- `ink` / `ink-soft` / `ink-muted`：三層文字灰
- `clay` / `clay-deep` / `clay-soft`：陶土色主要動作
- `leaf` / `leaf-soft`：「已送出」的綠

版面以 `max-w-md` 為主，觸控目標至少 44px，底部按鈕列有 `env(safe-area-inset-bottom)` 的安全間距。

## 後續可以接的東西

- 串接資料庫或 API（把 `handleSaveDraft` / `handleSubmit` 換成實際寫入）
- 歷史列表與月曆檢視、連續天數統計
- 登入與多使用者
