/* ============================================================
   gestordestock — 33-ficha-producto.js
   Parte de la app. Se carga como <script> en el ORDEN del index.html.
   Todo vive en scope global (sin módulos), igual que antes.
   ============================================================ */
/* ============================================================
   FICHA DE PRODUCTO: kardex individual + evolución
   ============================================================ */
function openFicha(id){
  const p = prodById(id); if(!p) return;
  const movs = db.movimientos.filter(m=>m.productoId===id)
                 .sort((a,b)=> new Date(a.fecha)-new Date(b.fecha));

  let bal=0; const serie=[0];
  const rows = movs.map(m=>{
    const isAdj = m.tipo==="ajuste";
    const signed = (m.delta!=null) ? m.delta : (m.tipo==="entrada"? m.cantidad : -m.cantidad);
    const up = signed>=0;
    // Los buckets (tránsito/bóveda) no son stock vendible: sus movimientos se muestran
    // como fila informativa pero NO mueven el saldo corrido (que espeja lo vendible).
    const esBucketMov = (typeof isBucket==="function") && isBucket(m.store);
    if(!esBucketMov){ bal += signed; }
    serie.push(bal);
    const d=new Date(m.fecha);
    const _lc=(typeof lang==="function"&&lang()==="es")?"es-AR":"en-US";
    const fecha = d.toLocaleDateString(_lc) + " " + d.toLocaleTimeString(_lc,{hour:"2-digit",minute:"2-digit",hour12:false});
    const origen = (m.refTipo==="compra"||m.refTipo==="venta") && m.refId
      ? `<button class="btn ghost sm" data-fdoc="${m.refTipo}:${m.refId}">${esc(m.ref||t("fi.viewinvoice"))}</button>`
      : `<span style="color:var(--muted)">${esc(m.ref||"—")}</span>`;
    const isInv = m.tipo==="inv-out"||m.tipo==="inv-return";
    const pill = isInv ? `<span class="pill inv">◈ ${m.tipo==="inv-out"?t("fi.pill.tovault"):t("fi.pill.fromvault")}</span>`
               : isAdj ? `<span class="pill adj">${t("fi.pill.adjust")}</span>`
               : `<span class="pill ${up?'in':'out'}">${up?t("mov.in"):t("mov.out")}</span>`;
    return `<tr>
      <td class="num">${fecha}</td>
      <td>${pill}${m.store?` <span class="pill" style="opacity:.7">${esc(storeName(m.store))}</span>`:""}</td>
      <td class="r delta ${isAdj?'flat':(up?'up':'down')}">${up?'+':'−'}${qty(Math.abs(signed))}</td>
      <td class="r num">${money(m.valorUnit, storeCcy(m.store))}</td>
      <td class="r num" style="font-weight:600">${qty(bal)}</td>
      <td>${origen}</td>
    </tr>`;
  }).reverse().join("");

  const totComp = movs.filter(m=>m.refTipo==="compra").reduce((a,m)=>a+m.cantidad,0);
  const totVend = movs.filter(m=>m.refTipo==="venta").reduce((a,m)=>a+m.cantidad,0);
  const margen = (p.precioVenta||0)-(p.ultimoCosto||0);
  const margenPct = p.precioVenta>0 ? (margen/p.precioVenta*100) : 0;
  const totalStock = stockTotalP(p);
  const held = invUnits(p);
  const inTr = (typeof transUnits==="function") ? transUnits(p) : 0;
  const perStore = STORE_IDS.map(s=>`${storeName(s)}: <b>${qty(stockDe(p,s))}</b>`).join(" · ")
    + (inTr>0 ? ` · <span style="color:var(--muted)">⋯ ${t("fi.transit")}: <b>${qty(inTr)}</b></span>` : "")
    + (held>0 ? ` · <span style="color:var(--accent-ink)">◈ ${t("fi.vault")}: <b>${qty(held)}</b></span>` : "");
  const badge = esInversion(p)?' <span class="pill inv">'+t("inv.pill")+'</span>':(esBloqueado(p)?' <span class="pill blocked">'+t("fi.badge.blocked")+'</span>':'');

  const body = `
    <div class="kpis" style="grid-template-columns:repeat(4,1fr);margin-bottom:18px">
      <div class="kpi"><div class="lbl">${t("fi.kpi.totalstock")}</div><div class="val" style="color:${totalStock<0?'var(--alert)':'inherit'}">${qty(totalStock)}</div><div class="sub">${esc(perStore)}</div></div>
      <div class="kpi"><div class="lbl">${t("fi.kpi.avgcost")}</div><div class="val">${money(stockTotalP(p)>0?round2(valorFifoTotal(p)/stockTotalP(p)):0)}</div><div class="sub">${t("fi.kpi.fifovalued",{m:money(valorFifoTotal(p))})}</div></div>
      <div class="kpi"><div class="lbl">${t("fi.kpi.listprice")}</div><div class="val">${moneyOpt(p.precioVenta)}</div><div class="sub">${p.precioVenta>0?t("fi.kpi.margin",{p:nf0.format(margenPct)}):t("fi.kpi.noprice")}${badge}</div></div>
      <div class="kpi"><div class="lbl">${t("fi.kpi.boughtsold")}</div><div class="val" style="font-size:20px"><span class="delta up">${qty(totComp)}</span> / <span class="delta down">${qty(totVend)}</span></div><div class="sub">${t("fi.kpi.lifetime")}</div></div>
    </div>

    ${(()=>{ const b=landedBuildup(p); return (b.intl>0||b.arg>0) ? `<div class="panel" style="box-shadow:none;margin-bottom:16px">
      <div class="phead"><h3>${t("fi.landed.title")}</h3><span class="hint">${t("fi.landed.hint")}</span></div>
      <div style="padding:10px 14px;display:flex;gap:18px;flex-wrap:wrap;align-items:baseline">
        <span>${t("fi.landed.us")} <b>${money(b.us)}</b></span><span style="color:var(--muted)">+</span>
        <span>${t("fi.landed.intl")} <b>${money(b.intl)}</b></span><span style="color:var(--muted)">+</span>
        <span>${t("fi.landed.arg")} <b>${money(b.arg)}</b></span><span style="color:var(--muted)">=</span>
        <span>${t("fi.landed.total")} <b style="color:var(--accent-ink)">${money(b.total)}</b></span>
      </div></div>` : ""; })()}

    ${serie.length>2 ? `<div class="panel" style="box-shadow:none;margin-bottom:16px">
      <div class="phead"><h3>${t("fi.evo.title")}</h3><span class="hint">${t("fi.evo.hint",{n:movs.length})}</span></div>
      <div style="padding:12px 14px 6px">${sparkline(serie)}</div>
    </div>` : ""}

    <div class="panel" style="box-shadow:none">
      <div class="phead"><h3>${t("fi.kardex.title")}</h3><span class="hint">${t("fi.kardex.hint")}</span></div>
      ${movs.length ? `<div class="table-scroll"><table>
        <thead><tr><th>${t("fi.th.date")}</th><th>${t("fi.th.movement")}</th><th class="r">${t("fi.th.qty")}</th><th class="r">${t("fi.th.unitvalue")}</th><th class="r">${t("fi.th.balance")}</th><th>${t("fi.th.source")}</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`
        : `<div class="empty"><p>${t("fi.kardex.empty")}</p></div>`}
    </div>`;

  buildModal(`${p.sku?("["+esc(p.sku)+"] "):""}${esc(p.nombre)}`, body, [
    puedeAjustar() ? {label:t("fi.btn.adjust"),cls:"btn",act:()=>{ closeModal(); openAjuste(id); }} : null,
    (puedeInvertir() && totalStock>0) ? {label:t("fi.btn.toinv"),cls:"btn",act:()=>{ closeModal(); openSendToInvestment(id); }} : null,
    (puedeInvertir() && held>0) ? {label:t("fi.btn.retvault"),cls:"btn",act:()=>{ closeModal(); openReturnFromInvestment(id); }} : null,
    puedeEditarProductos() ? {label:t("fi.btn.editprod"),cls:"btn",act:()=>{ closeModal(); openProd(id); }} : null,
    {label:t("common.close"),cls:"btn primary",act:closeModal}
  ].filter(Boolean), true);

  document.querySelectorAll("[data-fdoc]").forEach(b=> b.onclick=()=>{
    const [t,i]=b.dataset.fdoc.split(":"); verDoc(t,i);
  });
}
function valorFifoTotal(p){ const rep=reportCcy(); return round2(STORE_IDS.reduce((a,s)=> a + convertCcy(fifoLayers(p,s).reduce((x,L)=>x+L.cantidad*L.costoUnit,0), storeCcy(s), rep), 0)); }

/* Point 4: pick quantities per store when moving stock to the vault
   (all · part of each store · one store only). */
function openSendToInvestment(id){
  const p = prodById(id); if(!p) return;
  const stores = STORE_IDS.filter(s=> stockDe(p,s) > 0);
  if(!stores.length){ toast(t("fi.inv.nostock"),"warn"); return; }
  const rows = stores.map(s=>{
    const av = stockDe(p,s);
    return `<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--line)">
      <div style="flex:1"><b>${esc(storeName(s))}</b> <span style="color:var(--muted);font-size:12.5px">· ${t("fi.inv.available",{n:qty(av)})}</span></div>
      <input class="inp num" id="inv_alloc_${s}" data-max="${av}" value="0" style="width:110px">
      <button class="btn ghost sm" data-allbtn="${s}">${t("fi.inv.all")}</button>
    </div>`;
  }).join("");
  const body = `
    <p class="hint" style="margin:0 0 12px">${t("fi.inv.hint")}</p>
    ${rows}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:14px">
      <button class="btn ghost sm" id="inv_all_stores">${t("fi.inv.everystore")}</button>
      <div style="font-size:13px">${t("fi.inv.total")} <b id="inv_total">0</b></div>
    </div>
    <div class="field" style="margin-top:14px"><label>${t("fi.inv.note")}</label><input class="inp" id="inv_obs" placeholder="${t("fi.inv.note.ph")}"></div>`;
  buildModal(t("fi.inv.md"), body, [
    {label:t("common.cancel"),cls:"btn",act:closeModal},
    {label:t("fi.inv.send"),cls:"btn primary",act:()=>{
       const alloc={}; stores.forEach(s=> alloc[s]=parseNum(document.getElementById("inv_alloc_"+s).value));
       const moved = sendToInvestment(p, alloc, (document.getElementById("inv_obs").value||"").trim());
       if(moved>0){ closeModal(); toast(t("fi.inv.moved",{n:qty(moved)})); render(); }
       else toast(t("fi.inv.nothing"),"warn");
    }}
  ], false);
  const recalc=()=>{ let t=0; stores.forEach(s=>{ const el=document.getElementById("inv_alloc_"+s); let v=parseNum(el.value); const mx=+el.dataset.max; if(v>mx){ v=mx; el.value=mx; } if(v<0){ v=0; el.value=0; } t+=v; }); document.getElementById("inv_total").textContent=qty(t); };
  stores.forEach(s=>{
    document.getElementById("inv_alloc_"+s).oninput=recalc;
    document.querySelector('[data-allbtn="'+s+'"]').onclick=()=>{ const el=document.getElementById("inv_alloc_"+s); el.value=el.dataset.max; recalc(); };
  });
  document.getElementById("inv_all_stores").onclick=()=>{ stores.forEach(s=>{ document.getElementById("inv_alloc_"+s).value=stockDe(p,s); }); recalc(); };
  recalc();
}
/* Reverse: return held units from the vault to a chosen store's sellable stock. */
function openReturnFromInvestment(id){
  const p = prodById(id); if(!p) return;
  const held = invUnits(p);
  if(held<=0){ toast(t("fi.ret.nothing"),"warn"); return; }
  const opts = STORE_IDS.map(s=>`<option value="${s}">${esc(storeName(s))}</option>`).join("");
  const body = `
    <p class="hint" style="margin:0 0 12px">${t("fi.ret.hint",{n:qty(held),m:money(invValor(p),"USD")})}</p>
    <div class="grid-form" style="grid-template-columns:1fr 1fr;padding:0">
      <div class="field"><label>${t("fi.ret.deststore")}</label><select class="inp" id="inv_ret_store">${opts}</select></div>
      <div class="field"><label>${t("fi.ret.qty")}</label><input class="inp num" id="inv_ret_q" value="${held}"></div>
    </div>`;
  buildModal(t("fi.ret.md"), body, [
    {label:t("common.cancel"),cls:"btn",act:closeModal},
    {label:t("fi.ret.return"),cls:"btn primary",act:()=>{
       const st=document.getElementById("inv_ret_store").value;
       const q=parseNum(document.getElementById("inv_ret_q").value);
       const done=returnFromInvestment(p, st, q, "");
       if(done>0){ closeModal(); toast(t("fi.ret.returned",{n:qty(done),store:storeName(st)})); render(); }
       else toast(t("fi.ret.setvalid"),"warn");
    }}
  ], false);
}

/* Mini-gráfico de evolución (SVG, sin librerías) */
function sparkline(vals){
  if(vals.length<2) return "";
  const w=620,h=76,pad=8;
  const max=Math.max(...vals), min=Math.min(...vals,0);
  const range=(max-min)||1;
  const step=(w-2*pad)/(vals.length-1);
  const pts = vals.map((v,i)=>{
    const x=pad+i*step;
    const y=h-pad-((v-min)/range)*(h-2*pad);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const area = `${pad},${h-pad} ${pts.join(" ")} ${(pad+(vals.length-1)*step).toFixed(1)},${h-pad}`;
  const zeroY = h-pad-((0-min)/range)*(h-2*pad);
  const last = vals[vals.length-1];
  const lastX = pad+(vals.length-1)*step;
  const lastY = h-pad-((last-min)/range)*(h-2*pad);
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none" style="display:block">
    <polygon points="${area}" fill="var(--up-bg)"/>
    <line x1="${pad}" y1="${zeroY.toFixed(1)}" x2="${w-pad}" y2="${zeroY.toFixed(1)}" stroke="var(--line-strong)" stroke-dasharray="3 3"/>
    <polyline points="${pts.join(" ")}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="3.5" fill="var(--accent)"/>
  </svg>`;
}

