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
   Los U de STOCK PROPIO (envíos Swan → Select) muestran su ESTADO
   (en camino / parcial / recibido) y una línea de tiempo con la salida,
   cada recepción en AR y las bajas. Desde acá también se reciben.
   ============================================================ */
let remitoQ = "";
let remitoEstadoF = "";          // "" | "abiertos" | "recibido"  (filtro de envíos propios)
let remitoTimelineOpen = {};     // remitoId -> true si la línea de tiempo está desplegada

/* Etiqueta legible del tipo de remito. */
function remitoTipoLabel(r){
  if(r.letra==="U") return esEnvioPropio(r) ? t("rem.type.ownship") : t("rem.type.usar");
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
/* Celda de estado: sólo para envíos propios con seguimiento. */
function remitoEstadoCell(r, R){
  if(!R) return `<span class="hint">—</span>`;
  const sub = R.abierto
    ? t("rem.st.way",{d:R.dias})
    : (R.ultimaRecepcion ? t("rem.st.in",{date:esc(fmtDate(R.ultimaRecepcion)),d:R.dias}) : "");
  return `${envioEstadoPill(R.estado)}${sub?`<div class="hint" style="font-size:11px;margin-top:3px;white-space:nowrap">${sub}</div>`:""}`;
}
/* Línea de tiempo de un envío propio: salida → recepciones → estado actual. */
function remitoTimelineHTML(r, R){
  const dest = STORE_IDS[1] || STORE_IDS[0];
  const ev = [];
  ev.push({ fecha:r.fecha, ico:"usa", tit:t("rem.tl.out",{store:esc(storeName(r.origenStore||STORE_IDS[0]))}),
    det: t("rem.tl.outdet",{u:qty(R.tot.enviado),n:R.lineas.length}) + (r.tracking?` · ${trackingHTML(r)}`:"") });
  (r.recepciones||[]).slice().sort((a,b)=> String(a.fecha||"").localeCompare(String(b.fecha||""))).forEach(rc=>{
    const u = (rc.lineas||[]).reduce((a,x)=> a+(+x.recibido||0), 0);
    const b = (rc.lineas||[]).reduce((a,x)=> a+(+x.baja||0), 0);
    const bits = [];
    if(u>0) bits.push(t("rem.tl.recvu",{u:qty(u),store:esc(storeName(rc.destino||dest))}));
    if(b>0) bits.push(`<span style="color:var(--alert)">${t("rem.tl.wou",{u:qty(b),why:esc(t("conj.mm."+(rc.motivoBaja||"other")))})}</span>`);
    if(rc.costoArg>0) bits.push(t("rem.tl.cost",{m:money(rc.costoArg)}));
    if(rc.obs) bits.push(esc(rc.obs));
    const prods = (rc.lineas||[]).map(x=> `${esc(x.nombre||x.sku||"")} ${qty((+x.recibido||0))}${x.baja?` (−${qty(x.baja)})`:""}`).join(", ");
    ev.push({ fecha:rc.fecha, ico:"store", tit:t("rem.tl.recv"), det: bits.join(" · ") + (prods?`<div class="hint" style="margin-top:2px">${prods}</div>`:"") });
  });
  if(R.tot.otros>0) ev.push({ fecha:"", ico:"warn", tit:t("rem.tl.other"), det:t("env.otros.tip")+` · ${qty(R.tot.otros)} u` });
  const ahora = R.abierto
    ? { fecha:"", ico:"plane", tit:t("rem.tl.now.way",{d:R.dias}), det:t("rem.tl.now.waydet",{u:qty(R.tot.pendiente)}) }
    : { fecha:"", ico:"check", tit:t("rem.tl.now.closed",{st:esc(envioEstadoLabel(R.estado))}), det:t("rem.tl.now.closeddet",{d:R.dias}) };
  ev.push(ahora);
  const icoOf = k => k==="usa"||k==="store"||k==="plane" ? (RL_ICONS && RL_ICONS[k] ? RL_ICONS[k] : "") : (ICO[k]||"");
  return `<div class="rm-tl">${ev.map((x,i)=>`
    <div class="rm-tl-row${i===ev.length-1?" last":""}">
      <div class="rm-tl-dot">${icoOf(x.ico)}</div>
      <div class="rm-tl-body">
        <div><b>${x.tit}</b>${x.fecha?` <span class="hint">· ${esc(fmtDate(x.fecha))}</span>`:""}</div>
        <div class="hint">${x.det}</div>
      </div>
    </div>`).join("")}</div>`;
}
function ensureRemitosCSS(){
  if(document.getElementById("rm-tl-css")) return;
  const s = document.createElement("style"); s.id = "rm-tl-css";
  s.textContent = `
.rm-tl{padding:6px 4px 4px 4px}
.rm-tl-row{display:flex;gap:12px;position:relative;padding-bottom:12px}
.rm-tl-row:not(.last)::before{content:"";position:absolute;left:14px;top:30px;bottom:0;width:2px;background:var(--line-strong)}
.rm-tl-dot{width:30px;height:30px;flex:0 0 auto;border-radius:50%;display:flex;align-items:center;justify-content:center;border:1.5px solid var(--up);background:var(--up-bg);color:var(--accent-ink)}
.rm-tl-row.last .rm-tl-dot{background:var(--accent);border-color:var(--accent);color:var(--paper)}
.rm-tl-dot svg{width:15px;height:15px;display:block}
.rm-tl-body{flex:1;min-width:0;font-size:13px;padding-top:4px}
.rm-tl-wrap td{background:var(--surface-2)}
.rm-seg{display:inline-flex;border:1px solid var(--line-strong);border-radius:999px;overflow:hidden}
.rm-seg button{border:0;background:transparent;padding:5px 12px;font-size:12px;cursor:pointer;color:var(--muted)}
.rm-seg button.on{background:var(--accent);color:var(--paper);font-weight:600}
`;
  document.head.appendChild(s);
}

function viewRemitos(){
  ensureRemitosCSS();
  // Más nuevo arriba: por fecha desc y, a igual fecha, por número desc.
  const all = (db.remitos||[]).slice().sort((a,b)=>{
    const d = String(b.fecha||"").localeCompare(String(a.fecha||""));
    if(d) return d;
    return (parseInt(b.numero,10)||0) - (parseInt(a.numero,10)||0);
  });
  // estado derivado (una sola vez por render)
  const res = {};
  all.forEach(r=>{ if(esEnvioPropio(r)) res[r.id] = envioResumen(r); });
  const q = remitoQ.trim().toLowerCase();
  let list = q ? all.filter(r=>{
    const hay = [r.codigo, remitoTipoLabel(r), remitoDetalle(r), r.origenCodigo, r.obs, r.tracking, carrierName(r.carrier),
                 res[r.id] ? envioEstadoLabel(res[r.id].estado) : ""]
      .filter(Boolean).join(" ").toLowerCase();
    return hay.includes(q);
  }) : all;
  if(remitoEstadoF==="abiertos") list = list.filter(r=> res[r.id] && res[r.id].abierto);
  else if(remitoEstadoF==="recibido") list = list.filter(r=> res[r.id] && !res[r.id].abierto);

  const uCount = all.filter(r=> r.letra==="U").length;
  const aCount = all.filter(r=> r.letra==="A").length;
  const abiertos = Object.values(res).filter(R=> R.abierto).length;
  const hayEnvios = Object.keys(res).length>0;
  const seg = hayEnvios ? `<div class="rm-seg" role="group">
      <button type="button" data-rmst="" class="${remitoEstadoF===""?"on":""}">${t("rem.f.all")}</button>
      <button type="button" data-rmst="abiertos" class="${remitoEstadoF==="abiertos"?"on":""}">${t("rem.f.open",{n:abiertos})}</button>
      <button type="button" data-rmst="recibido" class="${remitoEstadoF==="recibido"?"on":""}">${t("rem.f.closed")}</button>
    </div>` : "";
  const filtrando = !!(q || remitoEstadoF);

  const rowHTML = r=>{
    const R = res[r.id];
    const tlOpen = !!(R && remitoTimelineOpen[r.id]);
    const main = `<tr>
        <td><b>${esc(r.codigo)}</b></td>
        <td style="white-space:nowrap">${esc(fmtDate(r.fecha))}</td>
        <td style="white-space:nowrap">${esc(remitoTipoLabel(r))}</td>
        <td style="white-space:nowrap">${r.origenCodigo?esc(r.origenCodigo):`<span class="hint">—</span>`}</td>
        <td>${esc(remitoDetalle(r))}</td>
        <td>${remitoEstadoCell(r, R)}</td>
        <td style="white-space:nowrap">${r.letra==="U" ? `${trackingHTML(r)} <button class="btn ghost xs" data-rmtrk="${esc(r.id)}" title="${t("trk.edit")}">${ICO.edit||"✎"}</button>` : `<span class="hint">—</span>`}</td>
        <td class="r num">${qty(remitoUnidades(r))}</td>
        <td class="r" style="white-space:nowrap">
          ${R?`<button class="btn ghost sm" data-rmtl="${esc(r.id)}" title="${t("rem.tl.btn")}" aria-expanded="${tlOpen?"true":"false"}">${t("rem.tl.btn")} ${tlOpen?"\u25b4":"\u25be"}</button>`:""}
          ${R && R.abierto && isAdmin()?`<button class="btn up sm" data-rmrecv="${esc(r.id)}">${ICO.receive}${t("env.b.receive")}</button>`:""}
          <button class="btn ghost sm" data-rmdoc="${esc(r.id)}" title="${t('rem.dl',{code:esc(r.codigo)})}">${ICO.pdf}PDF</button>
        </td>
      </tr>`;
    return main + (tlOpen ? `<tr class="rm-tl-wrap"><td colspan="9">${remitoTimelineHTML(r, R)}</td></tr>` : "");
  };

  return `
  <div class="head">
    <div class="title">
      <h2>${t("nav.remitos")}</h2>
      <p>${t("rem.sub")}</p>
    </div>
  </div>
  <div class="panel">
    <div class="phead"><h3>${t("rem.issued")}</h3><span class="hint">${all.length} total · ${uCount} U · ${aCount} A${abiertos?` · ${t("rem.openship",{n:abiertos})}`:""}</span></div>
    ${all.length ? `
    <div class="filtros">
      <input class="inp" id="rmq" placeholder="${t('rem.ph.search')}" value="${esc(remitoQ)}" style="flex:1 1 180px;min-width:130px">
      ${seg}
      ${filtrando?`<button class="btn ghost sm" id="rmclear">${t("dash.f.clear")}</button>`:""}
      ${filtrando?`<span class="hint" style="font-size:12px;white-space:nowrap">${t("rem.match",{n:list.length})}</span>`:""}
    </div>
    <div class="table-scroll"><table>
      <thead><tr>
        <th>${t("nav.remitos")}</th>
        <th>${t("common.date")}</th>
        <th>${t("rem.th.type")}</th>
        <th>${t("rem.th.from")}</th>
        <th>${t("rem.th.detail")}</th>
        <th>${t("rem.th.status")}</th>
        <th>${t("trk.col")}</th>
        <th class="r">${t("common.units")}</th>
        <th></th>
      </tr></thead>
      <tbody>
      ${list.map(rowHTML).join("") || `<tr><td colspan="9" style="text-align:center;color:var(--muted);padding:18px">${t("rem.nomatch")}</td></tr>`}
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
  const cl=m.querySelector("#rmclear"); if(cl) cl.onclick=()=>{ remitoQ=""; remitoEstadoF=""; render(); };
  m.querySelectorAll("[data-rmst]").forEach(b=> b.onclick=()=>{ remitoEstadoF=b.dataset.rmst||""; render(); });
  m.querySelectorAll("[data-rmtl]").forEach(b=> b.onclick=()=>{ const k=b.dataset.rmtl; remitoTimelineOpen[k]=!remitoTimelineOpen[k]; render(); });
  m.querySelectorAll("[data-rmrecv]").forEach(b=> b.onclick=()=>{
    if(typeof openRecibirEnvio==="function") openRecibirEnvio(b.dataset.rmrecv);
  });
  m.querySelectorAll("[data-rmtrk]").forEach(b=> b.onclick=()=> openEditarTracking(b.dataset.rmtrk));
  m.querySelectorAll("[data-rmdoc]").forEach(b=> b.onclick=()=>{
    if(typeof generarRemitoDocPDF==="function") generarRemitoDocPDF(b.dataset.rmdoc);
    else toast(t("rem.tt.nopdf"),"warn");
  });
}
