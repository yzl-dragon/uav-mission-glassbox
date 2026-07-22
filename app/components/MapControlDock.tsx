"use client";

import type { RefObject } from "react";

type MapControlDockProps = {
  zoom: number;
  projection: "isometric" | "top";
  focusSelected: boolean;
  selectedTrailOnly: boolean;
  focusMode: boolean;
  telemetryOpen: boolean;
  auxiliaryOpen: boolean;
  telemetryToggleRef: RefObject<HTMLButtonElement | null>;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onFit: () => void;
  onReset: () => void;
  onToggleTelemetry: () => void;
  onToggleFocusMode: () => void;
  onToggleAuxiliary: () => void;
  onToggleFocusSelected: () => void;
  onToggleSelectedTrail: () => void;
  onToggleProjection: () => void;
};

export default function MapControlDock({
  zoom,
  projection,
  focusSelected,
  selectedTrailOnly,
  focusMode,
  telemetryOpen,
  auxiliaryOpen,
  telemetryToggleRef,
  onZoomOut,
  onZoomIn,
  onFit,
  onReset,
  onToggleTelemetry,
  onToggleFocusMode,
  onToggleAuxiliary,
  onToggleFocusSelected,
  onToggleSelectedTrail,
  onToggleProjection,
}: MapControlDockProps) {
  const atMinimum = zoom <= .5501;
  const atMaximum = zoom >= 2.9999;

  return <div className={`map-view-controls map-control-dock ${auxiliaryOpen ? "auxiliary-open" : ""}`} data-map-control-dock aria-label="地图控制安全区">
    <div className="map-control-escape" aria-label="始终可用的地图控制">
      <button onClick={onZoomOut} disabled={atMinimum} aria-label="缩小地图">−</button>
      <output aria-label="当前地图缩放比例">{Math.round(zoom * 100)}%</output>
      <button onClick={onZoomIn} disabled={atMaximum} aria-label="放大地图">＋</button>
      <button className="fit-map" onClick={onFit} aria-label="适配全部对象">适配</button>
      <button onClick={onReset} aria-label="重置地图视图">重置</button>
      <button ref={telemetryToggleRef} className="fleet-toggle" onClick={onToggleTelemetry} aria-expanded={telemetryOpen} aria-controls="fleet-telemetry-drawer" aria-label={telemetryOpen ? "收起机队状态" : "展开机队状态"}>{telemetryOpen ? "收起机队" : "展开机队"}</button>
      <button className="fullscreen-map" onClick={onToggleFocusMode} aria-label={focusMode ? "退出地图专注模式" : "进入地图专注模式"}>{focusMode ? "退出专注" : "⛶ 专注"}</button>
    </div>
    <button className="auxiliary-toggle" onClick={onToggleAuxiliary} aria-expanded={auxiliaryOpen} aria-controls="map-auxiliary-controls">{auxiliaryOpen ? "收起辅助" : "辅助控制"}</button>
    <div className="map-control-secondary" id="map-auxiliary-controls" aria-label="辅助地图控制">
      <button className={focusSelected ? "active" : ""} onClick={onToggleFocusSelected} aria-label="聚焦选中无人机">聚焦选中</button>
      <button className={selectedTrailOnly ? "active" : ""} onClick={onToggleSelectedTrail} aria-label="只显示选中无人机航迹">仅选中航迹</button>
      <button onClick={onToggleProjection} aria-label="切换俯视与等距投影">{projection === "isometric" ? "俯视" : "等距"}</button>
    </div>
  </div>;
}
