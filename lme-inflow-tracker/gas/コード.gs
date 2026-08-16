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

// ⑤自動更新の取得元（GitHubの最新コード）
const UPDATE_SOURCE_URL =
  'https://raw.githubusercontent.com/maco23plas/zmk-config/claude/qr-action-inflow-zapier-18dccr/lme-inflow-tracker/gas/%E3%82%B3%E3%83%BC%E3%83%89.gs';

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
    .addItem('⑤ 最新版に更新（取得→自動デプロイ）', 'selfUpdate')
    .addToUi();
}

// ────────────────────────────────────────────
// ① 初期セットアップ（何度実行してもOK。設定変更後の反映もこれ）
// ────────────────────────────────────────────
// 設定シートの既定行（①実行のたびに、足りない行だけ追記される）
const CONFIG_DEFAULTS = [
  ['WEB_APP_URL', '', '★デプロイ完了画面の「ウェブアプリ」URL（https://script.google.com/macros/s/…/exec）をそのまま貼る。②のURL生成で使用'],
  ['ADMIN_KEY', '', '管理者ダッシュボードの閲覧キー（①実行で自動生成・編集しない・共有しない）'],
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

  // 管理者ダッシュボードの閲覧キーが空なら自動生成
  const cvals = conf.getRange(2, 1, conf.getLastRow() - 1, 2).getValues();
  for (let i = 0; i < cvals.length; i++) {
    if (String(cvals[i][0]).trim() === 'ADMIN_KEY' && !String(cvals[i][1]).trim()) {
      conf.getRange(i + 2, 2).setValue('adm' + Utilities.getUuid().replace(/-/g, '').substring(0, 20));
    }
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
  const ak = String(getConfig_().ADMIN_KEY || '').trim();
  rows.push(['', '', '', '']);
  rows.push(['(管理者)', '全体ダッシュボード ※自分専用・共有禁止', '',
    ak ? base + '?admin=' + ak : '(①を実行するとキーが生成されます)']);
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
  for (const [id, name, url, key, rate, goal] of sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues()) {
    const k = String(id).trim();
    if (k) {
      out[k] = {
        name: String(name).trim() || k,
        url: String(url).trim(),
        key: String(key).trim(),
        rate: Number(rate) || 0,
        goal: Number(goal) || 0,
      };
    }
  }
  return out;
}

/** QR設定シートのD〜F列（閲覧キー・報酬単価・月間目標）を整える */
function ensureQrKeys_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.QR);
  if (!sh) return;
  sh.getRange(1, 4, 1, 3).setValues([[
    '閲覧キー（自動生成・編集しない）',
    '報酬単価（円・任意）',
    '月間目標（件・任意）',
  ]]);
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

  // ② アフィリエイター専用 成果確認ページ（?stats=閲覧キー&p=期間）
  if (p.stats) {
    return renderStatsPage_(String(p.stats).trim(), Number(p.p));
  }

  // ③ 管理者ダッシュボード（?admin=管理キー）
  if (p.admin) {
    const ak = String(getConfig_().ADMIN_KEY || '').trim();
    if (ak && String(p.admin).trim() === ak) return renderAdminPage_();
    return invalidPage_();
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
// ⑤ 最新版に更新（GitHubから取得 → 保存 → 新バージョン → 本番デプロイ更新）
//    ※初回のみ https://script.google.com/home/usersettings で
//      「Google Apps Script API」をONにしておくこと
// ────────────────────────────────────────────
function selfUpdate() {
  const token = ScriptApp.getOAuthToken();
  const api = 'https://script.googleapis.com/v1/projects/' + ScriptApp.getScriptId();
  const call = (url, method, payload) => UrlFetchApp.fetch(url, {
    method: method,
    headers: { Authorization: 'Bearer ' + token },
    contentType: 'application/json',
    payload: payload ? JSON.stringify(payload) : undefined,
    muteHttpExceptions: true,
  });

  // 1. GitHubから最新コードを取得（キャッシュ回避付き・中身の簡易チェック付き）
  const gh = UrlFetchApp.fetch(UPDATE_SOURCE_URL + '?cb=' + Date.now(), { muteHttpExceptions: true });
  if (gh.getResponseCode() !== 200) {
    toast_('GitHubからコードを取得できませんでした（HTTP ' + gh.getResponseCode() + '）');
    return;
  }
  const src = gh.getContentText();
  if (src.indexOf('function dailyReport') < 0 || src.indexOf('function doGet') < 0) {
    toast_('取得したコードの中身が想定と違うため中止しました。');
    return;
  }

  // 2. 現在のプロジェクト内容を取得（マニフェストは維持し、コードだけ差し替える）
  let r = call(api + '/content', 'get');
  if (r.getResponseCode() === 403) {
    toast_('Apps Script APIが無効です。script.google.com/home/usersettings で「Google Apps Script API」をONにしてから⑤を再実行してください。');
    return;
  }
  if (r.getResponseCode() !== 200) {
    toast_('プロジェクト情報の取得に失敗: HTTP ' + r.getResponseCode());
    return;
  }
  const files = JSON.parse(r.getContentText()).files || [];
  const manifest = files.find(f => f.name === 'appsscript');
  const js = files.find(f => f.type === 'SERVER_JS');
  r = call(api + '/content', 'put', {
    files: [manifest, { name: js ? js.name : 'コード', type: 'SERVER_JS', source: src }],
  });
  if (r.getResponseCode() !== 200) {
    toast_('コードの保存に失敗: ' + r.getContentText().substring(0, 160));
    return;
  }

  // 3. 新バージョンを作成
  r = call(api + '/versions', 'post', {
    description: '自動更新 ' + Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'),
  });
  if (r.getResponseCode() !== 200) {
    toast_('バージョン作成に失敗: HTTP ' + r.getResponseCode());
    return;
  }
  const version = JSON.parse(r.getContentText()).versionNumber;

  // 4. 設定シートWEB_APP_URLと同じURLを持つ本番デプロイを探して、新バージョンに更新
  const base = String(getConfig_().WEB_APP_URL || '').trim().replace(/[?#].*$/, '');
  if (!base) {
    toast_('「設定」シートのWEB_APP_URLが空です。本番デプロイのURLを貼ってから⑤を再実行してください。');
    return;
  }
  r = call(api + '/deployments', 'get');
  const deps = (r.getResponseCode() === 200 && JSON.parse(r.getContentText()).deployments) || [];
  let target = null;
  for (const d of deps) {
    for (const e of (d.entryPoints || [])) {
      if (e.webApp && e.webApp.url === base) { target = d; break; }
    }
    if (target) break;
  }
  if (!target) {
    toast_('WEB_APP_URLに一致する本番デプロイが見つかりません。「デプロイを管理」でURLを確認してWEB_APP_URLを直してください。（コードとバージョン' + version + 'の作成までは完了）');
    return;
  }
  r = call(api + '/deployments/' + target.deploymentId, 'put', {
    deploymentConfig: {
      scriptId: ScriptApp.getScriptId(),
      versionNumber: version,
      manifestFileName: 'appsscript',
      description: '本番',
    },
  });
  if (r.getResponseCode() !== 200) {
    toast_('デプロイ更新に失敗: ' + r.getContentText().substring(0, 160));
    return;
  }
  toast_('✅ 最新版に更新完了（バージョン ' + version + '）。URLは変わっていません。');
}

// ────────────────────────────────────────────
// 診断用：⑤が失敗するときにエディタから実行して実行ログを確認する
// ────────────────────────────────────────────
function diagApi() {
  const r = UrlFetchApp.fetch(
    'https://script.googleapis.com/v1/projects/' + ScriptApp.getScriptId() + '/content',
    { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true }
  );
  Logger.log('HTTP ' + r.getResponseCode());
  Logger.log(r.getContentText().substring(0, 600));
}

// ────────────────────────────────────────────
// Web分析ページ 共通部品
// ────────────────────────────────────────────
function invalidPage_() {
  return HtmlService.createHtmlOutput(
    '<p style="font-family:sans-serif;text-align:center;padding-top:3em">リンクが無効です。発行元にお問い合わせください。</p>');
}

/** 登録ログを {id, day, hour, wd} の配列で返す（1回読むだけ） */
function collectRegRows_() {
  const out = [];
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.REGS);
  if (!sh || sh.getLastRow() < 2) return out;
  for (const [when, rawId] of sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues()) {
    if (!(when instanceof Date)) continue;
    out.push({
      id: String(rawId).trim(),
      day: Utilities.formatDate(when, TZ, 'yyyy-MM-dd'),
      hour: Number(Utilities.formatDate(when, TZ, 'H')),
      wd: Number(Utilities.formatDate(when, TZ, 'u')) - 1,
    });
  }
  return out;
}

/** offset日前の 'yyyy-MM-dd' */
function gDay_(offset) {
  return Utilities.formatDate(new Date(Date.now() - offset * 86400000), TZ, 'yyyy-MM-dd');
}

/** 日別カウント表から offset from〜to 日前の合計 */
function sumOffsets_(dayCounts, from, to) {
  let s = 0;
  for (let i = from; i <= to; i++) s += dayCounts[gDay_(i)] || 0;
  return s;
}

/** 増減チップ（前期間比） */
function deltaChip_(cur, prev) {
  if (prev > 0) {
    const pct = Math.round(((cur - prev) / prev) * 100);
    if (pct > 0) return '<span class="chip up">↑ +' + pct + '%</span>';
    if (pct < 0) return '<span class="chip dn">↓ ' + pct + '%</span>';
    return '<span class="chip nt">±0%</span>';
  }
  return cur > 0 ? '<span class="chip up">NEW</span>' : '<span class="chip nt">—</span>';
}

/** WEB_APP_URL（設定シート優先）→ 素の …/exec */
function webAppBase_() {
  const base = String(getConfig_().WEB_APP_URL || '').trim().replace(/[?#].*$/, '');
  return base || ScriptApp.getService().getUrl() || '';
}

// 白ベースの共通スタイル（クリエイター/管理者ページ共用）
const PAGE_CSS =
  'body{margin:0;background:#F7F9F7;color:#17211B;font-family:"Hiragino Kaku Gothic ProN","Noto Sans JP",Meiryo,sans-serif;line-height:1.7;-webkit-font-smoothing:antialiased}' +
  '.wrap{max-width:680px;margin:0 auto;padding:26px 16px 56px}' +
  '.eyebrow{font-size:10px;letter-spacing:.24em;color:#00A63E;font-weight:700}' +
  'h1{font-size:22px;margin:4px 0 2px;letter-spacing:.01em}' +
  '.upd{color:#98A69E;font-size:11px;font-variant-numeric:tabular-nums;margin-bottom:4px}' +
  '.hero{margin:14px 0 12px;padding:20px;border-radius:18px;border:1px solid rgba(0,166,62,.22);' +
  'background:radial-gradient(120% 160% at 0% 0%,rgba(0,166,62,.10),rgba(0,166,62,.02) 60%),#fff;' +
  'box-shadow:0 1px 3px rgba(16,40,26,.05)}' +
  '.hv{font-size:52px;font-weight:800;color:#00A63E;line-height:1.15;font-variant-numeric:tabular-nums}' +
  '.hl{font-size:12px;color:#6B7A72;letter-spacing:.08em}' +
  '.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px}' +
  '.stat{background:#fff;border:1px solid #E6ECE7;border-radius:14px;padding:10px 4px;text-align:center;box-shadow:0 1px 2px rgba(16,40,26,.04)}' +
  '.sv{font-size:19px;font-weight:800;font-variant-numeric:tabular-nums}' +
  '.sl{font-size:10px;color:#8A968E}' +
  '.chip{display:inline-block;font-size:10px;font-weight:800;border-radius:99px;padding:0 7px;line-height:1.6;vertical-align:middle}' +
  '.chip.up{background:#E3F6EA;color:#00842F}' +
  '.chip.dn{background:#FBE9E5;color:#B23A28}' +
  '.chip.nt{background:#EFF2EF;color:#8A968E}' +
  '.pills{display:flex;gap:6px;margin:4px 0 12px}' +
  '.pill{padding:4px 14px;border-radius:99px;border:1px solid #E6ECE7;background:#fff;color:#6B7A72;font-size:12px;text-decoration:none;font-weight:700}' +
  '.pill.on{background:#00A63E;color:#fff;border-color:#00A63E}' +
  '.panel{background:#fff;border:1px solid #E6ECE7;border-radius:16px;padding:16px;margin-bottom:12px;box-shadow:0 1px 2px rgba(16,40,26,.04)}' +
  '.ph{font-size:11px;letter-spacing:.18em;color:#8A968E;font-weight:700;margin-bottom:10px}' +
  '.note{font-size:11px;color:#98A69E;margin-top:8px}' +
  '.reward{display:flex;gap:28px;flex-wrap:wrap;align-items:flex-end}' +
  '.rv{font-size:28px;font-weight:800;color:#B08A1E;font-variant-numeric:tabular-nums}' +
  '.rv.dim{font-size:20px;color:#6B7A72}' +
  '.rl{font-size:11px;color:#8A968E}' +
  '.goalrow{display:flex;align-items:baseline;gap:6px;margin-bottom:8px}' +
  '.gnum{font-size:30px;font-weight:800;color:#00A63E;font-variant-numeric:tabular-nums}' +
  '.gden{color:#8A968E;font-size:14px}' +
  '.gpct{margin-left:auto;font-weight:700;color:#00A63E;font-size:14px}' +
  '.pbar{height:10px;background:#EAF1EB;border-radius:99px;overflow:hidden}' +
  '.pfill{height:100%;background:linear-gradient(90deg,#00A63E,#3ED47A);border-radius:99px}' +
  '.rankrow{display:flex;align-items:baseline;gap:4px}' +
  '.rankbig{font-size:40px;font-weight:800;color:#00A63E;font-variant-numeric:tabular-nums}' +
  '.rankunit{font-size:16px;font-weight:700}' +
  '.rankden{color:#8A968E;margin-left:4px}' +
  '.recs{display:flex;gap:14px;text-align:center}' +
  '.recs>div{flex:1}' +
  '.rv2{font-size:20px;font-weight:800;font-variant-numeric:tabular-nums}' +
  '.unit{font-size:12px;font-weight:600;color:#8A968E;margin-left:1px}' +
  '.chart{display:flex;align-items:flex-end;gap:2px;height:150px;overflow-x:auto;padding-bottom:2px}' +
  '.chart.small{height:96px}' +
  '.bcol{flex:1;min-width:8px;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%}' +
  '.bar{width:100%;background:linear-gradient(180deg,#3ED47A,#00A63E);border-radius:3px 3px 1px 1px;min-height:0}' +
  '.bar.alt{background:linear-gradient(180deg,#7FD9AC,#2FA168)}' +
  '.stack{width:100%;height:100%;display:flex;flex-direction:column;justify-content:flex-end}' +
  '.seg{width:100%}' +
  '.stack .seg:first-child{border-radius:3px 3px 0 0}' +
  '.bval{font-size:9px;color:#6B7A72;height:12px;font-variant-numeric:tabular-nums}' +
  '.blab{font-size:8px;color:#98A69E;height:12px;white-space:nowrap;transform:rotate(-45deg);margin-top:6px}' +
  '.blab2{font-size:9px;color:#98A69E;height:14px;margin-top:2px}' +
  '.legend{display:flex;flex-wrap:wrap;gap:4px 14px;margin-top:10px}' +
  '.legend span{font-size:11px;color:#6B7A72;white-space:nowrap}' +
  '.dot{display:inline-block;width:8px;height:8px;border-radius:99px;margin-right:4px}' +
  '.tbox{overflow-x:auto}' +
  'table{width:100%;border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums}' +
  'td,th{padding:7px 8px;border-top:1px solid #EEF2EF;text-align:left;white-space:nowrap}' +
  '.num{text-align:right;font-weight:700}' +
  'tr.thead td,tr.thead th{color:#8A968E;border-top:none;font-size:11px;font-weight:700}' +
  'a.open{color:#00A63E;font-weight:700;text-decoration:none;font-size:12px}' +
  '.foot{color:#98A69E;font-size:11px;text-align:center;margin-top:20px}';

function pageHead_(title) {
  return '<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + escapeHtmlAttr_(title) + '</title><style>' + PAGE_CSS + '</style></head><body><div class="wrap">';
}

// ────────────────────────────────────────────
// アフィリエイター専用 成果確認ページ
//   URL: …/exec?stats=<閲覧キー>&p=<7|30|90>
//   本人の数字だけを表示（LINE ID等の個人情報は一切出さない）
// ────────────────────────────────────────────
function renderStatsPage_(key, period) {
  if (!key) return invalidPage_();

  const qrs = getQrMap_();
  let found = null;
  for (const [id, qr] of Object.entries(qrs)) {
    if (qr.key && qr.key === key) {
      found = { id: id, name: qr.name, rate: qr.rate, goal: qr.goal, key: key };
      break;
    }
  }
  if (!found) return invalidPage_();
  const p = [7, 30, 90].indexOf(period) >= 0 ? period : 30;

  const now = new Date();
  const thisMonth = Utilities.formatDate(now, TZ, 'yyyy-MM');

  // 集計（本人の日別/時間帯/曜日）
  const dc = {};
  const hourCounts = new Array(24).fill(0);
  const wdCounts = new Array(7).fill(0);
  let total = 0;
  for (const r of collectRegRows_()) {
    if (r.id !== found.id) continue;
    dc[r.day] = (dc[r.day] || 0) + 1;
    hourCounts[r.hour]++;
    wdCounts[r.wd]++;
    total++;
  }

  const days = [];
  for (let i = p - 1; i >= 0; i--) days.push(gDay_(i));
  const today = gDay_(0);
  const yesterday = gDay_(1);
  const periodSum = sumOffsets_(dc, 0, p - 1);
  const prevSum = sumOffsets_(dc, p, 2 * p - 1);
  const last7 = sumOffsets_(dc, 0, 6);
  const prior7 = sumOffsets_(dc, 7, 13);

  // 月別
  const monthCounts = {};
  for (const [d, n] of Object.entries(dc)) {
    const m = d.substring(0, 7);
    monthCounts[m] = (monthCounts[m] || 0) + n;
  }
  const monthCount = monthCounts[thisMonth] || 0;

  // 記録
  let bestDay = null;
  let bestN = 0;
  for (const [d, n] of Object.entries(dc)) {
    if (n > bestN || (n === bestN && d > (bestDay || ''))) { bestDay = d; bestN = n; }
  }
  let streak = 0;
  {
    let i = (dc[today] || 0) > 0 ? 0 : 1;
    while ((dc[gDay_(i)] || 0) > 0) { streak++; i++; }
  }

  const esc = escapeHtmlAttr_;
  const yen = n => '¥' + Math.round(n).toLocaleString('ja-JP');
  const base = webAppBase_();

  // 期間タブ
  const pills = '<div class="pills">' + [7, 30, 90].map(n =>
    '<a class="pill' + (n === p ? ' on' : '') + '" href="' +
    esc(base + '?stats=' + found.key + '&p=' + n) + '">直近' + n + '日</a>').join('') + '</div>';

  // KPIタイル
  const stats =
    '<div class="stat"><div class="sv">' + periodSum + '</div><div class="sl">直近' + p + '日</div>' + deltaChip_(periodSum, prevSum) + '</div>' +
    '<div class="stat"><div class="sv">' + (dc[today] || 0) + '</div><div class="sl">今日</div></div>' +
    '<div class="stat"><div class="sv">' + (dc[yesterday] || 0) + '</div><div class="sl">昨日</div></div>' +
    '<div class="stat"><div class="sv">' + total + '</div><div class="sl">累計</div></div>';

  // 見込み報酬（単価設定時のみ）
  let rewardHtml = '';
  if (found.rate > 0) {
    rewardHtml = '<div class="panel"><div class="ph">見込み報酬</div><div class="reward">' +
      '<div><div class="rv">' + yen(found.rate * monthCount) + '</div><div class="rl">今月 ・ ' + monthCount + '件 × ' + yen(found.rate) + '</div></div>' +
      '<div><div class="rv dim">' + yen(found.rate * total) + '</div><div class="rl">累計</div></div>' +
      '</div><div class="note">確定額はお支払い時のご案内が正となります</div></div>';
  }

  // 目標（設定時のみ）
  let goalHtml = '';
  if (found.goal > 0) {
    const pct = Math.min(100, Math.round((monthCount / found.goal) * 100));
    goalHtml = '<div class="panel"><div class="ph">今月の目標</div>' +
      '<div class="goalrow"><span class="gnum">' + monthCount + '</span>' +
      '<span class="gden">/ ' + found.goal + '件</span>' +
      '<span class="gpct">' + pct + '%' + (pct >= 100 ? ' 達成' : '') + '</span></div>' +
      '<div class="pbar"><div class="pfill" style="width:' + pct + '%"></div></div></div>';
  }

  // 記録
  const recordHtml = '<div class="panel"><div class="ph">記録</div><div class="recs">' +
    '<div><div class="rv2">' + (bestDay ? bestN + '<span class="unit">件</span>' : '—') + '</div><div class="sl">ベスト日' + (bestDay ? ' ' + esc(bestDay.substring(5).replace('-', '/')) : '') + '</div></div>' +
    '<div><div class="rv2">' + streak + '<span class="unit">日</span></div><div class="sl">連続登録中</div></div>' +
    '<div><div class="rv2">' + deltaChip_(last7, prior7) + '</div><div class="sl">前週比</div></div>' +
    '</div></div>';

  // 期間グラフ
  const maxDaily = Math.max(1, ...days.map(d => dc[d] || 0));
  const bars = days.map(d => {
    const n = dc[d] || 0;
    const h = Math.round((n / maxDaily) * 100);
    return '<div class="bcol" title="' + esc(d) + '：' + n + '件">' +
      '<div class="bval">' + (n || '') + '</div>' +
      '<div class="bar" style="height:' + Math.max(h, n ? 4 : 0) + '%"></div>' +
      '<div class="blab">' + esc(d.substring(5).replace('-', '/')) + '</div></div>';
  }).join('');

  // 時間帯・曜日
  const maxHour = Math.max(1, ...hourCounts);
  const hourBars = hourCounts.map((n, h) => {
    const hh = Math.round((n / maxHour) * 100);
    return '<div class="bcol" title="' + h + '時台：' + n + '件">' +
      '<div class="bar alt" style="height:' + Math.max(hh, n ? 4 : 0) + '%"></div>' +
      '<div class="blab2">' + (h % 3 === 0 ? h : '') + '</div></div>';
  }).join('');
  const wdLabels = ['月', '火', '水', '木', '金', '土', '日'];
  const maxWd = Math.max(1, ...wdCounts);
  const wdBars = wdCounts.map((n, i) => {
    const hh = Math.round((n / maxWd) * 100);
    return '<div class="bcol" title="' + wdLabels[i] + '曜：' + n + '件">' +
      '<div class="bval">' + (n || '') + '</div>' +
      '<div class="bar alt" style="height:' + Math.max(hh, n ? 4 : 0) + '%"></div>' +
      '<div class="blab2">' + wdLabels[i] + '</div></div>';
  }).join('');

  // 表
  const tableRows = days.slice().reverse().map(d =>
    '<tr><td>' + esc(d.replace(/-/g, '.')) + '</td><td class="num">' + (dc[d] || 0) + '</td></tr>'
  ).join('');
  const monthRows = Object.keys(monthCounts).sort().reverse().slice(0, 12).map(m =>
    '<tr><td>' + esc(m.replace('-', '.')) + '</td><td class="num">' + monthCounts[m] +
    (found.rate > 0 ? '</td><td class="num">' + yen(found.rate * monthCounts[m]) : '') + '</td></tr>'
  ).join('');

  const html = pageHead_(found.name + ' 成果レポート') +
    '<div class="eyebrow">AFFILIATE REPORT</div>' +
    '<h1>' + esc(found.name) + '</h1>' +
    '<div class="upd">' + Utilities.formatDate(now, TZ, 'yyyy/MM/dd HH:mm') + ' 更新</div>' +
    '<div class="hero"><div class="hv">' + monthCount + '</div><div class="hl">今月の登録件数</div></div>' +
    pills +
    '<div class="stats">' + stats + '</div>' +
    goalHtml + rewardHtml + recordHtml +
    '<div class="panel"><div class="ph">日別登録数 — 直近' + p + '日</div><div class="chart">' + bars + '</div></div>' +
    '<div class="panel"><div class="ph">登録されやすい時間帯</div><div class="chart small">' + hourBars + '</div>' +
    '<div class="note">投稿する時間帯の参考に（全期間の合計）</div></div>' +
    '<div class="panel"><div class="ph">曜日別の傾向</div><div class="chart small">' + wdBars + '</div></div>' +
    '<div class="panel"><div class="ph">月別実績</div><div class="tbox"><table><tr class="thead"><td>月</td><td class="num">件数</td>' +
    (found.rate > 0 ? '<td class="num">見込み報酬</td>' : '') + '</tr>' +
    (monthRows || '<tr><td colspan="3" style="color:#98A69E">まだデータがありません</td></tr>') + '</table></div></div>' +
    '<div class="panel"><div class="ph">日別一覧 — 直近' + p + '日</div><div class="tbox"><table><tr class="thead"><td>日付</td><td class="num">登録数</td></tr>' +
    tableRows + '</table></div></div>' +
    '<div class="foot">このページはあなた専用のリンクです。URLの共有はご遠慮ください。</div>' +
    '</div></body></html>';

  return HtmlService.createHtmlOutput(html).setTitle(found.name + ' 成果レポート');
}

// ────────────────────────────────────────────
// 管理者ダッシュボード（?admin=管理キー）
//   全アフィリエイターの数字・比較・各専用ページへのリンク
// ────────────────────────────────────────────
function renderAdminPage_() {
  const qrs = getQrMap_();
  const ids = Object.keys(qrs);
  const now = new Date();
  const thisMonth = Utilities.formatDate(now, TZ, 'yyyy-MM');
  const lastMonthKey = Utilities.formatDate(
    new Date(now.getFullYear(), now.getMonth() - 1, 15), TZ, 'yyyy-MM');

  // 集計
  const perDay = {};
  const dcAll = {};
  const hourAll = new Array(24).fill(0);
  const wdAll = new Array(7).fill(0);
  const totals = {};
  const monthCur = {};
  const monthPrev = {};
  let totalAll = 0;
  for (const r of collectRegRows_()) {
    (perDay[r.id] = perDay[r.id] || {})[r.day] = ((perDay[r.id] || {})[r.day] || 0) + 1;
    dcAll[r.day] = (dcAll[r.day] || 0) + 1;
    hourAll[r.hour]++;
    wdAll[r.wd]++;
    totals[r.id] = (totals[r.id] || 0) + 1;
    totalAll++;
    const m = r.day.substring(0, 7);
    if (m === thisMonth) monthCur[r.id] = (monthCur[r.id] || 0) + 1;
    if (m === lastMonthKey) monthPrev[r.id] = (monthPrev[r.id] || 0) + 1;
  }

  const esc = escapeHtmlAttr_;
  const base = webAppBase_();
  const days = [];
  for (let i = 29; i >= 0; i--) days.push(gDay_(i));

  // KPI
  const t0 = dcAll[gDay_(0)] || 0;
  const t1 = dcAll[gDay_(1)] || 0;
  const w7 = sumOffsets_(dcAll, 0, 6);
  const w7p = sumOffsets_(dcAll, 7, 13);
  const d30 = sumOffsets_(dcAll, 0, 29);
  const d30p = sumOffsets_(dcAll, 30, 59);
  const monthAll = ids.reduce((s, id) => s + (monthCur[id] || 0), 0);

  const stats =
    '<div class="stat"><div class="sv">' + t0 + '</div><div class="sl">今日</div>' + deltaChip_(t0, t1) + '</div>' +
    '<div class="stat"><div class="sv">' + w7 + '</div><div class="sl">直近7日</div>' + deltaChip_(w7, w7p) + '</div>' +
    '<div class="stat"><div class="sv">' + d30 + '</div><div class="sl">直近30日</div>' + deltaChip_(d30, d30p) + '</div>' +
    '<div class="stat"><div class="sv">' + totalAll + '</div><div class="sl">累計</div></div>';

  // アフィリエイター別テーブル（今月順）
  const palette = ['#00A63E', '#3B82F6', '#F59E0B', '#EF4444', '#8B5CF6', '#14B8A6', '#EC4899', '#84CC16'];
  const colorOf = {};
  ids.forEach((id, i) => colorOf[id] = palette[i % palette.length]);

  const list = ids.map(id => {
    const d = perDay[id] || {};
    return {
      id: id, name: qrs[id].name, key: qrs[id].key,
      today: d[gDay_(0)] || 0,
      w7: sumOffsets_(d, 0, 6), w7p: sumOffsets_(d, 7, 13),
      month: monthCur[id] || 0, lastM: monthPrev[id] || 0,
      total: totals[id] || 0,
    };
  }).sort((a, b) => b.month - a.month || b.total - a.total);

  const tableRows = list.map((x, i) => {
    const share = monthAll > 0 ? Math.round((x.month / monthAll) * 100) : 0;
    return '<tr>' +
      '<td>' + (i + 1) + '</td>' +
      '<td><span class="dot" style="background:' + colorOf[x.id] + '"></span>' + esc(x.name) + '</td>' +
      '<td class="num">' + x.today + '</td>' +
      '<td class="num">' + x.w7 + '</td>' +
      '<td>' + deltaChip_(x.w7, x.w7p) + '</td>' +
      '<td class="num">' + x.month + '</td>' +
      '<td class="num">' + share + '%</td>' +
      '<td class="num">' + x.lastM + '</td>' +
      '<td class="num">' + x.total + '</td>' +
      '<td>' + (x.key ? '<a class="open" href="' + esc(base + '?stats=' + x.key) + '">開く</a>' : '') + '</td>' +
      '</tr>';
  }).join('');

  // 日別×アフィリエイター積み上げグラフ（直近30日）
  const dayTotals = days.map(d => ids.reduce((s, id) => s + ((perDay[id] || {})[d] || 0), 0));
  const maxT = Math.max(1, ...dayTotals);
  const bars = days.map((d, di) => {
    const segs = ids.map(id => {
      const n = (perDay[id] || {})[d] || 0;
      if (!n) return '';
      return '<div class="seg" style="height:' + ((n / maxT) * 100).toFixed(1) + '%;background:' + colorOf[id] + '"></div>';
    }).join('');
    return '<div class="bcol" title="' + esc(d) + '：' + dayTotals[di] + '件">' +
      '<div class="bval">' + (dayTotals[di] || '') + '</div>' +
      '<div class="stack">' + segs + '</div>' +
      '<div class="blab">' + esc(d.substring(5).replace('-', '/')) + '</div></div>';
  }).join('');
  const legend = '<div class="legend">' + list.map(x =>
    '<span><span class="dot" style="background:' + colorOf[x.id] + '"></span>' + esc(x.name) + '</span>').join('') + '</div>';

  // 時間帯・曜日（全体）
  const maxHour = Math.max(1, ...hourAll);
  const hourBars = hourAll.map((n, h) => {
    const hh = Math.round((n / maxHour) * 100);
    return '<div class="bcol" title="' + h + '時台：' + n + '件">' +
      '<div class="bar alt" style="height:' + Math.max(hh, n ? 4 : 0) + '%"></div>' +
      '<div class="blab2">' + (h % 3 === 0 ? h : '') + '</div></div>';
  }).join('');
  const wdLabels = ['月', '火', '水', '木', '金', '土', '日'];
  const maxWd = Math.max(1, ...wdAll);
  const wdBars = wdAll.map((n, i) => {
    const hh = Math.round((n / maxWd) * 100);
    return '<div class="bcol" title="' + wdLabels[i] + '曜：' + n + '件">' +
      '<div class="bval">' + (n || '') + '</div>' +
      '<div class="bar alt" style="height:' + Math.max(hh, n ? 4 : 0) + '%"></div>' +
      '<div class="blab2">' + wdLabels[i] + '</div></div>';
  }).join('');

  const html = pageHead_('全体ダッシュボード') +
    '<div class="eyebrow">ADMIN DASHBOARD</div>' +
    '<h1>全体ダッシュボード</h1>' +
    '<div class="upd">' + Utilities.formatDate(now, TZ, 'yyyy/MM/dd HH:mm') + ' 更新</div>' +
    '<div class="hero"><div class="hv">' + monthAll + '</div><div class="hl">今月の登録件数（全体）</div></div>' +
    '<div class="stats">' + stats + '</div>' +
    '<div class="panel"><div class="ph">アフィリエイター別（今月順）</div><div class="tbox"><table>' +
    '<tr class="thead"><td>#</td><td>名前</td><td class="num">今日</td><td class="num">7日</td><td>前週比</td>' +
    '<td class="num">今月</td><td class="num">シェア</td><td class="num">先月</td><td class="num">累計</td><td></td></tr>' +
    (tableRows || '<tr><td colspan="10" style="color:#98A69E">QR設定シートが空です</td></tr>') +
    '</table></div></div>' +
    '<div class="panel"><div class="ph">日別登録数 — 直近30日（アフィリエイター別）</div><div class="chart">' + bars + '</div>' + legend + '</div>' +
    '<div class="panel"><div class="ph">登録されやすい時間帯（全体）</div><div class="chart small">' + hourBars + '</div></div>' +
    '<div class="panel"><div class="ph">曜日別の傾向（全体）</div><div class="chart small">' + wdBars + '</div></div>' +
    '<div class="foot">管理者専用ページです。URLは共有しないでください。</div>' +
    '</div></body></html>';

  return HtmlService.createHtmlOutput(html).setTitle('全体ダッシュボード');
}
