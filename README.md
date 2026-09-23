# 考工录 · 八面

一柄八面汉剑的交互式器物档案。

开场以墨迹书写「剑」字起手，转入四十格剑鞘阵列；轻点选取、再次轻点读取，剑自鞘中拔出并切聚焦取景；正文为 40 条可溯源考据，分属五卷，配检索、收藏与导出；360° 查看器可拆解重组整器。

## 技术栈

Vite + TypeScript + three.js，无 UI 框架。

## 快速开始

```sh
npm install
npm run dev            # 开发：http://127.0.0.1:5273/
npm run check:content  # 内容校验
npm run build          # tsc --noEmit + vite build
npm run preview        # 预览生产构建
```

## 目录

| 路径 | 内容 |
|---|---|
| `src/` | 场景、交互、开场动画、正文 |
| `content/entries.json` | 40 条考据条目 |
| `public/assets/` | 站点加载的 `jian.glb` 与 `sheath.glb` |
| `scripts/` | 内容校验、GLB 检查、CDP 截图与取数工具 |
| `art/` | 建模与贴图的生成脚本、纹理、最终 `.blend` 源 |
| `verification/` | 各轮改动的记录与结论 |

## 资产制作

模型与贴图由脚本参数化生成，Blender 为唯一来源，导出 glb 供站点加载。

```sh
# 贴图：金具的黑底金纹卷草、木纹、缠缑
python art/make_bronze_texture.py
python art/make_textures.py

# 导出 glb 并自检容器头
blender --background art/jian-v023.blend --python art/export_assets.py -- out/jian.glb

# 开场「剑」字的字形轮廓（从字库提取，产出 TS 数据）
python art/extract_glyph.py
```

> `make_textures.py` 与 `make_bronze_texture.py` 都会写 `bronze_normal.png` / `bronze_rough.png`，
> 但用的是两套不同纹样。**涉及金具贴图时，最后必须补跑一次 `make_bronze_texture.py`**，
> 否则金具会退回旧纹样。正解是把 bronze 部分从 `make_textures.py` 摘掉，尚未做。

资产与站点资产的对应关系、坐标约定、尺寸链见 `art/README.md`。

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

开场「剑」字的轮廓取自 **华文楷体（STKAITI）**，由 `art/extract_glyph.py` 提取为矢量路径。

该字体随系统提供，本地使用无碍；**若要在本项目基础上再分发，建议改用可商用的开源楷体**（如霞鹜文楷 LXGW WenKai，SIL OFL 授权）——改 `extract_glyph.py` 里的字体路径重跑即可，其余代码无需改动。

## 说明

`art/reference/` 下的参考图未纳入版本控制：它们是用于形制比对的第三方素材，版权不在本项目范围内。

## 许可

MIT，见 `LICENSE`。
