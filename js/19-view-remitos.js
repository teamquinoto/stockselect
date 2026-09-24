/* ============================================================
   gestordestock — 19-view-remitos.js
   Parte de la app. Se carga como una etiqueta script en el ORDEN del index.html.
   Todo vive en scope global (sin módulos), igual que antes.
   ============================================================ */
/* ============================================================
   VISTA: Remitos
   ------------------------------------------------------------
   Un ÚNICO lugar donde viven TODOS los remitos numerados (db.remitos):
   U (salida US → AR) y A (split en AR: al dueño / a Select). Se descargan
   en PDF a demanda — ya no hay pop-up "¿generar PDF ahora?" al guardar.
   ============================================================ */
let remitoQ = "";

/* Etiqueta legible del tipo de remito. */
function remitoTipoLabel(r){
  if(r.letra==="U") return t("rem.type.usar");
  if(r.tipo==="ar-tercero") return t("rem.type.owner");
  if(r.tipo==="ar-select")  return t("rem.type.select");
  return t("rem.type.split");
}
/* Líneas que REALMENTE figuran en el PDF: mismo criterio que 30-pdf.js — si el
   remito lleva algo de terceros, lo "ours" no se cuenta (ya es stock propio).
   Sólo un remito 100% propio (envío de stock propio a AR) conserva sus "ours". */
function remitoLineasVisibles(r){
  let ls = (r.lineas||[]).filter(l=> (l.cantidad||0)>0);
  if(ls.some(l=> l.rol!=="ours")) ls = ls.filter(l=> l.rol!=="ours");
  return ls;
}
function remitoUnidades(r){ return remitoLineasVisibles(r).reduce((a,l)=> a+(l.cantidad||0), 0); }
/* Detalle corto: dueños involucrados; si es 100% propio, lo marca como tal. */
function remitoDetalle(r){
  const owners = [...new Set(remitoLineasVisibles(r).map(l=> (l.owner||"").trim()).filter(Boolean))];
  if(owners.length) return owners.join(", ");
  if(r.letra==="U") return t("rem.detail.own");
  return (r.obs||"").trim() || "—";
}

function viewRemitos(){
  // Más nuevo arriba: por fecha desc y, a igual fecha, por número desc.
  const all = (db.remitos||[]).slice().sort((a,b)=>{
    const d = String(b.fecha||"").localeCompare(String(a.fecha||""));
    if(d) return d;
    return (parseInt(b.numero,10)||0) - (parseInt(a.numero,10)||0);
  });
  const q = remitoQ.trim().toLowerCase();
  const list = q ? all.filter(r=>{
    const hay = [r.codigo, remitoTipoLabel(r), remitoDetalle(r), r.origenCodigo, r.obs, r.tracking, carrierName(r.carrier)]
      .filter(Boolean).join(" ").toLowerCase();
    return hay.includes(q);
  }) : all;

  const uCount = all.filter(r=> r.letra==="U").length;
  const aCount = all.filter(r=> r.letra==="A").length;

  return `
  <div class="head">
    <div class="title">
      <h2>${t("nav.remitos")}</h2>
      <p>${t("rem.sub")}</p>
    </div>
  </div>
  <div class="panel">
    <div class="phead"><h3>${t("rem.issued")}</h3><span class="hint">${all.length} total · ${uCount} U · ${aCount} A</span></div>
    ${all.length ? `
    <div class="filtros">
      <input class="inp" id="rmq" placeholder="${t('rem.ph.search')}" value="${esc(remitoQ)}" style="flex:1 1 180px;min-width:130px">
      ${q?`<button class="btn ghost sm" id="rmclear">${t("dash.f.clear")}</button>`:""}
      ${q?`<span class="hint" style="font-size:12px;white-space:nowrap">${t("rem.match",{n:list.length})}</span>`:""}
    </div>
    <div class="table-scroll"><table>
      <thead><tr>
        <th>${t("nav.remitos")}</th>
        <th>${t("common.date")}</th>
        <th>${t("rem.th.type")}</th>
        <th>${t("rem.th.from")}</th>
        <th>${t("rem.th.detail")}</th>
        <th>${t("trk.col")}</th>
        <th class="r">${t("common.units")}</th>
        <th></th>
      </tr></thead>
      <tbody>
      ${list.map(r=>`<tr>
        <td><b>${esc(r.codigo)}</b></td>
        <td style="white-space:nowrap">${esc(fmtDate(r.fecha))}</td>
        <td style="white-space:nowrap">${esc(remitoTipoLabel(r))}</td>
        <td style="white-space:nowrap">${r.origenCodigo?esc(r.origenCodigo):`<span class="hint">—</span>`}</td>
        <td>${esc(remitoDetalle(r))}</td>
        <td style="white-space:nowrap">${r.letra==="U" ? `${trackingHTML(r)} <button class="btn ghost xs" data-rmtrk="${esc(r.id)}" title="${t("trk.edit")}">${ICO.edit||"✎"}</button>` : `<span class="hint">—</span>`}</td>
        <td class="r num">${qty(remitoUnidades(r))}</td>
        <td class="r" style="white-space:nowrap"><button class="btn ghost sm" data-rmdoc="${esc(r.id)}" title="${t('rem.dl',{code:esc(r.codigo)})}">${ICO.pdf}PDF</button></td>
      </tr>`).join("")}
      </tbody></table></div>`
    : emptyState(t("rem.empty.title"),
        t("rem.empty.sub"))}
  </div>`;
}

/* Cableado de la vista (lo llama wire() del router). */
function wireRemitos(){
  if(view!=="remitos") return;
  const m=document.getElementById("main"); if(!m) return;
  const q=m.querySelector("#rmq"); if(q) q.oninput=()=>{ remitoQ=q.value; render(); };
  const cl=m.querySelector("#rmclear"); if(cl) cl.onclick=()=>{ remitoQ=""; render(); };
  m.querySelectorAll("[data-rmtrk]").forEach(b=> b.onclick=()=> openEditarTracking(b.dataset.rmtrk));
  m.querySelectorAll("[data-rmdoc]").forEach(b=> b.onclick=()=>{
    if(typeof generarRemitoDocPDF==="function") generarRemitoDocPDF(b.dataset.rmdoc);
    else toast(t("rem.tt.nopdf"),"warn");
  });
}
