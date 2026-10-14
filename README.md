# 考工录 · 八面

一柄八面汉剑的交互式器物档案。

**在线预览：<https://just-lum.github.io/kaogong-octagonal/>**

开场以墨迹书写「剑」字起手，转入四十格剑鞘阵列；轻点选取、再次轻点读取，剑自鞘中拔出并切聚焦取景；正文为 40 条可溯源考据，分属五卷，配检索、收藏与导出；360° 查看器可拆解重组整器。

## 技术栈

Vite + TypeScript + three.js，无 UI 框架。

## 快速开始

```sh
npm install
npm run dev            # 开发：http://127.0.0.1:5273/
npm run build          # tsc --noEmit + vite build
npm run preview        # 预览生产构建
```

## 目录

| 路径 | 内容 |
|---|---|
| `src/` | 场景、交互、开场动画、正文 |
| `content/entries.json` | 40 条考据条目 |
| `public/assets/` | 站点加载的 `jian.glb` 与 `sheath.glb` |

## 调试入口

URL 参数用于逐段核对，无需等动画走完：

| 参数 | 作用 |
|---|---|
| `?skipboot=1` | 跳过开场 |
| `?focus=1` | 抽取态 |
| `?detail=1` | 详情态 |
| `?viewer=1` | 360° 查看器 |
| `?explode=1` | 拆解 |
| `?reveal=0.5` | 指定拭纹进度 |
| `?bootat=2.6` | 开场定格到指定秒 |
| `?fast=1` | 加速收敛 |

## 字体

开场「剑」字的轮廓取自 **华文楷体（STKAITI）**，已提取为矢量路径随源码分发。

该字体随系统提供，本地使用无碍；**若要在本项目基础上再分发，建议改用可商用的开源楷体**（如霞鹜文楷 LXGW WenKai，SIL OFL 授权）。

## 许可

MIT，见 `LICENSE`。
