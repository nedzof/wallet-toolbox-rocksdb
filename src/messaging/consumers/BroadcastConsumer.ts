import {
  BroadcastOrchestrator,
  BroadcastOrchestratorOptions,
  BroadcastRequest
} from '../../broadcast/BroadcastOrchestrator'
import { PostBeefResult, WalletServices } from '../../sdk/WalletServices.interfaces'
import { WERR_INVALID_OPERATION } from '../../sdk/WERR_errors'
import { doubleSha256BE } from '../../utility/utilityHelpers'
import { asArray, asString } from '../../utility/utilityHelpers.noBuffer'
import {
  BroadcastDeadLetterMessage,
  createMessageMetadata,
  DistributedChain,
  isObjectRecord,
  TxBroadcastMessage
} from '../messages'

export type BroadcastProviderOutcome =
  | 'seen'
  | 'already_seen'
  | 'accepted'
  | 'rejected_terminal'
  | 'rejected_retryable'
  | 'rate_limited'
  | 'timeout'
  | 'unknown'
  | 'malformed'

export interface BroadcastAttemptRecord {
  message: TxBroadcastMessage
  results: PostBeefResult[]
  outcome: BroadcastProviderOutcome
}

export interface BroadcastRequestLoader {
  loadBroadcastRequest: (message: TxBroadcastMessage) => Promise<BroadcastRequest>
}

export interface BroadcastAttemptRecorder {
  recordBroadcastAttempt: (record: BroadcastAttemptRecord) => Promise<void>
}

export interface BroadcastAckableMessage {
  json?: <T = unknown>() => T
  string?: () => string
  subject?: string
  info?: { deliveryCount?: number }
  ack: () => void
  nak: (delayMs?: number) => void
  term: (reason?: string) => void
}

export interface BroadcastDeadLetterPublisher {
  publishBroadcastDeadLetter: (message: BroadcastDeadLetterMessage) => Promise<unknown>
}

export interface BroadcastJetStreamOptions {
  deadLetterPublisher?: BroadcastDeadLetterPublisher
  maxDeliver?: number
  deadLetterChain?: DistributedChain
  source?: string
  retryBackoffMs?: number
}

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

  async consumeJetStreamMessage (
    ackable: BroadcastAckableMessage,
    loader: BroadcastRequestLoader,
    recorder: BroadcastAttemptRecorder,
    options: BroadcastJetStreamOptions = {}
  ): Promise<PostBeefResult[] | undefined> {
    let message: TxBroadcastMessage | undefined
    try {
      const payload = readTxBroadcastPayload(ackable)
      if (isObjectRecord(payload)) message = payload as unknown as TxBroadcastMessage
      validateTxBroadcastMessage(payload)
      const validMessage = payload
      message = validMessage
      const request = await loader.loadBroadcastRequest(validMessage)
      validateRawTxHash(validMessage, request)
      const results = await this.consume(request)
      const outcome = classifyBroadcastResults(results, validMessage.txid)
      await recorder.recordBroadcastAttempt({ message: validMessage, results, outcome })
      if (isRetryableBroadcastOutcome(outcome)) {
        if (hasExceededMaxDeliver(ackable, options.maxDeliver)) {
          await publishDeadLetter(ackable, message, new Error(`retryable broadcast outcome exceeded max deliveries: ${outcome}`), options)
          ackable.term(outcome)
        } else {
          ackable.nak(options.retryBackoffMs)
        }
        return results
      }
      ackable.ack()
      return results
    } catch (error: unknown) {
      if (isMalformedBroadcastError(error)) {
        await publishDeadLetter(ackable, message, error, options)
        ackable.term(error instanceof Error ? error.message : String(error))
        return undefined
      }
      if (hasExceededMaxDeliver(ackable, options.maxDeliver)) {
        await publishDeadLetter(ackable, message, error, options)
        ackable.term(error instanceof Error ? error.message : String(error))
        return undefined
      }
      ackable.nak()
      return undefined
    }
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

export function classifyBroadcastResults (results: PostBeefResult[], txid: string): BroadcastProviderOutcome {
  if (!Array.isArray(results)) return 'malformed'
  if (results.length === 0) return 'unknown'

  let sawServiceError = false
  let sawStatusError = false
  for (const result of results) {
    if (result == null || !Array.isArray(result.txidResults)) return 'malformed'
    const txResult = result.txidResults.find(r => r.txid === txid)
    if (txResult == null) continue
    if (txResult.status === 'success' && txResult.alreadyKnown === true) return 'already_seen'
    if (txResult.status === 'success') return result.status === 'success' ? 'accepted' : 'seen'
    if (txResult.doubleSpend === true) return 'rejected_terminal'
    if (txResult.serviceError === true) {
      const text = JSON.stringify(txResult.data ?? result.error ?? '')
      if (/rate.?limit|429/i.test(text)) return 'rate_limited'
      if (/timeout|timed out/i.test(text)) return 'timeout'
      sawServiceError = true
    } else {
      sawStatusError = true
    }
  }
  if (sawServiceError) return 'rejected_retryable'
  if (sawStatusError) return 'rejected_terminal'
  return 'unknown'
}

function readTxBroadcastPayload (message: BroadcastAckableMessage): unknown {
  return typeof message.json === 'function'
    ? message.json<TxBroadcastMessage>()
    : (typeof message.string === 'function' ? JSON.parse(message.string()) as TxBroadcastMessage : undefined)
}

function validateTxBroadcastMessage (message: unknown): asserts message is TxBroadcastMessage {
  if (!isObjectRecord(message)) throw new Error('TxBroadcastMessage must be an object')
  for (const key of ['messageId', 'idempotencyKey', 'source', 'chain', 'txid', 'rawTxHash', 'walletStorageIdentityKey']) {
    if (typeof message[key] !== 'string' || (message[key] as string).trim() === '') throw new Error(`TxBroadcastMessage.${key} is required`)
  }
  for (const key of ['createdAtMs', 'schemaVersion', 'attempt', 'priority', 'provenTxReqId']) {
    if (!Number.isFinite(message[key])) throw new Error(`TxBroadcastMessage.${key} is required`)
  }
  for (const key of ['rawTx', 'rawTxHex', 'rawTransaction', 'transactionBytes']) {
    if (message[key] !== undefined) throw new Error(`TxBroadcastMessage.${key} must not be present`)
  }
}

function validateRawTxHash (message: TxBroadcastMessage, request: BroadcastRequest): void {
  if (request.rawTx == null) return
  const hash = asString(doubleSha256BE(asArray(request.rawTx)))
  if (hash.toLowerCase() !== message.rawTxHash.toLowerCase()) {
    throw new Error('TxBroadcastMessage.rawTxHash does not match loaded rawTx')
  }
}

function isMalformedBroadcastError (error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /TxBroadcastMessage|rawTxHash|JSON|Unexpected|object|must not|required|malformed/i.test(message)
}

function isRetryableBroadcastOutcome (outcome: BroadcastProviderOutcome): boolean {
  return outcome === 'rejected_retryable' || outcome === 'rate_limited' || outcome === 'timeout'
}

function hasExceededMaxDeliver (message: BroadcastAckableMessage, maxDeliver = 3): boolean {
  const deliveryCount = message.info?.deliveryCount
  return Number.isFinite(deliveryCount) && deliveryCount! >= maxDeliver
}

async function publishDeadLetter (
  ackable: BroadcastAckableMessage,
  message: TxBroadcastMessage | undefined,
  error: unknown,
  options: BroadcastJetStreamOptions
): Promise<void> {
  const publisher = options.deadLetterPublisher
  if (publisher == null) return
  const reason = error instanceof Error ? error.message : String(error)
  const chain = message?.chain ?? options.deadLetterChain ?? 'test'
  const originalIdempotencyKey = message?.idempotencyKey
  const deliveryCount = ackable.info?.deliveryCount
  const idempotencyKey = [
    chain,
    message?.walletStorageIdentityKey ?? 'unknown-wallet',
    'broadcast-deadletter',
    message?.provenTxReqId ?? 'malformed',
    message?.txid ?? 'unknown-txid',
    deliveryCount ?? 0
  ].join(':')
  await publisher.publishBroadcastDeadLetter({
    ...createMessageMetadata({
      chain,
      source: options.source ?? 'wallet-toolbox-broadcast-consumer',
      idempotencyKey
    }),
    originalStream: 'TX_BROADCAST',
    originalSubject: ackable.subject,
    originalMessageId: message?.messageId,
    originalIdempotencyKey,
    originalTxid: message?.txid,
    originalProvenTxReqId: message?.provenTxReqId,
    reason,
    deliveryCount,
    failedAt: new Date().toISOString()
  })
}
