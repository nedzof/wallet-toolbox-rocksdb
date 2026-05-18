import { Beef } from '@bsv/sdk'

import {
  BroadcastAttemptRecord,
  BroadcastAttemptRecorder,
  BroadcastRequestLoader
} from '../messaging/consumers/BroadcastConsumer'
import { StorageProvider } from './StorageProvider'
import { WalletStorageManager } from './WalletStorageManager'
import { EntityProvenTxReq } from './schema/entities'
import { summarizePostBeefProviderAttemptsForTxid } from './methods/attemptToPostReqsToNetwork'
import { TransactionStatus } from '../sdk/types'
import { verifyOneOrNone } from '../utility/utilityHelpers'
import { asString } from '../utility/utilityHelpers.noBuffer'

export class BroadcastStorageAdapter implements BroadcastRequestLoader, BroadcastAttemptRecorder {
  constructor (private readonly storage: StorageProvider | WalletStorageManager) {}

  async loadBroadcastRequest (message: BroadcastAttemptRecord['message']) {
    return await this.runWithStorageProvider(async sp => {
      const req = await loadReq(sp, message.provenTxReqId)
      if (req.txid !== message.txid) throw new Error('TxBroadcastMessage.txid does not match stored ProvenTxReq')
      const beef = new Beef()
      await sp.mergeReqToBeefToShareExternally(req, beef, [])
      return {
        beef,
        txid: req.txid,
        rawTx: asString(req.rawTx),
        attempts: message.attempt,
        priority: message.priority
      }
    })
  }

  async recordBroadcastAttempt (record: BroadcastAttemptRecord): Promise<void> {
    await this.runWithStorageProvider(async sp => {
      const req = new EntityProvenTxReq(await loadReq(sp, record.message.provenTxReqId))
      if (hasRecordedAttempt(req, record.message.idempotencyKey)) return
      if (req.status === 'completed' || req.status === 'unmined') return

      const note = {
        when: new Date().toISOString(),
        what: 'distributedBroadcastOutcome',
        distributedBroadcastIdempotencyKey: record.message.idempotencyKey,
        outcome: record.outcome,
        providerAttempts: summarizePostBeefProviderAttemptsForTxid(req.txid, record.results).join(';')
      }

      let txStatus: TransactionStatus | undefined
      switch (record.outcome) {
        case 'accepted':
        case 'seen':
        case 'already_seen':
          req.status = 'unmined'
          req.wasBroadcast = true
          txStatus = 'unproven'
          break
        case 'rejected_terminal':
          req.status = hasDoubleSpendResult(record) ? 'doubleSpend' : 'invalid'
          txStatus = 'failed'
          break
        case 'rejected_retryable':
        case 'rate_limited':
        case 'timeout':
          req.status = 'sending'
          txStatus = 'sending'
          break
        case 'unknown':
        case 'malformed':
          req.status = 'unknown'
          Object.assign(note, { reconciliation_required: true })
          break
      }

      req.addHistoryNote(note)
      await req.updateStorageDynamicProperties(sp)
      const ids = req.notify.transactionIds
      if (txStatus != null && ids != null && ids.length > 0) await sp.updateTransactionsStatus(ids, txStatus)
    })
  }

  private async runWithStorageProvider<T> (scope: (sp: StorageProvider) => Promise<T>): Promise<T> {
    if (this.storage.isStorageProvider()) return await scope(this.storage as StorageProvider)
    return await (this.storage as WalletStorageManager).runAsStorageProvider(scope)
  }
}

async function loadReq (storage: StorageProvider, provenTxReqId: number) {
  const req = verifyOneOrNone(await storage.findProvenTxReqs({ partial: { provenTxReqId } }))
  if (req == null) throw new Error('TxBroadcastMessage.provenTxReqId was not found in RocksDB storage')
  return req
}

function hasRecordedAttempt (req: EntityProvenTxReq, idempotencyKey: string): boolean {
  return req.history.notes?.some(note => note.distributedBroadcastIdempotencyKey === idempotencyKey) === true
}

function hasDoubleSpendResult (record: BroadcastAttemptRecord): boolean {
  return record.results.some(result =>
    result.txidResults.some(txidResult => txidResult.txid === record.message.txid && txidResult.doubleSpend === true)
  )
}
