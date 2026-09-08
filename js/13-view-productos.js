/* ============================================================
   gestordestock — 13-view-productos.js
   Parte de la app. Se carga como <script> en el ORDEN del index.html.
   Todo vive en scope global (sin módulos), igual que antes.
   ============================================================ */
/* ============================================================
   VISTA: Productos
   ============================================================ */
function viewProd(){
  const total = productosVendibles().length;
  return `
  <div class="head">
    <div class="title"><h2>Products</h2><p>Item master. Cost updates with each purchase (last landed cost); COGS is FIFO.</p></div>
    <div class="actions">
      ${total?`<button class="btn" id="btnExpPrecios">⤓ Price list</button>`:""}
      ${(total&&isAdmin())?`<button class="btn" id="btnSel">${selMode?ICO.x+"Cancel":ICO.select+"Select"}</button>`:""}
      ${puedeEditarProductos()?`<button class="btn primary" data-newp>+ New product</button>`:""}
    </div>
  </div>
  <div class="panel">
    <div class="phead"><h3>Master</h3><span class="hint" id="prodCount">${total} items</span></div>
    <div class="selbar" id="selbar" style="display:none">
      <span id="selcount" class="sel-hint">Tick the products to export or delete…</span>
      <div style="flex:1"></div>
      <div id="selactions" style="display:none">
        <button class="btn ghost sm" id="selexp">${ICO.select}Export selected</button>
        <button class="btn ghost sm" id="selnone">Deselect</button>
        ${isAdmin()?`<button class="btn danger sm" id="seldel">${ICO.trash}Delete selected</button>`:""}
      </div>
    </div>
    ${total ? `
    ${filterBarHTML("p", prodFiltros)}
    <div class="table-scroll"><table>
      <thead><tr>${selMode?`<th class="c"><input type="checkbox" id="selall"></th>`:""}${sortTh(prodFiltros,"sku","SKU","")}${sortTh(prodFiltros,"nombre","Name","")}${sortTh(prodFiltros,"lang","Lang","c")}${sociedadColsHead(prodFiltros)}${sortTh(prodFiltros,"stock",stockView==="cases"?"Stock (cases)":"Stock","r")}${sortTh(prodFiltros,"costo","Last cost","r")}${sortTh(prodFiltros,"pventa","List price","r")}<th></th></tr></thead>
      <tbody id="prodBody"></tbody></table></div>`
      : emptyState("The master is empty","Create your first product, or let them appear on their own when you import a purchase with new SKUs.")}
  </div>`;
}
function renderProdRows(){
  const body=document.getElementById("prodBody"); if(!body) return;
  const list=filtrarProds(prodFiltros);
  const showCols = showSociedadCols();
  const cols = (selMode?1:0)+7+(showCols?STORE_IDS.length:0);
  body.innerHTML = stockRowset(list, prodFiltros).map(({p,kind})=>{
    const isT = kind==="transit";
    const units = isT ? transitoEnFoco(p) : stockEnFoco(p);
    let cls="stock-cell";
    if(isT) cls+=" transit";
    else { if(units<0) cls+=" neg"; else if(units===0) cls+=" zero"; else if(bajoStock(p)) cls+=" low"; }
    // en la fila de tránsito no tiene sentido el checkbox de selección
    const chk = selMode ? (isT ? `<td class="c"></td>` : `<td class="c" data-nofic><input type="checkbox" class="selchk" data-selp="${p.id}" ${selProd.has(p.id)?"checked":""}></td>`) : "";
    const flag = isT ? ' <span class="inv-badge transit">⋯ in transit</span>' : (esBloqueado(p) ? ' <span class="pill blocked">blocked</span>' : "");
    const cost = isT ? (transitoEnFoco(p)>0 ? round2(transitoValorEnFoco(p)/transitoEnFoco(p)) : (p.ultimoCosto||0)) : (p.ultimoCosto||0);
    const perStore = sociedadColsCells(p, isT);
    return `<tr data-ficha="${p.id}" class="${isT?'row-transit':''}" style="cursor:pointer">
      ${chk}
      <td><span class="sku">${esc(p.sku||"—")}</span></td>
      <td>${esc(p.nombre)}${flag}</td>
      <td class="c">${esc(langLabel(p.idioma))}</td>
      ${perStore}
      <td class="r ${cls}">${stockDisplay(p,units)}</td>
      <td class="r num">${money(cost)}</td>
      <td class="r num">${isT?"—":moneyOpt(p.precioVenta)}</td>
      <td class="r"><button class="btn ghost sm" data-editp="${p.id}">Edit</button></td>
    </tr>`;
  }).join("") || `<tr><td colspan="${cols}" style="text-align:center;color:var(--muted);padding:22px">No product matches the filters.</td></tr>`;
  const cnt=document.getElementById("prodCount");
  const total=productosVendibles().length;
  if(cnt) cnt.textContent = list.length===total ? `${total} items` : `showing ${list.length} of ${total}`;
  body.querySelectorAll("[data-ficha]").forEach(tr=> tr.onclick=()=> openFicha(tr.dataset.ficha));
  body.querySelectorAll("[data-editp]").forEach(b=> b.onclick=(e)=>{ e.stopPropagation(); openProd(b.dataset.editp); });
  body.querySelectorAll("[data-nofic]").forEach(td=> td.onclick=e=>e.stopPropagation());
  body.querySelectorAll(".selchk").forEach(cb=>{
    cb.onclick=e=>e.stopPropagation();
    cb.onchange=()=>{ cb.checked?selProd.add(cb.dataset.selp):selProd.delete(cb.dataset.selp); refreshSelbar(); };
  });
  refreshSelbar();
}
function refreshSelbar(){
  const bar=document.getElementById("selbar"), count=document.getElementById("selcount"),
        all=document.getElementById("selall"), acts=document.getElementById("selactions");
  const n=selProd.size;
  if(bar) bar.style.display = selMode ? "flex" : "none";
  if(acts) acts.style.display = n===0 ? "none" : "flex";
  if(count) count.textContent = n===0 ? "Tick the products to export or delete…"
                                       : (n===1?"1 selected":`${n} selected`);
  if(count) count.className = n===0 ? "sel-hint" : "";
  if(all){ const vis=filtrarProds(prodFiltros); all.checked = vis.length>0 && vis.every(p=>selProd.has(p.id)); }
}
function wireProd(){
  const exp=document.getElementById("btnExpPrecios");
  if(exp) exp.onclick=()=>{
    const base = (selMode && selProd.size) ? db.productos.filter(p=>selProd.has(p.id)) : filtrarProds(prodFiltros);
    exportListaPrecios(base);
  };
  const btn=document.getElementById("btnSel");
  if(btn) btn.onclick=()=>{ selMode=!selMode; if(!selMode) selProd.clear(); render(); };
  if(!document.getElementById("prodBody")) return;
  [...selProd].forEach(id=>{ if(!prodById(id)) selProd.delete(id); });
  wireFilterBar("p", prodFiltros, renderProdRows);
  const all=document.getElementById("selall");
  if(all) all.onchange=()=>{
    const vis=filtrarProds(prodFiltros);
    if(all.checked) vis.forEach(p=>selProd.add(p.id)); else vis.forEach(p=>selProd.delete(p.id));
    renderProdRows();
  };
  const selexp=document.getElementById("selexp"); if(selexp) selexp.onclick=()=> exportListaPrecios(db.productos.filter(p=>selProd.has(p.id)));
  const none=document.getElementById("selnone"); if(none) none.onclick=()=>{ selProd.clear(); renderProdRows(); };
  const del=document.getElementById("seldel"); if(del) del.onclick=deleteSelProd;
  wireSortHeaders(prodFiltros);
  renderProdRows();
}
function deleteSelProd(){
  const ids=[...selProd]; if(!ids.length) return;
  const prods=ids.map(prodById).filter(Boolean);
  const conStock=prods.filter(p=>stockTotalP(p)!==0).length;
  const conMovs=prods.filter(p=>db.movimientos.some(m=>m.productoId===p.id)).length;
  let msg=`Delete ${prods.length} product(s) from the master?`;
  if(conStock) msg+=`\n\n⚠ ${conStock} have non-zero stock: deleting them removes those units from the valuation.`;
  if(conMovs) msg+=`\n\n⚠ ${conMovs} have kardex movements. History stays (name and SKU), but you won't be able to open their card.`;
  msg+="\n\nThis can't be undone.";
  if(!confirm(msg)) return;
  db.productos = db.productos.filter(p=>!selProd.has(p.id));
  selProd.clear(); selMode=false;
  save(); toast(`${prods.length} product(s) deleted`, "warn"); render();
}

