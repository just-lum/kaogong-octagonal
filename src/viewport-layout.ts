import { STAGE } from "./tokens";

export type LayoutKind = "desktop" | "square" | "portrait";

export interface StageLayout {
  /** 逻辑画布宽度（CSS 像素除以 scale） */
  width: number;
  /** 逻辑画布高度 */
  height: number;
  /** 逻辑坐标到设备无关像素的缩放系数 */
  scale: number;
  kind: LayoutKind;
  /** 粗指针（触摸设备） */
  coarse: boolean;
}

/**
 * 以 1080 逻辑高度为基准，宽度随视口比例延展。
 * 宽屏保持 16:9 的构图坐标不变，只在两侧扩展阵列；
 * 竖屏不整体缩小文字，而是交给纵向布局处理。
 */
export function stageLayout(vw: number, vh: number, coarse = false): StageLayout {
  const safeWidth = Math.max(1, vw);
  const safeHeight = Math.max(1, vh);
  const aspect = safeWidth / safeHeight;

  if (aspect < 1.05) {
    // 竖屏：改用真实 CSS 像素布局，模型在上、正文在下
    return {
      width: Math.round(safeWidth),
      height: Math.round(safeHeight),
      scale: 1,
      kind: "portrait",
      coarse,
    };
  }

  if (aspect < 1.5) {
    // 方屏与窄横屏：按宽度塞满，高度可溢出（内容纵向堆叠）
    const height = Math.round(safeWidth / 1.5);
    return {
      width: Math.round(safeWidth),
      height,
      scale: 1,
      kind: "square",
      coarse,
    };
  }

  const scale = safeHeight / STAGE.baseHeight;
  return {
    width: Math.round(safeWidth / scale),
    height: STAGE.baseHeight,
    scale,
    kind: "desktop",
    coarse,
  };
}
