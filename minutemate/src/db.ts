import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { cfg } from './config.js';

fs.mkdirSync(cfg.dataDir, { recursive: true });
export const db = new Database(path.join(cfg.dataDir, 'minutemate.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS meetings (
  id TEXT PRIMARY KEY,
  event_id TEXT UNIQUE,
  ical_uid TEXT,
  title TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT,
  url TEXT,
  provider TEXT,
  business TEXT,
  attendees TEXT DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'scheduled',
  join_error TEXT,
  dir TEXT,
  share_url TEXT,
  brief_sent INTEGER DEFAULT 0,
  bot_invited INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  business TEXT,
  meeting_id TEXT,
  title TEXT NOT NULL,
  assignee TEXT,
  due TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  carried INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  business TEXT,
  period_start TEXT,
  period_end TEXT,
  path TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_meetings_start ON meetings(start_at);
CREATE INDEX IF NOT EXISTS idx_tasks_business ON tasks(business, status);
`);

export interface Attendee {
  email?: string;
  name?: string;
}

export interface MeetingRow {
  id: string;
  event_id: string | null;
  ical_uid: string | null;
  title: string;
  start_at: string;
  end_at: string | null;
  url: string | null;
  provider: string | null;
  business: string | null;
  attendees: string;
  status: string;
  join_error: string | null;
  dir: string | null;
  share_url: string | null;
  brief_sent: number;
  bot_invited: number;
}

export interface TaskRow {
  id: string;
  business: string | null;
  meeting_id: string | null;
  title: string;
  assignee: string | null;
  due: string | null;
  note: string | null;
  status: string;
  carried: number;
  created_at: string;
  updated_at: string;
}

export function getMeeting(id: string): MeetingRow | undefined {
  return db.prepare('SELECT * FROM meetings WHERE id = ?').get(id) as MeetingRow | undefined;
}

export function setMeetingStatus(id: string, status: string, error?: string) {
  db.prepare(
    "UPDATE meetings SET status = ?, join_error = COALESCE(?, join_error), updated_at = datetime('now') WHERE id = ?"
  ).run(status, error ?? null, id);
}

export function updateMeeting(id: string, fields: Partial<MeetingRow>) {
  const keys = Object.keys(fields) as (keyof MeetingRow)[];
  if (keys.length === 0) return;
  const set = keys.map((k) => `${k} = ?`).join(', ');
  db.prepare(`UPDATE meetings SET ${set}, updated_at = datetime('now') WHERE id = ?`).run(
    ...keys.map((k) => fields[k] as unknown),
    id
  );
}

export function attendeesOf(m: MeetingRow): Attendee[] {
  try {
    return JSON.parse(m.attendees || '[]');
  } catch {
    return [];
  }
}

export function openTasks(business: string): TaskRow[] {
  return db
    .prepare("SELECT * FROM tasks WHERE business = ? AND status = 'open' ORDER BY created_at")
    .all(business) as TaskRow[];
}
