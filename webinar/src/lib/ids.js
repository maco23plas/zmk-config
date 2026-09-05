// 予約コードの読み取り（純粋関数）。乱数・署名まわりは lib/crypto.js にある。

/**
 * メッセージ本文から予約コードの候補を抽出する。
 * 「予約コード ABC123」のように文章込みで送られてくるため全文から拾い、
 * 全角や 0/O・1/I の打ち間違いも候補に含める。
 */
export function codeCandidates(text, len = 6) {
  const normalized = String(text || '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .toUpperCase();
  const found = new Set();
  for (const m of normalized.matchAll(new RegExp(`[0-9A-Z]{${len}}`, 'g'))) {
    for (const variant of expandAmbiguous(m[0])) found.add(variant);
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
