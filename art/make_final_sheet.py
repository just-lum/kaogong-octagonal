"""生成最终交付对比图：参考图（剑 / 鞘）与重建成果并排。"""
import os

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "checks", "final-vs-reference.png")

PANELS = [
    ("reference/crops/v0.png", "参考图 · 剑 正面"),
    ("checks/v017-front.png", "重建 · 剑"),
    ("reference/crops/v3.png", "参考图 · 剑鞘 正面"),
    ("checks/sheath017b-front.png", "重建 · 剑鞘（四道铜装）"),
]

H = 1180
PAD = 26
TOP = 104
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


def load(rel):
    im = Image.open(os.path.join(HERE, rel)).convert("RGB")
    return im.resize((int(im.width * H / im.height), H), Image.LANCZOS)


tiles = [(load(p), label) for p, label in PANELS]
W = sum(t[0].width for t in tiles) + PAD * (len(tiles) + 1)
canvas = Image.new("RGB", (W, TOP + H + 56), BG)
d = ImageDraw.Draw(canvas)
d.text((PAD, 22), "考工录 · 八面 —— 按参考图复刻：剑与剑鞘", font=font(40, True), fill=FG)
d.text((PAD, 72), "剑 8 部件 / 10044 三角面 · 鞘 5 部件 / 4418 三角面 · 全件含 UV 与程序化贴图",
       font=font(22), fill=DIM)

x = PAD
for im, label in tiles:
    canvas.paste(im, (x, TOP))
    d.text((x, TOP + H + 12), label, font=font(26, True), fill=FG)
    x += im.width + PAD

canvas.save(OUT, "PNG")
print("SHEET", OUT, canvas.size)
