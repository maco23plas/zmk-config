// テスト用の共通セットアップ。
// config は import 時ではなく configure() で読み込むが、環境変数は先に決めておく。

import fs from 'node:fs';
import path from 'node:path';

process.env.BASE_URL ??= 'https://webinar.test';
process.env.LINE_CHANNEL_SECRET ??= 'test-channel-secret';
process.env.LINE_BASIC_ID ??= '@testoa';
process.env.LINE_CHANNEL_ACCESS_TOKEN ??= '';   // 空 = ドライラン（実送信しない）
process.env.ADMIN_USER ??= 'admin';
process.env.ADMIN_PASS ??= 'test-password';
process.env.SESSION_SECRET ??= 'test-session-secret-value';

const { configure } = await import('../src/config.js');
const { setDriver } = await import('../src/db.js');
const { openSqlite, nodeDriver } = await import('../src/db-node.js');
const { setFileServer } = await import('../src/lib/http.js');
const { nodeFileServer, createServer, ROOT } = await import('../src/server.js');
const { clock } = await import('../src/clock.js');

const SCHEMA = fs.readFileSync(path.join(ROOT, 'src', 'schema.sql'), 'utf8');

configure(process.env, {
  mediaDir: process.env.MEDIA_DIR || path.join(ROOT, 'media'),
  publicDir: path.join(ROOT, 'public'),
  canServeFiles: true,
});
setFileServer(nodeFileServer);

/** まっさらなインメモリDBに差し替える */
export function freshDb() {
  setDriver(nodeDriver(openSqlite(':memory:', SCHEMA)));
}

export { clock };

/** サーバーを立てて、baseUrl と後始末関数を返す */
export async function startTestServer() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    /** 同一オリジンのPOST（CSRFチェックを通す） */
    post: (p, body, headers = {}) => fetch(base + p, {
      method: 'POST', redirect: 'manual', headers: { Origin: base, ...headers }, body,
    }),
    get: (p, headers = {}) => fetch(base + p, { redirect: 'manual', headers }),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

export const form = (obj) => new URLSearchParams(obj).toString();
export const formHeaders = { 'Content-Type': 'application/x-www-form-urlencoded' };
