# 01 - OneAI 系統架構（v3.1，2026-06-23）

> **現況**：手機 PWA + approval-svc 為**主路徑**；LibreChat 2026-06 起 Zeabur 已下線（可選恢復）。  
> 部署 SSOT → [`infra/zeabur/.deploy-state.md`](../infra/zeabur/.deploy-state.md) · 踩坑 → [17](17-lessons-learned-and-war-stories.md)

---

## 1.0 設計哲學

> **「越用越了解你的全方位個人助理」**
>
> 不只是問答機器——是一個有記憶、有手腳、有多位專家同時待命的個人 AI 生態系。

三個核心能力：
1. **永不遺忘** — 每次對話自動存入 RAG，記憶隨時間累積
2. **多 Agent 協作** — Orchestrator 自動路由到最適合的專家 Agent
3. **有手有腳** — 雲端大腦可以呼叫本機桌電執行實際任務

---

## 1.1 整體架構圖

```mermaid
flowchart TB
    user["李孟一"]

    subgraph phone ["手機 - Pixel 9a"]
        pwa["OneAI PWA (Möbius UI)\n- 主對話介面\n- Agent 狀態面板\n- 在 Cursor 執行 按鈕\n- 審核推播"]
    end

    subgraph cloud ["雲端大腦 - Zeabur (DreamBangkok)"]
        appr["approval-svc (Node.js 核心)\n/chat/orchestrate 多 Agent\n/chat 單次問答\n/tasks 佇列\n/agents/heartbeat + /status\n/system/status"]
        rag["rag-svc (FastAPI)\nChromaDB 向量索引\nbge-small-zh 嵌入\n/query + /remember"]
        librechat["LibreChat（選配，目前下線）\n桌面工作台 + mcp-core"]
        mongo["MongoDB（選配）\nLibreChat 對話"]
        backup["oneai-backup\n每日 03:00 UTC mongodump"]
    end

    subgraph local ["本機 - Windows 桌電"]
        worker["Antigravity worker.py\n反向輪詢長連線\n執行 shell/agent 任務"]
        cursor_w["cursor_worker.py\n認領 cursor_agent 任務\n呼叫 Cursor SDK"]
        cursor["Cursor IDE\n+ mcp-core 本機 8 工具\n程式碼實際出現在這裡"]
        vault["Obsidian Vault\n知識庫 .md 文件"]
    end

    llm["OpenRouter\n主模型: gemini-2.5-flash\nfallback chain 自動接管"]

    user -- "問話/審核/看 Agent 狀態" --> pwa
    pwa -- "POST /chat/orchestrate" --> appr
    appr -- "① 查 RAG 記憶" --> rag
    appr -- "⑤ 存回記憶" --> rag
    appr -- "② ~ ④ 呼叫子 Agent" --> llm
    appr -- "推播/審核" --> pwa

    pwa -- "💻 送到 Cursor\nPOST /tasks {type:cursor_agent}" --> appr
    appr -- "任務佇列 /tasks" --> cursor_w
    appr -- "任務佇列 /tasks" --> worker

    cursor_w -- "GET /tasks/next?type=cursor_agent" --> appr
    worker -- "GET /tasks/next?type=shell,agent" --> appr
    cursor_w -- "Cursor SDK" --> cursor

    user -- "桌面工作台" --> librechat
    librechat -- "mcp-core stdio" --> appr
    librechat --> llm
    librechat --> rag

    vault -- "reindex" --> rag
    mongo --> backup
```

> **注意**：LibreChat / Mongo 為虛線選配；現役主路徑為 PWA → approval-svc → rag-svc。

---

## 1.2 Multi-Agent Orchestrate 資料流（核心流程）

```mermaid
sequenceDiagram
    participant P as PWA (手機)
    participant A as approval-svc
    participant R as rag-svc
    participant LLM as OpenRouter

    P->>A: POST /chat/orchestrate { messages }

    par 記憶查詢（並行）
        A->>R: POST /query { text, top_k:4 }
        R-->>A: [ "記憶1", "記憶2", ... ]
    end

    Note over A: 偵測關鍵字路由<br/>e.g. "程式" → engineer<br/>"策略" → pm+analyst

    par 子 Agent 並行呼叫
        A->>LLM: [engineer system+記憶] + messages
        A->>LLM: [analyst system+記憶] + messages
    end

    LLM-->>A: engineer 回覆
    LLM-->>A: analyst 回覆

    A->>LLM: Orchestrator 合成 2 個回覆

    LLM-->>A: 最終合成回覆

    A->>R: POST /remember { Q&A 摘要 }  ← 非同步
    A-->>P: { reply, model, agents, memories_used, can_execute? }

    P->>P: 顯示 + 若 can_execute=true 顯示「在 Cursor 執行」
```

---

## 1.3 Engineer → Cursor 執行資料流

```mermaid
sequenceDiagram
    participant P as PWA
    participant A as approval-svc
    participant CW as cursor_worker.py
    participant C as Cursor IDE

    Note over P: 使用者點「💻 送到 Cursor（選專案）」
    P->>A: POST /tasks { type:cursor_agent, payload:{prompt, cwd} }
    A-->>P: { id: "task_abc123" }

    loop 輪詢（每 2.5s，最多 90s）
        P->>A: GET /tasks/task_abc123
        A-->>P: { status: "queued" | "running" | "done" }
    end

    CW->>A: GET /tasks/next?type=cursor_agent （長輪詢）
    A-->>CW: 認領 task_abc123
    CW->>C: Cursor SDK Agent.run(prompt, cwd)
    Note over C: 程式碼出現在 IDE<br/>（手機只看摘要）
    C-->>CW: 執行結果
    CW->>A: POST /tasks/task_abc123/result
    A-->>P: { status:done, result: { summary } }
    P->>P: 任務卡片 + 文字摘要（不顯示 code）
```

> **注意**：`worker.py`（agy/shell）與 `cursor_worker.py` **並行**輪詢同一佇列，任務 type 不同，互不轉派。詳見 [19-deployment-and-workers](19-deployment-and-workers.md)。

---

## 1.4 Soul 記憶層（讓 OneAI「越用越了解你」）

```
L1 核心人格（靜態）
   └─ MENGYI_BRIEF：21 歲、清邁、使命、三爽、5-Why…
      永遠注入所有 Agent system prompt

L2 工作記憶（對話 session）
   └─ historyRef：最近 12 輪對話上下文
      存在 PWA 前端 sessionStorage

L3 長期記憶（跨 session 累積）
   └─ rag-svc ChromaDB：選擇性寫入 + 智慧注入
      · score≥0.6 才注入個人記憶；寒暄 skip（brain-intel）
      · 顯式「記住」→ kind=preference；一般對話 → kind=memory
      · **kind=system** → 架構/部署 SSOT（`config/oneai.system-architecture.json` seed，不與個人記憶混寫）
      · 架構問答 **不** auto-remember（避免污染個人記憶庫）
      · 寫入前去重（相似度≥0.95）
      來源 1：Obsidian vault .md
      來源 2：orchestrate 選擇性 /remember（Markdown + 出處）
      來源 3：approval 啟動時 seed kind=system（`system-memory.js`）
```

> 詳見 `services/approval/src/brain-intel.js`、`orchestrate-harness.js`。

---

## 1.5 元件職責總表（v3）

| 元件 | 位置 | 職責 |
|---|---|---|
| **OneAI PWA** | 手機 / 瀏覽器 | 主對話介面、Möbius Orb、Agent 面板、「在 Cursor 執行」按鈕、記憶使用提示 |
| **approval-svc** | Zeabur | **核心**：Orchestrate + 記憶注入 + 任務佇列 + Agent 心跳 + 審核 |
| **rag-svc** | Zeabur | Soul L3：向量查詢 + 記憶寫入（ChromaDB + bge-small-zh） |
| **LibreChat** | Zeabur（選配） | 桌面工作台；**2026-06 起未部署** |
| **MongoDB** | Zeabur（選配） | LibreChat 用；隨 LC 下線 |
| **oneai-backup** | Zeabur | 每日 03:00 UTC mongodump，保留 7 天 |
| **Antigravity worker.py** | 本機 | 反向輪詢 **shell/agent** 任務，30s 心跳；**不**處理 cursor_agent |
| **cursor_worker.py** | 本機 | **獨立行程**，反向輪詢 **cursor_agent** 任務，呼叫 Cursor SDK |
| **Cursor IDE** | 本機 | 程式碼的實際執行環境；mcp-core 8 工具可供 Cursor AI 使用 |
| **Obsidian vault** | 本機 | 知識庫 `.md`，reindex 到 rag-svc 成為長期記憶 |
| **OpenRouter** | 雲端 | 所有 LLM 統一閘道，主模型 `gemini-2.5-flash` + fallback chain |

---

## 1.6 Multi-Agent 路由規則

| 觸發關鍵字 | 路由 Agent | 模型 |
|---|---|---|
| 程式、code、bug、部署、架構、docker、git… | 💻 工程師 | claude-sonnet-4-6 |
| 策略、產品、OKR、市場、競爭、簡報… | 📊 PM | gemini-2.5-flash |
| 平衡、時間、壓力、目標、迷失… | 🧘 教練 | gemini-2.5-flash |
| 分析、數據、報告、風險、評估… | 🔍 分析師 | gemini-2.5-flash |
| 多個類別同時觸發 | 並行呼叫多個 + Orchestrator 合成 | - |
| 無匹配 | 🧠 OneAI 通用 | gemini-2.5-flash |

---

## 1.7 技能擴展方式

| 想加什麼 | 怎麼做 | 難度 |
|---|---|---|
| 新 Agent 人格（如法律顧問） | `config/oneai.agents.json` + `AGENT_SYSTEMS` 加一條 | ⭐ |
| 新路由關鍵字 | `agents.json` orchestrator.routing_triggers | ⭐ |
| 新 MCP 工具（如網頁截圖） | `mcp-core/src/server.js` 加 tool | ⭐⭐ |
| 上網搜尋能力（Researcher Agent） | Tavily API + 新 agent | ⭐⭐ |
| 新本機 Python 技能 | `worker.py` executor 加 task type | ⭐⭐ |
| Cursor skill 接入 | `cursor_worker.py` dispatch + Cursor `.agents/skills/` | 自動相容 |

---

## 1.8 待辦 / 延後項目

| 項目 | 狀態 | 說明 |
|---|---|---|
| 第二輪 brain/harness/SSE | **本地待 push** | orchestrate-harness、SSE 進度、kind 檢索 |
| Backup Volume 掛載 | **待手動** | `/data/backups` |
| Worker 開機自啟 | **待手動** | `INSTALL-WORKERS.bat`（agy + Cursor 雙排程） |
| LibreChat 恢復 vs 退役 | **待決策** | chat.zeabur.app 404 |
| rag-svc redeploy | **待手動** | kind  metadata 需新映像 |
| Zeabur 清理 video-wizard | **待做** | 4 個 SUSPENDED 服務 |
| dreamone.li Gateway | 延後 | 先用 `.zeabur.app` |

---

## 1.9 核心設計決策

1. **API key 不出伺服器** — PWA 只帶 `VITE_APPROVAL_TOKEN`，OpenRouter key 存 `approval-svc`
2. **反向輪詢** — 本機不開 port，NAT 穿透零設定，最安全
3. **記憶選擇性累積** — 僅 fact/顯式記住寫 RAG；注入最多 2~4 條高相關片段（見 `oneai.memory.json`）
4. **Fallback chain** — 主模型失敗自動嘗試備用模型，確保不中斷
5. **SSOT 設定** — `config/oneai.agents.json` + `config/oneai.models.json` 是所有設定的唯一來源
6. **SW skipWaiting** — 新版 PWA 部署後手機立即接管，不需手動清快取
