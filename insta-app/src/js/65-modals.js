/* ============================ 連携モーダル ============================ */
function openConnectModal(fromWizard){
  var cfg=apiCfg();
  var bg=document.createElement("div"); bg.className="modal-bg";
  bg.innerHTML='<div class="modal">'+
    '<h3>Instagramと連携する</h3>'+
    '<p class="sub">Metaのアクセストークンを貼り付けると、権限のあるアカウントが一覧に出ます。トークンは<b>この端末のブラウザ内にだけ</b>保存されます。</p>'+
    '<div class="mt"><label class="fld">アクセストークン'+
    '<textarea id="cm-token" placeholder="EAAG… で始まる長い文字列" style="min-height:88px">'+esc(cfg.token||"")+'</textarea>'+
    '<span class="hint">取得方法：developers.facebook.com → Graph APIエクスプローラ → 権限 instagram_basic / instagram_manage_insights / pages_show_list / pages_read_engagement / business_management を付けて発行（詳しくは設定画面の手順を参照）</span></label></div>'+
    '<div class="mt"><button class="btn block" id="cm-connect">'+IC.link+'接続してアカウントを取得</button></div>'+
    '<div id="cm-result" class="mt"></div>'+
    '<div class="modal-foot"><button class="btn ghost" id="cm-close">閉じる</button></div>'+
    '</div>';
  document.body.appendChild(bg);
  bg.addEventListener("click",function(e){ if(e.target===bg) bg.remove(); });
  bg.querySelector("#cm-close").addEventListener("click",function(){ bg.remove(); if(fromWizard) render(); });
  bg.querySelector("#cm-connect").addEventListener("click",function(){
    var tokenEl=bg.querySelector("#cm-token"), token=tokenEl.value.trim();
    var out=bg.querySelector("#cm-result");
    if(!token){ out.innerHTML='<p class="fs13" style="color:var(--bad)">トークンを貼り付けてください。</p>'; return; }
    saveApiCfg({token:token, savedAt:nowISO()});
    out.innerHTML='<p class="fs13 muted">接続中…</p>';
    listIgAccounts().then(function(list){
      if(!list.length){ out.innerHTML='<p class="fs13" style="color:var(--bad)">IGプロアカウントが見つかりませんでした。ページ権限とトークンの権限を確認してください。</p>'; return; }
      var existing=accounts();
      out.innerHTML='<div class="fs13" style="font-weight:600;margin-bottom:8px">見つかったアカウント（タップして追加）</div>'+
        '<div class="stack" style="gap:8px">'+list.map(function(a,i){
          var added=existing.some(function(x){return x.igId===a.igId;});
          return '<button class="big-choice" data-ig="'+i+'" '+(added?'disabled style="opacity:.5"':'')+' style="display:flex;align-items:center;gap:12px;width:100%;text-align:left;border:1px solid var(--border);background:var(--card);border-radius:12px;padding:12px;cursor:pointer">'+
            '<span class="avatar" style="width:32px;height:32px;border-radius:999px;background:'+ACCT_COLORS[i%ACCT_COLORS.length]+';color:#fff;display:grid;place-items:center;font-weight:700;font-size:13px;flex:none">'+esc((a.username||"?").slice(0,1).toUpperCase())+'</span>'+
            '<span style="flex:1;min-width:0"><b style="font-size:14px">@'+esc(a.username)+'</b><span class="muted fs12" style="display:block">フォロワー '+intf(a.followers)+(added?"・追加済み":"")+'</span></span>'+
            (added?'<span class="pill ok">✓</span>':'<span class="pill api">追加</span>')+'</button>';
        }).join("")+'</div>';
      out.querySelectorAll("[data-ig]").forEach(function(btn){
        btn.addEventListener("click",function(){
          var a=list[+btn.getAttribute("data-ig")];
          addAccount({ name:"@"+a.username, mode:"api", igId:a.igId, username:a.username, followers:a.followers });
          btn.disabled=true; btn.style.opacity=".5"; btn.querySelector(".pill").outerHTML='<span class="pill ok">✓</span>';
          toast("@"+a.username+" を追加しました");
          render();
        });
      });
    }).catch(function(err){
      out.innerHTML='<p class="fs13" style="color:var(--bad)">'+esc(friendlyApiError(err))+'</p>';
    });
  });
}

/* ============================ 取り込みモーダル ============================ */
function openImportModal(){
  var acc=currentAcct();
  if(!acc||acc.mode!=="api"){ toast("このアカウントは手動入力です"); return; }
  var bg=document.createElement("div"); bg.className="modal-bg";
  var w1=weekRange(1), w2=weekRange(2), w0=weekRange(0);
  bg.innerHTML='<div class="modal">'+
    '<h3>'+IC.cloud.replace('width:16px','')+' データを取り込む</h3>'+
    '<p class="sub">@'+esc(acc.username||acc.name)+' のインサイトを取得して、週次と投稿に自動入力します。</p>'+
    '<div class="mt stack" style="gap:8px">'+
    '<button class="choice on" data-w="1">先週（'+w1.label+'）</button>'+
    '<button class="choice" data-w="2">2週前（'+w2.label+'）</button>'+
    '<button class="choice" data-w="0">今週の途中経過（'+w0.label+'）</button>'+
    '</div>'+
    '<div class="mt" id="im-body"><button class="btn block lg" id="im-go">'+IC.cloud+'取り込みを開始</button></div>'+
    '<div class="modal-foot"><button class="btn ghost" id="im-close">閉じる</button></div>'+
    '</div>';
  document.body.appendChild(bg);
  var selOffset=1;
  bg.querySelectorAll("[data-w]").forEach(function(b){
    b.addEventListener("click",function(){
      bg.querySelectorAll("[data-w]").forEach(function(x){x.classList.remove("on");});
      b.classList.add("on"); selOffset=+b.getAttribute("data-w");
    });
  });
  bg.addEventListener("click",function(e){ if(e.target===bg) bg.remove(); });
  bg.querySelector("#im-close").addEventListener("click",function(){ bg.remove(); });
  bg.querySelector("#im-go").addEventListener("click",function(){
    var body=bg.querySelector("#im-body");
    body.innerHTML='<div class="fs13 muted" id="im-step">開始します…</div><div class="progress mt"><div id="im-bar" style="width:0%"></div></div>';
    importWeek(acc, selOffset, function(step,pctv){
      var s=bg.querySelector("#im-step"), b=bg.querySelector("#im-bar");
      if(s) s.textContent=step; if(b) b.style.width=pctv+"%";
    }).then(function(res){
      body.innerHTML='<div class="fs13" style="font-weight:700;color:var(--ok)">✓ 取り込み完了（週：'+esc(res.weekStart)+'）</div>'+
        '<div class="fs13 mt">自動入力：'+res.filled.map(function(f){return '<span class="pill ok" style="margin:2px">'+esc(f)+'</span>';}).join("")+
        (res.posts?'<span class="pill api" style="margin:2px">投稿 '+res.posts+'件</span>':"")+'</div>'+
        (res.missing.length?'<div class="fs13 mt">手入力で補完：'+res.missing.map(function(f){return '<span class="pill warn" style="margin:2px">'+esc(f)+'</span>';}).join("")+'</div>':"")+
        '<div class="mt flex gap8 wrapf"><button class="btn" id="im-fill">残りを入力する</button><button class="btn outline" id="im-done">閉じる</button></div>';
      bg.querySelector("#im-done").addEventListener("click",function(){ bg.remove(); render(); });
      bg.querySelector("#im-fill").addEventListener("click",function(){
        bg.remove();
        editWeekStart=res.weekStart; weeklyFormOpen=true;
        navigate("weekly"); render();
      });
    }).catch(function(err){
      body.innerHTML='<p class="fs13" style="color:var(--bad)">'+esc(friendlyApiError(err))+'</p>'+
        '<div class="mt"><button class="btn outline" id="im-retry">やり直す</button></div>';
      bg.querySelector("#im-retry").addEventListener("click",function(){ bg.remove(); openImportModal(); });
    });
  });
}

/* ============================ アカウント追加モーダル（手動） ============================ */
function openManualAddModal(){
  var bg=document.createElement("div"); bg.className="modal-bg";
  bg.innerHTML='<div class="modal"><h3>手動アカウントを追加</h3>'+
    '<p class="sub">連携できないアカウントは、数値を手で入力して管理します。あとから連携に切り替えることもできます。</p>'+
    '<div class="mt"><label class="fld">アカウント名<input id="ma-name" placeholder="例：@client_shop / 自社アカウント"></label></div>'+
    '<div class="modal-foot"><button class="btn ghost" data-c="x">キャンセル</button><button class="btn" id="ma-add">追加する</button></div></div>';
  document.body.appendChild(bg);
  bg.addEventListener("click",function(e){ if(e.target===bg||e.target.getAttribute("data-c")==="x") bg.remove(); });
  var input=bg.querySelector("#ma-name"); input.focus();
  function doAdd(){
    var name=input.value.trim();
    if(!name){ input.focus(); return; }
    addAccount({name:name, mode:"manual"});
    bg.remove(); toast("「"+name+"」を追加しました"); render();
  }
  bg.querySelector("#ma-add").addEventListener("click",doAdd);
  input.addEventListener("keydown",function(e){ if(e.key==="Enter") doAdd(); });
}

/* ============================ アカウント切替チップ選択モーダル不要：チップ直押し ============================ */
function acctBarHtml(){
  var list=accounts(), cur=currentId();
  if(!list.length) return "";
  return '<div class="acct-bar">'+list.map(function(a){
    var initial=(a.username||a.name||"?").replace("@","").slice(0,1).toUpperCase();
    return '<button class="acct-chip'+(a.id===cur?" on":"")+'" data-act="switch-acct" data-id="'+a.id+'">'+
      '<span class="avatar" style="background:'+a.color+'">'+esc(initial)+'</span>'+esc(a.name)+
      '<span class="mode-tag '+(a.mode==="api"?"api":"manual")+'">'+(a.mode==="api"?"連携":"手動")+'</span></button>';
  }).join("")+'<button class="acct-chip add" data-act="add-acct">'+IC.plus+' 追加</button></div>';
}

