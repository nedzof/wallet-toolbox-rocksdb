import {
  BlockEvent,
  EventBus,
  ReorgEvent,
  UtxoInvalidationEvent
} from '../../events/EventBus'
import { Chain } from '../../sdk/types'
import { NatsManager } from '../NatsManager'
import { CacheInvalidationMessage, createMessageMetadata, DistributedChain, toDistributedChain } from '../messages'

export interface UtxoStatusEvent extends UtxoInvalidationEvent {
  isUtxo?: boolean
  source?: string
  observedAt?: string
}

export interface CacheInvalidationPublisherOptions {
  natsManager?: Pick<NatsManager, 'publishCacheInvalidation'>
  chain?: Chain
  source?: string
}

export class CacheInvalidationPublisher {
  readonly chain?: DistributedChain
  readonly source: string

  constructor (
    readonly eventBus: EventBus = new EventBus(),
    private readonly options: CacheInvalidationPublisherOptions = {}
  ) {
    this.chain = options.chain == null ? undefined : toDistributedChain(options.chain)
    this.source = options.source ?? 'wallet-toolbox-cache-invalidation'
  }

  async publishBlockMined (event: BlockEvent): Promise<void> {
    this.eventBus.emitBlockMined(event)
    await this.publishDistributed({
      type: 'block',
      blockHeight: event.blockHeight,
      outpoints: event.outpoints
    })
  }

  async publishBlockInvalidation (blockHeight: number, outpoints?: string[]): Promise<void> {
    await this.publishBlockMined({ blockHeight, outpoints, timestamp: Date.now() })
  }

  async publishUtxoInvalidation (event: UtxoInvalidationEvent | string[]): Promise<void> {
    const normalized = Array.isArray(event) ? { outpoints: event } : event
    this.eventBus.emitUtxoInvalidation(normalized)
    await this.publishDistributed({
      type: 'utxo',
      outpoints: normalized.outpoints,
      blockHeight: normalized.blockHeight
    })
  }

  async publishUtxoStatus (event: UtxoStatusEvent): Promise<void> {
    await this.publishUtxoInvalidation({ outpoints: event.outpoints, blockHeight: event.blockHeight })
  }

  async publishReorg (event: ReorgEvent): Promise<void> {
    this.eventBus.emitReorg(event)
    await this.publishDistributed({
      type: 'reorg',
      reorgDepth: event.depth
    })
  }

  private async publishDistributed (event: Pick<CacheInvalidationMessage, 'type' | 'outpoints' | 'blockHeight' | 'reorgDepth'>): Promise<void> {
    if (this.options.natsManager == null || this.chain == null) return
    const idempotencyKey = [
      this.chain,
      'cache',
      event.type,
      event.blockHeight ?? event.reorgDepth ?? 'none',
      (event.outpoints ?? []).join(',')
    ].join(':')
    await this.options.natsManager.publishCacheInvalidation({
      ...createMessageMetadata({
        chain: this.chain,
        source: this.source,
        idempotencyKey
      }),
      ...event
    })
  }
}
