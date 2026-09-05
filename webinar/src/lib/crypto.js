// Node と Cloudflare Workers の両方で動く暗号ユーティリティ。
// node:crypto は Workers に無いため、Web Crypto API（両環境にある）だけを使う。

const encoder = new TextEncoder();

const B64URL = (bytes) => btoa(String.fromCharCode(...bytes))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const B64 = (bytes) => btoa(String.fromCharCode(...bytes));

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

/** HMAC-SHA256 → Base64（LINEの署名検証で使う形式） */
export async function hmacSha256Base64(secret, data) {
  const key = await hmacKey(secret);
  const body = typeof data === 'string' ? encoder.encode(data) : data;
  return B64(new Uint8Array(await crypto.subtle.sign('HMAC', key, body)));
}

/** HMAC-SHA256 → Base64URL（Cookie署名で使う形式） */
export async function hmacSha256Base64Url(secret, data) {
  const key = await hmacKey(secret);
  return B64URL(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(data))));
}

/**
 * 定数時間の文字列比較。
 * 先に長さで抜けると、比較にかかる時間から正解の長さが漏れる可能性があるため、
 * 長さの違いも含めて最後まで走らせる。
 */
export function timingSafeEqual(a, b) {
  const x = encoder.encode(String(a ?? ''));
  const y = encoder.encode(String(b ?? ''));
  let diff = x.length ^ y.length;
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** URLに載せる推測不能なトークン */
export function randomToken(bytes = 18) {
  return B64URL(crypto.getRandomValues(new Uint8Array(bytes)));
}

// 見間違えやすい 0/O/1/I を除いた英数字。LINEで打ってもらう連携コード用。
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/** 人が読んで打てる連携コード */
export function randomCode(len = 6) {
  const buf = crypto.getRandomValues(new Uint8Array(len));
  let out = '';
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[buf[i] % CODE_ALPHABET.length];
  return out;
}

/** 主キー用の短いID */
export function newId(prefix) {
  return `${prefix}_${randomToken(9)}`;
}

/** 決定的なハッシュから 0..1 の値を作る（視聴者数の推移カーブ用） */
export async function seededUnit(input) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(String(input))));
  const n = (digest[0] << 24 | digest[1] << 16 | digest[2] << 8 | digest[3]) >>> 0;
  return n / 0xffffffff;
}

/** 値に署名を付ける（Cookie等）。'値.署名' 形式。 */
export async function sign(value, secret) {
  return `${value}.${await hmacSha256Base64Url(secret, value)}`;
}

/** 署名付き値の検証。改ざんされていれば null。 */
export async function unsign(signed, secret) {
  const s = String(signed || '');
  const idx = s.lastIndexOf('.');
  if (idx < 0) return null;
  const value = s.slice(0, idx);
  const expected = await hmacSha256Base64Url(secret, value);
  return timingSafeEqual(s.slice(idx + 1), expected) ? value : null;
}
