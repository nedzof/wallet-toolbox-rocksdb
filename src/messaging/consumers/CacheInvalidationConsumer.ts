import { EventBus } from '../../events/EventBus'
import { CacheInvalidationMessage, isObjectRecord } from '../messages'

export interface CacheInvalidationTarget {
  invalidateByBlock: (blockHeight: number, outpoints?: string[]) => number
  invalidateOutpoints: (outpoints: string[]) => number
  clear: () => void
}

export interface AckableMessage {
  json?: <T = unknown>() => T
  string?: () => string
  ack: () => void
  nak: (delayMs?: number) => void
  term: (reason?: string) => void
}

export class CacheInvalidationConsumer {
  constructor (
    private readonly target: CacheInvalidationTarget,
    private readonly eventBus: EventBus = new EventBus()
  ) {}

  consume (message: CacheInvalidationMessage): void {
    validateCacheInvalidationMessage(message)
    switch (message.type) {
      case 'block':
        if (message.blockHeight == null) throw new Error('block cache invalidation requires blockHeight')
        this.target.invalidateByBlock(message.blockHeight, message.outpoints)
        this.eventBus.emitBlockMined({
          blockHeight: message.blockHeight,
          outpoints: message.outpoints,
          timestamp: message.createdAtMs
        })
        return
      case 'utxo':
        this.target.invalidateOutpoints(message.outpoints ?? [])
        this.eventBus.emitUtxoInvalidation({ outpoints: message.outpoints ?? [], blockHeight: message.blockHeight })
        return
      case 'reorg':
        this.target.clear()
        this.eventBus.emit(EventBus.REORG, { depth: message.reorgDepth ?? 0 })
    }
  }

  processJetStreamMessage (message: AckableMessage): void {
    try {
      this.consume(parseMessage(message))
      message.ack()
    } catch (error: unknown) {
      if (isMalformedError(error)) {
        message.term(error instanceof Error ? error.message : String(error))
        return
      }
      message.nak()
    }
  }
}

function parseMessage (message: AckableMessage): CacheInvalidationMessage {
  if (typeof message.json === 'function') return message.json<CacheInvalidationMessage>()
  if (typeof message.string === 'function') return JSON.parse(message.string()) as CacheInvalidationMessage
  throw new Error('cache invalidation message cannot be decoded')
}

function validateCacheInvalidationMessage (message: CacheInvalidationMessage): void {
  if (!isObjectRecord(message)) throw new Error('cache invalidation message must be an object')
  if (message.type !== 'block' && message.type !== 'utxo' && message.type !== 'reorg') throw new Error('cache invalidation message has invalid type')
  if (message.type === 'utxo' && !Array.isArray(message.outpoints)) throw new Error('utxo cache invalidation requires outpoints')
}

function isMalformedError (error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /invalid|requires|decode|object|type/i.test(message)
}
