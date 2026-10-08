/* ============================ 画面：週次 ============================ */
var WEEKLY_SECTIONS=[
  {t:"フォロワー", fields:[["followersStart","週初フォロワー数"],["newFollowers","新規フォロワー数（純増）"]]},
  {t:"投稿量", fields:[["posts","投稿数"],["stories","ストーリーズ本数"]]},
  {t:"リーチ・ビュー", fields:[["views","ビュー数"],["reach","リーチ"],["followerReach","うちフォロワーリーチ"],["storyViews","ストーリーズ閲覧（平均）"]]},
  {t:"アクション", fields:[["profileVisits","プロフィールアクセス"],["saves","保存"],["shares","シェア（送信）"]]},
  {t:"成果", fields:[["linkClicks","外部リンククリック"],["conversions","CV数"]]}
];
var WEEKLY_FIELDS=[]; WEEKLY_SECTIONS.forEach(function(s){ s.fields.forEach(function(f){ WEEKLY_FIELDS.push(f); }); });
var weeklyFormOpen=false, editWeekStart=null, weeklyChartKey="homeRate";

function readWeeklyForm(){
  var e={ weekStart:(document.getElementById("f-weekStart")||{}).value||"" };
  WEEKLY_FIELDS.forEach(function(f){ var el=document.getElementById("f-"+f[0]); var v=el?el.value.trim():""; e[f[0]]=v===""?null:Number(v); });
  return e;
}
function weeklyPreview(){
  var e=readWeeklyForm(), r=weeklyRates(e);
  var host=document.getElementById("weekly-preview"); if(!host) return;
  host.innerHTML=RATE_META.map(function(m){return '<div><div class="pt">'+m.label+'</div><div class="pv tnum">'+pct(r[m.key])+'</div></div>';}).join("");
}
function viewWeekly(){
  var acc=currentAcct(), weekly=getWeekly(), settings=getSettings();
  var isApi=acc&&acc.mode==="api";
  var asc=weekly.slice().sort(function(a,b){return a.weekStart.localeCompare(b.weekStart);});
  var desc=weekly.slice().sort(function(a,b){return b.weekStart.localeCompare(a.weekStart);});
  var editing=editWeekStart?weekly.filter(function(w){return w.weekStart===editWeekStart;})[0]:null;

  var actions=(weeklyFormOpen?'<button class="btn ghost" data-act="w-close">'+IC.x+'閉じる</button>'
    :(isApi?'<button class="btn outline" data-act="open-import" style="margin-right:8px">'+IC.cloud+'取り込む</button>':"")+
     '<button class="btn" data-act="w-new">'+IC.plus+'週を追加</button>');
  var head=pageHead("週次分析","数値を入れると10種のレートが自動計算。未入力・分母ゼロは「—」になります。",actions);

  var form="";
  if(weeklyFormOpen){
    var v=editing||{};
    var prevWeek=null;
    if(editing){ var idx=asc.findIndex(function(x){return x.weekStart===editing.weekStart;}); if(idx>0) prevWeek=asc[idx-1]; }
    else if(asc.length) prevWeek=asc[asc.length-1];
    var defDate=editing?editing.weekStart:ymd(weekRange(1).since);
    var secs=WEEKLY_SECTIONS.map(function(s){
      return '<div class="fsec"><div class="fsec-t">'+s.t+'</div><div class="grid" style="grid-template-columns:repeat(2,1fr)">'+
        s.fields.map(function(f){
          var ph=prevWeek&&prevWeek[f[0]]!=null?"前週 "+prevWeek[f[0]]:"—";
          return '<label class="fld">'+f[1]+'<input type="number" inputmode="decimal" min="0" step="any" id="f-'+f[0]+'" placeholder="'+esc(ph)+'" value="'+(v[f[0]]==null?"":v[f[0]])+'"></label>';
        }).join("")+'</div></div>';
    }).join("");
    form='<div class="card mb"><div class="card-p">'+
      '<h3 style="font-size:15px;font-weight:600;margin-bottom:14px">'+(editing?"週次データを編集":"週次データを追加")+(editing&&editing.source==="api"?' <span class="pill api">自動取得ぶんを補完中</span>':"")+'</h3>'+
      '<div class="stack" id="weekly-fields" style="gap:12px">'+
      '<label class="fld" style="max-width:220px">週開始日（月曜）<input type="date" id="f-weekStart" value="'+esc(defDate)+'"'+(editing?" disabled":"")+'></label>'+
      secs+
      '<div class="preview"><div class="pt" style="margin-bottom:10px;font-weight:600">自動計算レート（入力すると即反映）</div>'+
      '<div class="grid" id="weekly-preview" style="grid-template-columns:repeat(2,1fr);gap:10px 16px"></div></div>'+
      '</div>'+
      '<div class="sticky-save"><button class="btn ghost" data-act="w-close">キャンセル</button>'+
      '<button class="btn lg" data-act="w-save">'+IC.save+(editing?"更新する":"保存する")+'</button></div>'+
      '</div></div>';
  }

  var body="";
  if(weekly.length===0&&!weeklyFormOpen){
    body='<div class="empty"><div class="eicon">'+IC.cal+'</div><h3>週次データがありません</h3>'+
      '<p>'+(isApi?"「取り込む」で自動入力するか、「週を追加」で手入力できます。":"「週を追加」から最初の1週を入力してください。")+'</p>'+
      '<div class="flex gap8 wrapf mt" style="justify-content:center">'+
      (isApi?'<button class="btn" data-act="open-import">'+IC.cloud+'取り込む</button>':"")+
      '<button class="btn outline" data-act="w-new">'+IC.plus+'週を追加</button></div></div>';
  } else if(weekly.length>0){
    var mSel=RATE_META.map(function(m){return '<option value="'+m.key+'"'+(m.key===weeklyChartKey?" selected":"")+'>'+m.label+'</option>';}).join("");
    var cm=RATE_META.filter(function(m){return m.key===weeklyChartKey;})[0];
    var bench=cm.bk?settings.benchmarks[cm.bk].good:null;
    var series=asc.map(function(e){return {label:shortDate(e.weekStart),value:weeklyRates(e)[weeklyChartKey]};});
    var chart=asc.length>=2?lineChart(series,bench,bench!=null?"目安 "+pct(bench,0):"目安"):'<p class="muted fs13" style="text-align:center;padding:32px 0">2週以上のデータでグラフを表示します。</p>';
    var rows=desc.map(function(e){
      var r=weeklyRates(e);
      return '<tr><td class="tnum" style="font-weight:500;white-space:nowrap">'+shortDate(e.weekStart)+(e.source==="api"?' <span class="pill api" style="font-size:10px;padding:0 6px">auto</span>':"")+'</td>'+
        ["homeRate","saveRate","shareRate","followerConversionRate","profileVisitRate","storyViewRate","linkCtr","conversionRate"].map(function(k){return '<td class="r tnum">'+pct(r[k])+'</td>';}).join("")+
        '<td class="r"><div class="flex gap8" style="justify-content:flex-end">'+
        '<button class="btn icon ghost" data-act="w-edit" data-ws="'+e.weekStart+'" aria-label="編集">'+IC.pen+'</button>'+
        '<button class="btn icon ghost" data-act="w-del" data-id="'+e.id+'" style="color:var(--bad)" aria-label="削除">'+IC.trash+'</button></div></td></tr>';
    }).join("");
    body='<div class="card mb"><div class="card-h"><h3>レート推移</h3><select id="weekly-chart-key" style="width:auto;min-width:180px">'+mSel+'</select></div>'+
      '<div class="card-p">'+chart+'</div></div>'+
      '<div class="card"><div class="card-h"><h3>週一覧（新しい順）</h3></div><div class="twrap"><table><thead><tr>'+
      '<th>週</th><th class="r">ホーム率</th><th class="r">保存率</th><th class="r">シェア率</th><th class="r">転換率</th><th class="r">プロフ率</th><th class="r">ストーリーズ</th><th class="r">CTR</th><th class="r">成約率</th><th class="r">操作</th>'+
      '</tr></thead><tbody>'+rows+'</tbody></table></div></div>';
  }
  return head+form+body;
}

