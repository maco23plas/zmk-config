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
  DEALS: '成約ログ',
  CUSTOMERS: '顧客',
  IMPORT: '取込',
  MEETINGS: '面談ログ',
};

// 面談ログの「結果」欄の選択肢
const MEETING_RESULTS = ['予約済', '実施済', '成約', '非成約', '追客', 'キャンセル'];
const MEETING_HEADERS = ['面談日', '相手の名前（LINE名）', 'QR ID（空欄なら名前から自動判定）', '結果', 'メモ'];

// 顧客シートのステータス（面談後にここを変えると全画面に反映される）
const STATUSES = ['未対応', '予約済', '面談済', '成約', '非成約', '追客', '離脱'];
/**
 * ステータス名を意味で判定する（エルメ側で自由に名付けたステータスにも追随する）
 * 例:「クロージング_成約」→ 成約、「非成約（見送り）」→ 非成約 として扱う
 */
function classifyStatus_(s) {
  const t = String(s || '').trim();
  const out = { met: false, done: false, won: false, lost: false };
  if (!t) return out;
  if (/非成約|失注|見送|不成立|お断り/.test(t)) { out.met = true; out.done = true; out.lost = true; return out; }
  if (/成約|受注|契約|申込/.test(t)) { out.met = true; out.done = true; out.won = true; return out; }
  if (/追客|検討|保留|再アプローチ/.test(t)) { out.met = true; out.done = true; return out; }
  if (/面談済|実施済|商談済|対応済|完了/.test(t)) { out.met = true; out.done = true; return out; }
  if (/予約|アポ|日程確定/.test(t)) { out.met = true; return out; }
  return out;
}

const CUSTOMER_HEADERS = [
  'LINE ID', 'LINE名', 'QR ID', 'QR名', '登録日時', '面談予約日時', 'ステータス', 'メモ', '更新日時',
];

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
    .addSeparator()
    .addItem('⑥ 取込シートを反映（CSV貼り付け後に実行）', 'importPastedData')
    .addItem('⑦ 顧客シートを登録ログから補完', 'syncCustomersFromRegs')
    .addItem('⑧ 面談予約を取り込む（予約シート）', 'syncReservations')
    .addItem('⑨ 面談予約を取り込む（カレンダー・予備）', 'syncCalendar')
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
  ['RESERVATION_SHEET_URL', '', '★エルメの予約機能が自動生成した「予約用スプレッドシート」のURL（サロン・面談予約 →スプレッドシート連携）。ここを埋めると面談予約が1時間おきに自動で顧客シートへ入る'],
  ['CALENDAR_ID', '', '面談予約が入るGoogleカレンダーのID。空ならメインカレンダー'],
  ['CALENDAR_FILTER', 'クロージング', 'この文字が予定タイトルに含まれる予定だけ面談として取り込む。空にすると全ての予定が対象になるので注意'],
  ['CALENDAR_SYNC', 'ON', 'カレンダーから面談予約を自動取得する（ON/OFF）。1時間おきに実行'],
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

  // 成約ログ（成約が出たら1行追加するだけ：日付・QR ID・メモ）
  const dealSh = ensureSheet_(ss, SHEETS.DEALS,
    ['日付（例 2026-08-15）', 'QR ID（ドロップダウンで選択）', 'メモ（任意）']);
  const idList = Object.keys(getQrMap_());
  if (idList.length) {
    dealSh.getRange(2, 2, 999, 1).setDataValidation(
      SpreadsheetApp.newDataValidation()
        .requireValueInList(idList, true)
        .setAllowInvalid(true)
        .build());
  }

  // 顧客シート（1人1行。面談予約日時とステータスをここで管理する）
  const cus = ensureSheet_(ss, SHEETS.CUSTOMERS, CUSTOMER_HEADERS);
  cus.getRange(2, 7, 2000, 1).setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInList(STATUSES, true)
      .setAllowInvalid(true)
      .build());
  if (idList.length) {
    cus.getRange(2, 3, 2000, 1).setDataValidation(
      SpreadsheetApp.newDataValidation()
        .requireValueInList(idList, true)
        .setAllowInvalid(true)
        .build());
  }
  cus.setColumnWidth(1, 240).setColumnWidth(2, 140).setColumnWidth(4, 200)
    .setColumnWidth(5, 150).setColumnWidth(6, 150).setColumnWidth(8, 240);

  // 面談ログ（面談が決まった／終わったら1行足すだけ）
  const met = ensureSheet_(ss, SHEETS.MEETINGS, MEETING_HEADERS);
  met.getRange(2, 4, 2000, 1).setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInList(MEETING_RESULTS, true).setAllowInvalid(true).build());
  if (idList.length) {
    met.getRange(2, 3, 2000, 1).setDataValidation(
      SpreadsheetApp.newDataValidation()
        .requireValueInList(idList, true).setAllowInvalid(true).build());
  }
  met.setColumnWidth(1, 120).setColumnWidth(2, 220).setColumnWidth(3, 250)
    .setColumnWidth(4, 110).setColumnWidth(5, 260);

  // 取込シート（エルメのCSVをそのまま貼り付ける場所）
  const imp = ensureSheet_(ss, SHEETS.IMPORT, ['ここにエルメのCSVを貼り付けて、メニュー⑥を実行してください']);
  if (imp.getLastRow() <= 1) {
    imp.getRange(1, 1).setValue(
      'ここにエルメのCSV（友だち情報 or 予約情報）を1行目のヘッダーごと貼り付けて、メニュー「⑥ 取込シートを反映」を実行してください。' +
      '／ 認識できる列: ユーザーID・LINE表示名・友だち追加日・流入経路・対応ステータス・予約日時 など')
      .setWrap(true).setFontColor('#8A968E');
    imp.setColumnWidth(1, 900);
  }

  // 毎日トリガーを（再）登録
  const hour = Number(getConfig_().REPORT_HOUR) || 9;
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'dailyReport')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('dailyReport').timeBased().atHour(hour).everyDays(1).create();

  // 面談予約の取り込みは1時間おきに自動実行（予約シート／カレンダー）
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'syncCalendarQuiet' ||
                 t.getHandlerFunction() === 'syncBookingsQuiet')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncBookingsQuiet').timeBased().everyHours(1).create();

  // ここまでで土台が揃うので、続けて顧客シートの構築と面談予約の取り込みまで自動で行う
  let extra = '';
  try {
    syncCustomersFromRegs();
    extra += ' 顧客シートを構築しました。';
  } catch (err) {
    console.error('顧客シート補完に失敗: ' + err);
  }
  try {
    const n = syncBookingsQuiet();
    if (n) extra += ' 面談予約 ' + n + ' 件を取り込みました。';
  } catch (err) {
    console.error('面談予約の取り込みに失敗: ' + err);
  }
  toast_('セットアップ完了。毎日 ' + hour + ' 時ごろに集計されます。' + extra);
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
    '★成果確認ページURL（本人にだけ送る）',
    '★配布用リンク（アフィリエイターがプロフ等に貼るURL・クリック計測用）',
    '配布用QR画像プレビュー',
    'QR画像ダウンロード（開いて右クリック保存）',
  ]];
  const qrs = getQrMap_();
  for (const [id, qr] of Object.entries(qrs)) {
    const clickUrl = base + '?id=' + id;
    const qrImg = 'https://api.qrserver.com/v1/create-qr-code/?size=600x600&margin=2&data=' +
      encodeURIComponent(clickUrl);
    rows.push([
      id, qr.name,
      base + '?ev=reg&id=' + id,
      qr.key ? base + '?stats=' + qr.key : '(①を実行するとキーが生成されます)',
      clickUrl,
      '=IMAGE("' + qrImg + '")',
      qrImg,
    ]);
  }
  const ak = String(getConfig_().ADMIN_KEY || '').trim();
  rows.push(['', '', '', '', '', '', '']);
  rows.push(['(管理者)', '全体ダッシュボード ※自分専用・共有禁止', '',
    ak ? base + '?admin=' + ak : '(①を実行するとキーが生成されます)', '', '', '']);
  sh.getRange(1, 1, rows.length, 7).setValues(rows);
  sh.setFrozenRows(1);
  sh.setColumnWidth(1, 110).setColumnWidth(2, 200).setColumnWidth(3, 440)
    .setColumnWidth(4, 440).setColumnWidth(5, 440).setColumnWidth(6, 140).setColumnWidth(7, 440);
  if (rows.length > 2) sh.setRowHeights(2, rows.length - 2, 130);
  toast_('URL一覧を生成しました。C列→エルメ／D列→本人の成果ページ／E列とF列→配布用リンク・QR。');
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
    // 顧客シートにも1人1行で反映（LINE IDが送られてきた場合のみ）
    try {
      const lineId = pickLineId_(p);
      if (lineId) {
        upsertCustomer_({
          lineId: lineId,
          name: pickLineName_(p),
          qrId: id,
          qrName: qr ? qr.name : '',
          registeredAt: new Date(),
        });
      }
    } catch (err) {
      console.error('顧客シート反映失敗: ' + err);
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

// ════════════════════════════════════════════
// 顧客シート（LINE IDで名寄せするCRM層）
//   登録 → 面談予約 → 成約 までを1人1行で追跡する
// ════════════════════════════════════════════

/** 受信パラメータからLINE IDらしき値を取り出す（U＋32桁の16進） */
function pickLineId_(params) {
  for (const k of Object.keys(params || {})) {
    const v = String(params[k] || '').trim();
    if (/^U[0-9a-f]{32}$/i.test(v)) return v;
  }
  return '';
}

/** 受信パラメータから表示名らしき値を取り出す */
function pickLineName_(params) {
  const keys = Object.keys(params || {});
  const prefer = keys.filter(k => /name|名前|表示名|nick/i.test(k));
  for (const k of prefer.concat(keys)) {
    if (k === 'ev' || k === 'id' || k === 'p' || k === 'stats' || k === 'admin') continue;
    const v = String(params[k] || '').trim();
    if (!v) continue;
    if (/^U[0-9a-f]{32}$/i.test(v)) continue;   // LINE ID
    if (/^(new|old|block)$/i.test(v)) continue; // 友だち追加情報
    if (v.indexOf('@') >= 0) continue;          // メールアドレス
    return v;
  }
  return '';
}

/** 顧客シートを丸ごと読む */
function readCustomers_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ensureSheet_(ss, SHEETS.CUSTOMERS, CUSTOMER_HEADERS);
  const rows = sh.getLastRow() > 1
    ? sh.getRange(2, 1, sh.getLastRow() - 1, CUSTOMER_HEADERS.length).getValues()
    : [];
  const byId = {};
  const byName = {};
  rows.forEach((v, i) => {
    const id = String(v[0]).trim();
    const nm = String(v[1]).trim();
    if (id) byId[id] = i;
    if (nm && byName[nm] === undefined) byName[nm] = i;
  });
  return { sheet: sh, rows: rows, byId: byId, byName: byName };
}

/** 顧客1行に情報をマージする（空欄の項目は既存値を壊さない） */
function mergeCustomerRow_(v, f, now) {
  const set = (i, val, overwrite) => {
    if (val === undefined || val === null || val === '') return;
    if (overwrite || !String(v[i]).trim()) v[i] = val;
  };
  if (f.lineId) v[0] = f.lineId;
  set(1, f.name);
  set(2, f.qrId);
  set(3, f.qrName);
  set(4, f.registeredAt);
  set(5, f.meetingAt, true);                 // 面談予約日時は新しい情報で上書き
  set(6, f.status, !!f.statusOverwrite);     // ステータスは手動編集を尊重（CSV由来のみ上書き）
  set(7, f.memo);
  v[8] = now;
  return v;
}

/** 顧客を1件upsert（Webアプリからのリアルタイム記録用） */
function upsertCustomer_(fields) {
  if (!fields || !fields.lineId) return;
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const cs = readCustomers_();
    const now = new Date();
    const idx = cs.byId[fields.lineId];
    if (idx !== undefined) {
      const merged = mergeCustomerRow_(cs.rows[idx].slice(), fields, now);
      cs.sheet.getRange(idx + 2, 1, 1, CUSTOMER_HEADERS.length).setValues([merged]);
    } else {
      const merged = mergeCustomerRow_(new Array(CUSTOMER_HEADERS.length).fill(''), fields, now);
      if (!merged[6]) merged[6] = STATUSES[0];
      cs.sheet.appendRow(merged);
    }
  } finally {
    lock.releaseLock();
  }
}

/** CSVのヘッダー名 → 内部フィールド名 */
function headerKind_(cell) {
  const s = String(cell || '').trim().replace(/\s+/g, '');
  if (!s) return '';
  if (/ユーザーID|LINEID|lineId|userId/i.test(s)) return 'lineId';
  if (/表示名|LINE名|ニックネーム|お名前|氏名|^名前$/i.test(s)) return 'name';
  if (/友だち追加日|登録日|追加日時/.test(s)) return 'registeredAt';
  if (/流入経路|経路|流入元/.test(s)) return 'route';
  if (/対応マーク|対応ステータス|ステータス|対応状況|商談状況/.test(s)) return 'status';
  if (/予約日|予約日時|面談日|面談日時|開始日時|来店日/.test(s)) return 'meetingAt';
  if (/メモ|備考/.test(s)) return 'memo';
  return '';
}

/** 流入経路の文字列 → QR ID */
function routeToQrId_(route, qrs) {
  const r = String(route || '').trim();
  if (!r) return '';
  const ids = Object.keys(qrs);
  for (const id of ids) if (r === String(qrs[id].name).trim()) return id;   // 完全一致
  for (const id of ids) if (r.indexOf(id) >= 0) return id;                  // IDが含まれる
  const m = r.match(/(?:アフィ|affi)[\s_]*0*(\d+)/i);                        // 番号で照合
  if (m) {
    const n = Number(m[1]);
    for (const id of ids) {
      const idn = String(id).match(/(\d+)/);
      const nmn = String(qrs[id].name).match(/(?:アフィ|affi)[\s_]*0*(\d+)/i);
      if ((idn && Number(idn[1]) === n) || (nmn && Number(nmn[1]) === n)) return id;
    }
  }
  return '';
}

/** 登録ログに既に存在する「LINE ID」と「QR ID＋分単位の日時」の集合を作る（二重取込の防止） */
function existingRegKeys_() {
  const ids = {};
  const stamps = {};
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.REGS);
  if (!sh || sh.getLastRow() < 2) return { ids: ids, stamps: stamps };
  const values = sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues();
  for (const [when, qid, , note] of values) {
    const m = String(note || '').match(/U[0-9a-f]{32}/i);
    if (m) ids[m[0]] = true;
    if (when instanceof Date) {
      stamps[String(qid).trim() + '@' + Utilities.formatDate(when, TZ, 'yyyy-MM-dd HH:mm')] = true;
    }
  }
  return { ids: ids, stamps: stamps };
}

/** 値を日付に変換（Dateならそのまま、文字列なら緩めにパース） */
function toDate_(v) {
  if (v instanceof Date) return v;
  const s = String(v || '').trim();
  if (!s) return null;
  const m = s.match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]),
    Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
}

// ────────────────────────────────────────────
// ⑥ 取込シートに貼ったCSVを反映（顧客シート＋登録ログの穴埋め）
// ────────────────────────────────────────────
function importPastedData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SHEETS.IMPORT);
  if (!sh || sh.getLastRow() < 2) {
    toast_('「取込」シートにエルメのCSVを貼り付けてから⑥を実行してください。');
    return;
  }
  const all = sh.getDataRange().getValues();

  // ヘッダー行を探す（認識できる列名が2つ以上ある行）
  let hi = -1;
  for (let i = 0; i < Math.min(all.length, 12); i++) {
    if (all[i].filter(c => headerKind_(c)).length >= 2) { hi = i; break; }
  }
  if (hi < 0) {
    toast_('ヘッダー行が見つかりません。エルメのCSVを見出し行ごと貼り付けてください。');
    return;
  }
  const kinds = all[hi].map(c => headerKind_(c));
  if (kinds.indexOf('lineId') < 0 && kinds.indexOf('name') < 0) {
    toast_('「ユーザーID」または「表示名」の列が必要です。CSVの出力項目を確認してください。');
    return;
  }

  const qrs = getQrMap_();
  const cs = readCustomers_();
  const reg = existingRegKeys_();
  const now = new Date();
  const newRegRows = [];
  let updated = 0;
  let added = 0;
  let backfilled = 0;
  let noRoute = 0;

  for (let i = hi + 1; i < all.length; i++) {
    const row = all[i];
    const f = {};
    kinds.forEach((k, c) => { if (k) f[k] = row[c]; });
    const lineId = String(f.lineId || '').trim();
    const name = String(f.name || '').trim();
    if (!lineId && !name) continue;

    const qrId = routeToQrId_(f.route, qrs);
    if (f.route && !qrId) noRoute++;
    const regAt = toDate_(f.registeredAt);
    const metAt = toDate_(f.meetingAt);
    const status = String(f.status || '').trim();

    const fields = {
      lineId: lineId,
      name: name,
      qrId: qrId,
      qrName: qrId && qrs[qrId] ? qrs[qrId].name : '',
      registeredAt: regAt || '',
      meetingAt: metAt || '',
      status: status,
      statusOverwrite: !!status,   // CSVにステータス列があるときだけ上書き
      memo: String(f.memo || '').trim(),
    };

    // 顧客シートへ反映（LINE ID優先、無ければ表示名で照合）
    let idx = lineId ? cs.byId[lineId] : undefined;
    if (idx === undefined && name) idx = cs.byName[name];
    if (idx !== undefined) {
      cs.rows[idx] = mergeCustomerRow_(cs.rows[idx], fields, now);
      updated++;
    } else {
      const v = mergeCustomerRow_(new Array(CUSTOMER_HEADERS.length).fill(''), fields, now);
      if (!v[6]) v[6] = STATUSES[0];
      cs.rows.push(v);
      if (lineId) cs.byId[lineId] = cs.rows.length - 1;
      if (name) cs.byName[name] = cs.rows.length - 1;
      added++;
    }

    // 登録ログの穴埋め（計測が止まっていた期間の登録を復元。重複は入れない）
    if (qrId && regAt) {
      const stampKey = qrId + '@' + Utilities.formatDate(regAt, TZ, 'yyyy-MM-dd HH:mm');
      const dupe = (lineId && reg.ids[lineId]) || reg.stamps[stampKey];
      if (!dupe) {
        newRegRows.push([regAt, qrId, qrs[qrId].name,
          JSON.stringify({ src: 'CSV取込', lineId: lineId, name: name })]);
        if (lineId) reg.ids[lineId] = true;
        reg.stamps[stampKey] = true;
        backfilled++;
      }
    }
  }

  // まとめて書き込み
  if (cs.rows.length) {
    cs.sheet.getRange(2, 1, cs.rows.length, CUSTOMER_HEADERS.length).setValues(cs.rows);
  }
  if (newRegRows.length) {
    const rsh = ensureSheet_(ss, SHEETS.REGS, ['日時', 'QR ID', 'QR名', '補足(生データ)']);
    rsh.getRange(rsh.getLastRow() + 1, 1, newRegRows.length, 4).setValues(newRegRows);
  }

  toast_('取込完了： 顧客 追加' + added + '件／更新' + updated + '件、登録ログ補完' + backfilled + '件' +
    (noRoute ? '（経路を判定できない行が' + noRoute + '件ありました）' : '') +
    '。④で画面を更新できます。');
}

// ────────────────────────────────────────────
// ⑦ 登録ログ（パラメーターエクスポート受信分）から顧客シートを補完
// ────────────────────────────────────────────
function syncCustomersFromRegs() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SHEETS.REGS);
  if (!sh || sh.getLastRow() < 2) { toast_('登録ログが空です。'); return; }
  const qrs = getQrMap_();
  const cs = readCustomers_();
  const now = new Date();
  const values = sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues();
  let added = 0;
  let updated = 0;

  for (const [when, qid, qname, note] of values) {
    let params = {};
    try { params = JSON.parse(String(note || '{}')); } catch (err) { params = {}; }
    const lineId = params.lineId || pickLineId_(params);
    if (!lineId) continue;
    const qrId = String(qid).trim();
    const fields = {
      lineId: lineId,
      name: params.name || pickLineName_(params),
      qrId: qrId,
      qrName: qrs[qrId] ? qrs[qrId].name : String(qname || ''),
      registeredAt: when instanceof Date ? when : '',
    };
    const idx = cs.byId[lineId];
    if (idx !== undefined) {
      cs.rows[idx] = mergeCustomerRow_(cs.rows[idx], fields, now);
      updated++;
    } else {
      const v = mergeCustomerRow_(new Array(CUSTOMER_HEADERS.length).fill(''), fields, now);
      v[6] = v[6] || STATUSES[0];
      cs.rows.push(v);
      cs.byId[lineId] = cs.rows.length - 1;
      added++;
    }
  }
  if (cs.rows.length) {
    cs.sheet.getRange(2, 1, cs.rows.length, CUSTOMER_HEADERS.length).setValues(cs.rows);
  }
  toast_('顧客シートを補完しました： 追加' + added + '件／更新' + updated + '件');
}

// ────────────────────────────────────────────
// ⑧ 面談予約の自動取り込み
//    エルメの予約機能（サロン・面談予約）のスプレッドシート連携で
//    自動生成されるシートを読み、予約者名で顧客を突き止めて
//    「面談予約日時」を埋める。1時間おきに自動実行。
// ────────────────────────────────────────────
function syncReservations() {
  const url = String(getConfig_().RESERVATION_SHEET_URL || '').trim();
  if (!url) {
    toast_('「設定」シートの RESERVATION_SHEET_URL に、エルメの予約用スプレッドシートのURLを貼ってください。');
    return 0;
  }
  let book;
  try {
    book = SpreadsheetApp.openByUrl(url);
  } catch (err) {
    toast_('予約用スプレッドシートを開けませんでした。URLと共有設定を確認してください。');
    return 0;
  }
  const sh = book.getSheetByName('シート1') || book.getSheets()[0];
  if (!sh || sh.getLastRow() < 2) { toast_('予約用スプレッドシートにデータがありません。'); return 0; }
  const all = sh.getDataRange().getValues();

  // ヘッダー行を探す（認識できる列名が1つ以上ある行）
  let hi = -1;
  for (let i = 0; i < Math.min(all.length, 8); i++) {
    if (all[i].filter(c => headerKind_(c)).length >= 1) { hi = i; break; }
  }
  if (hi < 0) { toast_('予約シートの見出し行を認識できませんでした。'); return 0; }
  const kinds = all[hi].map(c => headerKind_(c));

  const cs = readCustomers_();
  const nameIndex = buildNameIndex_(cs);
  const now = new Date();
  let matched = 0;
  let unmatched = 0;

  for (let i = hi + 1; i < all.length; i++) {
    const row = all[i];
    const f = {};
    kinds.forEach((k, c) => { if (k && f[k] === undefined) f[k] = row[c]; });
    const metAt = toDate_(f.meetingAt) || firstDateInRow_(row);
    if (!metAt) continue;

    const lineId = String(f.lineId || '').trim();
    let idx = lineId ? cs.byId[lineId] : undefined;
    if (idx === undefined) idx = matchByName_(nameIndex, String(f.name || '') || row.join(' '));
    if (idx === undefined) { unmatched++; continue; }

    const v = cs.rows[idx];
    const cur = v[5] instanceof Date ? v[5] : null;
    if (!cur || cur.getTime() !== metAt.getTime()) {
      v[5] = metAt;
      v[8] = now;
      if (!String(v[6]).trim() || String(v[6]).trim() === STATUSES[0]) v[6] = '予約済';
      matched++;
    }
  }

  if (cs.rows.length) {
    cs.sheet.getRange(2, 1, cs.rows.length, CUSTOMER_HEADERS.length).setValues(cs.rows);
  }
  toast_('予約取り込み： ' + matched + '件を顧客シートに反映' +
    (unmatched ? '／照合できない予約 ' + unmatched + '件（顧客シートに同名の友だちが居るか確認）' : ''));
  return matched;
}

/** 顧客の名前→行番号の索引（長い名前を優先して誤マッチを減らす） */
function buildNameIndex_(cs) {
  const idx = [];
  cs.rows.forEach((v, i) => {
    const nm = normalizeName_(v[1]);
    if (nm && nm.length >= 2) idx.push({ n: nm, i: i });
  });
  idx.sort((a, b) => b.n.length - a.n.length);
  return idx;
}

/** テキストに含まれる顧客名を探して行番号を返す */
function matchByName_(nameIndex, text) {
  const blob = normalizeName_(text);
  if (!blob) return undefined;
  for (const x of nameIndex) if (blob.indexOf(x.n) >= 0) return x.i;
  return undefined;
}

/** 行の中の最初の日付セルを拾う（列名が想定外でも予約日時を拾えるように） */
function firstDateInRow_(row) {
  for (const c of row) {
    if (c instanceof Date) return c;
  }
  for (const c of row) {
    const d = toDate_(c);
    if (d) return d;
  }
  return null;
}

// ────────────────────────────────────────────
// （予備）Googleカレンダー同期（面談予約を自動で顧客シートへ）
//    エルメの予約→Googleカレンダー連携で作られた予定を読み、
//    予約者名で顧客を突き止めて「面談予約日時」を埋める
// ────────────────────────────────────────────
function syncCalendar() {
  const conf = getConfig_();
  const calId = String(conf.CALENDAR_ID || '').trim();
  let cal = null;
  try {
    cal = calId ? CalendarApp.getCalendarById(calId) : CalendarApp.getDefaultCalendar();
  } catch (err) {
    cal = null;
  }
  if (!cal) {
    toast_('カレンダーが見つかりません。「設定」シートのCALENDAR_IDを確認してください。' +
      '別アカウントのカレンダーを見る場合は、そのカレンダーをこのスプレッドシートの所有者アカウントに共有してください。');
    return 0;
  }
  const filter = String(conf.CALENDAR_FILTER || '').trim();
  const from = new Date(Date.now() - 90 * 86400000);
  const to = new Date(Date.now() + 180 * 86400000);
  const events = cal.getEvents(from, to);

  const cs = readCustomers_();
  const nameIndex = buildNameIndex_(cs);
  const now = new Date();
  let matched = 0;
  let unmatched = 0;
  const unmatchedTitles = [];

  for (const ev of events) {
    const title = String(ev.getTitle() || '');
    if (filter && title.indexOf(filter) < 0) continue;
    const rawBlob = title + ' ' + (ev.getDescription() || '');

    // LINE IDが説明欄にあれば最優先で照合、無ければ名前で照合
    let idx;
    const m = rawBlob.match(/U[0-9a-f]{32}/i);
    if (m && cs.byId[m[0]] !== undefined) idx = cs.byId[m[0]];
    else idx = matchByName_(nameIndex, rawBlob);

    if (idx === undefined) {
      unmatched++;
      if (unmatchedTitles.length < 3) unmatchedTitles.push(title);
      continue;
    }
    const v = cs.rows[idx];
    const start = ev.getStartTime();
    const cur = v[5] instanceof Date ? v[5] : null;
    if (!cur || cur.getTime() !== start.getTime()) {
      v[5] = start;
      v[8] = now;
      if (!String(v[6]).trim() || String(v[6]).trim() === STATUSES[0]) v[6] = '予約済';
      matched++;
    }
  }

  if (cs.rows.length) {
    cs.sheet.getRange(2, 1, cs.rows.length, CUSTOMER_HEADERS.length).setValues(cs.rows);
  }
  toast_('カレンダー同期： ' + matched + '件の面談予約を顧客シートに反映' +
    (unmatched ? '／照合できない予定 ' + unmatched + '件（例: ' + unmatchedTitles.join(' / ') + '）' : ''));
  return matched;
}

/** 1時間おきの自動実行用（未設定・エラーでも静かに終わる） */
function syncBookingsQuiet() {
  const conf = getConfig_();
  let n = 0;
  if (String(conf.RESERVATION_SHEET_URL || '').trim()) {
    try {
      n += syncReservations() || 0;
    } catch (err) {
      console.error('予約シート同期失敗: ' + err);
    }
  }
  if (/^on$/i.test(String(conf.CALENDAR_SYNC || '').trim())) {
    try {
      n += syncCalendar() || 0;
    } catch (err) {
      // カレンダーの権限が未承認でも、他の集計は止めない
      console.error('カレンダー同期失敗: ' + err);
    }
  }
  return n;
}

/** 名前照合用の正規化（空白・記号を除去、全角英数を半角に、カタカナ揃え） */
function normalizeName_(s) {
  let t = String(s || '');
  t = t.replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  t = t.replace(/[\s　_\-・,、.。（）()【】\[\]「」]/g, '');
  return t.toLowerCase();
}

/**
 * QR別のファネル集計を作る。
 * 「顧客」シート（1人1行の台帳）と「面談ログ」（手入力の記録）の両方を見て、
 * 同じ人が二重に数えられないよう人単位でまとめる。
 */
function funnelByQr_() {
  const out = { any: false, byId: {} };
  const bucket = id => out.byId[id] ||
    (out.byId[id] = { people: 0, meeting: 0, done: 0, won: 0, lost: 0 });

  // 1) 顧客シート：全員の所属QRと、そこに直接書かれたステータス
  const people = {};           // キー（LINE名の正規化 or LINE ID）→ {qrId, met, done, won, lost}
  const nameToKey = {};
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.CUSTOMERS);
  if (sh && sh.getLastRow() > 1) {
    const rows = sh.getRange(2, 1, sh.getLastRow() - 1, CUSTOMER_HEADERS.length).getValues();
    for (const v of rows) {
      const qrId = String(v[2]).trim();
      if (!qrId) continue;
      const key = String(v[0]).trim() || normalizeName_(v[1]);
      if (!key) continue;
      const c = classifyStatus_(v[6]);
      people[key] = {
        qrId: qrId,
        met: !!v[5] || c.met,
        done: c.done, won: c.won, lost: c.lost,
      };
      const nm = normalizeName_(v[1]);
      if (nm && nm.length >= 2 && !nameToKey[nm]) nameToKey[nm] = key;
    }
  }

  // 2) 面談ログ：名前（またはQR ID）で本人に結び付けて上書き
  const msh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.MEETINGS);
  if (msh && msh.getLastRow() > 1) {
    const rows = msh.getRange(2, 1, msh.getLastRow() - 1, MEETING_HEADERS.length).getValues();
    for (let ri = 0; ri < rows.length; ri++) {
      const r = rows[ri];
      const nm = normalizeName_(r[1]);
      const explicitQr = String(r[2]).trim();
      if (!nm && !explicitQr) continue;
      const res = String(r[3]).trim();
      if (/キャンセル/.test(res)) continue;          // キャンセルは面談として数えない
      const c = classifyStatus_(res || '実施済');

      // 名前で本人を特定。名前が無い行はQR IDだけの匿名記録として1件ずつ数える
      const key = (nm && nameToKey[nm]) || nm || ('row:' + ri);
      const p = people[key] || (people[key] = { qrId: explicitQr, met: false, done: false, won: false, lost: false });
      if (!p.qrId) p.qrId = explicitQr;
      if (!p.qrId) continue;                          // 所属QRが分からない行は集計に入れない
      p.met = true;
      p.done = p.done || c.done;
      p.won = p.won || c.won;
      p.lost = p.lost || c.lost;
    }
  }

  // 3) 人単位で集計
  for (const key of Object.keys(people)) {
    const p = people[key];
    if (!p.qrId) continue;
    const b = bucket(p.qrId);
    b.people++;
    if (p.met) { b.meeting++; out.any = true; }
    if (p.done) b.done++;
    if (p.won) { b.won++; out.any = true; }
    if (p.lost) b.lost++;
  }
  return out;
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

  const deals = countByQr_(SHEETS.DEALS, targetDay);
  const dealsTotal = countByQr_(SHEETS.DEALS, null);

  const useRegs = hasRows_(SHEETS.REGS);     // 外部連携（実登録）を使っているか
  const useClicks = hasRows_(SHEETS.CLICKS); // リダイレクタ（クリック）を使っているか
  const useDeals = hasRows_(SHEETS.DEALS);   // 成約ログを使っているか

  const daily = ensureSheet_(ss, SHEETS.DAILY, ['日付', 'QR ID', 'QR名', '登録数', 'クリック数']);

  const lines = [];
  lines.push('📊 ' + (conf.REPORT_TITLE || 'QRコード流入レポート') + '（' + targetDay + '）');
  lines.push('');
  let dayRegSum = 0;
  let dayClickSum = 0;
  let dayDealSum = 0;
  for (const [id, qr] of Object.entries(qrs)) {
    const r = regs[id] || 0;
    const c = clicks[id] || 0;
    const g = deals[id] || 0;
    dayRegSum += r;
    dayClickSum += c;
    dayDealSum += g;
    const parts = [];
    if (useRegs) parts.push('登録 ' + r + ' 件（累計 ' + (regsTotal[id] || 0) + '）');
    if (useClicks) parts.push('クリック ' + c + ' 件（累計 ' + (clicksTotal[id] || 0) + '）');
    if (useDeals) parts.push('成約 ' + g + ' 件（累計 ' + (dealsTotal[id] || 0) + '）');
    if (!parts.length) parts.push('登録 0 件');
    lines.push('・' + qr.name + '： ' + parts.join(' ／ '));
    daily.appendRow([targetDay, id, qr.name, r, c]);
  }
  lines.push('');
  const sumParts = [];
  if (useRegs) sumParts.push('登録 ' + dayRegSum + ' 件');
  if (useClicks) sumParts.push('クリック ' + dayClickSum + ' 件');
  if (useDeals) sumParts.push('成約 ' + dayDealSum + ' 件');
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
  let rows = collectLogRows_(sheetName);
  if (sheetName === SHEETS.REGS) rows = dedupeRegRows_(rows);
  const out = {};
  for (const r of rows) {
    if (day && r.day !== day) continue;
    out[r.id] = (out[r.id] || 0) + 1;
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
  for (const r of collectRegRows_()) {   // 重複（再スキャン・同一LINE ID）は除外済み
    if (!counts[r.id]) counts[r.id] = {}; // QR設定から消えたIDも一応拾う
    counts[r.id][r.day] = (counts[r.id][r.day] || 0) + 1;
    if (!firstDay || r.day < firstDay) firstDay = r.day;
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
  return dedupeRegRows_(collectLogRows_(SHEETS.REGS));
}

/** 任意のログシートを {id, day, hour, wd, lineId, isOld} の配列で返す */
function collectLogRows_(sheetName) {
  const out = [];
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sh || sh.getLastRow() < 2) return out;
  const width = Math.min(4, sh.getLastColumn());
  for (const row of sh.getRange(2, 1, sh.getLastRow() - 1, width).getValues()) {
    const when = row[0];
    if (!(when instanceof Date)) continue;
    const note = String(row[3] || '');
    const m = note.match(/U[0-9a-f]{32}/i);
    out.push({
      id: String(row[1]).trim(),
      day: Utilities.formatDate(when, TZ, 'yyyy-MM-dd'),
      hour: Number(Utilities.formatDate(when, TZ, 'H')),
      wd: Number(Utilities.formatDate(when, TZ, 'u')) - 1,
      lineId: m ? m[0] : '',
      isOld: /"friend_type"\s*:\s*"old"/i.test(note),
    });
  }
  return out;
}

/**
 * 登録ログの重複を除く。
 *  - friend_type が "old"（既存の友だちがQRを読み直しただけ）の行を除外
 *  - 同じLINE IDが複数回記録されている場合は最初の1件だけ残す
 * これをしないと、同じ人が別のアフィリエイターの実績として二重計上される。
 */
function dedupeRegRows_(rows) {
  const seen = {};
  const out = [];
  for (const r of rows) {
    if (r.isOld) continue;
    if (r.lineId) {
      if (seen[r.lineId]) continue;
      seen[r.lineId] = true;
    }
    out.push(r);
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
  '.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(80px,1fr));gap:8px;margin-bottom:12px}' +
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
  '.fstep{position:relative;margin-bottom:6px;border-radius:10px;overflow:hidden;background:#F2F6F3}' +
  '.fbar{position:absolute;left:0;top:0;bottom:0;background:linear-gradient(90deg,rgba(0,166,62,.22),rgba(62,212,122,.30));border-radius:10px}' +
  '.frow{position:relative;display:flex;align-items:baseline;gap:10px;padding:8px 12px}' +
  '.flabel{font-size:12px;font-weight:700;min-width:64px}' +
  '.fnum{font-size:20px;font-weight:800;font-variant-numeric:tabular-nums}' +
  '.fpct{margin-left:auto;font-size:12px;font-weight:700;color:#00842F}' +
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

  // 期間タブ（GASのiframeサンドボックス内なので target="_top" 必須）
  const pills = '<div class="pills">' + [7, 30, 90].map(n =>
    '<a class="pill' + (n === p ? ' on' : '') + '" target="_top" href="' +
    esc(base + '?stats=' + found.key + '&p=' + n) + '">直近' + n + '日</a>').join('') + '</div>';

  // KPIタイル
  const stats =
    '<div class="stat"><div class="sv">' + periodSum + '</div><div class="sl">直近' + p + '日</div>' + deltaChip_(periodSum, prevSum) + '</div>' +
    '<div class="stat"><div class="sv">' + (dc[today] || 0) + '</div><div class="sl">今日</div></div>' +
    '<div class="stat"><div class="sv">' + (dc[yesterday] || 0) + '</div><div class="sl">昨日</div></div>' +
    '<div class="stat"><div class="sv">' + total + '</div><div class="sl">累計</div></div>';

  // クリック→登録率（クリック計測リンクを使っている人にだけ表示）
  const cdc = {};
  let clickTotal = 0;
  for (const r of collectLogRows_(SHEETS.CLICKS)) {
    if (r.id !== found.id) continue;
    cdc[r.day] = (cdc[r.day] || 0) + 1;
    clickTotal++;
  }
  let clickHtml = '';
  if (clickTotal > 0) {
    const cp = sumOffsets_(cdc, 0, p - 1);
    const rate = cp > 0 ? Math.round((periodSum / cp) * 100) : 0;
    clickHtml = '<div class="panel"><div class="ph">クリック → 登録（直近' + p + '日）</div><div class="recs">' +
      '<div><div class="rv2">' + cp + '<span class="unit">回</span></div><div class="sl">リンククリック</div></div>' +
      '<div><div class="rv2">' + periodSum + '<span class="unit">件</span></div><div class="sl">友だち登録</div></div>' +
      '<div><div class="rv2">' + rate + '<span class="unit">%</span></div><div class="sl">登録率</div></div>' +
      '</div></div>';
  }

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
    clickHtml + goalHtml + rewardHtml + recordHtml +
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

  // クリックログ（方式B併用時のみ列が出る）
  const perDayC = {};
  let clickAll = 0;
  for (const r of collectLogRows_(SHEETS.CLICKS)) {
    (perDayC[r.id] = perDayC[r.id] || {})[r.day] = ((perDayC[r.id] || {})[r.day] || 0) + 1;
    clickAll++;
  }
  const useClicks = clickAll > 0;

  // 成約ログ（入力があるときのみ列が出る）
  const dealTotals = {};
  const dealMonth = {};
  const dealMonthPrev = {};
  let dealAll = 0;
  for (const r of collectLogRows_(SHEETS.DEALS)) {
    dealTotals[r.id] = (dealTotals[r.id] || 0) + 1;
    const m = r.day.substring(0, 7);
    if (m === thisMonth) dealMonth[r.id] = (dealMonth[r.id] || 0) + 1;
    if (m === lastMonthKey) dealMonthPrev[r.id] = (dealMonthPrev[r.id] || 0) + 1;
    dealAll++;
  }
  const useDeals = dealAll > 0;

  // 顧客シート由来のファネル（面談予約・成約）
  const funnel = funnelByQr_();
  const useFunnel = funnel.any;

  // KPI
  const t0 = dcAll[gDay_(0)] || 0;
  const t1 = dcAll[gDay_(1)] || 0;
  const w7 = sumOffsets_(dcAll, 0, 6);
  const w7p = sumOffsets_(dcAll, 7, 13);
  const d30 = sumOffsets_(dcAll, 0, 29);
  const d30p = sumOffsets_(dcAll, 30, 59);
  const monthAll = ids.reduce((s, id) => s + (monthCur[id] || 0), 0);

  const dealMonthAll = ids.reduce((s, id) => s + (dealMonth[id] || 0), 0);
  const dealMonthPrevAll = ids.reduce((s, id) => s + (dealMonthPrev[id] || 0), 0);
  const stats =
    '<div class="stat"><div class="sv">' + t0 + '</div><div class="sl">今日</div>' + deltaChip_(t0, t1) + '</div>' +
    '<div class="stat"><div class="sv">' + w7 + '</div><div class="sl">直近7日</div>' + deltaChip_(w7, w7p) + '</div>' +
    '<div class="stat"><div class="sv">' + d30 + '</div><div class="sl">直近30日</div>' + deltaChip_(d30, d30p) + '</div>' +
    '<div class="stat"><div class="sv">' + totalAll + '</div><div class="sl">累計</div></div>' +
    (useDeals
      ? '<div class="stat"><div class="sv">' + dealMonthAll + '</div><div class="sl">今月成約</div>' +
        deltaChip_(dealMonthAll, dealMonthPrevAll) + '</div>'
      : '');

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
      c30: sumOffsets_(perDayC[id] || {}, 0, 29),
      r30: sumOffsets_(d, 0, 29),
      dealM: dealMonth[id] || 0,
      dealT: dealTotals[id] || 0,
      fPeople: (funnel.byId[id] || {}).people || 0,
      fMeet: (funnel.byId[id] || {}).meeting || 0,
      fWon: (funnel.byId[id] || {}).won || 0,
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
      (useClicks
        ? '<td class="num">' + x.c30 + '</td>' +
          '<td class="num">' + (x.c30 > 0 ? Math.round((x.r30 / x.c30) * 100) + '%' : '—') + '</td>'
        : '') +
      (useDeals
        ? '<td class="num">' + x.dealM + '</td>' +
          '<td class="num">' + (x.total > 0 ? Math.round((x.dealT / x.total) * 100) + '%' : '—') + '</td>'
        : '') +
      (useFunnel
        ? '<td class="num">' + x.fMeet + '</td>' +
          '<td class="num">' + (x.fPeople > 0 ? Math.round((x.fMeet / x.fPeople) * 100) + '%' : '—') + '</td>' +
          '<td class="num">' + x.fWon + '</td>' +
          '<td class="num">' + (x.fMeet > 0 ? Math.round((x.fWon / x.fMeet) * 100) + '%' : '—') + '</td>'
        : '') +
      '<td>' + (x.key ? '<a class="open" target="_blank" href="' + esc(base + '?stats=' + x.key) + '">開く</a>' : '') + '</td>' +
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

  // 全体ファネル（顧客シートにデータがあるときだけ表示）
  let funnelHtml = '';
  if (useFunnel) {
    const fp = list.reduce((s, x) => s + x.fPeople, 0);
    const fm = list.reduce((s, x) => s + x.fMeet, 0);
    const fw = list.reduce((s, x) => s + x.fWon, 0);
    const step = (label, n, base) =>
      '<div class="fstep"><div class="fbar" style="width:' +
      (base > 0 ? Math.max(6, Math.round((n / base) * 100)) : 6) + '%"></div>' +
      '<div class="frow"><span class="flabel">' + label + '</span>' +
      '<span class="fnum">' + n + '</span>' +
      '<span class="fpct">' + (base > 0 && base !== n ? Math.round((n / base) * 100) + '%' : '') + '</span></div></div>';
    funnelHtml = '<div class="panel"><div class="ph">ファネル（全期間）</div>' +
      step('登録', fp, fp) + step('面談予約', fm, fp) + step('成約', fw, fp) +
      '<div class="note">面談率 ' + (fp > 0 ? Math.round((fm / fp) * 100) : 0) + '% ／ ' +
      '面談→成約 ' + (fm > 0 ? Math.round((fw / fm) * 100) : 0) + '% ／ ' +
      '登録→成約 ' + (fp > 0 ? Math.round((fw / fp) * 100) : 0) + '%</div></div>';
  }

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
    funnelHtml +
    '<div class="panel"><div class="ph">アフィリエイター別（今月順）</div><div class="tbox"><table>' +
    '<tr class="thead"><td>#</td><td>名前</td><td class="num">今日</td><td class="num">7日</td><td>前週比</td>' +
    '<td class="num">今月</td><td class="num">シェア</td><td class="num">先月</td><td class="num">累計</td>' +
    (useClicks ? '<td class="num">クリック30日</td><td class="num">登録率</td>' : '') +
    (useDeals ? '<td class="num">成約今月</td><td class="num">成約率</td>' : '') +
    (useFunnel ? '<td class="num">面談</td><td class="num">面談率</td><td class="num">成約</td><td class="num">面談→成約</td>' : '') +
    '<td></td></tr>' +
    (tableRows || '<tr><td colspan="18" style="color:#98A69E">QR設定シートが空です</td></tr>') +
    '</table></div></div>' +
    '<div class="panel"><div class="ph">日別登録数 — 直近30日（アフィリエイター別）</div><div class="chart">' + bars + '</div>' + legend + '</div>' +
    '<div class="panel"><div class="ph">登録されやすい時間帯（全体）</div><div class="chart small">' + hourBars + '</div></div>' +
    '<div class="panel"><div class="ph">曜日別の傾向（全体）</div><div class="chart small">' + wdBars + '</div></div>' +
    '<div class="foot">管理者専用ページです。URLは共有しないでください。</div>' +
    '</div></body></html>';

  return HtmlService.createHtmlOutput(html).setTitle('全体ダッシュボード');
}
