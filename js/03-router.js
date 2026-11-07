/* ============================================================
   gestordestock — 03-router.js
   Parte de la app. Se carga como <script> en el ORDEN del index.html.
   Todo vive en scope global (sin módulos), igual que antes.
   ============================================================ */
/* ============================================================
   Router de vistas
   ============================================================ */
/* v83 · Finanzas & Reporting: la sección Finanzas pasa a tener Resumen, Ventas y
   margen, Estado de resultados (P&L), Gastos de estructura y Plan de ventas.
   (Se quitó el bloque que ocultaba la pestaña P&L.) */
let view = "dash";
/* Nav de dos niveles (ERP): cada vista pertenece a una sección de nivel 1. */
const SECTION_OF = { dash:"op", ventas:"op", compras:"op", conjunta:"op", remitos:"op", mov:"op",
                     prod:"cat", grupo:"cat", clientes:"cat",
                     resumen:"fin", analisis:"fin", pnl:"fin", gastos:"fin", plan:"fin", inv:"fin", datos:"dat", usuarios:"dat" };
let activeSection = "op";
document.querySelectorAll("#nav button, #navMob button").forEach(b=>{
  b.addEventListener("click", ()=> setView(b.dataset.view));
});
/* Nivel 1: al tocar una sección, mostramos sus vistas y saltamos a la primera visible. */
function syncSectionUI(){
  document.querySelectorAll('#navSections button[data-section]').forEach(b=>{
    const on = b.dataset.section===activeSection;
    b.classList.toggle("on", on);
    if(on) b.setAttribute("aria-current","true"); else b.removeAttribute("aria-current");
  });
  document.querySelectorAll('#nav button[data-view]').forEach(b=>
    b.classList.toggle("hide-sec", b.dataset.section!==activeSection));
}
function wireSections(){
  document.querySelectorAll('#navSections button[data-section]').forEach(b=> b.onclick=()=>{
    activeSection = b.dataset.section; syncSectionUI();
    const first = Array.prototype.slice.call(
      document.querySelectorAll('#nav button[data-section="'+activeSection+'"]')
    ).find(x=> x.style.display!=="none");
    if(first) setView(first.dataset.view);
  });
}
wireSections();
// Búsqueda global: Cmd/Ctrl+K abre la command palette desde cualquier pantalla.
document.addEventListener("keydown", (e)=>{
  if((e.metaKey||e.ctrlKey) && (e.key==="k"||e.key==="K")){ e.preventDefault(); if(typeof openCmdK==="function") openCmdK(); }
});
function setView(v){
  // Los filtros de Finanzas (período, mes, juego, idioma, país, vendedor) se MANTIENEN al
  // pasar entre Resumen, Ventas y margen, P&L y Plan; sólo se cierra el selector de mes.
  if(typeof finMesPickOpen!=="undefined") finMesPickOpen = false;
  // gate: admin-only views (purchases, investment, analysis, data) fall back to dashboard for sellers
  if(!vistaPermitida(v)) v="dash";   // v79: el editor tiene su propia lista
  view = v;
  document.querySelectorAll("#nav button, #navMob button").forEach(b=>{
    const on = b.dataset.view===v;
    b.classList.toggle("on", on);
    if(on) b.setAttribute("aria-current","page"); else b.removeAttribute("aria-current");
  });
  render();
  // Enter transition only on tab change (not on every re-render by sort/filter).
  const mm=document.getElementById("main");
  if(mm){ mm.classList.remove("view-anim"); void mm.offsetWidth; mm.classList.add("view-anim"); }
}
/* Store switcher: All (admin only) + one chip per allowed store. Point 1. */
function stockViewSwitchHTML(){
  // Punto 2: sólo en vistas de stock (dashboard / productos).
  if(view!=="dash" && view!=="prod") return "";
  return `<div class="sb-viewas"><span class="sb-label">${t("bar.viewas")}</span>
    <button class="chip-btn ${stockView==="units"?"on":""}" data-stockview="units">${t("bar.units")}</button>
    <button class="chip-btn ${stockView==="cases"?"on":""}" data-stockview="cases">${t("bar.cases")}</button></div>`;
}
function storeBarHTML(){
  const sw = stockViewSwitchHTML();
  // Foco por depósito (Swan / Select): admin, 2+ depósitos, en las vistas de
  // SOCIETY_VIEWS (stock, compras, ventas, kardex, análisis, P&L).
  const showChips = isAdmin() && STORE_IDS.length>1 && viewUsesSociety();
  const chips = [];
  if(showChips){
    chips.push(`<button class="chip-btn ${activeStore==="all"?"on":""}" data-store="all">${t("bar.all")}</button>`);
    STORE_IDS.forEach(s=> chips.push(`<button class="chip-btn st-chip st-${s} ${activeStore===s?"on":""}" data-store="${s}"><b>${storePais(s)}</b> ${esc(storeShort(s))}</button>`));
  }
  const left = chips.length ? `<span class="sb-label" title="${esc(t("bar.society.tip"))}">${t("bar.society")}</span>${chips.join("")}` : "";
  if(!left && !sw) return "";
  return `<div class="storebar">${left}${sw}</div>`;
}
function wireStoreBar(){
  document.querySelectorAll("[data-store]").forEach(b=> b.onclick=()=>{ activeStore=b.dataset.store; render(); });
  document.querySelectorAll("[data-stockview]").forEach(b=> b.onclick=()=>{ stockView=b.dataset.stockview; render(); });
}
function applyRoleUI(){
  // hide admin-only nav entries for sellers
  document.querySelectorAll("[data-admin-only]").forEach(el=> el.style.display = isAdmin()?"":"none");
  // v79 · editor: ve sólo sus pestañas (compras, movimientos, productos…), sin ventas ni finanzas
  if(isEditor()) document.querySelectorAll("#nav button[data-view], #navMob button[data-view], #tabbar button[data-view], #moreSheet button[data-view]")
    .forEach(el=>{ el.style.display = vistaPermitida(el.dataset.view) ? "" : "none"; });
  document.body.classList.toggle("role-editor", isEditor());
  document.body.classList.toggle("no-sku", !verSku());   // v94: el SKU es de orden interno, sólo lo ve el admin
  // store users get a read-only portal: hide the whole navigation.
  const store = isStore();
  ["nav","navSections","navMob"].forEach(id=>{ const el=document.getElementById(id); if(el) el.style.display = store?"none":""; });
  // role badge (mobile top bar): shows who is logged in and their role
  const admin = isAdmin();
  const nombre = (session && session.name) || (session && session.user) || "";
  const txt = !session ? t("role.local")
    : (admin ? t("role.admin")
      : (store ? (t("role.store")+" · "+(nombre||"—"))
        : ((isEditor()?t("role.editor"):t("role.seller"))+" · "+(nombre||"—"))));
  document.querySelectorAll("[data-rolebadge]").forEach(el=>{
    el.textContent = txt;
    el.style.background = admin ? "color-mix(in srgb, var(--accent) 16%, transparent)" : "color-mix(in srgb, var(--up) 18%, transparent)";
    el.style.color = admin ? "var(--accent-ink, var(--accent))" : "var(--up)";
  });
  // v107: chip de la barra superior igual a Prince — iniciales + nombre + rol
  const ini = String(nombre||"?").trim().split(/[\s._-]+/).filter(Boolean).map(w=>w[0]).join("").slice(0,2).toUpperCase() || "?";
  const rol = admin ? t("role.admin") : (store ? t("role.store") : (isEditor() ? t("role.editor") : t("role.seller")));
  document.querySelectorAll("[data-userchip]").forEach(el=>{
    el.hidden = !session;
    if(!session) return;
    el.title = (nombre||"") + " · " + rol;
    el.innerHTML = `<span class="tb-av">${esc(ini)}</span><span class="tb-uname">${esc(nombre||"—")}</span>`+
                   `<span class="tb-role ${admin?"adm":"sel"}">${esc(rol)}</span>`;
  });
}
let _lastRenderView = null;
function render(){
  // Finanzas: los rollups del P&L y la historia de stock se recalculan en cada render
  if(typeof _pnlCache!=="undefined") _pnlCache = { rev:-1, map:{} };
  if(typeof _stkCache!=="undefined") _stkCache = null;
  const m = document.getElementById("main");
  // Preservar foco/scroll SÓLO cuando es un re-render de la MISMA vista (filtro/orden),
  // no cuando se cambia de pestaña (ahí queremos ir arriba, como siempre).
  const sameView = (view === _lastRenderView);
  let fId=null, selS=null, selE=null, sy=0, mSt=0;
  if(sameView){
    const ae = document.activeElement;
    if(ae && ae.id){ fId = ae.id; if(ae.selectionStart!=null){ selS=ae.selectionStart; selE=ae.selectionEnd; } }
    sy = window.scrollY || window.pageYOffset || 0;
    mSt = m ? m.scrollTop : 0;
  }
  // El foco de sociedad (activeStore) sólo vive en Productos/Compras. En cualquier
  // otra vista el stock es un pool único: forzamos consolidado para que ni la tabla
  // de stock, ni las columnas, ni los conteos arrastren un foco de tienda latente.
  if(!viewUsesSociety()) activeStore = "all";
  // Store role: read-only portal, one view, no nav, no store/report bar.
  if(isStore()){
    m.innerHTML = viewStore();
    applyRoleUI();
    if(typeof applyStaticI18n==="function") applyStaticI18n();
    _lastRenderView = view;
    return;
  }
  const bar = storeBarHTML();
  if(view==="dash") m.innerHTML = bar+viewDash();
  else if(view==="analisis") m.innerHTML = bar+viewAnalisis();
  else if(view==="pnl") m.innerHTML = isAdmin()? (bar+viewPnL()) : viewDash();
  else if(view==="resumen") m.innerHTML = isAdmin()? (bar+viewResumen()) : viewDash();   // v83
  else if(view==="gastos") m.innerHTML = isAdmin()? viewGastos() : viewDash();          // v83
  else if(view==="plan") m.innerHTML = isAdmin()? viewPlan() : viewDash();              // v83
  else if(view==="prod") m.innerHTML = bar+viewProd();
  else if(view==="compras") m.innerHTML = bar+viewDocs("compra");
  else if(view==="ventas") m.innerHTML = bar+viewDocs("venta");
  else if(view==="clientes") m.innerHTML = viewClientes();
  else if(view==="grupo") m.innerHTML = vistaPermitida("grupo")? viewGrupo() : viewDash();   // v81
  else if(view==="mov") m.innerHTML = vistaPermitida("mov")? (bar+viewMov()) : viewDash();
  else if(view==="inv") m.innerHTML = isAdmin()? viewInversiones() : viewDash();
  else if(view==="conjunta") m.innerHTML = vistaPermitida("conjunta")? viewConjunta() : viewDash();
  else if(view==="remitos") m.innerHTML = vistaPermitida("remitos")? viewRemitos() : viewDash();
  else if(view==="datos") m.innerHTML = viewDatos();
  else if(view==="usuarios") m.innerHTML = isAdmin()? viewUsuarios() : viewDash();
  applyRoleUI();
  if(typeof applyStaticI18n==="function") applyStaticI18n();
  activeSection = SECTION_OF[view] || activeSection;
  syncSectionUI();
  wireStoreBar();
  wire();
  // v83 · Finanzas: cada vista cablea lo suyo (filtros compartidos, detalle, modales)
  if(view==="pnl" && isAdmin() && typeof wirePnL==="function") wirePnL();
  if(view==="resumen" && isAdmin()) wireResumen();
  if(view==="plan" && isAdmin()) wirePlan();
  if(view==="gastos" && isAdmin()) wireGastos();
  if(typeof fitKpiValues==="function") fitKpiValues();
  if(sameView){
    if(fId){ const el=document.getElementById(fId); if(el){ try{ el.focus({preventScroll:true}); }catch(_){ try{el.focus();}catch(__){} } if(selS!=null && el.setSelectionRange){ try{ el.setSelectionRange(selS,selE); }catch(_){} } } }
    if(sy) window.scrollTo(0, sy);
    if(mSt && m) m.scrollTop = mSt;
  }
  _lastRenderView = view;
}

