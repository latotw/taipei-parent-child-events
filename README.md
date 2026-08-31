# 感恩日記 Gratitude Journal

一個溫暖、簡約、Mobile-First 的感恩日記首頁，使用 Next.js（App Router）＋ TypeScript ＋ Tailwind CSS。
日記內容在「暫存 / 送出」之前就會用瀏覽器標準的 Web Crypto API（AES-256-GCM）在客戶端加密完成。
目前所有狀態都以 React state 保存在頁面記憶體中，**尚未串接資料庫**，重新整理後會回到空白狀態。

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
npm run test:crypto  # 加密模組的行為測試（Node 內建 test runner）
```

## 畫面功能

| 區塊 | 說明 |
| --- | --- |
| 日期選擇器與當日狀態 | 前一天／後一天箭頭、原生 `<input type="date">`、「回到今天」捷徑；右側狀態標籤顯示「尚未填寫／已暫存／已送出」。未來的日期無法選取。 |
| 「三件事」動態欄位 | 預設 3 格，可「再加一件」（最多 5 格）或逐格刪除（至少保留 1 格）；標題右側即時顯示「已寫 N / M」。 |
| 其他（Notes） | 較大的多行文字方塊，附 500 字上限與字數計數。 |
| 共用解密密碼 | 設定／更改／清除密碼的介面，含二次確認、最少 6 字、顯示密碼切換。密碼只放在記憶體裡。 |
| 暫存 / 送出 | 底部 sticky 按鈕列。有任何內容才能「暫存」；至少寫滿一件事才能「送出」。兩者都會先加密再更新狀態，送出時並會清掉全空的欄位。 |
| 加密內容與解密驗證 | 可收合面板：顯示這一天的加密字串（可複製、也可貼上外部字串），輸入密碼即可解密還原並「填回表單」。 |

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
│   ├── PassphraseProvider.tsx # 共用密碼的 context（只存在記憶體）
│   ├── PassphraseCard.tsx   # 設定 / 更改 / 清除密碼的介面
│   ├── ThreeThingsList.tsx  # 「三件事」動態增減欄位
│   ├── NotesField.tsx       # 其他 (Notes) 文字方塊
│   ├── CipherPanel.tsx      # 加密字串顯示 + 解密驗證 + 填回表單
│   ├── ActionBar.tsx        # 暫存 / 送出（都會先加密）
│   └── StatusBadge.tsx      # 當日狀態標籤
└── lib/
    ├── crypto.ts            # AES-GCM 加解密模組
    ├── crypto.test.mts      # 加密模組測試
    ├── date.ts              # 日期 key、格式化、問候語
    └── types.ts             # DayEntry / CipherRecord / JournalPayload
```

## 加密設計

```
使用者密碼 ──PBKDF2-SHA256（隨機 salt, 600,000 次）──▶ AES-256 金鑰
日記 JSON ──AES-GCM（隨機 96-bit IV）──▶ 加密字串
```

加密字串（envelope）格式，以 `.` 分隔、各段皆為 base64：

```
GJ1.<iterations>.<salt>.<iv>.<ciphertext+tag>
```

- 迭代次數採 OWASP 對 PBKDF2-HMAC-SHA256 的建議值，並寫在加密字串裡，日後調整不會讓舊字串解不開。
- **每次加密都重新產生 salt 與 IV**，所以同樣的內容兩次加密結果不同，也不會出現 AES-GCM 最致命的 key + IV 重用。
- 版本前綴與迭代次數會一起送進 AES-GCM 的 `additionalData`，被偷改就會驗證失敗，而不是安靜地算出另一組金鑰。
- 密碼只放在 React context（記憶體）裡：不寫 localStorage、不寫 cookie、不進 URL。重新整理要重新輸入，忘記密碼就無法還原。
- 明文只在瀏覽器的表單狀態中；`暫存` / `送出` 都是**先加密成功才更新狀態**，加密失敗（沒設密碼、沒有內容）就什麼都不動並顯示提示。要接後端時，送出去的只有 `cipher.text`。
- 表單在加密之後又被改動時，舊的加密字串會標記為「過期」並提示重新加密，避免拿到對不上內容的字串。

`lib/crypto.ts` 匯出：

| 函式 | 說明 |
| --- | --- |
| `encryptJournal(payload, passphrase)` | 把 `JournalPayload`（三件事 + 其他）加密成單一字串 |
| `decryptJournal(envelope, passphrase)` | 還原成 `JournalPayload`，並驗證解出來的結構 |
| `describeCryptoError(error)` | 把例外轉成可以直接顯示的中文訊息 |
| `CryptoError` / `CryptoErrorCode` | 帶代碼的例外：`EMPTY_PASSPHRASE`、`EMPTY_CONTENT`、`EMPTY_CIPHERTEXT`、`BAD_ENVELOPE`、`WRONG_PASSPHRASE`、`CORRUPT_PAYLOAD`、`UNSUPPORTED` |

需要注意的限制：Web Crypto 只在 secure context（HTTPS 或 localhost）可用；
另外密碼強度就是安全上限，PBKDF2 能拖慢暴力破解但救不了太短的密碼。

## 設計方向

暖色紙感的單一亮色主題，色票定義在 `globals.css` 的 `@theme` 中（Tailwind v4）：

- `paper` / `paper-deep`：米白背景
- `card` / `line`：卡片與描線
- `ink` / `ink-soft` / `ink-muted`：三層文字灰
- `clay` / `clay-deep` / `clay-soft`：陶土色主要動作
- `leaf` / `leaf-soft`：「已送出」的綠

版面以 `max-w-md` 為主，觸控目標至少 44px，底部按鈕列有 `env(safe-area-inset-bottom)` 的安全間距。

## 後續可以接的東西

- 串接資料庫或 API（在 `persist()` 加密成功之後把 `cipher.text` 送出去）
- 歷史列表與月曆檢視、連續天數統計
- 登入與多使用者
