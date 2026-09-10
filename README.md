# Stock Select

Gestor de inventario **cross-border (USA ↔ AR)** en **vanilla HTML/CSS/JS**, sin frameworks ni build. El `index.html` es una cáscara y todo el código vive en `styles.css` + la carpeta `js/`. Las **compras suman** stock por depósito y fijan el **último costo (landed)**; las **ventas restan** con costeo **FIFO global por fecha**; los **ajustes** corrigen a mano. Todo queda trazado en un **kardex**. Importa facturas en **PDF** (OCR con Gemini vía el Worker) y sincroniza entre dispositivos contra un backend en **Cloudflare Worker + D1**. Es una **PWA** instalable y offline-first.

---

## Modelo cross-border: depósitos y buckets

Dos **depósitos reales** (vendibles), cada uno factura/valúa en su moneda:

| Depósito | Dónde | Moneda |
|---|---|---|
| **Swan** | USA (Miami) | USD |
| **Select** | Argentina | ARS |

Dos **buckets** (NO vendibles, no cuentan como stock ni inflan valuación):

- **`__transito`** — mercadería en viaje US → AR. Nace del lado US (USD).
- **`__inv`** — bóveda de inversión: stock apartado con trazabilidad de costo, fuera del pool de venta.

### Flujo físico y costos
`Invoice → Swan/Miami → (tránsito) → Select/AR`

- La **compra nace "in transit"** y **recién impacta stock/FIFO al marcarla "received"**. Por eso se puede vender desde Swan y desde Select, pero **no** mientras está en el bucket de tránsito.
- El **costo landed** de la compra prorratea **handling + flete** sobre las unidades (primer `$` del diagrama: Product Cost + US Freight).
- `transferStock(origen, destino, cantidad, costoExtraUnit)` mueve entre depósitos/buckets arrastrando el **costo FIFO exacto** de cada capa y permite **sumar un costo por tramo** (`costoExtraUnit`). **Hoy el default es 0**: los tramos International Freight + Wire Fees y Arg Freight + Arg Costs **los paga el cliente** (ver *Extra charges* abajo), no se capitalizan al COGS.

---

## Stock unificado y FIFO global

- Cada **compra** elige el **depósito** que la hizo → define la **procedencia** del lote.
- La **venta elige depósito** (Swan o Select) y descuenta de ahí; el **COGS** se toma **FIFO por fecha de entrada**.
- El desglose por depósito (columnas Dashboard/Productos) es **admin-only**.
- Base **legacy** Akira/Silver → se remapea automático a Select/Swan (idempotente).

---

## Compras propias vs. de terceros

Una compra puede ser **`propia`** (todo entra a stock) o **`terceros`**. En terceros cada línea se parte:

- **Ours** → unidades que nos quedamos: entran como compra normal (nacen en tránsito, a stock al recibir).
- **Resto** → sigue viaje al **dueño**: nace como **consignación** (tracked US → AR → entregado). NO toca stock, FIFO, valuación ni P&L. Se sigue en la vista **Third-party** por estado.

**Editar una factura de terceros (soportado):** al guardar la edición se **revierte** la compra previa + sus consignaciones **en tránsito** y se **recrea** todo. Si alguna consignación ya avanzó (llegó a AR / se entregó = hecho físico), la edición se bloquea y hay que borrar.

---

## Ventas: shipping, extra charges y margen

- **Customer shipping**: free o monto fijo.
- **Extra charges (on-top, facturados al cliente)**: lista simple concepto + monto que **suma al total que paga el cliente** (flete intl, wire fees, nacionalización, markup de servicio…). Aparece en el detalle y en el **PDF** de la factura. Como es plata que el cliente paga, **suma al margen neto**. Pensado para el flujo en que el cliente **anticipa** todo y **cobra en AR**.
- **Selling costs** (admin): envío/ShipStation, horas-hombre, comisión manual, otro. **Restan** del margen (no se capitalizan al stock).
- **Comisión del vendedor**: `% sobre el margen`, congelada por venta.
- **Margen neto** = margen FIFO − comisión − selling costs **+ extra charges**.

---

## Perfiles y permisos

- **admin**: todo (compras, finanzas, datos, comisiones, columnas por depósito).
- **seller**: vende y ve stock total; **no** ve costos, comisiones ni desglose por depósito.

---

## Backend (Cloudflare Worker + D1)

Worker independiente con su propia base D1 y secrets. Endpoints:

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/` · `/health` | Vida (sin token) |
| POST | `/login` | user/pass → token, role, vendedorId |
| POST | `/parse-invoice` | PDF → Gemini OCR → líneas (Bearer) |
| GET/PUT | `/state?space=…` | Lee/guarda estado con control de `rev` (Bearer) |

**Secrets/vars:** `TOKEN`, `USERS` (JSON) o `ADMIN_USER/PASS`, `GEMINI_KEY`, `ALLOWED_ORIGINS` (opc). **Binding:** `DB` (D1).

### OCR de facturas — rendimiento
El parseo usa Gemini con **thinking apagado** (`thinkingConfig.thinkingBudget: 0`), modelos rápidos reales **`gemini-2.5-flash-lite` → `gemini-2.5-flash`**, `maxOutputTokens` capado y **timeout de 45s por intento** (AbortController). Con esto una factura se resuelve en **segundos**. *(Antes tardaba minutos porque usaba modelos inexistentes y el campo de thinking equivocado — el modelo "pensaba" por default.)*

---

## PWA / Sync
- Instalable, offline-first (`sw.js` + `manifest.json`).
- Estado sincronizado contra `/state` con control optimista de revisión (`rev`, 409 → merge/force).
