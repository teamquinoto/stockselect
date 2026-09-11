# Estructura de la app (partida en módulos)

El `index.html` es una **cáscara** (~150 líneas): login, banner de entorno, topbar,
navs y los `<script>` en **orden fijo**. Todo el código vive en `styles.css` y en
`js/`. Editar un `.js` no cambia el orden de carga (lo manda el index).

## Orden de carga (tal cual el index)

| # | Archivo | Qué hace |
|---|---|---|
| 01 | `js/01-core.js` | Config, estado, sesión, sync con el Worker, login, formatos, toast, **depósitos Swan/Select + buckets `__transito`/`__inv`**, helpers de stock, helpers de venta (margen, comisión, **`saleCargosCliente`/`saleNetMargin`**), **remitos numerados** (`nextRemitoNum`/`crearRemito`, series U/A) |
| 02 | `js/02-engine.js` | Motor: `moverStock`, FIFO por depósito, **FIFO global** (venta), bóveda (`sendToInvestment`/`returnFromInvestment`), **`transferStock`** (con costo por tramo opcional) |
| 03 | `js/03-router.js` | Router de vistas + wireo del nav |
| 10 | `js/10-view-dashboard.js` | Panel / KPIs |
| 11 | `js/11-view-analisis.js` | Gráficos (donut, barras) |
| 12 | `js/12-view-investments.js` | Bóveda de inversión |
| 13 | `js/13-view-productos.js` | Catálogo de productos |
| 14 | `js/14-view-documentos.js` | Listado de compras/ventas (View/Copy/**Edit**/Delete) |
| 15 | `js/15-view-movimientos.js` | Kardex global (admin) |
| 16 | `js/16-view-datos.js` | Import/export de datos |
| 17 | `js/17-view-clientes.js` | Clientes; **build del doc de venta** (shipping, **extra charges**), `editDoc`/`copyDoc`/`verDoc`, **compra de terceros** (`confirmCompraTerceros`) y **edición de terceros** (revert + recreate), revert/receive de compras |
| 18 | `js/18-view-conjunta.js` | Vista **Third-party**: consignaciones agrupadas **por remito** (colapsable, con selección parcial de líneas), `crearConsignacion`, **`openResolverAR`** (reparto en AR: comisión → Select / dueño → entrega + cobro; emite dos remitos A en el split), `quedarseParaSelect`, preview `= $/u` del costo por puerta |
| 20 | `js/20-modal-producto.js` | Modal alta/edición de producto |
| 21 | `js/21-modal-documento.js` | **Modal de compra/venta**: líneas, picker de producto, costos adicionales (compra), **shipping + extra charges on-top (venta)**, total en vivo |
| 22 | `js/22-ui-modales.js` | Infra de modales, ajustes de stock |
| 30 | `js/30-pdf.js` | **PDF de factura** (incluye extra charges) y **remitos numerados** (`generarRemitoDocPDF`: serie U/A con referencia de origen) |
| 31 | `js/31-export-pnl.js` | Export P&L |
| 32 | `js/32-importar-pdf.js` | Importar factura desde PDF (llama al Worker `/parse-invoice`) |
| 33 | `js/33-ficha-producto.js` | Ficha individual + kardex del producto |
| 34 | `js/34-datos-io.js` | Serialización de datos |
| 90 | `js/90-boot.js` | Arranque, registro del SW, wire final |

## Fuera de `js/`
- `index.html` — cáscara + orden de scripts.
- `styles.css` — estilos (incluye ocultar los steppers `▲▼` del scrollbar nativo).
- `sw.js` / `manifest.json` / iconos — PWA.
- `worker.js` — **API Cloudflare Worker + D1** (login, `/state`, `/parse-invoice` con Gemini). *No se carga desde el index; se despliega aparte en Cloudflare.*

## Convenciones
- Sin módulos ES: todo global, en el orden del index.
- `save()` persiste + dispara sync. Los buckets (`__transito`/`__inv`) **no** dejan kardex propio para no duplicar el saldo corrido.
- Estado remoto con control de `rev` (optimista; 409 → merge/force).
