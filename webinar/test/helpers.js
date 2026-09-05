// テスト用の共通セットアップ。
// config.js は import 時に環境変数を読むので、必ずこのモジュールを最初に読み込むこと。

process.env.BASE_URL ??= 'https://webinar.test';
process.env.PORT ??= '0';
process.env.LINE_CHANNEL_SECRET ??= 'test-channel-secret';
process.env.LINE_BASIC_ID ??= '@testoa';
process.env.LINE_CHANNEL_ACCESS_TOKEN ??= '';   // 空 = ドライラン（実送信しない）
process.env.ADMIN_USER ??= 'admin';
process.env.ADMIN_PASS ??= 'test-password';
process.env.SESSION_SECRET ??= 'test-session-secret-value';
process.env.DB_PATH ??= ':memory:';

const { openDb, setDb } = await import('../src/db.js');
const { clock } = await import('../src/clock.js');

/** まっさらなインメモリDBに差し替える */
export function freshDb() {
  setDb(openDb(':memory:'));
}

export { clock };

/** テスト用の説明会・開催枠・予約を用意する */
export async function seedScenario({ startAt, durationSec = 3600, now, webinar = {}, capacity = 0 }) {
  const { createWebinar } = await import('../src/domain/webinars.js');
  const { createSession } = await import('../src/domain/sessions.js');
  const w = createWebinar({
    title: 'テスト説明会', video_url: 'file:test.mp4', duration_sec: durationSec, ...webinar,
  }, now);
  const s = createSession({ webinarId: w.id, startAt, capacity }, now);
  return { webinar: w, session: s };
}

/** サーバーを立てて、baseUrl と後始末関数を返す */
export async function startTestServer() {
  const { createServer } = await import('../src/server.js');
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  return {
    base,
    /** 同一オリジンのPOST（CSRFチェックを通す） */
    post: (path, body, headers = {}) => fetch(base + path, {
      method: 'POST', redirect: 'manual',
      headers: { Origin: base, ...headers },
      body,
    }),
    get: (path, headers = {}) => fetch(base + path, { redirect: 'manual', headers }),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

export const form = (obj) => new URLSearchParams(obj).toString();
export const formHeaders = { 'Content-Type': 'application/x-www-form-urlencoded' };
