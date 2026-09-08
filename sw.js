/* ============================================================
   Service Worker — Stock Select  (versión app partida en módulos)
   - index.html / navegación: NETWORK-FIRST (siempre la última si hay red).
   - NUESTROS .js y .css: NETWORK-FIRST con copia en cache. Así, al editar
     un archivo y subirlo, el cambio se ve al toque online; y offline queda
     la última versión cacheada. (No hace falta bumpear el cache por cada
     edición para que ande online; el bump sólo refresca el respaldo offline.)
   - iconos / manifest: cache-first.
   - API (workers.dev): sin intervención (siempre a la red).
   - pdf.js / jsPDF / xlsx (CDN): cache-first para usar offline.

   ACTUALIZACIÓN CONTROLADA: no auto-activamos con skipWaiting; cuando hay
   versión nueva el SW queda "waiting" y la app muestra el botón "Update".
   ============================================================ */
const CACHE = "mayor-stock-v51";   // v51: nueva gama de color Indigo (claro + oscuro)

const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
  "./apple-touch-icon.png",
  "./favicon.png",
  "./js/01-core.js",
  "./js/02-engine.js",
  "./js/03-router.js",
  "./js/10-view-dashboard.js",
  "./js/11-view-analisis.js",
  "./js/12-view-investments.js",
  "./js/13-view-productos.js",
  "./js/14-view-documentos.js",
  "./js/15-view-movimientos.js",
  "./js/16-view-datos.js",
  "./js/20-modal-producto.js",
  "./js/21-modal-documento.js",
  "./js/17-view-clientes.js",
  "./js/30-pdf.js",
  "./js/31-export-pnl.js",
  "./js/32-importar-pdf.js",
  "./js/33-ficha-producto.js",
  "./js/34-datos-io.js",
  "./js/22-ui-modales.js",
  "./js/90-boot.js",
];

const CDN = "https://cdnjs.cloudflare.com/ajax/libs/";   // pdf.js + jsPDF + xlsx: cache-first offline

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("message", e => {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", e => {
  const req = e.request;
  let url;
  try { url = new URL(req.url); } catch { return; }

  // API: no la tocamos, va siempre a la red
  if (url.hostname.endsWith("workers.dev")) return;

  // CDN (pdf.js/jsPDF/xlsx): cache-first, guardando copia para offline
  if (req.url.startsWith(CDN)) {
    e.respondWith(
      caches.match(req).then(hit =>
        hit || fetch(req).then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
          return res;
        }).catch(() => hit)
      )
    );
    return;
  }

  if (req.method !== "GET") return;

  // Navegación / index.html: NETWORK-FIRST
  const isNav = req.mode === "navigate" ||
                url.pathname.endsWith("/") ||
                url.pathname.endsWith("/index.html");
  if (isNav) {
    e.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put("./index.html", copy)).catch(() => {});
        return res;
      }).catch(() => caches.match("./index.html").then(h => h || caches.match("./")))
    );
    return;
  }

  // Nuestros propios .js y .css: NETWORK-FIRST con copia en cache (para ver
  // los cambios al toque al editar; offline usa la última copia cacheada).
  if (url.origin === self.location.origin && /\.(js|css)$/.test(url.pathname)) {
    e.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // Resto (iconos, manifest, etc.): cache-first con fallback a red
  e.respondWith(caches.match(req).then(hit => hit || fetch(req)));
});
