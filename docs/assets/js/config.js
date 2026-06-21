/* =============================================================
   ANTAI サイト 中央設定ファイル（ここだけ編集すれば全ページ反映）
   -------------------------------------------------------------
   ▼ 実データに差し替えてください（現在はプレースホルダー）
   ============================================================= */
window.ANTAI_CONFIG = {
  /* ブランド */
  brandJa: "アンタイ",
  brandEn: "ANTAI",
  tagline: "退職後の生活を、安泰に。",

  /* 公式LINE（CTAの遷移先）★最優先で差し替え */
  lineUrl: "#",            // 例: "https://lin.ee/xxxxxxx"

  /* 公開ドメイン（独自ドメイン接続時にここを変更） */
  baseUrl: "https://maco23plas.github.io/zmk-config",

  /* 連絡先・特商法（各ページにも直書きしていますが、ここでも一元管理） */
  company: {
    legalName:      "【事業者名を記入】",
    representative: "【代表者名を記入】",
    address:        "【所在地を記入】",
    tel:            "【電話番号を記入】",
    email:          "【メールアドレスを記入】",
    established:    "",                 // 例: "2024年4月"
    registration:  ""                  // 任意（許認可・登録番号等）
  },

  /* 料金（ハイブリッド型：着手金＋成果報酬）★金額/率を差し替え */
  pricing: {
    type: "hybrid",
    setupFee:     "【着手金 ◯◯,◯◯◯円】",   // 例: "11,000円（税込）"
    successRate:  "【受給額の◯◯％】",        // 例: "受給額の15％"
    refund:       "全額返金保証",            // 受給に至らなかった場合の返金有無（実態に合わせて）
    note:         "成功報酬は実際に受給が確定した後のお支払いです。"
  }
};

/* CTAリンク・連絡先をページ全体へ反映（SEO本文はHTML側に直書き済み） */
(function () {
  function apply() {
    var c = window.ANTAI_CONFIG;
    // すべての [data-line] に公式LINEのURLを設定
    document.querySelectorAll('[data-line]').forEach(function (el) {
      el.setAttribute('href', c.lineUrl);
      if (c.lineUrl === '#') { el.setAttribute('data-line-placeholder', 'true'); }
    });
    // テキスト差し込み（[data-cfg="company.tel"] のように指定）
    document.querySelectorAll('[data-cfg]').forEach(function (el) {
      var path = el.getAttribute('data-cfg').split('.');
      var v = c; path.forEach(function (k) { v = v ? v[k] : v; });
      if (v != null && v !== '') el.textContent = v;
    });
  }
  if (document.readyState !== 'loading') apply();
  else document.addEventListener('DOMContentLoaded', apply);
})();
