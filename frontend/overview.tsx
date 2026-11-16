import { Activity, ArrowRight, ArrowUpRight, CircleAlert, Network, Play, Wallet } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { Snapshot, TransactionView } from '../shared/domain.ts'
import { PanelTitle, Transactions } from './components.tsx'
import { money, num, sitePath } from './lib.ts'
import { NetworkPage } from './network.tsx'

export function Overview({ snapshot, navigate, inspect }: {
  snapshot: Snapshot; navigate: (page: string) => void; inspect: (item: TransactionView) => void
}) {
  const { stats, clusters, chains } = snapshot
  const cluster = clusters[0]
  const alerts = snapshot.transactions.filter(({ risk }) => risk.level !== 'SAFE').slice(0, 5)
  const metrics = [
    { icon: Activity, label: 'Проверено переводов', value: num(stats.total), detail: 'За 12 часов' },
    { icon: CircleAlert, label: 'С сигналами риска', value: num(stats.review), detail: `${(100 * stats.review / Math.max(stats.total, 1)).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}% переводов` },
    { icon: Network, label: 'Связанные сети', value: num(stats.clusters), detail: cluster ? `${cluster.members.length} счетов в крупнейшем кластере` : 'Нет подтверждённых кластеров' },
    { icon: Wallet, label: 'Объём переводов', value: money(stats.volume), detail: 'В текущем сценарии' },
  ]
  return <>
    <section className="overview-hero" aria-labelledby="overview-headline">
      <div className="overview-hero-copy">
        <p className="eyebrow"><span />Синтетические данные</p>
        <h1 id="overview-headline">Как QORNET выявляет<br />связанные счета</h1>
        <p>Сопоставляем устройства, сессии и переводы, чтобы банк успел проверить риск до выдачи наличных.</p>
        <div className="hero-actions">
          <a className="button primary" href={sitePath('demo/')}><Play size={16} fill="currentColor" />Показать жюри</a>
          <a className="button secondary" href="#/network">Открыть граф<ArrowUpRight size={16} /></a>
        </div>
      </div>
    </section>
    <div className="metric-grid overview-metrics" aria-label="Итоги проверки">
      {metrics.map(({ icon: Icon, label, value, detail }) => <article className="metric" key={label}>
        <div className="metric-label"><Icon size={16} />{label}</div>
        <strong>{value}</strong><small>{detail}</small>
      </article>)}
    </div>
    <NetworkPage snapshot={snapshot} compact />
    <details className="panel activity-details">
      <summary><Activity size={16} />Активность переводов за 12 часов</summary>
      <div className="chart-legend"><span><i />Все операции</span><span><i />С сигналами риска</span><span>UTC+5</span></div>
      <div className="chart" aria-label="Почасовой график переводов">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <AreaChart data={snapshot.series} margin={{ top: 8, right: 20, left: -19, bottom: 2 }}>
            <CartesianGrid vertical={false} stroke="#324654" strokeDasharray="3 6" />
            <XAxis dataKey="hour" tickFormatter={(hour: number) => `${hour}:00`} tick={{ fill: '#a8bac7', fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={23} />
            <YAxis allowDecimals={false} tick={{ fill: '#a8bac7', fontSize: 11 }} tickLine={false} axisLine={false} />
            <Tooltip labelFormatter={(hour) => `${hour}:00`} contentStyle={{ background: '#16232e', border: '1px solid #455d6e', borderRadius: 8 }} />
            <Area type="monotone" name="Все операции" dataKey="total" stroke="#83edc2" strokeWidth={2.2} fill="#64d5ae33" isAnimationActive={false} />
            <Area type="monotone" name="С сигналами" dataKey="flagged" stroke="#f8bc8e" strokeWidth={1.8} fill="#f8bc8e22" isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </details>
    <section className="panel operations-panel">
      <PanelTitle title={alerts.length ? 'Переводы с сигналами' : 'Последние переводы'} detail={alerts.length ? `${stats.review} операций с сигналами · ${chains.length} найденных маршрутов` : 'В текущем наборе сигналов риска нет'} aside={
        <button className="button text" onClick={() => navigate('trace')}>Открыть трассировку<ArrowRight size={15} /></button>
      } />
      <Transactions items={alerts.length ? alerts : snapshot.transactions.slice(0, 5)} onInspect={inspect} />
    </section>
  </>
}
