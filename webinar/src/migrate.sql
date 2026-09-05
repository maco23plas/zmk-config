-- すでに稼働中のデータベースを新しいスキーマに合わせるための追加分。
-- 新規なら schema.sql だけでよい（この内容は含まれている）。
-- 適用方法:
--   Node        : sqlite3 data/webinar.db < src/migrate.sql
--   Cloudflare  : npx wrangler d1 execute antai-webinar --remote --file=src/migrate.sql
-- すでに列がある場合は "duplicate column name" のエラーが出るが、無視して構わない。

ALTER TABLE webinars ADD COLUMN lobby_open_min    INTEGER NOT NULL DEFAULT 15;
ALTER TABLE webinars ADD COLUMN min_viewers_shown INTEGER NOT NULL DEFAULT 3;
ALTER TABLE webinars ADD COLUMN welcome_message   TEXT    NOT NULL DEFAULT '';
ALTER TABLE webinars ADD COLUMN closing_message   TEXT    NOT NULL DEFAULT '';

-- 参加者からのコメント・質問は受け付けなくなったため、対応するテーブルを削除する。
DROP TABLE IF EXISTS room_messages;
DROP TABLE IF EXISTS questions;
