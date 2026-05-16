import type {
  HeaderListener,
  ReorgListener
} from '../services/chaintracker/chaintracks/Api/ChaintracksClientApi'
import type { BlockHeader } from '../sdk/WalletServices.interfaces'
import { EventBus } from '../events/EventBus'

export interface SpvHeaderSource {
  subscribeHeaders: (listener: HeaderListener) => Promise<string>
  subscribeReorgs: (listener: ReorgListener) => Promise<string>
  unsubscribe: (subscriptionId: string) => Promise<boolean>
}

export interface SpvHeaderSyncHandlers {
  onHeader?: HeaderListener
  onReorg?: ReorgListener
}

export interface SpvHeaderSyncStartResult {
  headerSubscriptionId: string
  reorgSubscriptionId: string
}

export class SpvHeaderSync {
  private headerSubscriptionId?: string
  private reorgSubscriptionId?: string
  private startPromise?: Promise<SpvHeaderSyncStartResult>

  constructor (
    private readonly source: SpvHeaderSource,
    private readonly eventBus: EventBus,
    private readonly handlers: SpvHeaderSyncHandlers = {}
  ) {}

  async start (): Promise<SpvHeaderSyncStartResult> {
    if (this.startPromise != null) return await this.startPromise
    this.startPromise = this.startOnce()
    try {
      return await this.startPromise
    } catch (error) {
      this.startPromise = undefined
      throw error
    }
  }

  async stop (): Promise<void> {
    if (this.startPromise != null) {
      try {
        await this.startPromise
      } catch {
        // Failed starts clean up their partial subscriptions in startOnce().
      }
    }
    const ids = [this.headerSubscriptionId, this.reorgSubscriptionId].filter((id): id is string => id != null)
    await Promise.all(ids.map(async id => await this.source.unsubscribe(id)))
    this.headerSubscriptionId = undefined
    this.reorgSubscriptionId = undefined
    this.startPromise = undefined
  }

  private async startOnce (): Promise<SpvHeaderSyncStartResult> {
    try {
      this.reorgSubscriptionId = await this.source.subscribeReorgs(this.handleReorg.bind(this))
      this.headerSubscriptionId = await this.source.subscribeHeaders(this.handleHeader.bind(this))
      return {
        headerSubscriptionId: this.headerSubscriptionId,
        reorgSubscriptionId: this.reorgSubscriptionId
      }
    } catch (error) {
      const ids = [this.headerSubscriptionId, this.reorgSubscriptionId].filter((id): id is string => id != null)
      this.headerSubscriptionId = undefined
      this.reorgSubscriptionId = undefined
      await Promise.allSettled(ids.map(async id => await this.source.unsubscribe(id)))
      throw error
    }
  }

  private handleHeader (header: BlockHeader): void {
    this.eventBus.emitBlockMined({
      blockHeight: header.height,
      blockHash: header.hash,
      timestamp: Date.now(),
      header
    })
    this.handlers.onHeader?.(header)
  }

  private handleReorg (
    depth: number,
    oldTip: BlockHeader,
    newTip: BlockHeader,
    deactivatedHeaders?: BlockHeader[]
  ): void {
    this.eventBus.emitReorg({ depth, oldTip, newTip, deactivatedHeaders })
    this.handlers.onReorg?.(depth, oldTip, newTip, deactivatedHeaders)
  }
}
