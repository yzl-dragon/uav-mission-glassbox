import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const direct = resolve(root, "node_modules/.bin/esbuild");
const pnpmRoot = resolve(root, "node_modules/.pnpm");
const platformPackage = process.platform === "darwin"
  ? `@esbuild/${process.arch === "arm64" ? "darwin-arm64" : "darwin-x64"}`
  : null;

let executable = existsSync(direct) ? direct : null;
if (!executable && platformPackage && existsSync(pnpmRoot)) {
  const prefix = platformPackage.replace("/", "+") + "@";
  const matches = readdirSync(pnpmRoot).filter((name) => name.startsWith(prefix)).sort().reverse();
  for (const name of matches) {
    const candidate = resolve(pnpmRoot, name, "node_modules", platformPackage, "bin/esbuild");
    if (existsSync(candidate)) { executable = candidate; break; }
  }
}
if (!executable) throw new Error("找不到 esbuild；请先运行 npm install 或 pnpm install");

const result = spawnSync(executable, [
  "standalone/main.tsx", "--bundle", "--platform=browser", "--format=iife",
  "--target=es2020", "--conditions=style", "--outfile=offline/app.js", "--loader:.css=css",
], { cwd: root, stdio: "inherit" });
if (result.status !== 0) process.exit(result.status ?? 1);

const pnpmDependencyPath = /(?:\.\.\/)+(?:[^/"'\n]+\/)*node_modules\/\.pnpm\/[^/"'\n]+\/node_modules\//g;
const normalizeDependencyPaths = (content) => content.replace(pnpmDependencyPath, "node_modules/");
const css = normalizeDependencyPaths(readFileSync(resolve(root, "offline/app.css"), "utf8"));
const javascript = normalizeDependencyPaths(readFileSync(resolve(root, "offline/app.js"), "utf8"))
  .replace(/<\/script/gi, "<\\/script");
const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="description" content="无人机任务链、运动、能源、温度、环境约束与实验指标可视化。">
  <title>UAV Mission Glassbox｜无人机任务链可视化</title>
  <style>${css}</style>
</head>
<body>
  <div id="root"></div>
  <noscript>这个网站需要浏览器启用 JavaScript。</noscript>
  <script>${javascript}</script>
</body>
</html>`;
writeFileSync(resolve(root, "打开无人机可视化网站.html"), html, "utf8");
console.log("generated 打开无人机可视化网站.html (single-file offline site)");
