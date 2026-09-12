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
  // ここから先はバックオフィス用（列の並びは変えないこと）
  'メールアドレス', '契約書URL', '決済リンク', '決済ステータス',
  'キャンセル日', '返金額', '返金日', '決済リンクID', '決済ID', 'クラウドサイン書類ID',
];
// 列番号（1始まり）
const C = {
  ID: 1, LINE: 2, NAME: 3, SRC: 4, AGENT: 5, MET: 6, SIGNED: 7, SIGNWAY: 8,
  CLOUD: 9, PLAN: 10, AMOUNT: 11, PAYWAY: 12, FIRST_AMT: 13, FIRST_DUE: 14,
  FIRST_PAID: 15, REST_AMT: 16, REST_DUE: 17, REST_PAID: 18, PAID: 19, LEFT: 20,
  STATUS: 21, ALERT: 22, OWNER: 23, CS: 24, MEMO: 25,
  EMAIL: 26, DOC: 27, PAYLINK: 28, PAYSTATUS: 29,
  CANCEL: 30, REFUND_AMT: 31, REFUND_AT: 32, PAYLINK_ID: 33, PAY_ID: 34, DOC_ID: 35,
};
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
  ['STRIPE_MODE', '本番',
    '「本番」＝下の本番キーを使う／「テスト」＝テスト用キーを使う。動作確認が終わったら必ず「本番」に戻す'],
  ['STRIPE_SECRET_KEY', '', '★Stripeのシークレットキー（sk_live_…）。決済リンクの発行と入金確認に使用'],
  ['STRIPE_SECRET_KEY_TEST', '',
    'Stripeのテスト用シークレットキー（sk_test_…）。STRIPE_MODEが「テスト」のときだけ使う'],
  ['STRIPE_CURRENCY', 'jpy', '決済通貨'],
  ['REWARD_PAY_RULE', '翌月末', '紹介報酬の支払日ルール：「当月末」「翌月末」「翌々月末」から選ぶ'],
  ['CLOUDSIGN_CLIENT_ID', '', '★クラウドサインのクライアントID（管理画面→Web API設定→「新しいクライアントIDを発行する」）'],
  ['CLOUDSIGN_TEMPLATE_FILE_ID', '', '★契約書テンプレートPDFのGoogleドライブ ファイルID（URLの /d/ と /view の間）'],
  ['CLOUDSIGN_SANDBOX', 'ON', 'テスト環境を使うなら ON。本番に切り替えるときは OFF'],
];

// ────────────────────────────────────────────
// メニュー
// ────────────────────────────────────────────
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📗 契約管理')
    .addItem('🔍 動作チェック（何も書き換えません）', 'selfTest')
    .addSeparator()
    .addItem('① 初期セットアップ／設定反映', 'setup')
    .addItem('② 流入シートから取り込み', 'pullFromInflow')
    .addItem('③ ダッシュボードを更新', 'refreshDashboard')
    .addItem('④ 代理店報酬を起票（入金ベース）', 'buildRewards')
    .addSeparator()
    .addItem('⑤ 要対応リストを今すぐ通知', 'sendAlerts')
    .addSeparator()
    .addItem('⑥ 決済リンクを発行（Stripe）', 'createPaymentLinks')
    .addItem('⑦ 入金・返金を取り込む（Stripe）', 'syncPayments')
    .addItem('⑧ 選択中の行を返金する', 'refundSelected')
    .addSeparator()
    .addItem('⑨ 契約書を送付（クラウドサイン）', 'sendContracts')
    .addItem('⑩ 締結状況を取り込む（クラウドサイン）', 'syncContracts')
    .addToUi();
}

// ────────────────────────────────────────────
// 🔍 動作チェック
//    読むだけ。シートもStripeもクラウドサインも書き換えない。
// ────────────────────────────────────────────
function selfTest() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfig_();
  const out = [];
  let bad = 0;
  const ok = m => out.push('✅ ' + m);
  const wn = m => out.push('⚠️ ' + m);
  const ng = m => { bad++; out.push('❌ ' + m); };

  // ── 1. 流入シート（②の入力元） ──
  out.push('■ 流入シート');
  const url = String(cfg.INFLOW_SHEET_URL || '').trim();
  if (!url) ng('URLが未設定。②の取り込みが使えません');
  else {
    try {
      const book = SpreadsheetApp.openByUrl(url);
      const src = book.getSheetByName('顧客');
      if (!src) ng('「顧客」タブが見つかりません（流入側のシート構成を確認）');
      else ok('「' + book.getName() + '」の顧客 ' + Math.max(src.getLastRow() - 1, 0) + '件を読めます');
    } catch (err) {
      ng('開けません。共有設定かURLを確認してください');
    }
  }

  // ── 2. 契約管理の構造 ──
  out.push('', '■ 契約管理');
  const d = ss.getSheetByName(SH.DEALS);
  if (!d) ng('タブがありません。①を実行してください');
  else {
    const head = d.getRange(1, 1, 1, COLS.length).getValues()[0];
    const wrong = COLS.filter((c, i) => String(head[i]).trim() !== c);
    if (wrong.length) ng('見出しがコードと違います（①を実行）: ' + wrong.slice(0, 3).join(' / '));
    else ok('列は ' + COLS.length + '列そろっています');

    const miss = d.getRange(FIRST, C.STATUS, LAST_ROW - 1, 1).getFormulas().filter(r => !r[0]).length;
    if (miss) ng('自動計算の数式が ' + miss + '行ぶん抜けています（①を実行）');
    else ok('自動計算（進行状況・要対応・残額）は ' + (LAST_ROW - 1) + '行ぶん準備済み');

    const last = d.getLastRow();
    if (last > LAST_ROW) ng((last - LAST_ROW) + '行が数式の範囲より下にあります（①を実行すると上に詰めます）');

    const deals = readDeals_();
    const signed = deals.filter(x => x.signedAt instanceof Date);
    ok('データ ' + deals.length + '件（うち契約済 ' + signed.length + '件）');

    // よくある入力漏れ
    const noAmount = signed.filter(x => !x.amount).map(x => x.name);
    if (noAmount.length) wn('契約日はあるのに契約金額が空: ' + noAmount.slice(0, 5).join('、'));
    const noMail = signed.filter(x => !x.email).map(x => x.name);
    if (noMail.length) wn('契約済なのにメールアドレスが空（決済リンクを送れません）: ' + noMail.slice(0, 5).join('、'));
    const badMail = deals.filter(x => x.email && !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(x.email)).map(x => x.name);
    if (badMail.length) wn('メールアドレスの形式が怪しい: ' + badMail.slice(0, 5).join('、'));
    const noAgentRate = deals.filter(x => x.agent).map(x => x.agent);
    const uniqAgents = noAgentRate.filter((v, i) => noAgentRate.indexOf(v) === i);
    const mst = ss.getSheetByName(SH.MASTER);
    const rates = {};
    if (mst) {
      mst.getRange(2, 4, 50, 2).getValues().forEach(r => {
        const nm = String(r[0]).trim();
        if (nm) rates[nm] = Number(r[1]) || 0;
      });
    }
    const unpriced = uniqAgents.filter(a => !rates[a]);
    if (unpriced.length) wn('マスタに報酬単価が無い紹介者（④で報酬が起票されません）: ' + unpriced.join('、'));
  }

  // ── 3. マスタ ──
  out.push('', '■ マスタ');
  const mst2 = ss.getSheetByName(SH.MASTER);
  if (!mst2) ng('タブがありません。①を実行してください');
  else {
    const plans = mst2.getRange(2, 1, 50, 2).getValues().filter(r => String(r[0]).trim());
    const badPlan = plans.filter(r => !(Number(r[1]) > 0)).map(r => r[0]);
    plans.length ? ok('プラン ' + plans.length + '件') : ng('プランが1件も登録されていません');
    if (badPlan.length) ng('標準金額が入っていないプラン: ' + badPlan.join('、'));
    const ch = mst2.getRange(2, 7, 50, 1).getValues().flat().filter(v => String(v).trim());
    ch.length ? ok('流入元チャネル ' + ch.length + '件') : ng('流入元チャネルが空（①を実行）');
  }

  // ── 4. 自動で動く部分 ──
  out.push('', '■ 自動処理');
  const handlers = ScriptApp.getProjectTriggers().map(t => t.getHandlerFunction());
  handlers.indexOf('dailyRoutine') >= 0
    ? ok('毎朝の通知・同期トリガー 登録済み（' + (Number(cfg.ALERT_HOUR) || 9) + '時台）')
    : ng('毎朝のトリガーがありません（①を実行）');
  handlers.indexOf('onSheetEdit') >= 0
    ? ok('編集時トリガー 登録済み（プラン入力→金額・決済リンクの自動発行）')
    : ng('編集時トリガーがありません（①を実行）');
  if (String(cfg.DISCORD_WEBHOOK_URL || '').trim()
    || (String(cfg.CHATWORK_API_TOKEN || '').trim() && String(cfg.CHATWORK_ROOM_ID || '').trim())) {
    ok('要対応の通知先 設定済み');
  } else {
    wn('通知先が未設定。⑤の要対応通知はどこにも届きません');
  }

  // ── 5. Stripe ──
  out.push('', '■ Stripe');
  const mode = stripeMode_();
  const key = stripeKey_(true);
  if (!key) {
    ng('キーが未設定（STRIPE_MODE は「' + mode + '」）。⑥⑦⑧が使えません');
  } else {
    try {
      const bal = stripe_('balance');
      ok('接続OK（STRIPE_MODE=' + mode + ' / 実際のキーは' + (bal.livemode ? '本番' : 'テスト') + '用）');
      if (mode === '本番' && !bal.livemode) {
        ng('本番モードなのにテスト用キーが入っています。本物の請求が1件も作れません');
      }
      if (mode === 'テスト' && bal.livemode) {
        ng('テストのつもりで本番キーが入っています。実際に請求できるリンクが作られます');
      }
      if (mode === 'テスト') wn('いまはテストモードです。確認が済んだら STRIPE_MODE を「本番」に戻してください');
    } catch (err) {
      ng('繋がりません: ' + String(err.message || err).substring(0, 120));
    }
  }

  // ── 6. クラウドサイン ──
  out.push('', '■ クラウドサイン');
  if (!String(cfg.CLOUDSIGN_CLIENT_ID || '').trim()) {
    wn('未接続。⑨⑩は使えません（契約書の送付・締結確認は手作業のまま）');
  } else {
    try {
      csToken_();
      ok('接続OK（' + (String(cfg.CLOUDSIGN_SANDBOX || 'ON').trim().toUpperCase() === 'OFF'
        ? '本番環境' : 'テスト環境') + '）');
      if (!String(cfg.CLOUDSIGN_TEMPLATE_FILE_ID || '').trim()) {
        ng('契約書テンプレートPDFのファイルIDが未設定。⑨で送る中身がありません');
      }
    } catch (err) {
      ng('繋がりません: ' + String(err.message || err).substring(0, 120));
    }
  }

  const head = bad === 0
    ? '問題は見つかりませんでした。'
    : '要対応が ' + bad + '件あります。';
  SpreadsheetApp.getUi().alert('動作チェック', head + '\n\n' + out.join('\n'),
    SpreadsheetApp.getUi().ButtonSet.OK);
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
  // STRIPE_MODE は打ち間違えると本番決済になるのでプルダウンにする
  const keys = conf.getRange(2, 1, Math.max(conf.getLastRow() - 1, 1), 1).getValues().flat()
    .map(v => String(v).trim());
  const modeRow = keys.indexOf('STRIPE_MODE');
  if (modeRow >= 0) {
    conf.getRange(modeRow + 2, 2).setDataValidation(listRule_(['本番', 'テスト']));
  }

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
  // 流入元はチャネルの大分類。個人名は「紹介者・代理店」列に入れる。
  // マスタを先に作ってしまったシートでも埋まるよう、作成時ではなく毎回見る。
  if (!String(mst.getRange(1, 7).getValue()).trim()) {
    mst.getRange(1, 7, 8, 1).setValues([
      ['流入元（チャネル）'], ['アフィリエイト'], ['代理店紹介'], ['セミナー'],
      ['既存顧客紹介'], ['アライアンス'], ['広告'], ['その他'],
    ]);
    mst.getRange(1, 7).setFontWeight('bold').setBackground('#E3ECF5');
    mst.setColumnWidth(7, 200);
  }

  // 契約管理
  let d = ss.getSheetByName(SH.DEALS);
  if (!d) d = ss.insertSheet(SH.DEALS);
  d.getRange(1, 1, 1, COLS.length).setValues([COLS])
    .setFontWeight('bold').setBackground('#E3ECF5').setWrap(true);
  d.setFrozenRows(1);
  d.setFrozenColumns(3);
  applyValidations_(d, mst);
  const moved = compactDeals_(d);      // 数式帯の外に積まれた行を帯の中へ引き上げる
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

  // 編集時トリガー（決済リンクの自動発行に使う。単純なonEditでは外部APIを叩けないため）
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'onSheetEdit')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('onSheetEdit').forSpreadsheet(ss).onEdit().create();

  // 新規スプレッドシートに最初からある空のシートは片付ける
  ss.getSheets().forEach(x => {
    const nm = x.getName();
    const mine = Object.keys(SH).some(k => SH[k] === nm);
    if (!mine && x.getLastRow() === 0 && ss.getSheets().length > 1) {
      try { ss.deleteSheet(x); } catch (e) {}
    }
  });

  refreshDashboard();
  toast_('セットアップ完了。'
    + (moved ? '契約管理の' + moved + '行を上詰めしました。' : '')
    + '「設定」シートに流入シートのURLと通知先を入れて、②を実行してください。');
}

/**
 * 契約管理のデータ行を先頭から詰め直す。
 * 旧版の取り込みが数式帯（2〜LAST_ROW行）より下に追記していたため、
 * 間に数百行の空白ができてしまう。並び順はそのまま保ち、隙間だけを潰す。
 * 数式列（S〜V）は触らず、あとから applyFormulas_ で敷き直す。
 * @return {number} 移動した場合はデータ行数、すでに詰まっていれば 0
 */
function compactDeals_(d) {
  const last = d.getLastRow();
  if (last < FIRST) return 0;
  const width = COLS.length;
  const all = d.getRange(FIRST, 1, last - FIRST + 1, width).getValues();
  const filled = r => !!(String(r[0]).trim() || String(r[2]).trim());
  const data = all.filter(filled);
  if (!data.length) return 0;

  // すでに先頭から隙間なく並んでいれば何もしない
  let contiguous = true;
  for (let i = 0; i < data.length; i++) {
    if (!filled(all[i])) { contiguous = false; break; }
  }
  if (contiguous && data.length === all.length) return 0;
  if (contiguous) {
    // 下に残っているのは空行だけ。念のため末尾を掃除して終わり
    const from = FIRST + data.length;
    if (last >= from) clearDealRows_(d, from, last - from + 1);
    return 0;
  }

  const left = data.map(r => r.slice(0, 18));         // A〜R
  const right = data.map(r => r.slice(22, width));    // W〜
  d.getRange(FIRST, 1, data.length, 18).setValues(left);
  d.getRange(FIRST, 23, data.length, width - 22).setValues(right);

  const from = FIRST + data.length;
  if (last >= from) clearDealRows_(d, from, last - from + 1);
  return data.length;
}

/** 契約管理の指定行を空にする。数式帯の中は数式を残し、帯の外は数式ごと消す。 */
function clearDealRows_(d, from, rows) {
  const width = COLS.length;
  d.getRange(from, 1, rows, 18).clearContent();
  d.getRange(from, 23, rows, width - 22).clearContent();
  const end = from + rows - 1;
  if (end > LAST_ROW) {
    const s = Math.max(from, LAST_ROW + 1);
    d.getRange(s, 19, end - s + 1, 4).clearContent();
  }
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
  // 流入元はマスタG列（チャネルの大分類）を参照
  d.getRange(FIRST, 4, n, 1).setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInRange(mst.getRange('G2:G30'), true).setAllowInvalid(true).build());
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
        'IF($AD' + r + '<>"",IF($AF' + r + '<>"","キャンセル(返金済)","キャンセル(返金未)"),' +
        'IF($G' + r + '="","未契約",' +
        'IF(AND($K' + r + '<>"",N($T' + r + ')<=0),"完了(全額入金)",' +
        'IF($O' + r + '<>"","残金待ち","着手金待ち")))))',
      // 要対応（上から優先順位が高い順に判定）
      '=IF($C' + r + '="","",' +
        'IF(AND($AD' + r + '<>"",$AF' + r + '="",N($S' + r + ')>0),' +
          '"返金対応 "&TEXT(N($S' + r + ')-N($AE' + r + '),"¥#,##0"),' +
        'IF($AD' + r + '<>"","",' +
        'IF(AND($G' + r + '<>"",$I' + r + '<>"締結済"),"契約書 未締結",' +
        'IF(AND($G' + r + '<>"",$O' + r + '="",$N' + r + '<>"",TODAY()>$N' + r + '),' +
          '"着手金 遅延"&TEXT(TODAY()-$N' + r + ',"0")&"日",' +
        'IF(AND($O' + r + '<>"",$R' + r + '="",$Q' + r + '<>"",TODAY()>$Q' + r + '),' +
          '"残金 遅延"&TEXT(TODAY()-$Q' + r + ',"0")&"日",' +
        'IF(AND($G' + r + '="",$F' + r + '<>"",TODAY()-$F' + r + '>' + stale + '),' +
          '"面談後' + stale + '日 未契約","")))))))',
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

  // マスタの流入元（チャネル）一覧。ここに無い値は個人名とみなす
  const mst = ss.getSheetByName(SH.MASTER);
  const channels = mst
    ? mst.getRange(2, 7, 30, 1).getValues().flat().map(v => String(v).trim()).filter(Boolean)
    : [];

  const add = [];
  let updated = 0;
  let fixed = 0;
  for (const [lineId, name, qrId, qrName, regAt, metAt] of rows) {
    const id = String(lineId).trim();
    const nm = normalizeName_(name);
    const row = (id && have[id]) || (nm && haveName[nm]);
    const via = String(qrName || qrId || '');
    if (row) {
      // 既にある行は、空欄の項目だけ埋める（手入力を壊さない）
      const cur = d.getRange(row, 2, 1, 5).getValues()[0];   // B〜F
      let src = String(cur[2] || '').trim();                 // 流入元
      let agent = String(cur[3] || '').trim();               // 紹介者
      // 旧仕様で流入元にQR名が入っていた行を、紹介者側へ寄せる
      if (src && channels.indexOf(src) < 0 && !agent) { agent = src; src = 'アフィリエイト'; fixed++; }
      const patch = [
        cur[0] || id,
        cur[1] || String(name || ''),
        src || 'アフィリエイト',
        agent || via,
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
      'アフィリエイト', via,
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
  toast_('取り込み完了： 新規 ' + add.length + '件／既存の補完 ' + updated + '件' +
    (fixed ? '／流入元を整理 ' + fixed + '件' : ''));
}

// ────────────────────────────────────────────
// 契約管理シートを読む
// ────────────────────────────────────────────
function readDeals_() {
  const d = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH.DEALS);
  if (!d || d.getLastRow() < FIRST) return [];
  const width = Math.min(COLS.length, Math.max(d.getLastColumn(), 25));
  const values = d.getRange(FIRST, 1, d.getLastRow() - 1, width).getValues();
  const g = (v, i) => (i - 1 < v.length ? v[i - 1] : '');
  const out = [];
  values.forEach((v, i) => {
    if (!String(g(v, C.NAME)).trim()) return;          // 氏名が無い行は未使用
    out.push({
      row: i + FIRST,
      id: String(g(v, C.ID) || '').trim(),
      lineId: g(v, C.LINE), name: String(g(v, C.NAME)).trim(),
      source: g(v, C.SRC), agent: String(g(v, C.AGENT) || '').trim(),
      met: g(v, C.MET), signedAt: g(v, C.SIGNED), signWay: g(v, C.SIGNWAY),
      cloudsign: g(v, C.CLOUD), plan: String(g(v, C.PLAN) || '').trim(),
      amount: Number(g(v, C.AMOUNT)) || 0, payWay: g(v, C.PAYWAY),
      first: Number(g(v, C.FIRST_AMT)) || 0, firstDue: g(v, C.FIRST_DUE), firstPaid: g(v, C.FIRST_PAID),
      rest: Number(g(v, C.REST_AMT)) || 0, restDue: g(v, C.REST_DUE), restPaid: g(v, C.REST_PAID),
      paid: Number(g(v, C.PAID)) || 0, left: Number(g(v, C.LEFT)) || 0,
      status: String(g(v, C.STATUS) || ''), alert: String(g(v, C.ALERT) || ''),
      owner: g(v, C.OWNER), cs: g(v, C.CS), memo: g(v, C.MEMO),
      email: String(g(v, C.EMAIL) || '').trim(),
      doc: g(v, C.DOC),
      payLink: String(g(v, C.PAYLINK) || '').trim(),
      payStatus: String(g(v, C.PAYSTATUS) || '').trim(),
      cancel: g(v, C.CANCEL),
      refundAmt: Number(g(v, C.REFUND_AMT)) || 0, refundAt: g(v, C.REFUND_AT),
      payLinkId: String(g(v, C.PAYLINK_ID) || '').trim(),
      payId: String(g(v, C.PAY_ID) || '').trim(),
      docIdCs: String(g(v, C.DOC_ID) || '').trim(),
    });
  });
  return out;
}

const ymd_ = d => (d instanceof Date) ? Utilities.formatDate(d, TZ, 'yyyy-MM-dd') : '';
const ym_ = d => (d instanceof Date) ? Utilities.formatDate(d, TZ, 'yyyy-MM') : '';
const yen_ = n => '¥' + Math.round(Number(n) || 0).toLocaleString('ja-JP');


// ════════════════════════════════════════════
// Stripe 連携
//   ・プランと金額から決済リンクを自動発行
//   ・入金と返金をStripe側から取得してシートに反映
//   シークレットキーは「設定」シートに置く。このシートは共有しないこと。
// ════════════════════════════════════════════

/** StripeのREST APIを叩く。失敗したら理由付きで例外にする。 */
/** 「テスト」か「本番」か。設定シートの STRIPE_MODE で切り替える。 */
function stripeMode_() {
  return String(getConfig_().STRIPE_MODE || '本番').trim() === 'テスト' ? 'テスト' : '本番';
}

/** いま使うStripeキーを返す。quiet のときは空文字を返すだけで落とさない。 */
function stripeKey_(quiet) {
  const cfg = getConfig_();
  const test = stripeMode_() === 'テスト';
  const key = String((test ? cfg.STRIPE_SECRET_KEY_TEST : cfg.STRIPE_SECRET_KEY) || '').trim();
  if (!key && !quiet) {
    throw new Error(test
      ? '「設定」シートの STRIPE_SECRET_KEY_TEST が空です。STRIPE_MODE が「テスト」のため、sk_test_… のキーが要ります。'
      : '「設定」シートの STRIPE_SECRET_KEY が空です。');
  }
  return key;
}

function stripe_(path, method, params) {
  const key = stripeKey_();
  const opt = {
    method: method || 'get',
    headers: { Authorization: 'Bearer ' + key },
    muteHttpExceptions: true,
  };
  let url = 'https://api.stripe.com/v1/' + path;
  if (params && (method === 'post' || method === 'delete')) {
    opt.payload = params;
  } else if (params) {
    url += '?' + Object.keys(params)
      .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&');
  }
  const res = UrlFetchApp.fetch(url, opt);
  const body = JSON.parse(res.getContentText() || '{}');
  if (res.getResponseCode() >= 300) {
    throw new Error('Stripe: ' + ((body.error && body.error.message) || res.getContentText()).substring(0, 200));
  }
  return body;
}

/**
 * ⑥ 決済リンクを発行する。
 * プランと金額が入っていてリンクがまだ無い行だけが対象。
 * 着手金額が入っていればその額、無ければ契約金額で作る。
 */
function createPaymentLinks() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const d = ss.getSheetByName(SH.DEALS);
  const cur = String(getConfig_().STRIPE_CURRENCY || 'jpy').trim();
  const test = stripeMode_() === 'テスト';
  let made = 0;
  const skipped = [];

  readDeals_().forEach(x => {
    if (x.payLink || x.cancel) return;
    const amount = x.first || x.amount;
    if (!amount) { if (x.signedAt) skipped.push(x.name + '（金額が未入力）'); return; }
    try {
      const price = stripe_('prices', 'post', {
        'unit_amount': Math.round(amount),
        'currency': cur,
        'product_data[name]': (test ? '【テスト】' : '')
          + 'アンタイ ' + (x.plan || 'サポート') + '　' + x.name + ' 様',
      });
      const link = stripe_('payment_links', 'post', {
        'line_items[0][price]': price.id,
        'line_items[0][quantity]': 1,
        'metadata[contract_id]': x.id || '',
        'metadata[name]': x.name,
      });
      d.getRange(x.row, C.PAYLINK).setValue(link.url);
      d.getRange(x.row, C.PAYLINK_ID).setValue(link.id);
      if (!x.payStatus) d.getRange(x.row, C.PAYSTATUS).setValue(test ? '未決済(テスト)' : '未決済');
      made++;
    } catch (err) {
      skipped.push(x.name + '（' + err.message + '）');
    }
  });
  refreshDashboard();
  toast_((test ? '【テストモード】' : '') + '決済リンクを ' + made + '件 発行しました' +
    (skipped.length ? '／作れなかったもの: ' + skipped.slice(0, 3).join('、') : ''));
}

/**
 * ⑦ Stripeから入金・返金を取り込む。
 * 支払い済みなら着手金の入金日を自動で埋め、返金があれば返金額と返金日を入れる。
 */
function syncPayments() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const d = ss.getSheetByName(SH.DEALS);
  let paidCount = 0;
  let refundCount = 0;

  readDeals_().forEach(x => {
    if (!x.payLinkId) return;
    let sessions;
    try {
      sessions = stripe_('checkout/sessions', 'get', { payment_link: x.payLinkId, limit: 5 });
    } catch (err) {
      console.error('sessions取得失敗 ' + x.name + ': ' + err);
      return;
    }
    const paid = (sessions.data || []).filter(s => s.payment_status === 'paid')[0];
    if (!paid) {
      if (x.payStatus !== '未決済') d.getRange(x.row, C.PAYSTATUS).setValue('未決済');
      return;
    }
    const pi = paid.payment_intent || '';
    if (!x.payId && pi) d.getRange(x.row, C.PAY_ID).setValue(pi);

    // 返金の有無を確認
    let refunded = 0;
    let refundedAt = null;
    if (pi) {
      try {
        const rf = stripe_('refunds', 'get', { payment_intent: pi, limit: 10 });
        (rf.data || []).forEach(r => {
          if (r.status === 'succeeded') {
            refunded += Number(r.amount) || 0;
            const t = new Date(Number(r.created) * 1000);
            if (!refundedAt || t > refundedAt) refundedAt = t;
          }
        });
      } catch (err) { console.error('refunds取得失敗: ' + err); }
    }

    if (refunded > 0) {
      if (!x.refundAmt) d.getRange(x.row, C.REFUND_AMT).setValue(refunded);
      if (!x.refundAt && refundedAt) d.getRange(x.row, C.REFUND_AT).setValue(refundedAt);
      d.getRange(x.row, C.PAYSTATUS).setValue(refunded >= (paid.amount_total || 0) ? '返金済' : '一部返金');
      refundCount++;
      return;
    }

    d.getRange(x.row, C.PAYSTATUS).setValue('支払済');
    if (!x.firstPaid) {
      d.getRange(x.row, C.FIRST_PAID).setValue(new Date(Number(paid.created) * 1000));
      if (!x.first) d.getRange(x.row, C.FIRST_AMT).setValue(Number(paid.amount_total) || 0);
      paidCount++;
    }
  });

  refreshDashboard();
  toast_('Stripe同期： 新しい入金 ' + paidCount + '件／返金 ' + refundCount + '件');
}

/**
 * ⑧ 選択中の行を返金する。
 * お金が動く操作なので、確認ダイアログで明示的に承認を取ってから実行する。
 */
function refundSelected() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const d = ss.getActiveSheet();
  if (d.getName() !== SH.DEALS) { toast_('「契約管理」シートで、返金したい行を選んでから実行してください。'); return; }
  const row = d.getActiveRange().getRow();
  if (row < FIRST) { toast_('返金したい契約の行を選んでください。'); return; }

  const x = readDeals_().filter(v => v.row === row)[0];
  if (!x) { toast_('その行に契約データがありません。'); return; }
  if (!x.payId) { toast_(x.name + ' さんはStripeでの入金が確認できていません（先に⑦を実行してください）。'); return; }
  if (x.refundAt) { toast_(x.name + ' さんは既に返金済みです。'); return; }

  const ui = SpreadsheetApp.getUi();
  const amount = x.paid || x.first || 0;
  const ans = ui.alert('返金の確認',
    x.name + ' 様に ' + yen_(amount) + ' を返金します。\n' +
    'Stripe上で実際に返金が実行され、取り消せません。実行しますか？',
    ui.ButtonSet.YES_NO);
  if (ans !== ui.Button.YES) { toast_('返金を中止しました。'); return; }

  try {
    const rf = stripe_('refunds', 'post', { payment_intent: x.payId });
    d.getRange(row, C.REFUND_AMT).setValue(Number(rf.amount) || amount);
    d.getRange(row, C.REFUND_AT).setValue(new Date());
    d.getRange(row, C.PAYSTATUS).setValue('返金済');
    if (!x.cancel) d.getRange(row, C.CANCEL).setValue(new Date());
    refreshDashboard();
    toast_(x.name + ' さんへ ' + yen_(Number(rf.amount) || amount) + ' を返金しました。');
  } catch (err) {
    SpreadsheetApp.getUi().alert('返金に失敗しました\n\n' + err.message);
  }
}


// ════════════════════════════════════════════
// クラウドサイン連携（スタンダードプラン以上。管理画面でWeb APIの利用申込みが必要）
//   ベースURL: 本番 https://api.cloudsign.jp / テスト https://api-sandbox.cloudsign.jp
//   アクセストークンの有効期限は1時間なので、取得したら使い回す
// ════════════════════════════════════════════

function csBase_() {
  return /^on$/i.test(String(getConfig_().CLOUDSIGN_SANDBOX || 'ON').trim())
    ? 'https://api-sandbox.cloudsign.jp' : 'https://api.cloudsign.jp';
}

/** アクセストークンを取得する（1時間有効なのでキャッシュする） */
function csToken_() {
  const cache = CacheService.getScriptCache();
  const base = csBase_();
  const hit = cache.get('cs_token_' + base);
  if (hit) return hit;

  const clientId = String(getConfig_().CLOUDSIGN_CLIENT_ID || '').trim();
  if (!clientId) throw new Error('「設定」シートの CLOUDSIGN_CLIENT_ID が空です。');
  const res = UrlFetchApp.fetch(base + '/token?client_id=' + encodeURIComponent(clientId), {
    method: 'post', muteHttpExceptions: true,
  });
  const body = JSON.parse(res.getContentText() || '{}');
  if (res.getResponseCode() >= 300 || !body.access_token) {
    throw new Error('クラウドサイン認証に失敗: ' + res.getContentText().substring(0, 200));
  }
  cache.put('cs_token_' + base, body.access_token, Math.max((body.expires_in || 3600) - 120, 60));
  return body.access_token;
}

/** クラウドサインAPIを叩く */
function cs_(path, method, payload, isForm) {
  const opt = {
    method: method || 'get',
    headers: { Authorization: 'Bearer ' + csToken_() },
    muteHttpExceptions: true,
  };
  if (payload && !isForm) {
    opt.contentType = 'application/json';
    opt.payload = JSON.stringify(payload);
  } else if (payload) {
    opt.payload = payload;          // multipart（ファイル添付）
  }
  const res = UrlFetchApp.fetch(csBase_() + path, opt);
  const text = res.getContentText();
  if (res.getResponseCode() >= 300) {
    throw new Error('クラウドサイン(' + res.getResponseCode() + '): ' + text.substring(0, 200));
  }
  return text ? JSON.parse(text) : {};
}

/**
 * ⑨ 契約書を送付する。
 * 契約日とメールアドレスが入っていて、まだ送っていない行が対象。
 * 下書き作成 → テンプレートPDF添付 → 宛先追加 → 送信 の順で叩く。
 */
function sendContracts() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const d = ss.getSheetByName(SH.DEALS);
  const tplId = String(getConfig_().CLOUDSIGN_TEMPLATE_FILE_ID || '').trim();
  if (!tplId) { toast_('「設定」シートに CLOUDSIGN_TEMPLATE_FILE_ID（契約書PDFのファイルID）を入れてください。'); return; }

  let blob;
  try {
    blob = DriveApp.getFileById(tplId).getBlob();
  } catch (err) {
    toast_('契約書テンプレートを開けません。ファイルIDと共有設定を確認してください。');
    return;
  }

  let sent = 0;
  const problems = [];
  readDeals_().forEach(x => {
    if (x.cancel) return;
    if (!x.signedAt) return;                                  // 契約日が入ってから送る
    if (String(x.cloudsign).trim() === '送付済' || String(x.cloudsign).trim() === '締結済') return;
    if (x.docIdCs) return;
    if (!x.email) { problems.push(x.name + '（メール未入力）'); return; }

    try {
      // 1. 下書きを作る
      const doc = cs_('/documents', 'post', {
        title: 'アンタイ ' + (x.plan || 'サポート') + ' 契約書　' + x.name + ' 様',
        note: '契約ID: ' + (x.id || '') + '／契約金額: ' + yen_(x.amount),
      });
      const docId = doc.id || doc.documentID;
      if (!docId) throw new Error('書類IDが返りませんでした');

      // 2. 契約書PDFを添付（フィールド名が環境で異なることがあるため2通り試す）
      try {
        cs_('/documents/' + docId + '/files', 'post', { uploadfile: blob }, true);
      } catch (e1) {
        cs_('/documents/' + docId + '/files', 'post', { file: blob }, true);
      }

      // 3. 宛先（署名者）を追加
      cs_('/documents/' + docId + '/participants', 'post', {
        email: x.email, name: x.name + ' 様',
      });

      // 4. 送信
      cs_('/documents/' + docId, 'post', {});

      d.getRange(x.row, C.DOC_ID).setValue(docId);
      d.getRange(x.row, C.CLOUD).setValue('送付済');
      sent++;
    } catch (err) {
      problems.push(x.name + '（' + err.message + '）');
    }
  });

  refreshDashboard();
  if (problems.length) {
    showError_('契約書の送付： ' + sent + '件 成功\n\n送れなかったもの:\n・' + problems.slice(0, 8).join('\n・'));
  } else {
    toast_('契約書を ' + sent + '件 送付しました。');
  }
}

/**
 * ⑩ 締結状況を取り込む。
 * 締結済みになっていれば、クラウドサイン欄と契約書URLを更新する。
 */
function syncContracts() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const d = ss.getSheetByName(SH.DEALS);
  let done = 0;
  const seen = [];

  readDeals_().forEach(x => {
    if (!x.docIdCs) return;
    if (String(x.cloudsign).trim() === '締結済') return;
    try {
      const doc = cs_('/documents/' + x.docIdCs, 'get');
      const raw = doc.status;
      seen.push(x.name + ':' + raw);
      // 締結済みの表現がAPIの版によって数値/文字列で異なるため、どちらでも拾う
      const signed = (raw === 2 || raw === '2' || /締結|completed|done/i.test(String(raw)));
      if (signed) {
        d.getRange(x.row, C.CLOUD).setValue('締結済');
        if (!x.doc) {
          d.getRange(x.row, C.DOC).setValue('https://app.cloudsign.jp/documents/' + x.docIdCs);
        }
        done++;
      }
    } catch (err) {
      console.error('締結状況の取得に失敗 ' + x.name + ': ' + err);
    }
  });

  refreshDashboard();
  toast_('締結を ' + done + '件 確認しました' +
    (seen.length ? '（状態: ' + seen.slice(0, 5).join('、') + '）' : ''));
}

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
  if (stripeMode_() === 'テスト') {
    // 戻し忘れると本番の請求が一切作られなくなるので、いちばん目立つ場所に出す
    sh.getRange(r + 1, 1, 1, 6).merge()
      .setValue('⚠ Stripeはテストモードです。動作確認が終わったら「設定」の STRIPE_MODE を「本番」に戻してください')
      .setBackground('#F8D7D3').setFontWeight('bold').setHorizontalAlignment('left');
  }
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

  r += sRows.length + 2;

  // 紹介者・代理店別（個人単位の比較。チャネル別だけだと誰が効いているか消えるため）
  sh.getRange(r, 1).setValue('紹介者・代理店別').setFontWeight('bold');
  r++;
  const byAgent = {};
  deals.forEach(x => {
    const k = String(x.agent || '').trim();
    if (!k) return;
    const b = byAgent[k] || (byAgent[k] = { lead: 0, met: 0, signed: 0, amount: 0, paid: 0 });
    b.lead++;
    if (x.met instanceof Date) b.met++;
    if (x.signedAt instanceof Date) { b.signed++; b.amount += x.amount; b.paid += x.paid; }
  });
  const aHead = ['紹介者・代理店', 'リード', '面談', '契約', '契約率', '契約金額', '入金済'];
  sh.getRange(r, 1, 1, aHead.length).setValues([aHead])
    .setFontWeight('bold').setBackground('#E3ECF5');
  r++;
  const aRows = Object.keys(byAgent)
    .sort((a, b) => byAgent[b].signed - byAgent[a].signed || byAgent[b].lead - byAgent[a].lead)
    .map(k => {
      const b = byAgent[k];
      return [k, b.lead, b.met, b.signed, pct(b.signed, b.met), b.amount, b.paid];
    });
  if (aRows.length) {
    sh.getRange(r, 1, aRows.length, aHead.length).setValues(aRows);
    sh.getRange(r, 6, aRows.length, 2).setNumberFormat('¥#,##0');
  } else {
    sh.getRange(r, 1).setValue('（紹介者が未設定です）').setFontColor('#6B7885');
  }

  r += Math.max(aRows.length, 1) + 2;

  // 紹介報酬の支払予定（いつ・誰に・いくら出すのかを一目で）
  sh.getRange(r, 1).setValue('紹介報酬の支払予定').setFontWeight('bold');
  r++;
  const rs = ss.getSheetByName(SH.REWARD);
  const buckets = { 期限切れ: [], 今月: [], 来月: [], それ以降: [], 未承認: [] };
  if (rs && rs.getLastRow() > 1) {
    const rw = rs.getRange(2, 1, rs.getLastRow() - 1, 9).getValues();
    const thisM = Utilities.formatDate(now, TZ, 'yyyy-MM');
    const nextM = Utilities.formatDate(new Date(now.getFullYear(), now.getMonth() + 1, 1), TZ, 'yyyy-MM');
    rw.forEach(v => {
      const [, , cname, agent, amt, st, due, paidOn] = v;
      if (!String(cname).trim()) return;
      if (String(paidOn).trim()) return;                 // 支払済みは表示しない
      const item = { agent: agent, amt: Number(amt) || 0, name: cname, due: due };
      if (String(st).trim() === '承認待ち') { buckets.未承認.push(item); return; }
      if (!(due instanceof Date)) { buckets.それ以降.push(item); return; }
      const dm = ym_(due);
      if (due < now && dm !== thisM) buckets.期限切れ.push(item);
      else if (dm === thisM) buckets.今月.push(item);
      else if (dm === nextM) buckets.来月.push(item);
      else buckets.それ以降.push(item);
    });
  }
  const bHead = ['区分', '件数', '金額', '内訳（紹介者）'];
  sh.getRange(r, 1, 1, bHead.length).setValues([bHead])
    .setFontWeight('bold').setBackground('#E3ECF5');
  r++;
  const order = ['期限切れ', '今月', '来月', 'それ以降', '未承認'];
  const bRows = order.map(k => {
    const arr = buckets[k];
    const byA = {};
    arr.forEach(i => { byA[i.agent] = (byA[i.agent] || 0) + i.amt; });
    const detail = Object.keys(byA).map(a => a + ' ' + yen_(byA[a])).join('、');
    return [k, arr.length, arr.reduce((sm, i) => sm + i.amt, 0), detail || '—'];
  });
  sh.getRange(r, 1, bRows.length, bHead.length).setValues(bRows);
  sh.getRange(r, 3, bRows.length, 1).setNumberFormat('¥#,##0');
  if (buckets.期限切れ.length) sh.getRange(r, 1, 1, bHead.length).setBackground('#F8D7D3');
  if (buckets.今月.length) sh.getRange(r + 1, 1, 1, bHead.length).setBackground('#FBEFD9');
  r += bRows.length;

  sh.setColumnWidth(1, 190).setColumnWidth(2, 150).setColumnWidth(3, 160);
  sh.setColumnWidth(4, 120).setColumnWidth(5, 130).setColumnWidth(6, 130);
  ss.setActiveSheet(sh);
  ss.moveActiveSheet(1);
}


/** 入金日から紹介報酬の支払期日を出す（設定のREWARD_PAY_RULEに従う） */
function rewardDueDate_(paidAt) {
  const rule = String(getConfig_().REWARD_PAY_RULE || '翌月末').trim();
  const add = rule.indexOf('翌々月') >= 0 ? 3 : (rule.indexOf('翌月') >= 0 ? 2 : 1);
  return new Date(paidAt.getFullYear(), paidAt.getMonth() + add, 0);   // その月の末日
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
    const due = rewardDueDate_(x.firstPaid);
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
  // Stripeキーが入っていれば入金・返金も毎朝取り込む
  if (String(getConfig_().STRIPE_SECRET_KEY || '').trim()) {
    try { syncPayments(); } catch (err) { console.error('Stripe同期失敗: ' + err); }
  }
  if (String(getConfig_().CLOUDSIGN_CLIENT_ID || '').trim()) {
    try { syncContracts(); } catch (err) { console.error('クラウドサイン同期失敗: ' + err); }
  }
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

/**
 * 編集時に走る（インストール型）。
 * 契約日・プラン・金額がそろっていて決済リンクがまだ無い行は、その場でリンクを発行する。
 * 「プランを入れたら金額とリンクができて、あとは送るだけ」にするための処理。
 */
function onSheetEdit(e) {
  try {
    const sh = e.range.getSheet();
    if (sh.getName() !== SH.DEALS) return;
    const row = e.range.getRow();
    if (row < FIRST) return;
    const col = e.range.getColumn();
    // 契約に関わる列を触ったときだけ判定する
    if ([C.PLAN, C.AMOUNT, C.FIRST_AMT, C.SIGNED, C.EMAIL].indexOf(col) < 0) return;
    if (!String(getConfig_().STRIPE_SECRET_KEY || '').trim()) return;

    const x = readDeals_().filter(v => v.row === row)[0];
    if (!x || x.payLink || x.cancel) return;
    if (!x.signedAt || !(x.first || x.amount)) return;   // 契約日と金額がそろうまで待つ

    const cur = String(getConfig_().STRIPE_CURRENCY || 'jpy').trim();
    const amount = x.first || x.amount;
    const price = stripe_('prices', 'post', {
      'unit_amount': Math.round(amount),
      'currency': cur,
      'product_data[name]': 'アンタイ ' + (x.plan || 'サポート') + '　' + x.name + ' 様',
    });
    const link = stripe_('payment_links', 'post', {
      'line_items[0][price]': price.id,
      'line_items[0][quantity]': 1,
      'metadata[contract_id]': x.id || '',
      'metadata[name]': x.name,
    });
    sh.getRange(row, C.PAYLINK).setValue(link.url);
    sh.getRange(row, C.PAYLINK_ID).setValue(link.id);
    sh.getRange(row, C.PAYSTATUS).setValue('未決済');
    toast_(x.name + ' さんの決済リンクを発行しました（' + yen_(amount) + '）');
  } catch (err) {
    console.error('onSheetEdit: ' + err);
  }
}
