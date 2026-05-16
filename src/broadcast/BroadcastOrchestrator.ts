import { Beef, WalletLoggerInterface } from '@bsv/sdk'
import PQueue from 'p-queue'

import { PostBeefResult, WalletServices } from '../sdk/WalletServices.interfaces'
import { WERR_INVALID_OPERATION } from '../sdk/WERR_errors'

export interface BroadcastRequest {
  beef: Beef
  txids: string[]
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
    return await this.queue.add(
      async () => await this.services.postBeef(request.beef, request.txids, request.logger),
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
