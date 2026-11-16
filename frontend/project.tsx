import { ArrowDown, ArrowDownRight, ArrowRight, ArrowUpRight, Banknote, Fingerprint, GitBranch, Shield, Smartphone } from 'lucide-react'
import { lazy, StrictMode, Suspense, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { api, money, sitePath } from './lib.ts'
import type { TransferBenchmark } from '../shared/domain.ts'
import '@fontsource-variable/inter'
import '@fontsource/ibm-plex-mono/500.css'
import './project.css'

const VaultScene = lazy(() => import('./vault-scene.tsx'))

const stages = [
  { label: 'До списания', title: 'Проверяем получателя до перевода', text: 'Покупатель подтверждает перевод, думая, что платит продавцу. QORNET проверяет, связан ли счёт получателя с известной сетью дроп-карт. При достаточном риске операция уходит на проверку до списания.', icon: Smartphone },
  { label: 'Граф связей', title: 'Связываем независимые признаки', text: 'Несколько человек могут пользоваться одним Wi-Fi. Риск растёт, когда общие устройства подтверждаются движением денег и близкими по времени событиями.', icon: Fingerprint },
  { label: 'До выдачи', title: 'Проверяем снятие по той же истории', text: 'Если деньги уже прошли по цепочке счетов, QORNET сопоставляет маршрут, профиль клиента и запрос в банкомате. Решение принимается до выдачи наличных.', icon: Banknote },
]

function Evidence() {
  const [state, setState] = useState<{ result?: TransferBenchmark; failed?: boolean }>({})
  const [attempt, retry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    void api<TransferBenchmark>('/transfer-benchmark', { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setState({ result }) })
      .catch(() => { if (!controller.signal.aborted) setState({ failed: true }) })
    return () => controller.abort()
  }, [attempt])
  const result = state.result
  const rows = result ? [
    { label: 'Найдено рискованных переводов', before: result.amountRule.tp, after: result.qornet.tp, total: result.qornet.tp + result.qornet.fn },
    { label: 'Ложные тревоги на обычных переводах', before: result.amountRule.fp, after: result.qornet.fp, total: result.qornet.fp + result.qornet.tn },
  ] : []
  return <section className="site-section site-evidence" id="results" aria-labelledby="results-title">
    <div className="site-section-head"><p className="site-label">Проверка гипотезы</p><h2 id="results-title">Что показал тест</h2>
      <p>{result ? `Одинаковые ${result.total} синтетических заявок. Сравнили проверку получателя с правилом «от ${money(result.amountThreshold)}».` : 'Сравниваем два правила на одной синтетической выборке.'}</p></div>
    <div className="site-results">
      {result ? rows.map(({ label, before, after, total }) => <div className="site-result" key={label}>
        <h3>{label}</h3><p><span>{before}</span><ArrowRight size={23} /><strong>{after}</strong><small>из {total}</small></p>
        <div className="site-result-track" aria-hidden="true"><i style={{ width: `${100 * after / Math.max(total, 1)}%` }} /></div>
      </div>) : state.failed ? <div className="site-result" role="alert"><p>Сейчас результаты недоступны.</p><button className="site-button secondary" onClick={() => { setState({}); retry(attempt + 1) }}>Повторить</button></div> :
        <p className="site-result" role="status">Загружаем результаты теста…</p>}
      {result && <small className="site-result-note">QORNET пропустил {result.qornet.fn} рискованных переводов. Качество на банковских данных предстоит измерить отдельно.</small>}
    </div>
  </section>
}

function Project() {
  return <>
    <a className="site-skip" href="#main">К содержанию</a>
    <header className="site-header"><div className="site-wrap site-bar">
      <a className="site-brand" href={sitePath()} aria-label="QORNET"><Shield size={23} />QORNET<span>.</span></a>
      <nav aria-label="О проекте"><a href="#method">Как работает</a><a href="#results">Результаты</a><a href={import.meta.env.MODE === 'pages' ? sitePath('presentation.html') : 'https://dekingsq.github.io/qornet-presentation/'}>Презентация</a></nav>
      <a className="site-header-demo" href={sitePath('demo/')}>Демо для жюри<ArrowUpRight size={17} /></a>
    </div></header>
    <main id="main">
      <section className="site-hero site-wrap" aria-labelledby="hero-title">
        <div className="site-hero-copy">
          <p className="site-label"><span />V ӨҢІРЛІК ITU HACKATHON · 2026</p>
          <h1 id="hero-title">Увидеть связи<br />до списания<span>.</span></h1>
          <p className="site-lead">QORNET помогает банку проверить, связан ли получатель с сетью дроп-карт, пока деньги ещё можно остановить.</p>
          <a href={sitePath('demo/')} className="site-button"><span>Открыть интерактивное демо</span><ArrowRight size={20} /></a>
        </div>
        <div className="site-hero-art" aria-hidden="true">
          <div className="site-vault-fallback"><i /><i /><i /></div>
          <Suspense fallback={null}><VaultScene /></Suspense>
          <span className="site-art-coordinates">СЧЕТА <i /> УСТРОЙСТВА <i /> ПЕРЕВОДЫ</span>
        </div>
        <a href="#method" className="site-scroll" aria-label="Перейти к принципу работы"><ArrowDown size={18} /></a>
      </section>
      <div className="site-wrap">
        <section className="site-section site-method" id="method" aria-labelledby="method-title">
          <div className="site-section-head"><p className="site-label">Принцип работы</p><h2 id="method-title">От перевода до банкомата</h2>
            <p>Дроп-карты — счета, через которые могут проводить деньги, полученные обманом. QORNET ищет связи между такими счетами.</p></div>
          <ol className="site-method-rows">
            {stages.map(({ label, title, text, icon: Icon }, i) => <li key={label}>
              <div className="site-method-icon"><Icon size={24} strokeWidth={1.55} /></div>
              <div><p className="site-label">{label}</p><h3>{title}</h3><p>{text}</p></div>
              {i < stages.length - 1 && <ArrowDownRight size={19} className="site-method-arrow" />}
            </li>)}
          </ol>
        </section>
        <Evidence />
        <section className="site-cta" aria-labelledby="site-cta-title">
          <GitBranch size={34} strokeWidth={1.55} />
          <div><h2 id="site-cta-title">Одна сумма. Два получателя.</h2><p>Запустите проверку и посмотрите, почему QORNET принимает разные решения.</p></div>
          <a className="site-button" href={sitePath('demo/')}>Начать показ<ArrowRight size={18} /></a>
        </section>
      </div>
    </main>
    <footer className="site-wrap site-footer"><span>QORNET · Хакатонный прототип</span><a href={sitePath('app/')}>Кабинет аналитика<ArrowUpRight size={15} /></a></footer>
  </>
}

const legacyRoute = location.hash.startsWith('#/')
if (legacyRoute) location.replace(sitePath(location.hash === '#/showcase' ? 'demo/' : 'app/') + location.hash)
else createRoot(document.getElementById('root')!).render(<StrictMode><Project /></StrictMode>)
