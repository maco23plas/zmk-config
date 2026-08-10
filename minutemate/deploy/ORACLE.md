# Oracle Cloud Always Free で MinuteMate を24時間動かす

自分のPCを常時つけられなくても、Oracle Cloud の **Always Free**（恒久無料・クレカ登録のみ、
Always Free 枠内なら課金されない）の仮想マシンで動かせる。所要 30〜40分。

> 全体の流れ: **VM を作る → 自分のPCで Bot をログイン → プロファイルを VM に送る →
> スクリプト1本で起動**。手を動かすのは主に「一度だけのログイン」だけ。

---

## 1. VM を作る

1. https://www.oracle.com/cloud/free/ でアカウント作成（リージョンは自分に近い所、例: 日本-東京）
2. コンソール → **Compute → Instances → Create instance**
   - Image: **Ubuntu 22.04**
   - Shape: **Ampere A1 (ARM)** を選び、**OCPU 2 / メモリ 12GB** 程度（Always Free 枠内）
     - ※ Ampere が「容量不足」で作れない時は、リージョンを変えるか時間をおいて再試行
   - **SSH キー**: 「Save private key」で秘密鍵をダウンロード（後で SSH に使う）
3. 作成後、インスタンスの **Public IP アドレス** を控える

## 2. ポート 8788 を開ける（ダッシュボード用）

Oracle は2段階でファイアウォールがある。**両方**開ける:

1. **クラウド側**: コンソール → インスタンスの **VCN → Subnet → Security List →
   Add Ingress Rules**
   - Source CIDR: `0.0.0.0/0`（自分のIPだけに絞るとより安全）
   - IP Protocol: TCP / Destination Port: `8788`
2. **VM側**: 後述のセットアップスクリプトが `ufw` / iptables を自動で開ける

> ⚠️ 公開ダッシュボードなので、`.env` の `WEB_PASSWORD` は**必ず設定**すること。

## 3. 自分のPCで Bot をログインさせる（一度だけ・GUIが要る手順）

VM にはブラウザ画面が無いので、ログインだけは手元のPC（Mac/Windows、Node.js 20+）でやる:

```bash
git clone <このリポジトリ> && cd zmk-config/minutemate
npm install && npx playwright install chromium
npm run auth        # あなたの Google にログイン → data/google-token.json 生成
npm run bot:login   # 開くブラウザで Bot 用 Google と Zoom にログインして閉じる
```

これで `data/google-token.json` と `data/browser-profile/`（Zoom/Google のログイン状態）が
できる。この2つを VM に送る:

```bash
scp -i <秘密鍵> -r data ubuntu@<VMのIP>:~/minutemate-data
```

## 4. VM 側でセットアップ

```bash
ssh -i <秘密鍵> ubuntu@<VMのIP>

# リポジトリを取得
git clone <このリポジトリ> && cd zmk-config/minutemate

# 3 で送ったログイン情報を配置
cp -r ~/minutemate-data/* data/ 2>/dev/null || mkdir -p data && cp -r ~/minutemate-data/* data/

# 設定
cp .env.example .env
nano .env   # GEMINI_API_KEY / GROQ_API_KEY / MAIL_TO / WEB_PASSWORD を記入
            # (GOOGLE_TOKEN_JSON は空でOK。data/google-token.json を使う)

# 事業を登録 (任意だが推奨)
nano businesses.yaml

# 起動 (Docker導入 → ポート開放 → 診断 → 起動 まで自動)
bash deploy/vps-setup.sh
```

`vps-setup.sh` は最後に **doctor（プリフライト診断）** を走らせ、すべて ✅ なら本番起動する。
❌ が出たらメッセージに従って直し、`bash deploy/vps-setup.sh up` で再起動。

## 5. 確認

- ブラウザで `http://<VMのIP>:8788` を開く（`WEB_PASSWORD` で Basic 認証）
- カレンダーに Zoom 会議があれば、開始時刻に Bot が自動入室して録音・議事録化する
- すぐ試すなら、ダッシュボードの「🎙️ 録音をアップロード」で手持ちの録音から議事録を作れる

---

## 運用メモ

- **更新**: `git pull && bash deploy/vps-setup.sh up`
- **ログ**: `docker compose logs -f`
- **診断だけ**: `bash deploy/vps-setup.sh doctor`
- **待機室のある社外Zoom**: Bot が入室リクエストするので一度だけ「許可」を押す（設計上、
  待機室は突破しない）。自分主催の会議は待機室オフ or Bot を共同ホストにすると全自動。
- **ログインが切れたら**: 3 をやり直して `data/browser-profile` を送り直す
  （別IPからの再ログインで Zoom/Google が本人確認を挟むことがある）。
- **無料枠**: Ampere A1 は Always Free 枠内なら恒久無料。録画データが増えたら
  `data/` の古い録音を消す（議事録の Markdown は軽い）。
