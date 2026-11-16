import { ArrowRight, ArrowUpRight, Check, CirclePause, FlaskConical, RotateCcw, ShieldCheck, Smartphone } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { Snapshot, TransferBenchmark, TransferDecision, TransferRequest } from '../shared/domain.ts'
import { Empty, PanelTitle, RiskSummary } from './components.tsx'
import { api, money, num } from './lib.ts'

export const transferExamples = [
  { label: 'Обычный получатель', recipient: 'AC-1002' },
  { label: 'Получатель связан с сетью', recipient: 'AC-4102' },
]
export const makeTransferExample = (recipient = transferExamples[0].recipient): TransferRequest => ({ sender: 'AC-1016', recipient, amount: 252_000 })
const states: Record<TransferDecision['state'], [string, string]> = {
  READY: ['Можно подтвердить перевод', 'Проверка завершена. Для выполнения операции нужно подтвердить её.'],
  REVIEW: ['Перевод на проверке', 'Деньги не списаны. Если кто-то торопит вас с переводом, прервите разговор и свяжитесь с банком через официальный канал.'],
  COMPLETED: ['Перевод выполнен в симуляторе', 'Подтверждение записано в журнале.'],
  CANCELLED: ['Перевод отменён', 'Деньги не списаны.'],
}

export function TransferPage({ snapshot, onChange, initial }: { snapshot: Snapshot; onChange: () => void; initial?: string }) {
  const [request, setRequest] = useState(() => makeTransferExample())
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const [decision, setDecision] = useState<TransferDecision>()
  const [busy, setBusy] = useState(Boolean(initial))
  const [help, setHelp] = useState(false)
  const [error, setError] = useState('')
  const state = decision?.state

  useEffect(() => {
    if (!initial) return
    const controller = new AbortController()
    void api<TransferDecision>(`/transfer-checks/${encodeURIComponent(initial)}`, { signal: controller.signal })
      .then(setDecision)
      .catch((cause: Error) => { if (!controller.signal.aborted) setError(cause.message) })
      .finally(() => { if (!controller.signal.aborted) setBusy(false) })
    return () => controller.abort()
  }, [initial])

  function change(updated: TransferRequest) {
    setRequest(updated)
    setRequestId(crypto.randomUUID())
    setDecision(undefined)
    setHelp(false)
    setError('')
  }

  async function check(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      setDecision(await api<TransferDecision>('/transfer-checks', {
        method: 'POST', body: JSON.stringify({ scenario: snapshot.scenario, requestId, ...request }),
      }))
      onChange()
    } catch (cause) { setError((cause as Error).message) }
    finally { setBusy(false) }
  }

  async function resolve(answer: 'confirm' | 'cancel' | 'help') {
    if (!decision) return
    setBusy(true)
    setError('')
    try {
      setDecision(await api<TransferDecision>(`/transfer-checks/${decision.id}/resolutions`, {
        method: 'POST', body: JSON.stringify({ answer }),
      }))
      setHelp(answer === 'help')
      onChange()
    } catch (cause) { setError((cause as Error).message) }
    finally { setBusy(false) }
  }

  return <div className="graph-grid transfer-grid">
    <section className="panel transfer-client">
      <PanelTitle title="Мобильный банк" detail="Симулятор · синтетические счета" aside={<Smartphone size={20} className="muted" />} />
      <div className="transfer-presets" role="group" aria-label="Два перевода на одинаковую сумму">
        {transferExamples.filter(({ recipient }) => snapshot.accounts.some(({ id }) => id === recipient)).map(({ label, recipient }) => <button className="button secondary" key={recipient} disabled={busy}
          aria-pressed={(decision?.request.recipient ?? request.recipient) === recipient} onClick={() => change(makeTransferExample(recipient))}>{label}</button>)}
      </div>
      <div className="atm-screen">
        {decision && state ? <div className="transfer-result" aria-live="polite">
          <div className="transfer-amount">{money(decision.request.amount)}</div>
          <p className="muted mono">{decision.request.sender} → {decision.request.recipient}</p>
          <h3>{state === 'REVIEW' ? <CirclePause size={23} /> : <Check size={23} />}{states[state][0]}</h3>
          <p>{states[state][1]}</p>
          {help && <p>В реальной ситуации воспользуйтесь разделом поддержки в приложении банка. Запрос помощи записан в журнале симулятора.</p>}
          <div className="action-row">
            {state === 'READY' && <button className="button primary" disabled={busy} onClick={() => void resolve('confirm')}>Подтвердить перевод</button>}
            {state === 'REVIEW' && <button className="button primary" disabled={busy} onClick={() => void resolve('help')}>Отменить и обратиться в банк</button>}
            {(state === 'READY' || state === 'REVIEW') && <button className="button secondary" disabled={busy} onClick={() => void resolve('cancel')}>Отменить</button>}
            {(state === 'COMPLETED' || state === 'CANCELLED') && <button className="button secondary" disabled={busy} onClick={() => change(makeTransferExample())}><RotateCcw size={15} />Новый перевод</button>}
          </div>
        </div> : <form onSubmit={(event) => void check(event)}>
          <label>Отправитель<select value={request.sender} disabled={busy} onChange={(event) => change({ ...request, sender: event.target.value })}>
            {snapshot.accounts.map(({ id }) => <option key={id}>{id}</option>)}
          </select></label>
          <label>Получатель<select value={request.recipient} disabled={busy} onChange={(event) => change({ ...request, recipient: event.target.value })}>
            {snapshot.accounts.map(({ id }) => <option key={id}>{id}</option>)}
          </select></label>
          <label>Сумма, ₸<input type="number" required min={100} max={5_000_000} disabled={busy} value={request.amount || ''}
            onChange={(event) => change({ ...request, amount: Number(event.target.value) })} /></label>
          <button className="button primary wide" type="submit" disabled={busy}><ShieldCheck size={17} />{busy ? 'Проверяем…' : 'Проверить до списания'}</button>
        </form>}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </section>
    <section className="panel transfer-analyst">
      <PanelTitle title="Что видит аналитик" detail="Причины оценки получателя" aside={<ShieldCheck size={20} className="muted" />} />
      {decision ? <>
        <RiskSummary risk={decision.risk} />
        {decision.caseId && <a className="button secondary" href={`#/cases/${encodeURIComponent(decision.caseId)}`}>Открыть дело<ArrowUpRight size={16} /></a>}
      </> : <Empty>Запустите проверку, чтобы увидеть основания решения QORNET.</Empty>}
    </section>
  </div>
}

export function TransferComparison({ visual = false }: { visual?: boolean }) {
  const [result, setResult] = useState<TransferBenchmark>()
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    void api<TransferBenchmark>('/transfer-benchmark', { signal: controller.signal }).then(setResult)
      .catch((cause: Error) => { if (!controller.signal.aborted) setError(cause.message) })
    return () => controller.abort()
  }, [attempt])
  const rows = result ? [
    ['Рискованные переводы на проверке', result.amountRule.tp, result.qornet.tp],
    ['Пропущенные рискованные переводы', result.amountRule.fn, result.qornet.fn],
    ['Обычные переводы на проверке', result.amountRule.fp, result.qornet.fp],
    ['Обычные переводы без сигнала', result.amountRule.tn, result.qornet.tn],
  ] as const : []
  return <section className="panel transfer-comparison">
    <PanelTitle title="Проверка по сумме и по графу" detail={result ? `${num(result.total)} синтетических переводов · ${result.seeds} варианта истории` : undefined}
      aside={<FlaskConical size={19} className="muted" />} />
    {result ? <>
      {visual && <div className="jury-bench-charts">
        {[
          { title: 'Найдено рискованных переводов', baseline: result.amountRule.tp, graph: result.qornet.tp, total: result.qornet.tp + result.qornet.fn },
          { title: 'Ложные тревоги на обычных переводах', baseline: result.amountRule.fp, graph: result.qornet.fp, total: result.qornet.fp + result.qornet.tn },
        ].map(({ title, baseline, graph, total }) => <article key={title} className="jury-bench-card">
          <h3>{title}</h3><p><strong>{graph}</strong> из {total}</p>
          {[['По сумме', baseline], ['QORNET', graph]].map(([label, count]) => <div key={label} className="jury-bench-row">
            <span>{label}</span><b className="mono">{count}</b><i aria-hidden="true"><b style={{ width: `${100 * Number(count) / Math.max(total, 1)}%` }} /></i>
          </div>)}
        </article>)}
      </div>}
      <div className="table-scroll"><table><thead><tr><th>Исход проверки</th><th>Сумма ≥ {money(result.amountThreshold)}</th><th>QORNET ≥ {result.graphThreshold} баллов</th></tr></thead>
        <tbody>{rows.map(([name, baseline, graph]) => <tr key={name}><td>{name}</td><td className="mono">{baseline}</td><td className="mono">{graph}</td></tr>)}</tbody>
      </table></div>
      <p className="panel-note">Оба правила проверяют одни и те же новые заявки. В наборе есть крупные обычные переводы, небольшие рискованные переводы и рискованные получатели без видимых связей.</p>
      <p className="panel-note">P95 оценки по уже построенному графу: {result.scoringP95Ms.toLocaleString('ru-RU')} мс. Построение графа и сетевой запрос в это время не входят.</p>
      <button className="button secondary" onClick={() => { setResult(undefined); setAttempt(attempt + 1) }}><RotateCcw size={15} />Пересчитать</button>
    </> : error ? <div className="error" role="alert">{error}<button className="button secondary" onClick={() => { setError(''); setAttempt(attempt + 1) }}>Повторить</button></div> :
      <Empty>Считаем результаты для обоих правил…</Empty>}
    {!visual && <a className="button text" href="#/transfer">Проверить перевод<ArrowRight size={15} /></a>}
  </section>
}
