// 宣纸墨拓的视觉基准。颜色、时长、字体集中在此，便于整体调性一次调整。
export const ink = {
  /** 宣纸底色：偏暖的米白，用于舞台与页面背景 */
  paper: "#efe9dc",
  /** 略深的纸色，用于分层与底纹 */
  paperDeep: "#e3dbc8",
  /** 纸影，用于阴影与凹陷 */
  paperShade: "#cfc6b0",
  /** 浓墨：正文与主标题 */
  ink: "#1c1a17",
  /** 淡墨：次级信息 */
  inkSoft: "#6b6558",
  /** 极淡墨：辅助刻度与提示 */
  inkFaint: "#a49b8a",
  /** 朱砂：选中与印章 */
  cinnabar: "#a32c23",
  /** 朱砂亮部：悬停反馈 */
  cinnabarBright: "#c2453a",
  /** 黛青：极少量的冷色，用于材质与状态点 */
  dai: "#4a5a63",
} as const;

/** 动效时长（毫秒），与参考项目的节奏规范同源：快 150 / 常规 300 / 滚动 460 */
export const motion = {
  quick: 150,
  base: 300,
  slow: 460,
  surfaceIn: 300,
  surfaceOut: 200,
} as const;

/** 逻辑舞台基准：所有布局坐标以此为准 */
export const STAGE = {
  baseWidth: 1920,
  baseHeight: 1080,
} as const;
