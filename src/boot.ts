import { GLYPH_BLOCKS } from "./boot-glyph";
import { BOOT, phaseProgress, strokeState } from "./boot-timing";
import { easeInOut, easeInQuad, easeOut } from "./boot-ease";

/** 可见长度低于该值（viewBox 坐标）时笔画开始淡出——避免圆头把收尾渲染成一个点 */
const FADE_TAIL = 24;

/** 跳过时的淡出时长（毫秒）。与自然收尾走同一套逐帧写入，不用 CSS 过渡 */
const SKIP_FADE_MS = 280;

/**
 * 开场：空白宣纸 → 墨滴坠落 → 墨渍洇开 → 墨迹书写「剑」字（逐笔按书写方向写出）
 * → 完整字停留 → 笔画沿原路收回（收笔处先隐去）→ 朱砂印拓入 → 印色晕染
 * → 淡出交棒给阵列。
 *
 * 整层盖住三维画布直到阵列入场，避免开场未完成时露出后面的阵列。
 * rAF 由调用方驱动，这里只负责把绝对时间映射到画面。
 */
export class BootSequence {
  private readonly root: HTMLElement;
  private readonly leads: { el: SVGPathElement; length: number }[] = [];
  private readonly bodies: { el: SVGPathElement; a: SVGElement; b: SVGElement }[] = [];
  private inkGroup?: SVGGElement;
  private inkCircle?: SVGCircleElement;
  private inkBlur?: SVGFEGaussianBlurElement;
  private sealGroup?: SVGGElement;
  private sealBloom?: SVGCircleElement;
  private removed = false;
  private skipTimer = 0;
  /** 跳过发生的时刻（performance.now()），-1 表示未跳过 */
  private skipStartedAt = -1;

  constructor(host: HTMLElement) {
    this.root = document.createElement("section");
    this.root.id = "boot";
    this.root.className = "boot";
    this.root.setAttribute("aria-label", "开场");

    // 笔形是填充轮廓，没法用 dashoffset 扫出，改为逐笔一个 mask：
    // 渐变沿该笔的起笔→收笔方向，两个 stop 做硬边，动画移动它们的 offset。
    const strokeDefs = GLYPH_BLOCKS.map(
      ({ key, axis }) =>
        `<linearGradient id="bg-${key}" gradientUnits="userSpaceOnUse"` +
        ` x1="${axis[0]}" y1="${axis[1]}" x2="${axis[2]}" y2="${axis[3]}">` +
        `<stop data-stop="0" offset="0" stop-color="#ffffff" />` +
        `<stop data-stop="1" offset="0" stop-color="#000000" />` +
        `</linearGradient>` +
        `<mask id="bm-${key}" maskUnits="userSpaceOnUse">` +
        `<rect x="-200" y="-200" width="2320" height="1480" fill="url(#bg-${key})" />` +
        `</mask>`,
    ).join("");

    // lead 是画面外的来路，只是过渡，仍用描边；body 是带笔锋的填充笔形
    const strokes = GLYPH_BLOCKS.map(
      ({ key, shape, lead, leadWeight }) =>
        `<path data-role="lead" data-stroke="${key}" d="${lead}"` +
        ` fill="none" stroke-width="${leadWeight}" opacity="0" />` +
        `<path data-role="body" data-stroke="${key}" d="${shape}"` +
        ` stroke="none" fill="#1c1a17" mask="url(#bm-${key})" />`,
    ).join("");

    this.root.innerHTML = `
      <div class="boot-paper"></div>
      <svg class="boot-art" viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <filter id="boot-ink-bleed" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur id="boot-ink-blur" stdDeviation="16" />
          </filter>
          <radialGradient id="boot-edge-fade" cx="50%" cy="50%" r="50%">
            <stop offset="22%" stop-color="#ffffff" />
            <stop offset="55%" stop-color="#000000" />
          </radialGradient>
          <mask id="boot-strokes-clip">
            <rect width="1920" height="1080" fill="url(#boot-edge-fade)" />
          </mask>
          ${strokeDefs}
        </defs>
        <g class="boot-ink" id="boot-ink" opacity="0" filter="url(#boot-ink-bleed)">
          <circle id="boot-ink-drop" cx="970" cy="300" r="2" fill="#1c1a17" />
        </g>
        <g class="boot-outline" fill="none" stroke="#1c1a17" stroke-width="14"
           stroke-linecap="round" stroke-linejoin="round"
           mask="url(#boot-strokes-clip)">${strokes}</g>
        <g class="boot-seal" id="boot-seal" opacity="0">
          <circle id="boot-seal-bloom" cx="1560" cy="860" r="56" fill="#a32c23" opacity="0" />
          <rect x="1528" y="828" width="64" height="64" rx="4" fill="#a32c23" />
          <text x="1560" y="858" font-size="30" text-anchor="middle" fill="#efe9dc">考</text>
          <text x="1560" y="886" font-size="30" text-anchor="middle" fill="#efe9dc">工</text>
        </g>
      </svg>
      <button class="boot-skip" type="button">跳过 <span>↗</span></button>
    `;

    host.appendChild(this.root);

    // 来路仍是描边，长度要在插入文档后测量，否则 dash 起点会错
    for (const path of this.root.querySelectorAll<SVGPathElement>(
      '.boot-outline path[data-role="lead"]',
    )) {
      const length = path.getTotalLength();
      path.style.strokeDasharray = String(length);
      path.style.strokeDashoffset = String(length);
      this.leads.push({ el: path, length });
    }
    // 笔形本体靠 mask 扫描，只需拿到它自己的两个渐变 stop
    for (const { key } of GLYPH_BLOCKS) {
      const el = this.root.querySelector<SVGPathElement>(
        `.boot-outline path[data-role="body"][data-stroke="${key}"]`,
      );
      const a = this.root.querySelector<SVGElement>(`#bg-${key} [data-stop="0"]`);
      const b = this.root.querySelector<SVGElement>(`#bg-${key} [data-stop="1"]`);
      if (el && a && b) this.bodies.push({ el, a, b });
    }

    this.inkGroup = this.root.querySelector<SVGGElement>("#boot-ink") ?? undefined;
    this.inkCircle = this.root.querySelector<SVGCircleElement>("#boot-ink-drop") ?? undefined;
    this.inkBlur =
      this.root.querySelector<SVGFEGaussianBlurElement>("#boot-ink-blur") ?? undefined;
    this.sealGroup = this.root.querySelector<SVGGElement>("#boot-seal") ?? undefined;
    this.sealBloom =
      this.root.querySelector<SVGCircleElement>("#boot-seal-bloom") ?? undefined;

    this.root.querySelector(".boot-skip")?.addEventListener("click", () => this.skip());
  }

  /** 推进到绝对时间 t（秒）。返回是否已经结束。 */
  update(t: number): { done: boolean } {
    if (this.removed) return { done: true };

    // 墨滴坠落
    const drop = phaseProgress(t, BOOT.inkDrop);
    if (this.inkGroup) {
      // 重力是加速不是减速：旧版用 easeOut，墨滴是"被拽下来"而非"落下来"
      const eased = easeInQuad(drop);
      this.inkGroup.setAttribute("opacity", drop > 0 ? "1" : "0");
      this.inkGroup.setAttribute(
        "transform",
        `translate(0 ${(1 - eased) * -220})`,
      );
    }

    // 洇开、收干：落点即「剑」字所在处，墨渍从字心扩开再收住
    const spread = phaseProgress(t, BOOT.inkSpread);
    if (this.inkCircle && this.inkGroup) {
      const radius = 3 + easeOut(drop) * 9 + easeOut(spread) * 24;
      this.inkCircle.setAttribute("r", radius.toFixed(2));
      this.inkCircle.setAttribute("cy", String(300 + easeOut(spread) * 210));
    }
    // 收干：字写完（STROKE_PLAY_END ≈ 2.92 s）时墨渍必须已经彻底消失。
    // 上一版 settle 上限只到 0.78，透明度停在 0.062 且 stdDeviation 已收窄到 1.4，
    // 结果字全部收势走完之后，画面正中留下一个边界清晰的浅灰圆盘（截图 f5 可见）。
    // 现在两件事同时发生：透明度线性归零，模糊半径反向放大把残余雾化掉——
    // 只降透明度不放大模糊，边缘仍会被读成一个"圆"。
    const settle = Math.min(1, Math.max(0, (t - 2.0) / 1.0));
    if (this.inkBlur) {
      const base = 16 * (1 - spread) + 1.4;
      this.inkBlur.setAttribute("stdDeviation", (base * (1 + settle * 9)).toFixed(2));
    }
    if (this.inkGroup) {
      this.inkGroup.setAttribute(
        "opacity",
        String(drop > 0 ? (1 - spread * 0.72) * (1 - settle) : 0),
      );
    }

    // 逐笔各自有时序：按笔顺错开起笔，长短笔时长不同（见 boot-timing 的 STROKE_PLAN）
    // leads / bodies 的压入顺序与 GLYPH_BLOCKS 一致，索引即笔画索引，无需重排。

    // 来路：沿路径扫出，末段淡掉以免圆头凝成一个点
    this.leads.forEach((item, i) => {
      const state = strokeState(t, i);
      const visible = item.length * state.lead;
      item.el.style.strokeDashoffset = String(item.length - visible);
      const tail = Math.min(1, visible / FADE_TAIL);
      item.el.setAttribute("opacity", (state.leadOpacity * tail).toFixed(3));
    });

    // 笔形：两个 stop 同步右移，白色段从起笔处铺开；退到起笔处时整笔淡掉
    this.bodies.forEach(({ el, a, b }, i) => {
      const state = strokeState(t, i);
      const off = state.body.toFixed(4);
      a.setAttribute("offset", off);
      b.setAttribute("offset", off);
      el.setAttribute("opacity", Math.min(1, state.body / 0.06).toFixed(3));
    });

    // 朱砂印落下
    const seal = phaseProgress(t, BOOT.sealDrop);
    if (this.sealGroup) {
      const eased = easeInOut(seal);
      this.sealGroup.setAttribute(
        "transform",
        `translate(${(1 - eased) * 120} ${(1 - eased) * -180}) rotate(${(1 - eased) * 14})`,
      );
      this.sealGroup.setAttribute("opacity", String(Math.min(1, seal * 2.2)));
    }

    // 印色晕染：圆形扩散，比方形放大更像洇开的印泥；浓度中间最重、两端为零
    const bloom = phaseProgress(t, BOOT.sealBloom);
    if (this.sealBloom) {
      this.sealBloom.setAttribute("transform", `scale(${(1 + bloom * 5.5).toFixed(2)})`);
      this.sealBloom.setAttribute("opacity", (0.3 * Math.sin(bloom * Math.PI)).toFixed(3));
    }

    // 整层淡出：自然收尾与跳过都走这里，取两者中进度更靠后的那个
    const fade = Math.max(phaseProgress(t, BOOT.fadeOut), this.skipFade());
    this.root.style.opacity = String(1 - fade);

    if (t >= BOOT.total) {
      this.dispose();
      return { done: true };
    }
    return { done: false };
  }

  /** 跳过的淡出进度 0–1；未跳过恒为 0 */
  private skipFade(): number {
    if (this.skipStartedAt < 0) return 0;
    return Math.min(1, (performance.now() - this.skipStartedAt) / SKIP_FADE_MS);
  }

  /** 跳过：短促淡出后移除，与自然播完的收尾一致 */
  skip() {
    if (this.removed || this.skipStartedAt >= 0) return;
    this.skipStartedAt = performance.now();
    this.root.dataset.skipped = "true";
    // 淡出由 update() 逐帧写入；这里只负责到时移除，多留 1 帧给最后一次写入落地
    this.skipTimer = window.setTimeout(() => this.dispose(), SKIP_FADE_MS + 40);
  }

  get isRemoved() {
    return this.removed;
  }

  dispose() {
    if (this.removed) return;
    this.removed = true;
    window.clearTimeout(this.skipTimer);
    this.root.remove();
  }
}
