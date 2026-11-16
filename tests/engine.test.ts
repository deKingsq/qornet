import assert from 'node:assert/strict'
import test from 'node:test'
import { analyze, cashRisk, dealRisk, evaluate, scenarioSnapshot } from '../backend/engine.ts'
import { fixture, minute } from '../backend/fixtures.ts'

test('the farm is found from reproducible independent evidence', () => {
  const data = fixture('farm')
  const result = analyze(data)
  assert.deepEqual(result, analyze(fixture('farm')))
  assert.equal(result.clusters.length, 1)
  const [cluster] = result.clusters
  assert.deepEqual(new Set(cluster.members), data.expectedMules)
  assert.ok(cluster.links.every(({ signals }) =>
    signals.some(({ family }) => family === 'device') && signals.some(({ family }) => family === 'flow')))
  const references = new Set([
    ...data.sessions.flatMap(({ id, device }) => [id, device]), ...data.transfers.map(({ id }) => id),
  ])
  assert.ok(cluster.risk.reasons.every(({ ru, kk, refs }) => ru && kk && refs.length && refs.every((id) => references.has(id))))
  assert.ok(cluster.risk.transactions.every((id) => result.transactions.some((item) => item.id === id)))
})

test('shared public IP, VPN, and legitimate merchants do not create high-risk accounts', () => {
  const result = scenarioSnapshot('normal')
  assert.ok(result.sessions.filter(({ ip }) => ip === '198.51.100.24').length >= 8)
  assert.ok(result.graph.edges.some(({ kind }) => kind === 'ip'))
  assert.ok(result.accounts.some(({ risk }) => risk.reasons.some(({ code }) => code === 'VPN_CONTEXT')))
  assert.equal(result.clusters.length, 0)
  assert.equal(result.stats.review, 0)
  assert.ok(result.accounts.every(({ risk }) => risk.score === 0 && risk.level === 'SAFE'))
})

test('an IP change leaves corroborated links intact and contributes zero points', () => {
  const normal = scenarioSnapshot('farm')
  const masked = scenarioSnapshot('vpn')
  assert.deepEqual(masked.clusters[0].members, normal.clusters[0].members)
  assert.equal(masked.clusters[0].risk.score, normal.clusters[0].risk.score)
  assert.ok(masked.clusters[0].risk.reasons.some(({ code, points }) => code === 'VPN_CONTEXT' && points === 0))
})

test('removing financial corroboration prevents the device graph from forming a cluster', () => {
  const data = fixture('farm')
  const noLargeTransfers = { ...data, transfers: data.transfers.filter(({ amount }) => amount < 50_000) }
  assert.equal(analyze(noLargeTransfers).clusters.length, 0)
})

test('money trails preserve chronological ordering and expose an actual cycle', () => {
  const snapshot = scenarioSnapshot('trace')
  assert.ok(snapshot.chains.some(({ cycle, accounts }) => cycle && accounts[0] === accounts.at(-1)))
  const route = snapshot.chains[0]
  assert.equal(route.transactions[0].amount, 252_000)
  assert.equal(route.endpoint, 'AC-4192')
  assert.equal(route.minutes, 9)
  assert.equal(snapshot.clusters.length, 2)
  assert.ok(snapshot.chains.some(({ risk }) => risk.reasons.some(({ code }) => code === 'CROSS_CLUSTER')))
  assert.ok(route.transactions.slice(1).every((item, i) => {
    const previous = route.transactions[i]
    return item.from === previous.to && item.at > previous.at && item.at - previous.at <= 15 * minute
  }))
})

test('proximity alone does not propagate risk to unrelated counterparties', () => {
  const result = scenarioSnapshot('farm')
  assert.equal(result.accounts.find(({ id }) => id === 'AC-2001')?.risk.level, 'SAFE')
  assert.equal(result.accounts.find(({ id }) => id === 'AC-1001')?.risk.level, 'SAFE')
})

test('the ATM acts on corroborated network risk, unusual amount and money trail', () => {
  const snapshot = scenarioSnapshot('atm')
  const account = snapshot.accounts.find(({ id }) => id === snapshot.cash.account)!
  const high = cashRisk(snapshot, snapshot.cash, account)
  assert.equal(high.level, 'CRITICAL')
  assert.deepEqual(high.reasons.map(({ code }) => code), ['NETWORK_MATCH', 'UNUSUAL_CASH', 'TRACE_ENDPOINT'])
  assert.equal(cashRisk(snapshot, { ...snapshot.cash, amount: 20_000 }, account).level, 'HIGH RISK')
})

test('scam pressure leads to employee review for an otherwise ordinary account', () => {
  const snapshot = scenarioSnapshot('social')
  const account = snapshot.accounts.find(({ id }) => id === snapshot.cash.account)!
  assert.equal(account.risk.level, 'SAFE')
  assert.equal(cashRisk(snapshot, snapshot.cash, account).level, 'HIGH RISK')
  assert.equal(cashRisk(snapshot, { ...snapshot.cash, amount: 15_000, pressure: false, recentCredit: false }, account).level, 'SAFE')
})

test('P2P validation responds to participant mismatch and confirmation', () => {
  const deal = scenarioSnapshot('triangle').deal
  assert.equal(dealRisk(deal).level, 'HIGH RISK')
  assert.equal(dealRisk({ ...deal, recipient: deal.buyer, sellerConfirmed: true }).level, 'SAFE')
})

test('evaluation is computed from labels and exposes missed accounts', () => {
  const result = evaluate()
  assert.equal(result.samples, 28)
  assert.equal(result.accounts, result.tp + result.fp + result.fn + result.tn)
  assert.ok(result.fn > 0)
  assert.equal(result.precision, result.tp / (result.tp + result.fp))
  assert.equal(result.recall, result.tp / (result.tp + result.fn))
  assert.equal(result.falsePositiveRate, result.fp / (result.fp + result.tn))
})
