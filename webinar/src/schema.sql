-- 説明会ウェビナーシステム スキーマ
-- 時刻はすべて UTC の epoch ミリ秒（INTEGER）で保存する。
-- SQLite / Cloudflare D1 の両方でそのまま使える DDL のみで構成している。

-- 配信コンテンツ（何を流すか）
CREATE TABLE IF NOT EXISTS webinars (
  id                TEXT PRIMARY KEY,
  title             TEXT NOT NULL,
  description       TEXT NOT NULL DEFAULT '',
  -- 'https://.../a.mp4' | 'file:sample.mp4'(MEDIA_DIR配下) | 'youtube:VIDEO_ID'
  video_url         TEXT NOT NULL,
  duration_sec      INTEGER NOT NULL,
  poster_url        TEXT NOT NULL DEFAULT '',
  presenter         TEXT NOT NULL DEFAULT '',
  cta_label         TEXT NOT NULL DEFAULT '',
  cta_url           TEXT NOT NULL DEFAULT '',
  cta_at_sec        INTEGER NOT NULL DEFAULT 0,   -- CTAボタンを出す再生位置(秒)
  late_join_sec     INTEGER NOT NULL DEFAULT 0,   -- 開始後この秒数までは途中入場可(0=配信中いつでも可)
  archive_hours     INTEGER NOT NULL DEFAULT 0,   -- 終了後の見逃し配信時間(0=なし)
  show_viewer_count INTEGER NOT NULL DEFAULT 0,   -- 視聴者数の演出(既定OFF)
  viewer_base       INTEGER NOT NULL DEFAULT 0,
  show_chat         INTEGER NOT NULL DEFAULT 0,   -- 台本チャットの演出(既定OFF)
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

-- 台本チャット（show_chat=1 のときだけ使う演出用データ）
CREATE TABLE IF NOT EXISTS chat_script (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  webinar_id  TEXT NOT NULL REFERENCES webinars(id) ON DELETE CASCADE,
  at_sec      INTEGER NOT NULL,
  author      TEXT NOT NULL,
  body        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'guest'  -- guest | host
);
CREATE INDEX IF NOT EXISTS chat_script_webinar ON chat_script(webinar_id, at_sec);

-- 開催枠（いつ流すか）
CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  webinar_id TEXT NOT NULL REFERENCES webinars(id) ON DELETE CASCADE,
  start_at   INTEGER NOT NULL,
  capacity   INTEGER NOT NULL DEFAULT 0,     -- 0 = 無制限
  status     TEXT NOT NULL DEFAULT 'open',   -- open | closed | canceled
  rule_id    INTEGER REFERENCES schedule_rules(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_start ON sessions(start_at);
CREATE UNIQUE INDEX IF NOT EXISTS sessions_rule_slot ON sessions(rule_id, start_at) WHERE rule_id IS NOT NULL;

-- 定期開催ルール（毎日20:00など、開催枠を自動生成する）
CREATE TABLE IF NOT EXISTS schedule_rules (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  webinar_id   TEXT NOT NULL REFERENCES webinars(id) ON DELETE CASCADE,
  weekdays     TEXT NOT NULL,                -- '0,1,2,3,4,5,6' (0=日)
  time_jst     TEXT NOT NULL,                -- 'HH:MM'
  capacity     INTEGER NOT NULL DEFAULT 0,
  horizon_days INTEGER NOT NULL DEFAULT 14,  -- 何日先まで枠を作るか
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL
);

-- 予約
CREATE TABLE IF NOT EXISTS reservations (
  id                TEXT PRIMARY KEY,
  session_id        TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  email             TEXT NOT NULL DEFAULT '',
  phone             TEXT NOT NULL DEFAULT '',
  note              TEXT NOT NULL DEFAULT '',
  watch_token       TEXT NOT NULL UNIQUE,    -- 視聴URLの鍵
  link_code         TEXT NOT NULL UNIQUE,    -- LINE連携コード
  line_user_id      TEXT,
  line_display_name TEXT NOT NULL DEFAULT '',
  linked_at         INTEGER,
  status            TEXT NOT NULL DEFAULT 'active',  -- active | canceled
  source            TEXT NOT NULL DEFAULT 'web',     -- web | line
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS reservations_session ON reservations(session_id);
CREATE INDEX IF NOT EXISTS reservations_line_user ON reservations(line_user_id);
-- 同一LINEユーザーが同じ枠を二重予約しないようにする
CREATE UNIQUE INDEX IF NOT EXISTS reservations_line_session
  ON reservations(session_id, line_user_id) WHERE line_user_id IS NOT NULL AND status = 'active';

-- 通知ジョブ（アウトボックス方式：予定を先に積み、ワーカーが送る）
CREATE TABLE IF NOT EXISTS notification_jobs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  reservation_id TEXT NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL,   -- confirm | remind_1d | watch_link_3h | remind_10m | start | followup
  scheduled_at   INTEGER NOT NULL,
  deadline_at    INTEGER NOT NULL, -- これを過ぎたら送らずに skipped
  status         TEXT NOT NULL DEFAULT 'pending', -- pending | sent | failed | skipped | canceled
  attempts       INTEGER NOT NULL DEFAULT 0,
  last_error     TEXT NOT NULL DEFAULT '',
  sent_at        INTEGER,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
-- 同じ予約・同じ種類の通知は1件だけ（二重送信の防止）
CREATE UNIQUE INDEX IF NOT EXISTS notification_jobs_uniq ON notification_jobs(reservation_id, kind);
CREATE INDEX IF NOT EXISTS notification_jobs_due ON notification_jobs(status, scheduled_at);

-- 友だち登録しているLINEユーザー
CREATE TABLE IF NOT EXISTS line_users (
  user_id      TEXT PRIMARY KEY,
  display_name TEXT NOT NULL DEFAULT '',
  followed     INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

-- 視聴ログ（分析用）
CREATE TABLE IF NOT EXISTS watch_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  reservation_id TEXT NOT NULL,
  session_id     TEXT NOT NULL,
  kind           TEXT NOT NULL,   -- open | play | heartbeat | cta_click | leave
  at_sec         INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS watch_events_res ON watch_events(reservation_id, created_at);
CREATE INDEX IF NOT EXISTS watch_events_session ON watch_events(session_id);

-- 視聴中に届いた質問
CREATE TABLE IF NOT EXISTS questions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  reservation_id TEXT NOT NULL,
  session_id     TEXT NOT NULL,
  body           TEXT NOT NULL,
  at_sec         INTEGER NOT NULL DEFAULT 0,
  answered       INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL
);

-- LINE送信ログ（ドライラン時の確認にも使う）
CREATE TABLE IF NOT EXISTS outbound_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  to_user    TEXT NOT NULL,
  kind       TEXT NOT NULL,
  payload    TEXT NOT NULL,
  ok         INTEGER NOT NULL,
  detail     TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS outbound_log_created ON outbound_log(created_at);

-- Webhookの重複配信対策（LINEは同じイベントを再送することがある）
CREATE TABLE IF NOT EXISTS webhook_events (
  event_id   TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
