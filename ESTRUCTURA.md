# Estructura de la app (partida en módulos)

Antes todo vivía dentro de `index.html` (~5.600 líneas). Ahora el `index.html`
quedó como una **cáscara** de ~150 líneas y todo el código está afuera, en
`styles.css` y en la carpeta `js/`. La app se comporta **exactamente igual** que
antes: es el mismo código, cortado en pedazos.

## Cómo carga

El `index.html` incluye los `<script>` en un **orden fijo**. Ese orden lo manda
el index y **no depende** de cómo editen los archivos. Editar el contenido de
cualquier `.js` no cambia el orden de carga.

Orden (tal cual está en el index):

1. `js/01-core.js` — config, estado, sesión, sync con el Worker, login, formatos, toast, helpers de stock
2. `js/02-engine.js` — motor de stock: moverStock, FIFO por tienda, FIFO global, bóveda, reposición
3. `js/03-router.js` — router de vistas + wireo del nav
4. `js/10-view-dashboard.js` — Panel / KPIs
5. `js/11-view-analisis.js` — gráficos (donut, barras)
6. `js/12-view-investments.js` — bóveda de inversión (admin)
7. `js/13-view-productos.js` — listado de productos
8. `js/14-view-documentos.js` — grilla de compras y ventas
9. `js/15-view-movimientos.js` — kardex / movimientos
10. `js/16-view-datos.js` — vista Datos (+ iconos SVG y utilidades UI)
11. `js/20-modal-producto.js` — alta/edición de producto
12. `js/21-modal-documento.js` — editor de factura (líneas) + ajuste de inventario + combobox de producto + alta de cliente
13. `js/17-view-clientes.js` — clientes (listado/edición/borrado) + revertir/copiar/ver documentos
13b. `js/18-view-conjunta.js` — **compra conjunta** (ingreso de comisión en especie) + vista de **tránsito** (recibir en AR / enviar a tránsito)
14. `js/30-pdf.js` — PDF de factura + lista de precios
15. `js/31-export-pnl.js` — export de P&L a Excel
16. `js/32-importar-pdf.js` — importar factura desde PDF
17. `js/33-ficha-producto.js` — ficha del producto (kardex individual) + mover a/desde bóveda
18. `js/34-datos-io.js` — export/import/reset de la base
19. `js/22-ui-modales.js` — modal genérico + field enhancers (dropdowns y calendario custom)
20. `js/90-boot.js` — **arranque** (login/tema/topbar) + service worker. **Va SIEMPRE último.**

> Nota: algunos archivos tienen funciones que "no son de su tema" (ej.: en
> `17-view-clientes.js` viven también funciones de revertir/copiar documentos).
> Es porque quedaron donde estaban físicamente en el código original. No importa
> para el funcionamiento: son definiciones de funciones, se ejecutan cuando el
> usuario hace algo, con todo ya cargado.

## Las 2 reglas de oro

1. **`90-boot.js` va último** y la lista de `<script>` del `index.html` **no se toca**.
   Todo lo demás son definiciones de funciones: podés editarlas libremente.
2. **Nada se declara dos veces.** Un mismo `const`/`let`/`function` con el mismo
   nombre en dos archivos rompe la app. Como salió de un único archivo, hoy no hay
   duplicados; cuidalo si copiás/pegás.

## Guard de arranque

`90-boot.js` chequea al arrancar que todos los `.js` hayan cargado. Si te
olvidaste de subir uno o le erraste al nombre, en vez de una app rota en silencio
vas a ver un cartel diciendo **cuál** archivo falta. Si agregás un archivo nuevo,
sumalo a la lista `REQ` del guard (una función testigo por archivo).

## Para no pisarse

- Cada uno edita **archivos distintos** (por eso están separadas las vistas).
- Si tocás una función que se usa en otro archivo (renombrar/borrar), avisale al otro.
- Lo ideal: usar **ramas + pull requests** en git en vez de subir pisando. Ahí git
  mergea solo lo que no se superpone.

## Service worker / cache (PWA)

`sw.js` está en **v53**. Los `.js` y `.css` son *network-first*: al editar y subir,
el cambio se ve al toque online; offline queda la última copia cacheada. Sólo si
querés refrescar el respaldo **offline** conviene subir el número de cache al final
del `sw.js`. Cuando agregás un `.js` nuevo, sumalo también a la lista `ASSETS`.

## Modelo de depósitos (importante)

Los **STORES** ya no son "sociedades con pool único de venta". Ahora son
**depósitos físicos reales**: `select` (Select · USA) y `swan` (Swan · AR). La
**venta ELIGE depósito** y el costo (COGS) sale del FIFO de *ese* depósito — el
stock de AR no se vende desde USA y viceversa.

Además hay un **bucket de tránsito** (`__transito`, fuera de `STORE_IDS`, igual
que la bóveda `__inv`): mercadería rumbo AR que **no es vendible** hasta recibirse
en Swan. Se ve en la vista *Joint/Transit* y en la ficha del producto, pero no
infla el stock vendible ni la valuación. La **compra conjunta** (comisión en
especie) carga sólo lo nuestro: unas unidades en Select y otras que **nacen en
tránsito** y pasan a Swan al recibirse (`transferStock`).

## Pendiente

- Conectar el Worker de Cloudflare (la URL del servidor está en `js/01-core.js`).

## Monedas (multi-moneda USD / ARS)

Cada **depósito** factura y valúa en su moneda: `select` en **USD**, `swan` en
**ARS** (el tránsito rumbo AR se valúa en USD hasta recibirse en Swan). Las capas
FIFO no llevan etiqueta de moneda: la moneda la define el depósito donde vive la
capa, así que alcanza con `storeCcy(store)`.

El **tipo de cambio** (`db.config.tc`, ARS por 1 US$) es **manual** y hoy único.
La **moneda de reporte** (`db.config.reportCcy`, default **USD**) se elige en
Configuración o con el toggle **Report in US$/AR$** de la barra superior, y es la
que usan los consolidados (dashboard, análisis, P&L, valuación): cada monto se
convierte a esa moneda con `convertCcy()`. Las vistas *deposit-scoped* (venta,
factura, ficha, tránsito) muestran la moneda nativa.

Helpers clave en `01-core.js`: `storeCcy`, `tc`, `reportCcy`, `convertCcy`,
`money(n, ccy)`, `moneyStore(n, store)`, `moneyRep(n, fromCcy)`. Los costos
adicionales de una venta pueden cargarse cada uno en su moneda (ej. venta en US$
con horas hombre en $) y se convierten al calcular el margen neto y el P&L.

**Pendiente conocido** (charlado con Juan): el TC único va a desactualizar
valuaciones históricas; más adelante conviene congelar el TC por operación /
tener TC por fecha. Los campos *mirror* `precioVenta` / `ultimoCosto` no tienen
moneda propia (son referencias rápidas): el precio/costo real es por depósito.
