export const scenarios = [
  { id: 'normal', title: 'Обычная активность', code: 'Normal activity', detail: 'Несколько клиентов используют одну сеть. Их операции анализируются независимо.', page: 'network' },
  { id: 'farm', title: 'Дропперская сеть', code: 'Drop farm detected', detail: 'Группа счетов использует общие устройства и быстро переводит деньги общим получателям.', page: 'network' },
  { id: 'vpn', title: 'Смена IP и VPN', code: 'VPN masking', detail: 'IP-адреса меняются. Проверьте, остаются ли связи по устройствам и переводам.', page: 'network' },
  { id: 'trace', title: 'Цепочка переводов', code: 'Money trace', detail: 'Средства проходят через несколько счетов за минуты, часть возвращается в цикл.', page: 'trace' },
  { id: 'atm', title: 'Снятие в банкомате', code: 'ATM intervention', detail: 'Счёт в обнаруженном кластере запрашивает снятие 800 000 ₸.', page: 'atm' },
  { id: 'social', title: 'Социальная инженерия', code: 'Social engineering', detail: 'Клиент с обычным профилем запрашивает крупное снятие по указанию третьего лица.', page: 'atm' },
  { id: 'triangle', title: 'P2P-треугольник', code: 'Triangle fraud', detail: 'Плательщик и получатель товара указаны разными участниками сделки.', page: 'triangle' },
] as const

export type ScenarioId = typeof scenarios[number]['id']
export type Level = 'SAFE' | 'REVIEW' | 'HIGH RISK' | 'CRITICAL'
export type Family = 'device' | 'flow' | 'timing' | 'context' | 'customer' | 'deal'
export type Reason = { code: string; family: Family; ru: string; kk: string; points: number; refs: string[] }
export type Risk = { score: number; level: Level; action: string; reasons: Reason[]; accounts: string[]; transactions: string[] }
export type Account = { id: string; name: string; usualCash: number; role: 'retail' | 'merchant' | 'personal' }
export type Session = { id: string; account: string; device: string; ip: string; vpn: boolean; at: number }
export type Transfer = { id: string; from: string; to: string; amount: number; at: number; sessionId?: string }
export type Link = { a: string; b: string; signals: Reason[] }
export type Cluster = { id: string; members: string[]; links: Link[]; devices: string[]; receivers: string[]; risk: Risk }
export type Chain = { id: string; accounts: string[]; transactions: Transfer[]; minutes: number; retained: number; cycle: boolean; endpoint: string; risk: Risk }
export type NodeKind = 'account' | 'device' | 'ip'
export type GraphNode = { id: string; label: string; kind: NodeKind; level: Level; cluster?: string }
export type GraphEdge = { id: string; source: string; target: string; kind: 'transfer' | 'device' | 'ip'; amount?: number; emphasis?: boolean }
export type Graph = { nodes: GraphNode[]; edges: GraphEdge[] }
export type TransactionView = Transfer & { risk: Risk }
export type CaseStatus = 'OPEN' | 'INVESTIGATING' | 'CONFIRMED' | 'DISMISSED'
export type Case = { id: string; scenario: ScenarioId; title: string; channel: 'network' | 'trace' | 'atm' | 'triangle' | 'transfer'; status: CaseStatus; createdAt: number; updatedAt: number; risk: Risk }
export type Audit = { id: number; at: number; scenario: ScenarioId; channel: string; reference: string; action: string; payload: unknown }
export type CashRequest = { account: string; amount: number; pressure: boolean; recentCredit: boolean }
export type AtmState = 'ALLOWED' | 'CHALLENGE' | 'REVIEW' | 'HOLD' | 'CANCELLED'
export type AtmDecision = { id: string; scenario: ScenarioId; request: CashRequest; state: AtmState; risk: Risk; at: number; caseId?: string }
export type TransferRequest = { sender: string; recipient: string; amount: number }
export type TransferDecision = {
  id: string; scenario: ScenarioId; request: TransferRequest; state: 'READY' | 'REVIEW' | 'COMPLETED' | 'CANCELLED'
  risk: Risk; at: number; caseId?: string
}
export type Confusion = { tp: number; fp: number; fn: number; tn: number }
export type TransferBenchmark = {
  total: number; seeds: number; amountThreshold: number; graphThreshold: number
  amountRule: Confusion; qornet: Confusion; scoringP95Ms: number
}
export type Deal = { id: string; buyer: string; payer: string; seller: string; recipient: string; payee: string; amount: number; paid: number; buyerConfirmed: boolean; sellerConfirmed: boolean }
export type Snapshot = {
  scenario: ScenarioId
  accounts: (Account & { risk: Risk })[]
  sessions: Session[]
  transactions: TransactionView[]
  clusters: Cluster[]
  chains: Chain[]
  graph: Graph
  series: { hour: number; total: number; flagged: number }[]
  stats: { total: number; review: number; clusters: number; volume: number }
  cash: CashRequest
  deal: Deal
}
export type Evaluation = {
  samples: number; accounts: number; tp: number; fp: number; fn: number; tn: number
  precision: number; recall: number; falsePositiveRate: number; ms: number
}
