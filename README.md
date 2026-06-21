# 「李孟一」超級 Agent 個人助理

> **核心原則**：**Obsidian vault 是唯一核心大腦（single source of truth）**，其餘元件皆為其周邊。架構簡化方向見 [docs/13](docs/13-design-review-simplification.md)（以此為準）。

一套個人化的多 Agent 系統，骨架為三層 + 四支柱：

- **雲端大腦（Zeabur / LibreChat，MIT）**：常駐的工作台與 PM / Code Review Agent，內建 Agents / MCP / RAG / 記憶 / 多用戶認證，提供統一 Web UI。（原規劃 Odysseus，因授權混亂 + 安全債改用 LibreChat，見 [docs/14](docs/14-stack-licensing-research.md)）
- **加密橋樑（ruflo federation MCP）**：雲端與本機之間的零信任加密通道（mTLS + ed25519）。
- **本機肉體（Cursor / OpenOneAI / skills）**：重度創作、編碼、Playwright 測試與系統操作。

四支柱對應人格側寫：

| 支柱 | 角色 | 主要元件 |
|---|---|---|
| The Brain | 深度上下文 / 去 AI 味 | Obsidian vault 數位孿生 + ChromaDB RAG + persona 檔 |
| The Hands | 系統級操作 | 本機 Antigravity（主，編碼/測試）+ ruflo-browser/Playwright；OpenOneAI 選配 |
| The Manager | Agent 的 Agent | ruflo 多 agent 調度、回測、Debug |
| The Guardrail | 審核中斷 | 自架 ntfy + Web Push 推播審核（Human-in-the-Loop）|

## 設計決策摘要

- 介面：手機為自製「OneAI」會呼吸 PWA（Pixel 9a）；電腦用 LibreChat 內建 Web UI。
- 自動化程度：agent 可執行，但**關鍵動作需手機審核**（寄信 / 金錢 / 發布 / 刪除）。部署不需審核。
- 推播：自架 ntfy on Zeabur + Android 原生 Web Push API，送達 Pixel 9a 的 OneAI PWA。
- 預設溝通：所有 session 預設啟用 `caveman` 壓縮模式以省 token；深度 / 不可逆作業自動退出。
- 知識庫：Obsidian vault **本機為主**，`obsidian-git` 同步私有 repo，雲端 pull 後 ingest 進 ChromaDB。
- 連線：使用 ruflo 內建 federation 當加密通道，本機需常駐 daemon。
- LLM：使用 **OpenRouter** 統一閘道（一把 key 涵蓋 OpenAI / Gemini / Anthropic 等 300+ 模型，支援 failover），無需本機 Ollama。模型由 `config/oneai.models.json` 切換，不寫死。

## 文件索引

| 文件 | 內容 |
|---|---|
| [docs/01-architecture.md](docs/01-architecture.md) | 整體架構、四支柱、資料流、時序圖 |
| [docs/02-scenarios.md](docs/02-scenarios.md) | 20 個完整使用情境與驗收標準 |
| [docs/03-cloud-librechat-zeabur.md](docs/03-cloud-librechat-zeabur.md) | 雲端大腦 LibreChat 在 Zeabur 的部署 |
| [docs/04-brain-obsidian-rag.md](docs/04-brain-obsidian-rag.md) | 知識庫、persona、RAG 索引 |
| [docs/05-bridge-mcp-federation.md](docs/05-bridge-mcp-federation.md) | 橋樑、ruflo federation、MCP |
| [docs/06-skills-caveman.md](docs/06-skills-caveman.md) | skills 整合與衝突隔離、caveman 預設 |
| [docs/07-guardrail-ntfy-approval.md](docs/07-guardrail-ntfy-approval.md) | ntfy + Web Push 審核護欄 |
| [docs/08-security.md](docs/08-security.md) | 安全、機密管理、repo 真偽驗證 |
| [docs/09-runbook-operations.md](docs/09-runbook-operations.md) | 操作手冊與維運 |
| [docs/10-roadmap-phases.md](docs/10-roadmap-phases.md) | 分階段執行計畫與 checklist |
| [docs/11-oneai-pwa-interface.md](docs/11-oneai-pwa-interface.md) | OneAI 會呼吸 PWA 手機介面 |
| [docs/12-antigravity-hands.md](docs/12-antigravity-hands.md) | Antigravity 本機編碼/測試執行 agent |
| [docs/13-design-review-simplification.md](docs/13-design-review-simplification.md) | **過度設計體檢與簡化方向（ADR，以此為準）** |
| [docs/14-stack-licensing-research.md](docs/14-stack-licensing-research.md) | **技術選型與授權研究（最佳實踐 / MIT 可複製給客戶）** |
| [docs/15-multi-agent-orchestration.md](docs/15-multi-agent-orchestration.md) | **多 Agent 管理與編排（LibreChat 控制平面 / Hermes worker / 單一 SSOT；OpenClaw 評估後棄用，見 15.9 ADR）** |

## 程式碼結構（v0 已建置）

```
apps/oneai-pwa/        會呼吸的 OneAI PWA（Vite+React+r3f+Web Push）✅ 可建置
services/approval/      Human-in-the-Loop 審核服務（ntfy + Web Push）✅ 已驗證
brain/                  Obsidian vault + RAG 索引/檢索腳本 ✅ 語法通過
hands/antigravity/      本機肉體：政策→審核→執行 ✅ 已驗證(worker.py=反向輪詢執行器)
bridge/mcp-core/        MCP 工具伺服器（vault/記憶/審核/本機手包成 Agent 工具）✅ 啟動成功
bridge/federation/      ruflo 零信任通道設定範本
infra/zeabur/           各服務 Dockerfile / ntfy 設定 / 部署指南
docs/                   12 份開發文件
```

## 快速啟動（本機）

```bash
npm install                              # 安裝 PWA / 審核 / bridge 相依

npm run dev -w apps/oneai-pwa           # PWA 開發伺服器 (含示範面板,無需後端即可看呼吸核心)
npm run gen-vapid -w services/approval   # 產生 VAPID 金鑰
npm run dev -w services/approval         # 啟動審核服務 (預設 :8787)

# 知識庫 RAG (Python)
cd brain/rag && pip install -r requirements.txt && python index_vault.py

# 本機肉體
python hands/antigravity/executor.py git status

# MCP 橋接
node bridge/mcp-core/src/server.js

# 本機肉體 worker(讓雲端大腦能派任務到你電腦;需 .env 設好 APPROVAL_BASE_URL / APPROVAL_TOKEN / ONEAI_WORKER_TOKEN)
python hands/antigravity/worker.py
```

> **雲端 → 本機橋樑(as-built)**:採「反向輪詢」— 你電腦跑 `worker.py` 主動長輪詢雲端 `approval-svc` 任務佇列,取到任務 → 經手機審核 → 沙箱執行 → 回報結果。本機**零對外入口**(NAT 友善)。詳見 [docs/12 §12.9](docs/12-antigravity-hands.md)。

雲端部署見 [infra/zeabur/README.md](infra/zeabur/README.md)。

## 安全前提（務必先讀）

本系統會接觸你的 Email、行事曆、檔案與 Shell。上線前**必須**完成 [docs/08-security.md](docs/08-security.md) 的 repo 真偽驗證與機密隔離；來源未驗證的專案不得部署。

## 授權

本專案自寫程式採 [MIT](LICENSE)，便於未來白牌複製給客戶。第三方元件授權清單與選型理由見 [LICENSES.md](LICENSES.md) 與 [docs/14](docs/14-stack-licensing-research.md)。

> 雲端大腦建議由 Odysseus 改為 **LibreChat（MIT）**（Odysseus 授權混亂 + vibecoded 安全債，不宜當客戶地基）；待孟一最終點頭後改寫 docs/03。

## 狀態

**雲端骨幹已全數上線**（Zeabur / DreamBangkok 曼谷,專案 `oneai`）。v0 骨架本機驗證 + 雲端 API 層端到端驗證皆通過(對話 / 登入 / RAG / 審核建立)。僅「手機 Web Push 實機點擊」與「本機肉體 Antigravity 橋樑」待補。

### 線上服務(as-built)

| 支柱 | 服務 | 網址 / 位置 | 狀態 |
|---|---|---|---|
| 🧠 大腦(對話) | LibreChat + OpenRouter | `https://oneai-chat.zeabur.app` | ✅ |
| 💾 資料層 | MongoDB(marketplace) | 內網 `:27017` | ✅ |
| 📚 記憶(知識庫) | rag-svc | 內網 `:8080` | ✅ |
| 🛡️ 守門(審核) | approval-svc | `https://oneai-approval.zeabur.app` | ✅ |
| 🔧 工具 | mcp-core(掛進 LibreChat,5 雲端工具) | stdio MCP | ✅ |
| 📱 手機介面 | oneai-pwa | `https://oneai-mengyi.zeabur.app` | ✅ |

- **登入**:`mengyi@oneai.local` / `OneAI-Brain-2026`(建議改密)。
- **服務 ID、變數、CLI 踩雷與重新部署範式**:見 `infra/zeabur/.deploy-state.md`(非機密)。
- **實際部署過程與計畫差異**:見 [docs/03 §3.12](docs/03-cloud-librechat-zeabur.md)。

> 本機肉體:`run_local_*` 已接通(雲端 mcp-core 派發 → `approval-svc` 任務佇列 → 本機 `worker.py` 認領執行,經手機審核)。需在你電腦上執行 `worker.py` 才會生效。
> 未上線:自訂網域 `dreamone.li`(目前用 Zeabur 預設網域);手機 Web Push 實機點擊驗證。下一步依 [docs/10-roadmap-phases.md](docs/10-roadmap-phases.md)。
