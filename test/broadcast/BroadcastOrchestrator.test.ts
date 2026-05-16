import { Beef } from '@bsv/sdk'
import { BroadcastOrchestrator } from '../../src/broadcast/BroadcastOrchestrator'
import { PostBeefResult } from '../../src/sdk/WalletServices.interfaces'

describe('BroadcastOrchestrator', () => {
  test('queues one signed beef and txid set without changing broadcast semantics', async () => {
    const beef = { toBinary: () => [] } as unknown as Beef
    const txids = ['txid1']
    const expected: PostBeefResult[] = [{ name: 'fake', status: 'success', txidResults: [{ txid: 'txid1', status: 'success' }] }]
    const services = {
      postBeef: jest.fn(async (seenBeef, seenTxids) => {
        expect(seenBeef).toBe(beef)
        expect(seenTxids).toBe(txids)
        return expected
      })
    }
    const orchestrator = new BroadcastOrchestrator(services, { concurrency: 1 })

    await expect(orchestrator.broadcast({ beef, txids, attempts: 2 })).resolves.toBe(expected)

    expect(services.postBeef).toHaveBeenCalledTimes(1)
    expect(orchestrator.size).toBe(0)
    expect(orchestrator.pending).toBe(0)
  })

  test('runs higher-priority queued broadcasts before lower-priority queued broadcasts', async () => {
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
    const orchestrator = new BroadcastOrchestrator(services, { concurrency: 1 })

    const holding = orchestrator.broadcast({ beef, txids: ['hold'], priority: 0 })
    await firstStarted.promise
    const low = orchestrator.broadcast({ beef, txids: ['low'], priority: 0 })
    const high = orchestrator.broadcast({ beef, txids: ['high'], priority: 10 })

    releaseFirst()
    await Promise.all([holding, low, high])

    expect(started).toEqual(['hold', 'high', 'low'])
  })

  test('close drains queued broadcasts and rejects new broadcasts', async () => {
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
    const orchestrator = new BroadcastOrchestrator(services, { concurrency: 1 })

    const holding = orchestrator.broadcast({ beef, txids: ['hold'] })
    await firstStarted.promise
    const queued = orchestrator.broadcast({ beef, txids: ['queued'] })
    let closeResolved = false
    const closing = orchestrator.close().then(() => { closeResolved = true })

    await Promise.resolve()
    expect(closeResolved).toBe(false)
    await expect(orchestrator.broadcast({ beef, txids: ['new'] })).rejects.toMatchObject({
      name: 'WERR_INVALID_OPERATION'
    })

    releaseFirst()
    await Promise.all([holding, queued, closing])

    expect(closeResolved).toBe(true)
    expect(started).toEqual(['hold', 'queued'])
    expect(orchestrator.size).toBe(0)
    expect(orchestrator.pending).toBe(0)
  })
})

function defer<T> (): { promise: Promise<T>, resolve: (value: T | PromiseLike<T>) => void } {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}
