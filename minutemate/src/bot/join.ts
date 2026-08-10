/** 会議1件への参加〜後処理までの共通ロジック (CLI と GitHub Actions ランナーの両方から使う) */
import fs from 'node:fs';
import path from 'node:path';
import { cfg } from '../config.js';
import { getMeeting, setMeetingStatus, updateMeeting } from '../db.js';
import { log } from '../util.js';
import { joinMeet } from './meet.js';
import { joinZoom } from './zoom.js';

export type JoinOutcome = 'delivered' | 'ended' | 'failed';

export async function joinMeetingById(
  meetingId: string,
  opts: { pipeline?: boolean } = {}
): Promise<JoinOutcome> {
  const meeting = getMeeting(meetingId);
  if (!meeting || !meeting.url) throw new Error(`会議が見つかりません: ${meetingId}`);

  const dir = meeting.dir || path.join(cfg.dataDir, 'meetings', meeting.id);
  fs.mkdirSync(dir, { recursive: true });
  updateMeeting(meeting.id, { dir, status: 'joining' });

  const joiner = meeting.provider === 'zoom' ? joinZoom : joinMeet;
  setMeetingStatus(meeting.id, 'recording');
  const result = await joiner(meeting, dir);

  const recording = path.join(dir, 'recording.webm');
  const hasAudio = fs.existsSync(recording) && fs.statSync(recording).size > 10_000;

  fs.writeFileSync(
    path.join(dir, 'meta.json'),
    JSON.stringify(
      {
        meetingId: meeting.id,
        title: meeting.title,
        startAt: meeting.start_at,
        recStartedAt: result.recStartedAt ?? null,
        endedAt: result.endedAt ?? null,
        participants: result.participants,
        error: result.error ?? null,
      },
      null,
      2
    )
  );

  if (!result.ok && !hasAudio) {
    setMeetingStatus(meeting.id, 'failed', result.error);
    log('bot', `参加失敗: ${meeting.title} — ${result.error}`);
    try {
      const { notifyFailure } = await import('../deliver.js');
      await notifyFailure(meeting, result.error ?? '不明なエラー');
    } catch {
      /* ignore */
    }
    return 'failed';
  }

  setMeetingStatus(meeting.id, 'ended');
  log('bot', `録音完了: ${meeting.title} (${hasAudio ? fs.statSync(recording).size : 0} bytes)`);

  if (opts.pipeline !== false) {
    const { runPipeline } = await import('../pipeline.js');
    await runPipeline(meeting.id);
    const after = getMeeting(meeting.id);
    return after?.status === 'delivered' ? 'delivered' : 'ended';
  }
  return 'ended';
}
