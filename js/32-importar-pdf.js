/* ============================================================
   gestordestock — 32-importar-pdf.js
   Parte de la app. Se carga como <script> en el ORDEN del index.html.
   Todo vive en scope global (sin módulos), igual que antes.
   ============================================================ */
/* ============================================================
   IMPORTAR PDF
   ============================================================ */
let pdfLines = [];   // líneas de texto reconstruidas
let importOrigen = "propia";   // PUNTO 1: propia (todo a stock) | terceros (parte nuestra + parte al dueño)
let importOwner = "";          // clienteId dueño, cuando es de terceros
function openImport(){
  importOrigen = "propia"; importOwner = "";
  buildModal("Import invoice (PDF)", `
    <div class="banner">
      Choose or drag the invoice PDF. The AI reads it and builds an editable table — check quantities, costs and which product each line maps to <b>before confirming</b>.
    </div>
    <div class="drop" id="drop">
      <div class="di">✨</div>
      <p><span class="fn">Choose a PDF</span> or drag it here</p>
      <p style="font-size:12px">it goes to your server (Worker) and then to Gemini to read it</p>
      <input type="file" id="iaInput" accept="application/pdf" hidden>
    </div>
    <div id="importOut"></div>
  `,[{label:"Close",cls:"btn",act:closeModal}], "import");

  const drop=document.getElementById("drop"), input=document.getElementById("iaInput");
  drop.onclick=()=>input.click();
  input.onchange=()=>{ if(input.files[0]) handlePdfIA(input.files[0]); };
  ["dragover","dragenter"].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add("over");}));
  ["dragleave","drop"].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove("over");}));
  drop.addEventListener("drop",e=>{ const f=e.dataTransfer.files[0]; if(f) handlePdfIA(f); });
}

/* Leer factura con Gemini (vía el Worker). Reusa el mismo editor de revisión que la detección local. */
function fileToBase64(file){
  return new Promise((res,rej)=>{
    const r=new FileReader();
    r.onload=()=>res(String(r.result).split(",")[1]||"");
    r.onerror=()=>rej(new Error("couldn't read the file"));
    r.readAsDataURL(file);
  });
}
async function handlePdfIA(file){
  const out=document.getElementById("importOut");
  if(!session){ out.innerHTML=`<div class="banner warn">You need to be logged in to use AI reading.</div>`; return; }
  out.innerHTML=`<p style="color:var(--muted);padding:14px 0">✨ Reading <b>${esc(file.name)}</b> with AI… (may take a few seconds)</p>`;
  try{
    const b64=await fileToBase64(file);
    const res=await fetch(apiBase()+"/parse-invoice",{
      method:"POST", headers:authHeaders(),
      body:JSON.stringify({ pdf:b64, mime:file.type||"application/pdf" })
    });
    const j=await res.json();
    if(!res.ok || !j.ok){
      const det = j && (j.detalle||j.error||j.raw) ? esc(j.detalle||j.error||j.raw) : ("HTTP "+res.status);
      out.innerHTML=`<div class="banner warn">Couldn\u2019t read with AI: ${det}. Try local detection or load it by hand.</div>`;
      return;
    }
    const d=j.data||{};
    const lineas=Array.isArray(d.lineas)?d.lineas:[];
    if(!lineas.length){
      out.innerHTML=`<div class="banner warn">The AI found no product lines in that PDF. Check the file or load it by hand.</div>`;
      return;
    }
    // adaptar a la estructura que consume showImportEditor
    const parsed={
      meta:{ numero:d.numero||"", fecha:normFechaIA(d.fecha), proveedor:d.proveedor||"", flete:parseNum(d.flete)||0, moneda:d.moneda||"" },
      items:lineas.map(l=>({
        sku:(l.sku||"").toString().trim(),
        desc:(l.nombre||"").toString().trim(),
        cantidad:parseNum(l.cantidad),
        costo:parseNum(l.precio),
        msrp:parseNum(l.msrp)||0,
        ext:parseNum(l.cantidad)*parseNum(l.precio),
        raw:""
      })).filter(it=>it.desc),
      mode:"ia"
    };
    pdfLines=["(document read with AI — no raw text dump)"];
    showImportEditor(file.name, parsed);
  }catch(e){
    console.error(e);
    out.innerHTML=`<div class="banner warn">AI read failed (${esc(e.message||"error")}). Try local detection or load it by hand.</div>`;
  }
}
/* Normaliza fecha devuelta por la IA a YYYY-MM-DD si viene en otro formato reconocible */
function normFechaIA(f){
  if(!f) return "";
  f=String(f).trim();
  if(/^\d{4}-\d{2}-\d{2}$/.test(f)) return f;
  const m=f.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if(m){ let[,d,mo,y]=m; if(y.length===2)y="20"+y; return `${y}-${mo.padStart(2,"0")}-${d.padStart(2,"0")}`; }
  return f;
}

async function handlePdf(file){
  const out=document.getElementById("importOut");
  if(!window.pdfjsLib){ out.innerHTML=`<div class="banner warn">Couldn\u2019t load the PDF reader (pdf.js). Check your connection and retry, or load the purchase by hand.</div>`; return; }
  out.innerHTML=`<p style="color:var(--muted);padding:14px 0">Reading ${esc(file.name)}…</p>`;
  try{
    const buf=await file.arrayBuffer();
    const pdf=await pdfjsLib.getDocument({data:buf}).promise;
    let lines=[];
    for(let pn=1; pn<=pdf.numPages; pn++){
      const page=await pdf.getPage(pn);
      const tc=await page.getTextContent();
      lines = lines.concat(reconstructLines(tc.items));
    }
    pdfLines = lines.filter(l=>l.trim().length);
    const parsed = parseInvoice(pdfLines);
    showImportEditor(file.name, parsed);
  }catch(e){
    console.error(e);
    out.innerHTML=`<div class="banner warn">Couldn't read that PDF (${esc(e.message||"error")}). It may be a scanned image. Load the purchase by hand.</div>`;
  }
}

/* Reconstruir líneas por coordenada Y */
function reconstructLines(items){
  const rows=new Map();
  for(const it of items){
    if(!it.str || !it.str.trim()) continue;
    const y=Math.round(it.transform[5]);
    let bucket=null;
    for(const k of rows.keys()){ if(Math.abs(k-y)<=3){ bucket=k; break; } }
    const key = bucket===null ? y : bucket;
    if(!rows.has(key)) rows.set(key,[]);
    rows.get(key).push({x:it.transform[4], s:it.str});
  }
  return [...rows.entries()]
    .sort((a,b)=> b[0]-a[0])
    .map(([,arr])=> arr.sort((a,b)=>a.x-b.x).map(o=>o.s).join(" ").replace(/\s+/g," ").trim());
}

/* ---------- Parser de factura ----------
   1) Intento estructurado: renglones "SKU: descripción ... QTY UOM MSRP NET EXT"
      (formato tipo Coqui Hobby). Costo = NET PRICE, precio venta sugerido = MSRP.
   2) Si no encuentra nada, cae a la heurística genérica línea por línea.        */
function parseInvoice(lines){
  const blob = lines.join("\n");
  const meta = extractMeta(lines, blob);
  let items = parseStructured(blob);
  let mode = "estructurado";
  if(!items.length){
    items = lines.map(parseCandidate).filter(Boolean).map(c=>({
      sku:"", desc:c.desc, cantidad:c.cantidad, costo:c.costo, msrp:0, ext:c.cantidad*c.costo, raw:c.raw
    }));
    mode = "heuristico";
  }
  // detectar flete/handling para avisar (no se agrega como stock)
  const fre = blob.match(/(freight[^\n]*?|flete[^\n]*?)\s([\d.,]+)\s*$/im) || blob.match(/freight[^\d]*([\d.,]+)/i);
  meta.flete = fre ? parseNum(fre[fre.length-1]) : 0;
  return { meta, items, mode };
}

/* SKU: desc ... QTY UOM MSRP NET EXT  (UOM = EACH/EA/CASE/BOX/PACK/UNIT/PCS) */
function parseStructured(blob){
  const re = /(?=[A-Z0-9\-]*\d)([A-Z0-9][A-Z0-9\-]{3,}):\s*([\s\S]+?)\s+(\d+(?:[.,]\d+)?)\s+(EACH|EA|CASE|BOX|PACK|UNIT|PCS?|UN)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)(?=\s|$)/gi;
  const out=[]; let m;
  while((m=re.exec(blob))){
    const sku = m[1].trim();
    const desc = m[2].replace(/\s+/g," ").trim();
    const cantidad = parseNum(m[3]);
    const msrp = parseNum(m[5]);   // precio sugerido
    const net  = parseNum(m[6]);   // costo real (lo que pagás)
    const ext  = parseNum(m[7]);   // total línea
    if(cantidad<=0) continue;
    out.push({ sku, desc, cantidad, costo:net, msrp, ext, raw:(sku+": "+desc+" | "+m[3]+" "+m[4]+" "+m[5]+" "+m[6]+" "+m[7]) });
  }
  return out;
}

/* Metadata: N° de comprobante, fecha, proveedor */
function extractMeta(lines, blob){
  const meta = { numero:"", fecha:"", proveedor:"", flete:0 };
  const ref = blob.match(/Reference\s*No\.?:?\s*([A-Z0-9\-]+)/i)
           || blob.match(/(?:Invoice|Factura|Comprobante)\s*(?:No\.?|#|N[°º])?:?\s*([A-Z0-9\-]{3,})/i);
  if(ref) meta.numero = ref[1].trim();
  const date = blob.match(/\bDate:?\s*([0-3]?\d[-\/][A-Za-z]{3,}[-\/]\d{2,4})/i)
            || blob.match(/\bFecha:?\s*([0-3]?\d[-\/][0-1]?\d[-\/]\d{2,4})/i);
  if(date) meta.fecha = normDate(date[1]);
  const skip = /^(invoice|factura|reference|date|fecha|customer|currency|salesperson|bill to|ship to|terms|contact|due date|no\.|item)\b/i;
  for(const l of lines){
    const t=l.trim();
    if(t.length>2 && /[A-Za-z]/.test(t) && !skip.test(t)){ meta.proveedor=t.replace(/\s+/g," "); break; }
  }
  return meta;
}
function normDate(s){
  let m=s.match(/(\d{1,2})[-\/]([A-Za-z]{3,})[-\/](\d{2,4})/);
  const months={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12,
                ene:1,abr:4,ago:8,dic:12};
  if(m){
    const mo=months[m[2].slice(0,3).toLowerCase()]; if(!mo) return "";
    const yr=m[3].length===2?"20"+m[3]:m[3];
    return `${yr}-${String(mo).padStart(2,"0")}-${String(+m[1]).padStart(2,"0")}`;
  }
  m=s.match(/(\d{1,2})[-\/](\d{1,2})[-\/](\d{2,4})/);
  if(m){ const yr=m[3].length===2?"20"+m[3]:m[3]; return `${yr}-${String(+m[2]).padStart(2,"0")}-${String(+m[1]).padStart(2,"0")}`; }
  return "";
}

/* Heurística: intentar detectar cantidad / costo en una línea */
function parseCandidate(line){
  const nums=[...line.matchAll(/-?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?|-?\d+(?:[.,]\d+)?/g)].map(m=>m[0]);
  if(nums.length<2) return null;                 // necesita al menos cantidad y un importe
  if(line.length<4) return null;
  // descartar líneas que son claramente totales/cabeceras
  if(/^(total|subtotal|iva|neto|importe total|cuit|factura|fecha|p[aá]gina)\b/i.test(line.trim())) return null;
  const desc = line.replace(/-?\d[\d.,]*/g,"").replace(/\s+/g," ").trim();
  if(desc.length<2) return null;
  const parsed = nums.map(parseNum);
  // heurística: cantidad = primer número "chico" entero; costo unit = número intermedio; total = último
  let cantidad = parsed.find(n=> n>0 && n<10000 && Number.isInteger(n)) ?? parsed[0];
  let costo = parsed.length>=2 ? parsed[parsed.length-2] : parsed[0];
  if(cantidad>0 && costo===0 && parsed.length){ costo=parsed[parsed.length-1]; }
  return { desc, cantidad: cantidad||1, costo: costo||0, raw:line };
}

function showImportEditor(fname, parsed){
  const out=document.getElementById("importOut");
  const { meta, items, mode } = parsed;
  if(!items.length){
    out.innerHTML=`<div class="banner warn">Extracted the text but found no lines with qty and price. Check the raw text below and load by hand if needed.</div>
      <details open><summary>Extracted text</summary><div class="rawbox">${esc(pdfLines.join("\n"))}</div></details>`;
    return;
  }
  // mapear cada ítem a un producto existente por SKU (o por nombre)
  items.forEach(c=>{
    const bySku = c.sku ? findProdBySku(c.sku) : null;
    const byName = bySku ? null : db.productos.find(p=> p.nombre && c.desc.toLowerCase().includes(p.nombre.toLowerCase()));
    const match = bySku || byName;
    c.productoId = match ? match.id : "";
    c.crear = !match;
    c.nombre = match ? match.nombre : c.desc;
    c.sel = true;
  });
  window._cands = items;

  const rows=items.map((c,i)=>`<tr>
    <td class="c"><input type="checkbox" data-sel="${i}" ${c.sel?"checked":""}></td>
    <td class="c">${c.sku?`<span class="sku">${esc(c.sku)}</span>`:'<span style="color:var(--muted)">—</span>'}</td>
    <td class="imp-desc">${esc(c.desc)}</td>
    <td style="width:74px"><input class="inp num" data-imp="cantidad" data-i="${i}" value="${c.cantidad}"></td>
    <td style="width:104px"><input class="inp num" data-imp="costo" data-i="${i}" value="${c.costo}"></td>
    <td style="width:104px"><input class="inp num" data-imp="msrp" data-i="${i}" value="${c.msrp||0}"></td>
    <td class="col-target" style="min-width:170px"><select class="inp" data-imp="prod" data-i="${i}">${prodOptions(c.productoId)}</select></td>
  </tr>`).join("");

  const metaBits = [
    meta.numero ? `N° <b>${esc(meta.numero)}</b>` : "",
    meta.fecha ? `fecha <b>${esc(meta.fecha)}</b>` : "",
    meta.proveedor ? `prov. <b>${esc(meta.proveedor)}</b>` : ""
  ].filter(Boolean).join(" · ");

  out.innerHTML=`
    <div class="banner ok">
      Detected <b>${items.length}</b> line(s) in <b>${esc(fname)}</b>${metaBits?` \u00B7 <span style="font-weight:400">${metaBits}</span>`:""} \u2014 review before confirming.
    </div>
    <div id="importOrigenBar"></div>
    ${meta.flete? `<div class="banner" style="white-space:normal">Detected a <b>freight/handling</b> charge of ${money(meta.flete, "USD")}. It's loaded in the purchase and will be <b>spread across all units</b> when you confirm (not added as stock).</div>`:""}
    <p style="font-size:12px;color:var(--muted);margin:0 0 8px">
      <b>Cost</b> = what you pay (NET); updates last cost. <b>List price</b> = suggested selling price (MSRP). Not a sale — just your catalog price.
    </p>
    <div class="table-scroll"><table class="line-tbl${SHOW_TARGET_PRODUCT_COL?'':' hide-target'}">
      <thead><tr><th class="c">✓</th><th class="c">SKU</th><th>Description</th><th class="r">Qty</th><th class="r">Cost</th><th class="r">List price</th><th class="col-target">Target product</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <details><summary>View raw PDF text</summary><div class="rawbox">${esc(pdfLines.join("\n"))}</div></details>
    <div style="display:flex;justify-content:flex-end;margin-top:16px">
      <button class="btn up" id="toDraft">Continue to purchase editor →</button>
    </div>`;

  paintImportOrigen();
  out.querySelectorAll("[data-sel]").forEach(cb=> cb.onchange=()=> items[+cb.dataset.sel].sel=cb.checked);
  out.querySelectorAll("[data-imp]").forEach(inp=>{
    const i=+inp.dataset.i, k=inp.dataset.imp;
    inp.oninput=()=>{
      const c=items[i];
      if(k==="cantidad") c.cantidad=parseNum(inp.value);
      else if(k==="costo") c.costo=parseNum(inp.value);
      else if(k==="msrp") c.msrp=parseNum(inp.value);
      else if(k==="prod"){
        if(inp.value==="__new"){ c.crear=true; c.productoId=""; }
        else { c.crear=false; c.productoId=inp.value; const p=prodById(inp.value); if(p) c.nombre=p.nombre; }
      }
    };
  });
  document.getElementById("toDraft").onclick=()=>{
    const chosen=items.filter(c=>c.sel && c.cantidad>0);
    if(!chosen.length){ toast("Tick at least one line","warn"); return; }
    const terc = importOrigen==="terceros";
    if(terc && !clienteById(importOwner)){ toast("Pick the owner of this third-party invoice","warn"); return; }
    const lineas=chosen.map(c=>({
      key:uid(),
      productoId: c.crear?"":c.productoId,
      crear: c.crear,
      sku: c.crear?(c.sku||""):"",
      nombre: c.crear?c.nombre:"",
      precioVentaSugerido: c.msrp||0,
      cantidad:c.cantidad, precio:c.costo,
      aNuestro: terc ? 0 : (c.cantidad)   // terceros: por defecto nada nuestro (lo marcás por línea); propia: todo
    }));
    openDoc("compra", { tipo:"compra", origen:importOrigen, terceroId: terc?importOwner:"",
      contraparte:meta.proveedor||"", fecha:meta.fecha||new Date().toISOString().slice(0,10),
      numero:meta.numero||"", handling:0, flete:meta.flete||0, lineas });
  };
}

/* Barra "Invoice type" (propia/terceros) + dueño, arriba de la tabla del import.
   Se re-pinta sola al togglear, sin re-mapear la tabla (no se pierden ediciones). */
function paintImportOrigen(){
  const host=document.getElementById("importOrigenBar"); if(!host) return;
  const terc = importOrigen==="terceros";
  const owner = importOwner ? clienteById(importOwner) : null;
  host.innerHTML = `
    <div class="origen-bar">
      <div class="field">
        <label>Invoice type</label>
        <div class="seg" id="imp_origen">
          <button type="button" data-origen="propia" class="${!terc?"on":""}">Own (all to stock)</button>
          <button type="button" data-origen="terceros" class="${terc?"on":""}">Third-party</button>
        </div>
      </div>
      ${terc?`<div class="field" style="min-width:260px;flex:1">
        <label>Owner <span class="hint" style="font-weight:400">· whose the units belong to</span></label>
        <button type="button" class="ppick-btn${owner?"":" placeholder"}" id="imp_owner" style="width:100%">
          <span class="ppick-label">${owner?esc(clienteLinea(owner)):"— pick owner (client / local) —"}</span><span class="ppick-caret">▾</span>
        </button></div>`:""}
    </div>
    ${terc?`<p class="hint" style="margin:-4px 0 10px;font-size:12px">In the next step you set <b>Ours</b> per line (the units you keep → stock). The rest keeps travelling to the owner and is only tracked.</p>`:""}`;
  host.querySelectorAll("[data-origen]").forEach(b=> b.onclick=()=>{
    if(importOrigen===b.dataset.origen) return;
    importOrigen=b.dataset.origen;
    if(importOrigen==="propia") importOwner="";
    paintImportOrigen();
  });
  const ow=document.getElementById("imp_owner"); if(ow) ow.onclick=(e)=> openImportOwnerPicker(e.currentTarget);
}
/* Picker de dueño para el import (setea importOwner y re-pinta la barra). */
function openImportOwnerPicker(anchor){
  if(typeof closeProductPicker==="function") closeProductPicker();
  _pickerAnchor = anchor; anchor.classList.add("open");
  const pop=document.createElement("div"); pop.className="ppick-pop";
  pop.innerHTML = `<input class="inp ppick-search" placeholder="Search owner (client / local)…" autocomplete="off" spellcheck="false"><div class="ppick-list"></div>`;
  document.body.appendChild(pop);
  const search=pop.querySelector(".ppick-search"), listEl=pop.querySelector(".ppick-list");
  const paint=(q)=>{
    q=(q||"").trim().toLowerCase();
    let lista=db.clientes.slice().sort((a,b)=>String(a.nombre||"").localeCompare(String(b.nombre||""),"en"));
    if(q) lista=lista.filter(c=> ((c.nombre||"")+" "+(c.empresa||"")).toLowerCase().includes(q));
    let html=lista.map(c=>`<button type="button" class="ppick-item${c.id===importOwner?" active":""}" data-pio="${c.id}">
      <span class="pi-name">${esc(c.nombre)}${c.empresa?` · ${esc(c.empresa)}`:""}</span></button>`).join("");
    if(!lista.length) html=`<div class="ppick-empty">No clients yet. Add them under Customers.</div>`;
    listEl.innerHTML=html;
    listEl.querySelectorAll("[data-pio]").forEach(it=> it.onclick=()=>{ importOwner=it.dataset.pio; closeProductPicker(); paintImportOrigen(); });
  };
  paint("");
  search.oninput=()=>paint(search.value);
  positionPicker(pop, anchor);
  window.addEventListener("scroll", repositionPicker, true);
  window.addEventListener("resize", closeProductPicker);
  setTimeout(()=>{ document.addEventListener("mousedown", onPickerOutside, true); document.addEventListener("keydown", onPickerKey, true); }, 0);
  search.focus();
}

