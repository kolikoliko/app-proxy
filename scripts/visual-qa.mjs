import { chromium } from "playwright-core";
import path from "node:path";

const browser = await chromium.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: true,
});

const page = await browser.newPage({ viewport: { width: 1180, height: 760 }, deviceScaleFactor: 1 });
const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
await page.goto(process.env.APP_PROXY_QA_URL ?? "http://127.0.0.1:1420", { waitUntil: "networkidle" });

const now = new Date().toISOString();
const paths = [
  ["Google Chrome", "chrome.exe", "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", true],
  ["Microsoft Edge", "msedge.exe", "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", true],
  ["Telegram Desktop", "Telegram.exe", "C:\\Users\\User\\AppData\\Roaming\\Telegram Desktop\\Telegram.exe", true],
  ["Visual Studio Code", "Code.exe", "C:\\Users\\User\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe", false],
  ["Steam", "steam.exe", "D:\\Steam\\steam.exe", false],
];

await page.evaluate(({ now, paths }) => {
  localStorage.setItem("app-proxy-state-v1", JSON.stringify({
    settings: {
      proxyUrl: "socks://127.0.0.1:7890",
      tunEnabled: true,
      theme: "light",
      launchAtLogin: true,
      startMinimized: true,
      bypassLan: true,
      additionalBypassCidrs: [],
      exitBehavior: "restore_direct",
    },
    rules: paths.map(([displayName, executableName, executablePath, enabled], index) => ({
      id: String(index + 1), displayName, executableName, executablePath, enabled,
      pinned: index < 3, createdAt: now, updatedAt: now,
    })),
  }));
}, { now, paths });

await page.reload({ waitUntil: "networkidle" });
await page.waitForFunction(() => document.documentElement.dataset.accent === "green");
await page.locator(".app-row img").first().waitFor();
const renderedMainListIcons = await page.locator(".app-row img").count();
if (renderedMainListIcons !== paths.length) {
  throw new Error(`Expected ${paths.length} native app icons, found ${renderedMainListIcons}`);
}
const lightIconBackgrounds = await page.locator(".app-row .app-glyph--native").evaluateAll((icons) =>
  icons.map((icon) => getComputedStyle(icon).backgroundColor),
);
if (lightIconBackgrounds.some((color) => color !== "rgba(0, 0, 0, 0)")) {
  throw new Error(`Expected transparent light-theme icon backgrounds, found ${lightIconBackgrounds.join(", ")}`);
}
const screenshotDir = process.env.TEMP ?? process.cwd();
const appsScreenshot = path.join(screenshotDir, "app-proxy-apps.png");
const settingsScreenshot = path.join(screenshotDir, "app-proxy-settings.png");
const pickerScreenshot = path.join(screenshotDir, "app-proxy-installed-apps.png");
await page.screenshot({ path: appsScreenshot, fullPage: true });

await page.getByRole("button", { name: "添加应用", exact: true }).click();
await page.getByRole("dialog", { name: "添加应用" }).waitFor();
await page.getByPlaceholder("搜索应用名称或路径").fill("ChatGPT");
await page.locator(".installed-app-row img").waitFor();
await page.getByText("自动包含应用组件", { exact: true }).waitFor();
await page.getByRole("button", { name: "添加", exact: true }).click();
await page.getByRole("button", { name: "已添加", exact: true }).waitFor();
await page.screenshot({ path: pickerScreenshot, fullPage: true });
await page.getByRole("button", { name: "关闭添加应用窗口" }).click();
await page.getByText("应用组 · 自动包含 8 个组件", { exact: true }).waitFor();

await page.getByRole("button", { name: "设置", exact: true }).click();
await page.getByRole("heading", { name: "设置", exact: true }).waitFor();
const tunSwitch = page.getByRole("switch", { name: "TUN 模式" });
if (!(await tunSwitch.isChecked())) throw new Error("Expected TUN mode to be enabled");
await tunSwitch.click();
if (await tunSwitch.isChecked()) throw new Error("Expected TUN mode to turn off");
await tunSwitch.click();
if (!(await tunSwitch.isChecked())) throw new Error("Expected TUN mode to turn back on");
await page.getByRole("button", { name: "紫色主题色" }).click();
await page.waitForFunction(() => document.documentElement.dataset.accent === "purple");
const lightAccent = await page.evaluate(() =>
  getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(),
);
if (lightAccent.toLocaleLowerCase() !== "#7c3aed") {
  throw new Error(`Expected purple light accent, found ${lightAccent}`);
}
await page.getByRole("button", { name: "测试连接" }).click();
await page.getByText("本地端口可连接").waitFor();
await page.screenshot({ path: settingsScreenshot, fullPage: true });
await page.locator(".pause-control select").selectOption("5");
await page.getByText("已暂停。选择“不暂停”可立即恢复。").waitFor();
await page.locator(".pause-control select").selectOption("running");
await page.getByText("已暂停。选择“不暂停”可立即恢复。").waitFor({ state: "hidden" });

await page.getByRole("button", { name: "应用代理", exact: true }).click();

await page.getByRole("switch", { name: "Google Chrome 使用代理" }).click();
await page.getByText("已选择 3 个应用使用代理").waitFor();
await page.getByRole("button", { name: "切换到深色模式" }).click();
await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
const darkAccent = await page.evaluate(() =>
  getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(),
);
if (darkAccent.toLocaleLowerCase() !== "#a78bfa") {
  throw new Error(`Expected purple dark accent, found ${darkAccent}`);
}
const darkIconBackgrounds = await page.locator(".app-row .app-glyph--native").evaluateAll((icons) =>
  icons.map((icon) => getComputedStyle(icon).backgroundColor),
);
if (darkIconBackgrounds.some((color) => color !== "rgba(0, 0, 0, 0)")) {
  throw new Error(`Expected transparent dark-theme icon backgrounds, found ${darkIconBackgrounds.join(", ")}`);
}
await page.getByRole("button", { name: "切换到浅色模式" }).click();
await page.getByText("TUN 运行中", { exact: true }).waitFor();
await page.reload({ waitUntil: "networkidle" });
await page.waitForFunction(() => document.documentElement.dataset.accent === "purple");

const metrics = await page.evaluate(() => ({
  viewportWidth: document.documentElement.clientWidth,
  viewportHeight: document.documentElement.clientHeight,
  scrollWidth: document.documentElement.scrollWidth,
  scrollHeight: document.documentElement.scrollHeight,
  theme: document.documentElement.dataset.theme,
  accent: document.documentElement.dataset.accent,
  enabledCountText: document.querySelector(".status-bar")?.textContent,
}));

await page.setViewportSize({ width: 920, height: 700 });
await page.waitForTimeout(200);
const compactMetrics = await page.evaluate(() => ({
  viewportWidth: document.documentElement.clientWidth,
  scrollWidth: document.documentElement.scrollWidth,
  workspaceScrollWidth: document.querySelector(".workspace")?.scrollWidth,
  workspaceClientWidth: document.querySelector(".workspace")?.clientWidth,
}));

console.log(JSON.stringify({ metrics, compactMetrics, renderedMainListIcons, lightAccent, darkAccent, lightIconBackgrounds, darkIconBackgrounds, consoleErrors, appsScreenshot, pickerScreenshot, settingsScreenshot }, null, 2));
await browser.close();
