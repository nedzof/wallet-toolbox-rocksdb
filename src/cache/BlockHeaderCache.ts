import EventEmitter from 'eventemitter3'
import NodeCache from 'node-cache'

import type { BlockHeader } from '../sdk/WalletServices.interfaces'
import type { WalletToolboxMetrics } from '../metrics/WalletToolboxMetrics'
import { EventBus } from '../events/EventBus'

export interface BlockHeaderCacheOptions {
  ttlMs?: number
  maxEntries?: number
  events?: EventEmitter | EventBus
  metrics?: WalletToolboxMetrics
}

export class BlockHeaderCache {
  private readonly cache: NodeCache
  private readonly ttlMs: number
  private readonly maxEntries: number
  private readonly headerHashes = new Set<string>()
  private readonly events?: EventEmitter | EventBus
  private readonly metrics?: WalletToolboxMetrics
  private hits = 0
  private misses = 0
  private readonly onExpired = (key: string, header?: BlockHeader): void => {
    this.removeHeaderIndexes(key, header)
  }

  private readonly onBlockMined = (event?: { blockHeight?: number, header?: BlockHeader }): void => {
    if (event?.header != null) {
      this.invalidateFromHeight(event.header.height)
      this.set(event.header)
    } else if (event?.blockHeight != null) {
      this.invalidateFromHeight(event.blockHeight)
    }
  }

  private readonly onReorg = (event?: { depth?: number, oldTip?: BlockHeader, deactivatedHeaders?: BlockHeader[] }): void => {
    if (event?.deactivatedHeaders != null && event.deactivatedHeaders.length > 0) {
      for (const header of event.deactivatedHeaders) this.invalidateHash(header.hash)
    } else if (event?.oldTip != null && event.depth != null) {
      this.invalidateFromHeight(Math.max(0, event.oldTip.height - event.depth + 1))
    } else {
      this.clear()
    }
  }

  constructor (options: BlockHeaderCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? 300000
    this.maxEntries = options.maxEntries ?? 1000
    this.events = options.events
    this.metrics = options.metrics
    this.cache = new NodeCache({
      stdTTL: Math.ceil(this.ttlMs / 1000),
      checkperiod: Math.min(Math.ceil(this.ttlMs / 1000), 60),
      useClones: true
    })
    this.cache.on('expired', this.onExpired)
    this.events?.on(EventBus.BLOCK_MINED, this.onBlockMined)
    this.events?.on(EventBus.REORG, this.onReorg)
  }

  getByHeight (height: number): BlockHeader | undefined {
    const header = this.cache.get<BlockHeader>(heightKey(height))
    if (header != null) this.hits++
    else this.misses++
    this.metrics?.recordBlockHeaderCacheRequest(header != null ? 'hit' : 'miss', this.headerHashes.size)
    this.events?.emit(header != null ? 'blockHeaderCacheHit' : 'blockHeaderCacheMiss', { height })
    return header
  }

  getHeader (height: number): BlockHeader | null {
    return this.getByHeight(height) ?? null
  }

  getByHash (hash: string): BlockHeader | undefined {
    const header = this.cache.get<BlockHeader>(hashKey(hash))
    if (header != null) this.hits++
    else this.misses++
    this.metrics?.recordBlockHeaderCacheRequest(header != null ? 'hit' : 'miss', this.headerHashes.size)
    this.events?.emit(header != null ? 'blockHeaderCacheHit' : 'blockHeaderCacheMiss', { hash })
    return header
  }

  setHeader (height: number, header: BlockHeader): void {
    if (header.height !== height) {
      throw new Error(`BLOCK_HEADER_CACHE_HEIGHT_MISMATCH:${height}:${header.height}`)
    }
    this.set(header)
  }

  set (header: BlockHeader): void {
    const previousAtHeight = this.cache.get<BlockHeader>(heightKey(header.height))
    if (previousAtHeight != null && previousAtHeight.hash !== header.hash) {
      this.cache.del(hashKey(previousAtHeight.hash))
      this.headerHashes.delete(previousAtHeight.hash)
    }
    const previousAtHash = this.cache.get<BlockHeader>(hashKey(header.hash))
    if (previousAtHash != null && previousAtHash.height !== header.height) {
      this.cache.del(heightKey(previousAtHash.height))
    }
    this.headerHashes.delete(header.hash)
    this.headerHashes.add(header.hash)
    this.cache.set(heightKey(header.height), header)
    this.cache.set(hashKey(header.hash), header)
    this.evictOldHeaders()
    this.metrics?.setBlockHeaderCacheSize(this.headerHashes.size)
    this.events?.emit('blockHeaderCacheSet', { height: header.height, hash: header.hash })
  }

  invalidateHeight (height: number): void {
    const header = this.cache.get<BlockHeader>(heightKey(height))
    this.cache.del(heightKey(height))
    if (header != null) {
      this.cache.del(hashKey(header.hash))
      this.headerHashes.delete(header.hash)
    }
    this.metrics?.setBlockHeaderCacheSize(this.headerHashes.size)
    this.events?.emit('blockHeaderCacheInvalidate', { height })
  }

  invalidateHash (hash: string): void {
    const header = this.cache.get<BlockHeader>(hashKey(hash))
    this.cache.del(hashKey(hash))
    this.headerHashes.delete(hash)
    if (header != null) this.cache.del(heightKey(header.height))
    this.metrics?.setBlockHeaderCacheSize(this.headerHashes.size)
    this.events?.emit('blockHeaderCacheInvalidate', { hash })
  }

  invalidateFromHeight (height: number): number {
    let removed = 0
    for (const hash of Array.from(this.headerHashes)) {
      const header = this.cache.get<BlockHeader>(hashKey(hash))
      if (header != null && header.height >= height) {
        this.invalidateHash(hash)
        removed++
      }
    }
    return removed
  }

  clear (): void {
    const removed = this.headerHashes.size
    this.cache.flushAll()
    this.headerHashes.clear()
    this.metrics?.setBlockHeaderCacheSize(0)
    this.events?.emit('blockHeaderCacheClear', { removed })
  }

  close (): void {
    this.events?.off(EventBus.BLOCK_MINED, this.onBlockMined)
    this.events?.off(EventBus.REORG, this.onReorg)
    this.cache.off('expired', this.onExpired)
    this.clear()
    this.cache.close()
  }

  getStats (): { entries: number, ttlMs: number, hits: number, misses: number, hitRate: number } {
    const total = this.hits + this.misses
    return {
      entries: this.headerHashes.size,
      ttlMs: this.ttlMs,
      hits: this.hits,
      misses: this.misses,
      hitRate: total === 0 ? 0 : this.hits / total
    }
  }

  private evictOldHeaders (): void {
    while (this.headerHashes.size > this.maxEntries) {
      const oldHash = this.headerHashes.values().next().value
      if (typeof oldHash !== 'string') return
      this.invalidateHash(oldHash)
    }
  }

  private removeHeaderIndexes (key: string, header?: BlockHeader): void {
    if (header == null) return
    if (key.startsWith('height:')) {
      this.cache.del(hashKey(header.hash))
      this.headerHashes.delete(header.hash)
    } else if (key.startsWith('hash:')) {
      this.cache.del(heightKey(header.height))
      this.headerHashes.delete(header.hash)
    }
    this.metrics?.setBlockHeaderCacheSize(this.headerHashes.size)
  }
}

function heightKey (height: number): string {
  return `height:${height}`
}

function hashKey (hash: string): string {
  return `hash:${hash}`
}
