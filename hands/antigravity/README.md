# hands — 本機肉體 (The Hands / Antigravity)

雲端大腦透過 ruflo 加密橋接，調用本機 Antigravity CLI 做重度編碼/測試/系統操作。**危險操作先過審核服務**（逾時預設拒絕）。部署免審核。

## 模組（單一職責）

| 檔案 | 職責 |
| --- | --- |
| `policy.py` | 政策引擎：判斷指令/任務是否需審核 |
| `approval_client.py` | 呼叫 approval-svc 並阻塞等決定（零相依） |
| `cli_bridge.py` | subprocess 包裝 Antigravity CLI / shell |
| `executor.py` | 進入點：政策 → 審核 → 執行 → 精簡結果 |

## 使用

```bash
# 安全指令直接跑(自動放行)
python hands/antigravity/executor.py git status

# 危險指令會先送手機審核(需先啟動 approval-svc)
python hands/antigravity/executor.py "rm -rf build"

# 高層任務交給 Antigravity CLI
python hands/antigravity/executor.py --task code_test "跑完 e2e 測試並回報"
```

## 環境變數

| 變數 | 預設 | 說明 |
| --- | --- | --- |
| `APPROVAL_BASE_URL` | `http://localhost:8787` | 審核服務位址 |
| `ANTIGRAVITY_CMD` | `agy` | 你電腦上的 Antigravity CLI 執行檔名 |
| `AGY_BRIDGE_TIMEOUT` | `600` | 單次執行逾時(秒) |

## 待辦

- [ ] 對齊真實 Antigravity CLI 的 headless 旗標與輸出格式（`cli_bridge.run_agent_task`）。
- [ ] 評估改用官方 Python SDK 以取得更細的政策/串流控制（見 `docs/12-antigravity-hands.md`）。
- [ ] 由 ruflo node 將此 executor 註冊為可遠端調用的工具。
