import {
  BroadcastOrchestrator,
  BroadcastOrchestratorOptions,
  BroadcastRequest
} from '../../broadcast/BroadcastOrchestrator'
import { PostBeefResult, WalletServices } from '../../sdk/WalletServices.interfaces'
import { WERR_INVALID_OPERATION } from '../../sdk/WERR_errors'

export class BroadcastConsumer {
  private closed = false

  constructor (private readonly orchestrator: BroadcastOrchestrator) {}

  static fromServices (
    services: Pick<WalletServices, 'postBeef'>,
    options: BroadcastOrchestratorOptions = {}
  ): BroadcastConsumer {
    return new BroadcastConsumer(new BroadcastOrchestrator(services, options))
  }

  async consume (request: BroadcastRequest): Promise<PostBeefResult[]> {
    if (this.closed) throw new WERR_INVALID_OPERATION('BroadcastConsumer is closed.')
    return await this.orchestrator.broadcast(request)
  }

  async close (): Promise<void> {
    if (this.closed) return
    this.closed = true
    await this.orchestrator.close()
  }

  get size (): number {
    return this.orchestrator.size
  }

  get pending (): number {
    return this.orchestrator.pending
  }
}
