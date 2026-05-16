import { Script, Transaction, Utils } from '@bsv/sdk'

import { BuildBeefHttpClient, buildBeefForOutpoints } from '../src/fundWalletP2PKH'

describe('buildBeefForOutpoints', () => {
  test('uses the injected HTTP client instead of global fetch', async () => {
    const fundingTx = new Transaction()
    fundingTx.addOutput({ lockingScript: Script.fromHex('51'), satoshis: 1 })
    const txid = fundingTx.id('hex')
    const calls: string[] = []
    const fetchSpy = jest.spyOn(globalThis, 'fetch')

    const httpClient: BuildBeefHttpClient = {
      request: jest.fn(async (url: string) => {
        calls.push(url)
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          data: Utils.toHex(fundingTx.toBinary())
        }
      }),
      download: jest.fn(async (url: string) => {
        calls.push(url)
        throw new Error('proof not available')
      })
    }

    const beef = await buildBeefForOutpoints([`${txid}.0`], { httpClient })

    expect(beef.length).toBeGreaterThan(0)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(httpClient.request).toHaveBeenCalledTimes(1)
    expect(httpClient.download).toHaveBeenCalledTimes(1)
    expect(calls).toEqual([
      `https://ordinals.gorillapool.io/api/tx/${txid}/hex`,
      `https://ordinals.gorillapool.io/api/tx/${txid}/proof`
    ])

    fetchSpy.mockRestore()
  })
})
