import { Matrix4, Quaternion, Vector3 } from 'three';
import { orientationForValue } from '../../../shared/orientations';

export const DIE_SIZE = 0.82;
export const DIE_RADIUS = 0.082;
export const BOARD_FLOOR = 0.16;
export const REST_Y = BOARD_FLOOR + DIE_SIZE / 2;
export const LANE_Z = [-1.68, 0, 1.68] as const;
export const ATTACK_IMPACT_MS = 470;
export const ATTACK_REMOVE_MS = 920;
export const ATTACK_FINISH_MS = 1180;
export const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
export const ease = (n: number) => 1 - (1 - clamp01(n)) ** 3;

/** Both render layouts use these same logical owner/lane coordinates. */
export function lanePosition(side: -1 | 1, lane: 0 | 1 | 2, slot: number): Vector3 {
  return new Vector3(side * (1.92 + slot * 1.14), REST_Y, LANE_Z[lane]);
}

/** Exact rounded-box support; tumbling dice never sink through their floor. */
export function dieSupport(q: Quaternion): number {
  const m = new Matrix4().makeRotationFromQuaternion(q).elements;
  return (
    (DIE_SIZE / 2 - DIE_RADIUS) * (Math.abs(m[1]) + Math.abs(m[5]) + Math.abs(m[9])) + DIE_RADIUS
  );
}

/** Integer turns taper continuously into the server face; no last-frame face swap. */
export function rollQuaternion(value: number, progress: number, yaw = 0): Quaternion {
  const t = clamp01(progress);
  const remaining = (1 - t) ** 2;
  return new Quaternion()
    .setFromAxisAngle(new Vector3(0.73, 0.32, 0.61).normalize(), remaining * Math.PI * 8)
    .multiply(orientationForValue(value, yaw));
}

export function rollHeight(progress: number, q: Quaternion): number {
  const t = clamp01(progress);
  const lift = Math.abs(Math.sin(t * Math.PI * 3)) * (1 - t) ** 1.7 * 1.16;
  return BOARD_FLOOR + dieSupport(q) + lift;
}

/** Attack phases are tied to visible contact/removal, not independent timers. */
export function attackPhase(elapsed: number): 'approach' | 'remove' | 'reflow' | 'done' {
  if (elapsed < ATTACK_IMPACT_MS) return 'approach';
  if (elapsed < ATTACK_REMOVE_MS) return 'remove';
  if (elapsed < ATTACK_FINISH_MS) return 'reflow';
  return 'done';
}
