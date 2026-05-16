import { getListOutputsSpecOp } from '../../src/storage/methods/ListOutputsSpecOp'
import { specOpInvalidChange } from '../../src/sdk/types'
import { TableOutput } from '../../src/storage/schema/tables/TableOutput'

describe('ListOutputsSpecOp invalid change', () => {
  test('release uses fresh UTXO checks before mutating spendable state', async () => {
    const { specOp, tags } = getListOutputsSpecOp(specOpInvalidChange, ['release'])
    const outputs = makeOutputs()
    const services = {
      isUtxo: jest.fn(async (output: TableOutput) => output.outputId !== 2)
    }
    const storage = {
      getServices: () => services,
      validateOutputScript: jest.fn(async () => undefined),
      updateOutput: jest.fn(async () => undefined)
    }

    const result = await specOp!.filterOutputs!(storage as any, {} as any, {} as any, tags, outputs)

    expect(result.map(o => o.outputId)).toEqual([2])
    expect(services.isUtxo).toHaveBeenCalledWith(outputs[0], true)
    expect(services.isUtxo).toHaveBeenCalledWith(outputs[1], true)
    expect(storage.updateOutput).toHaveBeenCalledWith(2, {
      spendable: false,
      cacheUpdatedAt: expect.any(Date)
    })
  })

  test('read-only invalid-change scans may use cached UTXO checks', async () => {
    const { specOp, tags } = getListOutputsSpecOp(specOpInvalidChange, [])
    const outputs = makeOutputs()
    const services = {
      isUtxo: jest.fn(async (output: TableOutput) => output.outputId !== 2)
    }
    const storage = {
      getServices: () => services,
      validateOutputScript: jest.fn(async () => undefined),
      updateOutput: jest.fn(async () => undefined)
    }

    const result = await specOp!.filterOutputs!(storage as any, {} as any, {} as any, tags, outputs)

    expect(result.map(o => o.outputId)).toEqual([2])
    expect(services.isUtxo).toHaveBeenCalledWith(outputs[0], false)
    expect(services.isUtxo).toHaveBeenCalledWith(outputs[1], false)
    expect(storage.updateOutput).not.toHaveBeenCalled()
  })
})

function makeOutputs (): TableOutput[] {
  const now = new Date(0)
  return [1, 2].map(outputId => ({
    created_at: now,
    updated_at: now,
    outputId,
    userId: 7,
    transactionId: 11,
    basketId: 3,
    spendable: true,
    change: true,
    outputDescription: 'change',
    vout: outputId,
    satoshis: 1,
    lockingScript: [0x51],
    providedBy: 'you',
    purpose: 'change',
    type: 'custom'
  }))
}
