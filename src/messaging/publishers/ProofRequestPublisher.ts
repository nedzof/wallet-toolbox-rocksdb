import type { PubAck } from 'nats'

import { Chain } from '../../sdk/types'
import { NatsManager } from '../NatsManager'
import {
  createMessageMetadata,
  DistributedChain,
  ProofRequestMessage,
  ProofResultMessage,
  toDistributedChain
} from '../messages'

export interface ProofRequestPublisherOptions {
  natsManager: Pick<NatsManager, 'publishProofRequest' | 'publishProofResult'>
  chain: Chain
  source?: string
  walletStorageIdentityKey: string
}

export interface ProofRequestReference {
  provenTxReqId: number
  txid: string
  walletStorageIdentityKey?: string
  requestedAt?: string
}

export class ProofRequestPublisher {
  readonly chain: DistributedChain
  readonly source: string
  readonly walletStorageIdentityKey: string

  constructor (private readonly options: ProofRequestPublisherOptions) {
    this.chain = toDistributedChain(options.chain)
    this.source = options.source ?? 'wallet-toolbox-proof-request-publisher'
    this.walletStorageIdentityKey = options.walletStorageIdentityKey
  }

  async publishRequest (reference: ProofRequestReference): Promise<PubAck> {
    return await this.options.natsManager.publishProofRequest(this.createRequestMessage(reference))
  }

  async publishResult (message: ProofResultMessage): Promise<PubAck> {
    return await this.options.natsManager.publishProofResult(message)
  }

  createRequestMessage (reference: ProofRequestReference): ProofRequestMessage {
    const walletStorageIdentityKey = reference.walletStorageIdentityKey ?? this.walletStorageIdentityKey
    const idempotencyKey = `${this.chain}:${walletStorageIdentityKey}:proof-request:${reference.provenTxReqId}:${reference.txid}`
    return {
      ...createMessageMetadata({
        chain: this.chain,
        source: this.source,
        idempotencyKey
      }),
      provenTxReqId: reference.provenTxReqId,
      txid: reference.txid,
      walletStorageIdentityKey,
      requestedAt: reference.requestedAt ?? new Date().toISOString()
    }
  }
}
