"""按参考图样式重做金具贴图：黑底 + 金色凸纹（卷草纹）。

参考图特征（art/reference/crops-sheath/ 下已裁出）：
  - 底色是深黑褐（氧化），纹样凸起处是抛光金铜 —— 不是整体青铜色
  - 纹样是缠绕的卷草/卷云（凸起的金线），沿构件走向延伸
  - 凸起处光滑、底色粗糙

产出（覆盖 art/textures/）：
  bronze_base.png    baseColor：黑底 + 金纹
  bronze_normal.png  法线：凸线浮雕
  bronze_rough.png   粗糙度：凸起光滑 / 底色粗糙
"""
import os

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter
from scipy.spatial import cKDTree

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "textures")
os.makedirs(OUT, exist_ok=True)
S = 1024
rng = np.random.default_rng(20260923)


def spiral(cx, cy, r0, r1, turns, n=420, phase=0.0):
    t = np.linspace(0.0, 1.0, n)
    r = r0 + (r1 - r0) * t
    th = phase + turns * 2.0 * np.pi * t
    return np.stack([cx + r * np.cos(th), cy + r * np.sin(th)], axis=1)


def stem(y0, amp, cycles, phase, n=700):
    t = np.linspace(0.0, 1.0, n)
    return np.stack([t, y0 + amp * np.sin(t * 2.0 * np.pi * cycles + phase)], axis=1)


def scroll_pattern(rows=7, per_row=7):
    """卷草纹：密铺的缠绕藤蔓。

    初版 3×4 且行间留空带，UV 落进空带就是一片黑（鞘口箍渲染成全黑的原因）。
    参考图的纹样接近满铺，这里把密度提到 5×5、单元改小，消除空带。
    """
    segs = []
    for r in range(rows):
        y0 = (r + 0.5) / rows
        phase = r * 1.15
        segs.append(stem(y0, 0.030 / rows * 5.0, 2.4, phase))
        for k in range(per_row):
            cx = (k + 0.5) / per_row
            cy = y0 + 0.030 / rows * 5.0 * np.sin(cx * 2.0 * np.pi * 2.4 + phase)
            base = phase + k * 1.37
            segs.append(spiral(cx, cy, 0.008, 0.038 / rows * 5.0, 1.45, phase=base))
            segs.append(spiral(cx, cy, 0.008, 0.038 / rows * 5.0, 1.45, phase=base + np.pi))
            segs.append(spiral(cx + 0.045 / per_row, cy, 0.005, 0.020 / rows * 5.0, 1.2,
                               phase=base + 0.7))
        # 行间补一条细藤，消除空带
        if r < rows - 1:
            yb = (r + 1.0) / rows
            segs.append(stem(yb, 0.012 / rows * 5.0, 3.1, phase * 1.7))
    return np.concatenate(segs, axis=0)


def height_from_curves(pts_uv, size, line_px, ridge=1.0):
    tree = cKDTree(pts_uv * size)
    gy, gx = np.mgrid[0:size, 0:size]
    grid = np.stack([gx.ravel(), gy.ravel()], axis=1).astype(np.float64)
    dist, _ = tree.query(grid, k=1, workers=-1)
    d = dist.reshape(size, size)
    # 高截面（圆脊）的凸线，比线性 clip 更像浮雕金线
    return ridge * np.exp(-((d / line_px) ** 2))


def normal_from_height(h, strength=4.0):
    gy, gx = np.gradient(h)
    nx = -gx * strength
    ny = gy * strength
    nz = np.ones_like(h)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    img = np.stack([(nx / ln * 0.5 + 0.5), (ny / ln * 0.5 + 0.5), (nz / ln * 0.5 + 0.5)], axis=-1)
    return (np.clip(img, 0, 1) * 255).astype(np.uint8)


def save(arr, name):
    p = os.path.join(OUT, name)
    Image.fromarray(arr).save(p)
    print("  %-22s %s  %8d B" % (name, arr.shape, os.path.getsize(p)))


# ---------------------------------------------------------------- 高度场
curves = scroll_pattern()
h = height_from_curves(curves, S, line_px=S * 0.0062, ridge=1.0)
# 铸造麻点（沿底色，细）
grain = gaussian_filter(rng.normal(0, 1, (S, S)), 1.1)
h = np.clip(h + grain * 0.02 * (1.0 - np.clip(h, 0, 1)), 0, None)

save(normal_from_height(h, strength=5.6), "bronze_normal.png")

# ---------------------------------------------------------------- baseColor：黑底 + 金纹
GOLD = np.array([0.62, 0.36, 0.115])      # 抛光金铜（线性）
DARK = np.array([0.022, 0.016, 0.013])    # 氧化黑褐
t = np.clip(h, 0, 1)
t = gaussian_filter(t, 0.6)
tone = t ** 0.75
# 纹路里再掺一点深浅变化，避免每条线一样亮
var = gaussian_filter(rng.normal(0, 1, (S, S)), 26) * 0.12
tone = np.clip(tone * (1.0 + var), 0, 1)

base = DARK[None, None, :] * (1.0 - tone[:, :, None]) + GOLD[None, None, :] * tone[:, :, None]
# 金纹上叠细微划痕
scratch = gaussian_filter(rng.normal(0, 1, (S, S)), (1.0, 14.0)) * 0.05
base = np.clip(base * (1.0 + scratch[:, :, None] * tone[:, :, None]), 0, 1)
save((base * 255).astype(np.uint8), "bronze_base.png")

# ---------------------------------------------------------------- 粗糙度：凸起光滑 / 底色粗糙
rough = 0.78 - 0.44 * tone
rough = gaussian_filter(rough, 1.0)
save((np.clip(rough, 0.18, 0.92) * 255).astype(np.uint8), "bronze_rough.png")

print("DSH_TEX_BRONZE_DONE ->", OUT)
