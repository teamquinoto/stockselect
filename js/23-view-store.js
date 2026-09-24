/* ============================================================
   gestordestock — 23-view-store.js
   Part of the app. Loaded as a <script> in the ORDER from index.html,
   AFTER 18-view-conjunta.js (reuses rielHTML / RL_ICONS / CONSIGN_ESTADOS).
   ------------------------------------------------------------
   Read-only portal for STORE users (role "store"). A store is an AR
   customer flagged in the backend; on login the Worker returns
   session.store = that customer's id (terceroId). Here they see ONLY
   their own merchandise (terceroId === session.store) traveling US -> AR
   and which gate of the journey each shipment is at. No actions.
   ============================================================ */

/* The store's own consignment lines, grouped by shipment (remito U / ref). */
function storeShipments(){
  const cid = storeClienteId();
  if(!cid) return [];
  const mine = (typeof consignAll==="function" ? consignAll() : []).filter(cs=> cs.terceroId===cid);
  const map = {};
  mine.forEach(cs=>{
    const key = cs.remitoId || cs.remitoCodigo || cs.envioRef || cs.id;
    if(!map[key]) map[key] = { key, remitoId: cs.remitoId||null, codigo: cs.remitoCodigo||cs.envioRef||"", fecha: cs.fecha||"", lineas:[] };
    map[key].lineas.push(cs);
  });
  return Object.keys(map).map(k=>map[k]).sort((a,b)=> String(b.fecha||"").localeCompare(String(a.fecha||"")));
}
/* Current gate of a shipment: 0 in transit, 1 in AR, 2 delivered. */
function storeGate(g){
  const st = g.lineas.map(l=>l.estado);
  if(st.some(e=> e===CONSIGN_ESTADOS.TRANSITO)) return 0;
  if(st.some(e=> e===CONSIGN_ESTADOS.AR)) return 1;
  return 2;
}
function storeShipmentCard(g){
  const u = g.lineas.reduce((a,l)=> a+(l.cantidad||0), 0);
  const cur = storeGate(g);
  const nodes = [
    {icon:"plane", label:t("store.gate.transit")},
    {icon:"pin",   label:t("store.gate.ar")},
    {icon:"store", label:t("store.gate.delivered")}
  ];
  const rows = g.lineas.map(l=>`<tr>
      <td><span class="sku">${esc(l.sku||"\u2014")}</span></td>
      <td>${esc(l.nombre)}</td>
      <td class="r num">${qty(l.cantidad)}</td>
    </tr>`).join("");
  return `<div class="rl-card">
    <div class="rl-head">
      <span class="rl-code">${g.codigo?esc(g.codigo):t("store.shipment")}</span>
      <span class="rl-meta">${esc(fmtDate(g.fecha))} \u00b7 ${g.lineas.length} ${t("store.products")} \u00b7 ${qty(u)} ${t("store.units")}</span>
    </div>
    ${(()=>{ const r = g.remitoId ? remitoById(g.remitoId) : null;   // tracking del envío (el Worker sólo manda carrier + número)
      return r && r.tracking ? `<div class="rl-meta" style="margin:2px 0 8px">${t("store.tracking")}: ${trackingHTML(r)}</div>` : ""; })()}
    ${rielHTML(nodes, cur)}
    <div class="table-scroll" style="margin-top:6px"><table>
      <thead><tr><th>SKU</th><th>${t("common.product")}</th><th class="r">${t("common.units")}</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
  </div>`;
}
function viewStore(){
  if(typeof ensureRielCSS==="function") ensureRielCSS();
  const head = `<div class="head"><div class="title"><h2>${t("store.title")}</h2>
    <p>${t("store.sub")} <span class="rl-badge third" style="margin-left:6px">${t("store.readonly")}</span></p></div></div>`;
  if(!storeClienteId()) return head + `<div class="panel"><div class="rl-empty">${t("store.noacct")}</div></div>`;

  const ships = storeShipments();
  const inflight  = ships.filter(g=> storeGate(g)<2);
  const delivered = ships.filter(g=> storeGate(g)===2);
  const cards = inflight.map(storeShipmentCard).join("") || `<div class="rl-empty">${t("store.empty")}</div>`;

  let out = head + `<div class="panel"><div class="rl-wrap">${cards}</div></div>`;
  if(delivered.length){
    const dr = delivered.map(g=>{
      const u = g.lineas.reduce((a,l)=> a+(l.cantidad||0), 0);
      return `<tr><td>${esc(fmtDate(g.fecha))}</td><td>${g.codigo?esc(g.codigo):"\u2014"}</td><td class="r num">${qty(u)}</td></tr>`;
    }).join("");
    out += `<div class="panel" style="margin-top:16px">
      <div class="phead"><h3>${t("store.delivered.title")}</h3></div>
      <div class="table-scroll"><table>
        <thead><tr><th>${t("common.date")}</th><th>${t("store.shipment")}</th><th class="r">${t("common.units")}</th></tr></thead>
        <tbody>${dr}</tbody></table></div></div>`;
  }
  return out;
}
