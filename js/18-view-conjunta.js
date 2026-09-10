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
    // Entran a Select (AR) cuando se reciben (botón "Receive in AR").
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
    <p class="hint" style="margin:0 0 12px">In transit: <b>${qty(held)}</b> u · valued ${money(transValor(p), "USD")}. Receiving moves them into <b>${esc(storeName(destino))}</b> stock (sellable). Add an import cost per unit only if <b>we</b> pay it (default 0 — the client does).</p>
    <div class="grid-form" style="grid-template-columns:1fr 1fr;padding:0">
      <div class="field"><label>Units to receive</label><input class="inp num" id="rt_q" value="${held}"></div>
      <div class="field"><label>Import cost per unit <span class="hint" style="font-weight:400">· optional</span></label><input class="inp num" id="rt_c" value="0"></div>
      <div class="field" style="grid-column:1/3"><label>Notes</label><input class="inp" id="rt_obs" placeholder="e.g. shipment #, nationalization ref"></div>
    </div>`;
  buildModal("Receive in AR ("+esc(storeName(destino))+")", body, [
    {label:"Cancel",cls:"btn",act:closeModal},
    {label:"Receive into "+storeName(destino),cls:"btn up",act:()=>{
      const q=Math.min(Math.max(0,parseNum(document.getElementById("rt_q").value)||0), transUnits(p));
      const c=Math.max(0,parseNum(document.getElementById("rt_c").value)||0);
      const obs=(document.getElementById("rt_obs").value||"").trim();
      if(q<=0){ toast("Enter a quantity","warn"); return; }
      const done = transferStock(p, TRANSITO_STORE, destino, q, c, obs);
      if(done>0){ closeModal(); toast(`Received ${qty(done)} u into ${storeName(destino)}`, "up"); render(); }
    }}
  ]);
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
    <p class="hint" style="margin:0 0 12px">Move sellable units into transit (e.g. sending Swan (USA) stock to AR). They leave the sellable stock and become Select (AR) stock when received.</p>
    <div class="grid-form" style="grid-template-columns:1fr 1fr;padding:0">
      <div class="field" style="grid-column:1/3"><label>Product</label><select class="inp" id="et_prod">${prodOpts}</select></div>
      <div class="field"><label>From deposit</label><select class="inp" id="et_store"></select></div>
      <div class="field"><label>Units</label><input class="inp num" id="et_q" value="0"></div>
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
      const done = transferStock(p, st, TRANSITO_STORE, q, 0, obs);
      if(done>0){ closeModal(); toast(`Sent ${qty(done)} u to transit`, "up"); render(); }
    }}
  ]);
  // depósitos con stock del producto elegido (se actualiza al cambiar de producto)
  const fillStores=()=>{
    const p=prodById(document.getElementById("et_prod").value);
    const sel=document.getElementById("et_store");
    const conStock = STORE_IDS.filter(s=> stockDe(p,s)>0);
    sel.innerHTML = conStock.map(s=>`<option value="${s}">${esc(storeName(s))} · ${qty(stockDe(p,s))} u</option>`).join("") || `<option value="">— no stock —</option>`;
  };
  document.getElementById("et_prod").onchange=fillStores;
  fillStores();
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
  const trRows = enTransito.map(p=>`<tr>
      <td><span class="sku">${esc(p.sku||"—")}</span> ${esc(p.nombre)}</td>
      <td class="r num">${qty(transUnits(p))}</td>
      <td class="r num">${money(transValor(p), "USD")}</td>
      <td class="r" style="white-space:nowrap"><button class="btn up sm" data-recib="${p.id}">Receive in AR ▾</button> <button class="btn ghost sm" data-merma="${p.id}" title="Write-off (loss)" style="color:var(--alert)">✕</button></td>
    </tr>`).join("") || `<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:18px">Nothing in transit right now.</td></tr>`;

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
  const estadoPill = (e)=>{
    const col = e===CONSIGN_ESTADOS.TRANSITO ? "var(--muted)" : e===CONSIGN_ESTADOS.AR ? "var(--acc)" : "var(--up)";
    return `<span style="font-size:11px;padding:2px 8px;border-radius:999px;border:1px solid ${col};color:${col};white-space:nowrap">${esc(consignLabel(e))}</span>`;
  };
  const csRows = activas.map(cs=>{
    const acciones = cs.estado===CONSIGN_ESTADOS.TRANSITO
        ? `<button class="btn up sm" data-cs-recib="${cs.id}">Receive in AR ▾</button>`
        : `<button class="btn up sm" data-cs-entregar="${cs.id}">Mark delivered</button>`;
    return `<tr>
      <td><span class="sku">${esc(cs.sku||"—")}</span> ${esc(cs.nombre)}</td>
      <td>${esc(terceroNombre(cs))}</td>
      <td class="r num">${qty(cs.cantidad)}</td>
      <td>${estadoPill(cs.estado)}</td>
      <td class="r" style="white-space:nowrap">${acciones} <button class="btn ghost sm" data-cs-del="${cs.id}" title="Remove from tracking" style="color:var(--alert)">✕</button></td>
    </tr>`;
  }).join("") || `<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:18px">No third-party units being tracked.</td></tr>`;

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
  const tipos = { "transfer-out":"→ sent", "transfer-in":"← received", "conjunta":"commission in", "merma":"write-off" };
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

  return `
  <div class="head"><div class="title"><h2>Joint buy &amp; transit</h2><p>Commission-in-kind intake, the USA → transit → AR flow, and third-party tracking.</p></div>
    <div class="actions"><button class="btn" data-enviar-transito>Send to transit</button><button class="btn up" data-new-conj>＋ New joint buy</button></div>
  </div>
  <div class="kpis" style="grid-template-columns:repeat(4,1fr);margin-bottom:18px">
    <div class="kpi"><div class="lbl">Ours in transit to AR</div><div class="val">${qty(unidadesEnTransitoAR())}</div><div class="sub">sellable once received</div></div>
    <div class="kpi"><div class="lbl">Transit value (ours)</div><div class="val">${money(valorEnTransitoAR(), "USD")}</div><div class="sub">at entry cost</div></div>
    <div class="kpi"><div class="lbl">Third-party tracked</div><div class="val">${qty(ajActivas)}</div><div class="sub">not ours · in flow</div></div>
    <div class="kpi"><div class="lbl">Joint buys</div><div class="val">${qty((db.conjuntas||[]).length)}</div><div class="sub">loaded</div></div>
  </div>

  <div class="panel" style="margin-bottom:18px">
    <div class="phead"><h3>Ours · in transit → receive in AR</h3></div>
    <div class="table-scroll"><table>
      <thead><tr><th>Product</th><th class="r">In transit</th><th class="r">Value</th><th></th></tr></thead>
      <tbody>${trRows}</tbody></table></div>
  </div>

  <div class="panel" style="margin-bottom:18px">
    <div class="phead"><h3>Third-party · tracked merchandise (not ours)</h3><p class="hint" style="margin:2px 0 0">Followed through the flow US → AR → delivery. Never enters sellable stock.</p></div>
    <div class="table-scroll"><table>
      <thead><tr><th>Product</th><th>Owner</th><th class="r">Units</th><th>Status</th><th></th></tr></thead>
      <tbody>${csRows}</tbody></table></div>
  </div>

  <div class="panel" style="margin-bottom:18px">
    <div class="phead"><h3>Third-party · by owner</h3></div>
    <div class="table-scroll"><table>
      <thead><tr><th>Owner</th><th class="r">In transit</th><th class="r">In AR</th><th class="r">Delivered</th><th class="r">Total</th></tr></thead>
      <tbody>${resRows}</tbody></table></div>
  </div>

  <div class="panel" style="margin-bottom:18px">
    <div class="phead"><h3>Recent movements between deposits</h3></div>
    <div class="table-scroll"><table>
      <thead><tr><th>Date</th><th>Product</th><th>Deposit</th><th>Movement</th><th class="r">Units</th></tr></thead>
      <tbody>${movRows}</tbody></table></div>
  </div>

  <div class="panel">
    <div class="phead"><h3>History</h3></div>
    <div class="table-scroll"><table>
      <thead><tr><th>Date</th><th>Client</th><th>Ref</th><th class="c">Order</th><th class="r">Swan</th><th class="r">→ AR</th><th class="r">3rd-party</th><th></th></tr></thead>
      <tbody>${histRows}</tbody></table></div>
  </div>`;
}

/* ---- Recibir consignación (ajeno) en AR: en_transito → en_ar, con courier opcional ---- */
function openRecibirConsignacion(id){
  if(!isAdmin()){ toast("Only admins can receive stock","warn"); return; }
  const cs = consignAll().find(x=>x.id===id); if(!cs) return;
  const body = `
    <p class="hint" style="margin:0 0 12px"><b>${esc(cs.nombre)}</b> · owner <b>${esc(terceroNombre(cs))}</b> · <b>${qty(cs.cantidad)}</b> u. Marks them <b>received in AR</b> (still not ours, still tracked). Add courier/financial cost per unit for cost-sharing (optional — doesn't affect margin).</p>
    <div class="grid-form" style="grid-template-columns:1fr 1fr;padding:0">
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
  ]);
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

/* Wireo de la vista (lo llama wire() en 16-view-datos.js). */
function wireConjunta(){
  const m = document.getElementById("main"); if(!m) return;
  const nb = m.querySelector("[data-new-conj]"); if(nb) nb.onclick=()=> openConjunta();
  const et = m.querySelector("[data-enviar-transito]"); if(et) et.onclick=()=> openEnviarTransito();
  m.querySelectorAll("[data-recib]").forEach(b=> b.onclick=()=> openRecibirTransito(b.dataset.recib));
  m.querySelectorAll("[data-merma]").forEach(b=> b.onclick=()=> openMermaTransito(b.dataset.merma));
  m.querySelectorAll("[data-cjdel-doc]").forEach(b=> b.onclick=()=> deleteConjunta(b.dataset.cjdelDoc));
  m.querySelectorAll("[data-remito-doc]").forEach(b=> b.onclick=()=> generarRemitoPDF(b.dataset.remitoDoc));
  m.querySelectorAll("[data-cs-recib]").forEach(b=> b.onclick=()=> openRecibirConsignacion(b.dataset.csRecib));
  m.querySelectorAll("[data-cs-entregar]").forEach(b=> b.onclick=()=> entregarConsignacion(b.dataset.csEntregar));
  m.querySelectorAll("[data-cs-del]").forEach(b=> b.onclick=()=> removeConsignacion(b.dataset.csDel));
}
