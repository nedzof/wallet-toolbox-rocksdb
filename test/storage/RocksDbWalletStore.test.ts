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
      await store.updateOutput({
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

  test('ignores stale secondary index records that no longer match primary outputs', async () => {
    const store = await RocksDbWalletStore.open({ path: path.join(dir, 'wallet.rocksdb') })
    try {
      const txid = 'b'.repeat(64)
      const output = makeOutput({
        outputId: 2,
        userId: 7,
        basketId: 10,
        spendable: false,
        txid,
        vout: 0,
        lockingScript: [0x51]
      })
      const staleScriptHash = hashOutputLockingScript([0x52])

      await store.putOutput(output)
      await store.put({ key: `output!scriptHash!${staleScriptHash}!${pad(2)}`, value: { outputId: 2 } })
      await store.put({ key: `output!spendable!${pad(7)}!all!${pad(2)}`, value: { outputId: 2 } })
      await store.put({ key: `output!spendable!${pad(7)}!basket!${pad(10)}!${pad(2)}`, value: { outputId: 2 } })
      await store.put({ key: `output!outpoint!${pad(8)}!${txid}!${pad(0)}`, value: { outputId: 2 } })

      expect(await store.findOutputsByScriptHash(staleScriptHash)).toEqual([])
      expect(await store.findSpendableOutputs(7)).toEqual([])
      expect(await store.findSpendableOutputs(7, 10)).toEqual([])
      expect(await store.findOutputsByOutpoints(8, [{ txid, vout: 0 }])).toEqual({})
    } finally {
      store.close()
    }
  })

  test('rebuilds output indexes and backfills script hash metadata on primary outputs', async () => {
    const store = await RocksDbWalletStore.open({ path: path.join(dir, 'wallet.rocksdb') })
    try {
      const txid = 'c'.repeat(64)
      const lockingScript = [0x51]
      const scriptHash = hashOutputLockingScript(lockingScript)
      const staleScriptHash = hashOutputLockingScript([0x52])
      const output = makeOutput({
        outputId: 3,
        userId: 8,
        basketId: 12,
        spendable: true,
        txid,
        vout: 1,
        lockingScript
      })

      await store.put({ key: `output!id!${pad(3)}`, value: output })
      await store.put({ key: `output!scriptHash!${staleScriptHash}!${pad(999)}`, value: { outputId: 999 } })
      await store.put({ key: `output!spendable!${pad(8)}!all!${pad(999)}`, value: { outputId: 999 } })

      expect(await store.findOutputsByScriptHash(scriptHash)).toEqual([])
      expect(await store.findSpendableOutputs(8)).toEqual([])

      await expect(store.rebuildOutputIndexes()).resolves.toBe(1)

      expect((await store.findOutputsByScriptHash(scriptHash)).map(o => o.outputId)).toEqual([3])
      expect((await store.findSpendableOutputs(8)).map(o => o.outputId)).toEqual([3])
      expect((await store.findSpendableOutputs(8, 12)).map(o => o.outputId)).toEqual([3])
      expect(Object.keys(await store.findOutputsByOutpoints(8, [{ txid, vout: 1 }]))).toEqual([`${txid}.1`])
      expect(await store.findOutputsByScriptHash(staleScriptHash)).toEqual([])
      expect((await store.get<TableOutput>(`output!id!${pad(3)}`))?.value.scriptHash).toBe(scriptHash)
    } finally {
      store.close()
    }
  })

  test('reserves spendable outputs through value-ordered index', async () => {
    const store = await RocksDbWalletStore.open({ path: path.join(dir, 'wallet.rocksdb') })
    try {
      const outputs = [10, 50, 100].map((satoshis, index) => makeOutput({
        outputId: index + 1,
        userId: 9,
        basketId: 13,
        spendable: true,
        txid: String(index + 1).repeat(64),
        vout: 0,
        satoshis,
        lockingScript: [0x51]
      }))
      for (const output of outputs) {
        await store.putOutput(output)
        await store.put({ key: `entity!outputs!${output.outputId}`, value: output })
      }

      const exact = await store.reserveSpendableOutputByValue(9, 13, 'exact', 50, () => true, 500, id => `entity!outputs!${id}`)
      const over = await store.reserveSpendableOutputByValue(9, 13, 'over', 51, () => true, 501, id => `entity!outputs!${id}`)
      const under = await store.reserveSpendableOutputByValue(9, 13, 'under', 51, () => true, 502, id => `entity!outputs!${id}`)

      expect(exact?.outputId).toBe(2)
      expect(over?.outputId).toBe(3)
      expect(under?.outputId).toBe(1)
      expect((await store.findSpendableOutputs(9, 13)).map(output => output.outputId)).toEqual([])
    } finally {
      store.close()
    }
  })

  test('starts value-ordered reservations from a transaction-derived seed', async () => {
    const store = await RocksDbWalletStore.open({ path: path.join(dir, 'wallet.rocksdb') })
    try {
      const outputs = Array.from({ length: 4 }, (_, index) => makeOutput({
        outputId: index + 1,
        userId: 9,
        basketId: 13,
        spendable: true,
        txid: String(index + 1).repeat(64),
        vout: 0,
        satoshis: 50,
        lockingScript: [0x51]
      }))
      for (const output of outputs) {
        await store.putOutput(output)
        await store.put({ key: `entity!outputs!${output.outputId}`, value: output })
      }

      const seeded = await store.reserveSpendableOutputByValue(9, 13, 'over', 1, () => true, 3, id => `entity!outputs!${id}`)
      const nextSeeded = await store.reserveSpendableOutputByValue(9, 13, 'over', 1, () => true, 4, id => `entity!outputs!${id}`)
      const wrapped = await store.reserveSpendableOutputByValue(9, 13, 'over', 1, () => true, 5, id => `entity!outputs!${id}`)

      expect(seeded?.outputId).toBe(3)
      expect(nextSeeded?.outputId).toBe(4)
      expect(wrapped?.outputId).toBe(1)
    } finally {
      store.close()
    }
  })

  test('reserves spendable outputs through transaction-status value index', async () => {
    const store = await RocksDbWalletStore.open({ path: path.join(dir, 'wallet.rocksdb') })
    try {
      const completed = makeOutput({
        outputId: 1,
        userId: 9,
        basketId: 13,
        transactionId: 101,
        spendable: true,
        txid: '1'.repeat(64),
        vout: 0,
        satoshis: 50,
        lockingScript: [0x51]
      })
      const sending = makeOutput({
        outputId: 2,
        userId: 9,
        basketId: 13,
        transactionId: 102,
        spendable: true,
        txid: '2'.repeat(64),
        vout: 0,
        satoshis: 10,
        lockingScript: [0x51]
      })
      const unproven = makeOutput({
        outputId: 3,
        userId: 9,
        basketId: 13,
        transactionId: 103,
        spendable: true,
        txid: '3'.repeat(64),
        vout: 0,
        satoshis: 20,
        lockingScript: [0x51]
      })
      await store.putOutput(completed, 'completed')
      await store.put({ key: `entity!outputs!${completed.outputId}`, value: completed })
      await store.putOutput(sending, 'sending')
      await store.put({ key: `entity!outputs!${sending.outputId}`, value: sending })
      await store.putOutput(unproven, 'unproven')
      await store.put({ key: `entity!outputs!${unproven.outputId}`, value: unproven })

      expect(await store.countSpendableOutputsByTransactionStatus(9, 13, ['completed', 'unproven'])).toBe(2)
      const reserved = await store.reserveSpendableOutputByStatusAndValue(
        9,
        13,
        ['completed', 'unproven'],
        'over',
        1,
        () => true,
        500,
        id => `entity!outputs!${id}`
      )

      expect(reserved?.outputId).not.toBe(sending.outputId)
      expect([completed.outputId, unproven.outputId]).toContain(reserved?.outputId)
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
      pessimistic: true,
      readOnly: false,
      statsLevel: 1,
      transactionLogMaxAgeThreshold: 0.5,
      transactionLogMaxSize: 32 * 1024 * 1024,
      transactionLogRetention: '7d',
      transactionLogsPath: path.join(dir, 'transaction-logs'),
      blockCacheSize: 64 * 1024 * 1024,
      compactOnClose: true
    })
    try {
      expect(store.getTuningOptions()).toEqual({
        parallelismThreads: 16,
        disableWAL: false,
        enableStats: true,
        noBlockCache: true,
        pessimistic: true,
        readOnly: false,
        statsLevel: 1,
        transactionLogMaxAgeThreshold: 0.5,
        transactionLogMaxSize: 32 * 1024 * 1024,
        transactionLogRetention: '7d',
        transactionLogsPath: path.join(dir, 'transaction-logs'),
        blockCacheSize: 64 * 1024 * 1024,
        compactOnClose: true
      })
    } finally {
      store.close()
    }
  })

  test('rejects source-doc RocksDB tuning knobs unsupported by the current binding', async () => {
    await expect(RocksDbWalletStore.open({
      path: path.join(dir, 'wallet.rocksdb'),
      writeBufferSize: 64 * 1024 * 1024
    } as any)).rejects.toThrow('ROCKSDB_WALLET_STORE_UNSUPPORTED_OPTION:writeBufferSize')

    await expect(RocksDbWalletStore.open({
      path: path.join(dir, 'wallet.rocksdb'),
      writeOptions: { sync: false, compression: 'lz4' }
    } as any)).rejects.toThrow('ROCKSDB_WALLET_STORE_UNSUPPORTED_OPTION:writeOptions')
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

  test('prepares the store for an operator filesystem snapshot', async () => {
    const dbPath = path.join(dir, 'wallet.rocksdb')
    const store = await RocksDbWalletStore.open({ path: dbPath })
    try {
      await store.put({ key: 'snapshot!keep', value: { ok: true } })

      const prepared = await store.prepareForFilesystemSnapshot({ compact: true })

      expect(prepared.path).toBe(dbPath)
      expect(prepared.compacted).toBe(true)
      expect(prepared.preparedAt).toBeInstanceOf(Date)
      expect((await store.get<{ ok: boolean }>('snapshot!keep'))?.value.ok).toBe(true)
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

function pad (value: number): string {
  return value.toString().padStart(16, '0')
}
