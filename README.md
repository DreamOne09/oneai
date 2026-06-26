# 「李孟一」超級 Agent 個人助理

> **Obsidian vault = 唯一記憶 SSOT。** 架構決策見 [docs/13](docs/13-design-review-simplification.md)、[docs/15](docs/15-multi-agent-orchestration.md)。  
> **新手入口** → [docs/00-start-here.md](docs/00-start-here.md) · **主待辦** → [docs/18-master-checklist.md](docs/18-master-checklist.md) · **踩坑紀錄** → [docs/17-lessons-learned-and-war-stories.md](docs/17-lessons-learned-and-war-stories.md)

---

## 系統概覽（OneAI **2.0** · 2026-06-25）

> **2.0 正式版說明** → [docs/23-oneai-2.0-release.md](docs/23-oneai-2.0-release.md)

| 層 | 元件 | 說明 |
|----|------|------|
| **手機介面** | OneAI PWA | Möbius Orb、多 Agent 對話、審核、Agy 桌機控制 |
| **雲端 COO** | approval-svc | `/chat/orchestrate`、任務佇列、Agent 心跳、Web Push |
| **雲端記憶** | rag-svc | ChromaDB + `/query` / `/remember` |
| **本機 Hands** | worker.py + agy + Cursor | 反向輪詢；改本機程式、跑 shell |
| **知識庫** | Obsidian vault | 本機 markdown → 索引到 rag-svc |

**已棄用 / 未部署**：Odysseus、OpenClaw、ruflo federation、ntfy（Web Push 取代）、LibreChat（2026-06 起 Zeabur 已下線，可選恢復）。

---

## 線上服務

| 服務 | URL | 部署 |
|------|-----|------|
| approval-svc | https://oneai-approval.zeabur.app | GitHub `master` |
| oneai-pwa | https://oneai-mengyi.zeabur.app | GitHub `master` |
| rag-svc | 內網 `:8080` | 手動 |
| oneai-backup | 內網 | 手動 |

Service ID、env、CLI → [`infra/zeabur/.deploy-state.md`](infra/zeabur/.deploy-state.md)

---

## 快速啟動（本機）

```bash
npm install
npm run dev -w apps/oneai-pwa           # PWA（無後端也可看 Orb）
npm run dev -w services/approval        # 本機 :8787

python hands/antigravity/worker.py      # 本機 worker（或 INSTALL-WORKER.bat）
python scripts/brain-smoke.py           # 雲端煙霧測試（需 .env）
```

雲端部署 → [infra/zeabur/README.md](infra/zeabur/README.md)

---

## 程式碼結構

```
apps/oneai-pwa/           手機 PWA ✅
services/approval/        編排 + 審核 + 佇列 ✅
  src/brain-intel.js      智慧記憶 / 路由 / 搜尋
  src/orchestrate-harness.js  單一編排 harness
brain/rag/                rag-svc ✅
hands/antigravity/        本機 worker + agy ✅
hands/cursor-agent/       Cursor SDK worker ✅
bridge/mcp-core/          MCP 工具（LibreChat/Cursor 用）
config/                   agents / models SSOT
docs/                     文件（見 docs/README.md）
```

---

## 文件索引

**完整索引** → [docs/README.md](docs/README.md)

| 優先 | 文件 |
|------|------|
| ⭐ | [00-start-here](docs/00-start-here.md) · [**18-master-checklist**](docs/18-master-checklist.md) · [17-lessons-learned](docs/17-lessons-learned-and-war-stories.md) |
| 架構 | [01-architecture](docs/01-architecture.md) · [15-multi-agent](docs/15-multi-agent-orchestration.md) |
| 元件 | [04-brain](docs/04-brain-obsidian-rag.md) · [11-pwa](docs/11-oneai-pwa-interface.md) · [12-antigravity](docs/12-antigravity-hands.md) |
| 維運 | [09-runbook](docs/09-runbook-operations.md) · [10-roadmap](docs/10-roadmap-phases.md) |

---

## 安全

上線前必讀 [docs/08-security.md](docs/08-security.md)。前端用 `VITE_CHAT_TOKEN`（低權限），`APPROVAL_TOKEN` 僅後端。

---

## 授權

自寫程式 [MIT](LICENSE)。第三方見 [LICENSES.md](LICENSES.md)、[docs/14](docs/14-stack-licensing-research.md)。
