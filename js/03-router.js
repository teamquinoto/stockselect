/* ============================================================
   gestordestock — 03-router.js
   Parte de la app. Se carga como <script> en el ORDEN del index.html.
   Todo vive en scope global (sin módulos), igual que antes.
   ============================================================ */
/* ============================================================
   Router de vistas
   ============================================================ */
let view = "dash";
document.querySelectorAll("#nav button, #navMob button").forEach(b=>{
  b.addEventListener("click", ()=> setView(b.dataset.view));
});
function setView(v){
  // gate: admin-only views (purchases, investment, analysis, data) fall back to dashboard for sellers
  if(!isAdmin() && ADMIN_VIEWS.includes(v)) v="dash";
  view = v;
  document.querySelectorAll("#nav button, #navMob button").forEach(b=>{
    b.classList.toggle("on", b.dataset.view===v);
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
  return `<div class="sb-viewas"><span class="sb-label">View as</span>
    <button class="chip-btn ${stockView==="units"?"on":""}" data-stockview="units">Units</button>
    <button class="chip-btn ${stockView==="cases"?"on":""}" data-stockview="cases">Cases</button></div>`;
}
function storeBarHTML(){
  const sw = stockViewSwitchHTML();
  // El desglose por sociedad (procedencia) es sólo para el admin, con 2+ sociedades,
  // y SÓLO en las vistas donde aporta (analisis, prod, compras). En dashboard, ventas
  // y movimientos el stock es un pool único -> sin chips. Sin chips ni toggle -> sin barra.
  const showChips = isAdmin() && STORE_IDS.length>1 && viewUsesSociety();
  if(!showChips && !sw) return "";
  const chips = [];
  if(showChips){
    chips.push(`<button class="chip-btn ${activeStore==="all"?"on":""}" data-store="all">All (consolidated)</button>`);
    STORE_IDS.forEach(s=> chips.push(`<button class="chip-btn ${activeStore===s?"on":""}" data-store="${s}">${esc(storeName(s))}</button>`));
  }
  const left = chips.length ? `<span class="sb-label" title="Society = who bought the stock (provenance). Selling always uses the unified pool.">Society</span>${chips.join("")}` : "";
  return `<div class="storebar">${left}${sw}</div>`;
}
function wireStoreBar(){
  document.querySelectorAll("[data-store]").forEach(b=> b.onclick=()=>{ activeStore=b.dataset.store; render(); });
  document.querySelectorAll("[data-stockview]").forEach(b=> b.onclick=()=>{ stockView=b.dataset.stockview; render(); });
}
function applyRoleUI(){
  // hide admin-only nav entries for sellers
  document.querySelectorAll("[data-admin-only]").forEach(el=> el.style.display = isAdmin()?"":"none");
  // role badge (mobile top bar): shows who is logged in and their role
  const admin = isAdmin();
  const nombre = (session && session.name) || (session && session.user) || "";
  const txt = session ? (admin ? "Admin" : ("Seller · "+(nombre||"—"))) : "Local";
  document.querySelectorAll("[data-rolebadge]").forEach(el=>{
    el.textContent = txt;
    el.style.background = admin ? "color-mix(in srgb, var(--accent) 16%, transparent)" : "color-mix(in srgb, var(--up) 18%, transparent)";
    el.style.color = admin ? "var(--accent-ink, var(--accent))" : "var(--up)";
  });
}
function render(){
  const m = document.getElementById("main");
  // El foco de sociedad (activeStore) sólo vive en Productos/Compras. En cualquier
  // otra vista el stock es un pool único: forzamos consolidado para que ni la tabla
  // de stock, ni las columnas, ni los conteos arrastren un foco de tienda latente.
  if(!viewUsesSociety()) activeStore = "all";
  const bar = storeBarHTML();
  if(view==="dash") m.innerHTML = bar+viewDash();
  else if(view==="analisis") m.innerHTML = bar+viewAnalisis();
  else if(view==="prod") m.innerHTML = bar+viewProd();
  else if(view==="compras") m.innerHTML = bar+viewDocs("compra");
  else if(view==="ventas") m.innerHTML = bar+viewDocs("venta");
  else if(view==="clientes") m.innerHTML = viewClientes();
  else if(view==="mov") m.innerHTML = isAdmin()? (bar+viewMov()) : viewDash();
  else if(view==="inv") m.innerHTML = isAdmin()? viewInversiones() : viewDash();
  else if(view==="datos") m.innerHTML = viewDatos();
  applyRoleUI();
  wireStoreBar();
  wire();
}

