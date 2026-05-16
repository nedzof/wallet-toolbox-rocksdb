import { Counter, Gauge, Histogram, Registry } from 'prom-client'

export type CacheResult = 'hit' | 'miss'

export class WalletToolboxMetrics {
  readonly registry: Registry

  private readonly utxoCacheRequests: Counter<string>
  private readonly blockHeaderCacheRequests: Counter<string>
  private readonly utxoCacheSize: Gauge<string>
  private readonly blockHeaderCacheSize: Gauge<string>
  private readonly utxoCacheHitRate: Gauge<string>
  private readonly blockHeaderCacheHitRate: Gauge<string>
  private readonly postBeefDuration: Histogram<string>
  private readonly postBeefQueueSize: Gauge<string>
  private readonly postBeefQueuePending: Gauge<string>
  private readonly sendWaitingQueueSize: Gauge<string>
  private readonly sendWaitingQueuePending: Gauge<string>
  private readonly storageQueryDuration: Histogram<string>
  private utxoCacheHits = 0
  private utxoCacheMisses = 0
  private blockHeaderCacheHits = 0
  private blockHeaderCacheMisses = 0

  constructor (prefix = 'wallet_toolbox') {
    this.registry = new Registry()

    this.utxoCacheRequests = new Counter({
      name: `${prefix}_utxo_cache_requests_total`,
      help: 'UTXO status cache lookups by result.',
      labelNames: ['result'],
      registers: [this.registry]
    })
    this.blockHeaderCacheRequests = new Counter({
      name: `${prefix}_block_header_cache_requests_total`,
      help: 'Block header cache lookups by result.',
      labelNames: ['result'],
      registers: [this.registry]
    })
    this.utxoCacheSize = new Gauge({
      name: `${prefix}_utxo_cache_entries`,
      help: 'Current UTXO status cache entry count.',
      registers: [this.registry]
    })
    this.utxoCacheHitRate = new Gauge({
      name: `${prefix}_utxo_cache_hit_rate`,
      help: 'Current UTXO status cache hit rate since process start.',
      registers: [this.registry]
    })
    this.blockHeaderCacheSize = new Gauge({
      name: `${prefix}_block_header_cache_entries`,
      help: 'Current block header cache entry count.',
      registers: [this.registry]
    })
    this.blockHeaderCacheHitRate = new Gauge({
      name: `${prefix}_block_header_cache_hit_rate`,
      help: 'Current block header cache hit rate since process start.',
      registers: [this.registry]
    })
    this.postBeefDuration = new Histogram({
      name: `${prefix}_post_beef_provider_duration_seconds`,
      help: 'postBeef provider call duration.',
      labelNames: ['provider', 'status'],
      buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
      registers: [this.registry]
    })
    this.postBeefQueueSize = new Gauge({
      name: `${prefix}_post_beef_queue_size`,
      help: 'Queued postBeef provider calls waiting to run.',
      registers: [this.registry]
    })
    this.postBeefQueuePending = new Gauge({
      name: `${prefix}_post_beef_queue_pending`,
      help: 'postBeef provider calls currently running.',
      registers: [this.registry]
    })
    this.sendWaitingQueueSize = new Gauge({
      name: `${prefix}_send_waiting_queue_size`,
      help: 'Queued SendWaiting broadcast work items waiting to run.',
      registers: [this.registry]
    })
    this.sendWaitingQueuePending = new Gauge({
      name: `${prefix}_send_waiting_queue_pending`,
      help: 'SendWaiting broadcast work items currently running.',
      registers: [this.registry]
    })
    this.storageQueryDuration = new Histogram({
      name: `${prefix}_storage_query_duration_seconds`,
      help: 'Storage query duration by operation.',
      labelNames: ['operation'],
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
      registers: [this.registry]
    })
  }

  recordUtxoCacheRequest (result: CacheResult, size: number): void {
    this.utxoCacheRequests.inc({ result })
    this.utxoCacheSize.set(size)
    if (result === 'hit') this.utxoCacheHits++
    else this.utxoCacheMisses++
    this.utxoCacheHitRate.set(hitRate(this.utxoCacheHits, this.utxoCacheMisses))
  }

  setUtxoCacheSize (size: number): void {
    this.utxoCacheSize.set(size)
  }

  recordBlockHeaderCacheRequest (result: CacheResult, size: number): void {
    this.blockHeaderCacheRequests.inc({ result })
    this.blockHeaderCacheSize.set(size)
    if (result === 'hit') this.blockHeaderCacheHits++
    else this.blockHeaderCacheMisses++
    this.blockHeaderCacheHitRate.set(hitRate(this.blockHeaderCacheHits, this.blockHeaderCacheMisses))
  }

  setBlockHeaderCacheSize (size: number): void {
    this.blockHeaderCacheSize.set(size)
  }

  recordPostBeefProvider (provider: string, status: string, durationMs: number): void {
    this.postBeefDuration.observe({ provider, status }, durationMs / 1000)
  }

  setPostBeefQueue (size: number, pending: number): void {
    this.postBeefQueueSize.set(size)
    this.postBeefQueuePending.set(pending)
  }

  setSendWaitingQueue (size: number, pending: number): void {
    this.sendWaitingQueueSize.set(size)
    this.sendWaitingQueuePending.set(pending)
  }

  recordStorageQuery (operation: string, durationMs: number): void {
    this.storageQueryDuration.observe({ operation }, durationMs / 1000)
  }

  async metrics (): Promise<string> {
    return await this.registry.metrics()
  }

  get contentType (): string {
    return this.registry.contentType
  }
}

function hitRate (hits: number, misses: number): number {
  const total = hits + misses
  return total === 0 ? 0 : hits / total
}
