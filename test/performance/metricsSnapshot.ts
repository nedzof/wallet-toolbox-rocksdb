import { WalletToolboxMetrics } from '../../src/metrics/WalletToolboxMetrics'

export interface MetricsSnapshot {
  utxoCacheHitRate: number
  blockHeaderCacheHitRate: number
  postBeefQueueSize: number
  postBeefQueuePending: number
  sendWaitingQueueSize: number
  sendWaitingQueuePending: number
  p95BroadcastLatencySeconds: number
  storageQueryP95Seconds: number
  raw: Record<string, number>
}

export async function metricsSnapshot (metrics: WalletToolboxMetrics): Promise<MetricsSnapshot> {
  return parseMetricsSnapshot(await metrics.metrics())
}

export function parseMetricsSnapshot (prometheusText: string): MetricsSnapshot {
  const raw: Record<string, number> = {}
  const postBeefBuckets = new Map<number, number>()
  let postBeefCount = 0
  const storageBuckets = new Map<number, number>()
  let storageCount = 0

  for (const line of prometheusText.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const match = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{([^}]*)\})?\s+(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?|[+-]?Inf)$/i.exec(trimmed)
    if (match == null) continue
    const [, name, labelText, valueText] = match
    const value = parseMetricValue(valueText)
    raw[metricKey(name, labelText)] = value

    if (name === 'wallet_toolbox_post_beef_provider_duration_seconds_bucket') {
      const le = getLe(labelText)
      if (le != null && Number.isFinite(le)) postBeefBuckets.set(le, (postBeefBuckets.get(le) ?? 0) + value)
    } else if (name === 'wallet_toolbox_post_beef_provider_duration_seconds_count') {
      postBeefCount += value
    } else if (name === 'wallet_toolbox_storage_query_duration_seconds_bucket') {
      const le = getLe(labelText)
      if (le != null && Number.isFinite(le)) storageBuckets.set(le, (storageBuckets.get(le) ?? 0) + value)
    } else if (name === 'wallet_toolbox_storage_query_duration_seconds_count') {
      storageCount += value
    }
  }

  return {
    utxoCacheHitRate: getGauge(raw, 'wallet_toolbox_utxo_cache_hit_rate'),
    blockHeaderCacheHitRate: getGauge(raw, 'wallet_toolbox_block_header_cache_hit_rate'),
    postBeefQueueSize: getGauge(raw, 'wallet_toolbox_post_beef_queue_size'),
    postBeefQueuePending: getGauge(raw, 'wallet_toolbox_post_beef_queue_pending'),
    sendWaitingQueueSize: getGauge(raw, 'wallet_toolbox_send_waiting_queue_size'),
    sendWaitingQueuePending: getGauge(raw, 'wallet_toolbox_send_waiting_queue_pending'),
    p95BroadcastLatencySeconds: histogramQuantile(postBeefBuckets, postBeefCount, 0.95),
    storageQueryP95Seconds: histogramQuantile(storageBuckets, storageCount, 0.95),
    raw
  }
}

function metricKey (name: string, labelText?: string): string {
  return labelText == null || labelText === '' ? name : `${name}{${labelText}}`
}

function parseMetricValue (value: string): number {
  if (value === '+Inf' || value === 'Inf') return Number.POSITIVE_INFINITY
  if (value === '-Inf') return Number.NEGATIVE_INFINITY
  return Number(value)
}

function getGauge (raw: Record<string, number>, name: string): number {
  return raw[name] ?? 0
}

function getLe (labelText?: string): number | undefined {
  if (labelText == null) return undefined
  const match = /(?:^|,)le="([^"]+)"/.exec(labelText)
  if (match == null) return undefined
  return parseMetricValue(match[1])
}

function histogramQuantile (buckets: Map<number, number>, count: number, quantile: number): number {
  if (count <= 0 || buckets.size === 0) return 0
  const target = count * quantile
  const sorted = [...buckets.entries()].sort((a, b) => a[0] - b[0])
  for (const [upperBound, cumulative] of sorted) {
    if (cumulative >= target) return upperBound
  }
  return sorted.at(-1)?.[0] ?? 0
}
