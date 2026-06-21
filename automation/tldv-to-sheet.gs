/**
 * tl;dv → 提携会社リスト 自動反映 (Google Apps Script)
 *
 * 動作:
 *   1) 1時間ごとに tl;dv の新しいMTGを取得
 *   2) 企業ドメインの相手がいる商談だけAIに渡す(B2C/個人/社内はコードで足切り)
 *   3) AIが「提携候補か?」を判定し、提携候補なら各項目を抽出
 *   4) 既存シートの一覧テーブル末尾に1行追記
 *
 * セットアップ:
 *   - スプレッドシートを開く → 拡張機能 → Apps Script にこのファイルを貼る
 *   - プロジェクトの設定 → スクリプト プロパティ に以下を登録:
 *       TLDV_API_KEY      … tl;dv の APIキー
 *       ANTHROPIC_API_KEY … Anthropic の APIキー
 *       SHEET_ID          … 反映先スプレッドシートのID
 *       SHEET_NAME        … (任意) シート名。未指定なら先頭シート
 *   - 関数 setupTrigger を1回実行 → 1時間ごとの自動実行がセットされる
 *   - 初回テストは runOnce を手動実行
 */

// ===== 設定 =====
const MODEL = 'claude-opus-4-8'; // コスト優先なら 'claude-haiku-4-5' に変更(約1/5)
const TLDV_BASE = 'https://pasta.tldv.io/v1alpha1';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MEETINGS_PER_RUN = 50;     // 1回の実行で見る直近MTG件数

// HUG社内/フリーメール → 相手が企業ドメインかの足切りに使う
const INTERNAL_EMAILS = ['maco23plas@gmail.com', 'hug.llc0001@gmail.com'];
const FREE_MAIL_DOMAINS = [
  'gmail.com', 'icloud.com', 'yahoo.co.jp', 'yahoo.com', 'docomo.ne.jp',
  'ezweb.ne.jp', 'au.com', 'outlook.com', 'outlook.jp', 'hotmail.com',
  'me.com', 'softbank.ne.jp', 'i.softbank.jp'
];

// シートの列順(既存シートに合わせる)
const HEADERS = [
  'No', '会社名 / 担当者', '商材カテゴリ', '通常単価\n(万円)', '180万で\n納品交渉',
  '既存顧客数\n(社)', '接点\n有無', '実態\n確認', '優先度', 'ステータス',
  '次のアクション', '連絡先', '担当(HUG)', 'メモ'
];

// ===== トリガー設定(1回だけ実行) =====
function setupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runOnce') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('runOnce').timeBased().everyHours(1).create();
  Logger.log('1時間ごとの自動実行をセットしました。');
}

// ===== メイン =====
function runOnce() {
  const props = PropertiesService.getScriptProperties();
  const tldvKey = props.getProperty('TLDV_API_KEY');
  const anthropicKey = props.getProperty('ANTHROPIC_API_KEY');
  const sheetId = props.getProperty('SHEET_ID');
  if (!tldvKey || !anthropicKey || !sheetId) {
    throw new Error('スクリプトプロパティ TLDV_API_KEY / ANTHROPIC_API_KEY / SHEET_ID を設定してください。');
  }

  const processed = JSON.parse(props.getProperty('PROCESSED_IDS') || '[]');
  const processedSet = {};
  processed.forEach(function (id) { processedSet[id] = true; });

  const meetings = fetchMeetings(tldvKey);
  // 古い順に処理(追記順を時系列に)
  meetings.sort(function (a, b) {
    return new Date(a.happenedAt) - new Date(b.happenedAt);
  });

  let added = 0;
  meetings.forEach(function (m) {
    if (processedSet[m.id]) return;

    // 足切り1: 企業ドメインの相手がいなければスキップ(B2C/個人/社内)
    if (!hasCompanyContact(m)) { markProcessed(props, m.id); return; }

    // 録画が極端に短い(不成立)はスキップ
    if (m.duration && m.duration < 60) { markProcessed(props, m.id); return; }

    let transcript;
    try {
      transcript = fetchTranscript(tldvKey, m.id);
    } catch (e) {
      Logger.log('transcript取得失敗 ' + m.id + ': ' + e); // 次回再試行のためmarkしない
      return;
    }
    if (!transcript) { markProcessed(props, m.id); return; }

    const judged = judgeAndExtract(anthropicKey, m, transcript);
    if (judged && judged.is_partner) {
      appendRow(sheetId, m, judged);
      added++;
      Logger.log('追加: ' + judged.company);
    } else {
      Logger.log('対象外: ' + m.name + ' (' + (judged ? judged.reason : 'AI応答なし') + ')');
    }
    markProcessed(props, m.id);
  });

  Logger.log('完了。新規追加 ' + added + ' 件。');
}

// ===== tl;dv API =====
function fetchMeetings(key) {
  const url = TLDV_BASE + '/meetings?page=1&limit=' + MEETINGS_PER_RUN;
  const res = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { 'x-api-key': key },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('tl;dv meetings ' + res.getResponseCode() + ': ' + res.getContentText());
  }
  const json = JSON.parse(res.getContentText());
  return json.results || [];
}

function fetchTranscript(key, meetingId) {
  const url = TLDV_BASE + '/meetings/' + meetingId + '/transcript';
  const res = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { 'x-api-key': key },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() === 404) return null; // transcript未生成
  if (res.getResponseCode() !== 200) {
    throw new Error('tl;dv transcript ' + res.getResponseCode() + ': ' + res.getContentText());
  }
  const json = JSON.parse(res.getContentText());
  const data = json.data || [];
  return data.map(function (d) { return (d.speaker || '?') + ': ' + (d.text || ''); }).join('\n');
}

// ===== 足切り(企業ドメインの相手がいるか) =====
function hasCompanyContact(m) {
  const invitees = m.invitees || [];
  return invitees.some(function (i) {
    const email = (i.email || '').toLowerCase();
    if (!email || INTERNAL_EMAILS.indexOf(email) !== -1) return false;
    const domain = email.split('@')[1] || '';
    return FREE_MAIL_DOMAINS.indexOf(domain) === -1;
  });
}

function externalContact(m) {
  const invitees = m.invitees || [];
  for (let i = 0; i < invitees.length; i++) {
    const email = (invitees[i].email || '').toLowerCase();
    if (email && INTERNAL_EMAILS.indexOf(email) === -1) return invitees[i].email;
  }
  return '';
}

// ===== Anthropic: 判定 + 抽出 =====
function judgeAndExtract(key, meeting, transcript) {
  // 入力が巨大すぎる場合に備えて上限(おおよそ)
  const MAX_CHARS = 120000;
  const text = transcript.length > MAX_CHARS ? transcript.slice(0, MAX_CHARS) : transcript;

  const system =
    'あなたはHUG社の事業開発アシスタントです。HUGはIT/AI導入補助金スキームと退職給付金を軸に、' +
    '提携先(SNS運用・映像制作・Web制作・コンサル等の商材を持つ会社)を集めて補助金に乗せて売ります。' +
    '商談トランスクリプトを読み、「これはHUGにとっての“提携候補(相手の商材をHUGが売る、または相互送客できるB2Bパートナー)”か?」を判定してください。' +
    '次は提携候補ではありません: 個人への退職給付金B2C商談、社内ミーティング、HUGが運用などを受託する取引先、' +
    '単なる相互紹介サービス、HUGが補助金を受け取る側の供給元、ネットワークビジネス。' +
    '提携候補でない場合は is_partner を false にし他項目は空文字でよい。';

  const user =
    'MTGタイトル: ' + meeting.name + '\n' +
    '日時: ' + meeting.happenedAt + '\n' +
    '出席者: ' + (meeting.invitees || []).map(function (i) { return (i.name || '') + '<' + (i.email || '') + '>'; }).join(', ') + '\n\n' +
    '--- トランスクリプト ---\n' + text;

  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      is_partner: { type: 'boolean' },
      reason: { type: 'string' },
      company: { type: 'string', description: '会社名 / 担当者' },
      category: { type: 'string', description: '商材カテゴリ' },
      price: { type: 'string', description: '通常単価(万円)。不明なら空' },
      deal_negotiation: { type: 'string', description: '180万で納品交渉の可否や所感。該当しなければ空' },
      existing_customers: { type: 'string', description: '既存顧客数や規模。不明なら空' },
      actual_check: { type: 'string', enum: ['○', '×', ''], description: '実態確認。実態があれば○' },
      priority: { type: 'string', enum: ['最優先', '高', '中', '低', ''] },
      next_action: { type: 'string', description: '次のアクション。必ず動詞で' },
      contact_person: { type: 'string', description: 'HUG側の担当。不明なら土方' },
      memo: { type: 'string', description: '重要な数字・条件を簡潔に' }
    },
    required: ['is_partner', 'reason', 'company', 'category', 'price', 'deal_negotiation',
      'existing_customers', 'actual_check', 'priority', 'next_action', 'contact_person', 'memo']
  };

  const payload = {
    model: MODEL,
    max_tokens: 2000,
    system: system,
    output_config: { format: { type: 'json_schema', schema: schema } },
    messages: [{ role: 'user', content: user }]
  };

  const res = UrlFetchApp.fetch(ANTHROPIC_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    Logger.log('Anthropic ' + res.getResponseCode() + ': ' + res.getContentText());
    return null;
  }
  const json = JSON.parse(res.getContentText());
  const block = (json.content || []).find(function (b) { return b.type === 'text'; });
  if (!block) return null;
  try {
    return JSON.parse(block.text);
  } catch (e) {
    Logger.log('JSON parse失敗: ' + block.text);
    return null;
  }
}

// ===== シート追記 =====
function appendRow(sheetId, meeting, j) {
  const ss = SpreadsheetApp.openById(sheetId);
  const name = PropertiesService.getScriptProperties().getProperty('SHEET_NAME');
  const sheet = name ? ss.getSheetByName(name) : ss.getSheets()[0];

  const lastDataRow = findLastDataRow(sheet); // 一覧テーブルの最終データ行
  const nextNo = getNextNo(sheet, lastDataRow);

  const row = [
    nextNo,
    j.company || '',
    j.category || '',
    j.price || '',
    j.deal_negotiation || '',
    j.existing_customers || '',
    '有',                       // 接点有無(商談があった=有)
    j.actual_check || '',
    j.priority || '',
    '商談済',                   // ステータス
    j.next_action || '',
    externalContact(meeting),   // 連絡先(相手のメール)
    j.contact_person || '土方',
    j.memo || ''
  ];

  sheet.insertRowAfter(lastDataRow);
  sheet.getRange(lastDataRow + 1, 1, 1, row.length).setValues([row]);
}

// 一覧テーブルの最終データ行を返す(No列が連番で埋まっている最後の行)
function findLastDataRow(sheet) {
  const maxRow = sheet.getLastRow();
  const colA = sheet.getRange(1, 1, maxRow, 1).getValues();
  let last = 1; // ヘッダ行=1想定
  for (let r = 2; r <= maxRow; r++) {
    const v = colA[r - 1][0];
    if (v === '' || v === null) break;           // 空欄でテーブル終端
    if (typeof v === 'number' || /^\d+$/.test(String(v).trim())) {
      last = r;
    } else {
      break;                                     // 「■ 使い方」等でテーブル終端
    }
  }
  return last;
}

function getNextNo(sheet, lastDataRow) {
  if (lastDataRow < 2) return 1;
  const v = sheet.getRange(lastDataRow, 1).getValue();
  const n = parseInt(v, 10);
  return isNaN(n) ? 1 : n + 1;
}

// ===== 処理済み管理 =====
function markProcessed(props, id) {
  const arr = JSON.parse(props.getProperty('PROCESSED_IDS') || '[]');
  arr.push(id);
  // 直近300件だけ保持(プロパティ容量対策)
  const trimmed = arr.slice(-300);
  props.setProperty('PROCESSED_IDS', JSON.stringify(trimmed));
}
