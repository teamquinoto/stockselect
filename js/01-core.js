/* ============================================================
   gestordestock — 01-core.js
   Parte de la app. Se carga como <script> en el ORDEN del index.html.
   Todo vive en scope global (sin módulos), igual que antes.
   ============================================================ */
/* ============================================================
   Stock Select — vanilla, último costo, sincronizado
   ============================================================ */
if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
}

const KEY = "gstock_v1";
const SKEY = "gstock_sync";       // { syncedRev, dirty }
const SESKEY = "gstock_session";  // { user, token, space, role, store }

/* ============================================================
   MULTI-STORE / ROLES / LANGUAGE / SPECIAL STATES  (Phase 1)
   ------------------------------------------------------------
   STORES: separate selling entities. Stock, FIFO cost layers and
   sale price live PER STORE, but the product master is SHARED so we
   can compare the same SKU across stores (margin analysis, point 4).
   ROLES: 'admin' (a.k.a. master: sees everything incl. investment
   vault) and 'seller' (only their own store).
   PRODUCT STATE: 'sale' (normal) | 'blocked' (best-offer, visible to
   sellers with a flag, not sellable without approval) | 'investment'
   (executive hold, leaves the sellable inventory, admin-only vault).
   LANGUAGE: per-product tag JP | ESP.
   ============================================================ */
/* DEPÓSITOS reales (entidades físicas donde vive el stock). Select en EEUU,
   Swan en Argentina. La venta ELIGE depósito: lo que está en AR no se puede
   vender desde USA y viceversa (el costo sale del FIFO de ESE depósito). */
const STORES = [
  { id:"select", name:"Select · USA", ccy:"USD" },
  { id:"swan",   name:"Swan · AR",    ccy:"ARS" }
];
const STORE_IDS = STORES.map(s=>s.id);
/* Investment vault = a hidden pseudo-store. Stock and FIFO cost layers moved
   here LEAVE the sellable inventory (STORE_IDS) but keep full traceability.
   It's deliberately NOT part of STORE_IDS, so it never counts as sellable
   stock, never shows in selling views, and never inflates valuation. */
const INV_STORE = "__inv";
/* Depósito de TRÁNSITO (mercadería rumbo AR, ya despachada pero no llegada).
   Es un pseudo-depósito igual que la bóveda: tiene stock y capas FIFO propias
   pero NO forma parte de STORE_IDS, así que nunca cuenta como vendible ni infla
   la valuación. Se ve en la vista Joint/Transit y en la ficha del producto. */
const TRANSITO_STORE = "__transito";
function storeName(id){
  if(id===INV_STORE) return "Investment vault";
  if(id===TRANSITO_STORE) return "In transit (to AR)";
  const s=STORES.find(x=>x.id===id); return s?s.name:(id||"—");
}
function isStore(id){ return STORE_IDS.includes(id); }
/* ¿Es un bucket no-vendible (tránsito / bóveda)? Los buckets no dejan kardex
   propio en las transferencias, para que el saldo corrido del producto siga
   espejando el stock vendible (criterio de auditoría). */
function isBucket(id){ return id===INV_STORE || id===TRANSITO_STORE; }

/* ============================================================
   MONEDAS
   ------------------------------------------------------------
   Cada depósito factura/valúa en SU moneda: Select en USD, Swan en ARS.
   Las capas FIFO no llevan etiqueta de moneda: la moneda la define el
   depósito donde vive la capa (por eso alcanza con storeCcy). El tránsito
   viene del lado US => USD (se convierte a ARS recién al recibirse en Swan).
   El TC es MANUAL (pesos por 1 USD) y hoy es único; se ajustará más adelante.
   La moneda de REPORTE (para consolidar dashboard/análisis/P&L) es elegible;
   por defecto USD.
   ============================================================ */
const MONEDAS = { USD:{ sym:"US$" }, ARS:{ sym:"AR$" } };
function monedaSym(ccy){ return (MONEDAS[ccy]||{}).sym || (ccy||"$"); }
function storeCcy(store){
  if(store===TRANSITO_STORE) return "USD";       // tránsito rumbo AR nace del lado US
  if(store===INV_STORE) return "USD";            // bóveda: se valúa en USD (simplificación; revisar si guarda ARS)
  const s = STORES.find(x=>x.id===store);
  return (s && s.ccy) || "USD";
}
function tc(){ const v = parseFloat(db.config && db.config.tc); return (v && v>0) ? v : 1; }   // ARS por 1 USD
function reportCcy(){ return (db.config && db.config.reportCcy==="ARS") ? "ARS" : "USD"; }
/* Convierte un monto de una moneda a otra con el TC vigente. */
function convertCcy(monto, from, to){
  monto = +monto || 0;
  if(!from || !to || from===to) return monto;
  if(from==="USD" && to==="ARS") return monto * tc();
  if(from==="ARS" && to==="USD") return monto / tc();
  return monto;
}

const ROLES = { ADMIN:"admin", SELLER:"seller" };
function currentRole(){ return (session && session.role) || ROLES.ADMIN; }  // Local mode (no session) = full access
function isAdmin(){ return currentRole()===ROLES.ADMIN; }
function isSeller(){ return currentRole()===ROLES.SELLER; }
/* Vistas reservadas al admin. Un vendedor NO carga compras, no manda a inversión,
   no ve análisis/comisiones globales ni la exportación de datos. Sólo vende. */
const ADMIN_VIEWS = ["compras","inv","analisis","datos","mov","conjunta"];
/* Capacidades gateadas por rol (punto 3). El modo Local (sin sesión) = admin. */
function puedeComprar(){ return isAdmin(); }        // cargar compras / recibir facturas
function puedeInvertir(){ return isAdmin(); }       // enviar / traer de la bóveda de inversión
function puedeAjustar(){ return isAdmin(); }        // ajustes de inventario
function puedeEditarProductos(){ return isAdmin(); }// ABM de productos
/* SOCIEDADES: akira/silver (y futuras) son las entidades que COMPRAN. Definen la
   procedencia de cada lote, NO un local de venta. El stock es un pool único: para
   VENDER no se elige sociedad. Todos ven el mismo pool; el desglose por sociedad
   (columnas Akira/Silver) es info de procedencia y se muestra sólo al admin. */
function allowedStores(){ return STORE_IDS.slice(); }
/* Desglose por sociedad (procedencia). Admin, vista consolidada, 2+ sociedades.
   Genérico: una columna por sociedad, así escala a futuras sociedades sin tocar código. */
function showSociedadCols(){ return isAdmin() && activeStore==="all" && STORE_IDS.length>1; }
function sociedadColsHead(f){ return showSociedadCols() ? STORE_IDS.map(s=> f ? sortTh(f, "soc_"+s, storeName(s), "r") : `<th class="r">${esc(storeName(s))}</th>`).join("") : ""; }
function sociedadColsCells(p, isT){ return showSociedadCols() ? STORE_IDS.map(s=>`<td class="r num">${stockDisplay(p, isT?transitoDe(p,s):stockDe(p,s))}</td>`).join("") : ""; }
/* The store currently in focus. 'all' = consolidated (admin only). */
let activeStore = "all";
/* Vistas donde el SWITCHER de sociedad (foco de procedencia) aporta:
   - prod / compras: procedencia del stock (quién lo compró) y foco de conteo.
   Analysis NO usa el switcher: la venta no está atada a una sociedad (pool único),
   así que los chips no filtrarían nada. En su lugar mostramos una tabla real de
   costo/margen POR SOCIEDAD (procedencia del stock consumido). En dashboard, ventas
   y movimientos el stock es un pool único -> consolidado, sin chips. */
const SOCIETY_VIEWS = ["prod", "compras"];
function viewUsesSociety(){ return SOCIETY_VIEWS.includes(view); }
function effectiveStores(){
  const allow = allowedStores();
  // En vistas sin desglose por sociedad, o en "All", devolvemos el pool completo.
  if(activeStore==="all" || !viewUsesSociety()) return allow;
  return allow.includes(activeStore) ? [activeStore] : allow;
}

const PRODUCT_STATES = { SALE:"sale", BLOCKED:"blocked", INVESTMENT:"investment" };
/* Estado de envío de una factura de COMPRA (tracking, no toca stock). */
const INVOICE_STATUS = { IN_TRANSIT:"in_transit", RECEIVED:"received" };
function invoiceStatusLabel(s){ return s===INVOICE_STATUS.RECEIVED ? "Received" : "In transit"; }
const LANGS = [["JP","JP"],["ESP","SP/ESP"]];
function langLabel(v){ const l=LANGS.find(x=>x[0]===v); return l?l[1]:(v||"—"); }

/* URL del servidor (Cloudflare Worker). Si algún día lo redeploya en otra
   cuenta/nombre, cambiar solo esta línea. */
const API_URL = "https://stockselect-api.teamquinoto.workers.dev";

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,7);

/* ---------- Estado local ---------- */
function load(){
  try{
    const raw = localStorage.getItem(KEY);
    if(raw) return migrate(JSON.parse(raw));
  }catch(e){ console.warn("load fail", e); }
  return migrate({ config:{ moneda:"$" }, productos:[], compras:[], ventas:[], movimientos:[] });
}
/* Migración idempotente: completa campos nuevos sin romper datos viejos.
   - Costos desglosados: el costo total histórico (ultimoCosto) pasa a ser Neto
     (handling/flete arrancan en 0). El total sigue siendo ultimoCosto.
   - Jerarquía TCG (metadata, sin conversión de stock): categoría/nivel/factores.
   - Clientes y numeración US (arranca en 101). */
/* Feature flag: columna "Target product" (mapeo manual de SKU) en el editor de factura.
   Hoy la ocultamos visualmente. El <select> sigue existiendo en el DOM y funcionando,
   así que la auto-detección por SKU/nombre no cambia en nada. Para reactivar el
   mapeo manual el día de mañana: poné esto en true. Nada más. */
const SHOW_TARGET_PRODUCT_COL = false;
const PACKS_POR_BOX_DEF = 24;
const BOXES_POR_CASE = { "Pokémon TCG":6, "Magic":6, "One Piece TCG":12, "Yu-Gi-Oh!":12, "Disney Lorcana":4, "Digimon":12, "Dragon Ball":12, "Flesh and Blood":4 };
function boxesCaseDefault(cat){ return BOXES_POR_CASE[cat] || 6; }
function migrate(d){
  d.config = d.config || {};
  if(d.config.moneda==null) d.config.moneda = "$";
  if(d.config.tc==null || !(parseFloat(d.config.tc)>0)) d.config.tc = 1000;   // ARS por 1 USD (manual, editable)
  if(d.config.reportCcy!=="ARS" && d.config.reportCcy!=="USD") d.config.reportCcy = "USD";   // moneda de reporte (default USD)
  if(d.config.facturaInicio==null) d.config.facturaInicio = 101;   // numeración US
  if(d.config.emisor==null) d.config.emisor = { nombre:"", direccion:"", email:"", tel:"" };
  if(d.config.commissionRate==null) d.config.commissionRate = 0.10;  // tasa por defecto para vendedores nuevos (0.10 = 10%)
  // Vendedores: perfiles a los que se les atribuye la venta (y su comisión). NO son
  // sociedades: son las personas que venden. Cada uno tiene SU PROPIA tasa de comisión
  // (rate). Default Teo/Tonio; editable en Data → Sellers.
  if(!Array.isArray(d.config.vendedores) || !d.config.vendedores.length){
    d.config.vendedores = [ { id:"teo", nombre:"Teo", rate:d.config.commissionRate }, { id:"tonio", nombre:"Tonio", rate:d.config.commissionRate } ];
  }
  // Vendedores viejos sin tasa propia: heredan la global como punto de partida.
  d.config.vendedores.forEach(v=>{ if(v.rate==null) v.rate = d.config.commissionRate; });
  d.productos = d.productos || [];
  d.compras = d.compras || [];
  d.ventas = d.ventas || [];
  d.movimientos = d.movimientos || [];
  d.clientes = d.clientes || [];
  d.solicitudes = d.solicitudes || [];   // approval requests for blocked items (point 5, MVP2)
  // Invoices de COMPRA: estado de envío que AHORA gobierna el stock. Las compras
  // que ya existían impactaron el inventario en su momento, así que se migran como
  // "received" (si las pusiéramos en tránsito, vaciaríamos el stock actual). Sólo
  // las compras nuevas nacerán "in_transit" y no suman hasta marcarse recibidas.
  d.compras.forEach(c=>{ if(c.status==null) c.status = INVOICE_STATUS.RECEIVED; });
  // Ventas: snapshot de la tasa de comisión vigente al momento de la venta, para
  // que un cambio futuro de tasa no reescriba comisiones ya devengadas.
  d.ventas.forEach(v=>{
    if(v.commissionRate==null) v.commissionRate = d.config.commissionRate;
    // Vendedor de la venta (para comisión y columna "Sold by"). Las ventas viejas no
    // lo tienen: quedan como null y se muestran como "—" (sin vendedor atribuido).
    if(v.vendedorId===undefined) v.vendedorId = null;
    if(v.vendedor===undefined)   v.vendedor   = null;
    // storeVenta: las ventas viejas nacieron atadas a UNA sociedad (v.store). Lo
    // conservamos SÓLO como fallback para revertir su consumo FIFO si se editan/borran.
    // Las ventas nuevas ya no eligen sociedad (consumo global), así que no lo usan.
    if(v.storeVenta===undefined) v.storeVenta = v.store || null;
  });
  const r2 = n => Math.round((n||0)*100)/100;
  const DEF_STORE = STORE_IDS[0];   // "akira": target for legacy (store-less) stock
  d.productos.forEach(p=>{
    if(p.costoNeto==null){ p.costoNeto = p.ultimoCosto||0; p.costoHandling = 0; p.costoFlete = 0; }
    // total = neto+handling+flete; ultimoCosto stays as the canonical landed TOTAL (last purchase ref)
    if(p.ultimoCosto==null) p.ultimoCosto = r2((p.costoNeto||0)+(p.costoHandling||0)+(p.costoFlete||0));
    if(p.categoria==null) p.categoria = "";
    if(p.nivel==null) p.nivel = "unidad";
    if(p.packsPorBox==null) p.packsPorBox = PACKS_POR_BOX_DEF;
    if(p.boxesPorCase==null) p.boxesPorCase = boxesCaseDefault(p.categoria);

    // --- NEW: special state + language (points 5 & 10) ---
    if(p.estado==null) p.estado = PRODUCT_STATES.SALE;   // sale | blocked | investment
    if(p.idioma==null) p.idioma = "";                    // JP | ESP

    // --- NEW: per-store stock + FIFO cost layers (points 1 & 3) ---
    if(p.stockPorTienda==null){
      p.stockPorTienda = {};
      STORE_IDS.forEach(s=> p.stockPorTienda[s] = 0);
      // legacy single stock -> assign to the default store
      p.stockPorTienda[DEF_STORE] = p.stock||0;
    } else {
      STORE_IDS.forEach(s=>{ if(p.stockPorTienda[s]==null) p.stockPorTienda[s]=0; });
    }
    if(p.lotes==null){
      p.lotes = {};
      STORE_IDS.forEach(s=> p.lotes[s] = []);
      // seed one FIFO layer for pre-existing positive stock, at the known landed cost
      const seed = p.stockPorTienda[DEF_STORE];
      if(seed>0) p.lotes[DEF_STORE].push({ id:uid(), fecha:new Date().toISOString(), cantidad:seed, costoUnit:(p.ultimoCosto||0), ref:"opening balance" });
    } else {
      STORE_IDS.forEach(s=>{ if(!Array.isArray(p.lotes[s])) p.lotes[s]=[]; });
    }
    // --- Investment vault bucket (points 2 & 4) ---
    if(p.stockPorTienda[INV_STORE]==null) p.stockPorTienda[INV_STORE]=0;
    if(!Array.isArray(p.lotes[INV_STORE])) p.lotes[INV_STORE]=[];
    // --- Transit bucket (mercadería rumbo AR; fuera del vendible, como el vault) ---
    if(p.stockPorTienda[TRANSITO_STORE]==null) p.stockPorTienda[TRANSITO_STORE]=0;
    if(!Array.isArray(p.lotes[TRANSITO_STORE])) p.lotes[TRANSITO_STORE]=[];
    // Remapeo de sociedades LEGACY (base vieja Akira/Silver -> Select/Swan). Idempotente:
    // una vez movido, la clave vieja deja de existir y no vuelve a correr. Preserva stock y capas.
    [["akira",STORE_IDS[0]],["silver",STORE_IDS[1]]].forEach(([old,dest])=>{
      if(!dest || old===dest) return;
      if(p.stockPorTienda[old]!=null){
        p.stockPorTienda[dest] = r2((p.stockPorTienda[dest]||0) + (p.stockPorTienda[old]||0));
        if(Array.isArray(p.lotes[old])) p.lotes[dest] = (p.lotes[dest]||[]).concat(p.lotes[old]);
        delete p.stockPorTienda[old]; delete p.lotes[old];
      }
    });
    // Legacy migration: products flagged estado==="investment" used to hold their
    // WHOLE stock as an investment. Move every store's units + FIFO layers into the
    // vault bucket (value preserved) and clear the flag. Idempotent: once the flag
    // is gone it won't run again. No kardex is fabricated for these legacy holds.
    if(p.estado===PRODUCT_STATES.INVESTMENT){
      STORE_IDS.forEach(s=>{
        (p.lotes[s]||[]).forEach(L=> p.lotes[INV_STORE].push({ id:uid(), fecha:L.fecha||new Date().toISOString(), cantidad:L.cantidad, costoUnit:L.costoUnit, ref:"legacy hold · "+storeName(s) }));
        p.lotes[s] = [];
        p.stockPorTienda[INV_STORE] = r2((p.stockPorTienda[INV_STORE]||0) + (p.stockPorTienda[s]||0));
        p.stockPorTienda[s] = 0;
      });
      p.estado = PRODUCT_STATES.SALE;
    }
    // per-store sale price (point 4: detect who marks the same product up)
    if(p.precioVentaPorTienda==null){
      p.precioVentaPorTienda = {};
      STORE_IDS.forEach(s=> p.precioVentaPorTienda[s] = p.precioVenta||0);
    } else {
      STORE_IDS.forEach(s=>{ if(p.precioVentaPorTienda[s]==null) p.precioVentaPorTienda[s]=(p.precioVenta||0); });
    }
    // keep p.stock as a DERIVED mirror (sum across stores) for backward-compat views
    p.stock = STORE_IDS.reduce((a,s)=> a + (p.stockPorTienda[s]||0), 0);
  });
  // Remapeo legacy de la sociedad en documentos (akira->select, silver->swan).
  const _remapSoc = s => s==="akira"?STORE_IDS[0] : (s==="silver"?STORE_IDS[1] : s);
  (d.compras||[]).forEach(c=>{ if(c.store) c.store = _remapSoc(c.store); });
  (d.ventas||[]).forEach(v=>{ if(v.store) v.store = _remapSoc(v.store); if(v.storeVenta) v.storeVenta = _remapSoc(v.storeVenta); });
  d.conjuntas = d.conjuntas || [];   // compras conjuntas (ingreso de comisión en especie)
  d.clientes.forEach(c=>{ if(c.pais==null) c.pais = ""; });   // country of buyer (point 7 slicer)
  // Punto 11: normalizar fechas viejas mezcladas (ISO vs "01-Jul-2026") a YYYY-MM-DD
  [...(d.compras||[]), ...(d.ventas||[])].forEach(doc=>{ if(doc.fecha) doc.fecha = normISO(doc.fecha) || doc.fecha; });
  return d;
}
/* ---- per-store helpers ---- */
function stockDe(p, store){ return (p.stockPorTienda && p.stockPorTienda[store]) || 0; }
/* Puntos 7/9/15: ¿este producto PERTENECE a este local?
   Sí cuando: tiene stock ahí, tiene capas FIFO ahí, o alguna vez tuvo
   una compra/venta en ese local. Un producto que sólo vive en Silver NO
   debe aparecer (ni en cero, ni como opción de venta) cuando mirás Akira. */
function perteneceAStore(p, store){
  if(stockDe(p, store) !== 0) return true;
  if(p.lotes && Array.isArray(p.lotes[store]) && p.lotes[store].length) return true;
  const docs = (db.compras||[]).concat(db.ventas||[]);
  return docs.some(d => d.store===store && (d.lineas||[]).some(l=>l.productoId===p.id));
}
function stockEnFoco(p){ return effectiveStores().reduce((a,s)=> a + stockDe(p,s), 0); }
/* ¿Este producto está dentro del foco de local actual?
   - En "All (consolidated)" mostramos todo.
   - En un local puntual, sólo los que PERTENECEN a alguno de los locales en foco.
   Misma regla que el maestro (perteneceAStore) para que dashboard y lista coincidan. */
function enFocoActual(p){
  if(activeStore==="all" || !viewUsesSociety()) return true;
  return effectiveStores().some(s=> perteneceAStore(p, s));
}

/* ============================================================
   STOCK EN TRÁNSITO (compras aún no recibidas)
   ------------------------------------------------------------
   Es DERIVADO de db.compras con status "in_transit": no hay campo
   nuevo en el producto, así que nunca se desincroniza. La mercadería
   en tránsito NO está en stockPorTienda ni en las capas FIFO, por eso
   no se puede vender ni cuenta en la valuación vendible. Se recibe
   (marca "received") y recién ahí entra al inventario.
   ============================================================ */
function transitoDe(p, store){
  let u = 0;
  (db.compras||[]).forEach(c=>{
    if(c.status!==INVOICE_STATUS.IN_TRANSIT) return;
    if((c.store||STORE_IDS[0])!==store) return;
    (c.lineas||[]).forEach(l=>{ if(l.productoId===p.id) u += (l.cantidad||0); });
  });
  return u;
}
function transitoValorDe(p, store){
  let v = 0;
  (db.compras||[]).forEach(c=>{
    if(c.status!==INVOICE_STATUS.IN_TRANSIT) return;
    if((c.store||STORE_IDS[0])!==store) return;
    (c.lineas||[]).forEach(l=>{ if(l.productoId===p.id){ const landed=(l.costoTotal!=null)?l.costoTotal:(l.precio||0); v += (l.cantidad||0)*landed; } });
  });
  return round2(v);
}
function transitoEnFoco(p){ return effectiveStores().reduce((a,s)=> a + transitoDe(p,s), 0); }
function transitoValorEnFoco(p){ const rep=reportCcy(); return round2(effectiveStores().reduce((a,s)=> a + convertCcy(transitoValorDe(p,s), storeCcy(s), rep), 0)); }
/* Total de unidades en tránsito bajo el foco actual (para el KPI del panel). */
function unidadesEnTransito(){ return productosVendibles().reduce((a,p)=> a + transitoEnFoco(p), 0); }

/* ============================================================
   Punto 2/3: vista de stock en UNIDADES o CASES
   ------------------------------------------------------------
   unitsPerCase(p): cuántas unidades de stock entran en un case de ESE
   producto. Reusamos boxesPorCase (que ya trae defaults por categoría,
   Pokémon=6, etc.) porque la unidad de stock de Juan es el box y el case
   trae N boxes. Es editable por producto en el formulario.
   ============================================================ */
let stockView = "units";   // "units" | "cases"  (toggle global de la barra superior)
function unitsPerCase(p){ const u = (p && (p.boxesPorCase)) || boxesCaseDefault(p&&p.categoria); return u>0 ? u : 1; }
/* Convierte una cantidad de unidades a la vista activa. En cases mostramos
   hasta 2 decimales (un case parcial es 6,5 y no "6"); si da entero, entero. */
function stockDisplay(p, units){
  if(stockView!=="cases") return qty(units);
  const cases = units / unitsPerCase(p);
  return nf0.format(Math.round(cases*100)/100);
}
/* Sufijo textual para encabezados/celdas según la vista. */
function stockUnitWord(){ return stockView==="cases" ? "cases" : "units"; }

/* ============================================================
   Punto 4: comisión del vendedor = MARGEN de la venta × tasa
   ------------------------------------------------------------
   El margen se toma sobre productos (precio − COGS FIFO), sin envío.
   La tasa se congela por venta (doc.commissionRate); si falta, cae a la
   tasa global vigente. TODO el consumo de estos valores va detrás de
   isAdmin() en la UI: un seller no ve la comisión bajo ningún caso.
   ============================================================ */
function saleRevenueProd(d){ return round2((d.lineas||[]).reduce((a,l)=> a + (l.cantidad||0)*(l.precio||0), 0)); }
function saleCogs(d){
  return round2((d.lineas||[]).reduce((a,l)=>{
    if(l.cogs!=null) return a + l.cogs;
    const c = (l.costo!=null) ? l.costo : ((prodById(l.productoId)||{}).ultimoCosto||0);
    return a + (l.cantidad||0)*c;
  }, 0));
}
function saleMargin(d){ return round2(saleRevenueProd(d) - saleCogs(d)); }
function saleCommissionRate(d){ return (d && d.commissionRate!=null) ? d.commissionRate : (db.config.commissionRate||0); }
function saleCommission(d){ return round2(saleMargin(d) * saleCommissionRate(d)); }
/* ---- Costos adicionales POR VENTA (gastos de venta, NO se capitalizan al stock) ----
   Van por debajo del margen bruto: envío/ShipStation, horas hombre (horas×tarifa),
   comisión de venta manual (distinta de la comisión % del vendedor) y "otro".
   El margen NETO = bruto − comisión del vendedor (%) − estos costos. */
const COSTO_TIPOS = [
  { id:"envio",    label:"Shipping / ShipStation" },
  { id:"labor",    label:"Man-hours" },
  { id:"comision", label:"Sales commission" },
  { id:"otro",     label:"Other" }
];
function costoTipoLabel(id){ const t=COSTO_TIPOS.find(x=>x.id===id); return t?t.label:"Other"; }
function saleCostosExtra(d){ return round2(((d&&d.costosExtra)||[]).reduce((a,c)=> a + (+c.monto||0), 0)); }
function saleCostosPorTipo(d){
  const acc={}; ((d&&d.costosExtra)||[]).forEach(c=>{ const k=c.tipo||"otro"; acc[k]=round2((acc[k]||0)+(+c.monto||0)); });
  return acc;
}
function saleNetMargin(d){ return round2(saleMargin(d) - saleCommission(d) - saleCostosExtra(d)); }
/* ---- Vendedores (perfiles a los que se atribuye la venta) ---- */
function vendedores(){ return (db.config && Array.isArray(db.config.vendedores)) ? db.config.vendedores : []; }
function vendedorById(id){ if(!id) return null; return vendedores().find(v=>v.id===id) || null; }
function vendedorNombre(id){ const v=vendedorById(id); return v ? v.nombre : (id||"—"); }
/* Tasa de comisión propia de un vendedor (cada uno la suya). Si el vendedor no
   existe o no tiene tasa, cae a la global como último recurso. */
function vendedorRate(id){ const v=vendedorById(id); return (v && v.rate!=null) ? v.rate : (db.config.commissionRate||0); }
/* Vendedor de la sesión actual (si el que entró es un seller). El admin no está
   atado a un vendedor: elige a nombre de quién carga la venta. */
function currentVendedorId(){ return (session && session.vendedorId) || null; }
/* Nombre a mostrar en "Sold by" para una venta ya guardada. */
function saleVendedorNombre(d){
  if(d && d.vendedorId) return vendedorNombre(d.vendedorId);
  if(d && d.vendedor)   return d.vendedor;   // snapshot histórico
  return "—";
}
function stockTotalP(p){ return STORE_IDS.reduce((a,s)=> a + stockDe(p,s), 0); }   // sellable only, excludes __inv
function recalcStockMirror(p){ p.stock = stockTotalP(p); }

/* ---- Investment vault helpers (quantity-based, points 2 & 4) ---- */
function invUnits(p){ return stockDe(p, INV_STORE); }                 // units held in the vault
function invLayers(p){ return fifoLayers(p, INV_STORE); }             // FIFO cost layers in the vault
function invValor(p){ return round2(invLayers(p).reduce((a,L)=> a + L.cantidad*L.costoUnit, 0)); }
/* A product "has an investment position" if it holds units in the vault.
   NOTE: this is now a *quantity* condition, not the old product-level flag —
   a product can be partly sellable and partly held. */
function esInversion(p){ return invUnits(p) > 0; }
/* Fully held: something is in the vault AND has no sellable units left.
   These (and only these) are hidden from selling/reorder views. */
function soloEnVault(p){ return invUnits(p) > 0 && stockTotalP(p) === 0; }
function esBloqueado(p){ return p.estado===PRODUCT_STATES.BLOCKED; }
/* ---- Transit bucket helpers (mercadería rumbo AR) ---- */
function transUnits(p){ return stockDe(p, TRANSITO_STORE); }                 // unidades en tránsito
function transLayers(p){ return (p.lotes && Array.isArray(p.lotes[TRANSITO_STORE])) ? p.lotes[TRANSITO_STORE] : []; }
function transValor(p){ return round2(transLayers(p).reduce((a,L)=> a + L.cantidad*L.costoUnit, 0)); }
function enTransitoAR(p){ return transUnits(p) > 0; }
/* Total de unidades en tránsito rumbo AR (para el KPI de la vista Joint/Transit). */
function unidadesEnTransitoAR(){ return db.productos.reduce((a,p)=> a + transUnits(p), 0); }
function valorEnTransitoAR(){ return round2(db.productos.reduce((a,p)=> a + transValor(p), 0)); }
/* products visible for normal SELLING views: hides only the fully-held items,
   and (for sellers) is later intersected with their store's stock. */
function productosVendibles(){ return db.productos.filter(p=> !soloEnVault(p)); }
let db = load();
function persistLocal(){ localStorage.setItem(KEY, JSON.stringify(db)); }

/* ---------- Sesión ---------- */
let session = loadSession();
function loadSession(){ try{ const r=localStorage.getItem(SESKEY); if(r) return JSON.parse(r); }catch(e){} return null; }
function saveSession(){ if(session) localStorage.setItem(SESKEY, JSON.stringify(session)); else localStorage.removeItem(SESKEY); }

/* ---------- Sincronización con el servidor ---------- */
let syncMeta = loadSyncMeta();       // { syncedRev, dirty }
let syncState = session ? "idle" : "off";
let pushTimer = null;
let conflictPayload = null;

function loadSyncMeta(){ try{ const r=localStorage.getItem(SKEY); if(r) return JSON.parse(r); }catch(e){} return { syncedRev:0, dirty:false }; }
function saveSyncMeta(){ localStorage.setItem(SKEY, JSON.stringify(syncMeta)); }

function save(){
  persistLocal();
  if(session){ syncMeta.dirty=true; saveSyncMeta(); schedulePush(); }
}

function setSyncState(s){ syncState=s; paintSync(); }
function apiBase(){ return API_URL.replace(/\/+$/,""); }
function authHeaders(){ return { "Authorization":"Bearer "+(session?session.token:""), "Content-Type":"application/json" }; }
function stateUrl(){ return apiBase()+"/state?space="+encodeURIComponent(session?session.space:"main"); }

function schedulePush(){ if(!session) return; clearTimeout(pushTimer); pushTimer=setTimeout(()=>pushNow(), 800); }

async function pushNow(force=false){
  if(!session) return;
  setSyncState("saving");
  try{
    const res=await fetch(stateUrl(),{ method:"PUT", headers:authHeaders(), body:JSON.stringify({ data:db, baseRev:syncMeta.syncedRev, force }) });
    if(res.status===401){ toast("Session expired, sign in again","warn"); forceLogout(); return; }
    if(res.status===409){ conflictPayload=await res.json(); setSyncState("conflict"); toast("There is a newer version on the server","warn"); if(view==="datos") render(); return; }
    if(!res.ok) throw new Error("HTTP "+res.status);
    const j=await res.json();
    syncMeta.syncedRev=j.rev; syncMeta.dirty=false; saveSyncMeta();
    setSyncState("idle");
  }catch(e){ console.warn("push fail", e); setSyncState("offline"); }
}

async function pullNow(){
  if(!session) return;
  setSyncState("saving");
  try{
    const res=await fetch(stateUrl(),{ method:"GET", headers:authHeaders() });
    if(res.status===401){ toast("Session expired, sign in again","warn"); forceLogout(); return; }
    if(!res.ok) throw new Error("HTTP "+res.status);
    const j=await res.json();
    const serverRev=j.rev||0;
    if(!j.data){ if(hasData(db)) await pushNow(true); else { syncMeta.syncedRev=0; saveSyncMeta(); setSyncState("idle"); } return; }
    if(serverRev===syncMeta.syncedRev && !syncMeta.dirty){ setSyncState("idle"); return; }
    if(serverRev>syncMeta.syncedRev && !syncMeta.dirty){
      db=j.data; syncMeta.syncedRev=serverRev; syncMeta.dirty=false; saveSyncMeta(); persistLocal();
      setSyncState("idle"); render(); toast("Data updated from the server"); return;
    }
    if(syncMeta.dirty && serverRev!==syncMeta.syncedRev){ conflictPayload=j; setSyncState("conflict"); if(view==="datos") render(); return; }
    if(syncMeta.dirty){ await pushNow(); return; }
    setSyncState("idle");
  }catch(e){ console.warn("pull fail", e); setSyncState("offline"); }
}

function hasData(d){ return (d.productos&&d.productos.length)||(d.compras&&d.compras.length)||(d.ventas&&d.ventas.length); }

function resolveConflict(keepLocal){
  if(!conflictPayload) return;
  if(keepLocal){ syncMeta.syncedRev=conflictPayload.rev; saveSyncMeta(); pushNow(true); }
  else{
    db=conflictPayload.data; syncMeta.syncedRev=conflictPayload.rev; syncMeta.dirty=false; saveSyncMeta(); persistLocal();
    render(); toast("Took the server version");
  }
  conflictPayload=null; setSyncState("idle");
}

function paintSync(){
  const map={
    off:["●","Offline","var(--muted)"],
    idle:["●","Synced","var(--up)"],
    saving:["◐","Saving…","var(--accent)"],
    offline:["●","No connection","var(--down)"],
    conflict:["▲","Conflict","var(--alert)"]
  };
  const [dot,txt,col]=map[syncState]||map.off;
  document.querySelectorAll("[data-syncchip]").forEach(el=>{ el.style.color=col; el.textContent=dot+" "+txt; });
  document.querySelectorAll("[data-syncicon]").forEach(el=>{
    el.style.color = (syncState==="idle"||syncState==="off") ? "" : col;
    el.classList.toggle("spin", syncState==="saving");
    el.title = "Sync · "+txt.toLowerCase();
  });
}

/* ---------- Login / Logout ---------- */
async function doLogin(){
  const user=(document.getElementById("loginUser").value||"").trim();
  const pass=document.getElementById("loginPass").value||"";
  const errEl=document.getElementById("loginErr");
  const btn=document.getElementById("loginBtn");
  errEl.textContent="";
  if(!user||!pass){ errEl.textContent="Enter your username and password"; return; }
  btn.disabled=true; btn.textContent="Signing in…";
  try{
    console.log("[login] POST", apiBase()+"/login", "user:", user);
    const res=await fetch(apiBase()+"/login",{ method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({user,pass}) });
    console.log("[login] status", res.status);
    if(res.status===401){ errEl.textContent="Wrong username or password"; return; }
    if(!res.ok){
      let msg="Error "+res.status;
      try{ const ej=await res.json(); if(ej.error) msg=ej.error; if(ej.detalle) msg+=" — "+ej.detalle; }catch(_){}
      errEl.textContent=msg;
      return;
    }
    const j=await res.json();
    console.log("[login] ok, entrando como", j.user, "role:", j.role);
    const switching = !session || session.user!==j.user;
    session={ user:j.user, token:j.token, space:j.space||"main", role:j.role||"admin", vendedorId:j.vendedorId||"", name:j.name||j.user }; saveSession();
    // El stock es UNO SOLO: todos (admin y vendedores) arrancan en la vista
    // consolidada. Las sociedades son sólo procedencia, no locales de venta.
    activeStore = "all";
    if(view==="inv" && !isAdmin()) view="dash";
    // Si un vendedor entra a una vista admin-only (compras/inversión/análisis/datos), lo mandamos al panel.
    if(!isAdmin() && ADMIN_VIEWS.includes(view)) view="dash";
    if(switching){
      db={ config:{ moneda:(db.config&&db.config.moneda)||"$" }, productos:[], compras:[], ventas:[], movimientos:[], clientes:[], solicitudes:[] };
      persistLocal(); syncMeta={ syncedRev:0, dirty:false }; saveSyncMeta();
    }
    setSyncState("idle");
    hideLogin(); render(); paintSync();
    await pullNow();
  }catch(e){ console.error("[login] fallo:", e); errEl.textContent="Couldn't reach the server ("+(e&&e.message||e)+")"; }
  finally{ btn.disabled=false; btn.textContent="Sign in"; }
}
function logout(){
  if(!confirm("Sign out on this device. Your data stays on the server. Continue?")) return;
  forceLogout();
}
/* Cierre forzado (token vencido / 401): sin confirmación, va derecho al login.
   Antes se llamaba a logout() acá y el confirm() aparecía sin que el usuario
   hubiera pedido salir; si cancelaba, quedaba con un token muerto reintentando. */
function forceLogout(){
  session=null; saveSession(); setSyncState("off");
  showLogin();
}
function showLogin(){
  const l=document.getElementById("login"); if(l) l.hidden=false;
  const a=document.querySelector(".app"); if(a) a.style.display="none";
  const u=document.getElementById("loginUser"); if(u){ u.value=""; setTimeout(()=>u.focus(),50); }
  const p=document.getElementById("loginPass"); if(p) p.value="";
}
function hideLogin(){
  const l=document.getElementById("login"); if(l) l.hidden=true;
  const a=document.querySelector(".app"); if(a) a.style.display="";
}

/* ---------- Formato ---------- */
const nf0 = new Intl.NumberFormat("en-US",{maximumFractionDigits:2});
const nf2 = new Intl.NumberFormat("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
/* money(n, ccy): formatea con el símbolo de la moneda indicada. Si no se pasa
   moneda, usa la de REPORTE (por defecto USD). Los montos consolidados llegan
   ya convertidos a la moneda de reporte; los deposit-scoped pasan su ccy. */
const money = (n, ccy) => monedaSym(ccy || reportCcy()) + "\u00A0" + nf2.format(n||0);
/* Atajos: en la moneda NATIVA de un depósito / convertido a la de reporte. */
const moneyStore = (n, store) => money(n, storeCcy(store));
const moneyRep = (n, fromCcy) => money(convertCcy(n, fromCcy||reportCcy(), reportCcy()), reportCcy());
const qty = n => nf0.format(n||0);
/* money() pero con guión cuando el valor es 0 / nulo. Lo usamos en precios de
   venta opcionales: si no hay precio cargado mostramos "—" en vez de "USD 0,00".
   El \u00A0 (espacio duro) ya deja el símbolo separado del número: "USD 92,10". */
const moneyOpt = (n, dash="—", ccy) => ((n||0) > 0 ? money(n, ccy) : dash);

/* ---------- Fechas unificadas (puntos 2 y 11) ----------
   normISO: cualquier formato (ISO datetime, dd/mm/yyyy, 01-Jul-2026) -> "YYYY-MM-DD".
            Es lo ÚNICO que acepta <input type="date">, por eso al editar la fc
            aparecía vacía cuando la fecha venía en otro formato.
   fmtDate: muestra SIEMPRE igual en toda la app -> "01-Jul-2026". */
const _MONTHS3 = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function normISO(s){
  if(!s) return "";
  s = String(s).trim();
  // ya viene ISO (con o sin hora)
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(m) return `${m[1]}-${m[2]}-${m[3]}`;
  // 01-Jul-2026 / 01/07/2026 con mes en texto
  m = s.match(/^(\d{1,2})[-\/]([A-Za-z]{3,})[-\/](\d{2,4})$/);
  if(m){
    const map={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12,ene:1,abr:4,ago:8,dic:12};
    const mo=map[m[2].slice(0,3).toLowerCase()]; if(!mo) return "";
    const y=m[3].length===2?"20"+m[3]:m[3];
    return `${y}-${String(mo).padStart(2,"0")}-${m[1].padStart(2,"0")}`;
  }
  // dd/mm/yyyy o dd-mm-yyyy numérico
  m = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{2,4})$/);
  if(m){ const y=m[3].length===2?"20"+m[3]:m[3]; return `${y}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`; }
  return "";
}
/* Formato de display: SIEMPRE americano MM/DD/YYYY en toda la app. */
function fmtDate(s){
  const iso = normISO(s);
  if(!iso) return s || "—";
  const [y,mo,d] = iso.split("-");
  return `${mo}/${d}/${y}`;
}

/* Parseo tolerante de números en formato AR (1.234,56) o US (1,234.56) */
function parseNum(s){
  if(typeof s === "number") return s;
  if(!s) return 0;
  let t = String(s).trim().replace(/[^\d.,\-]/g,"");
  if(t==="") return 0;
  const lastComma = t.lastIndexOf(","), lastDot = t.lastIndexOf(".");
  if(lastComma > lastDot){            // coma decimal (AR)
    t = t.replace(/\./g,"").replace(",",".");
  } else {                            // punto decimal (US)
    t = t.replace(/,/g,"");
  }
  const v = parseFloat(t);
  return isNaN(v) ? 0 : v;
}

/* ---------- Toast ---------- */
function toast(msg, kind="up"){
  const el = document.createElement("div");
  el.className = "toast " + kind;
  el.textContent = msg;
  document.getElementById("toasts").appendChild(el);
  setTimeout(()=>{ el.style.opacity="0"; el.style.transform="translateY(8px)"; }, 2600);
  setTimeout(()=> el.remove(), 3000);
}

/* ---------- Helpers de stock ---------- */
function prodById(id){ return db.productos.find(p=>p.id===id); }
function clienteById(id){ return db.clientes.find(c=>c.id===id); }
function clienteLinea(c){ return c ? (c.empresa ? `${c.nombre} · ${c.empresa}` : c.nombre) : ""; }
function clienteDireccion(c){
  if(!c) return "";
  return [c.direccion, [c.ciudad, c.estado, c.zip].filter(Boolean).join(", ")].filter(Boolean).join(" · ");
}
function findProdBySku(sku){
  if(!sku) return null;
  const s = sku.trim().toLowerCase();
  return db.productos.find(p => (p.sku||"").trim().toLowerCase() === s) || null;
}
/* ¿Ese SKU ya lo usa OTRO producto? Devuelve el producto en conflicto o null.
   - SKU vacío nunca colisiona (muchos productos pueden no tener código).
   - exceptId permite editar un producto sin chocar consigo mismo.
   Evita SKUs repetidos, que romperían findProdBySku al importar facturas
   (engancharía la compra al producto equivocado). */
function skuEnUso(sku, exceptId){
  const s = (sku||"").trim().toLowerCase();
  if(!s) return null;
  return db.productos.find(p => p.id!==exceptId && (p.sku||"").trim().toLowerCase()===s) || null;
}
/* FIFO valuation of the sellable stock in the stores currently in focus.
   Sums the actual cost layers, not stock×lastcost. Excludes the vault. */
/* Valor FIFO de un producto en el FOCO de tienda, convertido a moneda de REPORTE
   (cada depósito aporta su valor en su moneda nativa y se lleva a la de reporte). */
function valorFifoEnFoco(p){
  const rep = reportCcy();
  return round2(effectiveStores().reduce((a,s)=>{
    const v = fifoLayers(p,s).reduce((x,L)=>x+L.cantidad*L.costoUnit,0);
    return a + convertCcy(v, storeCcy(s), rep);
  }, 0));
}
function valorizacion(){
  return round2(productosVendibles().reduce((a,p)=> a + valorFifoEnFoco(p), 0));
}
function unidadesTotales(){ return productosVendibles().reduce((a,p)=> a + stockEnFoco(p), 0); }
/* Reposición sobre el POOL ÚNICO: el stock es uno solo, así que las alertas de
   "sin stock" / "bajo mínimo" miran el total vendible cruzando TODAS las sociedades,
   no el foco de tienda. Un producto agotado en Akira pero con stock en Silver NO
   alerta: se despacha del pool común (FIFO cruza sociedades). */
function bajoStock(p){ const s=stockTotalP(p); return p.puntoRepedido>0 && s>0 && s <= p.puntoRepedido; }
function sinStock(p){ return stockTotalP(p) <= 0; }
function necesitaPedido(p){ return !soloEnVault(p) && (sinStock(p) || bajoStock(p)); }

/* ============================================================
   Numeración CORRELATIVA de facturas de VENTA
   Formato: "FC 0001-0000001". Tomamos el mayor secuencial ya usado
   en db.ventas (parseando el patrón) y devolvemos el siguiente, sin
   huecos. Las compras siguen con N° libre (traen el del proveedor).
   ------------------------------------------------------------
   OJO: si borrás una venta que NO es la última, queda un hueco en la
   serie (comportamiento correcto: en la práctica se anula con nota de
   crédito, no se borra). Si borrás la última, ese número se reutiliza.
   ============================================================ */
/* Formato estadounidense: entero simple, sin punto de venta. Arranca en
   config.facturaInicio (101 por defecto) y toma el mayor ya usado + 1.
   Es SUGERIDO: el campo es editable en el modal de venta. */
function nextFacturaVenta(){
  const inicio = parseInt(db.config.facturaInicio,10) || 101;
  let max = inicio - 1;
  (db.ventas||[]).forEach(v=>{
    const n = parseInt(String(v.numero||"").replace(/[^\d]/g,""),10);
    if(!isNaN(n) && n>max) max=n;
  });
  return String(max+1);
}

/* ============================================================
   Banner de reposición: memoria de descarte por CONJUNTO
   El banner se muestra una sola vez y se queda hasta que lo tocás.
   Guardamos la "firma" (los IDs de todo lo que hay que reponer, ordenados).
   Si el conjunto cambia —entra o sale CUALQUIER producto, aunque la
   cantidad total sea la misma— la firma cambia y el banner vuelve a
   aparecer. Cuando ya no hay nada que reponer, limpiamos la memoria para
   que el próximo alerta (aun con los mismos productos) se muestre fresco.
   Es preferencia LOCAL del dispositivo: no se sincroniza ni ensucia el rev.
   ============================================================ */
const ALERTKEY = "gstock_alert_dismissed";
function firmaReposicion(){
  return productosVendibles().filter(enFocoActual).filter(necesitaPedido).map(p=>p.id).sort().join("|");
}
function alertaDescartada(firma){
  try{ return localStorage.getItem(ALERTKEY) === firma; }catch(e){ return false; }
}
function descartarAlerta(firma){
  try{ localStorage.setItem(ALERTKEY, firma); }catch(e){}
}
function limpiarMemoriaAlerta(){
  try{ localStorage.removeItem(ALERTKEY); }catch(e){}
}

/* Registrar movimiento. opts (opcional): { tipo, obs, fecha } */
/* moverStock: registers a kardex movement AND updates per-store stock.
   `store` is required now; movements carry the store dimension. */
function moverStock(prod, delta, valorUnit, refTipo, refId, ref, opts){
  opts = opts || {};
  const store = opts.store || STORE_IDS[0];
  if(!prod.stockPorTienda) prod.stockPorTienda = {};
  prod.stockPorTienda[store] = +(( (prod.stockPorTienda[store]||0) + delta )).toFixed(4);
  recalcStockMirror(prod);
  db.movimientos.push({
    id: uid(), fecha: opts.fecha || new Date().toISOString(),
    tipo: opts.tipo || (delta>=0 ? "entrada" : "salida"),
    productoId: prod.id, sku:prod.sku, nombre:prod.nombre, store,
    cantidad: Math.abs(delta), delta: delta, valorUnit, refTipo, refId, ref,
    obs: opts.obs || ""
  });
}

