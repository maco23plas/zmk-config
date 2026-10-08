/* ============================ CSV / バックアップ ============================ */
function csvCell(v){ if(v==null) return ""; var s=String(v); return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s; }
function toCsv(rows){ return "﻿"+rows.map(function(r){return r.map(csvCell).join(",");}).join("\r\n"); }
function rp(v){ return v==null?"":(v*100).toFixed(2); }
function weeklyCsv(){
  var h=["週開始日","週初フォロワー数","新規フォロワー","投稿数","ストーリーズ本数","ビュー数","リーチ","フォロワーリーチ","プロフィールアクセス","保存","シェア","外部リンククリック","ストーリーズ閲覧","CV数","ホーム率%","保存率%","シェア率%","転換率%","プロフ率%","ストーリーズ閲覧率%","CTR%","成約率%"];
  var rows=getWeekly().slice().sort(function(a,b){return b.weekStart.localeCompare(a.weekStart);}).map(function(e){
    var r=weeklyRates(e);
    return [e.weekStart,e.followersStart,e.newFollowers,e.posts,e.stories,e.views,e.reach,e.followerReach,e.profileVisits,e.saves,e.shares,e.linkClicks,e.storyViews,e.conversions,rp(r.homeRate),rp(r.saveRate),rp(r.shareRate),rp(r.followerConversionRate),rp(r.profileVisitRate),rp(r.storyViewRate),rp(r.linkCtr),rp(r.conversionRate)];
  });
  return toCsv([h].concat(rows));
}
function postsCsv(){
  var h=["投稿日","形式","企画名","フック","判定","ビュー数","リーチ","いいね","コメント","保存","シェア","プロフィールアクセス","フォロー数","維持率%","いいね率%","保存率%","シェア率%","プロフ率%","学びメモ"];
  var rows=getPosts().slice().sort(function(a,b){return b.date.localeCompare(a.date);}).map(function(p){
    var r=postRates(p);
    return [p.date,p.format,p.title,p.hook,p.verdict,p.views,p.reach,p.likes,p.comments,p.saves,p.shares,p.profileVisits,p.follows,rp(r.retentionRate),rp(r.likeRate),rp(r.saveRate),rp(r.shareRate),rp(r.profileVisitRate),p.memo];
  });
  return toCsv([h].concat(rows));
}
function download(name,text,mime){
  var blob=new Blob([text],{type:mime||"text/plain;charset=utf-8"});
  var url=URL.createObjectURL(blob), a=document.createElement("a");
  a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}
function exportAll(){
  var accs=accounts(), data={};
  accs.forEach(function(a){
    data[a.id]={ weekly:load(dkOf(a.id,"weekly"),[]), posts:load(dkOf(a.id,"posts"),[]), checks:load(dkOf(a.id,"checks"),[]) };
  });
  return { app:"インスタ分析思考2026", version:2, exportedAt:nowISO(), accounts:accs, current:currentId(), settings:getSettings(), data:data };
}
function importAll(b){
  if(b.version===2 && Array.isArray(b.accounts)){
    saveAccounts(b.accounts);
    if(b.current) setCurrent(b.current);
    if(b.settings) save(K.settings,b.settings);
    Object.keys(b.data||{}).forEach(function(id){
      var d=b.data[id];
      if(d.weekly) save(dkOf(id,"weekly"),d.weekly);
      if(d.posts) save(dkOf(id,"posts"),d.posts);
      if(d.checks) save(dkOf(id,"checks"),d.checks);
    });
    return true;
  }
  // v1形式：現在のアカウント（なければ新規）に読み込み
  if(Array.isArray(b.weekly)||Array.isArray(b.posts)){
    if(!accounts().length) addAccount({name:"マイアカウント",mode:"manual"});
    if(Array.isArray(b.weekly)) setWeekly(b.weekly);
    if(Array.isArray(b.posts)) setPosts(b.posts);
    if(Array.isArray(b.checks)) setChecks(b.checks);
    if(b.settings) save(K.settings,b.settings);
    return true;
  }
  return false;
}

/* ============================ サンプルデータ ============================ */
function seedInto(){
  var now=nowISO();
  function w(ws,o){ o.id=uid(); o.weekStart=ws; o.createdAt=now; o.updatedAt=now; return o; }
  setWeekly([
    w("2026-07-06",{followersStart:5000,newFollowers:120,posts:5,stories:20,views:40000,reach:22000,followerReach:9700,profileVisits:900,saves:480,shares:130,linkClicks:210,storyViews:260,conversions:6}),
    w("2026-07-13",{followersStart:5120,newFollowers:90,posts:4,stories:18,views:35000,reach:19000,followerReach:7900,profileVisits:700,saves:300,shares:80,linkClicks:150,storyViews:210,conversions:3}),
    w("2026-07-20",{followersStart:5210,newFollowers:150,posts:6,stories:24,views:52000,reach:27000,followerReach:12400,profileVisits:1100,saves:700,shares:90,linkClicks:300,storyViews:320,conversions:9})
  ]);
  function p(o){ o.id=uid(); o.createdAt=now; o.updatedAt=now; return o; }
  setPosts([
    p({date:"2026-07-20",format:"リール",title:"朝ルーティン時短術",hook:"実は9割が損してる朝の3分",views:60000,reach:42000,nonFollowerReachPct:78,videoSec:30,avgWatchSec:18,likes:1500,comments:90,saves:1400,shares:620,profileVisits:900,follows:210,verdict:"勝ち",memo:"冒頭2秒の損失フックが効いた。同型でシリーズ化する。"}),
    p({date:"2026-07-18",format:"カルーセル",title:"保存版・便利家電100選",hook:"永久保存推奨のまとめ",views:22000,reach:20000,nonFollowerReachPct:45,videoSec:null,avgWatchSec:null,likes:380,comments:25,saves:900,shares:120,profileVisits:400,follows:60,verdict:"勝ち",memo:"枚数多め×まとめ企画は保存に強い。100選フォーマットを横展開。"}),
    p({date:"2026-07-16",format:"リール",title:"失敗あるある集",hook:"共感しかないやつ",views:45000,reach:33000,nonFollowerReachPct:70,videoSec:25,avgWatchSec:11,likes:900,comments:60,saves:500,shares:400,profileVisits:500,follows:90,verdict:"勝ち",memo:"「送りたくなる」あるある系はシェアが伸びる。維持率は要改善。"}),
    p({date:"2026-07-14",format:"ストーリーズ",title:"アンケート企画",hook:"AとBどっち派？",views:3000,reach:2900,nonFollowerReachPct:5,videoSec:null,avgWatchSec:null,likes:0,comments:0,saves:20,shares:15,profileVisits:60,follows:5,verdict:"普通",memo:"2択は反応率高め。親密度シグナル狙いで継続。"}),
    p({date:"2026-07-12",format:"フィード単枚",title:"新商品告知",hook:"ついに発売しました",views:8000,reach:7500,nonFollowerReachPct:20,videoSec:null,avgWatchSec:null,likes:100,comments:12,saves:35,shares:10,profileVisits:120,follows:8,verdict:"負け",memo:"告知単体は広告感が強く伸びにくい。ベネフィット訴求へ作り替える。"})
  ]);
}

