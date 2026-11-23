import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..");
const DIST_DIR = path.join(PROJECT_ROOT, "dist");
const OUTPUT_DIR = path.join(PROJECT_ROOT, "docs", "images");
const CHROME_PATH =
  process.env.CHROME_PATH ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
};

function startStaticServer(rootDir) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const reqPath = (req.url ?? "/").split("?")[0];
      const safePath = path.normalize(reqPath === "/" ? "/index.html" : reqPath);
      const filePath = path.join(rootDir, safePath);
      if (!filePath.startsWith(rootDir) || !fs.existsSync(filePath)) {
        res.writeHead(404);
        res.end("Not Found");
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { "Content-Type": MIME_TYPES[ext] ?? "application/octet-stream" });
      fs.createReadStream(filePath).pipe(res);
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

function svgDataUrl(svg) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

// 简洁的纯矢量示例应用图标（仅用于展示截图的真实视觉效果）
const DEMO_APP_ICONS = {
  ChatGPT: svgDataUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="10" fill="#10A37F"/><g fill="none" stroke="#fff" stroke-width="2.1" stroke-linejoin="round"><circle cx="20" cy="20" r="8.5"/><path d="M20 11.5v17M12.6 15.8l14.8 8.4M27.4 15.8l-14.8 8.4"/></g></svg>`,
  ),
  "Google Chrome": svgDataUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="15" fill="#EA4335"/><path d="M20 20L33 12.5A15 15 0 0 1 20 35Z" fill="#FBBC05"/><path d="M20 20L20 35A15 15 0 0 1 7 12.5Z" fill="#34A853"/><circle cx="20" cy="20" r="6.8" fill="#fff"/><circle cx="20" cy="20" r="5" fill="#4285F4"/></svg>`,
  ),
  "Visual Studio Code": svgDataUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="10" fill="#007ACC"/><path d="M28.5 10.5l-13.2 12-5.3-4-2 1.6 4.7 4.4-4.7 4.4 2 1.6 5.3-4 13.2 12 4-1.9V12.4l-4-1.9zm0 6.5v11l-6.8-5.5 6.8-5.5z" fill="#fff"/></svg>`,
  ),
  "Telegram Desktop": svgDataUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="16" fill="#29A9EB"/><path d="M28.2 13.2l-3.1 14.8c-.2 1-.8 1.2-1.7.8l-4.6-3.4-2.2 2.1c-.2.2-.5.5-1 .5l.3-4.7 8.6-7.8c.4-.3-.1-.5-.6-.2l-10.6 6.7-4.6-1.4c-1-.3-1-1 .2-1.5l17.9-6.9c.8-.3 1.6.2 1.2 1z" fill="#fff"/></svg>`,
  ),
  Discord: svgDataUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="10" fill="#5865F2"/><path d="M27.3 13.8a15 15 0 0 0-3.8-1.2l-.5 1a14 14 0 0 0-6 0l-.5-1a15 15 0 0 0-3.8 1.2C10.3 17.4 9.7 21 10 24.5a15.3 15.3 0 0 0 4.6 2.3l1-1.6a10 10 0 0 1-1.6-.8l.4-.3a11 11 0 0 0 11.2 0l.4.3a10 10 0 0 1-1.6.8l1 1.6a15.3 15.3 0 0 0 4.6-2.3c.4-4-.6-7.6-2.7-10.7zM16.7 22.4c-.9 0-1.6-.8-1.6-1.8s.7-1.8 1.6-1.8 1.6.8 1.6 1.8-.7 1.8-1.6 1.8zm6.6 0c-.9 0-1.6-.8-1.6-1.8s.7-1.8 1.6-1.8 1.6.8 1.6 1.8-.7 1.8-1.6 1.8z" fill="#fff"/></svg>`,
  ),
};

const DEMO_RULES = [
  {
    id: "chatgpt",
    displayName: "ChatGPT",
    executablePath: "C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.901.1978.0_x64__2p2nqsd0c76g0\\app\\ChatGPT.exe",
    executableName: "ChatGPT.exe",
    packageFamilyName: "OpenAI.Codex_2p2nqsd0c76g0",
    applicationId: "App",
    executableScopeRoot: "C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.901.1978.0_x64__2p2nqsd0c76g0",
    scopeExecutableCount: 12,
    pinned: true,
  },
  {
    id: "chrome",
    displayName: "Google Chrome",
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    executableName: "chrome.exe",
    pinned: true,
  },
  {
    id: "vscode",
    displayName: "Visual Studio Code",
    executablePath: "C:\\Users\\User\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe",
    executableName: "Code.exe",
    pinned: true,
  },
];

async function captureAppViews(browser, baseUrl, theme) {
  const page = await browser.newPage({
    viewport: { width: 1120, height: 740 },
    deviceScaleFactor: 2,
  });

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  const now = new Date().toISOString();
  await page.evaluate(
    ({ theme, rules, now }) => {
      localStorage.setItem(
        "app-proxy-state-v1",
        JSON.stringify({
          settings: {
            proxyUrl: "http://127.0.0.1:7890",
            launcherSuffix: "-proxy",
            theme,
            accentColor: "blue",
            launchAtLogin: true,
            startMinimized: true,
          },
          rules: rules.map((r) => ({ ...r, createdAt: now, updatedAt: now })),
        }),
      );
      localStorage.setItem("app-proxy-browser-git-proxy", "http://127.0.0.1:7890");
    },
    { theme, rules: DEMO_RULES, now },
  );

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction((expected) => document.documentElement.dataset.theme === expected, theme);
  await page.locator(".app-row img").first().waitFor();
  await page.waitForTimeout(250);

  // 替换为高辨识度的示例应用图标
  await page.evaluate((icons) => {
    document.querySelectorAll(".app-row").forEach((row) => {
      const name = row.querySelector("strong")?.textContent?.trim();
      const img = row.querySelector(".app-glyph--native img");
      if (name && img && icons[name]) {
        img.src = icons[name];
      }
    });
  }, DEMO_APP_ICONS);
  await page.waitForTimeout(150);

  const mainBuffer = await page.screenshot({ type: "png" });

  // 切换到工具代理页，截取 Git 卡片用于右下角景深叠放
  await page.getByRole("button", { name: "工具代理", exact: true }).click();
  await page.getByText("已同步", { exact: true }).waitFor();
  await page.waitForTimeout(350);
  const toolCardBuffer = await page.locator(".tool-card").screenshot({ type: "png" });

  await page.close();
  return { mainBuffer, toolCardBuffer };
}

async function encodeWebp(page, pngBuffer, quality = 0.9) {
  const pngDataUrl = `data:image/png;base64,${pngBuffer.toString("base64")}`;
  const webpDataUrl = await page.evaluate(
    async ({ src, quality }) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      return canvas.toDataURL("image/webp", quality);
    },
    { src: pngDataUrl, quality },
  );
  const base64 = webpDataUrl.replace(/^data:image\/webp;base64,/, "");
  return Buffer.from(base64, "base64");
}

async function composeHero(browser, { theme, mainBuffer, toolCardBuffer, appIconSvg, outputPath }) {
  const isDark = theme === "dark";
  const mainDataUrl = `data:image/png;base64,${mainBuffer.toString("base64")}`;
  const cardDataUrl = `data:image/png;base64,${toolCardBuffer.toString("base64")}`;

  const page = await browser.newPage({
    viewport: { width: 1440, height: 910 },
    deviceScaleFactor: 1.5,
  });

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: 1440px;
    height: 910px;
    background: transparent;
    overflow: hidden;
    font-family: "Segoe UI Variable Text", "Microsoft YaHei UI", system-ui, sans-serif;
  }
  .stage {
    position: relative;
    width: 1440px;
    height: 910px;
    padding: 28px 34px 44px;
  }
  .desktop-frame {
    position: relative;
    width: 1216px;
    border-radius: 28px;
    overflow: hidden;
    background: ${
      isDark
        ? "radial-gradient(ellipse at 18% 12%, #1e3a8a 0%, transparent 52%), radial-gradient(ellipse at 88% 18%, #0e7490 0%, transparent 48%), radial-gradient(ellipse at 52% 96%, #312e81 0%, transparent 56%), linear-gradient(145deg, #0b1224 0%, #111c33 55%, #091020 100%)"
        : "radial-gradient(ellipse at 14% 12%, #93c5fd 0%, transparent 52%), radial-gradient(ellipse at 88% 16%, #a5f3fc 0%, transparent 50%), radial-gradient(ellipse at 55% 98%, #c7d2fe 0%, transparent 55%), linear-gradient(145deg, #dbeafe 0%, #eff6ff 55%, #e0e7ff 100%)"
    };
    border: 1.5px solid ${isDark ? "rgba(186, 230, 253, 0.22)" : "rgba(255, 255, 255, 0.92)"};
    box-shadow: ${
      isDark
        ? "0 28px 66px rgba(2, 6, 23, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.14)"
        : "0 26px 60px rgba(30, 58, 138, 0.16), inset 0 1px 0 rgba(255, 255, 255, 0.92)"
    };
    padding: 34px 38px 34px;
  }
  .window {
    width: 100%;
    border-radius: 16px;
    overflow: hidden;
    border: 1px solid ${isDark ? "rgba(186, 230, 253, 0.18)" : "rgba(255, 255, 255, 0.95)"};
    box-shadow: ${
      isDark
        ? "0 24px 60px rgba(0, 5, 18, 0.58)"
        : "0 22px 54px rgba(23, 47, 94, 0.18)"
    };
    background: ${isDark ? "#111a29" : "#eaf0f7"};
  }
  .titlebar {
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 12px 0 14px;
    background: ${isDark ? "#141f31" : "#f4f7fc"};
    border-bottom: 1px solid ${isDark ? "rgba(155, 183, 218, 0.14)" : "rgba(110, 135, 168, 0.16)"};
  }
  .titlebar__left {
    display: flex;
    align-items: center;
    gap: 8px;
    color: ${isDark ? "#dbe7f7" : "#253248"};
    font-size: 12px;
    font-weight: 600;
  }
  .titlebar__icon {
    width: 18px;
    height: 18px;
    display: block;
  }
  .titlebar__controls {
    display: flex;
    align-items: center;
    gap: 16px;
    color: ${isDark ? "#94a3b8" : "#64748b"};
    font-size: 12px;
    padding-right: 4px;
  }
  .window__body {
    display: block;
    width: 100%;
    height: auto;
  }
  .floating-card {
    position: absolute;
    right: 32px;
    bottom: 34px;
    width: 470px;
    border-radius: 20px;
    overflow: hidden;
    border: 1.5px solid ${isDark ? "rgba(186, 230, 253, 0.24)" : "rgba(219, 234, 254, 0.95)"};
    background: ${isDark ? "#182438" : "#ffffff"};
    box-shadow: ${
      isDark
        ? "0 26px 64px rgba(0, 6, 20, 0.72), 0 0 0 1px rgba(56, 189, 248, 0.14)"
        : "0 26px 56px rgba(23, 52, 108, 0.22), 0 0 0 1px rgba(37, 99, 235, 0.08)"
    };
  }
  .floating-card__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 16px;
    font-size: 11px;
    font-weight: 650;
    letter-spacing: 0.04em;
    color: ${isDark ? "#93c5fd" : "#1d4ed8"};
    background: ${isDark ? "#1c2d4a" : "#f0f6ff"};
    border-bottom: 1px solid ${isDark ? "rgba(155, 183, 218, 0.14)" : "rgba(110, 135, 168, 0.16)"};
  }
  .floating-card__pill {
    font-size: 10px;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 999px;
    color: ${isDark ? "#75d2b2" : "#15803d"};
    background: ${isDark ? "rgba(117, 210, 178, 0.14)" : "rgba(21, 128, 61, 0.1)"};
  }
  .floating-card img {
    display: block;
    width: 100%;
    height: auto;
  }
</style>
</head>
<body>
  <div class="stage">
    <div class="desktop-frame">
      <div class="window">
        <div class="titlebar">
          <div class="titlebar__left">
            <span class="titlebar__icon">${appIconSvg}</span>
            <span>应用代理</span>
          </div>
          <div class="titlebar__controls">
            <span>&#x2013;</span>
            <span>&#x25A1;</span>
            <span>&#x2715;</span>
          </div>
        </div>
        <img class="window__body" src="${mainDataUrl}" alt="App Proxy" />
      </div>
    </div>

    <div class="floating-card">
      <div class="floating-card__head">
        <span>DEVELOPER TOOLING · 工具代理</span>
        <span class="floating-card__pill">一键同步</span>
      </div>
      <img src="${cardDataUrl}" alt="Git Tool Proxy" />
    </div>
  </div>
</body>
</html>`;

  await page.setContent(html, { waitUntil: "networkidle" });
  await page.waitForTimeout(120);
  const pngBuffer = await page.screenshot({ omitBackground: true });
  const webpBuffer = await encodeWebp(page, pngBuffer, 0.9);
  fs.writeFileSync(outputPath, webpBuffer);
  await page.close();
}

async function main() {
  if (!fs.existsSync(path.join(DIST_DIR, "index.html"))) {
    throw new Error("dist/index.html 不存在，请先运行 npm run build");
  }
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const appIconSvg = fs
    .readFileSync(path.join(PROJECT_ROOT, "public", "app-icon.svg"), "utf8")
    .replace("<svg ", '<svg style="width:100%;height:100%;display:block" ');

  const { server, url } = await startStaticServer(DIST_DIR);
  const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });

  try {
    for (const theme of ["light", "dark"]) {
      const { mainBuffer, toolCardBuffer } = await captureAppViews(browser, url, theme);
      await composeHero(browser, {
        theme,
        mainBuffer,
        toolCardBuffer,
        appIconSvg,
        outputPath: path.join(OUTPUT_DIR, `hero-${theme}.webp`),
      });
    }
    console.log("Generated docs/images/hero-light.webp and docs/images/hero-dark.webp");
  } finally {
    await browser.close();
    server.close();
  }
}

await main();
