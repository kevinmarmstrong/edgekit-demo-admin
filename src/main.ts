import '@kevinmarmstrong/edgekit-ui'
import { chromeAI, tool } from '@kevinmarmstrong/edgekit'
import type { EdgeChat } from '@kevinmarmstrong/edgekit-ui'
import { createAuditTrail } from '@kevinmarmstrong/edgekit-governance'
import { createMissionProfile, createSkill, validateMissionProfile } from '@kevinmarmstrong/edgekit-skills'
import { z } from 'zod'
import './styles.css'

type Account = {
  id: string
  name: string
  plan: 'Starter' | 'Growth' | 'Enterprise'
  status: 'Active' | 'At risk' | 'Suspended'
  mrr: number
}

const accounts: Account[] = [
  { id: 'acct-northstar', name: 'Northstar Running Co.', plan: 'Growth', status: 'Active', mrr: 2400 },
  { id: 'acct-cobalt', name: 'Cobalt Health', plan: 'Enterprise', status: 'At risk', mrr: 11800 },
  { id: 'acct-harbor', name: 'Harbor Supply', plan: 'Starter', status: 'Active', mrr: 780 },
]
const audit = createAuditTrail({ sessionId: 'external-admin-demo' })

const searchAccounts = tool({
  description: 'Search SaaS customer accounts by name, plan, status, or account id.',
  inputSchema: z.object({ query: z.string() }),
  execute: async ({ query }) => {
    const term = query.toLowerCase()
    return {
      results: accounts.filter(account => `${account.id} ${account.name} ${account.plan} ${account.status}`.toLowerCase().includes(term)),
    }
  },
})

const changePlan = tool({
  description: 'Change a SaaS customer account plan after explicit approval.',
  inputSchema: z.object({
    accountId: z.string(),
    plan: z.enum(['Starter', 'Growth', 'Enterprise']),
    reason: z.string(),
  }),
  needsApproval: true,
  execute: async ({ accountId, plan, reason }) => {
    const account = accounts.find(item => item.id === accountId)
    if (!account) throw new Error(`Unknown account ${accountId}`)
    account.plan = plan
    const entry = await audit.record({ action: 'tool-result', sessionId: 'external-admin-demo', toolName: 'changePlan', input: { accountId, plan, reason }, output: account })
    renderAccounts()
    renderAudit()
    return { success: true, account, auditHash: entry.hash }
  },
})

const adminSearch = createSkill({
  id: 'admin-account-search',
  name: 'Account Search',
  description: 'Find account status, plan, and commercial risk before suggesting admin actions.',
  instructions: 'Always search accounts before answering account questions. Include account id, plan, status, and MRR.',
  requiredTools: ['searchAccounts'],
  policy: { riskLevel: 'low' },
})

const adminMutation = createSkill({
  id: 'admin-plan-change',
  name: 'Plan Change',
  description: 'Prepare account plan changes that require explicit user approval.',
  instructions: 'Never change a plan without approval. Explain the account, new plan, and reason before using changePlan.',
  requiredTools: ['changePlan'],
  policy: { riskLevel: 'high', needsApproval: true, approvalMessage: 'Approve the plan change before Edgekit calls the host app API.' },
})

const profile = createMissionProfile({
  id: 'external-admin-v1',
  mission: 'internal-admin',
  version: '0.3.0',
  systemPrompt: 'You help SaaS operators review customer accounts. Search first, keep account state owned by the app, and require approval for plan changes.',
  tools: { searchAccounts, changePlan },
  requiredTools: ['searchAccounts', 'changePlan'],
  defaults: { toolChoice: 'required', downloadPolicy: 'never', maxSteps: 4 },
  policy: { riskLevel: 'high', needsApproval: true },
  meta: { description: 'External admin demo for Edgekit v0.3.0' },
})

const root = document.querySelector<HTMLElement>('#app')
if (root) {
  root.innerHTML = `
    <header>
      <a href="https://github.com/kevinmarmstrong/edgekit">edgekit</a>
      <span>External admin demo</span>
    </header>
    <section class="hero">
      <div>
        <p class="eyebrow">Approval-gated SaaS admin workflow</p>
        <h1>Change account state through your app, not through a prompt.</h1>
        <p>Edgekit exposes account tools to the agent, keeps account data in this app, pauses risky mutations for approval, and writes an audit trail for every approved change.</p>
      </div>
      <edge-chat id="admin-agent" placeholder="Ask: find Cobalt and move it to Enterprise because renewal is signed"></edge-chat>
    </section>
    <section class="grid">
      <div>
        <h2>Accounts</h2>
        <div id="accounts" class="accounts"></div>
      </div>
      <div>
        <h2>Audit trail</h2>
        <ol id="audit"></ol>
      </div>
      <div>
        <h2>Mission Profile</h2>
        <pre id="profile"></pre>
      </div>
    </section>
  `
}

document.querySelector<EdgeChat>('#admin-agent')?.configure({
  sessionId: 'external-admin-demo',
  model: [chromeAI()],
  downloadPolicy: 'never',
  onNoModel: ({ input }) => fallbackAnswer(input),
})
document.querySelector<EdgeChat>('#admin-agent')?.applyMissionProfile(profile)
document.querySelector<EdgeChat>('#admin-agent')?.registerTools({ searchAccounts, changePlan })

renderAccounts()
renderAudit()
renderProfile()

function fallbackAnswer(input: string) {
  const cobalt = accounts.find(account => account.id === 'acct-cobalt')
  if (/cobalt|enterprise|plan|change|move/i.test(input) && cobalt) {
    return `Basic mode: ${cobalt.name} is ${cobalt.status}, currently on ${cobalt.plan}, with $${cobalt.mrr.toLocaleString()} MRR. In model-backed mode Edgekit would call searchAccounts, request approval, then call changePlan through the host app.`
  }
  return 'Basic mode: ask for an account by name or request a plan change. Model-backed mode uses the same tools with approval gates.'
}

function renderAccounts() {
  const target = document.querySelector<HTMLElement>('#accounts')
  if (!target) return
  target.innerHTML = accounts.map(account => `
    <article>
      <strong>${account.name}</strong>
      <span>${account.id}</span>
      <p>${account.plan} · ${account.status} · $${account.mrr.toLocaleString()} MRR</p>
    </article>
  `).join('')
}

function renderAudit() {
  const target = document.querySelector<HTMLElement>('#audit')
  if (!target) return
  const entries = audit.entries?.() ?? []
  target.innerHTML = entries.length
    ? entries.map(entry => `<li><strong>${entry.event.toolName}</strong><span>${entry.hash.slice(0, 18)}...</span></li>`).join('')
    : '<li>No approved mutations yet.</li>'
}

function renderProfile() {
  const validation = validateMissionProfile(profile, { registeredTools: ['searchAccounts', 'changePlan'] })
  const target = document.querySelector<HTMLElement>('#profile')
  if (!target) return
  target.textContent = JSON.stringify({
    validation: validation.ok ? 'ok' : validation.errors,
    skills: [adminSearch.id, adminMutation.id],
    requiredTools: profile.requiredTools,
    policy: profile.policy,
  }, null, 2)
}
