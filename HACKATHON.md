# DD Q-list：Codex 黑客松示範

完整規範見 AGENTS.md，安裝、認證、模型與 effort 見 CODEX.md。Codex／OpenAI 的驗證結果與限制見 MIGRATION.md。

## 示範流程

1. 安裝 Python 與 npm 依賴，索引 `演練資料_AcmeRobotics`。
2. 以 `QLIST_MOCK=1 PORT=8765 node _workbench/server.js` 瀏覽合成文件、既有字卡、對帳與草稿。Mock 不產生真實模型結果。
3. 點矛盾圖查驗兩份出處；開年報第 486 頁確認 Note 41。
4. 真實模式需移除 mock 並完成 OpenAI API key 或 Codex CLI 登入。先實測問答，再測單檔消化與完整多代理流程。
5. 可用 `demo_extra/Acme_客戶合約摘要_2026H1.xlsx` 演練新增文件，觀察字卡、增量對帳與新增問題。
6. 合併審核呈現人工與 AI 差異；只把抽象通用題型寫入公開題庫。

## 埋雷表（示範案）

| # | 在哪 | 雷 | 誰抓 | 現場動作 |
|---|---|---|---|---|
| M1 | Cap Table B4 vs 股東名簿 p.1 | Vertex 1,200,000 vs 1,500,000 股，差額鏡像到 minority | reconciler → 矛盾圖紅格 | 點紅格，兩份文件並排 |
| M2 | Deck p.4 vs 財報 p.1 vs 年報 p.14 | 毛利率 58% / 41.2% / 56.8%（不含硬體）| reconciler＋recompute 重算 41.2% | 展示口徑分 basis、程式重算 |
| M3 | 年報 **p.312** Note 27 | 向 CEO 全資 Harbor Peak 採購 US$640,120，摘要版與 Deck 未揭露 | card-extractor | 評審問「有沒有關係人交易」→ 答案附 [年報 p.312]，點開 |
| M4 | 年報 **p.486** Note 41 | 增資逾 US$5M 或 change of control 須銀行同意；本輪 US$8M 觸發，尚未申請 | card-extractor＋persona-ic | 「第 486 頁寫什麼」→ 直翻；再看它怎麼變成一題 |
| M5 | 現場拖入 `demo_extra/Acme_客戶合約摘要_2026H1.xlsx` | LogiOne 到期 2026-12-31 vs Deck 2027/06；QuickShip 已終止；MetroParts 仍試營運 | ingest-one | 拖入 → ⚡ → 時間軸 → 新紅格＋新題 |
| 加碼 | 年報 p.17 Note 12 / p.18 Note 15 / p.14 Note 5 | DSO 87 天自承是 Q4 年化、全年 131 天；已授予 280,000 股選擇權；Top-10 = 88%（Deck 68%）| reconciler | 問 AI 直接問 |

## 架構與限制

PDF／簡報逐頁索引、試算表逐格值與公式 → card-extractor → reconciler 與程式重算 → QC → 四 persona 獨立出題 → 人工匯整。共七個 Codex 自訂代理，定義在 `.codex/agents/`。

專案對話用 OpenAI Responses API 串流與多輪工具檢索，需 API key。文件先建本地 SQLite 片段索引，模型按需讀取，詳見 [_workbench/CHAT_DESIGN.md](_workbench/CHAT_DESIGN.md)。批次流程使用 headless Codex；時間軸只顯示實際收到的事件。

初始匯入時的驗證僅含 mock 與確定性整合測試。後續對話與記憶的實測範圍見 [_workbench/MEMORY_DESIGN.md](_workbench/MEMORY_DESIGN.md)。沒有實測的延遲、費用、覆蓋率或成功率不得當成結果展示。附帶預先準備的合成分析可供操作示範；真實模型執行狀態以測試結果為準。

## 匯出

`bash _workbench/export_demo.sh /path/to/destination`

只匯出原生 Codex 規範／代理／skill、工作台、通用知識與合成案，不含 Git history、認證、node_modules、log 或其他案件資料夾。匯出前仍須檢查允許目錄內有無被新增的私有資料。
