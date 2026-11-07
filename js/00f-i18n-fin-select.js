/* ============================================================
   gestordestock (Select) — 00f-i18n-fin-select.js   (v83)
   Textos de Finanzas propios de Select. Se carga DESPUÉS de
   00d-i18n-fin.js y pisa lo que en Select se dice distinto:
     · "sociedad" → DEPÓSITO (Swan · USA / Select · AR): en Select cada
       venta sale de un depósito; no hay pool compartido entre sociedades.
     · Moneda única USD (no hay tipo de cambio).
     · Costos financieros (giros, comisiones bancarias) y mercadería en
       viaje a Argentina, que sólo existen en Select.
   También trae los textos del Excel del P&L que Select no tenía.
   ============================================================ */
(function(){
  if(typeof I18N==="undefined") return;
  Object.assign(I18N.en, {
    /* --- Colores de Select (la serie principal es ámbar, no azul) --- */
    "fin.combo.sub":"Purchases are at cost and sales at price: because of the margin the amber bar is almost always taller, and that says nothing about stock. To see whether stock is piling up, check Purch. / cost sold in the table below (above 1.00 = more came in than went out). In Units the comparison is direct. The green row is each month's gross margin %.",
    "fin.wf.sub":"Green adds, red subtracts, dark bars are subtotals and the amber one is what stays. \u2605 marks charges billed on-top to the customer.",
    "plan.line.sub":"Amber bar = actual. Black mark = plan.",
    /* --- Excel del estado de resultados --- */
    "an.aria.waterfall":"Income statement waterfall", "an.aria.trend":"Monthly trend",
    "an.kpi.netrev":"Net revenue", "an.kpi.contrib":"Contribution",
    "xl.is.sales":"Product sales", "xl.is.shipping":"Shipping billed to customers", "xl.is.cargos":"On-top charges billed to customers",
    "xl.is.cogs":"Cost of goods sold (FIFO)", "xl.is.comm":"Seller commissions", "xl.is.selling":"Other selling costs",
    "xl.is.contrib":"Contribution margin", "xl.is.net":"Net revenue", "xl.is.gp":"Gross margin", "xl.period":"Period: {from}  →  {to}", "xl.start":"start", "xl.today":"today",
    "xl.scope.soc":"{soc} only", "xl.scope.consol":"Consolidated", "xl.is.title":"Income Statement (Preliminary)",
    "xl.is.concept":"Concept", "xl.is.consol":"Consolidated", "xl.is.pctrev":"% of revenue", "xl.is.gmpct":"Gross margin %",
    "xl.is.contribpct":"Contribution margin %",
    "xl.is.struct":"Structure costs (rent, payroll, marketing) come from the Operating expenses tab and sit below contribution.",
    "xl.is.notes":"Notes:",
    "xl.is.n1":"• COGS uses the real FIFO cost layers of the warehouse each sale shipped from (not last cost).",
    "xl.is.n2":"• Inbound freight, international freight and Argentina import costs are capitalized into landed cost by leg, so they are already inside COGS.",
    "xl.is.n3soc":"• Warehouse view: only sales shipped from this warehouse. Shared operating expenses are split by its share of net revenue.",
    "xl.is.n3":"• Each sale ships from one warehouse (Swan · USA or Select · AR); the warehouses add up to the consolidated figure.",
    "xl.sh.is":"Income Statement", "xl.sh.soc":"By warehouse", "xl.h.units":"Units",
    "xl.soc.note":"Warehouses add up to the consolidated column. Each sale counts in the warehouse it shipped from.",
    "xl.h.seller":"Seller", "xl.h.revenue":"Revenue", "xl.h.cogs":"COGS (FIFO)", "xl.h.gm":"Gross margin", "xl.h.gmpct":"Margin %",
    "xl.h.comm":"Commission", "xl.sh.seller":"By seller", "xl.detail.title":"Detail by product", "xl.sh.detail":"Detail by product",
    "xl.file":"income-statement", "xl.opt.consol":"Consolidated (+ sheet by warehouse)",
    "pnl.hint":"Multi-step income statement (net revenue → FIFO COGS → gross margin → contribution → operating result), with per-seller breakdown and product detail. Consolidated (plus a side-by-side sheet by warehouse) or for a single warehouse.",
    "xp.company":"Select",

    /* --- Depósito en lugar de sociedad --- */
    "an.socfocus":"Showing only sales shipped from {soc}: its units, its real FIFO cost and its revenue.",
    "pnl.sub.soc":"From revenue to what you keep — {soc} only, for the selected period.",
    "pnl.socfocus":"Only sales shipped from {soc}. Product sales, COGS and commissions are exact. Shared operating expenses are split by {soc}'s share of net revenue. Budget is hidden because it's company-wide.",
    "gx.th.soc":"Warehouse",
    "gx.xl.socnote":"Warehouse view: its direct expenses + {p} of shared expenses (its share of net revenue in the period).",
    "xp.sh.soc.t":"Income statement by warehouse",
    "xp.soc.note":"Shared operating expenses are split by each warehouse's share of net revenue in the period.",
    "stk.socnote":"Months frozen before this version have no breakdown by warehouse: with a warehouse selected they're rebuilt from the stock ledger. Tap \"Recalculate closed months\" to freeze them with the breakdown.",
    "fin.var.hidden":"Budget comparison is hidden: the budget covers the whole company, and comparing it against a single warehouse, game, language, country or seller would be misleading.",
    "rs.mode.socnoplan":"You're looking at {s} only: the sales plan is for the whole company, so there's no plan comparison here. Operating expenses include {s}'s own plus its share of the shared ones (by revenue).",
    "gx.notes":"Accrual basis: each expense counts entirely in the month it belongs to, even when the P&L filter covers only part of the month. Fixed expenses accrue up to the current month. \"Shared\" expenses are split between warehouses by their share of net revenue when you focus on one. Costs tied to a specific sale (shipping, labor, fees) still go on the sale.",

    /* --- Sólo Select --- */
    "pnl.notes":"COGS uses real FIFO layers: inbound freight and the costs of each leg to Argentina are already capitalized. Charges billed on-top to the customer add to revenue. Everything is in USD. Financial costs (wire fees, bank charges) are not capitalized: they go below EBITDA. Operating expenses (rent, payroll, marketing) come from the Operating expenses tab.",
    "gx.cat.financieros":"Financial costs",
    "gx.orig.cfin":"Financial", "gx.orig.cfinauto":"Automatic",
    "gx.cfin.note":"Financial costs (wire fees, bank charges of each shipment) are recorded automatically when goods go through the transit gates; you can also add them as a one-off expense in the \"Financial costs\" category. They're not capitalized: they go below EBITDA.",
    "fin.kpi.arsub":"+ {v} on its way to AR",
    "rk.envio.t":"{v} on its way to Argentina for more than 30 days",
    "rk.envio.d":"{n} own shipment(s) still open (the oldest, {d} days). Those goods can't be sold until they're received.",
    "rk.go.envios":"See shipments",
    "dc.envio.t":"Shipments to receive in AR",
    "dc.envio.d":"Receive them in Third-party / Transit when they arrive so they add Select stock.",
    "fin.manual":"Manual entry",
    "fin.cf.del":"Delete the financial cost \"{c}\" ({m})?",
    "fin.tt.deleted":"Financial cost deleted"
  });
  Object.assign(I18N.es, {
    /* --- Colores de Select (la serie principal es ámbar, no azul) --- */
    "fin.combo.sub":"Las compras están a costo y las ventas a precio: por el margen, la barra ámbar casi siempre es más alta y eso no dice nada del stock. Para saber si se acumula mercadería mirá Compras / costo vendido en la tabla de abajo (mayor a 1.00 = entró más de lo que salió). En Unidades la comparación es directa. La fila verde es el margen bruto % de cada mes.",
    "fin.wf.sub":"Verde suma, rojo resta, las barras oscuras son subtotales y la ámbar es lo que queda. \u2605 marca cargos facturados aparte al cliente.",
    "plan.line.sub":"Barra ámbar = real. Marca negra = plan.",
    /* --- Excel del estado de resultados --- */
    "an.aria.waterfall":"Waterfall del estado de resultados", "an.aria.trend":"Tendencia mensual",
    "an.kpi.netrev":"Ingreso neto", "an.kpi.contrib":"Contribución",
    "xl.is.sales":"Venta de productos", "xl.is.shipping":"Envíos facturados a clientes", "xl.is.cargos":"Cargos on-top facturados a clientes",
    "xl.is.cogs":"Costo de mercadería vendida (FIFO)", "xl.is.comm":"Comisiones de vendedores", "xl.is.selling":"Otros costos de venta",
    "xl.is.contrib":"Margen de contribución", "xl.period":"Período: {from}  →  {to}", "xl.start":"inicio", "xl.today":"hoy",
    "xl.scope.soc":"Solo {soc}", "xl.scope.consol":"Consolidado", "xl.is.title":"Estado de resultados (preliminar)",
    "xl.is.concept":"Concepto", "xl.is.consol":"Consolidado", "xl.is.pctrev":"% s/ventas", "xl.is.gmpct":"Margen bruto %",
    "xl.is.contribpct":"Margen de contribución %",
    "xl.is.struct":"Los costos de estructura (alquiler, sueldos, marketing) salen de la pestaña Gastos de estructura y van debajo de la contribución.",
    "xl.is.notes":"Notas:",
    "xl.is.n1":"• El CMV usa las capas FIFO reales del depósito desde el que salió cada venta (no el último costo).",
    "xl.is.n2":"• El flete de entrada, el flete internacional y la nacionalización en Argentina se capitalizan en el costo puesto por tramo, así que ya están dentro del CMV.",
    "xl.is.n3soc":"• Vista por depósito: solo las ventas que salieron de este depósito. Los gastos de estructura compartidos se reparten según su % del ingreso neto.",
    "xl.is.n3":"• Cada venta sale de un depósito (Swan · USA o Select · AR); la suma de los depósitos da el consolidado.",
    "xl.sh.is":"Estado de resultados", "xl.sh.soc":"Por depósito", "xl.h.units":"Unidades",
    "xl.soc.note":"La suma de los depósitos da la columna consolidada. Cada venta cuenta en el depósito desde el que salió.",
    "xl.h.seller":"Vendedor", "xl.h.revenue":"Ventas", "xl.h.cogs":"CMV (FIFO)", "xl.h.gm":"Margen bruto", "xl.h.gmpct":"Margen %",
    "xl.h.comm":"Comisión", "xl.sh.seller":"Por vendedor", "xl.detail.title":"Detalle por producto", "xl.sh.detail":"Detalle por producto",
    "xl.file":"estado-de-resultados", "xl.opt.consol":"Consolidado (+ hoja por depósito)",
    "pnl.hint":"Estado de resultados por pasos (venta neta → COGS FIFO → margen bruto → contribución → resultado operativo), con desglose por vendedor y detalle por producto. Consolidado (más una hoja comparativa por depósito) o de un solo depósito.",
    "xp.company":"Select",

    /* --- Depósito en lugar de sociedad --- */
    "an.socfocus":"Mostrando solo las ventas que salieron de {soc}: sus unidades, su costo FIFO real y su ingreso.",
    "pnl.sub.soc":"Del ingreso a lo que queda — solo {soc}, del período seleccionado.",
    "pnl.socfocus":"Solo las ventas que salieron de {soc}. Ventas de productos, COGS y comisiones son exactos. Los gastos de estructura compartidos se reparten según el % del ingreso neto de {soc}. El presupuesto se oculta porque es de toda la empresa.",
    "gx.th.soc":"Depósito",
    "gx.xl.socnote":"Vista por depósito: sus gastos directos + {p} de los compartidos (su % del ingreso neto del período).",
    "xp.sh.soc.t":"Estado de resultados por depósito",
    "xp.soc.note":"Los gastos de estructura compartidos se reparten según el % del ingreso neto de cada depósito en el período.",
    "stk.socnote":"Los meses congelados antes de esta versión no tienen el corte por depósito: con un depósito elegido se reconstruyen desde el kardex. Tocá \"Recalcular meses cerrados\" para congelarlos con el corte.",
    "fin.var.hidden":"La comparación contra presupuesto está oculta: el presupuesto es de toda la empresa y compararlo contra un solo depósito, juego, idioma, país o vendedor engaña.",
    "rs.mode.socnoplan":"Estás viendo sólo {s}: el plan de ventas es de la empresa entera, así que acá no se compara contra plan. Los gastos de estructura son los propios de {s} más su parte de los compartidos (según su ingreso).",
    "gx.notes":"Criterio de lo devengado: cada gasto pesa entero en el mes al que corresponde, aunque el filtro del P&L tome solo parte del mes. Los fijos se devengan hasta el mes en curso. Los gastos \"Compartidos\" se reparten entre depósitos según su % del ingreso neto cuando mirás uno solo. Los costos atados a una venta puntual (envío, mano de obra, comisiones) siguen cargándose en la venta.",

    /* --- Sólo Select --- */
    "pnl.notes":"El COGS usa capas FIFO reales: el flete de entrada y los costos de cada tramo hasta Argentina ya están capitalizados. Los cargos facturados on-top al cliente suman al ingreso. Todo está en USD. Los costos financieros (giros, comisiones bancarias) no se capitalizan: van debajo del EBITDA. Los gastos de estructura (alquiler, sueldos, marketing) salen de la pestaña Gastos de estructura.",
    "gx.cat.financieros":"Costos financieros",
    "gx.orig.cfin":"Financiero", "gx.orig.cfinauto":"Automático",
    "gx.cfin.note":"Los costos financieros (giros y comisiones bancarias de cada envío) se registran solos al pasar la mercadería por las puertas de tránsito; también podés cargarlos como gasto puntual en la categoría \"Costos financieros\". No se capitalizan: van debajo del EBITDA.",
    "fin.kpi.arsub":"+ {v} en viaje a AR",
    "rk.envio.t":"{v} en viaje a Argentina hace más de 30 días",
    "rk.envio.d":"{n} envío(s) propio(s) todavía abierto(s) (el más viejo, {d} días). Esa mercadería no se puede vender hasta recibirla.",
    "rk.go.envios":"Ver envíos",
    "dc.envio.t":"Envíos para recibir en AR",
    "dc.envio.d":"Recibilos en Terceros / Tránsito cuando lleguen para que sumen stock en Select.",
    "fin.manual":"Carga manual",
    "fin.cf.del":"¿Borrar el costo financiero \"{c}\" ({m})?",
    "fin.tt.deleted":"Costo financiero borrado"
  });
})();
