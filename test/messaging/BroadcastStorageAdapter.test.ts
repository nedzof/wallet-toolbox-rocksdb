import { Beef, PrivateKey, Script, Transaction } from '@bsv/sdk'
import { mkdtemp, rm } from 'fs/promises'
import os from 'os'
import path from 'path'

import { BroadcastStorageAdapter } from '../../src/storage/BroadcastStorageAdapter'
import { TxBroadcastMessage } from '../../src/messaging/messages'
import { StorageProvider } from '../../src/storage/StorageProvider'
import { StorageRocksDb } from '../../src/storage/StorageRocksDb'
import { TableProvenTxReq } from '../../src/storage/schema/tables/TableProvenTxReq'
import { TableTransaction } from '../../src/storage/schema/tables/TableTransaction'
import { asString } from '../../src/utility/utilityHelpers.noBuffer'

describe('BroadcastStorageAdapter', () => {
  let dir: string
  let storage: StorageRocksDb

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'wallet-toolbox-broadcast-storage-adapter-'))
    storage = new StorageRocksDb({
      ...StorageProvider.createStorageBaseOptions('test'),
      path: path.join(dir, 'broadcast-storage-adapter.rocksdb')
    })
    await storage.migrate('broadcast-storage-adapter', PrivateKey.fromRandom().toPublicKey().toString())
    await storage.makeAvailable()
  })

  afterEach(async () => {
    await storage.destroy()
    await rm(dir, { recursive: true, force: true })
  })

  test('loads raw transaction data from RocksDB without putting raw bytes on the message', async () => {
    const seeded = await seedReq('sending')
    const adapter = new BroadcastStorageAdapter(storage)

    const request = await adapter.loadBroadcastRequest(makeMessage(seeded.reqId, seeded.txid))

    expect(request.txid).toBe(seeded.txid)
    expect(request.rawTx).toBe(asString(seeded.rawTx))
    expect((makeMessage(seeded.reqId, seeded.txid) as unknown as { rawTx?: unknown }).rawTx).toBeUndefined()
  })

  test('records accepted outcomes durably and idempotently', async () => {
    const seeded = await seedReq('sending')
    const adapter = new BroadcastStorageAdapter(storage)
    const message = makeMessage(seeded.reqId, seeded.txid)
    const record = {
      message,
      outcome: 'accepted' as const,
      results: [{
        name: 'provider',
        status: 'success' as const,
        txidResults: [{ txid: seeded.txid, status: 'success' as const }]
      }]
    }

    await adapter.recordBroadcastAttempt(record)
    await adapter.recordBroadcastAttempt(record)

    const [req] = await storage.findProvenTxReqs({ partial: { provenTxReqId: seeded.reqId } })
    const [tx] = await storage.findTransactions({ partial: { transactionId: seeded.transactionId }, noRawTx: true })
    expect(req.status).toBe('unmined')
    expect(req.wasBroadcast).toBe(true)
    expect(tx.status).toBe('unproven')
    expect(JSON.parse(req.history).notes.filter((note: any) => note.distributedBroadcastIdempotencyKey === message.idempotencyKey)).toHaveLength(1)
  })

  test('records unknown outcomes for reconciliation without returning to send-waiting retry status', async () => {
    const seeded = await seedReq('sending')
    const adapter = new BroadcastStorageAdapter(storage)

    await adapter.recordBroadcastAttempt({
      message: makeMessage(seeded.reqId, seeded.txid),
      outcome: 'unknown',
      results: []
    })

    const [req] = await storage.findProvenTxReqs({ partial: { provenTxReqId: seeded.reqId } })
    expect(req.status).toBe('unknown')
    expect(JSON.parse(req.history).notes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        what: 'distributedBroadcastOutcome',
        outcome: 'unknown',
        reconciliation_required: true
      })
    ]))
  })

  async function seedReq (status: TableProvenTxReq['status']): Promise<{
    reqId: number
    transactionId: number
    txid: string
    rawTx: number[]
  }> {
    const tx = new Transaction()
    tx.addOutput({ lockingScript: Script.fromASM('OP_1'), satoshis: 1 })
    const rawTx = tx.toBinary()
    const txid = tx.id('hex')
    const transactionId = await storage.insertTransaction(makeTransaction(status === 'sending' ? 'sending' : 'unprocessed', txid))
    const inputBEEF = new Beef().toBinary()
    const reqId = await storage.insertProvenTxReq({
      created_at: new Date(),
      updated_at: new Date(),
      provenTxReqId: 0,
      status,
      attempts: 1,
      notified: false,
      txid,
      history: '{}',
      notify: JSON.stringify({ transactionIds: [transactionId] }),
      rawTx,
      inputBEEF,
      wasBroadcast: false,
      rebroadcastAttempts: 0
    })
    return { reqId, transactionId, txid, rawTx }
  }
})

function makeMessage (provenTxReqId: number, txid: string): TxBroadcastMessage {
  return {
    messageId: `message-${provenTxReqId}`,
    idempotencyKey: `test:storage:broadcast:${provenTxReqId}:${txid}:1`,
    createdAtMs: Date.now(),
    schemaVersion: 1,
    source: 'test',
    chain: 'test',
    txid,
    rawTxHash: 'a'.repeat(64),
    attempt: 1,
    priority: 1,
    walletStorageIdentityKey: 'storage',
    provenTxReqId
  }
}

function makeTransaction (status: TableTransaction['status'], txid: string): TableTransaction {
  const now = new Date()
  return {
    created_at: now,
    updated_at: now,
    transactionId: 0,
    userId: 1,
    status,
    reference: `broadcast-storage-adapter-${status}`,
    isOutgoing: true,
    satoshis: 1,
    version: 1,
    lockTime: 0,
    txid,
    description: 'broadcast storage adapter test'
  }
}
