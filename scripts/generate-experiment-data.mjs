import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const input = resolve(root, "app/data/experiments/experiment_bundle.json");
const bundle = JSON.parse(await readFile(input, "utf8"));

if (bundle.schema_version !== "uav-experiment-bundle/v1") {
  throw new Error(`不支持的实验包版本：${bundle.schema_version ?? "missing"}`);
}
if (!Array.isArray(bundle.experiments) || bundle.experiments.length !== 5) {
  throw new Error("实验包必须包含五组实验");
}
for (const experiment of bundle.experiments) {
  if (!experiment.id || !experiment.views?.length || !experiment.sweeps?.length) {
    throw new Error(`实验包条目不完整：${experiment.id ?? "unknown"}`);
  }
  for (const item of experiment.views) {
    if (!item.x_label || !item.y_label || !item.interpretation) {
      throw new Error(`图表说明不完整：${experiment.id}/${item.id ?? "unknown"}`);
    }
    if (item.type === "heatmap" && !item.color_label) {
      throw new Error(`热图缺少颜色说明：${experiment.id}/${item.id}`);
    }
  }
}

const output = resolve(root, "app/generated/experimentData.ts");
await mkdir(dirname(output), { recursive: true });
await writeFile(
  output,
  `// Generated from app/data/experiments by scripts/generate-experiment-data.mjs.\n` +
    `export const EXPERIMENT_BUNDLE = ${JSON.stringify(bundle)} as const;\n`,
  "utf8",
);

console.log(`generated ${output}`);
