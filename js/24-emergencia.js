/* ============================================================
   gestordestock — 24-emergencia.js
   PUERTA DE EMERGENCIA (rescate de etapa) — SOLO ADMIN.
   ------------------------------------------------------------
   NO es de uso diario: es un "break glass" para errores operativos
   (ej. algo "en barco" que hay que rescatar a último momento).
   Revierte UN tramo del viaje físico, respetando la lógica del flujo:

        Miami (Swan/US)  →  Barco (__transito)  →  Argentina (Select/AR)
             ▲  ship_to_us          ▲  ar_to_ship
             └───────── vuelve ─────┴──────── vuelve ────────┘

   Reglas (por diseño):
     · Sólo admin. Motivo/causal OBLIGATORIO. Confirmación con fricción.
     · Descapitaliza EXACTO el costo del tramo que se revierte, usando el
       desglose d:{us,intl,arg} congelado en cada capa FIFO. Así el costo
       vuelve al valor que tenía en la etapa anterior (simétrico y auditable).
     · Deja traza de auditoría: kardex tipo "emergencia" (+ motivo) para el
       stock propio, e `historial[{emergencia:true}]` para las consignaciones.
     · Envuelto en withUndo (deshacer 5s) por si fue un mis-click.
     · NO desarma un "quedarse para Select" ya ingresado a stock (v1): eso
       tiene su propio revert. Se bloquea con mensaje claro.

   Este módulo es 100% aditivo: no toca el motor ni el worker. Se carga como
   <script> DESPUÉS de 18-view-conjunta.js en el index.
   ============================================================ */

/* Causales típicas. "other" exige detalle. Ampliables sin tocar el resto. */
const EMERG_CAUSALES = ["wrong_stage", "not_shipped", "customs_return", "client_change", "data_fix", "other"];
function emergCausalLabel(v) { return t("emg.cause." + v) || v; }

/* Tramos reversibles del viaje FÍSICO propio. origen/destino son funciones
   porque STORE_IDS puede remaparse (legacy). `strip` = componente del costo
   landed que se descapitaliza al volver una etapa. */
const EMERG_LEGS = {
  ar_to_ship: { origen: () => STORE_IDS[1] || STORE_IDS[0], destino: () => TRANSITO_STORE,        strip: "arg"  }, // Argentina → Barco
  ship_to_us: { origen: () => TRANSITO_STORE,               destino: () => STORE_IDS[0],          strip: "intl" }  // Barco → Miami
};
function emergLegLabel(k) {
  return k === "ar_to_ship" ? t("emg.leg.ar")   // "En Argentina → vuelve al Barco"
       : k === "ship_to_us" ? t("emg.leg.ship")  // "En Barco → vuelve a Miami"
       : k;
}

/* ---------------- WIDGET DE MOTIVO OBLIGATORIO ----------------
   Un <select> de causales + un detalle de texto. Devuelve el texto armado o
   null si no es válido (para frenar el confirm y avisar). */
function emergMotivoFieldHTML(idBase) {
  const opts = EMERG_CAUSALES.map(c => `<option value="${c}">${esc(emergCausalLabel(c))}</option>`).join("");
  return `
    <div class="field"><label>${t("emg.l.cause")} <span style="color:var(--alert)">*</span></label>
      <select class="inp" id="${idBase}_cause">${opts}</select></div>
    <div class="field"><label>${t("emg.l.detail")} <span class="hint" style="font-weight:400" id="${idBase}_req">${t("emg.l.detail.opt")}</span></label>
      <input class="inp" id="${idBase}_detail" placeholder="${t("emg.ph.detail")}"></div>`;
}
/* Marca el detalle como requerido cuando la causal es "other". Llamar tras render. */
function emergWireMotivo(idBase) {
  const sel = document.getElementById(idBase + "_cause");
  const req = document.getElementById(idBase + "_req");
  if (!sel || !req) return;
  const upd = () => { req.textContent = sel.value === "other" ? t("emg.l.detail.req") : t("emg.l.detail.opt"); };
  sel.onchange = upd; upd();
}
/* Lee y valida. Devuelve {ok, motivo} — motivo = "Causal — detalle". */
function emergReadMotivo(idBase) {
  const sel = document.getElementById(idBase + "_cause");
  const det = (document.getElementById(idBase + "_detail").value || "").trim();
  if (!sel) return { ok: false, motivo: "" };
  const causal = sel.value;
  if (causal === "other" && !det) { toast(t("emg.tt.needdetail"), "warn"); return { ok: false, motivo: "" }; }
  const motivo = emergCausalLabel(causal) + (det ? " — " + det : "");
  return { ok: true, motivo };
}

/* ============================================================
   NÚCLEO 1 — RESCATE DE STOCK PROPIO (retrocede un tramo con FIFO)
   ============================================================ */
/* Peek SIN mutar: costo actual, costo al volver y cuánto se descapitaliza,
   promediando las primeras `q` unidades en orden FIFO real (array order). */
function emergPeekOwn(prod, legKey, q) {
  const leg = EMERG_LEGS[legKey]; if (!leg) return { cur: 0, neo: 0, descap: 0, taken: 0 };
  const origen = leg.origen(), strip = leg.strip;
  let need = q, curTot = 0, newTot = 0, descTot = 0, taken = 0;
  for (const L of fifoLayers(prod, origen)) {
    if (need <= 0) break;
    const take = Math.min(L.cantidad, need);
    const d0 = L.d || { us: L.costoUnit, intl: 0, arg: 0 };
    const quitado = round2(d0[strip] || 0);
    const nuevo = round2((L.costoUnit || 0) - quitado);
    curTot += take * (L.costoUnit || 0); newTot += take * nuevo; descTot += take * quitado;
    taken += take; need -= take;
  }
  return {
    cur:    taken > 0 ? round2(curTot / taken)  : 0,
    neo:    taken > 0 ? round2(newTot / taken)  : 0,
    descap: taken > 0 ? round2(descTot / taken) : 0,
    taken
  };
}
/* Ejecuta el rescate. Consume FIFO del origen y recrea las capas en el destino
   con el costo del tramo descapitalizado (por capa, exacto). Deja kardex. */
function rescatarTramoOwn(prod, q, legKey, motivo, obs) {
  const leg = EMERG_LEGS[legKey]; if (!leg) return { movidas: 0, descap: 0 };
  const origen = leg.origen(), destino = leg.destino(), strip = leg.strip;
  q = Math.min(Math.max(0, +q || 0), stockDe(prod, origen));
  if (q <= 0) return { movidas: 0, descap: 0 };

  const nota = "🛟 " + t("emg.kardex.tag") + ": " + motivo + (obs ? " · " + obs : "");
  const { consumed } = fifoConsumir(prod, origen, q);   // muta capas del origen

  // --- salida del origen ---
  if (isBucket(origen)) {
    prod.stockPorTienda[origen] = round4((prod.stockPorTienda[origen] || 0) - q);
  } else {
    const outUnit = q > 0 ? round2(consumed.reduce((a, c) => a + (c.synthetic ? 0 : c.costoUnit * c.cantidad), 0) / q) : 0;
    moverStock(prod, -q, outUnit, "emergencia", null, "🛟 → " + storeName(destino), { store: origen, tipo: "emergencia-out", obs: nota });
  }

  // --- entrada al destino con el tramo descapitalizado ---
  let descapTot = 0, movedCost = 0;
  const nuevas = [];
  consumed.forEach(c => {
    if (c.synthetic) return;               // faltante sintético: no era stock real
    const d0 = c.d || { us: c.costoUnit, intl: 0, arg: 0 };
    const nd = { us: d0.us || 0, intl: d0.intl || 0, arg: d0.arg || 0 };
    const quitado = round2(nd[strip] || 0);
    nd[strip] = 0;
    const newCost = round2((nd.us || 0) + (nd.intl || 0) + (nd.arg || 0));
    descapTot += quitado * c.cantidad;
    movedCost += newCost * c.cantidad;
    nuevas.push({ id: uid(), fecha: new Date().toISOString(), cantidad: c.cantidad, costoUnit: newCost, d: nd, ref: "🛟 " + storeName(origen) });
  });

  if (isBucket(destino)) {
    nuevas.forEach(L => fifoLayers(prod, destino).push(L));
    prod.stockPorTienda[destino] = round4((prod.stockPorTienda[destino] || 0) + q);
  } else {
    nuevas.forEach(L => fifoLayers(prod, destino).push(L));
    const inUnit = q > 0 ? round2(movedCost / q) : 0;
    moverStock(prod, +q, inUnit, "emergencia", null, "🛟 ← " + storeName(origen), { store: destino, tipo: "emergencia-in", obs: nota });
    prod.ultimoCosto = q > 0 ? round2(movedCost / q) : prod.ultimoCosto;
  }
  save();
  return { movidas: q, descap: round2(descapTot) };
}

/* ============================================================
   NÚCLEO 2 — RESCATE DE CONSIGNACIÓN (retrocede la máquina de estados)
   entregado → en_ar → en_transito. NO desarma un keep-to-Select.
   ============================================================ */
function consignAnterior(e) { const i = CONSIGN_ORDEN.indexOf(e); return i > 0 ? CONSIGN_ORDEN[i - 1] : null; }
function retrocederConsignacion(id, motivo, obs) {
  const cs = consignAll().find(x => x.id === id); if (!cs) return null;
  if ((cs.keptForSelect || 0) > 0) { toast(t("emg.tt.keptblock"), "warn"); return null; }   // ya ingresó a Select
  const prev = consignAnterior(cs.estado); if (!prev) { toast(t("emg.tt.atorigin"), "warn"); return null; }
  // si vuelve de AR al barco, el courier cargado en la recepción ya no aplica
  if (cs.estado === CONSIGN_ESTADOS.AR && prev === CONSIGN_ESTADOS.TRANSITO) cs.costoCourierUnit = 0;
  cs.estado = prev;
  cs.historial.push({ estado: prev, fecha: new Date().toISOString(), obs: "🛟 " + motivo + (obs ? " · " + obs : ""), emergencia: true });
  save();
  return cs;
}

/* ============================================================
   UI — el panel de entrada elige el flujo (propio / terceros)
   ============================================================ */
function openPuertaEmergencia() {
  if (!isAdmin()) { toast(t("emg.tt.adminonly"), "warn"); return; }
  const body = `
    <div class="emg-warn" style="border:1px solid var(--alert);background:color-mix(in srgb,var(--alert) 8%,transparent);border-radius:10px;padding:12px 14px;margin:0 0 14px">
      <strong style="color:var(--alert)">${t("emg.md.warn.title")}</strong>
      <p class="hint" style="margin:6px 0 0">${t("emg.md.warn.body")}</p>
    </div>
    <div class="grid-form stack" style="padding:0;gap:10px">
      <button class="btn" id="emg_go_own" style="justify-content:flex-start">${ICO.plane} ${t("emg.md.pick.own")}</button>
      <button class="btn" id="emg_go_ter" style="justify-content:flex-start">${ICO.receive} ${t("emg.md.pick.ter")}</button>
    </div>`;
  buildModal(t("emg.md.title"), body, [{ label: t("common.cancel"), cls: "btn", act: closeModal }], "mini");
  const bo = document.getElementById("emg_go_own"); if (bo) bo.onclick = () => { closeModal(); openEmergenciaOwn(); };
  const bt = document.getElementById("emg_go_ter"); if (bt) bt.onclick = () => { closeModal(); openEmergenciaTercero(); };
}

/* ---- Flujo PROPIO: producto + etapa (auto por flujo) + unidades + motivo ---- */
function openEmergenciaOwn() {
  if (!isAdmin()) { toast(t("emg.tt.adminonly"), "warn"); return; }
  // productos con stock rescatable: en Select (AR) o en Tránsito (barco)
  const sel = STORE_IDS[1] || STORE_IDS[0];
  const prods = db.productos.filter(p => stockDe(p, sel) > 0 || transUnits(p) > 0)
    .sort((a, b) => String(a.nombre || "").localeCompare(String(b.nombre || ""), "es"));
  if (!prods.length) { toast(t("emg.tt.nothingown"), "warn"); return; }
  const prodOpts = prods.map(p => `<option value="${p.id}">${esc(p.sku ? "[" + p.sku + "] " : "")}${esc(p.nombre)}</option>`).join("");

  const body = `
    <p class="hint" style="margin:0 0 16px">${t("emg.own.hint")}</p>
    <div class="recv-grid">
      <div class="recv-list">
        <div class="grid-form" style="padding:0;gap:14px">
          <div class="field"><label>${t("common.product")}</label><select class="inp" id="eo_prod">${prodOpts}</select></div>
          <div class="field"><label>${t("emg.own.stage")}</label>
            <div id="eo_stages" style="display:flex;flex-direction:column;gap:8px"></div></div>
          <div class="field"><label>${t("common.units")}</label><input class="inp num" id="eo_q" value="0"></div>
        </div>
      </div>
      <div class="recv-side">
        <div class="field" style="margin-bottom:16px"><label>${t("emg.own.costdelta")}</label><div class="leg-pu hint" id="eo_delta">—</div></div>
        <div class="grid-form stack" style="padding:0;gap:14px">
          ${emergMotivoFieldHTML("eo")}
        </div>
      </div>
    </div>`;
  buildModal(t("emg.own.md.title"), body, [
    { label: t("common.cancel"), cls: "btn", act: closeModal },
    { label: t("emg.own.b.rescue"), cls: "btn danger", act: () => {
        const p = prodById(document.getElementById("eo_prod").value);
        const legKey = (document.querySelector('input[name="eo_leg"]:checked') || {}).value;
        if (!p || !legKey) { toast(t("emg.tt.pickprodstage"), "warn"); return; }
        const leg = EMERG_LEGS[legKey];
        const max = stockDe(p, leg.origen());
        const q = Math.min(Math.max(0, parseNum(document.getElementById("eo_q").value) || 0), max);
        if (q <= 0) { toast(t("emg.tt.enterqty"), "warn"); return; }
        const m = emergReadMotivo("eo"); if (!m.ok) return;
        if (!confirm(t("emg.own.confirm", { n: qty(q), name: p.nombre, dest: storeName(leg.destino()), cause: m.motivo }))) return;
        withUndo(t("emg.own.undo", { n: qty(q) }), () => { rescatarTramoOwn(p, q, legKey, m.motivo, ""); });
        closeModal();
        toast(t("emg.own.done", { n: qty(q), dest: storeName(leg.destino()) }), "up");
        render();
      }
    }
  ], "recv");

  // etapas disponibles del producto elegido (radio; preselecciona la más avanzada = AR)
  const renderStages = () => {
    const p = prodById(document.getElementById("eo_prod").value);
    const wrap = document.getElementById("eo_stages");
    const rows = [];
    if (p && stockDe(p, sel) > 0)   rows.push({ leg: "ar_to_ship", u: stockDe(p, sel) });
    if (p && transUnits(p) > 0)     rows.push({ leg: "ship_to_us", u: transUnits(p) });
    wrap.innerHTML = rows.map((r, i) => `
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
        <input type="radio" name="eo_leg" value="${r.leg}" ${i === 0 ? "checked" : ""}>
        <span>${esc(emergLegLabel(r.leg))} <span class="hint">· ${qty(r.u)} u</span></span>
      </label>`).join("") || `<span class="hint">${t("emg.own.nostage")}</span>`;
    wrap.querySelectorAll('input[name="eo_leg"]').forEach(r => r.onchange = updDelta);
    updDelta();
  };
  const updDelta = () => {
    const p = prodById(document.getElementById("eo_prod").value);
    const legKey = (document.querySelector('input[name="eo_leg"]:checked') || {}).value;
    const q = Math.max(0, parseNum(document.getElementById("eo_q").value) || 0);
    const out = document.getElementById("eo_delta");
    if (!p || !legKey || q <= 0) { out.textContent = "—"; return; }
    const pk = emergPeekOwn(p, legKey, q);
    out.innerHTML = pk.descap > 0
      ? `${money(pk.cur, "USD")} → <strong>${money(pk.neo, "USD")}</strong> <span class="hint">(${t("emg.own.descap", { m: money(pk.descap, "USD") })})</span>`
      : `${money(pk.cur, "USD")} <span class="hint">(${t("emg.own.nodescap")})</span>`;
  };
  document.getElementById("eo_prod").onchange = renderStages;
  document.getElementById("eo_q").oninput = updDelta;
  emergWireMotivo("eo");
  renderStages();
}

/* ---- Flujo TERCEROS: líneas en AR (o entregadas al dueño) que retroceden ---- */
function openEmergenciaTercero() {
  if (!isAdmin()) { toast(t("emg.tt.adminonly"), "warn"); return; }
  // candidatas: en_ar (con stock) o entregado al dueño (no keep-to-Select)
  const cands = consignAll().filter(cs =>
    (cs.keptForSelect || 0) <= 0 &&
    ((cs.estado === CONSIGN_ESTADOS.AR && (cs.cantidad || 0) > 0) ||
     (cs.estado === CONSIGN_ESTADOS.ENTREGADO && (cs.cantidad || 0) > 0)));
  if (!cands.length) { toast(t("emg.tt.nothingter"), "warn"); return; }

  const rows = cands.map(cs => `<tr>
      <td class="c"><input type="checkbox" class="emg-chk" data-emgsel="${cs.id}"></td>
      <td><span class="sku">${esc(cs.sku || "—")}</span></td>
      <td>${esc(cs.nombre)}</td>
      <td>${esc(terceroNombre(cs))}</td>
      <td class="c">${estadoPillMini(cs.estado)}</td>
      <td class="r num">${qty(cs.cantidad)}</td>
    </tr>`).join("");
  const totalU = cands.reduce((a, cs) => a + (cs.cantidad || 0), 0);
  const body = `
    <p class="hint" style="margin:0 0 14px">${t("emg.ter.hint")} — <b>${cands.length}</b> ${t("conj.products")} · <b>${qty(totalU)}</b> u</p>
    <div class="recv-scroll" style="max-height:58vh;margin-bottom:16px"><table class="rm-tbl">
      <thead><tr><th class="c"></th><th>SKU</th><th>${t("common.product")}</th><th>${t("common.owner")}</th><th class="c">${t("conj.state")}</th><th class="r">${t("common.units")}</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <div class="grid-form" style="grid-template-columns:1fr 1fr;padding:0;gap:14px">
      ${emergMotivoFieldHTML("et")}
    </div>`;
  buildModal(t("emg.ter.md.title"), body, [
    { label: t("common.cancel"), cls: "btn", act: closeModal },
    { label: t("emg.ter.b.rescue"), cls: "btn danger", act: () => {
        const ids = [...document.querySelectorAll(".emg-chk:checked")].map(c => c.dataset.emgsel);
        if (!ids.length) { toast(t("emg.tt.pickline"), "warn"); return; }
        const m = emergReadMotivo("et"); if (!m.ok) return;
        if (!confirm(t("emg.ter.confirm", { n: ids.length, cause: m.motivo }))) return;
        let done = 0;
        withUndo(t("emg.ter.undo", { n: ids.length }), () => {
          ids.forEach(id => { if (retrocederConsignacion(id, m.motivo, "")) done++; });
        });
        closeModal();
        toast(done ? t("emg.ter.done", { n: done }) : t("emg.tt.nothingdone"), done ? "up" : "warn");
        render();
      }
    }
  ], "wide");
}

/* Wire del botón de la toolbar (lo llama wireConjunta en 18-view-conjunta.js). */
function wireEmergencia() {
  const m = document.getElementById("main"); if (!m) return;
  const b = m.querySelector("[data-emergencia]"); if (b) b.onclick = () => openPuertaEmergencia();
}
