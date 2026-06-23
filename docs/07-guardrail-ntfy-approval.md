# 07 - The Guardrail：審核護欄（Human-in-the-Loop）

> ⚠️ **狀態（2026-06-23）**：主推播改 **Web Push（VAPID）** 直連 PWA；**ntfy 延後未部署**。  
> 心跳改輪詢 `approval-svc /health`（非 ntfy SSE）。現役實作見 `services/approval/` + PWA `lib/push.ts`。

## 7.1 目標

在關鍵 / 不可逆動作前強制暫停，推播到手機（Pixel 9a）請求授權。通道：**Web Push**（主）；ntfy（備援，未部署）。

## 7.2 需審核的動作（審核節點）

| 動作 | 需審核 |
|---|---|
| 寄出 Email / 客戶訊息 | 是 |
| 花錢 / 大額預算 / 下單 | 是 |
| 發布公開內容（貼文 / 網頁）| 是 |
| 刪除 / 覆寫重要檔案或資料 | 是 |
| 部署網站 / push 程式 | 否 |

## 7.3 為何 ntfy + Web Push

- **自架 ntfy**：資料自控，topic-based pub/sub，輕量。
- **ntfy 原生 action 按鈕**：通知可內嵌 `http` action 按鈕（Approve / Reject），點按鈕直接對審核服務發 HTTP，免開 App 也能審核。
- **Web Push API**：Pixel 9a 的 Chrome / PWA 透過標準 Web Push（VAPID）收到 OS 級推播，App 關閉也能收。
- ntfy 同時支援 Web Push（VAPID）與即時串流（SSE / WebSocket），供 PWA 前景即時更新。

## 7.4 雙通道：通知 vs 審核

| 類型 | 用途 | 機制 |
|---|---|---|
| 純通知 | digest、監控警示、任務完成 | ntfy 發布 → Web Push |
| 審核 | 寄信 / 花錢 / 發布 / 刪除 | ntfy 通知 + `http` action 按鈕（Approve/Reject）|
| 前景即時 | PWA 開啟時的活動串流 | ntfy SSE / WebSocket |

## 7.5 審核流程

```mermaid
sequenceDiagram
    participant A as Agent (雲端)
    participant H as 審核服務 (Zeabur)
    participant N as ntfy (Zeabur)
    participant P as OneAI PWA (Pixel 9a)
    participant U as 李孟一

    A->>H: 請求審核(action, 摘要, payload)
    H->>H: 建 pending + 逾時設定
    H->>N: publish 通知(摘要 + Approve/Reject action 按鈕)
    N-->>P: Web Push 送達(App 關閉也收)
    P->>U: 手機顯示呼吸卡片 + 兩顆按鈕
    U->>H: 點 Approve / Reject(經 ntfy action 直打 H,或 PWA 內回呼)
    H->>A: 回傳 approved / rejected
    A->>A: 通過才執行;否則中止
    note over H: 逾時未回 → 預設拒絕(安全優先)
```

## 7.6 ntfy 通知（含 action 按鈕）範例

發布審核通知（概念，實作於審核服務）：

```http
POST https://<ntfy-zeabur-domain>/approvals
Title: 需要授權: 寄信給客戶 X
Priority: high
Tags: warning
Actions: http, Approve, https://<approval-svc>/approve/<id>, method=POST, clear=true; http, Reject, https://<approval-svc>/reject/<id>, method=POST, clear=true

主旨: Y
收件人: x@example.com
內容預覽: ......
```

## 7.7 審核服務契約（非阻塞 + 輪詢）

> ⚠️ **設計修正（上線必修）**：早期版本 `POST /request` 會「阻塞」連線達 30 分鐘直到使用者決定，這會被反向代理 / 負載平衡器掐斷而誤判。現改為**非阻塞建立 + 輪詢結果**。

**1) 建立審核** `POST /request`（須帶 `Authorization: Bearer <APPROVAL_TOKEN>`）：

```json
{
  "action": "send_email | spend_money | publish | delete_file | run_command",
  "summary": "要寄信給客戶 X，主旨 Y",
  "details": { "to": "...", "preview": "..." },
  "timeout_sec": 1800,
  "default_on_timeout": "reject"
}
```

立即回 `202`：

```json
{ "approval_id": "uuid", "status": "pending", "poll": "/status/uuid", "timeout_sec": 1800 }
```

**2) 輪詢結果** `GET /status/:id`（唯讀、公開、不含密鑰）：

```json
{ "id": "uuid", "settled": true, "decision": "approved | rejected", "at": 1718800000000 }
```

**3) 使用者決定** `POST /approve/:id?t=<actionToken>` 或 `POST /reject/:id?t=<actionToken>`：

- `actionToken` 為每筆審核專屬的一次性密鑰，**僅隨通知（ntfy action URL / Web Push payload / SSE）下發**；唯有收到通知者持有，外人即使打到端點也無法決定（回 `403`）。
- 已結案重複決定回 `409`。

原則：

- **逾時預設拒絕**（安全優先），由服務端計時器自動結案。
- 通知附足夠摘要（收件人 / 金額 / 預覽），不開電腦也能判斷。
- 每筆審核留稽核紀錄；狀態以 JSON 檔持久化，**服務重啟不遺失待審/決定**並自動重武裝逾時計時器。

## 7.8 與 ruflo / LibreChat 整合

- ruflo hook：執行敏感工具前攔截 → 呼叫審核服務 → 等 decision。
- LibreChat agent：經 `mcp-core` 的 `request_approval` 在敏感步驟呼叫同一審核服務。
- 審核服務部署於 Zeabur（可併入橋接層），與 ntfy 同專案內網互連。

## 7.9 ntfy 部署（Zeabur）

- 以官方 image 自架，pinned 版本。
- 設定 VAPID 金鑰（`web-push-public-key` / `web-push-private-key` / `web-push-email-address`）啟用 Web Push。
- 設定 `base-url` 為對外 HTTPS 網域。
- 開啟存取控制（auth），topic 加 token，避免任何人發布到你的審核 topic。
- 詳見 [03-cloud-librechat-zeabur.md](03-cloud-librechat-zeabur.md) 的服務清單。

## 7.10 機密與鑑權（上線必修）

- ntfy auth token、VAPID 私鑰、審核服務 URL 只放環境變數，不進 git。
- 審核 topic 必須加 token，公開 topic 嚴禁用於審核。
- **組件間鑑權**：agent / bridge → 審核服務的 `/request`、`/notify`、`/pending` 須帶 `Authorization: Bearer $APPROVAL_TOKEN`。未設 token 時服務啟動會警告且端點不鑑權（**僅限本機開發**）。
- **決定端點鑑權**：`/approve`、`/reject` 須帶該筆專屬 `actionToken`（隨通知下發），不靠全域密鑰，故 PWA 前端 bundle 不需內嵌任何服務密鑰。
- 持久化檔（`services/approval/data/approval.json`）含一次性 token，已列入 `.gitignore`，容器內請掛載 volume。

## 7.11 政策引擎（Allowlist 白名單，見 hands/antigravity/policy.py）

- **預設拒絕**：唯有「整條指令」完全命中白名單（唯讀/測試/部署）且不含 shell 串接字元（`; & | \` $() > <`）才自動放行；其餘一律送審。
- 修正重點：舊版用前綴比對，`ls && rm -rf /` 會被誤放行；現偵測 shell 串接/重導向即強制送審。
- 危險樣式黑名單（`rm -rf`、`git push --force`、`drop table`、`curl | bash` 等）作為縱深防禦，命中直接歸類對應 action 送審。

## 7.12 驗收清單

- [ ] 自架 ntfy 在 Zeabur 運作，Web Push（VAPID）啟用。
- [ ] Pixel 9a 的 OneAI PWA 可收到 OS 級 Web Push（App 關閉也收）。
- [ ] 純通知（digest / 警示）可送達。
- [ ] 審核通知含 Approve / Reject 按鈕，點擊正確回傳並結案。
- [ ] 逾時未回 → 預設拒絕、動作中止。
- [ ] 寄信 / 花錢 / 發布 / 刪除 被攔截審核；部署 / push 不被攔截。
- [x] `/request` 非阻塞、改 `/status` 輪詢（不再長連線阻塞）。
- [x] 政策改 allowlist；`ls && rm -rf /` 等繞過手法被攔截送審。
- [x] 組件間 `APPROVAL_TOKEN` 鑑權 + 每筆 `actionToken` 決定鑑權。
- [x] 審核狀態 JSON 持久化、重啟自動重武裝逾時計時器。
