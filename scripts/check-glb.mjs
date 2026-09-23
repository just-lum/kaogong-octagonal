// 在 Node 里直接解析导出的 GLB，确认文件本身可被 three 的 GLTFLoader 读取。
// 旧注释假设「纯几何/材质模型不触发图片与 DOM 相关分支」，接入程序化贴图后该假设失效：
// GLTFLoader 加载纹理时会引用浏览器全局 self。这里补最小 shim，纹理仍走真实解码路径。
if (typeof globalThis.self === "undefined") globalThis.self = globalThis;
import { readFileSync } from "node:fs";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const path = process.argv[2] ?? "public/assets/jian.glb";
const buf = readFileSync(path);
const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

const loader = new GLTFLoader();
loader.parse(
  arrayBuffer,
  "",
  (gltf) => {
    const keys = Object.keys(gltf ?? {});
    const scene = gltf?.scene ?? gltf?.scenes?.[0];
    console.log("parse ok");
    console.log("gltf keys :", keys.join(", "));
    console.log("has scene :", Boolean(gltf?.scene));
    console.log("scenes    :", gltf?.scenes?.length ?? 0);
    if (scene) {
      const meshes = [];
      scene.traverse((node) => {
        if (node.isMesh) meshes.push(`${node.name}[${node.geometry.attributes.position.count}v]`);
      });
      console.log("meshes    :", meshes.join(", "));
    } else {
      console.log("!! scene 缺失，这就是浏览器端 traverse 报错的根源");
    }
  },
  (error) => {
    console.error("parse failed:", error);
    process.exitCode = 1;
  },
);
