"""从字库提取「剑」的字形轮廓，供开场动画使用。

用法：python art/extract_glyph.py [字体路径] [字符]
输出：每个连通块的 SVG 路径（已缩放并居中到项目字面）与扫描轴，打印为 JSON，
      供 src/boot-tracks.ts 的笔画数据取用。

背景：手画轮廓做不出书法的笔韵（出来像几何块），故改为直接取字库字形。
代价是字库里的「剑」只有 7 个连通块——撇捺共用根部、底横与右撇相交——
拆不出九条独立笔画，所以动画是"逐块扫描"而不是"逐笔书写"。
"""
import json
import os
import sys

from fontTools.pens.recordingPen import RecordingPen
from fontTools.ttLib import TTFont

# 项目字面，与 boot-tracks.ts 保持一致
BOX_W, BOX_H = 386.0, 382.0
BOX_CX, BOX_CY = 957.0, 513.0

DEFAULT_FONT = r"C:\Windows\Fonts\STKAITI.TTF"
DEFAULT_CHAR = "剑"


def contours_of(font_path: str, char: str):
    font = TTFont(font_path)
    gid = font.getBestCmap()[ord(char)]
    glyph_set = font.getGlyphSet()
    pen = RecordingPen()
    glyph_set[gid].draw(pen)

    out, cur = [], []
    for op, args in pen.value:
        if op == "moveTo":
            if cur:
                out.append(cur)
            cur = [args[0]]
        elif op == "lineTo":
            cur.append(args[0])
        elif op in ("curveTo", "qCurveTo"):
            # 取控制点做折线近似：TrueType 字形点位足够密，视觉上没有差别，
            # 而把它转成贝塞尔需要处理 qCurveTo 的隐式中点，得不偿失
            for a in args:
                if isinstance(a, tuple) and len(a) == 2:
                    cur.append(a)
        elif op == "closePath":
            if cur:
                out.append(cur)
                cur = []
    if cur:
        out.append(cur)

    # 丢掉退化的碎片（点数过少或面积可忽略的）
    kept = []
    for c in out:
        if len(c) < 3:
            continue
        xs = [p[0] for p in c]
        ys = [p[1] for p in c]
        if (max(xs) - min(xs)) < 1 and (max(ys) - min(ys)) < 1:
            continue
        kept.append(c)
    return kept


def to_path(points, upm, x0, y0, scale, mirror_y):
    """把字形点串转成 SVG 路径，并映射到项目字面。"""
    parts = []
    for i, (px, py) in enumerate(points):
        x = BOX_CX + ((px - x0) * scale) - BOX_W / 2
        y_raw = (py - y0) * scale
        y = BOX_CY + (BOX_H / 2 - y_raw) if mirror_y else BOX_CY - (BOX_H / 2 - y_raw)
        parts.append(("M %.1f %.1f" if i == 0 else "L %.1f %.1f") % (x, y))
    return " ".join(parts) + " Z"


def main():
    font_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_FONT
    char = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_CHAR

    if not os.path.exists(font_path):
        print("字体不存在:", font_path)
        sys.exit(1)

    contours = contours_of(font_path, char)
    all_pts = [p for c in contours for p in c]
    min_x = min(p[0] for p in all_pts)
    max_x = max(p[0] for p in all_pts)
    min_y = min(p[1] for p in all_pts)
    max_y = max(p[1] for p in all_pts)
    gw, gh = max_x - min_x, max_y - min_y
    scale = min(BOX_W / gw, BOX_H / gh)

    blocks = []
    for c in contours:
        xs = [p[0] for p in c]
        ys = [p[1] for p in c]
        d = to_path(c, None, min_x, min_y, scale, True)
        # 扫描轴：按该块自身长边定方向，竖块自上而下、横块自左而右
        bw, bh = (max(xs) - min(xs)) * scale, (max(ys) - min(ys)) * scale
        ccx = BOX_CX + ((min(xs) + max(xs)) / 2 - min_x) * scale - BOX_W / 2
        ccy = BOX_CY + (BOX_H / 2 - ((min(ys) + max(ys)) / 2 - min_y) * scale)
        half_w, half_h = bw / 2, bh / 2
        if bh >= bw:
            axis = [ccx, ccy - half_h, ccx, ccy + half_h]
        else:
            axis = [ccx - half_w, ccy, ccx + half_w, ccy]
        blocks.append({
            "d": d,
            "bbox": [round(ccx - half_w, 1), round(ccy - half_h, 1),
                     round(bw, 1), round(bh, 1)],
            "axis": [round(v, 1) for v in axis],
            "points": len(c),
        })

    blocks.sort(key=lambda b: (b["bbox"][1] // 40, b["bbox"][0]))
    payload = {
        "font": os.path.basename(font_path),
        "char": char,
        "blocks": len(blocks),
        "scale": round(scale, 4),
        "glyph_box": [round(gw, 1), round(gh, 1)],
        "data": blocks,
    }
    here = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(here, "glyph-blocks.json"), "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    # 顺便产出可直接粘进 boot-tracks.ts 的片段：每块沿扫描轴的反方向补一段画面外的来路
    lines = ["export const GLYPH_BLOCKS = ["]
    for i, b in enumerate(blocks):
        x, y, w, h = b["bbox"]
        x1, y1, x2, y2 = b["axis"]
        dx, dy = x2 - x1, y2 - y1
        if abs(dx) >= abs(dy):
            lead = ("M -40 %.1f L %.1f %.1f" % (y1, x1, y1)) if dx >= 0 \
                else ("M 1960 %.1f L %.1f %.1f" % (y1, x1, y1))
            weight = 12.0
        else:
            lead = ("M %.1f -40 L %.1f %.1f" % (x1, x1, y1)) if dy >= 0 \
                else ("M %.1f 1120 L %.1f %.1f" % (x1, x1, y1))
            weight = 12.0
        lines.append(
            '  {\n    key: "b%d",\n    shape:\n      "%s",\n'
            '    axis: [%s],\n    lead: "%s",\n    leadWeight: %.0f,\n  },'
            % (i, b["d"], ", ".join("%.1f" % v for v in b["axis"]), lead, weight)
        )
    lines.append("] as const;")
    snippet = os.path.join(here, "glyph-blocks.ts.txt")
    with open(snippet, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")

    print("WROTE", os.path.join(here, "glyph-blocks.json"), "and", snippet)
    print("blocks:", payload["blocks"], " scale:", payload["scale"],
          " glyph_box:", payload["glyph_box"])


if __name__ == "__main__":
    main()
