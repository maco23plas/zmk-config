// 管理画面。Cookieに署名付きの有効期限を入れる方式の簡易ログイン。

import { clock } from '../clock.js';
import { config, configWarnings } from '../config.js';
import { log } from '../lib/log.js';
import { all, get } from '../db.js';
import { html, redirect, text, parseCookies, withCookie } from '../lib/http.js';
import { sign, unsign, timingSafeEqual } from '../lib/crypto.js';
import { DAY, parseJstLocal, parseHhMm, formatJstShort } from '../lib/time.js';
import {
  listSessions, listRecentSessions, createSession, setSessionStatus,
  listRules, createRule, deleteRule, generateSessionsFromRules,
} from '../domain/sessions.js';
import {
  listWebinars, getWebinar, createWebinar, updateWebinar,
  listChatScript, replaceChatScript, parseChatScriptText, chatScriptToText,
} from '../domain/webinars.js';
import { requeue } from '../domain/notifications.js';
import { listPolls, parsePollsText, pollsToText, replacePolls } from '../domain/room.js';
import * as views from '../views/admin.js';

const COOKIE = 'wadm';
const SESSION_MS = 12 * 3600 * 1000;

const isConfigured = () => Boolean(config.admin.pass && config.admin.sessionSecret);

async function isLoggedIn(request) {
  if (!isConfigured()) return false;
  const cookie = parseCookies(request.headers.get('cookie') || '')[COOKIE];
  const value = await unsign(cookie || '', config.admin.sessionSecret);
  const expiry = Number(value);
  return Number.isFinite(expiry) && expiry > clock.now();
}

/** ログイン必須のハンドラを包む */
const guard = (handler) => async (ctx) => {
  if (!isConfigured()) {
    return html(views.loginPage('ADMIN_PASS と SESSION_SECRET が未設定です。環境変数を設定して再起動してください。'), 503);
  }
  if (!(await isLoggedIn(ctx.request))) return redirect('/admin/login', 302);
  return handler(ctx);
};

const int = (v, dflt = 0) => {
  const n = Number(String(v ?? '').trim());
  return Number.isFinite(n) ? Math.trunc(n) : dflt;
};

export function register(router) {
  // ---- ログイン ----
  router.get('/admin/login', async (ctx) => {
    if (await isLoggedIn(ctx.request)) return redirect('/admin', 302);
    return html(views.loginPage(isConfigured() ? '' : 'ADMIN_PASS と SESSION_SECRET が未設定です。'));
  });

  router.post('/admin/login', async (ctx) => {
    if (!isConfigured()) return html(views.loginPage('ADMIN_PASS と SESSION_SECRET が未設定です。'), 503);
    const ok = timingSafeEqual(ctx.form.user || '', config.admin.user)
      && timingSafeEqual(ctx.form.pass || '', config.admin.pass);
    if (!ok) {
      log.warn('管理画面のログインに失敗しました');
      return html(views.loginPage('ユーザー名またはパスワードが違います。'), 401);
    }
    const token = await sign(String(clock.now() + SESSION_MS), config.admin.sessionSecret);
    return withCookie(redirect('/admin', 303), COOKIE, token, {
      maxAge: SESSION_MS / 1000,
      secure: config.baseUrl.startsWith('https://'),
    });
  });

  router.post('/admin/logout', () =>
    withCookie(redirect('/admin/login', 303), COOKIE, '', { maxAge: 0 }));

  // ---- ダッシュボード ----
  router.get('/admin', guard(async () => {
    const now = clock.now();
    const [upcomingSessions, activeReservations, pendingJobs, failedJobs, linked] = await Promise.all([
      get(`SELECT COUNT(*) c FROM sessions WHERE start_at > ? AND status = 'open'`, now),
      get(`SELECT COUNT(*) c FROM reservations WHERE status = 'active'`),
      get(`SELECT COUNT(*) c FROM notification_jobs WHERE status IN ('pending','sending')`),
      get(`SELECT COUNT(*) c FROM notification_jobs WHERE status = 'failed'`),
      get(`SELECT COUNT(*) c FROM reservations WHERE status='active' AND line_user_id IS NOT NULL`),
    ]);
    const stats = {
      upcomingSessions: upcomingSessions.c,
      activeReservations: activeReservations.c,
      pendingJobs: pendingJobs.c,
      failedJobs: failedJobs.c,
      linkedRate: activeReservations.c > 0 ? Math.round((linked.c / activeReservations.c) * 100) : 0,
    };

    return html(views.dashboardPage({
      stats,
      upcoming: await listSessions(now - 3 * 3600 * 1000, 10),
      recentJobs: await all(`SELECT j.*, r.name FROM notification_jobs j
                               JOIN reservations r ON r.id = j.reservation_id
                              ORDER BY j.updated_at DESC LIMIT 15`),
      warnings: configWarnings(),
      now,
    }));
  }));

  // ---- 開催枠 ----
  router.get('/admin/sessions', guard(async (ctx) => {
    const now = clock.now();
    return html(views.sessionsPage({
      sessions: await listSessions(now - 7 * DAY, 200),
      webinars: await listWebinars(),
      rules: await listRules(),
      now,
      notice: ctx.query.get('ok') === '1' ? '保存しました。' : '',
    }));
  }));

  router.post('/admin/sessions', guard(async (ctx) => {
    const startAt = parseJstLocal(ctx.form.start_at);
    if (!startAt || !(await getWebinar(ctx.form.webinar_id))) return text('入力内容が正しくありません', 400);
    await createSession({
      webinarId: ctx.form.webinar_id, startAt, capacity: Math.max(0, int(ctx.form.capacity)),
    }, clock.now());
    return redirect('/admin/sessions?ok=1', 303);
  }));

  router.post('/admin/sessions/:id/status', guard(async (ctx) => {
    const status = ['open', 'closed', 'canceled'].includes(ctx.form.status) ? ctx.form.status : null;
    if (!status) return text('不正な状態です', 400);
    await setSessionStatus(ctx.params.id, status);
    return redirect('/admin/sessions?ok=1', 303);
  }));

  router.post('/admin/rules', guard(async (ctx) => {
    // weekdays は同名で複数送られてくるので、生の本文から取り出す
    const form = new URLSearchParams(new TextDecoder().decode(ctx.rawBody));
    const weekdays = form.getAll('weekdays').map((d) => int(d, -1)).filter((d) => d >= 0 && d <= 6);
    const timeJst = (form.get('time_jst') || '').trim();
    if (weekdays.length === 0 || parseHhMm(timeJst) === null || !(await getWebinar(form.get('webinar_id')))) {
      return text('曜日・時刻・コンテンツをご確認ください', 400);
    }
    await createRule({
      webinarId: form.get('webinar_id'),
      weekdays: [...new Set(weekdays)].sort().join(','),
      timeJst,
      capacity: Math.max(0, int(form.get('capacity'))),
      horizonDays: Math.min(90, Math.max(1, int(form.get('horizon_days'), 14))),
    }, clock.now());
    const created = await generateSessionsFromRules(clock.now());
    log.info(`定期開催ルールを追加し、開催枠を${created}件作成しました`);
    return redirect('/admin/sessions?ok=1', 303);
  }));

  router.post('/admin/rules/:id/delete', guard(async (ctx) => {
    await deleteRule(int(ctx.params.id));
    return redirect('/admin/sessions?ok=1', 303);
  }));

  // ---- コンテンツ ----
  router.get('/admin/webinars', guard(async (ctx) => {
    const editId = ctx.query.get('edit');
    const editing = editId ? await getWebinar(editId) : null;
    return html(views.webinarsPage({
      webinars: await listWebinars(),
      editing,
      chatText: editing ? chatScriptToText(await listChatScript(editing.id)) : '',
      pollsText: editing ? pollsToText(await listPolls(editing.id)) : '',
      notice: ctx.query.get('ok') === '1' ? '保存しました。' : '',
    }));
  }));

  router.post('/admin/webinars', guard(async (ctx) => {
    const f = ctx.form;
    const title = String(f.title || '').trim();
    const videoUrl = String(f.video_url || '').trim();
    if (!title || !videoUrl) return text('タイトルと動画は必須です', 400);

    const data = {
      title,
      description: String(f.description || '').trim(),
      video_url: videoUrl,
      duration_sec: Math.max(60, int(f.duration_min, 60) * 60),
      presenter: String(f.presenter || '').trim(),
      cta_label: String(f.cta_label || '').trim(),
      cta_url: String(f.cta_url || '').trim(),
      cta_at_sec: Math.max(0, int(f.cta_at_min) * 60),
      late_join_sec: Math.max(0, int(f.late_join_min) * 60),
      archive_hours: Math.max(0, int(f.archive_hours)),
      show_viewer_count: f.show_viewer_count === '1' ? 1 : 0,
      viewer_base: Math.max(0, int(f.viewer_base)),
      show_chat: f.show_chat === '1' ? 1 : 0,
      lobby_open_min: Math.min(120, Math.max(0, int(f.lobby_open_min, 15))),
      min_viewers_shown: Math.min(1000, Math.max(1, int(f.min_viewers_shown, 3))),
      welcome_message: String(f.welcome_message || '').trim().slice(0, 120),
      closing_message: String(f.closing_message || '').trim().slice(0, 200),
    };

    const now = clock.now();
    const webinar = f.id ? await updateWebinar(f.id, data, now) : await createWebinar(data, now);
    if (!webinar) return text('コンテンツが見つかりません', 404);
    await replaceChatScript(webinar.id, parseChatScriptText(f.chat_script));
    await replacePolls(webinar.id, parsePollsText(f.polls_text));
    return redirect(`/admin/webinars?edit=${webinar.id}&ok=1`, 303);
  }));

  // ---- 予約 ----
  router.get('/admin/reservations', guard(async (ctx) => {
    const sessionId = ctx.query.get('session') || '';
    return html(views.reservationsPage({
      reservations: await queryReservations(sessionId),
      sessions: await listRecentSessions(60),
      sessionId,
      now: clock.now(),
    }));
  }));

  router.get('/admin/reservations.csv', guard(async (ctx) => {
    const rows = await queryReservations(ctx.query.get('session') || '');
    const header = ['開催日時', 'お名前', 'メール', '電話', 'LINE連携', 'LINE表示名', '状態', '予約コード', '視聴分数', 'CTAクリック', '備考'];
    const csv = [header, ...rows.map((r) => [
      formatJstShort(r.start_at), r.name, r.email, r.phone,
      r.line_user_id ? '連携済' : '未連携', r.line_display_name,
      r.status === 'active' ? '有効' : 'キャンセル', r.link_code,
      r.watched_sec ? Math.round(r.watched_sec / 60) : 0, r.cta_clicks || 0, r.note,
    ])].map((cols) => cols.map(csvCell).join(',')).join('\r\n');

    // Excelで文字化けしないよう BOM を付ける
    return new Response('﻿' + csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="reservations-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }));

  // ---- 通知 ----
  router.get('/admin/jobs', guard(async (ctx) => {
    const counts = {};
    for (const row of await all('SELECT status, COUNT(*) c FROM notification_jobs GROUP BY status')) {
      counts[row.status] = row.c;
    }
    return html(views.jobsPage({
      jobs: await all(`SELECT j.*, r.name, s.start_at
                         FROM notification_jobs j
                         JOIN reservations r ON r.id = j.reservation_id
                         JOIN sessions s ON s.id = r.session_id
                        ORDER BY CASE j.status WHEN 'failed' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
                                 j.scheduled_at DESC LIMIT 200`),
      counts,
      now: clock.now(),
      notice: ctx.query.get('ok') === '1' ? '再送を予約しました。まもなく送信されます。' : '',
    }));
  }));

  router.post('/admin/jobs/:id/requeue', guard(async (ctx) => {
    await requeue(int(ctx.params.id), clock.now());
    return redirect('/admin/jobs?ok=1', 303);
  }));

}

function queryReservations(sessionId) {
  const where = sessionId ? 'WHERE r.session_id = ?' : '';
  const params = sessionId ? [sessionId] : [];
  return all(
    `SELECT r.*, s.start_at, w.title,
            (SELECT MAX(at_sec) FROM watch_events e WHERE e.reservation_id = r.id) AS watched_sec,
            (SELECT COUNT(*) FROM watch_events e WHERE e.reservation_id = r.id AND e.kind = 'cta_click') AS cta_clicks
       FROM reservations r
       JOIN sessions s ON s.id = r.session_id
       JOIN webinars w ON w.id = s.webinar_id
       ${where}
      ORDER BY s.start_at DESC, r.created_at ASC
      LIMIT 1000`,
    ...params,
  );
}

function csvCell(value) {
  const s = String(value ?? '');
  // 先頭が = + - @ のセルはExcelで数式として実行されうるので無害化する
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}
