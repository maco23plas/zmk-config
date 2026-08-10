/*************************************************************************
 * 生徒管理シート × Discord 連携ツール
 * -----------------------------------------------------------------------
 * AIC_商品開発管理シート（Instagram運用代行スクール）の生徒管理を
 * Discord と連携し、リマインドの自動送信・改善提案・ダッシュボード化を行う。
 *
 * 【できること】
 *  1) 要対応の生徒を自動検知して Discord にリマインド送信（講師別にまとめる）
 *     - 音信不通 / 2週以上週報なし / 稼働低下
 *     - 卒業日が近い / 休会復帰が近い
 *     - ステージ別 KPI の期限超過リスク
 *  2) 週次サマリー＋改善提案を Discord に送信
 *  3) シート内に「🚨アラート」列を自動更新（一目で要対応がわかる）
 *  4) 「📊ダッシュボード」シートを自動生成・更新
 *
 * 【セットアップ】README.md を参照。要点だけ:
 *  1) シートの「拡張機能 → Apps Script」を開き、このコードを貼り付け
 *  2) Discordで「サーバー設定 → 連携サービス → ウェブフック」を作成しURLをコピー
 *  3) スプレッドシート上部メニュー「📋生徒管理ツール → ① Discord Webhookを設定」
 *  4) 「② 自動リマインドをON（トリガー設定）」を実行
 *************************************************************************/

/* ===================== 設定 ===================== */
const CONFIG = {
  // 生徒テーブルのシート名（空文字なら見出し行から自動検出）
  studentSheetName: '',
  dashboardSheetName: '📊ダッシュボード',
  alertColumnHeader: '🚨アラート',
  timezone: 'Asia/Tokyo',

  // 卒業日 / 休会復帰日の何日前に通知するか
  graduationReminderDays: [30, 14, 7, 3, 1],
  leaveReturnReminderDays: [7, 3, 1],

  // KPI報告事項の文言（シートの値に合わせる）
  noReportText: '2週以上週報提出なし',
  lowActivityText: '稼働時間_基準以下',

  // 要フォローとみなすステータス
  followUpStatuses: ['経過観察', '問題あり'],
  outOfContactStatus: '音信不通',

  // ステージ別 KPI（入会または最新進級日からの経過日数で判定）
  // revenue は「最大収益」がこの金額未満なら未達リスクとみなす
  kpi: {
    'ゼロイチ':   { days: 30,  revenue: 1,      label: '初案件（トライアル）獲得' },
    '初心者':     { days: 30,  revenue: 0,      label: 'ポートフォリオ完了' },
    'アドバンス': { days: 60,  revenue: 100000, label: '10万円以上の案件獲得' },
    'マスター':   { days: 60,  revenue: 150000, label: '15万円以上の案件獲得' },
  },

  // 講師ごとに別チャンネルへ送りたい場合は webhook URL を設定（空ならメインへ集約）
  // 例: '砂川': 'https://discord.com/api/webhooks/xxx/yyy'
  instructorWebhooks: {
    '砂川': '',
    '上野': '',
    '土方': '',
  },

  // 講師メンション設定。Discordで講師（または講師ロール）のIDを調べて設定する。
  //  ・ユーザーをメンション : '<@123456789>'  または  数字IDだけ '123456789'
  //  ・ロールをメンション   : '<@&123456789>'
  // 空のままだと、その講師は名前表示のみ（通知ピングなし）になる。
  instructorMentions: {
    '砂川': '',
    '上野': '',
    '土方': '',
  },

  // リマインド／状況報告を送る曜日（月=MONDAY 〜）と時刻（24h）
  scheduleWeekDays: ['MONDAY', 'FRIDAY'],
  scheduleHour: 8,
};

// 既知のステータス（生徒行の判定に使用）
const KNOWN_STATUSES = ['問題無', '概ね問題無', '経過観察', '問題あり', '音信不通', '休学中', '休会中'];

// Discord 埋め込みの色
const COLOR = {
  red: 0xE74C3C, orange: 0xE67E22, yellow: 0xF1C40F,
  green: 0x2ECC71, blue: 0x3498DB, gray: 0x95A5A6, purple: 0x9B59B6,
};

// アラートの重大度（数値が大きいほど優先）
const SEVERITY = { red: 4, orange: 3, yellow: 2, green: 1, blue: 1, gray: 0 };

// シートのデザインテーマ（コーポレート・ブルー）
const THEME = {
  headerBg: '#1155CC', headerText: '#FFFFFF',          // ヘッダー: ロイヤルブルー×白
  bandA: '#FFFFFF', bandB: '#EAF1FB',                  // 行ストライプ: 白 / 極薄ブルー
  sectionBg: '#0B2C5E', sectionText: '#FFFFFF',        // 月区切りバー: ネイビー×白
  gridBorder: '#C6D2E5', groupBorder: '#1155CC',       // 罫線 / 列グループ仕切り
  bodyText: '#202124',
  // ステータス（はっきりした信号色）
  status: {
    '問題無':     { bg: '#34A853', fg: '#FFFFFF' },
    '概ね問題無': { bg: '#B7E1B0', fg: '#1E5631' },
    '経過観察':   { bg: '#FFD966', fg: '#7F6000' },
    '問題あり':   { bg: '#FF9900', fg: '#FFFFFF' },
    '音信不通':   { bg: '#EA4335', fg: '#FFFFFF' },
    '休学中':     { bg: '#D9D9D9', fg: '#666666' },
    '休会中':     { bg: '#D9D9D9', fg: '#666666' },
  },
  // ステージ
  stage: {
    'ゼロイチ':   { bg: '#FCE5CD', fg: '#7F4000' },
    '初心者':     { bg: '#FFF2CC', fg: '#7F6000' },
    'アドバンス': { bg: '#CFE2F3', fg: '#0B5394' },
    'マスター':   { bg: '#D9D2E9', fg: '#351C75' },
    '卒業':       { bg: '#EFEFEF', fg: '#666666' },
  },
  // 🚨アラート列（重大度で淡く）
  alert: { '🔴': '#FAD2CF', '🟠': '#FCE4CC', '🟡': '#FFF2CC', '🔵': '#D6E4F7', '🟢': '#D6EAD9' },
};


/* ===================== メニュー ===================== */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📋生徒管理ツール')
    .addItem('① Discord Webhookを設定', 'setWebhook')
    .addItem('② 自動配信をON（月・金 8:00）', 'installTriggers')
    .addSeparator()
    .addItem('🚀 今すぐ リマインド＋状況報告を送信', 'runScheduledReport')
    .addItem('🔔 リマインドのみ送信', 'sendReminders')
    .addItem('📊 状況報告のみ送信', 'sendWeeklySummary')
    .addSeparator()
    .addItem('🎨 シートを見やすく整形', 'formatStudentSheet')
    .addItem('🚨 アラート列を更新', 'refreshAlertColumn')
    .addItem('📈 ダッシュボードを更新', 'refreshDashboard')
    .addSeparator()
    .addItem('🧪 Discord接続テスト', 'testDiscord')
    .addItem('⏹ 自動リマインドをOFF', 'removeTriggers')
    .addToUi();
}


/* ===================== Webhook 設定 ===================== */
function setWebhook() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt(
    'Discord Webhook の設定',
    'Discordの「サーバー設定 → 連携サービス → ウェブフック」で作成したURLを貼り付けてください:',
    ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const url = res.getResponseText().trim();
  if (!/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(url)) {
    ui.alert('URLの形式が正しくないようです。Discordのwebhook URLを貼り付けてください。');
    return;
  }
  PropertiesService.getScriptProperties().setProperty('DISCORD_WEBHOOK_URL', url);
  ui.alert('保存しました。「🧪 Discord接続テスト」で確認できます。');
}

function getMainWebhook_() {
  const url = PropertiesService.getScriptProperties().getProperty('DISCORD_WEBHOOK_URL');
  if (!url) throw new Error('Discord Webhook が未設定です。メニュー「① Discord Webhookを設定」を先に実行してください。');
  return url;
}

function testDiscord() {
  postToDiscord_(getMainWebhook_(), {
    username: '生徒管理Bot',
    embeds: [{
      title: '✅ 接続テスト成功',
      description: '生徒管理シートとDiscordの連携が完了しました。\nこれでリマインド・提案を自動でお届けできます。',
      color: COLOR.green,
      footer: { text: '生徒管理ツール' },
      timestamp: new Date().toISOString(),
    }],
  });
  toast_('Discordにテストメッセージを送信しました', '✅', 5);
}


/* ===================== トリガー ===================== */
function installTriggers() {
  removeTriggers();
  // 指定曜日（既定: 月・金）の指定時刻（既定: 8:00 JST）に リマインド＋状況報告
  CONFIG.scheduleWeekDays.forEach(function (wd) {
    const day = ScriptApp.WeekDay[wd];
    if (!day) return;
    ScriptApp.newTrigger('runScheduledReport').timeBased().onWeekDay(day)
      .atHour(CONFIG.scheduleHour).inTimezone(CONFIG.timezone).create();
  });
  const days = CONFIG.scheduleWeekDays.map(wd => ({ MONDAY: '月', TUESDAY: '火', WEDNESDAY: '水', THURSDAY: '木', FRIDAY: '金', SATURDAY: '土', SUNDAY: '日' }[wd] || wd)).join('・');
  SpreadsheetApp.getUi().alert(
    '自動配信をONにしました。\n\n・毎週 ' + days + '曜 ' + CONFIG.scheduleHour + ':00\n　→ アラート列／ダッシュボード更新 → リマインド（講師メンション付き）→ 状況報告');
}

function removeTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    const fn = t.getHandlerFunction();
    if (['runScheduledReport', 'sendReminders', 'sendWeeklySummary', 'refreshAlertColumn', 'refreshDashboard'].indexOf(fn) >= 0) {
      ScriptApp.deleteTrigger(t);
    }
  });
}

// 定期実行のまとめ役：シート更新 → リマインド → 状況報告 を一括で行う
function runScheduledReport() {
  refreshAlertColumn();
  refreshDashboard();
  sendReminders();
  sendWeeklySummary();
}


/* ===================== シート読み取り ===================== */
function findStudentSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (CONFIG.studentSheetName) {
    const s = ss.getSheetByName(CONFIG.studentSheetName);
    if (s) return s;
  }
  // 見出し行（名前・ステータス・講師・ステージ を含む行）を持つシートを探す
  const sheets = ss.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    if (findHeaderRow_(sheets[i]) >= 0) return sheets[i];
  }
  throw new Error('生徒テーブルが見つかりませんでした。CONFIG.studentSheetName にシート名を指定してください。');
}

function normalizeHeader_(v) {
  return String(v == null ? '' : v).replace(/[\s　\r\n]/g, '');
}

function findHeaderRow_(sheet) {
  const maxRows = Math.min(sheet.getLastRow(), 30);
  if (maxRows < 1) return -1;
  const values = sheet.getRange(1, 1, maxRows, Math.max(sheet.getLastColumn(), 1)).getValues();
  for (let r = 0; r < values.length; r++) {
    const row = values[r].map(normalizeHeader_);
    if (row.indexOf('名前') >= 0 && row.indexOf('ステータス') >= 0 &&
        row.indexOf('講師') >= 0 && row.indexOf('ステージ') >= 0) {
      return r + 1; // 1-based
    }
  }
  return -1;
}

// 見出し名 → 列番号(1-based) のマップを作る
function buildColumnMap_(sheet, headerRow) {
  const headers = sheet.getRange(headerRow, 1, 1, sheet.getLastColumn()).getValues()[0].map(normalizeHeader_);
  const find = function (predicate) {
    for (let i = 0; i < headers.length; i++) if (predicate(headers[i])) return i + 1;
    return -1;
  };
  return {
    name:       find(h => h === '名前'),
    status:     find(h => h === 'ステータス'),
    joinDate:   find(h => h.indexOf('入会') >= 0),
    gradDate:   find(h => h.indexOf('卒業') >= 0),
    workType:   find(h => h.indexOf('業務区分') >= 0 || h.indexOf('副・専') >= 0),
    source:     find(h => h.indexOf('流入') >= 0),
    instructor: find(h => h === '講師'),
    stage:      find(h => h.indexOf('ステージ') >= 0),
    promoteDate:find(h => h.indexOf('進級') >= 0),
    leaveStart: find(h => h.indexOf('休会開始') >= 0),
    leaveEnd:   find(h => h.indexOf('休会終了') >= 0),
    kpiExclude: find(h => h.indexOf('KPI対象外') >= 0),
    reportNote: find(h => h.indexOf('報告事項') >= 0),
    lastRevenue:find(h => h.indexOf('先月') >= 0 && h.indexOf('収益') >= 0),
    maxRevenue: find(h => h.indexOf('最大') >= 0 && h.indexOf('収益') >= 0),
    meetingUrl: find(h => h.indexOf('FMTG') >= 0 || h.indexOf('REC') >= 0),
    note:       find(h => h.indexOf('説明') >= 0),
  };
}

function readStudents_() {
  const sheet = findStudentSheet_();
  const headerRow = findHeaderRow_(sheet);
  const col = buildColumnMap_(sheet, headerRow);
  const lastRow = sheet.getLastRow();
  if (lastRow <= headerRow) return { sheet: sheet, headerRow: headerRow, col: col, students: [] };

  const numRows = lastRow - headerRow;
  const numCols = sheet.getLastColumn();
  const data = sheet.getRange(headerRow + 1, 1, numRows, numCols).getValues();

  const get = function (row, c) { return c > 0 ? row[c - 1] : ''; };
  const students = [];
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const name = String(get(row, col.name) || '').trim();
    const status = String(get(row, col.status) || '').trim();
    if (!name || KNOWN_STATUSES.indexOf(status) < 0) continue; // 月区切り行・空行を除外

    students.push({
      rowIndex: headerRow + 1 + i, // シート上の実際の行番号
      name: name,
      status: status,
      joinDate: parseDate_(get(row, col.joinDate), 'past'),
      gradDate: parseDate_(get(row, col.gradDate), 'future'),
      workType: String(get(row, col.workType) || '').trim(),
      source: String(get(row, col.source) || '').trim(),
      instructor: String(get(row, col.instructor) || '').trim() || '未割当',
      stage: String(get(row, col.stage) || '').trim(),
      promoteDate: parseDate_(get(row, col.promoteDate), 'past'),
      leaveStart: parseDate_(get(row, col.leaveStart), 'past'),
      leaveEnd: parseDate_(get(row, col.leaveEnd), 'future'),
      kpiExclude: toBool_(get(row, col.kpiExclude)),
      reportNote: String(get(row, col.reportNote) || '').trim(),
      lastRevenue: parseYen_(get(row, col.lastRevenue)),
      maxRevenue: parseYen_(get(row, col.maxRevenue)),
      meetingUrl: String(get(row, col.meetingUrl) || '').trim(),
      note: String(get(row, col.note) || '').trim(),
    });
  }
  return { sheet: sheet, headerRow: headerRow, col: col, students: students };
}


/* ===================== パーサ ===================== */
function toBool_(v) {
  if (typeof v === 'boolean') return v;
  return String(v).trim().toUpperCase() === 'TRUE';
}

function parseYen_(v) {
  if (typeof v === 'number') return v;
  const s = String(v == null ? '' : v).replace(/[^0-9.-]/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

// 日付セルをパース。Dateオブジェクト or "MM/DD" 文字列に対応。
// mode: 'future'（卒業日・休会終了日など今後の予定）/ 'past'（入会日など）/ 'near'
function parseDate_(v, mode) {
  if (v instanceof Date && !isNaN(v.getTime())) return stripTime_(v);
  const s = String(v == null ? '' : v).trim();
  if (!s) return null;

  // YYYY/MM/DD or YYYY-MM-DD
  let m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);

  // MM/DD
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})$/);
  if (!m) return null;
  const mm = +m[1], dd = +m[2];
  const today = stripTime_(new Date());
  const y = today.getFullYear();
  const candidates = [new Date(y - 1, mm - 1, dd), new Date(y, mm - 1, dd), new Date(y + 1, mm - 1, dd)];

  if (mode === 'future') {
    // 今日以降で最も近い日付（無ければ最も近い過去）
    const future = candidates.filter(d => d >= addDays_(today, -1)).sort((a, b) => a - b);
    if (future.length) return future[0];
  } else if (mode === 'past') {
    const past = candidates.filter(d => d <= addDays_(today, 1)).sort((a, b) => b - a);
    if (past.length) return past[0];
  }
  // near: 今日に最も近い
  return candidates.sort((a, b) => Math.abs(a - today) - Math.abs(b - today))[0];
}

function stripTime_(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function addDays_(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
function daysBetween_(a, b) { return Math.round((stripTime_(b) - stripTime_(a)) / 86400000); }
function fmtMD_(d) { return d ? Utilities.formatDate(d, CONFIG.timezone, 'M/d') : '-'; }
function fmtYen_(n) { return (n == null) ? '-' : '¥' + Math.round(n).toLocaleString('ja-JP'); }

// トースト表示（ウェブアプリ実行時など、アクティブUIが無い場合は無視する）
function toast_(msg, title, sec) {
  try { SpreadsheetApp.getActiveSpreadsheet().toast(msg, title, sec); } catch (e) {}
}


/* ===================== アラート生成 ===================== */
// 1人の生徒について、要対応アラートの配列を返す
function alertsForStudent_(s, today) {
  const out = [];
  const isOnLeave = s.leaveStart && (!s.leaveEnd || s.leaveEnd >= today) && s.leaveStart <= today;

  // 音信不通（最優先）
  if (s.status === CONFIG.outOfContactStatus) {
    out.push({ level: 'red', cat: '音信不通', msg: '🔴 **音信不通** — 再接触が必要' });
  }
  // 週報未提出 / 稼働低下
  if (s.reportNote && s.reportNote.indexOf(CONFIG.noReportText) >= 0) {
    out.push({ level: 'orange', cat: '週報未提出', msg: '🟠 ' + CONFIG.noReportText });
  }
  if (s.reportNote && s.reportNote.indexOf(CONFIG.lowActivityText) >= 0) {
    out.push({ level: 'orange', cat: '稼働低下', msg: '🟠 ' + CONFIG.lowActivityText });
  }
  // 要フォロー（経過観察 / 問題あり）
  if (CONFIG.followUpStatuses.indexOf(s.status) >= 0) {
    out.push({ level: 'yellow', cat: 'フォロー', msg: '🟡 ステータス「' + s.status + '」' });
  }
  // 卒業日が近い
  if (s.gradDate) {
    const d = daysBetween_(today, s.gradDate);
    if (d >= 0 && CONFIG.graduationReminderDays.indexOf(d) >= 0) {
      out.push({ level: 'blue', cat: '卒業間近', msg: '🎓 卒業まであと **' + d + '日**（' + fmtMD_(s.gradDate) + '）— 卒業案内の準備を' });
    }
  }
  // 休会復帰が近い
  if (isOnLeave && s.leaveEnd) {
    const d = daysBetween_(today, s.leaveEnd);
    if (d >= 0 && CONFIG.leaveReturnReminderDays.indexOf(d) >= 0) {
      out.push({ level: 'green', cat: '休会復帰', msg: '🔄 休会終了まであと **' + d + '日**（' + fmtMD_(s.leaveEnd) + '）— 復帰フォローを' });
    }
  }
  // ステージ別 KPI 期限超過リスク
  if (!s.kpiExclude && !isOnLeave) {
    const k = CONFIG.kpi[s.stage];
    if (k) {
      const base = s.promoteDate || s.joinDate;
      if (base) {
        const elapsed = daysBetween_(base, today);
        const achieved = (s.maxRevenue != null && s.maxRevenue >= k.revenue);
        if (elapsed >= k.days && !achieved) {
          out.push({
            level: 'red', cat: 'KPI未達',
            msg: '⚠️ **KPI期限超過**（' + s.stage + '：' + k.label + '）経過' + elapsed + '日／最大収益 ' + fmtYen_(s.maxRevenue),
          });
        } else if (elapsed >= Math.floor(k.days * 0.75) && elapsed < k.days && !achieved) {
          out.push({
            level: 'yellow', cat: 'KPI注意',
            msg: '⏳ KPI期限が近い（' + s.stage + '：' + k.label + '）残り約' + (k.days - elapsed) + '日',
          });
        }
      }
    }
  }
  return out;
}

function maxSeverityLevel_(alerts) {
  let best = null, score = -1;
  alerts.forEach(function (a) {
    if (SEVERITY[a.level] > score) { score = SEVERITY[a.level]; best = a.level; }
  });
  return best;
}


/* ===================== リマインド送信 ===================== */
// 講師名 → Discordメンション文字列（通知ピングが飛ぶ形）に変換
function mentionFor_(instructor) {
  const raw = String(CONFIG.instructorMentions[instructor] || '').trim();
  if (!raw) return '';
  if (raw.indexOf('<@') === 0) return raw;        // すでに <@..> / <@&..> 形式
  if (/^\d+$/.test(raw)) return '<@' + raw + '>'; // 数字IDのみ → ユーザーメンション
  return raw;
}

const ALLOWED_MENTIONS = { parse: ['users', 'roles'] }; // @everyone は飛ばさない

function sendReminders() {
  const today = stripTime_(new Date());
  const data = readStudents_();
  const webhook = getMainWebhook_();

  // 講師ごとに要対応をまとめる
  const byInstructor = {};
  let totalAlerts = 0, totalStudents = 0;
  data.students.forEach(function (s) {
    const alerts = alertsForStudent_(s, today);
    if (!alerts.length) return;
    totalAlerts += alerts.length;
    totalStudents++;
    if (!byInstructor[s.instructor]) byInstructor[s.instructor] = [];
    byInstructor[s.instructor].push({ student: s, alerts: alerts });
  });

  const dateStr = Utilities.formatDate(today, CONFIG.timezone, 'yyyy/MM/dd (E)');

  if (totalAlerts === 0) {
    postToDiscord_(webhook, {
      username: '生徒管理Bot',
      embeds: [{ title: '🔔 要対応リマインド（' + dateStr + '）', description: '✅ 本日の要対応はありません。順調です！', color: COLOR.green, timestamp: new Date().toISOString() }],
    });
    toast_('要対応なし。Discordに通知しました', '🔔', 5);
    return;
  }

  // 全体ヘッダー（メンションなし）
  postToDiscord_(webhook, {
    username: '生徒管理Bot',
    embeds: [{
      title: '🔔 要対応リマインド（' + dateStr + '）',
      description: '対応が必要な生徒は **' + totalStudents + '名**／アラート計 **' + totalAlerts + '件**\n講師ごとにメンションして以下に展開します。',
      color: COLOR.orange,
      footer: { text: '優先度: 🔴最優先 / 🟠要対応 / 🟡フォロー / 🎓🔄予定' },
      timestamp: new Date().toISOString(),
    }],
  });

  // 講師ごとに「メンション + 担当生徒の要対応」を送信
  Object.keys(byInstructor).sort().forEach(function (ins) {
    const items = byInstructor[ins];
    const embeds = buildInstructorEmbeds_(ins, items);
    const hook = CONFIG.instructorWebhooks[ins] || webhook;
    const mention = mentionFor_(ins);
    const content = (mention ? mention + ' ' : '') + '📋 【' + ins + '】要対応 ' + items.length + '名 / ' +
      items.reduce((a, it) => a + it.alerts.length, 0) + '件';
    // 1通目に content（メンション）を載せ、残りembedは続けて送る
    postToDiscord_(hook, { username: '生徒管理Bot', content: content, embeds: embeds.slice(0, 10), allowed_mentions: ALLOWED_MENTIONS });
    if (embeds.length > 10) sendEmbedsChunked_(hook, embeds.slice(10));
  });

  toast_(totalAlerts + '件の要対応を講師メンション付きで送信しました', '🔔', 5);
}

function buildInstructorEmbeds_(instructor, items) {
  // items: [{student, alerts}]
  // 重大度の高い順に並べる
  items.sort(function (a, b) {
    return SEVERITY[maxSeverityLevel_(b.alerts)] - SEVERITY[maxSeverityLevel_(a.alerts)];
  });
  const lines = items.map(function (it) {
    const s = it.student;
    const head = '**' + s.name + '**（' + s.stage + '／' + (s.status) + '）';
    const detail = it.alerts.map(a => '　' + a.msg).join('\n');
    return head + '\n' + detail;
  });
  // 重大度最大で色を決定
  const topLevel = items.length ? maxSeverityLevel_(items[0].alerts) : 'gray';
  return chunkLinesToEmbeds_('👤 講師: ' + instructor + '（' + items.length + '名）', lines, COLOR[topLevel] || COLOR.gray);
}

// 行配列を Discord 埋め込み（description 4096字制限）に収まるよう分割
function chunkLinesToEmbeds_(title, lines, color) {
  const embeds = [];
  let buf = [];
  let len = 0;
  const flush = function () {
    if (!buf.length) return;
    embeds.push({
      title: embeds.length === 0 ? title : title + '（続き）',
      description: buf.join('\n\n'),
      color: color,
    });
    buf = []; len = 0;
  };
  lines.forEach(function (ln) {
    if (len + ln.length + 2 > 3800 && buf.length) flush();
    buf.push(ln); len += ln.length + 2;
  });
  flush();
  return embeds;
}

function sendEmbedsChunked_(webhook, embeds) {
  for (let i = 0; i < embeds.length; i += 10) {
    postToDiscord_(webhook, { username: '生徒管理Bot', embeds: embeds.slice(i, i + 10) });
  }
}


/* ===================== 週次サマリー＋提案 ===================== */
function sendWeeklySummary() {
  const today = stripTime_(new Date());
  const data = readStudents_();
  const students = data.students;
  const webhook = getMainWebhook_();

  // 集計
  const byStatus = {}, byStage = {}, byInstructor = {};
  let active = 0, revenues = [], kpiAchieved = 0;
  students.forEach(function (s) {
    byStatus[s.status] = (byStatus[s.status] || 0) + 1;
    byStage[s.stage] = (byStage[s.stage] || 0) + 1;
    byInstructor[s.instructor] = (byInstructor[s.instructor] || 0) + 1;
    active++;
    if (s.maxRevenue != null && s.maxRevenue > 0) revenues.push(s.maxRevenue);
    const k = CONFIG.kpi[s.stage];
    if (k && s.maxRevenue != null && s.maxRevenue >= k.revenue && k.revenue > 0) kpiAchieved++;
  });
  const maxRev = revenues.length ? Math.max.apply(null, revenues) : 0;
  const avgRev = revenues.length ? Math.round(revenues.reduce((a, b) => a + b, 0) / revenues.length) : 0;

  const statusLine = KNOWN_STATUSES.filter(k => byStatus[k]).map(k => k + ': ' + byStatus[k]).join(' / ');
  const stageLine = Object.keys(byStage).map(k => k + ': ' + byStage[k]).join(' / ');
  const insLine = Object.keys(byInstructor).sort().map(k => k + ': ' + byInstructor[k]).join(' / ');

  const summaryEmbed = {
    title: '📊 週次サマリー（' + Utilities.formatDate(today, CONFIG.timezone, 'yyyy/MM/dd') + '）',
    color: COLOR.blue,
    fields: [
      { name: '在籍者数', value: String(active) + '名', inline: true },
      { name: 'KPI達成', value: String(kpiAchieved) + '名', inline: true },
      { name: '音信不通', value: String(byStatus[CONFIG.outOfContactStatus] || 0) + '名', inline: true },
      { name: '最大収益 / 平均収益', value: fmtYen_(maxRev) + ' / ' + fmtYen_(avgRev), inline: false },
      { name: 'ステータス内訳', value: statusLine || '-', inline: false },
      { name: 'ステージ内訳', value: stageLine || '-', inline: false },
      { name: '講師別人数', value: insLine || '-', inline: false },
    ],
    timestamp: new Date().toISOString(),
  };

  // 改善提案
  const suggestions = generateSuggestions_(students, today);
  const suggestEmbeds = chunkLinesToEmbeds_('💡 今週の改善提案', suggestions, COLOR.purple);

  sendEmbedsChunked_(webhook, [summaryEmbed].concat(suggestEmbeds));
  toast_('週次サマリー＋提案をDiscordに送信しました', '📊', 5);
}

function generateSuggestions_(students, today) {
  const out = [];

  // 1) 音信不通の再接触リスト
  const ooc = students.filter(s => s.status === CONFIG.outOfContactStatus);
  if (ooc.length) {
    out.push('🔴 **音信不通の再接触（' + ooc.length + '名）**\n' +
      ooc.map(s => '　・' + s.name + '（' + s.instructor + '）').join('\n') +
      '\n→ 個別DM＋別チャネル（電話/メール）での再接触を推奨。');
  }

  // 2) 昇格候補（KPIの売上を達成済みだが下位ステージのまま）
  const promote = students.filter(function (s) {
    if (s.maxRevenue == null) return false;
    if (s.stage === 'アドバンス' && s.maxRevenue >= 150000) return true; // マスター水準
    if (s.stage === 'ゼロイチ' && s.maxRevenue >= 100000) return true;   // アドバンス水準
    if (s.stage === '初心者' && s.maxRevenue >= 1) return true;          // ゼロイチ達成
    return false;
  });
  if (promote.length) {
    out.push('🚀 **昇格・称号UP候補（' + promote.length + '名）**\n' +
      promote.map(s => '　・' + s.name + '（現' + s.stage + '／最大' + fmtYen_(s.maxRevenue) + '）').join('\n') +
      '\n→ 実績に見合うステージへ更新し、次の目標を提示。');
  }

  // 3) KPI期限超過の未達リスト
  const kpiRisk = [];
  students.forEach(function (s) {
    if (s.kpiExclude) return;
    const k = CONFIG.kpi[s.stage];
    if (!k) return;
    const base = s.promoteDate || s.joinDate;
    if (!base) return;
    const elapsed = daysBetween_(base, today);
    const achieved = (s.maxRevenue != null && s.maxRevenue >= k.revenue);
    if (elapsed >= k.days && !achieved) kpiRisk.push(s);
  });
  if (kpiRisk.length) {
    out.push('⚠️ **KPI期限超過（' + kpiRisk.length + '名）**\n' +
      kpiRisk.slice(0, 15).map(s => '　・' + s.name + '（' + s.stage + '／' + s.instructor + '）').join('\n') +
      (kpiRisk.length > 15 ? '\n　…ほか' + (kpiRisk.length - 15) + '名' : '') +
      '\n→ 個別1on1で詰まりポイントを特定し、行動計画を再設定。');
  }

  // 4) 卒業30日以内かつ成果ゼロ
  const gradNoResult = students.filter(function (s) {
    if (!s.gradDate) return false;
    const d = daysBetween_(today, s.gradDate);
    return d >= 0 && d <= 30 && (s.maxRevenue == null || s.maxRevenue <= 0);
  });
  if (gradNoResult.length) {
    out.push('🎓 **卒業間近×成果ゼロ（' + gradNoResult.length + '名）**\n' +
      gradNoResult.map(s => '　・' + s.name + '（卒業 ' + fmtMD_(s.gradDate) + '／' + s.instructor + '）').join('\n') +
      '\n→ 卒業前の駆け込み案件獲得サポート or 継続提案を検討。');
  }

  // 5) 講師別の要対応負荷
  const load = {};
  students.forEach(function (s) {
    const alerts = alertsForStudent_(s, today);
    if (!alerts.length) return;
    load[s.instructor] = (load[s.instructor] || 0) + 1;
  });
  const loadKeys = Object.keys(load).sort((a, b) => load[b] - load[a]);
  if (loadKeys.length) {
    out.push('📌 **講師別 要対応件数**\n' +
      loadKeys.map(k => '　・' + k + '：' + load[k] + '名').join('\n') +
      '\n→ 偏りが大きい場合は対応の分担・優先順位づけを。');
  }

  if (!out.length) out.push('✅ 特筆すべきリスクはありません。良い状態を維持しましょう。');
  return out;
}


/* ===================== シート内アラート列 ===================== */
function refreshAlertColumn() {
  const today = stripTime_(new Date());
  const data = readStudents_();
  const sheet = data.sheet;
  const headerRow = data.headerRow;

  // アラート列の位置（無ければ最終列の右に作成）
  const headers = sheet.getRange(headerRow, 1, 1, sheet.getLastColumn()).getValues()[0].map(normalizeHeader_);
  let colIdx = headers.indexOf(normalizeHeader_(CONFIG.alertColumnHeader)) + 1;
  if (colIdx === 0) {
    colIdx = sheet.getLastColumn() + 1;
    sheet.getRange(headerRow, colIdx).setValue(CONFIG.alertColumnHeader).setFontWeight('bold');
  }

  // 行ごとに記入
  data.students.forEach(function (s) {
    const alerts = alertsForStudent_(s, today);
    let text = '';
    if (alerts.length) {
      const top = maxSeverityLevel_(alerts);
      const emoji = { red: '🔴', orange: '🟠', yellow: '🟡', green: '🟢', blue: '🔵', gray: '⚪' }[top];
      text = emoji + ' ' + alerts.map(a => a.cat).join(' / ');
    }
    sheet.getRange(s.rowIndex, colIdx).setValue(text);
  });
  toast_('アラート列を更新しました', '🚨', 4);
}


/* ===================== シート再デザイン（コーポレート・ブルー） ===================== */
// データの値は変更せず、見た目（テーマ配色・ストライプ・月区切りバー・信号色・
// 列グループ仕切り・通貨・列幅）を一括で刷新する。再実行OK。
// ※ 同じタブに上部/下部の集計ブロックが同居しているため、列の挿入・並べ替えは行わない
//    （他ブロックの崩れ・数式参照ズレを防ぐため）。整形対象は生徒テーブルの範囲のみ。
function formatStudentSheet() {
  const sheet = findStudentSheet_();
  const headerRow = findHeaderRow_(sheet);
  const col = buildColumnMap_(sheet, headerRow);
  const firstDataRow = headerRow + 1;
  const maxRows = sheet.getMaxRows();
  if (maxRows < firstDataRow) { SpreadsheetApp.getUi().alert('整形対象の行が見つかりませんでした。'); return; }

  // 🚨アラート列が無ければ最終列に作成（列の挿入は行わない）
  let headers = sheet.getRange(headerRow, 1, 1, sheet.getLastColumn()).getValues()[0].map(normalizeHeader_);
  let alertCol = headers.indexOf(normalizeHeader_(CONFIG.alertColumnHeader)) + 1;
  if (alertCol === 0) {
    alertCol = sheet.getLastColumn() + 1;
    sheet.getRange(headerRow, alertCol).setValue(CONFIG.alertColumnHeader);
  }
  const lastCol = sheet.getLastColumn();

  // テーブルの最終行を推定（KPI対象外列が埋まっている範囲＝入力テンプレ行まで。下部集計は除外）
  let tableEnd = firstDataRow;
  if (col.kpiExclude > 0) {
    const kvals = sheet.getRange(firstDataRow, col.kpiExclude, maxRows - headerRow, 1).getValues();
    for (let i = kvals.length - 1; i >= 0; i--) {
      if (String(kvals[i][0]).trim() !== '') { tableEnd = firstDataRow + i; break; }
    }
  } else {
    tableEnd = sheet.getLastRow();
  }
  if (tableEnd < firstDataRow) tableEnd = firstDataRow;
  const nRows = tableEnd - firstDataRow + 1;

  // ---- 見出し行（ロイヤルブルー）----
  sheet.getRange(headerRow, 1, 1, lastCol)
    .setBackground(THEME.headerBg).setFontColor(THEME.headerText).setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true).setFontSize(10);
  sheet.setRowHeight(headerRow, 46);
  try { sheet.setFrozenRows(headerRow); } catch (e) {}

  // ---- 行を分類して背景を一括設定（白/極薄ブルーのストライプ＋月区切りはネイビーバー）----
  const values = sheet.getRange(firstDataRow, 1, nRows, lastCol).getValues();
  const bg = [];
  const sepRows = [];
  const monthRe = /^\s*\d{4}[\/\-]\d{1,2}\s*$/;
  let dataCounter = 0;
  for (let i = 0; i < nRows; i++) {
    const row = values[i];
    const name = String(col.name > 0 ? row[col.name - 1] : '').trim();
    const status = String(col.status > 0 ? row[col.status - 1] : '').trim();
    const isStudent = name && KNOWN_STATUSES.indexOf(status) >= 0;
    let isSep = false;
    if (!isStudent) {
      for (let c = 0; c < row.length; c++) { if (monthRe.test(String(row[c]))) { isSep = true; break; } }
    }
    let color;
    if (isSep) { color = THEME.sectionBg; sepRows.push(i); }
    else { color = (dataCounter % 2 === 0) ? THEME.bandA : THEME.bandB; dataCounter++; }
    const line = new Array(lastCol);
    for (let c = 0; c < lastCol; c++) line[c] = color;
    bg.push(line);
  }

  const body = sheet.getRange(firstDataRow, 1, nRows, lastCol);
  body.setBackgrounds(bg);
  body.setVerticalAlignment('middle').setFontSize(10).setFontColor(THEME.bodyText);
  body.setBorder(true, true, true, true, true, true, THEME.gridBorder, SpreadsheetApp.BorderStyle.SOLID);
  body.setHorizontalAlignment('center');
  // テキスト主体の列は左寄せ
  [col.name, col.reportNote, col.note].forEach(function (c) {
    if (c > 0) sheet.getRange(firstDataRow, c, nRows, 1).setHorizontalAlignment('left');
  });
  // 月区切り行は白文字・太字・左寄せで仕上げ（最後に上書き）
  sepRows.forEach(function (i) {
    sheet.getRange(firstDataRow + i, 1, 1, lastCol)
      .setFontColor(THEME.sectionText).setFontWeight('bold').setHorizontalAlignment('left');
  });

  // ---- 条件付き書式（信号色のステータス／ステージ／報告事項／アラート）----
  sheet.clearConditionalFormatRules();
  const rules = [];
  const rng = function (c) { return sheet.getRange(firstDataRow, c, nRows, 1); };
  const addMap = function (c, map) {
    if (c <= 0) return;
    Object.keys(map).forEach(function (text) {
      const sty = map[text];
      rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(text)
        .setBackground(sty.bg).setFontColor(sty.fg).setRanges([rng(c)]).build());
    });
  };
  addMap(col.status, THEME.status);
  addMap(col.stage, THEME.stage);
  if (col.reportNote > 0) {
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenCellNotEmpty()
      .setBackground('#FCE8E6').setFontColor('#C5221F').setBold(true).setRanges([rng(col.reportNote)]).build());
  }
  Object.keys(THEME.alert).forEach(function (emoji) {
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextStartsWith(emoji)
      .setBackground(THEME.alert[emoji]).setRanges([rng(alertCol)]).build());
  });
  sheet.setConditionalFormatRules(rules);

  // ---- 通貨表示 ----
  [col.lastRevenue, col.maxRevenue].forEach(function (c) { if (c > 0) rng(c).setNumberFormat('"¥"#,##0'); });

  // ---- 列幅・折り返し ----
  const w = function (c, width) { if (c > 0) sheet.setColumnWidth(c, width); };
  w(col.name, 150); w(col.status, 100); w(col.joinDate, 72); w(col.gradDate, 72);
  w(col.workType, 78); w(col.source, 64); w(col.instructor, 64); w(col.stage, 96);
  w(col.promoteDate, 72); w(col.leaveStart, 72); w(col.leaveEnd, 72); w(col.kpiExclude, 72);
  w(col.reportNote, 150); w(col.lastRevenue, 100); w(col.maxRevenue, 100); w(col.note, 300);
  w(alertCol, 170);
  [col.reportNote, col.note].forEach(function (c) { if (c > 0) rng(c).setWrap(true); });

  // ---- 列グループの仕切り（縦の濃いブルー線）----
  // 基本情報 | 進捗・ステージ | 休会 | KPI | 収益 | メモ | アラート の境目に線を入れる
  [col.name, col.stage, col.leaveStart, col.kpiExclude, col.lastRevenue, col.note, alertCol].forEach(function (c) {
    if (c > 0) sheet.getRange(headerRow, c, nRows + 1, 1)
      .setBorder(null, true, null, null, null, null, THEME.groupBorder, SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  });

  // ---- 名前列の固定（結合セルがあると失敗するので最後に試行）----
  try { if (col.name > 0) sheet.setFrozenColumns(col.name); } catch (e) {}

  toast_('コーポレート・ブルーで再デザインしました（データは変更なし）', '🎨', 6);
}


/* ===================== ダッシュボード ===================== */
function refreshDashboard() {
  const today = stripTime_(new Date());
  const data = readStudents_();
  const students = data.students;
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  let sh = ss.getSheetByName(CONFIG.dashboardSheetName);
  if (!sh) sh = ss.insertSheet(CONFIG.dashboardSheetName, 0);
  sh.clear();

  const byStatus = {}, byStage = {}, byInstructor = {};
  let revenues = [], kpiAchieved = 0, alertCount = 0;
  students.forEach(function (s) {
    byStatus[s.status] = (byStatus[s.status] || 0) + 1;
    byStage[s.stage] = (byStage[s.stage] || 0) + 1;
    byInstructor[s.instructor] = (byInstructor[s.instructor] || 0) + 1;
    if (s.maxRevenue != null && s.maxRevenue > 0) revenues.push(s.maxRevenue);
    const k = CONFIG.kpi[s.stage];
    if (k && k.revenue > 0 && s.maxRevenue != null && s.maxRevenue >= k.revenue) kpiAchieved++;
    if (alertsForStudent_(s, today).length) alertCount++;
  });
  const maxRev = revenues.length ? Math.max.apply(null, revenues) : 0;
  const avgRev = revenues.length ? Math.round(revenues.reduce((a, b) => a + b, 0) / revenues.length) : 0;

  const rows = [];
  rows.push(['📊 生徒管理ダッシュボード', '', '最終更新', Utilities.formatDate(new Date(), CONFIG.timezone, 'yyyy/MM/dd HH:mm')]);
  rows.push(['', '', '', '']);
  rows.push(['在籍者数', students.length, '要対応', alertCount]);
  rows.push(['KPI達成者数', kpiAchieved, '音信不通', byStatus[CONFIG.outOfContactStatus] || 0]);
  rows.push(['最大収益', fmtYen_(maxRev), '平均収益', fmtYen_(avgRev)]);
  rows.push(['', '', '', '']);
  rows.push(['◆ ステータス内訳', '', '◆ ステージ内訳', '']);
  const statusKeys = KNOWN_STATUSES.filter(k => byStatus[k]);
  const stageKeys = Object.keys(byStage);
  const n = Math.max(statusKeys.length, stageKeys.length);
  for (let i = 0; i < n; i++) {
    rows.push([
      statusKeys[i] || '', statusKeys[i] ? byStatus[statusKeys[i]] : '',
      stageKeys[i] || '', stageKeys[i] ? byStage[stageKeys[i]] : '',
    ]);
  }
  rows.push(['', '', '', '']);
  rows.push(['◆ 講師別人数', '', '◆ 講師別 要対応', '']);
  const insKeys = Object.keys(byInstructor).sort();
  const loadByIns = {};
  students.forEach(s => { if (alertsForStudent_(s, today).length) loadByIns[s.instructor] = (loadByIns[s.instructor] || 0) + 1; });
  for (let i = 0; i < insKeys.length; i++) {
    rows.push([insKeys[i], byInstructor[insKeys[i]], insKeys[i], loadByIns[insKeys[i]] || 0]);
  }

  sh.getRange(1, 1, rows.length, 4).setValues(rows);
  sh.getRange(1, 1, 1, 4).setFontSize(14).setFontWeight('bold').setBackground('#4285F4').setFontColor('#FFFFFF');
  sh.getRange(7, 1, 1, 4).setFontWeight('bold');
  sh.setColumnWidths(1, 4, 160);
  sh.setFrozenRows(1);
  toast_('ダッシュボードを更新しました', '📈', 4);
}


/* ===================== ウェブアプリ（管理サイト） ===================== */
// デプロイ → ウェブアプリ で公開すると、生徒管理サイトとして開ける。
function doGet() {
  return HtmlService.createHtmlOutput(INDEX_HTML_)
    .setTitle('生徒管理ダッシュボード')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// 画面表示用のデータ（JSONで返す）。シートの値は変更しない。
function getAppData() {
  const today = stripTime_(new Date());
  const data = readStudents_();
  const students = data.students;

  const byStatus = {}, byStage = {}, byInstructor = {}, byInstructorAlerts = {};
  let revenues = [], kpiAchieved = 0, alertStudents = 0;

  const out = students.map(function (s) {
    const alerts = alertsForStudent_(s, today);
    if (alerts.length) {
      alertStudents++;
      byInstructorAlerts[s.instructor] = (byInstructorAlerts[s.instructor] || 0) + 1;
    }
    byStatus[s.status] = (byStatus[s.status] || 0) + 1;
    byStage[s.stage] = (byStage[s.stage] || 0) + 1;
    byInstructor[s.instructor] = (byInstructor[s.instructor] || 0) + 1;
    if (s.maxRevenue != null && s.maxRevenue > 0) revenues.push(s.maxRevenue);
    const k = CONFIG.kpi[s.stage];
    if (k && k.revenue > 0 && s.maxRevenue != null && s.maxRevenue >= k.revenue) kpiAchieved++;

    return {
      row: s.rowIndex,
      name: s.name, status: s.status, stage: s.stage, instructor: s.instructor,
      workType: s.workType, source: s.source,
      joinDate: fmtMD_(s.joinDate), gradDate: fmtMD_(s.gradDate),
      promoteDate: fmtMD_(s.promoteDate), leaveStart: fmtMD_(s.leaveStart), leaveEnd: fmtMD_(s.leaveEnd),
      daysToGrad: s.gradDate ? daysBetween_(today, s.gradDate) : null,
      lastRevenue: s.lastRevenue, maxRevenue: s.maxRevenue,
      reportNote: s.reportNote, note: s.note, meetingUrl: s.meetingUrl || '',
      kpiExclude: s.kpiExclude,
      topLevel: alerts.length ? maxSeverityLevel_(alerts) : '',
      alerts: alerts.map(function (a) { return { level: a.level, cat: a.cat, msg: a.msg.replace(/\*\*/g, '') }; }),
    };
  });

  const maxRev = revenues.length ? Math.max.apply(null, revenues) : 0;
  const avgRev = revenues.length ? Math.round(revenues.reduce((a, b) => a + b, 0) / revenues.length) : 0;

  return {
    generatedAt: Utilities.formatDate(new Date(), CONFIG.timezone, 'yyyy/MM/dd HH:mm'),
    totals: {
      active: students.length, alertStudents: alertStudents,
      outOfContact: byStatus[CONFIG.outOfContactStatus] || 0,
      kpiAchieved: kpiAchieved, maxRev: maxRev, avgRev: avgRev,
    },
    statusOrder: KNOWN_STATUSES,
    byStatus: byStatus, byStage: byStage, byInstructor: byInstructor, byInstructorAlerts: byInstructorAlerts,
    options: {
      status: KNOWN_STATUSES,
      stage: ['ゼロイチ', '初心者', 'アドバンス', 'マスター', '卒業'],
      instructor: Object.keys(byInstructor).sort(),
    },
    students: out,
    suggestions: generateSuggestions_(students, today).map(function (x) { return x.replace(/\*\*/g, ''); }),
  };
}

// 画面のボタンから実行するアクション（Discord送信 等）。末尾_なしで google.script.run から呼べる名前にする。
function runAction(name) {
  try {
    if (name === 'reminders') sendReminders();
    else if (name === 'summary') sendWeeklySummary();
    else if (name === 'refreshSheet') { refreshAlertColumn(); refreshDashboard(); }
    else return { ok: false, error: '不明なアクション: ' + name };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

// 指定行に、payload で渡された項目だけ書き込む（未指定の項目は触らない）
function writeFields_(sheet, col, row, f) {
  const set = function (c, val) { if (c > 0) sheet.getRange(row, c).setValue(val); };
  const has = function (k) { return Object.prototype.hasOwnProperty.call(f, k); };
  const textMap = {
    name: 'name', status: 'status', stage: 'stage', instructor: 'instructor',
    workType: 'workType', source: 'source', joinDate: 'joinDate', gradDate: 'gradDate',
    promoteDate: 'promoteDate', leaveStart: 'leaveStart', leaveEnd: 'leaveEnd',
    reportNote: 'reportNote', meetingUrl: 'meetingUrl', note: 'note',
  };
  Object.keys(textMap).forEach(function (k) {
    if (has(k)) set(col[textMap[k]], f[k] == null ? '' : f[k]);
  });
  const num = function (v) {
    if (v === '' || v == null) return '';
    const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
    return isNaN(n) ? '' : n;
  };
  if (has('lastRevenue')) set(col.lastRevenue, num(f.lastRevenue));
  if (has('maxRevenue')) set(col.maxRevenue, num(f.maxRevenue));
  if (has('kpiExclude')) set(col.kpiExclude, !!f.kpiExclude);
}

// サイトから生徒情報を更新してシートへ保存
function saveStudent(p) {
  try {
    if (!p || !p.row) return { ok: false, error: '行が指定されていません' };
    const sheet = findStudentSheet_();
    const headerRow = findHeaderRow_(sheet);
    const col = buildColumnMap_(sheet, headerRow);
    const row = Number(p.row);
    if (row <= headerRow) return { ok: false, error: '不正な行です' };
    // 行ズレ防止：現在の名前が想定と一致するか確認
    if (col.name > 0 && p.expectedName) {
      const cur = String(sheet.getRange(row, col.name).getValue() || '').trim();
      if (cur !== String(p.expectedName).trim())
        return { ok: false, error: 'データがずれています。「🔄更新」してから再度編集してください。' };
    }
    writeFields_(sheet, col, row, p.fields || {});
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

// サイトから新規生徒を追加（名前が空のテンプレ行に書き込む）
function addStudent(p) {
  try {
    const f = (p && p.fields) || {};
    if (!f.name || !String(f.name).trim()) return { ok: false, error: '名前は必須です' };
    const sheet = findStudentSheet_();
    const headerRow = findHeaderRow_(sheet);
    const col = buildColumnMap_(sheet, headerRow);
    const maxRows = sheet.getMaxRows();
    const startRow = headerRow + 1;
    if (col.name <= 0) return { ok: false, error: '名前列が見つかりません' };

    const names = sheet.getRange(startRow, col.name, maxRows - headerRow, 1).getValues();
    const kpi = col.kpiExclude > 0 ? sheet.getRange(startRow, col.kpiExclude, maxRows - headerRow, 1).getValues() : null;
    let target = 0;
    for (let i = 0; i < names.length; i++) {
      const nm = String(names[i][0] || '').trim();
      const within = kpi ? String(kpi[i][0]).trim() !== '' : true; // 表の範囲内（テンプレ行）か
      if (!nm && within) { target = startRow + i; break; }
    }
    if (!target) { sheet.appendRow([]); target = sheet.getLastRow(); } // 予備：最終行に追加

    writeFields_(sheet, col, target, f);
    return { ok: true, row: target };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}


/* ===================== Discord 送信 ===================== */
function postToDiscord_(webhookUrl, payload) {
  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = UrlFetchApp.fetch(webhookUrl, options);
    const code = res.getResponseCode();
    if (code === 204 || code === 200) return;
    if (code === 429) { // レート制限
      let wait = 1000;
      try { wait = (JSON.parse(res.getContentText()).retry_after || 1) * 1000 + 200; } catch (e) {}
      Utilities.sleep(Math.min(wait, 5000));
      continue;
    }
    throw new Error('Discord送信に失敗しました (HTTP ' + code + '): ' + res.getContentText());
  }
  throw new Error('Discord送信がレート制限で完了しませんでした。時間をおいて再実行してください。');
}


/* ===================== 画面HTML（インライン：別ファイル不要） ===================== */
var INDEX_HTML_ = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<base target="_top">
<style>
  :root{
    --bg:#eef2f7; --card:#ffffff; --ink:#1f2430; --muted:#6b7280;
    --line:#e6eaf1; --accent:#4f46e5; --accent2:#2563eb;
    --red:#ea4335; --orange:#fb8c00; --yellow:#f4b400; --green:#34a853; --blue:#1a73e8; --gray:#9aa0a6; --purple:#7e57c2;
    --shadow:0 1px 3px rgba(16,24,40,.08),0 6px 20px rgba(16,24,40,.06);
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);
    font-family:-apple-system,"Segoe UI",Roboto,"Helvetica Neue","Hiragino Kaku Gothic ProN","Noto Sans JP",Meiryo,sans-serif;}
  a{color:var(--accent2);text-decoration:none}
  /* ヘッダー */
  header{position:sticky;top:0;z-index:20;background:linear-gradient(120deg,#4f46e5,#2563eb);color:#fff;
    padding:14px 18px;box-shadow:var(--shadow)}
  .head-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap;max-width:1180px;margin:0 auto}
  .head-row h1{font-size:18px;margin:0;font-weight:700;letter-spacing:.02em}
  .head-sub{font-size:12px;opacity:.85;margin-left:2px}
  .head-actions{margin-left:auto;display:flex;gap:8px;flex-wrap:wrap}
  .btn{border:0;border-radius:10px;padding:8px 12px;font-size:13px;font-weight:600;cursor:pointer;
    background:rgba(255,255,255,.16);color:#fff;backdrop-filter:blur(4px);transition:.15s}
  .btn:hover{background:rgba(255,255,255,.28)}
  .btn.solid{background:#fff;color:var(--accent)}
  .btn.solid:hover{background:#f0f0ff}
  /* タブ */
  .tabs{max-width:1180px;margin:0 auto;display:flex;gap:4px;padding:10px 18px 0}
  .tab{padding:9px 16px;border-radius:10px 10px 0 0;cursor:pointer;font-weight:600;font-size:14px;color:var(--muted)}
  .tab.active{background:var(--card);color:var(--ink);box-shadow:0 -2px 6px rgba(0,0,0,.04)}
  /* レイアウト */
  main{max-width:1180px;margin:0 auto;padding:16px 18px 60px}
  .grid{display:grid;gap:14px}
  .stats{grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}
  .card{background:var(--card);border:1px solid var(--line);border-radius:14px;box-shadow:var(--shadow)}
  .stat{padding:16px 18px}
  .stat .k{font-size:12px;color:var(--muted);font-weight:600}
  .stat .v{font-size:26px;font-weight:800;margin-top:4px;line-height:1}
  .stat .v small{font-size:13px;font-weight:600;color:var(--muted)}
  .two{grid-template-columns:1fr 1fr}
  @media(max-width:760px){.two{grid-template-columns:1fr}}
  .sec{padding:16px 18px}
  .sec h3{margin:0 0 12px;font-size:14px}
  /* バー */
  .bar-row{display:flex;align-items:center;gap:10px;margin:7px 0;font-size:13px}
  .bar-row .lab{width:96px;flex:none;color:#374151}
  .bar-wrap{flex:1;background:#f1f3f9;border-radius:8px;height:16px;overflow:hidden}
  .bar{height:100%;border-radius:8px}
  .bar-row .num{width:54px;text-align:right;flex:none;color:var(--muted);font-variant-numeric:tabular-nums}
  /* バッジ */
  .badge{display:inline-block;padding:3px 9px;border-radius:999px;font-size:11px;font-weight:700;color:#fff;white-space:nowrap}
  .chip{display:inline-block;padding:2px 8px;border-radius:8px;font-size:11px;font-weight:600;margin:2px 4px 0 0;border:1px solid var(--line);background:#fff}
  .chip.red{border-color:#f7c5c0;background:#fdeceb;color:#b3261e}
  .chip.orange{border-color:#fcd9b6;background:#fff3e6;color:#a85800}
  .chip.yellow{border-color:#f7e3a1;background:#fff9e6;color:#7a5b00}
  .chip.blue{border-color:#bcd4f6;background:#eaf2fe;color:#10519e}
  .chip.green{border-color:#bfe3c6;background:#ecf7ee;color:#1c6b2e}
  /* ツールバー */
  .toolbar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;align-items:center}
  .toolbar input,.toolbar select{padding:9px 11px;border:1px solid var(--line);border-radius:10px;font-size:13px;background:#fff;color:var(--ink)}
  .toolbar input[type=search]{flex:1;min-width:160px}
  .toggle{display:flex;align-items:center;gap:6px;font-size:13px;color:#374151;cursor:pointer;user-select:none}
  /* 生徒カード */
  .cards{grid-template-columns:repeat(auto-fill,minmax(250px,1fr))}
  .scard{padding:14px;cursor:pointer;transition:.12s;border-left:4px solid var(--line)}
  .scard:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(16,24,40,.12)}
  .scard .nm{font-weight:800;font-size:15px}
  .scard .meta{font-size:12px;color:var(--muted);margin-top:2px}
  .scard .row{display:flex;align-items:center;gap:6px;margin-top:8px;flex-wrap:wrap}
  .scard .rev{margin-left:auto;font-weight:800;font-size:14px}
  /* 要対応 */
  .algroup{padding:14px 18px}
  .aline{display:flex;gap:8px;align-items:flex-start;padding:8px 0;border-top:1px solid var(--line);flex-wrap:wrap}
  .aline:first-of-type{border-top:0}
  .aline .nm{font-weight:700;min-width:120px}
  /* モーダル */
  .overlay{position:fixed;inset:0;background:rgba(15,23,42,.45);display:none;align-items:center;justify-content:center;z-index:50;padding:16px}
  .overlay.show{display:flex}
  .modal{background:#fff;border-radius:16px;max-width:520px;width:100%;max-height:88vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.3)}
  .modal .mh{padding:18px 20px;border-bottom:1px solid var(--line);position:sticky;top:0;background:#fff}
  .modal .mh .nm{font-size:20px;font-weight:800}
  .modal .mb{padding:16px 20px}
  .modal .x{float:right;cursor:pointer;color:var(--muted);font-size:22px;line-height:1}
  dl.kv{display:grid;grid-template-columns:96px 1fr;gap:8px 12px;margin:0;font-size:13px}
  dl.kv dt{color:var(--muted);font-weight:600}
  dl.kv dd{margin:0}
  .editbtn{float:right;margin-right:10px;border:1px solid var(--line);background:#fff;border-radius:8px;padding:5px 11px;font-size:12px;font-weight:700;cursor:pointer;color:var(--accent)}
  .form{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  @media(max-width:560px){.form{grid-template-columns:1fr}}
  .frow{display:flex;flex-direction:column;gap:4px;font-size:12px;color:#374151}
  .frow.wide{grid-column:1/-1}
  .frow span{font-weight:600}
  .frow input,.frow select,.frow textarea{padding:8px 10px;border:1px solid var(--line);border-radius:9px;font-size:13px;font-family:inherit;background:#fff;color:var(--ink)}
  .frow textarea{resize:vertical}
  .btn2{border:0;border-radius:10px;padding:9px 16px;font-size:13px;font-weight:700;cursor:pointer}
  .btn2.solid{background:var(--accent);color:#fff}
  .btn2.ghost{background:#eef0f6;color:#374151}
  /* スナックバー / ローディング */
  #snack{position:fixed;left:50%;bottom:22px;transform:translateX(-50%) translateY(80px);background:#1f2937;color:#fff;
    padding:11px 16px;border-radius:10px;font-size:13px;box-shadow:var(--shadow);transition:.25s;z-index:60;opacity:0}
  #snack.show{transform:translateX(-50%);opacity:1}
  #loading{position:fixed;inset:0;background:rgba(238,242,247,.7);display:flex;align-items:center;justify-content:center;z-index:70}
  .spin{width:36px;height:36px;border:4px solid #d7ddea;border-top-color:var(--accent);border-radius:50%;animation:sp 1s linear infinite}
  @keyframes sp{to{transform:rotate(360deg)}}
  .empty{padding:40px;text-align:center;color:var(--muted)}
  .muted{color:var(--muted)}
</style>
</head>
<body>
<header>
  <div class="head-row">
    <h1>🎓 生徒管理ダッシュボード</h1>
    <span class="head-sub" id="genat"></span>
    <div class="head-actions">
      <button class="btn" onclick="loadData()">🔄 更新</button>
      <button class="btn" onclick="doAction('reminders','リマインドをDiscordに送信しますか？')">🔔 リマインド送信</button>
      <button class="btn solid" onclick="doAction('summary','状況報告をDiscordに送信しますか？')">📊 状況報告</button>
    </div>
  </div>
  <div class="tabs">
    <div class="tab active" data-tab="dashboard" onclick="switchTab('dashboard')">ダッシュボード</div>
    <div class="tab" data-tab="students" onclick="switchTab('students')">生徒一覧</div>
    <div class="tab" data-tab="alerts" onclick="switchTab('alerts')">要対応</div>
  </div>
</header>

<main>
  <section id="view-dashboard"></section>
  <section id="view-students" style="display:none"></section>
  <section id="view-alerts" style="display:none"></section>
</main>

<div class="overlay" id="overlay" onclick="if(event.target===this)closeModal()">
  <div class="modal" id="modal"></div>
</div>
<div id="snack"></div>
<div id="loading"><div class="spin"></div></div>

<script>
  const STATUS_COLORS={'問題無':'#34a853','概ね問題無':'#7cb342','経過観察':'#f4b400','問題あり':'#fb8c00','音信不通':'#ea4335','休学中':'#9aa0a6','休会中':'#9aa0a6'};
  const STAGE_COLORS={'ゼロイチ':'#8d6e63','初心者':'#c0a000','アドバンス':'#1a73e8','マスター':'#7e57c2','卒業':'#9aa0a6'};
  const LEVEL={red:'red',orange:'orange',yellow:'yellow',blue:'blue',green:'green',gray:'gray'};
  let DATA=null, TAB='dashboard';
  const $=function(s,el){return (el||document).querySelector(s)};
  const esc=function(t){return String(t==null?'':t).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))};
  const yen=function(n){return (n==null)?'—':'¥'+Math.round(n).toLocaleString('ja-JP')};

  function api(){ return (typeof google!=='undefined' && google.script && google.script.run) ? google.script.run : null; }

  function loadData(){
    const r=api();
    show(true);
    if(!r){ show(false); snack('Webアプリとして開いてください（デプロイURLからアクセス）'); return; }
    r.withSuccessHandler(function(d){ DATA=d; renderAll(); show(false); })
     .withFailureHandler(function(e){ show(false); snack('読み込み失敗: '+(e&&e.message||e)); })
     .getAppData();
  }

  function doAction(name,confirmMsg){
    if(confirmMsg && !confirm(confirmMsg)) return;
    const r=api(); if(!r){ snack('Webアプリとして開いてください'); return; }
    show(true);
    r.withSuccessHandler(function(res){
      show(false);
      snack(res&&res.ok ? '✅ Discordに送信しました' : '⚠️ '+((res&&res.error)||'送信に失敗しました'));
    }).withFailureHandler(function(e){ show(false); snack('⚠️ '+(e&&e.message||e)); })
     .runAction(name);
  }

  function switchTab(t){
    TAB=t;
    document.querySelectorAll('.tab').forEach(el=>el.classList.toggle('active',el.dataset.tab===t));
    ['dashboard','students','alerts'].forEach(v=>$('#view-'+v).style.display = (v===t?'block':'none'));
  }

  function renderAll(){ $('#genat').textContent='更新: '+DATA.generatedAt; renderDashboard(); renderStudents(); renderAlerts(); }

  /* ---------- ダッシュボード ---------- */
  function statCard(k,v,sub){ return \`<div class="card stat"><div class="k">\${k}</div><div class="v">\${v}\${sub?\` <small>\${sub}</small>\`:''}</div></div>\`; }
  function bars(obj,order,colorFn){
    const keys=(order||Object.keys(obj)).filter(k=>obj[k]);
    const max=Math.max(1,...keys.map(k=>obj[k]));
    return keys.map(k=>\`<div class="bar-row"><div class="lab">\${esc(k)}</div>
      <div class="bar-wrap"><div class="bar" style="width:\${Math.round(obj[k]/max*100)}%;background:\${colorFn?colorFn(k):'#4f46e5'}"></div></div>
      <div class="num">\${obj[k]}名</div></div>\`).join('');
  }
  function renderDashboard(){
    const t=DATA.totals;
    const cards=statCard('在籍者数',t.active+'<small>名</small>')
      +statCard('要対応',t.alertStudents+'<small>名</small>')
      +statCard('音信不通',t.outOfContact+'<small>名</small>')
      +statCard('KPI達成',t.kpiAchieved+'<small>名</small>')
      +statCard('最大収益',yen(t.maxRev))
      +statCard('平均収益',yen(t.avgRev));
    const insBars=Object.keys(DATA.byInstructor).sort().map(function(k){
      const total=DATA.byInstructor[k], al=DATA.byInstructorAlerts[k]||0;
      const max=Math.max(1,...Object.values(DATA.byInstructor));
      return \`<div class="bar-row"><div class="lab">\${esc(k)}</div>
        <div class="bar-wrap"><div class="bar" style="width:\${Math.round(total/max*100)}%;background:#4f46e5"></div></div>
        <div class="num">\${total}名\${al?\` <span style="color:#ea4335">⚠\${al}</span>\`:''}</div></div>\`;
    }).join('');
    const sug=(DATA.suggestions||[]).map(s=>\`<div class="card sec" style="white-space:pre-wrap;font-size:13px">\${esc(s)}</div>\`).join('');
    $('#view-dashboard').innerHTML=
      \`<div class="grid stats" style="margin-bottom:14px">\${cards}</div>
       <div class="grid two" style="margin-bottom:14px">
         <div class="card sec"><h3>ステータス内訳</h3>\${bars(DATA.byStatus,DATA.statusOrder,k=>STATUS_COLORS[k]||'#4f46e5')}</div>
         <div class="card sec"><h3>ステージ内訳</h3>\${bars(DATA.byStage,['ゼロイチ','初心者','アドバンス','マスター','卒業'],k=>STAGE_COLORS[k]||'#4f46e5')}</div>
       </div>
       <div class="card sec" style="margin-bottom:14px"><h3>講師別（人数 / ⚠要対応）</h3>\${insBars}</div>
       <h3 style="margin:6px 2px 10px">💡 改善提案</h3>
       <div class="grid" style="gap:10px">\${sug||'<div class="empty">提案はありません</div>'}</div>\`;
  }

  /* ---------- 生徒一覧 ---------- */
  function uniq(arr){return arr.filter((v,i)=>v&&arr.indexOf(v)===i)}
  function renderStudents(){
    const sts=uniq(DATA.students.map(s=>s.status));
    const stg=uniq(DATA.students.map(s=>s.stage));
    const ins=uniq(DATA.students.map(s=>s.instructor)).sort();
    const opt=a=>a.map(v=>\`<option value="\${esc(v)}">\${esc(v)}</option>\`).join('');
    $('#view-students').innerHTML=
      \`<div class="toolbar">
         <input type="search" id="q" placeholder="名前で検索…" oninput="drawStudents()">
         <select id="f-status" onchange="drawStudents()"><option value="">全ステータス</option>\${opt(sts)}</select>
         <select id="f-stage" onchange="drawStudents()"><option value="">全ステージ</option>\${opt(stg)}</select>
         <select id="f-ins" onchange="drawStudents()"><option value="">全講師</option>\${opt(ins)}</select>
         <label class="toggle"><input type="checkbox" id="f-alert" onchange="drawStudents()"> 要対応のみ</label>
         <button class="btn2 solid" style="margin-left:auto" onclick="studentForm(-1)">＋ 新規追加</button>
       </div>
       <div id="student-grid" class="grid cards"></div>\`;
    drawStudents();
  }
  function drawStudents(){
    const q=($('#q').value||'').trim();
    const fs=$('#f-status').value, fg=$('#f-stage').value, fi=$('#f-ins').value, fa=$('#f-alert').checked;
    const list=DATA.students.filter(s=>
      (!q||s.name.indexOf(q)>=0)&&(!fs||s.status===fs)&&(!fg||s.stage===fg)&&(!fi||s.instructor===fi)&&(!fa||s.alerts.length));
    const grid=$('#student-grid');
    if(!list.length){ grid.innerHTML='<div class="empty">該当する生徒がいません</div>'; return; }
    grid.innerHTML=list.map(function(s,idx){
      const i=DATA.students.indexOf(s);
      const edge=s.topLevel?({red:'#ea4335',orange:'#fb8c00',yellow:'#f4b400',blue:'#1a73e8',green:'#34a853'}[s.topLevel]||'#e6eaf1'):'#e6eaf1';
      const chips=s.alerts.slice(0,3).map(a=>\`<span class="chip \${LEVEL[a.level]||''}">\${esc(a.cat)}</span>\`).join('');
      return \`<div class="card scard" style="border-left-color:\${edge}" onclick="openModal(\${i})">
        <div class="nm">\${esc(s.name)}</div>
        <div class="meta">\${esc(s.instructor)}・\${esc(s.workType||'—')}\${s.source?'・'+esc(s.source):''}</div>
        <div class="row">
          <span class="badge" style="background:\${STATUS_COLORS[s.status]||'#9aa0a6'}">\${esc(s.status)}</span>
          <span class="badge" style="background:\${STAGE_COLORS[s.stage]||'#9aa0a6'}">\${esc(s.stage||'—')}</span>
          <span class="rev">\${yen(s.maxRevenue)}</span>
        </div>
        \${chips?\`<div class="row">\${chips}</div>\`:''}
      </div>\`;
    }).join('');
  }

  /* ---------- 要対応 ---------- */
  function renderAlerts(){
    const byIns={};
    DATA.students.forEach(s=>{ if(s.alerts.length){ (byIns[s.instructor]=byIns[s.instructor]||[]).push(s); }});
    const keys=Object.keys(byIns).sort();
    if(!keys.length){ $('#view-alerts').innerHTML='<div class="card empty">✅ 要対応の生徒はいません。順調です！</div>'; return; }
    $('#view-alerts').innerHTML=keys.map(function(k){
      const rows=byIns[k].sort((a,b)=>sev(b.topLevel)-sev(a.topLevel)).map(function(s){
        const i=DATA.students.indexOf(s);
        const chips=s.alerts.map(a=>\`<span class="chip \${LEVEL[a.level]||''}">\${esc(a.msg)}</span>\`).join('');
        return \`<div class="aline"><div class="nm" style="cursor:pointer" onclick="openModal(\${i})">\${esc(s.name)}
          <span class="muted" style="font-weight:400">（\${esc(s.stage)}）</span></div><div>\${chips}</div></div>\`;
      }).join('');
      return \`<div class="card algroup" style="margin-bottom:14px"><h3 style="margin:0 0 6px">👤 \${esc(k)}（\${byIns[k].length}名）</h3>\${rows}</div>\`;
    }).join('');
  }
  function sev(l){return {red:4,orange:3,yellow:2,blue:1,green:1,gray:0}[l]||0}

  /* ---------- モーダル ---------- */
  function openModal(i){
    const s=DATA.students[i];
    const alerts=s.alerts.length?s.alerts.map(a=>\`<span class="chip \${LEVEL[a.level]||''}">\${esc(a.msg)}</span>\`).join(' '):'<span class="muted">なし</span>';
    const mtg=s.meetingUrl?\`<a href="\${esc(s.meetingUrl)}" target="_blank">面談記録を開く ↗</a>\`:'<span class="muted">—</span>';
    $('#modal').innerHTML=
      \`<div class="mh"><span class="x" onclick="closeModal()">×</span>
         <button class="editbtn" onclick="studentForm(\${i})">✏️ 編集</button>
         <div class="nm">\${esc(s.name)}</div>
         <div style="margin-top:8px">
           <span class="badge" style="background:\${STATUS_COLORS[s.status]||'#9aa0a6'}">\${esc(s.status)}</span>
           <span class="badge" style="background:\${STAGE_COLORS[s.stage]||'#9aa0a6'}">\${esc(s.stage||'—')}</span>
         </div></div>
       <div class="mb">
         <dl class="kv">
           <dt>講師</dt><dd>\${esc(s.instructor)}</dd>
           <dt>区分</dt><dd>\${esc(s.workType||'—')}\${s.source?'・'+esc(s.source):''}</dd>
           <dt>入会 / 卒業</dt><dd>\${esc(s.joinDate)} 〜 \${esc(s.gradDate)}\${s.daysToGrad!=null&&s.daysToGrad>=0?\` <span class="muted">(あと\${s.daysToGrad}日)</span>\`:''}</dd>
           <dt>休会終了</dt><dd>\${esc(s.leaveEnd||'—')}</dd>
           <dt>先月 / 最大</dt><dd>\${yen(s.lastRevenue)} / <b>\${yen(s.maxRevenue)}</b></dd>
           <dt>報告事項</dt><dd>\${s.reportNote?\`<span style="color:#c5221f;font-weight:700">\${esc(s.reportNote)}</span>\`:'<span class="muted">—</span>'}</dd>
           <dt>要対応</dt><dd>\${alerts}</dd>
           <dt>面談</dt><dd>\${mtg}</dd>
           <dt>メモ</dt><dd style="white-space:pre-wrap">\${esc(s.note)||'<span class="muted">—</span>'}</dd>
         </dl>
       </div>\`;
    $('#overlay').classList.add('show');
  }
  function closeModal(){ $('#overlay').classList.remove('show'); }
  document.addEventListener('keydown',e=>{ if(e.key==='Escape')closeModal(); });

  /* ---------- 編集／新規フォーム ---------- */
  const FIELDS=[
    {k:'name',label:'名前',type:'text'},
    {k:'status',label:'ステータス',type:'select',opt:()=>DATA.options.status},
    {k:'stage',label:'ステージ',type:'select',opt:()=>DATA.options.stage},
    {k:'instructor',label:'講師',type:'text'},
    {k:'workType',label:'区分（副業/専業）',type:'text'},
    {k:'source',label:'流入',type:'text'},
    {k:'joinDate',label:'入会日 (M/D)',type:'text'},
    {k:'gradDate',label:'卒業日 (M/D)',type:'text'},
    {k:'promoteDate',label:'最新進級日 (M/D)',type:'text'},
    {k:'leaveStart',label:'休会開始 (M/D)',type:'text'},
    {k:'leaveEnd',label:'休会終了 (M/D)',type:'text'},
    {k:'lastRevenue',label:'先月収益',type:'number'},
    {k:'maxRevenue',label:'最大収益',type:'number'},
    {k:'kpiExclude',label:'KPI対象外',type:'check'},
    {k:'reportNote',label:'KPI報告事項',type:'text'},
    {k:'meetingUrl',label:'面談URL',type:'text'},
    {k:'note',label:'メモ',type:'textarea'},
  ];
  function fval(s,k){ let v=s?s[k]:''; if(v==null)v=''; if(v==='-')v=''; return v; }
  function studentForm(i){
    const isNew=i<0, s=isNew?{}:DATA.students[i];
    const field=function(f){
      const id='fld-'+f.k, cur=fval(s,f.k);
      if(f.type==='select'){
        let opts=(f.opt?f.opt():[]).slice();
        if(cur && opts.indexOf(cur)<0) opts.unshift(cur);
        return \`<select id="\${id}"><option value=""></option>\${opts.map(o=>\`<option \${o===cur?'selected':''}>\${esc(o)}</option>\`).join('')}</select>\`;
      }
      if(f.type==='check') return \`<label class="toggle"><input type="checkbox" id="\${id}" \${cur?'checked':''}> 対象外にする</label>\`;
      if(f.type==='textarea') return \`<textarea id="\${id}" rows="3">\${esc(cur)}</textarea>\`;
      return \`<input id="\${id}" type="text" value="\${esc(cur)}" \${f.type==='number'?'inputmode="numeric"':''}>\`;
    };
    const rows=FIELDS.map(f=>\`<label class="frow\${(f.type==='textarea')?' wide':''}"><span>\${f.label}</span>\${field(f)}</label>\`).join('');
    $('#modal').innerHTML=
      \`<div class="mh"><span class="x" onclick="closeModal()">×</span>
         <div class="nm">\${isNew?'＋ 新規生徒の追加':'✏️ '+esc(s.name)+' を編集'}</div></div>
       <div class="mb"><div class="form">\${rows}</div>
         <div style="display:flex;gap:8px;margin-top:18px;justify-content:flex-end">
           <button class="btn2 ghost" onclick="\${isNew?'closeModal()':'openModal('+i+')'}">キャンセル</button>
           <button class="btn2 solid" onclick="saveForm(\${i})">保存</button>
         </div></div>\`;
    $('#overlay').classList.add('show');
  }
  function gatherForm(){
    const f={};
    FIELDS.forEach(x=>{ const el=$('#fld-'+x.k); if(!el)return; f[x.k]=(x.type==='check')?el.checked:el.value; });
    return f;
  }
  function saveForm(i){
    const isNew=i<0, f=gatherForm();
    if(!f.name||!f.name.trim()){ snack('名前を入力してください'); return; }
    const r=api(); if(!r){ snack('Webアプリとして開いてください'); return; }
    show(true);
    const done=function(res){ show(false);
      if(res&&res.ok){ snack(isNew?'✅ 追加しました':'✅ 保存しました'); closeModal(); loadData(); }
      else snack('⚠️ '+((res&&res.error)||'保存に失敗しました')); };
    const fail=function(e){ show(false); snack('⚠️ '+(e&&e.message||e)); };
    if(isNew) r.withSuccessHandler(done).withFailureHandler(fail).addStudent({fields:f});
    else r.withSuccessHandler(done).withFailureHandler(fail)
          .saveStudent({row:DATA.students[i].row, expectedName:DATA.students[i].name, fields:f});
  }

  /* ---------- 共通 ---------- */
  let snackT;
  function snack(msg){ const el=$('#snack'); el.textContent=msg; el.classList.add('show'); clearTimeout(snackT); snackT=setTimeout(()=>el.classList.remove('show'),3200); }
  function show(b){ $('#loading').style.display=b?'flex':'none'; }

  loadData();
</script>
</body>
</html>
`;
