import { Script, Transaction } from '@bsv/sdk'
import {
  AggregatePostBeefTxResult,
  markStaleInputsAsSpent
} from '../../src/storage/methods/attemptToPostReqsToNetwork'
import { EntityProvenTxReq } from '../../src/storage/schema/entities'
import { TableOutput, TableProvenTxReq, TableTransaction } from '../../src/storage/schema/tables'
import type { WalletServices } from '../../src/sdk/WalletServices.interfaces'
import { EventBus } from '../../src/events/EventBus'

describe('markStaleInputsAsSpent concurrency', () => {
  test('checks basket-owned inputs concurrently before serial stale writes', async () => {
    const fundingTxids = ['11'.repeat(32), '22'.repeat(32), '33'.repeat(32)]
    const liveFundingTxid = fundingTxids[1]
    const staleFundingTxids = new Set([fundingTxids[0], fundingTxids[2]])
    const storage = new InMemoryStaleInputStorage()
    const failedTx = new Transaction()

    for (const txid of fundingTxids) {
      failedTx.addInput({
        sourceTXID: txid,
        sourceOutputIndex: 0,
        sequence: 0xffffffff,
        unlockingScript: Script.fromASM('OP_1')
      })
      storage.outputs.set(storage.nextOutputId, makeOutput({
        outputId: storage.nextOutputId,
        txid,
        vout: 0
      }))
      storage.nextOutputId++
    }

    failedTx.addOutput({ lockingScript: Script.fromASM('OP_1'), satoshis: 2500 })
    const failedTxid = failedTx.id('hex')
    const failedTransaction = makeTransaction({
      transactionId: 44,
      txid: failedTxid,
      rawTx: failedTx.toBinary()
    })
    storage.transactions.set(failedTransaction.transactionId, failedTransaction)

    const req = new EntityProvenTxReq(makeReq({
      txid: failedTxid,
      rawTx: failedTx.toBinary(),
      notify: JSON.stringify({ transactionIds: [failedTransaction.transactionId] })
    }))
    const ar = makeAggregateResult(req)
    let active = 0
    let maxActive = 0
    const eventBus = new EventBus()
    const invalidations: string[][] = []
    eventBus.onUtxoInvalidation(event => invalidations.push(event.outpoints))

    const services = {
      eventBus,
      hashOutputScript: () => 'x'.repeat(64),
      getUtxoStatus: async (_output: string, _format: unknown, outpoint?: string, useNext?: boolean) => {
        expect(useNext).toBe(true)
        const txidHex = String(outpoint ?? '').split('.')[0]
        active++
        maxActive = Math.max(maxActive, active)
        try {
          await new Promise(resolve => setTimeout(resolve, 20))
          if (txidHex === liveFundingTxid) {
            return { name: 'mock', status: 'success' as const, isUtxo: true, details: [] }
          }
          if (staleFundingTxids.has(txidHex)) {
            return { name: 'mock', status: 'success' as const, isUtxo: false, details: [] }
          }
          throw new Error(`unexpected UTXO lookup for ${txidHex}`)
        } finally {
          active--
        }
      }
    } as unknown as WalletServices

    const result = await markStaleInputsAsSpent(ar, storage as never, services, undefined)

    expect(maxActive).toBeGreaterThan(1)
    expect(result.checked).toBe(3)
    expect(result.staleConfirmed).toBe(2)
    expect(result.staleOutpoints).toEqual([`${fundingTxids[0]}.0`, `${fundingTxids[2]}.0`])
    expect(storage.outputs.get(1)?.spendable).toBe(false)
    expect(storage.outputs.get(1)?.cacheUpdatedAt).toBeInstanceOf(Date)
    expect(storage.outputs.get(2)?.spendable).toBe(true)
    expect(storage.outputs.get(3)?.spendable).toBe(false)
    expect(storage.outputs.get(3)?.cacheUpdatedAt).toBeInstanceOf(Date)
    expect(storage.updateOrder).toEqual([1, 3])
    expect(invalidations).toEqual([[`${fundingTxids[0]}.0`, `${fundingTxids[2]}.0`]])
  })
})

class InMemoryStaleInputStorage {
  nextOutputId = 1
  readonly transactions = new Map<number, TableTransaction>()
  readonly outputs = new Map<number, TableOutput>()
  readonly updateOrder: number[] = []

  async findTransactions (args: { partial: Partial<TableTransaction> }): Promise<TableTransaction[]> {
    return [...this.transactions.values()].filter(tx => matchesPartial(tx, args.partial))
  }

  async findOutputsByOutpoints (
    userId: number,
    outpoints: Array<{ txid: string, vout: number }>
  ): Promise<Record<string, TableOutput>> {
    const byOutpoint: Record<string, TableOutput> = {}
    for (const outpoint of outpoints) {
      const output = [...this.outputs.values()].find(o =>
        o.userId === userId &&
        o.txid === outpoint.txid &&
        o.vout === outpoint.vout
      )
      if (output != null) byOutpoint[`${outpoint.txid}.${outpoint.vout}`] = output
    }
    return byOutpoint
  }

  async validateOutputScript (_output: TableOutput): Promise<void> {}

  async updateOutput (outputId: number, update: Partial<TableOutput>): Promise<number> {
    const output = this.outputs.get(outputId)
    if (output == null) return 0
    this.outputs.set(outputId, { ...output, ...update, updated_at: new Date() })
    this.updateOrder.push(outputId)
    return 1
  }
}

function makeAggregateResult (failedReq: EntityProvenTxReq): AggregatePostBeefTxResult {
  return {
    txid: failedReq.txid,
    txidResults: [],
    status: 'doubleSpend',
    vreq: { txid: failedReq.txid, req: failedReq, status: 'doubleSpend' } as never,
    successCount: 0,
    doubleSpendCount: 1,
    statusErrorCount: 0,
    serviceErrorCount: 0,
    providerAttempts: [],
    competingTxs: []
  }
}

function makeTransaction (overrides: Partial<TableTransaction>): TableTransaction {
  const now = new Date()
  return {
    created_at: now,
    updated_at: now,
    transactionId: 0,
    userId: 7,
    status: 'failed',
    reference: 'ref',
    isOutgoing: true,
    satoshis: 2500,
    description: 'failed spend',
    ...overrides
  }
}

function makeOutput (overrides: Partial<TableOutput>): TableOutput {
  const now = new Date()
  return {
    created_at: now,
    updated_at: now,
    outputId: 0,
    userId: 7,
    transactionId: 1,
    spendable: true,
    change: false,
    outputDescription: 'source output',
    vout: 0,
    satoshis: 1000,
    providedBy: 'you',
    purpose: 'test',
    type: 'custom',
    lockingScript: [0x51],
    ...overrides
  }
}

function makeReq (overrides: Partial<TableProvenTxReq>): TableProvenTxReq {
  const now = new Date()
  return {
    created_at: now,
    updated_at: now,
    provenTxReqId: 1,
    txid: '00'.repeat(32),
    status: 'sending',
    attempts: 0,
    notified: false,
    history: '{}',
    notify: '{}',
    rawTx: [],
    ...overrides
  }
}

function matchesPartial<T extends object> (value: T, partial: Partial<T>): boolean {
  return Object.entries(partial).every(([key, expected]) => value[key as keyof T] === expected)
}
