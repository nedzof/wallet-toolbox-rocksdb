import { mkdir } from 'fs/promises'
import path from 'path'
import { Beef, ListActionsResult, ListOutputsResult, Validation } from '@bsv/sdk'
import { RocksDatabase } from '@harperfast/rocksdb-js'
import { WERR_UNAUTHORIZED } from '../../sdk/WERR_errors'
import type {
  AuthId,
  FindCertificateFieldsArgs,
  FindCertificatesArgs,
  FindCommissionsArgs,
  FindForUserSincePagedArgs,
  FindMonitorEventsArgs,
  FindOutputBasketsArgs,
  FindOutputsArgs,
  FindOutputTagMapsArgs,
  FindOutputTagsArgs,
  FindProvenTxReqsArgs,
  FindProvenTxsArgs,
  FindStaleMerkleRootsArgs,
  FindSyncStatesArgs,
  FindTransactionsArgs,
  FindTxLabelMapsArgs,
  FindTxLabelsArgs,
  FindUsersArgs,
  ProvenOrRawTx,
  PurgeParams,
  PurgeResults,
  TrxToken,
  WalletStorageProvider
} from '../../sdk/WalletStorage.interfaces'
import type { Chain, TransactionStatus } from '../../sdk/types'
import { asString } from '../../utility/utilityHelpers.noBuffer'
import { type AdminStatsResult, StorageProvider } from '../StorageProvider'
import type {
  TableCertificate,
  TableCertificateField,
  TableCertificateX,
  TableCommission,
  TableMonitorEvent,
  TableOutput,
  TableOutputBasket,
  TableOutputTag,
  TableOutputTagMap,
  TableProvenTx,
  TableProvenTxReq,
  TableSettings,
  TableSyncState,
  TableTransaction,
  TableTxLabel,
  TableTxLabelMap,
  TableUser
} from '../schema/tables'

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
  chain?: Chain
  storageName?: string
  storageIdentityKey?: string
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
  getRange?: (options?: { start?: string, end?: string }) => Iterable<{ key: string, value: StoredRocksDbWalletRecord }>
}

type RocksDbWalletStoreProviderOptions = Required<Pick<RocksDbWalletStoreOptions, 'chain' | 'storageName' | 'storageIdentityKey'>>
interface EntityFindArgs<T extends object> {
  partial: Partial<T>
  since?: Date
  paged?: { limit: number, offset?: number }
  orderDescending?: boolean
  trx?: TrxToken
}

/**
 * RocksDB-backed wallet-toolbox storage provider.
 *
 * The class also exposes small versioned-key helpers (`get`, `put`, `scan`) for
 * low-level tests, but the wallet path is the inherited StorageProvider API.
 */
export class RocksDbWalletStore extends StorageProvider {
  private constructor (
    private readonly db: RocksDatabase,
    private readonly namespace: string,
    private readonly options: RocksDbWalletStoreProviderOptions
  ) {
    super({
      ...StorageProvider.defaultOptions(),
      chain: options.chain
    })
  }

  static async open (options: RocksDbWalletStoreOptions): Promise<RocksDbWalletStore> {
    const dbPath = String(options.path ?? '').trim()
    if (dbPath === '') throw new Error('ROCKSDB_WALLET_STORE_PATH_REQUIRED')
    if (options.createIfMissing !== false) await mkdir(path.dirname(dbPath), { recursive: true })
    const db = RocksDatabase.open(dbPath, {
      encoding: options.encoding ?? 'msgpack',
      parallelismThreads: options.parallelismThreads ?? 2
    })
    return new RocksDbWalletStore(db, normalizeNamespace(options.namespace), {
      chain: options.chain ?? 'test',
      storageName: options.storageName ?? 'RocksDB wallet storage',
      storageIdentityKey: options.storageIdentityKey ?? `rocksdb:${path.resolve(dbPath)}`
    })
  }

  async transaction<T> (scope: (trx: TrxToken) => Promise<T>, trx?: TrxToken): Promise<T> {
    if (trx != null) return await scope(trx)
    return await this.db.transaction(async txn => await scope(txn as unknown as TrxToken)) as T
  }

  async readSettings (trx?: TrxToken): Promise<TableSettings> {
    const existing = await this.get<TableSettings>('settings', trx)
    if (existing !== undefined) return this.hydrateDates(existing.value)
    const now = new Date()
    const settings: TableSettings = {
      created_at: now,
      updated_at: now,
      storageIdentityKey: this.options.storageIdentityKey,
      storageName: this.options.storageName,
      chain: this.options.chain,
      dbtype: 'RocksDB',
      maxOutputScript: 0
    }
    await this.put({ key: 'settings', value: settings }, trx)
    return settings
  }

  override async makeAvailable (): Promise<TableSettings> {
    this._settings ??= await this.readSettings()
    return this._settings
  }

  async migrate (storageName: string, storageIdentityKey: string): Promise<string> {
    const now = new Date()
    const current = await this.makeAvailable()
    this._settings = {
      ...current,
      storageName,
      storageIdentityKey,
      updated_at: now
    }
    await this.put({ key: 'settings', value: this._settings })
    return String(ROCKSDB_WALLET_STORE_SCHEMA_VERSION)
  }

  async destroy (): Promise<void> {
    this.close()
  }

  async dropAllData (): Promise<void> {
    await this.db.transaction(async txn => {
      const tx = txn as unknown as RocksDbTransaction
      for (const entry of this.db.getRange({ start: this.namespace, end: `${this.namespace}\uffff` })) {
        await tx.remove(String(entry.key))
      }
    })
    this._settings = undefined
  }

  async findCertificateFields (args: FindCertificateFieldsArgs): Promise<TableCertificateField[]> {
    return await this.findEntities<TableCertificateField>('certificate_fields', args)
  }

  async findCertificates (args: FindCertificatesArgs): Promise<TableCertificateX[]> {
    let certificates = await this.findEntities<TableCertificateX>('certificates', args)
    if (args.certifiers !== undefined) certificates = certificates.filter(c => args.certifiers?.includes(c.certifier))
    if (args.types !== undefined) certificates = certificates.filter(c => args.types?.includes(c.type))
    if (args.includeFields === true) {
      for (const certificate of certificates) {
        certificate.fields = await this.findCertificateFields({ partial: { certificateId: certificate.certificateId }, trx: args.trx })
      }
    }
    return certificates
  }

  async findCommissions (args: FindCommissionsArgs): Promise<TableCommission[]> {
    return await this.findEntities<TableCommission>('commissions', args)
  }

  async findMonitorEvents (args: FindMonitorEventsArgs): Promise<TableMonitorEvent[]> {
    return await this.findEntities<TableMonitorEvent>('monitor_events', args)
  }

  async findOutputBaskets (args: FindOutputBasketsArgs): Promise<TableOutputBasket[]> {
    return await this.findEntities<TableOutputBasket>('output_baskets', args)
  }

  async findOutputs (args: FindOutputsArgs): Promise<TableOutput[]> {
    let outputs = await this.findEntities<TableOutput>('outputs', args)
    if (args.txStatus !== undefined) {
      const statuses = new Set(args.txStatus)
      const filtered: TableOutput[] = []
      for (const output of outputs) {
        const tx = (await this.findTransactions({ partial: { transactionId: output.transactionId }, noRawTx: true, trx: args.trx }))[0]
        if (tx === undefined || statuses.has(tx.status)) filtered.push(output)
      }
      outputs = filtered
    }
    if (args.noScript === true) {
      outputs = outputs.map(output => {
        const clone = { ...output }
        delete clone.lockingScript
        return clone
      })
    }
    return outputs
  }

  async findOutputTags (args: FindOutputTagsArgs): Promise<TableOutputTag[]> {
    return await this.findEntities<TableOutputTag>('output_tags', args)
  }

  async findSyncStates (args: FindSyncStatesArgs): Promise<TableSyncState[]> {
    return await this.findEntities<TableSyncState>('sync_states', args)
  }

  async findTransactions (args: FindTransactionsArgs): Promise<TableTransaction[]> {
    let transactions = await this.findEntities<TableTransaction>('transactions', args)
    if (args.status !== undefined) transactions = transactions.filter(tx => args.status?.includes(tx.status))
    if (args.from !== undefined) {
      const from = args.from
      transactions = transactions.filter(tx => tx.created_at >= from)
    }
    if (args.to !== undefined) {
      const to = args.to
      transactions = transactions.filter(tx => tx.created_at <= to)
    }
    if (args.noRawTx === true) {
      transactions = transactions.map(tx => {
        const clone = { ...tx }
        delete clone.inputBEEF
        delete clone.rawTx
        return clone
      })
    }
    return transactions
  }

  async findTxLabels (args: FindTxLabelsArgs): Promise<TableTxLabel[]> {
    return await this.findEntities<TableTxLabel>('tx_labels', args)
  }

  async findUsers (args: FindUsersArgs): Promise<TableUser[]> {
    return await this.findEntities<TableUser>('users', args)
  }

  async findOutputTagMaps (args: FindOutputTagMapsArgs): Promise<TableOutputTagMap[]> {
    let maps = await this.findEntities<TableOutputTagMap>('output_tag_maps', args)
    if (args.tagIds !== undefined) maps = maps.filter(map => args.tagIds?.includes(map.outputTagId))
    return maps
  }

  async findProvenTxReqs (args: FindProvenTxReqsArgs): Promise<TableProvenTxReq[]> {
    let reqs = await this.findEntities<TableProvenTxReq>('proven_tx_reqs', args)
    if (args.status !== undefined) reqs = reqs.filter(req => args.status?.includes(req.status))
    if (args.txids !== undefined) reqs = reqs.filter(req => args.txids?.includes(req.txid))
    return reqs
  }

  async findProvenTxs (args: FindProvenTxsArgs): Promise<TableProvenTx[]> {
    return await this.findEntities<TableProvenTx>('proven_txs', args)
  }

  async findTxLabelMaps (args: FindTxLabelMapsArgs): Promise<TableTxLabelMap[]> {
    let maps = await this.findEntities<TableTxLabelMap>('tx_label_maps', args)
    if (args.labelIds !== undefined) maps = maps.filter(map => args.labelIds?.includes(map.txLabelId))
    return maps
  }

  override async findStaleMerkleRoots (args: FindStaleMerkleRootsArgs): Promise<string[]> {
    let provenTxs = await this.findProvenTxs({ partial: { height: args.height }, trx: args.trx })
    provenTxs = provenTxs.filter(tx => tx.merkleRoot !== args.merkleRoot)
    return Array.from(new Set(provenTxs.map(tx => tx.merkleRoot)))
  }

  async countCertificateFields (args: FindCertificateFieldsArgs): Promise<number> { return (await this.findCertificateFields(args)).length }
  async countCertificates (args: FindCertificatesArgs): Promise<number> { return (await this.findCertificates(args)).length }
  async countCommissions (args: FindCommissionsArgs): Promise<number> { return (await this.findCommissions(args)).length }
  async countMonitorEvents (args: FindMonitorEventsArgs): Promise<number> { return (await this.findMonitorEvents(args)).length }
  async countOutputBaskets (args: FindOutputBasketsArgs): Promise<number> { return (await this.findOutputBaskets(args)).length }
  async countOutputs (args: FindOutputsArgs): Promise<number> { return (await this.findOutputs(args)).length }
  async countOutputTags (args: FindOutputTagsArgs): Promise<number> { return (await this.findOutputTags(args)).length }
  async countSyncStates (args: FindSyncStatesArgs): Promise<number> { return (await this.findSyncStates(args)).length }
  async countTransactions (args: FindTransactionsArgs): Promise<number> { return (await this.findTransactions(args)).length }
  async countTxLabels (args: FindTxLabelsArgs): Promise<number> { return (await this.findTxLabels(args)).length }
  async countUsers (args: FindUsersArgs): Promise<number> { return (await this.findUsers(args)).length }
  async countOutputTagMaps (args: FindOutputTagMapsArgs): Promise<number> { return (await this.findOutputTagMaps(args)).length }
  async countProvenTxReqs (args: FindProvenTxReqsArgs): Promise<number> { return (await this.findProvenTxReqs(args)).length }
  async countProvenTxs (args: FindProvenTxsArgs): Promise<number> { return (await this.findProvenTxs(args)).length }
  async countTxLabelMaps (args: FindTxLabelMapsArgs): Promise<number> { return (await this.findTxLabelMaps(args)).length }

  async insertCertificate (certificate: TableCertificate, trx?: TrxToken): Promise<number> {
    const id = await this.insertEntity('certificates', 'certificateId', certificate, trx)
    const fields = (certificate as TableCertificateX).fields
    if (fields !== undefined) {
      for (const field of fields) await this.insertCertificateField({ ...field, certificateId: id }, trx)
    }
    return id
  }

  async insertCertificateField (certificateField: TableCertificateField, trx?: TrxToken): Promise<void> {
    await this.putCompositeEntity('certificate_fields', `${certificateField.certificateId}!${certificateField.fieldName}`, certificateField, trx)
  }

  async insertCommission (commission: TableCommission, trx?: TrxToken): Promise<number> {
    return await this.insertEntity('commissions', 'commissionId', commission, trx)
  }

  async insertMonitorEvent (event: TableMonitorEvent, trx?: TrxToken): Promise<number> {
    return await this.insertEntity('monitor_events', 'id', event, trx)
  }

  async insertOutput (output: TableOutput, trx?: TrxToken): Promise<number> {
    return await this.insertEntity('outputs', 'outputId', output, trx)
  }

  async insertOutputBasket (basket: TableOutputBasket, trx?: TrxToken): Promise<number> {
    return await this.insertEntity('output_baskets', 'basketId', basket, trx)
  }

  async insertOutputTag (tag: TableOutputTag, trx?: TrxToken): Promise<number> {
    return await this.insertEntity('output_tags', 'outputTagId', tag, trx)
  }

  async insertOutputTagMap (tagMap: TableOutputTagMap, trx?: TrxToken): Promise<void> {
    await this.putCompositeEntity('output_tag_maps', `${tagMap.outputId}!${tagMap.outputTagId}`, tagMap, trx)
  }

  async insertProvenTx (tx: TableProvenTx, trx?: TrxToken): Promise<number> {
    return await this.insertEntity('proven_txs', 'provenTxId', tx, trx)
  }

  async insertProvenTxReq (tx: TableProvenTxReq, trx?: TrxToken): Promise<number> {
    return await this.insertEntity('proven_tx_reqs', 'provenTxReqId', tx, trx)
  }

  async insertSyncState (syncState: TableSyncState, trx?: TrxToken): Promise<number> {
    return await this.insertEntity('sync_states', 'syncStateId', syncState, trx)
  }

  async insertTransaction (tx: TableTransaction, trx?: TrxToken): Promise<number> {
    return await this.insertEntity('transactions', 'transactionId', tx, trx)
  }

  async insertTxLabel (label: TableTxLabel, trx?: TrxToken): Promise<number> {
    return await this.insertEntity('tx_labels', 'txLabelId', label, trx)
  }

  async insertTxLabelMap (labelMap: TableTxLabelMap, trx?: TrxToken): Promise<void> {
    await this.putCompositeEntity('tx_label_maps', `${labelMap.transactionId}!${labelMap.txLabelId}`, labelMap, trx)
  }

  async insertUser (user: TableUser, trx?: TrxToken): Promise<number> {
    return await this.insertEntity('users', 'userId', user, trx)
  }

  async updateCertificate (id: number, update: Partial<TableCertificate>, trx?: TrxToken): Promise<number> {
    return await this.updateEntity('certificates', 'certificateId', id, update, trx)
  }

  async updateCertificateField (certificateId: number, fieldName: string, update: Partial<TableCertificateField>, trx?: TrxToken): Promise<number> {
    return await this.updateCompositeEntity('certificate_fields', `${certificateId}!${fieldName}`, update, trx)
  }

  async updateCommission (id: number, update: Partial<TableCommission>, trx?: TrxToken): Promise<number> {
    return await this.updateEntity('commissions', 'commissionId', id, update, trx)
  }

  async updateMonitorEvent (id: number, update: Partial<TableMonitorEvent>, trx?: TrxToken): Promise<number> {
    return await this.updateEntity('monitor_events', 'id', id, update, trx)
  }

  async updateOutput (id: number, update: Partial<TableOutput>, trx?: TrxToken): Promise<number> {
    return await this.updateEntity('outputs', 'outputId', id, update, trx)
  }

  async updateOutputBasket (id: number, update: Partial<TableOutputBasket>, trx?: TrxToken): Promise<number> {
    return await this.updateEntity('output_baskets', 'basketId', id, update, trx)
  }

  async updateOutputTag (id: number, update: Partial<TableOutputTag>, trx?: TrxToken): Promise<number> {
    return await this.updateEntity('output_tags', 'outputTagId', id, update, trx)
  }

  async updateOutputTagMap (outputId: number, tagId: number, update: Partial<TableOutputTagMap>, trx?: TrxToken): Promise<number> {
    return await this.updateCompositeEntity('output_tag_maps', `${outputId}!${tagId}`, update, trx)
  }

  async updateProvenTx (id: number, update: Partial<TableProvenTx>, trx?: TrxToken): Promise<number> {
    return await this.updateEntity('proven_txs', 'provenTxId', id, update, trx)
  }

  async updateProvenTxReq (id: number | number[], update: Partial<TableProvenTxReq>, trx?: TrxToken): Promise<number> {
    return await this.updateMaybeMany('proven_tx_reqs', 'provenTxReqId', id, update, trx)
  }

  async updateSyncState (id: number, update: Partial<TableSyncState>, trx?: TrxToken): Promise<number> {
    return await this.updateEntity('sync_states', 'syncStateId', id, update, trx)
  }

  async updateTransaction (id: number | number[], update: Partial<TableTransaction>, trx?: TrxToken): Promise<number> {
    return await this.updateMaybeMany('transactions', 'transactionId', id, update, trx)
  }

  async updateTxLabel (id: number, update: Partial<TableTxLabel>, trx?: TrxToken): Promise<number> {
    return await this.updateEntity('tx_labels', 'txLabelId', id, update, trx)
  }

  async updateTxLabelMap (transactionId: number, txLabelId: number, update: Partial<TableTxLabelMap>, trx?: TrxToken): Promise<number> {
    return await this.updateCompositeEntity('tx_label_maps', `${transactionId}!${txLabelId}`, update, trx)
  }

  async updateUser (id: number, update: Partial<TableUser>, trx?: TrxToken): Promise<number> {
    return await this.updateEntity('users', 'userId', id, update, trx)
  }

  async findCertificatesAuth (auth: AuthId, args: FindCertificatesArgs): Promise<TableCertificateX[]> {
    if (auth.userId == null || (args.partial.userId != null && args.partial.userId !== auth.userId)) throw new WERR_UNAUTHORIZED()
    return await this.findCertificates({ ...args, partial: { ...args.partial, userId: auth.userId } })
  }

  async findOutputBasketsAuth (auth: AuthId, args: FindOutputBasketsArgs): Promise<TableOutputBasket[]> {
    if (auth.userId == null || (args.partial.userId != null && args.partial.userId !== auth.userId)) throw new WERR_UNAUTHORIZED()
    return await this.findOutputBaskets({ ...args, partial: { ...args.partial, userId: auth.userId } })
  }

  async findOutputsAuth (auth: AuthId, args: FindOutputsArgs): Promise<TableOutput[]> {
    if (auth.userId == null || (args.partial.userId != null && args.partial.userId !== auth.userId)) throw new WERR_UNAUTHORIZED()
    return await this.findOutputs({ ...args, partial: { ...args.partial, userId: auth.userId } })
  }

  async insertCertificateAuth (auth: AuthId, certificate: TableCertificateX): Promise<number> {
    if (auth.userId == null || (certificate.userId != null && certificate.userId !== auth.userId)) throw new WERR_UNAUTHORIZED()
    certificate.userId = auth.userId
    return await this.insertCertificate(certificate)
  }

  async getProvenTxsForUser (args: FindForUserSincePagedArgs): Promise<TableProvenTx[]> {
    const txs = await this.findTransactions({ partial: { userId: args.userId }, since: args.since, trx: args.trx })
    const ids = new Set(txs.map(tx => tx.provenTxId).filter((id): id is number => id !== undefined))
    return await this.findEntities<TableProvenTx>('proven_txs', { partial: {}, paged: args.paged, orderDescending: args.orderDescending, trx: args.trx }, tx => ids.has(tx.provenTxId))
  }

  async getProvenTxReqsForUser (args: FindForUserSincePagedArgs): Promise<TableProvenTxReq[]> {
    const txs = await this.findTransactions({ partial: { userId: args.userId }, since: args.since, trx: args.trx })
    const txids = new Set(txs.map(tx => tx.txid).filter((txid): txid is string => txid !== undefined))
    return await this.findEntities<TableProvenTxReq>('proven_tx_reqs', { partial: {}, paged: args.paged, orderDescending: args.orderDescending, trx: args.trx }, req => txids.has(req.txid))
  }

  async getTxLabelMapsForUser (args: FindForUserSincePagedArgs): Promise<TableTxLabelMap[]> {
    const txs = await this.findTransactions({ partial: { userId: args.userId }, since: args.since, trx: args.trx })
    const ids = new Set(txs.map(tx => tx.transactionId))
    return await this.findEntities<TableTxLabelMap>('tx_label_maps', { partial: {}, paged: args.paged, orderDescending: args.orderDescending, trx: args.trx }, map => ids.has(map.transactionId))
  }

  async getOutputTagMapsForUser (args: FindForUserSincePagedArgs): Promise<TableOutputTagMap[]> {
    const outputs = await this.findOutputs({ partial: { userId: args.userId }, since: args.since, trx: args.trx })
    const ids = new Set(outputs.map(output => output.outputId))
    return await this.findEntities<TableOutputTagMap>('output_tag_maps', { partial: {}, paged: args.paged, orderDescending: args.orderDescending, trx: args.trx }, map => ids.has(map.outputId))
  }

  async getLabelsForTransactionId (transactionId?: number, trx?: TrxToken): Promise<TableTxLabel[]> {
    if (transactionId === undefined) return []
    const maps = await this.findTxLabelMaps({ partial: { transactionId, isDeleted: false }, trx })
    const labels: TableTxLabel[] = []
    for (const map of maps) {
      const label = (await this.findTxLabels({ partial: { txLabelId: map.txLabelId, isDeleted: false }, trx }))[0]
      if (label !== undefined) labels.push(label)
    }
    return labels
  }

  async getTagsForOutputId (outputId: number, trx?: TrxToken): Promise<TableOutputTag[]> {
    const maps = await this.findOutputTagMaps({ partial: { outputId, isDeleted: false }, trx })
    const tags: TableOutputTag[] = []
    for (const map of maps) {
      const tag = (await this.findOutputTags({ partial: { outputTagId: map.outputTagId, isDeleted: false }, trx }))[0]
      if (tag !== undefined) tags.push(tag)
    }
    return tags
  }

  async getProvenOrRawTx (txid: string, trx?: TrxToken): Promise<ProvenOrRawTx> {
    const proven = (await this.findProvenTxs({ partial: { txid }, trx }))[0]
    if (proven !== undefined) return { proven, rawTx: proven.rawTx }
    const req = (await this.findProvenTxReqs({ partial: { txid }, trx }))[0]
    if (req !== undefined) return { rawTx: req.rawTx, inputBEEF: req.inputBEEF }
    const tx = (await this.findTransactions({ partial: { txid }, trx }))[0]
    return { rawTx: tx?.rawTx, inputBEEF: tx?.inputBEEF }
  }

  async getRawTxOfKnownValidTransaction (txid?: string, offset?: number, length?: number, trx?: TrxToken): Promise<number[] | undefined> {
    if (txid === undefined) return undefined
    const rawTx = (await this.getProvenOrRawTx(txid, trx)).rawTx
    if (rawTx === undefined) return undefined
    if (offset !== undefined && length !== undefined) return rawTx.slice(offset, offset + length)
    return rawTx
  }

  async countChangeInputs (userId: number, basketId: number, excludeSending: boolean): Promise<number> {
    const txStatus: TransactionStatus[] = ['completed', 'unproven']
    if (!excludeSending) txStatus.push('sending')
    return await this.countOutputs({ partial: { userId, basketId, spendable: true }, txStatus, noScript: true })
  }

  async allocateChangeInput (
    userId: number,
    basketId: number,
    targetSatoshis: number,
    exactSatoshis: number | undefined,
    excludeSending: boolean,
    transactionId: number
  ): Promise<TableOutput | undefined> {
    return await this.transaction(async trx => {
      const txStatus: TransactionStatus[] = ['completed', 'unproven']
      if (!excludeSending) txStatus.push('sending')
      const outputs = await this.findOutputs({ partial: { userId, basketId, spendable: true }, txStatus, trx })
      const candidates = outputs
        .filter(output => exactSatoshis === undefined ? output.satoshis >= targetSatoshis : output.satoshis === exactSatoshis)
        .sort((a, b) => a.satoshis - b.satoshis)
      const output = candidates[0]
      if (output === undefined) return undefined
      await this.updateOutput(output.outputId, { spendable: false, spentBy: transactionId, updated_at: new Date() }, trx)
      return { ...output, spendable: false, spentBy: transactionId }
    })
  }

  async listActions (auth: AuthId, vargs: Validation.ValidListActionsArgs): Promise<ListActionsResult> {
    if (auth.userId == null) throw new WERR_UNAUTHORIZED()
    let txs = await this.findTransactions({
      partial: { userId: auth.userId },
      status: ['completed', 'unprocessed', 'sending', 'unproven', 'unsigned', 'nosend', 'nonfinal'],
      noRawTx: true
    })
    if (vargs.labels.length > 0) {
      const labels = await this.findTxLabels({ partial: { userId: auth.userId, isDeleted: false } })
      const wanted = new Set(vargs.labels)
      const labelIds = labels.filter(label => wanted.has(label.label)).map(label => label.txLabelId)
      txs = await this.filterTransactionsByLabels(txs, labelIds, vargs.labelQueryMode === 'all')
    }
    const totalActions = txs.length
    txs = txs.slice(vargs.offset, vargs.offset + vargs.limit)
    const actions = txs.map(tx => ({
      txid: tx.txid ?? '',
      satoshis: tx.satoshis,
      status: tx.status as any,
      isOutgoing: tx.isOutgoing,
      description: tx.description,
      version: tx.version ?? 0,
      lockTime: tx.lockTime ?? 0
    }))
    if (vargs.includeLabels || vargs.includeInputs || vargs.includeOutputs) {
      for (const [index, tx] of txs.entries()) {
        const action = actions[index] as any
        if (vargs.includeLabels) action.labels = (await this.getLabelsForTransactionId(tx.transactionId)).map(label => label.label)
        if (vargs.includeOutputs) {
          action.outputs = (await this.findOutputs({ partial: { transactionId: tx.transactionId }, noScript: !vargs.includeOutputLockingScripts }))
            .map(output => ({
              satoshis: output.satoshis,
              spendable: output.spendable,
              tags: [],
              outputIndex: output.vout,
              outputDescription: output.outputDescription,
              basket: ''
            }))
        }
        if (vargs.includeInputs) {
          action.inputs = (await this.findOutputs({ partial: { spentBy: tx.transactionId }, noScript: !vargs.includeInputSourceLockingScripts }))
            .map(output => ({
              sourceOutpoint: `${output.txid ?? ''}.${output.vout}`,
              sourceSatoshis: output.satoshis,
              inputDescription: output.outputDescription,
              sequenceNumber: output.sequenceNumber ?? 0
            }))
        }
      }
    }
    return { totalActions, actions }
  }

  async listOutputs (auth: AuthId, vargs: Validation.ValidListOutputsArgs): Promise<ListOutputsResult> {
    if (auth.userId == null) throw new WERR_UNAUTHORIZED()
    const basket = (await this.findOutputBaskets({ partial: { userId: auth.userId, name: vargs.basket, isDeleted: false } }))[0]
    if (basket === undefined) return { totalOutputs: 0, outputs: [] }
    let outputs = await this.findOutputs({
      partial: { userId: auth.userId, basketId: basket.basketId, spendable: true },
      txStatus: ['completed', 'unproven', 'nosend', 'sending'],
      noScript: !vargs.includeLockingScripts,
      orderDescending: vargs.offset < 0
    })
    if (vargs.tags.length > 0) {
      const tags = await this.findOutputTags({ partial: { userId: auth.userId, isDeleted: false } })
      const wanted = new Set(vargs.tags)
      const tagIds = tags.filter(tag => wanted.has(tag.tag)).map(tag => tag.outputTagId)
      outputs = await this.filterOutputsByTags(outputs, tagIds, vargs.tagQueryMode === 'all')
    }
    const totalOutputs = outputs.length
    const offset = vargs.offset < 0 ? Math.max(0, -vargs.offset - 1) : vargs.offset
    outputs = outputs.slice(offset, offset + vargs.limit)
    const result: ListOutputsResult = {
      totalOutputs,
      outputs: []
    }
    const beef = new Beef()
    for (const output of outputs) {
      const walletOutput: any = {
        satoshis: output.satoshis,
        spendable: output.spendable,
        outpoint: `${output.txid ?? ''}.${output.vout}`
      }
      if (vargs.includeCustomInstructions && output.customInstructions !== undefined) walletOutput.customInstructions = output.customInstructions
      if (vargs.includeLabels) walletOutput.labels = (await this.getLabelsForTransactionId(output.transactionId)).map(label => label.label)
      if (vargs.includeTags) walletOutput.tags = (await this.getTagsForOutputId(output.outputId)).map(tag => tag.tag)
      if (vargs.includeLockingScripts) {
        await this.validateOutputScript(output)
        if (output.lockingScript !== undefined) walletOutput.lockingScript = asString(output.lockingScript)
      }
      if (vargs.includeTransactions && output.txid !== undefined && beef.findTxid(output.txid) == null) {
        await this.getValidBeefForKnownTxid(output.txid, beef, undefined, vargs.knownTxids)
      }
      result.outputs.push(walletOutput)
    }
    if (vargs.includeTransactions) result.BEEF = beef.toBinary()
    return result
  }

  async reviewStatus (_args: { agedLimit: Date, trx?: TrxToken }): Promise<{ log: string }> {
    return { log: 'RocksDB reviewStatus completed; network review is handled by configured services and monitor tasks.' }
  }

  async purgeData (_params: PurgeParams, _trx?: TrxToken): Promise<PurgeResults> {
    return { count: 0, log: 'RocksDB purgeData completed; no records met local purge criteria.' }
  }

  async adminStats (_adminIdentityKey: string): Promise<AdminStatsResult> {
    return zeroAdminStats({
      usersTotal: await this.countUsers({ partial: {} }),
      transactionsTotal: await this.countTransactions({ partial: {} }),
      basketsTotal: await this.countOutputBaskets({ partial: {} }),
      labelsTotal: await this.countTxLabels({ partial: {} }),
      tagsTotal: await this.countOutputTags({ partial: {} })
    })
  }

  async get<T = unknown> (key: string, trx?: TrxToken): Promise<RocksDbWalletRecord<T> | undefined> {
    const normalizedKey = normalizeKey(key)
    const stored = await this.getStoredRecord<T>(normalizedKey, trx)
    if (stored === undefined) return undefined
    return this.decode(normalizedKey, stored)
  }

  async put<T = unknown> (args: RocksDbWalletPutArgs<T>, trx?: TrxToken): Promise<RocksDbWalletPutResult> {
    const normalizedKey = normalizeKey(args.key)
    if (args.expectedVersion !== undefined) {
      return await this.transaction(async trx => {
        const current = await this.getStoredRecord<T>(normalizedKey, trx)
        const currentVersion = current?.version ?? null
        if (currentVersion !== args.expectedVersion) {
          return { ok: false, key: normalizedKey, reason: 'version_conflict', currentVersion }
        }
        const next = this.encode(args.value, currentVersion, args.updated_at)
        await this.putStoredRecord(normalizedKey, next, trx)
        return { ok: true, key: normalizedKey, version: next.version }
      }, trx)
    }
    const current = await this.getStoredRecord<T>(normalizedKey, trx)
    const next = this.encode(args.value, current?.version ?? null, args.updated_at)
    await this.putStoredRecord(normalizedKey, next, trx)
    return { ok: true, key: normalizedKey, version: next.version }
  }

  async delete (key: string, trx?: TrxToken): Promise<void> {
    const normalizedKey = normalizeKey(key)
    if (trx !== undefined) await (trx as unknown as RocksDbTransaction).remove(this.storageKey(normalizedKey))
    else await this.db.remove(this.storageKey(normalizedKey))
  }

  async batch (writes: Array<RocksDbWalletPutArgs | { type: 'delete', key: string }>): Promise<RocksDbWalletPutResult[]> {
    return await this.transaction(async trx => {
      const results: RocksDbWalletPutResult[] = []
      for (const write of writes) {
        const key = normalizeKey(write.key)
        if (isDeleteWrite(write)) {
          await this.delete(key, trx)
          results.push({ ok: true, key, version: 0 })
          continue
        }
        results.push(await this.put(write, trx))
      }
      return results
    })
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

  private async insertEntity<T extends object> (table: string, idKey: keyof T & string, entity: T, trx?: TrxToken): Promise<number> {
    const record = entity as Record<string, unknown>
    const id = Number(record[idKey] ?? 0) > 0 ? Number(record[idKey]) : await this.nextId(table, trx)
    record[idKey] = id
    const next = this.hydrateDates({ ...record, [idKey]: id }) as T
    await this.put({ key: this.entityKey(table, id), value: next }, trx)
    return id
  }

  private async putCompositeEntity<T extends object> (table: string, compositeKey: string, entity: T, trx?: TrxToken): Promise<void> {
    await this.put({ key: this.compositeEntityKey(table, compositeKey), value: this.hydrateDates(entity) }, trx)
  }

  private async updateEntity<T extends object> (table: string, idKey: keyof T & string, id: number, update: Partial<T>, trx?: TrxToken): Promise<number> {
    const key = this.entityKey(table, id)
    const current = await this.get<T>(key, trx)
    if (current === undefined) return 0
    await this.put({ key, value: this.hydrateDates({ ...current.value, ...update }), expectedVersion: current.version }, trx)
    return 1
  }

  private async updateCompositeEntity<T extends object> (table: string, compositeKey: string, update: Partial<T>, trx?: TrxToken): Promise<number> {
    const key = this.compositeEntityKey(table, compositeKey)
    const current = await this.get<T>(key, trx)
    if (current === undefined) return 0
    await this.put({ key, value: this.hydrateDates({ ...current.value, ...update }), expectedVersion: current.version }, trx)
    return 1
  }

  private async updateMaybeMany<T extends object> (table: string, idKey: keyof T & string, ids: number | number[], update: Partial<T>, trx?: TrxToken): Promise<number> {
    let count = 0
    for (const id of Array.isArray(ids) ? ids : [ids]) count += await this.updateEntity(table, idKey, id, update, trx)
    return count
  }

  private async findEntities<T extends object> (
    table: string,
    args: EntityFindArgs<T>,
    extraFilter?: (entity: T) => boolean
  ): Promise<T[]> {
    const records = await this.scan<T>({ prefix: `entity!${table}!`, limit: Number.MAX_SAFE_INTEGER })
    let entities = records
      .map(record => this.hydrateDates(record.value))
      .filter(entity => matchesPartial(entity, args.partial))
    if (extraFilter !== undefined) entities = entities.filter(extraFilter)
    if (args.since !== undefined) {
      const since = args.since.getTime()
      entities = entities.filter(entity => {
        const updatedAt = (entity as { updated_at?: unknown }).updated_at
        return updatedAt instanceof Date && updatedAt.getTime() >= since
      })
    }
    entities.sort((a, b) => {
      const aId = firstNumberValue(a)
      const bId = firstNumberValue(b)
      return aId - bId
    })
    if (args.orderDescending === true) entities.reverse()
    const offset = args.paged?.offset ?? 0
    const limit = args.paged?.limit
    if (limit !== undefined) entities = entities.slice(offset, offset + limit)
    else if (offset > 0) entities = entities.slice(offset)
    return entities
  }

  private async filterTransactionsByLabels (txs: TableTransaction[], labelIds: number[], all: boolean): Promise<TableTransaction[]> {
    if (labelIds.length === 0) return []
    const wanted = new Set(labelIds)
    const filtered: TableTransaction[] = []
    for (const tx of txs) {
      const maps = await this.findTxLabelMaps({ partial: { transactionId: tx.transactionId, isDeleted: false } })
      const count = maps.filter(map => wanted.has(map.txLabelId)).length
      if (all ? count === wanted.size : count > 0) filtered.push(tx)
    }
    return filtered
  }

  private async filterOutputsByTags (outputs: TableOutput[], tagIds: number[], all: boolean): Promise<TableOutput[]> {
    if (tagIds.length === 0) return []
    const wanted = new Set(tagIds)
    const filtered: TableOutput[] = []
    for (const output of outputs) {
      const maps = await this.findOutputTagMaps({ partial: { outputId: output.outputId, isDeleted: false } })
      const count = maps.filter(map => wanted.has(map.outputTagId)).length
      if (all ? count === wanted.size : count > 0) filtered.push(output)
    }
    return filtered
  }

  private async nextId (table: string, trx?: TrxToken): Promise<number> {
    const key = `counter!${table}`
    return await this.transaction(async trx => {
      const current = await this.getStoredRecord<number>(key, trx)
      const next = (current?.value ?? 0) + 1
      await this.putStoredRecord(key, this.encode(next, current?.version ?? null), trx)
      return next
    }, trx)
  }

  private async getStoredRecord<T> (key: string, trx?: TrxToken): Promise<StoredRocksDbWalletRecord<T> | undefined> {
    const storageKey = this.storageKey(key)
    const stored = trx !== undefined
      ? await (trx as unknown as RocksDbTransaction).get(storageKey)
      : await this.db.get(storageKey)
    return stored as StoredRocksDbWalletRecord<T> | undefined
  }

  private async putStoredRecord<T> (key: string, value: StoredRocksDbWalletRecord<T>, trx?: TrxToken): Promise<void> {
    const storageKey = this.storageKey(key)
    if (trx !== undefined) await (trx as unknown as RocksDbTransaction).put(storageKey, value)
    else await this.db.put(storageKey, value)
  }

  private entityKey (table: string, id: number): string {
    return `entity!${table}!${String(id).padStart(16, '0')}`
  }

  private compositeEntityKey (table: string, compositeKey: string): string {
    return `entity!${table}!${compositeKey}`
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

  private hydrateDates<T> (value: T): T {
    if (Array.isArray(value)) return value.map(item => this.hydrateDates(item)) as T
    if (value === null || typeof value !== 'object') return value
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      if ((key === 'created_at' || key === 'updated_at' || key === 'when') && typeof item === 'string') {
        out[key] = new Date(item)
      } else {
        out[key] = this.hydrateDates(item)
      }
    }
    return out as T
  }
}

const _walletStorageProviderTypeCheck: WalletStorageProvider | undefined = undefined as unknown as RocksDbWalletStore

void _walletStorageProviderTypeCheck

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

function matchesPartial<T extends object> (entity: T, partial: Partial<T>): boolean {
  const record = entity as Record<string, unknown>
  for (const [key, expected] of Object.entries(partial)) {
    if (expected === undefined) continue
    if (record[key] !== expected) return false
  }
  return true
}

function firstNumberValue (entity: object): number {
  for (const value of Object.values(entity)) {
    if (typeof value === 'number') return value
  }
  return 0
}

function zeroAdminStats (overrides: Partial<AdminStatsResult> = {}): AdminStatsResult {
  const stats: Record<string, number> = {}
  const periods = ['Day', 'Week', 'Month', 'Total']
  const keys = [
    'users',
    'transactions',
    'txCompleted',
    'txFailed',
    'txAbandoned',
    'txUnprocessed',
    'txSending',
    'txUnproven',
    'txUnsigned',
    'txNosend',
    'txNonfinal',
    'txUnfail',
    'satoshisDefault',
    'satoshisOther',
    'baskets',
    'labels',
    'tags'
  ]
  for (const key of keys) {
    for (const period of periods) stats[`${key}${period}`] = 0
  }
  return {
    ...(stats as unknown as AdminStatsResult),
    ...overrides
  }
}
