import {
  BlockEvent,
  EventBus,
  ReorgEvent,
  UtxoInvalidationEvent
} from '../../events/EventBus'

export interface UtxoStatusEvent extends UtxoInvalidationEvent {
  isUtxo?: boolean
  source?: string
  observedAt?: string
}

export class CacheInvalidationPublisher {
  constructor (readonly eventBus: EventBus = new EventBus()) {}

  publishBlockMined (event: BlockEvent): void {
    this.eventBus.emitBlockMined(event)
  }

  publishBlockInvalidation (blockHeight: number, outpoints?: string[]): void {
    this.publishBlockMined({ blockHeight, outpoints, timestamp: Date.now() })
  }

  publishUtxoInvalidation (event: UtxoInvalidationEvent | string[]): void {
    this.eventBus.emitUtxoInvalidation(Array.isArray(event) ? { outpoints: event } : event)
  }

  publishUtxoStatus (event: UtxoStatusEvent): void {
    this.publishUtxoInvalidation({ outpoints: event.outpoints, blockHeight: event.blockHeight })
  }

  publishReorg (event: ReorgEvent): void {
    this.eventBus.emitReorg(event)
  }
}
