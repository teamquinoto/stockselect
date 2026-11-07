/* ============================================================
   gestordestock (Select) — 09-compat-fin.js   (v83)
   PUENTE para el módulo de Finanzas & Reporting
   ------------------------------------------------------------
   Los módulos de Finanzas (05-metrics, 06-fpa, 11*, 31*) se escribieron
   para la otra app del grupo. Acá van las piezas chicas que esa app tiene
   y Select no, adaptadas a Select:
     · MONEDA ÚNICA USD: convertir es no hacer nada; el símbolo es US$.
     · Formato de números según el idioma (ES 1.234,56 · EN 1,234.56).
     · Librerías a demanda: XLSX ya viene cargado desde el index; ExcelJS
       (Excel con formato) se baja recién al exportar el P&L.
     · Ajuste del tamaño de los números grandes de las tarjetas KPI.
   Sólo define lo que falta: si algún día Select trae su propia versión,
   gana la de Select (cada definición chequea antes).
   ============================================================ */

/* ---------- Moneda: todo en USD ---------- */
function reportCcy(){ return "USD"; }
function storeCcy(){ return "USD"; }
function convertCcyAt(monto){ return monto; }          // identidad (no hay tipo de cambio)
function monedaSym(){ return CCY_SYM; }                // "USD"

/* ---------- Números (según el idioma, como money/qty) ---------- */
function nfDec(d){ return { format: n => _nfFor(d,d).format(n||0) }; }   // v100: según el idioma
/* Montos de gestión sin centavos ("USD 12.480"); el exacto queda en el tooltip. */
const moneyRound = n => CCY_SYM + " " + nfDec(0).format(Math.round(n||0));
function bigMoney(n){ return `<span title="${money(n)}">${moneyRound(n)}</span>`; }

/* ---------- Varios ---------- */
function isoLocal(d){ return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
function langOpts(){ return LANGS.map(([v,l])=> [v,l]); }
/* Envío cobrado al cliente (ingreso), misma regla que el P&L de siempre. */
function saleEnvioCobrado(d){ return (d && d.envio && d.envio.tipo==="monto") ? round2(+d.envio.monto||0) : 0; }
/* Select guarda el país como texto: se muestra tal cual. */
if(typeof paisLabel!=="function") window.paisLabel = function(v){ return v ? String(v) : ""; };
if(typeof nombreVis!=="function") window.nombreVis = function(v){ return String(v==null?"":v).trim(); };
/* Botón sólo ícono (con tooltip y aria-label). */
if(typeof iconBtn!=="function") window.iconBtn = function(attrs, icon, label, danger){
  return `<button type="button" class="btn ghost sm icon-only${danger?" danger-ghost":""}" ${attrs} title="${label}" aria-label="${label}">${icon}</button>`;
};

/* ---------- Librerías a demanda ----------
   libFalta(nombre, reintentar, avisoError): si la librería está, devuelve false y la
   función sigue; si falta, la carga, vuelve a llamar a `reintentar` y devuelve true. */
const FIN_LIBS = {
  xlsx:    { src:"https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js", ok:()=> !!window.XLSX },
  exceljs: { src:"vendor/exceljs.min.js", ok:()=> !!window.ExcelJS }
};
const _finLibCargando = {};
function finLibCargar(nombre){
  const L = FIN_LIBS[nombre];
  if(!L) return Promise.reject(new Error(nombre));
  if(L.ok()) return Promise.resolve();
  if(_finLibCargando[nombre]) return _finLibCargando[nombre];
  _finLibCargando[nombre] = new Promise((res, rej)=>{
    const s = document.createElement("script");
    s.src = L.src;
    s.onload = ()=> L.ok() ? res() : rej(new Error(nombre));
    s.onerror = ()=> rej(new Error(nombre));
    document.head.appendChild(s);
  });
  _finLibCargando[nombre].catch(()=>{ delete _finLibCargando[nombre]; });
  return _finLibCargando[nombre];
}
if(typeof libFalta!=="function") window.libFalta = function(nombre, reintentar, avisoError){
  const L = FIN_LIBS[nombre];
  if(!L || L.ok()) return false;
  finLibCargar(nombre).then(reintentar, ()=>{ if(avisoError) avisoError(); });
  return true;
};

/* ---------- Estado de Finanzas dentro de db ----------
   Plan de ventas (db.fpa), gastos de estructura (db.gastos) y fotos mensuales de
   stock (db.stockSnaps) sincronizan como el resto del estado. Se crean recién
   cuando hacen falta: así el JSON de quien no usa Finanzas no cambia. */
function finEnsureDb(){
  if(!db.fpa || !Array.isArray(db.fpa.versions)) db.fpa = { versions:[], vigente:null };
  if(!db.stockSnaps || typeof db.stockSnaps!=="object") db.stockSnaps = {};
}

/* ---------- Tarjetas KPI: el número grande siempre entra ----------
   El tamaño base sale del CSS. Si aun así un número no entra en su tarjeta
   (montos altos, 4 tarjetas por fila, ventana angosta), se achica de a 1px
   hasta que entre, con un mínimo de 16px. Corre en cada render de Finanzas. */
function fitKpiValues(root){
  (root||document).querySelectorAll(".kpi .val, .pj-big b").forEach(el=>{
    el.style.fontSize = "";
    if(!el.clientWidth) return;
    let fs = parseFloat(getComputedStyle(el).fontSize) || 30, guard = 0;
    while(el.scrollWidth > el.clientWidth + 1 && fs > 16 && guard++ < 30){ fs -= 1; el.style.fontSize = fs+"px"; }
  });
}
let _finFitTimer = null;
window.addEventListener("resize", ()=>{ clearTimeout(_finFitTimer); _finFitTimer = setTimeout(()=> fitKpiValues(), 120); });

/* ---------- Fotos mensuales de stock ----------
   Después de traer el estado del servidor, el admin congela los meses de stock ya
   cerrados que falten (como un cierre contable: no cambian aunque después se edite
   una compra vieja). Sólo agrega los meses nuevos; si hay conflicto de sync, no hace nada. */
if(typeof pullNow==="function"){
  const _pullNowBase = pullNow;
  pullNow = async function(){
    const r = await _pullNowBase.apply(this, arguments);
    try{
      if(session && isAdmin() && syncState!=="conflict" && typeof finFreezeStockSnaps==="function" && finFreezeStockSnaps()){
        if(typeof render==="function") render();
      }
      // v94 · el admin agrega (una sola vez) las cuentas de cobro del cliente que falten
      if(session && isAdmin() && syncState!=="conflict" && typeof cobroSembrarCuentas==="function" && cobroSembrarCuentas(db)){
        save(); if(typeof render==="function") render();
      }
    }catch(e){ console.warn("[finanzas] fotos de stock", e); }
    return r;
  };
}
