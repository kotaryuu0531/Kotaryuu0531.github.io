// タイトル自動フィット：
// 1) 通常折返し状態での「確保幅」を先に測り、max-widthで固定してから nowrap を適用する
//    （グリッド/フレックス内で nowrap が枠自体を押し広げて誤判定するのを防ぐ）。
// 2) その幅に収まるまでフォントを縮小して1行化。縮小しすぎになる場合
//    （基準の55%未満 or 15px未満）だけ .nb 単位の折り返しに戻し、はみ出し分のみ縮小。
(function(){
  var SEL="main h1, .flag-info h3";
  function fitOne(el){
    el.style.fontSize=""; el.style.whiteSpace=""; el.style.maxWidth="";
    var avail=el.clientWidth;
    if(!avail) return;
    var base=parseFloat(getComputedStyle(el).fontSize);
    el.style.maxWidth=avail+"px";
    el.style.whiteSpace="nowrap";
    var size=base, guard=60, floor=Math.max(base*0.55, 15);
    while(guard-- > 0 && el.scrollWidth > avail + 1 && size > floor){
      size*=0.97;
      el.style.fontSize=size+"px";
    }
    if(el.scrollWidth > avail + 1){
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
