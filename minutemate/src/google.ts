import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { cfg } from './config.js';
import { log } from './util.js';

const TOKEN_PATH = () => path.join(cfg.dataDir, 'google-token.json');

export const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/drive.file',
];

let client: OAuth2Client | null = null;

export function oauthClient(): OAuth2Client {
  if (client) return client;
  if (!cfg.googleClientId || !cfg.googleClientSecret) {
    throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET が未設定です (.env を確認)');
  }
  client = new google.auth.OAuth2(
    cfg.googleClientId,
    cfg.googleClientSecret,
    `http://localhost:${cfg.oauthPort}/oauth2cb`
  );
  if (fs.existsSync(TOKEN_PATH())) {
    client.setCredentials(JSON.parse(fs.readFileSync(TOKEN_PATH(), 'utf8')));
  }
  client.on('tokens', (tokens) => {
    const prev = fs.existsSync(TOKEN_PATH()) ? JSON.parse(fs.readFileSync(TOKEN_PATH(), 'utf8')) : {};
    fs.mkdirSync(path.dirname(TOKEN_PATH()), { recursive: true });
    fs.writeFileSync(TOKEN_PATH(), JSON.stringify({ ...prev, ...tokens }, null, 2));
  });
  return client;
}

export function hasGoogleAuth(): boolean {
  return fs.existsSync(TOKEN_PATH());
}

export const calendarApi = () => google.calendar({ version: 'v3', auth: oauthClient() });
export const gmailApi = () => google.gmail({ version: 'v1', auth: oauthClient() });
export const driveApi = () => google.drive({ version: 'v3', auth: oauthClient() });

/** `npm run auth` — ブラウザで Google にログインしてトークンを保存する */
export async function runAuthFlow(): Promise<void> {
  const oauth2 = oauthClient();
  const url = oauth2.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES });
  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url || '/', `http://localhost:${cfg.oauthPort}`);
      if (u.pathname !== '/oauth2cb') {
        res.writeHead(404).end();
        return;
      }
      const c = u.searchParams.get('code');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h2>認証完了。このタブは閉じて OK です。</h2>');
      server.close();
      c ? resolve(c) : reject(new Error('認証コードが取得できませんでした'));
    });
    server.listen(cfg.oauthPort, () => {
      console.log('\n以下の URL をブラウザで開いて Google にログインしてください:\n');
      console.log(url + '\n');
    });
  });
  const { tokens } = await oauth2.getToken(code);
  oauth2.setCredentials(tokens);
  fs.mkdirSync(path.dirname(TOKEN_PATH()), { recursive: true });
  fs.writeFileSync(TOKEN_PATH(), JSON.stringify(tokens, null, 2));
  log('auth', `トークンを保存しました: ${TOKEN_PATH()}`);
}

const isMain = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));
if (isMain && process.argv[2] === 'auth') {
  runAuthFlow().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
