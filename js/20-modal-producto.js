/* ============================================================
   gestordestock — 20-modal-producto.js
   Parte de la app. Se carga como <script> en el ORDEN del index.html.
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
  const nivOpts = NIVELES.map(([v,l])=>`<option value="${v}" ${p&&p.nivel===v?"selected":""}>${esc(l)}</option>`).join("");
  buildModal(p?"Edit product":"New product", `
    <div class="grid-form" style="grid-template-columns:1fr 1fr;padding:0">
      <div class="field"><label>SKU / código</label><input class="inp" id="p_sku" value="${p?esc(p.sku):""}"></div>
      <div class="field"><label>Unidad</label><input class="inp" id="p_uni" value="${p?esc(p.unidad):"u"}" placeholder="u, pack, box, case..."></div>
      <div class="field" style="grid-column:1/3"><label>Name</label><input class="inp" id="p_nom" value="${p?esc(p.nombre):""}"></div>
      ${!p ? `<div class="field"><label>Initial stock</label><input class="inp num" id="p_stk" value="0"></div>
      <div class="field"><label>Society</label><select class="inp" id="p_store">${(allowedStores()).map(s=>`<option value="${s}" ${s===(effectiveStores()[0]||STORE_IDS[0])?"selected":""}>${esc(storeName(s))}</option>`).join("")}</select></div>`
      : `<div class="field"><label>Total stock (all stores)</label><input class="inp num" value="${p.stock}" disabled></div>
      <div class="field"><label>Reorder point</label><input class="inp num" id="p_rep" value="${p.puntoRepedido}"></div>`}
      ${!p ? `<div class="field"><label>Reorder point</label><input class="inp num" id="p_rep" value="0"></div>` : ""}
    </div>

    <div class="grid-form" style="grid-template-columns:1fr 1fr;padding:0;margin-top:6px">
      <div class="field"><label>Language</label><select class="inp" id="p_idioma">
        <option value="" ${p&&!p.idioma?"selected":""}>—</option>
        ${LANGS.map(([v,l])=>`<option value="${v}" ${p&&p.idioma===v?"selected":""}>${esc(l)}</option>`).join("")}
      </select></div>
      <div class="field"><label>Inventory status</label><select class="inp" id="p_estado">
        <option value="sale" ${!p||p.estado==="sale"?"selected":""}>For sale</option>
        <option value="blocked" ${p&&p.estado==="blocked"?"selected":""}>Blocked / best-offer</option>
      </select></div>
    </div>
    ${p&&isAdmin()?`<p class="hint" style="font-size:12px;margin:6px 0 0">To hold units as investment, open the product and use “◈ To investments” — you pick how many units per society.</p>`:""}

    <div class="phead" style="margin:16px 0 6px;padding:0"><h3 style="font-size:13px">Costo</h3>
      <label style="font-size:12px;color:var(--muted);display:flex;gap:6px;align-items:center;cursor:pointer">
        <input type="checkbox" id="p_desglosa" ${desglosaInicial?"checked":""}> Break down components
      </label>
    </div>
    <div class="grid-form" style="grid-template-columns:1fr 1fr 1fr;padding:0">
      <div class="field" id="p_wrapNeto"><label>Net cost</label><input class="inp num" id="p_neto" value="${neto}"></div>
      <div class="field" id="p_wrapHand"><label>Handling</label><input class="inp num" id="p_hand" value="${hand}"></div>
      <div class="field" id="p_wrapFlete"><label>Freight</label><input class="inp num" id="p_flete" value="${fle}"></div>
      <div class="field" style="grid-column:1/4"><label>Total cost ${db.config.moneda}</label><input class="inp num" id="p_cos" value="${total}"></div>
    </div>

    <div class="phead" style="margin:16px 0 6px;padding:0"><h3 style="font-size:13px">List price</h3></div>
    <div class="grid-form" style="grid-template-columns:1fr 1fr;padding:0">
      <div class="field"><label>Markup % over total cost</label><input class="inp num" id="p_mk" value="${p&&p.ultimoCosto>0?round2((p.precioVenta/p.ultimoCosto-1)*100):0}"></div>
      <div class="field"><label>List price</label><input class="inp num" id="p_pv" value="${p?p.precioVenta:0}"></div>
    </div>
    <p class="hint" id="p_mgReal" style="font-size:12px;margin:6px 0 0"></p>

    <div class="phead" style="margin:16px 0 6px;padding:0"><h3 style="font-size:13px">Category & TCG hierarchy</h3></div>
    <div class="grid-form" style="grid-template-columns:1fr 1fr;padding:0">
      <div class="field"><label>Category</label><select class="inp" id="p_cat">${catOpts}</select></div>
      <div class="field"><label>Level</label><select class="inp" id="p_niv">${nivOpts}</select></div>
      <div class="field"><label>Packs per box</label><input class="inp num" id="p_ppb" value="${p?p.packsPorBox:PACKS_POR_BOX_DEF}"></div>
      <div class="field"><label>Units per Case</label><input class="inp num" id="p_bpc" value="${p?p.boxesPorCase:boxesCaseDefault(catActual)}"></div>
    </div>
    <p class="hint" style="font-size:12px;margin:6px 0 0">Units per Case autofills from the category (e.g. Pokémon = 6). Edit it if this product breaks the rule — it drives the “View as: Cases” conversion.</p>
    ${p?'<p style="font-size:12.5px;color:var(--muted);margin:14px 0 0">Stock changes come from purchases and sales, not here.</p>':''}
  `, [
    p && isAdmin() ? {label:"Delete",cls:"btn danger",act:()=>{ delProd(p.id); }} : null,
    {label:"Cancel",cls:"btn",act:closeModal},
    {label:"Save",cls:"btn primary",act:()=>saveProd(id)}
  ].filter(Boolean), true);

  // --- Lógica de costo: total = neto+handling+flete cuando se desglosa ---
  const $=x=>document.getElementById(x);
  function syncDesglose(){
    const on = $("p_desglosa").checked;
    ["p_wrapHand","p_wrapFlete"].forEach(w=> $(w).style.display = on?"":"none");
    $("p_wrapNeto").querySelector("label").textContent = on?"Net cost":"Net cost (= total)";
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
    $("p_mgReal").textContent = pv>0 ? `Real margin: ${nf0.format(mg)}% on revenue · ${money(pv-c)} per unit` : "Enter a price to see the real margin.";
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
  if(!nom){ toast("Enter a name","warn"); return; }
  const sku=g("p_sku").trim();
  const dup=skuEnUso(sku, id);
  if(dup){ toast(`El SKU "${sku}" ya lo usa "${dup.nombre}"`,"warn"); return; }
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
      fifoEntrada(p, initStore, stk, p.ultimoCosto, "Opening balance", null);
      moverStock(p, stk, p.ultimoCosto, "ajuste", null, "Opening balance", { store:initStore });
    }
  }
  save(); closeModal(); toast("Product saved"); render();
}
function delProd(id){
  const p=prodById(id);
  if(!confirm(`Delete "${p.nombre}"? Its historical movements are kept.`)) return;
  db.productos = db.productos.filter(x=>x.id!==id);
  save(); closeModal(); toast("Product deleted","warn"); render();
}

