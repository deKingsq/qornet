import { DatabaseSync } from 'node:sqlite'
import type { AtmDecision, Audit, Case, CaseStatus, Risk, ScenarioId, TransferDecision } from '../shared/domain.ts'

export class Store {
  private readonly db: DatabaseSync

  constructor(filename: string) {
    this.db = new DatabaseSync(filename)
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS audit (
        id INTEGER PRIMARY KEY, at INTEGER NOT NULL, scenario TEXT NOT NULL,
        channel TEXT NOT NULL, reference TEXT NOT NULL, action TEXT NOT NULL, payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS cases (
        id TEXT PRIMARY KEY, scenario TEXT NOT NULL, updated_at INTEGER NOT NULL, payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS atm (
        id TEXT PRIMARY KEY, payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS transfer_checks (
        id TEXT PRIMARY KEY, payload TEXT NOT NULL
      );
    `)
  }

  transaction<T>(action: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = action()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  record(scenario: ScenarioId, channel: string, reference: string, action: string, payload: unknown) {
    this.db.prepare('INSERT INTO audit (at, scenario, channel, reference, action, payload) VALUES (?, ?, ?, ?, ?, ?)')
      .run(Date.now(), scenario, channel, reference, action, JSON.stringify(payload))
  }

  history(): Audit[] {
    return this.db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 150').all()
      .map((row) => ({ ...row, payload: JSON.parse(String(row.payload)) }) as Audit)
  }

  cases(): Case[] {
    return this.db.prepare('SELECT payload FROM cases ORDER BY updated_at DESC, id').all().map(({ payload }) => JSON.parse(String(payload)))
  }

  case(id: string): Case | undefined {
    const row = this.db.prepare('SELECT payload FROM cases WHERE id = ?').get(id)
    return row ? JSON.parse(String(row.payload)) : undefined
  }

  openCase(scenario: ScenarioId, channel: Case['channel'], reference: string, title: string, risk: Risk): string {
    const id = `${scenario}:${reference}`
    const at = Date.now()
    const entry: Case = { id, scenario, channel, title, risk, status: 'OPEN', createdAt: at, updatedAt: at }
    const { changes } = this.db.prepare('INSERT OR IGNORE INTO cases VALUES (?, ?, ?, ?)').run(id, scenario, at, JSON.stringify(entry))
    if (changes) this.record(scenario, channel, id, 'CASE_OPENED', { title, risk })
    return id
  }

  reviewCase(entry: Case, status: CaseStatus, note: string): Case {
    const updated = { ...entry, status, updatedAt: Date.now() }
    this.db.prepare('UPDATE cases SET updated_at = ?, payload = ? WHERE id = ?').run(updated.updatedAt, JSON.stringify(updated), entry.id)
    this.record(entry.scenario, entry.channel, entry.id, 'CASE_REVIEWED', { before: entry.status, status, note })
    return updated
  }

  atm(id: string): AtmDecision | undefined {
    const row = this.db.prepare('SELECT payload FROM atm WHERE id = ?').get(id)
    return row ? JSON.parse(String(row.payload)) : undefined
  }

  saveAtm(decision: AtmDecision, action: string) {
    this.db.prepare('INSERT INTO atm VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload')
      .run(decision.id, JSON.stringify(decision))
    this.record(decision.scenario, 'atm', decision.id, action, decision)
  }

  transfer(id: string): TransferDecision | undefined {
    const row = this.db.prepare('SELECT payload FROM transfer_checks WHERE id = ?').get(id)
    return row ? JSON.parse(String(row.payload)) : undefined
  }

  saveTransfer(decision: TransferDecision, action: string) {
    this.db.prepare('INSERT INTO transfer_checks VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload')
      .run(decision.id, JSON.stringify(decision))
    this.record(decision.scenario, 'transfer', decision.id, action, decision)
  }

  close() {
    this.db.close()
  }
}
