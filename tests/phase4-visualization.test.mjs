import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const bundle = JSON.parse(await read("app/data/experiments/experiment_bundle.json"));
const representative = (experimentId, representativeId) => bundle.experiments
  .find((experiment) => experiment.id === experimentId).representatives
  .find((item) => item.id === representativeId);

test("phase 4A scene proxies are explicit, separate, and scenario-complete", async () => {
  const [models, renderer, map, page] = await Promise.all([
    read("app/data/sceneModels.ts"),
    read("app/lib/sceneRenderer.ts"),
    read("app/components/MissionMap.tsx"),
    read("app/page.tsx"),
  ]);
  assert.match(models, /source: "proxy"/);
  assert.match(models, /affectsPhysics: false/);
  for (const expected of ["东西主路", "西南街区 A", "瓦砾堆 A", "灾区积水面", "作业条带代理 01", "防风林带"]) assert.match(models, new RegExp(expected));
  assert.match(renderer, /export function renderSceneProxy/);
  assert.match(renderer, /export function drawDrone3D/);
  assert.match(renderer, /const rotors = \[\[-14,-9\]/);
  assert.match(renderer, /fillText\("v"/);
  assert.doesNotMatch(renderer, /heading|yaw|机头朝向/i);
  assert.match(page, /sceneProxy:true,uavModel:true,taskTrail:true,events:true/);
  assert.match(page, /不参与计算/);
  assert.match(map, /if \(fitLiveProxyDomain\) points\.push/);
  assert.doesNotMatch(map, /if \(showSceneProxy\) points\.push/);
  assert.ok(map.indexOf("renderSceneProxy") < map.indexOf("visibleTrails.forEach"));
});

test("phase 4B layers consume source fields without inventing geometry", async () => {
  const [map, page, legend, metrics] = await Promise.all([
    read("app/components/MissionMap.tsx"),
    read("app/page.tsx"),
    read("app/components/MapLegend.tsx"),
    read("app/lib/mapMetrics.ts"),
  ]);
  for (const field of ["bandwidthKbps", "pdr", "latencyMs", "storageMb", "batteryWh", "temperatureC", "velocity"]) assert.match(map, new RegExp(field));
  for (const action of ["STORE_AND_WAIT", "DEFER_UPLOAD", "RETURN", "TURNAROUND", "COOL_DOWN", "LOCAL_UPDATE", "YIELD", "DECONFLICT_CLIMB", "AVOID_NO_FLY"]) assert.match(map, new RegExp(action));
  assert.match(metrics, /relativeMotionMetrics/);
  assert.match(map, /CPA/);
  assert.match(map, /TTC/);
  assert.match(map, /z \$\{box\.z_min\.toFixed\(1\)\}–\$\{box\.z_max\.toFixed\(1\)\}/);
  assert.match(page, /dataMode==="live"\?dynamicObstacles\(simTime,scenarioKey\):\[\]/);
  assert.match(page, /available:hasCommunicationData/);
  assert.match(legend, /数据源链路\/机载缓存/);
  assert.match(legend, /三维距离\/CPA\/TTC/);
});

test("experiment 04 and 05 acceptance geometry remains source-owned", () => {
  const eight = representative("multi_uav_deconfliction", "eight_uav");
  assert.equal(new Set(eight.timeline.map((event) => event.drone_id)).size, 8);
  assert.ok(new Set(eight.timeline.map((event) => event.z)).size > 4);
  assert.ok(eight.timeline.some((event) => event.action === "YIELD" || event.action === "DECONFLICT_CLIMB"));

  const combined = representative("no_fly_obstacles", "combined_stress");
  assert.equal(combined.environment.no_fly_zones.length, 2);
  assert.equal(combined.environment.dynamic_obstacles.count, 5);
  assert.ok(combined.timeline.some((event) => event.action === "AVOID_NO_FLY"));
  assert.ok(combined.timeline.some((event) => event.action === "AVOID_DYNAMIC"));
});
