// 視聴者数の表示（既定OFF）。
//
// 【重要】ここで出す人数は実在の同時視聴者数ではなく、開催枠ごとに決まる推移カーブです。
// 実態と異なる人数を「参加者数」として見せることは景品表示法上のリスクになり得ます。
// 既定は OFF。使う場合は「参加登録者数の目安」など誤認を生まない表記にしてください。
// 実際の視聴数だけを出したい場合は、目安人数を 0 にすると countLiveViewers() の実測値になります。

import { get } from '../db.js';
import { seededUnit } from '../lib/crypto.js';
import { MINUTE } from '../lib/time.js';

/**
 * 経過時間に応じた表示人数。開始直後に増え、中盤で微減する自然な形にする。
 * 全視聴者に同じ数字を見せるため、開催枠IDから決まる決定的な値にしている。
 */
export async function displayedViewerCount(sessionId, base, elapsedSec, durationSec) {
  if (!base || base <= 0 || durationSec <= 0) return 0;
  const t = Math.min(1, Math.max(0, elapsedSec / durationSec));
  const ramp = Math.min(1, t / 0.08);          // 最初の8%で8割まで到達
  const retention = 1 - 0.35 * t;              // 緩やかな離脱
  const wobble = 0.94 + 0.12 * await seededUnit(`${sessionId}:${Math.floor(elapsedSec / 45)}`);
  return Math.max(1, Math.round(base * ramp * retention * wobble));
}

/** 実測の同時視聴者数（直近2分以内にハートビートがあった予約の数） */
export async function countLiveViewers(sessionId, now) {
  const row = await get(
    `SELECT COUNT(DISTINCT reservation_id) AS c FROM watch_events
      WHERE session_id = ? AND created_at >= ? AND kind IN ('play', 'heartbeat')`,
    sessionId, now - 2 * MINUTE,
  );
  return row ? row.c : 0;
}
