// @ts-check
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { test, expect } = require("@playwright/test");

const PAGE = "/site/index.html";

async function openPage(page) {
  await page.goto(PAGE);
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
}

function tableRows(page, name) {
  return page.locator(`[data-bind="${name}"] tbody tr`);
}

test.describe("新浪财经历史分红数据页面", () => {
  test("首屏渲染完整，脚本无运行错误", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));

    await openPage(page);

    await expect(page.locator("h1")).toHaveText("新浪财经历史分红数据获取与预处理");
    await expect(page.locator('[data-bind="overviewMetrics"] .metric')).toHaveCount(6);
    await expect(tableRows(page, "stockTable")).toHaveCount(3);
    await expect(tableRows(page, "dividendTable")).toHaveCount(8);
    await expect(page.locator('[data-bind="checkTable"] tbody tr')).toHaveCount(8);
    expect(errors).toHaveLength(0);
  });

  test("源站占位公告日期被标记，且不参与年度统计", async ({ page }) => {
    await openPage(page);

    const rangeHint = await page
      .locator('[data-bind="overviewMetrics"] .metric')
      .filter({ hasText: "分红记录" })
      .locator(".metric-hint")
      .innerText();
    expect(rangeHint).not.toContain("1900");

    await page.getByLabel("平安银行 000001").check();
    await page.getByLabel("搜索公告日期或年份").fill("1900");
    await expect(tableRows(page, "dividendTable")).toHaveCount(1);

    const row = tableRows(page, "dividendTable").first();
    await expect(row).toContainText("1900-01-01");
    await expect(row).toContainText("占位");
    await expect(row.locator("td").nth(1)).toHaveText("—");

    const ruleRow = page.locator('[data-bind="checkTable"] tbody tr').filter({ hasText: "R8" });
    await expect(ruleRow).toContainText("命中");
    await expect(ruleRow.locator("td").nth(2)).toHaveText("1");
  });

  test("指标卡数值与数据集一致", async ({ page }) => {
    await openPage(page);

    const counts = await page.evaluate(() => window.DIVIDEND_LAB_DATA.quality.counts);
    const dividendMetric = page
      .locator('[data-bind="overviewMetrics"] .metric')
      .filter({ hasText: "分红记录" })
      .locator("dd");
    const rightsMetric = page
      .locator('[data-bind="overviewMetrics"] .metric')
      .filter({ hasText: "配股记录" })
      .locator("dd");

    await expect(dividendMetric).toContainText(String(counts.dividend_records));
    await expect(rightsMetric).toContainText(String(counts.rights_records));

    const stockRows = await tableRows(page, "stockTable").allInnerTexts();
    expect(stockRows.join(" ")).toContain("贵州茅台");
    expect(stockRows.join(" ")).toContain("平安银行");
    expect(stockRows.join(" ")).toContain("工商银行");
    // 股票代码是标识而非金额，不应出现千分位
    const stockCodes = await page
      .locator('[data-bind="stockTable"] tbody tr td:first-child')
      .allInnerTexts();
    expect(stockCodes).toEqual(["600519", "000001", "601398"]);
  });

  test("切换股票后指标、明细表与配股区块联动", async ({ page }) => {
    await openPage(page);

    await expect(page.locator('[data-bind="stockMetrics"] .metric').first().locator("dd")).toContainText("31");
    await expect(page.locator('[data-bind="rightsBlock"]')).toBeHidden();

    await page.getByLabel("平安银行 000001").check();

    await expect(page.locator('[data-bind="stockMetrics"] .metric').first().locator("dd")).toContainText("38");
    await expect(page.locator('[data-bind="rightsBlock"]')).toBeVisible();
    await expect(tableRows(page, "rightsTable")).toHaveCount(3);
    // 平安银行最近一次分红公告为 2026-09-17，用于确认明细表已切换到所选股票
    await expect(page.locator('[data-bind="dividendTable"] tbody tr').first()).toContainText("2026-09-17");
  });

  test("方案筛选与关键词搜索共同生效", async ({ page }) => {
    await openPage(page);

    await page.getByLabel("含现金分红").check();
    await expect(page.locator('[data-bind="tableCount"]')).toContainText("共 30 条记录");

    await page.getByLabel("含现金分红").uncheck();
    await page.getByLabel("搜索公告日期或年份").fill("2024");
    // 贵州茅台匹配「2024」的记录：2 条在 2024 年公告，另有 1 条的推断分红年度为 2024
    await expect(tableRows(page, "dividendTable")).toHaveCount(3);

    const rows = await tableRows(page, "dividendTable").allInnerTexts();
    rows.forEach((text) => expect(text).toContain("2024"));
  });

  test("按派息金额排序后可取到全量最大值", async ({ page }) => {
    await openPage(page);

    const maxCash = await page.evaluate(() =>
      Math.max(
        ...window.DIVIDEND_LAB_DATA.dividends
          .filter((row) => row.stock_code === "600519")
          .map((row) => row.cash_per10_pretax || 0)
      )
    );

    await page.getByRole("button", { name: "派息(元/10股)" }).click();

    const firstValue = await page
      .locator('[data-bind="dividendTable"] tbody tr td:nth-child(4)')
      .first()
      .innerText();
    expect(Number(firstValue)).toBeCloseTo(maxCash, 3);

    const columnValues = await page
      .locator('[data-bind="dividendTable"] tbody tr td:nth-child(4)')
      .allInnerTexts();
    const numbers = columnValues.map((value) => Number(value));
    expect(numbers).toEqual([...numbers].sort((a, b) => b - a));
  });

  test("分页控件在边界处正确禁用", async ({ page }) => {
    await openPage(page);

    await expect(page.locator('[data-bind="pageStatus"]')).toHaveText("1 / 4");
    await expect(page.locator('[data-bind="prevPage"]')).toBeDisabled();

    await page.locator('[data-bind="nextPage"]').click();
    await expect(page.locator('[data-bind="pageStatus"]')).toHaveText("2 / 4");
    await expect(page.locator('[data-bind="prevPage"]')).toBeEnabled();

    await page.locator('[data-bind="nextPage"]').click();
    await page.locator('[data-bind="nextPage"]').click();
    await expect(page.locator('[data-bind="pageStatus"]')).toHaveText("4 / 4");
    await expect(page.locator('[data-bind="nextPage"]')).toBeDisabled();
  });

  test("年度派息图表支持键盘焦点与数值提示", async ({ page }) => {
    await openPage(page);

    const bars = page.locator('[data-bind="chart"] .chart-bar');
    expect(await bars.count()).toBeGreaterThan(20);

    await bars.last().focus();
    const tooltip = page.locator(".chart-tooltip");
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText("元/股");
    await expect(tooltip).toContainText("税前合计");
  });

  test("页面结构可键盘导航且数据源链接指向新浪财经", async ({ page }) => {
    await openPage(page);

    await page.keyboard.press("Tab");
    await expect(page.locator(".skip-link")).toBeFocused();

    const listHref = await page.locator('[data-bind="sourceListUrl"]').getAttribute("href");
    const detailHref = await page.locator('[data-bind="sourceDetailUrl"]').getAttribute("href");
    expect(listHref).toContain("vip.stock.finance.sina.com.cn");
    expect(listHref).toContain("vISSUE_ShareBonus");
    expect(detailHref).toContain("vISSUE_ShareBonusDetail.php");
  });

  test("页面在测试视口下不出现整体横向溢出", async ({ page }) => {
    await openPage(page);

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth + 1);
  });

  test("双击本地文件打开（file:// 协议）时页面同样可用", async ({ page }) => {
    const target = pathToFileURL(path.resolve(__dirname, "..", "site", "index.html")).href;

    await page.goto(target);
    await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
    await expect(tableRows(page, "dividendTable")).toHaveCount(8);
    await expect(page.locator('[data-bind="chart"] .chart-bar').first()).toBeVisible();
  });
});
