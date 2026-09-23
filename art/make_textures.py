"""阶段 3：程序化生成装具与鞘身贴图（numpy → PNG，不经过 Cycles 烘焙）。

产出到 art/textures/：
  bronze_normal.png  卷云纹浮雕法线（切线空间，OpenGL 约定）
  bronze_rough.png   铜器粗糙度（沿纹样凹凸）
  wood_base.png      红木底色（纵向木纹）
  wood_normal.png    木纹凹凸法线
  wrap_base.png      缠缑织物底色

云纹做法：参数化螺旋 + 弧线 → 曲线点集 → 距离场 → 高度图 → 梯度 → 法线。
纹样为参考图特写的同类卷云纹近似，非 1:1 复原。
"""
import os

import numpy as np
from PIL import Image
from scipy.spatial import cKDTree

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "textures")
os.makedirs(OUT, exist_ok=True)


# ---------------------------------------------------------------- 云纹：曲线 → 高度图
def spiral(cx, cy, r0, r1, turns, n=560, phase=0.0):
    t = np.linspace(0.0, 1.0, n)
    r = r0 + (r1 - r0) * t
    th = phase + turns * 2.0 * np.pi * t
    return np.stack([cx + r * np.cos(th), cy + r * np.sin(th)], axis=1)


def arc(cx, cy, r, a0, a1, n=220):
    a = np.linspace(a0, a1, n)
    return np.stack([cx + r * np.cos(a), cy + r * np.sin(a)], axis=1)


def band(x0, y0, x1, y1, n=220):
    return np.stack([np.linspace(x0, x1, n), np.linspace(y0, y1, n)], axis=1)


def cloud_curve_set():
    """密铺的卷云纹：N×N 云头 + 行间连波 + 上下缘线。

    初版是「单个居中大云头」，但装具的 UV 沿截面周长环绕 2 圈以上，
    大部分区域会落在图案空白处，导致表面只有局部有纹。
    改为密铺后任何 UV 映射下表面都满布纹样。
    """
    segs = []
    N = 4
    for row in range(N):
        for col in range(N):
            cx = (col + 0.5) / N
            cy = (row + 0.5) / N
            to = 1.0 / N
            segs.append(spiral(cx, cy, to * 0.10, to * 0.33, 1.55,
                               phase=(row * 0.7 + col * 0.35)))
            segs.append(arc(cx, cy, to * 0.43, -1.05, 1.05))
            segs.append(spiral(cx, cy, to * 0.10, to * 0.33, 1.55,
                               phase=(row * 0.7 + col * 0.35) + np.pi))
        y = (row + 0.015) / N
        segs.append(band(0.015, y, 0.985, y))
    # 每个单元行加一条贯穿的波浪线，使离散云头连成纹带（参考图为连续卷云）
    for row in range(N):
        y0 = (row + 0.5) / N
        xs = np.linspace(0.0, 1.0, 600)
        ys = y0 + (0.090 / N) * np.sin(xs * N * 2.0 * np.pi)
        segs.append(np.stack([xs, ys], axis=1))
    segs.append(band(0.02, 0.965, 0.98, 0.965))
    return np.concatenate(segs, axis=0)


def height_from_curves(pts_uv, size, width_px, bulge=1.0):
    pts = pts_uv * size
    tree = cKDTree(pts)
    gy, gx = np.mgrid[0:size, 0:size]
    grid = np.stack([gx.ravel(), gy.ravel()], axis=1).astype(np.float64)
    dist, _ = tree.query(grid, k=1, workers=-1)
    d = dist.reshape(size, size)
    h = np.clip(1.0 - d / width_px, 0.0, 1.0)
    return (h ** 1.35) * bulge


def normal_from_height(h, strength=3.2):
    gy, gx = np.gradient(h)
    nx = -gx * strength
    ny = gy * strength
    nz = np.ones_like(h)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    nx, ny, nz = nx / ln, ny / ln, nz / ln
    img = np.stack([(nx * 0.5 + 0.5), (ny * 0.5 + 0.5), (nz * 0.5 + 0.5)], axis=-1)
    return (np.clip(img, 0.0, 1.0) * 255.0).astype(np.uint8)


def save(arr, name):
    p = os.path.join(OUT, name)
    Image.fromarray(arr).save(p)
    print("  %-22s %s  %s" % (name, arr.shape, os.path.getsize(p)))
    return p


# ---------------------------------------------------------------- 1. 云纹（铜装）
# 分辨率按站内实际显示尺寸定：阵列每格鞘仅数十像素，1024² 属浪费
S = 640
CURVES = cloud_curve_set()
h_cloud = height_from_curves(CURVES, S, width_px=S * 0.016, bulge=1.0)
# 叠加细微铸造麻点
rng = np.random.default_rng(20260922)
grain = rng.normal(0.0, 1.0, (S, S))
from scipy.ndimage import gaussian_filter
grain = gaussian_filter(grain, 1.2)
h_cloud = np.clip(h_cloud + grain * 0.035, 0.0, None)

save(normal_from_height(h_cloud, strength=3.4), "bronze_normal.png")

# 粗糙度：凸起处略抛亮（粗糙度低），凹陷处积垢（粗糙度高）
r = 0.62 - 0.30 * np.clip(h_cloud, 0, 1) / max(h_cloud.max(), 1e-6)
r = gaussian_filter(r, 1.0)
rough = np.clip(r, 0.18, 0.95)
save((rough * 255).astype(np.uint8), "bronze_rough.png")


# ---------------------------------------------------------------- 2. 木纹（鞘身）
def wood_maps(w=512, h=1024):
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64)
    u = xx / w
    v = yy / h
    # 沿长度方向拉长的年轮场：横向频率高、纵向频率低
    warp = gaussian_filter(rng.normal(0, 1, (h, w)), (26, 3)) * 3.2
    field = u * 28.0 + warp
    rings = np.sin(field * np.pi)
    # 细纹
    fine = gaussian_filter(rng.normal(0, 1, (h, w)), (16, 1.2)) * 0.55
    tone = np.clip(0.5 + 0.5 * rings, 0, 1) * 0.94 + fine * 0.10 + 0.02
    tone = np.clip(gaussian_filter(tone, (1.6, 0.6)), 0, 1)
    # 红棕基色：按参考图实测取样（图中鞘身约 RGB 95/65/55）反推线性值，
    # 不能用「纯红」——绿蓝分量过低会在冷调环境光下褪成灰紫
    base = np.zeros((h, w, 3))
    for i, c in enumerate((0.175, 0.060, 0.034)):
        base[:, :, i] = c * (0.45 + 1.35 * tone)
    base = np.clip(base, 0, 1)
    # 法线：年轮形成浅凹凸
    hh = gaussian_filter(tone, (1.4, 0.5))
    return base, normal_from_height(hh, strength=1.5)


wb, wn = wood_maps()
save((wb * 255).astype(np.uint8), "wood_base.png")
save(wn, "wood_normal.png")


# ---------------------------------------------------------------- 3. 缠缑
def wrap_map(size=256):
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float64)
    fuzz = gaussian_filter(rng.normal(0, 1, (size, size)), 1.1)
    weave = 0.5 + 0.5 * np.sin(xx / size * np.pi * 2 * 26)
    t = np.clip(0.45 + 0.35 * weave + fuzz * 0.30, 0, 1)
    base = np.zeros((size, size, 3))
    for i, c in enumerate((0.030, 0.020, 0.014)):
        base[:, :, i] = c * (0.6 + 1.3 * t)
    return np.clip(base, 0, 1)


save((wrap_map() * 255).astype(np.uint8), "wrap_base.png")

print("DSH_TEX_DONE ->", OUT)
