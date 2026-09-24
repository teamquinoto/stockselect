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
   LANDED COST BUILDUP (PDF) — desglose por producto, puerta por puerta
   US cost (compra) → +Intl (Miami→BA) → +Arg (BA→tienda) = Landed.
   Promedio ponderado sobre el stock EN MANO (vendible + tránsito).
   Sólo referencia de costos (no es factura). Montos en USD.
   ============================================================ */
function generarLandedCostPDF(){
  if(!pdfReady()){ toast(t("pdf.err.gen"),"warn"); return; }
  const prods = db.productos
    .map(p=>({ p, b:landedBuildup(p) }))
    .filter(x=> x.b.units>0)
    .sort((a,b)=> String(a.p.nombre||"").localeCompare(String(b.p.nombre||""),"en"));
  if(!prods.length){ toast(t("pdf.lc.nostock"),"warn"); return; }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit:"pt", format:"letter" });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 40;
  const em = db.config.emisor||{};
  const INK=[26,26,26], MUT=[120,120,120], LINE=[228,225,220], ACC=[217,119,6], ZEBRA=[248,247,245];
  const setInk=c=>doc.setTextColor(c[0],c[1],c[2]);

  /* Header band */
  doc.setFillColor(ACC[0],ACC[1],ACC[2]); doc.rect(0,0,W,92,"F");
  doc.setTextColor(255,255,255);
  doc.setFont("helvetica","bold"); doc.setFontSize(18);
  doc.text(em.nombre || t("pdf.lc.brand"), M, 40);
  doc.setFont("helvetica","normal"); doc.setFontSize(8.5);
  doc.text(t("pdf.lc.sub"), M, 58);
  doc.setFont("helvetica","bold"); doc.setFontSize(15);
  doc.text(t("pdf.lc.title"), W-M, 38, {align:"right"});
  doc.setFont("helvetica","normal"); doc.setFontSize(9);
  doc.text(fmtDate(new Date().toISOString()), W-M, 56, {align:"right"});

  let y=118;
  setInk(MUT); doc.setFont("helvetica","normal"); doc.setFontSize(8.5);
  doc.text(t("pdf.lc.caption"), M, y);
  y+=20;

  /* Columnas */
  const cItem=M;
  const cUn  = W-M-330, cUs=W-M-250, cIn=W-M-180, cAr=W-M-110, cTot=W-M;
  const drawHead=(yy)=>{
    doc.setFillColor(ACC[0],ACC[1],ACC[2]); doc.rect(M, yy-13, W-2*M, 22, "F");
    doc.setTextColor(255,255,255); doc.setFont("helvetica","bold"); doc.setFontSize(8.5);
    doc.text(t("pdf.lc.product"), cItem+6, yy+2);
    doc.text(t("pdf.lc.units"), cUn, yy+2, {align:"right"});
    doc.text(t("pdf.lc.uscost"), cUs, yy+2, {align:"right"});
    doc.text(t("pdf.lc.intl"), cIn, yy+2, {align:"right"});
    doc.text(t("pdf.lc.arg"), cAr, yy+2, {align:"right"});
    doc.text(t("pdf.lc.landed"), cTot, yy+2, {align:"right"});
    return yy+22;
  };
  y = drawHead(y);

  let zebra=false, tU=0, sUs=0, sIn=0, sAr=0, sTot=0;
  prods.forEach(({p,b})=>{
    if(y > H-70){ doc.addPage(); y=60; y=drawHead(y); zebra=false; }
    if(zebra){ doc.setFillColor(ZEBRA[0],ZEBRA[1],ZEBRA[2]); doc.rect(M, y-11, W-2*M, 18, "F"); }
    zebra=!zebra;
    const nom = (p.sku?`[${p.sku}] `:"")+(p.nombre||"");
    const nomTrim = nom.length>52 ? nom.slice(0,51)+"…" : nom;
    setInk(INK); doc.setFont("helvetica","normal"); doc.setFontSize(8.5);
    doc.text(nomTrim, cItem+6, y+1);
    doc.text(String(b.units), cUn, y+1, {align:"right"});
    setInk(MUT);
    doc.text(pdfMoney(b.us), cUs, y+1, {align:"right"});
    doc.text(b.intl>0?pdfMoney(b.intl):"—", cIn, y+1, {align:"right"});
    doc.text(b.arg>0?pdfMoney(b.arg):"—", cAr, y+1, {align:"right"});
    setInk(INK); doc.setFont("helvetica","bold");
    doc.text(pdfMoney(b.total), cTot, y+1, {align:"right"});
    y+=18;
    tU+=b.units; sUs+=b.us*b.units; sIn+=b.intl*b.units; sAr+=b.arg*b.units; sTot+=b.total*b.units;
  });

  /* Totales (valor total del inventario por puerta) */
  y+=6; doc.setDrawColor(ACC[0],ACC[1],ACC[2]); doc.setLineWidth(1.1); doc.line(M, y-8, W-M, y-8); doc.setLineWidth(1);
  setInk(INK); doc.setFont("helvetica","bold"); doc.setFontSize(9);
  doc.text(t("pdf.lc.onhand"), cItem+6, y+6);
  doc.text(String(round2(tU)), cUn, y+6, {align:"right"});
  doc.text(pdfMoney(round2(sUs)), cUs, y+6, {align:"right"});
  doc.text(pdfMoney(round2(sIn)), cIn, y+6, {align:"right"});
  doc.text(pdfMoney(round2(sAr)), cAr, y+6, {align:"right"});
  doc.text(pdfMoney(round2(sTot)), cTot, y+6, {align:"right"});

  doc.save("landed-cost-"+new Date().toISOString().slice(0,10)+".pdf");
  toast(t("pdf.lc.downloaded"));
}
