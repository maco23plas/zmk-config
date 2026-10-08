/* ============================ ルーター・ナビ ============================ */
var routes=["dashboard","weekly","posts","diagnosis","kpis","settings"];
function parseHash(){
  var h=location.hash.replace(/^#\/?/,""), qi=h.indexOf("?"), path=h, qs="";
  if(qi>=0){ path=h.slice(0,qi); qs=h.slice(qi+1); }
  if(!path) path="dashboard";
  var params={}; qs.split("&").forEach(function(kv){ if(!kv)return; var p=kv.split("="); params[decodeURIComponent(p[0])]=decodeURIComponent(p[1]||""); });
  return { path: routes.indexOf(path)>=0?path:"dashboard", params:params };
}
function navigate(path,params){
  var q="";
  if(params){ var a=[]; for(var k in params) a.push(encodeURIComponent(k)+"="+encodeURIComponent(params[k])); if(a.length) q="?"+a.join("&"); }
  location.hash="#/"+path+q;
}
var NAV=[
  {p:"dashboard",l:"ダッシュボード",i:IC.dash,s:"ホーム"},
  {p:"weekly",l:"週次分析",i:IC.cal,s:"週次"},
  {p:"posts",l:"投稿別分析",i:IC.img,s:"投稿"},
  {p:"diagnosis",l:"診断フロー",i:IC.steth,s:"診断"},
  {p:"kpis",l:"KPI辞典",i:IC.book,s:"辞典"},
  {p:"settings",l:"設定",i:IC.gear,s:"設定"}
];
function currentTheme(){ return document.documentElement.getAttribute("data-theme")||(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"); }
function toggleTheme(){ var t=currentTheme()==="dark"?"light":"dark"; document.documentElement.setAttribute("data-theme",t); save(K.theme,t); renderChrome(); }
function renderChrome(){
  var cur=parseHash().path;
  document.getElementById("side-nav").innerHTML=NAV.map(function(n){return '<a href="#/'+n.p+'" class="'+(cur===n.p?"active":"")+'">'+n.i+n.l+'</a>';}).join("");
  document.getElementById("btabs").innerHTML=NAV.map(function(n){return '<a href="#/'+n.p+'" class="'+(cur===n.p?"active":"")+'">'+n.i+'<span>'+n.s+'</span></a>';}).join("");
  document.getElementById("theme-btn").innerHTML=currentTheme()==="dark"?IC.sun:IC.moon;
  document.getElementById("theme-btn-m").innerHTML=currentTheme()==="dark"?IC.sun:IC.moon;
}

/* ============================ トースト・モーダル ============================ */
var lastDeleted=null; // {kind:"weekly"|"post", item}
function toast(msg, actionLabel, actionFn){
  var old=document.querySelector(".toast"); if(old) old.remove();
  var t=document.createElement("div"); t.className="toast";
  t.innerHTML='<span>'+esc(msg)+'</span>'+(actionLabel?'<button type="button">'+esc(actionLabel)+'</button>':"");
  if(actionLabel){ t.querySelector("button").addEventListener("click",function(){ t.remove(); actionFn&&actionFn(); }); }
  document.body.appendChild(t);
  setTimeout(function(){ if(t.parentNode){ t.style.opacity="0"; t.style.transition="opacity .3s"; } }, actionLabel?5000:1800);
  setTimeout(function(){ t.remove(); }, actionLabel?5400:2200);
}
function confirmModal(title,desc,confirmLabel,onOk){
  var bg=document.createElement("div"); bg.className="modal-bg";
  bg.innerHTML='<div class="modal"><h3>'+esc(title)+'</h3><p class="sub">'+esc(desc)+'</p>'+
    '<div class="modal-foot"><button class="btn ghost" data-c="cancel">キャンセル</button>'+
    '<button class="btn bad" data-c="ok">'+esc(confirmLabel||"削除する")+'</button></div></div>';
  bg.addEventListener("click",function(e){
    if(e.target===bg||e.target.getAttribute("data-c")==="cancel") bg.remove();
    if(e.target.getAttribute("data-c")==="ok"){ bg.remove(); onOk(); }
  });
  document.body.appendChild(bg);
}
function closeModals(){ document.querySelectorAll(".modal-bg").forEach(function(m){m.remove();}); }

