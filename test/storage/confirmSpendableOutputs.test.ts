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

  test('checks spendable outputs with bounded parallelism', async () => {
    const outputs = Array.from({ length: 60 }, (_, index) => ({
      outputId: index + 1,
      userId: 42,
      basketId: 7,
      spendable: true,
      lockingScript: [0x51],
      txid: `txid${index}`,
      vout: 0
    })) as TableOutput[]
    const storage = Object.create(StorageProvider.prototype) as any
    let active = 0
    let maxActive = 0
    let calls = 0

    storage.findUsers = jest.fn(async () => [{ userId: 42 }])
    storage.findOutputBaskets = jest.fn(async () => [{ basketId: 7, userId: 42, name: 'default' }])
    storage.findOutputs = jest.fn(async () => outputs)
    storage.getServices = jest.fn(() => ({
      hashOutputScript: (script: string) => `hash:${script}`,
      getUtxoStatus: async () => {
        active++
        maxActive = Math.max(maxActive, active)
        calls++
        await delay(5)
        active--
        return { isUtxo: true }
      }
    }))

    const result = await storage.confirmSpendableOutputs()

    expect(result.invalidSpendableOutputs).toEqual([])
    expect(calls).toBe(60)
    expect(maxActive).toBeGreaterThan(1)
    expect(maxActive).toBeLessThanOrEqual(50)
  })
})

async function delay (ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms))
}
