/* ============================ レンダリング ============================ */
function render(){
  var r=parseHash(), host=document.getElementById("view");
  if(!accounts().length){
    host.innerHTML=viewWizard();
    document.getElementById("acct-host").innerHTML="";
    renderChrome();
    return;
  }
  document.getElementById("acct-host").innerHTML=acctBarHtml();
  var html;
  if(r.path==="dashboard") html=viewDashboard();
  else if(r.path==="weekly") html=viewWeekly();
  else if(r.path==="posts") html=viewPosts();
  else if(r.path==="diagnosis") html=viewDiagnosis(r.params);
  else if(r.path==="kpis") html=viewKpis();
  else html=viewSettings();
  host.innerHTML=html;
  renderChrome();
  if(r.path==="weekly"&&weeklyFormOpen){ weeklyPreview(); var wf=document.getElementById("weekly-fields"); if(wf) wf.addEventListener("input",weeklyPreview); }
  if(r.path==="posts"&&postFormOpen){ postPreview(); POST_NUM.forEach(function(f){ var el=document.getElementById("p-"+f[0]); if(el) el.addEventListener("input",postPreview); }); }
}

/* ============================ イベント ============================ */
document.addEventListener("click",function(e){
  var t=e.target.closest("[data-act]"); if(!t) return;
  var act=t.getAttribute("data-act");

  if(act==="theme"){ toggleTheme(); return; }

  /* ウィザード */
  if(act==="wiz-api"){ openConnectModal(true); return; }
  if(act==="wiz-manual"){ openManualAddModal(); return; }
  if(act==="wiz-sample"){
    addAccount({name:"サンプル",mode:"manual"});
    seedInto(); render(); toast("サンプルデータを入れました。自由に触ってみてください");
    return;
  }

  /* アカウント */
  if(act==="switch-acct"){ setCurrent(t.getAttribute("data-id")); weeklyFormOpen=false; postFormOpen=false; editWeekStart=null; postEditId=null; render(); return; }
  if(act==="add-acct"){
    // 選択肢：連携 or 手動
    var bg=document.createElement("div"); bg.className="modal-bg";
    bg.innerHTML='<div class="modal"><h3>アカウントを追加</h3><div class="stack mt">'+
      '<button class="big-choice" data-w="api" style="display:flex;align-items:center;gap:14px;width:100%;text-align:left;border:1px solid var(--border);background:var(--card);border-radius:14px;padding:16px;cursor:pointer"><span style="width:40px;height:40px;border-radius:12px;background:var(--accent-bg);color:var(--primary);display:grid;place-items:center;flex:none">'+IC.link+'</span><span><b>Instagram連携で追加</b><p class="muted fs12" style="margin-top:2px">数値を自動で取り込めます</p></span></button>'+
      '<button class="big-choice" data-w="manual" style="display:flex;align-items:center;gap:14px;width:100%;text-align:left;border:1px solid var(--border);background:var(--card);border-radius:14px;padding:16px;cursor:pointer"><span style="width:40px;height:40px;border-radius:12px;background:var(--muted);color:var(--muted-ink);display:grid;place-items:center;flex:none">'+IC.keyb+'</span><span><b>手動アカウントを追加</b><p class="muted fs12" style="margin-top:2px">連携できないアカウントはこちら</p></span></button>'+
      '</div><div class="modal-foot"><button class="btn ghost" data-w="x">閉じる</button></div></div>';
    document.body.appendChild(bg);
    bg.addEventListener("click",function(ev){
      var b=ev.target.closest("[data-w]");
      if(ev.target===bg){ bg.remove(); return; }
      if(!b) return;
      var w=b.getAttribute("data-w"); bg.remove();
      if(w==="api") openConnectModal(false);
      else if(w==="manual") openManualAddModal();
    });
    return;
  }
  if(act==="acct-del"){
    var aid=t.getAttribute("data-id");
    var a=accounts().filter(function(x){return x.id===aid;})[0];
    confirmModal("「"+(a?a.name:"")+"」を削除しますか？","このアカウントの週次・投稿・チェックの記録もすべて消えます。元に戻せません。","削除する",function(){
      saveAccounts(accounts().filter(function(x){return x.id!==aid;}));
      del(dkOf(aid,"weekly")); del(dkOf(aid,"posts")); del(dkOf(aid,"checks"));
      if(currentId()===null||load(K.current,null)===aid){ var rest=accounts(); if(rest.length) setCurrent(rest[0].id); else del(K.current); }
      render(); toast("削除しました");
    });
    return;
  }
  if(act==="open-connect"){ openConnectModal(false); return; }
  if(act==="add-manual"){ openManualAddModal(); return; }
  if(act==="open-import"){ openImportModal(); return; }

  if(act==="seed"){ seedInto(); render(); toast("サンプルデータを入れました"); return; }
  if(act==="go-diag"){ diagKpi=null; diagState=null; navigate("diagnosis",{kpi:t.getAttribute("data-kpi"),state:t.getAttribute("data-state")||"減った"}); return; }
  if(act==="w-new-go"){ weeklyFormOpen=true; editWeekStart=null; navigate("weekly"); render(); return; }

  /* 週次 */
  if(act==="w-new"){ editWeekStart=null; weeklyFormOpen=true; render(); return; }
  if(act==="w-close"){ weeklyFormOpen=false; editWeekStart=null; render(); return; }
  if(act==="w-edit"){ editWeekStart=t.getAttribute("data-ws"); weeklyFormOpen=true; render(); window.scrollTo({top:0,behavior:"smooth"}); return; }
  if(act==="w-del"){
    var wid=t.getAttribute("data-id");
    var weekly=getWeekly(); var item=weekly.filter(function(x){return x.id===wid;})[0];
    confirmModal("この週のデータを削除しますか？","","削除する",function(){
      setWeekly(getWeekly().filter(function(x){return x.id!==wid;}));
      lastDeleted={kind:"weekly",item:item};
      render();
      toast("削除しました","元に戻す",function(){
        if(lastDeleted&&lastDeleted.kind==="weekly"){ var w2=getWeekly(); w2.push(lastDeleted.item); setWeekly(w2); lastDeleted=null; render(); }
      });
    });
    return;
  }
  if(act==="w-save"){
    var e2=readWeeklyForm();
    if(!e2.weekStart&&editWeekStart) e2.weekStart=editWeekStart;
    if(!e2.weekStart){ toast("週開始日を入力してください"); return; }
    var list2=getWeekly();
    var idx2=list2.findIndex(function(x){return x.weekStart===e2.weekStart;});
    var wasEdit=!!editWeekStart;
    if(idx2>=0){
      Object.keys(e2).forEach(function(kk){ list2[idx2][kk]=e2[kk]; });
      list2[idx2].updatedAt=nowISO();
    } else {
      e2.id=uid(); e2.createdAt=nowISO(); e2.updatedAt=nowISO();
      list2.push(e2);
    }
    setWeekly(list2); weeklyFormOpen=false; editWeekStart=null; render(); toast(wasEdit?"更新しました":"保存しました");
    return;
  }

  /* 投稿 */
  if(act==="p-new"){ postEditId=null; postFormOpen=true; postTab="list"; render(); return; }
  if(act==="p-close"){ postFormOpen=false; postEditId=null; render(); return; }
  if(act==="p-edit"){ postEditId=t.getAttribute("data-id"); postFormOpen=true; render(); window.scrollTo({top:0,behavior:"smooth"}); return; }
  if(act==="p-del"){
    var pid=t.getAttribute("data-id");
    var posts=getPosts(); var pitem=posts.filter(function(x){return x.id===pid;})[0];
    confirmModal("この投稿を削除しますか？","","削除する",function(){
      setPosts(getPosts().filter(function(x){return x.id!==pid;}));
      lastDeleted={kind:"post",item:pitem};
      render();
      toast("削除しました","元に戻す",function(){
        if(lastDeleted&&lastDeleted.kind==="post"){ var p2=getPosts(); p2.push(lastDeleted.item); setPosts(p2); lastDeleted=null; render(); }
      });
    });
    return;
  }
  if(act==="p-tab"){ postTab=t.getAttribute("data-tab"); render(); return; }
  if(act==="p-sort"){ var k2=t.getAttribute("data-key"); if(postSort.key===k2){ postSort.dir=postSort.dir==="asc"?"desc":"asc"; } else { postSort.key=k2; postSort.dir="desc"; } render(); return; }
  if(act==="p-save"){
    var p3=readPostForm(); if(!p3.date){ toast("投稿日を入力してください"); return; }
    var plist=getPosts();
    if(postEditId){
      var pi=plist.findIndex(function(x){return x.id===postEditId;});
      if(pi>=0){ var keep=plist[pi]; Object.keys(p3).forEach(function(kk){ keep[kk]=p3[kk]; }); keep.updatedAt=nowISO(); }
      toast("更新しました");
    } else {
      p3.id=uid(); p3.createdAt=nowISO(); p3.updatedAt=nowISO(); plist.push(p3);
      toast("保存しました");
    }
    setPosts(plist); postFormOpen=false; postEditId=null; render();
    return;
  }

  /* 診断 */
  if(act==="d-kpi"){ diagKpi=t.getAttribute("data-kpi"); diagState=null; render(); return; }
  if(act==="d-state"){ diagState=t.getAttribute("data-state"); render(); return; }
  if(act==="d-reset"){ diagKpi=null; diagState=null; render(); return; }
  if(act==="d-check"){
    var did=+t.getAttribute("data-id"); var checks=getChecks();
    if(checks.some(function(c){return c.diagnosisId===did;})) checks=checks.filter(function(c){return c.diagnosisId!==did;});
    else checks.push({diagnosisId:did,checkedAt:nowISO()});
    setChecks(checks); render(); return;
  }

  if(act==="k-tab"){ kpiTab=t.getAttribute("data-tab"); render(); return; }

  /* 設定 */
  if(act==="s-save"){
    var s=getSettings();
    document.querySelectorAll("[data-bench]").forEach(function(el){ var b=el.getAttribute("data-bench"),f=el.getAttribute("data-field"); var n=Number(el.value); s.benchmarks[b][f]=isFinite(n)?n/100:0; });
    document.querySelectorAll("[data-verdict]").forEach(function(el){ var v=el.getAttribute("data-verdict"); var n=Number(el.value); s.verdict[v]=isFinite(n)?n/100:0; });
    save(K.settings,s); toast("設定を保存しました");
    return;
  }
  if(act==="s-reset"){ save(K.settings,JSON.parse(JSON.stringify(DEFAULT_SETTINGS))); render(); toast("初期値に戻しました"); return; }
  if(act==="ex-json"){ download("insta-analytics-"+todayYmd()+".json", JSON.stringify(exportAll(),null,2), "application/json"); return; }
  if(act==="im-json"){ document.getElementById("file-input").click(); return; }
  if(act==="ex-weekly"){ download("weekly-"+todayYmd()+".csv", weeklyCsv(), "text/csv;charset=utf-8"); return; }
  if(act==="ex-posts"){ download("posts-"+todayYmd()+".csv", postsCsv(), "text/csv;charset=utf-8"); return; }
  if(act==="clear-all"){
    confirmModal("すべてのデータを削除しますか？","全アカウントの週次・投稿・チェック・連携設定が消えます。元に戻せません。先にJSON書き出しをおすすめします。","すべて削除する",function(){
      accounts().forEach(function(a){ del(dkOf(a.id,"weekly")); del(dkOf(a.id,"posts")); del(dkOf(a.id,"checks")); });
      del(K.accounts); del(K.current); del(K.api); save(K.settings,JSON.parse(JSON.stringify(DEFAULT_SETTINGS)));
      render(); toast("全データを削除しました");
    });
    return;
  }
});

document.addEventListener("change",function(e){
  var el=e.target;
  if(el.id==="weekly-chart-key"){ weeklyChartKey=el.value; render(); return; }
  if(el.id==="p-fmt-filter"){ postFmtFilter=el.value; render(); return; }
  if(el.id==="p-verdict-filter"){ postVerdictFilter=el.value; render(); return; }
  if(el.id==="file-input"){
    var file=el.files&&el.files[0]; if(!file) return;
    var reader=new FileReader();
    reader.onload=function(){
      try{
        var ok=importAll(JSON.parse(String(reader.result)));
        render(); toast(ok?"データを読み込みました":"対応していない形式です");
      }catch(err){ toast("読み込みに失敗しました（JSON形式を確認）"); }
    };
    reader.readAsText(file); el.value="";
  }
});

window.addEventListener("hashchange",function(){ weeklyFormOpen=false; postFormOpen=false; editWeekStart=null; postEditId=null; render(); });

