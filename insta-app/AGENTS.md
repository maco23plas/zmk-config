# インスタ分析思考 2026 — 開発ガイド（Codex / AIエージェント向け）

Instagram運用のKPI分析Webアプリ。**ビルド不要で動く単一HTML**（外部通信はMeta Graph APIのみ、データはブラウザのlocalStorage）。
公開URL: https://maco23plas.github.io/zmk-config/insta/

## 最重要：読むファイルを絞る（クレジット節約）
- **`../docs/insta/index.html` は自動生成物（約130KB）。絶対に開かない・編集しない。** 編集は `src/` だけ。
- 下の「どこを触る？」表で該当ファイル1つだけ読む。全ファイルを読む必要はない。
- 挙動の調査は `grep -n 'data-act="xxx"' src/js/90-render-events.js` のように検索してから該当行だけ読む。

## コマンド（このディレクトリ `insta-app/` で実行）
```
npm install      # 初回のみ（playwright-core のみ。Chromiumが無ければ CHROME_PATH=... を指定）
npm run build    # src/ → ../docs/insta/index.html を生成
npm test         # build + E2E（Graph APIはモック。全18項目合格が完了条件）
npm run check    # 生成物が src/ と一致するか確認
```
**src/ を変更したら必ず `npm test` を通してからコミット。生成物（docs/insta/index.html）も一緒にコミットする。**

## どこを触る？
| やりたいこと | ファイル（`src/js/`） |
|---|---|
| 見た目・色・レイアウト | `../styles.css`（CSS変数でライト/ダーク両対応） |
| 診断フロー等の文章データ | `../data/insta_data.json`（依頼がない限り変更しない） |
| localStorageの保存形式・アカウント | `20-storage.js` |
| レート計算・勝ち負け判定・数値表示 | `30-calc-format-meta.js` |
| グラフ（SVG） | `40-charts.js` |
| Instagram Graph API呼び出し | `50-graph-api.js` |
| 「取り込む」の変換ロジック | `55-import.js` |
| ルーティング・ナビ・トースト | `60-router-ui.js` |
| 連携/取り込み/手動追加のモーダル | `65-modals.js` |
| 画面：ホーム・ウィザード / 週次 / 投稿 / 診断 / KPI辞典 / 設定 | `70`〜`75-view-*.js` |
| CSV・JSONバックアップ・サンプルデータ | `80-export-seed.js` |
| ボタン等のクリック処理（`data-act`） | `90-render-events.js` |
| 起動処理 | `99-boot.js` |

## コーディング規約
- **ES5スタイル（`var`・関数式）／ES modules禁止。** `src/js/*.js` はファイル名順に連結されて1つのIIFEに入る（グローバル共有）。新ファイルは番号プレフィックスで順序を決める。
- 外部ライブラリ・CDN・Webフォントは使わない（オフラインで動くことが売り）。
- 画面はHTML文字列で組み立て、操作は `data-act="..."` ＋ `90-render-events.js` のイベント委譲。**ユーザー入力を埋め込むときは必ず `esc()`。**
- 数値は `tnum` クラス（等幅数字）、レートは `pct()`（小数1桁%）、未入力・分母0は「—」（`ratio()` が null を返す）。
- データは**アカウント別キー**（`insta-analytics-2026:d:<accountId>:weekly|posts|checks`）。アカウントを跨いで混ぜない。
- **アクセストークンをconsoleやUIに出さない**。保存先は localStorage の `insta-analytics-2026:api` のみ。
- 色は `styles.css` の `:root` 変数を使い、ライト/ダーク両方を壊さない（`data-theme` が `prefers-color-scheme` に優先）。
- 日本語UI。ボタン文言は「何が起きるか」を書く（例:「先週ぶんを取り込む」）。

## テストの追加
`tests/e2e.mjs` に `check("名前", 条件)` を足す。新機能・バグ修正には対応するチェックを1つ以上足す。
Graph APIは冒頭の `route` モックで返す（実トークン不要）。

## 触らない
- `../config/`, `../build.yaml`, `../.github/` … ZMKキーボード設定
- `../docs/` のうち `insta/` 以外 … 別事業(ANTAI)の公開サイト
- `../insta-analytics/` … 旧v1（Next.js版）。保守対象外、参照不要
- `../instagram-auto/` … Google Apps Script（シート自動取得）。別物

## デプロイ
GitHub Pages は **main ブランチからのみ**公開される。`docs/insta/index.html` を含む変更を main にマージすると自動で `/insta/` に反映。
