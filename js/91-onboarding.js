/* ============================================================
   gestordestock — 91-onboarding.js
   Tour de bienvenida (primera vez) + selector de idioma.
   - Aditivo y self-contained: no toca lógica de negocio.
   - El overlay vive en <body> (fuera de #main), así render() no lo pisa.
   - Primera vez: pregunta idioma -> arranca el tour. Flag por usuario en localStorage.
   - startOnboarding(): relanza el tour a mano (botón "¿Cómo funciona?").
   ============================================================ */
(function(){
  "use strict";
  function K(k,vars){ return (typeof t==="function") ? t(k,vars) : k; }
  function admin(){ return (typeof isAdmin==="function") && isAdmin(); }
  function flagKey(){ var u=""; try{ u=(typeof session!=="undefined"&&session&&session.user)||""; }catch(e){} return "gstock_onboarded:"+(u||"anon"); }
  function seen(){ try{ return localStorage.getItem(flagKey())==="1"; }catch(e){ return false; } }
  function markSeen(){ try{ localStorage.setItem(flagKey(),"1"); }catch(e){} }

  var S=function(p){ return '<svg class="ob-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+p+'</svg>'; };
  var ARR   = S('<path d="M5 12h14M13 6l6 6-6 6"/>');
  var HOUSE = '<path d="M3 21h18M5 21V9l7-5 7 5v12M9 21v-6h6v6"/>';
  var TRUCK = '<path d="M2 12h13l3-3 3 3-3 3H2M6 8l-3 4 3 4"/>';
  var CHECK = '<path d="M20 6 9 17l-5-5"/>';
  var BOX   = '<path d="M21 8 12 3 3 8l9 5 9-5Z"/><path d="M3 8v8l9 5 9-5V8"/>';
  var SPLIT = '<path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3M7 9l3 3-3 3M17 9l-3 3 3 3"/>';
  var GLOBE = '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/>';

  /* ---------- ilustraciones (usan i18n en vivo) ---------- */
  function ilWelcome(){
    return '<div class="ob-depo"><div class="ob-box"><div class="ob-b ob-accent">'+S(BOX)+'</div>'+
      '<div class="ob-t">'+K("ob.l.start")+'</div><div class="ob-s">'+K("ob.l.startsub")+'</div></div></div>';
  }
  function ilDepo(){
    return '<div class="ob-depo">'+
      '<div class="ob-box"><div class="ob-b">'+S(HOUSE)+'</div><div class="ob-t">'+K("ob.l.swan")+'</div><div class="ob-s">'+K("ob.l.usa")+'</div></div>'+
      '<div class="ob-arrow">'+ARR+'</div>'+
      '<div class="ob-box"><div class="ob-b ob-bord">'+S(HOUSE)+'</div><div class="ob-t">'+K("ob.l.select")+'</div><div class="ob-s">'+K("ob.l.ar")+'</div></div></div>';
  }
  function ilGates(){
    return '<div class="ob-rail">'+
      '<div class="ob-node"><div class="ob-d">'+S(HOUSE)+'</div><div class="ob-l">'+K("ob.l.swan")+' · '+K("ob.l.usa")+'</div></div>'+
      '<div class="ob-conn hot"></div>'+
      '<div class="ob-node hot"><div class="ob-d">'+S(TRUCK)+'</div><div class="ob-l">'+K("ob.l.transit")+'</div></div>'+
      '<div class="ob-conn"></div>'+
      '<div class="ob-node"><div class="ob-d">'+S(CHECK)+'</div><div class="ob-l">'+K("ob.l.select")+' · '+K("ob.l.ar")+'</div></div></div>';
  }
  function ilLanes(){
    return '<div class="ob-lanes">'+
      '<div class="ob-lane own"><span class="ob-ic">'+S(CHECK)+'</span><div><div class="ob-lt">'+K("ob.l.own")+'</div><div class="ob-ls">'+K("ob.l.owndesc")+'</div></div></div>'+
      '<div class="ob-lane third"><span class="ob-ic">'+S(SPLIT)+'</span><div><div class="ob-lt">'+K("ob.l.third")+'</div><div class="ob-ls">'+K("ob.l.thirddesc")+'</div></div></div></div>';
  }
  function ilPanel(){
    return '<div class="ob-mstrip">'+
      '<div class="ob-mchip a"><span class="ob-mi">3</span><span class="ob-ml">'+K("dash.pend.reorder")+'</span><span class="ob-mg">\u203a</span></div>'+
      '<div class="ob-mchip b"><span class="ob-mi">2</span><span class="ob-ml">'+K("dash.pend.transit")+'</span><span class="ob-mg">\u203a</span></div>'+
      '<div class="ob-mchip c"><span class="ob-mi">5</span><span class="ob-ml">'+K("dash.pend.thirdparty")+'</span><span class="ob-mg">\u203a</span></div></div>';
  }
  function ilDone(){
    return '<div class="ob-done"><div class="ob-ring">'+S(CHECK)+'</div>'+
      '<div class="ob-qhint"><span class="ob-q">?</span> '+K("gloss.swan")+'</div></div>';
  }

  function adminSteps(){ return [
    {t:"ob.s1.t",b:"ob.s1.b",il:ilWelcome},
    {t:"ob.s2.t",b:"ob.s2.b",il:ilDepo},
    {t:"ob.s3.t",b:"ob.s3.b",il:ilGates},
    {t:"ob.s4.t",b:"ob.s4.b",il:ilLanes},
    {t:"ob.s5.t",b:"ob.s5.b",il:ilPanel},
    {t:"ob.s6.t",b:"ob.s6.b",il:ilDone,last:true}
  ]; }
  function sellerSteps(){ return [
    {t:"ob.s1.t",b:"ob.s1.b",il:ilWelcome},
    {t:"ob.ss.t",b:"ob.ss.b",il:ilPanel},
    {t:"ob.s6.t",b:"ob.s6.b",il:ilDone,last:true}
  ]; }

  var _open=false, _i=0, _steps=[];

  function ensureRoot(){
    var r=document.getElementById("obRoot");
    if(r) return r;
    r=document.createElement("div");
    r.id="obRoot"; r.className="ob-scrim";
    r.innerHTML='<div id="obCard" class="ob-card" role="dialog" aria-modal="true" aria-label="Stock Select"></div>';
    document.body.appendChild(r);
    r.addEventListener("click", function(e){
      var el=e.target.closest && e.target.closest("[data-ob-next],[data-ob-back],[data-ob-skip],[data-ob-lang],[data-ob-dot]");
      if(!el) return;
      if(el.hasAttribute("data-ob-lang")){ var L=el.getAttribute("data-ob-lang"); if(typeof setLang==="function") setLang(L); startSteps(); return; }
      if(el.hasAttribute("data-ob-next")){ nextStep(); return; }
      if(el.hasAttribute("data-ob-back")){ prevStep(); return; }
      if(el.hasAttribute("data-ob-skip")){ close(true); return; }
      if(el.hasAttribute("data-ob-dot")){ _i=+el.getAttribute("data-ob-dot"); renderStep(); return; }
    });
    document.addEventListener("keydown", onKey);
    return r;
  }
  function onKey(e){
    if(!_open) return;
    if(e.key==="Escape"){ close(true); }
    else if(e.key==="ArrowRight"){ nextStep(); }
    else if(e.key==="ArrowLeft"){ prevStep(); }
  }
  function close(finish){
    _open=false;
    var r=document.getElementById("obRoot"); if(r) r.remove();
    document.removeEventListener("keydown", onKey);
    if(finish) markSeen();
  }
  function dotsHTML(){
    var h=""; for(var j=0;j<_steps.length;j++) h+='<span class="ob-dot'+(j===_i?' on':'')+'" data-ob-dot="'+j+'" role="button" tabindex="0"></span>';
    return h;
  }
  function renderStep(){
    var s=_steps[_i], card=document.getElementById("obCard"); if(!card) return;
    card.innerHTML=
      '<div class="ob-head"><span class="ob-stepof">'+K("ob.stepof",{n:_i+1,total:_steps.length})+'</span>'+
        '<button class="ob-skip" data-ob-skip>'+K("ob.skip")+'</button></div>'+
      '<div class="ob-pbar"><div class="ob-pfill" style="width:'+Math.round((_i+1)/_steps.length*100)+'%"></div></div>'+
      '<div class="ob-illus">'+s.il()+'</div>'+
      '<div class="ob-body ob-anim"><h2>'+K(s.t)+'</h2><p>'+K(s.b)+'</p></div>'+
      '<div class="ob-foot"><div class="ob-dots">'+dotsHTML()+'</div>'+
        '<button class="ob-btn ob-ghost" data-ob-back'+(_i===0?' disabled':'')+'>'+K("ob.back")+'</button>'+
        '<button class="ob-btn ob-primary" data-ob-next>'+(s.last?K("ob.start"):K("ob.next"))+'</button></div>';
  }
  function openChooser(){
    var card=document.getElementById("obCard"); if(!card) return;
    card.innerHTML=
      '<div class="ob-illus"><div class="ob-globe">'+S(GLOBE)+'</div></div>'+
      '<div class="ob-body"><h2>Elegí tu idioma</h2><p>Choose your language</p></div>'+
      '<div class="ob-langs">'+
        '<button class="ob-btn ob-lang" data-ob-lang="es">Español</button>'+
        '<button class="ob-btn ob-lang" data-ob-lang="en">English</button></div>'+
      '<p class="ob-langnote">Podés cambiarlo cuando quieras · You can change it anytime</p>';
  }
  function startSteps(){ _steps = admin()?adminSteps():sellerSteps(); _i=0; renderStep(); }
  function nextStep(){ if(_steps[_i] && _steps[_i].last){ close(true); } else { _i=Math.min(_steps.length-1,_i+1); renderStep(); } }
  function prevStep(){ if(_i>0){ _i--; renderStep(); } }

  function openTour(force){
    if(_open) return;
    ensureRoot(); _open=true;
    if(force) startSteps();     // relanzado a mano: ya eligió idioma, va directo al tour
    else openChooser();         // primera vez: elige idioma y arranca
  }

  function maybeAutoStart(){
    try{ if(typeof session==="undefined" || !session) return; }catch(e){ return; }
    if(seen()) return;
    openTour(false);
  }

  // API global
  window.startOnboarding = function(){ openTour(true); };
  window.maybeStartOnboarding = maybeAutoStart;

  // Botón "¿Cómo funciona?" (relanzar)
  document.querySelectorAll("[data-open-help]").forEach(function(b){ b.onclick=function(){ window.startOnboarding(); }; });
})();
