> 本版本使用 Codex／OpenAI，操作與設定以根目錄 [CODEX.md](../CODEX.md) 為準。下列工作台功能沿用原引擎。

# Q-List 工作台（本地薄殼）

## 本機 Codex CLI 啟動

已登入 `codex login` 後，可執行 `./_workbench/start-local.command`。啟動器關閉 Mock，指定 `$HOME/.local/bin/codex` 及專案 `.venv/bin/python`；可用 `CODEX_BIN` 覆寫 CLI 路徑。工作台位於 http://127.0.0.1:8765。批次 DD、單次問答與專案對話均可沿用 CLI 登入；未設定 API key 時不執行背景記憶整理。不要在另一個工作台已佔用 8765 時重複啟動。

五輪合成示範使用獨立案例 `演練資料_AcmeRobotics_五輪Demo`，詳見該案例的 `DEMO.md`。所有補件、公司回覆及輪次均為模擬，不代表實際寄送或五輪完整引擎執行。

包裝 headless Codex 引擎的本地介面。資料庫＝專案資料夾本身，工作台只是視圖＋遙控器，砍掉它資料一個位元都不會少。

## 啟動

在專案根目錄執行：
```sh
python3 -m pip install -r _workbench/requirements.txt
python3 _workbench/setup_ocr.py
(cd _workbench && npm install)
node _workbench/server.js
```
執行主機需保持運作。本匯出版沒有安裝系統常駐服務。

## 引擎認證

設定 `OPENAI_API_KEY`，或在側欄儲存 OpenAI API key。只跑 headless 可另設 `CODEX_API_KEY`，也可在執行主機執行 `_workbench/node_modules/.bin/codex login` 使用既有帳號登入。沒有認證時 mock 與文件瀏覽仍可用，真實模型功能會回報失敗。

## 假引擎模式（測試用）

```sh
QLIST_MOCK=1 node _workbench/server.js
```

跑流程只會輸出假 log、不呼叫 API、不花錢。適合演練操作。

## 檔案對照

| 介面動作 | 落到哪裡 |
|---|---|
| 上傳文件 | `案子/roundN/` |
| 刪除文件 | `案子/_analysis/_archive/`（永不硬刪） |
| 跑流程 | 引擎讀 AGENTS.md 執行，產出 `_analysis/`（字卡、facts.md、draft_RN.md），log 在 `_analysis/run.log` |
| 審核送出 | `_analysis/diff-reports/` ＋ `_analysis/drafts/merged_RN.xlsx` |
| 上傳最終版 | `案子/qlist/` ＋ 本輪標記已發出 |
| 備註 | `案子/_notes.md`（文件外情報，pipeline 每輪必讀） |
| ✓ 結案 | state 標記 closed ＋ 自動啟動蒸餾 |
| ⚗ 跑蒸餾 | 引擎讀 diff-reports/ 與 qlist/ → 寫回 knowledge/question-bank.md ＋ `_analysis/distill-report.md` |

## 黑客松版新增（詳見根目錄 HACKATHON.md）

| 介面動作 | 落到哪裡 |
|---|---|
| 上傳文件 | 同時背景建索引 `_analysis/index/<檔名>.index.json`（逐頁文字 / 逐格值與公式） |
| ⟳ 重建索引 | `python3 _workbench/index_doc.py <案件> --force` |
| 對帳分頁的矛盾圖 | 讀 `_analysis/facts.json`（reconciler 產出、`recompute.py` 驗算） |
| 點任何出處 [檔名 p.N] | 證據檢視器：原檔翻頁＋該頁索引文字 |
| 專案對話 | `/api/chat/ask` SSE 多輪對話；文件導覽 → 搜尋片段 → 按需讀取原文。支援 OpenAI API key 或本機 Codex CLI 登入；詳見 [對話設計](CHAT_DESIGN.md) |
| ⚡ 只消化這份 | `/api/ingest-one`：單檔字卡 → 增量對帳 → `drafts/draft_RN_delta.md` |
| 總覽的引擎活動 | `_analysis/run.events.jsonl`（Codex JSONL 適配事件流） |

環境變數：`CODEX_BIN`、`OPENAI_API_KEY`、`QLIST_ASK_MODEL`、`QLIST_ASK_EFFORT`、`QLIST_CODEX_MODEL`、`QLIST_CODEX_EFFORT`、`PYTHON_BIN`、`QLIST_MOCK`。

## 模型選擇

標題列控制 Codex 主 session 的模型，子代理預設繼承。主流程 effort 由 `QLIST_CODEX_EFFORT` 控制，即時問答由 `QLIST_ASK_MODEL`／`QLIST_ASK_EFFORT` 分開設定。模型可用性依帳號權限。

引擎規範見專案根目錄 AGENTS.md；活題庫在 knowledge/question-bank.md。

多格式中文索引：PDF、XLSX/XLSM、CSV/TSV、PPTX/DOCX、PNG/JPEG/WebP/TIFF/BMP/GIF 與純文字；用途摘要、OCR、視覺描述、失敗狀態及驗收詳見 [CHAT_DESIGN.md](CHAT_DESIGN.md)。

額外驗證：`python3 _workbench/tests/preprocessing_test.py`（先安裝依賴與 OCR 語言資料）。

## 對話記憶

輸入框上方「使用記憶」可調整跨案範圍、管理條目與查看來源。團隊通則及本案預設可用；背景整理另有模型用量。記憶位於 Git 忽略的 `_private_memory/`，詳見 [記憶設計與限制](MEMORY_DESIGN.md)。

## 第二輪設定、審題與學習

進階設定為雙 provider 模型／effort／persona 的唯一入口。搜尋頁的「單次文件問答」使用 `/api/ask`，超預算用 BM25 挑頁；專案對話的記憶與工具檢索仍獨立運作。

Reviewer 給建議，人審砍題需附理由。候選規則需在學習頁核准，下次派工才生效；升版方法論也需核准。每次執行的設定、規則與派工訊息保存在案件 runs 目錄。完整驗證與未驗證事項見根目錄 MIGRATION.md。

## DELTA：全文、視覺頁與陳述核對

原生索引預設零模型 token。PyMuPDF／openpyxl／python-pptx／python-docx 直接產生全文 JSON，保留頁、slide、儲存格與公式；沒有 PDF 轉 Markdown 步驟。`QLIST_INDEX_AI=1` 才額外產生 AI 導覽摘要，這是另計費的選用步驟，不取代原文。既有專案聊天與 FTS5 保留；本次未新增向量庫。

| 格式 | 索引與座標 | 圖片／特殊處理 |
|---|---|---|
| PDF | `pages[].text`、`tables[]` 列陣列，`p.N` | 文字 <30 字且有圖判掃描頁；可用時本地 Tesseract OCR；圖片聯集面積比 ≥0.20 或掃描頁標 `needs_visual` |
| PPTX | `pages[]`，文字／表格／備註／圖表 categories 與 series，`slide N` | picture 與圖表頁標視覺核對；LibreOffice → PDF → PNG |
| XLSX／XLSM | `sheets[].cells[]` 的值＋公式，`Sheet!B4` | 缺快取值用 LibreOffice 重算暫存副本；原檔與原公式保留，值標 `cache_source`；失敗顯示「公式無快取值」 |
| DOCX | 段落與表格，每 3,000 字一段，`段 N` | 非實體頁；嵌入圖片僅保留既有本地 OCR，完整圖片定位為 P2 |
| TXT／MD | 每 5,000 字一段，`段 N` | 全文保留 |
| CSV／TSV | 延用結構化儲存格，`資料!B4` | 保留既有可點擊格座標 |
| JPG／PNG／HEIC／WebP | `kind:image`，無文字，標 `needs_visual` | 解碼並依 EXIF 轉正為 PNG；HEIC 需 pillow-heif |

安裝 `_workbench/requirements.txt`；PPTX 渲染與公式重算另需 LibreOffice（可用 `LIBREOFFICE_BIN` 指定）。轉換使用暫存副本與獨立 profile，停用巨集與外部連結更新。缺轉換器時文字／原公式仍可用，視覺覆蓋不得冒稱完成。

`index_doc.py` 會為標記頁產生 `_analysis/index/_render/<檔名>/<N>.png`；文件頁的「圖 N 頁」可開圖。也可執行 `python3 _workbench/render_document.py "<案件>" "<檔名>" --page N`。渲染快取比對來源時間、大小與 schema；原檔變更須先重建索引。快取不進版控。

字卡固定五段：摘要、關鍵數字表、重要陳述（非數字）、未明名詞與疑點、覆蓋聲明。重要陳述表頭為 `| 陳述 | 原文摘錄 | 出處 |`，摘錄 ≤60 字；去空白後必須逐字存在於所引用頁，改寫即列 miss。合併保留並去重陳述列；產業與 IC persona 對每條陳述問依據、文件與例外，QC 將陳述漏抽計入漏抽率。沒有 OCR 可對照的圖上數字／陳述仍列 miss，須人工核對，不能把視覺模型的文字回填索引以自證正確。

## DELTA：代理搜尋與參數

```bash
python3 _workbench/search.py "<案件>" "毛利率" --top 20
python3 _workbench/search.py "<案件>" "related party" --top 5 --json
```

CLI 直接呼叫 server 的同一個評分函式，不需啟動 HTTP server（需 Node 與 npm dependencies）。輸出檔名、頁／格座標、分數、片段；reviewer 與 persona 先搜尋，再讀命中的頁／格。搜尋、CLI 與問 AI 共用 `metrics.json` 別名及既有同義詞；原詞權重 1、擴展詞 0.6，英文短別名採詞界匹配，避免把 Hardware 的 ar 當應收款。BM25 以一頁／工作表為單位；搜尋先排直接字串命中，再排其餘相關結果。

| 參數 | 值 |
|---|---|
| 掃描頁文字門檻／視覺圖面積比 | 30 字／0.20 |
| 視覺讀取批次 | 只讀標記頁，每次 ≤20 頁；估 1.5K token／頁 |
| 分片上限 | `QLIST_SHARD_TOKENS=60000` |
| token 估算式 | 拉丁字元 ÷3.2＋CJK ×1.2 |
| 核對門檻 | 命中率 ≥0.95，關鍵條款 miss=0，覆蓋完整 |
| QC | 每檔 3 頁，附註頁至少 1；xlsx 每 tab 20 格 |
| BM25 | k1=1.5、b=0.75；依索引 mtime 快取 |
| 搜尋上限／CLI 預設 | 60／20 |
| 問 AI 預算 | Claude 450,000；OpenAI 150,000，可在設定調整 |
| 問 AI 快取 | Claude ephemeral 1h；OpenAI 自動快取不可保證 |

Token 帳只作容量估算，不是實測用量：以約 41 萬原文 token 的案件，抽取約 41 萬＋每片約 3K prompt；QC 約 2–3 萬；對帳約 3–6 萬；4 個 persona 約 20 萬；reviewer 約 3–6 萬；主 session 約 5–10 萬，粗估全輪約 80–95 萬，視覺頁另加。索引、merge／verify／candidates 為程式，零模型 token。抽取全讀一次；其他代理通常只讀字卡／facts，QC 抽頁、reviewer 搜特定頁；下一輪只增量抽新文件。問 AI 另計，全案超預算時指名頁 ±1 加 BM25 挑頁。
