import type { Confusion, Risk, ScenarioId, Snapshot, TransferBenchmark, TransferRequest } from '../shared/domain.ts'
import { analyze, limits } from './engine.ts'
import { fixture, minute, origin } from './fixtures.ts'

export function transferHistory(scenario: ScenarioId, seed?: number): Snapshot {
  const dataset = fixture(scenario, seed)
  if (scenario !== 'trace') return analyze(dataset)
  // The stage demo replays a draft of the first transfer in the illustrated trace.
  // Its decision may only use events that precede that transfer.
  const cutoff = origin + 486 * minute
  return analyze({
    ...dataset,
    sessions: dataset.sessions.filter(({ at }) => at < cutoff),
    transfers: dataset.transfers.filter(({ at }) => at < cutoff),
  })
}

export function transferRisk(snapshot: Snapshot, request: TransferRequest): Risk {
  const recipient = snapshot.accounts.find(({ id }) => id === request.recipient)!
  const evidence = recipient.risk
  const reasons = evidence.reasons.filter(({ family }) => family !== 'context')
  return {
    ...evidence, reasons,
    accounts: [...new Set([request.sender, request.recipient, ...evidence.accounts])],
    action: evidence.score >= limits.review ? 'Приостановить до дополнительной проверки' : 'Разрешить подтверждение',
  }
}

const amountThreshold = 200_000
const benchmarkSeeds = [53, 61, 83, 97]

export function benchmarkTransfers(): TransferBenchmark {
  const amountRule: Confusion = { tp: 0, fp: 0, fn: 0, tn: 0 }
  const qornet: Confusion = { tp: 0, fp: 0, fn: 0, tn: 0 }
  const timings: number[] = []
  function record(matrix: Confusion, expected: boolean, review: boolean) {
    matrix[expected ? (review ? 'tp' : 'fn') : (review ? 'fp' : 'tn')]++
  }
  for (const seed of benchmarkSeeds) {
    const history = transferHistory('trace', seed)
    // These attempts occur after the fixture history. Labels describe intent
    // independently of whether the recipient is visible to the graph.
    const cases = [
      { recipient: 'AC-4102', amount: 42_000 + seed * 73, scam: true },
      { recipient: 'AC-4190', amount: 95_000 + seed * 97, scam: true },
      { recipient: 'AC-4191', amount: 252_000 + seed * 113, scam: true },
      { recipient: 'AC-4192', amount: 310_000 + seed * 191, scam: true },
      { recipient: 'AC-1024', amount: 245_000 + seed * 111, scam: true },
      { recipient: 'AC-1017', amount: 65_000 + seed * 67, scam: true },
      { recipient: 'AC-1002', amount: 252_000 + seed * 113, scam: false },
      { recipient: 'AC-2001', amount: 420_000 + seed * 193, scam: false },
      { recipient: 'AC-1007', amount: 285_000 + seed * 127, scam: false },
      { recipient: 'AC-1005', amount: 68_000 + seed * 71, scam: false },
      { recipient: 'AC-1013', amount: 110_000 + seed * 131, scam: false },
      { recipient: 'AC-4104', amount: 36_000 + seed * 53, scam: false },
    ]
    for (const { scam, ...attempt } of cases) {
      const start = performance.now()
      const risk = transferRisk(history, { sender: 'AC-1016', ...attempt })
      timings.push(performance.now() - start)
      record(amountRule, scam, attempt.amount >= amountThreshold)
      record(qornet, scam, risk.score >= limits.review)
    }
  }
  timings.sort((a, b) => a - b)
  return { total: timings.length, seeds: benchmarkSeeds.length, amountThreshold, graphThreshold: limits.review, amountRule, qornet,
    scoringP95Ms: Number(timings[Math.ceil(timings.length * .95) - 1].toFixed(3)) }
}
