/* ============================================================
   gestordestock — 20-modal-producto.js
   Parte de la app. Se carga como una etiqueta script en el ORDEN del index.html.
   Todo vive en scope global (sin módulos), igual que antes.
   ============================================================ */
/* ============================================================
   MODAL: Producto
   ============================================================ */
const CATEGORIAS = ["Pokémon TCG","Magic","One Piece TCG","Yu-Gi-Oh!","Disney Lorcana","Digimon","Dragon Ball","Flesh and Blood","Otros"];
const NIVELES = [["unidad","Unit / single"],["pack","Pack / booster (sealed)"],["box","Booster box"],["case","Case"]];

function openProd(id){
  const p = id ? prodById(id) : null;
  const neto = p?(p.costoNeto||0):0, hand = p?(p.costoHandling||0):0, fle = p?(p.costoFlete||0):0;
  const total = p?(p.ultimoCosto||0):0;
  const desglosaInicial = (hand>0 || fle>0);
  let catActual = p?(p.categoria || sagaDe(p) || "Otros"):"Otros";
  const catList = CATEGORIAS.includes(catActual) ? CATEGORIAS : [catActual, ...CATEGORIAS];
  const catOpts = catList.map(c=>`<option value="${esc(c)}" ${c===catActual?"selected":""}>${esc(c)}</option>`).join("");
  const nivOpts = NIVELES.map(([v,l])=>`<option value="${v}" ${p&&p.nivel===v?"selected":""}>${esc(t("prod.niv."+v))}</option>`).join("");
  buildModal(p?t("prod.md.edit"):t("prod.md.new"), `
    <div class="grid-form" style="grid-template-columns:1fr 1fr;padding:0">
      <div class="field"><label>${t("prod.l.sku")}</label><input class="inp" id="p_sku" value="${p?esc(p.sku):""}"></div>
      <div class="field"><label>${t("prod.l.unit")}</label><input class="inp" id="p_uni" value="${p?esc(p.unidad):"u"}" placeholder="${t('prod.ph.unit')}"></div>
      <div class="field" style="grid-column:1/3"><label>${t("prod.l.name")}</label><input class="inp" id="p_nom" value="${p?esc(p.nombre):""}"></div>
      ${!p ? `<div class="field"><label>${t("prod.l.initstock")}</label><input class="inp num" id="p_stk" value="0"></div>
      <div class="field"><label>${t("bar.society")}</label><select class="inp" id="p_store">${(allowedStores()).map(s=>`<option value="${s}" ${s===(effectiveStores()[0]||STORE_IDS[0])?"selected":""}>${esc(storeName(s))}</option>`).join("")}</select></div>`
      : `<div class="field"><label>${t("prod.l.totalstock")}</label><input class="inp num" value="${p.stock}" disabled></div>
      <div class="field"><label>${t("prod.l.reorder")}</label><input class="inp num" id="p_rep" value="${p.puntoRepedido}"></div>`}
      ${!p ? `<div class="field"><label>${t("prod.l.reorder")}</label><input class="inp num" id="p_rep" value="0"></div>` : ""}
    </div>

    <div class="grid-form" style="grid-template-columns:1fr 1fr;padding:0;margin-top:6px">
      <div class="field"><label>${t("prod.l.language")}</label><select class="inp" id="p_idioma">
        <option value="" ${p&&!p.idioma?"selected":""}>—</option>
        ${LANGS.map(([v,l])=>`<option value="${v}" ${p&&p.idioma===v?"selected":""}>${esc(l)}</option>`).join("")}
      </select></div>
      <div class="field"><label>${t("prod.l.invstatus")}</label><select class="inp" id="p_estado">
        <option value="sale" ${!p||p.estado==="sale"?"selected":""}>${t("prod.o.forsale")}</option>
        <option value="blocked" ${p&&p.estado==="blocked"?"selected":""}>${t("prod.o.blocked")}</option>
      </select></div>
    </div>
    ${p&&isAdmin()?`<p class="hint" style="font-size:12px;margin:6px 0 0">${t("prod.hint.invest")}</p>`:""}

    <div class="phead" style="margin:16px 0 6px;padding:0"><h3 style="font-size:13px">${t("prod.h.cost")}</h3>
      <label style="font-size:12px;color:var(--muted);display:flex;gap:6px;align-items:center;cursor:pointer">
        <input type="checkbox" id="p_desglosa" ${desglosaInicial?"checked":""}> ${t("prod.l.breakdown")}
      </label>
    </div>
    <div class="grid-form" style="grid-template-columns:1fr 1fr 1fr;padding:0">
      <div class="field" id="p_wrapNeto"><label>${t("prod.l.netcost")}</label><input class="inp num" id="p_neto" value="${neto}"></div>
      <div class="field" id="p_wrapHand"><label>${t("prod.l.handling")}</label><input class="inp num" id="p_hand" value="${hand}"></div>
      <div class="field" id="p_wrapFlete"><label>${t("prod.l.freight")}</label><input class="inp num" id="p_flete" value="${fle}"></div>
      <div class="field" style="grid-column:1/4"><label>${t("prod.l.totalcost",{ccy:db.config.moneda})}</label><input class="inp num" id="p_cos" value="${total}"></div>
    </div>

    <div class="phead" style="margin:16px 0 6px;padding:0"><h3 style="font-size:13px">${t("prod.l.listprice")}</h3></div>
    <div class="grid-form" style="grid-template-columns:1fr 1fr;padding:0">
      <div class="field"><label>${t("prod.l.markup")}</label><input class="inp num" id="p_mk" value="${p&&p.ultimoCosto>0?round2((p.precioVenta/p.ultimoCosto-1)*100):0}"></div>
      <div class="field"><label>${t("prod.l.listprice")}</label><input class="inp num" id="p_pv" value="${p?p.precioVenta:0}"></div>
    </div>
    <p class="hint" id="p_mgReal" style="font-size:12px;margin:6px 0 0"></p>

    <div class="phead" style="margin:16px 0 6px;padding:0"><h3 style="font-size:13px">${t("prod.h.category")}</h3></div>
    <div class="grid-form" style="grid-template-columns:1fr 1fr;padding:0">
      <div class="field"><label>${t("prod.l.category")}</label><select class="inp" id="p_cat">${catOpts}</select></div>
      <div class="field"><label>${t("prod.l.level")}</label><select class="inp" id="p_niv">${nivOpts}</select></div>
      <div class="field"><label>${t("prod.l.packsperbox")}</label><input class="inp num" id="p_ppb" value="${p?p.packsPorBox:PACKS_POR_BOX_DEF}"></div>
      <div class="field"><label>${t("prod.l.unitspercase")}</label><input class="inp num" id="p_bpc" value="${p?p.boxesPorCase:boxesCaseDefault(catActual)}"></div>
    </div>
    <p class="hint" style="font-size:12px;margin:6px 0 0">${t("prod.hint.percase")}</p>
    ${p?`<p style="font-size:13px;color:var(--muted);margin:14px 0 0">${t("prod.hint.stockchanges")}</p>`:""}
  `, [
    p && isAdmin() ? {label:t("common.delete"),cls:"btn danger",act:()=>{ delProd(p.id); }} : null,
    {label:t("common.cancel"),cls:"btn",act:closeModal},
    {label:t("common.save"),cls:"btn primary",act:()=>saveProd(id)}
  ].filter(Boolean), true);

  // --- Lógica de costo: total = neto+handling+flete cuando se desglosa ---
  const $=x=>document.getElementById(x);
  function syncDesglose(){
    const on = $("p_desglosa").checked;
    ["p_wrapHand","p_wrapFlete"].forEach(w=> $(w).style.display = on?"":"none");
    $("p_wrapNeto").querySelector("label").textContent = on?t("prod.l.netcost"):t("prod.l.netcosttotal");
    $("p_cos").disabled = on;                 // si desglosás, el total es calculado
    if(on) recalcTotal(); else { $("p_neto").value = $("p_cos").value; }
  }
  function recalcTotal(){
    if(!$("p_desglosa").checked) return;
    const t = round2(parseNum($("p_neto").value)+parseNum($("p_hand").value)+parseNum($("p_flete").value));
    $("p_cos").value = t; syncMarkup("cos");
  }
  function totalCosto(){ return parseNum($("p_cos").value); }
  function pintarMargen(){
    const pv=parseNum($("p_pv").value), c=totalCosto();
    const mg = pv>0 ? (pv-c)/pv*100 : 0;
    const mgCcy = storeCcy((document.getElementById("p_store")||{}).value || (effectiveStores()[0]||STORE_IDS[0]));
    $("p_mgReal").textContent = pv>0 ? t("prod.mg.real",{p:nf0.format(mg),m:money(pv-c, mgCcy)}) : t("prod.mg.enter");
  }
  function syncMarkup(from){
    const c=totalCosto();
    if(from==="mk" || from==="cos"){ const mk=parseNum($("p_mk").value); $("p_pv").value = round2(c*(1+mk/100)); }
    else if(from==="pv"){ $("p_mk").value = c>0 ? round2((parseNum($("p_pv").value)/c-1)*100) : 0; }
    pintarMargen();
  }
  $("p_desglosa").onchange=syncDesglose;
  ["p_neto","p_hand","p_flete"].forEach(k=> $(k).oninput=()=>{ recalcTotal(); });
  $("p_cos").oninput=()=>{ if(!$("p_desglosa").checked) $("p_neto").value=$("p_cos").value; syncMarkup("cos"); };
  $("p_mk").oninput=()=>syncMarkup("mk");
  $("p_pv").oninput=()=>syncMarkup("pv");
  $("p_cat").onchange=()=>{ $("p_bpc").value = boxesCaseDefault($("p_cat").value); };
  syncDesglose(); pintarMargen();
  $("p_sku").focus();
}
function saveProd(id){
  const g=x=>document.getElementById(x).value;
  const nom=g("p_nom").trim();
  if(!nom){ toast(t("prod.tt.entername"),"warn"); return; }
  const sku=g("p_sku").trim();
  const dup=skuEnUso(sku, id);
  if(dup){ toast(t("prod.tt.dupsku",{sku:sku,name:dup.nombre}),"warn"); return; }
  const desglosa = document.getElementById("p_desglosa").checked;
  const neto = parseNum(g("p_neto"));
  const hand = desglosa ? parseNum(g("p_hand")) : 0;
  const flete = desglosa ? parseNum(g("p_flete")) : 0;
  const total = round2(neto + hand + flete);           // = p_cos cuando desglosa; = neto si no
  const estado = document.getElementById("p_estado") ? g("p_estado") : PRODUCT_STATES.SALE;
  const idioma = document.getElementById("p_idioma") ? g("p_idioma") : "";
  const campos = {
    sku, unidad:g("p_uni").trim()||"u", nombre:nom,
    costoNeto:neto, costoHandling:hand, costoFlete:flete, ultimoCosto:total,
    precioVenta:parseNum(g("p_pv")), puntoRepedido:parseNum(g("p_rep")),
    categoria:g("p_cat"), nivel:g("p_niv"), estado, idioma,
    packsPorBox:parseNum(g("p_ppb"))||PACKS_POR_BOX_DEF, boxesPorCase:parseNum(g("p_bpc"))||boxesCaseDefault(g("p_cat"))
  };
  if(id){
    const p = prodById(id);
    Object.assign(p, campos);
    // keep per-store price in sync when admin edits the base price and there's a single store in focus
    if(!p.precioVentaPorTienda) p.precioVentaPorTienda={};
  } else {
    const stk=parseNum(g("p_stk"));
    const initStore = document.getElementById("p_store") ? g("p_store") : (effectiveStores()[0]||STORE_IDS[0]);
    const p=Object.assign(nuevoProductoBase(sku, nom, parseNum(g("p_pv"))), campos);
    STORE_IDS.forEach(s=> p.precioVentaPorTienda[s]=parseNum(g("p_pv")));
    db.productos.push(p);
    if(stk){
      fifoEntrada(p, initStore, stk, p.ultimoCosto, t("prod.obs.opening"), null);
      moverStock(p, stk, p.ultimoCosto, "ajuste", null, t("prod.obs.opening"), { store:initStore });
    }
  }
  save(); closeModal(); toast(t("prod.tt.saved")); render();
}
function delProd(id){
  const p=prodById(id);
  if(!confirm(t("prod.cf.delete",{name:p.nombre}))) return;
  db.productos = db.productos.filter(x=>x.id!==id);
  save(); closeModal(); toast(t("prod.tt.deleted"),"warn"); render();
}

