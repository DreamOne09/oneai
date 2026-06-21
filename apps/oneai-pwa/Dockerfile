# OneAI PWA — 多階段建置後以 nginx 提供靜態檔 (build context = apps/oneai-pwa)
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
# 建置時帶入前端環境變數 (Zeabur build args / env)
ARG VITE_NTFY_BASE_URL
ARG VITE_APPROVAL_BASE_URL
ARG VITE_APPROVAL_TOKEN
ARG VITE_LIBRECHAT_BASE_URL
ARG VITE_VAPID_PUBLIC_KEY
ARG VITE_NTFY_TOPIC_NOTIFY
ARG VITE_NTFY_TOPIC_APPROVALS
RUN npm run build

FROM nginx:alpine
# 放到 templates/,官方 entrypoint 會用 envsubst 把 ${PORT} 代入後輸出到 conf.d/。
# (entrypoint 只替換「已定義的環境變數」,故 nginx 內建的 $uri 不受影響。)
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
# 本機/無注入時的 fallback 埠;Zeabur 部署時會以注入的 PORT 覆寫。
ENV PORT=80
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
