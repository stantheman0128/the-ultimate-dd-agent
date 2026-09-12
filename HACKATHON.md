# DD Q-list：Codex 黑客松示範

AcmeRobotics 為合成示範案例；預先準備的分析與 mock 畫面不代表現場模型生成結果。

完整規範見 AGENTS.md，安裝、認證、模型與 effort 見 CODEX.md。

## 示範流程

1. 安裝 Python 與 npm 依賴，索引 `演練資料_AcmeRobotics`。
2. 以 `QLIST_MOCK=1 PORT=8765 node _workbench/server.js` 瀏覽合成文件、既有字卡、對帳與草稿。Mock 不產生真實模型結果。
3. 開啟資料查核與文件來源，示範如何定位原文、核對數據並整理待確認事項。
4. 真實模式需移除 mock 並完成 OpenAI API key 或 Codex CLI 登入。先實測問答，再測單檔消化與完整多代理流程。
5. 可用 `demo_extra/Acme_客戶合約摘要_2026H1.xlsx` 演練新增文件，觀察字卡、增量對帳與新增問題。
6. 合併審核呈現人工與 AI 差異；只把抽象通用題型寫入公開題庫。

## 架構與限制

PDF／簡報逐頁索引、試算表逐格值與公式 → card-extractor → reconciler 與程式重算 → QC → 四 persona 獨立出題 → 人工匯整。共七個 Codex 自訂代理，定義在 `.codex/agents/`。

即時問答用 OpenAI Responses API 串流；沒有 API key 時走 `codex exec --json`。批次流程使用 headless Codex。時間軸只顯示實際收到的事件，CLI 不保證逐頁讀取事件。問答 context 仍有原引擎預算與 CLI 字元上限。

本環境 mock 與確定性整合測試通過；真實 Codex 呼叫逾時，真實 Responses API 因缺 key 未驗證。沒有實測的延遲、費用、覆蓋率或成功率不得當成結果展示。附帶預先準備的合成分析可供操作示範；真實模型執行狀態以測試結果為準。

## 匯出

`bash _workbench/export_demo.sh /path/to/destination`

只匯出原生 Codex 規範／代理／skill、工作台、通用知識與合成案，不含 Git history、認證、node_modules、log 或其他案件資料夾。匯出前仍須檢查允許目錄內有無被新增的私有資料。
