# 08 - 安全與機密管理

> 本系統會接觸 Email、行事曆、檔案、Shell 與對外發布權限。安全是上線前的硬門檻。

## 8.1 第一要務：來源真偽驗證

部署任何第三方 repo 前必須先驗證來源真偽與授權。註：`pewdiepie-archdaemon/odysseus` 經查證為 PewDiePie 本人專案（非仿冒），但因**授權混亂（AGPL/MIT 標示不一）+ vibecoded 安全債**已不採用為雲端大腦，改用 LibreChat（MIT），詳見 [14](14-stack-licensing-research.md)。其餘引用 repo（如 `multica-ai/andrej-karpathy-skills`）仍須逐一驗證。**未通過驗證者不得部署。**

逐一驗證項目：

- [ ] 比對官方來源（專案官網、論文、作者主頁）確認 repo 歸屬。
- [ ] 檢視 commit 歷史、作者、發布節奏是否合理。
- [ ] 審查 `Dockerfile`、`entrypoint`、安裝腳本是否有可疑外連、下載執行、資料外傳。
- [ ] 檢查依賴清單有無惡意 / 仿冒套件。
- [ ] 以 fork + pin commit 方式使用，避免上游被竄改影響你。

## 8.2 機密管理

- 所有 API 金鑰、密碼、token **只放環境變數**（Zeabur env / 本機 `.env`），絕不進 git。
- `.env` 一律列入 `.gitignore`；提供 `.env.example` 範本（不含真值）。
- 金鑰最小權限原則：ntfy token、Email、搜尋 API 各自只給必要 scope。
- 定期輪換金鑰；外洩立即撤銷。

需保護的機密清單：

| 機密 | 用途 | 存放 |
|---|---|---|
| OPENAI_API_KEY / GOOGLE_API_KEY | LLM | Zeabur env |
| ODYSSEUS_ADMIN_PASSWORD | 後台登入 | Zeabur env |
| Obsidian API key | vault 讀寫 | 本機 .env |
| ntfy token / VAPID 私鑰 | 審核 / Web Push | env |
| GitHub token | vault 同步 / PR | env |
| federation 金鑰 | 雲↔本機通道 | 兩端安全儲存 |

## 8.3 網路與曝露面

- 只暴露 LibreChat 的 HTTPS 網域；MongoDB / MeiliSearch / pgvector 不對外。
- `AUTH_ENABLED=true`、`SECURE_COOKIES=true`、`LOCALHOST_BYPASS=false`。
- `ALLOWED_ORIGINS` 限定正式網域。
- federation 通道僅接受已驗證節點。

## 8.4 輸入信任與防注入

- 所有外部輸入（Email 內文、網頁、使用者表單、檔案）預設**不信任**，需清理與驗證。
- 防 prompt injection：對來自 Email / 網頁的內容，限制其能觸發的高權限工具；敏感動作一律走審核護欄。
- 可利用 ruflo 的 AIDefence 類能力做 PII 偵測與注入防護。

## 8.5 最小權限與分層

- vault：`raw/` `insights/` 對 agent 唯讀。
- 敏感動作：寄信 / 花錢 / 發布 / 刪除 一律審核。
- 本機 Shell / Playwright：限定工作目錄與允許指令範圍。

## 8.6 備份與復原

- vault：git 版本歷史即備份，壞了可回溯。
- LibreChat：Zeabur volume 定期快照 / 匯出 MongoDB。
- ChromaDB：可由 vault 重新 index 重建。

## 8.7 失敗情境處理

| 情境 | 處理 |
|---|---|
| LLM API 失敗 / 限流 | 重試 + 備援 provider；通知使用者 |
| 本機離線 | 雲端任務排隊，上線後續跑 |
| 審核逾時 | 預設拒絕，動作中止 |
| federation 斷線 | 自動重連；期間任務暫存 |
| vault 同步衝突 | git 衝突標記，停止自動寫入待人處理 |

## 8.8 驗收清單

- [ ] 6 個 repo 全數通過真偽與 Dockerfile 審查。
- [ ] 無任何金鑰進入 git（掃描確認）。
- [ ] 對外只暴露 LibreChat HTTPS。
- [ ] 敏感動作確實被審核護欄攔截。
- [ ] 備份與復原流程演練過一次。
