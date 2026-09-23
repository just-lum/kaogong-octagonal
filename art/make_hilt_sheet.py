"""生成剑柄对比图：参考图放大 vs 打磨后渲染。"""
import os

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "verification", "hilt-vs-reference.png")

PANELS = [
    (os.path.join(HERE, "archive", "checks", "ref-hilt-zoom.png"), "参考图 · 剑柄（放大 9×）"),
    (os.path.join(HERE, "archive", "checks", "v022-fitting.png"), "打磨前 v022"),
    (os.path.join(HERE, "archive", "checks", "v023-fitting.png"), "打磨后 v023"),
]

H = 900
PAD = 24
TOP = 96
BG = (24, 26, 30)
FG = (232, 236, 242)
DIM = (146, 154, 166)


def font(size, bold=False):
    for c in (r"C:\Windows\Fonts\msyhbd.ttc" if bold else r"C:\Windows\Fonts\msyh.ttc",
              r"C:\Windows\Fonts\msyh.ttc", r"C:\Windows\Fonts\arial.ttf"):
        if os.path.exists(c):
            try:
                return ImageFont.truetype(c, size)
            except Exception:
                continue
    return ImageFont.load_default()


tiles = []
for path, label in PANELS:
    if not os.path.exists(path):
        continue
    im = Image.open(path).convert("RGB")
    tiles.append((im.resize((int(im.width * H / im.height), H), Image.LANCZOS), label))

W = sum(t[0].width for t in tiles) + PAD * (len(tiles) + 1)
canvas = Image.new("RGB", (W, TOP + H + 54), BG)
d = ImageDraw.Draw(canvas)
d.text((PAD, 20), "剑柄打磨：参考图实测 vs 迭代结果", font=font(38, True), fill=FG)
d.text((PAD, 68), "剑首 42.7mm（收口 8 + 直筒 18.7 + 圆顶 16）· 柄 117.3mm · 缠缑 29 圈 / 螺距 3.8mm",
       font=font(21), fill=DIM)

x = PAD
for im, label in tiles:
    canvas.paste(im, (x, TOP))
    d.text((x, TOP + H + 10), label, font=font(24, True), fill=FG)
    x += im.width + PAD

canvas.save(OUT, "PNG")
print("SHEET", OUT, canvas.size)
