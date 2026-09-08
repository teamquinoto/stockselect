/* ============================================================
   gestordestock — 34-datos-io.js
   Parte de la app. Se carga como <script> en el ORDEN del index.html.
   Todo vive en scope global (sin módulos), igual que antes.
   ============================================================ */
/* ============================================================
   Datos: export / import / reset
   ============================================================ */
function exportJSON(){
  const blob=new Blob([JSON.stringify(db,null,2)],{type:"application/json"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download=`mayor-stock-${new Date().toISOString().slice(0,10)}.json`;
  a.click(); URL.revokeObjectURL(a.href);
  toast("Backup exportado");
}
function importJSON(){
  const inp=document.createElement("input"); inp.type="file"; inp.accept="application/json";
  inp.onchange=()=>{
    const f=inp.files[0]; if(!f) return;
    const r=new FileReader();
    r.onload=()=>{
      try{
        const data=JSON.parse(r.result);
        if(!data.productos) throw new Error("estructura inválida");
        if(!confirm("Esto reemplaza todos los datos actuales. ¿Seguir?")) return;
        db=migrate(Object.assign({config:{moneda:"$"},productos:[],compras:[],ventas:[],movimientos:[],clientes:[]}, data));
        save(); toast("Datos importados"); render();
      }catch(e){ toast("Invalid JSON","warn"); }
    };
    r.readAsText(f);
  };
  inp.click();
}
function resetAll(){
  if(!confirm("Se borra TODO (productos, compras, ventas y movimientos). ¿Seguro?")) return;
  db=migrate({ config:db.config, productos:[], compras:[], ventas:[], movimientos:[], clientes:[] });
  save(); toast("Todo borrado","warn"); render();
}

