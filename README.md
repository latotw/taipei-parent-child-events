# 感恩日記 Gratitude Journal

一個溫暖、簡約、Mobile-First 的感恩日記首頁，使用 Next.js（App Router）＋ TypeScript ＋ Tailwind CSS。
日記內容在「暫存 / 送出」之前就會用瀏覽器標準的 Web Crypto API（AES-256-GCM）在客戶端加密完成，
再同步到兩人共用的 Supabase Workspace——伺服器端只看得到加密字串。
沒設定 Supabase 也能用，只是不同步。

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
npm test               # 全部單元測試（Node 內建 test runner）
npm run test:crypto    # 加密模組
npm run test:sync      # 同步層的純函式與錯誤對照
npm run test:calendar  # 月曆格子計算
npm run test:backup    # 匯出格式
```

要開啟兩人同步，把 `.env.example` 複製成 `.env.local` 並填入 Supabase 的兩個值，
再到 SQL Editor 執行 `supabase/schema.sql`，最後在 Authentication → Providers
開啟 **Anonymous sign-ins**（本專案不需要註冊帳號，用匿名 session 當身分）。

## 畫面功能

介面分成三個分頁（頂端 tab，滑動時固定在上方）：

| 分頁 | 內容 |
| --- | --- |
| **寫日記** | 日期選擇器與當日狀態、「三件事」、其他 (Notes)、這一天的共享內容，底部是暫存／送出 |
| **回顧** | 回顧月曆、點選日期後的解密內容、資料匯出 |
| **設定** | 共用解密密碼、兩人共享（Workspace 與邀請碼）、加密內容與解密驗證 |

分頁是同一個頁面內的切換（用 `hidden` 屬性，不卸載元件），不是不同的 route——
因為所有明文與密碼都只存在記憶體裡，換 route 會把日記清空。
好處是切分頁不會弄丟月曆選到的日期或解密結果；代價是網址不會跟著變。
「設定」分頁在還沒設密碼時會出現一個小紅點提醒。

各區塊細節：

| 區塊 | 說明 |
| --- | --- |
| 日期選擇器與當日狀態 | 前一天／後一天箭頭、原生 `<input type="date">`、「回到今天」捷徑；右側狀態標籤顯示「尚未填寫／已暫存／已送出」。未來的日期無法選取。 |
| 「三件事」動態欄位 | 預設 3 格，可「再加一件」（最多 5 格）或逐格刪除（至少保留 1 格）；標題右側即時顯示「已寫 N / M」。 |
| 其他（Notes） | 較大的多行文字方塊，附 500 字上限與字數計數。 |
| 共用解密密碼 | 設定／更改／清除密碼的介面，含二次確認、最少 6 字、顯示密碼切換。密碼只放在記憶體裡。 |
| 暫存 / 送出 | 底部 sticky 按鈕列。有任何內容才能「暫存」；至少寫滿一件事才能「送出」。兩者都會先加密再更新狀態，送出時並會清掉全空的欄位。 |
| 加密內容與解密驗證 | 可收合面板：顯示這一天的加密字串（可複製、也可貼上外部字串），輸入密碼即可解密還原並「填回表單」。 |
| 兩人共享 | 建立 Workspace 取得邀請碼，或用邀請碼加入；顯示成員、邀請碼狀態、離開 Workspace。 |
| 這一天的共享內容 | 從 Workspace 讀回當天兩人的加密字串，在本機解密後顯示；可以把某一則填回表單，也可以刪掉自己那則。 |
| 回顧月曆 | 標出哪幾天有紀錄（兩人都寫就兩個點），點日期即用共用密碼解密呈現，可「切到這一天」（會自動跳回寫日記分頁）或刪除自己那則。 |
| 資料匯出 | 一鍵下載完整紀錄的 JSON——加密備份或解密後的明文備份。 |

其他細節：

- 每一天的內容各自保存在 `Record<dateKey, DayEntry>` 中，切換日期不會互相覆蓋，切回來內容還在。
- 「這一天的共享內容」與「回顧」的日期內容共用 `EntryList`，兩邊的呈現一定一致。
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
│   ├── WorkspaceProvider.tsx # Workspace 狀態（自動連線、建立、加入、離開）
│   ├── WorkspaceCard.tsx    # 夫妻配對與邀請碼介面
│   ├── WorkspaceFeed.tsx    # 當天兩人的加密資料，讀回後在本機解密
│   ├── TabBar.tsx           # 三個分頁的切換列
│   ├── EntryList.tsx        # 共用的日記呈現（共享列表與回顧都用這個）
│   ├── ConfirmButton.tsx    # 破壞性動作的行內二次確認
│   ├── HistoryPanel.tsx     # 回顧分頁：月曆 + 該日解密內容 + 匯出
│   ├── CalendarView.tsx     # 月曆格子（純呈現）
│   ├── BackupPanel.tsx      # JSON 匯出（加密／明文）
│   ├── ActionBar.tsx        # 暫存 / 送出（都會先加密）
│   └── StatusBadge.tsx      # 當日狀態標籤
└── lib/
    ├── crypto.ts            # AES-GCM 加解密模組
    ├── crypto.test.mts      # 加密模組測試
    ├── date.ts              # 日期 key、格式化、問候語
    ├── types.ts             # DayEntry / CipherRecord / JournalPayload
    └── supabase/
        ├── client.ts        # 瀏覽器端 Supabase client（沒設定就整組關閉）
        ├── errors.ts        # SyncError 與 Postgres 錯誤代碼對照
        ├── invite.ts        # 邀請碼／標籤的純函式
        ├── workspace.ts     # 登入、建立/加入 Workspace、加密日記讀寫
        └── workspace.test.mts

supabase/
├── schema.sql               # 資料表、RLS、邀請機制的 RPC
└── tests/
    ├── 00-emulate-supabase.sql  # 在本機 Postgres 補上 auth schema 與角色
    └── 01-rls.test.sql          # RLS / 邀請碼 / trigger / CHECK 的行為測試
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

## 兩人共享（多租戶）

### 資料表

`supabase/schema.sql` 建三張表，日記那張**只有**四樣東西是資料本體：

| 欄位 | 說明 |
| --- | --- |
| `workspace_id` | 屬於哪一對的空間 |
| `entry_date` | 日期（`date`） |
| `author_label` | 使用者標籤（顯示用暱稱，由 trigger 從成員資料帶入） |
| `ciphertext` | AES-256-GCM envelope |

另外有 `author_id`（RLS 用來判斷「只能改自己的」）與時間戳記。
`ciphertext` 有 CHECK 約束**只接受 envelope 格式**，所以就算客戶端寫錯，
明文也不可能進到資料庫——這是「伺服器端無從得知明文」的第二道保險。

### 邀請機制

```
User A ──create_workspace(label, probe)──▶ workspace + 邀請碼（10 碼 hex，40 bits 亂數）
                                            │
                        把 9F3A-1C7B-2D 給另一半
                                            ▼
User B ──join_workspace(code, label)────▶ 成為同一個 workspace 的成員（上限兩人）
                                            │
                              湊滿兩人 → 邀請碼自動失效
```

兩個 RPC 都是 `security definer`：非成員讀不到 `workspaces`（RLS），
所以「用邀請碼查 workspace」這件事只能由函式代辦。其他細節：

- 邀請碼用 `gen_random_bytes` 產生（不是 `random()`），預設 7 天到期。
- 「不存在」與「已過期」回同一個錯誤，不給猜碼的人任何提示。
- 成員可以 `rotate_invite_code()` 重新產生；舊碼立刻失效。
- 未登入的 `anon` 角色對三張表都沒有任何權限。

### 兩人各自的密碼

**兩人必須使用同一組共用密碼**，否則解不開對方的內容——密碼是唯一的金鑰來源，
伺服器沒有任何備份。為了不讓人踩到這個坑，workspace 上會存一份
`passphrase_check`（用共用密碼加密的固定字串）：

- 建立 workspace 時若已設好密碼，就順手登記。
- 之後有人輸入密碼，客戶端會拿它比對，不一致就直接在畫面上警告。
- 真的解不開某一則時，那一則會顯示「兩人要使用同一組共用密碼」，而不是靜靜地空白。

### 寫入與讀取的順序

```
表單 ──encryptJournal()──▶ envelope ──pushEntry()──▶ Supabase
                                                        │
Supabase ──pullEntries()──▶ envelope ──decryptJournal()──▶ 畫面
```

加密一定發生在網路之前：`persist()` 是先加密成功才會 `pushEntry`，
上傳失敗也只是提示「已在本機加密，但同步失敗」，內容不會消失。
匿名登入的 JWT 會存在 localStorage（那是身分，不是金鑰）；共用密碼只在記憶體裡。

## 歷史回顧與資料匯出

### 月曆

`lib/calendar.ts` 只負責格子的算術（週日對齊、跨月跨年、閏年、補滿鄰月），
是純函式所以測得起來；`CalendarView` 只負責畫。標記來自兩個地方的聯集：

- **Workspace**：`pullEntryDates()` 只查當月的 `entry_date / author_label`，不撈 ciphertext——
  標記日期不需要內容。
- **本機**：這個分頁裡已經加密過的日子（離線模式下這就是全部）。

一天有幾則就畫幾個點（最多兩個），今天有描邊，未來的日期不能點。

### 點日期 → 解密

點下去才抓那一天的 ciphertext 並用共用密碼解密（每則都要跑一次 PBKDF2，
所以刻意不預先全部解開）。解不出來時會說明原因——沒輸入密碼，或當時用的是另一組密碼——
而不是顯示空白。

### 資料匯出（JSON Backup）

兩種格式，都在客戶端組出來後直接下載：

| 格式 | 內容 | 適合 |
| --- | --- | --- |
| 加密備份 | 原始 envelope，附上格式說明 | 丟到任何地方存放；還原時需要當時的共用密碼 |
| 明文備份 | 解密後的三件事與 Notes | 真正拿回自己的資料；**檔案沒有任何保護** |

- 檔名為 `gratitude-journal-YYYY-MM-DD-encrypted.json` / `-plain.json`，內含 `format` 與 `version` 便於日後解析。
- 本機與 Workspace 的紀錄會合併；同一天同一人兩邊都有時保留時間較新的那筆（`lib/backup.ts` 的 `collectEntries`）。
- 明文匯出若有紀錄解不開（例如密碼換過），那幾筆會以加密形式放進 `undecryptable`，並在畫面上說有幾筆——不會靜靜消失。

## 設計方向

暖色紙感的單一亮色主題，色票定義在 `globals.css` 的 `@theme` 中（Tailwind v4）。
**色票深度是按 WCAG AA（一般文字 4.5:1）算出來的**，不是憑感覺挑的——
`globals.css` 的註解記了每個關鍵組合的實際比值，改顏色時請一併重算：

- `paper` / `paper-deep`：米白背景
- `card` / `line`：卡片與描線
- `ink` / `ink-soft` / `ink-muted`：三層文字灰
- `clay` / `clay-deep` / `clay-soft`：陶土色主要動作
- `leaf` / `leaf-soft`：「已送出」的綠

版面以 `max-w-md` 為主，底部按鈕列有 `env(safe-area-inset-bottom)` 的安全間距。

觸控目標：一般按鈕至少 44px。月曆例外——320px 寬的螢幕上七欄各要 44px 寬在幾何上不可能
（7×44 = 308px 已超過可用寬度），所以改為保證高度 44px，並在小螢幕收緊留白把寬度撐到 37px
（375px 以上為 45×44）。

高風險動作有意加上摩擦：

- 設定或更改共用密碼要勾選一個確認，因為密碼是唯一的金鑰，
  而且**更改密碼不會重新加密舊紀錄**——換了之後舊的內容就需要原本的密碼才打得開，
  所以更改時會建議先下載一份備份。
- 刪除日記、離開 Workspace、清除密碼、下載明文備份都會就地展開一行問句（`ConfirmButton`），
  說明後果之後才給「確定」。不用 `window.confirm`：它無法配合版面、會鎖住整頁，
  而且在某些嵌入情境會被瀏覽器擋掉。

刪除的範圍是「某一天自己寫的那則」：Workspace 上的那列與本機的內容一起清掉，
另一半寫的不受影響（RLS 也擋著，UI 只對自己的紀錄顯示刪除入口）。
遠端刪除失敗時本機不動，免得畫面上看起來刪了、其實對方還看得到。

## 測試

| 範圍 | 怎麼跑 |
| --- | --- |
| 加密模組（roundtrip、錯誤代碼、竄改偵測） | `npm run test:crypto` |
| 同步層純函式與錯誤對照 | `npm run test:sync` |
| 月曆格子計算（跨月、跨年、閏年、週日對齊） | `npm run test:calendar` |
| 匯出格式（合併去重、檔名、解不開的處理） | `npm run test:backup` |
| 型別與建置 | `npm run build` |
| RLS / 邀請碼 / trigger / CHECK | 對一個**本機**測試用 Postgres 依序執行 `supabase/tests/00-emulate-supabase.sql`、`supabase/schema.sql`、`supabase/tests/01-rls.test.sql`（測試檔含 `truncate`，不要對正式專案執行） |

## 後續可以接的東西

- 深色模式：現在是單一亮色主題，睡前用會偏亮
- 把明文狀態搬進可持久化的層（例如 IndexedDB）之後，分頁就能改成真正的 route，網址與上一頁／下一頁才會跟著動
- Realtime：`schema.sql` 最後有一行註解掉的 publication，開啟後另一半寫入時可以即時更新
- 歷史列表與月曆檢視、連續天數統計
- 用 email / OAuth 取代匿名登入，讓同一個人換裝置也能接回 workspace
