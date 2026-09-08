# Gestor de Stock

Gestor de inventario en **vanilla HTML/CSS/JS**, sin frameworks ni build. Todo vive en un único `index.html`. Las **compras suman** stock (por sociedad) y fijan el **último costo**; las **ventas restan** desde un **pool unificado** con costeo **FIFO global por fecha**; los **ajustes** corrigen a mano. Cada movimiento queda trazado en un **kardex**. Importa facturas en **PDF** (OCR con Gemini vía el Worker) y sincroniza entre dispositivos contra un backend en **Cloudflare Worker + D1**. Es una **PWA** instalable y usable offline.

---

## Cómo funciona

| Acción | Efecto en el stock |
|---|---|
| **Compra** | Suma unidades y actualiza el **último costo** del producto. Puede importarse desde PDF. |
| **Venta** | Resta unidades (valida que haya existencias) y registra el margen contra el costo del momento. |
| **Ajuste** | Corrección manual (mermas, recuentos, cargas iniciales). Reversible desde el kardex. |

- **Kardex:** cada entrada/salida/ajuste queda con fecha, cantidad, valor unitario, saldo y documento de origen. La ficha de cada producto muestra su kardex individual y una evolución del stock.
- **Sagas:** el sistema deriva la "línea/juego" desde el nombre del producto y la normaliza (unifica alias tipo *One Piece TCG* == *One Piece Card Game*) para filtrar sin duplicados.
- **Alertas:** un producto entra en la lista de reposición si está en **cero/negativo** o por debajo de su **punto de repedido**.

---

## Sociedades, stock unificado y FIFO global

El proveedor pone un **tope de compra por sociedad**, así que se compra con **varias sociedades** (Akira, Silver, y las que se sumen). Pero **el stock es uno solo para la venta**:

- Cada **compra** elige la **sociedad** que la hizo → eso define la **procedencia** de cada lote (podés ver cuánto vino por Akira y cuánto por Silver).
- La **venta NO elige sociedad**: sale del **pool unificado**. El costo se toma **FIFO global por fecha de entrada**, cruzando sociedades. Ejemplo: 10u compradas por Akira el día 1 + 40u por Silver el día 5; vendés 20 → toma 10 de Akira y 10 de Silver (COGS FIFO real). Akira queda en 0, Silver en 30.
- El **desglose por sociedad** (columnas en Dashboard/Productos) es sólo informativo y **admin-only**. El vendedor ve únicamente el stock total vendible.
- Escala solo a **más sociedades**: las columnas y el motor iteran la lista de sociedades, no están hardcodeadas.

## Perfiles y permisos

Dos roles, más el **modo Local** (sin login = acceso total):

| Capacidad | Admin | Vendedor (Teo, Tonio…) |
|---|---|---|
| Vender desde el pool unificado | ✓ | ✓ |
| Que la venta quede a su nombre (comisión) | ✓ (elige a quién) | ✓ (fijado a sí mismo) |
| Cargar compras / importar facturas | ✓ | — |
| Enviar/traer de Inversión | ✓ | — |
| Ajustes de inventario / ABM de productos | ✓ | — |
| Ver Análisis, P&L, Datos y comisiones de todos | ✓ | — |
| Ver sus propias ventas | ✓ (ve todas) | ✓ (sólo las suyas) |

- Los **vendedores son personas** (Teo, Tonio), **no sociedades** — se gestionan en **Data → Sellers**.
- En el listado de ventas (admin) la columna **"Sold by"** muestra quién vendió cada factura (punto 6).
- El control de permisos es **a nivel UI**: todos comparten el mismo token e inventario (`space: "main"`). Es suficiente para un equipo chico de confianza; no es un control criptográfico por usuario.

## Fechas

Todo el display de fechas usa **formato americano MM/DD/YYYY** (incluido el calendario y el kardex).

---

## Archivos

| Archivo | Qué es |
|---|---|
| `index.html` | La app entera (UI + lógica). Es lo único imprescindible para que corra. |
| `manifest.json` | Metadatos PWA para instalación. |
| `sw.js` | Service worker: cachea la app y pdf.js para uso offline. |
| `worker.js` | Backend opcional (Cloudflare Worker): login + API de estado con control de `rev`. |
| `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` | Íconos de la PWA. |
| `apple-touch-icon.png` | Ícono para "Agregar a inicio" en iOS. |
| `favicon.png`, `favicon-32.png` | Favicons. |

> Para probarla sola, con abrir `index.html` alcanza (modo Local, sin sincronización). Los demás archivos son para que sea **instalable, offline y multi-dispositivo**.

---

## Deploy de la app (GitHub Pages)

1. Subí todos los archivos a la raíz del repo (o a `/docs`).
2. **Settings → Pages → Branch `main`** (carpeta raíz o `/docs`).
3. Entrá a la URL publicada. En el celu: **Compartir → Agregar a inicio** y queda como app nativa.

---

## Versionado del service worker

Cada vez que tocás `index.html`, **subí el string de versión** en `sw.js` y pusheá los dos juntos:

```js
const CACHE = "mayor-stock-v34";  // -> "mayor-stock-v35", etc.
```

Si no, `index.html` es *network-first* (trae la última si hay internet), pero conviene bumpear igual por prolijidad y para invalidar el cache de estáticos. También está el `build vNN` en la pantalla de login como referencia visual rápida de qué versión estás corriendo.

---

## Import de PDF

- Reconoce el formato tipo **Coqui Hobby** (`SKU: descripción … QTY UOM MSRP NET EXT`): toma **NET PRICE** como costo y **MSRP** como precio de venta sugerido, y excluye el flete del stock.
- Si el layout no matchea, cae a una detección genérica línea por línea.
- **Siempre** muestra una tabla editable + el texto crudo extraído **antes** de impactar stock. Revisá antes de confirmar: los formatos varían.
- Se procesa 100% en el navegador; el PDF no se sube a ningún lado.

---

## Backend opcional (Cloudflare Worker + D1)

Por defecto todo vive en `localStorage` (modo **Local**, offline). Para tener **el mismo stock desde la PC y el celu**, el `worker.js` expone una API mínima con **login por usuario/contraseña** y control de versión optimista.

### Endpoints

| Método | Ruta | Qué hace |
|---|---|---|
| `POST` | `/login` `{user, pass}` | Valida el usuario y devuelve `{token, space, role, vendedorId, name}`. |
| `POST` | `/parse-invoice` `{pdf, mime}` | OCR de una factura de compra con Gemini (requiere Bearer y `GEMINI_KEY`). |
| `GET` | `/state?space=…` | Lee el estado (requiere `Authorization: Bearer <token>`). |
| `PUT` | `/state?space=…` | Guarda con control de `rev`; si cambió en el servidor, responde **409 Conflicto**. |

### Secrets necesarios

| Secret | Para qué |
|---|---|
| `TOKEN` | Bearer interno que la app usa para leer/escribir el estado. |
| `ADMIN_USER` | Usuario admin (login legacy, sigue funcionando). |
| `ADMIN_PASS` | Contraseña del admin. |
| `USERS` *(opcional)* | JSON con los **vendedores** (y admins extra). Ver abajo. |
| `GEMINI_KEY` *(opcional)* | Key de Google AI para el OCR de facturas (`/parse-invoice`). |

### Vendedores (perfiles Teo/Tonio)

Los **vendedores son personas, no sociedades**. Para que Teo y Tonio inicien sesión en su propio celu, definí el secret `USERS` como un JSON. Cada seller lleva un `id` que debe **coincidir** con el id del vendedor en **Data → Sellers** (ahí se le atribuye la comisión):

```json
[
  { "user": "tonio", "pass": "…", "role": "admin" },
  { "user": "teo",   "pass": "…", "role": "seller", "id": "teo",   "name": "Teo" },
  { "user": "tonio-v","pass": "…", "role": "seller", "id": "tonio", "name": "Tonio" }
]
```

- `role: "admin"` → acceso total (compras, inversión, análisis, ve comisiones de todos).
- `role: "seller"` → vende desde el pool unificado; cada venta queda a su nombre; **no** carga compras ni manda a inversión, y sólo ve **sus** ventas.
- Todos comparten el mismo token e inventario (`space: "main"`): **el stock es uno solo**. Los permisos se aplican a nivel UI.

### `wrangler.toml` mínimo

El Worker **crea la tabla solo** (`CREATE TABLE IF NOT EXISTS estado …`), así que no hace falta correr un `schema.sql`. Solo necesitás el binding D1 llamado `DB`:

```toml
name = "mayor-stock-api"
main = "worker.js"
compatibility_date = "2024-01-01"

[[d1_databases]]
binding = "DB"
database_name = "mayor-stock"
database_id = "PEGÁ-ACÁ-EL-ID"
```

### Deploy del backend (una vez)

```bash
npm i -g wrangler
wrangler login

# 1) Crear la base D1 y pegar el database_id en wrangler.toml
wrangler d1 create mayor-stock

# 2) Definir los secrets (uno por comando, te los pide interactivo)
wrangler secret put TOKEN
wrangler secret put ADMIN_USER
wrangler secret put ADMIN_PASS
wrangler secret put USERS         # opcional: vendedores Teo/Tonio (JSON)
wrangler secret put GEMINI_KEY    # opcional: OCR de facturas

# 3) Publicar
wrangler deploy
```

Te queda una URL tipo `https://mayor-stock-api.TU-USUARIO.workers.dev`. Esa URL va en la constante `API_URL` del `index.html`:

```js
const API_URL = "https://mayor-stock-api.TU-USUARIO.workers.dev";
```

### Entrar

Abrís la app, cargás **usuario y contraseña** (los `ADMIN_USER`/`ADMIN_PASS`) y listo: el primer dispositivo sube su estado, los demás lo traen. La sesión (usuario, token y espacio) queda guardada en `localStorage`.

---

## Datos, sincronización y conflictos

- La app **siempre guarda en local** primero (seguís trabajando sin conexión) y, si hay sesión, empuja/trae el estado completo.
- Control de versión optimista con `rev`: si desde la última sync cambió **acá y en el servidor**, la app avisa **Conflicto** y elegís cuál conservar. Si solo cambió de un lado, sincroniza sola.
- Con `space` podés tener **inventarios separados** en el mismo servidor (`main`, `us`, `europa`, etc.).
- El indicador de estado (**Local / Sincronizado / Guardando / Sin conexión / Conflicto**) está en la barra superior y lateral.

> El `token` viaja en el header `Authorization: Bearer`. Al ser un secreto compartido, tratá la URL + credenciales como una contraseña.

### Respaldo extra

Aun con servidor, **Datos → Exportar JSON** te da una copia puntual. **Importar JSON** reemplaza el estado actual (y se sincroniza si estás conectado).

---

## Stack y decisiones

- **Sin dependencias de build.** Un solo HTML, service worker y (opcional) un Worker. Fácil de auditar y de deployar en Pages.
- **`localStorage` como fuente local** + backend como espejo sincronizado, no al revés: la app nunca depende de estar online.
- **pdf.js** por CDN (cacheado por el SW) solo para el import de facturas.
- **Temas claro/oscuro** con `prefers-color-scheme` y override manual persistido.
