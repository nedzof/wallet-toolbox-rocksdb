import { calculateActualTps, classifyBottleneck, classifySetupBottleneck, resolveArcApiKey, resolveArcUrl, resolveWalletRootKeySource } from './TestnetThroughput.load'
import { MetricsSnapshot } from './metricsSnapshot'

describe('TestnetThroughput load config', () => {
  test('uses GorillaPool ARC as the default live endpoint', () => {
    expect(resolveArcUrl({})).toBe('https://arc.gorillapool.io')
  })

  test('uses Nektar ARC endpoint aliases', () => {
    expect(resolveArcUrl({ NEKTAR_LIVE_TESTNET_ARC_ENDPOINTS: 'https://arc.gorillapool.io,https://backup.example' }))
      .toBe('https://arc.gorillapool.io')
    expect(resolveArcUrl({ NEKTAR_ARC_URL: 'https://arc.gorillapool.io' })).toBe('https://arc.gorillapool.io')
    expect(resolveArcUrl({ SPVWALLET_ARC_URL: 'https://arc.gorillapool.io' })).toBe('https://arc.gorillapool.io')
  })

  test('uses Nektar ARC token aliases without duplicating Bearer prefix', () => {
    expect(resolveArcApiKey({ NEKTAR_ARC_TOKEN: 'Bearer abc123' })).toBe('abc123')
    expect(resolveArcApiKey({ SPVWALLET_ARC_TOKEN_TESTNET: 'def456' })).toBe('def456')
  })

  test('supports signer config, WIF, hex, and root-key file wallet sources', () => {
    expect(resolveWalletRootKeySource({ TESTNET_WALLET_TOOLBOX_SIGNER_CONFIG: '/tmp/testnet-signer-config.json' })).toEqual({
      kind: 'signer-config',
      value: '/tmp/testnet-signer-config.json'
    })
    expect(resolveWalletRootKeySource({ NEKTAR_AUTONOMOUS_TESTNET_SIGNER_CONFIG: '/tmp/nektar-signer-config.json' })).toEqual({
      kind: 'signer-config',
      value: '/tmp/nektar-signer-config.json'
    })
    expect(resolveWalletRootKeySource({ TESTNET_WALLET_WIF: 'wif-value' })).toEqual({ kind: 'wif', value: 'wif-value' })
    expect(resolveWalletRootKeySource({ TESTNET_WALLET_ROOT_KEY_HEX: 'hex-value' })).toEqual({ kind: 'hex', value: 'hex-value' })
    expect(resolveWalletRootKeySource({ TESTNET_WALLET_ROOT_KEY_FILE: '/tmp/root-key.json' })).toEqual({ kind: 'file', value: '/tmp/root-key.json' })
    expect(resolveWalletRootKeySource({ NEKTAR_WALLET_TOOLBOX_LOCAL_KEY_CONFIG: '/tmp/root-key.json' })).toEqual({ kind: 'file', value: '/tmp/root-key.json' })
  })

  test('classifies setup-time BEEF and proof gaps as proof finality lag', () => {
    expect(classifySetupBottleneck('The inputBEEF parameter must be valid Beef when factoring options.trustSelf'))
      .toMatchObject({ category: 'proof_finality_lag' })
  })

  test('classifies low TPS with empty queues and low RocksDB latency as writer serialization', () => {
    expect(classifyBottleneck(
      metrics({
        transactionTailQueueDepthMax: 1,
        storageQueryP95Seconds: 0.001
      }),
      0,
      undefined,
      { seen: 0, accepted: 0, rejected: 0, unknown: 0, timeout: 0, rateLimited: 0 },
      false,
      0,
      { actualTps: 2.54, targetTps: 10, p95Ms: 3976 }
    )).toMatchObject({ category: 'storage_manager_writer_serialization' })
  })

  test('calculates TPS from the launch window instead of final drain latency', () => {
    expect(calculateActualTps(100, 10, 1000, 10900)).toBe(10)
    expect(calculateActualTps(100, 10, 1000, 13500)).toBe(8)
  })
})

function metrics (overrides: Partial<MetricsSnapshot>): MetricsSnapshot {
  return {
    utxoCacheHitRate: 0,
    blockHeaderCacheHitRate: 0,
    postBeefQueueSize: 0,
    postBeefQueuePending: 0,
    sendWaitingQueueSize: 0,
    sendWaitingQueuePending: 0,
    transactionTailQueueDepth: 0,
    transactionTailQueueDepthMax: 0,
    p50BroadcastLatencySeconds: 0,
    p95BroadcastLatencySeconds: 0,
    p99BroadcastLatencySeconds: 0,
    p50StorageQuerySeconds: 0,
    storageQueryP95Seconds: 0,
    p99StorageQuerySeconds: 0,
    raw: {},
    ...overrides
  }
}
