import { Services } from '../../src/services/Services'
import { ServiceCollection } from '../../src/services/ServiceCollection'
import { GetStatusForTxidsResult, GetStatusForTxidsService } from '../../src/sdk/WalletServices.interfaces'
import { wait } from '../../src/utility/utilityHelpers'

describe('Services getStatusForTxids batching', () => {
  test('runs provider batches concurrently and preserves txid order', async () => {
    const services = new Services('test')
    const txids = Array.from({ length: Services.getStatusForTxidsBatchLimit * 2 + 1 }, (_, i) =>
      i.toString(16).padStart(64, '0')
    )
    let active = 0
    let maxActive = 0
    const seenBatches: string[][] = []
    const getStatusForTxids: GetStatusForTxidsService = jest.fn(async (batch): Promise<GetStatusForTxidsResult> => {
      active++
      maxActive = Math.max(maxActive, active)
      seenBatches.push(batch)
      await wait(25)
      active--
      return {
        name: 'fake',
        status: 'success',
        results: batch.map(txid => ({ txid, depth: 0, status: 'known' }))
      }
    })
    services.getStatusForTxidsServices = new ServiceCollection<GetStatusForTxidsService>('getStatusForTxids')
      .add({ name: 'fake', service: getStatusForTxids })

    const result = await services.getStatusForTxids(txids)

    expect(maxActive).toBeGreaterThan(1)
    expect(getStatusForTxids).toHaveBeenCalledTimes(3)
    expect(seenBatches.map(batch => batch.length)).toEqual([20, 20, 1])
    expect(result.status).toBe('success')
    expect(result.results.map(r => r.txid)).toEqual(txids)
  })
})
