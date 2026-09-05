import { page } from './layout.js';
import { h, nl2br } from '../lib/html.js';
import { company, privacy } from '../content/legal.js';

/** 【要記入】が残っている値は、公開前に気づけるよう画面上でも目立たせる */
function value(text) {
  const s = String(text ?? '');
  return s.includes('【要記入】')
    ? h`<span class="todo">${s}</span>`
    : h`${s}`;
}

const hasPlaceholder = (rows) => rows.some(([, v]) => String(v).includes('【要記入】'));

export function companyPage() {
  return page({
    title: `${company.title} | ${company.rows[0][1].replace('【要記入】', '')}`,
    body: h`
      <main><div class="wrap">
        <h1 class="lp-h2" style="text-align:left">${company.title}</h1>
        <p class="muted">${company.lead}</p>

        ${hasPlaceholder(company.rows) ? h`
          <div class="alert alert-warn">
            この内容はひな形です。公開前に <span class="mono">src/content/legal.js</span> の
            <b>【要記入】</b> をすべて差し替えてください。
          </div>` : ''}

        <div class="card">
          <dl class="legal-dl">
            ${company.rows.map(([k, v]) => h`<dt>${k}</dt><dd>${value(v)}</dd>`)}
          </dl>
        </div>

        <div class="card">
          <h2 style="font-size:1.05rem">${company.tokushoho.title}</h2>
          <p class="muted" style="font-size:.86rem">${company.tokushoho.lead}</p>
          <dl class="legal-dl">
            ${company.tokushoho.rows.map(([k, v]) => h`<dt>${k}</dt><dd>${value(v)}</dd>`)}
          </dl>
        </div>

        <div class="lp-notes">
          ${company.notes.map((n) => h`<p>${n}</p>`)}
        </div>

        <p style="margin-top:24px"><a class="btn btn-ghost" href="/">開催日程に戻る</a></p>
      </div></main>`,
  });
}

export function privacyPage() {
  return page({
    title: privacy.title,
    body: h`
      <main><div class="wrap">
        <h1 class="lp-h2" style="text-align:left">${privacy.title}</h1>
        <p class="muted">${privacy.lead}</p>

        <div class="card">
          ${privacy.sections.map((s) => h`
            <section class="legal-section">
              <h2>${s.title}</h2>
              <p>${nl2br(s.body)}</p>
            </section>`)}
          <p class="muted" style="font-size:.86rem;margin:20px 0 0">
            ${value(privacy.contact)}<br>
            最終更新：${value(privacy.updatedAt)}
          </p>
        </div>

        <p style="margin-top:24px"><a class="btn btn-ghost" href="/">開催日程に戻る</a></p>
      </div></main>`,
  });
}
