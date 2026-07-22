import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the UAV mission dashboard", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /UAV Mission Glassbox/);
  assert.match(html, /无人机任务链可视化/);
  assert.match(html, /城市物资配送/);
  assert.match(html, /FLY_AND_INFER/);
  assert.match(html, /Python 回放/);
  assert.match(html, /NON-IID/);
  assert.match(html, /导入 benchmark\.json/);
  assert.match(html, /实时机群规模/);
  assert.match(html, /人工任务下发/);
  assert.match(html, /复杂地形与实时航迹/);
  assert.match(html, /和安社区卫生站/);
  assert.match(html, /已完成任务也可重新开启/);
  assert.match(html, /为什么默认没有具体值/);
  assert.match(html, /停滞检测/);
  assert.match(html, /实验工作台/);
  assert.match(html, /PROXY SIMULATION/);
  assert.match(html, /五组实验统计、置信区间与代表案例索引/);
  assert.match(html, /单个seed代表案例/);
  assert.match(html, /在主地图回放此案例/);
  assert.match(html, /场景代理/);
  assert.match(html, /三维无人机/);
  assert.match(html, /不参与计算/);
  assert.match(html, /基准与压力单 seed 双地图同步对照/);
  assert.match(html, /共享机队检查器/);
  assert.match(html, /退出对照/);
});

test("keeps data adapters, safety layers, and offline entry in the deliverable", async () => {
  const [page, traffic, layout, css, packageJson, generatedData, offlineHtml, offlineStat, replayAdapter, missionMap, mapTimeline] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/traffic.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/generated/researchData.ts", import.meta.url), "utf8"),
    readFile(new URL("../打开无人机可视化网站.html", import.meta.url), "utf8"),
    stat(new URL("../打开无人机可视化网站.html", import.meta.url)),
    readFile(new URL("../app/lib/replayAdapter.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/components/MissionMap.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/MapTimeline.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(page, /物资配送/);
  assert.match(page, /搜索救援/);
  assert.match(page, /农田喷洒/);
  assert.match(page, /advanceDrone/);
  assert.match(page, /ResizeObserver/);
  assert.match(page, /setRunning/);
  assert.match(page, /NO_FLY_ZONES/);
  assert.match(page, /dynamicObstacles/);
  assert.match(page, /TERRAIN_HAZARDS/);
  assert.match(page, /toggleFocusMode/);
  assert.match(page, /mapZoom/);
  assert.match(missionMap, /onPointerDown/);
  assert.match(page, /changeFleetSize/);
  assert.match(page, /assignTask/);
  assert.match(page, /d\.completed=d\.completed\.filter/);
  assert.match(page, /重新开启并/);
  assert.match(page, /task\.location/);
  assert.match(page, /M_weights|权重 \+ 中间激活/);
  assert.match(page, /resolveTraffic/);
  assert.match(page, /cruiseAltitude/);
  assert.match(page, /stuckFor > 2\.2/);
  assert.match(page, /avoidanceMode = "escape"/);
  assert.match(traffic, /trafficPriority/);
  assert.match(traffic, /other\.altitude <= 3/);
  assert.match(traffic, /yieldedTo/);
  assert.match(page, /externalDrones/);
  assert.match(replayAdapter, /new Set\(timeline\.map/);
  assert.match(replayAdapter, /Math\.hypot\(velocity\.xM, velocity\.yM, velocity\.zM\)/);
  assert.match(page, /STORE_AND_WAIT/);
  assert.match(page, /DECONFLICT_CLIMB/);
  assert.match(page, /ExperimentLab/);
  assert.match(page, /FederatedChart/);
  assert.match(layout, /UAV Mission Glassbox/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /map-view-controls/);
  assert.match(css, /workspace-grid\.map-focus/);
  assert.match(css, /workspace-grid\.telemetry-closed/);
  assert.match(mapTimeline, /下个关键/);
  assert.match(missionMap, /boxCorners/);
  assert.match(generatedData, /total_energy_wh/);
  assert.match(generatedData, /Python mission-chain simulator/);
  assert.ok(offlineStat.size > 500_000);
  assert.match(offlineHtml, /<div id="root"><\/div>/);
  assert.match(offlineHtml, /UAV Mission Glassbox/);
  assert.match(offlineHtml, /v0\.9/);
  assert.match(offlineHtml, /renderSceneProxy/);
  assert.match(offlineHtml, /drawDrone3D/);
  assert.match(offlineHtml, /relativeMotionMetrics/);
  assert.match(offlineHtml, /single-seed-only/);
  assert.match(offlineHtml, /baseline_logistics/);
  assert.match(offlineHtml, /strict_logistics/);
  assert.match(offlineHtml, /SHARED FLEET INSPECTOR/);
  assert.match(offlineHtml, /uav-experiment-bundle\/v1/);
  assert.match(offlineHtml, /20-SEED STATISTICS/);
  assert.doesNotMatch(offlineHtml, /<script[^>]+src=/i);
  assert.doesNotMatch(offlineHtml.slice(0, offlineHtml.indexOf("<style>")), /<link[^>]+stylesheet/i);
  assert.match(packageJson, /"name": "uav-mission-glassbox"/);
  assert.match(packageJson, /"build:offline"/);
  assert.doesNotMatch(page, /SkeletonPreview|codex-preview/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});
