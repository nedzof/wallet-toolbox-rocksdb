import { Monitor, MonitorOptions } from '../../src/monitor/Monitor'
import { WalletMonitorTask } from '../../src/monitor/tasks/WalletMonitorTask'
import { wait } from '../../src/utility/utilityHelpers'
import { EventBus } from '../../src/events/EventBus'
import { BlockHeader, GetUtxoStatusResult } from '../../src/sdk/WalletServices.interfaces'
import { TaskCheckForProofs } from '../../src/monitor/tasks/TaskCheckForProofs'
import { Services } from '../../src/services/Services'

describe('Monitor parallel task execution', () => {
  test('runs due tasks with bounded parallelism', async () => {
    const monitor = new Monitor(makeMonitorOptions({ taskRunConcurrency: 2 }))
    const starts: string[] = []
    const finishes: string[] = []
    const first = new DelayedTask(monitor, 'first', 40, starts, finishes)
    const second = new DelayedTask(monitor, 'second', 40, starts, finishes)
    monitor.addTask(first)
    monitor.addTask(second)

    const startedAt = Date.now()
    await monitor.runOnce()
    const elapsed = Date.now() - startedAt

    expect(starts).toEqual(['first', 'second'])
    expect(finishes.sort()).toEqual(['first', 'second'])
    expect(elapsed).toBeLessThan(75)
    expect(first.lastRunMsecsSinceEpoch).toBeGreaterThan(0)
    expect(second.lastRunMsecsSinceEpoch).toBeGreaterThan(0)
  })

  test('startTasks schedules fast tasks without waiting for slower task cadence', async () => {
    const monitor = new Monitor(makeMonitorOptions({ taskRunWaitMsecs: 10, taskRunConcurrency: 2 }))
    const slow = new CountingTask(monitor, 'slow', 80)
    const fast = new CountingTask(monitor, 'fast', 0)
    monitor.addTask(slow)
    monitor.addTask(fast)

    const started = monitor.startTasks()
    await wait(120)
    monitor.stopTasks()
    await started

    expect(slow.runs).toBeGreaterThanOrEqual(1)
    expect(fast.runs).toBeGreaterThan(slow.runs)
  })

  test('emits one reorg event when Chaintracks event sync is wired through Monitor', async () => {
    let reorgListener: ((depth: number, oldTip: BlockHeader, newTip: BlockHeader, deactivatedHeaders?: BlockHeader[]) => void) | undefined
    const chaintracksWithEvents = {
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
    const monitor = new Monitor(makeMonitorOptions({ chaintracksWithEvents: chaintracksWithEvents as any, eventBus }))

    await monitor.ready
    const oldTip = makeHeader(10, '10')
    const newTip = makeHeader(11, '11')
    reorgListener?.(1, oldTip, newTip, [oldTip])

    expect(reorgs).toEqual([expect.objectContaining({ depth: 1, oldTip, newTip, deactivatedHeaders: [oldTip] })])
    expect(monitor.deactivatedHeaders.map(h => h.header)).toEqual([oldTip])

    await monitor.destroy()
  })

  test('height-only block notices wake proof checking', () => {
    TaskCheckForProofs.checkNow = false
    const eventBus = new EventBus()
    const blocks: any[] = []
    eventBus.onBlockMined(event => blocks.push(event))
    const monitor = new Monitor(makeMonitorOptions({ eventBus }))

    monitor.processBlockMinedNotice(123, 'abc')

    expect(monitor.lastNewBlockHeight).toBe(123)
    expect(monitor.lastNewHeaderWhen).toBeInstanceOf(Date)
    expect(TaskCheckForProofs.checkNow).toBe(true)
    expect(blocks).toEqual([expect.objectContaining({ blockHeight: 123, blockHash: 'abc' })])
    TaskCheckForProofs.checkNow = false
  })

  test('new block notices update header cache and invalidate UTXO cache through Services event bus', async () => {
    const services = new Services('test')
    const monitor = new Monitor(makeMonitorOptions({ services }))
    const header = makeHeader(124, 'header-hash')
    const utxoStatus: GetUtxoStatusResult = {
      name: 'test',
      status: 'success',
      isUtxo: true,
      details: [{ txid: 'txid', index: 0 }]
    }

    services.utxoCache.set({ output: 'script-hash', outpoint: 'txid.0' }, utxoStatus)
    expect(services.utxoCache.getStats().size).toBe(1)

    monitor.processNewBlockHeader(header)

    expect(services.blockHeaderCache.getByHeight(124)).toEqual(header)
    expect(services.blockHeaderCache.getByHash('header-hash')).toEqual(header)
    expect(services.utxoCache.getStats().size).toBe(0)

    await services.close()
  })

  test('destroy stops task loops and destroys task resources', async () => {
    const monitor = new Monitor(makeMonitorOptions({ taskRunWaitMsecs: 10, taskRunConcurrency: 1 }))
    const task = new DestroyableTask(monitor, 'destroyable')
    monitor.addTask(task)

    const started = monitor.startTasks()
    await wait(20)
    await monitor.destroy()
    await started

    expect(task.destroyed).toBe(1)
  })
})

class DelayedTask extends WalletMonitorTask {
  constructor (
    monitor: Monitor,
    name: string,
    private readonly delayMs: number,
    private readonly starts: string[],
    private readonly finishes: string[]
  ) {
    super(monitor, name)
  }

  trigger (): { run: boolean } {
    return { run: true }
  }

  async runTask (): Promise<string> {
    this.starts.push(this.name)
    await wait(this.delayMs)
    this.finishes.push(this.name)
    return ''
  }
}

class CountingTask extends WalletMonitorTask {
  runs = 0

  constructor (
    monitor: Monitor,
    name: string,
    private readonly delayMs: number
  ) {
    super(monitor, name)
  }

  trigger (): { run: boolean } {
    return { run: true }
  }

  async runTask (): Promise<string> {
    this.runs++
    await wait(this.delayMs)
    return ''
  }
}

class DestroyableTask extends WalletMonitorTask {
  destroyed = 0

  trigger (): { run: boolean } {
    return { run: false }
  }

  async runTask (): Promise<string> {
    return ''
  }

  override async asyncDestroy (): Promise<void> {
    this.destroyed++
  }
}

function makeMonitorOptions (overrides: Partial<MonitorOptions> = {}): MonitorOptions {
  const storageProvider = {
    insertMonitorEvent: jest.fn(async () => undefined)
  }
  const storage = {
    getActive: () => ({ isStorageProvider: () => true }),
    runAsStorageProvider: async (fn: any) => await fn(storageProvider)
  }
  return {
    chain: 'test',
    services: { chain: 'test' } as any,
    storage: storage as any,
    chaintracks: {} as any,
    msecsWaitPerMerkleProofServiceReq: 0,
    taskRunWaitMsecs: 0,
    abandonedMsecs: 0,
    unprovenAttemptsLimitTest: 0,
    unprovenAttemptsLimitMain: 0,
    maxRebroadcastAttempts: 0,
    ...overrides
  }
}

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
