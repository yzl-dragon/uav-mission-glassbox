"use client";

import { useEffect, useMemo, useState } from "react";
import { EXPERIMENT_BUNDLE } from "../generated/experimentData";
import MissionMap from "./MissionMap";
import type { GhostTrail, MapDrone, MapTask, MapViewState } from "./MissionMap";
import { CRITICAL_ACTIONS, initialBatteryMap, replayFramesAt } from "../lib/replayAdapter";
import type { ExperimentReplayRequest, ReplayDroneDefinition, ReplayEnvironment, ReplayEvent, ReplayTask, ScenarioKey } from "../lib/replayAdapter";

type Scalar = string | number | null;
type Representative = {
  id: string;
  label: string;
  seed_count: number;
  configuration: Record<string, Scalar>;
  environment: ReplayEnvironment;
  summary: Record<string, Scalar>;
  tasks: ReplayTask[];
  drones: ReplayDroneDefinition[];
  timeline: ReplayEvent[];
};
type Experiment = { id: string; title: string; representatives: Representative[] };
type Bundle = { schema_version: string; simulator: { disclaimer: string }; experiments: Experiment[] };
type Side = "baseline" | "pressure";
type PairPreset = { experimentId: string; baselineId: string; pressureId: string; short: string; purpose: string; jumpLabel: string };

const BUNDLE = EXPERIMENT_BUNDLE as unknown as Bundle;
const COLORS = ["#5ae0ff", "#ffca5c", "#c69cff", "#8ce99a", "#ff8b74", "#7aa7ff", "#f783d8", "#b7e36b"];
const INITIAL_VIEW: MapViewState = { zoom: 1, pan: { xPx: 0, yPx: 0 }, projection: "isometric", focusSelected: false, selectedTrailOnly: false };
const PAIRS: PairPreset[] = [
  { experimentId: "communication_resilience", baselineId: "baseline", pressureId: "stress", short: "实验01 · 通信", purpose: "对照链路中断、缓存与延迟上传", jumpLabel: "下个通信事件" },
  { experimentId: "energy_return", baselineId: "baseline_logistics", pressureId: "strict_logistics", short: "实验02 · 电量", purpose: "对照配送基准与严格储备电量的返航触发", jumpLabel: "下个返航事件" },
  { experimentId: "thermal_compute", baselineId: "baseline_rescue", pressureId: "hot_heavy_rescue", short: "实验03 · 温度", purpose: "对照搜救基准与高温高负载的温升/冷却", jumpLabel: "下个热事件" },
  { experimentId: "multi_uav_deconfliction", baselineId: "three_uav", pressureId: "eight_uav", short: "实验04 · 多机", purpose: "三机与八机分别自动适配，对照最小间距、让行与高度层", jumpLabel: "下个解冲突事件" },
  { experimentId: "no_fly_obstacles", baselineId: "baseline", pressureId: "combined_stress", short: "实验05 · 禁飞", purpose: "对照无屏障基准与双屏障、五障碍组合压力", jumpLabel: "下个避障事件" },
];

const METRICS: Record<string, { key: string; label: string; unit?: string; rate?: boolean }[]> = {
  communication_resilience: [
    { key: "completion_rate", label: "任务完成率", rate: true }, { key: "result_return_rate", label: "结果回传率", rate: true },
    { key: "communications", label: "通信次数" }, { key: "peak_storage_mb", label: "缓存峰值", unit: "MB" },
    { key: "deferred_uploads", label: "延迟上传" }, { key: "mission_elapsed_s", label: "持续时间", unit: "s" },
  ],
  energy_return: [
    { key: "completion_rate", label: "任务完成率", rate: true }, { key: "total_energy_wh", label: "总能耗", unit: "Wh" },
    { key: "total_distance_m", label: "总航程", unit: "m" }, { key: "minimum_battery_wh", label: "最低电量", unit: "Wh" },
    { key: "turnaround_events", label: "补能/周转" }, { key: "mission_elapsed_s", label: "持续时间", unit: "s" },
  ],
  thermal_compute: [
    { key: "completion_rate", label: "任务完成率", rate: true }, { key: "maximum_temperature_c", label: "最高温度", unit: "°C" },
    { key: "thermal_hold_events", label: "冷却次数" }, { key: "local_updates", label: "本地更新" },
    { key: "total_energy_wh", label: "总能耗", unit: "Wh" }, { key: "mission_elapsed_s", label: "持续时间", unit: "s" },
  ],
  multi_uav_deconfliction: [
    { key: "completion_rate", label: "任务完成率", rate: true }, { key: "minimum_separation_m", label: "最小三维间距", unit: "m" },
    { key: "yield_events", label: "让行次数" }, { key: "vertical_deconflict_events", label: "垂直解冲突" },
    { key: "avoidance_events", label: "避让事件" }, { key: "mission_elapsed_s", label: "持续时间", unit: "s" },
  ],
  no_fly_obstacles: [
    { key: "completion_rate", label: "任务完成率", rate: true }, { key: "no_fly_avoidance_events", label: "禁飞区避让" },
    { key: "dynamic_avoidance_events", label: "动态障碍避让" }, { key: "avoidance_events", label: "总避让事件" },
    { key: "no_fly_violations", label: "禁飞区违规" }, { key: "mission_elapsed_s", label: "持续时间", unit: "s" },
  ],
};

function numberValue(value: Scalar | undefined) { return typeof value === "number" && Number.isFinite(value) ? value : 0; }
function duration(representative: Representative) { return Math.max(0, ...representative.timeline.map((event) => event.time_s)); }
function scenarioOf(representative: Representative): ScenarioKey {
  const value = representative.configuration.scenario ?? representative.summary.scenario;
  return value === "logistics" || value === "spraying" ? value : "rescue";
}
function droneCount(representative: Representative) { return new Set(representative.timeline.map((event) => event.drone_id)).size; }
function requestFor(experiment: Experiment, representative: Representative): ExperimentReplayRequest {
  return { experimentId: experiment.id, experimentTitle: experiment.title, representativeId: representative.id, representativeLabel: representative.label, configuration: representative.configuration, summary: representative.summary, tasks: representative.tasks, drones: representative.drones, timeline: representative.timeline, environment: representative.environment };
}
function sameTasks(first: Representative, second: Representative) {
  const signature = (task: ReplayTask) => `${task.task_id}:${task.x}:${task.y}:${task.z ?? 0}`;
  return first.tasks.length === second.tasks.length && first.tasks.map(signature).join("|") === second.tasks.map(signature).join("|");
}
function colorFor(id: number) { return COLORS[Math.abs(id) % COLORS.length]; }
function frameData(experiment: Experiment, representative: Representative, timeS: number) {
  const request = requestFor(experiment, representative);
  const at = Math.min(timeS, duration(representative));
  const frames = replayFramesAt(representative.timeline, at, true, initialBatteryMap(request));
  const activeTasks = new Set(frames.map((frame) => frame.taskId).filter(Boolean));
  const tasks: MapTask[] = representative.tasks.map((task) => ({
    id: task.task_id, xM: task.x, yM: task.y, zM: task.z ?? 0,
    priority: task.priority,
    state: task.completed_at !== null && task.completed_at !== undefined && task.completed_at <= at ? "done" : activeTasks.has(task.task_id) ? "active" : "pending",
  }));
  const drones: MapDrone[] = frames.map((frame) => ({
    id: frame.sourceId, name: `UAV-${String(frame.sourceId + 1).padStart(2, "0")}`, color: colorFor(frame.sourceId),
    xM: frame.xM, yM: frame.yM, zM: frame.zM, trail: frame.trail, avoidanceMode: frame.action === "YIELD" || frame.action === "DECONFLICT_CLIMB" ? "yield" : frame.action === "AVOID_DYNAMIC" || frame.action === "AVOID_NO_FLY" ? "static" : "clear",
    linkUp: frame.linkUp, linkType: frame.linkType, bandwidthKbps: frame.bandwidthKbps, pdr: frame.pdr, latencyMs: frame.latencyMs,
    storageMb: frame.storageMb, pendingResults: frame.pendingResults, batteryPct: frame.batteryPct, batteryWh: frame.batteryWh,
    temperatureC: frame.temperatureC, action: frame.action, velocity: frame.velocity,
  }));
  return { request, at, frames, tasks, drones };
}
function formatMetric(value: number, metric: { unit?: string; rate?: boolean }) {
  if (metric.rate) return `${(value * 100).toFixed(1)}%`;
  const digits = Math.abs(value) >= 100 ? 1 : Math.abs(value) >= 10 ? 2 : 3;
  return `${value.toFixed(digits)}${metric.unit ? ` ${metric.unit}` : ""}`;
}

function ComparisonMap({ side, experiment, representative, currentS, selected, view, linked, showSceneProxy, showUavModel, showEvents, ghostTrails, onSelect, onZoom, onFit, onReset, onProjection, onPan }: {
  side: Side; experiment: Experiment; representative: Representative; currentS: number; selected: number; view: MapViewState; linked: boolean;
  showSceneProxy: boolean; showUavModel: boolean; showEvents: boolean; ghostTrails: GhostTrail[];
  onSelect: (id: number) => void; onZoom: (delta: number) => void; onFit: () => void; onReset: () => void; onProjection: () => void; onPan: (pan: {xPx:number;yPx:number}) => void;
}) {
  const data = frameData(experiment, representative, currentS);
  const scenario = scenarioOf(representative);
  const ended = currentS >= duration(representative);
  const special = experiment.id;
  const safeDistance = numberValue(representative.environment.safe_distance_m as Scalar) || numberValue(representative.configuration.safe_distance_m);
  const reserve = numberValue(representative.configuration.reserve_wh) || undefined;
  const thermalLimit = numberValue(representative.configuration.thermal_limit_c) || undefined;
  return <article className={`comparison-map-card ${side}`} data-comparison-side={side}>
    <header className="comparison-map-head"><div><span>{side === "baseline" ? "A / 基准" : "B / 压力或机制"}</span><h3>{representative.label}</h3><small>experiment_bundle.json · single seed={representative.configuration.seed} · {droneCount(representative)} 架</small></div><em className={ended ? "ended" : ""}>{ended ? `该案例已结束 · 停在 T+${duration(representative).toFixed(1)}s` : `T+${data.at.toFixed(1)}s`}</em></header>
    <div className="comparison-map-controls" aria-label={`${side === "baseline" ? "基准" : "压力"}地图控制`}>
      <button onClick={() => onZoom(-.2)} disabled={view.zoom <= .5501} aria-label={`${side === "baseline" ? "基准" : "压力"}地图缩小`}>−</button><output>{Math.round(view.zoom * 100)}%</output><button onClick={() => onZoom(.2)} disabled={view.zoom >= 2.999} aria-label={`${side === "baseline" ? "基准" : "压力"}地图放大`}>＋</button>
      <button onClick={onFit}>适配</button><button onClick={onReset}>重置</button><button onClick={onProjection}>{view.projection === "isometric" ? "俯视" : "等距"}</button><span>{linked ? "视角联动" : "独立适配"}</span>
    </div>
    <div className="comparison-map-viewport" data-trajectory-source="single-seed-only">
      <MissionMap compact sceneLabel={`${experiment.title} ${representative.label}`} coordinateUnit="m" base={{xM:0,yM:0,zM:0}} baseSource="proxy"
        scenePresetKey={experiment.id === "multi_uav_deconfliction" ? "neutral" : scenario} sceneDetail="medium" tasks={data.tasks} drones={data.drones} selected={selected}
        timeline={representative.timeline} noFlyBoxes={representative.environment.no_fly_zones ?? []} proxyNoFly={[]} proxyHazards={[]} proxyDynamic={[]}
        showProxyEnvironment={false} fitLiveProxyDomain={false} showSceneProxy={showSceneProxy} showUavModel={showUavModel} showTaskTrail showEvents={showEvents}
        showCommunication={special === "communication_resilience"} showBattery={special === "energy_return"} showThermal={special === "thermal_compute"}
        showMultiSafety={special === "multi_uav_deconfliction"} showTerrain={false} showNoFly={special === "no_fly_obstacles"} showObstacles={false} showSeparation={false}
        safeDistanceM={safeDistance || undefined} reserveBatteryWh={reserve} thermalLimitC={thermalLimit} timeS={data.at} view={view} onSelect={onSelect} onPan={onPan} ghostTrails={ghostTrails}/>
    </div>
  </article>;
}

export default function ExperimentComparison() {
  const [pairIndex, setPairIndex] = useState(0);
  const preset = PAIRS[pairIndex];
  const experiment = BUNDLE.experiments.find((item) => item.id === preset.experimentId)!;
  const baseline = experiment.representatives.find((item) => item.id === preset.baselineId)!;
  const pressure = experiment.representatives.find((item) => item.id === preset.pressureId)!;
  const maxDuration = Math.max(duration(baseline), duration(pressure));
  const [currentS, setCurrentS] = useState(0), [running, setRunning] = useState(false), [speed, setSpeed] = useState(1);
  const [activeSide, setActiveSide] = useState<Side>("baseline"), [selectedDrone, setSelectedDrone] = useState(0);
  const [baselineView, setBaselineView] = useState<MapViewState>(INITIAL_VIEW), [pressureView, setPressureView] = useState<MapViewState>(INITIAL_VIEW);
  const viewCompatible = scenarioOf(baseline) === scenarioOf(pressure) && sameTasks(baseline, pressure);
  const ghostCompatible = viewCompatible && droneCount(baseline) === droneCount(pressure);
  const [linkedView, setLinkedView] = useState(viewCompatible), [ghostOverlay, setGhostOverlay] = useState(false);
  const [showSceneProxy, setShowSceneProxy] = useState(true), [showUavModel, setShowUavModel] = useState(true), [showEvents, setShowEvents] = useState(true);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCurrentS(0); setRunning(false); setSpeed(1); setActiveSide("baseline"); setSelectedDrone(0);
    setBaselineView(INITIAL_VIEW); setPressureView(INITIAL_VIEW); setLinkedView(viewCompatible); setGhostOverlay(false); setCollapsed(false);
  }, [pairIndex, viewCompatible]);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setCurrentS((value) => {
      const next = value + .12 * speed;
      if (next >= maxDuration) { setRunning(false); return maxDuration; }
      return next;
    }), 120);
    return () => window.clearInterval(timer);
  }, [running, speed, maxDuration]);

  const baselineData = useMemo(() => frameData(experiment, baseline, currentS), [experiment, baseline, currentS]);
  const pressureData = useMemo(() => frameData(experiment, pressure, currentS), [experiment, pressure, currentS]);
  const activeData = activeSide === "baseline" ? baselineData : pressureData;
  const activeRepresentative = activeSide === "baseline" ? baseline : pressure;
  const activeFrame = activeData.frames.find((frame) => frame.sourceId === selectedDrone) ?? activeData.frames[0];
  const critical = useMemo(() => [...baseline.timeline.map((event) => ({...event, side:"A"})), ...pressure.timeline.map((event) => ({...event, side:"B"}))]
    .filter((event) => (CRITICAL_ACTIONS as readonly string[]).includes(event.action)).sort((a,b) => a.time_s-b.time_s), [baseline, pressure]);
  const previousCritical = [...critical].reverse().find((event) => event.time_s < currentS - .001);
  const nextCritical = critical.find((event) => event.time_s > currentS + .001);
  const metrics = METRICS[experiment.id] ?? [];

  const updateView = (side: Side, updater: (view: MapViewState) => MapViewState) => {
    if (linkedView && viewCompatible) { setBaselineView(updater); setPressureView(updater); }
    else if (side === "baseline") setBaselineView(updater); else setPressureView(updater);
  };
  const fitView = (side: Side) => updateView(side, (view) => ({...view,zoom:1,pan:{xPx:0,yPx:0},focusSelected:false}));
  const resetView = (side: Side) => updateView(side, () => INITIAL_VIEW);
  const selectFrom = (side: Side, id: number) => { setActiveSide(side); setSelectedDrone(id); };
  const baselineGhosts: GhostTrail[] = ghostOverlay && ghostCompatible ? pressureData.drones.map((drone) => ({id:drone.id,name:`B ${drone.name}`,color:"#ffca5c",trail:drone.trail})) : [];
  const pressureGhosts: GhostTrail[] = ghostOverlay && ghostCompatible ? baselineData.drones.map((drone) => ({id:drone.id,name:`A ${drone.name}`,color:"#5ae0ff",trail:drone.trail})) : [];

  if (collapsed) return <section className="comparison-lab panel comparison-collapsed" data-comparison-lab><div><span className="panel-kicker">PHASE 4C / 基准与压力对照</span><h2>双地图同步对照已收起</h2></div><button onClick={() => setCollapsed(false)}>展开阶段 4C</button></section>;

  return <section className="comparison-lab panel" data-comparison-lab aria-labelledby="comparison-title">
    <div className="comparison-head"><div><span className="panel-kicker">PHASE 4C / SYNCHRONIZED CASE PAIR</span><h2 id="comparison-title">基准与压力单 seed 双地图同步对照</h2><p>左右轨迹、事件和世界坐标分别读取各自代表案例；共享绝对秒时间轴。20-seed 统计仅在实验工作台中展示，不生成平均轨迹。</p></div><button className="comparison-exit" onClick={() => setCollapsed(true)} aria-label="退出阶段4C对照">退出对照</button></div>
    <div className="comparison-pair-tabs" role="tablist">{PAIRS.map((pair,index) => <button key={pair.experimentId} className={index === pairIndex ? "active" : ""} onClick={() => setPairIndex(index)}><strong>{pair.short}</strong><small>{pair.purpose}</small></button>)}</div>
    <div className="comparison-shared-controls">
      <div><span>当前案例对</span><strong>{baseline.label}</strong><b>vs</b><strong>{pressure.label}</strong></div>
      <label><input type="checkbox" checked={linkedView} disabled={!viewCompatible} onChange={(event) => setLinkedView(event.target.checked)}/>联动视角</label>
      <label title={ghostCompatible ? "场景、坐标系、任务与机数一致" : "只有场景、坐标系、任务与机数一致时才可开启"}><input type="checkbox" checked={ghostOverlay} disabled={!ghostCompatible} onChange={(event) => setGhostOverlay(event.target.checked)}/>幽灵航迹</label>
      <label><input type="checkbox" checked={showSceneProxy} onChange={(event) => setShowSceneProxy(event.target.checked)}/>场景代理（不参与计算）</label>
      <label><input type="checkbox" checked={showUavModel} onChange={(event) => setShowUavModel(event.target.checked)}/>三维无人机</label>
      <label><input type="checkbox" checked={showEvents} onChange={(event) => setShowEvents(event.target.checked)}/>源事件</label>
      <em className={ghostCompatible ? "compatible" : "blocked"}>{ghostCompatible ? "允许幽灵叠加：场景/米制坐标/任务/机数一致" : "禁止幽灵叠加：机数或任务几何不可比"}</em>
    </div>
    <div className="comparison-mobile-switch" role="tablist"><button className={activeSide === "baseline" ? "active" : ""} onClick={() => setActiveSide("baseline")}>A 基准</button><button className={activeSide === "pressure" ? "active" : ""} onClick={() => setActiveSide("pressure")}>B 压力</button></div>
    <div className={`comparison-maps mobile-${activeSide}`}>
      <ComparisonMap side="baseline" experiment={experiment} representative={baseline} currentS={currentS} selected={activeSide === "baseline" ? activeFrame?.sourceId ?? 0 : selectedDrone} view={baselineView} linked={linkedView && viewCompatible} showSceneProxy={showSceneProxy} showUavModel={showUavModel} showEvents={showEvents} ghostTrails={baselineGhosts}
        onSelect={(id) => selectFrom("baseline",id)} onZoom={(delta) => updateView("baseline",(view)=>({...view,zoom:Math.max(.55,Math.min(3,view.zoom+delta))}))} onFit={()=>fitView("baseline")} onReset={()=>resetView("baseline")} onProjection={()=>updateView("baseline",(view)=>({...view,projection:view.projection==="isometric"?"top":"isometric"}))} onPan={(pan)=>updateView("baseline",(view)=>({...view,pan}))}/>
      <ComparisonMap side="pressure" experiment={experiment} representative={pressure} currentS={currentS} selected={activeSide === "pressure" ? activeFrame?.sourceId ?? 0 : selectedDrone} view={pressureView} linked={linkedView && viewCompatible} showSceneProxy={showSceneProxy} showUavModel={showUavModel} showEvents={showEvents} ghostTrails={pressureGhosts}
        onSelect={(id) => selectFrom("pressure",id)} onZoom={(delta) => updateView("pressure",(view)=>({...view,zoom:Math.max(.55,Math.min(3,view.zoom+delta))}))} onFit={()=>fitView("pressure")} onReset={()=>resetView("pressure")} onProjection={()=>updateView("pressure",(view)=>({...view,projection:view.projection==="isometric"?"top":"isometric"}))} onPan={(pan)=>updateView("pressure",(view)=>({...view,pan}))}/>
    </div>
    <div className="comparison-timeline" aria-label="阶段4C共享时间轴">
      <div className="comparison-transport"><button onClick={() => setRunning((value)=>!value)}>{running ? "Ⅱ 暂停" : "▶ 播放"}</button><button onClick={() => {setRunning(false);setCurrentS(0);}}>↺ 起点</button><button disabled={!previousCritical} onClick={() => previousCritical && setCurrentS(previousCritical.time_s)}>‹ 关键</button><button disabled={!nextCritical} onClick={() => nextCritical && setCurrentS(nextCritical.time_s)}>{preset.jumpLabel} ›</button></div>
      <strong data-comparison-time>{currentS.toFixed(1)} / {maxDuration.toFixed(1)} s</strong>
      <input aria-label="阶段4C共享回放时间" type="range" min="0" max={Math.max(1,maxDuration)} step=".1" value={currentS} onChange={(event) => {setRunning(false);setCurrentS(Number(event.target.value));}}/>
      <div className="comparison-speeds">{[1,2,4].map((value)=><button key={value} className={speed===value?"active":""} onClick={()=>setSpeed(value)}>{value}×</button>)}</div>
      <small>{nextCritical ? `下一关键：${nextCritical.side} · T+${nextCritical.time_s.toFixed(1)}s · ${nextCritical.action}` : "无后续关键事件"}</small>
    </div>
    <div className="comparison-lower">
      <aside className="comparison-fleet-inspector" data-shared-fleet-inspector><div className="comparison-inspector-head"><div><span>SHARED FLEET INSPECTOR</span><h3>共享机队检查器</h3></div><div><button className={activeSide==="baseline"?"active":""} onClick={()=>{setActiveSide("baseline");setSelectedDrone(baselineData.frames[0]?.sourceId??0);}}>A 基准</button><button className={activeSide==="pressure"?"active":""} onClick={()=>{setActiveSide("pressure");setSelectedDrone(pressureData.frames[0]?.sourceId??0);}}>B 压力</button></div></div>
        <label>无人机<select value={activeFrame?.sourceId ?? 0} onChange={(event)=>setSelectedDrone(Number(event.target.value))}>{activeData.frames.map((frame)=><option key={frame.sourceId} value={frame.sourceId}>UAV-{String(frame.sourceId+1).padStart(2,"0")}</option>)}</select></label>
        {activeFrame && <><div className="comparison-selected"><span>{activeSide==="baseline"?"A / 基准":"B / 压力"} · {activeRepresentative.label}</span><strong>UAV-{String(activeFrame.sourceId+1).padStart(2,"0")} · {activeFrame.action}</strong><small>源事件 T+{activeFrame.timeS.toFixed(1)}s · 当前主时间 T+{currentS.toFixed(1)}s</small></div><dl><div><dt>x / y / z</dt><dd>{activeFrame.xM.toFixed(2)} / {activeFrame.yM.toFixed(2)} / {activeFrame.zM.toFixed(2)} m</dd></div><div><dt>三维速度</dt><dd>{activeFrame.speedMps.toFixed(2)} m/s</dd></div><div><dt>电量</dt><dd>{activeFrame.batteryWh?.toFixed(2) ?? "—"} Wh</dd></div><div><dt>温度</dt><dd>{activeFrame.temperatureC.toFixed(2)} °C</dd></div><div><dt>链路 / 缓存</dt><dd>{activeFrame.linkUp===0?"DOWN":"UP"} / {activeFrame.storageMb?.toFixed(2)??"—"} MB</dd></div><div><dt>待上传结果</dt><dd>{activeFrame.pendingResults}</dd></div></dl></>}
      </aside>
      <div className="comparison-delta"><div><span>SINGLE-SEED DELTA / B − A</span><h3>代表案例指标差值</h3><small>单 seed 对单 seed；差值只描述这两个代表运行，不替代 20-seed 统计推断。</small></div><div className="comparison-delta-grid">{metrics.map((metric)=>{const a=numberValue(baseline.summary[metric.key]),b=numberValue(pressure.summary[metric.key]),delta=b-a;return <div key={metric.key}><span>{metric.label}</span><strong>{formatMetric(a,metric)} <i>→</i> {formatMetric(b,metric)}</strong><em>{delta>=0?"+":""}{formatMetric(delta,metric)} · B−A</em></div>;})}</div></div>
    </div>
    <p className="comparison-boundary"><strong>数据边界：</strong>两张地图仅绘制各自 single-seed 时间线；较短案例结束后冻结最后一帧，不外推。场景代理不进入自动适配或实验计算。{BUNDLE.simulator.disclaimer}</p>
  </section>;
}
