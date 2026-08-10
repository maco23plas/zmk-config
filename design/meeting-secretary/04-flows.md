# 04. 主要フロー（シーケンス）

## 1. 会議検知 → 入室予約（予定ベース）

```mermaid
sequenceDiagram
    participant GCal as Google Calendar
    participant API as API サーバー
    participant DB as PostgreSQL
    participant T as Temporal

    GCal->>API: push 通知 (watch channel)
    API->>GCal: 増分同期 (syncToken)
    GCal-->>API: 変更イベント一覧
    API->>API: 会議URL抽出 (Meet conferenceData / Zoom URL 正規表現)
    API->>DB: calendar_events / meetings を upsert
    API->>API: join_policies 評価（参加すべきか？）
    alt 参加対象
        API->>T: MeetingWorkflow 起動/更新<br/>(開始5分前タイマー付き)
        T-->>DB: meetings.status = scheduled
    else ポリシー除外
        API->>DB: meetings.status = skipped (join_decision=policy_skipped)
    end
    Note over API,T: 予定の時刻変更・削除も同じ経路で<br/>Workflow へシグナルして再スケジュール/キャンセル
```

**突発会議（予定なし）**: Zoom は `meeting.started` Webhook で同様に MeetingWorkflow を即時起動する。Google Meet の突発会議は API では検知できないため、フォールバックとして (a) 会議 URL の手動貼り付け、(b) ボット用メールアドレスの招待、を用意する（01 の F-05）。

## 2. 入室 → 録画 → 終了（MeetingWorkflow 前半）

```mermaid
sequenceDiagram
    participant T as Temporal<br/>MeetingWorkflow
    participant Bot as BotProvider<br/>(Recall.ai)
    participant Meet as Meet / Zoom
    participant API as API
    participant U as ホスト (Slack/メール)

    T->>T: 開始5分前まで sleep
    T->>Bot: create_bot(会議URL, 表示名「議事録Bot」)
    Bot->>Meet: 入室試行
    alt 待機室あり
        Meet-->>Bot: waiting_room
        Bot-->>API: webhook: status=waiting_room
        API-->>T: シグナル
        T->>T: 3分タイマー
        opt タイムアウト
            T->>U: 「Botが待機室で承認待ちです」通知
            T->>T: さらに10分待って未承認なら failed(not_admitted)
        end
    end
    Meet-->>Bot: 入室許可
    Bot->>Meet: チャットに録画告知を投稿
    Bot-->>API: webhook: recording 開始
    API-->>T: シグナル → meetings.status = recording
    Note over Bot,Meet: 録画中: アクティブスピーカー/入退室イベントを随時記録
    Meet-->>Bot: 会議終了 (参加者0 or 退出)
    Bot-->>API: webhook: done + 録画取得URL
    API-->>T: シグナル → 後処理フェーズへ
```

## 3. 後処理 → 配信（MeetingWorkflow 後半）

```mermaid
sequenceDiagram
    participant T as Temporal
    participant W as ワーカー群
    participant S3 as S3/CloudFront
    participant AI as Deepgram / Claude
    participant DB as PostgreSQL
    participant Out as Slack / メール / Drive

    T->>W: 録画ダウンロード → S3 保存 (raw)
    T->>W: transcode (mp4 + HLS + mp3)
    W->>S3: 保存
    T->>W: STT (mp3, diarization, カスタム辞書)
    W->>AI: Deepgram
    AI-->>W: セグメント (話者/タイムスタンプ付き)
    W->>DB: transcripts / segments 保存 + 話者名マッピング
    T->>W: LLM パイプライン (05 参照)
    W->>AI: Claude: 議事録/タスク/NA/事業分類
    W->>DB: minutes / tasks / meetings.business_id 保存
    T->>W: share_link 発行
    T->>Out: Slack投稿 (事業チャンネル) + 参加者メール
    T->>Out: Drive エクスポート (事業フォルダ)
    T->>DB: meetings.status = delivered
    Note over T: 各ステップは自動リトライ。<br/>STT/LLM 失敗時は「録画のみ先に共有」に劣化して配信
```

## 4. 事業進捗レポート（週次バッチ）

```mermaid
sequenceDiagram
    participant Cron as スケジューラ (Temporal Schedule)
    participant W as ワーカー
    participant DB as PostgreSQL
    participant AI as Claude
    participant Slack as Slack/メール

    Cron->>W: 事業ごとに ReportWorkflow 起動 (週次)
    W->>DB: 期間内の議事録 structured + タスク遷移 + 前回レポートを取得
    W->>AI: 進捗レポート生成<br/>(今週の動き/決定/進捗/リスク/来週)
    AI-->>W: content_md
    W->>DB: progress_reports 保存
    W->>Slack: 事業チャンネル + オーナーへ配信
```

## 5. 次回会議の事前ブリーフ（NA の配信）

```mermaid
sequenceDiagram
    participant T as MeetingWorkflow (次回会議)
    participant DB as PostgreSQL
    participant AI as Claude
    participant Out as 参加者 (メール/Slack)

    Note over T: 次回会議の1時間前
    T->>DB: 同一事業の前回議事録 (next_agenda) +<br/>未完了タスク + 持ち越し事項を取得
    T->>AI: 事前ブリーフ生成
    AI-->>T: 前回の決定 / 宿題の状況 / 今回のアジェンダ案
    T->>Out: 参加者へ配信
```

## 6. 失敗モードと対応（運用設計）

| 失敗 | 検知 | 自動対応 | エスカレーション |
|---|---|---|---|
| 待機室で承認されない | webhook + タイマー | 3分でホスト通知、13分で断念 | 会議ページに「未録画」表示 + 理由 |
| ボットが強制退出させられた | webhook | それまでの録画で後処理続行 | 部分録画である旨を議事録に明記 |
| 会議URLが無効/変更 | 入室エラー | カレンダー再同期 → 新URLで1回リトライ | ホスト通知 |
| STT 失敗 | ワーカー例外 | プロバイダ切替 (Deepgram→Whisper) で再試行 | 録画のみ先に配信、後追いで議事録 |
| LLM 出力がスキーマ不一致 | Zod 検証 | tool use 強制 + 2回リトライ | 議事録なし配信 + 内部アラート |
| 二重入室（同一会議に2ボット） | meetings 一意制約 (conference_url + 時間帯) | Workflow の冪等キーで防止 | — |
| Webhook 欠落 | Workflow 側のポーリング型タイムアウト | Bot 状態を能動取得 | — |
