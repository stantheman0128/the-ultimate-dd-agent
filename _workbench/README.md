> 本版本使用 Codex／OpenAI，操作與設定以根目錄 [CODEX.md](../CODEX.md) 為準。下列工作台功能沿用原引擎。

# Q-List 工作台（本地薄殼）

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
| 專案對話 | `/api/ask` SSE 多輪對話；文件導覽 → 搜尋片段 → 按需讀取原文。需要 OpenAI API key；詳見 [對話設計](CHAT_DESIGN.md) |
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
