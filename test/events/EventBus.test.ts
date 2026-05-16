import { EventBus } from '../../src/events/EventBus'
import { BlockHeader } from '../../src/sdk/WalletServices.interfaces'

describe('EventBus', () => {
  test('typed subscriptions can be removed for cache invalidation events', () => {
    const eventBus = new EventBus()
    const blocks: number[] = []
    const utxos: string[][] = []
    const reorgDepths: number[] = []
    const blockHandler = (event: { blockHeight: number }) => blocks.push(event.blockHeight)
    const utxoHandler = (event: { outpoints: string[] }) => utxos.push(event.outpoints)
    const reorgHandler = (event: { depth: number }) => reorgDepths.push(event.depth)

    eventBus.onBlockMined(blockHandler)
    eventBus.onUtxoInvalidation(utxoHandler)
    eventBus.onReorg(reorgHandler)

    eventBus.emitBlockMined({ blockHeight: 100, timestamp: Date.now() })
    eventBus.emitUtxoInvalidation({ outpoints: ['txid.0'] })
    eventBus.emitReorg({ depth: 1, oldTip: makeHeader(100, 'old'), newTip: makeHeader(101, 'new') })

    eventBus.offBlockMined(blockHandler)
    eventBus.offUtxoInvalidation(utxoHandler)
    eventBus.offReorg(reorgHandler)

    eventBus.emitBlockMined({ blockHeight: 101, timestamp: Date.now() })
    eventBus.emitUtxoInvalidation({ outpoints: ['txid.1'] })
    eventBus.emitReorg({ depth: 2, oldTip: makeHeader(101, 'old2'), newTip: makeHeader(102, 'new2') })

    expect(blocks).toEqual([100])
    expect(utxos).toEqual([['txid.0']])
    expect(reorgDepths).toEqual([1])
    expect(eventBus.listenerCount(EventBus.BLOCK_MINED)).toBe(0)
    expect(eventBus.listenerCount(EventBus.UTXO_INVALIDATE)).toBe(0)
    expect(eventBus.listenerCount(EventBus.REORG)).toBe(0)
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
