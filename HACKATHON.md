# DD Q-list：黑客松操作示範

## 安裝與啟動

```bash
python3 -m pip install -r _workbench/requirements.txt
npm --prefix _workbench ci
python3 _workbench/index_doc.py 演練資料_AcmeRobotics
QLIST_MOCK=1 PORT=8765 node _workbench/server.js
```

開啟 http://127.0.0.1:8765。進階設定選 provider、模型、effort、persona 與問答預算。模型名稱是預設設定，是否可用以實際帳號回應為準。

真實模式移除 `QLIST_MOCK=1`：

- Codex 批次：主機先完成 `codex login`，或設定 `CODEX_API_KEY`／`OPENAI_API_KEY`；`CODEX_BIN` 可指定 CLI。
- Codex 問答：`OPENAI_API_KEY` 走 Responses API；沒有 key 時使用已登入 CLI。
- Claude 批次：主機安裝並登入 Claude Code，或設定 `CLAUDE_CODE_OAUTH_TOKEN`；`CLAUDE_BIN` 可指定 CLI。
- Claude 問答：`ANTHROPIC_API_KEY` 走 Messages API；沒有 key 時使用 CLI。OAuth token 不當成 API key。
- `QLIST_PROVIDER=codex|claude` 僅為首次設定的初值；儲存後以進階設定為準。

## 上台前檢查

1. 執行 `npm --prefix _workbench test`。
2. 確认模型與 provider 狀態；若用假引擎，保留頁面上的假引擎及手寫來源標示。
3. 開啟文件、索引與證據引用，確認頁面可讀；掃描件不能宣稱已辨識。
4. 檢查審題、回饋、規則核准與下一次 run 紀錄。使用暫存示範副本，避免預演污染正式題庫。
5. 若要展示真實模型結果，先在展示主機單獨驗證登入與問答；未驗證路徑見 MIGRATION.md。

## 五分鐘示範：只展示操作

- 第 1 分鐘：選案件、檢查文件與可定位索引。
- 第 2 分鐘：開矛盾圖、點引用查原文、看來源標示。
- 第 3 分鐘：看 Reviewer 的判斷與原句／改寫，示範恢復與人工確認。
- 第 4 分鐘：砍題填理由、送出決定、在學習頁查看候選規則與來源回饋。
- 第 5 分鐘：人工核准規則、再跑流程，在總覽核對本次載入的規則版本。

## 實作與限制

索引 → 分片字卡 → 合併／逐筆核對 → QC → 候選表／對帳重算 → 已選 persona → Reviewer → 人審 → 候選規則 → 核准後再次派工。

附帶的 facts 與 Reviewer 結果是手寫合成示範。假引擎時間軸、候選規則是明確標記的操作測試素材，不能代表真實模型已讀文件或完成學習。逐筆數值命中也不等於覆蓋率或事實正確率；QC 與原文審查仍必要。

`bash _workbench/export_demo.sh /path/to/destination` 匯出通用引擎與合成案；匯出前確認允許目錄內沒有新增私有資料。


專案對話保留另一輪已加入的 OpenAI 工具檢索與私有記憶，需要 OpenAI API key。雙 provider 單次問答位於搜尋資料頁；兩者不可混稱。經典／新版樣式均可切換，審題與學習功能共用。
