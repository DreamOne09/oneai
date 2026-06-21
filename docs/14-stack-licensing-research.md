# 14 - 技術選型與授權研究（最佳實踐 / MIT 可複製給客戶）

> 狀態：研究完成，建議已定。雲端大腦「換 LibreChat」屬單向門，待孟一最終點頭。
> 目的：避免重複造輪子；確保每個關鍵節點都是最佳實踐且授權可白牌複製給客戶。
> 研究日期：2026-06。所有授權以各專案 GitHub 上的 LICENSE 檔為準（次級評測常寫錯）。

## 北極星：授權安全（複製給客戶）

「複製給客戶」對授權的要求依商業模式而定：

| 商業模式 | 可接受授權 | 須避免 |
|---|---|---|
| 幫每個客戶各裝一份、原始碼給他自管 | MIT / Apache / BSD / 甚至 AGPL | 專有閉源條款 |
| 我們自跑 SaaS 服務客戶、不公開程式 | **僅 MIT / Apache / BSD** | **AGPL（網路著作傳染）**、專有品牌條款 |
| 白牌（我們品牌、可閉源改作） | **僅 MIT / Apache / BSD** | AGPL、Open WebUI 品牌條款 |

孟一目前商業模式未定 → **預設走最安全：全寬鬆授權（MIT/Apache/BSD）**，這樣三種模式都安全。

## 各節點授權體檢

| 節點 | 採用 | 授權 | 給客戶安全? | 備註 |
|---|---|---|---|---|
| 雲端大腦 / UI | **LibreChat** | MIT | ✅ 任意白牌 | 自帶 Agents/MCP/RAG/記憶/多用戶認證 |
| 推播 / 護欄 | ntfy | Apache-2.0（或 GPLv2，可選 Apache） | ✅ | 自架 |
| 網路通道 | Tailscale（個人）→ Headscale（客戶） | client BSD-3 / Headscale BSD-3 | ✅ | 取代手刻 mTLS |
| 向量庫 | Chroma（現用）/ sqlite-vec（更輕） | Apache-2.0 | ✅ | sqlite-vec 單檔、零依賴、適合個人庫 <50 萬向量 |
| 多 agent（需要再加） | LangGraph / CrewAI | MIT | ✅ | v0 先用 LibreChat 內建 agents，YAGNI |
| 本機手（個人） | Antigravity | **專有（Google）** | ⚠️ | 個人用可；**給客戶須換 MIT 替代** |
| 本機手（客戶替代） | Aider / OpenAI Agents SDK | Apache-2.0 / MIT | ✅ | 客戶版避免綁 Google 專有 CLI |
| 我們自寫程式（PWA/審核/brain/bridge） | 設 **MIT** | MIT | ✅ | 見根目錄 `LICENSE` |

完整第三方清單見 [`/LICENSES.md`](../LICENSES.md)。

## 雲端大腦：Odysseus vs LibreChat（深入比較）

| 維度 | Odysseus（PewDiePie） | LibreChat |
|---|---|---|
| 授權 | ⚠️ **混亂**：GitHub 標 AGPL-3.0，部分評測說 MIT | ✅ **MIT**（明確） |
| 成熟度 | 🔴 2026-05-31 發布、僅數週，dev 分支不穩 | ✅ 2023 起、92 版本、被 ClickHouse 收購 |
| 開發方式 | 🔴「vibecoded」AI 快速生成、部分用手機寫、無架構審查 | ✅ 正規工程、370 貢獻者 |
| 安全 | 🔴 已被資安研究員打出 1-click RCE、SSRF+越權、agent 可讀 `auth.json`/session token、無檔案沙箱、fail-open 認證 | ⚠️ 歷史有 SSRF/log-injection，已修、較成熟 |
| 功能廣度 | ✅ email/行事曆/Cookbook/Deep Research/文件 | ⚠️ 聚焦 Agents/MCP/RAG/記憶/多用戶 |
| 記憶 | ChromaDB | key/value 記憶 + pgvector RAG |
| MCP | ✅ 內建 | ✅ 內建 |
| 企業（SSO/審計/多租戶） | 🔴 無 | ✅ SSO/SAML/LDAP/RBAC |

### 判決（第一性原理）

**Odysseus 不適合當「複製給客戶」的地基**：
1. 授權連自己都講不清（AGPL vs MIT）→ 商用法律未爆彈。
2. vibecoded + 已被打出 RCE / 帳號淪陷；它官方文件自承「當 admin console、別暴露公網、別放敏感資料」。
3. 才數週大、dev 分支不穩。

Odysseus 適合**個人嚐鮮**（Cookbook / Deep Research 很棒），不適合商用地基。

**建議：雲端大腦改用 LibreChat（MIT）。** 它沒有的 email/行事曆/Cookbook 屬 v0 非必要（YAGNI），未來真要可用我們的 MCP 工具掛上去，不必繼承其安全債與 AGPL 風險。

## 不重複造輪子的最終分工

- **不自寫**：聊天 UI、agent loop、RAG 管線 → 用 LibreChat。
- **保留的差異化（兩者都沒有）**：
  1. 會呼吸的 OneAI PWA（手機面）
  2. 手機審核護欄（HITL）
  3. Obsidian SSOT + 寫回迴圈（永不忘 / 自我進化）
  4. 政策白名單的本機手
  以上全部透過 **MCP bridge** 插進 LibreChat。

## 實作注意（研究查到的坑）

- **LibreChat 會把 MCP 工具回傳整包讀進記憶** → 大回傳會 OOM。我們的 `vault_query` 必須**分頁 / 限長（單次 ≤ 10k tokens）**，必要時回傳「資源連結」而非整包內容。
- LibreChat 記憶 agent **每個請求都跑**，設 `memory.maxInputTokens`（預設 12000）控成本。
- 自架務必開認證、別把模型/服務原始埠暴露公網。

## 落地後的 v0 堆疊（全可寬鬆授權）

| 層 | 元件 | 授權 |
|---|---|---|
| 雲端大腦 + 桌面 UI | LibreChat on Zeabur | MIT |
| 手機面 | OneAI PWA（自寫）→ 接 LibreChat API + ntfy/Web Push | MIT |
| 記憶 SSOT | Obsidian vault + git + RAG（Chroma/sqlite-vec） | 我們 MIT / Apache |
| 護欄 | approval-svc + ntfy（自寫 + Apache） | MIT / Apache |
| 本機手 | Antigravity（個人）/ Aider（客戶） | 專有 / Apache |
| 網路 | Tailscale（個人）/ Headscale（客戶） | BSD-3 |
| 橋樑 | MCP bridge（自寫） | MIT |

## 14.x OSS 盡職調查（2026-06-20，開寫前「不重複造輪子」）

### OpenOneAI（`open-oneai/OpenOneAI`）判決：先不導入，列口袋方案

| 項目 | 結果 |
|---|---|
| 出身 | Stanford SAIL / Hazy Research（Christopher Ré、Azalia Mirhoseini），arXiv 2605.17172 |
| 授權 | **Apache-2.0** ✅ |
| 規模/成熟 | 6.7k★，2026-03 發布，研究級、設定複雜、需本機算力 |
| 本質 | **local-first 框架**：Intelligence/Engine/Agents/Tools&Memory/Learning，跑 Ollama/vLLM，裝置端學習迴圈，Tauri 桌面 app |

**判決（第一性原理）**：**不採用為地基,維持雲端優先(LibreChat)。**
1. local-first 與我們「手機/桌面/雲端隨時可達 + 雲端最穩」核心需求相衝(本機關機=暫停)。
2. 自帶 Agents+記憶+學習=**第二控制平面+第二記憶**,違反「單一控制平面/唯一 SSOT」鐵律(才剛為此砍掉 OpenClaw)。
3. 其獨門「裝置端學習」我們已用 `remember.py`(markdown distill 回 vault)以極簡方式達成同一哲學。
4. **翻盤條件**:若出現「資料絕不出本機 / 須裝置端訓練」硬需求(極重隱私客戶版),OpenOneAI 是該版本最佳底座 → **收進口袋,不丟棄**。

### 可重用元件（撿現成,對應缺口）

| 缺口 | 元件 | 授權/成熟 | 決策 |
|---|---|---|---|
| Obsidian 讀寫 | **`lstpsche/obsidian-mcp`** | MIT,Rust 單檔,檔案直存,免外掛 | ✅ **採用**(首選) |
| Obsidian 讀寫(備案) | `cyanheads/obsidian-mcp-server` | Apache-2.0,590★,需 plugin | 🔁 備案(最成熟) |
| HITL 審核 | `fernandosmither/guarded-mcp` | MIT,MCP 原生,Telegram | 🔁 **不替換,借兩招**:①參數 SHA-256 雜湊「執行前驗證防竄改」②審核只顯示原始參數、不顯示 agent 自述(防操弄) |
| 編排腦(Phase D) | `JoelJohnsonThomas/ForgeFlow` | Apache-2.0,LangGraph+HITL+MCP | 📌 收藏,做 LangGraph 時參考 |
| 記憶層 | mem0 / Letta / Zep | 皆 Apache/MIT | ⏭️ **先不導入**:會與「Obsidian 唯一 SSOT」鐵律衝突;mem0 graph 記憶雲端付費;現行 vault+ChromaDB 已是最簡 SSOT。未來需時間推理才評估 Zep(YAGNI) |

> 結論:**省工最大塊 = Obsidian 讀寫改用 `lstpsche/obsidian-mcp`**;審核保留自寫(已硬化、fail-safe、接 ntfy/PWA)但借 guarded-mcp 兩個安全點子;記憶/RAG 維持現狀;編排維持「現在不上」。

## 對舊文件的影響（已執行）

- ✅ `docs/03` 已改寫為 LibreChat on Zeabur（檔名改 `03-cloud-librechat-zeabur.md`）。
- ✅ `bridge/mcp-odysseus/` → `bridge/mcp-core/`（與特定大腦解耦），server 移除 `odysseus_chat`，`vault_query` 加 `VAULT_MAX_CHARS` 限長。
- ✅ PWA `src/lib/odysseus.ts` → `librechat.ts`；env 變數 `*_ODYSSEUS_*` → `*_LIBRECHAT_*`。
- ✅ docs/01/05/08/09/10/11 與相關 README 之 Odysseus 引用已改為 LibreChat。
- ⏳ `docs/05` 的 mTLS → Tailscale/Headscale 仍為**待拍板**項，尚未變更。
