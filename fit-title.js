// タイトル自動フィット：
// 1) まずタイトル全体を1行に収めようとフォントを縮小する（動画が幅にフィットするのと同じ発想）。
// 2) 縮小しすぎになる場合（基準の55%未満 or 15px未満）だけ、.nb単位の折り返しに戻し、
//    はみ出しが残るときのみ最小限縮小する。
(function(){
  var SEL="main h1, .flag-info h3";
  function fitOne(el){
    el.style.fontSize=""; el.style.whiteSpace="nowrap";
    var base=parseFloat(getComputedStyle(el).fontSize);
    var size=base, guard=60;
    var floor=Math.max(base*0.55, 15);
    while(guard-- > 0 && el.scrollWidth > el.clientWidth + 1 && size > floor){
      size*=0.97;
      el.style.fontSize=size+"px";
    }
    if(el.scrollWidth > el.clientWidth + 1){
      // 1行では小さくなりすぎる → .nb折り返しに戻し、必要なぶんだけ縮める
      el.style.whiteSpace=""; el.style.fontSize="";
      size=base; guard=40;
      while(guard-- > 0 && el.scrollWidth > el.clientWidth + 1 && size > 14){
        size*=0.96;
        el.style.fontSize=size+"px";
      }
    }
  }
  function fitAll(){ document.querySelectorAll(SEL).forEach(fitOne); }
  var t=null;
  window.addEventListener("resize",function(){ clearTimeout(t); t=setTimeout(fitAll,120); });
  window.addEventListener("orientationchange",function(){ clearTimeout(t); t=setTimeout(fitAll,180); });
  if(document.fonts && document.fonts.ready){ document.fonts.ready.then(fitAll); }
  if(document.readyState==="loading"){ document.addEventListener("DOMContentLoaded",fitAll); }
  else{ fitAll(); }
  window.addEventListener("load",fitAll);
})();
