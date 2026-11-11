/* ============================================================
   Stock Select — API (Cloudflare Worker + D1)   [stockselect]
   ------------------------------------------------------------
   Login firmado, usuarios, parse-invoice, /state con proyección por
   rol + FACT TABLE derivado (aditivo y fail-safe: si algo del fact
   table falla, el guardado del blob NO se rompe; el blob sigue siendo
   la fuente de verdad).

     1) En cada PUT /state, después de guardar el blob, el Worker
        DERIVA sales_header / sales_line para ese space (borra e
        inserta). Lee el COGS FIFO ya congelado por línea
        (doc.lineas[].cogs), así reconcilia EXACTO con la pantalla.
     2) GET  /rollup?desde=&hasta=  (admin) -> agregaciones server-side
        (P&L con costos financieros y resultado, por depósito, por mes,
        por vendedor, por producto).
     3) POST /reindex?space=main  (admin) -> backfill: re-deriva desde
        el blob ya guardado.

   LECTURA DE FACTURAS (oct 2026, portado de Prince Collections v6-v8):
     /parse-invoice acepta { texto } (lo que la app ya sacó del PDF) o
     { pdf }. Cascada de modelos "rápido primero, verificado": si la
     lectura no CUADRA contra el total de la factura, prueba el siguiente.
     Pensamiento al mínimo por familia, esquema fijo, tope de tiempo,
     key en header. Modelos configurables con la variable GEMINI_MODELS.
     La app primero intenta leer LOCAL (sin IA) y sólo llama acá si no
     reconoce el formato o el usuario lo pide.

   STOCK DEL GRUPO (nov 2026): /grupo/stock (entre servidores, con
   GRUPO_KEY) y /grupo/consolidado (admin/editor). Variables: GRUPO_KEY
   (secreto), GRUPO_PEER_URL (dirección del servidor de Prince) y,
   opcional, GRUPO_NOMBRE. Sin costos ni precios.

   DESPACHO A COURIER (nov 2026): el portal del cliente (rol store) recibe
   courier, seguimiento y fechas de las líneas despachadas.

   PERFIL EDITOR (nov 2026 · v94): equipo de Argentina. Carga compras y
   ventas del depósito Select (y lee facturas con IA), crea/edita productos y
   ajusta el stock de Argentina. Al guardar, el servidor deja todo lo de EE.UU.
   (ventas, compras, stock, logística) como estaba y rechaza bajas de compras,
   ventas, productos o clientes. Nunca puede forzar.

   MONEDA ÚNICA: USD. Todo el sistema opera en dólares; no hay tipo de
   cambio ni conversiones. (La tabla fx_month de la etapa bimoneda se
   elimina sola en el primer ensureFacts.)
   ============================================================ */

const APP_NAME = "stockselect";
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30;   // 30 días
const PBKDF2_ITERS = 100000;

/* ---------------- CORS ---------------- */
function cors(env, req) {
  const origin = (req && req.headers.get("Origin")) || "";
  const list = String(env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
  let allow = "*";
  if (list.length) allow = list.includes(origin) ? origin : list[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, PUT, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400"
  };
}
function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "Content-Type": "application/json", ...(headers || {}) }
  });
}

/* ---------------- Helpers de bytes / base64url ---------------- */
function b64url(input) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlToBytes(s) {
  s = String(s).replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function hex(buf) { return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join(""); }
function hexToBytes(h) {
  const m = String(h).match(/../g) || [];
  return new Uint8Array(m.map(x => parseInt(x, 16)));
}

/* ---------------- TOKEN FIRMADO (HMAC-SHA256) ---------------- */
async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function signToken(env, payload) {
  const body = b64url(JSON.stringify(payload));
  const key = await hmacKey(env.AUTH_SECRET);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return body + "." + b64url(sig);
}
async function verifyToken(env, token) {
  if (!token || token.indexOf(".") < 0) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  let ok = false;
  try {
    const key = await hmacKey(env.AUTH_SECRET);
    ok = await crypto.subtle.verify("HMAC", key, b64urlToBytes(sig), new TextEncoder().encode(body));
  } catch (_) { return null; }
  if (!ok) return null;
  let p;
  try { p = JSON.parse(new TextDecoder().decode(b64urlToBytes(body))); } catch (_) { return null; }
  if (p.exp && Date.now() > Number(p.exp)) return null;
  return p;
}

/* ---------------- Hash de contraseñas (PBKDF2) ---------------- */
function randSaltHex(n = 16) { const a = new Uint8Array(n); crypto.getRandomValues(a); return hex(a); }
async function pbkdf2(pass, saltHex) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), { name: "PBKDF2" }, false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: hexToBytes(saltHex), iterations: PBKDF2_ITERS, hash: "SHA-256" }, key, 256);
  return hex(bits);
}
async function verifyPass(pass, saltHex, hashHex) {
  if (!saltHex || !hashHex) return false;
  const calc = await pbkdf2(String(pass), saltHex);
  if (calc.length !== hashHex.length) return false;
  let diff = 0;
  for (let i = 0; i < calc.length; i++) diff |= calc.charCodeAt(i) ^ hashHex.charCodeAt(i);
  return diff === 0;
}

function normRole(r) { r = String(r || "").toLowerCase(); return (r === "admin" || r === "store" || r === "editor") ? r : "seller"; }   // nov 2026: + editor
/* Perfil EDITOR · equipo de ARGENTINA (nov 2026, v94 de la app).
   Carga compras y ventas del depósito Select, crea/edita productos y ajusta el
   stock de Argentina. Sobre la versión en la que trabajó (ref = lo que hay en la base):
   - Lo que no le corresponde (configuración, gastos, plan, logística de EE.UU.…)
     vuelve a como estaba.
   - Ventas y compras de EE.UU.: quedan exactamente como estaban (no las puede crear,
     cambiar ni borrar). Las de Argentina las puede crear y editar, no borrar.
   - Productos: puede crear y editar; el stock y las capas FIFO de todo lo que no sea
     Argentina vuelven a como estaban. No puede borrar productos ni clientes.
   - Movimientos: los de EE.UU. quedan como estaban; los de Argentina, los del editor.
   Devuelve {es, en} si hay que rechazar, o null si se puede seguir (mio queda corregido). */
const EDITOR_STORE = "select";
const EDITOR_RESTAURA = ["config", "gastos", "fpa", "stockSnaps", "solicitudes", "presupuesto",
                         "conjuntas", "remitos", "consignaciones", "costosFinancieros"];
const EDITOR_SIN_BAJAS = ["compras", "ventas", "productos", "clientes"];
const _clon = x => JSON.parse(JSON.stringify(x));
function _esAR(col, d) {
  if (!d) return false;
  if (col === "ventas") return String(d.storeVenta || d.store || "") === EDITOR_STORE;
  return String(d.store || "") === EDITOR_STORE;                       // compras
}
/* Docs de EE.UU. tal cual estaban; los de Argentina, los del editor. */
function _mergeDocs(col, ref, mio) {
  const R = Array.isArray(ref[col]) ? ref[col] : [];
  const M = Array.isArray(mio[col]) ? mio[col] : [];
  const refById = new Map(R.filter(d => d && d.id).map(d => [d.id, d]));
  const out = [], vistos = new Set();
  for (const d of M) {
    if (!d || !d.id) continue;
    const viejo = refById.get(d.id);
    if (viejo && !_esAR(col, viejo)) out.push(_clon(viejo));      // de EE.UU.: no se toca
    else if (viejo || _esAR(col, d)) out.push(d);                  // de Argentina: se acepta
    else continue;                                                 // alta nueva de EE.UU.: se ignora
    vistos.add(d.id);
  }
  for (const d of R) if (d && d.id && !vistos.has(d.id) && !_esAR(col, d)) out.push(_clon(d));   // EE.UU. que faltaba
  mio[col] = out;
}
function _stockProducto(ref, p) {
  const spt = p.stockPorTienda = (p.stockPorTienda && typeof p.stockPorTienda === "object") ? p.stockPorTienda : {};
  const lot = p.lotes = (p.lotes && typeof p.lotes === "object") ? p.lotes : {};
  const rs = (ref && ref.stockPorTienda) || {}, rl = (ref && ref.lotes) || {};
  const claves = new Set([...Object.keys(spt), ...Object.keys(rs), ...Object.keys(lot), ...Object.keys(rl)]);
  for (const k of claves) {
    if (k === EDITOR_STORE) continue;
    if (rs[k] !== undefined) spt[k] = _clon(rs[k]); else if (ref) delete spt[k]; else spt[k] = 0;
    if (rl[k] !== undefined) lot[k] = _clon(rl[k]); else if (ref) delete lot[k]; else lot[k] = [];
  }
  // total vendible = suma de depósitos (los "__" son tránsito / bóveda)
  p.stock = Object.keys(spt).filter(k => !k.startsWith("__")).reduce((a, k) => a + (Number(spt[k]) || 0), 0);
}
function protegerEditor(ref, mio) {
  if (!ref || !mio) return { es: "No hay una versión base para comparar.", en: "No base version to compare." };
  for (const col of EDITOR_SIN_BAJAS) {
    const tiene = new Set((Array.isArray(mio[col]) ? mio[col] : []).map(d => d && d.id));
    const faltan = (Array.isArray(ref[col]) ? ref[col] : []).filter(d => d && d.id && !tiene.has(d.id));
    const _EN = { ventas:"sales", compras:"purchases", productos:"products", clientes:"customers" };
    if (faltan.length) return { es: `El perfil Editor no puede borrar ${col} (${faltan.length}).`, en: `The Editor profile can't delete ${_EN[col]||col} (${faltan.length}).` };
  }
  for (const k of EDITOR_RESTAURA) {
    if (ref[k] !== undefined) mio[k] = _clon(ref[k]);
    else delete mio[k];
  }
  _mergeDocs("ventas", ref, mio);
  _mergeDocs("compras", ref, mio);
  const refProd = new Map((Array.isArray(ref.productos) ? ref.productos : []).filter(p => p && p.id).map(p => [p.id, p]));
  for (const p of (Array.isArray(mio.productos) ? mio.productos : [])) if (p && p.id) _stockProducto(refProd.get(p.id) || null, p);
  // movimientos: los de EE.UU. como estaban; los de Argentina, los del editor
  // (editar una venta/compra de Argentina rehace sus movimientos)
  const esMovAR = m => m && String(m.store || "") === EDITOR_STORE;
  const RM = Array.isArray(ref.movimientos) ? ref.movimientos : [];
  const MM = Array.isArray(mio.movimientos) ? mio.movimientos : [];
  mio.movimientos = _clon(RM.filter(m => m && !esMovAR(m))).concat(MM.filter(esMovAR))
    .sort((a, b) => String(a.fecha || "").localeCompare(String(b.fecha || "")));
  return null;
}

/* QUIÉN CARGÓ CADA DOCUMENTO (compras y ventas): lo pone el servidor.
   Doc nuevo → el usuario que lo guardó. Doc que ya existía → conserva el autor
   que tenía (nadie lo puede cambiar desde la app). Los docs viejos quedan sin autor. */
function marcarAutor(prev, next, user) {
  for (const col of ["compras", "ventas"]) {
    const pm = new Map(((prev && prev[col]) || []).map(d => [d && d.id, d]));
    for (const d of (next[col] || [])) {
      if (!d || typeof d !== "object") continue;
      const p = pm.get(d.id);
      if (p) { if (p.cargadoPor) d.cargadoPor = p.cargadoPor; else delete d.cargadoPor; }
      else if (user) d.cargadoPor = String(user);
    }
  }
}
/* Perfil EDITOR: sólo edita las compras y ventas que cargó él, salvo que el admin le
   haya dado el permiso "editar lo de otros" (usuarios.edita_otros). Marcar una compra
   como recibida no cuenta como edición. Devuelve el primer doc ajeno modificado o null. */
const ED_IGNORA = new Set(["srvRev", "status", "cargadoPor"]);
function edCanon(x) {
  if (x === undefined) return "u";
  if (x === null || typeof x !== "object") return JSON.stringify(x);
  if (Array.isArray(x)) return "[" + x.map(edCanon).join(",") + "]";
  // vacío = ausente: la app completa campos viejos al abrir (p. ej. vendedor "" → null) y eso no es una edición
  return "{" + Object.keys(x).filter(k => !ED_IGNORA.has(k) && x[k] !== undefined && x[k] !== null && x[k] !== "").sort()
    .map(k => JSON.stringify(k) + ":" + edCanon(x[k])).join(",") + "}";
}
function editorAjeno(ref, mio, user, cols) {
  const yo = String(user || "").toLowerCase();
  for (const col of cols) {
    const rm = new Map(((ref && ref[col]) || []).map(d => [d && d.id, d]));
    for (const d of (mio[col] || [])) {
      const r = d && rm.get(d.id);
      if (!r || String(r.cargadoPor || "").toLowerCase() === yo) continue;
      if (edCanon(r) !== edCanon(d)) return { col, numero: r.numero || r.id, quien: r.cargadoPor || "" };
    }
  }
  return null;
}
function msgAjeno(a) {
  const es = a.col === "ventas" ? "las ventas" : "las compras", en = a.col === "ventas" ? "sales" : "purchases";
  const esDoc = (a.col === "ventas" ? "La venta " : "La compra ") + a.numero, enDoc = (a.col === "ventas" ? "Sale " : "Purchase ") + a.numero;
  return { es: `Sólo podés editar ${es} que cargaste vos. ${esDoc} ${a.quien ? "la cargó " + a.quien : "es anterior a este control"}. Pedile a un administrador que la cambie o que te dé permiso.`,
           en: `You can only edit ${en} you entered. ${enDoc} ${a.quien ? "was entered by " + a.quien : "predates this control"}. Ask an administrator to change it or to grant you permission.` };
}

async function ensureUsuarios(env) {
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS usuarios (user TEXT PRIMARY KEY, pass_hash TEXT, salt TEXT, role TEXT NOT NULL DEFAULT 'seller', vendedor_id TEXT, cliente_id TEXT, name TEXT, created_at TEXT)"
  ).run();
  // permiso del editor para editar documentos que cargaron otros (0 = sólo los suyos); si ya existe, falla y se ignora
  try { await env.DB.prepare("ALTER TABLE usuarios ADD COLUMN edita_otros INTEGER NOT NULL DEFAULT 0").run(); } catch (_) {}
}
async function editaOtros(env, user) {
  try {
    await ensureUsuarios(env);
    const row = await env.DB.prepare("SELECT role, edita_otros FROM usuarios WHERE user = ?").bind(String(user || "")).first();
    return !!(row && normRole(row.role) === "editor" && Number(row.edita_otros || 0));
  } catch (_) { return false; }
}

/* ============================================================
   FACT TABLE — derivación desde el blob (mismo cálculo que el front)
   Todos los montos en USD.
   ============================================================ */
function num(x) { return +x || 0; }
function r2(n) { return Math.round((+n || 0) * 100) / 100; }
function lineCogs(l) { return (l && l.cogs != null) ? num(l.cogs) : num(l && l.costo) * num(l && l.cantidad); }
function normDate(s) {
  s = String(s || "");
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + "-" + m[2] + "-" + m[3];
  const d = new Date(s);
  if (!isNaN(d)) return d.toISOString().slice(0, 10);
  return "";
}

async function ensureFacts(env) {
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS sales_header (space TEXT NOT NULL, venta_id TEXT NOT NULL, fecha TEXT NOT NULL, mes TEXT NOT NULL, store TEXT, ccy TEXT, vendedor_id TEXT, pais TEXT, shipping_nat REAL DEFAULT 0, cargos_nat REAL DEFAULT 0, commission_nat REAL DEFAULT 0, costos_nat REAL DEFAULT 0, PRIMARY KEY (space, venta_id))"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS sales_line (space TEXT NOT NULL, venta_id TEXT NOT NULL, linea_idx INTEGER NOT NULL, mes TEXT NOT NULL, ccy TEXT, vendedor_id TEXT, producto_id TEXT, sku TEXT, nombre TEXT, cantidad REAL DEFAULT 0, revenue_nat REAL DEFAULT 0, cogs_nat REAL DEFAULT 0, PRIMARY KEY (space, venta_id, linea_idx))"),
    env.DB.prepare("DROP TABLE IF EXISTS fx_month"),   // resto de la etapa bimoneda (derivada, se puede borrar)
    env.DB.prepare("CREATE TABLE IF NOT EXISTS fin_cost (space TEXT NOT NULL, id TEXT NOT NULL, fecha TEXT NOT NULL, mes TEXT NOT NULL, store TEXT, concepto TEXT, monto REAL DEFAULT 0, auto INTEGER DEFAULT 0, PRIMARY KEY (space, id))"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_fc_mes ON fin_cost(space, mes)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_sl_mes ON sales_line(space, mes)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_sl_vend ON sales_line(space, vendedor_id)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_sh_mes ON sales_header(space, mes)")
  ]);
}

/* Corre statements en tandas (D1 limita el tamaño del batch). Los DELETE
   van primero en el array, así el orden borra-antes-de-insertar se respeta. */
async function runBatched(env, stmts, size) {
  size = size || 40;
  for (let i = 0; i < stmts.length; i += size) {
    await env.DB.batch(stmts.slice(i, i + size));
  }
}

async function deriveFacts(env, space, data) {
  await ensureFacts(env);
  const ventas = Array.isArray(data && data.ventas) ? data.ventas : [];
  const cfg = (data && data.config) || {};
  const defComm = (parseFloat(cfg.commissionRate) >= 0) ? parseFloat(cfg.commissionRate) : 0;

  const stmts = [];
  stmts.push(env.DB.prepare("DELETE FROM sales_line   WHERE space=?").bind(space));
  stmts.push(env.DB.prepare("DELETE FROM sales_header WHERE space=?").bind(space));
  stmts.push(env.DB.prepare("DELETE FROM fin_cost     WHERE space=?").bind(space));

  let meses = new Set();

  for (const v of ventas) {
    const vid = String((v && v.id) || "");
    if (!vid) continue;
    const fecha = normDate(v && v.fecha);
    if (!fecha) continue;
    const mes = fecha.slice(0, 7);
    meses.add(mes);

    const store = String((v && (v.storeVenta || v.store)) || "");
    const vend = String((v && v.vendedorId) || "");
    const lineas = Array.isArray(v && v.lineas) ? v.lineas : [];

    let margin = 0;
    lineas.forEach(l => { margin += num(l.precio) * num(l.cantidad) - lineCogs(l); });
    const rate = (v && v.commissionRate != null) ? num(v.commissionRate) : defComm;
    const commission = r2(margin * rate);
    const shipping = (v && v.envio && v.envio.tipo === "monto") ? r2(num(v.envio.monto)) : 0;
    const cargos = r2(((v && v.cargosCliente) || []).reduce((a, c) => a + num(c.monto), 0));
    const costos = r2(((v && v.costosExtra) || []).reduce((a, c) => a + num(c && c.monto), 0));

    stmts.push(env.DB.prepare(
      "INSERT INTO sales_header (space,venta_id,fecha,mes,store,ccy,vendedor_id,pais,shipping_nat,cargos_nat,commission_nat,costos_nat) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
    ).bind(space, vid, fecha, mes, store, "USD", vend, "", shipping, cargos, commission, costos));

    lineas.forEach((l, i) => {
      const rev = r2(num(l.precio) * num(l.cantidad));
      const cg = r2(lineCogs(l));
      stmts.push(env.DB.prepare(
        "INSERT INTO sales_line (space,venta_id,linea_idx,mes,ccy,vendedor_id,producto_id,sku,nombre,cantidad,revenue_nat,cogs_nat) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
      ).bind(space, vid, i, mes, "USD", vend, String(l.productoId || ""), String(l.sku || ""), String(l.nombre || ""), num(l.cantidad), rev, cg));
    });
  }

  // Costos financieros (no capitalizados: van a resultados debajo de la contribución)
  const fins = Array.isArray(data && data.costosFinancieros) ? data.costosFinancieros : [];
  let nFin = 0;
  for (const e of fins) {
    const id = String((e && e.id) || ""); const fecha = normDate(e && e.fecha);
    if (!id || !fecha) continue;
    nFin++;
    stmts.push(env.DB.prepare(
      "INSERT INTO fin_cost (space,id,fecha,mes,store,concepto,monto,auto) VALUES (?,?,?,?,?,?,?,?)"
    ).bind(space, id, fecha, fecha.slice(0, 7), String((e && e.store) || ""), String((e && e.concepto) || ""), r2(num(e && e.monto)), (e && e.auto) ? 1 : 0));
  }

  await runBatched(env, stmts, 40);
  return { ventas: ventas.length, meses: meses.size, costosFinancieros: nFin };
}

async function rollup(env, space, desde, hasta) {
  await ensureFacts(env);
  const D0 = desde || "0000-01-01", D1 = hasta || "9999-12-31";

  // ---- Totales (líneas: ventas, cogs, unidades) ----
  const tl = await env.DB.prepare(
    "SELECT COALESCE(SUM(l.revenue_nat),0) sales, COALESCE(SUM(l.cogs_nat),0) cogs, COALESCE(SUM(l.cantidad),0) units " +
    "FROM sales_line l JOIN sales_header h ON h.space=l.space AND h.venta_id=l.venta_id " +
    "WHERE l.space=? AND h.fecha BETWEEN ? AND ?"
  ).bind(space, D0, D1).first();

  // ---- Totales (headers: shipping, cargos, comisión, selling costs) ----
  const th = await env.DB.prepare(
    "SELECT COALESCE(SUM(h.shipping_nat),0) shipping, COALESCE(SUM(h.cargos_nat),0) cargos, " +
    "COALESCE(SUM(h.commission_nat),0) commission, COALESCE(SUM(h.costos_nat),0) costos " +
    "FROM sales_header h WHERE h.space=? AND h.fecha BETWEEN ? AND ?"
  ).bind(space, D0, D1).first();

  // ---- Costos financieros del período ----
  const tf = await env.DB.prepare(
    "SELECT COALESCE(SUM(monto),0) fin FROM fin_cost WHERE space=? AND fecha BETWEEN ? AND ?"
  ).bind(space, D0, D1).first();

  const sales = num(tl.sales), cogs = num(tl.cogs), units = num(tl.units);
  const shipping = num(th.shipping), cargos = num(th.cargos), commission = num(th.commission), costos = num(th.costos);
  const financieros = r2(num(tf && tf.fin));
  const net = r2(sales + shipping + cargos), gp = r2(net - cogs), contrib = r2(gp - commission - costos);
  const resultado = r2(contrib - financieros);
  const totals = {
    sales: r2(sales), shipping: r2(shipping), cargos: r2(cargos), cogs: r2(cogs),
    commission: r2(commission), costos: r2(costos), units,
    net, gp, contrib, financieros, resultado,
    gpPct: net > 0 ? gp / net : 0, contribPct: net > 0 ? contrib / net : 0, resultadoPct: net > 0 ? resultado / net : 0
  };

  // ---- Por depósito (Swan vs Select) ----
  const dl = await env.DB.prepare(
    "SELECT h.store store, SUM(l.revenue_nat) sales, SUM(l.cogs_nat) cogs, SUM(l.cantidad) units " +
    "FROM sales_line l JOIN sales_header h ON h.space=l.space AND h.venta_id=l.venta_id " +
    "WHERE l.space=? AND h.fecha BETWEEN ? AND ? GROUP BY h.store"
  ).bind(space, D0, D1).all();
  const dh = await env.DB.prepare(
    "SELECT h.store store, SUM(h.shipping_nat+h.cargos_nat) addrev, SUM(h.commission_nat+h.costos_nat) costs " +
    "FROM sales_header h WHERE h.space=? AND h.fecha BETWEEN ? AND ? GROUP BY h.store"
  ).bind(space, D0, D1).all();
  const df = await env.DB.prepare(
    "SELECT store, SUM(monto) fin FROM fin_cost WHERE space=? AND fecha BETWEEN ? AND ? GROUP BY store"
  ).bind(space, D0, D1).all();
  const bs = {};
  const bsGet = k => (bs[k] = bs[k] || { store: k, sales: 0, cogs: 0, units: 0, addrev: 0, costs: 0, financieros: 0 });
  (dl.results || []).forEach(r => { const e = bsGet(r.store || ""); e.sales = num(r.sales); e.cogs = num(r.cogs); e.units = num(r.units); });
  (dh.results || []).forEach(r => { const e = bsGet(r.store || ""); e.addrev = num(r.addrev); e.costs = num(r.costs); });
  (df.results || []).forEach(r => { const e = bsGet(r.store || ""); e.financieros = num(r.fin); });   // store "" = financieros generales
  const byStore = Object.values(bs).map(e => {
    const n = r2(e.sales + e.addrev), g = r2(n - e.cogs), c = r2(g - e.costs);
    return { store: e.store, units: e.units, net: n, cogs: r2(e.cogs), gp: g, contrib: c, financieros: r2(e.financieros), resultado: r2(c - e.financieros) };
  });

  // ---- Por mes (tendencia) ----
  const ml = await env.DB.prepare(
    "SELECT l.mes mes, SUM(l.revenue_nat) sales, SUM(l.cogs_nat) cogs " +
    "FROM sales_line l JOIN sales_header h ON h.space=l.space AND h.venta_id=l.venta_id " +
    "WHERE l.space=? AND h.fecha BETWEEN ? AND ? GROUP BY l.mes"
  ).bind(space, D0, D1).all();
  const mh = await env.DB.prepare(
    "SELECT h.mes mes, SUM(h.shipping_nat+h.cargos_nat) addrev, SUM(h.commission_nat+h.costos_nat) costs " +
    "FROM sales_header h WHERE h.space=? AND h.fecha BETWEEN ? AND ? GROUP BY h.mes"
  ).bind(space, D0, D1).all();
  const mm = {};
  (ml.results || []).forEach(r => { const e = mm[r.mes] = mm[r.mes] || { sales: 0, cogs: 0, addrev: 0, costs: 0 }; e.sales = num(r.sales); e.cogs = num(r.cogs); });
  (mh.results || []).forEach(r => { const e = mm[r.mes] = mm[r.mes] || { sales: 0, cogs: 0, addrev: 0, costs: 0 }; e.addrev = num(r.addrev); e.costs = num(r.costs); });
  const byMonth = Object.keys(mm).sort().map(mes => { const x = mm[mes]; const n = x.sales + x.addrev; return { mes, net: r2(n), contrib: r2(n - x.cogs - x.costs) }; });

  // ---- Por vendedor ----
  const sl = await env.DB.prepare(
    "SELECT l.vendedor_id vid, SUM(l.cantidad) units, SUM(l.revenue_nat) revenue, SUM(l.cogs_nat) cogs " +
    "FROM sales_line l JOIN sales_header h ON h.space=l.space AND h.venta_id=l.venta_id " +
    "WHERE l.space=? AND h.fecha BETWEEN ? AND ? GROUP BY l.vendedor_id"
  ).bind(space, D0, D1).all();
  const sh = await env.DB.prepare(
    "SELECT h.vendedor_id vid, SUM(h.cargos_nat) cargos, SUM(h.shipping_nat) shipping, SUM(h.commission_nat) commission, SUM(h.costos_nat) costos " +
    "FROM sales_header h WHERE h.space=? AND h.fecha BETWEEN ? AND ? GROUP BY h.vendedor_id"
  ).bind(space, D0, D1).all();
  const sv = {};
  (sl.results || []).forEach(r => { const e = sv[r.vid] = sv[r.vid] || { vid: r.vid, units: 0, revenue: 0, cogs: 0, cargos: 0, shipping: 0, commission: 0, costos: 0 }; e.units = num(r.units); e.revenue = num(r.revenue); e.cogs = num(r.cogs); });
  (sh.results || []).forEach(r => { const e = sv[r.vid] = sv[r.vid] || { vid: r.vid, units: 0, revenue: 0, cogs: 0, cargos: 0, shipping: 0, commission: 0, costos: 0 }; e.cargos = num(r.cargos); e.shipping = num(r.shipping); e.commission = num(r.commission); e.costos = num(r.costos); });
  const bySeller = Object.values(sv).map(e => {
    const gm = e.revenue - e.cogs;
    const c = r2(gm + e.cargos + e.shipping - e.commission - e.costos);
    return { vid: e.vid, units: e.units, revenue: r2(e.revenue), cogs: r2(e.cogs), gm: r2(gm), contrib: c };
  }).sort((a, b) => b.contrib - a.contrib);

  // ---- Por producto (margen bruto) ----
  const pl = await env.DB.prepare(
    "SELECT l.producto_id pid, MAX(l.sku) sku, MAX(l.nombre) nombre, SUM(l.cantidad) units, SUM(l.revenue_nat) revenue, SUM(l.cogs_nat) cogs " +
    "FROM sales_line l JOIN sales_header h ON h.space=l.space AND h.venta_id=l.venta_id " +
    "WHERE l.space=? AND h.fecha BETWEEN ? AND ? GROUP BY l.producto_id"
  ).bind(space, D0, D1).all();
  const byProduct = (pl.results || []).map(r => ({
    pid: r.pid, sku: r.sku, nombre: r.nombre, units: num(r.units),
    revenue: r2(num(r.revenue)), cogs: r2(num(r.cogs)), gm: r2(num(r.revenue) - num(r.cogs))
  })).sort((a, b) => b.gm - a.gm);

  return { ok: true, ccy: "USD", desde: D0, hasta: D1, totals, byStore, byMonth, bySeller, byProduct };
}

/* ============================================================
   v6 · LECTURA DE FACTURAS CON IA (Gemini) — más rápida
   ------------------------------------------------------------
   Por qué tardaba: los Gemini Flash "piensan" antes de responder y
   por defecto lo hacen en nivel MEDIO. Para copiar la tabla de una
   factura no hace falta razonar: ese pensamiento era la mayor parte
   de la espera (y además se cobra como salida).
   · Pensamiento al mínimo que admite cada modelo (iaPensamiento).
   · Esquema fijo de respuesta (responseSchema): Gemini no puede
     devolver JSON roto. Antes, un JSON roto = leer TODO de nuevo
     con el modelo siguiente (doble espera).
   · Tope de tiempo por intento: si un modelo se cuelga, se pasa al
     siguiente en vez de esperar sin fin.
   · Si un modelo rechaza un parámetro (400), se reintenta UNA vez
     sin ese parámetro en vez de saltar de modelo.
   · Modelos configurables con la variable GEMINI_MODELS (lista
     separada por comas) sin tocar código.
   ============================================================ */
// Verificados contra ListModels de la key (oct 2026). El más rápido primero; 2.5 de red de seguridad.
const IA_MODELOS_DEF = ["gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-3.7-flash", "gemini-2.5-flash"];
const IA_TIMEOUT_MS = 30000;          // v8: tope por intento (antes 45 s)
const IA_TOTAL_MS = 70000;            // v8: tope TOTAL de la lectura, sumando todos los modelos
const IA_TRANSITORIOS = [429, 500, 502, 503, 504];
const IA_PROMPT =
  "You are reading a purchase invoice. Extract its data. " +
  "'precio' = net unit price; 'cantidad' = qty; 'msrp' = suggested retail price if present, else 0; " +
  "'sku' = code before the colon; 'flete' = freight/shipping charge (not inside lineas); " +
  "'cargos' = sum of other non-product charges such as handling fees (not inside lineas); " +
  "'impuestos' = tax total; 'total' = invoice grand total; unknown = 0 or \"\". " +
  "'fecha' = the INVOICE date as YYYY-MM-DD. Numeric dates on these invoices are US format " +
  "MM/DD/YYYY (07/01/2026 is July 1, 2026, never January 7). " +
  "Copy every product line exactly as printed, in order. Do not invent lines.";
const IA_SCHEMA = {
  type: "OBJECT",
  properties: {
    numero: { type: "STRING" },
    fecha: { type: "STRING" },
    proveedor: { type: "STRING" },
    moneda: { type: "STRING" },
    flete: { type: "NUMBER" },
    cargos: { type: "NUMBER" },
    impuestos: { type: "NUMBER" },
    total: { type: "NUMBER" },
    lineas: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          sku: { type: "STRING" },
          nombre: { type: "STRING" },
          cantidad: { type: "NUMBER" },
          precio: { type: "NUMBER" },
          msrp: { type: "NUMBER" }
        },
        required: ["sku", "nombre", "cantidad", "precio"],
        propertyOrdering: ["sku", "nombre", "cantidad", "precio", "msrp"]
      }
    }
  },
  required: ["lineas"],
  propertyOrdering: ["numero", "fecha", "proveedor", "moneda", "lineas", "flete", "cargos", "impuestos", "total"]
};

function iaModelos(env) {
  const l = String(env.GEMINI_MODELS || "").split(",").map(s => s.trim()).filter(Boolean);
  return l.length ? l : IA_MODELOS_DEF;
}
/* Nivel de pensamiento más bajo que acepta cada familia (docs de Google, sep 2026):
   3.7 / 3.8 Flash y los Pro: "low" (no admiten "minimal") · 3 / 3.5 / 3.6 Flash y Flash-Lite:
   "minimal" · 2.5: presupuesto 0 (apagado). */
function iaPensamiento(model) {
  if (/^gemini-2\.5/.test(model)) return { thinkingBudget: 0 };
  if (/flash-lite|^gemini-3(\.[56])?-flash/.test(model)) return { thinkingLevel: "minimal" };
  return { thinkingLevel: "low" };
}
/* v8: ¿la lectura cierra contra el total de la factura? Sin total, no se puede verificar (se acepta). */
function iaCuadre(data) {
  const lineas = (Array.isArray(data && data.lineas) ? data.lineas : [])
    .reduce((a, l) => a + (Number(l.cantidad) || 0) * (Number(l.precio) || 0), 0);
  const suma = r2(lineas + (Number(data.flete) || 0) + (Number(data.cargos) || 0) + (Number(data.impuestos) || 0));
  const total = r2(Number(data && data.total) || 0);
  const tol = Math.max(0.05, total * 0.001);
  const ok = !total || Math.abs(total - suma) <= tol || Math.abs(total - r2(lineas)) <= tol;
  return { ok, suma, total, verificable: !!total };
}
async function iaLlamar(env, model, cuerpo, limiteMs) {
  const ac = new AbortController();
  const corte = setTimeout(() => ac.abort(), Math.max(1000, Math.min(IA_TIMEOUT_MS, limiteMs || IA_TIMEOUT_MS)));
  try {
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent", {
      method: "POST", signal: ac.signal,
      // La key va en un header: en la URL queda escrita en logs de proxies y errores.
      headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_KEY },
      body: JSON.stringify(cuerpo)
    });
    let j = null;
    try { j = await res.json(); } catch (_) {}
    return { ok: res.ok, status: res.status, j };
  } catch (e) {
    const timeout = e && e.name === "AbortError";
    return { ok: false, status: 0, j: null, red: timeout ? "timeout" : ("network: " + String((e && e.message) || e)) };
  } finally {
    clearTimeout(corte);
  }
}
async function leerFacturaIA(env, parteDoc) {
  const t0 = Date.now();
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let lastErr = "sin respuesta del modelo";
  let respaldo = null;                              // mejor lectura que NO cuadró (por si ninguna cuadra)
  const errores = [];                               // un error por modelo, para saber cuál falló y por qué
  for (const model of iaModelos(env)) {
    if (Date.now() - t0 > IA_TOTAL_MS - 5000) { lastErr = "tiempo total agotado (" + Math.round((Date.now() - t0) / 1000) + " s)"; break; }
    let pensamiento = iaPensamiento(model);
    let esquema = true;
    let reintentoTransitorio = false;
    for (let intento = 1; intento <= 4; intento++) {
      const gen = { temperature: 0, responseMimeType: "application/json" };
      if (esquema) gen.responseSchema = IA_SCHEMA;
      if (pensamiento) gen.thinkingConfig = pensamiento;
      const tIntento = Date.now();
      const r = await iaLlamar(env, model, {
        contents: [{ parts: [{ text: IA_PROMPT }, parteDoc] }],
        generationConfig: gen
      }, IA_TOTAL_MS - (Date.now() - t0));
      if (!r.ok) console.log(`parse-invoice intento · ${model} · ${Date.now() - tIntento} ms · ${r.red || ("HTTP " + r.status + " " + ((r.j && r.j.error && r.j.error.message) || "")).slice(0, 200)}`);
      if (r.ok) {
        let text = "";
        try { text = r.j.candidates[0].content.parts.filter(p => !p.thought).map(p => p.text || "").join(""); } catch (_) { text = ""; }
        try {
          const data = JSON.parse(text.replace(/[`]{3}json|[`]{3}/g, "").trim());
          const u = (r.j && r.j.usageMetadata) || {};
          const ms = Date.now() - t0;
          const c = iaCuadre(data);
          console.log(`parse-invoice ${c.ok ? "ok" : "NO CUADRA"} · ${model} · ${parteDoc.text ? "texto" : "pdf"} · ${ms} ms · pensamiento ${u.thoughtsTokenCount || 0} tok · salida ${u.candidatesTokenCount || 0} tok · ${(data.lineas || []).length} líneas · ${c.suma} vs ${c.total}`);
          if (c.ok) return { ok: true, data, model, ms, cuadra: c.verificable ? true : null, suma: c.suma, total: c.total };
          // Si ninguno cuadra, se devuelve la lectura que quedó MÁS CERCA del total.
          if (!respaldo || Math.abs(c.total - c.suma) < Math.abs(respaldo.total - respaldo.suma)) {
            respaldo = { ok: true, data, model, ms, cuadra: false, suma: c.suma, total: c.total };
          }
          lastErr = "no cuadra (" + model + ")";
          break;                                     // probamos el modelo siguiente
        } catch (_) { lastErr = "could not parse model output (" + model + ")"; break; }
      }
      if (r.red) {                                   // timeout o corte de red
        lastErr = r.red + " (" + model + ")";
        if (r.red === "timeout" || reintentoTransitorio) break;
        reintentoTransitorio = true; await sleep(600); continue;
      }
      const msg = (r.j && r.j.error && r.j.error.message) || ("HTTP " + r.status);
      lastErr = msg + " (" + model + ")";
      // El modelo no admite un parámetro: se reintenta el MISMO modelo sin ese parámetro.
      if (r.status === 400 && pensamiento && /think/i.test(msg)) { pensamiento = null; continue; }
      if (r.status === 400 && esquema && /schema/i.test(msg)) { esquema = false; continue; }
      if (IA_TRANSITORIOS.includes(r.status) && !reintentoTransitorio) { reintentoTransitorio = true; await sleep(700); continue; }
      break;                                         // 404 (modelo inexistente) u otro: al siguiente
    }
    errores.push(lastErr);
  }
  if (respaldo) { respaldo.ms = Date.now() - t0; return respaldo; }
  console.log(`parse-invoice FALLÓ · ${Date.now() - t0} ms · ${lastErr}`);
  if (errores[errores.length - 1] !== lastErr) errores.push(lastErr);   // p. ej. tiempo total agotado
  return { ok: false, error: errores.join(" | ") };
}

/* ============================================================
   PROYECCIÓN — CLIENTE (store): sólo sus consignaciones.
   ============================================================ */
/* LISTA CERRADA de campos: la tienda ve SU mercadería, en qué puerta está y el
   tracking del envío. NUNCA costos (costoUnit, courier, financiero), notas
   internas, ni líneas de otros dueños: con el costo acumulado podría deducir
   el markup. Cualquier campo nuevo queda afuera salvo que se agregue acá. */
function projectStore(data, identity) {
  const cid = String(identity.store || "").trim();
  const consigs = Array.isArray(data && data.consignaciones) ? data.consignaciones : [];
  const mias = cid ? consigs.filter(cs => String(cs.terceroId || "") === cid) : [];
  const safeCs = mias.map(cs => ({
    id: cs.id, fecha: cs.fecha || "", terceroId: cs.terceroId || "",
    remitoId: cs.remitoId || null, remitoCodigo: cs.remitoCodigo || "", envioRef: cs.envioRef || "",
    productoId: cs.productoId || null, sku: cs.sku || "", nombre: cs.nombre || "",
    cantidad: num(cs.cantidad), estado: cs.estado || "",
    // nov 2026 · despacho a courier: sólo courier, seguimiento y fechas (nunca costos)
    despacho: cs.despacho ? { carrier: String(cs.despacho.carrier || ""), tracking: String(cs.despacho.tracking || ""),
                              fecha: String(cs.despacho.fecha || ""), entregado: String(cs.despacho.entregado || "") } : null,
    historial: (Array.isArray(cs.historial) ? cs.historial : []).map(h => ({ estado: h.estado || "", fecha: h.fecha || "" }))
  }));
  // Remitos U de sus envíos: sólo identificación + tracking (sin líneas ni montos).
  const ids = new Set(safeCs.map(cs => cs.remitoId).filter(Boolean));
  const remitos = (Array.isArray(data && data.remitos) ? data.remitos : [])
    .filter(r => ids.has(r.id))
    .map(r => ({ id: r.id, letra: r.letra || "U", numero: r.numero, codigo: r.codigo || "", fecha: r.fecha || "", tracking: r.tracking || "", carrier: r.carrier || "", lineas: [] }));
  return { config: {}, consignaciones: safeCs, remitos };
}

/* ============================================================
   STOCK DEL GRUPO (Prince + Select · nov 2026) — sólo lectura
   ------------------------------------------------------------
   - GET /grupo/stock (servidor ↔ servidor): devuelve el stock de esta
     app SIN costos ni precios. Exige el header X-Grupo-Key = GRUPO_KEY
     (secreto compartido entre los dos Workers, 16+ caracteres).
   - GET /grupo/consolidado (usuarios admin/editor logueados): junta el
     stock propio con el de la otra app (GRUPO_PEER_URL) y lo devuelve.
     El navegador nunca ve la clave ni habla con la otra app.
   Si GRUPO_KEY o GRUPO_PEER_URL no están configurados, la otra app
   figura "no conectada" y todo lo demás sigue igual.
   Cada producto lleva además upc = unidades por caja de su ficha (0 si no
   tiene), para que la app pueda mostrar el stock del grupo en cajas.
   ============================================================ */
function grupoCodigos(p) {
  const extra = Array.isArray(p && p.skusAsoc) ? p.skusAsoc.map(x => x && x.sku) : [];
  return [p && p.sku, ...extra].map(s => String(s || "").trim()).filter(Boolean).slice(0, 20);
}
function grupoClaveOk(env, req) {
  const k = String(env.GRUPO_KEY || ""), h = String(req.headers.get("X-Grupo-Key") || "");
  if (k.length < 16 || h.length !== k.length) return false;
  let d = 0; for (let i = 0; i < k.length; i++) d |= k.charCodeAt(i) ^ h.charCodeAt(i);
  return d === 0;
}
async function grupoPeer(env) {
  const base = String(env.GRUPO_PEER_URL || "").replace(/\/+$/, "");
  if (!base || String(env.GRUPO_KEY || "").length < 16) return { app: "", error: "no-config" };
  const ac = new AbortController(); const corte = setTimeout(() => ac.abort(), 8000);
  try {
    const r = await fetch(base + "/grupo/stock", { headers: { "X-Grupo-Key": env.GRUPO_KEY }, signal: ac.signal });
    if (!r.ok) return { app: "", error: "http " + r.status };
    const j = await r.json();
    return j && j.ok ? j.data : { app: "", error: "respuesta inválida" };
  } catch (e) { return { app: "", error: (e && e.name === "AbortError") ? "timeout" : "sin conexión" }; }
  finally { clearTimeout(corte); }
}

/* Select: depósitos Swan (USA) y Select (AR); en tránsito = bucket "__transito". */
async function grupoPropio(env) {
  const row = env.DB ? await env.DB.prepare("SELECT data, updated_at FROM estado WHERE space = ?").bind("main").first() : null;
  let d = null; try { d = row ? JSON.parse(row.data) : null; } catch (_) { d = null; }
  const deps = [{ id: "swan", nombre: "Swan" }, { id: "select", nombre: "Select" }];
  const productos = [];
  for (const p of ((d && d.productos) || [])) {
    if (!p || !p.id) continue;
    const spt = p.stockPorTienda || {};
    const stock = {}; let tot = 0;
    for (const dp of deps) { const n = Math.max(0, Number(spt[dp.id]) || 0); stock[dp.id] = n; tot += n; }
    const tr = Math.max(0, Number(spt.__transito) || 0);
    if (tot <= 0 && tr <= 0) continue;
    productos.push({ codigos: grupoCodigos(p), sku: String(p.sku || ""), nombre: String(p.nombre || ""), juego: String(p.categoria || ""),
                     idioma: String(p.idioma || ""), stock, transito: tr, upc: Number(p.boxesPorCase) > 0 ? Number(p.boxesPorCase) : 0 });
  }
  return { app: String(env.GRUPO_NOMBRE || "Select").slice(0, 40), depositos: deps, productos, updated_at: row ? row.updated_at : null };
}
/* ---------------- Resolución de identidad en /login ---------------- */
function resolveUserSecret(env, user, pass) {
  if (env.USERS) {
    let list = [];
    try { list = JSON.parse(env.USERS); } catch (_) { list = []; }
    const u = list.find(x => String(x.user) === user && String(x.pass) === pass);
    if (u) {
      const role = normRole(u.role);
      if (role === "seller") return { user, role, vendedorId: String(u.id || u.user || user).trim().toLowerCase(), store: "", name: u.name || user };
      if (role === "store") return { user, role, vendedorId: "", store: String(u.clienteId || u.store || u.terceroId || "").trim(), name: u.name || user };
      return { user, role, vendedorId: "", store: "", name: u.name || user };
    }
  }
  if (env.ADMIN_USER && env.ADMIN_PASS && user === env.ADMIN_USER && pass === env.ADMIN_PASS) {
    return { user, role: "admin", vendedorId: "", store: "", name: env.ADMIN_USER };
  }
  return null;
}
async function resolveUserDB(env, user, pass) {
  if (env.DB) {
    try {
      await ensureUsuarios(env);
      const row = await env.DB.prepare("SELECT * FROM usuarios WHERE user = ?").bind(user).first();
      if (row) {
        const ok = await verifyPass(pass, row.salt, row.pass_hash);
        if (!ok) return null;
        const role = normRole(row.role);
        return {
          user: row.user, role,
          vendedorId: role === "seller" ? String(row.vendedor_id || row.user).trim().toLowerCase() : "",
          store: role === "store" ? String(row.cliente_id || "").trim() : "",
          name: row.name || row.user,
          editaOtros: role === "editor" && !!Number(row.edita_otros || 0)
        };
      }
    } catch (_) { /* si falla la tabla, caemos al secret */ }
  }
  return resolveUserSecret(env, user, pass);
}

export default {
  async fetch(req, env) {
    const CORS = cors(env, req);
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

    try {
      const url = new URL(req.url);
      const path = url.pathname.replace(/\/+$/, "");

      // ---------- HEALTH (sin token) ----------
      if (path === "" || path === "/health") {
        return json({ ok: true, app: APP_NAME, ts: new Date().toISOString() }, 200, CORS);
      }

      // ---------- LOGIN (sin Bearer) ----------
      if (path === "/login") {
        if (req.method !== "POST") return json({ error: "use POST" }, 405, CORS);
        if (!env.AUTH_SECRET) return json({ error: "config: missing AUTH_SECRET secret" }, 500, CORS);
        let b;
        try { b = await req.json(); } catch { return json({ error: "invalid JSON" }, 400, CORS); }
        const user = String((b && b.user) || "").trim();
        const pass = String((b && b.pass) || "");
        const u = await resolveUserDB(env, user, pass);
        if (!u) return json({ error: "wrong user or password" }, 401, CORS);

        const token = await signToken(env, {
          u: u.user, role: u.role, vid: u.vendedorId || "", store: u.store || "",
          exp: Date.now() + TOKEN_TTL_MS
        });
        return json({
          ok: true, user: u.user, role: u.role,
          vendedorId: u.vendedorId || "", store: u.store || "",
          name: u.name || u.user, token, space: "main", editaOtros: !!u.editaOtros
        }, 200, CORS);
      }

      // ---------- STOCK DEL GRUPO · servidor ↔ servidor (clave compartida, sin costos) ----------
      if (path === "/grupo/stock") {
        if (req.method !== "GET") return json({ error: "use GET" }, 405, CORS);
        if (!grupoClaveOk(env, req)) return json({ error: "forbidden" }, 403, CORS);
        return json({ ok: true, data: await grupoPropio(env) }, 200, CORS);
      }

      // ---------- De acá en más: token firmado obligatorio ----------
      if (!env.AUTH_SECRET) return json({ error: "config: missing AUTH_SECRET secret" }, 500, CORS);
      const auth = req.headers.get("Authorization") || "";
      const raw = auth.replace(/^Bearer\s+/i, "").trim();
      const identity = await verifyToken(env, raw);
      if (!identity) return json({ error: "not authorized" }, 401, CORS);
      const role = identity.role || "admin";

      // ---------- STOCK DEL GRUPO · vista consolidada (admin / editor) ----------
      if (path === "/grupo/consolidado") {
        if (req.method !== "GET") return json({ error: "use GET" }, 405, CORS);
        if (role !== "admin" && role !== "editor") return json({ error: "forbidden" }, 403, CORS);
        const [propio, otro] = await Promise.all([grupoPropio(env), grupoPeer(env)]);
        return json({ ok: true, apps: [propio, otro] }, 200, CORS);
      }

      // ---------- USUARIOS (ABM, sólo admin) ----------
      if (path === "/users") {
        if (role !== "admin") return json({ error: "forbidden" }, 403, CORS);
        if (!env.DB) return json({ error: "config: missing D1 binding 'DB'" }, 500, CORS);
        await ensureUsuarios(env);

        if (req.method === "GET") {
          const { results } = await env.DB.prepare(
            "SELECT user, role, vendedor_id, cliente_id, name, created_at, edita_otros FROM usuarios ORDER BY user"
          ).all();
          const users = (results || []).map(r => ({
            user: r.user, role: r.role, vendedorId: r.vendedor_id || "",
            clienteId: r.cliente_id || "", name: r.name || "", createdAt: r.created_at || "",
            editaOtros: normRole(r.role) === "editor" && !!Number(r.edita_otros || 0)
          }));
          return json({ ok: true, users }, 200, CORS);
        }

        if (req.method === "POST") {
          let b;
          try { b = await req.json(); } catch { return json({ error: "invalid JSON" }, 400, CORS); }
          const u = String((b && b.user) || "").trim().toLowerCase();
          const r = normRole(b && b.role);
          if (!u) return json({ error: "missing user" }, 400, CORS);
          if (r === "store" && !String((b && b.clienteId) || "").trim()) {
            return json({ error: "store user needs clienteId" }, 400, CORS);
          }
          const existing = await env.DB.prepare(
            "SELECT user, pass_hash, salt, created_at, edita_otros FROM usuarios WHERE user = ?"
          ).bind(u).first();
          if (!existing && !(b && b.pass)) return json({ error: "new user needs a password" }, 400, CORS);

          let salt = existing ? existing.salt : "";
          let hash = existing ? existing.pass_hash : "";
          if (b && b.pass) { salt = randSaltHex(); hash = await pbkdf2(String(b.pass), salt); }

          const vendedorId = r === "seller" ? String((b && b.vendedorId) || u).trim().toLowerCase() : "";
          const clienteId = r === "store" ? String((b && b.clienteId) || "").trim() : "";
          const name = String((b && b.name) || u).trim();
          const createdAt = existing ? (existing.created_at || new Date().toISOString()) : new Date().toISOString();

          // permiso "editar lo de otros" (sólo perfil Editor). Si no viene en el pedido, se conserva.
          const eo = r !== "editor" ? 0 : ((b && b.editaOtros !== undefined) ? (b.editaOtros ? 1 : 0) : Number((existing && existing.edita_otros) || 0));
          await env.DB.prepare(
            "INSERT INTO usuarios (user, pass_hash, salt, role, vendedor_id, cliente_id, name, created_at, edita_otros) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) " +
            "ON CONFLICT(user) DO UPDATE SET pass_hash=excluded.pass_hash, salt=excluded.salt, role=excluded.role, " +
            "vendedor_id=excluded.vendedor_id, cliente_id=excluded.cliente_id, name=excluded.name, edita_otros=excluded.edita_otros"
          ).bind(u, hash, salt, r, vendedorId, clienteId, name, createdAt, eo).run();

          return json({ ok: true, user: u }, 200, CORS);
        }

        if (req.method === "DELETE") {
          const u = String(url.searchParams.get("user") || "").trim().toLowerCase();
          if (!u) return json({ error: "missing user" }, 400, CORS);
          if (u === String(identity.u || "").toLowerCase()) {
            return json({ error: "can't delete the user you're logged in as" }, 400, CORS);
          }
          await env.DB.prepare("DELETE FROM usuarios WHERE user = ?").bind(u).run();
          return json({ ok: true }, 200, CORS);
        }
        return json({ error: "method not supported" }, 405, CORS);
      }

      // ---------- ROLLUP (agregaciones server-side, sólo admin, USD) ----------
      if (path === "/rollup") {
        if (role !== "admin") return json({ error: "forbidden" }, 403, CORS);
        if (!env.DB) return json({ error: "config: missing D1 binding 'DB'" }, 500, CORS);
        const space = (url.searchParams.get("space") || "main").slice(0, 64);
        const desde = (url.searchParams.get("desde") || "").slice(0, 10) || null;
        const hasta = (url.searchParams.get("hasta") || "").slice(0, 10) || null;
        const out = await rollup(env, space, desde, hasta);
        return json(out, 200, CORS);
      }

      // ---------- REINDEX (backfill del fact table desde el blob, sólo admin) ----------
      if (path === "/reindex") {
        if (role !== "admin") return json({ error: "forbidden" }, 403, CORS);
        if (req.method !== "POST") return json({ error: "use POST" }, 405, CORS);
        if (!env.DB) return json({ error: "config: missing D1 binding 'DB'" }, 500, CORS);
        const space = (url.searchParams.get("space") || "main").slice(0, 64);
        const row = await env.DB.prepare("SELECT data FROM estado WHERE space = ?").bind(space).first();
        if (!row) return json({ ok: false, error: "no state for that space" }, 404, CORS);
        let data;
        try { data = JSON.parse(row.data); } catch { return json({ ok: false, error: "state is not valid JSON" }, 500, CORS); }
        const res = await deriveFacts(env, space, data);
        return json({ ok: true, reindexed: res }, 200, CORS);
      }

      // ---------- PARSE INVOICE (sólo admin) · lógica en leerFacturaIA() (portada de Prince Collections) ----------
      if (path === "/parse-invoice") {
        if (req.method !== "POST") return json({ error: "use POST" }, 405, CORS);
        if (role !== "admin" && role !== "editor") return json({ ok: false, error: "forbidden" }, 403, CORS);   // nov 2026: el editor carga compras
        if (!env.GEMINI_KEY) return json({ ok: false, error: "config: missing GEMINI_KEY" }, 500, CORS);
        let b;
        try { b = await req.json(); } catch { return json({ ok: false, error: "invalid JSON" }, 400, CORS); }
        // La app puede mandar el TEXTO ya extraído del PDF (más rápido) o el PDF entero (escaneados).
        const texto = typeof (b && b.texto) === "string" ? b.texto.slice(0, 60000).trim() : "";
        const pdf = b && b.pdf;
        const mime = (b && b.mime) || "application/pdf";
        if (!texto && !pdf) return json({ ok: false, error: "missing 'pdf'" }, 400, CORS);
        if (!texto) {
          if (typeof pdf !== "string" || pdf.length > 14_000_000) {
            return json({ ok: false, error: "file too large", detalle: "El archivo es demasiado grande (máx. ~10 MB)." }, 413, CORS);
          }
          if (!["application/pdf", "image/png", "image/jpeg", "image/webp"].includes(mime)) {
            return json({ ok: false, error: "unsupported file", detalle: "Tipo de archivo no soportado." }, 400, CORS);
          }
        }
        const parteDoc = texto
          ? { text: "INVOICE TEXT (extracted from the PDF; each line is one printed row, columns separated by spaces):\n" + texto }
          : { inline_data: { mime_type: mime, data: pdf } };
        const r = await leerFacturaIA(env, parteDoc);
        if (r.ok) return json({ ok: true, data: r.data, model: r.model, ms: r.ms, cuadra: r.cuadra, suma: r.suma, total: r.total }, 200, CORS);
        return json({ ok: false, error: "gemini error", detalle: r.error }, 502, CORS);
      }

      if (!env.DB) return json({ error: "config: missing D1 binding 'DB'" }, 500, CORS);
      if (path !== "/state") return json({ error: "route not found" }, 404, CORS);
      const space = (url.searchParams.get("space") || "main").slice(0, 64);

      await env.DB.prepare(
        "CREATE TABLE IF NOT EXISTS estado (space TEXT PRIMARY KEY, data TEXT, rev INTEGER NOT NULL DEFAULT 0, updated_at TEXT)"
      ).run();

      // ---------- GET (con PROYECCIÓN por rol) ----------
      if (req.method === "GET") {
        const row = await env.DB.prepare(
          "SELECT data, rev, updated_at FROM estado WHERE space = ?"
        ).bind(space).first();
        if (!row) return json({ data: null, rev: 0, updated_at: null }, 200, CORS);

        const full = JSON.parse(row.data);
        let out = full;
        if (role === "store") out = projectStore(full, identity);
        // seller / admin / local => base completa (el vendedor es interno).

        return json({ data: out, rev: row.rev, updated_at: row.updated_at }, 200, CORS);
      }

      // ---------- PUT ----------
      if (req.method === "PUT") {
        if (role === "store") return json({ error: "forbidden: read-only role" }, 403, CORS);

        let body;
        try { body = await req.json(); } catch { return json({ error: "invalid JSON" }, 400, CORS); }
        if (!body || typeof body.data !== "object") return json({ error: "missing 'data'" }, 400, CORS);

        const baseRev = Number(body.baseRev || 0);
        const force = role === "editor" ? false : !!body.force;   // nov 2026: el editor nunca fuerza
        const cur = await env.DB.prepare(
          "SELECT data, rev, updated_at FROM estado WHERE space = ?"
        ).bind(space).first();
        const currentRev = cur ? cur.rev : 0;

        if (!force && baseRev !== currentRev) {
          return json({
            conflict: true, rev: currentRev,
            data: cur ? JSON.parse(cur.data) : null,
            updated_at: cur ? cur.updated_at : null
          }, 409, CORS);
        }

        // nov 2026 · EDITOR: sólo compras, productos, tránsito y su stock (ver protegerEditor).
        const prevData = cur ? JSON.parse(cur.data) : null;
        if (role === "editor") {
          if (!cur) return json({ error: "forbidden", es: "El perfil Editor no puede inicializar la base.", en: "The Editor profile can't initialize the database." }, 403, CORS);
          const pe = protegerEditor(JSON.parse(cur.data), body.data);
          if (pe) return json({ error: "editor", es: pe.es, en: pe.en }, 403, CORS);
          // sólo sus propias compras y ventas, salvo permiso del admin (se lee de la base en cada guardado)
          if (!(await editaOtros(env, identity.u))) {
            const aj = editorAjeno(prevData, body.data, identity.u, ["compras", "ventas"]);
            if (aj) { const m = msgAjeno(aj); return json({ error: "editor", es: m.es, en: m.en }, 403, CORS); }
          }
        }
        marcarAutor(prevData, body.data, identity.u);

        const newRev = currentRev + 1;
        const now = new Date().toISOString();
        await env.DB.prepare(
          "INSERT INTO estado (space, data, rev, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(space) DO UPDATE SET data = excluded.data, rev = excluded.rev, updated_at = excluded.updated_at"
        ).bind(space, JSON.stringify(body.data), newRev, now).run();

        // ---- Derivar el fact table (AUXILIAR). Nunca rompe el guardado. ----
        let facts = null;
        try { facts = await deriveFacts(env, space, body.data); }
        catch (e) { facts = { error: String(e && e.message || e) }; }

        return json({ ok: true, rev: newRev, updated_at: now, facts }, 200, CORS);
      }

      return json({ error: "method not supported" }, 405, CORS);

    } catch (e) {
      return json({ error: "server exception", detail: String(e && e.message || e) }, 500, CORS);
    }
  }
};