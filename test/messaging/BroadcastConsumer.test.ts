import { Beef, Script, Transaction, Utils } from '@bsv/sdk'
import { BroadcastConsumer } from '../../src/messaging/consumers/BroadcastConsumer'
import { PostBeefResult } from '../../src/sdk/WalletServices.interfaces'

describe('BroadcastConsumer', () => {
  test('consumes one signed broadcast request without changing beef or txids', async () => {
    const beef = { toBinary: () => [] } as unknown as Beef
    const txids = ['txid1']
    const expected: PostBeefResult[] = [{ name: 'fake', status: 'success', txidResults: [{ txid: 'txid1', status: 'success' }] }]
    const services = {
      postBeef: jest.fn(async (seenBeef, seenTxids) => {
        expect(seenBeef).toBe(beef)
        expect(seenTxids).toEqual(txids)
        return expected
      })
    }
    const consumer = BroadcastConsumer.fromServices(services, { concurrency: 1 })

    await expect(consumer.consume({ beef, txids, attempts: 2 })).resolves.toBe(expected)

    expect(services.postBeef).toHaveBeenCalledTimes(1)
    expect(consumer.size).toBe(0)
    expect(consumer.pending).toBe(0)
    await consumer.close()
  })

  test('accepts the source-doc single txid/rawTx request shape', async () => {
    const beef = { toBinary: () => [] } as unknown as Beef
    const tx = new Transaction()
    tx.addOutput({ lockingScript: Script.fromASM('OP_1'), satoshis: 1 })
    const txid = tx.id('hex')
    const rawTx = Utils.toHex(tx.toBinary())
    const expected: PostBeefResult[] = [{ name: 'fake', status: 'success', txidResults: [{ txid, status: 'success' }] }]
    const services = {
      postBeef: jest.fn(async (seenBeef, seenTxids) => {
        expect(seenBeef).toBe(beef)
        expect(seenTxids).toEqual([txid])
        return expected
      })
    }
    const consumer = BroadcastConsumer.fromServices(services, { concurrency: 1 })

    await expect(consumer.consume({ beef, txid, rawTx, attempts: 2 })).resolves.toBe(expected)

    expect(services.postBeef).toHaveBeenCalledTimes(1)
    await consumer.close()
  })

  test('rejects ambiguous txid and txids request shapes before provider broadcast', async () => {
    const beef = { toBinary: () => [] } as unknown as Beef
    const services = {
      postBeef: jest.fn(async () => [] as PostBeefResult[])
    }
    const consumer = BroadcastConsumer.fromServices(services, { concurrency: 1 })

    try {
      await expect(consumer.consume({ beef, txid: 'one', txids: ['other'] })).rejects.toMatchObject({
        name: 'WERR_INVALID_OPERATION'
      })

      expect(services.postBeef).not.toHaveBeenCalled()
    } finally {
      await consumer.close()
    }
  })

  test('close drains queued broadcasts and rejects new work', async () => {
    const beef = { toBinary: () => [] } as unknown as Beef
    const started: string[] = []
    let releaseFirst: () => void = () => undefined
    const firstStarted = defer<void>()
    const firstCanFinish = new Promise<void>(resolve => { releaseFirst = resolve })
    const services = {
      postBeef: jest.fn(async (_beef, txids: string[]) => {
        started.push(txids[0])
        if (txids[0] === 'hold') {
          firstStarted.resolve()
          await firstCanFinish
        }
        return [{ name: txids[0], status: 'success', txidResults: [{ txid: txids[0], status: 'success' }] }] as PostBeefResult[]
      })
    }
    const consumer = BroadcastConsumer.fromServices(services, { concurrency: 1 })

    const holding = consumer.consume({ beef, txids: ['hold'] })
    await firstStarted.promise
    const queued = consumer.consume({ beef, txids: ['queued'] })
    let closeResolved = false
    const closing = consumer.close().then(() => { closeResolved = true })

    await Promise.resolve()
    expect(closeResolved).toBe(false)
    await expect(consumer.consume({ beef, txids: ['new'] })).rejects.toMatchObject({
      name: 'WERR_INVALID_OPERATION'
    })

    releaseFirst()
    await Promise.all([holding, queued, closing])

    expect(closeResolved).toBe(true)
    expect(started).toEqual(['hold', 'queued'])
    expect(consumer.size).toBe(0)
    expect(consumer.pending).toBe(0)
  })
})

function defer<T> (): { promise: Promise<T>, resolve: (value: T | PromiseLike<T>) => void } {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}
