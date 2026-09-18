/* ============================================================
   gestordestock — 18-view-conjunta.js
   Parte de la app. Se carga como <script> en el ORDEN del index.html.
   Todo vive en scope global (sin módulos), igual que antes.
   ============================================================ */
/* ============================================================
   COMPRA CONJUNTA (ingreso de comisión en especie) + TRÁNSITO
   ------------------------------------------------------------
   Modelo de negocio: uno de los 12 locales de AR le compra a un proveedor
   de EEUU. Nosotros traemos la mercadería y cobramos comisión EN CARTAS.
   Del pedido total del cliente sólo nos quedamos con una parte:
     · unidades que quedan en SELECT (USA)  -> stock vendible en USA al toque.
     · unidades que van rumbo AR            -> nacen EN TRÁNSITO (bucket no
       vendible) y se vuelven stock de SWAN cuando se reciben en Argentina.
   NO cargamos las unidades del cliente: no son nuestras (sólo, opcional, un
   memo del total del envío para trazabilidad). Costo de entrada default 0
   (comisión pura; el cliente paga proveedor + importación). Parametrizable.
   ============================================================ */
let conjDraft = null;

/* ============================================================
   CONSIGNACIONES — mercadería AJENA (de terceros) que sólo se SIGUE
   ------------------------------------------------------------
   Vive 100% aparte del stock vendible: no toca stockPorTienda, ni FIFO,
   ni valuación, ni P&L (regla del cliente: lo ajeno NO se vende, sólo
   se rastrea). Cada registro es {producto, dueño (clienteId), cantidad,
   estado}. Estados = puertas del recorrido: en_transito (despachado en
   EEUU) → en_ar (recibido en Argentina) → entregado (pasamanos al tercero).
   costoUnit es un COSTO DE REFERENCIA (para repartir courier/financiero),
   nunca un COGS. Todo cambio de estado deja rastro en `historial` (auditoría).
   ============================================================ */
const CONSIGN_ESTADOS = { TRANSITO:"en_transito", AR:"en_ar", ENTREGADO:"entregado" };
const CONSIGN_ORDEN = [CONSIGN_ESTADOS.TRANSITO, CONSIGN_ESTADOS.AR, CONSIGN_ESTADOS.ENTREGADO];
function consignLabel(e){
  return e===CONSIGN_ESTADOS.TRANSITO ? "En tránsito (US→AR)"
       : e===CONSIGN_ESTADOS.AR       ? "En AR (para resolver)"
       : e===CONSIGN_ESTADOS.ENTREGADO? "Resuelto / entregado"
       : (e||"—");
}
function consignSiguiente(e){ const i=CONSIGN_ORDEN.indexOf(e); return (i>=0 && i<CONSIGN_ORDEN.length-1) ? CONSIGN_ORDEN[i+1] : null; }
function consignAll(){ return db.consignaciones || (db.consignaciones=[]); }
/* Nombre del dueño (tercero) tolerante: usa el snapshot guardado y, si el cliente
   sigue existiendo, su nombre actual. */
function terceroNombre(cs){
  const c = cs.terceroId ? clienteById(cs.terceroId) : null;
  return (c && (c.nombre + (c.empresa?` · ${c.empresa}`:""))) || cs.terceroNombre || "—";
}
/* Alta de una consignación (nace en tránsito). */
function crearConsignacion(o){
  const c = clienteById(o.terceroId);
  const cant = Math.max(0, +o.cantidad||0);
  const cs = {
    id: uid(),
    fecha: o.fecha || new Date().toISOString().slice(0,10),
    conjuntaId: o.conjuntaId || null,
    envioRef: o.envioRef || "",
    remitoId: o.remitoId || null,                  // remito U del que salió (numeración interna)
    remitoCodigo: o.remitoCodigo || "",
    terceroId: o.terceroId || null,
    terceroNombre: c ? (c.nombre + (c.empresa?` · ${c.empresa}`:"")) : (o.terceroNombre||""),
    productoId: o.productoId, sku: o.sku||"", nombre: o.nombre||"",
    cantidad: cant,
    cantidadOrig: cant,                            // unidades con las que nació
    keptForSelect: 0,                             // acumulado retenido para Select (AR)
    keptFull: false,                              // se retuvo TODA la línea para Select
    estado: CONSIGN_ESTADOS.TRANSITO,
    costoUnit: Math.max(0, +o.costoUnit||0),      // costo de referencia (reparto), NO COGS
    costoCourierUnit: 0,                           // se agrega al recibir en AR (trazabilidad de costos)
    obs: o.obs||"",
    historial: [ { estado:CONSIGN_ESTADOS.TRANSITO, fecha:new Date().toISOString(), obs:"intake (US)" } ]
  };
  consignAll().push(cs);
  return cs;
}
/* Avanza una consignación al siguiente estado, dejando rastro. En el paso a AR se
   puede sumar un costo de courier/financiero por unidad (sólo para reporte). */
function avanzarConsignacion(id, opts){
  opts = opts||{};
  const cs = consignAll().find(x=>x.id===id); if(!cs) return null;
  const sig = consignSiguiente(cs.estado); if(!sig) return null;
  if(sig===CONSIGN_ESTADOS.AR && opts.costoCourierUnit!=null) cs.costoCourierUnit = Math.max(0, +opts.costoCourierUnit||0);
  cs.estado = sig;
  cs.historial.push({ estado:sig, fecha:new Date().toISOString(), obs:opts.obs||"" });
  save();
  return cs;
}
function borrarConsignacion(id){
  const i = consignAll().findIndex(x=>x.id===id); if(i<0) return;
  consignAll().splice(i,1); save();
}
/* Resumen por dueño × estado (unidades) para el reporte de trazabilidad. */
function consignResumenPorTercero(){
  const map = {};
  consignAll().forEach(cs=>{
    const k = cs.terceroId || "__sin";
    const row = map[k] || (map[k] = { terceroId:cs.terceroId, nombre:terceroNombre(cs), en_transito:0, en_ar:0, entregado:0, total:0 });
    row[cs.estado] = (row[cs.estado]||0) + cs.cantidad;
    row.total += cs.cantidad;
  });
  return Object.values(map).sort((a,b)=> String(a.nombre).localeCompare(String(b.nombre),"en"));
}

/* ============================================================
   VISTA POR REMITO (agrupación de terceros) — punto 1
   ------------------------------------------------------------
   En vez de mostrar la mercadería ajena producto por producto (miles de
   filas gigantes), la agrupamos por REMITO: el envío/factura del que
   nacieron. Cada remito se puede expandir para ver sus productos, tildar
   algunos y aplicar la acción SÓLO a esos (o a todos si no tildás ninguno).
   Así distinguís de qué factura viene cada cosa y no estás obligado a
   mover el remito entero de una.
   ============================================================ */
let remitoOpen = {};   // remitoKey -> true si está expandido (persiste entre renders)
let remitoSel  = {};   // consignId -> true si la línea está tildada

/* Clave de agrupación: el REMITO U (numeración interna) es la agrupación real.
   Si una línea vieja no lo tiene, caemos al documento de origen o a ref+dueño+fecha. */
function remitoKey(cs){
  return cs.remitoId ? ("rem:"+cs.remitoId)
       : cs.conjuntaId ? ("doc:"+cs.conjuntaId)
       : ("ref:"+(cs.envioRef||"—")+"|"+(cs.terceroId||"—")+"|"+(cs.fecha||"—"));
}
/* Remitos con mercadería ajena todavía EN FLUJO (tránsito o en AR; lo entregado sale). */
function remitosActivos(){
  const map = {};
  consignAll().forEach(cs=>{
    if(cs.estado===CONSIGN_ESTADOS.ENTREGADO) return;   // ya cerrado: fuera
    if((cs.cantidad||0)<=0) return;                      // absorbido por completo
    const k = remitoKey(cs);
    const g = map[k] || (map[k] = { key:k, ref:cs.envioRef||"", fecha:cs.fecha||"", conjuntaId:cs.conjuntaId||null, remitoId:cs.remitoId||null, codigo:cs.remitoCodigo||"", lineas:[], owners:new Set() });
    g.lineas.push(cs);
    if(cs.terceroId) g.owners.add(cs.terceroId);
    if(!g.fecha && cs.fecha) g.fecha = cs.fecha;
    if(!g.ref && cs.envioRef) g.ref = cs.envioRef;
    if(!g.codigo && cs.remitoCodigo) g.codigo = cs.remitoCodigo;
  });
  return Object.values(map).map(g=>{
    g.enTransito = g.lineas.filter(l=>l.estado===CONSIGN_ESTADOS.TRANSITO);
    g.enAr       = g.lineas.filter(l=>l.estado===CONSIGN_ESTADOS.AR);
    g.uTransito  = g.enTransito.reduce((a,l)=>a+l.cantidad,0);
    g.uAr        = g.enAr.reduce((a,l)=>a+l.cantidad,0);
    g.uTotal     = g.uTransito + g.uAr;
    g.ownerNames = [...g.owners].map(id=> (clienteById(id)||{}).nombre || "—");
    return g;
  }).sort((a,b)=> String(b.fecha).localeCompare(String(a.fecha)) || String(a.codigo||a.ref).localeCompare(String(b.codigo||b.ref),"en"));
}
/* ¿Cuántas unidades de este REMITO U NO se retienen para Select? = las que siguen en
   flujo (tránsito/AR sin retener) + las ya entregadas al dueño. Sirve para decidir si
   hubo un SPLIT (parte a Select, parte a terceros) → recién ahí se emite el remito A. */
function remitoUnidadesNoSelect(remitoId, conjuntaId){
  if(!remitoId && !conjuntaId) return 0;
  return consignAll().reduce((a,cs)=>{
    const match = remitoId ? (cs.remitoId===remitoId) : (cs.conjuntaId===conjuntaId);
    if(!match) return a;
    // en flujo (todavía sin decidir/entregar) o entregada al dueño (no retenida)
    if(cs.estado!==CONSIGN_ESTADOS.ENTREGADO) return a + (cs.cantidad||0);
    if(!cs.keptFull) return a + (cs.cantidad||0);   // entregada al tercero (cantidad = lo entregado)
    return a;                                        // retenida entera para Select: no cuenta
  }, 0);
}
/* Líneas destino de una acción sobre un remito: las tildadas de ESE remito,
   o todas si no hay ninguna tildada, filtradas por estado si se pide. */
function remitoTargetLines(key, estadoFiltro){
  const g = remitosActivos().find(x=>x.key===key); if(!g) return [];
  const selHere = g.lineas.filter(l=> remitoSel[l.id]);
  const base = selHere.length ? selHere : g.lineas;
  return estadoFiltro ? base.filter(l=> l.estado===estadoFiltro) : base;
}

/* ============================================================
   QUEDARSE MERCADERÍA DE TERCEROS PARA SELECT (AR) — punto 3
   ------------------------------------------------------------
   Al llegar a Argentina podés quedarte con parte de la mercadería ajena e
   ingresarla como stock VENDIBLE de Select (AR): deja de ser trazabilidad y
   pasa a ser inventario propio, entrando al FIFO con su costo (COGS real).
   Baja las unidades de la consignación (deja rastro en su historial). Si la
   consignación queda en cero, se marca cerrada.
   ============================================================ */
function quedarseParaSelect(consignId, unidades, costoUnit, obs){
  const cs = consignAll().find(x=>x.id===consignId); if(!cs) return 0;
  const q = Math.min(Math.max(0, +unidades||0), cs.cantidad);
  if(q<=0) return 0;
  const p = prodById(cs.productoId);
  if(!p){ toast("Product no longer exists for this line","warn"); return 0; }
  const store  = STORE_IDS[1] || STORE_IDS[0];             // Select (AR)
  const base   = Math.max(0, +cs.costoUnit||0);            // costo de referencia (producto)
  const landed = Math.max(0, round2(+costoUnit||0));       // costo final que entra al FIFO
  const argLeg = round2(Math.max(0, landed - base));       // lo agregado sobre el ref = tramo AR
  // ingresa a stock vendible de Select con FIFO + kardex (queda en la ficha y en Movimientos)
  fifoEntrada(p, store, q, landed, "Kept for "+storeName(store)+(cs.envioRef?(" · "+cs.envioRef):""), cs.id, { us:base, intl:0, arg:argLeg });
  moverStock(p, +q, landed, "conjunta", cs.id, "Third-party kept for "+storeName(store), { store, tipo:"tercero-keep", obs:obs||"" });
  p.ultimoCosto = landed;
  // baja de la consignación
  cs.cantidad = round4(cs.cantidad - q);
  cs.keptForSelect = round4((cs.keptForSelect||0) + q);
  cs.historial.push({ estado:cs.estado, fecha:new Date().toISOString(), obs:`kept ${qty(q)} u for ${storeName(store)}` });
  if(cs.cantidad<=0.00001){
    cs.cantidad = 0;
    // La línea se drenó: fue ENTERA para Select sólo si nunca se entregó nada al dueño.
    cs.keptFull = ((cs.keptForSelect||0) >= (cs.cantidadOrig||cs.keptForSelect||0) - 0.00001);
    cs.estado = CONSIGN_ESTADOS.ENTREGADO;                 // cerrada
    cs.obs = (cs.obs?cs.obs+" · ":"") + "kept for "+storeName(store);
  }
  return q;
}

/* ============================================================
   COSTO POR PUERTA — input con preview en vivo "= $/u" (punto 2)
   ------------------------------------------------------------
   El costo del tramo se carga como TOTAL del lote y la app lo prorratea por
   unidad. El preview deja ver al instante cuánto le suma a cada unidad, así
   se entiende dónde y cómo se capitaliza el landed en cada puerta.
   ============================================================ */
function legCostFieldHTML(id, label, hint){
  return `<div class="field" style="grid-column:1/-1"><label>${label}${hint?` <span class="hint" style="font-weight:400">${hint}</span>`:""}</label>
    <input class="inp num" id="${id}" value="0" inputmode="decimal">
    <div class="leg-pu hint" id="${id}_pu">= ${money(0,"USD")} per unit</div></div>`;
}
function wireLegPreview(inputId, totalUnits){
  const inp=document.getElementById(inputId), out=document.getElementById(inputId+"_pu");
  if(!inp||!out) return;
  const upd=()=>{ const t=Math.max(0,parseNum(inp.value)||0); const pu = totalUnits>0 ? t/totalUnits : 0;
    out.textContent = `= ${money(round2(pu),"USD")} per unit  ·  spread across ${qty(totalUnits)} u`; };
  inp.oninput=upd; upd();
}
function estadoPillMini(e){
  const col = e===CONSIGN_ESTADOS.TRANSITO ? "var(--muted)" : e===CONSIGN_ESTADOS.AR ? "var(--accent)" : "var(--up)";
  return `<span class="rm-pill" style="border-color:${col};color:${col}">${esc(consignLabel(e))}</span>`;
}

function nuevaConjLinea(){ return { key:uid(), productoId:"", sku:"", nombre:"", crear:false, total:0, aSwan:0, aTransito:0, terceroId:"", costoUnit:0, precioSwan:0 }; }
/* Ajeno de una línea = total del invoice menos lo nuestro (Swan + tránsito). Nunca negativo. */
function conjAjenoLinea(l){ return Math.max(0, (parseNum(l.total)||0) - (parseNum(l.aSwan)||0) - (parseNum(l.aTransito)||0)); }
function conjUnidadesAjenas(){ return conjDraft.lineas.reduce((a,l)=> a + conjAjenoLinea(l), 0); }

function openConjunta(pre){
  if(!isAdmin()){ toast("Only admins can load joint buys","warn"); return; }
  conjDraft = pre || {
    fecha:new Date().toISOString().slice(0,10), clienteId:"", numero:"",
    totalEnvio:"", obs:"", lineas:[ nuevaConjLinea() ]
  };
  renderConjModal();
}

function conjUnidadesNuestras(){ return conjDraft.lineas.reduce((a,l)=> a + (parseNum(l.aSwan)||0) + (parseNum(l.aTransito)||0), 0); }

function renderConjModal(){
  const cli = clienteById(conjDraft.clienteId);
  const body = `
    <p class="hint" style="margin:0 0 12px"><b>Total</b> = units of that SKU in the invoice. <b>Swan</b> = ours kept in USA · <b>→ AR</b> = ours bound for Argentina. The rest is <b>third-party</b> (not ours): pick its <b>Owner</b> and the system tracks it separately — it's only followed through the flow, never sold. <b>Cost</b> = what a unit cost YOU (0 = commission in kind). <b>Price US$</b> = optional Swan sale price.</p>
    <div class="grid-form" style="grid-template-columns:1fr 1fr;padding:0;margin-bottom:12px">
      <div class="field" style="grid-column:1/3"><label>Client (one of the 12 locales) <span class="hint" style="font-weight:400">· optional</span></label>
        <button type="button" class="ppick-btn${cli?"":" placeholder"}" id="cj_cli">
          <span class="ppick-label">${cli?esc(clienteLinea(cli)):"— pick client —"}</span><span class="ppick-caret">▾</span>
        </button></div>
      <div class="field"><label>Date</label><input class="inp" type="date" id="cj_fe" value="${esc(conjDraft.fecha)}"></div>
      <div class="field"><label>Shipment ref <span class="hint" style="font-weight:400">· optional</span></label><input class="inp" id="cj_nu" value="${esc(conjDraft.numero)}"></div>
      <div class="field"><label>Total order units <span class="hint" style="font-weight:400">· memo, doesn't touch stock</span></label><input class="inp num" id="cj_tot" value="${esc(conjDraft.totalEnvio)}" placeholder="e.g. 24"></div>
    </div>
    <div id="cjLineHost"></div>
    <button class="btn sm" id="cjAddLine" style="margin-top:10px">+ Add line</button>
    <div class="field" style="margin-top:12px"><label>Notes</label><input class="inp" id="cj_obs" value="${esc(conjDraft.obs)}"></div>
  `;
  buildModal("＋ Nueva compra conjunta (comisión)", body, [
    {label:"Cancelar",cls:"btn",act:()=>{ conjDraft=null; closeModal(); }},
    {label:"Confirmar ingreso (+stock)",cls:"btn up",act:confirmConjunta}
  ], "wide doc",
  `<div class="totrow"><span style="color:var(--muted)">Units we keep</span><span class="num" id="cjTot">${qty(conjUnidadesNuestras())}</span></div><div class="totrow"><span style="color:var(--muted)">Third-party (tracked)</span><span class="num" id="cjTotAj">${qty(conjUnidadesAjenas())}</span></div>`);
  renderConjLines();
  document.getElementById("cj_fe").oninput=e=>conjDraft.fecha=e.target.value;
  document.getElementById("cj_nu").oninput=e=>conjDraft.numero=e.target.value;
  document.getElementById("cj_tot").oninput=e=>conjDraft.totalEnvio=e.target.value;
  document.getElementById("cj_obs").oninput=e=>conjDraft.obs=e.target.value;
  document.getElementById("cjAddLine").onclick=()=>{ conjDraft.lineas.push(nuevaConjLinea()); renderConjLines(); };
  document.getElementById("cj_cli").onclick=(e)=> openConjClientePicker(e.currentTarget);
}

/* Cliente picker reutilizando el estilo del modal de venta. */
function openConjClientePicker(anchor){
  if(typeof closeProductPicker==="function") closeProductPicker();
  _pickerAnchor = anchor; anchor.classList.add("open");
  const pop = document.createElement("div"); pop.className="ppick-pop";
  pop.innerHTML = `<input class="inp ppick-search" placeholder="Search client…" autocomplete="off" spellcheck="false"><div class="ppick-list"></div>`;
  document.body.appendChild(pop);
  const search = pop.querySelector(".ppick-search"), listEl = pop.querySelector(".ppick-list");
  const paint=(q)=>{
    q=(q||"").trim().toLowerCase();
    let lista = db.clientes.slice().sort((a,b)=>String(a.nombre||"").localeCompare(String(b.nombre||""),"en"));
    if(q) lista = lista.filter(c=> ((c.nombre||"")+" "+(c.empresa||"")).toLowerCase().includes(q));
    let html = lista.map(c=>`<button type="button" class="ppick-item${c.id===conjDraft.clienteId?" active":""}" data-pickcli="${c.id}">
      <span class="pi-name">${esc(c.nombre)}${c.empresa?` · ${esc(c.empresa)}`:""}</span></button>`).join("");
    if(!lista.length) html = `<div class="ppick-empty">No clients. Add them under Customers.</div>`;
    listEl.innerHTML = html;
    listEl.querySelectorAll("[data-pickcli]").forEach(it=> it.onclick=()=>{ conjDraft.clienteId=it.dataset.pickcli; closeProductPicker(); renderConjModal(); });
  };
  paint("");
  search.oninput=()=>paint(search.value);
  positionPicker(pop, anchor);
  window.addEventListener("scroll", repositionPicker, true);
  window.addEventListener("resize", closeProductPicker);
  setTimeout(()=>{ document.addEventListener("mousedown", onPickerOutside, true); document.addEventListener("keydown", onPickerKey, true); }, 0);
  search.focus();
}

/* Picker del DUEÑO (tercero) del ajeno de UNA línea. Mismo estilo, setea l.terceroId. */
function openConjOwnerPicker(i, anchor){
  if(typeof closeProductPicker==="function") closeProductPicker();
  _pickerAnchor = anchor; anchor.classList.add("open");
  const pop = document.createElement("div"); pop.className="ppick-pop";
  pop.innerHTML = `<input class="inp ppick-search" placeholder="Search owner (client/local)…" autocomplete="off" spellcheck="false"><div class="ppick-list"></div>`;
  document.body.appendChild(pop);
  const search = pop.querySelector(".ppick-search"), listEl = pop.querySelector(".ppick-list");
  const cur = conjDraft.lineas[i].terceroId;
  const paint=(q)=>{
    q=(q||"").trim().toLowerCase();
    let lista = db.clientes.slice().sort((a,b)=>String(a.nombre||"").localeCompare(String(b.nombre||""),"en"));
    if(q) lista = lista.filter(c=> ((c.nombre||"")+" "+(c.empresa||"")).toLowerCase().includes(q));
    let html = lista.map(c=>`<button type="button" class="ppick-item${c.id===cur?" active":""}" data-pickowner="${c.id}">
      <span class="pi-name">${esc(c.nombre)}${c.empresa?` · ${esc(c.empresa)}`:""}</span></button>`).join("");
    if(!lista.length) html = `<div class="ppick-empty">No clients yet. Add the third party under Customers.</div>`;
    listEl.innerHTML = html;
    listEl.querySelectorAll("[data-pickowner]").forEach(it=> it.onclick=()=>{ conjDraft.lineas[i].terceroId=it.dataset.pickowner; closeProductPicker(); renderConjLines(); });
  };
  paint("");
  search.oninput=()=>paint(search.value);
  positionPicker(pop, anchor);
  window.addEventListener("scroll", repositionPicker, true);
  window.addEventListener("resize", closeProductPicker);
  setTimeout(()=>{ document.addEventListener("mousedown", onPickerOutside, true); document.addEventListener("keydown", onPickerKey, true); }, 0);
  search.focus();
}

function renderConjLines(){
  const host = document.getElementById("cjLineHost");
  const rows = conjDraft.lineas.map((l,i)=>{
    const newFields = l.crear ? `
      <div style="display:flex;gap:6px;margin-top:6px">
        <input class="inp" placeholder="SKU" value="${esc(l.sku)}" data-cjk="sku" data-cji="${i}" style="max-width:110px">
        <input class="inp" placeholder="New product name" value="${esc(l.nombre)}" data-cjk="nombre" data-cji="${i}">
      </div>` : "";
    const ajeno = conjAjenoLinea(l);
    const over = (parseNum(l.total)||0) > 0 && (parseNum(l.aSwan)||0)+(parseNum(l.aTransito)||0) > (parseNum(l.total)||0);
    const ter = l.terceroId ? clienteById(l.terceroId) : null;
    const ownerLbl = ter ? esc(ter.nombre) : "— owner —";
    return `<tr>
      <td style="min-width:190px">
        <div class="ppick"><button type="button" class="ppick-btn${(!l.productoId&&!l.crear)?" placeholder":""}" data-cjpick="${i}">
          <span class="ppick-label">${l.crear?"＋ New product":(l.productoId?esc((prodById(l.productoId)||{}).nombre||"—"):"— pick product —")}</span><span class="ppick-caret">▾</span></button></div>
        ${newFields}
      </td>
      <td style="width:66px"><input class="inp num" data-cjk="total" data-cji="${i}" value="${l.total}" title="Total units of this SKU in the invoice"></td>
      <td style="width:66px"><input class="inp num" data-cjk="aSwan" data-cji="${i}" value="${l.aSwan}" title="Units kept in Swan (USA)"></td>
      <td style="width:66px"><input class="inp num" data-cjk="aTransito" data-cji="${i}" value="${l.aTransito}" title="Ours, bound for AR (born in transit)"></td>
      <td style="width:70px" class="r"><span class="num" data-cjajeno="${i}" title="Third-party = Total − Swan − →AR" style="color:${over?'var(--alert)':(ajeno>0?'var(--ink)':'var(--muted)')}">${over?'!':qty(ajeno)}</span></td>
      <td style="width:150px"><button type="button" class="ppick-btn sm${ter?'':' placeholder'}" data-cjowner="${i}" title="Owner of the third-party units" ${ajeno>0?'':'disabled style="opacity:.4"'}><span class="ppick-label">${ownerLbl}</span><span class="ppick-caret">▾</span></button></td>
      <td style="width:84px"><input class="inp num" data-cjk="costoUnit" data-cji="${i}" value="${l.costoUnit}" title="What it cost YOU to get the unit (0 = commission in kind)"></td>
      <td style="width:92px"><input class="inp num" data-cjk="precioSwan" data-cji="${i}" value="${l.precioSwan||0}" title="Sale price in Swan (US$). Optional. Sets the Swan list price."></td>
      <td style="width:34px"><button class="btn ghost sm" data-cjdel="${i}" title="Remove">✕</button></td>
    </tr>`;
  }).join("");
  host.innerHTML = `<div class="table-scroll"><table class="line-tbl doc-tbl">
    <colgroup><col><col style="width:70px"><col style="width:70px"><col style="width:70px"><col style="width:74px"><col style="width:154px"><col style="width:88px"><col style="width:96px"><col style="width:40px"></colgroup>
    <thead><tr><th>Product</th><th class="r" title="Total in invoice">Total</th><th class="r" title="Swan · USA">Swan</th><th class="r" title="Ours, bound for AR (transit)">→ AR</th><th class="r" title="Third-party (auto)">3rd-party</th><th title="Owner of the third-party units">Owner</th><th class="r" title="Entry cost (0 = commission)">Cost</th><th class="r" title="Sale price in Swan (US$), optional">Price US$</th><th></th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;

  host.querySelectorAll("[data-cjpick]").forEach(b=> b.onclick=()=> openConjProductPicker(+b.dataset.cjpick, b));
  host.querySelectorAll("[data-cjowner]").forEach(b=> b.onclick=()=> openConjOwnerPicker(+b.dataset.cjowner, b));
  host.querySelectorAll("[data-cjk]").forEach(inp=>{
    const i=+inp.dataset.cji, k=inp.dataset.cjk;
    inp.oninput=()=>{
      const l=conjDraft.lineas[i];
      if(k==="total"||k==="aSwan"||k==="aTransito"||k==="costoUnit"||k==="precioSwan") l[k]=parseNum(inp.value);
      else l[k]=inp.value;
      // refrescar ajeno de la fila + totales del pie, sin re-render (no perder foco)
      if(k==="total"||k==="aSwan"||k==="aTransito"){
        const aj = conjAjenoLinea(l);
        const over = (parseNum(l.total)||0) > 0 && (parseNum(l.aSwan)||0)+(parseNum(l.aTransito)||0) > (parseNum(l.total)||0);
        const sp = host.querySelector(`[data-cjajeno="${i}"]`);
        if(sp){ sp.textContent = over?'!':qty(aj); sp.style.color = over?'var(--alert)':(aj>0?'var(--ink)':'var(--muted)'); }
        const ob = host.querySelector(`[data-cjowner="${i}"]`);
        if(ob){ if(aj>0){ ob.disabled=false; ob.style.opacity=""; } else { ob.disabled=true; ob.style.opacity=".4"; } }
        const ta=document.getElementById("cjTotAj"); if(ta) ta.textContent=qty(conjUnidadesAjenas());
      }
      const t=document.getElementById("cjTot"); if(t) t.textContent=qty(conjUnidadesNuestras());
    };
  });
  host.querySelectorAll("[data-cjdel]").forEach(b=> b.onclick=()=>{
    conjDraft.lineas.splice(+b.dataset.cjdel,1);
    if(!conjDraft.lineas.length) conjDraft.lineas.push(nuevaConjLinea());
    renderConjLines();
    const t=document.getElementById("cjTot"); if(t) t.textContent=qty(conjUnidadesNuestras());
  });
}

/* Reusa el picker de productos del modal de venta (mismo estilo), pero aplicando
   la selección en la línea de la conjunta. Lista TODOS los productos + crear nuevo. */
function openConjProductPicker(i, anchor){
  closeProductPicker();
  _pickerAnchor = anchor; anchor.classList.add("open");
  const pop = document.createElement("div"); pop.className="ppick-pop";
  pop.innerHTML = `<input class="inp ppick-search" placeholder="Search by name or SKU…" autocomplete="off" spellcheck="false"><div class="ppick-list"></div>`;
  document.body.appendChild(pop);
  const search = pop.querySelector(".ppick-search"), listEl = pop.querySelector(".ppick-list");
  const cur = conjDraft.lineas[i].productoId;
  const paint=(q)=>{
    q=(q||"").trim().toLowerCase();
    let lista = db.productos.slice().sort((a,b)=> String(a.nombre||"").localeCompare(String(b.nombre||""),"en",{numeric:true}));
    if(q) lista = lista.filter(p=> ((p.nombre||"")+" "+(p.sku||"")).toLowerCase().includes(q));
    let html = lista.map(p=>{
      const sku = p.sku ? `<span class="sku">${esc(p.sku)}</span>` : "";
      return `<button type="button" class="ppick-item${p.id===cur?" active":""}" data-cjp="${p.id}">${sku}<span class="pi-name">${esc(p.nombre)}</span></button>`;
    }).join("");
    if(!lista.length) html = `<div class="ppick-empty">No products match.</div>`;
    html += `<button type="button" class="ppick-item new" data-cjp="__new">＋ Create new product…</button>`;
    listEl.innerHTML = html;
    listEl.querySelectorAll("[data-cjp]").forEach(it=> it.onclick=()=>{
      const v=it.dataset.cjp; closeProductPicker();
      const l=conjDraft.lineas[i];
      if(v==="__new"){ l.crear=true; l.productoId=""; l.sku=""; l.nombre=""; }
      else { l.crear=false; l.productoId=v; }
      renderConjLines();
    });
  };
  paint("");
  search.oninput=()=>paint(search.value);
  positionPicker(pop, anchor);
  window.addEventListener("scroll", repositionPicker, true);
  window.addEventListener("resize", closeProductPicker);
  setTimeout(()=>{ document.addEventListener("mousedown", onPickerOutside, true); document.addEventListener("keydown", onPickerKey, true); }, 0);
  search.focus();
}

function confirmConjunta(){
  if(!isAdmin()){ toast("Only admins can load joint buys","warn"); return; }
  // resolver líneas
  const resolved = [];
  for(const l of conjDraft.lineas){
    const aSw  = Math.max(0, parseNum(l.aSwan)||0);
    const aTr  = Math.max(0, parseNum(l.aTransito)||0);
    const aj   = conjAjenoLinea(l);
    if(aSw<=0 && aTr<=0 && aj<=0) continue;   // línea vacía: se ignora
    // over-allocation: lo nuestro no puede superar el total del invoice
    if((parseNum(l.total)||0)>0 && aSw+aTr>(parseNum(l.total)||0)){
      toast("A line has more 'ours' units than the invoice total","warn"); return;
    }
    // si hay ajeno, EXIGIMOS dueño (es la única decisión manual del punto 3)
    if(aj>0 && !l.terceroId){ toast("A line has third-party units without an owner","warn"); return; }
    let p=null;
    if(l.crear){
      const dup = skuEnUso(l.sku, null);
      if(dup) p = dup;
      else {
        if(!(l.nombre||"").trim()){ toast("A new product is missing its name","warn"); return; }
        p = nuevoProductoBase(l.sku, l.nombre, 0);
        db.productos.push(p);
      }
    } else {
      p = prodById(l.productoId);
      if(!p){ toast("A line has no product assigned","warn"); return; }
    }
    resolved.push({ prod:p, total:Math.max(0,parseNum(l.total)||0), aSwan:aSw, aTransito:aTr, ajeno:aj, terceroId:l.terceroId||null, costoUnit:Math.max(0, parseNum(l.costoUnit)||0), precioSwan:Math.max(0, parseNum(l.precioSwan)||0) });
  }
  if(!resolved.length){ toast("Add at least one unit (ours or third-party)","warn"); return; }

  const cli = clienteById(conjDraft.clienteId);
  const doc = {
    id: uid(), fecha: normISO(conjDraft.fecha) || new Date().toISOString().slice(0,10),
    clienteId: conjDraft.clienteId || null,
    cliente: cli ? { nombre:cli.nombre, empresa:cli.empresa } : null,
    numero: (conjDraft.numero||"").trim(),
    totalEnvio: parseNum(conjDraft.totalEnvio)||0,   // memo del pedido total del cliente (no toca stock)
    obs: (conjDraft.obs||"").trim(),
    lineas: resolved.map(r=>({ productoId:r.prod.id, sku:r.prod.sku, nombre:r.prod.nombre, total:r.total, aSwan:r.aSwan, aTransito:r.aTransito, ajeno:r.ajeno, terceroId:r.terceroId, costoUnit:r.costoUnit }))
  };
  const refTxt = "Joint buy" + (doc.numero?(" "+doc.numero):"") + (cli?(" · "+cli.nombre):"");

  // Remito U (numerado) del envío US→AR: SÓLO lo de TERCEROS. Lo nuestro (Swan / →AR)
  // ya es stock propio, no viaja como documento de traslado. Queda guardado en
  // db.remitos y disponible en la sección Remitos (sin pop-up al guardar).
  const uRemLineas = resolved.filter(r=> r.ajeno>0 && r.terceroId)
    .map(r=>({ productoId:r.prod.id, sku:r.prod.sku, nombre:r.prod.nombre, cantidad:r.ajeno, rol:"third",
               owner:(clienteById(r.terceroId)||{}).nombre||"" }));
  let uRem = null;
  if(uRemLineas.length && typeof crearRemito==="function"){
    uRem = crearRemito({ letra:"U", tipo:"salida-us", fecha:doc.fecha, fuente:{ tipo:"conjunta", id:doc.id },
      lineas:uRemLineas, obs:refTxt });
  }

  resolved.forEach(r=>{
    const p = r.prod;
    // Unidades que quedan en SWAN (USA): stock vendible al toque, con kardex.
    if(r.aSwan>0){
      fifoEntrada(p, STORE_IDS[0], r.aSwan, r.costoUnit, refTxt, doc.id);
      moverStock(p, +r.aSwan, r.costoUnit, "conjunta", doc.id, refTxt+" · commission", { store:STORE_IDS[0], tipo:"conjunta-in" });
    }
    // Unidades NUESTRAS rumbo AR: NACEN EN TRÁNSITO (bucket, sin kardex propio, como el vault).
    // Se ENTREGAN en Select (AR) al final del recorrido (botón "Deliver in AR").
    if(r.aTransito>0){
      fifoEntrada(p, TRANSITO_STORE, r.aTransito, r.costoUnit, refTxt, doc.id);
      p.stockPorTienda[TRANSITO_STORE] = round4((p.stockPorTienda[TRANSITO_STORE]||0) + r.aTransito);
    }
    // Unidades AJENAS (de terceros): NO tocan stock/FIFO/valuación. Van al libro de
    // consignaciones (nacen en tránsito US→AR) para seguirse por separado.
    if(r.ajeno>0 && r.terceroId){
      crearConsignacion({ conjuntaId:doc.id, envioRef:doc.numero, fecha:doc.fecha, terceroId:r.terceroId,
        remitoId: uRem?uRem.id:null, remitoCodigo: uRem?uRem.codigo:"",
        productoId:p.id, sku:p.sku, nombre:p.nombre, cantidad:r.ajeno, costoUnit:r.costoUnit, obs:refTxt });
    }
    // último costo landed de referencia (sólo si cargaron un costo > 0)
    if(r.costoUnit>0){ p.costoNeto=r.costoUnit; p.costoHandling=0; p.costoFlete=0; p.ultimoCosto=r.costoUnit; }
    // precio de venta de Swan (US$), opcional: fija la lista del depósito Swan (USA)
    if(r.precioSwan>0){
      if(!p.precioVentaPorTienda) p.precioVentaPorTienda={};
      p.precioVentaPorTienda[STORE_IDS[0]] = r.precioSwan;
      p.precioVenta = r.precioSwan;   // espejo
    }
  });

  db.conjuntas.push(doc);
  conjDraft=null;
  save(); closeModal();
  const sw = doc.lineas.reduce((a,l)=>a+l.aSwan,0), tr = doc.lineas.reduce((a,l)=>a+l.aTransito,0), aj = doc.lineas.reduce((a,l)=>a+(l.ajeno||0),0);
  const remBit = uRem ? ` · remito ${uRem.codigo}` : "";
  toast(`Joint buy saved · +${qty(sw)} Swan · ${qty(tr)} in transit · ${qty(aj)} third-party${remBit}`, "up");
  render();
  // El remito queda en la sección Remitos (descargá cuando quieras). Sin pop-up.
}

/* ---- Recibir en AR: pasa unidades de TRÁNSITO a SWAN (con costo de importación opcional) ---- */
function openRecibirTransito(prodId){
  if(!isAdmin()){ toast("Only admins can receive stock","warn"); return; }
  const p = prodById(prodId); if(!p) return;
  const held = transUnits(p);
  if(held<=0){ toast("Nothing in transit for this product","warn"); return; }
  const destino = STORE_IDS[1] || STORE_IDS[0];   // depósito de AR (destino del tránsito)
  const body = `
    <p class="hint" style="margin:0 0 12px">In transit (Buenos Aires): <b>${qty(held)}</b> u · valued ${money(transValor(p), "USD")}. Delivering moves them into <b>${esc(storeName(destino))}</b> stock (sellable, AR). The <b>operator pays</b> the Argentine leg (freight + nationalization + local costs) and it's <b>capitalized into the landed cost</b>.</p>
    <div class="grid-form" style="grid-template-columns:1fr 1fr;padding:0">
      <div class="field"><label>Unidades a recibir</label><input class="inp num" id="rt_q" value="${held}"></div>
      <div class="field"><label>Puerta 3 · Arg freight + local costs <span class="hint" style="font-weight:400">· total, optional</span></label><input class="inp num" id="rt_c" value="0" inputmode="decimal"><div class="leg-pu hint" id="rt_c_pu">= ${money(0,"USD")} per unit</div></div>
      <div class="field" style="grid-column:1/3"><label>Notes</label><input class="inp" id="rt_obs" placeholder="e.g. shipment #, nationalization ref"></div>
    </div>`;
  buildModal("Recibir en AR ("+esc(storeName(destino))+")", body, [
    {label:"Cancelar",cls:"btn",act:closeModal},
    {label:"Recibir · "+storeName(destino),cls:"btn up",act:()=>{
      const q=Math.min(Math.max(0,parseNum(document.getElementById("rt_q").value)||0), transUnits(p));
      const cTot=Math.max(0,parseNum(document.getElementById("rt_c").value)||0);   // arg freight + local costs (total)
      const c = q>0 ? round2(cTot/q) : 0;                                           // prorrateo por unidad
      const obs=(document.getElementById("rt_obs").value||"").trim();
      if(q<=0){ toast("Enter a quantity","warn"); return; }
      const done = transferStock(p, TRANSITO_STORE, destino, q, c, obs, "arg");
      if(done>0){ closeModal(); toast(`Delivered ${qty(done)} u into ${storeName(destino)}${cTot>0?` · +${money(c,"USD")}/u landed`:""}`, "up"); render(); }
    }}
  ], "mini");
  // preview del landed por unidad = total ÷ unidades a recibir (se recalcula al cambiar ambos)
  const rtC=document.getElementById("rt_c"), rtQ=document.getElementById("rt_q"), rtPu=document.getElementById("rt_c_pu");
  const rtUpd=()=>{ const t=Math.max(0,parseNum(rtC.value)||0), u=Math.max(0,parseNum(rtQ.value)||0); rtPu.textContent = `= ${money(u>0?round2(t/u):0,"USD")} per unit  ·  spread across ${qty(u)} u`; };
  if(rtC&&rtQ&&rtPu){ rtC.oninput=rtUpd; rtQ.oninput=rtUpd; rtUpd(); }
}

/* ---- Enviar a tránsito: pasa unidades de un depósito vendible al bucket de tránsito.
   Caso secundario (las de AR nacen en tránsito), útil para mandar stock de Swan (USA) a AR. ---- */
function openEnviarTransito(){
  if(!isAdmin()){ toast("Only admins can move stock","warn"); return; }
  const prods = db.productos.filter(p=> STORE_IDS.some(s=> stockDe(p,s)>0))
    .sort((a,b)=> String(a.nombre||"").localeCompare(String(b.nombre||""),"en"));
  if(!prods.length){ toast("No sellable stock to send to transit","warn"); return; }
  const prodOpts = prods.map(p=>`<option value="${p.id}">${esc(p.sku?("["+p.sku+"] "):"")}${esc(p.nombre)}</option>`).join("");
  const body = `
    <p class="hint" style="margin:0 0 12px">Move sellable units into transit (Swan/USA → Buenos Aires). They leave sellable stock and become Select (AR) stock when received. The <b>operator pays</b> the leg cost — it's <b>capitalized into the landed cost</b>.</p>
    <div class="grid-form" style="grid-template-columns:1fr 1fr;padding:0">
      <div class="field" style="grid-column:1/3"><label>Product</label><select class="inp" id="et_prod">${prodOpts}</select></div>
      <div class="field"><label>From deposit</label><select class="inp" id="et_store"></select></div>
      <div class="field"><label>Units</label><input class="inp num" id="et_q" value="0"></div>
      <div class="field" style="grid-column:1/3"><label>Puerta 2 · Intl freight + wire fees <span class="hint" style="font-weight:400">· total (USD), optional</span></label><input class="inp num" id="et_cost" value="0" inputmode="decimal"><div class="leg-pu hint" id="et_cost_pu">= ${money(0,"USD")} per unit</div></div>
      <div class="field" style="grid-column:1/3"><label>Notes</label><input class="inp" id="et_obs"></div>
    </div>`;
  buildModal("Despachar a AR", body, [
    {label:"Cancelar",cls:"btn",act:closeModal},
    {label:"Despachar",cls:"btn",act:()=>{
      const p=prodById(document.getElementById("et_prod").value);
      const st=document.getElementById("et_store").value;
      if(!p||!st){ toast("Pick a product and deposit","warn"); return; }
      const q=Math.min(Math.max(0,parseNum(document.getElementById("et_q").value)||0), stockDe(p,st));
      const obs=(document.getElementById("et_obs").value||"").trim();
      if(q<=0){ toast("Enter a quantity (deposit may be empty)","warn"); return; }
      const costTot=Math.max(0,parseNum(document.getElementById("et_cost").value)||0);   // intl freight + wire fees (total)
      const costPU = q>0 ? round2(costTot/q) : 0;                                          // prorrateo por unidad
      const done = transferStock(p, st, TRANSITO_STORE, q, costPU, obs, "intl");
      if(done>0){
        // Remito U del envío propio US → AR (numeración automática)
        const uRem = crearRemito({ letra:"U", tipo:"salida-us", fuente:{ tipo:"transito", id:p.id },
          lineas:[{ productoId:p.id, sku:p.sku, nombre:p.nombre, cantidad:done, rol:"ours", owner:"" }],
          obs:obs || ("Own stock "+storeName(st)+" → AR") });
        save();
        closeModal();
        toast(`Sent ${qty(done)} u to transit · remito ${uRem.codigo}${costTot>0?` · +${money(costPU,"USD")}/u landed`:""}`, "up");
        render();
        // Remito guardado — descargalo desde la sección Remitos (sin pop-up).
      }
    }}
  ], "mini");
  // depósitos con stock del producto elegido (se actualiza al cambiar de producto)
  const fillStores=()=>{
    const p=prodById(document.getElementById("et_prod").value);
    const sel=document.getElementById("et_store");
    const conStock = STORE_IDS.filter(s=> stockDe(p,s)>0);
    sel.innerHTML = conStock.map(s=>`<option value="${s}">${esc(storeName(s))} · ${qty(stockDe(p,s))} u</option>`).join("") || `<option value="">— no stock —</option>`;
  };
  document.getElementById("et_prod").onchange=fillStores;
  fillStores();
  // preview del landed por unidad = total ÷ unidades
  const etC=document.getElementById("et_cost"), etQ=document.getElementById("et_q"), etPu=document.getElementById("et_cost_pu");
  const etUpd=()=>{ const t=Math.max(0,parseNum(etC.value)||0), u=Math.max(0,parseNum(etQ.value)||0); etPu.textContent = `= ${money(u>0?round2(t/u):0,"USD")} per unit  ·  spread across ${qty(u)} u`; };
  if(etC&&etQ&&etPu){ etC.oninput=etUpd; etQ.oninput=etUpd; etUpd(); }
}

/* ---- Merma / write-off de tránsito: baja unidades del bucket por rotura, aduana,
   extravío, etc. Consume FIFO del tránsito y deja un movimiento tipo "merma"
   (store=tránsito) para trazar la pérdida. No pasa a ningún depósito vendible. ---- */
function openMermaTransito(prodId){
  if(!isAdmin()){ toast("Only admins can write off stock","warn"); return; }
  const p = prodById(prodId); if(!p) return;
  const held = transUnits(p);
  if(held<=0){ toast("Nothing in transit for this product","warn"); return; }
  const body = `
    <p class="hint" style="margin:0 0 12px">In transit: <b>${qty(held)}</b> u. Write-off removes units that <b>won't arrive</b> (broken box, seized at customs, lost). They leave transit and do <b>not</b> become Select (AR) stock.</p>
    <div class="grid-form" style="grid-template-columns:1fr 1fr;padding:0">
      <div class="field"><label>Units to write off</label><input class="inp num" id="mm_q" value="0"></div>
      <div class="field"><label>Reason</label>
        <select class="inp" id="mm_motivo">
          <option value="broken">Broken in transit</option>
          <option value="customs">Seized / held at customs</option>
          <option value="lost">Lost</option>
          <option value="other">Other</option>
        </select></div>
      <div class="field" style="grid-column:1/3"><label>Notes</label><input class="inp" id="mm_obs"></div>
    </div>`;
  buildModal("Merma de tránsito", body, [
    {label:"Cancelar",cls:"btn",act:closeModal},
    {label:"Dar de baja",cls:"btn danger",act:()=>{
      const q=Math.min(Math.max(0,parseNum(document.getElementById("mm_q").value)||0), transUnits(p));
      if(q<=0){ toast("Enter a quantity","warn"); return; }
      const motivo=document.getElementById("mm_motivo").value;
      const obs=(document.getElementById("mm_obs").value||"").trim();
      withUndo(`Wrote off ${qty(q)} u from transit`, ()=>{
        const { unit } = fifoConsumir(p, TRANSITO_STORE, q);            // consume FIFO del tránsito
        p.stockPorTienda[TRANSITO_STORE] = round4(Math.max(0, transUnits(p) - q));
        // movimiento de merma en el bucket (la ficha lo muestra pero no lo suma al saldo vendible)
        moverStock(p, -q, unit, "merma", null, "Transit write-off · "+motivo, { store:TRANSITO_STORE, tipo:"merma", obs });
        save();
      });
      closeModal(); render();
    }}
  ]);
}

function conjClienteNombre(d){
  if(d.cliente && d.cliente.nombre) return d.cliente.nombre + (d.cliente.empresa?` · ${d.cliente.empresa}`:"");
  const c = d.clienteId ? clienteById(d.clienteId) : null;
  return c ? clienteLinea(c) : "—";
}

function deleteConjunta(id){
  const d = db.conjuntas.find(x=>x.id===id); if(!d) return;
  if(!confirm("Delete this joint buy?\n\nStock added by it (Swan + transit) will be reverted where still available. Third-party units still in transit are removed too. Units already received in AR, delivered, or sold are NOT rolled back.")) return;
  withUndo("Joint buy deleted", ()=>{
  d.lineas.forEach(l=>{
    const p = prodById(l.productoId); if(!p) return;
    // revertir Swan: quitar la capa FIFO de esta conjunta y bajar stock (clamp a 0)
    if(l.aSwan>0){
      fifoQuitarCompra(p, STORE_IDS[0], id);
      p.stockPorTienda[STORE_IDS[0]] = round4(Math.max(0, stockDe(p,STORE_IDS[0]) - l.aSwan));
      recalcStockMirror(p);
    }
    // revertir Tránsito: sólo lo que todavía esté en el bucket
    if(l.aTransito>0){
      fifoQuitarCompra(p, TRANSITO_STORE, id);
      p.stockPorTienda[TRANSITO_STORE] = round4(Math.max(0, transUnits(p) - l.aTransito));
    }
    if(typeof recomputeUltimoCosto==="function") recomputeUltimoCosto(p);
  });
  // Consignaciones (ajeno) de esta conjunta: sólo se quitan las que siguen EN TRÁNSITO
  // (todavía no avanzaron). Las ya recibidas/entregadas son hechos físicos: quedan.
  db.consignaciones = consignAll().filter(cs=> !(cs.conjuntaId===id && cs.estado===CONSIGN_ESTADOS.TRANSITO));
  db.movimientos = db.movimientos.filter(m=> m.refId!==id);
  const i = db.conjuntas.findIndex(x=>x.id===id); if(i>=0) db.conjuntas.splice(i,1);
  save();
  });
  render();
}

/* ============================================================
   RIEL GUIADO (prueba de boludo) — presentacion del flujo
   ------------------------------------------------------------
   Reemplaza el render SIN tocar el motor: cada mercaderia es un
   riel con la puerta actual encendida y UN boton = el proximo paso.
   Carril "Nuestra" (por producto, entra a stock) y carril "Tercero"
   (por remito, solo se sigue, termina en el split).
   ============================================================ */
function ensureRielCSS(){
  if(document.getElementById("rl-css")) return;
  const s = document.createElement("style"); s.id = "rl-css";
  s.textContent = `
.rl-chips{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:6px 0 20px}
.rl-chip{display:flex;flex-direction:column;gap:2px;padding:12px 14px;border-radius:var(--radius);background:var(--surface);border:1px solid var(--line);cursor:pointer}
.rl-chip:hover{border-color:var(--line-strong)}
.rl-chip .n{font-size:22px;font-weight:700;line-height:1.1}
.rl-chip .l{font-size:13px;color:var(--muted)}
.rl-chip.hot{border-color:var(--accent)}
.rl-chip.hot .n{color:var(--accent-ink)}
.rl-wrap{display:flex;flex-direction:column;gap:14px}
.rl-card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:14px 16px}
.rl-rhead{display:flex;align-items:center;gap:10px;cursor:pointer;margin-bottom:12px}
.rl-caret{color:var(--muted);font-size:12px;width:12px;flex:0 0 auto}
.rl-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px}
.rl-code{font-weight:700;font-size:15px}
.rl-meta{font-size:13px;color:var(--muted)}
.rl-badge{font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px;white-space:nowrap}
.rl-badge.ours{background:var(--up-bg);color:var(--accent-ink)}
.rl-badge.third{background:var(--surface-2);color:var(--muted);border:1px solid var(--line-strong)}
.rl-steps{display:flex;align-items:flex-start;margin:2px 2px 12px}
.rl-node{display:flex;flex-direction:column;align-items:center;gap:6px;width:100px;text-align:center;flex:0 0 auto}
.rl-dot{width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;border:1.5px solid var(--line-strong);background:var(--surface);color:var(--muted)}
.rl-dot.done{background:var(--up-bg);border-color:var(--up);color:var(--accent-ink)}
.rl-dot.cur{background:var(--accent);border-color:var(--accent);color:var(--paper)}
.rl-lab{font-size:12px;line-height:1.25;color:var(--muted)}
.rl-lab.cur{color:var(--accent-ink);font-weight:700}
.rl-conn{flex:1 1 auto;height:2px;margin-top:16px;border-radius:2px;background:var(--line-strong)}
.rl-conn.done{background:var(--up)}
.rl-foot{display:flex;align-items:center;gap:8px;flex-wrap:wrap;border-top:1px solid var(--line);padding-top:12px}
.rl-next{font-size:12px;color:var(--muted);flex:1 1 auto;min-width:120px}
.rl-warn{color:var(--alert);font-weight:600}
.rl-pill{font-size:11px;padding:2px 8px;border-radius:999px;border:1px solid var(--line-strong);color:var(--muted);white-space:nowrap}
.rl-pill.ar{border-color:var(--accent);color:var(--accent-ink)}
.rl-empty{padding:16px;text-align:center;color:var(--muted);font-size:13px}
`;
  document.head.appendChild(s);
}
/* Un riel: nodos = array de labels (con <br> si hace falta); cur = indice del paso actual (0-based). */
function rielHTML(nodes, cur){
  let h = "";
  nodes.forEach((nd, i)=>{
    if(i>0) h += `<div class="rl-conn ${i<=cur?"done":""}"></div>`;
    const st = i<cur ? "done" : (i===cur ? "cur" : "");
    const txt = i<cur ? "\u2713" : String(i+1);
    h += `<div class="rl-node"><div class="rl-dot ${st}">${txt}</div><div class="rl-lab ${i===cur?"cur":""}">${nd}</div></div>`;
  });
  return `<div class="rl-steps">${h}</div>`;
}
/* Tarjeta-riel de mercaderia NUESTRA en transito (por producto: asi vive el dato hoy). */
function ourTransitCardHTML(p){
  const u = transUnits(p), val = transValor(p);
  return `<div class="rl-card">
    <div class="rl-head">
      <span class="rl-code">${esc(p.nombre)}</span>
      <span class="rl-badge ours">Nuestra \u00b7 entra a stock</span>
      <span class="rl-meta">${esc(p.sku||"\u2014")} \u00b7 ${qty(u)} u \u00b7 ${money(val,"USD")}</span>
    </div>
    ${rielHTML(["En USA<br>(Swan)","En tr\u00e1nsito<br>a AR","Vendible<br>en AR (Select)"], 1)}
    <div class="rl-foot">
      <span class="rl-next">Ya sali\u00f3 de USA \u00b7 el pr\u00f3ximo paso es recibirla en Select (AR)</span>
      <button class="btn ghost sm" data-merma="${p.id}" style="color:var(--alert)">Merma</button>
      <button class="btn up sm" data-recib="${p.id}">Recibir en AR \u25be</button>
    </div>
  </div>`;
}
function viewConjunta(){
  ensureRielCSS();
  // --- Carril NUESTRA: productos en transito (por producto) ---
  const enTransito = db.productos.filter(p=> transUnits(p)>0)
    .sort((a,b)=> String(a.nombre||"").localeCompare(String(b.nombre||""),"en"));
  const uNuestraTransito = enTransito.reduce((a,p)=> a + transUnits(p), 0);
  const ourCards = enTransito.map(ourTransitCardHTML).join("")
    || `<div class="rl-empty">Nada nuestro en tr\u00e1nsito. Mand\u00e1 stock con \u201cDespachar a AR\u201d.</div>`;

  // --- Carril TERCEROS: consignaciones agrupadas por remito ---
  const remitos = remitosActivos();
  const remTransito = remitos.filter(g=> g.uTransito>0).length;
  const remAr       = remitos.filter(g=> g.uAr>0).length;
  const remitoCards = remitos.map(remitoCardHTML).join("")
    || `<div class="rl-empty">No hay mercader\u00eda de terceros en flujo. Entra desde Compras (tipo Tercero) o desde \u201c\uff0b Compra conjunta\u201d.</div>`;

  // --- Contadores accionables ---
  const chips = `
    <p class="hint" style="margin:0 0 6px">\u00bfQu\u00e9 hay que hacer?</p>
    <div class="rl-chips">
      <div class="rl-chip${enTransito.length?" hot":""}" data-scroll="rl-nuestra"><span class="n">${qty(uNuestraTransito)}</span><span class="l">Nuestro en tr\u00e1nsito \u00b7 recibir en AR</span></div>
      <div class="rl-chip${remTransito?" hot":""}" data-scroll="rl-terceros"><span class="n">${remTransito}</span><span class="l">Remitos de terceros \u00b7 recibir en AR</span></div>
      <div class="rl-chip${remAr?" hot":""}" data-scroll="rl-terceros"><span class="n">${remAr}</span><span class="l">Remitos de terceros \u00b7 resolver reparto</span></div>
    </div>`;

  // --- Resumen por dueno ---
  const resumen = consignResumenPorTercero();
  const resRows = resumen.map(r=>`<tr>
      <td>${esc(r.nombre)}</td>
      <td class="r num">${qty(r.en_transito||0)}</td>
      <td class="r num">${qty(r.en_ar||0)}</td>
      <td class="r num">${qty(r.entregado||0)}</td>
      <td class="r num"><b>${qty(r.total||0)}</b></td>
    </tr>`).join("") || `<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:18px">Todav\u00eda no hay mercader\u00eda de terceros.</td></tr>`;

  // --- Movimientos recientes entre depositos ---
  const tipos = { "transfer-out":"\u2192 enviado", "transfer-in":"\u2190 recibido", "conjunta":"comisi\u00f3n (ingreso)", "tercero-keep":"retenido para Select", "merma":"merma" };
  const movs = (db.movimientos||[]).filter(m=> m.tipo in tipos)
    .slice().sort((a,b)=> String(b.fecha||"").localeCompare(String(a.fecha||""))).slice(0,15);
  const movRows = movs.map(m=>{
    const p = prodById(m.productoId);
    const up = (m.delta||0) >= 0;
    return `<tr>
      <td>${esc(fmtDate(m.fecha))}</td>
      <td><span class="sku">${esc(m.sku||"\u2014")}</span> ${esc((p&&p.nombre)||m.nombre||"\u2014")}</td>
      <td>${esc(storeName(m.store))}</td>
      <td>${esc(m.ref||tipos[m.tipo]||"")}</td>
      <td class="r num" style="color:${up?'var(--up)':'var(--alert)'}">${up?"+":"\u2212"}${qty(Math.abs(m.delta||m.cantidad||0))}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:18px">Sin traspasos todav\u00eda.</td></tr>`;

  // --- Historico legacy de compras conjuntas (solo lectura) ---
  const hist = (db.conjuntas||[]).slice().sort((a,b)=> String(b.fecha||"").localeCompare(String(a.fecha||"")));
  const hayHist = hist.length>0;
  const histRows = hist.map(d=>{
    const sw = d.lineas.reduce((a,l)=>a+(l.aSwan||0),0), tr = d.lineas.reduce((a,l)=>a+l.aTransito,0), aj = d.lineas.reduce((a,l)=>a+(l.ajeno||0),0);
    return `<tr>
      <td>${esc(fmtDate(d.fecha))}</td>
      <td>${esc(conjClienteNombre(d))}</td>
      <td>${esc(d.numero||"\u2014")}</td>
      <td class="c num">${d.totalEnvio?qty(d.totalEnvio):"\u2014"}</td>
      <td class="r num">${qty(sw)}</td>
      <td class="r num">${qty(tr)}</td>
      <td class="r num">${qty(aj)}</td>
      <td class="r" style="white-space:nowrap"><button class="btn ghost sm" data-remito-doc="${d.id}" title="Remito interno (US\u2192AR)">Remito</button> <button class="btn ghost sm" data-cjdel-doc="${d.id}" style="color:var(--alert)">Borrar</button></td>
    </tr>`;
  }).join("") || `<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:18px">No hay compras conjuntas cargadas.</td></tr>`;

  return `
  <div class="head"><div class="title"><h2>Mercader\u00eda en camino \u00b7 USA \u2192 Argentina</h2><p>Cada env\u00edo es un riel: mir\u00e1 d\u00f3nde est\u00e1 la mercader\u00eda y toc\u00e1 el \u00fanico bot\u00f3n del pr\u00f3ximo paso. <b>Nuestra</b> = entra a stock. <b>Tercero</b> = s\u00f3lo se sigue y termina en un reparto.</p></div>
    <div class="actions"><button class="btn" data-enviar-transito title="Mandar stock propio USA \u2192 AR">Despachar a AR</button><button class="btn up" data-new-conj>\uff0b Compra conjunta</button></div>
  </div>

  ${chips}

  <div class="panel" id="rl-nuestra" style="margin-bottom:18px">
    <div class="phead" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <div><h3>Lo nuestro rumbo a AR</h3><p class="hint" style="margin:2px 0 0">Stock propio que ya sali\u00f3 de USA. Al recibirlo se vuelve vendible en Select (AR), sum\u00e1ndole el costo del tramo argentino. Se muestra por producto (as\u00ed se guarda hoy en tr\u00e1nsito).</p></div>
      <div style="flex:1"></div>
      ${enTransito.length?`<button class="btn ghost sm" data-deliver-all-ours>Recibir todo en AR</button>`:""}
    </div>
    <div class="rl-wrap">${ourCards}</div>
  </div>

  <div class="panel" id="rl-terceros" style="margin-bottom:18px">
    <div class="phead" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <div><h3>Terceros (consignaci\u00f3n)</h3><p class="hint" style="margin:2px 0 0">Mercader\u00eda ajena que s\u00f3lo seguimos (nunca es stock ni P&amp;L). Toc\u00e1 un remito para ver sus productos, tild\u00e1 los que quieras y aplic\u00e1 la acci\u00f3n s\u00f3lo a esos.</p></div>
      <div style="flex:1"></div>
      ${remTransito?`<button class="btn ghost sm" data-cs-recib-all>Recibir todo en AR</button>`:""}
      ${remAr?`<button class="btn ghost sm" data-cs-entregar-all>Entregar todo</button>`:""}
    </div>
    <div class="rl-wrap">${remitoCards}</div>
  </div>

  <div class="panel" style="margin-bottom:18px">
    <div class="phead"><h3>Terceros \u00b7 por due\u00f1o</h3><span class="hint">qui\u00e9n es el due\u00f1o y d\u00f3nde est\u00e1</span></div>
    <div class="table-scroll"><table>
      <thead><tr><th>Due\u00f1o</th><th class="r">En tr\u00e1nsito</th><th class="r">En AR</th><th class="r">Entregado</th><th class="r">Total</th></tr></thead>
      <tbody>${resRows}</tbody></table></div>
  </div>

  <div class="panel"${hayHist?' style="margin-bottom:18px"':''}>
    <div class="phead"><h3>Movimientos recientes entre dep\u00f3sitos</h3></div>
    <div class="table-scroll"><table>
      <thead><tr><th>Fecha</th><th>Producto</th><th>Dep\u00f3sito</th><th>Movimiento</th><th class="r">Unid.</th></tr></thead>
      <tbody>${movRows}</tbody></table></div>
  </div>

  ${hayHist?`<div class="panel">
    <div class="phead"><h3>Compras conjuntas (hist\u00f3rico)</h3><span class="hint">flujo viejo \u00b7 s\u00f3lo lectura</span></div>
    <div class="table-scroll"><table>
      <thead><tr><th>Fecha</th><th>Cliente</th><th>Ref</th><th class="c">Pedido</th><th class="r">Swan</th><th class="r">\u2192 AR</th><th class="r">Tercero</th><th></th></tr></thead>
      <tbody>${histRows}</tbody></table></div>
  </div>`:""}`;
}

/* ============================================================
   ACCIONES MASIVAS (para no ir uno por uno con miles de productos)
   ============================================================ */
/* Recibir TODAS las consignaciones en tránsito → AR de una. */
function recibirTodasConsign(){
  if(!isAdmin()){ toast("Only admins can receive stock","warn"); return; }
  const list = consignAll().filter(cs=> cs.estado===CONSIGN_ESTADOS.TRANSITO);
  if(!list.length){ toast("Nothing in transit","warn"); return; }
  const u = list.reduce((a,cs)=> a+cs.cantidad, 0);
  if(!confirm(`Receive ALL third-party in transit into AR?\n\n${list.length} item(s) · ${qty(u)} u\nYou can still add courier costs later, item by item.`)) return;
  list.forEach(cs=> avanzarConsignacion(cs.id, { obs:"bulk receive in AR" }));
  toast(`Received ${list.length} third-party item(s) in AR`,"up"); render();
}
/* Entregar TODAS las consignaciones que están en AR → entregado de una. */
function entregarTodasConsign(){
  if(!isAdmin()){ toast("Only admins can deliver","warn"); return; }
  const list = consignAll().filter(cs=> cs.estado===CONSIGN_ESTADOS.AR);
  if(!list.length){ toast("None in AR to deliver","warn"); return; }
  const u = list.reduce((a,cs)=> a+cs.cantidad, 0);
  if(!confirm(`Mark ALL third-party in AR as delivered?\n\n${list.length} item(s) · ${qty(u)} u\nThis closes their tracking.`)) return;
  list.forEach(cs=> avanzarConsignacion(cs.id, { obs:"bulk delivered" }));
  toast(`Delivered ${list.length} third-party item(s)`,"up"); render();
}
/* Entregar en AR TODO el stock PROPIO en tránsito, con un costo Arg total opcional
   prorrateado sobre el total de unidades (capitalizado, tramo "arg"). */
function openDeliverAllOurs(){
  if(!isAdmin()){ toast("Only admins can receive stock","warn"); return; }
  const prods = db.productos.filter(p=> transUnits(p)>0);
  const totalU = prods.reduce((a,p)=> a+transUnits(p), 0);
  if(!prods.length || totalU<=0){ toast("Nothing of ours in transit","warn"); return; }
  const destino = STORE_IDS[1] || STORE_IDS[0];
  const body = `
    <p class="hint" style="margin:0 0 14px">Deliver <b>everything of ours in transit</b> into <b>${esc(storeName(destino))}</b> (sellable): <b>${prods.length}</b> product(s) · <b>${qty(totalU)}</b> u. The Argentine leg cost (freight + local costs) is <b>spread across all units</b> and capitalized.</p>
    <div class="grid-form stack" style="padding:0">
      ${legCostFieldHTML("da_cost","Puerta 3 · Arg freight + local costs","· total for the whole batch, optional")}
      <div class="field" style="grid-column:1/-1"><label>Notes</label><input class="inp" id="da_obs" placeholder="e.g. shipment #, nationalization ref"></div>
    </div>`;
  buildModal("Recibir todo en AR ("+esc(storeName(destino))+")", body, [
    {label:"Cancelar",cls:"btn",act:closeModal},
    {label:"Recibir todo · "+qty(totalU)+" u",cls:"btn up",act:()=>{
      const costTot=Math.max(0,parseNum(document.getElementById("da_cost").value)||0);
      const perU = totalU>0 ? round2(costTot/totalU) : 0;
      const obs=(document.getElementById("da_obs").value||"").trim();
      let done=0, items=0;
      prods.forEach(p=>{ const q=transUnits(p); if(q>0){ const d=transferStock(p, TRANSITO_STORE, destino, q, perU, obs, "arg"); if(d>0){ done+=d; items++; } } });
      closeModal(); toast(`Delivered ${qty(done)} u across ${items} product(s)${costTot>0?` · +${money(perU,"USD")}/u landed`:""}`,"up"); render();
    }}
  ], "mini");
  wireLegPreview("da_cost", totalU);
}

/* ---- Recibir consignación (ajeno) en AR: en_transito → en_ar, con courier opcional ---- */
function openRecibirConsignacion(id){
  if(!isAdmin()){ toast("Only admins can receive stock","warn"); return; }
  const cs = consignAll().find(x=>x.id===id); if(!cs) return;
  const body = `
    <p class="hint" style="margin:0 0 14px"><b>${esc(cs.nombre)}</b> · owner <b>${esc(terceroNombre(cs))}</b> · <b>${qty(cs.cantidad)}</b> u. Marks them <b>received in AR</b> (still not ours, still tracked). Add courier/financial cost per unit for cost-sharing (optional — doesn't affect margin).</p>
    <div class="grid-form stack" style="padding:0">
      <div class="field"><label>Courier / financial cost per unit <span class="hint" style="font-weight:400">· optional</span></label><input class="inp num" id="csc_c" value="${cs.costoCourierUnit||0}"></div>
      <div class="field"><label>Notes</label><input class="inp" id="csc_obs" placeholder="e.g. arrival ref"></div>
    </div>`;
  buildModal("Receive third-party in AR", body, [
    {label:"Cancelar",cls:"btn",act:closeModal},
    {label:"Mark received in AR",cls:"btn up",act:()=>{
      const c=Math.max(0,parseNum(document.getElementById("csc_c").value)||0);
      const obs=(document.getElementById("csc_obs").value||"").trim();
      avanzarConsignacion(id, { costoCourierUnit:c, obs });
      closeModal(); toast("Third-party units received in AR","up"); render();
    }}
  ], "mini");
}
/* ---- Entregar consignación: en_ar → entregado (pasamanos al tercero) ---- */
function entregarConsignacion(id){
  if(!isAdmin()){ toast("Only admins can deliver","warn"); return; }
  const cs = consignAll().find(x=>x.id===id); if(!cs) return;
  if(!confirm(`Mark as delivered to ${terceroNombre(cs)}?\n\n${cs.nombre} · ${qty(cs.cantidad)} u\nThis closes the tracking for these units.`)) return;
  avanzarConsignacion(id, { obs:"delivered" });
  toast("Marked delivered","up"); render();
}
function removeConsignacion(id){
  if(!isAdmin()){ toast("Only admins can edit tracking","warn"); return; }
  const cs = consignAll().find(x=>x.id===id); if(!cs) return;
  if(!confirm(`Remove these third-party units from tracking?\n\n${cs.nombre} · ${qty(cs.cantidad)} u · ${terceroNombre(cs)}`)) return;
  borrarConsignacion(id); toast("Removed from tracking","warn"); render();
}

/* ============================================================
   RENDER DE UN REMITO (colapsable) — punto 1
   ============================================================ */
function remitoCardHTML(g){
  const open   = !!remitoOpen[g.key];
  const owners = g.ownerNames.length ? g.ownerNames.join(", ") : "\u2014";
  const cur    = g.uTransito>0 ? 0 : 1;   // en transito -> paso 1 (idx 0); ya en AR -> paso 2 (idx 1)
  const pills  = [
    g.uTransito>0 ? `<span class="rl-pill">${qty(g.uTransito)} en tr\u00e1nsito</span>` : "",
    g.uAr>0       ? `<span class="rl-pill ar">${qty(g.uAr)} en AR</span>` : ""
  ].filter(Boolean).join(" ");
  const head = `<div class="rl-rhead" data-remito-toggle="${esc(g.key)}">
      <span class="rl-caret">${open?"\u25be":"\u25b8"}</span>
      <div style="flex:1;min-width:0">
        <div class="rl-code">${g.codigo?esc(g.codigo):esc(g.ref||"(sin ref)")}</div>
        <div class="rl-meta">${g.codigo&&g.ref?esc(g.ref)+" \u00b7 ":""}${esc(fmtDate(g.fecha))} \u00b7 ${g.lineas.length} producto(s) \u00b7 ${qty(g.uTotal)} u</div>
      </div>
      <span class="rl-badge third">Tercero \u00b7 ${esc(owners)}</span>
    </div>`;

  const rows = g.lineas.map(cs=>`<tr>
      <td class="c"><input type="checkbox" class="rm-chk" data-rmsel="${cs.id}" ${remitoSel[cs.id]?"checked":""}></td>
      <td><span class="sku">${esc(cs.sku||"\u2014")}</span></td>
      <td>${esc(cs.nombre)}</td>
      <td>${esc(terceroNombre(cs))}</td>
      <td class="c">${estadoPillMini(cs.estado)}</td>
      <td class="r num">${qty(cs.cantidad)}</td>
      <td class="r"><button class="btn ghost xs" data-cs-del="${cs.id}" title="Sacar del seguimiento" style="color:var(--alert)">\u2715</button></td>
    </tr>`).join("");
  const tabla = open ? `<div class="table-scroll" style="margin-bottom:10px"><table class="rm-tbl">
      <thead><tr><th class="c"><input type="checkbox" class="rm-chkall" data-rmall="${esc(g.key)}"></th><th>SKU</th><th>Producto</th><th>Due\u00f1o</th><th class="c">Estado</th><th class="r">Unid.</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table></div>` : "";

  const selHere     = g.lineas.filter(l=> remitoSel[l.id]);
  const scopeLines  = selHere.length ? selHere : g.lineas;
  const hasTransito = scopeLines.some(l=> l.estado===CONSIGN_ESTADOS.TRANSITO);
  const hasAr       = scopeLines.some(l=> l.estado===CONSIGN_ESTADOS.AR);
  const foot = `<div class="rl-foot">
      <span class="rl-next">${selHere.length?`${selHere.length} tildada(s)`:"acci\u00f3n sobre todo el remito"}${hasAr?` \u00b7 <span class="rl-warn">\u26a0 el reparto emite remito A y toca stock</span>`:""}</span>
      ${g.remitoId?`<button class="btn ghost sm" data-rm-pdf="${esc(g.remitoId)}" title="Descargar remito ${esc(g.codigo||"")}">\u2913 ${esc(g.codigo||"remito")}</button>`:""}
      ${hasTransito?`<button class="btn up sm" data-rm-receive="${esc(g.key)}" title="Puerta 2 \u00b7 tr\u00e1nsito \u2192 AR">Recibir en AR \u25be</button>`:""}
      ${hasAr?`<button class="btn up sm" data-rm-resolve="${esc(g.key)}" title="Repartir: comisi\u00f3n \u2192 Select \u00b7 resto \u2192 due\u00f1o">Resolver reparto \u25be</button>`:""}
    </div>`;

  return `<div class="rl-card">
    ${head}
    ${rielHTML(["En tr\u00e1nsito<br>a AR","En AR<br>(en nuestras manos)","Resuelto<br>(split / entrega)"], cur)}
    ${pills?`<div style="margin:0 2px 10px;display:flex;gap:6px;flex-wrap:wrap">${pills}</div>`:""}
    ${tabla}
    ${foot}
  </div>`;
}

/* ---- Recibir en AR las líneas EN TRÁNSITO del remito (courier compartido) ---- */
function openRecibirRemito(key){
  if(!isAdmin()){ toast("Only admins can receive stock","warn"); return; }
  const lines = remitoTargetLines(key, CONSIGN_ESTADOS.TRANSITO);
  if(!lines.length){ toast("No in-transit lines to receive here","warn"); return; }
  const totalU = lines.reduce((a,l)=>a+l.cantidad,0);
  const list = lines.map(cs=>`<tr><td>${esc(cs.nombre)}<div class="hint">${esc(cs.sku||"")} · ${esc(terceroNombre(cs))}</div></td><td class="r num">${qty(cs.cantidad)}</td></tr>`).join("");
  const body = `
    <p class="hint" style="margin:0 0 16px"><b>Receive ${lines.length} line(s)</b> · ${qty(totalU)} u into <b>AR</b> (still third-party, still tracked). The courier / financial cost is <b>optional</b> and only for cost-sharing reports — it doesn't touch stock or margin.</p>
    <div class="recv-grid">
      <div class="recv-list">
        <div class="recv-list-head">Products <span class="hint">· ${lines.length} line(s) · ${qty(totalU)} u</span></div>
        <div class="table-scroll recv-scroll"><table class="rm-tbl"><thead><tr><th>Product</th><th class="r">Units</th></tr></thead><tbody>${list}</tbody></table></div>
      </div>
      <div class="recv-side">
        <div class="grid-form stack" style="padding:0;gap:16px">
          ${legCostFieldHTML("rr_c","Courier / financial cost","· total for the batch, optional")}
          <div class="field"><label>Notes</label><input class="inp" id="rr_obs" placeholder="e.g. arrival ref"></div>
        </div>
      </div>
    </div>`;
  buildModal("Recibir en AR · terceros", body, [
    {label:"Cancelar",cls:"btn",act:closeModal},
    {label:"Recibir · "+qty(totalU)+" u",cls:"btn up",act:()=>{
      const tot = Math.max(0,parseNum(document.getElementById("rr_c").value)||0);
      const perU = totalU>0 ? round2(tot/totalU) : 0;
      const obs = (document.getElementById("rr_obs").value||"").trim();
      lines.forEach(cs=> avanzarConsignacion(cs.id, { costoCourierUnit:perU, obs }));
      lines.forEach(l=> delete remitoSel[l.id]);
      closeModal(); toast(`Received ${lines.length} line(s) in AR${tot>0?` · +${money(perU,"USD")}/u courier`:""}`,"up"); render();
    }}
  ], "recv");
  wireLegPreview("rr_c", totalU);
}

/* ---- Resolver en AR: repartir cada línea del remito entre Select (comisión
   nuestra) y el tercero (dueño). Si hay REPARTO (algo a Select Y algo al tercero)
   se emiten DOS remitos A citando al U: uno para el tercero (con costo acumulado
   + markup = lo que se cobra) y uno para Select (ingreso a nuestro stock). Si va
   todo a un solo lado, NO se emite A. ---- */
function openResolverAR(key){
  if(!isAdmin()){ toast("Only admins can move stock","warn"); return; }
  const lines = remitoTargetLines(key, CONSIGN_ESTADOS.AR);
  if(!lines.length){ toast("No in-AR lines to resolve (receive them first)","warn"); return; }
  const store = STORE_IDS[1] || STORE_IDS[0];
  const rows = lines.map((cs,i)=>{
    const acc = round2((cs.costoUnit||0)+(cs.costoCourierUnit||0));   // costo acumulado (2 puertas)
    return `<tr>
      <td>${esc(cs.nombre)}<div class="hint">${esc(cs.sku||"")} · ${esc(terceroNombre(cs))}</div></td>
      <td class="r num">${qty(cs.cantidad)}</td>
      <td><input class="inp num res-q" id="rq_${i}" value="0" data-max="${cs.cantidad}" inputmode="numeric"></td>
      <td class="r num" id="rt_${i}">${qty(cs.cantidad)}</td>
      <td class="r num">${money(acc,"USD")}</td>
      <td><input class="inp num" id="rc_${i}" value="${acc}" inputmode="decimal" title="Cost the Select units enter at (FIFO/COGS)"></td>
    </tr>`;
  }).join("");
  const body = `
    <p class="hint" style="margin:0 0 10px">Split each product between <b>${esc(storeName(store))}</b> (our commission — enters our sellable stock) and the <b>owner</b> (their goods — delivered, never our stock). The owner is charged the <b>accumulated cost + markup</b>. A split issues two <b>A</b> remitos citing the U; all-to-one-side issues none.</p>
    <div class="table-scroll" style="max-height:230px;margin-bottom:12px"><table class="rm-tbl">
      <thead><tr><th>Product</th><th class="r">In AR</th><th style="width:84px">→ Select</th><th class="r" style="width:70px">→ Owner</th><th class="r">Acc. cost</th><th style="width:104px">Select cost/u</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <div class="grid-form" style="grid-template-columns:1fr 1fr;padding:0">
      ${legCostFieldHTML("res_extra","Extra Arg leg cost (our Select units)","· total, optional — spread across kept units")}
      <div class="field"><label>Owner markup <span class="hint" style="font-weight:400">· % over accumulated cost, optional</span></label><input class="inp num" id="res_mk" value="0" inputmode="decimal"><div class="leg-pu hint" id="res_mk_pu">no markup</div></div>
      <div class="field" style="grid-column:1/-1"><label>Notes</label><input class="inp" id="res_obs" placeholder="e.g. split reason"></div>
    </div>`;
  buildModal("Resolver reparto · "+esc(store===STORE_IDS[1]?storeName(store):"AR"), body, [
    {label:"Cancelar",cls:"btn",act:closeModal},
    {label:"Resolver",cls:"btn up",act:()=>{
      // contexto del U (antes de mutar)
      const remId  = lines[0] && lines[0].remitoId || null;
      const conjId = lines[0] && lines[0].conjuntaId || null;
      const uRemito = remId ? remitoById(remId) : null;
      const uCodigo = uRemito ? uRemito.codigo : ((lines[0]&&lines[0].remitoCodigo)||"U");
      const mkPct = Math.max(0, parseNum(document.getElementById("res_mk").value)||0);
      const obs   = (document.getElementById("res_obs").value||"").trim();
      // total a Select para prorratear el extra
      let totalSelU=0;
      lines.forEach((cs,i)=>{ totalSelU += Math.min(Math.max(0,parseNum(document.getElementById("rq_"+i).value)||0), cs.cantidad); });
      const extraTot = Math.max(0,parseNum(document.getElementById("res_extra").value)||0);
      const extraPU  = totalSelU>0 ? round2(extraTot/totalSelU) : 0;

      const selLines=[], terLines=[];
      let selU=0, terU=0;
      lines.forEach((cs,i)=>{
        const inAr = cs.cantidad;
        const sel  = Math.min(Math.max(0,parseNum(document.getElementById("rq_"+i).value)||0), inAr);
        const ter  = round4(inAr - sel);
        const acc  = round2((cs.costoUnit||0)+(cs.costoCourierUnit||0));
        // 1) lo del tercero: cobro = costo acumulado + markup (se calcula ANTES de mutar)
        if(ter>0){
          const chargeU = round2(acc*(1+mkPct/100));
          terLines.push({ productoId:cs.productoId, sku:cs.sku, nombre:cs.nombre, cantidad:ter, rol:"third", owner:terceroNombre(cs), costoUnit:acc, charge:chargeU });
          terU += ter;
        }
        // 2) lo nuestro a Select: ingresa al stock (reduce la consignación / la cierra)
        if(sel>0){
          const cost = round2((parseNum(document.getElementById("rc_"+i).value)||0) + extraPU);
          const kept = quedarseParaSelect(cs.id, sel, cost, obs);
          if(kept>0){ selLines.push({ productoId:cs.productoId, sku:cs.sku, nombre:cs.nombre, cantidad:kept, rol:"select", owner:terceroNombre(cs), costoUnit:cost }); selU += kept; }
        }
        // 3) entregar al tercero lo que le queda a la consignación (lo no retenido)
        if(ter>0){ avanzarConsignacion(cs.id, { obs:"delivered (resolve)" }); }
        delete remitoSel[cs.id];
      });

      if(selU<=0 && terU<=0){ toast("Nothing to resolve","warn"); return; }

      // Dos remitos A SÓLO si hubo REPARTO (algo a Select Y algo al tercero)
      let aSel=null, aTer=null;
      if(selU>0 && terU>0){
        const origen = uRemito ? { id:uRemito.id, codigo:uRemito.codigo } : { id:null, codigo:uCodigo };
        aTer = crearRemito({ letra:"A", tipo:"ar-tercero", fuente:{ tipo:"resolve", id:(remId||conjId) }, origen, lineas:terLines, obs:(obs?obs+" · ":"")+"to owner"+(mkPct>0?` · +${mkPct}% markup`:"") });
        aSel = crearRemito({ letra:"A", tipo:"ar-select",  fuente:{ tipo:"resolve", id:(remId||conjId) }, origen, lineas:selLines, obs:(obs?obs+" · ":"")+"to Select (our commission)" });
      }
      save(); closeModal();
      if(aSel && aTer){
        toast(`Split ${uCodigo} → ${aTer.codigo} (owner) + ${aSel.codigo} (Select) · in Remitos`,"up");
        // Ambos remitos A quedan guardados y se descargan desde la sección Remitos.
      } else if(selU>0){
        toast(`Kept ${qty(selU)} u for ${storeName(store)} · no split, no A`,"up");
      } else {
        toast(`Delivered ${qty(terU)} u to owner${mkPct>0?` · +${mkPct}% markup`:""} · no split, no A`,"up");
      }
      render();
    }}
  ], "wide");
  // previews en vivo: "→ Owner" por fila, extra prorrateado y markup
  const recalc=()=>{
    let t=0;
    lines.forEach((cs,i)=>{
      const sel=Math.min(Math.max(0,parseNum(document.getElementById("rq_"+i).value)||0), cs.cantidad);
      const cell=document.getElementById("rt_"+i); if(cell) cell.textContent=qty(round4(cs.cantidad-sel));
      t+=sel;
    });
    wireLegPreview("res_extra", t);
  };
  lines.forEach((cs,i)=>{ const el=document.getElementById("rq_"+i); if(el) el.addEventListener("input", recalc); });
  const mk=document.getElementById("res_mk"), mkOut=document.getElementById("res_mk_pu");
  if(mk&&mkOut){ const upd=()=>{ const p=Math.max(0,parseNum(mk.value)||0); mkOut.textContent = p>0?`owner charge = accumulated cost + ${p}%`:"no markup"; }; mk.oninput=upd; upd(); }
  recalc();
}

/* Wireo de la vista (lo llama wire() en 16-view-datos.js). */
function wireConjunta(){
  const m = document.getElementById("main"); if(!m) return;
  const nb = m.querySelector("[data-new-conj]"); if(nb) nb.onclick=()=> openConjunta();
  const et = m.querySelector("[data-enviar-transito]"); if(et) et.onclick=()=> openEnviarTransito();
  const cra = m.querySelector("[data-cs-recib-all]"); if(cra) cra.onclick=()=> recibirTodasConsign();
  const cea = m.querySelector("[data-cs-entregar-all]"); if(cea) cea.onclick=()=> entregarTodasConsign();
  const daa = m.querySelector("[data-deliver-all-ours]"); if(daa) daa.onclick=()=> openDeliverAllOurs();
  m.querySelectorAll("[data-recib]").forEach(b=> b.onclick=()=> openRecibirTransito(b.dataset.recib));
  m.querySelectorAll("[data-merma]").forEach(b=> b.onclick=()=> openMermaTransito(b.dataset.merma));
  m.querySelectorAll("[data-cjdel-doc]").forEach(b=> b.onclick=()=> deleteConjunta(b.dataset.cjdelDoc));
  m.querySelectorAll("[data-remito-doc]").forEach(b=> b.onclick=()=> generarRemitoPDF(b.dataset.remitoDoc));
  m.querySelectorAll("[data-cs-recib]").forEach(b=> b.onclick=()=> openRecibirConsignacion(b.dataset.csRecib));
  m.querySelectorAll("[data-cs-entregar]").forEach(b=> b.onclick=()=> entregarConsignacion(b.dataset.csEntregar));
  m.querySelectorAll("[data-cs-del]").forEach(b=> b.onclick=()=> removeConsignacion(b.dataset.csDel));
  // Contadores clickeables: llevan a la seccion correspondiente
  m.querySelectorAll("[data-scroll]").forEach(c=> c.onclick=()=>{ const el=document.getElementById(c.dataset.scroll); if(el) el.scrollIntoView({behavior:"smooth",block:"start"}); });
  // --- Vista por remito ---
  m.querySelectorAll("[data-remito-toggle]").forEach(h=> h.onclick=()=>{ const k=h.dataset.remitoToggle; remitoOpen[k]=!remitoOpen[k]; render(); });
  m.querySelectorAll("[data-rmsel]").forEach(cb=> cb.onchange=()=>{ if(cb.checked) remitoSel[cb.dataset.rmsel]=true; else delete remitoSel[cb.dataset.rmsel]; render(); });
  m.querySelectorAll("[data-rmall]").forEach(cb=> cb.onchange=()=>{
    const g = remitosActivos().find(x=>x.key===cb.dataset.rmall);
    if(g) g.lineas.forEach(l=>{ if(cb.checked) remitoSel[l.id]=true; else delete remitoSel[l.id]; });
    render();
  });
  m.querySelectorAll("[data-rm-receive]").forEach(b=> b.onclick=()=> openRecibirRemito(b.dataset.rmReceive));
  m.querySelectorAll("[data-rm-resolve]").forEach(b=> b.onclick=()=> openResolverAR(b.dataset.rmResolve));
  m.querySelectorAll("[data-rm-pdf]").forEach(b=> b.onclick=(e)=>{ e.stopPropagation(); generarRemitoDocPDF(b.dataset.rmPdf); });
}
