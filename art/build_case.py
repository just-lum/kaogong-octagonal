"""考工录 · 八面 —— 剑椟（漆木剑匣）建模

阵列单元：四十格剑椟，尺寸按容纳 110 cm 汉剑定。

坐标约定（与 glTF 导出后的一致性直接相关）：
  Blender 的 Z 是"上"，导出后成为 glTF 的 Y。
  因此匣长沿 Blender 的 Z 建模，导出后在网页里就是竖直站立的。
  匣的正面（盖与题签所在）朝 Blender 的 -Y，导出后朝向 glTF 的 +Z。

部件命名与 Three.js 侧的开匣动画对应：
  case_body   匣体（漆木）
  case_lid    匣盖（抽取后沿 +Z 平移并旋转开启）
  case_clasp  铜扣 ×2（压在盖面上，修复上一版被匣体包住的问题）
  case_tag    题签木牌（Three.js 侧替换为条目名纹理）

产出：art/case-v003.blend → public/assets/case.glb
用法：blender --background --python art/build_case.py
"""

import bpy
import bmesh

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
    "case_len": 1.150,   # 匣长（沿 Z，竖直）
    "case_w": 0.118,     # 匣宽（沿 X）
    "case_h": 0.060,     # 匣体厚（沿 Y）
    "lid_h": 0.017,      # 匣盖厚
    "bevel": 0.0040,
    "clasp_w": 0.022,    # 铜扣宽
    "clasp_len": 0.086,  # 铜扣长（沿 Z）
    "clasp_d": 0.012,    # 铜扣外凸
    "tag_w": 0.062,      # 题签宽（竖长方形）
    "tag_h": 0.098,      # 题签长（沿 Z）
    "tag_t": 0.0035,     # 题签厚
}

FRONT_Y = -P["case_h"] * 0.5          # 匣体正面
LID_Y = FRONT_Y - P["lid_h"] * 0.5     # 匣盖中心
CLASP_Y = FRONT_Y - P["lid_h"] - P["clasp_d"] * 0.5 + 0.003
TAG_Y = FRONT_Y - P["lid_h"] - P["tag_t"] * 0.5


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
    "lacquer": make_material("case_lacquer", (0.058, 0.046, 0.042), 0.0, 0.18,
                             **{"Coat Weight": 0.8, "Coat Roughness": 0.1}),
    "bronze": make_material("case_bronze", (0.452, 0.352, 0.198), 0.9, 0.38),
    "wood": make_material("case_wood", (0.640, 0.520, 0.336), 0.0, 0.62),
}


def beveled_box(name, sx, sy, sz, bevel, material, location=(0.0, 0.0, 0.0), smooth=False):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=bm.verts)
    bmesh.ops.bevel(bm, geom=bm.edges[:] + bm.verts[:], offset=bevel,
                    segments=2, profile=0.6, affect="EDGES")
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    for poly in mesh.polygons:
        poly.use_smooth = smooth
    obj = bpy.data.objects.new(name, mesh)
    obj.data.materials.append(material)
    obj.location = location
    bpy.context.collection.objects.link(obj)
    return obj


def build_body():
    """匣体：长度沿 Z 竖直，中心上移到 z = len/2，底部落在 z = 0。"""
    return beveled_box("case_body", P["case_w"], P["case_h"], P["case_len"],
                       P["bevel"], MAT["lacquer"], (0.0, 0.0, P["case_len"] * 0.5))


def build_lid():
    """匣盖：扣在匣体正面（-Y）。"""
    return beveled_box("case_lid", P["case_w"] * 0.97, P["lid_h"], P["case_len"] * 0.99,
                       0.0035, MAT["lacquer"], (0.0, LID_Y, P["case_len"] * 0.5))


def build_clasp():
    """铜扣：两枚，压在盖面上（位于盖之外，不再被匣体包住）。"""
    bm = bmesh.new()
    for sign in (-1.0, 1.0):
        z = P["case_len"] * 0.5 + sign * P["case_len"] * 0.26
        tmp = bmesh.new()
        bmesh.ops.create_cube(tmp, size=1.0)
        bmesh.ops.scale(tmp, vec=(P["clasp_w"], P["clasp_d"], P["clasp_len"]), verts=tmp.verts)
        bmesh.ops.bevel(tmp, geom=tmp.edges[:] + tmp.verts[:], offset=0.0016,
                        segments=2, profile=0.6, affect="EDGES")
        bmesh.ops.translate(tmp, vec=(0.0, CLASP_Y, z), verts=tmp.verts)
        mesh_tmp = bpy.data.meshes.new("tmp")
        tmp.to_mesh(mesh_tmp)
        tmp.free()
        bm.from_mesh(mesh_tmp)
        bpy.data.meshes.remove(mesh_tmp)

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new("case_clasp")
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new("case_clasp", mesh)
    obj.data.materials.append(MAT["bronze"])
    bpy.context.collection.objects.link(obj)
    return obj


def build_tag():
    """题签木牌：贴在盖面居中偏上，Three.js 侧替换为条目名纹理。"""
    return beveled_box("case_tag", P["tag_w"], P["tag_t"], P["tag_h"],
                       0.0012, MAT["wood"], (0.0, TAG_Y, P["case_len"] * 0.62))


parts = [build_body(), build_lid(), build_clasp(), build_tag()]

total_tris = 0
for obj in parts:
    obj.data.calc_loop_triangles()
    total_tris += len(obj.data.loop_triangles)

bpy.context.scene["kaogong_case_parts"] = ",".join(o.name for o in parts)
bpy.context.view_layer.update()

print(f"剑椟部件 {len(parts)} 个 | 三角面 {total_tris} | "
      f"匣长 {P['case_len']*100:.0f} cm（沿 Z，导出后竖直）| "
      f"正面朝 -Y（导出后朝 +Z）")
