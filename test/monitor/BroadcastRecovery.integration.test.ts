import { PrivateKey, Script, Transaction } from '@bsv/sdk'
import { mkdtemp, rm } from 'fs/promises'
import os from 'os'
import path from 'path'

import { TaskSendWaiting } from '../../src/monitor/tasks/TaskSendWaiting'
import { getProofs } from '../../src/monitor/tasks/TaskCheckForProofs'
import { WalletMonitorTask } from '../../src/monitor/tasks/WalletMonitorTask'
import { StorageProvider } from '../../src/storage/StorageProvider'
import { StorageRocksDb } from '../../src/storage/StorageRocksDb'
import { WalletStorageManager } from '../../src/storage/WalletStorageManager'
import { EntityProvenTx, EntityProvenTxReq } from '../../src/storage/schema/entities'
import { TableOutput } from '../../src/storage/schema/tables/TableOutput'
import { TableProvenTx } from '../../src/storage/schema/tables/TableProvenTx'
import { TableProvenTxReq } from '../../src/storage/schema/tables/TableProvenTxReq'
import { TableTransaction } from '../../src/storage/schema/tables/TableTransaction'
import { ProvenTxReqStatus, TransactionStatus } from '../../src/sdk'

describe('BroadcastRecovery integration', () => {
  let dir: string
  let storage: StorageRocksDb
  let manager: WalletStorageManager

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'wallet-toolbox-broadcast-recovery-'))
    const identityKey = PrivateKey.fromRandom().toPublicKey().toString()
    storage = new StorageRocksDb({
      ...StorageProvider.createStorageBaseOptions('test'),
      path: path.join(dir, 'broadcast-recovery.rocksdb')
    })
    await storage.migrate('broadcast-recovery', identityKey)
    await storage.makeAvailable()
    manager = new WalletStorageManager(identityKey, storage)
    await manager.makeAvailable()
  })

  afterEach(async () => {
    await manager.destroy()
    await rm(dir, { recursive: true, force: true })
  })

  test('scenario 3b rebroadcast keeps the same txid locked until proof completion', async () => {
    const { reqId, txid, outputId, failedTxId } = await seedBroadcastFailure({
      status: 'unmined',
      attempts: 101,
      wasBroadcast: true
    })

    const [beforeProofTimeout] = await storage.findProvenTxReqs({ partial: { provenTxReqId: reqId } })
    const timeout = await getProofs(makeProofTask(2), [beforeProofTimeout], 0)
    const [afterProofTimeout] = await storage.findProvenTxReqs({ partial: { provenTxReqId: reqId } })

    expect(timeout.invalid).toEqual([])
    expect(afterProofTimeout).toMatchObject({
      txid,
      status: 'unsent',
      attempts: 0,
      wasBroadcast: true,
      rebroadcastAttempts: 1
    })

    await storage.reviewStatus({ agedLimit: new Date(0) })
    await expectLocked(outputId, failedTxId)

    const published: Array<{ txid: string, provenTxReqId: number, attempt: number }> = []
    const task = new TaskSendWaiting(makeSendWaitingMonitor(published), 1, 1, 300000, 1, 500, 1)
    await task.processUnsent([afterProofTimeout])
    const [afterSendWaiting] = await storage.findProvenTxReqs({ partial: { provenTxReqId: reqId } })

    expect(published).toEqual([expect.objectContaining({ txid, provenTxReqId: reqId, attempt: 1 })])
    expect(afterSendWaiting).toMatchObject({ txid, status: 'sending', attempts: 1 })

    await storage.reviewStatus({ agedLimit: new Date(0) })
    await expectLocked(outputId, failedTxId)

    const provenTxId = await storage.insertProvenTx(makeProvenTx(txid))
    await storage.updateProvenTxReqDynamics(reqId, {
      ...dynamicFromReq(afterSendWaiting),
      status: 'completed',
      provenTxId,
      notified: false
    })
    await storage.reviewStatus({ agedLimit: new Date(0) })

    const [completedTx] = await storage.findTransactions({ partial: { transactionId: failedTxId }, noRawTx: true })
    const [output] = await storage.findOutputs({ partial: { outputId }, noScript: true })
    expect(completedTx).toMatchObject({ status: 'completed', provenTxId, txid })
    expect(output.spendable).toBe(false)
    expect(output.spentBy).toBe(failedTxId)
  })

  test('scenario 8 reviewStatusIdb does not restore inputs for live mempool transactions', async () => {
    const { outputId, failedTxId } = await seedBroadcastFailure({
      status: 'unmined',
      attempts: 1,
      wasBroadcast: true
    })

    await storage.reviewStatus({ agedLimit: new Date(0) })

    await expectLocked(outputId, failedTxId)
  })

  test('scenario 9 circuit breaker invalidates after the configured rebroadcast limit and then restores inputs', async () => {
    const { reqId, txid, outputId } = await seedBroadcastFailure({
      status: 'unmined',
      attempts: 101,
      wasBroadcast: true
    })

    await forceTimeout(reqId, 2)
    await markReqForNextTimeout(reqId)
    await forceTimeout(reqId, 2)
    await markReqForNextTimeout(reqId)
    await forceTimeout(reqId, 2)

    const [invalidReq] = await storage.findProvenTxReqs({ partial: { provenTxReqId: reqId } })
    expect(invalidReq).toMatchObject({
      txid,
      status: 'invalid',
      rebroadcastAttempts: 2,
      wasBroadcast: true
    })

    await storage.reviewStatus({ agedLimit: new Date(0) })
    const [output] = await storage.findOutputs({ partial: { outputId }, noScript: true })
    expect(output.spendable).toBe(true)
    expect(output.spentBy).toBeUndefined()
  })

  test('scenario 10 proof secondary threshold respects whether a request was broadcast', async () => {
    const broadcastReq = new EntityProvenTxReq(makeReq('unmined', 9, true, 0, oldDate()))
    const neverBroadcastReq = new EntityProvenTxReq(makeReq('unknown', 9, false, 0, oldDate()))

    await EntityProvenTx.fromReq(broadcastReq, { name: 'provider', status: 'error' } as never, false, 2)
    await EntityProvenTx.fromReq(neverBroadcastReq, { name: 'provider', status: 'error' } as never, false, 2)

    expect(broadcastReq).toMatchObject({
      status: 'unsent',
      attempts: 0,
      wasBroadcast: true,
      rebroadcastAttempts: 1
    })
    expect(neverBroadcastReq).toMatchObject({
      status: 'invalid',
      attempts: 9,
      wasBroadcast: false,
      rebroadcastAttempts: 0
    })
  })

  test('scenario 11 never-broadcast invalid transactions restore inputs in RocksDB reviewStatus', async () => {
    const { reqId, outputId } = await seedBroadcastFailure({
      status: 'unknown',
      attempts: 101,
      wasBroadcast: false
    })
    const [req] = await storage.findProvenTxReqs({ partial: { provenTxReqId: reqId } })

    await getProofs(makeProofTask(2), [req], 0)
    await storage.reviewStatus({ agedLimit: new Date(0) })

    const [restored] = await storage.findOutputs({ partial: { outputId }, noScript: true })
    expect(restored.spendable).toBe(true)
    expect(restored.spentBy).toBeUndefined()
  })

  async function seedBroadcastFailure (args: {
    status: ProvenTxReqStatus
    attempts: number
    wasBroadcast: boolean
    rebroadcastAttempts?: number
  }): Promise<{ reqId: number, txid: string, outputId: number, failedTxId: number }> {
    const tx = new Transaction()
    tx.addOutput({ lockingScript: Script.fromASM('OP_1'), satoshis: 1 })
    const txid = tx.id('hex')
    const sourceTxId = await storage.insertTransaction(makeTransaction('completed', 'aa'.repeat(32)))
    const failedTxId = await storage.insertTransaction(makeTransaction('failed', txid))
    const outputId = await storage.insertOutput({
      ...makeOutput(sourceTxId),
      spentBy: failedTxId
    })
    const reqId = await storage.insertProvenTxReq({
      ...makeReq(args.status, args.attempts, args.wasBroadcast, args.rebroadcastAttempts ?? 0),
      txid,
      rawTx: tx.toBinary()
    })
    return { reqId, txid, outputId, failedTxId }
  }

  async function forceTimeout (reqId: number, maxRebroadcastAttempts: number): Promise<void> {
    const [req] = await storage.findProvenTxReqs({ partial: { provenTxReqId: reqId } })
    await getProofs(makeProofTask(maxRebroadcastAttempts), [req], 0)
  }

  async function markReqForNextTimeout (reqId: number): Promise<void> {
    const [req] = await storage.findProvenTxReqs({ partial: { provenTxReqId: reqId } })
    await storage.updateProvenTxReqDynamics(reqId, {
      ...dynamicFromReq(req),
      status: 'unmined',
      attempts: 101,
      notified: false
    })
  }

  async function expectLocked (outputId: number, spentBy: number): Promise<void> {
    const [output] = await storage.findOutputs({ partial: { outputId }, noScript: true })
    expect(output.spendable).toBe(false)
    expect(output.spentBy).toBe(spentBy)
  }

  function makeProofTask (maxRebroadcastAttempts: number): WalletMonitorTask {
    return {
      storage,
      monitor: {
        chain: 'test',
        options: {
          unprovenAttemptsLimitTest: 100,
          unprovenAttemptsLimitMain: 144,
          maxRebroadcastAttempts
        },
        services: {
          getMerklePath: jest.fn()
        }
      }
    } as unknown as WalletMonitorTask
  }

  function makeSendWaitingMonitor (published: Array<{ txid: string, provenTxReqId: number, attempt: number }>): any {
    return {
      storage: manager,
      services: {},
      broadcastPublisher: {
        publish: jest.fn(async (message: { txid: string, provenTxReqId: number, attempt: number }) => {
          published.push(message)
          return { stream: 'TX_BROADCAST', seq: published.length, duplicate: false }
        })
      }
    }
  }
})

function makeReq (
  status: ProvenTxReqStatus,
  attempts: number,
  wasBroadcast: boolean,
  rebroadcastAttempts: number,
  createdAt = new Date()
): TableProvenTxReq {
  const tx = new Transaction()
  tx.addOutput({ lockingScript: Script.fromASM('OP_1'), satoshis: 1 })
  return {
    created_at: createdAt,
    updated_at: new Date(),
    provenTxReqId: 0,
    status,
    attempts,
    notified: false,
    txid: tx.id('hex'),
    history: '{}',
    notify: '{}',
    rawTx: tx.toBinary(),
    wasBroadcast,
    rebroadcastAttempts
  }
}

function dynamicFromReq (req: TableProvenTxReq): Pick<TableProvenTxReq, 'updated_at' | 'status' | 'attempts' | 'notified' | 'history' | 'notify' | 'wasBroadcast' | 'rebroadcastAttempts'> {
  return {
    updated_at: new Date(),
    status: req.status,
    attempts: req.attempts,
    notified: req.notified,
    history: req.history,
    notify: req.notify,
    wasBroadcast: req.wasBroadcast,
    rebroadcastAttempts: req.rebroadcastAttempts
  }
}

function makeTransaction (status: TransactionStatus, txid: string): TableTransaction {
  const now = new Date()
  return {
    created_at: now,
    updated_at: now,
    transactionId: 0,
    userId: 1,
    status,
    reference: `broadcast-recovery-${status}`,
    isOutgoing: true,
    satoshis: 1,
    description: 'broadcast recovery integration test',
    txid
  }
}

function makeOutput (transactionId: number): TableOutput {
  const now = new Date()
  return {
    created_at: now,
    updated_at: now,
    outputId: 0,
    userId: 1,
    transactionId,
    spendable: false,
    change: true,
    outputDescription: 'broadcast recovery output',
    vout: 0,
    satoshis: 1,
    providedBy: 'storage',
    purpose: 'change',
    type: 'P2PKH',
    txid: 'aa'.repeat(32),
    lockingScript: [0x51]
  }
}

function makeProvenTx (txid: string): TableProvenTx {
  const now = new Date()
  return {
    created_at: now,
    updated_at: now,
    provenTxId: 0,
    txid,
    height: 1,
    index: 0,
    merklePath: [],
    rawTx: [0x00],
    blockHash: '11'.repeat(32),
    merkleRoot: '22'.repeat(32)
  }
}

function oldDate (): Date {
  return new Date(Date.now() - 61 * 60 * 1000)
}
