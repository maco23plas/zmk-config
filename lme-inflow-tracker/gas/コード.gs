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
  DASH: 'ダッシュボード',
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
    .addItem('④ ダッシュボード＆個人タブを更新', 'buildDashboards')
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

  // アフィリエイター専用ページ用の閲覧キーをD列に自動生成
  ensureQrKeys_();

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

  ensureQrKeys_();
  const rows = [[
    'QR ID', '表示名',
    '★エルメ「外部連携」タブ（パラメーターエクスポート）に貼るURL',
    '★アフィリエイター専用 成果確認ページURL（本人にだけ送る）',
  ]];
  const qrs = getQrMap_();
  for (const [id, qr] of Object.entries(qrs)) {
    rows.push([
      id, qr.name,
      base + '?ev=reg&id=' + id,
      qr.key ? base + '?stats=' + qr.key : '(①を実行するとキーが生成されます)',
    ]);
  }
  sh.getRange(1, 1, rows.length, 4).setValues(rows);
  sh.setFrozenRows(1);
  sh.setColumnWidth(1, 110).setColumnWidth(2, 200).setColumnWidth(3, 480).setColumnWidth(4, 480);
  toast_('URL一覧を生成しました。C列→エルメ外部連携タブ／D列→各アフィリエイター本人へ。');
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
  for (const [id, name, url, key] of sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues()) {
    const k = String(id).trim();
    if (k) out[k] = { name: String(name).trim() || k, url: String(url).trim(), key: String(key).trim() };
  }
  return out;
}

/** QR設定シートのD列に、アフィリエイター専用ページ用の閲覧キーを自動生成する */
function ensureQrKeys_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.QR);
  if (!sh) return;
  sh.getRange(1, 4).setValue('閲覧キー（自動生成・編集しない）');
  if (sh.getLastRow() < 2) return;
  const range = sh.getRange(2, 1, sh.getLastRow() - 1, 4);
  const values = range.getValues();
  let changed = false;
  for (const row of values) {
    if (String(row[0]).trim() && !String(row[3]).trim()) {
      row[3] = Utilities.getUuid().replace(/-/g, '').substring(0, 20);
      changed = true;
    }
  }
  if (changed) range.setValues(values);
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

  // ② アフィリエイター専用 成果確認ページ（?stats=閲覧キー）
  if (p.stats) {
    return renderStatsPage_(String(p.stats).trim());
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

  // ダッシュボードも毎日更新（失敗してもレポート配信は成立させる）
  try {
    buildDashboards();
  } catch (err) {
    console.error('ダッシュボード更新失敗: ' + err);
  }
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

// ────────────────────────────────────────────
// ④ ダッシュボード＆アフィリエイター別タブの自動生成
//    （毎日レポート時に自動実行。メニューから手動更新も可）
// ────────────────────────────────────────────
function buildDashboards() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const qrs = getQrMap_();
  const qrIds = Object.keys(qrs);
  if (!qrIds.length) {
    toast_('QR設定シートが空です。先に①を実行してください。');
    return;
  }

  // 登録ログを読んで counts[id][日付] = 件数 に集計
  const counts = {};
  qrIds.forEach(id => counts[id] = {});
  let firstDay = null;
  const regSh = ss.getSheetByName(SHEETS.REGS);
  if (regSh && regSh.getLastRow() > 1) {
    const values = regSh.getRange(2, 1, regSh.getLastRow() - 1, 2).getValues();
    for (const [when, rawId] of values) {
      if (!(when instanceof Date)) continue;
      const id = String(rawId).trim();
      if (!counts[id]) counts[id] = {}; // QR設定から消えたIDも一応拾う
      const day = Utilities.formatDate(when, TZ, 'yyyy-MM-dd');
      counts[id][day] = (counts[id][day] || 0) + 1;
      if (!firstDay || day < firstDay) firstDay = day;
    }
  }

  // 日付の並び（最初のログの日〜今日。ログが無ければ今日1日分）
  const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const days = listDays_(firstDay || today, today);

  // 全体ダッシュボード
  buildOverviewSheet_(ss, qrs, counts, days);

  // アフィリエイター別タブ（📈 表示名）
  const usedNames = new Set();
  for (const [id, qr] of Object.entries(qrs)) {
    let name = '📈 ' + (qr.name || id);
    if (usedNames.has(name)) name += '（' + id + '）';
    usedNames.add(name);
    buildAffiSheet_(ss, name, qr.name || id, counts[id] || {}, days);
  }

  toast_('ダッシュボードと個人タブを更新しました。');
}

/** start〜end（両端含む・yyyy-MM-dd）の日付配列を作る */
function listDays_(start, end) {
  const days = [];
  let d = new Date(start + 'T00:00:00+09:00');
  const stop = new Date(end + 'T00:00:00+09:00');
  while (d <= stop && days.length < 400) { // 400日で頭打ち（シート肥大防止）
    days.push(Utilities.formatDate(d, TZ, 'yyyy-MM-dd'));
    d = new Date(d.getTime() + 24 * 60 * 60 * 1000);
  }
  return days;
}

function sumLastNDays_(dayCounts, days, n) {
  return days.slice(-n).reduce((s, day) => s + (dayCounts[day] || 0), 0);
}

/** シートを空にして返す（無ければ作る）。既存グラフも消す */
function resetSheet_(ss, name) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  sh.clear();
  sh.getCharts().forEach(c => sh.removeChart(c));
  return sh;
}

/** 全体ダッシュボード：全員のサマリー表＋日別推移（積み上げ）＋累計比較グラフ */
function buildOverviewSheet_(ss, qrs, counts, days) {
  const sh = resetSheet_(ss, SHEETS.DASH);
  const ids = Object.keys(qrs);
  const yesterday = days.length >= 2 ? days[days.length - 2] : null;
  const today = days[days.length - 1];

  // サマリー表
  sh.getRange(1, 1).setValue('📊 流入ダッシュボード（自動更新: ' +
    Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm') + '）')
    .setFontWeight('bold').setFontSize(12);
  const sumHeader = ['アフィリエイター', '累計', '今日', '昨日', '直近7日', '直近30日'];
  const sumRows = ids.map(id => {
    const dc = counts[id] || {};
    const total = Object.values(dc).reduce((a, b) => a + b, 0);
    return [qrs[id].name, total, dc[today] || 0, yesterday ? (dc[yesterday] || 0) : 0,
      sumLastNDays_(dc, days, 7), sumLastNDays_(dc, days, 30)];
  });
  sh.getRange(3, 1, 1, 6).setValues([sumHeader]).setFontWeight('bold').setBackground('#E4F5EA');
  if (sumRows.length) sh.getRange(4, 1, sumRows.length, 6).setValues(sumRows);
  sh.setColumnWidth(1, 220);

  // 日別マトリクス（日付 × アフィリエイター）
  const matTop = 4 + sumRows.length + 2;
  sh.getRange(matTop, 1).setValue('日別推移').setFontWeight('bold');
  const matHeader = ['日付'].concat(ids.map(id => qrs[id].name), ['合計']);
  const matRows = days.map(day => {
    const per = ids.map(id => (counts[id] || {})[day] || 0);
    return [day].concat(per, [per.reduce((a, b) => a + b, 0)]);
  });
  sh.getRange(matTop + 1, 1, 1, matHeader.length).setValues([matHeader])
    .setFontWeight('bold').setBackground('#E4F5EA');
  sh.getRange(matTop + 2, 1, matRows.length, matHeader.length).setValues(matRows);

  // グラフ1: 日別推移（アフィリエイター別・積み上げ棒）
  sh.insertChart(sh.newChart()
    .setChartType(Charts.ChartType.COLUMN)
    .addRange(sh.getRange(matTop + 1, 1, matRows.length + 1, matHeader.length - 1))
    .setPosition(3, 8, 0, 0)
    .setOption('title', '日別登録数（アフィリエイター別）')
    .setOption('isStacked', true)
    .setOption('width', 640).setOption('height', 320)
    .build());

  // グラフ2: 累計の比較（横棒）
  sh.insertChart(sh.newChart()
    .setChartType(Charts.ChartType.BAR)
    .addRange(sh.getRange(3, 1, sumRows.length + 1, 2))
    .setPosition(20, 8, 0, 20)
    .setOption('title', '累計登録数の比較')
    .setOption('legend', { position: 'none' })
    .setOption('width', 640).setOption('height', 320)
    .build());

  // ダッシュボードを先頭タブへ
  ss.setActiveSheet(sh);
  ss.moveActiveSheet(1);
}

/** アフィリエイター別タブ：サマリー＋日別表＋棒グラフ */
function buildAffiSheet_(ss, sheetName, dispName, dayCounts, days) {
  const sh = resetSheet_(ss, sheetName.substring(0, 90));
  const total = Object.values(dayCounts).reduce((a, b) => a + b, 0);
  const today = days[days.length - 1];
  const yesterday = days.length >= 2 ? days[days.length - 2] : null;

  sh.getRange(1, 1).setValue('📈 ' + dispName + ' の流入状況（自動更新）')
    .setFontWeight('bold').setFontSize(12);
  sh.getRange(2, 1, 1, 5).setValues([['累計', '今日', '昨日', '直近7日', '直近30日']])
    .setFontWeight('bold').setBackground('#E4F5EA');
  sh.getRange(3, 1, 1, 5).setValues([[
    total, dayCounts[today] || 0, yesterday ? (dayCounts[yesterday] || 0) : 0,
    sumLastNDays_(dayCounts, days, 7), sumLastNDays_(dayCounts, days, 30),
  ]]).setFontSize(12);

  // 日別表（累計つき）
  sh.getRange(5, 1, 1, 3).setValues([['日付', '登録数', '累計']])
    .setFontWeight('bold').setBackground('#E4F5EA');
  let running = 0;
  const rows = days.map(day => {
    const n = dayCounts[day] || 0;
    running += n;
    return [day, n, running];
  });
  sh.getRange(6, 1, rows.length, 3).setValues(rows);
  sh.setFrozenRows(5);

  // グラフ: 日別登録数
  sh.insertChart(sh.newChart()
    .setChartType(Charts.ChartType.COLUMN)
    .addRange(sh.getRange(5, 1, rows.length + 1, 2))
    .setPosition(2, 5, 0, 0)
    .setOption('title', dispName + '：日別登録数')
    .setOption('legend', { position: 'none' })
    .setOption('width', 600).setOption('height', 300)
    .build());
}

// ────────────────────────────────────────────
// アフィリエイター専用 成果確認ページ
//   URL: …/exec?stats=<閲覧キー>
//   本人の数字だけを表示（LINE ID等の個人情報は一切出さない）
// ────────────────────────────────────────────
function renderStatsPage_(key) {
  const invalid = () => HtmlService.createHtmlOutput(
    '<p style="font-family:sans-serif;text-align:center;padding-top:3em">リンクが無効です。発行元にお問い合わせください。</p>');
  if (!key) return invalid();

  // 閲覧キーからアフィリエイターを特定
  let found = null;
  for (const [id, qr] of Object.entries(getQrMap_())) {
    if (qr.key && qr.key === key) { found = { id: id, name: qr.name }; break; }
  }
  if (!found) return invalid();

  // 本人分だけ集計
  const dayCounts = {};
  let total = 0;
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.REGS);
  if (sh && sh.getLastRow() > 1) {
    for (const [when, rawId] of sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues()) {
      if (!(when instanceof Date) || String(rawId).trim() !== found.id) continue;
      const day = Utilities.formatDate(when, TZ, 'yyyy-MM-dd');
      dayCounts[day] = (dayCounts[day] || 0) + 1;
      total++;
    }
  }

  // 直近30日分の日付
  const days = [];
  for (let i = 29; i >= 0; i--) {
    days.push(Utilities.formatDate(new Date(Date.now() - i * 86400000), TZ, 'yyyy-MM-dd'));
  }
  const today = days[days.length - 1];
  const yesterday = days[days.length - 2];
  const last7 = sumLastNDays_(dayCounts, days, 7);
  const last30 = sumLastNDays_(dayCounts, days, 30);
  const maxDaily = Math.max(1, ...days.map(d => dayCounts[d] || 0));

  const esc = escapeHtmlAttr_;
  const cards = [
    ['累計', total], ['今日', dayCounts[today] || 0], ['昨日', dayCounts[yesterday] || 0],
    ['直近7日', last7], ['直近30日', last30],
  ].map(([label, v]) =>
    '<div class="card"><div class="v">' + v + '</div><div class="l">' + label + '</div></div>'
  ).join('');

  const bars = days.map(d => {
    const n = dayCounts[d] || 0;
    const h = Math.round((n / maxDaily) * 100);
    const md = d.substring(5).replace('-', '/');
    return '<div class="bcol" title="' + esc(d) + '：' + n + '件">' +
      '<div class="bval">' + (n || '') + '</div>' +
      '<div class="bar" style="height:' + Math.max(h, n ? 4 : 0) + '%"></div>' +
      '<div class="blab">' + esc(md) + '</div></div>';
  }).join('');

  const tableRows = days.slice().reverse().map(d =>
    '<tr><td>' + esc(d) + '</td><td class="num">' + (dayCounts[d] || 0) + '</td></tr>'
  ).join('');

  const html = '<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + esc(found.name) + ' 成果確認</title><style>' +
    'body{margin:0;background:#F4F8F4;color:#1B2620;font-family:"Hiragino Kaku Gothic ProN","Noto Sans JP",Meiryo,sans-serif;line-height:1.7}' +
    '.wrap{max-width:640px;margin:0 auto;padding:20px 14px 48px}' +
    'h1{font-size:18px;margin:6px 0 2px}' +
    '.sub{color:#5A6A61;font-size:12px;margin-bottom:14px}' +
    '.cards{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px}' +
    '.card{flex:1;min-width:90px;background:#fff;border:1px solid #DFE8E0;border-radius:10px;padding:10px 6px;text-align:center}' +
    '.card .v{font-size:22px;font-weight:800;color:#00A63E}' +
    '.card .l{font-size:11px;color:#5A6A61}' +
    '.panel{background:#fff;border:1px solid #DFE8E0;border-radius:10px;padding:14px;margin-bottom:16px}' +
    '.panel h2{font-size:14px;margin:0 0 10px}' +
    '.chart{display:flex;align-items:flex-end;gap:2px;height:150px;overflow-x:auto;padding-bottom:2px}' +
    '.bcol{flex:1;min-width:12px;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%}' +
    '.bar{width:100%;background:#00A63E;border-radius:2px 2px 0 0;min-height:0}' +
    '.bval{font-size:9px;color:#5A6A61;height:12px}' +
    '.blab{font-size:8px;color:#96A69C;height:12px;white-space:nowrap;transform:rotate(-45deg);margin-top:6px}' +
    'table{width:100%;border-collapse:collapse;font-size:13px}' +
    'td{padding:6px 8px;border-top:1px solid #EDF2ED}.num{text-align:right;font-weight:700}' +
    '.foot{color:#96A69C;font-size:11px;text-align:center;margin-top:18px}' +
    '</style></head><body><div class="wrap">' +
    '<h1>📈 ' + esc(found.name) + '</h1>' +
    '<div class="sub">LINE友だち登録の成果レポート（' +
    Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm') + ' 時点・開くたびに最新化）</div>' +
    '<div class="cards">' + cards + '</div>' +
    '<div class="panel"><h2>日別登録数（直近30日）</h2><div class="chart">' + bars + '</div></div>' +
    '<div class="panel"><h2>日別一覧</h2><table><tr><td style="color:#5A6A61">日付</td><td class="num" style="color:#5A6A61">登録数</td></tr>' +
    tableRows + '</table></div>' +
    '<div class="foot">このページはあなた専用です。URLは他の方に共有しないでください。</div>' +
    '</div></body></html>';

  return HtmlService.createHtmlOutput(html).setTitle(found.name + ' 成果確認');
}
