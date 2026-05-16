import { BlockHeaderCache } from '../../src/cache/BlockHeaderCache'
import { ScriptHashCache } from '../../src/cache/ScriptHashCache'
import { UtxoCacheManager } from '../../src/cache/UtxoCacheManager'
import { EventBus } from '../../src/events/EventBus'
import { BlockHeader, GetUtxoStatusResult } from '../../src/sdk/WalletServices.interfaces'
import { wait } from '../../src/utility/utilityHelpers'

describe('cache managers', () => {
  test('UtxoCacheManager caches successes, coalesces in-flight loads, and invalidates by event', async () => {
    const eventBus = new EventBus()
    const cache = new UtxoCacheManager({ events: eventBus, ttlMs: 1000 })
    const query = { output: 'hash', outpoint: 'txid.0' }
    const result: GetUtxoStatusResult = {
      name: 'test',
      status: 'success',
      isUtxo: true,
      details: [{ txid: 'txid', index: 0 }]
    }
    let loads = 0
    const load = async () => {
      loads++
      await wait(10)
      return result
    }

    await Promise.all([
      cache.getOrLoad(query, load),
      cache.getOrLoad(query, load),
      cache.getOrLoad(query, load)
    ])
    await cache.getOrLoad(query, load)

    expect(loads).toBe(1)
    expect(cache.getStats()).toEqual(expect.objectContaining({ size: 1, hits: 1, misses: 3, hitRate: 0.25 }))

    eventBus.emitUtxoInvalidation({ outpoints: ['txid.0'] })
    expect(cache.getStats().size).toBe(0)
    await cache.getOrLoad(query, load)

    expect(loads).toBe(2)
  })

  test('UtxoCacheManager returns clones and enforces max entries', async () => {
    const cache = new UtxoCacheManager({ max: 2, ttlMs: 1000 })
    const result: GetUtxoStatusResult = {
      name: 'test',
      status: 'success',
      isUtxo: true,
      details: [{ txid: 'txid', index: 0 }]
    }

    const first = await cache.getOrLoad({ output: 'hash1', outpoint: 'txid.0' }, async () => result)
    first.details[0].satoshis = 42

    const second = await cache.getOrLoad({ output: 'hash1', outpoint: 'txid.0' }, async () => result)
    expect(second.details[0].satoshis).toBeUndefined()

    cache.set({ output: 'hash2', outpoint: 'txid.1' }, result)
    cache.set({ output: 'hash3', outpoint: 'txid.2' }, result)

    expect(cache.getStats().size).toBe(2)

    let loads = 0
    await cache.getOrLoad({ output: 'hash1', outpoint: 'txid.0' }, async () => {
      loads++
      return result
    })

    expect(loads).toBe(1)
  })

  test('UtxoCacheManager exposes source-doc-compatible outpoint status helpers', async () => {
    const cache = new UtxoCacheManager({ ttlMs: 1000 })
    try {
      expect(await cache.getUtxoStatus('txid.3')).toBeNull()

      cache.setUtxoStatus('txid.3', true, 100)

      expect(await cache.getUtxoStatus('txid.3')).toBe(true)
      expect(cache.getStats()).toEqual(expect.objectContaining({ size: 1, hits: 1, misses: 1, hitRate: 0.5 }))

      cache.invalidateOutpoint('txid.3')
      expect(await cache.getUtxoStatus('txid.3')).toBeNull()
    } finally {
      cache.close()
    }
  })

  test('UtxoCacheManager refreshes LRU age on cache reads', async () => {
    const cache = new UtxoCacheManager({ ttlMs: 100 })
    try {
      cache.setUtxoStatus('txid.9', true, 100)

      await wait(70)
      expect(await cache.getUtxoStatus('txid.9')).toBe(true)
      await wait(70)

      expect(await cache.getUtxoStatus('txid.9')).toBe(true)
    } finally {
      cache.close()
    }
  })

  test('UtxoCacheManager expires stale outpoint status hints by TTL', async () => {
    const cache = new UtxoCacheManager({ ttlMs: 100 })
    try {
      cache.setUtxoStatus('txid.10', false, 100)

      expect(await cache.getUtxoStatus('txid.10')).toBe(false)

      await wait(120)

      expect(await cache.getUtxoStatus('txid.10')).toBeNull()
      expect(cache.getStats().size).toBe(0)
    } finally {
      cache.close()
    }
  })

  test('UtxoCacheManager does not cache provider errors and clears on block events', async () => {
    const eventBus = new EventBus()
    const cache = new UtxoCacheManager({ events: eventBus })
    const query = { output: 'hash', outpoint: 'txid.1' }
    const errorResult: GetUtxoStatusResult = { name: 'test', status: 'error', details: [] }
    const successResult: GetUtxoStatusResult = { name: 'test', status: 'success', isUtxo: false, details: [] }
    let loads = 0

    await cache.getOrLoad(query, async () => {
      loads++
      return errorResult
    })
    await cache.getOrLoad(query, async () => {
      loads++
      return successResult
    })

    expect(loads).toBe(2)
    expect(cache.getStats().size).toBe(1)

    eventBus.emitBlockMined({ blockHeight: 100, timestamp: Date.now() })

    expect(cache.getStats().size).toBe(0)
  })

  test('UtxoCacheManager only caches decisive UTXO status hints', async () => {
    const cache = new UtxoCacheManager()
    const query = { output: 'hash', outpoint: 'txid.11' }
    const incompleteSuccess: GetUtxoStatusResult = { name: 'test', status: 'success', details: [] }
    const decisiveSuccess: GetUtxoStatusResult = { name: 'test', status: 'success', isUtxo: true, details: [] }
    let loads = 0

    try {
      await cache.getOrLoad(query, async () => {
        loads++
        return incompleteSuccess
      })
      await cache.getOrLoad(query, async () => {
        loads++
        return decisiveSuccess
      })
      await cache.getOrLoad(query, async () => {
        loads++
        return decisiveSuccess
      })

      expect(loads).toBe(2)
      expect(await cache.getUtxoStatus('txid.11')).toBe(true)
      expect(cache.getStats().size).toBe(1)
    } finally {
      cache.close()
    }
  })

  test('UtxoCacheManager can use block event outpoints for targeted invalidation', async () => {
    const eventBus = new EventBus()
    const cache = new UtxoCacheManager({ events: eventBus })
    const result: GetUtxoStatusResult = { name: 'test', status: 'success', isUtxo: true, details: [] }

    try {
      cache.set({ output: 'hash1', outpoint: 'txid.1' }, result)
      cache.set({ output: 'hash2', outpoint: 'txid.2' }, result)

      eventBus.emitBlockMined({ blockHeight: 100, outpoints: ['txid.1'], timestamp: Date.now() })

      expect(await cache.getUtxoStatus('txid.1')).toBeNull()
      expect(await cache.getUtxoStatus('txid.2')).toBe(true)
      expect(cache.getStats().size).toBe(1)
    } finally {
      cache.close()
    }
  })

  test('UtxoCacheManager clears cached hints on reorg events', async () => {
    const eventBus = new EventBus()
    const cache = new UtxoCacheManager({ events: eventBus })
    const result: GetUtxoStatusResult = {
      name: 'test',
      status: 'success',
      isUtxo: true,
      details: [{ txid: 'txid', index: 4 }]
    }

    try {
      cache.set({ output: 'hash', outpoint: 'txid.4' }, result)

      eventBus.emitReorg({
        depth: 1,
        oldTip: makeHeader(100, 'old'),
        newTip: makeHeader(101, 'new')
      })

      expect(cache.getStats().size).toBe(0)
      expect(await cache.getUtxoStatus('txid.4')).toBeNull()
    } finally {
      cache.close()
    }
  })

  test('UtxoCacheManager does not cache in-flight results after invalidation', async () => {
    const eventBus = new EventBus()
    const cache = new UtxoCacheManager({ events: eventBus })
    const query = { output: 'hash', outpoint: 'txid.2' }
    const result: GetUtxoStatusResult = {
      name: 'test',
      status: 'success',
      isUtxo: true,
      details: [{ txid: 'txid', index: 2 }]
    }
    let resolveLoad: (value: GetUtxoStatusResult) => void = () => {}
    let loads = 0
    const firstLoad = cache.getOrLoad(query, async () => {
      loads++
      return await new Promise<GetUtxoStatusResult>(resolve => {
        resolveLoad = resolve
      })
    })

    eventBus.emitUtxoInvalidation({ outpoints: ['txid.2'] })
    resolveLoad(result)

    await expect(firstLoad).resolves.toEqual(result)
    await cache.getOrLoad(query, async () => {
      loads++
      return result
    })

    expect(loads).toBe(2)
  })

  test('BlockHeaderCache indexes by height and hash, enforces max entries, and clears on reorg', () => {
    const eventBus = new EventBus()
    const cache = new BlockHeaderCache({ events: eventBus, maxEntries: 2 })
    const header1 = makeHeader(1, 'aa')
    const header2 = makeHeader(2, 'bb')
    const header3 = makeHeader(3, 'cc')

    cache.setHeader(1, header1)
    cache.setHeader(2, header2)

    expect(cache.getHeader(1)).toEqual(header1)
    expect(cache.getByHeight(1)).toEqual(header1)
    expect(cache.getByHash('bb')).toEqual(header2)

    cache.set(header3)

    expect(cache.getStats().entries).toBe(2)
    expect(cache.getByHash('aa')).toBeUndefined()
    expect(cache.getByHeight(3)).toEqual(header3)
    expect(cache.getStats()).toEqual(expect.objectContaining({ hits: 4, misses: 1, hitRate: 0.8 }))

    const replacementHeader2 = makeHeader(2, 'dd')
    cache.set(replacementHeader2)

    expect(cache.getStats().entries).toBe(2)
    expect(cache.getByHash('bb')).toBeUndefined()
    expect(cache.getByHeight(2)).toEqual(replacementHeader2)

    expect(cache.invalidateFromHeight(3)).toBe(1)
    expect(cache.getStats().entries).toBe(1)
    expect(cache.getByHeight(3)).toBeUndefined()
    expect(cache.getHeader(3)).toBeNull()

    cache.set(header3)
    eventBus.emitReorg({ depth: 1, oldTip: header2, newTip: header3 })

    expect(cache.getStats().entries).toBe(0)
  })

  test('BlockHeaderCache invalidates headers from height-only block events', () => {
    const eventBus = new EventBus()
    const cache = new BlockHeaderCache({ events: eventBus, maxEntries: 5 })
    const header1 = makeHeader(1, 'aa')
    const header2 = makeHeader(2, 'bb')
    const header3 = makeHeader(3, 'cc')

    cache.set(header1)
    cache.set(header2)
    cache.set(header3)

    eventBus.emitBlockMined({ blockHeight: 2, timestamp: Date.now() })

    expect(cache.getByHeight(1)).toEqual(header1)
    expect(cache.getByHeight(2)).toBeUndefined()
    expect(cache.getByHash('bb')).toBeUndefined()
    expect(cache.getByHeight(3)).toBeUndefined()
    expect(cache.getStats().entries).toBe(1)

    cache.close()
  })

  test('BlockHeaderCache setHeader rejects mismatched height metadata', () => {
    const cache = new BlockHeaderCache()

    try {
      expect(() => cache.setHeader(9, makeHeader(10, 'height-mismatch')))
        .toThrow('BLOCK_HEADER_CACHE_HEIGHT_MISMATCH:9:10')
      expect(cache.getStats().entries).toBe(0)
    } finally {
      cache.close()
    }
  })

  test('BlockHeaderCache expires both height and hash indexes by TTL', async () => {
    const cache = new BlockHeaderCache({ ttlMs: 1000, maxEntries: 5 })
    const header = makeHeader(10, 'ttl-hash')

    try {
      cache.set(header)

      expect(cache.getByHeight(10)).toEqual(header)
      expect(cache.getByHash('ttl-hash')).toEqual(header)

      await wait(1100)

      expect(cache.getByHeight(10)).toBeUndefined()
      expect(cache.getByHash('ttl-hash')).toBeUndefined()
      expect(cache.getStats().entries).toBe(0)
    } finally {
      cache.close()
    }
  })

  test('ScriptHashCache memoizes computed hashes and enforces max entries', () => {
    const cache = new ScriptHashCache({ max: 1, ttlMs: 1000 })
    let computes = 0
    const compute = () => {
      computes++
      return `hash-${computes}`
    }

    expect(cache.getOrCompute('script-a', compute)).toBe('hash-1')
    expect(cache.getOrCompute('script-a', compute)).toBe('hash-1')
    expect(computes).toBe(1)
    expect(cache.getStats()).toEqual(expect.objectContaining({ size: 1, hits: 1, misses: 1, hitRate: 0.5 }))

    expect(cache.getOrCompute('script-b', compute)).toBe('hash-2')
    expect(cache.getOrCompute('script-a', compute)).toBe('hash-3')
    expect(cache.getStats()).toEqual(expect.objectContaining({ size: 1, hits: 1, misses: 3 }))
  })
})

function makeHeader (height: number, hash: string): BlockHeader {
  return {
    version: 1,
    previousHash: '00'.repeat(32),
    merkleRoot: '11'.repeat(32),
    time: 1,
    bits: 1,
    nonce: 1,
    height,
    hash
  }
}
