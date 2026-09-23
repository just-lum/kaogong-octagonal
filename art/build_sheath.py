"""考工录 · 八面 —— 阵列单元：剑鞘（红木鞘 + 铜装具）

照参考图改造：鞘身深红棕木色，鞘上三处铜装——鞘口箍、中部束带带佩环、鞘尾套。
**不带柄**：柄属于剑，不该长在鞘上（上一版为让阵列里的单元看起来完整而加的柄示意已删除）。

坐标约定与剑一致：柄朝 +Z、鞘朝 -Z。
  z = +0.024  鞘口（与剑的鞘口对齐，装配态剑格落在鞘口内 24 mm）
  z = -0.876  鞘尾
导出为 glTF 后 z 映射到 y，单元高约 90 cm。

部件命名与 Three.js 侧的题签替换对应：
  sheath_body   鞘身（红木）
  sheath_throat 鞘口铜箍
  sheath_band   中部铜束带 + 佩环
  sheath_chape  鞘尾铜套
  sheath_tag    题签木牌（正面，纹理逐格生成）

产出：art/sheath-v002.blend → public/assets/sheath.glb
用法：blender --background --python art/build_sheath.py
"""

import bpy
import bmesh
import math

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

# ------------------------------------------------------------------ 参数（米）
P = {
    "len": 0.900,        # 鞘长
    "w": 0.042,          # 鞘宽
    "t": 0.018,          # 鞘厚
    "wall": 0.0035,      # 壁厚：外壁与内腔之间，须留得下剑身（34 × 8.5 mm）
    "throat_len": 0.062, # 鞘口铜箍长
    "band_len": 0.070,   # 中部铜束带长
    "band_pos": 0.40,    # 束带距鞘口的位置（占鞘长比例）
    "ring_r": 0.024,     # 佩环主半径
    "ring_w": 0.0038,    # 佩环丝径
    "chape_len": 0.088,  # 鞘尾铜套长
    # 题签必须窄于鞘身（42 mm）。原先沿用剑椟的 62 mm 宽，
    # 换成剑鞘后它会从两侧各伸出 10 mm，看起来像剑身透出鞘外。
    "tag_w": 0.034,
    "tag_h": 0.076,
    "tag_t": 0.0030,
}

Z_THROAT = 0.024
Z_TAIL = Z_THROAT - P["len"]
Z_BAND = Z_THROAT - P["len"] * P["band_pos"]
FRONT_Y = -P["t"] * 0.5


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
    # 深红棕木色（参考图的鞘身）。线性基色要压得比直觉更低，
    # 否则在展柜灯幕下会泛成粉红。
    "redwood": make_material("sheath_redwood", (0.145, 0.030, 0.016), 0.0, 0.46,
                             **{"Coat Weight": 0.35, "Coat Roughness": 0.28}),
    # 铜金装具
    "bronze": make_material("sheath_bronze", (0.440, 0.260, 0.056), 1.0, 0.34),
    "wood": make_material("sheath_wood", (0.640, 0.520, 0.336), 0.0, 0.62),
    # 缠缑：与主剑的柄同色，插入态的剑柄用它
    "wrap": make_material("sheath_wrap", (0.315, 0.262, 0.196), 0.0, 0.72),
}


def ellipse(w, t, n=16):
    return [(w * math.cos(2 * math.pi * i / n), t * math.sin(2 * math.pi * i / n))
            for i in range(n)]


def bridge(bm, rings, close_first=False):
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


def sleeve(name, z_start, length, w_scale, t_scale, material, direction=-1.0,
           steps=3, sides=16, closed=True):
    """沿 Z 方向的一段套筒：用于鞘口箍、束带、鞘尾套。
    closed=False 时两端留空，鞘口箍必须留空，否则会把鞘口堵成实心顶盖。"""
    bm = bmesh.new()
    rings = []
    for i in range(steps + 1):
        u = i / steps
        z = z_start + direction * u * length
        k = 1.0 - 0.10 * abs(u - 0.5) * 2
        rings.append([bm.verts.new((x, y, z))
                      for (x, y) in ellipse(P["w"] * 0.5 * w_scale * k,
                                            P["t"] * 0.5 * t_scale * k, sides)])
    bridge(bm, rings, close_first=closed)
    if closed:
        cap(bm, rings[-1])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    return finish(bm, name, material, smooth=True)


def add_ring(bm, center, major_r, minor_r, major_seg=20, minor_seg=8):
    """佩环：环面落在 XZ 平面，正面看上去是一个圆。"""
    rings = []
    for i in range(major_seg):
        a = 2 * math.pi * i / major_seg
        ring = []
        for j in range(minor_seg):
            b = 2 * math.pi * j / minor_seg
            r = major_r + math.cos(b) * minor_r
            x = math.cos(a) * r
            z = math.sin(a) * r
            y = math.sin(b) * minor_r
            ring.append(bm.verts.new((center[0] + x, center[1] + y, center[2] + z)))
        rings.append(ring)
    for i in range(major_seg):
        ring_a, ring_b = rings[i], rings[(i + 1) % major_seg]
        for j in range(minor_seg):
            k = (j + 1) % minor_seg
            try:
                bm.faces.new([ring_a[j], ring_a[k], ring_b[k], ring_b[j]])
            except ValueError:
                pass


def build_body():
    """鞘身：红木**空心管**。

    实心鞘会让剑身从木头里穿出来；这里沿轴向同时放外壁环与内壁环，
    鞘口做成环形端面、中间留开口供剑身插入，鞘尾收拢封底。
    """
    bm = bmesh.new()
    outer_rings = []
    inner_rings = []
    steps = 14
    wall = P["wall"]
    # 内腔按固定尺寸生成，不随外壁收分——否则中下段内腔会比剑身窄，
    # 剑身会顶穿鞘壁。只在最后一段收拢封底。
    inner_w = max(P["w"] * 0.5 - wall, 0.0004)
    inner_t = max(P["t"] * 0.5 - wall * 0.6, 0.0004)
    for i in range(steps + 1):
        u = i / steps
        z = Z_THROAT - u * P["len"]
        # 外壁收分放轻，鞘尾壁厚才留得住
        k = 1.0 - 0.05 * u
        if u > 0.93:
            k *= max(0.0, 1.0 - (u - 0.93) / 0.07) ** 0.5
        k = max(k, 1e-4)
        ow, ot = P["w"] * 0.5 * k, P["t"] * 0.5 * k
        tail = 1.0 if u < 0.88 else max(0.02, 1.0 - (u - 0.88) / 0.12)
        iw = inner_w * tail
        it = inner_t * tail
        outer_rings.append([bm.verts.new((x, y, z)) for (x, y) in ellipse(ow, ot, 16)])
        inner_rings.append([bm.verts.new((x, y, z)) for (x, y) in ellipse(iw, it, 16)])

    bridge(bm, outer_rings)
    # 内壁反向一份，使这一层的面朝内
    bridge(bm, [ring[::-1] for ring in inner_rings])

    # 鞘口的环形端面：把外壁首环与内壁首环连起来，中间留开口
    outer_first, inner_first = outer_rings[0], inner_rings[0]
    for j in range(len(outer_first)):
        k = (j + 1) % len(outer_first)
        try:
            bm.faces.new([outer_first[k], outer_first[j], inner_first[j], inner_first[k]])
        except ValueError:
            pass

    cap(bm, outer_rings[-1])
    cap(bm, inner_rings[-1])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    return finish(bm, "sheath_body", MAT["redwood"], smooth=True)


def build_throat():
    """鞘口铜箍：两端不封口，否则会把鞘口堵死，看不出鞘是空心的。"""
    return sleeve("sheath_throat", Z_THROAT + 0.002, P["throat_len"], 1.12, 1.16,
                  MAT["bronze"], closed=False)


def build_band():
    """中部铜束带 + 佩环（对应参考图里那只可挂的环）。"""
    band = sleeve("sheath_band", Z_BAND + P["band_len"] * 0.5, P["band_len"],
                  1.10, 1.14, MAT["bronze"])
    bm = bmesh.new()
    bm.from_mesh(band.data)
    add_ring(bm, (0.0, FRONT_Y - P["ring_w"] * 0.6, Z_BAND), P["ring_r"], P["ring_w"])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(band.data)
    bm.free()
    band.data.update()
    return band


def build_chape():
    """鞘尾铜套。"""
    return sleeve("sheath_chape", Z_TAIL - 0.004, P["chape_len"], 1.14, 1.18,
                  MAT["bronze"], direction=+1.0)


def build_tag():
    """题签：贴在鞘身正面，Three.js 侧替换为条目名纹理。"""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(P["tag_w"], P["tag_t"], P["tag_h"]), verts=bm.verts)
    bmesh.ops.bevel(bm, geom=bm.edges[:] + bm.verts[:], offset=0.0012,
                    segments=2, profile=0.6, affect="EDGES")
    bmesh.ops.translate(
        bm,
        vec=(0.0, FRONT_Y - P["tag_t"] * 0.5, Z_THROAT - P["len"] * 0.64),
        verts=bm.verts,
    )
    return finish(bm, "sheath_tag", MAT["wood"], smooth=False)


# ---------------------------------------------------------------- 汇总
parts = [build_body(), build_throat(), build_band(), build_chape(), build_tag()]

total_tris = 0
for obj in parts:
    obj.data.calc_loop_triangles()
    total_tris += len(obj.data.loop_triangles)

z_min, z_max = 1e9, -1e9
for obj in parts:
    for vert in obj.data.vertices:
        z_min, z_max = min(z_min, vert.co.z), max(z_max, vert.co.z)

bpy.context.scene["kaogong_sheath_parts"] = ",".join(o.name for o in parts)
bpy.context.view_layer.update()

print(f"剑鞘部件 {len(parts)} 个 | 三角面 {total_tris} | "
      f"单元高度 {(z_max - z_min) * 100:.1f} cm（纯鞘，无柄）")
print(f"包围盒 z 范围：{z_min * 100:.1f} ~ {z_max * 100:.1f} cm")

# ------------------------------------------------------------------ 尺寸链自检
# 与 art/build_jian.py 的 blade_w / blade_t 绑定：任一侧改动都要一并复核。
BLADE_HALF_W = 0.0170
BLADE_HALF_T = 0.00425
inner_w = P["w"] * 0.5 - P["wall"]
inner_t = P["t"] * 0.5 - P["wall"] * 0.6
tail_outer = P["w"] * 0.5 * 0.95
print(f"尺寸链自检：内腔半宽 {inner_w * 1000:.1f} mm vs 剑身 {BLADE_HALF_W * 1000:.1f} mm "
      f"→ 余量 {(inner_w - BLADE_HALF_W) * 1000:.1f} mm")
print(f"          内腔半厚 {inner_t * 1000:.1f} mm vs 剑身 {BLADE_HALF_T * 1000:.1f} mm "
      f"→ 余量 {(inner_t - BLADE_HALF_T) * 1000:.1f} mm")
print(f"          鞘尾外壁半宽 {tail_outer * 1000:.1f} mm，壁厚 "
      f"{(tail_outer - inner_w) * 1000:.2f} mm")

# 逐高度核对。内腔按构造公式给值——不能拿顶点去采样：椭圆环上含 x=0 的极点，
# 用 min|x| 会把极点误判成内壁。
# 剑身一侧同理不能按恒定的 17 mm 算：收锋段宽度会迅速收窄（与 build_jian.py 的
# blade_shape 一致），必须按该深度的实际半宽来比。
def blade_half_width(depth_mm):
    u = min(1.0, depth_mm / 858.0)
    if u <= 0.78:
        k = 1.0 - 0.06 * (u / 0.78)
    else:
        v = (u - 0.78) / 0.22
        k = max(0.0, 1.0 - v) ** 0.62
    return BLADE_HALF_W * 1000 * k


print("          逐高度核对（鞘内深度 → 内腔半宽 / 剑身半宽 / 余量）：")
worst = 1e9
for u in (0.0, 0.25, 0.5, 0.75, 0.86, 0.90, 0.93, 0.96):
    tail = 1.0 if u < 0.88 else max(0.02, 1.0 - (u - 0.88) / 0.12)
    iw_mm = inner_w * tail * 1000
    bw_mm = blade_half_width(u * P["len"] * 1000)
    margin = iw_mm - bw_mm
    worst = min(worst, margin)
    print(f"            u={u:.2f}  内 {iw_mm:5.1f}  剑 {bw_mm:5.1f}  余 {margin:+.1f} mm")
print(f"          全程最小余量 {worst:+.1f} mm（为正即剑身不会穿出鞘壁）")

# 贴在鞘身上的部件不得宽过鞘身，否则会从两侧探出来
print(f"          题签宽 {P['tag_w'] * 1000:.1f} mm vs 鞘宽 {P['w'] * 1000:.1f} mm → "
      f"{'OK' if P['tag_w'] < P['w'] else '越界！'}")
