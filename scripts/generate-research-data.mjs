import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scenarioKeys = ["logistics", "rescue", "spraying"];

function parseCsv(text) {
  const [headerLine, ...lines] = text.trim().split(/\r?\n/);
  const headers = headerLine.split(",");
  return lines.map((line) => {
    const cells = line.split(",");
    const row = Object.fromEntries(headers.map((key, index) => [key, cells[index] ?? ""]));
    return {
      step: Number(row.step),
      time_s: Number(row.time_s),
      drone_id: Number(row.drone_id),
      action: row.action,
      task_id: row.task_id,
      x: Number(row.x),
      y: Number(row.y),
      z: Number(row.z),
      vx: Number(row.vx),
      vy: Number(row.vy),
      vz: Number(row.vz),
      ax: Number(row.ax),
      ay: Number(row.ay),
      az: Number(row.az),
      battery_wh: Number(row.battery_wh),
      temperature_c: Number(row.temperature_c),
      link_up: Number(row.link_up),
      link_type: row.link_type,
      bandwidth_kbps: Number(row.bandwidth_kbps),
      pdr: Number(row.pdr),
      latency_ms: Number(row.latency_ms),
      storage_mb: Number(row.storage_mb),
      pending_results: Number(row.pending_results),
      model_version: Number(row.model_version),
      note: row.note,
    };
  });
}

const datasets = {};
for (const key of scenarioKeys) {
  const base = resolve(root, "app/data/python", key);
  const [timelineText, summaryText] = await Promise.all([
    readFile(resolve(base, "timeline.csv"), "utf8"),
    readFile(resolve(base, "summary.json"), "utf8"),
  ]);
  datasets[key] = {
    engine: "Python mission-chain simulator",
    timeline: parseCsv(timelineText),
    ...JSON.parse(summaryText),
  };
}

const output = resolve(root, "app/generated/researchData.ts");
await mkdir(dirname(output), { recursive: true });
await writeFile(
  output,
  `// Generated from app/data/python by scripts/generate-research-data.mjs.\n` +
    `export const RESEARCH_DATA = ${JSON.stringify(datasets, null, 2)} as const;\n`,
  "utf8",
);

console.log(`generated ${output}`);
