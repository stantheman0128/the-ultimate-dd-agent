# Codex 執行指南

本專案使用 OpenAI／Codex provider；`AGENTS.md` 是 Codex 入口及完整 DD 規範，驗證結果見 `MIGRATION.md`。

## 啟動

在專案根目錄執行：

```bash
python3 -m pip install -r _workbench/requirements.txt
(cd _workbench && npm install)
python3 _workbench/index_doc.py 演練資料_AcmeRobotics
QLIST_MOCK=1 PORT=8765 node _workbench/server.js
```

開啟 http://127.0.0.1:8765 。Mock 使用既有合成結果，不能當成真實模型成功的證據。

真實模式移除 `QLIST_MOCK=1`。即時問答使用 OpenAI Responses API；批次 DD、合併、蒸餾使用 Codex CLI。npm 安裝會包含 Codex CLI，也可用 `CODEX_BIN` 指定現有可執行檔。

## 認證與模型

| 設定 | 用途／預設 |
|---|---|
| `OPENAI_API_KEY` | Responses API；headless 未另設 key 時共用 |
| `CODEX_API_KEY` | 只供 headless，優先於 OPENAI_API_KEY |
| `_workbench/token` | 可選 OpenAI API key，由側欄設定，Git 忽略；只接受 OpenAI API key |
| `QLIST_CODEX_MODEL` | `gpt-6-astra`；UI 非預設選項可覆蓋主代理模型 |
| `QLIST_CODEX_EFFORT` | `medium`；需使用所選模型支援的值 |
| `QLIST_ASK_MODEL` | `gpt-6-astra`，與主代理下拉選單分開 |
| `QLIST_ASK_EFFORT` | `low` |
| `QLIST_ASK_BUDGET_TOKENS` | `450000`，沿用原 context 選頁政策 |
| `CODEX_BIN` | 可選 Codex 可執行檔路徑 |

沒有 API key 時，headless 可使用執行主機已有的 Codex 登入；用 `_workbench/node_modules/.bin/codex login` 登入。不要把 auth.json、OAuth token 或 API key 提交到 repo。Responses API 不會使用 ChatGPT 登入憑證；沒有 API key 時「問 AI」改走 CLI。

Responses 請求設 `store: false`，快取依 provider 支援，不承諾固定 TTL 或延遲。

## Codex 原生格式

- `AGENTS.md` 包含完整工作規範。
- `.codex/agents/*.toml` 包含七個角色的完整 `developer_instructions`，不依賴其他工具的設定檔。模型與 effort 預設繼承主代理；可在各 TOML 設 `model`／`model_reasoning_effort`。
- `.agents/skills/dd-qlist/SKILL.md` 是可發現的原生 skill，搭配 `knowledge/question-bank.md` 通用活題庫。
- `.codex/config.toml` 啟用自訂代理，設定預設模型、effort 與並行上限。
- PDF 掃描頁先用 PyMuPDF 渲染，再用可用圖片工具讀取，一次最多 20 頁；無法讀取須回報未覆蓋。
- 新生成來源為「共識／Codex／你」。未標記作者的草稿顯示「AI」。

批次允許 `workspace-write`；問答使用 `read-only`。不關閉 sandbox、不跳過審批。若宿主限制阻擋執行，應回報錯誤，不宣稱流程完成。

Codex 的 JSONL 不一定提供每個讀檔動作及精確頁碼，時間軸只呈現實際收到的事件，不能捏造與舊 provider 相同的完整 trace。CLI 問答沿用既有 220,000 字元上限；若需要完整大文件問答，使用 Responses API 或調整後另行驗證。

## 驗證

```bash
(cd _workbench && npm test)
python3 _workbench/recompute.py 演練資料_AcmeRobotics --dry
```

真實呼叫需另行認證，不可用 mock 或假的 transport 測試替代。模型是否可用以帳號實際權限與 API 回應為準。

格式依據：
- https://learn.chatgpt.com/docs/non-interactive-mode
- https://learn.chatgpt.com/docs/agent-configuration/subagents
- https://learn.chatgpt.com/docs/build-skills
- https://developers.openai.com/api/docs/guides/text
