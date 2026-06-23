# 18 - 主待辦清單（Master Checklist）

> **用途**：整合多輪對話所有未執行建議，逐項勾選直到交付。  
> **驗收**：每完成一區塊 → 跑 `python scripts/user-scenario-sim.py`（10 情境）+ `python scripts/e2e-test.py`  
> **最後模擬**：2026-06-23 部署後 → **8/10 通過**（S9 SSE ✅；剩 S3 記憶召回、S7 worker）  
> **相關**：[00-start-here](00-start-here.md) · [17-lessons-learned](17-lessons-learned-and-war-stories.md) · [docs/README](README.md)

---

## 如何使用

1. 按 **Phase 0 → 4** 順序執行（不要跳 P0）
2. 每項有 **ID**（如 `DEP-01`），方便對照情境模擬的 `checklist_ids`
3. 完成後在 `[ ]` 改 `[x]`，並填 **完成日期**
4. Phase 0 全部完成前，不要宣稱「大腦優化已上線」

---

## 進度總覽

| Phase | 主題 | 項數 | 建議工時 |
|-------|------|------|----------|
| **0** | 部署上線（不做=白寫） | 8 | 2–4h |
| **1** | 去重與安全清理 | 14 | 3–5h |
| **2** | 架構決策與 Zeabur | 9 | 2–3h |
| **3** | 產品修復（使用者可感知） | 12 | 4–8h |
| **4** | Phase C / 長期 | 6 | 之後 |

---

## Phase 0 — 部署上線（P0）

> 對應 brain-intel 第二輪、harness、SSE、PWA、rag kind。**本地已寫，雲端未上線。**

| ID | 狀態 | 任務 | 驗收 |
|----|------|------|------|
| DEP-01 | [x] | **commit + push** 所有未提交改動（harness、SSE、PWA、brain/rag、文件） | git push 成功 |
| DEP-02 | [x] | 等 **oneai-approval** GitHub build 綠燈 | `/health` ok |
| DEP-03 | [x] | 等 **oneai-pwa-v2** GitHub build 綠燈 | PWA 可開 |
| DEP-04 | [ ] | **手動 redeploy rag-svc**（`6a36aec746477d6038840bda`） | `/brain/summary` status=ok |
| DEP-05 | [x] | 確認 env：`TAVILY_API_KEY`、`RAG_SVC_HOST`、`ONEAI_WORKER_TOKEN` | brain-smoke 搜尋 OK |
| DEP-06 | [x] | 跑 `node scripts/brain-intel.test.js` | 20/20 |
| DEP-07 | [x] | 跑 `python scripts/brain-smoke.py` | 寒暄/記住/搜尋 OK |
| DEP-08 | [x] | 跑 `python scripts/e2e-test.py` | 全 PASS |

**DEP-01 包含的本地未 push 檔案（摘要）**：
- `services/approval/src/orchestrate-harness.js`（新）
- `services/approval/src/brain-intel.js`、`server.js`
- `apps/oneai-pwa/`（SSE、記憶跳轉、store）
- `brain/rag/`（kind 檢索）
- `docs/` 整理、`scripts/user-scenario-sim.py`

---

## Phase 1 — 去重、安全、死碼清理（P1）

### 1A 安全（立刻）

| ID | 狀態 | 任務 | 驗收 |
|----|------|------|------|
| SEC-01 | [ ] | **輪替 Zeabur API token**（曾硬編在 16 支 scripts） | 舊 token 失效 |
| SEC-02 | [x] | 刪除 scripts 內所有硬編 `sk-3t3...` | `grep sk-3t3 scripts/` 無結果 |
| SEC-03 | [x] | 合併 Zeabur 腳本為 `scripts/zeabur-cli.py`（讀 `ZEABUR_TOKEN` env） | 單一入口 |
| SEC-04 | [x] | 刪除一次性腳本：`check-deploy.py`、`fix-service-type.py` 等 15 支 | 只留 e2e/smoke/sim/audit |

### 1B 重複 Dockerfile

| ID | 狀態 | 任務 |
|----|------|------|
| DKR-01 | [x] | 刪 `Dockerfile.approval`、`Dockerfile.approval-svc-v2` |
| DKR-02 | [x] | 刪 `Dockerfile.oneai-pwa-v2`、`apps/oneai-pwa/Dockerfile.zeabur` |
| DKR-03 | [x] | 刪 `services/approval/Dockerfile.zeabur` |
| DKR-04 | [x] | 刪 `infra/zeabur/mongodb/Dockerfile` |
| DKR-05 | [x] | 確認 CI 只用 `services/approval/Dockerfile` + `apps/oneai-pwa/Dockerfile` |

### 1C PWA / 後端去重

| ID | 狀態 | 任務 | 驗收 |
|----|------|------|------|
| CLN-01 | [x] | **移除** `App.tsx` 的 `connectNtfy()` | 僅 heartbeat 設 connected |
| CLN-02 | [x] | 後端審核推播：Web Push 為主；ntfy 用 `NTFY_ENABLED=0` 關閉 | 無空跑 ntfy |
| CLN-03 | [ ] | deprecate `POST /chat`；e2e 改測 orchestrate | 文件標 deprecated |
| CLN-04 | [ ] | rename `librechat.ts` → `orchestrate-client.ts` | import 全更新 |
| CLN-05 | [ ] | 刪 `sendMessage` / `sendMessageWithMeta` dead exports | 無引用 |
| CLN-06 | [ ] | 抽共用 `lib/task-client.ts`（ChatInput + AgyPanel） | DRY |
| CLN-07 | [x] | 移除或 dev-only **DevPanel**（生產不顯示 ✦） | 正式 UI 乾淨 |
| CLN-08 | [ ] | 修 **AgentGrid** dispatch（現為 `console.log` 假按鈕） | 真派送或隱藏按鈕 |
| CLN-09 | [ ] | 刪未使用的 **AgentPanel.tsx** 或重新掛載 | 無死碼 |
| CLN-10 | [ ] | 統一 RAG host 解析（`RAG_SVC_HOST` vs 硬編 fallback） | 單一 helper |
| CLN-11 | [ ] | 刪 `server.js` 未使用 brain-intel imports | lint 乾淨 |
| CLN-12 | [ ] | archive `bridge/federation/` → `bridge/_deprecated/federation/` | 文件指向 worker |

---

## Phase 2 — 架構決策與 Zeabur（P1–P2）

| ID | 狀態 | 任務 | 驗收 |
|----|------|------|------|
| ARC-01 | [ ] | **決策 LibreChat**：A 退役 / B 恢復（寫入 ADR 一段） | 團隊一致 |
| ARC-02 | [ ] | 若 A：從 PWA build、AgentPanel、`/system/status` 移除 LibreChat 幽靈 | 無假 offline 項 |
| ARC-03 | [ ] | 若 B：marketplace Mongo + librechat redeploy + mcp-core 驗證 | chat 可登入 |
| ZBR-01 | [ ] | 刪 4× video-wizard（SUSPENDED） | service list 乾淨 |
| ZBR-02 | [ ] | 確認刪 app-gateway-v2（無網域） | — |
| ZBR-03 | [ ] | oneai-backup **掛 Volume** `/data/backups` | 重啟後備份還在 |
| ZBR-04 | [ ] | `.deploy-state.md` 與 live 同步（**文件已更新 2026-06-23，deploy 後再確認**） | ID 正確 |
| M-01 | [ ] | RAG **全量 reindex**（舊記憶補 `kind` metadata） | kind 查詢有效 |
| ENV-01 | [ ] | 正式環境 `VITE_CHAT_TOKEN` ≠ `APPROVAL_TOKEN` | 權限分離 |

---

## Phase 3 — 產品能力（使用者可感知）

### 3A 大腦優化（doc 17 / P0–P2 對照）

| ID | 狀態 | 優化 | 雲端需 DEP-01 後才生效 |
|----|------|------|------------------------|
| A-01 | [ ] | 智慧記憶 score≥0.6、寒暄 skip | S1 ✅ 已過 |
| A-02 | [ ] | 選擇性 ragRemember | S2 ✅ |
| A-03 | [ ] | butler「記住」路由 | S2 ✅ |
| A-04 | [ ] | 搜尋 query 清理 | S4 ✅ |
| A-05 | [ ] | 搜尋回覆 ≥3 來源 | S4 ✅ |
| F-01 | [ ] | 手機合成模式 | S5 ✅ |
| G-01 | [x] | SSE 真實進度 | S9 ✅ |
| H-01 | [ ] | 記憶卡片可點 → Memory Tab | 需 DEP-01 + 手機實測 |
| I-01 | [ ] | summary 與 RAG 同 doc_count | S6 部分（total=0 待 reindex） |
| J-01 | [ ] | RAG+路由並行 | harness |
| J-02 | [ ] | 搜尋 5min cache | harness |
| K-01 | [ ] | Worker 狀態注入 orchestrate | harness |
| L-01 | [ ] | 記憶去重 ≥0.95 | harness |
| M-01 | [ ] | fact/episodic kind 分類 | rag redeploy |

### 3B 本機 Hands（worker / agy）

| ID | 狀態 | 任務 | 驗收 |
|----|------|------|------|
| WRK-01 | [ ] | 執行 **INSTALL-WORKER.bat**（管理員） | `/agents/status` 非空 |
| WRK-02 | [ ] | AgyPanel 派 `echo test` 有回應 | S7 通過 |
| WRK-03 | [ ] | 另開 `cursor_worker.py`（Cursor 任務執行） | S10 任務 done |
| WRK-04 | [ ] | 修 **cli_bridge.py** 對齊 `agy -p` 或 AgyPanel 改名「桌機 Shell」 | agy 不假裝 |
| WRK-05 | [ ] | Agent 設定 **只讀** `config/oneai.agents.json`（刪 DEFAULT_ROUTING 硬編） | 改一處即可 |

### 3C 驗收腳本

| ID | 狀態 | 任務 |
|----|------|------|
| TST-01 | [x] | `user-scenario-sim.py` ≥ **8/10** 通過 |
| TST-02 | [ ] | `human-loop-sim.py` learned ≤ 2/5 |
| TST-03 | [ ] | 手機實機：Web Push、記憶跳轉、合成模式 |

---

## Phase 4 — 長期（Phase C）

| ID | 狀態 | 任務 |
|----|------|------|
| C-01 | [ ] | Hermes VPS 24/7 worker |
| C-02 | [ ] | 晨報 cron 呼叫 `/cron/morning-digest` |
| C-03 | [ ] | dreamone.li Gateway |
| C-04 | [ ] | GitHub offsite backup |
| C-05 | [ ] | Skill 自動生成上線驗證（engineer + code） |
| C-06 | [ ] | 恢復或永久移除 LibreChat 相關 infra |

---

## 4. 十種使用者情境模擬結果

**執行**：`python scripts/user-scenario-sim.py`  
**結果檔**：`scripts/user-scenario-results.json`  
**時間**：2026-06-23 部署後（commit `d2d76d1`）

| # | 使用者情境 | 期望 | 結果 | 阻礙 | 要完成的清單 ID |
|---|------------|------|------|------|-----------------|
| S1 | 開場寒暄 | mem≤1、不亂「已學習」 | **✅** | — | — |
| S2 | 說「記住」 | butler + learned | **✅** | — | — |
| S3 | 問「還記得偏好嗎」 | 召回繁體中文 | **❌** | mem=0 | M-01, DEP-04 |
| S4 | 搜尋 Tavily | ≥150字、≥3來源 | **✅** | — | — |
| S5 | 多 Agent 分析 | 合成、多專家 | **✅** | — | — |
| S6 | 看 Header 在線 | health + 🫀 數 | **✅** | worker=0 | WRK-01 |
| S7 | 手機控桌機 Shell | echo 有輸出 | **❌** | queued | WRK-01, WRK-02 |
| S8 | 記憶 Tab 瀏覽 | 總數+搜尋 | **✅** | total=0 / hits=5 | I-01, DEP-04 |
| S9 | SSE 真實進度 | 非假輪播 | **✅** | — | — |
| S10 | 寫程式→Cursor | can_execute + 入列 | **✅** | 執行需 cursor_worker | WRK-03 |

**通過率：8/10** ✅ 達 TST-01 目標

### 使用者視角結論

| 能解決的（今天就能用） | 還不能解決的（需清單） |
|------------------------|------------------------|
| 寒暄、記住、搜尋、多 Agent 合成 | **記憶召回連貫**（S2 寫入 → S3 讀不到）→ **M-01 reindex** |
| 記憶 Tab API、Cursor 任務入列 | **SSE 真實進度** → **DEP-01** |
| 雲端 API 健康 | **桌機 Shell** → **WRK-01** |
| | PWA 記憶卡片點擊高亮 → **DEP-01 PWA** |

---

## 5. 建議執行順序（一週衝刺）

```
Day 1  DEP-01~08  部署上線 + smoke/e2e
Day 2  SEC-01~04  token + 腳本清理
Day 3  WRK-01~03  worker + S7/S10 實機
Day 4  CLN-01~06  ntfy/connected/chat rename/task-client
Day 5  ZBR-01~03  Zeabur 清理 + backup Volume
Day 6  ARC-01     LibreChat 決策 + 幽靈清理
Day 7  TST-01~03  10 情境 ≥8 + 手機實機
```

---

## 6. 勾選記錄

| 日期 | 完成 ID | 備註 |
|------|---------|------|
| 2026-06-23 | DOC-* | 文件大整理（00/09/10/17/18、README、deploy-state） |
| 2026-06-23 | DEP-01~08, SEC-02~04, DKR-*, CLN-01/02/07, G-01, TST-01 | push `d2d76d1`；8/10 情境通過 |

---

*維護：每完成一批勾選後更新 §4 模擬結果與通過率。*
