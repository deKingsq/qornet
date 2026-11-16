import { z } from 'zod'
import { scenarios } from '../shared/domain.ts'
import type { AtmDecision, AtmState, ScenarioId, Snapshot, TransferDecision } from '../shared/domain.ts'
import { cashRisk, dealRisk, evaluate, limits, scenarioSnapshot } from './engine.ts'
import type { Store } from './store.ts'
import { benchmarkTransfers, transferHistory, transferRisk } from './transfer-risk.ts'

const scenarioId = z.enum(scenarios.map(({ id }) => id) as [ScenarioId, ...ScenarioId[]])
const accountId = z.string().regex(/^AC-\d{4}$/)
const amount = z.number().int().min(100).max(5_000_000)
const cashSchema = z.object({
  scenario: scenarioId, account: accountId, amount, pressure: z.boolean(), recentCredit: z.boolean(),
}).strict()
const dealSchema = z.object({
  scenario: scenarioId, id: z.string().regex(/^DEAL-[A-Z0-9-]{1,32}$/), buyer: accountId, payer: accountId,
  seller: accountId, recipient: accountId, payee: accountId, amount, paid: amount,
  buyerConfirmed: z.boolean(), sellerConfirmed: z.boolean(),
}).strict()

function seedCases(store: DemoStore, snapshot: Snapshot) {
  for (const cluster of snapshot.clusters) {
    store.openCase(snapshot.scenario, 'network', cluster.id, `Связанная сеть ${cluster.id}`, cluster.risk)
  }
  const chain = snapshot.chains.find((item) => item.cycle) ?? snapshot.chains[0]
  if (chain) store.openCase(snapshot.scenario, 'trace', chain.id, chain.cycle ? 'Циклическое движение средств' : 'Быстрая цепочка переводов', chain.risk)
}

type ApiRequest = { params: Record<string, string>; body: unknown }
type ApiResponse = { status(code: number): ApiResponse; json(data: unknown): unknown }
type Handler = (request: ApiRequest, response: ApiResponse) => unknown
type ApiRouter = {
  get(path: string, handler: Handler): void
  post(path: string, handler: Handler): void
  patch(path: string, handler: Handler): void
}
export type DemoStore = Omit<Store, 'close'>

export function registerRoutes(app: ApiRouter, store: DemoStore) {
  store.transaction(() => seedCases(store, scenarioSnapshot('farm')))

  app.get('/api/v1/health', (_req, res) => res.json({ status: 'ok', mode: 'synthetic' }))
  app.get('/api/v1/scenarios', (_req, res) => res.json(scenarios))
  app.get('/api/v1/thresholds', (_req, res) => res.json(limits))
  app.get('/api/v1/evaluation', (_req, res) => res.json(evaluate()))
  app.get('/api/v1/transfer-benchmark', (_req, res) => res.json(benchmarkTransfers()))
  app.get('/api/v1/audit', (_req, res) => res.json(store.history()))
  app.get('/api/v1/cases', (_req, res) => res.json(store.cases()))
  app.get('/api/v1/scenarios/:scenario/snapshot', (req, res) => {
    res.json(scenarioSnapshot(scenarioId.parse(req.params.scenario)))
  })
  app.post('/api/v1/scenarios/:scenario/runs', (req, res) => {
    const scenario = scenarioId.parse(req.params.scenario)
    const snapshot = scenarioSnapshot(scenario)
    store.transaction(() => {
      seedCases(store, snapshot)
      store.record(scenario, 'core', scenario, 'SCENARIO_RUN', snapshot.stats)
    })
    res.status(201).json(snapshot)
  })
  app.patch('/api/v1/cases/:id', (req, res) => {
    const { status, note } = z.object({
      status: z.enum(['INVESTIGATING', 'CONFIRMED', 'DISMISSED']),
      note: z.string().trim().min(3).max(500),
    }).strict().parse(req.body)
    const result = store.transaction(() => {
      const entry = store.case(req.params.id)
      if (!entry) return null
      if (entry.status === status) return entry
      if (entry.status === 'CONFIRMED' || entry.status === 'DISMISSED') return false
      const reviewed = store.reviewCase(entry, status, note)
      if (entry.channel === 'atm' && status !== 'INVESTIGATING') {
        const atmId = entry.id.slice(entry.scenario.length + 1)
        const decision = store.atm(atmId)
        if (decision && (decision.state === 'HOLD' || decision.state === 'REVIEW')) {
          const released = status === 'DISMISSED'
          store.saveAtm({ ...decision, state: released ? 'ALLOWED' : 'CANCELLED', at: Date.now() },
            released ? 'ATM_OFFICER_RELEASED' : 'ATM_OFFICER_DECLINED')
        }
      }
      if (entry.channel === 'transfer' && status !== 'INVESTIGATING') {
        const decision = store.transfer(entry.id.slice(entry.scenario.length + 1))
        if (decision?.state === 'REVIEW') {
          const released = status === 'DISMISSED'
          store.saveTransfer({ ...decision, state: released ? 'READY' : 'CANCELLED', at: Date.now() },
            released ? 'TRANSFER_RELEASED' : 'TRANSFER_DECLINED')
        }
      }
      return reviewed
    })
    if (result === null) return res.status(404).json({ message: 'Дело не найдено' })
    if (result === false) return res.status(409).json({ message: 'Дело уже завершено' })
    return res.json(result)
  })
  app.post('/api/v1/transfer-checks', (req, res) => {
    const { requestId, scenario, ...request } = z.object({
      requestId: z.uuid(), scenario: scenarioId, sender: accountId, recipient: accountId, amount,
    }).strict().parse(req.body)
    if (request.sender === request.recipient) return res.status(422).json({ message: 'Счета отправителя и получателя должны различаться' })
    const snapshot = transferHistory(scenario)
    if (!snapshot.accounts.some(({ id }) => id === request.sender) || !snapshot.accounts.some(({ id }) => id === request.recipient)) {
      return res.status(404).json({ message: 'Счёт отсутствует в сценарии' })
    }
    const id = `PAY-${requestId.toLowerCase()}`
    const result = store.transaction(() => {
      const prior = store.transfer(id)
      if (prior) return prior.scenario === scenario && prior.request.sender === request.sender &&
        prior.request.recipient === request.recipient && prior.request.amount === request.amount ? { decision: prior, created: false } : null
      const risk = transferRisk(snapshot, request)
      const state = risk.score >= limits.review ? 'REVIEW' : 'READY'
      const caseId = state === 'REVIEW' ? store.openCase(scenario, 'transfer', id, `Проверка перевода на ${request.recipient}`, risk) : undefined
      const decision: TransferDecision = { id, scenario, request, state, risk, at: Date.now(), caseId }
      store.saveTransfer(decision, 'TRANSFER_CHECKED')
      return { decision, created: true }
    })
    if (!result) return res.status(409).json({ message: 'Идентификатор уже относится к другой заявке' })
    return res.status(result.created ? 201 : 200).json(result.decision)
  })
  app.get('/api/v1/transfer-checks/:id', (req, res) => {
    const decision = store.transfer(req.params.id)
    return decision ? res.json(decision) : res.status(404).json({ message: 'Заявка не найдена' })
  })
  app.post('/api/v1/transfer-checks/:id/resolutions', (req, res) => {
    const { answer } = z.object({ answer: z.enum(['confirm', 'cancel', 'help']) }).strict().parse(req.body)
    const result = store.transaction(() => {
      const decision = store.transfer(req.params.id)
      if (!decision) return null
      if ((answer === 'confirm' && decision.state === 'COMPLETED') || (answer !== 'confirm' && decision.state === 'CANCELLED')) return decision
      if ((answer === 'confirm' && decision.state !== 'READY') || decision.state === 'COMPLETED') return false
      const updated: TransferDecision = { ...decision, state: answer === 'confirm' ? 'COMPLETED' : 'CANCELLED', at: Date.now() }
      store.saveTransfer(updated, answer === 'confirm' ? 'TRANSFER_COMPLETED' : answer === 'help' ? 'TRANSFER_HELP' : 'TRANSFER_CANCELLED')
      return updated
    })
    if (result === null) return res.status(404).json({ message: 'Заявка не найдена' })
    if (result === false) return res.status(409).json({ message: 'Действие недоступно для текущего состояния заявки' })
    return res.json(result)
  })
  app.post('/api/v1/atm-decisions', (req, res) => {
    const { scenario, ...request } = cashSchema.parse(req.body)
    const snapshot = scenarioSnapshot(scenario)
    const account = snapshot.accounts.find((item) => item.id === request.account)
    if (!account) return res.status(404).json({ message: 'Счёт отсутствует в сценарии' })
    const risk = cashRisk(snapshot, request, account)
    const state: AtmState = risk.level === 'CRITICAL' ? 'HOLD' : risk.level === 'HIGH RISK' ? 'REVIEW' :
      risk.level === 'REVIEW' ? 'CHALLENGE' : 'ALLOWED'
    const id = `ATM-${globalThis.crypto.randomUUID().slice(0, 8).toUpperCase()}`
    const decision = store.transaction(() => {
      const caseId = state === 'HOLD' || state === 'REVIEW' ? store.openCase(scenario, 'atm', id, `Снятие со счёта ${account.id}`, risk) : undefined
      const result: AtmDecision = { id, scenario, request, risk, state, at: Date.now(), caseId }
      store.saveAtm(result, 'ATM_DECISION')
      return result
    })
    return res.status(201).json(decision)
  })
  app.get('/api/v1/atm-decisions/:id', (req, res) => {
    const decision = store.atm(req.params.id)
    return decision ? res.json(decision) : res.status(404).json({ message: 'Операция не найдена' })
  })
  app.post('/api/v1/atm-decisions/:id/resolutions', (req, res) => {
    const { answer } = z.object({ answer: z.enum(['verified', 'assistance', 'cancel']) }).strict().parse(req.body)
    const result = store.transaction(() => {
      const decision = store.atm(req.params.id)
      if (!decision) return null
      if (!['CHALLENGE', 'HOLD', 'REVIEW'].includes(decision.state)) return false
      if (answer === 'verified' && decision.state !== 'CHALLENGE') return false
      const updated: AtmDecision = { ...decision, state: answer === 'verified' ? 'ALLOWED' : 'CANCELLED', at: Date.now() }
      store.saveAtm(updated, answer === 'assistance' ? 'CUSTOMER_ASSISTANCE' : answer === 'verified' ? 'CHALLENGE_VERIFIED' : 'ATM_CANCELLED')
      return updated
    })
    if (result === null) return res.status(404).json({ message: 'Операция не найдена' })
    if (result === false) return res.status(409).json({ message: 'Действие недоступно для текущего состояния операции' })
    return res.json(result)
  })
  app.post('/api/v1/deal-assessments', (req, res) => {
    const { scenario, ...deal } = dealSchema.parse(req.body)
    const accounts = new Set(scenarioSnapshot(scenario).accounts.map(({ id }) => id))
    if ([deal.buyer, deal.payer, deal.seller, deal.recipient, deal.payee].some((id) => !accounts.has(id))) {
      return res.status(404).json({ message: 'Участник сделки отсутствует в сценарии' })
    }
    const risk = dealRisk(deal)
    const caseId = store.transaction(() => {
      store.record(scenario, 'triangle', deal.id, 'DEAL_ASSESSED', { deal, risk })
      return risk.level === 'HIGH RISK' ? store.openCase(scenario, 'triangle', deal.id, `Проверка сделки ${deal.id}`, risk) : undefined
    })
    return res.status(201).json({ deal, risk, caseId })
  })

}

