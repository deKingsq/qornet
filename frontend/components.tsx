import { ArrowDownLeft, ArrowRight, CircleHelp, Fingerprint, GitBranch, Layers2, Network, ShieldCheck, Timer } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Family, Level, Risk, TransactionView } from '../shared/domain.ts'
import { levelClass, money, time } from './lib.ts'

const levelLabels: Record<Level, [string, string]> = {
  SAFE: ['Без сигнала', 'Белгі жоқ'],
  REVIEW: ['Проверка', 'Тексеру қажет'],
  'HIGH RISK': ['Высокий риск', 'Жоғары тәуекел'],
  CRITICAL: ['Критический риск', 'Сындарлы тәуекел'],
}

export function RiskBadge({ level, kk = false }: { level: Level; kk?: boolean }) {
  return <span className={`risk-badge ${levelClass(level)}`} title={level}><i />{levelLabels[level][kk ? 1 : 0]}</span>
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty"><CircleHelp size={21} /><p>{children}</p></div>
}

export function PanelTitle({ title, detail, aside }: { title: string; detail?: string; aside?: ReactNode }) {
  return <div className="panel-title"><div><h2>{title}</h2>{detail && <p>{detail}</p>}</div>{aside}</div>
}

const familyIcon: Record<Family, typeof Network> = {
  device: Fingerprint, flow: GitBranch, timing: Timer, context: Layers2, customer: ShieldCheck, deal: ArrowDownLeft,
}

export function Evidence({ risk, kk = false, compact = false }: { risk: Risk; kk?: boolean; compact?: boolean }) {
  if (!risk.reasons.length) return <Empty>{kk ? 'Қосымша тәуекел белгілері табылмады' : 'Дополнительные сигналы риска не обнаружены'}</Empty>
  return <ul className="evidence-list">{risk.reasons.map((item) => {
    const Icon = familyIcon[item.family]
    return <li key={item.code}>
      <span className="signal-icon"><Icon size={16} /></span>
      <div><strong>{kk ? item.kk : item.ru}</strong>{!compact && item.refs.length > 0 && <small title={item.refs.join(', ')}>{item.refs.slice(0, 4).join(' · ')}{item.refs.length > 4 ? ` +${item.refs.length - 4}` : ''}</small>}</div>
      <span className={item.points ? 'signal-points' : 'muted mono'}>{item.points ? `+${item.points}` : '0'}</span>
    </li>
  })}</ul>
}

export function RiskSummary({ risk, kk = false }: { risk: Risk; kk?: boolean }) {
  const sum = risk.reasons.reduce((total, item) => total + item.points, 0)
  return <div className="risk-summary">
    <div className="risk-score"><span>{risk.score}</span><small>/ 100</small><RiskBadge level={risk.level} kk={kk} /></div>
    <div className="score-line"><i className={levelClass(risk.level)} style={{ width: `${risk.score}%` }} /></div>
    {!kk && <p>{risk.action}</p>}
    {sum > risk.score && <p>{kk ? `${sum} балл · шешім саясатының шегі ${risk.score}` : `Сумма сигналов ${sum} · предел политики ${risk.score}`}</p>}
    <Evidence risk={risk} kk={kk} />
  </div>
}

export function Transactions({ items, onInspect }: { items: TransactionView[]; onInspect: (item: TransactionView) => void }) {
  if (!items.length) return <Empty>По выбранному фильтру операций нет.</Empty>
  return <div className="table-scroll"><table>
    <thead><tr><th>Операция</th><th>Маршрут</th><th>Время</th><th className="money">Сумма</th><th>Риск</th></tr></thead>
    <tbody>{items.map((item) => <tr key={item.id}>
      <td><button className="table-link mono" onClick={() => onInspect(item)}><span className="tx-icon"><ArrowRight size={14} /></span>{item.id}</button></td>
      <td className="route-cell"><span>{item.from}</span><ArrowRight size={12} /><span>{item.to}</span></td>
      <td className="mono muted">{time(item.at)}</td>
      <td className="money mono">{money(item.amount)}</td>
      <td><RiskBadge level={item.risk.level} /></td>
    </tr>)}</tbody>
  </table></div>
}
