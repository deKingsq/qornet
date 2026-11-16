import type { AtmState, CaseStatus, Level } from '../shared/domain.ts'

export const sitePath = (path = '') => import.meta.env.BASE_URL + path

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  if (import.meta.env.MODE === 'pages') {
    const { browserApi } = await import('./browser-api.ts')
    return browserApi(path, options) as T
  }
  const response = await fetch(`/api/v1${path}`, {
    ...options,
    headers: options?.body ? { 'Content-Type': 'application/json', ...options.headers } : options?.headers,
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.message ?? 'Ошибка соединения с QORNET')
  return data as T
}

const numberFormat = new Intl.NumberFormat('ru-RU')
const shortTime = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Qyzylorda', hour: '2-digit', minute: '2-digit' })
export const num = (value: number) => numberFormat.format(value)
export const money = (value: number) => `${num(value)} ₸`
export const time = (value: number) => shortTime.format(value)
export const percent = (value: number) => `${(value * 100).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%`
export const levelClass = (level: Level) => level.toLowerCase().replace(' ', '-')
export const statusName: Record<CaseStatus, string> = {
  OPEN: 'Открыто', INVESTIGATING: 'В расследовании', CONFIRMED: 'Подтверждено', DISMISSED: 'Закрыто',
}
export const atmName: Record<AtmState, [string, string]> = {
  ALLOWED: ['Операция разрешена', 'Операцияға рұқсат берілді'],
  CHALLENGE: ['Нужно подтверждение', 'Растау қажет'],
  REVIEW: ['Нужен сотрудник', 'Қызметкер қажет'],
  HOLD: ['Операция приостановлена', 'Операция уақытша тоқтатылды'],
  CANCELLED: ['Операция отменена', 'Операция тоқтатылды'],
}
