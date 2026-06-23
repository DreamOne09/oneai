# OneAI 文件索引

> **最後更新**：2026-06-23  
> **衝突時優先順序**：`17`（戰史/現況）→ `13`/`15`（ADR）→ `01`（架構）→ 其餘

---

## 從這裡開始

| 文件 | 適合誰 | 內容 |
|------|--------|------|
| [00-start-here.md](00-start-here.md) | 所有人 | **5 分鐘速覽** |
| [**18-master-checklist.md**](18-master-checklist.md) | **執行交付** | **⭐ 全部待辦 + §2 本地必做 + 10 情境** |
| [17-lessons-learned-and-war-stories.md](17-lessons-learned-and-war-stories.md) | 部署 / 除錯 | 踩坑大紀錄 |
| [../infra/zeabur/.deploy-state.md](../infra/zeabur/.deploy-state.md) | 維運 | Service ID、env、CLI 範式（部署 SSOT） |

---

## 架構與決策（ADR）

| # | 文件 | 狀態 |
|---|------|------|
| 01 | [architecture.md](01-architecture.md) | ✅ 主架構圖（v3）；LibreChat 標為選配 |
| 13 | [design-review-simplification.md](13-design-review-simplification.md) | ✅ **簡化 ADR**（Odysseus/ruflo 棄用） |
| 14 | [stack-licensing-research.md](14-stack-licensing-research.md) | ✅ 授權與選型研究 |
| 15 | [multi-agent-orchestration.md](15-multi-agent-orchestration.md) | ✅ 編排 ADR（OpenClaw 棄用） |
| — | [ADR-001-multi-agent-architecture.md](ADR-001-multi-agent-architecture.md) | ✅ 多組織 Agent 授權 |

---

## 元件專篇（現役）

| # | 文件 | 元件 |
|---|------|------|
| 04 | [brain-obsidian-rag.md](04-brain-obsidian-rag.md) | Obsidian vault + rag-svc |
| 11 | [oneai-pwa-interface.md](11-oneai-pwa-interface.md) | 手機 PWA（主介面） |
| 12 | [antigravity-hands.md](12-antigravity-hands.md) | 本機 agy worker + 反向輪詢 |
| 07 | [guardrail-ntfy-approval.md](07-guardrail-ntfy-approval.md) | 審核護欄（**Web Push 為主**） |
| 08 | [security.md](08-security.md) | 安全與機密 |

---

## 維運

| # | 文件 | 用途 |
|---|------|------|
| 09 | [runbook-operations.md](09-runbook-operations.md) | 日常操作、健康檢查、故障排除 |
| 10 | [roadmap-phases.md](10-roadmap-phases.md) | 分階段計畫（含完成度） |
| — | [../infra/zeabur/README.md](../infra/zeabur/README.md) | Zeabur 部署步驟（精簡版） |

---

## 參考 / 情境

| # | 文件 | 備註 |
|---|------|------|
| 02 | [scenarios.md](02-scenarios.md) | 20 個使用情境與驗收 |
| 06 | [skills-caveman.md](06-skills-caveman.md) | Skills 與 caveman 模式 |

---

## 歷史 / 選配（閱讀時注意日期）

| # | 文件 | 說明 |
|---|------|------|
| 03 | [cloud-librechat-zeabur.md](03-cloud-librechat-zeabur.md) | LibreChat 部署詳解；**2026-06-23 起未在 Zeabur 運行** |
| 05 | [bridge-mcp-federation.md](05-bridge-mcp-federation.md) | ruflo federation；**已改反向輪詢 worker** |
| 16 | [step3-cloud-deploy.md](16-step3-cloud-deploy.md) | 早期部署 checklist；**部分過時** |

---

## 程式碼對照

```
apps/oneai-pwa/           手機 PWA
services/approval/        編排 + 審核 + 任務佇列（COO 層）
brain/rag/                rag-svc 常駐服務
hands/antigravity/        本機 worker + agy
hands/cursor-agent/       Cursor SDK worker
bridge/mcp-core/          MCP 工具（LibreChat / Cursor 用）
config/oneai.agents.json  Agent 路由 SSOT
config/oneai.models.json  模型 SSOT
scripts/brain-smoke.py    雲端煙霧測試
scripts/e2e-test.py       端到端測試
```

---

## 文件維護規則

1. **部署或 incident 後**：更新 `17` + `.deploy-state.md`
2. **架構不可逆決策**：寫 ADR（13 / 15 / ADR-001）
3. **過時內容不刪**：加頂部狀態橫幅，避免歷史脈絡消失
4. **README 與 01 保持簡短**：細節下沉到專篇
