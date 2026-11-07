/* ============================================================
   gestordestock (Select) — 17b-clientes-extra.js   (v87)
   Lo que Select toma de la otra app del grupo para clientes y ventas:
     · Reglas de "Datos a completar" (validarCliente / clienteIncompleto):
       el listado de Clientes marca a los que les falta algo (email,
       dirección, CP…) y tiene un filtro para verlos. Es un aviso: no
       bloquea ventas ni cambia el formulario de alta.
     · paisVis(): país en el idioma de la app (se guarda en inglés).
     · Textos del detalle de venta (Totales / Rentabilidad) y de la
       tarjeta "Rentabilidad estimada" de la venta nueva.
   Usa 07-paises.js (smartCase, nombreVis, paisCanon, paisLabel, emailError).
   ============================================================ */
(function(){
  try{
    Object.assign(I18N.en, {"md.cli.err.at": "The email is missing the @", "md.cli.err.domain": "Check what comes after the @ (e.g. name@gmail.com)", "md.net.title": "Estimated profitability", "md.net.income": "Collected", "md.net.inc.ship": "incl. shipping {v}", "md.net.inc.ontop": "charges {v}", "md.net.cogs": "Cost of goods (FIFO)", "md.net.comm2": "Seller commission ({p}%)", "md.net.costs2": "Selling costs", "md.net.net2": "Net margin", "md.net.loss": "Loss", "md.net.marginpct": "{p} margin", "md.net.empty": "Add products to see how the sale splits.", "md.cli.req.us": "· required in the US", "md.cli.err.req": "Required", "md.cli.err.filler": "Enter the customer's real name (not “sale”, “customer”, “test”…)", "md.cli.err.short": "Too short: at least 3 letters", "md.cli.err.mailshort": "Doesn't look like a real email (too short before the @)", "md.cli.err.mailfiller": "That's a placeholder email: ask the customer for the real one", "md.cli.err.phone": "If you enter a phone, it needs at least 7 digits", "md.cli.err.address": "Street and number (e.g. 14015 University Pass)", "md.cli.err.country": "Choose the country", "md.cli.err.statereq": "For the US, the state is required", "md.cli.err.state": "Not a US state (e.g. TX or Texas)", "md.cli.err.zipus": "US ZIP: 5 digits (or 12345-6789)", "md.cli.err.zipar": "Argentina ZIP: 4 digits or CPA (e.g. B7600ABC)", "md.cli.err.zip": "ZIP: at least 3 letters or digits", "md.cli.err.ein": "EIN format: XX-XXXXXXX", "md.cli.err.fix": "Check the {n} field(s) marked in red", "md.cli.warn.oneword": "Just one word: is that the first and last name? (or fill in the company)", "md.cli.warn.maildup": "This email already belongs to {name}", "md.cli.warn.confirm": "Check before saving:\n\n{list}\n\nSave anyway?", "cl.inc.badge": "Needs details", "cl.inc.filter": "Needs details ({n})", "md.net.ship": "+ Shipping billed", "md.net.ontop": "+ On-top charges", "vd.customer": "Customer", "vd.supplier": "Supplier", "vd.totals": "Totals", "vd.profit": "Profitability", "vd.adminonly": "only visible to admin", "vd.dep": "Warehouse", "doc.sub.sales": "Each sale takes stock from the warehouse it ships from (FIFO cost of that warehouse)."});
    Object.assign(I18N.es, {"md.cli.err.at": "Al email le falta el @", "md.cli.err.domain": "Revisá lo que va después del @ (ej: nombre@gmail.com)", "md.net.title": "Rentabilidad estimada", "md.net.income": "Se cobra", "md.net.inc.ship": "incl. envío {v}", "md.net.inc.ontop": "cargos {v}", "md.net.cogs": "Costo de mercadería (FIFO)", "md.net.comm2": "Comisión del vendedor ({p}%)", "md.net.costs2": "Costos de venta", "md.net.net2": "Margen neto", "md.net.loss": "Pérdida", "md.net.marginpct": "{p} de margen", "md.net.empty": "Cargá productos para ver cómo se reparte la venta.", "md.cli.req.us": "· obligatorio en EE.UU.", "md.cli.err.req": "Obligatorio", "md.cli.err.filler": "Poné el nombre real del cliente (no “venta”, “cliente”, “test”…)", "md.cli.err.short": "Muy corto: al menos 3 letras", "md.cli.err.mailshort": "No parece un email real (muy corto antes del @)", "md.cli.err.mailfiller": "Es un email de relleno: pedile al cliente el real", "md.cli.err.phone": "Si cargás teléfono, tiene que tener al menos 7 dígitos", "md.cli.err.address": "Calle y número (ej: 14015 University Pass)", "md.cli.err.country": "Elegí el país", "md.cli.err.statereq": "En EE.UU. el estado es obligatorio", "md.cli.err.state": "No es un estado de EE.UU. (ej: TX o Texas)", "md.cli.err.zipus": "ZIP de EE.UU.: 5 dígitos (o 12345-6789)", "md.cli.err.zipar": "CP de Argentina: 4 dígitos o CPA (ej: B7600ABC)", "md.cli.err.zip": "ZIP: al menos 3 letras o números", "md.cli.err.ein": "Formato de EIN: XX-XXXXXXX", "md.cli.err.fix": "Revisá los {n} campo(s) marcados en rojo", "md.cli.warn.oneword": "Es una sola palabra: ¿es nombre y apellido? (o completá la empresa)", "md.cli.warn.maildup": "Este email ya lo tiene {name}", "md.cli.warn.confirm": "Revisá antes de guardar:\n\n{list}\n\n¿Guardar igual?", "cl.inc.badge": "Datos a completar", "cl.inc.filter": "Datos a completar ({n})", "md.net.ship": "+ Envío cobrado", "md.net.ontop": "+ Cargos on-top", "vd.customer": "Cliente", "vd.supplier": "Proveedor", "vd.totals": "Totales", "vd.profit": "Rentabilidad", "vd.adminonly": "sólo lo ve el admin", "vd.dep": "Depósito", "doc.sub.sales": "Cada venta descuenta stock del depósito desde el que se despacha (costo FIFO de ese depósito)."});
  }catch(e){ console.warn("clientes-extra i18n", e); }
})();

/* País para mostrar: normaliza ("USA", "EEUU" → United States) y traduce. */
function paisVis(v){ if(!v) return ""; const c = paisCanon(v); return paisLabel(c || v); }

const CLI_FIELDS = [
  // sufijo, campo,       casing
  ["nom",  "nombre",    "name"],
  ["con",  "contacto",  "name"],
  ["emp",  "empresa",   "name"],
  ["tel",  "telefono",  "plain"],
  ["mail", "email",     "email"],
  ["dir",  "direccion", "name"],
  ["ciu",  "ciudad",    "name"],
  ["est",  "estado",    "state"],
  ["zip",  "zip",       "upper"],
  ["pais", "pais",      "pais"],
  ["ein",  "ein",       "plain"]
];
const CLI_KEY = Object.fromEntries(CLI_FIELDS.map(([s,k])=>[s,k]));

const US_STATES = {AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",CO:"Colorado",CT:"Connecticut",DE:"Delaware",
  DC:"District of Columbia",FL:"Florida",GA:"Georgia",HI:"Hawaii",ID:"Idaho",IL:"Illinois",IN:"Indiana",IA:"Iowa",KS:"Kansas",KY:"Kentucky",
  LA:"Louisiana",ME:"Maine",MD:"Maryland",MA:"Massachusetts",MI:"Michigan",MN:"Minnesota",MS:"Mississippi",MO:"Missouri",MT:"Montana",
  NE:"Nebraska",NV:"Nevada",NH:"New Hampshire",NJ:"New Jersey",NM:"New Mexico",NY:"New York",NC:"North Carolina",ND:"North Dakota",
  OH:"Ohio",OK:"Oklahoma",OR:"Oregon",PA:"Pennsylvania",RI:"Rhode Island",SC:"South Carolina",SD:"South Dakota",TN:"Tennessee",TX:"Texas",
  UT:"Utah",VT:"Vermont",VA:"Virginia",WA:"Washington",WV:"West Virginia",WI:"Wisconsin",WY:"Wyoming",PR:"Puerto Rico",GU:"Guam",VI:"U.S. Virgin Islands"};
function esEstadoUS(v){
  const s = String(v||"").trim(); if(!s) return false;
  if(US_STATES[s.toUpperCase()]) return true;
  const n = paisNorm(s);
  return Object.values(US_STATES).some(x=> paisNorm(x)===n);
}
const CLI_NOMBRE_RELLENO = /^(venta|ventas|sale|cliente|client|customer|test|prueba|n\/?a|na|none|x+|-+|\.+|sin nombre|nombre|name|asd+f?|qwe+)$/i;
const CLI_NOMBRE_PREFIJO = /^(venta|sale|cliente|client|customer)\b/i;          // "venta Juan Cruz"
const CLI_EMAIL_RELLENO  = /^(complet[a-z]*|test|prueba|no-?e?mail|sin-?e?mail|none|na|x{2,}|asd+f?|e?mail|correo|cliente|client|customer|venta|sale)\d*$/i;
const letras = s => (String(s||"").match(/\p{L}/gu)||[]).length;

/* Valida UN campo (sufijo del form) sobre el objeto de datos completo.
   Devuelve { err: claveI18n|"" , warn: claveI18n|"", vars } */
function validarCampoCliente(sfx, c, selfId){
  const v = String((c[CLI_KEY[sfx]]||"")).trim();
  const R = (err, warn, vars)=> ({ err:err||"", warn:warn||"", vars:vars||{} });
  switch(sfx){
    case "nom":
      if(!v) return R("md.cli.err.req");
      if(CLI_NOMBRE_RELLENO.test(v) || CLI_NOMBRE_PREFIJO.test(v)) return R("md.cli.err.filler");
      if(letras(v) < 3) return R("md.cli.err.short");
      if(!/\s/.test(v) && !String(c.empresa||"").trim()) return R("", "md.cli.warn.oneword");
      return R();
    case "mail": {
      if(!v) return R("md.cli.err.req");
      const k = emailError(v); if(k) return R(k);
      const local = v.split("@")[0];
      if(local.length < 3) return R("md.cli.err.mailshort");
      if(CLI_EMAIL_RELLENO.test(local)) return R("md.cli.err.mailfiller");
      const otro = (db.clientes||[]).find(x=> x.id!==selfId && String(x.email||"").trim().toLowerCase()===v.toLowerCase());
      if(otro) return R("", "md.cli.warn.maildup", {name:otro.nombre});
      return R();
    }
    case "tel":
      if(v && (v.match(/\d/g)||[]).length < 7) return R("md.cli.err.phone");
      return R();
    case "dir":
      if(!v) return R("md.cli.err.req");
      if(v.length < 5 || !/\d/.test(v) || letras(v) < 2) return R("md.cli.err.address");
      return R();
    case "ciu":
      if(!v) return R("md.cli.err.req");
      if(letras(v) < 2) return R("md.cli.err.short");
      return R();
    case "pais":
      if(!v) return R("md.cli.err.country");
      return R();
    case "est":
      if(paisCanon(c.pais)==="United States"){
        if(!v) return R("md.cli.err.statereq");
        if(!esEstadoUS(v)) return R("md.cli.err.state");
      }
      return R();
    case "zip": {
      if(!v) return R("md.cli.err.req");
      const z = v.toUpperCase();
      if(paisCanon(c.pais)==="United States" && !/^\d{5}(-\d{4})?$/.test(z)) return R("md.cli.err.zipus");
      if(paisCanon(c.pais)==="Argentina" && !/^(\d{4}|[A-Z]\d{4}[A-Z]{3})$/.test(z)) return R("md.cli.err.zipar");
      if(!/^[A-Z0-9][A-Z0-9 \-]{2,}$/.test(z)) return R("md.cli.err.zip");
      return R();
    }
    case "ein":
      if(v && !/^\d{2}-?\d{7}$/.test(v)) return R("md.cli.err.ein");
      return R();
  }
  return R();
}
/* Valida el cliente completo. { errs:[{sfx,key,vars}], warns:[...] } */
function validarCliente(c, selfId){
  const out = { errs:[], warns:[] };
  CLI_FIELDS.forEach(([sfx])=>{
    const r = validarCampoCliente(sfx, c, selfId);
    if(r.err) out.errs.push({ sfx, key:r.err, vars:r.vars });
    if(r.warn) out.warns.push({ sfx, key:r.warn, vars:r.vars });
  });
  return out;
}
/* Cliente viejo que no cumple las reglas (para el badge y el aviso en la venta). */
function clienteIncompleto(c){ return !!c && validarCliente(c, c.id).errs.length > 0; }


/* ============================================================
   Formulario de cliente COMPARTIDO (v92, igual que la otra app del grupo)
   Lo usan el alta desde una venta/compra de terceros (prefijo "c") y la vista
   Clientes (prefijo "cs"): mismos campos, mayúsculas y validaciones en vivo.
   Rojo = bloquea el guardado · ámbar = avisa y deja seguir.
   ============================================================ */
(function(){
  Object.assign(I18N.en, {
    "md.err.date":"Enter the date", "md.err.datefuture":"The date can't be in the future",
    "md.err.qty":"There's a line with quantity 0: fix it or remove it",
    "md.warn.cliinc":"{name} has missing details (you can complete them later in Customers)",
    "md.warn.olddate":"The date is {d} days ago", "md.warn.free":"{name} goes at $0 (gift?)",
    "md.warn.belowcost":"{name} sells below cost ({price} vs {cost})",
    "md.warn.confirm":"Check before confirming:\n\n{list}\n\nConfirm the sale anyway?",
    "md.warn.cliinc.short":"This customer has missing details.", "md.warn.cliinc.fix":"Complete now",
    "md.cli.ein":"EIN", "md.cli.ein.hint":"US tax ID · optional",
    "md.cli.ph.email":"name@example.com", "md.cli.ph.name":"First and last name, or company"
  });
  Object.assign(I18N.es, {
    "md.err.date":"Cargá la fecha", "md.err.datefuture":"La fecha no puede ser futura",
    "md.err.qty":"Hay una línea con cantidad 0: corregila o borrala",
    "md.warn.cliinc":"A {name} le faltan datos (los podés completar después en Clientes)",
    "md.warn.olddate":"La fecha es de hace {d} días", "md.warn.free":"{name} va a $0 (¿regalo?)",
    "md.warn.belowcost":"{name} se vende debajo del costo ({price} vs {cost})",
    "md.warn.confirm":"Revisá antes de confirmar:\n\n{list}\n\n¿Confirmar la venta igual?",
    "md.warn.cliinc.short":"A este cliente le faltan datos.", "md.warn.cliinc.fix":"Completar ahora",
    "md.cli.ein":"EIN", "md.cli.ein.hint":"Tax ID de EE.UU. · opcional",
    "md.cli.ph.email":"nombre@ejemplo.com", "md.cli.ph.name":"Nombre y apellido, o empresa"
  });
})();
function paisMasUsado(){
  const cnt={}; (db.clientes||[]).forEach(c=>{ const k=paisCanon(c.pais); if(paisConocido(k)) cnt[k]=(cnt[k]||0)+1; });
  return Object.keys(cnt).sort((a,b)=> cnt[b]-cnt[a])[0] || "";
}

/* ---------- Formulario de cliente COMPARTIDO ----------
   Lo usan el alta desde una venta (prefijo "c") y la vista Clientes
   (prefijo "cs"). Un solo lugar define campos, mayúsculas y validaciones,
   así los dos formularios nunca se desalinean.
   casing: ver smartCase() en 07-paises.js. */
function clienteFormHTML(px, c, nombrePre){
  const v = k => c ? esc(c[k]||"") : "";
  const R  = ` <span class="u-fw400 hint">${t("md.req")}</span>`;
  const RU = ` <span class="u-fw400 hint">${t("md.cli.req.us")}</span>`;
  const E = sfx => `<div class="ferr" id="${px}_${sfx}_err" hidden></div>`;
  const txt = 'autocomplete="off" autocapitalize="words"';
  const paisIni = c ? c.pais : paisMasUsado();
  return `
    <div class="u-cols2 u-p0 grid-form">
      <div class="u-span2 field"><label>${t("md.cli.name")}${R}</label><input class="inp" id="${px}_nom" ${txt} value="${c?v("nombre"):esc(nombrePre||"")}" placeholder="${t("md.cli.ph.name")}">${E("nom")}</div>
      <div class="field"><label>${t("md.cli.contact")}</label><input class="inp" id="${px}_con" ${txt} value="${v("contacto")}">${E("con")}</div>
      <div class="field"><label>${t("md.cli.company")}</label><input class="inp" id="${px}_emp" ${txt} value="${v("empresa")}">${E("emp")}</div>
      <div class="field"><label>${t("md.cli.phone")}</label><input class="inp" id="${px}_tel" type="tel" inputmode="tel" autocomplete="off" value="${v("telefono")}">${E("tel")}</div>
      <div class="field"><label>${t("md.cli.email")}${R}</label><input class="inp" id="${px}_mail" type="email" inputmode="email" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${t("md.cli.ph.email")}" value="${v("email")}">${E("mail")}</div>
      <div class="u-span2 field"><label>${t("md.cli.address")}${R}</label><input class="inp" id="${px}_dir" ${txt} value="${v("direccion")}" placeholder="${t("md.cli.ph.address")}">${E("dir")}</div>
      <div class="field"><label>${t("md.cli.city")}${R}</label><input class="inp" id="${px}_ciu" ${txt} value="${v("ciudad")}">${E("ciu")}</div>
      <div class="field"><label>${t("md.cli.state")}${RU}</label><input class="inp" id="${px}_est" ${txt} value="${v("estado")}" placeholder="${t("md.cli.ph.state")}">${E("est")}</div>
      <div class="field"><label>${t("md.cli.zip")}${R}</label><input class="inp" id="${px}_zip" autocomplete="off" autocapitalize="characters" value="${v("zip")}">${E("zip")}</div>
      <div class="field"><label>${t("md.cli.country")}${R}</label><select class="inp" id="${px}_pais" data-search>${paisOptionsHTML(paisIni)}</select>${E("pais")}</div>
      <div class="field"><label>${t("md.cli.ein")} <span class="u-fw400 hint">${t("md.cli.ein.hint")}</span></label><input class="inp" id="${px}_ein" value="${v("ein")}" placeholder="XX-XXXXXXX" autocomplete="off" autocapitalize="off" spellcheck="false">${E("ein")}</div>
    </div>`;
}
/* Lee los valores actuales del form (ya normalizados, sin tocar los inputs). */
function leerClienteForm(px){
  const campos = {};
  CLI_FIELDS.forEach(([sfx,key,kind])=>{
    const el = document.getElementById(px+"_"+sfx);
    const raw = el ? el.value : "";
    campos[key] = kind==="pais" ? paisCanon(raw) : smartCase(raw, kind);
  });
  return campos;
}
/* Pinta el estado de UN campo: rojo si bloquea, ámbar si sólo avisa. */
function pintarCampoCliente(px, sfx, selfId){
  const el = document.getElementById(px+"_"+sfx), box = document.getElementById(px+"_"+sfx+"_err");
  if(!el || !box) return { err:"", warn:"" };
  const r = validarCampoCliente(sfx, leerClienteForm(px), selfId);
  const k = r.err || r.warn;
  el.classList.toggle("bad", !!r.err); el.classList.toggle("warnf", !r.err && !!r.warn);
  el.setAttribute("aria-invalid", r.err ? "true" : "false");
  box.hidden = !k; box.textContent = k ? t(k, r.vars) : ""; box.classList.toggle("fwarn", !r.err && !!r.warn);
  return r;
}
/* Al salir de cada campo: lo dejamos prolijo (mayúsculas) y lo validamos en el
   momento. Si ya estaba marcado, se vuelve a validar mientras corrige. */
function wireClienteForm(px, selfId){
  CLI_FIELDS.forEach(([sfx,,kind])=>{
    const el = document.getElementById(px+"_"+sfx); if(!el) return;
    const onBlur = ()=>{
      if(kind!=="pais" && kind!=="plain"){ const nv=smartCase(el.value, kind); if(nv!==el.value) el.value=nv; }
      pintarCampoCliente(px, sfx, selfId);
    };
    el.addEventListener(kind==="pais" ? "change" : "blur", ()=>{
      onBlur();
      // cambiar el país cambia qué se exige en provincia y ZIP
      if(sfx==="pais") ["est","zip"].forEach(s=>{ const e=document.getElementById(px+"_"+s); if(e && e.value) pintarCampoCliente(px, s, selfId); });
    });
    el.addEventListener("input", ()=>{ if(el.classList.contains("bad")||el.classList.contains("warnf")) pintarCampoCliente(px, sfx, selfId); });
  });
}
/* Lee y valida el form completo. Errores → marca todo, avisa y enfoca el primero.
   Avisos → un solo confirm con la lista. Devuelve los campos o null. */
function readClienteForm(px, selfId){
  const campos = leerClienteForm(px);
  CLI_FIELDS.forEach(([sfx,key])=>{ const el=document.getElementById(px+"_"+sfx); if(el && el.tagName==="INPUT") el.value = campos[key]; });
  const val = validarCliente(campos, selfId);
  CLI_FIELDS.forEach(([sfx])=> pintarCampoCliente(px, sfx, selfId));
  if(val.errs.length){
    const e0 = val.errs[0];
    toast(t("md.cli.err.fix",{n:val.errs.length}),"warn");
    const el=document.getElementById(px+"_"+e0.sfx); if(el) el.focus();
    return null;
  }
  if(val.warns.length){
    const lista = val.warns.map(w=> "• "+t(w.key, w.vars)).join("\n");
    if(!confirm(t("md.cli.warn.confirm",{list:lista}))) return null;
  }
  return campos;
}

