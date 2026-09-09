/* ============================================================
   gestordestock — 31-export-pnl.js
   Parte de la app. Se carga como <script> en el ORDEN del index.html.
   Todo vive en scope global (sin módulos), igual que antes.
   ============================================================ */
/* ============================================================
   P&L EXPORT (point 8) — preliminary income statement (Excel)
   ------------------------------------------------------------
   El stock es un pool único y la venta ya no está atada a una
   sociedad, así que el estado es CONSOLIDADO. Se agrega una hoja
   de rendimiento POR VENDEDOR (revenue, COGS FIFO, margen, comisión)
   y el detalle por producto. Built from sales in the selected period.
   ============================================================ */
function exportPnL(desde, hasta){
  if(!window.XLSX){ toast("Couldn't load the Excel engine (try once with internet)","warn"); return; }
  const d0 = desde ? new Date(desde+"T00:00:00") : null;
  const d1 = hasta ? new Date(hasta+"T23:59:59") : null;
  const inRange = v=>{ const f=new Date((normISO(v.fecha)||v.fecha)+"T12:00:00"); if(d0&&f<d0) return false; if(d1&&f>d1) return false; return true; };

  // ---- Aggregations (consolidated) ----
  const consol = { sales:0, shipping:0, cogs:0 };
  const detail = {};                 // prodKey -> {sku,nombre,units,revenue,cogs}
  const perVend = {};                // vendedorId|"" -> {nombre, sales, cogs, commission}
  const ventasPeriodo = db.ventas.filter(inRange);

  ventasPeriodo.forEach(v=>{
    const vid = v.vendedorId || "";
    const pv = perVend[vid] = perVend[vid] || { nombre: saleVendedorNombre(v), sales:0, cogs:0, commission:0 };
    (v.lineas||[]).forEach(l=>{
      const rev = round2((l.precio||0)*l.cantidad);
      const cogs = round2(l.cogs!=null ? l.cogs : (l.costo||0)*l.cantidad);
      consol.sales += rev; consol.cogs += cogs;
      pv.sales += rev; pv.cogs += cogs;
      const k = l.productoId||l.sku||l.nombre;
      const e = detail[k] = detail[k] || { sku:l.sku||"", nombre:l.nombre||"", units:0, revenue:0, cogs:0 };
      e.units += l.cantidad; e.revenue += rev; e.cogs += cogs;
    });
    if(v.envio && v.envio.tipo==="monto") consol.shipping += round2(v.envio.monto||0);
    pv.commission += saleCommission(v);
  });
  consol.sales=round2(consol.sales); consol.shipping=round2(consol.shipping); consol.cogs=round2(consol.cogs);

  // ---- Formatos de celda ----
  const MFMT = '"$"#,##0.00;("$"#,##0.00)';
  const PFMT = '0.0%';
  const setFmt = (ws, ref, z)=>{ const c=ws[ref]; if(c && typeof c.v==="number") c.z=z; };

  const period = `Period: ${desde?fmtDate(desde):"start"}  →  ${hasta?fmtDate(hasta):"today"}`;
  const wb = XLSX.utils.book_new();

  /* ---------- HOJA 1: Income Statement (consolidado, multi-step) ---------- */
  const net = round2(consol.sales + consol.shipping);
  const gp  = round2(net - consol.cogs);
  const pct = (n)=> net>0 ? (n/net) : 0;
  const IS = [
    ["Income Statement (Preliminary)"],
    [period],
    [""],
    ["Concept", "Consolidated", "% of revenue"],
    ["Product sales", consol.sales, pct(consol.sales)],
    ["Shipping billed to customers", consol.shipping, pct(consol.shipping)],
    ["Net revenue", net, pct(net)],
    ["Cost of goods sold (FIFO)", -consol.cogs, pct(-consol.cogs)],
    ["Gross profit", gp, pct(gp)],
    ["Gross margin %", (net>0?gp/net:0), ""],
    [""],
    ["Operating expenses", "n/a", ""],
    ["  (rent, payroll, marketing, fees — not tracked in this system)"],
    ["Operating income", gp, pct(gp)],
    [""],
    ["Notes:"],
    ["• COGS uses the actual FIFO cost layers of the deposit each sale shipped from (not last cost)."],
    ["• Inbound freight/handling is capitalized into landed cost, so it is already inside COGS."],
    ["• Stock lives in real deposits (Select · USA / Swan · AR); a sale draws only from its chosen deposit."],
    ["• Operating expenses are not captured here — plug them into your structure-cost model."],
  ];
  const ws1 = XLSX.utils.aoa_to_sheet(IS);
  ws1["!cols"]=[{wch:46},{wch:16},{wch:13}];
  ws1["!merges"]=[{s:{r:0,c:0},e:{r:0,c:2}},{s:{r:1,c:0},e:{r:1,c:2}}];
  for(let r=4;r<=13;r++){ setFmt(ws1, "B"+(r+1), MFMT); setFmt(ws1, "C"+(r+1), PFMT); }
  setFmt(ws1, "B10", PFMT);   // Gross margin %
  XLSX.utils.book_append_sheet(wb, ws1, "Income Statement");

  /* ---------- HOJA 2: By seller ---------- */
  const vHeader = ["Seller","Revenue","COGS (FIFO)","Gross margin","Margin %","Commission"];
  let sV=0,sC=0,sK=0;
  const vBody = Object.values(perVend).sort((a,b)=>b.sales-a.sales).map(v=>{
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
  Object.values(detail).sort((a,b)=>b.revenue-a.revenue).forEach(e=>{
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
  toast("Income statement exported (Excel)");
}
function openPnLExport(){
  const today=new Date().toISOString().slice(0,10);
  const first=today.slice(0,8)+"01";
  buildModal("Export income statement", `
    <p class="hint" style="margin:0 0 12px">Consolidated multi-step income statement (net revenue → FIFO COGS → gross profit), a per-seller breakdown and product detail. Excel workbook for the selected period.</p>
    <div class="grid-form" style="grid-template-columns:1fr 1fr;padding:0">
      <div class="field"><label>From</label><input class="inp" type="date" id="pnl_d0" value="${first}"></div>
      <div class="field"><label>To</label><input class="inp" type="date" id="pnl_d1" value="${today}"></div>
    </div>
  `, [
    {label:"Cancel",cls:"btn",act:closeModal},
    {label:"Export .xlsx",cls:"btn primary",act:()=>{ const d0=document.getElementById("pnl_d0").value, d1=document.getElementById("pnl_d1").value; closeModal(); exportPnL(d0,d1); }}
  ]);
}

