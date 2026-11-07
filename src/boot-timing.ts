/**
 * 开场时间轴与逐笔排程。改节奏只动这里；改画面去 boot.ts；改字形去 boot-glyph.ts。
 *
 * 本版按「一次落墨」重排：滴 → 洇 → 七笔依笔顺写出 → 停 → 收势 → 印。
 * 相邻阶段互相咬合，避免"画完才动下一个"的空档。
 */
import { AXIS_LENGTHS, LEAD_LENGTHS, STROKE_ORDER } from "./boot-glyph";
import { brushEase } from "./boot-ease";

export const BOOT = {
  total: 5.28,
  /** 墨滴自上方坠落（重力加速，不是减速） */
  inkDrop: [0.20, 0.64],
  /** 墨渍洇开、收干；起点略早于落定，像墨还没完全触纸就开始渗 */
  inkSpread: [0.60, 1.26],
  /** 朱砂印落下拓入 —— 压着收势尾段落下，收笔未静印已到 */
  sealDrop: [3.52, 4.10],
  /** 印色晕染扩散 */
  sealBloom: [4.02, 4.66],
  /** 整层淡出，交棒给阵列 */
  fadeOut: [4.74, 5.28],
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

export const STROKE_TIMING = {
  /** 第一笔起手 */
  writeStart: 1.02,
  // 引线不能统一时长。七条引线长 362–900 px，统一 0.22 s 会让最短那条比最长那条快 2.5 倍，
  // 同屏就是"七根针乱射"。改成按长度幂律缩放，中位长度 0.20 s。
  /** 中位长度引线的基准时长 */
  leadBaseDur: 0.20,
  /** 引线时长对长度的幂次（1 = 恒速，0 = 恒时长） */
  leadLenExp: 0.65,
  leadMinDur: 0.14,
  /** 笔身一开始生长，来路就淡出 */
  leadFade: 0.14,
  /** 中等长度笔画的笔身基准时长 */
  bodyBaseDur: 0.24,
  /** 时长对长度的幂次（1 = 恒速，0 = 恒时长） */
  bodyLenExp: 0.65,
  bodyMinDur: 0.115,
  /** 相邻两笔的重叠系数 */
  overlap: 0.52,
  /** 整字写完后的停留 */
  hold: 0.42,
  /** 收回比书写快多少（<1 = 更快收回） */
  bodyBackScale: 0.62,
  /** 收势逐笔错开的间隔，方向为**倒笔顺** */
  eraseStagger: 0.10,
} as const;

export interface StrokeState {
  /** 来路的显示比例 0–1 */
  lead: number;
  /** 来路的透明度 */
  leadOpacity: number;
  /** 笔画本体的显示比例 0–1 */
  body: number;
}

export interface StrokePlan {
  leadStart: number;
  leadDur: number;
  bodyStart: number;
  bodyDur: number;
  bodyBackDur: number;
  /** 该笔完全写完的时刻 */
  bodyEnd: number;
  /** 该笔开始收回的时刻（倒笔顺错开） */
  eraseStart: number;
}

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 1;
};
/** 以中位长度作为"基准笔"，其余按幂律缩放 */
const REF_BODY_LEN = median(AXIS_LENGTHS);
const REF_LEAD_LEN = median(LEAD_LENGTHS);

const buildPlans = (): StrokePlan[] => {
  const plans: StrokePlan[] = [];
  let cursor = STROKE_TIMING.writeStart;
  for (const idx of STROKE_ORDER) {
    const bodyLen = AXIS_LENGTHS[idx] ?? REF_BODY_LEN;
    const leadLen = LEAD_LENGTHS[idx] ?? REF_LEAD_LEN;
    const bodyDur = Math.max(
      STROKE_TIMING.bodyMinDur,
      STROKE_TIMING.bodyBaseDur * (bodyLen / REF_BODY_LEN) ** STROKE_TIMING.bodyLenExp,
    );
    const leadDur = Math.max(
      STROKE_TIMING.leadMinDur,
      STROKE_TIMING.leadBaseDur * (leadLen / REF_LEAD_LEN) ** STROKE_TIMING.leadLenExp,
    );
    const leadStart = cursor;
    const bodyStart = leadStart + leadDur;
    plans[idx] = {
      leadStart,
      leadDur,
      bodyStart,
      bodyDur,
      bodyBackDur: bodyDur * STROKE_TIMING.bodyBackScale,
      bodyEnd: bodyStart + bodyDur,
      // 占位，写完后再按倒笔顺统一赋 eraseStart
      eraseStart: Infinity,
    };
    cursor = leadStart + (leadDur + bodyDur) * STROKE_TIMING.overlap;
  }
  return plans;
};

export const STROKE_PLAN: StrokePlan[] = buildPlans();

/** 最后一笔写完的时刻 */
export const STROKE_PLAY_END = Math.max(...STROKE_PLAN.map((p) => p.bodyEnd));

/** 停留结束、开始收势的时刻 */
export const STROKE_ERASE_START = STROKE_PLAY_END + STROKE_TIMING.hold;

// 收势按倒笔顺逐笔起收：最后一笔先收，整段像"顺手抹过一遍"而不是七笔同步消失。
STROKE_ORDER.forEach((idx, order) => {
  const plan = STROKE_PLAN[idx];
  if (!plan) return;
  plan.eraseStart =
    STROKE_ERASE_START + (STROKE_ORDER.length - 1 - order) * STROKE_TIMING.eraseStagger;
});

/** 收势结束的时刻 */
export const STROKE_ERASE_END = Math.max(
  ...STROKE_PLAN.map((p) => p.eraseStart + p.bodyBackDur),
);

/**
 * 任意一笔在时刻 t 的状态。
 *
 * 书写期：来路先到 → 笔身生长、来路同步淡出。
 * 收势：**倒笔顺逐笔收回，不重播来路**。旧版收场是逐笔倒带、来路重新亮起再退回画面外，
 * 那一段本质是"倒放"，不是"收笔"—— 现在笔迹沿原路退回，来路保持不可见。
 */
export function strokeState(t: number, index: number): StrokeState {
  const plan = STROKE_PLAN[index];
  if (!plan || t <= plan.leadStart) return { lead: 0, leadOpacity: 0, body: 0 };

  if (t >= plan.eraseStart) {
    const back = t - plan.eraseStart;
    if (back >= plan.bodyBackDur) return { lead: 0, leadOpacity: 0, body: 0 };
    // 时间反演后的行程曲线：起收都慢、中段快，末段随 mask 一起归零
    return { lead: 0, leadOpacity: 0, body: brushEase(1 - back / plan.bodyBackDur) };
  }

  const lead = brushEase(Math.min(1, (t - plan.leadStart) / plan.leadDur));
  const bodyP = (t - plan.bodyStart) / plan.bodyDur;
  const body = bodyP <= 0 ? 0 : brushEase(Math.min(1, bodyP));
  const leadOpacity =
    bodyP <= 0 ? 1 : Math.max(0, 1 - (t - plan.bodyStart) / STROKE_TIMING.leadFade);

  return { lead, leadOpacity, body };
}
