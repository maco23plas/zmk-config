// 視聴者数の表示（既定OFF）。
//
// 【重要】ここで出す人数は実在の同時視聴者数ではなく、開催枠ごとに決まる推移カーブです。
// 実態と異なる人数を「参加者数」として見せることは景品表示法上のリスクになり得ます。
// 既定は OFF。使う場合は「参加登録者数の目安」など誤認を生まない表記にしてください。
// 実際の視聴数を出したい場合は countLiveViewers() を使ってください（watch_events由来）。

import crypto from 'node:crypto';
import { get } from '../db.js';
import { MINUTE } from '../lib/time.js';

/** 開催枠IDから決まる 0..1 の擬似乱数（全視聴者に同じ数字を見せるため決定的にする） */
function seeded(sessionId, salt) {
  const hash = crypto.createHash('sha256').update(`${sessionId}:${salt}`).digest();
  return hash.readUInt32BE(0) / 0xffffffff;
}

/**
 * 経過時間に応じた表示人数。開始直後に増え、中盤で微減する自然な形にする。
 * @param {string} sessionId
 * @param {number} base        ピーク人数の目安
 * @param {number} elapsedSec  開始からの経過秒
 * @param {number} durationSec 本編の長さ
 */
export function displayedViewerCount(sessionId, base, elapsedSec, durationSec) {
  if (!base || base <= 0 || durationSec <= 0) return 0;
  const t = Math.min(1, Math.max(0, elapsedSec / durationSec));
  // 立ち上がり（最初の8%で8割まで到達）→ 緩やかな離脱
  const ramp = Math.min(1, t / 0.08);
  const retention = 1 - 0.35 * t;
  const wobble = 0.94 + 0.12 * seeded(sessionId, Math.floor(elapsedSec / 45));
  return Math.max(1, Math.round(base * ramp * retention * wobble));
}

/** 実測の同時視聴者数（直近2分以内にハートビートがあった予約の数） */
export function countLiveViewers(sessionId, now) {
  const row = get(
    `SELECT COUNT(DISTINCT reservation_id) AS c FROM watch_events
      WHERE session_id = ? AND created_at >= ? AND kind IN ('play', 'heartbeat')`,
    sessionId, now - 2 * MINUTE,
  );
  return row ? row.c : 0;
}
