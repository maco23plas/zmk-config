/**
 * ============================================================
 *  エルメ（L Message）QRコード別 流入計測 & 毎日レポート配信ツール
 * ============================================================
 *
 *  できること（すべて無料枠のみで動作）:
 *   1. 【本命】エルメ公式「パラメーターエクスポート」の受け口
 *      … 各QRコードアクションの「外部連携」タブにこのGASのURLを
 *        コールバックURLとして登録すると、QR経由で友だち追加される
 *        たびにエルメがGETリクエストを送ってくる → 実登録をQR別に記録
 *   2. 【代替】QRコード別のクリック（読み取り→遷移）を記録するリダイレクタ
 *      … エルメの流入経路URLの「手前」にこのGASを挟んで計測します
 *   3. スプレッドシートに時系列でログを蓄積
 *   4. 毎日決まった時刻に Discord / Chatwork へ集計レポートを自動配信
 *
 *  セットアップ手順は同梱の README.md を参照してください。
 * ============================================================
 */

// ────────────────────────────────────────────
// ★ 設定（ここだけ書き換えれば動きます）
// ────────────────────────────────────────────
const CONFIG = {
  // ① 計測したいQRコード。id は短い英数字で自由に決める。
  //    url には「エルメのQRコードアクションで発行された友だち追加URL」を貼る。
  QR_CODES: {
    affi_01: { name: 'TTM様 アフィ_01', url: 'https://s.lmes.jp/landing-qr/xxxxxxxx?uLand=xxxxxx' },
    affi_02: { name: 'TTM様 アフィ_02', url: 'https://s.lmes.jp/landing-qr/xxxxxxxx?uLand=xxxxxx' },
    affi_03: { name: 'TTM様 アフィ_03', url: 'https://s.lmes.jp/landing-qr/xxxxxxxx?uLand=xxxxxx' },
    affi_04: { name: 'TTM様 アフィ_04', url: 'https://s.lmes.jp/landing-qr/xxxxxxxx?uLand=xxxxxx' },
    affi_05: { name: 'TTM様 アフィ_05', url: 'https://s.lmes.jp/landing-qr/xxxxxxxx?uLand=xxxxxx' },
    affi_06: { name: 'TTM様 アフィ_06', url: 'https://s.lmes.jp/landing-qr/xxxxxxxx?uLand=xxxxxx' },
  },

  // ② 配信先（使うものだけ設定。空文字のままなら送信されません）
  DISCORD_WEBHOOK_URL: '',            // 例: 'https://discord.com/api/webhooks/…'
  CHATWORK_API_TOKEN: '',             // Chatwork 個人設定 > API から発行
  CHATWORK_ROOM_ID: '',               // 送りたいルームのID（URLの #!rid の数字）

  // ③ 毎日レポートを送る時刻（0〜23時。setup() 実行時にトリガー登録されます）
  REPORT_HOUR: 9,

  // ④ シート名（通常は変更不要）
  SHEET_CLICKS: 'クリックログ',
  SHEET_REGISTERS: '登録ログ',
  SHEET_DAILY: '日次集計',
};

// ────────────────────────────────────────────
// 初期セットアップ（最初に1回だけ実行する）
// ────────────────────────────────────────────
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // シートを用意
  ensureSheet_(ss, CONFIG.SHEET_CLICKS, ['日時', 'QR ID', 'QR名', 'UserAgent']);
  ensureSheet_(ss, CONFIG.SHEET_REGISTERS, ['日時', 'QR ID', 'QR名', '補足(生データ)']);
  ensureSheet_(ss, CONFIG.SHEET_DAILY, ['日付', 'QR ID', 'QR名', 'クリック数', '登録数']);

  // 既存の日次トリガーを消してから登録し直す（多重登録防止）
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'dailyReport')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('dailyReport')
    .timeBased()
    .atHour(CONFIG.REPORT_HOUR)
    .everyDays(1)
    .create();

  Logger.log('セットアップ完了。毎日 %s 時に dailyReport が実行されます。', CONFIG.REPORT_HOUR);
}

function ensureSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    sh.setFrozenRows(1);
  }
  return sh;
}

// ────────────────────────────────────────────
// Webアプリ入口（用途はURLパラメータで分岐）
//
// ① 実登録の記録（エルメ「パラメーターエクスポート」の受け口）★本命
//    エルメ側の各QRコードアクション >「外部連携」タブ に登録するURL:
//      https://script.google.com/macros/s/XXXX/exec?ev=reg&id=affi_01
//    → QR経由の友だち追加のたびにエルメがGETでLINE ID等を送ってくる
//
// ② クリック計測リダイレクタ（外部連携タブが使えない場合の代替）
//    QRコードの飛び先をこのURLにする:
//      https://script.google.com/macros/s/XXXX/exec?id=affi_01
// ────────────────────────────────────────────
function doGet(e) {
  const p = (e && e.parameter) || {};
  const id = p.id || '';
  const qr = CONFIG.QR_CODES[id];

  // ① パラメーターエクスポート受信（ev=reg）: 実登録をログして終了
  if (p.ev === 'reg') {
    try {
      logRegister_(id, qr ? qr.name : '(未設定:' + id + ')', p);
    } catch (err) {
      console.error('登録ログ記録失敗: ' + err);
    }
    return ContentService.createTextOutput('ok');
  }

  // ② リダイレクタ
  if (qr) {
    try {
      logClick_(id, qr.name);
    } catch (err) {
      // ログ失敗でもユーザーの遷移は止めない
      console.error('クリックログ記録失敗: ' + err);
    }
    // GASのWebアプリは本物の302を返せないため、JS+metaの両方でリダイレクト
    const url = qr.url;
    const html =
      '<!DOCTYPE html><html><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>移動中…</title>' +
      '<meta http-equiv="refresh" content="0; url=' + escapeHtmlAttr_(url) + '">' +
      '</head><body style="font-family:sans-serif;text-align:center;padding-top:3em">' +
      '<p>LINE友だち追加ページへ移動しています…</p>' +
      '<p><a href="' + escapeHtmlAttr_(url) + '">自動で移動しない場合はこちら</a></p>' +
      '<script>window.top.location.replace(' + JSON.stringify(url) + ');</script>' +
      '</body></html>';
    return HtmlService.createHtmlOutput(html)
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  return HtmlService.createHtmlOutput(
    '<p style="font-family:sans-serif">リンクが無効です（idが未設定）。</p>'
  );
}

function logClick_(id, name) {
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ensureSheet_(ss, CONFIG.SHEET_CLICKS, ['日時', 'QR ID', 'QR名', 'UserAgent']);
    sh.appendRow([new Date(), id, name, '']);
  } finally {
    lock.releaseLock();
  }
}

function escapeHtmlAttr_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** 実登録（パラメーターエクスポート等）を登録ログに記録する。
 *  エルメが付けてくるパラメータ名は環境で変わりうるため、全パラメータを
 *  そのままJSONで保存しておく（後から列を分けたくなっても困らない）。 */
function logRegister_(id, name, params) {
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ensureSheet_(ss, CONFIG.SHEET_REGISTERS, ['日時', 'QR ID', 'QR名', '補足(生データ)']);
    sh.appendRow([new Date(), id, name, JSON.stringify(params)]);
  } finally {
    lock.releaseLock();
  }
}

// POSTで送ってくる外部システム向けの受け口（念のため用意。動きはGETと同じ）
function doPost(e) {
  let id = '';
  let raw = '';
  let params = (e && e.parameter) || {};
  try {
    raw = e && e.postData ? e.postData.contents : '';
    const data = raw ? JSON.parse(raw) : {};
    params = Object.assign({}, data, params);
  } catch (err) { /* JSONでないボディはそのまま補足に残す */ }
  id = params.id || '';
  const qr = CONFIG.QR_CODES[id];
  logRegister_(id, qr ? qr.name : '(不明)', raw ? Object.assign({ _body: raw }, params) : params);
  return ContentService.createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ────────────────────────────────────────────
// ③ 毎日レポート（トリガーから自動実行）
// ────────────────────────────────────────────
function dailyReport() {
  const tz = 'Asia/Tokyo';
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const ymd = d => Utilities.formatDate(d, tz, 'yyyy-MM-dd');
  const targetDay = ymd(yesterday);

  const clicks = countByQr_(CONFIG.SHEET_CLICKS, targetDay);
  const clicksTotal = countByQr_(CONFIG.SHEET_CLICKS, null);
  const regs = countByQr_(CONFIG.SHEET_REGISTERS, targetDay);
  const regsTotal = countByQr_(CONFIG.SHEET_REGISTERS, null);

  // 日次集計シートにも書き残す
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const daily = ensureSheet_(ss, CONFIG.SHEET_DAILY, ['日付', 'QR ID', 'QR名', 'クリック数', '登録数']);

  const useRegs = hasRows_(CONFIG.SHEET_REGISTERS);   // 外部連携（実登録）を使っているか
  const useClicks = hasRows_(CONFIG.SHEET_CLICKS);    // リダイレクタ（クリック）を使っているか

  const lines = [];
  lines.push('📊 QRコード流入レポート（' + targetDay + '）');
  lines.push('');
  let dayClickSum = 0;
  let dayRegSum = 0;
  for (const [id, qr] of Object.entries(CONFIG.QR_CODES)) {
    const c = clicks[id] || 0;
    const r = regs[id] || 0;
    dayClickSum += c;
    dayRegSum += r;
    const parts = [];
    if (useRegs) parts.push('登録 ' + r + ' 件（累計 ' + (regsTotal[id] || 0) + '）');
    if (useClicks) parts.push('クリック ' + c + ' 件（累計 ' + (clicksTotal[id] || 0) + '）');
    if (!parts.length) parts.push('登録 0 件');
    lines.push('・' + qr.name + '： ' + parts.join(' ／ '));
    daily.appendRow([targetDay, id, qr.name, c, r]);
  }
  lines.push('');
  const sumParts = [];
  if (useRegs) sumParts.push('登録 ' + dayRegSum + ' 件');
  if (useClicks) sumParts.push('クリック ' + dayClickSum + ' 件');
  lines.push('合計： ' + (sumParts.join(' ／ ') || '登録 0 件'));
  lines.push('シート: ' + ss.getUrl());

  const text = lines.join('\n');
  sendDiscord_(text);
  sendChatwork_(text);
  Logger.log(text);
}

function hasRows_(sheetName) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  return !!sh && sh.getLastRow() > 1;
}

/** 指定日（yyyy-MM-dd、nullなら全期間）のQR IDごとの件数を数える */
function countByQr_(sheetName, day) {
  const tz = 'Asia/Tokyo';
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  const out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  const values = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
  for (const [when, id] of values) {
    if (!(when instanceof Date)) continue;
    if (day && Utilities.formatDate(when, tz, 'yyyy-MM-dd') !== day) continue;
    out[id] = (out[id] || 0) + 1;
  }
  return out;
}

// ────────────────────────────────────────────
// 配信先: Discord（Incoming Webhook・無料）
// ────────────────────────────────────────────
function sendDiscord_(text) {
  if (!CONFIG.DISCORD_WEBHOOK_URL) return;
  UrlFetchApp.fetch(CONFIG.DISCORD_WEBHOOK_URL, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ content: text }),
    muteHttpExceptions: true,
  });
}

// ────────────────────────────────────────────
// 配信先: Chatwork（APIトークン・無料）
// ────────────────────────────────────────────
function sendChatwork_(text) {
  if (!CONFIG.CHATWORK_API_TOKEN || !CONFIG.CHATWORK_ROOM_ID) return;
  UrlFetchApp.fetch(
    'https://api.chatwork.com/v2/rooms/' + CONFIG.CHATWORK_ROOM_ID + '/messages',
    {
      method: 'post',
      headers: { 'x-chatworktoken': CONFIG.CHATWORK_API_TOKEN },
      payload: { body: '[info][title]QRコード流入レポート[/title]' + text + '[/info]' },
      muteHttpExceptions: true,
    }
  );
}

// ────────────────────────────────────────────
// 動作テスト用（手動で実行して配信を確認する）
// ────────────────────────────────────────────
function testReport() {
  dailyReport();
}
