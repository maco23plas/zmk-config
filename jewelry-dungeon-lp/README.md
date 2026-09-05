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
任意の静的ホスティングにそのまま配置できます。

### サブパス配下で配信する場合

`https://<account>.github.io/<repo>/` のようにサブパス配下に置くときは、ビルド時に環境変数を指定します。

```bash
NEXT_PUBLIC_BASE_PATH=/<repo> npm run build
```

画像パスは `src/lib/asset.ts` の `asset()` を通しているので、この変数だけで全体が切り替わります。

### GitHub Pages で公開する手順

1. 元データ用リポジトリ `maco23plas/jewelry-dungeon-lp` を開き、「Use this template」→「Create a new repository」で
   公開用アカウントにコピーを作る（Public にする）。作成直後にワークフローが走り、自動でビルド・公開されます。
   ※ 元データ用リポジトリ（maco23plas 配下）ではワークフローは動かず、サイトは公開されません。
2. 以後、元データ側の更新を取り込むときは、コピー側でファイルを差し替えて `main` に push すると再公開されます。
3. コピー先リポジトリの Settings > Pages > Build and deployment > Source を **GitHub Actions** にする（初回のみ・必須）。
   初回のワークフローはこの設定前に走って失敗するので、設定後に Actions で「Re-run all jobs」を押す。
4. 公開URL: `https://<account>.github.io/<repo>/`。
   リポジトリ名を `<account>.github.io` にすると `https://<account>.github.io/` で公開されます。
5. 独自ドメインを使う場合は Settings > Pages の Custom domain に設定し、
   Settings > Secrets and variables > Actions > Variables に `PAGES_ROOT` = `true` を追加してください
   （サブパスなしでビルドされます）。

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
- 公式LINEのURLは `src/lib/site.ts` の `LINE_URL` で一元管理しています（3箇所すべてで使用）。
