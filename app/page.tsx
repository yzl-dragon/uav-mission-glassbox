"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, CSSProperties } from "react";
import { RESEARCH_DATA } from "./generated/researchData";
import { resolveTraffic } from "./lib/traffic";
import ExperimentLab from "./components/ExperimentLab";
import MissionMap from "./components/MissionMap";
import MapTimeline from "./components/MapTimeline";
import MapLegend from "./components/MapLegend";
import MapControlDock from "./components/MapControlDock";
import ExperimentComparison from "./components/ExperimentComparison";
import type { ScenePresetKey } from "./data/sceneModels";
import type { SceneDetail } from "./lib/sceneRenderer";
import {
  experimentDuration,
  inferRepresentativeScenario,
  initialBatteryMap,
  replayFramesAt,
} from "./lib/replayAdapter";
import type {
  CoordinateUnit,
  ExperimentReplayRequest,
  ReplayEnvironment,
  ReplayEvent,
  ScenarioKey,
  TrailSample,
} from "./lib/replayAdapter";

type DataMode = "live" | "python" | "dynamics" | "external" | "experiment";
type Phase = "ASSIGN" | "FLY_AND_INFER" | "SERVICE" | "COMMUNICATE" | "LOCAL_UPDATE" | "RETURN" | "TURNAROUND" | "HOLD" | "STORE_AND_WAIT" | "DEFER_UPLOAD" | "COOL_DOWN" | "YIELD" | "DECONFLICT_CLIMB" | "AVOID_DYNAMIC" | "AVOID_NO_FLY";
type AvoidanceMode = "clear" | "static" | "yield" | "escape";
type Point = { x: number; y: number };
type MissionTask = { id: string; x: number; y: number; priority: number; title: string; detail: string; location: string; reason: string; deadline: number };
type Scenario = { name: string; shortName: string; description: string; serviceLabel: string; model: string; environment: string; accent: string; tasks: MissionTask[] };
type ResultSummary = { scenario: string; tasks_total: number; tasks_completed: number; on_time_completed: number; completion_rate: number; total_energy_wh: number; total_distance_m: number; communications: number; local_updates: number; constraint_violations: number; events: number; result_return_rate: number; dropped_data_mb: number; minimum_battery_wh: number; maximum_temperature_c: number; minimum_separation_m: number; avoidance_events: number; yield_events: number; no_fly_violations: number };
type ResultTask = { task_id: string; x: number; y: number; z?: number; priority?: number; deadline?: number; assigned_to: number | null; completed_at: number | null };
type ResearchDataset = { engine: string; timeline: ReplayEvent[]; summary: ResultSummary; tasks: ResultTask[] };
type ResearchDataMap = Record<ScenarioKey, ResearchDataset>;
type LayerState = {
  terrain: boolean; wind: boolean; noFly: boolean; obstacles: boolean; separation: boolean;
  sceneProxy: boolean; uavModel: boolean; taskTrail: boolean; events: boolean;
  communication: boolean; battery: boolean; thermal: boolean; multiSafety: boolean;
};
type TerrainHazard = { x: number; y: number; r: number; label: string; kind: "ridge" | "rubble" | "water" | "tower" | "forest"; height: number };
type ExternalSample = { time_s: number; drone_id: number; x: number; y: number; z?: number; vx?: number; vy?: number; vz?: number; battery_pct?: number; temperature_c?: number; action?: string; task_id?: string };
type ExternalReplay = { engine: string; scenario: ScenarioKey; units?: "m" | string; samples: ExternalSample[] };
type Benchmark = { model: string; params_m: number; latency_ms: number; p95_latency_ms?: number; peak_memory_mb: number; baseline_params_m?: number; device?: string; runs?: number };

type DroneState = {
  id: number; name: string; color: string; x: number; y: number; altitude: number; battery: number; temperature: number; chemical: number; speed: number;
  phase: Phase; phaseElapsed: number; plan: MissionTask[]; taskCursor: number; currentTask: MissionTask | null; completed: string[]; modelVersion: number;
  pendingResults: number; trail: Point[]; note: string; avoiding: boolean; avoidanceMode: AvoidanceMode; stuckFor: number; lastTargetDistance: number | null;
  trailSamples: TrailSample[]; coordinateUnit: CoordinateUnit; sourceTimeS?: number; batteryWh?: number;
  velocity?: { xM: number; yM: number; zM: number };
  sourceAction?: string; linkUp?: number; linkType?: string; bandwidthKbps?: number; pdr?: number; latencyMs?: number; storageMb?: number;
};

const DATA = RESEARCH_DATA as unknown as ResearchDataMap;
const BASE = { x: 50, y: 50 };
const RESERVE = 18;
const TEMP_LIMIT = 68;
const COLORS = ["#5ae0ff", "#ffca5c", "#c69cff", "#8ce99a", "#ff8b74", "#7aa7ff", "#f783d8", "#b7e36b", "#ffb36b", "#67e8c3", "#d0a3ff", "#90b8c8"];
const AVOIDANCE_LABEL: Record<AvoidanceMode, string> = { clear: "航迹清晰", static: "绕开地形", yield: "机间让行", escape: "脱困侧移" };

const SCENARIOS: Record<ScenarioKey, Scenario> = {
  logistics: {
    name: "城市物资配送", shortName: "物资配送", description: "无人机机群从联合保障站领取包裹，穿越高楼峡谷完成楼宇投递并回传签收证据。",
    serviceLabel: "投递与签收", model: "YOLO11n 障碍/目标感知 + 轻量任务评分头", environment: "简化城市街区", accent: "#ffd166",
    tasks: [
      { id: "L1", x: 67, y: 43, priority: 3, title: "社区药品", detail: "1.2 kg · 紧急药品", location: "和安社区卫生站", reason: "慢病患者急需补充处方药", deadline: 34 },
      { id: "L2", x: 82, y: 59, priority: 2, title: "生鲜补给", detail: "0.8 kg · 冷链包", location: "青禾生鲜驿站", reason: "补充当日冷链食品供应", deadline: 48 },
      { id: "L3", x: 60, y: 22, priority: 4, title: "检测试剂", detail: "1.7 kg · 医疗物资", location: "城东疾控实验室", reason: "检测试剂必须在时限内送达", deadline: 42 },
      { id: "L4", x: 26, y: 39, priority: 3, title: "应急电池", detail: "1.0 kg · 通信保障", location: "北区通信基站", reason: "停电后需要维持应急通信", deadline: 58 },
      { id: "L5", x: 35, y: 73, priority: 4, title: "血液样本", detail: "1.4 kg · 时效敏感", location: "市中心血液中心", reason: "样本需要冷链快速转运", deadline: 54 },
      { id: "L6", x: 84, y: 26, priority: 2, title: "维修备件", detail: "0.6 kg · 基础补给", location: "河西设备维修站", reason: "抢修设备正在等待专用备件", deadline: 72 },
    ],
  },
  rescue: {
    name: "灾后搜索救援", shortName: "搜索救援", description: "无人机在通信间歇可用的区域执行搜索、目标识别、风险标注与结果回传。",
    serviceLabel: "搜索与标注", model: "SegFormer-B0 区域分割 + YOLO11n 人员检测", environment: "简化灾后城区", accent: "#ff8b74",
    tasks: [
      { id: "R1", x: 20, y: 22, priority: 5, title: "坍塌区 A", detail: "高风险 · 热源异常", location: "河西居民楼 A", reason: "疑似人员被困并出现异常热源", deadline: 38 },
      { id: "R2", x: 43, y: 16, priority: 3, title: "道路断点", detail: "中风险 · 建图", location: "中轴救援通道", reason: "确认救援车辆能否安全通行", deadline: 52 },
      { id: "R3", x: 70, y: 21, priority: 5, title: "求救信号", detail: "高优先级 · 复核", location: "东南学校操场", reason: "检测到间歇性人员求救信号", deadline: 44 },
      { id: "R4", x: 86, y: 43, priority: 3, title: "临时安置点", detail: "物资缺口评估", location: "体育馆安置点", reason: "评估食品、药品和帐篷缺口", deadline: 66 },
      { id: "R5", x: 80, y: 70, priority: 4, title: "积水路段", detail: "通行风险评估", location: "滨河下穿隧道", reason: "积水可能阻断地面救援路线", deadline: 64 },
      { id: "R6", x: 55, y: 82, priority: 4, title: "失联网格", detail: "人员搜索 · 回传", location: "北山失联网格", reason: "通信中断区域需要独立人员搜索", deadline: 58 },
      { id: "R7", x: 22, y: 72, priority: 2, title: "受损桥梁", detail: "结构风险复核", location: "西岭跨河桥", reason: "复核桥面结构是否允许通行", deadline: 72 },
      { id: "R8", x: 58, y: 38, priority: 5, title: "紧急热源", detail: "人员目标确认", location: "老城商场废墟", reason: "高温目标疑似被困人员", deadline: 28 },
    ],
  },
  spraying: {
    name: "农田精准喷洒", shortName: "农田喷洒", description: "无人机依据作物风险图分区作业，在药量、电量和温度约束下覆盖目标条带。",
    serviceLabel: "定量喷洒", model: "Ag-YOLO 病虫害感知 + 轻量覆盖规划器", environment: "简化条带农田", accent: "#8ce99a",
    tasks: [
      { id: "S1", x: 22, y: 27, priority: 2, title: "作业条带 01", detail: "药量 0.7 L · 低风险", location: "西南稻田 01", reason: "低风险区域进行预防性喷洒", deadline: 38 },
      { id: "S2", x: 42, y: 26, priority: 3, title: "作业条带 02", detail: "药量 0.8 L · 中风险", location: "南部玉米田 02", reason: "监测到早期叶斑病特征", deadline: 43 },
      { id: "S3", x: 62, y: 27, priority: 4, title: "作业条带 03", detail: "药量 0.7 L · 高风险", location: "东南果园 03", reason: "高风险虫害需要优先控制", deadline: 48 },
      { id: "S4", x: 80, y: 28, priority: 2, title: "作业条带 04", detail: "药量 0.8 L · 低风险", location: "东部麦田 04", reason: "常规低剂量维护作业", deadline: 53 },
      { id: "S5", x: 24, y: 70, priority: 3, title: "作业条带 05", detail: "药量 0.7 L · 中风险", location: "西北蔬菜棚 05", reason: "温湿度异常导致病害风险上升", deadline: 58 },
      { id: "S6", x: 47, y: 70, priority: 4, title: "作业条带 06", detail: "药量 0.8 L · 高风险", location: "北部棉田 06", reason: "虫口密度超过预警阈值", deadline: 63 },
      { id: "S7", x: 72, y: 70, priority: 2, title: "作业条带 07", detail: "药量 0.7 L · 低风险", location: "东北育种田 07", reason: "保护育种样本并进行预防性作业", deadline: 68 },
    ],
  },
};

const PHASE_META: Record<Phase, { zh: string; short: string; description: string }> = {
  ASSIGN: { zh: "接收与校验任务", short: "接收任务", description: "地面端给出任务意图，无人机检查电量、载荷、时限和安全性。" },
  FLY_AND_INFER: { zh: "飞行与机载推理", short: "飞行推理", description: "沿规划航迹飞行，轻量模型持续执行障碍、风险和禁飞区感知。" },
  SERVICE: { zh: "现场任务执行", short: "执行作业", description: "到达目标点，完成投递、搜索或喷洒，并生成任务结果。" },
  COMMUNICATE: { zh: "通信与结果回传", short: "回传结果", description: "链路可用时上传结果；链路中断时先在机载端缓存。" },
  LOCAL_UPDATE: { zh: "轻量本地更新", short: "本地更新", description: "积累足够样本后，仅更新小型任务头，不训练大模型。" },
  RETURN: { zh: "安全返航", short: "安全返航", description: "在储备电量边界内返回保障站，飞控持续执行避碰约束。" },
  TURNAROUND: { zh: "补能与周转", short: "补能周转", description: "在保障站更换电池、补充载荷或药液，准备下一架次。" },
  HOLD: { zh: "等待可行任务", short: "等待", description: "暂无满足边界条件的任务，保持安全等待。" },
  STORE_AND_WAIT: { zh: "缓存并等待链路", short: "缓存等待", description: "结果已写入机载存储，任务闭环继续运行并等待可用通信窗口。" },
  DEFER_UPLOAD: { zh: "延迟结果上传", short: "延迟上传", description: "当前链路容量不足，推迟上传但不改写已生成的任务结果。" },
  COOL_DOWN: { zh: "热安全降载", short: "冷却降载", description: "温度达到安全门，暂停高功耗活动并主动冷却。" },
  YIELD: { zh: "确定性机间让行", short: "机间让行", description: "根据确定性通行权降低速度并侧向绕行，避免对称卡死。" },
  DECONFLICT_CLIMB: { zh: "垂直解冲突", short: "垂直解冲突", description: "通过改变真实飞行高度打破平面航迹冲突。" },
  AVOID_DYNAMIC: { zh: "动态障碍避让", short: "动态避障", description: "局部安全门检测到合成移动障碍并修正航迹。" },
  AVOID_NO_FLY: { zh: "禁飞区绕行", short: "禁飞区绕行", description: "依据数据源中的三维禁飞盒几何执行全局绕行。" },
};

const MODE_META: Record<DataMode, { name: string; short: string; detail: string }> = {
  live: { name: "实时任务代理", short: "实时代理", detail: "浏览器内状态机 + 风场/避障" },
  python: { name: "Python 仿真回放", short: "Python 回放", detail: "读取原 timeline.csv 与 summary.json" },
  dynamics: { name: "动力学平滑回放", short: "动力学回放", detail: "二阶插值；兼容 RotorPy/PyBullet 接口" },
  external: { name: "外部飞行日志", short: "外部日志", detail: "用户导入标准 JSON 回放" },
  experiment: { name: "单 seed 代表案例", short: "实验案例", detail: "experiment_bundle.json 只读回放" },
};

const NO_FLY_ZONES: Record<ScenarioKey, { x: number; y: number; r: number; label: string }[]> = {
  logistics: [{ x: 63, y: 56, r: 8, label: "医院净空" }, { x: 39, y: 31, r: 6, label: "临时管制" }],
  rescue: [{ x: 49, y: 49, r: 9, label: "坍塌烟柱" }, { x: 76, y: 52, r: 6, label: "直升机通道" }],
  spraying: [{ x: 54, y: 50, r: 8, label: "水源保护区" }],
};

const TERRAIN_HAZARDS: Record<ScenarioKey, TerrainHazard[]> = {
  logistics: [
    { x: 31, y: 57, r: 7, label: "高楼峡谷", kind: "tower", height: 28 },
    { x: 71, y: 73, r: 8, label: "密集塔群", kind: "tower", height: 34 },
    { x: 72, y: 34, r: 6, label: "施工吊塔", kind: "rubble", height: 20 },
  ],
  rescue: [
    { x: 29, y: 49, r: 10, label: "瓦砾陡坡", kind: "rubble", height: 17 },
    { x: 66, y: 62, r: 9, label: "洪水断面", kind: "water", height: 2 },
    { x: 64, y: 30, r: 7, label: "断壁峡口", kind: "ridge", height: 24 },
    { x: 35, y: 78, r: 6, label: "烟尘盲区", kind: "rubble", height: 15 },
  ],
  spraying: [
    { x: 34, y: 49, r: 8, label: "丘陵隆起", kind: "ridge", height: 18 },
    { x: 68, y: 51, r: 7, label: "灌溉水塘", kind: "water", height: 1 },
    { x: 86, y: 64, r: 7, label: "防风林带", kind: "forest", height: 15 },
  ],
};

function windAt(time: number, key: ScenarioKey) {
  const bias = key === "spraying" ? 1.4 : key === "rescue" ? 2.4 : 1.9;
  const x = bias + Math.sin(time / 11) * 1.3;
  const y = Math.cos(time / 14 + (key === "rescue" ? 1 : 0)) * 1.5;
  return { x, y, speed: Math.hypot(x, y) };
}

function dynamicObstacles(time: number, key: ScenarioKey) {
  const shift = key === "spraying" ? 12 : key === "rescue" ? -8 : 0;
  return [
    { x: 48 + Math.sin(time / 8) * 25, y: 36 + shift + Math.cos(time / 10) * 8, r: 5, label: "MOV-1" },
    { x: 58 + Math.cos(time / 13) * 15, y: 68 + Math.sin(time / 9) * 10, r: 4, label: "MOV-2" },
  ];
}

function asPhase(action?: string): Phase {
  return (["ASSIGN", "FLY_AND_INFER", "SERVICE", "COMMUNICATE", "LOCAL_UPDATE", "RETURN", "TURNAROUND", "HOLD", "STORE_AND_WAIT", "DEFER_UPLOAD", "COOL_DOWN", "YIELD", "DECONFLICT_CLIMB", "AVOID_DYNAMIC", "AVOID_NO_FLY"] as Phase[]).includes(action as Phase)
    ? action as Phase : "HOLD";
}

function spawnPoint(id: number, count: number): Point {
  if (count === 1) return { ...BASE };
  const ring = Math.floor(id / 6), index = id % 6, members = Math.min(6, count - ring * 6);
  const angle = index / Math.max(1, members) * Math.PI * 2 - Math.PI / 2;
  const radius = 5.5 + ring * 6.5;
  return { x: BASE.x + Math.cos(angle) * radius, y: BASE.y + Math.sin(angle) * radius };
}

function cruiseAltitude(id: number) { return 18 + (id % 4) * 4 + Math.floor(id / 4) * 1.2; }
function avoidanceNote(mode: AvoidanceMode, returning = false) {
  if (mode === "escape") return "检测到局部停滞，执行确定性侧移脱困";
  if (mode === "yield") return "按任务优先级让行，并沿统一侧向规则绕开其他无人机";
  if (mode === "static") return returning ? "返航安全过滤器正在绕开地形、障碍或禁飞区" : "安全过滤器修正航向：绕开地形、障碍或禁飞区";
  return returning ? "执行返航航迹，维持三维机间安全间隔" : "视觉模型推理，飞控补偿风场并检查局部航迹";
}

function initialDrones(scenario: Scenario, count = 3): DroneState[] {
  const sorted = [...scenario.tasks].sort((a, b) => b.priority - a.priority || a.deadline - b.deadline);
  return Array.from({ length: count }, (_, id) => {
    const spawn = spawnPoint(id, count);
    return {
      id, name: `UAV-${String(id + 1).padStart(2, "0")}`, color: COLORS[id % COLORS.length], x: spawn.x, y: spawn.y,
      altitude: 0, battery: 100, temperature: 26 + (id % 4), chemical: 100, speed: 0, phase: "ASSIGN" as Phase, phaseElapsed: id * -.36,
      plan: sorted.filter((_, index) => index % count === id), taskCursor: 0, currentTask: null, completed: [], modelVersion: 1,
      pendingResults: 0, trail: [{ ...spawn }], note: "等待调度指令", avoiding: false, avoidanceMode: "clear" as AvoidanceMode, stuckFor: 0, lastTargetDistance: null,
      trailSamples: [{ xM: spawn.x, yM: spawn.y, zM: 0, timeS: 0, action: "ASSIGN", temperatureC: 26 + (id % 4), linkUp: true }], coordinateUnit: "m",
    };
  });
}

function linkAvailable(simTime: number, droneId: number) { return Math.floor(simTime / 6 + droneId * 1.7) % 6 !== 4; }
function cloneDrone(d: DroneState): DroneState { return { ...d, completed: [...d.completed], trail: [...d.trail], trailSamples: [...d.trailSamples] }; }
function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }

function advanceDrone(source: DroneState, fleet: DroneState[], dt: number, scenario: Scenario, key: ScenarioKey, simTime: number): DroneState {
  const d = cloneDrone(source);
  const linkUp = linkAvailable(simTime, d.id);
  d.phaseElapsed += dt;
  d.temperature = Math.max(24, d.temperature - 0.035 * dt);
  d.speed = 0;
  d.avoiding = false;
  d.avoidanceMode = "clear";

  const moveToward = (target: Point, returning = false) => {
    const dx = target.x - d.x, dy = target.y - d.y, distance = Math.hypot(dx, dy);
    const velocity = returning ? 7.2 : 6.4;
    if (distance < 0.05) { d.stuckFor = 0; d.lastTargetDistance = null; return true; }
    const desiredX = dx / distance, desiredY = dy / distance;
    let ux = desiredX, uy = desiredY, trafficScale = 1;
    if (d.lastTargetDistance === null || d.lastTargetDistance - distance > .12) d.stuckFor = Math.max(0, d.stuckFor - dt * 2.5);
    else d.stuckFor += dt;
    d.lastTargetDistance = distance;
    const repel = (ox: number, oy: number, radius: number, gain: number) => {
      const rx = d.x - ox, ry = d.y - oy, gap = Math.hypot(rx, ry);
      if (gap < radius + 14 && gap > 0.01) {
        const strength = gain * (radius + 14 - gap) / (radius + 14);
        ux += (rx / gap) * strength; uy += (ry / gap) * strength; d.avoidanceMode = "static";
      }
    };
    NO_FLY_ZONES[key].forEach((zone) => repel(zone.x, zone.y, zone.r, 2.6));
    TERRAIN_HAZARDS[key].forEach((hazard) => repel(hazard.x, hazard.y, hazard.r, hazard.kind === "water" ? 2.5 : 1.9));
    dynamicObstacles(simTime, key).forEach((obstacle) => repel(obstacle.x, obstacle.y, obstacle.r, 2.2));
    const toTrafficAgent = (agent: DroneState) => ({ id: agent.id, x: agent.x, y: agent.y, altitude: agent.altitude, phase: agent.phase, battery: agent.battery, taskPriority: agent.currentTask?.priority ?? 0 });
    const traffic = resolveTraffic(toTrafficAgent(d), fleet.map(toTrafficAgent), desiredX, desiredY, RESERVE);
    ux += traffic.offsetX; uy += traffic.offsetY; trafficScale = traffic.speedScale;
    if (traffic.maneuvering) d.avoidanceMode = "yield";
    if (d.stuckFor > 2.2) {
      const side = d.id % 2 === 0 ? 1 : -1;
      ux += -desiredY * side * 1.35;
      uy += desiredX * side * 1.35;
      trafficScale = Math.max(trafficScale, .72);
      d.avoidanceMode = "escape";
    }
    d.avoiding = d.avoidanceMode !== "clear";
    const norm = Math.max(0.01, Math.hypot(ux, uy)); ux /= norm; uy /= norm;
    const wind = windAt(simTime, key);
    const effectiveVelocity = velocity * trafficScale;
    const step = Math.min(distance, effectiveVelocity * dt);
    d.x = clamp(d.x + ux * step + wind.x * dt * 0.11, 3, 97);
    d.y = clamp(d.y + uy * step + wind.y * dt * 0.11, 3, 97);
    d.speed = effectiveVelocity + wind.speed * 0.08;
    d.altitude = Math.min(cruiseAltitude(d.id), d.altitude + 8 * dt);
    const headwind = Math.max(0, -(ux * wind.x + uy * wind.y));
    d.battery = Math.max(0, d.battery - step * (scenario.shortName === "农田喷洒" ? 0.11 : 0.085) - headwind * dt * 0.02);
    d.temperature = Math.min(75, d.temperature + step * 0.055 + 0.05 * dt);
    if (!d.trail.length || Math.hypot(d.x - d.trail.at(-1)!.x, d.y - d.trail.at(-1)!.y) > 1.2) {
      d.trail.push({ x: d.x, y: d.y }); if (d.trail.length > 70) d.trail.shift();
      d.trailSamples.push({ xM: d.x, yM: d.y, zM: d.altitude, timeS: simTime, action: d.phase, temperatureC: d.temperature, linkUp });
      if (d.trailSamples.length > 70) d.trailSamples.shift();
    }
    if (distance <= step + .35) { d.stuckFor = 0; d.lastTargetDistance = null; return true; }
    return false;
  };

  if (d.battery <= RESERVE + 1 && !["RETURN", "TURNAROUND"].includes(d.phase)) {
    d.phase = "RETURN"; d.phaseElapsed = 0; d.stuckFor = 0; d.lastTargetDistance = null; d.note = "触发储备电量边界，任务中止并返航";
  }
  switch (d.phase) {
    case "ASSIGN":
      d.note = "检查优先级、时限、载荷、能源和禁飞区";
      if (d.phaseElapsed >= 2.4) {
        const nextTask = d.plan[d.taskCursor] ?? null;
        if (nextTask) { d.currentTask = nextTask; d.phase = "FLY_AND_INFER"; d.phaseElapsed = 0; d.stuckFor = 0; d.lastTargetDistance = null; d.note = `任务 ${nextTask.id} 可行，开始自主飞行`; }
        else { d.phase = d.completed.length ? "RETURN" : "HOLD"; d.phaseElapsed = 0; }
      }
      break;
    case "FLY_AND_INFER":
      if (!d.currentTask) { d.phase = "ASSIGN"; d.phaseElapsed = 0; break; }
      {
        const arrived = moveToward(d.currentTask);
        d.note = avoidanceNote(d.avoidanceMode);
        if (arrived) { d.phase = "SERVICE"; d.phaseElapsed = 0; }
      }
      break;
    case "SERVICE": {
      const duration = scenario.shortName === "搜索救援" ? 5.5 : scenario.shortName === "农田喷洒" ? 6.5 : 4.2;
      d.battery = Math.max(0, d.battery - 0.065 * dt); d.temperature = Math.min(75, d.temperature + 0.16 * dt);
      if (key === "spraying") d.chemical = Math.max(0, d.chemical - 2.4 * dt);
      d.note = `${scenario.serviceLabel} · ${Math.min(100, Math.round((d.phaseElapsed / duration) * 100))}%`;
      if (d.phaseElapsed >= duration) { if (d.currentTask) d.completed.push(d.currentTask.id); d.pendingResults += 1; d.taskCursor += 1; d.phase = "COMMUNICATE"; d.phaseElapsed = 0; d.note = "结果已生成，等待安全通信窗口"; }
      break;
    }
    case "COMMUNICATE":
      d.battery = Math.max(0, d.battery - 0.018 * dt); d.note = linkUp ? "MAVLink/ROS 2 链路可用，上传结果与遥测" : "链路暂不可用，结果保存在机载缓存";
      if (linkUp && d.phaseElapsed >= 2.8) {
        d.pendingResults = 0; const update = d.completed.length > 0 && d.completed.length % 2 === 0; const more = d.taskCursor < d.plan.length;
        d.phase = update ? "LOCAL_UPDATE" : more && key !== "logistics" ? "ASSIGN" : "RETURN"; d.phaseElapsed = 0; d.currentTask = null; d.stuckFor = 0; d.lastTargetDistance = null;
      }
      break;
    case "LOCAL_UPDATE":
      d.battery = Math.max(0, d.battery - 0.035 * dt); d.temperature = Math.min(75, d.temperature + 0.22 * dt); d.note = "仅更新轻量任务头；大模型参数保持冻结";
      if (d.phaseElapsed >= 3.2) { d.modelVersion += 1; d.phase = d.taskCursor < d.plan.length && key !== "logistics" ? "ASSIGN" : "RETURN"; d.phaseElapsed = 0; d.stuckFor = 0; d.lastTargetDistance = null; }
      break;
    case "RETURN":
      {
        const arrived = moveToward(BASE, true);
        d.note = avoidanceNote(d.avoidanceMode, true);
        if (arrived) { const berth = spawnPoint(d.id, fleet.length); d.x = berth.x; d.y = berth.y; d.altitude = 0; d.phase = "TURNAROUND"; d.phaseElapsed = 0; }
      }
      break;
    case "TURNAROUND":
      d.note = "保障站更换电池并补充载荷/药液";
      if (d.phaseElapsed >= 4) { d.battery = 100; d.chemical = 100; d.temperature = Math.max(27, d.temperature - 6); d.trail = [{ x: d.x, y: d.y }]; d.trailSamples = [{ xM: d.x, yM: d.y, zM: d.altitude, timeS: simTime, action: "TURNAROUND", temperatureC: d.temperature, linkUp }]; d.phase = d.taskCursor < d.plan.length ? "ASSIGN" : "HOLD"; d.phaseElapsed = 0; d.stuckFor = 0; d.lastTargetDistance = null; }
      break;
    case "HOLD": d.note = "任务队列已完成，在保障站安全待命"; d.altitude = 0; d.stuckFor = 0; d.lastTargetDistance = null; break;
  }
  return d;
}

function replayAvoidance(action: Phase): AvoidanceMode {
  if (action === "YIELD" || action === "DECONFLICT_CLIMB") return "yield";
  if (action === "AVOID_DYNAMIC" || action === "AVOID_NO_FLY") return "static";
  return "clear";
}

function replayDrones(key: ScenarioKey, time: number, smooth: boolean): DroneState[] {
  const dataset = DATA[key], scenario = SCENARIOS[key];
  const firstBattery = new Map<number, number>();
  dataset.timeline.forEach((event) => { if (event.battery_wh !== undefined && !firstBattery.has(event.drone_id)) firstBattery.set(event.drone_id, event.battery_wh); });
  return replayFramesAt(dataset.timeline, time, smooth, firstBattery).map((frame, index) => {
    const phase = asPhase(frame.action);
    const completed = [...new Set(dataset.timeline.filter((event) => event.drone_id === frame.sourceId && event.time_s <= time && event.action === "SERVICE" && event.task_id).map((event) => event.task_id!))];
    const plan = scenario.tasks.filter((task) => dataset.tasks.find((result) => result.task_id === task.id)?.assigned_to === frame.sourceId);
    const task = scenario.tasks.find((candidate) => candidate.id === frame.taskId) ?? null;
    return {
      id: frame.sourceId, name: `UAV-${String(frame.sourceId + 1).padStart(2, "0")}`, color: COLORS[index % COLORS.length], x: frame.xM, y: frame.yM,
      altitude: frame.zM, battery: frame.batteryPct, batteryWh: frame.batteryWh, temperature: frame.temperatureC, chemical: key === "spraying" ? clamp(100 - completed.length * 19, 0, 100) : 100,
      speed: frame.speedMps, phase, phaseElapsed: time - frame.timeS, plan, taskCursor: completed.length, currentTask: task, completed, modelVersion: frame.modelVersion,
      pendingResults: frame.pendingResults, trail: frame.trail.map((sample) => ({ x: sample.xM, y: sample.yM })), trailSamples: frame.trail, coordinateUnit: "m", sourceTimeS: frame.timeS,
      velocity: frame.velocity,
      note: `${smooth ? "二阶轨迹插值" : "Python 事件回放"} · ${PHASE_META[phase].zh} · ${frame.note}`, avoiding: replayAvoidance(phase) !== "clear", avoidanceMode: replayAvoidance(phase), stuckFor: 0, lastTargetDistance: null,
      sourceAction: frame.action, linkUp: frame.linkUp, linkType: frame.linkType, bandwidthKbps: frame.bandwidthKbps, pdr: frame.pdr, latencyMs: frame.latencyMs, storageMb: frame.storageMb,
    };
  });
}

function externalDrones(replay: ExternalReplay, time: number, scenario: Scenario): DroneState[] {
  const events: ReplayEvent[] = replay.samples.map((sample) => ({ ...sample, z: sample.z ?? 0, action: sample.action ?? "HOLD" }));
  return replayFramesAt(events, time, true).slice(0, 12).map((frame, index) => {
    const rows = replay.samples.filter((sample) => sample.drone_id === frame.sourceId);
    const phase = asPhase(frame.action);
    const completed = rows.filter((sample) => sample.time_s <= time && sample.action === "SERVICE" && sample.task_id).map((sample) => sample.task_id!);
    return {
      ...initialDrones(scenario, Math.max(1, new Set(replay.samples.map((sample) => sample.drone_id)).size))[index],
      id: frame.sourceId, name: `EXT-${String(frame.sourceId).padStart(2, "0")}`, color: COLORS[index % COLORS.length], x: frame.xM, y: frame.yM,
      altitude: frame.zM, battery: frame.batteryPct, batteryWh: frame.batteryWh, temperature: frame.temperatureC,
      speed: frame.speedMps, phase, currentTask: scenario.tasks.find((task) => task.id === frame.taskId) ?? null,
      completed, trail: frame.trail.map((sample) => ({ x: sample.xM, y: sample.yM })), trailSamples: frame.trail, coordinateUnit: replay.units === "m" ? "m" : "source", sourceTimeS: frame.timeS,
      velocity: frame.velocity,
      note: `${replay.engine} 外部日志 · ${PHASE_META[phase].zh}`, avoiding: replayAvoidance(phase) !== "clear", avoidanceMode: replayAvoidance(phase), stuckFor: 0, lastTargetDistance: null, sourceAction: frame.action,
    };
  });
}

function experimentTasks(request: ExperimentReplayRequest): MissionTask[] {
  return request.tasks.map((task) => ({
    id: task.task_id,
    x: task.x,
    y: task.y,
    priority: task.priority ?? 1,
    deadline: task.deadline ?? 0,
    title: "实验代表任务",
    detail: `世界坐标 z=${(task.z ?? 0).toFixed(1)} m`,
    location: `实验任务点 ${task.task_id}`,
    reason: "由 experiment_bundle.json 单 seed 代表案例提供",
  }));
}

function experimentDrones(request: ExperimentReplayRequest, time: number): DroneState[] {
  const tasks = experimentTasks(request);
  return replayFramesAt(request.timeline, time, true, initialBatteryMap(request)).map((frame, index) => {
    const phase = asPhase(frame.action);
    const completed = [...new Set(request.timeline.filter((event) => event.drone_id === frame.sourceId && event.time_s <= time && event.action === "SERVICE" && event.task_id).map((event) => event.task_id!))];
    const plan = tasks.filter((task) => request.tasks.find((source) => source.task_id === task.id)?.assigned_to === frame.sourceId);
    return {
      id: frame.sourceId, name: `UAV-${String(frame.sourceId + 1).padStart(2, "0")}`, color: COLORS[index % COLORS.length],
      x: frame.xM, y: frame.yM, altitude: frame.zM, battery: frame.batteryPct, batteryWh: frame.batteryWh,
      temperature: frame.temperatureC, chemical: 100, speed: frame.speedMps, phase, phaseElapsed: time - frame.timeS,
      plan, taskCursor: completed.length, currentTask: tasks.find((task) => task.id === frame.taskId) ?? null, completed,
      modelVersion: frame.modelVersion, pendingResults: frame.pendingResults,
      trail: frame.trail.map((sample) => ({ x: sample.xM, y: sample.yM })), trailSamples: frame.trail,
      coordinateUnit: "m", sourceTimeS: frame.timeS,
      velocity: frame.velocity,
      note: `单 seed 代表案例 · ${PHASE_META[phase].zh} · ${frame.note}`, avoiding: replayAvoidance(phase) !== "clear",
      avoidanceMode: replayAvoidance(phase), stuckFor: 0, lastTargetDistance: null, sourceAction: frame.action,
      linkUp: frame.linkUp, linkType: frame.linkType, bandwidthKbps: frame.bandwidthKbps, pdr: frame.pdr,
      latencyMs: frame.latencyMs, storageMb: frame.storageMb,
    };
  });
}

function IsoScene({ scenario, scenarioKey, tasks, showProxyEnvironment, drones, selected, time, layers, zoom, onSelect }: { scenario: Scenario; scenarioKey: ScenarioKey; tasks: MissionTask[]; showProxyEnvironment: boolean; drones: DroneState[]; selected: number; time: number; layers: LayerState; zoom: number; onSelect: (id: number) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hitAreas = useRef<{ id: number; x: number; y: number; r: number }[]>([]);
  const draw = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return; const rect = canvas.getBoundingClientRect(); const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = rect.width * ratio; canvas.height = rect.height * ratio; const ctx = canvas.getContext("2d"); if (!ctx) return; ctx.scale(ratio, ratio);
    const w = rect.width, h = rect.height, unit = Math.min(w / 155, h / 96) * zoom; ctx.clearRect(0, 0, w, h);
    const project = (x: number, y: number, z = 0) => ({ x: w * .5 + (x - y) * unit * .62, y: h * .48 + (x + y - 100) * unit * .31 - z * unit * .78 });
    const polygon = (points: Point[], fill: string, stroke?: string) => { ctx.beginPath(); points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); } };
    polygon([project(0, 0), project(100, 0), project(100, 100), project(0, 100)], "#102422", "rgba(145,255,215,.18)");
    for (let n = 0; n <= 100; n += 10) { const a = project(n, 0), b = project(n, 100), c = project(0, n), e = project(100, n); ctx.strokeStyle = "rgba(148,213,191,.08)"; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(e.x, e.y); ctx.stroke(); }
    const road = (x: number, y: number, rw: number, rh: number, color = "#203734") => polygon([project(x, y), project(x + rw, y), project(x + rw, y + rh), project(x, y + rh)], color);
    if (scenarioKey === "spraying") { for (let i = 0; i < 6; i++) { road(14 + i * 14, 12, 9, 70, i % 2 ? "#2d5a38" : "#376b3c"); road(16 + i * 14, 14, 1, 66, "rgba(183,222,104,.25)"); } }
    else { road(0, 45, 100, 10); road(45, 0, 10, 100); road(15, 12, 7, 75, "#1c312f"); road(78, 10, 7, 77, "#1c312f"); }
    const building = (x: number, y: number, bw: number, bd: number, bh: number, color: string) => { const a = project(x, y), b = project(x + bw, y), c = project(x + bw, y + bd), d = project(x, y + bd), at = project(x, y, bh), bt = project(x + bw, y, bh), ct = project(x + bw, y + bd, bh), dt = project(x, y + bd, bh); polygon([d, c, ct, dt], "#122a2a"); polygon([b, c, ct, bt], "#183433"); polygon([at, bt, ct, dt], color, "rgba(255,255,255,.1)"); };
    if (scenarioKey !== "spraying") [[8,8,10,9,15],[23,13,13,12,11],[59,13,14,13,17],[85,18,9,17,13],[10,70,8,15,19],[24,67,13,12,15],[59,65,12,14,10],[86,72,9,12,18],[61,39,8,7,21],[34,83,8,9,12]].forEach((b, i) => building(b[0], b[1], b[2], b[3], b[4], i % 2 ? "#31504d" : "#284542"));
    if (showProxyEnvironment && layers.terrain) TERRAIN_HAZARDS[scenarioKey].forEach((hazard, hazardIndex) => {
      const ring = Array.from({ length: 30 }, (_, i) => project(hazard.x + Math.cos(i / 30 * Math.PI * 2) * hazard.r, hazard.y + Math.sin(i / 30 * Math.PI * 2) * hazard.r));
      if (hazard.kind === "water") {
        polygon(ring, "rgba(57,142,169,.38)", "rgba(90,224,255,.48)");
        for (let offset = -3; offset <= 3; offset += 3) { const a=project(hazard.x-hazard.r*.65,hazard.y+offset,.5),b=project(hazard.x+hazard.r*.65,hazard.y+offset,.5);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.strokeStyle="rgba(160,236,255,.32)";ctx.stroke(); }
      } else if (hazard.kind === "tower") {
        polygon(ring, "rgba(255,202,92,.045)", "rgba(255,202,92,.24)");
        [[-3,-2,.6],[3,1,.82],[0,4,.5]].forEach(([ox,oy,scale],i)=>building(hazard.x+ox,hazard.y+oy,3.5,3.5,hazard.height*scale,i===1?"#6b6650":"#4f5f5a"));
      } else if (hazard.kind === "forest") {
        polygon(ring, "rgba(65,132,74,.22)", "rgba(140,233,154,.32)");
        for(let i=0;i<9;i++){const angle=i*2.39+hazardIndex,radius=(i%3)/3*hazard.r*.7,p=project(hazard.x+Math.cos(angle)*radius,hazard.y+Math.sin(angle)*radius,3+(i%3)*2);ctx.beginPath();ctx.arc(p.x,p.y,3+i%2,0,Math.PI*2);ctx.fillStyle="#4c8a58";ctx.fill();}
      } else {
        polygon(ring, hazard.kind === "ridge" ? "rgba(125,107,78,.3)" : "rgba(117,91,77,.28)", "rgba(255,179,107,.28)");
        for(let level=1;level<=3;level++){const rr=hazard.r*(1-level*.2),contour=Array.from({length:24},(_,i)=>project(hazard.x+Math.cos(i/24*Math.PI*2)*rr,hazard.y+Math.sin(i/24*Math.PI*2)*rr,level*hazard.height/4));polygon(contour,"rgba(88,76,64,.2)","rgba(214,172,120,.2)");}
      }
      const label=project(hazard.x,hazard.y,hazard.kind === "water" ? 1 : hazard.height*.45);ctx.fillStyle="#ffd6a3";ctx.font="700 8px ui-monospace";ctx.textAlign="center";ctx.fillText(`TERRAIN · ${hazard.label}`,label.x,label.y-8);
    });
    if (showProxyEnvironment && layers.noFly) NO_FLY_ZONES[scenarioKey].forEach((zone) => { const ring = Array.from({ length: 28 }, (_, i) => project(zone.x + Math.cos(i / 28 * Math.PI * 2) * zone.r, zone.y + Math.sin(i / 28 * Math.PI * 2) * zone.r)); polygon(ring, "rgba(255,85,85,.14)", "rgba(255,107,107,.65)"); const p = project(zone.x, zone.y); ctx.fillStyle = "#ff8b74"; ctx.font = "700 8px ui-monospace"; ctx.textAlign = "center"; ctx.fillText(`NFZ · ${zone.label}`, p.x, p.y + 3); });
    if (showProxyEnvironment && layers.wind) { const wind = windAt(time, scenarioKey); for (let gx = 18; gx < 95; gx += 24) for (let gy = 18; gy < 95; gy += 24) { const p = project(gx, gy, 1), q = { x: p.x + wind.x * 4, y: p.y + wind.y * 2 }; ctx.strokeStyle = "rgba(90,224,255,.38)"; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(q.x - 4, q.y - 2); ctx.lineTo(q.x - 3, q.y + 3); ctx.closePath(); ctx.fillStyle = "rgba(90,224,255,.55)"; ctx.fill(); } }
    const obstacles = showProxyEnvironment ? dynamicObstacles(time, scenarioKey) : [];
    if (layers.obstacles) obstacles.forEach((obstacle) => { const p = project(obstacle.x, obstacle.y, 12); ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(Math.PI / 4); ctx.fillStyle = "#ff9f43"; ctx.fillRect(-5, -5, 10, 10); ctx.restore(); ctx.strokeStyle = "rgba(255,159,67,.35)"; ctx.beginPath(); ctx.arc(p.x, p.y, 15, 0, Math.PI * 2); ctx.stroke(); ctx.fillStyle = "#ffc078"; ctx.font = "700 8px ui-monospace"; ctx.fillText(obstacle.label, p.x + 12, p.y - 10); });
    const base = project(BASE.x, BASE.y); ctx.fillStyle = "#eaf8f0"; ctx.fillRect(base.x - 13, base.y - 8, 26, 12); ctx.fillStyle = "#0a1718"; ctx.font = "700 9px ui-monospace"; ctx.textAlign = "center"; ctx.fillText("BASE", base.x, base.y);
    tasks.forEach((task) => { const complete = drones.some((d) => d.completed.includes(task.id)), active = drones.some((d) => d.currentTask?.id === task.id), p = project(task.x, task.y, 1); ctx.beginPath(); ctx.arc(p.x, p.y, complete ? 5 : 7, 0, Math.PI * 2); ctx.fillStyle = complete ? "#5bd3a4" : scenario.accent; ctx.fill(); ctx.strokeStyle = active ? "rgba(90,224,255,.75)" : complete ? "rgba(91,211,164,.28)" : `${scenario.accent}55`; ctx.lineWidth = active ? 11 : 8; ctx.stroke(); ctx.fillStyle = "#eaf8f0"; ctx.font = "700 10px ui-monospace"; ctx.textAlign = "left"; ctx.fillText(task.id, p.x + 10, p.y + 1); ctx.fillStyle = active ? "#8eeaff" : "#a9c7bf"; ctx.font = "600 8px Arial, sans-serif"; ctx.fillText(task.location, p.x + 10, p.y + 13); });
    if (layers.separation) for (let i = 0; i < drones.length; i++) for (let j = i + 1; j < drones.length; j++) { const a = project(drones[i].x, drones[i].y, drones[i].altitude), b = project(drones[j].x, drones[j].y, drones[j].altitude), distance = Math.hypot(drones[i].x - drones[j].x, drones[i].y - drones[j].y, drones[i].altitude - drones[j].altitude); if (distance < 24) { ctx.strokeStyle = distance < 5 ? "rgba(255,107,107,.8)" : "rgba(140,233,154,.22)"; ctx.setLineDash([3,4]); ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke(); ctx.setLineDash([]); } }
    drones.forEach((d) => { if (d.trailSamples.length > 1) { ctx.beginPath(); d.trailSamples.forEach((sample, i) => { const p = project(sample.xM, sample.yM, sample.zM); i ? ctx.lineTo(p.x,p.y) : ctx.moveTo(p.x,p.y); }); ctx.strokeStyle = `${d.color}${d.id === selected ? "b8" : "55"}`; ctx.lineWidth = d.id === selected ? 2.4 : 1.3; ctx.setLineDash([4,4]); ctx.stroke(); ctx.setLineDash([]); } });
    hitAreas.current = [];
    drones.forEach((d) => { const p = project(d.x,d.y,d.altitude), shadow = project(d.x,d.y); hitAreas.current.push({id:d.id,x:p.x,y:p.y,r:22}); ctx.beginPath(); ctx.ellipse(shadow.x,shadow.y,9,4,0,0,Math.PI*2); ctx.fillStyle="rgba(0,0,0,.3)"; ctx.fill(); if (d.id===selected) {ctx.beginPath();ctx.arc(p.x,p.y,18,0,Math.PI*2);ctx.strokeStyle=`${d.color}88`;ctx.lineWidth=6;ctx.stroke();} ctx.strokeStyle=d.avoidanceMode==="escape"?"#f783d8":d.avoidanceMode==="yield"?"#ffca5c":d.avoiding?"#ff8b74":d.color;ctx.lineWidth=2.6;ctx.beginPath();ctx.moveTo(p.x-10,p.y-7);ctx.lineTo(p.x+10,p.y+7);ctx.moveTo(p.x+10,p.y-7);ctx.lineTo(p.x-10,p.y+7);ctx.stroke();[[-10,-7],[10,-7],[-10,7],[10,7]].forEach(([ox,oy])=>{ctx.beginPath();ctx.arc(p.x+ox,p.y+oy,4,0,Math.PI*2);ctx.strokeStyle="rgba(235,255,249,.8)";ctx.lineWidth=1.2;ctx.stroke();});ctx.fillStyle=d.color;ctx.fillRect(p.x-4,p.y-3,8,6);ctx.fillStyle="#edfdf7";ctx.font="600 10px ui-monospace";ctx.textAlign="center";ctx.fillText(d.name,p.x,p.y-18);if(d.avoidanceMode!=="clear"){ctx.fillStyle=d.avoidanceMode==="escape"?"#f7a8df":d.avoidanceMode==="yield"?"#ffd77d":"#ffab96";ctx.font="700 7px ui-monospace";ctx.fillText(AVOIDANCE_LABEL[d.avoidanceMode],p.x,p.y-29);} });
  }, [scenario, scenarioKey, tasks, showProxyEnvironment, drones, selected, time, layers, zoom]);
  useEffect(() => { draw(); const observer = new ResizeObserver(draw); if (canvasRef.current) observer.observe(canvasRef.current); return () => observer.disconnect(); }, [draw]);
  return <canvas ref={canvasRef} className="mission-canvas" role="img" tabIndex={0} aria-label={`${scenario.name}无人机仿真场景；点击无人机可查看其遥测与任务`} onPointerDown={event=>{const rect=event.currentTarget.getBoundingClientRect(),x=event.clientX-rect.left,y=event.clientY-rect.top;const target=[...hitAreas.current].sort((a,b)=>Math.hypot(x-a.x,y-a.y)-Math.hypot(x-b.x,y-b.y)).find(area=>Math.hypot(x-area.x,y-area.y)<=area.r);if(target)onSelect(target.id);}} onKeyDown={event=>{if(!drones.length)return;const index=Math.max(0,drones.findIndex(d=>d.id===selected));if(event.key==="ArrowRight"||event.key==="ArrowDown"){event.preventDefault();onSelect(drones[(index+1)%drones.length].id);}if(event.key==="ArrowLeft"||event.key==="ArrowUp"){event.preventDefault();onSelect(drones[(index-1+drones.length)%drones.length].id);}}}/>;
}

function MetricBar({ value, max = 100, tone }: { value: number; max?: number; tone: "cyan" | "amber" | "violet" | "red" }) { return <span className="metric-track"><span className={`metric-fill ${tone}`} style={{ width: `${Math.min(100, value / max * 100)}%` }} /></span>; }

function FederatedChart({ heterogeneity }: { heterogeneity: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const curves = useMemo(() => Array.from({ length: 31 }, (_, round) => ({ round, avg: .44 + (1 - Math.exp(-round/7.8)) * (.39 - .09*heterogeneity), prox: .44 + (1 - Math.exp(-round/6.5)) * (.42 - .045*heterogeneity), scaffold: .44 + (1 - Math.exp(-round/5.8)) * (.44 - .025*heterogeneity) })), [heterogeneity]);
  useEffect(() => { const canvas = ref.current; if (!canvas) return; const rect = canvas.getBoundingClientRect(), ratio = Math.min(2, window.devicePixelRatio || 1); canvas.width=rect.width*ratio;canvas.height=rect.height*ratio;const ctx=canvas.getContext("2d");if(!ctx)return;ctx.scale(ratio,ratio);ctx.clearRect(0,0,rect.width,rect.height);const pad={l:35,r:12,t:14,b:24},cw=rect.width-pad.l-pad.r,ch=rect.height-pad.t-pad.b;ctx.strokeStyle="rgba(164,221,203,.12)";ctx.fillStyle="#78968f";ctx.font="8px ui-monospace";for(let i=0;i<=4;i++){const y=pad.t+ch*i/4;ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(rect.width-pad.r,y);ctx.stroke();ctx.fillText((.9-i*.125).toFixed(2),3,y+3);} const draw=(key:"avg"|"prox"|"scaffold",color:string)=>{ctx.beginPath();curves.forEach((p,i)=>{const x=pad.l+p.round/30*cw,y=pad.t+(0.9-p[key])/0.5*ch;i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.strokeStyle=color;ctx.lineWidth=2;ctx.stroke();};draw("avg","#ffca5c");draw("prox","#5ae0ff");draw("scaffold","#8ce99a");ctx.fillStyle="#78968f";ctx.fillText("0",pad.l,pad.t+ch+16);ctx.fillText("30 rounds",rect.width-58,pad.t+ch+16); }, [curves]);
  const last=curves.at(-1)!; const ideal=.9, reduction=((ideal-last.avg)-(ideal-last.scaffold))/(ideal-last.avg)*100;
  return <div className="federated-chart"><canvas ref={ref} /><div className="chart-legend"><span><i className="fedavg"/>FedAvg {(last.avg*100).toFixed(1)}%</span><span><i className="fedprox"/>FedProx {(last.prox*100).toFixed(1)}%</span><span><i className="scaffold"/>SCAFFOLD {(last.scaffold*100).toFixed(1)}%</span><strong>损失降低 {reduction.toFixed(1)}%</strong></div></div>;
}

export default function Home() {
  const [scenarioKey, setScenarioKey] = useState<ScenarioKey>("logistics"), scenario = SCENARIOS[scenarioKey];
  const [dataMode, setDataMode] = useState<DataMode>("live");
  const [fleetSize, setFleetSize] = useState(3);
  const [drones, setDrones] = useState<DroneState[]>(() => initialDrones(SCENARIOS.logistics, 3));
  const [selected, setSelected] = useState(0), [running, setRunning] = useState(true), [speed, setSpeed] = useState(1), [simTime, setSimTime] = useState(0);
  const [layers, setLayers] = useState<LayerState>({
    terrain: true, wind: true, noFly: true, obstacles: true, separation: true,
    sceneProxy: true, uavModel: true, taskTrail: true, events: true,
    communication: false, battery: false, thermal: false, multiSafety: false,
  });
  const [sceneDetail, setSceneDetail] = useState<SceneDetail>("high");
  const [mapZoom, setMapZoom] = useState(1), [mapPan, setMapPan] = useState({ xPx: 0, yPx: 0 });
  const [mapProjection, setMapProjection] = useState<"isometric" | "top">("isometric");
  const [focusSelected, setFocusSelected] = useState(false), [selectedTrailOnly, setSelectedTrailOnly] = useState(false);
  const [focusMode, setFocusMode] = useState(false), [telemetryOpen, setTelemetryOpen] = useState(true), [auxiliaryControlsOpen, setAuxiliaryControlsOpen] = useState(false);
  const [mapHeaderHeight, setMapHeaderHeight] = useState(62);
  const [actionFilter, setActionFilter] = useState("ALL");
  const [dispatchTaskId, setDispatchTaskId] = useState(SCENARIOS.logistics.tasks[0].id), [dispatchMessage, setDispatchMessage] = useState("");
  const [externalReplay, setExternalReplay] = useState<ExternalReplay | null>(null), [importError, setImportError] = useState("");
  const [experimentReplay, setExperimentReplay] = useState<ExperimentReplayRequest | null>(null);
  const [benchmark, setBenchmark] = useState<Benchmark | null>(null), [heterogeneity, setHeterogeneity] = useState(.72);
  const replayInput = useRef<HTMLInputElement>(null), benchmarkInput = useRef<HTMLInputElement>(null), mapPanelRef = useRef<HTMLDivElement>(null), mapHeaderRef = useRef<HTMLDivElement>(null), selectedDetailRef = useRef<HTMLDivElement>(null), telemetryToggleRef = useRef<HTMLButtonElement>(null);

  const buildAt = useCallback((mode: DataMode, key: ScenarioKey, time: number, external = externalReplay, experiment = experimentReplay) => mode === "python" ? replayDrones(key,time,false) : mode === "dynamics" ? replayDrones(key,time,true) : mode === "external" && external ? externalDrones(external,time,SCENARIOS[key]) : mode === "experiment" && experiment ? experimentDrones(experiment,time) : initialDrones(SCENARIOS[key],fleetSize), [experimentReplay,externalReplay,fleetSize]);
  const reset = useCallback((key = scenarioKey, mode = dataMode) => { const next=buildAt(mode,key,0);setSimTime(0);setSelected(next[0]?.id??0);setDrones(next); }, [scenarioKey,dataMode,buildAt]);
  const changeScenario = (key: ScenarioKey) => { const nextMode=dataMode==="experiment"?"live":dataMode;setScenarioKey(key);setDataMode(nextMode);setDispatchTaskId(SCENARIOS[key].tasks[0].id);setDispatchMessage("");setSimTime(0);setSelected(0);setDrones(buildAt(nextMode,key,0));setRunning(true); };
  const changeMode = (mode: DataMode) => { if (mode === "experiment") return;if (mode === "external" && !externalReplay) { replayInput.current?.click(); return; } const next=buildAt(mode,scenarioKey,0);setDataMode(mode);setDispatchMessage("");setSimTime(0);setSelected(next[0]?.id??0);setDrones(next);setRunning(true); };
  const selectDrone = useCallback((id: number) => { setSelected(id); if (!focusMode && telemetryOpen) window.requestAnimationFrame(()=>selectedDetailRef.current?.scrollIntoView({behavior:"smooth",block:"nearest"})); }, [focusMode,telemetryOpen]);
  const changeFleetSize = (value: number) => { const count=clamp(Math.round(value),1,12);setFleetSize(count);setDataMode("live");setSimTime(0);setSelected(0);setDispatchMessage(`机群已重组为 ${count} 架，任务按优先级重新分配`);setDrones(initialDrones(scenario,count));setRunning(true); };
  const toggleFocusMode = () => setFocusMode((value) => !value);
  const closeTelemetry = useCallback(() => {
    setTelemetryOpen(false);
    window.requestAnimationFrame(() => telemetryToggleRef.current?.focus());
  }, []);
  const replayRepresentative = (request: ExperimentReplayRequest) => {
    const key = inferRepresentativeScenario(request);
    const firstId = [...new Set(request.timeline.map((event) => event.drone_id))].sort((a,b)=>a-b)[0] ?? 0;
    setExperimentReplay(request); setScenarioKey(key); setDataMode("experiment"); setSimTime(0); setSelected(firstId);
    setDrones(experimentDrones(request,0)); setRunning(false); setActionFilter("ALL"); setMapZoom(1); setMapPan({xPx:0,yPx:0});
    setFocusSelected(false); setDispatchMessage(""); setTelemetryOpen(true);
    setLayers((current)=>({
      ...current,
      sceneProxy:true,uavModel:true,taskTrail:true,events:true,
      communication:request.experimentId==="communication_resilience",
      battery:request.experimentId==="energy_return",
      thermal:request.experimentId==="thermal_compute",
      multiSafety:request.experimentId==="multi_uav_deconfliction",
      noFly:request.experimentId==="no_fly_obstacles" || current.noFly,
      obstacles:request.experimentId==="no_fly_obstacles" || current.obstacles,
    }));
    window.requestAnimationFrame(()=>mapPanelRef.current?.scrollIntoView({behavior:"smooth",block:"start"}));
  };
  const assignTask = () => {
    if (dataMode !== "live") { setDispatchMessage("回放数据不可改写；请先切换到“实时代理”再下发任务。"); return; }
    const task=scenario.tasks.find(item=>item.id===dispatchTaskId), target=drones.find(item=>item.id===selected); if(!task||!target)return;
    if(drones.some(item=>item.currentTask?.id===task.id&&item.id!==selected&&["FLY_AND_INFER","SERVICE"].includes(item.phase))){setDispatchMessage(`${task.id} 正在由其他无人机执行，不能中途转派。`);return;}
    const reopening=drones.some(item=>item.completed.includes(task.id));
    setDrones(current=>current.map(source=>{const d=cloneDrone(source);d.completed=d.completed.filter(id=>id!==task.id);const active=d.currentTask&&["FLY_AND_INFER","SERVICE"].includes(d.phase)?d.currentTask:null,remaining=d.plan.slice(d.taskCursor).filter(item=>item.id!==task.id&&item.id!==active?.id&&!d.completed.includes(item.id));if(d.id===selected){const canStartNow=["HOLD","ASSIGN"].includes(d.phase);d.plan=active?[active,task,...remaining]:[task,...remaining];d.taskCursor=0;if(!active){d.currentTask=null;if(canStartNow){d.phase="ASSIGN";d.phaseElapsed=2.4;}}d.note=active?`地面端已将 ${task.id} 插入下一任务位`:canStartNow?`地面端下发 ${task.id}，正在进行可行性校验`:`地面端已排入 ${task.id}，当前阶段结束后执行`;}else{d.plan=active?[active,...remaining]:remaining;d.taskCursor=0;if(!active&&d.phase==="HOLD"&&remaining.length){d.phase="ASSIGN";d.phaseElapsed=0;}}return d;}));
    setDispatchMessage(`${task.id} · ${task.location} ${reopening?"已重新开启并":"已"}下发给 ${target.name}`);
  };

  useEffect(() => { if (!running) return; const timer=window.setInterval(()=>{const dt=.12*speed;setSimTime(current=>{let next=current+dt;let max=Infinity;if(dataMode==="python"||dataMode==="dynamics")max=Math.max(...DATA[scenarioKey].timeline.map(e=>e.time_s));if(dataMode==="external"&&externalReplay)max=Math.max(...externalReplay.samples.map(e=>e.time_s));if(dataMode==="experiment"&&experimentReplay)max=experimentDuration(experimentReplay);if(next>max)next=0;if(dataMode==="live")setDrones(currentDrones=>currentDrones.map(d=>advanceDrone(d,currentDrones,dt,scenario,scenarioKey,next)));else setDrones(buildAt(dataMode,scenarioKey,next));return next;});},120);return()=>window.clearInterval(timer);},[running,speed,dataMode,scenarioKey,scenario,externalReplay,experimentReplay,buildAt]);

  useEffect(() => {
    const header = mapHeaderRef.current;
    if (!header) return;
    const update = () => setMapHeaderHeight(Math.ceil(header.getBoundingClientRect().height));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  const importReplay = async (event: ChangeEvent<HTMLInputElement>) => { const file=event.target.files?.[0];if(!file)return;try{const payload=JSON.parse(await file.text()) as ExternalReplay;if(!payload.samples?.length)throw new Error("缺少 samples");const normalized={...payload,scenario:payload.scenario??scenarioKey,engine:payload.engine??file.name};const next=externalDrones(normalized,0,SCENARIOS[normalized.scenario]);setExternalReplay(normalized);setScenarioKey(normalized.scenario);setDispatchTaskId(SCENARIOS[normalized.scenario].tasks[0].id);setDataMode("external");setSimTime(0);setSelected(next[0]?.id??0);setDrones(next);setImportError("");setRunning(true);}catch(error){setImportError(`无法读取外部日志：${error instanceof Error?error.message:"格式错误"}`);}event.target.value=""; };
  const importBenchmark = async (event: ChangeEvent<HTMLInputElement>) => { const file=event.target.files?.[0];if(!file)return;try{const payload=JSON.parse(await file.text()) as Benchmark;if(!payload.model||!Number.isFinite(payload.latency_ms)||!Number.isFinite(payload.peak_memory_mb))throw new Error("字段不完整");setBenchmark(payload);setImportError("");}catch(error){setImportError(`无法读取模型指标：${error instanceof Error?error.message:"格式错误"}`);}event.target.value=""; };

  const selectedDrone=drones.find(d=>d.id===selected)??drones[0], completedIds=useMemo(()=>new Set(drones.flatMap(d=>d.completed)),[drones]), completed=completedIds.size;
  const dispatchTask=scenario.tasks.find(task=>task.id===dispatchTaskId)??scenario.tasks[0];
  const avgBattery=drones.reduce((sum,d)=>sum+d.battery,0)/Math.max(1,drones.length),maxTemp=drones.length?Math.max(...drones.map(d=>d.temperature)):0;
  const corePhases: Phase[]=["ASSIGN","FLY_AND_INFER","SERVICE","COMMUNICATE","LOCAL_UPDATE","RETURN"];
  const phaseSequence: Phase[]=selectedDrone&&!corePhases.includes(selectedDrone.phase)?[...corePhases,selectedDrone.phase]:corePhases;
  const result=DATA[scenarioKey].summary;
  const activeResult: ResultSummary | null = dataMode==="external"||dataMode==="live" ? null : dataMode==="experiment"&&experimentReplay ? experimentReplay.summary as unknown as ResultSummary : result;
  const wind=windAt(simTime,scenarioKey);
  const activeTimeline: ReplayEvent[] = dataMode==="python"||dataMode==="dynamics" ? DATA[scenarioKey].timeline
    : dataMode==="experiment"&&experimentReplay ? experimentReplay.timeline
    : dataMode==="external"&&externalReplay ? externalReplay.samples.map((sample)=>({...sample,z:sample.z??0,action:sample.action??"HOLD"}))
    : [];
  const replayDuration = dataMode==="experiment"&&experimentReplay ? experimentDuration(experimentReplay)
    : activeTimeline.length ? Math.max(...activeTimeline.map((event)=>event.time_s)) : simTime;
  const displayTasks = useMemo(()=>dataMode==="experiment"&&experimentReplay ? experimentTasks(experimentReplay)
    : dataMode==="python"||dataMode==="dynamics" ? DATA[scenarioKey].tasks.map((source)=>{const semantic=scenario.tasks.find((task)=>task.id===source.task_id)??scenario.tasks[0];return{...semantic,id:source.task_id,x:source.x,y:source.y,priority:source.priority??semantic.priority,deadline:source.deadline??semantic.deadline};})
    : dataMode==="external" ? []
    : scenario.tasks,[dataMode,experimentReplay,scenario,scenarioKey]);
  const mapTasks = displayTasks.map((task)=>({id:task.id,xM:task.x,yM:task.y,zM:dataMode==="experiment"&&experimentReplay?experimentReplay.tasks.find((source)=>source.task_id===task.id)?.z??0:DATA[scenarioKey].tasks.find((source)=>source.task_id===task.id)?.z??0,state:(completedIds.has(task.id)?"done":drones.some((drone)=>drone.currentTask?.id===task.id)?"active":"pending") as "done"|"active"|"pending",priority:task.priority}));
  const replayEnvironment: ReplayEnvironment = dataMode==="experiment"&&experimentReplay ? experimentReplay.environment : {};
  const noFlyBoxes = replayEnvironment.no_fly_zones?.filter((zone)=>zone.geometry==="axis_aligned_box")??[];
  const dynamicObstacleCount = dataMode==="live" ? 2 : replayEnvironment.dynamic_obstacles?.count??0;
  const safeDistanceM = dataMode==="live" ? 5 : dataMode==="experiment" ? (replayEnvironment.safe_distance_m ?? (Number(experimentReplay?.configuration.safe_distance_m) || undefined)) : undefined;
  const coordinateUnit: CoordinateUnit = dataMode==="external"&&externalReplay?.units!=="m" ? "source" : "m";
  const scenePresetKey: ScenePresetKey = dataMode==="experiment"&&experimentReplay?.experimentId==="multi_uav_deconfliction" ? "neutral" : scenarioKey;
  const sceneProxyLabel = scenePresetKey==="logistics"?"城市配送代理模型":scenePresetKey==="rescue"?"灾害搜救代理模型":scenePresetKey==="spraying"?"农田喷洒代理模型":"中性任务空间代理模型";
  const mapDataSourceLabel = dataMode==="experiment"?"实验数据层：experiment_bundle.json":dataMode==="live"?"数据层：实时任务代理":dataMode==="python"?"数据层：Python timeline.csv":dataMode==="dynamics"?"数据层：平滑动力学代理":`数据层：${externalReplay?.engine??"外部飞行日志"}`;
  const baseSource: "data"|"proxy" = dataMode==="live" ? "data" : "proxy";
  const reserveBatteryWh = dataMode==="experiment" ? (Number(experimentReplay?.configuration.reserve_wh) || undefined) : undefined;
  const thermalLimitC = dataMode==="live" ? TEMP_LIMIT : dataMode==="experiment" ? (Number(experimentReplay?.configuration.thermal_limit_c) || undefined) : undefined;
  const hasCommunicationData = dataMode==="live" || drones.some((drone)=>drone.linkUp!==undefined||drone.bandwidthKbps!==undefined||drone.storageMb!==undefined);
  const hasBatteryData = dataMode==="live" || drones.some((drone)=>drone.batteryWh!==undefined);
  const hasThermalData = drones.some((drone)=>Number.isFinite(drone.temperature));
  const hasMultiSafetyData = coordinateUnit==="m" && drones.length>1;
  const seekTime = (timeS: number) => { if(dataMode==="live")return;const next=clamp(timeS,0,replayDuration);setRunning(false);setSimTime(next);setDrones(buildAt(dataMode,scenarioKey,next)); };
  const resetView = () => { setMapZoom(1); setMapPan({xPx:0,yPx:0}); setFocusSelected(false); setSelectedTrailOnly(false); setMapProjection("isometric"); };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, select, textarea, [contenteditable='true']")) return;
      const insideMap = !!target && !!mapPanelRef.current?.contains(target);
      if (!focusMode && !insideMap) return;
      if (event.key === "+" || event.key === "=") { event.preventDefault(); setMapZoom(value => clamp(value + .2, .55, 3)); }
      else if (event.key === "-") { event.preventDefault(); setMapZoom(value => clamp(value - .2, .55, 3)); }
      else if (event.key === "0") { event.preventDefault(); resetView(); }
      else if (event.key.toLowerCase() === "t") { event.preventDefault(); setTelemetryOpen(value => !value); }
      else if (event.key === "Escape" && focusMode) { event.preventDefault(); setFocusMode(false); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [focusMode]);
  const modelMetric=benchmark??{model:"等待导入真实 ONNX 基准",params_m:0,latency_ms:0,peak_memory_mb:0,baseline_params_m:0,device:"—"};
  const paramRatio=modelMetric.baseline_params_m&&modelMetric.params_m?modelMetric.params_m/modelMetric.baseline_params_m:null;
  const layerControls: {key:keyof LayerState;label:string;available:boolean;reason?:string}[] = [
    {key:"uavModel",label:"三维无人机",available:true},
    {key:"sceneProxy",label:"场景代理",available:true},
    {key:"taskTrail",label:"任务/航迹",available:true},
    {key:"events",label:"源事件",available:dataMode==="live"||activeTimeline.length>0,reason:"数据源未提供事件"},
    {key:"noFly",label:"禁飞区",available:dataMode==="live"||noFlyBoxes.length>0,reason:"数据源未提供禁飞几何"},
    {key:"communication",label:"通信",available:hasCommunicationData,reason:"数据源未提供链路/缓存字段"},
    {key:"battery",label:"电量",available:hasBatteryData,reason:"数据源未提供电量序列"},
    {key:"thermal",label:"温度",available:hasThermalData,reason:"数据源未提供温度序列"},
    {key:"multiSafety",label:"多机冲突",available:hasMultiSafetyData,reason:"需要米制多机数据"},
    ...(dataMode==="live" ? [
      {key:"terrain" as const,label:"复杂地形",available:true},
      {key:"wind" as const,label:"风场",available:true},
      {key:"obstacles" as const,label:"动态障碍",available:true},
      {key:"separation" as const,label:"机间距",available:true},
    ] : []),
  ];

  return <main className="app-shell">
    <input ref={replayInput} className="hidden-input" type="file" accept=".json" onChange={importReplay}/><input ref={benchmarkInput} className="hidden-input" type="file" accept=".json" onChange={importBenchmark}/>
    <header className="topbar"><div className="brand-block"><div className="brand-mark">U</div><div><p className="eyebrow">课题无人系统 · 数据与约束玻璃箱</p><h1>UAV Mission Glassbox</h1></div></div><div className="scenario-tabs" role="tablist">{(Object.keys(SCENARIOS) as ScenarioKey[]).map(key=><button key={key} className={scenarioKey===key?"active":""} onClick={()=>changeScenario(key)}>{SCENARIOS[key].shortName}</button>)}</div><div className="clock-block"><span className={running?"live-dot":"live-dot paused"}/><div><small>{MODE_META[dataMode].short}</small><strong>T + {simTime.toFixed(1)} s</strong></div></div></header>
    <section className="mission-intro"><div><span className="section-index">01 / MISSION & DATA</span><h2>{dataMode==="experiment"?experimentReplay?.experimentTitle:scenario.name}</h2><p>{dataMode==="experiment"?`${experimentReplay?.representativeLabel}；单 seed 轨迹用于动作与航迹审查，不作为 20-seed 统计均值。`:scenario.description}</p></div><div className="top-metrics"><div><span>当前完成</span><strong>{completed}<small> / {displayTasks.length}</small></strong></div><div><span>平均电量</span><strong>{avgBattery.toFixed(0)}<small>%</small></strong></div><div><span>最高温度</span><strong>{maxTemp.toFixed(1)}<small>°C</small></strong></div><div><span>风速</span><strong>{dataMode==="live"?wind.speed.toFixed(1):"—"}<small>{dataMode==="live"?"m/s":"未混用代理"}</small></strong></div></div></section>
    <section className="source-bar"><div className="source-modes">{(Object.keys(MODE_META) as DataMode[]).filter((mode)=>mode!=="experiment").map(mode=><button key={mode} className={dataMode===mode?"active":""} onClick={()=>changeMode(mode)}><strong>{MODE_META[mode].short}</strong><small>{MODE_META[mode].detail}</small></button>)}</div>{activeResult?<div className="actual-summary"><span>{dataMode==="experiment"?"当前单 seed 代表案例":"当前 Python 数据源"}</span><b>成功率 {(activeResult.completion_rate*100).toFixed(0)}%</b><b>回传率 {(activeResult.result_return_rate*100).toFixed(0)}%</b><b>能耗 {activeResult.total_energy_wh.toFixed(1)} Wh</b><b>违规 {activeResult.constraint_violations}</b></div>:<div className="actual-summary source-warning"><span>{dataMode==="live"?"实时代理当前轮":"外部日志轨迹回放"}</span><b>{dataMode==="live"?"不复用 Python 或实验案例汇总":"未携带汇总指标，不显示旧基准数值"}</b></div>}</section>
    {importError&&<div className="import-error">{importError}</div>}
    <section className={`workspace-grid ${focusMode?"map-focus":""} ${telemetryOpen?"telemetry-open":"telemetry-closed"}`} ref={mapPanelRef} style={{"--map-header-height":`${mapHeaderHeight}px`} as CSSProperties}>
      <div className="map-panel panel">
        <div className="panel-head overlay-head" ref={mapHeaderRef}><div><span className="panel-kicker">ENVIRONMENT / {dataMode==="live"?scenario.environment:"WORLD-COORDINATE REPLAY"}</span><h3>{dataMode==="experiment"?`${experimentReplay?.experimentTitle} · ${experimentReplay?.representativeLabel}`:dataMode==="live"?"任务空间、复杂地形与实时航迹":"数据源任务、真实高度与回放航迹"}</h3></div><div className="layer-controls">{layerControls.map(item=><button key={item.key} className={`${layers[item.key]?"active":""} ${item.available?"":"unavailable"}`} disabled={!item.available} title={item.available?item.label:item.reason} onClick={()=>setLayers(v=>({...v,[item.key]:!v[item.key]}))}>{item.label}</button>)}<label className="scene-detail">模型<select aria-label="场景代理细节" value={sceneDetail} onChange={event=>setSceneDetail(event.target.value as SceneDetail)}><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></label></div></div>
        <div className="map-source-boundary"><span>{mapDataSourceLabel} · 任务、无人机、真实航迹与源事件优先</span><strong>{layers.sceneProxy?`场景背景：${sceneProxyLabel}（不参与计算）`:"场景代理已关闭"}</strong></div>
        {dataMode==="experiment"&&<div className="representative-map-stamp">单 seed 代表案例 · 非 20-seed 均值</div>}
        <MissionMap
          sceneLabel={dataMode==="experiment"?experimentReplay?.representativeLabel??scenario.name:scenario.name}
          coordinateUnit={coordinateUnit}
          base={dataMode==="live"?{xM:BASE.x,yM:BASE.y,zM:0}:{xM:0,yM:0,zM:0}}
          baseSource={baseSource}
          scenePresetKey={scenePresetKey}
          sceneDetail={sceneDetail}
          tasks={mapTasks}
          drones={drones.map((drone)=>({
            id:drone.id,name:drone.name,color:drone.color,xM:drone.x,yM:drone.y,zM:drone.altitude,
            trail:drone.trailSamples,avoidanceMode:drone.avoidanceMode,
            linkUp:dataMode==="live"?(linkAvailable(simTime,drone.id)?1:0):drone.linkUp,
            linkType:dataMode==="live"?"MAVLink/ROS 2":drone.linkType,
            bandwidthKbps:drone.bandwidthKbps,pdr:drone.pdr,latencyMs:drone.latencyMs,storageMb:drone.storageMb,
            pendingResults:drone.pendingResults,batteryPct:drone.battery,batteryWh:drone.batteryWh,
            temperatureC:drone.temperature,action:drone.sourceAction??drone.phase,velocity:drone.velocity,
          }))}
          selected={selected}
          timeline={activeTimeline}
          noFlyBoxes={noFlyBoxes}
          proxyNoFly={NO_FLY_ZONES[scenarioKey].map((zone)=>({xM:zone.x,yM:zone.y,radiusM:zone.r,label:zone.label}))}
          proxyHazards={TERRAIN_HAZARDS[scenarioKey].map((hazard)=>({xM:hazard.x,yM:hazard.y,zM:hazard.height,radiusM:hazard.r,label:hazard.label,kind:hazard.kind}))}
          proxyDynamic={(dataMode==="live"?dynamicObstacles(simTime,scenarioKey):[]).map((obstacle)=>({xM:obstacle.x,yM:obstacle.y,radiusM:obstacle.r,label:obstacle.label}))}
          showProxyEnvironment={dataMode==="live"}
          fitLiveProxyDomain={dataMode==="live"}
          showSceneProxy={layers.sceneProxy}
          showUavModel={layers.uavModel}
          showTaskTrail={layers.taskTrail}
          showEvents={layers.events}
          showCommunication={layers.communication&&hasCommunicationData}
          showBattery={layers.battery&&hasBatteryData}
          showThermal={layers.thermal&&hasThermalData}
          showMultiSafety={layers.multiSafety&&hasMultiSafetyData}
          showTerrain={layers.terrain}
          showNoFly={layers.noFly}
          showObstacles={layers.obstacles}
          showSeparation={layers.separation}
          safeDistanceM={safeDistanceM}
          reserveBatteryWh={reserveBatteryWh}
          thermalLimitC={thermalLimitC}
          timeS={simTime}
          view={{zoom:mapZoom,pan:mapPan,projection:mapProjection,focusSelected,selectedTrailOnly}}
          onSelect={selectDrone}
          onPan={setMapPan}
        />
        <MapControlDock zoom={mapZoom} projection={mapProjection} focusSelected={focusSelected} selectedTrailOnly={selectedTrailOnly} focusMode={focusMode} telemetryOpen={telemetryOpen} auxiliaryOpen={auxiliaryControlsOpen} telemetryToggleRef={telemetryToggleRef}
          onZoomOut={()=>setMapZoom(value=>clamp(value-.2,.55,3))} onZoomIn={()=>setMapZoom(value=>clamp(value+.2,.55,3))}
          onFit={()=>{setMapZoom(1);setMapPan({xPx:0,yPx:0});setFocusSelected(false);}} onReset={resetView}
          onToggleTelemetry={()=>setTelemetryOpen(value=>!value)} onToggleFocusMode={toggleFocusMode} onToggleAuxiliary={()=>setAuxiliaryControlsOpen(value=>!value)}
          onToggleFocusSelected={()=>setFocusSelected(value=>!value)} onToggleSelectedTrail={()=>setSelectedTrailOnly(value=>!value)} onToggleProjection={()=>setMapProjection(value=>value==="isometric"?"top":"isometric")}/>
        <div className="map-hint">点击无人机或用方向键选择；拖动空白区域平移，所有遥测与安全计算保持世界坐标不变</div>
        <MapLegend
          showNoFly={layers.noFly&&(dataMode==="live"||noFlyBoxes.length>0)}
          baseSource={baseSource}
          dynamicObstacleCount={layers.obstacles?dynamicObstacleCount:0}
          showSceneProxy={layers.sceneProxy}
          sceneLabel={sceneProxyLabel}
          showUavModel={layers.uavModel}
          showTaskTrail={layers.taskTrail}
          showEvents={layers.events}
          showCommunication={layers.communication&&hasCommunicationData}
          showBattery={layers.battery&&hasBatteryData}
          showThermal={layers.thermal&&hasThermalData}
          showMultiSafety={layers.multiSafety&&hasMultiSafetyData}
          safeDistanceM={safeDistanceM}
        />
        <div className="model-badge"><span>{MODE_META[dataMode].name}</span><strong>{dataMode==="experiment"?`${experimentReplay?.representativeId} · ${dynamicObstacleCount} 个动态障碍 · ${replayEnvironment.dynamic_obstacles?.model??"无模型声明"}`:dataMode==="external"?externalReplay?.engine:dataMode==="python"?DATA[scenarioKey].engine:dataMode==="dynamics"?`${DATA[scenarioKey].engine} · 平滑代理（非真实物理引擎）`:scenario.model}</strong></div>
        <MapTimeline currentS={simTime} durationS={replayDuration} events={activeTimeline} running={running} speed={speed} readOnlyReplay={dataMode!=="live"} actionFilter={actionFilter} onSeek={seekTime} onToggle={()=>setRunning(value=>!value)} onReset={()=>reset()} onSpeed={setSpeed} onFilter={setActionFilter}/>
      </div>
      <aside className="telemetry-panel panel" id="fleet-telemetry-drawer" data-fleet-drawer aria-hidden={!telemetryOpen}>
        <div className="panel-head telemetry-drawer-head"><div><span className="panel-kicker">FLEET / 机队状态</span><h3>逐机遥测与人工调度</h3></div><div className="telemetry-head-actions"><span className="status-chip">{drones.length} 架在线</span><button className="telemetry-close" onClick={closeTelemetry} aria-label="收起机队状态">×</button></div></div>
        <div className="fleet-scaler"><div><span>实时机群规模</span><small>1–12 架；调整后自动切换实时代理</small></div><button onClick={()=>changeFleetSize(fleetSize-1)} disabled={fleetSize<=1} aria-label="减少无人机">−</button><input aria-label="无人机数量" type="range" min="1" max="12" step="1" value={fleetSize} onChange={event=>changeFleetSize(Number(event.target.value))}/><output>{fleetSize}</output><button onClick={()=>changeFleetSize(fleetSize+1)} disabled={fleetSize>=12} aria-label="增加无人机">＋</button></div>
        <div className="drone-list">{drones.map(d=>{const link=dataMode==="live"?linkAvailable(simTime,d.id):d.linkUp!==0;return <button key={d.id} className={`drone-card ${selected===d.id?"selected":""} avoidance-${d.avoidanceMode}`} onClick={()=>selectDrone(d.id)} style={{"--drone-color":d.color} as CSSProperties}><span className="drone-line"><i/><strong>{d.name}</strong><em className={link?"online":"offline"}>{link?d.linkType??"LINK":"CACHE"}</em></span><span className="drone-task"><b>{dataMode==="live"&&d.avoidanceMode!=="clear"?AVOIDANCE_LABEL[d.avoidanceMode]:PHASE_META[d.phase].short}</b><small>{d.currentTask?.id??(d.phase==="HOLD"?"任务完成":"—")}</small></span><span className="card-metrics"><span><small>电量</small><b>{d.battery.toFixed(0)}%</b><MetricBar value={d.battery} tone={d.battery<30?"red":"cyan"}/></span><span><small>温度</small><b>{d.temperature.toFixed(1)}°</b><MetricBar value={d.temperature} max={TEMP_LIMIT} tone={d.temperature>58?"red":"amber"}/></span></span></button>})}</div>
        {selectedDrone&&<div className="selected-detail" ref={selectedDetailRef} id="selected-uav-detail"><div className="selected-title"><span style={{background:selectedDrone.color}}/><div><small>当前选中</small><strong>{selectedDrone.name}</strong></div><em>v{selectedDrone.modelVersion}.0</em></div><dl><div><dt>世界位置 x / y</dt><dd>{selectedDrone.x.toFixed(3)}, {selectedDrone.y.toFixed(3)} {coordinateUnit==="m"?"m":"（源坐标单位未声明）"}</dd></div><div><dt>世界高度 z</dt><dd>{selectedDrone.altitude.toFixed(3)} {coordinateUnit==="m"?"m":"（源坐标单位未声明）"}</dd></div><div><dt>三维速度</dt><dd>{selectedDrone.speed.toFixed(3)} {coordinateUnit==="m"?"m/s":"源单位/秒"}</dd></div>{selectedDrone.sourceTimeS!==undefined&&<div><dt>源事件时刻</dt><dd>T+{selectedDrone.sourceTimeS.toFixed(3)} s</dd></div>}{selectedDrone.batteryWh!==undefined&&<div><dt>源电量</dt><dd>{selectedDrone.batteryWh.toFixed(3)} Wh</dd></div>}<div><dt>{dataMode==="live"&&scenarioKey==="spraying"?"剩余药量":"待回传结果"}</dt><dd>{dataMode==="live"&&scenarioKey==="spraying"?`${selectedDrone.chemical.toFixed(0)}%`:`${selectedDrone.pendingResults} 份`}</dd></div>{selectedDrone.sourceAction&&<div><dt>源动作</dt><dd>{selectedDrone.sourceAction}</dd></div>}{selectedDrone.linkType&&<div><dt>链路类型</dt><dd>{selectedDrone.linkType}</dd></div>}{selectedDrone.bandwidthKbps!==undefined&&<div><dt>带宽 / PDR</dt><dd>{selectedDrone.bandwidthKbps.toFixed(1)} kbps / {(selectedDrone.pdr??0).toFixed(3)}</dd></div>}{selectedDrone.latencyMs!==undefined&&<div><dt>时延 / 缓存</dt><dd>{selectedDrone.latencyMs.toFixed(0)} ms / {(selectedDrone.storageMb??0).toFixed(2)} MB</dd></div>}<div><dt>避障模式</dt><dd className={`avoidance-value ${selectedDrone.avoidanceMode}`}>{AVOIDANCE_LABEL[selectedDrone.avoidanceMode]}</dd></div><div><dt>停滞检测</dt><dd>{dataMode==="live"?`${selectedDrone.stuckFor.toFixed(1)} / 2.2 s`:"回放只读"}</dd></div></dl><p className="decision-note"><span>{dataMode==="live"?"自主决策":"数据源动作语义"}</span>{selectedDrone.note}</p><div className="dispatch-box"><div><span>人工任务下发</span><small>{dataMode==="live"?"已完成任务也可重新开启为下一架次":"回放模式只读，请切换到实时代理"}</small></div><select aria-label={`给 ${selectedDrone.name} 选择任务`} value={dispatchTaskId} onChange={event=>setDispatchTaskId(event.target.value)} disabled={dataMode!=="live"}>{scenario.tasks.map(task=><option key={task.id} value={task.id}>{task.id} · {task.location}{completedIds.has(task.id)?"（重新执行）":""}</option>)}</select><div className="dispatch-context"><strong>{dispatchTask.location}</strong><span>{dispatchTask.title} · {dispatchTask.detail}</span><small>任务原因：{dispatchTask.reason}</small></div><button onClick={assignTask} disabled={dataMode!=="live"}>{completedIds.has(dispatchTaskId)?"重新下发给":"下发给"} {selectedDrone.name}</button>{dispatchMessage&&<p>{dispatchMessage}</p>}</div></div>}
      </aside>
    </section>
    {selectedDrone&&<section className="analysis-grid"><div className="chain-panel panel"><div className="panel-head"><div><span className="panel-kicker">DECISION CHAIN / 决策链</span><h3>{selectedDrone.name} 当前为何这样行动</h3></div><span className="phase-code">{selectedDrone.phase}</span></div><div className="phase-chain">{phaseSequence.map((phase,index)=><div key={phase} className={`phase-step ${selectedDrone.phase===phase?"active":""} ${phaseSequence.indexOf(selectedDrone.phase)>index?"passed":""}`}><span>{String(index+1).padStart(2,"0")}</span><div><strong>{PHASE_META[phase].short}</strong><small>{phase}</small></div></div>)}</div><div className="phase-explanation"><span className="phase-number">{String(Math.max(1,phaseSequence.indexOf(selectedDrone.phase)+1)).padStart(2,"0")}</span><div><h4>{PHASE_META[selectedDrone.phase].zh}</h4><p>{PHASE_META[selectedDrone.phase].description}</p></div><div className="if-then"><small>{dataMode==="live"?"当前触发条件":"源动作"}</small><code>{dataMode!=="live"?selectedDrone.sourceAction??"未声明":selectedDrone.phase==="RETURN"?`E ≤ E返航 + ${RESERVE}%`:selectedDrone.phase==="COMMUNICATE"?"link(t)=1 → upload":selectedDrone.avoiding?"d地形/障碍 < d安全 → 修正航向":"risk≤阈值 ∧ 航迹可行"}</code></div></div></div><div className="constraints-panel panel"><div className="panel-head"><div><span className="panel-kicker">SAFETY ENVELOPE / 数学边界</span><h3>{dataMode==="live"?"显式约束守门":"数据源安全指标"}</h3></div><span className="safe-stamp">{dataMode==="live"?(selectedDrone.battery>RESERVE&&selectedDrone.temperature<=TEMP_LIMIT?"ALL SAFE":"GATE ACTIVE"):"SOURCE DATA"}</span></div><div className="constraint-list"><div><span className="constraint-icon">E</span><p><strong>{dataMode==="live"?"储备电量":"源电量"}</strong><code>{dataMode==="live"?"Eᵢ(t) ≥ Eᵣ = 18%":selectedDrone.batteryWh!==undefined?`${selectedDrone.batteryWh.toFixed(3)} Wh`:"未声明 Wh"}</code></p><em className="ok">{dataMode==="live"?(selectedDrone.battery>RESERVE?"满足":"触发返航"):"只读"}</em></div><div><span className="constraint-icon">T</span><p><strong>热安全</strong><code>{dataMode==="live"?"Tᵢ(t) ≤ 68°C":`${selectedDrone.temperature.toFixed(3)} °C（源值）`}</code></p><em className="ok">{dataMode==="live"?(selectedDrone.temperature<=TEMP_LIMIT?"满足":"冷却"):"只读"}</em></div><div><span className="constraint-icon">D</span><p><strong>地形、障碍与机间距</strong><code>{dataMode==="live"?"dᵢⱼ ≥ 5 m, dᵢ,terrain ≥ r":safeDistanceM!==undefined?`数据源安全距离 ${safeDistanceM} m`:"按源世界坐标计算"}</code></p><em className="ok">{dataMode==="live"?"在线过滤":"源事件"}</em></div><div><span className="constraint-icon">W</span><p><strong>风场补偿</strong><code>{dataMode==="live"?"vground = vcmd + w(t)":"未叠加实时代理风场"}</code></p><em className="ok">{dataMode==="live"?`${wind.speed.toFixed(1)} m/s`:"—"}</em></div></div></div></section>}
    <section className="experiment-grid"><div className="panel result-panel"><div className="panel-head"><div><span className="panel-kicker">EXPERIMENT / 当前数据源汇总</span><h3>成功率、回传率、能耗与安全</h3></div><span className={`data-stamp ${activeResult?"":"inactive"}`}>{activeResult?"PYTHON DATA":"NO SUMMARY"}</span></div><div className="result-cards"><div><span>按时完成</span><strong>{activeResult?`${activeResult.on_time_completed}/${activeResult.tasks_total}`:"—"}</strong><small>{activeResult?`${(activeResult.completion_rate*100).toFixed(0)}% success`:"外部日志未提供"}</small></div><div><span>结果回传率</span><strong>{activeResult?`${(activeResult.result_return_rate*100).toFixed(1)}%`:"—"}</strong><small>{activeResult?`丢弃 ${activeResult.dropped_data_mb.toFixed(2)} MB`:"不混用旧基准"}</small></div><div><span>总能耗</span><strong>{activeResult?activeResult.total_energy_wh.toFixed(2):"—"}</strong><small>Wh</small></div><div><span>最小间距 / 违规</span><strong>{activeResult?`${activeResult.minimum_separation_m.toFixed(1)} / ${activeResult.constraint_violations}`:"—"}</strong><small>m / events</small></div></div></div>
      <div className="panel model-panel"><div className="panel-head"><div><span className="panel-kicker">EDGE MODEL / 真实基准接口</span><h3>参数、延迟与峰值内存</h3></div><button className="mini-action" onClick={()=>benchmarkInput.current?.click()}>导入 benchmark.json</button></div><div className="model-metrics"><div className="model-name"><span>{benchmark?"已导入实测":"等待实测"}</span><strong>{modelMetric.model}</strong><small>{modelMetric.device}</small></div><div><small>参数量</small><strong>{benchmark?`${modelMetric.params_m.toFixed(3)} M`:"—"}</strong><em className={paramRatio!==null&&paramRatio<=.1?"ok":"neutral"}>{paramRatio!==null?`基线的 ${(paramRatio*100).toFixed(1)}%`:"目标 < 10%"}</em></div><div><small>中位推理</small><strong>{benchmark?`${modelMetric.latency_ms.toFixed(2)} ms`:"—"}</strong><em className="neutral">CPU/端侧实测</em></div><div><small>峰值内存</small><strong>{benchmark?`${modelMetric.peak_memory_mb.toFixed(1)} MB`:"—"}</strong><em className={benchmark&&modelMetric.peak_memory_mb<=100?"ok":"neutral"}>{benchmark?modelMetric.peak_memory_mb<=100?"满足 ≤100MB":"超过边界":"需要模型与设备实测"}</em></div></div><p className="model-memory-note"><strong>为什么默认没有具体值？</strong> 峰值内存 = 权重 + 中间激活 + 推理运行时工作区；它随模型文件、输入尺寸、精度、运行库和硬件变化，只有实际 benchmark 才能得到可信数值。</p></div>
      <div className="panel federation-panel"><div className="panel-head"><div><span className="panel-kicker">NON-IID / 联邦更新演示</span><h3>异质数据下的收敛对比</h3></div><label className="heterogeneity">异质度 α = {heterogeneity.toFixed(2)}<input type="range" min="0" max="1" step="0.02" value={heterogeneity} onChange={event=>setHeterogeneity(Number(event.target.value))}/></label></div><FederatedChart heterogeneity={heterogeneity}/><p className="chart-note">演示曲线用于解释 FedAvg、FedProx 与 SCAFFOLD 的预期关系；实际论文指标应由课题数据替换。</p></div></section>
    <ExperimentLab onReplayRepresentative={replayRepresentative}/>
    <ExperimentComparison/>
    <section className="task-panel panel"><div className="panel-head"><div><span className="panel-kicker">TASK BOARD / 任务队列</span><h3>{dataMode==="experiment"?"代表案例原始任务点与执行结果":"地点名称、任务原因与执行结果"}</h3></div><span className="queue-summary">世界坐标 + 优先级 + 时限 + 安全可行性</span></div><div className="task-table" role="table"><div className="task-row table-head"><span>任务</span><span>地点与原因</span><span>优先级</span><span>截止</span><span>执行无人机</span><span>状态</span></div>{displayTasks.map(task=>{const resultTask=dataMode==="experiment"?experimentReplay?.tasks.find(t=>t.task_id===task.id):DATA[scenarioKey].tasks.find(t=>t.task_id===task.id),owner=drones.find(d=>d.id===resultTask?.assigned_to)||drones.find(d=>d.plan.some(t=>t.id===task.id)),done=completedIds.has(task.id),active=drones.some(d=>d.currentTask?.id===task.id);return <div className={`task-row ${active?"active-row":""}`} key={task.id}><span><b>{task.id}</b></span><span><strong>{task.location}</strong><small>{task.title} · {task.detail}</small><small className="task-reason">原因：{task.reason}</small></span><span className="priority-dots">{Array.from({length:5},(_,i)=><i key={i} className={i<task.priority?"on":""}/>)}</span><span>T+{task.deadline}s</span><span style={{color:owner?.color}}>{owner?.name??"—"}</span><span><em className={done?"done":active?"executing":"queued"}>{done?"已完成":active?"执行中":"队列中"}</em></span></div>})}</div></section>
    <section className="adapter-panel panel"><div><span className="panel-kicker">ADAPTER / 外部仿真接口</span><h3>RotorPy、Gym-PyBullet-Drones 与真实飞控日志</h3><p>使用附带转换脚本把 NPZ/CSV 转成标准 JSON，再点击“外部日志”导入。外部轨迹会替换网页运动代理，任务链和遥测面板继续复用。</p></div><code>{`{ engine, scenario, samples: [{ time_s, drone_id, x, y, z, vx, vy, vz, battery_pct, temperature_c, action, task_id }] }`}</code><button className="primary-control" onClick={()=>replayInput.current?.click()}>导入外部回放 JSON</button></section>
    <footer><p>实时代理采用任务优先级通行权、三维高度分层与 2.2 s 停滞脱困；场景代理仅作背景，阶段 4C 只对照各自 single-seed 源轨迹，不生成 20-seed 平均轨迹。v0.9.2 已通过 GitHub Pages 提供公开访问。</p><span>SIMULATION RESEARCH WORKBENCH · v0.9.2</span></footer>
  </main>;
}
