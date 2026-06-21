# アンタイ（ANTAI）Webサイト 一式 ／ 引き継ぎ・運用ガイド

社会保険給付金（失業保険・傷病手当金）申請サポート「アンタイ」のWebサイト一式です。
`docs/` 配下に、LP・コーポレートHP・受給診断・ブログ・法務ページをすべて含みます。

## 0. いちばん大事な設計思想
この業界は2025年12月に国民生活センターが注意喚起を出すなど、規制が厳しくなっています。
本サイトは**「誠実・透明・正確」を差別化の核**にしています。具体的には次を**しません**：
- 「給付金を増やせる」等の誤解を招く訴求（景品表示法に抵触しうる）
- 「必ず受給できる」等の受給保証
- 虚偽申請・虚偽診断を促す表現

→ これが結果的に「広告審査を通り」「炎上・行政指導リスクが低く」「大手より信頼される」最短ルートです。
　コピーを編集する際も、この方針を維持してください。

## 1. 公開前に必ず差し替える「実データ」
`docs/assets/js/config.js` の1ファイルで、サイト全体に反映されます。

| 項目 | 場所 | 例 |
|---|---|---|
| 公式LINEのURL | `config.js` の `lineUrl` | `https://lin.ee/xxxxxxx` |
| 着手金・成果報酬 | `config.js` の `pricing` | `11,000円` / `受給額の15%` |
| 特商法・会社情報 | `config.js` の `company.*` | 事業者名・代表者・所在地・電話・メール |
| 公開ドメイン | `config.js` の `baseUrl` | 独自ドメイン接続時に変更 |

> `config.js` を直すと、全ページのLINEボタン・料金・会社情報・特商法表記が自動で更新されます。
> HTML本文中の `【〜を記入】` は、SEO上の理由でHTMLにも直書きしている箇所です（company.html / tokushoho.html / privacy.html）。検索置換でまとめて差し替えてください。

## 2. 公開（デプロイ）方法 — 2通り
### A. GitHub Actions（推奨・自動）
1. リポジトリ **Settings > Pages > Build and deployment > Source** を **「GitHub Actions」** に設定
2. `docs/` に変更を push すると `.github/workflows/pages.yml` が自動デプロイ
3. 公開URL: `https://maco23plas.github.io/zmk-config/`

### B. ブランチから直接（簡単）
1. **Settings > Pages > Source: Deploy from a branch**
2. Branch: このブランチ（または main）/ フォルダ: **`/docs`**
3. 同じく `https://maco23plas.github.io/zmk-config/` で公開

### 独自ドメインを使う場合
- `docs/CNAME` に独自ドメイン（例 `antai.jp`）を1行で記載
- DNSで CNAME を `maco23plas.github.io` に向ける
- `config.js` の `baseUrl` と、各HTMLの `canonical` / `og:url` / `sitemap.xml` を新ドメインに置換
  （※サブパスが無くなるので、独自ドメイン化のほうがSEO上もすっきりします）

## 3. ファイル構成
```
docs/
├─ index.html          ① LP（サービスページ・非広告用）
├─ company.html        ② コーポレートHP（アンタイ）
├─ shindan.html        ④ 受給診断 → 公式LINE 遷移
├─ tokushoho.html      特定商取引法に基づく表記
├─ privacy.html        プライバシーポリシー
├─ 404.html / sitemap.xml / robots.txt / .nojekyll
├─ blog/               ③ ブログ（SEO記事）
│   ├─ index.html      記事一覧
│   └─ *.html          各記事
└─ assets/
    ├─ css/styles.css  デザインシステム
    ├─ js/config.js    ★中央設定（ここを編集）
    ├─ js/main.js      共通UI
    ├─ js/shindan.js   受給診断ロジック（公的計算式ベースの概算）
    └─ img/            ロゴ・OGP
```

## 4. ブログ運用（SEO）
- 記事は `docs/blog/` に1ファイル1記事。既存記事をテンプレとして複製し、本文・meta・slugを変更すればOK。
- 追加したら `docs/blog/index.html` のカード一覧と `docs/sitemap.xml` に1行追記してください。
- **SEOの現実**：新規ドメインで「10日でトップ」は誰にも保証できません（保証する業者は要注意）。
  競合が弱いロングテール語句（例「特定理由離職者 該当」「傷病手当金 退職後 継続給付」など）から
  記事を厚くし、内部リンクで診断/LPへ送客する設計にしています。公開後はGoogle Search Consoleに
  サイトマップを登録してください。

## 5. 受給診断について（重要）
`shindan.js` は公的な計算式に基づく**概算（目安）**を表示し、増額・受給保証は一切うたいません。
計算はブラウザ内で完結し、入力値はサーバーに送信されません。料率・上限などの定数は法改正時に
`shindan.js` 内の `benefitRate()` / `jobseekerDays()` / 上限値を更新してください。

## 6. 意図的に「不採用」にした表現（コンプラ判断・再追加しないこと）
社内提供の料金画像にあった次の2要素は、運営判断で**あえて掲載していません**。"消し忘れ"ではありません。
- **「受給総額 411万円／200万円（月収30万の場合）」**：いくらもらえるかを断定的に見せる表示は、景品表示法（優良誤認・有利誤認）および国民生活センターが最重要視する論点。411万・200万は"最大ケース"で平均ではないため、誤認・返金トラブルの火種になります。代わりに「あなたの目安は無料の受給診断で」へ誘導しています。
- **「当日契約限定価格」**：契約を急がせる表現は特商法・消費者契約法の観点でリスクがあり、サイトの「煽らない」約束と矛盾するため不使用。価格は通常価格として提示しています。

## 7. 公開前の最終チェックリスト
- [ ] `config.js` の `company.tel`／`company.email` を実値に（**特商法上ほぼ必須**・未受領）
- [ ] GitHub Settings > Pages を有効化（Actions または /docs ブランチ）
- [ ] 公式LINE（`lin.ee/tyGZJqhE`）の遷移を実機で確認
- [ ] Google Search Console にサイトマップ登録

