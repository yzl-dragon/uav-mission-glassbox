type Props = {
  showNoFly: boolean;
  baseSource: "data"|"proxy";
  dynamicObstacleCount: number;
  showSceneProxy: boolean;
  sceneLabel: string;
  showUavModel: boolean;
  showTaskTrail: boolean;
  showEvents: boolean;
  showCommunication: boolean;
  showBattery: boolean;
  showThermal: boolean;
  showMultiSafety: boolean;
  safeDistanceM?: number;
};

export default function MapLegend({ showNoFly, baseSource, dynamicObstacleCount, showSceneProxy, sceneLabel, showUavModel,
  showTaskTrail, showEvents, showCommunication, showBattery, showThermal, showMultiSafety, safeDistanceM }: Props) {
  return <div className="map-legend actual-map-legend" aria-label="当前地图实际图例">
    <span><i className="legend-base"/>基地 · {baseSource==="data"?"任务定义":"代理通信端点"}</span>
    {showTaskTrail&&<><span><i className="legend-task pending"/>待执行</span><span><i className="legend-task active"/>执行中</span><span><i className="legend-task done"/>已完成</span><span><i className="legend-route"/>数据源/实时代理航迹</span></>}
    {showUavModel&&<span><i className="legend-uav"/>三维无人机当前位置</span>}
    <span><i className="legend-selected"/>选中</span>
    {showSceneProxy&&<span className="legend-proxy"><i className="legend-scene"/>{sceneLabel} · 不参与计算</span>}
    {showNoFly && <span><i className="legend-nofly"/>数据源三维禁飞盒 / 实时代理区</span>}
    {showEvents&&dynamicObstacleCount > 0 && <span><i className="legend-event"/>源事件 / 代理障碍 × {dynamicObstacleCount}</span>}
    {showCommunication && <span><i className="legend-link"/>数据源链路/机载缓存</span>}
    {showBattery && <span><i className="legend-battery"/>数据源电量/返航</span>}
    {showThermal && <span><i className="legend-thermal"/>数据源温度/冷却</span>}
    {showMultiSafety && safeDistanceM !== undefined && <span><i className="legend-safe"/>三维距离/CPA/TTC · {safeDistanceM} m</span>}
  </div>;
}
