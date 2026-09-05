import crypto from 'node:crypto';
import { config } from '../config.js';
import { run } from '../db.js';
import { log } from '../lib/log.js';

const API = 'https://api.line.me/v2/bot';
const TIMEOUT_MS = 10000;

export class LineApiError extends Error {
  constructor(message, { status = 0, permanent = false, body = '' } = {}) {
    super(message);
    this.status = status;
    this.permanent = permanent;
    this.body = body;
  }
}

/**
 * HTTPステータスから「再試行しても無駄か」を判定する。
 * 400（宛先不正・本文不正）や 403（権限不足）を延々と再試行しても意味がない。
 */
function isPermanent(status) {
  return status === 400 || status === 401 || status === 403 || status === 404 || status === 410;
}

async function callApi(path, { method = 'POST', body, headers = {} } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.line.accessToken}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (res.ok) {
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  }
  // 同じ X-Line-Retry-Key での再送は 409。すでに受理済みなので成功扱いにする。
  if (res.status === 409) return { deduplicated: true };

  const detail = (await res.text().catch(() => '')).slice(0, 500);
  throw new LineApiError(`LINE API ${res.status}: ${detail}`, {
    status: res.status,
    permanent: isPermanent(res.status),
    body: detail,
  });
}

function logOutbound(to, kind, messages, ok, detail, now = Date.now()) {
  try {
    run('INSERT INTO outbound_log (to_user, kind, payload, ok, detail, created_at) VALUES (?,?,?,?,?,?)',
      to, kind, JSON.stringify(messages).slice(0, 4000), ok ? 1 : 0, String(detail || '').slice(0, 500), now);
  } catch (err) {
    log.error('送信ログの記録に失敗', err.message);
  }
}

/**
 * プッシュ送信。retryKey を渡すと LINE 側で重複が排除されるので、
 * 「送ったがレスポンスを取りこぼした」場合の二重送信を防げる。
 */
export async function pushMessage(userId, messages, { kind = 'push', retryKey } = {}) {
  const list = Array.isArray(messages) ? messages : [messages];

  if (config.dryRun) {
    log.info(`[ドライラン] push → ${userId} (${kind})`);
    logOutbound(userId, `${kind}:dry-run`, list, true, 'LINE_CHANNEL_ACCESS_TOKEN 未設定のため未送信');
    return { dryRun: true };
  }

  try {
    const result = await callApi('/message/push', {
      body: { to: userId, messages: list },
      headers: { 'X-Line-Retry-Key': retryKey || crypto.randomUUID() },
    });
    logOutbound(userId, kind, list, true, result.deduplicated ? '重複排除(409)' : '');
    return result;
  } catch (err) {
    logOutbound(userId, kind, list, false, err.message);
    throw err;
  }
}

/** 応答トークンを使った返信（Webhookへの応答。無料枠を消費しない） */
export async function replyMessage(replyToken, messages, { kind = 'reply' } = {}) {
  const list = Array.isArray(messages) ? messages : [messages];

  if (config.dryRun) {
    log.info(`[ドライラン] reply (${kind}):`, JSON.stringify(list).slice(0, 200));
    logOutbound('(reply)', `${kind}:dry-run`, list, true, '');
    return { dryRun: true };
  }

  try {
    const result = await callApi('/message/reply', { body: { replyToken, messages: list } });
    logOutbound('(reply)', kind, list, true, '');
    return result;
  } catch (err) {
    // 応答トークンは1分で失効する。失効は運用上の異常ではないので警告に留める。
    logOutbound('(reply)', kind, list, false, err.message);
    log.warn('LINE返信に失敗:', err.message);
    return { error: err.message };
  }
}

/** 友だちのプロフィール取得（表示名を予約に残すため） */
export async function getProfile(userId) {
  if (config.dryRun) return { userId, displayName: '' };
  try {
    return await callApi(`/profile/${encodeURIComponent(userId)}`, { method: 'GET' });
  } catch (err) {
    log.warn('プロフィール取得に失敗:', err.message);
    return { userId, displayName: '' };
  }
}
