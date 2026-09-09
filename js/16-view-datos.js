/* ============================================================
   gestordestock — 16-view-datos.js
   Parte de la app. Se carga como <script> en el ORDEN del index.html.
   Todo vive en scope global (sin módulos), igual que antes.
   ============================================================ */
/* ============================================================
   VISTA: Datos
   ============================================================ */
function viewDatos(){
  const conf = syncState==="conflict";
  const roleLbl = isAdmin() ? "Admin (master)" : `Seller · ${esc((session&&session.name)||"—")}`;
  return `
  <div class="head"><div class="title"><h2>Data</h2><p>Account, backup and settings.</p></div></div>

  <div class="panel">
    <div class="phead"><h3>Account</h3><span class="hint" data-syncchip>●</span></div>
    <div class="grid-form">
      <p style="margin:0;color:var(--muted);font-size:14px">
        Signed in as <b>${esc(session?session.user:"—")}</b> · <b>${esc(roleLbl)}</b>. Your data lives on the server:
        sign in from any device and see the same thing.
      </p>
      ${conf ? `<div class="banner warn">
        <div>It changed here <b>and</b> on the server since the last sync. Which one do you keep?
          <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn sm" data-confserver>Take the server's</button>
            <button class="btn sm danger" data-conflocal>Overwrite with this device's</button>
          </div>
        </div>
      </div>`:""}
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn" data-syncnow>↻ Sync now</button>
        <button class="btn danger" data-logout>Sign out</button>
      </div>
      <p style="font-size:12px;color:var(--muted);margin:0">
        Inventory: <b>${esc(session?session.space:"main")}</b> · synced rev ${syncMeta.syncedRev}${syncMeta.dirty?" · local changes not pushed":""}.
      </p>
    </div>
  </div>

  <div class="panel">
    <div class="phead"><h3>Backup</h3></div>
    <div class="grid-form">
      <p style="margin:0;color:var(--muted);font-size:14px">Extra JSON copy, on top of the server, to migrate or archive.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn" data-export>⤓ Export JSON</button>
        <button class="btn" data-import-json>⤒ Import JSON</button>
        ${isAdmin()?`<button class="btn danger" data-reset>Delete all</button>`:""}
      </div>
    </div>
  </div>

  <div class="panel">
    <div class="phead"><h3>Settings</h3></div>
    <div class="grid-form" style="grid-template-columns:1fr 1fr">
      <div class="field"><label>Currency symbol</label><input class="inp" id="cfgMon" value="${esc(db.config.moneda)}" maxlength="4"></div>
      <div class="field"><label>Starting invoice #</label><input class="inp num" id="cfgFac" value="${esc(String(db.config.facturaInicio||101))}"></div>
      ${isAdmin()?`<div class="field"><label>Default commission (% of margin)</label><input class="inp num" id="cfgComm" value="${esc(String(round2((db.config.commissionRate||0)*100)))}"></div>
      <div class="field" style="justify-content:flex-end"><p class="hint" style="font-size:11.5px;margin:0 0 8px">Default for new sellers. Each seller can override it below. Existing sales keep the rate they were booked at.</p></div>`:""}
      <button class="btn" data-savecfg style="justify-self:start;margin-top:4px">Save</button>
    </div>
  </div>

  ${isAdmin()?`<div class="panel">
    <div class="phead"><h3>Sellers</h3><span class="hint">who a sale can be credited to · each with their own commission %</span></div>
    <div class="grid-form">
      <p style="margin:0;color:var(--muted);font-size:13px">These are the people who sell (Teo, Tonio…). They're <b>not</b> societies: the stock is one shared pool. Each seller has <b>their own commission %</b> (on margin). To let a seller sign in on their own device, also add them to the Worker's <code>USERS</code> secret with the same id.</p>
      <div id="vendList" style="display:flex;flex-direction:column;gap:8px">
        ${vendedores().map(v=>`<div class="vend-row" data-vrow="${esc(v.id)}" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <span class="sku" style="min-width:70px">${esc(v.id)}</span>
          <input class="inp" data-vname="${esc(v.id)}" value="${esc(v.nombre)}" style="max-width:200px" placeholder="Display name">
          <span style="display:inline-flex;align-items:center;gap:4px"><input class="inp num" data-vrate="${esc(v.id)}" value="${esc(String(round2((v.rate!=null?v.rate:(db.config.commissionRate||0))*100)))}" style="max-width:80px" placeholder="%"><span class="hint" style="font-size:12px">% comm.</span></span>
          <button class="btn ghost sm" data-vdel="${esc(v.id)}" style="color:var(--alert)">Remove</button>
        </div>`).join("") || `<p class="hint">No sellers yet — add one below.</p>`}
      </div>
      <div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap;margin-top:4px">
        <div class="field"><label>New seller id</label><input class="inp" id="vNewId" placeholder="short id (no spaces)" style="max-width:170px"></div>
        <div class="field"><label>Display name</label><input class="inp" id="vNewName" placeholder="Full name" style="max-width:180px"></div>
        <div class="field"><label>Commission %</label><input class="inp num" id="vNewRate" placeholder="${esc(String(round2((db.config.commissionRate||0)*100)))}" style="max-width:110px"></div>
        <button class="btn" id="vAdd" style="margin-bottom:2px">+ Add seller</button>
      </div>
    </div>
  </div>`:""}

  <div class="panel">
    <div class="phead"><h3>Issuer details</h3><span class="hint">shown on the invoice PDF</span></div>
    <div class="grid-form" style="grid-template-columns:1fr 1fr">
      <div class="field" style="grid-column:1/3"><label>Name / company</label><input class="inp" id="cfgEmNom" value="${esc((db.config.emisor||{}).nombre||"")}"></div>
      <div class="field" style="grid-column:1/3"><label>Address</label><input class="inp" id="cfgEmDir" value="${esc((db.config.emisor||{}).direccion||"")}"></div>
      <div class="field"><label>Email</label><input class="inp" id="cfgEmMail" value="${esc((db.config.emisor||{}).email||"")}"></div>
      <div class="field"><label>Phone</label><input class="inp" id="cfgEmTel" value="${esc((db.config.emisor||{}).tel||"")}"></div>
      <button class="btn" data-savecfg style="justify-self:start;margin-top:4px">Save</button>
    </div>
  </div>`;
}

/* ---------- utilidades UI ---------- */
function esc(s){ return String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
/* Iconos SVG minimalistas (stroke = currentColor), para reemplazar emojis/glyphs feos */
const ICO = {
  select: `<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 12l3 3 5-6"/></svg>`,
  x:      `<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>`,
  trash:  `<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M10 11v6M14 11v6"/></svg>`
};
function emptyState(t,h){ return `<div class="empty"><div class="big">∅</div><p style="font-weight:600;color:var(--text)">${t}</p><p class="hint">${h}</p></div>`; }

/* ============================================================
   Eventos de la vista
   ============================================================ */
function wire(){
  const m = document.getElementById("main");
  m.querySelectorAll("[data-open]").forEach(b=> b.onclick=()=> openDoc(b.dataset.open));
  m.querySelectorAll("[data-newp]").forEach(b=> b.onclick=()=> openProd());
  m.querySelectorAll("[data-ficha]").forEach(tr=> tr.onclick=()=> openFicha(tr.dataset.ficha));
  wireDashFiltros();
  wireProd();
  wireAnalisis();
  wireDocFiltros();
  wireMovFiltros();
  wireClientes();
  if(typeof wireConjunta==="function") wireConjunta();
  // Alerta de reposición (banner + tarjeta): click / Enter / Espacio -> maestro filtrado
  m.querySelectorAll("[data-goto-pedir]").forEach(el=>{
    el.style.cursor="pointer";
    el.onclick=irAPedidos;
    el.onkeydown=e=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); irAPedidos(); } };
  });
  m.querySelectorAll("[data-editp]").forEach(b=> b.onclick=(e)=>{ e.stopPropagation(); openProd(b.dataset.editp); });
  m.querySelectorAll("[data-invret]").forEach(b=> b.onclick=(e)=>{ e.stopPropagation(); openReturnFromInvestment(b.dataset.invret); });
  m.querySelectorAll("[data-import]").forEach(b=> b.onclick=()=> openImport());
  const adj=m.querySelector("[data-adjust]"); if(adj) adj.onclick=()=> openAjuste();
  m.querySelectorAll("[data-delaj]").forEach(b=> b.onclick=()=> deleteAjuste(b.dataset.delaj));
  m.querySelectorAll("[data-vdoc]").forEach(b=> b.onclick=()=>{
    const [t,id]=b.dataset.vdoc.split(":"); verDoc(t,id);
  });
  m.querySelectorAll("[data-editdoc]").forEach(b=> b.onclick=()=>{
    const [t,id]=b.dataset.editdoc.split(":"); editDoc(t,id);
  });
  m.querySelectorAll("[data-deldoc]").forEach(b=> b.onclick=()=>{
    const [t,id]=b.dataset.deldoc.split(":"); deleteDoc(t,id);
  });
  const exp=m.querySelector("[data-export]"); if(exp) exp.onclick=exportJSON;
  const imp=m.querySelector("[data-import-json]"); if(imp) imp.onclick=importJSON;
  const rst=m.querySelector("[data-reset]"); if(rst) rst.onclick=resetAll;
  m.querySelectorAll("[data-savecfg]").forEach(cfg=> cfg.onclick=()=>{
    db.config.moneda = (document.getElementById("cfgMon").value||"$").trim()||"$";
    const fi=parseInt(document.getElementById("cfgFac").value,10); if(!isNaN(fi)&&fi>0) db.config.facturaInicio=fi;
    const commEl=document.getElementById("cfgComm");   // sólo lo renderiza el admin
    if(commEl){ const pct=parseNum(commEl.value); if(!isNaN(pct)) db.config.commissionRate = Math.min(1, Math.max(0, round2(pct)/100)); }
    db.config.emisor = {
      nombre:(document.getElementById("cfgEmNom").value||"").trim(),
      direccion:(document.getElementById("cfgEmDir").value||"").trim(),
      email:(document.getElementById("cfgEmMail").value||"").trim(),
      tel:(document.getElementById("cfgEmTel").value||"").trim()
    };
    save(); toast("Settings saved"); render();
  });

  // --- cuenta / sincronización ---
  const sNow=m.querySelector("[data-syncnow]"); if(sNow) sNow.onclick=()=> pullNow();
  const lo=m.querySelector("[data-logout]"); if(lo) lo.onclick=()=> logout();
  const cl=m.querySelector("[data-conflocal]"); if(cl) cl.onclick=()=>resolveConflict(true);
  const cs=m.querySelector("[data-confserver]"); if(cs) cs.onclick=()=>resolveConflict(false);

  // --- vendedores (ABM, admin) ---
  m.querySelectorAll("[data-vname]").forEach(inp=> inp.onchange=()=>{
    const v=vendedorById(inp.dataset.vname); if(v){ v.nombre=(inp.value||"").trim()||v.id; save(); toast("Seller renamed"); }
  });
  m.querySelectorAll("[data-vrate]").forEach(inp=> inp.onchange=()=>{
    const v=vendedorById(inp.dataset.vrate); if(!v) return;
    const pct=parseNum(inp.value);
    if(isNaN(pct)){ inp.value=String(round2((v.rate||0)*100)); return; }
    v.rate = Math.min(1, Math.max(0, round2(pct)/100));
    save(); toast(`${v.nombre}'s commission: ${round2(v.rate*100)}%`);
  });
  m.querySelectorAll("[data-vdel]").forEach(b=> b.onclick=()=>{
    const id=b.dataset.vdel;
    if(!confirm(`Remove seller "${vendedorNombre(id)}"?\n\nPast sales already credited to them keep their name and rate. New sales just won't offer this seller.`)) return;
    db.config.vendedores = vendedores().filter(v=>v.id!==id);
    save(); toast("Seller removed","warn"); render();
  });
  const vAdd=m.querySelector("#vAdd"); if(vAdd) vAdd.onclick=()=>{
    let id=(document.getElementById("vNewId").value||"").trim().toLowerCase().replace(/[^a-z0-9_-]/g,"");
    const nombre=(document.getElementById("vNewName").value||"").trim();
    const rpct=parseNum(document.getElementById("vNewRate").value);
    const rate = isNaN(rpct) ? (db.config.commissionRate||0) : Math.min(1, Math.max(0, round2(rpct)/100));
    if(!id){ toast("Enter a seller id (short, no spaces)","warn"); return; }
    if(vendedorById(id)){ toast("That id already exists","warn"); return; }
    db.config.vendedores = vendedores().concat([{ id, nombre: nombre||id, rate }]);
    save(); toast("Seller added"); render();
  };

  paintSync();
}

