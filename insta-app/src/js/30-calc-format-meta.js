/* ============================ 計算・フォーマット ============================ */
function ratio(n,d){ if(n==null||d==null) return null; if(d===0) return null; if(!isFinite(n)||!isFinite(d)) return null; return n/d; }
function sub(a,b){ if(a==null||b==null) return null; return a-b; }
function weeklyRates(e){
  return {
    followerGrowth: ratio(e.newFollowers, e.followersStart),
    homeRate: ratio(e.followerReach, e.followersStart),
    nonFollowerReachRate: ratio(sub(e.reach,e.followerReach), e.reach),
    profileVisitRate: ratio(e.profileVisits, e.reach),
    followerConversionRate: ratio(e.newFollowers, e.profileVisits),
    saveRate: ratio(e.saves, e.reach),
    shareRate: ratio(e.shares, e.reach),
    linkCtr: ratio(e.linkClicks, e.profileVisits),
    storyViewRate: ratio(e.storyViews, e.followersStart),
    conversionRate: ratio(e.conversions, e.linkClicks)
  };
}
function postRates(p){
  return {
    retentionRate: ratio(p.avgWatchSec, p.videoSec),
    likeRate: ratio(p.likes, p.views),
    saveRate: ratio(p.saves, p.views),
    shareRate: ratio(p.shares, p.views),
    profileVisitRate: ratio(p.profileVisits, p.views)
  };
}
function suggestVerdict(r,t){
  if((r.saveRate!=null && r.saveRate>=t.winSaveRate)||(r.shareRate!=null && r.shareRate>=t.winShareRate)) return "勝ち候補";
  if(r.saveRate!=null && r.shareRate!=null && r.likeRate!=null){
    if(r.saveRate<t.loseSaveRate && r.shareRate<t.loseShareRate && r.likeRate<t.loseLikeRate) return "負け候補";
  }
  return null;
}
function rateStatus(v,good,warn){ if(v==null) return "none"; if(v>=good) return "good"; if(v>=warn) return "warn"; return "bad"; }
function pct(v,d){ if(v==null||!isFinite(v)) return "—"; return (v*100).toFixed(d===undefined?1:d)+"%"; }
function intf(v){ if(v==null||!isFinite(v)) return "—"; return Math.round(v).toLocaleString("ja-JP"); }
function shortDate(iso){ if(!iso) return "—"; var p=String(iso).split("-"); if(p.length<3) return iso; return (+p[1])+"/"+(+p[2].slice(0,2)); }
function delta(c,p){ if(c==null||p==null) return null; return c-p; }
function deltaHtml(d){
  if(d==null||!isFinite(d)) return '<span class="delta flat tnum">—</span>';
  var pts=d*100, abs=Math.abs(pts).toFixed(1);
  if(Math.abs(pts)<0.05) return '<span class="delta flat tnum">±0.0 pt</span>';
  if(pts>0) return '<span class="delta up">'+IC.tup+'<span class="tnum">'+abs+' pt</span></span>';
  return '<span class="delta down">'+IC.tdown+'<span class="tnum">'+abs+' pt</span></span>';
}
function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];}); }
function ymd(d){ var m=("0"+(d.getMonth()+1)).slice(-2), dd=("0"+d.getDate()).slice(-2); return d.getFullYear()+"-"+m+"-"+dd; }
function todayYmd(){ return ymd(new Date()); }

/* ============================ メタ ============================ */
var RATE_META = [
  {key:"homeRate",label:"ホーム率",bm:"40〜50%",bk:"homeRate",dk:"リーチ",ds:"減った"},
  {key:"saveRate",label:"保存率",bm:"1%〜（2〜3%で優秀）",bk:"saveRate",dk:"保存率",ds:"減った"},
  {key:"shareRate",label:"シェア率",bm:"0.3〜1%で強い",bk:"shareRate",dk:"シェア率（送信）",ds:"低い"},
  {key:"followerConversionRate",label:"フォロワー転換率",bm:"5〜8%以上",bk:"followerConversionRate",dk:"フォロワー転換率",ds:"減った"},
  {key:"profileVisitRate",label:"プロフアクセス率",bm:"フィード3%〜",bk:"profileVisitRate",dk:"プロフアクセス率",ds:"減った"},
  {key:"storyViewRate",label:"ストーリーズ閲覧率",bm:"規模別3〜10%",bk:"storyViewRate",dk:"ストーリーズ閲覧率",ds:"減った"},
  {key:"nonFollowerReachRate",label:"フォロワー外リーチ率",bm:"認知目的で50〜70%",bk:null,dk:null,ds:null},
  {key:"linkCtr",label:"リンクCTR",bm:"1〜3%",bk:null,dk:"リンクCTR",ds:"減った"},
  {key:"conversionRate",label:"成約率",bm:"EC通説1〜3%",bk:null,dk:"成約率",ds:"減った"},
  {key:"followerGrowth",label:"フォロワー増加率",bm:"月2〜5%",bk:null,dk:null,ds:null}
];
var BENCH_META = RATE_META.filter(function(m){return m.bk;});
var SPARK_KEYS = ["homeRate","saveRate","shareRate","followerConversionRate"];
var SPARK_COLORS = ["var(--c1)","var(--c2)","var(--c3)","var(--c4)"];
var DIAG_KPIS = ["リーチ","プロフアクセス率","フォロワー転換率","保存率","シェア率（送信）","リンクCTR","ストーリーズ閲覧率","成約率"];
function statesFor(kpi){ var s=[]; DATA.diagnosis.forEach(function(d){ if(d.kpi===kpi&&s.indexOf(d.state)<0)s.push(d.state); }); return s; }
function diagFor(kpi,state){ return DATA.diagnosis.filter(function(d){return d.kpi===kpi&&d.state===state;}); }

