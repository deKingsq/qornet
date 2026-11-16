import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { scenarioSnapshot } from '../backend/engine.ts'
import { Store } from '../backend/store.ts'

test('SQLite retains case decisions and audit entries across a restart', () => {
  const folder = mkdtempSync(join(tmpdir(), 'qornet-test-'))
  const file = join(folder, 'audit.sqlite')
  let store = new Store(file)
  const cluster = scenarioSnapshot('farm').clusters[0]
  try {
    const id = store.transaction(() => store.openCase('farm', 'network', cluster.id, 'Тестовое дело', cluster.risk))
    store.transaction(() => store.reviewCase(store.case(id)!, 'CONFIRMED', 'Проверено'))
    store.close()
    store = new Store(file)
    assert.equal(store.case(id)?.status, 'CONFIRMED')
    assert.equal(store.history()[0].action, 'CASE_REVIEWED')
    assert.throws(() => store.transaction(() => {
      store.record('farm', 'core', 'transient', 'SCENARIO_RUN', {})
      throw new Error('rollback')
    }), /rollback/)
    assert.ok(!store.history().some(({ reference }) => reference === 'transient'))
  } finally {
    store.close()
    rmSync(folder, { recursive: true, force: true })
  }
})
