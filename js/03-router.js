/* ============================================================
   gestordestock — 03-router.js
   Parte de la app. Se carga como <script> en el ORDEN del index.html.
   Todo vive en scope global (sin módulos), igual que antes.
   ============================================================ */
/* ============================================================
   Router de vistas
   ============================================================ */
/* ── P&L DESACTIVADA TEMPORALMENTE ─────────────────────────────
   Se oculta la pestaña en toda la UI sin borrar nada del código
   (viewPnL, 11b-view-pnl.js, i18n y export siguen intactos).
   Para reactivar: revertí este archivo o quitá los 3 bloques
   marcados con "P&L desactivada temporalmente".
   Este <style> con !important le gana al display inline que
   applyRoleUI() reescribe en cada render -> los botones de nav
   (desktop y mobile) quedan ocultos sin flash al cargar. */
(function(){
  var s = document.createElement("style");
  s.id = "pnl-off";
  s.textContent = '[data-view="pnl"]{display:none !important;}';
  (document.head || document.documentElement).appendChild(s);
})();
let view = "dash";
/* Nav de dos niveles (ERP): cada vista pertenece a una sección de nivel 1. */
const SECTION_OF = { dash:"op", ventas:"op", compras:"op", conjunta:"op", remitos:"op", mov:"op",
                     prod:"cat", clientes:"cat", analisis:"fin", pnl:"fin", inv:"fin", datos:"dat", usuarios:"dat" };
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
  if(v==="pnl") v="dash";   // ← P&L desactivada temporalmente: cualquier navegación cae al dashboard
  // gate: admin-only views (purchases, investment, analysis, data) fall back to dashboard for sellers
  if(!isAdmin() && ADMIN_VIEWS.includes(v)) v="dash";
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
  // store users get a read-only portal: hide the whole navigation.
  const store = isStore();
  ["nav","navSections","navMob"].forEach(id=>{ const el=document.getElementById(id); if(el) el.style.display = store?"none":""; });
  // role badge (mobile top bar): shows who is logged in and their role
  const admin = isAdmin();
  const nombre = (session && session.name) || (session && session.user) || "";
  const txt = !session ? t("role.local")
    : (admin ? t("role.admin")
      : (store ? (t("role.store")+" · "+(nombre||"—"))
        : (t("role.seller")+" · "+(nombre||"—"))));
  document.querySelectorAll("[data-rolebadge]").forEach(el=>{
    el.textContent = txt;
    el.style.background = admin ? "color-mix(in srgb, var(--accent) 16%, transparent)" : "color-mix(in srgb, var(--up) 18%, transparent)";
    el.style.color = admin ? "var(--accent-ink, var(--accent))" : "var(--up)";
  });
}
let _lastRenderView = null;
function render(){
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
  else if(view==="pnl") m.innerHTML = bar+viewDash();   // ← P&L desactivada temporalmente: no se invoca viewPnL()
  else if(view==="prod") m.innerHTML = bar+viewProd();
  else if(view==="compras") m.innerHTML = bar+viewDocs("compra");
  else if(view==="ventas") m.innerHTML = bar+viewDocs("venta");
  else if(view==="clientes") m.innerHTML = viewClientes();
  else if(view==="mov") m.innerHTML = isAdmin()? (bar+viewMov()) : viewDash();
  else if(view==="inv") m.innerHTML = isAdmin()? viewInversiones() : viewDash();
  else if(view==="conjunta") m.innerHTML = isAdmin()? viewConjunta() : viewDash();
  else if(view==="remitos") m.innerHTML = isAdmin()? viewRemitos() : viewDash();
  else if(view==="datos") m.innerHTML = viewDatos();
  else if(view==="usuarios") m.innerHTML = isAdmin()? viewUsuarios() : viewDash();
  applyRoleUI();
  if(typeof applyStaticI18n==="function") applyStaticI18n();
  activeSection = SECTION_OF[view] || activeSection;
  syncSectionUI();
  wireStoreBar();
  wire();
  if(sameView){
    if(fId){ const el=document.getElementById(fId); if(el){ try{ el.focus({preventScroll:true}); }catch(_){ try{el.focus();}catch(__){} } if(selS!=null && el.setSelectionRange){ try{ el.setSelectionRange(selS,selE); }catch(_){} } } }
    if(sy) window.scrollTo(0, sy);
    if(mSt && m) m.scrollTop = mSt;
  }
  _lastRenderView = view;
}

