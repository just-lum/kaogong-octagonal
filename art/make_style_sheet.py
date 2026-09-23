"""按参考图样式精修的成果对比图。"""
import os

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CHK = os.path.join(HERE, "archive", "checks")
REF = os.path.join(HERE, "reference", "crops-sheath")
OUT = os.path.join(ROOT, "verification", "sheath-style-vs-reference.png")

PANELS = [
    (os.path.join(REF, "detail-mid.png"), "参考图 · 中部装饰"),
    (os.path.join(CHK, "v024-band.png"), "重建 · 中部（方筒+金环+编绳+珠串+散穗）"),
    (os.path.join(REF, "fitting-mouth.png"), "参考图 · 上端金属件"),
    (os.path.join(CHK, "v024-mouth.png"), "重建 · 鞘口箍（黑底金纹方筒）"),
]

H = 760
PAD = 20
TOP = 100
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
canvas = Image.new("RGB", (W, TOP + H + 50), BG)
d = ImageDraw.Draw(canvas)
d.text((PAD, 20), "剑鞘样式精修：参考图 vs 重建", font=font(38, True), fill=FG)
d.text((PAD, 66),
       "黑底金纹方筒 · 卷草纹带 · 金环 + 编绳 + 珠串 + 散穗 · 尺寸全未改动（鞘长 962 mm / 外廓 62×26 / 内腔 55×19）",
       font=font(20), fill=DIM)

x = PAD
for im, label in tiles:
    canvas.paste(im, (x, TOP))
    d.text((x, TOP + H + 10), label, font=font(21, True), fill=FG)
    x += im.width + PAD

canvas.save(OUT, "PNG")
print("SHEET", OUT, canvas.size)
