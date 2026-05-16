import { WalletToolboxMetrics } from '../../src/metrics/WalletToolboxMetrics'

describe('WalletToolboxMetrics', () => {
  test('exports cache, broadcast, queue, and storage metrics in Prometheus format', async () => {
    const metrics = new WalletToolboxMetrics()

    metrics.recordUtxoCacheRequest('hit', 7)
    metrics.recordUtxoCacheRequest('miss', 7)
    metrics.recordBlockHeaderCacheRequest('hit', 3)
    metrics.recordBlockHeaderCacheRequest('miss', 3)
    metrics.recordPostBeefProvider('arc', 'success', 250)
    metrics.setPostBeefQueue(11, 4)
    metrics.setSendWaitingQueue(22, 5)
    metrics.recordStorageQuery('scan', 12)

    const body = await metrics.metrics()

    expect(body).toContain('wallet_toolbox_utxo_cache_requests_total{result="hit"} 1')
    expect(body).toContain('wallet_toolbox_utxo_cache_requests_total{result="miss"} 1')
    expect(body).toContain('wallet_toolbox_utxo_cache_entries 7')
    expect(body).toContain('wallet_toolbox_utxo_cache_hit_rate 0.5')
    expect(body).toContain('wallet_toolbox_block_header_cache_requests_total{result="hit"} 1')
    expect(body).toContain('wallet_toolbox_block_header_cache_requests_total{result="miss"} 1')
    expect(body).toContain('wallet_toolbox_block_header_cache_entries 3')
    expect(body).toContain('wallet_toolbox_block_header_cache_hit_rate 0.5')
    expect(body).toContain('wallet_toolbox_post_beef_provider_duration_seconds_count{provider="arc",status="success"} 1')
    expect(body).toContain('wallet_toolbox_post_beef_queue_size 11')
    expect(body).toContain('wallet_toolbox_post_beef_queue_pending 4')
    expect(body).toContain('wallet_toolbox_send_waiting_queue_size 22')
    expect(body).toContain('wallet_toolbox_send_waiting_queue_pending 5')
    expect(body).toContain('wallet_toolbox_storage_query_duration_seconds_count{operation="scan"} 1')
  })
})
