# 引擎執行指南

完整 DD 規範以 `AGENTS.md` 為準；`CLAUDE.md` 為中性名稱複本。啟動步驟見 `HACKATHON.md`，驗證與限制見 `MIGRATION.md`。

## 認證

Codex CLI 使用主機既有 `codex login`、`CODEX_API_KEY` 或 `OPENAI_API_KEY`；Responses API 只使用 `OPENAI_API_KEY` 或側欄保存的 OpenAI key。Claude CLI 使用既有登入或 `CLAUDE_CODE_OAUTH_TOKEN`；Messages API 使用 `ANTHROPIC_API_KEY`。兩個 provider 的憑證不可互換。

批次使用 workspace-write／acceptEdits；問答為 read-only 或停用工具的 CLI 問答。不要關閉 sandbox 或跳過宿主審批。CLI、API 或模型不可用時如實回報。

## 設定唯一入口

工作台 ⚙「進階設定」透過 `GET/POST /api/settings` 儲存 `_workbench/settings.json`（忽略於 Git）。provider、模型與 effort、persona 與問答預算由同一設定解析；模型名稱可自由輸入，effort 為 low／medium／high。

解析順序：代理個別覆寫 > 角色 tier 預設 > provider 預設。成本模式才讓 mechanical 使用 cheap_model。模型是否實際可用不由字串驗證保證。

`QLIST_PROVIDER` 只作設定檔不存在時初值。舊有 `QLIST_CODEX_MODEL`／`QLIST_CODEX_EFFORT` 也是初值；`QLIST_ASK_MODEL`、`QLIST_ASK_EFFORT`、`QLIST_ASK_BUDGET_TOKENS` 保留為部署端問答覆寫。`CODEX_BIN`／`CLAUDE_BIN` 可指定 CLI。

## 執行契約

- TOML 的 developer_instructions 為代理正本；`.claude/agents/*.md` 保持相同正文，frontmatter `model: inherit` 僅作 Claude 路徑備援。
- 每次 run 在 `_analysis/runs/<run_id>/` 建立不可混淆的模型設定快照與代理 config。Codex 透過 `-c` 設主模型、子代理預設，並以 `agents.<name>.config_file` 指向此次生成的 TOML；不修改版控中的代理。
- Claude 主 session 使用 `--model`／`--effort`，子代理以 `--agents` JSON 注入模型與 effort。完整命令參數（無憑證）留在 run.log 首行。
- 方法論与 approved 規則是派工 user 訊息中的資料，保存在 `dispatch.json`，不改代理 system prompt。scope 與 deal 過濾由 server 做；代理判斷 applies_when 與 exceptions。
- `run.json` 記 provider、模型矩陣、effort、persona、文件 mtime、分片、方法論與規則版本、開始／結束時間、exit code、已知成本。假引擎另標 mock。
- 問答使用同一檢索預算，不再另以字元上限靜默截斷；超預算用 BM25 挑頁，不能把挑頁結果宣稱成全案查無。

## 本地操作與資料

只操作指定案件，跨案題型比對需另外要求。代理不可改核准帳本、settings、active.json 或呼叫核准 API。規則狀態與核准內容由 server 帳本驗證；此為本地單使用者工作流的資料完整性機制，不是對同帳號惡意程序的 OS 權限隔離。

`npm --prefix _workbench test` 執行確定性測試。真實模型及代理覆寫的生效狀況需另外驗證，假 CLI 或設定能解析並不等於模型成功執行。


## 與專案對話並存

「搜尋資料 → 單次文件問答」使用上述雙 provider API／CLI 與 BM25 預算，端點 `/api/ask`。
「專案對話」保留已合併的 OpenAI 多輪工具檢索與私有記憶，端點 `/api/chat/ask`，需要 OpenAI API key；讀取設定中的 codex.ask_model／ask_effort，輸入受 project-chat.js 的 48,000 bytes 上限約束，沒有 CLI fallback。記憶整理器沿用 QLIST_ASK_MODEL／QLIST_ASK_EFFORT 部署值。
兩種樣式共用以上功能。詳見 `_workbench/CHAT_DESIGN.md`、`MEMORY_DESIGN.md` 與 `UI_DESIGN.md`。
