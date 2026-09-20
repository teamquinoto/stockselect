/* ============================================================
   gestordestock — 11-view-analisis.js
   Parte de la app. Se carga como <script> en el ORDEN del index.html.
   Todo vive en scope global (sin módulos), igual que antes.
   ============================================================ */
/* ============================================================
   VISTA: Análisis (gráficos, sin librerías)
   ============================================================ */
/* Barras horizontales: items=[{label, sku, value}], fmt=formateador, color=CSS var */
function hbars(items, fmt, color){
  const vals = items.filter(i=> i.value>0);
  if(!vals.length) return `<div class="cempty">${t("an.nodata")}</div>`;
  const max = Math.max(...vals.map(i=>i.value)) || 1;
  return vals.map(i=>{
    const pct = Math.max(2, (i.value/max)*100);
    const c = i.color || color;
    const chip = i.sku ? `<span class="sku">${esc(i.sku)}</span> ` : "";
    const full = (i.sku?("["+i.sku+"] "):"") + i.label;
    const attr = i.saga ? ` data-saga="${esc(i.saga)}"` : "";
    return `<div class="crow"${attr}>
      <div class="cl" title="${esc(full)}">${chip}${esc(i.label)}</div>
      <div class="ct"><div class="cf" style="width:${pct.toFixed(1)}%;background:${c}"></div></div>
      <div class="cv">${fmt(i.value)}</div>
    </div>`;
  }).join("");
}

/* Donut interactivo (SVG puro, sin librerías). Click en un segmento o en la
   leyenda -> el centro muestra ese importe y su %. `cid` debe ser único por
   gráfico. Usa el truco de r=15.915 (circunferencia ≈ 100) para que el
   stroke-dasharray sea directamente el porcentaje. */
const DONUT_COLORS = ["#2563eb","#2dbd8f","#8a5cf6","#f0a935","#f16a68","#2b8fd9","#e069b6","#7c8b9a"];
function donut(cid, items, fmt){
  const data = items.filter(i=> i.value>0).sort((a,b)=> b.value-a.value);
  if(!data.length) return `<div class="cempty">${t("an.nodata")}</div>`;
  const total = data.reduce((a,i)=> a+i.value, 0);
  let cum = 0;
  const segs = data.map((i,idx)=>{
    const pct = total>0 ? (i.value/total*100) : 0;
    const off = 25 - cum;                 // recipe: arranca a las 12 en punto
    cum += pct;
    const col = DONUT_COLORS[idx % DONUT_COLORS.length];
    const seg = `<circle class="donut-seg" cx="21" cy="21" r="15.915" fill="none" stroke="${col}" stroke-width="6"
      stroke-dasharray="${pct.toFixed(3)} ${(100-pct).toFixed(3)}" stroke-dashoffset="${off.toFixed(3)}"
      data-idx="${idx}" data-lbl="${esc(i.label)}" data-vfmt="${esc(fmt(i.value))}" data-pct="${pct.toFixed(1)}"></circle>`;
    return { seg, col, pct, i, idx };
  });
  const totStr = fmt(total);
  const svg = `<svg class="donut-svg" viewBox="0 0 42 42" data-donut="${esc(cid)}" data-totfmt="${esc(totStr)}">
    <circle cx="21" cy="21" r="15.915" fill="none" stroke="var(--surface-2)" stroke-width="6"></circle>
    ${segs.map(s=>s.seg).join("")}
    <text x="21" y="20.6" text-anchor="middle" font-size="${donutFit(totStr)}" class="donut-ctr-val" data-ctrval="1">${esc(totStr)}</text>
    <text x="21" y="24.4" text-anchor="middle" font-size="2.1" class="donut-ctr-lbl" data-ctrlbl="1">${t("common.total")}</text>
  </svg>`;
  const legend = `<div class="donut-legend">${segs.map(s=>`
    <div class="donut-leg" data-donut="${esc(cid)}" data-idx="${s.idx}">
      <span class="sw" style="background:${s.col}"></span>
      <span class="lg-lbl" title="${esc(s.i.label)}">${esc(s.i.label)}</span>
      <span class="lg-val">${esc(fmt(s.i.value))}</span>
      <span class="lg-pct">${s.pct.toFixed(0)}%</span>
    </div>`).join("")}</div>`;
  return `<div class="donut-wrap">${svg}${legend}</div>`;
}
/* El texto del centro del donut vive en un viewBox de 42u y el agujero tiene ~22u
   de ancho útil. Un font-size fijo hace que valores largos ("USD 13.470,00") se
   desborden. Este helper calcula el tamaño para que SIEMPRE entre: estima el ancho
   del texto (~0.58u por caracter a font-size 1) y lo ajusta al ancho disponible. */
function donutFit(str){
  const s = String(str||"");
  const AVAIL = 21;            // ancho útil dentro del agujero (deja aire a los lados)
  const CHARW = 0.58;         // ancho aprox. de un caracter, relativo al font-size
  const ideal = AVAIL / (Math.max(1, s.length) * CHARW);
  return Math.max(1.7, Math.min(3.6, ideal)).toFixed(2);   // nunca más chico de 1.7 ni más grande de 3.6
}
/* Cada render rearma la lista de "limpiadores": funciones que devuelven un
   donut a su estado neutro (centro = total, sin segmento activo). El listener
   global de más abajo las usa para deseleccionar al tocar fuera del gráfico. */
let DONUT_CLEARERS = [];
function wireDonuts(){
  DONUT_CLEARERS = [];
  document.querySelectorAll('#main svg[data-donut]').forEach(svg=>{
    const ctrVal = svg.querySelector('[data-ctrval]');
    const ctrLbl = svg.querySelector('[data-ctrlbl]');
    const totFmt = svg.dataset.totfmt;
    const legend = svg.parentElement.querySelector('.donut-legend');
    let active = null;
    const setCtr = (txt)=>{ ctrVal.textContent = txt; ctrVal.setAttribute('font-size', donutFit(txt)); };
    const paint = ()=>{
      const hasActive = active!=null;
      svg.classList.toggle('has-active', hasActive);
      svg.querySelectorAll('.donut-seg').forEach(s=> s.classList.toggle('on', +s.dataset.idx===active));
      if(legend) legend.querySelectorAll('.donut-leg').forEach(l=> l.classList.toggle('on', +l.dataset.idx===active));
      if(hasActive){
        const seg = svg.querySelector('.donut-seg[data-idx="'+active+'"]');
        setCtr(seg.dataset.vfmt);
        ctrLbl.textContent = seg.dataset.pct + '% · ' + seg.dataset.lbl;
      } else {
        setCtr(totFmt);
        ctrLbl.textContent = t("common.total");
      }
    };
    const apply = (idx)=>{ active = (active===idx) ? null : idx; paint(); };
    const clear = ()=>{ if(active!=null){ active=null; paint(); } };
    // registramos el limpiador de este donut (para el click afuera / Escape)
    DONUT_CLEARERS.push(clear);
    svg.querySelectorAll('.donut-seg').forEach(s=> s.onclick=(e)=>{ e.stopPropagation(); apply(+s.dataset.idx); });
    if(legend) legend.querySelectorAll('.donut-leg').forEach(l=> l.onclick=(e)=>{ e.stopPropagation(); apply(+l.dataset.idx); });
  });
}
/* Limpia TODOS los donuts de la vista de una sola pasada. */
function clearAllDonuts(){ DONUT_CLEARERS.forEach(fn=>{ try{ fn(); }catch(e){} }); }
/* Listener global (se instala una única vez): un click en cualquier lado que NO
   caiga sobre un gráfico (ni su leyenda) devuelve todo a la normalidad. Idem Esc.
   Los clicks dentro de un segmento/leyenda ya frenan la propagación arriba, así
   que acá sólo llegan los clicks "de afuera". */
if(!window.__donutOutsideWired){
  window.__donutOutsideWired = true;
  document.addEventListener('click', (e)=>{
    if(e.target.closest && e.target.closest('.donut-wrap')) return; // click dentro: no tocar
    clearAllDonuts();
  });
  document.addEventListener('keydown', (e)=>{ if(e.key==='Escape') clearAllDonuts(); });
}

/* Analysis slicers (point 7). Store comes from the global switcher (activeStore). */
let anFiltros = { vend:"", saga:"", idioma:"", pais:"", desde:"", hasta:"" };
let anMetric = "usd";   // "usd" | "units"  (punto 20: toggle de métrica en los gráficos)
/* Distinct customer countries seen in sales (for the country slicer). */
function paisesVentas(){
  const set=new Set();
  db.ventas.forEach(v=>{ const c=(v.cliente&&v.cliente.pais)||""; if(c) set.add(c); });
  return [...set].sort();
}
/* Sales filtered by the active store focus + analysis slicers. Returns rows
   flattened to the line level with product, store, price, COGS and margin. */
function ventasFiltradas(){
  const desde = anFiltros.desde ? new Date(anFiltros.desde+"T00:00:00") : null;
  const hasta = anFiltros.hasta ? new Date(anFiltros.hasta+"T23:59:59") : null;
  const rows=[];
  const rep = reportCcy();
  db.ventas.forEach(v=>{
    // Análisis es admin-only: se ven todas las ventas. Cada venta puede estar en
    // una moneda distinta (Swan USD / Select ARS): convertimos a la moneda de
    // reporte al armar la fila, así todos los agregados suman en una sola moneda.
    if(anFiltros.vend && (v.vendedorId||"")!==anFiltros.vend) return;
    if(anFiltros.pais && ((v.cliente&&v.cliente.pais)||"")!==anFiltros.pais) return;
    const f=new Date(v.fecha+"T12:00:00");
    if(desde && f<desde) return;
    if(hasta && f>hasta) return;
    const sCcy = storeCcy(v.storeVenta||v.store||STORE_IDS[0]);
    v.lineas.forEach(l=>{
      const p=prodById(l.productoId);
      if(anFiltros.saga && (p? sagaDe(p): "")!==anFiltros.saga) return;
      if(anFiltros.idioma && (p? (p.idioma||""):"" )!==anFiltros.idioma) return;
      const cogs = l.cogs!=null ? l.cogs : (l.costo||0)*l.cantidad;
      rows.push({ fecha:normISO(v.fecha)||v.fecha, vendedor:saleVendedorNombre(v), vendedorId:v.vendedorId||"", productoId:l.productoId, nombre:l.nombre, sku:l.sku,
        cantidad:l.cantidad, revenue:convertCcyAt(round2((l.precio||0)*l.cantidad), sCcy, rep, normISO(v.fecha)||v.fecha), cogs:convertCcyAt(round2(cogs), sCcy, rep, normISO(v.fecha)||v.fecha),
        ccy:sCcy,
        consumed: (Array.isArray(l.consumed) && l.consumed.length) ? l.consumed : null,
        store: l.store || null,
        pais:(v.cliente&&v.cliente.pais)||"", saga:p?sagaDe(p):"", idioma:p?(p.idioma||""):"" });
    });
  });
  return rows;
}
function viewAnalisis(){
  const rows = ventasFiltradas();
  const revenue = rows.reduce((a,r)=>a+r.revenue,0);
  const cogs = rows.reduce((a,r)=>a+r.cogs,0);
  const margin = round2(revenue-cogs);
  const marginPct = revenue>0 ? (margin/revenue*100) : 0;
  const units = rows.reduce((a,r)=>a+r.cantidad,0);

  // --- aggregations ---
  const by = (keyFn)=>{ const m={}; rows.forEach(r=>{ const k=keyFn(r); if(k==null||k==="") return; (m[k]=m[k]||{revenue:0,cogs:0,units:0}); m[k].revenue+=r.revenue; m[k].cogs+=r.cogs; m[k].units+=r.cantidad; }); return m; };
  const top = (obj, val, n=10)=> Object.entries(obj).map(([k,v])=>({label:k, value:val(v)})).sort((a,b)=>b.value-a.value).slice(0,n);

  const byProd = by(r=>r.nombre);
  const topRev = top(byProd, v=>v.revenue);
  const topMargin = top(byProd, v=>round2(v.revenue-v.cogs));
  const byVend = by(r=>r.vendedor);
  const byPais = by(r=>r.pais);
  const byLang = by(r=>langLabel(r.idioma));

  /* --- Costo y margen POR SOCIEDAD (procedencia del stock vendido) ---
     La venta sale del pool único, pero el consumo FIFO guarda de qué sociedad
     salió cada unidad (l.consumed). Con eso reconstruimos, por sociedad:
     unidades despachadas de su stock, COGS real, costo unitario promedio y el
     margen (asignando el ingreso de cada línea a prorrata de las unidades que
     aportó cada sociedad). El precio de venta es común al pool, así que la
     diferencia de margen entre sociedades es, en esencia, diferencia de costo. */
  const bySoc = {};
  const addSoc = (soc, units, cogsv, rev)=>{
    const k = isStore(soc) ? soc : "—";
    const e = bySoc[k] = bySoc[k] || { units:0, cogs:0, revenue:0 };
    e.units += units; e.cogs = round2(e.cogs + cogsv); e.revenue = round2(e.revenue + rev);
  };
  rows.forEach(r=>{
    const rep2 = reportCcy();
    if(r.consumed){
      const lineUnits = r.cantidad || r.consumed.reduce((a,c)=>a+(c.cantidad||0),0);
      r.consumed.forEach(c=>{
        const cCogs = convertCcyAt(round2((c.costoUnit||0)*(c.cantidad||0)), r.ccy||rep2, rep2, r.fecha);   // costo al TC del mes de la venta
        const cRev  = lineUnits>0 ? round2(r.revenue*((c.cantidad||0)/lineUnits)) : 0;            // r.revenue ya está en reporte
        addSoc(c.sociedad, c.cantidad||0, cCogs, cRev);
      });
    } else {
      // Ventas legacy sin desglose: caen a la sociedad de la línea si existe, o a "—".
      addSoc(r.store || "—", r.cantidad, r.cogs, r.revenue);
    }
  });
  const socOrder = STORE_IDS.concat(Object.keys(bySoc).filter(k=>!isStore(k)));
  const socRows = socOrder.filter(k=>bySoc[k]).map(k=>{
    const e = bySoc[k];
    const mg = round2(e.revenue - e.cogs);
    return { soc:k, nombre: k==="—"?t("an.soc.nobreakdown"):storeName(k), units:e.units, cogs:e.cogs,
             avg: e.units>0 ? round2(e.cogs/e.units) : 0, revenue:e.revenue, margin:mg,
             marginPct: e.revenue>0 ? (mg/e.revenue*100) : 0 };
  });

  // Punto 20: métrica activa (USD o unidades) para los gráficos comparativos
  const mval = anMetric==="units" ? (v=>v.units) : (v=>v.revenue);
  const mfmt = anMetric==="units" ? qty : money;

  // Tendencia mensual (dimensión tiempo que faltaba): revenue por mes en la selección
  const byMonth = {};
  rows.forEach(r=>{ const k=(r.fecha||"").slice(0,7); if(!k) return; (byMonth[k]=byMonth[k]||{revenue:0,units:0}); byMonth[k].revenue+=r.revenue; byMonth[k].units+=r.cantidad; });
  const monthsSorted = Object.keys(byMonth).sort();
  const trend = monthsSorted.map(k=>{ const [y,m]=k.split("-"); return { label:`${t("cal.mon."+((+m)-1)).slice(0,3)} ${y.slice(2)}`, value: anMetric==="units"?byMonth[k].units:byMonth[k].revenue }; });

  // --- Punto 2/6: rendimiento por vendedor (unidades, revenue, margen FIFO) ---
  const vendPerf = Object.entries(byVend)
    .map(([k,v])=>({ nombre:k, units:v.units, revenue:round2(v.revenue), margin:round2(v.revenue-v.cogs),
                     marginPct: v.revenue>0 ? ((v.revenue-v.cogs)/v.revenue*100) : 0 }))
    .sort((a,b)=>b.revenue-a.revenue);

  const kpis = `
  <div class="kpis">
    <div class="kpi"><div class="lbl">${t("an.kpi.revenue")}</div><div class="val">${money(revenue)}</div><div class="sub">${t("an.kpi.unitssold",{n:qty(units)})}</div></div>
    <div class="kpi"><div class="lbl">${t("an.kpi.cogs")}</div><div class="val">${money(cogs)}</div><div class="sub">${t("an.kpi.cogssub")}</div></div>
    <div class="kpi"><div class="lbl">${t("an.kpi.grossmargin")}</div><div class="val">${money(margin)}</div><div class="sub">${t("an.kpi.grosssub")}</div></div>
    <div class="kpi"><div class="lbl">${t("an.kpi.marginpct")}</div><div class="val">${revenue>0?nf0.format(marginPct)+"%":"—"}</div><div class="sub">${t("an.kpi.onrev")}</div></div>
  </div>`;

  const sagas=sagasUnicas(), paises=paisesVentas();
  const slicers = `
  <div class="slicers">
    <div class="slicer"><span>${t("an.sl.seller")}</span><select id="an_vend"><option value="">${t("an.sl.all")}</option>${vendedores().map(v=>`<option value="${esc(v.id)}" ${anFiltros.vend===v.id?"selected":""}>${esc(v.nombre)}</option>`).join("")}</select></div>
    <div class="slicer"><span>${t("an.sl.line")}</span><select id="an_saga"><option value="">${t("an.sl.all")}</option>${sagas.map(s=>`<option value="${esc(s)}" ${anFiltros.saga===s?"selected":""}>${esc(s)}</option>`).join("")}</select></div>
    <div class="slicer"><span>${t("an.sl.language")}</span><select id="an_idioma"><option value="">${t("an.sl.all")}</option>${LANGS.map(([v,l])=>`<option value="${v}" ${anFiltros.idioma===v?"selected":""}>${esc(l)}</option>`).join("")}</select></div>
    <div class="slicer"><span>${t("an.sl.country")}</span><select id="an_pais"><option value="">${t("an.sl.all")}</option>${paises.map(c=>`<option value="${esc(c)}" ${anFiltros.pais===c?"selected":""}>${esc(c)}</option>`).join("")}</select></div>
    <div class="slicer"><span>${t("an.sl.from")}</span><input type="date" id="an_desde" value="${esc(anFiltros.desde)}"></div>
    <div class="slicer"><span>${t("an.sl.to")}</span><input type="date" id="an_hasta" value="${esc(anFiltros.hasta)}"></div>
    <button class="slicer-reset" id="an_clear">${t("an.sl.reset")}</button>
  </div>`;

  const MC = anMetric==="units" ? "var(--metric2)" : "var(--accent)";   // #10: color = métrica (dinero=ámbar, unidades=teal); el margen va siempre en verde
  const charts = `
  <div class="chart-grid">
    <div class="panel chart" style="grid-column:1/-1">
      <p class="ctitle">${t("an.trend.title")}</p>
      <p class="csub">${t("an.trend.sub",{metric:anMetric==="units"?t("an.w.units"):t("an.w.revenue")})}</p>
      ${trend.length ? trendChartSVG(trend, mfmt, MC) : `<div class="cempty">${t("an.nosales")}</div>`}
    </div>
    <div class="panel chart">
      <p class="ctitle">${t("an.top.title",{metric:anMetric==="units"?t("an.w.unitslow"):t("an.w.revenuelow")})}</p>
      <p class="csub">${t("an.top.sub")}</p>
      ${rows.length ? hbars(top(byProd, mval).map(t=>({label:t.label,value:t.value,saga:sagaOfName(t.label)})), mfmt, MC) : `<div class="cempty">${t("an.nosales")}</div>`}
    </div>
    <div class="panel chart">
      <p class="ctitle">${t("an.topmargin.title")}</p>
      <p class="csub">${t("an.topmargin.sub")}</p>
      ${rows.length ? hbars(topMargin, money, "var(--up)") : `<div class="cempty">${t("an.nosales")}</div>`}
    </div>
    <div class="panel chart">
      <p class="ctitle">${t("an.byseller.title",{metric:anMetric==="units"?t("an.w.units"):t("an.w.revenue")})}</p>
      <p class="csub">${t("an.byseller.sub",{m:anMetric==="units"?t("an.w.unitslow"):t("an.w.amount")})}</p>
      ${rows.length ? hbars(top(byVend,mval), mfmt, MC) : `<div class="cempty">${t("an.nosales.short")}</div>`}
    </div>
    <div class="panel chart">
      <p class="ctitle">${t("an.bycountry.title",{metric:anMetric==="units"?t("an.w.units"):t("an.w.revenue")})}</p>
      <p class="csub">${t("an.bycountry.sub",{m:anMetric==="units"?t("an.w.unitslow"):t("an.w.amount")})}</p>
      ${Object.keys(byPais).length ? hbars(top(byPais,mval,8), mfmt, MC) : `<div class="cempty">${t("an.bycountry.empty")}</div>`}
    </div>
    <div class="panel chart">
      <p class="ctitle">${t("an.bylang.title",{metric:anMetric==="units"?t("an.w.units"):t("an.w.revenue")})}</p>
      <p class="csub">${t("an.bylang.sub",{m:anMetric==="units"?t("an.w.unitslow"):t("an.w.amount")})}</p>
      ${Object.keys(byLang).length ? hbars(top(byLang,mval), mfmt, MC) : `<div class="cempty">${t("an.bylang.empty")}</div>`}
    </div>
    <div class="panel chart">
      <p class="ctitle">${t("an.perf.title")}</p>
      <p class="csub">${t("an.perf.sub")}</p>
      ${vendPerf.length ? `<div class="table-scroll"><table>
        <thead><tr><th>${t("an.th.seller")}</th><th class="r">${t("an.th.units")}</th><th class="r">${t("an.th.revenue")}</th><th class="r">${t("an.th.margin")}</th><th class="r">${t("an.th.marginpct")}</th></tr></thead>
        <tbody>${vendPerf.map(r=>`<tr><td>${esc(r.nombre)}</td><td class="r num">${qty(r.units)}</td><td class="r num">${money(r.revenue)}</td><td class="r num">${money(r.margin)}</td><td class="r num">${r.revenue>0?nf0.format(r.marginPct)+"%":"—"}</td></tr>`).join("")}</tbody>
      </table></div>` : `<div class="cempty">${t("an.nosales")}</div>`}
    </div>
    ${STORE_IDS.length>1 ? `<div class="panel chart" style="grid-column:1/-1">
      <p class="ctitle">${t("an.soc.title")}</p>
      <p class="csub">${t("an.soc.sub")}</p>
      ${socRows.length ? `<div class="table-scroll"><table>
        <thead><tr><th>${t("an.soc.society")}</th><th class="r">${t("an.soc.unitssold")}</th><th class="r">${t("an.soc.cogs")}</th><th class="r">${t("an.soc.avgcost")}</th><th class="r">${t("an.soc.revenue")}</th><th class="r">${t("an.soc.margin")}</th><th class="r">${t("an.soc.marginpct")}</th></tr></thead>
        <tbody>${socRows.map(r=>`<tr><td>${esc(r.nombre)}</td><td class="r num">${qty(r.units)}</td><td class="r num">${money(r.cogs)}</td><td class="r num">${money(r.avg)}</td><td class="r num">${money(r.revenue)}</td><td class="r num">${money(r.margin)}</td><td class="r num">${r.revenue>0?nf0.format(r.marginPct)+"%":"—"}</td></tr>`).join("")}</tbody>
        <tfoot><tr><td><b>${t("an.soc.total")}</b></td><td class="r num"><b>${qty(units)}</b></td><td class="r num"><b>${money(cogs)}</b></td><td class="r num">—</td><td class="r num"><b>${money(revenue)}</b></td><td class="r num"><b>${money(margin)}</b></td><td class="r num"><b>${revenue>0?nf0.format(marginPct)+"%":"—"}</b></td></tr></tfoot>
      </table></div><p class="csub" style="margin-top:8px">${t("an.soc.foot")}</p>` : `<div class="cempty">${t("an.nosales")}</div>`}
    </div>` : ""}
  </div>`;

  return `
  <div class="head"><div class="title"><h2>${t("an.title")}</h2><p>${t("an.sub")}</p></div>
    <div class="actions" style="gap:8px">
      <div class="seg"><button class="seg-btn ${anMetric==="usd"?"on":""}" data-metric="usd">${t("an.metric.usd")}</button><button class="seg-btn ${anMetric==="units"?"on":""}" data-metric="units">${t("an.metric.units")}</button></div>
      ${isAdmin()?`<button class="btn primary" id="an_pnl">${t("an.exportpnl")}</button>`:""}
    </div>
  </div>
  ${slicers}
  ${kpis}
  ${charts}`;
}
function wireAnalisis(){
  const s=document.getElementById("an_saga"); if(!s) return;
  const upd=(k,el)=>{ anFiltros[k]=el.value; render(); };
  const vsel=document.getElementById("an_vend"); if(vsel) vsel.onchange=e=>upd("vend",e.target);
  s.onchange=e=>upd("saga",e.target);
  document.getElementById("an_idioma").onchange=e=>upd("idioma",e.target);
  document.getElementById("an_pais").onchange=e=>upd("pais",e.target);
  document.getElementById("an_desde").onchange=e=>upd("desde",e.target);
  document.getElementById("an_hasta").onchange=e=>upd("hasta",e.target);
  document.getElementById("an_clear").onclick=()=>{ anFiltros={vend:"",saga:"",idioma:"",pais:"",desde:"",hasta:""}; render(); };
  const pnl=document.getElementById("an_pnl"); if(pnl) pnl.onclick=openPnLExport;
  // Punto 20: toggle USD/Units
  document.querySelectorAll("[data-metric]").forEach(b=> b.onclick=()=>{ anMetric=b.dataset.metric; render(); });
  // Punto 20: barras de producto clickeables -> filtran su línea (saga)
  document.querySelectorAll('#main .crow[data-saga]').forEach(el=>{
    el.style.cursor="pointer"; el.title=t("an.filterline");
    el.onclick=()=>{ const sg=el.dataset.saga; anFiltros.saga = (anFiltros.saga===sg?"":sg); render(); };
  });
  // Punto 5: donuts interactivos (revenue/units por local, país, idioma)
  wireDonuts();
}
/* saga (línea/juego) a partir del nombre de producto mostrado en un gráfico */
function sagaOfName(nombre){
  const p = db.productos.find(x=> String(x.nombre||"")===String(nombre));
  return p ? sagaDe(p) : "";
}


/* ============================================================
   P&L CONSOLIDADO — fuente ÚNICA (la usa el Excel y la pantalla)
   ------------------------------------------------------------
   Recorre db.ventas del rango [desde,hasta] y arma el estado de
   resultados. Dos fixes vs. la versión vieja:
     · cargosCliente (on-top facturado al cliente) SUMA al ingreso;
     · cada venta se valúa al TC de SU mes (convertCcyAt), no a un
       spot único.
   Devuelve importes en la moneda de reporte + desgloses.
   ============================================================ */
let _pnlCache = { rev:-1, map:{} };   // cache de rollups; se limpia cuando cambian los datos (_pnlRev)
function pnlAggregate(desde, hasta){
  // #16: si los datos no cambiaron, reusamos el rollup ya calculado (evita recorrer todas las ventas en cada render).
  const _rev = (typeof _pnlRev!=="undefined") ? _pnlRev : 0;
  if(_pnlCache.rev!==_rev) _pnlCache = { rev:_rev, map:{} };
  const _key = (desde||"")+"|"+(hasta||"")+"|"+reportCcy();
  if(_pnlCache.map[_key]) return _pnlCache.map[_key];
  const d0 = desde ? new Date(desde+"T00:00:00") : null;
  const d1 = hasta ? new Date(hasta+"T23:59:59") : null;
  const inRange = v=>{ const f=new Date((normISO(v.fecha)||v.fecha)+"T12:00:00"); if(d0&&f<d0) return false; if(d1&&f>d1) return false; return true; };
  const rep = reportCcy();
  const A = { rep, sales:0, shipping:0, cargos:0, cogs:0, commission:0,
              costos:{envio:0,labor:0,comision:0,otro:0}, units:0,
              detail:{}, perVend:{}, byMonth:{} };
  (db.ventas||[]).filter(inRange).forEach(v=>{
    const sCcy  = storeCcy(v.storeVenta||v.store||STORE_IDS[0]);
    const fecha = normISO(v.fecha)||v.fecha;
    const conv  = x => convertCcyAt(x, sCcy, rep, fecha);
    const vid   = v.vendedorId || "";
    const pv = A.perVend[vid] = A.perVend[vid] || { nombre:saleVendedorNombre(v), units:0, sales:0, cogs:0, commission:0, cargos:0, shipping:0, costos:0 };
    let sSales=0, sCogs=0, sCostos=0;
    (v.lineas||[]).forEach(l=>{
      const rev = conv(round2((l.precio||0)*l.cantidad));
      const cg  = conv(round2(l.cogs!=null ? l.cogs : (l.costo||0)*l.cantidad));
      A.sales+=rev; A.cogs+=cg; A.units+=l.cantidad; sSales+=rev; sCogs+=cg;
      pv.sales+=rev; pv.cogs+=cg; pv.units+=l.cantidad;
      const k = l.productoId||l.sku||l.nombre;
      const e = A.detail[k] = A.detail[k] || { sku:l.sku||"", nombre:l.nombre||"", units:0, revenue:0, cogs:0 };
      e.units+=l.cantidad; e.revenue+=rev; e.cogs+=cg;
    });
    const ship = (v.envio && v.envio.tipo==="monto") ? conv(round2(v.envio.monto||0)) : 0;
    const carg = conv(saleCargosCliente(v));      // FIX #1: on-top que paga el cliente
    const comm = conv(saleCommission(v));
    A.shipping+=ship; A.cargos+=carg; A.commission+=comm;
    pv.shipping+=ship; pv.cargos+=carg; pv.commission+=comm;
    (v.costosExtra||[]).forEach(c=>{ const k=(c.tipo in A.costos)?c.tipo:"otro"; const m=convertCcyAt(round2(+c.monto||0), c.ccy||sCcy, rep, fecha); A.costos[k]+=m; pv.costos+=m; sCostos+=m; });
    const mk = fecha.slice(0,7);
    const mm = A.byMonth[mk] = A.byMonth[mk] || { net:0, gp:0, contrib:0, sales:0, cogs:0 };
    mm.sales+=sSales; mm.cogs+=sCogs;
    mm.net    += sSales+ship+carg;
    mm.gp     += sSales+ship+carg-sCogs;
    mm.contrib+= sSales+ship+carg-sCogs-comm-sCostos;
  });
  A.sales=round2(A.sales); A.shipping=round2(A.shipping); A.cargos=round2(A.cargos);
  A.cogs=round2(A.cogs); A.commission=round2(A.commission);
  Object.keys(A.costos).forEach(k=> A.costos[k]=round2(A.costos[k]));
  A.sellingTotal = round2(A.commission + A.costos.envio + A.costos.labor + A.costos.comision + A.costos.otro);
  A.net     = round2(A.sales + A.shipping + A.cargos);
  A.gp      = round2(A.net - A.cogs);
  A.contrib = round2(A.gp - A.sellingTotal);
  A.gpPct       = A.net>0 ? A.gp/A.net : 0;
  A.contribPct  = A.net>0 ? A.contrib/A.net : 0;
  _pnlCache.map[_key] = A;   // #16: guardamos para reusar mientras los datos no cambien
  return A;
}

/* --- Formateo compacto para etiquetas de gráficos (moneda de reporte) --- */
function _pnlCompact(n){
  const a=Math.abs(n), s=n<0?"-":"", sym=monedaSym(reportCcy());
  if(a>=1e6) return s+sym+"\u00A0"+(a/1e6).toFixed(1)+"M";
  if(a>=1e3) return s+sym+"\u00A0"+(a/1e3).toFixed(1)+"k";
  return s+sym+"\u00A0"+nf0.format(a);
}

/* (El panel del P&L vive ahora en su propia pestaña: 11b-view-pnl.js, bilingüe) */

/* --- Waterfall del P&L (SVG puro, con <title> nativo como tooltip) --- */
function pnlWaterfallSVG(P){
  const steps=[
    {k:t("pnl.wf.sales"),       v:P.sales,       type:"start"},
    {k:t("pnl.wf.shipping"),    v:P.shipping,    type:"add"},
    {k:t("pnl.wf.cargos"),      v:P.cargos,      type:"add", star:true},
    {k:t("pnl.wf.net"),         v:P.net,         type:"sub"},
    {k:t("pnl.wf.cogs"),        v:-P.cogs,       type:"minus"},
    {k:t("pnl.wf.gross"),       v:P.gp,          type:"sub"},
    {k:t("pnl.wf.commissions"), v:-P.commission, type:"minus"},
    {k:t("pnl.wf.selling"),     v:-(P.costos.envio+P.costos.labor+P.costos.comision+P.costos.otro), type:"minus"},
    {k:t("pnl.wf.contrib"),     v:P.contrib,     type:"total"},
  ];
  let run=0, maxV=0, minV=0;
  const geom=steps.map(s=>{ let lo,hi;
    if(s.type==="start"||s.type==="sub"||s.type==="total"){ lo=Math.min(0,s.v); hi=Math.max(0,s.v); run=s.v; }
    else { const prev=run; run=prev+s.v; lo=Math.min(prev,run); hi=Math.max(prev,run); }
    maxV=Math.max(maxV,hi); minV=Math.min(minV,lo); return {...s,lo,hi};
  });
  const W=760,H=330,padT=24,padB=58,padL=6,padR=6,plot=H-padT-padB;
  const dom=(maxV-minV)||1, y=v=> padT+(maxV-v)/dom*plot;
  const n=steps.length,gap=12,bw=(W-padL-padR-gap*(n-1))/n;
  const col=t=> t==="add"?"var(--up)":t==="minus"?"var(--down)":t==="total"?"var(--accent)":"var(--surface-2)";
  const strk=t=> (t==="sub"||t==="start")?"var(--line-strong)":"none";
  let grid="",bars="",conns="",labs="",vals="";
  const ticks=4;
  for(let i=0;i<=ticks;i++){ const gv=maxV-dom*(i/ticks), gy=y(gv);
    grid+=`<line x1="${padL}" y1="${gy.toFixed(1)}" x2="${W-padR}" y2="${gy.toFixed(1)}" stroke="var(--line)" stroke-width="1"/>`
        +`<text x="${padL+2}" y="${(gy-3).toFixed(1)}" font-size="8.5" fill="var(--muted)" font-family="monospace">${_pnlCompact(gv)}</text>`;
  }
  geom.forEach((s,i)=>{
    const x=padL+i*(bw+gap), yTop=y(s.hi), yBot=y(s.lo), h=Math.max(2,yBot-yTop);
    bars+=`<rect x="${x.toFixed(1)}" y="${yTop.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${col(s.type)}" stroke="${strk(s.type)}" stroke-width="1"><title>${s.k}: ${money(s.v)}</title></rect>`;
    if(i<geom.length-1 && s.type!=="total"){
      const yEnd = (s.type==="minus") ? y(s.lo) : (s.type==="add") ? y(s.hi) : y(s.v);
      conns+=`<line x1="${x.toFixed(1)}" y1="${yEnd.toFixed(1)}" x2="${(x+bw+gap).toFixed(1)}" y2="${yEnd.toFixed(1)}" stroke="var(--line-strong)" stroke-width="1.1" stroke-dasharray="2.5 2.5"/>`;
    }
    vals+=`<text x="${(x+bw/2).toFixed(1)}" y="${(yTop-5).toFixed(1)}" text-anchor="middle" font-size="9.5" font-weight="700" font-family="monospace" fill="var(--text)">${_pnlCompact(s.v)}</text>`;
    const key=(s.type==="sub"||s.type==="total"||s.type==="start");
    labs+=`<text x="${(x+bw/2).toFixed(1)}" y="${H-padB+15}" text-anchor="middle" font-size="9.5" font-weight="600" fill="${key?'var(--text)':'var(--muted)'}">${s.star?'<tspan fill="var(--accent)">\u2605 </tspan>':''}${s.k}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" style="display:block;min-width:640px;max-width:820px;width:100%;height:auto;margin:0 auto" role="img" aria-label="Waterfall del estado de resultados">${grid}${conns}${bars}${vals}${labs}</svg>`;
}

/* --- Tendencia en COLUMNAS verticales (el tiempo se lee izq\u2192der) --- */
function trendChartSVG(items, fmt, color){
  const data=items||[];
  const COL = color || "var(--accent)";
  if(!data.length) return `<div class="cempty">${t("an.nosales")}</div>`;
  const W=560,H=205,padT=18,padB=28,padL=6,padR=6,plot=H-padT-padB;
  const vs=data.map(d=>d.value);
  const maxV=Math.max(...vs,1), minV=Math.min(0,...vs);
  const dom=(maxV-minV)||1, y=v=> padT+(maxV-v)/dom*plot;
  const n=data.length,gap=12,bw=Math.max(6,(W-padL-padR-gap*(n-1))/n);
  let cols="",labs="",vlab="";
  data.forEach((d,i)=>{
    const x=padL+i*(bw+gap), yy=y(Math.max(0,d.value)), y0=y(Math.min(0,d.value)), h=Math.max(1,Math.abs(y0-yy));
    const neg=d.value<0;
    cols+=`<rect x="${x.toFixed(1)}" y="${yy.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${neg?'var(--down)':COL}"><title>${esc(d.label)}: ${fmt(d.value)}</title></rect>`;
    const cx=x+bw/2;
    vlab+=`<text x="${cx.toFixed(1)}" y="${(yy-4).toFixed(1)}" text-anchor="middle" font-size="9" font-weight="700" font-family="monospace" fill="var(--text)">${(fmt===money)?_pnlCompact(d.value):qty(d.value)}</text>`;
    labs+=`<text x="${cx.toFixed(1)}" y="${H-padB+14}" text-anchor="middle" font-size="9.5" fill="var(--muted)">${esc(d.label)}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" style="display:block;width:100%;height:auto" role="img" aria-label="Tendencia mensual">${cols}${vlab}${labs}</svg>`;
}
