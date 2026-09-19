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
  const roleLbl = isAdmin() ? t("dat.acct.admin") : t("dat.acct.seller",{name:esc((session&&session.name)||"—")});
  return `
  <div class="head"><div class="title"><h2>${t("dat.title")}</h2><p>${t("dat.sub")}</p></div></div>

  <div class="panel">
    <div class="phead"><h3>${t("dat.acct")}</h3><span class="hint" data-syncchip>●</span></div>
    <div class="grid-form">
      <p style="margin:0;color:var(--muted);font-size:14px">
        ${t("dat.acct.signedin",{u:`<b>${esc(session?session.user:"—")}</b>`,role:`<b>${esc(roleLbl)}</b>`})}
      </p>
      ${conf ? `<div class="banner warn">
        <div>${t("dat.conf.title")}
          <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn sm" data-confserver>${t("dat.conf.takeserver")}</button>
            <button class="btn sm danger" data-conflocal>${t("dat.conf.overwrite")}</button>
          </div>
        </div>
      </div>`:""}
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn" data-syncnow>${t("dat.syncnow")}</button>
        <button class="btn danger" data-logout>${t("tb.logout")}</button>
      </div>
      <p style="font-size:12px;color:var(--muted);margin:0">
        ${t("dat.inv.line",{sp:`<b>${esc(session?session.space:"main")}</b>`,rev:syncMeta.syncedRev,dirty:syncMeta.dirty?t("dat.inv.dirty"):""})}.
      </p>
    </div>
  </div>

  <div class="panel">
    <div class="phead"><h3>${t("dat.backup")}</h3></div>
    <div class="grid-form">
      <p style="margin:0;color:var(--muted);font-size:14px">${t("dat.backup.sub")}</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn" data-export>${t("dat.exportjson")}</button>
        <button class="btn" data-import-json>${t("dat.importjson")}</button>
        ${isAdmin()?`<button class="btn danger" data-reset>${t("dat.deleteall")}</button>`:""}
      </div>
    </div>
  </div>

  <div class="panel">
    <div class="phead"><h3>${t("dat.settings")}</h3></div>
    <div class="grid-form" style="grid-template-columns:1fr 1fr">
      <div class="field"><label>${t("dat.set.rate")} <span class="hint" style="font-weight:400">${t("dat.set.rate.hint")}</span></label><input class="inp num" id="cfgTC" value="${esc(String(db.config.tc||1000))}"></div>
      <div class="field"><label>${t("dat.set.repccy")} <span class="hint" style="font-weight:400">${t("dat.set.repccy.hint")}</span></label>
        <select class="inp" id="cfgRep">
          <option value="USD" ${reportCcy()==="USD"?"selected":""}>${t("dat.set.usd")}</option>
          <option value="ARS" ${reportCcy()==="ARS"?"selected":""}>${t("dat.set.ars")}</option>
        </select></div>
      <div class="field"><label>${t("dat.set.startinv")}</label><input class="inp num" id="cfgFac" value="${esc(String(db.config.facturaInicio||101))}"></div>
      ${isAdmin()?`<div class="field"><label>${t("dat.set.remu")} <span class="hint" style="font-weight:400">${t("dat.set.remu.hint")}</span></label><input class="inp num" id="cfgRemU" value="${esc(String(remitoSeqInicio("U")))}"></div>
      <div class="field"><label>${t("dat.set.rema")} <span class="hint" style="font-weight:400">${t("dat.set.rema.hint")}</span></label><input class="inp num" id="cfgRemA" value="${esc(String(remitoSeqInicio("A")))}"></div>`:""}
      ${isAdmin()?`<div class="field"><label>${t("dat.set.defcomm")}</label><input class="inp num" id="cfgComm" value="${esc(String(round2((db.config.commissionRate||0)*100)))}"></div>
      <div class="field" style="justify-content:flex-end"><p class="hint" style="font-size:11.5px;margin:0 0 8px">${t("dat.set.defcomm.hint")}</p></div>`:""}
      <button class="btn" data-savecfg style="justify-self:start;margin-top:4px">${t("common.save")}</button>
    </div>
  </div>

  ${isAdmin()?`<div class="panel">
    <div class="phead"><h3>${t("usr.title")}</h3><span class="hint">${t("usr.hint")}</span></div>
    <div class="grid-form">
      <p style="margin:0;color:var(--muted);font-size:13px">${t("usr.desc")}</p>

      <div id="usrList" style="display:flex;flex-direction:column;gap:8px">
        <p class="hint">${t("usr.loading")}</p>
      </div>

      <div style="border-top:1px solid var(--line,#e5e5e5);margin-top:6px;padding-top:12px;display:flex;gap:8px;align-items:end;flex-wrap:wrap">
        <div class="field"><label>${t("usr.f.user")}</label><input class="inp" id="uNewUser" placeholder="${t("usr.f.user.ph")}" style="max-width:140px"></div>
        <div class="field"><label>${t("usr.f.pass")}</label><input class="inp" id="uNewPass" type="password" placeholder="${t("usr.f.pass.keep")}" style="max-width:140px"></div>
        <div class="field"><label>${t("usr.f.role")}</label>
          <select class="inp" id="uNewRole" style="max-width:130px">
            <option value="seller">${t("usr.role.seller")}</option>
            <option value="store">${t("usr.role.store")}</option>
            <option value="admin">${t("usr.role.admin")}</option>
          </select></div>
        <div class="field"><label>${t("usr.f.name")}</label><input class="inp" id="uNewName" style="max-width:160px"></div>
        <div class="field u-when-seller"><label>${t("usr.f.vendedor.pick")}</label>
          <select class="inp" id="uVend" style="max-width:170px">
            ${vendedores().map(v=>`<option value="${esc(v.id)}">${esc(v.nombre)} (${esc(v.id)})</option>`).join("")}
            <option value="__new">${t("usr.f.vendedor.new")}</option>
          </select></div>
        <div class="field u-when-seller u-when-newvend" style="display:none"><label>${t("dat.sellers.newid")}</label><input class="inp" id="uVendId" placeholder="${t("dat.sellers.newid.ph")}" style="max-width:130px"></div>
        <div class="field u-when-seller"><label>${t("usr.f.comm")}</label><input class="inp num" id="uComm" placeholder="${esc(String(round2((db.config.commissionRate||0)*100)))}" style="max-width:90px"></div>
        <div class="field u-when-store" style="display:none"><label>${t("usr.f.cliente.pick")}</label>
          <select class="inp" id="uCli" style="max-width:200px">
            <option value="">${t("usr.f.cliente.none")}</option>
            ${(db.clientes||[]).slice().sort((a,b)=>String(a.nombre||"").localeCompare(String(b.nombre||""))).map(c=>`<option value="${esc(c.id)}">${esc(c.nombre||c.id)}</option>`).join("")}
          </select></div>
        <button class="btn" id="uAdd" style="margin-bottom:2px">${t("usr.add")}</button>
      </div>

      <div id="vendOrphans"></div>
    </div>
  </div>`:""}

  <div class="panel">
    <div class="phead"><h3>${t("dat.issuer")}</h3><span class="hint">${t("dat.issuer.hint")}</span></div>
    <div class="grid-form" style="grid-template-columns:1fr 1fr">
      <div class="field" style="grid-column:1/3"><label>${t("dat.issuer.name")}</label><input class="inp" id="cfgEmNom" value="${esc((db.config.emisor||{}).nombre||"")}"></div>
      <div class="field" style="grid-column:1/3"><label>${t("dat.issuer.addr")}</label><input class="inp" id="cfgEmDir" value="${esc((db.config.emisor||{}).direccion||"")}"></div>
      <div class="field"><label>${t("dat.issuer.email")}</label><input class="inp" id="cfgEmMail" value="${esc((db.config.emisor||{}).email||"")}"></div>
      <div class="field"><label>${t("dat.issuer.phone")}</label><input class="inp" id="cfgEmTel" value="${esc((db.config.emisor||{}).tel||"")}"></div>
      <button class="btn" data-savecfg style="justify-self:start;margin-top:4px">${t("common.save")}</button>
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
  if(typeof wireRemitos==="function") wireRemitos();
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
    const tcEl=document.getElementById("cfgTC"); if(tcEl){ const t=parseNum(tcEl.value); if(t>0) db.config.tc=t; }
    const repEl=document.getElementById("cfgRep"); if(repEl){ db.config.reportCcy = repEl.value==="ARS"?"ARS":"USD"; }
    const fi=parseInt(document.getElementById("cfgFac").value,10); if(!isNaN(fi)&&fi>0) db.config.facturaInicio=fi;
    const ru=document.getElementById("cfgRemU"); if(ru){ const n=parseInt(ru.value,10); if(!isNaN(n)&&n>0){ db.config.remitoSeq=db.config.remitoSeq||{}; db.config.remitoSeq.U={inicio:n}; } }
    const ra=document.getElementById("cfgRemA"); if(ra){ const n=parseInt(ra.value,10); if(!isNaN(n)&&n>0){ db.config.remitoSeq=db.config.remitoSeq||{}; db.config.remitoSeq.A={inicio:n}; } }
    const commEl=document.getElementById("cfgComm");   // sólo lo renderiza el admin
    if(commEl){ const pct=parseNum(commEl.value); if(!isNaN(pct)) db.config.commissionRate = Math.min(1, Math.max(0, round2(pct)/100)); }
    db.config.emisor = {
      nombre:(document.getElementById("cfgEmNom").value||"").trim(),
      direccion:(document.getElementById("cfgEmDir").value||"").trim(),
      email:(document.getElementById("cfgEmMail").value||"").trim(),
      tel:(document.getElementById("cfgEmTel").value||"").trim()
    };
    save(); toast(t("dat.tt.saved")); render();
  });

  // --- cuenta / sincronización ---
  const sNow=m.querySelector("[data-syncnow]"); if(sNow) sNow.onclick=()=> pullNow();
  const lo=m.querySelector("[data-logout]"); if(lo) lo.onclick=()=> logout();
  const cl=m.querySelector("[data-conflocal]"); if(cl) cl.onclick=()=>resolveConflict(true);
  const cs=m.querySelector("[data-confserver]"); if(cs) cs.onclick=()=>resolveConflict(false);

  // --- usuarios (ABM, admin) ---
  if(isAdmin()){
    loadUsuarios();
    const roleSel=document.getElementById("uNewRole");
    const uVendSel=document.getElementById("uVend");
    const applyRoleUI=()=>{
      const r=roleSel?roleSel.value:"seller";
      m.querySelectorAll(".u-when-seller").forEach(el=> el.style.display = r==="seller"?"":"none");
      m.querySelectorAll(".u-when-store").forEach(el=> el.style.display = r==="store"?"":"none");
      m.querySelectorAll(".u-when-newvend").forEach(el=> el.style.display = (r==="seller"&&uVendSel&&uVendSel.value==="__new")?"":"none");
    };
    if(roleSel) roleSel.onchange=applyRoleUI;
    if(uVendSel) uVendSel.onchange=applyRoleUI;
    applyRoleUI();

    const uAdd=document.getElementById("uAdd");
    if(uAdd) uAdd.onclick=async()=>{
      const user=(document.getElementById("uNewUser").value||"").trim().toLowerCase().replace(/[^a-z0-9_.-]/g,"");
      const pass=document.getElementById("uNewPass").value||"";
      const role=document.getElementById("uNewRole").value;
      const name=(document.getElementById("uNewName").value||"").trim();
      if(!user){ toast(t("usr.tt.needuser"),"warn"); return; }
      const existe=(_usrCache||[]).some(u=>u.user===user);
      if(!existe && !pass){ toast(t("usr.tt.needpass"),"warn"); return; }
      const body={ user, role, name };
      if(pass) body.pass=pass;
      if(role==="seller"){
        const sel=document.getElementById("uVend").value;
        let vid=sel;
        if(sel==="__new"){
          vid=((document.getElementById("uVendId").value||user)).trim().toLowerCase().replace(/[^a-z0-9_-]/g,"");
          if(!vid){ toast(t("dat.tt.enterid"),"warn"); return; }
        }
        const commPct=parseNum(document.getElementById("uComm").value);
        const rate=isNaN(commPct)?(db.config.commissionRate||0):Math.min(1,Math.max(0,round2(commPct)/100));
        const v=vendedorById(vid);
        if(!v){ db.config.vendedores=vendedores().concat([{ id:vid, nombre:name||vid, rate }]); }
        else { if(name) v.nombre=name; if(!isNaN(commPct)) v.rate=rate; }
        save();
        body.vendedorId=vid;
      } else if(role==="store"){
        const cid=document.getElementById("uCli").value;
        if(!cid){ toast(t("usr.tt.needcliente"),"warn"); return; }
        body.clienteId=cid;
      }
      try{
        await apiUsers("POST", body);
        toast(t("usr.tt.added"));
        ["uNewUser","uNewPass","uNewName","uVendId","uComm"].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=""; });
        loadUsuarios();
      }catch(e){ toast(String(e&&e.message||e),"warn"); }
    };
  }

  paintSync();
}



/* ============================================================
   USUARIOS (admin) — ABM contra el Worker (tabla D1 "usuarios")
   ------------------------------------------------------------
   Las credenciales NO viven en el db sincronizado: se gestionan
   por API admin-only (/users). El % de comisión del vendedor SÍ
   sigue en db.config.vendedores (lo referencian las ventas); acá
   sólo se linkea/edita.
   ============================================================ */
let _usrCache = null;

async function apiUsers(method, body, qs){
  const res = await fetch(apiBase()+"/users"+(qs||""), {
    method, headers: authHeaders(), body: body?JSON.stringify(body):undefined
  });
  if(res.status===401){ forceLogout(); throw new Error("401"); }
  const j = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(j.error||("HTTP "+res.status));
  return j;
}

function usrRoleLabel(r){ return r==="admin"?t("usr.role.admin"):(r==="store"?t("usr.role.store"):t("usr.role.seller")); }
function clienteNombre(id){ const c=(db.clientes||[]).find(x=>x.id===id); return c?(c.nombre||c.id):(id||"\u2014"); }

function renderUsrRows(users){
  if(!users || !users.length) return `<p class="hint">${t("usr.none")}</p>`;
  return users.map(u=>{
    let link="\u2014";
    if(u.role==="seller"){
      const v=vendedorById(u.vendedorId);
      const rate=v?round2((v.rate!=null?v.rate:(db.config.commissionRate||0))*100):"";
      link=`<span class="sku">${esc(u.vendedorId||"\u2014")}</span>
        <span style="display:inline-flex;align-items:center;gap:4px">
          <input class="inp num" data-urate="${esc(u.vendedorId)}" value="${esc(String(rate))}" style="max-width:70px" placeholder="%">
          <span class="hint" style="font-size:12px">${t("dat.sellers.comm")}</span></span>`;
    } else if(u.role==="store"){
      link=esc(t("usr.linkedcli",{name:clienteNombre(u.clienteId)}));
    }
    return `<div class="vend-row" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <span class="sku" style="min-width:80px">${esc(u.user)}</span>
      <span class="rl-badge" style="min-width:72px;text-align:center">${esc(usrRoleLabel(u.role))}</span>
      <span style="flex:1;min-width:150px">${link}</span>
      <span class="hint">${esc(u.name||"")}</span>
      <button class="btn ghost sm" data-udel="${esc(u.user)}" style="color:var(--alert)">${t("usr.remove")}</button>
    </div>`;
  }).join("");
}

function renderVendOrphans(users){
  const used=new Set((users||[]).filter(u=>u.role==="seller").map(u=>String(u.vendedorId||"").toLowerCase()));
  const orphans=vendedores().filter(v=> !used.has(String(v.id).toLowerCase()));
  if(!orphans.length) return "";
  return `<div style="border-top:1px solid var(--line,#e5e5e5);margin-top:6px;padding-top:12px">
    <p class="hint" style="margin:0 0 8px">${t("usr.novend")}</p>
    ${orphans.map(v=>`<div class="vend-row" data-vrow="${esc(v.id)}" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <span class="sku" style="min-width:70px">${esc(v.id)}</span>
      <input class="inp" data-vname="${esc(v.id)}" value="${esc(v.nombre)}" style="max-width:180px">
      <span style="display:inline-flex;align-items:center;gap:4px"><input class="inp num" data-vrate="${esc(v.id)}" value="${esc(String(round2((v.rate!=null?v.rate:(db.config.commissionRate||0))*100)))}" style="max-width:80px" placeholder="%"><span class="hint" style="font-size:12px">${t("dat.sellers.comm")}</span></span>
      <button class="btn ghost sm" data-vdel="${esc(v.id)}" style="color:var(--alert)">${t("dat.sellers.remove")}</button>
    </div>`).join("")}
  </div>`;
}

async function loadUsuarios(){
  const box=document.getElementById("usrList");
  const orphanBox=document.getElementById("vendOrphans");
  if(!box) return;
  try{
    const j=await apiUsers("GET");
    _usrCache=j.users||[];
    box.innerHTML=renderUsrRows(_usrCache);
    if(orphanBox) orphanBox.innerHTML=renderVendOrphans(_usrCache);
    wireUsrRows();
  }catch(e){
    box.innerHTML=`<p class="hint" style="color:var(--alert)">${t("usr.err")}: ${esc(String(e&&e.message||e))}</p>`;
  }
}

function wireUsrRows(){
  const m=document.getElementById("main");
  m.querySelectorAll("[data-urate]").forEach(inp=> inp.onchange=()=>{
    const v=vendedorById(inp.dataset.urate); if(!v) return;
    const pct=parseNum(inp.value);
    if(isNaN(pct)){ inp.value=String(round2((v.rate||0)*100)); return; }
    v.rate=Math.min(1,Math.max(0,round2(pct)/100)); save();
    toast(t("dat.tt.commset",{name:v.nombre,p:round2(v.rate*100)}));
  });
  m.querySelectorAll("[data-udel]").forEach(b=> b.onclick=async()=>{
    const u=b.dataset.udel;
    if(!confirm(t("usr.cf.del",{u}))) return;
    try{ await apiUsers("DELETE",null,"?user="+encodeURIComponent(u)); toast(t("usr.tt.removed"),"warn"); loadUsuarios(); }
    catch(e){ toast(String(e&&e.message||e),"warn"); }
  });
  m.querySelectorAll("[data-vname]").forEach(inp=> inp.onchange=()=>{
    const v=vendedorById(inp.dataset.vname); if(v){ v.nombre=(inp.value||"").trim()||v.id; save(); toast(t("dat.tt.renamed")); }
  });
  m.querySelectorAll("[data-vrate]").forEach(inp=> inp.onchange=()=>{
    const v=vendedorById(inp.dataset.vrate); if(!v) return;
    const pct=parseNum(inp.value);
    if(isNaN(pct)){ inp.value=String(round2((v.rate||0)*100)); return; }
    v.rate=Math.min(1,Math.max(0,round2(pct)/100)); save();
    toast(t("dat.tt.commset",{name:v.nombre,p:round2(v.rate*100)}));
  });
  m.querySelectorAll("[data-vdel]").forEach(b=> b.onclick=()=>{
    const id=b.dataset.vdel;
    if(!confirm(t("dat.cf.delseller",{name:vendedorNombre(id)}))) return;
    db.config.vendedores=vendedores().filter(v=>v.id!==id); save(); toast(t("dat.tt.sellerremoved"),"warn"); loadUsuarios();
  });
}
