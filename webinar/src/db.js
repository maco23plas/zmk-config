import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config, ROOT } from './config.js';

let db = null;

export function openDb(dbPath = config.dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const handle = new DatabaseSync(dbPath);
  handle.exec('PRAGMA journal_mode = WAL');
  handle.exec('PRAGMA foreign_keys = ON');
  handle.exec('PRAGMA busy_timeout = 5000');
  handle.exec('PRAGMA synchronous = NORMAL');
  handle.exec(fs.readFileSync(path.join(ROOT, 'src', 'schema.sql'), 'utf8'));
  return handle;
}

export function getDb() {
  if (!db) db = openDb();
  return db;
}

/** テスト用に別のDBハンドルへ差し替える */
export function setDb(handle) { db = handle; }

export function closeDb() {
  if (db) { db.close(); db = null; }
}

const plain = (row) => (row ? { ...row } : row);

export const all = (sql, ...params) => getDb().prepare(sql).all(...params).map(plain);
export const get = (sql, ...params) => plain(getDb().prepare(sql).get(...params)) ?? null;
export const run = (sql, ...params) => getDb().prepare(sql).run(...params);

/** 複数の書き込みをまとめてコミットする。例外時はロールバック。 */
export function tx(fn) {
  const handle = getDb();
  handle.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    handle.exec('COMMIT');
    return result;
  } catch (err) {
    try { handle.exec('ROLLBACK'); } catch { /* すでにロールバック済み */ }
    throw err;
  }
}

export function getSetting(key, dflt = null) {
  const row = get('SELECT v FROM settings WHERE k = ?', key);
  return row ? row.v : dflt;
}

export function setSetting(key, value) {
  run('INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', key, String(value));
}
