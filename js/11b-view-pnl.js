/* ============================================================
   gestordestock — 11b-view-pnl.js
   Parte de la app. Se carga como <script> DESPUÉS de 11-view-analisis.js
   (usa pnlAggregate / pnlWaterfallSVG / trendChartSVG / _pnlCompact).
   ------------------------------------------------------------
   Pestaña propia de P&L (Estado de resultados). Bilingüe (t()).
   Vive en la sección "fin", admin-only. Consolidado del período,
   con presets, waterfall, tendencia y tabla por vendedor con
   color-code de negativos + flecha (señal redundante).
   ============================================================ */
let pnlPeriodo = "ytd";   // mtd | qtd | ytd | all

/* Rango del preset, anclado a la venta más reciente (o a hoy). */
function pnlRange(preset){
  let anchor = new Date();
  (db.ventas||[]).forEach(v=>{ const f=new Date((normISO(v.fecha)||v.fecha)+"T12:00:00"); if(!isNaN(f) && f>anchor) anchor=f; });
  const y=anchor.getFullYear(), m=anchor.getMonth();
  const iso=d=> `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  if(preset==="mtd") return { from:iso(new Date(y,m,1)),   to:iso(anchor) };
  if(preset==="qtd") return { from:iso(new Date(y,m-2,1)), to:iso(anchor) };
  if(preset==="ytd") return { from:iso(new Date(y,0,1)),   to:iso(anchor) };
  return { from:"", to:"" };   // all
}

function viewPnL(){
  const r = pnlRange(pnlPeriodo);
  const P = pnlAggregate(r.from, r.to);
  const neg = P.contrib<0;
  const pctNet = P.net>0 ? nf0.format(P.contribPct*100)+"%" : "—";

  const segBtn=(p)=>`<button class="seg-btn ${pnlPeriodo===p?"on":""}" data-pnlp="${p}">${t("pnl.period."+p)}</button>`;
  const head = `
  <div class="head"><div class="title"><h2>${t("pnl.title")}</h2><p>${t("pnl.sub")}</p></div>
    <div class="actions" style="gap:8px">
      <div class="seg">${segBtn("mtd")}${segBtn("qtd")}${segBtn("ytd")}${segBtn("all")}</div>
      ${isAdmin()?`<button class="btn primary" id="pnl_export">${t("pnl.export")}</button>`:""}
    </div>
  </div>`;

  const kpis = `
  <div class="kpis">
    <div class="kpi" style="border-color:color-mix(in srgb,var(--accent) 30%,var(--line));background:linear-gradient(135deg,color-mix(in srgb,var(--accent) 9%,var(--surface)),var(--surface))">
      <div class="lbl">${t("pnl.kpi.contrib")}</div>
      <div class="val" style="color:${neg?"var(--alert)":"var(--text)"}">${money(P.contrib)}</div>
      <div class="sub">${t("pnl.kpi.contribsub",{p:pctNet})}</div></div>
    <div class="kpi"><div class="lbl">${t("pnl.kpi.net")}</div><div class="val">${money(P.net)}</div></div>
    <div class="kpi"><div class="lbl">${t("pnl.kpi.gross")}</div><div class="val">${money(P.gp)}</div><div class="sub">${P.net>0?nf0.format(P.gpPct*100)+"%":"—"} · ${t("pnl.kpi.grosssub")}</div></div>
    <div class="kpi"><div class="lbl">${t("pnl.kpi.cogs")}</div><div class="val">${money(P.cogs)}</div><div class="sub">${t("pnl.kpi.cogssub",{n:qty(P.units)})}</div></div>
  </div>`;

  const waterfall = `
  <div class="panel chart" style="grid-column:1/-1;margin-bottom:16px">
    <p class="ctitle">${t("pnl.wf.title")}</p>
    <p class="csub">${t("pnl.wf.sub")}</p>
    ${P.units ? `<div style="overflow-x:auto;-webkit-overflow-scrolling:touch">${pnlWaterfallSVG(P)}</div>` : `<div class="cempty">${t("pnl.nodata")}</div>`}
  </div>`;

  // Tendencia mensual (columnas) desde P.byMonth (ingreso neto por mes).
  const months = Object.keys(P.byMonth).sort();
  const trend = months.map(k=>{ const [y,m]=k.split("-"); return { label:`${t("cal.mon."+((+m)-1)).slice(0,3)} ${y.slice(2)}`, value:P.byMonth[k].net }; });

  // Tabla por vendedor: contribución con color-code + flecha redundante.
  const sellers = Object.values(P.perVend).map(s=>{
    const gm = round2(s.sales - s.cogs);
    const contrib = round2(gm + s.cargos + s.shipping - s.commission - s.costos);
    return { nombre:s.nombre||"—", units:s.units, revenue:s.sales, gm, gmPct: s.sales>0?gm/s.sales:0, contrib };
  }).sort((a,b)=> b.contrib - a.contrib);
  const tot = sellers.reduce((a,r)=>({units:a.units+r.units, revenue:a.revenue+r.revenue, gm:a.gm+r.gm, contrib:a.contrib+r.contrib}),{units:0,revenue:0,gm:0,contrib:0});
  const sellerRows = sellers.length ? sellers.map(rw=>{
    const loss = rw.contrib<0;
    return `<tr style="${loss?"background:color-mix(in srgb,var(--alert) 10%,transparent)":""}">
      <td>${esc(rw.nombre)}</td>
      <td class="r num">${qty(rw.units)}</td>
      <td class="r num">${money(rw.revenue)}</td>
      <td class="r num">${money(rw.gm)}</td>
      <td class="r num" style="color:${rw.gm>=0?"var(--up)":"var(--alert)"}">${rw.revenue>0?nf0.format(rw.gmPct*100)+"%":"—"}</td>
      <td class="r num" style="color:${loss?"var(--alert)":"var(--up)"};font-weight:700">${loss?"▼":"▲"} ${money(rw.contrib)}</td>
    </tr>`;
  }).join("") : `<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:18px">${t("pnl.nodata")}</td></tr>`;

  const grid = `
  <div class="chart-grid">
    <div class="panel chart">
      <p class="ctitle">${t("pnl.trend.title")}</p>
      <p class="csub">${t("pnl.trend.sub")}</p>
      ${trend.length ? trendChartSVG(trend, money) : `<div class="cempty">${t("pnl.nodata")}</div>`}
    </div>
    <div class="panel chart">
      <p class="ctitle">${t("pnl.byseller.title")}</p>
      <p class="csub">${t("pnl.byseller.sub")}</p>
      <div class="table-scroll"><table>
        <thead><tr>
          <th>${t("pnl.th.seller")}</th><th class="r">${t("pnl.th.units")}</th><th class="r">${t("pnl.th.revenue")}</th>
          <th class="r">${t("pnl.th.gross")}</th><th class="r">${t("pnl.th.marginpct")}</th><th class="r">${t("pnl.th.contrib")}</th>
        </tr></thead>
        <tbody>${sellerRows}</tbody>
        <tfoot><tr style="border-top:2px solid var(--line-strong);font-weight:800">
          <td>Total</td><td class="r num">${qty(tot.units)}</td><td class="r num">${money(tot.revenue)}</td>
          <td class="r num">${money(tot.gm)}</td><td class="r num">${tot.revenue>0?nf0.format((tot.gm/tot.revenue)*100)+"%":"—"}</td>
          <td class="r num" style="color:${tot.contrib<0?"var(--alert)":"var(--up)"}">${money(tot.contrib)}</td>
        </tr></tfoot>
      </table></div>
    </div>
  </div>`;

  const notes = `<p class="csub" style="margin-top:14px;line-height:1.6">${t("pnl.notes")}</p>`;

  return head + kpis + waterfall + grid + notes;
}

function wirePnL(){
  const m = document.getElementById("main");
  if(!m) return;
  m.querySelectorAll("[data-pnlp]").forEach(b=> b.onclick=()=>{ pnlPeriodo=b.dataset.pnlp; render(); });
  const ex = document.getElementById("pnl_export");
  if(ex) ex.onclick=()=>{ const r=pnlRange(pnlPeriodo); exportPnL(r.from||"", r.to||""); };
}
