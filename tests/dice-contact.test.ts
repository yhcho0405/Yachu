import { describe, expect, it } from 'vitest';
import { Euler, Quaternion, Vector3 } from 'three';
import {
  CONTACT_TIME,
  constrainContact,
  contactRollQuaternion,
  dieSupport,
} from '../src/client/dice-contact';
import { orientationForValue, topValue } from '../src/shared/orientations';

const lanes = [0.46, 1.1, 0.16, 1.08, 0.4];
// Independent corner projection checks the support equation against the actual rounded solid.
function extent(q: Quaternion, axis: Vector3) {
  let maximum = -Infinity;
  for (const x of [-0.38, 0.38])
    for (const y of [-0.38, 0.38])
      for (const z of [-0.38, 0.38])
        maximum = Math.max(maximum, new Vector3(x, y, z).applyQuaternion(q).dot(axis));
  return maximum + 0.095;
}
function separated(a: Vector3, qa: Quaternion, b: Vector3, qb: Quaternion) {
  const axesA = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)].map((v) =>
    v.applyQuaternion(qa),
  );
  const axesB = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)].map((v) =>
    v.applyQuaternion(qb),
  );
  const axes = [...axesA, ...axesB, new Vector3(1, 0, 0)];
  for (const x of axesA)
    for (const y of axesB)
      if (x.clone().cross(y).lengthSq() > 1e-10) axes.push(x.clone().cross(y).normalize());
  return axes.some(
    (axis) => Math.abs(b.clone().sub(a).dot(axis)) >= extent(qa, axis) + extent(qb, axis) - 1e-8,
  );
}

describe('physical launch contact', () => {
  it('has matching tilted faces in real side contact, with continuous quaternion endpoints and authoritative final values', () => {
    for (let value = 1; value <= 6; value++) {
      const from = orientationForValue(7 - value, -0.22),
        to = orientationForValue(value, 0.22);
      expect(contactRollQuaternion(from, to, 0).angleTo(from)).toBeLessThan(1e-7);
      expect(contactRollQuaternion(from, to, 1).angleTo(to)).toBeLessThan(1e-7);
      expect(topValue(contactRollQuaternion(from, to, 1))).toBe(value);
      for (const t of [0.2, 0.22])
        expect(
          contactRollQuaternion(from, to, t - 1e-8).angleTo(
            contactRollQuaternion(from, to, t + 1e-8),
          ),
        ).toBeLessThan(1e-5);
      const q = contactRollQuaternion(from, to, CONTACT_TIME);
      const a = new Vector3(-3.6, 2, 0.46),
        b = new Vector3(3.6, 2.2, 0.4);
      constrainContact(a, q, b, q, CONTACT_TIME);
      expect(b.x - a.x).toBeCloseTo(0.95, 12);
      expect(a.y).toBe(b.y);
      expect(a.z).toBe(b.z);
      expect(dieSupport(q, 0)).toBeCloseTo(extent(q, new Vector3(1, 0, 0)), 12);
    }
  });

  it('keeps every rolling subset clear of every other die and the floor, including rolls immediately after releasing shelf dice', () => {
    for (let mask = 1; mask < 32; mask++) {
      const ids = [0, 1, 2, 3, 4].filter((id) => mask & (1 << id));
      const pair = ids.length >= 2 ? ids.slice(0, 2) : [];
      for (const fromShelf of [false, true])
        for (let step = 0; step <= 200; step++) {
          const t = step / 200,
            p = 1 - (1 - t) ** 3;
          const poses = [0, 1, 2, 3, 4].map((id) => {
            const held = !ids.includes(id);
            const from = orientationForValue(1, fromShelf || held ? 0 : (id - 2) * 0.11);
            const to = orientationForValue(id + 2 > 6 ? 1 : id + 2, (id - 2) * 0.11);
            if (held)
              return { position: new Vector3((id - 2) * 1.8, 0.8525, -2.36), q: from, held };
            const q = pair.includes(id)
              ? contactRollQuaternion(from, to, t)
              : new Quaternion()
                  .slerpQuaternions(from, to, p)
                  .multiply(
                    new Quaternion().setFromEuler(
                      new Euler(4 * Math.PI * p, 2 * Math.PI * p, 6 * Math.PI * p),
                    ),
                  );
            const bounce =
              t < 0.45
                ? 1.1 * Math.sin((Math.PI * t) / 0.45)
                : t < 0.73
                  ? 0.34 * Math.sin((Math.PI * (t - 0.45)) / 0.28)
                  : t < 0.91
                    ? 0.1 * Math.sin((Math.PI * (t - 0.73)) / 0.18)
                    : 0;
            const position = new Vector3(
              (id - 2) * 1.8 + Math.sin(t * Math.PI * 2 + id) * Math.sin(t * Math.PI) * 0.065,
              0.185 + dieSupport(q, 1) + Math.max(0, bounce) + (fromShelf ? 0.1925 : 0) * (1 - p),
              (fromShelf ? -2.36 + (lanes[id] + 2.36) * p : lanes[id]) +
                Math.sin(Math.PI * t) * 0.8,
            );
            return { position, q, held };
          });
          if (pair.length) {
            const [a, b] = pair.map((id) => poses[id]);
            const before = [a.position.y, b.position.y];
            constrainContact(a.position, a.q, b.position, b.q, t);
            expect(a.position.y).toBeGreaterThanOrEqual(before[0]);
            expect(b.position.y).toBeGreaterThanOrEqual(before[1]);
          }
          for (let a = 0; a < 5; a++) {
            const die = poses[a];
            expect(die.position.y - extent(die.q, new Vector3(0, 1, 0))).toBeGreaterThanOrEqual(
              (die.held ? 0.3775 : 0.185) - 1e-8,
            );
            for (let b = a + 1; b < 5; b++)
              expect(
                separated(die.position, die.q, poses[b].position, poses[b].q),
                `mask=${mask}, shelf=${fromShelf}, time=${t}, pair=${a}/${b}`,
              ).toBe(true);
          }
        }
    }
  });
});
