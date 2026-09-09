/* ============================================================
   gestordestock — 15-view-movimientos.js
   Parte de la app. Se carga como <script> en el ORDEN del index.html.
   Todo vive en scope global (sin módulos), igual que antes.
   ============================================================ */
/* ============================================================
   VISTA: Movimientos
   ============================================================ */
function viewMov(){
  const sagas = sagasUnicas();
  const stores = effectiveStores();
  const movs = db.movimientos.filter(m=> !m.store || stores.includes(m.store));
  const showStore = allowedStores().length>1;
  return `
  <div class="head">
    <div class="title"><h2>Movements</h2><p>Traceability of every entry, exit and adjustment, with its source document and society.</p></div>
    <div class="actions">${puedeAjustar()?`<button class="btn" data-adjust>⇄ Inventory adjustment</button>`:""}</div>
  </div>
  <div class="panel">
    <div class="phead"><h3>Kardex</h3><span class="hint" id="movCount">${movs.length} entries</span></div>
    ${movs.length ? `
    <div class="filtros compact">
      <input class="inp" id="mq" placeholder="Search product, SKU or source…" value="${esc(movFiltros.q)}">
      <select class="inp" id="mtipo">
        <option value="" ${movFiltros.tipo===""?"selected":""}>Any type</option>
        <option value="entrada" ${movFiltros.tipo==="entrada"?"selected":""}>Entries</option>
        <option value="salida" ${movFiltros.tipo==="salida"?"selected":""}>Exits</option>
        <option value="ajuste" ${movFiltros.tipo==="ajuste"?"selected":""}>Adjustments</option>
        <option value="inv" ${movFiltros.tipo==="inv"?"selected":""}>Investments</option>
      </select>
      <select class="inp" id="msaga">
        <option value="">All lines</option>
        ${sagas.map(s=>`<option value="${esc(s)}" ${movFiltros.saga===s?"selected":""}>${esc(s)}</option>`).join("")}
      </select>
      <span class="fdate">From<input class="inp" id="mdesde" type="date" value="${esc(movFiltros.desde)}"></span>
      <span class="fdate">To<input class="inp" id="mhasta" type="date" value="${esc(movFiltros.hasta)}"></span>
      <input class="inp num" id="mvmin" placeholder="Min value" value="${esc(movFiltros.vmin)}" style="width:86px">
      <input class="inp num" id="mvmax" placeholder="Max value" value="${esc(movFiltros.vmax)}" style="width:86px">
      <button class="btn ghost sm" id="mclear">Clear</button>
    </div>
    <div class="table-scroll"><table>
      <thead><tr>
        ${sortTh(movFiltros,"fecha","Date","")}
        ${sortTh(movFiltros,"tipo","Type","")}
        ${showStore?sortTh(movFiltros,"store","Society",""):""}
        ${sortTh(movFiltros,"nombre","Product","")}
        ${sortTh(movFiltros,"cant","Qty","r")}
        ${sortTh(movFiltros,"valor","Unit value","r")}
        ${sortTh(movFiltros,"ref","Source","")}
        <th></th>
      </tr></thead>
      <tbody id="movBody"></tbody></table></div>`
      : emptyState("No movements yet","Every purchase, sale or adjustment leaves its trace here.")}
  </div>`;
}
function filtrarMovs(){
  const f=movFiltros;
  const stores=effectiveStores();
  const q=(f.q||"").trim().toLowerCase();
  const vmin=f.vmin!==""?parseNum(f.vmin):null, vmax=f.vmax!==""?parseNum(f.vmax):null;
  const out = db.movimientos.filter(m=>{
    if(m.store && !stores.includes(m.store)) return false;
    if(f.tipo){
      const isInv = m.tipo==="inv-out" || m.tipo==="inv-return";
      if(f.tipo==="inv"){ if(!isInv) return false; }
      else if(f.tipo==="entrada"){ if(m.tipo!=="entrada" && m.tipo!=="inv-return") return false; }
      else if(f.tipo==="salida"){ if(m.tipo!=="salida" && m.tipo!=="inv-out") return false; }
      else if(m.tipo!==f.tipo) return false;
    }
    if(q){ const hay=((m.nombre||"")+" "+(m.sku||"")+" "+(m.ref||"")).toLowerCase(); if(!hay.includes(q)) return false; }
    if(f.saga && sagaDe({nombre:m.nombre})!==f.saga) return false;
    const fch=(m.fecha||"").slice(0,10);
    if(f.desde && fch < f.desde) return false;
    if(f.hasta && fch > f.hasta) return false;
    const v=m.valorUnit||0;
    if(vmin!==null && v<vmin) return false;
    if(vmax!==null && v>vmax) return false;
    return true;
  });
  const signed = m => (m.delta!=null)?m.delta:(m.tipo==="entrada"?(m.cantidad||0):-(m.cantidad||0));
  const key=f.sortKey||"fecha";
  const dir=f.sortKey ? (f.sortDir==="asc"?1:-1) : -1;
  const valOf = m => {
    switch(key){
      case "tipo":   return String(m.tipo||"");
      case "nombre": return String(m.nombre||"");
      case "cant":   return signed(m);
      case "valor":  return m.valorUnit||0;
      case "ref":    return String(m.ref||"");
      case "store":  return String(storeName(m.store||"")||"");   // Society
      case "fecha":
      default:       return String(m.fecha||"");
    }
  };
  out.sort((a,b)=>{
    const va=valOf(a), vb=valOf(b);
    if(typeof va==="number") return dir*(va-vb);
    return dir*va.localeCompare(vb,"en",{numeric:true});
  });
  return out;
}
function renderMovRows(){
  const body=document.getElementById("movBody"); if(!body) return;
  const all=filtrarMovs();
  const list=all.slice(0,400);
  const showStore = allowedStores().length>1;
  const cols = showStore?8:7;
  body.innerHTML = list.map(m=>{
    const isAdj=m.tipo==="ajuste";
    const isInv=m.tipo==="inv-out"||m.tipo==="inv-return";
    const signed=(m.delta!=null)?m.delta:(m.tipo==="entrada"?m.cantidad:-m.cantidad);
    const up=signed>=0;
    const d=new Date(m.fecha);
    const fecha=d.toLocaleDateString("en-US")+" "+d.toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit",hour12:false});
    const pill=isInv?`<span class="pill inv">◈ ${m.tipo==="inv-out"?"to vault":"from vault"}</span>`
               :isAdj?`<span class="pill adj">⇄ adjust</span>`
               :`<span class="pill ${up?'in':'out'}">${up?'↑ in':'↓ out'}</span>`;
    const deltaCls=isAdj?"flat":(up?'up':'down');
    const accion=isAdj?`<button class="btn ghost sm" data-delaj="${m.id}" style="color:var(--alert)" title="Delete adjustment">${ICO.trash}</button>`:"";
    return `<tr>
      <td class="num">${fecha}</td>
      <td>${pill}</td>
      ${showStore?`<td>${esc(storeName(m.store))}</td>`:""}
      <td><span class="sku">${esc(m.sku||"—")}</span> ${esc(m.nombre)}</td>
      <td class="r delta ${deltaCls}">${up?'+':'−'}${qty(Math.abs(signed))}</td>
      <td class="r num">${money(m.valorUnit, storeCcy(m.store))}</td>
      <td class="num">${esc(m.ref||"—")}</td>
      <td class="r">${accion}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="${cols}" style="text-align:center;color:var(--muted);padding:22px">No movement matches the filters.</td></tr>`;
  const cnt=document.getElementById("movCount");
  const totalF=db.movimientos.filter(m=>!m.store||effectiveStores().includes(m.store)).length;
  if(cnt) cnt.textContent = (all.length===totalF?`${totalF} entries`:`${all.length} of ${totalF}`)+(list.length<all.length?` · showing 400`:"");
  body.querySelectorAll("[data-delaj]").forEach(b=> b.onclick=()=> deleteAjuste(b.dataset.delaj));
}
function wireMovFiltros(){
  if(!document.getElementById("movBody")) return;
  const upd=(k,el)=>{ movFiltros[k]=el.value; renderMovRows(); };
  document.getElementById("mq").oninput=e=>upd("q",e.target);
  document.getElementById("mtipo").onchange=e=>upd("tipo",e.target);
  document.getElementById("msaga").onchange=e=>upd("saga",e.target);
  document.getElementById("mdesde").onchange=e=>upd("desde",e.target);
  document.getElementById("mhasta").onchange=e=>upd("hasta",e.target);
  document.getElementById("mvmin").oninput=e=>upd("vmin",e.target);
  document.getElementById("mvmax").oninput=e=>upd("vmax",e.target);
  document.getElementById("mclear").onclick=()=>{
    movFiltros={ q:"", desde:"", hasta:"", tipo:"", saga:"", vmin:"", vmax:"", sortKey:"", sortDir:"" };
    render();   // resetea inputs + flechas
  };
  // Orden por columna: desc -> asc -> sin flecha
  document.querySelectorAll("#main th[data-sortk]").forEach(th=>{
    th.onclick=()=>{
      const k=th.dataset.sortk;
      if(movFiltros.sortKey!==k){ movFiltros.sortKey=k; movFiltros.sortDir="desc"; }
      else if(movFiltros.sortDir==="desc"){ movFiltros.sortDir="asc"; }
      else { movFiltros.sortKey=""; movFiltros.sortDir=""; }
      render();
    };
  });
  renderMovRows();
}
/* Borrar un ajuste manual: revierte su efecto en el stock y saca el asiento */
function deleteAjuste(id){
  const m=db.movimientos.find(x=>x.id===id && x.tipo==="ajuste"); if(!m) return;
  const p=prodById(m.productoId);
  const d=(m.delta!=null)?m.delta:0;
  const msg = p
    ? `Delete this adjustment?\n\n${p.nombre}\nReverts ${d>=0?'+':'−'}${qty(Math.abs(d))} u → stock ${qty(p.stock)} becomes ${qty(+((p.stock||0)-d).toFixed(4))}.`
    : `Delete this adjustment? (the product no longer exists in the master)`;
  if(!confirm(msg)) return;
  if(p) p.stock = +((p.stock||0) - d).toFixed(4);
  db.movimientos = db.movimientos.filter(x=>x.id!==id);
  save(); toast("Adjustment deleted","warn"); render();
}

