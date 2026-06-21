/* =============================================================
   ANTAI 受給診断エンジン（概算）
   - 公的に定められた計算式に基づく「目安」を算出します。
   - 給付額の増額や受給を保証するものではありません。
   - 実際の支給可否・金額・期間は法律および行政（ハローワーク／
     健康保険組合）の審査により決定されます。
   ============================================================= */
(function () {
  var state = {
    status: null,      // zaishoku / yotei / sumi
    reason: null,      // self / company / health / other
    age: null,         // age band key
    tenure: null,      // tenure band key
    income: null,      // monthly gross (円)
    cannotWork: null   // true/false（傷病手当金の可否ゲート）
  };

  /* ---- 概算計算（簡易・目安） ---- */
  // 基本手当 給付率（賃金日額→ざっくり）。<60歳想定の簡易近似。
  function benefitRate(dailyWage) {
    if (dailyWage <= 5200) return 0.80;
    if (dailyWage <= 8000) return 0.67;
    if (dailyWage <= 12000) return 0.58;
    return 0.50;
  }
  // 所定給付日数（簡易テーブル）
  function jobseekerDays(reason, ageKey, tenureKey) {
    // tenureKey: lt1 / y1_10 / y10_20 / y20
    if (reason === 'self') {
      var selfMap = { lt1: 0, y1_10: 90, y10_20: 120, y20: 150 };
      return selfMap[tenureKey] || 0;
    }
    // company / health（特定受給資格者・特定理由離職者 相当：年齢×期間 簡易）
    var t = { lt1: 90 };
    if (ageKey === 'a20') { t.y1_10 = 120; t.y10_20 = 180; t.y20 = 180; }
    else if (ageKey === 'a30') { t.y1_10 = 150; t.y10_20 = 210; t.y20 = 240; }
    else if (ageKey === 'a35') { t.y1_10 = 180; t.y10_20 = 240; t.y20 = 270; }
    else if (ageKey === 'a45') { t.y1_10 = 180; t.y10_20 = 270; t.y20 = 330; }
    else { t.y1_10 = 150; t.y10_20 = 210; t.y20 = 240; } // a60
    return t[tenureKey] || 90;
  }

  function compute() {
    var income = state.income || 0;
    var dailyWage = income / 30;                 // 賃金日額 概算
    // 失業保険（基本手当）概算
    var rate = benefitRate(dailyWage);
    var basicDaily = Math.min(dailyWage * rate, 8870); // 上限の目安でクリップ
    var days = jobseekerDays(state.reason, state.age, state.tenure);
    var unemployment = Math.round(basicDaily * days);

    // 傷病手当金 概算（体調により就労困難な場合のみ）
    var sickness = 0, sicknessDays = 0;
    if (state.cannotWork) {
      var sickDaily = Math.round(income / 30 * 2 / 3);
      sicknessDays = 30 * 6;                      // 概算表示は6ヶ月分を目安に（最長は通算1年6ヶ月）
      sickness = Math.round(sickDaily * sicknessDays);
    }
    var total = unemployment + sickness;
    return {
      unemployment: unemployment, unemploymentDays: days,
      sickness: sickness, sicknessDays: sicknessDays,
      total: total, basicDaily: Math.round(basicDaily)
    };
  }

  function yen(n) { return n.toLocaleString('ja-JP'); }

  /* ---- 質問定義 ---- */
  var steps = [
    {
      key: 'status', title: '今のご状況に最も近いものは？',
      help: 'まずは大まかな状況を教えてください。',
      options: [
        { v: 'yotei', label: 'これから退職を考えている' },
        { v: 'zaishoku', label: '在職中（休職中も含む）' },
        { v: 'sumi', label: 'すでに退職した' }
      ]
    },
    {
      key: 'reason', title: '退職（予定）の主な理由は？',
      help: '受け取れる制度・給付日数が変わる重要な項目です。',
      options: [
        { v: 'company', label: '会社都合（倒産・解雇・雇止め など）' },
        { v: 'health', label: '体調不良・病気・メンタル不調 など' },
        { v: 'self', label: '自己都合（転職・家庭の事情 など）' },
        { v: 'other', label: 'その他・まだ分からない' }
      ]
    },
    {
      key: 'age', title: '退職時のご年齢は？',
      help: '失業保険の給付日数に影響します。',
      options: [
        { v: 'a20', label: '20代（〜29歳）' },
        { v: 'a30', label: '30〜34歳' },
        { v: 'a35', label: '35〜44歳' },
        { v: 'a45', label: '45〜59歳' },
        { v: 'a60', label: '60〜64歳' }
      ]
    },
    {
      key: 'tenure', title: '雇用保険の加入期間は？',
      help: 'おおよその通算年数で構いません。',
      options: [
        { v: 'lt1', label: '1年未満' },
        { v: 'y1_10', label: '1年以上 〜 10年未満' },
        { v: 'y10_20', label: '10年以上 〜 20年未満' },
        { v: 'y20', label: '20年以上' }
      ]
    },
    {
      key: 'income', title: '退職前の月収（額面）は？',
      help: '賞与を除いた、毎月の額面のおおよその金額を入力してください。',
      input: true
    },
    {
      key: 'cannotWork', title: '体調の影響で、今すぐ働くのが難しい状況ですか？',
      help: '傷病手当金は、医師が「労務不能」と認めた場合に対象となる制度です。事実に基づいてお答えください。',
      options: [
        { v: 'yes', label: 'はい（通院中・療養が必要 など）' },
        { v: 'no', label: 'いいえ（働ける状態）' }
      ]
    }
  ];

  var idx = 0;
  var card = document.getElementById('diagCard');
  var bar = document.getElementById('diagBar');
  if (!card) return;

  function render() {
    var total = steps.length;
    bar.style.width = ((idx) / total * 100) + '%';
    var s = steps[idx];
    var html = '<div class="q-step active">';
    html += '<span class="eyebrow">質問 ' + (idx + 1) + ' / ' + total + '</span>';
    html += '<h2 class="q-title">' + s.title + '</h2>';
    html += '<p class="q-help">' + s.help + '</p>';
    if (s.input) {
      html += '<div class="field"><label>月収（額面・円）</label>'
        + '<div class="input-suffix"><input id="incomeInput" type="number" inputmode="numeric" '
        + 'placeholder="例）280000" value="' + (state.income || '') + '"><span>円</span></div></div>';
      html += '<p class="disclaimer">※ おおよそで構いません。正確な金額が分からない場合は概算で入力してください。</p>';
    } else {
      html += '<div class="opt-grid">';
      s.options.forEach(function (o) {
        var sel = (state[s.key] === o.v || (s.key === 'cannotWork' && state.cannotWork === (o.v === 'yes'))) ? ' selected' : '';
        html += '<button class="opt' + sel + '" data-v="' + o.v + '"><span class="dot"></span><span>' + o.label + '</span></button>';
      });
      html += '</div>';
    }
    html += '<div class="diag-nav">';
    html += idx > 0 ? '<button class="btn btn--ghost" id="backBtn">戻る</button>' : '<span></span>';
    html += s.input ? '<button class="btn btn--accent" id="nextBtn">次へ</button>' : '<span></span>';
    html += '</div></div>';
    card.innerHTML = html;

    card.querySelectorAll('.opt').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var v = btn.getAttribute('data-v');
        if (s.key === 'cannotWork') state.cannotWork = (v === 'yes');
        else state[s.key] = v;
        next();
      });
    });
    var backBtn = document.getElementById('backBtn');
    if (backBtn) backBtn.addEventListener('click', function () { idx = Math.max(0, idx - 1); render(); });
    var nextBtn = document.getElementById('nextBtn');
    if (nextBtn) nextBtn.addEventListener('click', function () {
      var val = parseInt((document.getElementById('incomeInput').value || '').replace(/[^0-9]/g, ''), 10);
      if (!val || val < 30000) { document.getElementById('incomeInput').focus(); return; }
      state.income = val; next();
    });
  }

  function next() {
    // 体調理由でない場合、傷病手当金の質問はスキップ（健康理由のときのみ確認）
    if (idx === steps.length - 1) { showLoading(); return; }
    idx++;
    if (steps[idx].key === 'cannotWork' && state.reason !== 'health') {
      state.cannotWork = false;
      if (idx === steps.length - 1) { showLoading(); return; }
    }
    render();
  }

  function showLoading() {
    bar.style.width = '100%';
    card.innerHTML = '<div class="center" style="padding:40px 0">'
      + '<div class="eyebrow">診断中…</div>'
      + '<h2 class="q-title mt-4">あなたが受け取れる可能性のある<br>制度を計算しています</h2>'
      + '<div style="max-width:360px;margin:28px auto;display:grid;gap:12px">'
      + '<div class="skeleton" style="width:90%"></div><div class="skeleton" style="width:75%"></div>'
      + '<div class="skeleton" style="width:85%"></div></div></div>';
    setTimeout(showResult, 1400);
  }

  function showResult() {
    var r = compute();
    bar.style.width = '100%';
    var html = '<div class="center">'
      + '<span class="eyebrow">診断結果（概算）</span>'
      + '<p class="mt-4" style="color:var(--muted)">あなたが <b>制度上 受け取れる可能性のある</b> 目安は</p>'
      + '<div class="result-amount mt-2">約 ' + yen(r.total) + ' <small>円</small></div>'
      + '<p class="disclaimer mt-2">※ 公的な計算式に基づく概算です。実際の金額ではありません。</p>'
      + '</div>';

    html += '<div class="result-bar mt-6">';
    html += '<div class="rb"><span>失業保険（基本手当）概算</span><b>約 ' + yen(r.unemployment) + ' 円</b></div>';
    html += '<div class="rb" style="font-size:.85rem;color:var(--muted)"><span>　└ 給付日数の目安</span><span>' + r.unemploymentDays + ' 日 ／ 日額 約' + yen(r.basicDaily) + '円</span></div>';
    if (r.sickness > 0) {
      html += '<div class="rb"><span>傷病手当金 概算（6ヶ月分の目安）</span><b>約 ' + yen(r.sickness) + ' 円</b></div>';
      html += '<div class="rb" style="font-size:.85rem;color:var(--muted)"><span>　└ 最長は通算1年6ヶ月</span><span>医師の労務不能の証明が前提</span></div>';
    }
    html += '</div>';

    html += '<div class="note-box mt-6"><strong>必ずお読みください：</strong> 本診断は概算（目安）であり、'
      + '受給を保証するものではありません。給付額・期間は法律で定められており、当サービスが'
      + '<b>増額するものではありません</b>。実際の支給可否は、ハローワーク／健康保険組合の審査により決定されます。'
      + '事実と異なる申請は不正受給にあたり、ご本人の責任となります。</div>';

    html += '<div class="cta-band mt-8" style="border-radius:var(--r-lg);padding:36px 26px">'
      + '<h2 style="font-size:1.5rem">正確な受給可否と「損しない申請プラン」は<br>無料LINE相談で</h2>'
      + '<p>あなたの状況に合わせて、対象となる制度・必要書類・申請の順番を専門スタッフが整理します。'
      + '相談は無料、しつこい勧誘はありません。</p>'
      + '<a class="btn btn--line btn--lg mt-6" data-line href="#">'
      + '<svg class="ico" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3C6.5 3 2 6.6 2 11c0 2.5 1.5 4.7 3.8 6.1-.1.6-.6 2.2-.7 2.6 0 0 0 .3.2.4.2 0 .3 0 .4-.1.3-.2 2.7-1.8 3.7-2.5.8.1 1.7.2 2.6.2 5.5 0 10-3.6 10-8S17.5 3 12 3z"/></svg>'
      + '公式LINEで無料相談する</a>'
      + '<p style="font-size:.78rem;color:#cfe0f0;margin-top:14px">追加した時点で料金は一切発生しません。</p>'
      + '</div>';

    html += '<div class="center mt-6"><button class="btn btn--ghost" id="restartBtn">もう一度診断する</button></div>';

    card.innerHTML = html;
    // CTAのLINE URLを反映
    if (window.ANTAI_CONFIG) {
      card.querySelectorAll('[data-line]').forEach(function (el) { el.href = window.ANTAI_CONFIG.lineUrl; });
    }
    var rb = document.getElementById('restartBtn');
    if (rb) rb.addEventListener('click', function () { idx = 0; state = { status:null,reason:null,age:null,tenure:null,income:null,cannotWork:null }; render(); });
  }

  // 開始
  var startBtn = document.getElementById('startDiag');
  if (startBtn) {
    startBtn.addEventListener('click', function () {
      document.getElementById('diagIntro').style.display = 'none';
      document.getElementById('diagShell').style.display = 'block';
      render();
      document.getElementById('diagShell').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  } else {
    render();
  }
})();
