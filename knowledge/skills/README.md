# knowledge/skills/ — 可掛載的 DD 方法論

引擎「怎麼問」的 know-how 不寫死在代理 prompt 裡，而是做成可掛載的 skill。工作台側欄「方法論」列出這裡的每個資料夾，勾選即啟用；主 session 派 persona 與 question-reviewer 時，把每個啟用 skill 的 `SKILL.md` 全文附在派工訊息的「本案適用方法論」段，並在該次 run 的 `run.json` 記錄 skill id。這讓一家創投把內部前輩的看法帶進引擎，而不必改任何程式。

## 格式

```
knowledge/skills/<skill-id>/
├── SKILL.md              # 必要：frontmatter（name、title、description、version、scope）＋方法論本文
└── references/           # 可選：題型庫、檢查表等，SKILL.md 內以相對路徑引用
knowledge/skills/active.json   # 目前啟用的 skill id 清單（工作台維護）
```

`scope` 可填 `persona`、`reviewer`、`merge`（逗號分隔）；主 session 只把 scope 相符的 skill 附給對應代理。

## 內建

| skill | 說明 | 匯出到公開 repo |
|---|---|---|
| `vc-senior-qlist/` | **創投前輩 Q-list 方法論**（去識別化）：七維度、兩通路、波次、商業模式原型必問角度、20 條技法，`references/question-bank.md` 為抽象化題型庫（案例代號 A–D，無公司名與實際數字）。預設啟用。 | 是 |

## 加自己的

1. 工作台側欄「方法論」→「＋ 加入 skill」上傳一份 `SKILL.md`（會建立 `knowledge/skills/<檔名去副檔名>/SKILL.md`），或直接在這裡建資料夾。
2. 勾選啟用。可以多個並列（例：基金通用方法論＋某位合夥人的個人偏好）。
3. 從審核回饋學到的規則走另一條路：`knowledge/learned/rules.json`（distiller 提案、人核准），它是「這家公司自己長出來的」，skill 是「人帶進來的」。

活題庫 `knowledge/question-bank.md` 與 skill 內的題型庫是兩件事：前者由蒸餾迴圈持續寫入，後者是方法論附帶的靜態範例。

