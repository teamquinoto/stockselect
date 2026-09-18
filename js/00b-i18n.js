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
    "common.owner":"Owner", "common.units":"Units", "common.none":"None",
    "store.title":"My merchandise in transit", "store.sub":"Track your shipments from the US to Argentina and where each one is.",
    "store.readonly":"Read-only", "store.empty":"You have no merchandise in transit right now.",
    "store.noacct":"Your store account isn't linked to a customer yet. Ask the admin to set it up.",
    "store.gate.transit":"In transit<br>to AR", "store.gate.ar":"In AR<br>(arrived)", "store.gate.delivered":"Delivered",
    "store.units":"units", "store.products":"product(s)", "store.shipment":"Shipment", "store.delivered.title":"Delivered",
    // --- Third-party / cross-border view (conjunta) ---
    "conj.title":"Merchandise in transit · USA → Argentina",
    "conj.sub":"Each shipment is a track: see where the merchandise is and tap the one button for the next step. <b>Ours</b> = enters stock. <b>Third-party</b> = only tracked, ends in a split.",
    "conj.sendtransit":"Send to transit", "conj.sendtransit.tip":"Move own stock USA → AR", "conj.newjoint":"＋ New joint buy",
    "conj.needs":"What needs doing?",
    "conj.chip.ours":"Ours in transit · deliver in AR", "conj.chip.recv":"Third-party remitos · receive in AR", "conj.chip.resolve":"Third-party remitos · resolve split",
    "conj.ours.title":"Ours · en route to AR",
    "conj.ours.hint":"Own stock that already left the US. Receiving it makes it sellable in Select (AR), capitalizing the Argentine leg into the landed cost. Shown per product (that's how transit is stored today).",
    "conj.deliverall":"Deliver all in AR",
    "conj.ours.empty":"Nothing of ours in transit. Send stock with “Send to transit”.",
    "conj.badge.ours":"Ours · enters stock",
    "conj.gate.usa":"In USA<br>(Swan)", "conj.gate.transit":"In transit<br>to AR", "conj.gate.sellable":"Sellable<br>in AR (Select)",
    "conj.gate.arhands":"In AR<br>(in our hands)", "conj.gate.resolved":"Resolved<br>(split / delivery)",
    "conj.ours.next":"In transit to AR · next step is to deliver it into Select (AR)",
    "conj.writeoff":"Write-off", "conj.deliverar":"Deliver in AR",
    "conj.third.title":"Third-party (consignment)",
    "conj.third.hint":"Third-party merchandise we only track (never our stock or P&L). Tap a remito to see its products, tick the ones you want and apply the action to just those.",
    "conj.recvall":"Receive all in AR", "conj.deliverallonly":"Deliver all",
    "conj.third.empty":"No third-party in flow. It comes in from Purchases (type Third-party) or from “＋ New joint buy”.",
    "conj.noref":"(no ref)", "conj.products":"product(s)", "conj.badge.third":"Third-party · ",
    "conj.pill.transit":"in transit", "conj.pill.ar":"in AR",
    "conj.state":"State", "conj.untrack":"Remove from tracking",
    "conj.selected":"selected", "conj.wholeremito":"acting on the whole remito",
    "conj.warnresolve":"⚠ resolving issues an A remito and moves stock",
    "conj.dlremito":"Download remito", "conj.recvar":"Receive in AR", "conj.resolvear":"Resolve in AR",
    "conj.gate2tip":"Gate 2 · transit → AR", "conj.resolvetip":"Split: commission → Select · rest → owner",
    "conj.byowner":"Third-party · by owner", "conj.byowner.hint":"who owns it and where",
    "conj.h.transit":"In transit", "conj.h.inar":"In AR", "conj.h.delivered":"Delivered",
    "conj.empty.owner":"No third-party merchandise yet.",
    "conj.mov.title":"Recent movements between deposits", "conj.h.deposit":"Deposit", "conj.h.movement":"Movement",
    "conj.empty.mov":"No transfers yet.",
    "conj.mv.sent":"→ sent", "conj.mv.recv":"← received", "conj.mv.comm":"commission in", "conj.mv.kept":"kept for Select", "conj.mv.wo":"write-off",
    "conj.hist.title":"Joint buys (history)", "conj.hist.hint":"old flow · read-only",
    "conj.h.ref":"Ref", "conj.h.order":"Order", "conj.h.third":"Third-party",
    "conj.remito.tip":"Internal transfer note (US→AR)", "conj.empty.hist":"No joint buys loaded yet."
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
    "common.owner":"Due\u00f1o", "common.units":"Unidades", "common.none":"Ninguno",
    "store.title":"Mi mercader\u00eda en viaje", "store.sub":"Segu\u00ed tus env\u00edos de EE.UU. a Argentina y en qu\u00e9 parte del viaje est\u00e1 cada uno.",
    "store.readonly":"S\u00f3lo lectura", "store.empty":"No ten\u00e9s mercader\u00eda en viaje en este momento.",
    "store.noacct":"Tu cuenta de tienda todav\u00eda no est\u00e1 vinculada a un cliente. Pedile al admin que la configure.",
    "store.gate.transit":"En tr\u00e1nsito<br>a AR", "store.gate.ar":"En AR<br>(lleg\u00f3)", "store.gate.delivered":"Entregado",
    "store.units":"unidades", "store.products":"producto(s)", "store.shipment":"Env\u00edo", "store.delivered.title":"Entregado",
    // --- Vista Terceros / cross-border (conjunta) ---
    "conj.title":"Mercader\u00eda en viaje · USA → Argentina",
    "conj.sub":"Cada env\u00edo es un riel: mir\u00e1 d\u00f3nde est\u00e1 la mercader\u00eda y toc\u00e1 el \u00fanico bot\u00f3n del pr\u00f3ximo paso. <b>Nuestra</b> = entra a stock. <b>Terceros</b> = s\u00f3lo se sigue, termina en un reparto.",
    "conj.sendtransit":"Despachar a tr\u00e1nsito", "conj.sendtransit.tip":"Mover stock propio USA → AR", "conj.newjoint":"＋ Nueva compra conjunta",
    "conj.needs":"\u00bfQu\u00e9 hay que hacer?",
    "conj.chip.ours":"Nuestra en tr\u00e1nsito · entregar en AR", "conj.chip.recv":"Remitos de terceros · recibir en AR", "conj.chip.resolve":"Remitos de terceros · resolver reparto",
    "conj.ours.title":"Nuestra · rumbo a AR",
    "conj.ours.hint":"Stock propio que ya sali\u00f3 de EE.UU. Al recibirlo se vuelve vendible en Select (AR), capitalizando el tramo argentino en el costo. Se muestra por producto (as\u00ed se guarda el tr\u00e1nsito hoy).",
    "conj.deliverall":"Entregar todo en AR",
    "conj.ours.empty":"Nada nuestro en tr\u00e1nsito. Mand\u00e1 stock con \u201cDespachar a tr\u00e1nsito\u201d.",
    "conj.badge.ours":"Nuestra · entra a stock",
    "conj.gate.usa":"En EE.UU.<br>(Swan)", "conj.gate.transit":"En tr\u00e1nsito<br>a AR", "conj.gate.sellable":"Vendible<br>en AR (Select)",
    "conj.gate.arhands":"En AR<br>(en nuestras manos)", "conj.gate.resolved":"Resuelto<br>(reparto / entrega)",
    "conj.ours.next":"En tr\u00e1nsito a AR · el pr\u00f3ximo paso es entregarla en Select (AR)",
    "conj.writeoff":"Merma", "conj.deliverar":"Entregar en AR",
    "conj.third.title":"Terceros (consignaci\u00f3n)",
    "conj.third.hint":"Mercader\u00eda ajena que s\u00f3lo seguimos (nunca es stock ni P&L). Toc\u00e1 un remito para ver sus productos, tild\u00e1 los que quieras y aplic\u00e1 la acci\u00f3n s\u00f3lo a esos.",
    "conj.recvall":"Recibir todo en AR", "conj.deliverallonly":"Entregar todo",
    "conj.third.empty":"No hay mercader\u00eda de terceros en flujo. Entra desde Compras (tipo Tercero) o desde \u201c＋ Nueva compra conjunta\u201d.",
    "conj.noref":"(sin ref)", "conj.products":"producto(s)", "conj.badge.third":"Terceros · ",
    "conj.pill.transit":"en tr\u00e1nsito", "conj.pill.ar":"en AR",
    "conj.state":"Estado", "conj.untrack":"Sacar del seguimiento",
    "conj.selected":"tildada(s)", "conj.wholeremito":"acci\u00f3n sobre todo el remito",
    "conj.warnresolve":"⚠ el reparto emite remito A y toca stock",
    "conj.dlremito":"Descargar remito", "conj.recvar":"Recibir en AR", "conj.resolvear":"Resolver en AR",
    "conj.gate2tip":"Puerta 2 · tr\u00e1nsito → AR", "conj.resolvetip":"Reparto: comisi\u00f3n → Select · resto → due\u00f1o",
    "conj.byowner":"Terceros · por due\u00f1o", "conj.byowner.hint":"qui\u00e9n es due\u00f1o y d\u00f3nde",
    "conj.h.transit":"En tr\u00e1nsito", "conj.h.inar":"En AR", "conj.h.delivered":"Entregado",
    "conj.empty.owner":"Todav\u00eda no hay mercader\u00eda de terceros.",
    "conj.mov.title":"Movimientos recientes entre dep\u00f3sitos", "conj.h.deposit":"Dep\u00f3sito", "conj.h.movement":"Movimiento",
    "conj.empty.mov":"Sin traspasos todav\u00eda.",
    "conj.mv.sent":"→ enviado", "conj.mv.recv":"← recibido", "conj.mv.comm":"comisi\u00f3n (ingreso)", "conj.mv.kept":"retenido para Select", "conj.mv.wo":"merma",
    "conj.hist.title":"Compras conjuntas (hist\u00f3rico)", "conj.hist.hint":"flujo viejo · s\u00f3lo lectura",
    "conj.h.ref":"Ref", "conj.h.order":"Pedido", "conj.h.third":"Tercero",
    "conj.remito.tip":"Remito interno (US→AR)", "conj.empty.hist":"No hay compras conjuntas cargadas."
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
