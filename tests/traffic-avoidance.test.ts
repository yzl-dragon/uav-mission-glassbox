import assert from "node:assert/strict";
import test from "node:test";
import { resolveTraffic, trafficPriority, type TrafficAgent } from "../app/lib/traffic.ts";

test("traffic priority breaks symmetric conflicts deterministically", () => {
  const leader: TrafficAgent = { id: 0, x: 0, y: 0, altitude: 20, phase: "FLY_AND_INFER", battery: 80, taskPriority: 3 };
  const follower: TrafficAgent = { id: 1, x: 4, y: 0, altitude: 20, phase: "FLY_AND_INFER", battery: 80, taskPriority: 3 };
  assert.ok(trafficPriority(leader) > trafficPriority(follower));

  const leaderResolution = resolveTraffic(leader, [leader, follower], 1, 0);
  const followerResolution = resolveTraffic(follower, [leader, follower], -1, 0);
  assert.deepEqual(leaderResolution.yieldedTo, []);
  assert.equal(leaderResolution.speedScale, 1);
  assert.deepEqual(followerResolution.yieldedTo, [0]);
  assert.ok(followerResolution.speedScale < 1);
  assert.ok(Math.hypot(followerResolution.offsetX, followerResolution.offsetY) > 0);
});

test("landed aircraft do not block airborne return traffic", () => {
  const airborne: TrafficAgent = { id: 2, x: 50, y: 42, altitude: 18, phase: "RETURN", battery: 40, taskPriority: 0 };
  const landed: TrafficAgent = { id: 0, x: 50, y: 47, altitude: 0, phase: "HOLD", battery: 100, taskPriority: 0 };
  const resolution = resolveTraffic(airborne, [airborne, landed], 0, 1);
  assert.equal(resolution.maneuvering, false);
  assert.equal(resolution.speedScale, 1);
});

test("three crossing aircraft keep progressing instead of reaching a mutual stop", () => {
  const targets = [{ x: 7, y: 0 }, { x: -7, y: 0 }, { x: 0, y: 7 }];
  let fleet: TrafficAgent[] = [
    { id: 0, x: -7, y: 0, altitude: 18, phase: "FLY_AND_INFER", battery: 85, taskPriority: 4 },
    { id: 1, x: 7, y: 0, altitude: 22, phase: "FLY_AND_INFER", battery: 85, taskPriority: 4 },
    { id: 2, x: 0, y: -7, altitude: 26, phase: "FLY_AND_INFER", battery: 85, taskPriority: 4 },
  ];

  for (let tick = 0; tick < 220; tick++) {
    const snapshot = fleet.map(agent => ({ ...agent }));
    fleet = snapshot.map((agent, index) => {
      if (agent.phase === "HOLD") return agent;
      const target = targets[index], dx = target.x - agent.x, dy = target.y - agent.y, distance = Math.hypot(dx, dy);
      if (distance < .3) return { ...agent, x: target.x, y: target.y, altitude: 0, phase: "HOLD" };
      const desiredX = dx / distance, desiredY = dy / distance;
      const resolution = resolveTraffic(agent, snapshot, desiredX, desiredY);
      const ux = desiredX + resolution.offsetX, uy = desiredY + resolution.offsetY, norm = Math.max(.001, Math.hypot(ux, uy));
      const step = Math.min(distance, .11 * resolution.speedScale);
      return { ...agent, x: agent.x + ux / norm * step, y: agent.y + uy / norm * step };
    });
  }

  const distances = fleet.map((agent, index) => Math.hypot(agent.x - targets[index].x, agent.y - targets[index].y));
  assert.ok(distances.every(distance => distance < .5), `final distances: ${distances.map(value => value.toFixed(2)).join(", ")}`);
});
