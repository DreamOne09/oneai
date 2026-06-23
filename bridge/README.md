# bridge — MCP 與本機橋樑

> **2026-06-23**：雲↔本機任務走 **approval-svc `/tasks` + worker.py**（非 federation）。  
> `mcp-core` 供 LibreChat/Cursor MCP 使用。文件 → [docs/12](../docs/12-antigravity-hands.md)、[docs/05](../docs/05-bridge-mcp-federation.md)。

## 兩個部分

### 1. `mcp-core/` — MCP 工具伺服器（stdio）

只暴露 host（LibreChat）沒有的能力；LLM 對話本身由 LibreChat 負責。

| 工具 | 支柱 | 說明 |
| --- | --- | --- |
| `vault_query` | 大腦 | 檢索知識庫（呼叫 `brain/rag/query_vault.py`，**回傳已限長防 host OOM**） |
| `remember` | 大腦 | 寫回記憶到 vault（自我進化） |
| `request_approval` | 審核 | 送手機審核並等決定 |
| `run_local_command` | 肉體 | 本機指令（危險先審核） |
| `run_local_task` | 肉體 | 高層任務交 Antigravity |

啟動：

```bash
npm install                       # repo 根
npm run check -w bridge/mcp-core  # 語法檢查
node bridge/mcp-core/src/server.js
```

掛載到 LibreChat / Cursor / Claude 的 MCP 設定（stdio）：

```json
{
  "mcpServers": {
    "mcp-core": {
      "command": "node",
      "args": ["bridge/mcp-core/src/server.js"],
      "env": {
        "APPROVAL_BASE_URL": "https://...",
        "VAULT_MAX_CHARS": "8000"
      }
    }
  }
}
```

> `VAULT_MAX_CHARS` 控制 `vault_query` 整體回傳字元預算（預設 8000），避免 LibreChat 把大回傳整包讀進記憶造成 OOM。

### 2. `_deprecated/federation/` — 已退役

雲↔本機任務改走 **approval-svc `/tasks` + worker.py**。`ruflo.config.example.yaml` 僅作歷史參考。
