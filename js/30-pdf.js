/* ============================================================
   gestordestock — 30-pdf.js
   Parte de la app. Se carga como <script> en el ORDEN del index.html.
   Todo vive en scope global (sin módulos), igual que antes.
   ============================================================ */
/* ============================================================
   PUNTO 8 y 10 — Generación de PDF (invoice de venta + lista de precios)
   Usa jsPDF (UMD por CDN, cacheado por el SW para uso offline).
   ============================================================ */
function pdfReady(){ return !!(window.jspdf && window.jspdf.jsPDF); }
function pdfMoney(n, ccy){ return monedaSym(ccy || reportCcy()) + " " + nf2.format(n||0); }

function generarInvoicePDF(id){
  if(!pdfReady()){ toast("Couldn't load the PDF generator (try once with internet)","warn"); return; }
  const d = db.ventas.find(v=>v.id===id); if(!d){ toast("Sale not found","warn"); return; }
  const dCcy = storeCcy(d.storeVenta||d.store||STORE_IDS[0]);   // el invoice se emite en la moneda del depósito
  const cli = d.cliente || (d.clienteId?clienteById(d.clienteId):null);
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit:"pt", format:"letter" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 48;
  const em = db.config.emisor||{};
  // Paleta (mismo azul del tema)
  const INK=[26,26,26], MUT=[120,120,120], LINE=[228,225,220], ACC=[37,99,235], ZEBRA=[248,247,245];
  const setInk=(c)=>doc.setTextColor(c[0],c[1],c[2]);

  /* ---------- Header band ---------- */
  doc.setFillColor(ACC[0],ACC[1],ACC[2]); doc.rect(0,0,W,96,"F");
  doc.setTextColor(255,255,255);
  doc.setFont("helvetica","bold"); doc.setFontSize(19);
  doc.text(em.nombre || "INVOICE", M, 42);
  doc.setFont("helvetica","normal"); doc.setFontSize(8.5);
  let hy=60;
  [em.direccion, [em.email, em.tel].filter(Boolean).join("  ·  ")].filter(Boolean).forEach(t=>{ doc.text(String(t), M, hy); hy+=12; });
  // right side: INVOICE + number + date
  doc.setFont("helvetica","bold"); doc.setFontSize(22);
  doc.text("INVOICE", W-M, 40, {align:"right"});
  doc.setFont("helvetica","normal"); doc.setFontSize(9.5);
  doc.text(`No. ${d.numero||"—"}`, W-M, 58, {align:"right"});
  doc.text(fmtDate(d.fecha), W-M, 72, {align:"right"});

  /* ---------- Bill To ---------- */
  let y=132;
  doc.setFont("helvetica","bold"); doc.setFontSize(9); setInk(MUT);
  doc.text("BILL TO", M, y);
  doc.text("STORE", W-M-150, y);
  y+=15; setInk(INK); doc.setFontSize(10);
  const leftLines=[];
  if(cli){
    leftLines.push(["bold", cli.nombre||""]);
    const l2=[cli.empresa, cli.contacto].filter(Boolean).join(" · "); if(l2) leftLines.push(["normal", l2]);
    if(cli.direccion) leftLines.push(["normal", cli.direccion]);
    const cz=[cli.ciudad, cli.estado, cli.zip].filter(Boolean).join(", "); if(cz) leftLines.push(["normal", cz]);
    if(cli.pais) leftLines.push(["normal", cli.pais]);
    const ce=[cli.email, cli.telefono].filter(Boolean).join(" · "); if(ce) leftLines.push(["muted", ce]);
  } else leftLines.push(["normal","—"]);
  let ly=y;
  leftLines.forEach(([style,txt])=>{
    doc.setFont("helvetica", style==="bold"?"bold":"normal"); setInk(style==="muted"?MUT:INK);
    doc.setFontSize(style==="bold"?10.5:9.5);
    doc.splitTextToSize(txt, 260).forEach(t=>{ doc.text(t, M, ly); ly+=13; });
  });
  // store box (right)
  doc.setFont("helvetica","normal"); doc.setFontSize(10); setInk(INK);
  doc.text(storeName(d.store||STORE_IDS[0]), W-M-150, y);

  /* ---------- Table ---------- */
  y = Math.max(ly, y+13) + 18;
  const cItem=M, wItem=W-M-M-200;
  const cQty=W-M-200, wQty=44;
  const cUnit=W-M-150, wUnit=74;
  const cAmt=W-M-70, wAmt=70;
  const drawHead=(yy)=>{
    doc.setFillColor(ACC[0],ACC[1],ACC[2]); doc.rect(M, yy-13, W-2*M, 24, "F");
    doc.setTextColor(255,255,255); doc.setFont("helvetica","bold"); doc.setFontSize(9);
    doc.text("ITEM", cItem+6, yy+3);
    doc.text("QTY", cQty+wQty, yy+3, {align:"right"});
    doc.text("UNIT PRICE", cUnit+wUnit, yy+3, {align:"right"});
    doc.text("AMOUNT", cAmt+wAmt, yy+3, {align:"right"});
    return yy+24;
  };
  y = drawHead(y);
  doc.setFont("helvetica","normal");
  let zebra=false;
  d.lineas.forEach(l=>{
    const nom=(l.sku?`[${l.sku}] `:"")+(l.nombre||"");
    const wrapped=doc.splitTextToSize(nom, wItem-8);
    const rowH=Math.max(20, wrapped.length*11.5 + 8);
    if(y+rowH>H-96){ y=drawHead(60); zebra=false; }
    if(zebra){ doc.setFillColor(ZEBRA[0],ZEBRA[1],ZEBRA[2]); doc.rect(M, y-12, W-2*M, rowH, "F"); }
    zebra=!zebra;
    const tTop=y+1;                                  // baseline superior del renglón
    setInk(INK); doc.setFontSize(9.5);
    doc.text(wrapped, cItem+6, tTop);
    setInk(INK);
    doc.text(qty(l.cantidad), cQty+wQty, tTop, {align:"right"});
    doc.text(pdfMoney(l.precio, dCcy), cUnit+wUnit, tTop, {align:"right"});
    doc.setFont("helvetica","bold"); doc.text(pdfMoney(l.cantidad*l.precio, dCcy), cAmt+wAmt, tTop, {align:"right"}); doc.setFont("helvetica","normal");
    y += rowH;
    doc.setDrawColor(LINE[0],LINE[1],LINE[2]); doc.line(M, y-6, W-M, y-6);
  });

  /* ---------- Totals box ---------- */
  y+=14;
  const sub=(d.subtotal!=null)?d.subtotal:totalLineas(d.lineas);
  const envio = d.envio && d.envio.tipo==="monto" ? (d.envio.monto||0) : 0;
  const boxX=W-M-230, boxW=230;
  const line=(label,val,opts={})=>{
    doc.setFont("helvetica",opts.bold?"bold":"normal");
    doc.setFontSize(opts.big?12:10);
    setInk(opts.bold?INK:MUT);
    doc.text(label, boxX, y); setInk(opts.bold?INK:INK);
    doc.text(val, W-M, y, {align:"right"}); y+= opts.big?22:16;
  };
  line("Subtotal", pdfMoney(sub, dCcy));
  line("Shipping", d.envio && d.envio.tipo==="free" ? "Free" : pdfMoney(envio, dCcy));
  y+=4;
  doc.setDrawColor(ACC[0],ACC[1],ACC[2]); doc.setLineWidth(1.2); doc.line(boxX, y-8, W-M, y-8); doc.setLineWidth(1);
  y+=4;
  doc.setFillColor(ACC[0],ACC[1],ACC[2]);
  const total=(d.total!=null)?d.total:round2(sub+envio);
  line("TOTAL", pdfMoney(total, dCcy), {bold:true, big:true});

  /* ---------- Footer ---------- */
  setInk(MUT); doc.setFont("helvetica","normal"); doc.setFontSize(8.5);
  doc.text("Thank you for your business.", M, H-46);
  doc.setDrawColor(LINE[0],LINE[1],LINE[2]); doc.line(M, H-58, W-M, H-58);

  doc.save(`invoice-${(d.numero||"sale")}.pdf`);
  toast("Invoice downloaded");
}

/* ============================================================
   REMITO INTERNO (documento que viaja de EEUU a AR)
   ------------------------------------------------------------
   NO es el invoice original del proveedor: es un documento interno con las
   cantidades YA FILTRADAS de lo que efectivamente cruza a Argentina —lo
   nuestro rumbo AR (tránsito) + lo ajeno de cada tercero— con su costo de
   referencia. Lo que queda en Swan (USA) NO viaja, así que no figura.
   ============================================================ */
function generarRemitoPDF(conjuntaId){
  if(!pdfReady()){ toast("Couldn't load the PDF generator (try once with internet)","warn"); return; }
  const d = (db.conjuntas||[]).find(x=>x.id===conjuntaId); if(!d){ toast("Joint buy not found","warn"); return; }
  // Filas que VIAJAN: ours→AR (aTransito) y ajeno por dueño.
  const filas = [];
  (d.lineas||[]).forEach(l=>{
    const nom = (l.sku?`[${l.sku}] `:"")+(l.nombre||"");
    if((l.aTransito||0)>0) filas.push({ nom, owner:"Ours (Swan)", qty:l.aTransito, costo:l.costoUnit||0 });
    if((l.ajeno||0)>0){
      const c = l.terceroId ? clienteById(l.terceroId) : null;
      filas.push({ nom, owner:(c?(c.nombre+(c.empresa?` · ${c.empresa}`:"")):"Third party"), qty:l.ajeno, costo:l.costoUnit||0 });
    }
  });
  if(!filas.length){ toast("Nothing travels to AR in this joint buy","warn"); return; }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit:"pt", format:"letter" });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 48;
  const em = db.config.emisor||{};
  const INK=[26,26,26], MUT=[120,120,120], LINE=[228,225,220], ACC=[37,99,235], ZEBRA=[248,247,245];
  const setInk=(c)=>doc.setTextColor(c[0],c[1],c[2]);

  /* Header band */
  doc.setFillColor(ACC[0],ACC[1],ACC[2]); doc.rect(0,0,W,96,"F");
  doc.setTextColor(255,255,255);
  doc.setFont("helvetica","bold"); doc.setFontSize(19);
  doc.text(em.nombre || "REMITO", M, 42);
  doc.setFont("helvetica","normal"); doc.setFontSize(8.5);
  doc.text("Internal transfer note · USA (Swan) → AR (Select)", M, 60);
  doc.setFont("helvetica","bold"); doc.setFontSize(20);
  doc.text("REMITO", W-M, 40, {align:"right"});
  doc.setFont("helvetica","normal"); doc.setFontSize(9.5);
  doc.text(`Shipment ${d.numero||"—"}`, W-M, 58, {align:"right"});
  doc.text(fmtDate(d.fecha), W-M, 72, {align:"right"});

  /* Sub-caption */
  let y=126;
  setInk(MUT); doc.setFont("helvetica","normal"); doc.setFontSize(9);
  doc.text("Not a commercial invoice — internal movement document. Quantities already filtered (US-kept units excluded).", M, y);
  y+=22;

  /* Table */
  const cItem=M, wItem=W-M-M-320;
  const cOwn=W-M-320, wOwn=150;
  const cQty=W-M-150, wQty=44;
  const cUnit=W-M-120, wUnit=52;
  const cAmt=W-M-60, wAmt=60;
  const drawHead=(yy)=>{
    doc.setFillColor(ACC[0],ACC[1],ACC[2]); doc.rect(M, yy-13, W-2*M, 24, "F");
    doc.setTextColor(255,255,255); doc.setFont("helvetica","bold"); doc.setFontSize(9);
    doc.text("ITEM", cItem+6, yy+3);
    doc.text("OWNER", cOwn, yy+3);
    doc.text("QTY", cQty+wQty, yy+3, {align:"right"});
    doc.text("REF. COST", cUnit+wUnit, yy+3, {align:"right"});
    doc.text("AMOUNT", cAmt+wAmt, yy+3, {align:"right"});
    return yy+24;
  };
  y = drawHead(y);
  doc.setFont("helvetica","normal"); let zebra=false, totQ=0, totAmt=0;
  filas.forEach(f=>{
    const wrapped=doc.splitTextToSize(f.nom, wItem-8);
    const rowH=Math.max(20, wrapped.length*11.5 + 8);
    if(y+rowH>H-96){ y=drawHead(60); zebra=false; }
    if(zebra){ doc.setFillColor(ZEBRA[0],ZEBRA[1],ZEBRA[2]); doc.rect(M, y-12, W-2*M, rowH, "F"); }
    zebra=!zebra;
    const tTop=y+1;
    setInk(INK); doc.setFontSize(9.5); doc.text(wrapped, cItem+6, tTop);
    setInk(f.owner.indexOf("Ours")===0?MUT:INK); doc.setFontSize(9);
    doc.text(doc.splitTextToSize(f.owner, wOwn), cOwn, tTop);
    setInk(INK); doc.setFontSize(9.5);
    doc.text(qty(f.qty), cQty+wQty, tTop, {align:"right"});
    doc.text(pdfMoney(f.costo, "USD"), cUnit+wUnit, tTop, {align:"right"});
    doc.setFont("helvetica","bold"); doc.text(pdfMoney(f.qty*f.costo, "USD"), cAmt+wAmt, tTop, {align:"right"}); doc.setFont("helvetica","normal");
    totQ+=f.qty; totAmt+=f.qty*f.costo;
    y+=rowH; doc.setDrawColor(LINE[0],LINE[1],LINE[2]); doc.line(M, y-6, W-M, y-6);
  });

  /* Totals */
  y+=14; const boxX=W-M-230;
  const line=(label,val,opts={})=>{
    doc.setFont("helvetica",opts.bold?"bold":"normal"); doc.setFontSize(opts.big?12:10);
    setInk(opts.bold?INK:MUT); doc.text(label, boxX, y); setInk(INK);
    doc.text(val, W-M, y, {align:"right"}); y+= opts.big?22:16;
  };
  line("Total units traveling", qty(totQ));
  doc.setDrawColor(ACC[0],ACC[1],ACC[2]); doc.setLineWidth(1.2); doc.line(boxX, y-8, W-M, y-8); doc.setLineWidth(1); y+=4;
  line("Reference value", pdfMoney(totAmt, "USD"), {bold:true, big:true});

  /* Footer */
  setInk(MUT); doc.setFont("helvetica","normal"); doc.setFontSize(8.5);
  doc.text("Third-party units belong to their listed owner and are moved for logistics/traceability only.", M, H-46);
  doc.setDrawColor(LINE[0],LINE[1],LINE[2]); doc.line(M, H-58, W-M, H-58);

  doc.save(`remito-${(d.numero||"shipment")}.pdf`);
  toast("Remito downloaded");
}

/* Lista de precios para clientes (punto 10). Recibe la lista ya filtrada. */
function exportListaPrecios(prods){
  if(!pdfReady()){ toast("Couldn't load the PDF generator (try once with internet)","warn"); return; }
  // Point 9: a customer price list must never leak blocked or investment items.
  const clean = prods.filter(p=> !soloEnVault(p) && !esBloqueado(p) && (p.precioVenta||0)>0);
  const dropped = prods.length - clean.length;
  if(!clean.length){ toast("No sellable products with a price to export","warn"); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit:"pt", format:"letter" });
  const M=48, W=doc.internal.pageSize.getWidth(); let y=56;
  const em=db.config.emisor||{};
  doc.setFont("helvetica","bold"); doc.setFontSize(18); doc.setTextColor(20);
  doc.text(em.nombre?`${em.nombre} — Price list`:"Price list", M, y); y+=18;
  doc.setFont("helvetica","normal"); doc.setFontSize(9.5); doc.setTextColor(120);
  doc.text(new Date().toLocaleDateString("en-US"), M, y); y+=20;

  const cSKU=M, cName=M+90, cPrice=W-M;
  doc.setFillColor(245); doc.rect(M, y-12, W-2*M, 22, "F");
  doc.setFont("helvetica","bold"); doc.setFontSize(9.5); doc.setTextColor(40);
  doc.text("SKU", cSKU, y+3); doc.text("Product", cName, y+3); doc.text("Price", cPrice, y+3, {align:"right"});
  y+=22; doc.setFont("helvetica","normal"); doc.setTextColor(55);
  clean.slice().sort((a,b)=>String(a.nombre||"").localeCompare(String(b.nombre||""),"en")).forEach(p=>{
    if(y>740){ doc.addPage(); y=60; }
    doc.setTextColor(120); doc.setFontSize(8.5); doc.text(p.sku||"—", cSKU, y);
    doc.setTextColor(55); doc.setFontSize(10);
    const wrapped=doc.splitTextToSize(p.nombre||"", cPrice-cName-70);
    doc.text(wrapped, cName, y);
    doc.text(pdfMoney(p.precioVenta), cPrice, y, {align:"right"});
    y += Math.max(15, wrapped.length*12);
    doc.setDrawColor(240); doc.line(M, y-5, W-M, y-5);
  });
  doc.save(`price-list-${new Date().toISOString().slice(0,10)}.pdf`);
  toast(`Price list exported · ${clean.length} products${dropped>0?` (${dropped} blocked/investment excluded)`:""}`);
}

