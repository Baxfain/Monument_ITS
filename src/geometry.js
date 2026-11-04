function createBuffers() {
  return { positions: [], normals: [], uvs: [], windWeights: [], windPhases: [] };
}

function pushTriangle(buffers, a, b, c, normal, uvs = null) {
  const points = [a, b, c];
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    buffers.positions.push(point[0], point[1], point[2]);
    buffers.normals.push(normal[0], normal[1], normal[2]);
    const uv = uvs?.[index] ?? [0, 0];
    buffers.uvs.push(uv[0], uv[1]);
    buffers.windWeights.push(0);
    buffers.windPhases.push(0);
  }
}

function pushQuad(buffers, a, b, c, d, normal, uvs = null) {
  pushTriangle(buffers, a, b, c, normal, uvs ? [uvs[0], uvs[1], uvs[2]] : null);
  pushTriangle(buffers, a, c, d, normal, uvs ? [uvs[0], uvs[2], uvs[3]] : null);
}

function finish(buffers) {
  return {
    positions: new Float32Array(buffers.positions),
    normals: new Float32Array(buffers.normals),
    uvs: new Float32Array(buffers.uvs),
    windWeights: new Float32Array(buffers.windWeights),
    windPhases: new Float32Array(buffers.windPhases),
    vertexCount: buffers.positions.length / 3,
  };
}

export function createBoxGeometry(dimensions = [1, 1, 1]) {
  const buffers = createBuffers();
  const uvFor = (point, axes) => [
    (point[axes[0]] + 0.5) * dimensions[axes[0]],
    (point[axes[1]] + 0.5) * dimensions[axes[1]],
  ];
  const faces = [
    { normal: [0, 0, 1], axes: [0, 1], points: [[-.5, -.5, .5], [.5, -.5, .5], [.5, .5, .5], [-.5, .5, .5]] },
    { normal: [0, 0, -1], axes: [0, 1], points: [[.5, -.5, -.5], [-.5, -.5, -.5], [-.5, .5, -.5], [.5, .5, -.5]] },
    { normal: [-1, 0, 0], axes: [2, 1], points: [[-.5, -.5, -.5], [-.5, -.5, .5], [-.5, .5, .5], [-.5, .5, -.5]] },
    { normal: [1, 0, 0], axes: [2, 1], points: [[.5, -.5, .5], [.5, -.5, -.5], [.5, .5, -.5], [.5, .5, .5]] },
    { normal: [0, 1, 0], axes: [0, 2], points: [[-.5, .5, .5], [.5, .5, .5], [.5, .5, -.5], [-.5, .5, -.5]] },
    { normal: [0, -1, 0], axes: [0, 2], points: [[-.5, -.5, -.5], [.5, -.5, -.5], [.5, -.5, .5], [-.5, -.5, .5]] },
  ];
  for (const face of faces) {
    pushQuad(buffers, ...face.points, face.normal, face.points.map(point => uvFor(point, face.axes)));
  }
  return finish(buffers);
}

export function createDiscGeometry(radius = 1, segments = 48) {
  const buffers = createBuffers();
  const center = [0, 0, 0];
  for (let index = 0; index < segments; index += 1) {
    const a0 = (index / segments) * Math.PI * 2;
    const a1 = ((index + 1) / segments) * Math.PI * 2;
    const current = [Math.cos(a0) * radius, 0, Math.sin(a0) * radius];
    const next = [Math.cos(a1) * radius, 0, Math.sin(a1) * radius];
    pushTriangle(buffers, center, next, current, [0, 1, 0], [[0, 0], [next[0], next[2]], [current[0], current[2]]]);
  }
  return finish(buffers);
}

export function createRingPrismGeometry(innerRadius, outerRadius, height, segments = 64) {
  const buffers = createBuffers();
  const halfHeight = height / 2;
  const point = (radius, angle, y) => [Math.cos(angle) * radius, y, Math.sin(angle) * radius];

  for (let index = 0; index < segments; index += 1) {
    const a0 = (index / segments) * Math.PI * 2;
    const a1 = ((index + 1) / segments) * Math.PI * 2;
    const middle = (a0 + a1) / 2;
    const o0Top = point(outerRadius, a0, halfHeight);
    const o1Top = point(outerRadius, a1, halfHeight);
    const i0Top = point(innerRadius, a0, halfHeight);
    const i1Top = point(innerRadius, a1, halfHeight);
    const o0Bottom = point(outerRadius, a0, -halfHeight);
    const o1Bottom = point(outerRadius, a1, -halfHeight);
    const i0Bottom = point(innerRadius, a0, -halfHeight);
    const i1Bottom = point(innerRadius, a1, -halfHeight);

    const planarUv = point => [point[0], point[2]];
    const sideUv = (radius, angle, y) => [radius * angle, y + halfHeight];
    pushQuad(buffers, o0Top, i0Top, i1Top, o1Top, [0, 1, 0], [o0Top, i0Top, i1Top, o1Top].map(planarUv));
    pushQuad(buffers, o0Bottom, o1Bottom, i1Bottom, i0Bottom, [0, -1, 0], [o0Bottom, o1Bottom, i1Bottom, i0Bottom].map(planarUv));
    pushQuad(buffers, o0Bottom, o0Top, o1Top, o1Bottom, [Math.cos(middle), 0, Math.sin(middle)], [sideUv(outerRadius, a0, -halfHeight), sideUv(outerRadius, a0, halfHeight), sideUv(outerRadius, a1, halfHeight), sideUv(outerRadius, a1, -halfHeight)]);
    pushQuad(buffers, i0Top, i0Bottom, i1Bottom, i1Top, [-Math.cos(middle), 0, -Math.sin(middle)], [sideUv(innerRadius, a0, halfHeight), sideUv(innerRadius, a0, -halfHeight), sideUv(innerRadius, a1, -halfHeight), sideUv(innerRadius, a1, halfHeight)]);
  }

  return finish(buffers);
}

export function createAnnularSectorPrismGeometry(innerRadius, outerRadius, height, startAngle, endAngle, segments = 32) {
  if (
    ![innerRadius, outerRadius, height, startAngle, endAngle, segments].every(Number.isFinite)
    || innerRadius <= 0
    || outerRadius <= innerRadius
    || height <= 0
    || endAngle <= startAngle
    || segments < 1
  ) {
    throw new Error("An annular sector needs valid radii, height, angles, and segments.");
  }

  const buffers = createBuffers();
  const halfHeight = height / 2;
  const count = Math.max(1, Math.ceil(segments * (endAngle - startAngle) / (Math.PI * 2)));
  const point = (radius, angle, y) => [Math.sin(angle) * radius, y, Math.cos(angle) * radius];
  const planarUv = ([x, , z]) => [x, z];

  for (let index = 0; index < count; index += 1) {
    const a0 = startAngle + ((endAngle - startAngle) * index) / count;
    const a1 = startAngle + ((endAngle - startAngle) * (index + 1)) / count;
    const middle = (a0 + a1) / 2;
    const i0Top = point(innerRadius, a0, halfHeight);
    const i1Top = point(innerRadius, a1, halfHeight);
    const o0Top = point(outerRadius, a0, halfHeight);
    const o1Top = point(outerRadius, a1, halfHeight);
    const i0Bottom = point(innerRadius, a0, -halfHeight);
    const i1Bottom = point(innerRadius, a1, -halfHeight);
    const o0Bottom = point(outerRadius, a0, -halfHeight);
    const o1Bottom = point(outerRadius, a1, -halfHeight);

    pushQuad(buffers, i0Top, o0Top, o1Top, i1Top, [0, 1, 0], [i0Top, o0Top, o1Top, i1Top].map(planarUv));
    pushQuad(buffers, i0Bottom, i1Bottom, o1Bottom, o0Bottom, [0, -1, 0], [i0Bottom, i1Bottom, o1Bottom, o0Bottom].map(planarUv));
    pushQuad(
      buffers,
      o0Bottom,
      o1Bottom,
      o1Top,
      o0Top,
      [Math.sin(middle), 0, Math.cos(middle)],
    );
    pushQuad(
      buffers,
      i0Top,
      i1Top,
      i1Bottom,
      i0Bottom,
      [-Math.sin(middle), 0, -Math.cos(middle)],
    );
  }

  const startInnerBottom = point(innerRadius, startAngle, -halfHeight);
  const startOuterBottom = point(outerRadius, startAngle, -halfHeight);
  const startOuterTop = point(outerRadius, startAngle, halfHeight);
  const startInnerTop = point(innerRadius, startAngle, halfHeight);
  pushQuad(
    buffers,
    startInnerBottom,
    startOuterBottom,
    startOuterTop,
    startInnerTop,
    [-Math.cos(startAngle), 0, Math.sin(startAngle)],
  );

  const endInnerBottom = point(innerRadius, endAngle, -halfHeight);
  const endOuterBottom = point(outerRadius, endAngle, -halfHeight);
  const endOuterTop = point(outerRadius, endAngle, halfHeight);
  const endInnerTop = point(innerRadius, endAngle, halfHeight);
  pushQuad(
    buffers,
    endOuterBottom,
    endInnerBottom,
    endInnerTop,
    endOuterTop,
    [Math.cos(endAngle), 0, -Math.sin(endAngle)],
  );

  return finish(buffers);
}

export function createVerticalRingGeometry(innerRadius, outerRadius, depth, startAngle = 0, endAngle = Math.PI * 2, segments = 32) {
  const buffers = createBuffers();
  const halfDepth = depth / 2;
  const point = (radius, angle, z) => [Math.cos(angle) * radius, Math.sin(angle) * radius, z];
  const count = Math.max(1, Math.ceil(segments * (endAngle - startAngle) / (Math.PI * 2)));

  for (let index = 0; index < count; index += 1) {
    const a0 = startAngle + ((endAngle - startAngle) * index) / count;
    const a1 = startAngle + ((endAngle - startAngle) * (index + 1)) / count;
    const middle = (a0 + a1) / 2;
    const o0f = point(outerRadius, a0, halfDepth);
    const o1f = point(outerRadius, a1, halfDepth);
    const i0f = point(innerRadius, a0, halfDepth);
    const i1f = point(innerRadius, a1, halfDepth);
    const o0b = point(outerRadius, a0, -halfDepth);
    const o1b = point(outerRadius, a1, -halfDepth);
    const i0b = point(innerRadius, a0, -halfDepth);
    const i1b = point(innerRadius, a1, -halfDepth);

    pushQuad(buffers, o0f, o1f, i1f, i0f, [0, 0, 1]);
    pushQuad(buffers, o0b, i0b, i1b, o1b, [0, 0, -1]);
    pushQuad(buffers, o0f, o0b, o1b, o1f, [Math.cos(middle), Math.sin(middle), 0]);
    pushQuad(buffers, i0f, i1f, i1b, i0b, [-Math.cos(middle), -Math.sin(middle), 0]);

    if (index === 0) {
      const tangent = [Math.sin(a0), -Math.cos(a0), 0];
      pushQuad(buffers, o0f, i0f, i0b, o0b, tangent);
    }
    if (index === count - 1) {
      const tangent = [-Math.sin(a1), Math.cos(a1), 0];
      pushQuad(buffers, o1f, o1b, i1b, i1f, tangent);
    }
  }

  return finish(buffers);
}

export function createVerticalGearRingGeometry({
  innerRadius,
  baseRadius,
  toothRadius,
  depth,
  startAngle = 0,
  endAngle = Math.PI * 2,
  toothCount = 8,
  samplesPerTooth = 32,
}) {
  const buffers = createBuffers();
  const halfDepth = depth / 2;
  const period = (Math.PI * 2) / toothCount;
  const toothHalfWidth = period * 0.28;
  const rampWidth = period * 0.05;
  const count = Math.max(2, Math.ceil(((endAngle - startAngle) / (Math.PI * 2)) * toothCount * samplesPerTooth));
  const point = (radius, angle, z) => [Math.cos(angle) * radius, Math.sin(angle) * radius, z];
  const outerRadiusAt = (angle) => {
    const wrapped = ((angle + period / 2) % period + period) % period - period / 2;
    const distance = Math.abs(wrapped);
    if (distance <= toothHalfWidth) return toothRadius;
    if (distance >= toothHalfWidth + rampWidth) return baseRadius;
    const blend = 1 - (distance - toothHalfWidth) / rampWidth;
    return baseRadius + (toothRadius - baseRadius) * blend;
  };

  for (let index = 0; index < count; index += 1) {
    const a0 = startAngle + ((endAngle - startAngle) * index) / count;
    const a1 = startAngle + ((endAngle - startAngle) * (index + 1)) / count;
    const middle = (a0 + a1) / 2;
    const outer0 = outerRadiusAt(a0);
    const outer1 = outerRadiusAt(a1);
    const o0f = point(outer0, a0, halfDepth);
    const o1f = point(outer1, a1, halfDepth);
    const i0f = point(innerRadius, a0, halfDepth);
    const i1f = point(innerRadius, a1, halfDepth);
    const o0b = point(outer0, a0, -halfDepth);
    const o1b = point(outer1, a1, -halfDepth);
    const i0b = point(innerRadius, a0, -halfDepth);
    const i1b = point(innerRadius, a1, -halfDepth);

    pushQuad(buffers, o0f, o1f, i1f, i0f, [0, 0, 1]);
    pushQuad(buffers, o0b, i0b, i1b, o1b, [0, 0, -1]);
    pushQuad(buffers, o0f, o0b, o1b, o1f, [Math.cos(middle), Math.sin(middle), 0]);
    pushQuad(buffers, i0f, i1f, i1b, i0b, [-Math.cos(middle), -Math.sin(middle), 0]);

    if (index === 0 && endAngle - startAngle < Math.PI * 2 - 1e-5) {
      pushQuad(buffers, o0f, i0f, i0b, o0b, [-Math.sin(a0), Math.cos(a0), 0]);
    }
    if (index === count - 1 && endAngle - startAngle < Math.PI * 2 - 1e-5) {
      pushQuad(buffers, o1f, o1b, i1b, i1f, [Math.sin(a1), -Math.cos(a1), 0]);
    }
  }

  return finish(buffers);
}

export function createExtrudedPolygonGeometry(points, depth = 0.025) {
  if (points.length < 3) throw new Error("An extruded polygon needs at least three points.");
  const buffers = createBuffers();
  const halfDepth = depth / 2;
  const center = points.reduce((sum, point) => [sum[0] + point[0] / points.length, sum[1] + point[1] / points.length], [0, 0]);
  const frontCenter = [center[0], center[1], halfDepth];
  const backCenter = [center[0], center[1], -halfDepth];

  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const frontCurrent = [current[0], current[1], halfDepth];
    const frontNext = [next[0], next[1], halfDepth];
    const backCurrent = [current[0], current[1], -halfDepth];
    const backNext = [next[0], next[1], -halfDepth];
    const edgeX = next[0] - current[0];
    const edgeY = next[1] - current[1];
    const edgeLength = Math.hypot(edgeX, edgeY) || 1;
    const sideNormal = [edgeY / edgeLength, -edgeX / edgeLength, 0];

    pushTriangle(buffers, frontCenter, frontCurrent, frontNext, [0, 0, 1]);
    pushTriangle(buffers, backCenter, backNext, backCurrent, [0, 0, -1]);
    pushQuad(buffers, frontCurrent, backCurrent, backNext, frontNext, sideNormal);
  }

  return finish(buffers);
}

function cubicPoint(start, control1, control2, end, amount) {
  const inverse = 1 - amount;
  const a = inverse * inverse * inverse;
  const b = 3 * inverse * inverse * amount;
  const c = 3 * inverse * amount * amount;
  const d = amount * amount * amount;
  return [
    a * start[0] + b * control1[0] + c * control2[0] + d * end[0],
    a * start[1] + b * control1[1] + c * control2[1] + d * end[1],
  ];
}

function cross2D(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function signedArea(points) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current[0] * next[1] - next[0] * current[1];
  }
  return area * 0.5;
}

function pointInsideTriangle(point, a, b, c, epsilon) {
  return cross2D(a, b, point) > epsilon
    && cross2D(b, c, point) > epsilon
    && cross2D(c, a, point) > epsilon;
}

function tessellateContour(sourcePoints) {
  const points = [];
  for (const point of sourcePoints) {
    if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
      throw new Error("A contour must contain finite x/y coordinates.");
    }
    const previous = points.at(-1);
    if (!previous || Math.hypot(point[0] - previous[0], point[1] - previous[1]) > 1e-8) {
      points.push(point);
    }
  }
  if (points.length > 2 && Math.hypot(points[0][0] - points.at(-1)[0], points[0][1] - points.at(-1)[1]) <= 1e-8) {
    points.pop();
  }
  if (points.length < 3) throw new Error("An extruded contour needs at least three unique points.");

  const area = signedArea(points);
  if (!Number.isFinite(area) || Math.abs(area) < 1e-8) throw new Error("An extruded contour needs nonzero area.");
  if (area < 0) points.reverse();

  const epsilon = Math.max(1e-11, Math.abs(area) * 1e-10);
  const remaining = points.map((_, index) => index);
  const triangles = [];
  const maxAttempts = points.length * points.length;
  let attempts = 0;
  while (remaining.length > 3 && attempts < maxAttempts) {
    let foundEar = false;
    for (let index = 0; index < remaining.length; index += 1) {
      const previousIndex = remaining[(index + remaining.length - 1) % remaining.length];
      const currentIndex = remaining[index];
      const nextIndex = remaining[(index + 1) % remaining.length];
      const a = points[previousIndex];
      const b = points[currentIndex];
      const c = points[nextIndex];
      if (cross2D(a, b, c) <= epsilon) continue;

      let containsVertex = false;
      for (const candidateIndex of remaining) {
        if (candidateIndex === previousIndex || candidateIndex === currentIndex || candidateIndex === nextIndex) continue;
        if (pointInsideTriangle(points[candidateIndex], a, b, c, epsilon)) {
          containsVertex = true;
          break;
        }
      }
      if (containsVertex) continue;

      triangles.push([previousIndex, currentIndex, nextIndex]);
      remaining.splice(index, 1);
      foundEar = true;
      break;
    }

    attempts += 1;
    if (!foundEar) {
      throw new Error("An extruded contour could not be triangulated; check it for self-intersections.");
    }
  }
  triangles.push([remaining[0], remaining[1], remaining[2]]);
  return { points, triangles };
}

/** Extrude a sampled, potentially concave XY contour with outward planar side faces. */
export function createExtrudedContourGeometry(sourcePoints, depth = 0.008) {
  if (!Number.isFinite(depth) || depth <= 0) throw new Error("Contour depth must be finite and positive.");
  const { points, triangles } = tessellateContour(sourcePoints);
  const buffers = createBuffers();
  const halfDepth = depth / 2;

  for (const [first, second, third] of triangles) {
    const a = points[first];
    const b = points[second];
    const c = points[third];
    pushTriangle(buffers, [a[0], a[1], halfDepth], [b[0], b[1], halfDepth], [c[0], c[1], halfDepth], [0, 0, 1]);
    pushTriangle(buffers, [c[0], c[1], -halfDepth], [b[0], b[1], -halfDepth], [a[0], a[1], -halfDepth], [0, 0, -1]);
  }

  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const edgeX = next[0] - current[0];
    const edgeY = next[1] - current[1];
    const edgeLength = Math.hypot(edgeX, edgeY);
    if (edgeLength <= 1e-8) throw new Error("An extruded contour cannot contain a zero-length edge.");
    const sideNormal = [edgeY / edgeLength, -edgeX / edgeLength, 0];
    pushQuad(
      buffers,
      [current[0], current[1], halfDepth],
      [current[0], current[1], -halfDepth],
      [next[0], next[1], -halfDepth],
      [next[0], next[1], halfDepth],
      sideNormal,
    );
  }
  return finish(buffers);
}

function outlineContour(sourcePoints, expansion) {
  const points = tessellateContour(sourcePoints).points;
  const outline = [];
  for (let index = 0; index < points.length; index += 1) {
    const previous = points[(index + points.length - 1) % points.length];
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const previousLength = Math.hypot(current[0] - previous[0], current[1] - previous[1]);
    const nextLength = Math.hypot(next[0] - current[0], next[1] - current[1]);
    if (previousLength <= 1e-8 || nextLength <= 1e-8) throw new Error("An outlined contour cannot contain a zero-length edge.");

    const previousNormal = [(current[1] - previous[1]) / previousLength, -(current[0] - previous[0]) / previousLength];
    const nextNormal = [(next[1] - current[1]) / nextLength, -(next[0] - current[0]) / nextLength];
    const sumX = previousNormal[0] + nextNormal[0];
    const sumY = previousNormal[1] + nextNormal[1];
    const sumLength = Math.hypot(sumX, sumY);
    if (sumLength <= 1e-8) {
      outline.push(
        [current[0] + previousNormal[0] * expansion, current[1] + previousNormal[1] * expansion],
        [current[0] + nextNormal[0] * expansion, current[1] + nextNormal[1] * expansion],
      );
      continue;
    }

    const miterX = sumX / sumLength;
    const miterY = sumY / sumLength;
    const denominator = miterX * previousNormal[0] + miterY * previousNormal[1];
    const turn = cross2D(previous, current, next);
    const miterLength = denominator > 1e-6 ? expansion / denominator : Infinity;
    if (turn <= 0 || miterLength > expansion * 2.5) {
      outline.push(
        [current[0] + previousNormal[0] * expansion, current[1] + previousNormal[1] * expansion],
        [current[0] + nextNormal[0] * expansion, current[1] + nextNormal[1] * expansion],
      );
    } else {
      outline.push([current[0] + miterX * miterLength, current[1] + miterY * miterLength]);
    }
  }
  return outline;
}

function sampleEmblemPetalContour(profile, width, height, mirrorX, curveSegments) {
  if (![width, height, mirrorX, curveSegments].every(Number.isFinite)
    || width <= 0 || height <= 0 || Math.abs(mirrorX) !== 1 || !Number.isInteger(curveSegments) || curveSegments < 3) {
    throw new Error("An emblem petal requires a valid contour, positive dimensions, and curve resolution.");
  }

  const contour = [];
  const transform = ([x, y]) => [x * width * mirrorX, y * height];

  if (Array.isArray(profile?.points)) {
    if (profile.points.length < 3 || !profile.points.every((point) =>
      Array.isArray(point) && point.length === 2 && point.every(Number.isFinite))) {
      throw new Error("Each traced emblem petal needs at least three finite normalized points.");
    }
    return profile.points.map(transform);
  }

  if (!Array.isArray(profile?.start) || profile.start.length !== 2
    || !profile.start.every(Number.isFinite)
    || !Array.isArray(profile?.segments) || profile.segments.length < 2) {
    throw new Error("An emblem petal requires a valid contour, positive dimensions, and curve resolution.");
  }

  let current = profile.start;
  contour.push(transform(current));
  for (let segmentIndex = 0; segmentIndex < profile.segments.length; segmentIndex += 1) {
    const segment = profile.segments[segmentIndex];
    if (![segment.control1, segment.control2, segment.end].every((point) =>
      Array.isArray(point) && point.length === 2 && point.every(Number.isFinite))) {
      throw new Error("Each petal curve needs finite normalized cubic control points.");
    }
    if (segmentIndex === profile.segments.length - 1
      && Math.hypot(segment.end[0] - profile.start[0], segment.end[1] - profile.start[1]) > 1e-6) {
      throw new Error("The last petal curve must close at its starting point.");
    }
    for (let sample = 1; sample <= curveSegments; sample += 1) {
      if (segmentIndex === profile.segments.length - 1 && sample === curveSegments) continue;
      contour.push(transform(cubicPoint(current, segment.control1, segment.control2, segment.end, sample / curveSegments)));
    }
    current = segment.end;
  }
  return contour;
}

/** Build a 3D emblem petal from normalized cubic curves or traced contour points. */
export function createEmblemPetalGeometry(profile, width, height, depth = 0.008, mirrorX = 1, curveSegments = 18) {
  if (!Number.isFinite(depth) || depth <= 0) throw new Error("Petal depth must be finite and positive.");
  const contour = sampleEmblemPetalContour(profile, width, height, mirrorX, curveSegments);
  return createExtrudedContourGeometry(contour, depth);
}

/** Pair a traced 3D petal face with a constant-width, bevel-joined contour. */
export function createOutlinedEmblemPetal(profile, width, height, depth, mirrorX, outlineWidth, curveSegments = 18) {
  if (![depth, outlineWidth].every(Number.isFinite) || depth <= 0 || outlineWidth <= 0) {
    throw new Error("Outlined emblem petals need positive extrusion depth and outline width.");
  }
  const contour = sampleEmblemPetalContour(profile, width, height, mirrorX, curveSegments);
  return {
    fill: createExtrudedContourGeometry(contour, depth),
    outline: createExtrudedContourGeometry(outlineContour(contour, outlineWidth), depth),
  };
}

export function createSphereGeometry(longitudeSegments = 16, latitudeSegments = 10) {
  const buffers = createBuffers();
  const point = (longitude, latitude) => {
    const y = Math.cos(latitude);
    const ringRadius = Math.sin(latitude);
    const x = ringRadius * Math.cos(longitude);
    const z = ringRadius * Math.sin(longitude);
    return {
      position: [x * 0.5, y * 0.5, z * 0.5],
      normal: [x, y, z],
      uv: [longitude / (Math.PI * 2), latitude / Math.PI],
    };
  };

  for (let row = 0; row < latitudeSegments; row += 1) {
    const p0 = (row / latitudeSegments) * Math.PI;
    const p1 = ((row + 1) / latitudeSegments) * Math.PI;
    for (let column = 0; column < longitudeSegments; column += 1) {
      const t0 = (column / longitudeSegments) * Math.PI * 2;
      const t1 = ((column + 1) / longitudeSegments) * Math.PI * 2;
      const a = point(t0, p0);
      const b = point(t0, p1);
      const c = point(t1, p1);
      const d = point(t1, p0);
      for (const [first, second, third] of [[a, b, c], [a, c, d]]) {
        for (const vertex of [first, second, third]) {
          buffers.positions.push(...vertex.position);
          buffers.normals.push(...vertex.normal);
          buffers.uvs.push(...vertex.uv);
          buffers.windWeights.push(0);
          buffers.windPhases.push(0);
        }
      }
    }
  }
  return finish(buffers);
}

export function createLeafClusterGeometry(leaves, longitudinalSegments = 12, crossSegments = 4) {
  const buffers = createBuffers();
  for (const leaf of leaves) {
    const directionX = Math.cos(leaf.angle);
    const directionZ = Math.sin(leaf.angle);
    const sideX = -directionZ;
    const sideZ = directionX;
    const normalLength = Math.hypot(sideX * 0.9 + directionX * 0.18, 0.12, sideZ * 0.9 + directionZ * 0.18);
    const normal = [
      (sideX * 0.9 + directionX * 0.18) / normalLength,
      0.12 / normalLength,
      (sideZ * 0.9 + directionZ * 0.18) / normalLength,
    ];
    const grid = [];

    for (let row = 0; row <= longitudinalSegments; row += 1) {
      const t = row / longitudinalSegments;
      const easedT = t * t * (3 - 2 * t);
      const width = leaf.width
        * (0.15 + 0.85 * Math.sin(t * Math.PI * 0.82))
        * Math.pow(Math.max(0, 1 - t), 0.48);
      const bend = leaf.bend * easedT;
      const height = leaf.height * (t - 0.06 * t * t);
      const rowVertices = [];

      for (let column = 0; column <= crossSegments; column += 1) {
        const across = (column / crossSegments) * 2 - 1;
        const ridge = width * 0.12 * (1 - across * across);
        const base = leaf.base ?? [0, 0];
        rowVertices.push({
          position: [
            base[0] + directionX * (bend + ridge) + sideX * across * width / 2,
            height,
            base[1] + directionZ * (bend + ridge) + sideZ * across * width / 2,
          ],
          normal,
          uv: [column / crossSegments, t],
          windWeight: easedT,
          windPhase: leaf.phase,
        });
      }
      grid.push(rowVertices);
    }

    const appendTriangle = (a, b, c) => {
      for (const vertex of [a, b, c]) {
        buffers.positions.push(...vertex.position);
        buffers.normals.push(...vertex.normal);
        buffers.uvs.push(...vertex.uv);
        buffers.windWeights.push(vertex.windWeight);
        buffers.windPhases.push(vertex.windPhase);
      }
    };

    for (let row = 0; row < longitudinalSegments; row += 1) {
      for (let column = 0; column < crossSegments; column += 1) {
        const a = grid[row][column];
        const b = grid[row + 1][column];
        const c = grid[row + 1][column + 1];
        const d = grid[row][column + 1];
        appendTriangle(a, b, c);
        appendTriangle(a, c, d);
      }
    }
  }

  return finish(buffers);
}

export function createTrianglePadGeometry(points, thickness = 0) {
  const buffers = createBuffers();
  if (thickness <= 0) {
    const vertices = points.map(([x, z]) => [x, 0, z]);
    pushTriangle(buffers, ...vertices, [0, 1, 0], points);
    return finish(buffers);
  }

  const halfThickness = thickness / 2;
  const area = points.reduce((sum, [x, z], index) => {
    const [nextX, nextZ] = points[(index + 1) % points.length];
    return sum + x * nextZ - nextX * z;
  }, 0);
  const winding = Math.sign(area) || 1;
  const top = points.map(([x, z]) => [x, halfThickness, z]);
  const bottom = points.map(([x, z]) => [x, -halfThickness, z]);

  pushTriangle(buffers, ...top, [0, 1, 0], points);
  pushTriangle(buffers, bottom[0], bottom[2], bottom[1], [0, -1, 0], [points[0], points[2], points[1]]);
  for (let index = 0; index < points.length; index += 1) {
    const nextIndex = (index + 1) % points.length;
    const [x, z] = points[index];
    const [nextX, nextZ] = points[nextIndex];
    const edgeX = nextX - x;
    const edgeZ = nextZ - z;
    const edgeLength = Math.hypot(edgeX, edgeZ) || 1;
    const normal = [winding * edgeZ / edgeLength, 0, winding * -edgeX / edgeLength];
    pushQuad(
      buffers,
      top[index],
      top[nextIndex],
      bottom[nextIndex],
      bottom[index],
      normal,
    );
  }
  return finish(buffers);
}
