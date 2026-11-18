import os, base64, requests
import calendar
from html import escape
from typing import Optional, Tuple
from pathlib import Path
from playwright.sync_api import sync_playwright
from bs4 import BeautifulSoup
import json, csv, re, smtplib
from datetime import datetime, date
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

WEEKDAY_MAP = {0: "一", 1: "二", 2: "三", 3: "四", 4: "五", 5: "六", 6: "日"}

# === Google Sheet 設定 ===
GSHEET_KEY_PATH = Path(os.getenv("GSHEET_KEY_PATH", str(Path.home() / "Desktop" / "親子館活動" / "forautomation.json")))
GSHEET_SPREADSHEET_ID = "1NlzDoTerXESuPxl9nTZGFzYHIcsbQXGamp3J3uUjglk"

# === 登入狀態存儲路徑 ===
OUTPUT_DIR = Path(os.getenv("OUTPUT_DIR", str(Path.home() / "Desktop" / "親子館活動")))
STORAGE_STATE_PATH = OUTPUT_DIR / "playwright_state.json"

# === 小朋友 & 篩選設定 ===
CHILD_BIRTHDAY = date(2024, 10, 13)  # 威許的生日

# === Email 設定 ===
GMAIL_SENDER = "weishanyin.tw@gmail.com"
GMAIL_RECIPIENTS = ["weishanyin.tw@gmail.com", "zonghanyou@gmail.com"]
# 為安全起見，不把密碼放在程式中。可用環境變數或本機隱藏檔。
GMAIL_PASSWORD_FILE = OUTPUT_DIR / ".gmail_app_password"
# 搜尋本月和下個月。設為 2 可搜尋到下下個月。
SEARCH_MONTHS_AHEAD = max(0, int(os.getenv("SEARCH_MONTHS_AHEAD", "1")))
SHEET_HEADERS = ["館別", "活動名稱", "活動日期", "活動是星期幾", "活動時間",
                 "報名開始日期", "報名狀態", "對象", "限制最小月齡", "限制最大月齡"]
FILTERED_TAB_TITLE = "威許適合的活動"
HISTORY_TAB_TITLE = "通知歷史"


def load_gmail_password() -> str:
    """優先使用環境變數；排程也可從本機隱藏檔讀取。"""
    password = os.getenv("GMAIL_APP_PASSWORD", "").strip()
    if password:
        return password.replace(" ", "")
    if GMAIL_PASSWORD_FILE.is_file():
        return GMAIL_PASSWORD_FILE.read_text(encoding="utf-8").strip().replace(" ", "")
    return ""



def get_child_age_months() -> int:
    """根據威許的生日，計算目前的月齡。"""
    today = date.today()
    months = (today.year - CHILD_BIRTHDAY.year) * 12 + (today.month - CHILD_BIRTHDAY.month)
    if today.day < CHILD_BIRTHDAY.day:
        months -= 1
    return max(months, 0)


def label_to_months(label: str):
    if not label:
        return None
    exclusive = False
    s = label
    if s.startswith("<"):
        exclusive = True
        s = s[1:]
    m = re.match(r"(\d+)y(\d+)m", s)
    if m:
        return (int(m.group(1)) * 12 + int(m.group(2)), exclusive)
    m = re.match(r"(\d+)y$", s)
    if m:
        return (int(m.group(1)) * 12, exclusive)
    m = re.match(r"(\d+)m$", s)
    if m:
        return (int(m.group(1)), exclusive)
    return None


def filter_activities(all_data: list) -> list:
    child_months = get_child_age_months()
    print(f"👶 威許目前月齡：{child_months} 個月（{child_months // 12} 歲 {child_months % 12} 個月）")

    filtered = []
    for row in all_data:
        # 1. 只看週末
        if row.get("活動是星期幾") not in ("六", "日"):
            continue

        # 2. 狀態篩選：嚴格只保留「我要報名」或「尚未開始報名」，直接排除額滿或結束
        status = row.get("報名狀態", "").strip()
        if status not in ("尚未開始報名", "我要報名"):
            continue

        # 【改進】改以「活動日期」來計算活動當天的月齡，避免因報名日提早而錯過
        activity_date_str = row.get("活動日期", "")
        target_months = child_months  # 預設為當前月齡
        if activity_date_str:
            try:
                act_dt = datetime.strptime(activity_date_str.strip(), "%Y/%m/%d")
                # 計算活動當天威許的月齡
                m_diff = (act_dt.year - CHILD_BIRTHDAY.year) * 12 + (act_dt.month - CHILD_BIRTHDAY.month)
                if act_dt.day < CHILD_BIRTHDAY.day:
                    m_diff -= 1
                target_months = max(m_diff, 0)
            except Exception:
                pass

        min_result = label_to_months(row.get("限制最小月齡", ""))
        max_result = label_to_months(row.get("限制最大月齡", ""))

        # 3. 排除純大人活動（例如 18y 以上）
        if min_result and min_result[0] >= 180:
            continue
        if max_result and max_result[0] >= 180:
            continue

        if min_result is None and max_result is None:
            filtered.append(row)
            continue

        # 4. 檢查最小月齡限制（以活動當天月齡為準）
        if min_result is not None:
            min_m, _ = min_result
            if target_months < min_m:
                continue

        # 5. 檢查最大月齡限制（以活動當天月齡為準，嚴格比對）
        if max_result is not None:
            max_m, exclusive = max_result
            if exclusive:
                if target_months >= max_m:
                    continue
            else:
                if target_months > max_m:
                    continue

        filtered.append(row)

    print(f"✅ 篩選結果：共 {len(filtered)} 筆符合條件的週末活動")
    return filtered



def _sheet_values(data: list, headers: list) -> list:
    return [[str(record.get(key, "") or "") for key in headers] for record in data]


def _write_current_sheet(worksheet, records: list) -> None:
    """覆蓋最新資料，並確認寫入內容與寄信資料一致。"""
    rows = [SHEET_HEADERS] + _sheet_values(records, SHEET_HEADERS)
    worksheet.clear()
    worksheet.update(range_name="A1", values=rows, value_input_option="RAW")
    worksheet.freeze(rows=1)
    worksheet.format("A1:J1", {"textFormat": {"bold": True}})

    actual = worksheet.get(f"A1:J{len(rows)}", value_render_option="UNFORMATTED_VALUE")
    # Sheets API 會移除每列末端的空白欄位，因此先補齊再比較。
    normalize = lambda data: [[str(v) for v in (row + [""] * (len(SHEET_HEADERS) - len(row)))]
                              for row in data]
    if normalize(actual) != normalize(rows):
        raise RuntimeError(f"Google Sheet「{worksheet.title}」寫入後驗證失敗")


def _append_notification_history(spreadsheet, filtered_data: list, run_id: str) -> str:
    """把當次通知永久追加到歷史分頁，並回傳指向該批資料的連結。"""
    import gspread
    try:
        history = spreadsheet.worksheet(HISTORY_TAB_TITLE)
    except gspread.exceptions.WorksheetNotFound:
        history = spreadsheet.add_worksheet(title=HISTORY_TAB_TITLE, rows=1000, cols=11)

    expected_headers = ["通知批次"] + SHEET_HEADERS
    current_headers = history.row_values(1)
    if not current_headers:
        history.update(range_name="A1", values=[expected_headers], value_input_option="RAW")
        history.freeze(rows=1)
        history.format("A1:K1", {"textFormat": {"bold": True}})
    elif current_headers != expected_headers:
        raise RuntimeError("通知歷史分頁欄位不符，為避免覆寫舊資料已停止寄信")

    history_rows = [[run_id] + row for row in _sheet_values(filtered_data, SHEET_HEADERS)]
    result = history.append_rows(history_rows, value_input_option="RAW", insert_data_option="INSERT_ROWS")
    updated_range = result.get("updates", {}).get("updatedRange", "")
    match = re.search(r"![A-Z]+(\d+):[A-Z]+(\d+)$", updated_range)
    if not match:
        raise RuntimeError(f"無法確認歷史資料寫入位置：{updated_range!r}")
    start_row, end_row = map(int, match.groups())
    if end_row - start_row + 1 != len(filtered_data):
        raise RuntimeError("歷史資料筆數與 Email 清單不一致")

    actual = history.get(f"A{start_row}:K{end_row}", value_render_option="UNFORMATTED_VALUE")
    # 僅對不可缺少的欄位及每筆紀錄的批次 ID 做逐筆驗證。
    if len(actual) != len(history_rows) or any(
        len(got) < 4 or [str(v) for v in got[:4]] != wanted[:4]
        for got, wanted in zip(actual, history_rows)
    ):
        raise RuntimeError("歷史資料讀回驗證失敗，因此不寄送通知")

    print(f"📚 已保存 {len(history_rows)} 筆通知歷史：{HISTORY_TAB_TITLE} {start_row}–{end_row} 列")
    return (f"https://docs.google.com/spreadsheets/d/{GSHEET_SPREADSHEET_ID}/edit"
            f"#gid={history.id}&range=A{start_row}%3AK{end_row}")


def send_email_notification(filtered_data: list, archived_sheet_url: str) -> bool:
    if not filtered_data:
        print("📭 沒有符合條件的活動，不寄信。")
        return True
    if not archived_sheet_url:
        print("⚠️ 缺少已驗證的歷史資料連結；停止寄信，避免 Email 和 Sheet 不一致。")
        return False

    password = load_gmail_password()
    if not password:
        print(f"⚠️ Gmail 密碼未設定。請設定 GMAIL_APP_PASSWORD 或建立 {GMAIL_PASSWORD_FILE}")
        return False

    child_months = get_child_age_months()
    today_str = datetime.now().strftime("%Y/%m/%d")
    subject = f"🎯 威許的週末親子館活動（{today_str}，共 {len(filtered_data)} 筆）"

    html_rows = ""
    for i, record in enumerate(filtered_data, 1):
        bg = "#f9f9f9" if i % 2 == 0 else "#ffffff"
        cells = [
            record.get("館別", ""), record.get("活動名稱", ""),
            f"{record.get('活動日期', '')}（{record.get('活動是星期幾', '')}）",
            record.get("活動時間", ""), record.get("報名開始日期", ""),
            record.get("報名狀態", ""), record.get("對象", "")
        ]
        html_rows += f'<tr style="background:{bg}">' + "".join(
            f'<td style="padding:8px;border:1px solid #ddd">{escape(str(cell))}</td>'
            for cell in cells
        ) + '</tr>'

    html_body = f"""
    <html><body>
    <p>Hi～以下是今天篩選出<b>威許</b>（目前 {child_months // 12} 歲 {child_months % 12} 個月）
       適合的<b>週末</b>親子館活動：</p>
    <table style="border-collapse:collapse;font-size:14px;font-family:sans-serif">
        <tr style="background:#4a90d9;color:white">
            <th>館別</th><th>活動名稱</th><th>活動日期</th><th>活動時間</th>
            <th>報名開始日期</th><th>報名狀態</th><th>對象</th>
        </tr>
        {html_rows}
    </table>
    <p style="margin-top:16px;color:#666;font-size:13px">
        📊 <a href="{escape(archived_sheet_url, quote=True)}">查看這封 Email 對應的活動清單（通知歷史）</a>
    </p>
    <p style="color:#777;font-size:12px">這是寄信當時的快照；最新的報名狀態仍以官方網站為準。</p>
    </body></html>
    """

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = GMAIL_SENDER
    msg["To"] = ", ".join(GMAIL_RECIPIENTS)
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    try:
        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
            server.login(GMAIL_SENDER, password)
            server.send_message(msg)
        print(f"📧 已寄出通知信到 {', '.join(GMAIL_RECIPIENTS)}")
        return True
    except Exception as e:
        print(f"⚠️ 寄信失敗：{e}")
        return False


def send_login_expired_alert():
    """當偵測到台北通登入過期時，發送警報信通知使用者"""
    subject = "⚠️ 【重要警報】台北通登入已過期，親子館自動爬蟲失效！"
    html_body = """
    <html><body>
    <h3 style="color: #d9534f;">哎呀！台北通登入過期了！</h3>
    <p>系統在背景執行自動化爬蟲時，發現無法通過身分驗證（已被導向登入頁面）。</p>
    <p><b>請盡快執行以下步驟手動更新 Cookie：</b></p>
    <ol>
        <li>打開終端機 (Terminal)</li>
        <li>輸入指令刪除舊狀態：<br><code>rm ~/Desktop/親子館活動/playwright_state.json</code></li>
        <li>手動執行一次腳本以重新登入：<br><code>python3 ~/Desktop/fetch_all_centers_final.py</code></li>
    </ol>
    </body></html>
    """
    password = load_gmail_password()
    if not password:
        print("⚠️ 無法寄送登入過期警報：未設定 Gmail 密碼")
        return
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = GMAIL_SENDER
    msg["To"] = ", ".join(GMAIL_RECIPIENTS)
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    try:
        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
            server.login(GMAIL_SENDER, password)
            server.send_message(msg)
        print("🚨 已寄出登入過期警告信！")
    except Exception as e:
        print(f"⚠️ 發送警告信失敗：{e}")


# ─── 輔助函式 ───

def zh_weekday_from_date(date_str: str) -> str:
    try:
        dt = datetime.strptime(date_str.strip(), "%Y/%m/%d")
        return WEEKDAY_MAP[dt.weekday()]
    except Exception:
        return ""

def zhnum_to_int(chn: str) -> int:
    chn = chn.replace("兩", "二")
    digits = {"零":0,"一":1,"二":2,"三":3,"四":4,"五":5,"六":6,"七":7,"八":8,"九":9}
    if chn == "十": return 10
    if chn.startswith("十") and len(chn) >= 2:
        return 10 + digits.get(chn[1], 0)
    if "十" in chn:
        parts = chn.split("十")
        high = digits.get(parts[0], 0) if parts[0] else 1
        low = digits.get(parts[1], 0) if len(parts) > 1 and parts[1] else 0
        return high * 10 + low
    if chn in digits: return digits[chn]
    m = re.search(r"\d+", chn)
    return int(m.group(0)) if m else 0

def replace_zhnums(text: str) -> str:
    def repl(m): return str(zhnum_to_int(m.group(0)))
    return re.sub(r"[零一二兩三四五六七八九十]+", repl, text)

def normalize_age_token(token: str) -> int:
    if not token: return 0
    t = token.strip()
    if "純大人" in t: return 18 * 12
    if "學齡前" in t: return 84
    t = replace_zhnums(t)
    t = re.sub(r"[滿\s]", "", t)
    m = re.search(r"(\d+)\s*歲\s*(\d+)\s*個?月", t)
    if m: return int(m.group(1)) * 12 + int(m.group(2))
    m = re.search(r"(\d+)\s*歲", t)
    if m: return int(m.group(1)) * 12
    m = re.search(r"(\d+)\s*個?月", t)
    if m: return int(m.group(1))
    m = re.search(r"(\d+)\s*y\s*(\d+)\s*m", t, re.I)
    if m: return int(m.group(1)) * 12 + int(m.group(2))
    m = re.search(r"(\d+)\s*y", t, re.I)
    if m: return int(m.group(1)) * 12
    m = re.search(r"(\d+)\s*m", t, re.I)
    if m: return int(m.group(1))
    return 0

def months_to_label(months: int) -> str:
    if months <= 0: return "0m"
    if months % 12 == 0: return f"{months // 12}y"
    y, m = divmod(months, 12)
    return (f"{y}y{m}m") if y else f"{m}m"

def parse_age_range(text: str):
    if not text: return ("", "")
    if "純大人" in text: return ("18y", "18y")
    t = re.sub(r"\s+", "", text)
    for sep in ["至", "~", "－", "-", "到"]:
        if sep in t:
            left, right = t.split(sep, 1)
            min_m = normalize_age_token(left)
            max_m = normalize_age_token(right)
            if not min_m and "未滿" in left: min_m = 0
            if max_m:
                prefix = "<" if "未滿" in right else ""
                return (months_to_label(min_m), prefix + months_to_label(max_m))
            return (months_to_label(min_m), "")
    if "以上" in t:
        min_m = normalize_age_token(t.split("以上")[0])
        return (months_to_label(min_m), "")
    if "以下" in t or "未滿" in t:
        # "未滿3歲" / "3歲以下" 兩種寫法均能解析；未滿不含上限。
        max_text = t.replace("未滿", "").replace("以下", "")
        max_m = normalize_age_token(max_text)
        prefix = "<" if "未滿" in t else ""
        return ("0m", prefix + months_to_label(max_m)) if max_m else ("", "")
    single = normalize_age_token(t)
    if single: return ("0m", months_to_label(single))
    if "學齡前" in t: return ("0m", months_to_label(84))
    return ("", "")

def parse_activity_fields(card, center_name: str):
    title_el = card.select_one("h5.title-pink")
    title = title_el.get_text(strip=True) if title_el else ""
    date_label = card.find("div", string=lambda x: x and "活動日期" in x)
    date_text = date_label.find_next_sibling().get_text(strip=True) if date_label else ""
    m_date = re.search(r"(\d{4}/\d{2}/\d{2})", date_text)
    activity_date = m_date.group(1) if m_date else ""
    m_wd = re.search(r"[（(]([一二三四五六日])[)）]", date_text)
    weekday_char = m_wd.group(1) if m_wd else (zh_weekday_from_date(activity_date) if activity_date else "")
    m_time = re.search(r"(\d{1,2}:\d{2})\s*[~－-]\s*(\d{1,2}:\d{2})", date_text)
    activity_time = f"{m_time.group(1)} ~ {m_time.group(2)}" if m_time else ""
    reg_label = card.find("div", string=lambda x: x and "報名日期" in x)
    reg_text = reg_label.find_next_sibling().get_text(strip=True) if reg_label else ""
    m_reg = re.search(r"(\d{4}/\d{2}/\d{2})\s+(\d{2}:\d{2})", reg_text)
    reg_start_date = m_reg.group(1) if m_reg else ""
    target_label = card.find("span", string=lambda x: x and "活動對象" in x)
    target_text = target_label.find_next_sibling().get_text(strip=True) if target_label else ""
    min_age, max_age = parse_age_range(target_text)
    btns = card.select("button")
    status_text = btns[-1].get_text(strip=True) if btns else ""

    return {
        "館別": center_name,
        "活動名稱": title,
        "活動日期": activity_date,
        "活動是星期幾": weekday_char,
        "活動時間": activity_time,
        "報名開始日期": reg_start_date,
        "報名狀態": status_text,
        "對象": target_text,
        "限制最小月齡": min_age,
        "限制最大月齡": max_age,
    }

def get_search_date_range(today: date) -> Tuple[str, str]:
    """本月第一天到 SEARCH_MONTHS_AHEAD 個月後的月底，可跨年。"""
    first = today.replace(day=1)
    month_index = today.year * 12 + today.month - 1 + SEARCH_MONTHS_AHEAD
    end_year, end_month_zero = divmod(month_index, 12)
    end_month = end_month_zero + 1
    end = date(end_year, end_month, calendar.monthrange(end_year, end_month)[1])
    return first.strftime("%Y/%m/%d"), end.strftime("%Y/%m/%d")


def fetch_activities_for_center(page, pfid, name):
    selector = "#pfid"
    page.wait_for_selector(selector, state="attached", timeout=10000)
    
    # 查詢本月與未來月份（預設下一個月）；避免漏掉提早開放報名的活動。
    first_day, last_day = get_search_date_range(date.today())

    # 透過 JS 設定館別、填入日期並觸發查詢
    page.evaluate("""({sel, val, sDate, eDate}) => {
        // 1. 設定館別
        const el = document.querySelector(sel);
        if (el) {
            el.value = val;
            el.dispatchEvent(new Event('change', { bubbles: true }));
        }

        // 2. 尋找並填入起訖日期欄位 (涵蓋常見的日期 input 命名)
        const sInput = document.querySelector("#ActDateS, #StartDate, #sDate, input[name*='DateS']");
        const eInput = document.querySelector("#ActDateE, #EndDate, #eDate, input[name*='DateE']");
        if (sInput) {
            sInput.value = sDate;
            sInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (eInput) {
            eInput.value = eDate;
            eInput.dispatchEvent(new Event('input', { bubbles: true }));
        }

        // 3. 點擊「查詢」按鈕
        const btn = document.querySelector("button[type='submit'], #btnSearch, input[value='查詢'], .btn-primary");
        if (btn) {
            btn.click();
        }
    }""", {"sel": selector, "val": pfid, "sDate": first_day, "eDate": last_day})

    # 等待查詢結果更新
    page.wait_for_timeout(3000)
    
    soup = BeautifulSoup(page.content(), "html.parser")
    cards = soup.select("#ActiveList > div") or soup.select("div.p-gray.mb-4.bgc-gray.p-4")
    activities = []
    for card in cards:
        try:
            rec = parse_activity_fields(card, name)
            if rec.get("活動名稱"):
                activities.append(rec)
        except Exception:
            continue
    return activities


def upload_to_google_sheet(all_data: list, filtered_data: list, run_id: str) -> Optional[str]:
    """先更新 Sheet、核對資料並保留歷史；成功才回傳 Email 專用連結。"""
    try:
        import gspread
    except ImportError:
        print("⚠️ 尚未安裝 gspread；為避免寄信但 Sheet 不同步，本次不寄信")
        return None

    if not GSHEET_KEY_PATH.is_file():
        print(f"⚠️ 找不到 Google Sheet 憑證：{GSHEET_KEY_PATH}；本次不寄信")
        return None

    try:
        gc = gspread.service_account(filename=str(GSHEET_KEY_PATH))
        sh = gc.open_by_key(GSHEET_SPREADSHEET_ID)
        _write_current_sheet(sh.sheet1, all_data)
        try:
            filtered_ws = sh.worksheet(FILTERED_TAB_TITLE)
        except gspread.exceptions.WorksheetNotFound:
            filtered_ws = sh.add_worksheet(title=FILTERED_TAB_TITLE, rows=200, cols=10)
        _write_current_sheet(filtered_ws, filtered_data)
        print(f"✅ 已同步最新活動 {len(all_data)} 筆，符合條件 {len(filtered_data)} 筆")

        if not filtered_data:
            return f"https://docs.google.com/spreadsheets/d/{GSHEET_SPREADSHEET_ID}/edit#gid={filtered_ws.id}"
        return _append_notification_history(sh, filtered_data, run_id)
    except Exception as e:
        print(f"⚠️ Google Sheet 上傳或驗證失敗，本次不寄信：{e}")
        return None


def upload_json_to_github(local_json_path: str, owner: str = "latotw", repo: str = "taipei-parent-child-events", branch: str = "main", repo_path: str = "activities.json", token_env: str = "GITHUB_TOKEN"):
    token = os.getenv(token_env)
    if not token or not os.path.exists(local_json_path):
        return False

    with open(local_json_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    content_bytes = json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8")
    b64_content = base64.b64encode(content_bytes).decode("utf-8")

    api_base = f"https://api.github.com/repos/{owner}/{repo}/contents/{repo_path}"
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"}

    sha = None
    r_get = requests.get(api_base, headers=headers, params={"ref": branch}, timeout=30)
    if r_get.status_code == 200:
        sha = r_get.json().get("sha")

    commit_message = f"chore: update activities.json ({datetime.now().strftime('%Y-%m-%d %H:%M')})"
    payload = {"message": commit_message, "content": b64_content, "branch": branch}
    if sha: payload["sha"] = sha

    r_put = requests.put(api_base, headers=headers, json=payload, timeout=60)
    return r_put.status_code in (200, 201)


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        has_saved_state = STORAGE_STATE_PATH.exists()
        
        # 設定固定桌面解析度，避免觸發 RWD 手機版收合選單
        viewport_setting = {"width": 1920, "height": 1080}

        if has_saved_state:
            print("🔄 發現已儲存的登入狀態，直接於背景執行自動爬取...")
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(
                storage_state=str(STORAGE_STATE_PATH),
                viewport=viewport_setting
            )
        else:
            print("🔐 首次執行：開啟瀏覽器，請手動登入「台北通」...")
            browser = p.chromium.launch(headless=False)
            context = browser.new_context(viewport=viewport_setting)

        page = context.new_page()
        page.goto("https://welfare.gov.taipei/Kids/ParentChild/ParentChildActivity", wait_until="domcontentloaded")

        # 🔍 核心防範機制：檢查是否被導向登入頁面（代表 Cookie 過期）
        current_url = page.url
        if "login" in current_url.lower() or "sso" in current_url.lower() or not has_saved_state:
            if has_saved_state:
                print("⚠️ 偵測到登入狀態已失效（被導向登入頁），發送警告信...")
                send_login_expired_alert()
                context.close()
                browser.close()
                return

        if not has_saved_state:
            input("✅ 完成登入並跳轉頁面後，請按 Enter 鍵以儲存狀態並繼續...")
            context.storage_state(path=str(STORAGE_STATE_PATH))
            print(f"💾 登入狀態已成功儲存至：{STORAGE_STATE_PATH}")

        parent_centers = {
            "1007": "大同親子館", "1008": "北投親子館", "1009": "中山親子館",
            "1010": "松山親子館", "1012": "文山親子館", "1013": "士林親子館",
            "1017": "內湖親子館", "1015": "萬華親子館", "1018": "南港親子館",
            "1020": "大安親子館", "1021": "信義親子館", "1022": "中正親子館",
            "1054": "廣慈親子館"
        }

        all_data = []
        for pfid, name in parent_centers.items():
            print(f"📍 擷取：{name}")
            try:
                data = fetch_activities_for_center(page, pfid, name)
                print(f"✅ {name} 共 {len(data)} 筆")
                all_data.extend(data)
            except Exception as e:
                print(f"⚠️ 擷取 {name} 失敗: {e}")

        context.close()
        browser.close()

        if not all_data:
            print("⚠️ 沒有擷取到任何活動資料")
            return

        # 輸出 JSON
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        ts_json_path = OUTPUT_DIR / f"親子館活動_{timestamp}.json"
        latest_json_path = OUTPUT_DIR / "latest.json"

        with open(ts_json_path, "w", encoding="utf-8") as f:
            json.dump(all_data, f, ensure_ascii=False, indent=2)
        with open(latest_json_path, "w", encoding="utf-8") as f:
            json.dump(all_data, f, ensure_ascii=False, indent=2)

        # 篩選、寫入 Google Sheet、寄信、上傳 GitHub
        filtered = filter_activities(all_data)
        archive_url = upload_to_google_sheet(all_data, filtered, run_id=timestamp)
        if archive_url:
            send_email_notification(filtered, archive_url)
        else:
            print("⛔ 因 Google Sheet 沒有完成同步，本次不發送活動通知 Email")
        if not upload_json_to_github(str(latest_json_path)):
            print("ℹ️ GitHub JSON 未更新（請檢查 GITHUB_TOKEN 與 GitHub 存取權限）")


if __name__ == "__main__":
    main()
