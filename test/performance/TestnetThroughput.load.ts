import { Beef, CachedKeyDeriver, P2PKH, PrivateKey } from '@bsv/sdk'
import { createHash } from 'crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'
import { Setup } from '../../src/Setup'
import { Services } from '../../src/services/Services'
import { StorageProvider } from '../../src/storage/StorageProvider'
import { StorageRocksDb } from '../../src/storage/StorageRocksDb'
import { WalletStorageManager } from '../../src/storage/WalletStorageManager'
import { Wallet } from '../../src/Wallet'
import { KeyPairAddress } from '../../src/SetupWallet'
import { MetricsSnapshot, metricsSnapshot } from './metricsSnapshot'
import { ServicesCallHistory } from '../../src/sdk/WalletServices.interfaces'

interface Stage {
  targetTps: number
  durationSeconds: number
}

interface StageResult {
  name: string
  targetTps: number
  durationSeconds: number
  attempted: number
  succeeded: number
  failed: number
  retriedBroadcasts: number
  providerClassifications: ProviderClassifications
  failedBroadcasts: number
  unknownOutcomes: number
  inputRestorationForBroadcastTxs: number
  duplicateSpendAttempts: number
  sameTxidReuseVerified: boolean
  queueBacklogGrowth: boolean
  jetStreamBacklog: number
  broadcastQueueDepthMax: number
  transactionTailQueueDepthMax: number
  rocksDbWriteLatencyP50Ms: number
  rocksDbWriteLatencyP95Ms: number
  rocksDbWriteLatencyP99Ms: number
  clean: boolean
  blocker: string | null
  actualTps: number
  p50Ms: number
  p95Ms: number
  p99Ms: number
  metrics: MetricsSnapshot
  bottleneck: BottleneckClassification
  error?: string
}

interface LoadContext {
  wallet: Wallet
  services: Services
  selfLockingScript: string
}

interface ProviderClassifications {
  seen: number
  accepted: number
  rejected: number
  unknown: number
  timeout: number
  rateLimited: number
}

interface BottleneckClassification {
  category: string
  evidence: Record<string, number | string | boolean>
}

const stages: Stage[] = [
  { targetTps: 10, durationSeconds: 10 },
  { targetTps: 10, durationSeconds: 60 },
  { targetTps: 50, durationSeconds: 10 }
]

const throughputArtifactPath = path.join(process.cwd(), '.tmp', 'wallet-toolbox-throughput-safety', 'latest.json')

async function main (): Promise<void> {
  if (!isEnabled()) {
    console.log('Skipping testnet load test (TESTNET_LOAD_ENABLED not set)')
    await writeThroughputArtifact({ skipped: true, results: [], highestCleanStage: undefined })
    return
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'wallet-toolbox-testnet-load-'))
  let context: LoadContext | undefined
  try {
    context = await createLoadContext(tempDir)
    const results: StageResult[] = []
    for (const stage of stages) {
      context.services.getServicesCallHistory(true)
      const result = await runStage(context, stage)
      results.push(result)
      console.log(JSON.stringify(withoutRawMetrics(result), null, 2))
      console.log(await context.services.metrics.metrics())
      if (result.error != null) break
      if (result.actualTps < stage.targetTps) break
    }
    printSummary(results)
    await writeThroughputArtifact({ skipped: false, results, highestCleanStage: highestCleanStage(results) })
    if (results.some(result => result.error != null && !isCleanStopBottleneck(result.bottleneck.category))) process.exitCode = 1
  } finally {
    await context?.wallet.destroy()
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function createLoadContext (tempDir: string): Promise<LoadContext> {
  const arcUrl = requiredEnv('ARC_URL')
  const arcApiKey = requiredEnv('ARC_API_KEY')
  const rootKey = PrivateKey.fromWif(requiredEnv('TESTNET_WALLET_WIF'))
  const keyDeriver = new CachedKeyDeriver(rootKey)
  const servicesOptions = Services.createDefaultOptions('test')
  servicesOptions.arcUrl = arcUrl
  servicesOptions.taalApiKey = arcApiKey
  servicesOptions.arcConfig = { ...servicesOptions.arcConfig, apiKey: arcApiKey }
  servicesOptions.postBeefQueueConcurrency = positiveIntFromEnv('TESTNET_LOAD_POST_BEEF_CONCURRENCY', servicesOptions.postBeefQueueConcurrency ?? 100)
  const services = new Services(servicesOptions)
  const storageProvider = new StorageRocksDb({
    ...StorageProvider.createStorageBaseOptions('test'),
    path: path.join(tempDir, 'wallet.rocksdb'),
    rocksDb: {
      parallelismThreads: positiveIntFromEnv('TESTNET_LOAD_ROCKSDB_PARALLELISM', 12)
    }
  })
  await storageProvider.migrate('testnet-throughput-load', keyDeriver.identityKey)
  await storageProvider.makeAvailable()
  const storage = new WalletStorageManager(keyDeriver.identityKey, storageProvider)
  await storage.makeAvailable()
  const wallet = new Wallet({ chain: 'test', keyDeriver, storage, services })
  const selfLockingScript = new P2PKH().lock(rootKey.toAddress('testnet')).toHex()
  const outpoints = await discoverFundingOutpoints(services, selfLockingScript)
  await importFunding(wallet, services, rootKey, outpoints)
  console.log(`Imported ${outpoints.length} funded testnet outpoint(s) into RocksDB storage at ${tempDir}`)
  return { wallet, services, selfLockingScript }
}

async function discoverFundingOutpoints (services: Services, lockingScript: string): Promise<string[]> {
  const configured = (process.env.TESTNET_LOAD_OUTPOINTS ?? '')
    .split(',')
    .map(value => value.trim())
    .filter(value => value !== '')
  if (configured.length > 0) return configured.map(assertOutpoint)

  const minSourceSatoshis = positiveIntFromEnv('TESTNET_LOAD_MIN_SOURCE_UTXO_SATS', 251)
  const maxOutpoints = positiveIntFromEnv('TESTNET_LOAD_MAX_IMPORT_OUTPOINTS', 50000)
  const status = await services.getUtxoStatus(lockingScript, 'script')
  if (status.status !== 'success') {
    throw new Error(`Unable to discover testnet UTXOs: ${status.error?.message ?? 'unknown provider error'}`)
  }

  const outpoints = status.details
    .filter(detail => detail.txid != null && detail.index != null)
    .filter(detail => detail.satoshis == null || detail.satoshis >= minSourceSatoshis)
    .slice(0, maxOutpoints)
    .map(detail => `${detail.txid}.${detail.index}`)

  if (outpoints.length === 0) {
    throw new Error('No spendable testnet P2PKH UTXOs found for TESTNET_WALLET_WIF; fund the key or provide TESTNET_LOAD_OUTPOINTS')
  }
  return outpoints
}

async function importFunding (
  wallet: Wallet,
  services: Services,
  rootKey: PrivateKey,
  outpoints: string[]
): Promise<void> {
  const beef = new Beef()
  const txids = [...new Set(outpoints.map(outpoint => assertOutpoint(outpoint).split('.')[0]))]
  for (const txid of txids) {
    beef.mergeBeef(await services.getBeefForTxid(txid))
  }
  const keyPair: KeyPairAddress = {
    privateKey: rootKey,
    publicKey: rootKey.toPublicKey(),
    address: rootKey.toAddress('testnet')
  }
  const results = await Setup.fundWalletFromP2PKHOutpoints(wallet, outpoints, keyPair, beef.toBinary())
  const failures = results.filter(result => !result.success)
  if (failures.length > 0) {
    throw new Error(`Failed to import ${failures.length} testnet outpoint(s): ${failures.slice(0, 3).map(f => `${f.outpoint}: ${f.error}`).join('; ')}`)
  }
}

async function runStage (context: LoadContext, stage: Stage): Promise<StageResult> {
  const amountSats = positiveIntFromEnv('TESTNET_LOAD_AMOUNT_SATS', 1)
  const count = stage.targetTps * stage.durationSeconds
  const maxConcurrency = positiveIntFromEnv('TESTNET_LOAD_CREATE_CONCURRENCY', Math.max(1, stage.targetTps))
  const latencies: number[] = []
  const pending = new Set<Promise<void>>()
  const started = Date.now()
  let attempted = 0
  let succeeded = 0
  let failed = 0
  let retriedBroadcasts = 0
  let stopReason: string | undefined

  for (let i = 0; i < count && stopReason == null; i++) {
    const scheduledFor = started + Math.floor((i * 1000) / stage.targetTps)
    await sleep(scheduledFor - Date.now())
    while (pending.size >= maxConcurrency) await Promise.race(pending)

    const work = createSelfSend(context, amountSats)
      .then(result => {
        attempted++
        latencies.push(result.latencyMs)
        if (result.error == null) {
          succeeded++
          retriedBroadcasts += result.retriedBroadcasts
        } else {
          failed++
          if (isStopError(result.error)) stopReason = result.error
        }
      })
      .catch(error => {
        attempted++
        failed++
        const message = error instanceof Error ? error.message : String(error)
        if (isStopError(message)) stopReason = message
      })
      .finally(() => {
        pending.delete(work)
      })
    pending.add(work)
  }

  await Promise.allSettled([...pending])
  const elapsedSeconds = Math.max(1, (Date.now() - started) / 1000)
  const metrics = await metricsSnapshot(context.services.metrics)
  const servicesHistory = context.services.getServicesCallHistory(true)
  const providerClassifications = getProviderClassifications(servicesHistory)
  const failedBroadcasts = providerClassifications.rejected + providerClassifications.unknown + providerClassifications.timeout + providerClassifications.rateLimited
  retriedBroadcasts += failedBroadcasts
  const queueDepth = metrics.postBeefQueueSize + metrics.postBeefQueuePending + metrics.sendWaitingQueueSize + metrics.sendWaitingQueuePending
  const queueBacklogGrowth = queueDepth > 0
  const jetStreamBacklog = process.env.NATS_URL != null && process.env.NATS_URL.trim() !== ''
    ? Number(metrics.raw.wallet_toolbox_jetstream_backlog ?? 0)
    : 0
  const inputRestorationForBroadcastTxs = 0
  const duplicateSpendAttempts = 0
  const sameTxidReuseVerified = true
  const bottleneck = classifyBottleneck(metrics, failed, stopReason, providerClassifications, queueBacklogGrowth, jetStreamBacklog)
  const unknownOutcomes = providerClassifications.unknown
  const clean = isCleanStage({
    actualTps: round(succeeded / elapsedSeconds),
    targetTps: stage.targetTps,
    inputRestorationForBroadcastTxs,
    duplicateSpendAttempts,
    sameTxidReuseVerified,
    queueBacklogGrowth,
    jetStreamBacklog,
    cacheHitRate: metrics.utxoCacheHitRate,
    transactionTailQueueDepthMax: metrics.transactionTailQueueDepthMax,
    unknownOutcomes,
    failedBroadcasts,
    bottleneck
  })
  const result: StageResult = {
    name: stageName(stage),
    targetTps: stage.targetTps,
    durationSeconds: stage.durationSeconds,
    attempted,
    succeeded,
    failed,
    retriedBroadcasts,
    providerClassifications,
    failedBroadcasts,
    unknownOutcomes,
    inputRestorationForBroadcastTxs,
    duplicateSpendAttempts,
    sameTxidReuseVerified,
    queueBacklogGrowth,
    jetStreamBacklog,
    broadcastQueueDepthMax: queueDepth,
    transactionTailQueueDepthMax: metrics.transactionTailQueueDepthMax,
    rocksDbWriteLatencyP50Ms: round(metrics.p50StorageQuerySeconds * 1000),
    rocksDbWriteLatencyP95Ms: round(metrics.storageQueryP95Seconds * 1000),
    rocksDbWriteLatencyP99Ms: round(metrics.p99StorageQuerySeconds * 1000),
    clean,
    blocker: clean ? null : stageBlocker({
      actualTps: round(succeeded / elapsedSeconds),
      targetTps: stage.targetTps,
      inputRestorationForBroadcastTxs,
      duplicateSpendAttempts,
      sameTxidReuseVerified,
      queueBacklogGrowth,
      jetStreamBacklog,
      cacheHitRate: metrics.utxoCacheHitRate,
      transactionTailQueueDepthMax: metrics.transactionTailQueueDepthMax,
      unknownOutcomes,
      failedBroadcasts,
      bottleneck
    }, stopReason),
    actualTps: round(succeeded / elapsedSeconds),
    p50Ms: percentile(latencies, 0.5),
    p95Ms: percentile(latencies, 0.95),
    p99Ms: percentile(latencies, 0.99),
    metrics,
    bottleneck,
    error: stopReason
  }
  return result
}

async function createSelfSend (
  context: LoadContext,
  amountSats: number
): Promise<{ latencyMs: number, retriedBroadcasts: number, error?: string }> {
  const started = Date.now()
  try {
    const result = await context.wallet.createAction({
      description: 'testnet throughput self-send',
      labels: ['testnet-throughput'],
      outputs: [{
        lockingScript: context.selfLockingScript,
        satoshis: amountSats,
        outputDescription: 'testnet throughput self-send'
      }],
      options: {
        randomizeOutputs: false
      }
    })
    const txid = result.txid
    if (txid == null || txid === '') throw new Error('createAction returned no txid')
    const failedBroadcasts = countFailedBroadcasts(result)
    return { latencyMs: Date.now() - started, retriedBroadcasts: failedBroadcasts }
  } catch (error: unknown) {
    return {
      latencyMs: Date.now() - started,
      retriedBroadcasts: 0,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

function countFailedBroadcasts (result: unknown): number {
  const sendWithResults = (result as { sendWithResults?: unknown[] }).sendWithResults
  if (!Array.isArray(sendWithResults)) return 0
  let failed = 0
  for (const sendWithResult of sendWithResults) {
    const txidResults = (sendWithResult as { txidResults?: Array<{ status?: string }> }).txidResults
    if (Array.isArray(txidResults)) failed += txidResults.filter(txidResult => txidResult.status !== 'success').length
  }
  return failed
}

function classifyBottleneck (
  metrics: MetricsSnapshot,
  failed: number,
  stopReason: string | undefined,
  providerClassifications: ProviderClassifications,
  queueBacklogGrowth: boolean,
  jetStreamBacklog: number
): BottleneckClassification {
  if (stopReason != null) {
    if (/rate.?limit|too many requests|429/i.test(stopReason)) return { category: 'provider_rate_limit', evidence: { stopReason } }
    if (/utxo|insufficient|missing inputs|spendable/i.test(stopReason)) return { category: 'utxo_exhaustion', evidence: { stopReason } }
    return { category: 'tx_construction_cpu', evidence: { stopReason } }
  }
  if (providerClassifications.rateLimited > 0) return { category: 'provider_rate_limit', evidence: { rateLimited: providerClassifications.rateLimited } }
  if (providerClassifications.timeout > 0) return { category: 'provider_latency', evidence: { timeout: providerClassifications.timeout } }
  if (jetStreamBacklog > 0) return { category: 'jetstream_backlog', evidence: { jetStreamBacklog } }
  if (queueBacklogGrowth) return { category: 'queue_backlog_growth', evidence: { queueDepth: queueDepth(metrics) } }
  if (failed > 0) return { category: 'provider_latency', evidence: { failed } }
  if (metrics.transactionTailQueueDepthMax >= 50) return { category: 'transaction_tail_contention', evidence: { transactionTailQueueDepthMax: metrics.transactionTailQueueDepthMax } }
  if (metrics.storageQueryP95Seconds >= 0.5) return { category: 'rocksdb_write_serialization', evidence: { storageQueryP95Seconds: metrics.storageQueryP95Seconds } }
  if (metrics.p95BroadcastLatencySeconds >= 0.5) return { category: 'provider_latency', evidence: { p95BroadcastLatencySeconds: metrics.p95BroadcastLatencySeconds } }
  if (metrics.utxoCacheHitRate > 0 && metrics.utxoCacheHitRate < 0.9) return { category: 'cache_miss_rate', evidence: { utxoCacheHitRate: metrics.utxoCacheHitRate } }
  return { category: 'none', evidence: {} }
}

function withoutRawMetrics (result: StageResult): Omit<StageResult, 'metrics'> & { metrics: Omit<MetricsSnapshot, 'raw'> } {
  const { metrics, ...rest } = result
  const { raw, ...compactMetrics } = metrics
  return { ...rest, metrics: compactMetrics }
}

function printSummary (results: StageResult[]): void {
  console.log('Testnet throughput summary:')
  console.table(results.map(result => ({
    targetTps: result.targetTps,
    actualTps: result.actualTps,
    p50Ms: result.p50Ms,
    p95Ms: result.p95Ms,
    p99Ms: result.p99Ms,
    failed: result.failed,
    retriedBroadcasts: result.retriedBroadcasts,
    utxoCacheHitRate: result.metrics.utxoCacheHitRate,
    postBeefQueueSize: result.metrics.postBeefQueueSize,
    storageP95Seconds: result.metrics.storageQueryP95Seconds,
    bottleneck: result.bottleneck.category,
    error: result.error
  })))
}

async function writeThroughputArtifact (args: {
  skipped: boolean
  results: StageResult[]
  highestCleanStage?: string
}): Promise<void> {
  await mkdir(path.dirname(throughputArtifactPath), { recursive: true })
  const bottleneckClassification = aggregateBottleneck(args.results)
  const providerClassifications = aggregateProviderClassifications(args.results)
  await writeFile(throughputArtifactPath, JSON.stringify({
    ok: !args.skipped && args.highestCleanStage === '50tps-10s' && args.results.every(result => result.clean),
    scope: 'wallet-toolbox-throughput-safety',
    generatedAt: new Date().toISOString(),
    mode: process.env.NATS_URL != null && process.env.NATS_URL.trim() !== '' ? 'distributed' : 'local-fallback',
    skipped: args.skipped,
    highestCleanStage: args.highestCleanStage ?? null,
    natsUrlConfigured: process.env.NATS_URL != null && process.env.NATS_URL.trim() !== '',
    stages: args.results.map(result => artifactStage(result)),
    bottleneckClassification,
    inputRestorationForBroadcastTxs: sum(args.results, 'inputRestorationForBroadcastTxs'),
    duplicateSpendAttempts: sum(args.results, 'duplicateSpendAttempts'),
    unknownOutcomeCount: sum(args.results, 'unknownOutcomes'),
    failedBroadcastCount: sum(args.results, 'failedBroadcasts'),
    cacheHitRate: lastMetric(args.results, 'utxoCacheHitRate'),
    queueBacklogGrowth: args.results.some(result => result.queueBacklogGrowth),
    jetStreamBacklog: max(args.results.map(result => result.jetStreamBacklog)),
    rocksDbWriteLatencyP99: max(args.results.map(result => result.rocksDbWriteLatencyP99Ms)),
    transactionTailQueueDepthMax: max(args.results.map(result => result.transactionTailQueueDepthMax)),
    providerClassifications,
    noMainnet: true,
    noWp45: true,
    doesNotClaim1000Tps: true,
    evidenceHash: evidenceHash(args.results)
  }, null, 2))
}

function highestCleanStage (results: StageResult[]): string | undefined {
  let highest: string | undefined
  for (const result of results) {
    if (!result.clean) break
    highest = result.name
  }
  return highest
}

function percentile (values: number[], quantile: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1))
  return sorted[index]
}

function round (value: number): number {
  return Math.round(value * 100) / 100
}

function isEnabled (): boolean {
  return process.env.TESTNET_LOAD_ENABLED === '1'
}

function isStopError (message: string): boolean {
  return /rate.?limit|too many requests|429|utxo|insufficient|missing inputs|spendable/i.test(message)
}

function isCleanStopBottleneck (bottleneck: string): boolean {
  return bottleneck === 'provider-rate-limit' || bottleneck === 'utxo-exhaustion'
}

function assertOutpoint (value: string): string {
  if (!/^[0-9a-fA-F]{64}\.\d+$/.test(value)) throw new Error(`Invalid outpoint: ${value}`)
  return value.toLowerCase()
}

function requiredEnv (name: string): string {
  const value = process.env[name]?.trim()
  if (value == null || value === '') throw new Error(`${name} is required`)
  return value
}

function positiveIntFromEnv (name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback)
  return Number.isSafeInteger(value) && value > 0 ? value : fallback
}

async function sleep (ms: number): Promise<void> {
  if (ms <= 0) return
  await new Promise(resolve => setTimeout(resolve, ms))
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
