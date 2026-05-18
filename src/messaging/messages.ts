import { randomUUID } from 'crypto'

import { WERR_INVALID_PARAMETER } from '../sdk/WERR_errors'
import { Chain } from '../sdk/types'

export const DISTRIBUTED_MESSAGE_SCHEMA_VERSION = 1

export type DistributedChain = 'test' | 'main'

export interface BaseMessage {
  messageId: string
  idempotencyKey: string
  createdAtMs: number
  schemaVersion: number
  source: string
  chain: DistributedChain
}

export interface TxBroadcastMessage extends BaseMessage {
  txid: string
  rawTxHash: string
  providerPolicyRef?: string
  attempt: number
  priority: number
  walletStorageIdentityKey: string
  provenTxReqId: number
}

export interface UtxoStatusMessage extends BaseMessage {
  outpoints: string[]
  blockHeight?: number
  isUtxo?: boolean
  source: string
  observedAt: string
}

export interface BlockEventMessage extends BaseMessage {
  type: 'mined' | 'reorg'
  blockHeight: number
  blockHash?: string
  outpoints?: string[]
  reorgDepth?: number
}

export interface ProofRequestMessage extends BaseMessage {
  provenTxReqId: number
  txid: string
  walletStorageIdentityKey: string
  requestedAt: string
}

export interface ProofResultMessage extends BaseMessage {
  provenTxReqId: number
  txid: string
  status: 'completed' | 'unmined' | 'unknown' | 'doubleSpend' | 'invalidTx'
  blockHeight?: number
  merklePath?: string
  providerAttempts: string[]
  observedAt: string
}

export interface CacheInvalidationMessage extends BaseMessage {
  type: 'block' | 'utxo' | 'reorg'
  outpoints?: string[]
  blockHeight?: number
  reorgDepth?: number
}

export interface BroadcastDeadLetterMessage extends BaseMessage {
  originalStream: 'TX_BROADCAST'
  originalSubject?: string
  originalMessageId?: string
  originalIdempotencyKey?: string
  originalTxid?: string
  originalProvenTxReqId?: number
  reason: string
  deliveryCount?: number
  failedAt: string
}

export type DistributedMessage =
  | TxBroadcastMessage
  | UtxoStatusMessage
  | BlockEventMessage
  | ProofRequestMessage
  | ProofResultMessage
  | CacheInvalidationMessage
  | BroadcastDeadLetterMessage

export interface MessageMetadataArgs {
  idempotencyKey: string
  chain: Chain
  source: string
  createdAtMs?: number
  messageId?: string
}

export function createMessageMetadata (args: MessageMetadataArgs): BaseMessage {
  return {
    messageId: args.messageId ?? randomUUID(),
    idempotencyKey: args.idempotencyKey,
    createdAtMs: args.createdAtMs ?? Date.now(),
    schemaVersion: DISTRIBUTED_MESSAGE_SCHEMA_VERSION,
    source: args.source,
    chain: toDistributedChain(args.chain)
  }
}

export function toDistributedChain (chain: Chain): DistributedChain {
  if (chain === 'test' || chain === 'main') return chain
  throw new WERR_INVALID_PARAMETER('chain', '\'test\' or \'main\' for distributed messaging')
}

export function assertTxBroadcastMessageSafe (message: TxBroadcastMessage): void {
  const payload = message as unknown as Record<string, unknown>
  for (const key of ['rawTx', 'rawTxHex', 'rawTransaction', 'transactionBytes']) {
    if (payload[key] !== undefined) {
      throw new WERR_INVALID_PARAMETER(`TxBroadcastMessage.${key}`, 'undefined; raw transaction bytes must not be published')
    }
  }
}

export function isObjectRecord (value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}
