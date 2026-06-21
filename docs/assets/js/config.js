/* =============================================================
   ANTAI サイト 中央設定ファイル（ここだけ編集すれば全ページ反映）
   運営：合同会社HUG ／ サービスブランド：アンタイ（ANTAI）
   ============================================================= */
window.ANTAI_CONFIG = {
  /* ブランド */
  brandJa: "アンタイ",
  brandEn: "ANTAI",
  tagline: "退職後の生活を、安泰に。",

  /* 公式LINE（CTAの遷移先） */
  lineUrl: "https://lin.ee/tyGZJqhE",

  /* 公開ドメイン（独自ドメイン接続時にここを変更） */
  baseUrl: "https://maco23plas.github.io/zmk-config",

  /* 連絡先・特商法（運営：合同会社HUG） */
  company: {
    legalName:      "合同会社HUG",
    representative: "土方 誠",
    address:        "東京都港区北青山一丁目3番1号 アールキューブ青山3階",
    tel:            "070-9053-4022",
    email:          "info@support-hugllc.com",
    established:    "2024年3月",
    registration:  ""
  },

  /* 料金（定額・3プラン） */
  pricing: {
    model:    "tiered",
    prepay:   "45万円（税込）",
    postpay:  "55万円（税込・着手金5万円＋残額50万円）",
    unemploymentOnly: "33万円（税込）",
    refund:   "申請が通らなかった場合は全額返金保証",
    note:     "ご相談・受給診断は無料。最終金額は契約前に書面で明示します。"
  }
};

/* CTAリンク・連絡先をページ全体へ反映 */
(function () {
  function apply() {
    var c = window.ANTAI_CONFIG;
    document.querySelectorAll('[data-line]').forEach(function (el) {
      el.setAttribute('href', c.lineUrl);
      if (c.lineUrl === '#') { el.setAttribute('data-line-placeholder', 'true'); }
    });
    document.querySelectorAll('[data-cfg]').forEach(function (el) {
      var path = el.getAttribute('data-cfg').split('.');
      var v = c; path.forEach(function (k) { v = v ? v[k] : v; });
      if (v != null && v !== '') el.textContent = v;
    });
  }
  if (document.readyState !== 'loading') apply();
  else document.addEventListener('DOMContentLoaded', apply);
})();
