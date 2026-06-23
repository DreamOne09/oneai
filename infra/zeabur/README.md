# infra/zeabur — 部署指南（精簡版 2026-06-23）

> 完整雷區 → [docs/17-lessons-learned-and-war-stories.md](../../docs/17-lessons-learned-and-war-stories.md)  
> Service ID → [.deploy-state.md](.deploy-state.md)

Zeabur **每服務獨立部署**（無 docker-compose）。

---

## 現役服務（4 個核心）

| 服務 | Build context | Dockerfile | 對外 | 部署方式 |
|------|---------------|------------|------|----------|
| **oneai-approval** | `services/approval/` | `services/approval/Dockerfile` | HTTPS | GitHub `master` 自動 |
| **oneai-pwa-v2** | `apps/oneai-pwa/` | `apps/oneai-pwa/Dockerfile` | HTTPS | GitHub `master` 自動 |
| **rag-svc** | `brain/` | `brain/Dockerfile` | 內網 | **手動** `zeabur deploy` |
| **oneai-backup** | `infra/zeabur/backup/` | 同目錄 | 內網 | 手動 |

### 不要用的 Dockerfile 副本

根目錄 `Dockerfile.approval*`、`Dockerfile.oneai-pwa-v2`、`Dockerfile.zeabur` 為歷史遺留，**canonical 只有上表兩份**。

---

## 部署順序

### 1. rag-svc

```powershell
# context = brain/，掛 Volume /app/.chroma
# env: EMBEDDING_* (OpenRouter 嵌入)
# 驗證: GET http://rag-svc.zeabur.internal:8080/health → doc_count
```

### 2. oneai-approval

- Git push `master` 即觸發 rebuild
- 必填 env 見 `.deploy-state.md`
- 驗證：`GET https://oneai-approval.zeabur.app/health`

### 3. oneai-pwa-v2

- Git push 觸發；build args 烤入 `VITE_*`
- nginx 必須 `listen ${PORT};`
- 驗證：開 https://oneai-mengyi.zeabur.app

### 4. oneai-backup

- Dashboard → Storage → `/data/backups`
- 需 `MONGO_URI` 指向 Mongo（若 LibreChat 恢復時）

---

## 選配 / 已下線

| 服務 | 狀態 | 文件 |
|------|------|------|
| LibreChat + MongoDB | 2026-06 起未運行 | [docs/03](../../docs/03-cloud-librechat-zeabur.md) |
| ntfy | 未部署 | Web Push 為主 |
| Hermes VPS | Phase C | [docs/15](../../docs/15-multi-agent-orchestration.md) |

恢復 LibreChat 時：marketplace Mongo `KXL04P`、repo 根 build + `ZBPACK_DOCKERFILE_PATH=infra/zeabur/librechat/Dockerfile`。

---

## 驗收清單

- [ ] `GET /health` → `{ ok: true }`
- [ ] `python scripts/brain-smoke.py` 通過
- [ ] `python scripts/e2e-test.py` 通過
- [ ] PWA 聊天有回覆；Header 🫀 記憶數合理
- [ ] 本機 worker 在線（`/agents/status` 非空）
- [ ] backup Volume 已掛

---

## 安全

- 私鑰只放 Zeabur env，不進 git
- PWA 用 `VITE_CHAT_TOKEN`，不用完整 `APPROVAL_TOKEN`
- 詳見 [docs/08-security.md](../../docs/08-security.md)
