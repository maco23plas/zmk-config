/**
 * ============================================================
 *  エルメ（L Message）QRコード別 流入計測 & 毎日レポート配信ツール v2
 * ============================================================
 *
 *  ▼ このファイルは「一度貼り付けたら編集不要」です。
 *    設定（QRコード一覧・Discord/Chatworkのキー・配信時刻）は
 *    すべてスプレッドシートの「設定」「QR設定」シートで行います。
 *
 *  ▼ 使い方（詳細は同梱README）
 *   1. スプレッドシート → 拡張機能 → Apps Script にこのファイルを貼り付けて保存
 *   2. スプレッドシートをリロード → メニュー「📊 エルメ流入ツール」が出る
 *   3. 「① 初期セットアップ／設定反映」を実行（シートとトリガーが作られる）
 *   4. デプロイ → ウェブアプリ（実行ユーザー:自分／アクセス:全員）
 *   5. 「② エルメ登録用URL一覧を生成」→ URL一覧シートのURLを
 *      エルメ各QRコードアクションの「外部連携」タブに貼る
 *   6. 「設定」シートに Discord Webhook URL / Chatworkトークン を貼る
 *   7. 「③ テスト配信」で届けばOK。以後、毎日自動配信
 *
 *  できること（すべて無料枠のみで動作）:
 *   ・【本命】エルメ公式「パラメーターエクスポート」（外部連携タブ）を受信し、
 *     QR経由の友だち追加（実登録）をリアルタイムにシートへ記録
 *   ・【代替】QRコード別クリック計測リダイレクタ（外部連携タブが無い場合）
 *   ・毎日決まった時刻に Discord / Chatwork へQR別集計レポートを自動配信
 * ============================================================
 */

// シート名（変更しないでください）
const SHEETS = {
  CONFIG: '設定',
  QR: 'QR設定',
  CLICKS: 'クリックログ',
  REGS: '登録ログ',
  DAILY: '日次集計',
  URLS: 'URL一覧',
};

const TZ = 'Asia/Tokyo';

// ────────────────────────────────────────────
// スプレッドシートのカスタムメニュー
// ────────────────────────────────────────────
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📊 エルメ流入ツール')
    .addItem('① 初期セットアップ／設定反映', 'setup')
    .addItem('② エルメ登録用URL一覧を生成', 'generateUrls')
    .addItem('③ テスト配信（今すぐレポート送信）', 'dailyReport')
    .addToUi();
}

// ────────────────────────────────────────────
// ① 初期セットアップ（何度実行してもOK。設定変更後の反映もこれ）
// ────────────────────────────────────────────
// 設定シートの既定行（①実行のたびに、足りない行だけ追記される）
const CONFIG_DEFAULTS = [
  ['WEB_APP_URL', '', '★デプロイ完了画面の「ウェブアプリ」URL（https://script.google.com/macros/s/…/exec）をそのまま貼る。②のURL生成で使用'],
  ['DISCORD_WEBHOOK_URL', '', 'Discord: チャンネル名横の⚙️ → 連携サービス → ウェブフック作成 → URLコピー'],
  ['CHATWORK_API_TOKEN', '', 'Chatwork: 右上の自分の名前 → サービス連携 → APIトークン'],
  ['CHATWORK_ROOM_ID', '', '送りたいチャットのURLの「#!rid」の後ろの数字'],
  ['REPORT_HOUR', 9, '毎日レポートを送る時刻（0〜23）。変更したら①を再実行'],
  ['REPORT_TITLE', 'QRコード流入レポート', 'レポートの見出し（自由に変更可）'],
];

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 設定シート（キーと値）。既にあっても、足りない設定行は追記する
  let conf = ss.getSheetByName(SHEETS.CONFIG);
  if (!conf) {
    conf = ss.insertSheet(SHEETS.CONFIG);
    conf.appendRow(['設定項目', '値', 'メモ']);
    conf.setFrozenRows(1);
    conf.setColumnWidth(1, 190).setColumnWidth(2, 320).setColumnWidth(3, 460);
  }
  const existingKeys = new Set(
    conf.getLastRow() > 1
      ? conf.getRange(2, 1, conf.getLastRow() - 1, 1).getValues().flat().map(v => String(v).trim())
      : []
  );
  for (const row of CONFIG_DEFAULTS) {
    if (!existingKeys.has(row[0])) conf.appendRow(row);
  }

  // QR設定シート（計測するQRコードの一覧。行の追加・削除は自由）
  const qrSh = ss.getSheetByName(SHEETS.QR);
  if (!qrSh) {
    const sh = ss.insertSheet(SHEETS.QR);
    sh.getRange(1, 1, 7, 3).setValues([
      ['QR ID（英数字・自由）', '表示名', 'エルメ友だち追加URL（方式B用・任意）'],
      ['affi_01', 'TTM様 アフィ_01', ''],
      ['affi_02', 'TTM様 アフィ_02', ''],
      ['affi_03', 'TTM様 アフィ_03', ''],
      ['affi_04', 'TTM様 アフィ_04', ''],
      ['affi_05', 'TTM様 アフィ_05', ''],
      ['affi_06', 'TTM様 アフィ_06', ''],
    ]);
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 170).setColumnWidth(2, 220).setColumnWidth(3, 380);
  }

  // ログ系シート
  ensureSheet_(ss, SHEETS.REGS, ['日時', 'QR ID', 'QR名', '補足(生データ)']);
  ensureSheet_(ss, SHEETS.CLICKS, ['日時', 'QR ID', 'QR名', '補足']);
  ensureSheet_(ss, SHEETS.DAILY, ['日付', 'QR ID', 'QR名', '登録数', 'クリック数']);

  // 毎日トリガーを（再）登録
  const hour = Number(getConfig_().REPORT_HOUR) || 9;
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'dailyReport')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('dailyReport').timeBased().atHour(hour).everyDays(1).create();

  toast_('セットアップ完了。毎日 ' + hour + ' 時ごろに自動配信されます。次は「デプロイ」→ ②URL生成へ。');
}

// ────────────────────────────────────────────
// ② エルメに貼るURLの一覧を自動生成
//    （先に「デプロイ → ウェブアプリ」を済ませておくこと）
// ────────────────────────────────────────────
function generateUrls() {
  // 設定シートのWEB_APP_URLを最優先で使う。
  // （ScriptApp.getService().getUrl() はデプロイを作り直すと古いURLを
  //   返すことがあるため、手貼りのURLを正とする）
  let base = String(getConfig_().WEB_APP_URL || '').trim();
  if (base) {
    const m = base.match(/^https:\/\/script\.google\.com\/macros\/s\/[^\/?#]+\/exec/);
    if (!m) {
      toast_('「設定」シートのWEB_APP_URLの形式が違います。https://script.google.com/macros/s/…/exec の形（デプロイ完了画面の「ウェブアプリ」欄のURL）を貼ってください。');
      return;
    }
    base = m[0];
  } else {
    base = ScriptApp.getService().getUrl();
  }
  if (!base) {
    toast_('先に「デプロイ」→「新しいデプロイ」→ ウェブアプリ（実行:自分／アクセス:全員）を行い、発行されたURLを「設定」シートのWEB_APP_URLに貼ってください。');
    return;
  }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEETS.URLS);
  if (sh) sh.clear(); else sh = ss.insertSheet(SHEETS.URLS);

  const rows = [['QR ID', '表示名', '★エルメ「外部連携」タブに貼るURL（本命）', '（方式B）QRコードの飛び先にするURL']];
  const qrs = getQrMap_();
  for (const [id, qr] of Object.entries(qrs)) {
    rows.push([id, qr.name, base + '?ev=reg&id=' + id, base + '?id=' + id]);
  }
  sh.getRange(1, 1, rows.length, 4).setValues(rows);
  sh.setFrozenRows(1);
  sh.setColumnWidth(1, 110).setColumnWidth(2, 200).setColumnWidth(3, 480).setColumnWidth(4, 480);
  toast_('URL一覧を生成しました。「URL一覧」シートのC列をエルメの各QRコードアクション →「外部連携」タブへ。');
}

// ────────────────────────────────────────────
// 設定・QR一覧の読み込み
// ────────────────────────────────────────────
function getConfig_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.CONFIG);
  const out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  for (const [k, v] of sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues()) {
    if (k) out[String(k).trim()] = String(v).trim();
  }
  return out;
}

function getQrMap_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.QR);
  const out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  for (const [id, name, url] of sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues()) {
    const key = String(id).trim();
    if (key) out[key] = { name: String(name).trim() || key, url: String(url).trim() };
  }
  return out;
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

function toast_(msg) {
  try {
    SpreadsheetApp.getActiveSpreadsheet().toast(msg, '📊 エルメ流入ツール', 10);
  } catch (e) { /* トリガー実行時はUIなし */ }
  Logger.log(msg);
}

// ────────────────────────────────────────────
// Webアプリ入口（用途はURLパラメータで分岐）
//
// ① 実登録の記録（エルメ「パラメーターエクスポート」の受け口）★本命
//      …/exec?ev=reg&id=affi_01
//    → QR経由の友だち追加のたびにエルメがGETで情報を送ってくる
//
// ② クリック計測リダイレクタ（外部連携タブが使えない場合の代替）
//      …/exec?id=affi_01
//    → クリックを記録して、QR設定シートのエルメURLへ転送
// ────────────────────────────────────────────
function doGet(e) {
  const p = (e && e.parameter) || {};
  const id = String(p.id || '').trim();
  const qr = getQrMap_()[id];

  // ① パラメーターエクスポート受信
  if (p.ev === 'reg') {
    try {
      appendLog_(SHEETS.REGS, id, qr ? qr.name : '(未設定:' + id + ')', JSON.stringify(p));
    } catch (err) {
      console.error('登録ログ記録失敗: ' + err);
    }
    return ContentService.createTextOutput('ok');
  }

  // ② リダイレクタ
  if (qr && qr.url) {
    try {
      appendLog_(SHEETS.CLICKS, id, qr.name, '');
    } catch (err) {
      console.error('クリックログ記録失敗: ' + err);
    }
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
    '<p style="font-family:sans-serif">リンクが無効です（QR設定シートに id「' +
    escapeHtmlAttr_(id) + '」がないか、エルメURLが未記入です）。</p>'
  );
}

// POSTで送ってくる外部システム向けの受け口（動きはGETのev=regと同じ）
function doPost(e) {
  let params = (e && e.parameter) || {};
  let raw = '';
  try {
    raw = e && e.postData ? e.postData.contents : '';
    const data = raw ? JSON.parse(raw) : {};
    params = Object.assign({}, data, params);
  } catch (err) { /* JSONでないボディはそのまま補足に残す */ }
  const id = String(params.id || '').trim();
  const qr = getQrMap_()[id];
  appendLog_(SHEETS.REGS, id, qr ? qr.name : '(不明)',
    JSON.stringify(raw ? Object.assign({ _body: raw }, params) : params));
  return ContentService.createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}

/** ログ追記（同時アクセスに備えてロックを取る） */
function appendLog_(sheetName, id, name, note) {
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ensureSheet_(ss, sheetName, ['日時', 'QR ID', 'QR名', '補足']);
    sh.appendRow([new Date(), id, name, note]);
  } finally {
    lock.releaseLock();
  }
}

function escapeHtmlAttr_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// ────────────────────────────────────────────
// ③ 毎日レポート（トリガーから自動実行。メニューから手動実行も可）
// ────────────────────────────────────────────
function dailyReport() {
  const conf = getConfig_();
  const qrs = getQrMap_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const targetDay = Utilities.formatDate(yesterday, TZ, 'yyyy-MM-dd');

  const regs = countByQr_(SHEETS.REGS, targetDay);
  const regsTotal = countByQr_(SHEETS.REGS, null);
  const clicks = countByQr_(SHEETS.CLICKS, targetDay);
  const clicksTotal = countByQr_(SHEETS.CLICKS, null);

  const useRegs = hasRows_(SHEETS.REGS);     // 外部連携（実登録）を使っているか
  const useClicks = hasRows_(SHEETS.CLICKS); // リダイレクタ（クリック）を使っているか

  const daily = ensureSheet_(ss, SHEETS.DAILY, ['日付', 'QR ID', 'QR名', '登録数', 'クリック数']);

  const lines = [];
  lines.push('📊 ' + (conf.REPORT_TITLE || 'QRコード流入レポート') + '（' + targetDay + '）');
  lines.push('');
  let dayRegSum = 0;
  let dayClickSum = 0;
  for (const [id, qr] of Object.entries(qrs)) {
    const r = regs[id] || 0;
    const c = clicks[id] || 0;
    dayRegSum += r;
    dayClickSum += c;
    const parts = [];
    if (useRegs) parts.push('登録 ' + r + ' 件（累計 ' + (regsTotal[id] || 0) + '）');
    if (useClicks) parts.push('クリック ' + c + ' 件（累計 ' + (clicksTotal[id] || 0) + '）');
    if (!parts.length) parts.push('登録 0 件');
    lines.push('・' + qr.name + '： ' + parts.join(' ／ '));
    daily.appendRow([targetDay, id, qr.name, r, c]);
  }
  lines.push('');
  const sumParts = [];
  if (useRegs) sumParts.push('登録 ' + dayRegSum + ' 件');
  if (useClicks) sumParts.push('クリック ' + dayClickSum + ' 件');
  lines.push('合計： ' + (sumParts.join(' ／ ') || '登録 0 件'));
  lines.push('シート: ' + ss.getUrl());

  const text = lines.join('\n');
  const sentTo = [];
  if (conf.DISCORD_WEBHOOK_URL) { sendDiscord_(conf.DISCORD_WEBHOOK_URL, text); sentTo.push('Discord'); }
  if (conf.CHATWORK_API_TOKEN && conf.CHATWORK_ROOM_ID) {
    sendChatwork_(conf.CHATWORK_API_TOKEN, conf.CHATWORK_ROOM_ID, text);
    sentTo.push('Chatwork');
  }
  Logger.log(text);
  toast_(sentTo.length
    ? sentTo.join('・') + ' に送信しました。'
    : '送信先が未設定です。「設定」シートに Discord Webhook URL または Chatworkトークン+ルームID を入力してください。');
}

function hasRows_(sheetName) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  return !!sh && sh.getLastRow() > 1;
}

/** 指定日（yyyy-MM-dd、nullなら全期間）のQR IDごとの件数を数える */
function countByQr_(sheetName, day) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  const out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  const values = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
  for (const [when, id] of values) {
    if (!(when instanceof Date)) continue;
    if (day && Utilities.formatDate(when, TZ, 'yyyy-MM-dd') !== day) continue;
    out[id] = (out[id] || 0) + 1;
  }
  return out;
}

// ────────────────────────────────────────────
// 配信先: Discord（Incoming Webhook・無料） / Chatwork（API・無料）
// ────────────────────────────────────────────
function sendDiscord_(webhookUrl, text) {
  UrlFetchApp.fetch(webhookUrl, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ content: text }),
    muteHttpExceptions: true,
  });
}

function sendChatwork_(token, roomId, text) {
  UrlFetchApp.fetch('https://api.chatwork.com/v2/rooms/' + roomId + '/messages', {
    method: 'post',
    headers: { 'x-chatworktoken': token },
    payload: { body: '[info][title]QRコード流入レポート[/title]' + text + '[/info]' },
    muteHttpExceptions: true,
  });
}
