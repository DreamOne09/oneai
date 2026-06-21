# infra/zeabur — 部署指南

Zeabur 不支援 docker-compose，**每個服務各自部署**（Git 子目錄或 Docker 映像）。完整背景見 `docs/03-cloud-librechat-zeabur.md`。

## 服務清單

| 服務 | 來源 | 對外 | 穩定度 | 持久卷 | 必填 env |
| --- | --- | --- | --- | --- | --- |
| ntfy（推播） | `binwiederhier/ntfy` + `server.yml`（pin 版本） | HTTPS | **Tier 0 護欄** | `/var/cache/ntfy`, `/var/lib/ntfy` | VAPID 金鑰 |
| approval-svc（審核） | `services/approval`（Dockerfile） | HTTPS | **Tier 0 護欄** | `/app/data` | NTFY_*, VAPID_*, APPROVAL_BASE_URL, **APPROVAL_TOKEN** |
| LibreChat（大腦/控制平面） | 官方映像 ghcr.io/danny-avila/librechat（pin 版本） | Web UI | Tier 1 | （見 docs/03） | LLM 金鑰、MONGO_URI、CREDS_*/JWT_* |
| MongoDB（LibreChat 狀態） | 官方映像（pin 版本） | 內網 | Tier 1 | `/data/db` | — |
| Hermes（24/7 worker，Phase C） | 便宜 VPS（非 Zeabur 亦可） | 內網/通道 | Tier 2 | `~/.hermes` | LLM 金鑰、APPROVAL_TOKEN |
| oneai-pwa（介面） | `apps/oneai-pwa`（Dockerfile） | HTTPS | 靜態 | — | VITE_*（build args） |
| **rag-svc（RAG 大腦,常駐）** | `brain/`（`brain/rag/Dockerfile`） | 內網 | Tier 1 | `/app/.chroma` | `EMBEDDING_*`（OpenRouter 嵌入） |

> 放置原則與穩定度分層完整說明見 `docs/03` §3.9–3.10。重點:**Tier 0 護欄(ntfy + approval-svc)與 Tier 1 大腦分機部署**、全部**版本釘死(禁 `:latest`)**、有狀態的掛持久卷 + 每日備份。

## 部署順序（有依賴）

1. **ntfy**：先產 VAPID 金鑰
   ```bash
   npm run gen-vapid -w services/approval
   ```
   把 public/private 填進 `infra/zeabur/ntfy/server.yml` 並設 `base-url`。映像 `binwiederhier/ntfy`，啟動指令 `serve`，掛載 `server.yml`。

2. **approval-svc**（**Tier 0 護欄,最高穩定**）：以 `services/approval` 為 build context（含 Dockerfile，已含 `HEALTHCHECK` 與 `VOLUME /app/data`）。
   - **掛持久卷至 `/app/data`**（否則重啟掉待審/決定）。
   - 設 env：
     `NTFY_BASE_URL` `NTFY_TOKEN` `NTFY_TOPIC_APPROVALS` `NTFY_TOPIC_NOTIFY`
     `VAPID_PUBLIC_KEY` `VAPID_PRIVATE_KEY` `VAPID_SUBJECT`
     `APPROVAL_BASE_URL`(=本服務對外網址) `ALLOWED_ORIGIN`(=PWA 網址)
     **`APPROVAL_TOKEN`(必填,組件間鑑權的強隨機值)** `APPROVAL_DEFAULT_TIMEOUT_SEC`(預設 1800)
   - 同一個 `APPROVAL_TOKEN` 也要設到「會呼叫審核」的 agent 端（bridge `mcp-core` / hands）。

3. **rag-svc（RAG 大腦,常駐）**：build context = `brain/`，Dockerfile = `brain/rag/Dockerfile`；掛持久卷 `/app/.chroma`；設 OpenRouter 嵌入 env（`EMBEDDING_BASE_URL`/`EMBEDDING_API_KEY`/`EMBEDDING_MODEL`）。啟動會自動建索引再起服務。`GET /health` 綠燈即可。

4. **LibreChat + MongoDB**：官方映像;掛 `infra/zeabur/librechat/librechat.yaml`（`CONFIG_PATH=/app/librechat.yaml`）;設 OpenRouter `OPENAI_BASE_URL`/`OPENAI_API_KEY`、認證機密、**`RAG_API_URL`（=rag-svc 內網位址）**、`APPROVAL_BASE_URL`/`APPROVAL_TOKEN`。知識庫檢索走 `mcp-core` 的 `vault_query`（已改 HTTP 呼叫 rag-svc）。完整 env 與順序見 `docs/16-step3-cloud-deploy.md`。

5. **oneai-pwa**：以 `apps/oneai-pwa` 為 build context。Build args 填 `VITE_*`
   （`VITE_NTFY_BASE_URL` `VITE_APPROVAL_BASE_URL` `VITE_LIBRECHAT_BASE_URL`
   `VITE_VAPID_PUBLIC_KEY` `VITE_NTFY_TOPIC_*`）。部署後手機開網址 → 加到主畫面 → 開啟推播。
   > 前端**不需**內嵌 `APPROVAL_TOKEN`：approve/reject 用每筆通知夾帶的一次性 `actionToken` 驗證。

## 驗證

- `GET https://<approval>/health` → `{ ok: true }`（healthcheck 綠燈）。
- 無 token 呼叫 `POST /request` → `401`；設 `APPROVAL_TOKEN` 後帶 `Bearer` 才放行。
- PWA「模擬審核」按鈕應彈出審核卡片；ntfy 連線顯示「● 連線」。
- 真實審核：MCP `request_approval` → 非阻塞回 `approval_id` → 手機收到含「允許／拒絕」按鈕的推播 → agent 端輪詢 `/status/<id>` 取回決定。
- **穩定性**：重啟 approval-svc 後 `/status/<未結案 id>` 仍回 `settled:false`（`/app/data` 持久卷生效）；各服務版本為固定 tag。

## 安全

- ntfy 開 `auth-default-access: deny-all`，建立授權帳號。
- 私鑰（VAPID private、NTFY_TOKEN）只放後端 env，**絕不**進前端或 git。
- `APPROVAL_TOKEN`（組件間鑑權）只放後端 env；前端不需內嵌（用每筆 `actionToken`）。
- 細節見 `docs/08-security.md`、`docs/07-guardrail-ntfy-approval.md`。
