# 依存パッケージなし。Node.js の同梱機能（node:sqlite / node:http）だけで動く。
FROM node:22-alpine

WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public

# データベースと動画は永続ボリュームに置く
RUN mkdir -p /app/data /app/media
VOLUME ["/app/data", "/app/media"]

ENV NODE_ENV=production PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]
