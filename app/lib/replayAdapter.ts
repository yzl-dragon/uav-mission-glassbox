export type ScenarioKey = "logistics" | "rescue" | "spraying";
export type CoordinateUnit = "m" | "source";

export type WorldPoint = {
  xM: number;
  yM: number;
  zM: number;
};

export type ScreenPoint = {
  xPx: number;
  yPx: number;
};

export type TrailSample = WorldPoint & {
  timeS: number;
  action: string;
  batteryWh?: number;
  temperatureC?: number;
  linkUp?: boolean;
  storageMb?: number;
};

export type ReplayEvent = {
  step?: number;
  time_s: number;
  drone_id: number;
  action: string;
  task_id?: string;
  x: number;
  y: number;
  z?: number;
  vx?: number;
  vy?: number;
  vz?: number;
  ax?: number;
  ay?: number;
  az?: number;
  battery_wh?: number;
  battery_pct?: number;
  temperature_c?: number;
  link_up?: number;
  link_type?: string;
  bandwidth_kbps?: number;
  pdr?: number;
  latency_ms?: number;
  storage_mb?: number;
  pending_results?: number;
  model_version?: number;
  note?: string;
};

export type ReplayTask = {
  task_id: string;
  x: number;
  y: number;
  z?: number;
  priority?: number;
  deadline?: number;
  assigned_to?: number | null;
  completed_at?: number | null;
  rejected_reason?: string;
};

export type ReplayDroneDefinition = {
  drone_id: number;
  battery_wh?: number;
  chemical_left?: number;
  tank_capacity?: number;
};

export type NoFlyBox = {
  name: string;
  geometry: "axis_aligned_box";
  x_min: number;
  x_max: number;
  y_min: number;
  y_max: number;
  z_min: number;
  z_max: number;
};

export type ReplayEnvironment = {
  no_fly_zones?: NoFlyBox[];
  dynamic_obstacles?: {
    count?: number;
    model?: string;
    geometry?: string;
  };
  safe_distance_m?: number;
  source_case?: string;
  [key: string]: unknown;
};

export type ExperimentReplayRequest = {
  experimentId: string;
  experimentTitle: string;
  representativeId: string;
  representativeLabel: string;
  configuration: Record<string, unknown>;
  summary: Record<string, unknown>;
  tasks: ReplayTask[];
  drones: ReplayDroneDefinition[];
  timeline: ReplayEvent[];
  environment: ReplayEnvironment;
};

export type ReplayFrame = WorldPoint & {
  sourceId: number;
  timeS: number;
  action: string;
  taskId: string;
  velocity: WorldPoint;
  speedMps: number;
  batteryWh?: number;
  batteryPct: number;
  temperatureC: number;
  linkUp?: number;
  linkType?: string;
  bandwidthKbps?: number;
  pdr?: number;
  latencyMs?: number;
  storageMb?: number;
  pendingResults: number;
  modelVersion: number;
  note: string;
  trail: TrailSample[];
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const numeric = (value: unknown, fallback = 0) => typeof value === "number" && Number.isFinite(value) ? value : fallback;

export const CRITICAL_ACTIONS = [
  "STORE_AND_WAIT",
  "DEFER_UPLOAD",
  "COOL_DOWN",
  "RETURN",
  "TURNAROUND",
  "YIELD",
  "DECONFLICT_CLIMB",
  "AVOID_DYNAMIC",
  "AVOID_NO_FLY",
] as const;

export function isCriticalAction(action: string) {
  return (CRITICAL_ACTIONS as readonly string[]).includes(action);
}

export function toTrailSample(event: ReplayEvent): TrailSample {
  return {
    xM: event.x,
    yM: event.y,
    zM: numeric(event.z),
    timeS: event.time_s,
    action: event.action,
    batteryWh: event.battery_wh,
    temperatureC: event.temperature_c,
    linkUp: event.link_up === undefined ? undefined : event.link_up !== 0,
    storageMb: event.storage_mb,
  };
}

/**
 * Adapts source events without changing their world coordinates.
 * Smooth mode interpolates only physical pose/velocity. Event semantics and
 * telemetry remain attached to the last source event at or before timeS.
 */
export function replayFramesAt(
  timeline: ReplayEvent[],
  timeS: number,
  smooth: boolean,
  initialBatteryWh: Map<number, number> = new Map(),
): ReplayFrame[] {
  const sourceIds = [...new Set(timeline.map((event) => event.drone_id))].sort((a, b) => a - b);
  return sourceIds.map((sourceId) => {
    const rows = timeline.filter((event) => event.drone_id === sourceId).sort((a, b) => a.time_s - b.time_s);
    const previous = [...rows].reverse().find((event) => event.time_s <= timeS) ?? rows[0];
    const next = rows.find((event) => event.time_s > timeS) ?? previous;
    const ratio = smooth && next.time_s > previous.time_s
      ? clamp((timeS - previous.time_s) / (next.time_s - previous.time_s), 0, 1)
      : 0;
    const ease = ratio * ratio * (3 - 2 * ratio);
    const interpolate = (a: number | undefined, b: number | undefined) => numeric(a) + (numeric(b) - numeric(a)) * ease;
    const batteryWh = previous.battery_wh;
    const batteryBase = initialBatteryWh.get(sourceId) ?? rows.find((row) => row.battery_wh !== undefined)?.battery_wh;
    const batteryPct = previous.battery_pct ?? (batteryWh !== undefined && batteryBase
      ? clamp(batteryWh / Math.max(0.001, batteryBase) * 100, 0, 100)
      : 100);
    const velocity = {
      xM: interpolate(previous.vx, next.vx),
      yM: interpolate(previous.vy, next.vy),
      zM: interpolate(previous.vz, next.vz),
    };
    return {
      sourceId,
      xM: interpolate(previous.x, next.x),
      yM: interpolate(previous.y, next.y),
      zM: interpolate(previous.z, next.z),
      timeS: previous.time_s,
      action: previous.action,
      taskId: previous.task_id ?? "",
      velocity,
      speedMps: Math.hypot(velocity.xM, velocity.yM, velocity.zM),
      batteryWh,
      batteryPct,
      temperatureC: numeric(previous.temperature_c, 28),
      linkUp: previous.link_up,
      linkType: previous.link_type,
      bandwidthKbps: previous.bandwidth_kbps,
      pdr: previous.pdr,
      latencyMs: previous.latency_ms,
      storageMb: previous.storage_mb,
      pendingResults: numeric(previous.pending_results),
      modelVersion: numeric(previous.model_version),
      note: previous.note ?? "",
      trail: rows.filter((event) => event.time_s <= timeS).map(toTrailSample),
    };
  });
}

export function inferRepresentativeScenario(request: ExperimentReplayRequest): ScenarioKey {
  const declared = request.configuration.scenario ?? request.summary.scenario;
  if (declared === "logistics" || declared === "rescue" || declared === "spraying") return declared;
  if (request.experimentId === "communication_resilience") return "rescue";
  if (request.experimentId === "no_fly_obstacles") return "logistics";
  const label = String(request.configuration.label ?? request.representativeId).toLowerCase();
  if (request.experimentId === "energy_return") return label.includes("rescue") ? "rescue" : "logistics";
  if (request.experimentId === "thermal_compute") return label.includes("spray") ? "spraying" : "rescue";
  return "rescue";
}

export function experimentDuration(request: ExperimentReplayRequest) {
  return Math.max(0, ...request.timeline.map((event) => event.time_s));
}

export function initialBatteryMap(request: ExperimentReplayRequest) {
  const declared = numeric(request.configuration.initial_battery_wh, NaN);
  return new Map(
    [...new Set(request.timeline.map((event) => event.drone_id))].map((id) => {
      const first = request.timeline.find((item) => item.drone_id === id && item.battery_wh !== undefined);
      const drone = request.drones.find((item) => item.drone_id === id);
      return [id, Number.isFinite(declared) ? declared : numeric(first?.battery_wh, numeric(drone?.battery_wh, 100))];
    }),
  );
}
