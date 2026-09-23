import { defineConfig } from "vite";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";

// Blender 反复导出会覆盖同名 GLB。按内容哈希生成版本化文件名，
// 既让源路径保持稳定，又保证部署后不会命中上一版模型的缓存。
const modelNames = ["jian", "sheath"];
const models = modelNames
  .filter((name) => existsSync(`public/assets/${name}.glb`))
  .map((name) => {
    const source = readFileSync(`public/assets/${name}.glb`);
    const hash = createHash("sha256").update(source).digest("hex").slice(0, 16);
    return {
      key: `assets/${name}.glb`,
      fileName: `assets/${name}.${hash}.glb`,
      source,
    };
  });

export default defineConfig(() => ({
  base: "/",
  define: {
    __MODELS__: JSON.stringify(
      Object.fromEntries(models.map((model) => [model.key, model.fileName])),
    ),
  },
  // 让 three 与 GLTFLoader 一起预构建，避免两者各自打包出不同实例
  optimizeDeps: {
    include: ["three", "three/examples/jsm/loaders/GLTFLoader.js"],
  },
  server: {
    port: 5273,
    strictPort: false,
  },
  build: {
    target: "es2022",
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        // three 体积占大头且极少变动，单独成块便于长期缓存
        manualChunks: { three: ["three"] },
      },
    },
  },
  plugins: models.length
    ? [
        {
          name: "versioned-model-assets",
          apply: "build" as const,
          buildStart() {
            for (const model of models)
              this.emitFile({
                type: "asset",
                fileName: model.fileName,
                source: model.source,
              });
          },
        },
      ]
    : [],
}));
