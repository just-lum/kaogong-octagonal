/** 开场用到的缓动函数。纯函数，不感知任何时间轴。 */

export const easeOut = (p: number) => 1 - (1 - p) ** 3;
export const easeInOut = (p: number) =>
  p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2;
/** 端点为 0 的三次加速，用于墨滴下落 */
export const easeInQuad = (p: number) => p * p;
export const smoothstep01 = (x: number) =>
  x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);

/**
 * 笔尖行程曲线：**起笔加速 → 中段恒速 → 收笔减速**。
 *
 * 旧版直接用 easeOut（1-(1-p)^3），它在 p=0 的导数是 3 —— 起笔瞬间就是均速的三倍，
 * 读起来是"啪"地弹出来，不是落墨。
 *
 * 这里改成速度曲线为两个 smoothstep 拼成的梯形：
 *   v(p) = ramp(p/accel) * ramp((1-p)/decel)，中段 = 1，两端平滑降到 0
 *   位置 P(p) = 归一化积分(v)
 * 峰值速度 = 1 / (1 - accel/2 - decel/2) = 1 / 0.8 = **1.25 倍均速**
 * （旧 easeOut 是 3 倍，降到 1.25 才是"提笔匀速走"的手感）。
 *
 * 两端导数为 0 还带来一个必要效果：起笔与收笔都不"撞停"，收笔处自然顿住，
 * 正好对应笔锋在收笔点的停顿。
 */
const BRUSH_ACCEL = 0.22;
const BRUSH_DECEL = 0.18;
const BRUSH_LUT_SIZE = 512;

const BRUSH_LUT: readonly number[] = (() => {
  const pos: number[] = [0];
  let acc = 0;
  let prev = 0;
  for (let i = 0; i <= BRUSH_LUT_SIZE; i++) {
    const p = i / BRUSH_LUT_SIZE;
    const v =
      smoothstep01(p / BRUSH_ACCEL) * smoothstep01((1 - p) / BRUSH_DECEL);
    if (i > 0) {
      acc += (prev + v) * 0.5;
      pos.push(acc);
    }
    prev = v;
  }
  const total = pos[BRUSH_LUT_SIZE] || 1;
  // 归一化，保证 P(1) === 1，笔迹才能刚好写完
  for (let i = 0; i < pos.length; i++) pos[i] /= total;
  return pos;
})();

/** 笔尖行程比例：输入时间进度 0–1，输出已走完的行程比例 0–1 */
export function brushEase(p: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  const x = p * BRUSH_LUT_SIZE;
  const i = Math.floor(x);
  const f = x - i;
  const a = BRUSH_LUT[i] ?? 1;
  const b = BRUSH_LUT[i + 1] ?? a;
  return a + (b - a) * f;
}
