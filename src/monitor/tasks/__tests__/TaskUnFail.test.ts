import { Script, Transaction } from '@bsv/sdk'

import { EntityProvenTxReq } from '../../../storage/schema/entities'
import { wait } from '../../../utility/utilityHelpers'
import { TaskUnFail } from '../TaskUnFail'

describe('TaskUnFail', () => {
  test('checks recovered transaction outputs with bounded parallel UTXO status calls', async () => {
    const tx = new Transaction()
    tx.addOutput({ lockingScript: Script.fromHex('51'), satoshis: 1 })
    const req = EntityProvenTxReq.fromTxid(tx.id('hex'), tx.toBinary())
    req.addNotifyTransactionId(1)
    const outputs = [
      { outputId: 1, spendable: false, lockingScript: [0x51] },
      { outputId: 2, spendable: false, lockingScript: [0x51] },
      { outputId: 3, spendable: true, lockingScript: [0x51] }
    ]
    const updates: Array<{ outputId: number, update: { spendable: boolean, cacheUpdatedAt?: Date } }> = []
    const sp = {
      findTransactionById: jest.fn(async () => ({ transactionId: 1, userId: 42, status: 'failed' })),
      updateTransaction: jest.fn(async () => undefined),
      findOutputs: jest.fn(async ({ partial }: any) => partial.transactionId != null ? outputs : []),
      validateOutputScript: jest.fn(async () => undefined),
      updateOutput: jest.fn(async (outputId: number, update: { spendable: boolean, cacheUpdatedAt?: Date }) => {
        updates.push({ outputId, update })
      })
    }
    const storage = {
      runAsStorageProvider: jest.fn((fn: any) => fn(sp))
    }
    let active = 0
    let maxActive = 0
    const services = {
      isUtxo: jest.fn(async (output: any) => {
        active++
        maxActive = Math.max(maxActive, active)
        await wait(25)
        active--
        return output.outputId === 2
      })
    }
    const task = new TaskUnFail({ storage, services } as any)

    const log = await task.unfailReq(req, 0)

    expect(maxActive).toBeGreaterThan(1)
    expect(services.isUtxo).toHaveBeenCalledTimes(3)
    expect(services.isUtxo).toHaveBeenCalledWith(outputs[0], true)
    expect(services.isUtxo).toHaveBeenCalledWith(outputs[1], true)
    expect(services.isUtxo).toHaveBeenCalledWith(outputs[2], true)
    expect(updates).toEqual([
      { outputId: 2, update: { spendable: true, cacheUpdatedAt: expect.any(Date) } },
      { outputId: 3, update: { spendable: false, cacheUpdatedAt: expect.any(Date) } }
    ])
    expect(log).toContain('output 1 unchanged')
    expect(log).toContain('output 2 set to spendable')
    expect(log).toContain('output 3 set to spent')
  })
})
