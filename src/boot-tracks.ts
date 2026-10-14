/**
 * 开场时间轴（秒）。所有区间都是绝对时间，由 phaseProgress 归一化到 0–1。
 * 与 boot.ts 的渲染分离：改节奏只动这里，改画面只动那里。
 */
export const BOOT = {
  total: 6.0,
  /** 墨滴自上方坠落 */
  inkDrop: [0.3, 0.9],
  /** 墨渍洇开、收干 */
  inkSpread: [0.7, 1.6],
  /** 朱砂印落下拓入 */
  sealDrop: [4.6, 5.2],
  /** 印色晕染扩散 */
  sealBloom: [5.1, 5.7],
  /** 整层淡出，交棒给阵列 */
  fadeOut: [5.5, 6.0],
} as const;

export type BootPhase = keyof Omit<typeof BOOT, "total">;

/** 把绝对时间映射为某一阶段的 0–1 进度 */
export function phaseProgress(
  t: number,
  [start, end]: readonly [number, number],
): number {
  if (end <= start) return t >= end ? 1 : 0;
  return Math.min(1, Math.max(0, (t - start) / (end - start)));
}

export const easeOut = (p: number) => 1 - (1 - p) ** 3;
export const easeInOut = (p: number) =>
  p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2;

/**
 * 逐笔的书写与收回时序。**八笔完全同步**——一起出现、一起消失，不按笔顺错开。
 *
 * 每笔走四段：
 *   lead 生长（画面边缘 → 起笔处） → body 生长（起笔 → 收笔），lead 同时淡出
 *   ……完整字停留……
 *   body 收回（收笔 → 起笔） → lead 退回（起笔 → 画面边缘），lead 重新淡入
 *
 * 因为要同步，每笔的时长必须是**同一个固定值**，不能按路径长度换算——
 * 否则长笔画先结束、短笔画后结束，又变成参差。代价是长短笔画的快慢不一致。
 *
 * 把"来路"与"笔画本体"分成两条元素是必须的：若让同一条路径从边缘一路画到收笔，
 * 那条来路在完整态也会一直显示，与本体交叉成一片乱线。
 */
export const STROKE_TIMING = {
  writeStart: 1.40,
  /** 来路从边缘行进到起笔处 */
  leadDur: 0.34,
  /** 本体写出 */
  bodyDur: 0.52,
  /** 本体一开始生长，来路就淡出 */
  leadFade: 0.22,
  holdUntil: 3.50,
  eraseStart: 3.50,
  /** 本体收回 */
  bodyBackDur: 0.44,
  /** 来路退回画面边缘 */
  leadBackDur: 0.32,
  /** 来路退回时的淡入时长 */
  leadBackFade: 0.12,
} as const;

export interface StrokeState {
  /** 来路的显示比例 0–1 */
  lead: number;
  /** 来路的透明度 */
  leadOpacity: number;
  /** 笔画本体的显示比例 0–1 */
  body: number;
}

const ZERO: StrokeState = { lead: 0, leadOpacity: 0, body: 0 };

/** 任意一条笔画在时刻 t 的状态（八笔共用同一时序）。 */
export function strokeState(t: number): StrokeState {
  const T = STROKE_TIMING;
  const t0 = T.writeStart;
  if (t <= t0) return ZERO;

  const b0 = t0 + T.leadDur;
  const b1 = b0 + T.bodyDur;

  // 收回：本体先退，来路再退
  if (t >= T.holdUntil) {
    const back = t - T.holdUntil;
    if (back < T.bodyBackDur) {
      return { lead: 0, leadOpacity: 0, body: 1 - easeInOut(back / T.bodyBackDur) };
    }
    const lt = back - T.bodyBackDur;
    if (lt < T.leadBackDur) {
      return {
        lead: 1 - easeInOut(lt / T.leadBackDur),
        leadOpacity: Math.min(1, lt / T.leadBackFade),
        body: 0,
      };
    }
    return ZERO;
  }

  // 来路行进到起笔处
  if (t < b0) {
    return { lead: easeOut((t - t0) / T.leadDur), leadOpacity: 1, body: 0 };
  }

  // 本体生长，来路同步淡出
  const body = t < b1 ? easeOut((t - b0) / T.bodyDur) : 1;
  return { lead: 1, leadOpacity: Math.max(0, 1 - (t - b0) / T.leadFade), body };
}

/**
 * 「剑」字的笔画。每条分 `lead`（来自画面外的来路）与 `body`（笔画本体）两段，
 * 首尾在起笔点相接。字面 x 764–1150、y 322–704。
 *
 * 坐标取**笔画的中线**，不是墨迹块的外缘——照填充字的块边界去量会把笔画宽度也算进去，
 * 骨架会被撑得又瘦又散，反而更不像字（这一版试过，退回来了）。
 *
 * `shape` 是**带笔锋的填充笔形**（闭合轮廓），不再是等宽中线：起笔顿、收笔出锋。
 * 之所以要手画而不能取字库轮廓——宋体、楷体、黑体的「剑」都只有 7 个连通块
 * （「人」字头撇捺共用根部、底横与右撇相交），拆不出九条独立笔画。
 *
 * `axis` 是出现方向的渐变轴，从起笔处指向收笔处；`lead` 是画面外的来路，仍用描边。
 *
 * 四处按字库逐块量过、容易做错的：
 *
 * 1. **「佥」下身是三笔**（左短点、中心点、右长撇），不是两笔。少一笔字就读不周全。
 * 2. **捺短于撇**：撇的跨度大于捺。
 * 3. **顶横偏短**：只占字宽约三成，画满到左部全宽会失去「佥」的收束感。
 * 4. **「刂」左竖短、右竖钩贯穿全字并出钩**，两者长度关系不能反。
 */
export const GLYPH_BLOCKS = [
  {
    key: "b0",
    shape:
      "M 913.2 374.6 L 970.3 388.1 L 1001.3 416.8 L 1001.3 437.0 L 992.8 437.0 L 989.2 437.0 L 980.2 432.1 L 924.4 391.2 L 910.5 379.1 L 879.9 431.2 L 822.0 499.1 L 775.2 532.8 L 766.7 532.8 L 764.0 532.8 L 764.0 527.4 L 770.3 522.0 L 810.7 486.5 L 888.5 374.6 L 888.5 347.2 L 888.5 343.1 L 885.3 335.9 L 885.3 326.5 L 899.3 326.5 L 928.9 342.7 L 928.9 352.1 L 920.8 362.4 L 913.2 374.6 Z",
    axis: [764.0, 429.6, 1001.3, 429.6],
    lead: "M -40 429.6 L 764.0 429.6",
    leadWeight: 12,
  },
  {
    key: "b1",
    shape:
      "M 1126.7 345.8 L 1126.7 349.0 L 1118.6 362.4 L 1115.0 403.8 L 1115.0 540.4 L 1118.6 633.9 L 1118.6 635.2 L 1118.6 658.2 L 1098.4 704.0 L 1089.8 704.0 L 1084.4 704.0 L 1079.0 692.8 L 1065.6 664.5 L 1049.4 646.0 L 1046.2 642.4 L 1046.2 637.9 L 1052.5 637.9 L 1073.2 645.1 L 1086.2 645.1 L 1090.3 634.3 L 1093.9 553.9 L 1093.9 461.8 L 1090.7 368.7 L 1082.2 339.5 L 1074.5 330.1 L 1074.5 326.9 L 1074.5 322.0 L 1089.8 322.0 L 1126.7 338.6 L 1126.7 345.8 Z",
    axis: [1086.5, 322.0, 1086.5, 704.0],
    lead: "M 1086.5 -40 L 1086.5 322.0",
    leadWeight: 12,
  },
  {
    key: "b2",
    shape:
      "M 1051.2 436.6 L 1051.2 441.1 L 1045.3 457.3 L 1045.3 488.7 L 1046.2 536.4 L 1046.2 587.2 L 1033.6 587.2 L 1029.2 587.2 L 1019.7 570.5 L 1019.7 555.2 L 1025.1 527.4 L 1025.1 502.7 L 1025.1 454.6 L 1018.4 431.2 L 1016.6 425.4 L 1016.6 418.2 L 1025.6 418.2 L 1051.2 427.6 L 1051.2 436.6 Z",
    axis: [1033.9, 418.2, 1033.9, 587.2],
    lead: "M 1033.9 -40 L 1033.9 418.2",
    leadWeight: 12,
  },
  {
    key: "b3",
    shape:
      "M 948.3 446.9 L 965.8 446.9 L 965.8 463.6 L 911.4 478.8 L 881.3 478.8 L 860.6 473.9 L 860.6 470.8 L 860.6 467.6 L 883.1 463.1 L 934.3 446.9 L 948.3 446.9 Z",
    axis: [860.6, 462.9, 965.8, 462.9],
    lead: "M -40 462.9 L 860.6 462.9",
    leadWeight: 12,
  },
  {
    key: "b4",
    shape:
      "M 942.9 598.4 L 981.5 591.2 L 997.2 591.2 L 997.2 594.8 L 997.2 601.1 L 965.3 608.7 L 842.2 638.4 L 835.5 643.3 L 829.6 647.4 L 819.3 647.4 L 798.2 623.1 L 798.2 612.3 L 809.8 612.3 L 819.3 615.0 L 822.9 615.0 L 845.8 615.0 L 930.3 600.6 L 952.3 538.6 L 952.3 509.0 L 952.3 504.0 L 951.0 494.6 L 951.0 491.0 L 951.0 483.8 L 959.5 483.8 L 986.5 500.0 L 986.5 507.2 L 981.5 513.0 L 975.2 519.7 L 942.9 598.4 Z",
    axis: [798.2, 565.6, 997.2, 565.6],
    lead: "M -40 565.6 L 798.2 565.6",
    leadWeight: 12,
  },
  {
    key: "b5",
    shape:
      "M 919.9 547.6 L 919.9 554.3 L 915.9 566.0 L 906.5 566.0 L 893.4 547.2 L 885.8 518.4 L 885.8 508.5 L 895.2 508.5 L 919.9 532.8 L 919.9 547.6 Z",
    axis: [902.9, 508.5, 902.9, 566.0],
    lead: "M 902.9 -40 L 902.9 508.5",
    leadWeight: 12,
  },
  {
    key: "b6",
    shape:
      "M 840.4 525.6 L 846.7 525.6 L 877.7 555.7 L 877.7 584.9 L 859.7 584.9 L 836.4 537.7 L 836.4 525.6 L 840.4 525.6 Z",
    axis: [857.0, 525.6, 857.0, 584.9],
    lead: "M 857.0 -40 L 857.0 525.6",
    leadWeight: 12,
  },
] as const;

export type GlyphBlockKey = (typeof GLYPH_BLOCKS)[number]["key"];

/** 画布基准，与 viewBox 一致 */
export const BOOT_VIEWBOX = { width: 1920, height: 1080 } as const;
