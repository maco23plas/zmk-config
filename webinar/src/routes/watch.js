// 視聴ページと、その裏で動くAPI（状態取得・動画配信・視聴ログ・質問）

import path from 'node:path';
import { clock } from '../clock.js';
import { config, ROOT } from '../config.js';
import { html, json, send, sendFile, redirect, parseBody, resolveWithin } from '../lib/http.js';
import { playbackState, mediaAllowed, parseVideoSource, PlaybackState } from '../domain/playback.js';
import { getByWatchToken, recordWatchEvent, addQuestion } from '../domain/reservations.js';
import { listChatScript } from '../domain/webinars.js';
import { displayedViewerCount, countLiveViewers } from '../domain/presence.js';

const toPlan = (r) => ({
  startAt: r.start_at,
  durationSec: r.duration_sec,
  lateJoinSec: r.late_join_sec,
  archiveHours: r.archive_hours,
  status: r.session_status,
});

/** 再生してよい状態のときだけ動画の在処を返す（開始前の先出し視聴を防ぐ） */
function mediaFor(reservation, state) {
  if (!mediaAllowed(state.state)) return null;
  const src = parseVideoSource(reservation.video_url);
  if (src.type === 'youtube') return { type: 'youtube', id: src.id };
  if (src.type === 'file' || src.type === 'url') {
    return { type: 'video', src: `/watch/${encodeURIComponent(reservation.watch_token)}/media` };
  }
  return null;
}

function viewerCountFor(reservation, state, now) {
  if (!reservation.show_viewer_count) return 0;
  if (state.state !== PlaybackState.LIVE) return 0;
  const real = countLiveViewers(reservation.session_id, now);
  // 実測が表示目安を上回ったら実測を出す（過少表示を避ける）
  const shown = displayedViewerCount(reservation.session_id, reservation.viewer_base, state.positionSec, reservation.duration_sec);
  return Math.max(real, shown);
}

export function register(router, views) {
  const { watchPage, watchBlockedPage, watchNotFoundPage } = views;

  router.get('/watch/:token', (req, res, ctx) => {
    const now = clock.now();
    const reservation = getByWatchToken(ctx.params.token);
    if (!reservation) return html(res, watchNotFoundPage(), 404);

    if (reservation.status !== 'active') {
      return html(res, watchBlockedPage(reservation, { state: PlaybackState.CANCELED }, now), 410);
    }

    const state = playbackState(toPlan(reservation), now);
    if ([PlaybackState.CANCELED, PlaybackState.LATE_CLOSED, PlaybackState.ENDED].includes(state.state)) {
      return html(res, watchBlockedPage(reservation, state, now), 200);
    }

    const media = mediaFor(reservation, state);
    if (media) recordWatchEvent({ reservationId: reservation.id, sessionId: reservation.session_id, kind: 'open', atSec: state.positionSec }, now);

    html(res, watchPage({
      reservation,
      state,
      media,
      chat: reservation.show_chat
        ? listChatScript(reservation.webinar_id).map((c) => ({ at: c.at_sec, author: c.author, body: c.body, kind: c.kind }))
        : [],
      serverNow: now,
      viewerCount: viewerCountFor(reservation, state, now),
    }));
  });

  // クライアントからの定期同期。時刻ずれの補正と、開始時刻になった瞬間の動画URL受け渡しを担う。
  router.post('/watch/:token/state', (req, res, ctx) => {
    const now = clock.now();
    const reservation = getByWatchToken(ctx.params.token);
    if (!reservation || reservation.status !== 'active') return json(res, { error: 'not_found' }, 404);

    const state = playbackState(toPlan(reservation), now);
    const body = parseBody(ctx.rawBody, req.headers['content-type'] || '');
    if (state.state === PlaybackState.LIVE) {
      recordWatchEvent({
        reservationId: reservation.id, sessionId: reservation.session_id,
        kind: 'heartbeat', atSec: body.atSec ?? state.positionSec,
      }, now);
    }

    json(res, {
      state: state.state,
      seekable: state.seekable,
      positionSec: Math.round(state.positionSec),
      serverNow: now,
      media: mediaFor(reservation, state),
      viewerCount: viewerCountFor(reservation, state, now),
    });
  });

  // 動画本体。再生可能な時間帯かつ有効なトークンのときだけ通す。
  router.get('/watch/:token/media', (req, res, ctx) => {
    const now = clock.now();
    const reservation = getByWatchToken(ctx.params.token);
    if (!reservation || reservation.status !== 'active') return send(res, 404, 'not found');

    const state = playbackState(toPlan(reservation), now);
    if (!mediaAllowed(state.state)) return send(res, 403, 'まだ視聴できません');

    const src = parseVideoSource(reservation.video_url);
    if (src.type === 'url') {
      // 外部CDN等。URLを知られるのは視聴可能な時間帯だけになる。
      // より厳密にしたい場合は、ここで署名付きURLを都度発行する実装に差し替える。
      return redirect(res, src.url, 302);
    }
    if (src.type === 'file') {
      const full = resolveWithin(config.mediaDir, src.name);
      if (!full) return send(res, 400, 'bad path');
      return sendFile(req, res, full, { cache: 'private, max-age=60' });
    }
    return send(res, 404, 'not found');
  });

  router.post('/watch/:token/event', (req, res, ctx) => {
    const now = clock.now();
    const reservation = getByWatchToken(ctx.params.token);
    if (!reservation) return json(res, { ok: false }, 404);

    const body = parseBody(ctx.rawBody, req.headers['content-type'] || '');
    const kind = ['open', 'play', 'heartbeat', 'cta_click', 'leave'].includes(body.kind) ? body.kind : null;
    if (!kind) return json(res, { ok: false }, 400);

    recordWatchEvent({
      reservationId: reservation.id, sessionId: reservation.session_id,
      kind, atSec: body.atSec,
    }, now);
    json(res, { ok: true });
  });

  router.post('/watch/:token/question', (req, res, ctx) => {
    const now = clock.now();
    const reservation = getByWatchToken(ctx.params.token);
    if (!reservation) return json(res, { ok: false }, 404);

    const body = parseBody(ctx.rawBody, req.headers['content-type'] || '');
    const saved = addQuestion({
      reservationId: reservation.id, sessionId: reservation.session_id,
      body: body.body, atSec: body.atSec,
    }, now);
    if (!saved) return json(res, { ok: false, error: 'empty' }, 400);
    json(res, { ok: true });
  });

  // 静的ファイル（CSS/JS）
  router.get('/static/*', (req, res, ctx) => {
    const full = resolveWithin(path.join(ROOT, 'public'), ctx.params.wildcard || '');
    if (!full) return send(res, 400, 'bad path');
    sendFile(req, res, full, { cache: 'public, max-age=3600' });
  });
}
