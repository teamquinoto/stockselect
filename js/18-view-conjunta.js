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
  return e===CONSIGN_ESTADOS.TRANSITO ? "In transit (US→AR)"
       : e===CONSIGN_ESTADOS.AR       ? "In AR (to deliver)"
       : e===CONSIGN_ESTADOS.ENTREGADO? "Delivered"
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
  const cs = {
    id: uid(),
    fecha: o.fecha || new Date().toISOString().slice(0,10),
    conjuntaId: o.conjuntaId || null,
    envioRef: o.envioRef || "",
    terceroId: o.terceroId || null,
    terceroNombre: c ? (c.nombre + (c.empresa?` · ${c.empresa}`:"")) : (o.terceroNombre||""),
    productoId: o.productoId, sku: o.sku||"", nombre: o.nombre||"",
    cantidad: Math.max(0, +o.cantidad||0),
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

/* Clave de agrupación: el documento de origen (conjuntaId) es el remito real.
   Si no lo hay (factura 100% de terceros), caemos a ref+dueño+fecha. */
function remitoKey(cs){
  return cs.conjuntaId ? ("doc:"+cs.conjuntaId)
       : ("ref:"+(cs.envioRef||"—")+"|"+(cs.terceroId||"—")+"|"+(cs.fecha||"—"));
}
/* Remitos con mercadería ajena todavía EN FLUJO (tránsito o en AR; lo entregado sale). */
function remitosActivos(){
  const map = {};
  consignAll().forEach(cs=>{
    if(cs.estado===CONSIGN_ESTADOS.ENTREGADO) return;   // ya cerrado: fuera
    if((cs.cantidad||0)<=0) return;                      // absorbido por completo
    const k = remitoKey(cs);
    const g = map[k] || (map[k] = { key:k, ref:cs.envioRef||"", fecha:cs.fecha||"", conjuntaId:cs.conjuntaId||null, lineas:[], owners:new Set() });
    g.lineas.push(cs);
    if(cs.terceroId) g.owners.add(cs.terceroId);
    if(!g.fecha && cs.fecha) g.fecha = cs.fecha;
    if(!g.ref && cs.envioRef) g.ref = cs.envioRef;
  });
  return Object.values(map).map(g=>{
    g.enTransito = g.lineas.filter(l=>l.estado===CONSIGN_ESTADOS.TRANSITO);
    g.enAr       = g.lineas.filter(l=>l.estado===CONSIGN_ESTADOS.AR);
    g.uTransito  = g.enTransito.reduce((a,l)=>a+l.cantidad,0);
    g.uAr        = g.enAr.reduce((a,l)=>a+l.cantidad,0);
    g.uTotal     = g.uTransito + g.uAr;
    g.ownerNames = [...g.owners].map(id=> (clienteById(id)||{}).nombre || "—");
    return g;
  }).sort((a,b)=> String(b.fecha).localeCompare(String(a.fecha)) || String(a.ref).localeCompare(String(b.ref),"en"));
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
  cs.historial.push({ estado:cs.estado, fecha:new Date().toISOString(), obs:`kept ${qty(q)} u for ${storeName(store)}` });
  if(cs.cantidad<=0.00001){
    cs.cantidad = 0;
    cs.estado = CONSIGN_ESTADOS.ENTREGADO;                 // cerrada: se fue toda a Select
    cs.obs = (cs.obs?cs.obs+" · ":"") + "fully kept for "+storeName(store);
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
  buildModal("＋ New joint buy (commission)", body, [
    {label:"Cancel",cls:"btn",act:()=>{ conjDraft=null; closeModal(); }},
    {label:"Confirm intake (+stock)",cls:"btn up",act:confirmConjunta}
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
  const savedId = doc.id;
  conjDraft=null;
  save(); closeModal();
  const sw = doc.lineas.reduce((a,l)=>a+l.aSwan,0), tr = doc.lineas.reduce((a,l)=>a+l.aTransito,0), aj = doc.lineas.reduce((a,l)=>a+(l.ajeno||0),0);
  toast(`Joint buy saved · +${qty(sw)} Swan · ${qty(tr)} in transit · ${qty(aj)} third-party`, "up");
  render();
  // Ofrecer el remito interno (documento que viaja EEUU→AR con cantidades filtradas)
  if((tr+aj)>0 && typeof generarRemitoPDF==="function"){
    setTimeout(()=>{ if(confirm("Generate the internal transfer note (remito) for the US→AR shipment?")) generarRemitoPDF(savedId); }, 250);
  }
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
      <div class="field"><label>Units to receive</label><input class="inp num" id="rt_q" value="${held}"></div>
      <div class="field"><label>Puerta 3 · Arg freight + local costs <span class="hint" style="font-weight:400">· total, optional</span></label><input class="inp num" id="rt_c" value="0" inputmode="decimal"><div class="leg-pu hint" id="rt_c_pu">= ${money(0,"USD")} per unit</div></div>
      <div class="field" style="grid-column:1/3"><label>Notes</label><input class="inp" id="rt_obs" placeholder="e.g. shipment #, nationalization ref"></div>
    </div>`;
  buildModal("Deliver in AR ("+esc(storeName(destino))+")", body, [
    {label:"Cancel",cls:"btn",act:closeModal},
    {label:"Mark delivered · "+storeName(destino),cls:"btn up",act:()=>{
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
  buildModal("Send to transit (to AR)", body, [
    {label:"Cancel",cls:"btn",act:closeModal},
    {label:"Send to transit",cls:"btn",act:()=>{
      const p=prodById(document.getElementById("et_prod").value);
      const st=document.getElementById("et_store").value;
      if(!p||!st){ toast("Pick a product and deposit","warn"); return; }
      const q=Math.min(Math.max(0,parseNum(document.getElementById("et_q").value)||0), stockDe(p,st));
      const obs=(document.getElementById("et_obs").value||"").trim();
      if(q<=0){ toast("Enter a quantity (deposit may be empty)","warn"); return; }
      const costTot=Math.max(0,parseNum(document.getElementById("et_cost").value)||0);   // intl freight + wire fees (total)
      const costPU = q>0 ? round2(costTot/q) : 0;                                          // prorrateo por unidad
      const done = transferStock(p, st, TRANSITO_STORE, q, costPU, obs, "intl");
      if(done>0){ closeModal(); toast(`Sent ${qty(done)} u to transit${costTot>0?` · +${money(costPU,"USD")}/u landed`:""}`, "up"); render(); }
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
  buildModal("Write-off from transit", body, [
    {label:"Cancel",cls:"btn",act:closeModal},
    {label:"Write off",cls:"btn danger",act:()=>{
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

function viewConjunta(){
  const enTransito = db.productos.filter(p=> transUnits(p)>0)
    .sort((a,b)=> String(a.nombre||"").localeCompare(String(b.nombre||""),"en"));
  const kOurTransit = enTransito.map(p=>`<div class="kcard">
      <div class="kt">${esc(p.nombre)}</div>
      <div class="km"><span>${esc(p.sku||"—")}</span><span>${qty(transUnits(p))} u · ${money(transValor(p),"USD")}</span></div>
      <div class="ka"><button class="btn up sm" data-recib="${p.id}">Deliver in AR ▾</button><button class="btn ghost sm" data-merma="${p.id}" title="Write-off (loss)" style="color:var(--alert)">✕</button></div>
    </div>`).join("") || `<div class="kcol-empty">Nothing in transit.</div>`;
  const recibidosSwan = (db.movimientos||[]).filter(m=> m.tipo==="transfer-in")
    .slice().sort((a,b)=> String(b.fecha||"").localeCompare(String(a.fecha||""))).slice(0,6);
  const kOurReceived = recibidosSwan.map(m=>{ const p=prodById(m.productoId); return `<div class="kcard" style="border-left-color:var(--up)">
      <div class="kt">${esc((p&&p.nombre)||m.nombre||"—")}</div>
      <div class="km"><span>${esc(fmtDate(m.fecha))}</span><span>+${qty(Math.abs(m.delta||m.cantidad||0))} u</span></div>
    </div>`; }).join("") || `<div class="kcol-empty">Nothing received recently.</div>`;

  const hist = (db.conjuntas||[]).slice().sort((a,b)=> String(b.fecha||"").localeCompare(String(a.fecha||"")));
  const histRows = hist.map(d=>{
    const sw = d.lineas.reduce((a,l)=>a+(l.aSwan||0),0), tr = d.lineas.reduce((a,l)=>a+l.aTransito,0), aj = d.lineas.reduce((a,l)=>a+(l.ajeno||0),0);
    return `<tr>
      <td>${esc(fmtDate(d.fecha))}</td>
      <td>${esc(conjClienteNombre(d))}</td>
      <td>${esc(d.numero||"—")}</td>
      <td class="c num">${d.totalEnvio?qty(d.totalEnvio):"—"}</td>
      <td class="r num">${qty(sw)}</td>
      <td class="r num">${qty(tr)}</td>
      <td class="r num">${qty(aj)}</td>
      <td class="r" style="white-space:nowrap"><button class="btn ghost sm" data-remito-doc="${d.id}" title="Internal transfer note (US→AR)">Remito</button> <button class="btn ghost sm" data-cjdel-doc="${d.id}" style="color:var(--alert)">Delete</button></td>
    </tr>`;
  }).join("") || `<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:18px">No joint buys loaded yet.</td></tr>`;

  // ---- Terceros (consignaciones): mercadería ajena que sólo seguimos, por estado ----
  const activas = consignAll().filter(cs=> cs.estado!==CONSIGN_ESTADOS.ENTREGADO)
    .sort((a,b)=> (CONSIGN_ORDEN.indexOf(a.estado)-CONSIGN_ORDEN.indexOf(b.estado)) || String(a.terceroNombre).localeCompare(String(b.terceroNombre),"en"));
  // Agrupado por REMITO (colapsable) — reemplaza el kanban plano de antes.
  const remitos = remitosActivos();
  const remitoCards = remitos.map(remitoCardHTML).join("")
    || `<div class="kcol-empty" style="padding:16px">No third-party in flow. New units come in from Purchases (invoice type = Third-party).</div>`;

  // ---- Resumen por dueño × estado ----
  const resumen = consignResumenPorTercero();
  const resRows = resumen.map(r=>`<tr>
      <td>${esc(r.nombre)}</td>
      <td class="r num">${qty(r.en_transito||0)}</td>
      <td class="r num">${qty(r.en_ar||0)}</td>
      <td class="r num">${qty(r.entregado||0)}</td>
      <td class="r num"><b>${qty(r.total||0)}</b></td>
    </tr>`).join("") || `<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:18px">No third-party merchandise yet.</td></tr>`;
  const ajActivas = activas.reduce((a,cs)=> a + cs.cantidad, 0);

  // Movimientos entre depósitos (traspasos, comisión, recepciones y mermas) — para verlos de un vistazo.
  const tipos = { "transfer-out":"→ sent", "transfer-in":"← received", "conjunta":"commission in", "tercero-keep":"kept for Select", "merma":"write-off" };
  const movs = (db.movimientos||[]).filter(m=> m.tipo in tipos)
    .slice().sort((a,b)=> String(b.fecha||"").localeCompare(String(a.fecha||""))).slice(0,15);
  const movRows = movs.map(m=>{
    const p = prodById(m.productoId);
    const up = (m.delta||0) >= 0;
    return `<tr>
      <td>${esc(fmtDate(m.fecha))}</td>
      <td><span class="sku">${esc(m.sku||"—")}</span> ${esc((p&&p.nombre)||m.nombre||"—")}</td>
      <td>${esc(storeName(m.store))}</td>
      <td>${esc(m.ref||tipos[m.tipo]||"")}</td>
      <td class="r num" style="color:${up?'var(--up)':'var(--alert)'}">${up?"+":"−"}${qty(Math.abs(m.delta||m.cantidad||0))}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:18px">No transfers yet.</td></tr>`;

  const inTransit3 = activas.filter(cs=>cs.estado===CONSIGN_ESTADOS.TRANSITO).reduce((a,cs)=>a+cs.cantidad,0);
  const inAR3      = activas.filter(cs=>cs.estado===CONSIGN_ESTADOS.AR).reduce((a,cs)=>a+cs.cantidad,0);
  const hayHist    = (db.conjuntas||[]).length>0;   // sólo mostramos el histórico legacy si hay algo

  return `
  <div class="head"><div class="title"><h2>Third-party monitor</h2><p>Third-party merchandise in our hands and where it is (US transit → AR → delivered). It's only tracked — never our stock, valuation or P&amp;L. New third-party units come in from <b>Purchases</b> (invoice type = Third-party).</p></div>
    <div class="actions"><button class="btn" data-enviar-transito title="Move our own stock USA → AR">Send our stock to transit</button></div>
  </div>
  <div class="kpis" style="grid-template-columns:repeat(4,1fr);margin-bottom:18px">
    <div class="kpi"><div class="lbl">3rd-party · in transit</div><div class="val">${qty(inTransit3)}</div><div class="sub">US → AR</div></div>
    <div class="kpi"><div class="lbl">3rd-party · in AR to deliver</div><div class="val">${qty(inAR3)}</div><div class="sub">in our hands, in AR</div></div>
    <div class="kpi"><div class="lbl">3rd-party · total held</div><div class="val">${qty(ajActivas)}</div><div class="sub">not ours · in flow</div></div>
    <div class="kpi"><div class="lbl">Ours · in transit to AR</div><div class="val">${qty(unidadesEnTransitoAR())}</div><div class="sub">${money(valorEnTransitoAR(),"USD")} · sellable once received</div></div>
  </div>

  <div class="panel" style="margin-bottom:18px">
    <div class="phead" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <div><h3>Third-party by remito</h3><p class="hint" style="margin:2px 0 0">Grouped by the shipment / invoice they came in. Tap a remito to open it, tick the products you want, then <b>receive them in AR</b>, <b>keep some for Select</b> (adds to sellable AR stock) or <b>hand them to the owner</b>.</p></div>
      <div style="flex:1"></div>
      ${activas.some(cs=>cs.estado===CONSIGN_ESTADOS.TRANSITO)?`<button class="btn ghost sm" data-cs-recib-all title="Receive every in-transit line at once">Receive all in AR</button>`:""}
      ${activas.some(cs=>cs.estado===CONSIGN_ESTADOS.AR)?`<button class="btn ghost sm" data-cs-entregar-all title="Deliver every in-AR line to their owners">Deliver all</button>`:""}
    </div>
    <div class="rm-list">${remitoCards}</div>
  </div>

  <div class="panel" style="margin-bottom:18px">
    <div class="phead"><h3>Third-party · by owner</h3><span class="hint">who owns it and where</span></div>
    <div class="table-scroll"><table>
      <thead><tr><th>Owner</th><th class="r">In transit</th><th class="r">In AR</th><th class="r">Delivered</th><th class="r">Total</th></tr></thead>
      <tbody>${resRows}</tbody></table></div>
  </div>

  <div class="panel" style="margin-bottom:18px">
    <div class="phead"><h3>Ours · pipeline to AR</h3><span class="hint">our own stock moving USA → AR · receiving makes it sellable</span></div>
    <div class="kanban" style="grid-template-columns:1fr 1fr">
      <div class="kcol"><div class="kct" style="display:flex;align-items:center;gap:8px">In transit → AR <span class="kn">${enTransito.length}</span>${enTransito.length?`<button class="btn up sm" data-deliver-all-ours style="margin-left:auto">Deliver all in AR</button>`:""}</div>${kOurTransit}</div>
      <div class="kcol"><div class="kct">Received <span class="kn">${recibidosSwan.length}</span></div>${kOurReceived}</div>
    </div>
  </div>

  <div class="panel"${hayHist?' style="margin-bottom:18px"':''}>
    <div class="phead"><h3>Recent movements between deposits</h3></div>
    <div class="table-scroll"><table>
      <thead><tr><th>Date</th><th>Product</th><th>Deposit</th><th>Movement</th><th class="r">Units</th></tr></thead>
      <tbody>${movRows}</tbody></table></div>
  </div>

  ${hayHist?`<div class="panel">
    <div class="phead"><h3>Legacy joint buys</h3><span class="hint">old flow · read-only history</span></div>
    <div class="table-scroll"><table>
      <thead><tr><th>Date</th><th>Client</th><th>Ref</th><th class="c">Order</th><th class="r">Swan</th><th class="r">→ AR</th><th class="r">3rd-party</th><th></th></tr></thead>
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
  buildModal("Deliver all in AR ("+esc(storeName(destino))+")", body, [
    {label:"Cancel",cls:"btn",act:closeModal},
    {label:"Deliver all · "+qty(totalU)+" u",cls:"btn up",act:()=>{
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
    {label:"Cancel",cls:"btn",act:closeModal},
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
  const owners = g.ownerNames.length ? g.ownerNames.join(", ") : "—";
  const pills  = [
    g.uTransito>0 ? `<span class="rm-pill transit">${qty(g.uTransito)} in transit</span>` : "",
    g.uAr>0       ? `<span class="rm-pill ar">${qty(g.uAr)} in AR</span>` : ""
  ].filter(Boolean).join("");
  const head = `<div class="rm-head" data-remito-toggle="${esc(g.key)}">
      <span class="rm-caret">${open?"▾":"▸"}</span>
      <div class="rm-id"><b>${esc(g.ref||"(no ref)")}</b><span class="rm-sub">${esc(fmtDate(g.fecha))} · ${esc(owners)} · ${g.lineas.length} product(s) · ${qty(g.uTotal)} u</span></div>
      <div class="rm-pills">${pills}</div>
    </div>`;
  if(!open) return `<div class="rm-card">${head}</div>`;

  // Expandido: filas COMPACTAS (aplanadas), con checkbox y estado por línea.
  const rows = g.lineas.map(cs=>`<tr>
      <td class="c"><input type="checkbox" class="rm-chk" data-rmsel="${cs.id}" ${remitoSel[cs.id]?"checked":""}></td>
      <td><span class="sku">${esc(cs.sku||"—")}</span></td>
      <td>${esc(cs.nombre)}</td>
      <td>${esc(terceroNombre(cs))}</td>
      <td class="c">${estadoPillMini(cs.estado)}</td>
      <td class="r num">${qty(cs.cantidad)}</td>
      <td class="r"><button class="btn ghost xs" data-cs-del="${cs.id}" title="Remove from tracking" style="color:var(--alert)">✕</button></td>
    </tr>`).join("");

  // Acciones: sobre las tildadas de ESTE remito, o sobre todas si no hay ninguna.
  const selHere    = g.lineas.filter(l=> remitoSel[l.id]);
  const scopeLines = selHere.length ? selHere : g.lineas;
  const hasTransito = scopeLines.some(l=> l.estado===CONSIGN_ESTADOS.TRANSITO);
  const hasAr       = scopeLines.some(l=> l.estado===CONSIGN_ESTADOS.AR);
  const bar = `<div class="rm-actions">
      <span class="rm-scope">${selHere.length?`${selHere.length} selected`:"acting on the whole remito"}</span>
      <div style="flex:1"></div>
      ${hasTransito?`<button class="btn up sm" data-rm-receive="${esc(g.key)}" title="Puerta 2 · US transit → AR">Receive in AR ▾</button>`:""}
      ${hasAr?`<button class="btn sm" data-rm-keep="${esc(g.key)}" title="Puerta 3 · keep units as Select (AR) sellable stock">↳ Keep for Select ▾</button>`:""}
      ${hasAr?`<button class="btn ghost sm" data-rm-deliver="${esc(g.key)}" title="Hand over to the owner (closes tracking)">Deliver to owner</button>`:""}
    </div>`;

  return `<div class="rm-card open">${head}
    <div class="rm-body"><div class="table-scroll"><table class="rm-tbl">
      <thead><tr><th class="c"><input type="checkbox" class="rm-chkall" data-rmall="${esc(g.key)}"></th><th>SKU</th><th>Product</th><th>Owner</th><th class="c">State</th><th class="r">Units</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table></div>${bar}</div>
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
    <p class="hint" style="margin:0 0 12px"><b>Receive ${lines.length} line(s)</b> · ${qty(totalU)} u into <b>AR</b> (still third-party, still tracked). The courier / financial cost is <b>optional</b> and only for cost-sharing reports — it doesn't touch stock or margin.</p>
    <div class="table-scroll" style="max-height:180px;margin-bottom:12px"><table class="rm-tbl"><thead><tr><th>Product</th><th class="r">Units</th></tr></thead><tbody>${list}</tbody></table></div>
    <div class="grid-form stack" style="padding:0">
      ${legCostFieldHTML("rr_c","Courier / financial cost","· total for the batch, optional")}
      <div class="field" style="grid-column:1/-1"><label>Notes</label><input class="inp" id="rr_obs" placeholder="e.g. arrival ref"></div>
    </div>`;
  buildModal("Receive in AR · third-party", body, [
    {label:"Cancel",cls:"btn",act:closeModal},
    {label:"Receive · "+qty(totalU)+" u",cls:"btn up",act:()=>{
      const tot = Math.max(0,parseNum(document.getElementById("rr_c").value)||0);
      const perU = totalU>0 ? round2(tot/totalU) : 0;
      const obs = (document.getElementById("rr_obs").value||"").trim();
      lines.forEach(cs=> avanzarConsignacion(cs.id, { costoCourierUnit:perU, obs }));
      lines.forEach(l=> delete remitoSel[l.id]);
      closeModal(); toast(`Received ${lines.length} line(s) in AR${tot>0?` · +${money(perU,"USD")}/u courier`:""}`,"up"); render();
    }}
  ], "mini");
  wireLegPreview("rr_c", totalU);
}

/* ---- Quedarse para Select las líneas EN AR del remito (punto 3) ---- */
function openKeepForSelect(key){
  if(!isAdmin()){ toast("Only admins can move stock","warn"); return; }
  const lines = remitoTargetLines(key, CONSIGN_ESTADOS.AR);
  if(!lines.length){ toast("No in-AR lines to keep here (receive them first)","warn"); return; }
  const store = STORE_IDS[1] || STORE_IDS[0];
  const rows = lines.map((cs,i)=>{
    const ref = round2((cs.costoUnit||0)+(cs.costoCourierUnit||0));
    return `<tr>
      <td>${esc(cs.nombre)}<div class="hint">${esc(cs.sku||"")} · ${esc(terceroNombre(cs))}</div></td>
      <td class="r num">${qty(cs.cantidad)}</td>
      <td><input class="inp num keep-q" id="kq_${i}" value="0" data-max="${cs.cantidad}" inputmode="numeric"></td>
      <td><input class="inp num" id="kc_${i}" value="${ref}" inputmode="decimal"></td>
    </tr>`;
  }).join("");
  const body = `
    <p class="hint" style="margin:0 0 12px">Keep units as <b>${esc(storeName(store))}</b> sellable stock. They <b>leave third-party tracking</b> and enter your inventory at the unit cost you set (its FIFO/COGS). Whatever you don't keep stays tracked to hand over to the owner.</p>
    <div class="table-scroll" style="max-height:230px;margin-bottom:12px"><table class="rm-tbl">
      <thead><tr><th>Product</th><th class="r">In AR</th><th style="width:92px">Keep</th><th style="width:110px">Unit cost</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <div class="grid-form stack" style="padding:0">
      ${legCostFieldHTML("k_extra","Extra Arg leg cost","· freight / nationalization total, optional — spread across kept units")}
      <div class="field" style="grid-column:1/-1"><label>Notes</label><input class="inp" id="k_obs" placeholder="e.g. why we kept these"></div>
    </div>`;
  buildModal("Keep for "+esc(storeName(store)), body, [
    {label:"Cancel",cls:"btn",act:closeModal},
    {label:"Keep for "+esc(storeName(store)),cls:"btn up",act:()=>{
      // total a quedarse (para prorratear el extra)
      let totalKeep=0;
      lines.forEach((cs,i)=>{ const q=Math.min(Math.max(0,parseNum(document.getElementById("kq_"+i).value)||0), cs.cantidad); totalKeep+=q; });
      if(totalKeep<=0){ toast("Enter how many units to keep","warn"); return; }
      const extraTot = Math.max(0,parseNum(document.getElementById("k_extra").value)||0);
      const extraPU  = totalKeep>0 ? round2(extraTot/totalKeep) : 0;
      const obs = (document.getElementById("k_obs").value||"").trim();
      let done=0, items=0;
      lines.forEach((cs,i)=>{
        const q = Math.min(Math.max(0,parseNum(document.getElementById("kq_"+i).value)||0), cs.cantidad);
        if(q<=0) return;
        const cost = round2((parseNum(document.getElementById("kc_"+i).value)||0) + extraPU);
        const kept = quedarseParaSelect(cs.id, q, cost, obs);
        if(kept>0){ done+=kept; items++; if((cs.cantidad||0)<=0) delete remitoSel[cs.id]; }
      });
      save(); closeModal();
      toast(done>0?`Kept ${qty(done)} u for ${storeName(store)} across ${items} product(s)`:"Nothing kept","up");
      render();
    }}
  ], "wide");
  // preview del extra prorrateado sobre lo que se está por quedar (se recalcula al tipear cantidades)
  const recalcExtra=()=>{ let t=0; lines.forEach((cs,i)=>{ t+=Math.min(Math.max(0,parseNum(document.getElementById("kq_"+i).value)||0), cs.cantidad); }); wireLegPreview("k_extra", t); };
  lines.forEach((cs,i)=>{ const el=document.getElementById("kq_"+i); if(el) el.addEventListener("input", recalcExtra); });
  recalcExtra();
}

/* ---- Entregar al dueño las líneas EN AR del remito ---- */
function entregarRemito(key){
  if(!isAdmin()){ toast("Only admins can deliver","warn"); return; }
  const lines = remitoTargetLines(key, CONSIGN_ESTADOS.AR);
  if(!lines.length){ toast("No in-AR lines to deliver here","warn"); return; }
  const u = lines.reduce((a,l)=>a+l.cantidad,0);
  if(!confirm(`Mark ${lines.length} line(s) · ${qty(u)} u as delivered to the owner?\nThis closes their tracking.`)) return;
  lines.forEach(cs=> avanzarConsignacion(cs.id, { obs:"delivered" }));
  lines.forEach(l=> delete remitoSel[l.id]);
  toast(`Delivered ${lines.length} line(s)`,"up"); render();
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
  // --- Vista por remito (punto 1) ---
  m.querySelectorAll("[data-remito-toggle]").forEach(h=> h.onclick=()=>{ const k=h.dataset.remitoToggle; remitoOpen[k]=!remitoOpen[k]; render(); });
  m.querySelectorAll("[data-rmsel]").forEach(cb=> cb.onchange=()=>{ if(cb.checked) remitoSel[cb.dataset.rmsel]=true; else delete remitoSel[cb.dataset.rmsel]; render(); });
  m.querySelectorAll("[data-rmall]").forEach(cb=> cb.onchange=()=>{
    const g = remitosActivos().find(x=>x.key===cb.dataset.rmall);
    if(g) g.lineas.forEach(l=>{ if(cb.checked) remitoSel[l.id]=true; else delete remitoSel[l.id]; });
    render();
  });
  m.querySelectorAll("[data-rm-receive]").forEach(b=> b.onclick=()=> openRecibirRemito(b.dataset.rmReceive));
  m.querySelectorAll("[data-rm-keep]").forEach(b=> b.onclick=()=> openKeepForSelect(b.dataset.rmKeep));
  m.querySelectorAll("[data-rm-deliver]").forEach(b=> b.onclick=()=> entregarRemito(b.dataset.rmDeliver));
}
