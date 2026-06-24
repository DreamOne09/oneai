# 22 — 數位辦公室（Agent Council）

> 狀態：**P1 已上線 + PWA 顯示**（2026-06-25）  
> 編排：`orchestrate-harness.js` · 設定：`config/oneai.council.json`

## 孟一需求（North Star — 寫死）

1. **真實數位辦公室**：不是會說話的笨蛋 chatbot；要能思考、辯論、派工、執行。
2. **最多 36 位助理**：常駐 + 營運長動態增刪改（像人事管理）。
3. **子 Agent 真的對話**：共享 thread、有回合、有反駁；禁止平行換 prompt 假裝協作。
4. **梅蘭 COO**：開議前篩選、主持辯論、定稿後才給孟一；對外語氣不變。
5. **議會 vs 快徑**：簡單問題 Fast；≥2 人或「辯論/利弊」走 Council（2–3 輪）。
6. **PWA 必須清楚顯示**：模式、輪次、議員、議事錄可展開。
7. **價值觀 — 多贏，非零和**：
   - **多贏原則**：學員、講師、職員、合作方、孟一本人——決策須讓各方都有收穫。
   - **拒絕零和賽局**：不做「犧牲 A 成全 B」式建議；議會辯論若出現零和方案，梅蘭須指出並改寫為多贏路徑。
   - ~~三爽原則~~ **已廢止**（2026-06-25 起不再出現於 prompt / 文件 / 路由）。

---

## 北極星

OneAI = **孟一的數位辦公室**（最多 **36 位助理**），不是單一聊天 bot。

| 角色 | 職責 |
|------|------|
| **梅蘭 COO** | 主持、人事、篩選、定稿、把關多贏 |
| **議員（≤36）** | 專業辯論、給建議 |
| **Hands** | Cursor / GHA / Antigravity 真實執行 |

---

## 編制上限

| 項目 | 值 | 說明 |
|------|-----|------|
| `max_staff` | **36** | 辦公室總人數（常駐 + 自訂） |
| `max_council_participants` | **6** | 單次議會最多同時辯論人數 |
| `default_max_rounds` | **2** | 一般決策辯論輪數 |
| `high_stakes_max_rounds` | **3** | 部署/刪除/合約/資安等高風險 |

> 36 人是 **編制上限**；每次議會只叫 **最相關的 1–6 人** 進場，避免 token 爆炸。

---

## 辯論幾輪？（子 Agent 對話）

### 一般議會（2 輪）

```
Round 1 · opening（並行）
  各議員獨立開宗明義（尚無議事錄）

Round 2 · rebuttal（循序，共享 thread）
  每人讀完整 Round 1 議事錄 → 同意 / 反駁 / 修正
  必須引用至少一位其他議員論點
  若方案像零和賽局 → 須提出多贏替代

→ 梅蘭 COO Briefing（篩選 + 多贏檢查 + 定稿給孟一）
```

### 高風險議會（3 輪）

觸發詞含：`部署`、`上線`、`刪除`、`花錢`、`合約`、`資安`…

```
Round 1 · opening
Round 2 · rebuttal
Round 3 · rebuttal（深化衝突、定條件式多贏結論）

→ COO Briefing
```

### Fast 快徑（0 輪辯論）

- 寒暄、單一 `researcher`（天氣）、記憶整理  
- **不開議會**，1 次 LLM 直答或單專家 + 梅蘭合成

---

## 模式決策表

| 條件 | 模式 | 辯論輪數 |
|------|------|----------|
| 人事指令（增刪改編制） | Staff | 0 |
| 單一議員 + 無 force 詞 | Fast | 0 |
| ≥2 議員 或 「開議會/辯論/利弊」 | Council | 2 |
| Council + 高風險觸發詞 | Council+ | 3 |

---

## 設定檔

| 檔案 | 用途 |
|------|------|
| `config/oneai.council.json` | 36 上限、輪數、COO 定稿指令（含多贏） |
| `config/oneai.dream-team.json` | Squad + ad-hoc 池 |
| `config/oneai.agents.json` | 常駐議員 + **values 多贏 SSOT** |
| `data/custom-agents.json` | 動態人事（持久化） |

---

## 人事（自然語言）

- `列出編制`
- `新增議員叫 XXX，職責：…`
- `刪除 agent legal-tw`
- `修改 agent pm 職責：…`

API（chat token）：`GET/POST/PATCH/DELETE /agents/staff`

---

## SSE Phase（PWA 即時顯示）

| Phase | UI 顯示 |
|-------|---------|
| `route_done` | 模式徽章 Fast / 議會 + Squad |
| `council_start` | 🏛️ 議會開議（N 人 · M 輪） |
| `council_round` | 第 R 輪 · opening/rebuttal |
| `council_agent_done` | 💬 {議員} 發言完成 |
| `coo_briefing_start` | 🌸 梅蘭篩選定稿 |
| `agent_done` | Fast 模式專家完成 |

---

## Orchestrate 回應欄位

```json
{
  "council": { "mode": "debate", "rounds": 2, "thread_id": "...", "participants": ["pm","engineer"] },
  "council_transcript": [{ "round": 1, "phase": "opening", "entries": [...] }],
  "squad": "engineering",
  "orchestrator": { "role": "coo_chair" }
}
```

---

## PWA

- **Chat**：`CouncilLiveBar` 顯示當前輪次 / 議員 / 模式
- **訊息卡**：梅蘭定稿 + 可展開「議事錄（N 輪）」
- **Agents Tab**：`OfficeStaffPanel` 顯示 ≤36 編制

---

## 測試

```bash
node scripts/agent-council.test.js
node scripts/agent-routing.test.js
```

---

## 後續

- 議會結論 → 自動 Handoff（Cursor / GHA）
- 高風險第 3 輪強制 approval 掛鉤
