/**
 * 画质分级。
 *
 * 只调渲染缓冲的尺寸与像素密度上限，不改场景内容、不改动效节奏——
 * 超级性能模式与"减少动效"是两件互不相干的事，各自独立开关。
 * canvas 的 CSS 尺寸始终铺满视口，所以降档只影响清晰度，不影响构图。
 */

export type QualityPreset = "high" | "medium" | "low" | "super";

export interface QualitySettings {
  preset: QualityPreset;
  /** 渲染缓冲相对视口的比例 */
  renderScale: number;
  /** 像素密度上限 */
  dprCap: number;
}

export const QUALITY_PRESETS: Record<QualityPreset, QualitySettings> = {
  high: { preset: "high", renderScale: 1.0, dprCap: 2.0 },
  medium: { preset: "medium", renderScale: 1.0, dprCap: 1.5 },
  low: { preset: "low", renderScale: 0.85, dprCap: 1.0 },
  super: { preset: "super", renderScale: 0.65, dprCap: 1.0 },
};

export const QUALITY_LABELS: Record<QualityPreset, string> = {
  high: "高",
  medium: "中",
  low: "低",
  super: "超级性能",
};

const STORAGE_KEY = "kaogong-quality";

export function readQualitySettings(): QualitySettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && raw in QUALITY_PRESETS) {
      return QUALITY_PRESETS[raw as QualityPreset];
    }
  } catch {
    // 私密模式下读不到就用默认
  }
  return QUALITY_PRESETS.high;
}

export function writeQualitySettings(preset: QualityPreset) {
  try {
    localStorage.setItem(STORAGE_KEY, preset);
  } catch {
    // 写不进去不影响本次使用
  }
}
