// Compact column-major helpers based on the supplied course practical math3d.js.
// Multiplication here follows the conventional a * b order for column vectors.
export function degToRad(degrees) {
  return (degrees * Math.PI) / 180;
}

export const Mat4 = {
  identity() {
    return new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ]);
  },

  translation(x, y, z) {
    return new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      x, y, z, 1,
    ]);
  },

  rotationX(radians) {
    const c = Math.cos(radians);
    const s = Math.sin(radians);
    return new Float32Array([
      1, 0, 0, 0,
      0, c, s, 0,
      0, -s, c, 0,
      0, 0, 0, 1,
    ]);
  },

  rotationY(radians) {
    const c = Math.cos(radians);
    const s = Math.sin(radians);
    return new Float32Array([
      c, 0, -s, 0,
      0, 1, 0, 0,
      s, 0, c, 0,
      0, 0, 0, 1,
    ]);
  },

  rotationZ(radians) {
    const c = Math.cos(radians);
    const s = Math.sin(radians);
    return new Float32Array([
      c, s, 0, 0,
      -s, c, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ]);
  },

  scaling(x, y, z) {
    return new Float32Array([
      x, 0, 0, 0,
      0, y, 0, 0,
      0, 0, z, 0,
      0, 0, 0, 1,
    ]);
  },

  multiply(a, b) {
    const out = new Float32Array(16);
    for (let column = 0; column < 4; column += 1) {
      for (let row = 0; row < 4; row += 1) {
        out[column * 4 + row] =
          a[row] * b[column * 4] +
          a[4 + row] * b[column * 4 + 1] +
          a[8 + row] * b[column * 4 + 2] +
          a[12 + row] * b[column * 4 + 3];
      }
    }
    return out;
  },

  lookAt(eye, target, up) {
    let zx = eye[0] - target[0];
    let zy = eye[1] - target[1];
    let zz = eye[2] - target[2];
    let length = Math.hypot(zx, zy, zz) || 1;
    zx /= length;
    zy /= length;
    zz /= length;

    let xx = up[1] * zz - up[2] * zy;
    let xy = up[2] * zx - up[0] * zz;
    let xz = up[0] * zy - up[1] * zx;
    length = Math.hypot(xx, xy, xz) || 1;
    xx /= length;
    xy /= length;
    xz /= length;

    const yx = zy * xz - zz * xy;
    const yy = zz * xx - zx * xz;
    const yz = zx * xy - zy * xx;

    return new Float32Array([
      xx, yx, zx, 0,
      xy, yy, zy, 0,
      xz, yz, zz, 0,
      -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
      -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
      -(zx * eye[0] + zy * eye[1] + zz * eye[2]),
      1,
    ]);
  },

  perspective(verticalFov, aspect, near, far) {
    const f = 1 / Math.tan(verticalFov / 2);
    const nf = 1 / (near - far);
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) * nf, -1,
      0, 0, 2 * far * near * nf, 0,
    ]);
  },
};

export function normalMatrixFromMat4(matrix) {
  const a00 = matrix[0], a01 = matrix[4], a02 = matrix[8];
  const a10 = matrix[1], a11 = matrix[5], a12 = matrix[9];
  const a20 = matrix[2], a21 = matrix[6], a22 = matrix[10];

  const c00 = a11 * a22 - a12 * a21;
  const c01 = a12 * a20 - a10 * a22;
  const c02 = a10 * a21 - a11 * a20;
  const c10 = a02 * a21 - a01 * a22;
  const c11 = a00 * a22 - a02 * a20;
  const c12 = a01 * a20 - a00 * a21;
  const c20 = a01 * a12 - a02 * a11;
  const c21 = a02 * a10 - a00 * a12;
  const c22 = a00 * a11 - a01 * a10;
  const determinant = a00 * c00 + a01 * c01 + a02 * c02;

  if (Math.abs(determinant) < 1e-8) {
    return new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  }

  const inverseDeterminant = 1 / determinant;
  return new Float32Array([
    c00 * inverseDeterminant, c10 * inverseDeterminant, c20 * inverseDeterminant,
    c01 * inverseDeterminant, c11 * inverseDeterminant, c21 * inverseDeterminant,
    c02 * inverseDeterminant, c12 * inverseDeterminant, c22 * inverseDeterminant,
  ]);
}

export function composeTransform(position, rotationDegrees, scale) {
  const [rx, ry, rz] = rotationDegrees.map(degToRad);
  let result = Mat4.translation(position[0], position[1], position[2]);
  result = Mat4.multiply(result, Mat4.rotationY(ry));
  result = Mat4.multiply(result, Mat4.rotationX(rx));
  result = Mat4.multiply(result, Mat4.rotationZ(rz));
  return Mat4.multiply(result, Mat4.scaling(scale[0], scale[1], scale[2]));
}
