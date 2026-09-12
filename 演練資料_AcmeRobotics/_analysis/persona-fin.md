# Persona：財務偵探（Financial Detective）— 候選問題

案件：Acme Robotics, Inc.（Series A DD 演練）
產出日：2026-07-12
依據：`_analysis/cards/` 6 張字卡＋`_analysis/facts.md`；題庫 `knowledge/question-bank.md`（未開啟任何 Q-list 檔案）

## 商業模式原型判斷
- **主原型：RaaS = SaaS（subscription + usage-priced）× industrial 硬體 hybrid**。審計營收三條線：Subscription US$1,872,404／Usage fees US$913,220／Hardware sales & install US$418,494（FIN p.1）；Deck 自稱純 RaaS per-pick pricing（DECK p.2）。
- **Overlay：Cross-border（TW／JP／US）**——客戶橫跨三地（TOP10 B2:B11），美國擴張為本輪資金主用途 45%（DECK p.6）。

## 候選問題（品質排序：跨文件不一致與 number-anchored 優先）

| 分類 | 問題 | 為什麼問 | 出處 | 書面/口頭 | 波次(1/2) |
|---|---|---|---|---|---|
| 財務–毛利率對帳 | 經審計 FY2025 毛利率為 41.2%（毛利 US$1,320,096／營收 US$3,204,118），但 Series A Deck 載 FY2025 毛利率 58%，相差 16.8pp。請說明 58% 之計算基礎（是否剔除 Hardware sales & install US$418,494 或安裝／部署成本？），並提供 FY2025 三條營收線（Subscription US$1,872,404／Usage fees US$913,220／Hardware & install US$418,494）各自之營業成本組成與毛利率。 | GM reconciliation 為每案必考 pattern；審計值 vs 募資簡報差 16.8pp 屬跨文件高嚴重度不一致（facts D3），且與 D15 純 RaaS 敘事直接相關 | FIN p.1；DECK p.4 | 書面 | 1 |
| 財測–毛利率橋 | 財測假設毛利率 2026–2029 為 62%→64%→66%→68%（假設!B4:E4），但 FY2025 經審計實績僅 41.2%——一年內需提升 20.8pp。請提供 41.2%→62% 之毛利率橋（逐項驅動因子量化：Deck 所稱 in-house controller 帶動 BOM 成本自 2024 年降 31% 貢獻多少？硬體收入佔比變化貢獻多少？），並附成本結構明細佐證。 | 依本合成案所列出處與問題中的數字核對，釐清差異、假設或缺件。 | FIN p.1；MODEL 假設!B4:E4；DECK p.4 | 書面 | 1 |
| 財務–應收/DSO | 財報揭露 DSO 為 87 天（FIN p.2），但以同份財報數字反算：AR US$1,152,730 ÷ 營收 US$3,204,118 × 365 ≈ 131 天，相差約 44 天。請說明 87 天之計算方式（分子、分母、期間），並提供 2025/12/31 及最近月份之 AR 帳齡表（by 客戶，標示逾期金額與催收狀態）。 | 同一份審計財報內部自相矛盾（facts D5），涉及 AR 品質或收入認列時點；AR/DSO 天期為題庫 wave 1-2 標準題 | FIN p.1、p.2 | 書面 | 1 |
| 財測–2026 起點 | 財測 2026 營收 US$7,100,000 為硬編碼常數（損益預估!B2），以模型自身假設粗算（新增 28 站 × 月費 US$8,400 × 12）僅約 US$2,822,400，模型亦未列期初站點基數（Deck 載截至 June 2026 已部署 41 站）。請提供 US$7.1M 之 bottom-up 推導：2026 期初站點數與存量營收、逐季新增站點、每站點實收 ARPU，以及自 FY2025 實績 US$3,204,118（隱含 2.22x 成長）之營收橋。 | 依本合成案所列出處與問題中的數字核對，釐清差異、假設或缺件。 | MODEL 損益預估!B2、假設!B2:B3；DECK p.3；FIN p.1 | 書面 | 1 |
| 財測–模型內部矛盾 | 財測 2027–2029 營收公式為前一年 ×2.1（110% YoY，損益預估!C2:E2 硬編碼），未引用假設 tab 任何一格；但同模型新增站點年增率逐年遞減（55/28≈96%→90/55≈64%→130/90≈44%，假設!B2:E2），而毛利公式反而有連結假設 tab。2.1x 之依據為何（假設 tab 查無此假設列）？請提供營收與站點假設連動之更新版財測。 | 依本合成案所列出處與問題中的數字核對，釐清差異、假設或缺件。 | MODEL 損益預估!C2:E2 vs 假設!B2:E2、B3:E3 | 書面 | 1 |
| 財測–流失未反映 | 占 FY2025 營收 9% 之 QuickShip Logistics（US$288,371，第 3 大客戶）已於 2026/3 通知終止、2026/6 生效（FIN Note 9；TOP10 E4），惟財測 2026 營收 US$7.1M 無任何扣減註記（損益預估!B2:E2）。US$7.1M 是否已扣除此流失？終止原因為何？該 ~9% 收入缺口之替補計畫？請提供反映終止後之更新版財測。 | 依本合成案所列出處與問題中的數字核對，釐清差異、假設或缺件。 | FIN Note 9 p.3；TOP10 A4:E4；MODEL 損益預估!B2 | 書面 | 1 |
| 財務–留存率口徑 | Deck（June 2026 製作）載 NRR 128%（p.3），但同月正是 QuickShip（占營收 9%）終止生效之月，且全文未提此事件。請說明 NRR 之計算期間、cohort 口徑與分母客戶數（是否含 QuickShip churn？），並提供 2025/1 起逐月 MRR 走勢，拆 New／Expansion／Churn MRR。 | 依本合成案所列出處與問題中的數字核對，釐清差異、假設或缺件。 | DECK p.3；FIN Note 9 p.3；TOP10 E4 | 書面 | 1 |
| 財務–客戶集中度 | Deck 載 Top-10 客戶占營收 68%（p.3），但貴司提供之客戶明細檔加總為 88%（D2:D11；十家合計營收 US$2,819,624）——同一事實差 20pp。請說明兩者口徑（期間？revenue vs ARR/bookings？），何者為準？另最大客戶 LogiOne 3PL 占 31%（US$993,276）合約 2027/06 到期，續約進度為何？ | 跨文件 20pp 差異且 Deck 低報集中度（facts D4）；Top customers + status 為題庫 wave 1 必問；31% 單一客戶為審計揭露之集中度風險（FIN Note 5） | DECK p.3；TOP10 C2:E2、D2:D11 加總；FIN Note 5 p.3 | 書面 | 1 |
| 財務–資料錯誤指認 | 客戶明細中 Kyushu Micro-FC（JP）與 BlueBox Storage（TW）之 FY2025 營收完全相同——皆為 US$96,124／3%（C10:D10 vs C11:D11），精確到個位數。此為巧合、估算值或資料填列錯誤？請提供修正版 Top-10 明細，並與審計營收 US$3,204,118 核對加總。 | 依本合成案所列出處與問題中的數字核對，釐清差異、假設或缺件。 | TOP10 C10:D10、C11:D11；FIN p.1 | 書面 | 1 |
| 財務–收入認列/預收 | 依 Note 3，subscription 按比例攤銷、usage fees 於交付「monthly pick reports」時認列。請說明：(1) pick report 之內容與計算方式、交付時點與服務月份之落差（是否存在跨期／年底 cutoff 認列問題，與 DSO 差異是否相關）；(2) Hardware sales & install US$418,494 之認列時點（一次性或分攤）；(3) B/S 預收收入（Deferred revenue）US$941,808 之組成（預收訂閱？安裝款？年繳合約？）與 FY2025 rollforward。 | 依本合成案所列出處與問題中的數字核對，釐清差異、假設或缺件。 | FIN Note 3 p.3、p.1、p.2 | 書面 | 1 |
| 財務–費用與現金跑道 | FY2025 營運虧損 US$(2,782,281)、OPEX US$4,102,377 為營收之 1.28 倍（R&D US$1,988,105／S&M US$1,306,880／G&A US$807,392）、現金 US$4,918,551——依此燒錢速度跑道約 21 個月（推算），惟財測僅列營收、毛利兩行（損益預估!A1:E3）。請提供 2026–2029 含 OPEX 三科目走勢、EBITDA、淨利與現金流之完整財測，損益兩平預計時點，及本輪 US$8.0M 到位後之跑道假設。 | 巨額虧損為單一來源科目、兩份前瞻文件皆迴避費用面（facts D13、F22）；資金用途（US fleet ops 45%／R&D 30%／WC 25%，DECK p.6）需與費用預測勾稽 | FIN p.1、p.2；MODEL 損益預估!A1:E3；DECK p.6 | 書面 | 1 |
| 財務–美國時程矛盾 | 三份文件對美國市場貢獻時點互相矛盾：Deck 稱 2025Q4 進入美國、2026H1 新簽 bookings 40% 來自美國（p.3）；客戶明細顯示 FY2025 已有 3 家美國客戶合計占營收 24%（Pacific Fulfillment 12%＋MetroParts 7%＋Nordic Storage 5%）；財測假設卻載「美國自 2026Q4 起貢獻 50% 新站點」（假設!B5）。請提供美國市場 2025Q4 起逐季實績（站點數、營收、bookings）與預測口徑之對帳說明。 | 三文件對同一擴張時程三種說法（facts D7、F17）；revenue by geography 為 cross-border overlay 必問；bookings vs revenue 口徑混用需釐清 | DECK p.3；TOP10 B3/B6/B8＋D3/D6/D8；MODEL 假設!B5 | 書面 | 1 |
| 文件請求–期中自結 | 請提供 2026 年 1–6 月自結財務報表（月頻，含營收 by 三條產品線、毛利、OPEX、現金水位），以銜接 FY2025 審計數（營收 US$3,204,118、現金 US$4,918,551）與 Deck 所述 2026H1 動能（41 sites／388 robots／US 40% new bookings），並驗證 QuickShip 終止（2026/6 生效）之實際影響。 | 依本合成案所列出處與問題中的數字核對，釐清差異、假設或缺件。 | FIN p.1、p.2；DECK p.3；FIN Note 9 p.3 | 書面 | 1 |
| B/S–質押與借款 | 依 Note 7，「substantially all」機器人設備已質押予 First Pacific Bank 作為 US$1.5M 信用額度之擔保，B/S 長期負債為 US$1,500,000（即額度似已全數動用）。請提供該授信合約，並說明：(1) 已動用金額、利率、到期日；(2) 財務承諾條款（covenants）及目前達成狀況；(3) 質押是否限制機器人跨站調度或跨境（美國）部署——本輪 45% 資金將投入 US fleet ops；(4) 本輪增資或後續資產處分是否需銀行同意。 | 依本合成案所列出處與問題中的數字核對，釐清差異、假設或缺件。 | FIN Note 7 p.3、p.2；DECK p.6 | 書面 | 2 |
| 財務–RaaS 敘事 vs 硬體收入 | Deck 將商業模式描述為純 RaaS（monthly subscription + usage fee、per-pick pricing，p.2），但審計營收有 13.1% 來自 Hardware sales & install（US$418,494，FIN p.1）。硬體是賣斷予客戶或由公司持有出租？已部署之 388 台機器人（DECK p.3）資產屬公司或客戶（與存貨 robot components US$688,214 及 Note 7 質押範圍如何對應）？財測 2026–2029 營收是否含硬體銷售？ | 依本合成案所列出處與問題中的數字核對，釐清差異、假設或缺件。 | DECK p.2、p.3；FIN p.1、p.2、Note 7 p.3 | 書面 | 1 |
| 揭露完整性（敏感） | Deck 製作於 June 2026——QuickShip 終止生效當月、設備質押與 US$2.78M 營運虧損存續期間——惟全文（p.1–6）未揭露客戶終止、資產質押、營運虧損三項重大事實，且毛利率（58% vs 審計 41.2%）與 Top-10 集中度（68% vs 明細 88%）均採較有利版本。想口頭了解管理層對募資文件揭露完整性之判斷過程，以及是否有其他未於 Deck 呈現之重大事項。 | 多項系統性「報喜不報憂」跨文件模式（facts D3、D4、D8、D12、D13 合觀），指向管理層誠信與揭露品質——此為投資判斷核心但語氣敏感，不宜書面 | DECK p.1–6；FIN p.1–p.3；TOP10 D2:D11 | 口頭 | 2 |

共 16 題。
