# ADR-001 — OneAI 多組織 Agent 架構設計決策

> **狀態**: 已接受 (Accepted)  
> **日期**: 2026-06-21  
> **作者**: OneAI 架構組  
> **範圍**: 所有接入 OneAI 生態系的 Agent，含個人、企業內部、合作夥伴、外部

---

## 1. 背景與問題陳述

李孟一的 OneAI 系統未來將同時管理多種 Agent：

- **個人 Agent**：桌上電腦 worker、手機 PWA（目前已上線）
- **組織 Agent**：DreamCube Academy、DreamBangkok 等各自公司可能有獨立的總管 Agent，其下又有多層子 Agent
- **外部合作夥伴 Agent**：受信程度較低，只能做特定事情
- **跨 Agent 子任務委派**：一個 Agent 可以把任務派給另一個 Agent，形成樹狀或網狀結構

本 ADR 定義：
1. **信任層（Trust Level）**分類與其能力邊界
2. **身份識別與認證**機制
3. **隔離標準**（資源/資料/指令）
4. **多組織命名空間**
5. **Agent 生命週期**（註冊 → 運作 → 撤銷）

---

## 2. 決策驅動因素（Decision Drivers）

| 優先順序 | 驅動因素 |
|---|---|
| 1 | **安全**：不同信任等級的 agent 不能互相越權；任何高風險操作須人類審核 |
| 2 | **可觀測性**：手機 PWA 能即時看到所有 agent 狀態（在線/忙碌/離線/錯誤） |
| 3 | **可擴展**：新增組織或外部 agent 只需改設定，不改程式碼 |
| 4 | **最小權限**：每個 agent 只拿完成任務所需的最小 token 範圍 |
| 5 | **KISS**：不引入額外中介層（如 Kafka、Consul）直到確有必要 |

---

## 3. 信任層定義（Trust Levels）

```
┌──────────────────────────────────────────────────────────────────┐
│  信任層      │ 代號       │ 典型 agent                            │
├──────────────┼────────────┼───────────────────────────────────────┤
│ 核心（Core） │ core       │ OneAI Brain（LibreChat + mcp-core）   │
│ 內部（Internal） │ internal │ 桌上電腦 worker、手機 PWA、公司內部 Agent │
│ 合作（Partner）  │ partner  │ 授權過的外部服務（e.g. Hermes, 客戶代理）│
│ 外部（External） │ external │ 未完全信任的第三方 agent              │
└──────────────────────────────────────────────────────────────────┘
```

### 3.1 每個信任層的能力邊界

| 能力 | core | internal | partner | external |
|---|:---:|:---:|:---:|:---:|
| 發起審核請求 `/request` | ✅ | ✅ | ✅ | ❌ |
| 查詢 vault `/vault_query` | ✅ | ✅ | ❌ | ❌ |
| 寫入記憶 `/remember` | ✅ | ✅ | ❌ | ❌ |
| 派本機任務 `/tasks` | ✅ | ✅ | ❌ | ❌ |
| 認領任務 `/tasks/next` | — | ✅(worker) | ❌ | ❌ |
| 回報心跳 `/agents/heartbeat` | — | ✅ | 只自己 | ❌ |
| 讀取 agent 狀態 `/agents/status` | ✅ | ✅ | 只自己 | ❌ |
| 換模型 `oneai_set_model` | ✅ | ✅ | ❌ | ❌ |

---

## 4. 身份識別與認證設計

### 4.1 Token 體系

每個 agent 持有一個或多個 **Bearer Token**，由用途決定能調用哪些端點：

```
Token 類型            環境變數              用途
─────────────────────────────────────────────────────────────────
SERVICE_TOKEN         APPROVAL_TOKEN        core 級：全部端點
WORKER_TOKEN          ONEAI_WORKER_TOKEN    internal worker：認領任務 + 心跳
(未來) PARTNER_TOKEN  PARTNER_<ID>_TOKEN    partner：特定受限端點
```

**原則**：
- Token 不共用，每個獨立 agent 實體一把 token
- Token 以 `crypto.timingSafeEqual` 比對，防止 timing attack
- Token 洩漏 = `openssl rand -hex 32` 重新產生，舊 token 立即失效

### 4.2 Agent ID 命名空間

格式：`<org>/<role>[-<instance>]`

```
personal/desktop-worker        # 個人桌上電腦
personal/mobile-pwa            # 個人手機

dreamcube/orchestrator         # DreamCube 主管 Agent
dreamcube/content-writer       # DreamCube 內容撰寫子 Agent
dreamcube/analytics            # DreamCube 數據分析子 Agent

dreamone/cto-assistant         # DreamBangkok CTO 助理
dreamone/client-report         # 客戶報告自動化 Agent

partner/hermes-agent           # Hermes 合作 Agent
external/client-xyz-bot        # 外部客戶 bot（受限）
cursor/local-agent             # Cursor IDE Agent（程式碼修改、git、測試）
```

**org** 同時是隔離命名空間：`dreamcube` 的 Agent 不能看到 `dreamone` 的任務，除非明確授權。

---

## 5. 多組織命名空間與隔離

### 5.1 資料隔離

```
OneAI 資料存放                隔離層級
─────────────────────────────────────────────────────
MongoDB（LibreChat 對話）    使用者層隔離（各組織不同帳號）
Vault/RAG（記憶）           Namespace 前綴：query 加 org 過濾
approval.json（審核佇列）   每筆記錄帶 org 欄位；worker 認領時只能拿自己 org
agent heartbeat（記憶體）   不持久化，重啟清空，不跨 org 洩漏
```

### 5.2 任務路由隔離

approval-svc 任務佇列 `/tasks` 未來加 `org` 欄位：

```json
{
  "id": "abc123",
  "type": "shell",
  "org": "dreamcube",
  "payload": { "cmd": "..." },
  "status": "queued"
}
```

`GET /tasks/next` 帶入 worker 的 `org`（從 token 解析）→ 只認領 **自己 org** 的任務。

**目前（單人模式）**：全部任務都在 `personal` org，token 不做 org 過濾（YAGNI）。  
**未來（多組織）**：Token 表新增 `org` 欄位，或改用 JWT（`sub=agent_id`, `org=dreamcube`）。

---

## 6. Agent 生命週期

```
┌──────────┐    管理員登記      ┌──────────┐    開始心跳     ┌──────────┐
│  草稿    │ ──────────────→  │  已知    │ ────────────→  │  在線    │
│(Draft)   │  (config/        │(Known)   │  (heartbeat    │(Online)  │
└──────────┘  oneai.agents.json)└──────────┘   ≤ 60s 內)    └──────────┘
                                                              │
                                              超過 60s 無心跳  │
                                                              ▼
                                                        ┌──────────┐
                                                        │  離線    │
                                                        │(Offline) │
                                                        └──────────┘
                                                              │
                                              管理員呼叫撤銷 API │
                                                              ▼
                                                        ┌──────────┐
                                                        │  已撤銷  │
                                                        │(Revoked) │
                                                        └──────────┘
```

### 6.1 新增 Agent 的 SOP

1. **在 `config/oneai.agents.json` 登記**：填 `agent_id`、`org`、`trust`、`task_types`
2. **產生 Token**：`openssl rand -hex 32` → 存入 `.env`
3. **設定 approval-svc 變數**：新增 `WORKER_TOKEN_<ORG>_<ROLE>=<token>`（多 worker 時）
4. **目的端設定**：worker 端設 `APPROVAL_BASE_URL` + `ONEAI_WORKER_TOKEN`
5. **驗證**：`GET /agents/status` 出現 `online: true` 即成功

### 6.2 撤銷 Agent 的 SOP

1. 從 approval-svc 環境變數移除 token
2. 重啟 approval-svc
3. 從 `oneai.agents.json` 移除或標記 `"revoked": true`

---

## 7. 多層 Agent 樹狀架構（未來）

```
                  ┌────────────────────┐
                  │   李孟一 (人類)    │ ← 手機 OneAI PWA 審核
                  └────────┬───────────┘
                           │ 指令
                  ┌────────▼───────────┐
                  │  OneAI Brain       │ ← LibreChat + mcp-core (雲端)
                  │  (Orchestrator)    │
                  └──┬──────┬──────┬───┘
                     │      │      │
          ┌──────────▼┐  ┌──▼────┐ └──▼──────────────┐
          │ Personal  │  │Dream  │    │ Partner        │
          │ Worker    │  │Cube   │    │ (Hermes etc.)  │
          │(internal) │  │Orch.  │    │ (partner)      │
          └──────┬────┘  └──┬────┘   └────────────────┘
                 │          │
         本機執行    ┌──────▼──────┐
                     │內容/分析/..│
                     │ 子 Agents  │
                     └────────────┘
```

**關鍵設計原則**：
- 每個組織的 Orchestrator Agent 只能存取自己 org 的任務和 vault 命名空間
- 跨組織的任務委派必須經過 **approval-svc** 審核（`cross_org_task` action）
- Partner/External agent 永遠不能直接呼叫本機 worker，只能透過審核流程

---

## 8. 可觀測性設計

### 8.1 PWA Agent 面板（已實作）

```
┌─ Agents 1/1 ▼ ──────────────────────────────────────────┐
│  [personal]                                              │
│  ◉ 桌上電腦     執行中: npm run build... (32s)           │
│  ● 手機 OneAI   待命                                     │
│                                                          │
│  [dreamcube]                                             │
│  ○ 主管 Agent   離線                                     │
└──────────────────────────────────────────────────────────┘
```

- 每 30s 輪詢 `GET /agents/status`
- `online = last_seen < 60s`
- 顯示 `current_task` 截斷 40 字元

### 8.2 未來擴展（Phase 2）

- **樹狀展開**：顯示 parent-child 層級（需在 heartbeat 加 `parent` 欄位）
- **任務歷史**：最近 N 筆完成/失敗任務
- **跨組織通知**：某組織 Agent 離線超過 5 分鐘 → 推播提醒

---

## 9. 安全邊界小結

| 威脅 | 對應控制 |
|---|---|
| Token 竊取 | Token 不同分、最小權限、timingSafeEqual 比對 |
| 跨組織資料洩漏 | org 前綴過濾（vault/任務佇列） |
| TOCTOU 攻擊 | 審核時 SHA256 參數雜湊綁定（已實作） |
| 指令注入 | executor: `shell=False`, 沙箱 cwd，環境變數過濾（已實作） |
| Agent 仿冒 | `agent_id` 由 token 決定，非自報 |
| 任務洪水攻擊 | 任務佇列限 `VALID_TASK_TYPES`，未來加速率限制 |

---

## 10. 已知限制與後續計畫

| 項目 | 目前狀態 | Phase 2 計畫 |
|---|---|---|
| Token 管理 | 手動 `.env` | Vault (Hashicorp/自建) 或 Zeabur Secrets |
| 跨 org 授權 | 未實作（單 org） | JWT + org claim |
| Agent 樹狀顯示 | 平面列表 | parent 欄位 + 展開 UI |
| 速率限制 | 無 | express-rate-limit |
| 稽核日誌 | console.log | 寫入 MongoDB audit collection |
| Partner Agent 整合 | 未實作 | Hermes/OpenClaw webhook 模式 |
