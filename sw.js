/* ============================================================
   Service Worker — Select  (versión app partida en módulos)
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
const CACHE = "mayor-stock-v110";   // v110: el Editor sólo edita lo que cargó (permiso 'editar lo de otros' por usuario); cada compra/venta guarda quién la cargó; importar factura respeta el idioma (otro idioma = otro SKU) y pide el idioma del producto nuevo
//   // v109: gráficos de barras sin etiquetas pisadas y Margen % alineado por semana; la página ya no se estira a lo ancho en pantallas medianas; simulador del plan en celular; cliente sin nombre repetido; encabezados de tabla pegados arriba sin hueco
//   // v108: la app pasa a llamarse Select (barra, login, pestaña, ícono instalado, Excel)
//   // v107: barra superior igual a Prince (chip de usuario, nubecita de sincronizado; sync, ayuda y salir a la derecha)
//   // v106: mismo ícono de Compras y mismos grosores/radios que Prince
//   // v105: el cartel de actualizar aparece siempre (también tras Ctrl+F5 o si el SW viejo quedó trabado)
//   // v104: botones con el color de la app, letra blanca en modo claro, importar factura igual a Prince, lector de Devir
//   // v80: puerta "Despachado a courier" (en AR → courier → entregado), con courier y seguimiento; portal del cliente, resumen por dueño y puerta de emergencia.
//   // v79: perfil Editor (carga compras y productos; sin ventas, finanzas, configuración ni usuarios; no borra).
//   // v78: cuentas de cobro (Configuración), cuenta de destino en la venta, detalle, factura y filtro de ventas por medio/cuenta.
//   // v77: SKU asociados — códigos de otros proveedores por producto (ficha, buscadores e importar factura con sugerencias por nombre).
//   // v76: fecha de despacho editable en el remito U (botón de tracking), con las consignaciones que viajan en él; el remito U que sale de una compra con unidades de terceros toma la fecha del día en que se emite (antes heredaba la fecha de la factura). v75: fecha "de hoy" por defecto en hora local (antes UTC: de noche cargaba el día siguiente en remitos/despachos). v74: fix desplegables custom (filtros) que se cerraban solos al scrollear su lista / al reabrir con una opción de abajo tildada. v73: el PDF de productos pasa a ser "Catálogo / Catalog" (sin "Select" ni nombre de depósitos: se muestran por país). v72: envíos propios con seguimiento (remito U con estado: en camino / parcial / recibido, recepción por envío con bajas, recorrido en Remitos) + fix doble baja en merma de tránsito. v71: "Costo en destino" pasa a "Exportar PDF" con columnas a elección (cantidad / costo / precio). v70: PDF de costo en destino rehecho (horizontal, nombres en 2 renglones, SKU aparte, sin costo marcado). v69: se quitan "Importar JSON" y "Borrar todo" de Datos (queda Exportar JSON). v68: sin recarga doble en la primera visita + estilo de la carga en línea. v67: pantalla de carga al abrir (ya no se ve el menú vacío antes del login). v66: USD único + depósitos diferenciados + tracking + costos financieros

const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./configuracion.css",
  "./estetica.css",
  "./finanzas.css",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
  "./apple-touch-icon.png",
  "./favicon.png",
  "./js/00d-i18n-fin.js",
  "./js/00f-i18n-fin-select.js",
  "./js/01-core.js",
  "./js/02-engine.js",
  "./js/09-compat-fin.js",
  "./js/05-metrics.js",
  "./js/06-fpa.js",
  "./js/03-router.js",
  "./js/10-view-dashboard.js",
  "./js/11-view-analisis.js",
  "./js/11b-view-pnl.js",
  "./js/11c-view-resumen.js",
  "./js/11d-view-plan.js",
  "./js/11e-drill.js",
  "./js/11f-view-gastos.js",
  "./js/12-view-investments.js",
  "./js/13-view-productos.js",
  "./js/14-view-documentos.js",
  "./js/15-view-movimientos.js",
  "./js/16-view-datos.js",
  "./js/20-modal-producto.js",
  "./js/21-modal-documento.js",
  "./js/17-view-clientes.js",
  "./js/18-view-conjunta.js",
  "./js/19-view-remitos.js",
  "./js/30-pdf.js",
  "./js/31-export-pnl.js",
  "./js/31b-export-pnl-pro.js",
  "./js/32-importar-pdf.js",
  "./js/33-ficha-producto.js",
  "./js/34-datos-io.js",
  "./js/35-sku-asociados.js",
  "./js/36-cobros.js",
  "./js/37-editor.js",
  "./js/38-courier.js",
  "./js/39-stock-grupo.js",
  "./js/07-paises.js",
  "./js/17b-clientes-extra.js",
  "./js/42-moneda.js",
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
  if (e.data && e.data.type === "VERSION" && e.ports && e.ports[0]) e.ports[0].postMessage(CACHE);   // v105/v149: la app pregunta qué versión está activa
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

  // Nuestros propios .js, .css e ICONOS/imágenes: NETWORK-FIRST con copia en cache.
  // Antes los .png (incl. el logo icon-192/icon-512) caían en el bucket cache-first
  // de más abajo: al reemplazar el archivo con el MISMO nombre, el SW seguía sirviendo
  // el viejo hasta un hard refresh. Poniéndolos network-first, online siempre trae el
  // último y offline usa la última copia cacheada. Ése era el bug del logo.
  if (url.origin === self.location.origin && /\.(js|css|png|jpg|jpeg|svg|webp|ico)$/.test(url.pathname)) {
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
