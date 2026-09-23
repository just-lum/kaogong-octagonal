// 基于 CDP 的截图工具：真正等待页面就绪，而不是靠 --virtual-time-budget 赌时机。
// 用法：
//   node scripts/shot.mjs <url> <out.png> [readyExpr] [width] [height]
// readyExpr 默认等待 document.body.dataset.ready === 'true'；传 "true" 可立即截图。
import { spawn } from "node:child_process";
import { writeFileSync, existsSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

const EDGE_CANDIDATES = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
];

const [, , url, out, readyExpr = "document.body.dataset.ready === 'true'", w = "1600", h = "900"] =
  process.argv;

if (!url || !out) {
  console.error("usage: node scripts/shot.mjs <url> <out.png> [readyExpr] [width] [height]");
  process.exit(2);
}

const edge = EDGE_CANDIDATES.find((p) => existsSync(p));
if (!edge) {
  console.error("找不到 Chromium 内核浏览器");
  process.exit(1);
}

const port = 9400 + Math.floor(Math.random() * 300);
const profile = `${process.env.TEMP ?? "/tmp"}/edge-cdp-${Date.now()}-${port}`;

const child = spawn(
  edge,
  [
    "--headless=new",
    "--enable-unsafe-swiftshader",
    "--use-angle=swiftshader",
    "--hide-scrollbars",
    "--no-first-run",
    "--disable-extensions",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    `--window-size=${w},${h}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

async function findTarget() {
  for (let i = 0; i < 80; i++) {
    await delay(250);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      /* 端口还没起来 */
    }
  }
  return null;
}

const target = await findTarget();
if (!target) {
  console.error("调试端口未就绪");
  child.kill();
  process.exit(1);
}

const ws = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
let nextId = 1;

ws.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});

function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
await send("Page.enable");
await send("Runtime.enable");
await send("Page.navigate", { url });

let ready = false;
let lastState = "";
for (let i = 0; i < 160; i++) {
  await delay(500);
  const res = await send("Runtime.evaluate", {
    expression: `(() => { try { return (${readyExpr}) ? "ready" : "waiting"; } catch (e) { return "err:" + e.message; } })()`,
    returnByValue: true,
  });
  const value = res?.result?.result?.value;
  lastState = String(value);
  if (value === "ready") {
    ready = true;
    break;
  }
}

const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
if (shot?.result?.data) {
  writeFileSync(out, Buffer.from(shot.result.data, "base64"));
  console.log(`saved ${out}  ready=${ready}  state=${lastState}`);
} else {
  console.error("截图失败：", JSON.stringify(shot).slice(0, 400));
  process.exitCode = 1;
}

ws.close();
child.kill();
