# art/ —— 资产工程说明

这个目录里**混着三套不同时期的工作**，此前没有任何说明，容易误删。先读这一页再动手。

## 现行资产（站点实际加载的）

```
public/assets/jian.glb      1.94 MB   jian-v023 导出（09-23，剑柄打磨后）
public/assets/sheath.glb    886 KB    sheath-v017-view 导出（09-22 23:13）
```

**出处已确认**（此前列为未决事项，现补齐）：

| 资产 | 工程源 | 导出 |
|---|---|---|
| `jian.glb` | `art/jian-v023.blend` | `art/export_assets.py` |
| `sheath.glb` | `art/sheath-v017-view.blend` | 同上 |

导出命令（可复现）：

```sh
blender --background art/jian-v023.blend --python art/export_assets.py -- <out.glb>
```

导出脚本自带 GLB 容器头校验；导出后在 Node 侧用 `node scripts/check-glb.mjs <glb>` 复核网格名。

材质命名：

| 文件 | 材质 |
|---|---|
| `jian.glb` | `MAT-steel` · `MAT-wrap` · `MAT-bronze` · `sheath_bronze` · `sheath_redwood` |
| `sheath.glb` | `sheath_bronze` · `sheath_redwood` · `sheath_wood` |

**注意命名不统一**：`jian.glb` 里混着 `MAT-` 与 `sheath_` 两种前缀。前端已不再按材质名重建材质，所以暂时无碍，但导出脚本若统一前缀会更清楚。

## 三套工作的来历

| 时间 | 内容 | 说明 |
|---|---|---|
| 09-22 17:13 起 | `jian-v001`、`jian-*-check` 系列 | 早期一轮，非本工程的生成脚本产出 |
| 09-22 中间 | `jian-v002 ~ v004`、`sheath-v001 ~ v012`、`build_jian.py`、`build_sheath.py` | 本轮工程：纯 PBR 无贴图，程序化建模脚本仍在用 |
| 09-22 23:07 ~ 23:14 | `sheath-v013 ~ v017`、`jian-v006 ~ v019`、`export_assets.py`、`make_textures.py`、`make_final_sheet.py`、`compare_reference.py`、`compose_showcase.py`、`reference/`、`textures/` | 后期一轮：引入贴图与多视图校验，**现行 glb 很可能出自这一套** |

## 生成脚本

**本工程在用**：

```sh
# 建模：参数化生成，改尺寸改脚本顶部的 P 表
blender --background --python art/build_jian.py     # → jian-vNNN.blend
blender --background --python art/build_sheath.py   # → sheath-vNNN.blend
```

两个脚本都自带尺寸链自检（鞘内腔对剑身的最小余量、题签宽度是否越出鞘身），构建时会打印。

**后期一轮留下的**（未验证是否仍与本工程流程兼容，保留备查）：

- `export_assets.py` —— 导出 glb 并校验
- `make_textures.py` —— 程序化生成贴图到 `art/textures/`
- `make_final_sheet.py`、`compare_reference.py`、`compose_showcase.py` —— 生成对比图
- `build_case.py` —— **剑椟（已废弃）**

## 目录

| 路径 | 内容 |
|---|---|
| `art/*.blend` | 各版本工程源。**未清理**，归属见上表 |
| `art/archive/checks/` | 历史校验渲染图（已从 `art/checks/` 归档） |
| `art/reference/` | 参考图裁切，后期一轮使用 |
| `art/textures/` | 程序化贴图，后期一轮产出 |

## 剑柄打磨（09-23）

按参考图 `art/reference/ref-product-octagonal.png` 的逐行剖面重做了剑柄三件：

| 项 | 参考图实测 | 打磨前 | 打磨后 |
|---|---|---|---|
| 剑首高 | 42.7 mm（收口 8 + 直筒 18.7 + 圆顶 16） | 24 mm 扁鼓形 | 42.7 mm 圆顶+直筒 |
| 剑首直径 | 45.3 mm | 45 mm | 45.3 mm |
| 柄长 | 117.3 mm | 136 mm | 117.3 mm |
| 柄截面 | 正面 29–32 / 侧面投影 32 mm | 29×22 椭圆 | 29×28（接近圆） |
| 缠缑 | 圈数测不出（轮廓上不可见） | 圆管 20 圈 | 扁带 29 圈，螺距 3.8 mm |
| 格高 | 53.3 mm | 51 mm | 53.3 mm |

柄首合计 213.3 mm 与实测一致。测量数据在 `art/reference/ref-measure.json`，过程与判据见 `verification/HILT-POLISH.md`。

## 未决事项

1. **`art/*.blend` 尚未归档**——归属已在「三套工作的来历」表中标出，但移动仍有断链风险（`build_jian.py` 会生成新的 `jian-vNNN.blend`，与手工迭代的版本混在一起）。清理前建议先确认现行 glb 已登记入表。
2. **材质命名仍未统一**（见上）。`sheath_*` 与 `MAT-*` 两套前缀并存，前端已不按名重建材质，故暂不影响运行。
3. `build_jian.py` / `build_sheath.py` 与后期迭代出的 `jian-v0xx` 系列**已经分叉**：脚本是纯 PBR 无贴图的老口径，现行资产带 UV 与程序化贴图。若还要继续用脚本重建，需先决定是同步脚本还是废弃脚本、以 `art/jian-v023.blend` 为准。

## 贴图脚本（两个，注意覆盖关系）

| 脚本 | 产出 |
|---|---|
| `art/make_textures.py` | 木纹（wood_base / wood_normal）、缠缑（wrap_base），**以及 bronze_normal / bronze_rough** |
| `art/make_bronze_texture.py` | 金具专用：bronze_base（黑底金纹）、bronze_normal、bronze_rough（卷草浮雕） |

**坑**：两个脚本都会写 `bronze_normal.png` 与 `bronze_rough.png`，而且用的是**两套不同纹样**——
前者是早期的密铺云头，后者是现行的卷草黑底金纹。只跑 `make_textures.py` 会把金具贴图退回旧版本。

**规则：涉及金具贴图时，最后必须补跑一次 `make_bronze_texture.py`。**

正解是把 bronze 部分从 `make_textures.py` 里摘掉、只留一个来源；本轮没做，先记在这里。
