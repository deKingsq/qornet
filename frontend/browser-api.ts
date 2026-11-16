import { ZodError } from 'zod'
import { registerRoutes } from '../backend/routes.ts'
import type { DemoStore } from '../backend/routes.ts'
import type { AtmDecision, Audit, Case, CaseStatus, Risk, ScenarioId, TransferDecision } from '../shared/domain.ts'

const key = 'qornet-demo-v1'
type State = { audit: Audit[]; cases: Case[]; atm: AtmDecision[]; transfers: TransferDecision[]; sequence: number }

function readState(): State {
  try {
    const saved = sessionStorage.getItem(key)
    if (saved) return JSON.parse(saved)
  } catch { /* Storage may be unavailable in embedded browsers. */ }
  return { audit: [], cases: [], atm: [], transfers: [], sequence: 0 }
}

function upsert<T extends { id: string }>(items: T[], item: T) {
  const index = items.findIndex(({ id }) => id === item.id)
  if (index < 0) items.push(item)
  else items[index] = item
}

class BrowserStore implements DemoStore {
  private state = readState()

  transaction<T>(action: () => T): T {
    const previous = structuredClone(this.state)
    try {
      const result = action()
      try { sessionStorage.setItem(key, JSON.stringify(this.state)) } catch { /* Keep the demo usable in memory. */ }
      return result
    } catch (error) {
      this.state = previous
      throw error
    }
  }

  record(scenario: ScenarioId, channel: string, reference: string, action: string, payload: unknown) {
    this.state.audit.unshift({ id: ++this.state.sequence, at: Date.now(), scenario, channel, reference, action, payload })
    this.state.audit.length = Math.min(150, this.state.audit.length)
  }

  history() { return this.state.audit.slice() }
  cases() { return this.state.cases.toSorted((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)) }
  case(id: string) { return this.state.cases.find((entry) => entry.id === id) }

  openCase(scenario: ScenarioId, channel: Case['channel'], reference: string, title: string, risk: Risk) {
    const id = `${scenario}:${reference}`
    if (!this.case(id)) {
      const at = Date.now()
      this.state.cases.push({ id, scenario, channel, title, risk, status: 'OPEN', createdAt: at, updatedAt: at })
      this.record(scenario, channel, id, 'CASE_OPENED', { title, risk })
    }
    return id
  }

  reviewCase(entry: Case, status: CaseStatus, note: string) {
    const updated = { ...entry, status, updatedAt: Date.now() }
    upsert(this.state.cases, updated)
    this.record(entry.scenario, entry.channel, entry.id, 'CASE_REVIEWED', { before: entry.status, status, note })
    return updated
  }

  atm(id: string) { return this.state.atm.find((entry) => entry.id === id) }
  saveAtm(decision: AtmDecision, action: string) {
    upsert(this.state.atm, decision)
    this.record(decision.scenario, 'atm', decision.id, action, decision)
  }

  transfer(id: string) { return this.state.transfers.find((entry) => entry.id === id) }
  saveTransfer(decision: TransferDecision, action: string) {
    upsert(this.state.transfers, decision)
    this.record(decision.scenario, 'transfer', decision.id, action, decision)
  }
}

type Router = Parameters<typeof registerRoutes>[0]
type Handler = Parameters<Router['get']>[1]
const routes: { method: string; parts: string[]; handler: Handler }[] = []
const route = (method: string): Router['get'] => (path, handler) => routes.push({ method, parts: path.split('/'), handler })
registerRoutes({ get: route('GET'), post: route('POST'), patch: route('PATCH') }, new BrowserStore())

export function browserApi(path: string, options?: RequestInit): unknown {
  options?.signal?.throwIfAborted()
  const parts = `/api/v1${path}`.split('/')
  const method = options?.method?.toUpperCase() ?? 'GET'
  const route = routes.find((entry) => entry.method === method && entry.parts.length === parts.length &&
    entry.parts.every((segment, index) => segment.startsWith(':') || segment === parts[index]))
  if (!route) throw new Error('Маршрут API не найден')
  const params = Object.fromEntries(route.parts.flatMap((part, index) => part.startsWith(':') ? [[part.slice(1), decodeURIComponent(parts[index])]] : []))
  let status = 200
  let result: unknown
  const response = {
    status(code: number) { status = code; return response },
    json(data: unknown) { result = data },
  }
  try {
    const body = typeof options?.body === 'string' ? JSON.parse(options.body) : undefined
    route.handler({ params, body }, response)
  } catch (error) {
    if (error instanceof ZodError) throw new Error('Проверьте введённые данные')
    throw error
  }
  if (status >= 400) throw new Error((result as { message?: string })?.message ?? 'Ошибка QORNET')
  return structuredClone(result)
}
