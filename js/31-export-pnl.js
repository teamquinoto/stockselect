/* ============================================================
   gestordestock — 31-export-pnl.js
   Parte de la app. Se carga como <script> en el ORDEN del index.html.
   Todo vive en scope global (sin módulos), igual que antes.
   ============================================================ */
/* ============================================================
   P&L EXPORT — preliminary income statement (Excel)
   ------------------------------------------------------------
   AHORA toma los números de pnlAggregate() (definida en
   11-view-analisis.js), la MISMA fuente que alimenta el P&L
   en pantalla. Con esto:
     · el Excel y la vista reconcilian por construcción;
     · los CARGOS ON-TOP facturados al cliente entran como ingreso
       (antes quedaban afuera → fix);
     · todo en USD (moneda única, sin conversiones).
   Hojas: Income Statement · By seller · Detail by product.
   ============================================================ */
function exportPnL(desde, hasta){
  if(!window.XLSX){ toast(t("pnl.tt.noxlsx"),"warn"); return; }

  const A   = pnlAggregate(desde, hasta, effectiveStores());   // <-- fuente ÚNICA (misma que la pantalla), con el foco de depósito activo
  const depTxt = STORE_IDS.every(s=> effectiveStores().includes(s)) ? "Consolidated (Swan + Select)" : ("Deposit: " + effectiveStores().map(storeName).join(", "));

  // ---- Formatos de celda (USD) ----
  const repSym = CCY_SYM;
  const MFMT = '"'+repSym+'\u00A0"#,##0.00;("'+repSym+'\u00A0"#,##0.00)';
  const PFMT = '0.0%';
  const setFmt = (ws, ref, z)=>{ const c=ws[ref]; if(c && typeof c.v==="number") c.z=z; };

  const period = `Period: ${desde?fmtDate(desde):"start"}  \u2192  ${hasta?fmtDate(hasta):"today"}`;
  const wb = XLSX.utils.book_new();

  /* ---------- HOJA 1: Income Statement (consolidado, multi-step) ---------- */
  const net = A.net, gp = A.gp;
  const pct = (n)=> net>0 ? (n/net) : 0;
  const IS = [
    ["Income Statement (Preliminary)"],
    [period],
    ["Amounts in USD \u00B7 " + depTxt],
    [""],
    ["Concept", "Consolidated", "% of revenue"],
    ["Product sales", A.sales, pct(A.sales)],
    ["Shipping billed to customers", A.shipping, pct(A.shipping)],
    ["Extra charges billed to customers", A.cargos, pct(A.cargos)],   // <-- FIX: on-top que paga el cliente
    ["Net revenue", net, pct(net)],
    ["Cost of goods sold (FIFO)", -A.cogs, pct(-A.cogs)],
    ["Gross profit", gp, pct(gp)],
    ["Gross margin %", (net>0?gp/net:0), ""],
    [""],
    ["Selling costs", "", ""],
    ["  Seller commissions", -A.commission, pct(-A.commission)],
    ["  Shipping / ShipStation", -A.costos.envio, pct(-A.costos.envio)],
    ["  Man-hours", -A.costos.labor, pct(-A.costos.labor)],
    ["  Sales commission (manual)", -A.costos.comision, pct(-A.costos.comision)],
    ["  Other", -A.costos.otro, pct(-A.costos.otro)],
    ["Total selling costs", -A.sellingTotal, pct(-A.sellingTotal)],
    ["Contribution margin (net)", A.contrib, pct(A.contrib)],
    ["Contribution margin %", (net>0?A.contrib/net:0), ""],
    ["Financial costs (wire fees, bank charges, interest)", -A.financieros, pct(-A.financieros)],
    ["Result after financial costs", A.resultado, pct(A.resultado)],
    [""],
    ["Operating expenses", "n/a", ""],
    ["  (rent, marketing, fixed payroll, fees — not tracked in this system)"],
    ["Operating income", A.resultado, pct(A.resultado)],
    [""],
    ["Notes:"],
    ["\u2022 COGS uses the actual FIFO cost layers of the deposit each sale shipped from (not last cost)."],
    ["\u2022 Inbound freight/handling is capitalized into landed cost, so it is already inside COGS."],
    ["\u2022 Extra charges billed to customers (intl freight, wire fees, nationalization, service markup) are customer-paid, so they add to revenue."],
    ["\u2022 Selling costs (commission, shipping, man-hours, etc.) are charged per sale and sit below gross profit."],
    ["\u2022 Financial costs of own stock (wire fees, bank charges, interest) are NOT capitalized into inventory (IAS 2 / IAS 23): they are expensed below contribution. Third-party financial costs are re-billed to the owner and are not here."],
    ["\u2022 Operating expenses (structure) are not captured here — plug them into your cost model."],
  ];
  const ws1 = XLSX.utils.aoa_to_sheet(IS);
  ws1["!cols"]=[{wch:48},{wch:16},{wch:13}];
  ws1["!merges"]=[{s:{r:0,c:0},e:{r:0,c:2}},{s:{r:1,c:0},e:{r:1,c:2}},{s:{r:2,c:0},e:{r:2,c:2}}];
  // Filas (1-based) con importe en B y % en C (recalculadas por el renglón nuevo de cargos)
  [6,7,8,9,10,11,15,16,17,18,19,20,21,23,24,28].forEach(r=>{ setFmt(ws1, "B"+r, MFMT); setFmt(ws1, "C"+r, PFMT); });
  // Filas con % directo en B (márgenes)
  [12,22].forEach(r=> setFmt(ws1, "B"+r, PFMT));
  XLSX.utils.book_append_sheet(wb, ws1, "Income Statement");

  /* ---------- HOJA 1b: Por depósito (Swan vs Select) ---------- */
  const depH = ["Deposit","Net revenue","COGS (FIFO)","Gross profit","Selling costs","Contribution","Financial costs","Result"];
  const depBody = STORE_IDS.filter(sid=> A.perStore[sid]).map(sid=>{ const e=A.perStore[sid];
    return [storeName(sid), e.net, -e.cogs, e.gp, -(e.commission+e.costos), e.contrib, -e.financieros, e.resultado]; });
  if(A.finSinAsignar>0) depBody.push(["General (unassigned financial costs)", 0, 0, 0, 0, 0, -A.finSinAsignar, -A.finSinAsignar]);
  const depAoa = [["By deposit"],[period],[],depH,...depBody,[],["TOTAL", A.net, -A.cogs, A.gp, -A.sellingTotal, A.contrib, -A.financieros, A.resultado]];
  const wsD = XLSX.utils.aoa_to_sheet(depAoa);
  wsD["!cols"]=[{wch:34},{wch:14},{wch:14},{wch:14},{wch:14},{wch:14},{wch:15},{wch:14}];
  for(let r=5;r<=depAoa.length;r++){ ["B","C","D","E","F","G","H"].forEach(col=> setFmt(wsD, col+r, MFMT)); }
  XLSX.utils.book_append_sheet(wb, wsD, "By deposit");

  /* ---------- HOJA 1c: Costos financieros del período ---------- */
  const fAoa = [["Financial costs"],[period],[],["Date","Concept","Deposit","Source","Amount"],
    ...(A.finList||[]).slice().sort((a,b)=>String(a.fecha).localeCompare(String(b.fecha))).map(e=>[fmtDate(e.fecha), e.concepto||"", e.store?storeName(e.store):"General", e.auto?((e.fuente&&e.fuente.codigo)||"auto"):"manual", round2(e.monto)]),
    [],["","TOTAL","","",A.financieros]];
  const wsF = XLSX.utils.aoa_to_sheet(fAoa);
  wsF["!cols"]=[{wch:13},{wch:44},{wch:16},{wch:12},{wch:14}];
  for(let r=5;r<=fAoa.length;r++) setFmt(wsF, "E"+r, MFMT);
  XLSX.utils.book_append_sheet(wb, wsF, "Financial costs");

  /* ---------- HOJA 2: By seller ---------- */
  const vHeader = ["Seller","Revenue","COGS (FIFO)","Gross margin","Margin %","Commission"];
  let sV=0,sC=0,sK=0;
  const vBody = Object.values(A.perVend).sort((a,b)=>b.sales-a.sales).map(v=>{
    const gm=round2(v.sales-v.cogs), p=v.sales>0?(gm/v.sales):0;
    sV+=v.sales; sC+=v.cogs; sK+=v.commission;
    return [v.nombre, round2(v.sales), round2(v.cogs), gm, p, round2(v.commission)];
  });
  const tGM=round2(sV-sC), tP=sV>0?(tGM/sV):0;
  const vAoa=[["By seller"],[period],[],vHeader,...vBody,[],["TOTAL",round2(sV),round2(sC),tGM,tP,round2(sK)]];
  const ws2=XLSX.utils.aoa_to_sheet(vAoa);
  ws2["!cols"]=[{wch:22},{wch:14},{wch:14},{wch:14},{wch:10},{wch:14}];
  ws2["!merges"]=[{s:{r:0,c:0},e:{r:0,c:5}},{s:{r:1,c:0},e:{r:1,c:5}}];
  for(let r=5;r<=vAoa.length;r++){ ["B","C","D","F"].forEach(col=> setFmt(ws2, col+r, MFMT)); setFmt(ws2, "E"+r, PFMT); }
  XLSX.utils.book_append_sheet(wb, ws2, "By seller");

  /* ---------- HOJA 3: Detalle por producto (consolidado) ---------- */
  const header = ["SKU","Product","Units","Revenue","COGS (FIFO)","Gross margin","Margin %"];
  let tU=0,tR=0,tC=0; const body=[];
  Object.values(A.detail).sort((a,b)=>b.revenue-a.revenue).forEach(e=>{
    const gm=round2(e.revenue-e.cogs), p = e.revenue>0? (gm/e.revenue):0;
    body.push([e.sku, e.nombre, e.units, round2(e.revenue), round2(e.cogs), gm, p]);
    tU+=e.units; tR+=e.revenue; tC+=e.cogs;
  });
  const dGM=round2(tR-tC), dP=tR>0?(dGM/tR):0;
  const dAoa=[["Consolidated — Detail by product"],[period],[],header,...body,[],["","TOTAL",tU,round2(tR),round2(tC),dGM,dP]];
  const ws3=XLSX.utils.aoa_to_sheet(dAoa);
  ws3["!cols"]=[{wch:14},{wch:42},{wch:8},{wch:13},{wch:13},{wch:13},{wch:10}];
  ws3["!merges"]=[{s:{r:0,c:0},e:{r:0,c:6}},{s:{r:1,c:0},e:{r:1,c:6}}];
  for(let r=5;r<=dAoa.length;r++){ ["D","E","F"].forEach(col=> setFmt(ws3, col+r, MFMT)); setFmt(ws3, "G"+r, PFMT); }
  XLSX.utils.book_append_sheet(wb, ws3, "Detail Consolidated");

  XLSX.writeFile(wb, `income-statement-${new Date().toISOString().slice(0,10)}.xlsx`);
  toast(t("pnl.tt.exported"));
}
function openPnLExport(){
  const today=new Date().toISOString().slice(0,10);
  const first=today.slice(0,8)+"01";
  buildModal(t("pnl.md.title"), `
    <p class="hint" style="margin:0 0 12px">${t("pnl.hint")}</p>
    <div class="grid-form" style="grid-template-columns:1fr 1fr;padding:0">
      <div class="field"><label>${t("mov.from")}</label><input class="inp" type="date" id="pnl_d0" value="${first}"></div>
      <div class="field"><label>${t("mov.to")}</label><input class="inp" type="date" id="pnl_d1" value="${today}"></div>
    </div>
  `, [
    {label:t("common.cancel"),cls:"btn",act:closeModal},
    {label:t("io.exportxlsx"),cls:"btn primary",act:()=>{ const d0=document.getElementById("pnl_d0").value, d1=document.getElementById("pnl_d1").value; closeModal(); exportPnL(d0,d1); }}
  ]);
}
