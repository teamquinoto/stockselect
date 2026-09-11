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

### Flujo físico y acumulación de costos (las "puertas")
`Invoice → Swan/Miami → Tránsito/Buenos Aires → Entregado (Select/AR)`

El **operador** (la empresa dueña de la app) **paga la importación y compra en USA**; en Argentina **le cobra a SUS clientes** (las tiendas). Por eso el costo del producto **se va engrosando en cada tramo** y se **capitaliza al costo landed**:

| Puerta | Tramo | Costo que se suma |
|---|---|---|
| 1 | Invoice → Swan (Miami) | Product Cost + **US Freight** (neto + handling + flete de la compra) |
| 2 | Swan → Tránsito (Buenos Aires) | **Intl Freight + Wire Fees** (en *Send to transit*, total prorrateado) |
| 3 | Tránsito → **Entregado** (Select/AR) | **Arg Freight + local costs** (en *Deliver in AR*, total prorrateado) |

- La **compra nace "in transit"** y **recién impacta stock/FIFO al marcarla "received"**. Por eso se puede vender desde Swan y desde Select, pero **no** mientras está en el bucket de tránsito.
- `transferStock(origen, destino, cantidad, costoExtraUnit)` arrastra el **costo FIFO exacto** de cada capa y **suma el costo del tramo por unidad**, capitalizándolo (la misma carta "vale más" al avanzar). El operador carga el total del tramo y la app lo prorratea.
- Además del costo capitalizado, en la **venta** se pueden agregar **cargos on-top** que el cliente paga aparte (ver más abajo). Son cosas distintas: el costo engrosa el COGS; el cargo on-top es lo que el operador refactura.
- **Ver los costos por puerta:** cada capa FIFO guarda el desglose `{us, intl, arg}`. En la **ficha del producto** se ve el buildup en pantalla (US → +Intl → +Arg = Landed) y el botón **"⤓ Landed cost"** (Productos, admin) baja un **PDF** con el desglose por producto (promedio ponderado del stock en mano) y el valor total del inventario por puerta. El **kardex** también deja el `+$/u leg cost` en cada traslado.

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

**Vista por remito + quedarse para Select (2ª puerta propio/ajeno, en AR):** en **Third-party** la mercadería ajena se agrupa **por remito** (el envío/factura del que nació). Se toca un remito para expandirlo, se **tildan** las líneas que se quieran y se aplica la acción sólo a ese subconjunto (o a todo si no se tilda nada): **recibir en AR**, **entregar al dueño** o **quedarse para Select**. Este último (`quedarseParaSelect`) es la **segunda puerta**: al llegar a Argentina, parte de lo ajeno puede **ingresarse como stock vendible de Select** (entra al FIFO con su costo real; deja kardex). Baja las unidades de la consignación y, si queda en cero, la cierra. Lo que no se retiene sigue trazándose para el pasamanos al tercero.

**Remitos numerados (serie U / A).** Cada envío US → AR emite un **remito U** con correlativo automático (ej. `U 7215`), que nace en la compra de terceros y en *Send to transit*, y agrupa la vista de terceros. Si al llegar a AR el remito se **parte** (parte a Select, parte a terceros) se emite un **remito A** (ej. `A 2314`) que lista lo retenido para Select y **referencia el U de origen**. Si todo va al mismo destino (todo a Select o todo al tercero) **no** hay A: el U alcanza. El arranque de cada serie es configurable en *Data → Settings* (para empatar la numeración de papel). Ambos se bajan en PDF (`generarRemitoDocPDF`).

---

## Ventas: shipping, extra charges y margen

- **Customer shipping**: free o monto fijo.
- **Extra charges (on-top, facturados al cliente)**: lista simple concepto + monto que **suma al total que paga el cliente** (flete intl, wire fees, nacionalización, markup de servicio…). Aparece en el detalle y en el **PDF** de la factura. Como es plata que el cliente paga, **suma al margen neto**. Encaja con el flujo real: el **operador anticipa** toda la plata (compra + importación) y **cobra en Argentina** a las tiendas.
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
