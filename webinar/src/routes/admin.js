// 管理画面。Cookieに署名付きの有効期限を入れる方式の簡易ログイン。

import { clock } from '../clock.js';
import { config, configWarnings } from '../config.js';
import { log } from '../lib/log.js';
import { all, get } from '../db.js';
import { html, redirect, send, parseBody, parseCookies, setCookie } from '../lib/http.js';
import { sign, unsign, safeEqual } from '../lib/ids.js';
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
import * as views from '../views/admin.js';

const COOKIE = 'wadm';
const SESSION_MS = 12 * 3600 * 1000;

function isConfigured() {
  return Boolean(config.admin.pass && config.admin.sessionSecret);
}

function isLoggedIn(req) {
  if (!isConfigured()) return false;
  const cookie = parseCookies(req.headers.cookie || '')[COOKIE];
  const value = unsign(cookie || '', config.admin.sessionSecret);
  if (!value) return false;
  const expiry = Number(value);
  return Number.isFinite(expiry) && expiry > clock.now();
}

/** ログイン必須のハンドラを包む */
const guard = (handler) => (req, res, ctx) => {
  if (!isConfigured()) {
    return html(res, views.loginPage('ADMIN_PASS と SESSION_SECRET が未設定です。.env を設定して再起動してください。'), 503);
  }
  if (!isLoggedIn(req)) return redirect(res, '/admin/login', 302);
  return handler(req, res, ctx);
};

const int = (v, dflt = 0) => {
  const n = Number(String(v ?? '').trim());
  return Number.isFinite(n) ? Math.trunc(n) : dflt;
};

export function register(router) {
  // ---- ログイン ----
  router.get('/admin/login', (req, res) => {
    if (isLoggedIn(req)) return redirect(res, '/admin', 302);
    html(res, views.loginPage(isConfigured() ? '' : 'ADMIN_PASS と SESSION_SECRET が未設定です。'));
  });

  router.post('/admin/login', (req, res, ctx) => {
    if (!isConfigured()) return html(res, views.loginPage('ADMIN_PASS と SESSION_SECRET が未設定です。'), 503);
    const form = parseBody(ctx.rawBody, req.headers['content-type'] || '');
    const ok = safeEqual(form.user || '', config.admin.user) && safeEqual(form.pass || '', config.admin.pass);
    if (!ok) {
      log.warn('管理画面のログインに失敗しました');
      return html(res, views.loginPage('ユーザー名またはパスワードが違います。'), 401);
    }
    const expiry = String(clock.now() + SESSION_MS);
    setCookie(res, COOKIE, sign(expiry, config.admin.sessionSecret), {
      maxAge: SESSION_MS / 1000,
      secure: config.baseUrl.startsWith('https://'),
    });
    redirect(res, '/admin', 303);
  });

  router.post('/admin/logout', (req, res) => {
    setCookie(res, COOKIE, '', { maxAge: 0 });
    redirect(res, '/admin/login', 303);
  });

  // ---- ダッシュボード ----
  router.get('/admin', guard((req, res) => {
    const now = clock.now();
    const stats = {
      upcomingSessions: get(`SELECT COUNT(*) c FROM sessions WHERE start_at > ? AND status = 'open'`, now).c,
      activeReservations: get(`SELECT COUNT(*) c FROM reservations WHERE status = 'active'`).c,
      pendingJobs: get(`SELECT COUNT(*) c FROM notification_jobs WHERE status = 'pending'`).c,
      failedJobs: get(`SELECT COUNT(*) c FROM notification_jobs WHERE status = 'failed'`).c,
    };
    const linked = get(`SELECT COUNT(*) c FROM reservations WHERE status='active' AND line_user_id IS NOT NULL`).c;
    stats.linkedRate = stats.activeReservations > 0 ? Math.round((linked / stats.activeReservations) * 100) : 0;

    html(res, views.dashboardPage({
      stats,
      upcoming: listSessions(now - 3 * 3600 * 1000, 10),
      recentJobs: all(`SELECT j.*, r.name FROM notification_jobs j JOIN reservations r ON r.id = j.reservation_id
                       ORDER BY j.updated_at DESC LIMIT 15`),
      warnings: configWarnings(),
      now,
    }));
  }));

  // ---- 開催枠 ----
  router.get('/admin/sessions', guard((req, res, ctx) => {
    const now = clock.now();
    html(res, views.sessionsPage({
      sessions: listSessions(now - 7 * DAY, 200),
      webinars: listWebinars(),
      rules: listRules(),
      now,
      notice: ctx.query.get('ok') === '1' ? '保存しました。' : '',
    }));
  }));

  router.post('/admin/sessions', guard((req, res, ctx) => {
    const form = parseBody(ctx.rawBody, req.headers['content-type'] || '');
    const startAt = parseJstLocal(form.start_at);
    if (!startAt || !getWebinar(form.webinar_id)) return send(res, 400, '入力内容が正しくありません');
    createSession({ webinarId: form.webinar_id, startAt, capacity: Math.max(0, int(form.capacity)) }, clock.now());
    redirect(res, '/admin/sessions?ok=1', 303);
  }));

  router.post('/admin/sessions/:id/status', guard((req, res, ctx) => {
    const form = parseBody(ctx.rawBody, req.headers['content-type'] || '');
    const status = ['open', 'closed', 'canceled'].includes(form.status) ? form.status : null;
    if (!status) return send(res, 400, '不正な状態です');
    setSessionStatus(ctx.params.id, status);
    redirect(res, '/admin/sessions?ok=1', 303);
  }));

  router.post('/admin/rules', guard((req, res, ctx) => {
    const raw = ctx.rawBody.toString('utf8');
    const form = new URLSearchParams(raw);
    const weekdays = form.getAll('weekdays').map((d) => int(d, -1)).filter((d) => d >= 0 && d <= 6);
    const timeJst = (form.get('time_jst') || '').trim();
    if (weekdays.length === 0 || parseHhMm(timeJst) === null || !getWebinar(form.get('webinar_id'))) {
      return send(res, 400, '曜日・時刻・コンテンツをご確認ください');
    }
    createRule({
      webinarId: form.get('webinar_id'),
      weekdays: [...new Set(weekdays)].sort().join(','),
      timeJst,
      capacity: Math.max(0, int(form.get('capacity'))),
      horizonDays: Math.min(90, Math.max(1, int(form.get('horizon_days'), 14))),
    }, clock.now());
    const created = generateSessionsFromRules(clock.now());
    log.info(`定期開催ルールを追加し、開催枠を${created}件作成しました`);
    redirect(res, '/admin/sessions?ok=1', 303);
  }));

  router.post('/admin/rules/:id/delete', guard((req, res, ctx) => {
    deleteRule(int(ctx.params.id));
    redirect(res, '/admin/sessions?ok=1', 303);
  }));

  // ---- コンテンツ ----
  router.get('/admin/webinars', guard((req, res, ctx) => {
    const editId = ctx.query.get('edit');
    const editing = editId ? getWebinar(editId) : null;
    html(res, views.webinarsPage({
      webinars: listWebinars(),
      editing,
      chatText: editing ? chatScriptToText(listChatScript(editing.id)) : '',
      notice: ctx.query.get('ok') === '1' ? '保存しました。' : '',
    }));
  }));

  router.post('/admin/webinars', guard((req, res, ctx) => {
    const form = parseBody(ctx.rawBody, req.headers['content-type'] || '');
    const title = String(form.title || '').trim();
    const videoUrl = String(form.video_url || '').trim();
    if (!title || !videoUrl) return send(res, 400, 'タイトルと動画は必須です');

    const data = {
      title,
      description: String(form.description || '').trim(),
      video_url: videoUrl,
      duration_sec: Math.max(60, int(form.duration_min, 60) * 60),
      presenter: String(form.presenter || '').trim(),
      cta_label: String(form.cta_label || '').trim(),
      cta_url: String(form.cta_url || '').trim(),
      cta_at_sec: Math.max(0, int(form.cta_at_min) * 60),
      late_join_sec: Math.max(0, int(form.late_join_min) * 60),
      archive_hours: Math.max(0, int(form.archive_hours)),
      show_viewer_count: form.show_viewer_count === '1' ? 1 : 0,
      viewer_base: Math.max(0, int(form.viewer_base)),
      show_chat: form.show_chat === '1' ? 1 : 0,
    };

    const now = clock.now();
    const webinar = form.id ? updateWebinar(form.id, data, now) : createWebinar(data, now);
    if (!webinar) return send(res, 404, 'コンテンツが見つかりません');
    replaceChatScript(webinar.id, parseChatScriptText(form.chat_script));
    redirect(res, `/admin/webinars?edit=${webinar.id}&ok=1`, 303);
  }));

  // ---- 予約 ----
  router.get('/admin/reservations', guard((req, res, ctx) => {
    const sessionId = ctx.query.get('session') || '';
    html(res, views.reservationsPage({
      reservations: queryReservations(sessionId),
      sessions: listRecentSessions(60),
      sessionId,
      now: clock.now(),
    }));
  }));

  router.get('/admin/reservations.csv', guard((req, res, ctx) => {
    const rows = queryReservations(ctx.query.get('session') || '');
    const header = ['開催日時', 'お名前', 'メール', '電話', 'LINE連携', 'LINE表示名', '状態', '予約コード', '視聴分数', 'CTAクリック', '備考'];
    const csv = [header, ...rows.map((r) => [
      formatJstShort(r.start_at), r.name, r.email, r.phone,
      r.line_user_id ? '連携済' : '未連携', r.line_display_name,
      r.status === 'active' ? '有効' : 'キャンセル', r.link_code,
      r.watched_sec ? Math.round(r.watched_sec / 60) : 0, r.cta_clicks || 0, r.note,
    ])].map((cols) => cols.map(csvCell).join(',')).join('\r\n');

    // Excelで文字化けしないよう BOM を付ける
    send(res, 200, '﻿' + csv, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="reservations-${new Date().toISOString().slice(0, 10)}.csv"`,
    });
  }));

  // ---- 通知 ----
  router.get('/admin/jobs', guard((req, res, ctx) => {
    const counts = {};
    for (const row of all(`SELECT status, COUNT(*) c FROM notification_jobs GROUP BY status`)) counts[row.status] = row.c;
    html(res, views.jobsPage({
      jobs: all(`SELECT j.*, r.name, s.start_at
                   FROM notification_jobs j
                   JOIN reservations r ON r.id = j.reservation_id
                   JOIN sessions s ON s.id = r.session_id
                  ORDER BY CASE j.status WHEN 'failed' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
                           j.scheduled_at DESC LIMIT 200`),
      counts,
      now: clock.now(),
      notice: ctx.query.get('ok') === '1' ? '再送を予約しました。数十秒以内に送信されます。' : '',
    }));
  }));

  router.post('/admin/jobs/:id/requeue', guard((req, res, ctx) => {
    requeue(int(ctx.params.id), clock.now());
    redirect(res, '/admin/jobs?ok=1', 303);
  }));

  // ---- 質問 ----
  router.get('/admin/questions', guard((req, res) => {
    html(res, views.questionsPage({
      questions: all(`SELECT q.*, r.name FROM questions q
                        LEFT JOIN reservations r ON r.id = q.reservation_id
                       ORDER BY q.created_at DESC LIMIT 200`),
    }));
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
