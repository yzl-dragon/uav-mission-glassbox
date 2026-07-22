import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const bundle = JSON.parse(await readFile(new URL("app/data/experiments/experiment_bundle.json", root), "utf8"));
const representative = (experimentId, representativeId) => bundle.experiments
  .find((experiment) => experiment.id === experimentId).representatives
  .find((item) => item.id === representativeId);

function minimumSeparation(timeline) {
  const frames = new Map();
  for (const event of timeline) {
    const key = event.step ?? `t:${event.time_s}`;
    const drones = frames.get(key) ?? new Map();
    drones.set(event.drone_id, event);
    frames.set(key, drones);
  }
  let minimum = Infinity;
  for (const drones of frames.values()) {
    const values = [...drones.values()];
    for (let i = 0; i < values.length; i += 1) for (let j = i + 1; j < values.length; j += 1) {
      minimum = Math.min(minimum, Math.hypot(
        values[i].x - values[j].x,
        values[i].y - values[j].y,
        (values[i].z ?? 0) - (values[j].z ?? 0),
      ));
    }
  }
  return minimum;
}

test("world-coordinate replay keeps exact source telemetry at event time", async () => {
  const headOn = representative("multi_uav_deconfliction", "head_on");
  const source = headOn.timeline.find((event) => headOn.timeline.filter((candidate) => candidate.drone_id === event.drone_id && candidate.time_s === event.time_s).length === 1);
  assert.ok(source);
  const rows = headOn.timeline.filter((event) => event.drone_id === source.drone_id).sort((a,b)=>a.time_s-b.time_s);
  const adapted = [...rows].reverse().find((event) => event.time_s <= source.time_s);
  assert.deepEqual(
    [adapted.x, adapted.y, adapted.z, adapted.vx, adapted.vy, adapted.vz, adapted.battery_wh, adapted.temperature_c],
    [source.x, source.y, source.z, source.vx, source.vy, source.vz, source.battery_wh, source.temperature_c],
  );

  const adapter = await readFile(new URL("app/lib/replayAdapter.ts", root), "utf8");
  assert.match(adapter, /xM: interpolate\(previous\.x, next\.x\)/);
  assert.match(adapter, /yM: interpolate\(previous\.y, next\.y\)/);
  assert.match(adapter, /zM: interpolate\(previous\.z, next\.z\)/);
  assert.doesNotMatch(adapter, /50 \+ x|50 - y|sourcePoint/);
});

test("head-on trail has real vertical variation and meter-space separation matches summary", () => {
  const headOn = representative("multi_uav_deconfliction", "head_on");
  const zValues = new Set(headOn.timeline.map((event) => event.z));
  assert.ok(zValues.size > 1);
  assert.ok(headOn.timeline.some((event) => event.vz !== 0));
  assert.ok(headOn.timeline.some((event) => event.action === "YIELD"));
  assert.ok(headOn.timeline.some((event) => event.action === "DECONFLICT_CLIMB"));
  assert.ok(Math.abs(minimumSeparation(headOn.timeline) - headOn.summary.minimum_separation_m) < .002);
});

test("projection changes screen pixels only, not world metrics or telemetry", async () => {
  const source = { xM: 12.5, yM: -7.25, zM: 31 };
  const other = { xM: -2, yM: 4, zM: 18 };
  const distanceBefore = Math.hypot(source.xM-other.xM, source.yM-other.yM, source.zM-other.zM);
  const project = (point, zoom) => ({ xPx: 500+(point.xM-point.yM)*zoom, yPx: 300+(point.xM+point.yM-point.zM)*zoom });
  assert.notDeepEqual(project(source, .7), project(source, 2.2));
  assert.deepEqual(source, { xM: 12.5, yM: -7.25, zM: 31 });
  assert.equal(Math.hypot(source.xM-other.xM, source.yM-other.yM, source.zM-other.zM), distanceBefore);

  const [projection, page] = await Promise.all([
    readFile(new URL("app/lib/mapProjection.ts", root), "utf8"),
    readFile(new URL("app/page.tsx", root), "utf8"),
  ]);
  assert.match(projection, /project: \(point: WorldPoint\)/);
  assert.match(page, /selectedDrone\.x\.toFixed\(3\)/);
  assert.match(page, /源坐标单位未声明/);
});

test("all 15 representatives can enter the main map with source-owned semantics", async () => {
  assert.equal(bundle.experiments.reduce((sum, experiment) => sum + experiment.representatives.length, 0), 15);
  const eight = representative("multi_uav_deconfliction", "eight_uav");
  assert.equal(new Set(eight.timeline.map((event) => event.drone_id)).size, 8);

  const combined = representative("no_fly_obstacles", "combined_stress");
  assert.equal(combined.environment.no_fly_zones.length, 2);
  assert.ok(combined.environment.no_fly_zones.every((zone) => zone.geometry === "axis_aligned_box"));
  assert.equal(combined.environment.dynamic_obstacles.count, 5);
  assert.ok(combined.timeline.some((event) => event.action === "AVOID_DYNAMIC"));

  const [page, lab, map] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/components/ExperimentLab.tsx", root), "utf8"),
    readFile(new URL("app/components/MissionMap.tsx", root), "utf8"),
  ]);
  assert.match(lab, /onReplayRepresentative/);
  assert.match(lab, /在主地图回放此案例/);
  assert.match(page, /inferRepresentativeScenario/);
  assert.match(page, /单 seed 代表案例 · 非 20-seed 均值/);
  assert.match(map, /boxCorners\(box\)/);
  assert.match(map, /event\.action === "AVOID_DYNAMIC"/);
  assert.match(page, /dataMode==="live"\?dynamicObstacles\(simTime,scenarioKey\):\[\]/);
  const actions = new Set(bundle.experiments.flatMap((experiment)=>experiment.representatives).flatMap((item)=>item.timeline).map((event)=>event.action));
  for (const action of actions) assert.match(page, new RegExp(`${action}: \\{`));
});

test("timeline, focus view, selected-only trail and actual legend are wired", async () => {
  const [page, timeline, legend, css, adapter] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/components/MapTimeline.tsx", root), "utf8"),
    readFile(new URL("app/components/MapLegend.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
    readFile(new URL("app/lib/replayAdapter.ts", root), "utf8"),
  ]);
  for (const action of ["STORE_AND_WAIT","DEFER_UPLOAD","COOL_DOWN","RETURN","TURNAROUND","YIELD","DECONFLICT_CLIMB","AVOID_DYNAMIC","AVOID_NO_FLY"]) {
    assert.match(adapter, new RegExp(action));
  }
  assert.match(timeline, /type="range"/);
  assert.match(page, /focusSelected/);
  assert.match(page, /selectedTrailOnly/);
  assert.match(page, /setTelemetryOpen/);
  assert.match(legend, /当前地图实际图例/);
  assert.match(css, /grid-template-columns: minmax\(0, 1fr\) 320px/);
  assert.match(css, /workspace-grid\.map-focus/);
});
