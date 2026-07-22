import type { ScreenPoint, WorldPoint } from "./replayAdapter";

export type WorldBounds = {
  minXM: number;
  maxXM: number;
  minYM: number;
  maxYM: number;
  minZM: number;
  maxZM: number;
};

export type MapProjection = {
  project: (point: WorldPoint) => ScreenPoint;
  ground: (point: WorldPoint) => ScreenPoint;
  bounds: WorldBounds;
};

const safeSpan = (min: number, max: number) => Math.max(1, max - min);

export function calculateWorldBounds(points: WorldPoint[], paddingRatio = 0.08): WorldBounds {
  const values = points.filter((point) => [point.xM, point.yM, point.zM].every(Number.isFinite));
  if (!values.length) return { minXM: -50, maxXM: 50, minYM: -50, maxYM: 50, minZM: 0, maxZM: 50 };
  const xs = values.map((point) => point.xM);
  const ys = values.map((point) => point.yM);
  const zs = values.map((point) => point.zM);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const padX = safeSpan(minX, maxX) * paddingRatio;
  const padY = safeSpan(minY, maxY) * paddingRatio;
  return {
    minXM: minX - padX,
    maxXM: maxX + padX,
    minYM: minY - padY,
    maxYM: maxY + padY,
    minZM: Math.min(0, ...zs),
    maxZM: Math.max(1, ...zs),
  };
}

export function createMapProjection(
  bounds: WorldBounds,
  width: number,
  height: number,
  zoom = 1,
  pan = { xPx: 0, yPx: 0 },
  mode: "isometric" | "top" = "isometric",
  layout: { contentTop?: number; contentBottom?: number; horizontalPadding?: number } = {},
): MapProjection {
  const contentTop = layout.contentTop ?? 92;
  const contentBottom = layout.contentBottom ?? 154;
  const usableW = Math.max(80, width - (layout.horizontalPadding ?? 72));
  const usableH = Math.max(80, height - contentTop - contentBottom);
  const spanX = safeSpan(bounds.minXM, bounds.maxXM);
  const spanY = safeSpan(bounds.minYM, bounds.maxYM);
  const spanZ = safeSpan(bounds.minZM, bounds.maxZM);
  const centerX = (bounds.minXM + bounds.maxXM) / 2;
  const centerY = (bounds.minYM + bounds.maxYM) / 2;
  const centerZ = (bounds.minZM + bounds.maxZM) / 2;
  const scale = mode === "top"
    ? Math.min(usableW / spanX, usableH / spanY) * zoom
    : Math.min(usableW / (spanX + spanY) * 1.9, usableH / (spanX + spanY + spanZ * 1.2) * 2.25) * zoom;
  const originX = width / 2 + pan.xPx;
  const originY = contentTop + usableH / 2 + pan.yPx;
  const project = (point: WorldPoint): ScreenPoint => {
    const x = point.xM - centerX;
    const y = point.yM - centerY;
    const z = point.zM - (mode === "top" ? 0 : centerZ);
    if (mode === "top") return { xPx: originX + x * scale, yPx: originY - y * scale };
    return {
      xPx: originX + (x - y) * scale * 0.72,
      yPx: originY + (x + y) * scale * 0.34 - z * scale * 0.72,
    };
  };
  return {
    project,
    ground: (point) => project({ ...point, zM: 0 }),
    bounds,
  };
}
