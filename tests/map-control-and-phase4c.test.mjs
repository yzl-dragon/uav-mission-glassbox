import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("v0.8.1 keeps every escape control visible and creates a non-overlapping fleet drawer path", async () => {
  const [page, css, dock] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
    readFile(new URL("app/components/MapControlDock.tsx", root), "utf8"),
  ]);
  for (const label of ["缩小地图", "放大地图", "适配全部对象", "重置地图视图", "收起机队状态", "退出地图专注模式"]) assert.match(dock, new RegExp(label));
  assert.match(dock, /disabled=\{atMinimum\}/);
  assert.match(dock, /disabled=\{atMaximum\}/);
  assert.match(page, /aria-label="收起机队状态"/);
  assert.match(page, /telemetryToggleRef\.current\?\.focus/);
  assert.match(page, /event\.key === "Escape"/);
  assert.match(page, /event\.key\.toLowerCase\(\) === "t"/);
  assert.match(css, /--map-control-right/);
  assert.match(css, /--fleet-drawer-width/);
  assert.match(css, /map-focus\.telemetry-open/);
  assert.match(css, /bottom: calc\(var\(--map-timeline-height\)/);
  assert.doesNotMatch(css, /map-view-controls \.fit-map,.map-view-controls output \{ display: none/);
});

test("phase 4C uses five single-seed pairs, dual maps, one fleet inspector, and guarded ghost trails", async () => {
  const [component, page, missionMap, projection, css] = await Promise.all([
    readFile(new URL("app/components/ExperimentComparison.tsx", root), "utf8"),
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/components/MissionMap.tsx", root), "utf8"),
    readFile(new URL("app/lib/mapProjection.ts", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
  ]);
  for (const id of ["communication_resilience", "energy_return", "thermal_compute", "multi_uav_deconfliction", "no_fly_obstacles"]) assert.match(component, new RegExp(id));
  for (const pair of ["baseline.*stress", "baseline_logistics.*strict_logistics", "baseline_rescue.*hot_heavy_rescue", "three_uav.*eight_uav", "baseline.*combined_stress"]) assert.match(component, new RegExp(pair));
  assert.match(css, /\.comparison-maps \{ display: grid; grid-template-columns: 1fr 1fr/);
  assert.match(component, /data-shared-fleet-inspector/);
  assert.equal((component.match(/data-shared-fleet-inspector/g) ?? []).length, 1);
  assert.match(component, /ghostCompatible = viewCompatible && droneCount\(baseline\) === droneCount\(pressure\)/);
  assert.match(component, /sameTasks\(baseline, pressure\)/);
  assert.match(component, /Math\.min\(timeS, duration\(representative\)\)/);
  assert.match(component, /maxDuration = Math\.max/);
  assert.match(component, /single-seed-only/);
  assert.match(component, /20-seed 统计仅在实验工作台中展示，不生成平均轨迹/);
  assert.doesNotMatch(component, /aggregates|_mean.*trail|meanTrail/i);
  assert.match(component, /单 seed 对单 seed/);
  assert.match(page, /<ExperimentComparison\/>/);
  assert.match(missionMap, /ghostTrails/);
  assert.match(missionMap, /ctx\.setLineDash\(\[6, 5\]\)/);
  assert.match(projection, /contentTop\?: number/);
});
