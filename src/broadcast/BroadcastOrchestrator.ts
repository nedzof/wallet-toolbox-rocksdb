import { Beef, Utils, WalletLoggerInterface } from '@bsv/sdk'
import PQueue from 'p-queue'

import { PostBeefResult, WalletServices } from '../sdk/WalletServices.interfaces'
import { WERR_INVALID_OPERATION } from '../sdk/WERR_errors'
import { doubleSha256BE } from '../utility/utilityHelpers'

export interface BroadcastRequest {
  beef: Beef
  txids?: string[]
  txid?: string
  rawTx?: string
  priority?: number
  attempts?: number
  logger?: WalletLoggerInterface
}

export interface BroadcastOrchestratorOptions {
  concurrency?: number
}

export class BroadcastOrchestrator {
  private readonly queue: PQueue
  private closed = false

  constructor (
    private readonly services: Pick<WalletServices, 'postBeef'>,
    options: BroadcastOrchestratorOptions = {}
  ) {
    this.queue = new PQueue({ concurrency: options.concurrency ?? 100 })
  }

  async broadcast (request: BroadcastRequest): Promise<PostBeefResult[]> {
    if (this.closed) throw new WERR_INVALID_OPERATION('BroadcastOrchestrator is closed.')
    const txids = normalizeBroadcastTxids(request)
    return await this.queue.add(
      async () => await this.services.postBeef(request.beef, txids, request.logger),
      { priority: request.priority ?? request.attempts ?? 0 }
    )
  }

  async close (): Promise<void> {
    if (this.closed) return
    this.closed = true
    await this.queue.onIdle()
  }

  get size (): number {
    return this.queue.size
  }

  get pending (): number {
    return this.queue.pending
  }
}

function normalizeBroadcastTxids (request: BroadcastRequest): string[] {
  if (request.txids != null && request.txid != null) {
    throw new WERR_INVALID_OPERATION('Broadcast request must specify either txids or txid, not both.')
  }
  const txids = request.txids != null ? [...request.txids] : (request.txid != null ? [request.txid] : [])
  if (txids.length === 0 || txids.some(txid => typeof txid !== 'string' || txid.trim() === '' || txid !== txid.trim())) {
    throw new WERR_INVALID_OPERATION('Broadcast request requires at least one txid.')
  }
  if (request.rawTx != null) validateRawTxMatchesTxid(request.rawTx, txids)
  return txids
}

function validateRawTxMatchesTxid (rawTx: string, txids: string[]): void {
  if (txids.length !== 1) throw new WERR_INVALID_OPERATION('Broadcast rawTx validation requires exactly one txid.')
  if (!/^(?:[0-9a-fA-F]{2})+$/.test(rawTx)) {
    throw new WERR_INVALID_OPERATION('Broadcast rawTx must be a non-empty even-length hex string.')
  }
  const actualTxid = Utils.toHex(doubleSha256BE(Utils.toArray(rawTx, 'hex')))
  if (actualTxid.toLowerCase() !== txids[0].toLowerCase()) {
    throw new WERR_INVALID_OPERATION('Broadcast rawTx does not match txid.')
  }
}
