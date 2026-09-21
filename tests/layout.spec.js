// @ts-check
const { test, expect } = require("@playwright/test");

const PAGE = "/site/index.html";

async function openPage(page) {
  await page.goto(PAGE);
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
  await page.evaluate(() => document.fonts.ready);
}

function channelToLinear(value) {
  const normalized = value / 255;
  return normalized <= 0.03928
    ? normalized / 12.92
    : Math.pow((normalized + 0.055) / 1.055, 2.4);
}

function luminance(rgb) {
  return (
    0.2126 * channelToLinear(rgb[0]) +
    0.7152 * channelToLinear(rgb[1]) +
    0.0722 * channelToLinear(rgb[2])
  );
}

function contrastRatio(foreground, background) {
  const light = Math.max(luminance(foreground), luminance(background));
  const dark = Math.min(luminance(foreground), luminance(background));
  return (light + 0.05) / (dark + 0.05);
}

test.describe("布局与可访问性审查", () => {
  test("正文元素不出现文字溢出或被裁切", async ({ page }) => {
    await openPage(page);

    const overflows = await page.evaluate(() => {
      const skipSelector = ".table-wrap, .chart-scroll, pre, .visually-hidden";
      const results = [];
      document
        .querySelectorAll("h1, h2, h3, h4, p, dt, dd, li, span, button, a, label, figcaption")
        .forEach((node) => {
          if (!node.textContent || !node.textContent.trim()) return;
          if (node.closest(skipSelector)) return;
          const style = getComputedStyle(node);
          if (style.display === "none" || style.visibility === "hidden") return;
          if (style.textOverflow === "ellipsis") return;
          if (node.scrollWidth > node.clientWidth + 1) {
            results.push({
              tag: node.tagName,
              className: String(node.className),
              text: node.textContent.trim().slice(0, 40),
              scrollWidth: node.scrollWidth,
              clientWidth: node.clientWidth
            });
          }
        });
      return results;
    });

    expect(overflows).toEqual([]);
  });

  test("主要交互控件互不重叠且触控高度不小于 44px", async ({ page }) => {
    await openPage(page);

    const boxes = await page.evaluate(() => {
      const selector =
        ".metric, .pipeline-step, .button, .chip span, .segmented-items span, .site-nav a, .issue-summary li";
      return Array.from(document.querySelectorAll(selector))
        .map((node) => {
          const rect = node.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, label: node.textContent.trim().slice(0, 20) };
        })
        .filter((box) => box.width > 0 && box.height > 0);
    });

    const overlaps = [];
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i];
        const b = boxes[j];
        const overlapWidth = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        const overlapHeight = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
        if (overlapWidth > 1 && overlapHeight > 1) {
          overlaps.push(`${a.label} ↔ ${b.label}`);
        }
      }
    }
    expect(overlaps).toEqual([]);

    const tooSmall = await page.evaluate(() => {
      const selector = ".button, .chip span, .segmented-items span, .site-nav a";
      return Array.from(document.querySelectorAll(selector))
        .filter((node) => node.getBoundingClientRect().height > 0)
        .filter((node) => node.getBoundingClientRect().height < 44)
        .map((node) => `${node.textContent.trim()} ${Math.round(node.getBoundingClientRect().height)}px`);
    });
    expect(tooSmall).toEqual([]);
  });

  test("正文与次要文字对比度达到 WCAG AA", async ({ page }) => {
    await openPage(page);

    const samples = await page.evaluate(() => {
      function parseColor(value) {
        const match = String(value).match(/rgba?\(([^)]+)\)/);
        if (!match) return null;
        const parts = match[1].split(",").map((part) => Number(part.trim()));
        return { rgb: [parts[0], parts[1], parts[2]], alpha: parts.length > 3 ? parts[3] : 1 };
      }

      function effectiveBackground(node) {
        let current = node;
        while (current) {
          const parsed = parseColor(getComputedStyle(current).backgroundColor);
          if (parsed && parsed.alpha > 0.9) return parsed.rgb;
          current = current.parentElement;
        }
        return [255, 255, 255];
      }

      const targets = [
        ["正文段落", document.querySelector("#overview .lead")],
        ["指标卡标签", document.querySelector(".metric dt")],
        ["指标卡数值", document.querySelector(".metric dd")],
        ["表格次要文字", document.querySelector(".cell-muted")],
        ["图表说明", document.querySelector(".chart-sub")],
        ["顶栏副标题", document.querySelector(".brand-sub")],
        ["页脚文字", document.querySelector(".footer-inner p")],
        ["状态徽章-实施", document.querySelector(".badge-ok")],
        ["状态徽章-预案", document.querySelector(".badge-pending")],
        ["次级按钮文字", document.querySelector(".button")]
      ];

      return targets
        .filter((entry) => entry[1])
        .map((entry) => {
          const node = entry[1];
          const style = getComputedStyle(node);
          return {
            name: entry[0],
            color: parseColor(style.color).rgb,
            background: effectiveBackground(node),
            fontSize: parseFloat(style.fontSize)
          };
        });
    });

    const failures = [];
    samples.forEach((sample) => {
      const ratio = contrastRatio(sample.color, sample.background);
      const threshold = sample.fontSize >= 18.66 ? 3 : 4.5;
      if (ratio < threshold) {
        failures.push(`${sample.name}：${ratio.toFixed(2)}:1（阈值 ${threshold}）`);
      }
    });

    expect(samples.length).toBeGreaterThan(8);
    expect(failures).toEqual([]);
  });

  test("导航锚点跳转后标题不被吸顶栏遮挡", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openPage(page);

    await page.locator('.site-nav a[href="#quality"]').click();
    await page.waitForTimeout(300);

    const headerHeight = await page
      .locator(".site-header")
      .evaluate((node) => node.getBoundingClientRect().height);
    const headingTop = await page
      .locator("#quality h2")
      .evaluate((node) => node.getBoundingClientRect().top);

    expect(headingTop).toBeGreaterThan(headerHeight);
  });
});
