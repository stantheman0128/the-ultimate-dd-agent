# Migration record — 2026-09-12

## Migration and privacy


Initial keyword scanning found 14 matching files. After review, the owner explicitly authorized removal of all real company data and commit/push. Real-deal profiles, historical customer examples, numeric transaction details and performance claims were removed from the public knowledge and guides. The question bank now contains generic placeholders. Synthetic persona rationale cells referencing historical deals were removed/replaced; synthetic questions and evidence remain. No original customer Data Room directory or root spreadsheet/presentation was copied.

AGENTS.md now contains the full DD rules, superseding the initially requested compatibility pointer. Seven .codex/agents/*.toml files embed full role instructions; .agents/skills/dd-qlist/SKILL.md is a native discoverable skill. Legacy configuration files are removed. The export script uses an explicit allowlist and excludes runtime files and credentials. The repository root ignore allowlist prevents accidental addition of other case directories; it does not replace review of files in allowed directories.

## Implementation and validation

- OpenAI SDK 7.15.0 and Codex CLI 0.154.0 are pinned. Responses API handles immediate questions; codex exec --json handles headless batches and the no-API-key question path.
- Provider changes cover authentication, model/effort, stdin, event/output parsing and failure lifecycle. A failed run cannot mark preexisting draft output as newly completed.
- UI changes are limited to provider/model/authentication labels and instructions. No DD business logic or UI redesign was introduced.
- index_doc.py, recompute.py, make_xlsx.py and read_xlsx.py were unchanged during provider integration. Synthetic document binaries remain unchanged.
- Python requirements and npm dependencies installed. Seven document indexes built; the synthetic annual report has 520 pages. Recompute dry run succeeded.
- Mock /api/deals contains only 演練資料_AcmeRobotics. /api/page for annual report page 486 contains Note 41. Test servers were stopped.
- Deterministic tests cover OpenAI SDK with local SSE transport, CLI subprocess/stdin/JSONL success and failure, event adaptation, and the server failure completion guard. These are not live model tests.
- HTTP regression checks cover deals, detail, facts, page and search, excluding filesystem timestamps. Unattributed draft sources display AI.
- Native TOML configuration and skill format are validated. Credentials, node_modules, logs and runtime events are excluded from the published tree.

## Live-call limits

**Real Codex call did not complete.** CLI login status reported ChatGPT authentication, but a read-only single-page call timed out after 60 seconds without a model response. A minimal diagnostic also timed out. The precise cause is unconfirmed; authentication status alone does not prove a working live call.

**Real Responses API is unverified:** no OPENAI_API_KEY was available. No host secret was copied or published. The full live multi-agent pipeline remains unverified and must be tested on a host with working authentication and connectivity before claiming a successful live demo.


## 第二輪 — 2026-09-12

依 CODEX_TASKS_final.md 3A–3M 增量實作：雙 provider 與唯一設定面板、逐次模型／effort／persona manifest、方法論全文與 approved 規則的 scoped user 派工訊息、分片合併與字卡逐列核對、對帳候選表、JSON 正本穩定題目 ID、獨立 Reviewer、人審回饋與規則核准生命週期、方法論升版提案、BM25 檢索、四個可選 persona、上傳歸檔、快取用量、來源標示及後續 roadmap。

`.claude/agents/*.md` 的 frontmatter `model:` 只在 Claude 路徑作備援；Codex 讀 config.toml 與 `-c`，兩者的設定面板是唯一入口。TOML 為固定代理正文正本，方法論／規則不得寫進 developer_instructions。run 專屬 TOML 與 dispatch.json 可供查核。

### 已驗證

- 整合遠端新版 UI 前，16 個確定性測試全過：CLI 事件與失敗、設定驗證、連續 7 片覆蓋 520 頁、逐筆數字偵錯、分片缺頁與合併去重、BM25 三組 query 排名與預算、Reviewer schema、規則防竄改／重啟／scope／deal 過濾、穩定 ID 重排。
- HTTP 隔離測試覆蓋「砍題理由 → feedback → proposed → 人核准 → 下次 run manifest／dispatch／log 注入」，以及方法論上傳／停用／未知 ID 拒絕、方法論升版核准與來源規則 folded_into、同名文件歸檔。模型呼叫為假 CLI／假引擎。
- 原有 33 題已一次性轉成 JSON 正本並保留證據。既有 facts 及 reviewer 範例明標 handwritten。
- 對示範案六張手寫卡實跑 verify_cards.py，全部未達完整通過門檻，原因包括不完整工作表座標與數值／公式口徑。結果保存在 card-verify.json／md，未補造出處。年報尚無字卡，不能宣稱已完整抽取。
- candidates.json 有 65 群、67 筆未對齊。持股、毛利率、DSO、最大客戶比率均可分群；最大客戶沿用 metrics.json 的 canonical `top1_customer_pct`，未另造重複指標。

### 未驗證與限制

- 真實 Codex／Claude／API 多代理執行均未完成驗收；本輪不處理登入。模型名稱按指定預設、可自由修改，其實際可用性未驗證。
- Codex CLI 0.154.0 的 doctor 實際接受 per-agent config_file 覆寫並通過 config.load；診斷 prompt-input 探針未產生有效結果。因此**尚未證實子代理 TOML 的 model 欄位在實際派工生效**。server 依規格以固定 TOML 為模板生成 run 專屬 model／effort config，再透過 -c 指向；這是可查核配置，不能冒充 live 驗收。
- 雲端瀏覽器開本機測試網址被 ERR_BLOCKED_BY_CLIENT 阻擋，沒有有效的瀏覽器操作驗收或 UI 截圖；未以合成截圖代替。
- 規則的 server 核准帳本是本地工作流完整性檢查，不是對同 UID 惡意程序的 OS 安全隔離。模型不得呼叫核准 API 或改帳本，仍需要可信的本機操作環境。
- OCR 模型能力、實際重抽效果、模型生成的 house-style 內容品質、真實執行成本與完整 pipeline 效能未驗證。


### 同步另一個 session 的 main

收尾 fetch 發現遠端 main 已重建歷史並合併 PR #1（1d4b171）：新版／經典樣式、專案對話、私有記憶、FTS5、文件描述與 OCR。本分支保留既有 commit，以 merge 接入遠端；未 force push、未重寫任何既有 commit。衝突以原工作起點 125a4ad 的檔案內容三方比對，保留雙方增量；不回退另一 session 的成果。

- 專案對話保留 OpenAI 工具檢索、記憶與輸入上限，端點移至 `/api/chat/ask`，前端一起更新；模型／effort 讀進階設定的 codex 問答欄位。記憶整理器仍使用部署端 OpenAI 設定。
- 搜尋頁新增「單次文件問答」對應本輪 `/api/ask`，可切 Codex／Claude，使用可調 token 預算與 BM25。此模式不附加對話記憶。
- `/api/search` 保留 BM25 證據優先排序，後附現有專案檢索的中文文件描述；模型描述仍標示為導覽，不當作原文證據。
- 保留 Host／Origin 驗證，PORT=0 測試採實際監聽 port。保留最新文件解析與索引失效處理，沒有另建 FTS 系統。
- 合併後 50 個 Node 測試與 5 個 Python 測試通過；新增一項 DOM 模擬測試檢查整頁無重複 ID、設定 modal/provider render、審題建議及方法論差異顯示。這不是瀏覽器視覺驗收。
- 隔離 HTTP 驗證同時覆蓋新 `/api/ask`、原專案對話的新端點、對話保存與搜尋；export_demo.sh 也包含兩條路徑所需模組，排除私有對話、記憶與執行期核准帳本。
