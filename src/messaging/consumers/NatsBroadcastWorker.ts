import { ConsumerConfig, JsMsg, PullOptions, QueuedIterator } from 'nats'

import { NatsManager } from '../NatsManager'
import {
  BroadcastConsumer,
  BroadcastDeadLetterPublisher,
  BroadcastJetStreamOptions,
  BroadcastRequestLoader,
  BroadcastAttemptRecorder
} from './BroadcastConsumer'

export interface NatsBroadcastWorkerOptions {
  natsManager: Pick<NatsManager, 'ensureConsumer' | 'pullMessages'> & BroadcastDeadLetterPublisher
  consumer: BroadcastConsumer
  loader: BroadcastRequestLoader
  recorder: BroadcastAttemptRecorder
  durableName?: string
  batchSize?: number
  expiresMs?: number
  retryBackoffMs?: number
  maxDeliver?: number
  consumerConfig?: Partial<ConsumerConfig>
}

export interface NatsBroadcastWorkerBatchResult {
  received: number
  processed: number
}

export class NatsBroadcastWorker {
  private closed = false

  constructor (private readonly options: NatsBroadcastWorkerOptions) {}

  async processBatch (): Promise<NatsBroadcastWorkerBatchResult> {
    if (this.closed) return { received: 0, processed: 0 }
    const durableName = this.options.durableName ?? 'broadcast-workers'
    await this.options.natsManager.ensureConsumer('TX_BROADCAST', durableName, this.options.consumerConfig)
    const iterator = await this.options.natsManager.pullMessages('TX_BROADCAST', durableName, this.fetchOptions())
    return await this.consumeIterator(iterator)
  }

  async close (): Promise<void> {
    this.closed = true
    await this.options.consumer.close()
  }

  private fetchOptions (): Partial<PullOptions> {
    return {
      batch: this.options.batchSize ?? 100,
      expires: this.options.expiresMs ?? 30_000
    }
  }

  private async consumeIterator (iterator: QueuedIterator<JsMsg>): Promise<NatsBroadcastWorkerBatchResult> {
    let received = 0
    let processed = 0
    try {
      for await (const message of iterator) {
        received++
        if (this.closed) break
        await this.options.consumer.consumeJetStreamMessage(
          message,
          this.options.loader,
          this.options.recorder,
          this.jetStreamOptions()
        )
        processed++
      }
    } finally {
      iterator.stop()
    }
    return { received, processed }
  }

  private jetStreamOptions (): BroadcastJetStreamOptions {
    return {
      deadLetterPublisher: this.options.natsManager,
      maxDeliver: this.options.maxDeliver,
      retryBackoffMs: this.options.retryBackoffMs
    }
  }
}
