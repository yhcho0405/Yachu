import { Euler, Matrix4, Quaternion, Vector3 } from 'three';

export const CONTACT_TIME = 0.2;
const RELEASE_TIME = 0.22;
const contactPose = new Quaternion().setFromEuler(new Euler(Math.PI / 4, 0, 0));
const smooth = (t: number) => {
  const p = Math.max(0, Math.min(1, t));
  return p * p * (3 - 2 * p);
};
const ease = (t: number) => 1 - (1 - t) ** 3;

/** Support of the actual rounded cube (a smaller cube plus a corner-radius sphere). */
export function dieSupport(q: Quaternion, axis: 0 | 1 | 2, size = 0.95, radius = 0.095) {
  const m = new Matrix4().makeRotationFromQuaternion(q).elements;
  return (
    (size / 2 - radius) * (Math.abs(m[axis]) + Math.abs(m[axis + 4]) + Math.abs(m[axis + 8])) +
    radius
  );
}

/** Continuous launch tilt, real side contact, then the ordinary complete-turn settle. */
export function contactRollQuaternion(from: Quaternion, to: Quaternion, t: number) {
  if (t <= CONTACT_TIME)
    return new Quaternion().slerpQuaternions(from, contactPose, smooth(t / CONTACT_TIME));
  const p = ease(Math.max(0, (t - RELEASE_TIME) / (1 - RELEASE_TIME)));
  return new Quaternion()
    .slerpQuaternions(contactPose, to, p)
    .multiply(
      new Quaternion().setFromEuler(new Euler(4 * Math.PI * p, 2 * Math.PI * p, 6 * Math.PI * p)),
    );
}

export function contactEnvelope(t: number) {
  // Leave the shelf region first when a recently released die is still moving down.
  if (t < CONTACT_TIME) return smooth((t - 0.1) / 0.1);
  if (t <= RELEASE_TIME) return 1;
  return 1 - smooth((t - RELEASE_TIME) / 0.2);
}

/** Move only inward and upward; exact world-X supports prohibit interpenetration. */
export function constrainContact(
  a: Vector3,
  qa: Quaternion,
  b: Vector3,
  qb: Quaternion,
  t: number,
) {
  const amount = contactEnvelope(t);
  if (!amount) return;
  const support = dieSupport(qa, 0) + dieSupport(qb, 0);
  const center = (a.x + b.x) / 2;
  const distance = Math.max(support, (b.x - a.x) * (1 - amount) + support * amount);
  a.x = center - distance / 2;
  b.x = center + distance / 2;
  const z = (a.z + b.z) / 2;
  const y = Math.max(a.y, b.y);
  a.z += (z - a.z) * amount;
  b.z += (z - b.z) * amount;
  a.y += (y - a.y) * amount;
  b.y += (y - b.y) * amount;
}
