/** 配信まわり: Gmail 送信 / Slack Webhook / Google Drive アップロード + 共有リンク */
import fs from 'node:fs';
import path from 'node:path';
import { marked } from 'marked';
import { findBusiness } from './businesses.js';
import { cfg } from './config.js';
import { attendeesOf, getMeeting } from './db.js';
import type { MeetingRow } from './db.js';
import { driveApi, gmailApi, hasGoogleAuth } from './google.js';
import { log } from './util.js';

export function mdToHtml(md: string): string {
  return marked.parse(md, { async: false }) as string;
}

export async function sendMail(to: string[], subject: string, markdown: string): Promise<void> {
  if (to.length === 0 || !hasGoogleAuth()) return;
  const html = `<div style="font-family:sans-serif;line-height:1.7;max-width:720px">${mdToHtml(markdown)}</div>`;
  const mime = [
    `To: ${to.join(', ')}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(html).toString('base64'),
  ].join('\r\n');
  const raw = Buffer.from(mime)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  await gmailApi().users.messages.send({ userId: 'me', requestBody: { raw } });
  log('deliver', `メール送信: ${subject} → ${to.join(', ')}`);
}

export async function postSlack(text: string, webhookOverride?: string): Promise<void> {
  const url = webhookOverride || cfg.slackWebhook;
  if (!url) return;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`Slack webhook ${res.status}`);
}

/** 会議フォルダを Drive にアップロードして共有リンク (フォルダ URL) を返す */
export async function uploadMeetingToDrive(dir: string, name: string): Promise<string | null> {
  if (!cfg.driveFolderId || !hasGoogleAuth()) return null;
  const drive = driveApi();
  const folder = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [cfg.driveFolderId],
    },
    fields: 'id, webViewLink',
  });
  const folderId = folder.data.id!;

  const uploads: Array<[string, string]> = [['minutes.md', 'text/markdown']];
  if (cfg.uploadRecording) uploads.push(['recording.webm', 'audio/webm']);
  uploads.push(['transcript.md', 'text/markdown']);

  for (const [file, mime] of uploads) {
    const p = path.join(dir, file);
    if (!fs.existsSync(p)) continue;
    await drive.files.create({
      requestBody: { name: file, parents: [folderId] },
      media: { mimeType: mime, body: fs.createReadStream(p) },
      fields: 'id',
    });
  }
  if (cfg.driveShareAnyone) {
    await drive.permissions.create({
      fileId: folderId,
      requestBody: { role: 'reader', type: 'anyone' },
    });
  }
  const link = folder.data.webViewLink ?? `https://drive.google.com/drive/folders/${folderId}`;
  log('deliver', `Drive にアップロード: ${link}`);
  return link;
}

/** 会議の議事録をメール + Slack で配信する */
export async function deliverMeeting(meetingId: string): Promise<void> {
  const m = getMeeting(meetingId);
  if (!m || !m.dir) return;
  const minutesPath = path.join(m.dir, 'minutes.md');
  if (!fs.existsSync(minutesPath)) return;
  const minutesMd = fs.readFileSync(minutesPath, 'utf8');

  const links: string[] = [];
  if (m.share_url) links.push(`- 共有リンク (録音・議事録): ${m.share_url}`);
  links.push(`- ダッシュボード: ${cfg.publicUrl}/m/${m.id}`);
  const body = `${minutesMd}\n\n---\n${links.join('\n')}`;

  const to = new Set(cfg.mailTo);
  if (cfg.mailAttendees) {
    for (const a of attendeesOf(m)) if (a.email) to.add(a.email);
  }
  const dateStr = new Date(m.start_at).toLocaleDateString('ja-JP', { timeZone: cfg.tz });
  await sendMail([...to], `【議事録】${m.title} (${dateStr})`, body).catch((e) =>
    log('deliver', 'メール送信失敗:', (e as Error).message)
  );

  const biz = findBusiness(m.business);
  const summaryHead = minutesMd.split('## 決定事項')[0].slice(0, 800);
  const slackText = [
    `📝 *議事録: ${m.title}* (${dateStr})${m.business ? ` — 事業: ${m.business}` : ''}`,
    summaryHead,
    m.share_url ? `🔗 ${m.share_url}` : `🔗 ${cfg.publicUrl}/m/${m.id}`,
  ].join('\n');
  await postSlack(slackText, biz?.slack_webhook || undefined).catch((e) =>
    log('deliver', 'Slack 送信失敗:', (e as Error).message)
  );
}

/** 入室失敗をオーナーへ通知する */
export async function notifyFailure(m: MeetingRow, error: string): Promise<void> {
  const msg = `⚠️ 議事録Bot が会議に参加できませんでした\n\n- 会議: ${m.title}\n- 日時: ${m.start_at}\n- 理由: ${error}\n\n待機室で承認されなかった場合は、次回はカレンダーに ${cfg.botEmail || 'Bot アカウント'} を招待しておくとスムーズです。`;
  await sendMail(cfg.mailTo, `【要確認】Bot が会議に参加できませんでした: ${m.title}`, msg).catch(() => {});
  await postSlack(msg).catch(() => {});
}
