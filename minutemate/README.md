# MinuteMate — 無料で動く全自動ミーティング秘書

Zoom / Google Meet の会議に**自動入室して録音**し、**議事録・タスク・次回アジェンダ(NA)** を生成、
**事業ごとのフォルダに自動整理**して**共有リンク発行・メール/Slack配信**、さらに
**週次進捗レポート**と**次回会議の事前ブリーフ**まで届ける「打ち合わせの秘書」。

**すべて無料枠で動きます。** 有料のボットAPI・文字起こしAPIは使いません。

| 機能 | 使うもの | 費用 |
|---|---|---|
| 会議の検知 | Google Calendar API | 無料 |
| 自動入室・録音 | Playwright + Chromium (内製ボット) | 無料 (自前PC/サーバー) |
| 文字起こし | Groq 無料枠 (Whisper) or faster-whisper (ローカル) | 無料 |
| 議事録・タスク・NA・分類・進捗 | Gemini 無料枠 (Claude/Groq/Ollama にも切替可) | 無料 |
| 保存・共有リンク | Google Drive (15GB 無料枠) | 無料 |
| 通知 | Gmail API / Slack Incoming Webhook | 無料 |

## 仕組み

```
Google カレンダー ──(2分毎に同期)──> 会議検知 + Bot アカウントを予定に自動招待
        │
        └─> 開始2分前: Playwright ボットが Meet/Zoom に自動入室 (チャットで録音を告知)
                │  WebRTC の音声をブラウザ内でミックスして録音 (webm/opus)
                └─> 会議終了を検知して退出
                        │
                        └─> 文字起こし (話者推定つき) → LLM で議事録/タスク/NA 生成
                                │
                                ├─> 事業を自動分類 → data/businesses/<事業名>/ に整理
                                ├─> Google Drive にアップ → 共有リンク発行
                                ├─> メール + Slack に議事録を自動配信
                                ├─> (次回会議の1時間前) 事前ブリーフを自動配信
                                └─> (毎週月曜) 事業ごとの週次進捗レポートを自動配信
```

> **常時起動できるマシンが無い場合** → [DEPLOY.md](./DEPLOY.md) を参照。
> GitHub Actions の無料枠だけで動かすワークフロー (`.github/workflows/minutemate.yml`) を同梱している。
> 15分おきにカレンダーをチェックし、会議が近ければ Actions のランナー上でそのまま入室・録音・議事録化する。

## セットアップ (30分)

### 0. 必要なもの

- Node.js 20 以上
- 常時起動できるマシン (自宅PC / 無料枠VPS など)。**無い場合は GitHub Actions 運用 → [DEPLOY.md](./DEPLOY.md)**
- Bot 専用の Google アカウント (無料 Gmail でOK) ← 会議に「議事録Bot」として入室する人格 (Actions 運用では不要)

### 1. インストール

```bash
cd minutemate
npm install
npx playwright install chromium
cp .env.example .env
```

### 2. 無料APIキーを2つ取得して .env に記入

- **Gemini**: https://aistudio.google.com/apikey → `GEMINI_API_KEY`
- **Groq** (文字起こし用): https://console.groq.com/keys → `GROQ_API_KEY`
  - Groq を使いたくない場合は `STT_PROVIDER=local` + `pip install faster-whisper` で完全ローカル文字起こしも可

### 3. Google Cloud で OAuth クライアント作成 (無料)

1. https://console.cloud.google.com/ → 新規プロジェクト
2. 「APIとサービス」→ 以下を有効化: **Google Calendar API / Gmail API / Google Drive API**
3. 「認証情報」→ OAuth クライアント ID (種類: ウェブアプリケーション)
   - リダイレクト URI: `http://localhost:8790/oauth2cb`
4. クライアント ID / シークレットを `.env` に記入
5. 認証を実行 (**あなたの** Google アカウント = カレンダーを読む・メールを送る側):

```bash
npm run auth
```

### 4. Bot アカウントでブラウザにログイン (初回のみ)

```bash
npm run bot:login
```

開いたブラウザで **Bot 専用 Google アカウント** (`.env` の `BOT_EMAIL`) にログインして閉じる。
`AUTO_INVITE_BOT=true` なら、検知した予定にこのアカウントが自動招待されるので、
Meet に**ノック(参加リクエスト)なしで入室**できるようになる。

### 5. 事業を登録

`businesses.yaml` を編集して事業(プロジェクト)を登録。キーワードや関係者メールを書くほど自動分類が正確になる。

### 6. 起動

```bash
npm run dev        # 開発
# 本番 (ビルドして起動)
npm run build && npm start
# GUI の無いサーバーでは:
xvfb-run -a npm start
```

ダッシュボード: http://localhost:8788

### 動作テスト (カレンダー連携なしで試せる)

```bash
npm run bot -- --url https://meet.google.com/xxx-xxxx-xxx --title "テスト会議"
```

## 運用のヒント

- **入室が承認待ちで止まる** → 会議のカレンダー予定に Bot アカウントを招待しておく (`AUTO_INVITE_BOT=true` なら自動)。社外主催の Zoom は待機室で承認が必要なことが多い。
- **サーバー常駐** → `xvfb-run -a npm start` を systemd や pm2 に載せる。1会議 = Chromium 1プロセスなのでメモリは 1会議あたり ~500MB 見ておく。
- **録音の同意** → Bot は入室時に名前とチャットで録音を明示する。対外的な会議では事前に一言伝えるのがマナー (設定: `CHAT_ANNOUNCE`)。
- **失敗時** → `data/debug/` に失敗時のスクリーンショットが残る。ダッシュボードの会議ページから「議事録を再生成」も可能。

## 既知の制約 (無料構成のトレードオフ)

- **録音は音声のみ** (映像なし)。ブラウザ内で WebRTC 音声をミックスして録るため、画面録画用の仮想ディスプレイや ffmpeg が不要になり、どこでも動く。映像が必要になったら設計書 (design/meeting-secretary) の内製ボット構成に拡張する。
- **話者分離はベストエフォート**。Meet の画面から「誰が話しているか」をサンプリングして推定する方式のため、Meet の UI 変更で精度が落ちることがある。落ちても文字起こし・議事録自体は動く。
- **Meet の突発会議 (カレンダー予定なし) は自動検知できない** (Google API の仕様)。`npm run bot -- --url ...` で手動参加するか、予定を作る運用でカバー。
- **Meet / Zoom の画面 (DOM) は変わることがある**。ボタンが見つからなくなったら `data/debug/` のスクリーンショットを見て `src/bot/meet.ts` / `zoom.ts` のセレクタを直す。セレクタは全部このファイルに集めてある。
- 無料枠のレート制限: Gemini 無料枠は 1日あたりのリクエスト数に上限がある。1会議あたり LLM 呼び出しは 1〜3 回なので通常運用では十分収まる。

## ディレクトリ構成

```
minutemate/
├─ businesses.yaml        # 事業の定義 (フォルダ分け・分類・レポートの単位)
├─ src/
│  ├─ index.ts            # メイン: スケジューラ + Web
│  ├─ watcher.ts          # カレンダー同期・会議検知・Bot自動招待
│  ├─ bot/                # 自動入室ボット (Meet / Zoom / 録音エンジン)
│  ├─ pipeline.ts         # 文字起こし→分類→議事録→整理→共有→配信
│  ├─ secretary.ts        # 事前ブリーフ・週次進捗レポート
│  ├─ deliver.ts          # Gmail / Slack / Drive
│  └─ web.ts              # ダッシュボード
└─ data/                  # (自動生成) 録音・議事録・DB。businesses/<事業名>/ に整理される
```
