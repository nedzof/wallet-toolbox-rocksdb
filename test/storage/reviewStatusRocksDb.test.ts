import { mkdtemp, rm } from 'fs/promises'
import os from 'os'
import path from 'path'
import { PrivateKey } from '@bsv/sdk'
import { StorageProvider } from '../../src/storage/StorageProvider'
import { StorageRocksDb } from '../../src/storage/StorageRocksDb'
import { TableOutput } from '../../src/storage/schema/tables/TableOutput'
import { TableProvenTx } from '../../src/storage/schema/tables/TableProvenTx'
import { TableProvenTxReq } from '../../src/storage/schema/tables/TableProvenTxReq'
import { TableTransaction } from '../../src/storage/schema/tables/TableTransaction'
import { ProvenTxReqStatus, TransactionStatus } from '../../src/sdk'

describe('reviewStatusIdb through StorageRocksDb', () => {
  let dir: string
  let storage: StorageRocksDb

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'wallet-toolbox-review-status-rocksdb-'))
    storage = new StorageRocksDb({
      ...StorageProvider.createStorageBaseOptions('test'),
      path: path.join(dir, 'review-status.rocksdb')
    })
    await storage.migrate('review-status-rocksdb', PrivateKey.fromRandom().toPublicKey().toString())
    await storage.makeAvailable()
  })

  afterEach(async () => {
    await storage.destroy()
    await rm(dir, { recursive: true, force: true })
  })

  test('does not restore failed transaction inputs when a live ProvenTxReq exists', async () => {
    const { outputId, failedTxId } = await seedSpentInput('live-req-txid')
    await storage.insertProvenTxReq(makeReq('live-req-txid', 'unmined', true))

    const result = await storage.reviewStatus({ agedLimit: new Date(0) })
    const [output] = await storage.findOutputs({ partial: { outputId } })

    expect(result.log).not.toContain(`output ${outputId} restored`)
    expect(output.spendable).toBe(false)
    expect(output.spentBy).toBe(failedTxId)
  })

  test('restores failed transaction inputs when all ProvenTxReqs are terminal-safe', async () => {
    const { outputId } = await seedSpentInput('terminal-req-txid')
    await storage.insertProvenTxReq(makeReq('terminal-req-txid', 'invalid', false))

    const result = await storage.reviewStatus({ agedLimit: new Date(0) })
    const [output] = await storage.findOutputs({ partial: { outputId } })

    expect(result.log).toContain(`output ${outputId} restored to spendable`)
    expect(output.spendable).toBe(true)
    expect(output.spentBy).toBeUndefined()
  })

  test('restores failed transaction inputs when no ProvenTxReq exists', async () => {
    const { outputId } = await seedSpentInput('no-req-txid')

    await storage.reviewStatus({ agedLimit: new Date(0) })
    const [output] = await storage.findOutputs({ partial: { outputId } })

    expect(output.spendable).toBe(true)
    expect(output.spentBy).toBeUndefined()
  })

  test('marks transactions completed when matching ProvenTx exists', async () => {
    const txid = '44'.repeat(32)
    const txId = await storage.insertTransaction(makeTransaction('unproven', txid))
    const provenTxId = await storage.insertProvenTx(makeProvenTx(txid))

    const result = await storage.reviewStatus({ agedLimit: new Date(0) })
    const [tx] = await storage.findTransactions({ partial: { transactionId: txId }, noRawTx: true })

    expect(result.log).toContain(`transaction ${txId} updated with provenTxId ${provenTxId}`)
    expect(tx.status).toBe('completed')
    expect(tx.provenTxId).toBe(provenTxId)
  })

  async function seedSpentInput (txid: string): Promise<{ outputId: number, failedTxId: number }> {
    const sourceTxId = await storage.insertTransaction(makeTransaction('completed', 'aa'.repeat(32)))
    const failedTxId = await storage.insertTransaction(makeTransaction('failed', txid))
    const outputId = await storage.insertOutput({
      ...makeOutput(sourceTxId),
      spentBy: failedTxId
    })
    return { outputId, failedTxId }
  }
})

function makeTransaction (status: TransactionStatus, txid: string): TableTransaction {
  const now = new Date()
  return {
    created_at: now,
    updated_at: now,
    transactionId: 0,
    userId: 1,
    status,
    reference: `review-status-${status}`,
    isOutgoing: true,
    satoshis: 1,
    description: 'review status rocksdb test',
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
    outputDescription: 'review status output',
    vout: 0,
    satoshis: 1,
    providedBy: 'storage',
    purpose: 'change',
    type: 'P2PKH',
    txid: 'aa'.repeat(32),
    lockingScript: [0x51]
  }
}

function makeReq (txid: string, status: ProvenTxReqStatus, wasBroadcast: boolean): TableProvenTxReq {
  const now = new Date()
  return {
    created_at: now,
    updated_at: now,
    provenTxReqId: 0,
    status,
    attempts: 0,
    notified: false,
    txid,
    history: '{}',
    notify: '{}',
    rawTx: [0x00],
    wasBroadcast,
    rebroadcastAttempts: 0
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
