/* ============================================================
   37 · PERFIL EDITOR — textos (Select v94)
   ------------------------------------------------------------
   Editor = equipo de Argentina: carga compras (también importando la factura)
   y ventas del depósito Select, crea/edita productos y ajusta el stock de
   Argentina. No ve costos, márgenes, comisiones ni SKU, ni ventas o compras de
   EE.UU. (sí cuánto stock hay). No borra documentos.
   Los permisos reales los aplica el servidor; esto es la cara visible.
   Desde v94 este archivo ya NO es igual al de Prince.
   ============================================================ */
(function(){
  const EN = { "role.editor":"Editor", "usr.role.editor":"Editor (Argentina)",
    "ed.err.nodelete":"The Editor profile can't delete documents. Ask an admin.",
    "ed.err.notyours":"You can only edit what you entered. This one was entered by {who}. Ask an admin (or for permission to edit others').",
    "ed.err.notyours0":"You can only edit what you entered. This one predates that record: ask an admin (or for permission to edit others').",
    "usr.f.editothers":"Can edit purchases and sales entered by other users",
    "usr.f.editothers.h":"Off: only what this user entered. Deleting is never allowed for the Editor profile.",
    "usr.sub.editothers":"edits all",
    "doc.by":"Entered by {u}",
    "md.aj.stockonly":"In store: {n}",
    "dash.subtitle2":"Sellable stock in units", "dash.kpi.sellable2":"products for sale", "dash.f.search2":"Search by name…",
    "doc.sub.sales2":"Each sale takes stock from the warehouse it ships from.",
    "pr.btn.exppdf2":"Send stock (PDF)", "pr.btn.exppdf.tip2":"Stock PDF to send to a customer: units and, if you want, our sale prices. No codes or costs.",
    "pdfx.col.sku":"SKU (internal)", "pdfx.col.sku.h":"Our internal code. Off by default: leave it off for anything that goes to a customer." };
  const ES = { "role.editor":"Editor", "usr.role.editor":"Editor (Argentina)",
    "ed.err.nodelete":"El perfil Editor no puede borrar documentos. Pedíselo a un admin.",
    "ed.err.notyours":"Sólo podés editar lo que cargaste vos. Este lo cargó {who}. Pedíselo a un admin (o que te dé permiso para editar lo de otros).",
    "ed.err.notyours0":"Sólo podés editar lo que cargaste vos. Este es anterior a ese registro: pedíselo a un admin (o que te dé permiso para editar lo de otros).",
    "usr.f.editothers":"Puede editar compras y ventas que cargaron otros usuarios",
    "usr.f.editothers.h":"Apagado: sólo lo que cargó este usuario. Borrar no puede nunca con el perfil Editor.",
    "usr.sub.editothers":"edita todo",
    "doc.by":"Cargado por {u}",
    "md.aj.stockonly":"En depósito: {n}",
    "dash.subtitle2":"Stock vendible en unidades", "dash.kpi.sellable2":"productos a la venta", "dash.f.search2":"Buscar por nombre…",
    "doc.sub.sales2":"Cada venta descuenta stock del depósito desde el que se despacha.",
    "pr.btn.exppdf2":"Enviar stock (PDF)", "pr.btn.exppdf.tip2":"PDF de stock para mandarle a un cliente: unidades y, si querés, nuestros precios de venta. Sin códigos ni costos.",
    "pdfx.col.sku":"SKU (interno)", "pdfx.col.sku.h":"Nuestro código interno. Viene apagado: dejalo así en todo lo que va a un cliente." };
  try{ Object.assign(I18N.en, EN); Object.assign(I18N.es, ES); }catch(e){ console.warn("editor i18n", e); }
})();

/* nov 2026 · El Editor sólo edita las compras/ventas que cargó él (doc.cargadoPor), salvo que el
   admin le haya dado el permiso "editar lo de otros" en Usuarios. El servidor lo controla igual. */
function puedeEditarDocDe(d){
  if(!isEditor()) return true;
  if(session && session.editaOtros) return true;
  return !!(d && session && d.cargadoPor && String(d.cargadoPor).toLowerCase()===String(session.user||"").toLowerCase());
}
function avisoDocAjeno(d){ toast(d && d.cargadoPor ? t("ed.err.notyours",{who:d.cargadoPor}) : t("ed.err.notyours0"), "warn"); }
