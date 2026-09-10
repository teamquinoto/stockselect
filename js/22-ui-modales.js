/* ============================================================
   gestordestock — 22-ui-modales.js
   Parte de la app. Se carga como <script> en el ORDEN del index.html.
   Todo vive en scope global (sin módulos), igual que antes.
   ============================================================ */
/* ============================================================
   Modal genérico
   ============================================================ */
function buildModal(title, bodyHTML, buttons=[], wide=false, extraFoot=""){
  const root=document.getElementById("modalRoot");
  root.innerHTML=`
    <div class="scrim" id="scrim">
      <div class="modal ${wide===true?'wide':(typeof wide==='string'?wide:'')}">
        <div class="mhead"><h3>${esc(title)}</h3><button class="x" id="xClose">×</button></div>
        <div class="mbody">${bodyHTML}</div>
        ${extraFoot?`<div class="mextra" style="padding:0 22px">${extraFoot}</div>`:""}
        <div class="mfoot" id="mfoot"></div>
      </div>
    </div>`;
  const foot=document.getElementById("mfoot");
  // separar botón de eliminar (izquierda) del resto (derecha)
  const left=buttons.filter(b=>b.cls.includes("danger"));
  const right=buttons.filter(b=>!b.cls.includes("danger"));
  const wrapL=document.createElement("div"); wrapL.style.display="flex"; wrapL.style.gap="8px";
  const wrapR=document.createElement("div"); wrapR.style.display="flex"; wrapR.style.gap="8px"; wrapR.style.marginLeft="auto";
  left.forEach(b=> wrapL.appendChild(mkBtn(b)));
  right.forEach(b=> wrapR.appendChild(mkBtn(b)));
  foot.appendChild(wrapL); foot.appendChild(wrapR);
  document.getElementById("xClose").onclick=closeModal;
  document.getElementById("scrim").addEventListener("mousedown",e=>{ if(e.target.id==="scrim") closeModal(); });
  document.addEventListener("keydown", escClose);
  return root;
}
function mkBtn(b){
  const el=document.createElement("button"); el.className=b.cls; el.textContent=b.label; el.onclick=b.act; return el;
}
function escClose(e){ if(e.key==="Escape") closeModal(); }
function closeModal(){
  if(typeof closeProductPicker==="function") closeProductPicker();
  if(typeof hideNameTip==="function") hideNameTip();
  document.getElementById("modalRoot").innerHTML="";
  document.removeEventListener("keydown", escClose);
}

/* ============================================================
   FIELD ENHANCERS: dropdowns y calendario custom
   ------------------------------------------------------------
   Reemplazan visualmente los popups NATIVOS (que el SO dibuja
   en blanco, ajenos al tema) por popups propios pintados con
   nuestros tokens. Regla de oro: nunca tocamos el <select> ni
   el <input type=date> reales — sólo interceptamos su apertura.
   Así value, id, listeners y onchange siguen intactos y toda la
   lógica de wireXXX() sigue andando sin enterarse.
   ============================================================ */
(function(){
  const MESES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const DOW   = ["Su","Mo","Tu","We","Th","Fr","Sa"];   // week starts Sunday (US)
  const CAL_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>';

  let openPop = null;   // popup abierto actualmente (select o calendario)
  function closeOpen(){ if(openPop){ openPop.remove(); openPop=null; document.removeEventListener('scroll', onDocScroll, true); } }
  function onDocScroll(){ closeOpen(); }

  /* Posiciona un popup respecto de su "ancla" (el control), eligiendo abrir
     hacia abajo o hacia arriba según el espacio disponible en el viewport. */
  function place(pop, anchor){
    const r = anchor.getBoundingClientRect();
    document.body.appendChild(pop);
    const ph = pop.offsetHeight;
    const below = window.innerHeight - r.bottom;
    const openUp = below < ph + 8 && r.top > below;
    pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 8)) + "px";
    if(openUp) pop.style.top = Math.max(8, r.top - pop.offsetHeight - 6) + "px";
    else       pop.style.top = (r.bottom + 6) + "px";
  }

  /* ---------------- SELECT ---------------- */
  function openSelect(sel){
    closeOpen();
    const pop = document.createElement('div');
    pop.className = 'csel-pop';
    pop.style.minWidth = sel.getBoundingClientRect().width + 'px';
    Array.from(sel.options).forEach((opt)=>{
      // <hr> dentro del select no existe como option; separadores manuales:
      const div = document.createElement('div');
      div.className = 'csel-opt' + (opt.selected ? ' sel' : '');
      if(opt.disabled) div.dataset.disabled = '1';
      div.textContent = opt.textContent;
      div.title = opt.textContent;
      div.onclick = ()=>{
        if(opt.disabled) return;
        if(sel.value !== opt.value){
          sel.value = opt.value;
          // dispara los handlers de la app (soporta .onchange y addEventListener)
          sel.dispatchEvent(new Event('change', { bubbles:true }));
        }
        closeOpen();
      };
      pop.appendChild(div);
    });
    pop.__forSel = sel;
    openPop = pop;
    place(pop, sel);
    // scroll a la opción seleccionada
    const selEl = pop.querySelector('.csel-opt.sel');
    if(selEl) selEl.scrollIntoView({ block:'nearest' });
    document.addEventListener('scroll', onDocScroll, true);
  }

  function enhanceSelects(root){
    (root||document).querySelectorAll('select:not([data-csel])').forEach(sel=>{
      sel.dataset.csel = '1';
      // en mobile el picker nativo del select es cómodo (rueda a pantalla
      // completa); sólo reemplazamos en punteros finos (mouse/trackpad).
      const fino = window.matchMedia && window.matchMedia('(pointer:fine)').matches;
      if(!fino) return;
      sel.addEventListener('mousedown', (e)=>{ e.preventDefault(); (openPop && openPop.__forSel===sel) ? closeOpen() : openSelect(sel); });
      sel.addEventListener('keydown', (e)=>{
        if(e.key==='Enter' || e.key===' ' || e.key==='ArrowDown' || e.key==='ArrowUp'){ e.preventDefault(); openSelect(sel); }
      });
    });
  }

  /* ---------------- DATE ---------------- */
  const pad = n => String(n).padStart(2,'0');
  const toISO = d => d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate());
  const parseISO = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s||''); return m ? new Date(+m[1], +m[2]-1, +m[3]) : null; };

  function openCalendar(inp){
    closeOpen();
    const today = new Date(); today.setHours(0,0,0,0);
    const sel = parseISO(inp.value);
    let viewY = (sel||today).getFullYear();
    let viewM = (sel||today).getMonth();
    let mode = 'days';   // 'days' | 'months' | 'years'

    const pop = document.createElement('div');
    pop.className = 'cal-pop';
    pop.__forDate = inp;
    openPop = pop;

    function commit(d){
      inp.value = d ? toISO(d) : '';
      inp.dispatchEvent(new Event('change', { bubbles:true }));
      closeOpen();
    }
    function drawDays(){
      const first = new Date(viewY, viewM, 1);
      const startDow = first.getDay();                 // 0=domingo
      const daysInMonth = new Date(viewY, viewM+1, 0).getDate();
      const prevDays = new Date(viewY, viewM, 0).getDate();
      let cells = '';
      // días del mes anterior (relleno)
      for(let i=startDow-1;i>=0;i--) cells += `<div class="cal-cell out">${prevDays-i}</div>`;
      for(let d=1; d<=daysInMonth; d++){
        const cur = new Date(viewY, viewM, d);
        const isToday = cur.getTime()===today.getTime();
        const isSel = sel && cur.getTime()===sel.getTime();
        cells += `<div class="cal-cell${isToday?' today':''}${isSel?' sel':''}" data-d="${d}">${d}</div>`;
      }
      const totalShown = startDow + daysInMonth;
      const trailing = (7 - (totalShown % 7)) % 7;
      for(let i=1;i<=trailing;i++) cells += `<div class="cal-cell out">${i}</div>`;
      pop.innerHTML = `
        <div class="cal-head">
          <div class="cal-title" data-act="mode">${MESES[viewM]} ${viewY}</div>
          <div class="cal-nav" data-act="prev">‹</div>
          <div class="cal-nav" data-act="next">›</div>
        </div>
        <div class="cal-grid">${DOW.map(d=>`<div class="cal-dow">${d}</div>`).join('')}${cells}</div>
        <div class="cal-foot"><button data-act="clear">Clear</button><button data-act="today">Today</button></div>`;
      pop.querySelectorAll('.cal-cell[data-d]').forEach(c=> c.onclick=()=> commit(new Date(viewY, viewM, +c.dataset.d)));
      pop.querySelector('[data-act="prev"]').onclick = ()=>{ viewM--; if(viewM<0){viewM=11;viewY--;} drawDays(); };
      pop.querySelector('[data-act="next"]').onclick = ()=>{ viewM++; if(viewM>11){viewM=0;viewY++;} drawDays(); };
      pop.querySelector('[data-act="mode"]').onclick = ()=> drawMonths();
      pop.querySelector('[data-act="clear"]').onclick = ()=> commit(null);
      pop.querySelector('[data-act="today"]').onclick = ()=> commit(new Date(today));
    }
    function drawMonths(){
      pop.innerHTML = `
        <div class="cal-head">
          <div class="cal-title" data-act="years">${viewY}</div>
          <div class="cal-nav" data-act="prevy">‹</div>
          <div class="cal-nav" data-act="nexty">›</div>
        </div>
        <div class="cal-mgrid">${MESES.map((m,i)=>`<div class="cal-mcell${i===viewM?' sel':''}" data-m="${i}">${m.slice(0,3)}</div>`).join('')}</div>`;
      pop.querySelectorAll('.cal-mcell').forEach(c=> c.onclick=()=>{ viewM=+c.dataset.m; drawDays(); });
      pop.querySelector('[data-act="prevy"]').onclick = ()=>{ viewY--; drawMonths(); };
      pop.querySelector('[data-act="nexty"]').onclick = ()=>{ viewY++; drawMonths(); };
      pop.querySelector('[data-act="years"]').onclick = ()=> drawYears();
    }
    function drawYears(){
      const base = viewY - (viewY % 12);
      let cells = '';
      for(let y=base; y<base+12; y++) cells += `<div class="cal-mcell${y===viewY?' sel':''}" data-y="${y}">${y}</div>`;
      pop.innerHTML = `
        <div class="cal-head">
          <div class="cal-title">${base}–${base+11}</div>
          <div class="cal-nav" data-act="prevr">‹</div>
          <div class="cal-nav" data-act="nextr">›</div>
        </div>
        <div class="cal-mgrid">${cells}</div>`;
      pop.querySelectorAll('.cal-mcell').forEach(c=> c.onclick=()=>{ viewY=+c.dataset.y; drawMonths(); });
      pop.querySelector('[data-act="prevr"]').onclick = ()=>{ viewY-=12; drawYears(); };
      pop.querySelector('[data-act="nextr"]').onclick = ()=>{ viewY+=12; drawYears(); };
    }
    drawDays();
    place(pop, inp);
    document.addEventListener('scroll', onDocScroll, true);
  }

  // Formatea un valor ISO (YYYY-MM-DD) a MM/DD/YYYY para el texto visible.
  function fmtUSDate(iso){
    if(!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
    const [y,mo,d] = iso.split("-");
    return mo+"/"+d+"/"+y;
  }
  function enhanceDates(root){
    (root||document).querySelectorAll('input[type="date"]:not([data-cdate])').forEach(inp=>{
      inp.dataset.cdate = '1';
      // ícono de calendario propio (el nativo lo ocultamos por CSS). Medimos el
      // ancho REAL ya renderizado y se lo fijamos al wrapper, así el input pasa
      // a 100% sin que se desacomode ninguna columna del filtro/modal.
      let wrap;
      if(!inp.parentElement.classList.contains('cdate-wrap')){
        const w = inp.getBoundingClientRect().width;
        wrap = document.createElement('span');
        wrap.className = 'cdate-wrap';
        if(w) wrap.style.width = w + 'px';
        inp.parentNode.insertBefore(wrap, inp);
        wrap.appendChild(inp);
        // texto propio en MM/DD/YYYY encima del input (el nativo va transparente)
        const txt = document.createElement('span');
        txt.className = 'cdate-text';
        wrap.appendChild(txt);
        const ico = document.createElement('span');
        ico.className = 'cdate-ico'; ico.innerHTML = CAL_ICON;
        wrap.appendChild(ico);
        inp.style.width = '100%';
        inp.style.paddingRight = '28px';
        // pinta/actualiza el texto visible según el valor ISO del input
        const paint = ()=>{
          const us = fmtUSDate(inp.value);
          txt.textContent = us || 'mm/dd/yyyy';
          txt.classList.toggle('ph', !us);
        };
        paint();
        inp.addEventListener('change', paint);
        inp.addEventListener('input', paint);
      }
      inp.addEventListener('mousedown', (e)=>{ e.preventDefault(); (openPop && openPop.__forDate===inp) ? closeOpen() : openCalendar(inp); });
      inp.addEventListener('keydown', (e)=>{ e.preventDefault(); if(e.key==='Enter'||e.key===' '||e.key==='ArrowDown') openCalendar(inp); });
      // por las dudas: si algún navegador expone showPicker, lo neutralizamos
      if(inp.showPicker){ const _sp = inp.showPicker.bind(inp); inp.showPicker = ()=>{ openCalendar(inp); }; }
    });
  }

  /* Corre ambos enhancers sobre un contenedor (o todo el doc). */
  function runFieldEnhancers(root){ enhanceSelects(root); enhanceDates(root); }
  window.runFieldEnhancers = runFieldEnhancers;

  // Cerrar popups al tocar afuera, con Escape o al cambiar el tamaño. Si el
  // mousedown cae sobre el MISMO control que abrió el popup, no cerramos acá:
  // dejamos que su propio handler (bubble) haga el toggle a cerrado.
  document.addEventListener('mousedown', (e)=>{
    if(!openPop) return;
    if(openPop.contains(e.target)) return;                                   // dentro del popup
    if(openPop.__forSel && openPop.__forSel===e.target) return;              // el mismo <select>
    if(openPop.__forDate){
      const wrap = openPop.__forDate.closest('.cdate-wrap');
      if(e.target===openPop.__forDate || (wrap && wrap.contains(e.target))) return; // el mismo input date o su ícono
    }
    closeOpen();
  }, true);
  document.addEventListener('keydown', (e)=>{ if(e.key==='Escape') closeOpen(); });
  window.addEventListener('resize', closeOpen);

  /* ---- Cuándo enhancear: un MutationObserver ----
     La app repinta con innerHTML muy seguido (vistas, modales, sub-render del
     editor de líneas, filas de tablas, etc.). En vez de engancharnos a cada
     función de render por nombre, observamos el DOM: cualquier <select> o
     <input type=date> nuevo se enhancea solo. Los ya marcados (data-csel /
     data-cdate) se saltean, así no hay retrabajo ni recursión (nuestros popups
     no contienen controles nativos). Debounce por frame para no recalcular de
     más en repintados grandes. */
  let pending = false;
  const observer = new MutationObserver(()=>{
    if(pending) return;
    pending = true;
    requestAnimationFrame(()=>{ pending = false; runFieldEnhancers(); });
  });
  function startObserver(){
    if(document.body) observer.observe(document.body, { childList:true, subtree:true });
  }

  // Al cerrar un modal, cerramos cualquier popup que hubiera quedado abierto.
  if(typeof window.closeModal === 'function'){
    const _close = window.closeModal;
    window.closeModal = function(){ closeOpen(); return _close.apply(this, arguments); };
  }

  // Arranque: primera pasada + observer.
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded', ()=>{ runFieldEnhancers(); startObserver(); });
  } else { runFieldEnhancers(); startObserver(); }
})();


/* ============================================================
   COMMAND PALETTE (Cmd/Ctrl+K) — búsqueda global
   ------------------------------------------------------------
   Busca productos, clientes y documentos (ventas/compras) desde cualquier
   pantalla y salta directo: producto -> ficha, cliente -> vista Customers,
   documento -> ver factura. Navegable 100% con teclado (↑↓ Enter Esc).
   ============================================================ */
let _cmdkOpen = false;
function openCmdK(){
  if(_cmdkOpen) return;
  _cmdkOpen = true;
  const ov = document.createElement("div");
  ov.id = "cmdk-ov"; ov.className = "cmdk-ov";
  ov.innerHTML = `<div class="cmdk-box">
      <input class="cmdk-input" placeholder="Search products, customers, invoices…" autocomplete="off" spellcheck="false">
      <div class="cmdk-list"></div>
    </div>`;
  document.body.appendChild(ov);
  const input = ov.querySelector(".cmdk-input");
  const list  = ov.querySelector(".cmdk-list");
  let results = [], active = 0;

  const close = ()=>{ _cmdkOpen=false; document.removeEventListener("keydown", onKey, true); ov.remove(); };
  const hl = ()=>{ list.querySelectorAll(".cmdk-item").forEach((it,idx)=> it.classList.toggle("on", idx===active)); const el=list.querySelector(".cmdk-item.on"); if(el) el.scrollIntoView({block:"nearest"}); };
  const paint = ()=>{
    if(!results.length){ list.innerHTML = `<div class="cmdk-empty">${input.value.trim()?"No matches":"Type to search products, customers, invoices"}</div>`; return; }
    list.innerHTML = results.map((r,idx)=>`<button class="cmdk-item${idx===active?" on":""}" data-idx="${idx}">
        <span class="cmdk-kind">${esc(r.kind)}</span>
        <span class="cmdk-label">${esc(r.label)}</span>
        ${r.sub?`<span class="cmdk-sub">${esc(r.sub)}</span>`:""}</button>`).join("");
    list.querySelectorAll(".cmdk-item").forEach(it=>{
      it.onclick = ()=> results[+it.dataset.idx].action();
      it.onmousemove = ()=>{ const idx=+it.dataset.idx; if(active!==idx){ active=idx; hl(); } };
    });
  };
  const build = (q)=>{
    q = (q||"").trim().toLowerCase();
    results = [];
    if(q){
      db.productos.filter(p=> ((p.nombre||"")+" "+(p.sku||"")).toLowerCase().includes(q)).slice(0,6)
        .forEach(p=> results.push({ kind:"Product", label:p.nombre||"—", sub:p.sku||"", action:()=>{ close(); if(typeof openFicha==="function") openFicha(p.id); } }));
      db.clientes.filter(c=> ((c.nombre||"")+" "+(c.empresa||"")).toLowerCase().includes(q)).slice(0,5)
        .forEach(c=> results.push({ kind:"Customer", label:c.nombre||"—", sub:c.empresa||"", action:()=>{ close(); if(typeof cliFiltro!=="undefined") cliFiltro=c.nombre||""; setView("clientes"); } }));
      const docs = [];
      (db.ventas||[]).forEach(d=> docs.push(["venta",d]));
      (db.compras||[]).forEach(d=> docs.push(["compra",d]));
      docs.filter(([t,d])=> ((d.numero||"")+" "+((d.cliente&&d.cliente.nombre)||d.contraparte||"")).toLowerCase().includes(q)).slice(0,6)
        .forEach(([t,d])=> results.push({ kind: t==="venta"?"Sale":"Purchase", label:(d.numero||"—")+" · "+((d.cliente&&d.cliente.nombre)||d.contraparte||"—"), sub: fmtDate(d.fecha), action:()=>{ close(); verDoc(t, d.id); } }));
    }
    active = 0; paint();
  };
  const onKey = (e)=>{
    if(e.key==="Escape"){ e.preventDefault(); e.stopPropagation(); close(); }
    else if(e.key==="ArrowDown"){ e.preventDefault(); if(results.length){ active=Math.min(active+1, results.length-1); hl(); } }
    else if(e.key==="ArrowUp"){ e.preventDefault(); if(results.length){ active=Math.max(active-1, 0); hl(); } }
    else if(e.key==="Enter"){ e.preventDefault(); if(results[active]) results[active].action(); }
  };
  input.oninput = ()=> build(input.value);
  ov.onmousedown = (e)=>{ if(e.target===ov) close(); };
  document.addEventListener("keydown", onKey, true);
  build(""); input.focus();
}
