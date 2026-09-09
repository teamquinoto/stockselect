/* ============================================================
   gestordestock — 12-view-investments.js
   Parte de la app. Se carga como <script> en el ORDEN del index.html.
   Todo vive en scope global (sin módulos), igual que antes.
   ============================================================ */
/* ============================================================
   VIEW: Investments vault (point 5) — admin only
   Products held as an executive decision NOT to sell. They leave the
   sellable inventory and are booked as investment at purchase cost.
   Future: will connect to the company-wide portfolio.
   ============================================================ */
function viewInversiones(){
  const items = db.productos.filter(esInversion);
  const totalCosto = items.reduce((a,p)=> a + invValor(p), 0);
  const totalUn = items.reduce((a,p)=> a + invUnits(p), 0);
  const rows = items.map(p=>{
    const un = invUnits(p), cost = invValor(p);
    return `<tr data-ficha="${p.id}" style="cursor:pointer">
      <td><span class="sku">${esc(p.sku||"—")}</span></td>
      <td>${esc(p.nombre)} <span class="pill inv">investment</span></td>
      <td class="c">${esc(langLabel(p.idioma))}</td>
      <td class="r num">${qty(un)}</td>
      <td class="r num">${money(un>0?cost/un:0, "USD")}</td>
      <td class="r num">${money(cost, "USD")}</td>
      <td class="r"><button class="btn ghost sm" data-invret="${p.id}">◈ Return</button></td>
    </tr>`;
  }).join("");
  return `
  <div class="head">
    <div class="title"><h2>Investments</h2><p>Executive-hold vault. Booked at FIFO purchase cost — outside the sellable inventory. Admin only.</p></div>
  </div>
  <div class="kpis">
    <div class="kpi"><div class="lbl">Items in vault</div><div class="val">${items.length}</div><div class="sub">held SKUs</div></div>
    <div class="kpi"><div class="lbl">Units</div><div class="val">${qty(totalUn)}</div><div class="sub">held units</div></div>
    <div class="kpi"><div class="lbl">Invested (at cost)</div><div class="val">${money(totalCosto, "USD")}</div><div class="sub">FIFO purchase cost</div></div>
    <div class="kpi"><div class="lbl">Portfolio link</div><div class="val">—</div><div class="sub">coming soon</div></div>
  </div>
  <div class="panel">
    <div class="phead"><h3>Held products</h3><span class="hint">open a product and use “◈ To investments” to move units here (pick the quantity per society)</span></div>
    ${items.length ? `<div class="table-scroll"><table>
      <thead><tr><th>SKU</th><th>Product</th><th class="c">Lang</th><th class="r">Units</th><th class="r">Avg cost</th><th class="r">Invested</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table></div>`
      : emptyState("The vault is empty","Open any product from the Dashboard and use “◈ To investments” to move units here, out of the sellable stock.")}
  </div>`;
}

