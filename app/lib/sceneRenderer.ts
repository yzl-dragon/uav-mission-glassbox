import type { ScenePreset, ScenePrimitive } from "../data/sceneModels";
import type { MapProjection, WorldBounds } from "./mapProjection";
import type { ScreenPoint, WorldPoint } from "./replayAdapter";

export type SceneDetail = "low" | "medium" | "high";

type DroneVisual = WorldPoint & {
  name: string;
  color: string;
  selected: boolean;
  action?: string;
  avoidanceMode: "clear" | "static" | "yield" | "escape";
  velocity?: WorldPoint;
};

const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));

function polygon(ctx: CanvasRenderingContext2D, points: ScreenPoint[], fill: string, stroke?: string) {
  if (!points.length) return;
  ctx.beginPath();
  points.forEach((point, index) => index ? ctx.lineTo(point.xPx, point.yPx) : ctx.moveTo(point.xPx, point.yPx));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function proxyScale(bounds: WorldBounds) {
  const span = Math.max(1, bounds.maxXM - bounds.minXM, bounds.maxYM - bounds.minYM);
  return { xy: span / 100, z: clamp(span / 100, .55, 1.4) };
}

function proxyPoint(point: WorldPoint, bounds: WorldBounds): WorldPoint {
  const scale = proxyScale(bounds);
  return {
    xM: bounds.minXM + point.xM * scale.xy,
    yM: bounds.minYM + point.yM * scale.xy,
    zM: point.zM * scale.z,
  };
}

function circlePoints(center: WorldPoint, radiusM: number, heightM: number, bounds: WorldBounds, count = 28) {
  return Array.from({ length: count }, (_, index) => proxyPoint({
    xM: center.xM + Math.cos(index / count * Math.PI * 2) * radiusM,
    yM: center.yM + Math.sin(index / count * Math.PI * 2) * radiusM,
    zM: heightM,
  }, bounds));
}

function primitiveDepth(primitive: ScenePrimitive) {
  if (primitive.type === "prism") return primitive.footprint.reduce((sum, point) => sum + point.xM + point.yM, 0) / primitive.footprint.length;
  if (primitive.type === "groundPolygon") return primitive.points.reduce((sum, point) => sum + point.xM + point.yM, 0) / primitive.points.length;
  return primitive.center.xM + primitive.center.yM;
}

export function renderSceneProxy(
  ctx: CanvasRenderingContext2D,
  projection: MapProjection,
  preset: ScenePreset,
  bounds: WorldBounds,
  detail: SceneDetail,
) {
  const project = projection.project;
  const scale = proxyScale(bounds);
  const primitives = [...preset.primitives].sort((a, b) => primitiveDepth(a) - primitiveDepth(b));
  primitives.forEach((primitive, primitiveIndex) => {
    if (detail === "low" && !["groundPolygon", "water"].includes(primitive.type)) return;
    if (detail === "medium" && primitive.type === "vegetation") return;
    if (primitive.type === "groundPolygon") {
      const points = primitive.points.map((point) => project(proxyPoint(point, bounds)));
      const colors = {
        road: ["rgba(61,83,82,.46)", "rgba(126,158,150,.16)"],
        path: ["rgba(56,77,74,.38)", "rgba(125,154,145,.12)"],
        field: [primitiveIndex % 2 ? "rgba(69,114,69,.26)" : "rgba(80,126,72,.31)", "rgba(139,179,107,.12)"],
        smoke: ["rgba(122,119,105,.16)", "rgba(187,178,154,.12)"],
      } as const;
      polygon(ctx, points, colors[primitive.role][0], colors[primitive.role][1]);
      return;
    }
    if (primitive.type === "prism") {
      const ground = primitive.footprint.map((point) => proxyPoint(point, bounds));
      const top = ground.map((point) => ({ ...point, zM: primitive.heightM * scale.z }));
      const gp = ground.map(project), tp = top.map(project);
      const wall = primitive.role === "wall"
        ? ["rgba(86,79,70,.34)", "rgba(103,92,76,.31)"]
        : primitive.role === "tower"
          ? ["rgba(54,78,76,.52)", "rgba(65,91,88,.5)"]
          : ["rgba(43,68,67,.48)", "rgba(53,81,79,.46)"];
      polygon(ctx, [gp[1], gp[2], tp[2], tp[1]], wall[0]);
      polygon(ctx, [gp[2], gp[3], tp[3], tp[2]], wall[1]);
      polygon(ctx, tp, primitive.role === "wall" ? "rgba(134,116,91,.36)" : "rgba(74,107,101,.52)", "rgba(181,219,206,.12)");
      return;
    }
    if (primitive.type === "contour") {
      for (let level = 1; level <= (detail === "high" ? 4 : 3); level += 1) {
        const radius = primitive.radiusM * (1 - level * .13);
        const height = primitive.heightM * level / 5;
        const points = circlePoints(primitive.center, radius, height, bounds).map(project);
        polygon(ctx, points, primitive.role === "rubble" ? "rgba(110,82,67,.13)" : "rgba(101,92,72,.13)", "rgba(204,166,116,.21)");
      }
      return;
    }
    if (primitive.type === "water") {
      const points = circlePoints(primitive.center, primitive.radiusM, .25, bounds).map(project);
      polygon(ctx, points, "rgba(58,139,165,.27)", "rgba(106,211,229,.38)");
      if (detail === "high") {
        const center = proxyPoint(primitive.center, bounds);
        [-.35, 0, .35].forEach((offset) => {
          const a = project({ xM: center.xM - primitive.radiusM * scale.xy * .62, yM: center.yM + offset * primitive.radiusM * scale.xy, zM: .4 });
          const b = project({ xM: center.xM + primitive.radiusM * scale.xy * .62, yM: center.yM + offset * primitive.radiusM * scale.xy, zM: .4 });
          ctx.strokeStyle = "rgba(158,229,240,.25)"; ctx.beginPath(); ctx.moveTo(a.xPx,a.yPx);ctx.lineTo(b.xPx,b.yPx);ctx.stroke();
        });
      }
      return;
    }
    const center = proxyPoint(primitive.center, bounds);
    for (let index = 0; index < primitive.count; index += 1) {
      const angle = index * 2.399;
      const radial = ((index % 5) + 1) / 6 * primitive.radiusM * scale.xy;
      const base = { xM: center.xM + Math.cos(angle) * radial, yM: center.yM + Math.sin(angle) * radial, zM: 0 };
      const top = project({ ...base, zM: (5 + index % 4 * 1.6) * scale.z });
      const foot = project(base);
      ctx.strokeStyle = "rgba(81,119,82,.34)"; ctx.beginPath();ctx.moveTo(foot.xPx,foot.yPx);ctx.lineTo(top.xPx,top.yPx);ctx.stroke();
      ctx.fillStyle = "rgba(77,132,84,.46)";ctx.beginPath();ctx.arc(top.xPx,top.yPx,2.6+(index%2),0,Math.PI*2);ctx.fill();
    }
  });
}

function statusColor(action: string | undefined, avoidanceMode: DroneVisual["avoidanceMode"]) {
  if (action === "COOL_DOWN") return "#f783d8";
  if (action === "RETURN" || action === "TURNAROUND") return "#7aa7ff";
  if (action === "YIELD" || action === "DECONFLICT_CLIMB" || avoidanceMode === "yield") return "#ffca5c";
  if (action === "AVOID_DYNAMIC" || action === "AVOID_NO_FLY" || avoidanceMode === "static") return "#ff8b74";
  if (avoidanceMode === "escape") return "#f783d8";
  return "";
}

export function drawDrone3D(
  ctx: CanvasRenderingContext2D,
  projection: MapProjection,
  drone: DroneVisual,
  mode: "isometric" | "top",
  coordinateLabel: string,
) {
  const point = projection.project(drone);
  const shadow = projection.ground(drone);
  if (mode === "isometric" && Math.abs(drone.zM) > .001) {
    ctx.setLineDash([2,4]);ctx.strokeStyle="rgba(198,235,224,.31)";ctx.beginPath();ctx.moveTo(shadow.xPx,shadow.yPx);ctx.lineTo(point.xPx,point.yPx);ctx.stroke();ctx.setLineDash([]);
  }
  ctx.fillStyle="rgba(0,0,0,.34)";ctx.beginPath();ctx.ellipse(shadow.xPx,shadow.yPx,12,4.2,0,0,Math.PI*2);ctx.fill();
  const ring = statusColor(drone.action, drone.avoidanceMode);
  if (drone.selected || ring) {
    ctx.strokeStyle = ring || drone.color;
    ctx.lineWidth = drone.selected ? 4.5 : 2;
    ctx.beginPath();ctx.ellipse(point.xPx,point.yPx,22,15,0,0,Math.PI*2);ctx.stroke();
  }
  const depth = mode === "top" ? 2 : 5;
  polygon(ctx, [
    {xPx:point.xPx-8,yPx:point.yPx-5+depth},
    {xPx:point.xPx+8,yPx:point.yPx-5+depth},
    {xPx:point.xPx+6,yPx:point.yPx+6+depth},
    {xPx:point.xPx-6,yPx:point.yPx+6+depth},
  ], "rgba(7,16,18,.92)");
  polygon(ctx, [
    {xPx:point.xPx-8,yPx:point.yPx-5},
    {xPx:point.xPx+8,yPx:point.yPx-5},
    {xPx:point.xPx+6,yPx:point.yPx+6},
    {xPx:point.xPx-6,yPx:point.yPx+6},
  ], drone.color, "rgba(239,255,249,.8)");
  const rotors = [[-14,-9],[14,-9],[-14,9],[14,9]];
  ctx.strokeStyle="rgba(225,250,242,.86)";ctx.lineWidth=2;
  ctx.beginPath();ctx.moveTo(point.xPx-14,point.yPx-9);ctx.lineTo(point.xPx+14,point.yPx+9);ctx.moveTo(point.xPx+14,point.yPx-9);ctx.lineTo(point.xPx-14,point.yPx+9);ctx.stroke();
  rotors.forEach(([x,y])=>{ctx.fillStyle="rgba(5,15,17,.82)";ctx.strokeStyle="rgba(223,250,241,.88)";ctx.lineWidth=1.3;ctx.beginPath();ctx.ellipse(point.xPx+x,point.yPx+y,7,2.5,0,0,Math.PI*2);ctx.fill();ctx.stroke();});
  ctx.fillStyle="#091618";ctx.fillRect(point.xPx-3,point.yPx+1,6,7);ctx.strokeStyle="rgba(240,255,249,.62)";ctx.strokeRect(point.xPx-3,point.yPx+1,6,7);
  if (drone.velocity && Math.hypot(drone.velocity.xM,drone.velocity.yM,drone.velocity.zM) > .05) {
    const norm = Math.max(.001,Math.hypot(drone.velocity.xM,drone.velocity.yM,drone.velocity.zM));
    const tip = projection.project({xM:drone.xM+drone.velocity.xM/norm*9,yM:drone.yM+drone.velocity.yM/norm*9,zM:drone.zM+drone.velocity.zM/norm*9});
    ctx.setLineDash([3,3]);ctx.strokeStyle="rgba(126,230,210,.7)";ctx.beginPath();ctx.moveTo(point.xPx,point.yPx);ctx.lineTo(tip.xPx,tip.yPx);ctx.stroke();ctx.setLineDash([]);
    ctx.fillStyle="#8eead8";ctx.font="700 7px ui-monospace, monospace";ctx.fillText("v",tip.xPx+3,tip.yPx-2);
  }
  ctx.fillStyle="#effcf8";ctx.font="700 11px ui-monospace, monospace";ctx.textAlign="center";ctx.fillText(drone.name,point.xPx,point.yPx-20);
  ctx.fillStyle="#9fc5bb";ctx.font="700 8px ui-monospace, monospace";ctx.fillText(`z ${drone.zM.toFixed(1)} ${coordinateLabel}`,point.xPx,point.yPx+22);
  if (ring && drone.action) {
    ctx.fillStyle=ring;ctx.font="700 7px ui-monospace, monospace";ctx.fillText(drone.action,point.xPx,point.yPx-31);
  }
}
