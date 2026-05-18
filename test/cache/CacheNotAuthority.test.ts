import { Services } from '../../src/services/Services'

describe('cache is not spendability authority', () => {
  test('Services.isUtxo bypasses UtxoCacheManager and asks providers directly', async () => {
    const services = new Services('test')
    const providerSpy = jest.spyOn(services as any, 'getUtxoStatusFromProviders')
      .mockResolvedValue({ name: 'provider', status: 'success', isUtxo: true, details: [] })
    const cacheSpy = jest.spyOn((services as any).utxoCache, 'getOrLoad')

    try {
      await expect(services.isUtxo({
        outputId: 1,
        txid: 'a'.repeat(64),
        vout: 0,
        lockingScript: [0x51],
        spendable: true
      } as any)).resolves.toBe(true)

      expect(providerSpy).toHaveBeenCalledTimes(1)
      expect(cacheSpy).not.toHaveBeenCalled()
    } finally {
      await services.close()
    }
  })
})
