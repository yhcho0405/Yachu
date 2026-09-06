import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { FACE_NORMALS, orientationForValue, topValue } from '../src/shared/orientations';

describe('authoritative die orientation', () => {
  it('places every requested face exactly upwards for all presentation yaw angles', () => {
    for (let value = 1; value <= 6; value++) {
      for (let i = 0; i < 72; i++) {
        const q = orientationForValue(value, (i * Math.PI) / 36);
        expect(topValue(q)).toBe(value);
        const up = new Vector3(...FACE_NORMALS[value]).applyQuaternion(q);
        expect(up.y).toBeCloseTo(1, 12);
        expect(up.x).toBeCloseTo(0, 12);
        expect(up.z).toBeCloseTo(0, 12);
        expect(q.length()).toBeCloseTo(1, 12);
      }
    }
  });
  it('keeps the opposite physical face facing down', () => {
    for (let value = 1; value <= 6; value++) {
      const down = new Vector3(...FACE_NORMALS[7 - value]).applyQuaternion(
        orientationForValue(value),
      );
      expect(down.y).toBeCloseTo(-1, 12);
    }
  });
  it('rejects unsupported faces instead of presenting a plausible wrong value', () => {
    for (const value of [0, 7, -1, 1.5, NaN]) expect(() => orientationForValue(value)).toThrow();
  });
});
