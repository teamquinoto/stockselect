/* ============================================================
   gestordestock — 34-datos-io.js
   Parte de la app. Se carga como una etiqueta script en el ORDEN del index.html.
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
  toast(t("io.tt.backup"));
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
        if(!confirm(t("io.cf.import"))) return;
        db=migrate(Object.assign({config:{moneda:"$"},productos:[],compras:[],ventas:[],movimientos:[],clientes:[]}, data));
        save(); toast(t("io.tt.imported")); render();
      }catch(e){ toast(t("io.tt.invalidjson"),"warn"); }
    };
    r.readAsText(f);
  };
  inp.click();
}
function resetAll(){
  if(!confirm(t("io.cf.wipe"))) return;
  db=migrate({ config:db.config, productos:[], compras:[], ventas:[], movimientos:[], clientes:[] });
  save(); toast(t("io.tt.wiped"),"warn"); render();
}

