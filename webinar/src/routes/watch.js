// 視聴ページと、その裏で動くAPI（状態取得・動画配信・視聴ログ・質問）

import { clock } from '../clock.js';
import { config } from '../config.js';
import { html, json, text, redirect, serveFile } from '../lib/http.js';
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
  if (src.type === 'url') return { type: 'video', src: `/watch/${encodeURIComponent(reservation.watch_token)}/media` };
  // 自前ファイルはディスクを持つ環境でのみ配信できる
  if (src.type === 'file' && config.canServeFiles) {
    return { type: 'video', src: `/watch/${encodeURIComponent(reservation.watch_token)}/media` };
  }
  return null;
}

async function viewerCountFor(reservation, state, now) {
  if (!reservation.show_viewer_count || state.state !== PlaybackState.LIVE) return 0;
  const [real, shown] = await Promise.all([
    countLiveViewers(reservation.session_id, now),
    displayedViewerCount(reservation.session_id, reservation.viewer_base, state.positionSec, reservation.duration_sec),
  ]);
  // 実測が表示目安を上回ったら実測を出す（過少表示を避ける）
  return Math.max(real, shown);
}

export function register(router, views) {
  const { watchPage, watchBlockedPage, watchNotFoundPage } = views;

  router.get('/watch/:token', async (ctx) => {
    const now = clock.now();
    const reservation = await getByWatchToken(ctx.params.token);
    if (!reservation) return html(watchNotFoundPage(), 404);

    if (reservation.status !== 'active') {
      return html(watchBlockedPage(reservation, { state: PlaybackState.CANCELED }, now), 410);
    }

    const state = playbackState(toPlan(reservation), now);
    if ([PlaybackState.CANCELED, PlaybackState.LATE_CLOSED, PlaybackState.ENDED].includes(state.state)) {
      return html(watchBlockedPage(reservation, state, now));
    }

    const media = mediaFor(reservation, state);
    if (media) {
      await recordWatchEvent({
        reservationId: reservation.id, sessionId: reservation.session_id,
        kind: 'open', atSec: state.positionSec,
      }, now);
    }

    const chat = reservation.show_chat
      ? (await listChatScript(reservation.webinar_id))
        .map((c) => ({ at: c.at_sec, author: c.author, body: c.body, kind: c.kind }))
      : [];

    return html(watchPage({
      reservation, state, media, chat,
      serverNow: now,
      viewerCount: await viewerCountFor(reservation, state, now),
    }));
  });

  // クライアントからの定期同期。時刻ずれの補正と、開始時刻になった瞬間の動画URL受け渡しを担う。
  // ハートビートも兼ねているので、視聴中のリクエスト数はこの1本だけで済む。
  router.post('/watch/:token/state', async (ctx) => {
    const now = clock.now();
    const reservation = await getByWatchToken(ctx.params.token);
    if (!reservation || reservation.status !== 'active') return json({ error: 'not_found' }, 404);

    const state = playbackState(toPlan(reservation), now);
    if (state.state === PlaybackState.LIVE) {
      await recordWatchEvent({
        reservationId: reservation.id, sessionId: reservation.session_id,
        kind: 'heartbeat', atSec: ctx.form.atSec ?? state.positionSec,
      }, now);
    }

    return json({
      state: state.state,
      seekable: state.seekable,
      positionSec: Math.round(state.positionSec),
      serverNow: now,
      media: mediaFor(reservation, state),
      viewerCount: await viewerCountFor(reservation, state, now),
    });
  });

  // 動画本体。再生可能な時間帯かつ有効なトークンのときだけ通す。
  router.get('/watch/:token/media', async (ctx) => {
    const now = clock.now();
    const reservation = await getByWatchToken(ctx.params.token);
    if (!reservation || reservation.status !== 'active') return text('not found', 404);

    const state = playbackState(toPlan(reservation), now);
    if (!mediaAllowed(state.state)) return text('まだ視聴できません', 403);

    const src = parseVideoSource(reservation.video_url);
    if (src.type === 'url') {
      // 外部CDN等。URLを知られるのは視聴可能な時間帯だけになる。
      // より厳密にしたい場合は、ここで署名付きURLを都度発行する実装に差し替える。
      return redirect(src.url, 302);
    }
    if (src.type === 'file') {
      const response = await serveFile(config.mediaDir, src.name, ctx.request, { cache: 'private, max-age=60' });
      // ディスクを持たない環境（Cloudflare Workers）では file: 指定は使えない
      return response || text('この環境では動画ファイルの自前配信ができません（YouTubeまたはCDNのURLをご利用ください）', 501);
    }
    return text('not found', 404);
  });

  router.post('/watch/:token/event', async (ctx) => {
    const reservation = await getByWatchToken(ctx.params.token);
    if (!reservation) return json({ ok: false }, 404);

    const kind = ['open', 'play', 'heartbeat', 'cta_click', 'leave'].includes(ctx.form.kind) ? ctx.form.kind : null;
    if (!kind) return json({ ok: false }, 400);

    await recordWatchEvent({
      reservationId: reservation.id, sessionId: reservation.session_id,
      kind, atSec: ctx.form.atSec,
    }, clock.now());
    return json({ ok: true });
  });

  router.post('/watch/:token/question', async (ctx) => {
    const reservation = await getByWatchToken(ctx.params.token);
    if (!reservation) return json({ ok: false }, 404);

    const saved = await addQuestion({
      reservationId: reservation.id, sessionId: reservation.session_id,
      body: ctx.form.body, atSec: ctx.form.atSec,
    }, clock.now());
    if (!saved) return json({ ok: false, error: 'empty' }, 400);
    return json({ ok: true });
  });

  // 静的ファイル（CSS/JS）。Cloudflare では Assets が先に配信するのでここには来ない。
  router.get('/static/*', async (ctx) => {
    const response = await serveFile(config.publicDir, ctx.url.pathname, ctx.request, { cache: 'public, max-age=3600' });
    return response || text('not found', 404);
  });
}
