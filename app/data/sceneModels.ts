import type { WorldPoint } from "../lib/replayAdapter";

type ProxyBoundary = {
  source: "proxy";
  affectsPhysics: false;
  label: string;
};

export type GroundPolygonPrimitive = ProxyBoundary & {
  type: "groundPolygon";
  role: "road" | "field" | "path" | "smoke";
  points: WorldPoint[];
};

export type PrismPrimitive = ProxyBoundary & {
  type: "prism";
  role: "building" | "tower" | "wall";
  footprint: WorldPoint[];
  heightM: number;
};

export type ContourPrimitive = ProxyBoundary & {
  type: "contour";
  role: "ridge" | "rubble";
  center: WorldPoint;
  radiusM: number;
  heightM: number;
};

export type WaterPrimitive = ProxyBoundary & {
  type: "water";
  center: WorldPoint;
  radiusM: number;
};

export type VegetationPrimitive = ProxyBoundary & {
  type: "vegetation";
  center: WorldPoint;
  radiusM: number;
  count: number;
};

export type ScenePrimitive =
  | GroundPolygonPrimitive
  | PrismPrimitive
  | ContourPrimitive
  | WaterPrimitive
  | VegetationPrimitive;

export type ScenePresetKey = "logistics" | "rescue" | "spraying" | "neutral";

export type ScenePreset = {
  scenario: ScenePresetKey;
  label: string;
  source: "proxy";
  affectsPhysics: false;
  normalizedDomain: "0-100";
  primitives: ScenePrimitive[];
};

const boundary = (label: string) => ({ source: "proxy" as const, affectsPhysics: false as const, label });
const point = (xM: number, yM: number, zM = 0): WorldPoint => ({ xM, yM, zM });
const rectangle = (x: number, y: number, width: number, depth: number) => [
  point(x, y), point(x + width, y), point(x + width, y + depth), point(x, y + depth),
];
const ground = (role: GroundPolygonPrimitive["role"], label: string, x: number, y: number, width: number, depth: number): GroundPolygonPrimitive => ({
  ...boundary(label), type: "groundPolygon", role, points: rectangle(x, y, width, depth),
});
const prism = (role: PrismPrimitive["role"], label: string, x: number, y: number, width: number, depth: number, heightM: number): PrismPrimitive => ({
  ...boundary(label), type: "prism", role, footprint: rectangle(x, y, width, depth), heightM,
});
const contour = (role: ContourPrimitive["role"], label: string, x: number, y: number, radiusM: number, heightM: number): ContourPrimitive => ({
  ...boundary(label), type: "contour", role, center: point(x, y), radiusM, heightM,
});
const water = (label: string, x: number, y: number, radiusM: number): WaterPrimitive => ({
  ...boundary(label), type: "water", center: point(x, y), radiusM,
});
const vegetation = (label: string, x: number, y: number, radiusM: number, count: number): VegetationPrimitive => ({
  ...boundary(label), type: "vegetation", center: point(x, y), radiusM, count,
});

const CITY: ScenePreset = {
  scenario: "logistics",
  label: "城市配送代理模型",
  source: "proxy",
  affectsPhysics: false,
  normalizedDomain: "0-100",
  primitives: [
    ground("road", "东西主路", 0, 44, 100, 12),
    ground("road", "南北主路", 44, 0, 12, 100),
    ground("path", "西侧支路", 16, 4, 7, 92),
    ground("path", "东侧支路", 78, 4, 7, 92),
    prism("building", "西南街区 A", 5, 7, 9, 12, 17),
    prism("building", "西南街区 B", 25, 9, 12, 14, 12),
    prism("building", "东南街区 A", 60, 8, 13, 15, 20),
    prism("building", "东南街区 B", 87, 13, 9, 18, 15),
    prism("building", "西北街区 A", 5, 66, 9, 19, 22),
    prism("building", "西北街区 B", 26, 68, 11, 14, 16),
    prism("building", "东北街区 A", 59, 66, 12, 15, 13),
    prism("building", "东北街区 B", 87, 69, 9, 16, 21),
    prism("tower", "高楼峡谷代理塔 A", 29, 52, 5, 7, 29),
    prism("tower", "高楼峡谷代理塔 B", 36, 57, 5, 7, 24),
    prism("tower", "东北塔群 A", 67, 74, 4, 5, 34),
    prism("tower", "东北塔群 B", 73, 77, 4, 5, 27),
  ],
};

const RESCUE: ScenePreset = {
  scenario: "rescue",
  label: "灾害搜救代理模型",
  source: "proxy",
  affectsPhysics: false,
  normalizedDomain: "0-100",
  primitives: [
    ground("road", "受损救援通道", 0, 44, 100, 11),
    ground("path", "临时纵向通道", 45, 0, 10, 100),
    prism("wall", "残墙 A", 7, 8, 14, 4, 8),
    prism("wall", "残墙 B", 24, 14, 5, 16, 11),
    prism("wall", "受损建筑 A", 61, 10, 15, 12, 13),
    prism("wall", "受损建筑 B", 82, 20, 11, 17, 9),
    prism("wall", "北侧残墙 A", 10, 71, 15, 5, 7),
    prism("wall", "北侧受损建筑", 73, 68, 15, 14, 12),
    contour("rubble", "瓦砾堆 A", 29, 51, 10, 16),
    contour("rubble", "瓦砾堆 B", 36, 78, 7, 12),
    contour("ridge", "断壁峡口", 65, 31, 8, 21),
    water("灾区积水面", 66, 63, 10),
    ground("smoke", "烟尘观察区", 16, 59, 17, 18),
  ],
};

const FARM: ScenePreset = {
  scenario: "spraying",
  label: "农田喷洒代理模型",
  source: "proxy",
  affectsPhysics: false,
  normalizedDomain: "0-100",
  primitives: [
    ground("field", "作业条带代理 01", 8, 10, 10, 78),
    ground("field", "作业条带代理 02", 21, 10, 10, 78),
    ground("field", "作业条带代理 03", 34, 10, 10, 78),
    ground("field", "作业条带代理 04", 47, 10, 10, 78),
    ground("field", "作业条带代理 05", 60, 10, 10, 78),
    ground("field", "作业条带代理 06", 73, 10, 10, 78),
    ground("field", "作业条带代理 07", 86, 10, 8, 78),
    ground("path", "田间横向通道", 5, 45, 90, 6),
    contour("ridge", "丘陵隆起", 34, 50, 9, 15),
    water("灌溉水塘", 68, 52, 8),
    vegetation("防风林带", 89, 64, 7, 13),
  ],
};

const NEUTRAL: ScenePreset = {
  scenario: "neutral",
  label: "中性任务空间代理模型",
  source: "proxy",
  affectsPhysics: false,
  normalizedDomain: "0-100",
  primitives: [
    ground("path", "中性参考轴 X", 5, 48, 90, 4),
    ground("path", "中性参考轴 Y", 48, 5, 4, 90),
  ],
};

export const SCENE_PRESETS: Record<ScenePresetKey, ScenePreset> = {
  logistics: CITY,
  rescue: RESCUE,
  spraying: FARM,
  neutral: NEUTRAL,
};

export function getScenePreset(key: ScenePresetKey) {
  return SCENE_PRESETS[key];
}
