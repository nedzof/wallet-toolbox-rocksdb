import { Services } from '../../src/services/Services'
import { ServiceCollection } from '../../src/services/ServiceCollection'
import {
  BlockHeader,
  GetUtxoStatusResult,
  GetUtxoStatusService
} from '../../src/sdk/WalletServices.interfaces'
import { EventBus } from '../../src/events/EventBus'
import { TableOutput } from '../../src/storage/schema/tables/TableOutput'

describe('Services cache integration', () => {
  test('caches successful outpoint UTXO status reads and invalidates by outpoint event', async () => {
    const services = new Services('test')
    const result: GetUtxoStatusResult = {
      name: 'fake',
      status: 'success',
      isUtxo: true,
      details: [{ txid: 'txid1', index: 0 }]
    }
    const getUtxoStatus: GetUtxoStatusService = jest.fn(async () => result)
    services.getUtxoStatusServices = new ServiceCollection<GetUtxoStatusService>('getUtxoStatus')
      .add({ name: 'fake', service: getUtxoStatus })

    await services.getUtxoStatus('hash', undefined, 'txid1.0')
    await services.getUtxoStatus('hash', undefined, 'txid1.0')

    expect(getUtxoStatus).toHaveBeenCalledTimes(1)

    services.eventBus.emitUtxoInvalidation({ outpoints: ['txid1.0'] })
    await services.getUtxoStatus('hash', undefined, 'txid1.0')

    expect(getUtxoStatus).toHaveBeenCalledTimes(2)
  })

  test('useNext bypasses cached UTXO status hints for fresh provider checks', async () => {
    const services = new Services('test')
    const cachedHint: GetUtxoStatusResult = {
      name: 'fake',
      status: 'success',
      isUtxo: true,
      details: [{ txid: 'txid2', index: 0 }]
    }
    const freshStatus: GetUtxoStatusResult = {
      name: 'fake',
      status: 'success',
      isUtxo: false,
      details: []
    }
    const getUtxoStatus: GetUtxoStatusService = jest.fn()
      .mockResolvedValueOnce(cachedHint)
      .mockResolvedValueOnce(freshStatus)
    services.getUtxoStatusServices = new ServiceCollection<GetUtxoStatusService>('getUtxoStatus')
      .add({ name: 'fake', service: getUtxoStatus })

    await expect(services.getUtxoStatus('hash2', undefined, 'txid2.0'))
      .resolves.toEqual(expect.objectContaining({ isUtxo: true }))
    await expect(services.getUtxoStatus('hash2', undefined, 'txid2.0'))
      .resolves.toEqual(expect.objectContaining({ isUtxo: true }))
    await expect(services.getUtxoStatus('hash2', undefined, 'txid2.0', true))
      .resolves.toEqual(expect.objectContaining({ isUtxo: false }))

    expect(getUtxoStatus).toHaveBeenCalledTimes(2)
  })

  test('isUtxo bypasses cached hints for spend-authoritative checks', async () => {
    const services = new Services('test')
    const output = {
      outputId: 1,
      txid: 'txid3',
      vout: 0,
      lockingScript: [0x51]
    } as TableOutput
    const cachedHint: GetUtxoStatusResult = {
      name: 'fake',
      status: 'success',
      isUtxo: true,
      details: [{ txid: 'txid3', index: 0 }]
    }
    const freshStatus: GetUtxoStatusResult = {
      name: 'fake',
      status: 'success',
      isUtxo: false,
      details: []
    }
    const getUtxoStatus: GetUtxoStatusService = jest.fn()
      .mockResolvedValueOnce(cachedHint)
      .mockResolvedValueOnce(freshStatus)
      .mockResolvedValueOnce(freshStatus)
    services.getUtxoStatusServices = new ServiceCollection<GetUtxoStatusService>('getUtxoStatus')
      .add({ name: 'fake', service: getUtxoStatus })

    await expect(services.isUtxo(output)).resolves.toBe(true)
    await expect(services.isUtxo(output)).resolves.toBe(false)
    await expect(services.isUtxo(output, true)).resolves.toBe(false)

    expect(getUtxoStatus).toHaveBeenCalledTimes(3)
  })

  test('caches block headers and clears them on reorg events', async () => {
    const header = makeHeader(1, 'aa')
    const nextHeader = makeHeader(1, 'bb')
    const chaintracks = {
      findHeaderForHeight: jest.fn(async () => header),
      findHeaderForBlockHash: jest.fn(async () => header),
      currentHeight: jest.fn(async () => 1)
    }
    const options = Services.createDefaultOptions('test')
    options.chaintracks = chaintracks as any
    const services = new Services(options)

    await services.getHeaderForHeight(1)
    await services.getHeaderForHeight(1)
    await services.hashToHeader('aa')

    expect(chaintracks.findHeaderForHeight).toHaveBeenCalledTimes(1)
    expect(chaintracks.findHeaderForBlockHash).toHaveBeenCalledTimes(0)

    services.eventBus.emitReorg({ depth: 1, oldTip: header, newTip: nextHeader })
    await services.hashToHeader('aa')

    expect(chaintracks.findHeaderForBlockHash).toHaveBeenCalledTimes(1)
  })

  test('rejects mismatched block headers before caching them', async () => {
    const heightMismatch = makeHeader(2, 'aa')
    const hashMismatch = makeHeader(1, 'bb')
    const chaintracks = {
      findHeaderForHeight: jest.fn(async () => heightMismatch),
      findHeaderForBlockHash: jest.fn(async () => hashMismatch),
      currentHeight: jest.fn(async () => 1)
    }
    const options = Services.createDefaultOptions('test')
    options.chaintracks = chaintracks as any
    const services = new Services(options)

    await expect(services.getHeaderForHeight(1)).rejects.toThrow('returned height 2 for requested height 1')
    await expect(services.hashToHeader('aa')).rejects.toThrow('returned hash bb for requested hash aa')

    expect(services.blockHeaderCache.getStats().entries).toBe(0)
  })

  test('caches output script hash derivation', () => {
    const services = new Services('test')
    const script = '76a914000000000000000000000000000000000000000088ac'

    const first = services.hashOutputScript(script)
    const second = services.hashOutputScript(script)

    expect(second).toBe(first)
    expect(services.scriptHashCache.getStats()).toEqual(expect.objectContaining({
      size: 1,
      hits: 1,
      misses: 1,
      hitRate: 0.5
    }))
  })

  test('applies owned cache size and TTL options', async () => {
    const options = Services.createDefaultOptions('test')
    options.utxoStatusCacheMaxEntries = 1
    options.utxoStatusCacheTtlMs = 1234
    options.blockHeaderCacheMaxEntries = 1
    options.blockHeaderCacheTtlMs = 2345
    options.scriptHashCacheMaxEntries = 1
    options.scriptHashCacheTtlMs = 3456
    const services = new Services(options)

    try {
      services.utxoCache.setUtxoStatus(`${'11'.repeat(32)}.0`, true, 100)
      services.utxoCache.setUtxoStatus(`${'22'.repeat(32)}.0`, true, 100)

      expect(services.utxoCache.getStats()).toEqual(expect.objectContaining({
        size: 1,
        ttlMs: 1234
      }))

      services.blockHeaderCache.setHeader(1, makeHeader(1, 'aa'))
      services.blockHeaderCache.setHeader(2, makeHeader(2, 'bb'))

      expect(services.blockHeaderCache.getStats()).toEqual(expect.objectContaining({
        entries: 1,
        ttlMs: 2345
      }))
      expect(services.blockHeaderCache.getHeader(1)).toBeNull()
      expect(services.blockHeaderCache.getHeader(2)).toEqual(makeHeader(2, 'bb'))

      services.hashOutputScript('51')
      services.hashOutputScript('52')

      expect(services.scriptHashCache.getStats()).toEqual(expect.objectContaining({
        size: 1,
        ttlMs: 3456
      }))
    } finally {
      await services.close()
    }
  })

  test('close tears down owned cache event listeners', async () => {
    const eventBus = new EventBus()
    const options = Services.createDefaultOptions('test')
    options.eventBus = eventBus
    const services = new Services(options)

    expect(eventBus.listenerCount(EventBus.UTXO_INVALIDATE)).toBe(1)
    expect(eventBus.listenerCount(EventBus.BLOCK_MINED)).toBe(2)
    expect(eventBus.listenerCount(EventBus.REORG)).toBe(2)

    await services.close()

    expect(eventBus.listenerCount(EventBus.UTXO_INVALIDATE)).toBe(0)
    expect(eventBus.listenerCount(EventBus.BLOCK_MINED)).toBe(0)
    expect(eventBus.listenerCount(EventBus.REORG)).toBe(0)
    await expect(services.close()).resolves.toBeUndefined()
  })

  test('close does not close caller-injected cache instances', async () => {
    const options = Services.createDefaultOptions('test')
    options.httpClient = { request: jest.fn() } as any
    const utxoCache = { close: jest.fn() } as any
    const blockHeaderCache = { close: jest.fn() } as any
    const scriptHashCache = { close: jest.fn() } as any
    options.utxoCache = utxoCache
    options.blockHeaderCache = blockHeaderCache
    options.scriptHashCache = scriptHashCache
    const services = new Services(options)

    await services.close()

    expect(utxoCache.close).not.toHaveBeenCalled()
    expect(blockHeaderCache.close).not.toHaveBeenCalled()
    expect(scriptHashCache.close).not.toHaveBeenCalled()
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
