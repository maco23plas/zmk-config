/* ============================ ストレージ ============================ */
var NS = "insta-analytics-2026";
var K = {
  accounts: NS+":accounts", current: NS+":current", api: NS+":api",
  settings: NS+":settings", theme: NS+":theme",
  // v1（単一アカウント時代）のキー：初回に移行する
  v1weekly: NS+":weekly", v1posts: NS+":posts", v1checks: NS+":checks"
};
function load(k,def){ try{ var r=localStorage.getItem(k); return r===null?def:JSON.parse(r);}catch(e){ return def; } }
function save(k,v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
function del(k){ try{ localStorage.removeItem(k); }catch(e){} }
function uid(){ return (window.crypto&&crypto.randomUUID)?crypto.randomUUID():"id-"+Date.now()+"-"+Math.floor(Math.random()*1e9); }
function nowISO(){ return new Date().toISOString(); }

var ACCT_COLORS = ["#2f6fed","#17a34a","#d97706","#8b5cf6","#e2557a","#0d9488","#c026d3","#4f46e5"];

function accounts(){ return load(K.accounts, []); }
function saveAccounts(a){ save(K.accounts, a); }
function currentId(){
  var id = load(K.current, null); var list = accounts();
  if (id && list.some(function(a){return a.id===id;})) return id;
  return list.length ? list[0].id : null;
}
function currentAcct(){
  var id=currentId(); if(!id) return null;
  return accounts().filter(function(a){return a.id===id;})[0] || null;
}
function setCurrent(id){ save(K.current, id); }
function addAccount(o){
  var list=accounts();
  o.id = o.id || uid();
  o.color = o.color || ACCT_COLORS[list.length % ACCT_COLORS.length];
  o.createdAt = nowISO();
  list.push(o); saveAccounts(list); setCurrent(o.id);
  return o;
}

function dk(kind){ return NS+":d:"+currentId()+":"+kind; }
function dkOf(id,kind){ return NS+":d:"+id+":"+kind; }
function getWeekly(){ return load(dk("weekly"), []); }
function setWeekly(v){ save(dk("weekly"), v); }
function getPosts(){ return load(dk("posts"), []); }
function setPosts(v){ save(dk("posts"), v); }
function getChecks(){ return load(dk("checks"), []); }
function setChecks(v){ save(dk("checks"), v); }

/* v1 → v2 移行：既存データは「マイアカウント」として引き継ぐ */
function migrate(){
  if (accounts().length) return;
  var w = load(K.v1weekly, null), p = load(K.v1posts, null), c = load(K.v1checks, null);
  if (w || p || c) {
    var acc = addAccount({ name:"マイアカウント", mode:"manual" });
    if (w) save(dkOf(acc.id,"weekly"), w);
    if (p) save(dkOf(acc.id,"posts"), p);
    if (c) save(dkOf(acc.id,"checks"), c);
    del(K.v1weekly); del(K.v1posts); del(K.v1checks);
  }
}

var DEFAULT_SETTINGS = {
  benchmarks: {
    homeRate:{good:.40,warn:.30}, saveRate:{good:.02,warn:.01}, shareRate:{good:.008,warn:.003},
    followerConversionRate:{good:.05,warn:.03}, storyViewRate:{good:.05,warn:.03}, profileVisitRate:{good:.03,warn:.015}
  },
  verdict:{ winSaveRate:.02, winShareRate:.008, loseSaveRate:.005, loseShareRate:.002, loseLikeRate:.015 }
};
function getSettings(){
  var s = load(K.settings, null);
  if(!s) return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  s.benchmarks = Object.assign({}, DEFAULT_SETTINGS.benchmarks, s.benchmarks||{});
  s.verdict = Object.assign({}, DEFAULT_SETTINGS.verdict, s.verdict||{});
  return s;
}

