"""把参考图 view0 与本轮渲染并排，验证形制比例是否对齐。"""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
REF = os.path.join(HERE, "reference", "crops", "v0.png")
MINE = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "checks", "v012-front.png")
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, "checks", "v012-vs-reference.png")

H = 1400
PAD = 26


def font(size, bold=False):
    for c in (r"C:\Windows\Fonts\msyhbd.ttc" if bold else r"C:\Windows\Fonts\msyh.ttc",
              r"C:\Windows\Fonts\msyh.ttc", r"C:\Windows\Fonts\arial.ttf"):
        if os.path.exists(c):
            try:
                return ImageFont.truetype(c, size)
            except Exception:
                continue
    return ImageFont.load_default()


def load(p):
    im = Image.open(p).convert("RGB")
    return im.resize((int(im.width * H / im.height), H), Image.LANCZOS)


a = load(REF)
b = load(MINE)

# 叠加参考轮廓，直观看出比例差
a_line = a.copy()
px = a_line.load()
for y in range(H):
    row = [x for x in range(a_line.width) if sum(px[x, y]) > 130]
    if row:
        for x in (row[0], row[-1]):
            px[x, y] = (255, 80, 80)

W = a.width + b.width + PAD * 3
canvas = Image.new("RGB", (W, H + 96 + PAD), (22, 24, 28))
d = ImageDraw.Draw(canvas)
f_t = font(34, True)
f_s = font(20)

d.text((PAD, 22), "参考图 view0（正面，红点为提取的轮廓）", font=f_s, fill=(228, 232, 238))
d.text((PAD + a.width + PAD, 22), "本轮重建 v012（同构图同焦距）", font=f_s, fill=(228, 232, 238))
canvas.paste(a_line, (PAD, 60))
canvas.paste(b, (PAD + a.width + PAD, 60))
canvas.save(OUT, "PNG")

# 像素级比例对比
import numpy as np
ra = np.asarray(a.convert("L")).astype(np.int16)
rb = np.asarray(b.convert("L")).astype(np.int16)


def extent(arr):
    m = arr > 45
    ys = np.where(m.any(axis=1))[0]
    xs = np.where(m.any(axis=0))[0]
    if not len(ys):
        return None
    return {"h": int(ys.max() - ys.min() + 1), "w": int(xs.max() - xs.min() + 1),
            "h_over_w": round((ys.max() - ys.min() + 1) / max(xs.max() - xs.min() + 1, 1), 2)}


print("SHEET", OUT, canvas.size)
print("ref_view0_extent ", extent(ra))
print("mine_v012_extent  ", extent(rb))
