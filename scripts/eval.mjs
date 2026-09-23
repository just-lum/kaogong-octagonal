// 用 CDP 打开页面并在页面上下文里求值，把结果打到终端。
// 截图只能看到画面上的文字，这个工具用来直接读取运行中的状态。
// 用法：node scripts/eval.mjs <url> <expr> [waitMs]
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

const EDGE_CANDIDATES = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
];

const [, , url, expr, waitMs = "9000"] = process.argv;
if (!url || !expr) {
  console.error("usage: node scripts/eval.mjs <url> <expr> [waitMs]");
  process.exit(2);
}

const edge = EDGE_CANDIDATES.find((p) => existsSync(p));
if (!edge) {
  console.error("找不到 Chromium 内核浏览器");
  process.exit(1);
}

const port = 9700 + Math.floor(Math.random() * 250);
const profile = `${process.env.TEMP ?? "/tmp"}/edge-eval-${Date.now()}-${port}`;

const child = spawn(
  edge,
  [
    "--headless=new",
    "--enable-unsafe-swiftshader",
    "--use-angle=swiftshader",
    "--no-first-run",
    "--disable-extensions",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--window-size=1570,805",
    "about:blank",
  ],
  { stdio: "ignore" },
);

let target = null;
for (let i = 0; i < 80 && !target; i++) {
  await delay(250);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/list`);
    const list = await res.json();
    target = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl) ?? null;
  } catch {
    /* 端口未就绪 */
  }
}
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
await delay(Number(waitMs));

const res = await send("Runtime.evaluate", {
  expression: `(async () => { try { return String(await (${expr})); } catch (e) { return "ERR: " + e.message; } })()`,
  returnByValue: true,
  awaitPromise: true,
});
console.log(res?.result?.result?.value ?? JSON.stringify(res).slice(0, 400));

ws.close();
child.kill();
