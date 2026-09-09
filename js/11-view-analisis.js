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
  if(!vals.length) return `<div class="cempty">No data to chart.</div>`;
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
  if(!data.length) return `<div class="cempty">No data to chart.</div>`;
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
    <text x="21" y="24.4" text-anchor="middle" font-size="2.1" class="donut-ctr-lbl" data-ctrlbl="1">Total</text>
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
        ctrLbl.textContent = 'Total';
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
    // una moneda distinta (Select USD / Swan ARS): convertimos a la moneda de
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
        cantidad:l.cantidad, revenue:convertCcy(round2((l.precio||0)*l.cantidad), sCcy, rep), cogs:convertCcy(round2(cogs), sCcy, rep),
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
        const cCogs = convertCcy(round2((c.costoUnit||0)*(c.cantidad||0)), r.ccy||rep2, rep2);   // costo en moneda de la venta -> reporte
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
    return { soc:k, nombre: k==="—"?"— (no breakdown)":storeName(k), units:e.units, cogs:e.cogs,
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
  const trend = monthsSorted.map(k=>{ const [y,m]=k.split("-"); return { label:`${_MONTHS3[(+m)-1]} ${y.slice(2)}`, value: anMetric==="units"?byMonth[k].units:byMonth[k].revenue }; });

  // --- Punto 2/6: rendimiento por vendedor (unidades, revenue, margen FIFO) ---
  const vendPerf = Object.entries(byVend)
    .map(([k,v])=>({ nombre:k, units:v.units, revenue:round2(v.revenue), margin:round2(v.revenue-v.cogs),
                     marginPct: v.revenue>0 ? ((v.revenue-v.cogs)/v.revenue*100) : 0 }))
    .sort((a,b)=>b.revenue-a.revenue);

  const kpis = `
  <div class="kpis">
    <div class="kpi"><div class="lbl">Revenue</div><div class="val">${money(revenue)}</div><div class="sub">${qty(units)} units sold</div></div>
    <div class="kpi"><div class="lbl">COGS (FIFO)</div><div class="val">${money(cogs)}</div><div class="sub">actual cost layers</div></div>
    <div class="kpi"><div class="lbl">Gross margin</div><div class="val">${money(margin)}</div><div class="sub">revenue − COGS</div></div>
    <div class="kpi"><div class="lbl">Margin %</div><div class="val">${revenue>0?nf0.format(marginPct)+"%":"—"}</div><div class="sub">on revenue</div></div>
  </div>`;

  const sagas=sagasUnicas(), paises=paisesVentas();
  const slicers = `
  <div class="slicers">
    <div class="slicer"><span>Seller</span><select id="an_vend"><option value="">All</option>${vendedores().map(v=>`<option value="${esc(v.id)}" ${anFiltros.vend===v.id?"selected":""}>${esc(v.nombre)}</option>`).join("")}</select></div>
    <div class="slicer"><span>Line</span><select id="an_saga"><option value="">All</option>${sagas.map(s=>`<option value="${esc(s)}" ${anFiltros.saga===s?"selected":""}>${esc(s)}</option>`).join("")}</select></div>
    <div class="slicer"><span>Language</span><select id="an_idioma"><option value="">All</option>${LANGS.map(([v,l])=>`<option value="${v}" ${anFiltros.idioma===v?"selected":""}>${esc(l)}</option>`).join("")}</select></div>
    <div class="slicer"><span>Country</span><select id="an_pais"><option value="">All</option>${paises.map(c=>`<option value="${esc(c)}" ${anFiltros.pais===c?"selected":""}>${esc(c)}</option>`).join("")}</select></div>
    <div class="slicer"><span>From</span><input type="date" id="an_desde" value="${esc(anFiltros.desde)}"></div>
    <div class="slicer"><span>To</span><input type="date" id="an_hasta" value="${esc(anFiltros.hasta)}"></div>
    <button class="slicer-reset" id="an_clear">Reset</button>
  </div>`;

  const charts = `
  <div class="chart-grid">
    <div class="panel chart" style="grid-column:1/-1">
      <p class="ctitle">Monthly trend</p>
      <p class="csub">${anMetric==="units"?"Units":"Revenue"} per month in the current selection.</p>
      ${trend.length ? hbars(trend, mfmt, "var(--accent)") : `<div class="cempty">No sales in this selection.</div>`}
    </div>
    <div class="panel chart">
      <p class="ctitle">Top 10 products by ${anMetric==="units"?"units":"revenue"}</p>
      <p class="csub">Where the money comes from. Tap a bar to filter its line.</p>
      ${rows.length ? hbars(top(byProd, mval).map(t=>({label:t.label,value:t.value,saga:sagaOfName(t.label)})), mfmt, "var(--accent)") : `<div class="cempty">No sales in this selection.</div>`}
    </div>
    <div class="panel chart">
      <p class="ctitle">Top 10 products by gross margin</p>
      <p class="csub">Revenue − FIFO cost, per product.</p>
      ${rows.length ? hbars(topMargin, money, "var(--up)") : `<div class="cempty">No sales in this selection.</div>`}
    </div>
    <div class="panel chart">
      <p class="ctitle">${anMetric==="units"?"Units":"Revenue"} by seller</p>
      <p class="csub">Who's selling. Click a slice for its ${anMetric==="units"?"units":"amount"}.</p>
      ${rows.length ? donut("d-vend", top(byVend,mval), mfmt) : `<div class="cempty">No sales.</div>`}
    </div>
    <div class="panel chart">
      <p class="ctitle">${anMetric==="units"?"Units":"Revenue"} by country</p>
      <p class="csub">Buyer country on each sale. Click a slice for its ${anMetric==="units"?"units":"amount"}.</p>
      ${Object.keys(byPais).length ? donut("d-pais", top(byPais,mval,8), mfmt) : `<div class="cempty">No country data — add it on the customer.</div>`}
    </div>
    <div class="panel chart">
      <p class="ctitle">${anMetric==="units"?"Units":"Revenue"} by language</p>
      <p class="csub">JP vs SP/ESP. Click a slice for its ${anMetric==="units"?"units":"amount"}.</p>
      ${Object.keys(byLang).length ? donut("d-lang", top(byLang,mval), mfmt) : `<div class="cempty">No language data.</div>`}
    </div>
    <div class="panel chart">
      <p class="ctitle">Seller performance</p>
      <p class="csub">Units, revenue and FIFO gross margin per seller in the current selection.</p>
      ${vendPerf.length ? `<div class="table-scroll"><table>
        <thead><tr><th>Seller</th><th class="r">Units</th><th class="r">Revenue</th><th class="r">Margin</th><th class="r">Margin %</th></tr></thead>
        <tbody>${vendPerf.map(r=>`<tr><td>${esc(r.nombre)}</td><td class="r num">${qty(r.units)}</td><td class="r num">${money(r.revenue)}</td><td class="r num">${money(r.margin)}</td><td class="r num">${r.revenue>0?nf0.format(r.marginPct)+"%":"—"}</td></tr>`).join("")}</tbody>
      </table></div>` : `<div class="cempty">No sales in this selection.</div>`}
    </div>
    ${STORE_IDS.length>1 ? `<div class="panel chart" style="grid-column:1/-1">
      <p class="ctitle">Cost &amp; margin by society (provenance)</p>
      <p class="csub">Which society's stock was sold, its real FIFO cost and margin. Same pool price for all — the margin gap is the cost gap. Revenue allocated per unit shipped from each society.</p>
      ${socRows.length ? `<div class="table-scroll"><table>
        <thead><tr><th>Society</th><th class="r">Units sold</th><th class="r">COGS (FIFO)</th><th class="r">Avg unit cost</th><th class="r">Revenue*</th><th class="r">Margin</th><th class="r">Margin %</th></tr></thead>
        <tbody>${socRows.map(r=>`<tr><td>${esc(r.nombre)}</td><td class="r num">${qty(r.units)}</td><td class="r num">${money(r.cogs)}</td><td class="r num">${money(r.avg)}</td><td class="r num">${money(r.revenue)}</td><td class="r num">${money(r.margin)}</td><td class="r num">${r.revenue>0?nf0.format(r.marginPct)+"%":"—"}</td></tr>`).join("")}</tbody>
        <tfoot><tr><td><b>Total</b></td><td class="r num"><b>${qty(units)}</b></td><td class="r num"><b>${money(cogs)}</b></td><td class="r num">—</td><td class="r num"><b>${money(revenue)}</b></td><td class="r num"><b>${money(margin)}</b></td><td class="r num"><b>${revenue>0?nf0.format(marginPct)+"%":"—"}</b></td></tr></tfoot>
      </table></div><p class="csub" style="margin-top:8px">*Revenue is pool-level; here it's split across societies pro-rata by units shipped, only to estimate each one's margin.</p>` : `<div class="cempty">No sales in this selection.</div>`}
    </div>` : ""}
  </div>`;

  return `
  <div class="head"><div class="title"><h2>Analysis</h2><p>Sales, FIFO margin and seller performance. Filter with the slicers.</p></div>
    <div class="actions" style="gap:8px">
      <div class="seg"><button class="seg-btn ${anMetric==="usd"?"on":""}" data-metric="usd">USD</button><button class="seg-btn ${anMetric==="units"?"on":""}" data-metric="units">Units</button></div>
      ${isAdmin()?`<button class="btn primary" id="an_pnl">⤓ Export P&amp;L (Excel)</button>`:""}
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
    el.style.cursor="pointer"; el.title="Filter this line";
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

