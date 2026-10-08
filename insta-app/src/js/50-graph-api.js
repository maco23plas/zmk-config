/* ============================ Graph API クライアント ============================ */
var GRAPH = "https://graph.facebook.com/v23.0";
function apiCfg(){ return load(K.api, {token:"",savedAt:null}); }
function saveApiCfg(c){ save(K.api, c); }

function gfetch(pathOrUrl){
  var url = pathOrUrl.indexOf("http")===0 ? pathOrUrl : GRAPH + pathOrUrl +
    (pathOrUrl.indexOf("?")>=0 ? "&" : "?") + "access_token=" + encodeURIComponent(apiCfg().token);
  return fetch(url).then(function(r){ return r.json(); }).catch(function(e){ return {error:{message:String(e)}}; });
}
function gAll(path){ // ページネーションを全部たどる
  var out=[];
  function step(url){
    return gfetch(url).then(function(res){
      if(!res || res.error) return Promise.reject(res && res.error ? res.error.message : "通信エラー");
      out = out.concat(res.data||[]);
      if(res.paging && res.paging.next) return step(res.paging.next);
      return out;
    });
  }
  return step(path);
}
function friendlyApiError(msg){
  msg = String(msg||"");
  if(/expired|invalid|session/i.test(msg)) return "トークンが無効か期限切れのようです。設定 > Instagram連携 でトークンを更新してください。";
  if(/permission|scope/i.test(msg)) return "権限が不足しています。トークンに instagram_manage_insights 等の権限が付いているか確認してください。";
  return "取得に失敗しました：" + msg.slice(0,200);
}

/** 権限のあるIGプロアカウント一覧 */
function listIgAccounts(){
  return gAll("/me/accounts?fields=name,instagram_business_account{id,username,followers_count}&limit=100")
    .then(function(pages){
      return pages.filter(function(p){return p.instagram_business_account;}).map(function(p){
        var ig=p.instagram_business_account;
        return { igId: ig.id, username: ig.username || p.name, followers: ig.followers_count||0, pageName: p.name };
      });
    });
}

/** アカウント週次インサイト（取れない指標は黙ってスキップ） */
function fetchAccountWeek(igId, sinceSec, untilSec){
  var metrics=["views","reach","total_interactions","saves","shares","profile_links_taps"];
  var url="/"+igId+"/insights?metric="+metrics.join(",")+"&period=day&metric_type=total_value&since="+sinceSec+"&until="+untilSec;
  return gfetch(url).then(function(res){
    if(res && !res.error){
      var out={}; (res.data||[]).forEach(function(d){ out[d.name]=(d.total_value&&d.total_value.value!==undefined)?d.total_value.value:null; });
      return out;
    }
    // まとめて失敗 → 1個ずつ
    var out2={};
    var chain=Promise.resolve();
    metrics.forEach(function(m){
      chain=chain.then(function(){
        return gfetch("/"+igId+"/insights?metric="+m+"&period=day&metric_type=total_value&since="+sinceSec+"&until="+untilSec)
          .then(function(r2){ if(r2&&!r2.error&&r2.data&&r2.data.length){ var d=r2.data[0]; out2[m]=(d.total_value&&d.total_value.value!==undefined)?d.total_value.value:null; } });
      });
    });
    return chain.then(function(){ return out2; });
  });
}
/** 日次時系列の合計（フォロワー純増など） */
function sumSeries(igId, metric, sinceSec, untilSec){
  return gfetch("/"+igId+"/insights?metric="+metric+"&period=day&since="+sinceSec+"&until="+untilSec)
    .then(function(res){
      if(!res||res.error||!res.data||!res.data.length) return null;
      var sum=0; (res.data[0].values||[]).forEach(function(v){ sum+=(v.value||0); });
      return sum;
    });
}
/** メディア一覧（期間内） */
function fetchMedia(igId, sinceSec, untilSec){
  return gAll("/"+igId+"/media?fields=id,caption,media_type,media_product_type,timestamp,permalink,like_count,comments_count&since="+sinceSec+"&until="+untilSec+"&limit=50");
}
/** メディア単位インサイト */
function fetchMediaInsights(mediaId, isReel){
  var metrics = isReel
    ? ["views","reach","saved","shares","profile_visits","follows","ig_reels_avg_watch_time"]
    : ["views","reach","saved","shares","profile_visits","follows"];
  return gfetch("/"+mediaId+"/insights?metric="+metrics.join(",")).then(function(res){
    var out={};
    if(res && !res.error){
      (res.data||[]).forEach(function(d){
        var v=null;
        if(d.values&&d.values.length) v=d.values[0].value;
        if(d.total_value&&d.total_value.value!==undefined) v=d.total_value.value;
        out[d.name]=v;
      });
      return out;
    }
    // 個別リトライ（タイプ非対応の指標をスキップ）
    var chain=Promise.resolve();
    metrics.forEach(function(m){
      chain=chain.then(function(){
        return gfetch("/"+mediaId+"/insights?metric="+m).then(function(r2){
          if(r2&&!r2.error&&r2.data&&r2.data.length){
            var d=r2.data[0], v=null;
            if(d.values&&d.values.length) v=d.values[0].value;
            if(d.total_value&&d.total_value.value!==undefined) v=d.total_value.value;
            out[m]=v;
          }
        });
      });
    });
    return chain.then(function(){ return out; });
  });
}

