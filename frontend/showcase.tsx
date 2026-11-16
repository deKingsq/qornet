import { ArrowLeft, ArrowRight, ArrowUpRight, Maximize2, Minimize2, RotateCcw, Shield } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Snapshot, TransactionView } from '../shared/domain.ts'
import { AtmPage } from './atm.tsx'
import { NetworkPage } from './network.tsx'
import { TracePage } from './trace.tsx'
import { api, sitePath } from './lib.ts'
import { JuryTransfer } from './jury-transfer.tsx'
import { TransferComparison } from './transfers.tsx'
import './showcase.css'

const steps = [
  { label: 'Проверка перевода', title: 'Одна сумма. Два получателя.', detail: 'QORNET сверяет связи получателя до списания. Сравните решения для двух переводов с одинаковой суммой.', scenario: 'trace' },
  { label: 'Общий Wi-Fi', title: 'Общий Wi-Fi даёт 0 баллов', detail: 'Несколько клиентов подключились к одной сети. Выберите точку доступа и посмотрите, сколько счетов её использовало.', scenario: 'normal' },
  { label: 'Сеть дроп-карт', title: 'Как связаны дроп-карты', detail: 'Переключите слои графа, чтобы увидеть общие устройства и переводы. Выберите узел, чтобы проверить его связи.', scenario: 'farm' },
  { label: 'Маршрут денег', title: 'Деньги проходят через несколько счетов', detail: 'Запустите маршрут, чтобы увидеть суммы, время и последний счёт. Это история из сценария без ранней остановки.', scenario: 'trace' },
  { label: 'Снятие наличных', title: 'Проверка до выдачи денег', detail: 'Последний счёт из маршрута запрашивает снятие. Проверьте операцию и откройте причины решения.', scenario: 'trace' },
  { label: 'Результаты теста', title: 'Как проверяли QORNET', detail: 'Одна и та же выборка для правила по сумме и проверки по графу. Сравните обнаружения, пропуски и ложные тревоги.', scenario: null },
] as const

export function Showcase({ inspect, onChange }: { inspect: (item: TransactionView) => void; onChange: () => void }) {
  const [index, setIndex] = useState(0)
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{ snapshot: Snapshot } | { error: string }>()
  const [full, setFull] = useState(Boolean(document.fullscreenElement))
  const [screenError, setScreenError] = useState('')
  const heading = useRef<HTMLHeadingElement>(null)
  const focusStep = useRef(false)
  const step = steps[index]
  const snapshot = result && 'snapshot' in result && result.snapshot.scenario === step.scenario ? result.snapshot : undefined
  const error = result && 'error' in result ? result.error : undefined
  const go = useCallback((to: number) => {
    if (!steps[to] || index === to) return
    if (steps[to].scenario !== step.scenario) setResult(undefined)
    focusStep.current = true
    setIndex(to)
  }, [index, step.scenario])

  useEffect(() => {
    if (!focusStep.current) return
    heading.current?.focus({ preventScroll: true })
    window.scrollTo(0, 0)
    focusStep.current = false
  }, [index])

  useEffect(() => {
    if (!step.scenario) return
    const controller = new AbortController()
    void api<Snapshot>(`/scenarios/${step.scenario}/snapshot`, { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) setResult({ snapshot: data }) })
      .catch(() => { if (!controller.signal.aborted) setResult({ error: 'Не удалось загрузить данные сценария.' }) })
    return () => controller.abort()
  }, [step.scenario, attempt])

  useEffect(() => {
    const update = () => setFull(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', update)
    return () => document.removeEventListener('fullscreenchange', update)
  }, [])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
        document.querySelector('dialog[open]') ||
        (event.target instanceof HTMLElement && event.target.closest('input, select, textarea, canvas, [contenteditable]'))) return
      const offset = event.key === 'ArrowRight' || event.key === 'PageDown' ? 1 :
        event.key === 'ArrowLeft' || event.key === 'PageUp' ? -1 : 0
      if (!offset || !steps[index + offset]) return
      event.preventDefault()
      go(index + offset)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, index])

  async function toggleFull() {
    setScreenError('')
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await document.documentElement.requestFullscreen()
    } catch {
      setScreenError('В этой вкладке полноэкранный режим недоступен. Можно продолжить показ в окне.')
    }
  }

  return <div className="jury">
    <a className="jury-skip" href="#jury-heading" onClick={(event) => { event.preventDefault(); heading.current?.focus() }}>К текущему сценарию</a>
    <header className="jury-header">
      <div className="jury-container jury-bar">
        <a href={sitePath()} className="jury-brand" aria-label="QORNET, сайт проекта"><Shield size={23} />QORNET<span>.</span></a>
        <span className="jury-event">ДЕМО ДЛЯ ЖЮРИ</span>
        <div className="jury-actions">
          <a href={sitePath()} className="jury-console"><span>О проекте</span><ArrowUpRight size={17} /></a>
          <button className="jury-icon" type="button" onClick={() => void toggleFull()} title={full ? 'Выйти из полного экрана' : 'Полный экран'}
            aria-label={full ? 'Выйти из полного экрана' : 'Полный экран'}>
            {full ? <Minimize2 size={19} /> : <Maximize2 size={19} />}
          </button>
        </div>
      </div>
    </header>
    <main className="jury-container jury-layout">
      <nav className="jury-nav" aria-label="Шаги показа">
        <p>Показ для жюри</p>
        <ol>{steps.map(({ label }, i) => <li key={label}><button onClick={() => go(i)} aria-current={index === i ? 'step' : undefined}>
          <span className="mono">{String(i + 1).padStart(2, '0')}</span><strong>{label}</strong>{i === index && <ArrowRight size={15} />}
        </button></li>)}</ol>
      </nav>
      <div className="jury-workspace">
        <div className="jury-heading" key={`heading-${index}`}>
          <p className="jury-kicker"><span />СИНТЕТИЧЕСКИЕ ДАННЫЕ</p>
          <h1 ref={heading} id="jury-heading" tabIndex={-1}>{step.title}</h1>
          <p>{step.detail}</p>
        </div>
        {screenError && <p className="jury-message" role="alert">{screenError}</p>}
        <div className="jury-demo" key={`demo-${index}`}>
          {error && <div className="jury-message" role="alert">{error}<button className="button secondary" onClick={() => { setResult(undefined); setAttempt(attempt + 1) }}>Повторить</button></div>}
          {step.scenario && !snapshot && !error && <div className="jury-loading" role="status"><span />Загружаем сценарий…</div>}
          {snapshot && <>
            {index === 0 && <JuryTransfer snapshot={snapshot} onChange={onChange} />}
            {(index === 1 || index === 2) && <NetworkPage snapshot={snapshot} compact guided />}
            {index === 3 && <TracePage snapshot={snapshot} inspect={inspect} compact />}
            {index === 4 && <AtmPage snapshot={snapshot} onChange={onChange} compact />}
          </>}
          {index === 5 && <TransferComparison visual />}
        </div>
        <footer className="jury-footer">
          <button className="button secondary" disabled={index === 0} onClick={() => go(index - 1)}><ArrowLeft size={17} />Назад</button>
          <span className="mono" aria-live="polite">{String(index + 1).padStart(2, '0')} / {String(steps.length).padStart(2, '0')}</span>
          {index < steps.length - 1
            ? <button className="button secondary jury-next" onClick={() => go(index + 1)}>Далее<ArrowRight size={17} /></button>
            : <button className="button secondary jury-next" onClick={() => go(0)}>С начала<RotateCcw size={16} /></button>}
        </footer>
      </div>
    </main>
  </div>
}
