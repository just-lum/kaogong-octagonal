// 考工录 · 八面 —— Service Worker
//
// 策略：外壳（HTML）走网络优先、失败回退缓存；模型与图标等静态资源走缓存优先。
// 版本号变更时清理旧缓存，避免旧模型残留。
// 只在生产构建注册；开发模式不注册，免得调试时命中旧缓存。

const CACHE = "kaogong-v1";

/** 固定路径的外壳资源；带内容哈希的构建产物在首次取用时自然进缓存 */
const SHELL = ["/", "/index.html", "/icon.svg", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 模型、图标、字体：缓存优先
  if (/\.(glb|svg|png|jpg|webp|woff2?)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((response) => {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put(request, copy));
            return response;
          }),
      ),
    );
    return;
  }

  // 外壳：网络优先，失败回退到缓存与首页
  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        void caches.open(CACHE).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(() =>
        caches.match(request).then((hit) => hit ?? caches.match("/").then((root) => root ?? Response.error())),
      ),
  );
});
