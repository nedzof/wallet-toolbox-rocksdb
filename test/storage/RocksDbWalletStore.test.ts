import { mkdtemp, rm } from 'fs/promises'
import os from 'os'
import path from 'path'
import { RocksDbWalletStore } from '../../src/storage/rocksdb'
import { TableOutput } from '../../src/storage/schema/tables/TableOutput'
import { hashOutputLockingScript } from '../../src/storage/outputScriptMetadata'
import { WalletToolboxMetrics } from '../../src/metrics/WalletToolboxMetrics'

describe('RocksDbWalletStore', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'wallet-toolbox-rocksdb-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test('persists versioned records and prefix scans through RocksDB', async () => {
    const store = await RocksDbWalletStore.open({ path: path.join(dir, 'wallet.rocksdb') })
    try {
      expect(await store.put({ key: 'utxo!a', value: { satoshis: 1 }, updated_at: 0 })).toMatchObject({
        ok: true,
        key: 'utxo!a',
        version: 1
      })
      expect(await store.put({ key: 'utxo!a', value: { satoshis: 2 }, expectedVersion: 1, updated_at: 1 })).toMatchObject({
        ok: true,
        key: 'utxo!a',
        version: 2
      })
      expect(await store.put({ key: 'utxo!a', value: { satoshis: 3 }, expectedVersion: 1 })).toMatchObject({
        ok: false,
        reason: 'version_conflict',
        currentVersion: 2
      })
      await store.put({ key: 'utxo!b', value: { satoshis: 4 } })

      const record = await store.get<{ satoshis: number }>('utxo!a')
      expect(record?.value.satoshis).toBe(2)
      expect(record?.version).toBe(2)

      const scanned = await store.scan<{ satoshis: number }>({ prefix: 'utxo!', limit: 10 })
      expect(scanned.map(r => r.key)).toEqual(['utxo!a', 'utxo!b'])
    } finally {
      store.close()
    }
  })

  test('applies batch writes and deletes transactionally', async () => {
    const store = await RocksDbWalletStore.open({ path: path.join(dir, 'wallet.rocksdb') })
    try {
      const results = await store.batch([
        { key: 'idem!1', value: { status: 'reserved' } },
        { key: 'idem!2', value: { status: 'reserved' } }
      ])
      expect(results.every(r => r.ok)).toBe(true)
      await store.batch([{ type: 'delete', key: 'idem!1' }])
      expect(await store.get('idem!1')).toBeUndefined()
      expect((await store.get<{ status: string }>('idem!2'))?.value.status).toBe('reserved')
    } finally {
      store.close()
    }
  })

  test('maintains output secondary indexes for script hash, basket spendability, and outpoints', async () => {
    const store = await RocksDbWalletStore.open({ path: path.join(dir, 'wallet.rocksdb') })
    try {
      const txid = 'a'.repeat(64)
      const lockingScript = [0x51]
      const output = makeOutput({
        outputId: 1,
        userId: 7,
        basketId: 10,
        spendable: true,
        txid,
        vout: 0,
        lockingScript
      })
      const scriptHash = hashOutputLockingScript(lockingScript)

      await store.putOutput(output)

      expect((await store.findOutputsByScriptHash(scriptHash)).map(o => o.outputId)).toEqual([1])
      expect((await store.findSpendableOutputs(7)).map(o => o.outputId)).toEqual([1])
      expect((await store.findSpendableOutputs(7, 10)).map(o => o.outputId)).toEqual([1])
      expect(Object.keys(await store.findOutputsByOutpoints(7, [{ txid, vout: 0 }]))).toEqual([`${txid}.0`])

      const stored = (await store.findOutputsByScriptHash(scriptHash))[0]
      expect(stored.scriptHash).toBe(scriptHash)

      const newScript = [0x52]
      const newHash = hashOutputLockingScript(newScript)
      await store.putOutput({
        ...output,
        spendable: false,
        basketId: 11,
        lockingScript: newScript
      })

      expect(await store.findOutputsByScriptHash(scriptHash)).toEqual([])
      expect((await store.findOutputsByScriptHash(newHash)).map(o => o.outputId)).toEqual([1])
      expect(await store.findSpendableOutputs(7)).toEqual([])
      expect(await store.findSpendableOutputs(7, 10)).toEqual([])

      await store.deleteOutput(1)
      expect(await store.findOutputsByScriptHash(newHash)).toEqual([])
      expect(await store.findOutputsByOutpoints(7, [{ txid, vout: 0 }])).toEqual({})
    } finally {
      store.close()
    }
  })

  test('uses write-heavy defaults for RocksDB open options metadata', async () => {
    const store = await RocksDbWalletStore.open({ path: path.join(dir, 'wallet.rocksdb') })
    try {
      expect(store.getTuningOptions()).toEqual({
        parallelismThreads: 12,
        disableWAL: false,
        enableStats: false,
        noBlockCache: false
      })
    } finally {
      store.close()
    }
  })

  test('exposes supported RocksDB tuning overrides', async () => {
    const store = await RocksDbWalletStore.open({
      path: path.join(dir, 'wallet.rocksdb'),
      parallelismThreads: 16,
      disableWAL: false,
      enableStats: true,
      noBlockCache: true,
      blockCacheSize: 64 * 1024 * 1024,
      compactOnClose: true
    })
    try {
      expect(store.getTuningOptions()).toEqual({
        parallelismThreads: 16,
        disableWAL: false,
        enableStats: true,
        noBlockCache: true,
        blockCacheSize: 64 * 1024 * 1024,
        compactOnClose: true
      })
    } finally {
      store.close()
    }
  })

  test('records storage query latency metrics when metrics are provided', async () => {
    const metrics = new WalletToolboxMetrics()
    const store = await RocksDbWalletStore.open({ path: path.join(dir, 'wallet.rocksdb'), metrics })
    try {
      await store.put({ key: 'metric!1', value: { ok: true } })
      await store.get('metric!1')
      await store.scan({ prefix: 'metric!' })

      const body = await metrics.metrics()

      expect(body).toContain('wallet_toolbox_storage_query_duration_seconds_count{operation="put"}')
      expect(body).toContain('wallet_toolbox_storage_query_duration_seconds_count{operation="get"}')
      expect(body).toContain('wallet_toolbox_storage_query_duration_seconds_count{operation="scan"}')
    } finally {
      store.close()
    }
  })

  test('flushes and compacts the store namespace without losing records', async () => {
    const store = await RocksDbWalletStore.open({ path: path.join(dir, 'wallet.rocksdb') })
    try {
      await store.put({ key: 'compact!keep', value: { ok: true } })
      await store.put({ key: 'compact!delete', value: { ok: false } })
      await store.delete('compact!delete')

      await store.flush()
      await store.compact({ prefix: 'compact!' })

      expect((await store.get<{ ok: boolean }>('compact!keep'))?.value.ok).toBe(true)
      expect(await store.get('compact!delete')).toBeUndefined()
    } finally {
      store.close()
    }
  })
})

function makeOutput (overrides: Partial<TableOutput>): TableOutput {
  const now = new Date(0)
  return {
    created_at: now,
    updated_at: now,
    outputId: 0,
    userId: 1,
    transactionId: 1,
    spendable: false,
    change: false,
    outputDescription: 'test output',
    vout: 0,
    satoshis: 1,
    providedBy: 'you',
    purpose: 'test',
    type: 'custom',
    ...overrides
  }
}
