/* ============================================================
   gestordestock — 17-view-clientes.js
   Parte de la app. Se carga como <script> en el ORDEN del index.html.
   Todo vive en scope global (sin módulos), igual que antes.
   ============================================================ */
/* ============================================================
   VISTA: Clientes (punto 13) — listado, edición y borrado.
   Las facturas guardan un snapshot del cliente (doc.cliente), así que
   borrar el maestro NO altera las ventas históricas. Igual avisamos
   cuántas ventas tiene asociadas antes de borrar.
   ============================================================ */
let cliFiltro = "";
let cliSort = { sortKey:"", sortDir:"" };   // ordenamiento de la tabla de clientes
function ventasDeCliente(id){ return (db.ventas||[]).filter(v=>v.clienteId===id); }
function viewClientes(){
  const q = cliFiltro.trim().toLowerCase();
  let list = (db.clientes||[]).slice();
  if(q) list = list.filter(c=> ((c.nombre||"")+" "+(c.empresa||"")+" "+(c.email||"")+" "+(c.ciudad||"")+" "+(c.pais||"")).toLowerCase().includes(q));
  // Orden por columna. Sin columna activa: nombre ascendente (A→Z).
  const key = cliSort.sortKey || "nombre";
  const dir = cliSort.sortKey ? (cliSort.sortDir==="asc"?1:-1) : 1;
  const valOf = c => {
    switch(key){
      case "email":   return String(c.email||"");
      case "ciudad":  return String([c.ciudad,c.estado].filter(Boolean).join(", "));
      case "pais":    return String(c.pais||"");
      case "ventas":  return ventasDeCliente(c.id).length;
      case "nombre":
      default:        return String(c.nombre||"");
    }
  };
  list.sort((a,b)=>{ const va=valOf(a), vb=valOf(b); if(typeof va==="number") return dir*(va-vb); return dir*va.localeCompare(vb,"en",{numeric:true}); });
  const rows = list.map(c=>{
    const nv = ventasDeCliente(c.id).length;
    return `<tr>
      <td><b>${esc(c.nombre||"—")}</b>${c.empresa?`<div class="hint" style="font-size:11.5px">${esc(c.empresa)}</div>`:""}</td>
      <td>${esc(c.email||"—")}${c.telefono?`<div class="hint" style="font-size:11.5px">${esc(c.telefono)}</div>`:""}</td>
      <td>${esc([c.ciudad,c.estado].filter(Boolean).join(", ")||"—")}</td>
      <td>${esc(c.pais||"—")}</td>
      <td class="r num">${nv}</td>
      <td class="r" style="white-space:nowrap">
        <a href="#" data-cliedit="${c.id}">Edit</a>
        <a href="#" data-clidel="${c.id}" style="color:var(--down);margin-left:10px">Delete</a>
      </td>
    </tr>`;
  }).join("");
  const body = list.length
    ? `<div class="table-scroll"><table>
        <thead><tr>${sortTh(cliSort,"nombre","Customer","")}${sortTh(cliSort,"email","Email","")}${sortTh(cliSort,"ciudad","City","")}${sortTh(cliSort,"pais","Country","")}${sortTh(cliSort,"ventas","Sales","r")}<th class="r">Actions</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`
    : emptyState("No customers yet","Create one from a sale, or add it here with “New customer”.");
  return `
  <div class="head"><div class="title"><h2>Customers</h2><p>${db.clientes.length} customer(s). Invoices keep a snapshot, so deleting one won’t change past sales.</p></div>
    <div class="actions"><button class="btn primary" data-clinew>+ New customer</button></div>
  </div>
  <div class="panel">
    <div class="phead" style="gap:10px"><input class="inp" id="cliSearch" placeholder="Search by name, company, email, city or country…" value="${esc(cliFiltro)}" style="max-width:420px">
      ${cliFiltro?`<button class="btn sm" data-cliclear>Clear</button>`:""}</div>
    ${body}
  </div>`;
}
function wireClientes(){
  const m=document.getElementById("main");
  // OJO: wireClientes() corre en CADA render (último en wire()). wireSortHeaders()
  // agarra TODOS los #main th[data-sortk], así que sin este guard pisaba los
  // handlers de orden de las demás pestañas con cliSort -> ninguna tabla ordenaba.
  if(!m.querySelector("#cliSearch")) return;   // sólo cablear en la vista de Clientes
  wireSortHeaders(cliSort);
  const s=m.querySelector("#cliSearch"); if(s){ s.oninput=()=>{ cliFiltro=s.value; const b=m.querySelector(".table-scroll"); render(); const s2=document.getElementById("cliSearch"); if(s2){ s2.focus(); s2.setSelectionRange(s2.value.length,s2.value.length); } }; }
  const cc=m.querySelector("[data-cliclear]"); if(cc) cc.onclick=()=>{ cliFiltro=""; render(); };
  const nw=m.querySelector("[data-clinew]"); if(nw) nw.onclick=()=> openClienteStandalone(null);
  m.querySelectorAll("[data-cliedit]").forEach(a=> a.onclick=e=>{ e.preventDefault(); openClienteStandalone(a.dataset.cliedit); });
  m.querySelectorAll("[data-clidel]").forEach(a=> a.onclick=e=>{ e.preventDefault(); deleteCliente(a.dataset.clidel); });
}
/* Form de cliente independiente de la venta (no toca draft). */
function openClienteStandalone(id){
  const c = id ? clienteById(id) : null;
  buildModal(c?"Edit customer":"New customer", `
    <div class="grid-form" style="grid-template-columns:1fr 1fr;padding:0">
      <div class="field" style="grid-column:1/3"><label>Customer name <span class="hint" style="font-weight:400">· required</span></label><input class="inp" id="cs_nom" value="${c?esc(c.nombre):""}"></div>
      <div class="field"><label>Contact name</label><input class="inp" id="cs_con" value="${c?esc(c.contacto):""}"></div>
      <div class="field"><label>Company</label><input class="inp" id="cs_emp" value="${c?esc(c.empresa):""}"></div>
      <div class="field"><label>Phone</label><input class="inp" id="cs_tel" value="${c?esc(c.telefono):""}"></div>
      <div class="field"><label>Email</label><input class="inp" id="cs_mail" value="${c?esc(c.email):""}"></div>
      <div class="field" style="grid-column:1/3"><label>Address</label><input class="inp" id="cs_dir" value="${c?esc(c.direccion):""}" placeholder="Street address"></div>
      <div class="field"><label>City</label><input class="inp" id="cs_ciu" value="${c?esc(c.ciudad):""}"></div>
      <div class="field"><label>State</label><input class="inp" id="cs_est" value="${c?esc(c.estado):""}" placeholder="FL, NJ..."></div>
      <div class="field"><label>ZIP</label><input class="inp" id="cs_zip" value="${c?esc(c.zip):""}"></div>
      <div class="field"><label>Country</label><input class="inp" id="cs_pais" value="${c?esc(c.pais):""}" placeholder="USA, Japan, Argentina..."></div>
    </div>
  `, [
    {label:"Cancel",cls:"btn",act:closeModal},
    {label:"Save customer",cls:"btn primary",act:()=>saveClienteStandalone(id)}
  ], true);
  document.getElementById("cs_nom").focus();
}
function saveClienteStandalone(id){
  const g=x=>document.getElementById(x).value.trim();
  const nom=g("cs_nom");
  if(!nom){ toast("Customer name is required","warn"); return; }
  const mail=g("cs_mail");
  if(mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)){ toast("The email format isn't valid","warn"); return; }
  const campos={ nombre:nom, contacto:g("cs_con"), empresa:g("cs_emp"), telefono:g("cs_tel"),
                 email:mail, direccion:g("cs_dir"), ciudad:g("cs_ciu"), estado:g("cs_est"), zip:g("cs_zip"), pais:g("cs_pais") };
  if(id){ Object.assign(clienteById(id), campos); }
  else { db.clientes.push(Object.assign({id:uid()}, campos)); }
  save(); toast("Customer saved"); closeModal(); render();
}
function deleteCliente(id){
  const c=clienteById(id); if(!c) return;
  const nv=ventasDeCliente(id).length;
  const msg = nv>0
    ? `Delete "${c.nombre}"?\n\nThis customer has ${nv} sale(s). Those invoices keep their own snapshot and won't change, but the customer will no longer appear in the picker or list.`
    : `Delete "${c.nombre}"?`;
  if(!confirm(msg)) return;
  db.clientes = db.clientes.filter(x=>x.id!==id);
  save(); toast("Customer deleted","warn"); render();
}

/* ¿La compra en edición es de terceros? y ¿cuántas unidades de una línea son NUESTRAS
   (las que entran a stock)? En propia (o venta) es la cantidad completa. */
function draftEsTerceros(){ return !!(draft && draft.tipo==="compra" && draft.origen==="terceros"); }
function lineaOurs(l){
  const q = parseNum(l.cantidad)||0;
  if(!draftEsTerceros()) return q;
  return Math.min(Math.max(0, parseNum(l.aNuestro)||0), q);
}
function renderLines(){
  const isC = draft.tipo==="compra";
  const terc = isC && draft.origen==="terceros";   // PUNTO 1: factura de terceros -> columna "Ours" por línea
  const docCcy = storeCcy(isC?draft.store:draft.storeVenta);
  const host = document.getElementById("lineHost");
  const rows = draft.lineas.map((l,i)=>{
    const p = prodById(l.productoId);
    if(isC){
      const newFields = l.crear ? `
        <div style="display:flex;gap:6px;margin-top:6px">
          <input class="inp" placeholder="SKU" value="${esc(l.sku)}" data-k="sku" data-i="${i}" style="max-width:110px">
          <input class="inp" placeholder="New product name" value="${esc(l.nombre)}" data-k="nombre" data-i="${i}">
        </div>` : "";
      if(terc){
        const qtot = parseNum(l.cantidad)||0;
        const ours = Math.min(Math.max(0, parseNum(l.aNuestro)||0), qtot);
        const aTerc = Math.max(0, qtot - ours);
        return `<tr>
          <td style="min-width:200px">
            <div class="ppick">${pickerBtn(l,i)}</div>
            ${newFields}
          </td>
          <td style="width:74px"><input class="inp num" data-k="cantidad" data-i="${i}" value="${l.cantidad}" title="Total units of this SKU in the invoice"></td>
          <td style="width:80px" class="col-ours"><input class="inp num" data-k="aNuestro" data-i="${i}" value="${ours}" title="Units you keep (enter stock). The rest travels to the owner."></td>
          <td class="r num" style="width:66px;color:var(--muted)" data-terc="${i}" title="Units that keep travelling to the owner (tracked, not stock)">${qty(aTerc)}</td>
          <td style="width:104px"><input class="inp num" data-k="precio" data-i="${i}" value="${l.precio}" title="Unit cost (reference for the third-party units; real cost for your units)"></td>
          <td class="r num sub-cell" style="width:110px">${money(ours*l.precio, docCcy)}</td>
          <td style="width:34px"><button class="btn ghost sm" data-del="${i}" title="Remove">✕</button></td>
        </tr>`;
      }
      return `<tr>
        <td style="min-width:220px">
          <div class="ppick">${pickerBtn(l,i)}</div>
          ${newFields}
        </td>
        <td style="width:90px"><input class="inp num" data-k="cantidad" data-i="${i}" value="${l.cantidad}"></td>
        <td style="width:120px"><input class="inp num" data-k="precio" data-i="${i}" value="${l.precio}"></td>
        <td class="r num sub-cell" style="width:120px">${money(l.cantidad*l.precio, docCcy)}</td>
        <td style="width:34px"><button class="btn ghost sm" data-del="${i}" title="Remove">✕</button></td>
      </tr>`;
    }
    // ---- VENTA ----
    const rem = p ? dispRestante(l.productoId, i) : 0;
    const comprom = p ? comprometidoOtras(l.productoId, i) : 0;
    const over = p && (parseNum(l.cantidad)||0) > rem;
    const dispInfo = p
      ? `<div class="disp-info" data-di="${i}" style="font-size:11px;margin-top:4px;color:${over?'var(--alert)':'var(--muted)'}">avail: ${qty(stockBaseVenta(l.productoId))}${comprom>0?` · left ${qty(rem)}`:""}${over?" · <b>over stock</b>":""}</div>`
      : `<div class="disp-info" data-di="${i}" style="font-size:11px;margin-top:4px"></div>`;
    return `<tr>
      <td style="min-width:260px">
        <div class="ppick">${pickerBtn(l,i)}</div>
        ${dispInfo}
      </td>
      <td style="width:58px"><input class="inp num" data-k="cantidad" data-i="${i}" value="${l.cantidad}"></td>
      <td class="r num" style="width:74px;color:var(--muted)">${p?money(l.costoRef, docCcy):"—"}</td>
      <td style="width:60px"><input class="inp num" data-k="margen" data-i="${i}" value="${l.margen||0}" placeholder="%"></td>
      <td style="width:86px"><input class="inp num" data-k="precio" data-i="${i}" value="${l.precio}"></td>
      <td class="r num" style="width:44px;color:var(--muted)" data-mg="${i}">${p&&l.precio>0?nf0.format((l.precio-l.costoRef)/l.precio*100)+"%":"—"}</td>
      <td class="r num sub-cell" style="width:88px">${money(l.cantidad*l.precio, docCcy)}</td>
      <td style="width:30px"><button class="btn ghost sm" data-del="${i}" title="Remove">✕</button></td>
    </tr>`;
  }).join("");

  // colgroup: 1ª col (producto) sin ancho => absorbe el sobrante; el resto en px fijos.
  // Con table-layout:fixed esto define el ancho real de cada columna y evita el scroll horizontal.
  const colgroup = terc
    ? `<colgroup><col><col style="width:82px"><col style="width:88px"><col style="width:70px"><col style="width:112px"><col style="width:118px"><col style="width:46px"></colgroup>`
    : isC
    ? `<colgroup><col><col style="width:92px"><col style="width:134px"><col style="width:134px"><col style="width:46px"></colgroup>`
    : `<colgroup><col><col style="width:78px"><col style="width:96px"><col style="width:86px"><col style="width:94px"><col style="width:80px"><col style="width:112px"><col style="width:46px"></colgroup>`;
  const thead = terc
    ? `<tr><th>Product</th><th class="r" title="Total in the invoice">Qty</th><th class="r" title="Units you keep (enter stock)">Ours</th><th class="r" title="Travels to the owner (tracked)">→ owner</th><th class="r">Unit cost</th><th class="r" title="Subtotal of your units">Subtotal</th><th></th></tr>`
    : isC
    ? `<tr><th>Product</th><th class="r">Qty</th><th class="r">Unit cost</th><th class="r">Subtotal</th><th></th></tr>`
    : `<tr><th>Product</th><th class="r">Qty</th><th class="r">Cost</th><th class="r" title="Markup %">Mk&nbsp;%</th><th class="r" title="Unit price">Price</th><th class="r" title="Real margin on revenue">Mrg&nbsp;%</th><th class="r">Subtotal</th><th></th></tr>`;
  host.innerHTML = `<div class="table-scroll"><table class="line-tbl doc-tbl">
    ${colgroup}
    <thead>${thead}</thead>
    <tbody>${rows}</tbody></table></div>`;

  // combobox de producto (task 2): abre el buscador flotante
  host.querySelectorAll("[data-ppick]").forEach(b=> b.onclick=()=> openProductPicker(+b.dataset.ppick, b));
  wireNameTips(host);   // hover => nombre completo si el nombre quedó truncado en la línea

  host.querySelectorAll("[data-k]").forEach(inp=>{
    const i=+inp.dataset.i, k=inp.dataset.k;
    inp.oninput = ()=>{
      const l=draft.lineas[i];
      if(k==="cantidad"){
        let v=parseNum(inp.value);
        if(!isC && l.productoId){
          // TASK 1: tope = stock − comprometido en OTRAS líneas del mismo documento
          const rem=dispRestante(l.productoId, i);
          if(v>rem){ v=Math.max(0,rem); inp.value=v; toast(`Available for this line: ${qty(rem)} (already committed on other lines)`,"warn"); }
        }
        l.cantidad=v;
        if(terc){ refreshTercLinea(i, host); }   // re-clampa "Ours" y refresca "→ owner" al cambiar el total
        updateDispInfos();   // refresca "quedan" en todas las líneas del mismo producto
      }
      else if(k==="aNuestro"){
        const q=parseNum(l.cantidad)||0;
        let v=Math.min(Math.max(0,parseNum(inp.value)||0), q);
        l.aNuestro=v;
        refreshTercLinea(i, host);
      }
      else if(k==="precio"){
        l.precio=parseNum(inp.value);
        if(!isC && l.costoRef>0){ l.margen = round2((l.precio/l.costoRef - 1)*100);
          const mi=host.querySelector(`[data-k="margen"][data-i="${i}"]`); if(mi) mi.value=l.margen; }
      }
      else if(k==="margen"){
        l.margen=parseNum(inp.value);
        l.precio = round2((l.costoRef||0)*(1+(l.margen||0)/100));
        const pi=host.querySelector(`[data-k="precio"][data-i="${i}"]`); if(pi) pi.value=l.precio;
      }
      else l[k]=inp.value;
      if(!isC && (k==="precio"||k==="margen")){
        const mg=host.querySelector(`[data-mg="${i}"]`);
        if(mg) mg.textContent = (l.precio>0) ? nf0.format((l.precio-l.costoRef)/l.precio*100)+"%" : "—";
      }
      if(k==="cantidad"||k==="precio"||k==="margen"){ updateSubtotals(); refreshTotal(); if(typeof refreshNet==="function") refreshNet(); }
    };
    if(!isC && k==="cantidad"){
      // Flujo continuo tipo caja: Enter en Cantidad agrega una línea nueva y abre su picker.
      inp.addEventListener("keydown",(e)=>{
        if(e.key==="Enter"){
          e.preventDefault();
          draft.lineas.push(blankLine());
          renderLines(); refreshTotal();
          const newIdx = draft.lineas.length-1;
          const pk = document.querySelector(`#lineHost [data-ppick="${newIdx}"]`);
          if(pk) openProductPicker(newIdx, pk);
        }
      });
    }
  });
  host.querySelectorAll("[data-del]").forEach(b=> b.onclick=()=>{
    draft.lineas.splice(+b.dataset.del,1);
    if(!draft.lineas.length) draft.lineas.push(blankLine());
    renderLines(); refreshTotal();
  });
}
function updateSubtotals(){
  const host=document.getElementById("lineHost");
  const docCcy = storeCcy(draft.tipo==="compra"?draft.store:draft.storeVenta);
  host.querySelectorAll("tbody tr").forEach((tr,i)=>{
    const l=draft.lineas[i]; if(!l) return;
    const cell=tr.querySelector(".sub-cell");
    if(cell) cell.textContent = money(lineaOurs(l)*l.precio, docCcy);
  });
}
/* Refresca, sin re-render (para no perder el foco del input), la celda "→ owner",
   el valor clampeado de "Ours" y los totales de una línea de compra de terceros. */
function refreshTercLinea(i, host){
  host = host || document.getElementById("lineHost"); if(!host) return;
  const l=draft.lineas[i]; if(!l) return;
  const q=parseNum(l.cantidad)||0, ours=lineaOurs(l), aTerc=Math.max(0,q-ours);
  const ownerCell=host.querySelector(`[data-terc="${i}"]`); if(ownerCell) ownerCell.textContent=qty(aTerc);
  const inp=host.querySelector(`[data-k="aNuestro"][data-i="${i}"]`); if(inp && (parseNum(inp.value)||0)!==ours) inp.value=ours;
  updateSubtotals(); refreshTotal();
}
function refreshTotal(){
  const docCcy = storeCcy(draft.tipo==="compra"?draft.store:draft.storeVenta);
  const foot=document.getElementById("docTotal") || document.querySelector(".modal .mextra .num");
  if(foot) foot.textContent = money(docTotal(), docCcy);
  const h=document.getElementById("d_proHint");
  if(h && draft.tipo==="compra"){
    const u=unidadesDoc(), extra=(draft.handling||0)+(draft.flete||0);
    h.textContent = (extra>0 && u>0)
      ? `${money(extra, docCcy)} split across ${qty(u)} u = ${money(extra/u, docCcy)} per unit, added to each product cost.`
      : "Enter handling/freight; it prorates per unit on confirm.";
  }
}

function nuevoProductoBase(sku, nombre, precioVenta){
  const p = { id:uid(), sku:(sku||"").trim(), unidad:"u", nombre:(nombre||"").trim(),
        stock:0, costoNeto:0, costoHandling:0, costoFlete:0, ultimoCosto:0,
        precioVenta: precioVenta||0, puntoRepedido:0,
        categoria:"Otros", nivel:"unidad", packsPorBox:PACKS_POR_BOX_DEF, boxesPorCase:boxesCaseDefault("Otros"),
        estado:PRODUCT_STATES.SALE, idioma:"",
        stockPorTienda:{}, lotes:{}, precioVentaPorTienda:{} };
  STORE_IDS.forEach(s=>{ p.stockPorTienda[s]=0; p.lotes[s]=[]; p.precioVentaPorTienda[s]=precioVenta||0; });
  // buckets no-vendibles (bóveda y tránsito), para no depender de una recarga/migración
  p.stockPorTienda[INV_STORE]=0; p.lotes[INV_STORE]=[];
  p.stockPorTienda[TRANSITO_STORE]=0; p.lotes[TRANSITO_STORE]=[];
  return p;
}
function confirmDoc(){
  const isC = draft.tipo==="compra";
  // Punto 3: sólo el admin carga compras.
  if(isC && !puedeComprar()){ toast("Only admins can load purchases","warn"); return; }
  // PUNTO 1 — factura de terceros: parte nuestra (a stock) + parte que sigue viaje al dueño
  // (consignación, tracked). Va por su propio camino para no tocar el flujo de compra normal.
  if(isC && draft.origen==="terceros"){ return confirmCompraTerceros(); }
  const store = draft.store || STORE_IDS[0];   // sólo relevante para COMPRA (sociedad que compra)
  const storeVenta = draft.storeVenta || STORE_IDS[0];   // depósito desde el que se vende
  // Sale: require a customer before generating the invoice
  if(!isC && !clienteById(draft.clienteId)){
    toast("Pick (or create) a customer before generating the sale","warn"); return;
  }
  // Punto 1: alerta de compra DUPLICADA (mismo proveedor + fecha + N° de factura).
  // Sólo en compras NUEVAS (al editar no aplica). Avisa y deja decidir (no bloquea).
  if(isC && !draft.editingId){
    const prov = (draft.contraparte||"").trim().toLowerCase();
    const fch  = normISO(draft.fecha) || "";
    const num  = (draft.numero||"").trim().toLowerCase();
    if(num){   // sin N° de factura no tiene sentido chequear duplicado
      const dupCompra = db.compras.find(c=>
        (c.contraparte||"").trim().toLowerCase()===prov &&
        (normISO(c.fecha)||"")===fch &&
        (c.numero||"").trim().toLowerCase()===num
      );
      if(dupCompra){
        const ok = confirm(
          `⚠ Possible duplicate purchase\n\n`+
          `There's already a purchase with the same supplier, date and invoice #:\n`+
          `· Supplier: ${draft.contraparte||"—"}\n`+
          `· Date: ${fmtDate(draft.fecha)}\n`+
          `· Invoice #: ${draft.numero||"—"}\n`+
          `· ${dupCompra.lineas.reduce((a,l)=>a+l.cantidad,0)} u · ${money(dupCompra.total, storeCcy(dupCompra.store))}\n\n`+
          `Loading this again will add the stock a SECOND time. Continue anyway?`
        );
        if(!ok) return;
      }
    }
  }
  // Resolve lines
  const resolved = [];
  for(const l of draft.lineas){
    if(!l.cantidad || l.cantidad<=0) continue;
    let p=null;
    if(l.crear){
      // Punto 5: si el SKU YA existe, lo adoptamos automáticamente en vez de crear
      // un duplicado (esto evitaba el error "already belongs" y los productos
      // fantasma en cero del punto 7).
      const dup = skuEnUso(l.sku, null);
      if(dup){
        p = dup;
      } else {
        if(!l.nombre.trim()){ toast("A new product is missing its name","warn"); return; }
        p = nuevoProductoBase(l.sku, l.nombre, isC?(l.precioVentaSugerido||0):l.precio);
        db.productos.push(p);
      }
    } else {
      p = prodById(l.productoId);
      if(!p){ toast("A line has no product assigned","warn"); return; }
    }
    // --- SPECIAL STATE GUARDS on sale (point 5) ---
    if(!isC){
      if(soloEnVault(p)){ toast(`"${p.nombre}" is in the investment vault and can't be sold`,"warn"); return; }
      if(esBloqueado(p)){ toast(`"${p.nombre}" is blocked (best-offer). It needs admin approval before selling`,"warn"); return; }
    }
    const costoSnap = isC ? l.precio : fifoCostoPeek(p, storeVenta, l.cantidad).unit;   // FIFO unit cost in the chosen deposit
    resolved.push({ prod:p, cantidad:l.cantidad, precio:l.precio, costo:costoSnap });
  }
  if(!resolved.length){ toast("Add at least one valid line","warn"); return; }

  // PUNTO 1 — prorrateo de costos adicionales (compra), POR UNIDAD:
  // cada unidad del documento carga (handling+flete)/unidades_totales.
  let handPU=0, fletePU=0;
  if(isC){
    const uds = resolved.reduce((a,r)=>a+r.cantidad,0);
    handPU  = uds>0 ? (draft.handling||0)/uds : 0;
    fletePU = uds>0 ? (draft.flete||0)/uds : 0;
  }

  // Si estamos editando, calculamos (sin mutar) el efecto de revertir el documento original
  const editing = !!draft.editingId;
  let oldDoc=null; const revertMap={};
  if(editing){
    const list0 = isC?db.compras:db.ventas;
    oldDoc = list0.find(x=>x.id===draft.editingId) || null;
    if(oldDoc){
      oldDoc.lineas.forEach(l=>{
        const d = isC ? -l.cantidad : +l.cantidad;   // deshacer el efecto original
        revertMap[l.productoId] = (revertMap[l.productoId]||0) + d;
      });
    }
  }

  // Validación de venta contra el POOL UNIFICADO (suma de todas las sociedades).
  // Nunca stock negativo. Si estoy editando, el stock del doc original "vuelve" al
  // pool (revertMap) y se puede revalidar contra ese total.
  if(!isC){
    // El descuento de stock de la venta original sólo "vuelve" si era del MISMO depósito.
    const oldStoreV = oldDoc ? (oldDoc.storeVenta || oldDoc.store || STORE_IDS[0]) : null;
    const oldSameStore = oldStoreV===storeVenta;
    const pedido={};
    resolved.forEach(r=>{ pedido[r.prod.id]=(pedido[r.prod.id]||0)+r.cantidad; });
    const faltantes=[];
    Object.keys(pedido).forEach(id=>{
      const p=prodById(id);
      const eff = stockDe(p, storeVenta) + (editing && oldSameStore ? (revertMap[id]||0) : 0);
      if(pedido[id]>eff) faltantes.push(`• ${p.nombre}: available ${qty(eff)} in ${storeName(storeVenta)}, you asked ${qty(pedido[id])}`);
    });
    if(faltantes.length){
      toast("Not enough stock","warn");
      alert(`Can't sell more than the stock on hand at ${storeName(storeVenta)}:\n\n`+faltantes.join("\n")+"\n\nAdjust the quantities or switch deposit. Stock can't go negative.");
      return;
    }
  }

  const subtotalLineas = totalLineas(resolved);
  const cli = isC ? null : clienteById(draft.clienteId);
  const envioMonto = (!isC && draft.envio && draft.envio.tipo==="monto") ? (draft.envio.monto||0) : 0;
  // Task 5: cargos on-top facturados al cliente (suman al total de la venta).
  const cargosClienteArr = (!isC ? (draft.cargosCliente||[]) : [])
    .filter(c=> (parseNum(c.monto)||0) > 0)
    .map(c=>({ nota:(c.nota||"").trim(), monto:round2(parseNum(c.monto)||0) }));
  const cargosClienteMonto = round2(cargosClienteArr.reduce((a,c)=> a + c.monto, 0));
  const totalDoc = isC ? round2(subtotalLineas + (draft.handling||0) + (draft.flete||0))
                       : round2(subtotalLineas + envioMonto + cargosClienteMonto);
  const doc = {
    id: editing ? draft.editingId : uid(), tipo:draft.tipo, contraparte:draft.contraparte.trim(),
    fecha:normISO(draft.fecha) || new Date().toISOString().slice(0,10), numero:draft.numero.trim(),
    lineas: resolved.map(r=>{
      const base = { productoId:r.prod.id, sku:r.prod.sku, nombre:r.prod.nombre, cantidad:r.cantidad, precio:r.precio, costo:r.costo };
      if(isC){
        base.neto = r.precio; base.handling = round2(handPU); base.flete = round2(fletePU);
        base.costoTotal = round2(r.precio + handPU + fletePU);   // landed unit cost
      }
      return base;
    }),
    subtotal: subtotalLineas,
    total: totalDoc
  };
  if(isC){
    doc.store = store;   // sociedad que compra (procedencia del lote)
    doc.handling = draft.handling||0; doc.flete = draft.flete||0;
    // preservar el estado de envío al editar; una compra nueva arranca "in transit"
    doc.status = (editing && oldDoc && oldDoc.status) ? oldDoc.status : INVOICE_STATUS.IN_TRANSIT;
  }
  else {
    doc.storeVenta = storeVenta;   // depósito del que se despachó (para COGS y revert)
    doc.costosExtra = (draft.costosExtra||[])
      .filter(c=> (parseNum(c.monto)||0) > 0)
      .map(c=>({ tipo:c.tipo||"otro", nota:(c.nota||"").trim(), monto:round2(parseNum(c.monto)||0), ccy:(c.ccy==="ARS"?"ARS":"USD"),
                 ...(c.tipo==="labor" ? { horas:parseNum(c.horas)||0, valorHora:parseNum(c.valorHora)||0 } : {}) }));
    doc.clienteId = draft.clienteId;
    doc.cliente = cli ? { nombre:cli.nombre, contacto:cli.contacto, empresa:cli.empresa, telefono:cli.telefono, email:cli.email, direccion:cli.direccion, ciudad:cli.ciudad, estado:cli.estado, zip:cli.zip, pais:cli.pais||"" } : null;  // snapshot for the invoice + country slicer
    doc.envio = { tipo:draft.envio.tipo, monto:envioMonto };
    doc.cargosCliente = cargosClienteArr;   // Task 5
    doc.contraparte = cli ? clienteLinea(cli) : draft.contraparte.trim();
    // Vendedor: un seller queda fijado a sí mismo; el admin usa el que eligió (o ninguno).
    // El nombre se snapshotea para que sobreviva aunque después se renombre/borre el vendedor.
    let vid = isSeller() ? (currentVendedorId()||"") : (draft.vendedorId||"");
    doc.vendedorId = vid || null;
    doc.vendedor   = vid ? vendedorNombre(vid) : (isSeller() ? ((session&&session.name)||null) : null);
    if(!doc.vendedorId && isSeller() && session && session.name) doc.vendedor = session.name;
    // Congelar la tasa de comisión: la PROPIA del vendedor elegido (cada uno la suya).
    // Al editar, se respeta la que la venta ya tenía. Sin vendedor -> 0 (venta "house").
    doc.commissionRate = (editing && oldDoc && oldDoc.commissionRate!=null)
      ? oldDoc.commissionRate
      : (vid ? vendedorRate(vid) : 0);
  }
  const refTxt = (isC?"Purchase":"Sale") + (doc.numero?(" "+doc.numero):"") + (doc.contraparte?(" · "+doc.contraparte):"");

  // Recién ahora mutamos: primero revertimos el documento original (si estábamos editando)
  if(oldDoc) revertDoc(oldDoc);

  resolved.forEach((r, idx)=>{
    if(isC){
      // La compra sólo impacta stock/FIFO si queda RECEIVED. Si nace/queda
      // "in transit", el documento se guarda pero el inventario no se mueve:
      // la mercadería recién entra cuando se marca recibida.
      if(doc.status===INVOICE_STATUS.RECEIVED){
        const landed = round2(r.precio + handPU + fletePU);
        fifoEntrada(r.prod, store, r.cantidad, landed, refTxt, doc.id);  // FIFO purchase layer
        moverStock(r.prod, +r.cantidad, landed, "compra", doc.id, refTxt, { store });
        r.prod.costoNeto = r.precio; r.prod.costoHandling = round2(handPU); r.prod.costoFlete = round2(fletePU);
        r.prod.ultimoCosto = landed;        // last landed cost (reference only; COGS is FIFO)
      }
    } else {
      // Venta desde el DEPÓSITO elegido: consumo FIFO por fecha dentro de ESE depósito.
      const res = fifoConsumir(r.prod, storeVenta, r.cantidad);
      doc.lineas[idx].costo = res.unit;                              // costo FIFO unitario (mezcla real del depósito)
      doc.lineas[idx].cogs = res.cogs;                               // COGS total
      doc.lineas[idx].consumed = res.consumed;                       // capas consumidas -> revert exacto (usa doc.storeVenta)
      moverStock(r.prod, -r.cantidad, res.unit, "venta", doc.id, refTxt, { store:storeVenta });
      r.prod.precioVenta = r.precio;                                 // último precio de venta (mirror)
      if(r.prod.precioVentaPorTienda) r.prod.precioVentaPorTienda[storeVenta] = r.precio;   // precio de lista del depósito
    }
  });

  (isC?db.compras:db.ventas).push(doc);
  if(!isC) rememberVenta(storeVenta, doc.vendedorId||"");   // pre-cargar contexto en la próxima venta
  draft.editingId=null;
  save(); closeModal();
  const uds=qty(doc.lineas.reduce((a,l)=>a+l.cantidad,0));
  const compraMsg = doc.status===INVOICE_STATUS.IN_TRANSIT ? `Purchase saved · ${uds} u in transit` : `Purchase saved · +${uds} u`;
  toast(editing ? `Document updated`
       : (isC?compraMsg : `Sale recorded · −${uds} u`), isC?"up":"down");
  render();
}

/* ============================================================
   PUNTO 1 — CONFIRMAR COMPRA DE TERCEROS
   ------------------------------------------------------------
   Una sola entrada de compra para todo. Si la factura es de terceros, cada
   línea se parte en:
     · Ours  -> unidades que nos quedamos: entran como una COMPRA normal (nacen
                EN TRÁNSITO en la sociedad elegida; entran a stock al marcarlas
                "recibidas", igual que cualquier compra).
     · resto -> sigue viaje al DUEÑO: nace como CONSIGNACIÓN (tracked US→AR→
                entregado). NO toca stock, ni FIFO, ni valuación, ni P&L.
   Si ninguna unidad es nuestra, no se crea compra: sólo consignaciones.
   ============================================================ */
function confirmCompraTerceros(){
  if(!puedeComprar()){ toast("Only admins can load purchases","warn"); return; }
  // ---- Task 3: EDICIÓN. Revertimos la compra previa y sus consignaciones en
  // tránsito, y recreamos todo abajo como si fuera nueva. Si alguna consignación
  // ya avanzó (hecho físico), no se toca. ----
  if(draft.editingId){
    const prev = db.compras.find(x=>x.id===draft.editingId);
    if(prev){
      const cons = (db.consignaciones||[]).filter(cs=> cs.conjuntaId===prev.id);
      if(cons.some(cs=> cs.estado!==CONSIGN_ESTADOS.TRANSITO)){
        toast("Can't edit: third-party units already moved past transit","warn"); return;
      }
      // 1) borrar sus consignaciones en tránsito  2) revertir el documento de compra
      db.consignaciones = (db.consignaciones||[]).filter(cs=> !(cs.conjuntaId===prev.id && cs.estado===CONSIGN_ESTADOS.TRANSITO));
      revertDoc(prev);   // saca la compra (y su stock/FIFO si ya estaba recibida)
    }
    draft.editingId = null;   // de acá en más es un alta limpia
  }
  const store = draft.store || STORE_IDS[0];

  const resolved = [];
  let hayTercero = false;
  for(const l of draft.lineas){
    const qtot = Math.max(0, parseNum(l.cantidad)||0);
    if(qtot<=0) continue;
    const ours  = Math.min(Math.max(0, parseNum(l.aNuestro)||0), qtot);
    const aTerc = Math.max(0, qtot - ours);
    if(ours<=0 && aTerc<=0) continue;
    let p=null;
    if(l.crear){
      const dup = skuEnUso(l.sku, null);            // si el SKU ya existe, lo adoptamos (no duplicamos)
      if(dup) p = dup;
      else {
        if(!(l.nombre||"").trim()){ toast("A new product is missing its name","warn"); return; }
        p = nuevoProductoBase(l.sku, l.nombre, l.precioVentaSugerido||0);
        db.productos.push(p);
      }
    } else {
      p = prodById(l.productoId);
      if(!p){ toast("A line has no product assigned","warn"); return; }
    }
    if(aTerc>0) hayTercero = true;
    resolved.push({ prod:p, qtot, ours, aTerc, precio:Math.max(0, parseNum(l.precio)||0) });
  }
  if(!resolved.length){ toast("Add at least one valid line","warn"); return; }
  if(hayTercero && !clienteById(draft.terceroId)){ toast("Pick the owner of the third-party units","warn"); return; }

  const ownerId   = draft.terceroId || null;
  const ownerName = ownerId ? ((clienteById(ownerId)||{}).nombre || "") : "";
  const numero    = (draft.numero||"").trim();
  const fechaISO  = normISO(draft.fecha) || new Date().toISOString().slice(0,10);

  // --- Unidades NUESTRAS -> compra normal (nace en tránsito, no mueve stock aún) ---
  const oursLines = resolved.filter(r=> r.ours>0);
  let compraDoc = null;
  if(oursLines.length){
    const udsOurs = oursLines.reduce((a,r)=>a+r.ours,0);
    const handPU  = udsOurs>0 ? (draft.handling||0)/udsOurs : 0;
    const fletePU = udsOurs>0 ? (draft.flete||0)/udsOurs : 0;
    const subtotal = round2(oursLines.reduce((a,r)=> a + round2(r.ours*r.precio), 0));
    compraDoc = {
      id: uid(), tipo:"compra", origen:"terceros",
      terceroId: ownerId, terceroNombre: ownerName,
      contraparte:(draft.contraparte||"").trim(),
      fecha: fechaISO, numero,
      store, handling:draft.handling||0, flete:draft.flete||0,
      status: INVOICE_STATUS.IN_TRANSIT,
      lineas: oursLines.map(r=>({
        productoId:r.prod.id, sku:r.prod.sku, nombre:r.prod.nombre,
        cantidad:r.ours, precio:r.precio, costo:r.precio,
        neto:r.precio, handling:round2(handPU), flete:round2(fletePU),
        costoTotal:round2(r.precio + handPU + fletePU)
      })),
      subtotal, total: round2(subtotal + (draft.handling||0) + (draft.flete||0))
    };
    db.compras.push(compraDoc);
  }

  // --- Unidades de TERCEROS -> consignaciones (tracked, nacen en tránsito) ---
  let udsTerc = 0;
  resolved.forEach(r=>{
    if(r.aTerc>0 && ownerId){
      udsTerc += r.aTerc;
      crearConsignacion({
        conjuntaId: compraDoc ? compraDoc.id : null,
        envioRef: numero, fecha: fechaISO, terceroId: ownerId,
        productoId:r.prod.id, sku:r.prod.sku, nombre:r.prod.nombre,
        cantidad:r.aTerc, costoUnit:r.precio,
        obs: "Third-party invoice" + (numero?(" "+numero):"")
      });
    }
  });

  draft.editingId=null;
  save(); closeModal();
  const udsOurs = oursLines.reduce((a,r)=>a+r.ours,0);
  const parts = [];
  if(udsOurs>0) parts.push(`+${qty(udsOurs)} u to stock (in transit)`);
  if(udsTerc>0) parts.push(`${qty(udsTerc)} u tracked for ${ownerName||"owner"}`);
  toast("Third-party invoice saved · " + (parts.join(" · ")||"nothing to load"), "up");
  render();
}

/* ---- Revertir / borrar / editar documentos ---- */
function recomputeUltimoCosto(prod){
  // último costo (landed) = de la compra más reciente que todavía contenga este producto.
  // Usamos el desglose guardado (neto+handling+flete). Compras viejas sin desglose caen a l.precio.
  for(let i=db.compras.length-1;i>=0;i--){
    const l = db.compras[i].lineas.find(x=>x.productoId===prod.id);
    if(l){
      prod.costoNeto = (l.neto!=null) ? l.neto : l.precio;
      prod.costoHandling = l.handling||0;
      prod.costoFlete = l.flete||0;
      prod.ultimoCosto = (l.costoTotal!=null) ? l.costoTotal : l.precio;
      return;
    }
  }
  // si no queda ninguna compra con ese producto, dejamos el último costo como está
}
/* Aplica el efecto de una compra sobre el inventario (capas FIFO + stock del
   local + último costo). Se llama al recibir la mercadería. Idempotencia: sólo
   debe invocarse cuando la compra pasa a "received", nunca dos veces. */
function receiveInvoice(doc){
  const store = doc.store || STORE_IDS[0];
  const refTxt = "Purchase" + (doc.numero?(" "+doc.numero):"") + (doc.contraparte?(" · "+doc.contraparte):"");
  doc.lineas.forEach(l=>{
    const p = prodById(l.productoId); if(!p) return;
    const landed = (l.costoTotal!=null) ? l.costoTotal : round2((l.neto!=null?l.neto:l.precio||0) + (l.handling||0) + (l.flete||0));
    fifoEntrada(p, store, l.cantidad, landed, refTxt, doc.id, { us: landed, intl:0, arg:0 });
    moverStock(p, +l.cantidad, landed, "compra", doc.id, refTxt, { store });
    if(l.neto!=null){ p.costoNeto=l.neto; p.costoHandling=l.handling||0; p.costoFlete=l.flete||0; }
    p.ultimoCosto = landed;
  });
}
/* Revierte el efecto de stock de una compra recibida SIN borrar el documento
   (des-recibir). Misma mecánica que revertDoc, pero deja la compra viva para
   volver a marcarla "in transit". */
function unreceiveInvoice(doc){
  const store = doc.store || STORE_IDS[0];
  doc.lineas.forEach(l=>{
    const p = prodById(l.productoId); if(!p) return;
    fifoQuitarCompra(p, store, doc.id);
    p.stockPorTienda[store] = round4(stockDe(p,store) - l.cantidad);
    recalcStockMirror(p);
  });
  db.movimientos = db.movimientos.filter(m=> m.refId!==doc.id);
  [...new Set(doc.lineas.map(l=>l.productoId))].forEach(id=>{ const p=prodById(id); if(p) recomputeUltimoCosto(p); });
}
function revertDoc(doc){
  const isC = doc.tipo==="compra";
  const store = doc.store || STORE_IDS[0];
  const fallbackSoc = doc.storeVenta || doc.store || STORE_IDS[0];   // ventas viejas: sociedad única original
  // Una compra en tránsito nunca impactó stock/FIFO: al borrarla sólo se quita el
  // documento, sin revertir inventario (no hay nada que revertir).
  const compraSinImpacto = isC && doc.status===INVOICE_STATUS.IN_TRANSIT;
  if(!compraSinImpacto){
    doc.lineas.forEach(l=>{
      const p = prodById(l.productoId); if(!p) return;
      if(isC){
        fifoQuitarCompra(p, store, doc.id);                 // drop the FIFO layer this purchase created
        p.stockPorTienda[store] = round4((stockDe(p,store)) - l.cantidad);
        recalcStockMirror(p);
      } else {
        // Devolución al POOL: repone cada tramo en la capa de SU sociedad y reajusta
        // el stock por sociedad. Ventas viejas (consumed sin etiqueta) caen a fallbackSoc.
        if(l.consumed && l.consumed.length){
          const repuesto = fifoDevolverGlobal(p, l.consumed, fallbackSoc);
          Object.keys(repuesto).forEach(soc=>{ p.stockPorTienda[soc] = round4((stockDe(p,soc)) + repuesto[soc]); });
        } else {
          // Venta muy vieja sin desglose: reponer todo en la sociedad de fallback al costo de la línea.
          fifoLayers(p, fallbackSoc).unshift({ id:uid(), fecha:new Date().toISOString(), cantidad:l.cantidad, costoUnit:(l.costo||p.ultimoCosto||0), ref:"revert" });
          p.stockPorTienda[fallbackSoc] = round4((stockDe(p,fallbackSoc)) + l.cantidad);
        }
        recalcStockMirror(p);
      }
    });
  }
  db.movimientos = db.movimientos.filter(m=> m.refId!==doc.id);
  const list = isC?db.compras:db.ventas;
  const i = list.findIndex(x=>x.id===doc.id); if(i>=0) list.splice(i,1);
  if(isC && !compraSinImpacto){
    [...new Set(doc.lineas.map(l=>l.productoId))].forEach(id=>{ const p=prodById(id); if(p) recomputeUltimoCosto(p); });
  }
}
function deleteDoc(tipo,id){
  const list = tipo==="compra"?db.compras:db.ventas;
  const d=list.find(x=>x.id===id); if(!d) return;
  const items=d.lineas.reduce((a,l)=>a+l.cantidad,0);
  const msg = tipo==="compra"
    ? `Delete this purchase?\n\n${qty(items)} u are REMOVED from ${storeName(d.store)} stock and its FIFO layer is dropped.`
    : `Delete this sale?\n\n${qty(items)} u are RETURNED to stock (back into their FIFO layers).`;
  if(!confirm(msg)) return;
  withUndo("Document deleted", ()=>{ revertDoc(d); save(); });
  if(document.getElementById("scrim")) closeModal();
  render();
}
function editDoc(tipo,id){
  const list = tipo==="compra"?db.compras:db.ventas;
  const d=list.find(x=>x.id===id); if(!d) return;
  // ---- Task 3: edición de COMPRA DE TERCEROS ----
  // La compra sólo guarda lo NUESTRO; lo de terceros vive como consignaciones
  // (conjuntaId = id de la compra). Reconstruimos el draft juntando ambas por
  // producto+precio. Si alguna consignación ya avanzó (llegó a AR / se entregó),
  // no se puede editar: es un hecho físico. Se avisa y se corta.
  if(tipo==="compra" && d.origen==="terceros"){
    const cons = (db.consignaciones||[]).filter(cs=> cs.conjuntaId===d.id);
    if(cons.some(cs=> cs.estado!==CONSIGN_ESTADOS.TRANSITO)){
      toast("Can't edit: third-party units already moved past transit — delete instead","warn");
      return;
    }
    const map = {};   // key = productoId|precio  ->  { ..., ours, terc }
    d.lineas.forEach(l=>{
      const k=l.productoId+"|"+l.precio;
      (map[k] = map[k] || { productoId:l.productoId, sku:l.sku, nombre:l.nombre, precio:l.precio, ours:0, terc:0 }).ours += l.cantidad;
    });
    cons.forEach(cs=>{
      const k=cs.productoId+"|"+cs.costoUnit;
      (map[k] = map[k] || { productoId:cs.productoId, sku:cs.sku, nombre:cs.nombre, precio:cs.costoUnit, ours:0, terc:0 }).terc += cs.cantidad;
    });
    draft = {
      tipo:"compra", editingId:id, origen:"terceros", terceroId:d.terceroId||"",
      store:d.store||STORE_IDS[0], storeOrig:d.store||STORE_IDS[0],
      contraparte:d.contraparte||"", fecha:normISO(d.fecha), numero:d.numero||"",
      handling:d.handling||0, flete:d.flete||0,
      lineas: Object.values(map).map(m=>({
        key:uid(), productoId:m.productoId, sku:m.sku, nombre:m.nombre,
        cantidad:m.ours+m.terc, aNuestro:m.ours, precio:m.precio,
        costoRef: prodById(m.productoId)?(prodById(m.productoId).ultimoCosto||0):m.precio,
        margen:0, precioVentaSugerido:0, crear:false
      }))
    };
    renderDocModal();
    return;
  }
  draft = {
    tipo, editingId:id, store:d.store||STORE_IDS[0], storeOrig:d.store||STORE_IDS[0],
    storeVenta: (tipo==="venta") ? (d.storeVenta||d.store||STORE_IDS[0]) : undefined,
    costosExtra: (tipo==="venta") ? (d.costosExtra||[]).map(c=>({ key:uid(), tipo:c.tipo||"otro", nota:c.nota||"", monto:c.monto||0, ccy:c.ccy||"USD", horas:c.horas||0, valorHora:c.valorHora||0 })) : undefined,
    cargosCliente: (tipo==="venta") ? (d.cargosCliente||[]).map(c=>({ key:uid(), nota:c.nota||"", monto:c.monto||0 })) : undefined,
    vendedorId: (tipo==="venta") ? (d.vendedorId||"") : "",
    contraparte:d.contraparte||"", fecha:normISO(d.fecha), numero:d.numero||"",
    clienteId:d.clienteId||"", envio: d.envio ? {tipo:d.envio.tipo, monto:d.envio.monto||0} : {tipo:"free",monto:0},
    handling:d.handling||0, flete:d.flete||0,
    lineas: d.lineas.map(l=>({ key:uid(), productoId:l.productoId, sku:l.sku, nombre:l.nombre, cantidad:l.cantidad, precio:l.precio,
      costoRef: prodById(l.productoId) ? (prodById(l.productoId).ultimoCosto||0) : (l.costo||0),
      margen: (l.costo>0)? round2((l.precio/l.costo-1)*100) : 0, precioVentaSugerido:0, crear:false }))
  };
  renderDocModal();
}
/* Copy a sale as a NEW document. Re-validates against the CURRENT unified pool. */
function copyDoc(tipo,id){
  const list = tipo==="compra"?db.compras:db.ventas;
  const d=list.find(x=>x.id===id); if(!d) return;
  if(document.getElementById("scrim")) closeModal();
  const store = d.store||STORE_IDS[0];
  const storeV = d.storeVenta||d.store||STORE_IDS[0];
  draft = {
    tipo, editingId:null, store,
    storeVenta: (tipo==="venta") ? storeV : undefined,
    costosExtra: (tipo==="venta") ? (d.costosExtra||[]).map(c=>({ key:uid(), tipo:c.tipo||"otro", nota:c.nota||"", monto:c.monto||0, ccy:c.ccy||"USD", horas:c.horas||0, valorHora:c.valorHora||0 })) : undefined,
    cargosCliente: (tipo==="venta") ? (d.cargosCliente||[]).map(c=>({ key:uid(), nota:c.nota||"", monto:c.monto||0 })) : undefined,
    vendedorId: (tipo==="venta") ? (isSeller() ? (currentVendedorId()||"") : (d.vendedorId||"")) : "",
    contraparte: tipo==="compra"?(d.contraparte||""):"",
    fecha:new Date().toISOString().slice(0,10),
    numero: tipo==="venta" ? nextFacturaVenta() : "",
    clienteId: tipo==="venta"?(d.clienteId||""):"",
    envio: (tipo==="venta" && d.envio) ? {tipo:d.envio.tipo, monto:d.envio.monto||0} : {tipo:"free",monto:0},
    handling:0, flete:0,
    lineas: d.lineas.map(l=>{
      const p=prodById(l.productoId);
      return { key:uid(), productoId:l.productoId, sku:l.sku, nombre:l.nombre, cantidad:l.cantidad, precio:l.precio,
        costoRef: p?(p.ultimoCosto||0):(l.costo||0), margen:(l.costo>0)?round2((l.precio/l.costo-1)*100):0, precioVentaSugerido:0, crear:false };
    })
  };
  const recortes=[];
  if(tipo==="venta"){
    const usado={};
    draft.lineas.forEach(l=>{
      const p=prodById(l.productoId); if(!p) return;
      const disp=Math.max(0, stockDe(p, storeV)-(usado[l.productoId]||0));
      if(l.cantidad>disp){ recortes.push(`• ${p.nombre}: asked ${qty(l.cantidad)}, ${qty(disp)} in ${storeName(storeV)}`); l.cantidad=disp; }
      usado[l.productoId]=(usado[l.productoId]||0)+l.cantidad;
    });
  }
  renderDocModal();
  if(recortes.length) alert("Copied the sale but trimmed quantities for lack of stock:\n\n"+recortes.join("\n")+"\n\nReview before confirming.");
}

/* Ver documento existente (solo lectura) */
function verDoc(tipo,id){
  const list = tipo==="compra"?db.compras:db.ventas;
  const d=list.find(x=>x.id===id); if(!d) return;
  const isC=tipo==="compra";
  const dCcy = storeCcy(isC ? (d.store||STORE_IDS[0]) : (d.storeVenta||d.store||STORE_IDS[0]));   // moneda del documento
  const rows=d.lineas.map(l=>`<tr>
    <td><span class="sku">${esc(l.sku||"—")}</span> ${esc(l.nombre)}</td>
    <td class="r num">${qty(l.cantidad)}</td>
    <td class="r num">${money(l.precio, dCcy)}</td>
    <td class="r num">${money(l.cantidad*l.precio, dCcy)}</td></tr>`).join("");
  const cli = d.cliente || (d.clienteId?clienteById(d.clienteId):null);
  const sub = (d.subtotal!=null) ? d.subtotal : totalLineas(d.lineas);
  const extras = isC
    ? ((d.handling||d.flete) ? `<div class="totrow"><span style="color:var(--muted)">Handling + freight</span><span class="num">${money((d.handling||0)+(d.flete||0), dCcy)}</span></div>` : "")
    : `<div class="totrow"><span style="color:var(--muted)">Shipping</span><span class="num">${d.envio&&d.envio.tipo==="monto"?money(d.envio.monto, dCcy):"Free shipping"}</span></div>`;
  const cliBlock = (!isC && cli) ? `<p style="margin:0 0 14px;color:var(--muted);font-size:13px">
      <b>${esc(cli.nombre)}</b>${cli.empresa?` · ${esc(cli.empresa)}`:""}<br>
      ${esc(clienteDireccion(cli)||"")}${cli.email?`<br>${esc(cli.email)}`:""}${cli.telefono?` · ${esc(cli.telefono)}`:""}</p>` : "";
  // Punto 1: bloque de estado de envío (sólo compras)
  const received = d.status===INVOICE_STATUS.RECEIVED;
  const statusBlock = isC ? `<div class="totrow" style="align-items:center">
      <span style="color:var(--muted)">Shipment status</span>
      <span style="display:flex;gap:10px;align-items:center">
        <span class="inv-badge ${received?'received':'transit'}">${received?'✓ Received':'⋯ In transit'}</span>
        <button class="btn ghost sm" data-invstatus-modal="${d.id}">${received?'Mark in transit':'Mark received'}</button>
      </span></div>` : "";
  // Punto 6: quién vendió (sólo ventas, sólo admin)
  const vendBlock = (!isC && isAdmin()) ? `<div class="totrow"><span style="color:var(--muted)">Sold by</span><span class="num">${esc(saleVendedorNombre(d))}</span></div>` : "";
  // Punto 4: comisión (sólo ventas y sólo admin/master) + costos de venta -> margen neto
  const costLines = (!isC && isAdmin()) ? (d.costosExtra||[]).map(c=>{
    const cc = c.ccy || dCcy;
    const detalle = c.tipo==="labor" && c.horas ? ` <span style="color:var(--muted)">(${nf0.format(c.horas)}h × ${money(c.valorHora||0, cc)})</span>` : (c.nota?` <span style="color:var(--muted)">· ${esc(c.nota)}</span>`:"");
    return `<div class="totrow"><span style="color:var(--muted)">− ${esc(costoTipoLabel(c.tipo))}${detalle}</span><span class="num">${money(c.monto, cc)}</span></div>`;
  }).join("") : "";
  const commBlock = (!isC && isAdmin()) ? `
    <div class="totrow"><span style="color:var(--muted)">Margin (FIFO)</span><span class="num">${money(saleMargin(d), dCcy)}</span></div>
    <div class="totrow"><span style="color:var(--muted)">− Commission (${nf0.format(saleCommissionRate(d)*100)}% of margin)</span><span class="num">${money(saleCommission(d), dCcy)}</span></div>
    ${costLines}
    ${saleCargosCliente(d)>0?`<div class="totrow"><span style="color:var(--muted)">+ Charges billed to client</span><span class="num">${money(saleCargosCliente(d), dCcy)}</span></div>`:""}
    <div class="totrow" style="font-weight:700;border-top:1px solid var(--line);margin-top:2px;padding-top:6px"><span>Net margin</span><span class="num" style="color:${saleNetMargin(d)<0?'var(--alert)':'var(--up)'}">${money(saleNetMargin(d), dCcy)}</span></div>` : "";
  buildModal(`${isC?"Purchase":"Invoice"} ${esc(d.numero||"")}`.trim(), `
    <p style="margin:0 0 6px;color:var(--muted);font-size:14px">${esc(d.contraparte||"—")} · ${esc(fmtDate(d.fecha))}</p>
    ${cliBlock}
    <div class="table-scroll"><table>
      <thead><tr><th>Product</th><th class="r">Qty</th><th class="r">${isC?"Cost":"Price"}</th><th class="r">Subtotal</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <div class="totrow"><span style="color:var(--muted)">Subtotal</span><span class="num">${money(sub, dCcy)}</span></div>
    ${extras}
    ${(!isC ? (d.cargosCliente||[]).map(c=>`<div class="totrow"><span style="color:var(--muted)">+ ${esc(c.nota||"Charge")}</span><span class="num">${money(c.monto, dCcy)}</span></div>`).join("") : "")}
    <div class="totrow" style="font-weight:700"><span>Total</span><span class="num">${money(d.total, dCcy)}</span></div>
    ${statusBlock}
    ${vendBlock}
    ${commBlock}
  `,[
    {label:"Delete",cls:"btn danger",act:()=>deleteDoc(tipo,id)},
    ...(isC?[]:[{label:"⤓ Download PDF",cls:"btn",act:()=>generarInvoicePDF(id)},
              {label:"Copy",cls:"btn",act:()=>copyDoc(tipo,id)}]),
    {label:"Edit",cls:"btn",act:()=>{ closeModal(); editDoc(tipo,id); }},
    {label:"Close",cls:"btn",act:closeModal}
  ]);
  // Punto 1: el botón de estado dentro del detalle re-abre el modal ya actualizado.
  const sb=document.querySelector("[data-invstatus-modal]");
  if(sb) sb.onclick=()=>{ toggleInvoiceStatus(sb.dataset.invstatusModal); closeModal(); verDoc(tipo,id); };
}

