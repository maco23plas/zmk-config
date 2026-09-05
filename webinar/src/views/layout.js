import { h } from '../lib/html.js';
import { config } from '../config.js';

/**
 * ページの外枠。
 * @param {object} o
 * @param {string} o.title          <title>
 * @param {*}      o.body           本文（h`` の結果）
 * @param {string} [o.bodyClass]
 * @param {boolean}[o.noindex]      検索避け（予約ページ・視聴ページ）
 * @param {*}      [o.head]         追加の <head> 要素
 * @param {*}      [o.header]       独自ヘッダー（省略時は共通ヘッダー）
 * @param {boolean}[o.footer]
 */
export function page({ title, body, bodyClass = '', noindex = false, head = '', header = null, footer = true, brandHref = '/' }) {
  const defaultHeader = h`
    <header class="site-head">
      <div class="wrap-wide">
        <a class="brand" href="${brandHref}">オンライン説明会<span>アンタイ</span></a>
      </div>
    </header>`;

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeTitle(title)}</title>
${noindex ? '<meta name="robots" content="noindex,nofollow">' : ''}
<meta name="format-detection" content="telephone=no">
<link rel="stylesheet" href="/static/app.css?v=1">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%2310B981'/%3E%3Cpath d='M12 10l10 6-10 6z' fill='white'/%3E%3C/svg%3E">
${String(head || '')}
</head>
<body class="${escapeTitle(bodyClass)}">
${header === null ? defaultHeader : String(header || '')}
${String(body)}
${footer ? footerHtml() : ''}
</body>
</html>`;
}

function footerHtml() {
  return String(h`
    <footer class="site-foot">
      <div class="wrap-wide">
        運営：合同会社HUG（アンタイ）　
        <a href="${config.baseUrl}/">開催日程</a>
      </div>
    </footer>`);
}

const escapeTitle = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** 共通のエラーページ */
export function errorPage(status, message, detail = '') {
  return page({
    title: `${status} | オンライン説明会`,
    noindex: true,
    body: h`
      <main><div class="wrap">
        <div class="card">
          <h1>${message}</h1>
          ${detail ? h`<p class="muted">${detail}</p>` : ''}
          <p><a class="btn btn-ghost" href="/">開催日程を見る</a></p>
        </div>
      </div></main>`,
  });
}

