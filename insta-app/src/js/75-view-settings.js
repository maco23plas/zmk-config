/* ============================ 画面：設定 ============================ */
var BENCH_ROWS=[["homeRate","ホーム率"],["saveRate","保存率"],["shareRate","シェア率"],["followerConversionRate","フォロワー転換率"],["storyViewRate","ストーリーズ閲覧率"],["profileVisitRate","プロフアクセス率"]];
var VERDICT_ROWS=[["winSaveRate","勝ち：保存率 ≥"],["winShareRate","勝ち：シェア率 ≥"],["loseSaveRate","負け：保存率 <"],["loseShareRate","負け：シェア率 <"],["loseLikeRate","負け：いいね率 <"]];
function toPctN(r){ return Math.round(r*1000)/10; }
function viewSettings(){
  var s=getSettings(), list=accounts(), cfg=apiCfg();
  var head=pageHead("設定","アカウント・連携・目安値・データ管理。すべてこの端末の中だけに保存されます。");

  var acctRows=list.map(function(a){
    return '<div class="flex between items-center" style="padding:10px 0;border-bottom:1px solid var(--border)">'+
      '<div class="flex items-center gap12"><span class="avatar" style="width:32px;height:32px;border-radius:999px;background:'+a.color+';color:#fff;display:grid;place-items:center;font-weight:700;font-size:13px">'+esc((a.username||a.name||"?").replace("@","").slice(0,1).toUpperCase())+'</span>'+
      '<div><b style="font-size:14px">'+esc(a.name)+'</b> <span class="mode-tag '+(a.mode==="api"?"api":"manual")+'">'+(a.mode==="api"?"連携":"手動")+'</span>'+
      (a.followers?'<div class="muted fs12 tnum">フォロワー '+intf(a.followers)+'</div>':"")+'</div></div>'+
      '<button class="btn icon ghost" data-act="acct-del" data-id="'+a.id+'" style="color:var(--bad)" aria-label="削除">'+IC.trash+'</button></div>';
  }).join("");

  var acctCard='<div class="card mb"><div class="card-p">'+
    '<h3 style="font-size:15px;font-weight:600">アカウント管理</h3>'+
    '<p class="muted fs13" style="margin:6px 0 10px">連携できるアカウントは「Instagram連携」から、できないアカウントは「手動追加」で。</p>'+
    (acctRows||'<p class="muted fs13">アカウントがありません。</p>')+
    '<div class="flex gap8 wrapf mt">'+
    '<button class="btn" data-act="open-connect">'+IC.link+'Instagram連携でアカウント追加</button>'+
    '<button class="btn outline" data-act="add-manual">'+IC.plus+'手動アカウントを追加</button></div></div></div>';

  var tokenInfo=cfg.token?('保存済み（'+(cfg.savedAt?cfg.savedAt.slice(0,10):"")+' 登録・約60日で要更新）'):"未設定";
  var apiCard='<div class="card mb"><div class="card-p">'+
    '<h3 style="font-size:15px;font-weight:600">Instagram連携（Graph API）</h3>'+
    '<p class="muted fs13" style="margin:6px 0 10px">アクセストークン：'+esc(tokenInfo)+'。トークンはこの端末のブラウザ内にのみ保存され、外部には送信されません（Meta APIとの通信を除く）。</p>'+
    '<details class="fs13" style="margin-bottom:10px"><summary style="cursor:pointer;font-weight:600">トークンの取り方（クリックで開く）</summary>'+
    '<ol style="margin:8px 0 0;padding-left:20px;line-height:1.9">'+
    '<li>developers.facebook.com でアプリを作成（開発モードのままでOK・審査不要）</li>'+
    '<li>ツール > Graph APIエクスプローラ を開き、自分のアプリを選択</li>'+
    '<li>権限に instagram_basic / instagram_manage_insights / pages_show_list / pages_read_engagement / business_management を追加して「Generate Access Token」</li>'+
    '<li>出てきたトークンを「連携」画面に貼り付け</li></ol>'+
    '<p class="muted" style="margin-top:6px">※取得できるのはプロアカウント＋あなたがページ権限を持つアカウントのみ。トークンは約60日で切れるので、切れたら同じ手順で再発行してください。</p></details>'+
    '<button class="btn outline" data-act="open-connect">'+IC.link+'トークンを設定 / アカウントを取得</button></div></div>';

  var benchRows=BENCH_ROWS.map(function(row){
    return '<div class="grid" style="grid-template-columns:1fr 90px 90px;gap:12px 16px;align-items:center">'+
      '<label class="fs13" style="font-weight:500">'+row[1]+'</label>'+
      '<input type="number" min="0" step="any" class="r" data-bench="'+row[0]+'" data-field="good" value="'+toPctN(s.benchmarks[row[0]].good)+'">'+
      '<input type="number" min="0" step="any" class="r" data-bench="'+row[0]+'" data-field="warn" value="'+toPctN(s.benchmarks[row[0]].warn)+'"></div>';
  }).join("");
  var verdictRows=VERDICT_ROWS.map(function(row){
    return '<div class="grid" style="grid-template-columns:1fr 90px;gap:12px 16px;align-items:center">'+
      '<label class="fs13" style="font-weight:500">'+row[1]+'</label>'+
      '<input type="number" min="0" step="any" class="r" data-verdict="'+row[0]+'" value="'+toPctN(s.verdict[row[0]])+'"></div>';
  }).join("");

  return head+acctCard+apiCard+
    '<div class="card mb"><div class="card-p"><h3 style="font-size:15px;font-weight:600">目安値（ベンチマーク）</h3>'+
    '<p class="muted fs13" style="margin:6px 0 14px">達成以上=緑、注意以上=黄、未満=赤。単位は%。全アカウント共通。</p>'+
    '<div class="grid" style="grid-template-columns:1fr 90px 90px;gap:8px 16px;margin-bottom:6px"><span class="muted fs12" style="font-weight:600">指標</span><span class="muted fs12 r" style="font-weight:600">達成(%)</span><span class="muted fs12 r" style="font-weight:600">注意(%)</span></div>'+
    '<div class="stack" style="gap:10px">'+benchRows+'</div></div></div>'+
    '<div class="card mb"><div class="card-p"><h3 style="font-size:15px;font-weight:600">勝ち／負け判定サジェストのしきい値</h3>'+
    '<p class="muted fs13" style="margin:6px 0 14px">投稿別分析の「勝ち候補／負け候補」バッジの基準。単位は%。</p>'+
    '<div class="stack" style="gap:10px">'+verdictRows+'</div></div></div>'+
    '<div class="flex gap8 wrapf mb"><button class="btn" data-act="s-save">'+IC.save+'設定を保存</button>'+
    '<button class="btn outline" data-act="s-reset">'+IC.reset+'初期値に戻す</button></div>'+
    '<div class="card"><div class="card-p"><h3 style="font-size:15px;font-weight:600">データ管理</h3>'+
    '<p class="muted fs13" style="margin:6px 0 14px">バックアップ・移行・CSV出力・全削除（全アカウントぶん）。</p>'+
    '<div class="flex gap8 wrapf mb"><button class="btn outline" data-act="ex-json">'+IC.dl+'全データJSON書き出し</button>'+
    '<button class="btn outline" data-act="im-json">'+IC.ul+'JSON読み込み</button></div>'+
    '<div class="flex gap8 wrapf mb"><button class="btn outline" data-act="ex-weekly">'+IC.dl+'週次CSV（現在のアカウント）</button>'+
    '<button class="btn outline" data-act="ex-posts">'+IC.dl+'投稿別CSV（現在のアカウント）</button></div>'+
    '<div style="padding-top:8px;border-top:1px solid var(--border)"><button class="btn bad" data-act="clear-all">'+IC.trash+'全データを削除</button></div>'+
    '</div></div>';
}

