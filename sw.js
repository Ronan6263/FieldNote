/* FieldNote offline cache */
const VERSION = "fieldnote-v1";
const FILES = [
  "./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png",
  "./vendor/pdf.min.js", "./vendor/pdf.worker.min.js",
  "./vendor/standard_fonts/LiberationSans-Regular.ttf", "./vendor/standard_fonts/LiberationSans-Bold.ttf",
  "./vendor/standard_fonts/LiberationSans-Italic.ttf", "./vendor/standard_fonts/LiberationSans-BoldItalic.ttf"
];
self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await Promise.all(FILES.map((f) => c.add(f).catch(() => {})));
    self.skipWaiting();
  })());
});
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  // App page: network first so updates arrive, cache when offline.
  if (req.mode === "navigate" || /\/(index\.html)?$/.test(url.pathname)) {
    e.respondWith((async () => {
      const c = await caches.open(VERSION);
      try {
        const res = await fetch(req);
        if (res.ok) c.put("./index.html", res.clone());
        return res;
      } catch (_) {
        return (await c.match("./index.html")) || (await c.match("./")) || Response.error();
      }
    })());
    return;
  }
  // Everything else: cache first.
  e.respondWith((async () => {
    const c = await caches.open(VERSION);
    const hit = await c.match(req);
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    } catch (_) { return Response.error(); }
  })());
});
