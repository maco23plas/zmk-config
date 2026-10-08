/* ============================ 画面：診断 ============================ */
var diagKpi=null, diagState=null;
function viewDiagnosis(params){
  if(params&&params.kpi&&DIAG_KPIS.indexOf(params.kpi)>=0&&diagKpi===null){
    diagKpi=params.kpi;
    if(params.state&&statesFor(params.kpi).indexOf(params.state)>=0) diagState=params.state;
  }
  var checks=getChecks();
  var head=pageHead("診断フロー","① KPIを選ぶ → ② 状態を選ぶ → ③ 打ち手を確認。試した施策はチェックで記録。",
    diagKpi?'<button class="btn ghost" data-act="d-reset">'+IC.reset+'最初から</button>':"");
  var kpiBtns=DIAG_KPIS.map(function(k){return '<button class="choice '+(diagKpi===k?"on":"")+'" data-act="d-kpi" data-kpi="'+esc(k)+'">'+k+'</button>';}).join("");
  var step1='<div class="card mb"><div class="card-p"><div class="flex items-center gap8 mb"><span class="step-badge">1</span><b style="font-size:14px">KPIを選ぶ</b></div>'+
    '<div class="grid" style="grid-template-columns:repeat(2,1fr);gap:8px">'+kpiBtns+'</div></div></div>';
  var step2="";
  if(diagKpi){
    var sBtns=statesFor(diagKpi).map(function(s){return '<button class="chip '+(diagState===s?"on":"")+'" data-act="d-state" data-state="'+esc(s)+'">'+esc(s)+'</button>';}).join("");
    step2='<div class="card mb"><div class="card-p"><div class="flex items-center gap8 mb"><span class="step-badge">2</span><b style="font-size:14px">状態を選ぶ</b></div>'+
      '<div class="flex wrapf gap8">'+sBtns+'</div></div></div>';
  }
  var step3="";
  if(diagKpi&&diagState){
    var cards=diagFor(diagKpi,diagState);
    var list=cards.map(function(d){
      var chk=checks.filter(function(c){return c.diagnosisId===d.id;})[0], on=!!chk;
      var cat=d.category==="継続"?"keep":d.category==="更新"?"update":"new";
      return '<div class="card"'+(on?' style="border-color:color-mix(in srgb,var(--ok) 40%,transparent);background:color-mix(in srgb,var(--ok-bg) 35%,var(--card))"':"")+'><div class="card-p">'+
        '<div class="flex wrapf items-center gap8"><h3 style="font-size:15px;font-weight:600">'+esc(d.checkpoint)+'</h3><span class="pill '+cat+'">'+d.category+'</span></div>'+
        '<p class="fs13" style="margin-top:8px">'+esc(d.action)+'</p>'+
        (d.criteria?'<p class="muted fs12" style="margin-top:8px">'+esc(d.criteria)+'</p>':"")+
        '<button class="flex items-center gap8" data-act="d-check" data-id="'+d.id+'" style="background:none;border:none;cursor:pointer;margin-top:14px;padding:0;font:inherit">'+
        '<span style="width:20px;height:20px;border-radius:6px;border:1px solid var(--input);display:grid;place-items:center;'+(on?"background:var(--ok);border-color:var(--ok);color:#fff":"")+'">'+(on?"✓":"")+'</span>'+
        (on?'<span style="color:var(--ok);font-weight:500;font-size:14px">試した（'+shortDate((chk.checkedAt||"").slice(0,10))+'）</span>':'<span class="muted fs13">試した施策にする</span>')+
        '</button></div></div>';
    }).join("");
    step3='<div class="flex items-center gap8 muted fs13 mb"><b style="color:var(--ink)">'+esc(diagKpi)+'</b>'+
      '<span style="width:14px;height:14px;display:inline-flex">'+IC.chevr+'</span><b style="color:var(--ink)">'+esc(diagState)+'</b><span class="tnum">・'+cards.length+'件</span></div>'+
      '<div class="stack">'+list+'</div>';
  } else if(diagKpi){
    step3='<p class="muted fs13" style="text-align:center;padding:24px 0">状態を選ぶと打ち手が表示されます。</p>';
  } else {
    step3='<div class="flex" style="flex-direction:column;align-items:center;padding:24px 0;color:var(--muted-ink)"><span style="width:32px;height:32px;margin-bottom:8px">'+IC.steth+'</span><p class="fs13">まずは詰まっているKPIを選んでください。</p></div>';
  }
  return head+step1+step2+step3;
}

