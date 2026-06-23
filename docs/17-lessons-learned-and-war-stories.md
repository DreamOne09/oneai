# 17 - 歷史修改與踩坑大紀錄（Lessons Learned）

> **文件索引** → [docs/README.md](README.md) · **新手** → [00-start-here.md](00-start-here.md)

> **目的**：把 OneAI 專案從零到現在所踩過的坑、做過的決策、改過的架構，集中成一份**可搜尋的戰史**，避免重複犯錯。
>
> **維護規則**：每次重大 incident、部署失敗、架構轉折，**追加一節**到本文對應章節；不要只寫在聊天記錄裡。
>
> **狀態快照**：2026-06-23（以 live Zeabur + git 為準）

---

## 目錄

1. [時間軸：我們改過什麼](#1-時間軸我們改過什麼)
2. [架構決策與翻案紀錄](#2-架構決策與翻案紀錄)
3. [Zeabur 部署踩坑大全](#3-zeabur-部署踩坑大全)
4. [approval-svc 與 monorepo 地獄](#4-approval-svc-與-monorepo-地獄)
5. [數位大腦 / RAG / 多 Agent 踩坑](#5-數位大腦--rag--多-agent-踩坑)
6. [PWA 與手機 UX 踩坑](#6-pwa-與手機-ux-踩坑)
7. [本機 Worker / agy / Cursor 踩坑](#7-本機-worker--agy--cursor-踩坑)
8. [安全與權限踩坑](#8-安全與權限踩坑)
9. [文件與 SSOT 漂移（元踩坑）](#9-文件與-ssot-漂移元踩坑)
10. [Zeabur 現況 vs 文件（2026-06-23）](#10-zeabur-現況-vs-文件2026-06-23)
11. [反模式清單（做之前先查）](#11-反模式清單做之前先查)
12. [驗收腳本與健康檢查](#12-驗收腳本與健康檢查)
13. [待完成事項（從戰史提煉）](#13-待完成事項從戰史提煉)

---

## 1. 時間軸：我們改過什麼

### Phase 0 — 骨架與本機（~2026-06 初）

| 項目 | 內容 |
|------|------|
| 核心原則 | Obsidian vault = SSOT；ChromaDB RAG |
| 本機手 | `hands/antigravity/`（政策 → 審核 → 沙箱執行） |
| 橋樑 | `bridge/mcp-core`（MCP tools：vault_query / remember / approval） |
| 早期雲端構想 | Odysseus 多容器 → **後來棄用**（見 §2） |

### Phase 1 — Zeabur 雲端上線（2026-06-20 前後）

| 里程碑 | commit / 事件 |
|--------|----------------|
| rag-svc 上線 | Chroma 常駐、`brain/Dockerfile`，內網 `:8080` |
| approval-svc 上線 | Tier 0 護欄 + OpenRouter 代理 |
| LibreChat + MongoDB | marketplace Mongo `KXL04P`；mcp-core 打包進 librechat 映像 |
| oneai-pwa 上線 | Möbius Orb、四 Tab、Agent 面板 |
| 反向輪詢 worker | `worker.py` 取代 federation 入站（NAT 友善） |
| `/tasks` 佇列 | 雲端入列、本機認領、回報結果 |
| Web Push | 取代 ntfy 作為主推播（ntfy **延後未部署**） |

### Phase 2 — 部署地獄與修復（2026-06-21，~15 次 fix commit）

**症狀**：`oneai-approval` Zeabur **502 / CRASHED**。

**根因鏈**（按發現順序）：

1. `.dockerignore` 排除了 `services/`、`apps/` → Docker COPY 失敗或跑錯東西
2. `zbpack.json` + monorepo：`npm start` 在 workspace 根目錄找不到正確入口
3. ES Module vs CommonJS：Zeabur 環境 `node server.js` 模組格式衝突
4. `ZBPACK_APP_DIR` / 相對路徑 / root zbpack 反覆試錯
5. 最終解法：`services/approval/Dockerfile` + 明確 `node src/server.js`（或 zbpack start 指向正確 cwd）

**教訓**：見 §3、§4。**不要再用「試 zbpack 猜 builder」方式 deploy**，每服務固定一份 canonical Dockerfile。

### Phase 3 — GitHub 自動部署（2026-06-21）

| 項目 | 內容 |
|------|------|
| 服務改名 | `oneai-approval`、`oneai-pwa-v2`（Git trigger on `master`） |
| CI | GHCR build 保留；Zeabur deploy job **停用**（Git trigger 負責 rebuild） |
| 根 Dockerfile 變體 | `Dockerfile.approval*`、`Dockerfile.oneai-pwa-v2` 等 → **技術債**，應收斂 |

### Phase 4 — 數位大腦 UX（2026-06-21~22）

| commit | 內容 |
|--------|------|
| `43a6f31` | PWA 暴露 Brain UI、記憶氣泡、思考動畫 |
| `ff7e00d` | **fix**: `memory_preview` 顯示 `[object Object]` 而非 RAG 文字 |
| `f17fa36` | **feat**: brain-intel 第一版（選擇性記憶、合成優先、butler 路由） |
| 本地未 push | 第二輪：harness、SSE、去重、kind 分類、記憶卡片跳轉（**截至 2026-06-23 仍待部署**） |

### Phase 5 — 5-loop 人類模擬與優化（2026-06-22）

`scripts/human-loop-sim.py` 發現的**產品問題**（優化前）：

| 問題 | 現象 | 對策（brain-intel） |
|------|------|---------------------|
| 記憶濫注入 | 寒暄也 `memories_used=4` | score≥0.6 門檻 + 寒暄 skip |
| 每句都「已學習」 | 5/5 loop `remembered=true` | 選擇性 `ragRemember` |
| 搜尋 query 髒 | 帶「搜尋/查一下」送 Tavily | `cleanSearchQuery()` |
| 搜尋回覆過短 | 有時只有 ~80 字 | `enforceSearchReply()` ≥3 來源 |
| 多 Agent 手機太擁擠 | 3 個專家氣泡全展開 | 合成模式 + 「查看 N 位專家」 |

---

## 2. 架構決策與翻案紀錄

### ✅ 採用

| 決策 | 理由 | 文件 |
|------|------|------|
| Obsidian + rag-svc = SSOT | 唯一大腦、可 git、可讀 | docs/04, 13 |
| LibreChat 作桌面控制平面（曾部署） | MIT、成熟 UI、MCP host | docs/03, 14 |
| approval-svc 獨立 | Tier 0 護欄不能跟大腦綁死 | docs/03 §3.10 |
| 反向輪詢 worker | NAT 後零入口、最安全 | docs/12 §12.9 |
| PWA 為手機主介面 | 「會呼吸的數位大腦」體驗 | docs/11 |
| Web Push 取代 ntfy 為主通道 | 少一個服務、PWA 原生 | .deploy-state |
| OpenRouter 統一 LLM | 一把 key、failover | config/oneai.models.json |
| **不採 OpenClaw** | 安全債、控制平面過胖 | docs/15.9 |
| Hermes = Phase C worker（非總管） | 官方定位是 agent 不是 orchestrator | docs/15 |

### ❌ 棄用 / 延後

| 項目 | 為何不要 | 替代 |
|------|----------|------|
| Odysseus | 授權混亂 + vibecoded 安全債 | LibreChat → 後來 PWA+approval 也可獨立 |
| ruflo federation + mTLS | 過度設計、運維重 | 反向輪詢 + Tailscale（若需要） |
| ntfy on Zeabur | Web Push 已夠 | approval-svc VAPID |
| OpenClaw 全通道 Gateway | 攻擊面大 | 薄 webhook 轉接（Phase B） |
| MeiliSearch / pgvector | YAGNI | rag-svc 已夠 |
| agy / Cursor 放 Zeabur | 需本機檔案、Windows、IDE | 本機 worker（§7） |
| LangGraph / CrewAI（現階段） | YAGNI | orchestrate-harness |

### ⚠️ 待你拍板（截至 2026-06-23）

| 議題 | 選項 A | 選項 B |
|------|--------|--------|
| LibreChat | 已從 Zeabur project 消失（chat 404）→ **退役** | 重新部署 librechat + mongo |
| 主聊天入口 | 全面 PWA → approval orchestrate | 桌面 LibreChat + 手機 PWA 雙入口 |

---

## 3. Zeabur 部署踩坑大全

### 3.1 CLI 與 Windows

| 坑 | 現象 | 正確做法 |
|----|------|----------|
| npm `zeabur` wrapper | 吞掉 `--` 後參數；`template deploy` 靜默失敗 | **直呼 exe**：`…\zeabur_windows_amd64_v1\zeabur.exe` |
| PowerShell 引號地獄 | mongosh / sh 多層跳轉失敗 | 腳本 **base64** 進容器再 decode 執行 |
| `&&` 在 PowerShell | ParserError | 用 `;` 分隔或分開跑 |

### 3.2 服務類型與網路

| 坑 | 現象 | 正確做法 |
|----|------|----------|
| 自訂 Mongo Dockerfile | `EXPOSE 27017` 被 zbpack 當 **HTTP 埠** → 逾時 | **marketplace 模板 `KXL04P`** |
| PWA nginx 硬編 `listen 80` | Zeabur 注入 `PORT` → **502** | `listen ${PORT};` + envsubst 模板 |
| 內網主機名 | 服務改名後以為 URL 會變 | 固定 `<服務名>.zeabur.internal`，與 Dashboard 顯示名無關 |
| CLI `${VAR}` 跨服務引用 | bug、展開失敗 | Dashboard 手填或硬編內網 host |
| rag 埠文件寫 8000 | 連線失敗 | Zeabur 實際 **8080**（`RAG_SVC_HOST:8080`） |
| 網域撞名 | `oneai-pwa` 被佔 | 換名，最終 **`oneai-mengyi`** |

### 3.3 Build context 與 Docker

| 坑 | 現象 | 正確做法 |
|----|------|----------|
| `.dockerignore` 排除 `services/` | approval build 空殼 → CRASH | 允許 `services/approval`、`apps/oneai-pwa` |
| librechat 需 repo 根 context | 缺 bridge/config | 根目錄 deploy + `.zeaburignore` 排除 `brain/`(1.2GB) |
| 單 Dockerfile 目錄被 zbpack 誤判 | 當 caddy 靜態站 | 設 `ZBPACK_DOCKERFILE_PATH` |
| 多份 Dockerfile 同名服務 | deploy 到錯映像 | **每服務只留一份 canonical**（§13） |
| librechat `:latest` | 不可重現 build | pin 版本 commit/tag |

### 3.4 運維

| 坑 | 現象 | 正確做法 |
|----|------|----------|
| redeploy 不帶 `--service-id` | 重複建立服務、ID 混亂 | 一律帶 ID；SSOT 見 `.deploy-state.md` |
| oneai-backup 無 Volume | 重啟後備份消失 | Dashboard 掛 `/data/backups` |
| Git trigger 與手動 zip 並存 | 雙份服務、雙份計費 | 遷移後刪舊服務 |
| 殘留 video-wizard 等 | SUSPENDED 仍佔 project | 定期 `service list` 清理 |

---

## 4. approval-svc 與 monorepo 地獄

**症狀序列**（2026-06-21）：

```
502 → CRASHED → debug minimal server → zbpack 路徑試錯 → ES module 錯 → workspace npm start 失敗 → dockerignore 排除原始碼
```

**最終穩定配置**：

| 項目 | 值 |
|------|-----|
| Canonical Dockerfile | `services/approval/Dockerfile` |
| 入口 | `node src/server.js`（或 Dockerfile CMD 明確指定） |
| Git 服務名 | `oneai-approval`（ID: `6a384ea9d12e4cadec4f4d04`） |
| 環境變數 | `OPENROUTER_KEY`、`TAVILY_API_KEY`、`RAG_SVC_HOST`、`ONEAI_WORKER_TOKEN` |

**路由順序雷**（會導致 worker 401）：

```javascript
// ❌ 錯：/tasks/:id 會吃掉 "next"
app.get('/tasks/:id', ...)
app.get('/tasks/next', ...)

// ✅ 對：/tasks/next 必須在前
app.get('/tasks/next', ...)
app.get('/tasks/:id', ...)
```

**CORS 順序雷**（PWA 永遠離線）：

- CORS middleware 必須在 `/health` **之前**，否則跨域 heartbeat 被擋。

---

## 5. 數位大腦 / RAG / 多 Agent 踩坑

### 5.1 RAG 與記憶

| 坑 | 現象 | 修復 |
|----|------|------|
| 每句注入 4 條記憶 | 寒暄也調 RAG | `filterMemories` score≥0.6；`isSmallTalk` skip |
| 每句 `remembered=true` | 「已學習」失去意義 | `shouldRemember()` 門檻 |
| `memory_preview` 顯示 `[object Object]` | PWA 記憶氣泡壞 | `memoryToText()` 統一取 `text/content` |
| RAG 每次 spawn python | 本機 embedding 15s/次 | 常駐 `brain/rag/service.py` |
| `/brain/summary` 與 RAG 不同源 | Header 記憶數不準 | summary 讀 RAG `/health` 的 `doc_count` |
| 記憶重複寫入 | vault 膨脹 | `ragRememberSmart` 相似度≥0.95 跳過 |
| fact vs 對話混查 | 召回不準 | `kind=preference/memory` 分類檢索 |

### 5.2 路由與搜尋

| 坑 | 現象 | 修復 |
|----|------|------|
| 「記住」沒走 butler | 路由 LLM 飄 | `mergeAgentRoute` + DEFAULT_ROUTING.butler |
| 搜尋 query 帶贅字 | Tavily 結果差 | `cleanSearchQuery()` |
| researcher 回覆過短 | 空泛合成 | `enforceSearchReply()` 至少 3 來源 |
| 未設 `TAVILY_API_KEY` | 搜尋 fallback 差 | 設到 approval-svc 環境變數 |

### 5.3 編排架構

| 坑 | 現象 | 修復 |
|----|------|------|
| orchestrate 邏輯散落 server.js | 難維護、SSE/REST 不一致 | `orchestrate-harness.js` 單一 harness |
| RAG 與路由串行 | 延遲高 | `Promise.all([ragQuery, detectAgentsLLM])` |
| 相同搜尋重打 Tavily | 慢 + 費 | `webSearchCached` 5 分鐘 TTL |
| harness 用錯函式名 | `mergeBrainRoute` undefined | import 別名一致 |

### 5.4 human-loop 基線（優化前）

見 `scripts/human-loop-results.json`：

- Loop 1 寒暄：`memories_used=4`, `remembered=true` ← **不應發生**
- Loop 4 搜尋：`agent_ids=['researcher','butler']` ← 搜尋應去掉多餘 butler
- 5/5 loop 全部 `remembered=true` ← **選擇性寫入要驗收**

---

## 6. PWA 與手機 UX 踩坑

| 坑 | 現象 | 修復 |
|----|------|------|
| ntfy 未部署但 heartbeat 綁 ntfy SSE | **永遠顯示離線** | 改輪詢 `approval-svc /health` |
| 假思考輪播 | 與真實進度不符 | SSE `/chat/orchestrate/stream`（第二輪，待部署） |
| 多 Agent 全展開 | 手機太擁擠 | 合成模式預設只顯示梅蘭 |
| 記憶氣泡不可點 | 無法跳 Memory Tab | `openMemoryTab` + BrainPanel highlight |
| `VITE_CHAT_TOKEN` 未設 | 前端用高權限 token | 分離 chat token / approval token |
| PowerShell 裝 worker 路徑問題 | INSTALL 失敗 | 根目錄 `INSTALL-WORKER.bat` |

---

## 7. 本機 Worker / agy / Cursor 踩坑

### 7.1 設計定位（必讀）

**agy / Cursor 是「本機的手」，不是 Zeabur 服務。**

| 放本機 | 不放 Zeabur 的原因 |
|--------|-------------------|
| 改你 Cursor 工作區未 commit 的檔案 | 雲端只有 git clone 快照 |
| Windows 命令（AgyPanel） | 容器是 Linux |
| Cursor SDK / agy MCP 設定 | 綁 `~/.gemini/`、本機 auth |
| 零對外入口 | 反向輪詢最安全 |

### 7.2 常見故障

| 症狀 | 原因 | 處置 |
|------|------|------|
| AgyPanel 一直「等待 worker」 | `worker.py` 沒跑 | `INSTALL-WORKER.bat` 或手動啟動 |
| `/agents/status` 回 `[]` | 無 worker 心跳 | 確認 `ONEAI_WORKER_TOKEN` 本機=雲端 |
| agy headless 無輸出 | 非 TTY bug (#76) | 需 pty bridge（`agy-headless-bridge`） |
| Cursor 任務無人認領 | 跑錯 worker | `cursor_worker.py` 認領 `type=cursor_agent`；agy 認領 `shell,agent` |
| `agy` 找不到 | PATH 未設 | 本機：`C:\Users\b1993\AppData\Local\agy\bin\agy.exe` |
| mcp.json 改完不生效 | IDE 快取 | **重啟 Cursor** |

### 7.3 任務類型分工

| type | Worker | 檔案 |
|------|--------|------|
| `shell` | antigravity | `hands/antigravity/worker.py` |
| `agent` | antigravity | 同上 |
| `cursor_agent` | Cursor SDK | `hands/cursor-agent/cursor_worker.py` |

---

## 8. 安全與權限踩坑

| 坑 | 後果 | 做法 |
|----|------|------|
| 前端 bundle 含 `APPROVAL_TOKEN` | 高權限外洩 | 用 `VITE_CHAT_TOKEN`（僅 `/chat*`） |
| worker token = service token | worker 可入列任意任務 | 分離 `ONEAI_WORKER_TOKEN` |
| cli_bridge 傳遞含 KEY 的 env | 被執行指令竊取 | `_safe_env()` 刷洗 |
| cwd 逃逸 | 路徑穿越 | `ONEAI_SANDBOX_ROOT` 監牢 |
| OpenClaw 當控制平面 | RCE / 記憶分裂 | **已拒絕**（docs/15.9） |
| `.env` commit | 金鑰外洩 | 只 commit `.env.example` |

---

## 9. 文件與 SSOT 漂移（元踩坑）

**這是最容易被忽略、但代價最高的一類坑。**

| 漂移類型 | 例子 | 後果 |
|----------|------|------|
| Service ID 不一致 | `.deploy-state.md` vs `scripts/zeabur-*.py` vs live | redeploy 打錯服務 |
| 服務已刪文件還在 | librechat RUNNING in doc，live 已 404 | 以為桌面還能用 |
| Dockerfile 多份 | 6 份 approval 變體 | 不知道哪份在 production |
| README 仍寫 ntfy / ruflo / Odysseus | 架構圖過時 | 新對話 AI 給錯建議 |
| 第二輪優化未 push | 本地 harness/SSE | 以為雲端已上線 |
| `brain/rag/Dockerfile` 文件路徑 | 實際是 `brain/Dockerfile` | deploy 找錯檔 |

**防漂移規則**：

1. **Live 優先**：`zeabur.exe service list` > 任何 markdown
2. **一份 SSOT**：`infra/zeabur/.deploy-state.md` 每次 deploy 後更新
3. **架構以 ADR 為準**：docs/13、14、15、**本文 17**
4. **驗收腳本當契約**：`brain-smoke.py`、`e2e-test.py` 過了才算部署成功

---

## 10. Zeabur 現況 vs 文件（2026-06-23）

> ⚠️ 以下為 **live 查詢結果**，與 `.deploy-state.md`（2026-06-21 寫）可能不同。

### 應保留（核心）

| 服務 | Service ID | 網域 | Git trigger |
|------|------------|------|-------------|
| oneai-approval | `6a384ea9d12e4cadec4f4d04` | oneai-approval.zeabur.app | master ✅ |
| oneai-pwa-v2 | `6a382c27742d93fa52abe64f` | oneai-mengyi.zeabur.app | master ✅ |
| rag-svc | `6a36aec746477d6038840bda` | 內網 | 手動 ⚠️ |
| oneai-backup | `6a36e0ac46477d603884113c` | 內網 | 手動 |

### 建議刪除

| 服務 | 狀態 | 原因 |
|------|------|------|
| video-wizard ×4 | SUSPENDED | 與 OneAI 無關 |
| app-gateway-v2-… | RUNNING 無網域 | 實驗殘留，確認後刪 |

### 文件中記載但 live 不存在

| 服務 | 現象 |
|------|------|
| librechat | `oneai-chat.zeabur.app` → **404** |
| mongodb-noing | 不在 service list |
| ntfy | 從未部署（正確，Web Push 為主） |

### 本地未部署的重要改動

- `orchestrate-harness.js`、SSE stream、P2 優化 → **需 commit + push**
- rag-svc kind 檢索 → **需手動 redeploy rag-svc**

---

## 11. 反模式清單（做之前先查）

部署前自問：

- [ ] 我是否在用 **canonical Dockerfile**（不是根目錄某個 v2 副本）？
- [ ] `.dockerignore` 有沒有把 **`services/` / `apps/`** 排除？
- [ ] PWA nginx 是否監聽 **`$PORT`**？
- [ ] Mongo 是否用 **marketplace**，不是自訂 Dockerfile？
- [ ] `--service-id` 是否來自 **最新 `service list`**？
- [ ] Zeabur CLI 是否用 **exe 直呼**？
- [ ] 改 orchestrate 是否同時更新 **harness**（REST + SSE 共用）？
- [ ] 新記憶邏輯是否跑过 **human-loop-sim**？
- [ ] 是否誤把 **agy/Cursor 當雲端 API** 部署？
- [ ] 文件是否同步更新 **`.deploy-state.md` + 本文**？

---

## 12. 驗收腳本與健康檢查

| 腳本 | 用途 | 通過標準（摘要） |
|------|------|------------------|
| `scripts/brain-intel.test.js` | brain-intel 單元 | 20/20 pass |
| `scripts/brain-smoke.py` | 雲端 orchestrate | 寒暄 mem≤1；記住→butler；搜尋有來源 |
| `scripts/e2e-test.py` | 端到端 API | 全 PASS |
| `scripts/human-loop-sim.py` | 5 句人類模擬 | learned≤2/5；搜尋 reply≥300 |
| `GET /health` | approval 存活 | `{"ok":true}` |
| `GET /agents/status` | worker 在線 | 非空陣列 |
| `GET /brain/summary` | RAG 統計 | `status=ok`, `total_memories` 合理 |

**Zeabur CLI 範式**（Windows）：

```powershell
$z="C:\Users\b1993\AppData\Roaming\npm\node_modules\zeabur\zeabur_windows_amd64_v1\zeabur.exe"
& $z service list --project-id 6a36ad9046477d6038840b9d --env-id 6a36ad9079260dbd878433e5 -i=false
& $z deploy --project-id 6a36ad9046477d6038840b9d --service-id <SID> --json -i=false
```

---

## 13. 待完成事項（從戰史提煉）

按優先順序：

### P0 — 不做 = 功能白寫

- [ ] commit + push 第二輪 brain/harness/SSE/PWA 改動
- [ ] 手動 redeploy **rag-svc**（kind 檢索）
- [ ] 跑 `brain-smoke.py` + 手機實機驗收

### P1 — 清理與決策

- [ ] 刪除 4 個 video-wizard + 確認 app-gateway-v2
- [ ] **決策**：LibreChat 退役（A）或恢復（B）
- [ ] 更新 `.deploy-state.md` 對齊 live Service ID
- [ ] oneai-backup 掛 Volume `/data/backups`
- [ ] 本機跑 `INSTALL-WORKER.bat`，確認 AgyPanel 可用

### P2 — 技術債

- [ ] 收斂多餘 Dockerfile（§3.3）
- [ ] 清理一次性 `scripts/check-*.py` 或歸檔
- [ ] README 更新：反映 PWA-first、ntfy 延後、LibreChat 狀態
- [ ] RAG 全量 reindex（舊記憶補 `kind` metadata）

### P3 — Phase C

- [ ] Hermes VPS worker
- [ ] dreamone.li Gateway
- [ ] 晨報 cron 接 `/cron/morning-digest`

---

## 附錄 A：關鍵檔案索引

| 用途 | 路徑 |
|------|------|
| 部署 SSOT | `infra/zeabur/.deploy-state.md` |
| 智慧大腦層 | `services/approval/src/brain-intel.js` |
| 編排 harness | `services/approval/src/orchestrate-harness.js` |
| 本機 worker | `hands/antigravity/worker.py` |
| Cursor worker | `hands/cursor-agent/cursor_worker.py` |
| Agent 路由設定 | `config/oneai.agents.json` |
| PWA 聊天 | `apps/oneai-pwa/src/components/ChatInput.tsx` |
| RAG 服務 | `brain/rag/service.py` |
| 架構 ADR | `docs/13`, `docs/15` |

## 附錄 B：相關文件

- [03 - Zeabur 部署](03-cloud-librechat-zeabur.md)
- [12 - Antigravity 本機手](12-antigravity-hands.md)
- [13 - 簡化 ADR](13-design-review-simplification.md)
- [15 - 多 Agent 編排](15-multi-agent-orchestration.md)
- [09 - Runbook](09-runbook-operations.md)（建議逐步把 §12 健康檢查同步過去）

---

*最後更新：2026-06-23 · 維護者：與孟一協作時追加 incident 小節*
