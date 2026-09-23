"""把 v010 的三张校验渲染拼成一张展示图，便于一眼看全。"""
from PIL import Image, ImageDraw, ImageFont
import os

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "checks")
OUT = os.path.join(BASE, "v010-showcase.png")

PANELS = [
    ("v010-whole.png", "① 正视 · 整体", "全长 110.9 cm · 剑身 85.8 cm"),
    ("v010-angle.png", "② 斜侧 36°", "上脊斜面与刃面同时入画，棱线可辨"),
    ("v010-fitting.png", "③ 装具", "铜镡 / 26 圈缠缑 / 圆盘剑首"),
]

TARGET_H = 1180
PAD = 30
TOP = 118
LABEL_H = 80
BG = (26, 28, 32)
FG = (234, 238, 244)
DIM = (148, 156, 168)


def load_font(size, bold=False):
    cands = [r"C:\Windows\Fonts\msyhbd.ttc" if bold else r"C:\Windows\Fonts\msyh.ttc",
             r"C:\Windows\Fonts\msyh.ttc",
             r"C:\Windows\Fonts\simhei.ttf",
             r"C:\Windows\Fonts\arial.ttf"]
    for c in cands:
        if os.path.exists(c):
            try:
                return ImageFont.truetype(c, size)
            except Exception:
                continue
    return ImageFont.load_default()


f_title = load_font(48, True)
f_sub = load_font(26)
f_label = load_font(32, True)
f_cap = load_font(23)

imgs = []
for name, label, cap in PANELS:
    p = os.path.join(BASE, name)
    if not os.path.exists(p):
        raise SystemExit("missing: " + p)
    im = Image.open(p).convert("RGB")
    w = int(im.width * TARGET_H / im.height)
    imgs.append((im.resize((w, TARGET_H), Image.LANCZOS), label, cap))

W = sum(i[0].width for i in imgs) + PAD * (len(imgs) + 1)
H = TOP + TARGET_H + LABEL_H + PAD
sheet = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(sheet)

d.text((PAD, 24), "考工录 · 八面 — 八面汉剑重建 v010", font=f_title, fill=FG)
d.text((PAD, 82), "5 部件 / 5662 三角面 · 全程连续收分 · 收锋段棱线消隐 · 双侧竖条布光",
       font=f_sub, fill=DIM)

x = PAD
for im, label, cap in imgs:
    sheet.paste(im, (x, TOP))
    d.text((x, TOP + TARGET_H + 12), label, font=f_label, fill=FG)
    d.text((x, TOP + TARGET_H + 52), cap, font=f_cap, fill=DIM)
    x += im.width + PAD

sheet.save(OUT, "PNG")
print("SHEET", OUT, sheet.size)
