import { readFile } from 'fs/promises'
import path from 'path'

describe('Prometheus alert rules', () => {
  test('cover cache, broadcast, queue, and storage pressure signals', async () => {
    const alerts = await readFile(path.join(process.cwd(), 'docs/prometheus-alerts.yml'), 'utf8')

    expect(alerts).toContain('alert: WalletToolboxLowUtxoCacheHitRate')
    expect(alerts).toContain('wallet_toolbox_utxo_cache_requests_total')
    expect(alerts).toContain('result="hit"')
    expect(alerts).not.toContain('wallet_toolbox_utxo_cache_hit_rate <')

    expect(alerts).toContain('alert: WalletToolboxLowBlockHeaderCacheHitRate')
    expect(alerts).toContain('wallet_toolbox_block_header_cache_requests_total')
    expect(alerts).not.toContain('wallet_toolbox_block_header_cache_hit_rate <')

    expect(alerts).toContain('alert: WalletToolboxBroadcastProviderLatencyHigh')
    expect(alerts).toContain('wallet_toolbox_post_beef_provider_duration_seconds_bucket')
    expect(alerts).toContain('by (le, provider)')

    expect(alerts).toContain('alert: WalletToolboxBroadcastQueueBacklog')
    expect(alerts).toContain('wallet_toolbox_post_beef_queue_size')

    expect(alerts).toContain('alert: WalletToolboxSendWaitingBacklog')
    expect(alerts).toContain('wallet_toolbox_send_waiting_queue_size')

    expect(alerts).toContain('alert: WalletToolboxStorageQueryLatencyHigh')
    expect(alerts).toContain('wallet_toolbox_storage_query_duration_seconds_bucket')
    expect(alerts).toContain('by (le, operation)')
  })
})
