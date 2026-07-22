"use client";

import { useEffect, useMemo, useRef } from "react";
import type { CoordinateUnit, NoFlyBox, ReplayEvent, ScreenPoint, TrailSample, WorldPoint } from "../lib/replayAdapter";
import { calculateWorldBounds, createMapProjection } from "../lib/mapProjection";
import { getScenePreset } from "../data/sceneModels";
import type { ScenePresetKey } from "../data/sceneModels";
import { drawDrone3D, renderSceneProxy } from "../lib/sceneRenderer";
import type { SceneDetail } from "../lib/sceneRenderer";
import { distance3d, relativeMotionMetrics } from "../lib/mapMetrics";

export type MapTask = WorldPoint & {
  id: string;
  state: "pending" | "active" | "done";
  priority?: number;
};

export type MapDrone = WorldPoint & {
  id: number;
  name: string;
  color: string;
  trail: TrailSample[];
  avoidanceMode: "clear" | "static" | "yield" | "escape";
  linkUp?: number;
  linkType?: string;
  bandwidthKbps?: number;
  pdr?: number;
  latencyMs?: number;
  storageMb?: number;
  pendingResults?: number;
  batteryPct?: number;
  batteryWh?: number;
  temperatureC?: number;
  action?: string;
  velocity?: WorldPoint;
};

export type ProxyHazard = {
  xM: number;
  yM: number;
  zM: number;
  radiusM: number;
  label: string;
  kind: string;
};

export type ProxyCircle = {
  xM: number;
  yM: number;
  radiusM: number;
  label: string;
};

export type MapViewState = {
  zoom: number;
  pan: ScreenPoint;
  projection: "isometric" | "top";
  focusSelected: boolean;
  selectedTrailOnly: boolean;
};

export type GhostTrail = {
  id: number;
  name: string;
  color: string;
  trail: TrailSample[];
};

type Props = {
  sceneLabel: string;
  coordinateUnit: CoordinateUnit;
  base: WorldPoint;
  baseSource: "data" | "proxy";
  scenePresetKey: ScenePresetKey;
  sceneDetail: SceneDetail;
  tasks: MapTask[];
  drones: MapDrone[];
  selected: number;
  timeline: ReplayEvent[];
  noFlyBoxes: NoFlyBox[];
  proxyNoFly: ProxyCircle[];
  proxyHazards: ProxyHazard[];
  proxyDynamic: ProxyCircle[];
  showProxyEnvironment: boolean;
  fitLiveProxyDomain: boolean;
  showSceneProxy: boolean;
  showUavModel: boolean;
  showTaskTrail: boolean;
  showEvents: boolean;
  showCommunication: boolean;
  showBattery: boolean;
  showThermal: boolean;
  showMultiSafety: boolean;
  showTerrain: boolean;
  showNoFly: boolean;
  showObstacles: boolean;
  showSeparation: boolean;
  safeDistanceM?: number;
  reserveBatteryWh?: number;
  thermalLimitC?: number;
  timeS: number;
  view: MapViewState;
  onSelect: (id: number) => void;
  onPan: (pan: ScreenPoint) => void;
  compact?: boolean;
  ghostTrails?: GhostTrail[];
};

function boxCorners(box: NoFlyBox): WorldPoint[] {
  return [
    { xM: box.x_min, yM: box.y_min, zM: box.z_min },
    { xM: box.x_max, yM: box.y_min, zM: box.z_min },
    { xM: box.x_max, yM: box.y_max, zM: box.z_min },
    { xM: box.x_min, yM: box.y_max, zM: box.z_min },
    { xM: box.x_min, yM: box.y_min, zM: box.z_max },
    { xM: box.x_max, yM: box.y_min, zM: box.z_max },
    { xM: box.x_max, yM: box.y_max, zM: box.z_max },
    { xM: box.x_min, yM: box.y_max, zM: box.z_max },
  ];
}

function drawPolygon(ctx: CanvasRenderingContext2D, points: ScreenPoint[], close = true) {
  if (!points.length) return;
  ctx.beginPath();
  points.forEach((point, index) => index ? ctx.lineTo(point.xPx, point.yPx) : ctx.moveTo(point.xPx, point.yPx));
  if (close) ctx.closePath();
}

export default function MissionMap({
  sceneLabel, coordinateUnit, base, baseSource, scenePresetKey, sceneDetail, tasks, drones, selected, timeline, noFlyBoxes,
  proxyNoFly, proxyHazards, proxyDynamic, showProxyEnvironment, fitLiveProxyDomain, showSceneProxy, showUavModel,
  showTaskTrail, showEvents, showCommunication, showBattery, showThermal, showMultiSafety, showTerrain,
  showNoFly, showObstacles, showSeparation, safeDistanceM, reserveBatteryWh, thermalLimitC, timeS, view, onSelect, onPan,
  compact = false, ghostTrails = [],
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hitAreas = useRef<{ id: number; xPx: number; yPx: number; radius: number }[]>([]);
  const drag = useRef<{ startX: number; startY: number; pan: ScreenPoint; moved: boolean } | null>(null);
  const size = useRef({ width: 0, height: 0 });

  const selectedDrone = drones.find((drone) => drone.id === selected);
  const worldPoints = useMemo(() => {
    if (view.focusSelected && selectedDrone) return [
      selectedDrone,
      ...selectedDrone.trail,
      ...tasks.filter((task) => task.state === "active"),
    ];
    const points: WorldPoint[] = [
      base,
      ...tasks,
      ...drones,
      ...timeline.map((event) => ({ xM: event.x, yM: event.y, zM: event.z ?? 0 })),
      ...ghostTrails.flatMap((ghost) => ghost.trail),
    ];
    noFlyBoxes.forEach((box) => points.push(...boxCorners(box)));
    if (fitLiveProxyDomain) points.push({ xM: 0, yM: 0, zM: 0 }, { xM: 100, yM: 100, zM: 48 });
    return points;
  }, [base, drones, fitLiveProxyDomain, ghostTrails, noFlyBoxes, selectedDrone, tasks, timeline, view.focusSelected]);
  const bounds = useMemo(() => calculateWorldBounds(worldPoints, view.focusSelected ? .18 : .08), [worldPoints, view.focusSelected]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const paint = () => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(rect.width * ratio);
      canvas.height = Math.round(rect.height * ratio);
      size.current = { width: rect.width, height: rect.height };
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);
      const projection = createMapProjection(bounds, rect.width, rect.height, view.zoom, view.pan, view.projection, compact ? { contentTop: 34, contentBottom: 28, horizontalPadding: 40 } : undefined);
      const project = projection.project;
      const ground = projection.ground;
      const spanX = Math.max(1, bounds.maxXM - bounds.minXM);
      const spanY = Math.max(1, bounds.maxYM - bounds.minYM);
      const gridStep = Math.pow(10, Math.floor(Math.log10(Math.max(spanX, spanY) / 6)));
      const step = Math.max(gridStep, Math.ceil(Math.max(spanX, spanY) / 10 / gridStep) * gridStep);

      ctx.fillStyle = "#061718";
      ctx.fillRect(0, 0, rect.width, rect.height);
      ctx.strokeStyle = "rgba(121,179,165,.11)";
      ctx.lineWidth = 1;
      for (let x = Math.floor(bounds.minXM / step) * step; x <= bounds.maxXM; x += step) {
        const a = ground({ xM: x, yM: bounds.minYM, zM: 0 });
        const b = ground({ xM: x, yM: bounds.maxYM, zM: 0 });
        ctx.beginPath(); ctx.moveTo(a.xPx, a.yPx); ctx.lineTo(b.xPx, b.yPx); ctx.stroke();
      }
      for (let y = Math.floor(bounds.minYM / step) * step; y <= bounds.maxYM; y += step) {
        const a = ground({ xM: bounds.minXM, yM: y, zM: 0 });
        const b = ground({ xM: bounds.maxXM, yM: y, zM: 0 });
        ctx.beginPath(); ctx.moveTo(a.xPx, a.yPx); ctx.lineTo(b.xPx, b.yPx); ctx.stroke();
      }

      if (showSceneProxy) renderSceneProxy(ctx, projection, getScenePreset(scenePresetKey), bounds, sceneDetail);

      if (showProxyEnvironment && showTerrain) {
        proxyHazards.forEach((hazard) => {
          const center = ground(hazard);
          const edge = ground({ xM: hazard.xM + hazard.radiusM, yM: hazard.yM, zM: 0 });
          const radius = Math.max(5, Math.hypot(edge.xPx - center.xPx, edge.yPx - center.yPx));
          ctx.beginPath();
          ctx.ellipse(center.xPx, center.yPx, radius, Math.max(4, radius * .55), 0, 0, Math.PI * 2);
          ctx.fillStyle = hazard.kind === "water" ? "rgba(81,163,195,.06)" : "rgba(176,129,87,.04)";
          ctx.fill();
          const top = project(hazard);
          ctx.strokeStyle = "rgba(255,202,92,.26)";
          ctx.beginPath(); ctx.moveTo(center.xPx, center.yPx); ctx.lineTo(top.xPx, top.yPx); ctx.stroke();
        });
      }

      if (showNoFly) {
        if (showProxyEnvironment) proxyNoFly.forEach((zone) => {
          const center = ground({ ...zone, zM: 0 });
          const edge = ground({ xM: zone.xM + zone.radiusM, yM: zone.yM, zM: 0 });
          const radius = Math.max(5, Math.hypot(edge.xPx - center.xPx, edge.yPx - center.yPx));
          ctx.setLineDash([5, 4]);
          ctx.strokeStyle = "rgba(255,107,107,.65)";
          ctx.beginPath(); ctx.arc(center.xPx, center.yPx, radius, 0, Math.PI * 2); ctx.stroke();
          ctx.setLineDash([]);
        });
        noFlyBoxes.forEach((box) => {
          const points = boxCorners(box).map(project);
          const faces = [[0,1,2,3], [4,5,6,7], [0,1,5,4], [1,2,6,5], [2,3,7,6], [3,0,4,7]];
          faces.forEach((face, index) => {
            drawPolygon(ctx, face.map((id) => points[id]));
            ctx.fillStyle = index === 1 ? "rgba(255,89,96,.13)" : "rgba(255,89,96,.055)";
            ctx.fill();
            ctx.strokeStyle = "rgba(255,112,118,.72)";
            ctx.lineWidth = index === 1 ? 1.6 : 1;
            ctx.stroke();
          });
          const label = points[6];
          ctx.fillStyle = "#ff9b9f";
          ctx.font = "700 10px ui-monospace, monospace";
          ctx.textAlign = "left";
          ctx.fillText(box.name, label.xPx + 5, label.yPx - 4);
          ctx.font = "700 7px ui-monospace, monospace";
          ctx.fillText(`z ${box.z_min.toFixed(1)}–${box.z_max.toFixed(1)} m · 数据源`, label.xPx + 5, label.yPx + 7);
        });
      }

      if (showProxyEnvironment && showObstacles) proxyDynamic.forEach((obstacle) => {
        const point = ground({ ...obstacle, zM: 0 });
        ctx.fillStyle = "rgba(255,202,92,.22)";
        ctx.strokeStyle = "#ffca5c";
        ctx.beginPath(); ctx.arc(point.xPx, point.yPx, 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      });

      if (showEvents) timeline.filter((event) => event.time_s <= timeS && (["AVOID_DYNAMIC","AVOID_NO_FLY","RETURN","TURNAROUND","COOL_DOWN","LOCAL_UPDATE","STORE_AND_WAIT","DEFER_UPLOAD","YIELD","DECONFLICT_CLIMB"] as string[]).includes(event.action)).slice(-60).forEach((event) => {
        const point = project({ xM: event.x, yM: event.y, zM: event.z ?? 0 });
        ctx.save();
        ctx.translate(point.xPx, point.yPx);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = event.action === "COOL_DOWN" ? "#f783d8" : event.action === "RETURN" ? "#7aa7ff" : event.action === "AVOID_DYNAMIC" ? "#ffca5c" : event.action === "AVOID_NO_FLY" ? "#ff7c83" : "#90b8c8";
        ctx.fillRect(-4, -4, 8, 8);
        ctx.restore();
        ctx.fillStyle = event.action === "COOL_DOWN" ? "#f7a1d8" : event.action === "RETURN" || event.action === "TURNAROUND" ? "#9cbcff" : "#c2ddd5";
        ctx.font="700 6px ui-monospace, monospace";ctx.textAlign="left";ctx.fillText(event.action,point.xPx+7,point.yPx-3);
      });

      const basePoint = ground(base);
      drawPolygon(ctx, [
        {xPx:basePoint.xPx,yPx:basePoint.yPx-10},{xPx:basePoint.xPx+18,yPx:basePoint.yPx},
        {xPx:basePoint.xPx,yPx:basePoint.yPx+10},{xPx:basePoint.xPx-18,yPx:basePoint.yPx},
      ]);
      ctx.fillStyle = baseSource === "data" ? "rgba(226,248,239,.88)" : "rgba(154,175,168,.55)";
      ctx.fill();ctx.strokeStyle="rgba(237,255,248,.82)";ctx.lineWidth=1.2;ctx.stroke();
      ctx.strokeStyle="#17312f";ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(basePoint.xPx-8,basePoint.yPx);ctx.lineTo(basePoint.xPx+8,basePoint.yPx);ctx.moveTo(basePoint.xPx,basePoint.yPx-5);ctx.lineTo(basePoint.xPx,basePoint.yPx+5);ctx.stroke();
      ctx.fillStyle = "#c9e8de";ctx.font = "700 8px ui-monospace, monospace";ctx.textAlign = "center";
      ctx.fillText(baseSource === "data" ? "BASE · 数据源/任务定义" : "BASE · 代理通信端点", basePoint.xPx, basePoint.yPx + 20);

      if (showTaskTrail) tasks.forEach((task) => {
        const point = ground(task);
        const color = task.state === "done" ? "#5bd3a4" : task.state === "active" ? "#5ae0ff" : "#718f88";
        ctx.beginPath(); ctx.arc(point.xPx, point.yPx, task.state === "active" ? 7 : 5, 0, Math.PI * 2);
        ctx.fillStyle = color; ctx.fill();
        ctx.fillStyle = "#dcece7"; ctx.font = "700 10px ui-monospace, monospace"; ctx.textAlign = "center";
        ctx.fillText(task.id, point.xPx, point.yPx - 10);
      });

      if (showTaskTrail && ghostTrails.length) ghostTrails.forEach((ghost) => {
        if (ghost.trail.length < 2) return;
        ctx.setLineDash([6, 5]);
        ctx.beginPath();
        ghost.trail.forEach((sample, index) => {
          const point = project(sample);
          index ? ctx.lineTo(point.xPx, point.yPx) : ctx.moveTo(point.xPx, point.yPx);
        });
        ctx.strokeStyle = `${ghost.color}70`;
        ctx.lineWidth = 1.6;
        ctx.stroke();
        ctx.setLineDash([]);
      });

      const visibleTrails = showTaskTrail ? (view.selectedTrailOnly ? drones.filter((drone) => drone.id === selected) : drones) : [];
      visibleTrails.forEach((drone) => {
        if (drone.trail.length < 2) return;
        const firstBattery = drone.trail.find((sample) => sample.batteryWh !== undefined)?.batteryWh;
        drone.trail.slice(1).forEach((sample, index) => {
          const previous = drone.trail[index], a = project(previous), b = project(sample);
          let color = `${drone.color}${drone.id === selected ? "d8" : "66"}`;
          if (showBattery && sample.batteryWh !== undefined && firstBattery) {
            const ratio = Math.max(0,Math.min(1,sample.batteryWh/firstBattery));
            color = `hsl(${ratio*120} 72% 58% / ${drone.id === selected ? .95 : .65})`;
          } else if (showThermal && sample.temperatureC !== undefined) {
            const ratio = Math.max(0,Math.min(1,(sample.temperatureC-25)/Math.max(1,(thermalLimitC??55)-25)));
            color = `hsl(${205-ratio*205} 80% 62% / ${drone.id === selected ? .95 : .68})`;
          }
          ctx.beginPath();ctx.moveTo(a.xPx,a.yPx);ctx.lineTo(b.xPx,b.yPx);ctx.strokeStyle=color;
          ctx.lineWidth = drone.id === selected ? 2.8 : 1.35;ctx.stroke();
        });
      });

      if (showCommunication) drones.forEach((drone) => {
        const point = project(drone);
        ctx.setLineDash(drone.linkUp === 0 ? [3,5] : [7,4]);
        ctx.strokeStyle = drone.linkUp === 0 ? "rgba(255,107,107,.62)" : "rgba(90,224,255,.48)";
        ctx.lineWidth = drone.linkUp === 0 ? 1.2 : 1.5;ctx.beginPath();ctx.moveTo(basePoint.xPx,basePoint.yPx);ctx.lineTo(point.xPx,point.yPx);ctx.stroke();ctx.setLineDash([]);
        const middle={xPx:(basePoint.xPx+point.xPx)/2,yPx:(basePoint.yPx+point.yPx)/2};
        ctx.fillStyle=drone.linkUp===0?"#ff9b91":"#86eaff";ctx.font="700 7px ui-monospace, monospace";ctx.textAlign="center";
        ctx.fillText(drone.linkUp===0?"LINK DOWN":`${drone.linkType??"LINK"} · ${drone.bandwidthKbps?.toFixed(0)??"—"}kbps`,middle.xPx,middle.yPx-3);
        if (drone.linkUp!==0 && (drone.pdr!==undefined || drone.latencyMs!==undefined)) ctx.fillText(`PDR ${drone.pdr?.toFixed(3)??"—"} · ${drone.latencyMs?.toFixed(0)??"—"}ms`,middle.xPx,middle.yPx+6);
        if ((drone.storageMb??0)>0 || (drone.pendingResults??0)>0) ctx.fillText(`CACHE ${(drone.storageMb??0).toFixed(2)}MB · ${drone.pendingResults??0}项`,point.xPx,point.yPx+33);
      });

      if (showMultiSafety || showSeparation) {
        if (showMultiSafety) drones.forEach((drone) => {
          const center=project(drone), edge=project({xM:drone.xM+(safeDistanceM??5)/2,yM:drone.yM,zM:drone.zM});
          const radius=Math.max(8,Math.min(42,Math.hypot(edge.xPx-center.xPx,edge.yPx-center.yPx)));
          ctx.setLineDash([3,4]);ctx.strokeStyle="rgba(126,218,190,.27)";ctx.lineWidth=1;
          ctx.beginPath();ctx.ellipse(center.xPx,center.yPx,radius,Math.max(5,radius*.56),0,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);
        });
        let currentMinimum=Infinity;
        for (let i = 0; i < drones.length; i += 1) for (let j = i + 1; j < drones.length; j += 1) {
          const a = project(drones[i]), b = project(drones[j]);
          const distance = distance3d(drones[i],drones[j]);
          currentMinimum=Math.min(currentMinimum,distance);
          const threshold = safeDistanceM??5;
          if (showMultiSafety && distance > threshold*2.2) continue;
          const metrics = relativeMotionMetrics(drones[i],drones[i].velocity??{xM:0,yM:0,zM:0},drones[j],drones[j].velocity??{xM:0,yM:0,zM:0},threshold);
          ctx.strokeStyle = distance < threshold ? "rgba(255,93,93,.9)" : distance < threshold*1.5 ? "rgba(255,202,92,.68)" : "rgba(120,218,190,.2)";
          ctx.lineWidth=distance<threshold?2.2:1;
          ctx.beginPath(); ctx.moveTo(a.xPx, a.yPx); ctx.lineTo(b.xPx, b.yPx); ctx.stroke();
          if (showMultiSafety && distance < threshold*1.5) {
            ctx.fillStyle=distance<threshold?"#ff9696":"#ffd77d";ctx.font="700 7px ui-monospace, monospace";ctx.textAlign="center";
            ctx.fillText(`d ${distance.toFixed(1)}m · CPA ${metrics.cpaDistanceM.toFixed(1)}m · TTC ${metrics.timeToViolationS===null?"—":metrics.timeToViolationS.toFixed(1)+"s"}`,(a.xPx+b.xPx)/2,(a.yPx+b.yPx)/2-4);
          }
        }
        if (showMultiSafety && Number.isFinite(currentMinimum)) {
          ctx.fillStyle="#a9d9ca";ctx.font="700 8px ui-monospace, monospace";ctx.textAlign="right";
          ctx.fillText(`当前三维最小间距 ${currentMinimum.toFixed(2)} m · 安全阈值 ${(safeDistanceM??5).toFixed(1)} m`,rect.width-18,rect.height-(compact?18:132));
        }
      }

      hitAreas.current = [];
      drones.forEach((drone) => {
        const point = project(drone);
        hitAreas.current.push({ id: drone.id, xPx: point.xPx, yPx: point.yPx, radius: 27 });
        if (showUavModel) drawDrone3D(ctx, projection, {
          ...drone,
          selected: drone.id === selected,
          action: drone.action,
          velocity: drone.velocity,
        }, view.projection, coordinateUnit === "m" ? "m" : "源单位");
        else {
          ctx.beginPath();ctx.arc(point.xPx,point.yPx,5,0,Math.PI*2);ctx.fillStyle=drone.color;ctx.fill();
          ctx.fillStyle="#edfdf7";ctx.font="700 9px ui-monospace, monospace";ctx.textAlign="center";ctx.fillText(drone.name,point.xPx,point.yPx-10);
        }
        const annotationX = point.xPx + 23;
        let annotationY = point.yPx - 5;
        if (showBattery && (drone.batteryWh !== undefined || drone.batteryPct !== undefined)) {
          const reserve = reserveBatteryWh !== undefined && drone.batteryWh !== undefined && drone.batteryWh <= reserveBatteryWh;
          ctx.fillStyle=reserve?"#ff8b74":"#9be7bd";ctx.font="700 7px ui-monospace, monospace";ctx.textAlign="left";
          ctx.fillText(drone.batteryWh !== undefined ? `E ${drone.batteryWh.toFixed(1)} Wh${reserve?" · RETURN":""}` : `E ${drone.batteryPct?.toFixed(0)}%`,annotationX,annotationY);
          annotationY += 10;
        }
        if (showThermal && drone.temperatureC !== undefined) {
          const hot = thermalLimitC !== undefined && drone.temperatureC >= thermalLimitC;
          ctx.fillStyle=hot?"#ff83c5":"#78cfff";ctx.font="700 7px ui-monospace, monospace";ctx.textAlign="left";
          ctx.fillText(`T ${drone.temperatureC.toFixed(1)}°C${hot?" · COOL_DOWN":""}`,annotationX,annotationY);
        }
      });

      ctx.fillStyle = "rgba(126,163,154,.8)";
      ctx.font = "9px ui-monospace, monospace";
      ctx.textAlign = "left";
      ctx.fillText(`世界坐标 · ${coordinateUnit === "m" ? "m" : "源坐标单位未声明"} · ${view.projection === "top" ? "俯视" : "等距"}投影`, 18, rect.height - (compact?18:132));
    };
    paint();
    const observer = new ResizeObserver(paint);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [base, baseSource, bounds, coordinateUnit, drones, noFlyBoxes, proxyDynamic, proxyHazards, proxyNoFly, reserveBatteryWh,
    safeDistanceM, sceneDetail, scenePresetKey, selected, showBattery, showCommunication, showEvents, showMultiSafety,
    showNoFly, showObstacles, showProxyEnvironment, showSceneProxy, showSeparation, showTaskTrail, showTerrain, showThermal,
    showUavModel, tasks, thermalLimitC, timeS, timeline, view, compact, ghostTrails]);

  return <canvas
    ref={canvasRef}
    className="mission-canvas"
    role="img"
    tabIndex={0}
    aria-label={`${sceneLabel}无人机世界坐标回放${ghostTrails.length ? "；含可比单 seed 幽灵航迹" : ""}；方向键选择无人机，拖动画布平移视图`}
    onPointerDown={(event) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const xPx = event.clientX - rect.left, yPx = event.clientY - rect.top;
      const target = [...hitAreas.current].sort((a, b) => Math.hypot(xPx-a.xPx,yPx-a.yPx)-Math.hypot(xPx-b.xPx,yPx-b.yPx))
        .find((area) => Math.hypot(xPx-area.xPx,yPx-area.yPx) <= area.radius);
      if (target) { onSelect(target.id); return; }
      drag.current = { startX: event.clientX, startY: event.clientY, pan: view.pan, moved: false };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={(event) => {
      if (!drag.current) return;
      const dx = event.clientX - drag.current.startX, dy = event.clientY - drag.current.startY;
      if (Math.hypot(dx, dy) > 2) drag.current.moved = true;
      onPan({ xPx: drag.current.pan.xPx + dx, yPx: drag.current.pan.yPx + dy });
    }}
    onPointerUp={(event) => { drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId); }}
    onPointerCancel={() => { drag.current = null; }}
    onKeyDown={(event) => {
      if (!drones.length) return;
      const index = Math.max(0, drones.findIndex((drone) => drone.id === selected));
      if (event.key === "ArrowRight" || event.key === "ArrowDown") { event.preventDefault(); onSelect(drones[(index+1)%drones.length].id); }
      if (event.key === "ArrowLeft" || event.key === "ArrowUp") { event.preventDefault(); onSelect(drones[(index-1+drones.length)%drones.length].id); }
    }}
  />;
}
