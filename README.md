# the-ultimate-dd-tool

> Codex 版本的啟動、模型設定與代理適配請讀 [CODEX.md](CODEX.md)。

# DD Q-list 引擎

VC 盡職調查的 Q-list 助手。收到新創的 Data Room 後消化文件、找出缺漏與疑點、獨立提出問題清單，與人工版本合併定稿，並支援多輪追問到結案。四個 persona（財務偵探、營運操盤手、產業分析師、投委會老鳥）平行出題，每輪蒸餾把砍題原因與盲區寫回題庫。

引擎的完整工作規範見 [`AGENTS.md`](AGENTS.md)，活題庫在 [`knowledge/question-bank.md`](knowledge/question-bank.md)，本地操作介面見 [`_workbench/README.md`](_workbench/README.md)。

## 這個 repo 有什麼、沒有什麼

**有**：引擎本身 — 工作規範、題庫、`_workbench/` 本地薄殼介面（Node server ＋ 單頁前端）、以及演練用的假資料。

**沒有**：任何真實客戶的 Data Room。實際案件資料夾一律由 `.gitignore` 白名單擋在版控之外，不會進 repo。這是刻意的設計：`.gitignore` 預設忽略頂層一切，只放行確定不含機密的引擎檔案，新增的客戶資料夾會被預設擋下。

想試跑，用 `演練資料_AcmeRobotics/`（埋了幾個地雷的假案，供引擎驗收）。

## 快速上手

```sh
python3 -m pip install -r _workbench/requirements.txt   # 索引層（pymupdf、openpyxl、python-pptx…）
cd _workbench && npm install && cd ..                   # 安裝 OpenAI SDK 與 Codex CLI（必要）
node _workbench/server.js                               # 起本地工作台，開 http://127.0.0.1:8765
```

真實模式需 OpenAI API key 或 Codex 登入，細節見 `CODEX.md`。Mock 模式用 `QLIST_MOCK=1 node _workbench/server.js`。黑客松版新增的可定位層、矛盾圖、串流問答、代理時間軸與 demo 腳本見 [`HACKATHON.md`](HACKATHON.md)。

## 資料夾慣例

```
<案名>/
├── round1/、round2/…   # 每輪對方提供的原始文件
├── _notes.md           # 文件外情報（pipeline 每輪必讀）
├── _analysis/          # 字卡、對帳表、草稿、diff 報告
└── qlist/              # 各輪最終發出版
knowledge/question-bank.md   # 活題庫
```
