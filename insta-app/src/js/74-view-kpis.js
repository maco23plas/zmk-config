/* ============================ 画面：KPI辞典 ============================ */
var kpiTab="dict";
function viewKpis(){
  var head=pageHead("KPI辞典","各指標の定義・計算式・確認場所・2026年の目安。");
  var note='<div class="card mb" style="border-color:color-mix(in srgb,var(--primary) 30%,transparent);background:color-mix(in srgb,var(--accent-bg) 55%,var(--card))"><div class="card-p flex gap12" style="align-items:flex-start"><span style="color:var(--primary);width:20px;height:20px;flex:none;margin-top:2px">'+IC.info+'</span><p class="fs13">'+esc(DATA.meta.benchmark_note)+'</p></div></div>';
  var tabs='<div class="tabs mb"><button class="'+(kpiTab==="dict"?"active":"")+'" data-act="k-tab" data-tab="dict">KPI辞典</button>'+
    '<button class="'+(kpiTab==="updates"?"active":"")+'" data-act="k-tab" data-tab="updates">2026年に変わったこと</button></div>';
  var body="";
  if(kpiTab==="dict"){
    var rows=DATA.kpis.map(function(k){
      return '<tr><td style="font-weight:600;white-space:nowrap;vertical-align:top">'+esc(k.name)+'</td>'+
        '<td style="min-width:200px;vertical-align:top">'+esc(k.definition)+'</td>'+
        '<td class="muted" style="min-width:150px;vertical-align:top">'+esc(k.where)+'</td>'+
        '<td style="min-width:120px;vertical-align:top;font-weight:500">'+esc(k.benchmark2026)+'</td>'+
        '<td class="muted fs12" style="min-width:200px;vertical-align:top">'+esc(k.note)+'</td></tr>';
    }).join("");
    body='<div class="card"><div class="twrap"><table><thead><tr><th>指標</th><th>定義・計算式</th><th>確認場所</th><th>2026年の目安</th><th>補足</th></tr></thead><tbody>'+rows+'</tbody></table></div></div>';
  } else {
    var rows2=DATA.updates2026.map(function(u){
      var cat=u.category==="継続"?"keep":u.category==="更新"?"update":"new";
      return '<tr><td style="font-weight:600;white-space:nowrap;vertical-align:top">'+esc(u.area)+'</td>'+
        '<td class="muted" style="min-width:150px;vertical-align:top">'+esc(u.before)+'</td>'+
        '<td style="min-width:260px;vertical-align:top">'+esc(u.after)+'</td>'+
        '<td style="vertical-align:top"><span class="pill '+cat+'">'+u.category+'</span></td></tr>';
    }).join("");
    body='<div class="card"><div class="twrap"><table><thead><tr><th>領域</th><th>元の常識</th><th>2026年の評価・更新</th><th>区分</th></tr></thead><tbody>'+rows2+'</tbody></table></div></div>';
  }
  return head+note+tabs+body;
}

