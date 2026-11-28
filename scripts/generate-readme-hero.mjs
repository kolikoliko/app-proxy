import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
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

// 兜底矢量图标（仅当本机未安装对应应用时使用；Windows 本机优先提取真实应用图标）
const FALLBACK_APP_ICONS = {
  "Google Chrome": svgDataUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="15" fill="#EA4335"/><path d="M20 20L33 12.5A15 15 0 0 1 20 35Z" fill="#FBBC05"/><path d="M20 20L20 35A15 15 0 0 1 7 12.5Z" fill="#34A853"/><circle cx="20" cy="20" r="6.8" fill="#fff"/><circle cx="20" cy="20" r="5" fill="#4285F4"/></svg>`,
  ),
  Antigravity: svgDataUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><defs><linearGradient id="ag" x1="8" y1="30" x2="32" y2="10" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#34A853"/><stop offset="35%" stop-color="#4285F4"/><stop offset="70%" stop-color="#EA4335"/><stop offset="100%" stop-color="#FBBC05"/></linearGradient></defs><path d="M11 30C15 16 17.6 9.5 20 9.5S25 16 29 30c-3.8-4.8-6.6-6.8-9-6.8s-5.2 2-9 6.8Z" fill="url(#ag)"/></svg>`,
  ),
  ChatGPT: svgDataUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><g fill="none" stroke="#111318" stroke-width="2.2" stroke-linejoin="round"><circle cx="20" cy="20" r="9.5"/><path d="M20 10.5v19M11.8 15.2l16.4 9.6M28.2 15.2l-16.4 9.6"/></g></svg>`,
  ),
};

function loadNativeAppIcons() {
  if (process.platform !== "win32") return FALLBACK_APP_ICONS;
  try {
    const script = `
Add-Type -AssemblyName System.Drawing
$pkg = Get-AppxPackage -ErrorAction SilentlyContinue | Where-Object { $_.PackageFamilyName -eq 'OpenAI.Codex_2p2nqsd0c76g0' } | Select-Object -First 1
$targets = @{
  'Google Chrome' = @(
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  'Antigravity' = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\\antigravity\\Antigravity.exe'),
    'C:\\Program Files\\Antigravity\\Antigravity.exe'
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
  'ChatGPT' = if ($pkg -and $pkg.InstallLocation) { Join-Path $pkg.InstallLocation 'app\\ChatGPT.exe' } else { $null }
}
$result = @{}
foreach ($name in $targets.Keys) {
  $p = $targets[$name]
  if (-not $p -or -not (Test-Path -LiteralPath $p)) { continue }
  $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($p)
  if (-not $icon) { continue }
  $bmp = $icon.ToBitmap()
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $result[$name] = 'data:image/png;base64,' + [Convert]::ToBase64String($ms.ToArray())
  $ms.Dispose()
  $bmp.Dispose()
  $icon.Dispose()
}
$result | ConvertTo-Json -Compress
`;
    const stdout = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      { encoding: "utf8" },
    ).trim();
    const extracted = stdout ? JSON.parse(stdout) : {};
    return { ...FALLBACK_APP_ICONS, ...extracted };
  } catch {
    return FALLBACK_APP_ICONS;
  }
}

const DEMO_APP_ICONS = loadNativeAppIcons();

const DEMO_RULES = [
  {
    id: "chrome",
    displayName: "Google Chrome",
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    executableName: "chrome.exe",
    pinned: true,
  },
  {
    id: "antigravity",
    displayName: "Antigravity",
    executablePath: "C:\\Users\\User\\AppData\\Local\\Programs\\antigravity\\Antigravity.exe",
    executableName: "Antigravity.exe",
    pinned: true,
  },
  {
    id: "chatgpt",
    displayName: "ChatGPT",
    executablePath: "C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.1120.6357.0_x64__2p2nqsd0c76g0\\app\\ChatGPT.exe",
    executableName: "ChatGPT.exe",
    packageFamilyName: "OpenAI.Codex_2p2nqsd0c76g0",
    applicationId: "App",
    executableScopeRoot: "C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.1120.6357.0_x64__2p2nqsd0c76g0",
    scopeExecutableCount: 21,
    pinned: true,
  },
];

async function captureAppViews(browser, baseUrl, theme) {
  const page = await browser.newPage({
    viewport: { width: 920, height: 620 },
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

  // 替换为高辨识度的示例应用图标，并模拟桌面端无边框顶栏的留白高度
  await page.evaluate((icons) => {
    const content = document.querySelector(".workspace-content");
    if (content) content.style.paddingTop = "38px";
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
  await page.getByText("已同步", { exact: true }).first().waitFor();
  await page.waitForTimeout(300);
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
    viewport: { width: 1280, height: 820 },
    deviceScaleFactor: 1.5,
  });

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: 1280px;
    height: 820px;
    background: transparent;
    overflow: hidden;
    font-family: "Segoe UI Variable Text", "Microsoft YaHei UI", system-ui, sans-serif;
  }
  .stage {
    position: relative;
    width: 1280px;
    height: 820px;
    padding: 26px 34px 40px;
  }
  .desktop-frame {
    position: relative;
    width: 1060px;
    border-radius: 22px;
    overflow: hidden;
    background: ${
      isDark
        ? "linear-gradient(155deg, #0c0d10 0%, #151820 55%, #0e1015 100%)"
        : "linear-gradient(155deg, #eef0f4 0%, #e4e8f0 55%, #edf0f5 100%)"
    };
    border: 1px solid ${isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(15, 23, 42, 0.08)"};
    box-shadow: ${
      isDark
        ? "0 28px 66px rgba(0, 0, 0, 0.65)"
        : "0 24px 56px rgba(15, 23, 42, 0.12)"
    };
    padding: 36px 40px 36px;
  }
  .window {
    position: relative;
    width: 100%;
    border-radius: 12px;
    overflow: hidden;
    border: 1px solid ${isDark ? "rgba(255, 255, 255, 0.12)" : "rgba(15, 23, 42, 0.1)"};
    box-shadow: ${
      isDark
        ? "0 24px 60px rgba(0, 0, 0, 0.62)"
        : "0 20px 50px rgba(15, 23, 42, 0.14)"
    };
    background: ${isDark ? "#141518" : "#ffffff"};
  }
  .window__controls {
    position: absolute;
    top: 0;
    right: 0;
    height: 32px;
    display: flex;
    align-items: center;
    color: ${isDark ? "#949ba8" : "#5c6270"};
    font-size: 11px;
  }
  .window__controls span {
    width: 38px;
    height: 32px;
    display: grid;
    place-items: center;
  }
  .window__body {
    display: block;
    width: 100%;
    height: auto;
  }
  .floating-card {
    position: absolute;
    right: 30px;
    bottom: 30px;
    width: 448px;
    border-radius: 14px;
    overflow: hidden;
    border: 1px solid ${isDark ? "rgba(255, 255, 255, 0.14)" : "#d3d7e0"};
    background: ${isDark ? "#191b1f" : "#ffffff"};
    box-shadow: ${
      isDark
        ? "0 26px 64px rgba(0, 0, 0, 0.72)"
        : "0 22px 52px rgba(15, 23, 42, 0.18)"
    };
  }
  .floating-card__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 9px 14px;
    font-size: 11px;
    font-weight: 600;
    color: ${isDark ? "#949ba8" : "#5c6270"};
    background: ${isDark ? "#14161a" : "#f6f7f9"};
    border-bottom: 1px solid ${isDark ? "rgba(255, 255, 255, 0.08)" : "#e6e8ee"};
  }
  .floating-card__pill {
    font-size: 10px;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 999px;
    color: ${isDark ? "#4ade80" : "#15803d"};
    background: ${isDark ? "rgba(74, 222, 128, 0.12)" : "#eefbf3"};
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
        <div class="window__controls">
          <span>&#x2013;</span>
          <span>&#x25A1;</span>
          <span>&#x2715;</span>
        </div>
        <img class="window__body" src="${mainDataUrl}" alt="App Proxy" />
      </div>
    </div>

    <div class="floating-card">
      <div class="floating-card__head">
        <span>工具代理 · Git</span>
        <span class="floating-card__pill">已同步</span>
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
