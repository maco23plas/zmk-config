# 無料 VPS (Oracle Cloud Always Free 等) で常駐させる場合のイメージ。
# Playwright 公式イメージに Chromium・xvfb・全依存が入っている。
FROM mcr.microsoft.com/playwright:v1.61.1-jammy

# ffmpeg: アップロードされた大きい録音を STT 用に圧縮するのに使う
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

ENV HEADLESS=false
# root で動くコンテナでは Chromium に --no-sandbox が必要
ENV BROWSER_NO_SANDBOX=1
# データ (録音・議事録・DB・ブラウザプロファイル) は /app/data に永続化する
VOLUME /app/data

CMD ["xvfb-run", "-a", "node", "dist/index.js"]
