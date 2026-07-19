# 常時マシンなしで運用する (デプロイガイド)

自分のPCを24時間つけておけない場合の選択肢は2つ。**まずは A (GitHub Actions) で始めて、
会議量が増えたら B (無料VPS) に移すのがおすすめ。**

| | A. GitHub Actions (完全サーバーレス) | B. 無料VPS + Docker |
|---|---|---|
| 費用 | 無料枠 2,000分/月 (プライベートリポジトリ) | 無料 (Oracle Always Free) |
| セットアップ | Secrets を登録するだけ | VPS 契約 + docker compose up |
| 会議の検知 | 15分おき (cron の性質上、数分遅れることあり) | 2分おき・常駐 |
| Bot の入室 | ゲスト参加 → 主催者が「許可」を押す | Bot アカウントでログイン済み → 招待されていれば自動入室 |
| 向き | まず試す / 会議が週数回 | 毎日会議がある / 完全自動化したい |

---

## A. GitHub Actions で動かす

ワークフローは `.github/workflows/minutemate.yml` に用意済み。
**schedule はデフォルトブランチのワークフローしか動かないので、まず PR をマージすること。**

### 1. Secrets を登録する

リポジトリの Settings → Secrets and variables → Actions → New repository secret:

| Secret | 内容 | 取得元 |
|---|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | OAuth クライアント | Google Cloud Console (README 手順3) |
| `GOOGLE_TOKEN_JSON` | あなたの Google トークン (1行JSON) | `npm run auth` 実行後に表示される |
| `GEMINI_API_KEY` | 議事録生成用 | https://aistudio.google.com/apikey |
| `GROQ_API_KEY` | 文字起こし用 | https://console.groq.com/keys |
| `MAIL_TO` | 議事録の送り先メール | 自分のメールアドレス |
| `STATE_KEY` | **【必須】** 議事録・DB を暗号化して保存する鍵 | 任意の長いパスフレーズを自分で決める (一度決めたら変えない) |
| `SLACK_WEBHOOK_URL` | (任意) Slack 通知 | Slack App の Incoming Webhook |
| `DRIVE_FOLDER_ID` | (任意) 録音・議事録の保存先 | Drive でフォルダを作り URL 末尾の ID |

> ⚠️ **このリポジトリは公開 (GitHub Pages で ANTAI サイトを配信) のため、`STATE_KEY` は必須です。**
> 状態 (会議DB・議事録) は `STATE_KEY` で AES-256-GCM 暗号化してから `minutemate-state`
> ブランチに保存されるので、鍵が無い限り第三者は中身を読めません。`STATE_KEY` を設定せずに
> 実行するとワークフローは平文コミットを防ぐため停止します。鍵は紛失・変更すると過去の状態を
> 復号できなくなるので、パスワードマネージャ等に控えておくこと。

`npm run auth` は一度だけどこかの PC で実行が必要 (Node.js を入れて5分)。
PC が無い場合は、Claude Code のクラウドセッションでも実行できる —— 表示された URL を
スマホで開いて承認し、失敗したリダイレクト先 URL (`http://localhost:8790/oauth2cb?code=...`)
をターミナルに貼り付ければトークンが表示される。

### 2. 動きの確認

- Actions タブ → `MinuteMate Bot` → `Run workflow` に会議 URL を入れて手動実行すると、その場で入室テストできる
- 以降は自動: 15分おき (JST 8:00〜23:00) にカレンダーをチェックし、20分以内に始まる会議があればそのランナーが開始まで待って入室する

### 3. 運用上の注意

- **Bot は毎回「ゲスト」として参加リクエストする** (ランナーにはログイン情報を置かないため)。
  会議に入ったら「議事録Bot（録音中）が参加をリクエストしています」→ **許可を押すだけ**。tl.dv と同じ運用。
- **無料枠の計算**: 検知チェックは1回 ≈ 1分。15分間隔 × 15時間 ≈ 月 1,800分でほぼ無料枠いっぱい。
  会議への参加時間もランナー稼働時間として加算されるので、**会議が月10時間を超えるようなら
  チェック間隔を `*/30` に広げる (yml の cron を編集) か、B の無料VPSへ移行**する。
- 録音 (音声) は成果物 (artifact, 7日保持) と Drive に保存される。
- 会議DB・議事録・タスク台帳は `STATE_KEY` で**暗号化された1ファイル (`mm-state/state.enc`)** として
  `minutemate-state` ブランチに蓄積され、次回実行時に復号して引き継がれる。これにより
  タスクの持ち越し追跡・週次レポート・事前ブリーフが実行をまたいで機能する (週次: 月曜 8:00 JST)。
  公開リポジトリでも平文の議事録が残らない。

---

## B. 無料 VPS + Docker で動かす

Oracle Cloud Always Free (ARM 4コア/24GB まで無料・クレカ登録のみ) や、余った実家のPCなど。

```bash
git clone <このリポジトリ>
cd zmk-config/minutemate
cp .env.example .env   # 必要な値を記入
docker compose up -d --build
```

初回のみコンテナ外で `npm run auth`(あなたのGoogle認証) と `npm run bot:login`(Botアカウント) を実行し、
生成された `data/google-token.json` とブラウザプロファイルがボリュームに載っていることを確認する。

- ダッシュボード: `http://<サーバーIP>:8788` (`.env` の `WEB_PASSWORD` を必ず設定)
- こちらのモードでは常駐スケジューラが2分おきに監視し、Bot アカウントが招待されていれば
  承認なしで自動入室する (完全自動)。

---

## よくある質問

**Q. 完全に無料でどこまでいける?**
GitHub Actions 案は追加契約ゼロで動く。上限は Actions 無料枠 (2,000分/月)。
VPS 案は Oracle の Always Free 枠なら恒久無料 (登録にクレカは必要だが課金されない)。

**Q. Zoom は?**
Zoom はゲスト参加 (Web クライアント) で入る。待機室がある場合はホストの許可が必要。

**Q. 予定にない突発会議は?**
Actions タブから `Run workflow` に URL を入れる (スマホからでも実行可能)。
