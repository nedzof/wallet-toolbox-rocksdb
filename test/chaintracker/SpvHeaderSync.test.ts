import { EventBus } from '../../src/events/EventBus'
import { SpvHeaderSync } from '../../src/chaintracker/SpvHeaderSync'
import { BlockHeader } from '../../src/sdk/WalletServices.interfaces'
import { BlockHeaderCache } from '../../src/cache/BlockHeaderCache'

describe('SpvHeaderSync', () => {
  test('start is idempotent and does not duplicate subscriptions', async () => {
    const source = {
      subscribeHeaders: jest.fn(async () => 'headers-1'),
      subscribeReorgs: jest.fn(async () => 'reorgs-1'),
      unsubscribe: jest.fn(async () => true)
    }
    const sync = new SpvHeaderSync(source, new EventBus())

    await expect(Promise.all([sync.start(), sync.start(), sync.start()])).resolves.toEqual([
      { headerSubscriptionId: 'headers-1', reorgSubscriptionId: 'reorgs-1' },
      { headerSubscriptionId: 'headers-1', reorgSubscriptionId: 'reorgs-1' },
      { headerSubscriptionId: 'headers-1', reorgSubscriptionId: 'reorgs-1' }
    ])

    expect(source.subscribeHeaders).toHaveBeenCalledTimes(1)
    expect(source.subscribeReorgs).toHaveBeenCalledTimes(1)

    await sync.stop()
    await sync.start()

    expect(source.subscribeHeaders).toHaveBeenCalledTimes(2)
    expect(source.subscribeReorgs).toHaveBeenCalledTimes(2)
  })

  test('cleans up partial subscriptions and allows retry after start failure', async () => {
    let headerAttempts = 0
    let reorgAttempts = 0
    const source = {
      subscribeHeaders: jest.fn(async () => {
        headerAttempts++
        if (headerAttempts === 1) throw new Error('headers unavailable')
        return `headers-${headerAttempts}`
      }),
      subscribeReorgs: jest.fn(async () => `reorgs-${++reorgAttempts}`),
      unsubscribe: jest.fn(async () => true)
    }
    const sync = new SpvHeaderSync(source, new EventBus())

    await expect(sync.start()).rejects.toThrow('headers unavailable')

    expect(source.unsubscribe).toHaveBeenCalledWith('reorgs-1')

    await expect(sync.start()).resolves.toEqual({
      headerSubscriptionId: 'headers-2',
      reorgSubscriptionId: 'reorgs-2'
    })

    expect(source.subscribeHeaders).toHaveBeenCalledTimes(2)
    expect(source.subscribeReorgs).toHaveBeenCalledTimes(2)
  })

  test('stop waits for in-flight start before unsubscribing', async () => {
    let releaseHeader: () => void = () => {}
    let resolveHeaderStarted: () => void = () => {}
    const headerStarted = new Promise<void>(resolve => {
      resolveHeaderStarted = resolve
    })
    const source = {
      subscribeHeaders: jest.fn(async () => {
        resolveHeaderStarted()
        await new Promise<void>(release => {
          releaseHeader = release
        })
        return 'headers-1'
      }),
      subscribeReorgs: jest.fn(async () => 'reorgs-1'),
      unsubscribe: jest.fn(async () => true)
    }
    const sync = new SpvHeaderSync(source, new EventBus())

    const started = sync.start()
    await headerStarted
    const stopped = sync.stop()

    expect(source.unsubscribe).not.toHaveBeenCalled()

    releaseHeader()

    await expect(started).resolves.toEqual({
      headerSubscriptionId: 'headers-1',
      reorgSubscriptionId: 'reorgs-1'
    })
    await stopped

    expect(source.unsubscribe).toHaveBeenCalledWith('headers-1')
    expect(source.unsubscribe).toHaveBeenCalledWith('reorgs-1')
  })

  test('emits header and reorg events and unsubscribes on stop', async () => {
    let headerListener: ((header: BlockHeader) => void) | undefined
    let reorgListener: ((depth: number, oldTip: BlockHeader, newTip: BlockHeader, deactivatedHeaders?: BlockHeader[]) => void) | undefined
    const unsubscribed: string[] = []
    const source = {
      subscribeHeaders: jest.fn(async listener => {
        headerListener = listener
        return 'headers-1'
      }),
      subscribeReorgs: jest.fn(async listener => {
        reorgListener = listener
        return 'reorgs-1'
      }),
      unsubscribe: jest.fn(async id => {
        unsubscribed.push(id)
        return true
      })
    }
    const eventBus = new EventBus()
    const blocks: any[] = []
    const reorgs: any[] = []
    eventBus.onBlockMined(event => blocks.push(event))
    eventBus.onReorg(event => reorgs.push(event))
    const headerCache = new BlockHeaderCache({ events: eventBus })

    const sync = new SpvHeaderSync(source, eventBus)
    await sync.start()

    const oldTip = makeHeader(10, 'aa')
    const newTip = makeHeader(11, 'bb')
    headerListener?.(newTip)
    reorgListener?.(1, oldTip, newTip, [oldTip])

    expect(blocks).toEqual([expect.objectContaining({ blockHeight: 11, blockHash: 'bb' })])
    expect(headerCache.getByHeight(11)).toEqual(newTip)
    expect(reorgs).toEqual([expect.objectContaining({ depth: 1, oldTip, newTip, deactivatedHeaders: [oldTip] })])

    await sync.stop()

    expect(unsubscribed.sort()).toEqual(['headers-1', 'reorgs-1'])
  })

  test('reorg events invalidate deactivated headers from the block header cache', async () => {
    let headerListener: ((header: BlockHeader) => void) | undefined
    let reorgListener: ((depth: number, oldTip: BlockHeader, newTip: BlockHeader, deactivatedHeaders?: BlockHeader[]) => void) | undefined
    const source = {
      subscribeHeaders: jest.fn(async listener => {
        headerListener = listener
        return 'headers-1'
      }),
      subscribeReorgs: jest.fn(async listener => {
        reorgListener = listener
        return 'reorgs-1'
      }),
      unsubscribe: jest.fn(async () => true)
    }
    const eventBus = new EventBus()
    const headerCache = new BlockHeaderCache({ events: eventBus })
    const sync = new SpvHeaderSync(source, eventBus)
    await sync.start()

    const header9 = makeHeader(9, '09')
    const header10 = makeHeader(10, '10')
    const header11 = makeHeader(11, '11')
    const newTip = makeHeader(11, 'bb')
    headerListener?.(header9)
    headerListener?.(header10)
    headerListener?.(header11)

    expect(headerCache.getByHeight(9)).toEqual(header9)
    expect(headerCache.getByHeight(10)).toEqual(header10)
    expect(headerCache.getByHeight(11)).toEqual(header11)

    reorgListener?.(2, header11, newTip, [header10, header11])

    expect(headerCache.getByHeight(9)).toEqual(header9)
    expect(headerCache.getByHeight(10)).toBeUndefined()
    expect(headerCache.getByHeight(11)).toBeUndefined()

    await sync.stop()
  })

  test('emits reorg events even when a custom reorg handler is registered', async () => {
    let reorgListener: ((depth: number, oldTip: BlockHeader, newTip: BlockHeader, deactivatedHeaders?: BlockHeader[]) => void) | undefined
    const source = {
      subscribeHeaders: jest.fn(async () => 'headers-1'),
      subscribeReorgs: jest.fn(async listener => {
        reorgListener = listener
        return 'reorgs-1'
      }),
      unsubscribe: jest.fn(async () => true)
    }
    const eventBus = new EventBus()
    const reorgs: any[] = []
    eventBus.onReorg(event => reorgs.push(event))
    const handledReorgs: any[] = []
    const sync = new SpvHeaderSync(source, eventBus, {
      onReorg: (depth, oldTip, newTip, deactivatedHeaders) => {
        handledReorgs.push({ depth, oldTip, newTip, deactivatedHeaders })
      }
    })
    await sync.start()

    const oldTip = makeHeader(12, '12')
    const newTip = makeHeader(13, '13')
    reorgListener?.(1, oldTip, newTip, [oldTip])

    expect(reorgs).toEqual([expect.objectContaining({ depth: 1, oldTip, newTip, deactivatedHeaders: [oldTip] })])
    expect(handledReorgs).toEqual([{ depth: 1, oldTip, newTip, deactivatedHeaders: [oldTip] }])

    await sync.stop()
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
