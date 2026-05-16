import { wait } from '../../../utility/utilityHelpers'
import { attemptToPostReqsToNetwork } from '../../../storage/methods/attemptToPostReqsToNetwork'
import { TaskSendWaiting } from '../TaskSendWaiting'

jest.mock('../../../storage/methods/attemptToPostReqsToNetwork', () => ({
  attemptToPostReqsToNetwork: jest.fn()
}))

function makeReq (provenTxReqId: number, txid: string, batch?: string): any {
  const now = new Date()
  return {
    provenTxReqId,
    created_at: now,
    updated_at: now,
    txid,
    rawTx: [],
    batch,
    status: 'unsent',
    history: '{}',
    notify: '{}',
    attempts: provenTxReqId,
    notified: false
  }
}

function makeReqWithAttempts (provenTxReqId: number, txid: string, attempts: number): any {
  return {
    ...makeReq(provenTxReqId, txid),
    attempts
  }
}

describe('TaskSendWaiting processUnsent queue', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  test('processes independent reqs concurrently while preserving one work item per batch', async () => {
    const reqs = [
      makeReq(1, 'tx1'),
      makeReq(2, 'tx2'),
      makeReq(3, 'tx3', 'batch-1'),
      makeReq(4, 'tx4', 'batch-1')
    ]
    const storage = {
      findProvenTxReqs: jest.fn(async ({ partial }: any) => {
        if (partial?.batch != null) return reqs.filter(req => req.batch === partial.batch)
        return reqs
      }),
      runAsStorageProvider: jest.fn((fn: any) => fn({}))
    }
    const monitor = { storage } as any
    let active = 0
    let maxActive = 0
    const calls: string[][] = []
    ;(attemptToPostReqsToNetwork as jest.Mock).mockImplementation(async (_sp, entityReqs) => {
      active++
      maxActive = Math.max(maxActive, active)
      calls.push(entityReqs.map((req: any) => req.txid))
      await wait(25)
      active--
      return {
        details: entityReqs.map((req: any) => ({
          txid: req.txid,
          req,
          status: 'success'
        }))
      }
    })
    const task = new TaskSendWaiting(monitor, 1, 1, 300000, 1, 500, 3)

    const log = await task.processUnsent(reqs, 0)

    expect(maxActive).toBeGreaterThan(1)
    expect(calls).toHaveLength(3)
    expect(calls).toContainEqual(['tx1'])
    expect(calls).toContainEqual(['tx2'])
    expect(calls).toContainEqual(['tx3', 'tx4'])
    expect(log).toContain('tx4: processed with batch')
  })

  test('prioritizes retry attempts before lower-attempt work when concurrency is constrained', async () => {
    const reqs = [
      makeReqWithAttempts(1, 'tx-low', 0),
      makeReqWithAttempts(2, 'tx-high', 5),
      makeReqWithAttempts(3, 'tx-mid', 2)
    ]
    const storage = {
      findProvenTxReqs: jest.fn(async () => reqs),
      runAsStorageProvider: jest.fn((fn: any) => fn({}))
    }
    const metrics = { setSendWaitingQueue: jest.fn() }
    const monitor = { storage, services: { metrics } } as any
    const calls: string[] = []
    ;(attemptToPostReqsToNetwork as jest.Mock).mockImplementation(async (_sp, entityReqs) => {
      calls.push(entityReqs[0].txid)
      return {
        details: entityReqs.map((req: any) => ({
          txid: req.txid,
          req,
          status: 'success'
        }))
      }
    })
    const task = new TaskSendWaiting(monitor, 1, 1, 300000, 1, 500, 1)

    const log = await task.processUnsent(reqs, 0)

    expect(calls).toEqual(['tx-high', 'tx-mid', 'tx-low'])
    expect(metrics.setSendWaitingQueue).toHaveBeenCalledWith(3, 0)
    expect(metrics.setSendWaitingQueue).toHaveBeenLastCalledWith(0, 0)
    expect(log.split('\n').filter(Boolean).map(line => line.trim().split(' ')[1])).toEqual([
      'reqId=1',
      'reqId=2',
      'reqId=3'
    ])
  })
})
