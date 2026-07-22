import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const source = resolve(root, "打开无人机可视化网站.html");
const outputDirectory = resolve(root, "pages-dist");
const target = resolve(outputDirectory, "index.html");

if (!existsSync(source)) {
  throw new Error("找不到本地单文件网站；请先运行 npm run build:offline");
}

rmSync(outputDirectory, { recursive: true, force: true });
mkdirSync(outputDirectory, { recursive: true });
copyFileSync(source, target);
writeFileSync(resolve(outputDirectory, ".nojekyll"), "", "utf8");

const sourceBytes = readFileSync(source);
const targetBytes = readFileSync(target);
if (!sourceBytes.equals(targetBytes)) {
  throw new Error("Pages index.html 与本地离线 HTML 内容不一致");
}

const sha256 = createHash("sha256").update(sourceBytes).digest("hex");
console.log(`generated pages-dist/index.html and .nojekyll (sha256 ${sha256})`);
