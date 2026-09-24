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

function normRole(r) { r = String(r || "").toLowerCase(); return (r === "admin" || r === "store") ? r : "seller"; }

async function ensureUsuarios(env) {
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS usuarios (user TEXT PRIMARY KEY, pass_hash TEXT, salt TEXT, role TEXT NOT NULL DEFAULT 'seller', vendedor_id TEXT, cliente_id TEXT, name TEXT, created_at TEXT)"
  ).run();
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
    historial: (Array.isArray(cs.historial) ? cs.historial : []).map(h => ({ estado: h.estado || "", fecha: h.fecha || "" }))
  }));
  // Remitos U de sus envíos: sólo identificación + tracking (sin líneas ni montos).
  const ids = new Set(safeCs.map(cs => cs.remitoId).filter(Boolean));
  const remitos = (Array.isArray(data && data.remitos) ? data.remitos : [])
    .filter(r => ids.has(r.id))
    .map(r => ({ id: r.id, letra: r.letra || "U", numero: r.numero, codigo: r.codigo || "", fecha: r.fecha || "", tracking: r.tracking || "", carrier: r.carrier || "", lineas: [] }));
  return { config: {}, consignaciones: safeCs, remitos };
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
          name: row.name || row.user
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
          name: u.name || u.user, token, space: "main"
        }, 200, CORS);
      }

      // ---------- De acá en más: token firmado obligatorio ----------
      if (!env.AUTH_SECRET) return json({ error: "config: missing AUTH_SECRET secret" }, 500, CORS);
      const auth = req.headers.get("Authorization") || "";
      const raw = auth.replace(/^Bearer\s+/i, "").trim();
      const identity = await verifyToken(env, raw);
      if (!identity) return json({ error: "not authorized" }, 401, CORS);
      const role = identity.role || "admin";

      // ---------- USUARIOS (ABM, sólo admin) ----------
      if (path === "/users") {
        if (role !== "admin") return json({ error: "forbidden" }, 403, CORS);
        if (!env.DB) return json({ error: "config: missing D1 binding 'DB'" }, 500, CORS);
        await ensureUsuarios(env);

        if (req.method === "GET") {
          const { results } = await env.DB.prepare(
            "SELECT user, role, vendedor_id, cliente_id, name, created_at FROM usuarios ORDER BY user"
          ).all();
          const users = (results || []).map(r => ({
            user: r.user, role: r.role, vendedorId: r.vendedor_id || "",
            clienteId: r.cliente_id || "", name: r.name || "", createdAt: r.created_at || ""
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
            "SELECT user, pass_hash, salt, created_at FROM usuarios WHERE user = ?"
          ).bind(u).first();
          if (!existing && !(b && b.pass)) return json({ error: "new user needs a password" }, 400, CORS);

          let salt = existing ? existing.salt : "";
          let hash = existing ? existing.pass_hash : "";
          if (b && b.pass) { salt = randSaltHex(); hash = await pbkdf2(String(b.pass), salt); }

          const vendedorId = r === "seller" ? String((b && b.vendedorId) || u).trim().toLowerCase() : "";
          const clienteId = r === "store" ? String((b && b.clienteId) || "").trim() : "";
          const name = String((b && b.name) || u).trim();
          const createdAt = existing ? (existing.created_at || new Date().toISOString()) : new Date().toISOString();

          await env.DB.prepare(
            "INSERT INTO usuarios (user, pass_hash, salt, role, vendedor_id, cliente_id, name, created_at) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?) " +
            "ON CONFLICT(user) DO UPDATE SET pass_hash=excluded.pass_hash, salt=excluded.salt, role=excluded.role, " +
            "vendedor_id=excluded.vendedor_id, cliente_id=excluded.cliente_id, name=excluded.name"
          ).bind(u, hash, salt, r, vendedorId, clienteId, name, createdAt).run();

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

      // ---------- PARSE INVOICE (sólo admin) ----------
      if (path === "/parse-invoice") {
        if (req.method !== "POST") return json({ error: "use POST" }, 405, CORS);
        if (role !== "admin") return json({ ok: false, error: "forbidden" }, 403, CORS);
        if (!env.GEMINI_KEY) return json({ ok: false, error: "config: missing GEMINI_KEY" }, 500, CORS);
        let b;
        try { b = await req.json(); } catch { return json({ ok: false, error: "invalid JSON" }, 400, CORS); }
        const pdf = b && b.pdf;
        const mime = (b && b.mime) || "application/pdf";
        if (!pdf) return json({ ok: false, error: "missing 'pdf'" }, 400, CORS);

        const MODELS = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-2.5-flash"];
        const prompt =
          "You are reading a purchase invoice (e.g. Coqui Hobby style). Return ONLY a JSON object, no markdown, " +
          "no extra text, with this exact shape: " +
          "{\"numero\":\"\",\"fecha\":\"\",\"proveedor\":\"\",\"moneda\":\"\",\"flete\":0," +
          "\"lineas\":[{\"sku\":\"\",\"nombre\":\"\",\"cantidad\":0,\"precio\":0,\"msrp\":0}]}. " +
          "RULES:\n" +
          "- 'precio' = the NET unit price / NET PRICE of the line (the real unit cost).\n" +
          "- 'msrp' = the MSRP unit price if present, else 0.\n" +
          "- 'cantidad' = QTY (units).\n" +
          "- 'sku' = the item code before the colon (e.g. 'BAN2696877'); 'nombre' = the rest of the description.\n" +
          "- 'flete' = the SUM of all freight/shipping/handling amounts (lines like 'Freight and Handling', " +
          "'Handling Fees', 'ZZZFEES', shipping). Use the EXT/line amount for these, not a unit price.\n" +
          "- DO NOT include freight/shipping/handling lines inside 'lineas'. Only real products go in 'lineas'.\n" +
          "- 'fecha' MUST be returned as YYYY-MM-DD.\n" +
          "- If a value is unknown use 0 or an empty string. Numbers must be plain (no thousands separators, dot decimals).";

        const gReq = {
          contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: pdf } }] }],
          generationConfig: { temperature: 0, response_mime_type: "application/json", thinkingConfig: { thinkingLevel: "low" } }
        };
        const TRANSIENT = [429, 500, 502, 503, 504];
        const MAX_INTENTOS = 2;
        const sleep = ms => new Promise(r => setTimeout(r, ms));
        let lastErr = "sin respuesta del modelo";

        for (const model of MODELS) {
          const gUrl = "https://generativelanguage.googleapis.com/v1beta/models/" +
                       model + ":generateContent?key=" + encodeURIComponent(env.GEMINI_KEY);
          for (let intento = 1; intento <= MAX_INTENTOS; intento++) {
            let gRes, gJson;
            try {
              gRes = await fetch(gUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(gReq) });
              gJson = await gRes.json();
            } catch (e) {
              lastErr = "network: " + String(e && e.message || e);
              if (intento < MAX_INTENTOS) await sleep(intento * 700);
              continue;
            }
            if (gRes.ok) {
              let text = "";
              try { text = gJson.candidates[0].content.parts.map(p => p.text || "").join(""); } catch { text = ""; }
              try {
                const data = JSON.parse(text.replace(/```json|```/g, "").trim());
                return json({ ok: true, data, model }, 200, CORS);
              } catch (e) { lastErr = "could not parse model output (" + model + ")"; break; }
            }
            lastErr = (gJson && gJson.error && gJson.error.message) || ("HTTP " + gRes.status);
            if (TRANSIENT.includes(gRes.status)) { if (intento < MAX_INTENTOS) await sleep(intento * 700); continue; }
            break;
          }
        }
        return json({ ok: false, error: "gemini error", detalle: lastErr }, 502, CORS);
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
        const force = !!body.force;
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
