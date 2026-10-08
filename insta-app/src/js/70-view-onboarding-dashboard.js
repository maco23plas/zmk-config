/* ============================ 画面：オンボーディング ============================ */
function viewWizard(){
  return '<div class="wizard">'+
    '<div style="text-align:center;margin-bottom:28px">'+
    '<div class="logo" style="width:56px;height:56px;border-radius:16px;margin:0 auto 16px;font-size:22px">イ</div>'+
    '<h1 style="font-size:24px;font-weight:700">インスタ分析思考 2026</h1>'+
    '<p class="muted fs13" style="margin-top:8px">数字を入れる → どこが悪いか分かる → 何をすべきか分かる。<br>まずはアカウントを1つ追加しましょう（あとで何個でも追加できます）。</p></div>'+
    '<div class="stack">'+
    '<button class="big-choice" data-act="wiz-api"><span class="ic" style="background:var(--accent-bg);color:var(--primary)">'+IC.link+'</span>'+
    '<span><b>Instagram連携ではじめる</b><p>プロアカウント＆権限があれば、数値を自動で取り込めます（おすすめ）</p></span></button>'+
    '<button class="big-choice" data-act="wiz-manual"><span class="ic" style="background:var(--muted);color:var(--muted-ink)">'+IC.keyb+'</span>'+
    '<span><b>手動入力ではじめる</b><p>連携なしでOK。インサイトの数値を手で入力して分析します</p></span></button>'+
    '<button class="big-choice" data-act="wiz-sample"><span class="ic" style="background:var(--ok-bg);color:var(--ok)">'+IC.spark+'</span>'+
    '<span><b>サンプルデータで試す</b><p>まず触ってみたい方はこちら。1タップでデモ用データが入ります</p></span></button>'+
    '</div></div>';
}

/* ============================ 画面：ダッシュボード ============================ */
function pageHead(title,desc,action){
  return '<div class="page-head"><div><h1>'+esc(title)+'</h1>'+(desc?'<p>'+esc(desc)+'</p>':"")+'</div>'+(action?'<div>'+action+'</div>':"")+'</div>';
}
function viewDashboard(){
  var acc=currentAcct();
  var weekly=getWeekly();
  var settings=getSettings();
  var isApi=acc&&acc.mode==="api";

  // 今週入力済み？先週入力済み？
  var lastW=weekRange(1), lastKey=ymd(lastW.since);
  var hasLastWeek=weekly.some(function(e){return e.weekStart===lastKey;});
  var cta="";
  if(!hasLastWeek){
    cta='<div class="cta-hero mb"><div><h3>'+(isApi?"先週ぶんをワンタップで取り込めます":"先週ぶんの数値を入力しましょう")+'</h3>'+
      '<p>'+lastW.label+' のデータが未登録です。'+(isApi?"連携済みなので自動で入ります。":"5分で終わります。")+'</p></div>'+
      (isApi?'<button class="btn lg" data-act="open-import">'+IC.cloud+'先週ぶんを取り込む</button>'
            :'<button class="btn lg" data-act="w-new-go">'+IC.pen+'先週ぶんを入力する</button>')+'</div>';
  } else if(isApi){
    cta='<div class="flex" style="justify-content:flex-end;margin-bottom:14px"><button class="btn outline sm" data-act="open-import">'+IC.cloud+'データを取り込む</button></div>';
  }

  if(weekly.length===0){
    return pageHead("ダッシュボード", acc?("アカウント：「"+acc.name+"」"):"")+cta+
      '<div class="empty"><div class="eicon">'+IC.dash+'</div><h3>まだデータがありません</h3>'+
      '<p>'+(isApi?"「取り込む」を押すと先週の数値が自動で入ります。":"週次分析から数値を入力すると、KPIカード・トレンド・アラートが表示されます。")+'</p>'+
      '<div class="flex wrapf gap12 mt" style="justify-content:center">'+
      (isApi?'<button class="btn" data-act="open-import">'+IC.cloud+'先週ぶんを取り込む</button>':'<button class="btn" data-act="w-new-go">'+IC.pen+'週次分析で入力する</button>')+
      '<button class="btn outline" data-act="seed">'+IC.spark+'サンプルデータを入れる</button></div></div>';
  }

  var asc=weekly.slice().sort(function(a,b){return a.weekStart.localeCompare(b.weekStart);});
  var latest=asc[asc.length-1], prev=asc[asc.length-2];
  var lr=weeklyRates(latest), pr=prev?weeklyRates(prev):null;

  var cards=BENCH_META.map(function(m){
    var v=lr[m.key], pv=pr?pr[m.key]:null, th=settings.benchmarks[m.bk];
    var st=rateStatus(v,th.good,th.warn);
    return '<div class="kpi"><div class="lab"><span class="dot '+st+'"></span>'+m.label+'</div>'+
      '<div class="val tnum">'+pct(v)+'</div><div class="bm">'+deltaHtml(delta(v,pv))+' ・ 目安 '+m.bm+'</div></div>';
  }).join("");

  var alerts="";
  if(asc.length>=3){
    var l3=asc.slice(-3).map(weeklyRates);
    BENCH_META.forEach(function(m){
      var a=l3[0][m.key],b=l3[1][m.key],c=l3[2][m.key];
      if(a!=null&&b!=null&&c!=null&&a>b&&b>c){
        alerts+='<div class="alert"><div class="flex gap12 items-center"><div class="ai">'+IC.warn+'</div>'+
          '<div><div style="font-weight:600;font-size:14px">「'+m.label+'」が2週連続で低下しています</div>'+
          '<div class="muted fs12 tnum" style="margin-top:2px">'+[a,b,c].map(function(x){return pct(x);}).join(" → ")+'</div></div></div>'+
          (m.dk?'<button class="btn outline sm" data-act="go-diag" data-kpi="'+esc(m.dk)+'" data-state="'+esc(m.ds||"減った")+'">診断フローを見る'+IC.up+'</button>':"")+'</div>';
      }
    });
  }

  var last8=asc.slice(-8);
  var sparks=SPARK_KEYS.map(function(k,i){
    var series=last8.map(function(e){return {label:shortDate(e.weekStart),value:weeklyRates(e)[k]};});
    var meta=RATE_META.filter(function(m){return m.key===k;})[0];
    var lastv=series.length?series[series.length-1].value:null;
    var prevv=series.length>1?series[series.length-2].value:null;
    return '<div class="spark-wrap"><div class="flex between items-center" style="margin-bottom:6px"><span class="muted fs13">'+meta.label+'</span>'+deltaHtml(delta(lastv,prevv))+'</div>'+
      '<div class="tnum" style="font-size:20px;font-weight:700;margin-bottom:8px">'+pct(lastv)+'</div>'+sparkline(series,SPARK_COLORS[i])+'</div>';
  }).join("");

  return pageHead("ダッシュボード","最新週："+latest.weekStart+"（全"+weekly.length+"週）"+(latest.source==="api"?"・自動取得":""))+
    cta+
    (alerts?'<div class="stack mb">'+alerts+'</div>':"")+
    '<div class="grid" style="grid-template-columns:repeat(2,1fr);margin-bottom:16px" id="kpi-grid">'+cards+'</div>'+
    '<div class="card mb"><div class="card-h"><h3>'+IC.spark+' 主要レートの推移 <span class="muted fs12" style="font-weight:400">直近'+last8.length+'週</span></h3></div>'+
    '<div class="card-p grid" style="grid-template-columns:repeat(2,1fr)">'+sparks+'</div></div>'+
    '<div class="card"><div class="card-h"><h3>ホーム率のトレンド</h3></div><div class="card-p">'+
    lineChart(last8.map(function(e){return {label:shortDate(e.weekStart),value:weeklyRates(e).homeRate};}), settings.benchmarks.homeRate.good, "目安 "+pct(settings.benchmarks.homeRate.good,0))+'</div></div>';
}

