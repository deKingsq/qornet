import { ArrowRight, Banknote, CircleCheck, Fingerprint, GitBranch, GitCompareArrows, Handshake, Network, PhoneCall, Play } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { scenarios } from '../shared/domain.ts'
import type { Deal, Risk, ScenarioId, Snapshot } from '../shared/domain.ts'
import { Empty, PanelTitle, RiskSummary } from './components.tsx'
import { api } from './lib.ts'

const icons = { normal: CircleCheck, farm: Network, vpn: Fingerprint, trace: GitBranch, atm: Banknote, social: PhoneCall, triangle: Handshake }

export function DemoPage({ current, pending, run }: { current: ScenarioId; pending: boolean; run: (id: ScenarioId, page: string) => void }) {
  return <>
    <section className="demo-entry panel">
      <div><h2>Показ для жюри</h2><p>Проверка перевода до списания, разбор связей и решение банкомата.</p></div>
      <a className="button primary" href="#/showcase"><Play size={16} fill="currentColor" />Начать показ<ArrowRight size={16} /></a>
    </section>
    <div className="scenario-grid">
    {scenarios.map(({ id, title, code, detail, page }) => {
      const Icon = icons[id]
      return <article className="panel scenario-card" key={id}>
        <div className="scenario-card-top"><span className="tile-icon mint"><Icon size={20} /></span>{current === id && <span className="active-scenario">Текущий</span>}</div>
        <small>{code}</small><h2>{title}</h2><p>{detail}</p>
        <button className="button secondary wide" onClick={() => run(id, page)} disabled={pending}><Play size={14} />Запустить<ArrowRight size={15} /></button>
      </article>
    })}
    </div>
  </>
}

export function TrianglePage({ snapshot, onChange }: { snapshot: Snapshot; onChange: () => void }) {
  const [deal, setDeal] = useState(snapshot.deal)
  const [result, setResult] = useState<{ risk: Risk; caseId?: string }>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const participants = { buyer: 'Покупатель', payer: 'Плательщик', seller: 'Продавец', payee: 'Получатель платежа', recipient: 'Получатель товара' } as const
  const set = <K extends keyof Deal,>(key: K, value: Deal[K]) => { setDeal({ ...deal, [key]: value }); setResult(undefined) }
  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      setResult(await api('/deal-assessments', { method: 'POST', body: JSON.stringify({ scenario: snapshot.scenario, ...deal }) }))
      onChange()
    } catch (cause) { setError((cause as Error).message) }
    finally { setBusy(false) }
  }
  return <div className="graph-grid">
    <section className="panel">
      <PanelTitle title="Условия сделки" detail="Экспериментальный сервис сверки участников P2P" aside={<Handshake size={19} className="muted" />} />
      <form onSubmit={(event) => void submit(event)}>
        <div className="form-grid">
          <label>Идентификатор<input value={deal.id} required pattern="DEAL-[A-Z0-9\-]{1,32}" onChange={(event) => set('id', event.target.value)} /></label>
          {Object.entries(participants).map(([key, label]) => <label key={key}>{label}<select value={deal[key as keyof typeof participants]} onChange={(event) => set(key as keyof typeof participants, event.target.value)}>
            {snapshot.accounts.map(({ id }) => <option key={id}>{id}</option>)}
          </select></label>)}
          <label>Сумма сделки, ₸<input type="number" required min={100} max={5_000_000} value={deal.amount || ''} onChange={(event) => set('amount', Number(event.target.value))} /></label>
          <label>Фактически оплачено, ₸<input type="number" required min={100} max={5_000_000} value={deal.paid || ''} onChange={(event) => set('paid', Number(event.target.value))} /></label>
        </div>
        <label className="check"><input type="checkbox" checked={deal.buyerConfirmed} onChange={(event) => set('buyerConfirmed', event.target.checked)} />Покупатель подтвердил условия</label>
        <label className="check"><input type="checkbox" checked={deal.sellerConfirmed} onChange={(event) => set('sellerConfirmed', event.target.checked)} />Продавец подтвердил условия</label>
        <button className="button primary" disabled={busy} type="submit"><GitCompareArrows size={16} />Сверить сделку</button>
        {error && <p className="error" role="alert">{error}</p>}
      </form>
    </section>
    <section className="panel">
      <PanelTitle title="Результат сверки" detail="Несоответствия направляются на дополнительную проверку" />
      {result ? <><RiskSummary risk={result.risk} />{result.caseId && <a className="button secondary" href={`#/cases/${encodeURIComponent(result.caseId)}`}>Открыть дело<ArrowRight size={15} /></a>}</> :
        <Empty>Сверьте участников, платёж и условия передачи товара.</Empty>}
    </section>
  </div>
}
