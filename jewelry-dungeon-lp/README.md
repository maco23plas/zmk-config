# ジュエリーダンジョン LP（jewelry-dungeon-lp）

デジタル商品「オーブ」を会員同士（P2P）で売買するサービス「ジュエリーダンジョン」のランディングページです。
`design_handoff_jewelry_dungeon_lp/README.md` の仕様と `screenshots/` の見た目をもとに、
Next.js（App Router / TypeScript）+ CSS Modules で静的LPとして実装しています。

## セットアップ

```bash
cd jewelry-dungeon-lp
npm install
npm run dev        # http://localhost:3000
npm run build      # 静的書き出し → out/
npm run lint
npm run typecheck
```

`next.config.ts` で `output: "export"` を指定しているため、`npm run build` で `out/` に静的ファイルが生成されます。
任意の静的ホスティング（GitHub Pages など）にそのまま配置できます。サブパス配下に置く場合は
`next.config.ts` に `basePath` / `assetPrefix` を追加してください。

## 構成

```
src/
├─ app/
│  ├─ layout.tsx          … メタ情報・Google Fonts（Noto Sans JP / Noto Serif JP をセルフホスト）
│  ├─ page.tsx            … セクションの並び（FV → … → FREE SESSION → フッター）
│  ├─ page.module.css     … main の下部余白（固定CTAバー分）
│  └─ globals.css         … デザイントークン（色・グラデ・影・フォント）と共通スタイル
├─ components/
│  ├─ ui/
│  │  ├─ ui-context.tsx   … 状態管理（menuOpen / modal / submitted / scrolled）+ Esc・スクロールロック
│  │  ├─ section.tsx      … セクション共通ラッパー（余白・コンテナ幅）とラベル + h2 + リード
│  │  ├─ cta-button.tsx   … 申込モーダルを開く主CTA
│  │  └─ line-link.tsx    … 公式LINEリンク（新規タブ）
│  ├─ layout/             … 固定ヘッダー / ドロワー / 下部固定CTAバー / フッター
│  ├─ modal/              … モーダル（申込フォーム / 送信完了 / 公式LINE案内）
│  └─ sections/           … 01 HERO 〜 15 FREE SESSION の各セクション（*.tsx + *.module.css）
└─ lib/
   ├─ site.ts             … サイト名・公式LINE URL・meta
   ├─ content.ts          … ナビ / オーブ / ステップ / FAQ などの構造化コピー
   ├─ seminar-form.ts     … フォーム送信処理（送信先未定のため空実装 + TODO）
   └─ cx.ts               … クラス名結合ユーティリティ
public/
├─ assets/                … FV画像・PRICING図版
└─ parts/                 … オーブ・人物・アプリ画面などのパーツ画像
```

## レスポンシブ方針

モバイルファースト。ブレークポイントは 600px（TB）/ 1024px（PC）の3段階です。

| BP | 幅 | コンテナ | セクション余白 | h2 |
|---|---|---|---|---|
| SP | ≤ 599px | `min(480px, 100%)` | `34px 14px` | 23px |
| TB | 600–1023px | `min(720px, 100%)` | `52px 20px` | 28px |
| PC | ≥ 1024px | `1120px`（FAQ 1000px / FV 560px） | `76px 18px` | 38px |

SP のタイプスケール: h2 23px / カード見出し 14px / 本文 11px / 注記 9px。
グリッドは `repeat(N, minmax(0, 1fr))`、子要素に `min-width: 0`、固定 px 幅は使用していません。

## 公開前に必要な作業

- **フォーム送信先の接続**: `src/lib/seminar-form.ts` の `submitSeminarForm` が空実装です（TODO コメント参照）。
  接続後は `src/components/modal/seminar-modal.tsx` の `onSubmit` でエラー表示を追加してください。
- **09 RISK の文言確定**: `src/lib/content.ts` の `riskItems` と `src/components/sections/risk.tsx` の
  注記（【要確認】）を、正規のリスク告知と照合して差し替えてください。
- 公式LINEのURLは `src/lib/site.ts` の `LINE_URL` で一元管理しています（3箇所すべてで使用）。
