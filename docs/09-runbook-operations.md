# 09 - 操作手冊與維運 Runbook

## 9.1 日常啟動

- **雲端 LibreChat**：常駐於 Zeabur，無需手動啟動。檢查健康狀態：開 HTTPS 網域能登入即可。
- **本機 daemon**：確認 ruflo federation node 正在執行（建議開機自動啟動）。
- **Obsidian**：開啟 vault，確認 `obsidian-git` 與 `Local REST API` plugin 啟用。

## 9.2 常用操作

| 想做的事 | 怎麼做 |
|---|---|
| 下指令給 agent | LibreChat Web UI 對話，或 Cursor 內 |
| 讓 agent 跑本機測試 | Web UI 指派，PM 經 federation 派到本機 |
| 收審核通知 | OneAI PWA / ntfy（手機 Pixel 9a）|
| 產簡報 | 指定主題 → 研究 → pptx skill 產出 |
| 查/寫筆記 | Obsidian 直接編輯，或 agent 經 obsidian-mcp |
| 看排程任務 | LibreChat / 排程面板 |

## 9.3 健康檢查

```mermaid
flowchart LR
    c1["LibreChat 網域可登入?"] --> c2["chat 可回應?"]
    c2 --> c3["ChromaDB 檢索正常?"]
    c3 --> c4["本機 daemon 在線?"]
    c4 --> c5["federation status 正常?"]
    c5 --> c6["ntfy Web Push 可達手機?"]
```

任一節點異常 → 對照 9.5 故障排除。

## 9.4 例行維護

- 每週：檢視 Zeabur 用量與成本；清理過期 sessions / 暫存。
- 每週：確認 vault git 同步無衝突；備份 SQLite。
- 每月：輪換高風險金鑰；跑一次 `ruflo metaharness` 掃描設定。
- 每月：演練一次備份復原。

## 9.5 故障排除

| 症狀 | 可能原因 | 處置 |
|---|---|---|
| Web UI 無法登入 | 服務當機 / 密碼錯 | 看 Zeabur logs；確認 admin 密碼 env |
| chat 無回應 | LLM 金鑰失效 / 限流 | 換金鑰；檢查額度 |
| 檢索不到 vault 內容 | 未 ingest / index 落後 | 跑全量 index；確認雲端 pull |
| 本機任務沒被執行 | daemon 沒開 / federation 斷 | 啟動 daemon；`federation status` 重連 |
| 收不到審核通知 | Web Push 訂閱失效 / ntfy token 錯 / VAPID 不符 | 重新訂閱；檢查 ntfy 與 VAPID 設定 |
| vault 同步衝突 | 多端同改 | 解 git 衝突；暫停自動寫入 |
| Playwright 失敗 | 環境 / 選擇器變更 | 看精簡 log；更新測試 |

## 9.6 升級流程

- LibreChat / ruflo / plugins 升級前：先在測試環境驗證，pin 新版 commit。
- 升級後：跑健康檢查 + 一輪情境煙霧測試（S01 / S10 / S13）。

## 9.7 日誌與觀測

- LibreChat：Zeabur logs。
- ruflo：cost-tracker / observability plugin 追 token 與成本。
- 審核：審核服務稽核紀錄。
- federation：審計紀錄。

## 9.8 文件維護

依專案規則，新增 / 修改功能後主動更新對應 docs 與 README。
