import {
  AckPolicy,
  ConnectionOptions,
  connect,
  ConsumerConfig,
  DeliverPolicy,
  DiscardPolicy,
  JetStreamClient,
  JetStreamManager,
  JetStreamPublishOptions,
  JsMsg,
  nanos,
  NatsConnection,
  PubAck,
  PullOptions,
  QueuedIterator,
  RetentionPolicy,
  StorageType,
  StreamConfig,
  StringCodec
} from 'nats'

import {
  BlockEventMessage,
  BroadcastDeadLetterMessage,
  CacheInvalidationMessage,
  ProofRequestMessage,
  ProofResultMessage,
  TxBroadcastMessage,
  UtxoStatusMessage
} from './messages'

export type NatsStreamName = 'TX_BROADCAST' | 'UTXO_STATUS' | 'BLOCK_EVENTS' | 'PROOF_REQUESTS' | 'CACHE_INVALIDATE' | 'DEAD_LETTER'

export interface NatsStreamDefinition {
  name: NatsStreamName
  subjects: string[]
  maxAgeMs: number
  maxBytes: number
  duplicateWindowMs: number
}

export interface NatsManagerOptions {
  url?: string
  source?: string
  replicas?: number
  connectionOptions?: Partial<ConnectionOptions>
  connection?: NatsConnection
  jetstream?: JetStreamClient
  jetstreamManager?: JetStreamManager
  streamConfigs?: Partial<Record<NatsStreamName, Partial<StreamConfig>>>
}

export interface NatsHealth {
  connected: boolean
  draining: boolean
  closed: boolean
  server?: string
}

export const NATS_STREAM_DEFINITIONS: Record<NatsStreamName, NatsStreamDefinition> = {
  TX_BROADCAST: {
    name: 'TX_BROADCAST',
    subjects: ['tx.broadcast.>'],
    maxAgeMs: 7 * 24 * 60 * 60 * 1000,
    maxBytes: 10 * 1024 * 1024 * 1024,
    duplicateWindowMs: 2 * 60 * 1000
  },
  UTXO_STATUS: {
    name: 'UTXO_STATUS',
    subjects: ['utxo.status.>', 'utxo.invalidate.>'],
    maxAgeMs: 24 * 60 * 60 * 1000,
    maxBytes: 5 * 1024 * 1024 * 1024,
    duplicateWindowMs: 2 * 60 * 1000
  },
  BLOCK_EVENTS: {
    name: 'BLOCK_EVENTS',
    subjects: ['block.>'],
    maxAgeMs: 30 * 24 * 60 * 60 * 1000,
    maxBytes: 10 * 1024 * 1024 * 1024,
    duplicateWindowMs: 2 * 60 * 1000
  },
  PROOF_REQUESTS: {
    name: 'PROOF_REQUESTS',
    subjects: ['proof.request.>', 'proof.result.>'],
    maxAgeMs: 7 * 24 * 60 * 60 * 1000,
    maxBytes: 10 * 1024 * 1024 * 1024,
    duplicateWindowMs: 2 * 60 * 1000
  },
  CACHE_INVALIDATE: {
    name: 'CACHE_INVALIDATE',
    subjects: ['cache.invalidate.>'],
    maxAgeMs: 60 * 60 * 1000,
    maxBytes: 1024 * 1024 * 1024,
    duplicateWindowMs: 30 * 1000
  },
  DEAD_LETTER: {
    name: 'DEAD_LETTER',
    subjects: ['deadletter.>'],
    maxAgeMs: 7 * 24 * 60 * 60 * 1000,
    maxBytes: 1024 * 1024 * 1024,
    duplicateWindowMs: 2 * 60 * 1000
  }
}

export const NATS_CONSUMER_DEFAULTS: Record<NatsStreamName, Partial<ConsumerConfig>> = {
  TX_BROADCAST: {
    durable_name: 'broadcast-workers',
    ack_policy: AckPolicy.Explicit,
    max_deliver: 3,
    ack_wait: nanos(30_000),
    max_ack_pending: 500,
    deliver_policy: DeliverPolicy.All
  },
  UTXO_STATUS: {
    durable_name: 'utxo-cache-workers',
    ack_policy: AckPolicy.Explicit,
    max_deliver: 3,
    ack_wait: nanos(15_000),
    max_ack_pending: 1000,
    deliver_policy: DeliverPolicy.All
  },
  BLOCK_EVENTS: {
    durable_name: 'block-event-workers',
    ack_policy: AckPolicy.Explicit,
    max_deliver: 5,
    ack_wait: nanos(30_000),
    max_ack_pending: 1000,
    deliver_policy: DeliverPolicy.All
  },
  PROOF_REQUESTS: {
    durable_name: 'proof-workers',
    ack_policy: AckPolicy.Explicit,
    max_deliver: 5,
    ack_wait: nanos(60_000),
    max_ack_pending: 500,
    deliver_policy: DeliverPolicy.All
  },
  CACHE_INVALIDATE: {
    durable_name: 'cache-workers',
    ack_policy: AckPolicy.Explicit,
    max_deliver: 3,
    ack_wait: nanos(10_000),
    max_ack_pending: 1000,
    deliver_policy: DeliverPolicy.All
  },
  DEAD_LETTER: {
    durable_name: 'dead-letter-operators',
    ack_policy: AckPolicy.Explicit,
    max_deliver: 1,
    ack_wait: nanos(60_000),
    max_ack_pending: 1000,
    deliver_policy: DeliverPolicy.All
  }
}

const codec = StringCodec()

export class NatsManager {
  private connection?: NatsConnection
  private jetstream?: JetStreamClient
  private manager?: JetStreamManager
  private readonly options: NatsManagerOptions

  constructor (options: NatsManagerOptions = {}) {
    this.options = options
    this.connection = options.connection
    this.jetstream = options.jetstream
    this.manager = options.jetstreamManager
  }

  async connect (): Promise<NatsConnection> {
    if (this.connection != null && !this.connection.isClosed()) return this.connection

    const url = this.options.url ?? process.env.NATS_URL ?? 'nats://localhost:4222'
    const connectionOptions: Partial<ConnectionOptions> = {
      servers: url,
      name: this.options.source ?? 'wallet-toolbox-rocksdb',
      user: process.env.NATS_USER || undefined,
      pass: process.env.NATS_PASSWORD || undefined,
      token: process.env.NATS_TOKEN || undefined,
      ...this.options.connectionOptions
    }
    this.connection = await connect(connectionOptions)
    this.jetstream = this.options.jetstream ?? this.connection.jetstream()
    this.manager = this.options.jetstreamManager ?? await this.connection.jetstreamManager()
    return this.connection
  }

  async initializeStreams (): Promise<void> {
    const manager = await this.getManager()
    for (const streamName of Object.keys(NATS_STREAM_DEFINITIONS) as NatsStreamName[]) {
      const config = this.createStreamConfig(streamName)
      try {
        await manager.streams.info(streamName)
        await manager.streams.update(streamName, config)
      } catch (error: unknown) {
        if (!isMissingResourceError(error)) throw error
        await manager.streams.add(config)
      }
    }
  }

  async ensureConsumer (
    streamName: NatsStreamName,
    durableName = NATS_CONSUMER_DEFAULTS[streamName].durable_name!,
    config: Partial<ConsumerConfig> = {}
  ): Promise<void> {
    const manager = await this.getManager()
    const mergedConfig: Partial<ConsumerConfig> = {
      ...NATS_CONSUMER_DEFAULTS[streamName],
      durable_name: durableName,
      ...config
    }
    try {
      await manager.consumers.info(streamName, durableName)
      await manager.consumers.update(streamName, durableName, mergedConfig)
    } catch (error: unknown) {
      if (!isMissingResourceError(error)) throw error
      await manager.consumers.add(streamName, mergedConfig)
    }
  }

  async pullMessages (
    streamName: NatsStreamName,
    durableName = NATS_CONSUMER_DEFAULTS[streamName].durable_name!,
    options: Partial<PullOptions> = {}
  ): Promise<QueuedIterator<JsMsg>> {
    const jetstream = await this.getJetStream()
    return jetstream.fetch(streamName, durableName, options)
  }

  async publishJson<T extends { idempotencyKey: string }> (
    subject: string,
    message: T,
    options: Partial<JetStreamPublishOptions> = {}
  ): Promise<PubAck> {
    const jetstream = await this.getJetStream()
    return await jetstream.publish(
      subject,
      codec.encode(JSON.stringify(message)),
      {
        msgID: message.idempotencyKey,
        ...options
      }
    )
  }

  async publishTxBroadcast (message: TxBroadcastMessage): Promise<PubAck> {
    return await this.publishJson(`tx.broadcast.${message.chain}`, message)
  }

  async publishUtxoStatus (message: UtxoStatusMessage): Promise<PubAck> {
    return await this.publishJson(`utxo.status.${message.chain}`, message)
  }

  async publishBlockEvent (message: BlockEventMessage): Promise<PubAck> {
    return await this.publishJson(`block.${message.chain}.${message.type}`, message)
  }

  async publishProofRequest (message: ProofRequestMessage): Promise<PubAck> {
    return await this.publishJson(`proof.request.${message.chain}`, message)
  }

  async publishProofResult (message: ProofResultMessage): Promise<PubAck> {
    return await this.publishJson(`proof.result.${message.chain}`, message)
  }

  async publishCacheInvalidation (message: CacheInvalidationMessage): Promise<PubAck> {
    return await this.publishJson(`cache.invalidate.${message.chain}`, message)
  }

  async publishBroadcastDeadLetter (message: BroadcastDeadLetterMessage): Promise<PubAck> {
    return await this.publishJson(`deadletter.tx.broadcast.${message.chain}`, message)
  }

  ack (message: Pick<JsMsg, 'ack'>): void {
    message.ack()
  }

  nak (message: Pick<JsMsg, 'nak'>, delayMs?: number): void {
    message.nak(delayMs)
  }

  term (message: Pick<JsMsg, 'term'>, reason?: string): void {
    message.term(reason)
  }

  health (): NatsHealth {
    return {
      connected: this.connection != null && !this.connection.isClosed() && !this.connection.isDraining(),
      draining: this.connection?.isDraining() ?? false,
      closed: this.connection?.isClosed() ?? true,
      server: this.connection?.getServer()
    }
  }

  async close (): Promise<void> {
    const connection = this.connection
    if (connection == null || connection.isClosed()) return
    await connection.drain()
  }

  private async getJetStream (): Promise<JetStreamClient> {
    if (this.jetstream == null) await this.connect()
    return this.jetstream!
  }

  private async getManager (): Promise<JetStreamManager> {
    if (this.manager == null) await this.connect()
    return this.manager!
  }

  private createStreamConfig (streamName: NatsStreamName): Partial<StreamConfig> {
    const definition = NATS_STREAM_DEFINITIONS[streamName]
    return {
      name: streamName,
      subjects: [...definition.subjects],
      retention: RetentionPolicy.Limits,
      storage: StorageType.File,
      discard: DiscardPolicy.Old,
      max_age: nanos(definition.maxAgeMs),
      max_bytes: positiveIntFromEnv(streamMaxBytesEnvNames(streamName), definition.maxBytes),
      duplicate_window: nanos(definition.duplicateWindowMs),
      num_replicas: this.options.replicas ?? positiveIntFromEnv('NATS_REPLICAS', 1),
      ...this.options.streamConfigs?.[streamName]
    }
  }
}

function isMissingResourceError (error: unknown): boolean {
  const status = (error as { api_error?: { code?: number }, code?: number, status?: number }).api_error?.code ??
    (error as { code?: number, status?: number }).code ??
    (error as { status?: number }).status
  if (status === 404) return true
  const message = error instanceof Error ? error.message : String(error)
  return /not found|stream.*missing|consumer.*missing|no response/i.test(message)
}

function streamMaxBytesEnvNames (streamName: NatsStreamName): string[] {
  return [
    `WALLET_TOOLBOX_NATS_${streamName}_MAX_BYTES`,
    `NATS_${streamName}_MAX_BYTES`,
    'WALLET_TOOLBOX_NATS_STREAM_MAX_BYTES'
  ]
}

function positiveIntFromEnv (names: string | string[], fallback: number): number {
  const envNames = Array.isArray(names) ? names : [names]
  for (const name of envNames) {
    const rawValue = process.env[name]
    if (rawValue == null || rawValue.trim() === '') continue
    const value = Number(rawValue)
    if (Number.isSafeInteger(value) && value > 0) return value
  }
  return fallback
}
