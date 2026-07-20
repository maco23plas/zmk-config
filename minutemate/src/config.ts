import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

const bool = (v: string | undefined, d = false) =>
  v === undefined || v === '' ? d : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
const num = (v: string | undefined, d: number) => (v ? Number(v) : d);
const list = (v: string | undefined, d: string[] = []) =>
  v ? v.split(',').map((s) => s.trim()).filter(Boolean) : d;

export const cfg = {
  tz: process.env.TZ || 'Asia/Tokyo',
  dataDir: path.resolve(process.env.DATA_DIR || 'data'),

  // Google OAuth
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  oauthPort: num(process.env.OAUTH_PORT, 8790),
  calendarIds: list(process.env.CALENDAR_IDS, ['primary']),

  // Bot
  botName: process.env.BOT_NAME || 'AI秘書',
  botEmail: process.env.BOT_EMAIL || '',
  autoInviteBot: bool(process.env.AUTO_INVITE_BOT, true),
  joinMode: (process.env.JOIN_MODE || 'all') as 'all' | 'off',
  excludeTitleRegex: process.env.EXCLUDE_TITLE_REGEX || '',
  joinLeadMin: num(process.env.JOIN_LEAD_MIN, 2),
  admitTimeoutMin: num(process.env.ADMIT_TIMEOUT_MIN, 12),
  maxMeetingMin: num(process.env.MAX_MEETING_MIN, 180),
  headless: bool(process.env.HEADLESS, false),
  // 空なら Playwright 同梱の Chromium。手元の Chrome を使う場合はパスを指定
  chromiumPath: process.env.CHROMIUM_PATH || '',
  chatAnnounce:
    process.env.CHAT_ANNOUNCE ||
    'こんにちは、議事録Botです。この会議を録音し、終了後に議事録を参加者へ共有します。',

  // STT
  sttProvider: (process.env.STT_PROVIDER || 'groq') as 'groq' | 'local',
  groqApiKey: process.env.GROQ_API_KEY || '',
  whisperModel: process.env.WHISPER_MODEL || 'small',

  // LLM
  llmProvider: (process.env.LLM_PROVIDER || 'gemini') as 'gemini' | 'groq' | 'anthropic' | 'ollama',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
  groqModel: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',
  ollamaUrl: process.env.OLLAMA_URL || 'http://localhost:11434',
  ollamaModel: process.env.OLLAMA_MODEL || 'qwen2.5:14b',

  // Delivery
  mailTo: list(process.env.MAIL_TO),
  mailAttendees: bool(process.env.MAIL_ATTENDEES, false),
  slackWebhook: process.env.SLACK_WEBHOOK_URL || '',
  driveFolderId: process.env.DRIVE_FOLDER_ID || '',
  driveShareAnyone: bool(process.env.DRIVE_SHARE_ANYONE, true),
  uploadRecording: bool(process.env.UPLOAD_RECORDING, true),

  // Secretary
  briefLeadMin: num(process.env.BRIEF_LEAD_MIN, 60),
  weeklyReportCron: process.env.WEEKLY_REPORT_CRON || '0 8 * * 1',

  // Web
  webPort: num(process.env.WEB_PORT, 8788),
  webPassword: process.env.WEB_PASSWORD || '',
  publicUrl: process.env.PUBLIC_URL || `http://localhost:${num(process.env.WEB_PORT, 8788)}`,
};

export function ensureDirs() {
  for (const d of ['meetings', 'businesses', 'debug', 'tmp']) {
    fs.mkdirSync(path.join(cfg.dataDir, d), { recursive: true });
  }
}
