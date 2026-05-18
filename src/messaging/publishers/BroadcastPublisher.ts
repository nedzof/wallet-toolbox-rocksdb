import { Utils } from '@bsv/sdk'
import { PubAck } from 'nats'

import { NatsManager } from '../NatsManager'
import {
  assertTxBroadcastMessageSafe,
  createMessageMetadata,
  DistributedChain,
  TxBroadcastMessage
} from '../messages'
import { Chain } from '../../sdk/types'
import { doubleSha256BE } from '../../utility/utilityHelpers'
import { asString } from '../../utility/utilityHelpers.noBuffer'

export interface BroadcastPublisherOptions {
  natsManager: Pick<NatsManager, 'publishTxBroadcast'>
  chain: Chain
  source?: string
  walletStorageIdentityKey: string
}

export interface TxBroadcastReference {
  txid: string
  provenTxReqId: number
  rawTxHash?: string
  rawTx?: number[]
  providerPolicyRef?: string
  attempt: number
  priority?: number
  walletStorageIdentityKey?: string
}

export class BroadcastPublisher {
  readonly chain: DistributedChain
  readonly source: string
  readonly walletStorageIdentityKey: string

  constructor (private readonly options: BroadcastPublisherOptions) {
    this.chain = options.chain as DistributedChain
    this.source = options.source ?? 'wallet-toolbox-broadcast-publisher'
    this.walletStorageIdentityKey = options.walletStorageIdentityKey
  }

  async publish (reference: TxBroadcastReference): Promise<PubAck> {
    const message = this.createMessage(reference)
    assertTxBroadcastMessageSafe(message)
    return await this.options.natsManager.publishTxBroadcast(message)
  }

  createMessage (reference: TxBroadcastReference): TxBroadcastMessage {
    const walletStorageIdentityKey = reference.walletStorageIdentityKey ?? this.walletStorageIdentityKey
    const idempotencyKey = createTxBroadcastIdempotencyKey({
      chain: this.chain,
      walletStorageIdentityKey,
      provenTxReqId: reference.provenTxReqId,
      txid: reference.txid,
      attempt: reference.attempt
    })
    return {
      ...createMessageMetadata({
        chain: this.chain,
        source: this.source,
        idempotencyKey
      }),
      txid: reference.txid,
      rawTxHash: reference.rawTxHash ?? rawTxHash(reference.rawTx),
      providerPolicyRef: reference.providerPolicyRef,
      attempt: reference.attempt,
      priority: reference.priority ?? reference.attempt,
      walletStorageIdentityKey,
      provenTxReqId: reference.provenTxReqId
    }
  }
}

export interface TxBroadcastIdempotencyKeyArgs {
  chain: DistributedChain
  walletStorageIdentityKey: string
  provenTxReqId: number
  txid: string
  attempt: number
}

export function createTxBroadcastIdempotencyKey (args: TxBroadcastIdempotencyKeyArgs): string {
  return `${args.chain}:${args.walletStorageIdentityKey}:broadcast:${args.provenTxReqId}:${args.txid}:${args.attempt}`
}

function rawTxHash (rawTx?: number[]): string {
  if (rawTx == null || rawTx.length === 0) throw new Error('rawTxHash or rawTx is required for TxBroadcastMessage')
  return asString(doubleSha256BE(Utils.toArray(asString(rawTx), 'hex')))
}
