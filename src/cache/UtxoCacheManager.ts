import EventEmitter from 'eventemitter3'
import { LRUCache } from 'lru-cache'

import {
  GetUtxoStatusOutputFormat,
  GetUtxoStatusResult
} from '../sdk/WalletServices.interfaces'
import type { WalletToolboxMetrics } from '../metrics/WalletToolboxMetrics'
import { EventBus } from '../events/EventBus'

export interface UtxoCacheQuery {
  output: string
  outputFormat?: GetUtxoStatusOutputFormat
  outpoint: string
}

export interface UtxoCacheManagerOptions {
  max?: number
  ttlMs?: number
  events?: EventEmitter | EventBus
  metrics?: WalletToolboxMetrics
}

export class UtxoCacheManager {
  private readonly cache: LRUCache<string, GetUtxoStatusResult>
  private readonly inFlight = new Map<string, Promise<GetUtxoStatusResult>>()
  private readonly outpointKeys = new Map<string, Set<string>>()
  private readonly ttlMs: number
  private readonly events?: EventEmitter | EventBus
  private readonly metrics?: WalletToolboxMetrics
  private hits = 0
  private misses = 0
  private generation = 0
  private readonly onUtxoInvalidate = (event: { outpoints: string[] }): void => {
    this.invalidateOutpoints(event.outpoints)
  }

  private readonly onBlockMined = (event: { blockHeight: number }): void => {
    this.invalidateByBlock(event.blockHeight)
  }

  constructor (options: UtxoCacheManagerOptions = {}) {
    this.ttlMs = options.ttlMs ?? 30000
    this.events = options.events
    this.metrics = options.metrics
    this.cache = new LRUCache<string, GetUtxoStatusResult>({
      max: options.max ?? 10000,
      ttl: this.ttlMs,
      dispose: (_value, key) => {
        this.removeKeyFromOutpointMap(key)
        this.metrics?.setUtxoCacheSize(this.cache.size)
      }
    })
    this.events?.on(EventBus.UTXO_INVALIDATE, this.onUtxoInvalidate)
    this.events?.on(EventBus.BLOCK_MINED, this.onBlockMined)
  }

  async getOrLoad (
    query: UtxoCacheQuery,
    load: () => Promise<GetUtxoStatusResult>
  ): Promise<GetUtxoStatusResult> {
    const key = this.makeKey(query)
    const cached = this.cache.get(key)
    if (cached != null) {
      this.hits++
      this.metrics?.recordUtxoCacheRequest('hit', this.cache.size)
      this.events?.emit('utxoCacheHit', { key, query })
      return cloneUtxoResult(cached)
    }

    this.misses++
    this.metrics?.recordUtxoCacheRequest('miss', this.cache.size)
    this.events?.emit('utxoCacheMiss', { key, query })

    const existing = this.inFlight.get(key)
    if (existing != null) return cloneUtxoResult(await existing)

    const generation = this.generation
    const loading = load()
      .then(result => {
        if (result.status === 'success' && generation === this.generation) this.set(query, result)
        return result
      })
      .finally(() => {
        this.inFlight.delete(key)
      })
    this.inFlight.set(key, loading)
    return cloneUtxoResult(await loading)
  }

  set (query: UtxoCacheQuery, result: GetUtxoStatusResult): void {
    const key = this.makeKey(query)
    this.cache.set(key, cloneUtxoResult(result))
    let keys = this.outpointKeys.get(query.outpoint)
    if (keys == null) {
      keys = new Set<string>()
      this.outpointKeys.set(query.outpoint, keys)
    }
    keys.add(key)
    this.metrics?.setUtxoCacheSize(this.cache.size)
    this.events?.emit('utxoCacheSet', { key, query })
  }

  invalidateOutpoint (outpoint: string): number {
    this.generation++
    const keys = this.outpointKeys.get(outpoint)
    if (keys == null) return 0

    let removed = 0
    for (const key of keys) {
      if (this.cache.delete(key)) removed++
    }
    this.outpointKeys.delete(outpoint)
    this.metrics?.setUtxoCacheSize(this.cache.size)
    this.events?.emit('utxoCacheInvalidate', { outpoints: [outpoint], removed })
    return removed
  }

  invalidateOutpoints (outpoints: string[]): number {
    let removed = 0
    for (const outpoint of outpoints) removed += this.invalidateOutpoint(outpoint)
    return removed
  }

  invalidateByBlock (blockHeight: number): number {
    const removed = this.cache.size
    this.clear()
    this.events?.emit('utxoCacheInvalidateByBlock', { blockHeight, removed })
    return removed
  }

  clear (): void {
    this.generation++
    const removed = this.cache.size
    this.cache.clear()
    this.inFlight.clear()
    this.outpointKeys.clear()
    this.metrics?.setUtxoCacheSize(this.cache.size)
    this.events?.emit('utxoCacheClear', { removed })
  }

  close (): void {
    this.events?.off(EventBus.UTXO_INVALIDATE, this.onUtxoInvalidate)
    this.events?.off(EventBus.BLOCK_MINED, this.onBlockMined)
    this.clear()
  }

  getStats (): { size: number, ttlMs: number, hits: number, misses: number, hitRate: number } {
    const total = this.hits + this.misses
    return {
      size: this.cache.size,
      ttlMs: this.ttlMs,
      hits: this.hits,
      misses: this.misses,
      hitRate: total === 0 ? 0 : this.hits / total
    }
  }

  private makeKey (query: UtxoCacheQuery): string {
    return `${query.outputFormat ?? 'hashLE'}:${query.output}:${query.outpoint}`
  }

  private removeKeyFromOutpointMap (key: string): void {
    const outpoint = key.slice(key.lastIndexOf(':') + 1)
    const keys = this.outpointKeys.get(outpoint)
    if (keys == null) return
    keys.delete(key)
    if (keys.size === 0) this.outpointKeys.delete(outpoint)
  }
}

function cloneUtxoResult (result: GetUtxoStatusResult): GetUtxoStatusResult {
  return {
    ...result,
    details: result.details.map(d => ({ ...d }))
  }
}
