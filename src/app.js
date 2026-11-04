import { CAMERA_PRESETS, CONFIG } from "./config.js";
import { Camera } from "./camera.js";
import { CollisionWorld } from "./collision.js";
import { InputController } from "./input.js";
import { CameraPositionHud } from "./hud.js";
import { Renderer } from "./renderer.js";
import { createScene } from "./scene.js";
import { WindController } from "./wind.js";

const references = {
  front: {
    kind: "photo",
    src: "./assets/reference/front-plaque.jpeg",
    alt: "Front view of the ITS monument, plaque face and plaza",
    caption: "Front view · supplied photograph",
  },
  oblique: {
    kind: "photo",
    src: "./assets/reference/oblique-plaza.jpeg",
    alt: "Three-quarter view of the monument, circular curb, gravel and square plaza pad",
    caption: "Three-quarter view · supplied photograph",
  },
  profile: {
    kind: "photo",
    src: "./assets/reference/profile-emblem.jpeg",
    alt: "Profile view showing the constructed depth along the monument emblem",
    caption: "Profile view · supplied photograph",
  },
  rear: {
    kind: "photo",
    src: "./assets/reference/rear-pedestal.jpeg",
    alt: "Rear view of the monument with its plain pedestal face",
    caption: "Rear view · supplied photograph",
  },
  emblem: {
    kind: "photo",
    src: "./assets/reference/emblem-detail.jpeg",
    alt: "Close view of the open blue gear ring, pale torch and yellow lotus emblem",
    caption: "Emblem detail · supplied photograph",
  },
  planting: {
    kind: "photo",
    src: "./assets/reference/planting.jpeg",
    alt: "Close view of the yellow-green ornamental planting around the plaza",
    caption: "Planting detail · supplied photograph",
  },
  video: {
    kind: "video",
    caption: "Front approach · supplied video",
  },
};

function setupReferenceSelector() {
  const selector = document.querySelector("#reference-select");
  const image = document.querySelector("#reference-photo");
  const video = document.querySelector("#reference-video");
  const caption = document.querySelector("#reference-caption");

  selector.addEventListener("change", () => {
    const reference = references[selector.value];
    if (!reference) return;

    const showVideo = reference.kind === "video";
    image.hidden = showVideo;
    video.hidden = !showVideo;
    if (showVideo) {
      video.load();
    } else {
      video.pause();
      image.src = reference.src;
      image.alt = reference.alt;
    }
    caption.textContent = reference.caption;
  });

  image.addEventListener("error", () => {
    caption.textContent = "Reference photo unavailable.";
  });
}

function setupCameraPresets(camera, input) {
  const buttons = [...document.querySelectorAll("[data-camera-preset]")];
  const referenceSelect = document.querySelector("#reference-select");
  const referenceByPreset = {
    front: "front",
    threeQuarter: "oblique",
    profile: "profile",
    rear: "rear",
  };
  for (const button of buttons) {
    button.addEventListener("click", () => {
      const preset = CAMERA_PRESETS[button.dataset.cameraPreset];
      if (!preset) return;
      input.clearMovementState();
      camera.reset(preset);
      const matchingReference = referenceByPreset[button.dataset.cameraPreset];
      if (matchingReference) {
        referenceSelect.value = matchingReference;
        referenceSelect.dispatchEvent(new Event("change", { bubbles: true }));
      }
      for (const candidate of buttons) {
        candidate.setAttribute("aria-pressed", String(candidate === button));
      }
    });
  }
}

function windDirectionLabel([x, z]) {
  const xLabel = Math.abs(x) < 0.1 ? "" : `${x > 0 ? "+" : "−"}X`;
  const zLabel = Math.abs(z) < 0.1 ? "" : `${z > 0 ? "+" : "−"}Z`;
  return [xLabel, zLabel].filter(Boolean).join(" · ");
}

function setupWindControls(wind) {
  const directionButtons = [...document.querySelectorAll("[data-wind-x]")];
  const directionOutput = document.querySelector("#wind-direction");
  const pauseButton = document.querySelector("#toggle-wind");

  const updateDirection = (direction) => {
    directionOutput.textContent = windDirectionLabel(direction);
    for (const button of directionButtons) {
      const buttonDirection = [Number(button.dataset.windX), Number(button.dataset.windZ)];
      const selected = Math.abs(buttonDirection[0] - direction[0]) < 0.001
        && Math.abs(buttonDirection[1] - direction[1]) < 0.001;
      button.setAttribute("aria-pressed", String(selected));
    }
  };

  for (const button of directionButtons) {
    button.addEventListener("click", () => {
      wind.setDirection([Number(button.dataset.windX), Number(button.dataset.windZ)]);
      updateDirection(wind.direction);
    });
  }
  pauseButton.addEventListener("click", () => {
    const paused = wind.togglePaused();
    pauseButton.textContent = paused ? "Resume" : "Pause";
    pauseButton.setAttribute("aria-pressed", String(paused));
  });
  updateDirection(wind.direction);
  return updateDirection;
}

function setStatus(text) {
  document.querySelector("#viewer-status").textContent = text;
}

setupReferenceSelector();

const canvas = document.querySelector("#scene-canvas");
const wind = new WindController(CONFIG.wind);
const updateWindDirection = setupWindControls(wind);

try {
  const scene = createScene();
  const collisionWorld = new CollisionWorld(scene, CONFIG.camera);
  const camera = new Camera({ collisionWorld });
  const cameraPositionHud = new CameraPositionHud(document.querySelector("#camera-position"));
  cameraPositionHud.update(camera.position);
  const input = new InputController({
    canvas,
    startButton: document.querySelector("#start-walk"),
    camera,
    wind,
    onWindChange: updateWindDirection,
    onStatus: setStatus,
  });
  setupCameraPresets(camera, input);
  const renderer = new Renderer({
    canvas, scene, camera, input, wind, onStatus: setStatus,
    onCameraPosition: (position) => cameraPositionHud.update(position),
  });
  if (new URLSearchParams(window.location.search).get("test") === "1") {
    Object.defineProperty(window, "__grakomsTest", {
      configurable: true,
      value: { camera, input, wind, renderer, scene, collisionWorld, config: CONFIG },
    });
  }
  renderer.start();
} catch (error) {
  setStatus(error instanceof Error ? error.message : "The WebGL2 scene could not start.");
  canvas.setAttribute("aria-label", "WebGL2 scene unavailable.");
  console.error(error);
}
