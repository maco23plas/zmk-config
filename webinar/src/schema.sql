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
  show_viewer_count INTEGER NOT NULL DEFAULT 1,   -- 参加者数を出す（実測のみ）
  viewer_base       INTEGER NOT NULL DEFAULT 0,   -- 0=実測のみ。0より大きいと演出になる（非推奨）
  show_chat         INTEGER NOT NULL DEFAULT 1,   -- コメント欄を出す
  -- ▼ 会場（ロビー）の設定
  lobby_open_min    INTEGER NOT NULL DEFAULT 15,  -- 何分前に開場するか
  chat_mode         TEXT    NOT NULL DEFAULT 'on',-- on(発言可) | readonly(読むだけ) | off
  min_viewers_shown INTEGER NOT NULL DEFAULT 3,   -- 参加者数を表示し始める人数
  welcome_message   TEXT    NOT NULL DEFAULT '',  -- 入室時に本人へ出す一言
  closing_message   TEXT    NOT NULL DEFAULT '',  -- 終了時に出す一言
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

-- 司会の進行台本。at_sec が負なら開始前（ロビー）のアナウンス。
-- 主催者自身の発言なので、参加者を装うものではない。
CREATE TABLE IF NOT EXISTS chat_script (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  webinar_id  TEXT NOT NULL REFERENCES webinars(id) ON DELETE CASCADE,
  at_sec      INTEGER NOT NULL,              -- 開始時刻からの秒。負=開始前
  author      TEXT NOT NULL,
  body        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'host'   -- host(司会) | guest(非推奨: 参加者を装う演出)
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

-- ▼ ここから「会場」。すべて実際の参加者の行動を記録したもので、演出ではない。

-- 誰がいま会場にいるか（参加者数と入室通知の元データ）
CREATE TABLE IF NOT EXISTS room_presence (
  session_id     TEXT NOT NULL,
  reservation_id TEXT NOT NULL,
  display_name   TEXT NOT NULL DEFAULT '',
  joined_at      INTEGER NOT NULL,
  last_seen      INTEGER NOT NULL,
  PRIMARY KEY (session_id, reservation_id)
);
CREATE INDEX IF NOT EXISTS room_presence_seen ON room_presence(session_id, last_seen);

-- 参加者の発言。司会の台本はここには入らない（クライアント側で時刻どおりに出す）。
CREATE TABLE IF NOT EXISTS room_messages (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id     TEXT NOT NULL,
  reservation_id TEXT,
  display_name   TEXT NOT NULL,
  body           TEXT NOT NULL,
  kind           TEXT NOT NULL DEFAULT 'guest', -- guest(参加者) | host(運営の手入力) | system(入室通知)
  hidden         INTEGER NOT NULL DEFAULT 0,    -- 管理画面から非表示にできる
  created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS room_messages_session ON room_messages(session_id, id);

-- 投票（配信中に出すアンケート）
CREATE TABLE IF NOT EXISTS polls (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  webinar_id TEXT NOT NULL REFERENCES webinars(id) ON DELETE CASCADE,
  at_sec     INTEGER NOT NULL,          -- 開始からこの秒数で表示
  question   TEXT NOT NULL,
  options    TEXT NOT NULL,             -- JSON配列 ["選択肢1","選択肢2"]
  close_sec  INTEGER NOT NULL DEFAULT 0 -- 0=開いたまま。>0 でこの秒数に締め切る
);
CREATE INDEX IF NOT EXISTS polls_webinar ON polls(webinar_id, at_sec);

CREATE TABLE IF NOT EXISTS poll_votes (
  poll_id        INTEGER NOT NULL,
  session_id     TEXT NOT NULL,
  reservation_id TEXT NOT NULL,
  choice         INTEGER NOT NULL,
  created_at     INTEGER NOT NULL,
  PRIMARY KEY (poll_id, session_id, reservation_id)
);
CREATE INDEX IF NOT EXISTS poll_votes_tally ON poll_votes(poll_id, session_id, choice);

CREATE TABLE IF NOT EXISTS settings (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
