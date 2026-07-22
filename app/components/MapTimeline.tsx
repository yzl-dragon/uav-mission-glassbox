"use client";

import { CRITICAL_ACTIONS, isCriticalAction } from "../lib/replayAdapter";
import type { ReplayEvent } from "../lib/replayAdapter";

type Props = {
  currentS: number;
  durationS: number;
  events: ReplayEvent[];
  running: boolean;
  speed: number;
  readOnlyReplay: boolean;
  actionFilter: string;
  onSeek: (timeS: number) => void;
  onToggle: () => void;
  onReset: () => void;
  onSpeed: (speed: number) => void;
  onFilter: (action: string) => void;
};

export default function MapTimeline({
  currentS, durationS, events, running, speed, readOnlyReplay, actionFilter,
  onSeek, onToggle, onReset, onSpeed, onFilter,
}: Props) {
  const uniqueEvents = [...new Map(events.map((event) => [`${event.time_s}:${event.action}:${event.drone_id}`, event])).values()]
    .sort((a, b) => a.time_s - b.time_s);
  const filtered = uniqueEvents.filter((event) => actionFilter === "ALL" || event.action === actionFilter);
  const previous = [...filtered].reverse().find((event) => event.time_s < currentS - .001);
  const next = filtered.find((event) => event.time_s > currentS + .001);
  const nextCritical = uniqueEvents.find((event) => event.time_s > currentS + .001 && isCriticalAction(event.action));
  const actions = [...new Set(events.map((event) => event.action))].sort();
  const maximum = Math.max(1, durationS);

  return <div className="map-timeline" aria-label="回放事件时间轴">
    <div className="timeline-row">
      <div className="timeline-transport">
        <button onClick={onToggle} aria-label={running ? "暂停回放" : "继续回放"}>{running ? "Ⅱ" : "▶"}</button>
        <button onClick={onReset} aria-label="重置到起点">↺</button>
        <button onClick={() => previous && onSeek(previous.time_s)} disabled={!readOnlyReplay || !previous} aria-label="上一个事件">‹ 事件</button>
        <button onClick={() => next && onSeek(next.time_s)} disabled={!readOnlyReplay || !next} aria-label="下一个事件">事件 ›</button>
        <button className="critical-jump" onClick={() => nextCritical && onSeek(nextCritical.time_s)} disabled={!readOnlyReplay || !nextCritical} aria-label="跳到下一个关键事件">下个关键</button>
      </div>
      <strong>{currentS.toFixed(1)} / {readOnlyReplay ? durationS.toFixed(1) : "实时"} s</strong>
      <label>动作筛选<select value={actionFilter} onChange={(event) => onFilter(event.target.value)} disabled={!readOnlyReplay}><option value="ALL">全部动作</option>{actions.map((action) => <option key={action} value={action}>{action}</option>)}</select></label>
      <div className="timeline-speed">{[1,2,4].map((value) => <button key={value} className={speed === value ? "active" : ""} onClick={() => onSpeed(value)}>{value}×</button>)}</div>
    </div>
    <div className="timeline-track">
      <input aria-label="拖动回放时间" type="range" min="0" max={maximum} step=".1" value={Math.min(currentS, maximum)} disabled={!readOnlyReplay} onChange={(event) => onSeek(Number(event.target.value))}/>
      {readOnlyReplay && filtered.map((event) => <button
        key={`${event.time_s}-${event.drone_id}-${event.action}`}
        className={isCriticalAction(event.action) ? "event-marker critical" : "event-marker"}
        style={{ left: `${event.time_s / maximum * 100}%` }}
        title={`T+${event.time_s.toFixed(1)}s · UAV-${String(event.drone_id + 1).padStart(2,"0")} · ${event.action}`}
        aria-label={`跳到 T+${event.time_s.toFixed(1)}秒，${event.action}`}
        onClick={() => onSeek(event.time_s)}
      />)}
    </div>
    <div className="timeline-next"><span>下一关键事件</span><b>{nextCritical ? `T+${nextCritical.time_s.toFixed(1)}s · UAV-${String(nextCritical.drone_id+1).padStart(2,"0")} · ${nextCritical.action}` : "当前轮次无后续关键事件"}</b><small>{CRITICAL_ACTIONS.join(" · ")}</small></div>
  </div>;
}
