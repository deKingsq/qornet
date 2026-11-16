import type { Account, CashRequest, Deal, ScenarioId, Session, Transfer } from '../shared/domain.ts'

export type Dataset = {
  scenario: ScenarioId
  accounts: Account[]
  sessions: Session[]
  transfers: Transfer[]
  cash: CashRequest
  deal: Deal
  expectedMules: Set<string>
}

export const origin = Date.parse('2026-11-12T05:00:00Z')
export const minute = 60_000
const id = (n: number) => String(n).padStart(2, '0')

export function fixture(scenario: ScenarioId, seed = 42): Dataset {
  let state = seed >>> 0
  const next = (max: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return Math.floor((state / 2 ** 32) * max)
  }
  const accounts: Account[] = Array.from({ length: 24 }, (_, i) => ({
    id: `AC-${1001 + i}`, name: `Клиент ${id(i + 1)}`, usualCash: 40_000 + next(65_000), role: 'retail',
  }))
  accounts.push(
    { id: 'AC-2001', name: 'Городской маркет', usualCash: 160_000, role: 'merchant' },
    { id: 'AC-2002', name: 'Транспортный сервис', usualCash: 200_000, role: 'merchant' },
  )
  const sessions: Session[] = accounts.map((account, i) => ({
    id: `SE-${1001 + i}`, account: account.id, device: `DV-${id(i + 1)}`,
    ip: i < 8 ? '198.51.100.24' : `192.0.2.${60 + i}`,
    at: origin + (20 + i * 12 + next(5)) * minute, vpn: i === 12,
  }))
  const transfers: Transfer[] = []
  function transfer(from: string, to: string, amount: number, offset: number, sessionId?: string) {
    transfers.push({ id: `TX-${8001 + transfers.length}`, from, to, amount, at: origin + offset * minute, sessionId })
  }
  const hourly = [6, 10, 8, 16, 22, 17, 25, 31, 23, 34, 26, 13]
  hourly.forEach((count, hour) => {
    for (let i = 0; i < count + next(4); i++) {
      const from = next(24)
      const to = (from + 1 + next(23)) % 24
      const amount = 1500 + next(395) * 100
      const offset = hour * 60 + next(60)
      const session = { ...sessions[from], id: `SE-P${transfers.length + 1}`, at: origin + (offset - 1) * minute }
      sessions.push(session)
      transfer(accounts[from].id, i % 4 === 0 ? accounts[to].id : accounts[24 + i % 2].id, amount, offset, session.id)
    }
  })

  const expectedMules = new Set<string>()
  if (['farm', 'vpn', 'trace', 'atm'].includes(scenario)) {
    const operators = Array.from({ length: 8 }, (_, i) => `AC-${4101 + i}`)
    const hub = 'AC-4190'
    const relay = 'AC-4191'
    const end = 'AC-4192'
    const linked = [...operators, hub, relay, end]
    linked.forEach((account, i) => {
      expectedMules.add(account)
      accounts.push({ id: account, name: i < 8 ? `Клиент ${id(i + 25)}` : ['Счёт 4190', 'Счёт 4191', 'Счёт 4192'][i - 8], usualCash: 55_000 + next(20_000), role: 'personal' })
      for (const round of [0, 1]) {
        const device = i === 3 ? (round === 0 ? 'DV-71' : 'DV-72') : i < 4 ? 'DV-71' : 'DV-72'
        sessions.push({
          id: `SE-${account.slice(3)}-${round}`, account, device,
          ip: scenario === 'vpn' ? `203.0.113.${100 + i * 2 + round}` : `203.0.113.${70 + round}`,
          vpn: scenario === 'vpn', at: origin + (367 + round * 57 + (i % 4)) * minute,
        })
      }
    })
    operators.forEach((account, i) => {
      const amount = 82_000 + next(16) * 1000
      transfer(accounts[i].id, account, amount, 366 + i, sessions[i].id)
      transfer(account, hub, amount - 2000, 375 + i, `SE-${account.slice(3)}-0`)
      transfer(account, relay, 74_000 + next(17) * 1000, 430 + i, `SE-${account.slice(3)}-1`)
    })
    const hubSession = 'SE-4190-0'
    transfer(hub, relay, 91_000, 384, hubSession)
    transfer(relay, end, 88_000, 388, 'SE-4191-0')
    transfer(end, hub, 85_000, 392, 'SE-4192-0')
    transfer(hub, end, 146_000, 441, 'SE-4190-1')
    transfer(relay, end, 83_000, 444, 'SE-4191-1')
    // A one-off legitimate counterparty tests that cluster proximity does not spread by itself.
    transfer(end, 'AC-2001', 24_000, 490, 'SE-4192-1')
    if (scenario === 'trace') {
      transfer('AC-1016', 'AC-4102', 252_000, 486, 'SE-1016')
      transfer('AC-4102', hub, 249_000, 488, 'SE-4102-1')
      transfer(hub, relay, 245_000, 491, 'SE-4190-1')
      transfer(relay, end, 239_000, 495, 'SE-4191-1')
      const second = ['AC-4201', 'AC-4202', 'AC-4290']
      second.forEach((account, i) => {
        expectedMules.add(account)
        accounts.push({ id: account, name: `Счёт ${account.slice(3)}`, usualCash: 65_000, role: 'personal' })
        sessions.push({ id: `SE-${account.slice(3)}-0`, account, device: 'DV-73', ip: '203.0.113.82', vpn: false, at: origin + (507 + i) * minute })
      })
      const bridgeSessions = [hub, relay, end].map((account, i) => {
        const id = `SE-${account.slice(3)}-2`
        sessions.push({ id, account, device: 'DV-72', ip: '203.0.113.71', vpn: false, at: origin + (500 + i * 3) * minute })
        return id
      })
      transfer(hub, relay, 140_000, 502, bridgeSessions[0])
      transfer(relay, end, 132_000, 506, bridgeSessions[1])
      transfer(end, second[0], 122_000, 512, bridgeSessions[2])
      transfer(second[0], second[2], 112_000, 515, 'SE-4201-0')
      transfer(second[1], second[2], 118_000, 516, 'SE-4202-0')
      transfer(second[2], second[0], 108_000, 520, 'SE-4290-0')
    }
    if (seed % 3 === 1) {
      // An account outside the observed infrastructure is labelled only for evaluation.
      expectedMules.add('AC-1024')
    }
  }
  const cash: CashRequest = {
    account: scenario === 'social' ? 'AC-1015' : expectedMules.has('AC-4192') ? 'AC-4192' : 'AC-1001',
    amount: scenario === 'social' ? 630_000 : expectedMules.has('AC-4192') ? 800_000 : 30_000,
    pressure: scenario === 'social', recentCredit: scenario === 'social',
  }
  const deal: Deal = {
    id: 'DEAL-2026-014', buyer: 'AC-1004', payer: 'AC-1004', seller: 'AC-1011',
    recipient: scenario === 'triangle' ? 'AC-1019' : 'AC-1004',
    payee: 'AC-1011', amount: 184_000, paid: 184_000,
    buyerConfirmed: true, sellerConfirmed: scenario !== 'triangle',
  }
  return { scenario, accounts, sessions, transfers: transfers.sort((a, b) => a.at - b.at), cash, deal, expectedMules }
}
