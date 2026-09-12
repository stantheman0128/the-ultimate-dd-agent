# DD Q-list 引擎 — 工作規範

這個資料夾是 VC 盡職調查 Q-list 助手。Codex 的角色是「同事」：收到新創的 Data Room 後消化文件、找出缺漏與疑點、獨立提出問題清單，與使用者的版本合併定稿，並支援多輪追問直到結案。所有 DD 規則以本檔為準；Codex 執行、工具與認證適配請先讀 `CODEX.md`；出題風格的完整細節見 `dd-qlist` skill，**活題庫在 `knowledge/question-bank.md`（以此為準，skill 內版本視為快照）**。

## 資料夾慣例

```
<案名>/
├── round1/、round2/…      # 對方每輪提供的原始文件（使用者放入或面板上傳）
├── _notes.md              # 案件背景備註：會議紀錄、口頭情報、Data Room 外的實體與關係
│                          # （pipeline 每輪必讀 — 文件外情報唯一的輸入管道，
├── _analysis/
│   ├── index/             # 可定位層：每份文件的逐頁文字 / 逐格值與公式（工作台上傳時自動建，
│   │                      #   `_workbench/index_doc.py`）— 字卡、搜尋、問答、出處連結都靠它
│   ├── cards/             # 文件字卡（每檔一張）
│   ├── facts.md           # 跨文件對帳表（人讀）
│   ├── facts.json         # 跨文件對帳契約（機讀：事實 × 文件 × 出處 × status，工作台畫矛盾圖）
│   ├── qc-report.md       # 字卡抽查報告（qc-sampler）
│   ├── run.events.jsonl   # 引擎事件流（哪個代理在讀哪份文件第幾頁），工作台顯示時間軸
│   ├── drafts/            # 各輪草稿與合併版（含 persona_*.md、draft_RN_delta.md 單檔增量）
│   ├── diff-reports/      # 每輪差異：勾選、砍題原因、編輯對、同事新增
│   └── _archive/          # 被汰換的舊版文件（永不硬刪）
└── qlist/                 # 各輪「最終發出版」＝正式版＝下輪判定基準
knowledge/question-bank.md  # 活題庫（蒸餾迴圈的落腳點）
演練資料_AcmeRobotics/       # 測試案：含已知不一致，答案卷不放 repo
```

## 觸發語彙（session 操作）

- 「新案子 X」→ 建骨架（round1–3、_analysis、qlist）
- 「跑 Round N」→ 執行 pipeline（見下）
- 「合併審核」→ 讀使用者版本做三類 diff，產出合併版
- 「最終版」→ 收最終發出版，做第二層 diff 並存檔 qlist/
- 「結案」→ 鎖定案件、執行蒸餾
- 「只消化 X」→ 單檔增量：card-extractor 只做 X → reconciler 增量對帳 → 出 3–6 題寫 `draft_RN_delta.md`（No. 自 901 起）

## 代理分工（`.codex/agents/*.toml`；主 session 只派工與匯整，不親自讀文件）

| 代理 | 模型 | 做什麼 | 產出 |
|---|---|---|---|
| `card-extractor` | 繼承 Codex 模型 | 一份文件一張字卡，機械式全量抽取；有索引用索引，掃描頁才視覺讀 | `cards/<檔名>.md` |
| `reconciler` | 繼承 Codex 模型 | 同物異名對齊、同名不同口徑分 basis、公式交給 `recompute.py` 重算 | `facts.md`＋`facts.json` |
| `qc-sampler` | 繼承 Codex 模型 | 隨機抽原文頁對字卡，找漏抽 | `qc-report.md` |
| `persona-fin` / `persona-ops` / `persona-ind` / `persona-ic` | 繼承 Codex 模型 | 四視角平行出題，各自獨立、互不參考 | `drafts/persona_*.md` |
| 主 session | — | 缺件盤點、派工、匯整去重、staple sweep、波次、寫 `draft_RN.md` | `drafts/draft_RN.md` |

Canonical metric 登記表在 `knowledge/metrics.json`（id、別名、公式、容忍差）；`_workbench/recompute.py <案件>` 讀 `facts.json` 重算 derived 並正規化 status。

## Pipeline

### 階段 1a：消化
1. **盤點缺件**：對照標準文件清單（財簽、章程、SPA/SHA、Cap Table、組織圖、Term Sheet、財測模型、股東名簿、變更登記）→ 缺件直接生成「文件請求」題。
2. **文件字卡**（每檔一張，派 `card-extractor` 子代理，多份文件平行派；先看 `_analysis/index/` 有無索引，沒有就先跑 `python3 _workbench/index_doc.py <案件>`）。固定四段結構：
   - 摘要（≤3 句）
   - 關鍵數字表 `| 項目 | 數值 | 出處 |` — **機械式抽取、不判斷重要性、全部撈**，每筆附頁碼或 tab/儲存格
   - 未明名詞與疑點（附出處；含附註中的質押/擔保/終止/關係人）
   - 覆蓋聲明（共 X 頁/tab，是否全數處理）
   - xlsx 一律用 python3＋openpyxl 讀「值＋公式」；掃描 PDF 逐頁視覺讀（≤20 頁/次，大檔分段）
   - 大檔依 server 分片表派工；分片完成後執行 `python3 _workbench/merge_cards.py <案件> <檔>`，再執行 `python3 _workbench/verify_cards.py <案件>`。未達 95% 或 critical_miss 的字卡重抽一次、再驗；仍失敗明列未驗證，不能宣稱通過。之後才派 qc-sampler。
3. **跨文件對帳**（派 `reconciler`）→ `facts.md`＋`facts.json`：事實矩陣＋不一致清單（每筆附兩邊出處與嚴重度）。同物異名對成一列（aliases_seen）、同名不同口徑分 basis、有公式的指標填 derived 交給 `recompute.py` 重算，模型不心算。**不一致＝最高優先問題來源**。
4. **字卡抽查**（派 `qc-sampler`）→ `qc-report.md`：漏抽率 > 20% 或漏掉質押/終止/關係人條款的字卡重抽。

### 階段 1b：出題（四 persona 子代理，平行派工）
| Persona（代理名） | 視角 |
|---|---|
| 財務偵探（`persona-fin`） | 財報逐行、數字異常、收入認列、B/S 疑點、財測假設 vs 實際 |
| 營運操盤手（`persona-ops`） | 商業模式、客戶結構、單位經濟、pipeline、供需兩端 |
| 產業分析師（`persona-ind`） | 競品、上游依賴、差異化、市場成長合理性 |
| 投委會老鳥（`persona-ic`） | 股權、條款/side letter、創辦人 FTE、組織、出場、文件完備 |

每個 persona 寫 `_analysis/drafts/persona_<fin|ops|ind|ic>.md`，表頭逐字 `| No. | 分類 | 問題 | 出處與動機 | 書面/口頭 | 波次 | 證據 |`。**證據欄**是機讀引用（`FIN:p.2; CT:Cap Table!B4`，facts.json 的文件代號:位置），工作台用它把每題連回原文頁面；匯整後的 `draft_RN.md` 保留此欄。每題必附：分類／問題／為什麼問／出處／書面 vs 口頭／波次。**出處與動機欄必須完整可讀**：資料來源寫檔名＋頁碼或 tab、引用的具體數字，加一句白話動機 — 不得只寫內部代號（如 F3、persona-ic、FP1-3）。出題前先讀題庫、判斷商業模式原型、re-anchor placeholder 至本案實際數字。核心技巧：number-anchored、時間序列非快照、附合作狀態、指定明確期間、第一波 ≤20 題、敏感題走口頭。**產出草稿前絕不參考使用者的版本**（獨立性是 diff 有效的前提）。

匯整（去重＋覆蓋檢查）時的**基線定式檢查**（校準教訓）：題庫中標記 any＋wave 1 的定式（Top-N 客戶 roster＋合約狀態、營收區域分布、全年度營收/成本拆分表）不得因 number-anchored 題優先而被排擠 — 沒有錨定版本就用定式原樣補上。

### 階段 2：統整校對
- 使用者交出他的版本（工作台上傳至 `_analysis/inbox/`）後做三類 diff：共識（語意相同即算，措辭合併取較佳）／只有 Codex（使用者勾選決定，砍題附原因）／只有使用者（**自動進最終版＋記錄為盲區訓練資料**）。合併輸出 `draft_RN_merged.md`，含「來源」欄（共識／Codex／你）。
- 使用者對題目的編輯：原句 vs 修改版**成對記錄**（措辭學習）。
- 合併版 xlsx 含勾選欄與內部欄（出處與動機），存 `_analysis/drafts/`；發出版移除內部欄。
- **第二層 diff**：使用者上傳「最終發出版」（含同事補題）→ 比對合併版 → 同事新增（新盲區）與修改（措辭）記錄 → 存檔 `qlist/<案名>_Qlist_RN_final.xlsx`。

### 階段 3：多輪
- 對方直接在 xlsx 回答欄回覆＝ledger。**逐題判定以最終發出版為基準**：完整回答／部分／迴避／與其他資料矛盾 — 後三種進下輪追問候選。
- 新文件走增量消化，加入對帳表找新矛盾。同名新版本→舊版移 `_archive/`＋**版本 diff**（改了哪些數字＝出題素材）。
- 輪次推進與結案都是使用者手動決定；推進條件＝本輪最終版已發出。

### 階段 4：蒸餾（兩層）
- **本輪蒸餾**（每輪最終發出版上傳後自動執行）：本輪 diff-reports（砍題原因→反面規則、編輯對→措辭規則）＋最終版 vs 合併版 diff（同事新增→盲區 pattern、修改→措辭）→ 增量寫回題庫＋`_analysis/distill-report-rN.md`。
- **全案蒸餾**（結案時執行）：彙總全案。
輸入：全部 diff-reports、砍題原因、編輯對、判定結果。輸出寫回 `knowledge/question-bank.md`：新 pattern（含同事題抽象化：方向＋深度＋問法三層）、反面規則、per-deal profile。同事題動機推不出來的列「待標註」問使用者。KPI：每案「使用者/同事有問、Codex 漏掉」題數遞減。

## 品質防線（防止漏掉埋很深的資料）

1. 結構性全讀（逐頁/逐 tab，覆蓋聲明必填）
2. 抽取而非摘要（不判斷重要性）
3. 四視角冗餘閱讀
4. 對帳表自動浮出矛盾
5. 事後全文可追問＋失誤回饋蒸餾
＋ QC 抽查 agent：隨機抽原文頁面比對字卡有無漏抽

## 範圍與隱私

搜尋與問答預設**僅限單一案件**，不跨案；跨案題型比對需明確要求。Data Room 為機密資料，不外傳、不放入任何對外內容。

## Roadmap（先記著，不做）

- 本地薄殼介面：headless Codex（`codex exec --json`）＋介面按鈕觸發 pipeline，狀態讀 `_analysis/`。介面見 `_workbench/public/index.html`。
- Markdown 知識庫（Obsidian 可選、僅作瀏覽器）；跨案件搜尋開關；Google Drive 直接拉檔

## 公開示範版的資料邊界

版控與匯出僅保留合成案；不得把真實案件的名稱、profile、數字、交易條件或蒸餾紀錄寫入公開題庫。蒸餾的通用題型須抽象化並經檢查才可公開。

## 題目 JSON 正本與穩定 ID
所有 persona 與匯整層同時輸出 questions_RN.json 與 draft_RN.md。正本是 JSON 陣列，每題含 question_id（q-rN-NNN）、text、cat、why、evidence:[{doc,loc}]、wave、channel、source、revision、persona。重排、改寫、合併與增量時既有 ID 不變，revision 遞增；新題用全新 ID。不得用題目順序作為 identity。合併題記 merged_from，原題留存並由 Reviewer 標 merge_duplicate。
