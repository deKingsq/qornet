import { Activity, ArrowLeftRight, ArrowUpRight, Banknote, ChevronDown, ChevronRight, CirclePlay, ClipboardList, Cpu, Handshake, LayoutDashboard, Network, Shield, X } from 'lucide-react'
import { lazy, StrictMode, Suspense, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { scenarios } from '../shared/domain.ts'
import type { Case, ScenarioId, Snapshot, TransactionView } from '../shared/domain.ts'
import { AtmPage } from './atm.tsx'
import { RiskSummary } from './components.tsx'
import { CasesPage, EnginePage } from './investigations.tsx'
import { api, money, time, sitePath } from './lib.ts'
import { DemoPage, TrianglePage } from './scenarios.tsx'
import { TracePage } from './trace.tsx'
import { TransferPage } from './transfers.tsx'
import '@fontsource-variable/inter'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import './style.css'
import './redesign.css'

const NetworkPage = lazy(() => import('./network.tsx').then((module) => ({ default: module.NetworkPage })))
const Overview = lazy(() => import('./overview.tsx').then((module) => ({ default: module.Overview })))
const Showcase = lazy(() => import('./showcase.tsx').then((module) => ({ default: module.Showcase })))

const pages = {
  overview: { title: 'Обзор безопасности', nav: 'Обзор', description: 'Состояние переводов, подозрительные связи и приоритеты расследований.', icon: LayoutDashboard },
  transfer: { title: 'Проверка до списания', nav: 'Проверка перевода', description: 'Сравните два перевода на одинаковую сумму и посмотрите, как история получателя влияет на решение.', icon: ArrowLeftRight },
  network: { title: 'Сетевой анализ', nav: 'Сетевой анализ', description: 'Подтверждённые связи между счетами, устройствами и денежными потоками.', icon: Network },
  trace: { title: 'Трассировка переводов', nav: 'Трассировка', description: 'Хронология быстрых маршрутов, циклических переводов и концентрации средств.', icon: ArrowLeftRight },
  atm: { title: 'Защита банкоматов', nav: 'Защита банкоматов', description: 'Проверьте контекст снятия до выдачи наличных в симуляторе QORNET.', icon: Banknote },
  cases: { title: 'Центр расследований', nav: 'Расследования', description: 'Проверяйте доказательства и фиксируйте решения в журнале.', icon: ClipboardList },
  engine: { title: 'Движок риска', nav: 'Движок риска', description: 'Объяснение баллов, пороги реагирования и измерения на синтетических данных.', icon: Cpu },
  demo: { title: 'Демо-сценарии', nav: 'Демо-сценарии', description: 'Запустите сценарий, чтобы движок пересчитал риск на новом наборе событий.', icon: CirclePlay },
  triangle: { title: 'Проверка P2P-сделок', nav: 'P2P-сделки', description: 'Сопоставление покупателя, плательщика, продавца и получателя товара.', icon: Handshake },
  showcase: { title: 'Показ для жюри', nav: 'Показ для жюри', description: '', icon: CirclePlay },
} as const
type Page = keyof typeof pages
const monitoring: Page[] = ['overview', 'transfer', 'network', 'trace', 'atm']
const controls: Page[] = ['cases', 'engine', 'triangle', 'demo']

function getRoute() {
  const [id, item] = location.hash.replace(/^#\/?/, '').split('/')
  const page = Object.hasOwn(pages, id) ? id as Page : location.pathname.startsWith(sitePath('demo/')) ? 'showcase' : 'overview'
  let detail: string | undefined
  try { detail = item ? decodeURIComponent(item) : undefined } catch { detail = undefined }
  return { page, detail }
}
const go = (page: string) => { location.hash = `/${page}` }

function initialScenario(): ScenarioId {
  try {
    const saved = sessionStorage.getItem('qornet-scenario')
    return scenarios.find(({ id }) => id === saved)?.id ?? 'farm'
  } catch { return 'farm' }
}

function TxDialog({ item, close }: { item: TransactionView; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])
  return <dialog ref={ref} onCancel={close} aria-labelledby="tx-title" className="panel tx-dialog">
    <div className="panel-title"><div><h2 id="tx-title" className="mono">{item.id}</h2><p>{item.from} → {item.to} · {time(item.at)}</p></div>
      <button className="icon-btn" onClick={close} aria-label="Закрыть карточку"><X size={18} /></button></div>
    <div className="dialog-amount">{money(item.amount)}</div>
    {item.sessionId && <p className="muted mono">Сессия {item.sessionId}</p>}
    <RiskSummary risk={item.risk} />
  </dialog>
}

function App() {
  const [{ page, detail }, setRoute] = useState(getRoute)
  const [snapshot, setSnapshot] = useState<Snapshot>()
  const [cases, setCases] = useState<Case[]>([])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [tx, setTx] = useState<TransactionView>()
  const [generation, setGeneration] = useState(0)
  const [loadCounter, setLoadCounter] = useState(0)
  const config = pages[page]

  useEffect(() => {
    const route = () => {
      const next = getRoute()
      if (next.page !== 'showcase' && document.fullscreenElement) void document.exitFullscreen().catch(() => {})
      setRoute(next)
      setTx(undefined)
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', route)
    return () => window.removeEventListener('hashchange', route)
  }, [])
  useEffect(() => { document.title = `QORNET | ${config.title}` }, [config.title])
  const showing = page === 'showcase'
  useEffect(() => {
    if (showing) return
    const controller = new AbortController()
    const options = { signal: controller.signal }
    const report = (cause: Error) => { if (!controller.signal.aborted) setError(cause.message) }
    api<Snapshot>(`/scenarios/${initialScenario()}/snapshot`, options).then(setSnapshot).catch(report)
    api<Case[]>('/cases', options).then(setCases).catch(report)
    return () => controller.abort()
  }, [loadCounter, showing])

  function refreshCases() {
    void api<Case[]>('/cases').then(setCases).catch((cause: Error) => setError(cause.message))
  }

  async function run(id: ScenarioId, next?: string) {
    if (pending) return
    setPending(true)
    setError('')
    try {
      setSnapshot(await api<Snapshot>(`/scenarios/${id}/runs`, { method: 'POST' }))
      setGeneration((count) => count + 1)
      setTx(undefined)
      try { sessionStorage.setItem('qornet-scenario', id) } catch { /* storage may be unavailable */ }
      refreshCases()
      if (next) go(next)
    } catch (cause) { setError((cause as Error).message) }
    finally { setPending(false) }
  }

  const nav = (items: Page[]) => items.map((id) => {
    const Icon = pages[id].icon
    const open = cases.filter((item) => item.status === 'OPEN').length
    return <a key={id} href={`#/${id}`} aria-label={pages[id].nav} title={pages[id].nav} aria-current={page === id ? 'page' : undefined}>
      <Icon size={17} strokeWidth={1.75} /><span>{pages[id].nav}</span>{id === 'cases' && open > 0 && <small>{open}</small>}
    </a>
  })

  function render(data: Snapshot) {
    switch (page) {
      case 'overview': return <Overview snapshot={data} navigate={go} inspect={setTx} />
      case 'transfer': return <TransferPage snapshot={data} onChange={refreshCases} initial={detail} />
      case 'network': return <NetworkPage snapshot={data} />
      case 'trace': return <TracePage snapshot={data} inspect={setTx} />
      case 'atm': return <AtmPage snapshot={data} onChange={refreshCases} initial={detail} />
      case 'cases': return <CasesPage cases={cases} initial={detail} onChange={refreshCases} />
      case 'engine': return <EnginePage snapshot={data} />
      case 'demo': return <DemoPage current={data.scenario} pending={pending} run={(id, next) => void run(id, next)} />
      case 'triangle': return <TrianglePage snapshot={data} onChange={refreshCases} />
    }
  }

  if (page === 'showcase') return <>
    <Suspense fallback={<section className="panel loading" aria-live="polite"><span />Загружаем показ…</section>}>
      <Showcase inspect={setTx} onChange={refreshCases} />
    </Suspense>
    {tx && <TxDialog item={tx} close={() => setTx(undefined)} />}
  </>

  return <div className="shell">
    <a href="#main" className="skip" onClick={(event) => { event.preventDefault(); document.getElementById('main')?.focus() }}>К основному содержанию</a>
    <aside className="sidebar">
      <a href="#/overview" className="brand" aria-label="QORNET, обзор">
        <span className="brand-mark"><Shield size={25} strokeWidth={2.1} /><i /></span>
        <span><strong>QORNET<span>.</span></strong><small>АНТИФРОД-ПЛАТФОРМА</small></span>
      </a>
      <nav aria-label="Разделы QORNET">
        <div className="nav-group"><p>МОНИТОРИНГ</p>{nav(monitoring)}</div>
        <div className="nav-group"><p>РАССЛЕДОВАНИЯ</p>{nav(controls)}</div>
      </nav>
      <div className="sidebar-footer">
        <div className="workspace-tile"><span><Activity size={18} /></span><div><strong>Демо-контур</strong><small>Синтетические данные</small></div></div>
      </div>
    </aside>
    <div className="app-content">
      <header className="topbar">
        <div className="breadcrumbs"><span>QORNET</span><ChevronRight size={13} /><strong>{config.nav}</strong></div>
        <div className="top-actions"><span className={`system-status ${snapshot ? '' : 'waiting'}`}><i />{snapshot ? 'Ядро на связи' : 'Подключение'}</span>
          <a className="button top-demo" href={sitePath('demo/')}><CirclePlay size={16} />Показ для жюри<ArrowUpRight size={13} /></a></div>
      </header>
      <main className="main" id="main" tabIndex={-1}>
        <header className={`page-header ${page === 'overview' ? 'overview-header' : ''}`}>
          {page === 'overview' ? <div className="overview-title">Обзор безопасности</div> : <div><h1>{config.title}</h1><p>{config.description}</p></div>}
          {snapshot && <label className="scenario-picker">Активный сценарий
            <span className="select-wrap"><CirclePlay size={16} /><select disabled={pending} aria-label="Активный сценарий" value={snapshot.scenario} onChange={(event) => void run(event.target.value as ScenarioId)}>
              {scenarios.map(({ id, title }) => <option key={id} value={id}>{title}</option>)}
            </select><ChevronDown size={15} /></span>
          </label>}
        </header>
        {error && <div className="error" role="alert">{error}{!snapshot && <button className="button secondary" onClick={() => { setError(''); setLoadCounter((count) => count + 1) }}>Повторить</button>}</div>}
        {snapshot ? <div key={`${page}:${detail ?? ''}:${generation}`} className="page-content" aria-busy={pending}>
          <Suspense fallback={<section className="panel loading" aria-live="polite"><span /><p>Загружаем раздел…</p></section>}>{render(snapshot)}</Suspense>
        </div> :
          !error && <section className="panel loading" aria-live="polite"><span /><p>Загружаем данные QORNET…</p></section>}
        <footer className="main-footer"><span>QORNET</span><span>V Өңірлік ITU Hackathon 2026</span></footer>
      </main>
    </div>
    {tx && <TxDialog item={tx} close={() => setTx(undefined)} />}
  </div>
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
