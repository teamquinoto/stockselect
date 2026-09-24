/* ============================================================
   gestordestock — 21-modal-documento.js
   Parte de la app. Se carga como etiqueta script en el ORDEN del index.html.
   Todo vive en scope global (sin módulos), igual que antes.
   ============================================================ */
/* ============================================================
   MODAL: Documento (compra / venta) con editor de líneas
   ============================================================ */
let draft = null;  // { tipo, contraparte, fecha, numero, lineas:[{key,productoId,sku,nombre,cantidad,precio}] }

function openDoc(tipo, pre){
  // Punto 3: un vendedor no puede cargar compras.
  if(tipo==="compra" && !puedeComprar()){ toast(t("md.err.admincompra"),"warn"); return; }
  draft = pre || {
    tipo, contraparte:"", fecha:new Date().toISOString().slice(0,10),
    numero: tipo==="venta" ? nextFacturaVenta() : "",
    clienteId:"", envio:{ tipo:"free", monto:0 },
    handling:0, flete:0,
    lineas:[ blankLine() ]
  };
  draft.tipo = tipo;
  if(!draft.envio) draft.envio = { tipo:"free", monto:0 };
  if(draft.handling==null) draft.handling = 0;
  if(draft.flete==null) draft.flete = 0;
  if(tipo==="compra"){
    // La compra elige SOCIEDAD (quién compra). Default: la sociedad en foco, o la primera.
    if(!draft.store || !STORE_IDS.includes(draft.store)){
      draft.store = (activeStore!=="all" && STORE_IDS.includes(activeStore)) ? activeStore : STORE_IDS[0];
    }
    // Origen de la factura: "propia" (todo entra a stock) o "terceros" (parte nuestra + parte
    // que sigue viaje al dueño). Viene pre-cargado desde el import; si no, default propia.
    if(draft.origen!=="terceros" && draft.origen!=="propia") draft.origen = "propia";
    if(draft.terceroId===undefined) draft.terceroId = "";
    draft.lineas.forEach(l=>{ if(l.aNuestro==null) l.aNuestro = 0; });
  } else {
    // La venta ELIGE DEPÓSITO (Select/Swan): el stock de AR no se vende desde USA.
    // Default: el último depósito usado (si aún es válido), o el primero con stock.
    if(!draft.storeVenta || !STORE_IDS.includes(draft.storeVenta)){
      const last = lastVentaStore();
      draft.storeVenta = STORE_IDS.includes(last) ? last : (STORE_IDS.find(s=> db.productos.some(p=> stockDe(p,s)>0)) || STORE_IDS[0]);
    }
    // Y elige VENDEDOR (para la comisión). Vendedor logueado => fijado a sí mismo;
    // admin => arranca SIEMPRE en "Casa" (0%); elige el vendedor manualmente si corresponde.
    if(isSeller()){
      draft.vendedorId = currentVendedorId() || "";
    } else if(draft.vendedorId===undefined){
      draft.vendedorId = "";   // Casa por defecto
    }
    if(!Array.isArray(draft.costosExtra)) draft.costosExtra = [];   // costos de venta (shipping/labor/etc.)
    if(!Array.isArray(draft.cargosCliente)) draft.cargosCliente = [];   // Task 5: cargos on-top que paga el cliente
  }
  renderDocModal();
}
function blankLine(){ return { key:uid(), productoId:"", sku:"", nombre:"", cantidad:1, precio:0, precioVentaSugerido:0, crear:false, margen:0, costoRef:0, aNuestro:0 }; }

function renderDocModal(){
  const isC = draft.tipo==="compra";
  const cli = clienteById(draft.clienteId);
  const clienteRow = isC ? "" : `
    <div class="field" style="grid-column:1/3">
      <label>${t("md.lbl.customer")} <span class="hint" style="font-weight:400">${t("md.req")}</span></label>
      <button type="button" class="ppick-btn${cli?"":" placeholder"}" id="d_cli">
        <span class="ppick-label">${cli?esc(clienteLinea(cli)):t("md.pick.customer")}</span><span class="ppick-caret">▾</span>
      </button>
      ${cli?`<div class="hint" style="font-size:11px;margin-top:4px">${esc(clienteDireccion(cli)||cli.email||"")}</div>`:""}
    </div>`;
  const allowSt = allowedStores();
  // PUNTO 1 — barra "Invoice type" (propia / terceros). En terceros aparece el dueño.
  let origenBar = "";
  if(isC){
    const terc = draft.origen==="terceros";
    const owner = draft.terceroId ? clienteById(draft.terceroId) : null;
    // Punto 1: si el tipo (propia/terceros) y el dueño ya se eligieron en el paso de
    // import, NO se vuelve a preguntar. Se muestra un resumen compacto con un botón
    // "Change" que despliega la barra completa por si hay que corregir algo.
    const locked = draft.origenLocked && !draft._origenEdit;
    const ownerHint = `${terc?`<p class="hint" style="margin:-4px 0 12px;font-size:12px">${t("md.tp.hint")}</p>`:""}`;
    if(locked){
      origenBar = `
      <div class="origen-bar locked">
        <div class="origen-sum">
          <span class="origen-chip ${terc?"is-third":"is-own"}">${terc?t("md.third"):t("md.chip.own")}</span>
          ${terc?`<span class="origen-owner">${t("md.lbl.ownercolon")} <b>${owner?esc(clienteLinea(owner)):t("md.none2")}</b></span>`:""}
          <span class="hint" style="font-size:12px">${t("md.setinimport")}</span>
        </div>
        <button type="button" class="btn ghost xs" id="d_origen_edit">${t("md.btn.change")}</button>
      </div>
      ${ownerHint}`;
    } else {
      origenBar = `
      <div class="origen-bar">
        <div class="field">
          <label>${t("md.lbl.invoicetype")}</label>
          <div class="seg" id="d_origen">
            <button type="button" data-origen="propia" class="${!terc?"on":""}">${t("md.seg.own")}</button>
            <button type="button" data-origen="terceros" class="${terc?"on":""}">${t("md.third")}</button>
          </div>
        </div>
        ${terc?`<div class="field" style="min-width:240px;flex:1">
          <label>${t("common.owner")} <span class="hint" style="font-weight:400">${t("md.owner.hint")}</span></label>
          <button type="button" class="ppick-btn${owner?"":" placeholder"}" id="d_owner" style="width:100%">
            <span class="ppick-label">${owner?esc(clienteLinea(owner)):t("md.pick.owner")}</span><span class="ppick-caret">▾</span>
          </button></div>`:""}
      </div>
      ${ownerHint}`;
    }
  }
  let topSel;
  if(isC){
    // COMPRA: elegir la sociedad que compra (procedencia del lote).
    topSel = (allowSt.length>1)
      ? `<div class="field" style="grid-column:1/3"><label>${t("md.lbl.society")} <span class="hint" style="font-weight:400">${t("md.society.hint")}</span></label>
           <select class="inp" id="d_store">${allowSt.map(s=>`<option value="${s}" ${s===draft.store?"selected":""}>${esc(storeName(s))}</option>`).join("")}</select></div>`
      : `<div class="field" style="grid-column:1/3"><label>${t("md.lbl.society")}</label>
           <input class="inp" value="${esc(storeName(draft.store))}" disabled></div>`;
  } else {
    // VENTA: elige DEPÓSITO (de dónde despacha; define el costo FIFO) + VENDEDOR (comisión).
    const depSel = `<div class="field"><label>${t("md.lbl.deposit")} <span class="hint" style="font-weight:400">${t("md.deposit.hint")}</span></label>
        <select class="inp" id="d_storeventa">${allowSt.map(s=>`<option value="${s}" ${s===draft.storeVenta?"selected":""}>${esc(storeName(s))}</option>`).join("")}</select></div>`;
    let vendSel;
    if(isSeller()){
      vendSel = `<div class="field"><label>${t("md.lbl.seller")}</label>
           <input class="inp" value="${esc((session&&session.name)||vendedorNombre(draft.vendedorId))}" disabled></div>`;
    } else {
      const vends = vendedores();
      vendSel = `<div class="field"><label>${t("md.lbl.seller")} <span class="hint" style="font-weight:400">${t("md.seller.hint")}</span></label>
           <select class="inp" id="d_vend">
             <option value="" ${!draft.vendedorId?"selected":""}>${t("md.none.house")}</option>
             ${vends.map(v=>`<option value="${esc(v.id)}" ${v.id===draft.vendedorId?"selected":""}>${esc(v.nombre)}</option>`).join("")}
           </select></div>`;
    }
    topSel = depSel + vendSel;
  }
  const body = `
    ${isC?origenBar:""}
    <div class="grid-form" style="grid-template-columns:1fr 1fr;padding:0;margin-bottom:10px">${topSel}</div>
    ${isC?`<div class="banner ok" style="justify-content:space-between;align-items:center">
      <span>${t("md.import.banner")}</span>
      <button class="btn sm" id="d_import" style="white-space:nowrap">${t("md.import.btn")}</button>
    </div>`:""}
    <div class="grid-form" style="grid-template-columns:1fr 1fr;padding:0;margin-bottom:12px">
      ${isC?`<div class="field" style="grid-column:1/3"><label>${t("md.lbl.supplier")}</label><input class="inp" id="d_cp" value="${esc(draft.contraparte)}"></div>`:clienteRow}
      <div class="field"><label>${t("common.date")}</label><input class="inp" type="date" id="d_fe" value="${esc(draft.fecha)}"></div>
      <div class="field"><label>${isC?t("md.lbl.docno"):t("md.lbl.invno")+' <span class="hint" style="font-weight:400">'+t("md.invno.hint")+'</span>'}</label><input class="inp" id="d_nu" value="${esc(draft.numero)}"></div>
    </div>
    <div id="lineHost"></div>
    <button class="btn sm" id="addLine" style="margin-top:10px">${t("md.btn.addline")}</button>
    ${isC?`
    <div class="phead" style="margin:16px 0 6px;padding:0"><h3 style="font-size:13px">${t("md.h.addcosts")}</h3></div>
    <div class="grid-form" style="grid-template-columns:1fr 1fr;padding:0">
      <div class="field"><label>${t("md.lbl.handling")}</label><input class="inp num" id="d_hand" value="${draft.handling||0}"></div>
      <div class="field"><label>${t("md.lbl.flete")}</label><input class="inp num" id="d_flete" value="${draft.flete||0}"></div>
    </div>
    <p class="hint" id="d_proHint" style="font-size:12px;margin:6px 0 0"></p>
    `:`
    <div class="phead" style="margin:16px 0 6px;padding:0"><h3 style="font-size:13px">${t("md.h.custship")}</h3></div>
    <div class="grid-form" style="grid-template-columns:auto 1fr;padding:0;align-items:end">
      <div class="field"><label>${t("md.lbl.type")}</label>
        <select class="inp" id="d_envtipo">
          <option value="free" ${draft.envio.tipo==="free"?"selected":""}>${t("md.ship.free")}</option>
          <option value="monto" ${draft.envio.tipo==="monto"?"selected":""}>${t("md.ship.flat")}</option>
        </select>
      </div>
      <div class="field"><label>${t("md.lbl.shipcost")}</label><input class="inp num" id="d_envmonto" value="${draft.envio.monto||0}" ${draft.envio.tipo==="free"?"disabled":""}></div>
    </div>
    <div class="phead" style="margin:16px 0 6px;padding:0"><h3 style="font-size:13px">${t("md.h.extra")} <span class="hint" style="font-weight:400">${t("md.extra.hint")}</span></h3></div>
    <div id="cargoHost"></div>
    <button class="btn sm" id="addCargo" style="margin-top:8px">${t("md.btn.addcharge")}</button>
    ${isAdmin()?`
    <div class="phead" style="margin:16px 0 6px;padding:0"><h3 style="font-size:13px">${t("md.h.selling")} <span class="hint" style="font-weight:400">${t("md.selling.hint")}</span></h3></div>
    <div id="costHost"></div>
    <button class="btn sm" id="addCost" style="margin-top:8px">${t("md.btn.addcost")}</button>
    <div id="netBox" style="margin-top:12px"></div>`:""}`}
    <div id="docWarn"></div>
  `;
  const editing = !!draft.editingId;
  buildModal(
    isC?(editing?t("md.title.editpurchase"):t("md.title.newpurchase")):(editing?t("md.title.editsale"):t("md.title.newsale")), body,
    [
      {label:t("common.cancel"),cls:"btn",act:()=>{ draft.editingId=null; closeModal(); }},
      {label: editing?t("md.btn.savechanges") : (isC?t("md.btn.confirmpurchase"):t("md.btn.confirmsale")),cls:isC?"btn up":"btn down",act:confirmDoc}
    ],
    "wide doc",
    `<div class="totrow"><span style="color:var(--muted)">${t("md.doctotal")}</span><span class="num" id="docTotal">${money(docTotal())}</span></div>`
  );
  renderLines();
  const dOr=document.getElementById("d_origen");
  if(dOr) dOr.querySelectorAll("[data-origen]").forEach(b=> b.onclick=()=>{
    if(draft.origen===b.dataset.origen) return;
    draft.origen=b.dataset.origen;
    if(draft.origen==="propia") draft.terceroId="";                 // al volver a propia, se olvida el dueño
    if(draft.origen==="terceros") draft.lineas.forEach(l=>{ if(l.aNuestro==null) l.aNuestro=0; });
    renderDocModal();
  });
  const dOw=document.getElementById("d_owner"); if(dOw) dOw.onclick=(e)=> openDocOwnerPicker(e.currentTarget);
  const dOe=document.getElementById("d_origen_edit"); if(dOe) dOe.onclick=()=>{ draft._origenEdit=true; renderDocModal(); };
  const dst=document.getElementById("d_store"); if(dst) dst.onchange=e=>{ draft.store=e.target.value; };
  const dvend=document.getElementById("d_vend"); if(dvend) dvend.onchange=e=>{ draft.vendedorId=e.target.value; };
  const dsv=document.getElementById("d_storeventa"); if(dsv) dsv.onchange=e=>{ draft.storeVenta=e.target.value; renderDocModal(); };   // re-render: refresca disponibilidad y costos del depósito
  const cp=document.getElementById("d_cp"); if(cp) cp.oninput=e=>draft.contraparte=e.target.value;
  document.getElementById("d_fe").oninput=e=>draft.fecha=e.target.value;
  document.getElementById("d_nu").oninput=e=>draft.numero=e.target.value;
  document.getElementById("addLine").onclick=()=>{ draft.lineas.push(blankLine()); renderLines(); refreshTotal(); };
  const imp=document.getElementById("d_import"); if(imp) imp.onclick=()=> openImport();
  if(isC){
    document.getElementById("d_hand").oninput=e=>{ draft.handling=parseNum(e.target.value); pintarProrateo(); };
    document.getElementById("d_flete").oninput=e=>{ draft.flete=parseNum(e.target.value); pintarProrateo(); };
    pintarProrateo();
  } else {
    document.getElementById("d_cli").onclick=(e)=> openClientePicker(e.currentTarget);
    const et=document.getElementById("d_envtipo"), em=document.getElementById("d_envmonto");
    et.onchange=()=>{ draft.envio.tipo=et.value; em.disabled=(et.value==="free"); if(et.value==="free"){ draft.envio.monto=0; em.value=0; } refreshTotal(); };
    em.oninput=()=>{ draft.envio.monto=parseNum(em.value); refreshTotal(); };
    renderCargos();
    const acg=document.getElementById("addCargo"); if(acg) acg.onclick=()=>{ (draft.cargosCliente=draft.cargosCliente||[]).push(nuevaLineaCargo()); renderCargos(); refreshTotal(); };
    if(isAdmin()){
      renderCostos();
      const ac=document.getElementById("addCost"); if(ac) ac.onclick=()=>{ (draft.costosExtra=draft.costosExtra||[]).push(nuevaLineaCosto()); renderCostos(); };
    }
  }
}
/* Unidades totales del documento (para prorratear costos adicionales). */
function unidadesDoc(){ return draft.lineas.reduce((a,l)=> a + (parseNum(l.cantidad)||0), 0); }
/* Total del documento: líneas + envío (venta). En compra el handling/flete NO
   suma al total facturado por el proveedor si vino aparte, pero acá lo sumamos
   para reflejar el desembolso total. */
function docTotal(){
  if(draft.tipo==="compra"){
    // En factura de terceros el "desembolso" nuestro es sólo por las unidades que nos
    // quedamos (Ours). En propia, la cantidad completa de cada línea.
    const base = draft.origen==="terceros"
      ? round2((draft.lineas||[]).reduce((a,l)=> a + round2((lineaOurs(l))*(l.precio||0)), 0))
      : totalLineas(draft.lineas);
    return round2(base + (draft.handling||0) + (draft.flete||0));
  }
  const envio = (draft.envio && draft.envio.tipo==="monto") ? (draft.envio.monto||0) : 0;
  return round2(totalLineas(draft.lineas) + envio + cargosClienteTotal());
}
/* Task 5: suma de los cargos on-top (USD). */
function cargosClienteTotal(){ return round2((draft.cargosCliente||[]).reduce((a,c)=> a + (parseNum(c.monto)||0), 0)); }
function nuevaLineaCargo(){ return { key:uid(), nota:"", monto:0 }; }
function renderCargos(){
  const host=document.getElementById("cargoHost"); if(!host) return;
  draft.cargosCliente = draft.cargosCliente || [];
  const cc = CCY_SYM;
  host.innerHTML = draft.cargosCliente.length ? draft.cargosCliente.map((c,i)=>`
    <div class="grid-form" style="grid-template-columns:1fr auto auto;padding:0;gap:8px;align-items:end;margin-bottom:6px">
      <div class="field"><label>${t("md.lbl.concept")}</label><input class="inp" data-cgnota="${i}" value="${esc(c.nota||"")}" placeholder="${t("md.ph.charge")}"></div>
      <div class="field"><label>${t("md.lbl.amount",{cc:esc(cc)})}</label><input class="inp num" data-cgmonto="${i}" value="${c.monto||0}" style="max-width:130px"></div>
      <button class="btn ghost sm" data-cgdel="${i}" style="color:var(--alert)">✕</button>
    </div>`).join("") : `<p class="hint" style="font-size:12px;margin:0">${t("md.cargos.empty")}</p>`;
  host.querySelectorAll("[data-cgnota]").forEach(inp=> inp.oninput=()=>{ draft.cargosCliente[+inp.dataset.cgnota].nota=inp.value; });
  host.querySelectorAll("[data-cgmonto]").forEach(inp=> inp.oninput=()=>{ draft.cargosCliente[+inp.dataset.cgmonto].monto=parseNum(inp.value); refreshTotal(); });
  host.querySelectorAll("[data-cgdel]").forEach(b=> b.onclick=()=>{ draft.cargosCliente.splice(+b.dataset.cgdel,1); renderCargos(); refreshTotal(); });
}
function pintarProrateo(){
  const h=document.getElementById("d_proHint"); if(!h) return;
  const u=unidadesDoc(), extra=(draft.handling||0)+(draft.flete||0);
  h.textContent = (extra>0 && u>0)
    ? t("md.pro.split",{total:money(extra),u:qty(u),per:money(extra/u)})
    : t("md.pro.hint");
  refreshTotal();
}

/* ============================================================
   COSTOS ADICIONALES POR VENTA (gastos de venta) — sólo admin
   ------------------------------------------------------------
   No se capitalizan al stock: van por debajo del margen bruto. "Horas hombre"
   se carga como horas × valor-hora y el sistema multiplica. El recuadro de neto
   es una ESTIMACIÓN en vivo (usa el costo FIFO de referencia de cada línea);
   el número exacto queda congelado en la factura al confirmar.
   ============================================================ */
function nuevaLineaCosto(){ return { key:uid(), tipo:"envio", nota:"", monto:0, horas:0, valorHora:0 }; }
/* Total de costos de venta (USD). */
function costosDraftTotal(){ return (draft.costosExtra||[]).reduce((a,c)=> a + (parseNum(c.monto)||0), 0); }
function draftGrossMargin(){ return (draft.lineas||[]).reduce((a,l)=> a + ((parseNum(l.precio)||0)-(l.costoRef||0))*(parseNum(l.cantidad)||0), 0); }
function draftCommRate(){
  if(draft.vendedorId){ const v=vendedorById(draft.vendedorId); if(v&&v.rate!=null) return v.rate; }
  return 0;   // venta de la casa (sin vendedor) = 0% de comisión
}
function refreshNet(){
  const box=document.getElementById("netBox"); if(!box) return;
  const gm=round2(draftGrossMargin()), rate=draftCommRate(), comm=round2(gm*rate), cost=round2(costosDraftTotal()), net=round2(gm-comm-cost);
  box.innerHTML = `
    <div class="totrow"><span style="color:var(--muted)">${t("md.net.gross")}</span><span class="num">${money(gm)}</span></div>
    <div class="totrow"><span style="color:var(--muted)">${t("md.net.comm",{p:nf0.format(rate*100)})}</span><span class="num">${money(comm)}</span></div>
    <div class="totrow"><span style="color:var(--muted)">${t("md.net.costs")}</span><span class="num">${money(cost)}</span></div>
    <div class="totrow" style="font-weight:700"><span>${t("md.net.net")}</span><span class="num" style="color:${net<0?'var(--alert)':'var(--up)'}">${money(net)}</span></div>`;
}
function renderCostos(){
  const host=document.getElementById("costHost"); if(!host) return;
  draft.costosExtra = draft.costosExtra || [];
  const rows = draft.costosExtra.map((c,i)=>{
    const isLabor = c.tipo==="labor";
    const midCells = isLabor
      ? `<td style="width:64px"><input class="inp num" data-ck="horas" data-ci="${i}" value="${c.horas||0}" placeholder="${t("md.ph.hs")}" title="${t("md.tt.hours")}"></td>
         <td style="width:78px"><input class="inp num" data-ck="valorHora" data-ci="${i}" value="${c.valorHora||0}" placeholder="${t("md.ph.rate")}" title="${t("md.tt.rate")}"></td>
         <td class="r num" data-csub="${i}" style="width:92px;color:var(--muted)">${money((parseNum(c.horas)||0)*(parseNum(c.valorHora)||0))}</td>`
      : `<td colspan="2"><input class="inp" data-ck="nota" data-ci="${i}" value="${esc(c.nota||"")}" placeholder="${t("md.ph.noteopt")}"></td>
         <td style="width:92px"><input class="inp num" data-ck="monto" data-ci="${i}" value="${c.monto||0}"></td>`;
    return `<tr>
      <td style="width:150px"><select class="inp" data-ck="tipo" data-ci="${i}">${COSTO_TIPOS.map(t=>`<option value="${t.id}" ${t.id===c.tipo?"selected":""}>${esc(costoTipoLabel(t.id))}</option>`).join("")}</select></td>
      ${midCells}
      <td style="width:28px"><button class="btn ghost sm" data-cdel="${i}" title="${t("md.tt.remove")}">✕</button></td>
    </tr>`;
  }).join("");
  host.innerHTML = draft.costosExtra.length
    ? `<div class="table-scroll"><table class="line-tbl doc-tbl"><colgroup><col style="width:150px"><col><col><col style="width:92px"><col style="width:28px"></colgroup><tbody>${rows}</tbody></table></div>`
    : `<p class="hint" style="margin:2px 0 0;font-size:12px">${t("md.costos.empty")}</p>`;
  host.querySelectorAll("[data-ck]").forEach(inp=>{
    const i=+inp.dataset.ci, k=inp.dataset.ck;
    const handler=()=>{
      const c=draft.costosExtra[i]; if(!c) return;
      if(k==="tipo"){ c.tipo=inp.value; renderCostos(); return; }   // cambia la estructura de la fila
      if(k==="nota"){ c.nota=inp.value; return; }
      c[k]=parseNum(inp.value);
      if(k==="horas"||k==="valorHora"){
        c.monto=round2((parseNum(c.horas)||0)*(parseNum(c.valorHora)||0));
        const sc=host.querySelector(`[data-csub="${i}"]`); if(sc) sc.textContent=money(c.monto);
      }
      refreshNet();
    };
    inp.oninput = handler;
    if(inp.tagName==="SELECT") inp.onchange = handler;
  });
  host.querySelectorAll("[data-cdel]").forEach(b=> b.onclick=()=>{ draft.costosExtra.splice(+b.dataset.cdel,1); renderCostos(); });
  refreshNet();
}

/* ============================================================
   AJUSTE DE INVENTARIO (movimiento tipo "ajuste")
   ============================================================ */
let adjDraft = null;
function openAjuste(prodId){
  if(!puedeAjustar()){ toast(t("md.err.adminajuste"),"warn"); return; }
  adjDraft = { productoId: prodId||"", store: effectiveStores()[0]||STORE_IDS[0], modo:"delta", cantidad:"", fecha:new Date().toISOString().slice(0,10), obs:"" };
  renderAjuste();
}
function renderAjuste(){
  const p = prodById(adjDraft.productoId);
  const store = adjDraft.store;
  const opts = `<option value="">${t("md.aj.pickprod")}</option>` +
    db.productos.filter(x=>!soloEnVault(x)||isAdmin()).map(x=>`<option value="${x.id}" ${x.id===adjDraft.productoId?"selected":""}>${esc(x.sku?("["+x.sku+"] "):"")}${esc(x.nombre)}</option>`).join("");
  const stockActual = p ? qty(stockDe(p, store)) : "—";
  const allowSt = allowedStores();
  const storeSel = allowSt.length>1
    ? `<select class="inp" id="aj_store">${allowSt.map(s=>`<option value="${s}" ${s===store?"selected":""}>${esc(storeName(s))}</option>`).join("")}</select>`
    : `<input class="inp" value="${esc(storeName(store))}" disabled>`;
  let previewTxt = "";
  if(p && adjDraft.cantidad!=="" && !isNaN(+adjDraft.cantidad)){
    const cur = stockDe(p, store);
    const nuevo = adjDraft.modo==="recuento" ? +adjDraft.cantidad : cur+(+adjDraft.cantidad);
    const delta = nuevo-cur;
    const col = delta===0?"var(--muted)":(delta>0?"var(--up)":"var(--down)");
    previewTxt = `<div class="banner ${delta>=0?'ok':'warn'}" style="margin:2px 0 0">Stock: <b>${qty(cur)}</b> → <b>${qty(nuevo)}</b> <span style="color:${col}">(${delta>=0?'+':'−'}${qty(Math.abs(delta))})</span></div>`;
  }
  const body = `
    <div class="grid-form" style="grid-template-columns:1fr 1fr;padding:0;margin-bottom:8px">
      <div class="field"><label>${t("common.product")}</label>
        <select class="inp" id="aj_prod">${opts}</select>
      </div>
      <div class="field"><label>${t("md.lbl.society")}</label>${storeSel}
        ${p?`<div style="font-size:12px;color:var(--muted);margin-top:4px">${t("md.aj.stockline",{n:'<b class="num">'+stockActual+'</b>',cost:money(p.ultimoCosto)})}</div>`:""}
      </div>
      <div class="field"><label>${t("md.aj.type")}</label>
        <select class="inp" id="aj_modo">
          <option value="delta" ${adjDraft.modo==="delta"?"selected":""}>${t("md.aj.modo.delta")}</option>
          <option value="recuento" ${adjDraft.modo==="recuento"?"selected":""}>${t("md.aj.modo.count")}</option>
        </select>
      </div>
      <div class="field"><label>${adjDraft.modo==="recuento"?t("md.aj.countedstock"):t("md.aj.qty")}</label>
        <input class="inp num" id="aj_cant" type="number" step="any" value="${esc(adjDraft.cantidad)}" placeholder="0"></div>
      <div class="field"><label>${t("common.date")}</label><input class="inp" type="date" id="aj_fe" value="${esc(adjDraft.fecha)}"></div>
      <div class="field"><label>${t("md.aj.note")}</label><input class="inp" id="aj_obs" value="${esc(adjDraft.obs)}" placeholder="${t("md.aj.ph.note")}"></div>
    </div>
    <div id="aj_prev">${previewTxt}</div>
  `;
  buildModal(t("md.aj.title"), body, [
    {label:t("common.cancel"), cls:"btn", act:()=>{ adjDraft=null; closeModal(); }},
    {label:t("md.aj.record"), cls:"btn", act:confirmAjuste}
  ]);
  const sync=()=>{
    adjDraft.productoId=document.getElementById("aj_prod").value;
    const st=document.getElementById("aj_store"); if(st) adjDraft.store=st.value;
    adjDraft.modo=document.getElementById("aj_modo").value;
    adjDraft.cantidad=document.getElementById("aj_cant").value;
    adjDraft.fecha=document.getElementById("aj_fe").value;
    adjDraft.obs=document.getElementById("aj_obs").value;
  };
  document.getElementById("aj_prod").onchange=()=>{ sync(); renderAjuste(); };
  const st=document.getElementById("aj_store"); if(st) st.onchange=()=>{ sync(); renderAjuste(); };
  document.getElementById("aj_modo").onchange=()=>{ sync(); renderAjuste(); };
  document.getElementById("aj_cant").oninput=()=>{ sync(); renderAjuste(); document.getElementById("aj_cant").focus(); };
  document.getElementById("aj_obs").oninput=e=>adjDraft.obs=e.target.value;
  document.getElementById("aj_fe").oninput=e=>adjDraft.fecha=e.target.value;
}
function confirmAjuste(){
  const p = prodById(adjDraft.productoId);
  if(!p){ toast(t("md.err.pickprod"),"warn"); return; }
  const store = adjDraft.store || STORE_IDS[0];
  if(adjDraft.cantidad==="" || isNaN(+adjDraft.cantidad)){ toast(t("md.err.qtyvalid"),"warn"); return; }
  if(!adjDraft.obs.trim()){ toast(t("md.err.noterequired"),"warn"); return; }
  const cur = stockDe(p, store);
  const nuevo = adjDraft.modo==="recuento" ? +adjDraft.cantidad : cur+(+adjDraft.cantidad);
  const delta = +(nuevo-cur).toFixed(4);
  if(delta===0){ toast(t("md.err.nochange"),"warn"); return; }
  if(nuevo < 0){ toast(t("md.err.negative"),"warn"); alert(t("md.aj.alertneg",{n:qty(nuevo)})); return; }
  if(!confirm(t("md.aj.confirm",{prod:p.nombre,store:storeName(store),from:qty(cur),to:qty(nuevo),delta:(delta>=0?'+':'−')+qty(Math.abs(delta)),reason:adjDraft.obs.trim()}))) return;
  const ref = t("md.aj.ref",{obs:adjDraft.obs.trim()});
  const fechaISO = new Date(adjDraft.fecha+"T12:00:00").toISOString();
  // FIFO: positive adjustment adds a layer at last cost; negative consumes layers
  if(delta>0) fifoEntrada(p, store, delta, p.ultimoCosto||0, ref, null);
  else fifoConsumir(p, store, -delta);
  moverStock(p, delta, p.ultimoCosto||0, "ajuste", null, ref, { tipo:"ajuste", obs:adjDraft.obs.trim(), fecha:fechaISO, store });
  adjDraft=null; save(); closeModal();
  toast(t("md.aj.recorded",{delta:(delta>=0?'+':'−')+qty(Math.abs(delta))}), delta>=0?"up":"down");
  render();
}

function prodOptions(sel, soloConStock){
  const lista = soloConStock ? db.productos.filter(p=> (p.stock||0) > 0) : db.productos;
  const opts = lista.map(p=>{
    const disp = soloConStock ? t("md.opt.disp",{n:qty(p.stock)}) : "";
    return `<option value="${p.id}" ${p.id===sel?"selected":""}>${esc(p.sku?("["+p.sku+"] "):"")}${esc(p.nombre)}${disp}</option>`;
  }).join("");
  const nuevo = soloConStock ? "" : `<option value="__new">${t("md.opt.newprod")}</option>`;
  const vacio = soloConStock && !lista.length
    ? `<option value="">${t("md.opt.nostock")}</option>`
    : `<option value="">${t("md.opt.choose")}</option>`;
  return vacio + opts + nuevo;
}

const round2 = n => Math.round((n||0)*100)/100;
/* Total de un documento = suma de subtotales YA redondeados a 2 decimales.
   Redondear por renglón y después sumar hace que el total guardado coincida
   exactamente con lo que se ve línea por línea (money() muestra 2 decimales),
   y evita el ruido de punto flotante tipo 92.10000000000001 al reconciliar. */
function totalLineas(arr){ return round2((arr||[]).reduce((a,x)=> a + round2((x.cantidad||0)*(x.precio||0)), 0)); }

/* ============================================================
   TASK 1 — Disponible por línea considerando TODO el documento
   Si un producto aparece en varias líneas de la MISMA factura, el
   tope de cada línea es: stock − lo ya comprometido en las otras líneas.
   Así no se puede meter 20 + 20 cuando hay 20.
   ============================================================ */
function stockBaseVenta(prodId){
  const p = prodById(prodId); if(!p) return 0;
  // La venta descuenta del DEPÓSITO elegido (Select o Swan), no del pool.
  const store = (draft && draft.storeVenta) || STORE_IDS[0];
  let s = stockDe(p, store) || 0;
  // si estamos EDITando una venta del MISMO depósito, su stock "vuelve" antes de re-validar
  if(draft && draft.editingId && draft.tipo!=="compra"){
    const old = db.ventas.find(x=>x.id===draft.editingId);
    if(old){
      const oldStore = old.storeVenta || old.store || STORE_IDS[0];
      if(oldStore===store) old.lineas.forEach(l=>{ if(l.productoId===prodId) s += (l.cantidad||0); });
    }
  }
  return s;
}
function comprometidoOtras(prodId, exceptIdx){
  if(!prodId) return 0;
  return draft.lineas.reduce((a,l,idx)=> a + ((idx!==exceptIdx && l.productoId===prodId) ? (parseNum(l.cantidad)||0) : 0), 0);
}
function dispRestante(prodId, exceptIdx){
  return stockBaseVenta(prodId) - comprometidoOtras(prodId, exceptIdx);
}
/* Refresca los textos "disp / quedan" de todas las líneas de venta sin re-render
   (así no se pierde el foco del input mientras se tipea la cantidad). */
function updateDispInfos(){
  if(!draft || draft.tipo==="compra") return;
  document.querySelectorAll("#lineHost .disp-info").forEach(div=>{
    const i=+div.dataset.di, l=draft.lineas[i]; if(!l) return;
    const p=prodById(l.productoId);
    if(!p){ div.innerHTML=""; return; }
    const rem=dispRestante(l.productoId,i), comprom=comprometidoOtras(l.productoId,i);
    const over=(parseNum(l.cantidad)||0)>rem;
    div.style.color = over?"var(--alert)":"var(--muted)";
    div.innerHTML = `${t("md.disp.avail",{n:qty(stockBaseVenta(l.productoId))})}${comprom>0?t("md.disp.left",{n:qty(rem)}):""}${over?t("md.disp.over"):""}`;
  });
}

/* ============================================================
   TASK 2 — Combobox de producto con buscador (orden alfabético)
   Reemplaza al <select> nativo: input de búsqueda + lista filtrable.
   El popup se posiciona con position:fixed sobre <body> para NO quedar
   recortado por el overflow del modal.
   ============================================================ */
let _pickerAnchor = null;
function pickerLabel(l){
  if(l.crear) return { kind:"plain", txt:t("md.pick.newprod"), ph:false };
  if(l.productoId){
    const p=prodById(l.productoId);
    if(!p) return { kind:"plain", txt:t("md.pick.product"), ph:true };
    return { kind:"prod", sku:p.sku||"", name:p.nombre||"", ph:false };
  }
  return { kind:"plain", txt:t("md.pick.product"), ph:true };
}
function pickerBtn(l, i){
  const info = pickerLabel(l);
  let inner;
  if(info.kind==="prod"){
    // Producto elegido: chip de SKU (si tiene) + nombre que se estira y trunca último
    const chip = info.sku ? `<span class="pb-sku">${esc(info.sku)}</span>` : "";
    inner = `${chip}<span class="pb-name" data-fullname="${esc(info.name)}">${esc(info.name)}</span>`;
  } else {
    // Placeholder o "＋ New product": texto plano como antes
    inner = `<span class="ppick-label">${esc(info.txt)}</span>`;
  }
  return `<button type="button" class="ppick-btn${info.ph?" placeholder":""}" data-ppick="${i}">
    ${inner}<span class="ppick-caret">▾</span></button>`;
}
function pickerItemsHTML(i, q){
  const isC = draft.tipo==="compra";
  const cur = draft.lineas[i].productoId;
  q = (q||"").trim().toLowerCase();
  const vstore = (draft && draft.store) || STORE_IDS[0];   // sólo relevante en COMPRA
  const vstoreVenta = (draft && draft.storeVenta) || STORE_IDS[0];   // depósito de la venta
  // COMPRA: todos los productos. VENTA: los que tengan stock EN ESE DEPÓSITO.
  let lista = isC ? db.productos.slice()
                  : db.productos.filter(p=> stockDe(p, vstoreVenta)>0 || p.id===cur);
  // orden alfabético SIEMPRE (task 2), por nombre
  lista.sort((a,b)=> String(a.nombre||"").localeCompare(String(b.nombre||""),"en",{numeric:true}));
  if(q) lista = lista.filter(p=> ((p.nombre||"")+" "+(p.sku||"")).toLowerCase().includes(q));
  let html = lista.map(p=>{
    const sku = p.sku ? `<span class="sku">${esc(p.sku)}</span>` : "";
    let disp = "";
    if(!isC){ disp = `<span class="pi-disp">${t("md.pi.disp",{n:qty(dispRestante(p.id,i))})}</span>`; }
    const sel = p.id===cur ? " active" : "";
    return `<button type="button" class="ppick-item${sel}" data-pick="${p.id}">${sku}<span class="pi-name" data-fullname="${esc(p.nombre)}">${esc(p.nombre)}</span>${disp}</button>`;
  }).join("");
  if(!lista.length){
    const hayStock = db.productos.some(p=> isC ? true : stockDe(p, vstoreVenta)>0);
    html = `<div class="ppick-empty">${isC ? t("md.pick.noprodmatch") : (hayStock?t("md.pick.nostockmatch"):t("md.pick.nostocksell",{store:esc(storeName(vstoreVenta))}))}</div>`;
  }
  if(isC) html += `<button type="button" class="ppick-item new" data-pick="__new">${t("md.opt.newprod")}</button>`;
  return html;
}
function positionPicker(pop, anchor){
  const r = anchor.getBoundingClientRect();
  const w = pop.offsetWidth||360, h = pop.offsetHeight||300;
  const vw = window.innerWidth, vh = window.innerHeight;
  let left = r.left, top = r.bottom+6;
  if(left+w > vw-8) left = Math.max(8, vw-8-w);
  if(top+h > vh-8){ const above = r.top-6-h; top = above>8 ? above : Math.max(8, vh-8-h); }
  pop.style.left = left+"px"; pop.style.top = top+"px";
}
function repositionPicker(){ const pop=document.querySelector(".ppick-pop"); if(pop && _pickerAnchor) positionPicker(pop,_pickerAnchor); }
function onPickerOutside(e){ const pop=document.querySelector(".ppick-pop"); if(pop && !pop.contains(e.target) && (!_pickerAnchor || !_pickerAnchor.contains(e.target))) closeProductPicker(); }
function onPickerKey(e){ if(e.key==="Escape"){ e.stopPropagation(); e.preventDefault(); closeProductPicker(); } }
/* ---------- Tooltip de nombre completo (hover sobre producto) ----------
   Aparece SOLO si el texto está truncado (ellipsis). Así no molesta cuando
   el nombre ya se ve entero, y rescata los nombres largos que no entran. */
let _nameTip=null;
function showNameTip(el){
  if(!el || el.scrollWidth <= el.clientWidth + 1) return;   // no truncado => no molesta
  const txt = el.getAttribute("data-fullname"); if(!txt) return;
  if(!_nameTip){ _nameTip=document.createElement("div"); _nameTip.className="name-tip"; document.body.appendChild(_nameTip); }
  _nameTip.textContent = txt;
  _nameTip.style.display="block";
  const r=el.getBoundingClientRect(), tw=_nameTip.offsetWidth, th=_nameTip.offsetHeight;
  let left=r.left; if(left+tw>window.innerWidth-8) left=window.innerWidth-8-tw; left=Math.max(8,left);
  let top=r.top-th-8; if(top<8) top=r.bottom+8;   // arriba; si no entra, abajo
  _nameTip.style.left=left+"px"; _nameTip.style.top=top+"px";
  requestAnimationFrame(()=> _nameTip && _nameTip.classList.add("show"));
}
function hideNameTip(){ if(_nameTip){ _nameTip.classList.remove("show"); _nameTip.style.display="none"; } }
function wireNameTips(scope){
  (scope||document).querySelectorAll("[data-fullname]").forEach(el=>{
    el.onmouseenter=()=> showNameTip(el);
    el.onmouseleave=hideNameTip;
  });
}
function closeProductPicker(){
  hideNameTip();
  document.querySelectorAll(".ppick-pop").forEach(el=>el.remove());
  document.querySelectorAll(".ppick-btn.open").forEach(b=>b.classList.remove("open"));
  window.removeEventListener("scroll", repositionPicker, true);
  window.removeEventListener("resize", closeProductPicker);
  document.removeEventListener("mousedown", onPickerOutside, true);
  document.removeEventListener("keydown", onPickerKey, true);
  _pickerAnchor=null;
}
function openProductPicker(i, anchor){
  closeProductPicker();
  _pickerAnchor = anchor; anchor.classList.add("open");
  const pop = document.createElement("div"); pop.className="ppick-pop";
  pop.innerHTML = `<input class="inp ppick-search" placeholder="${t("md.ph.searchprod")}" autocomplete="off" spellcheck="false"><div class="ppick-list"></div>`;
  document.body.appendChild(pop);
  const search = pop.querySelector(".ppick-search");
  const listEl = pop.querySelector(".ppick-list");
  let items = [];        // botones visibles actuales
  let active = 0;        // índice resaltado (navegación con flechas)
  const highlight = ()=>{
    items.forEach((it,idx)=> it.classList.toggle("kbd-active", idx===active));
    const el = items[active]; if(el) el.scrollIntoView({block:"nearest"});
  };
  const paint = (q)=>{
    listEl.innerHTML = pickerItemsHTML(i, q);
    items = Array.from(listEl.querySelectorAll("[data-pick]"));
    active = 0;
    items.forEach((it,idx)=>{
      it.onclick = ()=>{ selectProductForLine(i, it.dataset.pick); };
      it.onmousemove = ()=>{ if(active!==idx){ active=idx; highlight(); } };
    });
    highlight();
    wireNameTips(listEl);
  };
  paint("");
  search.oninput = ()=> paint(search.value);
  // Teclado: ↑↓ mueven el resaltado, Enter elige, Esc lo maneja onPickerKey.
  search.addEventListener("keydown", (e)=>{
    if(e.key==="ArrowDown"){ e.preventDefault(); if(items.length){ active=Math.min(active+1, items.length-1); highlight(); } }
    else if(e.key==="ArrowUp"){ e.preventDefault(); if(items.length){ active=Math.max(active-1, 0); highlight(); } }
    else if(e.key==="Enter"){ e.preventDefault(); const el=items[active]; if(el){ selectProductForLine(i, el.dataset.pick); } }
  });
  positionPicker(pop, anchor);
  window.addEventListener("scroll", repositionPicker, true);
  window.addEventListener("resize", closeProductPicker);
  setTimeout(()=>{ document.addEventListener("mousedown", onPickerOutside, true); document.addEventListener("keydown", onPickerKey, true); }, 0);
  search.focus();
}

/* Elegir un producto para la línea i: cierra el picker, SUMA si el producto ya
   está en otra línea (como una caja registradora), y deja el foco en Cantidad. */
function selectProductForLine(i, value){
  closeProductPicker();
  if(value==="__new"){ applyProdSelection(i, value); return; }
  const dupIdx = draft.lineas.findIndex((l,idx)=> idx!==i && !l.crear && l.productoId===value);
  if(dupIdx>=0){
    const add = parseNum(draft.lineas[i].cantidad)||1;
    draft.lineas[dupIdx].cantidad = (parseNum(draft.lineas[dupIdx].cantidad)||0) + add;
    draft.lineas.splice(i,1);                                  // descarta la línea recién agregada
    const target = dupIdx > i ? dupIdx-1 : dupIdx;             // reindexar tras el splice
    renderLines(); refreshTotal();
    focusCantidad(target);
    return;
  }
  applyProdSelection(i, value);
  focusCantidad(i);
}
function focusCantidad(i){
  setTimeout(()=>{ const el=document.querySelector(`#lineHost [data-k="cantidad"][data-i="${i}"]`); if(el){ el.focus(); if(el.select) el.select(); } }, 0);
}
/* Aplica la selección de producto en una línea (usado por el combobox). */
function applyProdSelection(i, value){
  const l = draft.lineas[i]; if(!l) return;
  const isC = draft.tipo==="compra";
  if(value==="__new"){ l.crear=true; l.productoId=""; l.sku=""; l.nombre=""; renderLines(); return; }
  l.crear=false; l.productoId=value;
  const p = prodById(value);
  if(p && isC && !l.precio){ l.precio = (p.costoNeto!=null?p.costoNeto:p.ultimoCosto); }
  if(p && !isC){
    const stv = draft.storeVenta || STORE_IDS[0];
    // costo de referencia = costo FIFO de la próxima unidad EN ESE DEPÓSITO (mezcla real)
    l.costoRef = fifoCostoPeek(p, stv, 1).unit || p.ultimoCosto || 0;
    const precioDep = (p.precioVentaPorTienda && p.precioVentaPorTienda[stv]) || p.precioVenta || 0;
    if(precioDep>0){                              // trae el precio de lista del depósito y deriva el markup
      l.precio = precioDep;
      l.margen = l.costoRef>0 ? round2((l.precio/l.costoRef-1)*100) : 0;
    } else {
      l.margen = l.margen||0;
      l.precio = round2(l.costoRef*(1+(l.margen||0)/100));
    }
    const rem = dispRestante(p.id, i);           // respetar stock restante al elegir
    if((parseNum(l.cantidad)||0) > rem) l.cantidad = Math.max(0, rem);
  }
  renderLines(); refreshTotal();
}
/* ============================================================
   PUNTO 7 — Clientes: autocompletar + alta de cliente nuevo
   ============================================================ */
function openClientePicker(anchor){
  closeProductPicker();
  _pickerAnchor = anchor; anchor.classList.add("open");
  const pop = document.createElement("div"); pop.className="ppick-pop";
  pop.innerHTML = `<input class="inp ppick-search" placeholder="${t("md.ph.searchcust")}" autocomplete="off" spellcheck="false"><div class="ppick-list"></div>`;
  document.body.appendChild(pop);
  const search = pop.querySelector(".ppick-search"), listEl = pop.querySelector(".ppick-list");
  const paint=(q)=>{
    q=(q||"").trim().toLowerCase();
    let lista = db.clientes.slice().sort((a,b)=>String(a.nombre||"").localeCompare(String(b.nombre||""),"en"));
    if(q) lista = lista.filter(c=> ((c.nombre||"")+" "+(c.empresa||"")+" "+(c.email||"")).toLowerCase().includes(q));
    let html = lista.map(c=>`<button type="button" class="ppick-item${c.id===draft.clienteId?" active":""}" data-pickcli="${c.id}">
      <span class="pi-name">${esc(c.nombre)}${c.empresa?` · ${esc(c.empresa)}`:""}</span></button>`).join("");
    if(!lista.length) html = `<div class="ppick-empty">${t("md.pick.nocustmatch")}</div>`;
    html += `<button type="button" class="ppick-item new" data-pickcli="__new">${t("md.pick.addcust")}</button>`;
    listEl.innerHTML = html;
    listEl.querySelectorAll("[data-pickcli]").forEach(it=> it.onclick=()=>{
      const v=it.dataset.pickcli; closeProductPicker();
      if(v==="__new") openClienteForm(null, search.value.trim());
      else { draft.clienteId=v; renderDocModal(); }
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
/* Picker del DUEÑO (tercero) de una compra de terceros. Igual estilo que el de
   cliente, pero setea draft.terceroId. Permite crear un cliente nuevo al vuelo. */
function openDocOwnerPicker(anchor){
  closeProductPicker();
  _pickerAnchor = anchor; anchor.classList.add("open");
  const pop = document.createElement("div"); pop.className="ppick-pop";
  pop.innerHTML = `<input class="inp ppick-search" placeholder="${t("conj.ph.searchowner")}" autocomplete="off" spellcheck="false"><div class="ppick-list"></div>`;
  document.body.appendChild(pop);
  const search = pop.querySelector(".ppick-search"), listEl = pop.querySelector(".ppick-list");
  const paint=(q)=>{
    q=(q||"").trim().toLowerCase();
    let lista = db.clientes.slice().sort((a,b)=>String(a.nombre||"").localeCompare(String(b.nombre||""),"en"));
    if(q) lista = lista.filter(c=> ((c.nombre||"")+" "+(c.empresa||"")+" "+(c.email||"")).toLowerCase().includes(q));
    let html = lista.map(c=>`<button type="button" class="ppick-item${c.id===draft.terceroId?" active":""}" data-pickowner="${c.id}">
      <span class="pi-name">${esc(c.nombre)}${c.empresa?` · ${esc(c.empresa)}`:""}</span></button>`).join("");
    if(!lista.length) html = `<div class="ppick-empty">${t("md.pick.noclimatch")}</div>`;
    html += `<button type="button" class="ppick-item new" data-pickowner="__new">${t("md.pick.addcli")}</button>`;
    listEl.innerHTML = html;
    listEl.querySelectorAll("[data-pickowner]").forEach(it=> it.onclick=()=>{
      const v=it.dataset.pickowner; closeProductPicker();
      if(v==="__new") openClienteForm(null, search.value.trim());   // al guardar setea draft.clienteId; lo copiamos abajo
      else { draft.terceroId=v; renderDocModal(); }
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

/* Alta de cliente. Reemplaza el modal de venta; al guardar, vuelve con
   renderDocModal() (el draft persiste en memoria). */
function openClienteForm(id, nombrePre){
  const c = id ? clienteById(id) : null;
  buildModal(c?t("md.cli.edit"):t("md.cli.new"), `
    <div class="grid-form" style="grid-template-columns:1fr 1fr;padding:0">
      <div class="field" style="grid-column:1/3"><label>${t("md.cli.name")} <span class="hint" style="font-weight:400">${t("md.req")}</span></label><input class="inp" id="c_nom" value="${c?esc(c.nombre):esc(nombrePre||"")}"></div>
      <div class="field"><label>${t("md.cli.contact")}</label><input class="inp" id="c_con" value="${c?esc(c.contacto):""}"></div>
      <div class="field"><label>${t("md.cli.company")}</label><input class="inp" id="c_emp" value="${c?esc(c.empresa):""}"></div>
      <div class="field"><label>${t("md.cli.phone")}</label><input class="inp" id="c_tel" value="${c?esc(c.telefono):""}"></div>
      <div class="field"><label>${t("md.cli.email")} <span class="hint" style="font-weight:400">${t("md.req")}</span></label><input class="inp" id="c_mail" value="${c?esc(c.email):""}"></div>
      <div class="field" style="grid-column:1/3"><label>${t("md.cli.address")} <span class="hint" style="font-weight:400">${t("md.req")}</span></label><input class="inp" id="c_dir" value="${c?esc(c.direccion):""}" placeholder="${t("md.cli.ph.address")}"></div>
      <div class="field"><label>${t("md.cli.city")}</label><input class="inp" id="c_ciu" value="${c?esc(c.ciudad):""}"></div>
      <div class="field"><label>${t("md.cli.state")}</label><input class="inp" id="c_est" value="${c?esc(c.estado):""}" placeholder="${t("md.cli.ph.state")}"></div>
      <div class="field"><label>${t("md.cli.zip")} <span class="hint" style="font-weight:400">${t("md.req")}</span></label><input class="inp" id="c_zip" value="${c?esc(c.zip):""}"></div>
      <div class="field"><label>${t("md.cli.country")}</label><input class="inp" id="c_pais" value="${c?esc(c.pais):""}" placeholder="${t("md.cli.ph.country")}"></div>
    </div>
  `, [
    {label:t("common.cancel"),cls:"btn",act:()=>renderDocModal()},
    {label:t("md.cli.save"),cls:"btn primary",act:()=>saveCliente(id)}
  ], true);
  document.getElementById("c_nom").focus();
}
function saveCliente(id){
  const g=x=>document.getElementById(x).value.trim();
  const nom=g("c_nom"), mail=g("c_mail"), dir=g("c_dir"), zip=g("c_zip");
  if(!nom){ toast(t("md.cli.errname"),"warn"); return; }
  if(!mail || !dir || !zip){ toast(t("md.cli.errfields"),"warn"); return; }
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)){ toast(t("md.cli.erremail"),"warn"); return; }
  const campos={ nombre:nom, contacto:g("c_con"), empresa:g("c_emp"), telefono:g("c_tel"),
                 email:mail, direccion:dir, ciudad:g("c_ciu"), estado:g("c_est"), zip, pais:g("c_pais") };
  let cid=id;
  if(id){ Object.assign(clienteById(id), campos); }
  else { const nc=Object.assign({id:uid()}, campos); db.clientes.push(nc); cid=nc.id; }
  draft.clienteId=cid;
  if(draft.tipo==="compra") draft.terceroId=cid;   // en compras el cliente elegido es el DUEÑO (terceros)
  save(); toast(t("md.cli.saved")); renderDocModal();
}


