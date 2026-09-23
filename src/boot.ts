import {
  BOOT,
  GLYPH_BLOCKS,
  phaseProgress,
  strokeState,
  easeInOut,
  easeOut,
} from "./boot-tracks";

/** 可见长度低于该值（viewBox 坐标）时笔画开始淡出——避免圆头把收尾渲染成一个点 */
const FADE_TAIL = 24;

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
      const eased = easeOut(drop);
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
    if (this.inkBlur) {
      this.inkBlur.setAttribute("stdDeviation", (16 * (1 - spread) + 1.4).toFixed(2));
    }
    if (this.inkGroup) {
      // 字写出后墨渍继续淡下去：它只是"纸背透过来"的痕迹，
      // 留得太重会在字形旁边读成一个独立的墨点
      const settle = Math.min(1, Math.max(0, (t - 2.6) / 1.4));
      this.inkGroup.setAttribute(
        "opacity",
        String(drop > 0 ? (1 - spread * 0.72) * (1 - settle * 0.78) : 0),
      );
    }

    // 九笔共用同一时序：一起出现、一起消失
    const state = strokeState(t);

    // 来路：沿路径扫出，末段淡掉以免圆头凝成一个点
    this.leads.forEach((item) => {
      const visible = item.length * state.lead;
      item.el.style.strokeDashoffset = String(item.length - visible);
      const tail = Math.min(1, visible / FADE_TAIL);
      item.el.setAttribute("opacity", (state.leadOpacity * tail).toFixed(3));
    });

    // 笔形：两个 stop 同步右移，白色段从起笔处铺开；退到起笔处时整笔淡掉
    this.bodies.forEach(({ el, a, b }) => {
      const off = state.body.toFixed(4);
      a.setAttribute("offset", off);
      b.setAttribute("offset", off);
      el.setAttribute("opacity", Math.min(1, state.body / 0.08).toFixed(3));
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

    // 整层淡出
    const fade = phaseProgress(t, BOOT.fadeOut);
    this.root.style.opacity = String(1 - fade);

    if (t >= BOOT.total) {
      this.dispose();
      return { done: true };
    }
    return { done: false };
  }

  /** 跳过：短促淡出后移除，与自然播完的收尾一致 */
  skip() {
    if (this.removed) return;
    this.root.dataset.skipped = "true";
    this.skipTimer = window.setTimeout(() => this.dispose(), 280);
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
