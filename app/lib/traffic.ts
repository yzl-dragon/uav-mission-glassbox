export type TrafficAgent = {
  id: number;
  x: number;
  y: number;
  altitude: number;
  phase: string;
  battery: number;
  taskPriority: number;
};

export type TrafficResolution = {
  offsetX: number;
  offsetY: number;
  speedScale: number;
  maneuvering: boolean;
  yieldedTo: number[];
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

export function trafficPriority(agent: TrafficAgent, reserve = 18) {
  const emergencyReturn = agent.phase === "RETURN" && agent.battery <= reserve + 5 ? 500 : 0;
  return emergencyReturn + agent.taskPriority * 20 - agent.id * .01;
}

export function resolveTraffic(self: TrafficAgent, fleet: TrafficAgent[], desiredX: number, desiredY: number, reserve = 18): TrafficResolution {
  let offsetX = 0, offsetY = 0, speedScale = 1, maneuvering = false;
  const yieldedTo: number[] = [], ownScore = trafficPriority(self, reserve);
  const influenceDistance = 12;

  for (const other of fleet) {
    if (other.id === self.id || other.altitude <= 3 || other.phase === "TURNAROUND" || other.phase === "HOLD") continue;
    const rx = self.x - other.x, ry = self.y - other.y, horizontal = Math.hypot(rx, ry);
    const gap3d = Math.hypot(horizontal, self.altitude - other.altitude);
    const ahead = (other.x - self.x) * desiredX + (other.y - self.y) * desiredY;
    if (gap3d >= influenceDistance || ahead < -3) continue;

    const influence = clamp01((influenceDistance - gap3d) / influenceDistance);
    const radialX = horizontal > .01 ? rx / horizontal : Math.cos((self.id + 1) * 2.399);
    const radialY = horizontal > .01 ? ry / horizontal : Math.sin((self.id + 1) * 2.399);
    if (trafficPriority(other, reserve) > ownScore) {
      offsetX += -desiredY * 1.65 * influence + radialX * .7 * influence;
      offsetY += desiredX * 1.65 * influence + radialY * .7 * influence;
      speedScale = Math.min(speedScale, .5 + .35 * clamp01(gap3d / influenceDistance));
      maneuvering = true;
      yieldedTo.push(other.id);
    } else if (gap3d < 5.5) {
      offsetX += radialX * .55 * influence;
      offsetY += radialY * .55 * influence;
      maneuvering = true;
    }
  }

  return { offsetX, offsetY, speedScale, maneuvering, yieldedTo };
}
