import crypto from 'node:crypto';

// 見間違えやすい 0/O/1/I を除いた英数字。LINEで打ってもらう連携コード用。
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/** URLに載せる推測不能なトークン（視聴URL用） */
export function randomToken(bytes = 18) {
  return crypto.randomBytes(bytes).toString('base64url');
}

/** 人が読んで打てる連携コード（既定6桁） */
export function randomCode(len = 6) {
  const buf = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[buf[i] % CODE_ALPHABET.length];
  return out;
}

/** 主キー用の短いID（先頭に種別プレフィックス） */
export function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(9).toString('base64url')}`;
}

/**
 * 連携コード候補の抽出。ユーザーは「予約コード ABC123」のように送ってくるので
 * メッセージ全文から6文字の候補を拾う。紛らわしい文字は両方の解釈を返す。
 */
export function codeCandidates(text, len = 6) {
  const normalized = String(text || '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .toUpperCase();
  const found = new Set();
  for (const m of normalized.matchAll(new RegExp(`[0-9A-Z]{${len}}`, 'g'))) {
    const raw = m[0];
    // 0↔O, 1↔I↔L の打ち間違いを許容して候補を広げる
    for (const variant of expandAmbiguous(raw)) found.add(variant);
  }
  return [...found];
}

function expandAmbiguous(code) {
  let variants = [''];
  for (const ch of code) {
    const options = ch === '0' || ch === 'O' ? ['0', 'O']
      : ch === '1' || ch === 'I' || ch === 'L' ? ['1', 'I', 'L']
      : [ch];
    const next = [];
    for (const v of variants) for (const o of options) next.push(v + o);
    variants = next;
    if (variants.length > 64) return [code]; // 組み合わせ爆発を防ぐ
  }
  return variants;
}

/** 値に署名を付ける（Cookie等）。'値.署名' 形式。 */
export function sign(value, secret) {
  const mac = crypto.createHmac('sha256', secret).update(value).digest('base64url');
  return `${value}.${mac}`;
}

/** 署名付き値の検証。改ざんされていれば null。 */
export function unsign(signed, secret) {
  const s = String(signed || '');
  const idx = s.lastIndexOf('.');
  if (idx < 0) return null;
  const value = s.slice(0, idx);
  const mac = s.slice(idx + 1);
  const expected = crypto.createHmac('sha256', secret).update(value).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return value;
}

/** 文字列の定数時間比較（管理画面のパスワード照合用） */
export function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) {
    // 長さの違いも定数時間側に寄せる（ダミー比較）
    crypto.timingSafeEqual(ba, ba);
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}
