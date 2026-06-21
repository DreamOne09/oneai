# 授權清單（Third-Party Licenses）

> 本專案**自寫程式**採 [MIT](LICENSE)。下表列出所採用第三方元件的授權，用於確認「複製給客戶」之合法性。
> 原則：優先採用 MIT / Apache-2.0 / BSD（寬鬆，三種商業模式皆安全）。授權以各專案 GitHub LICENSE 檔為準。
> 詳細選型理由見 [docs/14-stack-licensing-research.md](docs/14-stack-licensing-research.md)。

## 自寫程式（本 repo）

| 模組 | 授權 |
|---|---|
| `apps/oneai-pwa` | MIT |
| `services/approval` | MIT |
| `brain/`（RAG 腳本、寫回迴圈） | MIT |
| `bridge/`（MCP 橋樑） | MIT |
| `hands/`（政策/執行包裝） | MIT |

## 採用的第三方元件

| 元件 | 用途 | 授權 | 給客戶安全? |
|---|---|---|---|
| LibreChat | 雲端大腦 / 桌面 UI / 控制平面（Agents/MCP/RAG/記憶/多用戶） | MIT | ✅ |
| Hermes Agent | 24/7 自走 worker（持久記憶 + 自寫 skill），Phase C | MIT | ✅ |
| obsidian-mcp（`lstpsche/obsidian-mcp`） | Obsidian vault 讀寫（Rust 單檔、檔案直存、免外掛） | MIT | ✅ |
| ntfy | 推播 / 護欄通知 | Apache-2.0（或 GPLv2，採 Apache） | ✅ |
| ChromaDB | 向量庫（現用） | Apache-2.0 | ✅ |
| sqlite-vec | 向量庫（更輕替代，評估中） | Apache-2.0 | ✅ |
| Tailscale client | 網路通道（個人用） | BSD-3（client） | ✅ |
| Headscale | 自架控制面（客戶用，取代 Tailscale SaaS） | BSD-3 | ✅ |
| LangGraph / CrewAI | 多 agent 編排（需要時才加） | MIT | ✅ |
| Aider | 本機手（客戶版替代 Antigravity） | Apache-2.0 | ✅ |
| Vite / React / react-three-fiber / Framer Motion | PWA 前端 | MIT | ✅ |
| Express / web-push | 審核服務 | MIT | ✅ |

## ⚠️ 須注意 / 不採用

| 元件 | 授權 | 為何注意 |
|---|---|---|
| Antigravity（Google） | 專有 | 個人用可；**客戶版須換 Aider/OpenAI Agents SDK** |
| OpenOneAI（Stanford） | Apache-2.0（授權沒問題） | **口袋方案、現不採用**：local-first 框架與我方雲端優先架構相衝、會成第二控制平面/記憶。僅「資料絕不出本機/裝置端訓練」的極重隱私客戶版才回頭採用。詳見 docs/14 §14.x。 |
| guarded-mcp（`fernandosmither`） | MIT（思路借用，未整包採用） | 借兩個安全點子到自寫審核：參數 SHA-256 執行前驗證、審核只顯示原始參數防操弄。 |
| OpenClaw | MIT（授權沒問題） | **評估後棄用（安全）**：總管/Gateway 層多個 critical CVE（CVE-2026-32922 CVSS 9.9 權限提升→RCE、25253 一鍵 RCE、43585 token 輪替失效）、512 漏洞審計、ClawHub 供應鏈投毒；且功能與我方 LibreChat/Obsidian/mcp-core/approval 重疊。詳見 docs/15.9 ADR。 |
| Odysseus | AGPL-3.0（標示混亂） | 個人嚐鮮可；**不作客戶地基**（AGPL 傳染 + 授權不明 + vibecoded 安全債） |
| Open WebUI | 專有品牌條款（v0.6.6+） | **不採用**：50 人以上不得去除品牌，無法白牌 |

## 維護規則

- 引入任何新依賴前，先確認其授權落在 MIT / Apache-2.0 / BSD；若為 GPL/AGPL/專有，須先評估商業模式相容性並更新本檔。
- AGPL / 專有品牌條款元件**預設不引入**，除非確定走「per-client 自管 + 給原始碼」模式。
