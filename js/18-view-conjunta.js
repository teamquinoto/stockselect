/* ============================================================
   gestordestock — 18-view-conjunta.js
   Part of the app. Loaded as a <script> in the ORDER from index.html.
   Everything lives in global scope (no modules), same as before.
   ============================================================ */
/* ============================================================
   JOINT BUY (commission received in kind) + TRANSIT
   ------------------------------------------------------------
   Business model: one of AR's 12 locales buys from a supplier
   from the US. We bring the merchandise and charge commission IN CARDS.
   From the client's total order we keep only a part:
     · units kept in SELECT (USA)  -> sellable stock in the US right away.
     · units bound for AR            -> born IN TRANSIT (bucket, not
       sellable) and become SWAN stock when received in Argentina.
   We do NOT load the client's units: they aren't ours (only, optionally, a
   memo of the shipment total for traceability). Default entry cost 0
   (pure commission; the client pays supplier + import). Configurable.
   ============================================================ */
let conjDraft = null;

/* ============================================================
   CONSIGNMENTS — THIRD-PARTY merchandise (others') that is only TRACKED
   ------------------------------------------------------------
   Lives 100% apart from sellable stock: doesn't touch stockPorTienda, nor FIFO,
   no valuation, no P&L (client rule: third-party goods are NOT sold, only
   tracked). Each record is {product, owner (clienteId), quantity,
   estado}. States = journey gates: en_transito (dispatched in
   US) → en_ar (received in Argentina) → entregado (handoff to the owner).
   costoUnit is a REFERENCE COST (to split courier/financial cost),
   never a COGS. Every state change leaves a trace in `historial` (audit).
   ============================================================ */
const CONSIGN_ESTADOS = { TRANSITO:"en_transito", AR:"en_ar", ENTREGADO:"entregado" };
const CONSIGN_ORDEN = [CONSIGN_ESTADOS.TRANSITO, CONSIGN_ESTADOS.AR, CONSIGN_ESTADOS.ENTREGADO];
function consignLabel(e){
  return e===CONSIGN_ESTADOS.TRANSITO ? t("conj.cs.transit")
       : e===CONSIGN_ESTADOS.AR       ? t("conj.cs.ar")
       : e===CONSIGN_ESTADOS.ENTREGADO? t("conj.cs.delivered")
       : (e||"—");
}
function consignSiguiente(e){ const i=CONSIGN_ORDEN.indexOf(e); return (i>=0 && i<CONSIGN_ORDEN.length-1) ? CONSIGN_ORDEN[i+1] : null; }
function consignAll(){ return db.consignaciones || (db.consignaciones=[]); }
/* Owner (third-party) name, tolerant: uses the saved snapshot and, if the client
   sigue existiendo, su nombre actual. */
function terceroNombre(cs){
  const c = cs.terceroId ? clienteById(cs.terceroId) : null;
  return (c && (c.nombre + (c.empresa?` · ${c.empresa}`:""))) || cs.terceroNombre || "—";
}
/* Create a consignment (born in transit). */
function crearConsignacion(o){
  const c = clienteById(o.terceroId);
  const cant = Math.max(0, +o.cantidad||0);
  const cs = {
    id: uid(),
    fecha: o.fecha || new Date().toISOString().slice(0,10),
    conjuntaId: o.conjuntaId || null,
    envioRef: o.envioRef || "",
    remitoId: o.remitoId || null,                  // remito U it left on (internal numbering)
    remitoCodigo: o.remitoCodigo || "",
    terceroId: o.terceroId || null,
    terceroNombre: c ? (c.nombre + (c.empresa?` · ${c.empresa}`:"")) : (o.terceroNombre||""),
    productoId: o.productoId, sku: o.sku||"", nombre: o.nombre||"",
    cantidad: cant,
    cantidadOrig: cant,                            // units it was born with
    keptForSelect: 0,                             // accumulated kept for Select (AR)
    keptFull: false,                              // whole line was kept for Select
    estado: CONSIGN_ESTADOS.TRANSITO,
    costoUnit: Math.max(0, +o.costoUnit||0),      // reference cost (for the split), NOT COGS
    costoCourierUnit: 0,                           // added when received in AR (cost traceability)
    obs: o.obs||"",
    historial: [ { estado:CONSIGN_ESTADOS.TRANSITO, fecha:new Date().toISOString(), obs:"intake (US)" } ]
  };
  consignAll().push(cs);
  return cs;
}
/* Advances a consignment to the next state, leaving a trace. On the step to AR it
   can add a courier/financial cost per unit (report only). */
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
/* Summary by owner × state (units) for the traceability report. */
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
   PER-REMITO VIEW (third-party grouping) — point 1
   ------------------------------------------------------------
   Instead of showing third-party merchandise product by product (thousands of
   huge rows), we group it by REMITO: the shipment/invoice it
   came from. Each remito can be expanded to see its products, tick
   some and apply the action ONLY to those (or to all if you tick none).
   That way you tell which invoice each thing comes from and aren't forced to
   move the whole remito at once.
   ============================================================ */
let remitoOpen = {};   // remitoKey -> true if expanded (persists between renders)
let remitoSel  = {};   // consignId -> true if the line is ticked

/* Grouping key: the REMITO U (internal numbering) is the real grouping.
   If an old line lacks it, we fall back to the source document or to ref+owner+date. */
function remitoKey(cs){
  return cs.remitoId ? ("rem:"+cs.remitoId)
       : cs.conjuntaId ? ("doc:"+cs.conjuntaId)
       : ("ref:"+(cs.envioRef||"—")+"|"+(cs.terceroId||"—")+"|"+(cs.fecha||"—"));
}
/* Remitos with third-party merchandise still IN FLOW (transit or in AR; delivered drops out). */
function remitosActivos(){
  const map = {};
  consignAll().forEach(cs=>{
    if(cs.estado===CONSIGN_ESTADOS.ENTREGADO) return;   // already closed: skip
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
/* How many units of this REMITO U are NOT kept for Select? = those still in
   flow (transit/AR not kept) + those already delivered to the owner. Used to decide if
   there was a SPLIT (part to Select, part to owner) → only then is the A remito issued. */
function remitoUnidadesNoSelect(remitoId, conjuntaId){
  if(!remitoId && !conjuntaId) return 0;
  return consignAll().reduce((a,cs)=>{
    const match = remitoId ? (cs.remitoId===remitoId) : (cs.conjuntaId===conjuntaId);
    if(!match) return a;
    // in flow (still undecided/undelivered) or delivered to the owner (not kept)
    if(cs.estado!==CONSIGN_ESTADOS.ENTREGADO) return a + (cs.cantidad||0);
    if(!cs.keptFull) return a + (cs.cantidad||0);   // entregada al tercero (cantidad = lo entregado)
    return a;                                        // retenida entera para Select: no cuenta
  }, 0);
}
/* Target lines of an action on a remito: the ticked ones of THAT remito,
   or all of them if none is ticked, filtered by state if requested. */
function remitoTargetLines(key, estadoFiltro){
  const g = remitosActivos().find(x=>x.key===key); if(!g) return [];
  const selHere = g.lineas.filter(l=> remitoSel[l.id]);
  const base = selHere.length ? selHere : g.lineas;
  return estadoFiltro ? base.filter(l=> l.estado===estadoFiltro) : base;
}

/* ============================================================
   KEEP THIRD-PARTY MERCHANDISE FOR SELECT (AR) — point 3
   ------------------------------------------------------------
   On arrival in Argentina you can keep part of the third-party merchandise and
   enter it as SELLABLE Select (AR) stock: it stops being just tracking and
   becomes our own inventory, entering FIFO with its cost (real COGS).
   Reduces the consignment's units (leaves a trace in its history). If the
   consignment reaches zero, it's marked closed.
   ============================================================ */
function quedarseParaSelect(consignId, unidades, costoUnit, obs){
  const cs = consignAll().find(x=>x.id===consignId); if(!cs) return 0;
  const q = Math.min(Math.max(0, +unidades||0), cs.cantidad);
  if(q<=0) return 0;
  const p = prodById(cs.productoId);
  if(!p){ toast(t("conj.tt.prodgone"),"warn"); return 0; }
  const store  = STORE_IDS[1] || STORE_IDS[0];             // Select (AR)
  const base   = Math.max(0, +cs.costoUnit||0);            // costo de referencia (producto)
  const landed = Math.max(0, round2(+costoUnit||0));       // costo final que entra al FIFO
  const argLeg = round2(Math.max(0, landed - base));       // lo agregado sobre el ref = tramo AR
  // enters Select's sellable stock with FIFO + kardex (shows in the product card and in Movements)
  fifoEntrada(p, store, q, landed, t("conj.obs.keptfor",{store:storeName(store)})+(cs.envioRef?(" · "+cs.envioRef):""), cs.id, { us:base, intl:0, arg:argLeg });
  moverStock(p, +q, landed, "conjunta", cs.id, t("conj.obs.thirdkeptfor",{store:storeName(store)}), { store, tipo:"tercero-keep", obs:obs||"" });
  p.ultimoCosto = landed;
  // reduce the consignment
  cs.cantidad = round4(cs.cantidad - q);
  cs.keptForSelect = round4((cs.keptForSelect||0) + q);
  cs.historial.push({ estado:cs.estado, fecha:new Date().toISOString(), obs:`kept ${qty(q)} u for ${storeName(store)}` });
  if(cs.cantidad<=0.00001){
    cs.cantidad = 0;
    // The line drained: it was ENTIRELY for Select only if nothing was ever delivered to the owner.
    cs.keptFull = ((cs.keptForSelect||0) >= (cs.cantidadOrig||cs.keptForSelect||0) - 0.00001);
    cs.estado = CONSIGN_ESTADOS.ENTREGADO;                 // closed
    cs.obs = (cs.obs?cs.obs+" · ":"") + "kept for "+storeName(store);
  }
  return q;
}

/* ============================================================
   COST PER GATE — input with live "= $/u" preview (point 2)
   ------------------------------------------------------------
   The leg cost is entered as the batch TOTAL and the app prorates it per
   unit. The preview shows instantly how much it adds to each unit, so
   you understand where and how the landed cost is capitalized at each gate.
   ============================================================ */
/* Cost field WITH per-gate currency (USD/ARS). Everything is unified to USD:
   if ARS is chosen we ask for the rate (ARS per US$1, prefilled from the global
   tc()) and legCostRead() divides by it. The engine only ever sees USD. */
function legCostFieldHTML(id, label, hint, opts){
  opts = opts || {};
  const val = (opts.value!=null) ? opts.value : "0";
  const pu  = opts.noPreview ? "" : `<div class="leg-pu hint" id="${id}_pu">${t("conj.leg.perunit",{m:money(0,"USD")})}</div>`;
  return `<div class="field" style="grid-column:1/-1"><label>${label}${hint?` <span class="hint" style="font-weight:400">${hint}</span>`:""}</label>
    <div class="cost-row">
      <input class="inp num" id="${id}" value="${val}" inputmode="decimal">
      <div class="ccy-seg" data-ccy-for="${id}">
        <button type="button" class="ccy-opt on" data-ccy="USD">US$</button>
        <button type="button" class="ccy-opt" data-ccy="ARS">AR$</button>
      </div>
    </div>
    <div class="rate-row" id="${id}_rate_row" style="display:none;margin-top:6px">
      <span class="hint">${t("conj.leg.arsrate")}</span>
      <input class="inp num" id="${id}_rate" value="${tc()}" inputmode="decimal" style="max-width:130px">
    </div>
    ${pu}</div>`;
}
/* Read a cost field's amount already converted to USD (base currency). */
function legCostRead(id){
  const inp=document.getElementById(id); if(!inp) return 0;
  const amt=Math.max(0, parseNum(inp.value)||0);
  const on=document.querySelector('[data-ccy-for="'+id+'"] .ccy-opt.on');
  const ccy = on ? on.getAttribute("data-ccy") : "USD";
  if(ccy==="ARS"){ const r=Math.max(0, parseNum((document.getElementById(id+"_rate")||{}).value)||0); return r>0 ? amt/r : 0; }
  return amt;
}
/* Wire the USD/ARS toggle + rate field for a cost input. onChange re-runs any preview. */
function wireLegCcy(id, onChange){
  const seg=document.querySelector('[data-ccy-for="'+id+'"]'); if(!seg) return;
  const rateRow=document.getElementById(id+"_rate_row");
  seg.querySelectorAll(".ccy-opt").forEach(b=> b.onclick=()=>{
    seg.querySelectorAll(".ccy-opt").forEach(x=> x.classList.toggle("on", x===b));
    if(rateRow) rateRow.style.display = (b.getAttribute("data-ccy")==="ARS") ? "" : "none";
    if(onChange) onChange();
  });
  const r=document.getElementById(id+"_rate"); if(r) r.oninput=()=>{ if(onChange) onChange(); };
}
function wireLegPreview(inputId, totalUnits){
  const inp=document.getElementById(inputId), out=document.getElementById(inputId+"_pu");
  if(!inp||!out) return;
  const upd=()=>{ const usd=legCostRead(inputId); const pu = totalUnits>0 ? usd/totalUnits : 0;
    out.textContent = t("conj.leg.preview",{m:money(round2(pu),"USD"),n:qty(totalUnits)}); };
  inp.oninput=upd; wireLegCcy(inputId, upd); upd();
}
function estadoPillMini(e){
  const col = e===CONSIGN_ESTADOS.TRANSITO ? "var(--muted)" : e===CONSIGN_ESTADOS.AR ? "var(--accent)" : "var(--up)";
  return `<span class="rm-pill" style="border-color:${col};color:${col}">${esc(consignLabel(e))}</span>`;
}

function nuevaConjLinea(){ return { key:uid(), productoId:"", sku:"", nombre:"", crear:false, total:0, aSwan:0, aTransito:0, terceroId:"", costoUnit:0, precioSwan:0 }; }
/* Third-party of a line = invoice total minus ours (Swan + transit). Never negative. */
function conjAjenoLinea(l){ return Math.max(0, (parseNum(l.total)||0) - (parseNum(l.aSwan)||0) - (parseNum(l.aTransito)||0)); }
function conjUnidadesAjenas(){ return conjDraft.lineas.reduce((a,l)=> a + conjAjenoLinea(l), 0); }

function openConjunta(pre){
  if(!isAdmin()){ toast(t("conj.tt.adminjoint"),"warn"); return; }
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
    <p class="hint" style="margin:0 0 12px">${t("conj.jb.hint")}</p>
    <div class="grid-form" style="grid-template-columns:1fr 1fr;padding:0;margin-bottom:12px">
      <div class="field" style="grid-column:1/3"><label>${t("conj.l.client")} <span class="hint" style="font-weight:400">${t("conj.l.optional")}</span></label>
        <button type="button" class="ppick-btn${cli?"":" placeholder"}" id="cj_cli">
          <span class="ppick-label">${cli?esc(clienteLinea(cli)):t("conj.pk.pickclient")}</span><span class="ppick-caret">▾</span>
        </button></div>
      <div class="field"><label>${t("common.date")}</label><input class="inp" type="date" id="cj_fe" value="${esc(conjDraft.fecha)}"></div>
      <div class="field"><label>${t("conj.l.shipref")} <span class="hint" style="font-weight:400">${t("conj.l.optional")}</span></label><input class="inp" id="cj_nu" value="${esc(conjDraft.numero)}"></div>
      <div class="field"><label>${t("conj.l.totalunits")} <span class="hint" style="font-weight:400">${t("conj.l.totalunits.hint")}</span></label><input class="inp num" id="cj_tot" value="${esc(conjDraft.totalEnvio)}" placeholder="${t("conj.ph.eg24")}"></div>
    </div>
    <div id="cjLineHost"></div>
    <button class="btn sm" id="cjAddLine" style="margin-top:10px">${t("conj.b.addline")}</button>
    <div class="field" style="margin-top:12px"><label>${t("conj.l.notes")}</label><input class="inp" id="cj_obs" value="${esc(conjDraft.obs)}"></div>
  `;
  buildModal(t("conj.md.newjoint"), body, [
    {label:t("common.cancel"),cls:"btn",act:()=>{ conjDraft=null; closeModal(); }},
    {label:t("conj.b.confirmintake"),cls:"btn up",act:confirmConjunta}
  ], "wide doc",
  `<div class="totrow"><span style="color:var(--muted)">${t("conj.jb.wekeep")}</span><span class="num" id="cjTot">${qty(conjUnidadesNuestras())}</span></div><div class="totrow"><span style="color:var(--muted)">${t("conj.jb.thirdtracked")}</span><span class="num" id="cjTotAj">${qty(conjUnidadesAjenas())}</span></div>`);
  renderConjLines();
  document.getElementById("cj_fe").oninput=e=>conjDraft.fecha=e.target.value;
  document.getElementById("cj_nu").oninput=e=>conjDraft.numero=e.target.value;
  document.getElementById("cj_tot").oninput=e=>conjDraft.totalEnvio=e.target.value;
  document.getElementById("cj_obs").oninput=e=>conjDraft.obs=e.target.value;
  document.getElementById("cjAddLine").onclick=()=>{ conjDraft.lineas.push(nuevaConjLinea()); renderConjLines(); };
  document.getElementById("cj_cli").onclick=(e)=> openConjClientePicker(e.currentTarget);
}

/* Client picker reusing the sale modal's style. */
function openConjClientePicker(anchor){
  if(typeof closeProductPicker==="function") closeProductPicker();
  _pickerAnchor = anchor; anchor.classList.add("open");
  const pop = document.createElement("div"); pop.className="ppick-pop";
  pop.innerHTML = `<input class="inp ppick-search" placeholder="${t("conj.ph.searchclient")}" autocomplete="off" spellcheck="false"><div class="ppick-list"></div>`;
  document.body.appendChild(pop);
  const search = pop.querySelector(".ppick-search"), listEl = pop.querySelector(".ppick-list");
  const paint=(q)=>{
    q=(q||"").trim().toLowerCase();
    let lista = db.clientes.slice().sort((a,b)=>String(a.nombre||"").localeCompare(String(b.nombre||""),"en"));
    if(q) lista = lista.filter(c=> ((c.nombre||"")+" "+(c.empresa||"")).toLowerCase().includes(q));
    let html = lista.map(c=>`<button type="button" class="ppick-item${c.id===conjDraft.clienteId?" active":""}" data-pickcli="${c.id}">
      <span class="pi-name">${esc(c.nombre)}${c.empresa?` · ${esc(c.empresa)}`:""}</span></button>`).join("");
    if(!lista.length) html = `<div class="ppick-empty">${t("conj.pk.noclients")}</div>`;
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

/* Picker for the OWNER (third-party) of ONE line's third-party units. Same style, sets l.terceroId. */
function openConjOwnerPicker(i, anchor){
  if(typeof closeProductPicker==="function") closeProductPicker();
  _pickerAnchor = anchor; anchor.classList.add("open");
  const pop = document.createElement("div"); pop.className="ppick-pop";
  pop.innerHTML = `<input class="inp ppick-search" placeholder="${t("conj.ph.searchowner")}" autocomplete="off" spellcheck="false"><div class="ppick-list"></div>`;
  document.body.appendChild(pop);
  const search = pop.querySelector(".ppick-search"), listEl = pop.querySelector(".ppick-list");
  const cur = conjDraft.lineas[i].terceroId;
  const paint=(q)=>{
    q=(q||"").trim().toLowerCase();
    let lista = db.clientes.slice().sort((a,b)=>String(a.nombre||"").localeCompare(String(b.nombre||""),"en"));
    if(q) lista = lista.filter(c=> ((c.nombre||"")+" "+(c.empresa||"")).toLowerCase().includes(q));
    let html = lista.map(c=>`<button type="button" class="ppick-item${c.id===cur?" active":""}" data-pickowner="${c.id}">
      <span class="pi-name">${esc(c.nombre)}${c.empresa?` · ${esc(c.empresa)}`:""}</span></button>`).join("");
    if(!lista.length) html = `<div class="ppick-empty">${t("conj.pk.noowners")}</div>`;
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
        <input class="inp" placeholder="${t("conj.ph.newprod")}" value="${esc(l.nombre)}" data-cjk="nombre" data-cji="${i}">
      </div>` : "";
    const ajeno = conjAjenoLinea(l);
    const over = (parseNum(l.total)||0) > 0 && (parseNum(l.aSwan)||0)+(parseNum(l.aTransito)||0) > (parseNum(l.total)||0);
    const ter = l.terceroId ? clienteById(l.terceroId) : null;
    const ownerLbl = ter ? esc(ter.nombre) : t("conj.pk.pickowner");
    return `<tr>
      <td style="min-width:190px">
        <div class="ppick"><button type="button" class="ppick-btn${(!l.productoId&&!l.crear)?" placeholder":""}" data-cjpick="${i}">
          <span class="ppick-label">${l.crear?t("conj.pk.newprod"):(l.productoId?esc((prodById(l.productoId)||{}).nombre||"—"):t("conj.pk.pickprod"))}</span><span class="ppick-caret">▾</span></button></div>
        ${newFields}
      </td>
      <td style="width:66px"><input class="inp num" data-cjk="total" data-cji="${i}" value="${l.total}" title="${t('conj.tip.totalunits')}"></td>
      <td style="width:66px"><input class="inp num" data-cjk="aSwan" data-cji="${i}" value="${l.aSwan}" title="${t('conj.tip.swankept')}"></td>
      <td style="width:66px"><input class="inp num" data-cjk="aTransito" data-cji="${i}" value="${l.aTransito}" title="${t('conj.tip.toarborn')}"></td>
      <td style="width:70px" class="r"><span class="num" data-cjajeno="${i}" title="${t('conj.tip.thirdformula')}" style="color:${over?'var(--alert)':(ajeno>0?'var(--ink)':'var(--muted)')}">${over?'!':qty(ajeno)}</span></td>
      <td style="width:150px"><button type="button" class="ppick-btn sm${ter?'':' placeholder'}" data-cjowner="${i}" title="${t('conj.tip.owner')}" ${ajeno>0?'':'disabled style="opacity:.4"'}><span class="ppick-label">${ownerLbl}</span><span class="ppick-caret">▾</span></button></td>
      <td style="width:84px"><input class="inp num" data-cjk="costoUnit" data-cji="${i}" value="${l.costoUnit}" title="${t('conj.tip.cost')}"></td>
      <td style="width:92px"><input class="inp num" data-cjk="precioSwan" data-cji="${i}" value="${l.precioSwan||0}" title="${t('conj.tip.priceusd')}"></td>
      <td style="width:34px"><button class="btn ghost sm" data-cjdel="${i}" title="${t('conj.tip.remove')}">✕</button></td>
    </tr>`;
  }).join("");
  host.innerHTML = `<div class="table-scroll"><table class="line-tbl doc-tbl">
    <colgroup><col><col style="width:70px"><col style="width:70px"><col style="width:70px"><col style="width:74px"><col style="width:154px"><col style="width:88px"><col style="width:96px"><col style="width:40px"></colgroup>
    <thead><tr><th>${t("common.product")}</th><th class="r" title="${t("conj.th.total.tip")}">${t("conj.th.total")}</th><th class="r" title="${t("conj.th.swan.tip")}">${t("conj.th.swan")}</th><th class="r" title="${t("conj.th.toar.tip")}">${t("conj.th.toar")}</th><th class="r" title="${t("conj.th.thirdparty.tip")}">${t("conj.th.thirdparty")}</th><th title="${t("conj.tip.owner")}">${t("conj.th.owner")}</th><th class="r" title="${t("conj.th.cost.tip")}">${t("conj.th.cost")}</th><th class="r" title="${t("conj.th.priceusd.tip")}">${t("conj.th.priceusd")}</th><th></th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;

  host.querySelectorAll("[data-cjpick]").forEach(b=> b.onclick=()=> openConjProductPicker(+b.dataset.cjpick, b));
  host.querySelectorAll("[data-cjowner]").forEach(b=> b.onclick=()=> openConjOwnerPicker(+b.dataset.cjowner, b));
  host.querySelectorAll("[data-cjk]").forEach(inp=>{
    const i=+inp.dataset.cji, k=inp.dataset.cjk;
    inp.oninput=()=>{
      const l=conjDraft.lineas[i];
      if(k==="total"||k==="aSwan"||k==="aTransito"||k==="costoUnit"||k==="precioSwan") l[k]=parseNum(inp.value);
      else l[k]=inp.value;
      // refresh the row's third-party value + footer totals, without re-render (don't lose focus)
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

/* Reuses the sale modal's product picker (same style), but applying
   the selection in the joint-buy line. Lists ALL products + create new. */
function openConjProductPicker(i, anchor){
  closeProductPicker();
  _pickerAnchor = anchor; anchor.classList.add("open");
  const pop = document.createElement("div"); pop.className="ppick-pop";
  pop.innerHTML = `<input class="inp ppick-search" placeholder="${t("dash.f.search")}" autocomplete="off" spellcheck="false"><div class="ppick-list"></div>`;
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
    if(!lista.length) html = `<div class="ppick-empty">${t("conj.pk.noprods")}</div>`;
    html += `<button type="button" class="ppick-item new" data-cjp="__new">${t("conj.pk.createprod")}</button>`;
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
  if(!isAdmin()){ toast(t("conj.tt.adminjoint"),"warn"); return; }
  // resolve lines
  const resolved = [];
  for(const l of conjDraft.lineas){
    const aSw  = Math.max(0, parseNum(l.aSwan)||0);
    const aTr  = Math.max(0, parseNum(l.aTransito)||0);
    const aj   = conjAjenoLinea(l);
    if(aSw<=0 && aTr<=0 && aj<=0) continue;   // empty line: ignored
    // over-allocation: our part can't exceed the invoice total
    if((parseNum(l.total)||0)>0 && aSw+aTr>(parseNum(l.total)||0)){
      toast(t("conj.tt.overours"),"warn"); return;
    }
    // if there's third-party, we REQUIRE an owner (the only manual decision of point 3)
    if(aj>0 && !l.terceroId){ toast(t("conj.tt.noowner"),"warn"); return; }
    let p=null;
    if(l.crear){
      const dup = skuEnUso(l.sku, null);
      if(dup) p = dup;
      else {
        if(!(l.nombre||"").trim()){ toast(t("conj.tt.noname"),"warn"); return; }
        p = nuevoProductoBase(l.sku, l.nombre, 0);
        db.productos.push(p);
      }
    } else {
      p = prodById(l.productoId);
      if(!p){ toast(t("conj.tt.noprod"),"warn"); return; }
    }
    resolved.push({ prod:p, total:Math.max(0,parseNum(l.total)||0), aSwan:aSw, aTransito:aTr, ajeno:aj, terceroId:l.terceroId||null, costoUnit:Math.max(0, parseNum(l.costoUnit)||0), precioSwan:Math.max(0, parseNum(l.precioSwan)||0) });
  }
  if(!resolved.length){ toast(t("conj.tt.addunit"),"warn"); return; }

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
  const refTxt = t("conj.obs.jointref") + (doc.numero?(" "+doc.numero):"") + (cli?(" · "+cli.nombre):"");

  // Remito U (numbered) of the US→AR shipment: ONLY the THIRD-PARTY part. Ours (Swan / →AR)
  // is already our own stock, it doesn't travel as a transfer document. It stays saved in
  // db.remitos and available in the Remitos section (no pop-up on save).
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
    // Units kept in SWAN (USA): sellable stock right away, with kardex.
    if(r.aSwan>0){
      fifoEntrada(p, STORE_IDS[0], r.aSwan, r.costoUnit, refTxt, doc.id);
      moverStock(p, +r.aSwan, r.costoUnit, "conjunta", doc.id, refTxt+" · commission", { store:STORE_IDS[0], tipo:"conjunta-in" });
    }
    // OUR units bound for AR: BORN IN TRANSIT (bucket, no own kardex, like the vault).
    // They're DELIVERED into Select (AR) at the end of the journey ("Deliver in AR" button).
    if(r.aTransito>0){
      fifoEntrada(p, TRANSITO_STORE, r.aTransito, r.costoUnit, refTxt, doc.id);
      p.stockPorTienda[TRANSITO_STORE] = round4((p.stockPorTienda[TRANSITO_STORE]||0) + r.aTransito);
    }
    // THIRD-PARTY units: they do NOT touch stock/FIFO/valuation. They go to the
    // consignments ledger (born in transit US→AR) to be tracked separately.
    if(r.ajeno>0 && r.terceroId){
      crearConsignacion({ conjuntaId:doc.id, envioRef:doc.numero, fecha:doc.fecha, terceroId:r.terceroId,
        remitoId: uRem?uRem.id:null, remitoCodigo: uRem?uRem.codigo:"",
        productoId:p.id, sku:p.sku, nombre:p.nombre, cantidad:r.ajeno, costoUnit:r.costoUnit, obs:refTxt });
    }
    // last reference landed cost (only if a cost > 0 was entered)
    if(r.costoUnit>0){ p.costoNeto=r.costoUnit; p.costoHandling=0; p.costoFlete=0; p.ultimoCosto=r.costoUnit; }
    // Swan sale price (US$), optional: sets the Swan (USA) deposit price list
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
  const remBit = uRem ? t("conj.frag.remito",{code:uRem.codigo}) : "";
  toast(t("conj.tt.jointsaved",{sw:qty(sw),tr:qty(tr),aj:qty(aj),rem:remBit}), "up");
  render();
  // The remito stays in the Remitos section (download whenever). No pop-up.
}

/* ---- Receive in AR: moves units from TRANSIT to SWAN (with optional import cost) ---- */
function openRecibirTransito(prodId){
  if(!isAdmin()){ toast(t("conj.tt.adminrecv"),"warn"); return; }
  const p = prodById(prodId); if(!p) return;
  const held = transUnits(p);
  if(held<=0){ toast(t("conj.tt.notransitprod"),"warn"); return; }
  const destino = STORE_IDS[1] || STORE_IDS[0];   // AR deposit (transit destination)
  const body = `
    <p class="hint" style="margin:0 0 12px">${t("conj.rt.hint",{n:qty(held),val:money(transValor(p),"USD"),store:esc(storeName(destino))})}</p>
    <div class="grid-form" style="grid-template-columns:1fr 1fr;padding:0">
      <div class="field"><label>${t("conj.l.unitstorecv")}</label><input class="inp num" id="rt_q" value="${held}"></div>
      ${legCostFieldHTML("rt_c",t("conj.leg.gate3"),t("conj.leg.hint.total"))}
      <div class="field" style="grid-column:1/3"><label>${t("conj.l.notes")}</label><input class="inp" id="rt_obs" placeholder="${t("conj.ph.egship")}"></div>
    </div>`;
  buildModal(t("conj.md.deliverar",{store:esc(storeName(destino))}), body, [
    {label:t("common.cancel"),cls:"btn",act:closeModal},
    {label:t("conj.b.markdeliv",{store:storeName(destino)}),cls:"btn up",act:()=>{
      const q=Math.min(Math.max(0,parseNum(document.getElementById("rt_q").value)||0), transUnits(p));
      const cTot=legCostRead("rt_c");   // arg freight + local costs (total), in USD
      const c = q>0 ? round2(cTot/q) : 0;                                           // prorrateo por unidad
      const obs=(document.getElementById("rt_obs").value||"").trim();
      if(q<=0){ toast(t("conj.tt.enterqty"),"warn"); return; }
      const done = transferStock(p, TRANSITO_STORE, destino, q, c, obs, "arg");
      if(done>0){ closeModal(); toast(t("conj.tt.delivered",{n:qty(done),store:storeName(destino),cost:cTot>0?t("conj.frag.landed",{m:money(c,"USD")}):""}), "up"); render(); }
    }}
  ], "mini");
  // landed-per-unit preview = total ÷ units to receive (recomputed when either changes)
  const rtC=document.getElementById("rt_c"), rtQ=document.getElementById("rt_q"), rtPu=document.getElementById("rt_c_pu");
  const rtUpd=()=>{ const usd=legCostRead("rt_c"), u=Math.max(0,parseNum(rtQ.value)||0); rtPu.textContent = t("conj.leg.preview",{m:money(u>0?round2(usd/u):0,"USD"),n:qty(u)}); };
  if(rtC&&rtQ&&rtPu){ rtC.oninput=rtUpd; rtQ.oninput=rtUpd; wireLegCcy("rt_c",rtUpd); rtUpd(); }
}

/* ---- Send to transit: moves units from a sellable deposit into the transit bucket.
   Secondary case (AR ones are born in transit), useful to send Swan (USA) stock to AR. ---- */
function openEnviarTransito(){
  if(!isAdmin()){ toast(t("conj.tt.adminstock"),"warn"); return; }
  const prods = db.productos.filter(p=> STORE_IDS.some(s=> stockDe(p,s)>0))
    .sort((a,b)=> String(a.nombre||"").localeCompare(String(b.nombre||""),"en"));
  if(!prods.length){ toast(t("conj.tt.nosellable"),"warn"); return; }
  const prodOpts = prods.map(p=>`<option value="${p.id}">${esc(p.sku?("["+p.sku+"] "):"")}${esc(p.nombre)}</option>`).join("");
  const body = `
    <p class="hint" style="margin:0 0 12px">${t("conj.et.hint")}</p>
    <div class="grid-form" style="grid-template-columns:1fr 1fr;padding:0">
      <div class="field" style="grid-column:1/3"><label>${t("common.product")}</label><select class="inp" id="et_prod">${prodOpts}</select></div>
      <div class="field"><label>${t("conj.l.fromdeposit")}</label><select class="inp" id="et_store"></select></div>
      <div class="field"><label>${t("common.units")}</label><input class="inp num" id="et_q" value="0"></div>
      ${legCostFieldHTML("et_cost",t("conj.leg.gate2"),t("conj.leg.hint.total"))}
      <div class="field" style="grid-column:1/3"><label>${t("conj.l.notes")}</label><input class="inp" id="et_obs"></div>
    </div>`;
  buildModal(t("conj.md.sendtransit"), body, [
    {label:t("common.cancel"),cls:"btn",act:closeModal},
    {label:t("conj.b.sendtransit"),cls:"btn",act:()=>{
      const p=prodById(document.getElementById("et_prod").value);
      const st=document.getElementById("et_store").value;
      if(!p||!st){ toast(t("conj.tt.pickprodstore"),"warn"); return; }
      const q=Math.min(Math.max(0,parseNum(document.getElementById("et_q").value)||0), stockDe(p,st));
      const obs=(document.getElementById("et_obs").value||"").trim();
      if(q<=0){ toast(t("conj.tt.enterqtyempty"),"warn"); return; }
      const costTot=legCostRead("et_cost");   // intl freight + wire fees (total), in USD
      const costPU = q>0 ? round2(costTot/q) : 0;                                          // prorrateo por unidad
      const done = transferStock(p, st, TRANSITO_STORE, q, costPU, obs, "intl");
      if(done>0){
        // Remito U of our own US → AR shipment (automatic numbering)
        const uRem = crearRemito({ letra:"U", tipo:"salida-us", fuente:{ tipo:"transito", id:p.id },
          lineas:[{ productoId:p.id, sku:p.sku, nombre:p.nombre, cantidad:done, rol:"ours", owner:"" }],
          obs:obs || t("conj.obs.ownstock",{from:storeName(st)}) });
        save();
        closeModal();
        toast(t("conj.tt.senttransit",{n:qty(done),code:uRem.codigo,cost:costTot>0?t("conj.frag.landed",{m:money(costPU,"USD")}):""}), "up");
        render();
        // Remito saved — download it from the Remitos section (no pop-up).
      }
    }}
  ], "mini");
  // deposits holding stock of the chosen product (updates when product changes)
  const fillStores=()=>{
    const p=prodById(document.getElementById("et_prod").value);
    const sel=document.getElementById("et_store");
    const conStock = STORE_IDS.filter(s=> stockDe(p,s)>0);
    sel.innerHTML = conStock.map(s=>`<option value="${s}">${esc(storeName(s))} · ${qty(stockDe(p,s))} u</option>`).join("") || `<option value="">${t("conj.et.nostore")}</option>`;
  };
  document.getElementById("et_prod").onchange=fillStores;
  fillStores();
  // landed-per-unit preview = total ÷ units
  const etC=document.getElementById("et_cost"), etQ=document.getElementById("et_q"), etPu=document.getElementById("et_cost_pu");
  const etUpd=()=>{ const usd=legCostRead("et_cost"), u=Math.max(0,parseNum(etQ.value)||0); etPu.textContent = t("conj.leg.preview",{m:money(u>0?round2(usd/u):0,"USD"),n:qty(u)}); };
  if(etC&&etQ&&etPu){ etC.oninput=etUpd; etQ.oninput=etUpd; wireLegCcy("et_cost",etUpd); etUpd(); }
}

/* ---- Write-off of transit: reduces bucket units due to breakage, customs,
   loss, etc. Consumes transit FIFO and leaves a "merma" (write-off) movement
   (store=transit) to trace the loss. It doesn't move to any sellable deposit. ---- */
function openMermaTransito(prodId){
  if(!isAdmin()){ toast(t("conj.tt.adminwo"),"warn"); return; }
  const p = prodById(prodId); if(!p) return;
  const held = transUnits(p);
  if(held<=0){ toast(t("conj.tt.notransitprod"),"warn"); return; }
  const body = `
    <p class="hint" style="margin:0 0 12px">${t("conj.mm.hint",{n:qty(held)})}</p>
    <div class="grid-form" style="grid-template-columns:1fr 1fr;padding:0">
      <div class="field"><label>${t("conj.l.unitstowo")}</label><input class="inp num" id="mm_q" value="0"></div>
      <div class="field"><label>${t("conj.l.reason")}</label>
        <select class="inp" id="mm_motivo">
          <option value="broken">${t("conj.mm.broken")}</option>
          <option value="customs">${t("conj.mm.customs")}</option>
          <option value="lost">${t("conj.mm.lost")}</option>
          <option value="other">${t("conj.mm.other")}</option>
        </select></div>
      <div class="field" style="grid-column:1/3"><label>${t("conj.l.notes")}</label><input class="inp" id="mm_obs"></div>
    </div>`;
  buildModal(t("conj.md.writeoff"), body, [
    {label:t("common.cancel"),cls:"btn",act:closeModal},
    {label:t("conj.b.writeoff"),cls:"btn danger",act:()=>{
      const q=Math.min(Math.max(0,parseNum(document.getElementById("mm_q").value)||0), transUnits(p));
      if(q<=0){ toast(t("conj.tt.enterqty"),"warn"); return; }
      const motivo=document.getElementById("mm_motivo").value;
      const obs=(document.getElementById("mm_obs").value||"").trim();
      withUndo(t("conj.tt.woundo",{n:qty(q)}), ()=>{
        const { unit } = fifoConsumir(p, TRANSITO_STORE, q);            // consume transit FIFO
        p.stockPorTienda[TRANSITO_STORE] = round4(Math.max(0, transUnits(p) - q));
        // write-off movement in the bucket (the product card shows it but doesn't add it to the sellable balance)
        moverStock(p, -q, unit, "merma", null, t("conj.obs.woreason",{reason:motivo}), { store:TRANSITO_STORE, tipo:"merma", obs });
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
  if(!confirm(t("conj.cf.deljoint"))) return;
  withUndo(t("conj.tt.jointdeleted"), ()=>{
  d.lineas.forEach(l=>{
    const p = prodById(l.productoId); if(!p) return;
    // revert Swan: remove this joint buy's FIFO layer and reduce stock (clamp to 0)
    if(l.aSwan>0){
      fifoQuitarCompra(p, STORE_IDS[0], id);
      p.stockPorTienda[STORE_IDS[0]] = round4(Math.max(0, stockDe(p,STORE_IDS[0]) - l.aSwan));
      recalcStockMirror(p);
    }
    // revert Transit: only what's still in the bucket
    if(l.aTransito>0){
      fifoQuitarCompra(p, TRANSITO_STORE, id);
      p.stockPorTienda[TRANSITO_STORE] = round4(Math.max(0, transUnits(p) - l.aTransito));
    }
    if(typeof recomputeUltimoCosto==="function") recomputeUltimoCosto(p);
  });
  // Consignments (third-party) of this joint buy: only remove those still IN TRANSIT
  // (not advanced yet). Already received/delivered ones are physical facts: they stay.
  db.consignaciones = consignAll().filter(cs=> !(cs.conjuntaId===id && cs.estado===CONSIGN_ESTADOS.TRANSITO));
  db.movimientos = db.movimientos.filter(m=> m.refId!==id);
  const i = db.conjuntas.findIndex(x=>x.id===id); if(i>=0) db.conjuntas.splice(i,1);
  save();
  });
  render();
}

/* ============================================================
   GUIDED TRACK (foolproof) — flow presentation
   ------------------------------------------------------------
   Replaces the render WITHOUT touching the engine: every piece of
   merchandise is a track with the current gate lit and ONE button =
   the next step. "Ours" lane (per product, enters stock) and
   "third-party" lane (per remito, only tracked, ends in the split).
   ============================================================ */
var RL_ICONS = {
  usa:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 8.35V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.35a2 2 0 0 1 1.26-1.86l8-3.2a2 2 0 0 1 1.48 0l8 3.2A2 2 0 0 1 22 8.35Z"/><path d="M6 18h12M6 14h12M6 10h12"/></svg>',
  plane:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/></svg>',
  store:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9 4.5 4.5A2 2 0 0 1 6.4 3h11.2a2 2 0 0 1 1.9 1.5L21 9"/><path d="M4 9v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9"/><path d="M3 9h18M9 20v-5h6v5"/></svg>',
  pin:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>',
  split:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></svg>'
};
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
.rl-dot{width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:1.5px solid var(--line-strong);background:var(--surface);color:var(--muted)}
.rl-dot svg{width:19px;height:19px;display:block}
.rl-dot.done{background:var(--up-bg);border-color:var(--up);color:var(--accent-ink)}
.rl-dot.cur{background:var(--accent);border-color:var(--accent);color:var(--paper)}
.rl-lab{font-size:12px;line-height:1.25;color:var(--muted)}
.rl-lab.cur{color:var(--accent-ink);font-weight:700}
.rl-conn{flex:1 1 auto;height:2px;margin-top:18px;border-radius:2px;background:var(--line-strong)}
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
/* One track: nodes = array of {icon,label}; cur = index of the current step (0-based). */
function rielHTML(nodes, cur){
  let h = "";
  nodes.forEach((nd, i)=>{
    if(i>0) h += `<div class="rl-conn ${i<=cur?"done":""}"></div>`;
    const st = i<cur ? "done" : (i===cur ? "cur" : "");
    h += `<div class="rl-node"><div class="rl-dot ${st}">${RL_ICONS[nd.icon]||""}</div><div class="rl-lab ${i===cur?"cur":""}">${nd.label}</div></div>`;
  });
  return `<div class="rl-steps">${h}</div>`;
}
/* Track card for OUR OWN merchandise in transit (per product: that's how it's stored today). */
function ourTransitCardHTML(p){
  const u = transUnits(p), val = transValor(p);
  return `<div class="rl-card">
    <div class="rl-head">
      <span class="rl-code">${esc(p.nombre)}</span>
      <span class="rl-badge ours">${t("conj.badge.ours")}</span>
      <span class="rl-meta">${esc(p.sku||"\u2014")} \u00b7 ${qty(u)} u \u00b7 ${money(val,"USD")}</span>
    </div>
    ${rielHTML([{icon:"usa",label:t("conj.gate.usa")},{icon:"plane",label:t("conj.gate.transit")},{icon:"store",label:t("conj.gate.sellable")}], 1)}
    <div class="rl-foot">
      <span class="rl-next">${t("conj.ours.next")}</span>
      <button class="btn ghost sm" data-merma="${p.id}" style="color:var(--alert)">${t("conj.writeoff")}</button>
      <button class="btn up sm" data-recib="${p.id}">${t("conj.deliverar")} \u25be</button>
    </div>
  </div>`;
}
function viewConjunta(){
  ensureRielCSS();
  // --- Ours lane: products in transit (per product) ---
  const enTransito = db.productos.filter(p=> transUnits(p)>0)
    .sort((a,b)=> String(a.nombre||"").localeCompare(String(b.nombre||""),"en"));
  const uNuestraTransito = enTransito.reduce((a,p)=> a + transUnits(p), 0);
  const ourCards = enTransito.map(ourTransitCardHTML).join("")
    || `<div class="rl-empty">${t("conj.ours.empty")}</div>`;

  // --- Third-party lane: consignments grouped by remito ---
  const remitos = remitosActivos();
  const remTransito = remitos.filter(g=> g.uTransito>0).length;
  const remAr       = remitos.filter(g=> g.uAr>0).length;
  const remitoCards = remitos.map(remitoCardHTML).join("")
    || `<div class="rl-empty">${t("conj.third.empty")}</div>`;

  // --- Actionable counters ---
  const chips = `
    <p class="hint" style="margin:0 0 6px">${t("conj.needs")}</p>
    <div class="rl-chips">
      <div class="rl-chip${enTransito.length?" hot":""}" data-scroll="rl-nuestra"><span class="n">${qty(uNuestraTransito)}</span><span class="l">${t("conj.chip.ours")}</span></div>
      <div class="rl-chip${remTransito?" hot":""}" data-scroll="rl-terceros"><span class="n">${remTransito}</span><span class="l">${t("conj.chip.recv")}</span></div>
      <div class="rl-chip${remAr?" hot":""}" data-scroll="rl-terceros"><span class="n">${remAr}</span><span class="l">${t("conj.chip.resolve")}</span></div>
    </div>`;

  // --- Summary by owner ---
  const resumen = consignResumenPorTercero();
  const resRows = resumen.map(r=>`<tr>
      <td>${esc(r.nombre)}</td>
      <td class="r num">${qty(r.en_transito||0)}</td>
      <td class="r num">${qty(r.en_ar||0)}</td>
      <td class="r num">${qty(r.entregado||0)}</td>
      <td class="r num"><b>${qty(r.total||0)}</b></td>
    </tr>`).join("") || `<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:18px">${t("conj.empty.owner")}</td></tr>`;

  // --- Recent movements between deposits ---
  const tipos = { "transfer-out":t("conj.mv.sent"), "transfer-in":t("conj.mv.recv"), "conjunta":t("conj.mv.comm"), "tercero-keep":t("conj.mv.kept"), "merma":t("conj.mv.wo") };
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
  }).join("") || `<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:18px">${t("conj.empty.mov")}</td></tr>`;

  // --- Legacy joint-buys history (read-only) ---
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
      <td class="r" style="white-space:nowrap"><button class="btn ghost sm" data-remito-doc="${d.id}" title="${t("conj.remito.tip")}">Remito</button> <button class="btn ghost sm" data-cjdel-doc="${d.id}" style="color:var(--alert)">${t("common.delete")}</button></td>
    </tr>`;
  }).join("") || `<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:18px">${t("conj.empty.hist")}</td></tr>`;

  return `
  <div class="head"><div class="title"><h2>${t("conj.title")}</h2><p>${t("conj.sub")}</p></div>
    <div class="actions"><button class="btn" data-enviar-transito title="${t("conj.sendtransit.tip")}">${t("conj.sendtransit")}</button><button class="btn up" data-new-conj>${t("conj.newjoint")}</button></div>
  </div>

  ${chips}

  <div class="panel" id="rl-nuestra" style="margin-bottom:18px">
    <div class="phead" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <div><h3>${t("conj.ours.title")}</h3><p class="hint" style="margin:2px 0 0">${t("conj.ours.hint")}</p></div>
      <div style="flex:1"></div>
      ${enTransito.length?`<button class="btn ghost sm" data-deliver-all-ours>${t("conj.deliverall")}</button>`:""}
    </div>
    <div class="rl-wrap">${ourCards}</div>
  </div>

  <div class="panel" id="rl-terceros" style="margin-bottom:18px">
    <div class="phead" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <div><h3>${t("conj.third.title")}</h3><p class="hint" style="margin:2px 0 0">${t("conj.third.hint")}</p></div>
      <div style="flex:1"></div>
      ${remTransito?`<button class="btn ghost sm" data-cs-recib-all>${t("conj.recvall")}</button>`:""}
      ${remAr?`<button class="btn ghost sm" data-cs-entregar-all>${t("conj.deliverallonly")}</button>`:""}
    </div>
    <div class="rl-wrap">${remitoCards}</div>
  </div>

  <div class="panel" style="margin-bottom:18px">
    <div class="phead"><h3>${t("conj.byowner")}</h3><span class="hint">${t("conj.byowner.hint")}</span></div>
    <div class="table-scroll"><table>
      <thead><tr><th>${t("common.owner")}</th><th class="r">${t("conj.h.transit")}</th><th class="r">${t("conj.h.inar")}</th><th class="r">${t("conj.h.delivered")}</th><th class="r">${t("common.total")}</th></tr></thead>
      <tbody>${resRows}</tbody></table></div>
  </div>

  <div class="panel"${hayHist?' style="margin-bottom:18px"':''}>
    <div class="phead"><h3>${t("conj.mov.title")}</h3></div>
    <div class="table-scroll"><table>
      <thead><tr><th>${t("common.date")}</th><th>${t("common.product")}</th><th>${t("conj.h.deposit")}</th><th>${t("conj.h.movement")}</th><th class="r">${t("common.units")}</th></tr></thead>
      <tbody>${movRows}</tbody></table></div>
  </div>

  ${hayHist?`<div class="panel">
    <div class="phead"><h3>${t("conj.hist.title")}</h3><span class="hint">${t("conj.hist.hint")}</span></div>
    <div class="table-scroll"><table>
      <thead><tr><th>${t("common.date")}</th><th>${t("common.client")}</th><th>${t("conj.h.ref")}</th><th class="c">${t("conj.h.order")}</th><th class="r">Swan</th><th class="r">\u2192 AR</th><th class="r">${t("conj.h.third")}</th><th></th></tr></thead>
      <tbody>${histRows}</tbody></table></div>
  </div>`:""}`;
}

/* ============================================================
   BULK ACTIONS (so you don't go one by one through thousands of products)
   ============================================================ */
/* Receive ALL consignments in transit → AR at once. */
function recibirTodasConsign(){
  if(!isAdmin()){ toast(t("conj.tt.adminrecv"),"warn"); return; }
  const list = consignAll().filter(cs=> cs.estado===CONSIGN_ESTADOS.TRANSITO);
  if(!list.length){ toast(t("conj.tt.nothingtransit"),"warn"); return; }
  const u = list.reduce((a,cs)=> a+cs.cantidad, 0);
  if(!confirm(t("conj.cf.recvall",{n:list.length,u:qty(u)}))) return;
  list.forEach(cs=> avanzarConsignacion(cs.id, { obs:"bulk receive in AR" }));
  toast(t("conj.tt.recvthirdn",{n:list.length}),"up"); render();
}
/* Deliver ALL consignments that are in AR → delivered at once. */
function entregarTodasConsign(){
  if(!isAdmin()){ toast(t("conj.tt.admindeliver"),"warn"); return; }
  const list = consignAll().filter(cs=> cs.estado===CONSIGN_ESTADOS.AR);
  if(!list.length){ toast(t("conj.tt.noneardeliver"),"warn"); return; }
  const u = list.reduce((a,cs)=> a+cs.cantidad, 0);
  if(!confirm(t("conj.cf.delivall",{n:list.length,u:qty(u)}))) return;
  list.forEach(cs=> avanzarConsignacion(cs.id, { obs:"bulk delivered" }));
  toast(t("conj.tt.deliveredthird",{n:list.length}),"up"); render();
}
/* Deliver into AR ALL OUR OWN stock in transit, with an optional total Arg cost
   prorated over the total units (capitalized, "arg" leg). */
function openDeliverAllOurs(){
  if(!isAdmin()){ toast(t("conj.tt.adminrecv"),"warn"); return; }
  const prods = db.productos.filter(p=> transUnits(p)>0);
  const totalU = prods.reduce((a,p)=> a+transUnits(p), 0);
  if(!prods.length || totalU<=0){ toast(t("conj.tt.nothingours"),"warn"); return; }
  const destino = STORE_IDS[1] || STORE_IDS[0];
  const body = `
    <p class="hint" style="margin:0 0 14px">${t("conj.da.hint",{store:esc(storeName(destino)),items:prods.length,n:qty(totalU)})}</p>
    <div class="grid-form stack" style="padding:0">
      ${legCostFieldHTML("da_cost",t("conj.leg.gate3"),t("conj.leg.hint.batch"))}
      <div class="field" style="grid-column:1/-1"><label>${t("conj.l.notes")}</label><input class="inp" id="da_obs" placeholder="${t("conj.ph.egship")}"></div>
    </div>`;
  buildModal(t("conj.md.deliverall",{store:esc(storeName(destino))}), body, [
    {label:t("common.cancel"),cls:"btn",act:closeModal},
    {label:t("conj.b.deliverall",{n:qty(totalU)}),cls:"btn up",act:()=>{
      const costTot=legCostRead("da_cost");
      const perU = totalU>0 ? round2(costTot/totalU) : 0;
      const obs=(document.getElementById("da_obs").value||"").trim();
      let done=0, items=0;
      prods.forEach(p=>{ const q=transUnits(p); if(q>0){ const d=transferStock(p, TRANSITO_STORE, destino, q, perU, obs, "arg"); if(d>0){ done+=d; items++; } } });
      closeModal(); toast(t("conj.tt.deliveredacross",{n:qty(done),items:items,cost:costTot>0?t("conj.frag.landed",{m:money(perU,"USD")}):""}),"up"); render();
    }}
  ], "mini");
  wireLegPreview("da_cost", totalU);
}

/* ---- Receive consignment (third-party) in AR: en_transito → en_ar, with optional courier ---- */
function openRecibirConsignacion(id){
  if(!isAdmin()){ toast(t("conj.tt.adminrecv"),"warn"); return; }
  const cs = consignAll().find(x=>x.id===id); if(!cs) return;
  const body = `
    <p class="hint" style="margin:0 0 14px">${t("conj.rc.hint",{name:esc(cs.nombre),owner:esc(terceroNombre(cs)),n:qty(cs.cantidad)})}</p>
    <div class="grid-form stack" style="padding:0">
      ${legCostFieldHTML("csc_c",t("conj.leg.courierpu"),t("conj.leg.hint.optional"),{value:(cs.costoCourierUnit||0),noPreview:true})}
      <div class="field"><label>${t("conj.l.notes")}</label><input class="inp" id="csc_obs" placeholder="${t("conj.ph.egarrival")}"></div>
    </div>`;
  buildModal(t("conj.md.recvthird"), body, [
    {label:t("common.cancel"),cls:"btn",act:closeModal},
    {label:t("conj.b.markrecvar"),cls:"btn up",act:()=>{
      const c=legCostRead("csc_c");
      const obs=(document.getElementById("csc_obs").value||"").trim();
      avanzarConsignacion(id, { costoCourierUnit:c, obs });
      closeModal(); toast(t("conj.tt.recvthirdok"),"up"); render();
    }}
  ], "mini");
  wireLegCcy("csc_c");
}
/* ---- Deliver consignment: en_ar → delivered (handoff to the owner) ---- */
function entregarConsignacion(id){
  if(!isAdmin()){ toast(t("conj.tt.admindeliver"),"warn"); return; }
  const cs = consignAll().find(x=>x.id===id); if(!cs) return;
  if(!confirm(t("conj.cf.delivone",{owner:terceroNombre(cs),name:cs.nombre,n:qty(cs.cantidad)}))) return;
  avanzarConsignacion(id, { obs:t("conj.obs.delivered") });
  toast(t("conj.tt.markeddeliv"),"up"); render();
}
function removeConsignacion(id){
  if(!isAdmin()){ toast(t("conj.tt.admintrack"),"warn"); return; }
  const cs = consignAll().find(x=>x.id===id); if(!cs) return;
  if(!confirm(t("conj.cf.untrack",{name:cs.nombre,n:qty(cs.cantidad),owner:terceroNombre(cs)}))) return;
  borrarConsignacion(id); toast(t("conj.tt.removedtrack"),"warn"); render();
}

/* ============================================================
   RENDER DE UN REMITO (colapsable) — punto 1
   ============================================================ */
function remitoCardHTML(g){
  const open   = !!remitoOpen[g.key];
  const owners = g.ownerNames.length ? g.ownerNames.join(", ") : "\u2014";
  const cur    = g.uTransito>0 ? 0 : 1;   // in transit -> step 1 (idx 0); already in AR -> step 2 (idx 1)
  const pills  = [
    g.uTransito>0 ? `<span class="rl-pill">${qty(g.uTransito)} ${t("conj.pill.transit")}</span>` : "",
    g.uAr>0       ? `<span class="rl-pill ar">${qty(g.uAr)} ${t("conj.pill.ar")}</span>` : ""
  ].filter(Boolean).join(" ");
  const head = `<div class="rl-rhead" data-remito-toggle="${esc(g.key)}">
      <span class="rl-caret">${open?"\u25be":"\u25b8"}</span>
      <div style="flex:1;min-width:0">
        <div class="rl-code">${g.codigo?esc(g.codigo):esc(g.ref||t("conj.noref"))}</div>
        <div class="rl-meta">${g.codigo&&g.ref?esc(g.ref)+" \u00b7 ":""}${esc(fmtDate(g.fecha))} \u00b7 ${g.lineas.length} ${t("conj.products")} \u00b7 ${qty(g.uTotal)} u</div>
      </div>
      <span class="rl-badge third">${t("conj.badge.third")}${esc(owners)}</span>
    </div>`;

  const rows = g.lineas.map(cs=>`<tr>
      <td class="c"><input type="checkbox" class="rm-chk" data-rmsel="${cs.id}" ${remitoSel[cs.id]?"checked":""}></td>
      <td><span class="sku">${esc(cs.sku||"\u2014")}</span></td>
      <td>${esc(cs.nombre)}</td>
      <td>${esc(terceroNombre(cs))}</td>
      <td class="c">${estadoPillMini(cs.estado)}</td>
      <td class="r num">${qty(cs.cantidad)}</td>
      <td class="r"><button class="btn ghost xs" data-cs-del="${cs.id}" title="${t("conj.untrack")}" style="color:var(--alert)">\u2715</button></td>
    </tr>`).join("");
  const tabla = open ? `<div class="table-scroll" style="margin-bottom:10px"><table class="rm-tbl">
      <thead><tr><th class="c"><input type="checkbox" class="rm-chkall" data-rmall="${esc(g.key)}"></th><th>SKU</th><th>${t("common.product")}</th><th>${t("common.owner")}</th><th class="c">${t("conj.state")}</th><th class="r">${t("common.units")}</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table></div>` : "";

  const selHere     = g.lineas.filter(l=> remitoSel[l.id]);
  const scopeLines  = selHere.length ? selHere : g.lineas;
  const hasTransito = scopeLines.some(l=> l.estado===CONSIGN_ESTADOS.TRANSITO);
  const hasAr       = scopeLines.some(l=> l.estado===CONSIGN_ESTADOS.AR);
  const foot = `<div class="rl-foot">
      <span class="rl-next">${selHere.length?`${selHere.length} ${t("conj.selected")}`:t("conj.wholeremito")}${hasAr?` \u00b7 <span class="rl-warn">${t("conj.warnresolve")}</span>`:""}</span>
      ${g.remitoId?`<button class="btn ghost sm" data-rm-pdf="${esc(g.remitoId)}" title="${t("conj.dlremito")} ${esc(g.codigo||"")}">\u2913 ${esc(g.codigo||"remito")}</button>`:""}
      ${hasTransito?`<button class="btn up sm" data-rm-receive="${esc(g.key)}" title="${t("conj.gate2tip")}">${t("conj.recvar")} \u25be</button>`:""}
      ${hasAr?`<button class="btn up sm" data-rm-resolve="${esc(g.key)}" title="${t("conj.resolvetip")}">${t("conj.resolvear")} \u25be</button>`:""}
    </div>`;

  return `<div class="rl-card">
    ${head}
    ${rielHTML([{icon:"plane",label:t("conj.gate.transit")},{icon:"pin",label:t("conj.gate.arhands")},{icon:"split",label:t("conj.gate.resolved")}], cur)}
    ${pills?`<div style="margin:0 2px 10px;display:flex;gap:6px;flex-wrap:wrap">${pills}</div>`:""}
    ${tabla}
    ${foot}
  </div>`;
}

/* ---- Receive in AR the IN-TRANSIT lines of the remito (shared courier) ---- */
function openRecibirRemito(key){
  if(!isAdmin()){ toast(t("conj.tt.adminrecv"),"warn"); return; }
  const lines = remitoTargetLines(key, CONSIGN_ESTADOS.TRANSITO);
  if(!lines.length){ toast(t("conj.tt.notransitrecv"),"warn"); return; }
  const totalU = lines.reduce((a,l)=>a+l.cantidad,0);
  const list = lines.map(cs=>`<tr><td>${esc(cs.nombre)}<div class="hint">${esc(cs.sku||"")} · ${esc(terceroNombre(cs))}</div></td><td class="r num">${qty(cs.cantidad)}</td></tr>`).join("");
  const body = `
    <p class="hint" style="margin:0 0 16px">${t("conj.rr.hint",{n:lines.length,u:qty(totalU)})}</p>
    <div class="recv-grid">
      <div class="recv-list">
        <div class="recv-list-head">${t("conj.rr.products")} <span class="hint">${t("conj.rr.linesu",{n:lines.length,u:qty(totalU)})}</span></div>
        <div class="table-scroll recv-scroll"><table class="rm-tbl"><thead><tr><th>${t("common.product")}</th><th class="r">${t("common.units")}</th></tr></thead><tbody>${list}</tbody></table></div>
      </div>
      <div class="recv-side">
        <div class="grid-form stack" style="padding:0;gap:16px">
          ${legCostFieldHTML("rr_c",t("conj.leg.courier"),t("conj.leg.hint.batchtot"))}
          <div class="field"><label>${t("conj.l.notes")}</label><input class="inp" id="rr_obs" placeholder="${t("conj.ph.egarrival")}"></div>
        </div>
      </div>
    </div>`;
  buildModal(t("conj.md.recvar"), body, [
    {label:t("common.cancel"),cls:"btn",act:closeModal},
    {label:t("conj.b.recv",{n:qty(totalU)}),cls:"btn up",act:()=>{
      const tot = legCostRead("rr_c");
      const perU = totalU>0 ? round2(tot/totalU) : 0;
      const obs = (document.getElementById("rr_obs").value||"").trim();
      lines.forEach(cs=> avanzarConsignacion(cs.id, { costoCourierUnit:perU, obs }));
      lines.forEach(l=> delete remitoSel[l.id]);
      closeModal(); toast(t("conj.tt.recvlines",{n:lines.length,cost:tot>0?t("conj.frag.courier",{m:money(perU,"USD")}):""}),"up"); render();
    }}
  ], "recv");
  wireLegPreview("rr_c", totalU);
}

/* ---- Resolve in AR: split each remito line between Select (our
   commission) and the owner. If there's a SPLIT (something to Select AND something to the owner)
   TWO A remitos are issued citing the U: one for the owner (with accumulated cost
   + markup = what's charged) and one for Select (enters our stock). If it goes
   all to a single side, NO A is issued. ---- */
function openResolverAR(key){
  if(!isAdmin()){ toast(t("conj.tt.adminstock"),"warn"); return; }
  const lines = remitoTargetLines(key, CONSIGN_ESTADOS.AR);
  if(!lines.length){ toast(t("conj.tt.noarlines"),"warn"); return; }
  const store = STORE_IDS[1] || STORE_IDS[0];
  const rows = lines.map((cs,i)=>{
    const acc = round2((cs.costoUnit||0)+(cs.costoCourierUnit||0));   // costo acumulado (2 puertas)
    return `<tr>
      <td>${esc(cs.nombre)}<div class="hint">${esc(cs.sku||"")} · ${esc(terceroNombre(cs))}</div></td>
      <td class="r num">${qty(cs.cantidad)}</td>
      <td><input class="inp num res-q" id="rq_${i}" value="0" data-max="${cs.cantidad}" inputmode="numeric"></td>
      <td class="r num" id="rt_${i}">${qty(cs.cantidad)}</td>
      <td class="r num">${money(acc,"USD")}</td>
      <td><input class="inp num" id="rc_${i}" value="${acc}" inputmode="decimal" title="${t('conj.tip.selcost')}"></td>
    </tr>`;
  }).join("");
  const body = `
    <p class="hint" style="margin:0 0 10px">${t("conj.res.hint",{store:esc(storeName(store))})}</p>
    <div class="table-scroll" style="margin-bottom:14px"><table class="rm-tbl">
      <thead><tr><th>${t("common.product")}</th><th class="r">${t("conj.th.inar")}</th><th style="width:84px">${t("conj.th.tosel")}</th><th class="r" style="width:70px">${t("conj.th.toowner")}</th><th class="r">${t("conj.th.acccost")}</th><th style="width:104px">${t("conj.th.selcostu")}</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <div class="grid-form" style="grid-template-columns:1fr 1fr;padding:0">
      ${legCostFieldHTML("res_extra",t("conj.leg.extrasel"),t("conj.leg.hint.spread"))}
      <div class="field"><label>${t("conj.l.ownermk")} <span class="hint" style="font-weight:400">${t("conj.l.ownermk.hint")}</span></label><input class="inp num" id="res_mk" value="0" inputmode="decimal"><div class="leg-pu hint" id="res_mk_pu">${t("conj.mk.none")}</div></div>
      <div class="field" style="grid-column:1/-1"><label>${t("conj.l.notes")}</label><input class="inp" id="res_obs" placeholder="${t("conj.ph.egsplit")}"></div>
    </div>`;
  buildModal(t("conj.md.resolve",{store:esc(store===STORE_IDS[1]?storeName(store):"AR")}), body, [
    {label:t("common.cancel"),cls:"btn",act:closeModal},
    {label:t("conj.b.resolve"),cls:"btn up",act:()=>{
      // U context (before mutating)
      const remId  = lines[0] && lines[0].remitoId || null;
      const conjId = lines[0] && lines[0].conjuntaId || null;
      const uRemito = remId ? remitoById(remId) : null;
      const uCodigo = uRemito ? uRemito.codigo : ((lines[0]&&lines[0].remitoCodigo)||"U");
      const mkPct = Math.max(0, parseNum(document.getElementById("res_mk").value)||0);
      const obs   = (document.getElementById("res_obs").value||"").trim();
      // total to Select to prorate the extra
      let totalSelU=0;
      lines.forEach((cs,i)=>{ totalSelU += Math.min(Math.max(0,parseNum(document.getElementById("rq_"+i).value)||0), cs.cantidad); });
      const extraTot = legCostRead("res_extra");
      const extraPU  = totalSelU>0 ? round2(extraTot/totalSelU) : 0;

      const selLines=[], terLines=[];
      let selU=0, terU=0;
      lines.forEach((cs,i)=>{
        const inAr = cs.cantidad;
        const sel  = Math.min(Math.max(0,parseNum(document.getElementById("rq_"+i).value)||0), inAr);
        const ter  = round4(inAr - sel);
        const acc  = round2((cs.costoUnit||0)+(cs.costoCourierUnit||0));
        // 1) the owner's part: charge = accumulated cost + markup (computed BEFORE mutating)
        if(ter>0){
          const chargeU = round2(acc*(1+mkPct/100));
          terLines.push({ productoId:cs.productoId, sku:cs.sku, nombre:cs.nombre, cantidad:ter, rol:"third", owner:terceroNombre(cs), costoUnit:acc, charge:chargeU });
          terU += ter;
        }
        // 2) ours to Select: enters stock (reduces the consignment / closes it)
        if(sel>0){
          const cost = round2((parseNum(document.getElementById("rc_"+i).value)||0) + extraPU);
          const kept = quedarseParaSelect(cs.id, sel, cost, obs);
          if(kept>0){ selLines.push({ productoId:cs.productoId, sku:cs.sku, nombre:cs.nombre, cantidad:kept, rol:"select", owner:terceroNombre(cs), costoUnit:cost }); selU += kept; }
        }
        // 3) deliver to the owner what remains of the consignment (the non-kept part)
        if(ter>0){ avanzarConsignacion(cs.id, { obs:t("conj.obs.delivresolve") }); }
        delete remitoSel[cs.id];
      });

      if(selU<=0 && terU<=0){ toast(t("conj.tt.nothingresolve"),"warn"); return; }

      // Two A remitos ONLY if there was a SPLIT (something to Select AND something to the owner)
      let aSel=null, aTer=null;
      if(selU>0 && terU>0){
        const origen = uRemito ? { id:uRemito.id, codigo:uRemito.codigo } : { id:null, codigo:uCodigo };
        aTer = crearRemito({ letra:"A", tipo:"ar-tercero", fuente:{ tipo:"resolve", id:(remId||conjId) }, origen, lineas:terLines, obs:(obs?obs+" · ":"")+t("conj.obs.toowner")+(mkPct>0?t("conj.frag.markup",{p:mkPct}):"") });
        aSel = crearRemito({ letra:"A", tipo:"ar-select",  fuente:{ tipo:"resolve", id:(remId||conjId) }, origen, lineas:selLines, obs:(obs?obs+" · ":"")+t("conj.obs.toselect") });
      }
      save(); closeModal();
      if(aSel && aTer){
        toast(t("conj.tt.split",{u:uCodigo,ter:aTer.codigo,sel:aSel.codigo}),"up");
        // Both A remitos are saved and downloaded from the Remitos section.
      } else if(selU>0){
        toast(t("conj.tt.kept",{n:qty(selU),store:storeName(store)}),"up");
      } else {
        toast(t("conj.tt.deliveredowner",{n:qty(terU),mk:mkPct>0?t("conj.frag.markup",{p:mkPct}):""}),"up");
      }
      render();
    }}
  ], "wide");
  // live previews: "→ Owner" per row, prorated extra and markup
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
  if(mk&&mkOut){ const upd=()=>{ const p=Math.max(0,parseNum(mk.value)||0); mkOut.textContent = p>0?t("conj.mk.charge",{p:p}):t("conj.mk.none"); }; mk.oninput=upd; upd(); }
  recalc();
}

/* View wiring (called by wire() in 16-view-datos.js). */
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
  // clickable counters: scroll to the matching section
  m.querySelectorAll("[data-scroll]").forEach(c=> c.onclick=()=>{ const el=document.getElementById(c.dataset.scroll); if(el) el.scrollIntoView({behavior:"smooth",block:"start"}); });
  // --- per-remito view ---
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
