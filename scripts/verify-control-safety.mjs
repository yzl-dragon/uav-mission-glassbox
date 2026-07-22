import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const endpoint = process.env.CDP_ENDPOINT ?? "http://127.0.0.1:9223";
const siteUrl = process.env.SITE_URL ?? "http://127.0.0.1:4173";
const outputDir = resolve("acceptance-screenshots", "v081-controls");
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

async function waitForText(text, timeoutMs = 12000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      if (await evaluate(`Boolean(document.body?.innerText?.includes(${JSON.stringify(text)}))`)) return;
    } catch {}
    await delay(120);
  }
  throw new Error(`Timed out waiting for ${text}`);
}

async function clickAria(label) {
  const result = await evaluate(`(() => {
    const target = document.querySelector('[aria-label=${JSON.stringify(label)}]');
    if (!target) return { ok: false, reason: 'missing' };
    const rect = target.getBoundingClientRect();
    const style = getComputedStyle(target);
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    const exposed = !!hit && (hit === target || target.contains(hit));
    if (!exposed || rect.width < 1 || rect.height < 1 || style.visibility === 'hidden' || style.display === 'none') return { ok: false, reason: 'covered-or-hidden', rect: {left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom}, hit: hit?.className ?? hit?.tagName };
    target.click();
    return { ok: true };
  })()`);
  if (!result.ok) throw new Error(`${label}: ${JSON.stringify(result)}`);
  await delay(180);
}

async function setFleetSize(size) {
  const changed = await evaluate(`(() => {
    const input = document.querySelector('input[aria-label="无人机数量"]');
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(String(size))});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  if (!changed) throw new Error("Fleet size input not found");
  await delay(260);
}

async function assertSafety(viewport, state) {
  const result = await evaluate(`(() => {
    const dock = document.querySelector('[data-map-control-dock]');
    const drawer = document.querySelector('[data-fleet-drawer]');
    if (!dock) return { ok: false, reason: 'dock missing' };
    const required = ['缩小地图','当前地图缩放比例','放大地图','适配全部对象','重置地图视图','${state === "collapsed" ? "展开机队状态" : "收起机队状态"}','退出地图专注模式'];
    const controls = required.map(label => document.querySelector('[aria-label="' + label + '"]'));
    if (controls.some(control => !control)) return { ok: false, reason: 'escape control missing', required };
    const invisible = controls.filter(control => {
      const rect = control.getBoundingClientRect(), style = getComputedStyle(control);
      return rect.width < 1 || rect.height < 1 || style.display === 'none' || style.visibility === 'hidden' || rect.left < 0 || rect.top < 0 || rect.right > innerWidth || rect.bottom > innerHeight;
    }).map(control => control.getAttribute('aria-label'));
    if (invisible.length) return { ok: false, reason: 'escape controls invisible', invisible };
    const a = dock.getBoundingClientRect();
    const drawerVisible = drawer && getComputedStyle(drawer).display !== 'none' && drawer.getBoundingClientRect().width > 0;
    const b = drawerVisible ? drawer.getBoundingClientRect() : null;
    const intersects = !!b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    return { ok: !intersects, intersects, dock: {left:a.left,top:a.top,right:a.right,bottom:a.bottom,width:a.width,height:a.height}, drawer: b ? {left:b.left,top:b.top,right:b.right,bottom:b.bottom,width:b.width,height:b.height} : null, drawerVisible };
  })()`);
  if (!result.ok) throw new Error(`${viewport} ${state}: ${JSON.stringify(result)}`);
  return result;
}

async function screenshot(name) {
  const shot = await command("Page.captureScreenshot", { format: "png", fromSurface: true });
  await writeFile(resolve(outputDir, name), Buffer.from(shot.data, "base64"));
}

const viewports = [
  { width: 1920, height: 1080, name: "1920x1080" },
  { width: 1440, height: 900, name: "1440x900" },
  { width: 1280, height: 800, name: "1280x800" },
  { width: 720, height: 900, name: "720x900" },
];

await command("Page.enable");
await command("Runtime.enable");

const report = [];
for (const viewport of viewports) {
  await command("Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: false });
  await command("Page.navigate", { url: `${siteUrl}?viewport=${viewport.name}&t=${Date.now()}` });
  await waitForText("UAV Mission Glassbox");
  await delay(800);
  await clickAria("进入地图专注模式");
  await assertSafety(viewport.name, "expanded");

  await clickAria("放大地图");
  await clickAria("放大地图");
  const zoom140 = await evaluate("document.querySelector('[aria-label=\"当前地图缩放比例\"]')?.textContent");
  if (zoom140 !== "140%") throw new Error(`${viewport.name}: expected 140%, got ${zoom140}`);
  await clickAria("缩小地图");
  await clickAria("缩小地图");
  const zoom100 = await evaluate("document.querySelector('[aria-label=\"当前地图缩放比例\"]')?.textContent");
  if (zoom100 !== "100%") throw new Error(`${viewport.name}: expected 100%, got ${zoom100}`);
  await clickAria("适配全部对象");
  await clickAria("重置地图视图");
  await clickAria("收起机队状态");
  await assertSafety(viewport.name, "collapsed");
  await clickAria("展开机队状态");
  const expanded = await assertSafety(viewport.name, "expanded");

  for (const size of [1, 8, 12]) {
    await setFleetSize(size);
    await assertSafety(`${viewport.name}/${size}机`, "expanded");
  }
  await setFleetSize(8);
  await screenshot(`${viewport.name}-control-safety.png`);

  await clickAria("退出地图专注模式");
  const normal = await evaluate("!document.querySelector('.workspace-grid')?.classList.contains('map-focus')");
  if (!normal) throw new Error(`${viewport.name}: focus mode did not exit`);
  await clickAria("进入地图专注模式");
  await assertSafety(`${viewport.name}/reenter`, "expanded");
  await evaluate("document.querySelector('.mission-canvas')?.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
  await delay(150);
  const escaped = await evaluate("!document.querySelector('.workspace-grid')?.classList.contains('map-focus')");
  if (!escaped) throw new Error(`${viewport.name}: Escape did not exit focus mode`);
  report.push({ viewport: viewport.name, zoom140, zoom100, expanded, normalMode: true, escapeExit: true, fleetSizes: [1, 8, 12] });
}

await writeFile(resolve(outputDir, "control-safety-report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
socket.close();
