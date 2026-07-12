// タイトル自動フィット：.nb（改行禁止のかたまり）が横幅からはみ出す場合のみ、
// フォントサイズを段階的に縮めて収める。改行位置は変えない。
(function(){
  var SEL="main h1, .flag-info h3";
  var MIN=14;          // これ以下には縮めない(px)
  var STEP=0.96;       // 4%ずつ縮小
  function fitOne(el){
    el.style.fontSize="";                       // CSSのclamp値にリセットして再計測
    var guard=40;
    var size=parseFloat(getComputedStyle(el).fontSize);
    while(guard-- > 0 && el.scrollWidth > el.clientWidth + 1 && size > MIN){
      size*=STEP;
      el.style.fontSize=size+"px";
    }
  }
  function fitAll(){
    document.querySelectorAll(SEL).forEach(fitOne);
  }
  var t=null;
  window.addEventListener("resize",function(){ clearTimeout(t); t=setTimeout(fitAll,120); });
  window.addEventListener("orientationchange",function(){ clearTimeout(t); t=setTimeout(fitAll,180); });
  if(document.fonts && document.fonts.ready){ document.fonts.ready.then(fitAll); }
  if(document.readyState==="loading"){ document.addEventListener("DOMContentLoaded",fitAll); }
  else{ fitAll(); }
  window.addEventListener("load",fitAll);
})();
