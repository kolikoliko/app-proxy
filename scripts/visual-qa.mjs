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
  ["Google Chrome", "chrome.exe", "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"],
  ["Microsoft Edge", "msedge.exe", "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"],
  ["Telegram Desktop", "Telegram.exe", "C:\\Users\\User\\AppData\\Roaming\\Telegram Desktop\\Telegram.exe"],
  ["Visual Studio Code", "Code.exe", "C:\\Users\\User\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe"],
  ["Steam", "steam.exe", "D:\\Steam\\steam.exe"],
];

await page.evaluate(({ now, paths }) => {
  localStorage.setItem("app-proxy-state-v1", JSON.stringify({
    settings: {
      proxyUrl: "http://127.0.0.1:7890",
      theme: "light",
      launchAtLogin: true,
      startMinimized: true,
    },
    rules: paths.map(([displayName, executableName, executablePath], index) => ({
      id: String(index + 1), displayName, executableName, executablePath,
      pinned: index < 3, createdAt: now, updatedAt: now,
    })),
  }));
}, { now, paths });

await page.reload({ waitUntil: "networkidle" });
await page.waitForFunction(() => document.documentElement.dataset.accent === "blue");
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
const settingsCompactScreenshot = path.join(screenshotDir, "app-proxy-settings-compact.png");
const toolsScreenshot = path.join(screenshotDir, "app-proxy-tools.png");
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
const protocolSelect = page.getByRole("combobox", { name: "代理协议" });
const endpointInput = page.getByRole("textbox", { name: "代理主机和端口" });
const suffixInput = page.getByRole("textbox", { name: "快捷方式后缀" });
if ((await protocolSelect.inputValue()) !== "http") throw new Error("Expected HTTP to be selected by default");
if ((await endpointInput.inputValue()) !== "127.0.0.1:7890") throw new Error("Expected the default proxy endpoint");
await protocolSelect.selectOption("https");
await endpointInput.fill("127.0.0.1:8443");
await endpointInput.press("Enter");
await page.waitForFunction(() => JSON.parse(localStorage.getItem("app-proxy-state-v1")).settings.proxyUrl === "https://127.0.0.1:8443");
await protocolSelect.selectOption("socks");
await page.waitForFunction(() => JSON.parse(localStorage.getItem("app-proxy-state-v1")).settings.proxyUrl === "socks://127.0.0.1:8443");
await protocolSelect.selectOption("http");
await endpointInput.fill("127.0.0.1:7890");
await endpointInput.press("Enter");
await page.waitForFunction(() => JSON.parse(localStorage.getItem("app-proxy-state-v1")).settings.proxyUrl === "http://127.0.0.1:7890");
if ((await suffixInput.inputValue()) !== "-proxy") throw new Error("Expected -proxy as the default shortcut suffix");
await suffixInput.fill("-work");
await suffixInput.press("Enter");
await page.waitForFunction(() => JSON.parse(localStorage.getItem("app-proxy-state-v1")).settings.launcherSuffix === "-work");
await page.getByText("示例：Chrome-work.lnk", { exact: true }).waitFor();
const accentSelect = page.getByRole("combobox", { name: "主题色" });
if ((await accentSelect.inputValue()) !== "blue") throw new Error("Expected blue as the default accent color");
await accentSelect.selectOption("purple");
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
await page.reload({ waitUntil: "networkidle" });
await page.getByRole("button", { name: "设置", exact: true }).click();
if ((await page.getByRole("combobox", { name: "代理协议" }).inputValue()) !== "http") throw new Error("Expected saved HTTP protocol after reload");
if ((await page.getByRole("textbox", { name: "代理主机和端口" }).inputValue()) !== "127.0.0.1:7890") throw new Error("Expected saved endpoint after reload");
if ((await page.getByRole("textbox", { name: "快捷方式后缀" }).inputValue()) !== "-work") throw new Error("Expected saved shortcut suffix after reload");
if ((await page.getByRole("combobox", { name: "主题色" }).inputValue()) !== "purple") throw new Error("Expected saved purple accent after reload");
await page.setViewportSize({ width: 920, height: 700 });
const suffixLayout = await page.locator(".setting-row--field").evaluate((row) => {
  const description = row.querySelector(":scope > span")?.getBoundingClientRect();
  const input = row.querySelector("input")?.getBoundingClientRect();
  return {
    descriptionRight: description?.right,
    inputLeft: input?.left,
    rowWidth: row.getBoundingClientRect().width,
  };
});
if (!suffixLayout.descriptionRight || !suffixLayout.inputLeft || suffixLayout.inputLeft < suffixLayout.descriptionRight) {
  throw new Error(`Shortcut suffix field overlaps its description: ${JSON.stringify(suffixLayout)}`);
}
const accentLayout = await page.locator(".setting-row--accent").evaluate((row) => {
  const description = row.querySelector(":scope > span")?.getBoundingClientRect();
  const select = row.querySelector("select")?.getBoundingClientRect();
  return { descriptionRight: description?.right, selectLeft: select?.left };
});
if (!accentLayout.descriptionRight || !accentLayout.selectLeft || accentLayout.selectLeft < accentLayout.descriptionRight) {
  throw new Error(`Accent selector overlaps its description: ${JSON.stringify(accentLayout)}`);
}
await page.screenshot({ path: settingsCompactScreenshot, fullPage: true });
await page.setViewportSize({ width: 1180, height: 760 });

await page.getByRole("button", { name: "工具代理", exact: true }).click();
await page.getByRole("heading", { name: "工具代理", exact: true }).waitFor();
await page.locator(".tool-identity__icon img").waitFor();
const gitIconLoaded = await page.locator(".tool-identity__icon img").evaluate((icon) =>
  icon instanceof HTMLImageElement && icon.complete && icon.naturalWidth > 0,
);
if (!gitIconLoaded) throw new Error("Expected the custom Git icon to load");
await page.getByText("未配置", { exact: true }).first().waitFor();
await page.getByRole("button", { name: "应用当前代理", exact: true }).click();
await page.getByText("已将应用代理写入 Git 全局配置", { exact: true }).waitFor();
await page.getByText("已同步", { exact: true }).waitFor();
await page.screenshot({ path: toolsScreenshot, fullPage: true });
await page.getByRole("button", { name: "清除代理", exact: true }).click();
await page.getByText("已清除 Git 全局代理配置", { exact: true }).waitFor();

await page.getByRole("button", { name: "应用代理", exact: true }).click();
await page.getByRole("button", { name: "使用环境代理启动 Google Chrome" }).click();
await page.getByText("已发送 Google Chrome 的环境代理启动请求（浏览器预览）").waitFor();
await page.getByRole("button", { name: "为 Google Chrome 创建桌面代理启动器" }).click();
await page.getByText("已创建“Google Chrome-work”桌面启动器；关闭应用代理后仍可使用").waitFor();
await page.getByText("已添加 6 个应用").waitFor();
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
await page.getByText("按需代理", { exact: true }).waitFor();
await page.reload({ waitUntil: "networkidle" });
await page.waitForFunction(() => document.documentElement.dataset.accent === "purple");

const metrics = await page.evaluate(() => ({
  viewportWidth: document.documentElement.clientWidth,
  viewportHeight: document.documentElement.clientHeight,
  scrollWidth: document.documentElement.scrollWidth,
  scrollHeight: document.documentElement.scrollHeight,
  theme: document.documentElement.dataset.theme,
  accent: document.documentElement.dataset.accent,
  appCountText: document.querySelector(".status-bar")?.textContent,
}));

await page.setViewportSize({ width: 920, height: 700 });
await page.waitForTimeout(200);
const compactMetrics = await page.evaluate(() => ({
  viewportWidth: document.documentElement.clientWidth,
  scrollWidth: document.documentElement.scrollWidth,
  workspaceScrollWidth: document.querySelector(".workspace")?.scrollWidth,
  workspaceClientWidth: document.querySelector(".workspace")?.clientWidth,
}));

console.log(JSON.stringify({ metrics, compactMetrics, suffixLayout, accentLayout, gitIconLoaded, renderedMainListIcons, lightAccent, darkAccent, lightIconBackgrounds, darkIconBackgrounds, consoleErrors, appsScreenshot, pickerScreenshot, settingsScreenshot, settingsCompactScreenshot, toolsScreenshot }, null, 2));
await browser.close();
