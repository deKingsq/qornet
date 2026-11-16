import { ArrowRight, CircleDot, GitBranch, Pause, Play, RotateCcw, Timer } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Snapshot, TransactionView } from '../shared/domain.ts'
import { Empty, PanelTitle, RiskBadge, RiskSummary, Transactions } from './components.tsx'
import { money, time } from './lib.ts'

export function TracePage({ snapshot, inspect, compact = false }: { snapshot: Snapshot; inspect: (item: TransactionView) => void; compact?: boolean }) {
  const [id, setId] = useState(snapshot.chains[0]?.id ?? '')
  const [frame, setFrame] = useState(-1)
  const [playing, setPlaying] = useState(false)
  const [filter, setFilter] = useState<'all' | 'risk'>('risk')
  const [query, setQuery] = useState('')
  const [shown, setShown] = useState(12)
  const chain = snapshot.chains.find((item) => item.id === id)
  const matched = snapshot.transactions.filter(({ from, to, id: txId, risk }) => {
    const text = `${txId} ${from} ${to}`.toLowerCase()
    return (filter === 'all' || risk.level !== 'SAFE') && text.includes(query.toLowerCase().trim())
  })

  useEffect(() => {
    if (!playing || !chain) return
    const timer = window.setTimeout(() => {
      if (frame >= chain.transactions.length - 1) setPlaying(false)
      else setFrame((value) => value + 1)
    }, 820)
    return () => window.clearTimeout(timer)
  }, [playing, chain, frame])

  const changeChain = (value: string) => { setId(value); setFrame(-1); setPlaying(false) }
  function togglePlay() {
    if (!chain) return
    if (!playing && (frame < 0 || frame === chain.transactions.length - 1)) setFrame(0)
    setPlaying(!playing)
  }

  return <>
    <div className="graph-grid trace-grid">
      <section className="panel trace-panel">
        <PanelTitle title="Маршрут средств" detail="Направление, суммы и время каждого перевода" aside={<GitBranch size={18} className="muted" />} />
        {chain ? <>
          <div className="trace-options">
            <label>Цепочка<select value={id} onChange={(event) => changeChain(event.target.value)}>
              {snapshot.chains.map((item) => <option key={item.id} value={item.id}>
                {item.cycle ? 'Цикл' : 'Маршрут'} · {item.accounts[0]} → {item.endpoint} · {money(item.transactions[0].amount)}
              </option>)}
            </select></label>
            <button className="button primary" onClick={togglePlay}>{playing ? <Pause size={16} /> : <Play size={16} />}{playing ? 'Пауза' : 'Воспроизвести'}</button>
            <button className="icon-btn" aria-label="Сбросить анимацию" onClick={() => { setFrame(-1); setPlaying(false) }}><RotateCcw size={16} /></button>
          </div>
          <div className="trace-map" aria-label="Последовательность переводов">
            {chain.transactions.map((item, index) => <div key={item.id} className={`trace-step ${frame === index ? 'active' : ''} ${frame > index ? 'complete' : ''}`}>
              <div className="step-account"><CircleDot size={15} /><strong>{item.from}</strong></div>
              <span className="flow-track"><i /><ArrowRight size={16} /></span>
              <button className="trace-tx mono" onClick={() => { const tx = snapshot.transactions.find((row) => row.id === item.id); if (tx) inspect(tx) }}>{money(item.amount)}</button>
              <small className="mono">{time(item.at)}</small>
            </div>)}
            <div className="trace-step endpoint"><div className="step-account"><CircleDot size={15} /><strong>{chain.endpoint}</strong></div><small>{chain.cycle ? 'Возврат' : 'Последний счёт'}</small></div>
          </div>
          <div className="trace-facts">
            <span><Timer size={16} /><strong>{chain.minutes} мин</strong> между первым и последним</span>
            <span><GitBranch size={16} /><strong>{chain.retained}%</strong> отношение сумм</span>
          </div>
        </> : <Empty>Быстрых сопоставимых цепочек нет. Запустите сценарий «Цепочка переводов», чтобы проверить алгоритм.</Empty>}
      </section>
      <section className="panel">
        <PanelTitle title="Сигналы цепочки" detail="Факторы, из которых складывается балл" />
        {chain ? <><RiskSummary risk={chain.risk} /><p className="panel-note">Маршрут связывает сопоставимые по времени и сумме операции. Это основание проверить поток средств.</p></> :
          <Empty>Нет цепочки для анализа.</Empty>}
      </section>
    </div>
    {!compact && <section className="panel operations-panel">
      <PanelTitle title="Реестр переводов" detail={`${matched.length} по текущему фильтру`} aside={<div className="table-filters">
        <input aria-label="Поиск по счёту или операции" value={query} placeholder="Счёт или операция" onChange={(event) => { setQuery(event.target.value); setShown(12) }} />
        <select aria-label="Фильтр риска" value={filter} onChange={(event) => { setFilter(event.target.value as typeof filter); setShown(12) }}><option value="risk">С сигналами</option><option value="all">Все операции</option></select>
      </div>} />
      <Transactions items={matched.slice(0, shown)} onInspect={inspect} />
      {matched.length > shown && <button className="button secondary more" onClick={() => setShown(shown + 12)}>Показать ещё</button>}
      {chain && <div className="table-footer"><RiskBadge level={chain.risk.level} /><span>{chain.cycle ? 'В выбранной цепочке обнаружен цикл.' : `Последняя наблюдаемая точка — ${chain.endpoint}.`}</span></div>}
    </section>}
  </>
}
