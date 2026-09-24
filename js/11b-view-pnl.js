/* ============================================================
   gestordestock — 11b-view-pnl.js
   Se carga DESPUÉS de 11-view-analisis.js (usa pnlAggregate /
   pnlWaterfallSVG / trendChartSVG / _pnlCompact).
   ------------------------------------------------------------
   Pestaña P&L (Estado de resultados). Bilingüe. Admin-only.
   Incluye: waterfall, tendencia, KPIs con delta vs período previo
   (#12), tabla por vendedor con drill-down a sus ventas (#14) y
   panel Real vs Presupuesto (#17).
   ============================================================ */
let pnlPeriodo = "ytd";   // mtd | qtd | ytd | all
let pnlDrill   = null;    // vendedorId expandido en la tabla (drill-down)

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

/* Ventana anterior de igual duración (para los deltas de KPI, #12). */
function pnlPriorRange(r){
  if(!r.from || !r.to) return null;
  const a=new Date(r.from+"T00:00:00"), b=new Date(r.to+"T00:00:00");
  const days=Math.round((b-a)/86400000)+1;
  const pb=new Date(a); pb.setDate(pb.getDate()-1);
  const pa=new Date(pb); pa.setDate(pa.getDate()-(days-1));
  const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  return { from:iso(pa), to:iso(pb) };
}

/* Chip de variación vs período previo. */
function pnlDeltaChip(cur, prev){
  if(prev==null || prev===0) return `<div class="sub" style="margin-top:4px">${t("pnl.delta.noprior")}</div>`;
  const d=(cur-prev)/Math.abs(prev), up=d>=0;
  return `<div class="sub" style="margin-top:4px;color:${up?"var(--up)":"var(--alert)"};font-weight:700">${up?"▲":"▼"} ${nf0.format(Math.abs(d)*100)}% <span style="color:var(--muted);font-weight:400">${t("pnl.delta.vsprior")}</span></div>`;
}

/* Presupuesto del período (#17): suma de objetivos mensuales (USD). */
function pnlBudget(from, to){
  const b=db.config.presupuesto||{};
  const fromM=from?from.slice(0,7):"0000-00", toM=to?to.slice(0,7):"9999-99";
  let net=0, contrib=0, any=false;
  Object.keys(b).forEach(k=>{ const e=b[k]||{}; if(k>=fromM && k<=toM){ net+=(+e.net||0); contrib+=(+e.contrib||0); if((+e.net||0)||(+e.contrib||0)) any=true; } });
  return { net:round2(net), contrib:round2(contrib), any };
}

/* Ventas de un vendedor en el período (drill-down, #14), en USD. */
function pnlSellerSales(vid, from, to){
  const d0=from?new Date(from+"T00:00:00"):null, d1=to?new Date(to+"T23:59:59"):null;
  const out=[];
  (db.ventas||[]).forEach(v=>{
    if((v.vendedorId||"")!==vid) return;
    if(!effectiveStores().includes(storeDeVenta(v))) return;   // foco por depósito
    const f=normISO(v.fecha)||v.fecha, fd=new Date(f+"T12:00:00");
    if(d0&&fd<d0) return; if(d1&&fd>d1) return;
    (v.lineas||[]).forEach(l=>{
      const rev=round2((l.precio||0)*l.cantidad);
      const cg =round2(l.cogs!=null?l.cogs:(l.costo||0)*l.cantidad);
      out.push({ fecha:f, nombre:l.nombre||l.sku||"—", qty:l.cantidad, revenue:rev, margin:round2(rev-cg) });
    });
  });
  return out.sort((a,b)=> a.fecha<b.fecha?1:-1);
}

function viewPnL(){
  const r  = pnlRange(pnlPeriodo);
  const P  = pnlAggregate(r.from, r.to, effectiveStores());
  const pr = pnlPriorRange(r);
  const Pp = pr ? pnlAggregate(pr.from, pr.to, effectiveStores()) : null;
  const B  = pnlBudget(r.from, r.to);
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
      <div class="sub">${t("pnl.kpi.contribsub",{p:pctNet})}</div>
      ${pnlDeltaChip(P.contrib, Pp?Pp.contrib:null)}</div>
    <div class="kpi"><div class="lbl">${t("pnl.kpi.net")}</div><div class="val">${money(P.net)}</div>${pnlDeltaChip(P.net, Pp?Pp.net:null)}</div>
    <div class="kpi"><div class="lbl">${t("pnl.kpi.gross")}</div><div class="val">${money(P.gp)}</div><div class="sub">${P.net>0?nf0.format(P.gpPct*100)+"%":"—"} · ${t("pnl.kpi.grosssub")}</div></div>
    <div class="kpi"><div class="lbl">${t("pnl.kpi.cogs")}</div><div class="val">${money(P.cogs)}</div><div class="sub">${t("pnl.kpi.cogssub",{n:qty(P.units)})}</div></div>
  </div>`;

  const waterfall = `
  <div class="panel chart" style="grid-column:1/-1;margin-bottom:16px">
    <p class="ctitle">${t("pnl.wf.title")}</p>
    <p class="csub">${t("pnl.wf.sub")}</p>
    ${P.units ? `<div style="overflow-x:auto;-webkit-overflow-scrolling:touch">${pnlWaterfallSVG(P)}</div>` : `<div class="cempty">${t("pnl.nodata")}</div>`}
  </div>`;

  // Real vs presupuesto (#17)
  const varRow=(label,act,bud)=>{ const d=act-bud, up=d>=0;
    return `<tr><td>${label}</td><td class="r num">${money(act)}</td><td class="r num">${money(bud)}</td>
      <td class="r num" style="color:${up?"var(--up)":"var(--alert)"};font-weight:700">${up?"▲":"▼"} ${money(Math.abs(d))} ${bud!==0?"("+nf0.format(Math.abs(d/bud)*100)+"%)":""}</td></tr>`; };
  const variance = `
  <div class="panel" style="margin-top:16px">
    <div class="phead"><h3>${t("pnl.var.title")}</h3></div>
    <div style="padding:16px 18px">
    ${B.any ? `<div class="table-scroll"><table>
      <thead><tr><th></th><th class="r">${t("pnl.var.actual")}</th><th class="r">${t("pnl.var.budget")}</th><th class="r">${t("pnl.var.variance")}</th></tr></thead>
      <tbody>${varRow(t("pnl.kpi.net"),P.net,B.net)}${varRow(t("pnl.kpi.contrib"),P.contrib,B.contrib)}</tbody>
    </table></div>` : `<p class="hint" style="margin:0">${t("pnl.var.nobudget")}</p>`}
    </div>
  </div>`;

  // Tendencia mensual (columnas)
  const months = Object.keys(P.byMonth).sort();
  const trend = months.map(k=>{ const [y,m]=k.split("-"); return { label:`${t("cal.mon."+((+m)-1)).slice(0,3)} ${y.slice(2)}`, value:P.byMonth[k].net }; });

  // Tabla por vendedor con color-code + drill-down (#14)
  const sellerEntries = Object.entries(P.perVend).map(([vid,s])=>{
    const gm=round2(s.sales-s.cogs);
    const contrib=round2(gm + s.cargos + s.shipping - s.commission - s.costos);
    return { vid, nombre:s.nombre||"—", units:s.units, revenue:s.sales, gm, gmPct:s.sales>0?gm/s.sales:0, contrib };
  }).sort((a,b)=> b.contrib - a.contrib);
  const tot = sellerEntries.reduce((a,r)=>({units:a.units+r.units, revenue:a.revenue+r.revenue, gm:a.gm+r.gm, contrib:a.contrib+r.contrib}),{units:0,revenue:0,gm:0,contrib:0});

  const sellerRows = sellerEntries.length ? sellerEntries.map(rw=>{
    const loss=rw.contrib<0, open=pnlDrill===rw.vid;
    let html = `<tr data-pnldrill="${esc(rw.vid)}" style="cursor:pointer;${loss?"background:color-mix(in srgb,var(--alert) 10%,transparent)":""}">
      <td>${open?"▾ ":"▸ "}${esc(rw.nombre)}</td>
      <td class="r num">${qty(rw.units)}</td>
      <td class="r num">${money(rw.revenue)}</td>
      <td class="r num">${money(rw.gm)}</td>
      <td class="r num" style="color:${rw.gm>=0?"var(--up)":"var(--alert)"}">${rw.revenue>0?nf0.format(rw.gmPct*100)+"%":"—"}</td>
      <td class="r num" style="color:${loss?"var(--alert)":"var(--up)"};font-weight:700">${loss?"▼":"▲"} ${money(rw.contrib)}</td>
    </tr>`;
    if(open){
      const sales=pnlSellerSales(rw.vid, r.from, r.to);
      const inner = sales.length ? sales.map(x=>`<tr>
          <td class="num">${esc(fmtDate(x.fecha))}</td><td>${esc(x.nombre)}</td>
          <td class="r num">${qty(x.qty)}</td><td class="r num">${money(x.revenue)}</td>
          <td class="r num" style="color:${x.margin>=0?"var(--up)":"var(--alert)"}">${money(x.margin)}</td>
        </tr>`).join("") : `<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:12px">${t("pnl.nodata")}</td></tr>`;
      html += `<tr><td colspan="6" style="padding:0;background:var(--surface-2)"><div style="padding:6px 12px 10px">
        <table style="width:100%"><thead><tr>
          <th>${t("pnl.drill.date")}</th><th>${t("pnl.drill.product")}</th><th class="r">${t("pnl.drill.qty")}</th><th class="r">${t("pnl.th.revenue")}</th><th class="r">${t("pnl.drill.margin")}</th>
        </tr></thead><tbody>${inner}</tbody></table>
      </div></td></tr>`;
    }
    return html;
  }).join("") : `<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:18px">${t("pnl.nodata")}</td></tr>`;

  const grid = `
  <div class="chart-grid">
    <div class="panel chart">
      <p class="ctitle">${t("pnl.trend.title")}</p>
      <p class="csub">${t("pnl.trend.sub")}</p>
      ${trend.length ? trendChartSVG(trend, money, "var(--accent)") : `<div class="cempty">${t("pnl.nodata")}</div>`}
    </div>
    <div class="panel chart">
      <p class="ctitle">${t("pnl.byseller.title")}</p>
      <p class="csub">${t("pnl.byseller.sub")} · ${t("pnl.drill.hint")}</p>
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

  return head + kpis + waterfall + variance + grid + finPanelHTML(P, r.from, r.to) + notes;
}

function wirePnL(){
  const m = document.getElementById("main");
  if(!m) return;
  m.querySelectorAll("[data-pnlp]").forEach(b=> b.onclick=()=>{ pnlPeriodo=b.dataset.pnlp; pnlDrill=null; render(); });
  m.querySelectorAll("[data-pnldrill]").forEach(tr=> tr.onclick=()=>{ const v=tr.dataset.pnldrill; pnlDrill=(pnlDrill===v)?null:v; render(); });
  const ex = document.getElementById("pnl_export");
  if(ex) ex.onclick=()=>{ const r=pnlRange(pnlPeriodo); exportPnL(r.from||"", r.to||""); };
  wireFinPanel();   // resultado + costos financieros
}
