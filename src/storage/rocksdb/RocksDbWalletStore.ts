import { mkdir } from 'fs/promises'
import { createRequire } from 'node:module'
import path from 'path'
import type { RocksDatabase, RocksDatabaseOptions } from '@harperfast/rocksdb-js'
import pLimit from 'p-limit'
import { TableOutput } from '../schema/tables/TableOutput'
import { applyOutputScriptMetadata } from '../outputScriptMetadata'
import type { WalletToolboxMetrics } from '../../metrics/WalletToolboxMetrics'

export const ROCKSDB_WALLET_STORE_SCHEMA_VERSION = 1 as const
const ROCKSDB_INDEX_RESOLVE_CONCURRENCY = 50
const nativeRequire = createRequire(__filename)

type RocksDbJsModule = typeof import('@harperfast/rocksdb-js')

export interface RocksDbWalletRecord<T = unknown> {
  key: string
  value: T
  version: number
  updated_at: Date
}

export type RocksDbWalletPutResult =
  | { ok: true, key: string, version: number }
  | { ok: false, key: string, reason: 'version_conflict', currentVersion: number | null }

export interface RocksDbWalletPutArgs<T = unknown> {
  key: string
  value: T
  expectedVersion?: number | null
  updated_at?: Date | string | number
}

export interface RocksDbWalletScanArgs {
  prefix: string
  limit?: number
}

export interface RocksDbWalletCompactArgs {
  prefix?: string
}

export type SpendableValueReservationMode = 'exact' | 'over' | 'under'

export interface RocksDbWalletSnapshotPreparationArgs {
  compact?: boolean
}

export interface RocksDbWalletSnapshotPreparation {
  path: string
  preparedAt: Date
  compacted: boolean
}

interface RocksDatabaseRuntimeConfig {
  blockCacheSize?: number
  compactOnClose?: boolean
}

export interface RocksDbWalletStoreOptions {
  path: string
  namespace?: string
  createIfMissing?: boolean
  encoding?: 'msgpack' | 'ordered-binary' | 'binary' | false
  parallelismThreads?: number
  disableWAL?: boolean
  enableStats?: boolean
  noBlockCache?: boolean
  pessimistic?: boolean
  readOnly?: boolean
  statsLevel?: number
  transactionLogMaxAgeThreshold?: number
  transactionLogMaxSize?: number
  transactionLogRetention?: number | string
  transactionLogsPath?: string
  blockCacheSize?: number
  compactOnClose?: boolean
  metrics?: Pick<WalletToolboxMetrics, 'recordStorageQuery' | 'setTransactionTailQueueDepth'>
}

export interface RocksDbOutputIndexRecord {
  outputId: number
}

interface StoredRocksDbWalletRecord<T = unknown> {
  recordType: 'wallet-toolbox-rocksdb-record'
  schemaVersion: typeof ROCKSDB_WALLET_STORE_SCHEMA_VERSION
  value: T
  version: number
  updated_at: string
}

interface RocksDbTransaction {
  get: (key: string) => Promise<StoredRocksDbWalletRecord | undefined>
  put: (key: string, value: StoredRocksDbWalletRecord) => Promise<void>
  remove: (key: string) => Promise<void>
}

interface SpendableValueRange {
  prefix: string
  start: string
  end: string
  reverse?: boolean
}

/**
 * RocksDB-backed wallet state store for the wallet-toolbox fork.
 *
 * This is intentionally a small storage primitive first: it provides durable
 * versioned records, compare-and-set writes, prefix scans, and transaction
 * backed batches. Full WalletStorageProvider integration should build on this
 * class without changing signer or BRC-100 wallet APIs.
 */
export class RocksDbWalletStore {
  static readonly defaultParallelismThreads = 12
  private nativeTransactionTail: Promise<unknown> = Promise.resolve()

  private constructor (
    private readonly db: RocksDatabase,
    private readonly dbPath: string,
    private readonly namespace: string,
    private readonly parallelismThreads: number,
    private readonly disableWAL: boolean,
    private readonly enableStats: boolean,
    private readonly noBlockCache: boolean,
    private readonly pessimistic: boolean | undefined,
    private readonly readOnly: boolean | undefined,
    private readonly statsLevel: number | undefined,
    private readonly transactionLogMaxAgeThreshold: number | undefined,
    private readonly transactionLogMaxSize: number | undefined,
    private readonly transactionLogRetention: number | string | undefined,
    private readonly transactionLogsPath: string | undefined,
    private readonly blockCacheSize: number | undefined,
    private readonly compactOnClose: boolean | undefined,
    private readonly metrics?: Pick<WalletToolboxMetrics, 'recordStorageQuery' | 'setTransactionTailQueueDepth'>
  ) {}

  static async open (options: RocksDbWalletStoreOptions): Promise<RocksDbWalletStore> {
    rejectUnsupportedRocksDbTuningOptions(options)
    const dbPath = String(options.path ?? '').trim()
    if (dbPath === '') throw new Error('ROCKSDB_WALLET_STORE_PATH_REQUIRED')
    if (options.createIfMissing !== false) await mkdir(path.dirname(dbPath), { recursive: true })
    const db = await openRocksDatabase(dbPath, {
      encoding: options.encoding ?? 'msgpack',
      parallelismThreads: options.parallelismThreads ?? RocksDbWalletStore.defaultParallelismThreads,
      disableWAL: options.disableWAL ?? false,
      enableStats: options.enableStats ?? false,
      noBlockCache: options.noBlockCache ?? false,
      pessimistic: options.pessimistic,
      readOnly: options.readOnly,
      statsLevel: options.statsLevel,
      transactionLogMaxAgeThreshold: options.transactionLogMaxAgeThreshold,
      transactionLogMaxSize: options.transactionLogMaxSize,
      transactionLogRetention: options.transactionLogRetention,
      transactionLogsPath: options.transactionLogsPath
    }, {
      blockCacheSize: options.blockCacheSize,
      compactOnClose: options.compactOnClose
    })
    return new RocksDbWalletStore(
      db,
      dbPath,
      normalizeNamespace(options.namespace),
      options.parallelismThreads ?? RocksDbWalletStore.defaultParallelismThreads,
      options.disableWAL ?? false,
      options.enableStats ?? false,
      options.noBlockCache ?? false,
      options.pessimistic,
      options.readOnly,
      options.statsLevel,
      options.transactionLogMaxAgeThreshold,
      options.transactionLogMaxSize,
      options.transactionLogRetention,
      options.transactionLogsPath,
      options.blockCacheSize,
      options.compactOnClose,
      options.metrics
    )
  }

  async get<T = unknown> (key: string): Promise<RocksDbWalletRecord<T> | undefined> {
    return await this.recordStorageQuery('get', async () => {
      const normalizedKey = normalizeKey(key)
      const stored = await this.db.get(this.storageKey(normalizedKey)) as StoredRocksDbWalletRecord<T> | undefined
      if (stored === undefined) return undefined
      return this.decode(normalizedKey, stored)
    })
  }

  async put<T = unknown> (args: RocksDbWalletPutArgs<T>): Promise<RocksDbWalletPutResult> {
    return await this.recordStorageQuery('put', async () => {
      const normalizedKey = normalizeKey(args.key)
      const storageKey = this.storageKey(normalizedKey)
      if (args.expectedVersion !== undefined) {
        return await this.runNativeTransaction(async tx => {
          const current = await tx.get(storageKey)
          const currentVersion = current?.version ?? null
          if (currentVersion !== args.expectedVersion) {
            return { ok: false, key: normalizedKey, reason: 'version_conflict', currentVersion }
          }
          const next = this.encode(args.value, currentVersion, args.updated_at)
          await tx.put(storageKey, next)
          return { ok: true, key: normalizedKey, version: next.version }
        })
      }
      const current = await this.db.get(storageKey) as StoredRocksDbWalletRecord<T> | undefined
      const next = this.encode(args.value, current?.version ?? null, args.updated_at)
      await this.db.put(storageKey, next)
      return { ok: true, key: normalizedKey, version: next.version }
    })
  }

  async delete (key: string): Promise<void> {
    await this.recordStorageQuery('delete', async () => {
      await this.db.remove(this.storageKey(normalizeKey(key)))
    })
  }

  async batch (writes: Array<RocksDbWalletPutArgs | { type: 'delete', key: string }>): Promise<RocksDbWalletPutResult[]> {
    return await this.recordStorageQuery('batch', async () => {
      const results: RocksDbWalletPutResult[] = []
      for (const write of writes) {
        const key = normalizeKey(write.key)
        const storageKey = this.storageKey(key)
        if (isDeleteWrite(write)) {
          await this.db.remove(storageKey)
          results.push({ ok: true, key, version: 0 })
          continue
        }
        const current = await this.db.get(storageKey) as StoredRocksDbWalletRecord | undefined
        const currentVersion = current?.version ?? null
        if (write.expectedVersion !== undefined && currentVersion !== write.expectedVersion) {
          results.push({ ok: false, key, reason: 'version_conflict', currentVersion })
          continue
        }
        const next = this.encode(write.value, currentVersion, write.updated_at)
        await this.db.put(storageKey, next)
        results.push({ ok: true, key, version: next.version })
      }
      return results
    })
  }

  async incrementNumber (key: string, amount = 1): Promise<number> {
    return await this.recordStorageQuery('incrementNumber', async () => {
      if (!Number.isSafeInteger(amount) || amount < 1) throw new Error('ROCKSDB_WALLET_STORE_INCREMENT_AMOUNT_INVALID')
      const normalizedKey = normalizeKey(key)
      const storageKey = this.storageKey(normalizedKey)
      return await this.runNativeTransaction(async tx => {
        const current = await tx.get(storageKey) as StoredRocksDbWalletRecord<number> | undefined
        const currentVersion = current?.version ?? null
        const next = (current?.value ?? 0) + amount
        await tx.put(storageKey, this.encode(next, currentVersion))
        return next
      })
    })
  }

  async scan<T = unknown> (args: RocksDbWalletScanArgs): Promise<Array<RocksDbWalletRecord<T>>> {
    return await this.recordStorageQuery('scan', async () => {
      const prefix = normalizeKey(args.prefix)
      const storagePrefix = this.storageKey(prefix)
      const limit = Math.max(1, Math.trunc(args.limit ?? 100))
      const records: Array<RocksDbWalletRecord<T>> = []
      for (const entry of this.db.getRange({ start: storagePrefix, end: `${storagePrefix}\uffff` })) {
        const key = String(entry.key)
        if (!key.startsWith(this.namespace)) continue
        records.push(this.decode<T>(key.slice(this.namespace.length), entry.value as StoredRocksDbWalletRecord<T>))
        if (records.length >= limit) break
      }
      return records
    })
  }

  async findEntities<T = unknown> (args: RocksDbWalletScanArgs): Promise<Array<RocksDbWalletRecord<T>>> {
    return await this.scan<T>(args)
  }

  private async recordStorageQuery<T> (operation: string, work: () => Promise<T>): Promise<T> {
    const start = Date.now()
    try {
      return await work()
    } finally {
      this.metrics?.recordStorageQuery(operation, Date.now() - start)
    }
  }

  private async runNativeTransaction<T> (work: (tx: RocksDbTransaction) => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      return await this.db.transaction(async txn => await work(txn as unknown as RocksDbTransaction)) as T
    }
    const next = this.nativeTransactionTail.then(run, run)
    this.nativeTransactionTail = next.then(() => undefined, () => undefined)
    return await next
  }

  async putOutput (output: TableOutput, transactionStatus?: string): Promise<RocksDbWalletPutResult[]> {
    if (!Number.isInteger(output.outputId) || output.outputId <= 0) {
      throw new Error('ROCKSDB_OUTPUT_ID_REQUIRED')
    }

    const existing = await this.get<TableOutput>(outputPrimaryKey(output.outputId))
    const next = applyOutputScriptMetadata({ ...output })
    const writes: Array<RocksDbWalletPutArgs | { type: 'delete', key: string }> = []
    if (existing != null) writes.push(...this.indexDeletesForOutput(existing.value, transactionStatus))
    writes.push({ key: outputPrimaryKey(next.outputId), value: next })
    writes.push(...this.indexPutsForOutput(next, transactionStatus))
    return await this.batch(writes)
  }

  async updateOutput (output: TableOutput, transactionStatus?: string): Promise<RocksDbWalletPutResult[]> {
    return await this.putOutput(output, transactionStatus)
  }

  async deleteOutput (outputId: number): Promise<RocksDbWalletPutResult[]> {
    const existing = await this.get<TableOutput>(outputPrimaryKey(outputId))
    if (existing == null) return []
    return await this.batch([
      ...this.indexDeletesForOutput(existing.value),
      { type: 'delete', key: outputPrimaryKey(outputId) }
    ])
  }

  async findOutputsByScriptHash (scriptHash: string, limit = Number.MAX_SAFE_INTEGER): Promise<TableOutput[]> {
    const normalizedScriptHash = normalizeIndexPart(scriptHash)
    const records = await this.scan<RocksDbOutputIndexRecord>({
      prefix: outputScriptHashPrefix(normalizedScriptHash),
      limit
    })
    const outputs = await this.resolveOutputIndex(records)
    return outputs.filter(output => output.scriptHash === normalizedScriptHash)
  }

  async findSpendableOutputs (
    userId: number,
    basketId?: number,
    limit = Number.MAX_SAFE_INTEGER
  ): Promise<TableOutput[]> {
    const prefix = basketId == null
      ? outputSpendableAllPrefix(userId)
      : outputSpendableBasketPrefix(userId, basketId)
    const records = await this.scan<RocksDbOutputIndexRecord>({ prefix, limit })
    const outputs = await this.resolveOutputIndex(records)
    return outputs.filter(output =>
      output.userId === userId &&
      output.spendable === true &&
      (basketId == null || output.basketId === basketId)
    )
  }

  async countSpendableOutputs (
    userId: number,
    basketId?: number,
    limit = Number.MAX_SAFE_INTEGER
  ): Promise<number> {
    return await this.recordStorageQuery('countSpendableOutputs', async () => {
      const prefix = basketId == null
        ? outputSpendableAllPrefix(userId)
        : outputSpendableBasketPrefix(userId, basketId)
      const storagePrefix = this.storageKey(prefix)
      const normalizedLimit = Math.max(1, Math.trunc(limit))
      let count = 0
      for (const entry of this.db.getRange({ start: storagePrefix, end: `${storagePrefix}\uffff` })) {
        if (!String(entry.key).startsWith(this.namespace)) continue
        count++
        if (count >= normalizedLimit) break
      }
      return count
    })
  }

  async countSpendableOutputsByTransactionStatus (
    userId: number,
    basketId: number,
    statuses: string[]
  ): Promise<number> {
    return await this.recordStorageQuery('countSpendableOutputsByTransactionStatus', async () => {
      let count = 0
      for (const status of statuses) {
        const prefix = outputSpendableBasketStatusPrefix(userId, basketId, status)
        const storagePrefix = this.storageKey(prefix)
        for (const entry of this.db.getRange({ start: storagePrefix, end: `${storagePrefix}\uffff` })) {
          const key = String(entry.key)
          if (!key.startsWith(this.namespace) || !key.startsWith(storagePrefix)) continue
          count++
        }
      }
      return count
    })
  }

  async findFirstSpendableOutput (
    userId: number,
    basketId: number,
    predicate: (output: TableOutput) => boolean | Promise<boolean>,
    limit = Number.MAX_SAFE_INTEGER
  ): Promise<TableOutput | undefined> {
    return await this.recordStorageQuery('findFirstSpendableOutput', async () => {
      const prefix = outputSpendableBasketPrefix(userId, basketId)
      const storagePrefix = this.storageKey(prefix)
      const normalizedLimit = Math.max(1, Math.trunc(limit))
      let checked = 0
      for (const entry of this.db.getRange({ start: storagePrefix, end: `${storagePrefix}\uffff` })) {
        const key = String(entry.key)
        if (!key.startsWith(this.namespace)) continue
        const record = this.decode<RocksDbOutputIndexRecord>(key.slice(this.namespace.length), entry.value as StoredRocksDbWalletRecord<RocksDbOutputIndexRecord>)
        const output = await this.get<TableOutput>(outputPrimaryKey(record.value.outputId))
        checked++
        if (output != null) {
          const value = output.value
          if (
            value.userId === userId &&
            value.basketId === basketId &&
            value.spendable === true &&
            await predicate(value)
          ) return value
        }
        if (checked >= normalizedLimit) break
      }
      return undefined
    })
  }

  async reserveFirstSpendableOutput (
    userId: number,
    basketId: number,
    predicate: (output: TableOutput) => boolean | Promise<boolean>,
    transactionId: number,
    outputEntityKey: (outputId: number) => string,
    limit = Number.MAX_SAFE_INTEGER
  ): Promise<TableOutput | undefined> {
    return await this.recordStorageQuery('reserveFirstSpendableOutput', async () => {
      const prefix = outputSpendableBasketPrefix(userId, basketId)
      const storagePrefix = this.storageKey(prefix)
      const normalizedLimit = Math.max(1, Math.trunc(limit))
      let checked = 0
      for (const entry of this.db.getRange({ start: storagePrefix, end: `${storagePrefix}\uffff` })) {
        const key = String(entry.key)
        if (!key.startsWith(this.namespace)) continue
        const record = this.decode<RocksDbOutputIndexRecord>(key.slice(this.namespace.length), entry.value as StoredRocksDbWalletRecord<RocksDbOutputIndexRecord>)
        const outputRecord = await this.get<TableOutput>(outputPrimaryKey(record.value.outputId))
        checked++
        if (outputRecord != null) {
          const output = outputRecord.value
          if (
            output.userId === userId &&
            output.basketId === basketId &&
            output.spendable === true &&
            await predicate(output)
          ) {
            const reserved = await this.tryReserveSpendableOutput(
              outputRecord,
              userId,
              basketId,
              transactionId,
              outputEntityKey(output.outputId)
            )
            if (reserved != null) return reserved
          }
        }
        if (checked >= normalizedLimit) break
      }
      return undefined
    })
  }

  async reserveSpendableOutputByValue (
    userId: number,
    basketId: number,
    mode: SpendableValueReservationMode,
    satoshis: number,
    predicate: (output: TableOutput) => boolean | Promise<boolean>,
    transactionId: number,
    outputEntityKey: (outputId: number) => string,
    limit = Number.MAX_SAFE_INTEGER
  ): Promise<TableOutput | undefined> {
    return await this.recordStorageQuery('reserveSpendableOutputByValue', async () => {
      const range = spendableValueRange(userId, basketId, mode, satoshis)
      const seededSatoshis = mode === 'exact'
        ? satoshis
        : await this.firstSpendableValueSatoshisInRange(range)
      if (seededSatoshis != null) {
        const bucketSeed = await this.spendableValueBucketSeed(userId, basketId, seededSatoshis, transactionId)
        const seeded = await this.reserveSpendableValueBucketFromSeed(
          userId,
          basketId,
          seededSatoshis,
          mode === 'under',
          bucketSeed,
          predicate,
          transactionId,
          outputEntityKey,
          limit
        )
        if (seeded != null) return seeded
      }
      return await this.reserveFirstSpendableOutputFromIndexRange(
        userId,
        basketId,
        predicate,
        transactionId,
        outputEntityKey,
        range,
        limit
      )
    })
  }

  async reserveSpendableOutputByStatusAndValue (
    userId: number,
    basketId: number,
    statuses: string[],
    mode: SpendableValueReservationMode,
    satoshis: number,
    predicate: (output: TableOutput) => boolean | Promise<boolean>,
    transactionId: number,
    outputEntityKey: (outputId: number) => string,
    limit = Number.MAX_SAFE_INTEGER
  ): Promise<TableOutput | undefined> {
    return await this.recordStorageQuery('reserveSpendableOutputByStatusAndValue', async () => {
      for (const status of statuses) {
        const range = spendableStatusValueRange(userId, basketId, status, mode, satoshis)
        const seededSatoshis = mode === 'exact'
          ? satoshis
          : await this.firstSpendableValueSatoshisInRange(range)
        if (seededSatoshis != null) {
          const bucketSeed = await this.spendableStatusValueBucketSeed(userId, basketId, status, seededSatoshis, transactionId)
          const seeded = await this.reserveSpendableValueBucketFromSeed(
            userId,
            basketId,
            seededSatoshis,
            mode === 'under',
            bucketSeed,
            predicate,
            transactionId,
            outputEntityKey,
            limit,
            status
          )
          if (seeded != null) return seeded
        }
        const reserved = await this.reserveFirstSpendableOutputFromIndexRange(
          userId,
          basketId,
          predicate,
          transactionId,
          outputEntityKey,
          range,
          limit,
          status
        )
        if (reserved != null) return reserved
      }
      return undefined
    })
  }

  async findOutputsByOutpoints (
    userId: number,
    outpoints: Array<{ txid: string, vout: number }>
  ): Promise<Record<string, TableOutput>> {
    const byOutpoint: Record<string, TableOutput> = {}
    const limit = pLimit(ROCKSDB_INDEX_RESOLVE_CONCURRENCY)
    const outputs = await Promise.all(outpoints.map(async outpoint => await limit(async () => {
      const index = await this.get<RocksDbOutputIndexRecord>(outputOutpointKey(userId, outpoint.txid, outpoint.vout))
      if (index == null) return undefined
      const output = await this.get<TableOutput>(outputPrimaryKey(index.value.outputId))
      if (output == null) return undefined
      if (output.value.userId === userId && output.value.txid === outpoint.txid && output.value.vout === outpoint.vout) {
        return { outpoint: `${outpoint.txid}.${outpoint.vout}`, output: output.value }
      }
      return undefined
    })))
    for (const result of outputs) {
      if (result != null) byOutpoint[result.outpoint] = result.output
    }
    return byOutpoint
  }

  async findOutputsByTransactionId (transactionId: number): Promise<TableOutput[]> {
    const records = await this.scan<RocksDbOutputIndexRecord>({
      prefix: outputTransactionPrefix(transactionId),
      limit: Number.MAX_SAFE_INTEGER
    })
    const outputs = await this.resolveOutputIndex(records)
    return outputs.filter(output => output.transactionId === transactionId)
  }

  async rebuildOutputIndexes (): Promise<number> {
    const records = await this.scan<TableOutput>({ prefix: OUTPUT_PRIMARY_PREFIX, limit: Number.MAX_SAFE_INTEGER })
    const deletes = await this.collectOutputIndexDeletes()
    const puts = records.flatMap(record => {
      const output = applyOutputScriptMetadata({ ...record.value })
      return [
        { key: record.key, value: output },
        ...this.indexPutsForOutput(output)
      ]
    })
    await this.batch([...deletes, ...puts])
    return records.length
  }

  getTuningOptions (): {
    parallelismThreads: number
    disableWAL: boolean
    enableStats: boolean
    noBlockCache: boolean
    pessimistic?: boolean
    readOnly?: boolean
    statsLevel?: number
    transactionLogMaxAgeThreshold?: number
    transactionLogMaxSize?: number
    transactionLogRetention?: number | string
    transactionLogsPath?: string
    blockCacheSize?: number
    compactOnClose?: boolean
  } {
    const tuning: {
      parallelismThreads: number
      disableWAL: boolean
      enableStats: boolean
      noBlockCache: boolean
      pessimistic?: boolean
      readOnly?: boolean
      statsLevel?: number
      transactionLogMaxAgeThreshold?: number
      transactionLogMaxSize?: number
      transactionLogRetention?: number | string
      transactionLogsPath?: string
      blockCacheSize?: number
      compactOnClose?: boolean
    } = {
      parallelismThreads: this.parallelismThreads,
      disableWAL: this.disableWAL,
      enableStats: this.enableStats,
      noBlockCache: this.noBlockCache
    }
    if (this.pessimistic !== undefined) tuning.pessimistic = this.pessimistic
    if (this.readOnly !== undefined) tuning.readOnly = this.readOnly
    if (this.statsLevel !== undefined) tuning.statsLevel = this.statsLevel
    if (this.transactionLogMaxAgeThreshold !== undefined) tuning.transactionLogMaxAgeThreshold = this.transactionLogMaxAgeThreshold
    if (this.transactionLogMaxSize !== undefined) tuning.transactionLogMaxSize = this.transactionLogMaxSize
    if (this.transactionLogRetention !== undefined) tuning.transactionLogRetention = this.transactionLogRetention
    if (this.transactionLogsPath !== undefined) tuning.transactionLogsPath = this.transactionLogsPath
    if (this.blockCacheSize !== undefined) tuning.blockCacheSize = this.blockCacheSize
    if (this.compactOnClose !== undefined) tuning.compactOnClose = this.compactOnClose
    return tuning
  }

  async flush (): Promise<void> {
    await this.recordStorageQuery('flush', async () => {
      await this.db.flush()
    })
  }

  async compact (args: RocksDbWalletCompactArgs = {}): Promise<void> {
    await this.recordStorageQuery('compact', async () => {
      const prefix = args.prefix === undefined ? '' : normalizeKey(args.prefix)
      const start = this.storageKey(prefix)
      await this.db.compact({ start, end: `${start}\uffff` })
    })
  }

  async prepareForFilesystemSnapshot (
    args: RocksDbWalletSnapshotPreparationArgs = {}
  ): Promise<RocksDbWalletSnapshotPreparation> {
    await this.flush()
    if (args.compact === true) await this.compact()
    return {
      path: this.dbPath,
      preparedAt: new Date(),
      compacted: args.compact === true
    }
  }

  close (): void {
    this.db.close()
  }

  private async resolveOutputIndex (records: Array<RocksDbWalletRecord<RocksDbOutputIndexRecord>>): Promise<TableOutput[]> {
    const seen = new Set<number>()
    const outputIds: number[] = []
    for (const record of records) {
      const outputId = record.value.outputId
      if (seen.has(outputId)) continue
      seen.add(outputId)
      outputIds.push(outputId)
    }
    const limit = pLimit(ROCKSDB_INDEX_RESOLVE_CONCURRENCY)
    const outputs = await Promise.all(outputIds.map(async outputId => await limit(
      async () => (await this.get<TableOutput>(outputPrimaryKey(outputId)))?.value
    )))
    return outputs.filter((output): output is TableOutput => output != null)
  }

  async reindexOutputTransactionStatus (output: TableOutput, fromStatus: string | undefined, toStatus: string | undefined): Promise<RocksDbWalletPutResult[]> {
    return await this.batch([
      ...this.statusIndexDeletesForOutput(output, fromStatus),
      ...this.statusIndexPutsForOutput(output, toStatus)
    ])
  }

  private indexPutsForOutput (output: TableOutput, transactionStatus?: string): Array<RocksDbWalletPutArgs<RocksDbOutputIndexRecord>> {
    const outputId = output.outputId
    const value = { outputId }
    const writes: Array<RocksDbWalletPutArgs<RocksDbOutputIndexRecord>> = []
    if (output.scriptHash != null && output.scriptHash !== '') {
      writes.push({ key: outputScriptHashKey(output.scriptHash, outputId), value })
    }
    if (output.spendable) {
      writes.push({ key: outputSpendableUserKey(output.userId, outputId), value })
      if (output.basketId != null) writes.push({ key: outputSpendableBasketKey(output.userId, output.basketId, outputId), value })
      if (output.basketId != null) writes.push({ key: outputSpendableBasketValueKey(output.userId, output.basketId, output.satoshis, outputId), value })
      writes.push(...this.statusIndexPutsForOutput(output, transactionStatus))
    }
    if (output.txid != null && output.vout != null) {
      writes.push({ key: outputOutpointKey(output.userId, output.txid, output.vout), value })
    }
    if (output.transactionId != null) {
      writes.push({ key: outputTransactionKey(output.transactionId, outputId), value })
    }
    return writes
  }

  private indexDeletesForOutput (output: TableOutput, transactionStatus?: string): Array<{ type: 'delete', key: string }> {
    const deletes: Array<{ type: 'delete', key: string }> = []
    if (output.scriptHash != null && output.scriptHash !== '') {
      deletes.push({ type: 'delete', key: outputScriptHashKey(output.scriptHash, output.outputId) })
    }
    if (output.spendable) {
      deletes.push({ type: 'delete', key: outputSpendableUserKey(output.userId, output.outputId) })
      if (output.basketId != null) deletes.push({ type: 'delete', key: outputSpendableBasketKey(output.userId, output.basketId, output.outputId) })
      if (output.basketId != null) deletes.push({ type: 'delete', key: outputSpendableBasketValueKey(output.userId, output.basketId, output.satoshis, output.outputId) })
      deletes.push(...this.statusIndexDeletesForOutput(output, transactionStatus))
    }
    if (output.txid != null && output.vout != null) {
      deletes.push({ type: 'delete', key: outputOutpointKey(output.userId, output.txid, output.vout) })
    }
    if (output.transactionId != null) {
      deletes.push({ type: 'delete', key: outputTransactionKey(output.transactionId, output.outputId) })
    }
    return deletes
  }

  private statusIndexPutsForOutput (output: TableOutput, transactionStatus?: string): Array<RocksDbWalletPutArgs<RocksDbOutputIndexRecord>> {
    if (!output.spendable || output.basketId == null || transactionStatus == null) return []
    return [{
      key: outputSpendableBasketStatusValueKey(output.userId, output.basketId, transactionStatus, output.satoshis, output.outputId),
      value: { outputId: output.outputId }
    }]
  }

  private statusIndexDeletesForOutput (output: TableOutput, transactionStatus?: string): Array<{ type: 'delete', key: string }> {
    if (!output.spendable || output.basketId == null || transactionStatus == null) return []
    return [{
      type: 'delete',
      key: outputSpendableBasketStatusValueKey(output.userId, output.basketId, transactionStatus, output.satoshis, output.outputId)
    }]
  }

  private async tryReserveSpendableOutput (
    outputRecord: RocksDbWalletRecord<TableOutput>,
    userId: number,
    basketId: number,
    transactionId: number,
    entityKey: string,
    transactionStatus?: string
  ): Promise<TableOutput | undefined> {
    const primaryKey = outputPrimaryKey(outputRecord.value.outputId)
    return await this.runNativeTransaction(async tx => {
      const primaryStorageKey = this.storageKey(primaryKey)
      const entityStorageKey = this.storageKey(normalizeKey(entityKey))
      const currentPrimary = await tx.get(primaryStorageKey) as StoredRocksDbWalletRecord<TableOutput> | undefined
      const currentEntity = await tx.get(entityStorageKey) as StoredRocksDbWalletRecord<TableOutput> | undefined
      if (currentPrimary == null || currentEntity == null) return undefined
      if (currentPrimary.version !== outputRecord.version) return undefined
      const current = currentPrimary.value
      if (
        currentEntity.value.outputId !== current.outputId ||
        current.userId !== userId ||
        current.basketId !== basketId ||
        current.spendable !== true ||
        currentEntity.value.spendable !== true
      ) return undefined

      const updatedAt = new Date()
      const next = applyOutputScriptMetadata({
        ...current,
        spendable: false,
        spentBy: transactionId,
        updated_at: updatedAt
      })
      for (const deleteWrite of this.indexDeletesForOutput(current, transactionStatus)) {
        await tx.remove(this.storageKey(normalizeKey(deleteWrite.key)))
      }
      await tx.put(primaryStorageKey, this.encode(next, currentPrimary.version, updatedAt))
      await tx.put(entityStorageKey, this.encode(next, currentEntity.version, updatedAt))
      for (const putWrite of this.indexPutsForOutput(next, transactionStatus)) {
        await tx.put(this.storageKey(normalizeKey(putWrite.key)), this.encode(putWrite.value, null, updatedAt))
      }
      return next
    })
  }

  private async reserveFirstSpendableOutputFromIndexRange (
    userId: number,
    basketId: number,
    predicate: (output: TableOutput) => boolean | Promise<boolean>,
    transactionId: number,
    outputEntityKey: (outputId: number) => string,
    range: SpendableValueRange,
    limit = Number.MAX_SAFE_INTEGER,
    transactionStatus?: string
  ): Promise<TableOutput | undefined> {
    const storagePrefix = this.storageKey(range.prefix)
    const storageStart = this.storageKey(range.start)
    const storageEnd = this.storageKey(range.end)
    const normalizedLimit = Math.max(1, Math.trunc(limit))
    let checked = 0
    for (const entry of this.db.getRange({ start: storageStart, end: storageEnd, reverse: range.reverse })) {
      const key = String(entry.key)
      if (!key.startsWith(this.namespace) || !key.startsWith(storagePrefix)) continue
      const record = this.decode<RocksDbOutputIndexRecord>(key.slice(this.namespace.length), entry.value as StoredRocksDbWalletRecord<RocksDbOutputIndexRecord>)
      const outputRecord = await this.get<TableOutput>(outputPrimaryKey(record.value.outputId))
      checked++
      if (outputRecord != null) {
        const output = outputRecord.value
        if (
          output.userId === userId &&
          output.basketId === basketId &&
          output.spendable === true &&
          await predicate(output)
        ) {
          const reserved = await this.tryReserveSpendableOutput(
            outputRecord,
            userId,
            basketId,
            transactionId,
            outputEntityKey(output.outputId),
            transactionStatus
          )
          if (reserved != null) return reserved
        }
      }
      if (checked >= normalizedLimit) break
    }
    return undefined
  }

  private async reserveSpendableValueBucketFromSeed (
    userId: number,
    basketId: number,
    satoshis: number,
    reverse: boolean,
    seed: number,
    predicate: (output: TableOutput) => boolean | Promise<boolean>,
    transactionId: number,
    outputEntityKey: (outputId: number) => string,
    limit = Number.MAX_SAFE_INTEGER,
    transactionStatus?: string
  ): Promise<TableOutput | undefined> {
    const ranges = transactionStatus == null
      ? spendableValueSeededBucketRanges(userId, basketId, satoshis, seed, reverse)
      : spendableStatusValueSeededBucketRanges(userId, basketId, transactionStatus, satoshis, seed, reverse)
    for (const range of ranges) {
      const reserved = await this.reserveFirstSpendableOutputFromIndexRange(
        userId,
        basketId,
        predicate,
        transactionId,
        outputEntityKey,
        range,
        limit,
        transactionStatus
      )
      if (reserved != null) return reserved
    }
    return undefined
  }

  private async spendableValueBucketSeed (
    userId: number,
    basketId: number,
    satoshis: number,
    transactionId: number
  ): Promise<number> {
    const prefix = outputSpendableBasketValueSatoshisPrefix(userId, basketId, satoshis)
    const firstOutputId = await this.firstSpendableValueOutputIdInBucket(prefix, false)
    const lastOutputId = await this.firstSpendableValueOutputIdInBucket(prefix, true)
    if (firstOutputId == null || lastOutputId == null || lastOutputId < firstOutputId) {
      return spendableReservationSeed(transactionId)
    }
    const width = lastOutputId - firstOutputId + 1
    return firstOutputId + positiveModulo(transactionId - 1, width)
  }

  private async spendableStatusValueBucketSeed (
    userId: number,
    basketId: number,
    status: string,
    satoshis: number,
    transactionId: number
  ): Promise<number> {
    const prefix = outputSpendableBasketStatusValueSatoshisPrefix(userId, basketId, status, satoshis)
    const firstOutputId = await this.firstSpendableValueOutputIdInBucket(prefix, false)
    const lastOutputId = await this.firstSpendableValueOutputIdInBucket(prefix, true)
    if (firstOutputId == null || lastOutputId == null || lastOutputId < firstOutputId) {
      return spendableReservationSeed(transactionId)
    }
    const width = lastOutputId - firstOutputId + 1
    return firstOutputId + positiveModulo(transactionId - 1, width)
  }

  private async firstSpendableValueOutputIdInBucket (prefix: string, reverse: boolean): Promise<number | undefined> {
    const storagePrefix = this.storageKey(prefix)
    const range = reverse
      ? { start: `${storagePrefix}\uffff`, end: storagePrefix, reverse: true }
      : { start: storagePrefix, end: `${storagePrefix}\uffff` }
    for (const entry of this.db.getRange(range)) {
      const key = String(entry.key)
      if (!key.startsWith(this.namespace) || !key.startsWith(storagePrefix)) continue
      return outputIdFromSpendableValueKey(key.slice(this.namespace.length))
    }
    return undefined
  }

  private async firstSpendableValueSatoshisInRange (range: SpendableValueRange): Promise<number | undefined> {
    const storagePrefix = this.storageKey(range.prefix)
    const storageStart = this.storageKey(range.start)
    const storageEnd = this.storageKey(range.end)
    for (const entry of this.db.getRange({ start: storageStart, end: storageEnd, reverse: range.reverse })) {
      const key = String(entry.key)
      if (!key.startsWith(this.namespace) || !key.startsWith(storagePrefix)) continue
      return satoshisFromSpendableValueKey(key.slice(this.namespace.length))
    }
    return undefined
  }

  private async collectOutputIndexDeletes (): Promise<Array<{ type: 'delete', key: string }>> {
    const prefixes = [OUTPUT_SCRIPT_HASH_PREFIX, OUTPUT_SPENDABLE_PREFIX, OUTPUT_SPENDABLE_VALUE_PREFIX, OUTPUT_SPENDABLE_STATUS_VALUE_PREFIX, OUTPUT_OUTPOINT_PREFIX, OUTPUT_TRANSACTION_PREFIX]
    const deletes: Array<{ type: 'delete', key: string }> = []
    for (const prefix of prefixes) {
      const records = await this.scan<RocksDbOutputIndexRecord>({ prefix, limit: Number.MAX_SAFE_INTEGER })
      deletes.push(...records.map(record => ({ type: 'delete' as const, key: record.key })))
    }
    return deletes
  }

  private storageKey (key: string): string {
    return `${this.namespace}${key}`
  }

  private encode<T> (value: T, currentVersion: number | null, updatedAt?: Date | string | number): StoredRocksDbWalletRecord<T> {
    return {
      recordType: 'wallet-toolbox-rocksdb-record',
      schemaVersion: ROCKSDB_WALLET_STORE_SCHEMA_VERSION,
      value,
      version: (currentVersion ?? 0) + 1,
      updated_at: normalizeDate(updatedAt).toISOString()
    }
  }

  private decode<T> (key: string, stored: StoredRocksDbWalletRecord<T>): RocksDbWalletRecord<T> {
    if (stored.recordType !== 'wallet-toolbox-rocksdb-record') {
      throw new Error(`ROCKSDB_WALLET_STORE_RECORD_TYPE_MISMATCH:${key}`)
    }
    if (stored.schemaVersion !== ROCKSDB_WALLET_STORE_SCHEMA_VERSION) {
      const schemaVersion = String((stored as { schemaVersion?: unknown }).schemaVersion ?? 'missing')
      throw new Error(`ROCKSDB_WALLET_STORE_MIGRATION_REQUIRED:${key}:${schemaVersion}`)
    }
    return {
      key,
      value: stored.value,
      version: stored.version,
      updated_at: new Date(stored.updated_at)
    }
  }
}

function normalizeNamespace (value?: string): string {
  const normalized = String(value ?? 'wallet-toolbox').trim().replace(/^!+|!+$/g, '')
  if (normalized === '') throw new Error('ROCKSDB_WALLET_STORE_NAMESPACE_REQUIRED')
  return `${normalized}!`
}

function isDeleteWrite (write: RocksDbWalletPutArgs | { type: 'delete', key: string }): write is { type: 'delete', key: string } {
  return 'type' in write && write.type === 'delete'
}

function normalizeKey (value: string): string {
  const normalized = String(value ?? '').trim()
  if (normalized === '') throw new Error('ROCKSDB_WALLET_STORE_KEY_REQUIRED')
  if (normalized.includes('\0')) throw new Error('ROCKSDB_WALLET_STORE_KEY_INVALID')
  return normalized
}

function normalizeDate (value?: Date | string | number): Date {
  if (value === undefined) return new Date()
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error('ROCKSDB_WALLET_STORE_UPDATED_AT_INVALID')
  return date
}

const OUTPUT_PRIMARY_PREFIX = 'output!id!'
const OUTPUT_SCRIPT_HASH_PREFIX = 'output!scriptHash!'
const OUTPUT_SPENDABLE_PREFIX = 'output!spendable!'
const OUTPUT_SPENDABLE_VALUE_PREFIX = 'output!spendableValue!'
const OUTPUT_SPENDABLE_STATUS_VALUE_PREFIX = 'output!spendableStatusValue!'
const OUTPUT_OUTPOINT_PREFIX = 'output!outpoint!'
const OUTPUT_TRANSACTION_PREFIX = 'output!transaction!'
const UNSUPPORTED_SOURCE_TUNING_OPTIONS = [
  'writeOptions',
  'columnFamilies',
  'writeBufferSize',
  'maxWriteBufferNumber',
  'level0FileNumCompactionTrigger',
  'level0SlowdownWritesTrigger',
  'level0StopWritesTrigger',
  'maxBytesForLevelBase',
  'targetFileSizeBase',
  'maxCompactionBytes',
  'compression',
  'sync'
]

function rejectUnsupportedRocksDbTuningOptions (options: RocksDbWalletStoreOptions): void {
  const runtimeOptions = options as unknown as Record<string, unknown>
  const unsupported = UNSUPPORTED_SOURCE_TUNING_OPTIONS.find(key => runtimeOptions[key] !== undefined)
  if (unsupported !== undefined) throw new Error(`ROCKSDB_WALLET_STORE_UNSUPPORTED_OPTION:${unsupported}`)
}

function outputPrimaryKey (outputId: number): string {
  return `${OUTPUT_PRIMARY_PREFIX}${padNumber(outputId)}`
}

function outputScriptHashPrefix (scriptHash: string): string {
  return `${OUTPUT_SCRIPT_HASH_PREFIX}${scriptHash}!`
}

function outputScriptHashKey (scriptHash: string, outputId: number): string {
  return `${outputScriptHashPrefix(normalizeIndexPart(scriptHash))}${padNumber(outputId)}`
}

function outputSpendableUserPrefix (userId: number): string {
  return `${OUTPUT_SPENDABLE_PREFIX}${padNumber(userId)}!`
}

function outputSpendableAllPrefix (userId: number): string {
  return `${outputSpendableUserPrefix(userId)}all!`
}

function outputSpendableUserKey (userId: number, outputId: number): string {
  return `${outputSpendableAllPrefix(userId)}${padNumber(outputId)}`
}

function outputSpendableBasketPrefix (userId: number, basketId: number): string {
  return `${outputSpendableUserPrefix(userId)}basket!${padNumber(basketId)}!`
}

function outputSpendableBasketKey (userId: number, basketId: number, outputId: number): string {
  return `${outputSpendableBasketPrefix(userId, basketId)}${padNumber(outputId)}`
}

function outputSpendableBasketValuePrefix (userId: number, basketId: number): string {
  return `${OUTPUT_SPENDABLE_VALUE_PREFIX}${padNumber(userId)}!basket!${padNumber(basketId)}!`
}

function outputSpendableBasketValueSatoshisPrefix (userId: number, basketId: number, satoshis: number): string {
  return `${outputSpendableBasketValuePrefix(userId, basketId)}${padNumber(satoshis)}!`
}

function outputSpendableBasketValueKey (userId: number, basketId: number, satoshis: number, outputId: number): string {
  return `${outputSpendableBasketValueSatoshisPrefix(userId, basketId, satoshis)}${padNumber(outputId)}`
}

function outputSpendableBasketStatusPrefix (userId: number, basketId: number, status: string): string {
  return `${OUTPUT_SPENDABLE_STATUS_VALUE_PREFIX}${padNumber(userId)}!basket!${padNumber(basketId)}!status!${normalizeIndexPart(status)}!`
}

function outputSpendableBasketStatusValueSatoshisPrefix (userId: number, basketId: number, status: string, satoshis: number): string {
  return `${outputSpendableBasketStatusPrefix(userId, basketId, status)}${padNumber(satoshis)}!`
}

function outputSpendableBasketStatusValueKey (userId: number, basketId: number, status: string, satoshis: number, outputId: number): string {
  return `${outputSpendableBasketStatusValueSatoshisPrefix(userId, basketId, status, satoshis)}${padNumber(outputId)}`
}

function spendableValueRange (
  userId: number,
  basketId: number,
  mode: SpendableValueReservationMode,
  satoshis: number
): SpendableValueRange {
  const basketPrefix = outputSpendableBasketValuePrefix(userId, basketId)
  if (mode === 'exact') {
    const prefix = outputSpendableBasketValueSatoshisPrefix(userId, basketId, satoshis)
    return { prefix, start: prefix, end: `${prefix}\uffff` }
  }
  if (mode === 'over') {
    return { prefix: basketPrefix, start: `${basketPrefix}${padNumber(satoshis)}`, end: `${basketPrefix}\uffff` }
  }
  return { prefix: basketPrefix, start: `${basketPrefix}${padNumber(satoshis)}`, end: basketPrefix, reverse: true }
}

function spendableStatusValueRange (
  userId: number,
  basketId: number,
  status: string,
  mode: SpendableValueReservationMode,
  satoshis: number
): SpendableValueRange {
  const basketPrefix = outputSpendableBasketStatusPrefix(userId, basketId, status)
  if (mode === 'exact') {
    const prefix = outputSpendableBasketStatusValueSatoshisPrefix(userId, basketId, status, satoshis)
    return { prefix, start: prefix, end: `${prefix}\uffff` }
  }
  if (mode === 'over') {
    return { prefix: basketPrefix, start: `${basketPrefix}${padNumber(satoshis)}`, end: `${basketPrefix}\uffff` }
  }
  return { prefix: basketPrefix, start: `${basketPrefix}${padNumber(satoshis)}`, end: basketPrefix, reverse: true }
}

function spendableValueSeededBucketRanges (
  userId: number,
  basketId: number,
  satoshis: number,
  seed: number,
  reverse: boolean
): SpendableValueRange[] {
  const prefix = outputSpendableBasketValueSatoshisPrefix(userId, basketId, satoshis)
  const seededKey = `${prefix}${padNumber(seed)}`
  if (reverse) {
    return [
      { prefix, start: seededKey, end: prefix, reverse: true },
      { prefix, start: `${prefix}\uffff`, end: seededKey, reverse: true }
    ]
  }
  return [
    { prefix, start: seededKey, end: `${prefix}\uffff` },
    { prefix, start: prefix, end: seededKey }
  ]
}

function spendableStatusValueSeededBucketRanges (
  userId: number,
  basketId: number,
  status: string,
  satoshis: number,
  seed: number,
  reverse: boolean
): SpendableValueRange[] {
  const prefix = outputSpendableBasketStatusValueSatoshisPrefix(userId, basketId, status, satoshis)
  const seededKey = `${prefix}${padNumber(seed)}`
  if (reverse) {
    return [
      { prefix, start: seededKey, end: prefix, reverse: true },
      { prefix, start: `${prefix}\uffff`, end: seededKey, reverse: true }
    ]
  }
  return [
    { prefix, start: seededKey, end: `${prefix}\uffff` },
    { prefix, start: prefix, end: seededKey }
  ]
}

function spendableReservationSeed (transactionId: number): number {
  if (!Number.isSafeInteger(transactionId) || transactionId < 0) return 0
  return transactionId
}

function positiveModulo (value: number, divisor: number): number {
  if (!Number.isSafeInteger(divisor) || divisor <= 0) return 0
  const result = value % divisor
  return result < 0 ? result + divisor : result
}

function satoshisFromSpendableValueKey (key: string): number | undefined {
  if (!key.startsWith(OUTPUT_SPENDABLE_VALUE_PREFIX) && !key.startsWith(OUTPUT_SPENDABLE_STATUS_VALUE_PREFIX)) return undefined
  const parts = key.split('!')
  const raw = key.startsWith(OUTPUT_SPENDABLE_STATUS_VALUE_PREFIX) ? parts[7] : parts[5]
  if (raw == null) return undefined
  const value = Number(raw)
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function outputIdFromSpendableValueKey (key: string): number | undefined {
  if (!key.startsWith(OUTPUT_SPENDABLE_VALUE_PREFIX) && !key.startsWith(OUTPUT_SPENDABLE_STATUS_VALUE_PREFIX)) return undefined
  const parts = key.split('!')
  const raw = parts[parts.length - 1]
  if (raw == null) return undefined
  const value = Number(raw)
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function outputOutpointKey (userId: number, txid: string, vout: number): string {
  return `${OUTPUT_OUTPOINT_PREFIX}${padNumber(userId)}!${normalizeIndexPart(txid)}!${padNumber(vout)}`
}

function outputTransactionPrefix (transactionId: number): string {
  return `${OUTPUT_TRANSACTION_PREFIX}${padNumber(transactionId)}!`
}

function outputTransactionKey (transactionId: number, outputId: number): string {
  return `${outputTransactionPrefix(transactionId)}${padNumber(outputId)}`
}

function normalizeIndexPart (value: string): string {
  const normalized = String(value ?? '').trim()
  if (normalized === '' || normalized.includes('!') || normalized.includes('\0')) {
    throw new Error('ROCKSDB_WALLET_STORE_INDEX_PART_INVALID')
  }
  return normalized
}

function padNumber (value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('ROCKSDB_WALLET_STORE_INDEX_NUMBER_INVALID')
  return value.toString().padStart(16, '0')
}

async function openRocksDatabase (
  dbPath: string,
  options: Pick<
  RocksDatabaseOptions,
  | 'encoding'
  | 'parallelismThreads'
  | 'disableWAL'
  | 'enableStats'
  | 'noBlockCache'
  | 'pessimistic'
  | 'readOnly'
  | 'statsLevel'
  | 'transactionLogMaxAgeThreshold'
  | 'transactionLogMaxSize'
  | 'transactionLogRetention'
  | 'transactionLogsPath'
  >,
  config: RocksDatabaseRuntimeConfig = {}
): Promise<RocksDatabase> {
  const { RocksDatabase } = await importRocksDbJs()
  if (config.blockCacheSize !== undefined || config.compactOnClose !== undefined) {
    RocksDatabase.config(config)
  }
  return RocksDatabase.open(dbPath, options)
}

async function importRocksDbJs (): Promise<RocksDbJsModule> {
  return requireRocksDbJs()
}

function requireRocksDbJs (): RocksDbJsModule {
  const originalDefineProperty = Object.defineProperty
  const patchedDefineProperty = ((
    target: object,
    propertyKey: PropertyKey,
    attributes: PropertyDescriptor
  ): object => {
    if (propertyKey === 'query') {
      const existing = Object.getOwnPropertyDescriptor(target, propertyKey)
      if (existing != null && existing.configurable === false && typeof attributes.value === 'function') {
        return target
      }
    }
    return originalDefineProperty(target, propertyKey, attributes)
  }) as typeof Object.defineProperty

  Object.defineProperty = patchedDefineProperty
  try {
    return nativeRequire('@harperfast/rocksdb-js') as RocksDbJsModule
  } finally {
    Object.defineProperty = originalDefineProperty
  }
}
