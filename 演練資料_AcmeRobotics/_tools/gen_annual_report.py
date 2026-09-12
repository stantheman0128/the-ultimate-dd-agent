#!/usr/bin/env python3
"""產生 Acme Robotics 合成示範年報與客戶合約摘要。

用法：python3 演練資料_AcmeRobotics/_tools/gen_annual_report.py
產物僅供測試與示範，不代表真實公司資料。
"""
import os, random, datetime
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from reportlab.lib.utils import simpleSplit

HERE = os.path.dirname(os.path.abspath(__file__))
DEAL = os.path.dirname(HERE)
OUT_PDF = os.path.join(DEAL, 'Acme_Robotics_FY2025_Annual_Report_Full.pdf')
OUT_XLSX = os.path.join(DEAL, 'demo_extra', 'Acme_客戶合約摘要_2026H1.xlsx')

MINE_RP_PAGE = 312   # Note 27 起始頁
MINE_COV_PAGE = 486  # Note 41 起始頁
TARGET_TOTAL = 520

W, H = letter
MARGIN = 54
FONT, SIZE, LEAD = 'Helvetica', 10, 13.0
BODY_LINES = 50  # 每頁正文行數（另加頁首頁尾）
FILLER_ROWS = 22  # 附表填充頁的資料列數（控制 token 密度：520 頁約 1.2M 字元 ≈ 38 萬 tokens，整份可進 1M context）
MAXW = W - 2 * MARGIN
rnd = random.Random(20250912)

# 與三頁摘要版一致的主表數字
FIN = dict(revenue=3204118, sub=1872404, usage=913220, hw=418494, cogs=1884022, gp=1320096,
           rd=1988105, sm=1306880, ga=807392, opex=4102377, oploss=-2782281,
           cash=4918551, ar=1152730, inv=688214, defrev=941808, ltd=1500000, shares=10000000)
FY24 = dict(revenue=1335049, cogs=889366, gp=445683, rd=1210442, sm=526110, ga=512377, opex=2248929, oploss=-1803246,
            cash=2417338, ar=402118, inv=312880, defrev=311204, ltd=0)

def money(x):
    return f"({abs(x):,})" if x < 0 else f"{x:,}"

class Book:
    def __init__(self):
        self.pages = []      # list of list-of-lines
        self.cur = []
        self.toc = []        # (title, page_no)
    @property
    def page_no(self):
        return len(self.pages) + 1
    def flush(self):
        self.pages.append(self.cur); self.cur = []
    def line(self, s=''):
        if len(self.cur) >= BODY_LINES:
            self.flush()
        self.cur.append(s)
    def para(self, text, indent=0):
        for ln in simpleSplit(text, FONT, SIZE, MAXW - indent):
            self.line((' ' * 0) + ln)
        self.line('')
    def heading(self, title, toc=False, level=1):
        if len(self.cur) > BODY_LINES - 6:
            self.flush()
        if toc:
            self.toc.append((title, self.page_no))
        if level == 1:
            self.line(title.upper()); self.line('=' * min(len(title), 90))
        else:
            self.line(title); self.line('-' * min(len(title), 90))
        self.line('')
    def table(self, rows, widths):
        for r in rows:
            cells = []
            for c, w in zip(r, widths):
                c = str(c)
                cells.append(c[:w].ljust(w) if not c.replace(',', '').replace('(', '').replace(')', '').replace('.', '').replace('%', '').replace('-', '').strip().isdigit() else c[:w].rjust(w))
            self.line('  '.join(cells))
        self.line('')
    def page_break(self):
        if self.cur:
            self.flush()
    def pad_to(self, page_no, filler):
        """用可信的附表把頁數墊到 page_no（下一個章節從該頁開始）"""
        self.page_break()
        guard = 0
        while self.page_no < page_no and guard < 5000:
            filler(self); self.page_break(); guard += 1
        assert self.page_no == page_no, (self.page_no, page_no)

# ---------------- 內容 ----------------
SITES = [('LogiOne 3PL', 'TW', 9), ('Pacific Fulfillment', 'US', 5), ('QuickShip Logistics', 'TW', 4), ('Hansei Logistics', 'JP', 4),
         ('MetroParts Dist.', 'US', 3), ('Formosa Cold Chain', 'TW', 3), ('Nordic Storage', 'US', 2), ('Kyushu Micro-FC', 'JP', 2),
         ('BlueBox Storage', 'TW', 2), ('Taipei eGrocer', 'TW', 2), ('Osaka Parcel Hub', 'JP', 2), ('Kaohsiung Port Logistics', 'TW', 3)]
ROBOT_MODELS = ['AR-200', 'AR-200X', 'AR-300']

def fleet_filler(b):
    b.heading('Schedule F — Fleet Register (continued)', level=2)
    b.line('Serial          Model     Site                        Commissioned   Cost (US$)   NBV (US$)   Status')
    b.line('-' * 100)
    for _ in range(FILLER_ROWS):
        site = rnd.choice(SITES)
        cost = rnd.randint(21000, 34000); nbv = int(cost * rnd.uniform(0.35, 0.9))
        d = datetime.date(2024, 1, 1) + datetime.timedelta(days=rnd.randint(0, 720))
        status = rnd.choices(['in service', 'in service', 'in service', 'spare', 'under repair', 'redeployed'], k=1)[0]
        b.line(f"ACM-{rnd.randint(100000,999999)}   {rnd.choice(ROBOT_MODELS):<8}  {site[0]:<27} {d.isoformat()}     {cost:>8,}    {nbv:>8,}   {status}")
    b.line('')

def lease_filler(b):
    b.heading('Schedule L — Site Lease and Service Commitments (continued)', level=2)
    b.line('Site                        Country   Lease start   Lease end     Monthly (US$)   Renewal option')
    b.line('-' * 100)
    for _ in range(FILLER_ROWS):
        site = rnd.choice(SITES)
        s = datetime.date(2024, 1, 1) + datetime.timedelta(days=rnd.randint(0, 600)); e = s + datetime.timedelta(days=rnd.choice([365, 730, 1095]))
        b.line(f"{site[0]:<27} {site[1]:<8}  {s.isoformat()}    {e.isoformat()}    {rnd.randint(1800, 9800):>9,}     {rnd.choice(['yes', 'yes', 'no', 'mutual'])}")
    b.line('')

def dep_filler(b):
    b.heading('Schedule D — Depreciation Roll-forward by Asset Class (continued)', level=2)
    b.line('Asset class            Opening NBV   Additions   Disposals   Depreciation   Impairment   Closing NBV')
    b.line('-' * 100)
    classes = ['Robotics equipment', 'Charging infrastructure', 'Controllers (in-house)', 'Warehouse fixtures', 'Computer equipment', 'Vehicles', 'Leasehold improvements', 'Software']
    for _ in range(FILLER_ROWS):
        c = rnd.choice(classes); o = rnd.randint(20000, 900000); a = rnd.randint(0, 300000); dsp = rnd.randint(0, 40000); dep = int(o * rnd.uniform(0.08, 0.25)); imp = rnd.choice([0, 0, 0, rnd.randint(0, 20000)])
        b.line(f"{c:<22} {o:>11,}   {a:>9,}   {dsp:>9,}   {dep:>12,}   {imp:>10,}   {o + a - dsp - dep - imp:>11,}")
    b.line('')

FILLERS = [fleet_filler, lease_filler, dep_filler]
def any_filler(b):
    FILLERS[b.page_no % len(FILLERS)](b)

def boiler(topic):
    """可讀的會計政策樣板句（每段略有差異，避免完全重複）"""
    base = [
        f"The Company's accounting policy for {topic} is applied consistently across all reporting periods presented in these consolidated financial statements.",
        f"Management evaluates the assumptions underlying {topic} at each reporting date, considering historical experience, current conditions and reasonable and supportable forecasts.",
        f"Changes in estimates relating to {topic} are recognised prospectively in the period in which the estimate is revised and in any future periods affected.",
        f"Where the effect of the time value of money is material, amounts relating to {topic} are discounted using a pre-tax rate that reflects current market assessments.",
        f"The Company has not identified any material uncertainty in respect of {topic} that would require additional disclosure beyond that provided in this note.",
    ]
    rnd.shuffle(base)
    return ' '.join(base[:rnd.randint(3, 5)])

def build():
    b = Book()
    # ---- 封面 ----
    b.line(''); b.line(''); b.line('ACME ROBOTICS, INC.'); b.line('Consolidated Financial Statements and Annual Report'); b.line('For the fiscal year ended December 31, 2025')
    b.line(''); b.line('Audited — Chen & Willis LLP, Independent Auditor'); b.line(''); b.line('Prepared for the Series A data room · Confidential'); b.page_break()
    # ---- 目錄（先佔 2 頁，最後回填）----
    toc_pages = (b.page_no, b.page_no + 1)
    b.page_break(); b.page_break()
    # ---- CEO letter ----
    b.heading('Letter from the Chief Executive Officer', toc=True)
    b.para("To our shareholders: fiscal 2025 was the year Acme Robotics moved from a promising pilot business to a company with 41 live sites and 388 robots under management across Taiwan, Japan and the United States. Revenue grew to US$3,204,118, 2.4x the prior year, driven by subscription revenue of US$1,872,404 and usage fees of US$913,220.")
    b.para("Our Robots-as-a-Service model continues to resonate with mid-market third-party logistics operators who cannot justify fixed automation. Average deployment time of three weeks remains our core commercial advantage. We ended the year with cash of US$4,918,551 and are raising a Series A to accelerate our US fleet operations.")
    b.para("We remain focused on unit economics. Gross margin on a consolidated basis was 41.2% in fiscal 2025 including hardware sales and installation; excluding hardware and installation, contribution margin on recurring revenue was materially higher. Details are provided in the Management Discussion and Analysis and in Note 4 to the financial statements.")
    b.para("Daniel Wu, Founder and Chief Executive Officer")
    b.page_break()
    # ---- MD&A ----
    b.heading("Management's Discussion and Analysis", toc=True)
    for t in ['Overview of the business', 'Results of operations', 'Revenue by stream', 'Cost of revenue and gross margin', 'Operating expenses', 'Liquidity and capital resources', 'Key operating metrics', 'Risk factors', 'Outlook']:
        b.heading(t, level=2)
        if t == 'Revenue by stream':
            b.table([['Stream', 'FY2025 (US$)', 'FY2024 (US$)', 'Change'], ['Subscription', money(FIN['sub']), '801,029', '+134%'], ['Usage fees', money(FIN['usage']), '384,020', '+138%'], ['Hardware sales & installation', money(FIN['hw']), '150,000', '+179%'], ['Total revenue', money(FIN['revenue']), money(FY24['revenue']), '+140%']], [30, 14, 14, 8])
        elif t == 'Cost of revenue and gross margin':
            b.para(f"Cost of revenue was US${FIN['cogs']:,} (FY2024: US${FY24['cogs']:,}). Gross profit was US${FIN['gp']:,}, a gross margin of 41.2% (FY2024: 33.4%). Hardware sales and installation carry a negative gross margin in the period of installation because installation labour is expensed as incurred.")
        elif t == 'Key operating metrics':
            b.table([['Metric', 'Dec 31, 2025', 'Dec 31, 2024'], ['Live sites', '41', '17'], ['Robots deployed', '388', '142'], ['Average monthly fee per site (US$)', '8,400', '7,900'], ['Largest customer share of revenue', '31%', '38%'], ['Top-10 customers share of revenue', '88%', '96%'], ['Days sales outstanding (management basis)', '87', '71']], [44, 16, 16])
            b.para("Days sales outstanding on a management basis is computed on Q4 annualised revenue. On a full-year basis (accounts receivable divided by annual revenue times 365) the figure would be approximately 131 days; see Note 12.")
        elif t == 'Liquidity and capital resources':
            b.para(f"Cash and cash equivalents were US${FIN['cash']:,} at December 31, 2025. The Company has a US$1.5 million credit facility with First Pacific Bank which was fully drawn at year end (Note 41). Substantially all robotics equipment is pledged as collateral (Note 7). Management believes existing cash together with the proposed Series A financing is sufficient for at least twelve months.")
        elif t == 'Risk factors':
            for r in ['Customer concentration', 'Dependence on key suppliers of LiDAR and battery modules', 'Regulatory certification of autonomous mobile robots in the United States and Japan', 'Covenants under the credit facility', 'Ability to raise additional capital', 'Competition from enterprise-focused vendors entering the mid-market']:
                b.para(f"{r}. " + boiler(r.lower()))
        else:
            for _ in range(3):
                b.para(boiler(t.lower()))
    b.page_break()
    # ---- 會計師報告 ----
    b.heading("Independent Auditor's Report", toc=True)
    b.para("To the Board of Directors and Shareholders of Acme Robotics, Inc. Opinion: We have audited the consolidated financial statements of Acme Robotics, Inc. and its subsidiaries, which comprise the consolidated balance sheet as at December 31, 2025, the consolidated statements of operations, changes in shareholders' equity and cash flows for the year then ended, and notes to the consolidated financial statements. In our opinion, the accompanying consolidated financial statements present fairly, in all material respects, the financial position of the Company as at December 31, 2025.")
    b.para("Emphasis of matter — Related party transactions: We draw attention to Note 27, which describes purchases from an entity controlled by the Chief Executive Officer. Our opinion is not modified in respect of this matter.")
    b.para("Emphasis of matter — Covenants: We draw attention to Note 41, which describes financial covenants and consent rights under the Company's credit facility. Our opinion is not modified in respect of this matter.")
    b.para("Chen & Willis LLP, San Jose, California. March 6, 2026.")
    b.page_break()
    # ---- 主表 ----
    b.heading('Consolidated Statement of Operations', toc=True)
    b.table([['(US$)', 'FY2025', 'FY2024'], ['Subscription revenue', money(FIN['sub']), '801,029'], ['Usage fees', money(FIN['usage']), '384,020'], ['Hardware sales & installation', money(FIN['hw']), '150,000'],
             ['Total revenue', money(FIN['revenue']), money(FY24['revenue'])], ['Cost of revenue', money(FIN['cogs']), money(FY24['cogs'])], ['Gross profit', money(FIN['gp']), money(FY24['gp'])],
             ['Research and development', money(FIN['rd']), money(FY24['rd'])], ['Sales and marketing', money(FIN['sm']), money(FY24['sm'])], ['General and administrative', money(FIN['ga']), money(FY24['ga'])],
             ['Total operating expenses', money(FIN['opex']), money(FY24['opex'])], ['Operating loss', money(FIN['oploss']), money(FY24['oploss'])], ['Interest expense', '(96,250)', '(4,100)'], ['Net loss', money(FIN['oploss'] - 96250), money(FY24['oploss'] - 4100)]], [36, 14, 14])
    b.page_break()
    b.heading('Consolidated Balance Sheet', toc=True)
    b.table([['(US$)', 'Dec 31, 2025', 'Dec 31, 2024'], ['Cash and cash equivalents', money(FIN['cash']), money(FY24['cash'])], ['Accounts receivable, net', money(FIN['ar']), money(FY24['ar'])], ['Inventory (robot components)', money(FIN['inv']), money(FY24['inv'])],
             ['Prepaid expenses', '141,900', '62,300'], ['Total current assets', money(FIN['cash'] + FIN['ar'] + FIN['inv'] + 141900), money(FY24['cash'] + FY24['ar'] + FY24['inv'] + 62300)], ['Robotics equipment, net', '6,214,880', '2,903,115'], ['Other non-current assets', '188,400', '90,000'],
             ['Total assets', money(FIN['cash'] + FIN['ar'] + FIN['inv'] + 141900 + 6214880 + 188400), money(FY24['cash'] + FY24['ar'] + FY24['inv'] + 62300 + 2903115 + 90000)],
             ['Accounts payable', '612,330', '288,410'], ['Accrued liabilities', '402,115', '176,200'], ['Deferred revenue', money(FIN['defrev']), money(FY24['defrev'])], ['Long-term debt (Note 41)', money(FIN['ltd']), '0'],
             ['Total liabilities', money(612330 + 402115 + FIN['defrev'] + FIN['ltd']), money(288410 + 176200 + FY24['defrev'])], ["Shareholders' equity", money(FIN['cash'] + FIN['ar'] + FIN['inv'] + 141900 + 6214880 + 188400 - (612330 + 402115 + FIN['defrev'] + FIN['ltd'])), money(FY24['cash'] + FY24['ar'] + FY24['inv'] + 62300 + 2903115 + 90000 - (288410 + 176200 + FY24['defrev']))],
             ['Common shares outstanding', money(FIN['shares']), '10,000,000']], [36, 14, 14])
    b.page_break()
    b.heading('Consolidated Statement of Cash Flows', toc=True)
    b.table([['(US$)', 'FY2025', 'FY2024'], ['Net loss', money(FIN['oploss'] - 96250), money(FY24['oploss'] - 4100)], ['Depreciation', '1,102,440', '412,300'], ['Change in accounts receivable', money(-(FIN['ar'] - FY24['ar'])), '(298,400)'], ['Change in deferred revenue', money(FIN['defrev'] - FY24['defrev']), '201,100'],
             ['Net cash used in operating activities', '(1,644,780)', '(1,488,346)'], ['Purchase of robotics equipment', '(4,414,205)', '(1,910,220)'], ['Proceeds from credit facility', '1,500,000', '0'], ['Proceeds from Seed financing', '7,060,000', '0'], ['Net change in cash', money(FIN['cash'] - FY24['cash']), '(3,398,566)']], [40, 14, 14])
    b.page_break()
    b.heading("Consolidated Statement of Changes in Shareholders' Equity", toc=True)
    b.table([['', 'Shares', 'Amount (US$)'], ['Balance at Dec 31, 2024', '10,000,000', '5,402,551'], ['Seed financing (Vertex Growth Fund LP, Harbor Angels LLC)', '—', '7,060,000'], ['Stock-based compensation (Note 15)', '—', '188,700'], ['Net loss', '—', money(FIN['oploss'] - 96250)], ['Balance at Dec 31, 2025', '10,000,000', '9,772,720']], [52, 12, 14])
    b.page_break()
    # ---- 附註 1–26 ----
    b.heading('Notes to the Consolidated Financial Statements', toc=True)
    notes_a = ['Organisation and nature of business', 'Basis of presentation', 'Revenue recognition', 'Cost of revenue and gross margin by stream', 'Customer concentration', 'Cash and cash equivalents',
               'Pledged assets', 'Accounts receivable and allowance', 'Subsequent events', 'Inventory', 'Robotics equipment', 'Days sales outstanding reconciliation', 'Deferred revenue', 'Income taxes',
               'Stock-based compensation', 'Leases', 'Research and development', 'Sales and marketing', 'General and administrative', 'Segment and geographic information', 'Fair value measurements',
               'Financial instruments and risk', 'Warranty provisions', 'Contingencies', 'Employee benefits', 'Share capital']
    for i, t in enumerate(notes_a, start=1):
        b.heading(f'Note {i}. {t}', toc=True, level=2)
        if i == 3:
            b.para("Subscription revenue is recognised ratably over the contract term. Usage fees are recognised on delivery of monthly pick reports to the customer, which management considers the point at which the performance obligation is satisfied. Hardware sales and installation are recognised at a point in time on completion of installation and customer acceptance.")
        elif i == 4:
            b.table([['Stream', 'Revenue', 'Cost', 'Gross margin'], ['Subscription', money(FIN['sub']), '691,220', '63.1%'], ['Usage fees', money(FIN['usage']), '512,880', '43.8%'], ['Hardware & installation', money(FIN['hw']), '679,922', '(62.5%)'], ['Total', money(FIN['revenue']), money(FIN['cogs']), '41.2%']], [26, 12, 12, 12])
            b.para("Gross margin excluding hardware sales and installation was 56.8% (FY2024: 44.0%). The Series A investor presentation refers to a 58% figure computed on subscription and usage revenue net of hosting credits; the reconciliation is available on request.")
        elif i == 5:
            b.para("The largest customer, LogiOne 3PL, represented 31% of FY2025 revenue (FY2024: 38%). The ten largest customers represented 88% of FY2025 revenue (FY2024: 96%). One customer representing approximately 9% of FY2025 revenue notified termination after year end; see Note 9.")
        elif i == 7:
            b.para("Substantially all robotics equipment, with a net book value of US$6,214,880 at December 31, 2025, has been pledged as collateral for the US$1.5 million credit facility with First Pacific Bank. The facility is fully drawn. See Note 41 for covenants and consent rights.")
        elif i == 9:
            b.para("In March 2026, QuickShip Logistics, a customer representing approximately 9% of FY2025 revenue, notified the Company of termination of its service agreement effective June 2026. Twelve robots deployed at four QuickShip sites are expected to be redeployed to new customers in the second half of 2026. Management does not expect an impairment.")
        elif i == 12:
            b.para("Days sales outstanding disclosed in Key operating metrics (87 days) is computed on fourth-quarter annualised revenue of US$4,835,200. Computed on full-year revenue, the metric is 131 days (US$1,152,730 / US$3,204,118 x 365). The difference reflects revenue growth during the year and, to a lesser extent, extended payment terms granted to LogiOne 3PL (net 90 days).")
        elif i == 15:
            b.para("The 2024 Equity Incentive Plan reserves 800,000 common shares (8.0% of shares outstanding). At December 31, 2025, options over 280,000 shares were outstanding (weighted average exercise price US$1.20, vesting over four years), leaving 520,000 shares (5.2%) unallocated. Stock-based compensation expense was US$188,700 (FY2024: US$41,200).")
        elif i == 20:
            b.table([['Geography', 'FY2025 revenue', 'Share', 'Live sites'], ['Taiwan', '1,666,141', '52%', '23'], ['Japan', '769,088', '24%', '8'], ['United States', '768,889', '24%', '10'], ['Total', money(FIN['revenue']), '100%', '41']], [16, 16, 8, 10])
            b.para("The United States contributed revenue from three customers in FY2025 (Pacific Fulfillment, MetroParts Dist., Nordic Storage). The first US site was commissioned in October 2025.")
        else:
            for _ in range(rnd.randint(2, 4)):
                b.para(boiler(t.lower()))
    # ---- 墊到 p.312：Note 27 關係人交易 ----
    b.pad_to(MINE_RP_PAGE, any_filler)
    b.heading('Note 27. Related Party Transactions', toc=True, level=2)
    b.para("During fiscal 2025 the Company purchased controller sub-assemblies and precision components from Harbor Peak Components LLC (\"Harbor Peak\"), an entity wholly owned by Daniel Wu, the Company's Founder and Chief Executive Officer. Purchases totalled US$640,120 (FY2024: nil) and represented approximately 34% of total component purchases for the year. Amounts payable to Harbor Peak at December 31, 2025 were US$88,400 and are included in accounts payable.")
    b.para("Management believes the prices paid approximate those that would be obtained from unrelated suppliers; no independent benchmarking was performed. The arrangement was approved by the Board of Directors in February 2025 with Mr. Wu abstaining. No written supply agreement was in place at December 31, 2025. These transactions are not described in the Series A investor presentation.")
    b.para("Other than as described above and the compensation of key management personnel (Note 25), there were no transactions with related parties during the year.")
    b.page_break()
    # ---- Notes 28–40 ----
    notes_b = ['Commitments', 'Capital management', 'Earnings per share', 'Comparative figures', 'Government grants', 'Site service agreements', 'Insurance', 'Intangible assets', 'Impairment testing', 'Provisions', 'Foreign currency', 'Events after the reporting period (other)', 'Supplier concentration']
    for j, t in enumerate(notes_b, start=28):
        b.heading(f'Note {j}. {t}', toc=True, level=2)
        if t == 'Site service agreements':
            b.para("Master service agreements with customers have initial terms of 12 to 36 months with automatic renewal unless terminated on 90 days' notice. Individual site schedules set the number of robots, the monthly subscription fee and per-pick usage rates. Contract expiry dates by customer are maintained in the commercial contract register.")
        elif t == 'Supplier concentration':
            b.para("The Company sources LiDAR modules from a single supplier and battery packs from two suppliers. Controller sub-assemblies are sourced from Harbor Peak Components LLC (Note 27) and one unrelated contract manufacturer.")
        else:
            for _ in range(rnd.randint(2, 4)):
                b.para(boiler(t.lower()))
    # ---- 墊到 p.486：Note 41 信用額度條款 ----
    b.pad_to(MINE_COV_PAGE, any_filler)
    b.heading('Note 41. Credit Facility — Covenants and Change of Control', toc=True, level=2)
    b.para("On September 30, 2025 the Company entered into a US$1,500,000 term credit facility with First Pacific Bank. The facility was fully drawn on October 3, 2025, bears interest at SOFR plus 4.25% and matures on September 30, 2027. It is secured by a first-priority lien on substantially all robotics equipment (Note 7).")
    b.para("Financial covenant: the Company must maintain unrestricted cash of not less than US$2,000,000, tested quarterly. At December 31, 2025 the Company was in compliance.")
    b.para("Consent rights: without the prior written consent of the lender the Company may not (i) issue equity securities for aggregate proceeds exceeding US$5,000,000 in any twelve-month period, (ii) undergo a change of control, defined as any transaction after which any person or group holds more than 50% of voting power or the right to appoint a majority of the board, (iii) incur additional indebtedness exceeding US$250,000, or (iv) dispose of pledged equipment outside the ordinary course. Failure to obtain consent constitutes an event of default entitling the lender to accelerate all amounts outstanding.")
    b.para("Management notes that the proposed Series A financing of US$8,000,000 would require lender consent under clause (i). Consent had not been requested as at the date of these financial statements. The facility and its consent rights are not described in the Series A investor presentation.")
    b.page_break()
    # ---- Notes 42–45 + 附錄，墊到 520 頁 ----
    for k, t in enumerate(['Reconciliation of non-GAAP measures', 'Board of Directors and management', 'Approval of financial statements', 'Glossary'], start=42):
        b.heading(f'Note {k}. {t}', toc=True, level=2)
        if k == 43:
            b.para("The Board of Directors comprises Daniel Wu (Chair and CEO), Grace Lin (CTO), one director appointed by Vertex Growth Fund LP under the Seed round shareholders' agreement, and one independent director. Vertex Growth Fund LP held 1,500,000 shares (15.0%) at the record date of the shareholder register dated March 15, 2026.")
        else:
            for _ in range(3):
                b.para(boiler(t.lower()))
    b.heading('Appendix A — Fleet Register', toc=True)
    b.pad_to(TARGET_TOTAL + 1, any_filler)
    b.page_break()
    # ---- 回填目錄 ----
    toc_lines = ['TABLE OF CONTENTS', '', 'Section                                                                    Page']
    for title, pg in b.toc:
        t = title[:70]
        toc_lines.append(f"{t}{'.' * max(2, 74 - len(t))} {pg:>4}")
    toc_lines.append(''); toc_lines.append('Planted-mine index (for the demo operator only): Note 27 p.%d, Note 41 p.%d' % (MINE_RP_PAGE, MINE_COV_PAGE))
    p1, p2 = toc_pages
    b.pages[p1 - 1] = toc_lines[:BODY_LINES]
    b.pages[p2 - 1] = toc_lines[BODY_LINES:BODY_LINES * 2]
    return b

def render(b, path):
    c = canvas.Canvas(path, pagesize=letter)
    c.setTitle('Acme Robotics, Inc. — FY2025 Annual Report (Audited)')
    for i, lines in enumerate(b.pages, start=1):
        c.setFont(FONT, 8.5); c.setFillGray(0.4)
        c.drawString(MARGIN, H - 36, 'ACME ROBOTICS, INC. · FY2025 Annual Report · Confidential — Series A data room')
        c.drawRightString(W - MARGIN, 30, f'Page {i} of {len(b.pages)}')
        c.setFillGray(0); c.setFont(FONT, SIZE)
        y = H - MARGIN - 6
        for ln in lines:
            if ln.isupper() and ln.strip() and len(ln) < 90:
                c.setFont('Helvetica-Bold', SIZE)
            c.drawString(MARGIN, y, ln[:118]); c.setFont(FONT, SIZE); y -= LEAD
        c.showPage()
    c.save()

def write_contract_xlsx(path):
    from openpyxl import Workbook
    from openpyxl.styles import Font
    os.makedirs(os.path.dirname(path), exist_ok=True)
    wb = Workbook(); ws = wb.active; ws.title = '合約摘要 2026H1'
    ws.append(['客戶', '國家', '站點數', '機器人台數', '合約起日', '合約到期日', '月費 (US$/站)', '自動續約', '目前狀態', '備註'])
    rows = [
        ['LogiOne 3PL', 'TW', 9, 88, '2024-07-01', '2026-12-31', 8400, '否', '進行中', '最大客戶；付款條件 net 90；到期日與 Deck p.4「2027/06」不一致'],
        ['Pacific Fulfillment', 'US', 5, 52, '2025-10-15', '2027-10-14', 9100, '是', '進行中', ''],
        ['QuickShip Logistics', 'TW', 4, 12, '2024-11-01', '2026-06-30', 8000, '否', '已終止（2026/3 通知）', '設備待重新部署'],
        ['Hansei Logistics', 'JP', 4, 40, '2025-02-01', '2027-01-31', 8600, '是', '進行中', ''],
        ['MetroParts Dist.', 'US', 3, 24, '2025-12-01', '2026-05-31', 7800, '否', '試營運', '尚未簽正式合約'],
        ['Formosa Cold Chain', 'TW', 3, 30, '2025-03-01', '2027-02-28', 8400, '是', '進行中', ''],
        ['Nordic Storage', 'US', 2, 18, '2025-11-20', '2027-11-19', 9000, '是', '進行中', ''],
        ['Kyushu Micro-FC', 'JP', 2, 16, '2025-05-01', '2026-04-30', 8200, '否', '到期未續', '2026/5 起停止計費'],
        ['BlueBox Storage', 'TW', 2, 16, '2025-06-01', '2027-05-31', 8400, '是', '進行中', ''],
        ['Taipei eGrocer', 'TW', 2, 14, '2025-08-01', '2026-07-31', 7600, '是', '進行中', ''],
        ['Osaka Parcel Hub', 'JP', 2, 20, '2025-09-01', '2027-08-31', 8800, '是', '進行中', ''],
        ['Kaohsiung Port Logistics', 'TW', 3, 28, '2025-04-01', '2027-03-31', 8300, '是', '進行中', ''],
    ]
    for r in rows: ws.append(r)
    ws.append([]); ws.append(['合計站點', '', '=SUM(C2:C13)', '=SUM(D2:D13)'])
    for cell in ws[1]: cell.font = Font(bold=True)
    for col, w in zip('ABCDEFGHIJ', [26, 8, 9, 11, 12, 12, 14, 9, 22, 60]): ws.column_dimensions[col].width = w
    wb.save(path)

if __name__ == '__main__':
    book = build()
    render(book, OUT_PDF)
    write_contract_xlsx(OUT_XLSX)
    print(f'PDF: {OUT_PDF} · {len(book.pages)} pages')
    print(f'XLSX: {OUT_XLSX}')
    for title, pg in book.toc:
        if 'Note 27' in title or 'Note 41' in title or 'Note 5.' in title or 'Note 15' in title or 'Note 12' in title:
            print(f'  {title} → p.{pg}')
