/* ============================ 週レンジ ============================ */
function weekRange(offset){ // offset=1: 先週, 2: 2週前, 0: 今週(途中)
  var now=new Date(), day=(now.getDay()+6)%7; // 月=0
  var mon=new Date(now.getFullYear(),now.getMonth(),now.getDate()-day-7*offset);
  var end=new Date(mon.getFullYear(),mon.getMonth(),mon.getDate()+7);
  return { since:mon, untilEx:end, label: ymd(mon)+" 〜 "+ymd(new Date(end.getTime()-86400000)) };
}

/* ============================ 取り込み本体 ============================ */
function importWeek(acc, offset, onStep){
  var r=weekRange(offset);
  var sinceSec=Math.floor(r.since.getTime()/1000), untilSec=Math.floor(r.untilEx.getTime()/1000);
  var result={ weekStart: ymd(r.since), filled:[], missing:[], posts:0 };

  onStep("アカウント指標を取得中…", 10);
  return fetchAccountWeek(acc.igId, sinceSec, untilSec).then(function(totals){
    onStep("フォロワー推移を取得中…", 30);
    return sumSeries(acc.igId,"follower_count",sinceSec,untilSec).then(function(newFollowers){
      return gfetch("/"+acc.igId+"?fields=followers_count").then(function(prof){
        onStep("投稿一覧を取得中…", 45);
        return fetchMedia(acc.igId,sinceSec,untilSec).then(function(medias){
          // 投稿インサイトを順に取得
          var posts=getPosts();
          var chain=Promise.resolve();
          var weekSaves=0, weekShares=0, hasMediaAgg=medias.length>0;
          medias.forEach(function(m,idx){
            chain=chain.then(function(){
              onStep("投稿を取り込み中… "+(idx+1)+"/"+medias.length, 45+Math.round(45*(idx+1)/Math.max(1,medias.length)));
              var isReel=m.media_product_type==="REELS";
              return fetchMediaInsights(m.id,isReel).then(function(ins){
                weekSaves += (ins.saved||0); weekShares += (ins.shares||0);
                var fmt = isReel?"リール":(m.media_type==="CAROUSEL_ALBUM"?"カルーセル":"フィード単枚");
                var entry={
                  igMediaId:m.id,
                  date:(m.timestamp||"").slice(0,10)||result.weekStart,
                  format:fmt,
                  title:((m.caption||"").split("\n")[0]||"（キャプションなし）").slice(0,40),
                  hook:"",
                  views:ins.views!=null?ins.views:null,
                  reach:ins.reach!=null?ins.reach:null,
                  nonFollowerReachPct:null,
                  videoSec:null,
                  avgWatchSec:(isReel&&ins.ig_reels_avg_watch_time!=null)?Math.round(ins.ig_reels_avg_watch_time)/1000:null,
                  likes:m.like_count!=null?m.like_count:null,
                  comments:m.comments_count!=null?m.comments_count:null,
                  saves:ins.saved!=null?ins.saved:null,
                  shares:ins.shares!=null?ins.shares:null,
                  profileVisits:ins.profile_visits!=null?ins.profile_visits:null,
                  follows:ins.follows!=null?ins.follows:null,
                  memo:"", verdict:"普通",
                  permalink:m.permalink||""
                };
                var i=posts.findIndex(function(x){return x.igMediaId===m.id;});
                if(i>=0){ // 再取り込み：数値だけ更新、判定・メモ・手入力は残す
                  ["views","reach","likes","comments","saves","shares","profileVisits","follows","avgWatchSec"].forEach(function(kk){
                    if(entry[kk]!=null) posts[i][kk]=entry[kk];
                  });
                  posts[i].updatedAt=nowISO();
                } else {
                  entry.id=uid(); entry.createdAt=nowISO(); entry.updatedAt=nowISO();
                  posts.push(entry);
                }
                result.posts++;
              });
            });
          });
          return chain.then(function(){
            setPosts(posts);
            onStep("週次データを保存中…", 95);
            // 週次エントリを組み立て（取れない項目は null のまま＝手入力欄）
            var followersNow=(prof&&!prof.error&&prof.followers_count!=null)?prof.followers_count:acc.followers||null;
            var e={
              weekStart:result.weekStart,
              followersStart: followersNow!=null&&newFollowers!=null ? followersNow-newFollowers : followersNow,
              newFollowers:newFollowers,
              posts:medias.length,
              stories:null,
              views: totals.views!=null?totals.views:null,
              reach: totals.reach!=null?totals.reach:null,
              followerReach:null,
              profileVisits:null,
              saves: totals.saves!=null?totals.saves:(hasMediaAgg?weekSaves:null),
              shares: totals.shares!=null?totals.shares:(hasMediaAgg?weekShares:null),
              linkClicks: totals.profile_links_taps!=null?totals.profile_links_taps:null,
              storyViews:null,
              conversions:null
            };
            var weekly=getWeekly();
            var wi=weekly.findIndex(function(x){return x.weekStart===e.weekStart;});
            if(wi>=0){
              Object.keys(e).forEach(function(kk){ if(e[kk]!=null) weekly[wi][kk]=e[kk]; });
              weekly[wi].updatedAt=nowISO(); weekly[wi].source="api";
            } else {
              e.id=uid(); e.createdAt=nowISO(); e.updatedAt=nowISO(); e.source="api";
              weekly.push(e);
            }
            setWeekly(weekly);
            // 埋まった/欠けの一覧
            var labelMap={views:"ビュー数",reach:"リーチ",saves:"保存",shares:"シェア",linkClicks:"リンクタップ",newFollowers:"新規フォロワー",followersStart:"週初フォロワー",posts:"投稿数"};
            Object.keys(labelMap).forEach(function(kk){ if(e[kk]!=null) result.filled.push(labelMap[kk]); });
            [["stories","ストーリーズ本数"],["storyViews","ストーリーズ閲覧"],["followerReach","フォロワーリーチ"],["profileVisits","プロフィールアクセス"],["conversions","CV数"]]
              .forEach(function(pair){ if(e[pair[0]]==null) result.missing.push(pair[1]); });
            if(e.linkClicks==null) result.missing.push("外部リンククリック");
            onStep("完了", 100);
            return result;
          });
        });
      });
    });
  });
}

