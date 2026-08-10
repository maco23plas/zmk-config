import crypto from 'node:crypto';
import { calendarApi } from './google.js';
import { cfg } from './config.js';
import { db } from './db.js';
import type { MeetingRow } from './db.js';
import { log } from './util.js';

const ZOOM_RE = /https?:\/\/[\w.-]*zoom\.us\/(?:j|w|wc\/join)\/(\d+)[^\s<>"']*/i;
const MEET_RE = /https?:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}[^\s<>"']*/i;

function extractUrl(ev: {
  hangoutLink?: string | null;
  location?: string | null;
  description?: string | null;
  conferenceData?: { entryPoints?: Array<{ entryPointType?: string | null; uri?: string | null }> | null } | null;
}): { url: string; provider: 'meet' | 'zoom' } | null {
  if (ev.hangoutLink) return { url: ev.hangoutLink, provider: 'meet' };
  const video = ev.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri;
  const haystack = [video, ev.location, ev.description].filter(Boolean).join('\n');
  const meet = haystack.match(MEET_RE);
  if (meet) return { url: meet[0], provider: 'meet' };
  const zoom = haystack.match(ZOOM_RE);
  if (zoom) return { url: zoom[0], provider: 'zoom' };
  return null;
}

/** カレンダーを同期して meetings テーブルを最新化する (2分おきに呼ばれる) */
export async function syncCalendars(): Promise<void> {
  const cal = calendarApi();
  const timeMin = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const timeMax = new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString();
  const exclude = cfg.excludeTitleRegex ? new RegExp(cfg.excludeTitleRegex) : null;
  let found = 0;

  for (const calendarId of cfg.calendarIds) {
    const res = await cal.events.list({
      calendarId,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 100,
    });
    for (const ev of res.data.items ?? []) {
      if (ev.status === 'cancelled' || !ev.id || !ev.start?.dateTime) continue;
      const conf = extractUrl(ev);
      if (!conf) continue;
      found++;
      const title = ev.summary || '(無題の会議)';
      const attendees = JSON.stringify(
        (ev.attendees ?? [])
          .filter((a) => !a.resource && a.email !== cfg.botEmail)
          .map((a) => ({ email: a.email ?? undefined, name: a.displayName ?? undefined }))
      );
      const existing = db
        .prepare('SELECT * FROM meetings WHERE event_id = ?')
        .get(ev.id) as MeetingRow | undefined;

      const skipped = cfg.joinMode === 'off' || (exclude ? exclude.test(title) : false);

      if (!existing) {
        db.prepare(
          `INSERT INTO meetings (id, event_id, ical_uid, title, start_at, end_at, url, provider, attendees, status, business)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          crypto.randomUUID(),
          ev.id,
          ev.iCalUID ?? null,
          title,
          ev.start.dateTime,
          ev.end?.dateTime ?? null,
          conf.url,
          conf.provider,
          attendees,
          skipped ? 'skipped' : 'scheduled',
          inheritBusiness(ev.iCalUID ?? null)
        );
        log('watcher', `新しい会議を検知: ${title} @ ${ev.start.dateTime} (${conf.provider})`);
      } else if (existing.status === 'scheduled' || existing.status === 'skipped') {
        db.prepare(
          `UPDATE meetings SET title = ?, start_at = ?, end_at = ?, url = ?, provider = ?, attendees = ?, status = ?,
           updated_at = datetime('now') WHERE id = ?`
        ).run(
          title,
          ev.start.dateTime,
          ev.end?.dateTime ?? null,
          conf.url,
          conf.provider,
          attendees,
          skipped ? 'skipped' : 'scheduled',
          existing.id
        );
      }

      // Bot アカウントを予定に自動招待 → Meet にノック無しで入室できる
      if (cfg.autoInviteBot && cfg.botEmail && conf.provider === 'meet') {
        const row = db
          .prepare('SELECT * FROM meetings WHERE event_id = ?')
          .get(ev.id) as MeetingRow;
        const already = (ev.attendees ?? []).some((a) => a.email === cfg.botEmail);
        if (row && row.status === 'scheduled' && !row.bot_invited && !already) {
          try {
            await cal.events.patch({
              calendarId,
              eventId: ev.id,
              sendUpdates: 'none',
              requestBody: { attendees: [...(ev.attendees ?? []), { email: cfg.botEmail }] },
            });
            db.prepare('UPDATE meetings SET bot_invited = 1 WHERE id = ?').run(row.id);
            log('watcher', `Bot を招待しました: ${title}`);
          } catch (e) {
            log('watcher', `Bot 招待に失敗 (${title}):`, (e as Error).message);
          }
        }
      }
    }
  }
  if (found > 0) log('watcher', `同期完了: 会議リンク付き予定 ${found} 件`);
}

/** 定例会議 (同じ iCalUID) は前回の事業分類を引き継ぐ */
function inheritBusiness(icalUid: string | null): string | null {
  if (!icalUid) return null;
  const prev = db
    .prepare(
      "SELECT business FROM meetings WHERE ical_uid = ? AND business IS NOT NULL ORDER BY start_at DESC LIMIT 1"
    )
    .get(icalUid) as { business: string } | undefined;
  return prev?.business ?? null;
}

/** 入室すべき会議 (開始 lead 分前〜) を返す */
export function dueMeetings(): MeetingRow[] {
  const now = Date.now();
  const rows = db
    .prepare("SELECT * FROM meetings WHERE status = 'scheduled' ORDER BY start_at")
    .all() as MeetingRow[];
  return rows.filter((m) => {
    const start = new Date(m.start_at).getTime();
    const end = m.end_at ? new Date(m.end_at).getTime() : start + 60 * 60 * 1000;
    return now >= start - cfg.joinLeadMin * 60 * 1000 && now < end;
  });
}
