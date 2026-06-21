# 審核服務 — Zeabur 部署用 (build context = services/approval)
# Tier 0 護欄:刻意保持極少依賴(express + web-push)以求最高穩定。
FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src

ENV APPROVAL_PORT=8080
# 審核狀態持久化:此路徑需掛 Zeabur 持久卷,否則重啟掉待審/決定
ENV APPROVAL_DATA_FILE=/app/data/approval.json
RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 8080

# 健康檢查:Zeabur 會注入 PORT;cloud 綁 $PORT、本機退回 8080(busybox wget)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT:-8080}/health || exit 1

CMD ["node", "src/server.js"]
