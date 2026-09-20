/* ============================================================
   gestordestock — 16-view-datos.js
   Parte de la app. Se carga como etiqueta script en el ORDEN del index.html.
   Todo vive en scope global (sin módulos), igual que antes.
   ============================================================ */
/* ============================================================
   VISTA: Datos
   ============================================================ */
function viewDatos(){
  const conf = syncState==="conflict";
  const roleLbl = isAdmin() ? t("dat.acct.admin") : t("dat.acct.seller",{name:esc((session&&session.name)||"—")});
  const sepL = `<div style="height:1px;background:var(--line);margin:2px 18px"></div>`;
  const subH = (ti,hi)=>`<div style="padding:16px 18px 0"><div style="font-size:var(--fs-sm);font-weight:700;color:var(--text);text-transform:uppercase;letter-spacing:.4px">${ti}</div>${hi?`<p class="hint" style="margin:5px 0 0">${hi}</p>`:""}</div>`;
  const saveBtn = `<button class="btn" data-savecfg style="justify-self:start;margin-top:4px">${ICO.save}${t("common.save")}</button>`;
  return `
  <div class="head"><div class="title"><h2>${t("dat.title")}</h2><p>${t("dat.sub")}</p></div></div>

  <div class="panel">
    <div class="phead"><h3>${t("dat.acct")}</h3><span class="hint" data-syncchip>●</span></div>
    <div class="grid-form">
      <p class="hint" style="margin:0">
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
        <button class="btn" data-syncnow>${ICO.sync}${t("dat.syncnow")}</button>
        <button class="btn danger" data-logout>${ICO.logout}${t("tb.logout")}</button>
      </div>
      <p class="hint" style="margin:0">
        ${t("dat.inv.line",{sp:`<b>${esc(session?session.space:"main")}</b>`,rev:syncMeta.syncedRev,dirty:syncMeta.dirty?t("dat.inv.dirty"):""})}.
      </p>
    </div>
  </div>

  <div class="panel">
    <div class="phead"><h3>${t("dat.grp.money")}</h3></div>
    <div class="grid-form" style="grid-template-columns:1fr 1fr">
      <div class="field"><label>${t("dat.set.rate")} <span class="hint" style="font-weight:400">${t("dat.set.rate.hint")}</span></label><input class="inp num" id="cfgTC" value="${esc(String(db.config.tc||1000))}"></div>
      <div class="field"><label>${t("dat.set.repccy")} <span class="hint" style="font-weight:400">${t("dat.set.repccy.hint")}</span></label>
        <select class="inp" id="cfgRep">
          <option value="USD" ${reportCcy()==="USD"?"selected":""}>${t("dat.set.usd")}</option>
          <option value="ARS" ${reportCcy()==="ARS"?"selected":""}>${t("dat.set.ars")}</option>
        </select></div>
      ${saveBtn}
    </div>
    ${isAdmin()?`
    ${sepL}
    ${subH(t("dat.fx.title"), t("dat.fx.hint"))}
    <div class="grid-form" style="grid-template-columns:1fr 1fr auto;align-items:end">
      <div class="field"><label>${t("dat.fx.month")}</label><input class="inp" type="month" id="fxMes"></div>
      <div class="field"><label>${t("dat.fx.rate")}</label><input class="inp num" id="fxVal" inputmode="decimal" placeholder="0"></div>
      <button class="btn primary" data-fxadd style="margin-bottom:2px">${ICO.plus}${t("dat.fx.add")}</button>
    </div>
    <div style="margin-top:12px">
      ${(function(){
        const tm=db.config.tcMensual||{}; const ks=Object.keys(tm).filter(k=>+tm[k]>0).sort();
        if(!ks.length) return `<p class="hint" style="margin:0;padding:0 18px 14px">${t("dat.fx.empty")}</p>`;
        return `<div class="table-scroll"><table><thead><tr><th>${t("dat.fx.month")}</th><th class="r">${t("dat.fx.rate")}</th><th></th></tr></thead><tbody>`+ks.map(k=>{ const [y,mo]=k.split("-"); return `<tr><td style="font-weight:600">${t("cal.mon."+((+mo)-1))} ${y}</td><td class="r num">${nf0.format(tm[k])}</td><td class="r"><button class="btn sm danger" data-fxdel="${k}">${t("common.delete")}</button></td></tr>`; }).join("")+`</tbody></table></div>`;
      })()}
    </div>`:""}
  </div>

  <div class="panel">
    <div class="phead"><h3>${t("dat.grp.billing")}</h3><span class="hint">${t("dat.issuer.hint")}</span></div>
    <div class="grid-form" style="grid-template-columns:1fr 1fr">
      <div class="field" style="grid-column:1/3"><label>${t("dat.issuer.name")}</label><input class="inp" id="cfgEmNom" value="${esc((db.config.emisor||{}).nombre||"")}"></div>
      <div class="field" style="grid-column:1/3"><label>${t("dat.issuer.addr")}</label><input class="inp" id="cfgEmDir" value="${esc((db.config.emisor||{}).direccion||"")}"></div>
      <div class="field"><label>${t("dat.issuer.email")}</label><input class="inp" id="cfgEmMail" value="${esc((db.config.emisor||{}).email||"")}"></div>
      <div class="field"><label>${t("dat.issuer.phone")}</label><input class="inp" id="cfgEmTel" value="${esc((db.config.emisor||{}).tel||"")}"></div>
    </div>
    ${sepL}
    ${subH(t("dat.grp.numbering"), "")}
    <div class="grid-form" style="grid-template-columns:1fr 1fr">
      <div class="field"><label>${t("dat.set.startinv")}</label><input class="inp num" id="cfgFac" value="${esc(String(db.config.facturaInicio||101))}"></div>
      ${isAdmin()?`<div class="field"><label>${t("dat.set.remu")} <span class="hint" style="font-weight:400">${t("dat.set.remu.hint")}</span></label><input class="inp num" id="cfgRemU" value="${esc(String(remitoSeqInicio("U")))}"></div>
      <div class="field"><label>${t("dat.set.rema")} <span class="hint" style="font-weight:400">${t("dat.set.rema.hint")}</span></label><input class="inp num" id="cfgRemA" value="${esc(String(remitoSeqInicio("A")))}"></div>`:""}
      ${saveBtn}
    </div>
  </div>

  ${isAdmin()?`<div class="panel">
    <div class="phead"><h3>${t("dat.bud.title")}</h3></div>
    <p class="hint" style="margin:0;padding:14px 18px 0">${t("dat.bud.hint")}</p>
    <div class="grid-form" style="grid-template-columns:1fr 1fr 1fr auto;align-items:end">
      <div class="field"><label>${t("dat.fx.month")}</label><input class="inp" type="month" id="budMes"></div>
      <div class="field"><label>${t("dat.bud.net")} <span class="hint" style="font-weight:400">${monedaSym(reportCcy())}</span></label><input class="inp num" id="budNet" inputmode="decimal" placeholder="0"></div>
      <div class="field"><label>${t("dat.bud.contrib")} <span class="hint" style="font-weight:400">${monedaSym(reportCcy())}</span></label><input class="inp num" id="budContrib" inputmode="decimal" placeholder="0"></div>
      <button class="btn primary" data-budadd style="margin-bottom:2px">${ICO.plus}${t("dat.bud.add")}</button>
    </div>
    <div style="margin-top:12px">
      ${(function(){
        const bp=db.config.presupuesto||{}; const ks=Object.keys(bp).sort();
        if(!ks.length) return `<p class="hint" style="margin:0;padding:0 18px 14px">${t("dat.bud.empty")}</p>`;
        return `<div class="table-scroll"><table><thead><tr><th>${t("dat.fx.month")}</th><th class="r">${t("dat.bud.net")}</th><th class="r">${t("dat.bud.contrib")}</th><th></th></tr></thead><tbody>`+ks.map(k=>{ const [y,mo]=k.split("-"); const e=bp[k]||{}; const sym=monedaSym(e.ccy||"USD"); return `<tr><td style="font-weight:600">${t("cal.mon."+((+mo)-1))} ${y}</td><td class="r num">${sym} ${nf0.format(+e.net||0)}</td><td class="r num">${sym} ${nf0.format(+e.contrib||0)}</td><td class="r"><button class="btn sm danger" data-buddel="${k}">${t("common.delete")}</button></td></tr>`; }).join("")+`</tbody></table></div>`;
      })()}
    </div>
  </div>`:""}

  <div class="panel">
    <div class="phead"><h3>${t("dat.grp.backup")}</h3></div>
    <div class="grid-form">
      <p class="hint" style="margin:0">${t("dat.backup.sub")}</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn" data-export>${ICO.export}${t("dat.exportjson")}</button>
        <button class="btn" data-import-json>${ICO.upload}${t("dat.importjson")}</button>
      </div>
    </div>
  </div>

  ${isAdmin()?`<div class="panel" style="border-color:color-mix(in srgb,var(--alert) 40%,var(--line))">
    <div class="phead" style="background:var(--alert-bg)"><h3 style="color:var(--alert-ink)">${t("dat.grp.danger")}</h3></div>
    <div class="grid-form">
      <p class="hint" style="margin:0">${t("dat.grp.danger.hint")}</p>
      <div><button class="btn danger" data-reset>${ICO.reset}${t("dat.deleteall")}</button></div>
    </div>
  </div>`:""}`;
}

/* ---------- utilidades UI ---------- */
function esc(s){ return String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
/* Iconos SVG minimalistas (stroke = currentColor), para reemplazar emojis/glyphs feos */
/* ICO ahora vive en js/00c-icons.js (biblioteca global compartida). */
function emptyState(title,hint,cta){
  const btn = cta ? `<div class="empty-cta"><button class="btn primary" onclick="${cta.onclick}">${(window.ICO&&ICO.plus)||""}${cta.label}</button></div>` : "";
  return `<div class="empty"><div class="big">∅</div><p style="font-weight:600;color:var(--text)">${title}</p><p class="hint">${hint}</p>${btn}</div>`;
}

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
  if(typeof wirePnL==="function") wirePnL();
  wireDocFiltros();
  wireMovFiltros();
  wireClientes();
  if(typeof wireConjunta==="function") wireConjunta();
  if(typeof wireRemitos==="function") wireRemitos();
  // Alerta de reposición (banner + tarjeta): click / Enter / Espacio -> maestro filtrado
  // Chips de "pendientes" del Panel: navegación directa a la vista (item 7)
  m.querySelectorAll("[data-goto-view]").forEach(el=>{
    el.style.cursor="pointer";
    el.onclick=()=> setView(el.dataset.gotoView);
    el.onkeydown=e=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); setView(el.dataset.gotoView); } };
  });
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
    db.config.emisor = {
      nombre:(document.getElementById("cfgEmNom").value||"").trim(),
      direccion:(document.getElementById("cfgEmDir").value||"").trim(),
      email:(document.getElementById("cfgEmMail").value||"").trim(),
      tel:(document.getElementById("cfgEmTel").value||"").trim()
    };
    save(); toast(t("dat.tt.saved")); render();
  });
  // Tipo de cambio por mes (fix FX): alta/actualización y baja inmediatas.
  const fxAdd=m.querySelector("[data-fxadd]");
  if(fxAdd) fxAdd.onclick=()=>{
    const mes=(document.getElementById("fxMes").value||"").slice(0,7);
    const val=parseNum(document.getElementById("fxVal").value);
    if(!/^\d{4}-\d{2}$/.test(mes)){ toast(t("dat.fx.badmonth"),"warn"); return; }
    if(!(val>0)){ toast(t("dat.fx.badval"),"warn"); return; }
    db.config.tcMensual=db.config.tcMensual||{}; db.config.tcMensual[mes]=round2(val);
    save(); toast(t("dat.fx.saved")); render();
  };
  m.querySelectorAll("[data-fxdel]").forEach(b=> b.onclick=()=>{
    const k=b.dataset.fxdel; if(db.config.tcMensual){ delete db.config.tcMensual[k]; save(); render(); }
  });
  // Presupuesto por mes (#17): objetivos de ingreso neto y contribución.
  const budAdd=m.querySelector("[data-budadd]");
  if(budAdd) budAdd.onclick=()=>{
    const mes=(document.getElementById("budMes").value||"").slice(0,7);
    const net=parseNum(document.getElementById("budNet").value)||0;
    const con=parseNum(document.getElementById("budContrib").value)||0;
    if(!/^\d{4}-\d{2}$/.test(mes)){ toast(t("dat.fx.badmonth"),"warn"); return; }
    if(!(net>0) && !(con>0)){ toast(t("dat.bud.badval"),"warn"); return; }
    db.config.presupuesto=db.config.presupuesto||{};
    db.config.presupuesto[mes]={ net:round2(net), contrib:round2(con), ccy:reportCcy() };
    save(); toast(t("dat.bud.saved")); render();
  };
  m.querySelectorAll("[data-buddel]").forEach(b=> b.onclick=()=>{
    const k=b.dataset.buddel; if(db.config.presupuesto){ delete db.config.presupuesto[k]; save(); render(); }
  });

  // --- cuenta / sincronización ---
  const sNow=m.querySelector("[data-syncnow]"); if(sNow) sNow.onclick=()=> pullNow();
  const lo=m.querySelector("[data-logout]"); if(lo) lo.onclick=()=> logout();
  const cl=m.querySelector("[data-conflocal]"); if(cl) cl.onclick=()=>resolveConflict(true);
  const cs=m.querySelector("[data-confserver]"); if(cs) cs.onclick=()=>resolveConflict(false);

  // --- usuarios (vista aparte) ---
  if(document.getElementById("uAdd")) wireUsuariosView();

  paintSync();
}



/* ============================================================
   VISTA: Usuarios (admin) — accesos a la app
   ------------------------------------------------------------
   Credenciales en tabla D1 (API admin-only /users). Tarjeta por
   usuario; clic -> modal de edición. El % de comisión del vendedor
   sigue en db.config.vendedores (lo referencian las ventas).
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

function viewUsuarios(){
  const cliOpts=(db.clientes||[]).slice().sort((a,b)=>String(a.nombre||"").localeCompare(String(b.nombre||"")))
    .map(c=>`<option value="${esc(c.id)}">${esc(c.nombre||c.id)}</option>`).join("");
  return `
  <div class="head"><div class="title"><h2>${t("usr.title")}</h2><p>${t("usr.hint")}</p></div></div>

  <div class="panel">
    <div class="phead"><h3>${t("usr.h.new")}</h3></div>
    <div class="grid-form">
      <p class="hint" style="margin:0">${t("usr.desc")}</p>
      <div style="display:flex;gap:10px;align-items:end;flex-wrap:wrap">
        <div class="field" style="flex:1 1 150px"><label>${t("usr.f.name")}</label><input class="inp" id="uNewName"></div>
        <div class="field" style="flex:1 1 130px"><label>${t("usr.f.user")}</label><input class="inp" id="uNewUser" placeholder="${t("usr.f.user.ph")}"></div>
        <div class="field" style="flex:1 1 130px"><label>${t("usr.f.pass")}</label><input class="inp" id="uNewPass" type="password"></div>
        <div class="field" style="flex:0 0 130px"><label>${t("usr.f.role")}</label>
          <select class="inp" id="uNewRole">
            <option value="seller">${t("usr.role.seller")}</option>
            <option value="store">${t("usr.role.store")}</option>
            <option value="admin">${t("usr.role.admin")}</option>
          </select></div>
        <div class="field u-when-seller" style="flex:0 0 90px"><label>${t("usr.f.comm")}</label><input class="inp num" id="uComm" placeholder="${esc(String(round2((db.config.commissionRate||0)*100)))}"></div>
        <div class="field u-when-store" style="flex:1 1 180px;display:none"><label>${t("usr.f.cliente.pick")}</label>
          <select class="inp" id="uCli">
            <option value="">${t("usr.f.cliente.none")}</option>${cliOpts}
          </select></div>
        <button class="btn primary" id="uAdd" style="flex:0 0 auto">${ICO.adduser}${t("usr.add")}</button>
      </div>
    </div>
  </div>

  <div class="panel">
    <div class="phead"><h3>${t("usr.h.active")}</h3></div>
    <div style="padding:18px">
      <div id="usrCards"><p class="hint">${t("usr.loading")}</p></div>
      <div id="vendOrphans"></div>
    </div>
  </div>`;
}

function usrInitial(u){ const s=String(u.name||u.user||"?").trim(); return (s[0]||"?").toUpperCase(); }
function usrSubline(u){
  const role=usrRoleLabel(u.role);
  if(u.role==="seller"){ const v=vendedorById(u.vendedorId); const r=v?round2((v.rate!=null?v.rate:(db.config.commissionRate||0))*100):null; return "@"+u.user+" \u00b7 "+role+(r!=null?(" \u00b7 "+r+"% com."):""); }
  if(u.role==="store"){ return "@"+u.user+" \u00b7 "+role+" \u00b7 "+clienteNombre(u.clienteId); }
  return "@"+u.user+" \u00b7 "+role;
}
function renderUsrCards(users){
  if(!users || !users.length) return `<p class="hint">${t("usr.none")}</p>`;
  return `<div style="display:flex;flex-direction:column;gap:8px">`+users.map(u=>`
    <div class="usr-card" data-uedit="${esc(u.user)}" role="button" tabindex="0" style="display:flex;align-items:center;gap:12px;padding:12px 14px;border:1px solid var(--line,#e5e5e5);border-radius:12px;cursor:pointer">
      <span style="width:34px;height:34px;border-radius:50%;flex:none;display:inline-flex;align-items:center;justify-content:center;font-weight:800;background:color-mix(in srgb, var(--accent) 16%, transparent);color:var(--accent-ink,var(--accent))">${esc(usrInitial(u))}</span>
      <span style="display:flex;flex-direction:column;flex:1;min-width:0">
        <b style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(u.name||u.user)}</b>
        <span class="hint" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(usrSubline(u))}</span>
      </span>
      <span style="color:var(--muted);font-size:20px;line-height:1">\u203a</span>
    </div>`).join("")+`</div>`;
}
function renderVendOrphans(users){
  const used=new Set((users||[]).filter(u=>u.role==="seller").map(u=>String(u.vendedorId||"").toLowerCase()));
  const orphans=vendedores().filter(v=> !used.has(String(v.id).toLowerCase()));
  if(!orphans.length) return "";
  return `<div style="border-top:1px solid var(--line,#e5e5e5);margin-top:14px;padding-top:12px">
    <p class="hint" style="margin:0 0 8px">${t("usr.novend")}</p>
    ${orphans.map(v=>`<div class="vend-row" data-vrow="${esc(v.id)}" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px">
      <span class="sku" style="min-width:70px">${esc(v.id)}</span>
      <input class="inp" data-vname="${esc(v.id)}" value="${esc(v.nombre)}" style="max-width:180px">
      <span style="display:inline-flex;align-items:center;gap:4px"><input class="inp num" data-vrate="${esc(v.id)}" value="${esc(String(round2((v.rate!=null?v.rate:(db.config.commissionRate||0))*100)))}" style="max-width:80px" placeholder="%"><span class="hint" style="font-size:12px">${t("dat.sellers.comm")}</span></span>
      <button class="btn ghost sm" data-vdel="${esc(v.id)}" style="color:var(--alert)">${t("dat.sellers.remove")}</button>
    </div>`).join("")}
  </div>`;
}

async function loadUsuarios(){
  const box=document.getElementById("usrCards");
  const orphanBox=document.getElementById("vendOrphans");
  if(!box) return;
  try{
    const j=await apiUsers("GET");
    _usrCache=j.users||[];
    box.innerHTML=renderUsrCards(_usrCache);
    if(orphanBox) orphanBox.innerHTML=renderVendOrphans(_usrCache);
    wireUsrCards();
  }catch(e){
    box.innerHTML=`<p class="hint" style="color:var(--alert)">${t("usr.err")}: ${esc(String(e&&e.message||e))}</p>`;
  }
}

function wireUsrCards(){
  const m=document.getElementById("main");
  m.querySelectorAll("[data-uedit]").forEach(el=>{
    el.onclick=()=> openUsuarioModal((_usrCache||[]).find(u=>u.user===el.dataset.uedit));
    el.onkeydown=e=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); el.click(); } };
  });
  m.querySelectorAll("[data-vname]").forEach(inp=> inp.onchange=()=>{ const v=vendedorById(inp.dataset.vname); if(v){ v.nombre=(inp.value||"").trim()||v.id; save(); toast(t("dat.tt.renamed")); } });
  m.querySelectorAll("[data-vrate]").forEach(inp=> inp.onchange=()=>{ const v=vendedorById(inp.dataset.vrate); if(!v) return; const pct=parseNum(inp.value); if(isNaN(pct)){ inp.value=String(round2((v.rate||0)*100)); return; } v.rate=Math.min(1,Math.max(0,round2(pct)/100)); save(); toast(t("dat.tt.commset",{name:v.nombre,p:round2(v.rate*100)})); });
  m.querySelectorAll("[data-vdel]").forEach(b=> b.onclick=()=>{ const id=b.dataset.vdel; if(!confirm(t("dat.cf.delseller",{name:vendedorNombre(id)}))) return; db.config.vendedores=vendedores().filter(v=>v.id!==id); save(); toast(t("dat.tt.sellerremoved"),"warn"); loadUsuarios(); });
}

function openUsuarioModal(u){
  if(!u) return;
  const v = u.role==="seller" ? vendedorById(u.vendedorId) : null;
  const rate = v ? round2((v.rate!=null?v.rate:(db.config.commissionRate||0))*100) : round2((db.config.commissionRate||0)*100);
  const cliOpts=(db.clientes||[]).slice().sort((a,b)=>String(a.nombre||"").localeCompare(String(b.nombre||"")))
    .map(c=>`<option value="${esc(c.id)}" ${c.id===u.clienteId?"selected":""}>${esc(c.nombre||c.id)}</option>`).join("");
  const body=`
    <div class="grid-form" style="grid-template-columns:1fr 1fr;padding:0">
      <div class="field"><label>${t("usr.f.name")}</label><input class="inp" id="eName" value="${esc(u.name||"")}"></div>
      <div class="field"><label>${t("usr.f.user")}</label><input class="inp" value="${esc(u.user)}" disabled></div>
      <div class="field" style="grid-column:1/3"><label>${t("usr.md.pass")}</label><input class="inp" id="ePass" type="password" placeholder="\u2022\u2022\u2022\u2022"></div>
      <div class="field"><label>${t("usr.f.role")}</label>
        <select class="inp" id="eRole">
          <option value="seller" ${u.role==="seller"?"selected":""}>${t("usr.role.seller")}</option>
          <option value="store" ${u.role==="store"?"selected":""}>${t("usr.role.store")}</option>
          <option value="admin" ${u.role==="admin"?"selected":""}>${t("usr.role.admin")}</option>
        </select></div>
      <div class="field um-when-seller" style="${u.role==="seller"?"":"display:none"}"><label>${t("usr.f.comm")}</label><input class="inp num" id="eComm" value="${esc(String(rate))}"></div>
      <div class="field um-when-store" style="grid-column:1/3;${u.role==="store"?"":"display:none"}"><label>${t("usr.f.cliente.pick")}</label>
        <select class="inp" id="eCli"><option value="">${t("usr.f.cliente.none")}</option>${cliOpts}</select></div>
    </div>`;
  buildModal(t("usr.md.title")+" \u00b7 "+(u.name||u.user), body, [
    { cls:"btn danger", label:t("usr.del"), act: async()=>{
        if(!confirm(t("usr.cf.del",{u:u.user}))) return;
        try{ await apiUsers("DELETE",null,"?user="+encodeURIComponent(u.user)); toast(t("usr.tt.removed"),"warn"); closeModal(); loadUsuarios(); }
        catch(e){ toast(String(e&&e.message||e),"warn"); }
      } },
    { cls:"btn", label:t("usr.cancel"), act: closeModal },
    { cls:"btn primary", label:t("usr.save"), act: async()=>{
        const role=document.getElementById("eRole").value;
        const name=(document.getElementById("eName").value||"").trim();
        const pass=document.getElementById("ePass").value||"";
        const body2={ user:u.user, role, name };
        if(pass) body2.pass=pass;
        if(role==="seller"){
          const vid=(u.role==="seller" && u.vendedorId) ? u.vendedorId : u.user;
          const commPct=parseNum(document.getElementById("eComm").value);
          const rate2=isNaN(commPct)?(db.config.commissionRate||0):Math.min(1,Math.max(0,round2(commPct)/100));
          const vv=vendedorById(vid);
          if(!vv){ db.config.vendedores=vendedores().concat([{ id:vid, nombre:name||vid, rate:rate2 }]); }
          else { if(name) vv.nombre=name; if(!isNaN(commPct)) vv.rate=rate2; }
          save();
          body2.vendedorId=vid;
        } else if(role==="store"){
          const cid=document.getElementById("eCli").value;
          if(!cid){ toast(t("usr.tt.needcliente"),"warn"); return; }
          body2.clienteId=cid;
        }
        try{ await apiUsers("POST", body2); toast(t("usr.tt.added")); closeModal(); loadUsuarios(); }
        catch(e){ toast(String(e&&e.message||e),"warn"); }
      } }
  ]);
  const er=document.getElementById("eRole");
  if(er) er.onchange=()=>{
    const r=er.value;
    document.querySelectorAll(".um-when-seller").forEach(el=> el.style.display = r==="seller"?"":"none");
    document.querySelectorAll(".um-when-store").forEach(el=> el.style.display = r==="store"?"":"none");
  };
}

function wireUsuariosView(){
  loadUsuarios();
  const m=document.getElementById("main");
  const roleSel=document.getElementById("uNewRole");
  const applyAddRoleUI=()=>{
    const r=roleSel?roleSel.value:"seller";
    m.querySelectorAll(".u-when-seller").forEach(el=> el.style.display = r==="seller"?"":"none");
    m.querySelectorAll(".u-when-store").forEach(el=> el.style.display = r==="store"?"":"none");
  };
  if(roleSel) roleSel.onchange=applyAddRoleUI;
  applyAddRoleUI();
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
      const vid=user;
      const commPct=parseNum(document.getElementById("uComm").value);
      const rate=isNaN(commPct)?(db.config.commissionRate||0):Math.min(1,Math.max(0,round2(commPct)/100));
      const vv=vendedorById(vid);
      if(!vv){ db.config.vendedores=vendedores().concat([{ id:vid, nombre:name||vid, rate }]); }
      else { if(name) vv.nombre=name; if(!isNaN(commPct)) vv.rate=rate; }
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
      ["uNewUser","uNewPass","uNewName","uComm"].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=""; });
      loadUsuarios();
    }catch(e){ toast(String(e&&e.message||e),"warn"); }
  };
}
