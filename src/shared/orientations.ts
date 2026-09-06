import { Quaternion, Vector3 } from 'three';

// Opposite faces add to seven. Shared by the painted geometry and orientation tests.
export const FACE_NORMALS: Readonly<Record<number, readonly [number, number, number]>> = {
  1: [0, 1, 0],
  6: [0, -1, 0],
  2: [0, 0, 1],
  5: [0, 0, -1],
  3: [1, 0, 0],
  4: [-1, 0, 0],
};

export function orientationForValue(value: number, yaw = 0): Quaternion {
  const normal = FACE_NORMALS[value];
  if (!normal) throw new RangeError('A die value must be between 1 and 6');
  const up = new Vector3(0, 1, 0);
  return new Quaternion()
    .setFromAxisAngle(up, yaw)
    .multiply(new Quaternion().setFromUnitVectors(new Vector3(...normal), up));
}

export function topValue(q: Quaternion): number {
  let best = -Infinity;
  let result = 1;
  for (const [value, normal] of Object.entries(FACE_NORMALS)) {
    const y = new Vector3(...normal).applyQuaternion(q).y;
    if (y > best) {
      best = y;
      result = Number(value);
    }
  }
  return result;
}
