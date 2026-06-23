# 00 - 從這裡開始（OneAI 速覽）

> 5 分鐘了解：**這是什麼、現在跑什麼、你要做什麼**。

---

## 這是什麼

**OneAI** = 孟一的個人 AI 生態系：

- **手機**：會呼吸的 PWA（`oneai-mengyi.zeabur.app`）— 對話、審核、看 Agent 狀態
- **雲端大腦**：`approval-svc` 編排多 Agent + `rag-svc` 長期記憶
- **本機桌電**：`worker.py` / `cursor_worker.py` — 真正改程式、跑 shell（agy / Cursor）
- **知識 SSOT**：Obsidian vault → 索引進 ChromaDB

一句話：**雲端思考 + 記憶；本機執行；手機審核。**

---

## 現在實際在跑什麼（2026-06-23）

| 服務 | 網址 / 位置 | 狀態 |
|------|-------------|------|
| **oneai-approval** | https://oneai-approval.zeabur.app | ✅ GitHub 自動部署 |
| **oneai-pwa-v2** | https://oneai-mengyi.zeabur.app | ✅ GitHub 自動部署 |
| **rag-svc** | Zeabur 內網 `:8080` | ✅ 需手動 redeploy |
| **oneai-backup** | 內網 | ✅ 需掛 Volume |
| LibreChat + MongoDB | oneai-chat.zeabur.app | ⚠️ **已下線（404）** |
| ntfy | — | ⏸ 未部署（Web Push 為主） |
| 本機 worker | 你的 Windows | ⚠️ 需手動啟動 |

詳細 Service ID → [`infra/zeabur/.deploy-state.md`](../infra/zeabur/.deploy-state.md)

---

## 資料流（最常用路徑）

```
你（手機 PWA）
  → POST /chat/orchestrate
  → approval-svc（查 RAG、路由 Agent、合成梅蘭回覆）
  → rag-svc（記憶）
  → OpenRouter（LLM）

若要跑本機任務：
  → POST /tasks
  → 本機 worker.py 輪詢認領
  → executor / agy / Cursor
  → 結果回雲端 → PWA 顯示
```

LibreChat 曾是「桌面工作台」；目前 **PWA + approval 已可獨立運作**。

---

## 新手上路（本機）

```bash
npm install
npm run dev -w apps/oneai-pwa          # 看 UI（示範模式）
npm run dev -w services/approval       # 本機 API :8787

# 本機 worker（讓手機能控桌機）
python hands/antigravity/worker.py
# 或管理員執行：INSTALL-WORKER.bat
```

`.env` 必填：`APPROVAL_BASE_URL`、`ONEAI_WORKER_TOKEN`、`OPENROUTER_KEY`（approval 用）

---

## 你現在應該完成的 TOP 5（本地 — 程式已上線，**你要動手**）

完整步驟 → **[18-master-checklist.md §2 本地必做](18-master-checklist.md#2-本地必做你還沒動)**

1. **LOC-00** 確認 `.env`（含 `ONEAI_WORKER_TOKEN`、`ZEABUR_TOKEN`）
2. **WRK-01** `.\INSTALL-WORKER.bat` 或常駐 `python hands\antigravity\worker.py`
3. **DEP-04** `python scripts\zeabur-cli.py redeploy --service-id rag`（解 S3 記憶）
4. **SEC-01** Zeabur Dashboard 輪替 API token
5. **TST-01** `python scripts\user-scenario-sim.py` → 目標 **10/10**

---

## 下一步讀什麼

| 目的 | 文件 |
|------|------|
| 部署 / 踩坑 | [17-lessons-learned](17-lessons-learned-and-war-stories.md) |
| 架構全貌 | [01-architecture](01-architecture.md) |
| 本機 agy | [12-antigravity-hands](12-antigravity-hands.md) |
| PWA 功能 | [11-oneai-pwa-interface](11-oneai-pwa-interface.md) |
| 安全 | [08-security](08-security.md) |
| 全部索引 | [docs/README.md](README.md) |
