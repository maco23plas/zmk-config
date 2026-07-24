/**
 * ============================================================
 * インスタ分析 自動取得（Instagram Graph API → Googleスプレッドシート）
 * ============================================================
 * 運用代行向け：あなたのFacebookアカウントが権限を持つ
 * 全ページ／IGプロアカウントのインサイトを自動取得し、
 * RAW_ タブ3枚（アカウント週次／投稿別／ストーリーズ）に追記します。
 *
 * 使い方は同梱の SETUP.md を参照。
 * 1) 初回：メニュー「📊 インスタ自動取得」→「① 初期設定（トークン登録）」
 * 2) テスト：「② 今すぐ取得（前週分）」
 * 3) 自動化：「③ トリガー設置（毎日+毎週）」
 *
 * 触ってよい定数は CONFIG のみ。既存の分析シートには一切書き込みません。
 */

var CONFIG = {
  API_VERSION: "v23.0",        // Graph API バージョン（動かなくなったら上げる）
  WEEK_STARTS_MONDAY: true,    // 週の開始を月曜にする（分析シートに合わせる）
  CAPTION_MAX: 60,             // 投稿キャプションの保存文字数
  SHEET_WEEKLY: "RAW_アカウント週次",
  SHEET_POSTS: "RAW_投稿",
  SHEET_STORIES: "RAW_ストーリーズ",
  SHEET_LOG: "RAW_ログ"
};

/* ------------------------------------------------------------
 * メニュー
 * ---------------------------------------------------------- */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("📊 インスタ自動取得")
    .addItem("① 初期設定（トークン登録）", "setupToken")
    .addItem("② 今すぐ取得（前週分）", "runWeekly")
    .addItem("③ トリガー設置（毎日+毎週）", "installTriggers")
    .addSeparator()
    .addItem("接続テスト（アカウント一覧）", "testConnection")
    .addItem("今日のストーリーズだけ取得", "runDailyStories")
    .addItem("トークンを今すぐ延長", "refreshToken")
    .addToUi();
}

/* ------------------------------------------------------------
 * ① 初期設定：短期トークンを長期(約60日)に交換して保存
 * ---------------------------------------------------------- */
function setupToken() {
  var ui = SpreadsheetApp.getUi();
  var r1 = ui.prompt("初期設定 1/3", "MetaアプリのアプリID を貼り付けてください", ui.ButtonSet.OK_CANCEL);
  if (r1.getSelectedButton() !== ui.Button.OK) return;
  var r2 = ui.prompt("初期設定 2/3", "Metaアプリの app secret を貼り付けてください", ui.ButtonSet.OK_CANCEL);
  if (r2.getSelectedButton() !== ui.Button.OK) return;
  var r3 = ui.prompt(
    "初期設定 3/3",
    "Graph APIエクスプローラで発行したユーザートークンを貼り付けてください\n" +
    "（必要な権限: instagram_basic, instagram_manage_insights, pages_show_list, pages_read_engagement, business_management）",
    ui.ButtonSet.OK_CANCEL
  );
  if (r3.getSelectedButton() !== ui.Button.OK) return;

  var props = PropertiesService.getScriptProperties();
  props.setProperty("FB_APP_ID", r1.getResponseText().trim());
  props.setProperty("FB_APP_SECRET", r2.getResponseText().trim());
  props.setProperty("FB_TOKEN", r3.getResponseText().trim());

  var ok = exchangeToken_();
  if (ok) {
    ui.alert("設定完了", "長期トークン（約60日・自動延長あり）を保存しました。\n次は「接続テスト」を実行してください。", ui.ButtonSet.OK);
  } else {
    ui.alert("トークン交換に失敗しました。RAW_ログ を確認してください。");
  }
}

/** 手持ちトークンを長期トークンに交換して保存し直す（週次トリガーからも呼ばれる） */
function refreshToken() { exchangeToken_(); }

function exchangeToken_() {
  var props = PropertiesService.getScriptProperties();
  var url = base_() + "/oauth/access_token" +
    "?grant_type=fb_exchange_token" +
    "&client_id=" + encodeURIComponent(props.getProperty("FB_APP_ID")) +
    "&client_secret=" + encodeURIComponent(props.getProperty("FB_APP_SECRET")) +
    "&fb_exchange_token=" + encodeURIComponent(props.getProperty("FB_TOKEN"));
  try {
    var res = JSON.parse(UrlFetchApp.fetch(url, { muteHttpExceptions: true }).getContentText());
    if (res.access_token) {
      props.setProperty("FB_TOKEN", res.access_token);
      props.setProperty("FB_TOKEN_AT", new Date().toISOString());
      log_("トークン延長OK（有効期限 約" + Math.round((res.expires_in || 5184000) / 86400) + "日）");
      return true;
    }
    log_("トークン交換エラー: " + JSON.stringify(res));
    return false;
  } catch (e) {
    log_("トークン交換例外: " + e);
    return false;
  }
}

/* ------------------------------------------------------------
 * ③ トリガー設置
 * ---------------------------------------------------------- */
function installTriggers() {
  // 二重登録を防ぐため、このスクリプトの既存トリガーを一旦全削除
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  // 毎日 21時台：当日のストーリーズ取得（24時間で消えるため毎日必須）
  ScriptApp.newTrigger("runDailyStories").timeBased().everyDays(1).atHour(21).create();
  // 毎週 月曜 7時台：前週(月〜日)の週次+投稿別を取得
  ScriptApp.newTrigger("runWeekly").timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(7).create();
  // 毎週 水曜 6時台：トークン自動延長
  ScriptApp.newTrigger("refreshToken").timeBased().onWeekDay(ScriptApp.WeekDay.WEDNESDAY).atHour(6).create();
  SpreadsheetApp.getUi().alert("トリガーを設置しました。\n・毎日21時台: ストーリーズ\n・毎週月曜7時台: 週次+投稿\n・毎週水曜: トークン延長");
}

/* ------------------------------------------------------------
 * 接続テスト：権限のあるIGアカウント一覧を表示
 * ---------------------------------------------------------- */
function testConnection() {
  var accounts = igAccounts_();
  var msg = accounts.length === 0
    ? "IGアカウントが見つかりません。ページ権限とトークンの権限を確認してください。"
    : accounts.map(function (a) { return "・" + a.username + "（フォロワー " + a.followers + "）"; }).join("\n");
  SpreadsheetApp.getUi().alert("取得できるアカウント: " + accounts.length + "件\n\n" + msg);
}

/** あなたが権限を持つ ページ→IGプロアカウント を列挙 */
function igAccounts_() {
  var out = [];
  var url = base_() + "/me/accounts?fields=name,instagram_business_account{id,username,followers_count,media_count}&limit=100&access_token=" + token_();
  while (url) {
    var res = fetchJson_(url);
    if (!res || res.error) { log_("me/accounts エラー: " + JSON.stringify(res && res.error)); break; }
    (res.data || []).forEach(function (p) {
      var ig = p.instagram_business_account;
      if (ig) out.push({ pageName: p.name, id: ig.id, username: ig.username || p.name, followers: ig.followers_count || 0 });
    });
    url = res.paging && res.paging.next ? res.paging.next : null;
  }
  return out;
}

/* ------------------------------------------------------------
 * ② 週次実行：前週(月〜日)のアカウント週次＋投稿別
 * ---------------------------------------------------------- */
function runWeekly() {
  var range = lastWeekRange_();
  var accounts = igAccounts_();
  log_("週次取得開始 " + fmtDate_(range.since) + "〜" + fmtDate_(range.until) + " / " + accounts.length + "アカウント");
  accounts.forEach(function (acc) {
    try {
      fetchWeeklyForAccount_(acc, range);
      fetchPostsForAccount_(acc, range);
    } catch (e) {
      log_(acc.username + " でエラー: " + e);
    }
  });
  log_("週次取得完了");
}

/** アカウント単位の週次インサイト → RAW_アカウント週次 */
function fetchWeeklyForAccount_(acc, range) {
  var since = Math.floor(range.since.getTime() / 1000);
  var until = Math.floor(range.untilExclusive.getTime() / 1000);

  // 合計値系（total_value）。廃止で取れない指標は個別に自動スキップされる
  var totals = insightsTotalValue_(acc.id, ["views", "reach", "total_interactions", "accounts_engaged", "profile_links_taps"], since, until);
  // フォロワー日次純増（100人未満のアカウントでは返らないことがある）
  var followerDelta = sumTimeSeries_(acc.id, "follower_count", since, until);

  appendRow_(CONFIG.SHEET_WEEKLY,
    ["取得日時", "アカウント", "IG ID", "週開始", "週終了", "フォロワー数(現在)", "週フォロワー純増",
     "ビュー数", "リーチ", "総インタラクション", "エンゲージしたアカウント", "プロフィールのリンクタップ"],
    [new Date(), acc.username, acc.id, fmtDate_(range.since), fmtDate_(range.until), acc.followers, followerDelta,
     totals.views, totals.reach, totals.total_interactions, totals.accounts_engaged, totals.profile_links_taps]);
}

/** 期間内の投稿とメディアインサイト → RAW_投稿 */
function fetchPostsForAccount_(acc, range) {
  var since = Math.floor(range.since.getTime() / 1000);
  var until = Math.floor(range.untilExclusive.getTime() / 1000);
  var url = base_() + "/" + acc.id + "/media" +
    "?fields=id,caption,media_type,media_product_type,timestamp,permalink,like_count,comments_count" +
    "&since=" + since + "&until=" + until + "&limit=50&access_token=" + token_();

  var medias = [];
  while (url) {
    var res = fetchJson_(url);
    if (!res || res.error) { log_(acc.username + " media エラー: " + JSON.stringify(res && res.error)); break; }
    medias = medias.concat(res.data || []);
    url = res.paging && res.paging.next ? res.paging.next : null;
  }

  medias.forEach(function (m) {
    var isReel = m.media_product_type === "REELS";
    var metrics = isReel
      ? ["views", "reach", "saved", "shares", "total_interactions", "profile_visits", "follows", "ig_reels_avg_watch_time"]
      : ["views", "reach", "saved", "shares", "total_interactions", "profile_visits", "follows"];
    var ins = mediaInsights_(m.id, metrics);
    var avgWatchSec = ins.ig_reels_avg_watch_time !== "" ? Math.round(ins.ig_reels_avg_watch_time) / 1000 : ""; // ms→秒

    appendRow_(CONFIG.SHEET_POSTS,
      ["取得日時", "アカウント", "投稿ID", "投稿日時", "種別", "キャプション冒頭", "リンク",
       "ビュー数", "リーチ", "いいね", "コメント", "保存", "シェア", "総インタラクション",
       "プロフアクセス", "投稿からのフォロー", "リール平均視聴(秒)"],
      [new Date(), acc.username, m.id, m.timestamp ? m.timestamp.replace("T", " ").slice(0, 16) : "",
       m.media_product_type || m.media_type, (m.caption || "").slice(0, CONFIG.CAPTION_MAX), m.permalink || "",
       ins.views, ins.reach, m.like_count || 0, m.comments_count || 0, ins.saved, ins.shares, ins.total_interactions,
       ins.profile_visits, ins.follows, avgWatchSec]);
  });
  log_(acc.username + ": 投稿 " + medias.length + "件を記録");
}

/* ------------------------------------------------------------
 * 毎日実行：公開中ストーリーズ（24時間で消えるため日次で拾う）
 * ---------------------------------------------------------- */
function runDailyStories() {
  var accounts = igAccounts_();
  accounts.forEach(function (acc) {
    try {
      var url = base_() + "/" + acc.id + "/stories?fields=id,timestamp,media_type&limit=50&access_token=" + token_();
      var res = fetchJson_(url);
      if (!res || res.error) { log_(acc.username + " stories エラー: " + JSON.stringify(res && res.error)); return; }
      var recorded = recordedStoryIds_();
      (res.data || []).forEach(function (s) {
        if (recorded.indexOf(s.id) >= 0) return; // 同じストーリーの二重記録を防ぐ
        var ins = mediaInsights_(s.id, ["views", "reach", "replies", "shares", "total_interactions", "profile_visits", "follows", "navigation"]);
        appendRow_(CONFIG.SHEET_STORIES,
          ["取得日時", "アカウント", "ストーリーID", "投稿日時", "閲覧数", "リーチ", "返信(DM)", "シェア",
           "総インタラクション", "プロフアクセス", "フォロー", "ナビゲーション"],
          [new Date(), acc.username, s.id, s.timestamp ? s.timestamp.replace("T", " ").slice(0, 16) : "",
           ins.views, ins.reach, ins.replies, ins.shares, ins.total_interactions, ins.profile_visits, ins.follows, ins.navigation]);
      });
    } catch (e) {
      log_(acc.username + " stories 例外: " + e);
    }
  });
}

function recordedStoryIds_() {
  var sh = sheet_(CONFIG.SHEET_STORIES, null);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 3, sh.getLastRow() - 1, 1).getValues().map(function (r) { return String(r[0]); });
}

/* ------------------------------------------------------------
 * Graph API ヘルパー
 * ---------------------------------------------------------- */
function base_() { return "https://graph.facebook.com/" + CONFIG.API_VERSION; }
function token_() { return encodeURIComponent(PropertiesService.getScriptProperties().getProperty("FB_TOKEN") || ""); }
function fetchJson_(url) {
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  try { return JSON.parse(res.getContentText()); } catch (e) { return { error: { message: "JSON parse失敗: " + res.getContentText().slice(0, 200) } }; }
}

/** アカウント単位 total_value 指標。まとめて失敗したら1個ずつ再試行（廃止指標を自動スキップ） */
function insightsTotalValue_(igId, metrics, since, until) {
  var out = {};
  metrics.forEach(function (m) { out[m] = ""; });
  var got = tryTotalValue_(igId, metrics, since, until);
  if (got) { Object.keys(got).forEach(function (k) { out[k] = got[k]; }); return out; }
  metrics.forEach(function (m) {
    var one = tryTotalValue_(igId, [m], since, until);
    if (one && one[m] !== undefined) out[m] = one[m];
    else log_(igId + " 指標スキップ: " + m);
  });
  return out;
}
function tryTotalValue_(igId, metrics, since, until) {
  var url = base_() + "/" + igId + "/insights?metric=" + metrics.join(",") +
    "&period=day&metric_type=total_value&since=" + since + "&until=" + until + "&access_token=" + token_();
  var res = fetchJson_(url);
  if (!res || res.error) return null;
  var out = {};
  (res.data || []).forEach(function (d) { out[d.name] = (d.total_value && d.total_value.value !== undefined) ? d.total_value.value : ""; });
  return out;
}

/** 日次時系列指標の期間合計（例: follower_count の週間純増） */
function sumTimeSeries_(igId, metric, since, until) {
  var url = base_() + "/" + igId + "/insights?metric=" + metric + "&period=day&since=" + since + "&until=" + until + "&access_token=" + token_();
  var res = fetchJson_(url);
  if (!res || res.error || !res.data || !res.data.length) return "";
  var sum = 0;
  (res.data[0].values || []).forEach(function (v) { sum += (v.value || 0); });
  return sum;
}

/** メディア（投稿/ストーリー）インサイト。まとめて失敗したら1個ずつ（タイプ非対応の指標を自動スキップ） */
function mediaInsights_(mediaId, metrics) {
  var out = {};
  metrics.forEach(function (m) { out[m] = ""; });
  var got = tryMediaInsights_(mediaId, metrics);
  if (got) { Object.keys(got).forEach(function (k) { out[k] = got[k]; }); return out; }
  metrics.forEach(function (m) {
    var one = tryMediaInsights_(mediaId, [m]);
    if (one && one[m] !== undefined) out[m] = one[m];
  });
  return out;
}
function tryMediaInsights_(mediaId, metrics) {
  var url = base_() + "/" + mediaId + "/insights?metric=" + metrics.join(",") + "&access_token=" + token_();
  var res = fetchJson_(url);
  if (!res || res.error) return null;
  var out = {};
  (res.data || []).forEach(function (d) {
    var v = "";
    if (d.values && d.values.length) v = d.values[0].value;
    if (d.total_value && d.total_value.value !== undefined) v = d.total_value.value;
    out[d.name] = v;
  });
  return out;
}

/* ------------------------------------------------------------
 * 日付・シート・ログ ヘルパー
 * ---------------------------------------------------------- */
/** 前週の 月曜00:00 〜 日曜23:59（untilExclusive は翌月曜00:00） */
function lastWeekRange_() {
  var now = new Date();
  var day = now.getDay(); // 0=日
  var sinceOffset = CONFIG.WEEK_STARTS_MONDAY ? ((day + 6) % 7) + 7 : day + 7;
  var since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - sinceOffset);
  var untilExclusive = new Date(since.getFullYear(), since.getMonth(), since.getDate() + 7);
  var until = new Date(untilExclusive.getTime() - 1);
  return { since: since, until: until, untilExclusive: untilExclusive };
}
function fmtDate_(d) { return Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy/MM/dd"); }

function sheet_(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    if (!headers) return null;
    sh = ss.insertSheet(name);
  }
  if (headers && sh.getLastRow() === 0) {
    sh.appendRow(headers);
    sh.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#f0f1f4");
    sh.setFrozenRows(1);
  }
  return sh;
}
function appendRow_(name, headers, row) { sheet_(name, headers).appendRow(row); }
function log_(msg) {
  var sh = sheet_(CONFIG.SHEET_LOG, ["時刻", "メッセージ"]);
  sh.appendRow([new Date(), String(msg).slice(0, 500)]);
}
