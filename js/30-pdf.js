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
function pdfMoney(n){ return CCY_SYM + " " + nf2.format(n||0); }

function generarInvoicePDF(id){
  if(!pdfReady()){ toast(t("pdf.err.gen"),"warn"); return; }
  const d = db.ventas.find(v=>v.id===id); if(!d){ toast(t("pdf.err.saleNotFound"),"warn"); return; }
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
  doc.text(em.nombre || t("pdf.inv.title"), M, 42);
  doc.setFont("helvetica","normal"); doc.setFontSize(8.5);
  let hy=60;
  [em.direccion, [em.email, em.tel].filter(Boolean).join("  ·  ")].filter(Boolean).forEach(t=>{ doc.text(String(t), M, hy); hy+=12; });
  // right side: INVOICE + number + date
  doc.setFont("helvetica","bold"); doc.setFontSize(22);
  doc.text(t("pdf.inv.title"), W-M, 40, {align:"right"});
  doc.setFont("helvetica","normal"); doc.setFontSize(9.5);
  doc.text(t("pdf.inv.no",{n:d.numero||"—"}), W-M, 58, {align:"right"});
  doc.text(fmtDate(d.fecha), W-M, 72, {align:"right"});

  /* ---------- Bill To ---------- */
  let y=132;
  doc.setFont("helvetica","bold"); doc.setFontSize(9); setInk(MUT);
  doc.text(t("pdf.inv.billto"), M, y);
  doc.text(t("pdf.store"), W-M-150, y);
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
    doc.text(t("pdf.th.item"), cItem+6, yy+3);
    doc.text(t("pdf.th.qty"), cQty+wQty, yy+3, {align:"right"});
    doc.text(t("pdf.th.unitprice"), cUnit+wUnit, yy+3, {align:"right"});
    doc.text(t("pdf.th.amount"), cAmt+wAmt, yy+3, {align:"right"});
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
    doc.text(pdfMoney(l.precio), cUnit+wUnit, tTop, {align:"right"});
    doc.setFont("helvetica","bold"); doc.text(pdfMoney(l.cantidad*l.precio), cAmt+wAmt, tTop, {align:"right"}); doc.setFont("helvetica","normal");
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
  line(t("pdf.subtotal"), pdfMoney(sub));
  line(t("pdf.shipping"), d.envio && d.envio.tipo==="free" ? t("pdf.free") : pdfMoney(envio));
  (d.cargosCliente||[]).forEach(c=> line(c.nota||t("pdf.charge"), pdfMoney(c.monto||0)));   // Task 5
  y+=4;
  doc.setDrawColor(ACC[0],ACC[1],ACC[2]); doc.setLineWidth(1.2); doc.line(boxX, y-8, W-M, y-8); doc.setLineWidth(1);
  y+=4;
  doc.setFillColor(ACC[0],ACC[1],ACC[2]);
  const total=(d.total!=null)?d.total:round2(sub+envio+((d.cargosCliente||[]).reduce((a,c)=>a+(c.monto||0),0)));
  line(t("pdf.total"), pdfMoney(total), {bold:true, big:true});

  /* ---------- Footer ---------- */
  setInk(MUT); doc.setFont("helvetica","normal"); doc.setFontSize(8.5);
  doc.text(t("pdf.inv.thanks"), M, H-46);
  doc.setDrawColor(LINE[0],LINE[1],LINE[2]); doc.line(M, H-58, W-M, H-58);

  doc.save(`invoice-${(d.numero||"sale")}.pdf`);
  toast(t("pdf.inv.downloaded"));
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
  if(!pdfReady()){ toast(t("pdf.err.gen"),"warn"); return; }
  const d = (db.conjuntas||[]).find(x=>x.id===conjuntaId); if(!d){ toast(t("pdf.err.jointNotFound"),"warn"); return; }
  // Filas que VIAJAN: ours→AR (aTransito) y ajeno por dueño.
  const filas = [];
  (d.lineas||[]).forEach(l=>{
    const nom = (l.sku?`[${l.sku}] `:"")+(l.nombre||"");
    if((l.aTransito||0)>0) filas.push({ nom, owner:t("pdf.owner.ours"), ours:true, qty:l.aTransito, costo:l.costoUnit||0 });
    if((l.ajeno||0)>0){
      const c = l.terceroId ? clienteById(l.terceroId) : null;
      filas.push({ nom, owner:(c?(c.nombre+(c.empresa?` · ${c.empresa}`:"")):t("pdf.owner.thirdparty")), ours:false, qty:l.ajeno, costo:l.costoUnit||0 });
    }
  });
  if(!filas.length){ toast(t("pdf.err.nothingTravels"),"warn"); return; }

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
  doc.text(em.nombre || t("pdf.rem.title"), M, 42);
  doc.setFont("helvetica","normal"); doc.setFontSize(8.5);
  doc.text(t("pdf.rem.subInternal"), M, 60);
  doc.setFont("helvetica","bold"); doc.setFontSize(20);
  doc.text(t("pdf.rem.title"), W-M, 40, {align:"right"});
  doc.setFont("helvetica","normal"); doc.setFontSize(9.5);
  doc.text(t("pdf.rem.shipment",{n:d.numero||"—"}), W-M, 58, {align:"right"});
  doc.text(fmtDate(d.fecha), W-M, 72, {align:"right"});

  /* Sub-caption */
  let y=126;
  setInk(MUT); doc.setFont("helvetica","normal"); doc.setFontSize(9);
  doc.text(t("pdf.rem.caption"), M, y);
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
    doc.text(t("pdf.th.item"), cItem+6, yy+3);
    doc.text(t("pdf.th.owner"), cOwn, yy+3);
    doc.text(t("pdf.th.qty"), cQty+wQty, yy+3, {align:"right"});
    doc.text(t("pdf.th.refcost"), cUnit+wUnit, yy+3, {align:"right"});
    doc.text(t("pdf.th.amount"), cAmt+wAmt, yy+3, {align:"right"});
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
    setInk(f.ours?MUT:INK); doc.setFontSize(9);
    doc.text(doc.splitTextToSize(f.owner, wOwn), cOwn, tTop);
    setInk(INK); doc.setFontSize(9.5);
    doc.text(qty(f.qty), cQty+wQty, tTop, {align:"right"});
    doc.text(pdfMoney(f.costo), cUnit+wUnit, tTop, {align:"right"});
    doc.setFont("helvetica","bold"); doc.text(pdfMoney(f.qty*f.costo), cAmt+wAmt, tTop, {align:"right"}); doc.setFont("helvetica","normal");
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
  line(t("pdf.rem.totunits"), qty(totQ));
  doc.setDrawColor(ACC[0],ACC[1],ACC[2]); doc.setLineWidth(1.2); doc.line(boxX, y-8, W-M, y-8); doc.setLineWidth(1); y+=4;
  line(t("pdf.rem.refvalue"), pdfMoney(totAmt), {bold:true, big:true});

  /* Footer */
  setInk(MUT); doc.setFont("helvetica","normal"); doc.setFontSize(8.5);
  doc.text(t("pdf.rem.footer"), M, H-46);
  doc.setDrawColor(LINE[0],LINE[1],LINE[2]); doc.line(M, H-58, W-M, H-58);

  doc.save(`remito-${(d.numero||"shipment")}.pdf`);
  toast(t("pdf.rem.downloaded"));
}

/* ============================================================
   REMITO NUMERADO (documento de primera clase) — U (salida US) / A (split AR)
   ------------------------------------------------------------
   Renderiza un objeto de db.remitos con su código de serie (ej. "U 7215").
   El remito A imprime de qué U salió, para la trazabilidad del split.
   ============================================================ */
function generarRemitoDocPDF(remitoId){
  if(!pdfReady()){ toast(t("pdf.err.gen"),"warn"); return; }
  const r = remitoById(remitoId); if(!r){ toast(t("pdf.err.remNotFound"),"warn"); return; }
  const esTercero = r.tipo==="ar-tercero";
  const esSelect  = r.tipo==="ar-select";
  // Un remito NO lista lo "ours" cuando además lleva líneas de terceros: la mercadería
  // propia ya entra como stock nuestro, no viaja como documento de traslado. Sólo se
  // conserva "ours" si el remito es 100% propio (envío de stock propio US→AR desde
  // "Send to transit"), donde ES el sujeto del documento. Esto arregla también remitos
  // viejos que se hayan guardado con la línea "ours" mezclada.
  let lineasVivas = (r.lineas||[]).filter(l=> (l.cantidad||0)>0);
  if(lineasVivas.some(l=> l.rol!=="ours")) lineasVivas = lineasVivas.filter(l=> l.rol!=="ours");
  const filas = lineasVivas.map(l=>{
    const detalle = l.rol==="ours"   ? t("pdf.remdoc.oursAR")
                  : l.rol==="select" ? (t("pdf.remdoc.keptselect") + (l.owner?t("pdf.remdoc.fromowner",{owner:l.owner}):""))
                  : (l.owner || t("pdf.owner.thirdparty"));
    return { nom:(l.sku?`[${l.sku}] `:"")+(l.nombre||""), detalle, qty:l.cantidad||0, ours:l.rol==="ours",
             costo:+l.costoUnit||0, charge:(l.charge!=null?+l.charge:(+l.costoUnit||0)) };
  });
  if(!filas.length){ toast(t("pdf.err.remNoLines"),"warn"); return; }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit:"pt", format:"letter" });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 48;
  const em = db.config.emisor||{};
  const INK=[26,26,26], MUT=[120,120,120], LINE=[228,225,220], ACC=[37,99,235], ZEBRA=[248,247,245];
  const setInk=(c)=>doc.setTextColor(c[0],c[1],c[2]);
  const esAR = r.letra==="A";

  /* Header band */
  doc.setFillColor(ACC[0],ACC[1],ACC[2]); doc.rect(0,0,W,96,"F");
  doc.setTextColor(255,255,255);
  doc.setFont("helvetica","bold"); doc.setFontSize(19);
  doc.text(em.nombre || t("pdf.rem.title"), M, 42);
  doc.setFont("helvetica","normal"); doc.setFontSize(8.5);
  doc.text(esTercero ? t("pdf.remdoc.subTercero")
         : esSelect  ? t("pdf.remdoc.subSelect")
         :             t("pdf.rem.subInternal"), M, 60);
  doc.setFont("helvetica","bold"); doc.setFontSize(20);
  doc.text(t("pdf.rem.title"), W-M, 40, {align:"right"});
  doc.setFont("helvetica","bold"); doc.setFontSize(13);
  doc.text(r.codigo, W-M, 60, {align:"right"});
  doc.setFont("helvetica","normal"); doc.setFontSize(9.5);
  doc.text(fmtDate(r.fecha), W-M, 76, {align:"right"});

  /* Sub-caption + origen (trazabilidad del split) */
  let y=126;
  if(esAR && r.origenCodigo){
    setInk(ACC); doc.setFont("helvetica","bold"); doc.setFontSize(10);
    doc.text(t("pdf.remdoc.splitfrom",{code:r.origenCodigo}), M, y);
    setInk(MUT); doc.setFont("helvetica","normal"); doc.setFontSize(9); y+=16;
  }
  if(r.tracking){   // envío con tracking cargado
    setInk(INK); doc.setFont("helvetica","bold"); doc.setFontSize(10);
    const car = carrierName(r.carrier);
    doc.text(t("pdf.remdoc.tracking",{t:(car?car+" · ":"")+r.tracking}), M, y);
    y+=16;
  }
  setInk(MUT); doc.setFont("helvetica","normal"); doc.setFontSize(9);
  doc.text(esTercero ? t("pdf.remdoc.capTercero")
         : esSelect  ? t("pdf.remdoc.capSelect")
         :             t("pdf.remdoc.capInternal"), M, y);
  y+=22;

  /* Columnas numéricas (derecha) según tipo */
  let rightCols;
  if(esTercero) rightCols = [
    { h:t("pdf.th.qty"), w:44, val:f=>qty(f.qty) },
    { h:t("pdf.th.costu"), w:62, val:f=>pdfMoney(f.costo) },
    { h:t("pdf.th.chargeu"), w:62, val:f=>pdfMoney(f.charge) },
    { h:t("pdf.total"), w:70, val:f=>pdfMoney(f.qty*f.charge), bold:true },
  ];
  else if(esSelect) rightCols = [
    { h:t("pdf.th.qty"), w:44, val:f=>qty(f.qty) },
    { h:t("pdf.th.costu"), w:64, val:f=>pdfMoney(f.costo) },
    { h:t("pdf.th.value"), w:70, val:f=>pdfMoney(f.qty*f.costo), bold:true },
  ];
  else rightCols = [ { h:t("pdf.th.qty"), w:60, val:f=>qty(f.qty) } ];
  let cx = W-M; for(let k=rightCols.length-1;k>=0;k--){ rightCols[k].xr=cx; cx-=rightCols[k].w; }
  const wItem = cx - M - 12;

  const drawHead=(yy)=>{
    doc.setFillColor(ACC[0],ACC[1],ACC[2]); doc.rect(M, yy-13, W-2*M, 24, "F");
    doc.setTextColor(255,255,255); doc.setFont("helvetica","bold"); doc.setFontSize(9);
    doc.text("ITEM", M+6, yy+3);
    rightCols.forEach(c=> doc.text(c.h, c.xr, yy+3, {align:"right"}));
    return yy+24;
  };
  y = drawHead(y);
  doc.setFont("helvetica","normal"); let zebra=false, totQ=0, totCharge=0, totValue=0;
  filas.forEach(f=>{
    const wrapped=doc.splitTextToSize(f.nom, wItem);
    const rowH=Math.max(24, wrapped.length*11.5 + 8 + (f.detalle?11:0));
    if(y+rowH>H-96){ y=drawHead(60); zebra=false; }
    if(zebra){ doc.setFillColor(ZEBRA[0],ZEBRA[1],ZEBRA[2]); doc.rect(M, y-12, W-2*M, rowH, "F"); }
    zebra=!zebra;
    const tTop=y+1;
    setInk(INK); doc.setFontSize(9.5); doc.text(wrapped, M+6, tTop);
    if(f.detalle){ setInk(MUT); doc.setFontSize(8); doc.text(f.detalle, M+6, tTop + wrapped.length*11.5); }
    rightCols.forEach(c=>{ setInk(INK); doc.setFont("helvetica", c.bold?"bold":"normal"); doc.setFontSize(9.5); doc.text(String(c.val(f)), c.xr, tTop, {align:"right"}); });
    doc.setFont("helvetica","normal");
    totQ+=f.qty; totCharge+=f.qty*f.charge; totValue+=f.qty*f.costo;
    y+=rowH; doc.setDrawColor(LINE[0],LINE[1],LINE[2]); doc.line(M, y-6, W-M, y-6);
  });

  /* Totals */
  y+=14; const boxX=W-M-230;
  const tline=(label,val,opts={})=>{
    doc.setFont("helvetica",opts.bold?"bold":"normal"); doc.setFontSize(opts.big?12:10);
    setInk(opts.bold?INK:MUT); doc.text(label, boxX, y); setInk(INK);
    doc.text(val, W-M, y, {align:"right"}); y+= opts.big?22:16;
  };
  tline(t("pdf.remdoc.totunits"), qty(totQ));
  if(esTercero){ doc.setDrawColor(ACC[0],ACC[1],ACC[2]); doc.setLineWidth(1.2); doc.line(boxX, y-8, W-M, y-8); doc.setLineWidth(1); y+=4; tline(t("pdf.remdoc.tocharge"), pdfMoney(totCharge), {bold:true, big:true}); }
  else if(esSelect){ tline(t("pdf.remdoc.valuecost"), pdfMoney(totValue), {bold:true}); }

  /* Footer */
  setInk(MUT); doc.setFont("helvetica","normal"); doc.setFontSize(8.5);
  doc.text(esTercero ? t("pdf.remdoc.footTercero")
         : esSelect  ? t("pdf.remdoc.footSelect")
         :             t("pdf.rem.footer"), M, H-46);
  doc.setDrawColor(LINE[0],LINE[1],LINE[2]); doc.line(M, H-58, W-M, H-58);

  doc.save(`remito-${String(r.codigo).replace(/\s+/g,"-")}.pdf`);
  toast(t("pdf.remdoc.downloaded",{code:r.codigo}));
}

/* Lista de precios para clientes (punto 10). Recibe la lista ya filtrada. */
function exportListaPrecios(prods){
  if(!pdfReady()){ toast(t("pdf.err.gen"),"warn"); return; }
  // Point 9: a customer price list must never leak blocked or investment items.
  const clean = prods.filter(p=> !soloEnVault(p) && !esBloqueado(p) && (p.precioVenta||0)>0);
  const dropped = prods.length - clean.length;
  if(!clean.length){ toast(t("pdf.pl.noprod"),"warn"); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit:"pt", format:"letter" });
  const M=48, W=doc.internal.pageSize.getWidth(); let y=56;
  const em=db.config.emisor||{};
  doc.setFont("helvetica","bold"); doc.setFontSize(18); doc.setTextColor(20);
  doc.text(em.nombre?t("pdf.pl.titleName",{name:em.nombre}):t("pdf.pl.title"), M, y); y+=18;
  doc.setFont("helvetica","normal"); doc.setFontSize(9.5); doc.setTextColor(120);
  doc.text(new Date().toLocaleDateString((typeof lang==="function"&&lang()==="es")?"es-AR":"en-US"), M, y); y+=20;

  const cSKU=M, cName=M+90, cPrice=W-M;
  doc.setFillColor(245); doc.rect(M, y-12, W-2*M, 22, "F");
  doc.setFont("helvetica","bold"); doc.setFontSize(9.5); doc.setTextColor(40);
  doc.text(t("pdf.pl.sku"), cSKU, y+3); doc.text(t("pdf.pl.product"), cName, y+3); doc.text(t("pdf.pl.price"), cPrice, y+3, {align:"right"});
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
  toast(t("pdf.pl.exported",{n:clean.length,extra:dropped>0?t("pdf.pl.excluded",{d:dropped}):""}));
}


/* ============================================================
   EXPORTAR PDF DE PRODUCTOS (antes "Costo en destino")
   v71 · El botón abre un modal para elegir QUÉ columnas van: Cantidad, Costo
   (opcional con desglose US / +Intl / +Arg) y Precio, en cualquier combinación.
   Respeta el depósito en foco (Todas / Swan / Select), los filtros de la lista y,
   si estás en modo selección, sólo los productos tildados.
   Qué productos entran:
     - con Cantidad o Costo tildado -> sólo los que tienen stock (> 0) en el foco;
     - sólo Precio -> los que tienen precio cargado en algún depósito del foco.
   Cantidad = stock vendible (igual que la columna Stock de la lista, sin tránsito).
   Costo = promedio ponderado de las capas FIFO de ese stock (costo en destino).

   Historia (v70) — armado del costo en destino, desglose por producto, puerta por puerta
   US cost (compra) → +Intl (Miami→BA) → +Arg (BA→tienda) = Landed.
   Promedio ponderado sobre el stock EN MANO (vendible + tránsito).
   Sólo referencia de costos (no es factura). Montos en USD.

   v70 · Rehecho el armado:
   - Hoja HORIZONTAL: la columna de producto pasa a tener ~2,5x más ancho.
   - SKU en su propia columna y el nombre se PARTE en hasta 2 renglones (medido con
     el ancho real de la letra, no por cantidad de caracteres): ya no se pisa con
     las unidades. Si aun así no entra, se corta con "…".
   - Texto saneado para la fuente del PDF: "→" salía como "!’" y "&amp;" aparecía
     literal. pdfTxt() decodifica entidades HTML y cambia lo que Helvetica no tiene.
   - Productos sin costo cargado: "sin costo" en rojo + nota al pie con la cantidad,
     así un total en 0 no pasa desapercibido.
   - Pie en cada hoja: fecha y "Página X de Y". El encabezado de columnas se repite.
   ============================================================ */
/* Helvetica estándar de jsPDF sólo tiene Latin-1 + los extras de WinAnsi. Todo lo
   demás sale como basura, así que lo traducimos o lo sacamos. */
function pdfTxt(v){
  let s = String(v==null?"":v);
  s = s.replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#0?39;|&apos;/g,"'")
       .replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&nbsp;/g," ")
       .replace(/&#(\d+);/g,(m,n)=>String.fromCharCode(+n));
  s = s.replace(/[→⟶➔➜]/g,"›").replace(/[←]/g,"‹").replace(/[\u00A0\u2007\u202F]/g," ")
       .replace(/[\u2010\u2011\u2012]/g,"-").replace(/[⋯]/g,"…");
  const extra = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
  return s.split("").filter(ch=>{ const c=ch.charCodeAt(0); return (c>=32&&c<=126)||(c>=160&&c<=255)||extra.indexOf(ch)>=0; }).join("").replace(/\s+/g," ").trim();
}
/* Desglose del costo por unidad sobre las capas FIFO de los depósitos pedidos.
   Misma lógica que landedBuildup() (01-core.js) pero limitada a `stores`, para que
   el PDF respete el foco Swan / Select. Capas viejas sin desglose = 100% "US". */
function buildupEnStores(p, stores){
  let u=0, us=0, intl=0, arg=0;
  stores.forEach(s=> (p.lotes && Array.isArray(p.lotes[s]) ? p.lotes[s] : []).forEach(L=>{
    const q=L.cantidad||0; if(q<=0) return;
    const d = L.d || { us:(L.costoUnit||0), intl:0, arg:0 };
    u+=q; us+=q*(d.us||0); intl+=q*(d.intl||0); arg+=q*(d.arg||0);
  }));
  const per = u>0 ? { us:round2(us/u), intl:round2(intl/u), arg:round2(arg/u) } : { us:0, intl:0, arg:0 };
  per.total = round2(per.us + per.intl + per.arg);
  return per;
}
/* En el catálogo PDF no figura el nombre de los depósitos (Swan / Select):
   se identifican por país. */
function pdfxStoreLbl(id){
  const s=STORES.find(x=>x.id===id);
  return s ? (s.pais==="AR" ? "Argentina" : s.pais==="US" ? "USA" : s.pais) : storeName(id);
}
function precioEnStore(p, s){ return (p.precioVentaPorTienda && +p.precioVentaPorTienda[s]) || 0; }

/* Modal: qué columnas exportar. `base` = productos visibles (filtros) o seleccionados. */
function openExportProdPDF(base){
  const stores = effectiveStores();
  const focoTxt = stores.length===1 ? storeName(stores[0]) : t("pdfx.scope.all");
  const g = id=> document.getElementById(id);
  const opt = (id, label, hint, checked)=>`
    <label style="display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border:1px solid var(--line);border-radius:10px;cursor:pointer">
      <input type="checkbox" id="${id}" ${checked?"checked":""} style="margin-top:3px">
      <span><b>${label}</b><br><span class="hint" style="font-size:12px">${hint}</span></span>
    </label>`;
  buildModal(t("pdfx.title"), `
    <p class="hint" style="margin:0 0 12px">${t("pdfx.intro")}</p>
    <div style="display:grid;gap:8px">
      ${opt("px_qty",   t("pdfx.col.qty"),   t("pdfx.col.qty.h"),   true)}
      ${opt("px_cost",  t("pdfx.col.cost"),  t("pdfx.col.cost.h"),  true)}
      <label id="px_brk_row" style="display:flex;gap:8px;align-items:center;margin:-2px 0 2px 34px;font-size:12.5px;color:var(--muted);cursor:pointer">
        <input type="checkbox" id="px_brk"> ${t("pdfx.col.breakdown")}
      </label>
      ${opt("px_price", t("pdfx.col.price"), t("pdfx.col.price.h"), true)}
    </div>
    <p class="hint" style="margin:14px 0 0" id="px_info"></p>`,
    [
      { cls:"btn", label:t("common.cancel"), act:closeModal },
      { cls:"btn primary", label:t("pdfx.btn"), act:()=>{
          const o = { qty:g("px_qty").checked, cost:g("px_cost").checked, brk:g("px_brk").checked, price:g("px_price").checked };
          if(!o.qty && !o.cost && !o.price){ toast(t("pdfx.err.none"),"warn"); return; }
          if(generarProdPDF(base, stores, o)) closeModal();
        } }
    ]);
  const info=()=>{
    const o = { qty:g("px_qty").checked, cost:g("px_cost").checked, price:g("px_price").checked };
    const brkRow=g("px_brk_row"); if(brkRow){ brkRow.style.opacity=o.cost?"1":".45"; g("px_brk").disabled=!o.cost; }
    const n = (o.qty||o.cost||o.price) ? filasProdPDF(base, stores, o).length : 0;
    const el=g("px_info"); if(el) el.innerHTML = t("pdfx.info",{store:esc(focoTxt), n});
  };
  ["px_qty","px_cost","px_price"].forEach(id=> g(id).onchange=info);
  info();
}
/* Qué productos entran (ver regla arriba). */
function filasProdPDF(base, stores, o){
  const unidades = p=> stores.reduce((a,s)=> a + stockDe(p,s), 0);
  return base
    .filter(p=> !soloEnVault(p))
    .filter(p=> (o.qty||o.cost) ? unidades(p)>0 : stores.some(s=> precioEnStore(p,s)>0))
    .map(p=> ({ p, u:unidades(p) }))
    .sort((a,b)=> pdfTxt(a.p.nombre).localeCompare(pdfTxt(b.p.nombre),"en",{sensitivity:"base"}));
}
function generarProdPDF(base, stores, o){
  if(!pdfReady()){ toast(t("pdf.err.gen"),"warn"); return false; }
  const filas = filasProdPDF(base, stores, o);
  if(!filas.length){ toast(t("pdfx.err.empty"),"warn"); return false; }

  /* Columnas numéricas elegidas, de izquierda a derecha */
  const cols=[];
  if(o.qty) cols.push({ k:"qty", h:t("pdf.lc.units"), w:64 });
  if(o.cost){
    if(o.brk){
      cols.push({ k:"us",   h:t("pdf.lc.uscost"), w:78 });
      cols.push({ k:"intl", h:t("pdf.lc.intl"),   w:66 });
      cols.push({ k:"arg",  h:t("pdf.lc.arg"),    w:66 });
      cols.push({ k:"tot",  h:t("pdf.lc.landed"), w:88, bold:true });
    } else cols.push({ k:"tot", h:t("pdfx.h.cost"), w:88, bold:true });
  }
  if(o.price){
    if(stores.length===1) cols.push({ k:"pr_"+stores[0], s:stores[0], h:t("pdfx.h.price"), w:88, bold:true });
    else stores.forEach(s=> cols.push({ k:"pr_"+s, s, h:t("pdfx.h.priceat",{store:pdfxStoreLbl(s).toUpperCase()}), w:96, bold:true }));
  }

  const { jsPDF } = window.jspdf;
  /* Tamaño de hoja según cuántas columnas: el nombre del producto necesita lugar.
     1-2 columnas: carta vertical · 3-5: carta horizontal · 6 o más: oficio (legal) horizontal. */
  const land = cols.length>=3;
  const doc = new jsPDF({ unit:"pt", format: cols.length>=6 ? "legal" : "letter", orientation: land?"landscape":"portrait" });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 36;
  const em = db.config.emisor||{};
  const INK=[26,26,26], MUT=[120,120,120], LINE=[228,225,220], ACC=[217,119,6], ZEBRA=[248,247,245], ALERT=[185,28,28];
  const setInk=c=>doc.setTextColor(c[0],c[1],c[2]);
  const hoy = fmtDate(new Date().toISOString());
  const focoTxt = stores.length===1 ? pdfxStoreLbl(stores[0]) : t("pdfx.scope.all");
  const queTxt = [o.qty&&t("pdfx.col.qty"), o.cost&&(t("pdfx.col.cost")+(o.brk?" ("+t("pdfx.brk.short")+")":"")), o.price&&t("pdfx.col.price")].filter(Boolean).join(" · ");

  /* Encabezado */
  doc.setFillColor(ACC[0],ACC[1],ACC[2]); doc.rect(0,0,W,84,"F");
  doc.setTextColor(255,255,255);
  doc.setFont("helvetica","bold"); doc.setFontSize(18);
  doc.text(pdfTxt(t("pdfx.doctitle")), M, 38);
  doc.setFont("helvetica","normal"); doc.setFontSize(9);
  doc.text(pdfTxt(queTxt+"  ·  "+t("pdfx.h.store")+": "+focoTxt), M, 56);
  doc.setFont("helvetica","normal"); doc.setFontSize(10);
  doc.text(hoy, W-M, 38, {align:"right"});

  let y=106;
  setInk(MUT); doc.setFont("helvetica","normal"); doc.setFontSize(8.5);
  const notas=[];
  if(o.qty) notas.push(t("pdfx.note.qty"));
  if(o.cost) notas.push(t("pdfx.note.cost"));
  if(o.price) notas.push(t("pdfx.note.price"));
  notas.push(t("pdfx.note.ref"));
  const notaLs = doc.splitTextToSize(pdfTxt(notas.join(" ")), W-2*M);
  doc.text(notaLs, M, y);
  y += 11*notaLs.length + 12;

  /* Posiciones: números alineados a la derecha, desde el margen hacia adentro */
  let x=W-M-6;
  for(let k=cols.length-1;k>=0;k--){ cols[k].x=x; x-=cols[k].w; }
  const numStart = cols.length ? cols[0].x-cols[0].w : W-M;
  const cSku=M+6, skuW=78, cItem=cSku+skuW+8;
  const itemW=(numStart+10)-cItem;
  const FS=8.5, LH=11, PADV=5;

  const drawHead=(yy)=>{
    doc.setFillColor(ACC[0],ACC[1],ACC[2]); doc.rect(M, yy-13, W-2*M, 22, "F");
    doc.setTextColor(255,255,255); doc.setFont("helvetica","bold"); doc.setFontSize(8.5);
    doc.text(pdfTxt(t("pdf.lc.sku")), cSku, yy+2);
    doc.text(pdfTxt(t("pdf.lc.product")), cItem, yy+2);
    cols.forEach(c=> doc.text(pdfTxt(c.h), c.x, yy+2, {align:"right"}));
    return yy+24;
  };
  /* Hasta 2 renglones; si sobra, el 2º termina en "…" medido con el ancho real. */
  const partir=(txt, w, maxL)=>{
    doc.setFont("helvetica","normal"); doc.setFontSize(FS);
    let ls = doc.splitTextToSize(txt, w);
    if(ls.length>maxL){
      ls = ls.slice(0,maxL);
      let last = ls[maxL-1];
      while(last.length && doc.getTextWidth(last+"…")>w) last=last.slice(0,-1);
      ls[maxL-1] = last.replace(/\s+$/,"")+"…";
    }
    return ls;
  };
  const cortar=(txt, w)=>{ let s=txt; if(doc.getTextWidth(s)<=w) return s; while(s.length && doc.getTextWidth(s+"…")>w) s=s.slice(0,-1); return s+"…"; };

  y = drawHead(y);
  const LIM = H-50;   // deja lugar al pie
  let zebra=false, sinCosto=0;
  const tot = {}; cols.forEach(c=> tot[c.k]=0);
  filas.forEach(({p,u})=>{
    const b = o.cost ? buildupEnStores(p, stores) : null;
    const lineas = partir(pdfTxt(p.nombre||"—"), itemW, 2);
    const rowH = lineas.length*LH + PADV*2;
    if(y - 9 + rowH > LIM){ doc.addPage(); y=48; y=drawHead(y); zebra=false; }
    const top = y - 9;
    if(zebra){ doc.setFillColor(ZEBRA[0],ZEBRA[1],ZEBRA[2]); doc.rect(M, top, W-2*M, rowH, "F"); }
    zebra=!zebra;
    const base1 = top + PADV + 8, mid = top + rowH/2 + 3;

    doc.setFont("helvetica","normal"); doc.setFontSize(7.5); setInk(MUT);
    doc.text(cortar(pdfTxt(p.sku||"—"), skuW), cSku, mid);
    doc.setFontSize(FS); setInk(INK);
    doc.text(lineas, cItem, base1, { lineHeightFactor: LH/FS });

    cols.forEach(c=>{
      doc.setFont("helvetica", c.bold?"bold":"normal"); setInk(c.bold?INK:MUT);
      let txt="—";
      if(c.k==="qty"){ txt=String(u); setInk(INK); tot.qty+=u; }
      else if(c.k==="us"){ txt=pdfMoney(b.us); tot.us+=b.us*u; }
      else if(c.k==="intl"){ txt=b.intl>0?pdfMoney(b.intl):"—"; tot.intl+=b.intl*u; }
      else if(c.k==="arg"){ txt=b.arg>0?pdfMoney(b.arg):"—"; tot.arg+=b.arg*u; }
      else if(c.k==="tot"){
        if(b.total>0){ txt=pdfMoney(b.total); tot.tot+=b.total*u; }
        else { txt=pdfTxt(t("pdf.lc.nocost")); setInk(ALERT); sinCosto++; }
      }
      else if(c.s){
        const pr=precioEnStore(p,c.s);
        if(pr>0) txt=pdfMoney(pr); else setInk(MUT);
        tot[c.k] += pr * stockDe(p,c.s);   // valor a precio = stock de ESE depósito × su precio
      }
      doc.text(txt, c.x, mid, {align:"right"});
    });
    y += rowH;
  });

  /* Totales: sólo con Cantidad (sin unidades, sumar precios/costos unitarios no dice nada) */
  y+=8;
  if(o.qty){
    if(y + 40 > LIM){ doc.addPage(); y=48; }
    doc.setDrawColor(ACC[0],ACC[1],ACC[2]); doc.setLineWidth(1.1); doc.line(M, y-8, W-M, y-8); doc.setLineWidth(1);
    setInk(INK); doc.setFont("helvetica","bold"); doc.setFontSize(8.5);
    doc.text(pdfTxt(t("pdfx.tot")), cItem, y+6);
    cols.forEach(c=> doc.text(c.k==="qty"?String(round2(tot.qty)):pdfMoney(round2(tot[c.k])), c.x, y+6, {align:"right"}));
    y+=20;
    if(cols.length>1){ doc.setFont("helvetica","normal"); doc.setFontSize(7.5); setInk(MUT); doc.text(pdfTxt(t("pdfx.tot.h")), cItem, y); y+=12; }
  }
  if(sinCosto>0){
    if(y + 14 > LIM){ doc.addPage(); y=48; }
    doc.setFont("helvetica","normal"); doc.setFontSize(8.5); setInk(ALERT);
    doc.text(pdfTxt(t("pdf.lc.nocostnote",{n:sinCosto})), cItem, y);
  }

  /* Pie en todas las hojas */
  const n = doc.getNumberOfPages();
  for(let i=1;i<=n;i++){
    doc.setPage(i);
    doc.setDrawColor(LINE[0],LINE[1],LINE[2]); doc.setLineWidth(0.6); doc.line(M, H-30, W-M, H-30);
    doc.setFont("helvetica","normal"); doc.setFontSize(7.5); setInk(MUT);
    doc.text(pdfTxt(t("pdfx.doctitle")+" · "+focoTxt+" · "+hoy), M, H-18);
    doc.text(pdfTxt(t("pdf.lc.page",{p:i,n:n})), W-M, H-18, {align:"right"});
  }

  doc.save(pdfTxt(t("pdfx.filename")).toLowerCase()+"-"+new Date().toISOString().slice(0,10)+".pdf");
  toast(t("pdfx.done",{n:filas.length}));
  return true;
}
