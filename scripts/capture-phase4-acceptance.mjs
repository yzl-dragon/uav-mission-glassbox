import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const endpoint = "http://127.0.0.1:9223";
const siteUrl = "http://127.0.0.1:4173";
const outputDir = resolve("acceptance-screenshots");
await mkdir(outputDir, { recursive: true });

const target = await fetch(`${endpoint}/json/new?${encodeURIComponent(siteUrl)}`, { method: "PUT" }).then((response) => response.json());
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolveOpen, rejectOpen) => {
  socket.addEventListener("open", resolveOpen, { once: true });
  socket.addEventListener("error", rejectOpen, { once: true });
});

let commandId = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (!message.id) return;
  const callback = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) callback?.reject(new Error(message.error.message));
  else callback?.resolve(message.result);
});

function command(method, params = {}) {
  const id = ++commandId;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolveCommand, rejectCommand) => pending.set(id, { resolve: resolveCommand, reject: rejectCommand }));
}

const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
const evaluate = async (expression) => {
  const result = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
};

async function waitForText(text, timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      if (await evaluate(`Boolean(document.body?.innerText?.includes(${JSON.stringify(text)}))`)) return;
    } catch {}
    await delay(120);
  }
  throw new Error(`Timed out waiting for ${text}`);
}

async function clickButton(text, selector = "button") {
  const clicked = await evaluate(`(() => {
    const target = [...document.querySelectorAll(${JSON.stringify(selector)})].find((node) => node.textContent.includes(${JSON.stringify(text)}));
    if (!target) return false;
    target.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Button not found: ${text}`);
  await delay(500);
}

async function seek(timeS) {
  const changed = await evaluate(`(() => {
    const input = document.querySelector('.timeline-track input[type="range"]');
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(String(timeS))});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  if (!changed) throw new Error("Timeline input not found");
  await delay(650);
}

async function loadRepresentative(experimentText, representativeText, timeS) {
  await evaluate("document.querySelector('.experiment-lab')?.scrollIntoView({block:'start'})");
  await delay(250);
  await clickButton(experimentText, ".experiment-tabs button");
  const selected = await evaluate(`(() => {
    const strip = document.querySelector('.representative-strip');
    const select = strip?.querySelector('select');
    if (!select) return false;
    const option = [...select.options].find((item) => item.textContent.includes(${JSON.stringify(representativeText)}));
    if (!option) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(select, option.value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  if (!selected) throw new Error(`Representative not found: ${representativeText}`);
  await delay(400);
  await clickButton("在主地图回放此案例", ".representative-strip button");
  await waitForText("单 seed 代表案例 · 非 20-seed 均值");
  await seek(timeS);
}

async function capture(name) {
  const clip = await evaluate(`(() => {
    const element = document.querySelector('.workspace-grid');
    element.scrollIntoView({ block: 'start' });
    const rect = element.getBoundingClientRect();
    return { x: rect.left + scrollX, y: rect.top + scrollY, width: rect.width, height: Math.min(rect.height, 780) };
  })()`);
  await delay(250);
  const screenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { ...clip, scale: 1 } });
  await writeFile(resolve(outputDir, name), Buffer.from(screenshot.data, "base64"));
  console.log(`captured ${name}`);
}

await command("Page.enable");
await command("Runtime.enable");
await command("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false });
await command("Page.navigate", { url: siteUrl });
await waitForText("UAV Mission Glassbox");
await delay(5200);

await capture("01-city-logistics.png");
await clickButton("搜索救援", ".scenario-tabs button");
await delay(4200);
await capture("02-disaster-rescue.png");
await clickButton("农田喷洒", ".scenario-tabs button");
await delay(4200);
await capture("03-farm-spraying.png");

await loadRepresentative("实验04", "8机压力", 220);
await capture("04-experiment04-eight-uav.png");
await loadRepresentative("实验05", "双屏障+5障碍", 260);
await capture("05-experiment05-combined-stress.png");

const sourceStateBefore = await evaluate(`({
  telemetry: document.querySelector('.selected-detail dl')?.innerText,
  summary: document.querySelector('.actual-summary')?.innerText,
  clock: document.querySelector('.clock-block strong')?.innerText,
})`);
await clickButton("场景代理", ".layer-controls button");
const sourceStateAfter = await evaluate(`({
  telemetry: document.querySelector('.selected-detail dl')?.innerText,
  summary: document.querySelector('.actual-summary')?.innerText,
  clock: document.querySelector('.clock-block strong')?.innerText,
})`);
if (JSON.stringify(sourceStateBefore) !== JSON.stringify(sourceStateAfter)) throw new Error("Scene proxy toggle changed source telemetry or metrics");
await clickButton("场景代理", ".layer-controls button");
console.log("verified proxy toggle leaves telemetry, summary, and replay time unchanged");

socket.close();
