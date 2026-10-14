import rawEntries from "../content/entries.json";

/**
 * 器物档案的数据契约。
 *
 * 唯一数据源是 content/entries.json —— 页面、检索与 TXT 导出共用它；
 * 改动内容后跑 `npm run check:content` 校验条数、编号、部位键与来源。
 * section 是模型部位键，决定抽取后的相机聚焦与拭纹解密位置。
 */

export type SectionKey = "剑身" | "剑格" | "缑柄" | "剑首" | "鞘身" | "鞘饰";

export const SECTION_KEYS: SectionKey[] = [
  "剑身",
  "剑格",
  "缑柄",
  "剑首",
  "鞘身",
  "鞘饰",
];

export type Status = "未著录" | "已著录" | "佚";

export interface ArchiveEntry {
  id: string;
  title: string;
  en: string;
  /** 模型部位键 */
  section: SectionKey;
  /** 卷别，与 columns 对应 */
  category: string;
  date: string;
  lead: string;
  status: Status;
  abstract: string;
  findings: string[];
  source: string;
}

export const columns: string[] = rawEntries.columns;

export const entries: ArchiveEntry[] = rawEntries.records as unknown as ArchiveEntry[];

/** 条目的列（卷）与行，五列 × 每列八条 */
export function laneOf(index: number): number {
  return Math.floor(index / 8) % columns.length;
}

export function rowOf(index: number): number {
  return index % 8;
}

export function indexOf(lane: number, row: number): number {
  return ((lane % columns.length) + columns.length) % columns.length * 8 + (((row % 8) + 8) % 8);
}

/** 某一列的全部条目下标，顺序固定 */
export function laneEntries(lane: number): number[] {
  const base = (((lane % columns.length) + columns.length) % columns.length) * 8;
  return Array.from({ length: 8 }, (_, i) => base + i);
}
