/**
 * coo-handoff 單元測試
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { detectHandoffIntent, runCooHandoff } from '../services/approval/src/coo-handoff.js'

describe('detectHandoffIntent', () => {
  it('無執行意圖 → null', () => {
    assert.equal(detectHandoffIntent('今天天氣如何'), null)
  })

  it('smoke + 執行 → cloud_hand smoke', () => {
    const r = detectHandoffIntent('幫我跑 smoke 驗收')
    assert.equal(r?.channel, 'cloud_hand')
    assert.equal(r?.job, 'smoke')
  })

  it('gtx + 立刻 → gtx-p0', () => {
    const r = detectHandoffIntent('立刻執行 gtx 測試')
    assert.equal(r?.job, 'gtx-p0')
  })

  it('部署 rag → deploy-rag', () => {
    const r = detectHandoffIntent('馬上部署 rag volume')
    assert.equal(r?.job, 'deploy-rag')
  })
})

describe('runCooHandoff', () => {
  it('成功觸發 Cloud GHA', async () => {
    const events = []
    const out = await runCooHandoff(
      {
        triggerCloudHand: async (job) => ({
          ok: true,
          poll: 'https://github.com/actions/runs/1',
          repo: 'oneai',
        }),
        randomId: () => 'test-task-id-1234',
      },
      {
        userMsg: '幫我跑 smoke',
        reply: '好的',
        emit: (p, d) => events.push([p, d]),
      },
    )
    assert.ok(out)
    assert.equal(out.handoff.job, 'smoke')
    assert.equal(out.handoff.status, 'running')
    assert.equal(events[0][0], 'handoff_start')
    assert.equal(events[1][0], 'handoff_done')
  })

  it('GITHUB 失敗 → error handoff', async () => {
    const out = await runCooHandoff(
      {
        triggerCloudHand: async () => ({ ok: false, error: 'missing GITHUB_TOKEN' }),
        randomId: () => 'x',
      },
      { userMsg: '執行 smoke', reply: '', emit: () => {} },
    )
    assert.equal(out?.handoff.status, 'error')
    assert.match(out?.replyAppend ?? '', /GITHUB_TOKEN/)
  })
})
