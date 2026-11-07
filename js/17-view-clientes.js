/* ============================================================
   gestordestock — 17-view-clientes.js
   Parte de la app. Se carga como etiqueta script en el ORDEN del index.html.
   Todo vive en scope global (sin módulos), igual que antes.
   ============================================================ */
/* ============================================================
   VISTA: Clientes (punto 13) — listado, edición y borrado.
   Las facturas guardan un snapshot del cliente (doc.cliente), así que
   borrar el maestro NO altera las ventas históricas. Igual avisamos
   cuántas ventas tiene asociadas antes de borrar.
   ============================================================ */
let cliFiltro = "";
let cliSoloInc = false;   // v87 · filtro "Datos a completar"
let cliSort = { sortKey:"", sortDir:"" };   // ordenamiento de la tabla de clientes
function ventasDeCliente(id){ return (db.ventas||[]).filter(v=>v.clienteId===id); }
function viewClientes(){
  const q = cliFiltro.trim().toLowerCase();
  let list = (db.clientes||[]).slice();
  const nInc = list.filter(clienteIncompleto).length;
  if(cliSoloInc) list = list.filter(clienteIncompleto);
  if(q) list = list.filter(c=> ((c.nombre||"")+" "+(c.empresa||"")+" "+(c.email||"")+" "+(c.ciudad||"")+" "+(c.pais||"")+" "+paisVis(c.pais)).toLowerCase().includes(q));
  // Orden por columna. Sin columna activa: nombre ascendente (A→Z).
  const key = cliSort.sortKey || "nombre";
  const dir = cliSort.sortKey ? (cliSort.sortDir==="asc"?1:-1) : 1;
  const valOf = c => {
    switch(key){
      case "email":   return String(c.email||"");
      case "ciudad":  return String([nombreVis(c.ciudad||""),nombreVis(c.estado||"")].filter(Boolean).join(", "));
      case "pais":    return String(paisVis(c.pais)||"");
      case "ventas":  return ventasDeCliente(c.id).length;
      case "nombre":
      default:        return String(c.nombre||"");
    }
  };
  list.sort((a,b)=>{ const va=valOf(a), vb=valOf(b); if(typeof va==="number") return dir*(va-vb); return dir*va.localeCompare(vb,"en",{numeric:true}); });
  const rows = list.map(c=>{
    const nv = ventasDeCliente(c.id).length;
    return `<tr>
      <td><b>${esc(nombreVis(c.nombre)||"—")}</b>${clienteIncompleto(c)?` <span class="pill cli-inc" title="${esc(validarCliente(c,c.id).errs.map(e=>t(e.key,e.vars)).join(" · "))}">${t("cl.inc.badge")}</span>`:""}${c.empresa?`<div class="hint" style="font-size:12px">${esc(nombreVis(c.empresa))}</div>`:""}</td>
      <td>${esc(c.email||"—")}${c.telefono?`<div class="hint" style="font-size:12px">${esc(c.telefono)}</div>`:""}</td>
      <td>${esc([nombreVis(c.ciudad||""),nombreVis(c.estado||"")].filter(Boolean).join(", ")||"—")}</td>
      <td>${esc(paisVis(c.pais)||"—")}</td>
      <td class="r num">${nv}</td>
      <td class="r" style="white-space:nowrap">
        <span class="rowacts">
          ${iconBtn(`data-cliedit="${c.id}"`, ICO.edit, t("common.edit"))}
          ${iconBtn(`data-clidel="${c.id}"`, ICO.trash, t("common.delete"), true)}
        </span>
      </td>
    </tr>`;
  }).join("");
  const body = list.length
    ? `<div class="table-scroll"><table>
        <thead><tr>${sortTh(cliSort,"nombre",t("md.lbl.customer"),"")}${sortTh(cliSort,"email",t("md.cli.email"),"")}${sortTh(cliSort,"ciudad",t("md.cli.city"),"")}${sortTh(cliSort,"pais",t("md.cli.country"),"")}${sortTh(cliSort,"ventas",t("cl.th.sales"),"r")}<th class="r">${t("cl.th.actions")}</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`
    : emptyState(t("cl.empty.title"),t("cl.empty.sub"),{label:t("cl.btn.new"),onclick:"openClienteStandalone(null)"});
  return `
  <div class="head"><div class="title"><h2>${t("cl.title")}</h2><p>${t("cl.sub",{n:db.clientes.length})}</p></div>
    <div class="actions"><button class="btn primary" data-clinew>${ICO.plus}${t("cl.btn.new")}</button></div>
  </div>
  <div class="panel">
    <div class="phead" style="gap:10px"><input class="inp" id="cliSearch" placeholder="${t("cl.ph.search")}" value="${esc(cliFiltro)}" style="max-width:420px">
      ${cliFiltro?`<button class="btn sm" data-cliclear>${t("cl.btn.clear")}</button>`:""}
      ${(nInc||cliSoloInc)?`<button type="button" class="chip-inc${cliSoloInc?" on":""}" data-cliinc>${ICO.warn||"⚠"}${t("cl.inc.filter",{n:nInc})}</button>`:""}</div>
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
  const ci=m.querySelector("[data-cliinc]"); if(ci) ci.onclick=()=>{ cliSoloInc=!cliSoloInc; render(); };
  const cc=m.querySelector("[data-cliclear]"); if(cc) cc.onclick=()=>{ cliFiltro=""; render(); };
  const nw=m.querySelector("[data-clinew]"); if(nw) nw.onclick=()=> openClienteStandalone(null);
  m.querySelectorAll("[data-cliedit]").forEach(a=> a.onclick=e=>{ e.preventDefault(); openClienteStandalone(a.dataset.cliedit); });
  m.querySelectorAll("[data-clidel]").forEach(a=> a.onclick=e=>{ e.preventDefault(); deleteCliente(a.dataset.clidel); });
}
/* Form de cliente independiente de la venta (no toca draft). */
function openClienteStandalone(id){
  const c = id ? clienteById(id) : null;
  buildModal(c?t("md.cli.edit"):t("md.cli.new"), clienteFormHTML("cs", c, ""), [
    {label:t("common.cancel"),cls:"btn",act:closeModal},
    {label:t("md.cli.save"),cls:"btn primary",act:()=>saveClienteStandalone(id)}
  ], true);
  wireClienteForm("cs", id);
  // v92: al abrir un cliente viejo incompleto, se marca de entrada qué le falta
  if(c && clienteIncompleto(c)) CLI_FIELDS.forEach(([sfx])=> pintarCampoCliente("cs", sfx, id));
  document.getElementById("cs_nom").focus();
}
function saveClienteStandalone(id){
  const campos = readClienteForm("cs", id);      // v92: mismas validaciones que la otra app
  if(!campos) return;
  if(id){ Object.assign(clienteById(id), campos); }
  else { db.clientes.push(Object.assign({id:uid()}, campos)); }
  save(); toast(t("md.cli.saved")); closeModal(); render();
}
function deleteCliente(id){
  const c=clienteById(id); if(!c) return;
  const nv=ventasDeCliente(id).length;
  const msg = nv>0
    ? t("cl.del.confirm",{name:c.nombre,n:nv})
    : t("cl.del.simple",{name:c.nombre});
  if(!confirm(msg)) return;
  db.clientes = db.clientes.filter(x=>x.id!==id);
  save(); toast(t("cl.deleted"),"warn"); render();
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
  const host = document.getElementById("lineHost");
  const sinMargen = !isC && !verMargenVenta();   // v94: el editor (Argentina) no ve costo ni margen de la venta
  const rows = draft.lineas.map((l,i)=>{
    const p = prodById(l.productoId);
    if(isC){
      const newFields = l.crear ? `
        <div style="display:flex;gap:6px;margin-top:6px">
          ${verSku()?`<input class="inp" placeholder="${t("cl.ph.sku")}" value="${esc(l.sku)}" data-k="sku" data-i="${i}" style="max-width:110px">`:""}
          <input class="inp" placeholder="${t("cl.ph.newprod")}" value="${esc(l.nombre)}" data-k="nombre" data-i="${i}">
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
          <td style="width:74px"><input class="inp num" data-k="cantidad" data-i="${i}" value="${l.cantidad}" title="${t("cl.tt.qtytotal")}"></td>
          <td style="width:80px" class="col-ours"><input class="inp num" data-k="aNuestro" data-i="${i}" value="${ours}" title="${t("cl.tt.ourskeep")}"></td>
          <td class="r num" style="width:66px;color:var(--muted)" data-terc="${i}" title="${t("cl.tt.toowner")}">${qty(aTerc)}</td>
          <td style="width:104px"><input class="inp num" data-k="precio" data-i="${i}" value="${l.precio}" title="${t("cl.tt.unitcost")}"></td>
          <td class="r num sub-cell" style="width:110px">${money(ours*l.precio)}</td>
          <td style="width:34px"><button class="btn ghost sm" data-del="${i}" title="${t("md.tt.remove")}" aria-label="${t("md.tt.remove")}">${ICO.x}</button></td>
        </tr>`;
      }
      return `<tr>
        <td style="min-width:220px">
          <div class="ppick">${pickerBtn(l,i)}</div>
          ${newFields}
        </td>
        <td style="width:90px"><input class="inp num" data-k="cantidad" data-i="${i}" value="${l.cantidad}"></td>
        <td style="width:120px"><input class="inp num" data-k="precio" data-i="${i}" value="${l.precio}"></td>
        <td class="r num sub-cell" style="width:120px">${money(l.cantidad*l.precio)}</td>
        <td style="width:34px"><button class="btn ghost sm" data-del="${i}" title="${t("md.tt.remove")}" aria-label="${t("md.tt.remove")}">${ICO.x}</button></td>
      </tr>`;
    }
    // ---- VENTA ----
    const rem = p ? dispRestante(l.productoId, i) : 0;
    const comprom = p ? comprometidoOtras(l.productoId, i) : 0;
    const over = p && (parseNum(l.cantidad)||0) > rem;
    const dispInfo = p
      ? `<div class="disp-info" data-di="${i}" style="font-size:11px;margin-top:4px;color:${over?'var(--alert)':'var(--muted)'}">${t("md.disp.avail",{n:qty(stockBaseVenta(l.productoId))})}${comprom>0?t("md.disp.left",{n:qty(rem)}):""}${over?t("md.disp.over"):""}</div>`
      : `<div class="disp-info" data-di="${i}" style="font-size:11px;margin-top:4px"></div>`;
    return `<tr>
      <td style="min-width:260px">
        <div class="ppick">${pickerBtn(l,i)}</div>
        ${dispInfo}
      </td>
      <td style="width:58px"><input class="inp num" data-k="cantidad" data-i="${i}" value="${l.cantidad}"></td>
      ${sinMargen?"":`<td class="r num" style="width:74px;color:var(--muted)">${p?money(l.costoRef):"—"}</td>
      <td style="width:60px"><input class="inp num" data-k="margen" data-i="${i}" value="${l.margen||0}" placeholder="%"></td>`}
      <td style="width:86px"><input class="inp num" data-k="precio" data-i="${i}" value="${l.precio}"></td>
      ${sinMargen?"":`<td class="r num" style="width:44px;color:var(--muted)" data-mg="${i}">${p&&l.precio>0?nf0.format((l.precio-l.costoRef)/l.precio*100)+"%":"—"}</td>`}
      <td class="r num sub-cell" style="width:88px">${money(l.cantidad*l.precio)}</td>
      <td style="width:30px"><button class="btn ghost sm" data-del="${i}" title="${t("md.tt.remove")}" aria-label="${t("md.tt.remove")}">${ICO.x}</button></td>
    </tr>`;
  }).join("");

  // colgroup: 1ª col (producto) sin ancho => absorbe el sobrante; el resto en px fijos.
  // Con table-layout:fixed esto define el ancho real de cada columna y evita el scroll horizontal.
  const colgroup = terc
    ? `<colgroup><col><col style="width:82px"><col style="width:88px"><col style="width:70px"><col style="width:112px"><col style="width:118px"><col style="width:46px"></colgroup>`
    : isC
    ? `<colgroup><col><col style="width:92px"><col style="width:134px"><col style="width:134px"><col style="width:46px"></colgroup>`
    : sinMargen
    ? `<colgroup><col><col style="width:92px"><col style="width:134px"><col style="width:134px"><col style="width:46px"></colgroup>`
    : `<colgroup><col><col style="width:78px"><col style="width:96px"><col style="width:86px"><col style="width:94px"><col style="width:80px"><col style="width:112px"><col style="width:46px"></colgroup>`;
  const thead = terc
    ? `<tr><th style="white-space:nowrap">${t("common.product")}</th><th class="r" style="white-space:nowrap" title="${t("cl.tt.qtyinv")}">${t("cl.th.qty")}</th><th class="r" style="white-space:nowrap" title="${t("cl.tt.ourskeep2")}">${t("cl.th.ours")}</th><th class="r" style="white-space:nowrap" title="${t("cl.tt.toowner2")}">${t("cl.th.toowner")}</th><th class="r" style="white-space:nowrap">${t("cl.th.unitcost")}</th><th class="r" style="white-space:nowrap" title="${t("cl.tt.subself")}">${t("pdf.subtotal")}</th><th></th></tr>`
    : isC
    ? `<tr><th>${t("common.product")}</th><th class="r">${t("cl.th.qty")}</th><th class="r">${t("cl.th.unitcost")}</th><th class="r">${t("pdf.subtotal")}</th><th></th></tr>`
    : sinMargen
    ? `<tr><th>${t("common.product")}</th><th class="r">${t("cl.th.qty")}</th><th class="r" title="${t("cl.tt.unitprice")}">${t("cl.th.price")}</th><th class="r">${t("pdf.subtotal")}</th><th></th></tr>`
    : `<tr><th>${t("common.product")}</th><th class="r">${t("cl.th.qty")}</th><th class="r">${t("cl.th.cost")}</th><th class="r" title="${t("cl.tt.markuppct")}">${t("cl.th.mkpct")}</th><th class="r" title="${t("cl.tt.unitprice")}">${t("cl.th.price")}</th><th class="r" title="${t("cl.tt.realmargin")}">${t("cl.th.mrgpct")}</th><th class="r">${t("pdf.subtotal")}</th><th></th></tr>`;
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
          if(v>rem){ v=Math.max(0,rem); inp.value=v; toast(t("cl.avail",{n:qty(rem)}),"warn"); }
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
  host.querySelectorAll("tbody tr").forEach((tr,i)=>{
    const l=draft.lineas[i]; if(!l) return;
    const cell=tr.querySelector(".sub-cell");
    if(cell) cell.textContent = money(lineaOurs(l)*l.precio);
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
  const foot=document.getElementById("docTotal") || document.querySelector(".modal .mextra .num");
  if(foot) foot.textContent = money(docTotal());
  if(typeof refreshNet==="function") refreshNet();   // v87 · rentabilidad estimada en vivo
  const h=document.getElementById("d_proHint");
  if(h && draft.tipo==="compra"){
    const u=unidadesDoc(), extra=(draft.handling||0)+(draft.flete||0);
    h.textContent = (extra>0 && u>0)
      ? t("md.pro.split",{total:money(extra),u:qty(u),per:money(extra/u)})
      : t("md.pro.hint");
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
  if(isC && !puedeComprar()){ toast(t("md.err.admincompra"),"warn"); return; }
  // PUNTO 1 — factura de terceros: parte nuestra (a stock) + parte que sigue viaje al dueño
  // (consignación, tracked). Va por su propio camino para no tocar el flujo de compra normal.
  if(isC && draft.origen==="terceros"){ return confirmCompraTerceros(); }
  const store = draft.store || STORE_IDS[0];   // sólo relevante para COMPRA (sociedad que compra)
  const storeVenta = draft.storeVenta || STORE_IDS[0];   // depósito desde el que se vende
  // Sale: require a customer before generating the invoice
  if(!isC && !clienteById(draft.clienteId)){
    toast(t("cl.err.pickcust"),"warn"); return;
  }
  // ---- v92 · Validaciones duras (bloquean), igual que la otra app ----
  const fechaIso = normISO(draft.fecha);
  const hoyIso = isoLocal(new Date());
  if(!fechaIso){ toast(t("md.err.date"),"warn"); const e=document.getElementById("d_fe"); if(e) e.focus(); return; }
  if(fechaIso > hoyIso){ toast(t("md.err.datefuture"),"warn"); const e=document.getElementById("d_fe"); if(e) e.focus(); return; }
  if(!isC && !cobroValidar(draft)) return;            // v78 · medio de cobro + cuenta de destino
  if(draft.lineas.some(l=> (l.productoId||l.crear) && !((parseNum(l.cantidad)||0) > 0))){ toast(t("md.err.qty"),"warn"); return; }
  // ---- Avisos (se confirman y se sigue) ----
  if(!isC){
    const avisos = [];
    const cliV = clienteById(draft.clienteId);
    if(clienteIncompleto(cliV)) avisos.push(t("md.warn.cliinc",{name:nombreVis(cliV.nombre)}));
    const dias = Math.round((new Date(hoyIso) - new Date(fechaIso)) / 86400000);
    if(dias > 60) avisos.push(t("md.warn.olddate",{d:dias}));
    draft.lineas.forEach(l=>{
      const p = prodById(l.productoId); if(!p || !((parseNum(l.cantidad)||0) > 0)) return;
      const pr = parseNum(l.precio)||0, co = (typeof draftCostoLinea==="function") ? draftCostoLinea(l) : (l.costoRef||0);
      if(pr<=0) avisos.push(t("md.warn.free",{name:p.nombre}));
      else if(co>0 && pr<co && verMargenVenta()) avisos.push(   // v103: el editor no ve costos (este aviso mostraba el costo)
        t("md.warn.belowcost",{name:p.nombre, price:money(pr), cost:money(co)}));
    });
    if(avisos.length && !confirm(t("md.warn.confirm",{list:avisos.map(x=>"• "+x).join("\n")}))) return;
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
        const ok = confirm(t("cl.dup.confirm",{supplier:draft.contraparte||"—",date:fmtDate(draft.fecha),invoice:draft.numero||"—",u:dupCompra.lineas.reduce((a,l)=>a+l.cantidad,0),total:money(dupCompra.total)}));
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
        if(!l.nombre.trim()){ toast(t("cl.err.newprodname"),"warn"); return; }
        p = nuevoProductoBase(l.sku, l.nombre, isC?(l.precioVentaSugerido||0):l.precio);
        if(typeof l.idioma==="string") p.idioma = l.idioma;   // nov 2026: idioma elegido al importar ("" = inglés / sin marcar)
        db.productos.push(p);
      }
    } else {
      p = prodById(l.productoId);
      if(!p){ toast(t("cl.err.noprod"),"warn"); return; }
    }
    // --- SPECIAL STATE GUARDS on sale (point 5) ---
    if(!isC){
      if(soloEnVault(p)){ toast(t("cl.err.vault",{name:p.nombre}),"warn"); return; }
      if(esBloqueado(p)){ toast(t("cl.err.blocked",{name:p.nombre}),"warn"); return; }
    }
    const costoSnap = isC ? l.precio : fifoCostoPeek(p, storeVenta, l.cantidad).unit;   // FIFO unit cost in the chosen deposit
    resolved.push({ prod:p, cantidad:l.cantidad, precio:l.precio, costo:costoSnap });
  }
  if(!resolved.length){ toast(t("cl.err.noline"),"warn"); return; }

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
    // v103: segunda barrera (por si la compra se usó mientras el editor estaba abierto)
    if(isC && oldDoc && trabaCompraUsada(oldDoc)) return;
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
      if(pedido[id]>eff) faltantes.push(t("cl.short.line",{name:p.nombre,avail:qty(eff),store:storeName(storeVenta),asked:qty(pedido[id])}));
    });
    if(faltantes.length){
      toast(t("cl.err.nostock"),"warn");
      alert(t("cl.alert.overstock",{store:storeName(storeVenta),list:faltantes.join("\n")}));
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
    fecha:normISO(draft.fecha) || hoyISO(), numero:draft.numero.trim(),
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
      .map(c=>({ tipo:c.tipo||"otro", nota:(c.nota||"").trim(), monto:round2(parseNum(c.monto)||0),
                 ...(c.tipo==="labor" ? { horas:parseNum(c.horas)||0, valorHora:parseNum(c.valorHora)||0 } : {}) }));
    doc.clienteId = draft.clienteId;
    doc.cliente = cli ? { nombre:cli.nombre, contacto:cli.contacto, empresa:cli.empresa, telefono:cli.telefono, email:cli.email, direccion:cli.direccion, ciudad:cli.ciudad, estado:cli.estado, zip:cli.zip, pais:cli.pais||"" } : null;  // snapshot for the invoice + country slicer
    doc.envio = { tipo:draft.envio.tipo, monto:envioMonto };
    cobroAplicarDoc(doc, draft);            // v78 · medio de cobro, referencia y cuenta
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
  const refTxt = (isC?t("cl.ref.purchase"):t("cl.ref.sale")) + (doc.numero?(" "+doc.numero):"") + (doc.contraparte?(" · "+doc.contraparte):"");

  // v103 (igual que Prince v117): al editar una compra ya recibida, la capa nueva entra con
  // la fecha de la capa original (antes pasaba al final de la cola FIFO).
  const fechaCapa = {};
  if(isC && oldDoc && oldDoc.status===INVOICE_STATUS.RECEIVED){
    const sOld = oldDoc.store || STORE_IDS[0];
    (oldDoc.lineas||[]).forEach(l=>{
      const p = prodById(l.productoId); if(!p) return;
      fifoLayers(p, sOld).forEach(L=>{ if(L.refId===oldDoc.id && L.fecha && (!fechaCapa[p.id] || L.fecha<fechaCapa[p.id])) fechaCapa[p.id] = L.fecha; });
    });
  }
  // Recién ahora mutamos: primero revertimos el documento original (si estábamos editando)
  if(oldDoc) revertDoc(oldDoc);

  resolved.forEach((r, idx)=>{
    if(isC){
      // La compra sólo impacta stock/FIFO si queda RECEIVED. Si nace/queda
      // "in transit", el documento se guarda pero el inventario no se mueve:
      // la mercadería recién entra cuando se marca recibida.
      if(doc.status===INVOICE_STATUS.RECEIVED){
        const landed = round2(r.precio + handPU + fletePU);
        fifoEntrada(r.prod, store, r.cantidad, landed, refTxt, doc.id, null, fechaCapa[r.prod.id]);  // FIFO purchase layer (v103: misma fecha si se editó)
        moverStock(r.prod, +r.cantidad, landed, "compra", doc.id, refTxt, { store });
        r.prod.costoNeto = r.precio; r.prod.costoHandling = round2(handPU); r.prod.costoFlete = round2(fletePU);
        r.prod.ultimoCosto = landed;        // last landed cost (reference only; COGS is FIFO)
      }
    } else {
      // Venta desde el DEPÓSITO elegido: consumo FIFO por fecha dentro de ESE depósito.
      const res = fifoConsumir(r.prod, storeVenta, r.cantidad);
      doc.lineas[idx].costo = res.unit;                              // costo FIFO unitario (mezcla real del depósito)
      doc.lineas[idx].cogs = res.cogs;                               // COGS total
      doc.lineas[idx].consumed = res.consumed.map(c=>({ ...c, sociedad:storeVenta }));   // capas consumidas (+ depósito de origen) -> revert exacto y margen por depósito
      moverStock(r.prod, -r.cantidad, res.unit, "venta", doc.id, refTxt, { store:storeVenta });
      r.prod.precioVenta = r.precio;                                 // último precio de venta (mirror)
      if(r.prod.precioVentaPorTienda) r.prod.precioVentaPorTienda[storeVenta] = r.precio;   // precio de lista del depósito
    }
  });

  // nov 2026 · quién lo cargó: se conserva al editar; uno nuevo queda a nombre de quien lo carga (el servidor lo confirma)
  if(editing && oldDoc){ if(oldDoc.cargadoPor) doc.cargadoPor = oldDoc.cargadoPor; }
  else if(session && session.user) doc.cargadoPor = session.user;
  (isC?db.compras:db.ventas).push(doc);
  if(!isC) rememberVenta(storeVenta, doc.vendedorId||"");   // pre-cargar contexto en la próxima venta
  draft.editingId=null;
  save(); closeModal();
  const uds=qty(doc.lineas.reduce((a,l)=>a+l.cantidad,0));
  const compraMsg = doc.status===INVOICE_STATUS.IN_TRANSIT ? t("cl.purchase.transit",{u:uds}) : t("cl.purchase.saved",{u:uds});
  toast(editing ? t("cl.doc.updated")
       : (isC?compraMsg : t("cl.sale.recorded",{u:uds})), isC?"up":"down");
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
  if(!puedeComprar()){ toast(t("md.err.admincompra"),"warn"); return; }
  // ---- Task 3: EDICIÓN. Revertimos la compra previa y sus consignaciones en
  // tránsito, y recreamos todo abajo como si fuera nueva. Si alguna consignación
  // ya avanzó (hecho físico), no se toca. ----
  // Fecha del REMITO = día en que se emite (no la de la factura de compra, que es anterior).
  // Si se está editando una compra que ya tenía remito, se conserva la fecha de ese remito.
  let fechaRemito = hoyISO();
  if(draft.editingId){
    const prev = db.compras.find(x=>x.id===draft.editingId);
    if(prev){
      const remPrev = prev.remitoId ? (db.remitos||[]).find(r=> r.id===prev.remitoId) : null;
      if(remPrev && remPrev.fecha) fechaRemito = remPrev.fecha;
      if(trabaCompraUsada(prev)) return;   // v103: la parte nuestra ya se usó (vendida/ajustada/despachada)
      const cons = (db.consignaciones||[]).filter(cs=> cs.conjuntaId===prev.id);
      if(cons.some(cs=> cs.estado!==CONSIGN_ESTADOS.TRANSITO)){
        toast(t("cl.err.editmoved"),"warn"); return;
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
        if(!(l.nombre||"").trim()){ toast(t("cl.err.newprodname"),"warn"); return; }
        p = nuevoProductoBase(l.sku, l.nombre, l.precioVentaSugerido||0);
        if(typeof l.idioma==="string") p.idioma = l.idioma;   // nov 2026: idioma elegido al importar
        db.productos.push(p);
      }
    } else {
      p = prodById(l.productoId);
      if(!p){ toast(t("cl.err.noprod"),"warn"); return; }
    }
    if(aTerc>0) hayTercero = true;
    resolved.push({ prod:p, qtot, ours, aTerc, precio:Math.max(0, parseNum(l.precio)||0) });
  }
  if(!resolved.length){ toast(t("cl.err.noline"),"warn"); return; }
  if(hayTercero && !clienteById(draft.terceroId)){ toast(t("cl.err.pickowner"),"warn"); return; }

  const ownerId   = draft.terceroId || null;
  const ownerName = ownerId ? (nombreVis((clienteById(ownerId)||{}).nombre) || "") : "";
  const numero    = (draft.numero||"").trim();
  const fechaISO  = normISO(draft.fecha) || hoyISO();

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
    if(session && session.user) compraDoc.cargadoPor = session.user;   // nov 2026 · quién la cargó
    db.compras.push(compraDoc);
  }

  // --- Remito U: documento interno del envío US → AR (numeración automática) ---
  // SÓLO viaja con remito lo de TERCEROS: son unidades del dueño que siguen a AR
  // para entregárselas. Lo NUESTRO (ours) ya entró como mercadería propia con la
  // compra de arriba (nace en tránsito, es nuestro stock) — no necesita remito.
  const remitoLineas = [];
  resolved.forEach(r=>{
    if(r.aTerc>0) remitoLineas.push({ productoId:r.prod.id, sku:r.prod.sku, nombre:r.prod.nombre, cantidad:r.aTerc, rol:"third", owner:ownerName });
  });
  let uRemito = null;
  if(remitoLineas.length){
    uRemito = crearRemito({ letra:"U", tipo:"salida-us",
      fecha:fechaRemito, fuente:{ tipo:"compra", id: compraDoc?compraDoc.id:null },
      lineas:remitoLineas, obs:(numero?t("cl.obs.invoice",{n:numero}):"")+(ownerName?(" · "+ownerName):"") });
    if(compraDoc){ compraDoc.remitoId = uRemito.id; compraDoc.remitoCodigo = uRemito.codigo; }
  }

  // --- Unidades de TERCEROS -> consignaciones (tracked, nacen en tránsito) ---
  let udsTerc = 0;
  resolved.forEach(r=>{
    if(r.aTerc>0 && ownerId){
      udsTerc += r.aTerc;
      crearConsignacion({
        conjuntaId: compraDoc ? compraDoc.id : null,
        envioRef: numero, fecha: fechaRemito, terceroId: ownerId,
        remitoId: uRemito ? uRemito.id : null,
        remitoCodigo: uRemito ? uRemito.codigo : "",
        productoId:r.prod.id, sku:r.prod.sku, nombre:r.prod.nombre,
        cantidad:r.aTerc, costoUnit:r.precio,
        obs: t("cl.obs.terc") + (numero?(" "+numero):"")
      });
    }
  });

  draft.editingId=null;
  save(); closeModal();
  const udsOurs = oursLines.reduce((a,r)=>a+r.ours,0);
  const parts = [];
  if(udsOurs>0) parts.push(t("cl.part.stock",{u:qty(udsOurs)}));
  if(udsTerc>0) parts.push(t("cl.part.tracked",{u:qty(udsTerc),owner:ownerName||t("cl.owner.fallback")}));
  if(uRemito) parts.push(t("cl.part.remito",{code:uRemito.codigo}));
  toast(t("cl.tercsaved",{parts:parts.join(" · ")||t("cl.nothingload")}), "up");
  render();
  // El remito U queda GUARDADO y se descarga cuando quieras desde la sección Remitos.
  // Sin pop-up bloqueante (antes preguntaba "¿generar PDF ahora?" en cada carga).
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
  const refTxt = t("cl.ref.purchase") + (doc.numero?(" "+doc.numero):"") + (doc.contraparte?(" · "+doc.contraparte):"");
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
/* ---- v103 · Traba de integridad de compras (igual que Prince) ----
   Unidades de una compra RECIBIDA que ya salieron de su capa FIFO (vendidas,
   ajustadas, despachadas a tránsito, enviadas a bóveda). Si hay alguna, la compra no
   se puede borrar, editar ni volver a "en tránsito": revertirla dejaba stock NEGATIVO y
   capas FIFO descuadradas. Al deshacer lo que las consumió (p. ej. borrar la venta) las
   unidades vuelven con el refId de la compra y la traba se libera sola.
   Devuelve [{nombre, compradas, usadas}]. */
function compraUsada(doc){
  if(!doc || doc.status===INVOICE_STATUS.IN_TRANSIT) return [];
  const store = doc.store || STORE_IDS[0];
  const porProd = {};
  (doc.lineas||[]).forEach(l=>{ (porProd[l.productoId] = porProd[l.productoId] || { nombre:l.nombre, cant:0 }).cant += (l.cantidad||0); });
  const out = [];
  Object.keys(porProd).forEach(id=>{
    const p = prodById(id); if(!p) return;
    const quedan = fifoLayers(p, store).filter(L=> L.refId===doc.id).reduce((a,L)=>a+(L.cantidad||0),0);
    const libres = Math.min(quedan, stockDe(p, store));
    const usadas = round4(porProd[id].cant - libres);
    if(usadas > 0.0001) out.push({ nombre:porProd[id].nombre, compradas:porProd[id].cant, usadas });
  });
  return out;
}
/* true = bloqueado (y ya avisó al usuario). */
function trabaCompraUsada(doc){
  const u = compraUsada(doc); if(!u.length) return false;
  toast(t("doc.lock.tt"),"warn");
  alert(t("doc.lock.used",{list:u.map(x=>t("doc.lock.line",{name:x.nombre, used:qty(x.usadas), total:qty(x.compradas)})).join("\n")}));
  return true;
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
  if(isEditor()){ toast(t("ed.err.nodelete"),"warn"); return; }   // v79: el editor no borra
  const list = tipo==="compra"?db.compras:db.ventas;
  const d=list.find(x=>x.id===id); if(!d) return;
  if(tipo==="compra" && trabaCompraUsada(d)) return;   // v103
  const items=d.lineas.reduce((a,l)=>a+l.cantidad,0);
  const msg = tipo==="compra"
    ? t("cl.del.purchase",{u:qty(items),store:storeName(d.store)})
    : t("cl.del.sale",{u:qty(items)});
  if(!confirm(msg)) return;
  withUndo(t("cl.doc.deleted"), ()=>{ revertDoc(d); save(); });
  if(document.getElementById("scrim")) closeModal();
  render();
}
function editDoc(tipo,id){
  const list = tipo==="compra"?db.compras:db.ventas;
  const d=list.find(x=>x.id===id); if(!d) return;
  if(typeof puedeEditarDocDe==="function" && !puedeEditarDocDe(d)){ avisoDocAjeno(d); return; }   // nov 2026: el editor sólo edita lo suyo
  if(tipo==="compra" && trabaCompraUsada(d)) return;   // v103
  // ---- Task 3: edición de COMPRA DE TERCEROS ----
  // La compra sólo guarda lo NUESTRO; lo de terceros vive como consignaciones
  // (conjuntaId = id de la compra). Reconstruimos el draft juntando ambas por
  // producto+precio. Si alguna consignación ya avanzó (llegó a AR / se entregó),
  // no se puede editar: es un hecho físico. Se avisa y se corta.
  if(tipo==="compra" && d.origen==="terceros"){
    const cons = (db.consignaciones||[]).filter(cs=> cs.conjuntaId===d.id);
    if(cons.some(cs=> cs.estado!==CONSIGN_ESTADOS.TRANSITO)){
      toast(t("cl.err.editmoved2"),"warn");
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
    costosExtra: (tipo==="venta") ? (d.costosExtra||[]).map(c=>({ key:uid(), tipo:c.tipo||"otro", nota:c.nota||"", monto:c.monto||0, horas:c.horas||0, valorHora:c.valorHora||0 })) : undefined,
    cargosCliente: (tipo==="venta") ? (d.cargosCliente||[]).map(c=>({ key:uid(), nota:c.nota||"", monto:c.monto||0 })) : undefined,
    vendedorId: (tipo==="venta") ? (d.vendedorId||"") : "",
    contraparte:d.contraparte||"", fecha:normISO(d.fecha), numero:d.numero||"",
    clienteId:d.clienteId||"", envio: d.envio ? {tipo:d.envio.tipo, monto:d.envio.monto||0} : {tipo:"free",monto:0},
    handling:d.handling||0, flete:d.flete||0,
    ...(tipo==="venta" ? cobroDraftDesde(d) : {}),
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
    costosExtra: (tipo==="venta") ? (d.costosExtra||[]).map(c=>({ key:uid(), tipo:c.tipo||"otro", nota:c.nota||"", monto:c.monto||0, horas:c.horas||0, valorHora:c.valorHora||0 })) : undefined,
    cargosCliente: (tipo==="venta") ? (d.cargosCliente||[]).map(c=>({ key:uid(), nota:c.nota||"", monto:c.monto||0 })) : undefined,
    vendedorId: (tipo==="venta") ? (isSeller() ? (currentVendedorId()||"") : (d.vendedorId||"")) : "",
    contraparte: tipo==="compra"?(d.contraparte||""):"",
    fecha:hoyISO(),
    numero: tipo==="venta" ? nextFacturaVenta() : "",
    clienteId: tipo==="venta"?(d.clienteId||""):"",
    envio: (tipo==="venta" && d.envio) ? {tipo:d.envio.tipo, monto:d.envio.monto||0} : {tipo:"free",monto:0},
    handling:0, flete:0,
    ...(tipo==="venta" ? { medioPago:d.medioPago||"", refPago:"", cuentaCobro:d.cuentaCobro||"" } : {}),
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
      if(l.cantidad>disp){ recortes.push(t("cl.copytrim.line",{name:p.nombre,asked:qty(l.cantidad),avail:qty(disp),store:storeName(storeV)})); l.cantidad=disp; }
      usado[l.productoId]=(usado[l.productoId]||0)+l.cantidad;
    });
  }
  renderDocModal();
  if(recortes.length) alert(t("cl.alert.copytrim",{list:recortes.join("\n")}));
}

/* Ver documento existente (solo lectura) */
/* v87 · Detalle de venta / compra reordenado (como la otra app del grupo):
   ficha de datos arriba, líneas en el medio y dos cajas abajo: Totales y
   Rentabilidad (sólo admin). Ningún botón queda seleccionado al abrir
   (antes quedaba "Eliminar" y un Enter de más borraba la venta). */
function verDoc(tipo,id){
  const list = tipo==="compra"?db.compras:db.ventas;
  const d=list.find(x=>x.id===id); if(!d) return;
  const isC=tipo==="compra";
  const fila = (lbl, val, cls="") => `<div class="vd-row ${cls}"><span>${lbl}</span><span class="num">${val}</span></div>`;
  // ---- Ficha de datos ----
  const cli = d.cliente || (d.clienteId?clienteById(d.clienteId):null);
  let quien;
  if(!isC && cli){
    quien = `<b>${esc(nombreVis(cli.nombre)||cli.nombre||"—")}</b>${clienteEmpresaExtra(cli)?` · ${esc(nombreVis(clienteEmpresaExtra(cli)))}`:""}
      ${clienteDireccion(cli)?`<br>${esc(clienteDireccion(cli))}`:""}
      ${(cli.email||cli.telefono)?`<br>${esc(cli.email||"")}${cli.email&&cli.telefono?" · ":""}${esc(cli.telefono||"")}`:""}`;
  } else quien = `<b>${esc(nombreVis(d.contraparte)||"—")}</b>`;
  const datos = [
    `<div class="vd-f vd-f-wide"><span class="vd-lbl">${isC?t("vd.supplier"):t("vd.customer")}</span><div>${quien}</div></div>`,
    `<div class="vd-f"><span class="vd-lbl">${t("common.date")}</span><div>${esc(fmtDate(d.fecha))}</div></div>`,
    (()=>{ const st = isC ? (d.store||STORE_IDS[0]) : storeDeVenta(d);   // v93: texto con punto de color (antes, pastilla suelta)
      return `<div class="vd-f"><span class="vd-lbl">${t("vd.dep")}</span><div class="vd-dep st-${esc(st)}"><i aria-hidden="true"></i>${esc(storeName(st))}</div></div>`; })()
  ];
  if(!isC && d.medioPago) datos.push(`<div class="vd-f"><span class="vd-lbl">${t("cob.l.method")}</span><div>${esc(cobroLabel(d.medioPago))}${d.refPago?` · ${esc(d.refPago)}`:""}</div></div>`);
  // v94 · cobro pendiente (consignación): se completa desde acá
  if(!isC && !d.medioPago) datos.push(`<div class="vd-f"><span class="vd-lbl">${t("cob.l.method")}</span><div><span class="pill cob-pend">${t("cob.pend")}</span>${cobroPuedeRegistrar(d)?` <button type="button" class="btn sm" data-cob-reg="${esc(d.id)}" style="margin-left:6px">${t("cob.reg")}</button>`:""}</div></div>`);
  if(!isC && cuentaCobroNombre(d)) datos.push(cobroVerHTML(d,false));
  if(!isC && isAdmin()) datos.push(`<div class="vd-f"><span class="vd-lbl">${t("cl.v.soldby")}</span><div>${esc(saleVendedorNombre(d))}</div></div>`);
  // nov 2026 · quién lo cargó (los documentos anteriores a este registro no lo tienen)
  if(d.cargadoPor && (isAdmin()||isEditor())) datos.push(`<div class="vd-f"><span class="vd-lbl">${t("doc.by",{u:""}).replace(/[:\s]+$/,"")}</span><div>${esc(d.cargadoPor)}</div></div>`);
  const received = d.status===INVOICE_STATUS.RECEIVED;
  if(isC) datos.push(`<div class="vd-f vd-f-wide"><span class="vd-lbl">${t("cl.v.shipstatus")}</span>
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        <span class="inv-badge ${received?'received':'transit'}">${received?t('cl.v.received'):t('cl.v.intransit')}</span>
        ${puedeComprar()?`<button class="btn ghost sm" data-invstatus-modal="${d.id}">${received?ICO.plane+t('cl.v.markintransit'):ICO.receive+t('cl.v.markreceived')}</button>`:""}
      </div></div>`);
  // ---- Líneas ----
  const rows=d.lineas.map(l=>`<tr>
    <td>${(l.sku&&verSku())?`<span class="sku">${esc(l.sku)}</span> `:""}${esc(l.nombre)}</td>
    <td class="r num">${qty(l.cantidad)}</td>
    <td class="r num">${money(l.precio)}</td>
    <td class="r num">${money(l.cantidad*l.precio)}</td></tr>`).join("");
  // ---- Totales ----
  const sub = (d.subtotal!=null) ? d.subtotal : totalLineas(d.lineas);
  let tot = fila(t("pdf.subtotal"), money(sub));
  if(isC){ if(d.handling||d.flete) tot += fila(t("cl.v.handfreight"), money((d.handling||0)+(d.flete||0))); }
  else tot += fila(t("cl.v.shipping"), d.envio&&d.envio.tipo==="monto"?money(d.envio.monto):`<span class="vd-free">${t("md.ship.free")}</span>`);
  if(!isC) (d.cargosCliente||[]).forEach(c=>{ tot += fila("+ "+esc(capFirst(c.nota)||t("pdf.charge")), money(c.monto)); });
  tot += fila(t("common.total"), money(d.total), "vd-total");
  // ---- Rentabilidad (sólo admin, sólo ventas) ----
  let rent = "";
  if(!isC && isAdmin()){
    rent += fila(t("cl.v.marginfifo"), money(saleMargin(d)));
    if(saleEnvioCobrado(d)>0) rent += fila(t("md.net.ship"), money(saleEnvioCobrado(d)));
    if(saleCargosCliente(d)>0) rent += fila(t("cl.v.chargesbilled"), money(saleCargosCliente(d)));
    rent += fila(t("cl.v.commission",{p:nf0.format(saleCommissionRate(d)*100)}), money(saleCommission(d)));
    (d.costosExtra||[]).forEach(c=>{
      const detalle = c.tipo==="labor" && c.horas ? ` (${nf0.format(c.horas)}h × ${money(c.valorHora||0)})` : (c.nota?` · ${c.nota}`:"");
      rent += fila("− "+esc(costoTipoLabel(c.tipo)+detalle), money(c.monto));
    });
    const nm = saleNetMargin(d) + saleEnvioCobrado(d);   // mismo criterio que el P&L: el envío cobrado suma
    rent += fila(t("cl.v.netmargin"), `<span style="color:${nm<0?'var(--alert)':'var(--up-ink)'}">${money(nm)}</span>`, "vd-total");
  }
  buildModal(`${isC?t("cl.v.purchase"):t("cl.v.invoice")} ${d.numero||""}`.trim(), `
    <div class="vd-datos">${datos[0]}<div class="vd-meta">${datos.slice(1).join("")}</div></div>
    <div class="vd-lineas table-scroll"><table>
      <thead><tr><th>${t("common.product")}</th><th class="r">${t("cl.th.qty")}</th><th class="r">${isC?t("cl.th.cost"):t("cl.th.price")}</th><th class="r">${t("pdf.subtotal")}</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <div class="vd-cajas">
      <div class="vd-caja"><h4>${t("vd.totals")}</h4>${tot}</div>
      ${rent ? `<div class="vd-caja"><h4>${t("vd.profit")} <span class="hint">· ${t("vd.adminonly")}</span></h4>${rent}</div>` : ""}
    </div>
  `,[
    ...(isEditor()?[]:[{label:t("common.delete"),icon:ICO.trash,cls:"btn danger",act:()=>deleteDoc(tipo,id)}]),   // v94: el editor no borra
    ...(isC?[]:[{label:t("cl.btn.downloadpdf"),icon:ICO.pdf,cls:"btn",act:()=>generarInvoicePDF(id)},
              {label:t("cl.btn.copy"),icon:ICO.copy,cls:"btn",act:()=>copyDoc(tipo,id)}]),
    {label:t("common.edit"),icon:ICO.edit,cls:"btn",act:()=>{ closeModal(); editDoc(tipo,id); }},
    {label:t("common.close"),cls:"btn",act:closeModal}
  ]);
  // Que ningún botón quede seleccionado (sobre todo "Eliminar"): el foco va al modal.
  setTimeout(()=>{ const md=document.querySelector("#modalRoot .modal"); if(md){ try{ md.focus({preventScroll:true}); }catch(_){ md.focus(); } } }, 0);
  const sb=document.querySelector("[data-invstatus-modal]");
  if(sb) sb.onclick=()=>{ toggleInvoiceStatus(sb.dataset.invstatusModal); closeModal(); verDoc(tipo,id); };
}

