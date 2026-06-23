# 16 — 步驟 3：上雲部署計畫（OneAI v1 雲端大腦）

> ⚠️ **狀態（2026-06-23）**：部分過時。請優先讀 [infra/zeabur/README.md](../infra/zeabur/README.md)、[17-lessons-learned](17-lessons-learned-and-war-stories.md)、[.deploy-state.md](../infra/zeabur/.deploy-state.md)。

> 前置:步驟 1（大腦品質:中文嵌入 + persona）與步驟 2（安全:政策/雜湊/沙箱）已完成。
> LLM 閘道已切換為 **OpenRouter**（見 [03](03-cloud-librechat-zeabur.md)、`config/oneai.models.json`）。

## 1. 本階段範圍（v1）

**做**：把「雲端大腦 + 記憶 + 護欄」推上雲，讓你手機隨時可用、always-on、不會忘。
- LibreChat（大腦/控制平面）+ MongoDB
- **RAG 服務**（常駐，新）：vault 檢索/寫回，模型載一次（解 15 秒延遲）
- approval-svc（審核護欄）+ ntfy（推播）
- OneAI PWA（手機介面）

**先不做（後續 Phase）**：
- **本機手（run_local_command/task）** 的雲端→本機通道 → 走 ruflo federation（Phase B/C），見 [05](05-bridge-mcp-federation.md)。v1 雲端的 mcp-core 只提供 `vault_query` / `remember` / `request_approval` / 模型切換。
- obsidian-mcp（vault 檔案級 CRUD）、Hermes 24/7 worker。

## 2. 服務拓撲

| 服務 | 來源 | 對外 | 嵌入/LLM | 持久卷 |
| --- | --- | --- | --- | --- |
| ntfy | `binwiederhier/ntfy` + `infra/zeabur/ntfy/server.yml` | HTTPS | — | `/var/lib/ntfy`,`/var/cache/ntfy` |
| approval-svc | `services/approval`（Dockerfile） | HTTPS | — | `/app/data` |
| **rag-svc**（新） | `brain/`（`brain/Dockerfile`） | 內網 | **OpenRouter 嵌入**（雲端免 torch） | `/app/.chroma` |
| LibreChat + MongoDB | 官方映像（pin 版本）+ `infra/zeabur/librechat/librechat.yaml` | Web UI / 內網 | OpenRouter（一把 key） | Mongo `/data/db` |
| oneai-pwa | `apps/oneai-pwa`（Dockerfile） | HTTPS | — | — |

> 全部**版本釘死**（禁 `:latest`）；有狀態者掛持久卷 + 每日備份。穩定度分層見 [03](03-cloud-librechat-zeabur.md) §3.9–3.10。

## 3. 部署順序（有依賴）

1. **ntfy**：先產 VAPID（`npm run gen-vapid -w services/approval`），填入 `server.yml`，部署。
2. **approval-svc**（Tier 0 護欄）：build context = `services/approval`；掛持久卷 `/app/data`；設 `NTFY_*` `VAPID_*` `APPROVAL_BASE_URL` `ALLOWED_ORIGIN` **`APPROVAL_TOKEN`（強隨機，必填）**。
3. **rag-svc**（新）：build context = `brain/`，Dockerfile = `brain/Dockerfile`；掛持久卷 `/app/.chroma`；設 OpenRouter 嵌入 env（見 §4）。啟動會自動建索引再起服務。
4. **MongoDB** → **LibreChat**：官方映像；掛 `librechat.yaml`（CONFIG_PATH=/app/librechat.yaml）；設 OpenRouter key、認證機密、`RAG_API_URL`（=rag-svc 內網位址）、`APPROVAL_BASE_URL`/`APPROVAL_TOKEN`。
5. **oneai-pwa**：build context = `apps/oneai-pwa`；build args 填 `VITE_*`（ntfy/approval/librechat 網址、VAPID 公鑰）。

## 4. 各服務必填 env

**rag-svc**（雲端走 OpenRouter 嵌入，免 torch）
```
EMBEDDING_BASE_URL=https://openrouter.ai/api/v1
EMBEDDING_API_KEY=<同一把 OpenRouter key>
EMBEDDING_MODEL=openai/text-embedding-3-small
OBSIDIAN_VAULT_PATH=/app/vault     # 映像內建;未來改持久卷 + git-sync
CHROMA_DIR=/app/.chroma            # 持久卷
```
> 不設 `RAG_LOCAL_EMBED_MODEL` 也無妨：有 `EMBEDDING_API_KEY` 就走雲端嵌入（`config.py` 惰性 import，雲端不需 sentence-transformers）。

**LibreChat**
```
OPENAI_BASE_URL=https://openrouter.ai/api/v1
OPENAI_API_KEY=<OpenRouter key>
RAG_API_URL=http://<rag-svc 內網名>:8000
APPROVAL_BASE_URL=https://<approval 對外網址>
APPROVAL_TOKEN=<與 approval-svc 同一把>
CONFIG_PATH=/app/librechat.yaml
MONGO_URI=mongodb://<mongodb 內網名>:27017/LibreChat
CREDS_KEY= / CREDS_IV= / JWT_SECRET= / JWT_REFRESH_SECRET=   # 強隨機
```

## 5. 健康檢查 / 驗證

- `GET https://<approval>/health` → `{ ok: true }`
- rag-svc：`GET /health` → `{ ok: true, collection: ... }`；`POST /query {"query":"願景","top_k":2}` 應回相關片段（首查含暖機，次查毫秒級）。
- LibreChat：能用 OpenRouter 模型對話；對它說「列出可用模型」「切換到 claude」應透過 mcp-core 的 `oneai_list_models`/`oneai_set_model` 生效。
- 端到端護欄：對話觸發 `request_approval` → 手機收到「允許/拒絕」推播 → 決定回流（招1 雜湊綁定、招2 顯示原始參數已就緒）。

## 6. 本機開發對應

- RAG 服務本機跑：`cd brain/rag && .venv/Scripts/python -m uvicorn service:app --port 8010`（用免費 bge，裝 `requirements-local.txt`）。
- mcp-core 設 `RAG_API_URL=http://127.0.0.1:8010` 即走常駐服務;不設則 fallback spawn python。

## 7. 我需要你提供（才能真正部署）

- Zeabur 帳號 / CLI token（或授權我用 Zeabur CLI）。
- 對外網域（approval-svc、ntfy、PWA、LibreChat 各需 HTTPS）。
- 確認 LibreChat 要 pin 的版本（以對齊 `librechat.yaml` schema）。

## 8. 成本（月預算 $300，OpenRouter）

- 對話 brain=Sonnet 4.6、distill=Gemini Flash Lite、嵌入=text-embedding-3-small：實際個人用約 $15–25/月，餘裕充足。
- **務必**在 OpenRouter 後台設月上限 $300 + 日上限，防失控迴圈。
