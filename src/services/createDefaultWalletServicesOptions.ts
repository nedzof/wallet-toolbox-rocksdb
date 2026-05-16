import { Chain } from '../sdk/types'
import { WalletServicesOptions } from '../sdk/WalletServices.interfaces'
import { randomBytesHex } from '../utility/utilityHelpers'
import { ChaintracksClientApi } from './chaintracker/chaintracks/Api/ChaintracksClientApi'
import { ChaintracksServiceClient } from './chaintracker/chaintracks/ChaintracksServiceClient'
import { createUndiciHttpClient, markWalletToolboxOwnedHttpClient } from '../http/UndiciHttpClient'

export function createDefaultWalletServicesOptions (
  chain: Chain,
  arcCallbackUrl?: string,
  arcCallbackToken?: string,
  taalArcApiKey?: string,
  gorillaPoolArcApiKey?: string,
  bitailsApiKey?: string,
  deploymentId?: string,
  chaintracks?: ChaintracksClientApi
): WalletServicesOptions {
  if (chain === 'mock') {
    throw new Error('createDefaultWalletServicesOptions does not support \'mock\' chain. Use MockServices directly.')
  }

  deploymentId ||= `wallet-toolbox-${randomBytesHex(16)}`

  // const chaintracksUrl = `https://npm-registry.babbage.systems:${chain === 'main' ? 8084 : 8083}`
  const chaintracksUrl = `https://${chain}net-chaintracks.babbage.systems`
  // The mainnet endpoint is always used since these are fiat exchange rates,
  // independent of the chain being used.
  const chaintracksFiatExchangeRatesUrl = 'https://mainnet-chaintracks.babbage.systems/getFiatExchangeRates'

  const httpClient = markWalletToolboxOwnedHttpClient(createUndiciHttpClient({
    connections: 50,
    pipelining: 10,
    keepAliveTimeout: 60000,
    keepAliveMaxTimeout: 300000,
    keepAliveTimeoutThreshold: 1000
  }))
  chaintracks ||= new ChaintracksServiceClient(chain, chaintracksUrl, { httpClient })

  const o: WalletServicesOptions = {
    chain,
    taalApiKey: undefined,
    bsvExchangeRate: {
      timestamp: new Date('2025-08-31'),
      base: 'USD',
      rate: 26.17
    },
    bsvUpdateMsecs: 1000 * 60 * 15, // 15 minutes
    fiatExchangeRates: {
      timestamp: new Date('2025-08-31'),
      base: 'USD',
      rates: {
        USD: 1,
        GBP: 0.7528,
        EUR: 0.8558
      },
      rateTimestamps: {
        USD: new Date('2025-08-31'),
        GBP: new Date('2025-08-31'),
        EUR: new Date('2025-08-31')
      }
    },
    fiatUpdateMsecs: 1000 * 60 * 60 * 24, // 24 hours
    disableMapiCallback: true, // MAPI callback's are deprecated. Rely on WalletMonitor by default.
    exchangeratesapiKey: undefined,
    chaintracksFiatExchangeRatesUrl,
    chaintracks,
    httpClient,
    arcUrl: arcDefaultUrl(chain),
    arcConfig: {
      apiKey: taalArcApiKey ?? undefined,
      httpClient,
      deploymentId,
      callbackUrl: arcCallbackUrl ?? undefined,
      callbackToken: arcCallbackToken ?? undefined
    },
    arcGorillaPoolUrl: arcGorillaPoolUrl(chain),
    arcGorillaPoolConfig: {
      apiKey: gorillaPoolArcApiKey ?? undefined,
      httpClient,
      deploymentId,
      callbackUrl: arcCallbackUrl ?? undefined,
      callbackToken: arcCallbackToken ?? undefined
    },
    bitailsApiKey,
    postBeefMode: 'PromiseAll',
    postBeefSoftTimeoutMs: 5000,
    postBeefSoftTimeoutPerKbMs: 50,
    postBeefSoftTimeoutMaxMs: 30000,
    postBeefQueueConcurrency: 100,
    utxoStatusCacheMaxEntries: 10000,
    utxoStatusCacheTtlMs: 30000,
    blockHeaderCacheMaxEntries: 1000,
    blockHeaderCacheTtlMs: 300000,
    scriptHashCacheMaxEntries: 10000,
    scriptHashCacheTtlMs: 300000
  }
  return o
}

export function arcDefaultUrl (chain: Chain): string {
  switch (chain) {
    case 'main':
      return 'https://arc.taal.com'
    case 'test':
      return 'https://arc-test.taal.com'
    case 'teratest':
      return 'https://arc-teratest.taal.com'
    case 'mock':
      return ''
  }
}

export function arcGorillaPoolUrl (chain: Chain): string | undefined {
  return chain === 'main' ? 'https://arc.gorillapool.io' : undefined
}
