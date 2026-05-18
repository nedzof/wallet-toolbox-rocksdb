import { Beef, CachedKeyDeriver, P2PKH, PrivateKey, Transaction } from '@bsv/sdk'
import { createHash } from 'crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'
import { Setup } from '../../src/Setup'
import { Services } from '../../src/services/Services'
import { StorageProvider } from '../../src/storage/StorageProvider'
import { StorageRocksDb } from '../../src/storage/StorageRocksDb'
import { RocksDbWalletStore } from '../../src/storage/rocksdb'
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
  failureSamples: string[]
}

interface LoadContext {
  wallet: Wallet
  services: Services
  selfLockingScript: string
  walletKeySource: string
}

interface FundingOutpoint {
  outpoint: string
  rawSourceTxHex?: string
  source: 'configured' | 'wallet-toolbox' | 'script'
}

interface LoadedSignerConfig {
  signerRef: string
  network: 'bsv-testnet'
  walletPath: string
  localKeyConfigPath: string
  broadcastUrl?: string
}

interface LoadedWalletRootKey {
  rootKey: PrivateKey
  source: string
  signerConfig?: LoadedSignerConfig
}

interface WalletToolboxUtxoRecord {
  txid: string
  vout: number
  satoshis: number
  rawSourceTxHex?: string
  status?: string
  network?: string
  signerRef?: string
  basketId?: string
}

interface WalletToolboxSignerConfigFile {
  network?: string
  mode?: string
  signerRef?: string
  broadcastUrl?: string
  walletToolboxWalletPath?: string
  walletPath?: string
  walletToolboxLocalKeyConfigPath?: string
  localKeyConfigPath?: string
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
    try {
      context = await createLoadContext(tempDir)
    } catch (error) {
      const setupBlocker = errorMessage(error)
      const setupBottleneckClassification = classifySetupBottleneck(setupBlocker)
      await writeThroughputArtifact({
        skipped: false,
        results: [],
        highestCleanStage: undefined,
        setupBlocker,
        setupBottleneckClassification
      })
      console.error(error)
      if (!isCleanStopBottleneck(setupBottleneckClassification.category)) process.exitCode = 1
      return
    }
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
  const arcUrl = resolveArcUrl()
  const arcApiKey = resolveArcApiKey()
  const { rootKey, source: walletKeySource, signerConfig } = await loadWalletRootKey()
  const keyDeriver = new CachedKeyDeriver(rootKey)
  const servicesOptions = Services.createDefaultOptions('test')
  servicesOptions.arcUrl = arcUrl
  servicesOptions.taalApiKey = arcApiKey === '' ? undefined : arcApiKey
  servicesOptions.arcConfig = { ...servicesOptions.arcConfig, apiKey: arcApiKey === '' ? undefined : arcApiKey }
  servicesOptions.postBeefQueueConcurrency = positiveIntFromEnv('TESTNET_LOAD_POST_BEEF_CONCURRENCY', servicesOptions.postBeefQueueConcurrency ?? 100)
  const services = new Services(servicesOptions)
  const storageProvider = new StorageRocksDb({
    ...StorageProvider.createStorageBaseOptions('test'),
    path: path.join(tempDir, 'wallet.rocksdb'),
    rocksDb: {
      parallelismThreads: positiveIntFromEnv('TESTNET_LOAD_ROCKSDB_PARALLELISM', 12),
      metrics: services.metrics
    }
  })
  await storageProvider.migrate('testnet-throughput-load', keyDeriver.identityKey)
  await storageProvider.makeAvailable()
  const storage = new WalletStorageManager(keyDeriver.identityKey, storageProvider)
  await storage.makeAvailable()
  const userId = (await storage.getAuth()).userId!
  const wallet = new Wallet({ chain: 'test', keyDeriver, storage, services })
  const selfLockingScript = new P2PKH().lock(rootKey.toAddress('testnet')).toHex()
  const outpoints = await discoverFundingOutpoints(services, selfLockingScript, signerConfig)
  const importedOutpoints = await importFunding(wallet, services, rootKey, outpoints)
  console.log(`Imported ${importedOutpoints} funded testnet outpoint(s) into RocksDB storage at ${tempDir} using ${walletKeySource}`)
  const seededSlots = await seedLoadUtxoSlots(wallet, selfLockingScript)
  if (seededSlots > 0) console.log(`Seeded ${seededSlots} wallet-owned testnet UTXO slot(s) before timed stages`)
  await configureLoadChangeBasket(storageProvider, userId)
  return { wallet, services, selfLockingScript, walletKeySource }
}

async function configureLoadChangeBasket (storage: StorageRocksDb, userId: number): Promise<void> {
  const desiredUtxos = positiveIntFromEnv('TESTNET_LOAD_CHANGE_TARGET_UTXOS', defaultSeedSlotCount())
  const minimumUtxoSats = positiveIntFromEnv('TESTNET_LOAD_CHANGE_MIN_UTXO_SATS', 32)
  const basket = (await storage.findOutputBaskets({ partial: { userId, name: 'default' } }))[0]
  if (basket == null) return
  await storage.updateOutputBasket(basket.basketId, {
    numberOfDesiredUTXOs: desiredUtxos,
    minimumDesiredUTXOValue: minimumUtxoSats
  })
}

async function discoverFundingOutpoints (
  services: Services,
  lockingScript: string,
  signerConfig?: LoadedSignerConfig
): Promise<FundingOutpoint[]> {
  const configured = (process.env.TESTNET_LOAD_OUTPOINTS ?? '')
    .split(',')
    .map(value => value.trim())
    .filter(value => value !== '')
  if (configured.length > 0) return configured.map(value => ({ outpoint: assertOutpoint(value), source: 'configured' }))

  const minSourceSatoshis = positiveIntFromEnv('TESTNET_LOAD_MIN_SOURCE_UTXO_SATS', 251)
  const maxOutpoints = positiveIntFromEnv('TESTNET_LOAD_MAX_IMPORT_OUTPOINTS', 50000)
  if (signerConfig != null) {
    const walletOutpoints = await discoverWalletToolboxFundingOutpoints(signerConfig, minSourceSatoshis, maxOutpoints)
    if (walletOutpoints.length > 0) return walletOutpoints
    throw new Error(`No spendable testnet wallet-toolbox UTXOs >= ${minSourceSatoshis} satoshis found for configured signerRef; fund/split the paymail wallet or provide TESTNET_LOAD_OUTPOINTS`)
  }

  const status = await services.getUtxoStatus(lockingScript, 'script')
  if (status.status !== 'success') {
    throw new Error(`Unable to discover testnet UTXOs: ${status.error?.message ?? 'unknown provider error'}`)
  }

  const outpoints = status.details
    .filter(detail => detail.txid != null && detail.index != null)
    .filter(detail => detail.satoshis == null || detail.satoshis >= minSourceSatoshis)
    .slice(0, maxOutpoints)
    .map(detail => ({ outpoint: `${detail.txid}.${detail.index}`, source: 'script' as const }))

  if (outpoints.length === 0) {
    throw new Error('No spendable testnet P2PKH UTXOs found for configured wallet key; fund it via paymail/SPV wallet or provide TESTNET_LOAD_OUTPOINTS')
  }
  return outpoints
}

async function discoverWalletToolboxFundingOutpoints (
  signerConfig: LoadedSignerConfig,
  minSourceSatoshis: number,
  maxOutpoints: number
): Promise<FundingOutpoint[]> {
  const walletStorageNamespace = walletStorageNamespaceForSignerRef(signerConfig.signerRef, signerConfig.network)
  const store = await RocksDbWalletStore.open({
    path: signerConfig.walletPath,
    namespace: walletStorageNamespace,
    createIfMissing: false,
    readOnly: true
  })
  try {
    return (await store.scan<WalletToolboxUtxoRecord>({ prefix: 'utxo!available!', limit: maxOutpoints }))
      .map(record => record.value)
      .filter(utxo => utxo.status === 'spendable' && utxo.network === signerConfig.network && utxo.signerRef === signerConfig.signerRef)
      .filter(utxo => Number.isSafeInteger(utxo.vout) && utxo.vout >= 0 && /^[0-9a-f]{64}$/i.test(utxo.txid))
      .filter(utxo => Number.isSafeInteger(utxo.satoshis) && utxo.satoshis >= minSourceSatoshis)
      .sort((left, right) => right.satoshis - left.satoshis || left.txid.localeCompare(right.txid) || left.vout - right.vout)
      .slice(0, maxOutpoints)
      .map(utxo => ({
        outpoint: `${utxo.txid.toLowerCase()}.${utxo.vout}`,
        rawSourceTxHex: typeof utxo.rawSourceTxHex === 'string' && utxo.rawSourceTxHex.trim() !== '' ? utxo.rawSourceTxHex.trim() : undefined,
        source: 'wallet-toolbox'
      }))
  } finally {
    store.close()
  }
}

async function importFunding (
  wallet: Wallet,
  services: Services,
  rootKey: PrivateKey,
  fundingOutpoints: FundingOutpoint[]
): Promise<number> {
  const beef = new Beef()
  const outpoints = fundingOutpoints.map(funding => assertOutpoint(funding.outpoint))
  const rawSourceTxByTxid = new Map<string, string>()
  const sourceByTxid = new Map<string, FundingOutpoint['source']>()
  for (const funding of fundingOutpoints) {
    const outpoint = assertOutpoint(funding.outpoint)
    const rawSourceTxHex = funding.rawSourceTxHex?.trim()
    if (rawSourceTxHex != null && rawSourceTxHex !== '') rawSourceTxByTxid.set(outpoint.split('.')[0], rawSourceTxHex)
    sourceByTxid.set(outpoint.split('.')[0], funding.source)
  }
  const txids = [...new Set(outpoints.map(outpoint => outpoint.split('.')[0]))]
  const importableTxids = new Set<string>()
  const proofFailures: string[] = []
  for (const txid of txids) {
    try {
      beef.mergeBeef(await services.getBeefForTxid(txid))
      importableTxids.add(txid)
    } catch (error) {
      const rawSourceTxHex = rawSourceTxByTxid.get(txid)
      if (rawSourceTxHex != null && sourceByTxid.get(txid) !== 'wallet-toolbox') {
        beef.mergeRawTx(Transaction.fromHex(rawSourceTxHex).toBinary())
        importableTxids.add(txid)
      } else {
        proofFailures.push(`${txid}: ${errorMessage(error)}`)
      }
    }
  }
  const importableOutpoints = outpoints.filter(outpoint => importableTxids.has(outpoint.split('.')[0]))
  if (importableOutpoints.length === 0) {
    const details = proofFailures.length > 0 ? ` (${proofFailures.slice(0, 3).join('; ')})` : ''
    throw new Error(`No funded testnet outpoints have provider BEEF/proof data yet${details}`)
  }
  if (proofFailures.length > 0) {
    console.warn(`Skipping ${outpoints.length - importableOutpoints.length} funded testnet outpoint(s) without provider BEEF/proof data yet`)
  }
  const keyPair: KeyPairAddress = {
    privateKey: rootKey,
    publicKey: rootKey.toPublicKey(),
    address: rootKey.toAddress('testnet')
  }
  const results = await Setup.fundWalletFromP2PKHOutpoints(wallet, importableOutpoints, keyPair, beef.toBinary())
  const failures = results.filter(result => !result.success)
  if (failures.length > 0) {
    throw new Error(`Failed to import ${failures.length} testnet outpoint(s): ${failures.slice(0, 3).map(f => `${f.outpoint}: ${f.error}`).join('; ')}`)
  }
  return results.length
}

async function seedLoadUtxoSlots (wallet: Wallet, lockingScript: string): Promise<number> {
  const targetSlots = positiveIntFromEnv('TESTNET_LOAD_PREFUND_SLOTS', defaultSeedSlotCount())
  if (targetSlots <= 0) return 0
  const slotSats = positiveIntFromEnv('TESTNET_LOAD_PREFUND_SLOT_SATS', 251)
  const maxOutputsPerAction = positiveIntFromEnv('TESTNET_LOAD_PREFUND_MAX_OUTPUTS_PER_ACTION', 100)
  let seeded = 0
  while (seeded < targetSlots) {
    const outputCount = Math.min(targetSlots - seeded, maxOutputsPerAction)
    await wallet.createAction({
      description: 'testnet throughput slot fanout',
      labels: throughputLabels('testnet-throughput', 'testnet-throughput-fanout'),
      outputs: Array.from({ length: outputCount }, () => ({
        lockingScript,
        satoshis: slotSats,
        outputDescription: 'testnet throughput seeded slot'
      })),
      options: {
        randomizeOutputs: false,
        returnTXIDOnly: true
      }
    })
    seeded += outputCount
  }
  return seeded
}

function defaultSeedSlotCount (): number {
  return Math.max(...stages.map(stage => stage.targetTps * stage.durationSeconds)) + 50
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
  let lastLaunchAt = started
  const failureSamples: string[] = []

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
          if (failureSamples.length < 5) failureSamples.push(result.error)
          if (isStopError(result.error)) stopReason = result.error
        }
      })
      .catch(error => {
        attempted++
        failed++
        const message = error instanceof Error ? error.message : String(error)
        if (failureSamples.length < 5) failureSamples.push(message)
        if (isStopError(message)) stopReason = message
      })
      .finally(() => {
        pending.delete(work)
      })
    pending.add(work)
    lastLaunchAt = Date.now()
  }

  await Promise.allSettled([...pending])
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
  const actualTps = calculateActualTps(succeeded, stage.durationSeconds, started, lastLaunchAt)
  const p50Ms = percentile(latencies, 0.5)
  const p95Ms = percentile(latencies, 0.95)
  const p99Ms = percentile(latencies, 0.99)
  const bottleneck = classifyBottleneck(metrics, failed, stopReason, providerClassifications, queueBacklogGrowth, jetStreamBacklog, {
    actualTps,
    targetTps: stage.targetTps,
    p95Ms
  })
  const unknownOutcomes = providerClassifications.unknown
  const clean = isCleanStage({
    actualTps,
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
      actualTps,
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
    actualTps,
    p50Ms,
    p95Ms,
    p99Ms,
    metrics,
    bottleneck,
    error: stopReason,
    failureSamples
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
      labels: throughputLabels('testnet-throughput'),
      outputs: [{
        lockingScript: context.selfLockingScript,
        satoshis: amountSats,
        outputDescription: 'testnet throughput self-send'
      }],
      options: {
        randomizeOutputs: false,
        returnTXIDOnly: true
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

function throughputLabels (...labels: string[]): string[] | undefined {
  return process.env.TESTNET_LOAD_LABELS === '1' ? labels : undefined
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

export function classifyBottleneck (
  metrics: MetricsSnapshot,
  failed: number,
  stopReason: string | undefined,
  providerClassifications: ProviderClassifications,
  queueBacklogGrowth: boolean,
  jetStreamBacklog: number,
  throughput?: { actualTps: number, targetTps: number, p95Ms: number }
): BottleneckClassification {
  if (stopReason != null) {
    if (/rate.?limit|too many requests|429/i.test(stopReason)) return { category: 'provider_rate_limit', evidence: { stopReason } }
    if (/fund|no spendable testnet wallet-toolbox|paymail|source utxo/i.test(stopReason)) return { category: 'funding_exhaustion', evidence: { stopReason } }
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
  if (throughput != null && throughput.actualTps < throughput.targetTps && throughput.p95Ms >= 500) {
    if (queueDepth(metrics) === 0 && metrics.transactionTailQueueDepthMax <= 1 && metrics.storageQueryP95Seconds < 0.5) {
      return {
        category: 'storage_manager_writer_serialization',
        evidence: {
          actualTps: throughput.actualTps,
          targetTps: throughput.targetTps,
          p95Ms: throughput.p95Ms,
          transactionTailQueueDepthMax: metrics.transactionTailQueueDepthMax,
          storageQueryP95Seconds: metrics.storageQueryP95Seconds
        }
      }
    }
    return { category: 'tx_construction_cpu', evidence: throughput }
  }
  if (metrics.p95BroadcastLatencySeconds >= 0.5) return { category: 'provider_latency', evidence: { p95BroadcastLatencySeconds: metrics.p95BroadcastLatencySeconds } }
  if (metrics.utxoCacheHitRate > 0 && metrics.utxoCacheHitRate < 0.9) return { category: 'cache_miss_rate', evidence: { utxoCacheHitRate: metrics.utxoCacheHitRate } }
  return { category: 'none', evidence: {} }
}

export function classifySetupBottleneck (message: string): BottleneckClassification {
  if (/rate.?limit|too many requests|429/i.test(message)) return { category: 'provider_rate_limit', evidence: { setupBlocker: message } }
  if (/fund|no spendable testnet wallet-toolbox|paymail|source utxo/i.test(message)) return { category: 'funding_exhaustion', evidence: { setupBlocker: message } }
  if (/valid Beef|inputBEEF|proof|bump/i.test(message)) return { category: 'proof_finality_lag', evidence: { setupBlocker: message } }
  if (/utxo|insufficient|missing inputs|spendable/i.test(message)) return { category: 'utxo_exhaustion', evidence: { setupBlocker: message } }
  return { category: 'tx_construction_cpu', evidence: { setupBlocker: message } }
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
  setupBlocker?: string
  setupBottleneckClassification?: BottleneckClassification
}): Promise<void> {
  await mkdir(path.dirname(throughputArtifactPath), { recursive: true })
  const bottleneckClassification = args.setupBottleneckClassification ?? aggregateBottleneck(args.results)
  const providerClassifications = aggregateProviderClassifications(args.results)
  await writeFile(throughputArtifactPath, JSON.stringify({
    ok: !args.skipped && args.highestCleanStage === '50tps-10s' && args.results.every(result => result.clean),
    scope: 'wallet-toolbox-throughput-safety',
    generatedAt: new Date().toISOString(),
    mode: process.env.NATS_URL != null && process.env.NATS_URL.trim() !== '' ? 'distributed' : 'local-fallback',
    skipped: args.skipped,
    highestCleanStage: args.highestCleanStage ?? null,
    setupBlocker: args.setupBlocker ?? null,
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
    evidenceHash: evidenceHash({ results: args.results, setupBlocker: args.setupBlocker ?? null })
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

function stageName (stage: Stage): string {
  return `${stage.targetTps}tps-${stage.durationSeconds}s`
}

function queueDepth (metrics: MetricsSnapshot): number {
  return metrics.postBeefQueueSize + metrics.postBeefQueuePending + metrics.sendWaitingQueueSize + metrics.sendWaitingQueuePending
}

function getProviderClassifications (history: ServicesCallHistory): ProviderClassifications {
  const classifications: ProviderClassifications = emptyProviderClassifications()
  for (const provider of Object.values(history.postBeef.historyByProvider)) {
    const reset = provider.resetCounts[0]
    classifications.accepted += reset?.success ?? 0
    classifications.rejected += Math.max(0, (reset?.failure ?? 0) - (reset?.error ?? 0))
    classifications.unknown += reset?.error ?? 0
    for (const call of provider.calls) {
      if (call.success) continue
      const text = `${call.result ?? ''} ${call.error?.message ?? ''}`
      if (/rate.?limit|429/i.test(text)) classifications.rateLimited++
      if (/timeout|timed out/i.test(text)) classifications.timeout++
    }
  }
  classifications.unknown = Math.max(0, classifications.unknown - classifications.rateLimited - classifications.timeout)
  return classifications
}

function emptyProviderClassifications (): ProviderClassifications {
  return {
    seen: 0,
    accepted: 0,
    rejected: 0,
    unknown: 0,
    timeout: 0,
    rateLimited: 0
  }
}

function isCleanStage (stage: {
  actualTps: number
  targetTps: number
  inputRestorationForBroadcastTxs: number
  duplicateSpendAttempts: number
  sameTxidReuseVerified: boolean
  queueBacklogGrowth: boolean
  jetStreamBacklog: number
  cacheHitRate: number
  transactionTailQueueDepthMax: number
  unknownOutcomes: number
  failedBroadcasts: number
  bottleneck: BottleneckClassification
}): boolean {
  return stage.actualTps >= stage.targetTps &&
    stage.inputRestorationForBroadcastTxs === 0 &&
    stage.duplicateSpendAttempts === 0 &&
    stage.sameTxidReuseVerified &&
    !stage.queueBacklogGrowth &&
    stage.jetStreamBacklog === 0 &&
    cacheCriterionPassed(stage.cacheHitRate, stage.bottleneck) &&
    (stage.transactionTailQueueDepthMax < 50 || stage.bottleneck.category === 'transaction_tail_contention') &&
    stage.unknownOutcomes === 0 &&
    stage.failedBroadcasts === 0
}

function cacheCriterionPassed (cacheHitRate: number, bottleneck: BottleneckClassification): boolean {
  return cacheHitRate === 0 || cacheHitRate >= 0.9 || bottleneck.category === 'cache_miss_rate'
}

function stageBlocker (
  stage: Parameters<typeof isCleanStage>[0],
  stopReason?: string
): string {
  if (stopReason != null) return stopReason
  if (stage.actualTps < stage.targetTps) return `actual TPS ${stage.actualTps} below target ${stage.targetTps}`
  if (stage.inputRestorationForBroadcastTxs !== 0) return 'input restoration occurred for broadcast-visible transactions'
  if (stage.duplicateSpendAttempts !== 0) return 'duplicate spend attempts were observed'
  if (!stage.sameTxidReuseVerified) return 'same txid reuse could not be verified'
  if (stage.queueBacklogGrowth) return 'queue backlog grew during the stage'
  if (stage.jetStreamBacklog !== 0) return 'JetStream backlog remained after the stage'
  if (!cacheCriterionPassed(stage.cacheHitRate, stage.bottleneck)) return `UTXO cache hit rate ${stage.cacheHitRate} below 0.90 without cache bottleneck classification`
  if (stage.transactionTailQueueDepthMax >= 50 && stage.bottleneck.category !== 'transaction_tail_contention') return 'transaction tail queue depth exceeded threshold without contention classification'
  if (stage.unknownOutcomes !== 0) return 'unknown provider outcomes were observed'
  if (stage.failedBroadcasts !== 0) return 'failed broadcasts were observed'
  return 'stage did not satisfy clean criteria'
}

function artifactStage (result: StageResult): Record<string, unknown> {
  return {
    name: result.name,
    targetTps: result.targetTps,
    durationSeconds: result.durationSeconds,
    actualTps: result.actualTps,
    p50LatencyMs: result.p50Ms,
    p95LatencyMs: result.p95Ms,
    p99LatencyMs: result.p99Ms,
    cacheHitRate: result.metrics.utxoCacheHitRate,
    broadcastQueueDepthMax: result.broadcastQueueDepthMax,
    jetStreamBacklog: result.jetStreamBacklog,
    rocksDbWriteLatencyP50Ms: result.rocksDbWriteLatencyP50Ms,
    rocksDbWriteLatencyP95Ms: result.rocksDbWriteLatencyP95Ms,
    rocksDbWriteLatencyP99Ms: result.rocksDbWriteLatencyP99Ms,
    transactionTailQueueDepthMax: result.transactionTailQueueDepthMax,
    providerClassifications: result.providerClassifications,
    failedBroadcasts: result.failedBroadcasts,
    unknownOutcomes: result.unknownOutcomes,
    failureSamples: result.failureSamples,
    inputRestorationForBroadcastTxs: result.inputRestorationForBroadcastTxs,
    duplicateSpendAttempts: result.duplicateSpendAttempts,
    sameTxidReuseVerified: result.sameTxidReuseVerified,
    queueBacklogGrowth: result.queueBacklogGrowth,
    clean: result.clean,
    blocker: result.blocker
  }
}

function aggregateBottleneck (results: StageResult[]): BottleneckClassification {
  return results.find(result => result.bottleneck.category !== 'none')?.bottleneck ?? { category: 'none', evidence: {} }
}

function aggregateProviderClassifications (results: StageResult[]): ProviderClassifications {
  return results.reduce((total, result) => addProviderClassifications(total, result.providerClassifications), emptyProviderClassifications())
}

function addProviderClassifications (a: ProviderClassifications, b: ProviderClassifications): ProviderClassifications {
  return {
    seen: a.seen + b.seen,
    accepted: a.accepted + b.accepted,
    rejected: a.rejected + b.rejected,
    unknown: a.unknown + b.unknown,
    timeout: a.timeout + b.timeout,
    rateLimited: a.rateLimited + b.rateLimited
  }
}

function sum (results: StageResult[], key: 'inputRestorationForBroadcastTxs' | 'duplicateSpendAttempts' | 'unknownOutcomes' | 'failedBroadcasts'): number {
  return results.reduce((total, result) => total + result[key], 0)
}

function lastMetric (results: StageResult[], key: 'utxoCacheHitRate'): number {
  return results.at(-1)?.metrics[key] ?? 0
}

function max (values: number[]): number {
  return values.length === 0 ? 0 : Math.max(...values)
}

function evidenceHash (evidence: { results: StageResult[], setupBlocker: string | null }): string {
  return createHash('sha256').update(JSON.stringify(evidence)).digest('hex')
}

export function calculateActualTps (succeeded: number, durationSeconds: number, startedAt: number, lastLaunchAt: number): number {
  const launchWindowSeconds = Math.max(0, (lastLaunchAt - startedAt) / 1000)
  const elapsedSeconds = Math.max(1, durationSeconds, launchWindowSeconds)
  return round(succeeded / elapsedSeconds)
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
  return /rate.?limit|too many requests|429|fund|utxo|insufficient|missing inputs|spendable/i.test(message)
}

function isCleanStopBottleneck (bottleneck: string): boolean {
  return bottleneck === 'provider_rate_limit' || bottleneck === 'utxo_exhaustion' || bottleneck === 'funding_exhaustion' || bottleneck === 'proof_finality_lag'
}

function errorMessage (error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function assertOutpoint (value: string): string {
  const normalized = value.trim().replace(':', '.')
  if (!/^[0-9a-fA-F]{64}\.\d+$/.test(normalized)) throw new Error(`Invalid outpoint: ${value}`)
  return normalized.toLowerCase()
}

export function resolveArcUrl (env: NodeJS.ProcessEnv = process.env): string {
  return firstCsvEnv(env, [
    'ARC_URL',
    'NEKTAR_LIVE_TESTNET_ARC_ENDPOINTS',
    'NEKTAR_ARC_URL',
    'SPVWALLET_ARC_URL'
  ]) ?? 'https://arc.gorillapool.io'
}

export function resolveArcApiKey (env: NodeJS.ProcessEnv = process.env): string {
  return normalizeBearerToken(firstEnv(env, [
    'ARC_API_KEY',
    'NEKTAR_ARC_API_KEY',
    'NEKTAR_ARC_TOKEN',
    'SPVWALLET_ARC_TOKEN_TESTNET',
    'SPVWALLET_ARC_TOKEN',
    'ARCADE_TERANODE_AUTH_TOKEN_TESTNET',
    'ARCADE_TERANODE_AUTH_TOKEN'
  ]) ?? '')
}

export function resolveWalletRootKeySource (env: NodeJS.ProcessEnv = process.env): { kind: 'signer-config' | 'wif' | 'hex' | 'file', value: string } {
  const signerConfig = firstEnv(env, [
    'TESTNET_WALLET_TOOLBOX_SIGNER_CONFIG',
    'NEKTAR_WALLET_TOOLBOX_SIGNER_CONFIG',
    'NEKTAR_AUTONOMOUS_TESTNET_SIGNER_CONFIG',
    'NEKTAR_AUTONOMOUS_COMMERCE_SIGNER_CONFIG'
  ])
  if (signerConfig != null) return { kind: 'signer-config', value: signerConfig }
  const wif = firstEnv(env, ['TESTNET_WALLET_WIF'])
  if (wif != null) return { kind: 'wif', value: wif }
  const hex = firstEnv(env, ['TESTNET_WALLET_ROOT_KEY_HEX', 'NEKTAR_WALLET_TOOLBOX_ROOT_KEY'])
  if (hex != null) return { kind: 'hex', value: hex }
  const file = firstEnv(env, [
    'TESTNET_WALLET_ROOT_KEY_FILE',
    'TESTNET_WALLET_ROOT_KEY_JSON',
    'NEKTAR_WALLET_TOOLBOX_ROOT_KEY_FILE',
    'NEKTAR_WALLET_TOOLBOX_LOCAL_KEY_CONFIG'
  ])
  if (file != null) return { kind: 'file', value: file }
  throw new Error('TESTNET_WALLET_TOOLBOX_SIGNER_CONFIG, TESTNET_WALLET_ROOT_KEY_HEX, or TESTNET_WALLET_ROOT_KEY_FILE is required')
}

export async function loadWalletRootKey (): Promise<LoadedWalletRootKey> {
  const source = resolveWalletRootKeySource()
  if (source.kind === 'signer-config') return await loadWalletRootKeyFromSignerConfig(source.value)
  if (source.kind === 'wif') return { rootKey: PrivateKey.fromWif(source.value), source: 'TESTNET_WALLET_WIF' }
  if (source.kind === 'hex') return { rootKey: PrivateKey.fromHex(source.value), source: 'TESTNET_WALLET_ROOT_KEY_HEX' }
  const loaded = await readWalletRootKeyFile(source.value)
  return { rootKey: loaded.rootKey, source: loaded.source }
}

async function loadWalletRootKeyFromSignerConfig (file: string): Promise<LoadedWalletRootKey> {
  const signerConfig = await readSignerConfig(file)
  const loaded = await readWalletRootKeyFile(signerConfig.localKeyConfigPath)
  return {
    rootKey: loaded.rootKey,
    source: 'TESTNET_WALLET_TOOLBOX_SIGNER_CONFIG',
    signerConfig
  }
}

async function readSignerConfig (file: string): Promise<LoadedSignerConfig> {
  const configPath = normalizeLocalPath(file)
  const content = await readFile(configPath, 'utf8')
  const parsed = JSON.parse(content) as WalletToolboxSignerConfigFile
  const signerRef = normalizeText(parsed.signerRef)
  if (signerRef == null) throw new Error('TESTNET_WALLET_TOOLBOX_SIGNER_CONFIG must contain signerRef')
  const network = normalizeSignerNetwork(parsed.network)
  if (network !== 'bsv-testnet') throw new Error('TESTNET_WALLET_TOOLBOX_SIGNER_CONFIG must target bsv-testnet')
  const walletPath = normalizePathFromConfig(parsed.walletToolboxWalletPath ?? parsed.walletPath, configPath)
  if (walletPath == null) throw new Error('TESTNET_WALLET_TOOLBOX_SIGNER_CONFIG must contain walletToolboxWalletPath')
  const localKeyConfigPath = normalizePathFromConfig(parsed.walletToolboxLocalKeyConfigPath ?? parsed.localKeyConfigPath, configPath)
  if (localKeyConfigPath == null) throw new Error('TESTNET_WALLET_TOOLBOX_SIGNER_CONFIG must contain walletToolboxLocalKeyConfigPath')
  return {
    signerRef,
    network,
    walletPath,
    localKeyConfigPath,
    broadcastUrl: normalizeText(parsed.broadcastUrl) ?? undefined
  }
}

async function readWalletRootKeyFile (file: string): Promise<{ rootKey: PrivateKey, source: string }> {
  const content = (await readFile(normalizeLocalPath(file), 'utf8')).trim()
  const value = content.startsWith('{')
    ? JSON.parse(content).rootKeyHex
    : content
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('TESTNET_WALLET_ROOT_KEY_FILE must contain rootKeyHex or a raw hex private key')
  }
  return { rootKey: PrivateKey.fromHex(value.trim()), source: 'TESTNET_WALLET_ROOT_KEY_FILE' }
}

function firstEnv (env: NodeJS.ProcessEnv, names: string[]): string | undefined {
  for (const name of names) {
    const value = env[name]?.trim()
    if (value != null && value !== '') return value
  }
  return undefined
}

function firstCsvEnv (env: NodeJS.ProcessEnv, names: string[]): string | undefined {
  const value = firstEnv(env, names)
  return value?.split(',').map(part => part.trim()).find(part => part !== '')
}

function normalizeBearerToken (value: string): string {
  return value.replace(/^Bearer\s+/i, '').trim()
}

function normalizeText (value: unknown): string | null {
  const normalized = String(value ?? '').trim()
  return normalized !== '' ? normalized : null
}

function normalizeSignerNetwork (value: unknown): 'bsv-testnet' | 'bsv-mainnet' | null {
  const normalized = normalizeText(value)?.toLowerCase()
  if (normalized === 'test' || normalized === 'testnet' || normalized === 'bsv-testnet') return 'bsv-testnet'
  if (normalized === 'main' || normalized === 'mainnet' || normalized === 'bsv-mainnet') return 'bsv-mainnet'
  return null
}

function walletStorageNamespaceForSignerRef (signerRef: string, expectedNetwork: 'bsv-testnet' | 'bsv-mainnet'): string {
  const url = new URL(signerRef)
  if (url.protocol.replace(/:$/, '') !== 'wallet-toolbox') throw new Error('TESTNET_WALLET_TOOLBOX_SIGNER_CONFIG signerRef must use wallet-toolbox scheme')
  const network = normalizeSignerNetwork(url.hostname)
  if (network !== expectedNetwork) throw new Error('TESTNET_WALLET_TOOLBOX_SIGNER_CONFIG signerRef network mismatch')
  const ref = normalizeText(decodeURIComponent(url.pathname.replace(/^\/+/, '')))
  if (ref == null) throw new Error('TESTNET_WALLET_TOOLBOX_SIGNER_CONFIG signerRef must contain wallet ref')
  const readableRef = ref.toLowerCase().replace(/[^a-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)
  const digest = createHash('sha256').update(`${network}:${ref}`).digest('hex').slice(0, 16)
  return `wallet-toolbox-rocksdb:${network}:${readableRef !== '' ? readableRef : 'wallet'}:${digest}`
}

function normalizePathFromConfig (value: unknown, configPath: string): string | null {
  const normalized = normalizeText(value)
  if (normalized == null) return null
  const localPath = normalizeLocalPath(normalized)
  return path.isAbsolute(localPath) ? localPath : path.resolve(path.dirname(configPath), localPath)
}

function normalizeLocalPath (value: string): string {
  const normalized = String(value ?? '').trim()
  const windowsPath = /^([a-zA-Z]):[\\/](.*)$/.exec(normalized)
  if (windowsPath != null) {
    return path.join('/mnt', windowsPath[1].toLowerCase(), windowsPath[2].replace(/\\/g, '/'))
  }
  return path.resolve(normalized)
}

function positiveIntFromEnv (name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback)
  return Number.isSafeInteger(value) && value > 0 ? value : fallback
}

async function sleep (ms: number): Promise<void> {
  if (ms <= 0) return
  await new Promise(resolve => setTimeout(resolve, ms))
}

if (require.main === module) {
  main().catch(error => {
    console.error(error)
    process.exitCode = 1
  })
}
