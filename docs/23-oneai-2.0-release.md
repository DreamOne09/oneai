# OneAI 2.0 正式版（Wave 1 GA）

> **版本**：`2.0.0` · **代號**：`digital-office` · **SSOT**：[`config/oneai.2.0.json`](../config/oneai.2.0.json)

---

## 2.0 是什麼

OneAI 2.0 不是「換一個 prompt 的 chatbot」，而是**真實數位辦公室**：

| 能力 | 1.x | 2.0 |
|------|-----|-----|
| 多 Agent 辯論 | 並行速報 | **共享 thread 2–3 輪辯論** |
| 人事編制 | 固定 8 人 | **最多 36 人，營運長可增刪改** |
| 價值觀 | 三爽（已廢止） | **多贏原則，拒絕零和** |
| 派工 | 手動 Cursor | **COO Handoff → Cloud GHA** |
| PWA | 單一對話 | **議會即時條、議事錄、編制面板** |

---

## Wave 1 已交付（GA）

- `agent-council.js` — 議會辯論 + 梅蘭 COO Briefing
- `agent-registry.js` + `GET/POST/PATCH/DELETE /agents/staff`
- `coo-handoff.js` — 明確執行意圖 → smoke / gtx-p0 / deploy-rag
- `config/oneai.2.0.json` — 能力清單 SSOT
- `GET /oneai/version` + `/health` → `2.0.0`
- PWA：`CouncilLiveBar`、`OfficeStaffPanel`、`ONEAI 2.0` 品牌

詳細編制與辯論規則 → [22-agent-council.md](22-agent-council.md)

---

## API 速查

```bash
# 版本與能力
curl -s https://oneai-approval.zeabur.app/health
curl -s https://oneai-approval.zeabur.app/oneai/version

# 編制
curl -s -H "Authorization: Bearer $CHAT_TOKEN" \
  https://oneai-approval.zeabur.app/agents/staff
```

**Handoff 觸發範例**（需明確執行意圖）：

- 「**幫我跑 smoke**」→ Cloud GHA `smoke`
- 「**立刻執行 gtx**」→ Cloud GHA `gtx-p0`
- 「**馬上部署 rag**」→ Cloud GHA `deploy-rag`

---

## GA 驗收標準（尚未全綠）

| 項目 | 目標 | 現況 |
|------|------|------|
| GTX-100 | ≥85/100 情境 ≥12/16 分 | ~21/22，持續補 |
| 雲端 LLM | orchestrate 502 <1% | 需 Zeabur `OPENAI_API_KEY` |
| RAG Volume | Chroma 持久化 | DEP-04 待掛 |
| Workers | cursor + agy 或 Cloud-First | GHA 需 `GITHUB_TOKEN` |

---

## Wave 2 / 3（計畫中）

**Wave 2 — 能幹活**

- 議會定稿 → **自動** Cursor 派工（非僅建議）
- Skill 累積（sop → 全辦公室重用）
- FAMA 記憶遺忘、深研完成 Push
- GTX ≥85/100

**Wave 3 — 超強團隊**

- Autopilot 晨報、Hermes 24/7 VPS
- 薄通道 LINE/TG、LangGraph HITL（高風險）

路線圖細節 → [20-oneai-2.0-day-plan.md](20-oneai-2.0-day-plan.md)

---

## 部署後 checklist

1. Zeabur approval-svc 重新部署（`master` push 後自動）
2. `GET /health` 確認 `version: 2.0.0`
3. PWA 硬重新整理（或清 SW cache）
4. 設定 `OPENAI_API_KEY`、`GITHUB_TOKEN`（Handoff / GTX）
5. 跑 `python scripts/verify-cloud-staff.py`
