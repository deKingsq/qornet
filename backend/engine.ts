import type {
  Account, CashRequest, Chain, Cluster, Deal, Evaluation, Graph, GraphEdge, GraphNode, Link,
  Reason, Risk, ScenarioId, Session, Snapshot, Transfer,
} from '../shared/domain.ts'
import { scenarios } from '../shared/domain.ts'
import { fixture, minute, origin } from './fixtures.ts'
import type { Dataset } from './fixtures.ts'

export const limits = { review: 25, high: 60, critical: 90, relayMinutes: 15, fanInMinutes: 25 } as const
const unique = <T,>(items: T[]) => [...new Set(items)]

const reason = (code: string, family: Reason['family'], points: number, ru: string, kk: string, refs: string[]): Reason =>
  ({ code, family, points, ru, kk, refs: unique(refs) })

function assess(reasons: Reason[], accounts: string[], transactions: string[], cap = 89): Risk {
  const score = Math.min(cap, reasons.reduce((total, signal) => total + signal.points, 0))
  const level = score >= limits.critical ? 'CRITICAL' : score >= limits.high ? 'HIGH RISK' : score >= limits.review ? 'REVIEW' : 'SAFE'
  const action = {
    SAFE: 'Разрешить операцию', REVIEW: 'Запросить дополнительную проверку',
    'HIGH RISK': 'Передать сотруднику безопасности', CRITICAL: 'Временно приостановить и передать сотруднику',
  }[level]
  return { score, level, action, reasons, accounts: unique(accounts), transactions: unique(transactions) }
}

function indexBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const result = new Map<string, T[]>()
  for (const item of items) {
    const id = key(item)
    const group = result.get(id) ?? []
    if (!result.has(id)) result.set(id, group)
    group.push(item)
  }
  return result
}

function detectClusters(dataset: Dataset): Cluster[] {
  const byDevice = indexBy(dataset.sessions, (event) => event.device)
  const outbound = indexBy(dataset.transfers, (event) => event.from)
  const roles = new Map(dataset.accounts.map((item) => [item.id, item.role]))
  const candidates = new Map<string, { a: string; b: string; devices: string[]; sessions: Session[] }>()

  for (const [device, sessions] of byDevice) {
    const accounts = [...indexBy(sessions, (event) => event.account).entries()].sort(([a], [b]) => a.localeCompare(b))
    for (let i = 0; i < accounts.length; i++) {
      for (let j = i + 1; j < accounts.length; j++) {
        const [a, aSessions] = accounts[i]
        const [b, bSessions] = accounts[j]
        const key = `${a}|${b}`
        const existing = candidates.get(key) ?? { a, b, devices: [], sessions: [] }
        existing.devices.push(device)
        existing.sessions.push(...aSessions, ...bSessions)
        candidates.set(key, existing)
      }
    }
  }

  const links: Link[] = []
  for (const { a, b, devices, sessions } of candidates.values()) {
    const aOut = outbound.get(a) ?? []
    const bOut = outbound.get(b) ?? []
    const funnel = aOut.flatMap((left) => bOut.filter((right) =>
      left.to === right.to && roles.get(left.to) !== 'merchant' &&
      Math.min(left.amount, right.amount) >= 50_000 &&
      Math.abs(left.at - right.at) <= limits.fanInMinutes * minute
    ).map((right) => [left, right] as const))
    const direct = [...aOut, ...bOut].filter((event) => event.amount >= 50_000 &&
      ((event.from === a && event.to === b) || (event.from === b && event.to === a)) &&
      sessions.some((session) => session.id === event.sessionId && Math.abs(session.at - event.at) <= 30 * minute))
    if (!funnel.length && !direct.length) continue
    const timing = sessions.some((left) => left.account === a &&
      sessions.some((right) => right.account === b && left.device === right.device && Math.abs(left.at - right.at) <= 4 * minute))
    const signals = [
      reason('SHARED_DEVICE', 'device', 30, 'Совпадает отпечаток устройства', 'Құрылғының цифрлық ізі сәйкес келеді', [...devices, ...sessions.map((event) => event.id)]),
      reason(funnel.length ? 'COMMON_FUNNEL' : 'DIRECT_FLOW', 'flow', 34,
        funnel.length ? 'Переводы общему получателю в одном временном окне' : 'Крупный прямой перевод во время связанной сессии',
        funnel.length ? 'Бір уақытта ортақ алушыға аударым жасалған' : 'Байланысты сессияда ірі тікелей аударым жасалған',
        [...funnel.flat().map((event) => event.id), ...direct.map((event) => event.id)]),
    ]
    if (timing) signals.push(reason('SESSION_BURST', 'timing', 12, 'Сессии на общем устройстве начались с разницей до 4 минут', 'Ортақ құрылғыдағы сессиялар 4 минут ішінде басталған', sessions.map((event) => event.id)))
    links.push({ a, b, signals })
  }

  const adjacent = indexBy(links.flatMap((link) => [
    { key: link.a, neighbor: link.b, link }, { key: link.b, neighbor: link.a, link },
  ]), (item) => item.key)
  const seen = new Set<string>()
  const clusters: Cluster[] = []
  for (const anchor of [...adjacent.keys()].sort()) {
    if (seen.has(anchor)) continue
    const stack = [anchor]
    const members: string[] = []
    const connected = new Set<Link>()
    while (stack.length) {
      const member = stack.pop()!
      if (seen.has(member)) continue
      seen.add(member)
      members.push(member)
      for (const { neighbor, link } of adjacent.get(member) ?? []) {
        connected.add(link)
        if (!seen.has(neighbor)) stack.push(neighbor)
      }
    }
    if (members.length < 3) continue
    const clusterLinks = [...connected]
    const evidence = clusterLinks.flatMap((link) => link.signals)
    const aggregate = unique(evidence.map((item) => item.code)).map((code) => {
      const matches = evidence.filter((item) => item.code === code)
      const corroboratesFlow = code === 'DIRECT_FLOW' && evidence.some((item) => item.code === 'COMMON_FUNNEL')
      return { ...matches[0], points: corroboratesFlow ? 0 : matches[0].points, refs: unique(matches.flatMap((item) => item.refs)) }
    })
    const memberSet = new Set(members)
    const txIds = unique(evidence.filter((item) => item.family === 'flow').flatMap((item) => item.refs))
    const txSet = new Set(txIds)
    const receivers = unique(dataset.transfers.filter((item) => txSet.has(item.id)).map((item) => item.to)).sort()
    const devices = unique(evidence.filter((item) => item.family === 'device').flatMap((item) => item.refs).filter((ref) => byDevice.has(ref))).sort()
    const vpn = dataset.sessions.filter((item) => item.vpn && memberSet.has(item.account))
    if (vpn.length) aggregate.push(reason('VPN_CONTEXT', 'context', 0, 'VPN отмечен как контекст сессии', 'VPN сессияның қосымша мәнмәтіні ретінде белгіленді', vpn.map((item) => item.id)))
    members.sort()
    clusters.push({ id: `CL-${members[0].slice(3)}`, members, links: clusterLinks, devices, receivers, risk: assess(aggregate, members, txIds, 86) })
  }
  return clusters.sort((a, b) => b.risk.score - a.risk.score || a.id.localeCompare(b.id))
}

function findChains(transfers: Transfer[]): Chain[] {
  const substantial = transfers.filter((item) => item.amount >= 50_000)
  const outgoing = indexBy(substantial, (item) => item.from)
  const paths: Transfer[][] = []
  function walk(path: Transfer[], visited: Set<string>) {
    const tail = path.at(-1)!
    const first = path[0]
    if (path.length >= 3) paths.push(path)
    if (path.length >= 5 || tail.to === first.from) return
    const next = (outgoing.get(tail.to) ?? []).filter((item) => item.at > tail.at &&
      item.at - tail.at <= limits.relayMinutes * minute && item.amount >= tail.amount * 0.65 &&
      item.amount <= tail.amount * 1.05 && (!visited.has(item.to) || item.to === first.from)).slice(0, 6)
    for (const item of next) walk([...path, item], new Set([...visited, item.to]))
  }
  for (const item of substantial) walk([item], new Set([item.from, item.to]))
  const canonical = (path: Transfer[]) => path.map((item) => item.id).join('/')
  const ordered = paths.sort((a, b) => b.length - a.length || b[0].amount - a[0].amount || canonical(a).localeCompare(canonical(b)))
  const distinct: Transfer[][] = []
  for (const path of ordered) {
    const cycle = path[0].from === path.at(-1)!.to
    const redundant = distinct.some((other) => canonical(other).includes(canonical(path)) &&
      (!cycle || other[0].from === other.at(-1)!.to))
    if (!redundant) distinct.push(path)
  }
  return distinct.map((path): Chain => {
    const first = path[0]
    const tail = path.at(-1)!
    const accounts = [first.from, ...path.map((item) => item.to)]
    const cycle = tail.to === first.from
    const minutes = Math.round((tail.at - first.at) / minute)
    const retained = Math.round(tail.amount / first.amount * 100)
    const refs = path.map((item) => item.id)
    const reasons = [
      reason('RAPID_RELAY', 'timing', 30, `${path.length} ${path.length === 5 ? 'переводов' : 'перевода'} за ${minutes} мин`, `${minutes} минутта ${path.length} аударым`, refs),
      reason('MATCHED_AMOUNTS', 'flow', 26, `Отношение последней суммы к первой: ${retained}%`, `Соңғы соманың алғашқыға қатынасы: ${retained}%`, refs),
    ]
    if (cycle) reasons.push(reason('CIRCULAR_FLOW', 'flow', 20, 'Средства вернулись на исходный счёт', 'Қаражат бастапқы шотқа қайтарылды', refs))
    return { id: `TR-${refs.join('-').replaceAll('TX-', '')}`, accounts, transactions: path, minutes, retained, cycle, endpoint: tail.to, risk: assess(reasons, accounts, refs) }
  }).sort((a, b) => b.transactions[0].amount - a.transactions[0].amount || b.risk.score - a.risk.score || b.transactions.length - a.transactions.length)
}

export function analyze(dataset: Dataset): Snapshot {
  const clusters = detectClusters(dataset)
  const membership = new Map(clusters.flatMap((cluster) => cluster.members.map((member) => [member, cluster] as const)))
  const chains = findChains(dataset.transfers).map((chain) => {
    const crossings = chain.transactions.filter((item) => {
      const source = membership.get(item.from)
      const target = membership.get(item.to)
      return source && target && source.id !== target.id
    })
    if (!crossings.length) return chain
    const evidence = crossings.flatMap((item) => [item.id, membership.get(item.from)!.id, membership.get(item.to)!.id])
    const bridge = reason('CROSS_CLUSTER', 'flow', 14, 'Перевод пересекает два независимо подтверждённых кластера',
      'Аударым тәуелсіз расталған екі кластерді байланыстырады', evidence)
    return { ...chain, risk: assess([...chain.risk.reasons, bridge], chain.accounts, chain.risk.transactions, 86) }
  })
  const pathByTransaction = indexBy(chains.flatMap((chain) => chain.transactions.map((item) => ({ item, chain }))), ({ item }) => item.id)
  const incident = indexBy(dataset.transfers.flatMap((item) => [
    { id: item.from, other: item.to, item }, { id: item.to, other: item.from, item },
  ]), (item) => item.id)
  const ipGroups = indexBy(dataset.sessions, (session) => session.ip)
  const sharedIps = new Set([...ipGroups].filter(([, items]) => unique(items.map((item) => item.account)).length > 1).map(([ip]) => ip))
  const sessionGroups = indexBy(dataset.sessions, (session) => session.account)

  const accounts = dataset.accounts.map((account) => {
    const cluster = membership.get(account.id)
    const history = incident.get(account.id) ?? []
    const neighbors = history.filter(({ other, item }) => membership.has(other) && item.amount >= 50_000 && pathByTransaction.has(item.id))
    const reasons = cluster ? cluster.risk.reasons.filter((item) => item.code !== 'VPN_CONTEXT') : []
    const connections = unique(neighbors.map(({ other }) => other))
    if (!cluster && unique(neighbors.map(({ item }) => item.id)).length >= 2 && connections.length >= 2) {
      reasons.push(reason('CORROBORATED_NEIGHBOR', 'flow', 18, 'Два независимых контрагента в наблюдаемых денежных цепочках', 'Бақыланған тізбектерде екі тәуелсіз контрагент', neighbors.map(({ item }) => item.id)))
    }
    const sessions = sessionGroups.get(account.id) ?? []
    const ip = sessions.filter((item) => sharedIps.has(item.ip))
    const vpn = sessions.filter((item) => item.vpn)
    if (ip.length) reasons.push(reason('SHARED_IP', 'context', 0, 'Общий IP отмечен как контекст', 'Ортақ IP қосымша мәнмәтін ретінде белгіленді', ip.map((item) => item.id)))
    if (vpn.length) reasons.push(reason('VPN_CONTEXT', 'context', 0, 'VPN отмечен как контекст', 'VPN қосымша мәнмәтін ретінде белгіленді', vpn.map((item) => item.id)))
    const transactions = cluster ? cluster.risk.transactions : neighbors.map(({ item }) => item.id)
    return { ...account, risk: assess(reasons, cluster?.members ?? [account.id, ...connections], transactions, 86) }
  })

  const transactions = dataset.transfers.map((item) => {
    const chain = (pathByTransaction.get(item.id) ?? []).map((row) => row.chain).sort((a, b) => b.risk.score - a.risk.score)[0]
    const related = membership.get(item.from)
    const reasons = [...(chain?.risk.reasons ?? [])]
    if (related && related.risk.transactions.includes(item.id)) {
      reasons.push(reason('LINKED_TRANSFER', 'device', 34, 'Перевод подтверждает технически связанный кластер', 'Аударым техникалық байланысы бар кластерді растайды', [related.id, item.id]))
    }
    return { ...item, risk: assess(reasons, chain?.accounts ?? [item.from, item.to], chain?.risk.transactions ?? [item.id], 86) }
  })

  const accountNodes: GraphNode[] = accounts.map((account) => ({
    id: account.id, label: account.id, kind: 'account', level: account.risk.level, cluster: membership.get(account.id)?.id,
  }))
  const devices: GraphNode[] = unique(dataset.sessions.map((item) => item.device)).map((device) => ({
    id: device, label: device, kind: 'device', level: clusters.some((cluster) => cluster.devices.includes(device)) ? 'HIGH RISK' : 'SAFE',
  }))
  const ips: GraphNode[] = [...sharedIps].map((ip) => ({ id: ip, label: ip, kind: 'ip', level: 'SAFE' }))
  const edges: GraphEdge[] = transactions.map((item) => ({
    id: item.id, source: item.from, target: item.to, kind: 'transfer', amount: item.amount, emphasis: item.risk.score >= limits.review,
  }))
  const seenRelations = new Set<string>()
  for (const session of dataset.sessions) {
    for (const [kind, target] of [['device', session.device], ['ip', session.ip]] as const) {
      if (kind === 'ip' && !sharedIps.has(target)) continue
      const id = `${session.account}:${kind}:${target}`
      if (seenRelations.has(id)) continue
      seenRelations.add(id)
      edges.push({ id, source: session.account, target, kind })
    }
  }
  const graph: Graph = { nodes: [...accountNodes, ...devices, ...ips], edges }
  const flagged = transactions.filter((item) => item.risk.level !== 'SAFE')
  const series = Array.from({ length: 12 }, (_, i) => {
    const inHour = (item: Transfer) => Math.floor((item.at - origin) / (60 * minute)) === i
    return { hour: i + 10, total: transactions.filter(inHour).length, flagged: flagged.filter(inHour).length }
  })
  return {
    scenario: dataset.scenario, accounts, sessions: dataset.sessions, transactions: transactions.toReversed(),
    clusters, chains, graph, series, cash: dataset.cash, deal: dataset.deal,
    stats: { total: transactions.length, review: flagged.length, clusters: clusters.length, volume: transactions.reduce((sum, item) => sum + item.amount, 0) },
  }
}

export function cashRisk(snapshot: Snapshot, request: CashRequest, account: Account): Risk {
  const accountRisk = snapshot.accounts.find((item) => item.id === account.id)!.risk
  const cluster = snapshot.clusters.find((item) => item.members.includes(account.id))
  const cash = request.amount >= Math.max(150_000, account.usualCash * 3)
  const reasons: Reason[] = []
  if (cluster) reasons.push(reason('NETWORK_MATCH', 'device', 42, 'Счёт входит в кластер, подтверждённый устройствами и переводами', 'Шот құрылғылар мен аударымдар растаған кластерге кіреді', [cluster.id, account.id, ...cluster.devices]))
  if (cash) reasons.push(reason('UNUSUAL_CASH', 'context', 28, 'Сумма существенно превышает обычные снятия клиента', 'Сома клиенттің әдеттегі қолма-қол алуынан едәуір жоғары', [account.id]))
  const endpoint = snapshot.chains.find((chain) => !chain.cycle && chain.endpoint === account.id)
  if (cluster && endpoint) reasons.push(reason('TRACE_ENDPOINT', 'flow', 22, 'На счёт поступили средства из быстрой цепочки', 'Шотқа жылдам аударым тізбегінен қаражат түсті', [endpoint.id, ...endpoint.risk.transactions]))
  if (request.pressure) reasons.push(reason('THIRD_PARTY_PRESSURE', 'customer', 35, 'Клиент сообщает об указаниях третьего лица', 'Клиент үшінші тұлғаның нұсқауын хабарлады', [account.id]))
  if (request.recentCredit && cash) reasons.push(reason('RECENT_CREDIT', 'context', 10, 'Снятие следует за недавним кредитом', 'Қолма-қол алу жуырдағы кредиттен кейін орындалды', [account.id]))
  const holdEligible = Boolean(cluster && cash && endpoint && request.amount >= 500_000)
  return assess(reasons, accountRisk.accounts, endpoint?.risk.transactions ?? accountRisk.transactions, holdEligible ? 100 : 89)
}

export function dealRisk(deal: Deal): Risk {
  const reasons: Reason[] = []
  if (deal.payer !== deal.buyer) reasons.push(reason('PAYER_MISMATCH', 'deal', 35, 'Плательщик не совпадает с покупателем', 'Төлеуші сатып алушымен сәйкес келмейді', [deal.id, deal.payer, deal.buyer]))
  if (deal.recipient !== deal.buyer) reasons.push(reason('RECIPIENT_MISMATCH', 'deal', 38, 'Получатель товара не совпадает с покупателем', 'Тауар алушы сатып алушымен сәйкес келмейді', [deal.id, deal.recipient, deal.buyer]))
  if (deal.payee !== deal.seller) reasons.push(reason('PAYEE_MISMATCH', 'deal', 35, 'Деньги направлены не продавцу', 'Ақша сатушыға бағытталмаған', [deal.id, deal.payee, deal.seller]))
  if (deal.paid !== deal.amount) reasons.push(reason('AMOUNT_MISMATCH', 'deal', 25, 'Сумма платежа отличается от условий сделки', 'Төлем сомасы мәміле шарттарынан өзгеше', [deal.id]))
  if (!deal.buyerConfirmed || !deal.sellerConfirmed) reasons.push(reason('UNCONFIRMED', 'deal', 25, 'Условия сделки подтверждены не всеми сторонами', 'Мәміле шарттарын барлық тарап растаған жоқ', [deal.id]))
  return assess(reasons, [deal.buyer, deal.payer, deal.seller, deal.recipient, deal.payee], [])
}

export function evaluate(): Evaluation {
  const started = performance.now()
  let tp = 0, fp = 0, fn = 0, tn = 0
  const seeds = [17, 31, 42, 73]
  for (const { id } of scenarios) for (const seed of seeds) {
    const dataset = fixture(id, seed)
    for (const account of analyze(dataset).accounts) {
      const expected = dataset.expectedMules.has(account.id)
      const flagged = account.risk.score >= limits.high
      if (expected && flagged) tp++
      if (!expected && flagged) fp++
      if (expected && !flagged) fn++
      if (!expected && !flagged) tn++
    }
  }
  return {
    samples: seeds.length * scenarios.length, accounts: tp + fp + fn + tn, tp, fp, fn, tn,
    precision: tp / (tp + fp || 1), recall: tp / (tp + fn || 1), falsePositiveRate: fp / (fp + tn || 1),
    ms: Math.round(performance.now() - started),
  }
}

export const scenarioSnapshot = (id: ScenarioId) => analyze(fixture(id))
