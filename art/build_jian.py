"""考工录 · 八面 —— 八面汉剑参数化建模（可复现脚本）

尺寸依据：
  徐州博物馆藏东汉"五十湅"钢剑（文物编号 00133）：长 109 / 宽 3.1 / 厚 0.8 cm，
  剑把长 20.5 cm，鞘为苎胎髹漆，把上有麻织物痕迹，铭文"建初二年蜀郡西工官王愔造五十湅"，
  剑镡内侧阴刻"直千五百"。
  现代八面汉剑实测：全长 110 / 刃长 79 / 柄长 26 / 刃宽 3.6 / 刃厚 0.9 cm。
  八面定义（工匠口径）：剑身为 4 个面叫四面，6 个面叫六面，8 个面叫八面；原形汉剑身长而窄，分八面研磨。
  玉具剑四件（湖南博物院讲座）：剑首置柄顶、剑格镶柄身相交处、剑璏嵌鞘上供穿带佩系、玉珌安鞘尾呈梯形。

产出：art/jian-v002.blend → public/assets/jian.glb
用法：blender --background --python art/build_jian.py
"""

import bpy
import bmesh
import math
import mathutils

# ------------------------------------------------------------------ 清场
for obj in list(bpy.data.objects):
    bpy.data.objects.remove(obj, do_unlink=True)
for collection in list(bpy.data.collections):
    if collection.users == 0:
        bpy.data.collections.remove(collection)
for block in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
    for item in list(block):
        if item.users == 0:
            block.remove(item)

# ------------------------------------------------------------------ 参数（单位：米）
P = {
    "blade_len": 0.858, "blade_w": 0.0340, "blade_t": 0.0085,
    "facet_a": 0.62, "facet_b": 0.50,
    "guard_h": 0.0280, "guard_w": 0.0560, "guard_d": 0.0180,
    "grip_len": 0.2030, "grip_w": 0.0170, "grip_t": 0.0120,
    "pommel_r": 0.0210, "pommel_t": 0.0110,
    "scab_len": 0.900, "scab_w": 0.0420, "scab_t": 0.0180,
}

Z_GUARD_TOP = 0.0
Z_GUARD_BOT = -P["guard_h"]
Z_GRIP_BOT = Z_GUARD_BOT - P["grip_len"]
Z_POMMEL = Z_GRIP_BOT - P["pommel_t"]


def pow_(base, exp):
    """钳制底数：1.0-0.94 之类的浮点误差会让底数变成负数，开偶次方即得复数。"""
    return max(0.0, base) ** exp


# ------------------------------------------------------------------ 材质
def make_material(name, base, metallic, roughness, **extra):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")

    def put(key, value):
        sock = bsdf.inputs.get(key) if bsdf else None
        if sock is not None:
            try:
                sock.default_value = value
            except Exception:
                pass

    put("Base Color", (base[0], base[1], base[2], 1.0))
    put("Metallic", metallic)
    put("Roughness", roughness)
    for key, value in extra.items():
        put(key, value)
    return mat


MAT = {
    "steel": make_material("steel", (0.760, 0.775, 0.800), 1.0, 0.20),
    # 装具照参考图改铜装。原玉质定义为 (0.780, 0.815, 0.740)、IOR 1.55、
    # Specular IOR Level 0.6；要切回玉具剑只需还原这一行并调回引用。
    "bronze": make_material("bronze", (0.440, 0.260, 0.056), 1.0, 0.34),
    # 鞘身由黑漆改为红木。原漆色为 (0.055, 0.045, 0.042)、Coat 0.85。
    "redwood": make_material("redwood", (0.078, 0.019, 0.012), 0.0, 0.46,
                             **{"Coat Weight": 0.35, "Coat Roughness": 0.28}),
    "wrap": make_material("wrap", (0.315, 0.262, 0.196), 0.0, 0.72),
}


# ------------------------------------------------------------------ 截面
def octagon(w, t, ar, br):
    """八面剑身截面：8 顶点 8 边。自右刃起逆时针：
    右刃 → 右上折点 → 上脊 → 左上折点 → 左刃 → 左下折点 → 下脊 → 右下折点"""
    a, b = w * ar, t * br
    return [(w, 0.0), (a, b), (0.0, t), (-a, b),
            (-w, 0.0), (-a, -b), (0.0, -t), (a, -b)]


def ellipse(w, t, n=20):
    return [(w * math.cos(2 * math.pi * i / n), t * math.sin(2 * math.pi * i / n))
            for i in range(n)]


def bridge(bm, rings, close_first=False, tip=None):
    for i in range(len(rings) - 1):
        ring_a, ring_b = rings[i], rings[i + 1]
        for j in range(len(ring_a)):
            k = (j + 1) % len(ring_a)
            quad = [ring_a[j], ring_a[k], ring_b[k], ring_b[j]]
            uniq = []
            for vert in quad:
                if vert not in uniq:
                    uniq.append(vert)
            if len(uniq) >= 3:
                try:
                    bm.faces.new(uniq)
                except ValueError:
                    pass
    if close_first:
        try:
            bm.faces.new(list(reversed(rings[0])))
        except ValueError:
            pass
    if tip is not None:
        last = rings[-1]
        for j in range(len(last)):
            k = (j + 1) % len(last)
            try:
                bm.faces.new([last[j], last[k], tip])
            except ValueError:
                pass


def cap(bm, ring):
    try:
        bm.faces.new(list(ring))
    except ValueError:
        pass


def finish(bm, name, material, smooth=False):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    for poly in mesh.polygons:
        poly.use_smooth = smooth
    obj = bpy.data.objects.new(name, mesh)
    obj.data.materials.append(material)
    bpy.context.collection.objects.link(obj)
    return obj


# ------------------------------------------------------------------ 各部件
def blade_shape(u):
    if u <= 0.78:
        k = 1.0 - 0.06 * (u / 0.78)
        return k, 1.0 - 0.12 * (u / 0.78)
    v = (u - 0.78) / 0.22
    k = pow_(1.0 - v, 0.62)
    return k, pow_(k, 0.72)


def build_blade():
    bm = bmesh.new()
    rings = []
    steps = 40
    for i in range(steps):
        u = i / steps
        wk, tk = blade_shape(u)
        z = Z_GUARD_TOP + u * P["blade_len"]
        rings.append([bm.verts.new((x, y, z))
                      for (x, y) in octagon(P["blade_w"] * 0.5 * wk,
                                            P["blade_t"] * 0.5 * tk,
                                            P["facet_a"], P["facet_b"])])
    tip = bm.verts.new((0.0, 0.0, Z_GUARD_TOP + P["blade_len"]))
    bridge(bm, rings, close_first=True, tip=tip)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    return finish(bm, "blade", MAT["steel"], smooth=False)


def build_guard():
    """玉剑格：正视略呈长方形，菱形断面，下边缘尖垂。"""
    bm = bmesh.new()
    hw, hd = P["guard_w"] * 0.5, P["guard_d"] * 0.5

    def rhombs(sw, sd):
        return [(hw * sw, 0.0), (0.0, hd * sd), (-hw * sw, 0.0), (0.0, -hd * sd)]

    z0, z1 = Z_GUARD_BOT, Z_GUARD_TOP
    rings = [
        [bm.verts.new((x, y, z0 + 0.0010)) for (x, y) in rhombs(0.42, 0.42)],
        [bm.verts.new((x, y, z0 + 0.0060)) for (x, y) in rhombs(0.92, 0.95)],
        [bm.verts.new((x, y, z0 + 0.0130)) for (x, y) in rhombs(1.00, 1.00)],
        [bm.verts.new((x, y, z1 - 0.0060)) for (x, y) in rhombs(0.98, 1.00)],
        [bm.verts.new((x, y, z1 - 0.0010)) for (x, y) in rhombs(0.90, 0.94)],
    ]
    bridge(bm, rings, close_first=True)
    top = bm.verts.new((0.0, 0.0, z1))
    for j in range(len(rings[-1])):
        k = (j + 1) % len(rings[-1])
        bm.faces.new([rings[-1][j], rings[-1][k], top])
    drop = bm.verts.new((0.0, 0.0, z0 - 0.0090))
    for j in range(len(rings[0])):
        k = (j + 1) % len(rings[0])
        bm.faces.new([rings[0][k], rings[0][j], drop])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    return finish(bm, "guard", MAT["bronze"], smooth=False)


def build_grip():
    bm = bmesh.new()
    rings = []
    steps = 14
    for i in range(steps + 1):
        u = i / steps
        z = Z_GRIP_BOT + u * P["grip_len"]
        waist = 1.0 - 0.12 * math.sin(math.pi * u)
        rings.append([bm.verts.new((x, y, z))
                      for (x, y) in ellipse(P["grip_w"] * 0.5 * waist,
                                            P["grip_t"] * 0.5 * waist)])
    bridge(bm, rings, close_first=True)
    cap(bm, rings[-1])
    return finish(bm, "grip", MAT["wrap"], smooth=True)


def build_wrap():
    """缠缑：沿柄表面的螺旋缠绕（实物把上有麻织物痕迹）。"""
    bm = bmesh.new()
    turns, seg, tube = 22, 14, 0.0016
    total = int(turns * seg)
    rings = []
    for i in range(total + 1):
        t = i / total
        ang = t * turns * 2 * math.pi
        z = Z_GRIP_BOT + 0.006 + t * (P["grip_len"] - 0.012)
        waist = 1.0 - 0.12 * math.sin(math.pi * ((z - Z_GRIP_BOT) / P["grip_len"]))
        rx, ry = P["grip_w"] * 0.5 * waist, P["grip_t"] * 0.5 * waist
        cx, cy = rx * math.cos(ang), ry * math.sin(ang)
        nx, ny = math.cos(ang), math.sin(ang)
        ring = []
        for k in range(5):
            a = 2 * math.pi * k / 5
            ox, oy = math.cos(a) * tube, math.sin(a) * tube
            ring.append(bm.verts.new((cx + nx * ox, cy + ny * oy, z + oy)))
        rings.append(ring)
    bridge(bm, rings, close_first=True)
    cap(bm, rings[-1])
    return finish(bm, "wrap", MAT["wrap"], smooth=True)


def build_pommel():
    """玉剑首：扁圆形，西汉较薄、正面趋凹坍。"""
    bm = bmesh.new()
    rings = []
    steps = 8
    for i in range(steps + 1):
        u = i / steps
        z = Z_POMMEL + u * P["pommel_t"]
        r = pow_(math.sin(math.pi * (0.16 + 0.68 * u)), 0.45)
        rings.append([bm.verts.new((x, y, z))
                      for (x, y) in ellipse(P["pommel_r"] * r, P["pommel_r"] * r)])
    bridge(bm, rings, close_first=True)
    cap(bm, rings[-1])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    return finish(bm, "pommel", MAT["bronze"], smooth=True)


def build_scabbard():
    bm = bmesh.new()
    rings = []
    steps = 26
    for i in range(steps + 1):
        u = i / steps
        z = Z_GUARD_BOT + 0.004 + u * P["scab_len"]
        k = 1.0 - 0.10 * u
        if u > 0.94:
            k *= pow_(1.0 - (u - 0.94) / 0.06, 0.5)
        k = max(k, 1e-4)
        rings.append([bm.verts.new((x, y, z))
                      for (x, y) in ellipse(P["scab_w"] * 0.5 * k,
                                            P["scab_t"] * 0.5 * k, 24)])
    bridge(bm, rings, close_first=True)
    cap(bm, rings[-1])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    return finish(bm, "scabbard", MAT["redwood"], smooth=True)


def build_slide():
    """玉剑璏：俯视长方形，两端下弯，中有穿孔，嵌于鞘上供穿带佩系。"""
    bm = bmesh.new()
    z0 = Z_GUARD_BOT + 0.004 + P["scab_len"] * 0.26
    length, width, thick = 0.0550, 0.0230, 0.0075
    rings = []
    steps = 16
    for i in range(steps + 1):
        u = i / steps
        z = z0 + u * length
        bend = 1.0 - 0.30 * pow_(max(0.0, (abs(u - 0.5) - 0.30) / 0.20), 1.4)
        rings.append([bm.verts.new((x, y, z))
                      for (x, y) in ellipse(width * 0.5, thick * 0.5 * bend, 12)])
    bridge(bm, rings, close_first=True)
    cap(bm, rings[-1])
    for vert in bm.verts:
        vert.co.y += P["scab_t"] * 0.5 - thick * 0.18
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    return finish(bm, "slide", MAT["bronze"], smooth=True)


def build_chape():
    """玉珌：梯形，汉代收身、体高、较薄，安于鞘尾。"""
    bm = bmesh.new()
    z0 = Z_GUARD_BOT + 0.004 + P["scab_len"] - 0.004
    rings = []
    steps = 8
    for i in range(steps + 1):
        u = i / steps
        z = z0 + u * 0.0240
        k = 0.86 + 0.14 * math.sin(math.pi * u)
        rings.append([bm.verts.new((x, y, z))
                      for (x, y) in ellipse(P["scab_w"] * 0.5 * k * 1.04,
                                            P["scab_t"] * 0.5 * k * 1.10, 12)])
    bridge(bm, rings, close_first=True)
    cap(bm, rings[-1])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    return finish(bm, "chape", MAT["bronze"], smooth=True)


# ------------------------------------------------------------------ 构建
BUILDERS = [
    ("blade", build_blade), ("guard", build_guard), ("grip", build_grip),
    ("wrap", build_wrap), ("pommel", build_pommel), ("scabbard", build_scabbard),
    ("slide", build_slide), ("chape", build_chape),
]

total_tris = 0
z_min, z_max = 1e9, -1e9
for name, builder in BUILDERS:
    obj = builder()
    mesh = obj.data
    mesh.calc_loop_triangles()
    total_tris += len(mesh.loop_triangles)
    for vert in mesh.vertices:
        z_min, z_max = min(z_min, vert.co.z), max(z_max, vert.co.z)

# ------------------------------------------------------------------ 朝向
# 让剑柄在上、剑尖在下：整体绕 X 轴旋转 180°。
# 旋转是正交变换而非镜像，法线方向不受影响；八面棱线仍为硬边。
flip = mathutils.Matrix.Rotation(math.pi, 4, "X")
for obj in bpy.data.objects:
    if obj.type != "MESH":
        continue
    obj.data.transform(flip)
    obj.data.update()

# 旋转后重新统计包围盒
z_min, z_max = 1e9, -1e9
for obj in bpy.data.objects:
    if obj.type != "MESH":
        continue
    for vert in obj.data.vertices:
        z_min, z_max = min(z_min, vert.co.z), max(z_max, vert.co.z)

bpy.context.scene["kaogong_parts"] = ",".join(name for name, _ in BUILDERS)
bpy.context.scene["kaogong_total_cm"] = round((z_max - z_min) * 100, 2)
bpy.context.view_layer.update()

print(f"部件 {len(BUILDERS)} 个 | 三角面 {total_tris} | 全长 {(z_max - z_min) * 100:.1f} cm（柄在上、尖在下）")
print(f"包围盒 z 范围：{z_min * 100:.1f} ~ {z_max * 100:.1f} cm")
