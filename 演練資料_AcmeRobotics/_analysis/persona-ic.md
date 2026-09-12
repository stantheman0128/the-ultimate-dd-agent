# Persona 出題：投委會老鳥（治理與交易 / 文件完備性）

案件：Acme Robotics, Inc. — Series A（US$8.0M @ pre-money US$40.0M）
產出日：2026-07-12
視角：股權結構與各實體 Cap Table、轉投資實體盤點、特殊條款/side letter、創辦人全職與組織人事、出場路徑、本輪條件、文件完備性
商業模式原型判定：RaaS（SaaS × 硬體 industrial hybrid）＋ cross-border overlay（TW/US/JP）；
依據：`_analysis/cards/` 6 張字卡＋`_analysis/facts.md`（未開啟任何 Q-list 檔案）

| 分類 | 問題 | 為什麼問 | 出處 | 書面/口頭 | 波次(1/2) |
|---|---|---|---|---|---|
| 股權結構 | 股東名冊（filing date 2026/3/15）載 Vertex Growth Fund LP 持股 1,500,000 股／15.0%，惟 Cap Table（檔名期間 2026/06）與 Deck（June 2026）均載 1,200,000 股／12.0%；差額 300,000 股恰與「Other minority holders」之增加互為鏡像（1,250,000 股／12.5% → 1,550,000 股／15.5%）。請說明 2026/3/15 至 2026/6 間此 300,000 股之轉讓事由、受讓人身分、每股轉讓價格與交割時點，並提供股份轉讓合約及相關董事會決議。 | 本次對帳最重大發現：持有董事席位之主要機構投資人在募資前 3 個月減持 3pp，且流向未列名小股東 — 涉及 Seed 投資人 signaling、SHA 之 ROFR/co-sale 是否踐行、以及轉讓價格對本輪 pre-money US$40.0M 之定價參考；兩份文件皆未揭露異動。 | REG p.1；CT「Cap Table」B4/C4、B7/C7、E4；DECK p.6；facts.md D1/D2 | 書面（文件）＋口頭（事由與價格） | 1 |
| 股權結構 | Cap Table ESOP reserved 列為 800,000 股／8%（股東名冊同為 8.0%），但同列 Notes 註記「Unallocated 5.2%」— 若 8% 為池總額、5.2% 為未分配，即約 2.8%（~280,000 股）選擇權已授予但兩份股權文件均未拆列。請提供 ESOP 計畫文件與授予台帳（獲授人、數量、行使價、vesting 進度），並說明 Deck 所稱創辦人持股 58%（fully diluted）是否已計入已授予之選擇權。 | 依本合成案所列出處與問題中的數字核對，釐清差異、假設或缺件。 | CT B6/C6 vs E6；REG p.1；DECK p.6；facts.md D9 | 書面 | 1 |
| 文件請求（股權） | Cap Table 全表無任何 as-of 基準日欄位（期間僅能由檔名「202606」推斷），且僅有股數/比例/Common・Seed 標籤，缺股票類別（普通股/優先股）、每股發行價格、投資金額與選擇權明細。請提供載明基準日之最新 fully-diluted Cap Table（投前/投後各一版，含股別、每股價格、選擇權與任何 warrant/CB），並由股務代理（Pacific Corporate Services Ltd.）出具最新完整股東名冊（非 Extract）。 | D1/D2 之 300,000 股異動時點目前只能靠檔名推斷；無日期、無股別之 cap table 無法作為交易文件基礎，投後結構亦無從驗證。 | CT 全表 A1:E8（無日期欄）；REG p.1（標題為 Extract、Registrar 名稱）；facts.md D16、F23 | 書面 | 1 |
| 特殊條款/side letter | 請提供 Seed 輪之 SPA、SHA 及公司與 Vertex Growth Fund LP、Harbor Angels LLC 間任何 side letter／增補協議，並說明 Vertex 董事席位以外之特別權利（清算優先權、反稀釋、贖回權、保留事項/否決權、ROFR/co-sale、資訊權）。特別請確認：2026/3–6 月間 Vertex 轉讓 300,000 股是否已依 SHA 踐行 ROFR/co-sale 程序？ | 依本合成案所列出處與問題中的數字核對，釐清差異、假設或缺件。 | CT E4（Board seat）；REG p.1（未載股別與特別權利）；facts.md D1；資料室無 SPA/SHA（6 張字卡覆蓋範圍內未見） | 書面（條款緣由口頭） | 2 |
| 治理/董事會 | 目前董事會總席次與組成為何（Cap Table 僅見 Vertex 持一席之備註）？獨立席位、observer 安排？本輪 Series A 擬新增之董事席位、保留事項（reserved matters）與股東會特別決議門檻為何？請併附現行公司章程（COI/Articles/Bylaws）及近 24 個月董事會決議清單。 | 兩位創辦人合計 58% 已過半，但董事會層級控制權、既有投資人否決權範圍全無文件可稽；章程為資料室缺件，屬標準交易文件。 | CT E4、C2+C3（58%）；REG p.1；facts.md F9；資料室無章程（字卡覆蓋範圍內未見） | 書面 | 2 |
| 創辦人/人事 | Daniel Wu（Founder/CEO，34%）與 Grace Lin（Founder/CTO，24%）是否均全職在職？有無其他事業或兼職？兩位之創辦人股份是否設有 vesting／reverse vesting 與競業/留任安排？若無，本輪是否擬新設？ | 依本合成案所列出處與問題中的數字核對，釐清差異、假設或缺件。 | CT B2:C3；REG p.1；facts.md F7/F8/F9 | 口頭 | 2 |
| 組織/人事（文件請求） | 請提供完整組織圖、Headcount by function（R&D／Sales／CS／US fleet ops 等；Deck 稱 Team of 34）、目前在職人數與 2026–2027 招募計畫，及關鍵高階（CEO、CTO、業務主管、財務最高主管）之 CV。另請說明：公司目前是否設有 CFO 或財務長級主管？本輪 US$8.0M 中 45% 投入 US fleet ops，對應之美國團隊現有幾人、擬增聘幾人？ | 依本合成案所列出處與問題中的數字核對，釐清差異、假設或缺件。 | DECK p.1（Team of 34）、p.6（US fleet ops 45%）；MODEL 損益預估!B2（2026 營收 US$7.1M）；facts.md D6 | 書面 | 2 |
| 集團架構/轉投資實體 | Deck 載總部為 Taipei / San Jose，惟審計報告主體僅 ACME ROBOTICS, INC. 且標題為「Consolidated」財報 — 請提供集團架構圖（各實體名稱、註冊地、層級與持股%）、台灣與美國各實體之 Cap Table 與設立文件，並說明：合併範圍包含哪些實體？母子公司間移轉訂價與收入認列方式？FY2025 美國 3 家客戶（Pacific Fulfillment 12%＋MetroParts 7%＋Nordic 5%，合計 24%）之合約簽署主體與收款實體為何？ | 依本合成案所列出處與問題中的數字核對，釐清差異、假設或缺件。 | DECK p.1（Taipei/San Jose）；FIN p.1（Consolidated、主體名）；TOP10 B3/B6/B8、D3/D6/D8；facts.md F17 | 書面 | 2 |
| 本輪條件 | 本輪 US$8.0M @ pre-money US$40.0M，約為 FY2025 經審計營收 US$3,204,118 之 12.5 倍 — (1) 是否已有領投？請提供已簽署或流通中之 Term Sheet；(2) 目前已 commit 之投資人與累計金額？(3) pre-money US$40.0M 是否包含 ESOP 擴池？若本輪擬擴池，擴池由投前或投後股東稀釋？(4) 為支持估值合理性，請提供公司參考之可比公司（comps）名單與倍數。 | 依本合成案所列出處與問題中的數字核對，釐清差異、假設或缺件。 | DECK p.6；FIN p.1（營收、毛利率 41.2%、營運虧損 US$(2,782,281)）；facts.md F22/F23 | 口頭（Term Sheet 與 comps 書面） | 1 |
| 債務/交易先決 | 審計報告 Note 7 揭露「substantially all」機器人設備已質押予 First Pacific Bank，擔保 US$1.5M 信用額度（帳列長期負債 US$1,500,000），惟 Deck 全文（p.1–6）無任何質押揭露 — 請提供該貸款合約全文，並說明：財務承諾條款（covenants）、到期日與利率、有無 change-of-control 或增資須銀行同意之條款？本輪 Series A 交割是否觸發任何同意權或還款義務？ | RaaS 模式下 388 台機器人即核心營運資產，幾乎全數設質直接影響 Series A 投資人債權順位與資產彈性；若貸款含 change-of-control 條款，屬交易先決條件；募資簡報未揭露此事本身即為誠信訊號。 | FIN p.3 Note 7、p.2（Long-term debt US$1,500,000）；DECK p.3（388 robots）、p.1–6（無質押揭露）；facts.md F20/D12 | 書面（未揭露原因口頭） | 1 |
| 文件請求（財務） | 現有 FY2025 審計報告僅 3 頁摘要（無現金流量表、無完整資產負債表、無股東權益變動表與完整附註）。請提供：(1) FY2023–FY2025 完整財簽全文（含會計師查核意見全文；公司 2022 年成立，請自有財報年度起）；(2) 2026 年 1–5 月自結報表；(3) 若 FY2024（Deck 隱含約 US$1.33M 營收）未經審計，請說明並補財簽。 | 文件完備性鐵則：3 頁「highlights」不足以支撐投決 — 營運虧損 US$(2.78)M、現金 US$4.9M 的公司，沒有現金流量表無法驗證跑道；FY2024 數字僅能由 Deck 2.4x YoY 反推，無獨立佐證。 | FIN p.1–3（全文僅 3 頁、無現金流量表）；DECK p.3（US$3.2M、2.4x YoY）；facts.md F22/D13 | 書面 | 1 |
| 出場路徑 | 管理層對退場路徑之偏好與時程：M&A vs IPO？若 IPO，預計市場/板塊（US／TW／JP）與時間表？若 M&A，Deck 將 Locus Robotics、6 River（Ocado）、Geek+ 列為競爭者 — 管理層認為最可能之策略買方為誰？Vertex（Seed 輪、持董事席）對出場時程與方式之期待為何，SHA 中有無 drag-along／registration rights 等出場相關條款？ | 出場路徑檢核為 IC 必答項：本輪 12.5x 營收進場，需明確回收情境；Vertex 減持 300,000 股（D1）後對出場之立場更需當面確認，與其董事席位形成治理張力。 | DECK p.5（競爭者名單）、p.6（本輪條件）；CT E4；facts.md D1；SHA 為缺件 | 口頭 | 2 |

附註：
- 波次 1 集中於「影響本輪定價與交割先決」之題（股權異動、fully-diluted 口徑、本輪條件、質押、財簽完備性）；波次 2 為治理深掘（SHA 條款、董事會、創辦人、實體架構、出場）。
- 敏感題（創辦人全職、轉讓價格事由、commit 進度、出場立場、Deck 未揭露質押之原因）標口頭；文件請求一律書面。
- QuickShip 終止（D8）、毛利率口徑（D3/D10）、財測邏輯（D6/D11）屬營運/財務 persona 主場，本視角僅於 Note 7／財簽完備性處間接覆蓋，未重複出題。
