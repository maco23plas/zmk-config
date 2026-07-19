#!/bin/bash
# MinuteMate を Mac で起動する。Finder でこのファイルを「ダブルクリック」するだけ。
# 初回は自動で準備 → APIキーの記入をお願い → もう一度ダブルクリックで起動。
cd "$(dirname "$0")" || exit 1

say() { printf '\n\033[1;36m%s\033[0m\n' "$*"; }
warn() { printf '\n\033[1;33m%s\033[0m\n' "$*"; }

say "MinuteMate を準備しています…"

# 1) Node.js があるか
if ! command -v node >/dev/null 2>&1; then
  warn "Node.js が入っていません。"
  echo "  ブラウザで https://nodejs.org を開くので、左側の「LTS」ボタンから"
  echo "  ダウンロードしたファイルをダブルクリックして入れてください。"
  echo "  入れ終わったら、この start-mac.command をもう一度ダブルクリックしてください。"
  open "https://nodejs.org/ja/download" 2>/dev/null || true
  echo ""
  read -r -p "エンターキーで閉じます… " _
  exit 0
fi

# 2) 設定ファイル（.env）— 無ければ作って、キーの記入をお願いする
if [ ! -f .env ]; then
  cp .env.example .env
fi
missing_keys() {
  ! grep -qE '^GEMINI_API_KEY=.+' .env || ! grep -qE '^GROQ_API_KEY=.+' .env
}
if missing_keys; then
  warn "無料のAPIキーを2つ入れてください（1回だけ）。"
  echo "  1. Gemini（議事録づくり用・無料）: https://aistudio.google.com/apikey"
  echo "  2. Groq （文字起こし用・無料）    : https://console.groq.com/keys"
  echo ""
  echo "  いま開くテキストエディタで、次の2行に貼り付けて保存してください:"
  echo "      GEMINI_API_KEY=（Geminiのキー）"
  echo "      GROQ_API_KEY=（Groqのキー）"
  echo "  保存したら、この start-mac.command をもう一度ダブルクリックしてください。"
  open "https://aistudio.google.com/apikey" 2>/dev/null || true
  open "https://console.groq.com/keys" 2>/dev/null || true
  open -e .env 2>/dev/null || true
  echo ""
  read -r -p "エンターキーで閉じます… " _
  exit 0
fi

# 3) 依存の用意（初回のみ時間がかかる）
if [ ! -d node_modules ]; then
  say "初回の準備をしています（数分かかります）…"
  npm install || { warn "準備に失敗しました。もう一度お試しください。"; read -r -p "エンター… " _; exit 1; }
fi
if [ ! -d dist ]; then
  npm run build || { warn "ビルドに失敗しました。"; read -r -p "エンター… " _; exit 1; }
fi

# 4) 長い録音の圧縮に使う ffmpeg（あれば快適・無くても短い録音は動く）
if ! command -v ffmpeg >/dev/null 2>&1; then
  warn "（任意）長い録音を扱うなら ffmpeg があると安心です。ターミナルに詳しければ 'brew install ffmpeg'。"
fi

say "起動します。ブラウザで http://localhost:8788 を開きます。"
say "終わるときは、この黒い画面で Control + C を押してください。"
( sleep 2; open "http://localhost:8788" ) &
exec npm start
