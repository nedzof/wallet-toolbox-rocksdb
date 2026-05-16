import { readFile } from 'fs/promises'
import path from 'path'

describe('Prometheus alert rules', () => {
  test('cover cache, broadcast, queue, and storage pressure signals', async () => {
    const alerts = await readFile(path.join(process.cwd(), 'docs/prometheus-alerts.yml'), 'utf8')
    const alertBlocks = extractAlertBlocks(alerts)

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

    expect(alertBlocks.map(block => readAlertName(block))).toEqual([
      'WalletToolboxLowUtxoCacheHitRate',
      'WalletToolboxLowBlockHeaderCacheHitRate',
      'WalletToolboxBroadcastProviderLatencyHigh',
      'WalletToolboxBroadcastQueueBacklog',
      'WalletToolboxSendWaitingBacklog',
      'WalletToolboxStorageQueryLatencyHigh'
    ])
    for (const block of alertBlocks) {
      expect(block).toContain('expr:')
      expect(block).toContain('for:')
      expect(block).toContain('labels:')
      expect(block).toContain('severity:')
      expect(block).toContain('annotations:')
      expect(block).toContain('summary:')
      expect(block).toContain('description:')
    }
    expect(alerts).not.toMatch(/\bnats[_-]/i)
    expect(alerts).not.toMatch(/\bjetstream\b/i)
  })
})

function extractAlertBlocks (alerts: string): string[] {
  return alerts
    .split(/\n(?=      - alert: )/)
    .filter(block => block.includes('- alert: '))
}

function readAlertName (block: string): string {
  const match = /- alert: ([^\n]+)/.exec(block)
  if (match == null) throw new Error(`Missing alert name in block:\n${block}`)
  return match[1].trim()
}
