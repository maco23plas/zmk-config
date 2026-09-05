// LINE Webhook の受信処理。
// 署名検証 → 即200を返す → 実処理は非同期。LINEは応答が遅いと再送してくるため、
// 受信の記録（webhook_events）で二重処理を防ぐ。

import { get, run } from '../db.js';
import { log } from '../lib/log.js';
import { codeCandidates } from '../lib/ids.js';
import { getByLinkCode, linkLineUser, listUpcomingByLineUser } from '../domain/reservations.js';
import { listOpenSessions } from '../domain/sessions.js';
import { syncJobs } from '../domain/notifications.js';
import { replyMessage, getProfile } from './client.js';
import * as msg from './messages.js';

const KEYWORDS = [
  { re: /^(予約|よやく|日程|申込|申し込み|参加)/, handler: handleSessionList },
  { re: /^(確認|予約確認|マイページ)/, handler: handleMyReservations },
  { re: /^(キャンセル|取消|取り消し)/, handler: handleCancelGuide },
  { re: /^(ヘルプ|help|使い方|つかいかた)$/i, handler: handleHelp },
];

/** すでに処理済みのイベントなら true（LINEの再送対策） */
function seenBefore(eventId, now) {
  if (!eventId) return false;
  const result = run(
    'INSERT INTO webhook_events (event_id, created_at) VALUES (?, ?) ON CONFLICT(event_id) DO NOTHING',
    eventId, now,
  );
  return result.changes === 0;
}

export function upsertLineUser(userId, displayName, now, followed = 1) {
  run(
    `INSERT INTO line_users (user_id, display_name, followed, created_at, updated_at)
     VALUES (?,?,?,?,?)
     ON CONFLICT(user_id) DO UPDATE SET
       display_name = CASE WHEN excluded.display_name != '' THEN excluded.display_name ELSE line_users.display_name END,
       followed = excluded.followed,
       updated_at = excluded.updated_at`,
    userId, String(displayName || ''), followed, now, now,
  );
}

/** イベント配列をまとめて処理する */
export async function handleEvents(events, now = Date.now()) {
  for (const event of events || []) {
    try {
      if (seenBefore(event.webhookEventId, now)) {
        log.info('重複イベントを無視:', event.webhookEventId);
        continue;
      }
      await handleEvent(event, now);
    } catch (err) {
      log.error('Webhookイベントの処理に失敗:', err?.stack || err);
    }
  }
}

async function handleEvent(event, now) {
  const userId = event.source?.userId;

  if (event.type === 'follow' && userId) {
    const profile = await getProfile(userId);
    upsertLineUser(userId, profile.displayName, now, 1);
    await replyMessage(event.replyToken, msg.welcomeMessage(), { kind: 'follow' });
    return;
  }

  if (event.type === 'unfollow' && userId) {
    // ブロックされた相手にプッシュしても失敗するだけなので、送信対象から外す
    upsertLineUser(userId, '', now, 0);
    log.info('ブロックまたは友だち解除:', userId);
    return;
  }

  if (event.type === 'message' && event.message?.type === 'text' && userId) {
    await handleTextMessage(event, userId, String(event.message.text || ''), now);
    return;
  }
}

async function handleTextMessage(event, userId, body, now) {
  const trimmed = body.trim();

  // 1) 予約コードとして解釈できるか（最優先）
  const candidates = codeCandidates(trimmed);
  for (const code of candidates) {
    if (!getByLinkCode(code)) continue;
    await linkByCode(event, userId, code, now);
    return;
  }

  // 2) キーワード
  for (const { re, handler } of KEYWORDS) {
    if (re.test(trimmed)) {
      await handler(event, userId, now);
      return;
    }
  }

  // 3) コードのつもりで送られた短文だけ、見つからなかった旨を返す。
  //    それ以外は無言にして、担当者が手動で返信できる状態を保つ。
  if (candidates.length > 0 && trimmed.length <= 30) {
    await replyMessage(event.replyToken, msg.codeNotFoundMessage(), { kind: 'code_not_found' });
  }
}

async function linkByCode(event, userId, code, now) {
  const profile = await getProfile(userId);
  upsertLineUser(userId, profile.displayName, now, 1);

  const result = linkLineUser(code, userId, profile.displayName, now);

  if (!result.ok) {
    const reply = result.reason === 'already_linked_other' ? msg.alreadyLinkedOtherMessage()
      : result.reason === 'duplicate' ? msg.duplicateMessage()
      : msg.codeNotFoundMessage();
    await replyMessage(event.replyToken, reply, { kind: `link_${result.reason}` });
    return;
  }

  const reservation = result.reservation;
  syncJobs(reservation.id, now);

  // いま返信で「予約完了」を伝えたので、同じ内容のconfirm通知は送らない
  const confirmJob = get(
    `SELECT id FROM notification_jobs WHERE reservation_id = ? AND kind = 'confirm' AND status = 'pending'`,
    reservation.id,
  );
  if (confirmJob) {
    run(`UPDATE notification_jobs SET status='sent', sent_at=?, updated_at=?, last_error='返信で通知済み' WHERE id=?`,
      now, now, confirmJob.id);
  }

  const ctx = msg.buildContext({
    watch_token: reservation.watch_token, name: reservation.name, title: reservation.title,
    start_at: reservation.start_at, duration_sec: reservation.duration_sec,
  });
  const reply = result.already ? msg.duplicateMessage() : msg.linkedMessage(ctx, now);
  await replyMessage(event.replyToken, reply, { kind: 'linked' });
  log.info(`予約とLINEを連携: ${reservation.id} ← ${userId}`);
}

async function handleSessionList(event, userId, now) {
  await replyMessage(event.replyToken, msg.sessionListMessage(listOpenSessions(now, 5)), { kind: 'session_list' });
}

async function handleMyReservations(event, userId, now) {
  await replyMessage(event.replyToken, msg.myReservationsMessage(listUpcomingByLineUser(userId, now)), { kind: 'my_reservations' });
}

async function handleCancelGuide(event, userId, now) {
  await replyMessage(event.replyToken, msg.cancelGuideMessage(listUpcomingByLineUser(userId, now)), { kind: 'cancel_guide' });
}

async function handleHelp(event) {
  await replyMessage(event.replyToken, msg.helpMessage(), { kind: 'help' });
}

/** プッシュしてよい相手か（ブロック済みを除外） */
export function canPushTo(userId) {
  const row = get('SELECT followed FROM line_users WHERE user_id = ?', userId);
  // 記録が無い場合は「サイト予約→未フォロー」ではなく取りこぼしの可能性があるので送信を試みる
  return !row || row.followed === 1;
}
