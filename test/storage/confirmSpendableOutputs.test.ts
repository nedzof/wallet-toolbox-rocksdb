import { StorageProvider } from '../../src/storage/StorageProvider'
import { TableOutput } from '../../src/storage/schema/tables/TableOutput'

describe('StorageProvider.confirmSpendableOutputs', () => {
  test('uses fresh provider UTXO status checks instead of cached hints', async () => {
    const output = {
      outputId: 1,
      userId: 42,
      basketId: 7,
      spendable: true,
      lockingScript: [0x51],
      txid: 'abc',
      vout: 0
    } as TableOutput
    const statusCalls: Array<{ hash: string, outpoint: string, useNext?: boolean }> = []
    const storage = Object.create(StorageProvider.prototype) as any

    storage.findUsers = jest.fn(async () => [{ userId: 42 }])
    storage.findOutputBaskets = jest.fn(async () => [{ basketId: 7, userId: 42, name: 'default' }])
    storage.findOutputs = jest.fn(async () => [output])
    storage.getServices = jest.fn(() => ({
      hashOutputScript: (script: string) => `hash:${script}`,
      getUtxoStatus: async (hash: string, _fmt: undefined, outpoint: string, useNext?: boolean) => {
        statusCalls.push({ hash, outpoint, useNext })
        return { isUtxo: false }
      }
    }))

    const result = await storage.confirmSpendableOutputs()

    expect(result.invalidSpendableOutputs).toEqual([output])
    expect(statusCalls).toEqual([{ hash: 'hash:51', outpoint: 'abc.0', useNext: true }])
  })
})
