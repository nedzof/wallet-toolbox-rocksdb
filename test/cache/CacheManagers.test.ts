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

    cache.set(header1)
    cache.set(header2)

    expect(cache.getByHeight(1)).toEqual(header1)
    expect(cache.getByHash('bb')).toEqual(header2)

    cache.set(header3)

    expect(cache.getStats().entries).toBe(2)
    expect(cache.getByHash('aa')).toBeUndefined()
    expect(cache.getByHeight(3)).toEqual(header3)
    expect(cache.getStats()).toEqual(expect.objectContaining({ hits: 3, misses: 1, hitRate: 0.75 }))

    const replacementHeader2 = makeHeader(2, 'dd')
    cache.set(replacementHeader2)

    expect(cache.getStats().entries).toBe(2)
    expect(cache.getByHash('bb')).toBeUndefined()
    expect(cache.getByHeight(2)).toEqual(replacementHeader2)

    expect(cache.invalidateFromHeight(3)).toBe(1)
    expect(cache.getStats().entries).toBe(1)
    expect(cache.getByHeight(3)).toBeUndefined()

    cache.set(header3)
    eventBus.emitReorg({ depth: 1, oldTip: header2, newTip: header3 })

    expect(cache.getStats().entries).toBe(0)
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
