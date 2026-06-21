# OneAI — LibreChat(雲端大腦對話介面)+ 打包 mcp-core(stdio MCP)。
# 第二步:把「大腦/記憶/審核/換腦」差異化能力以 stdio MCP 掛進 LibreChat。
#
# 重要:本映像的 build context = repo 根目錄(在 repo 根執行 deploy,
#       並以服務變數 ZBPACK_DOCKERFILE_PATH=infra/zeabur/librechat/Dockerfile 指定本檔)。
#       根目錄 .zeaburignore / .dockerignore 已排除 brain/、node_modules、apps 等大目錄。
FROM ghcr.io/danny-avila/librechat:latest

# 安裝/打包需 root 權限寫入 /app/oneai;裝完不另切 user(個人用,官方映像本就以預設 user 跑)。
USER root

# 結構需保留:bridge/mcp-core/src/server.js 以 ../../../scripts 解析 oneaiModels.mjs,
# 故 scripts/ 與 config/ 必須與 bridge/ 同掛在 /app/oneai 之下。
WORKDIR /app/oneai

# 先只 COPY package.json 安裝依賴(@modelcontextprotocol/sdk、zod),善用 layer cache。
COPY bridge/mcp-core/package.json ./bridge/mcp-core/package.json
RUN cd bridge/mcp-core && npm install --omit=dev --no-audit --no-fund

# 再放原始碼與模型登錄表(改 code 不必重裝依賴)。
COPY bridge/mcp-core/src ./bridge/mcp-core/src
COPY scripts/oneaiModels.mjs ./scripts/oneaiModels.mjs
COPY config/oneai.models.json ./config/oneai.models.json

# 掛入 OneAI 的 LibreChat 設定(OpenRouter 自訂端點 + mcpServers 指向上面的 mcp-core)。
COPY infra/zeabur/librechat/librechat.yaml /app/librechat.yaml
ENV CONFIG_PATH=/app/librechat.yaml

# 還原工作目錄給官方 entrypoint。
WORKDIR /app
