# 19 — 部署方式與本機 Worker（SSOT）

> **用途**：回答「推 Zeabur CLI 還是 GitHub？」「agy 和 Cursor 有通嗎？」「worker 怎麼常駐？」  
> **最後更新**：2026-06-23  
> **程式 SSOT**：[`config/oneai.system-architecture.json`](../config/oneai.system-architecture.json)

---

## 1. 部署：什麼用 GitHub，什麼用 Zeabur CLI

| 元件 | 怎麼上線 | 你該做什麼 |
|------|----------|------------|
| **oneai-approval** | `git push origin master` → Zeabur **自動** build | 改 code → commit → push，等 2~3 分鐘 |
| **oneai-pwa-v2** | 同上（GitHub 連動） | 同上 |
| **rag-svc** | **非** Git 自動；Zeabur 手動 deploy | `python scripts/zeabur-cli.py redeploy --service-id rag` |
| **oneai-backup** | 映像手動 / 少改 | Dashboard 掛 Volume |
| **worker.py** | **不在雲端** | 本機 `INSTALL-WORKERS.bat` |
| **cursor_worker.py** | **不在雲端** | 本機 `INSTALL-WORKERS.bat` |

### 結論（一句話）

- **改 PWA / approval**：**push GitHub**，不要手動 zeabur deploy（除非 GitHub 壞掉）。
- **改 brain/rag**：**Zeabur CLI redeploy rag-svc**。
- **本機執行能力**：**跟雲端無關**，必須在你 Windows 桌電常駐 worker。

Service ID → [`infra/zeabur/.deploy-state.md`](../infra/zeabur/.deploy-state.md)

---

## 2. agy 和 Cursor CLI 真的有通嗎？

**有通，但不是「agy 轉給 Cursor」——是兩條平行線，都連同一個雲端佇列。**

```
                    approval-svc /tasks 佇列
                           │
           ┌───────────────┼───────────────┐
           │               │               │
    type=shell,agent   type=cursor_agent   （PWA 輪詢結果）
           │               │
    worker.py         cursor_worker.py
    （agy / shell）      （Cursor SDK）
           │               │
    executor.py         Cursor IDE
    AgyPanel 控桌機      改 repo 裡的 code
```

| 問題 | 答案 |
|------|------|
| agy 會自動叫 Cursor 嗎？ | **不會**。`worker.py` 只認領 `?type=shell,agent` |
| Cursor 任務誰認領？ | **`cursor_worker.py`** 只認領 `?type=cursor_agent` |
| 只跑一個 worker 夠嗎？ | **不夠**。Shell 要 agy；Cursor 要 cursor_worker |
| 手機怎麼觸發 Cursor？ | PWA → `POST /tasks { type: cursor_agent }` → cursor_worker 認領 |
| 手機怎麼控 Shell？ | PWA AgyPanel → `POST /tasks { type: shell }` → worker.py 認領 |

程式碼依據：

- `hands/antigravity/worker.py` → `GET /tasks/next?type=shell,agent`
- `hands/cursor-agent/cursor_worker.py` → `GET /tasks/next?type=cursor_agent`
- `services/approval/src/server.js` → `VALID_TASK_TYPES = ['shell', 'agent', 'cursor_agent']`

> ⚠️ 舊版 `docs/01-architecture.md` 曾畫成 worker → cursor_worker 轉派，**那是錯的**，已修正。

---

## 3. Worker 常駐：推薦做法

### 方案 A（推薦）：Windows 工作排程器 — 雙任務

```powershell
# 右鍵「以系統管理員身分執行」
cd C:\Users\b1993\.cursor\projects\empty-window
.\INSTALL-WORKERS.bat
```

會建立：

| 排程名稱 | 行程 | 日誌 |
|----------|------|------|
| `OneAI-Worker` | `hands/antigravity/worker.py` | `%TEMP%\oneai-worker.log` |
| `OneAI-CursorWorker` | `hands/cursor-agent/cursor_worker.py` | `%TEMP%\oneai-cursor-worker.log` |

特性：登入自動啟動、失敗 1 分鐘重試、筆電接電也跑。

### 方案 B：手動兩個終端機（除錯用）

```powershell
cd C:\Users\b1993\.cursor\projects\empty-window
python hands\antigravity\worker.py
# 另開終端機：
python hands\cursor-agent\cursor_worker.py
```

關終端機 = 離線。

### 方案 C（進階）：NSSM 裝成 Windows Service

比排程器更「服務化」，但設定較繁。目前 **YAGNI**，排程器已足夠。

### 方案 D（未來）：單一 supervisor 腳本

一個 Python 父行程 fork 兩個 worker — 尚未實作；排程器雙任務更簡單、crash 互不干擾。

### .env 必填（兩個 worker 共用）

```
APPROVAL_BASE_URL=https://oneai-approval.zeabur.app
ONEAI_WORKER_TOKEN=<與 Zeabur approval-svc 相同>
CURSOR_API_KEY=<Cursor 使用者 API key>   ← cursor_worker 專用
CURSOR_AGENT_CWD=C:\Users\b1993\.cursor\projects\empty-window  ← 可選
```

### 驗收

```powershell
# 1) 手動觸發排程（安裝後）
schtasks /Run /TN OneAI-Worker
schtasks /Run /TN OneAI-CursorWorker

# 2) 等 10 秒看日誌
notepad $env:TEMP\oneai-worker.log
notepad $env:TEMP\oneai-cursor-worker.log

# 3) 雲端應看到兩個 agent 心跳
curl -s https://oneai-approval.zeabur.app/agents/status
```

---

## 4. 典型工作流（人類視角）

1. **手機** 跟梅蘭對話 → 工程師給方案  
2. 點 **「送到 Cursor（選專案）」** → 選 repo 路徑、看摘要（不看 code）  
3. **進行中列** 顯示 `📁 專案名 · 摘要 · 執行中`  
4. **桌電** `cursor_worker` 用 Cursor SDK 在該 repo 改檔  
5. **手機** 收到文字摘要（非 diff）

若要 **echo test** 這類 Shell → 用 **AgyPanel**，走 `worker.py`，不走 Cursor。

---

## 5. 推送 Cursor UX 改動（目前本地未 push）

本地有 PWA Cursor 面板 + approval heartbeat 改動，要上線：

```powershell
git add apps/oneai-pwa services/approval hands/cursor-agent docs config
git commit -m "feat(pwa): Cursor 控制 UX + 雙 worker 安裝 + 架構 SSOT"
git push origin master
# 等 Zeabur 自動 build approval + PWA（約 2~3 分鐘）
# rag 沒改就不用 redeploy
```

---

## 6. 記憶分層（2026-06-23 更新）

| 層 | kind | 誰寫 | 誰讀 |
|----|------|------|------|
| L1 靜態 prompt | — | `agents-config.js` + JSON | 每次 orchestrate |
| L3 個人 | **preference**（事實） | 顯式「記住」/ fact 信號 / 手動 | RAG 語意检索 |
| L3 系統 | **system** | 啟動 seed | 架構/worker 問題 |
| ~~episodic~~ | ~~memory~~ | **已關閉自動寫入** | 舊資料仍在庫內 |

### 寫入政策（`config/oneai.memory.json`）

**預設不存整段對話。** 只有以下會寫 RAG：

1. 你說「**記住：**…」
2. 訊息含 **durable fact 信號**（偏好、行程、deadline、決定…）
3. PWA 手動寫入
4. 系統 SSOT seed

**不會寫入：** 寒暄、純搜尋、純分析建議、架構問答、長回覆但無新事實。

**格式：** 只存 `## 事實` 一行（最多 ~220 字），**不存 Q&A transcript**。

### 注入政策（進上下文）

| 情境 | 最多注入 |
|------|----------|
| 一般對話 | 2 條（score≥0.6） |
| 召回意圖 | 4 條（score≥0.2） |
| 系統知識 | 2 條 |

寫入前去重 ≥0.95；舊 episodic 記憶需 Butler 整理或手動刪（Phase B）。

---

## 7. 相關文件

| 文件 | 內容 |
|------|------|
| [01-architecture.md](01-architecture.md) | 架構圖（已修正 worker 關係） |
| [18-master-checklist.md](18-master-checklist.md) | §2 本地必做 WRK-01~03 |
| [12-antigravity-hands.md](12-antigravity-hands.md) | agy worker 細節 |
| [00-start-here.md](00-start-here.md) | 5 分鐘速覽 |
