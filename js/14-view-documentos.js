/* ============================================================
   gestordestock — 14-view-documentos.js
   Parte de la app. Se carga como <script> en el ORDEN del index.html.
   Todo vive en scope global (sin módulos), igual que antes.
   ============================================================ */
/* ============================================================
   VISTA: Documentos (compras / ventas)
   ============================================================ */
function viewDocs(tipo){
  const isC = tipo==="compra";
  const list = docsVisibles(tipo);
  const f = docFiltros[tipo];
  const showSocCol  = isC && isAdmin() && STORE_IDS.length>1;   // qué sociedad compró
  const showVendCol = !isC && isAdmin();                        // quién vendió (punto 6)
  return `
  <div class="head">
    <div class="title">
      <h2>${isC?"Purchases":"Sales"}</h2>
      <p>${isC?"Add stock and set each product's last cost. COGS stays FIFO."
              :"Reduce stock from the unified pool (FIFO across societies)."}</p>
    </div>
    <div class="actions">
      ${(isC&&puedeComprar())?`<button class="btn" data-import>⤒ Import PDF</button>`:""}
      <button class="btn ${isC?'up':'down'}" data-open="${tipo}">${isC?"+ Manual purchase":"− New sale"}</button>
    </div>
  </div>
  ${list.length ? `<div class="kpis" id="docKpis">${docKpisHTML(tipo, filtrarDocs(tipo))}</div>` : ""}
  <div class="panel">
    <div class="phead"><h3>${isC?"Purchase invoices":"Sales invoices"}</h3><span class="hint" id="docCount">${list.length} documents</span></div>
    ${list.length ? `
    <div class="filtros docfilt">
      <input class="inp" id="dq" placeholder="${isC?'Search by supplier or #…':'Search by customer or #…'}" value="${esc(f.q)}" style="flex:1 1 140px;min-width:110px">
      ${(!isC && isAdmin()) ? `<select class="inp" id="dvend" style="min-width:130px;max-width:160px" title="Filter by seller">
        <option value="">All sellers</option>
        ${vendedores().map(v=>`<option value="${esc(v.id)}" ${f.vend===v.id?"selected":""}>${esc(v.nombre)}</option>`).join("")}
        <option value="__none" ${f.vend==="__none"?"selected":""}>— House (no seller) —</option>
      </select>` : ""}
      <label style="font-size:12px;color:var(--muted)">From <input class="inp" id="ddesde" type="date" value="${esc(f.desde)}" style="width:128px"></label>
      <label style="font-size:12px;color:var(--muted)">To <input class="inp" id="dhasta" type="date" value="${esc(f.hasta)}" style="width:128px"></label>
      <button class="btn ghost sm" id="dclear">Clear</button>
      <span class="hint" style="font-size:11.5px;white-space:nowrap">Tap a header to sort ↑ ↓</span>
    </div>
    <div class="table-scroll"><table>
      <thead><tr>
        ${sortTh(f,"numero","#","")}
        ${sortTh(f,"fecha","Date","")}
        ${showSocCol?sortTh(f,"store","Society",""):""}
        ${showVendCol?sortTh(f,"vendedor","Sold by",""):""}
        ${sortTh(f,"contraparte",isC?"Supplier":"Customer","")}
        ${sortTh(f,"items","Items","c")}
        ${sortTh(f,"total","Total","r")}
        ${isC?sortTh(f,"status","Status","c"):""}
        ${(!isC && isAdmin())?sortTh(f,"commission","Commission","r"):""}
        <th></th>
      </tr></thead>
      <tbody id="docBody"></tbody></table></div>`
      : emptyState(isC?"No purchases yet":"No sales yet",
          isC?"Import an invoice PDF or load it by hand. Each line adds stock and updates the cost."
             :"Build a sales invoice: pick products, quantities and price, and stock drops on confirm.")}
  </div>`;
}
/* Documentos visibles según rol/foco:
   - compras: se filtran por la sociedad en foco (el admin puede mirar una sola).
   - ventas: un vendedor ve SÓLO las suyas; el admin ve todas. */
function docsVisibles(tipo){
  if(tipo==="compra"){
    const stores = effectiveStores();
    return db.compras.filter(d=> stores.includes(d.store||STORE_IDS[0]));
  }
  if(isSeller()){
    const vid = currentVendedorId();
    return db.ventas.filter(v=> (v.vendedorId||"")===vid);
  }
  return db.ventas.slice();
}
/* Encabezado ordenable: muestra ↑ (asc), ↓ (desc) o ↕ (inactivo, "sin flecha") */
function sortTh(f, key, label, align){
  const active = f.sortKey===key && f.sortDir;
  let cls = "sortable";
  if(active) cls += f.sortDir==="asc" ? " sort-asc" : " sort-desc";
  if(align) cls += " "+align;
  const arr = active ? (f.sortDir==="asc" ? "↑" : "↓") : "↕";
  return `<th class="${cls}" data-sortk="${key}">${esc(label)}<span class="sarr">${arr}</span></th>`;
}

/* Panel de KPIs de la vista (se recalcula sobre lo FILTRADO, así respeta las fechas).
   Margen = precio de venta − costo. El costo lo tomamos del snapshot de la línea
   (l.costo, se guarda desde ahora) y si el documento es viejo y no lo tiene,
   caemos al último costo actual del producto (aproximación honesta). */
function docKpisHTML(tipo, list){
  const isC = tipo==="compra";
  const rep = reportCcy();
  let total=0, uds=0, cogs=0;
  list.forEach(d=>{
    const dCcy = storeCcy(isC ? (d.store||STORE_IDS[0]) : (d.storeVenta||d.store||STORE_IDS[0]));
    // Punto 8: usar el TOTAL guardado del documento (incluye flete/handling y
    // el redondeo por renglón). Cada documento se convierte a la moneda de reporte
    // porque la lista puede mezclar depósitos en USD y ARS.
    const dt = (d.total!=null) ? d.total : round2((d.lineas||[]).reduce((a,l)=>a+round2((l.cantidad||0)*(l.precio||0)),0) + (isC?((d.handling||0)+(d.flete||0)):0));
    total += convertCcy(dt, dCcy, rep);
    (d.lineas||[]).forEach(l=>{
      uds   += (l.cantidad||0);
      if(!isC){
        const c = (l.cogs!=null) ? l.cogs : (l.cantidad||0)*((l.costo!=null)?l.costo:((prodById(l.productoId)||{}).ultimoCosto||0));
        cogs += convertCcy((l.cogs!=null) ? l.cogs : c, dCcy, rep);
      }
    });
  });
  const n = list.length;
  if(isC){
    return `
    <div class="kpi"><div class="lbl">Purchases</div><div class="val">${n}</div><div class="sub">documents in range</div></div>
    <div class="kpi"><div class="lbl">Units bought</div><div class="val">${qty(uds)}</div><div class="sub">items in</div></div>
    <div class="kpi"><div class="lbl">Total bought</div><div class="val">${money(total)}</div><div class="sub">sum of invoices</div></div>
    <div class="kpi"><div class="lbl">Avg ticket</div><div class="val">${n?money(total/n):"—"}</div><div class="sub">per purchase</div></div>`;
  }
  const margen = total - cogs;
  const margenPct = total>0 ? (margen/total*100) : 0;
  const commKpi = isAdmin() ? `
    <div class="kpi"><div class="lbl">Commission</div><div class="val">${money(list.reduce((a,d)=>a+convertCcy(saleCommission(d), storeCcy(d.storeVenta||d.store||STORE_IDS[0]), rep),0))}</div><div class="sub">seller earnings on margin</div></div>` : "";
  return `
    <div class="kpi"><div class="lbl">Sales</div><div class="val">${n}</div><div class="sub">documents in range</div></div>
    <div class="kpi"><div class="lbl">Units sold</div><div class="val">${qty(uds)}</div><div class="sub">items out</div></div>
    <div class="kpi"><div class="lbl">Total sold</div><div class="val">${money(total)}</div><div class="sub">${n?`avg ticket ${money(total/n)}`:"—"}</div></div>
    <div class="kpi"><div class="lbl">Gross margin (FIFO)</div><div class="val">${money(margen)}</div><div class="sub">${total>0?`${nf0.format(margenPct)}% on revenue`:"load sales to see margin"}</div></div>
    ${commKpi}`;
}

function filtrarDocs(tipo){
  const list = docsVisibles(tipo);
  const f = docFiltros[tipo];
  const q=(f.q||"").trim().toLowerCase();
  let out = list.filter(d=>{
    if(q){ const hay=((d.contraparte||"")+" "+(d.numero||"")).toLowerCase(); if(!hay.includes(q)) return false; }
    if(f.desde && (d.fecha||"") < f.desde) return false;
    if(f.hasta && (d.fecha||"") > f.hasta) return false;
    // filtro por vendedor (sólo ventas): id puntual, o "__none" = ventas sin vendedor (house)
    if(tipo==="venta" && f.vend){
      if(f.vend==="__none"){ if(d.vendedorId) return false; }
      else if((d.vendedorId||"")!==f.vend) return false;
    }
    return true;
  });
  // Orden: si no hay columna activa, default = fecha ↓ (más reciente primero)
  const key = f.sortKey || "fecha";
  const dir = f.sortKey ? (f.sortDir==="asc" ? 1 : -1) : -1;
  const valOf = d => {
    switch(key){
      case "numero":      return String(d.numero||"");
      case "contraparte": return String(d.contraparte||"");
      case "items":       return (d.lineas||[]).reduce((a,l)=>a+(l.cantidad||0),0);
      case "total":       return d.total||0;
      case "store":       return String(storeName(d.store||"")||"");        // Society (compra)
      case "status":      return String(d.status||"");                        // Status (compra)
      case "vendedor":    return String(saleVendedorNombre(d)||"");           // Sold by (venta)
      case "commission":  return saleCommission(d);                           // Commission (venta)
      case "fecha":
      default:            return String(d.fecha||"");
    }
  };
  out.sort((a,b)=>{
    const va=valOf(a), vb=valOf(b);
    if(typeof va==="number") return dir*(va-vb);
    return dir*va.localeCompare(vb,"es",{numeric:true});
  });
  return out;
}
function renderDocRows(tipo){
  const body=document.getElementById("docBody"); if(!body) return;
  const isC = tipo==="compra";
  const all=docsVisibles(tipo);
  const list=filtrarDocs(tipo), total=all.length;
  const showSocCol  = isC && isAdmin() && STORE_IDS.length>1;
  const showVendCol = !isC && isAdmin();
  const showComm = !isC && isAdmin();
  const cols = 6 + (showSocCol?1:0) + (showVendCol?1:0) + (isC?1:0) + (showComm?1:0);
  body.innerHTML = list.map(d=>{
    const items=d.lineas.reduce((a,l)=>a+l.cantidad,0);
    const dCcy = storeCcy(isC ? (d.store||STORE_IDS[0]) : (d.storeVenta||d.store||STORE_IDS[0]));
    const received = d.status===INVOICE_STATUS.RECEIVED;
    const statusCell = isC ? `<td class="c"><span class="inv-badge ${received?'received':'transit'}">${received?'✓ Received':'⋯ In transit'}</span></td>` : "";
    const commCell = showComm ? `<td class="r num">${money(saleCommission(d), dCcy)}</td>` : "";
    return `<tr>
      <td class="num">${esc(d.numero||"—")}</td>
      <td>${esc(fmtDate(d.fecha))}</td>
      ${showSocCol?`<td>${esc(storeName(d.store))}</td>`:""}
      ${showVendCol?`<td>${esc(saleVendedorNombre(d))}</td>`:""}
      <td>${esc(d.contraparte||"—")}</td>
      <td class="c num">${qty(items)}</td>
      <td class="r num">${money(d.total, dCcy)}</td>
      ${statusCell}
      ${commCell}
      <td class="r" style="white-space:nowrap">${(isC&&puedeComprar())?`<button class="btn ghost sm" data-invstatus="${d.id}">${received?'Mark in transit':'Mark received'}</button>`:""}<button class="btn ghost sm" data-vdoc="${tipo}:${d.id}">View</button>${tipo==="venta"?`<button class="btn ghost sm" data-copydoc="${tipo}:${d.id}">Copy</button>`:""}<button class="btn ghost sm" data-editdoc="${tipo}:${d.id}">Edit</button><button class="btn ghost sm" data-deldoc="${tipo}:${d.id}" style="color:var(--alert)">Delete</button></td>
    </tr>`;
  }).join("") || `<tr><td colspan="${cols}" style="text-align:center;color:var(--muted);padding:22px">No document matches the filters.</td></tr>`;
  const cnt=document.getElementById("docCount");
  if(cnt) cnt.textContent = list.length===total ? `${total} documents` : `showing ${list.length} of ${total}`;
  const kp=document.getElementById("docKpis");
  if(kp) kp.innerHTML = docKpisHTML(tipo, list);
  body.querySelectorAll("[data-vdoc]").forEach(b=> b.onclick=()=>{ const[t,id]=b.dataset.vdoc.split(":"); verDoc(t,id); });
  body.querySelectorAll("[data-invstatus]").forEach(b=> b.onclick=()=> toggleInvoiceStatus(b.dataset.invstatus));
  body.querySelectorAll("[data-copydoc]").forEach(b=> b.onclick=()=>{ const[t,id]=b.dataset.copydoc.split(":"); copyDoc(t,id); });
  body.querySelectorAll("[data-editdoc]").forEach(b=> b.onclick=()=>{ const[t,id]=b.dataset.editdoc.split(":"); editDoc(t,id); });
  body.querySelectorAll("[data-deldoc]").forEach(b=> b.onclick=()=>{ const[t,id]=b.dataset.deldoc.split(":"); deleteDoc(t,id); });
}
/* Punto 1: alterna el estado de una compra Y aplica su efecto sobre el stock.
   - in_transit -> received: la mercadería entra al inventario (FIFO + stock).
   - received -> in_transit: se saca del inventario. Si ya se vendió parte, el
     stock quedaría negativo: pedimos confirmación antes de proceder. */
function toggleInvoiceStatus(id){
  const c = db.compras.find(x=>x.id===id); if(!c) return;
  if(c.status===INVOICE_STATUS.RECEIVED){
    const store = c.store||STORE_IDS[0];
    const enRiesgo = c.lineas.filter(l=>{ const p=prodById(l.productoId); return p && stockDe(p,store) < l.cantidad; });
    if(enRiesgo.length){
      const det = enRiesgo.map(l=>`· ${l.nombre}`).join("\n");
      if(!confirm(`Some of this shipment was already sold, so moving it back to “in transit” will push stock negative at ${storeName(store)}:\n\n${det}\n\nContinue anyway?`)) return;
    }
    unreceiveInvoice(c);
    c.status = INVOICE_STATUS.IN_TRANSIT;
    toast("Invoice back in transit — stock removed", "warn");
  } else {
    receiveInvoice(c);
    c.status = INVOICE_STATUS.RECEIVED;
    toast("Received — stock added to inventory", "up");
  }
  save();
  if(document.getElementById("docBody")) renderDocRows("compra");
  else render();
}
function wireDocFiltros(){
  if(!document.getElementById("docBody")) return;
  const tipo = view==="compras" ? "compra" : "venta";
  const f=docFiltros[tipo];
  const upd=(k,el)=>{ f[k]=el.value; renderDocRows(tipo); };
  document.getElementById("dq").oninput=e=>upd("q",e.target);
  document.getElementById("ddesde").onchange=e=>upd("desde",e.target);
  document.getElementById("dhasta").onchange=e=>upd("hasta",e.target);
  const dvend=document.getElementById("dvend"); if(dvend) dvend.onchange=e=>{ f.vend=e.target.value; render(); };   // render completo: actualiza filas + KPIs (comisión)
  document.getElementById("dclear").onclick=()=>{
    docFiltros[tipo]= tipo==="venta"
      ? {q:"",desde:"",hasta:"",vend:"",sortKey:"",sortDir:""}
      : {q:"",desde:"",hasta:"",sortKey:"",sortDir:""};
    ["dq","ddesde","dhasta","dvend"].forEach(id=>{const el=document.getElementById(id); if(el)el.value="";});
    render();   // re-render para resetear también las flechas de los headers
  };
  // Orden por columna: clic cicla desc -> asc -> sin orden (default fecha ↓)
  document.querySelectorAll("#main th[data-sortk]").forEach(th=>{
    th.onclick=()=>{
      const k=th.dataset.sortk;
      if(f.sortKey!==k){ f.sortKey=k; f.sortDir="desc"; }
      else if(f.sortDir==="desc"){ f.sortDir="asc"; }
      else { f.sortKey=""; f.sortDir=""; }   // tercer clic: sin flecha
      render();   // reconstruye headers (flechas) + filas + KPIs
    };
  });
  renderDocRows(tipo);
}

