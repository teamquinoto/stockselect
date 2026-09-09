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

function nuevaConjLinea(){ return { key:uid(), productoId:"", sku:"", nombre:"", crear:false, aSelect:0, aTransito:0, costoUnit:0, precioSelect:0 }; }

function openConjunta(pre){
  if(!isAdmin()){ toast("Only admins can load joint buys","warn"); return; }
  conjDraft = pre || {
    fecha:new Date().toISOString().slice(0,10), clienteId:"", numero:"",
    totalEnvio:"", obs:"", lineas:[ nuevaConjLinea() ]
  };
  renderConjModal();
}

function conjUnidadesNuestras(){ return conjDraft.lineas.reduce((a,l)=> a + (parseNum(l.aSelect)||0) + (parseNum(l.aTransito)||0), 0); }

function renderConjModal(){
  const cli = clienteById(conjDraft.clienteId);
  const body = `
    <p class="hint" style="margin:0 0 12px">Load ONLY the units we keep as commission. <b>Cost</b> = what the unit cost YOU (0 = commission in kind). <b>Price US$</b> = optional sale price for Select; it's a different thing from cost and doesn't have to match. AR-bound units are born <b>in transit</b> and become Swan stock when received.</p>
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
  `<div class="totrow"><span style="color:var(--muted)">Units we keep</span><span class="num" id="cjTot">${qty(conjUnidadesNuestras())}</span></div>`);
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

function renderConjLines(){
  const host = document.getElementById("cjLineHost");
  const rows = conjDraft.lineas.map((l,i)=>{
    const newFields = l.crear ? `
      <div style="display:flex;gap:6px;margin-top:6px">
        <input class="inp" placeholder="SKU" value="${esc(l.sku)}" data-cjk="sku" data-cji="${i}" style="max-width:110px">
        <input class="inp" placeholder="New product name" value="${esc(l.nombre)}" data-cjk="nombre" data-cji="${i}">
      </div>` : "";
    return `<tr>
      <td style="min-width:200px">
        <div class="ppick"><button type="button" class="ppick-btn${(!l.productoId&&!l.crear)?" placeholder":""}" data-cjpick="${i}">
          <span class="ppick-label">${l.crear?"＋ New product":(l.productoId?esc((prodById(l.productoId)||{}).nombre||"—"):"— pick product —")}</span><span class="ppick-caret">▾</span></button></div>
        ${newFields}
      </td>
      <td style="width:74px"><input class="inp num" data-cjk="aSelect" data-cji="${i}" value="${l.aSelect}" title="Units kept in Select (USA)"></td>
      <td style="width:74px"><input class="inp num" data-cjk="aTransito" data-cji="${i}" value="${l.aTransito}" title="Units bound for AR (born in transit)"></td>
      <td style="width:92px"><input class="inp num" data-cjk="costoUnit" data-cji="${i}" value="${l.costoUnit}" title="What it cost YOU to get the unit (0 = commission in kind)"></td>
      <td style="width:100px"><input class="inp num" data-cjk="precioSelect" data-cji="${i}" value="${l.precioSelect||0}" title="Sale price in Select (US$). Optional. Sets the Select list price."></td>
      <td style="width:34px"><button class="btn ghost sm" data-cjdel="${i}" title="Remove">✕</button></td>
    </tr>`;
  }).join("");
  host.innerHTML = `<div class="table-scroll"><table class="line-tbl doc-tbl">
    <colgroup><col><col style="width:78px"><col style="width:78px"><col style="width:96px"><col style="width:104px"><col style="width:40px"></colgroup>
    <thead><tr><th>Product</th><th class="r" title="Select · USA">Select</th><th class="r" title="Bound for AR (transit)">→ AR</th><th class="r" title="Entry cost (0 = commission)">Cost</th><th class="r" title="Sale price in Select (US$), optional">Price US$</th><th></th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;

  host.querySelectorAll("[data-cjpick]").forEach(b=> b.onclick=()=> openConjProductPicker(+b.dataset.cjpick, b));
  host.querySelectorAll("[data-cjk]").forEach(inp=>{
    const i=+inp.dataset.cji, k=inp.dataset.cjk;
    inp.oninput=()=>{
      const l=conjDraft.lineas[i];
      if(k==="aSelect"||k==="aTransito"||k==="costoUnit"||k==="precioSelect") l[k]=parseNum(inp.value);
      else l[k]=inp.value;
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
    const aSel = Math.max(0, parseNum(l.aSelect)||0);
    const aTr  = Math.max(0, parseNum(l.aTransito)||0);
    if(aSel<=0 && aTr<=0) continue;
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
    resolved.push({ prod:p, aSelect:aSel, aTransito:aTr, costoUnit:Math.max(0, parseNum(l.costoUnit)||0), precioSelect:Math.max(0, parseNum(l.precioSelect)||0) });
  }
  if(!resolved.length){ toast("Add at least one unit to keep","warn"); return; }

  const cli = clienteById(conjDraft.clienteId);
  const doc = {
    id: uid(), fecha: normISO(conjDraft.fecha) || new Date().toISOString().slice(0,10),
    clienteId: conjDraft.clienteId || null,
    cliente: cli ? { nombre:cli.nombre, empresa:cli.empresa } : null,
    numero: (conjDraft.numero||"").trim(),
    totalEnvio: parseNum(conjDraft.totalEnvio)||0,   // memo del pedido total del cliente (no toca stock)
    obs: (conjDraft.obs||"").trim(),
    lineas: resolved.map(r=>({ productoId:r.prod.id, sku:r.prod.sku, nombre:r.prod.nombre, aSelect:r.aSelect, aTransito:r.aTransito, costoUnit:r.costoUnit }))
  };
  const refTxt = "Joint buy" + (doc.numero?(" "+doc.numero):"") + (cli?(" · "+cli.nombre):"");

  resolved.forEach(r=>{
    const p = r.prod;
    // Unidades que quedan en SELECT (USA): stock vendible al toque, con kardex.
    if(r.aSelect>0){
      fifoEntrada(p, STORE_IDS[0], r.aSelect, r.costoUnit, refTxt, doc.id);
      moverStock(p, +r.aSelect, r.costoUnit, "conjunta", doc.id, refTxt+" · commission", { store:STORE_IDS[0], tipo:"conjunta-in" });
    }
    // Unidades rumbo AR: NACEN EN TRÁNSITO (bucket, sin kardex propio, como el vault).
    // Entran a Swan cuando se reciben (botón "Receive in AR").
    if(r.aTransito>0){
      fifoEntrada(p, TRANSITO_STORE, r.aTransito, r.costoUnit, refTxt, doc.id);
      p.stockPorTienda[TRANSITO_STORE] = round4((p.stockPorTienda[TRANSITO_STORE]||0) + r.aTransito);
    }
    // último costo landed de referencia (sólo si cargaron un costo > 0)
    if(r.costoUnit>0){ p.costoNeto=r.costoUnit; p.costoHandling=0; p.costoFlete=0; p.ultimoCosto=r.costoUnit; }
    // precio de venta de Select (US$), opcional: fija la lista del depósito Select
    if(r.precioSelect>0){
      if(!p.precioVentaPorTienda) p.precioVentaPorTienda={};
      p.precioVentaPorTienda[STORE_IDS[0]] = r.precioSelect;
      p.precioVenta = r.precioSelect;   // espejo
    }
  });

  db.conjuntas.push(doc);
  conjDraft=null;
  save(); closeModal();
  const sel = doc.lineas.reduce((a,l)=>a+l.aSelect,0), tr = doc.lineas.reduce((a,l)=>a+l.aTransito,0);
  toast(`Joint buy saved · +${qty(sel)} in Select · ${qty(tr)} in transit to AR`, "up");
  render();
}

/* ---- Recibir en AR: pasa unidades de TRÁNSITO a SWAN (con costo de importación opcional) ---- */
function openRecibirTransito(prodId){
  if(!isAdmin()){ toast("Only admins can receive stock","warn"); return; }
  const p = prodById(prodId); if(!p) return;
  const held = transUnits(p);
  if(held<=0){ toast("Nothing in transit for this product","warn"); return; }
  const swan = STORE_IDS[1] || STORE_IDS[0];
  const body = `
    <p class="hint" style="margin:0 0 12px">In transit: <b>${qty(held)}</b> u · valued ${money(transValor(p), "USD")}. Receiving moves them into <b>${esc(storeName(swan))}</b> stock (sellable). Add an import cost per unit only if <b>we</b> pay it (default 0 — the client does).</p>
    <div class="grid-form" style="grid-template-columns:1fr 1fr;padding:0">
      <div class="field"><label>Units to receive</label><input class="inp num" id="rt_q" value="${held}"></div>
      <div class="field"><label>Import cost per unit <span class="hint" style="font-weight:400">· optional</span></label><input class="inp num" id="rt_c" value="0"></div>
      <div class="field" style="grid-column:1/3"><label>Notes</label><input class="inp" id="rt_obs" placeholder="e.g. shipment #, nationalization ref"></div>
    </div>`;
  buildModal("Receive in AR (Swan)", body, [
    {label:"Cancel",cls:"btn",act:closeModal},
    {label:"Receive into Swan",cls:"btn up",act:()=>{
      const q=Math.min(Math.max(0,parseNum(document.getElementById("rt_q").value)||0), transUnits(p));
      const c=Math.max(0,parseNum(document.getElementById("rt_c").value)||0);
      const obs=(document.getElementById("rt_obs").value||"").trim();
      if(q<=0){ toast("Enter a quantity","warn"); return; }
      const done = transferStock(p, TRANSITO_STORE, swan, q, c, obs);
      if(done>0){ closeModal(); toast(`Received ${qty(done)} u into ${storeName(swan)}`, "up"); render(); }
    }}
  ]);
}

/* ---- Enviar a tránsito: pasa unidades de un depósito vendible al bucket de tránsito.
   Caso secundario (las de AR nacen en tránsito), útil para mandar stock de Select a AR. ---- */
function openEnviarTransito(){
  if(!isAdmin()){ toast("Only admins can move stock","warn"); return; }
  const prods = db.productos.filter(p=> STORE_IDS.some(s=> stockDe(p,s)>0))
    .sort((a,b)=> String(a.nombre||"").localeCompare(String(b.nombre||""),"en"));
  if(!prods.length){ toast("No sellable stock to send to transit","warn"); return; }
  const prodOpts = prods.map(p=>`<option value="${p.id}">${esc(p.sku?("["+p.sku+"] "):"")}${esc(p.nombre)}</option>`).join("");
  const body = `
    <p class="hint" style="margin:0 0 12px">Move sellable units into transit (e.g. sending Select stock to AR). They leave the sellable stock and become Swan stock when received.</p>
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
    <p class="hint" style="margin:0 0 12px">In transit: <b>${qty(held)}</b> u. Write-off removes units that <b>won't arrive</b> (broken box, seized at customs, lost). They leave transit and do <b>not</b> become Swan stock.</p>
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
      const { unit } = fifoConsumir(p, TRANSITO_STORE, q);            // consume FIFO del tránsito
      p.stockPorTienda[TRANSITO_STORE] = round4(Math.max(0, transUnits(p) - q));
      // movimiento de merma en el bucket (la ficha lo muestra pero no lo suma al saldo vendible)
      moverStock(p, -q, unit, "merma", null, "Transit write-off · "+motivo, { store:TRANSITO_STORE, tipo:"merma", obs });
      save(); closeModal(); toast(`Wrote off ${qty(q)} u from transit`, "warn"); render();
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
  if(!confirm("Delete this joint buy?\n\nStock added by it (Select + transit) will be reverted where still available. Units already received in AR or sold are NOT rolled back.")) return;
  d.lineas.forEach(l=>{
    const p = prodById(l.productoId); if(!p) return;
    // revertir Select: quitar la capa FIFO de esta conjunta y bajar stock (clamp a 0)
    if(l.aSelect>0){
      fifoQuitarCompra(p, STORE_IDS[0], id);
      p.stockPorTienda[STORE_IDS[0]] = round4(Math.max(0, stockDe(p,STORE_IDS[0]) - l.aSelect));
      recalcStockMirror(p);
    }
    // revertir Tránsito: sólo lo que todavía esté en el bucket
    if(l.aTransito>0){
      fifoQuitarCompra(p, TRANSITO_STORE, id);
      p.stockPorTienda[TRANSITO_STORE] = round4(Math.max(0, transUnits(p) - l.aTransito));
    }
    if(typeof recomputeUltimoCosto==="function") recomputeUltimoCosto(p);
  });
  db.movimientos = db.movimientos.filter(m=> m.refId!==id);
  const i = db.conjuntas.findIndex(x=>x.id===id); if(i>=0) db.conjuntas.splice(i,1);
  save(); toast("Joint buy deleted","warn"); render();
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
    const sel = d.lineas.reduce((a,l)=>a+l.aSelect,0), tr = d.lineas.reduce((a,l)=>a+l.aTransito,0);
    return `<tr>
      <td>${esc(fmtDate(d.fecha))}</td>
      <td>${esc(conjClienteNombre(d))}</td>
      <td>${esc(d.numero||"—")}</td>
      <td class="c num">${d.totalEnvio?qty(d.totalEnvio):"—"}</td>
      <td class="r num">${qty(sel)}</td>
      <td class="r num">${qty(tr)}</td>
      <td class="r"><button class="btn ghost sm" data-cjdel-doc="${d.id}" style="color:var(--alert)">Delete</button></td>
    </tr>`;
  }).join("") || `<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:18px">No joint buys loaded yet.</td></tr>`;

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
  <div class="head"><div class="title"><h2>Joint buy &amp; transit</h2><p>Commission-in-kind intake and the USA → transit → AR flow.</p></div>
    <div class="actions"><button class="btn" data-enviar-transito>Send to transit</button><button class="btn up" data-new-conj>＋ New joint buy</button></div>
  </div>
  <div class="kpis" style="grid-template-columns:repeat(3,1fr);margin-bottom:18px">
    <div class="kpi"><div class="lbl">In transit to AR</div><div class="val">${qty(unidadesEnTransitoAR())}</div><div class="sub">units on the way</div></div>
    <div class="kpi"><div class="lbl">Transit value</div><div class="val">${money(valorEnTransitoAR(), "USD")}</div><div class="sub">at entry cost</div></div>
    <div class="kpi"><div class="lbl">Joint buys</div><div class="val">${qty((db.conjuntas||[]).length)}</div><div class="sub">loaded</div></div>
  </div>

  <div class="panel" style="margin-bottom:18px">
    <div class="phead"><h3>In transit → receive in AR</h3></div>
    <div class="table-scroll"><table>
      <thead><tr><th>Product</th><th class="r">In transit</th><th class="r">Value</th><th></th></tr></thead>
      <tbody>${trRows}</tbody></table></div>
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
      <thead><tr><th>Date</th><th>Client</th><th>Ref</th><th class="c">Order</th><th class="r">Select</th><th class="r">→ AR</th><th></th></tr></thead>
      <tbody>${histRows}</tbody></table></div>
  </div>`;
}

/* Wireo de la vista (lo llama wire() en 16-view-datos.js). */
function wireConjunta(){
  const m = document.getElementById("main"); if(!m) return;
  const nb = m.querySelector("[data-new-conj]"); if(nb) nb.onclick=()=> openConjunta();
  const et = m.querySelector("[data-enviar-transito]"); if(et) et.onclick=()=> openEnviarTransito();
  m.querySelectorAll("[data-recib]").forEach(b=> b.onclick=()=> openRecibirTransito(b.dataset.recib));
  m.querySelectorAll("[data-merma]").forEach(b=> b.onclick=()=> openMermaTransito(b.dataset.merma));
  m.querySelectorAll("[data-cjdel-doc]").forEach(b=> b.onclick=()=> deleteConjunta(b.dataset.cjdelDoc));
}
