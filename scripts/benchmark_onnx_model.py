#!/usr/bin/env python3
"""Benchmark an ONNX edge model and emit JSON importable by the website."""

from __future__ import annotations

import argparse
import json
import resource
import statistics
import time
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("model", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--shape", default="1,3,224,224", help="Input shape, comma separated")
    parser.add_argument("--runs", type=int, default=30)
    parser.add_argument("--baseline-params-m", type=float, default=0.0)
    args = parser.parse_args()
    try:
        import numpy as np
        import onnx
        import onnxruntime as ort
    except ImportError as exc:  # pragma: no cover - user environment dependent
        raise SystemExit("需要 numpy、onnx、onnxruntime") from exc

    model = onnx.load(args.model)
    params = sum(int(np.prod(initializer.dims)) for initializer in model.graph.initializer)
    session = ort.InferenceSession(str(args.model), providers=["CPUExecutionProvider"])
    input_meta = session.get_inputs()[0]
    shape = tuple(int(v) for v in args.shape.split(","))
    sample = np.random.default_rng(7).normal(size=shape).astype(np.float32)
    for _ in range(5):
        session.run(None, {input_meta.name: sample})
    rss_before = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    timings = []
    for _ in range(args.runs):
        start = time.perf_counter()
        session.run(None, {input_meta.name: sample})
        timings.append((time.perf_counter() - start) * 1000)
    rss_after = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    # macOS reports bytes; Linux reports KiB.
    peak_mb = max(rss_before, rss_after) / (1024 * 1024 if rss_after > 10_000_000 else 1024)
    result = {
        "model": args.model.name,
        "params_m": round(params / 1_000_000, 4),
        "latency_ms": round(statistics.median(timings), 3),
        "p95_latency_ms": round(sorted(timings)[max(0, int(len(timings) * 0.95) - 1)], 3),
        "peak_memory_mb": round(peak_mb, 3),
        "baseline_params_m": args.baseline_params_m,
        "device": "CPUExecutionProvider",
        "runs": args.runs,
    }
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
