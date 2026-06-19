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
  SpreadsheetApp.getActiveSpreadsheet().toast('Discordにテストメッセージを送信しました', '✅', 5);
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
    SpreadsheetApp.getActiveSpreadsheet().toast('要対応なし。Discordに通知しました', '🔔', 5);
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

  SpreadsheetApp.getActiveSpreadsheet().toast(totalAlerts + '件の要対応を講師メンション付きで送信しました', '🔔', 5);
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
  SpreadsheetApp.getActiveSpreadsheet().toast('週次サマリー＋提案をDiscordに送信しました', '📊', 5);
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
  SpreadsheetApp.getActiveSpreadsheet().toast('アラート列を更新しました', '🚨', 4);
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
  SpreadsheetApp.getActiveSpreadsheet().toast('ダッシュボードを更新しました', '📈', 4);
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
