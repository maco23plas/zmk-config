// Node.js 用のドライバ（node:sqlite）。同期APIを非同期の形に合わせて包む。
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const plain = (row) => (row ? { ...row } : null);

export function openSqlite(dbPath, schemaSql) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const handle = new DatabaseSync(dbPath);
  handle.exec('PRAGMA journal_mode = WAL');
  handle.exec('PRAGMA foreign_keys = ON');
  handle.exec('PRAGMA busy_timeout = 5000');
  handle.exec('PRAGMA synchronous = NORMAL');
  if (schemaSql) handle.exec(schemaSql);
  return handle;
}

export function nodeDriver(handle) {
  return {
    handle,
    async all(sql, params = []) {
      return handle.prepare(sql).all(...params).map((r) => ({ ...r }));
    },
    async get(sql, params = []) {
      return plain(handle.prepare(sql).get(...params));
    },
    async run(sql, params = []) {
      const r = handle.prepare(sql).run(...params);
      return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
    },
    async batch(statements) {
      handle.exec('BEGIN IMMEDIATE');
      try {
        for (const s of statements) handle.prepare(s.sql).run(...(s.params || []));
        handle.exec('COMMIT');
      } catch (err) {
        try { handle.exec('ROLLBACK'); } catch { /* すでにロールバック済み */ }
        throw err;
      }
    },
    close() { handle.close(); },
  };
}
