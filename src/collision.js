import { CONFIG } from "./config.js";
import { Mat4, normalMatrixFromMat4 } from "./math3d.js";

const EPSILON = 1e-5;
const geometryBoundsCache = new WeakMap();

function localBounds(geometry) {
  let bounds = geometryBoundsCache.get(geometry);
  if (bounds) return bounds;
  bounds = { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
  for (let index = 0; index < geometry.positions.length; index += 3) {
    bounds.minX = Math.min(bounds.minX, geometry.positions[index]);
    bounds.minY = Math.min(bounds.minY, geometry.positions[index + 1]);
    bounds.minZ = Math.min(bounds.minZ, geometry.positions[index + 2]);
    bounds.maxX = Math.max(bounds.maxX, geometry.positions[index]);
    bounds.maxY = Math.max(bounds.maxY, geometry.positions[index + 1]);
    bounds.maxZ = Math.max(bounds.maxZ, geometry.positions[index + 2]);
  }
  geometryBoundsCache.set(geometry, bounds);
  return bounds;
}

function transformPoint(matrix, x, y, z) {
  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
    matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
    matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
  ];
}

function transformNormal(matrix, x, y, z) {
  const nx = matrix[0] * x + matrix[3] * y + matrix[6] * z;
  const ny = matrix[1] * x + matrix[4] * y + matrix[7] * z;
  const nz = matrix[2] * x + matrix[5] * y + matrix[8] * z;
  const length = Math.hypot(nx, ny, nz) || 1;
  return [nx / length, ny / length, nz / length];
}

function worldBounds(geometry, matrix) {
  const local = localBounds(geometry);
  const result = { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
  for (const x of [local.minX, local.maxX]) {
    for (const y of [local.minY, local.maxY]) {
      for (const z of [local.minZ, local.maxZ]) {
        const point = transformPoint(matrix, x, y, z);
        result.minX = Math.min(result.minX, point[0]);
        result.minY = Math.min(result.minY, point[1]);
        result.minZ = Math.min(result.minZ, point[2]);
        result.maxX = Math.max(result.maxX, point[0]);
        result.maxY = Math.max(result.maxY, point[1]);
        result.maxZ = Math.max(result.maxZ, point[2]);
      }
    }
  }
  return result;
}

function closestPointOnSegment2D(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const denominator = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / denominator));
  return [ax + t * dx, az + t * dz];
}

function pointInTriangleXZ(x, z, triangle) {
  const [a, b, c] = triangle.points;
  const denominator = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
  if (Math.abs(denominator) < EPSILON) return null;
  const wa = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / denominator;
  const wb = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / denominator;
  const wc = 1 - wa - wb;
  if (wa < -EPSILON || wb < -EPSILON || wc < -EPSILON) return null;
  return wa * a[1] + wb * b[1] + wc * c[1];
}

function triangleContainsCircle(triangle, x, z, radius) {
  if (pointInTriangleXZ(x, z, triangle) !== null) return true;
  const [a, b, c] = triangle.points;
  const radiusSquared = radius * radius;
  for (const point of [a, b, c]) {
    const dx = point[0] - x;
    const dz = point[2] - z;
    if (dx * dx + dz * dz <= radiusSquared) return true;
  }
  for (const [from, to] of [[a, b], [b, c], [c, a]]) {
    const closest = closestPointOnSegment2D(x, z, from[0], from[2], to[0], to[2]);
    const dx = closest[0] - x;
    const dz = closest[1] - z;
    if (dx * dx + dz * dz <= radiusSquared) return true;
  }
  return false;
}

function annulusRadii(geometry) {
  let innerRadius = Infinity;
  let outerRadius = 0;
  for (let index = 0; index < geometry.positions.length; index += 3) {
    const radius = Math.hypot(geometry.positions[index], geometry.positions[index + 2]);
    innerRadius = Math.min(innerRadius, radius);
    outerRadius = Math.max(outerRadius, radius);
  }
  return { innerRadius, outerRadius };
}

function horizontalPenetration(collider, x, z, radius) {
  if (collider.shape === "annulus") {
    const distance = Math.hypot(x - collider.center[0], z - collider.center[2]);
    return Math.max(0, Math.min(distance + radius - collider.innerRadius, collider.outerRadius + radius - distance));
  }
  const nearestX = Math.max(collider.bounds.minX, Math.min(collider.bounds.maxX, x));
  const nearestZ = Math.max(collider.bounds.minZ, Math.min(collider.bounds.maxZ, z));
  const dx = x - nearestX;
  const dz = z - nearestZ;
  const distance = Math.hypot(dx, dz);
  if (distance > EPSILON) return Math.max(0, radius - distance);
  const escapeDistance = Math.min(
    x - collider.bounds.minX,
    collider.bounds.maxX - x,
    z - collider.bounds.minZ,
    collider.bounds.maxZ - z,
  );
  return radius + Math.max(0, escapeDistance);
}

function verticalOverlap(collider, feetY, bodyHeight) {
  return feetY < collider.bounds.maxY - EPSILON
    && feetY + bodyHeight > collider.bounds.minY + EPSILON;
}

export class CollisionWorld {
  constructor(root, settings = CONFIG.camera) {
    this.settings = settings;
    this.colliders = [];
    this.surfaces = [];
    this.mapBounds = null;
    this.colliderByName = new Map();
    this.#build(root, Mat4.identity());
    if (!this.mapBounds) throw new Error("CollisionWorld requires the rendered GroundPlane perimeter metadata.");
  }

  #build(node, parentWorld) {
    const world = Mat4.multiply(parentWorld, node.localMatrix());
    if (node.geometry && node.collision) {
      const bounds = worldBounds(node.geometry, world);
      if (node.collision.perimeter) this.mapBounds = bounds;
      if (node.collision.solid) {
        const collider = { name: node.name, bounds, shape: node.collision.shape ?? "box" };
        if (collider.shape === "annulus") {
          const radii = annulusRadii(node.geometry);
          const scaleX = Math.hypot(world[0], world[2]);
          const scaleZ = Math.hypot(world[8], world[10]);
          const radiusScale = (scaleX + scaleZ) / 2;
          collider.innerRadius = radii.innerRadius * radiusScale;
          collider.outerRadius = radii.outerRadius * radiusScale;
          collider.center = transformPoint(world, 0, 0, 0);
        }
        this.colliders.push(collider);
        this.colliderByName.set(node.name, collider);
      }
      if (node.collision.surface) this.#addSurfaceTriangles(node, world);
    }
    for (const child of node.children) this.#build(child, world);
  }

  #addSurfaceTriangles(node, world) {
    const positions = node.geometry.positions;
    const normals = node.geometry.normals;
    const normalMatrix = normalMatrixFromMat4(world);
    for (let index = 0; index < positions.length; index += 9) {
      const points = [];
      let nx = 0;
      let ny = 0;
      let nz = 0;
      for (let vertex = 0; vertex < 3; vertex += 1) {
        const offset = index + vertex * 3;
        points.push(transformPoint(world, positions[offset], positions[offset + 1], positions[offset + 2]));
        const normalOffset = offset;
        const normal = transformNormal(normalMatrix, normals[normalOffset], normals[normalOffset + 1], normals[normalOffset + 2]);
        nx += normal[0];
        ny += normal[1];
        nz += normal[2];
      }
      const length = Math.hypot(nx, ny, nz) || 1;
      if (ny / length < 0.65) continue;
      const triangle = {
        name: node.name,
        points,
        minX: Math.min(...points.map((point) => point[0])),
        maxX: Math.max(...points.map((point) => point[0])),
        minZ: Math.min(...points.map((point) => point[2])),
        maxZ: Math.max(...points.map((point) => point[2])),
        minY: Math.min(...points.map((point) => point[1])),
        maxY: Math.max(...points.map((point) => point[1])),
      };
      if (Math.abs((points[1][0] - points[0][0]) * (points[2][2] - points[0][2]) - (points[1][2] - points[0][2]) * (points[2][0] - points[0][0])) > EPSILON) {
        this.surfaces.push(triangle);
      }
    }
  }

  clampToMap(x, z, radius = this.settings.collisionRadius) {
    return {
      x: Math.max(this.mapBounds.minX + radius, Math.min(this.mapBounds.maxX - radius, x)),
      z: Math.max(this.mapBounds.minZ + radius, Math.min(this.mapBounds.maxZ - radius, z)),
    };
  }

  findSurface(x, z, radius, minY = -Infinity, maxY = Infinity) {
    const offsets = [[0, 0]];
    if (radius > 0) {
      for (let index = 0; index < 8; index += 1) {
        const angle = (index / 8) * Math.PI * 2;
        offsets.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
      }
    }
    let best = null;
    for (const triangle of this.surfaces) {
      if (triangle.maxX < x - radius || triangle.minX > x + radius || triangle.maxZ < z - radius || triangle.minZ > z + radius) continue;
      for (const [offsetX, offsetZ] of offsets) {
        const sampleX = x + offsetX;
        const sampleZ = z + offsetZ;
        if (sampleX < triangle.minX - EPSILON || sampleX > triangle.maxX + EPSILON || sampleZ < triangle.minZ - EPSILON || sampleZ > triangle.maxZ + EPSILON) continue;
        const height = pointInTriangleXZ(sampleX, sampleZ, triangle);
        if (height === null || height < minY - EPSILON || height > maxY + EPSILON) continue;
        if (!best || height > best.y) best = { y: height, name: triangle.name };
      }
    }
    for (const collider of this.colliders) {
      const height = collider.bounds.maxY;
      if (height < minY - EPSILON || height > maxY + EPSILON) continue;
      if (horizontalPenetration(collider, x, z, radius) <= EPSILON) continue;
      if (!best || height > best.y) best = { y: height, name: collider.name };
    }
    return best;
  }

  canOccupy(x, z, feetY, bodyHeight, radius = this.settings.collisionRadius) {
    const clamped = this.clampToMap(x, z, radius);
    if (Math.abs(clamped.x - x) > EPSILON || Math.abs(clamped.z - z) > EPSILON) return false;
    return !this.colliders.some((collider) => verticalOverlap(collider, feetY, bodyHeight)
      && horizontalPenetration(collider, x, z, radius) > EPSILON);
  }

  hasHeadroom(x, z, feetY, bodyHeight, radius = this.settings.collisionRadius) {
    return this.canOccupy(x, z, feetY, bodyHeight, radius);
  }

  findSafeSpawn(x, z, radius, bodyHeight) {
    const start = this.clampToMap(x, z, radius);
    const offsets = [[0, 0]];
    for (let distance = 0.2; distance <= 2.001; distance += 0.2) {
      for (let index = 0; index < 16; index += 1) {
        const angle = (index / 16) * Math.PI * 2;
        offsets.push([Math.cos(angle) * distance, Math.sin(angle) * distance]);
      }
    }
    for (const [offsetX, offsetZ] of offsets) {
      const candidate = this.clampToMap(start.x + offsetX, start.z + offsetZ, radius);
      const surface = this.findSurface(candidate.x, candidate.z, radius, -0.2, 0.3);
      if (surface && this.canOccupy(candidate.x, candidate.z, surface.y, bodyHeight, radius)) {
        return { x: candidate.x, z: candidate.z, feetY: surface.y };
      }
    }
    throw new Error("No safe ground spawn was found near the requested camera preset.");
  }

  #tryAxis(position, axis, delta, body, maxStepHeight) {
    if (Math.abs(delta) < EPSILON) return;
    const nextX = axis === "x" ? position.x + delta : position.x;
    const nextZ = axis === "z" ? position.z + delta : position.z;
    const clamped = this.clampToMap(nextX, nextZ, body.radius);
    const x = axis === "x" ? clamped.x : nextX;
    const z = axis === "z" ? clamped.z : nextZ;
    if (this.#canMoveTo(position, x, z, position.feetY, body)) {
      position.x = x;
      position.z = z;
      return;
    }
    if (body.canStep) {
      const step = this.findSurface(x, z, body.radius, position.feetY + EPSILON, position.feetY + maxStepHeight);
      if (step && this.canOccupy(x, z, step.y, body.height, body.radius)) {
        position.x = x;
        position.z = z;
        position.feetY = step.y;
      }
    }
  }

  #canMoveTo(position, x, z, feetY, body) {
    const clamped = this.clampToMap(x, z, body.radius);
    if (Math.abs(clamped.x - x) > EPSILON || Math.abs(clamped.z - z) > EPSILON) return false;
    for (const collider of this.colliders) {
      if (!verticalOverlap(collider, feetY, body.height)) continue;
      const nextPenetration = horizontalPenetration(collider, x, z, body.radius);
      if (nextPenetration <= EPSILON) continue;
      const currentPenetration = verticalOverlap(collider, position.feetY, body.height)
        ? horizontalPenetration(collider, position.x, position.z, body.radius)
        : 0;
      if (nextPenetration > currentPenetration + 1e-4) return false;
    }
    return true;
  }

  moveHorizontal(x, z, dx, dz, { feetY, bodyHeight, radius = this.settings.collisionRadius, maxStepHeight = this.settings.maxStepHeight } = {}) {
    const start = this.clampToMap(x, z, radius);
    const position = { x: start.x, z: start.z, feetY };
    const distance = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(distance / this.settings.collisionSubstep));
    const stepX = dx / steps;
    const stepZ = dz / steps;
    const support = this.findSurface(start.x, start.z, radius, feetY - EPSILON, feetY + EPSILON);
    const body = {
      height: bodyHeight,
      radius,
      canStep: Boolean(support && Math.abs(support.y - feetY) <= EPSILON),
    };
    for (let index = 0; index < steps; index += 1) {
      this.#tryAxis(position, "x", stepX, body, maxStepHeight);
      this.#tryAxis(position, "z", stepZ, body, maxStepHeight);
    }
    return position;
  }

  resolveVertical(x, z, oldFeetY, nextFeetY, bodyHeight, radius = this.settings.collisionRadius) {
    if (nextFeetY < oldFeetY) {
      const surface = this.findSurface(x, z, radius, nextFeetY - EPSILON, oldFeetY + EPSILON);
      if (surface) return { feetY: surface.y, grounded: true, hitHead: false };
    }
    if (nextFeetY > oldFeetY) {
      for (const collider of this.colliders) {
        if (horizontalPenetration(collider, x, z, radius) <= EPSILON) continue;
        const oldHead = oldFeetY + bodyHeight;
        const nextHead = nextFeetY + bodyHeight;
        if (oldHead <= collider.bounds.minY + EPSILON && nextHead > collider.bounds.minY) {
          return { feetY: collider.bounds.minY - bodyHeight, grounded: false, hitHead: true };
        }
        if (verticalOverlap(collider, oldFeetY, bodyHeight) && !this.canOccupy(x, z, nextFeetY, bodyHeight, radius)) {
          return { feetY: oldFeetY, grounded: false, hitHead: true };
        }
      }
    }
    return { feetY: nextFeetY, grounded: false, hitHead: false };
  }
}
