import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { FACE_NORMALS, topValue } from '../src/shared/orientations';
import {
  BOARD_FLOOR,
  DIE_RADIUS,
  DIE_SIZE,
  REST_Y,
  lanePosition,
  rollHeight,
  rollQuaternion,
} from '../src/client/games/tikatuka/motion';

function lowestRoundedPoint(q: Quaternion): number {
  let lowest = Infinity;
  const core = DIE_SIZE / 2 - DIE_RADIUS;
  for (const x of [-core, core])
    for (const y of [-core, core])
      for (const z of [-core, core])
        lowest = Math.min(lowest, new Vector3(x, y, z).applyQuaternion(q).y - DIE_RADIUS);
  return lowest;
}

describe('Tikatuka rendered dice', () => {
  it('keeps every rounded corner above the wood and continuously settles to every authoritative face', () => {
    for (let value = 1; value <= 6; value++) {
      for (let step = 0; step <= 700; step++) {
        const t = step / 700,
          q = rollQuaternion(value, t);
        expect(rollHeight(t, q) + lowestRoundedPoint(q)).toBeGreaterThanOrEqual(
          BOARD_FLOOR - 1e-10,
        );
        expect(q.length()).toBeCloseTo(1, 12);
      }
      const final = rollQuaternion(value, 1),
        before = rollQuaternion(value, 1 - 1e-6);
      expect(topValue(final)).toBe(value);
      expect(new Vector3(...FACE_NORMALS[value]).applyQuaternion(final).y).toBeCloseTo(1, 12);
      expect(before.angleTo(final)).toBeLessThan(1e-6);
      expect(rollHeight(1, final)).toBeCloseTo(REST_Y, 12);
    }
  });
  it('keeps eighteen occupied board slots separate in both presentation layouts with stable corresponding lanes', () => {
    for (const rotation of [0, Math.PI / 2]) {
      const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), rotation);
      const positions = [];
      for (const side of [-1, 1] as const)
        for (const lane of [0, 1, 2] as const)
          for (let slot = 0; slot < 3; slot++) {
            const p = lanePosition(side, lane, slot).applyQuaternion(q);
            expect(p.y).toBeCloseTo(REST_Y, 12);
            positions.push(p);
            const opposite = lanePosition(side === -1 ? 1 : -1, lane, slot).applyQuaternion(q);
            if (rotation === 0) expect(p.z).toBeCloseTo(opposite.z, 12);
            else expect(p.x).toBeCloseTo(opposite.x, 12);
          }
      for (let a = 0; a < positions.length; a++)
        for (let b = a + 1; b < positions.length; b++)
          expect(positions[a].distanceTo(positions[b])).toBeGreaterThan(DIE_SIZE + 0.25);
    }
  });
});
