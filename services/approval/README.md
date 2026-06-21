# approval-svc — Human-in-the-Loop 審核服務

關鍵動作（寄信、花費、發布、刪檔、執行指令）暫停並推播到手機，等你按「允許／拒絕」。逾時預設**拒絕**（fail-safe）。部署不需審核。

## 端點

| 方法 | 路徑 | 說明 |
| --- | --- | --- |
| POST | `/request` | 建立審核並**阻塞等待**決定，回 `{ approval_id, decision }`。body：`{ action, summary, details?, timeout_sec?, default_on_timeout? }` |
| POST | `/approve/:id` | 核准（ntfy http 按鈕 / PWA / SW 都打這支） |
| POST | `/reject/:id` | 拒絕 |
| GET | `/status/:id` | 查詢決定 |
| GET | `/pending` | 列出待審 |
| POST | `/push/subscribe` | PWA 回報 Web Push 訂閱 |
| POST | `/notify` | 純通知（不需決定） |
| GET | `/health` | 健康檢查 |

`action` 限：`send_email` `spend_money` `publish` `delete_file` `run_command`。

## 本機啟動

```bash
npm install                 # 於 repo 根 (workspaces)
npm run gen-vapid -w services/approval   # 產 VAPID 金鑰，填入 .env
npm run dev -w services/approval
```

未設 `NTFY_BASE_URL` / VAPID 時自動進「示範模式」（不推播，仍可手動 approve/reject）。

## 環境變數

見根目錄 `.env.example` 的 ntfy / 審核 / VAPID 區段。
