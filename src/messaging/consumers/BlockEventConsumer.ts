import { BlockEventMessage, isObjectRecord } from '../messages'
import { ProofRequestPublisher, ProofRequestReference } from '../publishers/ProofRequestPublisher'

export interface PendingProofRequestSource {
  findPendingProofRequests: (message: BlockEventMessage) => Promise<ProofRequestReference[]>
}

export interface BlockEventAckableMessage {
  json?: <T = unknown>() => T
  string?: () => string
  ack: () => void
  nak: (delayMs?: number) => void
  term: (reason?: string) => void
}

export class BlockEventConsumer {
  constructor (
    private readonly pendingSource: PendingProofRequestSource,
    private readonly proofPublisher: Pick<ProofRequestPublisher, 'publishRequest'>
  ) {}

  async consume (message: BlockEventMessage): Promise<number> {
    validateBlockEventMessage(message)
    if (message.type !== 'mined') return 0
    const pending = await this.pendingSource.findPendingProofRequests(message)
    await Promise.all(pending.map(async request => await this.proofPublisher.publishRequest(request)))
    return pending.length
  }

  async processJetStreamMessage (message: BlockEventAckableMessage): Promise<number | undefined> {
    try {
      const count = await this.consume(parseBlockEventMessage(message))
      message.ack()
      return count
    } catch (error: unknown) {
      if (isMalformedBlockEvent(error)) {
        message.term(error instanceof Error ? error.message : String(error))
        return undefined
      }
      message.nak()
      return undefined
    }
  }
}

function parseBlockEventMessage (message: BlockEventAckableMessage): BlockEventMessage {
  if (typeof message.json === 'function') return message.json<BlockEventMessage>()
  if (typeof message.string === 'function') return JSON.parse(message.string()) as BlockEventMessage
  throw new Error('BlockEventMessage cannot be decoded')
}

function validateBlockEventMessage (message: BlockEventMessage): void {
  if (!isObjectRecord(message)) throw new Error('BlockEventMessage must be an object')
  if (message.type !== 'mined' && message.type !== 'reorg') throw new Error('BlockEventMessage.type is invalid')
  if (!Number.isFinite(message.blockHeight)) throw new Error('BlockEventMessage.blockHeight is required')
}

function isMalformedBlockEvent (error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /BlockEventMessage|JSON|object|decode|required|invalid/i.test(message)
}
