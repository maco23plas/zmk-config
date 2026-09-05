// 視聴ページと、その裏で動くAPI（状態取得・動画配信・視聴ログ・質問）

import { clock } from '../clock.js';
import { config } from '../config.js';
import { html, json, text, redirect, serveFile } from '../lib/http.js';
import { playbackState, mediaAllowed, roomOpen, parseVideoSource, PlaybackState } from '../domain/playback.js';
import { getByWatchToken, recordWatchEvent, addQuestion } from '../domain/reservations.js';
import { listChatScript } from '../domain/webinars.js';
import { displayedViewerCount } from '../domain/presence.js';
import {
  displayNameFor, touchPresence, roomSnapshot, postMessage, messagesSince, recentMessages,
  listPolls, parsePollOptions, activePoll, vote, pollTally, myVote, ChatError,
} from '../domain/room.js';

const toPlan = (r) => ({
  startAt: r.start_at,
  durationSec: r.duration_sec,
  lateJoinSec: r.late_join_sec,
  archiveHours: r.archive_hours,
  lobbyOpenMin: r.lobby_open_min,
  status: r.session_status,
});

/** 再生してよい状態のときだけ動画の在処を返す（開始前の先出し視聴を防ぐ） */
function mediaFor(reservation, state) {
  if (!mediaAllowed(state.state)) return null;
  const src = parseVideoSource(reservation.video_url);
  if (src.type === 'youtube') return { type: 'youtube', id: src.id };
  if (src.type === 'url') return { type: 'video', src: `/watch/${encodeURIComponent(reservation.watch_token)}/media` };
  // 自前ファイル（Nodeなら media/、Cloudflareなら R2）
  if (src.type === 'file' && config.canServeFiles) {
    return { type: 'video', src: `/watch/${encodeURIComponent(reservation.watch_token)}/media` };
  }
  return null;
}

/**
 * いま出す投票と、その集計。全員が同じ再生位置なので、同じ投票が同時に出る。
 */
async function pollStateFor(reservation, positionSec) {
  const polls = await listPolls(reservation.webinar_id);
  const poll = activePoll(polls, positionSec);
  if (!poll) return null;

  const options = parsePollOptions(poll.options);
  const [{ tally, total }, mine] = await Promise.all([
    pollTally(poll.id, reservation.session_id, options.length),
    myVote(poll.id, reservation.session_id, reservation.id),
  ]);
  return {
    id: poll.id,
    question: poll.question,
    options,
    tally,
    total,
    myChoice: mine,
    closed: poll.close_sec > 0 && positionSec > poll.close_sec,
  };
}

/** 会場の状況。人数・入室・コメントはすべて実際の参加者のもの。 */
async function roomStateFor(reservation, state, now, { sinceJoin, afterId } = {}) {
  if (!roomOpen(state.state)) return { viewers: 0, showViewers: false, joins: [], messages: [], lastId: afterId || 0 };

  const displayName = displayNameFor(reservation.name);
  await touchPresence({
    sessionId: reservation.session_id, reservationId: reservation.id, displayName,
  }, now);

  const [snapshot, messages] = await Promise.all([
    roomSnapshot({
      sessionId: reservation.session_id,
      reservationId: reservation.id,
      minViewersShown: reservation.min_viewers_shown,
    }, now, sinceJoin),
    reservation.show_chat
      ? (afterId === undefined ? recentMessages(reservation.session_id) : messagesSince(reservation.session_id, afterId))
      : Promise.resolve([]),
  ]);

  // viewer_base を設定している場合だけ、実測と目安の大きい方を出す（既定は実測のみ）
  const shown = reservation.viewer_base > 0
    ? Math.max(snapshot.viewers, await displayedViewerCount(
      reservation.session_id, reservation.viewer_base, state.positionSec, reservation.duration_sec))
    : snapshot.viewers;

  return {
    viewers: reservation.show_viewer_count ? shown : 0,
    showViewers: Boolean(reservation.show_viewer_count) && (snapshot.showViewers || reservation.viewer_base > 0),
    joins: snapshot.joins,
    messages: messages.map((m) => ({
      id: m.id, name: m.display_name, body: m.body, kind: m.kind, at: m.created_at,
    })),
    lastId: messages.length ? messages[messages.length - 1].id : (afterId || 0),
  };
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

    // 司会の進行台本。時刻で決まるのでクライアント側に渡し、遅延ゼロで出す。
    const script = (await listChatScript(reservation.webinar_id))
      .map((c) => ({ at: c.at_sec, author: c.author, body: c.body, kind: c.kind }));

    return html(watchPage({
      reservation,
      state,
      media,
      script,
      room: await roomStateFor(reservation, state, now, { sinceJoin: null }),
      poll: state.state === PlaybackState.LIVE ? await pollStateFor(reservation, state.positionSec) : null,
      serverNow: now,
    }));
  });

  // クライアントからの定期同期。1本で「時刻合わせ・動画の受け渡し・在室・
  // 新着コメント・投票」をまとめて返すので、視聴中のリクエストはこれだけで済む。
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

    const room = await roomStateFor(reservation, state, now, {
      sinceJoin: Number(ctx.form.sinceJoin) || null,
      afterId: Number(ctx.form.afterId) || 0,
    });

    return json({
      state: state.state,
      seekable: state.seekable,
      positionSec: Math.round(state.positionSec),
      serverNow: now,
      media: mediaFor(reservation, state),
      room,
      poll: state.state === PlaybackState.LIVE ? await pollStateFor(reservation, state.positionSec) : null,
    });
  });

  // 参加者の発言。開場中と配信中だけ受け付ける。
  router.post('/watch/:token/chat', async (ctx) => {
    const now = clock.now();
    const reservation = await getByWatchToken(ctx.params.token);
    if (!reservation || reservation.status !== 'active') return json({ ok: false }, 404);

    const state = playbackState(toPlan(reservation), now);
    if (!roomOpen(state.state)) return json({ ok: false, error: 'closed' }, 403);
    if (reservation.chat_mode !== 'on' || !reservation.show_chat) {
      return json({ ok: false, error: 'disabled' }, 403);
    }

    try {
      const saved = await postMessage({
        sessionId: reservation.session_id,
        reservationId: reservation.id,
        displayName: displayNameFor(reservation.name),
        body: ctx.form.body,
      }, now);
      return json({ ok: true, id: saved.id });
    } catch (err) {
      if (err instanceof ChatError) return json({ ok: false, error: err.code, message: err.message }, 400);
      throw err;
    }
  });

  // 投票
  router.post('/watch/:token/vote', async (ctx) => {
    const now = clock.now();
    const reservation = await getByWatchToken(ctx.params.token);
    if (!reservation || reservation.status !== 'active') return json({ ok: false }, 404);

    const state = playbackState(toPlan(reservation), now);
    if (state.state !== PlaybackState.LIVE) return json({ ok: false, error: 'closed' }, 403);

    const polls = await listPolls(reservation.webinar_id);
    const poll = activePoll(polls, state.positionSec);
    const choice = Number(ctx.form.choice);
    const options = poll ? parsePollOptions(poll.options) : [];
    if (!poll || poll.id !== Number(ctx.form.pollId) || !Number.isInteger(choice)
        || choice < 0 || choice >= options.length) {
      return json({ ok: false, error: 'invalid' }, 400);
    }
    if (poll.close_sec > 0 && state.positionSec > poll.close_sec) {
      return json({ ok: false, error: 'closed' }, 403);
    }

    await vote({ pollId: poll.id, sessionId: reservation.session_id, reservationId: reservation.id, choice }, now);
    return json({ ok: true, poll: await pollStateFor(reservation, state.positionSec) });
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
      // 置き場所が無い（Cloudflare で R2 バケットを繋いでいない）場合
      return response || text(
        '動画ファイルの置き場所が設定されていません。'
        + 'Cloudflare で動かす場合は R2 バケットを繋ぐか、YouTube限定公開／CDNのURLをご利用ください。', 501);
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
