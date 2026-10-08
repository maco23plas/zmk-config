/* ============================ 画面：投稿 ============================ */
var POST_FORMATS=["リール","カルーセル","フィード単枚","ストーリーズ","ライブ"];
var POST_VERDICTS=["勝ち","普通","負け"];
var POST_NUM=[["views","ビュー数"],["reach","リーチ"],["nonFollowerReachPct","フォロワー外リーチ率（%）"],["videoSec","動画尺（秒）"],["avgWatchSec","平均視聴時間（秒）"],["likes","いいね"],["comments","コメント"],["saves","保存"],["shares","シェア"],["profileVisits","プロフィールアクセス"],["follows","フォロー数"]];
var postEditId=null, postFormOpen=false, postTab="list", postFmtFilter="all", postVerdictFilter="all", postSort={key:"date",dir:"desc"};

function readPostForm(){
  function val(id){ var el=document.getElementById(id); return el?el.value:""; }
  var p={ date:val("p-date"), format:val("p-format"), title:val("p-title"), hook:val("p-hook"), memo:val("p-memo"), verdict:val("p-verdict") };
  POST_NUM.forEach(function(f){ var s=val("p-"+f[0]).trim(); p[f[0]]=s===""?null:Number(s); });
  return p;
}
function postPreview(){
  var p=readPostForm(), r=postRates(p), s=getSettings();
  var host=document.getElementById("post-preview"); if(!host) return;
  var items=[["維持率",r.retentionRate],["いいね率",r.likeRate],["保存率",r.saveRate],["シェア率",r.shareRate],["プロフ率",r.profileVisitRate]];
  host.innerHTML=items.map(function(it){return '<div><div class="pt">'+it[0]+'</div><div class="pv tnum">'+pct(it[1])+'</div></div>';}).join("");
  var sug=suggestVerdict(r,s.verdict), badge=document.getElementById("post-suggest");
  if(badge) badge.innerHTML=sug?'<span class="pill '+(sug==="勝ち候補"?"ok":"bad")+'">サジェスト：'+sug+'</span>':"";
}
function viewPosts(){
  var posts=getPosts();
  var editing=postEditId?posts.filter(function(p){return p.id===postEditId;})[0]:null;
  var head=pageHead("投稿別分析","投稿ごとのレートを自動計算。勝ちパターンをネタ帳として蓄積します。",
    postFormOpen?'<button class="btn ghost" data-act="p-close">'+IC.x+'閉じる</button>':'<button class="btn" data-act="p-new">'+IC.plus+'投稿を追加</button>');

  var form="";
  if(postFormOpen){
    var v=editing||{};
    var fSel=POST_FORMATS.map(function(f){return '<option'+(v.format===f?" selected":"")+'>'+f+'</option>';}).join("");
    var vSel=POST_VERDICTS.map(function(f){return '<option'+((v.verdict||"普通")===f?" selected":"")+'>'+f+'</option>';}).join("");
    var nums=POST_NUM.map(function(f){return '<label class="fld">'+f[1]+'<input type="number" inputmode="decimal" min="0" step="any" id="p-'+f[0]+'" placeholder="—" value="'+(v[f[0]]==null?"":v[f[0]])+'"></label>';}).join("");
    form='<div class="card mb"><div class="card-p">'+
      '<h3 style="font-size:15px;font-weight:600;margin-bottom:14px">'+(editing?"投稿を編集":"投稿を追加")+(editing&&editing.igMediaId?' <span class="pill api">自動取得</span>':"")+'</h3>'+
      '<div class="grid" style="grid-template-columns:repeat(2,1fr)">'+
      '<label class="fld">投稿日<input type="date" id="p-date" value="'+esc(editing?editing.date:todayYmd())+'"></label>'+
      '<label class="fld">形式<select id="p-format">'+fSel+'</select></label>'+
      '<label class="fld" style="grid-column:span 2">企画名<input id="p-title" placeholder="例：朝ルーティン時短術" value="'+esc(v.title||"")+'"></label>'+
      '<label class="fld" style="grid-column:span 2">フック（冒頭文言）<input id="p-hook" placeholder="例：実は9割が損してる朝の3分" value="'+esc(v.hook||"")+'"></label></div>'+
      '<div class="grid mt" style="grid-template-columns:repeat(2,1fr)">'+nums+'</div>'+
      '<div class="preview mt"><div class="flex between items-center" style="margin-bottom:10px"><span class="pt" style="font-weight:600">自動計算レート</span><span id="post-suggest"></span></div>'+
      '<div class="grid" id="post-preview" style="grid-template-columns:repeat(3,1fr);gap:10px 16px"></div></div>'+
      '<div class="grid mt" style="grid-template-columns:160px 1fr">'+
      '<label class="fld">判定（最終）<select id="p-verdict">'+vSel+'</select></label>'+
      '<label class="fld">学びメモ<textarea id="p-memo" placeholder="勝ち/負けの理由、横展開のアイデアなど">'+esc(v.memo||"")+'</textarea></label></div>'+
      '<div class="sticky-save"><button class="btn ghost" data-act="p-close">キャンセル</button><button class="btn lg" data-act="p-save">'+IC.save+(editing?"更新する":"保存する")+'</button></div>'+
      '</div></div>';
  }

  var body="";
  if(posts.length===0&&!postFormOpen){
    var acc=currentAcct(), isApi=acc&&acc.mode==="api";
    body='<div class="empty"><div class="eicon">'+IC.img+'</div><h3>投稿データがありません</h3>'+
      '<p>'+(isApi?"「取り込む」を実行すると期間内の投稿が自動で入ります。":"「投稿を追加」から最初の投稿を記録してください。")+'</p>'+
      '<div class="flex gap8 wrapf mt" style="justify-content:center">'+
      (isApi?'<button class="btn" data-act="open-import">'+IC.cloud+'取り込む</button>':"")+
      '<button class="btn outline" data-act="p-new">'+IC.plus+'投稿を追加</button></div></div>';
  } else if(posts.length>0){
    var wins=posts.filter(function(p){return p.verdict==="勝ち";});
    var tabs='<div class="tabs mb"><button class="'+(postTab==="list"?"active":"")+'" data-act="p-tab" data-tab="list">一覧</button>'+
      '<button class="'+(postTab==="wins"?"active":"")+'" data-act="p-tab" data-tab="wins">勝ちパターン'+(wins.length?" ("+wins.length+")":"")+'</button></div>';
    if(postTab==="list"){
      var withRates=posts.map(function(p){return {post:p,rates:postRates(p)};});
      var filtered=withRates.filter(function(o){
        return (postFmtFilter==="all"||o.post.format===postFmtFilter)&&(postVerdictFilter==="all"||o.post.verdict===postVerdictFilter);
      });
      function cmp(a,b,dir){ if(a==null&&b==null)return 0; if(a==null)return 1; if(b==null)return -1; return dir==="asc"?a-b:b-a; }
      filtered.sort(function(x,y){
        var k=postSort.key,d=postSort.dir;
        if(k==="date") return d==="asc"?x.post.date.localeCompare(y.post.date):y.post.date.localeCompare(x.post.date);
        if(k==="views") return cmp(x.post.views,y.post.views,d);
        return cmp(x.rates[k],y.rates[k],d);
      });
      var fmtOpts=["all"].concat(POST_FORMATS).map(function(f){return '<option value="'+f+'"'+(postFmtFilter===f?" selected":"")+'>'+(f==="all"?"全形式":f)+'</option>';}).join("");
      var vOpts=["all"].concat(POST_VERDICTS).map(function(f){return '<option value="'+f+'"'+(postVerdictFilter===f?" selected":"")+'>'+(f==="all"?"全判定":f)+'</option>';}).join("");
      function sh(label,key,align){
        return '<th class="'+(align||"r")+'"><button class="sortbtn" data-act="p-sort" data-key="'+key+'">'+label+(postSort.key===key?(postSort.dir==="asc"?" ▲":" ▼"):"")+'</button></th>';
      }
      var rateCols=[["retentionRate","維持率"],["likeRate","いいね率"],["saveRate","保存率"],["shareRate","シェア率"],["profileVisitRate","プロフ率"]];
      var rows=filtered.map(function(o){
        var p=o.post,r=o.rates;
        var vb=p.verdict==="勝ち"?'<span class="pill ok">勝ち</span>':p.verdict==="負け"?'<span class="pill bad">負け</span>':'<span class="pill line">普通</span>';
        var bg=p.verdict==="勝ち"?' style="background:color-mix(in srgb,var(--ok-bg) 45%,transparent)"':p.verdict==="負け"?' style="background:color-mix(in srgb,var(--bad-bg) 45%,transparent)"':"";
        return '<tr'+bg+'><td class="tnum" style="font-weight:500;white-space:nowrap">'+shortDate(p.date)+'</td>'+
          '<td><div style="font-weight:500;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(p.title||"（無題）")+'</div><div class="muted fs12">'+esc(p.format)+(p.igMediaId?" ・auto":"")+'</div></td>'+
          '<td class="r tnum">'+intf(p.views)+'</td>'+
          rateCols.map(function(c){return '<td class="r tnum">'+pct(r[c[0]])+'</td>';}).join("")+
          '<td>'+vb+'</td>'+
          '<td class="r"><div class="flex gap8" style="justify-content:flex-end">'+
          '<button class="btn icon ghost" data-act="p-edit" data-id="'+p.id+'" aria-label="編集">'+IC.pen+'</button>'+
          '<button class="btn icon ghost" data-act="p-del" data-id="'+p.id+'" style="color:var(--bad)" aria-label="削除">'+IC.trash+'</button></div></td></tr>';
      }).join("");
      body=tabs+'<div class="card"><div class="card-h" style="flex-wrap:wrap;gap:12px"><div class="flex gap8 wrapf items-center">'+
        '<select id="p-fmt-filter" style="width:auto;min-width:130px">'+fmtOpts+'</select>'+
        '<select id="p-verdict-filter" style="width:auto;min-width:120px">'+vOpts+'</select>'+
        '<span class="muted fs12 tnum">'+filtered.length+'件</span></div></div>'+
        '<div class="twrap"><table><thead><tr>'+sh("投稿日","date","")+'<th>企画 / 形式</th>'+sh("ビュー","views")+
        rateCols.map(function(c){return sh(c[1],c[0]);}).join("")+'<th>判定</th><th class="r">操作</th></tr></thead><tbody>'+rows+'</tbody></table></div></div>';
    } else {
      if(!wins.length){
        body=tabs+'<div class="empty"><div class="eicon">'+IC.trophy+'</div><h3>勝ち投稿がまだありません</h3><p>判定を「勝ち」にした投稿が、横展開用のネタ帳としてここに並びます。</p></div>';
      } else {
        var cards=wins.map(function(p){
          var r=postRates(p);
          return '<div class="card"><div class="card-p">'+
            '<div class="flex between items-center gap8"><span class="pill ok">勝ち</span><span class="muted fs12">'+esc(p.format)+"・"+shortDate(p.date)+'</span></div>'+
            '<div class="mt"><div style="font-weight:600">'+esc(p.title||"（無題）")+'</div>'+
            (p.hook?'<div class="muted fs13" style="margin-top:2px">フック：'+esc(p.hook)+'</div>':"")+'</div>'+
            '<div class="flex wrapf muted fs12 tnum" style="gap:4px 16px;margin-top:10px"><span>保存 '+pct(r.saveRate)+'</span><span>シェア '+pct(r.shareRate)+'</span><span>維持 '+pct(r.retentionRate)+'</span><span>いいね '+pct(r.likeRate)+'</span></div>'+
            (p.memo?'<p class="fs13" style="background:color-mix(in srgb,var(--muted) 60%,var(--card));border-radius:10px;padding:12px;margin-top:10px">'+esc(p.memo)+'</p>':"")+
            '</div></div>';
        }).join("");
        body=tabs+'<div class="grid" style="grid-template-columns:repeat(2,1fr)">'+cards+'</div>';
      }
    }
  }
  return head+form+body;
}

