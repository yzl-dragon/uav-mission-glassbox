"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { EXPERIMENT_BUNDLE } from "../generated/experimentData";
import type { ExperimentReplayRequest, ReplayDroneDefinition, ReplayEnvironment, ReplayEvent, ReplayTask } from "../lib/replayAdapter";

type Scalar = string | number | null;
type Aggregate = Record<string, Scalar> & { case: string; n: number };
type Dimension = { key: string; label: string; unit: string };
type Sweep = { id: string; dimensions: Dimension[]; metrics: { key: string; label: string; unit: string }[]; aggregates: Aggregate[] };
type View = { id: string; title: string; type: "line_ci" | "heatmap"; sweep: string; x: string; y: string; color?: string; series?: string; x_label: string; y_label: string; color_label?: string; unit: string; interpretation: string; default_filters?: Record<string, Scalar> };
type Representative = { id: string; label: string; seed_count: number; configuration: Record<string, Scalar>; environment: ReplayEnvironment; summary: Record<string, Scalar>; tasks: ReplayTask[]; drones: ReplayDroneDefinition[]; timeline: ReplayEvent[] };
type Experiment = { id: string; title: string; purpose: string; run_count: number; seed_count: number; sweeps: Sweep[]; views: View[]; representatives: Representative[] };
type Bundle = { schema_version: string; generated_at: string; simulator: { name: string; disclaimer: string; statistics: string }; experiments: Experiment[] };

const BUNDLE = EXPERIMENT_BUNDLE as unknown as Bundle;
const COLORS = ["#5ae0ff", "#ffca5c", "#8ce99a", "#c69cff", "#ff8b74"];
const SCENARIO_LABELS: Record<string, string> = { logistics: "物资配送", rescue: "搜索救援", spraying: "农田喷洒", base: "基准", off: "关闭", heavy: "高负载" };

function numeric(value: Scalar) { return typeof value === "number" && Number.isFinite(value) ? value : 0; }
function unique(values: Scalar[]) { return [...new Map(values.map(value => [String(value), value])).values()]; }
function compare(a: Scalar, b: Scalar) { return typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), "zh-CN"); }
function metricValue(row: Aggregate, key: string) { return numeric(row[`${key}_mean`]); }
function metricCi(row: Aggregate, key: string) { return numeric(row[`${key}_ci95`]); }
function formatValue(value: Scalar, key = "", unit = "") {
  if (value === null || value === undefined) return "—";
  if (typeof value !== "number") return SCENARIO_LABELS[value] ?? value;
  if (key.includes("rate") || key.includes("fraction")) return `${(value * 100).toFixed(1)}%`;
  const digits = Math.abs(value) >= 100 ? 1 : Math.abs(value) >= 10 ? 2 : 3;
  return `${value.toFixed(digits)}${unit ? ` ${unit}` : ""}`;
}

function LineCIChart({ rows, view, selectedCase, onSelect }: { rows: Aggregate[]; view: View; selectedCase?: string; onSelect: (row: Aggregate) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const hits = useRef<{ x: number; y: number; row: Aggregate }[]>([]);
  useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const rect = canvas.getBoundingClientRect(), ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, rect.width * ratio); canvas.height = Math.max(1, rect.height * ratio);
    const ctx = canvas.getContext("2d"); if (!ctx) return; ctx.scale(ratio, ratio); ctx.clearRect(0, 0, rect.width, rect.height);
    const pad = { l: 58, r: 24, t: 28, b: 54 }, width = rect.width - pad.l - pad.r, height = rect.height - pad.t - pad.b;
    const metric = view.y, seriesKey = view.series;
    const xValues = unique(rows.map(row => row[view.x])).sort(compare);
    const seriesValues = seriesKey ? unique(rows.map(row => row[seriesKey])).sort(compare) : ["20-seed均值"];
    const lows = rows.map(row => metricValue(row, metric) - metricCi(row, metric)), highs = rows.map(row => metricValue(row, metric) + metricCi(row, metric));
    let minY = Math.min(0, ...lows), maxY = Math.max(...highs, 1e-6); if (maxY <= minY) maxY = minY + 1;
    const xAt = (value: Scalar) => pad.l + (xValues.length <= 1 ? width / 2 : xValues.findIndex(item => String(item) === String(value)) / (xValues.length - 1) * width);
    const yAt = (value: number) => pad.t + (maxY - value) / (maxY - minY) * height;
    ctx.font = "10px ui-monospace, monospace"; ctx.textAlign = "right"; ctx.textBaseline = "middle";
    for (let index = 0; index <= 4; index++) { const value = maxY - (maxY - minY) * index / 4, y = yAt(value); ctx.strokeStyle = "rgba(164,221,203,.12)"; ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(rect.width - pad.r, y); ctx.stroke(); ctx.fillStyle = "#78968f"; ctx.fillText(formatValue(value, metric), pad.l - 8, y); }
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    xValues.forEach(value => { const x = xAt(value); ctx.fillStyle = "#78968f"; ctx.fillText(formatValue(value, view.x), x, pad.t + height + 12); });
    hits.current = [];
    seriesValues.forEach((series, seriesIndex) => {
      const points = rows.filter(row => !seriesKey || String(row[seriesKey]) === String(series)).sort((a, b) => compare(a[view.x], b[view.x]));
      const color = COLORS[seriesIndex % COLORS.length];
      ctx.beginPath(); points.forEach((row, index) => { const x = xAt(row[view.x]), y = yAt(metricValue(row, metric) + metricCi(row, metric)); index ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      [...points].reverse().forEach(row => ctx.lineTo(xAt(row[view.x]), yAt(metricValue(row, metric) - metricCi(row, metric)))); ctx.closePath(); ctx.fillStyle = `${color}18`; ctx.fill();
      ctx.beginPath(); points.forEach((row, index) => { const x = xAt(row[view.x]), y = yAt(metricValue(row, metric)); index ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
      points.forEach(row => { const x = xAt(row[view.x]), y = yAt(metricValue(row, metric)); hits.current.push({ x, y, row }); ctx.beginPath(); ctx.arc(x, y, row.case === selectedCase ? 5.5 : 3.5, 0, Math.PI * 2); ctx.fillStyle = row.case === selectedCase ? "#edf8f4" : color; ctx.fill(); ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke(); });
      ctx.fillStyle = color; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(seriesKey ? formatValue(series, seriesKey) : String(series), pad.l + seriesIndex * 125, 13);
    });
  }, [rows, view, selectedCase]);
  return <canvas ref={ref} className="experiment-canvas" aria-label={`${view.title}，均值与95%置信区间`} tabIndex={0} onPointerDown={event=>{const rect=event.currentTarget.getBoundingClientRect(),x=event.clientX-rect.left,y=event.clientY-rect.top,target=[...hits.current].sort((a,b)=>Math.hypot(x-a.x,y-a.y)-Math.hypot(x-b.x,y-b.y))[0];if(target&&Math.hypot(x-target.x,y-target.y)<18)onSelect(target.row);}}/>;
}

function HeatmapChart({ rows, view, selectedCase, onSelect }: { rows: Aggregate[]; view: View; selectedCase?: string; onSelect: (row: Aggregate) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const hits = useRef<{ x: number; y: number; w: number; h: number; row: Aggregate }[]>([]);
  useEffect(() => {
    const canvas = ref.current; if (!canvas || !view.color) return;
    const rect = canvas.getBoundingClientRect(), ratio = Math.min(2, window.devicePixelRatio || 1); canvas.width = Math.max(1, rect.width * ratio); canvas.height = Math.max(1, rect.height * ratio);
    const ctx = canvas.getContext("2d"); if (!ctx) return; ctx.scale(ratio, ratio); ctx.clearRect(0, 0, rect.width, rect.height);
    const pad={l:72,r:24,t:24,b:54},width=rect.width-pad.l-pad.r,height=rect.height-pad.t-pad.b;
    const xs=unique(rows.map(row=>row[view.x])).sort(compare),ys=unique(rows.map(row=>row[view.y])).sort(compare),cellW=width/Math.max(1,xs.length),cellH=height/Math.max(1,ys.length);
    const values=rows.map(row=>metricValue(row,view.color!)),min=Math.min(...values),max=Math.max(...values),span=Math.max(1e-9,max-min);hits.current=[];
    rows.forEach(row=>{const xi=xs.findIndex(value=>String(value)===String(row[view.x])),yi=ys.findIndex(value=>String(value)===String(row[view.y])),x=pad.l+xi*cellW,y=pad.t+(ys.length-1-yi)*cellH,value=metricValue(row,view.color!),t=(value-min)/span;ctx.fillStyle=`hsl(${190-150*t} 65% ${18+22*t}%)`;ctx.fillRect(x+1,y+1,cellW-2,cellH-2);if(row.case===selectedCase){ctx.strokeStyle="#edf8f4";ctx.lineWidth=3;ctx.strokeRect(x+2,y+2,cellW-4,cellH-4);}ctx.fillStyle=t>.58?"#081617":"#edf8f4";ctx.font="700 10px ui-monospace, monospace";ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText(formatValue(value,view.color!),x+cellW/2,y+cellH/2);hits.current.push({x,y,w:cellW,h:cellH,row});});
    ctx.fillStyle="#78968f";ctx.font="10px ui-monospace, monospace";ctx.textAlign="center";ctx.textBaseline="top";xs.forEach((value,index)=>ctx.fillText(formatValue(value,view.x),pad.l+(index+.5)*cellW,pad.t+height+12));ctx.textAlign="right";ctx.textBaseline="middle";ys.forEach((value,index)=>ctx.fillText(formatValue(value,view.y),pad.l-9,pad.t+(ys.length-index-.5)*cellH));
  },[rows,view,selectedCase]);
  return <canvas ref={ref} className="experiment-canvas" aria-label={`${view.title}热图`} tabIndex={0} onPointerDown={event=>{const rect=event.currentTarget.getBoundingClientRect(),x=event.clientX-rect.left,y=event.clientY-rect.top,target=hits.current.find(item=>x>=item.x&&x<=item.x+item.w&&y>=item.y&&y<=item.y+item.h);if(target)onSelect(target.row);}}/>;
}

export default function ExperimentLab({ onReplayRepresentative }: { onReplayRepresentative: (request: ExperimentReplayRequest) => void }) {
  const [experimentId,setExperimentId]=useState(BUNDLE.experiments[0].id),experiment=BUNDLE.experiments.find(item=>item.id===experimentId)??BUNDLE.experiments[0];
  const [viewId,setViewId]=useState(experiment.views[0].id),view=experiment.views.find(item=>item.id===viewId)??experiment.views[0];
  const sweep=experiment.sweeps.find(item=>item.id===view.sweep)??experiment.sweeps[0];
  const [filters,setFilters]=useState<Record<string,string>>({}),[selectedCase,setSelectedCase]=useState<string>(),[representativeId,setRepresentativeId]=useState(experiment.representatives[0]?.id??"");
  useEffect(()=>{const next=BUNDLE.experiments.find(item=>item.id===experimentId)??BUNDLE.experiments[0];setViewId(next.views[0].id);setRepresentativeId(next.representatives[0]?.id??"");},[experimentId]);
  const filterDimensions=useMemo(()=>sweep.dimensions.filter(item=>item.key!==view.x&&item.key!==view.y&&item.key!==view.series&&item.key!=="zone_label"),[sweep,view]);
  useEffect(()=>{const next:Record<string,string>={};filterDimensions.forEach(dimension=>{const values=unique(sweep.aggregates.map(row=>row[dimension.key])).sort(compare),preferred=view.default_filters?.[dimension.key];next[dimension.key]=String(preferred??values[0]??"");});setFilters(next);setSelectedCase(undefined);},[experimentId,viewId,filterDimensions,sweep,view]);
  const rows=useMemo(()=>sweep.aggregates.filter(row=>filterDimensions.every(dimension=>filters[dimension.key]===undefined||String(row[dimension.key])===filters[dimension.key])),[sweep,filterDimensions,filters]);
  const selected=rows.find(row=>row.case===selectedCase)??rows[0],metricKey=view.type==="heatmap"?view.color!:view.y,metric=sweep.metrics.find(item=>item.key===metricKey);
  const representative=experiment.representatives.find(item=>item.id===representativeId)??experiment.representatives[0];
  useEffect(()=>{if(selected&&selected.case!==selectedCase)setSelectedCase(selected.case);},[selected,selectedCase]);
  return <section className="experiment-lab panel" aria-labelledby="experiment-lab-title">
    <div className="experiment-lab-head"><div><span className="panel-kicker">PROXY SIMULATION / 实验工作台</span><h2 id="experiment-lab-title">五组实验统计、置信区间与代表案例索引</h2><p>{BUNDLE.simulator.disclaimer}；{BUNDLE.simulator.statistics}。</p></div><div className="bundle-badges"><span>{BUNDLE.schema_version}</span><strong>{BUNDLE.experiments.reduce((sum,item)=>sum+item.run_count,0)} RUNS</strong><em>20-SEED STATISTICS</em></div></div>
    <div className="experiment-tabs" role="tablist">{BUNDLE.experiments.map(item=><button key={item.id} className={item.id===experiment.id?"active":""} onClick={()=>setExperimentId(item.id)}><span>{item.title.split(" · ")[0]}</span><strong>{item.title.split(" · ")[1]}</strong><small>{item.run_count} runs</small></button>)}</div>
    <div className="lab-summary"><div><span>实验目的</span><p>{experiment.purpose}</p></div><div><span>统计口径</span><strong>{experiment.run_count} 次运行 · {experiment.seed_count} 个固定 seed</strong><small>图中实线/色块为均值，阴影为95%置信区间</small></div></div>
    <div className="lab-controls"><label>图形与指标<select value={view.id} onChange={event=>setViewId(event.target.value)}>{experiment.views.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select></label>{filterDimensions.map(dimension=><label key={dimension.key}>{dimension.label}<select value={filters[dimension.key]??""} onChange={event=>setFilters(current=>({...current,[dimension.key]:event.target.value}))}>{unique(sweep.aggregates.map(row=>row[dimension.key])).sort(compare).map(value=><option key={String(value)} value={String(value)}>{formatValue(value,dimension.key,dimension.unit)}</option>)}</select></label>)}</div>
    <div className="lab-chart-grid"><div className="lab-chart"><div className="chart-title"><div><span>{view.type==="heatmap"?"MEAN HEATMAP":"MEAN + 95% CI"}</span><h3>{view.title}</h3></div><em>仿真端预聚合 · n={selected?.n??experiment.seed_count}</em></div>{view.type==="heatmap"?<HeatmapChart rows={rows} view={view} selectedCase={selected?.case} onSelect={row=>setSelectedCase(row.case)}/>:<LineCIChart rows={rows} view={view} selectedCase={selected?.case} onSelect={row=>setSelectedCase(row.case)}/>}<div className="chart-explanation"><span><b>横轴</b>{view.x_label}</span><span><b>{view.type==="heatmap"?"纵轴":"纵轴"}</b>{view.y_label}</span>{view.color_label&&<span><b>颜色</b>{view.color_label}</span>}<p><b>图意</b>{view.interpretation}</p></div></div>
      <aside className="lab-inspector"><div className="inspector-heading"><span>20-SEED 统计点</span><strong>{selected?.case??"—"}</strong><small>点击曲线点或热图格子查看</small></div>{selected&&<><dl>{sweep.dimensions.filter(item=>selected[item.key]!==undefined&&selected[item.key]!==null).map(item=><div key={item.key}><dt>{item.label}</dt><dd>{formatValue(selected[item.key],item.key,item.unit)}</dd></div>)}</dl><div className="selected-stat"><span>{metric?.label??view.color_label??view.y_label}</span><strong>{formatValue(metricValue(selected,metricKey),metricKey,metric?.unit)}</strong><small>95% CI ± {formatValue(metricCi(selected,metricKey),metricKey,metric?.unit)} · n={selected.n}</small></div><div className="safety-stat">{[["constraint_violations","硬约束违规"],["no_fly_violations","禁飞区违规"],["minimum_separation_m","最小机间距"],["minimum_battery_wh","最低电量"],["maximum_temperature_c","最高温度"]].filter(([key])=>selected[`${key}_mean`]!==undefined).map(([key,label])=><span key={key}><small>{label}</small><b>{formatValue(selected[`${key}_mean`],key)}</b></span>)}</div></>}</aside>
    </div>
    {representative&&<div className="representative-strip"><div><span className="panel-kicker">SINGLE-SEED REPRESENTATIVE / 单个seed代表案例</span><h3>代表时间线索引</h3><p>代表案例用于检查动作和航迹，不等于上方20-seed均值。</p></div><label>案例<select value={representative.id} onChange={event=>setRepresentativeId(event.target.value)}>{experiment.representatives.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label><div className="representative-kpis"><span><small>seed</small><b>{formatValue(representative.configuration.seed)}</b></span><span><small>无人机</small><b>{unique(representative.timeline.map(item=>item.drone_id)).length} 架</b></span><span><small>事件</small><b>{representative.timeline.length}</b></span><span><small>完成率</small><b>{formatValue(representative.summary.completion_rate,"completion_rate")}</b></span></div><button className="replay-representative" onClick={()=>onReplayRepresentative({experimentId:experiment.id,experimentTitle:experiment.title,representativeId:representative.id,representativeLabel:representative.label,configuration:representative.configuration,summary:representative.summary,tasks:representative.tasks,drones:representative.drones,timeline:representative.timeline,environment:representative.environment})}>在主地图回放此案例</button></div>}
  </section>;
}
