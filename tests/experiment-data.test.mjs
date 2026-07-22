import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const bundle = JSON.parse(await readFile(new URL("app/data/experiments/experiment_bundle.json", root), "utf8"));

function experiment(id) { return bundle.experiments.find(item => item.id === id); }
function sweep(experimentId, sweepId) { return experiment(experimentId).sweeps.find(item => item.id === sweepId); }
function aggregate(experimentId, sweepId, caseId) { return sweep(experimentId, sweepId).aggregates.find(item => item.case === caseId); }
function close(actual, expected, tolerance = 1e-6) { assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`); }

test("experiment bundle exposes five pre-aggregated 20-seed studies", () => {
  assert.equal(bundle.schema_version, "uav-experiment-bundle/v1");
  assert.equal(bundle.experiments.length, 5);
  assert.equal(bundle.experiments.reduce((sum, item) => sum + item.run_count, 0), 3740);
  for (const item of bundle.experiments) {
    assert.equal(item.seed_count, 20);
    assert.ok(item.views.length > 0);
    for (const view of item.views) {
      assert.ok(view.x_label);
      assert.ok(view.y_label);
      assert.ok(view.interpretation);
      if (view.type === "heatmap") {
        assert.ok(view.color);
        assert.ok(view.color_label);
      }
    }
    for (const itemSweep of item.sweeps) {
      assert.ok(itemSweep.aggregates.every(point => point.n === 20));
    }
  }
});

test("website aggregates reproduce the five experiment reports", () => {
  const outage = aggregate("communication_resilience", "outage_rate", "outage_0.8");
  close(outage.result_return_rate_mean, 0.78125);
  close(outage.dropped_data_mb_mean, 0.602);

  const strict = sweep("energy_return", "battery_reserve").aggregates.filter(point => point.initial_battery_wh_setting === 50 && point.reserve_wh_setting === 35);
  close(strict.reduce((sum, point) => sum + point.completion_rate_mean, 0) / strict.length, 0.3512, 5e-5);
  assert.ok(strict.every(point => point.constraint_violations_mean === 0));

  const hot = sweep("thermal_compute", "ambient_compute").aggregates.filter(point => point.ambient_c_setting === 45 && point.compute_factor === 12);
  close(hot.reduce((sum, point) => sum + point.on_time_rate_mean, 0) / hot.length, 0.75);
  close(hot.reduce((sum, point) => sum + point.thermal_hold_events_mean, 0) / hot.length, 135.375);

  close(aggregate("multi_uav_deconfliction", "fixed_workload", "fixed24_d3_safe5").throughput_tasks_per_min_mean, 0.9210389610389612);
  close(aggregate("multi_uav_deconfliction", "fixed_workload", "fixed24_d8_safe5").throughput_tasks_per_min_mean, 3.9258809456797072);

  const pressure = aggregate("no_fly_obstacles", "zone_obstacle", "zone_3_obstacles_5");
  close(pressure.completion_rate_mean, 0.3333);
  assert.equal(pressure.no_fly_violations_mean, 0);
  assert.equal(pressure.constraint_violations_mean, 0);
});

test("representatives preserve dynamic fleets, real z, actions, and no-fly boxes", () => {
  const multi = experiment("multi_uav_deconfliction");
  const eight = multi.representatives.find(item => item.id === "eight_uav");
  assert.equal(new Set(eight.timeline.map(item => item.drone_id)).size, 8);
  assert.ok(eight.timeline.some(item => item.z > 0));
  assert.ok(eight.timeline.some(item => item.vz !== 0));

  const actions = new Set(bundle.experiments.flatMap(item => item.representatives).flatMap(item => item.timeline).map(item => item.action));
  for (const action of ["COOL_DOWN", "STORE_AND_WAIT", "DEFER_UPLOAD", "YIELD", "DECONFLICT_CLIMB", "AVOID_DYNAMIC", "AVOID_NO_FLY"]) {
    assert.ok(actions.has(action), `missing ${action}`);
  }

  const obstacles = experiment("no_fly_obstacles");
  const combined = obstacles.representatives.find(item => item.id === "combined_stress");
  assert.deepEqual(combined.environment.no_fly_zones.map(zone => [zone.name, zone.x_min, zone.x_max, zone.y_min, zone.y_max, zone.z_min, zone.z_max]), [
    ["north_barrier", -25, 25, 5, 75, 0, 120],
    ["south_barrier", -25, 25, -75, -5, 0, 120],
  ]);
  assert.equal(combined.environment.dynamic_obstacles.count, 5);
});

test("generated adapters retain extended replay fields and action semantics", async () => {
  const [research, page, lab, generated, adapter, map] = await Promise.all([
    readFile(new URL("app/generated/researchData.ts", root), "utf8"),
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/components/ExperimentLab.tsx", root), "utf8"),
    readFile(new URL("app/generated/experimentData.ts", root), "utf8"),
    readFile(new URL("app/lib/replayAdapter.ts", root), "utf8"),
    readFile(new URL("app/components/MissionMap.tsx", root), "utf8"),
  ]);
  for (const field of ["z", "vx", "vy", "vz", "ax", "ay", "az", "link_type", "bandwidth_kbps", "pdr", "latency_ms", "storage_mb"]) {
    assert.match(research, new RegExp(`"${field}"`));
  }
  for (const action of ["COOL_DOWN", "STORE_AND_WAIT", "DECONFLICT_CLIMB", "AVOID_NO_FLY"]) {
    assert.match(page, new RegExp(action));
  }
  assert.match(adapter, /new Set\(timeline\.map/);
  assert.match(adapter, /Math\.hypot\(velocity\.xM, velocity\.yM, velocity\.zM\)/);
  assert.match(adapter, /xM: event\.x/);
  assert.match(adapter, /zM: numeric\(event\.z\)/);
  assert.match(page, /altitude: frame\.zM/);
  assert.match(map, /project\(sample\)/);
  assert.doesNotMatch(adapter, /sourcePoint|\* 0\.34|\* 0\.3/);
  assert.match(lab, /95%置信区间/);
  assert.match(lab, /在主地图回放此案例/);
  assert.match(lab, /横轴/);
  assert.match(lab, /图意/);
  assert.match(generated, /communication_resilience/);
});
