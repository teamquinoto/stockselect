/* ============================================================
   gestordestock — 90-boot.js
   Parte de la app. Se carga como <script> en el ORDEN del index.html.
   Todo vive en scope global (sin módulos), igual que antes.
   ============================================================ */

/* ============================================================
   GUARD DE CARGA — se ejecuta primero en el arranque.
   Si algún .js no cargó (no lo subiste, nombre mal escrito, o
   error de sintaxis adentro), muestra un cartel diciendo CUÁL,
   en vez de dejar la app rota en silencio.
   ============================================================ */
(function(){
  var REQ = [["01-core.js","storeName"],["02-engine.js","fifoLayers"],["03-router.js","setView"],["10-view-dashboard.js","sagaDe"],["11-view-analisis.js","hbars"],["12-view-investments.js","viewInversiones"],["13-view-productos.js","viewProd"],["14-view-documentos.js","viewDocs"],["15-view-movimientos.js","viewMov"],["16-view-datos.js","viewDatos"],["20-modal-producto.js","openProd"],["21-modal-documento.js","openDoc"],["17-view-clientes.js","ventasDeCliente"],["18-view-conjunta.js","viewConjunta"],["30-pdf.js","pdfReady"],["31-export-pnl.js","exportPnL"],["32-importar-pdf.js","openImport"],["33-ficha-producto.js","openFicha"],["34-datos-io.js","exportJSON"],["22-ui-modales.js","buildModal"]];
  var faltan = REQ.filter(function(p){ return typeof window[p[1]] !== "function"; })
                  .map(function(p){ return p[0]; });
  if (faltan.length){
    document.body.innerHTML =
      '<div style="font-family:system-ui,-apple-system,sans-serif;max-width:640px;margin:3rem auto;padding:1.5rem 1.75rem;border:1px solid #ffb3b3;border-radius:12px;background:#fff5f5;color:#611">'
      + '<h2 style="margin:0 0 .5rem;color:#c0392b">No se cargaron todos los archivos</h2>'
      + '<p style="margin:.25rem 0">La app no arranca porque falta(n) este(os) archivo(s) JS. Revisá que existan en la carpeta <code>js/</code> y que el nombre coincida EXACTO con el del index.html:</p>'
      + '<ul style="margin:.5rem 0">' + faltan.map(function(f){return "<li><code>js/"+f+"</code></li>";}).join("") + '</ul>'
      + '<p style="margin:.5rem 0 0;color:#a55;font-size:.9em">Causas típicas: te olvidaste de subir el archivo, le erraste al nombre, o hay un error de sintaxis adentro de ese archivo (miralo en la consola con F12).</p>'
      + '</div>';
    throw new Error("gestordestock: faltan .js -> " + faltan.join(", "));
  }
})();

/* ---------- Arranque ---------- */
// Cableado del login (elementos estáticos)
document.getElementById("loginBtn").onclick = doLogin;
document.getElementById("loginUser").addEventListener("keydown", e=>{ if(e.key==="Enter") document.getElementById("loginPass").focus(); });
document.getElementById("loginPass").addEventListener("keydown", e=>{ if(e.key==="Enter") doLogin(); });
// Ojito: mostrar / ocultar contraseña
const _pt=document.getElementById("loginPassToggle");
if(_pt) _pt.onclick=()=>{
  const p=document.getElementById("loginPass"); if(!p) return;
  const mostrar = p.type==="password";
  p.type = mostrar ? "text" : "password";
  _pt.classList.toggle("show", mostrar);
  const lbl = mostrar ? "Hide password" : "Show password";
  _pt.setAttribute("aria-label", lbl); _pt.title=lbl;
  p.focus();
};
// Botones estáticos (tema / cerrar sesión / sincronizar) — hay uno en el sidebar y otro en el nav mobile
document.querySelectorAll("[data-logout-side]").forEach(b=> b.onclick=logout);
document.querySelectorAll("[data-syncside]").forEach(b=> b.onclick=()=> pullNow());
document.querySelectorAll("[data-theme-toggle]").forEach(b=> b.onclick=toggleTheme);
// Topbar glass: al scrollear aparece el fondo tenue + hairline inferior
const _tb=document.getElementById("topbar");
if(_tb){ const onScroll=()=>_tb.classList.toggle("scrolled", (window.scrollY||document.documentElement.scrollTop)>4);
  window.addEventListener("scroll", onScroll, {passive:true}); onScroll(); }

/* ---------- Tema claro / oscuro ---------- */
const MOON_SVG='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
const SUN_SVG='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
function currentTheme(){ return document.documentElement.getAttribute("data-theme")==="dark" ? "dark" : "light"; }
function applyTheme(t){
  document.documentElement.setAttribute("data-theme", t);
  try{ localStorage.setItem("gstock_theme", t); }catch(e){}
  const meta=document.querySelector('meta[name="theme-color"]');
  if(meta) meta.setAttribute("content", t==="dark" ? "#0f141b" : "#1b2430");
  paintThemeBtn();
}
function toggleTheme(){ applyTheme(currentTheme()==="dark" ? "light" : "dark"); }
function paintThemeBtn(){
  const dark = currentTheme()==="dark";
  document.querySelectorAll("[data-themeicon]").forEach(el=>{
    el.innerHTML = dark ? MOON_SVG : SUN_SVG;         // ícono = modo actual; la posición indica el estado
  });
  document.querySelectorAll("[data-theme-toggle]").forEach(b=>{
    const t = dark ? "Cambiar a tema claro" : "Cambiar a tema oscuro";
    b.title = t; b.setAttribute("aria-label", t);
  });
}
paintThemeBtn();

if(session){
  // El stock es un pool único: todos (admin y vendedores) arrancan consolidados.
  activeStore = "all";
  // si un vendedor tenía abierta una vista admin-only, lo mandamos al panel
  if(!isAdmin() && ADMIN_VIEWS.includes(view)) view="dash";
  hideLogin();
  render();
  paintSync();
  pullNow();
} else {
  render();          // deja el DOM de la app armado por debajo
  showLogin();
}

/* Re-sincronizar al volver la conexión o el foco */
window.addEventListener("online", ()=>{ if(session){ syncMeta.dirty ? pushNow() : pullNow(); } });
document.addEventListener("visibilitychange", ()=>{ if(!document.hidden && session) pullNow(); });

/* ---------- Service worker (PWA offline) ---------- */
/* ============================================================
   Actualización controlada de la PWA (botón propio "Update").
   Cuando GitHub Pages publica una versión nueva, el navegador instala
   el SW nuevo pero lo deja en estado "waiting" (no lo activa solo).
   Detectamos ese estado y mostramos un botón flotante; al tocarlo, le
   mandamos SKIP_WAITING al SW y recargamos con la versión nueva.
   ============================================================ */
function mostrarBotonUpdate(sw){
  if(document.getElementById("pwaUpdate")) return;   // ya está en pantalla
  const bar = document.createElement("div");
  bar.id = "pwaUpdate";
  bar.innerHTML = `<span>New version available</span><button id="pwaUpdateBtn">Update</button>`;
  document.body.appendChild(bar);
  document.getElementById("pwaUpdateBtn").onclick = ()=>{
    if(sw) sw.postMessage({ type:"SKIP_WAITING" });   // pedile al SW que se active
    // cuando el nuevo SW tome control, recargamos una sola vez
    bar.querySelector("button").textContent = "Updating…";
  };
}
if ("serviceWorker" in navigator) {
  let recargando = false;
  // cuando el SW nuevo toma control (tras SKIP_WAITING), recargar la página una vez
  navigator.serviceWorker.addEventListener("controllerchange", ()=>{
    if(recargando) return; recargando = true; window.location.reload();
  });
  window.addEventListener("load", () => {
    // updateViaCache:'none' -> el chequeo de sw.js NUNCA sale del cache HTTP,
    // así reg.update() siempre ve la última versión publicada en GitHub.
    navigator.serviceWorker.register("sw.js", { updateViaCache:"none" }).then(reg=>{
      // si ya hay uno esperando al cargar (versión nueva lista), mostramos el botón
      if(reg.waiting && navigator.serviceWorker.controller) mostrarBotonUpdate(reg.waiting);
      // si aparece uno nuevo mientras la app está abierta, esperamos a que instale
      reg.addEventListener("updatefound", ()=>{
        const nuevo = reg.installing;
        if(!nuevo) return;
        nuevo.addEventListener("statechange", ()=>{
          if(nuevo.state==="installed" && navigator.serviceWorker.controller){
            mostrarBotonUpdate(reg.waiting || nuevo);
          }
        });
      });
      // --- Chequeo AUTOMÁTICO de versión nueva, sin salir/entrar ---
      // El navegador por su cuenta casi no chequea; lo forzamos nosotros:
      //  1) cada 60 s mientras la app está abierta
      //  2) cuando volvés a la pestaña (visibilitychange)
      //  3) cuando recuperás internet (online)
      // Cualquiera de estos, si encuentra un sw.js nuevo, dispara 'updatefound'
      // -> 'statechange' -> aparece el botón "Update" solo.
      const chequear = ()=>{ try{ reg.update(); }catch(e){} };
      setInterval(chequear, 60000);
      document.addEventListener("visibilitychange", ()=>{ if(!document.hidden) chequear(); });
      window.addEventListener("online", chequear);
      chequear();   // un primer chequeo apenas carga
    }).catch(err => console.warn("SW no registrado:", err));
  });
}

