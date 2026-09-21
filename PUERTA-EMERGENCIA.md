# Puerta de emergencia (rescate de etapa)

> Diseño + integración. Equipo: Principal UX/UI · Lead PM · Senior Backend/Data.
> Módulo nuevo: `js/24-emergencia.js` (100% aditivo, no toca el motor ni el worker).

---

## 1. Qué modela hoy el sistema (para no romper la lógica)

El viaje físico tiene **tres etapas** y dos flujos paralelos que las recorren:

```
        Miami (Swan · US)  ──►  Barco (__transito)  ──►  Argentina (Select · AR)
   PROPIO   FIFO real            bucket no vendible          FIFO real (vendible)
   TERCERO      —              en_transito ──► en_ar ──► entregado
```

Las **dos puertas de decisión** que ya existen (split + costos):

| Puerta | Momento | Qué decide / capitaliza |
|---|---|---|
| **1ª** | Al despachar de US (`Send to transit` / split *ours* vs *resto*) | qué va a Swan, qué al barco, qué es ajeno · costo **intl** (`d.intl`) |
| **2ª** | Al llegar a AR (`Resolve in AR` / `quedarseParaSelect`) | comisión→Select vs dueño→entrega · costo **arg** (`d.arg`) + markup |

Cada capa FIFO guarda el desglose `d:{us, intl, arg}`, y el costo landed crece etapa a etapa: `us → us+intl → us+intl+arg`. **Este dato es la llave de la reversa.**

---

## 2. La puerta de emergencia = revertir UN tramo

Requisito tuyo: *si el error está en Argentina, vuelve al barco; si está en el barco, vuelve a Miami*. Es exactamente la reversa del viaje:

```
   Argentina (Select) ──ar_to_ship──► Barco (__transito) ──ship_to_us──► Miami (Swan)
                        (descap. arg)                       (descap. intl)
```

### La decisión de diseño clave: ¿qué pasa con el costo capitalizado?

Barajamos tres opciones:

1. **Mover sin tocar el costo.** La carta queda "en barco" cargando el costo *arg* que todavía no le corresponde a esa etapa → rompe la simetría del modelo y ensucia la valuación del bucket. ❌
2. **Mandarlo a merma/gasto.** El dinero ya gastado se reconoce como pérdida. Correcto contablemente **si** la plata realmente se perdió, pero la premisa es *error operativo* (el tramo no debió ejecutarse), no una pérdida real. Lo dejamos como acción aparte, no como default. ❌ (para v1)
3. **Descapitalizar el tramo revertido.** Al volver una etapa, se le quita a la capa **exactamente** el componente `d.arg` (o `d.intl`) que se le había sumado, dejándola con el costo que tenía en la etapa anterior. ✅

Elegimos **la 3** porque:

- Es **simétrica y auditable**: `reversa(avance(x)) = x`. Un auditor reconstruye el costo sin sorpresas.
- Es **exacta por capa**: usa el `d` congelado en cada lote, no un promedio ni el total del tramo original (que puede diferir si hubo ventas parciales en el medio).
- Es **honesta con la premisa**: si fue un error de carga, el costo de ese tramo no debería "pegarse" a la mercadería.
- Deja registro del monto descapitalizado en el kardex, así que si además hubo un gasto real irrecuperable, lo reconocés aparte cuando quieras.

> **Nota de auditor:** la descapitalización NO borra el gasto de tu bolsillo; borra su *capitalización al stock*. La plata gastada, si no vuelve, se trata como gasto en el P&L por la vía normal. La puerta separa "el estado físico de la carta" de "la plata que ya saliste".

### Scope de v1 (guardrails del PM)

- ✅ Stock **propio**: reversa completa de los dos tramos, con descapitalización FIFO exacta.
- ✅ **Terceros**: retroceso de la máquina de estados (`entregado→en_ar→en_transito`), limpiando el courier al volver al barco.
- ⛔ **Bloqueado en v1**: una consignación que ya se **quedó para Select** (`keptForSelect>0`). Esas unidades ya son stock vendible con FIFO propio; desarmarlas es otra operación (tiene su revert). La puerta avisa y no lo hace, para no meter un COGS fantasma.
- 🔒 Solo **admin**. Motivo **obligatorio**. Confirmación con `confirm()` + botón `danger`. Todo envuelto en `withUndo` (deshacés 5s).
- 🧾 Traza: kardex `tipo:"emergencia"` con el motivo (stock propio) e `historial[{emergencia:true}]` (terceros). Filtrable después en Movimientos.

### UX: "break glass", no botón cotidiano

En vez de sembrar botones de reversa en cada fila (invita al mal uso), hay **una sola entrada** en la toolbar de Terceros: `🛟 Puerta de emergencia` (solo admin, estilo alerta). Abre un panel que:

1. Te hace elegir flujo (propio / terceros).
2. Detecta la etapa donde está la mercadería y **auto-resuelve el destino** por la lógica del flujo (no lo elegís vos).
3. Te muestra el **delta de costo** en vivo (`$X/u → $Y/u`, descapitaliza `$Z/u`).
4. Exige **causal + detalle** (detalle obligatorio si elegís "Otro").
5. Confirma resumiendo unidades + destino + motivo.

---

## 3. Integración (4 ediciones, todas chicas)

### 3.1 — `index.html`: cargar el módulo (después de 18)

Buscá la línea del script de la vista Terceros y agregá la nueva **debajo**:

```html
<script src="js/18-view-conjunta.js"></script>
<script src="js/24-emergencia.js"></script>   <!-- NUEVO -->
```

### 3.2 — `js/18-view-conjunta.js`: botón en la toolbar (solo admin)

En el `return` del render (~línea 885), dentro del `<div class="actions">`, agregá el botón **al principio**:

```js
<div class="actions">${isAdmin()?`<button class="btn danger" data-emergencia title="${t("emg.md.title")}">${ICO.warn}${t("emg.b.short")}</button>`:""}<button class="btn" data-enviar-transito ...
```

### 3.3 — `js/18-view-conjunta.js`: enganchar el botón

Al final de `wireConjunta()` (~línea 1242, antes del `}`), agregá:

```js
  if (typeof wireEmergencia === "function") wireEmergencia();
```

### 3.4 — `js/00b-i18n.js`: las claves

Pegá el bloque **`en`** antes del cierre del diccionario inglés (línea ~735, el `},` que precede a `es: {`) y el bloque **`es`** antes del cierre del español (~1519).

```js
// ---- en ----
"emg.b.short":"Emergency", "emg.kardex.tag":"Emergency rescue",
"emg.md.title":"Emergency gate", "emg.md.warn.title":"Break-glass action",
"emg.md.warn.body":"Reverses one leg of the journey for operational fixes only. It de-capitalizes the leg cost and leaves an audit trail. Not for daily use.",
"emg.md.pick.own":"Our stock (Swan / transit / Select)", "emg.md.pick.ter":"Third-party (consignment)",
"emg.leg.ar":"In Argentina (Select) → back to the ship", "emg.leg.ship":"On the ship (transit) → back to Miami",
"emg.l.cause":"Reason", "emg.l.detail":"Detail", "emg.l.detail.opt":"optional", "emg.l.detail.req":"required", "emg.ph.detail":"What happened",
"emg.cause.wrong_stage":"Advanced by mistake", "emg.cause.not_shipped":"Didn't actually ship", "emg.cause.customs_return":"Returned at customs",
"emg.cause.client_change":"Client change of plan", "emg.cause.data_fix":"Data-entry fix", "emg.cause.other":"Other",
"emg.own.md.title":"Emergency · our stock", "emg.own.hint":"Move units back one physical stage. The reversed leg's cost is de-capitalized. Leaves a kardex trace.",
"emg.own.stage":"Where is it now?", "emg.own.costdelta":"Landed cost", "emg.own.nostage":"No rescuable stock for this product.",
"emg.own.descap":"de-capitalizes {m}/u", "emg.own.nodescap":"no leg cost to remove", "emg.own.b.rescue":"Rescue back",
"emg.own.confirm":"Rescue {n} u of \"{name}\" back to {dest}?\nReason: {cause}", "emg.own.undo":"Rescued {n} u", "emg.own.done":"{n} u moved back to {dest}",
"emg.ter.md.title":"Emergency · third-party", "emg.ter.hint":"Roll the selected lines back one state (delivered → in AR → in transit).",
"emg.ter.b.rescue":"Roll back", "emg.ter.confirm":"Roll back {n} line(s)?\nReason: {cause}", "emg.ter.undo":"Rolled back {n} line(s)", "emg.ter.done":"{n} line(s) rolled back",
"emg.tt.adminonly":"Admin only.", "emg.tt.keptblock":"This line already entered Select stock; use its own revert.", "emg.tt.atorigin":"Already at the origin — can't go further back.",
"emg.tt.nothingown":"No stock in Select or transit to rescue.", "emg.tt.nothingter":"No third-party lines to roll back.", "emg.tt.pickprodstage":"Pick a product and a stage.",
"emg.tt.pickline":"Tick at least one line.", "emg.tt.enterqty":"Enter a quantity.", "emg.tt.needdetail":"Add a detail for \"Other\".", "emg.tt.nothingdone":"Nothing to roll back.",

// ---- es ----
"emg.b.short":"Emergencia", "emg.kardex.tag":"Rescate de emergencia",
"emg.md.title":"Puerta de emergencia", "emg.md.warn.title":"Acción de emergencia",
"emg.md.warn.body":"Revierte un tramo del viaje, solo para errores operativos. Descapitaliza el costo del tramo y deja traza de auditoría. No es de uso diario.",
"emg.md.pick.own":"Stock nuestro (Swan / tránsito / Select)", "emg.md.pick.ter":"De terceros (consignación)",
"emg.leg.ar":"En Argentina (Select) → vuelve al barco", "emg.leg.ship":"En el barco (tránsito) → vuelve a Miami",
"emg.l.cause":"Motivo", "emg.l.detail":"Detalle", "emg.l.detail.opt":"opcional", "emg.l.detail.req":"obligatorio", "emg.ph.detail":"Qué pasó",
"emg.cause.wrong_stage":"Avanzó por error", "emg.cause.not_shipped":"No se despachó realmente", "emg.cause.customs_return":"Volvió en aduana",
"emg.cause.client_change":"Cambio de plan del cliente", "emg.cause.data_fix":"Corrección de carga", "emg.cause.other":"Otro",
"emg.own.md.title":"Emergencia · stock nuestro", "emg.own.hint":"Retrocede las unidades una etapa física. Se descapitaliza el costo del tramo revertido. Deja traza en el kardex.",
"emg.own.stage":"¿Dónde está ahora?", "emg.own.costdelta":"Costo landed", "emg.own.nostage":"No hay stock rescatable de este producto.",
"emg.own.descap":"descapitaliza {m}/u", "emg.own.nodescap":"sin costo de tramo para quitar", "emg.own.b.rescue":"Rescatar",
"emg.own.confirm":"¿Rescatar {n} u de \"{name}\" de vuelta a {dest}?\nMotivo: {cause}", "emg.own.undo":"Rescatadas {n} u", "emg.own.done":"{n} u volvieron a {dest}",
"emg.ter.md.title":"Emergencia · terceros", "emg.ter.hint":"Retrocede las líneas tildadas un estado (entregado → en AR → en tránsito).",
"emg.ter.b.rescue":"Retroceder", "emg.ter.confirm":"¿Retroceder {n} línea(s)?\nMotivo: {cause}", "emg.ter.undo":"Retrocedidas {n} línea(s)", "emg.ter.done":"{n} línea(s) retrocedidas",
"emg.tt.adminonly":"Solo admin.", "emg.tt.keptblock":"Esta línea ya ingresó a stock de Select; usá su revert propio.", "emg.tt.atorigin":"Ya está en el origen — no se puede retroceder más.",
"emg.tt.nothingown":"No hay stock en Select ni en tránsito para rescatar.", "emg.tt.nothingter":"No hay líneas de terceros para retroceder.", "emg.tt.pickprodstage":"Elegí producto y etapa.",
"emg.tt.pickline":"Tildá al menos una línea.", "emg.tt.enterqty":"Ingresá una cantidad.", "emg.tt.needdetail":"Agregá un detalle para \"Otro\".", "emg.tt.nothingdone":"Nada para retroceder.",
```

---

## 4. El worker: NO hay que tocarlo

Lo revisé y **no requiere cambios**. El fact table (`deriveFacts`) se deriva **solo de `data.ventas`**; el rollup agrega ventas. La puerta de emergencia:

- no crea ni modifica **ventas**,
- opera sobre tránsito (bucket **no vendible**, fuera del pool y del P&L) y sobre **consignaciones** (que nunca entran al fact table),
- persiste todo dentro del blob `PUT /state` como cualquier otro cambio, y el worker re-deriva solito.

O sea: la traza de auditoría (kardex + `historial`) viaja en el blob, que ya es tu fuente de verdad y ya se sincroniza. **Cero downtime, cero migración.**

*Único caso futuro donde tocarías el worker:* si algún día querés **reporting server-side de los rescates** (ej. un `/rollup` que cuente movimientos `tipo:"emergencia"` por mes/motivo para control interno). Ahí sí derivarías una tablita `emergency_log` desde `db.movimientos`. Para v1 no hace falta.
