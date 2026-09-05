// データベースへの唯一の入口。
// 実体は差し替え可能なドライバ（Nodeの node:sqlite / Cloudflareの D1）。
// どちらも非同期のインターフェースに揃えてあるので、上位のコードは環境を意識しない。
//
// ※ このファイルは Cloudflare Workers にもバンドルされるため、node: 系を import しないこと。

let driver = null;

export function setDriver(d) { driver = d; }
export function getDriver() {
  if (!driver) throw new Error('データベースドライバが未設定です（initRuntime を呼んでください）');
  return driver;
}

export const all = (sql, ...params) => getDriver().all(sql, params);
export const get = (sql, ...params) => getDriver().get(sql, params);
export const run = (sql, ...params) => getDriver().run(sql, params);

/**
 * 複数の書き込みをまとめて実行する（途中で失敗したら全部取り消す）。
 * @param {Array<{sql:string, params:any[]}>} statements
 */
export const batch = (statements) => getDriver().batch(statements);

export async function getSetting(key, dflt = null) {
  const row = await get('SELECT v FROM settings WHERE k = ?', key);
  return row ? row.v : dflt;
}

export async function setSetting(key, value) {
  await run('INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', key, String(value));
}
