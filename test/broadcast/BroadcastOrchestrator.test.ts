import { Beef, Script, Transaction, Utils } from '@bsv/sdk'
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
        expect(seenTxids).toEqual(txids)
        return expected
      })
    }
    const orchestrator = new BroadcastOrchestrator(services, { concurrency: 1 })

    await expect(orchestrator.broadcast({ beef, txids, attempts: 2 })).resolves.toBe(expected)

    expect(services.postBeef).toHaveBeenCalledTimes(1)
    expect(orchestrator.size).toBe(0)
    expect(orchestrator.pending).toBe(0)
  })

  test('snapshots txids before queued broadcast work runs', async () => {
    const beef = { toBinary: () => [] } as unknown as Beef
    const seen: string[][] = []
    let releaseFirst: () => void = () => undefined
    const firstStarted = defer<void>()
    const firstCanFinish = new Promise<void>(resolve => { releaseFirst = resolve })
    const services = {
      postBeef: jest.fn(async (_beef, txids: string[]) => {
        seen.push(txids)
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
    const mutableTxids = ['original']
    const queued = orchestrator.broadcast({ beef, txids: mutableTxids })
    mutableTxids[0] = 'mutated'

    releaseFirst()
    await Promise.all([holding, queued])

    expect(seen.map(txids => txids[0])).toEqual(['hold', 'original'])
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

  test('uses attempts as retry priority when explicit priority is omitted', async () => {
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

    const holding = orchestrator.broadcast({ beef, txids: ['hold'], attempts: 0 })
    await firstStarted.promise
    const low = orchestrator.broadcast({ beef, txids: ['low'], attempts: 1 })
    const high = orchestrator.broadcast({ beef, txids: ['high'], attempts: 3 })

    releaseFirst()
    await Promise.all([holding, low, high])

    expect(started).toEqual(['hold', 'high', 'low'])
  })

  test('respects the configured broadcast concurrency cap', async () => {
    const beef = { toBinary: () => [] } as unknown as Beef
    let active = 0
    let maxActive = 0
    const services = {
      postBeef: jest.fn(async (_beef, txids: string[]) => {
        active++
        maxActive = Math.max(maxActive, active)
        try {
          await new Promise(resolve => setTimeout(resolve, 20))
          return [{ name: txids[0], status: 'success', txidResults: [{ txid: txids[0], status: 'success' }] }] as PostBeefResult[]
        } finally {
          active--
        }
      })
    }
    const orchestrator = new BroadcastOrchestrator(services, { concurrency: 2 })

    await Promise.all(['a', 'b', 'c', 'd', 'e'].map(async txid =>
      await orchestrator.broadcast({ beef, txids: [txid] })
    ))

    expect(maxActive).toBeGreaterThan(1)
    expect(maxActive).toBeLessThanOrEqual(2)
    expect(services.postBeef).toHaveBeenCalledTimes(5)
    expect(orchestrator.size).toBe(0)
    expect(orchestrator.pending).toBe(0)
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

  test('provider failure rejects that broadcast and keeps later queued work flowing', async () => {
    const beef = { toBinary: () => [] } as unknown as Beef
    const services = {
      postBeef: jest.fn(async (_beef, txids: string[]) => {
        if (txids[0] === 'fail') throw new Error('provider failed')
        return [{ name: txids[0], status: 'success', txidResults: [{ txid: txids[0], status: 'success' }] }] as PostBeefResult[]
      })
    }
    const orchestrator = new BroadcastOrchestrator(services, { concurrency: 1 })

    const failed = orchestrator.broadcast({ beef, txids: ['fail'] })
    const next = orchestrator.broadcast({ beef, txids: ['next'] })

    await expect(failed).rejects.toThrow('provider failed')
    await expect(next).resolves.toEqual([
      { name: 'next', status: 'success', txidResults: [{ txid: 'next', status: 'success' }] }
    ])

    expect(services.postBeef).toHaveBeenCalledTimes(2)
    expect(orchestrator.size).toBe(0)
    expect(orchestrator.pending).toBe(0)
  })

  test('validates source-doc rawTx shape against exactly one txid before broadcast', async () => {
    const beef = { toBinary: () => [] } as unknown as Beef
    const tx = new Transaction()
    tx.addOutput({ lockingScript: Script.fromASM('OP_1'), satoshis: 1 })
    const rawTx = Utils.toHex(tx.toBinary())
    const services = {
      postBeef: jest.fn(async () => [] as PostBeefResult[])
    }
    const orchestrator = new BroadcastOrchestrator(services, { concurrency: 1 })

    await expect(orchestrator.broadcast({ beef, txid: tx.id('hex'), rawTx })).resolves.toEqual([])
    await expect(orchestrator.broadcast({ beef, txid: '00'.repeat(32), rawTx })).rejects.toMatchObject({
      name: 'WERR_INVALID_OPERATION'
    })
    await expect(orchestrator.broadcast({ beef, txids: [tx.id('hex'), '00'.repeat(32)], rawTx })).rejects.toMatchObject({
      name: 'WERR_INVALID_OPERATION'
    })
    await expect(orchestrator.broadcast({ beef, txid: tx.id('hex'), rawTx: 'xyz' })).rejects.toMatchObject({
      name: 'WERR_INVALID_OPERATION'
    })

    expect(services.postBeef).toHaveBeenCalledTimes(1)
  })

  test('rejects ambiguous txid and txids request shapes before broadcast', async () => {
    const beef = { toBinary: () => [] } as unknown as Beef
    const services = {
      postBeef: jest.fn(async () => [] as PostBeefResult[])
    }
    const orchestrator = new BroadcastOrchestrator(services, { concurrency: 1 })

    await expect(orchestrator.broadcast({ beef, txid: 'one', txids: ['other'] })).rejects.toMatchObject({
      name: 'WERR_INVALID_OPERATION'
    })

    expect(services.postBeef).not.toHaveBeenCalled()
  })

  test('rejects blank and whitespace-padded txids before broadcast', async () => {
    const beef = { toBinary: () => [] } as unknown as Beef
    const services = {
      postBeef: jest.fn(async () => [] as PostBeefResult[])
    }
    const orchestrator = new BroadcastOrchestrator(services, { concurrency: 1 })

    await expect(orchestrator.broadcast({ beef, txids: [''] })).rejects.toMatchObject({
      name: 'WERR_INVALID_OPERATION'
    })
    await expect(orchestrator.broadcast({ beef, txids: [' txid1'] })).rejects.toMatchObject({
      name: 'WERR_INVALID_OPERATION'
    })
    await expect(orchestrator.broadcast({ beef, txid: 'txid1\n' })).rejects.toMatchObject({
      name: 'WERR_INVALID_OPERATION'
    })

    expect(services.postBeef).not.toHaveBeenCalled()
  })
})

function defer<T> (): { promise: Promise<T>, resolve: (value: T | PromiseLike<T>) => void } {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}
