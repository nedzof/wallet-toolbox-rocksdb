import { wait } from '../utility/utilityHelpers'
import pLimit from 'p-limit'

import { WalletMonitorTask } from './tasks/WalletMonitorTask'
import { WalletStorageManager } from '../storage/WalletStorageManager'

import { TaskPurge, TaskPurgeParams } from './tasks/TaskPurge'
import { TaskReviewStatus } from './tasks/TaskReviewStatus'
import { TaskFailAbandoned } from './tasks/TaskFailAbandoned'
import { TaskCheckForProofs } from './tasks/TaskCheckForProofs'
import { TaskClock } from './tasks/TaskClock'
import { TaskNewHeader } from './tasks/TaskNewHeader'
import { TaskMonitorCallHistory } from './tasks/TaskMonitorCallHistory'
import { TaskReorg } from './tasks/TaskReorg'
import { TaskArcadeSSE } from './tasks/TaskArcSSE'
import { TaskMineBlock } from './tasks/TaskMineBlock'

import { TaskSendWaiting } from './tasks/TaskSendWaiting'
import { TaskCheckNoSends } from './tasks/TaskCheckNoSends'
import { TaskUnFail } from './tasks/TaskUnFail'
import { TaskReviewUtxos } from './tasks/TaskReviewUtxos'
import { TaskReviewDoubleSpends } from './tasks/TaskReviewDoubleSpends'
import { TaskReviewProvenTxs } from './tasks/TaskReviewProvenTxs'
import { Chain, ProvenTransactionStatus } from '../sdk/types'
import { ReviewActionResult } from '../sdk/WalletStorage.interfaces'
import { WERR_BAD_REQUEST, WERR_INVALID_PARAMETER } from '../sdk/WERR_errors'
import { WalletError } from '../sdk/WalletError'
import { BlockHeader, WalletServices } from '../sdk/WalletServices.interfaces'
import { Services } from '../services/Services'
import { ChaintracksClientApi } from '../services/chaintracker/chaintracks/Api/ChaintracksClientApi'

import { Chaintracks } from '../services/chaintracker/chaintracks/Chaintracks'
import { EventBus } from '../events/EventBus'
import { SpvHeaderSync } from '../chaintracker/SpvHeaderSync'

export type MonitorStorage = WalletStorageManager
export type MonitorStartupTaskMode = 'none' | 'default' | 'multiuser' | 'alltoother'

export interface MonitorOptions {
  chain: Chain

  services: Services | WalletServices

  storage: MonitorStorage

  chaintracks: ChaintracksClientApi

  chaintracksWithEvents?: Chaintracks

  startupTaskMode?: MonitorStartupTaskMode

  /**
   * How many msecs to wait after each getMerkleProof service request.
   */
  msecsWaitPerMerkleProofServiceReq: number

  taskRunWaitMsecs: number
  taskRunConcurrency?: number

  abandonedMsecs: number

  unprovenAttemptsLimitTest: number

  unprovenAttemptsLimitMain: number

  /**
   * Maximum number of times a broadcast transaction may be reset to 'unsent' for
   * rebroadcast after proof check timeout (circuit breaker).
   *
   * Default 0 means unlimited — the tx is rebroadcast indefinitely until a proof
   * is found. Set to a positive integer to cap rebroadcast cycles; once the limit
   * is reached the req is marked 'invalid'.
   */
  maxRebroadcastAttempts: number

  /**
   * Stable callback token for ARC SSE event streaming.
   * When set, TaskArcadeSSE will open an SSE connection to Arcade's
   * /events endpoint and receive real-time transaction status updates.
   * Must match the X-CallbackToken header sent during broadcast.
   */
  callbackToken?: string

  /** Load persisted SSE lastEventId (e.g. from SQLite) for catchup on startup */
  loadLastSSEEventId?: () => Promise<string | undefined>
  /** Save SSE lastEventId to persistent storage */
  saveLastSSEEventId?: (lastEventId: string) => Promise<void>
  /** The react-native-sse EventSource class for SSE support in React Native */
  EventSourceClass?: any

  eventBus?: EventBus

  /**
   * These are hooks for a wallet-toolbox client to get transaction updates.
   */
  onTransactionBroadcasted?: (broadcastResult: ReviewActionResult) => Promise<void>
  onTransactionProven?: (txStatus: ProvenTransactionStatus) => Promise<void>
  onTransactionStatusChanged?: (txid: string, newStatus: string) => Promise<void>
}

/**
 * Background task to make sure transactions are processed, transaction proofs are received and propagated,
 * and potentially that reorgs update proofs that were already received.
 */
export class Monitor {
  static createDefaultWalletMonitorOptions (
    chain: Chain,
    storage: MonitorStorage,
    services?: Services,
    chaintracks?: Chaintracks,
    startupTaskMode: MonitorStartupTaskMode = 'none'
  ): MonitorOptions {
    services ??= new Services(chain)
    if (services.options.chaintracks == null) throw new WERR_INVALID_PARAMETER('services.options.chaintracks', 'valid')
    const o: MonitorOptions = {
      chain,
      services,
      storage,
      msecsWaitPerMerkleProofServiceReq: 500,
      taskRunWaitMsecs: 1000,
      taskRunConcurrency: 8,
      abandonedMsecs: 1000 * 60 * 5,
      unprovenAttemptsLimitTest: 100,
      unprovenAttemptsLimitMain: 144,
      maxRebroadcastAttempts: 0,
      chaintracks: services.options.chaintracks,
      chaintracksWithEvents: chaintracks,
      startupTaskMode
    }
    return o
  }

  options: MonitorOptions
  services: Services | WalletServices
  chain: Chain
  storage: MonitorStorage
  chaintracks: ChaintracksClientApi
  chaintracksWithEvents?: Chaintracks
  reorgSubscriptionPromise?: Promise<string>
  headersSubscriptionPromise?: Promise<string>
  spvHeaderSync?: SpvHeaderSync
  onTransactionBroadcasted?: (broadcastResult: ReviewActionResult) => Promise<void>
  onTransactionProven?: (txStatus: ProvenTransactionStatus) => Promise<void>
  onTransactionStatusChanged?: (txid: string, newStatus: string) => Promise<void>
  eventBus: EventBus

  /**
   * Resolves once the optional Chaintracks subscriptions have been registered.
   * Await this before calling `startTasks()` if `chaintracksWithEvents` is provided
   * and you need subscriptions to be active before the first task loop runs.
   */
  get ready (): Promise<void> {
    if (this._readyInit === undefined) {
      this._readyInit = this._init()
    }
    return this._readyInit
  }

  private _readyInit?: Promise<void>

  constructor (options: MonitorOptions) {
    this.options = { ...options }
    this.services = options.services
    this.chain = this.services.chain
    this.storage = options.storage
    this.chaintracks = options.chaintracks
    this.chaintracksWithEvents = options.chaintracksWithEvents
    this.eventBus = options.eventBus ?? (options.services instanceof Services ? options.services.eventBus : new EventBus())
    this.onTransactionProven = options.onTransactionProven
    this.onTransactionBroadcasted = options.onTransactionBroadcasted
    this.onTransactionStatusChanged = options.onTransactionStatusChanged

    this.applyStartupTaskMode(options.startupTaskMode || 'none')
  }

  private async _init (): Promise<void> {
    if (this.chaintracksWithEvents != null) {
      this.spvHeaderSync = new SpvHeaderSync(this.chaintracksWithEvents, this.eventBus, {
        onHeader: this.processHeader.bind(this),
        onReorg: (_depth, _oldTip, _newTip, deactivatedHeaders) => {
          this.recordDeactivatedHeaders(deactivatedHeaders)
        }
      })
      const started = this.spvHeaderSync.start()
      this.reorgSubscriptionPromise = started.then(s => s.reorgSubscriptionId)
      this.headersSubscriptionPromise = started.then(s => s.headerSubscriptionId)
      await started
    }
  }

  private applyStartupTaskMode (mode: MonitorStartupTaskMode): void {
    switch (mode) {
      case 'default':
        this.addDefaultTasks()
        break
      case 'multiuser':
        this.addMultiUserTasks()
        break
      case 'alltoother':
        this.addAllTasksToOther()
        break
      case 'none':
        break
      default:
        throw new WERR_INVALID_PARAMETER('startupTaskMode', '\'none\', \'default\', \'multiuser\', or \'alltoother\'')
    }
  }

  async destroy (): Promise<void> {
    this.stopTasks()
    if (this._tasksRunningPromise != null) await this._tasksRunningPromise
    await this.spvHeaderSync?.stop()
    const seen = new Set<WalletMonitorTask>()
    for (const task of [...this._tasks, ...this._otherTasks]) {
      if (seen.has(task)) continue
      seen.add(task)
      try {
        await task.asyncDestroy()
      } catch (error_: unknown) {
        const e = WalletError.fromUnknown(error_)
        console.log(`monitor task ${task.name} asyncDestroy error ${e.code} ${e.description}`)
      }
    }
  }

  static readonly oneSecond = 1000
  static readonly oneMinute = 60 * Monitor.oneSecond
  static readonly oneHour = 60 * Monitor.oneMinute
  static readonly oneDay = 24 * Monitor.oneHour
  static readonly oneWeek = 7 * Monitor.oneDay

  /**
   * _tasks are typically run by the scheduler but may also be run by runTask.
   */
  _tasks: WalletMonitorTask[] = []
  /**
   * _otherTasks can be run by runTask but not by scheduler.
   */
  _otherTasks: WalletMonitorTask[] = []
  _tasksRunning = false

  defaultPurgeParams: TaskPurgeParams = {
    purgeSpent: false,
    purgeCompleted: false,
    purgeFailed: true,
    purgeSpentAge: 2 * Monitor.oneWeek,
    purgeCompletedAge: 2 * Monitor.oneWeek,
    purgeFailedAge: 5 * Monitor.oneDay
  }

  addAllTasksToOther (): void {
    this._otherTasks.push(
      new TaskClock(this),
      new TaskNewHeader(this),
      new TaskMonitorCallHistory(this),
      new TaskSendWaiting(this, Monitor.oneSecond, Monitor.oneSecond, Monitor.oneMinute * 5, Monitor.oneSecond, 500, 100),
      new TaskCheckForProofs(this),
      new TaskCheckNoSends(this),
      new TaskFailAbandoned(this),
      new TaskUnFail(this),
      new TaskReviewStatus(this),
      new TaskReorg(this),
      new TaskReviewUtxos(this),
      new TaskReviewDoubleSpends(this),
      new TaskReviewProvenTxs(this),
      new TaskPurge(this, this.defaultPurgeParams)
    )
    if (this.chain === 'mock') {
      this._otherTasks.push(new TaskMineBlock(this))
    }
  }

  /**
   * Default tasks with settings appropriate for a single user storage
   */
  addDefaultTasks (): void {
    this._tasks.push(
      new TaskClock(this),
      new TaskNewHeader(this),
      new TaskMonitorCallHistory(this),
      new TaskSendWaiting(this, Monitor.oneSecond, Monitor.oneSecond, Monitor.oneMinute * 5, Monitor.oneSecond, 500, 100),
      new TaskCheckForProofs(this, 2 * Monitor.oneHour), // Every two hours if no block found
      new TaskCheckNoSends(this),
      new TaskFailAbandoned(this, 8 * Monitor.oneMinute),
      new TaskUnFail(this),
      new TaskReviewStatus(this),
      new TaskReorg(this),
      new TaskReviewDoubleSpends(this),
      new TaskReviewProvenTxs(this),
      new TaskArcadeSSE(this)
    )
    this._otherTasks.push(
      new TaskPurge(this, this.defaultPurgeParams, 6 * Monitor.oneHour),
      new TaskReviewUtxos(this)
    )
    if (this.chain === 'mock') {
      this._tasks.push(new TaskMineBlock(this))
    }
  }

  /**
   * Tasks appropriate for multi-user storage
   */
  addMultiUserTasks (): void {
    this._tasks.push(
      new TaskClock(this),
      new TaskNewHeader(this),
      new TaskMonitorCallHistory(this),
      new TaskSendWaiting(this, Monitor.oneSecond, Monitor.oneSecond, Monitor.oneMinute * 5, Monitor.oneSecond, 500, 100),
      new TaskCheckForProofs(this, 2 * Monitor.oneHour), // Every two hours if no block found
      new TaskCheckNoSends(this),
      new TaskFailAbandoned(this, 8 * Monitor.oneMinute),
      new TaskUnFail(this),
      new TaskReviewStatus(this),
      new TaskReorg(this),
      new TaskReviewDoubleSpends(this),
      new TaskReviewProvenTxs(this)
    )
    this._otherTasks.push(
      new TaskPurge(this, this.defaultPurgeParams),
      new TaskReviewUtxos(this)
    )
    if (this.chain === 'mock') {
      this._tasks.push(new TaskMineBlock(this))
    }
  }

  addTask (task: WalletMonitorTask): void {
    if (this._tasks.some(t => t.name === task.name)) { throw new WERR_BAD_REQUEST(`task ${task.name} has already been added.`) }
    this._tasks.push(task)
  }

  removeTask (name: string): void {
    this._tasks = this._tasks.filter(t => t.name !== name)
  }

  async runTask (name: string): Promise<string> {
    let task = this._tasks.find(t => t.name === name)
    let log = ''
    task ??= this._otherTasks.find(t => t.name === name)
    if (task != null) {
      await task.asyncSetup()
      log = await task.runTask()
    }
    return log
  }

  async runOnce (): Promise<void> {
    await this.runTaskAsyncSetups()

    if (this.storage.getActive().isStorageProvider()) {
      const tasksToRun: WalletMonitorTask[] = []
      const now = Date.now()
      for (const t of this._tasks) {
        try {
          if (t.trigger(now).run) tasksToRun.push(t)
        } catch (error_: unknown) {
          const e = WalletError.fromUnknown(error_)
          const details = `monitor task ${t.name} trigger error ${e.code} ${e.description}`
          console.log(details)
          await this.logEvent('error0', details)
        }
      }

      const concurrency = Math.max(1, this.options.taskRunConcurrency ?? tasksToRun.length)
      const limit = pLimit(concurrency)
      await Promise.all(tasksToRun.map(async ttr => await limit(async () => await this.runTriggeredTask(ttr))))
    }
  }

  private async runTriggeredTask (ttr: WalletMonitorTask): Promise<void> {
    try {
      if (this.storage.getActive().isStorageProvider()) {
        const log = await ttr.runTask()
        if (log && log.length > 0) {
          let details = log.slice(0, 1024)
          if (ttr.name === 'MonitorCallHistory') {
            details = '...'
          }
          console.log(`Task${ttr.name} ${details}`)
          await this.logEvent(ttr.name, log)
        }
      }
    } catch (error_: unknown) {
      const e = WalletError.fromUnknown(error_)
      const details = `monitor task ${ttr.name} runTask error ${e.code} ${e.description}\n${e.stack}`
      console.log(details)
      await this.logEvent('error1', details)
    } finally {
      ttr.lastRunMsecsSinceEpoch = Date.now()
    }
  }

  _runAsyncSetup: boolean = true
  _tasksRunningPromise?: PromiseLike<void>
  resolveCompletion: ((value: void | PromiseLike<void>) => void) | undefined = undefined

  async startTasks (): Promise<void> {
    if (this._tasksRunning) throw new WERR_BAD_REQUEST('monitor tasks are already runnining.')

    this._tasksRunning = true
    this._tasksRunningPromise = new Promise(resolve => {
      this.resolveCompletion = resolve
    })

    try {
      await this.runTaskAsyncSetups()

      if (this._tasks.length === 0) {
        while (this._tasksRunning) await wait(this.taskSchedulerWaitMsecs)
      } else {
        const concurrency = Math.max(1, this.options.taskRunConcurrency ?? this._tasks.length)
        const limit = pLimit(concurrency)
        await Promise.all(this._tasks.map(async task => await this.runTaskSchedulerLoop(task, limit)))
      }
    } finally {
      if (this.resolveCompletion != null) {
        this.resolveCompletion()
        this.resolveCompletion = undefined
      }
    }
  }

  private async runTaskAsyncSetups (): Promise<void> {
    if (!this._runAsyncSetup) return
    for (const t of this._tasks) {
      try {
        await t.asyncSetup()
      } catch (error_: unknown) {
        const e = WalletError.fromUnknown(error_)
        const details = `monitor task ${t.name} asyncSetup error ${e.code} ${e.description}`
        console.log(details)
        await this.logEvent('error0', details)
      }
      if (this._tasksRunning === false) break
    }
    this._runAsyncSetup = false
  }

  private async runTaskSchedulerLoop (
    task: WalletMonitorTask,
    limit: ReturnType<typeof pLimit>
  ): Promise<void> {
    while (this._tasksRunning) {
      if (this.storage.getActive().isStorageProvider()) {
        const now = Date.now()
        try {
          if (task.trigger(now).run) await limit(async () => await this.runTriggeredTask(task))
        } catch (error_: unknown) {
          const e = WalletError.fromUnknown(error_)
          const details = `monitor task ${task.name} trigger error ${e.code} ${e.description}`
          console.log(details)
          await this.logEvent('error0', details)
        }
      }
      if (!this._tasksRunning) break
      await wait(this.taskSchedulerWaitMsecs)
    }
  }

  private get taskSchedulerWaitMsecs (): number {
    return Math.max(1, this.options.taskRunWaitMsecs)
  }

  async logEvent (event: string, details?: string): Promise<void> {
    await this.storage.runAsStorageProvider(async sp => {
      await sp.insertMonitorEvent({
        created_at: new Date(),
        updated_at: new Date(),
        id: 0,
        event,
        details
      })
    })
  }

  stopTasks (): void {
    this._tasksRunning = false
  }

  lastNewHeader: BlockHeader | undefined
  lastNewBlockHeight: number | undefined
  lastNewHeaderWhen: Date | undefined

  /**
   * Process new chain header event received from Chaintracks
   *
   * Kicks processing 'unconfirmed' and 'unmined' request processing.
   *
   * @param reqs
   */
  processNewBlockHeader (header: BlockHeader): void {
    const h = header
    this.lastNewHeader = h
    this.processBlockMinedNotice(h.height, h.hash, h)
  }

  processBlockMinedNotice (blockHeight?: number, blockHash?: string, header?: BlockHeader): void {
    if (blockHeight !== undefined) {
      this.lastNewBlockHeight = blockHeight
      this.lastNewHeaderWhen = new Date()
      TaskCheckForProofs.checkNow = true
    }
    this.eventBus.emitBlockMined({
      blockHeight: blockHeight ?? 0,
      blockHash,
      timestamp: Date.now(),
      header
    })
    // console.log(`WalletMonitor notified of new block height ${blockHeight ?? 'unknown'}`)
  }

  /**
   * This is a function run from a TaskSendWaiting Monitor task.
   *
   * This allows the user of wallet-toolbox to 'subscribe' for transaction broadcast updates.
   *
   * @param broadcastResult
   */
  callOnBroadcastedTransaction (broadcastResult: ReviewActionResult): void {
    if (this.onTransactionBroadcasted != null) {
      this.onTransactionBroadcasted(broadcastResult)
    }
  }

  /**
   * This is a function run from a TaskCheckForProofs Monitor task.
   *
   * This allows the user of wallet-toolbox to 'subscribe' for transaction updates.
   *
   * @param txStatus
   */
  callOnProvenTransaction (txStatus: ProvenTransactionStatus): void {
    if (this.onTransactionProven != null) {
      this.onTransactionProven(txStatus)
    }
  }

  /**
   * Called by TaskArcadeSSE when an SSE status event is received from Arcade.
   */
  callOnTransactionStatusChanged (txid: string, newStatus: string): void {
    if (this.onTransactionStatusChanged != null) {
      this.onTransactionStatusChanged(txid, newStatus)
    }
  }

  /**
   * Fetch pending transaction status events from Arcade on demand.
   * Call this on app open, balance refresh, transaction list view, etc.
   */
  async fetchSSEEvents (): Promise<number> {
    const sseTask = this._tasks.find(t => t.name === TaskArcadeSSE.taskName) as TaskArcadeSSE | undefined
    return (await sseTask?.fetchNow()) ?? 0
  }

  deactivatedHeaders: DeactivedHeader[] = []

  /**
   * Process reorg event received from Chaintracks
   *
   * Reorgs can move recent transactions to new blocks at new index positions.
   * Affected transaction proofs become invalid and must be updated.
   *
   * It is possible for a transaction to become invalid.
   *
   * Coinbase transactions always become invalid.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  processReorg (depth: number, oldTip: BlockHeader, newTip: BlockHeader, deactivatedHeaders?: BlockHeader[]): void {
    this.eventBus.emitReorg({ depth, oldTip, newTip, deactivatedHeaders })
    this.recordDeactivatedHeaders(deactivatedHeaders)
  }

  private recordDeactivatedHeaders (deactivatedHeaders?: BlockHeader[]): void {
    if (deactivatedHeaders != null) {
      for (const header of deactivatedHeaders) {
        this.deactivatedHeaders.push({
          whenMsecs: Date.now(),
          tries: 0,
          header
        })
      }
    }
  }

  /**
   * Handler for new header events from Chaintracks.
   *
   * To minimize reorg processing, new headers are aged before processing via TaskNewHeader.
   * Therefore this handler is intentionally a no-op.
   *
   * @param header
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  processHeader (header: BlockHeader): void {
    // Intentional no-op: new headers are aged via TaskNewHeader before processing
  }
}

export interface DeactivedHeader {
  /**
   * To control aging of notification before pursuing updated proof data.
   */
  whenMsecs: number
  /**
   * Number of attempts made to process the header.
   * Supports returning deactivation notification to the queue if proof data is not yet available.
   */
  tries: number
  /**
   * The deactivated block header.
   */
  header: BlockHeader
}
