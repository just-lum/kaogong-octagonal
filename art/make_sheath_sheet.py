"""剑鞘独立工程的展示拼图。"""
import os

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))          # art/
ROOT = os.path.dirname(HERE)
CHK = os.path.join(HERE, "archive", "checks")
OUT = os.path.join(ROOT, "verification", "sheath-standalone-sheet.png")

PANELS = [
    (os.path.join(CHK, "final-front.png"), "正视 · 整体"),
    (os.path.join(CHK, "final-quarter.png"), "3/4 视角"),
    (os.path.join(CHK, "final-band.png"), "中部 · 带扣 / 佩环 / 流苏"),
]

H = 1150
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


tiles = []
for path, label in PANELS:
    if not os.path.exists(path):
        continue
    im = Image.open(path).convert("RGB")
    tiles.append((im.resize((int(im.width * H / im.height), H), Image.LANCZOS), label))

W = sum(t[0].width for t in tiles) + PAD * (len(tiles) + 1)
canvas = Image.new("RGB", (W, TOP + H + 92), BG)
d = ImageDraw.Draw(canvas)
d.text((PAD, 22), "剑鞘 · 成品（art/sheath-standalone.blend）", font=font(40, True), fill=FG)
d.text((PAD, 72),
       "9 部件 / 8220 三角面 · 全长 962 mm · 黑底金纹方筒 ×3 + 佩环 + 编绳 + 珠串 + 散穗",
       font=font(22), fill=DIM)

x = PAD
for im, label in tiles:
    canvas.paste(im, (x, TOP))
    d.text((x, TOP + H + 12), label, font=font(26, True), fill=FG)
    x += im.width + PAD

canvas.save(OUT, "PNG")
print("SHEET", OUT, canvas.size)
