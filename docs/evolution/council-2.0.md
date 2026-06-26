# OneAI 2.0 議會辯論紀錄

> 模式：evolution_offline · 參與：coach, engineer, pm, researcher, butler, security_auditor

## 第 1 輪 · opening

### 🌸 梅蘭 COO

【開場】2.0 週期診斷：GTX 自動 14/22，使用者模擬 10/15。
GA 門檻：GTX≥19、版本=2.0.0。
P0 阻塞：OPENAI_API_KEY 502；GITHUB_TOKEN handoff；RAG Volume；#34 Cursor worker。
我建議以「多贏、拒絕零和」篩選：先修根因（LLM/Volume/Worker），再衝 Wave 交付。

### 💻 工程師

【開場】失敗項：#11 搜尋不寫記憶 | #12 分析不寫記憶 | #21 快速網搜 | #22 Browser 深研 | #31 多 Agent 合成。
#34 Cursor 需 cursor_worker 常駐或改 Cloud-First 預設。
Handoff 已接 2.0，但 GITHUB_TOKEN 未設會 503。

### 📋 PM

【開場】下一版 3.0（hands-first）焦點：議會定稿 → 自動 Cursor 派工、Skill 累積與跨 Agent 重用。
本週文檔須同步：deploy-state、23-release、本 cycle report。

### 🔬 研究員

【開場】搜尋/深研情境失敗多與 502 同源。
Tavily 有 key 時 R 維度應 ≥2；需分離「上游掛」與「路由錯」。

### 🫀 管家

【開場】記憶情境 #02 #03 若 LLM 正常應綠。
curate/graph 502 是 rag 映像問題，非 butler 邏輯。

### 🛡️ 安全審計

【開場】token 分離（#85）已配置則 OK。
Handoff 派工須審核高風險 deploy-rag；建議 7.0 全面 HITL。

## 第 2 輪 · rebuttal

### 🌸 梅蘭 COO

【回應】同意工程與管家優先序。但若使用者仍看到 502，PWA 議會 UI 再漂亮也無意義。
定稿：本週 P0 = 修復 OPENAI_API_KEY 502 → 修復 #11 搜尋不寫記憶 → 更新 docs/evolution/2.0-cycle-report.md。

### 💻 工程師

【回應】PM 說的驗收腳本要進 CI；我補：rag Volume 掛載應寫進 zeabur redeploy 一鍵腳本。

### 📋 PM

【回應】安全審計員提醒的 HITL 可放到 7.0，不阻塞 3.0 GA。

### 🔬 研究員

【回應】同意。GTX 報告應標註 failure_class: upstream|routing|worker。

### 🫀 管家

【回應】4.0 再做 FAMA；2.0/3.0 先確保寫入/召回不被 502 污染假陽性。

### 🛡️ 安全審計

【回應】同意延後全面 HITL，但 smoke/gtx 派工應寫入 action-log 可追溯。

## 🌸 梅蘭 COO 定稿

【營運長定稿 · 2.0 週期】

1. **診斷**：GTX 14/22；使用者模擬 10/15。
2. **GA 判定**：⚠️ 未達門檻，續跑優化 loop。
3. **P0 行動**：
   1. 修復 OPENAI_API_KEY 502
   2. 修復 #11 搜尋不寫記憶
   3. 更新 docs/evolution/2.0-cycle-report.md
   4. 準備 3.0 wave 交付
4. **下一版 3.0（hands-first）**：議會定稿 → 自動 Cursor 派工；Skill 累積與跨 Agent 重用；Handoff 狀態回寫 PWA。
5. **多贏原則**：修根因讓孟一、雲端、本機 worker 三方都受益，不做零和裁剪功能。
