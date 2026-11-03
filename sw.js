/* Atril sin conexión.
 * - La app (este sitio) se sirve primero desde la red y, si no hay internet, desde la copia guardada.
 * - Las librerías de los CDN (pdf.js, pdf-lib, JSZip, docx, MediaPipe/Gemma y las fuentes) se guardan
 *   la primera vez y después se sirven desde aquí: tienen versión fija, así que nunca cambian.
 * - No se guardan aquí Google (inicio de sesión, Drive) ni el modelo de Gemma (va aparte, en el navegador).
 */
const APP = "atril-app-v4", LIBS = "atril-libs-v1";
const SHELL = ["./", "index.html", "platform.js", "platform.css", "config.js", "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png", "privacidad.html"];
const CORE_LIBS = [
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js",
  "https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js",
  "https://fonts.googleapis.com/css2?family=Literata:ital,opsz,wght@0,7..72,400;0,7..72,600;1,7..72,400&family=Figtree:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap",
];
const CDN = /^https:\/\/(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)\//;

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const app = await caches.open(APP); await app.addAll(SHELL);
    const libs = await caches.open(LIBS);
    await Promise.all(CORE_LIBS.map(async (u) => { try { if (!(await libs.match(u))) { const r = await fetch(u, { mode: "cors" }); if (r.ok) await libs.put(u, r); } } catch {} }));
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if ((k.startsWith("atril-app-") && k !== APP) || (k.startsWith("atril-libs-") && k !== LIBS)) await caches.delete(k);
    await self.clients.claim();
  })());
});
const timeout = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms));
self.addEventListener("fetch", (e) => {
  const req = e.request; if (req.method !== "GET") return;
  const u = new URL(req.url);
  if (u.origin === location.origin) {
    e.respondWith((async () => {
      const app = await caches.open(APP);
      try {
        const r = await Promise.race([fetch(req), timeout(req.mode === "navigate" ? 6000 : 8000)]);
        if (r.ok) app.put(req.mode === "navigate" ? "index.html" : req, r.clone());
        return r;
      } catch {
        return (await app.match(req, { ignoreSearch: true })) || (req.mode === "navigate" ? await app.match("index.html") : null) || Response.error();
      }
    })());
    return;
  }
  if (CDN.test(req.url)) {
    e.respondWith((async () => {
      const libs = await caches.open(LIBS);
      const hit = await libs.match(req.url); if (hit) return hit;
      const r = await fetch(req.url, { mode: "cors", credentials: "omit" }).catch(() => fetch(req));
      if (r && (r.ok || r.type === "opaque")) libs.put(req.url, r.clone());
      return r;
    })());
  }
});
