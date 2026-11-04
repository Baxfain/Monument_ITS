#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evidenceDirectory = join(projectRoot, "docs", "planning", "evidence", "emblem-contour");
const prefix = process.env.GRAKOMS_CONTOUR_PREFIX ?? "after";
const baseUrl = process.env.GRAKOMS_URL ?? "http://127.0.0.1:8000";
const playwrightModule = process.env.PLAYWRIGHT_MODULE
  ?? "/home/lenovo/.npm/_npx/6bcb61ec6d5aea22/node_modules/playwright/index.mjs";
const chromiumPath = process.env.CHROMIUM_PATH
  ?? "/home/lenovo/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome";

mkdirSync(evidenceDirectory, { recursive: true });
const { chromium } = await import(pathToFileURL(playwrightModule).href);
const browser = await chromium.launch({
  executablePath: chromiumPath,
  headless: true,
  args: ["--enable-webgl", "--use-gl=angle", "--use-angle=swiftshader", "--disable-dev-shm-usage"],
});

try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 }, deviceScaleFactor: 2 });
  page.on("pageerror", (error) => { throw error; });
  await page.goto(baseUrl + "/?test=1&contour-capture=1", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => {
    const test = window.__grakomsTest;
    return test?.renderer?.texturePromise
      && document.querySelector("#viewer-status")?.textContent.includes("WebGL2 ready");
  }, null, { timeout: 30000 });

  const views = [
    { name: "front", position: [0, 1.58, 1.5], eyeY: 2.285, yaw: 0, pitch: 0 },
    { name: "three-quarter", position: [1.18, 1.58, 1.18], eyeY: 2.285, yaw: -Math.PI / 4, pitch: 0 },
    { name: "profile", position: [1.5, 1.58, 0], eyeY: 2.285, yaw: -Math.PI / 2, pitch: 0 },
    { name: "rear", position: [0, 1.58, -1.5], eyeY: 2.285, yaw: Math.PI, pitch: 0 },
  ];

  const canvas = page.locator("#scene-canvas");
  for (const view of views) {
    await page.evaluate((pose) => {
      const { camera } = window.__grakomsTest;
      camera.reset(pose);
      camera.feetY = pose.eyeY - camera.eyeHeight;
      camera.position[1] = pose.eyeY;
      camera.update = () => {};
    }, view);
    await page.waitForTimeout(250);
    await canvas.screenshot({ path: join(evidenceDirectory, `${prefix}-${view.name}.png`) });
  }
  await page.locator("[data-camera-preset='front']").click();
  await page.waitForTimeout(150);
  await page.screenshot({
    path: join(evidenceDirectory, `${prefix}-comparison-page.png`),
    fullPage: true,
  });
  process.stdout.write(`Captured ${views.length} emblem views under ${evidenceDirectory} with prefix ${prefix}.\n`);
} finally {
  await browser.close();
}
