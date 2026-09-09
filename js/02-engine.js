/* ============================================================
   gestordestock — 02-engine.js
   Parte de la app. Se carga como <script> en el ORDEN del index.html.
   Todo vive en scope global (sin módulos), igual que antes.
   ============================================================ */
/* ============================================================
   FIFO ENGINE (point 3) — per store cost layers
   ------------------------------------------------------------
   A purchase PUSHES a layer {cantidad, costoUnit}. A sale CONSUMES
   layers oldest-first and returns the exact COGS. Avoids the average
   distortion when the same SKU was bought at different prices/stores.
   ============================================================ */
function fifoLayers(prod, store){
  if(!prod.lotes) prod.lotes = {};
  if(!Array.isArray(prod.lotes[store])) prod.lotes[store] = [];
  return prod.lotes[store];
}
/* Add a purchase layer (landed unit cost already includes prorated handling+freight). */
function fifoEntrada(prod, store, cantidad, costoUnit, ref, refId){
  fifoLayers(prod, store).push({ id:uid(), fecha:new Date().toISOString(), cantidad:+cantidad, costoUnit:round2(costoUnit), ref:ref||"", refId:refId||null });
}
/* Remove (or shrink) the layer(s) a given purchase created, when reverting it. */
function fifoQuitarCompra(prod, store, refId){
  if(!refId) return;
  prod.lotes[store] = fifoLayers(prod, store).filter(L=> L.refId!==refId);
}
/* Peek the FIFO cost of consuming `cantidad` WITHOUT mutating (for previews/margin). */
function fifoCostoPeek(prod, store, cantidad){
  let need = cantidad, cogs = 0;
  for(const L of fifoLayers(prod, store)){
    if(need<=0) break;
    const take = Math.min(L.cantidad, need);
    cogs += take * L.costoUnit; need -= take;
  }
  // if layers run short (legacy negative stock), value the remainder at last known cost
  if(need>0) cogs += need * (prod.ultimoCosto||0);
  return { cogs:round2(cogs), unit: cantidad>0 ? round2(cogs/cantidad) : 0, short: need>0 };
}
/* Consume layers FIFO, MUTATING them. Returns {cogs, unit, consumed:[{costoUnit,cantidad}]}
   so a later revert can put the exact units back into the right layers. */
function fifoConsumir(prod, store, cantidad){
  const layers = fifoLayers(prod, store);
  let need = cantidad, cogs = 0; const consumed = [];
  while(need>0 && layers.length){
    const L = layers[0];
    const take = Math.min(L.cantidad, need);
    cogs += take * L.costoUnit;
    consumed.push({ costoUnit:L.costoUnit, cantidad:take });
    L.cantidad = round4(L.cantidad - take);
    need -= take;
    if(L.cantidad<=0.00001) layers.shift();
  }
  if(need>0){ // shortfall: value at last cost, record synthetic layer to allow revert
    const c = prod.ultimoCosto||0;
    cogs += need*c; consumed.push({ costoUnit:c, cantidad:need, synthetic:true });
    need=0;
  }
  return { cogs:round2(cogs), unit: cantidad>0 ? round2(cogs/cantidad) : 0, consumed };
}
/* Undo a sale: push the consumed units back as layers at their original cost,
   oldest first (prepended) so FIFO order stays coherent. */
function fifoDevolver(prod, store, consumed){
  if(!consumed || !consumed.length) return;
  const layers = fifoLayers(prod, store);
  // rebuild in original order at the front
  for(let i=consumed.length-1;i>=0;i--){
    const c = consumed[i];
    if(c.synthetic) continue; // synthetic shortfall wasn't real stock
    layers.unshift({ id:uid(), fecha:new Date().toISOString(), cantidad:c.cantidad, costoUnit:c.costoUnit, ref:"revert" });
  }
}
const round4 = n => Math.round((n||0)*10000)/10000;

/* ============================================================
   FIFO GLOBAL (stock unificado para la VENTA) — punto 1
   ------------------------------------------------------------
   El stock es UNO SOLO para vender. Akira/Silver (y futuras
   sociedades) sólo dicen QUIÉN compró cada lote (procedencia): a
   la hora de vender NO se elige sociedad. El costo se toma FIFO
   por FECHA DE ENTRADA del lote, cruzando todas las sociedades.
   Ej: 10 comprados por Akira (día 1) + 40 por Silver (día 5); vendo
   20 -> consume 10 de Akira y 10 de Silver; Akira queda en 0, Silver 30.
   La bóveda de inversión (__inv) NO participa: está fuera del pool.
   ============================================================ */
/* Stock vendible total de un producto = suma de todas las sociedades (sin bóveda). */
function stockVendibleTotal(p){ return round4(STORE_IDS.reduce((a,s)=> a + stockDe(p,s), 0)); }
/* Todas las capas FIFO vendibles, cada una etiquetada con su sociedad, ordenadas
   por fecha de entrada ascendente (más viejo primero). Referencia a los objetos
   reales para poder mutarlos. `_ord` desempata capas con la misma fecha por su
   orden de inserción, para que el FIFO sea estable. */
function capasVendiblesOrdenadas(prod){
  const out = [];
  STORE_IDS.forEach(s=>{
    fifoLayers(prod, s).forEach((L, i)=> out.push({ sociedad:s, L, _ord:i }));
  });
  out.sort((a,b)=>{
    const fa = a.L.fecha||"", fb = b.L.fecha||"";
    if(fa<fb) return -1; if(fa>fb) return 1;
    return a._ord - b._ord;
  });
  return out;
}
/* Peek del costo FIFO global de consumir `cantidad` SIN mutar (previews/margen). */
function fifoCostoPeekGlobal(prod, cantidad){
  let need = cantidad, cogs = 0;
  for(const c of capasVendiblesOrdenadas(prod)){
    if(need<=0) break;
    const take = Math.min(c.L.cantidad, need);
    cogs += take * c.L.costoUnit; need -= take;
  }
  if(need>0) cogs += need * (prod.ultimoCosto||0);   // faltante -> último costo conocido
  return { cogs:round2(cogs), unit: cantidad>0 ? round2(cogs/cantidad) : 0, short: need>0 };
}
/* Consume capas FIFO GLOBAL (cruza sociedades), MUTANDO los lotes reales. Devuelve
   {cogs, unit, consumed:[{sociedad,costoUnit,cantidad}], porSociedad:{soc:{cantidad,cogs}}}.
   NO toca stockPorTienda: el llamador registra el kardex por sociedad con moverStock,
   que es quien decrementa el stock de cada sociedad (evita doble descuento). */
function fifoConsumirGlobal(prod, cantidad){
  let need = cantidad, cogs = 0; const consumed = []; const porSoc = {};
  // trabajamos sobre una lista ordenada; al vaciar una capa la quitamos de su array real
  let capas = capasVendiblesOrdenadas(prod);
  for(const c of capas){
    if(need<=0) break;
    const take = Math.min(c.L.cantidad, need);
    if(take<=0) continue;
    cogs += take * c.L.costoUnit;
    consumed.push({ sociedad:c.sociedad, costoUnit:c.L.costoUnit, cantidad:take });
    (porSoc[c.sociedad] = porSoc[c.sociedad] || { cantidad:0, cogs:0 });
    porSoc[c.sociedad].cantidad += take;
    porSoc[c.sociedad].cogs = round2(porSoc[c.sociedad].cogs + take*c.L.costoUnit);
    c.L.cantidad = round4(c.L.cantidad - take);
    need -= take;
  }
  // limpiar capas agotadas de sus arrays reales
  STORE_IDS.forEach(s=>{ prod.lotes[s] = fifoLayers(prod, s).filter(L=> L.cantidad>0.00001); });
  if(need>0){ // faltante (no debería pasar por la validación): valuar a último costo
    const cst = prod.ultimoCosto||0;
    cogs += need*cst;
    consumed.push({ sociedad:STORE_IDS[0], costoUnit:cst, cantidad:need, synthetic:true });
    (porSoc[STORE_IDS[0]] = porSoc[STORE_IDS[0]] || { cantidad:0, cogs:0 });
    porSoc[STORE_IDS[0]].cantidad += need;
    porSoc[STORE_IDS[0]].cogs = round2(porSoc[STORE_IDS[0]].cogs + need*cst);
    need = 0;
  }
  return { cogs:round2(cogs), unit: cantidad>0 ? round2(cogs/cantidad) : 0, consumed, porSociedad:porSoc };
}
/* Deshace una venta global: repone cada tramo consumido en la capa FIFO de SU
   sociedad (al frente, para conservar el orden). `fallbackSoc` cubre ventas viejas
   cuyo `consumed` no tiene etiqueta de sociedad (nacieron atadas a v.store).
   Devuelve el mapa {sociedad: unidades} repuesto, para reajustar el stock. */
function fifoDevolverGlobal(prod, consumed, fallbackSoc){
  const repuesto = {};
  if(!consumed || !consumed.length) return repuesto;
  for(let i=consumed.length-1;i>=0;i--){
    const c = consumed[i];
    if(c.synthetic) continue;   // el faltante sintético no era stock real
    const soc = isStore(c.sociedad) ? c.sociedad : (isStore(fallbackSoc)?fallbackSoc:STORE_IDS[0]);
    fifoLayers(prod, soc).unshift({ id:uid(), fecha:new Date().toISOString(), cantidad:c.cantidad, costoUnit:c.costoUnit, ref:"revert" });
    repuesto[soc] = round4((repuesto[soc]||0) + c.cantidad);
  }
  return repuesto;
}

/* ============================================================
   INVESTMENT TRANSFERS (points 2 & 4)
   ------------------------------------------------------------
   Moving stock to/from the vault is a REAL stock movement now, not a
   product flag. Each transfer:
     · consumes/creates FIFO layers so invested value is exact (at cost),
     · leaves a kardex movement in the SOURCE (or destination) store, so
       it shows up in Movements and in the product's kardex (point 2),
     · lets you pick quantities per store: all, part of each, or one only
       (point 4) — the caller passes an allocation map.
   The vault side (store = "__inv") holds units + cost layers but does NOT
   log its own kardex line, so the product's running balance stays equal to
   its sellable stock (no phantom double-counting for an auditor's eye).
   ============================================================ */
function sendToInvestment(prod, alloc, obs){
  let movedTotal = 0;
  STORE_IDS.forEach(s=>{
    const avail = stockDe(prod, s);
    const q = Math.min(Math.max(0, +(alloc[s]||0)), avail);
    if(q<=0) return;
    // exact FIFO cost of the units leaving this store
    const { unit, consumed } = fifoConsumir(prod, s, q);
    // source store: decrement stock + log a "→ vault" OUT movement (visible in Movements)
    moverStock(prod, -q, unit, "inversion", null, "→ Investment vault", { store:s, tipo:"inv-out", obs:obs||"" });
    // vault side: carry the real cost layers in, bump the vault bucket (no extra kardex line)
    consumed.forEach(c=>{ if(!c.synthetic) invLayers(prod).push({ id:uid(), fecha:new Date().toISOString(), cantidad:c.cantidad, costoUnit:c.costoUnit, ref:"from "+storeName(s) }); });
    prod.stockPorTienda[INV_STORE] = round4((prod.stockPorTienda[INV_STORE]||0) + q);
    movedTotal += q;
  });
  if(movedTotal>0) save();
  return movedTotal;
}
function returnFromInvestment(prod, store, q, obs){
  q = Math.min(Math.max(0, +q||0), invUnits(prod));
  if(q<=0) return 0;
  // consume vault layers FIFO to know the cost coming back
  const { unit, consumed } = fifoConsumir(prod, INV_STORE, q);
  prod.stockPorTienda[INV_STORE] = round4((prod.stockPorTienda[INV_STORE]||0) - q);
  // destination store: put the exact cost layers back so it can be sold at its real cost
  consumed.forEach(c=>{ if(!c.synthetic) fifoLayers(prod, store).push({ id:uid(), fecha:new Date().toISOString(), cantidad:c.cantidad, costoUnit:c.costoUnit, ref:"back from vault" }); });
  // log an IN movement in the destination store (visible in Movements)
  moverStock(prod, +q, unit, "inversion", null, "← from Investment vault", { store, tipo:"inv-return", obs:obs||"" });
  save();
  return q;
}

/* ============================================================
   TRANSFERENCIA GENÉRICA ENTRE DEPÓSITOS / BUCKETS
   ------------------------------------------------------------
   Mueve `cantidad` de `origen` a `destino` arrastrando el costo FIFO
   EXACTO de cada capa consumida. En el tramo se puede SUMAR un costo por
   unidad (`costoExtraUnit`): así la misma carta "vale más" al llegar a AR
   si algún día se capitaliza flete/nacionalización. Hoy el default es 0
   porque la importación la paga el cliente (dato de Juan).
     · Depósitos VENDIBLES (select/swan): dejan kardex (entra/sale del vendible).
     · BUCKETS (__transito/__inv): NO dejan kardex propio (igual que la bóveda),
       para que el saldo corrido del producto siga espejando el stock vendible.
       Su contenido se ve en las columnas/fichas de Transit y Vault.
   Devuelve las unidades efectivamente movidas.
   ============================================================ */
function transferStock(prod, origen, destino, cantidad, costoExtraUnit, obs){
  cantidad = Math.min(Math.max(0, +cantidad||0), stockDe(prod, origen));
  if(cantidad<=0 || origen===destino) return 0;
  costoExtraUnit = +costoExtraUnit || 0;
  // consumo FIFO del origen (mutando las capas y sabiendo el costo exacto)
  const { unit, consumed } = fifoConsumir(prod, origen, cantidad);
  // --- salida del origen ---
  if(isBucket(origen)){
    prod.stockPorTienda[origen] = round4((prod.stockPorTienda[origen]||0) - cantidad);
  } else {
    moverStock(prod, -cantidad, unit, "transfer", null, "→ "+storeName(destino), { store:origen, tipo:"transfer-out", obs:obs||"" });
  }
  // --- entrada al destino: cada capa entra a su costo + el extra del tramo ---
  consumed.forEach(c=>{ if(!c.synthetic) fifoLayers(prod, destino).push({ id:uid(), fecha:new Date().toISOString(), cantidad:c.cantidad, costoUnit:round2(c.costoUnit + costoExtraUnit), ref:"from "+storeName(origen) }); });
  if(isBucket(destino)){
    prod.stockPorTienda[destino] = round4((prod.stockPorTienda[destino]||0) + cantidad);
  } else {
    moverStock(prod, +cantidad, round2(unit + costoExtraUnit), "transfer", null, "← "+storeName(origen), { store:destino, tipo:"transfer-in", obs:obs||"" });
    prod.ultimoCosto = round2(unit + costoExtraUnit);   // referencia: último costo landed en ese depósito
  }
  save();
  return cantidad;
}

