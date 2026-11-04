import { CONFIG } from "./config.js";
import { Mat4, normalMatrixFromMat4 } from "./math3d.js";
import { FRAGMENT_SHADER, SKY_FRAGMENT_SHADER, SKY_VERTEX_SHADER, VERTEX_SHADER } from "./shaders.js";

function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function normalize3(vector) {
  const length = Math.hypot(...vector);
  return length > 0 ? vector.map((component) => component / length) : [0, 0, 0];
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("The browser could not create a WebGL shader.");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const detail = gl.getShaderInfoLog(shader) || "No shader log was provided.";
    gl.deleteShader(shader);
    throw new Error(`Shader compilation failed: ${detail}`);
  }
  return shader;
}

function createProgram(gl, vertexSource, fragmentSource) {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!program) throw new Error("The browser could not create a WebGL program.");
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const detail = gl.getProgramInfoLog(program) || "No program log was provided.";
    gl.deleteProgram(program);
    throw new Error(`Shader linking failed: ${detail}`);
  }
  return program;
}

export class Renderer {
  constructor({ canvas, scene, camera, input, wind, onStatus, onCameraPosition }) {
    this.canvas = canvas;
    this.scene = scene;
    this.camera = camera;
    this.input = input;
    this.wind = wind;
    this.onStatus = onStatus;
    this.onCameraPosition = onCameraPosition;
    this.gl = canvas.getContext("webgl2", { antialias: true, alpha: false, depth: true });
    if (!this.gl) throw new Error("This browser did not provide a WebGL2 context.");

    this.program = createProgram(this.gl, VERTEX_SHADER, FRAGMENT_SHADER);
    this.skyProgram = createProgram(this.gl, SKY_VERTEX_SHADER, SKY_FRAGMENT_SHADER);
    this.skyVertexArray = this.gl.createVertexArray();
    if (!this.skyVertexArray) throw new Error("The browser could not allocate the sky vertex array.");
    this.meshCache = new Map();
    const lightLength = Math.hypot(...CONFIG.lighting.direction);
    if (lightLength === 0) throw new Error("The directional light requires a non-zero direction.");
    this.lightDirection = CONFIG.lighting.direction.map((component) => component / lightLength);
    this.locations = this.getLocations();
    this.skyLocations = this.getSkyLocations();
    this.whiteTexture = this.createSolidTexture([255, 255, 255, 255]);
    this.textureCache = new Map();
    this.textureErrors = [];
    this.texturePromise = this.loadTextures(CONFIG.textures);
    this.prepareMeshes(scene);
    this.gl.enable(this.gl.DEPTH_TEST);
    this.gl.depthFunc(this.gl.LEQUAL);
    this.gl.clearColor(...CONFIG.renderer.clearColor);

    this.resizePending = true;
    this.lastFrameTime = 0;
    this.resizeObserver = new ResizeObserver(() => { this.resizePending = true; });
    this.resizeObserver.observe(canvas);
    window.addEventListener("resize", () => { this.resizePending = true; });
  }

  getLocations() {
    const gl = this.gl;
    const program = this.program;
    return {
      position: gl.getAttribLocation(program, "a_position"),
      normal: gl.getAttribLocation(program, "a_normal"),
      uv: gl.getAttribLocation(program, "a_uv"),
      windWeight: gl.getAttribLocation(program, "a_windWeight"),
      windPhase: gl.getAttribLocation(program, "a_windPhase"),
      model: gl.getUniformLocation(program, "u_model"),
      view: gl.getUniformLocation(program, "u_view"),
      projection: gl.getUniformLocation(program, "u_projection"),
      normalMatrix: gl.getUniformLocation(program, "u_normalMatrix"),
      baseColor: gl.getUniformLocation(program, "u_baseColor"),
      lightDirection: gl.getUniformLocation(program, "u_lightDirection"),
      lightColor: gl.getUniformLocation(program, "u_lightColor"),
      cameraPosition: gl.getUniformLocation(program, "u_cameraPosition"),
      ambientStrength: gl.getUniformLocation(program, "u_ambientStrength"),
      diffuseStrength: gl.getUniformLocation(program, "u_diffuseStrength"),
      shininess: gl.getUniformLocation(program, "u_shininess"),
      specularStrength: gl.getUniformLocation(program, "u_specularStrength"),
      uvRepeat: gl.getUniformLocation(program, "u_uvRepeat"),
      hasTexture: gl.getUniformLocation(program, "u_hasTexture"),
      doubleSided: gl.getUniformLocation(program, "u_doubleSided"),
      unlit: gl.getUniformLocation(program, "u_unlit"),
      diffuseTexture: gl.getUniformLocation(program, "u_diffuseTexture"),
      time: gl.getUniformLocation(program, "u_time"),
      windSpeed: gl.getUniformLocation(program, "u_windSpeed"),
      windAmplitude: gl.getUniformLocation(program, "u_windAmplitude"),
      windDirection: gl.getUniformLocation(program, "u_windDirection"),
    };
  }

  getSkyLocations() {
    const gl = this.gl;
    const program = this.skyProgram;
    return {
      cameraForward: gl.getUniformLocation(program, "u_cameraForward"),
      cameraRight: gl.getUniformLocation(program, "u_cameraRight"),
      cameraUp: gl.getUniformLocation(program, "u_cameraUp"),
      sunDirection: gl.getUniformLocation(program, "u_sunDirection"),
      skyTopColor: gl.getUniformLocation(program, "u_skyTopColor"),
      skyHorizonColor: gl.getUniformLocation(program, "u_skyHorizonColor"),
      sunColor: gl.getUniformLocation(program, "u_sunColor"),
      haloColor: gl.getUniformLocation(program, "u_haloColor"),
      viewSize: gl.getUniformLocation(program, "u_viewSize"),
      tanHalfFov: gl.getUniformLocation(program, "u_tanHalfFov"),
      sunAngularRadius: gl.getUniformLocation(program, "u_sunAngularRadius"),
      haloAngularRadius: gl.getUniformLocation(program, "u_haloAngularRadius"),
      haloIntensity: gl.getUniformLocation(program, "u_haloIntensity"),
      haloFalloff: gl.getUniformLocation(program, "u_haloFalloff"),
    };
  }

  createSolidTexture(pixel) {
    const gl = this.gl;
    const texture = gl.createTexture();
    if (!texture) throw new Error("The browser could not allocate a WebGL texture.");
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(pixel));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return texture;
  }

  loadTextures(sources) {
    const gl = this.gl;
    const loads = Object.entries(sources).map(([name, url]) => new Promise((resolve) => {
      const texture = this.createSolidTexture([255, 255, 255, 255]);
      this.textureCache.set(name, texture);
      const image = new Image();
      image.onload = () => {
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, image);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.bindTexture(gl.TEXTURE_2D, null);
        resolve();
      };
      image.onerror = () => {
        this.textureErrors.push(name);
        resolve();
      };
      image.src = new URL(url, document.baseURI).href;
    }));
    return Promise.all(loads);
  }

  prepareMeshes(node) {
    if (node.geometry && !this.meshCache.has(node.geometry)) {
      const gl = this.gl;
      const geometry = node.geometry;
      const interleaved = new Float32Array(geometry.vertexCount * 10);
      for (let vertex = 0; vertex < geometry.vertexCount; vertex += 1) {
        const source = vertex * 3;
        const uvSource = vertex * 2;
        const target = vertex * 10;
        interleaved[target] = geometry.positions[source];
        interleaved[target + 1] = geometry.positions[source + 1];
        interleaved[target + 2] = geometry.positions[source + 2];
        interleaved[target + 3] = geometry.normals[source];
        interleaved[target + 4] = geometry.normals[source + 1];
        interleaved[target + 5] = geometry.normals[source + 2];
        interleaved[target + 6] = geometry.uvs[uvSource];
        interleaved[target + 7] = geometry.uvs[uvSource + 1];
        interleaved[target + 8] = geometry.windWeights[vertex];
        interleaved[target + 9] = geometry.windPhases[vertex];
      }

      const vao = gl.createVertexArray();
      const buffer = gl.createBuffer();
      if (!vao || !buffer) throw new Error("The browser could not allocate scene geometry buffers.");
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, interleaved, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(this.locations.position);
      gl.vertexAttribPointer(this.locations.position, 3, gl.FLOAT, false, 40, 0);
      gl.enableVertexAttribArray(this.locations.normal);
      gl.vertexAttribPointer(this.locations.normal, 3, gl.FLOAT, false, 40, 12);
      gl.enableVertexAttribArray(this.locations.uv);
      gl.vertexAttribPointer(this.locations.uv, 2, gl.FLOAT, false, 40, 24);
      gl.enableVertexAttribArray(this.locations.windWeight);
      gl.vertexAttribPointer(this.locations.windWeight, 1, gl.FLOAT, false, 40, 32);
      gl.enableVertexAttribArray(this.locations.windPhase);
      gl.vertexAttribPointer(this.locations.windPhase, 1, gl.FLOAT, false, 40, 36);
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      this.meshCache.set(geometry, { vao, vertexCount: geometry.vertexCount });
    }
    for (const child of node.children) this.prepareMeshes(child);
  }

  resize() {
    const rectangle = this.canvas.getBoundingClientRect();
    if (rectangle.width <= 0 || rectangle.height <= 0) return false;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, CONFIG.renderer.maxPixelRatio);
    const width = Math.max(1, Math.round(rectangle.width * pixelRatio));
    const height = Math.max(1, Math.round(rectangle.height * pixelRatio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.resizePending = true;
    }
    if (this.resizePending) {
      this.gl.viewport(0, 0, width, height);
      this.camera.setAspect(width / height);
      this.resizePending = false;
    }
    return true;
  }

  drawSky() {
    const gl = this.gl;
    const locations = this.skyLocations;
    const forward = this.camera.getForward();
    const right = normalize3(cross3(forward, [0, 1, 0]));
    const up = normalize3(cross3(right, forward));

    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.BLEND);
    gl.useProgram(this.skyProgram);
    gl.bindVertexArray(this.skyVertexArray);
    gl.uniform3fv(locations.cameraForward, forward);
    gl.uniform3fv(locations.cameraRight, right);
    gl.uniform3fv(locations.cameraUp, up);
    gl.uniform3fv(locations.sunDirection, this.lightDirection);
    gl.uniform3fv(locations.skyTopColor, CONFIG.renderer.clearColor.slice(0, 3));
    gl.uniform3fv(locations.skyHorizonColor, CONFIG.renderer.horizonColor);
    gl.uniform3fv(locations.sunColor, CONFIG.sun.color);
    gl.uniform3fv(locations.haloColor, CONFIG.sun.haloColor);
    gl.uniform2f(locations.viewSize, this.canvas.width, this.canvas.height);
    gl.uniform1f(locations.tanHalfFov, Math.tan(CONFIG.renderer.verticalFovDegrees * Math.PI / 360));
    gl.uniform1f(locations.sunAngularRadius, CONFIG.sun.angularDiameterDegrees * Math.PI / 360);
    gl.uniform1f(locations.haloAngularRadius, CONFIG.sun.haloRadiusDegrees * Math.PI / 180);
    gl.uniform1f(locations.haloIntensity, CONFIG.sun.haloIntensity);
    gl.uniform1f(locations.haloFalloff, CONFIG.sun.haloFalloff);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
  }

  drawNode(node, parentWorld) {
    if (!node.visible) return;
    const gl = this.gl;
    const world = node.worldMatrix(parentWorld);
    if (node.geometry && node.material) {
      const mesh = this.meshCache.get(node.geometry);
      gl.bindVertexArray(mesh.vao);
      gl.uniformMatrix4fv(this.locations.model, false, node.worldGeometryMatrix(parentWorld));
      // The intrinsic geometry scale is uniform; keep its magnitude out of the
      // normal matrix so world-space wind bending retains its previous strength.
      gl.uniformMatrix3fv(this.locations.normalMatrix, false, normalMatrixFromMat4(world));
      gl.uniform3fv(this.locations.baseColor, node.material.color);
      gl.uniform1f(this.locations.shininess, node.material.shininess ?? CONFIG.lighting.shininess);
      gl.uniform1f(this.locations.specularStrength, node.material.specular ?? CONFIG.lighting.defaultSpecular);
      gl.uniform2fv(this.locations.uvRepeat, node.material.textureRepeat ?? [1, 1]);
      gl.uniform1i(this.locations.doubleSided, node.material.doubleSided ? 1 : 0);
      gl.uniform1i(this.locations.unlit, node.material.unlit ? 1 : 0);
      const textured = Boolean(node.material.texture);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, textured ? this.textureCache.get(node.material.texture) : this.whiteTexture);
      gl.uniform1i(this.locations.diffuseTexture, 0);
      gl.uniform1i(this.locations.hasTexture, textured ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, mesh.vertexCount);
    }
    for (const child of node.children) this.drawNode(child, world);
  }

  renderFrame = (timestamp) => {
    const deltaSeconds = this.lastFrameTime === 0
      ? 0
      : Math.min((timestamp - this.lastFrameTime) / 1000, 0.05);
    this.lastFrameTime = timestamp;
    this.input.update(deltaSeconds);
    this.onCameraPosition?.(this.camera.position);
    this.wind.update(deltaSeconds);

    if (this.resize()) {
      const gl = this.gl;
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      this.drawSky();
      gl.useProgram(this.program);
      gl.uniformMatrix4fv(this.locations.view, false, this.camera.viewMatrix());
      gl.uniformMatrix4fv(this.locations.projection, false, this.camera.projectionMatrix());
      gl.uniform3fv(this.locations.lightDirection, this.lightDirection);
      gl.uniform3fv(this.locations.lightColor, CONFIG.lighting.color);
      gl.uniform3fv(this.locations.cameraPosition, this.camera.position);
      gl.uniform1f(this.locations.ambientStrength, CONFIG.lighting.ambientStrength);
      gl.uniform1f(this.locations.diffuseStrength, CONFIG.lighting.diffuseStrength);
      gl.uniform1f(this.locations.time, this.wind.time);
      gl.uniform1f(this.locations.windSpeed, this.wind.speed);
      gl.uniform1f(this.locations.windAmplitude, this.wind.amplitude);
      gl.uniform2fv(this.locations.windDirection, this.wind.direction);
      this.drawNode(this.scene, Mat4.identity());
      gl.bindVertexArray(null);
    }
    requestAnimationFrame(this.renderFrame);
  };

  start() {
    this.onStatus("Loading local surfaces…");
    this.texturePromise.then(() => {
      if (!this.input.locked) {
        this.onStatus(this.textureErrors.length === 0
          ? "WebGL2 ready · free camera."
          : "WebGL2 ready · some local textures unavailable.");
      }
      requestAnimationFrame(this.renderFrame);
    });
  }
}
