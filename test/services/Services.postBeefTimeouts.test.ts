import { Beef } from '@bsv/sdk'
import { Services } from '../../src/services/Services'
import { ServiceCollection } from '../../src/services/ServiceCollection'
import { PostBeefResult, PostBeefService } from '../../src/sdk/WalletServices.interfaces'
import { wait } from '../../src/utility/utilityHelpers'

function successResult(name: string, txids: string[]): PostBeefResult {
  return {
    name,
    status: 'success',
    txidResults: txids.map(txid => ({ txid, status: 'success' }))
  }
}

describe('Services postBeef timeout behavior', () => {
  test('defaults to parallel provider broadcast with identical beef and txids', async () => {
    const services = new Services('main')
    services.postBeefUntilSuccessSoftTimeoutMs = 50
    services.postBeefUntilSuccessSoftTimeoutPerKbMs = 0
    services.postBeefUntilSuccessSoftTimeoutMaxMs = 50

    const beef = { toBinary: () => [] } as unknown as Beef
    const txids = ['txid1', 'txid2']
    const calls: Array<{ name: string, sameBeef: boolean, sameTxids: boolean }> = []
    let markSecondStarted: () => void = () => undefined
    const secondStarted = new Promise<void>(resolve => { markSecondStarted = resolve })

    const first: PostBeefService = async (seenBeef, seenTxids) => {
      calls.push({ name: 'first', sameBeef: seenBeef === beef, sameTxids: seenTxids === txids })
      await secondStarted
      return successResult('first', seenTxids)
    }
    const second: PostBeefService = async (seenBeef, seenTxids) => {
      calls.push({ name: 'second', sameBeef: seenBeef === beef, sameTxids: seenTxids === txids })
      markSecondStarted()
      return successResult('second', seenTxids)
    }

    services.postBeefServices = new ServiceCollection<PostBeefService>('postBeef')
      .add({ name: 'first', service: first })
      .add({ name: 'second', service: second })

    const results = await services.postBeef(beef, txids)

    expect(services.postBeefMode).toBe('PromiseAll')
    expect(results.map(r => r.name).sort()).toEqual(['first', 'second'])
    expect(results.every(r => r.status === 'success')).toBe(true)
    expect(calls).toEqual([
      { name: 'first', sameBeef: true, sameTxids: true },
      { name: 'second', sameBeef: true, sameTxids: true }
    ])
  })

  test('service options can preserve sequential UntilSuccess behavior', async () => {
    const options = Services.createDefaultOptions('main')
    options.postBeefMode = 'UntilSuccess'
    const services = new Services(options)
    expect(services.postBeefMode).toBe('UntilSuccess')
  })

  test('adaptive timeout avoids false failover for larger payloads', async () => {
    const services = new Services('main')

    let slowCalls = 0
    let fallbackCalls = 0

    const slowSuccess: PostBeefService = async (_beef, txids) => {
      slowCalls++
      await wait(80)
      return successResult('slow', txids)
    }
    const fallback: PostBeefService = async (_beef, txids) => {
      fallbackCalls++
      return successResult('fallback', txids)
    }

    services.postBeefServices = new ServiceCollection<PostBeefService>('postBeef')
      .add({ name: 'slow', service: slowSuccess })
      .add({ name: 'fallback', service: fallback })

    services.postBeefMode = 'UntilSuccess'
    services.postBeefUntilSuccessSoftTimeoutMs = 5
    services.postBeefUntilSuccessSoftTimeoutPerKbMs = 1
    services.postBeefUntilSuccessSoftTimeoutMaxMs = 1000

    const beef = { toBinary: () => new Array<number>(200 * 1024).fill(0) } as unknown as Beef
    const results = await services.postBeef(beef, ['txid1'])

    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('success')
    expect(results[0].name).toBe('slow')
    expect(slowCalls).toBe(1)
    expect(fallbackCalls).toBe(0)
  })

  test('soft timeout does not re-order service priority', async () => {
    const services = new Services('main')

    const slowSuccess: PostBeefService = async (_beef, txids) => {
      await wait(50)
      return successResult('slow', txids)
    }
    const fastSuccess: PostBeefService = async (_beef, txids) => successResult('fast', txids)

    services.postBeefServices = new ServiceCollection<PostBeefService>('postBeef')
      .add({ name: 'slow', service: slowSuccess })
      .add({ name: 'fast', service: fastSuccess })

    services.postBeefMode = 'UntilSuccess'
    services.postBeefUntilSuccessSoftTimeoutMs = 10
    services.postBeefUntilSuccessSoftTimeoutPerKbMs = 0
    services.postBeefUntilSuccessSoftTimeoutMaxMs = 10

    const beef = { toBinary: () => [] } as unknown as Beef
    const results = await services.postBeef(beef, ['txid1'])

    expect(results).toHaveLength(2)
    expect(results[0].status).toBe('error')
    expect(results[1].status).toBe('success')
    expect(services.postBeefServices.services.map(s => s.name)).toEqual(['slow', 'fast'])
  })

  test('parallel provider exceptions are classified without aborting other provider results', async () => {
    const services = new Services('main')
    services.postBeefUntilSuccessSoftTimeoutMs = 50
    services.postBeefUntilSuccessSoftTimeoutPerKbMs = 0
    services.postBeefUntilSuccessSoftTimeoutMaxMs = 50

    const beef = { toBinary: () => [] } as unknown as Beef
    const txids = ['txid1']
    const throwing: PostBeefService = async () => {
      throw new Error('provider offline')
    }
    const succeeding: PostBeefService = async (_beef, seenTxids) => successResult('succeeding', seenTxids)

    services.postBeefServices = new ServiceCollection<PostBeefService>('postBeef')
      .add({ name: 'throwing', service: throwing })
      .add({ name: 'succeeding', service: succeeding })

    const results = await services.postBeef(beef, txids)

    expect(results.map(r => r.name).sort()).toEqual(['succeeding', 'throwing'])
    const failed = results.find(r => r.name === 'throwing')!
    expect(failed.status).toBe('error')
    expect(failed.error?.description).toContain('provider offline')
    expect(failed.txidResults).toEqual([
      expect.objectContaining({ txid: 'txid1', status: 'error', serviceError: true })
    ])
    expect(failed.notes?.[0]).toEqual(expect.objectContaining({
      what: 'postBeefServiceException',
      providerName: 'throwing'
    }))
    expect(results.find(r => r.name === 'succeeding')?.status).toBe('success')
  })

  test('UntilSuccess mode classifies provider exceptions and continues failover', async () => {
    const options = Services.createDefaultOptions('main')
    options.postBeefMode = 'UntilSuccess'
    const services = new Services(options)
    services.postBeefUntilSuccessSoftTimeoutMs = 50
    services.postBeefUntilSuccessSoftTimeoutPerKbMs = 0
    services.postBeefUntilSuccessSoftTimeoutMaxMs = 50

    const beef = { toBinary: () => [] } as unknown as Beef
    const throwing: PostBeefService = async () => {
      throw new Error('sequential provider offline')
    }
    const succeeding: PostBeefService = async (_beef, txids) => successResult('succeeding', txids)

    services.postBeefServices = new ServiceCollection<PostBeefService>('postBeef')
      .add({ name: 'throwing', service: throwing })
      .add({ name: 'succeeding', service: succeeding })

    const results = await services.postBeef(beef, ['txid1'])

    expect(results).toHaveLength(2)
    expect(results[0]).toEqual(expect.objectContaining({
      name: 'throwing',
      status: 'error'
    }))
    expect(results[0].txidResults[0]).toEqual(expect.objectContaining({
      txid: 'txid1',
      status: 'error',
      serviceError: true
    }))
    expect(results[1]).toEqual(expect.objectContaining({
      name: 'succeeding',
      status: 'success'
    }))
  })

  test('close waits for queued parallel provider broadcasts and rejects new broadcasts', async () => {
    const options = Services.createDefaultOptions('main')
    options.httpClient = { request: jest.fn() } as any
    options.postBeefQueueConcurrency = 1
    const services = new Services(options)
    const beef = { toBinary: () => [] } as unknown as Beef
    const firstStarted = defer<void>()
    let releaseFirst: () => void = () => undefined
    const firstCanFinish = new Promise<void>(resolve => { releaseFirst = resolve })
    const started: string[] = []

    const first: PostBeefService = async (_beef, txids) => {
      started.push('first')
      firstStarted.resolve()
      await firstCanFinish
      return successResult('first', txids)
    }
    const second: PostBeefService = async (_beef, txids) => {
      started.push('second')
      return successResult('second', txids)
    }

    services.postBeefServices = new ServiceCollection<PostBeefService>('postBeef')
      .add({ name: 'first', service: first })
      .add({ name: 'second', service: second })

    const post = services.postBeef(beef, ['txid1'])
    await firstStarted.promise
    let closeResolved = false
    const close = services.close().then(() => { closeResolved = true })

    await Promise.resolve()
    expect(closeResolved).toBe(false)
    await expect(services.postBeef(beef, ['txid2'])).rejects.toMatchObject({
      name: 'WERR_INVALID_OPERATION'
    })

    releaseFirst()
    await post
    await close

    expect(closeResolved).toBe(true)
    expect(started).toEqual(['first', 'second'])
  })

  test('close waits for active UntilSuccess broadcasts before closing resources', async () => {
    const options = Services.createDefaultOptions('main')
    options.httpClient = { request: jest.fn() } as any
    options.postBeefMode = 'UntilSuccess'
    const services = new Services(options)
    const beef = { toBinary: () => [] } as unknown as Beef
    const firstStarted = defer<void>()
    let releaseFirst: () => void = () => undefined
    const firstCanFinish = new Promise<void>(resolve => { releaseFirst = resolve })

    const first: PostBeefService = async (_beef, txids) => {
      firstStarted.resolve()
      await firstCanFinish
      return successResult('first', txids)
    }

    services.postBeefServices = new ServiceCollection<PostBeefService>('postBeef')
      .add({ name: 'first', service: first })

    const post = services.postBeef(beef, ['txid1'])
    await firstStarted.promise
    let closeResolved = false
    const close = services.close().then(() => { closeResolved = true })

    await Promise.resolve()
    expect(closeResolved).toBe(false)
    await expect(services.postBeef(beef, ['txid2'])).rejects.toMatchObject({
      name: 'WERR_INVALID_OPERATION'
    })

    releaseFirst()
    await expect(post).resolves.toEqual([
      expect.objectContaining({ name: 'first', status: 'success' })
    ])
    await close

    expect(closeResolved).toBe(true)
  })
})

function defer<T> (): { promise: Promise<T>, resolve: (value: T | PromiseLike<T>) => void } {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}
