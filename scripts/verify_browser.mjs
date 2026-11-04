#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evidenceDirectory = join(projectRoot, "docs", "planning", "evidence");
const evidencePrefix = process.env.GRAKOMS_EVIDENCE_PREFIX;
const evidencePath = (name) => join(
  evidenceDirectory,
  evidencePrefix ? name.replace(/^stage-h-/, evidencePrefix + "-") : name,
);
const playwrightModule = process.env.PLAYWRIGHT_MODULE
  ?? "/home/lenovo/.npm/_npx/6bcb61ec6d5aea22/node_modules/playwright/index.mjs";
const chromiumPath = process.env.CHROMIUM_PATH
  ?? "/home/lenovo/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome";
const baseUrl = process.env.GRAKOMS_URL ?? "http://127.0.0.1:8000";
const { chromium } = await import(pathToFileURL(playwrightModule).href);

mkdirSync(evidenceDirectory, { recursive: true });

const checks = [];
const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];
const canceledMediaRequests = [];
const httpErrors = [];
let browser;

async function check(name, action) {
  let recordedDetails = null;
  try {
    const details = await action((value) => { recordedDetails = value; });
    checks.push({ name, status: "passed", details: details ?? recordedDetails ?? null });
    process.stdout.write("PASS " + name + "\n");
    return details;
  } catch (error) {
    const failedCheck = { name, status: "failed", error: error instanceof Error ? error.message : String(error) };
    if (recordedDetails !== null) failedCheck.details = recordedDetails;
    checks.push(failedCheck);
    process.stderr.write("FAIL " + name + ": " + (error instanceof Error ? error.message : String(error)) + "\n");
    return null;
  }
}

function near(actual, expected, tolerance = 0.001) {
  assert.ok(Math.abs(actual - expected) <= tolerance, "expected " + actual + " to be within " + tolerance + " of " + expected);
}

function formattedCameraPosition(position) {
  const coordinate = (value) => {
    const rounded = Number(value.toFixed(2));
    return (Object.is(rounded, -0) ? 0 : rounded).toFixed(2);
  };
  return "X " + coordinate(position[0]) + " · Y " + coordinate(position[1]) + " · Z " + coordinate(position[2]);
}

async function waitForReady(page) {
  await page.goto(baseUrl + "/?test=1", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => {
    const test = window.__grakomsTest;
    return test && test.renderer.texturePromise
      && document.querySelector("#viewer-status").textContent.includes("WebGL2 ready");
  }, null, { timeout: 30000 });
  await page.waitForTimeout(150);
}

function cameraSnapshot(page) {
  return page.evaluate(() => {
    const camera = window.__grakomsTest.camera;
    return {
      position: [...camera.position], yaw: camera.yaw, pitch: camera.pitch,
      feetY: camera.feetY, eyeHeight: camera.eyeHeight, bodyHeight: camera.bodyHeight,
      grounded: camera.grounded, crouched: camera.crouched,
    };
  });
}

async function measureHeldMovement(page, keys, durationMs = 650) {
  const started = await page.evaluate(() => {
    const { camera, wind } = window.__grakomsTest;
    camera.reset({ position: [0, 1.58, 7.2], yaw: 0, pitch: 0 });
    const originalUpdate = camera.update;
    const probe = { elapsed: 0 };
    camera.update = function (forward, right, deltaSeconds, modifiers) {
      if (forward !== 0 || right !== 0) probe.elapsed += deltaSeconds;
      return originalUpdate.call(this, forward, right, deltaSeconds, modifiers);
    };
    window.__movementProbe = { originalUpdate, probe };
    return { position: [...camera.position], simulationTime: wind.time };
  });
  for (const key of keys) await page.keyboard.down(key);
  await page.waitForTimeout(durationMs);
  for (const key of [...keys].reverse()) await page.keyboard.up(key);
  return page.evaluate(({ position, simulationTime }) => {
    const { camera, wind } = window.__grakomsTest;
    const movementProbe = window.__movementProbe;
    camera.update = movementProbe.originalUpdate;
    delete window.__movementProbe;
    const elapsed = movementProbe.probe.elapsed;
    const distance = Math.hypot(camera.position[0] - position[0], camera.position[2] - position[2]);
    return {
      distance,
      elapsed,
      elapsedInSimulation: wind.time - simulationTime,
      speed: distance / elapsed,
      eyeHeight: camera.eyeHeight,
      bodyHeight: camera.bodyHeight,
      crouched: camera.crouched,
    };
  }, started);
}

async function main() {
  browser = await chromium.launch({
    executablePath: chromiumPath,
    headless: true,
    args: ["--enable-webgl", "--use-gl=angle", "--use-angle=swiftshader", "--disable-dev-shm-usage"],
  });
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const page = await desktop.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText ?? "failed";
    const detail = request.url() + " · " + failure;
    if (request.resourceType() === "media" && failure === "net::ERR_ABORTED") canceledMediaRequests.push(detail);
    else failedRequests.push(detail);
  });
  page.on("response", (response) => {
    if (response.status() >= 400) httpErrors.push(response.status() + " " + response.url());
  });
  await page.addInitScript(() => {
    const audit = { bufferDataCalls: 0, staticDrawCalls: 0, nonStaticDrawCalls: 0, bufferSubDataCalls: 0, contextLost: false };
    Object.defineProperty(window, "__gpuAudit", { value: audit, configurable: false });
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
    addEventListener("webglcontextlost", () => { audit.contextLost = true; }, true);
  });

  await check("Desktop comparison page and WebGL2 initialize", async () => {
    await waitForReady(page);
    const result = await page.evaluate(() => {
      const test = window.__grakomsTest;
      return {
        webgl2: test.renderer.gl instanceof WebGL2RenderingContext,
        contextLost: test.renderer.gl.isContextLost(),
        status: document.querySelector("#viewer-status").textContent,
        glError: test.renderer.gl.getError(),
        textureCount: test.renderer.textureCache.size,
        expectedTextureCount: Object.keys(test.config.textures).length,
        textureErrors: [...test.renderer.textureErrors],
      };
    });
    assert.equal(result.webgl2, true);
    assert.equal(result.contextLost, false);
    assert.equal(result.glError, 0);
    assert.equal(result.textureCount, result.expectedTextureCount);
    assert.deepEqual(result.textureErrors, []);
    assert.match(result.status, /WebGL2 ready/);
    return result;
  });

  await check("Public page contains only the two comparison panes", async () => {
    const result = await page.evaluate(() => ({
      panes: document.querySelectorAll(".comparison > .pane").length,
      selectors: [...document.querySelectorAll("main select")].map((element) => element.id),
      localStorageKeys: Object.keys(localStorage),
      text: document.querySelector("main").innerText,
      fields: document.querySelectorAll("#group-name, #member-name, #task-division, [data-scene-tree], [data-report]").length,
    }));
    assert.equal(result.panes, 2);
    assert.deepEqual(result.selectors, ["reference-select"]);
    assert.deepEqual(result.localStorageKeys, []);
    assert.equal(result.fields, 0);
    assert.doesNotMatch(result.text, /task division|editable group record|scene tree|report/i);
    assert.match(result.text, /WASD.*Shift.*sprint.*Ctrl.*crouch.*Space.*jump/s);
    return { paneCount: result.panes, referenceSelectorOnly: true, conciseWalkHints: true, noRemovedFieldsOrPersistence: true };
  });

  await check("Desktop keeps the WebGL scene left of the references", async () => {
    const result = await page.evaluate(() => {
      const scene = document.querySelector(".pane--model").getBoundingClientRect();
      const reference = document.querySelector(".pane--reference").getBoundingClientRect();
      const sceneFrame = document.querySelector(".canvas-frame").getBoundingClientRect();
      const referenceFrame = document.querySelector(".reference-frame").getBoundingClientRect();
      return {
        scene: { left: scene.left, right: scene.right, top: scene.top, width: scene.width },
        reference: { left: reference.left, right: reference.right, top: reference.top, width: reference.width },
        frameRatioDifference: Math.abs(sceneFrame.width / sceneFrame.height - referenceFrame.width / referenceFrame.height),
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    assert.ok(result.scene.right < result.reference.left);
    assert.equal(result.scene.top, result.reference.top);
    assert.ok(Math.abs(result.scene.width - result.reference.width) < 2);
    assert.ok(result.frameRatioDifference < 0.02);
    assert.equal(result.overflow, false);
    await page.screenshot({ path: evidencePath("stage-h-desktop.png"), fullPage: true });
    return result;
  });

  await check("Initial camera and presets use safe grounded comparison poses", async () => {
    const initial = await cameraSnapshot(page);
    near(initial.position[0], 0);
    near(initial.position[2], 7.2);
    near(initial.yaw, 0.055);
    near(initial.pitch, -0.18);
    near(initial.position[1], initial.feetY + initial.eyeHeight, 1e-5);
    near(initial.eyeHeight, 1.58);
    assert.equal(initial.grounded, true);

    await page.evaluate(() => {
      const { camera, input } = window.__grakomsTest;
      input.lookInputFilter.reset(0);
      camera.reset({ position: [3, 1.58, 3], yaw: 1, pitch: 0.5 });
      camera.setCrouched(true);
      camera.setSprinting(true);
      camera.verticalVelocity = 4;
      camera.queueJump();
      camera.grounded = false;
      input.keys = new Set(["ShiftLeft", "ControlRight", "Space"]);
      input.jumpQueued = true;
    });
    await page.locator("[data-camera-preset='front']").click();
    const reset = await cameraSnapshot(page);
    const resetInput = await page.evaluate(() => {
      const { camera, input } = window.__grakomsTest;
      return {
        keys: [...input.keys], inputJump: input.jumpQueued,
        cameraJump: camera.jumpQueued, verticalVelocity: camera.verticalVelocity,
        crouched: camera.crouched, crouchRequested: camera.crouchRequested,
        sprinting: camera.sprinting, grounded: camera.grounded,
        lookTimestamp: input.lookInputFilter.lastTimestamp,
      };
    });
    near(reset.position[0], initial.position[0]);
    near(reset.position[1], reset.feetY + reset.eyeHeight, 1e-5);
    near(reset.position[1], initial.position[1]);
    near(reset.position[2], initial.position[2]);
    near(reset.yaw, initial.yaw);
    near(reset.pitch, initial.pitch);
    assert.deepEqual(resetInput.keys, []);
    assert.equal(resetInput.inputJump, false);
    assert.equal(resetInput.cameraJump, false);
    assert.equal(resetInput.verticalVelocity, 0);
    assert.equal(resetInput.crouched, false);
    assert.equal(resetInput.crouchRequested, false);
    assert.equal(resetInput.sprinting, false);
    assert.equal(resetInput.grounded, true);
    assert.ok(resetInput.lookTimestamp > 0, "a camera preset starts with a fresh look-input anchor");
    await page.screenshot({ path: evidencePath("stage-h-front.png"), fullPage: true });
    return { initial, frontReset: reset, resetInput };
  });

  await check("Live XYZ HUD follows walking, jumping, crouching, and preset reset", async () => {
    await page.evaluate(() => {
      const { camera, input } = window.__grakomsTest;
      input.clearMovementState();
      camera.reset();
    });
    const initialPosition = await page.evaluate(() => [...window.__grakomsTest.camera.position]);
    const initialText = formattedCameraPosition(initialPosition);
    await page.waitForFunction((value) => document.querySelector("#camera-position").textContent === value, initialText, { timeout: 3000 });
    const initial = await page.evaluate(() => ({
      text: document.querySelector("#camera-position").textContent,
      live: document.querySelector("#camera-position").getAttribute("aria-live"),
      position: [...window.__grakomsTest.camera.position],
      feetY: window.__grakomsTest.camera.feetY,
    }));
    assert.equal(initial.text, formattedCameraPosition(initial.position));
    assert.equal(initial.live, "off", "the changing readout does not announce every frame");

    await page.evaluate(() => window.__grakomsTest.input.keys.add("KeyW"));
    await page.waitForFunction((value) => document.querySelector("#camera-position").textContent !== value, initial.text, { timeout: 3000 });
    await page.evaluate(() => window.__grakomsTest.input.keys.delete("KeyW"));
    const walking = await page.evaluate(() => ({
      text: document.querySelector("#camera-position").textContent,
      position: [...window.__grakomsTest.camera.position],
    }));
    assert.notEqual(walking.text, initial.text);
    assert.equal(walking.text, formattedCameraPosition(walking.position));

    await page.evaluate(() => {
      const { camera, input } = window.__grakomsTest;
      input.clearMovementState();
      camera.reset();
      input.jumpQueued = true;
    });
    await page.waitForFunction((feetY) => window.__grakomsTest.camera.feetY > feetY + 0.3, initial.feetY, { timeout: 3000 });
    const jumping = await page.evaluate(() => ({
      text: document.querySelector("#camera-position").textContent,
      position: [...window.__grakomsTest.camera.position],
      feetY: window.__grakomsTest.camera.feetY,
    }));
    assert.ok(jumping.feetY > initial.feetY + 0.3, "jump moves the actual eye position upward");
    assert.equal(jumping.text, formattedCameraPosition(jumping.position));
    assert.notEqual(jumping.text, initial.text);

    await page.evaluate(() => {
      const { camera, input } = window.__grakomsTest;
      input.clearMovementState();
      camera.reset();
      input.keys.add("ControlLeft");
    });
    await page.waitForFunction(() => {
      const camera = window.__grakomsTest.camera;
      return camera.crouched && camera.eyeHeight < 1.4;
    }, null, { timeout: 3000 });
    const crouching = await page.evaluate(() => ({
      text: document.querySelector("#camera-position").textContent,
      position: [...window.__grakomsTest.camera.position],
      eyeHeight: window.__grakomsTest.camera.eyeHeight,
      feetY: window.__grakomsTest.camera.feetY,
      crouched: window.__grakomsTest.camera.crouched,
    }));
    assert.equal(crouching.crouched, true);
    assert.ok(crouching.eyeHeight < 1.4);
    assert.equal(crouching.text, formattedCameraPosition(crouching.position));
    assert.notEqual(crouching.text, initial.text);

    await page.evaluate(() => window.__grakomsTest.input.keys.delete("ControlLeft"));
    await page.locator("[data-camera-preset='front']").click();
    await page.waitForFunction((value) => document.querySelector("#camera-position").textContent === value, initial.text, { timeout: 3000 });
    const reset = await cameraSnapshot(page);
    const resetText = await page.locator("#camera-position").textContent();
    assert.equal(resetText, initial.text);
    return { initial, walking, jumping, crouching, reset: { position: reset.position, text: resetText } };
  });

  await check("All six local reference photos load and the video exposes metadata", async () => {
    const selector = page.locator("#reference-select");
    const photoValues = ["front", "oblique", "profile", "rear", "emblem", "planting"];
    const photos = [];
    for (const value of photoValues) {
      await selector.selectOption(value);
      await page.waitForFunction(() => document.querySelector("#reference-photo").naturalWidth > 0);
      photos.push(await page.locator("#reference-photo").evaluate((image) => ({
        value: document.querySelector("#reference-select").value,
        width: image.naturalWidth,
        height: image.naturalHeight,
      })));
      assert.equal(photos.at(-1).width, 1599);
      assert.equal(photos.at(-1).height, 899);
    }
    await selector.selectOption("video");
    await page.waitForFunction(() => {
      const video = document.querySelector("#reference-video");
      return !video.hidden && video.readyState >= HTMLMediaElement.HAVE_METADATA && Number.isFinite(video.duration);
    }, null, { timeout: 30000 });
    const video = await page.locator("#reference-video").evaluate((element) => ({
      duration: element.duration,
      readyState: element.readyState,
      source: element.currentSrc,
    }));
    assert.ok(Math.abs(video.duration - 28.98) < 0.2);
    assert.equal(video.readyState >= 1, true);
    return { photos, video: { duration: video.duration, readyState: video.readyState } };
  });

  await check("Comparison presets select their matching reference view", async () => {
    const presets = [
      ["front", "front"],
      ["threeQuarter", "oblique"],
      ["profile", "profile"],
      ["rear", "rear"],
    ];
    const details = [];
    for (const [preset, reference] of presets) {
      await page.locator("[data-camera-preset='" + preset + "']").click();
      await page.waitForTimeout(80);
      const current = await page.evaluate(() => ({
        reference: document.querySelector("#reference-select").value,
        photo: document.querySelector("#reference-photo").getAttribute("src"),
        pressed: [...document.querySelectorAll("[data-camera-preset]")].find((button) => button.getAttribute("aria-pressed") === "true")?.dataset.cameraPreset,
      }));
      assert.equal(current.reference, reference);
      assert.equal(current.pressed, preset);
      assert.match(current.photo, new RegExp(reference === "oblique" ? "oblique-plaza" : reference + "-"));
      details.push(current);
      await page.screenshot({ path: evidencePath("stage-h-" + (preset === "threeQuarter" ? "three-quarter" : preset) + ".png"), fullPage: true });
    }
    await page.locator("[data-camera-preset='front']").click();
    await check("Top-down apron view shows a circular monument-foot pavement", async () => {
      await page.evaluate(() => {
        const { camera, input } = window.__grakomsTest;
        input.clearMovementState();
        camera.feetY = 6.92;
        camera.grounded = true;
        camera.verticalVelocity = 0;
        camera.position = [0, camera.feetY + camera.eyeHeight, 0.95];
        camera.yaw = 0;
        camera.pitch = -1.46;
        const referenceSelect = document.querySelector("#reference-select");
        referenceSelect.value = "oblique";
        referenceSelect.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await page.waitForTimeout(160);
      const pose = await cameraSnapshot(page);
      assert.ok(pose.position[1] > 8);
      assert.ok(pose.pitch < -1.4);
      const apron = await page.evaluate(() => {
        const { scene } = window.__grakomsTest;
        const find = (root, name) => {
          if (root.name === name) return root;
          for (const child of root.children) {
            const match = find(child, name);
            if (match) return match;
          }
          return null;
        };
        const restore = (node, index) => {
          const p = node.geometry.positions;
          const m = node.objectToConstruction;
          return [
            m[0] * p[index] + m[4] * p[index + 1] + m[8] * p[index + 2] + m[12],
            m[2] * p[index] + m[6] * p[index + 1] + m[10] * p[index + 2] + m[14],
          ];
        };
        const circle = find(scene, "CircularPavingApron");
        if (!circle?.geometry) throw new Error("The circular monument-foot apron is missing.");
        let maxRadius = 0;
        let minBoundaryRadius = Infinity;
        let maxBoundaryRadius = -Infinity;
        const radii = [];
        for (let index = 0; index < circle.geometry.positions.length; index += 3) {
          const [x, z] = restore(circle, index);
          const radius = Math.hypot(x, z);
          radii.push(radius);
          maxRadius = Math.max(maxRadius, radius);
        }
        let boundaryVertices = 0;
        for (const radius of radii) {
          if (radius < maxRadius - 0.0001) continue;
          boundaryVertices += 1;
          minBoundaryRadius = Math.min(minBoundaryRadius, radius);
          maxBoundaryRadius = Math.max(maxBoundaryRadius, radius);
        }
        const surfaces = ["ApronTileSurfaces", "ApronGroutSurface"].map((name) => {
          const node = find(scene, name);
          if (!node?.geometry) throw new Error(name + " is missing.");
          let surfaceRadius = 0;
          for (let index = 0; index < node.geometry.positions.length; index += 3) {
            const [x, z] = restore(node, index);
            surfaceRadius = Math.max(surfaceRadius, Math.hypot(x, z));
          }
          return { name, surfaceRadius };
        });
        return { maxRadius, boundaryVertices, boundarySpread: maxBoundaryRadius - minBoundaryRadius, surfaces };
      });
      assert.ok(apron.boundaryVertices >= 128, "the apron exposes a sampled circle boundary");
      assert.ok(apron.boundarySpread < 0.001, "the apron boundary has a constant radius rather than square corners");
      for (const surface of apron.surfaces) {
        assert.ok(surface.surfaceRadius <= apron.maxRadius + 0.001, surface.name + " stays inside the circular apron");
      }
      await page.screenshot({ path: evidencePath("stage-h-apron-top-down.png"), fullPage: true });
      await page.locator("#scene-canvas").screenshot({ path: evidencePath("stage-h-apron-top-down-canvas.png") });
      await page.locator("[data-camera-preset='front']").click();
      return { position: pose.position, pitch: pose.pitch, reference: "oblique", apron };
    });
    return details;
  });

  await check("WASD is normalized and sprint/crouch modifiers use configured speeds", async () => {
    const result = await page.evaluate(() => {
      const { camera, input } = window.__grakomsTest;
      const measure = (codes) => {
        camera.reset();
        input.keys = new Set(codes);
        const before = [...camera.position];
        input.update(1);
        return {
          distance: Math.hypot(camera.position[0] - before[0], camera.position[2] - before[2]),
          eyeHeight: camera.eyeHeight,
          bodyHeight: camera.bodyHeight,
          crouched: camera.crouched,
        };
      };
      const forward = measure(["KeyW"]);
      const diagonal = measure(["KeyW", "KeyD"]);
      const sprintLeft = measure(["KeyW", "ShiftLeft"]);
      const sprintRight = measure(["KeyW", "ShiftRight"]);
      const crouchOverridesSprint = measure(["KeyW", "ShiftRight", "ControlRight"]);
      const movementCodes = [...input.movementCodes];
      input.keys.clear();
      camera.reset();
      return { forward, diagonal, sprintLeft, sprintRight, crouchOverridesSprint, movementCodes };
    });
    near(result.forward.distance, 1.55);
    near(result.diagonal.distance, result.forward.distance);
    near(result.sprintLeft.distance, 2.5575, 0.006);
    near(result.sprintRight.distance, result.sprintLeft.distance, 0.006);
    near(result.crouchOverridesSprint.distance, 0.8525, 0.006);
    near(result.crouchOverridesSprint.eyeHeight, 1.04, 0.002);
    near(result.crouchOverridesSprint.bodyHeight, 1.22, 0.002);
    assert.equal(result.crouchOverridesSprint.crouched, true);
    assert.deepEqual(result.movementCodes.sort(), ["ControlLeft", "ControlRight", "KeyA", "KeyD", "KeyS", "KeyW", "ShiftLeft", "ShiftRight", "Space"]);
    return result;
  });

  await check("Pitch clamps and camera collision protects monument contact", async () => {
    const result = await page.evaluate(() => {
      const { camera, collisionWorld } = window.__grakomsTest;
      camera.reset();
      camera.rotate(0, -100000);
      const pitchUp = camera.pitch * 180 / Math.PI;
      camera.rotate(0, 200000);
      const pitchDown = camera.pitch * 180 / Math.PI;
      camera.reset({ position: [0, 1.58, 2], yaw: 0, pitch: 0 });
      camera.update(1, 0, 1, { sprint: true });
      return {
        pitchUp, pitchDown, position: [...camera.position], feetY: camera.feetY,
        bodyHeight: camera.bodyHeight,
        canOccupy: collisionWorld.canOccupy(camera.position[0], camera.position[2], camera.feetY, camera.bodyHeight),
      };
    });
    near(result.pitchUp, 72, 0.001);
    near(result.pitchDown, -76, 0.001);
    assert.ok(result.position[2] > 0.6 && result.position[2] < 0.9);
    assert.ok(result.feetY > 0.25 && result.feetY < 0.4, "camera steps onto a low monument surface without entering it");
    assert.equal(result.canOccupy, true);
    return result;
  });

  await check("Pointer-lock input drives movement, jumping, collision, blur and relock safely", async (recordDetails) => {
    let phase = "initial pointer lock";
    let lookInput = null;
    let rawPointerLockRequests = null;
    try {
      await page.locator("[data-camera-preset='front']").click();
      await page.evaluate(() => {
        const canvas = document.querySelector("#scene-canvas");
        const nativeRequestPointerLock = canvas.requestPointerLock;
        const requests = [];
        Object.defineProperty(canvas, "requestPointerLock", {
          configurable: true,
          value(options) {
            requests.push(options ?? null);
            if (options?.unadjustedMovement === true) {
              return Promise.reject(new DOMException("Verifier simulates unsupported raw movement.", "NotSupportedError"));
            }
            return nativeRequestPointerLock.call(canvas);
          },
        });
        window.__rawPointerLockProbe = { requests };
        const probe = { lockTime: null, events: [] };
        document.addEventListener("pointerlockchange", (event) => {
          if (document.pointerLockElement === document.querySelector("#scene-canvas")) probe.lockTime = event.timeStamp;
        }, true);
        document.addEventListener("mousemove", (event) => probe.events.push({
          x: event.movementX, y: event.movementY, trusted: event.isTrusted,
          locked: document.pointerLockElement === document.querySelector("#scene-canvas"),
          time: event.timeStamp, lockTime: probe.lockTime,
        }), true);
        window.__lookProbe = probe;
      });
      await page.locator("#start-walk").click();
      await page.waitForFunction(() => document.pointerLockElement === document.querySelector("#scene-canvas"), null, { timeout: 10000 });
      rawPointerLockRequests = await page.evaluate(() => {
        const canvas = document.querySelector("#scene-canvas");
        delete canvas.requestPointerLock;
        return window.__rawPointerLockProbe.requests;
      });
      assert.deepEqual(rawPointerLockRequests, [{ unadjustedMovement: true }, null], "unsupported raw movement retries standard pointer lock");
      phase = "mouse look";
      await page.evaluate(() => window.__grakomsTest.camera.reset({ position: [5, 1.58, 0], yaw: 0, pitch: 0 }));
      const beforeMouse = await cameraSnapshot(page);
      const probeStart = await page.evaluate(() => window.__lookProbe.events.length);
      await page.mouse.move(740, 520);
      await page.waitForTimeout(80);
      const afterMouse = await cameraSnapshot(page);
      const transitionEvent = await page.evaluate((startIndex) => {
        const probe = window.__lookProbe;
        const event = probe.events.slice(startIndex).find((item) => item.locked && item.trusted);
        if (!event) return null;
        const elapsedMs = event.time - event.lockTime;
        return {
          ...event,
          elapsedMs,
          rate: elapsedMs > 0 ? Math.hypot(event.x, event.y) * 1000 / elapsedMs : Infinity,
          maxRate: window.__grakomsTest.input.lookInputFilter.maxPixelsPerSecond,
        };
      }, probeStart);
      assert.ok(transitionEvent, "a trusted browser mouse event arrived while pointer locked");
      assert.ok(transitionEvent.rate > transitionEvent.maxRate, `the lock-transition sample should exercise the reproduced spike filter: ${JSON.stringify(transitionEvent)}`);
      near(afterMouse.yaw, beforeMouse.yaw, 1e-8);
      near(afterMouse.pitch, beforeMouse.pitch, 1e-8);
      afterMouse.position.forEach((coordinate, axis) => near(coordinate, beforeMouse.position[axis], 0.001, "a look spike does not teleport camera position"));
      near(afterMouse.feetY, beforeMouse.feetY, 0.001, "a look spike does not change collision support height");

      const syntheticSpike = await page.evaluate(() => {
        const { camera } = window.__grakomsTest;
        camera.reset({ position: [5, 1.58, 0], yaw: 0, pitch: 0 });
        const event = new MouseEvent("mousemove");
        Object.defineProperties(event, { movementX: { value: 12000 }, movementY: { value: -18000 } });
        document.dispatchEvent(event);
        return { trusted: event.isTrusted, yaw: camera.yaw, pitch: camera.pitch };
      });
      assert.equal(syntheticSpike.trusted, false);
      near(syntheticSpike.yaw, 0, 1e-8);
      near(syntheticSpike.pitch, 0, 1e-8);

      const intentionalStart = await cameraSnapshot(page);
      for (let index = 1; index <= 6; index += 1) {
        await page.mouse.move(740 + index * 50, 520 - index * 5);
        await page.waitForTimeout(20);
      }
      const intentionalTurn = await cameraSnapshot(page);
      assert.ok(intentionalTurn.yaw - intentionalStart.yaw > 0.5, "normal quick pointer-lock turns retain their complete mouse movement");
      assert.notEqual(intentionalTurn.pitch, intentionalStart.pitch);
      lookInput = { transitionEvent, syntheticSpike, intentionalYawDelta: intentionalTurn.yaw - intentionalStart.yaw };

      phase = "walk and sprint keys";
      const walk = await measureHeldMovement(page, ["w"]);
      const sprint = await measureHeldMovement(page, ["w", "Shift"]);
      assert.ok(walk.speed > 0.75 && walk.speed < 1.9, `actual W input speed was ${walk.speed.toFixed(3)} units/s`);
      assert.ok(sprint.speed > walk.speed * 1.35, `actual Shift input speed ${sprint.speed.toFixed(3)} did not exceed walk ${walk.speed.toFixed(3)}`);

      phase = "crouch priority";
      await page.evaluate(() => window.__grakomsTest.camera.reset({ position: [0, 1.58, 7.2], yaw: 0, pitch: 0 }));
      await page.keyboard.down("w");
      await page.keyboard.down("Shift");
      await page.keyboard.down("Control");
      await page.waitForFunction(() => window.__grakomsTest.input.keys.has("ControlLeft"), null, { timeout: 3000 });
      await page.waitForTimeout(500);
      const crouchPriority = await page.evaluate(() => {
        const { camera, input } = window.__grakomsTest;
        return {
          eyeHeight: camera.eyeHeight, bodyHeight: camera.bodyHeight,
          crouched: camera.crouched, sprinting: camera.sprinting,
          keys: [...input.keys],
        };
      });
      assert.equal(crouchPriority.crouched, true);
      assert.equal(crouchPriority.sprinting, false);
      assert.ok(crouchPriority.eyeHeight < 1.1 && crouchPriority.bodyHeight < 1.3);
      await page.keyboard.up("Control");
      await page.keyboard.up("Shift");
      await page.keyboard.up("w");

      phase = "monument wall slide";
      await page.evaluate(() => window.__grakomsTest.camera.reset({ position: [0, 1.58, 1.2], yaw: 0, pitch: 0 }));
      const monumentKeys = ["w", "d", "Shift"];
      const monumentDeadlineMs = 2000;
      let observationWaitError = null;
      try {
        for (const key of monumentKeys) await page.keyboard.down(key);
        await page.evaluate((deadlineMs) => {
          const { camera, collisionWorld } = window.__grakomsTest;
          const probe = {
            startedAt: performance.now(),
            deadlineMs,
            startPosition: [...camera.position],
            samples: [],
            contactSample: null,
            done: false,
            stopReason: null,
          };
          window.__monumentSlideProbe = probe;
          const sampleFrame = () => {
            if (probe.done) return;
            const elapsedMs = performance.now() - probe.startedAt;
            const sample = {
              elapsedMs: Number(elapsedMs.toFixed(2)),
              position: [...camera.position],
              feetY: camera.feetY,
              bodyHeight: camera.bodyHeight,
              canOccupy: collisionWorld.canOccupy(camera.position[0], camera.position[2], camera.feetY, camera.bodyHeight),
            };
            probe.samples.push(sample);
            if (sample.position[0] > 0.3) {
              probe.contactSample = sample;
              probe.stopReason = "first lateral-progress sample with x > 0.3";
              probe.done = true;
              return;
            }
            if (elapsedMs >= deadlineMs) {
              probe.stopReason = "bounded observation deadline reached";
              probe.done = true;
              return;
            }
            requestAnimationFrame(sampleFrame);
          };
          requestAnimationFrame(sampleFrame);
        }, monumentDeadlineMs);
        try {
          await page.waitForFunction(() => window.__monumentSlideProbe?.done === true, null, { timeout: monumentDeadlineMs + 1000 });
        } catch (error) {
          observationWaitError = error instanceof Error ? error.message : String(error);
        }
      } finally {
        for (const key of [...monumentKeys].reverse()) await page.keyboard.up(key);
        await page.evaluate(() => {
          const probe = window.__monumentSlideProbe;
          if (probe && !probe.done) {
            probe.done = true;
            probe.stopReason = "keys released before the observation completed";
          }
        });
      }
      const monumentSlide = await page.evaluate(() => {
        const { camera } = window.__grakomsTest;
        const probe = window.__monumentSlideProbe;
        return {
          deadlineMs: probe?.deadlineMs ?? null,
          startPosition: probe?.startPosition ?? [0, 1.58, 1.2],
          stopReason: probe?.stopReason ?? "probe unavailable",
          sampleCount: probe?.samples.length ?? 0,
          path: probe?.samples ?? [],
          contactSample: probe?.contactSample ?? null,
          finalPosition: [...camera.position],
        };
      });
      const monumentDetails = {
        contactCriteria: { xGreaterThan: 0.3, zGreaterThan: 0.6 },
        observationWaitError,
        monumentSlide,
      };
      recordDetails({ lookInput, rawPointerLockRequests, walk, sprint, crouchPriority, ...monumentDetails });
      if (observationWaitError) throw new Error("bounded per-frame observation did not finish: " + observationWaitError);
      const wallContactPosition = monumentSlide.contactSample?.position
        ?? monumentSlide.path[monumentSlide.path.length - 1]?.position
        ?? monumentSlide.finalPosition;
      assert.ok(wallContactPosition[0] > 0.3, "actual diagonal input slides along the monument face");
      assert.ok(wallContactPosition[2] > 0.6, "actual diagonal input cannot pass through the monument");
      assert.ok(monumentSlide.path.every((sample) => sample.canOccupy), "sampled diagonal movement remains outside monument collision");

      phase = "jump apex and landing";
      await page.evaluate(() => window.__grakomsTest.camera.reset({ position: [5, 1.58, 0], yaw: 0, pitch: 0 }));
      const jumpStart = await cameraSnapshot(page);
      const jumpStartSimulationTime = await page.evaluate(() => window.__grakomsTest.wind.time);
      await page.keyboard.down("Space");
      let jumpApex = jumpStart.feetY;
      const jumpStartedAt = Date.now();
      let jumpSimulationElapsed = 0;
      while (Date.now() - jumpStartedAt < 5000 && jumpSimulationElapsed < 1) {
        jumpApex = Math.max(jumpApex, (await cameraSnapshot(page)).feetY);
        await page.waitForTimeout(45);
        jumpSimulationElapsed = await page.evaluate((start) => window.__grakomsTest.wind.time - start, jumpStartSimulationTime);
      }
      const heldJumpEnd = await cameraSnapshot(page);
      await page.keyboard.up("Space");
      assert.ok(jumpSimulationElapsed >= 1, "the held-jump check observed one second of simulation time");
      assert.ok(jumpApex > jumpStart.feetY + 0.55, "actual Space input reaches the jump arc");
      assert.ok(Math.abs(heldJumpEnd.feetY - jumpStart.feetY) < 0.02, "holding Space lands without automatic repeated jumps");
      assert.equal(heldJumpEnd.grounded, true);

      phase = "crouch ceiling and head contact";
      const ceiling = await page.evaluate(() => {
        const camera = window.__grakomsTest.camera;
        return {
          name: "BrowserLowCeiling", shape: "box",
          bounds: {
            minX: camera.position[0] - 1, maxX: camera.position[0] + 1,
            minY: camera.feetY + 1.36, maxY: camera.feetY + 1.56,
            minZ: camera.position[2] - 1, maxZ: camera.position[2] + 1,
          },
        };
      });
      await page.evaluate((collider) => window.__grakomsTest.collisionWorld.colliders.push(collider), ceiling);
      await page.keyboard.down("Control");
      await page.waitForTimeout(250);
      await page.keyboard.up("Control");
      await page.keyboard.down("Space");
      await page.waitForTimeout(300);
      await page.keyboard.up("Space");
      const underCeiling = await page.evaluate(() => {
        const { camera, collisionWorld } = window.__grakomsTest;
        const collider = collisionWorld.colliders.find((item) => item.name === "BrowserLowCeiling");
        return { crouched: camera.crouched, bodyHeight: camera.bodyHeight, headY: camera.feetY + camera.bodyHeight, ceilingBottom: collider.bounds.minY };
      });
      assert.equal(underCeiling.crouched, true, "Ctrl release does not force standing under a ceiling");
      assert.ok(underCeiling.headY <= underCeiling.ceilingBottom + 0.005, "jump head contact stays below the ceiling");
      await page.evaluate(() => {
        const { camera, collisionWorld } = window.__grakomsTest;
        collisionWorld.colliders.splice(collisionWorld.colliders.findIndex((item) => item.name === "BrowserLowCeiling"), 1);
        camera.reset();
      });

      phase = "blur clears input state";
      const afterBlur = await page.evaluate(() => {
        const { input } = window.__grakomsTest;
        document.dispatchEvent(new KeyboardEvent("keydown", { code: "ShiftLeft", bubbles: true }));
        document.dispatchEvent(new KeyboardEvent("keydown", { code: "ControlLeft", bubbles: true }));
        document.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true }));
        window.dispatchEvent(new Event("blur"));
        const { camera } = window.__grakomsTest;
        const afterBlur = {
          keys: [...input.keys], inputJump: input.jumpQueued, cameraJump: camera.jumpQueued,
          crouch: camera.crouchRequested, sprint: camera.sprinting,
          lookTimestamp: input.lookInputFilter.lastTimestamp,
        };
        input.lookInputFilter.reset(0);
        window.dispatchEvent(new Event("focus"));
        return { ...afterBlur, focusLookTimestamp: input.lookInputFilter.lastTimestamp };
      });
      assert.deepEqual(afterBlur.keys, []);
      assert.equal(afterBlur.inputJump, false);
      assert.equal(afterBlur.cameraJump, false);
      assert.equal(afterBlur.crouch, false);
      assert.equal(afterBlur.sprint, false);
      assert.ok(Number.isFinite(afterBlur.lookTimestamp), "blur clears the look filter time anchor");
      assert.ok(afterBlur.focusLookTimestamp > 0, "focus clears the stale look filter anchor");

      phase = "release and relock";
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => document.pointerLockElement !== document.querySelector("#scene-canvas"), null, { timeout: 5000 });
      const releasedState = await page.evaluate(() => ({ keys: [...window.__grakomsTest.input.keys], crouch: window.__grakomsTest.camera.crouchRequested }));
      assert.deepEqual(releasedState.keys, []);
      assert.equal(releasedState.crouch, false);
      await page.locator("#start-walk").click();
      await page.waitForFunction(() => document.pointerLockElement === document.querySelector("#scene-canvas"), null, { timeout: 5000 });
      const relockedState = await page.evaluate(() => ({
        keys: [...window.__grakomsTest.input.keys],
        jump: window.__grakomsTest.camera.jumpQueued,
        lookTimestamp: window.__grakomsTest.input.lookInputFilter.lastTimestamp,
        lockEventTimestamp: window.__lookProbe.lockTime,
      }));
      assert.deepEqual(relockedState.keys, []);
      assert.equal(relockedState.jump, false);
      assert.ok(Number.isFinite(relockedState.lookTimestamp), "relocking starts with a fresh look filter anchor");
      assert.ok(relockedState.lookTimestamp >= relockedState.lockEventTimestamp,
        "the lock transition or its following focus event leaves a fresh monotonic look anchor");
      return { lookInput, rawPointerLockRequests, walk, sprint, crouchPriority, monumentSlide, jump: { start: jumpStart.feetY, apex: jumpApex, landing: heldJumpEnd.feetY }, underCeiling, afterBlur, releasedState, relockedState };
    } catch (error) {
      throw new Error(`${phase}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      for (const key of ["w", "d", "Shift", "Control", "Space"]) await page.keyboard.up(key);
      const stillLocked = await page.evaluate(() => document.pointerLockElement === document.querySelector("#scene-canvas"));
      if (stillLocked) {
        await page.keyboard.press("Escape");
        try {
          await page.waitForFunction(() => document.pointerLockElement !== document.querySelector("#scene-canvas"), null, { timeout: 1200 });
        } catch {
          await page.evaluate(() => document.exitPointerLock?.());
          await page.waitForFunction(() => document.pointerLockElement !== document.querySelector("#scene-canvas"), null, { timeout: 2000 });
        }
      }
    }
  });

  await check("Arrow keys and wind controls set world direction; pause freezes animation time", async () => {
    await page.keyboard.press("ArrowRight");
    const keyed = await page.evaluate(() => ({
      direction: [...window.__grakomsTest.wind.direction],
      label: document.querySelector("#wind-direction").textContent,
    }));
    assert.deepEqual(keyed.direction, [1, 0]);
    assert.equal(keyed.label, "+X");

    await page.locator("[data-wind-x='0'][data-wind-z='1']").click();
    const buttonDirection = await page.evaluate(() => ({
      direction: [...window.__grakomsTest.wind.direction],
      label: document.querySelector("#wind-direction").textContent,
      selected: document.querySelector("[data-wind-x='0'][data-wind-z='1']").getAttribute("aria-pressed"),
    }));
    assert.deepEqual(buttonDirection.direction, [0, 1]);
    assert.equal(buttonDirection.label, "+Z");
    assert.equal(buttonDirection.selected, "true");

    await page.locator("#toggle-wind").click();
    const pausedAt = await page.evaluate(() => window.__grakomsTest.wind.time);
    await page.waitForTimeout(250);
    const frozenAt = await page.evaluate(() => ({
      time: window.__grakomsTest.wind.time,
      paused: window.__grakomsTest.wind.paused,
      button: document.querySelector("#toggle-wind").textContent,
    }));
    near(frozenAt.time, pausedAt, 1e-9);
    assert.equal(frozenAt.paused, true);
    assert.equal(frozenAt.button, "Resume");
    await page.locator("#toggle-wind").click();
    await page.waitForTimeout(150);
    const resumed = await page.evaluate(() => ({
      time: window.__grakomsTest.wind.time,
      paused: window.__grakomsTest.wind.paused,
    }));
    assert.equal(resumed.paused, false);
    assert.ok(resumed.time > frozenAt.time);
    return { keyed, buttonDirection, pausedAt, frozenAt, resumed };
  });

  await check("Wind weights keep leaf bases anchored and GPU geometry buffers remain static", async () => {
    const result = await page.evaluate(async () => {
      const test = window.__grakomsTest;
      const leafSets = [];
      const visit = (node) => {
        if (/WindLeafSet|ReddishNarrowLeaves|DeepRustLeaves/.test(node.name) && node.geometry) leafSets.push(node.geometry);
        for (const child of node.children) visit(child);
      };
      visit(test.scene);
      let anchoredRootVertices = 0;
      let weightedTipVertices = 0;
      for (const geometry of leafSets) {
        const node = (() => {
          const find = (candidate) => {
            if (candidate.geometry === geometry) return candidate;
            for (const child of candidate.children) {
              const match = find(child);
              if (match) return match;
            }
            return null;
          };
          return find(test.scene);
        })();
        const restore = node.objectToConstruction;
        for (let index = 0; index < geometry.windWeights.length; index += 1) {
          const offset = index * 3;
          const y = restore[1] * geometry.positions[offset]
            + restore[5] * geometry.positions[offset + 1]
            + restore[9] * geometry.positions[offset + 2]
            + restore[13];
          const weight = geometry.windWeights[index];
          if (weight === 0 && Math.abs(y) < 1e-5) anchoredRootVertices += 1;
          if (weight > 0.99 && y > 0) weightedTipVertices += 1;
        }
      }
      const auditBefore = { ...window.__gpuAudit };
      await new Promise((resolve) => setTimeout(resolve, 400));
      const auditAfter = { ...window.__gpuAudit };
      return {
        leafSetCount: leafSets.length,
        anchoredRootVertices,
        weightedTipVertices,
        meshCount: test.renderer.meshCache.size,
        auditBefore,
        auditAfter,
        textureErrors: [...test.renderer.textureErrors],
        glError: test.renderer.gl.getError(),
        contextLost: test.renderer.gl.isContextLost(),
      };
    });
    assert.ok(result.leafSetCount > 20);
    assert.ok(result.anchoredRootVertices > 100);
    assert.ok(result.weightedTipVertices > 100);
    assert.equal(result.auditBefore.bufferDataCalls, result.meshCount);
    assert.equal(result.auditBefore.staticDrawCalls, result.meshCount);
    assert.equal(result.auditBefore.nonStaticDrawCalls, 0);
    assert.equal(result.auditAfter.bufferDataCalls, result.auditBefore.bufferDataCalls);
    assert.equal(result.auditAfter.bufferSubDataCalls, 0);
    assert.deepEqual(result.textureErrors, []);
    assert.equal(result.glError, 0);
    assert.equal(result.contextLost, false);
    return result;
  });

  await check("Compiled scene shader adds directional diffuse and suppresses back-face specular", async () => {
    const result = await page.evaluate(() => {
      const { renderer } = window.__grakomsTest;
      const gl = renderer.gl;
      const locations = renderer.locations;
      const previousFramebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING);
      const previousViewport = Array.from(gl.getParameter(gl.VIEWPORT));
      const previousProgram = gl.getParameter(gl.CURRENT_PROGRAM);
      const previousVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
      const previousArrayBuffer = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
      const previousActiveTexture = gl.getParameter(gl.ACTIVE_TEXTURE);
      gl.activeTexture(gl.TEXTURE0);
      const previousTexture0 = gl.getParameter(gl.TEXTURE_BINDING_2D);
      gl.activeTexture(gl.TEXTURE1);
      const previousTexture1 = gl.getParameter(gl.TEXTURE_BINDING_2D);
      gl.activeTexture(previousActiveTexture);
      const previousDepth = gl.isEnabled(gl.DEPTH_TEST);
      const previousScissor = gl.isEnabled(gl.SCISSOR_TEST);
      const framebuffer = gl.createFramebuffer();
      const texture = gl.createTexture();
      const frontVao = gl.createVertexArray();
      const backVao = gl.createVertexArray();
      const frontBuffer = gl.createBuffer();
      const backBuffer = gl.createBuffer();
      if (!framebuffer || !texture || !frontVao || !backVao || !frontBuffer || !backBuffer) throw new Error("WebGL could not allocate the lighting fixture.");

      const lightDirection = Array.from(gl.getUniform(renderer.program, locations.lightDirection));
      const lightColor = Array.from(gl.getUniform(renderer.program, locations.lightColor));
      const normalLength = Math.hypot(...lightDirection);
      const normal = lightDirection.map((component) => component / normalLength);
      const reverseNormal = normal.map((component) => -component);
      const positions = [
        [-1, -1, 0], [3, -1, 0], [-1, 3, 0],
      ];
      const reversedPositions = [positions[0], positions[2], positions[1]];
      const vertexData = (points, vertexNormal) => {
        const data = new Float32Array(30);
        for (let vertex = 0; vertex < 3; vertex += 1) {
          const offset = vertex * 10;
          data.set(points[vertex], offset);
          data.set(vertexNormal, offset + 3);
          data[offset + 6] = 0;
          data[offset + 7] = 0;
          data[offset + 8] = 0;
          data[offset + 9] = 0;
        }
        return data;
      };
      const bindFixture = (vao, buffer, points, vertexNormal) => {
        gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, vertexData(points, vertexNormal), gl.STATIC_DRAW);
        for (const [location, size, offset] of [
          [locations.position, 3, 0], [locations.normal, 3, 12], [locations.uv, 2, 24],
          [locations.windWeight, 1, 32], [locations.windPhase, 1, 36],
        ]) {
          gl.enableVertexAttribArray(location);
          gl.vertexAttribPointer(location, size, gl.FLOAT, false, 40, offset);
        }
      };
      const identity4 = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
      const identity3 = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
      const pixels = {};
      try {
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 4, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error("Lighting fixture framebuffer is incomplete.");
        gl.readBuffer(gl.COLOR_ATTACHMENT0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.CULL_FACE);
        gl.disable(gl.BLEND);
        gl.disable(gl.STENCIL_TEST);
        gl.disable(gl.RASTERIZER_DISCARD);
        gl.enable(gl.SCISSOR_TEST);
        gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
        gl.useProgram(renderer.program);
        gl.uniformMatrix4fv(locations.model, false, identity4);
        gl.uniformMatrix4fv(locations.view, false, identity4);
        gl.uniformMatrix4fv(locations.projection, false, identity4);
        gl.uniformMatrix3fv(locations.normalMatrix, false, identity3);
        gl.uniform3fv(locations.baseColor, [1, 1, 1]);
        gl.uniform3fv(locations.lightDirection, lightDirection);
        gl.uniform3fv(locations.lightColor, lightColor);
        gl.uniform3fv(locations.cameraPosition, [0, 0, 4]);
        gl.uniform2fv(locations.uvRepeat, [1, 1]);
        gl.uniform1i(locations.hasTexture, 0);
        gl.uniform1i(locations.unlit, 0);
        gl.uniform1i(locations.diffuseTexture, 1);
        gl.uniform1f(locations.time, 0);
        gl.uniform1f(locations.windSpeed, 0);
        gl.uniform1f(locations.windAmplitude, 0);
        gl.uniform2fv(locations.windDirection, [1, 0]);
        bindFixture(frontVao, frontBuffer, positions, normal);
        bindFixture(backVao, backBuffer, reversedPositions, normal);
        gl.clearBufferfv(gl.COLOR, 0, new Float32Array([1, 0, 1, 1]));
        const clearProbe = new Uint8Array(4);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, clearProbe);

        const drawSample = (index, vao, ambient, diffuse, specular, shininess, doubleSided) => {
          gl.bindVertexArray(vao);
          gl.viewport(0, 0, 4, 1);
          gl.scissor(index, 0, 1, 1);
          gl.uniform1f(locations.ambientStrength, ambient);
          gl.uniform1f(locations.diffuseStrength, diffuse);
          gl.uniform1f(locations.specularStrength, specular);
          gl.uniform1f(locations.shininess, shininess);
          gl.uniform1i(locations.doubleSided, doubleSided ? 1 : 0);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          gl.finish();
          const pixel = new Uint8Array(4);
          gl.readPixels(index, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
          return Array.from(pixel);
        };

        pixels.frontLitDiffuse = drawSample(0, frontVao, 0.1, 0.8, 0, 8, true);
        bindFixture(frontVao, frontBuffer, positions, reverseNormal);
        pixels.backLitFace = drawSample(1, frontVao, 0.1, 0.8, 0, 8, true);
        pixels.doubleSidedBackWithSpecular = drawSample(2, backVao, 0.1, 0, 0.9, 1, true);
        pixels.doubleSidedBackWithoutSpecular = drawSample(3, backVao, 0.1, 0, 0, 1, true);
        return {
          pixels, clearProbe: Array.from(clearProbe), lightDirection, lightColor,
          framebufferStatus: gl.checkFramebufferStatus(gl.FRAMEBUFFER),
          positionLocation: locations.position,
          normalLocation: locations.normal,
          currentProgramIsScene: gl.getParameter(gl.CURRENT_PROGRAM) === renderer.program,
          glError: gl.getError(),
        };
      } finally {
        gl.bindFramebuffer(gl.FRAMEBUFFER, previousFramebuffer);
        gl.viewport(...previousViewport);
        gl.useProgram(previousProgram);
        gl.bindVertexArray(previousVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, previousArrayBuffer);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, previousTexture0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, previousTexture1);
        gl.activeTexture(previousActiveTexture);
        if (previousDepth) gl.enable(gl.DEPTH_TEST); else gl.disable(gl.DEPTH_TEST);
        if (previousScissor) gl.enable(gl.SCISSOR_TEST); else gl.disable(gl.SCISSOR_TEST);
        gl.deleteBuffer(frontBuffer);
        gl.deleteBuffer(backBuffer);
        gl.deleteVertexArray(frontVao);
        gl.deleteVertexArray(backVao);
        gl.deleteTexture(texture);
        gl.deleteFramebuffer(framebuffer);
      }
    });
    assert.ok(result.pixels.frontLitDiffuse[0] > result.pixels.backLitFace[0] + 60, `directional shader result: ${JSON.stringify(result)}`);
    assert.deepEqual(result.pixels.doubleSidedBackWithSpecular, result.pixels.doubleSidedBackWithoutSpecular, "double-sided back faces receive no specular light");
    assert.equal(result.glError, 0);
    return result;
  });

  await check("WebGL2 sky disk follows the directional light, stays angularly sized, and remains depth-occluded", async () => {
    const result = await page.evaluate(async () => {
      const { camera, renderer, config } = window.__grakomsTest;
      const direction = renderer.lightDirection;
      const yaw = Math.atan2(direction[0], -direction[2]);
      const pitch = Math.asin(direction[1]);
      const bounds = window.__grakomsTest.collisionWorld.mapBounds;
      const corners = [
        [bounds.minX + 2, bounds.minZ + 2],
        [bounds.minX + 2, bounds.maxZ - 2],
        [bounds.maxX - 2, bounds.minZ + 2],
        [bounds.maxX - 2, bounds.maxZ - 2],
      ];
      const gl = renderer.gl;
      const canvas = renderer.canvas;
      const waitFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
      const views = [];
      for (const [x, z] of corners) {
        camera.reset({ position: [x, config.camera.eyeHeight, z], yaw, pitch });
        await waitFrame();
        await waitFrame();
        const forward = camera.getForward();
        const alignment = forward.reduce((sum, component, axis) => sum + component * direction[axis], 0);
        const pixel = new Uint8Array(4);
        gl.readPixels(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        views.push({
          requested: [x, z],
          camera: [...camera.position],
          alignment,
          centerPixel: Array.from(pixel),
        });
      }
      const angularRadiusRadians = config.sun.angularDiameterDegrees * Math.PI / 360;
      const pixelRadius = canvas.height / 2
        * Math.tan(angularRadiusRadians)
        / Math.tan(config.renderer.verticalFovDegrees * Math.PI / 360);
      const center = [Math.floor(canvas.width / 2), Math.floor(canvas.height / 2)];
      const sampleSkyPixel = (radiusScale) => {
        const pixel = new Uint8Array(4);
        gl.readPixels(center[0] + Math.round(pixelRadius * radiusScale), center[1], 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        return Array.from(pixel);
      };
      const scanRadius = Math.ceil(pixelRadius + 2);
      const edgeScan = [];
      for (let offset = -scanRadius; offset <= scanRadius; offset += 1) {
        const pixel = new Uint8Array(4);
        gl.readPixels(center[0] + offset, center[1], 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        edgeScan.push({ offset, pixel: Array.from(pixel) });
      }
      const appearance = {
        projectedRadiusPixels: pixelRadius,
        center: sampleSkyPixel(0),
        innerDisk: sampleSkyPixel(0.5),
        outsideDisk: sampleSkyPixel(1.45),
        halo: sampleSkyPixel(2.3),
        clearSky: sampleSkyPixel(6.2),
        edgeScan,
      };
      const referenceCenter = views[0].centerPixel;
      const cameraRelativeInvariant = views.every((view) => view.alignment > 0.99999
        && view.centerPixel.every((channel, index) => Math.abs(channel - referenceCenter[index]) <= 1));
      const rendererState = {
        skyProgramLinked: gl.getProgramParameter(renderer.skyProgram, gl.LINK_STATUS),
        depthWriteAfterFrame: gl.getParameter(gl.DEPTH_WRITEMASK),
        blendEnabledAfterFrame: gl.isEnabled(gl.BLEND),
        depthTestEnabled: gl.isEnabled(gl.DEPTH_TEST),
        depthFunction: gl.getParameter(gl.DEPTH_FUNC),
      };
      const report = {
        direction: [...direction],
        configDirection: [...config.lighting.direction],
        angularDiameterDegrees: config.sun.angularDiameterDegrees,
        haloRadiusDegrees: config.sun.haloRadiusDegrees,
        cameraRelativeInvariant,
        appearance,
        rendererState,
        views,
        glError: gl.getError(),
      };
      const blockerColor = [0.07, 0.09, 0.12];
      const [{ SceneNode }, { createBoxGeometry, createSphereGeometry }] = await Promise.all([
        import(new URL("./src/scene-node.js", document.baseURI).href),
        import(new URL("./src/geometry.js", document.baseURI).href),
      ]);
      const blocker = new SceneNode({
        name: "TemporarySunOcclusionCheck",
        geometry: createBoxGeometry([2, 2, 2]),
        material: { color: blockerColor, unlit: true },
        position: camera.position.map((component, axis) => component + direction[axis] * 10),
      });
      renderer.prepareMeshes(blocker);
      renderer.scene.children.push(blocker);
      await waitFrame();
      await waitFrame();
      report.occlusion = {
        blockerCenter: sampleSkyPixel(0),
        blockerAtFormerHalo: sampleSkyPixel(2.3),
        expectedBlocker: blockerColor.map((component) => Math.round(Math.pow(component, 1 / 2.2) * 255)),
      };
      renderer.scene.children.splice(renderer.scene.children.indexOf(blocker), 1);

      const treeCanopy = new SceneNode({
        name: "TemporaryTreeCanopyOcclusionCheck",
        geometry: createSphereGeometry(12, 8),
        material: config.materials.treeCanopy,
        position: camera.position.map((component, axis) => component + direction[axis] * 10),
        scale: [4, 4, 4],
      });
      renderer.prepareMeshes(treeCanopy);
      renderer.scene.children.push(treeCanopy);
      await waitFrame();
      await waitFrame();
      report.occlusion.treeCanopyCenter = sampleSkyPixel(0);
      renderer.scene.children.splice(renderer.scene.children.indexOf(treeCanopy), 1);
      await waitFrame();
      return report;
    });
    const directionLength = Math.hypot(...result.configDirection);
    const expectedDirection = result.configDirection.map((component) => component / directionLength);
    result.direction.forEach((component, index) => near(component, expectedDirection[index], 1e-6));
    assert.ok(result.angularDiameterDegrees >= 1 && result.angularDiameterDegrees <= 1.5,
      "the sun disk remains within the chosen readable angular size");
    assert.equal(result.views.length, 4);
    for (const view of result.views) {
      assert.ok(view.alignment > 0.99999, "the sky disk centers on the normalized directional light");
      assert.ok(view.centerPixel[0] > 248 && view.centerPixel[1] > 240 && view.centerPixel[2] > 210,
        `the disk should render as warm white against the sky: ${JSON.stringify(view)}`);
    }
    assert.equal(result.cameraRelativeInvariant, true,
      "the disk stays in the same directional view when the camera moves across the map");
    assert.ok(result.appearance.projectedRadiusPixels >= 5 && result.appearance.projectedRadiusPixels <= 14,
      "the sun keeps its compact disk size at the captured viewport");
    assert.ok(result.appearance.center[0] > 248 && result.appearance.innerDisk[1] > 240,
      `the disk interior should remain warm white: ${JSON.stringify(result.appearance)}`);
    const edgeIsAntialiased = result.appearance.edgeScan.some(({ pixel }) =>
      pixel[0] > result.appearance.clearSky[0] + 4 && pixel[0] < result.appearance.center[0] - 8);
    assert.ok(edgeIsAntialiased, `the disk should have a soft antialiased edge: ${JSON.stringify(result.appearance.edgeScan)}`);
    assert.ok(result.appearance.halo[0] > result.appearance.clearSky[0] + 2
      && result.appearance.halo[2] < result.appearance.clearSky[2] - 2,
    `a faint warm halo should blend into the surrounding sky: ${JSON.stringify(result.appearance)}`);
    assert.equal(result.rendererState.skyProgramLinked, true);
    assert.equal(result.rendererState.depthWriteAfterFrame, true);
    assert.equal(result.rendererState.blendEnabledAfterFrame, false);
    assert.equal(result.rendererState.depthTestEnabled, true);
    assert.equal(result.rendererState.depthFunction, 515, "scene rendering retains LEQUAL depth testing");
    result.occlusion.blockerCenter.slice(0, 3).forEach((channel, index) => {
      assert.ok(Math.abs(channel - result.occlusion.expectedBlocker[index]) < 18,
        `foreground geometry should occlude the sun disk: ${JSON.stringify(result.occlusion)}`);
    });
    result.occlusion.blockerAtFormerHalo.slice(0, 3).forEach((channel, index) => {
      assert.ok(Math.abs(channel - result.occlusion.expectedBlocker[index]) < 18,
        `foreground geometry should occlude the halo: ${JSON.stringify(result.occlusion)}`);
    });
    assert.ok(result.occlusion.treeCanopyCenter[0] < result.appearance.center[0] - 80
      && result.occlusion.treeCanopyCenter[1] < result.appearance.center[1] - 60,
    `the opaque tree canopy should occlude the sky disk: ${JSON.stringify(result.occlusion)}`);
    assert.equal(result.glError, 0);

    const firstView = result.views[0];
    await page.evaluate(({ x, z, direction: lightDirection }) => {
      const { camera, config } = window.__grakomsTest;
      camera.reset({
        position: [x, config.camera.eyeHeight, z],
        yaw: Math.atan2(lightDirection[0], -lightDirection[2]),
        pitch: Math.asin(lightDirection[1]),
      });
    }, { x: firstView.requested[0], z: firstView.requested[1], direction: result.direction });
    await page.waitForTimeout(100);
    await page.screenshot({ path: evidencePath("stage-h-sun-facing.png"), fullPage: true });
    const canvasBounds = await page.locator("#scene-canvas").boundingBox();
    const cropWidth = Math.min(320, canvasBounds.width);
    const cropHeight = Math.min(250, canvasBounds.height);
    await page.screenshot({
      path: evidencePath("stage-h-sun-detail.png"),
      clip: {
        x: canvasBounds.x + (canvasBounds.width - cropWidth) / 2,
        y: canvasBounds.y + (canvasBounds.height - cropHeight) / 2,
        width: cropWidth,
        height: cropHeight,
      },
    });
    return result;
  });

  await check("Desktop resize updates the scene viewport and projection", async () => {
    await page.setViewportSize({ width: 1024, height: 960 });
    await page.waitForFunction(() => {
      const canvas = document.querySelector("#scene-canvas");
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      return canvas.width === Math.max(1, Math.round(rect.width * ratio))
        && canvas.height === Math.max(1, Math.round(rect.height * ratio));
    }, null, { timeout: 5000 });
    const result = await page.evaluate(() => {
      const canvas = document.querySelector("#scene-canvas");
      const rect = canvas.getBoundingClientRect();
      const camera = window.__grakomsTest.camera;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      return {
        cssWidth: rect.width,
        cssHeight: rect.height,
        backingWidth: canvas.width,
        backingHeight: canvas.height,
        pixelRatio: ratio,
        aspect: camera.aspect,
        expectedAspect: rect.width / rect.height,
        expectedBackingWidth: Math.round(rect.width * ratio),
        expectedBackingHeight: Math.round(rect.height * ratio),
      };
    });
    near(result.aspect, result.expectedAspect, 0.003);
    assert.equal(result.backingWidth, result.expectedBackingWidth);
    assert.equal(result.backingHeight, result.expectedBackingHeight);
    return result;
  });

  await check("Mobile stacks the scene first, keeps 16:9 panes, and has no horizontal overflow", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => {
      const canvas = document.querySelector("#scene-canvas");
      const rectangle = canvas.getBoundingClientRect();
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      return canvas.width === Math.max(1, Math.round(rectangle.width * pixelRatio))
        && canvas.height === Math.max(1, Math.round(rectangle.height * pixelRatio));
    }, null, { timeout: 5000 });
    const result = await page.evaluate(() => {
      const scene = document.querySelector(".pane--model").getBoundingClientRect();
      const reference = document.querySelector(".pane--reference").getBoundingClientRect();
      const sceneFrame = document.querySelector(".canvas-frame").getBoundingClientRect();
      const referenceFrame = document.querySelector(".reference-frame").getBoundingClientRect();
      const canvas = document.querySelector("#scene-canvas");
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      return {
        sceneTop: scene.top,
        referenceTop: reference.top,
        sceneWidth: scene.width,
        referenceWidth: reference.width,
        sceneRatio: sceneFrame.width / sceneFrame.height,
        referenceRatio: referenceFrame.width / referenceFrame.height,
        scrollWidth: document.documentElement.scrollWidth,
        viewportWidth: innerWidth,
        canvasBacking: [canvas.width, canvas.height],
        canvasCss: [canvas.getBoundingClientRect().width, canvas.getBoundingClientRect().height],
        pixelRatio,
        expectedCanvasBacking: [
          Math.max(1, Math.round(canvas.getBoundingClientRect().width * pixelRatio)),
          Math.max(1, Math.round(canvas.getBoundingClientRect().height * pixelRatio)),
        ],
      };
    });
    assert.ok(result.sceneTop < result.referenceTop);
    near(result.sceneWidth, result.referenceWidth, 1);
    near(result.sceneRatio, 16 / 9, 0.02);
    near(result.referenceRatio, 16 / 9, 0.02);
    assert.ok(result.scrollWidth <= result.viewportWidth);
    assert.deepEqual(result.canvasBacking, result.expectedCanvasBacking);
    await page.locator("[data-camera-preset='front']").click();
    await page.waitForTimeout(100);
    await page.screenshot({ path: evidencePath("stage-h-mobile.png"), fullPage: true });
    return result;
  });

  await check("No console, page, asset, or WebGL errors remain", async () => {
    const result = await page.evaluate(() => ({
      contextLost: window.__gpuAudit.contextLost || window.__grakomsTest.renderer.gl.isContextLost(),
      glError: window.__grakomsTest.renderer.gl.getError(),
      textureErrors: [...window.__grakomsTest.renderer.textureErrors],
    }));
    assert.deepEqual(consoleErrors, []);
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(failedRequests, []);
    assert.deepEqual(httpErrors, []);
    assert.equal(result.contextLost, false);
    assert.equal(result.glError, 0);
    assert.deepEqual(result.textureErrors, []);
    return { consoleErrors, pageErrors, failedRequests, canceledMediaRequests, httpErrors, ...result };
  });

  const report = {
    generatedAt: new Date().toISOString(),
    url: baseUrl,
    browser: browser.version(),
    viewportRuns: ["1440x1000", "1024x960", "390x844"],
    checks,
    summary: {
      passed: checks.filter((entry) => entry.status === "passed").length,
      failed: checks.filter((entry) => entry.status === "failed").length,
    },
  };
  writeFileSync(evidencePath("stage-h-browser-report.json"), JSON.stringify(report, null, 2) + "\n");
  process.stdout.write("Browser report: " + evidencePath("stage-h-browser-report.json") + "\n");
  process.stdout.write("Results: " + report.summary.passed + " passed, " + report.summary.failed + " failed\n");
  if (report.summary.failed > 0) process.exitCode = 1;
}

try {
  await main();
} finally {
  if (browser) await browser.close();
}
