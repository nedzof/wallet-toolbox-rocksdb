import { LRUCache } from 'lru-cache'

export interface ScriptHashCacheOptions {
  max?: number
  ttlMs?: number
}

export class ScriptHashCache {
  private readonly cache: LRUCache<string, string>
  private readonly ttlMs: number
  private hits = 0
  private misses = 0

  constructor (options: ScriptHashCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? 300000
    this.cache = new LRUCache<string, string>({
      max: options.max ?? 10000,
      ttl: this.ttlMs
    })
  }

  getOrCompute (scriptHex: string, compute: () => string): string {
    const cached = this.cache.get(scriptHex)
    if (cached != null) {
      this.hits++
      return cached
    }

    this.misses++
    const hash = compute()
    this.cache.set(scriptHex, hash)
    return hash
  }

  clear (): void {
    this.cache.clear()
  }

  close (): void {
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
}
