import { ArrowRight, ClipboardCheck, FileClock, FlaskConical, Search, Shield, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { scenarios } from '../shared/domain.ts'
import type { Audit, Case, CaseStatus, Evaluation, Snapshot } from '../shared/domain.ts'
import { Empty, PanelTitle, RiskBadge, RiskSummary } from './components.tsx'
import { api, num, percent, statusName, time } from './lib.ts'
import { TransferComparison } from './transfers.tsx'

const actionName: Record<string, string> = {
  SCENARIO_RUN: 'Выполнен сценарий', CASE_OPENED: 'Создано дело', CASE_REVIEWED: 'Решение аналитика',
  ATM_DECISION: 'Решение банкомата', CUSTOMER_ASSISTANCE: 'Запрошена помощь', CHALLENGE_VERIFIED: 'Подтверждение клиента',
  ATM_CANCELLED: 'Отмена снятия', DEAL_ASSESSED: 'Проверена P2P-сделка',
  ATM_OFFICER_RELEASED: 'Сотрудник разрешил снятие', ATM_OFFICER_DECLINED: 'Сотрудник отменил снятие',
  TRANSFER_CHECKED: 'Проверка перевода до списания', TRANSFER_COMPLETED: 'Перевод подтверждён в симуляторе',
  TRANSFER_CANCELLED: 'Перевод отменён', TRANSFER_HELP: 'Перевод отменён, запрошена помощь',
  TRANSFER_RELEASED: 'Аналитик разрешил подтверждение', TRANSFER_DECLINED: 'Аналитик отклонил перевод',
}

export function CasesPage({ cases, initial, onChange }: { cases: Case[]; initial?: string; onChange: () => void }) {
  const [selected, setSelected] = useState(initial ?? cases[0]?.id ?? '')
  const [note, setNote] = useState('')
  const [filter, setFilter] = useState('all')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [audit, setAudit] = useState<Audit[]>([])
  const active = cases.find(({ id }) => id === selected) ?? cases[0]
  const visible = cases.filter(({ status }) => filter === 'all' || status === filter)

  useEffect(() => {
    let live = true
    api<Audit[]>('/audit').then((items) => { if (live) setAudit(items) }).catch((cause: Error) => { if (live) setError(cause.message) })
    return () => { live = false }
  }, [cases])

  async function review(status: Exclude<CaseStatus, 'OPEN'>) {
    if (!active) return
    setBusy(true)
    setError('')
    try {
      await api<Case>(`/cases/${encodeURIComponent(active.id)}`, { method: 'PATCH', body: JSON.stringify({ status, note }) })
      setNote('')
      onChange()
    } catch (cause) { setError((cause as Error).message) }
    finally { setBusy(false) }
  }

  return <>
    <div className="graph-grid cases-grid">
      <section className="panel">
        <PanelTitle title="Очередь дел" detail={`${visible.length} в текущем фильтре`} aside={<select value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Статус дела">
          <option value="all">Все статусы</option>{Object.entries(statusName).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
        </select>} />
        {visible.length ? <ul className="case-list">{visible.map((entry) => <li key={entry.id}>
          <button className={entry.id === active?.id ? 'active' : ''} onClick={() => { setSelected(entry.id); setNote(''); setError('') }}>
            <span className="case-icon"><FileClock size={18} /></span><span><strong>{entry.title}</strong><small>{scenarios.find(({ id }) => id === entry.scenario)?.title} · {statusName[entry.status]}</small></span>
            <RiskBadge level={entry.risk.level} /><ArrowRight size={15} className="case-arrow" />
          </button>
        </li>)}</ul> : <Empty>Нет дел по выбранному статусу.</Empty>}
      </section>
      <section className="panel">
        <PanelTitle title={active?.title ?? 'Карточка дела'} detail={active ? statusName[active.status] : undefined} aside={<ClipboardCheck size={19} className="muted" />} />
        {active ? <>
          <RiskSummary risk={active.risk} />
          <div className="chips">{active.risk.accounts.slice(0, 12).map((id) => <span className="chip" key={id}>{id}</span>)}</div>
          {active.channel === 'atm' && <p className="panel-note">
            <a className="button secondary" href={`#/atm/${encodeURIComponent(active.id.split(':')[1])}`}>Посмотреть операцию ATM<ArrowRight size={14} /></a>
          </p>}
          {active.channel === 'transfer' && <p className="panel-note">
            <a className="button secondary" href={`#/transfer/${encodeURIComponent(active.id.split(':')[1])}`}>Посмотреть заявку на перевод<ArrowRight size={14} /></a>
          </p>}
          {(active.status === 'OPEN' || active.status === 'INVESTIGATING') && <div className="case-review">
            {active.channel === 'atm' && <p className="panel-note">Подтверждение риска отменяет снятие. Закрытие сигнала снимает ограничение в симуляторе.</p>}
            {active.channel === 'transfer' && <p className="panel-note">Подтверждение риска отменяет заявку. Закрытие сигнала позволяет клиенту отдельно подтвердить перевод.</p>}
            <label>Обоснование решения<textarea maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Укажите, какие факты вы проверили" /></label>
            <div className="action-row">
              {active.status === 'OPEN' && <button className="button secondary" disabled={busy || note.trim().length < 3} onClick={() => void review('INVESTIGATING')}><Search size={15} />В работу</button>}
              <button className="button primary" disabled={busy || note.trim().length < 3} onClick={() => void review('CONFIRMED')}>Подтвердить</button>
              <button className="button text" disabled={busy || note.trim().length < 3} onClick={() => void review('DISMISSED')}><XCircle size={15} />Закрыть</button>
            </div>
          </div>}
        </> : <Empty>Запустите сценарий с сигналами, чтобы создать дело.</Empty>}
        {error && <p className="error" role="alert">{error}</p>}
      </section>
    </div>
    <section className="panel operations-panel">
      <PanelTitle title="Журнал решений" detail="Последние события QORNET Core" />
      {audit.length ? <div className="table-scroll"><table><thead><tr><th>Время</th><th>Модуль</th><th>Действие</th><th>Объект</th><th>Комментарий</th></tr></thead>
        <tbody>{audit.slice(0, 18).map((item) => <tr key={item.id}><td className="mono muted">{time(item.at)}</td><td>{item.channel}</td>
          <td>{actionName[item.action] ?? item.action}</td><td className="mono">{item.reference}</td>
          <td>{(item.payload as { note?: string } | null)?.note ?? '—'}</td></tr>)}</tbody>
      </table></div> : <Empty>В журнале пока нет событий.</Empty>}
    </section>
  </>
}

export function EnginePage({ snapshot }: { snapshot: Snapshot }) {
  const [evaluation, setEvaluation] = useState<Evaluation>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function run() {
    setBusy(true)
    setError('')
    try { setEvaluation(await api<Evaluation>('/evaluation')) }
    catch (cause) { setError((cause as Error).message) }
    finally { setBusy(false) }
  }
  useEffect(() => { void run() }, [])
  const sample = snapshot.clusters[0]?.risk ?? snapshot.accounts[0].risk
  return <><TransferComparison /><div className="graph-grid engine-grid">
    <section className="panel">
      <PanelTitle title="Измерения на синтетике" detail="Проверка классификации счетов на размеченных данных" aside={<FlaskConical size={19} className="muted" />} />
      {evaluation ? <>
        <div className="evaluation-metrics">
          <div><strong>{percent(evaluation.precision)}</strong><span>Precision</span></div>
          <div><strong>{percent(evaluation.recall)}</strong><span>Recall</span></div>
          <div><strong>{percent(evaluation.falsePositiveRate)}</strong><span>Ложные тревоги</span></div>
        </div>
        <div className="table-scroll"><table className="confusion"><thead><tr><th>Решение</th><th>Размечен</th><th>Обычный</th></tr></thead><tbody>
          <tr><td>Высокий риск</td><td className="mono">{num(evaluation.tp)}</td><td className="mono">{num(evaluation.fp)}</td></tr>
          <tr><td>Ниже порога</td><td className="mono">{num(evaluation.fn)}</td><td className="mono">{num(evaluation.tn)}</td></tr>
        </tbody></table></div>
        <p className="panel-note">{evaluation.samples} наборов · {num(evaluation.accounts)} оценок · {evaluation.ms} мс в последнем прогоне. Результаты относятся только к этим синтетическим наборам.</p>
      </> : <Empty>{busy ? 'Проверяем синтетические наборы…' : 'Запустите проверку движка.'}</Empty>}
      <button className="button secondary" disabled={busy} onClick={() => void run()}><FlaskConical size={15} />{busy ? 'Проверка…' : 'Повторить измерение'}</button>
      {error && <p className="error" role="alert">{error}</p>}
    </section>
    <section className="panel">
      <PanelTitle title="Как принято решение" detail={snapshot.clusters[0]?.id ?? snapshot.accounts[0].id} aside={<Shield size={19} className="muted" />} />
      <RiskSummary risk={sample} />
      <div className="policy-grid"><span>0–24<small>SAFE</small></span><span>25–59<small>REVIEW</small></span><span>60–89<small>HIGH RISK</small></span><span>90–100<small>CRITICAL</small></span></div>
      <p className="panel-note">Балл складывается из подтверждённых сигналов. Общий IP и VPN дают 0 баллов. Временная приостановка доступна в симуляторе банкомата при дополнительных условиях.</p>
    </section>
  </div></>
}
