#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evidenceDirectory = process.env.GRAKOMS_NORMALIZATION_EVIDENCE_DIR
  ? resolve(process.env.GRAKOMS_NORMALIZATION_EVIDENCE_DIR)
  : join(projectRoot, "docs", "planning", "evidence", "object-space-normalization", "final");
const playwrightModule = process.env.PLAYWRIGHT_MODULE
  ?? "/home/lenovo/.npm/_npx/6bcb61ec6d5aea22/node_modules/playwright/index.mjs";
const chromiumPath = process.env.CHROMIUM_PATH
  ?? "/home/lenovo/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome";
const baseUrl = process.env.GRAKOMS_URL ?? "http://127.0.0.1:8000";
const { chromium } = await import(pathToFileURL(playwrightModule).href);
mkdirSync(evidenceDirectory, { recursive: true });

const browser = await chromium.launch({
  executablePath: chromiumPath,
  headless: true,
  args: ["--enable-webgl", "--use-gl=angle", "--use-angle=swiftshader", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));
await page.addInitScript(() => {
  const audit = { bufferDataCalls: 0, staticDrawCalls: 0, nonStaticDrawCalls: 0, bufferSubDataCalls: 0 };
  Object.defineProperty(window, "__normalizationGpuAudit", { value: audit });
  const prototype = WebGL2RenderingContext.prototype;
  const originalBufferData = prototype.bufferData;
  const originalBufferSubData = prototype.bufferSubData;
  prototype.bufferData = function (...args) {
    audit.bufferDataCalls += 1;
    if (args[2] === this.STATIC_DRAW) audit.staticDrawCalls += 1;
    else audit.nonStaticDrawCalls += 1;
    return originalBufferData.apply(this, args);
  };
  prototype.bufferSubData = function (...args) {
    audit.bufferSubDataCalls += 1;
    return originalBufferSubData.apply(this, args);
  };
});

try {
  await page.goto(baseUrl + "/?test=1", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__grakomsTest
    && document.querySelector("#viewer-status").textContent.includes("WebGL2 ready"), null, { timeout: 30000 });
  await page.evaluate(async () => {
    const { renderer, wind } = window.__grakomsTest;
    await renderer.texturePromise;
    wind.setPaused(true);
    wind.time = 0;
  });
  await page.waitForFunction(() => {
    const canvas = document.querySelector("#scene-canvas");
    return canvas.width > 300 && canvas.height > 150;
  }, null, { timeout: 5000 });

  const audit = await page.evaluate(async () => {
    const test = window.__grakomsTest;
    const { gl, locations, meshCache } = test.renderer;
    const nodes = [];
    const unique = new Set();
    const visit = (node, path) => {
      if (node.geometry) {
        nodes.push({ node, path: path + "/" + node.name });
        unique.add(node.geometry);
      }
      for (let index = 0; index < node.children.length; index += 1) {
        visit(node.children[index], path + "/" + node.name + "[" + index + "]");
      }
    };
    visit(test.scene, "scene");
    let min = Infinity;
    let max = -Infinity;
    let cpuComponents = 0;
    let uniqueCpuComponents = 0;
    let gpuComponents = 0;
    let gpuMismatches = 0;
    let anchoredRoots = 0;
    let weightedTips = 0;
    for (const { node, path } of nodes) {
      const geometry = node.geometry;
      if (geometry.vertexCount * 3 !== geometry.positions.length) throw new Error(path + " has mismatched positions and vertexCount");
      if (geometry.windWeights.length !== geometry.vertexCount || geometry.windPhases.length !== geometry.vertexCount) {
        throw new Error(path + " has mismatched wind attribute lengths");
      }
      for (let index = 0; index < geometry.positions.length; index += 1) {
        const value = geometry.positions[index];
        if (!Number.isFinite(value) || value < -1 || value > 1) throw new Error(path + " has a position outside finite [-1, 1]");
        min = Math.min(min, value);
        max = Math.max(max, value);
        cpuComponents += 1;
      }
      if (/WindLeafSet|ReddishNarrowLeaves|DeepRustLeaves/.test(node.name)) {
        const restore = node.objectToConstruction;
        for (let index = 0; index < geometry.windWeights.length; index += 1) {
          const offset = index * 3;
          const y = restore[1] * geometry.positions[offset]
            + restore[5] * geometry.positions[offset + 1]
            + restore[9] * geometry.positions[offset + 2]
            + restore[13];
          if (geometry.windWeights[index] === 0 && Math.abs(y) < 1e-5) anchoredRoots += 1;
          if (geometry.windWeights[index] > 0.99 && y > 0) weightedTips += 1;
        }
      }
    }
    if (meshCache.size !== unique.size) throw new Error("renderer mesh cache no longer shares one static mesh per normalized geometry");
    for (const geometry of unique) {
      const mesh = meshCache.get(geometry);
      if (!mesh) throw new Error("a live geometry has no renderer cache entry");
      uniqueCpuComponents += geometry.positions.length;
      gl.bindVertexArray(mesh.vao);
      const buffer = gl.getVertexAttrib(locations.position, gl.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING);
      if (!buffer) throw new Error("a live mesh position attribute has no GPU buffer");
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      const interleaved = new Float32Array(mesh.vertexCount * 10);
      gl.getBufferSubData(gl.ARRAY_BUFFER, 0, interleaved);
      for (let vertex = 0; vertex < mesh.vertexCount; vertex += 1) {
        for (let axis = 0; axis < 3; axis += 1) {
          const gpu = interleaved[vertex * 10 + axis];
          const cpu = geometry.positions[vertex * 3 + axis];
          if (!Number.isFinite(gpu) || gpu < -1 || gpu > 1) throw new Error("GPU a_position escaped finite [-1, 1]");
          if (gpu !== cpu) gpuMismatches += 1;
          min = Math.min(min, gpu);
          max = Math.max(max, gpu);
          gpuComponents += 1;
        }
      }
    }
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    const safeSpawn = test.collisionWorld.findSafeSpawn(
      test.config.camera.startPosition[0],
      test.config.camera.startPosition[2],
      test.config.camera.collisionRadius,
      test.config.camera.standingBodyHeight,
    );
    const rampSupports = [10.79, 11.39, 11.99].map((z) => ({
      z,
      surface: test.collisionWorld.findSurface(0, z, test.config.camera.collisionRadius),
    }));
    const camera = test.camera;
    camera.reset({ position: [0, 1.58, 2], yaw: 0, pitch: 0 });
    camera.update(1, 0, 1, { sprint: true });
    const solidCollision = {
      position: [...camera.position],
      feetY: camera.feetY,
      canOccupy: test.collisionWorld.canOccupy(
        camera.position[0], camera.position[2], camera.feetY, camera.bodyHeight,
      ),
    };
    return {
      meshNodes: nodes.length,
      uniqueGeometryCount: unique.size,
      cachedMeshCount: meshCache.size,
      cpuPositionComponents: cpuComponents,
      uniqueCpuPositionComponents: uniqueCpuComponents,
      gpuPositionComponents: gpuComponents,
      objectSpaceRange: [min, max],
      gpuCpuPositionMismatches: gpuMismatches,
      anchoredLeafRootVertices: anchoredRoots,
      weightedLeafTipVertices: weightedTips,
      safeSpawn,
      rampSupports,
      solidCollision,
      canvasSize: [document.querySelector("#scene-canvas").width, document.querySelector("#scene-canvas").height],
      windPaused: test.wind.paused,
      windTime: test.wind.time,
      gpuAuditBeforeWait: { ...window.__normalizationGpuAudit },
      glVersion: gl.getParameter(gl.VERSION),
      glError: gl.getError(),
    };
  });
  assert.equal(audit.glVersion.includes("WebGL 2.0"), true);
  assert.equal(audit.meshNodes, 446);
  assert.equal(audit.uniqueGeometryCount, audit.cachedMeshCount);
  assert.equal(audit.uniqueCpuPositionComponents, audit.gpuPositionComponents);
  assert.deepEqual(audit.objectSpaceRange, [-1, 1]);
  assert.equal(audit.gpuCpuPositionMismatches, 0);
  assert.ok(audit.anchoredLeafRootVertices > 100);
  assert.ok(audit.weightedLeafTipVertices > 100);
  assert.equal(audit.windPaused, true);
  assert.equal(audit.windTime, 0);
  assert.equal(audit.safeSpawn.x, 0);
  assert.equal(audit.safeSpawn.z, 7.2);
  assert.deepEqual(audit.rampSupports.map(({ surface }) => surface?.name), [
    "EntranceAccessRamp", "EntranceAccessRamp", "EntranceAccessRamp",
  ]);
  audit.rampSupports.forEach(({ surface }, index) => {
    assert.ok(Math.abs(surface.y - [0.12000003459055997, 0.07800003719826294, 0.008000041544434821][index]) < 0.0001);
  });
  assert.ok(audit.solidCollision.position[2] > 0.6 && audit.solidCollision.position[2] < 0.9);
  assert.ok(audit.solidCollision.feetY > 0.25 && audit.solidCollision.feetY < 0.4);
  assert.equal(audit.solidCollision.canOccupy, true);
  assert.equal(audit.glError, 0);

  const views = {
    front: { position: [0, 1.58, 7.2], yaw: 0.055, pitch: -0.18 },
    oblique: { position: [4, 1.58, 3], yaw: -0.927, pitch: 0 },
    rear: { position: [0, 1.58, -6.2], yaw: Math.PI, pitch: 0 },
  };
  for (const [name, pose] of Object.entries(views)) {
    await page.evaluate(({ pose }) => {
      const { camera, wind } = window.__grakomsTest;
      camera.reset(pose);
      wind.setPaused(true);
      wind.time = 0;
    }, { pose });
    await page.waitForTimeout(250);
    await page.locator("#scene-canvas").screenshot({ path: join(evidenceDirectory, "final-" + name + ".png") });
  }
  const screenshotSize = await page.locator("#scene-canvas").evaluate((canvas) => [canvas.width, canvas.height]);

  const gpuAuditAfterWait = await page.evaluate(async () => {
    await new Promise((resolve) => setTimeout(resolve, 350));
    return { ...window.__normalizationGpuAudit, windTime: window.__grakomsTest.wind.time };
  });
  assert.equal(gpuAuditAfterWait.bufferDataCalls, audit.uniqueGeometryCount);
  assert.equal(gpuAuditAfterWait.staticDrawCalls, audit.uniqueGeometryCount);
  assert.equal(gpuAuditAfterWait.nonStaticDrawCalls, 0);
  assert.equal(gpuAuditAfterWait.bufferSubDataCalls, 0);
  assert.equal(gpuAuditAfterWait.windTime, 0);
  assert.deepEqual(pageErrors, []);
  const report = {
    generatedAt: new Date().toISOString(),
    url: baseUrl,
    browser: browser.version(),
    viewport: [1440, 1000],
    screenshotSize,
    audit,
    gpuAuditAfterWait,
    matchedPausedWindViews: Object.keys(views).map((name) => "final-" + name + ".png"),
    pageErrors,
    result: "passed",
  };
  writeFileSync(join(evidenceDirectory, "browser-report.json"), JSON.stringify(report, null, 2) + "\n");
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
} finally {
  await browser.close();
}
