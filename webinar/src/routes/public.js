// 公開ページ（日程一覧・予約・予約完了・予約確認）

import { clock } from '../clock.js';
import { log } from '../lib/log.js';
import { html, redirect, parseBody } from '../lib/http.js';
import { listOpenSessions, getSession } from '../domain/sessions.js';
import {
  createReservation, getByWatchToken, cancelReservation, ReservationError,
} from '../domain/reservations.js';
import { syncJobs, cancelJobs } from '../domain/notifications.js';
import { indexPage, reservePage, thanksPage, managePage, errorPage } from '../views/pages.js';

export function register(router) {
  router.get('/', (req, res) => {
    const now = clock.now();
    html(res, indexPage(listOpenSessions(now, 30), now));
  });

  router.get('/reserve', (req, res, ctx) => {
    const now = clock.now();
    const session = getSession(ctx.query.get('session') || '');
    if (!session) return html(res, errorPage(404, '開催枠が見つかりません', 'すでに終了しているか、URLが正しくない可能性があります。'), 404);
    html(res, reservePage(session, { now }));
  });

  router.post('/reserve', (req, res, ctx) => {
    const now = clock.now();
    const form = parseBody(ctx.rawBody, req.headers['content-type'] || '');
    const session = getSession(form.session_id || '');
    if (!session) return html(res, errorPage(404, '開催枠が見つかりません'), 404);

    const values = {
      name: form.name || '', email: form.email || '',
      phone: form.phone || '', note: form.note || '', agree: form.agree === '1',
    };

    if (!values.agree) {
      return html(res, reservePage(session, { error: '公式LINEで受け取ることに同意のうえ、お進みください。', values, now }), 400);
    }

    let reservation;
    try {
      reservation = createReservation({
        sessionId: session.id, name: values.name, email: values.email,
        phone: values.phone, note: values.note, source: 'web',
      }, now);
    } catch (err) {
      if (err instanceof ReservationError) {
        return html(res, reservePage(session, { error: err.message, values, now }), 400);
      }
      log.error('予約の作成に失敗:', err?.stack || err);
      return html(res, reservePage(session, { error: '受付に失敗しました。時間をおいてお試しください。', values, now }), 500);
    }

    // この時点ではLINE未連携なので通知は積まれない（連携時に syncJobs が呼ばれる）
    syncJobs(reservation.id, now);
    log.info(`予約を受け付けました: ${reservation.id} ${reservation.name} / ${session.title}`);
    redirect(res, `/thanks/${reservation.watch_token}`, 303);
  });

  router.get('/thanks/:token', (req, res, ctx) => {
    const reservation = getByWatchToken(ctx.params.token);
    if (!reservation) return html(res, errorPage(404, '予約が見つかりません'), 404);
    html(res, thanksPage(reservation, clock.now()));
  });

  router.get('/r/:token', (req, res, ctx) => {
    const reservation = getByWatchToken(ctx.params.token);
    if (!reservation) return html(res, errorPage(404, '予約が見つかりません'), 404);
    const notice = ctx.query.get('canceled') === '1' ? 'ご予約をキャンセルしました。' : '';
    html(res, managePage(reservation, clock.now(), { notice }));
  });

  router.post('/r/:token/cancel', (req, res, ctx) => {
    const reservation = getByWatchToken(ctx.params.token);
    if (!reservation) return html(res, errorPage(404, '予約が見つかりません'), 404);
    if (reservation.status === 'active') {
      cancelReservation(reservation.id, clock.now());
      cancelJobs(reservation.id);
      log.info(`予約をキャンセル: ${reservation.id}`);
    }
    redirect(res, `/r/${ctx.params.token}?canceled=1`, 303);
  });

  // 死活監視用
  router.get('/healthz', (req, res) => {
    html(res, 'ok');
  });
}

