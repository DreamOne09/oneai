# 18 - 主待辦清單（Master Checklist）

> **用途**：整合多輪對話所有建議；**區分「程式已交付」vs「你要在本機/Zeabur 動手」**。  
> **最後模擬**：2026-06-23 → **9/10**（AI 環境驗證；**你本地尚未執行** → 見 [§2](#2-本地必做你還沒動)）  
> **驗收**：每完成 §2 一項 → 勾選 → 跑 `python scripts/user-scenario-sim.py`  
> **相關**：[00-start-here](00-start-here.md) · [17-lessons-learned](17-lessons-learned-and-war-stories.md)

---

## 1. 現況快照（2026-06-23）

| 類別 | 狀態 |
|------|------|
| **GitHub 雲端** | approval + PWA 自動部署 ✅；程式 commit 至 `cade316` |
| **AI 代跑驗證** | 10 情境 **9/10**；e2e **21/21**；brain-intel **21/21** |
| **你的本機** | ⚠️ **尚未執行** worker / cursor_worker / Zeabur CLI / 手機實測 |
| **卡關項** | 僅 **S3** 記憶召回（需 DEP-04 rag redeploy + 可選 reindex） |

> **重要**：WRK-01、WRK-02 在 AI 對話裡曾代跑過 worker，**不代表你的電腦已設定完成**。關機後 S6/S7 會再失敗，請依 §2 自己做一次。

---

## 2. 本地必做（你還沒動）

按順序做；每步完成後在 [§6 勾選記錄](#6-勾選記錄) 填日期。

### 步驟 0 — 確認 `.env`（repo 根目錄）

```powershell
cd C:\Users\b1993\.cursor\projects\empty-window
# 確認至少有：
# APPROVAL_BASE_URL=https://oneai-approval.zeabur.app
# APPROVAL_TOKEN=...
# ONEAI_CHAT_TOKEN=...
# ONEAI_WORKER_TOKEN=...   ← 與 Zeabur approval-svc 相同
# TAVILY_API_KEY=...       ← 搜尋用
# ZEABUR_TOKEN=sk-...      ← 下面 Zeabur 步驟需要（先從 Dashboard 複製）
```

| ID | 狀態 | 你要做什麼 | 驗收 |
|----|------|------------|------|
| LOC-00 | [ ] | 確認 `.env` 上述變數存在 | `python scripts/brain-smoke.py` → SMOKE OK |

---

### 步驟 1 — 本機 Worker（桌機 Shell / S6 / S7）

**對應清單**：WRK-01、WRK-02

```powershell
cd C:\Users\b1993\.cursor\projects\empty-window

# 方式 A（建議）：管理員 PowerShell
.\INSTALL-WORKER.bat
# → 會裝排程，開機自動跑 worker

# 方式 B（手動測試）：開一個常駐終端機
python hands\antigravity\worker.py
# 看到「OneAI 本機肉體 worker 啟動 → https://oneai-approval...」即 OK
```

| ID | 狀態 | 任務 | 驗收 |
|----|------|------|------|
| WRK-01 | [ ] | 執行 **INSTALL-WORKER.bat** 或常駐 `worker.py` | `GET /agents/status` 非空 |
| WRK-02 | [ ] | 手機 PWA → 設定 → 桌機 Shell → `echo test` | S7 通過 |

**注意**：worker 終端機要**一直開著**（或用排程）；關掉 = S7 又 queued。

---

### 步驟 2 — Cursor Worker（S10 任務真正執行）

**對應清單**：WRK-03

```powershell
# 另開一個終端機（與 worker.py 並行）
cd C:\Users\b1993\.cursor\projects\empty-window
python hands\cursor-agent\cursor_worker.py
```

| ID | 狀態 | 任務 | 驗收 |
|----|------|------|------|
| WRK-03 | [ ] | 常駐 `cursor_worker.py` | S10 任務 status=done（非僅入列） |

---

### 步驟 3 — Zeabur：rag redeploy（解 S3 記憶召回）

**對應清單**：DEP-04、M-01（雲端）

```powershell
cd C:\Users\b1993\.cursor\projects\empty-window

# .env 要有 ZEABUR_TOKEN
python scripts\zeabur-cli.py redeploy --service-id rag
python scripts\zeabur-cli.py audit --service-id 6a36aec746477d6038840bda

# 等 2~3 分鐘後
python scripts\brain-smoke.py
python scripts\user-scenario-sim.py   # 目標 10/10
```

| ID | 狀態 | 任務 | 驗收 |
|----|------|------|------|
| DEP-04 | [ ] | redeploy **rag-svc** `6a36aec746477d6038840bda` | `/brain/summary` status=ok |
| M-01 | [ ] | （可選）rag Volume 持久化後 reindex | S3 通過 |

**Zeabur Dashboard 建議**：rag-svc 掛 **Volume** 到 Chroma 資料目錄，避免 redeploy 記憶消失。

---

### 步驟 4 — 安全：輪替 Zeabur Token

**對應清單**：SEC-01

1. [Zeabur Dashboard](https://dash.zeabur.com) → Settings → API → **Revoke 舊 token** → 建新 token  
2. 更新本機 `.env` 的 `ZEABUR_TOKEN=...`  
3. 勿再把 token 寫進任何 `.py` 檔

| ID | 狀態 | 任務 | 驗收 |
|----|------|------|------|
| SEC-01 | [ ] | 輪替 Zeabur API token | 舊 token 401 |

---

### 步驟 5 — Zeabur 清理（可選，建議）

**需** `ZEABUR_TOKEN`

```powershell
python scripts\zeabur-cli.py services
# 手動在 Dashboard 刪：4× video-wizard、app-gateway-v2（無網域）
# oneai-backup 掛 Volume /data/backups
```

| ID | 狀態 | 任務 |
|----|------|------|
| ZBR-01 | [ ] | 刪 4× video-wizard |
| ZBR-02 | [ ] | 刪 app-gateway-v2 |
| ZBR-03 | [ ] | oneai-backup 掛 Volume |

---

### 步驟 6 — 手機實機驗收

**對應清單**：TST-03、H-01

1. 開 https://oneai-mengyi.zeabur.app  
2. 設定 → 開啟推播  
3. 聊天 → 記憶氣泡點一下 → 應跳 Memory Tab 並高亮  
4. 複雜問題 → 看 SSE 真實進度（非假輪播）

| ID | 狀態 | 任務 |
|----|------|------|
| TST-03 | [ ] | 手機實機 Web Push + 記憶跳轉 + 合成模式 |
| H-01 | [ ] | 記憶卡片可點 → Memory Tab |

---

### 步驟 7 — 一鍵驗收（每完成上面任一步就跑）

```powershell
cd C:\Users\b1993\.cursor\projects\empty-window
node scripts\brain-intel.test.js
python scripts\brain-smoke.py
python scripts\e2e-test.py
python scripts\user-scenario-sim.py
python scripts\human-loop-sim.py
```

| ID | 狀態 | 任務 | 目標 |
|----|------|------|------|
| TST-01 | [ ] | 10 情境 | **≥ 9/10**（你本地驗）→ 理想 **10/10** |
| TST-02 | [ ] | human-loop | learned ≤ 2/5 |

---

## 3. 程式已交付（AI / GitHub 已完成，無需你再寫）

### Phase 0 部署

| ID | 狀態 | 說明 |
|----|------|------|
| DEP-01~03 | [x] | push + approval/PWA 自動 build |
| DEP-05~08 | [x] | smoke / e2e / unit test（AI 環境） |
| DEP-04 | [ ] | **需你在 §2 步驟 3 做** |

### Phase 1 清理

| 區塊 | 狀態 |
|------|------|
| SEC-02~04, DKR-*, CLN-* | [x] 全部完成 |

### Phase 2 架構

| ID | 狀態 | 說明 |
|----|------|------|
| ARC-01/02 | [x] | LibreChat 退役 |
| ARC-03 | — | 不適用（已選退役） |
| ENV-01 | [ ] | 確認 Zeabur PWA `VITE_CHAT_TOKEN` ≠ service token |

### Phase 3 大腦優化（雲端已上線，情境已驗）

| ID | 狀態 | 情境 |
|----|------|------|
| A-01~A-05 | [x] | S1/S2/S4 ✅ |
| F-01 | [x] | S5 ✅ |
| G-01 | [x] | S9 SSE ✅ |
| I-01 | [x] | S8 ✅ |
| J-01~J-02, K-01, L-01 | [x] | harness 已合併 |
| M-01 kind | [ ] | 需 DEP-04 redeploy rag |
| WRK-04/05 | [x] | cli_bridge + agents-config.js |
| WRK-01~03 | [ ] | **§2 你要跑** |

---

## 4. 十種使用者情境（最新）

**執行**：`python scripts/user-scenario-sim.py`  
**結果**：`scripts/user-scenario-results.json`  
**時間**：2026-06-23T11:29:28Z（**AI 環境**，commit `cade316`）

| # | 情境 | 結果 | 你要做才能穩定 |
|---|------|------|----------------|
| S1 | 寒暄 | ✅ | — |
| S2 | 記住 | ✅ | — |
| S3 | 調記憶 | ❌ | **DEP-04** rag redeploy |
| S4 | 搜尋 | ✅ | — |
| S5 | 多 Agent | ✅ | — |
| S6 | 系統在線 | ✅* | **WRK-01**（你本機） |
| S7 | 桌機 Shell | ✅* | **WRK-01/02**（你本機） |
| S8 | 記憶 Tab | ✅ | — |
| S9 | SSE 進度 | ✅ | — |
| S10 | Cursor 入列 | ✅ | **WRK-03** 才會真正執行 |

\* S6/S7 在 AI 代跑 worker 時通過；**你關機後需重做 §2 步驟 1**。

**通過率：9/10**（目標：你完成 §2 步驟 3 後 → **10/10**）

---

## 5. 建議你這週怎麼做（精簡版）

```
今天   LOC-00 確認 .env
       WRK-01 INSTALL-WORKER.bat + 驗 S6/S7
明天   DEP-04 rag redeploy + user-scenario-sim → 10/10
       SEC-01 輪替 Zeabur token
之後   WRK-03 cursor_worker（若要 Cursor 自動跑）
       TST-03 手機實機
       ZBR-01~03 Zeabur 清理（有空再做）
```

---

## 6. 勾選記錄

| 日期 | 誰做 | 完成 ID | 備註 |
|------|------|---------|------|
| 2026-06-23 | AI | DEP-01~08, CLN-*, ARC-*, G-01, I-01 | push + 雲端 deploy |
| 2026-06-23 | AI | WRK-04/05, memory recall 程式 | agents-config、harness |
| 2026-06-23 | AI | TST-01（9/10） | 代跑 worker，非用戶本機 |
| | **你** | LOC-00 | |
| | **你** | WRK-01 | |
| | **你** | WRK-02 | |
| | **你** | DEP-04 | |
| | **你** | SEC-01 | |
| | **你** | TST-03 | |

---

## 7. 優化路線圖（完成 §2 之後）

| 優先 | 方向 | 清單 ID |
|------|------|---------|
| P0 | rag Volume + 記憶持久化 | DEP-04, M-01 |
| P1 | Cursor 任務端到端 | WRK-03 |
| P2 | 手機 UX 實機 | TST-03, H-01 |
| P3 | Zeabur 瘦身 + backup | ZBR-01~03 |
| P4 | 長期 Phase C | C-01~06 |

---

*維護規則：AI 改程式 → 更新 §3；你完成本地步驟 → 更新 §2 勾選 + §4 重跑 sim + §6 填日期。*