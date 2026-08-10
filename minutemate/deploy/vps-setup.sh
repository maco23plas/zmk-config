#!/usr/bin/env bash
# MinuteMate を Ubuntu VPS (Oracle Cloud Always Free 等) にワンショットで立ち上げる。
# 使い方 (VM に SSH 後、リポジトリの minutemate/ 内で):
#   bash deploy/vps-setup.sh          # Docker 導入 → ポート開放 → doctor → 起動
#   bash deploy/vps-setup.sh doctor   # 診断だけ実行
#   bash deploy/vps-setup.sh up       # 起動だけ (再デプロイ)
set -euo pipefail

cd "$(dirname "$0")/.."   # minutemate/ へ
PORT=8788

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }

ensure_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    log "Docker は導入済み"
    return
  fi
  log "Docker をインストールします"
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER" || true
  log "Docker 導入完了 (グループ反映のため、以降 sudo で実行します)"
}

dc() { # docker compose を sudo 有無どちらでも動かす
  if docker compose version >/dev/null 2>&1; then docker compose "$@"; else sudo docker compose "$@"; fi
}

open_firewall() {
  if command -v ufw >/dev/null 2>&1 && sudo ufw status 2>/dev/null | grep -q "Status: active"; then
    log "ufw でポート ${PORT} を開放"
    sudo ufw allow "${PORT}"/tcp || true
  fi
  # Oracle Linux/Ubuntu の iptables を使う環境向け (存在すれば)
  if command -v netfilter-persistent >/dev/null 2>&1; then
    sudo iptables -I INPUT -p tcp --dport "${PORT}" -j ACCEPT || true
    sudo netfilter-persistent save || true
  fi
  echo "※ Oracle Cloud はこれとは別に、コンソールの VCN > セキュリティリスト で"
  echo "   TCP ${PORT} の受信ルールを追加する必要があります (ORACLE.md 参照)。"
}

check_env() {
  if [ ! -f .env ]; then
    log ".env がありません。テンプレートからコピーします"
    cp .env.example .env
    echo "!! .env を編集して GEMINI_API_KEY / GROQ_API_KEY / MAIL_TO / WEB_PASSWORD"
    echo "   (と GOOGLE_TOKEN_JSON か data/google-token.json) を設定してください。"
    echo "   編集後にもう一度このスクリプトを実行してください。"
    exit 1
  fi
}

case "${1:-all}" in
  doctor)
    check_env; ensure_docker
    dc run --rm minutemate npm run doctor
    ;;
  up)
    check_env; ensure_docker
    dc up -d --build
    log "起動しました → http://$(curl -fsS ifconfig.me 2>/dev/null || echo '<サーバーIP>'):${PORT}"
    ;;
  all|*)
    check_env
    ensure_docker
    open_firewall
    log "プリフライト診断"
    dc run --rm minutemate npm run doctor || {
      echo "❌ doctor で致命的な問題が出ました。上記を直してから 'bash deploy/vps-setup.sh up' を実行してください。"
      exit 1
    }
    log "本番起動"
    dc up -d --build
    log "完了 → http://$(curl -fsS ifconfig.me 2>/dev/null || echo '<サーバーIP>'):${PORT}"
    ;;
esac
