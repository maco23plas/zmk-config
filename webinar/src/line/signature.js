import crypto from 'node:crypto';

/**
 * LINE Webhook の署名検証。
 * 本文の生バイト列を チャネルシークレットで HMAC-SHA256 → Base64 したものが
 * x-line-signature ヘッダと一致するかを、タイミング安全に比較する。
 * （検証を通さないと、誰でも「予約が連携された」偽リクエストを送れてしまう）
 */
export function verifySignature(rawBody, signatureHeader, channelSecret) {
  if (!channelSecret || !signatureHeader) return false;
  const expected = crypto.createHmac('sha256', channelSecret).update(rawBody).digest('base64');
  const a = Buffer.from(String(signatureHeader));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** テストやローカル検証で署名付きリクエストを作るための補助 */
export function signBody(rawBody, channelSecret) {
  return crypto.createHmac('sha256', channelSecret).update(rawBody).digest('base64');
}
