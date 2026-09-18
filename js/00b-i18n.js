/* ============================================================
   gestordestock — 00b-i18n.js
   Part of the app. Loaded as a <script> in the ORDER from index.html
   (FIRST, before 01-core, so t() exists for every later module).
   ------------------------------------------------------------
   Live EN/ES switch, same idea as the theme toggle:
     · lang() / setLang()   read & change the language (localStorage)
     · t(key, vars)         translate a key, {var} interpolation
     · applyStaticI18n()    re-label static DOM ([data-i18n*] attributes)
   On change we re-apply the static DOM and call render() so the whole
   app repaints in the new language. Adding a new view = add its keys to
   the two dictionaries below and wrap its strings in t("...").
   ============================================================ */
/* ============================================================
   Dictionaries. Keys are namespaced by area:
     nav.*  sec.*  tb.*  role.*  bar.*  common.*  (views add their own)
   English is the source of truth / fallback.
   ============================================================ */
var I18N = {
  en: {
    // sections (nav level 1)
    "sec.op":"Operations", "sec.cat":"Catalog", "sec.fin":"Finance", "sec.dat":"Data",
    // views (nav level 2)
    "nav.dash":"Dashboard", "nav.ventas":"Sales", "nav.compras":"Purchases",
    "nav.conjunta":"Third-party", "nav.remitos":"Remitos", "nav.mov":"Movements",
    "nav.prod":"Products", "nav.clientes":"Customers", "nav.analisis":"Analysis",
    "nav.inv":"Investments", "nav.datos":"Data",
    "nav.mov.short":"Movem.", "nav.clientes.short":"Cust.",
    // top bar
    "tb.sync":"Sync", "tb.theme":"Toggle theme", "tb.logout":"Sign out", "tb.lang":"Toggle language",
    // role badges
    "role.admin":"Admin", "role.seller":"Seller", "role.store":"Store", "role.local":"Local",
    // store / report bar
    "bar.viewas":"View as", "bar.units":"Units", "bar.cases":"Cases",
    "bar.society":"Society", "bar.society.tip":"Society = who bought the stock (provenance). Selling always uses the unified pool.",
    "bar.all":"All (consolidated)", "bar.reportin":"Report in", "bar.usd":"US$", "bar.ars":"AR$",
    // common buttons / words
    "common.save":"Save", "common.cancel":"Cancel", "common.delete":"Delete", "common.close":"Close",
    "common.search":"Search", "common.add":"Add", "common.edit":"Edit", "common.confirm":"Confirm",
    "common.download":"Download", "common.optional":"optional", "common.yes":"Yes", "common.no":"No",
    "common.total":"Total", "common.date":"Date", "common.product":"Product", "common.client":"Client",
    "common.owner":"Owner", "common.units":"Units", "common.none":"None"
  },
  es: {
    "sec.op":"Operaciones", "sec.cat":"Cat\u00e1logo", "sec.fin":"Finanzas", "sec.dat":"Datos",
    "nav.dash":"Panel", "nav.ventas":"Ventas", "nav.compras":"Compras",
    "nav.conjunta":"Terceros", "nav.remitos":"Remitos", "nav.mov":"Movimientos",
    "nav.prod":"Productos", "nav.clientes":"Clientes", "nav.analisis":"An\u00e1lisis",
    "nav.inv":"Inversiones", "nav.datos":"Datos",
    "nav.mov.short":"Movim.", "nav.clientes.short":"Client.",
    "tb.sync":"Sincronizar", "tb.theme":"Cambiar tema", "tb.logout":"Cerrar sesi\u00f3n", "tb.lang":"Cambiar idioma",
    "role.admin":"Admin", "role.seller":"Vendedor", "role.store":"Tienda", "role.local":"Local",
    "bar.viewas":"Ver como", "bar.units":"Unidades", "bar.cases":"Cajas",
    "bar.society":"Sociedad", "bar.society.tip":"Sociedad = qui\u00e9n compr\u00f3 el stock (procedencia). La venta siempre usa el pool unificado.",
    "bar.all":"Todas (consolidado)", "bar.reportin":"Reporte en", "bar.usd":"US$", "bar.ars":"AR$",
    "common.save":"Guardar", "common.cancel":"Cancelar", "common.delete":"Eliminar", "common.close":"Cerrar",
    "common.search":"Buscar", "common.add":"Agregar", "common.edit":"Editar", "common.confirm":"Confirmar",
    "common.download":"Descargar", "common.optional":"opcional", "common.yes":"S\u00ed", "common.no":"No",
    "common.total":"Total", "common.date":"Fecha", "common.product":"Producto", "common.client":"Cliente",
    "common.owner":"Due\u00f1o", "common.units":"Unidades", "common.none":"Ninguno"
  }
};

(function(){
  const LS_KEY = "gstock_lang";
  const SUPPORTED = ["en","es"];

  function normalize(l){ return SUPPORTED.indexOf(l)>=0 ? l : null; }
  function detect(){
    try{ const s=normalize(localStorage.getItem(LS_KEY)); if(s) return s; }catch(e){}
    try{ if((navigator.language||"").toLowerCase().startsWith("es")) return "es"; }catch(e){}
    return "en";
  }
  let CUR = detect();

  window.lang = function(){ return CUR; };
  window.setLang = function(l){
    l = normalize(l) || "en";
    if(l===CUR) return;
    CUR = l;
    try{ localStorage.setItem(LS_KEY, l); }catch(e){}
    document.documentElement.setAttribute("lang", l);
    document.documentElement.setAttribute("data-lang", l);
    applyStaticI18n();
    syncLangToggle();
    if(typeof render==="function") render();
  };

  /* t("some.key", {n:3}) -> string. Falls back es->en->key. */
  window.t = function(key, vars){
    const d = I18N[CUR] || I18N.en;
    let s = (d && d[key]!=null) ? d[key] : (I18N.en[key]!=null ? I18N.en[key] : key);
    if(vars) for(const k in vars) s = s.replace(new RegExp("\\{"+k+"\\}","g"), vars[k]);
    return s;
  };

  /* Re-label static markup:
       data-i18n       -> textContent
       data-i18n-title -> title attribute
       data-i18n-ph    -> placeholder attribute
       data-i18n-html  -> innerHTML (use sparingly) */
  window.applyStaticI18n = function(root){
    root = root || document;
    root.querySelectorAll("[data-i18n]").forEach(el=>{ el.textContent = t(el.getAttribute("data-i18n")); });
    root.querySelectorAll("[data-i18n-title]").forEach(el=>{ el.title = t(el.getAttribute("data-i18n-title")); });
    root.querySelectorAll("[data-i18n-ph]").forEach(el=>{ el.setAttribute("placeholder", t(el.getAttribute("data-i18n-ph"))); });
    root.querySelectorAll("[data-i18n-html]").forEach(el=>{ el.innerHTML = t(el.getAttribute("data-i18n-html")); });
  };

  window.langToggleHTML = function(){
    return `<div class="lang-switch" role="group" aria-label="Language">
      <button type="button" class="lang-opt" data-lang-set="en" title="English"><span class="flag">\u{1F1FA}\u{1F1F8}</span><span class="lc">EN</span></button>
      <button type="button" class="lang-opt" data-lang-set="es" title="Espa\u00f1ol"><span class="flag">\u{1F1E6}\u{1F1F7}</span><span class="lc">ES</span></button>
    </div>`;
  };
  function syncLangToggle(){
    document.querySelectorAll("[data-lang-set]").forEach(b=>
      b.classList.toggle("on", b.getAttribute("data-lang-set")===CUR));
  }
  window.syncLangToggle = syncLangToggle;

  // Delegated click for the flag toggle (works even though the topbar is static HTML).
  document.addEventListener("click", (e)=>{
    const b = e.target.closest && e.target.closest("[data-lang-set]");
    if(b){ e.preventDefault(); setLang(b.getAttribute("data-lang-set")); }
  });

  function boot(){
    document.documentElement.setAttribute("lang", CUR);
    document.documentElement.setAttribute("data-lang", CUR);
    applyStaticI18n();
    syncLangToggle();
  }
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
