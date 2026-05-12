import { mkdir } from 'fs/promises'
import path from 'path'
import { RocksDatabase } from '@harperfast/rocksdb-js'

export const ROCKSDB_WALLET_STORE_SCHEMA_VERSION = 1 as const

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

export interface RocksDbWalletStoreOptions {
  path: string
  namespace?: string
  createIfMissing?: boolean
  encoding?: 'msgpack' | 'ordered-binary' | 'binary' | false
  parallelismThreads?: number
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

/**
 * RocksDB-backed wallet state store for the wallet-toolbox fork.
 *
 * This is intentionally a small storage primitive first: it provides durable
 * versioned records, compare-and-set writes, prefix scans, and transaction
 * backed batches. Full WalletStorageProvider integration should build on this
 * class without changing signer or BRC-100 wallet APIs.
 */
export class RocksDbWalletStore {
  private constructor (
    private readonly db: RocksDatabase,
    private readonly namespace: string
  ) {}

  static async open (options: RocksDbWalletStoreOptions): Promise<RocksDbWalletStore> {
    const dbPath = String(options.path ?? '').trim()
    if (dbPath === '') throw new Error('ROCKSDB_WALLET_STORE_PATH_REQUIRED')
    if (options.createIfMissing !== false) await mkdir(path.dirname(dbPath), { recursive: true })
    const db = RocksDatabase.open(dbPath, {
      encoding: options.encoding ?? 'msgpack',
      parallelismThreads: options.parallelismThreads ?? 2
    })
    return new RocksDbWalletStore(db, normalizeNamespace(options.namespace))
  }

  async get<T = unknown> (key: string): Promise<RocksDbWalletRecord<T> | undefined> {
    const normalizedKey = normalizeKey(key)
    const stored = await this.db.get(this.storageKey(normalizedKey)) as StoredRocksDbWalletRecord<T> | undefined
    if (stored === undefined) return undefined
    return this.decode(normalizedKey, stored)
  }

  async put<T = unknown> (args: RocksDbWalletPutArgs<T>): Promise<RocksDbWalletPutResult> {
    const normalizedKey = normalizeKey(args.key)
    const storageKey = this.storageKey(normalizedKey)
    if (args.expectedVersion !== undefined) {
      return await this.db.transaction(async txn => {
        const current = await (txn as unknown as RocksDbTransaction).get(storageKey)
        const currentVersion = current?.version ?? null
        if (currentVersion !== args.expectedVersion) {
          return { ok: false, key: normalizedKey, reason: 'version_conflict', currentVersion }
        }
        const next = this.encode(args.value, currentVersion, args.updated_at)
        await (txn as unknown as RocksDbTransaction).put(storageKey, next)
        return { ok: true, key: normalizedKey, version: next.version }
      }) as RocksDbWalletPutResult
    }
    const current = await this.db.get(storageKey) as StoredRocksDbWalletRecord<T> | undefined
    const next = this.encode(args.value, current?.version ?? null, args.updated_at)
    await this.db.put(storageKey, next)
    return { ok: true, key: normalizedKey, version: next.version }
  }

  async delete (key: string): Promise<void> {
    await this.db.remove(this.storageKey(normalizeKey(key)))
  }

  async batch (writes: Array<RocksDbWalletPutArgs | { type: 'delete', key: string }>): Promise<RocksDbWalletPutResult[]> {
    return await this.db.transaction(async txn => {
      const results: RocksDbWalletPutResult[] = []
      const tx = txn as unknown as RocksDbTransaction
      for (const write of writes) {
        const key = normalizeKey(write.key)
        const storageKey = this.storageKey(key)
        if (isDeleteWrite(write)) {
          await tx.remove(storageKey)
          results.push({ ok: true, key, version: 0 })
          continue
        }
        const current = await tx.get(storageKey)
        const currentVersion = current?.version ?? null
        if (write.expectedVersion !== undefined && currentVersion !== write.expectedVersion) {
          results.push({ ok: false, key, reason: 'version_conflict', currentVersion })
          continue
        }
        const next = this.encode(write.value, currentVersion, write.updated_at)
        await tx.put(storageKey, next)
        results.push({ ok: true, key, version: next.version })
      }
      return results
    }) as RocksDbWalletPutResult[]
  }

  async scan<T = unknown> (args: RocksDbWalletScanArgs): Promise<Array<RocksDbWalletRecord<T>>> {
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
  }

  async flush (): Promise<void> {
    await this.db.flush()
  }

  close (): void {
    this.db.close()
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
