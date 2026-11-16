import { Camera, CircleCheck, CreditCard, Hand, Headphones, LockKeyhole, ShieldAlert, ShieldCheck, Wallet, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { AtmDecision, Snapshot } from '../shared/domain.ts'
import { Empty, PanelTitle, RiskSummary } from './components.tsx'
import { api, atmName, money, sitePath } from './lib.ts'

function Vision({ kk }: { kk: boolean }) {
  const [active, setActive] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const stream = useRef<MediaStream | null>(null)
  const video = useRef<HTMLVideoElement>(null)
  const live = useRef(false)
  useEffect(() => {
    live.current = true
    return () => { live.current = false; stream.current?.getTracks().forEach((track) => track.stop()) }
  }, [])
  useEffect(() => {
    if (video.current && stream.current) video.current.srcObject = stream.current
  }, [active])

  async function toggle() {
    if (active) {
      stream.current?.getTracks().forEach((track) => track.stop())
      stream.current = null
      setActive(false)
      return
    }
    setLoading(true)
    setError(false)
    try {
      const media = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      if (live.current) { stream.current = media; setActive(true) }
      else media.getTracks().forEach((track) => track.stop())
    } catch {
      if (live.current) setError(true)
    } finally {
      if (live.current) setLoading(false)
    }
  }
  return <section className="panel vision-panel">
    <PanelTitle title="QORNET Vision" detail={kk ? 'Эксперименттік жергілікті камера көрінісі' : 'Экспериментальный предпросмотр камеры'} aside={<Camera size={19} className="muted" />} />
    <p className="muted">{kk ? 'Бейне осы бетте ғана көрсетіледі және тәуекел бағасына әсер етпейді.' : 'Видео отображается локально и не участвует в расчёте риска.'}</p>
    {active && <video ref={video} autoPlay muted playsInline aria-label={kk ? 'Камера көрінісі' : 'Предпросмотр камеры'} />}
    {error && <p className="error" role="alert">{kk ? 'Камера қолжетімсіз' : 'Камера недоступна или доступ отклонён'}</p>}
    <button className="button secondary" disabled={loading} onClick={() => void toggle()}>
      <Camera size={16} />{active ? (kk ? 'Камераны өшіру' : 'Выключить камеру') : (kk ? 'Камераға рұқсат беру' : 'Разрешить камеру')}
    </button>
  </section>
}

export function AtmPage({ snapshot, onChange, initial, compact = false }: { snapshot: Snapshot; onChange: () => void; initial?: string; compact?: boolean }) {
  const [request, setRequest] = useState(snapshot.cash)
  const [kk, setKk] = useState(false)
  const [decision, setDecision] = useState<AtmDecision>()
  const [assisted, setAssisted] = useState(false)
  const [verified, setVerified] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const t = (ru: string, kz: string) => kk ? kz : ru
  const state = decision?.state
  const pending = state === 'REVIEW' || state === 'HOLD' || state === 'CHALLENGE'

  useEffect(() => {
    if (!initial) return
    let active = true
    api<AtmDecision>(`/atm-decisions/${encodeURIComponent(initial)}`).then((entry) => {
      if (active) setDecision(entry)
    }).catch((cause: Error) => { if (active) setError(cause.message) })
    return () => { active = false }
  }, [initial])

  async function assess(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      setDecision(await api<AtmDecision>('/atm-decisions', { method: 'POST', body: JSON.stringify({ scenario: snapshot.scenario, ...request }) }))
      setVerified(false)
      setAssisted(false)
      onChange()
    } catch (cause) { setError((cause as Error).message) }
    finally { setBusy(false) }
  }

  async function resolve(answer: 'verified' | 'assistance' | 'cancel') {
    if (!decision) return
    setBusy(true)
    setError('')
    try {
      const updated = await api<AtmDecision>(`/atm-decisions/${decision.id}/resolutions`, { method: 'POST', body: JSON.stringify({ answer }) })
      setDecision(updated)
      setAssisted(answer === 'assistance')
      onChange()
    } catch (cause) { setError((cause as Error).message) }
    finally { setBusy(false) }
  }

  return <div lang={kk ? 'kk' : 'ru'}>
    <div className="graph-grid atm-grid">
      <section className="panel atm-panel">
        <PanelTitle title={t('Терминал QORNET', 'QORNET терминалы')} detail={t('Симулятор выдачи наличных', 'Қолма-қол ақша беру симуляторы')} aside={
          <div className="segmented" aria-label={t('Язык терминала', 'Терминал тілі')}>
            <button aria-pressed={!kk} onClick={() => setKk(false)}>RU</button><button aria-pressed={kk} onClick={() => setKk(true)}>ҚАЗ</button>
          </div>} />
        <div className="atm-screen">
          <div className="terminal-top"><span><ShieldCheck size={18} />QORNET ATM</span><span className="mono">KZT</span></div>
          <form onSubmit={(event) => void assess(event)}>
            <label>{t('Счёт клиента', 'Клиент шоты')}<select disabled={busy || pending} value={request.account} onChange={(event) => setRequest({ ...request, account: event.target.value })}>
              {snapshot.accounts.map(({ id }) => <option key={id}>{id}</option>)}
            </select></label>
            <label>{t('Сумма снятия, ₸', 'Алынатын сома, ₸')}<input disabled={busy || pending} type="number" min={100} max={5_000_000} required value={request.amount || ''} onChange={(event) => setRequest({ ...request, amount: Number(event.target.value) })} /></label>
            <label className="check"><input disabled={busy || pending} type="checkbox" checked={request.pressure} onChange={(event) => setRequest({ ...request, pressure: event.target.checked })} />{t('Меня попросили снять деньги', 'Маған ақша алуды сұрады')}</label>
            <label className="check"><input disabled={busy || pending} type="checkbox" checked={request.recentCredit} onChange={(event) => setRequest({ ...request, recentCredit: event.target.checked })} />{t('Недавно оформлен кредит', 'Жақында кредит рәсімделді')}</label>
            <button type="submit" className="button primary wide" disabled={busy || pending}><Wallet size={17} />{busy ? t('Обрабатываем…', 'Өңделуде…') : t('Проверить снятие', 'Ақша алуды тексеру')}</button>
          </form>
        </div>
        {error && <div className="error" role="alert">{error}</div>}
        {decision && <div className={`atm-result ${pending ? 'attention' : ''}`} aria-live="polite">
          <h3>{pending ? <ShieldAlert size={20} /> : <CircleCheck size={20} />}{atmName[decision.state][kk ? 1 : 0]}</h3>
          <p className="mono">{decision.id} · {money(decision.request.amount)}</p>
          {pending && <>
            <p>{decision.request.pressure
              ? t('Кто-то попросил вас оформить кредит или снять наличные? Прервите разговор и свяжитесь с банком по официальному номеру.', 'Біреу кредит рәсімдеуді немесе ақша алуды сұрады ма? Сөйлесуді тоқтатып, банкке ресми нөмірі арқылы хабарласыңыз.')
              : t('Вы самостоятельно начали снятие и никому не передаёте эти деньги?', 'Ақша алуды өзіңіз бастадыңыз ба және оны басқа адамға бермейсіз бе?')}</p>
            {state === 'CHALLENGE' && <label className="check"><input type="checkbox" checked={verified} onChange={(event) => setVerified(event.target.checked)} />{t('Да, это моё самостоятельное решение', 'Иә, бұл менің өз шешімім')}</label>}
            <div className="action-row">
              {state === 'CHALLENGE' && <button className="button primary" disabled={!verified || busy} onClick={() => void resolve('verified')}><LockKeyhole size={15} />{t('Подтвердить', 'Растау')}</button>}
              <button className="button secondary" disabled={busy} onClick={() => void resolve('assistance')}><Headphones size={15} />{t('Нужна помощь', 'Көмек қажет')}</button>
              <button className="button text" disabled={busy} onClick={() => void resolve('cancel')}><X size={15} />{t('Отменить', 'Бас тарту')}</button>
            </div>
          </>}
          {assisted && <p><Hand size={15} /> {t('Свяжитесь с банком по официальному номеру. Обращение записано в журнале симулятора.', 'Банкке ресми нөмірі арқылы хабарласыңыз. Өтініш симулятор журналында тіркелді.')}</p>}
        </div>}
      </section>
      <section className="panel atm-evidence">
        <PanelTitle title={t('Решение QORNET Core', 'QORNET Core шешімі')} detail={t('Автоматическая оценка на момент запроса', 'Өтініш берілген сәттегі автоматты бағалау')} aside={<CreditCard size={19} className="muted" />} />
        {decision ? <><RiskSummary risk={decision.risk} kk={kk} />
          {decision.caseId && <a className="button secondary wide" href={`${compact ? sitePath('app/') : ''}#/cases/${encodeURIComponent(decision.caseId)}`}>{t('Открыть дело', 'Істі ашу')}</a>}
        </> : <Empty>{t('Запустите снятие, чтобы увидеть решение движка риска.', 'Тәуекел бағасын көру үшін ақша алу тексерісін бастаңыз.')}</Empty>}
      </section>
    </div>
    {!compact && <Vision kk={kk} />}
  </div>
}
