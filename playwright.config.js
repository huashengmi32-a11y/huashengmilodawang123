// @ts-check
const { defineConfig, devices } = require("@playwright/test");

const PORT = 4173;
const BASE_URL = `http://127.0.0.1:${PORT}`;

// 浏览器通道：Windows 默认复用系统自带的 Microsoft Edge（同为 Chromium 内核），
// 无需额外下载浏览器；如需使用 Playwright 自带 Chromium，先执行
// `npx playwright install chromium`，再设置环境变量 PW_CHANNEL=bundled。
const CHANNEL = process.env.PW_CHANNEL || (process.platform === "win32" ? "msedge" : "bundled");

/** @param {Record<string, unknown>} use */
function withChannel(use) {
  return CHANNEL === "bundled" ? use : { ...use, channel: CHANNEL };
}

module.exports = defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { outputFolder: "tests/report", open: "never" }],
    ["json", { outputFile: "tests/report/results.json" }]
  ],
  use: {
    baseURL: BASE_URL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure"
  },
  projects: [
    {
      name: "desktop-chromium",
      use: withChannel({ ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } })
    },
    {
      name: "mobile-chromium",
      use: withChannel({ ...devices["Pixel 7"] })
    }
  ],
  webServer: {
    // 以项目根目录为站点根，便于页面同时访问 site/ 与 data/ 下的文件
    command: `python -m http.server ${PORT} --bind 127.0.0.1`,
    url: `${BASE_URL}/site/index.html`,
    reuseExistingServer: true,
    stdout: "ignore"
  }
});
