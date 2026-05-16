import { StorageProvider } from '../../src/storage/StorageProvider'
import { TableOutput } from '../../src/storage/schema/tables/TableOutput'
import { TableOutputBasket } from '../../src/storage/schema/tables/TableOutputBasket'
import { TableOutputTag } from '../../src/storage/schema/tables/TableOutputTag'

describe('StorageProvider bulk read helpers', () => {
  test('findOutputsByIds resolves output lookups with bounded parallelism', async () => {
    const storage = Object.create(StorageProvider.prototype) as any
    let inFlight = 0
    let maxInFlight = 0
    storage.findOutputs = jest.fn(async ({ partial }: { partial: Partial<TableOutput> }) => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await delay(10)
      inFlight -= 1
      return [{ outputId: partial.outputId }] as TableOutput[]
    })

    const result = await storage.findOutputsByIds([1, 2, 3])

    expect(Object.keys(result).sort()).toEqual(['1', '2', '3'])
    expect(maxInFlight).toBeGreaterThan(1)
  })

  test('findOutputsByOutpoints resolves outpoint lookups with bounded parallelism', async () => {
    const storage = Object.create(StorageProvider.prototype) as any
    let inFlight = 0
    let maxInFlight = 0
    storage.findOutputs = jest.fn(async ({ partial }: { partial: Partial<TableOutput> }) => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await delay(10)
      inFlight -= 1
      return [partial] as TableOutput[]
    })

    const result = await storage.findOutputsByOutpoints(7, [
      { txid: 'a', vout: 0 },
      { txid: 'b', vout: 1 },
      { txid: 'c', vout: 2 }
    ])

    expect(Object.keys(result).sort()).toEqual(['a.0', 'b.1', 'c.2'])
    expect(storage.findOutputs).toHaveBeenCalledWith({ partial: { userId: 7, txid: 'a', vout: 0 } })
    expect(maxInFlight).toBeGreaterThan(1)
  })

  test('findOrInsertOutputBasketsBulk resolves distinct names with bounded parallelism', async () => {
    const storage = Object.create(StorageProvider.prototype) as any
    let inFlight = 0
    let maxInFlight = 0
    storage.findOrInsertOutputBasket = jest.fn(async (userId: number, name: string) => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await delay(10)
      inFlight -= 1
      return { userId, basketId: name.charCodeAt(0), name } as TableOutputBasket
    })

    const result = await storage.findOrInsertOutputBasketsBulk(7, ['a', 'b', 'a'])

    expect(Object.keys(result).sort()).toEqual(['a', 'b'])
    expect(result.a.name).toBe('a')
    expect(storage.findOrInsertOutputBasket).toHaveBeenCalledTimes(2)
    expect(maxInFlight).toBeGreaterThan(1)
  })

  test('findOrInsertOutputTagsBulk resolves distinct tags with bounded parallelism', async () => {
    const storage = Object.create(StorageProvider.prototype) as any
    let inFlight = 0
    let maxInFlight = 0
    storage.findOrInsertOutputTag = jest.fn(async (userId: number, tag: string) => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await delay(10)
      inFlight -= 1
      return { userId, outputTagId: tag.charCodeAt(0), tag } as TableOutputTag
    })

    const result = await storage.findOrInsertOutputTagsBulk(7, ['x', 'y', 'x'])

    expect(Object.keys(result).sort()).toEqual(['x', 'y'])
    expect(result.x.tag).toBe('x')
    expect(storage.findOrInsertOutputTag).toHaveBeenCalledTimes(2)
    expect(maxInFlight).toBeGreaterThan(1)
  })
})

async function delay (ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms))
}
