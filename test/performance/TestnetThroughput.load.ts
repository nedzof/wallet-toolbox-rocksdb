import { spawn } from 'child_process'
import { mkdtemp, readFile, rm } from 'fs/promises'
import os from 'os'
import path from 'path'

interface StageResult {
  targetTps: number
  durationSeconds: number
  attempted: number
  succeeded: number
  failed: number
  actualTps: number
  p50Ms: number
  p95Ms: number
  p99Ms: number
  source: 'spv-paymail'
  recipientPaymail: string
  runId: string
  evidence: string
  error?: string
}

interface NektarCirculationReport {
  ok?: boolean
  runId?: string
  recipientPaymail?: string
  count?: number
  completedCount?: number
  broadcastedCount?: number
  failedCount?: number
  observedCompletionTps?: number
  queueWaitP99Ms?: number
  callbackP99Ms?: number | null
  checkpointP99Ms?: number | null
  errorSummary?: Record<string, number>
  errorCodeSummary?: Record<string, number>
  results?: Array<{ elapsedMs?: number, errorMessage?: string }>
}

const stages = [
  { targetTps: 10, durationSeconds: 10 },
  { targetTps: 50, durationSeconds: 10 },
  { targetTps: 100, durationSeconds: 10 },
  { targetTps: 500, durationSeconds: 10 },
  { targetTps: 1000, durationSeconds: 10 }
]

async function main (): Promise<void> {
  if (!isEnabled()) {
    console.log('Skipped: set TESTNET_LOAD_ENABLED=1 with funded testnet SPV/paymail credentials')
    return
  }

  const nektarRunRoot = resolveNektarRunRoot()
  const recipientPaymail = requiredEnvFrom(
    'TESTNET_LOAD_RECIPIENT_PAYMAIL',
    'NEKTAR_LIVE_SETTLEMENT_RECIPIENT_PAYMAIL'
  )
  const senderAgentId = process.env.TESTNET_LOAD_SENDER_AGENT_ID?.trim() ||
    process.env.NEKTAR_TREASURY_SPV_AGENT_ID?.trim() ||
    'treasury'
  const amountSats = positiveIntFromEnv('TESTNET_LOAD_AMOUNT_SATS', 1)
  const feeReserveSats = positiveIntFromEnv('TESTNET_LOAD_FEE_RESERVE_SATS', 250)
  const results: StageResult[] = []

  console.log(`Using SPV/paymail testnet load driver from ${nektarRunRoot}`)
  console.log(`Sender agent: ${senderAgentId}`)
  console.log(`Recipient paymail: ${recipientPaymail}`)

  for (const stage of stages) {
    const result = await runSpvPaymailStage({
      nektarRunRoot,
      senderAgentId,
      recipientPaymail,
      amountSats,
      feeReserveSats,
      targetTps: stage.targetTps,
      durationSeconds: stage.durationSeconds
    })
    results.push(result)
    console.log(JSON.stringify(result, null, 2))
    if (result.error != null) break
    if (result.actualTps < stage.targetTps) break
  }

  printSummary(results)
  if (results.some(result => result.error != null)) process.exitCode = 1
}

async function runSpvPaymailStage (args: {
  nektarRunRoot: string
  senderAgentId: string
  recipientPaymail: string
  amountSats: number
  feeReserveSats: number
  targetTps: number
  durationSeconds: number
}): Promise<StageResult> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wallet-toolbox-spv-paymail-load-'))
  const runId = `wallet-toolbox-spv-paymail-${args.targetTps}tps-${Date.now()}`
  const outputJson = path.join(dir, 'report.json')
  const outputMd = path.join(dir, 'report.md')
  const count = args.targetTps * args.durationSeconds
  let keepArtifacts = process.env.TESTNET_LOAD_KEEP_ARTIFACTS === '1'
  const env = {
    ...process.env,
    NEKTAR_LIVE_TESTNET_CIRCULATION_RAMP: '1',
    NEKTAR_LIVE_SETTLEMENT_RECIPIENT_PAYMAIL: args.recipientPaymail,
    NEKTAR_LIVE_SETTLEMENT_SENDER_AGENT_ID: args.senderAgentId,
    NEKTAR_LIVE_CIRCULATION_COUNT: String(count),
    NEKTAR_LIVE_CIRCULATION_AMOUNT_SATS: String(args.amountSats),
    NEKTAR_LIVE_CIRCULATION_MIN_SOURCE_UTXO_SATS: String(positiveIntFromEnv('TESTNET_LOAD_MIN_SOURCE_UTXO_SATS', args.amountSats + args.feeReserveSats)),
    NEKTAR_LIVE_CIRCULATION_RATE: String(args.targetTps),
    NEKTAR_LIVE_CIRCULATION_DURATION_MS: String(args.durationSeconds * 1000),
    NEKTAR_LIVE_CIRCULATION_BATCH_SIZE: String(positiveIntFromEnv('TESTNET_LOAD_SPV_BATCH_SIZE', Math.max(1, Math.min(args.targetTps, 100)))),
    NEKTAR_LIVE_CIRCULATION_CONCURRENCY: String(positiveIntFromEnv('TESTNET_LOAD_SPV_CONCURRENCY', Math.max(1, Math.min(args.targetTps, 100)))),
    NEKTAR_LIVE_CIRCULATION_HIGH_THROUGHPUT: process.env.TESTNET_LOAD_SPV_HIGH_THROUGHPUT ?? '0',
    NEKTAR_LIVE_CIRCULATION_BATCH_DERIVATION: process.env.TESTNET_LOAD_SPV_BATCH_DERIVATION ?? '0',
    NEKTAR_LIVE_CIRCULATION_SUBMIT_PAYMAIL_RECEIVE: process.env.TESTNET_LOAD_SPV_SUBMIT_PAYMAIL_RECEIVE ?? '1',
    NEKTAR_LIVE_CIRCULATION_USE_SPV_LISTED_FROM_UTXOS: process.env.TESTNET_LOAD_USE_SPV_LISTED_FROM_UTXOS ?? '1',
    NEKTAR_LIVE_CIRCULATION_REQUIRE_SPV_SLOT_MATCH: process.env.TESTNET_LOAD_REQUIRE_SPV_SLOT_MATCH ?? '0',
    NEKTAR_LIVE_CIRCULATION_REQUIRE_SPV_LISTED_WOC_UNSPENT: process.env.TESTNET_LOAD_REQUIRE_SPV_LISTED_WOC_UNSPENT ?? '1',
    NEKTAR_LIVE_CIRCULATION_ALLOW_NON_1M: '1',
    NEKTAR_LIVE_CIRCULATION_RUN_ID: runId,
    NEKTAR_LIVE_CIRCULATION_OUTPUT_JSON: outputJson,
    NEKTAR_LIVE_CIRCULATION_OUTPUT_MD: outputMd
  }

  try {
    const { stdout, stderr, exitCode } = await runCommand(
      'node',
      ['--import', 'tsx', 'scripts/testnet/live-testnet-circulation-ramp.ts'],
      args.nektarRunRoot,
      env,
      positiveIntFromEnv('TESTNET_LOAD_STAGE_TIMEOUT_SECONDS', Math.max(300, args.durationSeconds + 180)) * 1000
    )
    if (stdout.trim() !== '') console.log(stdout.trim())
    if (stderr.trim() !== '') console.error(stderr.trim())
    const report = await readReport(outputJson, stdout)
    const result = makeStageResult(args, runId, outputJson, report, exitCode, stderr)
    keepArtifacts = keepArtifacts || result.error != null
    return result
  } finally {
    if (!keepArtifacts) {
      await rm(dir, { recursive: true, force: true })
    }
  }
}

function makeStageResult (
  args: {
    recipientPaymail: string
    targetTps: number
    durationSeconds: number
  },
  runId: string,
  evidence: string,
  report: NektarCirculationReport | null,
  exitCode: number,
  stderr: string
): StageResult {
  const elapsed = (report?.results ?? [])
    .map(result => Number(result.elapsedMs ?? 0))
    .filter(value => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b)
  const firstError = firstReportError(report)
  return {
    targetTps: args.targetTps,
    durationSeconds: args.durationSeconds,
    attempted: Number(report?.count ?? args.targetTps * args.durationSeconds),
    succeeded: Number(report?.broadcastedCount ?? 0),
    failed: Number(report?.failedCount ?? (exitCode === 0 ? 0 : 1)),
    actualTps: Number(report?.observedCompletionTps ?? 0),
    p50Ms: percentile(elapsed, 0.5),
    p95Ms: percentile(elapsed, 0.95),
    p99Ms: elapsed.length > 0
      ? percentile(elapsed, 0.99)
      : Number(report?.callbackP99Ms ?? report?.checkpointP99Ms ?? report?.queueWaitP99Ms ?? 0),
    source: 'spv-paymail',
    recipientPaymail: String(report?.recipientPaymail ?? args.recipientPaymail),
    runId: String(report?.runId ?? runId),
    evidence,
    error: exitCode === 0 && report?.ok === true ? undefined : firstError ?? firstProcessError(stderr) ?? `SPV/paymail stage exited with code ${exitCode}`
  }
}

async function readReport (outputJson: string, stdout: string): Promise<NektarCirculationReport | null> {
  try {
    return JSON.parse(await readFile(outputJson, 'utf8')) as NektarCirculationReport
  } catch {
    const jsonStart = stdout.lastIndexOf('\n{')
    const candidate = jsonStart >= 0 ? stdout.slice(jsonStart + 1) : stdout
    try {
      return JSON.parse(candidate) as NektarCirculationReport
    } catch {
      return null
    }
  }
}

function firstReportError (report: NektarCirculationReport | null): string | undefined {
  const summary = report?.errorSummary ?? report?.errorCodeSummary
  const summaryKey = summary == null ? undefined : Object.keys(summary)[0]
  if (summaryKey != null) return summaryKey
  return report?.results?.find(result => result.errorMessage != null)?.errorMessage
}

function firstProcessError (stderr: string): string | undefined {
  return stderr
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(line => line.startsWith('Error: '))
}

async function runCommand (
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number
): Promise<{ stdout: string, stderr: string, exitCode: number }> {
  return await new Promise(resolve => {
    const child = spawn(command, args, { cwd, env, shell: false })
    let stdout = ''
    let stderr = ''
    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
    }, timeoutMs)
    child.stdout.on('data', chunk => { stdout += String(chunk) })
    child.stderr.on('data', chunk => { stderr += String(chunk) })
    child.on('close', code => {
      clearTimeout(timeout)
      resolve({ stdout, stderr, exitCode: code ?? 1 })
    })
  })
}

function printSummary (results: StageResult[]): void {
  console.log('SPV/paymail testnet throughput summary:')
  console.table(results.map(r => ({
    targetTps: r.targetTps,
    actualTps: r.actualTps,
    p50Ms: r.p50Ms,
    p95Ms: r.p95Ms,
    p99Ms: r.p99Ms,
    failed: r.failed,
    source: r.source,
    error: r.error
  })))
}

function percentile (sorted: number[], quantile: number): number {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1))
  return sorted[index]
}

function isEnabled (): boolean {
  return process.env.TESTNET_LOAD_ENABLED === '1'
}

function resolveNektarRunRoot (): string {
  const configured = process.env.TESTNET_LOAD_NEKTAR_RUN_ROOT?.trim()
  if (configured != null && configured !== '') return path.resolve(configured)
  return path.resolve(process.cwd(), '../nektar-run')
}

function requiredEnvFrom (...names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim()
    if (value != null && value !== '') return value
  }
  throw new Error(`${names.join(' or ')} is required`)
}

function positiveIntFromEnv (name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback)
  return Number.isSafeInteger(value) && value > 0 ? value : fallback
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
