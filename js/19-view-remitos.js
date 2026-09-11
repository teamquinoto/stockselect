/* ============================================================
   gestordestock — 19-view-remitos.js
   Parte de la app. Se carga como <script> en el ORDEN del index.html.
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
  if(r.letra==="U") return "US → AR";
  if(r.tipo==="ar-tercero") return "AR · to owner";
  if(r.tipo==="ar-select")  return "AR · Select";
  return "AR split";
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
  if(r.letra==="U") return "Own stock → AR";
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
    const hay = [r.codigo, remitoTipoLabel(r), remitoDetalle(r), r.origenCodigo, r.obs]
      .filter(Boolean).join(" ").toLowerCase();
    return hay.includes(q);
  }) : all;

  const uCount = all.filter(r=> r.letra==="U").length;
  const aCount = all.filter(r=> r.letra==="A").length;

  return `
  <div class="head">
    <div class="title">
      <h2>Remitos</h2>
      <p>Internal transfer notes (US → AR) and AR split notes, numbered by series. Download any one on demand — no pop-ups on save.</p>
    </div>
  </div>
  <div class="panel">
    <div class="phead"><h3>Issued remitos</h3><span class="hint">${all.length} total · ${uCount} U · ${aCount} A</span></div>
    ${all.length ? `
    <div class="filtros">
      <input class="inp" id="rmq" placeholder="Search by code, owner, type…" value="${esc(remitoQ)}" style="flex:1 1 180px;min-width:130px">
      ${q?`<button class="btn ghost sm" id="rmclear">Clear</button>`:""}
      ${q?`<span class="hint" style="font-size:11.5px;white-space:nowrap">${list.length} match(es)</span>`:""}
    </div>
    <div class="table-scroll"><table>
      <thead><tr>
        <th>Remito</th>
        <th>Date</th>
        <th>Type</th>
        <th>From</th>
        <th>Detail</th>
        <th class="r">Units</th>
        <th></th>
      </tr></thead>
      <tbody>
      ${list.map(r=>`<tr>
        <td><b>${esc(r.codigo)}</b></td>
        <td style="white-space:nowrap">${esc(fmtDate(r.fecha))}</td>
        <td style="white-space:nowrap">${esc(remitoTipoLabel(r))}</td>
        <td style="white-space:nowrap">${r.origenCodigo?esc(r.origenCodigo):`<span class="hint">—</span>`}</td>
        <td>${esc(remitoDetalle(r))}</td>
        <td class="r num">${qty(remitoUnidades(r))}</td>
        <td class="r" style="white-space:nowrap"><button class="btn ghost sm" data-rmdoc="${esc(r.id)}" title="Download ${esc(r.codigo)} PDF">⤓ PDF</button></td>
      </tr>`).join("")}
      </tbody></table></div>`
    : emptyState("No remitos yet",
        "They're created automatically when you load a third-party purchase, send your own stock to AR, or split a shipment in AR. This is where they'll live.")}
  </div>`;
}

/* Cableado de la vista (lo llama wire() del router). */
function wireRemitos(){
  if(view!=="remitos") return;
  const m=document.getElementById("main"); if(!m) return;
  const q=m.querySelector("#rmq"); if(q) q.oninput=()=>{ remitoQ=q.value; render(); };
  const cl=m.querySelector("#rmclear"); if(cl) cl.onclick=()=>{ remitoQ=""; render(); };
  m.querySelectorAll("[data-rmdoc]").forEach(b=> b.onclick=()=>{
    if(typeof generarRemitoDocPDF==="function") generarRemitoDocPDF(b.dataset.rmdoc);
    else toast("Couldn't load the PDF generator (try once with internet)","warn");
  });
}
