// @ts-check
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("@playwright/test");

const PAGE = "/site/index.html";
const OUTPUT_DIR = path.resolve(__dirname, "..", "docs", "screenshots");

test.describe("交付截图", () => {
  test("按视口生成页面截图", async ({ page }, testInfo) => {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const prefix = testInfo.project.name;

    await page.goto(PAGE);
    await page.waitForSelector('body[data-ready="true"]');
    await page.evaluate(() => document.fonts.ready);

    await page.screenshot({ path: path.join(OUTPUT_DIR, `${prefix}-overview.png`) });
    await page.locator("#dataset").scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    await page.locator("#dataset").screenshot({ path: path.join(OUTPUT_DIR, `${prefix}-dataset.png`) });
    await page.locator("#quality").screenshot({ path: path.join(OUTPUT_DIR, `${prefix}-quality.png`) });
    await page.screenshot({ path: path.join(OUTPUT_DIR, `${prefix}-full.png`), fullPage: true });
  });
});
