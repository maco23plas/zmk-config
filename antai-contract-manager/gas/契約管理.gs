/**
 * ============================================================
 *  アンタイ 契約・入金管理ツール
 * ============================================================
 *
 *  ▼ これは「社内専用」のスプレッドシートに入れるコードです。
 *    アフィリエイターと共有している流入シートとは別のファイルにしてください。
 *    （契約金額・入金・個人情報を扱うため）
 *
 *  ▼ 使い方
 *   1. 新しいスプレッドシートを作る（例：アンタイ_契約入金管理）※誰とも共有しない
 *   2. 拡張機能 → Apps Script → このコードを貼り付けて保存
 *   3. スプレッドシートを再読み込み → メニュー「📗 契約管理」が出る
 *   4. 「① 初期セットアップ」を実行
 *   5. 「設定」シートに、流入シートのURLと通知先を入れる
 *   6. 「② 流入シートから取り込み」で顧客情報を引き込む
 *
 *  ▼ Webアプリではないので、デプロイ作業は不要です。
 * ============================================================
 */

const TZ = 'Asia/Tokyo';

const SH = {
  DASH: 'ダッシュボード',
  DEALS: '契約管理',
  REWARD: '代理店報酬',
  CONFIG: '設定',
  MASTER: 'マスタ',
};

// 契約管理シートの列（この順番を変えると数式がずれます）
const COLS = [
  '契約ID', 'LINE ID', '氏名', '流入元', '紹介者・代理店',
  '面談日', '契約日', '契約方法', 'クラウドサイン', 'プラン',
  '契約金額', '決済方法', '着手金額', '着手金 期限', '着手金 入金日',
  '残金額', '残金 期限', '残金 入金日', '入金累計', '残額',
  '進行状況', '要対応', '担当', 'CS移行日', 'メモ',
];
const LAST_ROW = 500;          // 数式を敷く行数
const FIRST = 2;               // データ開始行

// プルダウンの選択肢
const OPT = {
  契約方法: ['面談中に締結', '後日締結', '未締結'],
  クラウドサイン: ['未送付', '送付済', '締結済'],
  決済方法: ['面談中に決済', 'LINE案内', '銀行振込', '未定'],
  プラン: ['45万(前払い)', '55万(後払い)', '33万(失業保険のみ)'],
  報酬ステータス: ['承認待ち', '承認済み(未払)', '支払済み', '対象外'],
};

const CONFIG_DEFAULTS = [
  ['INFLOW_SHEET_URL',
    'https://docs.google.com/spreadsheets/d/1kEr564c4rpfyKixif5ex7juaj2qbly3R3jGGBud4mEo/edit',
    '★アフィリエイターと共有している「エルメ_ログ同期」のURL。②の取り込みで使用（設定済み）'],
  ['DISCORD_WEBHOOK_URL', '', '要対応リストの通知先（Discordのウェブフック）'],
  ['CHATWORK_API_TOKEN', '', 'Chatworkで受け取る場合のAPIトークン'],
  ['CHATWORK_ROOM_ID', '', 'Chatworkのルー厶ID'],
  ['ALERT_HOUR', 9, '毎朝の要対応通知を送る時刻（0〜23）'],
  ['DEFAULT_DUE_DAYS', 7, '契約日から着手金入金期限までの既定日数'],
  ['MEETING_STALE_DAYS', 7, '面談から何日契約がなければ「未契約」として警告するか'],
];

// ────────────────────────────────────────────
// メニュー
// ────────────────────────────────────────────
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📗 契約管理')
    .addItem('① 初期セットアップ／設定反映', 'setup')
    .addItem('② 流入シートから取り込み', 'pullFromInflow')
    .addItem('③ ダッシュボードを更新', 'refreshDashboard')
    .addItem('④ 代理店報酬を起票（入金ベース）', 'buildRewards')
    .addSeparator()
    .addItem('⑤ 要対応リストを今すぐ通知', 'sendAlerts')
    .addToUi();
}

// ────────────────────────────────────────────
// ① 初期セットアップ（何度実行してもOK）
// ────────────────────────────────────────────
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 設定
  let conf = ss.getSheetByName(SH.CONFIG);
  if (!conf) {
    conf = ss.insertSheet(SH.CONFIG);
    conf.appendRow(['設定項目', '値', 'メモ']);
    conf.setFrozenRows(1);
    conf.setColumnWidth(1, 200).setColumnWidth(2, 340).setColumnWidth(3, 460);
  }
  const known = new Set(conf.getLastRow() > 1
    ? conf.getRange(2, 1, conf.getLastRow() - 1, 1).getValues().flat().map(v => String(v).trim())
    : []);
  CONFIG_DEFAULTS.forEach(r => { if (!known.has(r[0])) conf.appendRow(r); });

  // マスタ（プラン単価・代理店報酬単価）
  let mst = ss.getSheetByName(SH.MASTER);
  if (!mst) {
    mst = ss.insertSheet(SH.MASTER);
    mst.getRange(1, 1, 5, 2).setValues([
      ['プラン', '標準金額(円)'],
      ['45万(前払い)', 450000],
      ['55万(後払い)', 550000],
      ['33万(失業保険のみ)', 330000],
      ['', ''],
    ]);
    mst.getRange(1, 4, 3, 2).setValues([
      ['紹介者・代理店', '報酬単価(円/件)'],
      ['（ここに代理店名と単価を追加）', 170000],
      ['', ''],
    ]);
    mst.getRange(1, 1, 1, 2).setFontWeight('bold').setBackground('#E3ECF5');
    mst.getRange(1, 4, 1, 2).setFontWeight('bold').setBackground('#E3ECF5');
    mst.setColumnWidth(1, 200).setColumnWidth(4, 240);
  }

  // 契約管理
  let d = ss.getSheetByName(SH.DEALS);
  if (!d) d = ss.insertSheet(SH.DEALS);
  d.getRange(1, 1, 1, COLS.length).setValues([COLS])
    .setFontWeight('bold').setBackground('#E3ECF5').setWrap(true);
  d.setFrozenRows(1);
  d.setFrozenColumns(3);
  applyValidations_(d, mst);
  applyFormulas_(d, d.getLastRow());   // 既に入っているデータ行まで数式を届かせる
  applyFormats_(d, d.getLastRow());

  // 代理店報酬
  let r = ss.getSheetByName(SH.REWARD);
  if (!r) {
    r = ss.insertSheet(SH.REWARD);
    r.appendRow(['契約ID', '成約日', '顧客名', '紹介者・代理店', '報酬単価(円)',
      '報酬ステータス', '支払期日', '支払日', 'メモ']);
    r.setFrozenRows(1);
    r.getRange(1, 1, 1, 9).setFontWeight('bold').setBackground('#E3ECF5');
    r.setColumnWidth(3, 160).setColumnWidth(4, 180);
  }
  r.getRange(2, 6, 500, 1).setDataValidation(listRule_(OPT.報酬ステータス));

  ensure_(ss, SH.DASH);

  // 毎朝の通知トリガー
  const hour = Number(getConfig_().ALERT_HOUR) || 9;
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'dailyRoutine')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('dailyRoutine').timeBased().atHour(hour).everyDays(1).create();

  // 新規スプレッドシートに最初からある空のシートは片付ける
  ss.getSheets().forEach(x => {
    const nm = x.getName();
    const mine = Object.keys(SH).some(k => SH[k] === nm);
    if (!mine && x.getLastRow() === 0 && ss.getSheets().length > 1) {
      try { ss.deleteSheet(x); } catch (e) {}
    }
  });

  refreshDashboard();
  toast_('セットアップ完了。「設定」シートに流入シートのURLと通知先を入れて、②を実行してください。');
}

/** 氏名(C列)が空の最初の行を返す。数式を敷いた範囲の中に追記するため。 */
function firstEmptyRow_(d) {
  const n = Math.max(d.getLastRow() - 1, 0);
  if (n <= 0) return FIRST;
  const names = d.getRange(FIRST, 3, n, 1).getValues();
  for (let i = 0; i < names.length; i++) {
    if (!String(names[i][0]).trim()) return FIRST + i;
  }
  return FIRST + names.length;
}

/** 指定行まで自動計算の数式が敷かれていることを保証する */
function ensureFormulasThrough_(d, lastRow) {
  if (lastRow < FIRST) return;
  const have = d.getRange(FIRST, 21, Math.max(lastRow - 1, 1), 1).getFormulas();
  const missing = have.some(r => !r[0]);
  if (missing) applyFormulas_(d, lastRow);
}

function ensure_(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}
function listRule_(list) {
  return SpreadsheetApp.newDataValidation().requireValueInList(list, true).setAllowInvalid(true).build();
}

/** プルダウンを設定する */
function applyValidations_(d, mst) {
  const n = LAST_ROW - 1;
  d.getRange(FIRST, 8, n, 1).setDataValidation(listRule_(OPT.契約方法));
  d.getRange(FIRST, 9, n, 1).setDataValidation(listRule_(OPT.クラウドサイン));
  // プランはマスタA列を参照（マスタを書き換えれば選択肢も自動で変わる）
  d.getRange(FIRST, 10, n, 1).setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInRange(mst.getRange('A2:A30'), true).setAllowInvalid(true).build());
  d.getRange(FIRST, 12, n, 1).setDataValidation(listRule_(OPT.決済方法));
  // 紹介者はマスタ範囲から
  d.getRange(FIRST, 5, n, 1).setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInRange(mst.getRange('D2:D50'), true).setAllowInvalid(true).build());
}

/**
 * 自動計算列に数式を敷く。
 *  S入金累計 / T残額 / U進行状況 / V要対応
 * 進行状況と要対応は、この事業の実際の詰まり方に合わせて判定している。
 */
function applyFormulas_(d, through) {
  const stale = Number(getConfig_().MEETING_STALE_DAYS) || 7;
  const end = Math.max(Number(through) || 0, FIRST + (LAST_ROW - 1) - 1);
  const rows = [];
  for (let r = FIRST; r <= end; r++) {
    rows.push([
      // 入金累計：入金日が入っている分だけ足す
      '=IF($C' + r + '="","",IF($O' + r + '<>"",N($M' + r + '),0)+IF($R' + r + '<>"",N($P' + r + '),0))',
      // 残額
      '=IF($C' + r + '="","",IF($K' + r + '="","",N($K' + r + ')-N($S' + r + ')))',
      // 進行状況
      '=IF($C' + r + '="","",' +
        'IF($G' + r + '="","未契約",' +
        'IF(AND($K' + r + '<>"",N($T' + r + ')<=0),"完了(全額入金)",' +
        'IF($O' + r + '<>"","残金待ち","着手金待ち"))))',
      // 要対応（上から優先順位が高い順に判定）
      '=IF($C' + r + '="","",' +
        'IF(AND($G' + r + '<>"",$I' + r + '<>"締結済"),"契約書 未締結",' +
        'IF(AND($G' + r + '<>"",$O' + r + '="",$N' + r + '<>"",TODAY()>$N' + r + '),' +
          '"着手金 遅延"&TEXT(TODAY()-$N' + r + ',"0")&"日",' +
        'IF(AND($O' + r + '<>"",$R' + r + '="",$Q' + r + '<>"",TODAY()>$Q' + r + '),' +
          '"残金 遅延"&TEXT(TODAY()-$Q' + r + ',"0")&"日",' +
        'IF(AND($G' + r + '="",$F' + r + '<>"",TODAY()-$F' + r + '>' + stale + '),' +
          '"面談後' + stale + '日 未契約","")))))',
    ]);
  }
  d.getRange(FIRST, 19, rows.length, 4).setFormulas(rows);
}

/** 見た目（金額の書式・列幅・自動計算列のグレー・要対応の色分け） */
function applyFormats_(d, through) {
  const n = Math.max(Number(through) || 0, LAST_ROW) - 1;
  [11, 13, 16, 19, 20].forEach(c => d.getRange(FIRST, c, n, 1).setNumberFormat('¥#,##0'));
  [6, 7, 14, 15, 17, 18, 24].forEach(c => d.getRange(FIRST, c, n, 1).setNumberFormat('yyyy-mm-dd'));
  d.getRange(FIRST, 19, n, 4).setBackground('#F1F3F4');   // 自動計算列
  d.setColumnWidth(1, 90).setColumnWidth(2, 120).setColumnWidth(3, 140)
    .setColumnWidth(22, 170).setColumnWidth(25, 260);

  // 要対応の色分け
  const rng = d.getRange(FIRST, 22, n, 1);
  d.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextContains('遅延').setBackground('#F8D7D3').setFontColor('#9E3226').setRanges([rng]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextContains('未締結').setBackground('#FBEFD9').setFontColor('#9A5A12').setRanges([rng]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextContains('未契約').setBackground('#FBEFD9').setFontColor('#9A5A12').setRanges([rng]).build(),
  ]);
}

// ────────────────────────────────────────────
// 設定の読み込み
// ────────────────────────────────────────────
function getConfig_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH.CONFIG);
  const out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues()
    .forEach(([k, v]) => { if (k) out[String(k).trim()] = String(v).trim(); });
  return out;
}

function toast_(msg) {
  try { SpreadsheetApp.getActiveSpreadsheet().toast(msg, '📗 契約管理', 10); } catch (e) {}
  Logger.log(msg);
}

function normalizeName_(s) {
  return String(s || '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[\s　_\-・,、.。（）()【】\[\]「」]/g, '')
    .toLowerCase();
}

// ────────────────────────────────────────────
// ② 流入シートから顧客を取り込む
//    共有シート側は読むだけ。書き換えない。
// ────────────────────────────────────────────
function pullFromInflow() {
  const url = String(getConfig_().INFLOW_SHEET_URL || '').trim();
  if (!url) { toast_('「設定」シートの INFLOW_SHEET_URL に流入シートのURLを入れてください。'); return; }
  let book;
  try { book = SpreadsheetApp.openByUrl(url); }
  catch (err) { toast_('流入シートを開けませんでした。URLを確認してください。'); return; }

  // 流入側の「顧客」シート（LINE ID / LINE名 / QR ID / QR名 / 登録日時 / 面談予約日時）
  const src = book.getSheetByName('顧客');
  if (!src || src.getLastRow() < 2) { toast_('流入シートに「顧客」タブのデータが見つかりません。'); return; }
  const rows = src.getRange(2, 1, src.getLastRow() - 1, 6).getValues();

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const d = ss.getSheetByName(SH.DEALS);
  const have = {};
  const haveName = {};
  let last = 0;
  if (d.getLastRow() > 1) {
    const cur = d.getRange(2, 1, d.getLastRow() - 1, 3).getValues();
    cur.forEach((v, i) => {
      const id = String(v[1]).trim();
      const nm = normalizeName_(v[2]);
      if (id) have[id] = i + 2;
      if (nm) haveName[nm] = i + 2;
      if (String(v[0]).trim()) last = Math.max(last, Number(String(v[0]).replace(/\D/g, '')) || 0);
    });
  }

  const add = [];
  let updated = 0;
  for (const [lineId, name, qrId, qrName, regAt, metAt] of rows) {
    const id = String(lineId).trim();
    const nm = normalizeName_(name);
    const row = (id && have[id]) || (nm && haveName[nm]);
    if (row) {
      // 既にある行は、空欄の項目だけ埋める（手入力を壊さない）
      const cur = d.getRange(row, 2, 1, 6).getValues()[0];
      const patch = [
        cur[0] || id,
        cur[1] || String(name || ''),
        cur[2] || String(qrName || qrId || ''),
        cur[3],
        cur[4] || (metAt instanceof Date ? metAt : ''),
      ];
      d.getRange(row, 2, 1, 5).setValues([patch]);
      updated++;
      continue;
    }
    if (!id && !nm) continue;
    last++;
    add.push([
      'C' + String(last).padStart(4, '0'), id, String(name || ''),
      String(qrName || qrId || ''), '',
      metAt instanceof Date ? metAt : '',
    ]);
  }

  if (add.length) {
    // 数式を敷いた範囲の「空いている行」から書き込む（範囲外に落とすと自動計算が効かない）
    const start = firstEmptyRow_(d);
    ensureFormulasThrough_(d, start + add.length - 1);
    d.getRange(start, 1, add.length, 6).setValues(add);
  }
  refreshDashboard();
  toast_('取り込み完了： 新規 ' + add.length + '件／既存の補完 ' + updated + '件');
}

// ────────────────────────────────────────────
// 契約管理シートを読む
// ────────────────────────────────────────────
function readDeals_() {
  const d = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH.DEALS);
  if (!d || d.getLastRow() < FIRST) return [];
  const values = d.getRange(FIRST, 1, d.getLastRow() - 1, COLS.length).getValues();
  const out = [];
  values.forEach((v, i) => {
    if (!String(v[2]).trim()) return;                 // 氏名が無い行は未使用
    out.push({
      row: i + FIRST,
      id: v[0], lineId: v[1], name: v[2], source: v[3], agent: v[4],
      met: v[5], signedAt: v[6], signWay: v[7], cloudsign: v[8], plan: v[9],
      amount: Number(v[10]) || 0, payWay: v[11],
      first: Number(v[12]) || 0, firstDue: v[13], firstPaid: v[14],
      rest: Number(v[15]) || 0, restDue: v[16], restPaid: v[17],
      paid: Number(v[18]) || 0, left: Number(v[19]) || 0,
      status: String(v[20] || ''), alert: String(v[21] || ''),
      owner: v[22], cs: v[23], memo: v[24],
    });
  });
  return out;
}

const ymd_ = d => (d instanceof Date) ? Utilities.formatDate(d, TZ, 'yyyy-MM-dd') : '';
const ym_ = d => (d instanceof Date) ? Utilities.formatDate(d, TZ, 'yyyy-MM') : '';
const yen_ = n => '¥' + Math.round(Number(n) || 0).toLocaleString('ja-JP');

// ────────────────────────────────────────────
// ③ ダッシュボード
// ────────────────────────────────────────────
function refreshDashboard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ensure_(ss, SH.DASH);
  sh.clear();
  const deals = readDeals_();
  const now = new Date();
  const thisMonth = Utilities.formatDate(now, TZ, 'yyyy-MM');

  const signed = deals.filter(x => x.signedAt instanceof Date);
  const signedThis = signed.filter(x => ym_(x.signedAt) === thisMonth);
  const metAll = deals.filter(x => x.met instanceof Date);
  const metThis = metAll.filter(x => ym_(x.met) === thisMonth);

  const sum = (a, f) => a.reduce((s, x) => s + (Number(f(x)) || 0), 0);
  const amountThis = sum(signedThis, x => x.amount);
  const paidThis = sum(deals.filter(x => ym_(x.firstPaid) === thisMonth || ym_(x.restPaid) === thisMonth),
    x => (ym_(x.firstPaid) === thisMonth ? x.first : 0) + (ym_(x.restPaid) === thisMonth ? x.rest : 0));
  const outstanding = sum(signed, x => x.left);

  // 即決率：この事業のいまの課題そのものなので最上段に置く
  const instantSign = signed.filter(x => String(x.signWay).indexOf('面談中') >= 0).length;
  const instantPay = signed.filter(x => String(x.payWay).indexOf('面談中') >= 0).length;
  const pct = (a, b) => b > 0 ? Math.round((a / b) * 100) + '%' : '—';

  let r = 1;
  sh.getRange(r, 1).setValue('アンタイ 契約・入金ダッシュボード')
    .setFontSize(14).setFontWeight('bold');
  sh.getRange(r, 6).setValue('更新: ' + Utilities.formatDate(now, TZ, 'yyyy-MM-dd HH:mm'))
    .setFontColor('#6B7885');
  r += 2;

  const kpi = [
    ['今月の契約', signedThis.length + ' 件', '今月の契約金額', yen_(amountThis)],
    ['今月の入金', yen_(paidThis), '未回収（契約済の残額）', yen_(outstanding)],
    ['面談→契約率（今月）', pct(signedThis.length, metThis.length), '契約 累計', signed.length + ' 件'],
    ['面談中に締結できた割合', pct(instantSign, signed.length), '面談中に決済できた割合', pct(instantPay, signed.length)],
  ];
  sh.getRange(r, 1, kpi.length, 4).setValues(kpi);
  sh.getRange(r, 1, kpi.length, 1).setFontColor('#6B7885');
  sh.getRange(r, 3, kpi.length, 1).setFontColor('#6B7885');
  sh.getRange(r, 2, kpi.length, 1).setFontWeight('bold').setFontSize(12);
  sh.getRange(r, 4, kpi.length, 1).setFontWeight('bold').setFontSize(12);
  // 即決率の行だけ強調（改善対象の指標）
  sh.getRange(r + 3, 1, 1, 4).setBackground('#FBEFD9');
  r += kpi.length + 2;

  // 要対応リスト
  const alerts = deals.filter(x => x.alert);
  sh.getRange(r, 1).setValue('要対応（' + alerts.length + '件）').setFontWeight('bold');
  r++;
  const head = ['要対応', '氏名', '紹介者', '契約日', '契約金額', '残額', '担当'];
  sh.getRange(r, 1, 1, head.length).setValues([head])
    .setFontWeight('bold').setBackground('#F8D7D3');
  r++;
  if (alerts.length) {
    const rows = alerts
      .sort((a, b) => (b.alert.indexOf('遅延') >= 0 ? 1 : 0) - (a.alert.indexOf('遅延') >= 0 ? 1 : 0))
      .map(x => [x.alert, x.name, x.agent, ymd_(x.signedAt), x.amount || '', x.left || '', x.owner]);
    sh.getRange(r, 1, rows.length, head.length).setValues(rows);
    sh.getRange(r, 5, rows.length, 2).setNumberFormat('¥#,##0');
    r += rows.length;
  } else {
    sh.getRange(r, 1).setValue('なし').setFontColor('#6B7885');
    r++;
  }
  r += 2;

  // 流入元別
  sh.getRange(r, 1).setValue('流入元別').setFontWeight('bold');
  r++;
  const bySrc = {};
  deals.forEach(x => {
    const k = String(x.source || '(未設定)');
    const b = bySrc[k] || (bySrc[k] = { lead: 0, met: 0, signed: 0, amount: 0, paid: 0 });
    b.lead++;
    if (x.met instanceof Date) b.met++;
    if (x.signedAt instanceof Date) { b.signed++; b.amount += x.amount; b.paid += x.paid; }
  });
  const sHead = ['流入元', 'リード', '面談', '契約', '契約率', '契約金額', '入金済'];
  sh.getRange(r, 1, 1, sHead.length).setValues([sHead])
    .setFontWeight('bold').setBackground('#E3ECF5');
  r++;
  const sRows = Object.keys(bySrc).sort((a, b) => bySrc[b].signed - bySrc[a].signed)
    .map(k => {
      const b = bySrc[k];
      return [k, b.lead, b.met, b.signed, pct(b.signed, b.met), b.amount, b.paid];
    });
  if (sRows.length) {
    sh.getRange(r, 1, sRows.length, sHead.length).setValues(sRows);
    sh.getRange(r, 6, sRows.length, 2).setNumberFormat('¥#,##0');
  }

  sh.setColumnWidth(1, 190).setColumnWidth(2, 150).setColumnWidth(3, 160);
  sh.setColumnWidth(4, 120).setColumnWidth(5, 130).setColumnWidth(6, 130);
  ss.setActiveSheet(sh);
  ss.moveActiveSheet(1);
}

// ────────────────────────────────────────────
// ④ 代理店報酬を起票（入金ベース）
//    成約＝契約締結だが、報酬の支払いは入金を確認してから。
// ────────────────────────────────────────────
function buildRewards() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const rs = ensure_(ss, SH.REWARD);
  const mst = ss.getSheetByName(SH.MASTER);

  // マスタから代理店ごとの報酬単価
  const rate = {};
  if (mst && mst.getLastRow() > 1) {
    mst.getRange(2, 4, mst.getLastRow() - 1, 2).getValues()
      .forEach(([n, v]) => { if (String(n).trim()) rate[String(n).trim()] = Number(v) || 0; });
  }

  const existing = new Set();
  if (rs.getLastRow() > 1) {
    rs.getRange(2, 1, rs.getLastRow() - 1, 1).getValues()
      .forEach(([v]) => { if (String(v).trim()) existing.add(String(v).trim()); });
  }

  const add = [];
  readDeals_().forEach(x => {
    const agent = String(x.agent || '').trim();
    if (!agent) return;
    if (!(x.firstPaid instanceof Date)) return;      // 入金を確認できた案件のみ起票
    const key = String(x.id).trim();
    if (!key || existing.has(key)) return;
    const due = new Date(x.firstPaid.getFullYear(), x.firstPaid.getMonth() + 1, 0); // 入金月の月末
    add.push([key, ymd_(x.signedAt), x.name, agent, rate[agent] || 0,
      '承認待ち', due, '', '入金確認済みのため起票']);
  });

  if (add.length) {
    rs.getRange(rs.getLastRow() + 1, 1, add.length, 9).setValues(add);
    rs.getRange(2, 5, rs.getLastRow(), 1).setNumberFormat('¥#,##0');
    rs.getRange(2, 7, rs.getLastRow(), 2).setNumberFormat('yyyy-mm-dd');
  }
  toast_(add.length ? add.length + '件の報酬を起票しました（承認待ち）' : '新しく起票する報酬はありません');
}

// ────────────────────────────────────────────
// ⑤ 要対応の通知（毎朝の自動実行＋手動実行）
// ────────────────────────────────────────────
function dailyRoutine() {
  refreshDashboard();
  sendAlerts();
}

function sendAlerts() {
  const conf = getConfig_();
  const deals = readDeals_();
  const alerts = deals.filter(x => x.alert);
  const now = new Date();

  const lines = [];
  lines.push('📗 契約・入金 要対応（' + Utilities.formatDate(now, TZ, 'yyyy-MM-dd') + '）');
  lines.push('');
  if (!alerts.length) {
    lines.push('要対応はありません。');
  } else {
    const late = alerts.filter(x => x.alert.indexOf('遅延') >= 0);
    const sign = alerts.filter(x => x.alert.indexOf('未締結') >= 0);
    const noDeal = alerts.filter(x => x.alert.indexOf('未契約') >= 0);
    const block = (title, arr, f) => {
      if (!arr.length) return;
      lines.push('■ ' + title + '（' + arr.length + '件）');
      arr.slice(0, 15).forEach(x => lines.push('・' + f(x)));
      if (arr.length > 15) lines.push('　ほか' + (arr.length - 15) + '件');
      lines.push('');
    };
    block('入金の遅延', late, x => x.name + '：' + x.alert + '　残額 ' + yen_(x.left));
    block('契約書が未締結', sign, x => x.name + '：契約日 ' + ymd_(x.signedAt) + '　' + (x.cloudsign || '未送付'));
    block('面談後に契約が止まっている', noDeal, x => x.name + '：面談 ' + ymd_(x.met) + '　担当 ' + (x.owner || '—'));
  }

  const signed = deals.filter(x => x.signedAt instanceof Date);
  lines.push('未回収 合計： ' + yen_(signed.reduce((s, x) => s + x.left, 0)));
  lines.push('シート: ' + SpreadsheetApp.getActiveSpreadsheet().getUrl());

  const text = lines.join('\n');
  if (conf.DISCORD_WEBHOOK_URL) {
    UrlFetchApp.fetch(conf.DISCORD_WEBHOOK_URL, {
      method: 'post', contentType: 'application/json',
      payload: JSON.stringify({ content: text }), muteHttpExceptions: true,
    });
  }
  if (conf.CHATWORK_API_TOKEN && conf.CHATWORK_ROOM_ID) {
    UrlFetchApp.fetch('https://api.chatwork.com/v2/rooms/' + conf.CHATWORK_ROOM_ID + '/messages', {
      method: 'post', headers: { 'x-chatworktoken': conf.CHATWORK_API_TOKEN },
      payload: { body: '[info][title]契約・入金 要対応[/title]' + text + '[/info]' },
      muteHttpExceptions: true,
    });
  }
  Logger.log(text);
  toast_(alerts.length ? alerts.length + '件の要対応を通知しました' : '要対応はありません');
}

// ────────────────────────────────────────────
// 入力補助：契約日を入れたら着手金の期限を自動で埋める
// ────────────────────────────────────────────
function onEdit(e) {
  try {
    const sh = e.range.getSheet();
    if (sh.getName() !== SH.DEALS) return;
    const col = e.range.getColumn();
    const row = e.range.getRow();
    if (row < FIRST) return;

    // 契約日(7列目)を入れたら、着手金の期限(14列目)が空なら既定日数後を入れる
    if (col === 7 && e.range.getValue() instanceof Date) {
      const due = sh.getRange(row, 14);
      if (!due.getValue()) {
        const days = Number(getConfig_().DEFAULT_DUE_DAYS) || 7;
        const base = e.range.getValue();
        due.setValue(new Date(base.getFullYear(), base.getMonth(), base.getDate() + days));
      }
    }
    // プラン(10列目)を選んだら、契約金額(11列目)が空ならマスタの標準金額を入れる
    if (col === 10) {
      const amt = sh.getRange(row, 11);
      if (!amt.getValue()) {
        const mst = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH.MASTER);
        if (mst) {
          const m = mst.getRange(2, 1, Math.max(mst.getLastRow() - 1, 1), 2).getValues()
            .filter(v => String(v[0]).trim() === String(e.range.getValue()).trim())[0];
          if (m) amt.setValue(Number(m[1]) || '');
        }
      }
    }
  } catch (err) {
    console.error('onEdit: ' + err);
  }
}
