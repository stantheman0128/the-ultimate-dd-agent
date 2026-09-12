# HEVO 原始資料覆蓋獨立驗收

驗收日：2026-09-12。僅讀 HEVO；不讀 Q-list 或 pipeline 其他 persona 草稿。本報告不是投資建議，也不是完整字卡漏抽率驗收。

## 盤點結論

- manifest 列出的 22 個檔案全部存在，byte 數與 SHA-256 全部相符，詳見 manifest-verification.json。
- 實際 PDF 共 **15 份、209 頁**，其中 SEC 附件 14 份共 **172 頁**。229／192 不是目前原檔實際頁數。
- SEC 172 頁原生文字全部為零，必須 OCR 或視覺閱讀。簡報 37 頁有 35 頁原生文字 >=30 字元（94.59%）；字少不代表空白。
- 所有 209 頁均成功渲染。36dpi RGB 像素精確雜湊無重複頁；這不排除縮放、掃描方式、版面改動的內容重複。
- 渲染 SEC 文件時 MuPDF 出現 ICC profile (N=3) is not Gray 訊息，仍能產生可讀圖；不可把這種警告當成已成功抽文的證據。
- 完整申報 txt.gz 是封存集合，不應與各附件重複算獨立證據；HTML/XML 亦應只取其獨立申報欄位。

## 逐檔原始頁数與文字覆蓋

所有頁碼均為 PDF 實體頁碼。

| 檔案 | 頁數 | 原生文字 >=30 字元頁數 | 文件辨識（SEC 首頁 OCR） |
|---|---:|---:|---|
| HEVO-Investor-Deck.pdf | 37 | 35 | 投資簡報，含 2025 年底資訊與 2026 起計畫 |
| document_1.pdf | 24 | 0 | Form C |
| document_2.pdf | 28 | 0 | 募資頁面／投資介紹 |
| document_3.pdf | 11 | 0 | HEVO Subscription Agreement |
| document_4.pdf | 13 | 0 | HEVO III SPV Subscription Agreement |
| document_5.pdf | 25 | 0 | 2024、2023 年經查核合併財報 |
| document_6.pdf | 2 | 0 | Jeremy McCool 履歷 |
| document_7.pdf | 3 | 0 | Robert Remenar 履歷 |
| document_8.pdf | 5 | 0 | Yifan Tang 履歷 |
| document_9.pdf | 17 | 0 | 修訂公司章程 |
| document_10.pdf | 9 | 0 | Investors’ Rights Agreement |
| document_11.pdf | 17 | 0 | Voting Agreement |
| document_12.pdf | 15 | 0 | ROFR and Co-Sale Agreement |
| document_13.pdf | 2 | 0 | Schedule A 投資人個別條款／獎勵 |
| document_14.pdf | 1 | 0 | Schedule B warrant 條款摘要 |

SEC PDF 均在 round1/SEC-2025-07-07/；逐頁 chars、images、render hash 見 coverage-inventory.json。

## 抽查揭露的 OCR 誤讀（已核原始圖）

| 來源 | OCR 初讀 | 原始頁面目視值 | 對 Q-list 的影響 |
|---|---|---|---|
| document_5.pdf p.6 2024 應付帳款 | 416,331 | **414,331** | 不得用 OCR 錯數製造加總差異 |
| document_5.pdf p.6 租賃負債流動部分 | 114,517 | **111,517** | 與 p.24 的 111,517 一致，不能列為跨表矛盾 |
| document_5.pdf p.24 租賃利息 | (4,883) | **(1,883)** | 113,400 減 1,883 對得上 111,517；勿用錯字生成問題 |

原始截圖 financial-p6.png、financial-p24.png 保留於本目錄。OCR 文字只是驗收中間產物，不是經確認資料集。逐格重新對帳仍須由管線完成。

## 年代／法律文件狀態

- SEC 申報 2025-07-07，財報涵蓋 2024/2023；財報 p.25 期後事項評估至 2025-05-01，p.3 查核報告 2025-05-04。不能當作 2026-09 當期財務。
- 官網简报下載路徑含 2026/01，但確切版次需向公司確認；內文 p.7 引 S&P Nov-25、p.19 提 Nov 2025 交易，因此與 SEC 申報不是同一資訊截止日。
- document_7.pdf p.1 履歷稱 July 2025-Present (1 month)，與封存申報日看似不完全一致，應詢問履歷快照日期，而非直接認定內容錯誤。
- document_10/11/12 首頁有效日期留空；不能把附件樣板當成已簽有效文件。document_14 p.1 明示摘要不具約束力，須 definitive Warrant Agreement 簽署後生效。

## 後續 Q-list 應檢查的證據主題

1. **現金與持續營運**：document_5 p.5 2024 年底 cash 27,940；p.25 substantial doubt、歷年虧損及負營運資金；Deck p.33 聲稱 $5M 提供 18+ 個月 runway、2029 才量產。索取 2025 至最近月月報、資金橋接、分階段量產所需後續募資，不把不同日期直接判矛盾。
2. **授權終止後借款**：document_5 p.18–19，原 $1M 歐亞部分國家獨家授權款在終止關係後轉為無息長借款，約定有財力時返還。應問 termination/settlement 正式文件、權利回復、清償條件與是否有其他義務。
3. **員工薪酬轉 warrants**：document_5 p.25 披露 2025-01-31 將 $1,403,921 應付薪酬安排轉為薪酬修改及 1,600,000 warrants；須取得已簽協議、全部權證行使／稀釋與薪酬調整後現金需求。
4. **股票報酬估計調整**：document_5 p.24 披露 $491,318 累計高估於2024逆轉，正常當年 $382,279、淨減少費用 $109,039；應要求調整橋接與查核說明，不能逕稱舞弊或前期錯誤。
5. **融資計算口徑**：Deck p.27 同頁有 $19.2M 與 over $20M，應拆股權、借款、補助及截止日。document_13 p.1 / document_14 p.1 涉 Tier01/Tier02、SAFE 轉換、$0.01 warrants、5年期間；須取得有效定稿及fully diluted cap table，不能只用摘要估值。
6. **OEM 商轉而非合作名稱**：Deck p.30 兩家 OEM 涉4及3平台、100k units/year、$100M annual target、2029 start；問開發/選定供應商/量產訂單之間的狀態、取消權、量產門檻與期間。Deck p.33 尚待 securing production agreements，應確認是否具最低採購承諾。
7. **單位經濟與競品說法**：Deck p.17 $250 車端/$1,200充電器、p.19 OEM量價$1,500、p.22 target $1,200與installation $400；問同口徑BOM、規模/毛利、維護、安裝前提，避免把target當現售價格。p.18 93%效率須要測試條件與各功率產品ready狀態。
8. **IP/技術依賴**：Deck p.3 17 patent families、ORNL合作；p.19 自研/IP control與ORNL授權並存。問已簽授權範圍、排他、royalty、終止及各型號證認。
9. **基線缺件**：有歷史財簽、章程與條款附件，不應一概宣告缺所有法律文件；缺的是目前有效／已簽版本、最新財務、現況cap table、財測模型、訂單明細與客戶合約狀態。Top-N客戶/地區營收/全年收入成本拆分仍要覆盖。

## 覆蓋限制

本驗收逐頁機械盤點209頁，但只獨立OCR14份SEC首頁及財報13頁（p.3–7、18–25），視覺核對財報p.6、24；未宣稱172掃描頁全部已經人工/模型理解，亦未計算字卡漏抽率。pipeline成敗与Q-list最终覆盖须结合运行结果另验收。
