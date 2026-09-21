# 新浪财经历史分红数据获取与预处理

以新浪财经个股「分红送转」页面为数据源，完成 **抓取 → 解析 → 清洗 → 校验 → 导出** 的完整数据管线，
并把实现过程、数据结果与质量报告做成一个可直接打开的网页。

* 仓库地址：<https://github.com/huashengmi32-a11y/huashengmilodawang123>
* 交付文档：[需求确认单](docs/01-需求确认单.md) · [Agent 对话记录（脱敏）](docs/02-Agent对话记录.md) · [测试报告](docs/03-测试报告.md)
* 网页截图：[docs/screenshots](docs/screenshots)（桌面与移动共 8 张）

## 一、项目概览

| 项目 | 说明 |
| --- | --- |
| 数据源 | 新浪财经 `vISSUE_ShareBonus`（分红送转列表）与 `vISSUE_ShareBonusDetail`（分红明细） |
| 目标股票 | 600519 贵州茅台、000001 平安银行、601398 工商银行 |
| 抓取规模 | 3 个列表页 + 96 个明细页 = 99 个页面 |
| 数据规模 | 分红记录 92 条、配股记录 4 条、输出字段 23 个（含 8 个派生字段） |
| 质量校验 | 7 条规则，命中 8 条问题记录，全部逐条留痕 |
| 展示页面 | `site/index.html`，纯静态、可离线打开 |
| 网页测试 | Playwright 15 个用例 × 2 种视口，共 30 条全部通过 |

## 二、目录结构

```
sina-dividend-lab/
├── scripts/                  # 数据管线（Python）
│   ├── config.py             # 数据源、目标股票、字段字典、抓取参数
│   ├── fetch_sina.py         # 第 1 步：抓取原始页面（限速、重试、缓存、抓取清单）
│   ├── preprocess.py         # 第 2 步：解析、清洗、校验并导出数据集与质量报告
│   └── build_site.py         # 第 3 步：打包网页数据集
├── data/                     # 数据产物
│   ├── dividends.csv/.json   # 分红明细
│   ├── rights.csv/.json      # 配股明细
│   ├── stocks.csv/.json      # 股票维度汇总
│   ├── issues.csv/.json      # 数据质量问题日志
│   ├── quality_report.json   # 字段覆盖率、规则执行结果、口径说明
│   └── raw/                  # 原始 HTML 缓存（不入版本库，可重新抓取）
├── site/                     # 展示页面
│   ├── index.html
│   └── assets/{style.css,app.js,data.js}
├── tests/                    # Playwright 端到端测试与截图用例
├── docs/                     # 需求确认单、测试报告、Agent 对话记录、截图
├── design-system/            # ui-ux-pro-max 生成的设计系统
├── requirements.txt
└── package.json / playwright.config.js
```

## 三、快速开始

```bash
pip install -r requirements.txt

python scripts/fetch_sina.py      # 抓取原始页面，写入 data/raw/
python scripts/preprocess.py      # 解析清洗，生成 data/ 下的数据集
python scripts/build_site.py      # 生成 site/assets/data.js
```

查看结果：直接用浏览器打开 `site/index.html`（无需服务器）。

运行网页测试与生成截图：

```bash
npm install
npx playwright test
```

（Playwright 会自动以项目根目录为站点根启动本地静态服务器。）

测试默认在 Windows 上复用系统自带的 Microsoft Edge（Chromium 内核），无需额外下载浏览器；
如需使用 Playwright 自带 Chromium，先执行 `npx playwright install chromium`，再设置环境变量
`PW_CHANNEL=bundled`。

## 四、处理流程与设计取舍

1. **抓取**：复用 `requests.Session` 依次拉取列表页与明细页；请求间隔 0.6 秒，失败按 `0.6s × 次数`
   退避重试 3 次，原始 HTML 落地到 `data/raw/`。命中缓存则不再请求，重复运行不会给对方站点增加压力。
2. **解析**：用表头列位而非固定下标取值 —— 分红表 `sharebonus_1`（9 列）、配股表 `sharebonus_2`（11 列）、
   明细页 `sharebonusdetail`（29 行键值对），并用日期正则过滤表头行。
3. **清洗**：`--`、`暂无` 等 16 种占位符统一为缺失值；日期归一为 ISO 格式；数值去掉千分位与单位；
   派生 `record_id`、`dividend_year`、`allocation_type`、`implement_year`、`cash_per_share_pretax`
   与三个布尔标记。
4. **校验**：七条规则逐条检查（见下），命中项写入 `data/issues.csv`，不做静默丢弃。
5. **导出**：CSV 用中文表头与 UTF-8 BOM，便于 Excel 直接打开；JSON 保留英文字段名供程序消费。

### 数据质量规则

| 规则 | 内容 | 结果 |
| --- | --- | --- |
| R1 | 关键字段完整性（股票代码、公告日期） | 通过 |
| R2 | 方案内容有效性（送股/转增/派息至少一项大于 0） | 命中 8 条，「不分配」记录按提示级别保留 |
| R3 | 除权除息日不早于公告日 | 通过 |
| R4 | 股权登记日不晚于除权除息日 | 通过 |
| R5 | 数值非负 | 通过 |
| R6 | 明细页与列表页税前红利交叉校验（容差 0.01 元） | 通过 |
| R7 | 主键唯一（同一股票同一公告日期） | 通过，无重复 |

### 需要说明的口径

* 「分红年度」「分配类型」是**推断字段**：公告月份 ≤ 8 归入上一年度分配，≥ 9 归入本期中期/特别分配，
  仅用于分组统计，不代表公司官方口径。
* 「派息(税前)(元/10股)」与明细页「税前红利」均为每 10 股口径，「每股派息税前」按 ÷10 折算。
* 数据源未提供总股本与除权日股价，因此本数据集不含现金分红总额与股息率。

## 五、网页说明

`site/index.html` 为单页静态站点，四块内容：项目概览与关键指标、五步处理链路、可筛选排序的分红明细与
年度派息图表、数据质量报告与交付文件清单。

界面依据 `ui-ux-pro-max` 生成的设计系统实现（Swiss 极简风格、Fira Sans / Fira Code、蓝 + 琥珀配色、
8px 圆角、密度 8/10），设计令牌与适配说明见 `design-system/sina-dividend-lab/`。

## 六、免责声明

数据来自新浪财经公开页面，仅用于课程作业与学习演示，版权归原站所有；抓取行为已做限速与缓存处理，
请勿用于商业用途或高频抓取。
