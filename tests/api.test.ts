import assert from 'node:assert/strict'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import { createApp } from '../backend/app.ts'
import { Store } from '../backend/store.ts'
import type { AtmDecision, Audit, Case, Risk, Snapshot, TransferBenchmark, TransferDecision } from '../shared/domain.ts'

const store = new Store(':memory:')
const server = createApp(store).listen(0, '127.0.0.1')
let base = ''

before(async () => {
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  base = `http://127.0.0.1:${address.port}/api/v1`
})
after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  store.close()
})

async function request<T>(path: string, status = 200, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined,
  })
  const data = await response.json()
  assert.equal(response.status, status, JSON.stringify(data))
  return data as T
}

test('the API exposes computed runs, health, cases, audit and input errors', async () => {
  assert.deepEqual(await request('/health'), { status: 'ok', mode: 'synthetic' })
  await request('/scenarios/unknown/snapshot', 422)
  const result = await request<Snapshot>('/scenarios/vpn/runs', 201, 'POST')
  assert.equal(result.clusters.length, 1)
  assert.equal(result.scenario, 'vpn')
  const cases = await request<Case[]>('/cases')
  const entry = cases.find((row) => row.scenario === 'vpn' && row.channel === 'network')
  assert.ok(entry)
  const url = `/cases/${encodeURIComponent(entry.id)}`
  const changed = await request<Case>(url, 200, 'PATCH', { status: 'DISMISSED', note: 'Проверено аналитиком' })
  assert.equal(changed.status, 'DISMISSED')
  await request(url, 409, 'PATCH', { status: 'CONFIRMED', note: 'Попытка изменить закрытое дело' })
  await request('/scenarios/vpn/runs', 201, 'POST')
  assert.equal((await request<Case[]>('/cases')).find(({ id }) => id === entry.id)?.status, 'DISMISSED')
  const audit = await request<Audit[]>('/audit')
  assert.ok(audit.some(({ reference, action }) => reference === entry.id && action === 'CASE_REVIEWED'))
  await request('/does-not-exist', 404)
})

test('a linked ATM request reaches review and only an analyst can release the hold', async () => {
  const scenario = 'atm'
  const snapshot = await request<Snapshot>(`/scenarios/${scenario}/snapshot`)
  await request('/atm-decisions', 422, 'POST', { scenario, ...snapshot.cash, amount: -1 })
  await request('/atm-decisions', 404, 'POST', { scenario, ...snapshot.cash, account: 'AC-9999' })
  const decision = await request<AtmDecision>('/atm-decisions', 201, 'POST', { scenario, ...snapshot.cash })
  assert.equal(decision.state, 'HOLD')
  assert.ok(decision.caseId)
  const path = `/atm-decisions/${decision.id}`
  await request(`${path}/resolutions`, 409, 'POST', { answer: 'verified' })
  await request(`/cases/${encodeURIComponent(decision.caseId)}`, 200, 'PATCH', { status: 'DISMISSED', note: 'Сверены документы в симуляторе' })
  assert.equal((await request<AtmDecision>(path)).state, 'ALLOWED')
  assert.ok((await request<Audit[]>('/audit')).some(({ reference, action }) => reference === decision.id && action === 'ATM_OFFICER_RELEASED'))
})

test('the ATM supports a low-risk confirmation and a separate help flow', async () => {
  const normal = await request<Snapshot>('/scenarios/normal/snapshot')
  const challenge = await request<AtmDecision>('/atm-decisions', 201, 'POST', { scenario: 'normal', ...normal.cash, amount: 390_000 })
  assert.equal(challenge.state, 'CHALLENGE')
  const verified = await request<AtmDecision>(`/atm-decisions/${challenge.id}/resolutions`, 200, 'POST', { answer: 'verified' })
  assert.equal(verified.state, 'ALLOWED')
  const social = await request<Snapshot>('/scenarios/social/snapshot')
  const suspicious = await request<AtmDecision>('/atm-decisions', 201, 'POST', { scenario: 'social', ...social.cash })
  assert.equal(suspicious.state, 'REVIEW')
  const assisted = await request<AtmDecision>(`/atm-decisions/${suspicious.id}/resolutions`, 200, 'POST', { answer: 'assistance' })
  assert.equal(assisted.state, 'CANCELLED')
})

test('experimental P2P requests return reason codes and open an investigation', async () => {
  const snapshot = await request<Snapshot>('/scenarios/triangle/snapshot')
  const result = await request<{ risk: Risk; caseId: string }>('/deal-assessments', 201, 'POST', { scenario: 'triangle', ...snapshot.deal })
  assert.ok(result.caseId)
  assert.equal(result.risk.level, 'HIGH RISK')
  assert.ok(result.risk.reasons.some(({ code }) => code === 'RECIPIENT_MISMATCH'))
})

test('same amount and sender, different recipients and pre-debit decisions', async () => {
  const draft = { scenario: 'trace', requestId: randomUUID(), sender: 'AC-1016', recipient: 'AC-1002', amount: 252_000 }
  const normal = await request<TransferDecision>('/transfer-checks', 201, 'POST', draft)
  assert.equal(normal.state, 'READY')
  const confirm = `/transfer-checks/${normal.id}/resolutions`
  assert.equal((await request<TransferDecision>(confirm, 200, 'POST', { answer: 'confirm' })).state, 'COMPLETED')
  await request(confirm, 200, 'POST', { answer: 'confirm' })
  await request(confirm, 409, 'POST', { answer: 'cancel' })
  const suspicious = { ...draft, requestId: randomUUID(), recipient: 'AC-4102' }
  const held = await request<TransferDecision>('/transfer-checks', 201, 'POST', suspicious)
  assert.equal(held.state, 'REVIEW')
  assert.ok(held.caseId && held.risk.reasons.some(({ code }) => code === 'SHARED_DEVICE'))
  assert.ok(!held.risk.transactions.includes('TX-8278'))
  assert.equal((await request<TransferDecision>('/transfer-checks', 200, 'POST', suspicious)).id, held.id)
  await request('/transfer-checks', 409, 'POST', { ...suspicious, amount: 220_000 })
  const resolve = `/transfer-checks/${held.id}/resolutions`
  await request(resolve, 409, 'POST', { answer: 'confirm' })
  const released = `/cases/${encodeURIComponent(held.caseId)}`
  await request(released, 200, 'PATCH', { status: 'DISMISSED', note: 'Сверено в тестовом контуре' })
  assert.equal((await request<TransferDecision>(`/transfer-checks/${held.id}`)).state, 'READY')
  assert.equal((await request<TransferDecision>(resolve, 200, 'POST', { answer: 'help' })).state, 'CANCELLED')
  const audit = await request<Audit[]>('/audit')
  assert.equal(audit.filter(({ reference, action }) => reference === normal.id && action === 'TRANSFER_COMPLETED').length, 1)
  assert.ok(audit.some(({ reference, action }) => reference === held.id && action === 'TRANSFER_HELP'))
})

test('transfer benchmark compares both rules on the same labelled attempts', async () => {
  const result = await request<TransferBenchmark>('/transfer-benchmark')
  for (const { tp, tn, fp, fn } of [result.amountRule, result.qornet]) assert.equal(tp + tn + fp + fn, result.total)
  assert.equal(result.amountRule.tp + result.amountRule.fn, result.qornet.tp + result.qornet.fn)
  assert.equal(result.total, 48)
  assert.ok(result.qornet.fn > 0 && result.qornet.fp > 0)
  assert.ok(result.scoringP95Ms >= 0)
})
