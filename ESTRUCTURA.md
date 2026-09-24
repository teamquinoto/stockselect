# Estructura de la app (partida en módulos)

El `index.html` es una **cáscara** (~150 líneas): login, banner de entorno, topbar,
navs y los `<script>` en **orden fijo**. Todo el código vive en `styles.css` y en
`js/`. Editar un `.js` no cambia el orden de carga (lo manda el index).

> **El número del archivo es una etiqueta, no el orden.** El orden real de carga es
> el que dicta el `index.html` (la tabla de abajo respeta ese orden, no el numérico).
> Ej.: `20`/`21` cargan antes que `17`/`18`; `22-ui-modales` carga casi al final;
> `23-store` antes que `19-remitos`.

## Orden de carga (tal cual el index)

Antes de los módulos propios se cargan 3 libs de CDN: **pdf.js**, **jsPDF** y **SheetJS (xlsx)**.

| # | Archivo | Qué hace |
|---|---|---|
| 00b | `js/00b-i18n.js` | **Primero de todo.** Diccionarios EN/ES + `t(key,vars)`, `lang()`/`setLang()`, `applyStaticI18n()`. Cada vista suma sus claves acá. |
| 00c | `js/00c-icons.js` | Biblioteca de iconos SVG (`ICO.<clave>`, estilo Feather). Se carga antes de las vistas. |
| 01 | `js/01-core.js` | Config, estado, sesión, sync con el Worker, login, formatos, toast, **`withUndo`/`doUndo`**, **roles** (`admin`/`seller`/`store`), **depósitos Swan/Select + buckets `__transito`/`__inv`**, **moneda única USD** (`money(n)`, sin TC ni conversiones), **identidad por depósito** (`storeBadge`, `isDeposito`), **tracking** (`CARRIERS`, `trackingHTML`), **costos financieros** (`registrarCostoFinanciero`, `costosFinEnRango`), helpers de stock, helpers de venta (margen, comisión, `saleCargosCliente`/`saleNetMargin`), **remitos numerados** (`nextRemitoNum`/`crearRemito`, series U/A) |
| 02 | `js/02-engine.js` | Motor: `moverStock`, **FIFO por depósito** y **FIFO global** (venta), bóveda (`sendToInvestment`/`returnFromInvestment`), **`transferStock`** (arrastra el desglose `d:{us,intl,arg}` y capitaliza el costo del tramo) |
| 03 | `js/03-router.js` | Router de vistas + wireo del nav |
| 10 | `js/10-view-dashboard.js` | Panel / KPIs + tarjetas "Necesita tu atención" (reorder / tránsito / terceros) |
| 11 | `js/11-view-analisis.js` | Gráficos (donut, barras) + agregadores del P&L (`pnlAggregate` con foco por depósito, costos financieros y cierre por depósito; `pnlWaterfallSVG`, `trendChartSVG`) + panel **Resultado y costos financieros** (`finPanelHTML`/`wireFinPanel`) que reusa 11b |
| 11b | `js/11b-view-pnl.js` | **Pestaña P&L (admin).** Waterfall, tendencia, KPIs con delta vs período previo, tabla por vendedor con drill-down y panel **Real vs Presupuesto**. Presets `mtd/qtd/ytd/all` |
| 12 | `js/12-view-investments.js` | Bóveda de inversión (stock apartado, admin-only) |
| 13 | `js/13-view-productos.js` | Catálogo de productos |
| 14 | `js/14-view-documentos.js` | Listado de compras/ventas (View/Copy/**Edit**/Delete) |
| 15 | `js/15-view-movimientos.js` | Kardex global (admin) |
| 16 | `js/16-view-datos.js` | Import/export de datos + Settings; contiene el `wire()` global de vistas |
| 20 | `js/20-modal-producto.js` | Modal alta/edición de producto |
| 21 | `js/21-modal-documento.js` | **Modal de compra/venta**: líneas, picker de producto, costos adicionales (compra), **shipping + extra charges on-top (venta)**, total en vivo |
| 17 | `js/17-view-clientes.js` | Clientes; **build del doc de venta** (shipping, extra charges), `editDoc`/`copyDoc`/`verDoc`, **compra de terceros** (`confirmCompraTerceros`) y su edición (revert + recreate), revert/receive de compras |
| 18 | `js/18-view-conjunta.js` | Vista **Terceros/Tránsito**: consignaciones por remito (colapsable, selección parcial), `crearConsignacion`, **`openResolverAR`** (reparto en AR + dos remitos A), `quedarseParaSelect`, `openEnviarTransito`/`openRecibirTransito`/`openMermaTransito`, preview `= $/u` del costo por puerta |
| 24 | `js/24-emergencia.js` | **Puerta de emergencia (rescate, admin-only).** Revierte UN tramo del viaje (`Select→Barco`, `Barco→Miami`) descapitalizando el costo del tramo vía `d:{us,intl,arg}`; retroceso de estados de consignación. Motivo obligatorio + `withUndo` + traza. *Carga DESPUÉS de 18.* |
| 23 | `js/23-view-store.js` | **Portal read-only del rol `store`.** El cliente AR ve SOLO su mercadería en viaje US→AR y en qué puerta está. Sin acciones. (Reusa `rielHTML`/`CONSIGN_ESTADOS` de 18) |
| 19 | `js/19-view-remitos.js` | Vista **Remitos**: único lugar con todos los remitos numerados (`db.remitos`), series U/A, descarga PDF a demanda |
| 30 | `js/30-pdf.js` | **PDF de factura** (incluye extra charges) y **remitos numerados** (`generarRemitoDocPDF`: serie U/A con referencia de origen) |
| 31 | `js/31-export-pnl.js` | Export P&L |
| 32 | `js/32-importar-pdf.js` | Importar factura desde PDF (llama al Worker `/parse-invoice`) |
| 33 | `js/33-ficha-producto.js` | Ficha individual + kardex del producto + buildup de costo por puerta (US→+Intl→+Arg=Landed) |
| 34 | `js/34-datos-io.js` | Serialización de datos |
| 22 | `js/22-ui-modales.js` | Infra de modales (`buildModal`/`closeModal`), ajustes de stock. *Carga tarde, cerca del final.* |
| 90 | `js/90-boot.js` | Arranque, registro del SW, wire final |
| 91 | `js/91-onboarding.js` | Tour de bienvenida (primera vez, flag por usuario) + selector de idioma. Aditivo, self-contained, vive fuera de `#main` |

## Fuera de `js/`
- `index.html` — cáscara + orden de scripts.
- `styles.css` — estilos (incluye ocultar los steppers `▲▼` del scrollbar nativo).
- `sw.js` / `manifest.json` / iconos — PWA.
- `worker.js` — **API Cloudflare Worker + D1** (login firmado, `/state`, `/parse-invoice`, ABM `/users`, fact table + `/rollup`/`/reindex`). *No se carga desde el index; se despliega aparte en Cloudflare.* Ver README §Backend.

## Convenciones
- **Sin módulos ES:** todo global, en el orden del index. `const`/`let` de nivel superior quedan en el scope léxico global compartido entre scripts; las `function` cuelgan del global. Por eso el orden importa: un módulo puede usar constantes definidas por otro anterior (ej. `24` usa `CONSIGN_ORDEN` de `18`).
- `save()` persiste + dispara sync. Los buckets (`__transito`/`__inv`) **no** dejan kardex propio para no duplicar el saldo corrido.
- Cambios reversibles de un paso van envueltos en `withUndo(label, fn)` (toast "deshacer" 5s).
- Estado remoto con control de `rev` (optimista; 409 → merge/force).
- **i18n:** vista nueva = agregar sus claves a los dos diccionarios (`en`/`es`) de `00b` y envolver los textos en `t("...")`. `t()` cae al inglés y, si falta, a la clave cruda.
