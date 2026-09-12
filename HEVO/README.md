# HEVO 公開資料

依使用者指定的兩個公開來源建立，原始文件放在 `round1/`。這批公開來源由使用者明確授權加入 repo；不是機密 Data Room，也不是合成案例。已完成第一輪候選 Q-list 與接續分析；尚未正式發出或結案。

## 文件

- [`round1/HEVO-Investor-Deck.pdf`](round1/HEVO-Investor-Deck.pdf)：[HEVO Investor Deck 官方原檔](https://lp.hevo.com/wp-content/uploads/2026/01/HEVO-Investor-Deck.pdf)。
- [`round1/SEC-Form-C-2025-07-07-index.html`](round1/SEC-Form-C-2025-07-07-index.html)：SEC 目錄的瀏覽器內容存檔；移除網站導覽與腳本，文件連結已改指向本地副本。
- [`round1/SEC-2025-07-07/`](round1/SEC-2025-07-07/)：SEC 目錄內的全部 18 個文件連結，包含主申報文件 HTML／XML、`document_1.pdf` 至 `document_14.pdf`、`documents_list.htm` 與完整申報文字檔的 gzip 副本。

SEC 申報：HEVO Inc.；Form C；日期 2025-07-07；Accession 0001670254-25-000685。
[官方申報目錄](https://www.sec.gov/Archives/edgar/data/1587317/000167025425000685/0001670254-25-000685-index.htm)

## 完整申報文字檔

原始 `0001670254-25-000685.txt` 為 199,458,673 bytes，超過 GitHub 單檔限制，因此以無損 gzip 保存（95,200,347 bytes），不需分段。可於本資料夾執行以下指令還原；已驗證解壓後內容逐 byte 與原檔相同：

```sh
gzip -dc round1/SEC-2025-07-07/0001670254-25-000685.txt.gz > round1/SEC-2025-07-07/0001670254-25-000685.txt
```

## 驗證與來源

取得日期：2026-09-12。全部 SEC 文件已下載；目錄中有標示大小的檔案均核對一致。14 份 PDF 的檔頭與結尾標記已檢查。

- `sec-sources.json`：逐檔官方來源 URL、SEC 宣告大小、原檔大小、SHA-256 與保存路徑。
- `manifest.json`：已保存檔案的大小與 SHA-256（包含 gzip 本身）。

原始來源網址已移除 `utm_source` 追蹤參數。原始 PDF、XML、HTML、HTM 內容未改寫；僅另外保存的目錄頁調整了導覽與連結。

## 拉取後直接使用

```sh
git pull origin main
python3 HEVO/prepare_indexes.py
# 依根目錄 README 安裝依賴並啟動工作台後，選取 HEVO。
```

prepare_indexes.py 先比對原始檔 SHA256，再把已保存索引的檔案時間更新為本次 checkout；不呼叫模型、不改原始文件、不把舊索引標為 schema 4。搜尋資料庫會由工作台按需重建。原始檔不符時會停止，須重新索引。

共享快照包括字卡、逐頁/OCR 索引、facts 對帳、41題草稿、目前審核匯出與查核報告。執行期日誌、私人對話、跨案件記憶及可重建 SQLite 未上傳。

來源為公開披露的歷史快照，問題及疑點不是公司違規的認定。本次原生一鍵流程受阻，經主代理接續完成；部分頁面已目視覆核，不能宣稱全部209頁均核原圖。這份快照仍含 schema 2/3 索引與舊版字卡；最新五段字卡及視覺索引要重新執行才會產生，非新版完整流程通過的證明。

入口：[_analysis/drafts/draft_R1.md](_analysis/drafts/draft_R1.md)、[_analysis/facts.md](_analysis/facts.md)、[_analysis/acceptance/RESULTS.md](_analysis/acceptance/RESULTS.md)。
