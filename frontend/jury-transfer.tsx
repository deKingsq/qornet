import { ArrowRight, ArrowUpRight, Check, CirclePause, CreditCard, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import type { CSSProperties } from 'react'
import type { Snapshot, TransferDecision } from '../shared/domain.ts'
import { api, money, sitePath } from './lib.ts'
import { makeTransferExample, transferExamples } from './transfers.tsx'

type Result = { decision?: TransferDecision; failed?: boolean }
const copy = [
  ['Обычный получатель', 'Перевод можно подтвердить'],
  ['Связанный получатель', 'Перевод на проверке'],
] as const

export function JuryTransfer({ snapshot, onChange }: { snapshot: Snapshot; onChange: () => void }) {
  const [ids, setIds] = useState(() => transferExamples.map(() => crypto.randomUUID()))
  const [results, setResults] = useState<Result[]>([])
  const [busy, setBusy] = useState(false)
  const { sender, amount } = makeTransferExample()
  const available = [sender, ...transferExamples.map(({ recipient }) => recipient)]
    .every((id) => snapshot.accounts.some((account) => account.id === id))
  const failed = results.some((result) => result.failed)
  const completed = results.length === transferExamples.length && !failed

  async function compare() {
    if (busy || completed || !available) return
    setBusy(true)
    const updated = await Promise.all(transferExamples.map(async ({ recipient }, index): Promise<Result> => {
      if (results[index]?.decision) return results[index]
      try {
        const decision = await api<TransferDecision>('/transfer-checks', {
          method: 'POST',
          body: JSON.stringify({ scenario: snapshot.scenario, requestId: ids[index], ...makeTransferExample(recipient) }),
        })
        return { decision }
      } catch {
        return { failed: true }
      }
    }))
    setResults(updated)
    setBusy(false)
    if (updated.some(({ decision }) => decision)) onChange()
  }

  function reset() {
    setIds(transferExamples.map(() => crypto.randomUUID()))
    setResults([])
  }

  return <section className="jury-transfer" aria-labelledby="jury-transfer-title">
    <div className="jury-amount">
      <div><h2 id="jury-transfer-title">Сумма каждого перевода</h2><strong>{money(amount)}</strong></div>
      <div className="jury-sender"><span>Отправитель</span><b className="mono">{sender}</b></div>
    </div>
    <div className="jury-recipients" aria-busy={busy}>
      {transferExamples.map(({ recipient }, index) => {
        const { decision, failed } = results[index] ?? {}
        const review = decision?.state === 'REVIEW'
        const reasons = decision?.risk.reasons.filter(({ points }) => points > 0) ?? []
        return <article key={recipient} className="jury-recipient" data-decision={decision ? review ? 'review' : 'ready' : undefined}>
          <div className="jury-recipient-label"><h3>{copy[index][0]}</h3><span className="mono">{recipient}</span></div>
          <div className="jury-diagram" aria-hidden="true">
            <i className="rail" />
            <div className="jury-token">
              {[0, 1, 2, 3].map((depth) => <b key={depth} style={{ '--depth': depth } as CSSProperties} />)}
              {decision ? review ? <CirclePause size={24} /> : <Check size={24} /> : <CreditCard size={24} />}
            </div>
            <i className="rail" />
          </div>
          {decision ? <div className="jury-decision">
            <div className="jury-decision-title">{review ? <CirclePause size={19} /> : <Check size={19} />}<strong>{review ? copy[1][1] : copy[0][1]}</strong></div>
            <p className="jury-score"><b>{decision.risk.score}</b><span>/ 100 баллов риска</span></p>
            {reasons.length ? <ul className="jury-reasons">{reasons.map(({ code, ru, points }) => <li key={code}><span>{ru}</span><b className="mono">+{points}</b></li>)}</ul>
              : <p className="jury-empty-note">Дополнительных сигналов по получателю нет.</p>}
            <a href={decision.caseId ? sitePath('app/#/cases/') + encodeURIComponent(decision.caseId) : sitePath('app/#/transfer/') + encodeURIComponent(decision.id)}>
              {decision.caseId ? 'Открыть дело' : 'Открыть заявку'}<ArrowUpRight size={15} />
            </a>
          </div> : <p className="jury-empty-note">{busy ? 'QORNET проверяет связи…' : failed ? 'Ответ не получен' : 'Ожидает проверки'}</p>}
        </article>
      })}
    </div>
    <div className="jury-transfer-action">
      {completed ? <button className="button secondary" onClick={reset}>Сравнить заново</button>
        : <button className="button primary" onClick={() => void compare()} disabled={busy || !available}>
          <ShieldCheck size={17} />{busy ? 'Проверяем…' : failed ? 'Повторить проверку' : 'Сравнить получателей'}<ArrowRight size={16} />
        </button>}
      <span>Симуляция · деньги не списываются</span>
    </div>
    {!available && <p className="jury-message" role="status">В сценарии нет одного из счетов для сравнения.</p>}
    {failed && !busy && <p className="jury-message" role="alert">Не удалось получить все решения QORNET. Повторите проверку.</p>}
    <span className="jury-sr" role="status">{completed ? 'Оба решения получены.' : busy ? 'Сравнение выполняется.' : ''}</span>
  </section>
}
