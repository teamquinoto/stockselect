/* ============================================================
   gestordestock — 34-datos-io.js
   Parte de la app. Se carga como una etiqueta script en el ORDEN del index.html.
   Todo vive en scope global (sin módulos), igual que antes.
   ============================================================ */
/* ============================================================
   Datos: export
   v69 · Se quitaron importJSON() y resetAll(): importar un JSON reemplazaba toda la
   base y "Borrar todo" la vaciaba; un error ahí no tenía vuelta atrás completa.
   Queda sólo el export.
   ============================================================ */
function exportJSON(){
  const blob=new Blob([JSON.stringify(db,null,2)],{type:"application/json"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download=`mayor-stock-${new Date().toISOString().slice(0,10)}.json`;
  a.click(); URL.revokeObjectURL(a.href);
  toast(t("io.tt.backup"));
}
