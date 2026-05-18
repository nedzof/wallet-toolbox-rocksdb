import { createMessageMetadata, isObjectRecord, ProofRequestMessage, ProofResultMessage } from '../messages'

export interface ProofRequestProcessor {
  processProofRequest: (message: ProofRequestMessage) => Promise<Omit<ProofResultMessage, 'messageId' | 'idempotencyKey' | 'createdAtMs' | 'schemaVersion' | 'source' | 'chain'>>
}

export interface ProofResultRecorder {
  recordProofResult: (message: ProofRequestMessage, result: ProofResultMessage) => Promise<void>
}

export interface ProofResultPublisher {
  publishResult: (message: ProofResultMessage) => Promise<unknown>
}

export interface ProofAckableMessage {
  json?: <T = unknown>() => T
  string?: () => string
  ack: () => void
  nak: (delayMs?: number) => void
  term: (reason?: string) => void
}

export class ProofRequestConsumer {
  constructor (
    private readonly processor: ProofRequestProcessor,
    private readonly recorder: ProofResultRecorder,
    private readonly publisher?: ProofResultPublisher,
    private readonly source = 'wallet-toolbox-proof-request-consumer'
  ) {}

  async consume (message: ProofRequestMessage): Promise<ProofResultMessage> {
    validateProofRequestMessage(message)
    const resultBody = await this.processor.processProofRequest(message)
    const result: ProofResultMessage = {
      ...createMessageMetadata({
        chain: message.chain,
        source: this.source,
        idempotencyKey: `${message.chain}:${message.walletStorageIdentityKey}:proof-result:${message.provenTxReqId}:${message.txid}:${resultBody.status}`
      }),
      ...resultBody,
      provenTxReqId: message.provenTxReqId,
      txid: message.txid
    }
    await this.recorder.recordProofResult(message, result)
    await this.publisher?.publishResult(result)
    return result
  }

  async processJetStreamMessage (message: ProofAckableMessage): Promise<ProofResultMessage | undefined> {
    try {
      const result = await this.consume(parseProofRequestMessage(message))
      message.ack()
      return result
    } catch (error: unknown) {
      if (isMalformedProofMessage(error)) {
        message.term(error instanceof Error ? error.message : String(error))
        return undefined
      }
      message.nak()
      return undefined
    }
  }
}

function parseProofRequestMessage (message: ProofAckableMessage): ProofRequestMessage {
  if (typeof message.json === 'function') return message.json<ProofRequestMessage>()
  if (typeof message.string === 'function') return JSON.parse(message.string()) as ProofRequestMessage
  throw new Error('ProofRequestMessage cannot be decoded')
}

function validateProofRequestMessage (message: ProofRequestMessage): void {
  if (!isObjectRecord(message)) throw new Error('ProofRequestMessage must be an object')
  for (const key of ['messageId', 'idempotencyKey', 'source', 'chain', 'txid', 'walletStorageIdentityKey', 'requestedAt']) {
    if (typeof message[key] !== 'string' || (message[key] as string).trim() === '') throw new Error(`ProofRequestMessage.${key} is required`)
  }
  if (!Number.isFinite(message.provenTxReqId)) throw new Error('ProofRequestMessage.provenTxReqId is required')
}

function isMalformedProofMessage (error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /ProofRequestMessage|JSON|object|decode|required/i.test(message)
}
