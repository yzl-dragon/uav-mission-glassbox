import type { NoFlyBox, ReplayEvent, TrailSample, WorldPoint } from "./replayAdapter";

export function distance3d(a: WorldPoint, b: WorldPoint) {
  return Math.hypot(a.xM - b.xM, a.yM - b.yM, a.zM - b.zM);
}

export function trailLengthM(trail: TrailSample[]) {
  return trail.slice(1).reduce((sum, point, index) => sum + distance3d(trail[index], point), 0);
}

export function pointInsideNoFlyBox(point: WorldPoint, box: NoFlyBox) {
  return point.xM >= box.x_min && point.xM <= box.x_max
    && point.yM >= box.y_min && point.yM <= box.y_max
    && point.zM >= box.z_min && point.zM <= box.z_max;
}

export function minimumSeparationM(points: WorldPoint[]) {
  if (points.length < 2) return Infinity;
  let minimum = Infinity;
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) minimum = Math.min(minimum, distance3d(points[i], points[j]));
  }
  return minimum;
}

export type RelativeMotionMetric = {
  currentDistanceM: number;
  cpaDistanceM: number;
  timeToCpaS: number;
  timeToViolationS: number | null;
};

export function relativeMotionMetrics(
  first: WorldPoint,
  firstVelocity: WorldPoint,
  second: WorldPoint,
  secondVelocity: WorldPoint,
  safeDistanceM: number,
  horizonS = 30,
): RelativeMotionMetric {
  const relativePosition = {
    xM: second.xM - first.xM,
    yM: second.yM - first.yM,
    zM: second.zM - first.zM,
  };
  const relativeVelocity = {
    xM: secondVelocity.xM - firstVelocity.xM,
    yM: secondVelocity.yM - firstVelocity.yM,
    zM: secondVelocity.zM - firstVelocity.zM,
  };
  const velocitySquared = relativeVelocity.xM ** 2 + relativeVelocity.yM ** 2 + relativeVelocity.zM ** 2;
  const dot = relativePosition.xM * relativeVelocity.xM + relativePosition.yM * relativeVelocity.yM + relativePosition.zM * relativeVelocity.zM;
  const timeToCpaS = velocitySquared > 1e-9 ? Math.max(0, Math.min(horizonS, -dot / velocitySquared)) : 0;
  const cpaPoint = {
    xM: relativePosition.xM + relativeVelocity.xM * timeToCpaS,
    yM: relativePosition.yM + relativeVelocity.yM * timeToCpaS,
    zM: relativePosition.zM + relativeVelocity.zM * timeToCpaS,
  };
  const currentDistanceM = Math.hypot(relativePosition.xM, relativePosition.yM, relativePosition.zM);
  const cpaDistanceM = Math.hypot(cpaPoint.xM, cpaPoint.yM, cpaPoint.zM);
  const a = velocitySquared;
  const b = 2 * dot;
  const c = currentDistanceM ** 2 - safeDistanceM ** 2;
  const discriminant = b ** 2 - 4 * a * c;
  let timeToViolationS: number | null = currentDistanceM <= safeDistanceM ? 0 : null;
  if (timeToViolationS === null && a > 1e-9 && discriminant >= 0) {
    const entry = (-b - Math.sqrt(discriminant)) / (2 * a);
    if (entry >= 0 && entry <= horizonS) timeToViolationS = entry;
  }
  return { currentDistanceM, cpaDistanceM, timeToCpaS, timeToViolationS };
}

/**
 * Recomputes the dataset metric exclusively in source/world coordinates.
 * Only simultaneous samples (same step when available, otherwise same time)
 * are compared, matching the simulator's per-frame safety definition.
 */
export function minimumTimelineSeparationM(timeline: ReplayEvent[]) {
  const frames = new Map<string, Map<number, WorldPoint>>();
  timeline.forEach((event) => {
    const key = event.step === undefined ? `t:${event.time_s}` : `s:${event.step}`;
    const values = frames.get(key) ?? new Map<number, WorldPoint>();
    values.set(event.drone_id, { xM: event.x, yM: event.y, zM: event.z ?? 0 });
    frames.set(key, values);
  });
  return Math.min(...[...frames.values()].map((values) => minimumSeparationM([...values.values()])));
}
