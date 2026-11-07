/* ============================================================
   38 · PUERTA "DESPACHADO A COURIER" (Select · v80)
   ------------------------------------------------------------
   Circuito de la mercadería de terceros:
     en tránsito → en AR → DESPACHADO A COURIER → entregado
   - Al resolver en AR, la parte del dueño queda "despachada" con el
     courier y el número de seguimiento (cs.despacho). Si se entrega en
     mano / retira el dueño, va directo a "entregado".
   - Desde la tarjeta del remito: "Marcar entregado" cierra lo despachado.
   - Se ve en la tarjeta del remito, en el resumen por dueño y en el
     portal del cliente (con link de seguimiento).
   - La puerta de emergencia lo puede volver atrás (con motivo).
   - v96: por defecto "Entregado al dueño (como siempre)", igual que el circuito de
     antes. El courier queda como opción para cuando lo quieran usar.
   ============================================================ */
(function(){
  const EN = {
    "cr.cs.dispatched":"Dispatched to courier", "cr.gate.courier":"With courier",
    "cr.pill":"with courier", "cr.h.col":"With courier",
    "cr.l.delivery":"Delivery to the owner", "cr.o.courier":"Dispatched by courier (with tracking)", "cr.o.hand":"Delivered to the owner (as usual)",
    "cr.l.carrier":"Courier", "cr.l.tracking":"Tracking number", "cr.l.optional":"optional", "cr.o.other":"Other",
    "cr.ph.tracking":"e.g. 1Z999AA10123456784",
    "cr.b.deliver":"Mark delivered", "cr.md.deliver":"Mark as delivered to the owner",
    "cr.deliver.hint":"These lines were dispatched to the courier. Mark the ones the owner already received.",
    "cr.l.date":"Delivery date", "cr.tt.delivered":"{n} line(s) marked as delivered", "cr.tt.pick":"Tick at least one line",
    "cr.obs.hand":"delivered by hand", "cr.obs.delivered":"delivered by courier",
    "cr.chip":"with courier", "store.gate.courier":"With courier",
    "cr.tt.dispatched":"{n} u dispatched to the owner by courier · mark them delivered when they arrive"
  };
  const ES = {
    "cr.cs.dispatched":"Despachado a courier", "cr.gate.courier":"En courier",
    "cr.pill":"en courier", "cr.h.col":"En courier",
    "cr.l.delivery":"Entrega al dueño", "cr.o.courier":"Despachado por courier (con seguimiento)", "cr.o.hand":"Entregado al dueño (como siempre)",
    "cr.l.carrier":"Courier", "cr.l.tracking":"N° de seguimiento", "cr.l.optional":"opcional", "cr.o.other":"Otro",
    "cr.ph.tracking":"Ej.: 1Z999AA10123456784",
    "cr.b.deliver":"Marcar entregado", "cr.md.deliver":"Marcar como entregado al dueño",
    "cr.deliver.hint":"Estas líneas se despacharon por courier. Marcá las que el dueño ya recibió.",
    "cr.l.date":"Fecha de entrega", "cr.tt.delivered":"{n} línea(s) marcadas como entregadas", "cr.tt.pick":"Tildá al menos una línea",
    "cr.obs.hand":"entregado en mano", "cr.obs.delivered":"entregado por courier",
    "cr.chip":"en courier", "store.gate.courier":"En courier",
    "cr.tt.dispatched":"{n} u despachadas al dueño por courier · marcalas como entregadas cuando lleguen"
  };
  try{ Object.assign(I18N.en, EN); Object.assign(I18N.es, ES); }catch(e){ console.warn("courier i18n", e); }
})();

/* Texto corto del despacho: "UPS · 1Z99… · 03/11/2026" (con link si el courier lo tiene). */
function despachoInner(cs){
  const d = cs && cs.despacho; if(!d) return "";
  const r = { carrier:d.carrier||"", tracking:d.tracking||"" };
  const trk = d.tracking ? trackingHTML(r, "") : (d.carrier ? esc(carrierName(d.carrier)||d.carrier) : "");
  return `${trk}${d.fecha?` · ${esc(fmtDate(d.fecha))}`:""}`;
}
function despachoHTML(cs){
  const x = despachoInner(cs); if(!x) return "";
  return `<div class="hint" style="font-size:12px;margin-top:3px">${x}</div>`;
}

/* ---- Campos dentro del modal "Resolver en AR" ---- */
function courierResolverFieldsHTML(){
  const opts = (typeof CARRIERS!=="undefined" ? CARRIERS : []).map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("");
  return `
    <div class="field"><label>${t("cr.l.delivery")}</label>
      <select class="inp" id="res_entrega">
        <option value="mano" selected>${t("cr.o.hand")}</option>
        <option value="courier">${t("cr.o.courier")}</option>
      </select></div>
    <div class="field" id="res_carWrap"><label>${t("cr.l.carrier")}</label>
      <select class="inp" id="res_carrier"><option value="">—</option>${opts}<option value="otro">${t("cr.o.other")}</option></select></div>
    <div class="field" id="res_trkWrap" style="grid-column:1/-1"><label>${t("cr.l.tracking")} <span class="hint" style="font-weight:400">${t("cr.l.optional")}</span></label>
      <input class="inp" id="res_trk" placeholder="${t("cr.ph.tracking")}" autocomplete="off" spellcheck="false"></div>`;
}
function courierResolverWire(){
  const e=document.getElementById("res_entrega"); if(!e) return;
  const sync=()=>{ const mano = e.value==="mano";
    ["res_carWrap","res_trkWrap"].forEach(id=>{ const w=document.getElementById(id); if(w) w.style.display = mano ? "none" : ""; }); };
  e.onchange = sync; sync();
}
function courierResolverLeer(){
  const g=id=>{ const el=document.getElementById(id); return el ? String(el.value||"").trim() : ""; };
  const mano = g("res_entrega")==="mano";
  return { mano, despacho: mano ? null : { carrier:g("res_carrier"), tracking:g("res_trk").slice(0,80), fecha:hoyISO() } };
}

/* ---- Marcar entregado lo despachado de un remito ---- */
function openEntregarDespachados(key){
  if(!isAdmin() && !(typeof isEditor==="function" && isEditor())){ toast(t("conj.tt.adminstock"),"warn"); return; }
  const lines = remitoTargetLines(key, CONSIGN_ESTADOS.DESPACHADO);
  if(!lines.length) return;
  const rows = lines.map(cs=>`<tr>
      <td class="c"><input type="checkbox" class="cr-chk" data-crsel="${cs.id}" checked></td>
      <td>${esc(cs.nombre)}<div class="hint">${esc(cs.sku||"")} · ${esc(terceroNombre(cs))}</div>${despachoHTML(cs)}</td>
      <td class="r num">${qty(cs.cantidad)}</td>
    </tr>`).join("");
  buildModal(t("cr.md.deliver"), `
    <p class="hint" style="margin:0 0 10px">${t("cr.deliver.hint")}</p>
    <div class="table-scroll" style="margin-bottom:14px"><table class="rm-tbl">
      <thead><tr><th class="c"></th><th>${t("common.product")}</th><th class="r">${t("common.units")}</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <div class="grid-form" style="grid-template-columns:1fr 1fr;padding:0">
      <div class="field"><label>${t("cr.l.date")}</label><input class="inp" type="date" id="cr_fecha" value="${esc(hoyISO())}"></div>
    </div>`, [
    {label:t("common.cancel"),cls:"btn",act:closeModal},
    {label:t("cr.b.deliver"),cls:"btn primary",act:()=>{
      const ids=[...document.querySelectorAll(".cr-chk:checked")].map(c=>c.dataset.crsel);
      if(!ids.length){ toast(t("cr.tt.pick"),"warn"); return; }
      const fecha = (document.getElementById("cr_fecha").value||hoyISO());
      ids.forEach(id=> avanzarConsignacion(id, { obs:t("cr.obs.delivered"), fechaEntrega:fecha }));
      save(); closeModal(); toast(t("cr.tt.delivered",{n:ids.length}),"up"); render();
    }}
  ]);
}
/* Delegación: el botón vive en la tarjeta del remito (18) y no hace falta tocar su wire(). */
document.addEventListener("click", e=>{
  const b = e.target.closest && e.target.closest("[data-rm-deliver]");
  if(b){ e.preventDefault(); openEntregarDespachados(b.dataset.rmDeliver); }
});
