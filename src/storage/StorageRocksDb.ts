import { ListActionsResult, ListOutputsResult, Validation } from '@bsv/sdk'
import {
  matchesCertificateFieldPartial,
  matchesCertificatePartial,
  matchesCommissionPartial,
  matchesMonitorEventPartial,
  matchesOutputBasketPartial,
  matchesOutputPartial,
  matchesOutputTagMapPartial,
  matchesOutputTagPartial,
  matchesProvenTxPartial,
  matchesProvenTxReqPartial,
  matchesSyncStatePartial,
  matchesTransactionPartial,
  matchesTxLabelMapPartial,
  matchesTxLabelPartial
} from './idbHelpers'
import {
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
} from './schema/tables'
import { StorageProvider, StorageProviderOptions } from './StorageProvider'
import { applyOutputScriptMetadata } from './outputScriptMetadata'
import { listActionsIdb } from './methods/listActionsIdb'
import { listOutputsIdb } from './methods/listOutputsIdb'
import { purgeDataIdb } from './methods/purgeDataIdb'
import { reviewStatusIdb } from './methods/reviewStatusIdb'
import { RocksDbWalletStore, RocksDbWalletStoreOptions } from './rocksdb'
import {
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
} from '../sdk/WalletStorage.interfaces'
import { WERR_INTERNAL, WERR_INVALID_OPERATION, WERR_INVALID_PARAMETER, WERR_NOT_IMPLEMENTED, WERR_UNAUTHORIZED } from '../sdk/WERR_errors'
import { EntityTimeStamp, TransactionStatus } from '../sdk/types'
import { verifyOneOrNone } from '../utility/utilityHelpers'

const outputDateFields = ['cacheUpdatedAt']
const SETTINGS_KEY = 'settings'
const COUNTER_PREFIX = 'meta!nextId!'
const ENTITY_PREFIX = 'entity!'

type EntityTable =
  | 'certificate_fields'
  | 'certificates'
  | 'commissions'
  | 'monitor_events'
  | 'output_baskets'
  | 'output_tags'
  | 'output_tags_map'
  | 'outputs'
  | 'proven_tx_reqs'
  | 'proven_txs'
  | 'sync_states'
  | 'transactions'
  | 'tx_labels'
  | 'tx_labels_map'
  | 'users'

interface TableDefinition<T extends EntityTimeStamp> {
  table: EntityTable
  id?: keyof T & string
  key: (value: T) => string
  match: (value: T, partial: Partial<T>) => boolean
  dateFields?: string[]
  booleanFields?: string[]
}

export interface StorageRocksDbOptions extends StorageProviderOptions {
  path: string
  store?: RocksDbWalletStore
  rocksDb?: Omit<RocksDbWalletStoreOptions, 'path'>
}

export class StorageRocksDb extends StorageProvider implements WalletStorageProvider {
  private store?: RocksDbWalletStore
  private readonly storePath: string
  private readonly rocksDbOptions?: Omit<RocksDbWalletStoreOptions, 'path'>
  private readonly ownsStore: boolean
  private transactionTail: Promise<unknown> = Promise.resolve()

  constructor (options: StorageRocksDbOptions) {
    super(options)
    if (String(options.path ?? '').trim() === '' && options.store == null) throw new WERR_INVALID_PARAMETER('options.path', 'valid RocksDB path')
    this.store = options.store
    this.storePath = options.path
    this.rocksDbOptions = options.rocksDb
    this.ownsStore = options.store == null
  }

  async migrate (storageName: string, storageIdentityKey: string): Promise<string> {
    const store = await this.verifyStore()
    const existing = await store.get<TableSettings>(SETTINGS_KEY)
    if (existing == null) {
      const now = new Date()
      await store.put<TableSettings>({
        key: SETTINGS_KEY,
        value: {
          created_at: now,
          updated_at: now,
          storageIdentityKey,
          storageName,
          chain: this.chain,
          dbtype: 'RocksDB',
          maxOutputScript: 1024
        }
      })
    }
    this._settings = await this.readSettings()
    return 'rocksdb-1'
  }

  async readSettings (): Promise<TableSettings> {
    const record = await (await this.verifyStore()).get<TableSettings>(SETTINGS_KEY)
    if (record == null) throw new WERR_INVALID_OPERATION('migrate must be called before first access')
    return this.validateEntity(record.value)
  }

  async destroy (): Promise<void> {
    if (this.ownsStore) this.store?.close()
    this.store = undefined
    this._settings = undefined
  }

  async dropAllData (): Promise<void> {
    const store = await this.verifyStore()
    const records = await store.scan({ prefix: '', limit: Number.MAX_SAFE_INTEGER })
    await store.batch(records.map(record => ({ type: 'delete', key: record.key })))
    this._settings = undefined
  }

  async transaction<T>(scope: (trx: TrxToken) => Promise<T>, trx?: TrxToken): Promise<T> {
    if (trx != null) return await scope(trx)
    const run = async (): Promise<T> => await scope({} as TrxToken)
    const next = this.transactionTail.then(run, run)
    this.transactionTail = next.then(() => undefined, () => undefined)
    return await next
  }

  async reviewStatus (args: { agedLimit: Date, trx?: TrxToken }): Promise<{ log: string }> {
    return await reviewStatusIdb(this as never, args)
  }

  async purgeData (params: PurgeParams, trx?: TrxToken): Promise<PurgeResults> {
    return await purgeDataIdb(this as never, params, trx)
  }

  async allocateChangeInput (
    userId: number,
    basketId: number,
    targetSatoshis: number,
    exactSatoshis: number | undefined,
    excludeSending: boolean,
    transactionId: number
  ): Promise<TableOutput | undefined> {
    const txStatus: TransactionStatus[] = ['completed', 'unproven']
    if (!excludeSending) txStatus.push('sending')
    const outputs = await this.findOutputs({ partial: { userId, basketId, spendable: true }, txStatus, noScript: true })
    let output = exactSatoshis === undefined ? undefined : outputs.find(o => o.satoshis === exactSatoshis)
    if (output == null) {
      const over = outputs
        .filter(o => o.satoshis >= targetSatoshis)
        .sort((a, b) => a.satoshis - b.satoshis || a.outputId - b.outputId)
      output = over[0]
    }
    if (output == null) {
      const under = outputs
        .filter(o => o.satoshis < targetSatoshis)
        .sort((a, b) => b.satoshis - a.satoshis || b.outputId - a.outputId)
      output = under[0]
    }
    if (output == null) return undefined
    const fullOutput = verifyOneOrNone(await this.findOutputs({ partial: { outputId: output.outputId } }))
    if (fullOutput == null) return undefined
    await this.updateOutput(fullOutput.outputId, { spendable: false, spentBy: transactionId })
    fullOutput.spendable = false
    fullOutput.spentBy = transactionId
    return fullOutput
  }

  async countChangeInputs (userId: number, basketId: number, excludeSending: boolean): Promise<number> {
    const txStatus: TransactionStatus[] = ['completed', 'unproven']
    if (!excludeSending) txStatus.push('sending')
    return await this.countOutputs({ partial: { userId, basketId, spendable: true }, txStatus, noScript: true })
  }

  async getProvenOrRawTx (txid: string, trx?: TrxToken): Promise<ProvenOrRawTx> {
    const r: ProvenOrRawTx = { proven: undefined, rawTx: undefined, inputBEEF: undefined }
    r.proven = verifyOneOrNone(await this.findProvenTxs({ partial: { txid }, trx }))
    if (r.proven == null) {
      const req = verifyOneOrNone(await this.findProvenTxReqs({ partial: { txid }, trx }))
      if (req != null && ['unsent', 'unmined', 'unconfirmed', 'sending', 'nosend', 'completed'].includes(req.status)) {
        r.rawTx = req.rawTx
        r.inputBEEF = req.inputBEEF
      }
    }
    return r
  }

  async getRawTxOfKnownValidTransaction (txid?: string, offset?: number, length?: number, trx?: TrxToken): Promise<number[] | undefined> {
    if (txid == null) return undefined
    const r = await this.getProvenOrRawTx(txid, trx)
    const rawTx = r.proven?.rawTx ?? r.rawTx
    if (rawTx == null) return undefined
    if (Number.isInteger(offset) && Number.isInteger(length)) return rawTx.slice(offset, offset! + length!)
    return rawTx
  }

  async validateRawTransaction (tx: TableTransaction, trx?: TrxToken): Promise<void> {
    if (tx.rawTx != null || tx.txid == null) return
    const rawTx = await this.getRawTxOfKnownValidTransaction(tx.txid, undefined, undefined, trx)
    if (rawTx != null) tx.rawTx = rawTx
  }

  async getLabelsForTransactionId (transactionId?: number, trx?: TrxToken): Promise<TableTxLabel[]> {
    if (transactionId === undefined) return []
    const maps = await this.findTxLabelMaps({ partial: { transactionId, isDeleted: false }, trx })
    const labels: TableTxLabel[] = []
    for (const map of maps) {
      const label = verifyOneOrNone(await this.findTxLabels({ partial: { txLabelId: map.txLabelId, isDeleted: false }, trx }))
      if (label != null) labels.push(label)
    }
    return labels
  }

  async getTagsForOutputId (outputId: number, trx?: TrxToken): Promise<TableOutputTag[]> {
    const maps = await this.findOutputTagMaps({ partial: { outputId, isDeleted: false }, trx })
    const tags: TableOutputTag[] = []
    for (const map of maps) {
      const tag = verifyOneOrNone(await this.findOutputTags({ partial: { outputTagId: map.outputTagId, isDeleted: false }, trx }))
      if (tag != null) tags.push(tag)
    }
    return tags
  }

  async listActions (auth: AuthId, vargs: Validation.ValidListActionsArgs): Promise<ListActionsResult> {
    if (!auth.userId) throw new WERR_UNAUTHORIZED()
    return await listActionsIdb(this as never, auth, vargs)
  }

  async listOutputs (auth: AuthId, vargs: Validation.ValidListOutputsArgs): Promise<ListOutputsResult> {
    if (!auth.userId) throw new WERR_UNAUTHORIZED()
    return await listOutputsIdb(this as never, auth, vargs)
  }

  async findCertificatesAuth (auth: AuthId, args: FindCertificatesArgs): Promise<TableCertificateX[]> {
    if (!auth.userId || (args.partial.userId !== undefined && args.partial.userId !== auth.userId)) throw new WERR_UNAUTHORIZED()
    args.partial.userId = auth.userId
    return await this.findCertificates(args)
  }

  async findOutputBasketsAuth (auth: AuthId, args: FindOutputBasketsArgs): Promise<TableOutputBasket[]> {
    if (!auth.userId || (args.partial.userId !== undefined && args.partial.userId !== auth.userId)) throw new WERR_UNAUTHORIZED()
    args.partial.userId = auth.userId
    return await this.findOutputBaskets(args)
  }

  async findOutputsAuth (auth: AuthId, args: FindOutputsArgs): Promise<TableOutput[]> {
    if (!auth.userId || (args.partial.userId !== undefined && args.partial.userId !== auth.userId)) throw new WERR_UNAUTHORIZED()
    args.partial.userId = auth.userId
    return await this.findOutputs(args)
  }

  async insertCertificateAuth (auth: AuthId, certificate: TableCertificateX): Promise<number> {
    if (!auth.userId || (certificate.userId !== undefined && certificate.userId !== auth.userId)) throw new WERR_UNAUTHORIZED()
    certificate.userId = auth.userId
    return await this.insertCertificate(certificate)
  }

  async adminStats (_adminIdentityKey: string): Promise<never> {
    throw new WERR_NOT_IMPLEMENTED('adminStats, only MySQL is supported')
  }

  async insertCertificate (certificate: TableCertificateX, trx?: TrxToken): Promise<number> {
    const fields = certificate.fields
    const entity = { ...certificate }
    delete entity.fields
    delete (entity as Record<string, unknown>).logger
    const id = await this.insertEntity(certificateDefinition, entity, trx)
    certificate.certificateId = id
    if (fields != null) {
      for (const field of fields) {
        field.certificateId = id
        field.userId = certificate.userId
        await this.insertCertificateField(field, trx)
      }
    }
    return id
  }

  async insertCertificateField (certificateField: TableCertificateField, trx?: TrxToken): Promise<void> {
    await this.putEntity(certificateFieldDefinition, await this.prepareInsert(certificateField, certificateFieldDefinition), trx)
  }

  async insertCommission (commission: TableCommission, trx?: TrxToken): Promise<number> {
    return await this.insertEntity(commissionDefinition, commission, trx)
  }

  async insertMonitorEvent (event: TableMonitorEvent, trx?: TrxToken): Promise<number> {
    return await this.insertEntity(monitorEventDefinition, event, trx)
  }

  async insertOutput (output: TableOutput, trx?: TrxToken): Promise<number> {
    applyOutputScriptMetadata(output)
    const id = await this.insertEntity(outputDefinition, output, trx)
    await (await this.verifyStore()).putOutput(output)
    return id
  }

  async insertOutputBasket (basket: TableOutputBasket, trx?: TrxToken): Promise<number> {
    return await this.insertEntity(outputBasketDefinition, basket, trx)
  }

  async insertOutputTag (tag: TableOutputTag, trx?: TrxToken): Promise<number> {
    return await this.insertEntity(outputTagDefinition, tag, trx)
  }

  async insertOutputTagMap (tagMap: TableOutputTagMap, trx?: TrxToken): Promise<void> {
    await this.putEntity(outputTagMapDefinition, await this.prepareInsert(tagMap, outputTagMapDefinition), trx)
  }

  async insertProvenTx (tx: TableProvenTx, trx?: TrxToken): Promise<number> {
    return await this.insertEntity(provenTxDefinition, tx, trx)
  }

  async insertProvenTxReq (tx: TableProvenTxReq, trx?: TrxToken): Promise<number> {
    return await this.insertEntity(provenTxReqDefinition, tx, trx)
  }

  async insertSyncState (syncState: TableSyncState, trx?: TrxToken): Promise<number> {
    return await this.insertEntity(syncStateDefinition, syncState, trx)
  }

  async insertTransaction (tx: TableTransaction, trx?: TrxToken): Promise<number> {
    return await this.insertEntity(transactionDefinition, tx, trx)
  }

  async insertTxLabel (label: TableTxLabel, trx?: TrxToken): Promise<number> {
    return await this.insertEntity(txLabelDefinition, label, trx)
  }

  async insertTxLabelMap (labelMap: TableTxLabelMap, trx?: TrxToken): Promise<void> {
    await this.putEntity(txLabelMapDefinition, await this.prepareInsert(labelMap, txLabelMapDefinition), trx)
  }

  async insertUser (user: TableUser, trx?: TrxToken): Promise<number> {
    return await this.insertEntity(userDefinition, user, trx)
  }

  async updateCertificate (id: number, update: Partial<TableCertificate>, trx?: TrxToken): Promise<number> {
    return await this.updateById(certificateDefinition, id, update, trx)
  }

  async updateCertificateField (certificateId: number, fieldName: string, update: Partial<TableCertificateField>, trx?: TrxToken): Promise<number> {
    return await this.updateByKey(certificateFieldDefinition, `${certificateId}!${fieldName}`, update, trx)
  }

  async updateCommission (id: number, update: Partial<TableCommission>, trx?: TrxToken): Promise<number> {
    return await this.updateById(commissionDefinition, id, update, trx)
  }

  async updateMonitorEvent (id: number, update: Partial<TableMonitorEvent>, trx?: TrxToken): Promise<number> {
    return await this.updateById(monitorEventDefinition, id, update, trx)
  }

  async updateOutput (id: number, update: Partial<TableOutput>, trx?: TrxToken): Promise<number> {
    applyOutputScriptMetadata(update)
    const updated = await this.updateById(outputDefinition, id, update, trx)
    const output = verifyOneOrNone(await this.findOutputs({ partial: { outputId: id }, trx }))
    if (output != null) await (await this.verifyStore()).putOutput(output)
    return updated
  }

  async updateOutputBasket (id: number, update: Partial<TableOutputBasket>, trx?: TrxToken): Promise<number> {
    return await this.updateById(outputBasketDefinition, id, update, trx)
  }

  async updateOutputTag (id: number, update: Partial<TableOutputTag>, trx?: TrxToken): Promise<number> {
    return await this.updateById(outputTagDefinition, id, update, trx)
  }

  async updateOutputTagMap (outputId: number, tagId: number, update: Partial<TableOutputTagMap>, trx?: TrxToken): Promise<number> {
    return await this.updateByKey(outputTagMapDefinition, `${tagId}!${outputId}`, update, trx)
  }

  async updateProvenTx (id: number, update: Partial<TableProvenTx>, trx?: TrxToken): Promise<number> {
    return await this.updateById(provenTxDefinition, id, update, trx)
  }

  async updateProvenTxReq (id: number | number[], update: Partial<TableProvenTxReq>, trx?: TrxToken): Promise<number> {
    const ids = Array.isArray(id) ? id : [id]
    let count = 0
    for (const singleId of ids) count += await this.updateById(provenTxReqDefinition, singleId, update, trx)
    return count
  }

  async updateSyncState (id: number, update: Partial<TableSyncState>, trx?: TrxToken): Promise<number> {
    return await this.updateById(syncStateDefinition, id, update, trx)
  }

  async updateTransaction (id: number | number[], update: Partial<TableTransaction>, trx?: TrxToken): Promise<number> {
    const ids = Array.isArray(id) ? id : [id]
    let count = 0
    for (const singleId of ids) count += await this.updateById(transactionDefinition, singleId, update, trx)
    return count
  }

  async updateTxLabel (id: number, update: Partial<TableTxLabel>, trx?: TrxToken): Promise<number> {
    return await this.updateById(txLabelDefinition, id, update, trx)
  }

  async updateTxLabelMap (transactionId: number, txLabelId: number, update: Partial<TableTxLabelMap>, trx?: TrxToken): Promise<number> {
    return await this.updateByKey(txLabelMapDefinition, `${txLabelId}!${transactionId}`, update, trx)
  }

  async updateUser (id: number, update: Partial<TableUser>, trx?: TrxToken): Promise<number> {
    return await this.updateById(userDefinition, id, update, trx)
  }

  async findCertificateFields (args: FindCertificateFieldsArgs): Promise<TableCertificateField[]> {
    return await this.findEntities(certificateFieldDefinition, args)
  }

  async findCertificates (args: FindCertificatesArgs): Promise<TableCertificateX[]> {
    const certs = await this.findEntities(certificateDefinition, args)
    if (args.certifiers != null && args.certifiers.length > 0) {
      for (let i = certs.length - 1; i >= 0; i--) if (!args.certifiers.includes(certs[i].certifier)) certs.splice(i, 1)
    }
    if (args.types != null && args.types.length > 0) {
      for (let i = certs.length - 1; i >= 0; i--) if (!args.types.includes(certs[i].type)) certs.splice(i, 1)
    }
    if (args.includeFields) {
      for (const cert of certs) {
        ;(cert as TableCertificateX).fields = await this.findCertificateFields({ partial: { certificateId: cert.certificateId, userId: cert.userId }, trx: args.trx })
      }
    }
    return certs
  }

  async findCommissions (args: FindCommissionsArgs): Promise<TableCommission[]> {
    if (args.partial.lockingScript != null) throw new WERR_INVALID_PARAMETER('partial.lockingScript', 'undefined. Commissions may not be found by lockingScript value.')
    return await this.findEntities(commissionDefinition, args)
  }

  async findMonitorEvents (args: FindMonitorEventsArgs): Promise<TableMonitorEvent[]> {
    return await this.findEntities(monitorEventDefinition, args)
  }

  async findOutputBaskets (args: FindOutputBasketsArgs): Promise<TableOutputBasket[]> {
    return await this.findEntities(outputBasketDefinition, args)
  }

  async findOutputTagMaps (args: FindOutputTagMapsArgs): Promise<TableOutputTagMap[]> {
    let rows = await this.findEntities(outputTagMapDefinition, args)
    if (args.tagIds != null && args.tagIds.length > 0) rows = rows.filter(row => args.tagIds!.includes(row.outputTagId))
    return rows
  }

  async findOutputTags (args: FindOutputTagsArgs): Promise<TableOutputTag[]> {
    return await this.findEntities(outputTagDefinition, args)
  }

  async findOutputs (args: FindOutputsArgs, tagIds?: number[], isQueryModeAll?: boolean): Promise<TableOutput[]> {
    if (args.partial.lockingScript != null) throw new WERR_INVALID_PARAMETER('args.partial.lockingScript', 'undefined. Outputs may not be found by lockingScript value.')
    let rows = await this.findEntities(outputDefinition, args)
    if (args.txStatus != null && args.txStatus.length > 0) {
      const filtered: TableOutput[] = []
      for (const output of rows) {
        const tx = verifyOneOrNone(await this.findTransactions({ partial: { transactionId: output.transactionId }, status: args.txStatus, noRawTx: true, trx: args.trx }))
        if (tx != null) filtered.push(output)
      }
      rows = filtered
    }
    if (tagIds != null && tagIds.length > 0) {
      rows = (await Promise.all(rows.map(async row => await this.outputMatchesTags(row, tagIds, isQueryModeAll, args.trx)))).filter((row): row is TableOutput => row != null)
    }
    for (const row of rows) {
      if (args.noScript === true) row.lockingScript = undefined
      else await this.validateOutputScript(row, args.trx)
    }
    return rows
  }

  async findProvenTxReqs (args: FindProvenTxReqsArgs): Promise<TableProvenTxReq[]> {
    let rows = await this.findEntities(provenTxReqDefinition, args)
    if (args.status != null && args.status.length > 0) rows = rows.filter(row => args.status!.includes(row.status))
    if (args.txids != null && args.txids.length > 0) rows = rows.filter(row => args.txids!.includes(row.txid))
    return rows
  }

  async findProvenTxs (args: FindProvenTxsArgs): Promise<TableProvenTx[]> {
    return await this.findEntities(provenTxDefinition, args)
  }

  override async findStaleMerkleRoots (args: { height: number, merkleRoot: string, trx?: TrxToken }): Promise<string[]> {
    const rows = await this.findProvenTxs({ partial: { height: args.height }, trx: args.trx })
    return [...new Set(rows.filter(row => row.merkleRoot !== args.merkleRoot).map(row => row.merkleRoot))]
  }

  async findSyncStates (args: FindSyncStatesArgs): Promise<TableSyncState[]> {
    if (args.partial.syncMap != null) throw new WERR_INVALID_PARAMETER('args.partial.syncMap', 'undefined. SyncStates may not be found by syncMap value.')
    return await this.findEntities(syncStateDefinition, args)
  }

  async findTransactions (args: FindTransactionsArgs, labelIds?: number[], isQueryModeAll?: boolean): Promise<TableTransaction[]> {
    if (args.partial.rawTx != null) throw new WERR_INVALID_PARAMETER('args.partial.rawTx', 'undefined. Transactions may not be found by rawTx value.')
    if (args.partial.inputBEEF != null) throw new WERR_INVALID_PARAMETER('args.partial.inputBEEF', 'undefined. Transactions may not be found by inputBEEF value.')
    let rows = await this.findEntities(transactionDefinition, args)
    if (args.status != null && args.status.length > 0) rows = rows.filter(row => args.status!.includes(row.status))
    if (args.from != null) rows = rows.filter(row => row.created_at.getTime() >= args.from!.getTime())
    if (args.to != null) rows = rows.filter(row => row.created_at.getTime() < args.to!.getTime())
    if (labelIds != null && labelIds.length > 0) {
      rows = (await Promise.all(rows.map(async row => await this.transactionMatchesLabels(row, labelIds, isQueryModeAll, args.trx)))).filter((row): row is TableTransaction => row != null)
    }
    if (args.noRawTx === true) {
      for (const row of rows) {
        row.rawTx = undefined
        row.inputBEEF = undefined
      }
    } else {
      for (const row of rows) await this.validateRawTransaction(row, args.trx)
    }
    return rows
  }

  async findTxLabelMaps (args: FindTxLabelMapsArgs): Promise<TableTxLabelMap[]> {
    let rows = await this.findEntities(txLabelMapDefinition, args)
    if (args.labelIds != null && args.labelIds.length > 0) rows = rows.filter(row => args.labelIds!.includes(row.txLabelId))
    return rows
  }

  async findTxLabels (args: FindTxLabelsArgs): Promise<TableTxLabel[]> {
    return await this.findEntities(txLabelDefinition, args)
  }

  async findUsers (args: FindUsersArgs): Promise<TableUser[]> {
    return await this.findEntities(userDefinition, args)
  }

  async countCertificateFields (args: FindCertificateFieldsArgs): Promise<number> { return (await this.findCertificateFields(args)).length }
  async countCertificates (args: FindCertificatesArgs): Promise<number> { return (await this.findCertificates(args)).length }
  async countCommissions (args: FindCommissionsArgs): Promise<number> { return (await this.findCommissions(args)).length }
  async countMonitorEvents (args: FindMonitorEventsArgs): Promise<number> { return (await this.findMonitorEvents(args)).length }
  async countOutputBaskets (args: FindOutputBasketsArgs): Promise<number> { return (await this.findOutputBaskets(args)).length }
  async countOutputTagMaps (args: FindOutputTagMapsArgs): Promise<number> { return (await this.findOutputTagMaps(args)).length }
  async countOutputTags (args: FindOutputTagsArgs): Promise<number> { return (await this.findOutputTags(args)).length }
  async countProvenTxReqs (args: FindProvenTxReqsArgs): Promise<number> { return (await this.findProvenTxReqs(args)).length }
  async countProvenTxs (args: FindProvenTxsArgs): Promise<number> { return (await this.findProvenTxs(args)).length }
  async countSyncStates (args: FindSyncStatesArgs): Promise<number> { return (await this.findSyncStates(args)).length }
  async countTransactions (args: FindTransactionsArgs, labelIds?: number[], isQueryModeAll?: boolean): Promise<number> {
    return (await this.findTransactions(args, labelIds, isQueryModeAll)).length
  }

  async countTxLabelMaps (args: FindTxLabelMapsArgs): Promise<number> { return (await this.findTxLabelMaps(args)).length }
  async countTxLabels (args: FindTxLabelsArgs): Promise<number> { return (await this.findTxLabels(args)).length }
  async countUsers (args: FindUsersArgs): Promise<number> { return (await this.findUsers(args)).length }
  async countOutputs (args: FindOutputsArgs, tagIds?: number[], isQueryModeAll?: boolean): Promise<number> {
    return (await this.findOutputs({ ...args, noScript: true }, tagIds, isQueryModeAll)).length
  }

  async getProvenTxsForUser (args: FindForUserSincePagedArgs): Promise<TableProvenTx[]> {
    const txs = await this.findTransactions({ partial: { userId: args.userId }, noRawTx: true, trx: args.trx })
    const ids = new Set(txs.map(tx => tx.provenTxId).filter((id): id is number => id !== undefined))
    return (await this.findProvenTxs({ partial: {}, since: args.since, paged: args.paged, trx: args.trx })).filter(row => ids.has(row.provenTxId))
  }

  async getProvenTxReqsForUser (args: FindForUserSincePagedArgs): Promise<TableProvenTxReq[]> {
    const txs = await this.findTransactions({ partial: { userId: args.userId }, noRawTx: true, trx: args.trx })
    const txids = new Set(txs.map(tx => tx.txid).filter((txid): txid is string => txid !== undefined))
    return (await this.findProvenTxReqs({ partial: {}, since: args.since, paged: args.paged, trx: args.trx })).filter(row => txids.has(row.txid))
  }

  async getTxLabelMapsForUser (args: FindForUserSincePagedArgs): Promise<TableTxLabelMap[]> {
    const labels = await this.findTxLabels({ partial: { userId: args.userId }, trx: args.trx })
    const ids = new Set(labels.map(label => label.txLabelId))
    return (await this.findTxLabelMaps({ partial: {}, since: args.since, paged: args.paged, trx: args.trx })).filter(row => ids.has(row.txLabelId))
  }

  async getOutputTagMapsForUser (args: FindForUserSincePagedArgs): Promise<TableOutputTagMap[]> {
    const tags = await this.findOutputTags({ partial: { userId: args.userId }, trx: args.trx })
    const ids = new Set(tags.map(tag => tag.outputTagId))
    return (await this.findOutputTagMaps({ partial: {}, since: args.since, paged: args.paged, trx: args.trx })).filter(row => ids.has(row.outputTagId))
  }

  override async findOutputsByIds (outputIds: number[], trx?: TrxToken): Promise<Record<number, TableOutput>> {
    const byId: Record<number, TableOutput> = {}
    for (const outputId of outputIds) {
      const output = verifyOneOrNone(await this.findOutputs({ partial: { outputId }, trx }))
      if (output != null) byId[outputId] = output
    }
    return byId
  }

  override async findOutputsByOutpoints (userId: number, outpoints: Array<{ txid: string, vout: number }>, trx?: TrxToken): Promise<Record<string, TableOutput>> {
    const byOutpoint: Record<string, TableOutput> = {}
    for (const { txid, vout } of outpoints) {
      const output = verifyOneOrNone(await this.findOutputs({ partial: { userId, txid, vout }, trx }))
      if (output != null) byOutpoint[`${txid}.${vout}`] = output
    }
    return byOutpoint
  }

  override async recentlyActiveUsers (limit = 50, trx?: TrxToken): Promise<TableUser[]> {
    const outputs = await this.findOutputs({ partial: {}, noScript: true, trx })
    const latest = new Map<number, Date>()
    for (const output of outputs) {
      const prior = latest.get(output.userId)
      if (prior == null || output.created_at > prior) latest.set(output.userId, output.created_at)
    }
    const ids = [...latest.entries()].sort((a, b) => b[1].getTime() - a[1].getTime()).slice(0, limit).map(([userId]) => userId)
    const users = await Promise.all(ids.map(async userId => verifyOneOrNone(await this.findUsers({ partial: { userId }, trx }))))
    return users.filter((user): user is TableUser => user != null)
  }

  async filterTxLabels (args: FindTxLabelsArgs, filtered: (v: TableTxLabel) => void): Promise<void> {
    for (const row of await this.findTxLabels(args)) filtered(row)
  }

  async filterOutputTags (args: FindOutputTagsArgs, filtered: (v: TableOutputTag) => void): Promise<void> {
    for (const row of await this.findOutputTags(args)) filtered(row)
  }

  async filterOutputs (args: FindOutputsArgs, filtered: (v: TableOutput) => void, tagIds?: number[], isQueryModeAll?: boolean): Promise<void> {
    for (const row of await this.findOutputs(args, tagIds, isQueryModeAll)) filtered(row)
  }

  async filterProvenTxReqs (args: FindProvenTxReqsArgs, filtered: (v: TableProvenTxReq) => void): Promise<void> {
    for (const row of await this.findProvenTxReqs(args)) filtered(row)
  }

  validateEntity<T extends EntityTimeStamp>(entity: T, dateFields?: string[], booleanFields?: string[]): T {
    entity.created_at = this.validateDate(entity.created_at)
    entity.updated_at = this.validateDate(entity.updated_at)
    for (const field of dateFields ?? []) {
      const value = (entity as Record<string, unknown>)[field]
      if (value != null) (entity as Record<string, unknown>)[field] = this.validateDate(value as Date)
    }
    for (const field of booleanFields ?? []) {
      const value = (entity as Record<string, unknown>)[field]
      if (value !== undefined) (entity as Record<string, unknown>)[field] = Boolean(value)
    }
    return entity
  }

  validateEntities<T extends EntityTimeStamp>(entities: T[], dateFields?: string[], booleanFields?: string[]): T[] {
    return entities.map(entity => this.validateEntity(entity, dateFields, booleanFields))
  }

  validatePartialForUpdate<T extends EntityTimeStamp>(update: Partial<T>, dateFields?: string[], booleanFields?: string[]): Partial<T> {
    const next = { ...update } as Record<string, unknown>
    delete next.created_at
    next.updated_at = new Date()
    for (const field of dateFields ?? []) {
      if (next[field] != null) next[field] = this.validateDate(next[field] as Date)
    }
    for (const field of booleanFields ?? []) {
      if (next[field] !== undefined) next[field] = Boolean(next[field])
    }
    this.isDirty = true
    return next as Partial<T>
  }

  async validateEntityForInsert<T extends EntityTimeStamp>(entity: T, _trx?: TrxToken, dateFields?: string[], booleanFields?: string[]): Promise<T> {
    const next = { ...entity } as T
    next.created_at = this.validateOptionalDate(next.created_at) ?? new Date()
    next.updated_at = this.validateOptionalDate(next.updated_at) ?? new Date()
    return this.validateEntity(next, dateFields, booleanFields)
  }

  async verifyReadyForDatabaseAccess (): Promise<'RocksDB'> {
    this._settings ??= await this.readSettings()
    return 'RocksDB'
  }

  private async verifyStore (): Promise<RocksDbWalletStore> {
    if (this.store == null) {
      this.store = await RocksDbWalletStore.open({
        ...this.rocksDbOptions,
        path: this.storePath
      })
    }
    this.whenLastAccess = new Date()
    return this.store
  }

  private async nextId (table: EntityTable): Promise<number> {
    const store = await this.verifyStore()
    const key = `${COUNTER_PREFIX}${table}`
    const current = await store.get<number>(key)
    const next = (current?.value ?? 0) + 1
    await store.put({ key, value: next })
    return next
  }

  private async insertEntity<T extends EntityTimeStamp> (definition: TableDefinition<T>, entity: T, trx?: TrxToken): Promise<number> {
    const prepared = await this.prepareInsert(entity, definition, trx)
    await this.putEntity(definition, prepared, trx)
    Object.assign(entity, prepared)
    if (definition.id == null) throw new WERR_INTERNAL(`No id field for ${definition.table}`)
    return prepared[definition.id] as number
  }

  private async prepareInsert<T extends EntityTimeStamp> (entity: T, definition: TableDefinition<T>, trx?: TrxToken): Promise<T> {
    const prepared = await this.validateEntityForInsert({ ...entity }, trx, definition.dateFields, definition.booleanFields)
    if (definition.id != null && Number(prepared[definition.id] ?? 0) === 0) {
      ;(prepared as Record<string, unknown>)[definition.id] = await this.nextId(definition.table)
    }
    return prepared
  }

  private async putEntity<T extends EntityTimeStamp> (definition: TableDefinition<T>, entity: T, _trx?: TrxToken): Promise<void> {
    await (await this.verifyStore()).put({ key: entityKey(definition.table, definition.key(entity)), value: entity })
  }

  private async getEntity<T extends EntityTimeStamp> (definition: TableDefinition<T>, key: string): Promise<T | undefined> {
    const record = await (await this.verifyStore()).get<T>(entityKey(definition.table, key))
    return record == null ? undefined : this.validateEntity(record.value, definition.dateFields, definition.booleanFields)
  }

  private async updateById<T extends EntityTimeStamp> (definition: TableDefinition<T>, id: number, update: Partial<T>, trx?: TrxToken): Promise<number> {
    return await this.updateByKey(definition, String(id), update, trx)
  }

  private async updateByKey<T extends EntityTimeStamp> (definition: TableDefinition<T>, key: string, update: Partial<T>, _trx?: TrxToken): Promise<number> {
    const existing = await this.getEntity(definition, key)
    if (existing == null) return 0
    const updated = this.validateEntity({ ...existing, ...this.validatePartialForUpdate(update, definition.dateFields, definition.booleanFields) }, definition.dateFields, definition.booleanFields)
    await this.putEntity(definition, updated)
    return 1
  }

  private async findEntities<T extends EntityTimeStamp> (
    definition: TableDefinition<T>,
    args: { partial: Partial<T>, since?: Date, paged?: { limit: number, offset?: number }, orderDescending?: boolean }
  ): Promise<T[]> {
    this.assertNoUndefinedInPartial(args.partial as Record<string, unknown>)
    const records = await (await this.verifyStore()).scan<T>({ prefix: entityPrefix(definition.table), limit: Number.MAX_SAFE_INTEGER })
    let rows = records
      .map(record => this.validateEntity(record.value, definition.dateFields, definition.booleanFields))
      .filter(row => definition.match(row, args.partial))
    if (args.since != null) rows = rows.filter(row => row.updated_at >= args.since!)
    rows.sort((a, b) => compareEntityKeys(definition.key(a), definition.key(b), args.orderDescending === true))
    const offset = args.paged?.offset ?? 0
    const limit = args.paged?.limit
    if (limit != null) rows = rows.slice(offset, offset + limit)
    else if (offset > 0) rows = rows.slice(offset)
    return rows
  }

  private assertNoUndefinedInPartial (partial: Record<string, unknown> | undefined): void {
    if (partial == null) return
    for (const key of Object.keys(partial)) {
      if (partial[key] === undefined) throw new WERR_INVALID_PARAMETER(`args.partial.${key}`, 'not undefined')
    }
  }

  private async outputMatchesTags (output: TableOutput, tagIds: number[], all: boolean | undefined, trx?: TrxToken): Promise<TableOutput | undefined> {
    const maps = await this.findOutputTagMaps({ partial: { outputId: output.outputId, isDeleted: false }, trx })
    const present = new Set(maps.map(map => map.outputTagId))
    const ok = all === true ? tagIds.every(id => present.has(id)) : tagIds.some(id => present.has(id))
    return ok ? output : undefined
  }

  private async transactionMatchesLabels (tx: TableTransaction, labelIds: number[], all: boolean | undefined, trx?: TrxToken): Promise<TableTransaction | undefined> {
    const maps = await this.findTxLabelMaps({ partial: { transactionId: tx.transactionId, isDeleted: false }, trx })
    const present = new Set(maps.map(map => map.txLabelId))
    const ok = all === true ? labelIds.every(id => present.has(id)) : labelIds.some(id => present.has(id))
    return ok ? tx : undefined
  }
}

function entityPrefix (table: EntityTable): string {
  return `${ENTITY_PREFIX}${table}!`
}

function entityKey (table: EntityTable, id: string): string {
  return `${entityPrefix(table)}${id}`
}

function compareEntityKeys (a: string, b: string, descending: boolean): number {
  const result = numericString(a) - numericString(b) || a.localeCompare(b)
  return descending ? -result : result
}

function numericString (value: string): number {
  return /^[0-9]+$/.test(value) ? Number(value) : 0
}

function tableDefinition<T extends EntityTimeStamp> (definition: TableDefinition<T>): TableDefinition<T> {
  return definition
}

const certificateFieldDefinition = tableDefinition<TableCertificateField>({
  table: 'certificate_fields',
  key: row => `${row.certificateId}!${row.fieldName}`,
  match: matchesCertificateFieldPartial
})
const certificateDefinition = tableDefinition<TableCertificateX>({
  table: 'certificates',
  id: 'certificateId',
  key: row => String(row.certificateId),
  match: matchesCertificatePartial,
  booleanFields: ['isDeleted']
})
const commissionDefinition = tableDefinition<TableCommission>({
  table: 'commissions',
  id: 'commissionId',
  key: row => String(row.commissionId),
  match: matchesCommissionPartial,
  booleanFields: ['isRedeemed']
})
const monitorEventDefinition = tableDefinition<TableMonitorEvent>({
  table: 'monitor_events',
  id: 'id',
  key: row => String(row.id),
  match: matchesMonitorEventPartial,
  dateFields: ['when']
})
const outputBasketDefinition = tableDefinition<TableOutputBasket>({
  table: 'output_baskets',
  id: 'basketId',
  key: row => String(row.basketId),
  match: matchesOutputBasketPartial,
  booleanFields: ['isDeleted']
})
const outputTagDefinition = tableDefinition<TableOutputTag>({
  table: 'output_tags',
  id: 'outputTagId',
  key: row => String(row.outputTagId),
  match: matchesOutputTagPartial,
  booleanFields: ['isDeleted']
})
const outputTagMapDefinition = tableDefinition<TableOutputTagMap>({
  table: 'output_tags_map',
  key: row => `${row.outputTagId}!${row.outputId}`,
  match: matchesOutputTagMapPartial,
  booleanFields: ['isDeleted']
})
const outputDefinition = tableDefinition<TableOutput>({
  table: 'outputs',
  id: 'outputId',
  key: row => String(row.outputId),
  match: matchesOutputPartial,
  dateFields: outputDateFields,
  booleanFields: ['spendable', 'change']
})
const provenTxReqDefinition = tableDefinition<TableProvenTxReq>({
  table: 'proven_tx_reqs',
  id: 'provenTxReqId',
  key: row => String(row.provenTxReqId),
  match: matchesProvenTxReqPartial,
  booleanFields: ['notified', 'wasBroadcast']
})
const provenTxDefinition = tableDefinition<TableProvenTx>({
  table: 'proven_txs',
  id: 'provenTxId',
  key: row => String(row.provenTxId),
  match: matchesProvenTxPartial
})
const syncStateDefinition = tableDefinition<TableSyncState>({
  table: 'sync_states',
  id: 'syncStateId',
  key: row => String(row.syncStateId),
  match: matchesSyncStatePartial,
  dateFields: ['when'],
  booleanFields: ['init']
})
const transactionDefinition = tableDefinition<TableTransaction>({
  table: 'transactions',
  id: 'transactionId',
  key: row => String(row.transactionId),
  match: matchesTransactionPartial,
  booleanFields: ['isOutgoing']
})
const txLabelDefinition = tableDefinition<TableTxLabel>({
  table: 'tx_labels',
  id: 'txLabelId',
  key: row => String(row.txLabelId),
  match: matchesTxLabelPartial,
  booleanFields: ['isDeleted']
})
const txLabelMapDefinition = tableDefinition<TableTxLabelMap>({
  table: 'tx_labels_map',
  key: row => `${row.txLabelId}!${row.transactionId}`,
  match: matchesTxLabelMapPartial,
  booleanFields: ['isDeleted']
})
const userDefinition = tableDefinition<TableUser>({
  table: 'users',
  id: 'userId',
  key: row => String(row.userId),
  match: (row, partial) =>
    (partial.userId === undefined || row.userId === partial.userId) &&
    (partial.identityKey === undefined || row.identityKey === partial.identityKey) &&
    (partial.activeStorage === undefined || row.activeStorage === partial.activeStorage)
})
