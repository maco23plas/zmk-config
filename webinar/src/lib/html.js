// HTML生成。タグ付きテンプレート `h` は埋め込み値を自動エスケープする。
// エスケープ済みのHTMLを差し込みたい場合だけ raw() で包む。

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[&<>"']/g, (c) => ESC[c]);
}

class Raw {
  constructor(value) { this.value = value; }
  toString() { return this.value; }
}

export const raw = (value) => new Raw(value ?? '');
export const isRaw = (v) => v instanceof Raw;

function render(value) {
  if (value === null || value === undefined || value === false) return '';
  if (isRaw(value)) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  return escapeHtml(value);
}

/** h`<p>${untrusted}</p>` — 埋め込みは自動エスケープされる */
export function h(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1];
  return raw(out);
}

/** <script>に安全にJSONを埋め込む（</script> や U+2028 を無害化） */
export function jsonScript(data) {
  return raw(JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029'));
}

/** 属性値として安全なURLだけ通す（javascript: 等を弾く） */
export function safeUrl(url) {
  const s = String(url || '').trim();
  if (!s) return '';
  if (/^(https?:|mailto:|tel:|\/|#|\?)/i.test(s)) return s;
  return '';
}

/** 改行を <br> にした上でエスケープ */
export function nl2br(v) {
  return raw(escapeHtml(v).replace(/\r?\n/g, '<br>'));
}
