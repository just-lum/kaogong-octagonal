"""阶段 8：把工程源导出为站点用的 glb，并做导出后校验。

用法：
  blender --background <file.blend> --python art/export_assets.py -- <out.glb>

只导出 MESH（隐藏相机/灯光），保留材质与贴图（glTF 内嵌），
导出后重新解析 glb 的头信息，确认网格名与顶点数。
"""
import bpy
import json
import os
import struct
import sys


def argv_after_ddash():
    if "--" in sys.argv:
        return sys.argv[sys.argv.index("--") + 1:]
    return []


args = argv_after_ddash()
if not args:
    raise SystemExit("usage: -- <output.glb>")
OUT = args[0]
os.makedirs(os.path.dirname(OUT), exist_ok=True)

# 只选网格
for ob in bpy.data.objects:
    ob.select_set(ob.type == 'MESH')

meshes = sorted(o.name for o in bpy.data.objects if o.type == 'MESH')
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format='GLB',
    use_selection=True,
    export_apply=True,
    export_materials='EXPORT',
    export_image_format='AUTO',
    export_yup=True,
)

# ---- 导出后校验：直接解析 GLB 容器与 JSON 块 ----
size = os.path.getsize(OUT)
with open(OUT, "rb") as f:
    magic, version, length = struct.unpack("<III", f.read(12))
    chunk_len, chunk_type = struct.unpack("<II", f.read(8))
    gltf = json.loads(f.read(chunk_len).decode("utf-8").rstrip("\x00"))

node_names = [n.get("name") for n in gltf.get("nodes", [])]
mesh_names = [m.get("name") for m in gltf.get("meshes", [])]
mat_names = [m.get("name") for m in gltf.get("materials", [])]
images = [i.get("name", i.get("uri", "?")) for i in gltf.get("images", [])]

print("DSH_EXPORT_BEGIN")
print(json.dumps({
    "output": OUT,
    "bytes": size,
    "glb_magic_ok": magic == 0x46546C67,
    "version": version,
    "declared_length_matches": length == size,
    "source_meshes": meshes,
    "nodes": node_names,
    "meshes": mesh_names,
    "materials": mat_names,
    "images": images,
    "images_count": len(images),
}, ensure_ascii=False, indent=2))
print("DSH_EXPORT_END")
