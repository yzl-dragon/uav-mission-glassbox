#!/usr/bin/env python3
"""Convert a RotorPy NPZ or PyBullet-style CSV log to the website replay schema.

The converter is deliberately tolerant: it recognizes common time, position,
velocity, battery, temperature, action, and task column names. Missing optional
telemetry is filled with documented defaults so a trajectory can still replay.
"""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
from typing import Any


def first(mapping: dict[str, Any], names: tuple[str, ...], default: Any = None) -> Any:
    for name in names:
        if name in mapping and mapping[name] not in (None, ""):
            return mapping[name]
    return default


def csv_samples(path: Path) -> list[dict[str, Any]]:
    with path.open(newline="", encoding="utf-8-sig") as handle:
        rows = list(csv.DictReader(handle))
    samples = []
    for index, row in enumerate(rows):
        samples.append(
            {
                "time_s": float(first(row, ("time_s", "time", "t"), index * 0.02)),
                "drone_id": int(float(first(row, ("drone_id", "uav_id", "vehicle_id"), 0))),
                "x": float(first(row, ("x", "px", "pos_x"), 0)),
                "y": float(first(row, ("y", "py", "pos_y"), 0)),
                "z": float(first(row, ("z", "pz", "pos_z"), 0)),
                "vx": float(first(row, ("vx", "vel_x"), 0)),
                "vy": float(first(row, ("vy", "vel_y"), 0)),
                "vz": float(first(row, ("vz", "vel_z"), 0)),
                "battery_pct": float(first(row, ("battery_pct", "battery", "soc"), 100)),
                "temperature_c": float(first(row, ("temperature_c", "temperature", "temp"), 28)),
                "action": str(first(row, ("action", "phase", "mode"), "FLY_AND_INFER")),
                "task_id": str(first(row, ("task_id", "target_id"), "")),
            }
        )
    return samples


def npz_samples(path: Path) -> list[dict[str, Any]]:
    try:
        import numpy as np
    except ImportError as exc:  # pragma: no cover - user environment dependent
        raise SystemExit("读取 NPZ 需要 numpy：python3 -m pip install numpy") from exc

    data = np.load(path, allow_pickle=True)
    keys = set(data.files)
    time_key = next((key for key in ("time", "t", "time_s") if key in keys), None)
    pos_key = next((key for key in ("x", "position", "pos") if key in keys), None)
    vel_key = next((key for key in ("v", "velocity", "vel") if key in keys), None)
    if time_key is None or pos_key is None:
        raise SystemExit(f"NPZ 至少需要 time/t 与 x/position/pos；现有字段：{sorted(keys)}")
    times = data[time_key]
    positions = data[pos_key]
    velocities = data[vel_key] if vel_key else np.zeros_like(positions)
    if positions.ndim != 2 or positions.shape[1] < 3:
        raise SystemExit("位置数组必须是 N×3")
    return [
        {
            "time_s": float(times[i]),
            "drone_id": 0,
            "x": float(positions[i, 0]),
            "y": float(positions[i, 1]),
            "z": float(positions[i, 2]),
            "vx": float(velocities[i, 0]),
            "vy": float(velocities[i, 1]),
            "vz": float(velocities[i, 2]),
            "battery_pct": 100.0,
            "temperature_c": 28.0,
            "action": "FLY_AND_INFER",
            "task_id": "",
        }
        for i in range(len(times))
    ]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--engine", default="external", help="Displayed source name")
    parser.add_argument("--scenario", choices=("logistics", "rescue", "spraying"), default="logistics")
    args = parser.parse_args()
    samples = npz_samples(args.input) if args.input.suffix.lower() == ".npz" else csv_samples(args.input)
    payload = {"engine": args.engine, "scenario": args.scenario, "samples": samples}
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {len(samples)} samples to {args.output}")


if __name__ == "__main__":
    main()
