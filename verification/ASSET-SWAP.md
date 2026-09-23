# 资产替换记录 · 按参考图复刻的剑与剑鞘

替换时间：2026-09-22
替换内容：`public/assets/jian.glb`、`public/assets/sheath.glb`

## 换了什么

| 资产 | 原 | 新 | 变化 |
|---|---|---|---|
| jian.glb | 150,164 B | 1,897,952 B | 剑身宽 34→51 mm、格 56×37→83×51 mm、柄 203→136 mm、加自带鞘与贴图 |
| sheath.glb | 51,044 B | 886,480 B | 外廓 42×18→62×26 mm、鞘长 900→960 mm、四道铜装 + 佩环 + 流苏 + 木纹 |

工程源：`art/jian-v019.blend`（8 部件 / 10,232 三角面）、`art/sheath-v017-view.blend`（5 部件 / 4,418 三角面）
原件备份：`art/checks/backup-originals/`

## 验证结果

**GLB 容器**（`art/export_assets.py` 自检）：magic 头正确、声明长度与实际一致。

**Node/three 解析**（`node scripts/check-glb.mjs`）：
- jian：`has scene: true`、8 个网格名与 `JianPartName` 契约完全一致（blade/chape/grip/guard/pommel/scabbard/slide/wrap）
- sheath：5 个网格（sheath_band/body/chape/tag/throat）
- 纹理报 `Couldn't load texture blob:` 属**环境限制**——Node 无浏览器图像解码实现，非资产问题，已由浏览器截图确认

**内容侧**：`npm run check:content` 通过（40 条 / 5 卷，部位分布 剑身 14 · 剑格 3 · 缑柄 11 · 剑首 4 · 鞘身 5 · 鞘饰 3）

**构建**：`npm run build` 通过（tsc --noEmit + vite build，1.76s）

**浏览器实载**（`vite preview` + `scripts/shot.mjs` CDP 截图）：
- `?viewer=1` 查看器：完整器物渲染正常，鞘的木纹与铜装纹样可见，**贴图解码成功**
- `?fast=1` 阵列：40 格环形排布正常，鞘间距无重叠

## 需要留意的两点

**一、体积**：两个资产合计 2.78 MB（原 0.20 MB）。已把贴图分辨率按站内显示尺寸降过一档（1024²→640²、1536×768→1024×512），若首屏仍偏慢，可选：`bronze_normal` 转 JPEG（当前占 531 KB）、或只给主剑上贴图、阵列单元用纯色。

**二、面数**：鞘由约 2,036 面/单元升至 4,418 面/单元，40 格阵列合计约 177k 三角面（原约 81k）。当前桌面帧率无碍，移动端建议实测；若要压，优先减 `sheath_body` 的环分段（30 段降至 20 段）。

## 其他

`scripts/check-glb.mjs` 补了 `globalThis.self` shim——旧注释假设"模型不带贴图所以不触发 DOM 分支"，接贴图后该假设失效。

## 回滚

```powershell
# 在仓库根目录执行
Copy-Item "art/checks/backup-originals/jian.glb"   "public/assets/jian.glb"   -Force
Copy-Item "art/checks/backup-originals/sheath.glb" "public/assets/sheath.glb" -Force
npm run build
```
