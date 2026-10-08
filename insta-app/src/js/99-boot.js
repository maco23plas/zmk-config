/* ============================ 起動 ============================ */
(function init(){
  var stored=load(K.theme,null);
  if(stored) document.documentElement.setAttribute("data-theme",stored);
  migrate();
  document.getElementById("root").innerHTML=
    '<div class="app">'+
    '<aside class="side"><div class="brand"><div class="logo">イ</div><div><div style="font-size:14px;font-weight:600">インスタ分析思考</div><small class="tnum">2026</small></div></div>'+
    '<nav class="nav" id="side-nav"></nav>'+
    '<div class="side-foot"><span>データはこの端末内のみ</span><button class="btn icon ghost" id="theme-btn" data-act="theme" aria-label="テーマ切替"></button></div></aside>'+
    '<div style="min-width:0;display:flex;flex-direction:column">'+
    '<header class="topbar"><div class="brand" style="padding:0"><div class="logo" style="width:32px;height:32px">イ</div><div><div style="font-size:14px;font-weight:600">インスタ分析思考 2026</div></div></div>'+
    '<button class="btn icon ghost" id="theme-btn-m" data-act="theme" aria-label="テーマ切替"></button></header>'+
    '<main><div class="wrap"><div id="acct-host"></div><div id="view"></div></div></main></div>'+
    '<nav class="btabs" id="btabs"></nav></div>'+
    '<input type="file" id="file-input" accept="application/json,.json" style="display:none">';
  render();
})();

