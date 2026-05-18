import { Script, Transaction } from '@bsv/sdk'
import { getProofs } from '../../src/monitor/tasks/TaskCheckForProofs'
import { WalletMonitorTask } from '../../src/monitor/tasks/WalletMonitorTask'
import { TableProvenTxReq } from '../../src/storage/schema/tables/TableProvenTxReq'
import { ProvenTxReqStatus } from '../../src/sdk'

describe('TaskCheckForProofs rebroadcast timeout handling', () => {
  test('rebroadcasts a req that previously reached unmined instead of marking inputs invalid', async () => {
    const storage = makeStorage()
    const req = makeReq('unknown', 11, {
      notes: [{
        what: 'status',
        status_was: 'sending',
        status_now: 'unmined',
        when: new Date().toISOString()
      }]
    })

    const result = await getProofs(makeTask(storage, 3), [req], 0)

    expect(result.invalid).toEqual([])
    expect(storage.updateProvenTxReqDynamics).toHaveBeenCalledWith(
      req.provenTxReqId,
      expect.objectContaining({
        status: 'unsent',
        attempts: 0,
        notified: false,
        wasBroadcast: true,
        rebroadcastAttempts: 1
      }),
      undefined
    )
  })

  test('marks never-broadcast proof timeouts invalid', async () => {
    const storage = makeStorage()
    const req = makeReq('unknown', 11)

    const result = await getProofs(makeTask(storage, 3), [req], 0)

    expect(result.invalid).toEqual([req])
    expect(storage.updateProvenTxReqDynamics).toHaveBeenCalledWith(
      req.provenTxReqId,
      expect.objectContaining({
        status: 'invalid',
        attempts: 11,
        notified: false,
        wasBroadcast: false,
        rebroadcastAttempts: 0
      }),
      undefined
    )
  })

  test('uses maxRebroadcastAttempts as a circuit breaker', async () => {
    const storage = makeStorage()
    const req = makeReq('unmined', 11, {}, true, 1)

    const result = await getProofs(makeTask(storage, 1), [req], 0)

    expect(result.invalid).toEqual([req])
    expect(storage.updateProvenTxReqDynamics).toHaveBeenCalledWith(
      req.provenTxReqId,
      expect.objectContaining({
        status: 'invalid',
        attempts: 11,
        notified: false,
        wasBroadcast: true,
        rebroadcastAttempts: 1
      }),
      undefined
    )
  })
})

function makeTask (
  storage: ReturnType<typeof makeStorage>,
  maxRebroadcastAttempts: number
): WalletMonitorTask {
  return {
    storage,
    monitor: {
      chain: 'test',
      options: {
        unprovenAttemptsLimitTest: 10,
        unprovenAttemptsLimitMain: 144,
        maxRebroadcastAttempts
      }
    }
  } as unknown as WalletMonitorTask
}

function makeStorage () {
  return {
    isStorageProvider: () => true,
    updateProvenTxReqDynamics: jest.fn(async () => 1)
  }
}

function makeReq (
  status: ProvenTxReqStatus,
  attempts: number,
  history: object = {},
  wasBroadcast = false,
  rebroadcastAttempts = 0
): TableProvenTxReq {
  const tx = new Transaction()
  tx.addOutput({ lockingScript: new Script(), satoshis: 1 })
  const now = new Date()
  return {
    created_at: now,
    updated_at: now,
    provenTxReqId: 1,
    status,
    attempts,
    notified: true,
    txid: tx.id('hex'),
    history: JSON.stringify(history),
    notify: '{}',
    rawTx: tx.toBinary(),
    wasBroadcast,
    rebroadcastAttempts
  }
}
