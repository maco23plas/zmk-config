import { hmacSha256Base64, timingSafeEqual } from '../lib/crypto.js';

/**
 * LINE Webhook の署名検証。
 * 本文の生バイト列をチャネルシークレットで HMAC-SHA256 → Base64 したものが
 * x-line-signature ヘッダと一致するかを、タイミング安全に比較する。
 * （検証を通さないと、誰でも「予約が連携された」偽リクエストを送れてしまう）
 */
export async function verifySignature(rawBody, signatureHeader, channelSecret) {
  if (!channelSecret || !signatureHeader) return false;
  const expected = await hmacSha256Base64(channelSecret, rawBody);
  return timingSafeEqual(signatureHeader, expected);
}

/** テストやローカル検証で署名付きリクエストを作るための補助 */
export const signBody = (rawBody, channelSecret) => hmacSha256Base64(channelSecret, rawBody);
