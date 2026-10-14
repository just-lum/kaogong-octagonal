import "./style.css";
import { ArchiveScene, setDrawRatio } from "./scene";
import { stageLayout } from "./viewport-layout";
import { entries, columns, type ArchiveEntry } from "./data";
import { BootSequence } from "./boot";
import { TerminalAudio, renderProbe } from "./audio";
import {
  QUALITY_LABELS,
  QUALITY_PRESETS,
  readQualitySettings,
  writeQualitySettings,
  type QualityPreset,
} from "./quality";

const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;

const viewport = $("#viewport");
const stage = $("#stage");

// 三维画布铺满真实视口（全分辨率），DOM 界面在逻辑舞台上等比缩放。
const canvas = document.createElement("canvas");
canvas.id = "gl";
canvas.className = "gl";
viewport.prepend(canvas);

stage.innerHTML = `
  <header class="brand">
    <span class="brand-mark">考工录</span>
    <span class="brand-sub">八面 · 汉剑器物档案</span>
  </header>

  <section class="callout" aria-label="当前条目">
    <div class="callout-eyebrow">
      <span>卷 五</span>
      <i>／</i>
      <span id="readout-column">形制</span>
    </div>
    <button class="callout-title" data-action="open">
      <span id="readout-id">八-001</span>
      <strong id="readout-title">—</strong>
      <i class="callout-cta">读取拔剑 <b>↗</b></i>
    </button>
    <div class="callout-rule"><i id="callout-rule-fill"></i></div>
    <div class="callout-meta">
      <span id="readout-section">剑身</span>
      <span id="readout-position">列 1 / 5 · 档 1 / 8</span>
    </div>
  </section>

  <footer class="system-footer">
    <span><i class="status-dot"></i> <span id="load-state">载入中</span></span>
    <span class="footer-right">
      <span class="hint"><kbd>←</kbd><kbd>→</kbd> 转环 <kbd>↑</kbd><kbd>↓</kbd> 跳卷 <kbd>ENTER</kbd> 读取</span>
      <span class="pwa-notice" id="pwa-notice" hidden>
        新版本已就绪 <button data-panel="reload">更新并重启</button>
      </span>
      <button id="open-settings" class="footer-button">设置</button>
    </span>
  </footer>
`;

// 释文卡：右侧滑入，遮蔽条与剑身拭纹共用同一个进度值
const reading = document.createElement("aside");
reading.id = "reading";
reading.className = "reading";
reading.dataset.open = "false";
reading.setAttribute("aria-hidden", "true");
reading.innerHTML = `
  <div class="reading-head">
    <span id="reading-id">八-001</span>
    <span id="reading-section">剑身</span>
  </div>
  <h2 class="reading-title" id="reading-title">—</h2>
  <div class="reading-rule"></div>
  <div class="reading-tabs" role="tablist">
    <button data-tab="text" class="active" role="tab" aria-selected="true">01 释文</button>
    <button data-tab="notes" role="tab" aria-selected="false">02 考据</button>
    <button data-tab="log" role="tab" aria-selected="false">03 阅录</button>
  </div>
  <div class="reading-panel" id="reading-panel"></div>
  <div class="reading-actions">
    <button id="open-viewer" class="solid-button">360° 查看器 <span>↔</span></button>
    <div class="reading-subactions">
      <button id="toggle-save">收藏</button>
      <button id="export-entry">导出 TXT</button>
      <button id="open-search">检索 <kbd>/</kbd></button>
    </div>
  </div>
  <div class="reading-veil" aria-hidden="true"></div>
`;
stage.appendChild(reading);

// 查看器控制条
const viewerUi = document.createElement("div");
viewerUi.id = "viewer-ui";
viewerUi.className = "viewer-ui";
viewerUi.dataset.open = "false";
viewerUi.innerHTML = `
  <div class="viewer-hint">拖动旋转 <span>·</span> 滚轮缩放 <span>·</span> 方向键平移 <span>·</span> <kbd>ESC</kbd> 退出</div>
  <div class="viewer-actions">
    <button data-viewer="explode">拆解六组</button>
    <button data-viewer="treat">尘封</button>
    <button data-viewer="reset">复位</button>
  </div>
`;
stage.appendChild(viewerUi);

const scene = new ArchiveScene(canvas);
canvas.style.touchAction = "none";

const audio = new TerminalAudio();
let audioUnlockRequested = false;
/** 浏览器要求用户手势后才能出声；未解锁前的请求直接丢弃，不补播 */
function unlockAudio() {
  if (audioUnlockRequested) return;
  audioUnlockRequested = true;
  void audio.unlock();
}
window.addEventListener("pointerdown", unlockAudio, { once: true });
window.addEventListener("keydown", unlockAudio, { once: true });

function fit() {
  const coarse = matchMedia("(pointer: coarse)").matches;
  const { width, height, scale, kind } = stageLayout(
    viewport.clientWidth,
    viewport.clientHeight,
    coarse,
  );
  stage.style.width = `${width}px`;
  stage.style.height = `${height}px`;
  stage.style.transform = `translate(-50%, -50%) scale(${scale})`;
  stage.dataset.layout = kind;
  stage.dataset.touch = String(coarse);

  // 尺寸去重放在场景内部，这里无条件同步
  scene.setSize(viewport.clientWidth, viewport.clientHeight, devicePixelRatio);
}

window.addEventListener("resize", fit);
window.visualViewport?.addEventListener("resize", fit);
matchMedia("(pointer: coarse)").addEventListener("change", fit);
fit();
// 画质档位变化后立即以新尺寸重绘
scene.pendingResize = fit;
scene.setQuality(readQualitySettings());

// ---------------------------------------------------------------- 开场
// 开场层盖住三维画布，直到阵列入场才移除，避免提前露出后面的阵列。
const bootParams = new URLSearchParams(location.search);
let boot: BootSequence | undefined;
let booting = false;

// 带调试参数时自动跳过开场，免得每次核对功能都要等六秒。
// 注意不含 bootat：它就是用来逐段核对开场的，跳过开场会自相矛盾。
const debugEntry = ["focus", "detail", "viewer", "reveal", "explode"].some((key) =>
  bootParams.has(key),
);
if (
  !debugEntry &&
  bootParams.get("skipboot") !== "1" &&
  !matchMedia("(prefers-reduced-motion: reduce)").matches
) {
  boot = new BootSequence(viewport);
  booting = true;
  const startedAt = performance.now();

  // 调试钩子：?bootat=2.6 定格在指定时刻，便于逐段核对开场
  const bootAt = bootParams.get("bootat");
  if (bootAt !== null) {
    const frozen = Number(bootAt);
    if (Number.isFinite(frozen)) boot.update(frozen);
  } else {
    const tick = (ms: number) => {
      if (!boot) return;
      if (boot.isRemoved) {
        booting = false;
        boot = undefined;
        return;
      }
      const { done } = boot.update((ms - startedAt) / 1000);
      if (done) {
        booting = false;
        boot = undefined;
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    viewport.addEventListener("pointerdown", () => boot?.skip(), { once: true });
  }
}

const loadState = $("#load-state");
const readoutColumn = $("#readout-column");
const readoutId = $("#readout-id");
const readoutTitle = $("#readout-title");
const readoutSection = $("#readout-section");
const readoutPosition = $("#readout-position");
const ruleFill = $("#callout-rule-fill");
const readingPanel = $("#reading-panel");

const diagnostics: string[] = [];

/** 失败时用大字号面板把堆栈打到页面上，避免只能靠控制台猜。 */
function reportFailure(stageName: string, error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  const frames =
    error instanceof Error
      ? (error.stack ?? "").split("\n").slice(1, 5).map((line) => line.trim()).join("\n")
      : "";
  diagnostics.push(`${stageName}: ${detail}`);
  loadState.textContent = `${stageName}：${detail}`;
  const panel = document.createElement("pre");
  panel.style.cssText =
    "position:fixed;inset:0;margin:0;padding:44px;background:#efe9dc;color:#1c1a17;" +
    "font:13px/1.7 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap;z-index:9999;overflow:auto";
  panel.textContent = [
    `阶段：${stageName}`,
    `错误：${detail}`,
    "",
    "堆栈：",
    frames,
    "",
    "诊断记录：",
    ...diagnostics,
  ].join("\n");
  document.body.appendChild(panel);
}

// ---------------------------------------------------------------- 释文卡
let activeTab: "text" | "notes" | "log" = "text";
const accessLog: { id: string; time: string }[] = [];

function renderReading() {
  const index = scene.array.selectedIndex;
  const entry = entries[index];
  if (!entry) return;

  $("#reading-id").textContent = entry.id;
  $("#reading-section").textContent = entry.section;
  $("#reading-title").textContent = entry.title;

  if (activeTab === "text") {
    readingPanel.innerHTML = `
      <dl class="reading-meta">
        <div><dt>卷别</dt><dd>${entry.category}</dd></div>
        <div><dt>年代</dt><dd>${entry.date}</dd></div>
        <div><dt>状态</dt><dd>${entry.status}</dd></div>
      </dl>
      <p class="reading-body">${entry.abstract}</p>
    `;
  } else if (activeTab === "notes") {
    readingPanel.innerHTML = `
      <ol class="reading-notes">
        ${entry.findings
          .filter(Boolean)
          .map((note, i) => `<li><span>${String(i + 1).padStart(2, "0")}</span>${note}</li>`)
          .join("")}
      </ol>
    `;
  } else {
    const rows = accessLog.filter((row) => row.id === entry.id).slice(0, 6);
    readingPanel.innerHTML = rows.length
      ? `<div class="reading-log">${rows
          .map((row) => `<div><span>${row.time}</span><b>已读取</b></div>`)
          .join("")}</div>`
      : `<p class="reading-empty">本次会话尚未读取此条。</p>`;
  }

  syncSaveButton();
}

function syncSaveButton() {
  const button = document.getElementById("toggle-save");
  if (!button) return;
  const entry = entries[scene.array.selectedIndex];
  button.textContent = entry && saved.has(entry.id) ? "已收藏 ✓" : "收藏";
}

function setReadingOpen(open: boolean) {
  if (open) {
    const entry = entries[scene.array.selectedIndex];
    if (entry) {
      accessLog.unshift({ id: entry.id, time: new Date().toLocaleTimeString("en-GB") });
    }
    renderReading();
    audio.play("paper");
  }
  reading.dataset.open = String(open);
  reading.setAttribute("aria-hidden", String(!open));
}

// ---------------------------------------------------------------- 查看器
function setViewerOpen(open: boolean) {
  scene.setMode(open ? "viewer" : "detail");
  audio.play("paper");
  viewerUi.dataset.open = String(open);
  $("#viewer-ui").setAttribute("aria-hidden", String(!open));
  reading.style.visibility = open ? "hidden" : "visible";
}

function syncViewerButtons() {
  const explodeButton = viewerUi.querySelector('[data-viewer="explode"]');
  const treatButton = viewerUi.querySelector('[data-viewer="treat"]');
  if (explodeButton) explodeButton.textContent = scene.explodeIsOpen ? "合拢六组" : "拆解六组";
  if (treatButton) treatButton.textContent = scene.reveal > 0.5 ? "尘封" : "拭净";
}

// ---------------------------------------------------------------- 读数
function updateReadout() {
  const index = scene.array.selectedIndex;
  const entry = entries[index];
  if (!entry) return;
  readoutColumn.textContent = entry.category;
  readoutId.textContent = entry.id;
  readoutTitle.textContent = entry.title;
  readoutSection.textContent = entry.section;
  // 环形布局没有"列 / 档"这组方位，改为在全部条目中的位置
  readoutPosition.textContent =
    `第 ${index + 1} / ${entries.length} 件 · 共 ${columns.length} 卷`;
  ruleFill.style.transform = "scaleX(1)";
  // 调试读数不再写到页脚：它只留在 window.__scene.debugInfo 上供验收读取
}

scene
  .load()
  .then(() => {
    scene.start();
    // 正文遮蔽条与剑身拭纹共用同一个进度值
    scene.onRevealChange = (value: number) => {
      reading.style.setProperty("--reveal", value.toFixed(3));
      // 拭纹扫掠：中段最响，两端收干净
      audio.setSilk(value > 0.02 && value < 0.985, Math.sin(value * Math.PI));
    };
    updateReadout();

    const params = new URLSearchParams(location.search);
    const revealParam = params.get("reveal");
    if (revealParam !== null) {
      const value = Number(revealParam);
      if (Number.isFinite(value)) scene.setReveal(value);
    }
    // 拔出比例：默认黄金比例 0.618，可用 ?ratio=0.35 直接对比其它取值
    const ratioParam = params.get("ratio");
    if (ratioParam !== null) {
      const value = Number(ratioParam);
      if (Number.isFinite(value) && value > 0.05 && value < 1) setDrawRatio(value);
    }
    if (params.get("explode") === "1") scene.setExplodeTarget(1);
    if (params.get("focus") === "1") {
      scene.setMode("focus");
      setReadingOpen(true);
    }
    if (params.get("detail") === "1") {
      scene.setMode("detail");
      setReadingOpen(true);
    }
    if (params.get("viewer") === "1") {
      scene.setMode("viewer");
      setReadingOpen(true);
      setViewerOpen(true);
    }
    // 无头环境帧率极低，验证时用 fast=1 加速收敛
    if (params.get("fast") === "1") scene.setTimeScale(9);
    // 载入走完后页脚只留一句状态，不再刷调试读数
    loadState.textContent = "档案就绪";
    document.body.dataset.ready = "true";
    Object.assign(window as unknown as Record<string, unknown>, { __scene: scene });
  })
  .catch((error: unknown) => reportFailure("器物载入失败", error));

// 调试期持续刷新读数，便于截图核对相机与抽取进度
setInterval(() => {
  if (document.body.dataset.ready === "true") updateReadout();
}, 400);

// ---------------------------------------------------------------- 点击
document.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;

  const tab = target.closest<HTMLElement>("[data-tab]");
  if (tab?.dataset.tab) {
    activeTab = tab.dataset.tab as typeof activeTab;
    reading.querySelectorAll("[data-tab]").forEach((node) => {
      const active = node === tab;
      node.classList.toggle("active", active);
      node.setAttribute("aria-selected", String(active));
    });
    renderReading();
    return;
  }

  const viewerAction = target.closest<HTMLElement>("[data-viewer]")?.dataset.viewer;
  if (viewerAction === "explode") {
    scene.setExplodeTarget(scene.explodeIsOpen ? 0 : 1);
    audio.play("metal", 1);
    syncViewerButtons();
    return;
  }
  if (viewerAction === "treat") {
    scene.setReveal(scene.reveal > 0.5 ? 0 : 1);
    syncViewerButtons();
    return;
  }
  if (viewerAction === "reset") {
    scene.resetView();
    return;
  }

  if (target.closest("#open-viewer")) {
    setViewerOpen(true);
    syncViewerButtons();
    return;
  }

  if (target.closest('[data-action="open"]')) {
    triggerRead();
    return;
  }

  const pick = target.closest<HTMLElement>("[data-pick]")?.dataset.pick;
  if (pick !== undefined) {
    scene.array.select(Number(pick));
    scene.setMode("detail");
    setReadingOpen(true);
    updateReadout();
    closeSearch();
    return;
  }
  if (target.closest('[data-panel="close"]')) {
    closeSearch();
    closeSettings();
    return;
  }
  if (target.closest("#open-settings")) {
    openSettings();
    return;
  }
  if (target.closest('[data-panel="reload"]')) {
    window.location.reload();
    return;
  }
  const qualityPick = target.closest<HTMLElement>("[data-quality]")?.dataset.quality;
  if (qualityPick) {
    scene.setQuality(QUALITY_PRESETS[qualityPick as QualityPreset]);
    writeQualitySettings(qualityPick as QualityPreset);
    syncQualityRow();
    audio.play("jade");
    return;
  }
  if (target.closest("#open-search")) {
    openSearch();
    return;
  }
  if (target.closest("#toggle-save")) {
    toggleSave();
    return;
  }
  if (target.closest("#export-entry")) {
    exportEntry();
  }
});

document.addEventListener("input", (event) => {
  const target = event.target as HTMLInputElement;
  if (target?.id === "search-input") renderSearchResults(target.value);
});

// ---------------------------------------------------------------- 音效偏好
function readSoundPref(): boolean {
  try {
    return localStorage.getItem("kaogong-sound") !== "0";
  } catch {
    return true;
  }
}

function saveSoundPref(on: boolean) {
  try {
    localStorage.setItem("kaogong-sound", on ? "1" : "0");
  } catch {
    // 写不进去不影响本次使用
  }
}

audio.configure({ soundOn: readSoundPref() });

document.addEventListener("change", (event) => {
  const target = event.target as HTMLInputElement;
  if (target?.id !== "sound-toggle") return;
  audio.configure({ soundOn: target.checked });
  saveSoundPref(target.checked);
  if (target.checked) {
    void audio.unlock().then(() => audio.play("jade"));
  }
});

// ---------------------------------------------------------------- 键盘
document.addEventListener("keydown", (event) => {
  const key = event.key;

  // 开场期间任意键跳过
  if (booting) {
    event.preventDefault();
    boot?.skip();
    return;
  }

  if (key === "Escape") {
    event.preventDefault();
    if (scene.sceneMode === "viewer") {
      setViewerOpen(false);
      updateReadout();
      return;
    }
    if (scene.sceneMode === "detail") {
      scene.setMode("focus");
      updateReadout();
      return;
    }
    scene.setMode("array");
    setReadingOpen(false);
    updateReadout();
    return;
  }

  if (key === "Enter") {
    event.preventDefault();
    if (scene.sceneMode === "array") {
      triggerRead();
    } else if (scene.sceneMode === "focus") {
      scene.setMode("detail");
    } else if (scene.sceneMode === "viewer") {
      setViewerOpen(false);
    }
    updateReadout();
    return;
  }

  if (key === "/") {
    event.preventDefault();
    openSearch();
    return;
  }

  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(key)) return;
  event.preventDefault();

  if (scene.sceneMode === "viewer") {
    const step = 0.05;
    if (key === "ArrowLeft") scene.panBy(-step, 0);
    if (key === "ArrowRight") scene.panBy(step, 0);
    if (key === "ArrowUp") scene.panBy(0, step);
    if (key === "ArrowDown") scene.panBy(0, -step);
    return;
  }

  // 转环：环平滑转一格（9°），转到位即拔剑
  if (key === "ArrowLeft") scene.array.stepLane(-1);
  if (key === "ArrowRight") scene.array.stepLane(1);
  // 跳卷：同样保留完整转动过程（8 格 = 72°），只是剑要等环到位再拔，
  // 否则会在转动途中被"甩"出来
  const jumping = key === "ArrowUp" || key === "ArrowDown";
  if (key === "ArrowUp") scene.array.stepFile(-1);
  if (key === "ArrowDown") scene.array.stepFile(1);
  audio.play("jade");
  // 换格：已读取过才拔（跳卷等环到位，转环随即拔）
  if (jumping) scene.deferDraw();
  else scene.resumeDraw();
  scene.refocus();
  if (reading.dataset.open === "true") renderReading();
  updateReadout();
});

// ---------------------------------------------------------------- 读取流程
/**
 * 读取分两段：第一次让剑出现在鞘中（仍留在环上），再次才拔出。
 *
 * Enter 键、卡片上的"读取"按钮、在环上轻点，三条路径共用这一条，
 * 免得各自的时序走岔——此前画布只认拖动，轻点压根没有读取这条路。
 */
function triggerRead() {
  // 读取就是拔出：剑自鞘中升起，并转入聚焦取景
  scene.setMode("focus");
  setReadingOpen(true);
  audio.play("metal");
  updateReadout();
}

// ---------------------------------------------------------------- 检索 / 收藏 / 导出
function readSaved(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem("kaogong-saved") ?? "[]");
    return Array.isArray(raw) ? (raw as string[]) : [];
  } catch {
    return [];
  }
}

const saved = new Set<string>(readSaved());

function persistSaved() {
  try {
    localStorage.setItem("kaogong-saved", JSON.stringify([...saved]));
  } catch {
    // 私密模式下写入失败不影响本次使用
  }
}

const searchModal = document.createElement("div");
searchModal.id = "search-modal";
searchModal.className = "modal";
searchModal.hidden = true;
searchModal.innerHTML = `
  <div class="modal-panel" role="dialog" aria-label="档案检索">
    <div class="modal-head">
      <span>档案检索</span>
      <button data-panel="close" aria-label="关闭">关闭 ×</button>
    </div>
    <input id="search-input" type="search" autocomplete="off"
           placeholder="输入编号、题名、卷别或关键词" />
    <div class="search-results" id="search-results"></div>
  </div>
`;
stage.appendChild(searchModal);

// ---------------------------------------------------------------- 设置
const settingsModal = document.createElement("div");
settingsModal.id = "settings-modal";
settingsModal.className = "modal";
settingsModal.hidden = true;
settingsModal.innerHTML = `
  <div class="modal-panel modal-panel-narrow" role="dialog" aria-label="设置">
    <div class="modal-head">
      <span>设置</span>
      <button data-panel="close" aria-label="关闭">关闭 ×</button>
    </div>
    <div class="settings-group">
      <div class="settings-label">画质</div>
      <div class="quality-row">
        ${(Object.keys(QUALITY_PRESETS) as QualityPreset[])
          .map((key) => `<button data-quality="${key}">${QUALITY_LABELS[key]}</button>`)
          .join("")}
      </div>
      <p class="settings-note" id="quality-note"></p>
    </div>
    <div class="settings-group">
      <div class="settings-label">声音</div>
      <label class="settings-toggle">
        <input type="checkbox" id="sound-toggle" />
        <span>音效（选中、开匣、抽剑、拭纹、翻页）</span>
      </label>
      <p class="settings-note">浏览器要求先有一次点击或按键，声音才会启用。</p>
    </div>
  </div>
`;
stage.appendChild(settingsModal);

function syncQualityRow() {
  const current = scene.qualitySettings.preset;
  settingsModal.querySelectorAll<HTMLElement>("[data-quality]").forEach((button) => {
    button.classList.toggle("active", button.dataset.quality === current);
  });
  const note = document.getElementById("quality-note");
  if (note) {
    const settings = scene.qualitySettings;
    note.textContent =
      `渲染比例 ${settings.renderScale.toFixed(2)} · 像素密度上限 ${settings.dprCap.toFixed(1)}` +
      ` · 缓冲${settings.renderScale < 1 ? "低于视口" : "与视口一致"}`;
  }
}

function openSettings() {
  settingsModal.hidden = false;
  const toggle = document.getElementById("sound-toggle") as HTMLInputElement | null;
  if (toggle) toggle.checked = audio.preferences.soundOn;
  syncQualityRow();
}

function closeSettings() {
  settingsModal.hidden = true;
}

function renderSearchResults(query: string) {
  const list = document.getElementById("search-results");
  if (!list) return;
  const q = query.trim().toLowerCase();
  const hits = entries
    .map((entry, index) => ({ entry, index }))
    .filter(
      ({ entry }) =>
        !q ||
        `${entry.id} ${entry.title} ${entry.en} ${entry.category} ${entry.lead} ${entry.abstract}`
          .toLowerCase()
          .includes(q),
    )
    .slice(0, 24);

  list.innerHTML = hits.length
    ? hits
        .map(
          ({ entry, index }) => `
        <button class="search-row" data-pick="${index}">
          <span class="search-id">${entry.id}</span>
          <span class="search-name">${entry.title}</span>
          <span class="search-cat">${entry.category}</span>
          ${saved.has(entry.id) ? '<i class="search-mark">藏</i>' : ""}
        </button>`,
        )
        .join("")
    : `<p class="search-empty">没有匹配的条目。</p>`;
}

function openSearch() {
  searchModal.hidden = false;
  renderSearchResults("");
  requestAnimationFrame(() => {
    document.querySelector<HTMLInputElement>("#search-input")?.focus();
  });
}

function closeSearch() {
  searchModal.hidden = true;
}

function toggleSave() {
  const entry = entries[scene.array.selectedIndex];
  if (!entry) return;
  if (saved.has(entry.id)) saved.delete(entry.id);
  else saved.add(entry.id);
  persistSaved();
  renderReading();
}

/** 导出文本：与页面所见一致，UTF-8 纯文本 */
function buildExportText(entry: ArchiveEntry): string {
  return [
    "考工录 · 八面",
    "────────────────────────",
    `${entry.id}　${entry.title}`,
    entry.en,
    "",
    `卷别：${entry.category}`,
    `年代：${entry.date}`,
    `相关：${entry.lead}`,
    `状态：${entry.status}`,
    `部位：${entry.section}`,
    "",
    "【释文】",
    entry.abstract,
    "",
    "【考据】",
    ...entry.findings
      .filter(Boolean)
      .map((note, i) => `${String(i + 1).padStart(2, "0")}　${note}`),
    "",
    `来源：${entry.source}`,
    `导出：${new Date().toLocaleString("zh-CN")}`,
    "",
  ].join("\n");
}

function exportEntry() {
  const entry = entries[scene.array.selectedIndex];
  if (!entry) return;
  const blob = new Blob([buildExportText(entry)], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `考工录-${entry.id}-${entry.title}.txt`;
  link.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------- 指针
/** 阵列里拖过一个格距就切一档；松手后按速度继续滑行。查看器里改为旋转。 */
const DRAG_STEP_PX = 96;
const GLIDE_DIVISOR = 0.9;
const GLIDE_MAX = 3;
const ORBIT_SPEED = 0.0072;

interface DragState {
  x: number;
  y: number;
  at: number;
  accumX: number;
  accumY: number;
  vx: number;
  vy: number;
  axis: "x" | "y" | null;
  /**
   * 这次按压是否真的换过格。
   *
   * 它才是"轻点"与"拖动"的分界——不能用 axis：axis 只要单次移动超过 8 px
   * 就会被设上，而换一格要 96 px，两者差得远，拿它当门槛会把大量正常的
   * 轻点判成拖动。
   */
  stepped: boolean;
}

let drag: DragState | null = null;

canvas.addEventListener("pointerdown", (event) => {
  drag = {
    x: event.clientX,
    y: event.clientY,
    at: performance.now(),
    accumX: 0,
    accumY: 0,
    vx: 0,
    vy: 0,
    axis: null,
    stepped: false,
  };
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener("pointermove", (event) => {
  if (!drag) return;
  const now = performance.now();
  const dt = Math.max(1, now - drag.at);
  const dx = event.clientX - drag.x;
  const dy = event.clientY - drag.y;
  drag.vx = dx / dt;
  drag.vy = dy / dt;
  drag.at = now;
  drag.x = event.clientX;
  drag.y = event.clientY;

  if (scene.sceneMode === "viewer") {
    scene.orbitBy(-dx * ORBIT_SPEED, -dy * ORBIT_SPEED);
    return;
  }

  if (!drag.axis && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
    drag.axis = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
  }
  if (!drag.axis) return;

  if (drag.axis === "x") {
    drag.accumX += dx;
    while (Math.abs(drag.accumX) >= DRAG_STEP_PX) {
      const direction = drag.accumX > 0 ? -1 : 1;
      scene.array.stepLane(direction);
      drag.accumX += direction * DRAG_STEP_PX;
      drag.stepped = true;
      audio.play("jade");
      scene.resumeDraw();
      updateReadout();
    }
  } else {
    drag.accumY += dy;
    while (Math.abs(drag.accumY) >= DRAG_STEP_PX) {
      const direction = drag.accumY > 0 ? 1 : -1;
      scene.array.stepFile(direction);
      drag.accumY -= direction * DRAG_STEP_PX;
      drag.stepped = true;
      audio.play("jade");
      scene.resumeDraw();
      updateReadout();
    }
  }
});

canvas.addEventListener("pointerup", (event) => {
  if (!drag) return;
  const state = drag;
  drag = null;

  if (scene.sceneMode === "viewer") return;

  if (!state.stepped) {
    // 没跨格 = 一次点击。先拾取：点哪一根就选中哪一根。
    const hit = scene.pickCell(event.clientX, event.clientY);
    if (hit === null) return; // 点在空处：什么也不做，尤其不要退化成"读取当前选中格"
    if (hit !== scene.array.selectedIndex) {
      // 选取：换到那一根，收剑入鞘，不拔
      scene.array.select(hit);
      scene.reseat();
      audio.play("jade");
      updateReadout();
      if (reading.dataset.open === "true") renderReading();
      return;
    }
    // 读取：点的正是已选中的那一根，拔出
    triggerRead();
    return;
  }

  const speed = state.axis === "x" ? Math.abs(state.vx) : Math.abs(state.vy);
  const direction =
    state.axis === "x" ? (state.vx > 0 ? -1 : 1) : state.vy > 0 ? 1 : -1;
  const glide = Math.min(GLIDE_MAX, Math.floor(speed / GLIDE_DIVISOR));
  for (let i = 0; i < glide; i += 1) {
    if (state.axis === "x") scene.array.stepLane(direction);
    else scene.array.stepFile(direction);
  }
  if (glide > 0) {
    scene.resumeDraw();
    updateReadout();
  }
});

canvas.addEventListener("pointercancel", () => {
  drag = null;
});

canvas.addEventListener(
  "wheel",
  (event) => {
    if (scene.sceneMode !== "viewer") return;
    event.preventDefault();
    scene.zoomBy(Math.exp(event.deltaY * 0.0012));
  },
  { passive: false },
);

/** 双指捏合缩放（查看器） */
let pinchDistance = 0;
canvas.addEventListener(
  "touchmove",
  (event) => {
    if (scene.sceneMode !== "viewer" || event.touches.length !== 2) return;
    event.preventDefault();
    const [a, b] = [event.touches[0], event.touches[1]];
    const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    if (pinchDistance > 0) scene.zoomBy(pinchDistance / distance);
    pinchDistance = distance;
  },
  { passive: false },
);
canvas.addEventListener("touchend", () => {
  pinchDistance = 0;
});

// ---------------------------------------------------------------- PWA
// 只在生产构建注册：开发模式的模块是即时编译的，缓存会遮挡改动
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker
      // 用 BASE_URL 而非写死的 /sw.js：部署到子路径时 scope 才能落在同一层
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .then((registration) => {
        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          installing?.addEventListener("statechange", () => {
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              const notice = document.getElementById("pwa-notice");
              if (notice) notice.hidden = false;
            }
          });
        });
      })
      .catch(() => {
        // 注册失败不影响使用
      });
  });
}

Object.assign(window as unknown as Record<string, unknown>, {
  __audioProbe: async () => {    const result: Record<string, unknown> = {};
    for (const name of ["jade", "wood", "metal", "paper"] as const) {
      result[name] = await renderProbe(name);
    }
    return result;
  },
  __toggleViewer: () => setViewerOpen(true),
  __exportText: () => {
    const entry = entries[scene.array.selectedIndex];
    return entry ? buildExportText(entry) : "";
  },
});
