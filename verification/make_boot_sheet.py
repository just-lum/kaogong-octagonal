"""开场「剑」字书写的三阶段对照图。"""
import os

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "boot-strokes.png")

PANELS = [
    (os.path.join(HERE, "boot12-incoming.png"), "1.95 s · 同时出现", "八笔并行自各缘进入，来路已淡出"),
    (os.path.join(HERE, "boot12-full.png"), "2.60 s · 完整（字库字形）", "字库原字形：笔锋、撇捺、竖钩均为字体本身的形状"),
    (os.path.join(HERE, "boot12-back.png"), "4.05 s · 同时退回", "八笔本体同时收回，来路退回边缘"),
]

PAD = 18
TOP = 96
BOT = 62
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
for path, title, note in PANELS:
    if not os.path.exists(path):
        continue
    im = Image.open(path).convert("RGB")
    scale = 760 / im.height
    tiles.append((im.resize((int(im.width * scale), 760), Image.LANCZOS), title, note))

W = sum(t[0].width for t in tiles) + PAD * (len(tiles) + 1)
canvas = Image.new("RGB", (W, TOP + 760 + BOT), BG)
d = ImageDraw.Draw(canvas)
d.text((PAD, 20), "开场「剑」字笔画：出现与消失", font=font(38, True), fill=FG)
d.text((PAD, 66),
       "每笔分「画面外的来路」与「笔画本体」两段 · 华文楷体字形轮廓 · 按连通块逐块 mask 扫描（7 块）· 同步出入",
       font=font(20), fill=DIM)

x = PAD
for im, title, note in tiles:
    canvas.paste(im, (x, TOP))
    d.text((x, TOP + 760 + 8), title, font=font(24, True), fill=FG)
    d.text((x, TOP + 760 + 36), note, font=font(18), fill=DIM)
    x += im.width + PAD

canvas.save(OUT, "PNG")
print("SHEET", OUT, canvas.size)
