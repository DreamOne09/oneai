/**
 * Cloud-First Hands — 透過 GitHub Actions 觸發雲端任務（smoke / GTX / rag deploy）。
 * 環境變數：GITHUB_TOKEN（PAT，repo+workflow）、GITHUB_REPO（預設 DreamOne09/oneai）
 */
const WORKFLOW_FILE = 'oneai-cloud-hands.yml'
const DEFAULT_REPO = process.env.GITHUB_REPO || 'DreamOne09/oneai'
const DEFAULT_REF = process.env.GITHUB_REF || 'master'

function parseRepo(repo) {
  const [owner, name] = String(repo || DEFAULT_REPO).split('/')
  if (!owner || !name) throw new Error('invalid GITHUB_REPO')
  return { owner, name }
}

export async function triggerCloudHand(job, meta = {}) {
  const token = process.env.GITHUB_TOKEN || ''
  if (!token) {
    return { ok: false, error: 'GITHUB_TOKEN not configured on approval-svc' }
  }
  const valid = ['smoke', 'gtx-p0', 'deploy-rag']
  if (!valid.includes(job)) {
    return { ok: false, error: `invalid job; use ${valid.join(', ')}` }
  }
  const { owner, name } = parseRepo(DEFAULT_REPO)
  const url = `https://api.github.com/repos/${owner}/${name}/actions/workflows/${WORKFLOW_FILE}/dispatches`
  const body = {
    ref: DEFAULT_REF,
    inputs: {
      job,
      approval_task_id: meta.taskId || '',
      triggered_by: meta.triggeredBy || 'approval-svc',
    },
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    return { ok: false, error: `GitHub ${res.status}: ${text.slice(0, 300)}` }
  }
  return {
    ok: true,
    job,
    repo: `${owner}/${name}`,
    ref: DEFAULT_REF,
    workflow: WORKFLOW_FILE,
    poll: `https://github.com/${owner}/${name}/actions/workflows/${WORKFLOW_FILE}`,
  }
}

export async function getLatestWorkflowRun(job) {
  const token = process.env.GITHUB_TOKEN || ''
  if (!token) return { ok: false, error: 'GITHUB_TOKEN not configured' }
  const { owner, name } = parseRepo(DEFAULT_REPO)
  const q = new URLSearchParams({ event: 'workflow_dispatch', per_page: '5' })
  const url = `https://api.github.com/repos/${owner}/${name}/actions/workflows/${WORKFLOW_FILE}/runs?${q}`
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  if (!res.ok) {
    return { ok: false, error: `GitHub ${res.status}` }
  }
  const data = await res.json()
  const runs = (data.workflow_runs || []).filter((r) => {
    const inputs = r.display_title || ''
    return !job || inputs.includes(job) || true
  })
  const run = runs[0]
  if (!run) return { ok: true, run: null }
  return {
    ok: true,
    run: {
      id: run.id,
      status: run.status,
      conclusion: run.conclusion,
      html_url: run.html_url,
      created_at: run.created_at,
    },
  }
}
