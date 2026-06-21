# 01 - OneAI 系統架構（v3，2026-06-21）

> 本文反映**當前實際部署狀態**（v3 = Multi-Agent + Soul/RAG 記憶 + Cursor 執行）。
> 部署細節見 [`infra/zeabur/.deploy-state.md`](../infra/zeabur/.deploy-state.md)。
> 多組織 Agent 授權設計見 [`ADR-001`](ADR-001-multi-agent-architecture.md)。

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
        librechat["LibreChat\n電腦工作台\nmcp-core 5 工具"]
        mongo["MongoDB (marketplace)\nLibreChat 對話+帳號"]
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

    pwa -- "💻 在 Cursor 執行\nPOST /tasks {type:cursor_agent}" --> appr
    appr -- "任務佇列" --> worker
    worker -- "cursor_agent 任務" --> cursor_w
    cursor_w -- "Cursor SDK" --> cursor

    worker -- "長輪詢 /tasks/next" --> appr
    worker -- "心跳 /agents/heartbeat" --> appr

    user -- "桌面工作台" --> librechat
    librechat -- "mcp-core stdio" --> appr
    librechat --> llm
    librechat --> rag

    vault -- "reindex" --> rag
    rag --> mongo
    mongo --> backup
```

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
    participant W as worker.py
    participant CW as cursor_worker.py
    participant C as Cursor IDE

    Note over P: 使用者點「💻 在 Cursor 執行」
    P->>A: POST /tasks { type:cursor_agent, payload:{prompt, code} }
    A-->>P: { id: "task_abc123" }

    loop 輪詢（每 2.5s，最多 90s）
        P->>A: GET /tasks/task_abc123
        A-->>P: { status: "queued" | "running" | "done" }
    end

    W->>A: GET /tasks/next （長輪詢）
    A-->>W: 認領 task_abc123
    W->>CW: 派發 cursor_agent 任務
    CW->>C: Cursor SDK Agent.run(prompt)
    Note over C: 程式碼出現在這裡<br/>（編輯器自動修改/建立檔案）
    C-->>CW: 執行結果
    CW->>A: POST /tasks/task_abc123/result
    A-->>P: { status:done, result: { summary, stdout_tail } }
    P->>P: 顯示「✅ Cursor 完成」
```

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
   └─ rag-svc ChromaDB：每次對話後自動存入
      下次問相關問題時自動召回注入
      來源 1：Obsidian vault .md 文件
      來源 2：每次 Q&A 自動記憶
```

> 目前每次對話存入格式：
> `[對話記憶 2026-06-21] 問：... 答：...`（前 600 字）

---

## 1.5 元件職責總表（v3）

| 元件 | 位置 | 職責 |
|---|---|---|
| **OneAI PWA** | 手機 / 瀏覽器 | 主對話介面、Möbius Orb、Agent 面板、「在 Cursor 執行」按鈕、記憶使用提示 |
| **approval-svc** | Zeabur | **核心**：Orchestrate + 記憶注入 + 任務佇列 + Agent 心跳 + 審核 |
| **rag-svc** | Zeabur | Soul L3：向量查詢 + 記憶寫入（ChromaDB + bge-small-zh） |
| **LibreChat** | Zeabur | 電腦工作台；mcp-core 讓 AI 存取 OneAI 工具 |
| **MongoDB** | Zeabur | LibreChat 對話歷史 + 帳號 |
| **oneai-backup** | Zeabur | 每日 03:00 UTC mongodump，保留 7 天 |
| **Antigravity worker.py** | 本機 | 反向輪詢任務佇列，執行 shell/cursor_agent，30s 心跳 |
| **cursor_worker.py** | 本機 | 認領 `cursor_agent` 任務，呼叫 Cursor SDK → IDE 執行 |
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
| Backup Volume 掛載 | **待手動** | Zeabur Dashboard → oneai-backup → Storage → `/data/backups` |
| Worker 開機自動啟動 | **待手動** | 管理員 PS 執行 `install-worker-task.ps1` |
| cursor_worker.py 啟動 | 手動 | `python hands/cursor-agent/cursor_worker.py` |
| Researcher Agent（上網） | 延後 | 需 Tavily API key |
| dreamone.li Gateway | 延後 | 目前用 `.zeabur.app` 免費網域 |
| GitHub Offsite Backup | 選填 | 設 `GITHUB_BACKUP_TOKEN` 到 backup 服務 |
| Obsidian Mobile 同步 | 選填 | iCloud 或 Obsidian Git plugin |

---

## 1.9 核心設計決策

1. **API key 不出伺服器** — PWA 只帶 `VITE_APPROVAL_TOKEN`，OpenRouter key 存 `approval-svc`
2. **反向輪詢** — 本機不開 port，NAT 穿透零設定，最安全
3. **記憶自動累積** — 每次對話後 `/remember` 非同步存入，不影響回應速度
4. **Fallback chain** — 主模型失敗自動嘗試備用模型，確保不中斷
5. **SSOT 設定** — `config/oneai.agents.json` + `config/oneai.models.json` 是所有設定的唯一來源
6. **SW skipWaiting** — 新版 PWA 部署後手機立即接管，不需手動清快取
