import { BlockHeaderCache } from '../../src/cache/BlockHeaderCache'
import { UtxoCacheManager } from '../../src/cache/UtxoCacheManager'
import { EventBus } from '../../src/events/EventBus'
import { CacheInvalidationPublisher } from '../../src/messaging/publishers/CacheInvalidationPublisher'
import { BlockHeader, GetUtxoStatusResult } from '../../src/sdk/WalletServices.interfaces'

describe('CacheInvalidationPublisher', () => {
  test('publishes in-process block and UTXO invalidation events to cache listeners', async () => {
    const eventBus = new EventBus()
    const publisher = new CacheInvalidationPublisher(eventBus)
    const utxoCache = new UtxoCacheManager({ events: eventBus })
    const blockHeaderCache = new BlockHeaderCache({ events: eventBus })
    const utxoResult: GetUtxoStatusResult = {
      name: 'test',
      status: 'success',
      isUtxo: true,
      details: [{ txid: 'txid', index: 0 }]
    }
    const header = makeHeader(100, 'aa')

    try {
      utxoCache.set({ output: 'hash', outpoint: 'txid.0' }, utxoResult)
      blockHeaderCache.set(header)

      publisher.publishUtxoInvalidation({ outpoints: ['txid.0'], blockHeight: 100 })
      expect(utxoCache.getStats().size).toBe(0)
      expect(blockHeaderCache.getByHeight(100)).toEqual(header)

      utxoCache.set({ output: 'hash2', outpoint: 'txid.1' }, utxoResult)
      publisher.publishBlockInvalidation(101)
      expect(utxoCache.getStats().size).toBe(0)

      utxoCache.set({ output: 'hash3', outpoint: 'txid.2' }, utxoResult)
      utxoCache.set({ output: 'hash4', outpoint: 'txid.3' }, utxoResult)
      publisher.publishBlockInvalidation(102, ['txid.2'])
      expect(await utxoCache.getUtxoStatus('txid.2')).toBeNull()
      expect(await utxoCache.getUtxoStatus('txid.3')).toBe(true)
      expect(utxoCache.getStats().size).toBe(1)

      publisher.publishUtxoInvalidation(['txid.3'])
      expect(utxoCache.getStats().size).toBe(0)

      utxoCache.set({ output: 'hash5', outpoint: 'txid.4' }, utxoResult)
      publisher.publishUtxoStatus({
        outpoints: ['txid.4'],
        isUtxo: false,
        blockHeight: 103,
        source: 'chaintracks',
        observedAt: new Date().toISOString()
      })
      expect(utxoCache.getStats().size).toBe(0)
    } finally {
      utxoCache.close()
      blockHeaderCache.close()
    }
  })

  test('publishes reorg events to UTXO and block-header cache listeners', async () => {
    const eventBus = new EventBus()
    const publisher = new CacheInvalidationPublisher(eventBus)
    const utxoCache = new UtxoCacheManager({ events: eventBus })
    const blockHeaderCache = new BlockHeaderCache({ events: eventBus })
    const utxoResult: GetUtxoStatusResult = {
      name: 'test',
      status: 'success',
      isUtxo: true,
      details: [{ txid: 'txid', index: 5 }]
    }
    const keptHeader = makeHeader(100, 'aa')
    const deactivatedHeader = makeHeader(101, 'bb')
    const newTip = makeHeader(101, 'cc')

    try {
      utxoCache.set({ output: 'hash', outpoint: 'txid.5' }, utxoResult)
      blockHeaderCache.set(keptHeader)
      blockHeaderCache.set(deactivatedHeader)

      publisher.publishReorg({
        depth: 1,
        oldTip: deactivatedHeader,
        newTip,
        deactivatedHeaders: [deactivatedHeader]
      })

      expect(utxoCache.getStats().size).toBe(0)
      expect(blockHeaderCache.getByHash('bb')).toBeUndefined()
      expect(blockHeaderCache.getByHeight(101)).toBeUndefined()
      expect(blockHeaderCache.getByHeight(100)).toEqual(keptHeader)
    } finally {
      utxoCache.close()
      blockHeaderCache.close()
    }
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
